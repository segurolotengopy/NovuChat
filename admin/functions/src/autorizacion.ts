/**
 * =============================================================================
 * AUTORIZACIÓN DE LAS CALLABLES — un solo criterio de quién es quién
 * =============================================================================
 *
 * Las Cloud Functions NO están sujetas a `firestore.rules`: usan el SDK Admin y
 * se las saltan. Por eso cada callable vuelve a comprobar el permiso a mano,
 * desde los claims del token que Firebase ya verificó. Confiar en que «el
 * panel solo muestra el botón al admin» sería confiar en el navegador.
 *
 * VÍNCULO ROL ↔ PROVEEDOR DE IDENTIDAD, igual que en las reglas (T-19):
 *
 *   propietario de NovuChat   → claim `nc.p` Y sesión de Google
 *   administrador del negocio → claim `nc.t[tenant] == 'admin'` Y sesión de
 *                               contraseña Y correo verificado
 *
 * Un claim puesto por error queda INERTE si la sesión no es del proveedor que
 * corresponde. Hasta el 20/09 `exigirAdminDe` miraba solo el claim
 * (`Analisis/29` §4.1: «lo mismo, al revés, en `exigirAdminDe`»); con los
 * bloques A-1, A-2 y A-3 aparecen callables de administrador que mueven
 * dinero, así que la regla pasa a ser la misma que `esAdmin()` en
 * `firestore.rules` y `storage.rules`. Si una de las tres cambia sin las
 * otras, el comercio tendría dos criterios de quién es administrador según
 * pida un documento, un archivo o una callable.
 *
 * Vive en su propio módulo para que `index.ts` y `pagos.ts` (y lo que venga)
 * apliquen exactamente la misma comprobación, sin copiarla.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { Rol } from './claims.js';

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Los claims de NovuChat del token, con forma garantizada. */
export function claimsDe(p: CallableRequest): { p: boolean; t: Record<string, Rol> } {
  const nc = p.auth?.token?.['nc'];
  if (!esObjeto(nc)) return { p: false, t: {} };
  return {
    p: nc['p'] === true,
    t: (esObjeto(nc['t']) ? nc['t'] : {}) as Record<string, Rol>,
  };
}

/** `firebase.sign_in_provider` del token, o `''`. */
export function proveedorDe(p: CallableRequest): string {
  const firebase = p.auth?.token?.['firebase'];
  const proveedor = esObjeto(firebase) ? firebase['sign_in_provider'] : undefined;
  return typeof proveedor === 'string' ? proveedor : '';
}

export function correoVerificado(p: CallableRequest): boolean {
  return p.auth?.token?.['email_verified'] === true;
}

export const exigirAutenticado = (p: CallableRequest): string => {
  if (!p.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.');
  return p.auth.uid;
};

/** ¿Es el propietario de NovuChat, con sesión de Google? */
export const esPropietario = (p: CallableRequest): boolean =>
  Boolean(p.auth?.uid) && claimsDe(p).p && proveedorDe(p) === 'google.com';

/** ¿Es administrador de ESE comercio, con contraseña y correo verificado? */
export const esAdminDe = (p: CallableRequest, tenantId: string): boolean =>
  Boolean(p.auth?.uid) && claimsDe(p).t[tenantId] === 'admin'
  && proveedorDe(p) === 'password' && correoVerificado(p);

export const exigirPropietario = (p: CallableRequest): string => {
  const uid = exigirAutenticado(p);
  if (!esPropietario(p)) throw new HttpsError('permission-denied', 'Solo NovuChat.');
  return uid;
};

export const exigirAdminDe = (p: CallableRequest, tenantId: string): string => {
  const uid = exigirAutenticado(p);
  if (!esAdminDe(p, tenantId)) {
    throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
  }
  return uid;
};

/**
 * El administrador del comercio o el propietario. Devuelve quién es, porque
 * la auditoría de un pago tiene que decir de qué lado vino la orden.
 */
export const exigirAdminOPropietario = (
  p: CallableRequest, tenantId: string,
): { uid: string; quien: 'admin' | 'propietario' } => {
  const uid = exigirAutenticado(p);
  if (esPropietario(p)) return { uid, quien: 'propietario' };
  if (esAdminDe(p, tenantId)) return { uid, quien: 'admin' };
  throw new HttpsError('permission-denied', 'Solo el administrador del negocio o NovuChat.');
};
