/**
 * EL SCRIPT `campana-saliente-config.mjs` Y LAS CIFRAS DE NOVUCHAT (PR-C, 27/11/2026), sin emulador ni nube.
 * Vive en `pruebas/plataforma/` porque importa un script de Plataforma. Necesita `functions/lib` compilado (`pnpm functions:build`),
 * como `migrar-prepago.mjs`: el script valida con la MISMA función que lee el servidor.
 * También prueba la PARIDAD de `plantillaDeCampanaValida` (servidor) con `plantillaCampanaValida` (script de registro de plantillas).
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
const mod = await import('../../scripts/plataforma/campana-saliente-config.mjs') as unknown as {
  analizarArgumentos: (a: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  cargarDatos: (n: string) => { ok: boolean; valor?: Cfg; motivo?: string };
  validarDatos: (c: unknown) => { ok: boolean; valor?: Cfg; motivo?: string };
  CAMPOS: string[];
};
const SERVIDOR = await import('../../functions/src/core/conversacion/salidaCampana.ts');
const REGISTRO_PLANTILLA = await import('../../scripts/plataforma/registrar-plantilla.mjs') as unknown as { plantillaCampanaValida: (p: unknown) => boolean };

const DP2 = { porTanda: 45, porDia: 200, porReclamo: 3, ventanaDias: 60, pausaErroresPct: 10, pausaMinimoEnviados: 10, pausaNoPct: 25 };

describe('los datos versionados de NovuChat (DP2, decididos por Andres el 27/11/2026)', () => {
  const crudo = JSON.parse(leer('scripts/datos/campana-saliente/novuchat.json')) as Record<string, unknown>;
  it('son exactamente las siete cifras de DP2', () => {
    expect(crudo).toEqual(DP2);
    expect(Object.keys(crudo).sort()).toEqual([...mod.CAMPOS].sort());
  });
  it('pasan la lectura del servidor sin cambios', () => {
    const c = mod.cargarDatos('novuchat');
    expect(c.ok, c.motivo).toBe(true);
    expect(c.valor).toEqual(DP2);
    expect(SERVIDOR.leerConfigCampana(crudo)).toEqual(DP2);
  });
  it('sin identificadores: solo cifras', () => {
    expect(Object.values(crudo).every((v) => typeof v === 'number')).toBe(true);
    expect(JSON.stringify(crudo)).not.toMatch(/\d{6,}/);
  });
  it('NIEGA: datos que el servidor leería como ilegibles, con campos de más o de menos, se rechazan', () => {
    for (const malo of [
      { ...DP2, porTanda: '45' }, { ...DP2, porDia: 0 }, { ...DP2, porReclamo: 11 }, { ...DP2, pausaNoPct: 101 }, { ...DP2, porTanda: 4.5 },
      { ...DP2, extra: 1 }, [], null, 'x',
    ]) expect(mod.validarDatos(malo).ok, JSON.stringify(malo)).toBe(false);
    const { pausaNoPct: _q, ...sinUno } = DP2;
    expect(mod.validarDatos(sinUno).ok).toBe(false);
    expect(mod.cargarDatos('../x').ok).toBe(false);
    expect(mod.cargarDatos('no-existe').ok).toBe(false);
  });
});

describe('el script de Plataforma', () => {
  const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
  const PROY = 'demo-novuchat-pruebas';
  const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
  const dirs: string[] = [];
  const rutaRespaldo = () => { const d = mkdtempSync(join(tmpdir(), 'cs-')); chmodSync(d, 0o700); dirs.push(d); return join(d, 'r.json'); };
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const base = ['--proyecto', PROY, '--tenant', 'comercio-x'];
  const deseado = mod.cargarDatos('novuchat').valor!;

  it('seco por omisión: sin --aplicar no pide respaldo', () => {
    const r = mod.analizarArgumentos([...base, '--datos', 'novuchat'], ENV_EMU);
    expect(r.ok, String(r.problemas)).toBe(true);
    expect(r.cfg).toMatchObject({ aplicar: false, deseado });
  });
  it('NIEGA: --aplicar sin respaldo; sin --datos; datos inexistentes; --apagar (no existe)', () => {
    expect(mod.analizarArgumentos([...base, '--datos', 'novuchat', '--aplicar'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--datos', 'nadie'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--datos', 'novuchat', '--apagar'], ENV_EMU).ok).toBe(false);
  });
  it('NIEGA: más de un comercio, id raro, opción desconocida, proyecto sin lista blanca', () => {
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'a-1,b-2', '--datos', 'novuchat'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', '../x', '--datos', 'novuchat'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--datos', 'novuchat', '--otra', 'x'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos(['--proyecto', 'cualquier-proyecto-real', '--tenant', 'comercio-x', '--datos', 'novuchat'], {}).ok).toBe(false);
  });
  it('NIEGA: contra producción, --aplicar exige --confirmo-produccion igual al comercio', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'comercio-x', '--datos', 'novuchat', '--aplicar', '--respaldo', rutaRespaldo()];
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(false);
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'otro-comercio'], ENV_REAL).ok).toBe(false);
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'comercio-x'], ENV_REAL).ok).toBe(true);
  });

  /** Una Firestore mínima en memoria: la ficha y `config/campanaSaliente`, con cuenta de escrituras. */
  function baseDe(previo: Record<string, unknown> | null, opciones: { cambiaAntes?: boolean } = {}) {
    let doc = previo === null ? null : { ...previo };
    let hora = 1;
    const escrituras: string[] = [];
    const snap = (d: typeof doc) => ({ exists: d !== null, get: (k: string) => (d as Record<string, unknown> | null)?.[k], updateTime: { hora } });
    const ficha = { id: 'ficha' };
    const ref = {
      id: 'cs',
      async update(c: Record<string, unknown>, pre: { lastUpdateTime: { hora: number } }) {
        if (opciones.cambiaAntes) hora += 1;
        if (pre.lastUpdateTime.hora !== hora) throw Object.assign(new Error('pre'), { code: 9 });
        doc = { ...doc, ...c }; escrituras.push('update');
      },
      async create(c: Record<string, unknown>) { if (doc) throw Object.assign(new Error('x'), { code: 6 }); doc = { ...c }; escrituras.push('create'); },
    };
    const db = {
      doc: (p: string) => (p.endsWith('config/campanaSaliente') ? ref : ficha),
      getAll: async (r: unknown) => [r === ficha ? { exists: true, get: () => 'activo', updateTime: { hora } } : snap(doc)],
    };
    return { db, escrituras, actual: () => doc };
  }
  const cfg = (extra: Cfg = {}): Cfg => ({ entorno: 'emulador', tenant: 'comercio-x', deseado, aplicar: false, respaldo: null, ...extra });
  const callar = { log: () => {} };

  it('el seco no escribe y sale 1 si hay diferencias; igual sale 0', async () => {
    const b = baseDe(null);
    expect(await mod.ejecutar(cfg(), { db: b.db, ...callar })).toBe(1);
    expect(b.escrituras).toEqual([]);
    const c = baseDe(deseado);
    expect(await mod.ejecutar(cfg(), { db: c.db, ...callar })).toBe(0);
    expect(c.escrituras).toEqual([]);
  });
  it('--aplicar: respaldo, UNA escritura, relectura; idempotente la segunda vez', async () => {
    const b = baseDe(null);
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, ...callar })).toBe(0);
    expect(b.escrituras).toEqual(['create']);
    expect(b.actual()).toEqual(deseado);
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, ...callar })).toBe(0);
    expect(b.escrituras).toEqual(['create']);
  });
  it('--aplicar sobre otro valor actualiza con precondición; si el documento cambió, no escribe (sale 3)', async () => {
    const otro = { ...deseado, porDia: 100 };
    const a = baseDe(otro);
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: a.db, ...callar })).toBe(0);
    expect(a.escrituras).toEqual(['update']);
    expect(a.actual()).toEqual(deseado);
    const b = baseDe(otro, { cambiaAntes: true });
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, ...callar })).toBe(3);
    expect(b.actual()).toEqual(otro);
  });
  it('un respaldo existente nunca se pisa (sale 2, sin escribir); un comercio inexistente sale 1', async () => {
    const r = rutaRespaldo();
    const b = baseDe({ ...deseado, porDia: 100 });
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: r }), { db: b.db, ...callar })).toBe(0);
    const c = baseDe({ ...deseado, porDia: 100 });
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: r }), { db: c.db, ...callar })).toBe(2);
    expect(c.escrituras).toEqual([]);
    const d = baseDe(null);
    (d.db as { getAll: unknown }).getAll = async () => [{ exists: false, get: () => undefined }];
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: d.db, ...callar })).toBe(1);
    expect(d.escrituras).toEqual([]);
  });
  it('el respaldo guarda el valor previo (o su ausencia) y no hay otra salida', async () => {
    const r = rutaRespaldo();
    const b = baseDe(null);
    await mod.ejecutar(cfg({ aplicar: true, respaldo: r }), { db: b.db, ...callar });
    expect(JSON.parse(readFileSync(r, 'utf8'))).toMatchObject({ tenant: 'comercio-x', previo: { presente: false, valor: null } });
  });
  it('el script escribe SOLO config/campanaSaliente y no contiene secretos', () => {
    const c = sinComentarios(leer('scripts/plataforma/campana-saliente-config.mjs'));
    expect([...c.matchAll(/\bdb\.doc\(`([^`]+)`\)/g)].map((m) => m[1])).toEqual(['tenants/${cfg.tenant}', 'tenants/${cfg.tenant}/config/campanaSaliente']);
    expect(c).not.toMatch(/token|secret|clave|password|apiKey/i);
  });
});

describe('paridad: la plantilla de campaña que exige el servidor es la que registra el script', () => {
  const ok = { nombre: 'campana_chat', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 0, cabecera: 'ninguna', botones: 2 };
  const casos: unknown[] = [
    ok, { ...ok, categoria: 'MARKETING' }, { ...ok, categoria: 'AUTHENTICATION' }, { ...ok, categoria: 'utility' }, { ...ok, estado: 'PENDING' },
    { ...ok, estado: 'approved' }, { ...ok, variables: 1 }, { ...ok, variables: '0' }, { ...ok, variables: undefined }, { ...ok, cabecera: 'imagen' },
    { ...ok, cabecera: undefined }, { ...ok, botones: 1 }, { ...ok, botones: 3 }, { ...ok, botones: '2' }, { ...ok, nombre: 'Campana' },
    { ...ok, nombre: '' }, { ...ok, nombre: 'a'.repeat(101) }, { ...ok, nombre: 'a'.repeat(100) }, { ...ok, idioma: 'es_BO' }, { ...ok, idioma: 'es_bo' },
    { ...ok, idioma: 'espanol' }, { ...ok, nombre: 5 }, { ...ok, registradaEn: 'x' }, {}, null, undefined, 'texto', 5, [],
  ];
  it.each(casos.map((c, i) => [i, c] as const))('caso %i: el servidor y el script coinciden', (_i, caso) => {
    expect(SERVIDOR.plantillaDeCampanaValida(caso)).toBe(REGISTRO_PLANTILLA.plantillaCampanaValida(caso));
  });
  it('control: el servidor acepta el caso bueno y rechaza uno malo (la paridad no es «todo falso»)', () => {
    expect(SERVIDOR.plantillaDeCampanaValida(ok)).toBe(true);
    expect(SERVIDOR.plantillaDeCampanaValida({ ...ok, variables: 1 })).toBe(false);
  });
});
