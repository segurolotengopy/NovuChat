/**
 * =============================================================================
 * LO QUE COMPARTEN `tomarConversacion` Y `devolverConversacion` (CORE)
 * =============================================================================
 *
 * Las dos callables recorren el mismo camino y solo difieren en la transacción del medio:
 *
 *   1. sesión                      -> `unauthenticated`
 *   2. persona del comercio PEDIDO, comercio activo y habilitado (`exigirPersonaDe`)
 *   3. la forma del id de conversación (`wa_` y 8 a 15 dígitos) -> `invalid-argument`
 *   4. EL TOPE por usuario (60 por hora y 300 por día) -> `resource-exhausted`
 *   5. la transacción de la callable (lee la conversación, decide, escribe el turno Y la auditoría)
 *
 * AUDITORÍA FALLA-CERRADA Y ATÓMICA. `conversacion_tomada` / `conversacion_devuelta` se escriben en
 * `tenants/{t}/auditoria` DENTRO de la misma transacción que cambia el turno: o quedan las dos cosas
 * o ninguna. Es más fuerte que el patrón de `verComprobante` (auditar y después devolver): acá lo
 * que se protege es un CAMBIO, y un cambio sin rastro no puede existir. Si la auditoría no se puede
 * escribir, el turno no cambia y la persona recibe `unavailable`. Un cambio que no cambia nada
 * (tomar lo que ya se tiene, devolver lo que ya está devuelto) no escribe ni audita: la repetición
 * es inofensiva y no llena el registro. NO usa la bitácora (`registrar()` se traga los errores).
 * El escritor `auditar` de `central/comunes.ts` no se importa (Core no depende de Central): este
 * archivo escribe el MISMO documento `{accion, uid, en, ...detalle}`.
 *
 * LOS REGISTROS (`logger`): comercio, uid, rol, código, motivo y los ÚLTIMOS 4 DÍGITOS del teléfono.
 * Nunca el teléfono entero, nunca el texto de un error.
 *
 * EL TOPE. `topesDeTurno/{uid}`, global (no por comercio), una transacción como la de
 * `topesDeBusqueda`. Es un freno contra una cuenta que toma y devuelve en bucle (cada cambio escribe
 * la conversación y la auditoría), no un límite comercial: 60 por hora y 300 por día sobran para
 * atender a mano. El cupo se consume ANTES de leer la conversación; un rechazo por permiso, por
 * comercio no habilitado o por id mal formado no cuenta. Las reglas de Firestore niegan esta
 * colección a todos por la negación final (solo la escribe el servidor).
 */
import { HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { Timestamp, getFirestore, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { exigirAutenticado } from '../seguridad/autorizacion.js';
import { ID_COMERCIO } from './acceso.js';
import { exigirPersonaDe, type RolDePersona } from './accesoPersona.js';
import {
  ErroresDeTurno, ID_CONVERSACION, UID_DE_PERSONA, type ClaveDeError, type Turno,
} from './turno.js';

// ---------------------------------------------------------------------------
// OPCIONES DE DESPLIEGUE (App Check por entorno, concurrencia solo fuera de staging)
// ---------------------------------------------------------------------------

/**
 * ¿Se exige App Check? En producción sí (la consola ya lo inicializa y manda el token); en staging
 * no (su build no lleva la clave del sitio) y en el emulador tampoco. Una constante y no una
 * variable de entorno, a propósito: el mismo patrón que `APP_CHECK_DE_BUSQUEDA`.
 */
export const APP_CHECK_DE_TURNO = { produccion: true, staging: false } as const;
/** Concurrencia por instancia fuera de staging (cada llamada espera a Firestore, no calcula). */
export const CONCURRENCIA_DE_TURNO = 10;
export const MAX_INSTANCIAS_DE_TURNO = 5;

/**
 * Las opciones de las callables de turno, en una función pura para probarlas. Región como las
 * demás, hasta 5 instancias y NINGUNA mínima. `concurrency` solo FUERA de staging
 * (`CPU_FRACCIONARIA === 'si'`, menos de 1 vCPU: firebase-tools rechaza una concurrencia mayor que
 * 1). Sin variable de entorno nueva: el CI de producción exige un `.env` exacto.
 */
export function opcionesDeTurno(env: Record<string, string | undefined> = process.env): CallableOptions {
  const staging = env['CPU_FRACCIONARIA'] === 'si';
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  return {
    region: REGION,
    maxInstances: MAX_INSTANCIAS_DE_TURNO,
    ...(staging ? {} : { concurrency: CONCURRENCIA_DE_TURNO }),
    enforceAppCheck: emulador ? false : staging ? APP_CHECK_DE_TURNO.staging : APP_CHECK_DE_TURNO.produccion,
  };
}

// ---------------------------------------------------------------------------
// EL TOPE POR USUARIO
// ---------------------------------------------------------------------------

/** Cambios de turno (tomar o devolver) por hora y por día, por usuario. */
export const TOPE_DE_TURNO_POR_HORA = 60;
export const TOPE_DE_TURNO_POR_DIA = 300;

const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Consume un cupo del usuario, en UNA transacción sobre `topesDeTurno/{uid}`: `{hora:'aaaa-mm-ddThh'
 * (La Paz), cambiosHora, dia:'aaaa-mm-dd', cambiosDia, actualizadoEn}`. Devuelve `null` si hay
 * cupo o el motivo (`tope_hora` / `tope_dia`) si ya llegó al tope; en ese caso NO escribe. Un
 * contador ilegible se trata como agotado (falla cerrado) con su propio motivo, `tope_ilegible`.
 */
export async function consumirCupoDeTurno(
  db: Firestore, uid: string, ahoraMs: number,
): Promise<null | 'tope_hora' | 'tope_dia' | 'tope_ilegible'> {
  if (!UID_DE_PERSONA.test(uid)) throw new Error('uid inválido para el tope');
  const sello = new Date(ahoraMs - 4 * 3_600_000).toISOString(); // La Paz, UTC-4 fijo
  const hora = sello.slice(0, 13);
  const dia = sello.slice(0, 10);
  const ref = db.doc(`topesDeTurno/${uid}`);
  return db.runTransaction(async (tx) => {
    const previo = await tx.get(ref);
    const d = previo.exists ? (previo.data() ?? {}) : {};
    const cambiosHora = d['hora'] === hora ? d['cambiosHora'] : 0;
    const cambiosDia = d['dia'] === dia ? d['cambiosDia'] : 0;
    if (!numeroValido(cambiosHora) || !numeroValido(cambiosDia)) return 'tope_ilegible';
    if (cambiosHora >= TOPE_DE_TURNO_POR_HORA) return 'tope_hora';
    if (cambiosDia >= TOPE_DE_TURNO_POR_DIA) return 'tope_dia';
    tx.set(ref, {
      hora, cambiosHora: cambiosHora + 1, dia, cambiosDia: cambiosDia + 1,
      actualizadoEn: Timestamp.fromMillis(ahoraMs),
    });
    return null;
  });
}

// ---------------------------------------------------------------------------
// REGISTROS Y ERRORES
// ---------------------------------------------------------------------------

export type NombreDeCallableDeTurno = 'tomarConversacion' | 'devolverConversacion';

interface DatosDeRegistro {
  tenantId?: unknown; uid?: string; rol?: RolDePersona; conversacionId?: unknown; motivo?: string;
}

/** De un teléfono o un id `wa_<teléfono>`, solo los últimos 4 dígitos (nunca el número entero). */
export function ultimos4(conversacionId: unknown): string | undefined {
  if (typeof conversacionId !== 'string' || !ID_CONVERSACION.test(conversacionId)) return undefined;
  return conversacionId.slice(-4);
}

/**
 * La única forma de registrar: comercio (solo si tiene forma de id), uid (solo si tiene forma de
 * uid), rol, últimos 4 dígitos y un motivo. Nada más.
 */
export function registrar(funcion: NombreDeCallableDeTurno, codigo: string, d: DatosDeRegistro = {}): void {
  const t4 = ultimos4(d.conversacionId);
  const linea = {
    funcion, codigo,
    ...(typeof d.tenantId === 'string' && ID_COMERCIO.test(d.tenantId) ? { tenantId: d.tenantId } : {}),
    ...(d.uid && UID_DE_PERSONA.test(d.uid) ? { uid: d.uid } : {}),
    ...(d.rol ? { rol: d.rol } : {}),
    ...(t4 ? { telefono4: t4 } : {}),
    ...(d.motivo ? { motivo: d.motivo } : {}),
  };
  if (codigo === 'ok') logger.info(funcion, linea);
  else logger.warn(funcion, linea);
}

/** De un error cualquiera, solo su `code` y solo si tiene forma de código. */
export function codigoDe(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  const s = typeof c === 'string' || typeof c === 'number' ? String(c) : '';
  return /^[A-Za-z0-9_./-]{1,40}$/.test(s) ? s : 'desconocido';
}

/** El `HttpsError` de la lista cerrada; `details` solo para quien tiene la conversación. */
export function errorDeTurno(clave: ClaveDeError, details?: Record<string, unknown>): HttpsError {
  const { code, message } = ErroresDeTurno[clave];
  return new HttpsError(code, message, details);
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// LA SALIDA Y LA AUDITORÍA
// ---------------------------------------------------------------------------

/** Lo que las callables devuelven. `turno` en milisegundos; `null` si la conversación nunca tuvo turno. */
export interface SalidaDeTurno {
  turno: Turno | null;
}

/** La acción de auditoría de cada callable (lista cerrada). */
export type AccionDeTurno = 'conversacion_tomada' | 'conversacion_devuelta';

export interface ContextoDeTurno {
  db: Firestore;
  tenantId: string;
  conversacionId: string;
  uid: string;
  rol: RolDePersona;
  ahoraMs: number;
  /** `tenants/{t}/conversaciones/{wa_...}`, armada bajo el comercio pedido. */
  ref: DocumentReference;
}

/**
 * Escribe, DENTRO de la transacción, el documento de auditoría: `{accion, uid, en, rol,
 * conversacionId, resultado:'ok', ...detalle}`. Sin texto de mensajes. Si algo falla acá (la
 * referencia o la escritura) la transacción entera falla y el turno no cambia.
 */
export function auditarEnTransaccion(
  tx: Transaction, c: ContextoDeTurno, accion: AccionDeTurno, detalle: Record<string, string | number | null> = {},
): void {
  const ref = c.db.collection(`tenants/${c.tenantId}/auditoria`).doc();
  tx.create(ref, {
    accion, uid: c.uid, en: Timestamp.fromMillis(c.ahoraMs),
    rol: c.rol, conversacionId: c.conversacionId, resultado: 'ok', ...detalle,
  });
}

/** Un `Turno` (ms) a los campos de Firestore. Los opcionales ausentes no se escriben. */
export function turnoAFirestore(t: Turno): Record<string, unknown> {
  return {
    responde: t.responde, tomadoPor: t.tomadoPor,
    tomadoEn: Timestamp.fromMillis(t.tomadoEn), actividadPersonaEn: Timestamp.fromMillis(t.actividadPersonaEn),
    ...(t.devueltoEn !== undefined ? { devueltoEn: Timestamp.fromMillis(t.devueltoEn) } : {}),
    ...(t.motivoDevolucion !== undefined ? { motivoDevolucion: t.motivoDevolucion } : {}),
  };
}

// ---------------------------------------------------------------------------
// EL CAMINO COMÚN
// ---------------------------------------------------------------------------

/**
 * Recorre los pasos 1 a 4 y entrega el control a `transaccion` (paso 5). Cualquier error que no sea
 * un `HttpsError` nuestro sale como `unavailable`, registrado solo con su `code`.
 */
export async function atenderTurno(
  funcion: NombreDeCallableDeTurno,
  p: CallableRequest,
  transaccion: (c: ContextoDeTurno) => Promise<SalidaDeTurno>,
  db: Firestore = getFirestore(),
  ahoraMs: number = Date.now(),
): Promise<SalidaDeTurno> {
  const datos = esObjeto(p.data) ? p.data : {};
  const tenantId = datos['tenantId'];
  const conversacionId = datos['conversacionId'];
  let uid: string | undefined;
  let rol: RolDePersona | undefined;
  try {
    // 1. Sesión.
    try {
      uid = exigirAutenticado(p);
    } catch (e) {
      registrar(funcion, 'unauthenticated');
      throw e;
    }
    // 2. Persona del comercio pedido, activo y habilitado.
    try {
      ({ rol } = await exigirPersonaDe(p, tenantId, db));
    } catch (e) {
      registrar(funcion, e instanceof HttpsError ? e.code : 'unavailable', { tenantId, uid });
      throw e;
    }
    const t = tenantId as string; // validado por `exigirPersonaDe`
    // 3. La forma del id de conversación; la ruta se ARMA bajo el comercio pedido, el cliente no manda ninguna.
    if (typeof conversacionId !== 'string' || !ID_CONVERSACION.test(conversacionId)) {
      registrar(funcion, 'invalid-argument', { tenantId: t, uid, rol, motivo: 'conversacion' });
      throw errorDeTurno('solicitudInvalida');
    }
    // 4. EL TOPE por usuario.
    const motivoDeTope = await consumirCupoDeTurno(db, uid, ahoraMs);
    if (motivoDeTope !== null) {
      registrar(funcion, 'resource-exhausted', { tenantId: t, uid, rol, conversacionId, motivo: motivoDeTope });
      throw errorDeTurno('tope');
    }
    // 5. La transacción de la callable. Sus rechazos (no existe, ocupada…) se registran acá.
    const ref = db.doc(`tenants/${t}/conversaciones/${conversacionId}`);
    let salida: SalidaDeTurno;
    try {
      salida = await transaccion({ db, tenantId: t, conversacionId, uid, rol, ahoraMs, ref });
    } catch (e) {
      if (e instanceof HttpsError) registrar(funcion, e.code, { tenantId: t, uid, rol, conversacionId });
      throw e;
    }
    registrar(funcion, 'ok', { tenantId: t, uid, rol, conversacionId });
    return salida;
  } catch (e) {
    // Los rechazos ya se registraron donde nacieron. Lo que no es nuestro (Firestore caído, un
    // defecto): solo su `code`, y al navegador el mensaje fijo.
    if (e instanceof HttpsError) throw e;
    registrar(funcion, 'unavailable', { tenantId, uid, rol, conversacionId, motivo: `error_${codigoDe(e)}` });
    throw errorDeTurno('noDisponible');
  }
}
