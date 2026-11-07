/**
 * `cobro-ensayo-ruben.mjs`: copia el QR real de Rubén al comercio `ensayo` y lo quita. Núcleo puro con io falso; se prueba NEGANDO.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { analizarArgumentos, ejecutar } from '../../scripts/plataforma/cobro-ensayo-ruben.mjs';

const ENV = { GCP_PROJECT_ID_STAGING: 'proy-staging-x', GCP_PROJECT_ID_PROD: 'proy-prod-x' };
const ORIGEN = { registradoPor: 'uid-de-rubén', registradoEn: 'ayer', cargaUtil: 'CARGA-DE-PRUEBA', venceEl: '2027-06-30', activo: true, ficha: 'f'.repeat(32), nombreCuenta: 'Cuenta de prueba' };
const mundo = (origen: any, destino: any = undefined, media = false) => {
  const e = { origen, destino, media, escrituras: [] as any[], quitadas: 0, auditorias: [] as string[] };
  return {
    e,
    io: {
      leerOrigen: async () => e.origen,
      leerDestino: async () => e.destino,
      hayMediaId: async () => e.media,
      escribir: async (c: any) => { e.escrituras.push(c); e.destino = c; },
      quitar: async () => { e.quitadas += 1; e.destino = undefined; e.media = false; },
      auditar: async (a: string) => { e.auditorias.push(a); },
    },
  };
};
const mudo = () => {};
const base = { hoy: '2026-11-07', log: mudo };

describe('cobro-ensayo-ruben: argumentos', () => {
  const p = ['--proyecto', 'proy-prod-x'];
  it('acepta copiar y quitar en seco', () => {
    expect(analizarArgumentos([...p, '--copiar'], ENV).ok).toBe(true);
    expect(analizarArgumentos([...p, '--quitar'], ENV).ok).toBe(true);
  });
  it('NIEGA ambos o ninguno, opciones raras, y --aplicar en producción sin la confirmación exacta', () => {
    expect(analizarArgumentos([...p, '--copiar', '--quitar'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...p], ENV).ok).toBe(false);
    expect(analizarArgumentos([...p, '--copiar', '--tenant', 'x'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...p, '--copiar', '--aplicar'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...p, '--copiar', '--aplicar', '--confirmo-produccion', 'rroca-ruben'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...p, '--copiar', '--aplicar', '--confirmo-produccion', 'ensayo'], ENV).ok).toBe(true);
  });
});

describe('cobro-ensayo-ruben: copiar', () => {
  it('en seco no escribe', async () => {
    const m = mundo(ORIGEN);
    expect(await ejecutar({ ...base, modo: 'copiar', aplicar: false, io: m.io })).toBe(1);
    expect(m.e.escrituras).toHaveLength(0);
  });
  it('aplicar escribe SOLO el cobro con ficha nueva distinta de la de origen, encendido y marcado, y audita', async () => {
    const m = mundo(ORIGEN);
    expect(await ejecutar({ ...base, modo: 'copiar', aplicar: true, nuevaFicha: () => 'a'.repeat(32), io: m.io })).toBe(0);
    expect(m.e.escrituras).toHaveLength(1);
    expect(m.e.escrituras[0].ficha).toBe('a'.repeat(32));
    expect(m.e.escrituras[0].ficha).not.toBe(ORIGEN.ficha);
    expect(m.e.escrituras[0].activo).toBe(true);
    expect(m.e.escrituras[0].copiadoDe).toBe('ensayo-rroca-ruben');
    expect(m.e.escrituras[0].registradoPor).toBeUndefined();
    expect(m.e.escrituras[0].registradoEn).toBeUndefined();
    expect(m.e.escrituras[0].cargaUtil).toBe('CARGA-DE-PRUEBA');
    expect(m.e.auditorias).toEqual(['copiar_cobro_ensayo_ruben']);
  });
  it('NIEGA origen ausente, vencido, de monto fijo, sin carga o apagado', async () => {
    for (const o of [undefined, { ...ORIGEN, venceEl: '2026-01-01' }, { ...ORIGEN, montoFijo: 5 }, { ...ORIGEN, cargaUtil: '' }, { ...ORIGEN, activo: false }]) {
      const m = mundo(o);
      expect(await ejecutar({ ...base, modo: 'copiar', aplicar: true, io: m.io })).toBe(2);
      expect(m.e.escrituras).toHaveLength(0);
    }
  });
  it('NIEGA pisar un cobro de otro origen en ensayo', async () => {
    const m = mundo(ORIGEN, { ...ORIGEN, ficha: 'b'.repeat(32), copiadoDe: undefined });
    expect(await ejecutar({ ...base, modo: 'copiar', aplicar: true, io: m.io })).toBe(2);
    expect(m.e.escrituras).toHaveLength(0);
  });
  it('NO imprime la carga útil ni las fichas', async () => {
    const salida: string[] = [];
    const m = mundo(ORIGEN);
    await ejecutar({ ...base, modo: 'copiar', aplicar: true, nuevaFicha: () => 'a'.repeat(32), io: m.io, log: (t: string) => salida.push(t) });
    const t = salida.join('\n');
    expect(t).not.toContain('CARGA-DE-PRUEBA');
    expect(t).not.toContain('a'.repeat(32));
    expect(t).not.toContain('f'.repeat(32));
    expect(t).not.toContain('Cuenta de prueba');
  });
});

describe('cobro-ensayo-ruben: vencimiento y reversa ajena', () => {
  it('NIEGA copiar después de la fecha de la excepción', async () => {
    const m = mundo(ORIGEN);
    expect(await ejecutar({ hoy: '2026-11-10', log: mudo, modo: 'copiar', aplicar: true, io: m.io })).toBe(2);
    expect(m.e.escrituras).toHaveLength(0);
  });
  it('NIEGA quitar un cobro que este script no copió', async () => {
    const m = mundo(ORIGEN, { ...ORIGEN, copiadoDe: undefined }, true);
    expect(await ejecutar({ ...base, modo: 'quitar', aplicar: true, io: m.io })).toBe(2);
    expect(m.e.quitadas).toBe(0);
  });
});

describe('cobro-ensayo-ruben: quitar (reversa)', () => {
  it('en seco no borra; aplicar borra cobro y media id y audita; sin nada, sale 0', async () => {
    const m = mundo(ORIGEN, { ...ORIGEN, copiadoDe: 'ensayo-rroca-ruben' }, true);
    expect(await ejecutar({ ...base, modo: 'quitar', aplicar: false, io: m.io })).toBe(1);
    expect(m.e.quitadas).toBe(0);
    expect(await ejecutar({ ...base, modo: 'quitar', aplicar: true, io: m.io })).toBe(0);
    expect(m.e.quitadas).toBe(1);
    expect(m.e.auditorias).toEqual(['quitar_cobro_ensayo_ruben']);
    expect(await ejecutar({ ...base, modo: 'quitar', aplicar: true, io: m.io })).toBe(0);
    expect(m.e.quitadas).toBe(1);
  });
});

describe('cobro-ensayo-ruben: el script', () => {
  it('solo toca config/venta de ensayo y no lee otro origen que Rubén', () => {
    const f = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/plataforma/cobro-ensayo-ruben.mjs'), 'utf8');
    expect(f).toContain("ORIGEN = 'rroca-ruben'");
    expect(f).toContain("DESTINO = 'ensayo'");
    expect(f).not.toMatch(/(refD|refO|db\.doc\([^)]*\))\.delete\(/);
    expect(f).not.toMatch(/refO\.(set|update|delete|create)\(/);
    expect(f).not.toMatch(/console\.(log|error)\([^)]*cargaUtil/);
  });
});
