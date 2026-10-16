/**
 * =============================================================================
 * RECLAMAR LOS MENSAJES DE PERSONA PENDIENTES — `reclamarSalidaPersona` (CORE, H2-3)
 * =============================================================================
 *
 * Es el segundo paso de la salida (`salidaPersona.ts`): el flujo n8n «Salida de persona» suena su
 * timbre y llama acá, con la credencial de la ingesta DE SU NÚMERO (Bearer o firma HMAC, las mismas
 * de `rutaAutenticada`), para que le entreguen lo que debe enviar.
 *
 * LO QUE HACE
 *   POST, cuerpo ignorado (`{}`). Responde 200:
 *     { mensajes: [ { mensajeId, conversacionId, claveRele, to, texto, tipo: 'text', canal } ] }
 *   hasta 10, en orden de `ts`. Cada uno pasó de `pendiente` a `enviando` en SU propia transacción:
 *   dos reclamos a la vez (el timbre tocado dos veces) se reparten el trabajo y ninguno se lleva el
 *   mismo mensaje. Sin nada pendiente, `mensajes: []`. Errores: 405 (método), 401 (credencial; sin
 *   decir por qué) y 404 (número sin comercio de forma válida).
 *
 * LO QUE NO SE FÍA
 *   - El COMERCIO sale de la ruta autenticada, nunca del cuerpo (que ni se lee).
 *   - Un mensaje se entrega solo si la ruta dice lo mismo que el mensaje: su comercio y, si el mensaje
 *     lleva `phoneNumberId`, el de ESTE número. Con dos líneas, la otra no se lleva mensajes ajenos.
 *   - Un comercio suspendido o dado de baja, o una ruta no activa, no entrega nada: el mensaje queda
 *     `pendiente` (hablar con sus clientes es de un comercio activo).
 *   - El canal (`rele` o `graph`) es de `rutasWhatsApp/{n}.canalSalida`, sin valor = `graph`.
 *   - `claveRele` = 48 hex de sha256(comercio, conversación, clave): es la Idempotency-Key del relé.
 *
 * LA LIMPIEZA. Un mensaje `enviando` por más de 2 minutos (el flujo cayó antes de confirmar) pasa a
 * `incierto` y se cuenta (puede haber llegado). Nunca se vuelve a `pendiente` ni se reenvía solo.
 *
 * EL ÍNDICE. Busca con un `collectionGroup('mensajes')` por `tenantId` + `estadoEnvio` + orden de `ts`.
 * Pide un índice compuesto COLLECTION_GROUP (`firestore.indexes.json`) que tiene que estar DESPLEGADO
 * antes de etiquetar: sin él la consulta falla y nada se entrega (falla cerrada, mensajes `pendiente`).
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada, type Ruta } from '../seguridad/firma.js';
import { ID_COMERCIO } from './acceso.js';
import {
  ENVIANDO_MAXIMO_MS, MAXIMO_POR_RECLAMO, canalDeSalidaDe, claveReleDe, sumarMensajePersona, type CanalDeSalida,
} from './salidaPersona.js';
import { milisegundosDeMomento } from './turno.js';

export interface MensajeReclamado {
  mensajeId: string;
  conversacionId: string;
  claveRele: string;
  to: string;
  texto: string;
  tipo: 'text';
  canal: CanalDeSalida;
}

/** `tenants/{t}/conversaciones/{wa_…}/mensajes/{clave}`: el único camino válido de un mensaje de persona. */
const CAMINO = /^tenants\/([^/]+)\/conversaciones\/(wa_[0-9]{8,15})\/mensajes\/([^/]+)$/;

/** El reclamo (exportado para las pruebas). */
export async function reclamarSalida(
  ruta: Ruta, db: Firestore = getFirestore(), ahoraMs: number = Date.now(),
): Promise<{ mensajes: MensajeReclamado[]; inciertos: number }> {
  const vacio = { mensajes: [] as MensajeReclamado[], inciertos: 0 };
  const { tenantId, phoneNumberId } = ruta;
  const [tenant, rutaDoc] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(), db.doc(`rutasWhatsApp/${phoneNumberId}`).get(),
  ]);
  if (tenant.get('estado') !== 'activo' || !rutaDoc.exists || rutaDoc.get('estado') !== 'activo'
      || rutaDoc.get('tenantId') !== tenantId) return vacio;
  const canal = canalDeSalidaDe(rutaDoc.data());

  const candidatos = await db.collectionGroup('mensajes')
    .where('tenantId', '==', tenantId)
    .where('estadoEnvio', 'in', ['pendiente', 'enviando'])
    .orderBy('ts')
    .limit(MAXIMO_POR_RECLAMO * 2)
    .get();

  const mensajes: MensajeReclamado[] = [];
  let inciertos = 0;
  for (const candidato of candidatos.docs) {
    if (mensajes.length >= MAXIMO_POR_RECLAMO) break;
    const m = CAMINO.exec(candidato.ref.path);
    if (!m || m[1] !== tenantId) continue; // otro camino: no es de este comercio
    const [, , conversacionId, clave] = m as unknown as [string, string, string, string];

    const r = await db.runTransaction(async (tx): Promise<'reclamado' | 'incierto' | 'nada'> => {
      const s = await tx.get(candidato.ref);
      if (!s.exists || s.get('tenantId') !== tenantId || s.get('direccion') !== 'saliente' || s.get('autor') !== 'persona') return 'nada';
      const de: unknown = s.get('phoneNumberId');
      if (typeof de === 'string' && de !== phoneNumberId) return 'nada';
      const estado: unknown = s.get('estadoEnvio');
      if (estado === 'pendiente') {
        tx.update(candidato.ref, { estadoEnvio: 'enviando', reclamadoEn: Timestamp.fromMillis(ahoraMs) });
        return 'reclamado';
      }
      if (estado === 'enviando') {
        const desde = milisegundosDeMomento(s.get('reclamadoEn'));
        // Sin marca legible también se da por incierto: nadie lo va a confirmar.
        if (desde === null || ahoraMs - desde >= ENVIANDO_MAXIMO_MS) {
          tx.update(candidato.ref, { estadoEnvio: 'incierto', confirmadoEn: Timestamp.fromMillis(ahoraMs), contado: true });
          sumarMensajePersona(tx, db, tenantId, ahoraMs, 1);
          return 'incierto';
        }
      }
      return 'nada';
    });
    if (r === 'incierto') { inciertos += 1; continue; }
    if (r !== 'reclamado') continue;
    const datos = candidato.data();
    mensajes.push({
      mensajeId: clave, conversacionId, claveRele: claveReleDe(tenantId, conversacionId, clave),
      to: conversacionId.slice(3), texto: String(datos['texto'] ?? ''), tipo: 'text', canal,
    });
  }
  return { mensajes, inciertos };
}

export const reclamarSalidaPersona = onRequest(
  {
    region: REGION,
    // Las credenciales de la ingesta son las del número: `rutaAutenticada` lee el secreto de su alias.
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false, // servidor a servidor
    maxInstances: 5,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (!ID_COMERCIO.test(ruta.tenantId)) { respuesta.status(404).send('numero no asignado'); return; }
    try {
      const { mensajes, inciertos } = await reclamarSalida(ruta);
      // Solo el comercio, cuántos y por qué; nunca el texto, el teléfono ni la clave.
      logger.info('reclamarSalidaPersona', { tenantId: ruta.tenantId, entregados: mensajes.length, inciertos });
      respuesta.status(200).json({ mensajes });
    } catch (e) {
      const c = (e as { code?: unknown } | null)?.code;
      logger.error('reclamarSalidaPersona: falló', { tenantId: ruta.tenantId, codigo: typeof c === 'string' || typeof c === 'number' ? String(c) : 'desconocido' });
      respuesta.status(503).send('no disponible');
    }
  },
);
