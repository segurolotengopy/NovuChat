/**
 * Ayudantes de autorización del lado servidor, compartidos por las Cloud
 * Functions invocables.
 *
 * Las Cloud Functions NO están sujetas a firestore.rules: usan el SDK Admin y se
 * las saltan. Por eso cada función vuelve a comprobar el permiso a mano, desde
 * los claims del token que Firebase ya verificó. Confiar en que «el panel solo
 * muestra el botón al admin» sería confiar en el navegador.
 *
 * Vivían en `index.ts`; se movieron acá cuando aparecieron los módulos de
 * cuentas y de cobro, que los necesitan y no pueden importar a su propio
 * importador sin crear un ciclo.
 */
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { Rol } from './claims.js';

export const claims = (p: CallableRequest) => {
  const nc = p.auth?.token?.['nc'];
  if (typeof nc !== 'object' || nc === null) return { p: false, t: {} as Record<string, Rol> };
  const b = nc as Record<string, unknown>;
  return {
    p: b['p'] === true,
    t: (typeof b['t'] === 'object' && b['t'] !== null ? b['t'] : {}) as Record<string, Rol>,
  };
};

export const exigirAutenticado = (p: CallableRequest): string => {
  if (!p.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.');
  return p.auth.uid;
};

export const exigirPropietario = (p: CallableRequest): string => {
  const uid = exigirAutenticado(p);
  if (!claims(p).p) throw new HttpsError('permission-denied', 'Solo NovuChat.');
  return uid;
};

export const exigirAdminDe = (p: CallableRequest, tenantId: string): string => {
  const uid = exigirAutenticado(p);
  if (claims(p).t[tenantId] !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
  }
  return uid;
};

export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
// `phone_number_id` de Meta: dígitos. Se valida el formato para que jamás se
// use como parte de una ruta de Firestore un valor con barras o puntos.
export const ID_NUMERO = /^[0-9]{6,25}$/;
/** Un teléfono de WhatsApp: solo dígitos con el código de país, sin `+`. */
export const TELEFONO = /^[0-9]{8,15}$/;
// Un flujo por vertical. Ver DISENO.md §Varios flujos y varios números.
export const VERTICALES = new Set(['agendamiento', 'venta', 'interno']);

export const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max).trim() : '';

export const auditar = (tenantId: string, accion: string, uid: string, detalle: object = {}) =>
  getFirestore().collection(`tenants/${tenantId}/auditoria`).add({
    accion, uid, en: Timestamp.now(), ...detalle,
  });

/** Exige un identificador de comercio bien formado, o lanza. */
export function tenantDe(datos: Record<string, unknown>): string {
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  return tenantId;
}
