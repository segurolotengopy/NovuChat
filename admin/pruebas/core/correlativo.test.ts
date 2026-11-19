/**
 * CORRELATIVO DEL PEDIDO — `<prefijo>-AAMMDD-NNN` (Walisuma, PR-S).
 *
 * Contador del día en `tenants/{t}/contadores/pedidos-AAMMDD`, día de La Paz (UTC-4 fijo),
 * asignado DENTRO de una transacción. Pruebas: formas puras (día, prefijo, formato),
 * concurrencia contra el emulador y reinicio por día.
 *
 * LO QUE SE NIEGA: sin prefijo no hay código; dos pedidos simultáneos nunca reciben el mismo
 * número; las 23:59 de La Paz y las 00:00 siguientes caen en contadores distintos.
 */
import { describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { diaLaPaz, prefijoDeCodigo, formarCodigo, leerCorrelativo, escribirCorrelativo } =
  await import('../../functions/src/core/turno/correlativo.ts');

// 18/11/2026 12:00 en La Paz = 16:00 UTC.
const MEDIODIA = Date.UTC(2026, 10, 18, 16, 0, 0);

describe('formas puras', () => {
  it('el día es el de La Paz con año de 2 dígitos: 18/11/2026 → 261118', () => {
    expect(diaLaPaz(MEDIODIA)).toBe('261118');
  });
  it('23:59 en La Paz sigue siendo el 18; 00:00 en La Paz ya es el 19 (UTC-4 fijo)', () => {
    const a = Date.UTC(2026, 10, 19, 3, 59, 59);   // 23:59:59 del 18 en La Paz
    const b = Date.UTC(2026, 10, 19, 4, 0, 0);     // 00:00 del 19 en La Paz
    expect(diaLaPaz(a)).toBe('261118');
    expect(diaLaPaz(b)).toBe('261119');
  });
  it('a las 20:30 en La Paz de un 31/12 ya es otro día en UTC pero NO en La Paz; cruza el año con 2 dígitos', () => {
    expect(diaLaPaz(Date.UTC(2027, 0, 1, 3, 59, 0))).toBe('261231');
    expect(diaLaPaz(Date.UTC(2027, 0, 1, 4, 0, 0))).toBe('270101');
  });
  it('el prefijo sale del dato del tenant; sin dato o con basura, no hay prefijo', () => {
    expect(prefijoDeCodigo({ prefijoCodigo: 'WAL' })).toBe('WAL');
    expect(prefijoDeCodigo({ prefijoCodigo: ' wal ' })).toBe('WAL');
    expect(prefijoDeCodigo(undefined)).toBeNull();
    expect(prefijoDeCodigo({})).toBeNull();
    expect(prefijoDeCodigo({ prefijoCodigo: '' })).toBeNull();
    expect(prefijoDeCodigo({ prefijoCodigo: 7 })).toBeNull();
    expect(prefijoDeCodigo({ prefijoCodigo: 'A/B' })).toBeNull();
    expect(prefijoDeCodigo({ prefijoCodigo: 'DEMASIADOLARGO' })).toBeNull();
  });
  it('el código es <prefijo>-AAMMDD-NNN con tres dígitos', () => {
    expect(formarCodigo('WAL', '261118', 1)).toBe('WAL-261118-001');
    expect(formarCodigo('WAL', '261118', 42)).toBe('WAL-261118-042');
    expect(formarCodigo('WAL', '261118', 1000)).toBe('WAL-261118-1000');
  });
});

describe('transacción del contador (emulador)', () => {
  const T = 'correlativo-prueba';
  const ref = (dia: string) => db.doc(`tenants/${T}/contadores/pedidos-${dia}`);

  async function asignar(ms: number): Promise<string> {
    return db.runTransaction(async (tx) => {
      const c = await leerCorrelativo(tx, db, T, ms);
      escribirCorrelativo(tx, c);
      return formarCodigo('WAL', c.dia, c.n);
    });
  }

  it('el contador del día arranca en 001 y sigue 002, 003', async () => {
    await ref('261118').delete();
    expect(await asignar(MEDIODIA)).toBe('WAL-261118-001');
    expect(await asignar(MEDIODIA)).toBe('WAL-261118-002');
    expect(await asignar(MEDIODIA)).toBe('WAL-261118-003');
    expect((await ref('261118').get()).get('ultimo')).toBe(3);
  });

  it('diez pedidos simultáneos del mismo día reciben correlativos distintos y sin huecos', async () => {
    await ref('261120').delete();
    const ms = Date.UTC(2026, 10, 20, 16, 0, 0);
    const codigos = await Promise.all(Array.from({ length: 10 }, () => asignar(ms)));
    expect(new Set(codigos).size).toBe(10);
    expect([...codigos].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `WAL-261120-${String(i + 1).padStart(3, '0')}`));
    expect((await ref('261120').get()).get('ultimo')).toBe(10);
  });

  it('el correlativo se reinicia por día de La Paz: 23:59 y 00:00 usan contadores distintos', async () => {
    await ref('261125').delete(); await ref('261126').delete();
    const a = Date.UTC(2026, 10, 26, 3, 59, 0);   // 23:59 del 25
    const b = Date.UTC(2026, 10, 26, 4, 0, 0);    // 00:00 del 26
    expect(await asignar(a)).toBe('WAL-261125-001');
    expect(await asignar(a)).toBe('WAL-261125-002');
    expect(await asignar(b)).toBe('WAL-261126-001');
  });

  it('un contador de otro comercio no se toca', async () => {
    const otro = db.doc('tenants/correlativo-otro/contadores/pedidos-261118');
    await otro.delete();
    await asignar(MEDIODIA);
    expect((await otro.get()).exists).toBe(false);
  });
});
