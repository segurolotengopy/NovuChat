/**
 * EL TIPO DE CAMBIO DEL DÍA (`functions/src/tipoCambio.ts`, bloque A-1).
 *
 * Sin TCO no se cobra (`CLAUDE.md`, base comercial §3; decisión 3 del frente):
 * `tipoCambioDe` es la validación pura y `tipoCambioDelDia` la lectura real de
 * `plataforma/tipoCambio` contra el emulador. Se escribe negando: cada forma
 * de documento que NO sirve para emitir un cobro tiene que lanzar
 * `SinTipoDeCambio`, con un motivo que el propietario pueda leer.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

await import('../functions/src/index.ts');
const { RUTA_TIPO_CAMBIO, SinTipoDeCambio, tipoCambioDe, tipoCambioDelDia } = await import('../functions/src/tipoCambio.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const DIA = 86_400_000;
const CUATRO_HORAS = 4 * 3_600_000;
/** Un instante fijo: martes 22/09/2026 a las 10:00 de Bolivia. */
const AHORA = Date.UTC(2026, 8, 22, 14, 0, 0);
const fechaBolivia = (ms: number) => new Date(ms - CUATRO_HORAS).toISOString().slice(0, 10);

const lanza = (datos: unknown, motivo: RegExp) => {
  expect(() => tipoCambioDe(datos, AHORA)).toThrow(SinTipoDeCambio);
  expect(() => tipoCambioDe(datos, AHORA)).toThrow(motivo);
};

describe('tipoCambioDe: lo que NO sirve para emitir', () => {
  it('sin documento, o sin tco', () => {
    lanza(undefined, /no hay tipo de cambio/);
    lanza(null, /no hay tipo de cambio/);
    lanza({}, /tco ausente/);
    lanza({ fecha: '2026-09-22', fuente: 'BCB' }, /tco ausente/);
    lanza({ tco: '12.6', fecha: '2026-09-22', fuente: 'BCB' }, /tco ausente/);
  });

  it('tco fuera de la cota de cordura 5..40 (un cero de más multiplica el cobro por diez)', () => {
    lanza({ tco: 126, fecha: '2026-09-22', fuente: 'BCB' }, /fuera de rango/);
    lanza({ tco: 1.26, fecha: '2026-09-22', fuente: 'BCB' }, /fuera de rango/);
    lanza({ tco: 0, fecha: '2026-09-22', fuente: 'BCB' }, /fuera de rango/);
    lanza({ tco: -12.6, fecha: '2026-09-22', fuente: 'BCB' }, /fuera de rango/);
    lanza({ tco: Number.NaN, fecha: '2026-09-22', fuente: 'BCB' }, /tco ausente/);
  });

  it('fecha ausente, mal formada o con el formato viejo del mes', () => {
    lanza({ tco: 12.6, fuente: 'BCB' }, /fecha ausente/);
    lanza({ tco: 12.6, fecha: '2026-09', fuente: 'BCB' }, /fecha ausente/);
    lanza({ tco: 12.6, fecha: '22/09/2026', fuente: 'BCB' }, /fecha ausente/);
    lanza({ tco: 12.6, periodo: '2026-09', fuente: 'BCB' }, /fecha ausente/);
  });

  it('fuente ausente o vacía', () => {
    lanza({ tco: 12.6, fecha: '2026-09-22' }, /fuente ausente/);
    lanza({ tco: 12.6, fecha: '2026-09-22', fuente: '' }, /fuente ausente/);
    lanza({ tco: 12.6, fecha: '2026-09-22', fuente: '   ' }, /fuente ausente/);
  });

  it('fecha futura, o de más de 4 días (el del viernes vale hasta el martes; el del jueves, no)', () => {
    lanza({ tco: 12.6, fecha: fechaBolivia(AHORA + DIA), fuente: 'BCB' }, /futura|más de 4 días/);
    lanza({ tco: 12.6, fecha: fechaBolivia(AHORA - 5 * DIA), fuente: 'BCB' }, /más de 4 días/);
    lanza({ tco: 12.6, fecha: '2026-08-01', fuente: 'BCB' }, /más de 4 días/);
  });
});

describe('tipoCambioDe: lo que sí sirve', () => {
  it('el de hoy, y el de hasta 4 días calendario atrás', () => {
    for (const dias of [0, 1, 2, 3, 4]) {
      const fecha = fechaBolivia(AHORA - dias * DIA);
      expect(tipoCambioDe({ tco: 12.6, fecha, fuente: 'BCB' }, AHORA)).toEqual({ tco: 12.6, fecha, fuente: 'BCB' });
    }
  });

  it('devuelve solo los tres campos, sin arrastrar lo demás del documento', () => {
    const fecha = fechaBolivia(AHORA);
    const r = tipoCambioDe({ tco: 12.6, fecha, fuente: 'BCB', actualizadoPor: 'andres', otro: 1 }, AHORA);
    expect(Object.keys(r).sort()).toEqual(['fecha', 'fuente', 'tco']);
  });

  it('la cota es inclusiva: 5 y 40 pasan', () => {
    const fecha = fechaBolivia(AHORA);
    expect(tipoCambioDe({ tco: 5, fecha, fuente: 'BCB' }, AHORA).tco).toBe(5);
    expect(tipoCambioDe({ tco: 40, fecha, fuente: 'BCB' }, AHORA).tco).toBe(40);
  });
});

describe('tipoCambioDelDia: la lectura real de plataforma/tipoCambio', () => {
  beforeEach(async () => { await db.doc(RUTA_TIPO_CAMBIO).delete(); });

  it('sin documento, lanza: nadie emite un cobro con un TCO supuesto', async () => {
    await expect(tipoCambioDelDia()).rejects.toBeInstanceOf(SinTipoDeCambio);
  });

  it('con el documento de hoy, lo devuelve', async () => {
    const fecha = fechaBolivia(Date.now());
    await db.doc(RUTA_TIPO_CAMBIO).set({ tco: 12.6, fecha, fuente: 'BCB', actualizadoPor: 'andres' });
    expect(await tipoCambioDelDia()).toEqual({ tco: 12.6, fecha, fuente: 'BCB' });
  });

  it('con un documento vencido (hace 10 días), lanza aunque el valor sea razonable', async () => {
    await db.doc(RUTA_TIPO_CAMBIO).set({ tco: 12.6, fecha: fechaBolivia(Date.now() - 10 * DIA), fuente: 'BCB' });
    await expect(tipoCambioDelDia()).rejects.toThrow(/más de 4 días/);
  });

  it('con el documento del formato viejo (`periodo`, sin `fecha`), lanza', async () => {
    await db.doc(RUTA_TIPO_CAMBIO).set({ tco: 12.6, periodo: '2026-09', fuente: 'BCB' });
    await expect(tipoCambioDelDia()).rejects.toThrow(/fecha ausente/);
  });
});
