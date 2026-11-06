/**
 * TÉRMINO DE PRODUCTO REGISTRADO: EL DISPARADOR (módulo Productos).
 *
 * El principio está en `central/asistente/comportamiento.ts`: una descripción de
 * producto es LITERAL. Un comercio cuyo producto se llama «Pack 100 prompts»
 * necesita que esa palabra pase en sus campañas; el registro es por ítem y lo
 * aprueba Plataforma. Este archivo hace SOLO la mitad de Productos:
 *
 *   - cuando un ítem del catálogo ACTIVO tiene «prompt/prompts» en el nombre,
 *     propone el término en `tenants/{t}/terminosProducto/{itemId}` con estado
 *     `pendiente` (pasa el filtro estricto de Central) o `rechazado` (no lo pasa,
 *     con un motivo GENÉRICO: no delata la lista de palabras);
 *   - NUNCA escribe `aprobado`: eso es solo de Plataforma;
 *   - si el nombre cambia, el documento se reinicia a `pendiente` (el hash
 *     viejo ya no vale aunque estuviera aprobado); si el ítem se borra, se da de
 *     baja o el nombre deja de decir «prompt», el documento se borra;
 *   - no más de `MAX_TERMINOS_TECNICO` documentos `pendiente|aprobado` por
 *     comercio: el siguiente queda `rechazado` con motivo «límite».
 *
 * Escribe en OTRA colección que la que escucha: no hay bucle. Es idempotente:
 * si el documento ya dice lo mismo, no escribe. Multi-tenant: la ruta sale de
 * `tenantId` del evento. Costo: sin «prompt» en el nombre no lee nada.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { hashCorto, normalizar, SIN_OTROS } from '../../central/asistente/comportamiento.js';
import {
  COLECCION_TERMINOS, MAX_TERMINOS_POR_TENANT, terminoRegistrable,
} from '../../central/asistente/terminos.js';
import { otrosComercios } from '../../central/asistente/verificarComportamiento.js';

/** Tope técnico de documentos vivos por comercio; el mismo que Central considera. */
export const MAX_TERMINOS_TECNICO = MAX_TERMINOS_POR_TENANT;

export const MOTIVO_RECHAZO = 'no se puede registrar como nombre de producto';
export const MOTIVO_LIMITE = 'límite';
export const MOTIVO_PENDIENTE = 'pendiente de revisión';

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** ¿Este ítem pide término? Activo y con «prompt/prompts» en el nombre. */
export function pideTermino(item: Record<string, unknown> | undefined): boolean {
  return !!item && item['activo'] === true && normalizar(texto(item['nombre'])).includes('prompt');
}

/**
 * Deja coherente el documento de un ítem. Separado del disparador para probarlo
 * contra el emulador. `obtenerOtros` se llama solo si el ítem pide término.
 */
export async function sincronizarTermino(
  db: Firestore, tenantId: string, itemId: string,
  item: Record<string, unknown> | undefined,
  obtenerOtros: () => Promise<{ ids: string[]; nombres: string[] }> = () => otrosComercios(db, tenantId),
): Promise<'borrado' | 'sin_cambio' | 'pendiente' | 'rechazado'> {
  const ref = db.collection('tenants').doc(tenantId).collection(COLECCION_TERMINOS).doc(itemId);
  if (!pideTermino(item)) {
    const previo = await ref.get();
    if (previo.exists) await ref.delete();
    return 'borrado';
  }
  const nombre = texto(item?.['nombre']);
  const nombreHash = hashCorto(normalizar(nombre));
  // Primero sin otros comercios: si ya se rechaza, no se leen todos los tenants (costo por edición en bucle).
  let cand = terminoRegistrable(nombre, SIN_OTROS);
  if (cand.ok) {
    let otros = SIN_OTROS;
    try { otros = await obtenerOtros(); } catch { otros = SIN_OTROS; }
    cand = terminoRegistrable(nombre, otros);
  }

  return db.runTransaction(async (tx) => {
    const previo = await tx.get(ref);
    // Una aprobación humana del mismo nombre y del mismo término se preserva ANTES de mirar el tope:
    // el tope solo vale para altas y reinicios hacia pendiente, nunca para quitar una aprobación.
    if (previo.exists) {
      const p0 = previo.data() ?? {};
      if (p0['estado'] === 'aprobado' && p0['nombreHash'] === nombreHash && cand.ok && p0['termino'] === cand.termino) {
        return 'sin_cambio' as const;
      }
    }
    // Cuántos hay vivos en el comercio, sin contar este ítem.
    const vivos = await tx.get(
      db.collection('tenants').doc(tenantId).collection(COLECCION_TERMINOS)
        .where('estado', 'in', ['pendiente', 'aprobado']).limit(MAX_TERMINOS_TECNICO + 1),
    );
    const otrosVivos = vivos.docs.filter((d) => d.id !== itemId).length;
    let nuevo: { termino: string; estado: 'pendiente' | 'rechazado'; motivo: string };
    if (!cand.ok) nuevo = { termino: '', estado: 'rechazado', motivo: MOTIVO_RECHAZO };
    else if (otrosVivos >= MAX_TERMINOS_TECNICO) nuevo = { termino: '', estado: 'rechazado', motivo: MOTIVO_LIMITE };
    else nuevo = { termino: cand.termino, estado: 'pendiente', motivo: MOTIVO_PENDIENTE };

    if (previo.exists) {
      const p = previo.data() ?? {};
      const mismoNombre = p['nombreHash'] === nombreHash;
      // Una aprobación del mismo nombre y del mismo término no se pisa; lo demás, si ya dice lo mismo, tampoco.
      const igual = p['estado'] === 'aprobado'
        ? p['termino'] === nuevo.termino
        : p['estado'] === nuevo.estado && p['termino'] === nuevo.termino && p['motivo'] === nuevo.motivo;
      if (mismoNombre && igual) return 'sin_cambio' as const;
    }
    // `set` sin merge: borra revisadoPor/revisadoEn de una aprobación anterior.
    tx.set(ref, { ...nuevo, nombreHash });
    return nuevo.estado;
  });
}

export const registrarTerminoDeProducto = onDocumentWritten(
  { document: 'tenants/{tenantId}/catalogo/{itemId}', region: REGION },
  async (evento) => {
    const antes = evento.data?.before.data();
    const ahora = evento.data?.after.data();
    const { tenantId, itemId } = evento.params;
    // Nada que ver con el término: ni lecturas ni escrituras.
    if (!pideTermino(antes) && !pideTermino(ahora)) return;
    if (antes && ahora && antes['nombre'] === ahora['nombre'] && antes['activo'] === ahora['activo']) return;
    await sincronizarTermino(getFirestore(), tenantId, itemId, ahora);
  },
);
