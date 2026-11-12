/**
 * EL SCRIPT `respuesta-libre.mjs` Y LOS DATOS DE Q'TACO (12/11/2026, PR B / P2), sin emulador ni nube.
 * Vive en `pruebas/plataforma/` porque importa el script de Plataforma (la frontera de zonas no deja que una prueba de
 * core lo importe). El saneo puro está en `pruebas/core/respuesta-libre.test.ts`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r: string) => readFileSync(join(ADMIN, r), 'utf8');
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/respuesta-libre.mjs') as unknown as {
  analizarArgumentos: (a: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  cargarDatos: (n: string) => { ok: boolean; valor?: Cfg; motivo?: string };
  validarDatos: (c: unknown) => { ok: boolean; valor?: Cfg; motivo?: string };
};

describe('los datos versionados de Q\'Taco', () => {
  const crudo = JSON.parse(leer('scripts/datos/respuesta-libre/qtaco.json')) as Record<string, unknown>;
  it('pasan el saneo del servidor sin cambios', () => {
    const c = mod.cargarDatos('qtaco');
    expect(c.ok, c.motivo).toBe(true);
    expect(c.valor).toEqual(crudo);
    expect(crudo['activo']).toBe(true);
    expect(Object.keys(crudo).sort()).toEqual(['activo', 'acuse', 'textoHumor', 'textoQueja', 'textoRechazo', 'textoSeguimiento'].sort());
  });
  it('sin identificadores: ni correos, ni teléfonos ni cifras largas', () => {
    const t = JSON.stringify(crudo);
    expect(t).not.toMatch(/\d{6,}/);
    expect(t).not.toContain(String.fromCharCode(64));
    expect(t).not.toMatch(/https?:/);
  });
  it('NIEGA: datos que el saneo cambiaría o incompletos se rechazan', () => {
    expect(mod.validarDatos({ ...crudo, acuse: 'a'.repeat(301) }).ok).toBe(false);
    expect(mod.validarDatos({ ...crudo, textoHumor: 5 }).ok).toBe(false);
    expect(mod.validarDatos({ ...crudo, prohibidos: ['x'] }).ok).toBe(false);
    expect(mod.validarDatos({ ...crudo, tono: 'x' }).ok).toBe(false);
    expect(mod.validarDatos({ ...crudo, activo: false }).ok).toBe(false);
    expect(mod.validarDatos({ ...crudo, extra: 1 }).ok).toBe(false);
    const { textoQueja: _r, ...sinQueja } = crudo;
    expect(mod.validarDatos(sinQueja).ok).toBe(false);
    expect(mod.validarDatos(null).ok).toBe(false);
    expect(mod.cargarDatos('../x').ok).toBe(false);
    expect(mod.cargarDatos('no-existe').ok).toBe(false);
  });
});

describe('el script de Plataforma', () => {
  const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
  const PROY = 'demo-novuchat-pruebas';
  const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
  const dirs: string[] = [];
  const rutaRespaldo = () => { const d = mkdtempSync(join(tmpdir(), 'rl-')); chmodSync(d, 0o700); dirs.push(d); return join(d, 'r.json'); };
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const base = ['--proyecto', PROY, '--tenant', 'comercio-x'];
  const deseado = mod.cargarDatos('qtaco').valor!;

  it('seco por omisión: sin --aplicar no pide respaldo', () => {
    const r = mod.analizarArgumentos([...base, '--datos', 'qtaco'], ENV_EMU);
    expect(r.ok, String(r.problemas)).toBe(true);
    expect(r.cfg).toMatchObject({ aplicar: false, apagar: false, deseado });
  });
  it('NIEGA: --aplicar sin respaldo; sin --datos ni --apagar; ambos; datos inexistentes', () => {
    expect(mod.analizarArgumentos([...base, '--datos', 'qtaco', '--aplicar'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--datos', 'qtaco', '--apagar'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--datos', 'nadie'], ENV_EMU).ok).toBe(false);
  });
  it('NIEGA: más de un comercio, id raro, opción desconocida, proyecto sin lista blanca', () => {
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'a-1,b-2', '--datos', 'qtaco'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', '../x', '--datos', 'qtaco'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--datos', 'qtaco', '--otra', 'x'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos(['--proyecto', 'cualquier-proyecto-real', '--tenant', 'comercio-x', '--datos', 'qtaco'], {}).ok).toBe(false);
  });
  it('NIEGA: contra producción, --aplicar exige --confirmo-produccion igual al comercio', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'comercio-x', '--datos', 'qtaco', '--aplicar', '--respaldo', rutaRespaldo()];
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(false);
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'otro-comercio'], ENV_REAL).ok).toBe(false);
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'comercio-x'], ENV_REAL).ok).toBe(true);
  });

  /** Una Firestore mínima en memoria: la ficha y `config/respuestaLibre`, con cuenta de escrituras. */
  function baseDe(previo: Record<string, unknown> | null, opciones: { cambiaAntes?: boolean } = {}) {
    let doc = previo === null ? null : { ...previo };
    let hora = 1;
    const escrituras: string[] = [];
    const snap = (d: typeof doc) => ({ exists: d !== null, get: (k: string) => (d as Record<string, unknown> | null)?.[k], updateTime: { hora } });
    const ficha = { id: 'ficha' };
    const ref = {
      id: 'rl',
      async update(c: Record<string, unknown>, pre: { lastUpdateTime: { hora: number } }) {
        if (opciones.cambiaAntes) hora += 1;
        if (pre.lastUpdateTime.hora !== hora) throw Object.assign(new Error('pre'), { code: 9 });
        doc = { ...doc, ...c }; escrituras.push('update');
      },
      async create(c: Record<string, unknown>) { if (doc) throw Object.assign(new Error('x'), { code: 6 }); doc = { ...c }; escrituras.push('create'); },
    };
    const db = {
      doc: (p: string) => (p.endsWith('config/respuestaLibre') ? ref : ficha),
      getAll: async (r: unknown) => [r === ficha ? { exists: true, get: () => 'activo', updateTime: { hora } } : snap(doc)],
    };
    return { db, escrituras, actual: () => doc };
  }
  const cfg = (extra: Cfg = {}): Cfg => ({ entorno: 'emulador', tenant: 'comercio-x', deseado, apagar: false, aplicar: false, respaldo: null, ...extra });
  const callar = { log: () => {} };

  it('el seco no escribe y sale 1 si hay diferencias; igual sale 0', async () => {
    const b = baseDe(null);
    expect(await mod.ejecutar(cfg(), { db: b.db, ...callar })).toBe(1);
    expect(b.escrituras).toEqual([]);
    const c = baseDe(deseado);
    expect(await mod.ejecutar(cfg(), { db: c.db, ...callar })).toBe(0);
    expect(c.escrituras).toEqual([]);
  });
  it('--aplicar: respaldo, UNA escritura, relectura; el log no imprime ningún texto', async () => {
    const b = baseDe(null);
    const lineas: string[] = [];
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, log: (t: string) => lineas.push(t) })).toBe(0);
    expect(b.escrituras).toEqual(['create']);
    expect(b.actual()).toEqual(deseado);
    const log = lineas.join('\n');
    for (const k of ['acuse', 'textoSeguimiento', 'textoRechazo', 'textoHumor', 'textoQueja']) expect(log).not.toContain(String(deseado[k]));
  });
  it('--aplicar sobre otro valor actualiza con precondición; si el documento cambió, no escribe (sale 3)', async () => {
    const otro = { ...deseado, acuse: 'otro' };
    const a = baseDe(otro);
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: a.db, ...callar })).toBe(0);
    expect(a.escrituras).toEqual(['update']);
    expect(a.actual()).toEqual(deseado);
    const b = baseDe(otro, { cambiaAntes: true });
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, ...callar })).toBe(3);
    expect(b.actual()).toEqual(otro);
  });
  it('--apagar deja activo:false; un respaldo existente nunca se pisa; un comercio inexistente sale 1', async () => {
    const r = rutaRespaldo();
    const b = baseDe(deseado);
    expect(await mod.ejecutar(cfg({ apagar: true, deseado: { activo: false }, aplicar: true, respaldo: r }), { db: b.db, ...callar })).toBe(0);
    expect(b.actual()?.['activo']).toBe(false);
    const c = baseDe(deseado);
    expect(await mod.ejecutar(cfg({ apagar: true, deseado: { activo: false }, aplicar: true, respaldo: r }), { db: c.db, ...callar })).toBe(2);
    expect(c.escrituras).toEqual([]);
    const d = baseDe(null);
    (d.db as { getAll: unknown }).getAll = async () => [{ exists: false, get: () => undefined }];
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: d.db, ...callar })).toBe(1);
    expect(d.escrituras).toEqual([]);
  });
  it('el script escribe SOLO config/respuestaLibre y no contiene secretos', () => {
    const c = sinComentarios(leer('scripts/plataforma/respuesta-libre.mjs'));
    expect([...c.matchAll(/\bdb\.doc\(`([^`]+)`\)/g)].map((m) => m[1])).toEqual(['tenants/${cfg.tenant}', 'tenants/${cfg.tenant}/config/respuestaLibre']);
    expect(c).not.toMatch(/token|secret|clave|password|apiKey/i);
  });
});

