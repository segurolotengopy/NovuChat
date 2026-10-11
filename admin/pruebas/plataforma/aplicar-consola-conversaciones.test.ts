/**
 * `scripts/plataforma/aplicar-consola-conversaciones.mjs` — ESCRIBE `tenants/{id}.consolaConversaciones`
 * DE UN COMERCIO (la bandera de la pantalla de Conversaciones: `clasica` | `nueva`; ver
 * `functions/src/central/consola-conversaciones.ts`). Calcado de `aplicar-consola-oculta.test.ts`.
 *
 * Sin emulador ni nube: lógica pura y una base en memoria. Las fichas son sintéticas. El mismo script contra el
 * emulador real está en `conversaciones-scripts-emulador.test.ts`.
 *
 *   B1. Argumentos y salvaguarda de proyecto (negando todo): la pantalla viene de la lista cerrada, un solo
 *       comercio, producción con confirmación, BELLIDO se rechaza, el respaldo fuera de `~/`.
 *   B2. Seco por omisión (no escribe), `--aplicar` con respaldo, UNA escritura de un campo con precondición.
 *   B3. Revertir (restaura o elimina el campo; no pisa un cambio ajeno).
 *   B4. Bellido por la ficha; el texto del script: su única escritura es `update` de `consolaConversaciones`.
 *
 * Los respaldos de las pruebas van a carpetas temporales propias (`mkdtemp`), que se borran al terminar.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { PANTALLAS_CONVERSACIONES, validarPantallaConversaciones } from '../../functions/src/central/consola-conversaciones';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const sinComentarios = (f: string) => f
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCRIPT = join(ADMIN, 'scripts', 'plataforma', 'aplicar-consola-conversaciones.mjs');
type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/aplicar-consola-conversaciones.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  comprobarProyecto: (p: unknown, env?: Record<string, string>) => { ok: boolean; entorno?: string; motivo?: string };
  comprobarRespaldo: (r: unknown, o?: Record<string, unknown>) => { ok: boolean; motivo?: string };
  esTenantExcluido: (t: unknown, env?: Record<string, string>) => boolean;
  nombreExcluido: (n: unknown, env?: Record<string, string>) => boolean;
  leerRespaldo: (ruta: string, o: { entorno: string; tenant: string }) => { ok: boolean; motivo?: string };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
};

const HOST = '127.0.0.1:1';
const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };
const PROY = 'demo-novuchat-pruebas';
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join(tmpdir(), 'cons-conv-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

/** Una Firestore en memoria con UNA ficha: cuenta las escrituras y puede cambiar entre la lectura y la escritura. */
function baseDe(ficha: Record<string, unknown> | null, opciones: { cambiaAntesDeEscribir?: boolean } = {}) {
  let datos = ficha === null ? null : { ...ficha };
  let hora = 1;
  const lecturas: { campos: string[] | undefined }[] = [];
  const escrituras: { campos: Record<string, unknown>; precondicion: unknown }[] = [];
  const snap = (mascara?: string[]) => {
    const d = datos === null ? undefined : Object.fromEntries(Object.entries(datos).filter(([k]) => !mascara || mascara.includes(k)));
    return { exists: datos !== null, data: () => d, updateTime: { toDate: () => new Date(hora * 1000), hora } };
  };
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
    escrituras, lecturas, datos: () => datos,
    db: { doc: () => ref, getAll: async (_r: unknown, o?: { fieldMask?: string[] }) => { lecturas.push({ campos: o?.fieldMask }); return [snap(o?.fieldMask)]; } },
    FieldValue: { delete: () => ({ __borrar: true }) },
  };
}
const correr = async (cfg: Cfg, b: ReturnType<typeof baseDe>, extra: Record<string, unknown> = {}) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue: b.FieldValue, log: (t: string) => salida.push(t), ...extra });
  return { codigo, salida: salida.join('\n') };
};
const cfgDe = (extra: Cfg = {}): Cfg => ({
  proyecto: PROY, entorno: 'emulador', tenant: 'tienda-prueba', pantalla: 'nueva',
  aplicar: false, revertir: false, respaldo: null, ...extra,
});
const FICHA = { nombre: 'Tienda Sintetica', flujos: ['venta'] };

describe('B1. argumentos y salvaguarda (puros)', () => {
  const base = ['--proyecto', PROY, '--tenant', 'tienda-prueba', '--pantalla', 'nueva'];
  const problemas = (argv: string[], env = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación completa es válida y queda en seco; las dos pantallas valen', () => {
    const r = mod.analizarArgumentos(base, ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: 'tienda-prueba', pantalla: 'nueva', aplicar: false, revertir: false, entorno: 'emulador' });
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--pantalla', 'clasica'], ENV_EMU).cfg?.['pantalla']).toBe('clasica');
    expect([...PANTALLAS_CONVERSACIONES]).toEqual(['clasica', 'nueva']);
  });

  it('la pantalla se valida con la función de la consola: fuera de la lista cerrada, vacía, otra mayúscula, __proto__', () => {
    const con = (m: string) => problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--pantalla', m]);
    expect(con('moderna')).toContain('valor desconocido');
    expect(con('Nueva')).toContain('valor desconocido');
    expect(con('nueva,clasica')).toContain('valor desconocido');
    expect(con('__proto__')).toContain('valor desconocido');
    expect(con('constructor')).toContain('valor desconocido');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba'])).toContain('falta --pantalla');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--pantalla'])).toContain('--pantalla sin valor');
    expect(validarPantallaConversaciones('').ok).toBe(false);
    expect(validarPantallaConversaciones('nueva')).toEqual({ ok: true, pantalla: 'nueva' });
  });

  it('BELLIDO NO SE TOCA: id, id que lo contiene, y la variable de exclusión (que solo agrega)', () => {
    const con = (t: string, extra: string[] = []) => problemas(['--proyecto', PROY, '--tenant', t, '--pantalla', 'nueva', ...extra]);
    expect(con('bellido')).toContain('EXCLUIDO');
    expect(con('bellido', ['--aplicar', '--respaldo', rutaRespaldo()])).toContain('EXCLUIDO');
    expect(con('consultorio-bellido')).toContain('EXCLUIDO');
    expect(con('dr-bellido-2')).toContain('EXCLUIDO');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'bellido', '--respaldo', rutaRespaldo()])).toContain('EXCLUIDO');
    expect(problemas(base, { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'tienda-prueba' })).toContain('EXCLUIDO');
    expect(mod.esTenantExcluido('bellido', { NOVUCHAT_TENANTS_EXCLUIDOS: 'otro' })).toBe(true);
    expect(mod.esTenantExcluido('tienda-prueba')).toBe(false);
    expect(mod.esTenantExcluido(undefined)).toBe(false);
    expect(mod.nombreExcluido('Consultorio Béllido')).toBe(true);
    expect(mod.nombreExcluido('Tienda Sintetica')).toBe(false);
    expect(mod.nombreExcluido(undefined)).toBe(false);
  });

  it('UN comercio por corrida y sin formas raras', () => {
    const con = (t: string) => problemas(['--proyecto', PROY, '--tenant', t, '--pantalla', 'nueva']);
    expect(con('uno-a,dos-b')).toContain('UN solo comercio');
    expect(con('QTaco')).toContain('--tenant inválido');
    expect(con('../otro')).toContain('--tenant inválido');
    expect(problemas(['--proyecto', PROY, '--pantalla', 'nueva'])).toContain('falta --tenant');
  });

  it('opciones desconocidas, repetidas o sin valor se rechazan; no devuelve el valor de una desconocida', () => {
    expect(problemas([...base, '--forzar'])).toContain('opción desconocida: --forzar');
    expect(problemas([...base, '--aplicar=si-quiero-secreto'])).not.toContain('si-quiero-secreto');
    expect(problemas([...base, '--aplicar', '--aplicar'])).toContain('opción repetida: --aplicar');
    expect(problemas(['suelto', ...base])).toContain('argumento suelto');
  });

  it('--aplicar exige --respaldo; --revertir exige --respaldo y no admite --pantalla', () => {
    expect(problemas([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'tienda-prueba'])).toContain('--revertir exige --respaldo');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'tienda-prueba', '--pantalla', 'nueva', '--respaldo', '/x'])).toContain('--revertir no admite --pantalla');
  });

  it('la salvaguarda de proyecto: demo solo con emulador local; real solo de la lista blanca; producción con confirmación', () => {
    expect(mod.comprobarProyecto(PROY, {}).ok).toBe(false);
    expect(mod.comprobarProyecto(PROY, ENV_EMU)).toMatchObject({ ok: true, entorno: 'emulador' });
    expect(mod.comprobarProyecto('proyecto-ficticio-staging', ENV_REAL)).toMatchObject({ ok: true, entorno: 'staging' });
    expect(mod.comprobarProyecto('proyecto-ficticio-prod', ENV_REAL)).toMatchObject({ ok: true, entorno: 'produccion' });
    expect(mod.comprobarProyecto('otro-proyecto-real', ENV_REAL).ok).toBe(false);
    expect(mod.comprobarProyecto('proyecto-ficticio-prod', { ...ENV_REAL, FIRESTORE_EMULATOR_HOST: HOST }).ok).toBe(false);
    const dir = nuevoDir();
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--pantalla', 'nueva', '--aplicar', '--respaldo', join(dir, 'r.json')];
    expect(mod.analizarArgumentos(prod, ENV_REAL).problemas?.join(' | ')).toContain('--confirmo-produccion');
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'otro'], ENV_REAL).problemas?.join(' | ')).toContain('no coincide');
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'tienda-prueba'], ENV_REAL).ok).toBe(true);
    expect(mod.analizarArgumentos([...base, '--confirmo-produccion', 'tienda-prueba'], ENV_EMU).problemas?.join(' | ')).toContain('solo se usa contra producción');
    // Revertir en producción también pide confirmación.
    const rutaR = join(dir, 'existente.json');
    writeFileSync(rutaR, '{}', { mode: 0o600 });
    const rev = ['--revertir', '--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--aplicar', '--respaldo', rutaR];
    expect(mod.analizarArgumentos(rev, ENV_REAL).problemas?.join(' | ')).toContain('--confirmo-produccion');
  });

  it('el id de un proyecto real nunca aparece en los problemas', () => {
    const r = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'bellido', '--pantalla', 'nueva', '--aplicar'], { ...ENV_REAL });
    expect((r.problemas ?? []).join(' ')).not.toContain('proyecto-ficticio-prod');
  });

  it('el respaldo: absoluto, nunca en `~/`, carpeta 0700 y nunca pisado', () => {
    expect(mod.comprobarRespaldo('relativo/r.json').ok).toBe(false);
    expect(mod.comprobarRespaldo(join(ADMIN, 'r.json')).motivo).toContain('ignorada por git');
    expect(mod.comprobarRespaldo(join(process.env['HOME'] ?? '/home/x', 'r.json')).motivo).toContain('~/');
    expect(mod.comprobarRespaldo(join(process.env['HOME'] ?? '/home/x', 'r.json')).ok).toBe(false);
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

describe('B2. el seco no escribe; --aplicar guarda respaldo, escribe una vez y relee', () => {
  it('seco (por omisión): lee, dice valor actual → nuevo, sale 1 y no escribe', async () => {
    const b = baseDe(FICHA);
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(1);
    expect(b.escrituras).toHaveLength(0);
    expect(salida).toContain('SECO');
    expect(salida).toContain('AUSENTE');
    expect(salida).toContain('AUSENTE → nueva');
    expect(b.datos()).toEqual(FICHA);
  });

  it('solo lee los campos que necesita (la bandera y el nombre para el freno)', async () => {
    const b = baseDe({ ...FICHA, secretoSintetico: 'no-leer' });
    await correr(cfgDe(), b);
    expect(b.lecturas.length).toBeGreaterThan(0);
    for (const l of b.lecturas) expect(l.campos?.slice().sort()).toEqual(['consolaConversaciones', 'nombre']);
  });

  it('una ficha que no existe: sale 1 y no escribe', async () => {
    const b = baseDe(null);
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(1);
    expect(b.escrituras).toHaveLength(0);
  });

  it('--aplicar: respaldo 0600 con el valor previo (ausente), UNA escritura solo de consolaConversaciones, con precondición, y relectura', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(codigo, salida).toBe(0);
    expect(b.escrituras).toHaveLength(1);
    expect(Object.keys(b.escrituras[0]!.campos)).toEqual(['consolaConversaciones']);
    expect(b.escrituras[0]!.precondicion).toHaveProperty('lastUpdateTime');
    expect(b.datos()).toEqual({ ...FICHA, consolaConversaciones: 'nueva' });
    const fd = openSync(ruta, 'r');
    let texto: string;
    try {
      expect((fstatSync(fd).mode & 0o777).toString(8)).toBe('600');
      texto = readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
    const r = JSON.parse(texto);
    expect(r.previo).toEqual({ presente: false, valor: null });
    expect(r.escrito).toBe('nueva');
    expect(JSON.stringify(r)).not.toContain('Tienda Sintetica');
    expect(fstatSync(openSync(dirname(ruta), 'r')).mode & 0o777).toBe(0o700);
    expect(salida).toContain('Escrito y releído');
  });

  it('"nueva" → "clasica" y de vuelta: cada cambio es una escritura; el mismo valor es "nada que hacer"', async () => {
    const b = baseDe({ ...FICHA, consolaConversaciones: 'nueva' });
    const mismo = await correr(cfgDe({ pantalla: 'nueva', aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(mismo.codigo).toBe(0);
    expect(mismo.salida).toContain('nada que hacer');
    expect(b.escrituras).toHaveLength(0);
    const otro = await correr(cfgDe({ pantalla: 'clasica', aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(otro.codigo).toBe(0);
    expect(b.datos()?.['consolaConversaciones']).toBe('clasica');
    expect(b.escrituras).toHaveLength(1);
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

  it('un valor previo que no es una pantalla conocida: no se escribe encima (no se podría restaurar con fidelidad)', async () => {
    for (const previo of ['moderna', '', 7, ['nueva'], { a: 1 }, null]) {
      const b = baseDe({ ...FICHA, consolaConversaciones: previo });
      const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
      expect(codigo, String(previo)).toBe(2);
      expect(b.escrituras).toHaveLength(0);
    }
  });

  it('la precondición: si la ficha cambia entre la lectura y la escritura, no se escribe', async () => {
    const b = baseDe(FICHA, { cambiaAntesDeEscribir: true });
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(3);
    expect(b.escrituras).toHaveLength(0);
    expect(b.datos()).not.toHaveProperty('consolaConversaciones');
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

  it('la salida nunca imprime el id del proyecto real', async () => {
    const b = baseDe(FICHA);
    const { salida } = await correr(cfgDe({ proyecto: 'proyecto-ficticio-prod', entorno: 'produccion', aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(salida).not.toContain('proyecto-ficticio-prod');
    expect(salida).toContain('produccion · tenant');
  });
});

describe('B3. revertir', () => {
  const rev = (ruta: string, extra: Cfg = {}) => cfgDe({ revertir: true, respaldo: ruta, pantalla: null, ...extra });

  it('restaura la AUSENCIA del campo (lo elimina) y es idempotente', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    expect((await correr(cfgDe({ aplicar: true, respaldo: ruta }), b)).codigo).toBe(0);
    const seco = await correr(rev(ruta), b);
    expect(seco.codigo).toBe(1);
    expect(b.datos()).toHaveProperty('consolaConversaciones');
    const real = await correr(rev(ruta, { aplicar: true }), b);
    expect(real.codigo, real.salida).toBe(0);
    expect(b.datos()).toEqual(FICHA);
    expect((await correr(rev(ruta, { aplicar: true }), b)).codigo).toBe(0);
  });

  it('restaura el valor previo cuando existía', async () => {
    const b = baseDe({ ...FICHA, consolaConversaciones: 'clasica' });
    const ruta = rutaRespaldo();
    expect((await correr(cfgDe({ pantalla: 'nueva', aplicar: true, respaldo: ruta }), b)).codigo).toBe(0);
    expect(b.datos()?.['consolaConversaciones']).toBe('nueva');
    expect((await correr(rev(ruta, { aplicar: true }), b)).codigo).toBe(0);
    expect(b.datos()?.['consolaConversaciones']).toBe('clasica');
  });

  it('NO pisa un cambio posterior: si el valor de hoy no es el que escribió el script, sale 2 sin escribir (lo editado queda intacto)', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    const antes = b.escrituras.length;
    (b.datos() as Record<string, unknown>)['consolaConversaciones'] = 'clasica';
    (b.datos() as Record<string, unknown>)['editadoDespues'] = 'intacto';
    const { codigo } = await correr(rev(ruta, { aplicar: true }), b);
    expect(codigo).toBe(2);
    expect(b.escrituras).toHaveLength(antes);
    expect(b.datos()).toMatchObject({ consolaConversaciones: 'clasica', editadoDespues: 'intacto' });
  });

  it('un campo borrado después tampoco se pisa', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    const antes = b.escrituras.length;
    delete (b.datos() as Record<string, unknown>)['consolaConversaciones'];
    // El campo ya no está y el respaldo dice que no existía: ya está como el respaldo, nada que revertir.
    expect((await correr(rev(ruta, { aplicar: true }), b)).codigo).toBe(0);
    expect(b.escrituras).toHaveLength(antes);
  });

  it('la precondición también vale al revertir', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    const c = baseDe({ ...FICHA, consolaConversaciones: 'nueva' }, { cambiaAntesDeEscribir: true });
    const { codigo } = await correr(rev(ruta, { aplicar: true }), c);
    expect(codigo).toBe(3);
    expect(c.escrituras).toHaveLength(0);
  });

  it('un respaldo de otro comercio, de otro entorno o alterado se rechaza', async () => {
    const b = baseDe(FICHA);
    const ruta = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(mod.leerRespaldo(ruta, { entorno: 'emulador', tenant: 'otro' }).motivo).toContain('otro comercio');
    expect(mod.leerRespaldo(ruta, { entorno: 'produccion', tenant: 'tienda-prueba' }).motivo).toContain('otro entorno');
    const base = JSON.parse(readFileSync(ruta, 'utf8'));
    for (const alterado of [
      { ...base, escrito: 'moderna' }, { ...base, previo: { presente: true, valor: 'moderna' } },
      { ...base, previo: { presente: false, valor: 'nueva' } }, { ...base, version: 2 }, { ...base, campo: 'consolaOculta' },
    ]) {
      const r = join(nuevoDir(), 'm.json');
      writeFileSync(r, JSON.stringify(alterado), { mode: 0o600 });
      expect(mod.leerRespaldo(r, { entorno: 'emulador', tenant: 'tienda-prueba' }).ok, JSON.stringify(alterado).slice(0, 90)).toBe(false);
    }
  });
});

describe('B4. Bellido por la ficha, y el texto del script', () => {
  it('ejecutar se niega con el id de Bellido sin abrir nada, aunque lo llamen sin pasar por los argumentos', async () => {
    const b = baseDe(FICHA);
    const { codigo, salida } = await correr(cfgDe({ tenant: 'bellido', aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(2);
    expect(salida).toContain('EXCLUIDO');
    expect(b.lecturas).toHaveLength(0);
    expect(b.escrituras).toHaveLength(0);
  });

  it('segunda barrera: el nombre de la ficha lo nombra y el id es otro', async () => {
    const b = baseDe({ nombre: 'Consultorio Dr. Bellido', flujos: ['agendamiento'] });
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(2);
    expect(salida).toContain('EXCLUIDO');
    expect(b.escrituras).toHaveLength(0);
    expect(b.datos()).not.toHaveProperty('consolaConversaciones');
  });

  it('el proceso sale 2 antes de abrir Firebase con Bellido, con producción sin confirmación y con pantalla inválida', () => {
    const correrHijo = (args: string[], extra: Record<string, string> = {}, host: string | undefined = HOST) =>
      spawnSync(process.execPath, [SCRIPT, ...args], { env: entornoDelEmulador(host, extra), encoding: 'utf8' });
    const b = correrHijo(['--proyecto', PROY, '--tenant', 'bellido', '--pantalla', 'nueva', '--aplicar', '--respaldo', rutaRespaldo()]);
    expect(b.status).toBe(2);
    expect(b.stderr).toContain('EXCLUIDO');
    expect(b.stdout).toBe('');
    const prod = correrHijo(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--pantalla', 'nueva', '--aplicar', '--respaldo', rutaRespaldo()], ENV_REAL, undefined);
    expect(prod.status).toBe(2);
    expect(prod.stderr).not.toContain('proyecto-ficticio-prod');
    expect(correrHijo(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--pantalla', 'moderna']).status).toBe(2);
  });

  const f = sinComentarios(readFileSync(SCRIPT, 'utf8'));
  it('su única escritura a Firestore es `update` del campo consolaConversaciones', () => {
    expect(f.match(/\.update\(/g)).toHaveLength(1);
    expect(f).toContain('await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });');
    expect(f).toContain("const CAMPO = 'consolaConversaciones';");
    expect(f.replace(/FieldValue\.delete\(\)/g, '')).not.toMatch(/\.(set|create|delete|add)\(/);
    expect(f).not.toMatch(/\bbatch\b|runTransaction|collection\(/);
  });
  it('el respaldo se abre sin pisar ni seguir enlaces y el script no imprime el proyecto', () => {
    expect(f).toContain('constants.O_NOFOLLOW');
    expect(f).not.toMatch(/console\.(log|error)\([^)]*proyecto\b(?!s)/);
    expect(f).not.toMatch(/log\([^)]*cfg\.proyecto/);
  });
  it('importa la validación de la pantalla del mismo archivo que la consola, no una lista propia', () => {
    expect(f).toContain('functions/src/central/consola-conversaciones.ts');
    expect(f).toContain('validarPantallaConversaciones');
    expect(f).not.toMatch(/\['clasica', 'nueva'\]|"clasica"|=== 'nueva'/);
  });
});
