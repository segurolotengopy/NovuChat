/**
 * RELLENO DE TÉRMINOS DE PRODUCTO: lo que el disparador de Productos no alcanza (PR 3; LOW-3 de
 * la revisión de seguridad de #659).
 *
 * El disparador (`modulos/productos/terminoProducto.ts`) solo corre cuando un ítem CAMBIA: los
 * ítems que ya existían al desplegarlo no tienen documento, y un `rechazado/límite` no se
 * reevalúa cuando se libera un lugar. Esto deja cada ítem activo con «prompt» en el nombre como
 * lo dejaría el disparador (`pendiente` o `rechazado`, NUNCA `aprobado`), con las mismas reglas
 * (Plataforma no puede importar de módulos, así que se repiten aquí y una prueba compara el
 * resultado con el del disparador):
 *   - sin documento, con otro nombre (hash) o con un rechazo del SISTEMA (término vacío, que
 *     incluye `límite`): se evalúa de nuevo y se escribe;
 *   - un aprobado del mismo nombre y término, y un rechazo MANUAL del mismo nombre (tiene
 *     `revisadoPor`), no se tocan;
 *   - el tope técnico (pendiente|aprobado) es el mismo.
 * No borra documentos: los que ya no corresponden los cuenta y los informa. Los ítems se
 * recorren por id para que el reparto de lugares sea determinista. Un comercio nunca mira a otro.
 */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { hashCorto, normalizar, terminoRegistrable } from '../central/asistente/comportamiento.js';
import type { OtrosComercios } from '../central/asistente/comportamiento.js';
import { COLECCION, ErrorTermino, TOPE_APROBADOS, otrosDe } from './terminosProducto.js';

export const MOTIVO_PENDIENTE = 'pendiente de revisión';
export const MOTIVO_RECHAZO = 'no se puede registrar como nombre de producto';
export const MOTIVO_LIMITE = 'límite';

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
// Los ids `__x__` están reservados por Firestore (error `internal`): no son ids de ítem.
const ID_ITEM = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface ResultadoRelleno {
  tenantId: string;
  conPrompt: number;
  escritos: { itemId: string; estado: 'pendiente' | 'rechazado' }[];
  sinCambio: number;
  huerfanos: number;
}

export async function rellenarTerminos(
  db: Firestore, tenantId: string, opciones: { quien: string; enSeco: boolean; otros?: OtrosComercios },
): Promise<ResultadoRelleno> {
  if (!ID_TENANT.test(tenantId) || opciones.quien === '') throw new ErrorTermino('invalido');
  const ficha = await db.doc(`tenants/${tenantId}`).get();
  if (!ficha.exists || ficha.get('estado') === 'baja') throw new ErrorTermino('sin_comercio');
  const catalogo = await db.collection(`tenants/${tenantId}/catalogo`).select('nombre', 'activo').get();
  const piden = catalogo.docs
    .filter((d) => ID_ITEM.test(d.id) && d.get('activo') === true && normalizar(texto(d.get('nombre'))).includes('prompt'))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const idsQuePiden = new Set(piden.map((d) => d.id));
  const resultado: ResultadoRelleno = { tenantId, conPrompt: piden.length, escritos: [], sinCambio: 0, huerfanos: 0 };
  const col = db.collection(`tenants/${tenantId}/${COLECCION}`);
  resultado.huerfanos = (await col.select().get()).docs.filter((d) => !idsQuePiden.has(d.id)).length;
  if (piden.length === 0) return resultado;
  const otros = opciones.otros ?? await otrosDe(db, tenantId);

  for (const it of piden) {
    const nombre = texto(it.get('nombre'));
    const nombreHash = hashCorto(normalizar(nombre));
    const cand = terminoRegistrable(nombre, otros);
    const ref = col.doc(it.id);
    const decidido = await db.runTransaction(async (tx) => {
      const [previo, vivos] = await Promise.all([
        tx.get(ref), tx.get(col.where('estado', 'in', ['pendiente', 'aprobado']).limit(TOPE_APROBADOS + 1)),
      ]);
      const otrosVivos = vivos.docs.filter((d) => d.id !== it.id).length;
      // PRESERVAR ANTES DEL TOPE: un aprobado vigente (mismo nombre, término que sigue siendo el registrable) es
      // de una persona y ya ocupa su lugar; el tope solo vale para altas y reinicios hacia pendiente.
      if (previo.exists) {
        const p0 = previo.data() ?? {};
        if (p0['estado'] === 'aprobado' && p0['nombreHash'] === nombreHash && cand.ok && p0['termino'] === cand.termino) return null;
      }
      let nuevo: { termino: string; estado: 'pendiente' | 'rechazado'; motivo: string };
      if (!cand.ok) nuevo = { termino: '', estado: 'rechazado', motivo: MOTIVO_RECHAZO };
      else if (otrosVivos >= TOPE_APROBADOS) nuevo = { termino: '', estado: 'rechazado', motivo: MOTIVO_LIMITE };
      else nuevo = { termino: cand.termino, estado: 'pendiente', motivo: MOTIVO_PENDIENTE };
      if (previo.exists) {
        const p = previo.data() ?? {};
        if (p['nombreHash'] === nombreHash) {
          if (p['estado'] === 'aprobado' && p['termino'] === nuevo.termino) return null;
          if (p['estado'] === 'rechazado' && typeof p['revisadoPor'] === 'string') return null; // rechazo manual: persiste
          if (p['estado'] === nuevo.estado && p['termino'] === nuevo.termino && p['motivo'] === nuevo.motivo) return null;
        }
      }
      // Sin merge: borra revisadoPor/revisadoEn (un aprobado cuyo término cambió vuelve a pendiente).
      if (!opciones.enSeco) tx.set(ref, { ...nuevo, nombreHash });
      return nuevo.estado;
    });
    if (decidido === null) resultado.sinCambio++;
    else resultado.escritos.push({ itemId: it.id, estado: decidido });
  }
  if (!opciones.enSeco && resultado.escritos.length > 0) {
    await db.collection(`tenants/${tenantId}/auditoria`).add({
      accion: 'rellenar_terminos_producto', uid: opciones.quien, en: Timestamp.now(), porScript: true,
      escritos: resultado.escritos.length, sinCambio: resultado.sinCambio,
    });
  }
  return resultado;
}
