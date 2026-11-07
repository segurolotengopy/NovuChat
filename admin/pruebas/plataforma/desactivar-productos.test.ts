/**
 * `desactivar-productos.mjs`: pone `activo:false` solo en ids nombrados de una lista cerrada, sin borrar. db falso; se prueba NEGANDO.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { analizarArgumentos, ejecutar, leerRespaldoPropio, planear } from '../../scripts/plataforma/desactivar-productos.mjs';

const IDS = ['closer-ventas', 'libro-bonos', 'videos-ia'];
const ENV = { GCP_PROJECT_ID_STAGING: 'proy-staging-x', GCP_PROJECT_ID_PROD: 'proy-prod-x' };
const dirs: string[] = [];
const carpeta = () => { const d = mkdtempSync(join(tmpdir(), 'desact-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** db falso: cada doc guarda `activo` y un registro de lo escrito. */
const dbFalso = (estado: Record<string, any>) => {
  const escrituras: Array<[string, any, any]> = [];
  const doc = (ruta: string) => {
    const id = ruta.split('/').pop() as string;
    return {
      get: async () => ({ exists: id in estado, get: (c: string) => (c === 'nombre' ? `Prod ${id}` : estado[id]?.[c]), updateTime: `t-${id}`, ref: doc(ruta) }),
      update: async (campos: any, pre: any) => { escrituras.push([id, campos, pre]); estado[id] = { ...estado[id], ...campos }; },
    };
  };
  return { db: { doc }, escrituras, estado };
};
const cfg = (extra = {}) => ({ proyecto: 'proy-prod-x', entorno: 'produccion', tenant: 'rroca-ruben', ids: IDS, aplicar: false, revertir: false, respaldo: null, ...extra });
const mudo = { log: () => {} };

describe('desactivar-productos: argumentos', () => {
  const base = ['--proyecto', 'proy-prod-x', '--tenant', 'rroca-ruben', '--ids', IDS.join(',')];
  it('acepta el seco válido', () => { expect(analizarArgumentos(base, ENV).ok).toBe(true); });
  it('NIEGA tenant ajeno, id fuera de la lista, repetidos, opciones raras y --aplicar sin respaldo ni confirmación', () => {
    expect(analizarArgumentos(['--proyecto', 'proy-prod-x', '--tenant', 'qtaco', '--ids', 'libro-bonos'], ENV).ok).toBe(false);
    expect(analizarArgumentos(['--proyecto', 'proy-prod-x', '--tenant', 'rroca-ruben', '--ids', 'pack-completo'], ENV).ok).toBe(false);
    expect(analizarArgumentos(['--proyecto', 'proy-prod-x', '--tenant', 'rroca-ruben', '--ids', 'libro-bonos,libro-bonos'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...base, '--borrar'], ENV).ok).toBe(false);
    const r = analizarArgumentos([...base, '--aplicar'], ENV);
    expect(r.ok).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/respaldo/);
    expect(r.problemas.join(' ')).toMatch(/confirmo-produccion/);
  });
  it('--revertir no lleva --ids y exige respaldo', () => {
    expect(analizarArgumentos(['--proyecto', 'proy-prod-x', '--tenant', 'rroca-ruben', '--revertir', '--ids', 'libro-bonos'], ENV).ok).toBe(false);
    expect(analizarArgumentos(['--proyecto', 'proy-prod-x', '--tenant', 'rroca-ruben', '--revertir'], ENV).ok).toBe(false);
  });
});

describe('desactivar-productos: plan y ejecución', () => {
  it('planear separa activos, ya inactivos, inexistentes y valores raros', () => {
    const m = new Map<string, any>([['closer-ventas', { activo: true }], ['libro-bonos', { activo: false }], ['videos-ia', { activo: 'no' }]]);
    const p = planear([...IDS, 'x'], m);
    expect(p).toEqual({ aDesactivar: ['closer-ventas'], yaInactivos: ['libro-bonos'], noExisten: ['x'], noReconocidos: ['videos-ia'] });
  });
  it('el seco no escribe', async () => {
    const w = dbFalso({ 'closer-ventas': { activo: true }, 'libro-bonos': { activo: true }, 'videos-ia': { activo: true } });
    expect(await ejecutar(cfg(), { db: w.db, ...mudo })).toBe(1);
    expect(w.escrituras).toHaveLength(0);
  });
  it('NIEGA escribir si un id no existe o tiene un valor raro', async () => {
    for (const estado of [{ 'closer-ventas': { activo: true }, 'libro-bonos': { activo: true } }, { 'closer-ventas': { activo: true }, 'libro-bonos': { activo: 'no' }, 'videos-ia': { activo: true } }]) {
      const w = dbFalso(estado);
      const r = analizarArgumentos(['--proyecto', 'proy-prod-x', '--tenant', 'rroca-ruben', '--ids', IDS.join(','), '--aplicar', '--respaldo', join(carpeta(), 'r.json'), '--confirmo-produccion', 'rroca-ruben'], ENV);
      expect(await ejecutar({ ...r.cfg, aplicar: true }, { db: w.db, ...mudo })).toBe(2);
      expect(w.escrituras).toHaveLength(0);
    }
  });
  it('aplicar respalda, escribe SOLO activo:false con precondición, y la reversa lo devuelve a true', async () => {
    const w = dbFalso({ 'closer-ventas': { activo: true }, 'libro-bonos': { activo: true }, 'videos-ia': { activo: false } });
    const ruta = join(carpeta(), 'r.json');
    expect(await ejecutar(cfg({ aplicar: true, respaldo: ruta }), { db: w.db, ...mudo })).toBe(0);
    expect(w.escrituras.map((e) => e[0])).toEqual(['closer-ventas', 'libro-bonos']);
    for (const [, campos, pre] of w.escrituras) { expect(campos).toEqual({ activo: false }); expect(pre.lastUpdateTime).toMatch(/^t-/); }
    expect(existsSync(ruta)).toBe(true);
    const guardado = JSON.parse(readFileSync(ruta, 'utf8'));
    expect(guardado.items.map((x: any) => x.id)).toEqual(['closer-ventas', 'libro-bonos']);
    // reversa
    w.escrituras.length = 0;
    expect(await ejecutar(cfg({ revertir: true, aplicar: true, respaldo: ruta, ids: [] }), { db: w.db, ...mudo })).toBe(0);
    expect(w.escrituras.map((e) => [e[0], e[1].activo])).toEqual([['closer-ventas', true], ['libro-bonos', true]]);
    expect(w.estado['videos-ia'].activo).toBe(false); // el que ya estaba inactivo no se toca
  });
  it('la reversa NIEGA un respaldo con ids ajenos, permisos abiertos u otro entorno', () => {
    const d = carpeta();
    const hacer = (nombre: string, contenido: any, modo = 0o600) => { const p = join(d, nombre); writeFileSync(p, JSON.stringify(contenido)); chmodSync(p, modo); return p; };
    const ok = { version: 1, entorno: 'produccion', tenant: 'rroca-ruben', items: [{ id: 'libro-bonos', previo: true }] };
    expect(leerRespaldoPropio(hacer('ok.json', ok), { entorno: 'produccion', tenant: 'rroca-ruben' }).ok).toBe(true);
    expect(leerRespaldoPropio(hacer('ajeno.json', { ...ok, items: [{ id: 'pack-completo', previo: true }] }), { entorno: 'produccion', tenant: 'rroca-ruben' }).ok).toBe(false);
    expect(leerRespaldoPropio(hacer('abierto.json', ok, 0o644), { entorno: 'produccion', tenant: 'rroca-ruben' }).ok).toBe(false);
    expect(leerRespaldoPropio(hacer('otro.json', { ...ok, entorno: 'staging' }), { entorno: 'produccion', tenant: 'rroca-ruben' }).ok).toBe(false);
    expect(leerRespaldoPropio(hacer('previo.json', { ...ok, items: [{ id: 'libro-bonos', previo: false }] }), { entorno: 'produccion', tenant: 'rroca-ruben' }).ok).toBe(false);
  });
  it('el script nunca borra documentos ni crea', () => {
    const f = readFileSync(join(__dirname, '../../scripts/plataforma/desactivar-productos.mjs'), 'utf8');
    expect(f).not.toMatch(/(ref|db|doc\([^)]*\))\.(delete|set|create|add)\(|FieldValue\.delete|batch\(|runTransaction/);
  });
});
