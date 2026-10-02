/**
 * Ayudantes compartidos por los callables de `plataforma/tenants.ts` y de
 * `central/` (usuarios, reclamos, vista previa del asistente). Salieron de
 * `index.ts` sin cambiar una línea (F2, P1). Viven en Central porque la
 * zona más baja que los usa es Central y Plataforma depende de Central.
 */
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

export const db = () => getFirestore();

export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

export const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max).trim() : '';

export const auditar = (tenantId: string, accion: string, uid: string, detalle: object = {}) =>
  db().collection(`tenants/${tenantId}/auditoria`).add({
    accion, uid, en: Timestamp.now(), ...detalle,
  });
