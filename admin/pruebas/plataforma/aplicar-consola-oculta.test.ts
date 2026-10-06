/**
 * `scripts/plataforma/aplicar-consola-oculta.mjs` — ESCRIBE `tenants/{id}.consolaOculta` DE UN COMERCIO
 * (la lista de lo que su consola no pinta; ver `docs/arquitectura/consola-oculta.md`).
 *
 * Sin emulador ni nube: lógica pura y una base en memoria. Las fichas son sintéticas.
 *
 *   E1. Argumentos y salvaguarda de proyecto (negando todo): ids fuera de la lista cerrada, un solo comercio,
 *       producción con confirmación, el respaldo fuera del repositorio.
 *   E2. Seco por omisión (no escribe), `--aplicar` con respaldo, UNA escritura de un campo con precondición, relectura.
 *   E3. Revertir (restaura o elimina el campo; no pisa un cambio ajeno).
 *   E4. El texto del script: su única escritura es `update` de `consolaOculta`.
 *
 * Los respaldos de las pruebas van a carpetas temporales propias (`mkdtemp`), que se borran al terminar.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarListaConsolaOculta } from '../../functions/src/central/consola-oculta';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const sinComentarios = (f: string) => f
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCRIPT = join(ADMIN, 'scripts', 'plataforma', 'aplicar-consola-oculta.mjs');
type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/aplicar-consola-oculta.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: { raiz?: string }) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  comprobarProyecto: (p: unknown, env?: Record<string, string>) => { ok: boolean; entorno?: string; motivo?: string };
  comprobarRespaldo: (r: unknown, o?: Record<string, unknown>) => { ok: boolean; motivo?: string };
  listaValida: (v: unknown) => boolean;
  leerRespaldo: (ruta: string, o: { entorno: string; tenant: string }) => { ok: boolean; motivo?: string };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
};

const HOST = '127.0.0.1:1';
const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };
const PROY = 'demo-novuchat-pruebas';
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join(tmpdir(), 'cons-ocu-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

/** Una Firestore en memoria con UNA ficha: cuenta las escrituras y puede cambiar entre la lectura y la escritura. */
function baseDe(ficha: Record<string, unknown> | null, opciones: { cambiaAntesDeEscribir?: boolean } = {}) {
  let datos = ficha === null ? null : { ...ficha };
  let hora = 1;
  const escrituras: { campos: Record<string, unknown>; precondicion: unknown }[] = [];
  const snap = () => ({ exists: datos !== null, data: () => (datos === null ? undefined : { ...datos }), updateTime: { toDate: () => new Date(hora * 1000), hora } });
  const ref = {
    update: async (campos: Record<string, unknown>, pre: { lastUpdateTime: { hora: number } }) => {
      if (opciones.cambiaAntesDeEscribir) { hora += 1; datos = { ...(datos ?? {}), otro: 'cambio-ajeno' }; }
      if (pre.lastUpdateTime.hora !== hora) throw Object.assign(new Error('precondición'), { code: 9 });
      for (const [k, v] of Object.entries(campos)) {
        if (v && typeof v === 'object' && (v as { __borrar?: boolean }).__borrar) delete (datos as Record<string, unknown>)[k];
        else (datos as Record<string, unknown>)[k] = v;
      }
      hora += 1;
      escrituras.push({ campos, precondicion: pre });
    },
  };
  return {
    escrituras, datos: () => datos,
    db: { doc: () => ref, getAll: async () => [snap()] },
    FieldValue: { delete: () => ({ __borrar: true }) },
  };
}
const correr = async (cfg: Cfg, b: ReturnType<typeof baseDe>) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue: b.FieldValue, log: (t: string) => salida.push(t) });
  return { codigo, salida: salida.join('\n') };
};
const cfgDe = (extra: Cfg = {}): Cfg => ({
  proyecto: PROY, entorno: 'emulador', tenant: 'qtaco', ocultar: ['horario', 'hoy', 'invitar', 'pagar', 'reemplazoQr'],
  aplicar: false, revertir: false, respaldo: null, ...extra,
});
const FICHA = { nombre: 'dato-sintetico', flujos: ['venta'] };

describe('E1. argumentos y salvaguarda (puros)', () => {
  const base = ['--proyecto', PROY, '--tenant', 'qtaco', '--ocultar', 'horario,hoy,invitar,pagar,reemplazoQr'];
  const problemas = (argv: string[], env = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación completa es válida y queda en seco', () => {
    const r = mod.analizarArgumentos(base, ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: 'qtaco', aplicar: false, revertir: false, entorno: 'emulador' });
    expect(r.cfg?.['ocultar']).toEqual(['horario', 'hoy', 'invitar', 'pagar', 'reemplazoQr']);
  });

  it('rechaza ids fuera de la lista cerrada, vacíos, repetidos, __proto__ y mayúsculas', () => {
    const con = (m: string) => problemas(['--proyecto', PROY, '--tenant', 'qtaco', '--ocultar', m]);
    expect(con('horario,inventado')).toContain('id desconocido');
    expect(con('horario,')).toContain('elemento vacío');
    expect(con('horario,,hoy')).toContain('elemento vacío');
    expect(con('horario,horario')).toContain('id repetido');
    expect(con('__proto__')).toContain('id desconocido');
    expect(con('constructor')).toContain('id desconocido');
    expect(con('Pagar')).toContain('id desconocido');
    expect(con('pagar, hoy')).toContain('id desconocido');
    expect(problemas(['--proyecto', PROY, '--tenant', 'qtaco'])).toContain('falta --ocultar');
    expect(validarListaConsolaOculta('').ok).toBe(false);
  });

  it('UN comercio por corrida y sin formas raras', () => {
    const con = (t: string) => problemas(['--proyecto', PROY, '--tenant', t, '--ocultar', 'pagar']);
    expect(con('qtaco,otro')).toContain('UN solo comercio');
    expect(con('QTaco')).toContain('--tenant inválido');
    expect(con('../otro')).toContain('--tenant inválido');
    expect(problemas(['--proyecto', PROY, '--ocultar', 'pagar'])).toContain('falta --tenant');
  });

  it('opciones desconocidas, repetidas o sin valor se rechazan; no devuelve el valor de una desconocida', () => {
    expect(problemas([...base, '--forzar'])).toContain('opción desconocida: --forzar');
    expect(problemas([...base, '--aplicar=si-quiero-secreto'])).not.toContain('si-quiero-secreto');
    expect(problemas([...base, '--aplicar', '--aplicar'])).toContain('opción repetida: --aplicar');
    expect(problemas(['--proyecto', PROY, '--tenant', 'qtaco', '--ocultar'])).toContain('--ocultar sin valor');
    expect(problemas(['suelto', ...base])).toContain('argumento suelto');
  });

  it('--aplicar exige --respaldo (no hay uno por omisión); --revertir exige --respaldo y no admite --ocultar', () => {
    expect(problemas([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'qtaco'])).toContain('--revertir exige --respaldo');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'qtaco', '--ocultar', 'pagar', '--respaldo', '/x'])).toContain('--revertir no admite --ocultar');
  });

  it('la salvaguarda de proyecto: demo solo con emulador local; real solo de la lista blanca; producción con confirmación', () => {
    expect(mod.comprobarProyecto(PROY, {}).ok).toBe(false);
    expect(mod.comprobarProyecto(PROY, ENV_EMU)).toMatchObject({ ok: true, entorno: 'emulador' });
    expect(mod.comprobarProyecto('proyecto-ficticio-staging', ENV_REAL)).toMatchObject({ ok: true, entorno: 'staging' });
    expect(mod.comprobarProyecto('proyecto-ficticio-prod', ENV_REAL)).toMatchObject({ ok: true, entorno: 'produccion' });
    expect(mod.comprobarProyecto('otro-proyecto-real', ENV_REAL).ok).toBe(false);
    expect(mod.comprobarProyecto('proyecto-ficticio-prod', { ...ENV_REAL, FIRESTORE_EMULATOR_HOST: HOST }).ok).toBe(false);
    expect(mod.comprobarProyecto('Proyecto-Ficticio-Prod', ENV_REAL).ok).toBe(false);
    // Contra producción, --aplicar exige --confirmo-produccion igual al tenant; el respaldo va primero.
    const dir = nuevoDir();
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco', '--ocultar', 'pagar', '--aplicar', '--respaldo', join(dir, 'r.json')];
    expect(mod.analizarArgumentos(prod, ENV_REAL).problemas?.join(' | ')).toContain('--confirmo-produccion');
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'otro'], ENV_REAL).problemas?.join(' | ')).toContain('no coincide');
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'qtaco'], ENV_REAL).ok).toBe(true);
    expect(mod.analizarArgumentos([...base, '--confirmo-produccion', 'qtaco'], ENV_EMU).problemas?.join(' | ')).toContain('solo se usa contra producción');
  });

  it('el id de un proyecto real nunca aparece en los problemas', () => {
    const r = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco', '--ocultar', 'pagar', '--aplicar'], { ...ENV_REAL });
    expect((r.problemas ?? []).join(' ')).not.toContain('proyecto-ficticio-prod');
  });

  it('el respaldo: ruta absoluta, fuera del repositorio y nunca pisado', () => {
    expect(mod.comprobarRespaldo('relativo/r.json').ok).toBe(false);
    expect(mod.comprobarRespaldo(join(ADMIN, 'r.json')).motivo).toContain('repositorio');
    const dir = nuevoDir();
    const ruta = join(dir, 'r.json');
    expect(mod.comprobarRespaldo(ruta).ok).toBe(true);
    writeFileSync(ruta, '{}', { mode: 0o600 });
    expect(mod.comprobarRespaldo(ruta).motivo).toContain('nunca se pisa');
    expect(mod.comprobarRespaldo(ruta, { lectura: true }).ok).toBe(true);
    chmodSync(ruta, 0o644);
    expect(mod.comprobarRespaldo(ruta, { lectura: true }).motivo).toContain('0600');
  });
});

describe('E2. el seco no escribe; --aplicar guarda respaldo, escribe una vez y relee', () => {
  it('seco (por omisión): lee, dice qué cambiaría, sale 1 y no escribe', async () => {
    const b = baseDe(FICHA);
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(1);
    expect(b.escrituras).toHaveLength(0);
    expect(salida).toContain('SECO');
    expect(salida).toContain('AUSENTE');
    expect(salida).toContain('horario, hoy, invitar, pagar, reemplazoQr');
    expect(b.datos()).toEqual(FICHA);
  });

  it('una ficha que no existe: sale 1 y no escribe', async () => {
    const b = baseDe(null);
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(1);
    expect(b.escrituras).toHaveLength(0);
  });

  it('--aplicar: respaldo 0600 con el valor previo (ausente), UNA escritura solo de consolaOculta, con precondición, y relectura', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(codigo, salida).toBe(0);
    expect(b.escrituras).toHaveLength(1);
    expect(Object.keys(b.escrituras[0]!.campos)).toEqual(['consolaOculta']);
    expect(b.escrituras[0]!.precondicion).toHaveProperty('lastUpdateTime');
    expect(b.datos()).toEqual({ ...FICHA, consolaOculta: ['horario', 'hoy', 'invitar', 'pagar', 'reemplazoQr'] });
    expect((statSync(ruta).mode & 0o777).toString(8)).toBe('600');
    const r = JSON.parse(readFileSync(ruta, 'utf8'));
    expect(r.previo).toEqual({ presente: false, valor: null });
    expect(JSON.stringify(r)).not.toContain('dato-sintetico');
    expect(salida).toContain('Escrito y releído');
  });

  it('es idempotente: la misma lista otra vez sale 0 sin escribir', async () => {
    const b = baseDe({ ...FICHA, consolaOculta: ['pagar'] });
    const { codigo, salida } = await correr(cfgDe({ ocultar: ['pagar'], aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(0);
    expect(b.escrituras).toHaveLength(0);
    expect(salida).toContain('nada que hacer');
  });

  it('con respaldo previo ya existente en la ruta, no lo pisa ni escribe', async () => {
    const ruta = rutaRespaldo();
    writeFileSync(ruta, 'no-tocar', { mode: 0o600 });
    const b = baseDe(FICHA);
    const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(codigo).toBe(2);
    expect(b.escrituras).toHaveLength(0);
    expect(readFileSync(ruta, 'utf8')).toBe('no-tocar');
  });

  it('un valor previo que no es una lista válida: no se escribe encima (no se podría restaurar con fidelidad)', async () => {
    for (const previo of ['pagar', ['inventado'], [], { pagar: true }]) {
      const b = baseDe({ ...FICHA, consolaOculta: previo });
      const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
      expect(codigo).toBe(2);
      expect(b.escrituras).toHaveLength(0);
    }
  });

  it('la precondición: si la ficha cambia entre la lectura y la escritura, no se escribe', async () => {
    const b = baseDe(FICHA, { cambiaAntesDeEscribir: true });
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(3);
    expect(b.escrituras).toHaveLength(0);
    expect(b.datos()).not.toHaveProperty('consolaOculta');
    expect(salida).toContain('no se escribió nada');
  });

  it('otro comercio: el script solo toca la ficha del --tenant dado', async () => {
    const rutas: string[] = [];
    const b = baseDe(FICHA);
    const db = { ...b.db, doc: (r: string) => { rutas.push(r); return b.db.doc(); } };
    await mod.ejecutar(cfgDe({ tenant: 'otro-comercio', aplicar: true, respaldo: rutaRespaldo() }), { db, FieldValue: b.FieldValue, log: () => {} });
    expect(rutas.length).toBeGreaterThan(0);
    expect(rutas.every((r) => r === 'tenants/otro-comercio')).toBe(true);
  });
});

describe('E3. revertir', () => {
  it('restaura la AUSENCIA del campo (lo elimina) y es idempotente', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    expect((await correr(cfgDe({ aplicar: true, respaldo: ruta }), b)).codigo).toBe(0);
    const rev = { revertir: true, respaldo: ruta, ocultar: null };
    const seco = await correr(cfgDe({ ...rev }), b);
    expect(seco.codigo).toBe(1);
    expect(b.datos()).toHaveProperty('consolaOculta');
    const real = await correr(cfgDe({ ...rev, aplicar: true }), b);
    expect(real.codigo, real.salida).toBe(0);
    expect(b.datos()).toEqual(FICHA);
    expect((await correr(cfgDe({ ...rev, aplicar: true }), b)).codigo).toBe(0);
  });

  it('restaura el valor previo cuando existía', async () => {
    const b = baseDe({ ...FICHA, consolaOculta: ['pagar'] });
    const ruta = rutaRespaldo();
    expect((await correr(cfgDe({ ocultar: ['pagar', 'hoy'], aplicar: true, respaldo: ruta }), b)).codigo).toBe(0);
    expect(b.datos()?.['consolaOculta']).toEqual(['pagar', 'hoy']);
    expect((await correr(cfgDe({ revertir: true, aplicar: true, respaldo: ruta, ocultar: null }), b)).codigo).toBe(0);
    expect(b.datos()?.['consolaOculta']).toEqual(['pagar']);
  });

  it('no pisa un cambio ajeno: si la lista de hoy no es la que escribió el script, sale 2 sin escribir', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    const antes = b.escrituras.length;
    (b.datos() as Record<string, unknown>)['consolaOculta'] = ['horario'];
    const { codigo } = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: ruta, ocultar: null }), b);
    expect(codigo).toBe(2);
    expect(b.escrituras).toHaveLength(antes);
  });

  it('un respaldo de otro comercio o de otro entorno se rechaza', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(mod.leerRespaldo(ruta, { entorno: 'emulador', tenant: 'otro' }).motivo).toContain('otro comercio');
    expect(mod.leerRespaldo(ruta, { entorno: 'produccion', tenant: 'qtaco' }).motivo).toContain('otro entorno');
  });
});

describe('E4. el texto del script', () => {
  const f = sinComentarios(readFileSync(SCRIPT, 'utf8'));
  it('su única escritura a Firestore es `update` del campo consolaOculta', () => {
    expect(f.match(/\.update\(/g)).toHaveLength(1);
    expect(f).toContain('await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });');
    expect(f).toContain("const CAMPO = 'consolaOculta';");
    expect(f.replace(/FieldValue\.delete\(\)/g, '')).not.toMatch(/\.(set|create|delete|add)\(/);
    expect(f).not.toMatch(/\bbatch\b|runTransaction/);
  });
  it('el respaldo se abre sin pisar ni seguir enlaces (O_EXCL, O_NOFOLLOW) y no imprime el proyecto', () => {
    expect(f).toContain('constants.O_EXCL');
    expect(f).toContain('constants.O_NOFOLLOW');
    expect(f).not.toMatch(/console\.(log|error)\([^)]*proyecto\b(?!s)/);
  });
  it('importa la lista cerrada del mismo archivo que la consola', () => {
    expect(f).toContain("functions/src/central/consola-oculta.ts");
  });
});
