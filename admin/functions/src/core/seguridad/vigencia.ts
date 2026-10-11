/**
 * =============================================================================
 * VIGENCIA — lo que el token no sabe y el servidor sí puede comprobar
 * =============================================================================
 *
 * Una callable que entrega algo sensible (hoy, el comprobante de un cobro) no
 * puede fiarse solo del token: un ID token vale hasta una hora después de que
 * se retiró el rol, se deshabilitó la cuenta o se cerró la sesión. Las reglas
 * de Firestore tienen la misma limitación en los claims, pero sí leen el
 * documento de soporte en cada operación; una callable se salta las reglas
 * (usa el SDK Admin), así que las dos comprobaciones se repiten acá, a mano:
 *
 *   `soporteVigenteDe`  ¿el negocio concedió una ventana al propietario y
 *                       todavía no vence? Espejo de `soporteVigente()` en
 *                       `firestore.rules` (l.317-322).
 *   `cuentaVigenteDe`   ¿la cuenta sigue existiendo, habilitada, con el rol
 *                       que dice el token, y el token es posterior a la última
 *                       revocación de sesiones? (Auth, no el token.)
 *
 * Solo dependen de `./autorizacion.js` y de paquetes npm: el core no importa
 * hacia arriba (`pruebas/frontera/fronteras.test.ts`).
 *
 * FAIL-CLOSED. Todo dato ausente o de forma inesperada niega. Los errores de
 * infraestructura (Firestore, Auth caído) se PROPAGAN: quien llama decide si es
 * «no disponible»; convertirlos en `false` diría «sin permiso» a quien tiene
 * permiso, y convertirlos en `true` abriría la puerta por una falla.
 */
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { esPropietario } from './autorizacion.js';

/** El rol con el que una petición fue autorizada por el token. */
export type RolVerificado = 'admin' | 'oper' | 'soporte';

/** Forma mínima de un id de comercio para usarlo como segmento de ruta. */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,60}$/;
/** Firestore reserva `__nombre__` como id de documento: leerlo lanza, no niega. */
const ID_RESERVADO = /^__.*__$/;
/** Un uid de Firebase Auth (alfanumérico) como segmento de ruta. */
const UID_SEGURO = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * ¿El propietario de NovuChat tiene una ventana de soporte vigente en ESE
 * comercio?
 *
 * Espejo EXACTO de `soporteVigente()` en `firestore.rules`:
 *   esPropietario() && exists(accesosSoporte/{uid})
 *   && get(...).data.get('expira', request.time) > request.time
 * Sin `expira`, o con algo que no es un Timestamp, la comparación de las reglas
 * no da verdadero: acá tampoco. Un documento borrado (revocado) no existe.
 */
export async function soporteVigenteDe(
  p: CallableRequest, tenantId: string, ahoraMs: number,
): Promise<boolean> {
  if (!esPropietario(p)) return false;
  const uid = p.auth?.uid;
  if (typeof uid !== 'string' || !UID_SEGURO.test(uid)) return false;
  if (typeof tenantId !== 'string' || !ID_SEGURO.test(tenantId) || ID_RESERVADO.test(tenantId)) return false;
  if (typeof ahoraMs !== 'number' || !Number.isFinite(ahoraMs)) return false;

  const snap = await getFirestore().doc(`tenants/${tenantId}/accesosSoporte/${uid}`).get();
  if (!snap.exists) return false;
  const expira: unknown = snap.data()?.['expira'];
  return expira instanceof Timestamp && expira.toMillis() > ahoraMs;
}

/** Lo que se necesita de una cuenta de Auth; `UserRecord` lo cumple. */
export type CuentaLeida = Pick<UserRecord, 'disabled' | 'customClaims' | 'tokensValidAfterTime'>;
export type LectorDeCuenta = (uid: string) => Promise<CuentaLeida>;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * ¿La cuenta sigue vigente para este rol?
 *
 *  - la cuenta ya no existe (`auth/user-not-found`)              → falso
 *  - está deshabilitada (cualquier valor distinto de `false`)    → falso
 *  - rol soporte: el claim `nc.p` ya no es `true`                → falso
 *  - otro rol: `nc.t` ya no tiene ESE comercio como clave propia,
 *    o su valor ya no es el rol del token                        → falso
 *  - `auth_time` ausente o no finito                             → falso
 *  - `tokensValidAfterTime` existe y la sesión es anterior       → falso
 *    (el usuario cerró sesiones o se le retiró el acceso)
 *
 * Cualquier otro error del lector se propaga: no es una respuesta.
 *
 * @param authTimeSeg `auth_time` del token, en segundos.
 * @param leer        inyectable; por defecto `getAuth().getUser`. No hay
 *                    emulador de Auth en las pruebas.
 */
export async function cuentaVigenteDe(
  uid: string, authTimeSeg: number, rol: RolVerificado, tenantId: string,
  leer: LectorDeCuenta = (u) => getAuth().getUser(u),
): Promise<boolean> {
  if (typeof authTimeSeg !== 'number' || !Number.isFinite(authTimeSeg)) return false;

  let cuenta: CuentaLeida;
  try {
    cuenta = await leer(uid);
  } catch (e) {
    if (esObjeto(e) && e['code'] === 'auth/user-not-found') return false;
    throw e;
  }

  if (cuenta.disabled !== false) return false;

  const nc = esObjeto(cuenta.customClaims) ? cuenta.customClaims['nc'] : undefined;
  if (!esObjeto(nc)) return false;
  if (rol === 'soporte') {
    if (nc['p'] !== true) return false;
  } else {
    const t = nc['t'];
    if (!esObjeto(t) || !Object.hasOwn(t, tenantId) || t[tenantId] !== rol) return false;
  }

  if (cuenta.tokensValidAfterTime !== undefined && cuenta.tokensValidAfterTime !== null) {
    const desde = Date.parse(cuenta.tokensValidAfterTime);
    // Una fecha ilegible no se interpreta a favor de nadie.
    if (!Number.isFinite(desde)) return false;
    if (authTimeSeg * 1000 < desde) return false;
  }
  return true;
}
