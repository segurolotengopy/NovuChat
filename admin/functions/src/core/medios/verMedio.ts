/**
 * =============================================================================
 * VER UN MEDIO ENTRANTE — `verMedio`, los bytes por una callable con permisos
 * =============================================================================
 *
 * Los medios entrantes (foto, PDF, audio) se guardan 90 días en Storage
 * (`guardarMedio.ts`) y `storage.rules` niega todo acceso directo, también al
 * administrador. Esta callable es la ÚNICA puerta para verlos u oírlos en la
 * consola: la piden el administrador y el operador de ESE comercio y el soporte
 * de NovuChat mientras el comercio le conserve una ventana vigente (contrato M3
 * y contrato v2 §8.3 del 30/10/2026, decisión de Andres; reemplaza a la D4 de
 * `docs/arquitectura/core.md`, «soporte no ve los medios»). Devuelve los bytes,
 * nunca una URL: una URL firmada se copia, se reenvía y vive hasta que vence.
 *
 * MODELO: `modulos/cobros/verComprobante.ts`. Core no importa módulos ni Central
 * (`fronteras.test.ts`), así que lo que se necesita de ahí es COPIA DECLARADA:
 * `opcionesDe…` con App Check por entorno, `consumirCupo…` (sobre OTRA colección,
 * `topesDeMedios`, ya cerrada en las reglas y declarada en
 * `COLECCIONES_CERRADAS_DEL_CORE`), `registrarRechazo`, `codigoDe`, la expresión
 * de `ID_TENANT` de `central/comunes.ts` y su `auditar` (aquí `auditarVista`).
 * Si cambia una de las dos, cambia la otra.
 *
 * LO QUE ESTA FUNCIÓN GARANTIZA, y cada línea tiene una prueba que la niega
 * (`pruebas/core/medios/ver-medio.test.ts`):
 *
 *  - **El cliente nunca manda una ruta.** Manda EXACTAMENTE
 *    `{tenantId, conversacionId, idMeta, accion}` (`accion`: `'ver'` o `'descargar'`,
 *    adenda de seguridad §7.7; se audita como `medio_visto` o `medio_descargado`); cualquier otra clave es
 *    `invalid-argument`. La ruta sale de `tenants/{t}/mediosRecibidos/{sha256(idMeta)}`
 *    y pasa por `rutaValidaDeMedio` (ESTE comercio, ESTE medio, día con forma de
 *    fecha, extensión de la lista, sin `..`). Una ruta ajena no llega al almacén.
 *  - **El metadato tiene que ser de ESA conversación** (`conversacionId` e `idMeta`
 *    iguales a los pedidos) y estar `guardado`; `anotado` y `pendiente` son
 *    `failed-precondition` con el detalle `'anotado'` o `'pendiente'`; vencido
 *    (`vence` en el pasado, aunque el TTL no lo haya borrado aún) es `not-found`.
 *  - **Autoriza sobre el comercio pedido**: `esAdminDe`/`esOperDe` (rol +
 *    contraseña + correo verificado) y, para el soporte, `esPropietario` más una
 *    ventana vigente en `accesosSoporte`. Los tres roles ven y descargan todo, sin
 *    distinción de acción por rol (decisión de Andres, 30/10/2026, contrato v2 §8.3;
 *    reemplaza a la D4 «soporte no ve los medios»). Y vuelve a leer la cuenta
 *    (`cuentaVigenteDe`).
 *  - **El mime que sale es SEGURO** (contrato v2, 30/10/2026: se guarda y se
 *    descarga TODO tipo que WhatsApp permite). Imagen y audio: el de su firma
 *    (`tipoPorFirma`), que tiene que coincidir con la extensión, la categoría y el
 *    `mime` del metadato; un `.jpg` que trae HTML no sale. Video y documento (de
 *    cualquier byte): siempre `application/octet-stream`, y la extensión de la
 *    lista cerrada RECALCULADA DESDE LOS BYTES con las funciones de `tipos.ts`
 *    (`tipoPorFirma` para video, `documentoPorFirma` para documentos: las mismas que
 *    usa `guardarMedio`), que tiene que ser la de la ruta. Nunca el mime declarado por el cliente. El sha256 de los bytes tiene que ser el guardado.
 *  - **Salida:** `{tipo, categoria, mime, extension, tamano, base64}` (`tipo` =
 *    `categoria`). Si el metadato aún no trae `categoria`/`ext` (los agrega M1b),
 *    se deducen de la ruta; si los trae, tienen que coincidir con ella.
 *  - **Auditoría FAIL-CLOSED**: la vista se anota en `tenants/{t}/auditoria`
 *    (`accion: 'medio_visto'`, con `objeto` = el hash, nunca el teléfono, el
 *    `idMeta` ni la conversación) ANTES de devolver los bytes; si no se pudo
 *    anotar, `unavailable` y sin bytes. Un rechazo se audita solo si quien llama
 *    tiene rol válido; los demás no dejan NADA en Firestore.
 *  - **Tope por usuario: 60 por hora y 300 por día** (cifras del integrador, ajustables:
 *    30/100 dejaba sin cuota a quien revisa las 31 fotos de un paciente) en `topesDeMedios/{uid}`
 *    (transaccional, global, propio de los medios: no comparte cupo con el visor
 *    de comprobantes). Cuenta todo intento autorizado antes de leer el metadato. Sin cupo,
 *    a lo sumo UN asiento de «tope» por usuario y hora; los demás intentos no escriben.
 *  - **Un comercio suspendido SÍ puede ver**; dado de baja o inexistente es
 *    `not-found` y no se escribe nada bajo ese comercio.
 *  - Mensajes de error FIJOS; ningún log trae comercio, conversación, teléfono,
 *    `idMeta`, ruta, hash ni el mensaje de un error de Storage o Firestore.
 *
 * TAMAÑO DE LA RESPUESTA. El mayor medio es un audio de 16 MiB: en base64 son
 * 22.369.624 caracteres (~21,3 MiB) más el sobre JSON. Cabe en el límite de
 * respuesta HTTP de Cloud Functions de 2.ª generación / Cloud Run (32 MiB, sin
 * streaming); NO cabría en 1.ª generación (10 MB). Estas Functions son `gcfv2`
 * (`despliegue.json`). La prueba «el audio de 16 MiB cabe» lo calcula.
 *
 * MEMORIA Y CONCURRENCIA. Por petición conviven los bytes (16 MiB), la cadena
 * base64 (~21 MiB), el JSON de la respuesta (~21 MiB) y su copia en un Buffer
 * al enviarlo (~21 MiB), más los trozos de la descarga: ~100 MiB en el peor
 * caso. Con la concurrencia por defecto de gen2 (80) eso agota cualquier memoria;
 * con 4 y 1 GiB, cabe (mismo hallazgo y mismo valor que `guardarMedio`, #617).
 * `timeoutSeconds: 120` explícito (adenda de seguridad §7.7). En staging (`CPU_FRACCIONARIA`), sin
 * `concurrency` (firebase-tools la rechaza con menos de 1 vCPU).
 *
 * Costo por vista: lecturas de ficha, tope y metadato (más la de soporte, si es
 * soporte); 2 escrituras (el tope y la auditoría); 1 `getMetadata` y una descarga
 * de hasta 16 MiB. Cero mensajes por conversación.
 */
import { createHash } from 'node:crypto';
import { onCall, HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { esAdminDe, esOperDe, esPropietario, exigirAutenticado } from '../seguridad/autorizacion.js';
import { cuentaVigenteDe, soporteVigenteDe, type RolVerificado } from '../seguridad/vigencia.js';
import { CARPETA_DE_DIA, almacenDeMedios, nombreDeObjeto } from './almacen.js';
import { MB, documentoPorFirma, tipoPorFirma } from './tipos.js';

// ---------------------------------------------------------------------------
// OPCIONES (copia declarada de `opcionesDeVerComprobante`, con 1 GiB y 120 s)
// ---------------------------------------------------------------------------

/** ¿Se exige App Check? En producción sí; en staging y en el emulador no (como el visor de comprobantes). */
export const APP_CHECK_DE_VER_MEDIO = { produccion: true, staging: false } as const;
/** Peticiones a la vez por instancia FUERA de staging. */
export const CONCURRENCIA_DE_VER_MEDIO = 4;

export function opcionesDeVerMedio(env: Record<string, string | undefined>): CallableOptions {
  const staging = env['CPU_FRACCIONARIA'] === 'si';
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  return {
    region: REGION,
    memory: '1GiB',
    timeoutSeconds: 120,
    maxInstances: 3,
    ...(staging ? {} : { concurrency: CONCURRENCIA_DE_VER_MEDIO }),
    enforceAppCheck: emulador ? false : staging ? APP_CHECK_DE_VER_MEDIO.staging : APP_CHECK_DE_VER_MEDIO.produccion,
  };
}

// ---------------------------------------------------------------------------
// CONSTANTES DEL CONTRATO
// ---------------------------------------------------------------------------

/**
 * EL TOPE, EN UN SOLO LUGAR. Cifras del integrador (30/10/2026), AJUSTABLES: con 30/100 (las del visor de
 * comprobantes) un operador que revisa las 31 fotos de un paciente se quedaba sin cuota. Es un freno contra
 * abuso de una cuenta robada, no un límite de plan.
 */
export const TOPE_POR_HORA = 60;
export const TOPE_POR_DIA = 300;
/** La única colección del tope (cerrada en `firestore.rules`, declarada en el registro). */
export const COLECCION_DEL_TOPE = 'topesDeMedios';

/** Copia declarada de `ID_TENANT` de `central/comunes.ts` (la más estricta; la de `almacen.ts` es más laxa). */
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
/** `wa_<teléfono>`: el mismo rango que acepta `guardarMedio` (8 a 15 dígitos). */
const ID_CONVERSACION = /^wa_[0-9]{8,15}$/;
/** La forma de un wamid de Meta: sin espacios, saltos de línea ni caracteres de control. */
const ID_META = /^[A-Za-z0-9._=:+/-]{1,120}$/;
const UID_SEGURO = /^[A-Za-z0-9_-]{1,128}$/;
const CLAVES_DE_ENTRADA = new Set(['tenantId', 'conversacionId', 'idMeta', 'accion']);
/** Lo que la persona hace con el medio (adenda §7.7): mirarlo u oírlo en la consola, o bajarlo. */
export type AccionSobreMedio = 'ver' | 'descargar';
/** Cómo queda cada una en la auditoría. */
export const ACCION_AUDITADA: Record<AccionSobreMedio, string> = { ver: 'medio_visto', descargar: 'medio_descargado' };
const esAccion = (v: unknown): v is AccionSobreMedio => v === 'ver' || v === 'descargar';

/**
 * CONTRATO v2 (30/10/2026, «guardar y descargar TODO»). Cuatro categorías; imagen y audio se
 * muestran en la consola, video y documentos solo se descargan como adjunto.
 */
export type CategoriaDeMedio = 'image' | 'audio' | 'video' | 'document';
const CATEGORIAS: readonly CategoriaDeMedio[] = ['image', 'audio', 'video', 'document'];
const esCategoria = (v: unknown): v is CategoriaDeMedio => typeof v === 'string' && (CATEGORIAS as readonly string[]).includes(v);

/**
 * LA LISTA CERRADA de extensiones y la categoría que cada una implica. Es propia de la lectura (no
 * importa la de `tipos.ts`, que es de M1b y crece con v2): una extensión fuera de esta lista en la
 * ruta es `ruta_invalida`. `bin` es «documento no reconocido».
 */
export const CATEGORIA_DE_EXTENSION = {
  jpg: 'image', png: 'image', webp: 'image',
  ogg: 'audio', m4a: 'audio', mp3: 'audio', aac: 'audio', amr: 'audio',
  mp4: 'video', '3gp': 'video',
  pdf: 'document', docx: 'document', xlsx: 'document', pptx: 'document', zip: 'document',
  doc: 'document', xls: 'document', ppt: 'document', txt: 'document', csv: 'document', bin: 'document',
} as const satisfies Record<string, CategoriaDeMedio>;
export type ExtensionLeida = keyof typeof CATEGORIA_DE_EXTENSION;
const esExtension = (v: string): v is ExtensionLeida => Object.prototype.hasOwnProperty.call(CATEGORIA_DE_EXTENSION, v);

/**
 * Topes de LECTURA por categoría (contrato v2 §1: imagen 5 MB; audio, video y documento 16 MB). El
 * de guardado lo hace cumplir `guardarMedio`; este es el techo de lo que la callable descarga.
 */
export const TOPE_DE_LECTURA: Record<CategoriaDeMedio, number> = { image: 5 * MB, audio: 16 * MB, video: 16 * MB, document: 16 * MB };

/** El mime que sale para todo lo que no es imagen ni audio verificados: nunca el declarado. */
export const MIME_DE_DESCARGA = 'application/octet-stream';

export type MotivoDeRechazo =
  | 'tope' | 'sin_medio' | 'anotado' | 'pendiente' | 'caducado' | 'ruta_invalida'
  | 'demasiado_grande' | 'error_almacen' | 'error_firestore' | 'tipo_no_coincide' | 'integridad';

export const MENSAJES = {
  invalido: 'Solicitud inválida.',
  sinPermiso: 'Sin permiso para ver este archivo.',
  noHay: 'No se encontró ese archivo.',
  anotado: 'Este archivo solo se anotó: no se guarda.',
  pendiente: 'Este archivo todavía se está guardando.',
  noElegible: 'Este archivo no se puede mostrar.',
  tope: 'Alcanzó el tope de archivos por hora o por día.',
  noDisponible: 'No se pudo abrir el archivo. Intente más tarde.',
} as const;

// ---------------------------------------------------------------------------
// LA RUTA
// ---------------------------------------------------------------------------

/**
 * La ruta guardada, si es EXACTAMENTE `tenants/{t}/medios/{aaaa-mm-dd}/{sha256(idMeta)}.{ext}` de
 * ESTE comercio y ESTE medio, con una extensión de la lista; si no, `null`. Cinco tramos y cada uno
 * comparado por igualdad: no hay forma de colar `..`, otra carpeta ni otro comercio.
 */
export function rutaValidaDeMedio(ruta: unknown, tenantId: string, idMeta: string): string | null {
  if (typeof ruta !== 'string' || ruta.includes('..') || ruta.includes('\\')) return null;
  const partes = ruta.split('/');
  if (partes.length !== 5) return null;
  const [raiz, t, carpeta, dia, archivo] = partes as [string, string, string, string, string];
  if (raiz !== 'tenants' || t !== tenantId || carpeta !== 'medios' || !CARPETA_DE_DIA.test(dia)) return null;
  const punto = archivo.lastIndexOf('.');
  if (punto <= 0) return null;
  const ext = archivo.slice(punto + 1);
  if (archivo.slice(0, punto) !== nombreDeObjeto(idMeta) || !esExtension(ext)) return null;
  return ruta;
}

const extensionDe = (ruta: string): ExtensionLeida => ruta.slice(ruta.lastIndexOf('.') + 1) as ExtensionLeida;

// ---------------------------------------------------------------------------
// EL TOPE POR USUARIO (copia declarada de `consumirCupoDelVisor`, sobre `topesDeMedios`)
// ---------------------------------------------------------------------------

const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Qué pasó con el cupo: `ok` (consumido), `agotado_anotar` (sin cupo, y es la PRIMERA vez en esta hora:
 * se deja UN asiento de «tope») o `agotado_callar` (sin cupo, y la constancia de esta hora ya está: se
 * responde sin escribir nada, para que una cuenta que insiste no se convierta en escrituras sin freno;
 * mismo patrón que la constancia acotada de `guardarMedio`).
 */
export type ResultadoDelTope = 'ok' | 'agotado_anotar' | 'agotado_callar';

/**
 * Consume un cupo del usuario en UNA transacción sobre `topesDeMedios/{uid}`: `{hora (La Paz),
 * vistasHora, dia, vistasDia, constanciaHora, actualizadoEn}`. Sin cupo si llegó a 60 en la hora o a
 * 300 en el día; un contador ilegible se trata como agotado (falla cerrado). Sin cupo, la primera vez
 * de cada hora marca `constanciaHora` en el MISMO documento y en la MISMA transacción; las siguientes
 * no escriben.
 */
export async function consumirCupoDeMedios(uid: string, ahoraMs: number): Promise<ResultadoDelTope> {
  if (!UID_SEGURO.test(uid)) throw new Error('uid inválido para el tope');
  const sello = new Date(ahoraMs - 4 * 3_600_000).toISOString();
  const hora = sello.slice(0, 13);
  const dia = sello.slice(0, 10);
  const db = getFirestore();
  const ref = db.doc(`${COLECCION_DEL_TOPE}/${uid}`);
  return db.runTransaction(async (tx): Promise<ResultadoDelTope> => {
    const previo = await tx.get(ref);
    const d = previo.exists ? (previo.data() ?? {}) : {};
    const vistasHora = d['hora'] === hora ? d['vistasHora'] : 0;
    const vistasDia = d['dia'] === dia ? d['vistasDia'] : 0;
    if (!numeroValido(vistasHora) || !numeroValido(vistasDia)
      || vistasHora >= TOPE_POR_HORA || vistasDia >= TOPE_POR_DIA) {
      if (d['constanciaHora'] === hora) return 'agotado_callar';
      tx.set(ref, { constanciaHora: hora, actualizadoEn: Timestamp.fromMillis(ahoraMs) }, { merge: true });
      return 'agotado_anotar';
    }
    tx.set(ref, {
      hora, vistasHora: vistasHora + 1, dia, vistasDia: vistasDia + 1,
      actualizadoEn: Timestamp.fromMillis(ahoraMs),
    });
    return 'ok';
  });
}

// ---------------------------------------------------------------------------
// LA AUDITORÍA (copia declarada de `auditar` de `central/comunes.ts`)
// ---------------------------------------------------------------------------

export type AuditorDeMedios = (tenantId: string, uid: string, accion: string, detalle: Record<string, unknown>) => Promise<unknown>;

/** Escribe y FALLA EN VOZ ALTA (no es la bitácora, que se traga los errores). */
export const auditarEnFirestore: AuditorDeMedios = (tenantId, uid, accion, detalle) =>
  getFirestore().collection(`tenants/${tenantId}/auditoria`).add({
    ...detalle, accion, uid, en: Timestamp.now(),
  });

let auditorDePrueba: AuditorDeMedios | null = null;
/** Solo con `MEDIOS_DOBLE` en el entorno (como el almacén): en producción no hay cómo sustituirlo. */
export function fijarAuditorDeMediosDePrueba(a: AuditorDeMedios | null): void {
  if (!process.env['MEDIOS_DOBLE']) throw new Error('fijarAuditorDeMediosDePrueba exige MEDIOS_DOBLE en el entorno');
  auditorDePrueba = a;
}
const auditarVista: AuditorDeMedios = (tenantId, uid, accion, detalle) => (auditorDePrueba ?? auditarEnFirestore)(tenantId, uid, accion, detalle);

// ---------------------------------------------------------------------------
// LA CALLABLE
// ---------------------------------------------------------------------------

/** La única línea de log: función, código, motivo y uid. Nada del comercio ni del medio. */
function registrarRechazo(codigo: string, uid?: string, motivo?: string): void {
  console.warn(JSON.stringify({
    funcion: 'verMedio', codigo, ...(motivo ? { motivo } : {}), ...(uid ? { uid } : {}),
  }));
}

/** De un error cualquiera, solo su `code` y solo si tiene forma de código. */
function codigoDe(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  const s = typeof c === 'string' || typeof c === 'number' ? String(c) : '';
  return /^[A-Za-z0-9_./-]{1,40}$/.test(s) ? s : 'desconocido';
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const milis = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null);

/** `tipo` y `categoria` son iguales (el contrato v2 pide los dos nombres). */
export interface MedioVisto {
  tipo: CategoriaDeMedio; categoria: CategoriaDeMedio; mime: string; extension: ExtensionLeida; tamano: number; base64: string;
}

export const verMedio = onCall(opcionesDeVerMedio(process.env), async (p: CallableRequest) => {
  try {
    return await atender(p);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    registrarRechazo('unavailable', p.auth?.uid, `error_${codigoDe(e)}`);
    throw new HttpsError('unavailable', MENSAJES.noDisponible);
  }
});

async function atender(p: CallableRequest): Promise<MedioVisto> {
  // 1. Identidad. Sin sesión: nada que auditar.
  const uid = exigirAutenticado(p);

  // 2. Forma de la entrada: exactamente cuatro claves, cada una con su forma.
  const datos = esObjeto(p.data) ? p.data : null;
  const tenantId = datos?.['tenantId'];
  const conversacionId = datos?.['conversacionId'];
  const idMeta = datos?.['idMeta'];
  const accion = datos?.['accion'];
  if (datos === null || !esAccion(accion) || Object.keys(datos).some((k) => !CLAVES_DE_ENTRADA.has(k))
    || typeof tenantId !== 'string' || !ID_TENANT.test(tenantId)
    || typeof conversacionId !== 'string' || !ID_CONVERSACION.test(conversacionId)
    || typeof idMeta !== 'string' || !ID_META.test(idMeta)) {
    registrarRechazo('invalid-argument', uid);
    throw new HttpsError('invalid-argument', MENSAJES.invalido);
  }
  const objeto = nombreDeObjeto(idMeta);

  // 3. Rol del token PARA ESTE comercio.
  const rol: RolVerificado | null = esAdminDe(p, tenantId) ? 'admin'
    : esOperDe(p, tenantId) ? 'oper'
      : esPropietario(p) ? 'soporte' : null;
  if (rol === null) {
    registrarRechazo('permission-denied', uid, 'sin_rol');
    throw new HttpsError('permission-denied', MENSAJES.sinPermiso);
  }

  // 4. El token no basta: la cuenta sigue habilitada, con el rol, y la sesión es posterior a la revocación.
  const authTime = p.auth?.token?.['auth_time'];
  let vigente: boolean;
  try {
    vigente = await cuentaVigenteDe(uid, typeof authTime === 'number' ? authTime : Number.NaN, rol, tenantId);
  } catch (e) {
    registrarRechazo('unavailable', uid, `auth_${codigoDe(e)}`);
    throw new HttpsError('unavailable', MENSAJES.noDisponible);
  }
  if (!vigente) {
    registrarRechazo('permission-denied', uid, 'cuenta_no_vigente');
    throw new HttpsError('permission-denied', MENSAJES.sinPermiso);
  }

  // 5. El soporte, además, necesita una ventana vigente que el comercio le haya dado.
  if (rol === 'soporte' && !(await soporteVigenteDe(p, tenantId, Date.now()))) {
    registrarRechazo('permission-denied', uid, 'sin_ventana_de_soporte');
    throw new HttpsError('permission-denied', MENSAJES.sinPermiso);
  }

  // 6. La ficha: activo o suspendido. Dado de baja o inexistente: not-found y nada se escribe.
  const db = getFirestore();
  const ficha = await db.doc(`tenants/${tenantId}`).get();
  const estado = ficha.exists ? ficha.get('estado') : undefined;
  if (!ficha.exists || (estado !== 'activo' && estado !== 'suspendido')) {
    registrarRechazo('not-found', uid, 'comercio_no_legible');
    throw new HttpsError('not-found', MENSAJES.noHay);
  }

  // Desde acá quien llama TIENE rol en este comercio: sus rechazos se auditan.
  const rechazar = async (
    motivo: MotivoDeRechazo,
    codigo: 'permission-denied' | 'resource-exhausted' | 'failed-precondition' | 'not-found' | 'unavailable',
    mensaje: string, detalle?: 'anotado' | 'pendiente',
  ): Promise<never> => {
    try {
      await auditarVista(tenantId, uid, ACCION_AUDITADA[accion], { rol, objeto, resultado: 'rechazado', motivo });
    } catch (e) {
      registrarRechazo('unavailable', uid, `auditoria_${codigoDe(e)}`);
      throw new HttpsError('unavailable', MENSAJES.noDisponible);
    }
    registrarRechazo(codigo, uid, motivo);
    throw detalle ? new HttpsError(codigo, mensaje, detalle) : new HttpsError(codigo, mensaje);
  };

  // 7. El tope por usuario.
  const ahoraMs = Date.now();
  // Si Firestore falla acá o al leer el metadato, quien llama tiene rol: se intenta dejar el asiento
  // `error_firestore` (si tampoco se puede, `rechazar` responde igual `unavailable`). Fail-closed en
  // los dos casos: ningún byte sale.
  let tope: ResultadoDelTope;
  try {
    tope = await consumirCupoDeMedios(uid, ahoraMs);
  } catch (e) {
    registrarRechazo('unavailable', uid, `tope_${codigoDe(e)}`);
    return rechazar('error_firestore', 'unavailable', MENSAJES.noDisponible);
  }
  if (tope === 'agotado_anotar') return rechazar('tope', 'resource-exhausted', MENSAJES.tope);
  if (tope === 'agotado_callar') {
    registrarRechazo('resource-exhausted', uid, 'tope_sin_constancia');
    throw new HttpsError('resource-exhausted', MENSAJES.tope);
  }

  // 8. El metadato: de ESTE medio y ESTA conversación, guardado y sin vencer.
  let meta: FirebaseFirestore.DocumentSnapshot;
  try {
    meta = await db.doc(`tenants/${tenantId}/mediosRecibidos/${objeto}`).get();
  } catch (e) {
    registrarRechazo('unavailable', uid, `metadato_${codigoDe(e)}`);
    return rechazar('error_firestore', 'unavailable', MENSAJES.noDisponible);
  }
  if (!meta.exists || meta.get('idMeta') !== idMeta || meta.get('conversacionId') !== conversacionId) {
    return rechazar('sin_medio', 'not-found', MENSAJES.noHay);
  }
  const estadoMedio = meta.get('estado');
  if (estadoMedio === 'anotado') return rechazar('anotado', 'failed-precondition', MENSAJES.anotado, 'anotado');
  if (estadoMedio === 'pendiente') return rechazar('pendiente', 'failed-precondition', MENSAJES.pendiente, 'pendiente');
  if (estadoMedio !== 'guardado') return rechazar('sin_medio', 'not-found', MENSAJES.noHay);
  const vence = milis(meta.get('vence'));
  if (vence === null || vence <= ahoraMs) return rechazar('caducado', 'not-found', MENSAJES.noHay);

  // 9. La ruta, validada contra ESTE comercio y ESTE medio. La extensión y la categoría salen de la
  // ruta; si el metadato trae `ext`, `categoria` o `tipo` (M1b los escribe), tienen que coincidir.
  const ruta = rutaValidaDeMedio(meta.get('ruta'), tenantId, idMeta);
  const extMeta = meta.get('ext');
  if (ruta === null || (extMeta !== undefined && extMeta !== null && extMeta !== extensionDe(ruta))) {
    return rechazar('ruta_invalida', 'not-found', MENSAJES.noHay);
  }
  const extRuta = extensionDe(ruta);
  const categoria: CategoriaDeMedio = CATEGORIA_DE_EXTENSION[extRuta];
  for (const declarada of [meta.get('categoria'), meta.get('tipo')]) {
    if (declarada !== undefined && declarada !== null && (!esCategoria(declarada) || declarada !== categoria)) {
      return rechazar('tipo_no_coincide', 'failed-precondition', MENSAJES.noElegible);
    }
  }
  const maximo = TOPE_DE_LECTURA[categoria];

  // 10. El tamaño, SIN descargar.
  const almacen = almacenDeMedios();
  let info: { tamano: number } | null;
  try {
    info = await almacen.metadatos(ruta);
  } catch {
    return rechazar('error_almacen', 'unavailable', MENSAJES.noDisponible);
  }
  if (info === null) return rechazar('sin_medio', 'not-found', MENSAJES.noHay);
  if (!(info.tamano <= maximo)) return rechazar('demasiado_grande', 'failed-precondition', MENSAJES.noElegible);

  // 11. Los bytes.
  let bytes: Buffer | null;
  try {
    bytes = await almacen.leer(ruta);
  } catch {
    return rechazar('error_almacen', 'unavailable', MENSAJES.noDisponible);
  }
  if (bytes === null) return rechazar('sin_medio', 'not-found', MENSAJES.noHay);
  if (bytes.length > maximo) return rechazar('demasiado_grande', 'failed-precondition', MENSAJES.noElegible);

  // 12. La huella, la del guardado. Después, la EXTENSIÓN RECALCULADA DESDE LOS BYTES (no se confía en
  // `ext` de Firestore), que tiene que ser la de la ruta; y el mime SEGURO: imagen y audio, el de su
  // firma; video y documento, siempre octet-stream. Nunca el mime que declaró nadie.
  if (createHash('sha256').update(bytes).digest('hex') !== meta.get('sha256')) {
    return rechazar('integridad', 'failed-precondition', MENSAJES.noElegible);
  }
  let mime: string = MIME_DE_DESCARGA;
  if (categoria === 'image' || categoria === 'audio') {
    const firma = tipoPorFirma(bytes);
    const mimeMeta = meta.get('mime');
    if (firma === null || firma.tipo !== categoria || firma.ext !== extRuta
      || (mimeMeta !== undefined && mimeMeta !== null && mimeMeta !== firma.mime)) {
      return rechazar('tipo_no_coincide', 'failed-precondition', MENSAJES.noElegible);
    }
    mime = firma.mime;
  } else {
    // Video: la firma de `tipos.ts` (marcas ftyp de video, disjuntas de las de audio). Documento:
    // `documentoPorFirma` de `tipos.ts`, la MISMA función que usó `guardarMedio`, con el mime guardado
    // en `mediosRecibidos` (es idempotente: da lo mismo que al guardar). Nunca el `ext` de Firestore.
    const firma = categoria === 'video' ? tipoPorFirma(bytes) : null;
    const deLosBytes = categoria === 'video'
      ? (firma !== null && firma.tipo === 'video' ? firma.ext : null)
      : documentoPorFirma(bytes, meta.get('mime')).ext;
    if (deLosBytes !== extRuta) return rechazar('tipo_no_coincide', 'failed-precondition', MENSAJES.noElegible);
  }
  const extension: ExtensionLeida = extRuta;

  // 13. FAIL-CLOSED: si la vista no quedó anotada, no sale ningún byte.
  try {
    await auditarVista(tenantId, uid, ACCION_AUDITADA[accion], { rol, objeto, resultado: 'ok' });
  } catch (e) {
    registrarRechazo('unavailable', uid, `auditoria_${codigoDe(e)}`);
    throw new HttpsError('unavailable', MENSAJES.noDisponible);
  }

  // 14. Exactamente esto y nada más.
  return { tipo: categoria, categoria, mime, extension, tamano: bytes.length, base64: bytes.toString('base64') };
}
