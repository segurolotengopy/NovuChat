/**
 * CORRELATIVO DEL PEDIDO — `<prefijo>-AAMMDD-NNN` (Walisuma).
 *
 * El código lo asigna el SERVIDOR, nunca el flujo: un contador en `staticData` de n8n se
 * pierde con ejecuciones concurrentes (cada una graba al terminar) y dos clientes recibirían
 * el mismo código. Acá el contador vive en `tenants/{t}/contadores/pedidos-AAMMDD` y se mueve
 * DENTRO de la transacción del cotejo, que reintenta si dos pedidos compiten por el mismo
 * documento: nunca hay dos iguales ni huecos.
 *
 * EL DÍA ES EL DE LA PAZ (UTC-4 fijo, Bolivia no cambia de hora) con año de 2 dígitos:
 * 18/11/2026 → 261118. A las 23:59 de La Paz todavía es el 18; a las 00:00, el 19.
 *
 * SIN PREFIJO NO HAY CÓDIGO. El prefijo es un dato del comercio (`config/pedidos.prefijoCodigo`):
 * los comercios que no lo tienen siguen exactamente como antes, sin contador ni campo nuevo.
 *
 * Vive en Core porque lo usan el cotejo del comprobante (Cobros) y los pedidos, y un módulo no importa de otro
 * sin declararlo. El contador se llama `pedidos-AAMMDD`.
 *
 * USO (lecturas primero, escrituras después, como exige Firestore):
 *   const c = await leerCorrelativo(tx, db, tenantId, ahoraMs);   // junto con las demás lecturas
 *   ...
 *   escribirCorrelativo(tx, c);                                   // junto con las demás escrituras
 *   formarCodigo(prefijo, c.dia, c.n);
 */
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
/** Bolivia no cambia de hora: UTC−4 todo el año (el mismo valor que `cobros/cotejo.ts`; Core no importa de un módulo). */
const OFFSET_LA_PAZ_HORAS = -4;

/** Letras y números, de 2 a 6: entra en un código corto y no puede traer `/` ni espacios. */
const PREFIJO_VALIDO = /^[A-Z0-9]{2,6}$/;

/** El día de La Paz de un instante, como AAMMDD (año de 2 dígitos). */
export function diaLaPaz(ms: number): string {
  const d = new Date(ms + OFFSET_LA_PAZ_HORAS * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(d.getUTCFullYear() % 100)}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}`;
}

/** El prefijo del comercio, o `null` si no hay (o si lo guardado no es válido): sin prefijo, sin código. */
export function prefijoDeCodigo(configPedidos: Record<string, unknown> | undefined | null): string | null {
  const crudo = configPedidos?.['prefijoCodigo'];
  if (typeof crudo !== 'string') return null;
  const p = crudo.trim().toUpperCase();
  return PREFIJO_VALIDO.test(p) ? p : null;
}

/** `WAL-261118-001`. Pasa de 999 sin cortarse. */
export function formarCodigo(prefijo: string, dia: string, n: number): string {
  return `${prefijo}-${dia}-${String(n).padStart(3, '0')}`;
}

export interface Correlativo {
  ref: DocumentReference;
  /** AAMMDD de La Paz. */
  dia: string;
  /** El número que le toca a este pedido (el último + 1). */
  n: number;
}

/** LEE el contador del día (dentro de la transacción) y dice qué número toca. No escribe. */
export async function leerCorrelativo(tx: Transaction, db: Firestore, tenantId: string, ms: number): Promise<Correlativo> {
  const dia = diaLaPaz(ms);
  const ref = db.doc(`tenants/${tenantId}/contadores/pedidos-${dia}`);
  const previo = (await tx.get(ref)).get('ultimo');
  const ultimo = typeof previo === 'number' && Number.isInteger(previo) && previo >= 0 ? previo : 0;
  return { ref, dia, n: ultimo + 1 };
}

/** ESCRIBE el contador con el número asignado. Va en la misma transacción que la lectura. */
export function escribirCorrelativo(tx: Transaction, c: Correlativo): void {
  tx.set(c.ref, { dia: c.dia, ultimo: c.n, actualizadoEn: FieldValue.serverTimestamp() });
}
