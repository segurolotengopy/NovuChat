/**
 * =============================================================================
 * VER EL COMPROBANTE — `verComprobante`, los bytes por una callable con permisos
 * =============================================================================
 *
 * El comprobante de una venta se guarda 90 días en Storage (`comprobantes.ts`)
 * y `storage.rules` niega todo acceso directo, también al administrador. Esta
 * callable es la ÚNICA puerta para verlo: lo piden el administrador y el
 * operador de ESE comercio y el soporte de NovuChat mientras el comercio le
 * conserve una ventana vigente. Devuelve los bytes (`{mime, base64}`), nunca una
 * URL ni un enlace: una URL firmada se copia, se reenvía y vive hasta que vence.
 *
 * LO QUE ESTA FUNCIÓN GARANTIZA, y cada línea tiene una prueba que la niega
 * (`pruebas/modulos/cobros/ver-comprobante.test.ts`, T1 a T23):
 *
 *  - **El cliente nunca manda una ruta.** Manda `{tenantId, cierreId}`; la ruta
 *    sale del cierre (`privado/datos.rutaComprobante`) o se deriva del hash del
 *    `idMeta`, y toda candidata pasa por `rutaValidaDe` (ESTE comercio, ESTE
 *    mensaje). Una ruta ajena, con `..` o de otro mensaje no llega al almacén.
 *  - **Autoriza sobre el comercio pedido**, no sobre «el primer comercio del
 *    token»: `esAdminDe`/`esOperDe` (rol + proveedor de contraseña + correo
 *    verificado, espejo de las reglas) y, para el soporte, `esPropietario` más
 *    una ventana vigente en `accesosSoporte`. Y no se fía del token: vuelve a
 *    leer la cuenta (`cuentaVigenteDe`: habilitada, con el rol, sesión posterior
 *    a la última revocación).
 *  - **El tipo se decide por los bytes** (`tipoPorFirma`) y debe coincidir con la
 *    extensión de la ruta. El `contentType` guardado no cuenta; un `.jpg` que
 *    trae HTML no sale.
 *  - **Auditoría FAIL-CLOSED**: la vista se anota en `tenants/{t}/auditoria`
 *    con `auditar` (que escribe y falla en voz alta) ANTES de devolver los
 *    bytes; si no se pudo anotar, `unavailable` y sin bytes. NO usa la bitácora
 *    (`registrar()` se traga los errores y la ingesta puede escribir en ella).
 *  - **Un rechazo se audita solo si quien llama tiene rol válido** en ese
 *    comercio. Quien no lo tiene (otro comercio, ingesta, propietario sin
 *    ventana, Google, correo sin verificar) no deja NADA en Firestore: solo una
 *    línea de log con código y uid, sin comercio, cierre, ruta ni hash.
 *  - **Tope por usuario: 30 por hora y 100 por día**, contados en el servidor en
 *    un documento transaccional `topesDelVisor/{uid}` (global, no por comercio).
 *    Cuenta todo intento autorizado que llega a este punto, antes de leer el
 *    cierre. Sin índice compuesto. Las reglas lo niegan todo.
 *  - **Un comercio suspendido SÍ puede ver** (como `tenantLegible`); dado de
 *    baja o inexistente, no.
 *  - Mensajes de error FIJOS; ningún log trae ruta, hash, `idMeta`, bytes ni el
 *    mensaje de un error de Storage o Firestore: solo su `code`.
 *
 * APP CHECK: se exige SOLO en esta callable, y solo donde el cliente lo manda
 * (`APP_CHECK_DEL_VISOR`). Exigirlo en el resto de las Functions o en Firestore
 * es un cambio APARTE y de riesgo: antes hay que medir cuántos tokens verificados
 * llegan hoy. NO entra con este visor.
 *
 * CONCURRENCIA: `concurrency` solo FUERA de staging. En staging (`gcf_gen1` con
 * 512 MiB = 0,333 vCPU) firebase-tools rechaza una concurrencia mayor que 1 con
 * menos de 1 vCPU (`opcionesGlobales.ts`). Sin variable de entorno nueva: el CI
 * de producción exige un `.env` exacto.
 *
 * Costo por vista: lecturas de ficha, de tope, de cierre y de privado (más la
 * de soporte, si es soporte); 2 escrituras (el tope y la auditoría); de 1 a 8
 * `getMetadata` y una descarga de hasta 10 MB (~13 MB en base64). Cero mensajes.
 */
import { onCall, HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { esAdminDe, esOperDe, esPropietario, exigirAutenticado } from '../../core/seguridad/autorizacion.js';
import { cuentaVigenteDe, soporteVigenteDe, type RolVerificado } from '../../core/seguridad/vigencia.js';
import { ID_TENANT, auditar, db } from '../../central/comunes.js';
import { tieneModulo, type FichaConCapacidades } from '../../registro.js';
import { diaDeLaPaz } from './cotejo.js';
import {
  MAXIMO_IMAGEN, MAXIMO_PDF, almacenDeComprobantes, rutaDeComprobante, rutaValidaDe, tipoPorFirma,
  type ExtensionDeComprobante,
} from './comprobantes.js';

// ---------------------------------------------------------------------------
// OPCIONES (App Check por entorno, concurrencia solo fuera de staging)
// ---------------------------------------------------------------------------

/**
 * ¿Se exige App Check? En producción sí; en staging no (el build de staging no
 * lleva la clave del sitio, así que la consola no manda token) y en el emulador
 * tampoco. Una constante y no una variable de entorno, a propósito.
 */
export const APP_CHECK_DEL_VISOR = { produccion: true, staging: false } as const;

export function opcionesDeVerComprobante(env: Record<string, string | undefined>): CallableOptions {
  const staging = env['CPU_FRACCIONARIA'] === 'si';
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  return {
    region: REGION,
    memory: '512MiB',
    maxInstances: 3,
    ...(staging ? {} : { concurrency: 4 }),
    enforceAppCheck: emulador ? false : staging ? APP_CHECK_DEL_VISOR.staging : APP_CHECK_DEL_VISOR.produccion,
  };
}

// ---------------------------------------------------------------------------
// CONSTANTES DEL CONTRATO
// ---------------------------------------------------------------------------

export const TOPE_POR_HORA = 30;
export const TOPE_POR_DIA = 100;
export const MIMES_DEL_VISOR = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

const ID_CIERRE = /^venta_[A-Za-z0-9_-]{1,120}$/;
/** Un uid de Firebase Auth como id de documento. */
const UID_SEGURO = /^[A-Za-z0-9_-]{1,128}$/;
const EXTENSIONES: readonly ExtensionDeComprobante[] = ['jpg', 'png', 'webp', 'pdf'];
const DIA_MS = 86_400_000;

/** Los motivos de un rechazo auditado: lista cerrada. */
export type MotivoDeRechazo =
  | 'sin_modulo' | 'tope' | 'sin_comprobante' | 'no_elegible' | 'demasiado_grande' | 'error_almacen' | 'tipo_no_coincide';

const MENSAJES = {
  invalido: 'Solicitud inválida.',
  sinPermiso: 'Sin permiso para ver este comprobante.',
  noElegible: 'Este cobro no tiene un comprobante que se pueda mostrar.',
  noHay: 'No hay un comprobante guardado para este cobro.',
  tope: 'Alcanzó el tope de comprobantes por hora o por día.',
  noDisponible: 'No se pudo abrir el comprobante. Intente más tarde.',
} as const;

// ---------------------------------------------------------------------------
// EL TOPE POR USUARIO
// ---------------------------------------------------------------------------

const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Consume un cupo del usuario, en UNA transacción sobre `topesDelVisor/{uid}`:
 * `{hora:'aaaa-mm-ddThh' (La Paz), vistasHora, dia:'aaaa-mm-dd', vistasDia,
 * actualizadoEn}`. Devuelve `false` si ya llegó a 30 en la hora o a 100 en el día;
 * en ese caso NO escribe. Un contador ilegible se trata como agotado (falla
 * cerrado). Las reglas niegan este documento a todos: solo lo escribe el servidor.
 */
export async function consumirCupoDelVisor(uid: string, ahoraMs: number): Promise<boolean> {
  if (!UID_SEGURO.test(uid)) throw new Error('uid inválido para el tope');
  const sello = new Date(ahoraMs - 4 * 3_600_000).toISOString();
  const hora = sello.slice(0, 13);
  const dia = sello.slice(0, 10);
  const ref = db().doc(`topesDelVisor/${uid}`);
  return db().runTransaction(async (tx) => {
    const previo = await tx.get(ref);
    const d = previo.exists ? (previo.data() ?? {}) : {};
    const mismaHora = d['hora'] === hora;
    const mismoDia = d['dia'] === dia;
    const vistasHora = mismaHora ? d['vistasHora'] : 0;
    const vistasDia = mismoDia ? d['vistasDia'] : 0;
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
// LA CALLABLE
// ---------------------------------------------------------------------------

/**
 * La única línea de log. Sin comercio, cierre, ruta, idMeta ni hash, y nunca el
 * mensaje de un error de Storage o de Firestore (puede traer la ruta).
 */
function registrarRechazo(codigo: string, uid?: string, motivo?: string): void {
  console.warn(JSON.stringify({
    funcion: 'verComprobante', codigo, ...(motivo ? { motivo } : {}), ...(uid ? { uid } : {}),
  }));
}

/** De un error cualquiera, solo su `code` y solo si tiene forma de código. */
function codigoDe(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  const s = typeof c === 'string' || typeof c === 'number' ? String(c) : '';
  return /^[A-Za-z0-9_./-]{1,40}$/.test(s) ? s : 'desconocido';
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const extensionDe = (ruta: string): ExtensionDeComprobante => ruta.slice(ruta.lastIndexOf('.') + 1) as ExtensionDeComprobante;

export const verComprobante = onCall(opcionesDeVerComprobante(process.env), async (p: CallableRequest) => {
  try {
    return await atender(p);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // Un error que no es nuestro (Firestore, Storage, Auth): solo su código.
    registrarRechazo('unavailable', p.auth?.uid, `error_${codigoDe(e)}`);
    throw new HttpsError('unavailable', MENSAJES.noDisponible);
  }
});

async function atender(p: CallableRequest): Promise<{ mime: string; base64: string }> {
  // 1. Identidad. Sin sesión (o sin App Check, que Firebase responde antes): nada que auditar.
  const uid = exigirAutenticado(p);

  // 2. Forma de la entrada. El servidor ignora cualquier otra clave.
  const datos = esObjeto(p.data) ? p.data : {};
  const tenantId = datos['tenantId'];
  const cierreId = datos['cierreId'];
  if (typeof tenantId !== 'string' || !ID_TENANT.test(tenantId)
    || typeof cierreId !== 'string' || !ID_CIERRE.test(cierreId)) {
    registrarRechazo('invalid-argument', uid);
    throw new HttpsError('invalid-argument', MENSAJES.invalido);
  }

  // 3. Rol del token PARA ESTE comercio. Ninguna otra pertenencia sirve.
  const rol: RolVerificado | null = esAdminDe(p, tenantId) ? 'admin'
    : esOperDe(p, tenantId) ? 'oper'
      : esPropietario(p) ? 'soporte' : null;
  if (rol === null) {
    registrarRechazo('permission-denied', uid, 'sin_rol');
    throw new HttpsError('permission-denied', MENSAJES.sinPermiso);
  }

  // 4. El token no basta: la cuenta sigue habilitada, con el rol, y la sesión es posterior a la última revocación.
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

  // 6. La ficha: activo o suspendido. Dado de baja o inexistente: nada se escribe bajo ese comercio.
  const ficha = await db().doc(`tenants/${tenantId}`).get();
  const estado = ficha.exists ? ficha.get('estado') : undefined;
  if (!ficha.exists || (estado !== 'activo' && estado !== 'suspendido')) {
    registrarRechazo('permission-denied', uid, 'comercio_no_legible');
    throw new HttpsError('permission-denied', MENSAJES.sinPermiso);
  }

  // Desde acá quien llama TIENE rol en este comercio: sus rechazos se auditan.
  const rechazar = async (
    motivo: MotivoDeRechazo, codigo: 'permission-denied' | 'resource-exhausted' | 'failed-precondition' | 'not-found' | 'unavailable',
    mensaje: string,
  ): Promise<never> => {
    try {
      await auditar(tenantId, 'comprobante_visto', uid, { rol, cierreId, resultado: 'rechazado', motivo });
    } catch (e) {
      registrarRechazo('unavailable', uid, `auditoria_${codigoDe(e)}`);
      throw new HttpsError('unavailable', MENSAJES.noDisponible);
    }
    registrarRechazo(codigo, uid, motivo);
    throw new HttpsError(codigo, mensaje);
  };

  // 7. El módulo, DEL REGISTRO (la regla de Firestore `tieneModulo` da falso para cobros).
  if (!tieneModulo(ficha.data() as FichaConCapacidades, 'cobros')) {
    return rechazar('sin_modulo', 'permission-denied', MENSAJES.sinPermiso);
  }

  // 8. El tope por usuario.
  const ahoraMs = Date.now();
  if (!(await consumirCupoDelVisor(uid, ahoraMs))) {
    return rechazar('tope', 'resource-exhausted', MENSAJES.tope);
  }

  // 9. El cierre: una venta con comprobante cotejado como válido o aproximado.
  const refCierre = db().doc(`tenants/${tenantId}/cierres/${cierreId}`);
  const [cierre, privado] = await Promise.all([refCierre.get(), refCierre.collection('privado').doc('datos').get()]);
  if (!cierre.exists) return rechazar('sin_comprobante', 'not-found', MENSAJES.noHay);
  const cotejo: unknown = cierre.get('cotejo');
  if (cierre.get('tipo') !== 'venta' || !esObjeto(cotejo)
    || (cotejo['calidad'] !== 'valido' && cotejo['calidad'] !== 'aproximado')
    || typeof cotejo['idMeta'] !== 'string' || cotejo['idMeta'].trim() === '') {
    return rechazar('no_elegible', 'failed-precondition', MENSAJES.noElegible);
  }
  const idMeta = cotejo['idMeta'];

  // 10. La ruta. La guardada en el cierre, si es la de ESTE comercio y ESTE mensaje; si no, se deriva.
  const almacen = almacenDeComprobantes();
  const candidatas: string[] = [];
  const guardada = rutaValidaDe(privado.exists ? privado.get('rutaComprobante') : undefined, tenantId, idMeta);
  if (guardada !== null) {
    candidatas.push(guardada);
  } else {
    const en: unknown = cotejo['en'];
    const enMs = en instanceof Timestamp ? en.toMillis() : Number.NaN;
    if (Number.isFinite(enMs)) {
      for (const dia of [diaDeLaPaz(enMs), diaDeLaPaz(enMs - DIA_MS)]) {
        for (const ext of EXTENSIONES) {
          const ruta = rutaValidaDe(rutaDeComprobante(tenantId, dia, idMeta, ext), tenantId, idMeta);
          if (ruta !== null) candidatas.push(ruta);
        }
      }
    }
  }
  let ruta: string | null = null;
  let tamano = 0;
  for (const candidata of candidatas) {
    let meta: { tamano: number } | null;
    try {
      meta = await almacen.metadatos(candidata);
    } catch {
      return rechazar('error_almacen', 'unavailable', MENSAJES.noDisponible);
    }
    if (meta !== null) { ruta = candidata; tamano = meta.tamano; break; }
  }
  if (ruta === null) return rechazar('sin_comprobante', 'not-found', MENSAJES.noHay);

  // 11. El tamaño, SIN descargar.
  const maximo = extensionDe(ruta) === 'pdf' ? MAXIMO_PDF : MAXIMO_IMAGEN;
  if (!(tamano <= maximo)) return rechazar('demasiado_grande', 'failed-precondition', MENSAJES.noElegible);

  // 12. Los bytes.
  let bytes: Buffer | null;
  try {
    bytes = await almacen.leer(ruta);
  } catch {
    return rechazar('error_almacen', 'unavailable', MENSAJES.noDisponible);
  }
  if (bytes === null) return rechazar('sin_comprobante', 'not-found', MENSAJES.noHay);
  if (bytes.length > maximo) return rechazar('demasiado_grande', 'failed-precondition', MENSAJES.noElegible);

  // 13. El tipo, por los bytes, y de acuerdo con la extensión. Nunca el contentType guardado.
  const tipo = tipoPorFirma(bytes);
  if (tipo === null || tipo.ext !== extensionDe(ruta) || !(MIMES_DEL_VISOR as readonly string[]).includes(tipo.mime)) {
    return rechazar('tipo_no_coincide', 'failed-precondition', MENSAJES.noElegible);
  }

  // 14. FAIL-CLOSED: si la vista no quedó anotada, no sale ningún byte.
  try {
    await auditar(tenantId, 'comprobante_visto', uid, { rol, cierreId, resultado: 'ok' });
  } catch (e) {
    registrarRechazo('unavailable', uid, `auditoria_${codigoDe(e)}`);
    throw new HttpsError('unavailable', MENSAJES.noDisponible);
  }

  // 15. Exactamente esto y nada más.
  return { mime: tipo.mime, base64: bytes.toString('base64') };
}
