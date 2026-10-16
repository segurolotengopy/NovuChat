/**
 * =============================================================================
 * CONFIRMAR EL ENVÍO DE UN MENSAJE DE PERSONA — `confirmarSalidaPersona` (CORE, H2-3)
 * =============================================================================
 *
 * El tercer paso de la salida (`salidaPersona.ts`): después de enviar por el relé o por Graph, el flujo
 * n8n «Salida de persona» dice cómo terminó. Misma credencial que el reclamo (la de la ingesta de SU
 * número); el comercio sale de la ruta, nunca del cuerpo.
 *
 * ENTRADA   POST `{ mensajeId, conversacionId, resultado, idMeta?, codigo?, reintentable? }`
 *             resultado  'aceptado' (exige `idMeta`, hasta 120) | 'rechazado' (exige `codigo`, hasta 40
 *                        [A-Za-z0-9_.-]: el de Meta, 131047…, o el del relé, WM-30xx) | 'incierto'
 *             reintentable  opcional, booleano (solo con 'rechazado').
 * SALIDA    200 `{ ok: true, estado }` · 400 (forma) · 401 (credencial) · 404 (no existe, o es de otro
 *           comercio u otro número) · 405 (método) · 409 (transición no permitida).
 *
 * LAS ÚNICAS TRANSICIONES (todo lo demás es 409). Este endpoint es lo único que el token de la ingesta
 * puede hacer sobre un mensaje de persona: el estado, el autor y el código los escribe solo el servidor
 * (las reglas de Firestore los niegan al token y a la consola).
 *
 *   enviando -> aceptado | rechazado | incierto
 *   incierto -> aceptado | rechazado          UNA sola vez (`resueltoDeIncierto`)
 *   el mismo resultado repetido (con el mismo idMeta o código)  -> 200 sin efecto
 *
 * Un `pendiente` NO se confirma (nadie lo reclamó, y confirmar sin reclamar saltaría el candado de «un
 * solo envío»). Un `aceptado` o `rechazado` no cambia nunca más.
 *
 * EL CONTEO. `mensajesPersona` del mes sube cuando el mensaje queda `aceptado` o `incierto` (pudo haber
 * llegado y Meta lo cobra) y NO con `rechazado`; sin doble conteo: un `incierto` que pasa a `aceptado` ya
 * estaba contado (`contado: true`), y uno que pasa a `rechazado` se resta una vez. No toca `salientes`,
 * `mensajesVentana`, el bloque de 25 ni los umbrales: cero mensajes por conversación.
 * El −1 de un `incierto` que resulta `rechazado` cae en el mes de la confirmación, no en el del envío
 * (aceptado). PENDIENTE declarado: ningún cálculo de franquicia lee todavía `mensajesPersona`; lo asume
 * Core bloque 2.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada, type Ruta } from '../seguridad/firma.js';
import { ID_COMERCIO } from './acceso.js';
import { CLAVE_DE_ENVIO, CODIGO_DE_ENVIO, ID_META, sumarMensajePersona } from './salidaPersona.js';
import { ID_CONVERSACION } from './turno.js';

export type ResultadoDeEnvio = 'aceptado' | 'rechazado' | 'incierto';
const RESULTADOS: readonly ResultadoDeEnvio[] = ['aceptado', 'rechazado', 'incierto'];

export interface Confirmacion {
  mensajeId: string;
  conversacionId: string;
  resultado: ResultadoDeEnvio;
  idMeta?: string;
  codigo?: string;
  reintentable?: boolean;
}

/** La confirmación validada, o `null` si la forma no es exactamente la del contrato. */
export function leerConfirmacion(cuerpo: unknown): Confirmacion | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return null;
  const b = cuerpo as Record<string, unknown>;
  const { mensajeId, conversacionId, resultado, idMeta, codigo, reintentable } = b;
  if (typeof mensajeId !== 'string' || !CLAVE_DE_ENVIO.test(mensajeId)) return null;
  if (typeof conversacionId !== 'string' || !ID_CONVERSACION.test(conversacionId)) return null;
  if (typeof resultado !== 'string' || !(RESULTADOS as readonly string[]).includes(resultado)) return null;
  if (reintentable !== undefined && typeof reintentable !== 'boolean') return null;
  const c: Confirmacion = { mensajeId, conversacionId, resultado: resultado as ResultadoDeEnvio };
  if (resultado === 'aceptado') {
    if (typeof idMeta !== 'string' || !ID_META.test(idMeta)) return null;
    c.idMeta = idMeta;
  } else if (resultado === 'rechazado') {
    if (typeof codigo !== 'string' || !CODIGO_DE_ENVIO.test(codigo)) return null;
    c.codigo = codigo;
    if (reintentable !== undefined) c.reintentable = reintentable;
  }
  return c;
}

export type SalidaDeConfirmacion =
  | { codigo: 200; estado: string }
  | { codigo: 404 | 409 };

/** La transacción de la confirmación (exportada para las pruebas). */
export async function confirmarSalida(
  ruta: Ruta, c: Confirmacion, db: Firestore = getFirestore(), ahoraMs: number = Date.now(),
): Promise<SalidaDeConfirmacion> {
  const { tenantId, phoneNumberId } = ruta;
  const ref = db.doc(`tenants/${tenantId}/conversaciones/${c.conversacionId}/mensajes/${c.mensajeId}`);
  return db.runTransaction(async (tx): Promise<SalidaDeConfirmacion> => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('tenantId') !== tenantId || s.get('direccion') !== 'saliente' || s.get('autor') !== 'persona') {
      return { codigo: 404 };
    }
    const de: unknown = s.get('phoneNumberId');
    if (typeof de === 'string' && de !== phoneNumberId) return { codigo: 404 };

    const estado: unknown = s.get('estadoEnvio');
    // El mismo resultado, repetido con los mismos datos: inofensivo.
    if (estado === c.resultado) {
      if (c.resultado === 'aceptado' && s.get('idMeta') !== c.idMeta) return { codigo: 409 };
      if (c.resultado === 'rechazado' && s.get('codigoEnvio') !== c.codigo) return { codigo: 409 };
      return { codigo: 200, estado: c.resultado };
    }
    const desdeEnviando = estado === 'enviando';
    const desdeIncierto = estado === 'incierto' && s.get('resueltoDeIncierto') !== true;
    if (!desdeEnviando && !desdeIncierto) return { codigo: 409 };
    if (desdeIncierto && c.resultado === 'incierto') return { codigo: 409 }; // inalcanzable (arriba), por claridad

    const contado = s.get('contado') === true;
    const ts = Timestamp.fromMillis(ahoraMs);
    const cambios: Record<string, unknown> = { estadoEnvio: c.resultado, confirmadoEn: ts };
    if (desdeIncierto) cambios['resueltoDeIncierto'] = true;
    if (c.resultado === 'aceptado') cambios['idMeta'] = c.idMeta;
    if (c.resultado === 'rechazado') {
      cambios['codigoEnvio'] = c.codigo;
      if (c.reintentable !== undefined) cambios['reintentable'] = c.reintentable;
    }
    // El conteo: aceptado e incierto cuentan UNA vez; rechazado no (y si ya contaba como incierto, se resta).
    const cuenta = c.resultado !== 'rechazado';
    if (cuenta && !contado) { cambios['contado'] = true; sumarMensajePersona(tx, db, tenantId, ahoraMs, 1); }
    if (!cuenta && contado) { cambios['contado'] = false; sumarMensajePersona(tx, db, tenantId, ahoraMs, -1); }
    tx.update(ref, cambios);
    return { codigo: 200, estado: c.resultado };
  });
}

export const confirmarSalidaPersona = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false, // servidor a servidor
    maxInstances: 5,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (!ID_COMERCIO.test(ruta.tenantId)) { respuesta.status(404).send('numero no asignado'); return; }
    const c = leerConfirmacion(peticion.body);
    if (!c) { respuesta.status(400).send('solicitud invalida'); return; }
    try {
      const r = await confirmarSalida(ruta, c);
      logger.info('confirmarSalidaPersona', { tenantId: ruta.tenantId, resultado: c.resultado, codigo: r.codigo });
      if (r.codigo === 200) { respuesta.status(200).json({ ok: true, estado: r.estado }); return; }
      respuesta.status(r.codigo).send(r.codigo === 404 ? 'no existe' : 'transicion no permitida');
    } catch (e) {
      const k = (e as { code?: unknown } | null)?.code;
      logger.error('confirmarSalidaPersona: falló', { tenantId: ruta.tenantId, codigo: typeof k === 'string' || typeof k === 'number' ? String(k) : 'desconocido' });
      respuesta.status(503).send('no disponible');
    }
  },
);
