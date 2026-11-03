/**
 * EL BOTÓN «Abrir miniCRM» DEL TABLERO (03/11/2026) — sin emulador ni nube. Se prueba NEGANDO:
 *   E1. El enlace: solo https://docs.google.com/spreadsheets/d/<id>; nada más se escribe ni se pinta.
 *   E2. Cuándo hay botón: solo admin, miniCRM encendido y enlace válido.
 *   E3. El script de Plataforma: seco por omisión, una escritura, respaldo, precondición, proyecto y producción.
 *   E4. El texto de la Consola y del script: solo el admin se suscribe; el comercio no escribe; sin secretos.
 * Las reglas de Firestore (quién lee y quién escribe `config/crmEnlace`) están en `crm-reglas.test.ts`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enlaceDeHojaVisible, enlaceMiniCrmParaBoton, esEnlaceDeHoja } from '../../../functions/src/central/enlace-minicrm';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (r: string) => readFileSync(join(ADMIN, r), 'utf8');
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const BUENO = `https://docs.google.com/spreadsheets/d/${ID}/edit`;

type Cfg = Record<string, unknown>;
const mod = await import('../../../scripts/plataforma/crm-enlace.mjs') as unknown as {
  analizarArgumentos: (a: string[], env?: Record<string, string>, op?: { raiz?: string }) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  abreviado: (u: unknown) => string;
};

describe('E1. el enlace', () => {
  it('acepta la forma de una hoja de Google, con o sin cola', () => {
    for (const u of [BUENO, `https://docs.google.com/spreadsheets/d/${ID}`, `${BUENO}?gid=0#gid=0`]) expect(esEnlaceDeHoja(u), u).toBe(true);
  });
  it('NIEGA: otro dominio, http, esquemas peligrosos, credenciales, puerto y subdominios parecidos', () => {
    const malos = [
      `http://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com.malo.example/spreadsheets/d/${ID}`,
      `https://evil.example/spreadsheets/d/${ID}`,
      `https://usuario:clave@docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com:8443/spreadsheets/d/${ID}`,
      `https://drive.google.com/spreadsheets/d/${ID}`,
      `javascript:alert(1)`, `data:text/html,<script>1</script>`,
      `https://docs.google.com/document/d/${ID}/edit`,
      `https://docs.google.com/spreadsheets/d/corto`,
      ` ${BUENO}`, `${BUENO} `, `${BUENO}\n`, `${BUENO}"onclick="x`, `${BUENO}<`,
      '', `https://docs.google.com/spreadsheets/d/${ID}/${'a'.repeat(300)}`,
    ];
    for (const u of malos) expect(esEnlaceDeHoja(u), JSON.stringify(u).slice(0, 60)).toBe(false);
    for (const v of [null, undefined, 1, {}, [], true]) expect(esEnlaceDeHoja(v)).toBe(false);
  });
  it('lo visible es el enlace o nada', () => {
    expect(enlaceDeHojaVisible(BUENO)).toBe(BUENO);
    expect(enlaceDeHojaVisible('javascript:alert(1)')).toBeNull();
  });
});

describe('E2. cuándo hay botón', () => {
  const base = { esAdmin: true, crmActivo: true, enlace: BUENO };
  it('admin + miniCRM encendido (o sin dato: ausente = encendido) + enlace válido', () => {
    expect(enlaceMiniCrmParaBoton(base)).toBe(BUENO);
    expect(enlaceMiniCrmParaBoton({ ...base, crmActivo: undefined })).toBe(BUENO);
  });
  it('NIEGA: un operador (no admin) no lo ve', () => expect(enlaceMiniCrmParaBoton({ ...base, esAdmin: false })).toBeNull());
  it('NIEGA: con el miniCRM apagado (`activo: false`) no aparece', () => expect(enlaceMiniCrmParaBoton({ ...base, crmActivo: false })).toBeNull());
  it('NIEGA: sin enlace, o con un enlace que no es de una hoja, no aparece', () => {
    for (const enlace of [undefined, null, '', 'https://evil.example/x', 'javascript:alert(1)', 7]) {
      expect(enlaceMiniCrmParaBoton({ ...base, enlace }), String(enlace)).toBeNull();
    }
  });
  it('NIEGA: solo `esAdmin === true` exacto', () => {
    for (const esAdmin of ['true', 1, {}, null, undefined]) expect(enlaceMiniCrmParaBoton({ ...base, esAdmin: esAdmin as never })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('E3. el script de Plataforma', () => {
  const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
  const PROY = 'demo-novuchat-pruebas';
  const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
  const dirs: string[] = [];
  const rutaRespaldo = () => { const d = mkdtempSync(join(tmpdir(), 'crm-enl-')); chmodSync(d, 0o700); dirs.push(d); return join(d, 'r.json'); };
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const base = ['--proyecto', PROY, '--tenant', 'comercio-x'];

  it('seco por omisión: sin --aplicar no pide respaldo', () => {
    const r = mod.analizarArgumentos([...base, '--enlace', BUENO], ENV_EMU);
    expect(r.ok, String(r.problemas)).toBe(true);
    expect(r.cfg).toMatchObject({ aplicar: false, quitar: false, enlace: BUENO });
  });
  it('NIEGA: --aplicar sin respaldo; un enlace que no es de hoja; sin --enlace ni --quitar; ambos a la vez', () => {
    expect(mod.analizarArgumentos([...base, '--enlace', BUENO, '--aplicar'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--enlace', 'https://evil.example/x'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--enlace', BUENO, '--quitar'], ENV_EMU).ok).toBe(false);
  });
  it('NIEGA: más de un comercio, un id raro, una opción desconocida, un proyecto sin lista blanca', () => {
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'a-1,b-2', '--enlace', BUENO], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', '../x', '--enlace', BUENO], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--enlace', BUENO, '--otra', 'x'], ENV_EMU).ok).toBe(false);
    expect(mod.analizarArgumentos(['--proyecto', 'cualquier-proyecto-real', '--tenant', 'comercio-x', '--enlace', BUENO], {}).ok).toBe(false);
  });
  it('NIEGA: contra producción, --aplicar exige --confirmo-produccion igual al comercio', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'comercio-x', '--enlace', BUENO, '--aplicar', '--respaldo', rutaRespaldo()];
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(false);
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'otro-comercio'], ENV_REAL).ok).toBe(false);
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'comercio-x'], ENV_REAL).ok).toBe(true);
  });

  /** Una Firestore mínima en memoria: la ficha y `config/crmEnlace`, con cuenta de escrituras. */
  function baseDe(enlace: string | null, opciones: { cambiaAntes?: boolean } = {}) {
    let doc: { enlaceHoja: string } | null = enlace === null ? null : { enlaceHoja: enlace };
    let hora = 1;
    const escrituras: string[] = [];
    const snap = (d: typeof doc) => ({ exists: d !== null, get: (k: string) => (d as Record<string, unknown> | null)?.[k], updateTime: { hora } });
    const ficha = { id: 'ficha' };
    const ref = {
      id: 'enlace',
      async update(c: { enlaceHoja: string }, pre: { lastUpdateTime: { hora: number } }) {
        if (opciones.cambiaAntes) hora += 1;
        if (pre.lastUpdateTime.hora !== hora) throw Object.assign(new Error('pre'), { code: 9 });
        doc = { enlaceHoja: c.enlaceHoja }; escrituras.push('update');
      },
      async create(c: { enlaceHoja: string }) { if (doc) throw Object.assign(new Error('x'), { code: 6 }); doc = { enlaceHoja: c.enlaceHoja }; escrituras.push('create'); },
      async delete() { if (!doc) throw Object.assign(new Error('x'), { code: 5 }); doc = null; escrituras.push('delete'); },
    };
    const db = {
      doc: (p: string) => (p.endsWith('crmEnlace') ? ref : ficha),
      getAll: async (r: unknown) => [r === ficha ? { exists: true, get: () => 'activo', updateTime: { hora } } : snap(doc)],
    };
    return { db, escrituras, actual: () => doc };
  }
  const cfg = (extra: Cfg = {}): Cfg => ({ entorno: 'emulador', tenant: 'comercio-x', enlace: BUENO, quitar: false, aplicar: false, respaldo: null, ...extra });
  const callar = { log: () => {} };

  it('el seco no escribe y sale 1 si hay diferencias; igual sale 0', async () => {
    const b = baseDe(null);
    expect(await mod.ejecutar(cfg(), { db: b.db, ...callar })).toBe(1);
    expect(b.escrituras).toEqual([]);
    const c = baseDe(BUENO);
    expect(await mod.ejecutar(cfg(), { db: c.db, ...callar })).toBe(0);
    expect(c.escrituras).toEqual([]);
  });
  it('--aplicar: respaldo, UNA escritura, relectura; y el log no imprime el enlace entero', async () => {
    const b = baseDe(null);
    const lineas: string[] = [];
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, log: (t: string) => lineas.push(t) })).toBe(0);
    expect(b.escrituras).toEqual(['create']);
    expect(b.actual()?.enlaceHoja).toBe(BUENO);
    expect(lineas.join('\n')).not.toContain(BUENO);
  });
  it('--aplicar sobre un enlace distinto actualiza con precondición; si el documento cambió, no escribe (sale 3)', async () => {
    const otro = `https://docs.google.com/spreadsheets/d/${'Z'.repeat(20)}`;
    const a = baseDe(otro);
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: a.db, ...callar })).toBe(0);
    expect(a.escrituras).toEqual(['update']);
    const b = baseDe(otro, { cambiaAntes: true });
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, ...callar })).toBe(3);
    expect(b.actual()?.enlaceHoja).toBe(otro);
  });
  it('--quitar elimina el documento; un respaldo existente nunca se pisa', async () => {
    const b = baseDe(BUENO);
    const r = rutaRespaldo();
    expect(await mod.ejecutar(cfg({ quitar: true, enlace: null, aplicar: true, respaldo: r }), { db: b.db, ...callar })).toBe(0);
    expect(b.actual()).toBeNull();
    const c = baseDe(BUENO);
    expect(await mod.ejecutar(cfg({ quitar: true, enlace: null, aplicar: true, respaldo: r }), { db: c.db, ...callar })).toBe(2);
    expect(c.escrituras).toEqual([]);
  });
  it('un comercio inexistente sale 1 sin escribir', async () => {
    const b = baseDe(null);
    (b.db as { getAll: unknown }).getAll = async () => [{ exists: false, get: () => undefined }];
    expect(await mod.ejecutar(cfg({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, ...callar })).toBe(1);
    expect(b.escrituras).toEqual([]);
  });
});

describe('E4. el texto', () => {
  it('la Consola: el botón solo se suscribe para el admin y solo lee; el Tablero lo monta con esAdmin', () => {
    const c = sinComentarios(leer('web/src/central/componentes/BotonMiniCrm.tsx'));
    expect(c).toMatch(/if \(!tenantId \|\| !esAdmin\) return;/);
    expect(c).not.toMatch(/setDoc|updateDoc|addDoc|deleteDoc|fetch\(|dangerouslySetInnerHTML|localStorage/);
    expect(c).toContain('rel="noopener noreferrer"');
    expect(c).toContain('enlaceMiniCrmParaBoton');
    expect(sinComentarios(leer('web/src/central/paginas/Tablero.tsx'))).toMatch(/<BotonMiniCrm tenantId=\{tenantId\} esAdmin=\{esAdmin\} \/>/);
  });
  it('el script escribe SOLO config/crmEnlace: una sola ruta de escritura y ningún secreto', () => {
    const c = sinComentarios(leer('scripts/plataforma/crm-enlace.mjs'));
    expect([...c.matchAll(/\bdb\.doc\(`([^`]+)`\)/g)].map((m) => m[1])).toEqual(['tenants/${cfg.tenant}', 'tenants/${cfg.tenant}/config/crmEnlace']);
    expect(c).not.toMatch(/token|secret|clave|password|apiKey/i);
  });
});
