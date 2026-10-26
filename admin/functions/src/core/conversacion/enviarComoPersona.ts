/**
 * =============================================================================
 * ESCRIBIR COMO PERSONA — `enviarComoPersona` (CORE, H2-3)
 * =============================================================================
 *
 * H2 (contrato único del 16/10/2026, §2, §4, §7, §8 y §9). Una persona del comercio que TIENE la
 * conversación le escribe un TEXTO al cliente, dentro de la ventana de 24 h de Meta.
 *
 * ESTA FUNCIÓN NO ENVÍA A META. Valida, escribe el mensaje saliente como `pendiente` y toca el
 * TIMBRE del flujo n8n «Salida de persona» (`salidaPersona.ts`); el flujo lo reclama
 * (`reclamarSalidaPersona`), lo envía por el relé B9 o por Graph y lo confirma
 * (`confirmarSalidaPersona`). Por eso el token de Meta y la clave del relé viven solo en n8n: acá no
 * hay ninguno.
 *
 * ENTRADA   `{tenantId, conversacionId, texto, claveIdempotencia}`; el servidor ignora cualquier otra
 *           clave y NUNCA recibe un teléfono ni una ruta: el destino (`to`) sale del id de la
 *           conversación, que la consola no puede cambiar a la vez que el comercio.
 * SALIDA    `{estado, mensajeId, codigoEnvio?, reintentable?}`. `estado` es el del mensaje: al crear,
 *           `pendiente` (se devuelve antes de que Meta responda); en un reintento con la misma clave,
 *           el guardado, sin volver a tocar el timbre.
 *
 * LO QUE GARANTIZA, cada línea con una prueba que la niega (`pruebas/core/enviar-como-persona.test.ts`):
 *
 *  - Quién llama: administrador u operador de ESE comercio (el soporte NO), comercio activo y
 *    habilitado EN EL SERVIDOR (bandera `consolaConversaciones === 'nueva'`, no Bellido) y, además,
 *    `cuentaVigenteDe`: a diferencia de tomar y devolver, escribir le habla a un cliente de verdad en
 *    nombre del comercio, y un operador dado de baja con el token todavía vivo (hasta una hora) no puede
 *    hacerlo. Cuesta una lectura de Auth por envío; se acepta.
 *  - El TURNO de ESA persona, vigente (no vencido por inactividad ni por ventana).
 *  - Texto de 1 a 1.000 caracteres, sin controles; clave de 16 a 128 caracteres.
 *  - La ventana: `ultimoEntranteEn` + 24 h con margen de 60 s. NUNCA `atencion.ventanaVenceEn` (esa es la
 *    de facturación). Sin dato, cerrada. Enviar NO abre ni extiende la ventana de Meta.
 *  - El BLOQUEO DE 45 s: tras un entrante que nadie respondió, no se envía hasta pasados 45 s (la
 *    carrera de 5 a 20 s entre que el asistente leyó el estado y el modelo contesta). Una vez que la
 *    persona respondió a ese entrante, escribe sin esperar. NO se aplica si el turno ya estaba tomado
 *    ANTES del entrante (`turno.tomadoEn < ultimoEntranteEn - 60 s`): la ingesta ya calló al asistente y no
 *    hay carrera. Eso relaja la letra del contrato §9 (que bloqueaba siempre); se decidió en la revisión de
 *    #510. Si el modelo ya respondió y la persona envía dentro de los 45 s con un turno reciente, sigue bloqueando.
 *  - LA CLAVE ESTÁ ATADA a (conversación, persona, hash del texto): reusarla con otro texto u otra
 *    persona es `failed-precondition`. La atadura a la conversación es la RUTA del documento
 *    (`conversaciones/{id}/mensajes/{clave}`): la misma clave en OTRA conversación crea un mensaje nuevo
 *    e independiente, no una colisión. Con los mismos datos devuelve lo guardado.
 *    El mensaje se crea con `tx.create` en `mensajes/{clave}`: dos envíos a la vez con la misma clave,
 *    gana uno.
 *  - LOS TOPES, que se leen del plan (`limitesDePersona`, inyectada) y se cuentan en la MISMA
 *    transacción que crea el mensaje: por conversación y ventana de 24 h (10 con titularidad
 *    `novuchat`, 25 solo con tarifa `estandar` Y titularidad `comercio`), por minuto (por persona y por
 *    comercio) y 300 por día y comercio. Se rechazan con `resource-exhausted` y
 *    `details.tope: 'minuto'|'conversacion'|'dia'` (`esperaSegundos` solo en el de minuto): la consola
 *    NO lee el `message`. Un rechazo no consume cupo.
 *  - AUDITORÍA FALLA-CERRADA Y ATÓMICA (`mensaje_persona_creado`): en la misma transacción que el
 *    mensaje; sin el texto, con `telefono4`. Si no se puede escribir, no hay mensaje.
 *  - Lo que NO toca: `mensajesVentana`, el bloque de 25, los umbrales 50/100, `ventanaVenceEn` ni
 *    `atencionEstado`. Actualiza `ultimoEn`, `ultimoMensaje`, `ultimoSalientePersonaEn` y
 *    `turno.actividadPersonaEn` (enviar cuenta como actividad: renueva los 30 minutos).
 *
 * EL CANAL (H2-3b). La conversación guarda el `phoneNumberId` de la línea por la que escribió el cliente
 * (lo escribe la ingesta desde la ruta autenticada). Con él, sale por ESA ruta, que debe ser del mismo
 * comercio y estar activa con alias secreto; si no corresponde a ninguna ruta activa del comercio,
 * `failed-precondition` con mensaje fijo y sin enviar (nunca se cae a otra línea). Sin él (conversaciones
 * anteriores a H2-3b) se mantiene lo de antes: exactamente UNA ruta activa; con ninguna o varias, el
 * mismo rechazo. La ruta elegida queda en el mensaje (`phoneNumberId`) para que solo el flujo de ESE
 * número lo reclame.
 *
 * CORE NO IMPORTA CENTRAL. Los topes (`limitesDePersona`), la tarifa (`tarifaDe`) y la titularidad
 * (`titularidadDe`) viven en Central y entran por inyección (`crearEnviarComoPersona(deps)`, que arma
 * `central/cuenta/enviarComoPersona.ts`). Así el plan es la única fuente de las cifras y esta capa no depende de nada de arriba.
 *
 * COSTO por envío efectivo (0 mensajes por conversación del asistente; el mensaje de la persona lo
 * decide ella): 1 lectura de Auth; lecturas de la ficha, de la cuenta, de las rutas, de la conversación,
 * del mensaje y de los 2 contadores (6 a 7); escrituras del mensaje, la conversación, los 2 contadores
 * y la auditoría (5); más el POST del timbre. Un reintento con la misma clave: sin escrituras.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { exigirAutenticado } from '../seguridad/autorizacion.js';
import { cuentaVigenteDe } from '../seguridad/vigencia.js';
import { exigirComercioHabilitado, exigirRolDePersona, type RolDePersona } from './accesoPersona.js';
import { camposDeMensajeIndexado } from './derivados.js';
import {
  BLOQUEO_DE_CARRERA_MS, CLAVE_DE_ENVIO, SECRETO_DE_SALIDA_PERSONA, TEXTO_MAXIMO,
  huellaDeEnvio, tocarTimbre as tocarTimbreReal, type TocarTimbre,
} from './salidaPersona.js';
import {
  ID_CONVERSACION, MARGEN_ENVIO_MS, personaPuedeEscribirDeFicha, VENTANA_META_MS, milisegundosDeMomento, turnoEfectivo, ventanaDeMetaAbierta,
} from './turno.js';
import {
  auditarEnTransaccion, codigoDe, errorDeTurno, opcionesDeTurno, registrar, type ContextoDeTurno,
} from './turnoServidor.js';

// ---------------------------------------------------------------------------
// LO QUE LLEGA POR INYECCIÓN (lo arma `index.ts`)
// ---------------------------------------------------------------------------

/** Los topes que el plan fija (ver `limitesDePersona` en `central/cuenta/planes.ts`). */
export interface LimitesDeEnvio { porConversacion: number; porDia: number; porMinuto: number }

export interface DependenciasDeEnvio {
  limitesDePersona(plan: unknown, tarifa: 'estandar' | 'meta_incluido', titularidad: 'novuchat' | 'comercio'): LimitesDeEnvio;
  titularidadDe(ruta: Record<string, unknown> | null | undefined): 'novuchat' | 'comercio';
  tarifaDe(cuenta: Record<string, unknown> | null | undefined): 'estandar' | 'meta_incluido';
}

/** Lo que cambia en las pruebas: la base, el reloj, el timbre y la vigencia de la cuenta. */
export interface EntornoDeEnvio {
  db: Firestore;
  ahoraMs: number;
  tocarTimbre: TocarTimbre;
  cuentaVigente: typeof cuentaVigenteDe;
}

// ---------------------------------------------------------------------------
// ERRORES: códigos y mensajes fijos, sin detalle
// ---------------------------------------------------------------------------

export const ErroresDeEnvio = {
  canal: { code: 'failed-precondition', message: 'El canal de envío de este comercio no está disponible.' },
  sinTurno: { code: 'failed-precondition', message: 'Para escribir, primero tome la conversación.' },
  esperar: { code: 'failed-precondition', message: 'Espere unos segundos: el asistente puede estar respondiendo.' },
  claveUsada: { code: 'failed-precondition', message: 'Esa clave de envío ya se usó con otro mensaje.' },
  topeMinuto: { code: 'resource-exhausted', message: 'Está enviando demasiado rápido. Espere unos segundos.' },
  topeConversacion: { code: 'resource-exhausted', message: 'Llegó al tope de mensajes de persona para esta conversación.' },
  topeDia: { code: 'resource-exhausted', message: 'El comercio llegó al tope diario de mensajes de persona.' },
} as const;

type ClaveDeErrorDeEnvio = keyof typeof ErroresDeEnvio;
const errorDeEnvio = (clave: ClaveDeErrorDeEnvio, details?: Record<string, unknown>): HttpsError =>
  new HttpsError(ErroresDeEnvio[clave].code, ErroresDeEnvio[clave].message, details);

/** Qué mensaje quedó guardado: lo que se devuelve y lo que dice la prueba. */
export interface SalidaDeEnvio {
  estado: string;
  mensajeId: string;
  codigoEnvio?: string;
  reintentable?: boolean;
}

interface Creado extends SalidaDeEnvio { repetido: boolean }

// ---------------------------------------------------------------------------
// LOS CONTADORES
// ---------------------------------------------------------------------------

const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const MINUTO_MS = 60_000;
/** Cuánto antes del entrante tiene que haber sido tomada la conversación para no haber carrera. */
const MARGEN_TURNO_PREVIO_MS = 60_000;
/** El minuto en UTC (`aaaa-mm-ddThh:mm`) y el día de La Paz (UTC-4 fijo), como los otros contadores. */
const minutoDe = (ms: number): string => new Date(ms).toISOString().slice(0, 16);
const diaDe = (ms: number): string => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
/** Segundos que faltan para que cambie el minuto (al menos 1). */
const esperaHastaElMinuto = (ms: number): number => Math.max(1, Math.ceil((MINUTO_MS - (ms % MINUTO_MS)) / 1000));

// ---------------------------------------------------------------------------
// LA TRANSACCIÓN
// ---------------------------------------------------------------------------

interface DatosDeEnvio { texto: string; clave: string; huella: string }
interface Canal { phoneNumberId: string; alias: string }

/** La transacción del envío (exportada para las pruebas). */
export async function crearMensajeDePersona(
  c: ContextoDeTurno, d: DatosDeEnvio, canal: Canal, limites: LimitesDeEnvio,
): Promise<Creado> {
  const { db, tenantId, uid, ahoraMs, ref } = c;
  const refMensaje = ref.collection('mensajes').doc(d.clave);
  const refUsuario = db.doc(`topesDeEnvio/u_${uid}`);
  const refComercio = db.doc(`topesDeEnvio/t_${tenantId}`);

  return db.runTransaction<Creado>(async (tx) => {
    const [conv, previo, tUsuario, tComercio, fichaComercio] = await tx.getAll(
      ref, refMensaje, refUsuario, refComercio, db.doc(`tenants/${tenantId}`),
    );
    // La salida publicada se vuelve a comprobar DENTRO de la transacción (si se apagó tras la lectura previa, no se
    // escribe nada). Va antes que la clave ya usada: un reintento tampoco sale por una salida que ya no existe.
    if (!personaPuedeEscribirDeFicha(fichaComercio?.data())) throw errorDeTurno('sinSalida');
    if (!conv || !conv.exists) throw errorDeTurno('noExiste');

    // 1. LA CLAVE YA USADA. Con los mismos datos es un reintento: lo guardado, sin tocar nada ni volver
    //    a llamar al timbre. Con otros datos, nunca. Va antes que el turno y los topes: un reintento
    //    no vuelve a pasar por el cupo.
    if (previo && previo.exists) {
      if (previo.get('huellaEnvio') !== d.huella || previo.get('autor') !== 'persona' || previo.get('autorUid') !== uid) {
        throw errorDeEnvio('claveUsada');
      }
      const codigo: unknown = previo.get('codigoEnvio');
      const reint: unknown = previo.get('reintentable');
      return {
        estado: String(previo.get('estadoEnvio') ?? 'pendiente'), mensajeId: d.clave, repetido: true,
        ...(typeof codigo === 'string' ? { codigoEnvio: codigo } : {}),
        ...(typeof reint === 'boolean' ? { reintentable: reint } : {}),
      };
    }

    // 1b. LA LÍNEA. Si la conversación ya tiene `phoneNumberId` y no es el del canal elegido (la
    //     línea cambió entre la lectura del canal y esta transacción), no se envía. Sin lecturas extra.
    const lineaActual: unknown = conv.get('phoneNumberId');
    if (lineaActual !== undefined && lineaActual !== canal.phoneNumberId) throw errorDeEnvio('canal');

    // 2. EL TURNO de ESA persona, vigente.
    const ultimoEntranteEn: unknown = conv.get('ultimoEntranteEn');
    const { veredicto, turno } = turnoEfectivo(conv.get('turno'), { ultimoEntranteEn }, ahoraMs);
    if (veredicto.motivo === 'ventana') throw errorDeTurno('ventanaCerrada');
    if (veredicto.motivo !== 'tomado' || turno === null) throw errorDeEnvio('sinTurno');
    if (turno.tomadoPor !== uid) throw errorDeTurno('ocupada');

    // 3. LA VENTANA de Meta (con margen de 60 s), contada desde el último ENTRANTE.
    if (!ventanaDeMetaAbierta(ultimoEntranteEn, ahoraMs, MARGEN_ENVIO_MS)) throw errorDeTurno('ventanaCerrada');

    // 4. EL BLOQUEO DE 45 s tras un entrante sin responder.
    const ultimoEntrante = milisegundosDeMomento(ultimoEntranteEn) as number; // la ventana abierta lo garantiza
    const ultimoDePersona = milisegundosDeMomento(conv.get('ultimoSalientePersonaEn'));
    // EXCEPCIÓN (ronda de revisión de #510, relaja la letra del contrato §9): si la persona ya tenía el turno
    // ANTES del entrante (más de 60 s antes), la ingesta de ese entrante ya calló al asistente y no hay carrera
    // que cubrir. Si el turno es más reciente, o casi simultáneo, el bloqueo sigue.
    const turnoAnteriorAlEntrante = turno.tomadoEn < ultimoEntrante - MARGEN_TURNO_PREVIO_MS;
    if (!turnoAnteriorAlEntrante
        && (ultimoDePersona === null || ultimoDePersona < ultimoEntrante) && ahoraMs < ultimoEntrante + BLOQUEO_DE_CARRERA_MS) {
      throw errorDeEnvio('esperar', {
        motivo: 'espera', esperaSegundos: Math.max(1, Math.ceil((ultimoEntrante + BLOQUEO_DE_CARRERA_MS - ahoraMs) / 1000)),
      });
    }

    // 5. LOS TOPES, leídos del plan y contados acá, en la misma transacción que el mensaje.
    const envio = conv.get('envioPersona') as DocumentData | undefined;
    let desdeVentana = ahoraMs;
    let enVentana = 0;
    if (envio !== undefined) {
      const desde = milisegundosDeMomento(envio['desde']);
      if (desde === null || !numeroValido(envio['n'])) throw errorDeTurno('noDisponible'); // contador ilegible: cerrado
      if (ahoraMs < desde + VENTANA_META_MS) { desdeVentana = desde; enVentana = envio['n'] as number; }
    }
    if (enVentana >= limites.porConversacion) throw errorDeEnvio('topeConversacion', { tope: 'conversacion' });

    const minuto = minutoDe(ahoraMs);
    const dia = diaDe(ahoraMs);
    const u = tUsuario && tUsuario.exists ? (tUsuario.data() ?? {}) : {};
    const t = tComercio && tComercio.exists ? (tComercio.data() ?? {}) : {};
    const uMin = u['min'] === minuto ? u['n'] : 0;
    const tMin = t['min'] === minuto ? t['nMin'] : 0;
    const tDia = t['dia'] === dia ? t['nDia'] : 0;
    if (!numeroValido(uMin) || !numeroValido(tMin) || !numeroValido(tDia)) throw errorDeTurno('noDisponible');
    if (uMin >= limites.porMinuto || tMin >= limites.porMinuto) {
      throw errorDeEnvio('topeMinuto', { tope: 'minuto', esperaSegundos: esperaHastaElMinuto(ahoraMs) });
    }
    if (tDia >= limites.porDia) throw errorDeEnvio('topeDia', { tope: 'dia' });

    // 6. LAS ESCRITURAS, todas o ninguna.
    const ts = Timestamp.fromMillis(ahoraMs);
    tx.create(refMensaje, {
      direccion: 'saliente', tipo: 'text', texto: d.texto, ts,
      autor: 'persona', autorUid: uid, estadoEnvio: 'pendiente',
      // El destino sale del id de la conversación (la ruta la armó el servidor), nunca del navegador.
      to: c.conversacionId.slice(3),
      phoneNumberId: canal.phoneNumberId,
      huellaEnvio: d.huella,
      ...camposDeMensajeIndexado(d.texto, tenantId),
    });
    tx.update(ref, {
      ultimoMensaje: d.texto.slice(0, 300), ultimoEn: ts, ultimoSalientePersonaEn: ts,
      'turno.actividadPersonaEn': ts,
      envioPersona: { desde: Timestamp.fromMillis(desdeVentana), n: enVentana + 1 },
    });
    tx.set(refUsuario, { min: minuto, n: uMin + 1, actualizadoEn: ts });
    tx.set(refComercio, { min: minuto, nMin: tMin + 1, dia, nDia: tDia + 1, actualizadoEn: ts });
    auditarEnTransaccion(tx, c, 'mensaje_persona_creado', { mensajeId: d.clave, largo: d.texto.length });
    return { estado: 'pendiente', mensajeId: d.clave, repetido: false };
  });
}

// ---------------------------------------------------------------------------
// EL CAMINO COMÚN
// ---------------------------------------------------------------------------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Controles de texto salvo el salto de línea y la tabulación: un mensaje de persona no los necesita.
const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// El id de un documento de Firestore no puede ser `__algo__` (reservado).
const ID_RESERVADO = /^__.*__$/;

/**
 * La ruta de salida del comercio, activa y con alias; si no, `null`.
 *  - Con `phoneNumberId` (el de la conversación, que escribe la ingesta): ESA ruta, que debe ser
 *    del mismo comercio (la búsqueda ya es por `tenantId`) y estar activa. Si no, `null`: nunca se
 *    cae a otra línea.
 *  - Sin él (conversaciones anteriores a H2-3b): exactamente UNA ruta activa, como antes.
 */
async function canalDe(
  db: Firestore, tenantId: string, phoneNumberId?: string,
): Promise<{ canal: Canal; ruta: DocumentData } | null> {
  const rutas = await db.collection('rutasWhatsApp').where('tenantId', '==', tenantId).get();
  const activas = rutas.docs.filter((r) => r.get('estado') === 'activo'
    && typeof r.get('aliasSecreto') === 'string' && String(r.get('aliasSecreto')).length > 0);
  if (phoneNumberId !== undefined) {
    const propia = activas.find((r) => r.id === phoneNumberId);
    return propia ? { canal: { phoneNumberId: propia.id, alias: String(propia.get('aliasSecreto')) }, ruta: propia.data() } : null;
  }
  if (activas.length !== 1) return null;
  const r = activas[0]!;
  return { canal: { phoneNumberId: r.id, alias: String(r.get('aliasSecreto')) }, ruta: r.data() };
}

export async function atenderEnvio(
  p: CallableRequest,
  deps: DependenciasDeEnvio,
  entorno: Partial<EntornoDeEnvio> = {},
): Promise<SalidaDeEnvio> {
  const db = entorno.db ?? getFirestore();
  const ahoraMs = entorno.ahoraMs ?? Date.now();
  const tocar = entorno.tocarTimbre ?? tocarTimbreReal;
  const vigente = entorno.cuentaVigente ?? cuentaVigenteDe;
  const funcion = 'enviarComoPersona' as const;

  const datos = esObjeto(p.data) ? p.data : {};
  const { tenantId, conversacionId, texto, claveIdempotencia } = datos;
  let uid: string | undefined;
  let rol: RolDePersona | undefined;
  try {
    // 1. Sesión.
    try { uid = exigirAutenticado(p); } catch (e) { registrar(funcion, 'unauthenticated'); throw e; }
    // 2. El rol DE ESTE comercio, del token. El soporte no está en la lista.
    try { rol = exigirRolDePersona(p, tenantId); } catch (e) {
      registrar(funcion, e instanceof HttpsError ? e.code : 'unavailable', { tenantId, uid });
      throw e;
    }
    const t = tenantId as string;
    // 3. La forma de la entrada: antes de leer nada.
    const invalida = (motivo: string): HttpsError => {
      registrar(funcion, 'invalid-argument', { tenantId: t, uid, rol, motivo });
      return errorDeTurno('solicitudInvalida');
    };
    if (typeof conversacionId !== 'string' || !ID_CONVERSACION.test(conversacionId)) throw invalida('conversacion');
    if (typeof texto !== 'string' || texto.trim().length === 0 || texto.length > TEXTO_MAXIMO || CONTROLES.test(texto)) {
      throw invalida('texto');
    }
    if (typeof claveIdempotencia !== 'string' || !CLAVE_DE_ENVIO.test(claveIdempotencia) || ID_RESERVADO.test(claveIdempotencia)) {
      throw invalida('clave');
    }
    // 4. La cuenta sigue vigente (habilitada, con el rol, sesión posterior a la última revocación).
    const authTime = p.auth?.token?.['auth_time'];
    let ok: boolean;
    try {
      ok = await vigente(uid, typeof authTime === 'number' ? authTime : Number.NaN, rol, t);
    } catch (e) {
      registrar(funcion, 'unavailable', { tenantId: t, uid, rol, motivo: `auth_${codigoDe(e)}` });
      throw errorDeTurno('noDisponible');
    }
    if (!ok) {
      registrar(funcion, 'permission-denied', { tenantId: t, uid, rol, motivo: 'cuenta_no_vigente' });
      throw errorDeTurno('sinPermiso');
    }
    // 5. El comercio: activo y habilitado (bandera `nueva`, no Bellido).
    try { await exigirComercioHabilitado(t, db); } catch (e) {
      registrar(funcion, e instanceof HttpsError ? e.code : 'unavailable', { tenantId: t, uid, rol });
      throw e;
    }
    // 6. El canal y los topes del plan.
    //    La línea es la de la conversación (`phoneNumberId`, escrito por la ingesta): con dos líneas
    //    sale por la línea del último mensaje entrante del cliente. Una lectura más (la transacción la
    //    vuelve a leer para decidir; esta solo elige el canal).
    const lineaDe: unknown = (await db.doc(`tenants/${t}/conversaciones/${conversacionId}`).get()).get('phoneNumberId');
    // Presente pero malformado (no es texto de 6 a 25 dígitos): rechaza, no se trata como ausente.
    const lineaMala = lineaDe !== undefined && (typeof lineaDe !== 'string' || !/^[0-9]{6,25}$/.test(lineaDe));
    const encontrado = lineaMala ? null : await canalDe(db, t, typeof lineaDe === 'string' ? lineaDe : undefined);
    if (!encontrado) {
      registrar(funcion, 'failed-precondition', { tenantId: t, uid, rol, motivo: 'canal' });
      throw errorDeEnvio('canal');
    }
    const cuenta = ((await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {}) as Record<string, unknown>;
    const limites = deps.limitesDePersona(cuenta['plan'], deps.tarifaDe(cuenta), deps.titularidadDe(encontrado.ruta));

    // 7. La transacción. Sus rechazos (turno, ventana, topes…) se registran acá.
    const ctx: ContextoDeTurno = {
      db, tenantId: t, conversacionId, uid, rol, ahoraMs, ref: db.doc(`tenants/${t}/conversaciones/${conversacionId}`),
    };
    let creado: Creado;
    try {
      creado = await crearMensajeDePersona(
        ctx, { texto, clave: claveIdempotencia, huella: huellaDeEnvio(conversacionId, uid, texto) }, encontrado.canal, limites,
      );
    } catch (e) {
      if (e instanceof HttpsError) {
        const tope = esObjeto(e.details) && typeof e.details['tope'] === 'string' ? `tope_${e.details['tope']}` : undefined;
        registrar(funcion, e.code, { tenantId: t, uid, rol, conversacionId, ...(tope ? { motivo: tope } : {}) });
      }
      throw e;
    }

    // 8. El TIMBRE, solo si el mensaje es nuevo. Su fallo no falla el envío: queda `pendiente`.
    let timbre = 'repetido';
    if (!creado.repetido) {
      const sono = await tocar(encontrado.canal.alias, encontrado.canal.phoneNumberId, ahoraMs);
      timbre = sono ? 'timbre_ok' : 'timbre_fallo';
    }
    registrar(funcion, 'ok', { tenantId: t, uid, rol, conversacionId, motivo: timbre });
    return {
      estado: creado.estado, mensajeId: creado.mensajeId,
      ...(creado.codigoEnvio !== undefined ? { codigoEnvio: creado.codigoEnvio } : {}),
      ...(creado.reintentable !== undefined ? { reintentable: creado.reintentable } : {}),
    };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    registrar(funcion, 'unavailable', { tenantId, uid, rol, conversacionId, motivo: `error_${codigoDe(e)}` });
    throw errorDeTurno('noDisponible');
  }
}

/**
 * La callable. Se arma con los topes, la tarifa y la titularidad que le pasa `index.ts`: Core no importa
 * Central. Región y App Check como `tomarConversacion` (App Check solo en producción), más el secreto del
 * timbre. Agrega una Function: la etiqueta que la lleve exige rama de reversión lista, el secreto creado y
 * el invocador público (`scripts/nube-visor.sh`, que exige la etiqueta ya desplegada: va tras el despliegue de la etiqueta).
 */
export function crearEnviarComoPersona(deps: DependenciasDeEnvio) {
  return onCall(
    { ...opcionesDeTurno(process.env), secrets: [SECRETO_DE_SALIDA_PERSONA] },
    (p: CallableRequest) => atenderEnvio(p, deps),
  );
}

