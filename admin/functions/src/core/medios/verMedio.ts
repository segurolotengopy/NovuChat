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
 * del 30/10/2026, «los mismos roles que ven comprobantes»; reemplaza a la D4 de
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
 *    `{tenantId, conversacionId, idMeta}`; cualquier otra clave es
 *    `invalid-argument`. La ruta sale de `tenants/{t}/mediosRecibidos/{sha256(idMeta)}`
 *    y pasa por `rutaValidaDeMedio` (ESTE comercio, ESTE medio, día con forma de
 *    fecha, extensión de la lista, sin `..`). Una ruta ajena no llega al almacén.
 *  - **El metadato tiene que ser de ESA conversación** (`conversacionId` e `idMeta`
 *    iguales a los pedidos) y estar `guardado`; `anotado` y `pendiente` son
 *    `failed-precondition` con el detalle `'anotado'` o `'pendiente'`; vencido
 *    (`vence` en el pasado, aunque el TTL no lo haya borrado aún) es `not-found`.
 *  - **Autoriza sobre el comercio pedido**: `esAdminDe`/`esOperDe` (rol +
 *    contraseña + correo verificado) y, para el soporte, `esPropietario` más una
 *    ventana vigente en `accesosSoporte`. Y vuelve a leer la cuenta
 *    (`cuentaVigenteDe`).
 *  - **El tipo se decide por los bytes** (`tipoPorFirma`): debe coincidir con la
 *    extensión de la ruta, con el `tipo` y con el `mime` del metadato (el que fijó
 *    el servidor al guardar, nunca el que pida nadie), y el sha256 de los bytes
 *    con el guardado. Un `.jpg` que trae HTML no sale.
 *  - **Auditoría FAIL-CLOSED**: la vista se anota en `tenants/{t}/auditoria`
 *    (`accion: 'medio_visto'`, con `objeto` = el hash, nunca el teléfono, el
 *    `idMeta` ni la conversación) ANTES de devolver los bytes; si no se pudo
 *    anotar, `unavailable` y sin bytes. Un rechazo se audita solo si quien llama
 *    tiene rol válido; los demás no dejan NADA en Firestore.
 *  - **Tope por usuario: 30 por hora y 100 por día** en `topesDeMedios/{uid}`
 *    (transaccional, global, propio de los medios: no comparte cupo con el visor
 *    de comprobantes). Cuenta todo intento autorizado antes de leer el metadato.
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
 * `timeoutSeconds: 60` explícito. En staging (`CPU_FRACCIONARIA`), sin
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
import { TOPE_POR_TIPO, tipoPorFirma, type ExtensionDeMedio, type TipoDeMedio } from './tipos.js';

// ---------------------------------------------------------------------------
// OPCIONES (copia declarada de `opcionesDeVerComprobante`, con 1 GiB y 60 s)
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
    timeoutSeconds: 60,
    maxInstances: 3,
    ...(staging ? {} : { concurrency: CONCURRENCIA_DE_VER_MEDIO }),
    enforceAppCheck: emulador ? false : staging ? APP_CHECK_DE_VER_MEDIO.staging : APP_CHECK_DE_VER_MEDIO.produccion,
  };
}

// ---------------------------------------------------------------------------
// CONSTANTES DEL CONTRATO
// ---------------------------------------------------------------------------

export const TOPE_POR_HORA = 30;
export const TOPE_POR_DIA = 100;
/** La única colección del tope (cerrada en `firestore.rules`, declarada en el registro). */
export const COLECCION_DEL_TOPE = 'topesDeMedios';

/** Copia declarada de `ID_TENANT` de `central/comunes.ts` (la más estricta; la de `almacen.ts` es más laxa). */
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
/** `wa_<teléfono>`: el mismo rango que acepta `guardarMedio` (8 a 15 dígitos). */
const ID_CONVERSACION = /^wa_[0-9]{8,15}$/;
/** La forma de un wamid de Meta: sin espacios, saltos de línea ni caracteres de control. */
const ID_META = /^[A-Za-z0-9._=:+/-]{1,120}$/;
const UID_SEGURO = /^[A-Za-z0-9_-]{1,128}$/;
const CLAVES_DE_ENTRADA = new Set(['tenantId', 'conversacionId', 'idMeta']);

/** Qué tipo corresponde a cada extensión que `guardarMedio` puede escribir. */
const TIPO_DE_EXTENSION: Record<ExtensionDeMedio, TipoDeMedio> = {
  jpg: 'image', png: 'image', webp: 'image',
  ogg: 'audio', m4a: 'audio', mp3: 'audio', aac: 'audio', amr: 'audio',
  pdf: 'document',
};
const esExtension = (v: string): v is ExtensionDeMedio => Object.prototype.hasOwnProperty.call(TIPO_DE_EXTENSION, v);

export type MotivoDeRechazo =
  | 'tope' | 'sin_medio' | 'anotado' | 'pendiente' | 'caducado' | 'ruta_invalida'
  | 'demasiado_grande' | 'error_almacen' | 'tipo_no_coincide' | 'integridad';

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

const extensionDe = (ruta: string): ExtensionDeMedio => ruta.slice(ruta.lastIndexOf('.') + 1) as ExtensionDeMedio;

// ---------------------------------------------------------------------------
// EL TOPE POR USUARIO (copia declarada de `consumirCupoDelVisor`, sobre `topesDeMedios`)
// ---------------------------------------------------------------------------

const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Consume un cupo del usuario en UNA transacción sobre `topesDeMedios/{uid}`: `{hora (La Paz),
 * vistasHora, dia, vistasDia, actualizadoEn}`. `false` si llegó a 30 en la hora o a 100 en el día
 * (sin escribir). Un contador ilegible se trata como agotado (falla cerrado).
 */
export async function consumirCupoDeMedios(uid: string, ahoraMs: number): Promise<boolean> {
  if (!UID_SEGURO.test(uid)) throw new Error('uid inválido para el tope');
  const sello = new Date(ahoraMs - 4 * 3_600_000).toISOString();
  const hora = sello.slice(0, 13);
  const dia = sello.slice(0, 10);
  const db = getFirestore();
  const ref = db.doc(`${COLECCION_DEL_TOPE}/${uid}`);
  return db.runTransaction(async (tx) => {
    const previo = await tx.get(ref);
    const d = previo.exists ? (previo.data() ?? {}) : {};
    const vistasHora = d['hora'] === hora ? d['vistasHora'] : 0;
    const vistasDia = d['dia'] === dia ? d['vistasDia'] : 0;
    if (!numeroValido(vistasHora) || !numeroValido(vistasDia)) return false;
    if (vistasHora >= TOPE_POR_HORA || vistasDia >= TOPE_POR_DIA) return false;
    tx.set(ref, {
      hora, vistasHora: vistasHora + 1, dia, vistasDia: vistasDia + 1,
      actualizadoEn: Timestamp.fromMillis(ahoraMs),
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// LA AUDITORÍA (copia declarada de `auditar` de `central/comunes.ts`)
// ---------------------------------------------------------------------------

export type AuditorDeMedios = (tenantId: string, uid: string, detalle: Record<string, unknown>) => Promise<unknown>;

/** Escribe y FALLA EN VOZ ALTA (no es la bitácora, que se traga los errores). */
export const auditarEnFirestore: AuditorDeMedios = (tenantId, uid, detalle) =>
  getFirestore().collection(`tenants/${tenantId}/auditoria`).add({
    accion: 'medio_visto', uid, en: Timestamp.now(), ...detalle,
  });

let auditorDePrueba: AuditorDeMedios | null = null;
/** Solo con `MEDIOS_DOBLE` en el entorno (como el almacén): en producción no hay cómo sustituirlo. */
export function fijarAuditorDeMediosDePrueba(a: AuditorDeMedios | null): void {
  if (!process.env['MEDIOS_DOBLE']) throw new Error('fijarAuditorDeMediosDePrueba exige MEDIOS_DOBLE en el entorno');
  auditorDePrueba = a;
}
const auditarVista: AuditorDeMedios = (tenantId, uid, detalle) => (auditorDePrueba ?? auditarEnFirestore)(tenantId, uid, detalle);

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

export interface MedioVisto { tipo: TipoDeMedio; mime: string; tamano: number; base64: string }

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

  // 2. Forma de la entrada: exactamente tres claves, cada una con su forma.
  const datos = esObjeto(p.data) ? p.data : null;
  const tenantId = datos?.['tenantId'];
  const conversacionId = datos?.['conversacionId'];
  const idMeta = datos?.['idMeta'];
  if (datos === null || Object.keys(datos).some((k) => !CLAVES_DE_ENTRADA.has(k))
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
    codigo: 'resource-exhausted' | 'failed-precondition' | 'not-found' | 'unavailable',
    mensaje: string, detalle?: 'anotado' | 'pendiente',
  ): Promise<never> => {
    try {
      await auditarVista(tenantId, uid, { rol, objeto, resultado: 'rechazado', motivo });
    } catch (e) {
      registrarRechazo('unavailable', uid, `auditoria_${codigoDe(e)}`);
      throw new HttpsError('unavailable', MENSAJES.noDisponible);
    }
    registrarRechazo(codigo, uid, motivo);
    throw detalle ? new HttpsError(codigo, mensaje, detalle) : new HttpsError(codigo, mensaje);
  };

  // 7. El tope por usuario.
  const ahoraMs = Date.now();
  if (!(await consumirCupoDeMedios(uid, ahoraMs))) return rechazar('tope', 'resource-exhausted', MENSAJES.tope);

  // 8. El metadato: de ESTE medio y ESTA conversación, guardado y sin vencer.
  const meta = await db.doc(`tenants/${tenantId}/mediosRecibidos/${objeto}`).get();
  if (!meta.exists || meta.get('idMeta') !== idMeta || meta.get('conversacionId') !== conversacionId) {
    return rechazar('sin_medio', 'not-found', MENSAJES.noHay);
  }
  const estadoMedio = meta.get('estado');
  if (estadoMedio === 'anotado') return rechazar('anotado', 'failed-precondition', MENSAJES.anotado, 'anotado');
  if (estadoMedio === 'pendiente') return rechazar('pendiente', 'failed-precondition', MENSAJES.pendiente, 'pendiente');
  if (estadoMedio !== 'guardado') return rechazar('sin_medio', 'not-found', MENSAJES.noHay);
  const vence = milis(meta.get('vence'));
  if (vence === null || vence <= ahoraMs) return rechazar('caducado', 'not-found', MENSAJES.noHay);

  // 9. La ruta, validada contra ESTE comercio y ESTE medio, y con la extensión del metadato.
  const ruta = rutaValidaDeMedio(meta.get('ruta'), tenantId, idMeta);
  if (ruta === null || meta.get('ext') !== extensionDe(ruta)) return rechazar('ruta_invalida', 'not-found', MENSAJES.noHay);
  const tipoEsperado = TIPO_DE_EXTENSION[extensionDe(ruta)];
  if (meta.get('tipo') !== tipoEsperado) return rechazar('tipo_no_coincide', 'failed-precondition', MENSAJES.noElegible);
  const maximo = TOPE_POR_TIPO[tipoEsperado];

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

  // 12. El tipo, por los bytes: extensión, tipo y mime del metadato. Y la huella, la del guardado.
  const firma = tipoPorFirma(bytes);
  if (firma === null || firma.ext !== extensionDe(ruta) || firma.tipo !== tipoEsperado || firma.mime !== meta.get('mime')) {
    return rechazar('tipo_no_coincide', 'failed-precondition', MENSAJES.noElegible);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== meta.get('sha256')) {
    return rechazar('integridad', 'failed-precondition', MENSAJES.noElegible);
  }

  // 13. FAIL-CLOSED: si la vista no quedó anotada, no sale ningún byte.
  try {
    await auditarVista(tenantId, uid, { rol, objeto, resultado: 'ok' });
  } catch (e) {
    registrarRechazo('unavailable', uid, `auditoria_${codigoDe(e)}`);
    throw new HttpsError('unavailable', MENSAJES.noDisponible);
  }

  // 14. Exactamente esto y nada más.
  return { tipo: firma.tipo, mime: firma.mime, tamano: bytes.length, base64: bytes.toString('base64') };
}
