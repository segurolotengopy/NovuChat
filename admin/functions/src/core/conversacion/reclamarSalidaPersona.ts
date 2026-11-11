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
 * PRIVILEGIO: la credencial de ingesta de un número (firma.ts) ahora también autoriza reclamar y confirmar, y
 * con ella el flujo lee el texto y el destino de los mensajes de persona pendientes de su comercio (ampliación
 * aceptada en el contrato §4). El modo HMAC es reproducible durante 5 minutos (sin nonce): reproducirlo solo
 * reclama lo que ya estaba pendiente. Aceptado. Un `enviando` pasa a `incierto` solo cuando llega OTRO
 * reclamo; el barrido por minuto de H2-F lo dispara.
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
 * LA CADUCIDAD DEL `pendiente`. Un `pendiente` con más de 2 minutos (`PENDIENTE_MAXIMO_MS`), o cuya ventana
 * de Meta ya se cerró según `ultimoEntranteEn`, NO se entrega: pasa a `rechazado` con `codigoEnvio:
 * 'caducado'` y `reintentable: true`, sin contar en `mensajesPersona`. Se decide aunque el mensaje sea de
 * otra línea, para que los viejos no ocupen el lote de la consulta.
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
  CODIGO_CADUCADO, ENVIANDO_MAXIMO_MS, MAXIMO_POR_RECLAMO, PENDIENTE_MAXIMO_MS, canalDeSalidaDe, claveReleDe, sumarMensajePersona, type CanalDeSalida,
} from './salidaPersona.js';
import { milisegundosDeMomento, ventanaDeMetaAbierta } from './turno.js';

interface BaseReclamada {
  mensajeId: string;
  conversacionId: string;
  claveRele: string;
  to: string;
  canal: CanalDeSalida;
}
export interface MensajeDeTextoReclamado extends BaseReclamada {
  texto: string;
  tipo: 'text';
}
/**
 * Un ADJUNTO de persona (B2 de «Envío de medios por consola»). `texto` va SIEMPRE vacío: el flujo viejo (sin la cabecera
 * de adjuntos) no puede mandar la leyenda como un texto suelto; la leyenda viaja dentro de `adjunto`. Los bytes NO van
 * acá: el flujo los pide a `leerAdjuntoPersona`. `nombre` solo en documentos.
 */
export interface MensajeDeAdjuntoReclamado extends BaseReclamada {
  texto: '';
  tipo: 'image' | 'audio' | 'document';
  adjunto: { mime: string; tamano: number; sha256: string; voz: boolean; nombre?: string; leyenda?: string };
}
export type MensajeReclamado = MensajeDeTextoReclamado | MensajeDeAdjuntoReclamado;

/** La cabecera con la que el flujo nuevo declara que sabe enviar adjuntos. Sin ella no se entrega ninguno. */
export const CABECERA_DE_ADJUNTOS = 'x-novuchat-adjuntos';
/** Cuántos adjuntos entrega un reclamo, como máximo (decisión D-A3: uno por lote; los textos siguen hasta 10). */
export const MAXIMO_DE_ADJUNTOS_POR_RECLAMO = 1;
const TIPOS_DE_ADJUNTO: readonly string[] = ['image', 'audio', 'document'];

/** `tenants/{t}/conversaciones/{wa_…}/mensajes/{clave}`: el único camino válido de un mensaje de persona. */
const CAMINO = /^tenants\/([^/]+)\/conversaciones\/(wa_[0-9]{8,15})\/mensajes\/([^/]+)$/;

/** El reclamo (exportado para las pruebas). */
export async function reclamarSalida(
  ruta: Ruta, db: Firestore = getFirestore(), ahoraMs: number = Date.now(), conAdjuntos = false,
): Promise<{ mensajes: MensajeReclamado[]; inciertos: number; caducados: number }> {
  const vacio = { mensajes: [] as MensajeReclamado[], inciertos: 0, caducados: 0 };
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
  let caducados = 0;
  let adjuntosEnLote = 0;
  const cortadas = new Set<string>();
  // El adjunto reclamado en la transacción en curso (sus datos salen del metadato, que se lee ahí mismo).
  let adjuntoDeLaVuelta: MensajeDeAdjuntoReclamado['adjunto'] | null = null;
  for (const candidato of candidatos.docs) {
    if (mensajes.length >= MAXIMO_POR_RECLAMO) break;
    const m = CAMINO.exec(candidato.ref.path);
    if (!m || m[1] !== tenantId) continue; // otro camino: no es de este comercio
    const [, , conversacionId, clave] = m as unknown as [string, string, string, string];

    adjuntoDeLaVuelta = null;
    // Orden dentro de una conversación: si un adjunto anterior de ella no salió en este lote, nada posterior sale tampoco.
    if (cortadas.has(conversacionId)) continue;
    const r = await db.runTransaction(async (tx): Promise<'reclamado' | 'incierto' | 'caducado' | 'nada' | 'retenido'> => {
      adjuntoDeLaVuelta = null;
      // Lecturas primero (Firestore exige las lecturas antes de las escrituras): el mensaje y su conversación.
      const [s, conv] = await Promise.all([tx.get(candidato.ref), tx.get(candidato.ref.parent.parent!)]);
      // Si es un adjunto, también su metadato (sha256 y vigencia). Sigue siendo una lectura, antes de cualquier escritura.
      const tipoDelMensaje: unknown = s.exists ? s.get('tipo') : undefined;
      const esAdjunto = typeof tipoDelMensaje === 'string' && TIPOS_DE_ADJUNTO.includes(tipoDelMensaje);
      const objeto: unknown = esAdjunto ? s.get('medio.objeto') : undefined;
      const meta = esAdjunto && typeof objeto === 'string' && objeto.length > 0
        ? await tx.get(db.doc(`tenants/${tenantId}/mediosEnviados/${objeto}`)) : null;
      if (!s.exists || s.get('tenantId') !== tenantId || s.get('direccion') !== 'saliente' || s.get('autor') !== 'persona') return 'nada';
      const estado: unknown = s.get('estadoEnvio');
      // LA CADUCIDAD, antes de mirar de qué línea es: un `pendiente` viejo de otra línea tampoco puede
      // quedarse en la cola ocupando lugar. Sin entregarse, sin contar, reintentable.
      if (estado === 'pendiente') {
        const desde = milisegundosDeMomento(s.get('ts'));
        const vencido = desde === null || ahoraMs - desde >= PENDIENTE_MAXIMO_MS
          || !conv.exists || !ventanaDeMetaAbierta(conv.get('ultimoEntranteEn'), ahoraMs);
        if (vencido) {
          tx.update(candidato.ref, {
            estadoEnvio: 'rechazado', codigoEnvio: CODIGO_CADUCADO, reintentable: true,
            confirmadoEn: Timestamp.fromMillis(ahoraMs), contado: false,
          });
          return 'caducado';
        }
      }
      const de: unknown = s.get('phoneNumberId');
      if (typeof de === 'string' && de !== phoneNumberId) return 'nada';
      if (estado === 'pendiente') {
        if (esAdjunto) {
          // Sin la cabecera del flujo nuevo, o con un adjunto ya en este lote, NO se entrega: queda `pendiente` y caduca
          // como cualquier pendiente (rechazado, `caducado`, reintentable) si nadie lo reclama a tiempo.
          // Un número que sale por el relé tampoco lo lleva (D-A13): la ruta pudo cambiar tras crear el mensaje.
          if (!conAdjuntos || adjuntosEnLote >= MAXIMO_DE_ADJUNTOS_POR_RECLAMO || canal === 'rele') return 'retenido';
          // El metadato tiene que ser de ESTE mensaje, estar guardado y vigente: si no, no sale (caduca).
          const vence = meta?.exists ? milisegundosDeMomento(meta.get('vence')) : null;
          const sha256: unknown = meta?.get('sha256');
          const mime: unknown = s.get('medio.mime');
          const tamano: unknown = s.get('medio.tamano');
          if (!meta?.exists || meta.get('estado') !== 'guardado' || meta.get('mensajeId') !== clave || meta.get('conversacionId') !== conversacionId
              || vence === null || vence <= ahoraMs || typeof sha256 !== 'string' || typeof mime !== 'string'
              || typeof tamano !== 'number') return 'nada';
          const nombre: unknown = s.get('medio.nombre');
          const leyenda: unknown = s.get('texto');
          adjuntoDeLaVuelta = {
            mime, tamano, sha256, voz: s.get('medio.voz') === true,
            ...(typeof nombre === 'string' && nombre !== '' ? { nombre } : {}),
            ...(typeof leyenda === 'string' && leyenda !== '' ? { leyenda } : {}),
          };
        }
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
    if (r === 'caducado') { caducados += 1; continue; }
    if (r === 'retenido') { cortadas.add(conversacionId); continue; }
    if (r !== 'reclamado') continue;
    const datos = candidato.data();
    const base = { mensajeId: clave, conversacionId, claveRele: claveReleDe(tenantId, conversacionId, clave), to: conversacionId.slice(3), canal };
    const dellevado = adjuntoDeLaVuelta as MensajeDeAdjuntoReclamado['adjunto'] | null;
    if (dellevado !== null) {
      adjuntosEnLote += 1;
      mensajes.push({ ...base, texto: '', tipo: datos['tipo'] as MensajeDeAdjuntoReclamado['tipo'], adjunto: dellevado });
    } else {
      mensajes.push({ ...base, texto: String(datos['texto'] ?? ''), tipo: 'text' });
    }
  }
  return { mensajes, inciertos, caducados };
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
      const { mensajes, inciertos, caducados } = await reclamarSalida(ruta, undefined, undefined, peticion.get(CABECERA_DE_ADJUNTOS) === '1');
      // Solo el comercio, cuántos y por qué; nunca el texto, el teléfono ni la clave.
      logger.info('reclamarSalidaPersona', { tenantId: ruta.tenantId, entregados: mensajes.length, adjuntos: mensajes.filter((m) => m.tipo !== 'text').length, inciertos, caducados });
      respuesta.status(200).json({ mensajes });
    } catch (e) {
      const c = (e as { code?: unknown } | null)?.code;
      logger.error('reclamarSalidaPersona: falló', { tenantId: ruta.tenantId, codigo: typeof c === 'string' || typeof c === 'number' ? String(c) : 'desconocido' });
      respuesta.status(503).send('no disponible');
    }
  },
);
