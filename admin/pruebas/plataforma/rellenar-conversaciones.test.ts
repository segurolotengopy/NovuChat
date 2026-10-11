/**
 * `scripts/plataforma/rellenar-conversaciones.mjs` — RELLENA `telefonoTrozos` y `nombrePalabras` EN LAS
 * CONVERSACIONES ANTIGUAS DE UN COMERCIO (H1-5; contrato en el encabezado del script).
 *
 * Sin emulador ni nube: lógica pura y una Firestore en memoria (`conversaciones-base-en-memoria.ts`). Las
 * conversaciones, los teléfonos y los nombres son sintéticos. El mismo script contra el emulador real está en
 * `conversaciones-scripts-emulador.test.ts`.
 *
 *   R1. Argumentos y salvaguarda (negando todo): Bellido, producción con confirmación, el respaldo fuera de `~/`.
 *   R2. Lo que se deriva: las MISMAS funciones de Core que la ingesta; solo se agrega lo que falta.
 *   R3. Seco por omisión: no escribe, cuenta, no imprime teléfonos ni nombres.
 *   R4. Aplicar: páginas de 300, lotes de a lo sumo 400, precondición, respaldo 0600/0700, idempotencia.
 *   R5. Revertir: borra solo lo escrito y que siga igual.
 *   R6. El texto del script: la única escritura es `update` de los dos campos; no toca mensajes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { camposDeConversacionPorMensaje } from '../../functions/src/core/conversacion/derivados';
import { baseEnMemoria, type BaseEnMemoria } from './conversaciones-base-en-memoria';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const SCRIPT = join(ADMIN, 'scripts', 'plataforma', 'rellenar-conversaciones.mjs');
const sinComentarios = (f: string) => f
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Cfg = Record<string, unknown>;
type Salida = { ok: boolean; problemas?: string[]; cfg?: Cfg };
const mod = await import('../../scripts/plataforma/rellenar-conversaciones.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => Salida;
  derivarDe: (doc: unknown) => { campos: Record<string, string[]>; sinTelefono: boolean };
  soloCamposDerivados: (d: Record<string, unknown>) => Record<string, unknown>;
  escribirLote: (db: unknown, lote: { ref: unknown; datos: Record<string, unknown>; updateTime: unknown }[]) => Promise<{ escritas: number[]; saltadas: number[] }>;
  leerRespaldo: (ruta: string, o: { entorno: string; tenant: string }) => { ok: boolean; motivo?: string; respaldo?: { items: { conversacionId: string; camposAgregados: string[]; huellas: Record<string, string> }[] } };
  huellaDe: (v: unknown) => string;
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  CAMPOS_DERIVADOS: string[]; TAMANO_PAGINA: number; TAMANO_LOTE: number;
};
const comun = await import('../../scripts/plataforma/aplicar-consola-conversaciones.mjs') as unknown as {
  comprobarRespaldo: (r: unknown, o?: Record<string, unknown>) => { ok: boolean; motivo?: string; real?: string };
  guardarRespaldo: (ruta: string, contenido: unknown) => void;
  RAICES_TEMPORALES: readonly string[];
  esTenantExcluido: (t: unknown, env?: Record<string, string>) => boolean;
};

const HOST = '127.0.0.1:1';
const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };
const PROY = 'demo-novuchat-pruebas';
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const T = 'tienda-prueba';

/** Corre git en `cwd` (sin HOME ni configuración global: la prueba no depende de la máquina). */
const git = (cwd: string, args: string[]) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { env: { PATH: process.env['PATH'] ?? '', LC_ALL: 'C' }, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
};

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'rell-conv-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

// ---------------------------------------------------------------- datos sintéticos
/** Un teléfono boliviano sintético: el prefijo del país y 8 dígitos (nunca un número de 10 o más escrito de una vez). */
const num = (resto: string) => `591${resto}`;
const tel = (n: number) => `59171${String(100000 + n).padStart(6, '1')}`.slice(0, 11);
const ID = (n: number) => `wa_${tel(n)}`;
const conv = (n: number, extra: Record<string, unknown> = {}) => ({ telefono: tel(n), nombreContacto: `Cliente Prueba ${n}`, ultimoEn: 'sintetico', ...extra });
const rutaConv = (n: number) => `tenants/${T}/conversaciones/${ID(n)}`;
function sembrar(cantidad: number, extra: (n: number) => Record<string, unknown> = () => ({}), ficha: Record<string, unknown> = { nombre: 'Tienda Sintetica', estado: 'activo' }): BaseEnMemoria {
  const inicial: Record<string, Record<string, unknown>> = { [`tenants/${T}`]: ficha };
  for (let n = 1; n <= cantidad; n++) inicial[rutaConv(n)] = conv(n, extra(n));
  return baseEnMemoria(inicial);
}
/** Como `analizarArgumentos`: la ruta REAL del respaldo se resuelve al validar, ANTES de que la carpeta exista. */
const cfgDe = (extra: Cfg = {}): Cfg => {
  const c: Cfg = { proyecto: PROY, entorno: 'emulador', tenant: T, aplicar: false, revertir: false, respaldo: null, ...extra };
  if (typeof c['respaldo'] === 'string' && !('respaldoResuelto' in c)) c['respaldoResuelto'] = comun.comprobarRespaldo(c['respaldo'], { permitirExistente: true }).real ?? null;
  return c;
};
async function correr(cfg: Cfg, b: BaseEnMemoria, extraDeps: Record<string, unknown> = {}) {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue: b.FieldValue, FieldPath: b.FieldPath, log: (t: string) => salida.push(t), ...extraDeps });
  return { codigo, salida: salida.join('\n') };
}
const modo = (ruta: string) => (statSync(ruta).mode & 0o777).toString(8);

// =====================================================================================================
describe('R1. argumentos y salvaguarda (puros)', () => {
  const base = ['--proyecto', PROY, '--tenant', T];
  const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación mínima es válida y queda en seco', () => {
    const r = mod.analizarArgumentos(base, ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: T, aplicar: false, revertir: false, entorno: 'emulador', respaldo: null });
  });

  it('BELLIDO se rechaza: por id, dentro de otro id y por la variable de exclusión', () => {
    expect(problemas(['--proyecto', PROY, '--tenant', 'bellido'])).toContain('EXCLUIDO');
    expect(problemas(['--proyecto', PROY, '--tenant', 'consultorio-bellido'])).toContain('EXCLUIDO');
    expect(problemas(['--proyecto', PROY, '--tenant', 'bellido2', '--aplicar', '--respaldo', rutaRespaldo()])).toContain('EXCLUIDO');
    expect(problemas(['--proyecto', PROY, '--tenant', 'bellido', '--revertir', '--respaldo', rutaRespaldo()])).toContain('EXCLUIDO');
    expect(problemas(base, { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'otro-comercio,tienda-prueba' })).toContain('EXCLUIDO');
    expect(comun.esTenantExcluido('Béllido')).toBe(true); // sin tildes ni mayúsculas, igual se reconoce (y el formato del id lo corta antes)
    expect(comun.esTenantExcluido('bellido')).toBe(true);
    // La variable solo AGREGA: no puede sacar a Bellido de la lista.
    expect(comun.esTenantExcluido('bellido', { NOVUCHAT_TENANTS_EXCLUIDOS: 'otro' })).toBe(true);
  });

  it('UN comercio, sin formas raras, y sin opciones desconocidas ni repetidas', () => {
    expect(problemas(['--proyecto', PROY, '--tenant', 'a-b-c,d-e-f'])).toContain('UN solo comercio');
    expect(problemas(['--proyecto', PROY, '--tenant', '../otro'])).toContain('--tenant inválido');
    expect(problemas(['--proyecto', PROY])).toContain('falta --tenant');
    expect(problemas([...base, '--todos'])).toContain('opción desconocida: --todos');
    expect(problemas([...base, '--aplicar=quiero-secreto'])).not.toContain('quiero-secreto');
    expect(problemas([...base, '--aplicar', '--aplicar'])).toContain('opción repetida: --aplicar');
    expect(problemas(['suelto', ...base])).toContain('argumento suelto');
  });

  it('--aplicar y --revertir exigen --respaldo; no hay uno por omisión', () => {
    expect(problemas([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
    expect(problemas([...base, '--revertir'])).toContain('--revertir exige --respaldo');
  });

  it('producción: --aplicar sin --confirmo-produccion se rechaza; con otro tenant también; en el emulador sobra', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', T, '--aplicar', '--respaldo', rutaRespaldo()];
    expect(problemas(prod, ENV_REAL)).toContain('--confirmo-produccion');
    expect(problemas([...prod, '--confirmo-produccion', 'otro-comercio'], ENV_REAL)).toContain('no coincide');
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', T], ENV_REAL).ok).toBe(true);
    expect(problemas([...base, '--confirmo-produccion', T])).toContain('solo se usa contra producción');
    // El seco en producción no pide confirmación (solo lee).
    expect(mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', T], ENV_REAL).ok).toBe(true);
    // Un proyecto real fuera de la lista blanca, o con emulador puesto, se rechaza.
    expect(problemas(['--proyecto', 'otro-proyecto-real', '--tenant', T], ENV_REAL)).toContain('lista blanca');
  });

  it('el id de un proyecto real nunca aparece en los problemas', () => {
    const r = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'bellido', '--aplicar'], ENV_REAL);
    expect((r.problemas ?? []).join(' ')).not.toContain('proyecto-ficticio-prod');
  });

  // Todas las pruebas de la ruta del respaldo arman SUS PROPIAS carpetas temporales (nada depende de que `$HOME`,
  // `/tmp` o `tmpdir()` no sean un repositorio) e inyectan las raíces permitidas.
  it('el respaldo NUNCA va en `~/` ni en una carpeta versionable; sí en el scratchpad (/tmp, /var/tmp) o en una carpeta ignorada del proyecto', () => {
    // Lista POSITIVA: solo lo que está dentro de una raíz permitida vale; lo demás, no.
    const zona = nuevoDir();
    const fuera = nuevoDir();
    expect(comun.comprobarRespaldo(join(zona, 'nueva', 'r.json'), { raices: [zona] }).ok).toBe(true);
    expect(comun.comprobarRespaldo(join(fuera, 'r.json'), { raices: [zona] }).motivo).toContain('~/');
    expect(comun.comprobarRespaldo(join(fuera, 'sub', 'r.json'), { raices: [zona] }).motivo).toContain('~/');
    expect(comun.comprobarRespaldo(join(zona, 'r.json'), { raices: [] }).motivo).toContain('~/');
    // Las raíces por omisión son FIJAS: `/tmp` y `/var/tmp`, nunca lo que diga `TMPDIR`.
    expect([...comun.RAICES_TEMPORALES]).toEqual(['/tmp', '/var/tmp']);
    // Relativa, con «..» o repetida: rechazada.
    expect(comun.comprobarRespaldo('relativo/r.json').ok).toBe(false);
    expect(comun.comprobarRespaldo(`${nuevoDir()}/../r.json`).ok).toBe(false);
    // Dentro de un repositorio (un repo temporal que hace de «el proyecto»): solo en carpeta ignorada por git.
    const repo = nuevoDir();
    git(repo, ['init', '-q']);
    writeFileSync(join(repo, '.gitignore'), 'privado/\n*.respaldo*\n');
    mkdirSync(join(repo, 'privado'), { mode: 0o700 });
    mkdirSync(join(repo, 'publico'), { mode: 0o700 });
    const en = { raiz: repo, raices: [] as string[] };
    expect(comun.comprobarRespaldo(join(repo, 'privado', 'r.json'), en).ok).toBe(true);
    expect(comun.comprobarRespaldo(join(repo, 'privado', 'nueva', 'r.json'), en).ok).toBe(true);
    expect(comun.comprobarRespaldo(join(repo, 'publico', 'r.json'), en).motivo).toContain('ignorada por git');
    expect(comun.comprobarRespaldo(join(repo, 'r.json'), en).motivo).toContain('ignorada por git');
    expect(comun.comprobarRespaldo(join(repo, 'publico', 'x.respaldo-h1'), en).ok).toBe(true);
    // Un repositorio que NO es el proyecto, aunque ignore la carpeta, no vale.
    const otro = nuevoDir();
    git(otro, ['init', '-q']);
    expect(comun.comprobarRespaldo(join(repo, 'privado', 'r.json'), { raiz: otro, raices: [] }).motivo).toContain('otro repositorio');
  });

  it('DESDE UN WORKTREE: se acepta el repositorio común; una subcarpeta nueva dentro de una carpeta ignorada 0775 vale; lo versionable y `~/` siguen rechazados', () => {
    const principal = join(nuevoDir(), 'principal');
    mkdirSync(principal);
    git(principal, ['init', '-q', '-b', 'main']);
    writeFileSync(join(principal, '.gitignore'), 'CLIENTES/\n');
    writeFileSync(join(principal, 'a.txt'), 'x');
    git(principal, ['add', '.gitignore', 'a.txt']);
    git(principal, ['-c', 'user.name=prueba', '-c', 'user.email=prueba@invalid', 'commit', '-q', '-m', 'inicial']);
    const worktree = join(nuevoDir(), 'wt');
    git(principal, ['worktree', 'add', '-q', '-b', 'rama-prueba', worktree]);
    // `CLIENTES/<CLIENTE>/` de la copia principal: ignorada, del usuario y 0775 (como en la máquina real).
    mkdirSync(join(principal, 'CLIENTES', 'TIENDA'), { recursive: true });
    chmodSync(join(principal, 'CLIENTES', 'TIENDA'), 0o775);
    const sinRaices = { raiz: worktree, raices: [] as string[] };

    // Positiva: la subcarpeta NUEVA dentro de la ignorada, vista desde el worktree.
    const ruta = join(principal, 'CLIENTES', 'TIENDA', 'respaldos-h1', 'r.json');
    expect(comun.comprobarRespaldo(ruta, sinRaices)).toMatchObject({ ok: true });
    // Y también vista desde la copia principal.
    expect(comun.comprobarRespaldo(ruta, { raiz: principal, raices: [] }).ok).toBe(true);
    // El script la crea con 0700 y el respaldo con 0600 (aunque la carpeta del cliente sea 0775).
    comun.guardarRespaldo(ruta, { prueba: true });
    expect((statSync(dirname(ruta)).mode & 0o777).toString(8)).toBe('700');
    expect((statSync(ruta).mode & 0o777).toString(8)).toBe('600');
    expect((statSync(join(principal, 'CLIENTES', 'TIENDA')).mode & 0o777).toString(8)).toBe('775');
    // Con la subcarpeta ya creada (0700) otro respaldo nuevo dentro también vale; el mismo archivo ya no (nunca se pisa).
    expect(comun.comprobarRespaldo(join(dirname(ruta), 'otro.json'), sinRaices).ok).toBe(true);
    expect(comun.comprobarRespaldo(ruta, sinRaices).motivo).toContain('nunca se pisa');

    // Negativas: lo versionable del proyecto, vista desde el worktree y desde la principal.
    expect(comun.comprobarRespaldo(join(principal, 'publico', 'r.json'), sinRaices).motivo).toContain('ignorada por git');
    // El destino duradero es la COPIA PRINCIPAL: un worktree se rechaza aunque su carpeta esté ignorada.
    expect(comun.comprobarRespaldo(join(worktree, 'r.json'), sinRaices).motivo).toContain('copia principal');
    mkdirSync(join(worktree, 'CLIENTES', 'TIENDA'), { recursive: true });
    expect(comun.comprobarRespaldo(join(worktree, 'CLIENTES', 'TIENDA', 'respaldos-h1', 'r.json'), sinRaices).motivo).toContain('copia principal');
    // Una carpeta externa con un `.git` que apunta al proyecto tampoco vale.
    const externa = nuevoDir();
    writeFileSync(join(externa, '.git'), `gitdir: ${join(principal, '.git')}\n`);
    mkdirSync(join(externa, 'CLIENTES', 'TIENDA'), { recursive: true });
    expect(comun.comprobarRespaldo(join(externa, 'CLIENTES', 'TIENDA', 'respaldos-h1', 'r.json'), sinRaices).ok).toBe(false);
    const externaWt = nuevoDir();
    writeFileSync(join(externaWt, '.git'), `gitdir: ${join(principal, '.git', 'worktrees', 'wt')}\n`);
    mkdirSync(join(externaWt, 'CLIENTES'), { recursive: true });
    expect(comun.comprobarRespaldo(join(externaWt, 'CLIENTES', 'r.json'), sinRaices).ok).toBe(false);
    expect(comun.comprobarRespaldo(join(principal, 'r.json'), { raiz: principal, raices: [] }).motivo).toContain('ignorada por git');
    // Negativa: otro repositorio distinto del del proyecto.
    const ajeno = join(nuevoDir(), 'ajeno');
    mkdirSync(ajeno);
    git(ajeno, ['init', '-q']);
    writeFileSync(join(ajeno, '.gitignore'), 'CLIENTES/\n');
    mkdirSync(join(ajeno, 'CLIENTES'));
    expect(comun.comprobarRespaldo(join(ajeno, 'CLIENTES', 'r.json'), sinRaices).motivo).toContain('otro repositorio');
    // Negativa: fuera del proyecto y de las raíces permitidas (el caso `~/`).
    const casa = nuevoDir();
    expect(comun.comprobarRespaldo(join(casa, 'r.json'), sinRaices).motivo).toContain('~/');
    expect(comun.comprobarRespaldo(join(casa, 'sub', 'r.json'), sinRaices).motivo).toContain('~/');
    // Un `.git` "plantado" que git no reconoce no deja pasar (git no puede decir el repositorio).
    const falso = nuevoDir();
    mkdirSync(join(falso, '.git'));
    expect(comun.comprobarRespaldo(join(falso, 'r.json'), sinRaices).ok).toBe(false);
  });

  it('L7: dentro del proyecto el padre nunca puede ser escribible por «otros»; 0775 con el grupo del usuario sí pasa', () => {
    const principal = join(nuevoDir(), 'principal');
    mkdirSync(principal);
    git(principal, ['init', '-q']);
    writeFileSync(join(principal, '.gitignore'), 'CLIENTES/\n');
    const cliente = join(principal, 'CLIENTES', 'TIENDA');
    mkdirSync(cliente, { recursive: true });
    const ruta = join(cliente, 'respaldos-h1', 'r.json');
    const en = { raiz: principal, raices: [] as string[] };
    chmodSync(cliente, 0o775);
    expect(comun.comprobarRespaldo(ruta, en).ok).toBe(true);
    chmodSync(cliente, 0o777);
    expect(comun.comprobarRespaldo(ruta, en).motivo).toContain('la pueden escribir otros');
    chmodSync(cliente, 0o757);
    expect(comun.comprobarRespaldo(ruta, en).ok).toBe(false);
    chmodSync(cliente, 0o700);
    expect(comun.comprobarRespaldo(ruta, en).ok).toBe(true);
    // Un padre con escritura de grupo es aceptable SOLO si el grupo es el del usuario (`gid` inyectado: sin privilegios no se puede armar otro grupo).
    chmodSync(cliente, 0o775);
    const gidPropio = statSync(cliente).gid;
    expect(comun.comprobarRespaldo(ruta, { ...en, gid: gidPropio }).ok).toBe(true);
    expect(comun.comprobarRespaldo(ruta, { ...en, gid: gidPropio + 1 }).motivo).toContain('la pueden escribir otros');
    chmodSync(cliente, 0o755);
    expect(comun.comprobarRespaldo(ruta, { ...en, gid: gidPropio + 1 }).ok).toBe(true); // sin escritura de grupo, el grupo da igual
  });

  it('fuera del proyecto (scratchpad) el padre existente tampoco puede ser escribible por grupo ni otros', () => {
    const zona = nuevoDir();
    const ruta = join(zona, 'respaldos', 'r.json');
    chmodSync(zona, 0o770);
    expect(comun.comprobarRespaldo(ruta, { raices: [zona] }).motivo).toContain('la pueden escribir otros');
    chmodSync(zona, 0o777);
    expect(comun.comprobarRespaldo(ruta, { raices: [zona] }).ok).toBe(false);
    chmodSync(zona, 0o700);
    expect(comun.comprobarRespaldo(ruta, { raices: [zona] }).ok).toBe(true);
  });

  it('L5: si la carpeta del respaldo se cambia por un enlace DESPUÉS de validarla, la corrida se detiene y no se escribe en Firestore', async () => {
    const b = sembrar(4);
    const zona = nuevoDir();
    const ruta = join(zona, 'respaldos', 'r.json');
    const cfg = cfgDe({ aplicar: true, respaldo: ruta });
    // La carpeta «versionada» a la que alguien redirige el respaldo (un repositorio ajeno, no ignorado).
    const trampa = nuevoDir();
    git(trampa, ['init', '-q']);
    const { codigo, salida } = await correr(cfg, b, {
      // Se llama justo después de guardar el respaldo y antes de la última comprobación: ahí ocurre el cambio.
      leerRespaldo: (r: string, o: { tenant: string }) => {
        const lectura = mod.leerRespaldo(r, { entorno: 'emulador', tenant: o.tenant });
        renameSync(join(zona, 'respaldos'), join(zona, 'respaldos-original'));
        symlinkSync(trampa, join(zona, 'respaldos'));
        return lectura;
      },
    });
    expect(codigo, salida).toBe(2);
    expect(salida).toContain('La ruta del respaldo cambió durante la corrida. No se escribe nada.');
    expect(b.estado.escrituras).toHaveLength(0);
    expect(b.estado.lotes).toHaveLength(0);
    for (let n = 1; n <= 4; n++) expect(b.leer(rutaConv(n))).not.toHaveProperty('telefonoTrozos');
    // Variante: el enlace lleva a una carpeta ACEPTABLE (otra del scratchpad, sin repositorio) pero DISTINTA de la validada.
    const b4 = sembrar(3);
    const zona2 = nuevoDir();
    const otraBuena = nuevoDir();
    const r4 = await correr(cfgDe({ aplicar: true, respaldo: join(zona2, 'respaldos', 'r.json') }), b4, {
      leerRespaldo: (r: string, o: { tenant: string }) => {
        const lectura = mod.leerRespaldo(r, { entorno: 'emulador', tenant: o.tenant });
        renameSync(join(zona2, 'respaldos'), join(zona2, 'respaldos-original'));
        symlinkSync(otraBuena, join(zona2, 'respaldos'));
        return lectura;
      },
    });
    expect(r4.codigo, r4.salida).toBe(2);
    expect(r4.salida).toContain('La ruta del respaldo cambió durante la corrida');
    expect(b4.estado.escrituras).toHaveLength(0);
    // Sin cambio, la misma corrida escribe (control de la prueba).
    const b2 = sembrar(2);
    expect((await correr(cfgDe({ aplicar: true, respaldo: join(nuevoDir(), 'sub', 'r.json') }), b2)).codigo).toBe(0);
    // Una cfg armada a mano sin la ruta resuelta no puede afirmar nada: se detiene.
    const sinResuelta = cfgDe({ aplicar: true, respaldo: join(nuevoDir(), 'sub', 'r.json'), respaldoResuelto: null });
    const b3 = sembrar(2);
    expect((await correr(sinResuelta, b3)).codigo).toBe(2);
    expect(b3.estado.escrituras).toHaveLength(0);
  });

  it('analizarArgumentos entrega la ruta REAL validada (cfg.respaldoResuelto) para la última comprobación', () => {
    const ruta = join(nuevoDir(), 'sub', 'r.json');
    const r = mod.analizarArgumentos(['--proyecto', PROY, '--tenant', T, '--aplicar', '--respaldo', ruta], ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg?.['respaldoResuelto']).toBe(comun.comprobarRespaldo(ruta).real);
    expect(typeof r.cfg?.['respaldoResuelto']).toBe('string');
  });

  it('TMPDIR no amplía la lista: aunque apunte debajo de la casa, un respaldo ahí se rechaza (y el hijo sale 2)', () => {
    const casa = process.env['HOME'] ?? '/home/x';
    const antes = process.env['TMPDIR'];
    // TMPDIR = la casa misma (existe y es del usuario: con una raíz que dependa de TMPDIR, el respaldo pasaría).
    // La ruta es de una carpeta que NO existe: la prueba no crea nada en la casa.
    const destino = join(casa, 'respaldos-h1-inexistente-de-prueba', 'r.json');
    process.env['TMPDIR'] = casa;
    try {
      expect(comun.comprobarRespaldo(destino).ok).toBe(false);
      const hijo = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROY, '--tenant', T, '--aplicar', '--respaldo', destino],
        { env: entornoDelEmulador(HOST, { TMPDIR: casa }), encoding: 'utf8' });
      expect(hijo.status).toBe(2);
      expect(() => statSync(dirname(destino))).toThrow();
    } finally {
      if (antes === undefined) delete process.env['TMPDIR']; else process.env['TMPDIR'] = antes;
    }
    // Una raíz permitida no depende de lo que haya POR ENCIMA de ella: un repo en el padre de la raíz no cuenta.
    const padre = nuevoDir();
    git(padre, ['init', '-q']);
    const zona = join(padre, 'zona');
    mkdirSync(zona, { mode: 0o700 });
    expect(comun.comprobarRespaldo(join(zona, 'nueva', 'r.json'), { raices: [zona] }).ok).toBe(true);
  });

  it('el respaldo: carpeta 0700 exigida, nunca se pisa, lectura exige 0600', () => {
    const dir = nuevoDir();
    const ruta = join(dir, 'r.json');
    expect(comun.comprobarRespaldo(ruta).ok).toBe(true);
    chmodSync(dir, 0o755);
    expect(comun.comprobarRespaldo(ruta).motivo).toContain('0700');
    chmodSync(dir, 0o700);
    writeFileSync(ruta, '{}', { mode: 0o600 });
    expect(comun.comprobarRespaldo(ruta).motivo).toContain('nunca se pisa');
    expect(comun.comprobarRespaldo(ruta, { lectura: true }).ok).toBe(true);
    chmodSync(ruta, 0o644);
    expect(comun.comprobarRespaldo(ruta, { lectura: true }).motivo).toContain('0600');
  });
});

// =====================================================================================================
describe('R2. lo que se deriva: las funciones de Core, y solo lo que falta', () => {
  it('arma telefonoTrozos y nombrePalabras como lo hace la ingesta (corpus fijo)', () => {
    const corpus = [
      { telefono: num('70011223'), nombreContacto: 'María José Pérez' },
      { telefono: num('78899001'), nombreContacto: 'Alfajores Don Luis S.A.' },
      { telefono: num('71122334'), nombreContacto: 'Ñ' },
      { telefono: num('71122334') },
      { telefono: num('71122334'), nombreContacto: 'Uno Dos Tres Cuatro Cinco Seis Siete Ocho' },
      { telefono: num('71122334'), nombreContacto: 'ﬁesta Ｃｏｍｅｒｃｉｏ' },
    ];
    for (const c of corpus) {
      // La ingesta, para un mensaje SALIENTE, escribe exactamente estos dos campos (sin ventana ni no leídos).
      const ingesta = camposDeConversacionPorMensaje({ telefono: c.telefono, direccion: 'saliente', nombreContacto: c.nombreContacto }, Date.now());
      expect(Object.keys(ingesta).every((k) => ['telefonoTrozos', 'nombrePalabras'].includes(k))).toBe(true);
      expect(mod.derivarDe(c).campos).toEqual(ingesta);
    }
    expect(mod.derivarDe({ telefono: num('70011223') }).campos).toEqual({ telefonoTrozos: [num('70011223'), `91${'70011223'}`, `1${'70011223'}`, '70011223', '0011223', '011223', '11223', '1223'] });
  });

  it('un entrante de la ingesta escribe ventana y no leídos; el relleno NUNCA los deriva', () => {
    const entrante = camposDeConversacionPorMensaje({ telefono: num('70011223'), direccion: 'entrante' }, Date.now());
    expect(Object.keys(entrante)).toEqual(expect.arrayContaining(['ultimoEntranteEn', 'ventanaVenceEn', 'noLeidos', 'sinLeer']));
    const r = mod.derivarDe({ telefono: num('70011223'), nombreContacto: 'Ana Prueba', ultimoEntranteEn: 'x', noLeidos: 3 });
    expect(Object.keys(r.campos).every((k) => mod.CAMPOS_DERIVADOS.includes(k))).toBe(true);
  });

  it('solo agrega un campo AUSENTE: uno que ya está (aunque difiera) no se toca', () => {
    expect(mod.derivarDe({ telefono: num('70011223'), nombreContacto: 'Ana Prueba', telefonoTrozos: ['viejo'], nombrePalabras: ['viejo'] }).campos).toEqual({});
    expect(mod.derivarDe({ telefono: num('70011223'), nombreContacto: 'Ana Prueba', telefonoTrozos: ['viejo'] }).campos).toEqual({ nombrePalabras: ['ana', 'prueba'] });
  });

  it('sin dato no se inventa: sin teléfono no hay trozos, sin nombre no hay palabras, valores raros se ignoran', () => {
    for (const raro of [null, undefined, 7, 'texto', [], {}]) {
      expect(mod.derivarDe(raro).campos).toEqual({});
    }
    expect(mod.derivarDe({ nombreContacto: 'Ana Prueba' })).toEqual({ campos: { nombrePalabras: ['ana', 'prueba'] }, sinTelefono: true });
    expect(mod.derivarDe({ telefono: Number(num('70011223')) }).campos).toEqual({});
    expect(mod.derivarDe({ telefono: '123' }).campos).toEqual({});
    expect(mod.derivarDe({ telefono: num('70011223'), nombreContacto: 12345 }).campos).not.toHaveProperty('nombrePalabras');
    expect(mod.derivarDe({ telefono: num('70011223'), nombreContacto: 'a b' }).campos).not.toHaveProperty('nombrePalabras');
  });

  it('la guarda de la escritura rechaza cualquier campo fuera de la lista cerrada', () => {
    expect(() => mod.soloCamposDerivados({ telefonoTrozos: [], nombrePalabras: [] })).not.toThrow();
    for (const prohibido of ['ultimoEntranteEn', 'ventanaVenceEn', 'noLeidos', 'sinLeer', 'atencionEstado', 'tenantId', 'palabras', '__proto__x']) {
      expect(() => mod.soloCamposDerivados({ telefonoTrozos: [], [prohibido]: 1 }), prohibido).toThrow();
    }
  });
});

// =====================================================================================================
describe('R3. seco por omisión', () => {
  it('lee, cuenta, no escribe, sale 1 y no imprime teléfonos ni nombres', async () => {
    const b = sembrar(10, (n) => (n <= 2 ? { telefonoTrozos: ['ya'], nombrePalabras: ['ya'] } : n === 3 ? { telefono: undefined, nombreContacto: undefined } : {}));
    const antes = b.rutas().map((r) => [r, JSON.stringify(b.leer(r))]);
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(1);
    expect(b.estado.escrituras).toHaveLength(0);
    expect(b.estado.lotes).toHaveLength(0);
    expect(b.rutas().map((r) => [r, JSON.stringify(b.leer(r))])).toEqual(antes);
    expect(salida).toContain('SECO');
    expect(salida).toMatch(/conversaciones leídas\s*: 10\b/);
    expect(salida).toMatch(/se tocarían \(campos que agregar\)\s*: 7\b/);
    expect(salida).toMatch(/ya al día\s*: 2\b/);
    expect(salida).toMatch(/se saltarían \(sin teléfono que derivar\)\s*: 1\b/);
    expect(salida).toContain('mensajes antiguos no se rellenan');
    expect(salida).toContain('solo hallará mensajes NUEVOS');
    // Ningún teléfono ni nombre ni id de conversación en la salida.
    for (let n = 1; n <= 10; n++) {
      expect(salida).not.toContain(tel(n));
      expect(salida).not.toContain(ID(n));
      expect(salida).not.toContain(`Prueba ${n}`);
    }
    expect(salida).not.toMatch(/[0-9]{8,}/);
  });

  it('una corrida en seco con --aplicar ausente no guarda respaldo aunque se le pase la ruta', async () => {
    const b = sembrar(3);
    const ruta = rutaRespaldo();
    const { codigo } = await correr(cfgDe({ respaldo: ruta }), b);
    expect(codigo).toBe(1);
    expect(() => statSync(ruta)).toThrow();
  });

  it('una ficha que no existe: sale 1 y no lee conversaciones ni escribe', async () => {
    const b = baseEnMemoria({});
    const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(1);
    expect(b.estado.consultas).toHaveLength(0);
    expect(b.estado.escrituras).toHaveLength(0);
  });

  it('recorre en páginas de 300 por id, sin saltarse ni repetir ninguna', async () => {
    expect(mod.TAMANO_PAGINA).toBe(300);
    expect(mod.TAMANO_LOTE).toBe(400);
    const b = sembrar(650);
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(1);
    expect(b.estado.consultas.map((c) => c.limite)).toEqual([300, 300, 300]);
    expect(b.estado.consultas[0]!.despuesDe).toBeNull();
    expect(b.estado.consultas[1]!.despuesDe).not.toBeNull();
    expect(salida).toMatch(/conversaciones leídas\s*: 650\b/);
    // 650 leídas del recorrido + 1 de la ficha.
    expect(b.estado.lecturas).toBe(651);
  });

  it('una colección de exactamente 300 hace una consulta de más que vuelve vacía y termina', async () => {
    const b = sembrar(300);
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(1);
    expect(salida).toMatch(/conversaciones leídas\s*: 300\b/);
    expect(b.estado.consultas.length).toBe(2);
  });

  it('un comercio sin conversaciones: nada que hacer, sale 0', async () => {
    const b = sembrar(0);
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(0);
    expect(salida).toContain('nada que hacer');
  });
});

// =====================================================================================================
describe('R4. aplicar', () => {
  it('escribe SOLO telefonoTrozos y nombrePalabras, con respaldo previo 0600 en carpeta 0700', async () => {
    const b = sembrar(5);
    const ruta = rutaRespaldo();
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(codigo, salida).toBe(0);
    expect(b.estado.escrituras).toHaveLength(5);
    for (const e of b.estado.escrituras) expect(e.campos.sort()).toEqual(['nombrePalabras', 'telefonoTrozos']);
    for (let n = 1; n <= 5; n++) {
      const d = b.leer(rutaConv(n))!;
      expect(Object.keys(d).sort()).toEqual(['nombreContacto', 'nombrePalabras', 'telefono', 'telefonoTrozos', 'ultimoEn']);
      expect(d['telefonoTrozos']).toEqual(mod.derivarDe({ telefono: tel(n) }).campos['telefonoTrozos']);
      expect(d['nombrePalabras']).toEqual(['client', 'prueba']);
    }
    expect(b.leer(`tenants/${T}`)).toEqual({ nombre: 'Tienda Sintetica', estado: 'activo' });
    // Respaldo: archivo 0600, carpeta 0700; se abre UNA vez y modo y contenido salen del mismo descriptor.
    expect(modo(dirname(ruta))).toBe('700');
    const fd = openSync(ruta, 'r');
    let texto: string;
    try {
      expect((fstatSync(fd).mode & 0o777).toString(8)).toBe('600');
      texto = readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
    const r = JSON.parse(texto);
    expect(r).toMatchObject({ version: 1, tipo: 'relleno-conversaciones', entorno: 'emulador', tenant: T });
    expect(r.items).toHaveLength(5);
    expect(r.items[0]).toEqual({
      conversacionId: ID(1), camposAgregados: ['telefonoTrozos', 'nombrePalabras'],
      huellas: { telefonoTrozos: mod.huellaDe(mod.derivarDe({ telefono: tel(1) }).campos['telefonoTrozos']), nombrePalabras: mod.huellaDe(['client', 'prueba']) },
    });
    // El respaldo no guarda los valores (ni el nombre del contacto ni los trozos del teléfono): solo huellas.
    expect(texto).not.toContain('Cliente Prueba');
    expect(texto).not.toContain('"client"');
    expect(texto.split(tel(1)).length - 1).toBe(1); // el teléfono aparece solo en el id de la conversación
    expect(mod.leerRespaldo(ruta, { entorno: 'emulador', tenant: T }).ok).toBe(true);
    expect(salida).toContain('Escritas: 5');
  });

  it('el respaldo se guarda ANTES de la primera escritura', async () => {
    const b = sembrar(3);
    const ruta = rutaRespaldo();
    let existiaAlEscribir = false;
    b.estado.antesDeCommit = () => { try { existiaAlEscribir = statSync(ruta).isFile(); } catch { existiaAlEscribir = false; } };
    expect((await correr(cfgDe({ aplicar: true, respaldo: ruta }), b)).codigo).toBe(0);
    expect(existiaAlEscribir).toBe(true);
  });

  it('lotes de a lo sumo 400: 1000 conversaciones son lotes de 400, 400 y 200', async () => {
    const b = sembrar(1000);
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo, salida).toBe(0);
    expect(b.estado.lotes).toEqual([400, 400, 200]);
    expect(b.estado.escrituras).toHaveLength(1000);
    expect(b.estado.escrituras.every((e) => e.enLote)).toBe(true);
    // Costo por 1000: 1000 lecturas del recorrido + 1 de la ficha + 1000 de la relectura; 1000 escrituras.
    expect(b.estado.lecturas).toBe(1 + 1000 + 1000);
  });

  it('un lote nunca pasa de 400 aunque se pida más (tope del script)', async () => {
    const b = sembrar(900);
    await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b, { lote: 5000 });
    expect(Math.max(...b.estado.lotes)).toBeLessThanOrEqual(400);
  });

  it('es idempotente: la segunda corrida sale 0, sin escribir y sin crear otro respaldo', async () => {
    const b = sembrar(20);
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(0);
    const escritas = b.estado.escrituras.length;
    const otra = rutaRespaldo();
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: otra }), b);
    expect(codigo).toBe(0);
    expect(b.estado.escrituras).toHaveLength(escritas);
    expect(salida).toMatch(/se tocarían \(campos que agregar\)\s*: 0\b/);
    expect(salida).toContain('nada que hacer');
    expect(() => statSync(otra)).toThrow();
  });

  it('LA PRECONDICIÓN: una conversación que cambia entre la lectura y la escritura se SALTA y se cuenta; las demás se escriben', async () => {
    const b = sembrar(6);
    let ya = false;
    b.estado.antesDeCommit = () => {
      if (ya) return;
      ya = true;
      b.tocar(rutaConv(2), { ultimoEn: 'llego-un-mensaje' }); // la ingesta escribe justo ahora
    };
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(1); // quedó una pendiente: repetir
    expect(salida).toContain('Escritas: 5');
    expect(salida).toContain('saltadas por precondición (cambiaron durante la corrida): 1');
    expect(salida).toContain('no se reintentan solas');
    expect(b.leer(rutaConv(2))).not.toHaveProperty('telefonoTrozos');
    expect(b.leer(rutaConv(2))!['ultimoEn']).toBe('llego-un-mensaje'); // lo ajeno queda intacto
    for (const n of [1, 3, 4, 5, 6]) expect(b.leer(rutaConv(n))).toHaveProperty('telefonoTrozos');
    // El lote atómico falló una vez y se probó una por una: nadie se reintentó a ciegas con otra hora.
    expect(b.estado.lotes).toEqual([]);
    expect(b.estado.escrituras).toHaveLength(5);
    expect(b.estado.escrituras.every((e) => !e.enLote)).toBe(true);
    // Repetir completa lo que faltaba (y es idempotente después).
    b.estado.antesDeCommit = null;
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(0);
    expect(b.leer(rutaConv(2))).toHaveProperty('telefonoTrozos');
  });

  it('una conversación borrada entre la lectura y la escritura también se salta (NOT_FOUND)', async () => {
    const b = sembrar(4);
    let ya = false;
    b.estado.antesDeCommit = () => { if (!ya) { ya = true; b.borrar(rutaConv(1)); } };
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(1);
    expect(salida).toContain('Escritas: 3');
    expect(b.leer(rutaConv(1))).toBeUndefined();
  });

  it('un error de un update suelto que NO es de precondición se propaga: no se cuenta como «saltada»', async () => {
    const b = sembrar(4);
    let ya = false;
    b.estado.antesDeCommit = () => { if (!ya) { ya = true; b.tocar(rutaConv(1), { ultimoEn: 'nuevo' }); } }; // fuerza el camino de uno en uno
    b.estado.fallaUpdate = (ruta) => (ruta === rutaConv(3) ? 14 : null); // UNAVAILABLE
    await expect(correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).rejects.toMatchObject({ code: 14 });
  });

  it('LA RELECTURA: una escritura que no quedó se detecta, se cuenta y la salida es 3', async () => {
    const b = sembrar(6);
    b.estado.perderEscritura = (ruta) => ruta === rutaConv(4);
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(3);
    expect(salida).toContain('Escritas: 6');
    expect(salida).toContain('relectura que no coincide: 1');
    expect(salida).toContain('La relectura no coincide');
  });

  it('un error que no es de precondición se propaga (no se traga)', async () => {
    const b = sembrar(3);
    const ruta = rutaRespaldo();
    const rota = { ...b.db, batch: () => ({ update: () => {}, commit: async () => { throw Object.assign(new Error('x'), { code: 14 }); } }) };
    await expect(mod.ejecutar(cfgDe({ aplicar: true, respaldo: ruta }), { db: rota, FieldValue: b.FieldValue, FieldPath: b.FieldPath, log: () => {} })).rejects.toMatchObject({ code: 14 });
    expect(b.estado.escrituras).toHaveLength(0);
  });

  it('un id de conversación fuera de forma no entra al plan: se cuenta como «id fuera de forma» y no se escribe', async () => {
    const b = baseEnMemoria({
      [`tenants/${T}`]: { nombre: 'Tienda Sintetica' },
      [`tenants/${T}/conversaciones/${ID(1)}`]: conv(1),
      [`tenants/${T}/conversaciones/wa_con.punto`]: conv(2),
      [`tenants/${T}/conversaciones/${'x'.repeat(101)}`]: conv(3),
    });
    const ruta = rutaRespaldo();
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(codigo, salida).toBe(0);
    expect(salida).toMatch(/id fuera de forma\)\s*: 2\b/);
    expect(salida).toMatch(/se tocarían \(campos que agregar\)\s*: 1\b/);
    expect(b.estado.escrituras.map((e) => e.ruta)).toEqual([rutaConv(1)]);
    expect(b.leer(`tenants/${T}/conversaciones/wa_con.punto`)).not.toHaveProperty('telefonoTrozos');
    // El respaldo que se guardó SÍ se puede leer de vuelta (no lleva ids inválidos).
    expect(mod.leerRespaldo(ruta, { entorno: 'emulador', tenant: T }).ok).toBe(true);
  });

  it('el respaldo recién guardado se RELEE antes de escribir: si no sirve, sale 2 y no se escribe nada en Firestore', async () => {
    const b = sembrar(5);
    const ruta = rutaRespaldo();
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b, {
      leerRespaldo: () => ({ ok: false, motivo: 'forma inválida de prueba' }),
    });
    expect(codigo).toBe(2);
    expect(salida).toContain('no sirve para revertir');
    expect(salida).toContain('OTRA ruta de --respaldo');
    expect(b.estado.escrituras).toHaveLength(0);
    expect(b.estado.lotes).toHaveLength(0);
    // El archivo sí quedó (se guardó antes de releerlo): la repetición tiene que usar otra ruta.
    expect(statSync(ruta).isFile()).toBe(true);
    // Y por omisión se relee con el lector de verdad (el camino feliz ya lo cubren las demás pruebas).
    const lecturas: string[] = [];
    const b2 = sembrar(2);
    await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b2, { leerRespaldo: (r: string, o: { tenant: string }) => { lecturas.push(o.tenant); return mod.leerRespaldo(r, { entorno: 'emulador', tenant: o.tenant }); } });
    expect(lecturas).toEqual([T]);
    expect(b2.estado.escrituras).toHaveLength(2);
  });

  it('las repeticiones piden OTRA ruta de --respaldo (la de esta corrida ya existe y no se pisa)', async () => {
    const b = sembrar(3);
    let ya = false;
    b.estado.antesDeCommit = () => { if (!ya) { ya = true; b.tocar(rutaConv(2), { ultimoEn: 'x' }); } };
    const { salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(salida).toContain('OTRA ruta de --respaldo');
  });

  it('si la corrida se corta, el mensaje dice en qué punto quedó (respaldo guardado, escribiendo, escrito)', () => {
    const m = (e: string, causa?: string) => (mod as unknown as { mensajeDeInterrupcion: (e: string, c?: string) => string }).mensajeDeInterrupcion(e, causa);
    expect(m('antes')).toContain('No se guardó respaldo ni se escribió nada');
    expect(m('respaldo')).toContain('OTRA ruta de --respaldo');
    expect(m('respaldo', 'Falló con un error')).toContain('Falló con un error');
    for (const e of ['escribiendo', 'escrito']) {
      expect(m(e)).toContain('--revertir con el mismo respaldo');
      expect(m(e)).toMatch(/[Cc]orra el seco/);
    }
  });

  it('un respaldo ya existente en la ruta no se pisa y no se escribe nada', async () => {
    const ruta = rutaRespaldo();
    writeFileSync(ruta, 'no-tocar', { mode: 0o600 });
    const b = sembrar(3);
    const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(codigo).toBe(2);
    expect(b.estado.escrituras).toHaveLength(0);
    expect(readFileSync(ruta, 'utf8')).toBe('no-tocar');
  });

  it('solo toca el --tenant dado: ninguna ruta fuera de tenants/{t} y su subcolección de conversaciones', async () => {
    const b = sembrar(3);
    const otro = baseEnMemoria({ [`tenants/otro-comercio`]: { nombre: 'Otro' }, [`tenants/otro-comercio/conversaciones/${ID(1)}`]: conv(1) });
    await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(b.estado.escrituras.every((e) => e.ruta.startsWith(`tenants/${T}/conversaciones/`))).toBe(true);
    expect(otro.estado.escrituras).toHaveLength(0);
  });

  it('los mensajes no se tocan: ninguna lectura ni escritura fuera de la ficha y las conversaciones', async () => {
    const b = sembrar(3);
    const rutasLeidas: string[] = [];
    const dbEspia = {
      ...b.db,
      doc: (r: string) => { rutasLeidas.push(r); return b.db.doc(r); },
      collection: (r: string) => { rutasLeidas.push(r); return b.db.collection(r); },
    };
    await mod.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), { db: dbEspia, FieldValue: b.FieldValue, FieldPath: b.FieldPath, log: () => {} });
    expect(rutasLeidas.length).toBeGreaterThan(0);
    expect(rutasLeidas.every((r) => r === `tenants/${T}` || r === `tenants/${T}/conversaciones` || r.startsWith(`tenants/${T}/conversaciones/wa_`))).toBe(true);
    expect(rutasLeidas.some((r) => r.includes('mensajes'))).toBe(false);
  });

  it('la salida con --aplicar no imprime el proyecto ni teléfonos', async () => {
    const b = sembrar(4);
    const { salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo(), proyecto: 'proyecto-ficticio-prod', entorno: 'produccion' }), b);
    expect(salida).not.toContain('proyecto-ficticio-prod');
    expect(salida).toContain('produccion · tenant');
    expect(salida).not.toMatch(/[0-9]{8,}/);
  });
});

// =====================================================================================================
describe('R5. Bellido y la ficha', () => {
  it('ejecutar se niega con el id de Bellido aunque lo llamen sin pasar por los argumentos, sin leer nada', async () => {
    const b = baseEnMemoria({ 'tenants/bellido': { nombre: 'Dr. B.' }, [`tenants/bellido/conversaciones/${ID(1)}`]: conv(1) });
    const { codigo, salida } = await correr(cfgDe({ tenant: 'bellido', aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(2);
    expect(salida).toContain('EXCLUIDO');
    expect(b.estado.lecturas).toBe(0);
    expect(b.estado.escrituras).toHaveLength(0);
    expect(b.leer(`tenants/bellido/conversaciones/${ID(1)}`)).not.toHaveProperty('telefonoTrozos');
  });

  it('segunda barrera: si el NOMBRE de la ficha nombra a Bellido, se niega aunque el id sea otro', async () => {
    const b = sembrar(3, () => ({}), { nombre: 'Consultorio del Dr. Béllido', estado: 'activo' });
    const { codigo, salida } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(2);
    expect(salida).toContain('EXCLUIDO');
    expect(b.estado.consultas).toHaveLength(0);
    expect(b.estado.escrituras).toHaveLength(0);
  });

  it('revertir tampoco corre con Bellido', async () => {
    const b = sembrar(3, () => ({}), { nombre: 'bellido consultorio' });
    const { codigo } = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(2);
    expect(b.estado.escrituras).toHaveLength(0);
  });

  it('por línea de comandos: el proceso sale 2 antes de abrir Firebase (Bellido, sin comercio, y un proyecto real con emulador heredado)', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROY, '--tenant', 'bellido', '--aplicar', '--respaldo', rutaRespaldo()], {
      env: entornoDelEmulador(HOST), encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('EXCLUIDO');
    expect(r.stdout).toBe('');
    const sinTenant = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROY], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
    expect(sinTenant.status).toBe(2);
    const prodSinConfirmo = spawnSync(process.execPath, [SCRIPT, '--proyecto', 'proyecto-ficticio-prod', '--tenant', T, '--aplicar', '--respaldo', rutaRespaldo()], {
      env: entornoDelEmulador(undefined, ENV_REAL), encoding: 'utf8',
    });
    // OJO: el hijo hereda las variables del emulador (`entornoDelEmulador` las fija siempre), así que lo que lo corta es
    // «hay variables de emulador», NO la falta de --confirmo-produccion. Esa rama la cubren las pruebas puras de R1
    // («producción: --aplicar sin --confirmo-produccion…») con un entorno sin emulador.
    expect(prodSinConfirmo.status).toBe(2);
    expect(prodSinConfirmo.stderr).toContain('hay variables de emulador');
    expect(prodSinConfirmo.stderr).not.toContain('proyecto-ficticio-prod');
  });
});

// =====================================================================================================
describe('R6. revertir', () => {
  const aplicada = async (cantidad = 6) => {
    const b = sembrar(cantidad);
    const ruta = rutaRespaldo();
    expect((await correr(cfgDe({ aplicar: true, respaldo: ruta }), b)).codigo).toBe(0);
    return { b, ruta };
  };
  const rev = (ruta: string, extra: Cfg = {}) => cfgDe({ revertir: true, respaldo: ruta, ...extra });

  it('el seco no escribe y dice cuántas revertiría; --aplicar borra solo los dos campos y deja lo demás igual', async () => {
    const { b, ruta } = await aplicada();
    const antes = b.estado.escrituras.length;
    const seco = await correr(rev(ruta), b);
    expect(seco.codigo).toBe(1);
    expect(seco.salida).toContain('se les borrarían campos (siguen igual): 6');
    // Avisa lo que de verdad pasa: se borra aunque la ingesta lo haya reescrito IDÉNTICO.
    expect(seco.salida).toContain('aunque la ingesta lo haya reescrito IDÉNTICO');
    expect(seco.salida).toContain('queda sin buscador por teléfono');
    expect(b.estado.escrituras).toHaveLength(antes);
    const real = await correr(rev(ruta, { aplicar: true }), b);
    expect(real.codigo, real.salida).toBe(0);
    for (let n = 1; n <= 6; n++) expect(b.leer(rutaConv(n))).toEqual(conv(n));
    expect(real.salida).toContain('Revertidas: 6');
  });

  it('es idempotente: la segunda reversión sale 0 sin escribir', async () => {
    const { b, ruta } = await aplicada();
    await correr(rev(ruta, { aplicar: true }), b);
    const n = b.estado.escrituras.length;
    const otra = await correr(rev(ruta, { aplicar: true }), b);
    expect(otra.codigo).toBe(0);
    expect(b.estado.escrituras).toHaveLength(n);
    expect(otra.salida).toContain('Nada que revertir');
  });

  it('NO pisa lo cambiado después: un campo con otro valor se conserva; el resto se borra', async () => {
    const { b, ruta } = await aplicada();
    b.tocar(rutaConv(1), { nombrePalabras: ['cambio-de-la-ingesta'] }); // la ingesta lo reescribió
    b.tocar(rutaConv(2), { telefonoTrozos: ['otro'] });
    b.tocar(rutaConv(3), { etiquetas: ['vip'] }); // una persona editó otro campo: no afecta
    const r = await correr(rev(ruta, { aplicar: true }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('campos que cambiaron después (se conservan): 2');
    expect(b.leer(rutaConv(1))).toEqual(expect.objectContaining({ nombrePalabras: ['cambio-de-la-ingesta'] }));
    expect(b.leer(rutaConv(1))).not.toHaveProperty('telefonoTrozos');
    expect(b.leer(rutaConv(2))).toEqual(expect.objectContaining({ telefonoTrozos: ['otro'] }));
    expect(b.leer(rutaConv(2))).not.toHaveProperty('nombrePalabras');
    expect(b.leer(rutaConv(3))).toEqual(conv(3, { etiquetas: ['vip'] }));
    for (const n of [4, 5, 6]) expect(b.leer(rutaConv(n))).toEqual(conv(n));
  });

  it('la relectura de la reversión: un campo que no se borró se detecta y la salida es 3', async () => {
    const { b, ruta } = await aplicada(4);
    b.estado.perderEscritura = (r) => r === rutaConv(2);
    const r = await correr(rev(ruta, { aplicar: true }), b);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('relectura que no coincide: 1');
  });

  it('una conversación que cambió durante la reversión se salta y se cuenta', async () => {
    const { b, ruta } = await aplicada();
    let ya = false;
    b.estado.antesDeCommit = () => { if (!ya) { ya = true; b.tocar(rutaConv(4), { ultimoEn: 'nuevo' }); } };
    const r = await correr(rev(ruta, { aplicar: true }), b);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('saltadas por precondición: 1');
    expect(b.leer(rutaConv(4))).toHaveProperty('telefonoTrozos');
  });

  it('una conversación que ya no existe se cuenta y no rompe', async () => {
    const { b, ruta } = await aplicada(3);
    const b2 = sembrar(2); // sin las conversaciones 3: se revierte contra una base distinta
    const r = await correr(rev(ruta), b2);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('conversaciones que ya no existen      : 1');
    expect(b.estado.escrituras.length).toBeGreaterThan(0);
  });

  it('un respaldo de otro comercio, de otro entorno, alterado o sin 0600 se rechaza', async () => {
    const { b, ruta } = await aplicada(2);
    expect(mod.leerRespaldo(ruta, { entorno: 'emulador', tenant: 'otro-comercio' }).motivo).toContain('otro comercio');
    expect(mod.leerRespaldo(ruta, { entorno: 'produccion', tenant: T }).motivo).toContain('otro entorno');
    const malo = rutaRespaldo();
    const base = JSON.parse(readFileSync(ruta, 'utf8'));
    const escribir = (o: unknown) => { const r = join(nuevoDir(), 'm.json'); writeFileSync(r, JSON.stringify(o), { mode: 0o600 }); return r; };
    for (const alterado of [
      { ...base, items: [{ ...base.items[0], camposAgregados: ['ultimoEntranteEn'] }] },
      { ...base, items: [{ ...base.items[0], conversacionId: '../otra' }] },
      { ...base, items: [{ ...base.items[0], huellas: {} }] },
      { ...base, items: [base.items[0], base.items[0]] },
      { ...base, items: [{ ...base.items[0], camposAgregados: [] }] },
      { ...base, tipo: 'otra-cosa' },
      { ...base, items: 'no-es-lista' },
    ]) {
      expect(mod.leerRespaldo(escribir(alterado), { entorno: 'emulador', tenant: T }).ok, JSON.stringify(alterado).slice(0, 80)).toBe(false);
    }
    writeFileSync(malo, JSON.stringify(base), { mode: 0o600 });
    chmodSync(malo, 0o644);
    expect(mod.leerRespaldo(malo, { entorno: 'emulador', tenant: T }).motivo).toContain('0600');
    expect((await correr(rev(ruta, { tenant: 'otro-comercio' }), b)).codigo).toBe(1); // ficha ausente en esa base
  });

  it('nunca borra un campo que el respaldo no declara aunque la conversación lo tenga', async () => {
    const { b, ruta } = await aplicada(2);
    b.tocar(rutaConv(1), { noLeidos: 4, sinLeer: true, ultimoEntranteEn: 'x', ventanaVenceEn: 'y' });
    await correr(rev(ruta, { aplicar: true }), b);
    const d = b.leer(rutaConv(1))!;
    expect(d).toMatchObject({ noLeidos: 4, sinLeer: true, ultimoEntranteEn: 'x', ventanaVenceEn: 'y' });
  });
});

// =====================================================================================================
describe('R7. el texto del script', () => {
  const f = sinComentarios(readFileSync(SCRIPT, 'utf8'));
  it('su escritura es `update` (lote o suelto) detrás de la guarda de campos, con precondición', () => {
    expect(f.match(/\b(?:batch|ref)\.update\(/g)).toHaveLength(2);
    expect(f).toContain('batch.update(it.ref, soloCamposDerivados(it.datos), { lastUpdateTime: it.updateTime });');
    expect(f).toContain('await it.ref.update(soloCamposDerivados(it.datos), { lastUpdateTime: it.updateTime });');
    expect(f).toContain("export const CAMPOS_DERIVADOS = Object.freeze(['telefonoTrozos', 'nombrePalabras']);");
    expect(f.replace(/FieldValue\.delete\(\)/g, '')).not.toMatch(/(?:ref|batch|db)\.(?:set|create|delete|add)\(/);
    expect(f).not.toMatch(/runTransaction|bulkWriter/i);
  });
  it('no toca mensajes ni deriva ventana ni no leídos', () => {
    expect(f).not.toMatch(/ultimoEntranteEn|ventanaVenceEn|noLeidos|sinLeer/);
    expect(f.match(/collection\(`[^`]*`\)/g)).toEqual(['collection(`tenants/${tenant}/conversaciones`)']);
    expect(f).not.toMatch(/collectionGroup/);
    expect(f).not.toMatch(/['"`/]mensajes['"`/]/);
  });
  it('importa la normalización de Core (no la copia) y no trae sus propias reglas de palabras', () => {
    expect(f).toContain("functions/src/core/conversacion/normalizacion.ts");
    expect(f).not.toMatch(/normalize\(|toLowerCase\(\)/);
    expect(f).not.toMatch(/\.(slice|substring)\([^)]*\)[^;]*trozo/i);
  });
  it('no imprime el proyecto ni teléfonos', () => {
    expect(f).not.toMatch(/console\.(log|error)\([^)]*proyecto\b(?!s)/);
    expect(f).not.toMatch(/log\([^)]*\b(telefono|nombreContacto)\b/);
  });
  it('el límite de lote y de página son los del contrato', () => {
    expect(f).toContain('export const TAMANO_PAGINA = 300;');
    expect(f).toContain('export const TAMANO_LOTE = 400;');
    expect(f).toContain('Math.min(deps.lote ?? TAMANO_LOTE, TAMANO_LOTE)');
  });
  it('el encabezado declara: sin pastilla de ventana y leídas; la copia derivarDe y su prueba de paridad; bandera 24 h después de H1-6; el revertir idéntico', () => {
    const crudo = readFileSync(SCRIPT, 'utf8');
    expect(crudo).toMatch(/SIN pastilla de\s+\*\s+ventana y como LEÍDAS/);
    expect(crudo).toMatch(/AL MENOS 24 h DESPUÉS de desplegar la ingesta con H1 \(H1-6\)/);
    expect(crudo).toContain('POR QUÉ `derivarDe` ES UNA COPIA');
    expect(crudo).toContain("`./normalizacion.js`");
    expect(crudo).toContain('FALLA si cambian en uno y no en el otro');
    expect(crudo).toMatch(/IDÉNTICO, el campo se borra igual/);
    expect(crudo).toContain('<copia principal>/CLIENTES/QTACO/respaldos-h1/<script>-<fecha>.json');
    expect(crudo).toContain('SIN otras sesiones escribiendo en esa carpeta');
    expect(crudo).toContain('COPIA PRINCIPAL del proyecto');
    expect(crudo).toContain('vuelve a comprobar que la ruta real');
  });
  it('declara la limitación de los mensajes antiguos en el encabezado y en la salida', () => {
    const crudo = readFileSync(SCRIPT, 'utf8');
    expect(crudo).toMatch(/LIMITACIÓN: los mensajes antiguos quedan sin `palabras`/);
    expect(f).toContain('LIMITACIÓN: los mensajes antiguos no se rellenan');
  });
});
