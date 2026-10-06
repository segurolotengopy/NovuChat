/**
 * `scripts/plataforma/aplicar-modulos-tenant.mjs` — ESCRIBE `tenants/{id}.modulos` DE UN COMERCIO,
 * seco por omisión, con respaldo, vuelta atrás y salvaguarda de proyecto.
 *
 * Todo contra el emulador (proyecto `demo-*`) o sin Firestore: ninguna conexión a la nube real ni
 * un dato real. Las fichas son sintéticas. El caso que motiva el script es Q'Taco: `flujos: ['venta']`
 * sin `modulos`, que pasa a `productos, campanas, cobros, pedidos, catalogo-web` (sin `inventario`).
 *
 *   A. Puro: validación de argumentos (negando todo), salvaguarda de proyecto, evaluación del caso
 *      Q'Taco, ruta y permisos del respaldo.
 *   B. El script como proceso contra el emulador: seco, aplicar, el freno, revertir, permisos.
 *   C. La precondición: la ficha cambia entre la lectura y la escritura y no se escribe.
 *   D. El texto del script: la única escritura a Firestore es `modulos`; el respaldo sin «comprobar y luego abrir».
 *
 * POR QUÉ ESTE SCRIPT ESCRIBE FUERA DEL REPOSITORIO, A PEDIDO. El respaldo es un archivo local con la lista de
 * módulos previa de un comercio real: no es código ni documentación, y un repositorio público no es su lugar.
 * Por eso la ruta la da quien corre el script (`--respaldo`), tiene que quedar en una carpeta del usuario con
 * permisos 0700, fuera de este repositorio y de cualquier otro, y el script no trae ninguna ruta por omisión ni
 * una variable de entorno que la fije. Las pruebas escriben solo en carpetas temporales propias (`mkdtemp`), que
 * se borran al terminar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { IDS_MODULOS } from '../../functions/src/registro.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const REPO = join(ADMIN, '..');
const SCRIPT = join(ADMIN, 'scripts', 'plataforma', 'aplicar-modulos-tenant.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

type Evaluacion = {
  actual: string[]; despues: string[]; cambian: string[];
  diferencias: { chequeo: string }[]; propias: { chequeo: string }[]; yaEscrita: boolean;
};
const mod = await import('../../scripts/plataforma/aplicar-modulos-tenant.mjs') as unknown as {
  validarListaDeModulos: (t: unknown, n: string, o: { exigirComunes: boolean }) => { ok: boolean; lista?: string[]; problemas?: string[] };
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: { raiz?: string }) =>
    { ok: boolean; problemas?: string[]; cfg?: Record<string, unknown> };
  comprobarProyecto: (p: unknown, env?: Record<string, string>) => { ok: boolean; entorno?: string; motivo?: string };
  comprobarRespaldo: (r: unknown, o?: { raiz?: string; lectura?: boolean; permitirExistente?: boolean }) => { ok: boolean; motivo?: string };
  modulosValidos: (v: unknown) => boolean;
  mismoConjunto: (a: unknown, b: unknown) => boolean;
  guardarRespaldo: (ruta: string, contenido: unknown) => void;
  leerRespaldo: (ruta: string, o: { entorno: string; tenant: string }) => { ok: boolean; motivo?: string; respaldo?: Record<string, unknown> };
  mensajeDeInterrupcion: (estado: string) => string;
  evaluar: (ficha: unknown, destino: string[]) => Evaluacion;
  permitirAplicar: (e: Evaluacion, acepto: string[]) => { ok: boolean; motivo?: string };
  ejecutar: (cfg: Record<string, unknown>, deps: Record<string, unknown>) => Promise<number>;
};
const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'aplicar-modulos') ?? initializeApp({ projectId: PROYECTO }, 'aplicar-modulos');
const db = getFirestore(app);

const LISTA_QTACO = 'productos,campanas,cobros,pedidos,catalogo-web';
const QTACO = ['productos', 'campanas', 'cobros', 'pedidos', 'catalogo-web'];
const FICHA_VENTA = { nombre: 'dato-del-comercio-que-no-debe-salir', estado: 'activo', plan: 'impulso', vertical: 'venta', flujos: ['venta'] };

// Un entorno sin NADA de emulador ni de nube, para la salvaguarda pura. Los ids son inventados.
const STAGING = 'proyecto-ficticio-staging';
const PROD = 'proyecto-ficticio-prod';
const ENV_REAL = { GCP_PROJECT_ID_STAGING: STAGING, GCP_PROJECT_ID_PROD: PROD };
const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };

const dirs: string[] = [];
const nuevoDir = () => { const h = mkdtempSync(join(tmpdir(), 'apl-mod-dir-')); dirs.push(h); return h; };
afterAll(() => { for (const h of dirs) rmSync(h, { recursive: true, force: true }); });

// ===========================================================================
describe('A. validación de argumentos y evaluación (puras)', () => {
  const base = ['--proyecto', PROYECTO, '--tenant', 'qtaco', '--modulos', LISTA_QTACO];
  const analizar = (argv: string[], env: Record<string, string> = ENV_EMU, op: { raiz?: string } = {}) =>
    mod.analizarArgumentos(argv, env, op);
  const problemasDe = (argv: string[], env?: Record<string, string>, op?: { raiz?: string }) => {
    const r = analizar(argv, env, op);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación completa del caso Q\'Taco es válida y queda en seco', () => {
    const r = analizar(base);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: 'qtaco', modulos: QTACO, acepto: [], aplicar: false, revertir: false, entorno: 'emulador' });
  });

  it('--modulos: rechaza desconocidos, vacíos, duplicados y __proto__/constructor', () => {
    const con = (m: string) => problemasDe(['--proyecto', PROYECTO, '--tenant', 'qtaco', '--modulos', m]);
    expect(con('productos,campanas,inventarios')).toContain('módulo desconocido');
    expect(con('productos,campanas,')).toContain('elemento vacío');
    expect(con('productos,,campanas')).toContain('elemento vacío');
    expect(con('productos,campanas,productos')).toContain('módulo repetido');
    expect(con('productos,campanas,__proto__')).toContain('módulo desconocido');
    expect(con('productos,campanas,constructor')).toContain('módulo desconocido');
    expect(con('productos,campanas,toString')).toContain('módulo desconocido');
    expect(con('Productos,campanas')).toContain('módulo desconocido');
    expect(con('productos, campanas')).toContain('módulo desconocido');
    expect(problemasDe(['--proyecto', PROYECTO, '--tenant', 'qtaco', '--modulos', ''])).toContain('vacío');
    expect(problemasDe(['--proyecto', PROYECTO, '--tenant', 'qtaco'])).toContain('falta --modulos');
  });

  it('--modulos: una lista sin los dos módulos comunes se rechaza, con el motivo', () => {
    const sinProductos = problemasDe(['--proyecto', PROYECTO, '--tenant', 'qtaco', '--modulos', 'campanas,cobros,pedidos']);
    expect(sinProductos).toContain('«productos»');
    expect(sinProductos).toContain('manda la lista');
    expect(sinProductos).toContain('el catálogo');
    const sinCampanas = problemasDe(['--proyecto', PROYECTO, '--tenant', 'qtaco', '--modulos', 'productos,cobros']);
    expect(sinCampanas).toContain('«campanas»');
    expect(sinCampanas).toContain('las campañas dejan de escribirse');
    const ninguno = problemasDe(['--proyecto', PROYECTO, '--tenant', 'qtaco', '--modulos', 'agenda']);
    expect(ninguno).toContain('«productos»');
    expect(ninguno).toContain('«campanas»');
  });

  it('todos los módulos del registro son válidos en la lista (y el orden dado se respeta)', () => {
    const r = mod.validarListaDeModulos([...IDS_MODULOS].reverse().join(','), '--modulos', { exigirComunes: true });
    expect(r.ok).toBe(true);
    expect(r.lista).toEqual([...IDS_MODULOS].reverse());
  });

  it('--tenant: UN solo comercio por corrida; sin comas, mayúsculas ni formas raras', () => {
    const con = (t: string) => problemasDe(['--proyecto', PROYECTO, '--tenant', t, '--modulos', LISTA_QTACO]);
    expect(con('qtaco,otro')).toContain('UN solo comercio');
    expect(con('qtaco,')).toContain('UN solo comercio');
    expect(con('QTaco')).toContain('--tenant inválido');
    expect(con('ab')).toContain('--tenant inválido');
    expect(con('q taco')).toContain('--tenant inválido');
    expect(con('../otro')).toContain('--tenant inválido');
    expect(problemasDe(['--proyecto', PROYECTO, '--modulos', LISTA_QTACO])).toContain('falta --tenant');
  });

  it('opciones desconocidas, repetidas, sin valor o sueltas se rechazan, y no devuelven el valor de una opción desconocida', () => {
    expect(problemasDe([...base, '--forzar'])).toContain('opción desconocida: --forzar');
    expect(problemasDe([...base, '--tenant', 'otro'])).toContain('opción repetida: --tenant');
    expect(problemasDe([...base, '--aplicar', '--aplicar'])).toContain('opción repetida: --aplicar');
    expect(problemasDe(['--proyecto', '--tenant', 'qtaco', '--modulos', LISTA_QTACO])).toContain('--proyecto sin valor');
    expect(problemasDe([...base, 'suelto'])).toContain('argumento suelto');
    const secreto = problemasDe([...base, `--proyecto-extra=${STAGING}`]);
    expect(secreto).toContain('opción desconocida: --proyecto-extra');
    expect(secreto).not.toContain(STAGING);
  });

  it('--acepto-diferencias: valida contra el registro como --modulos, sin exigir los comunes', () => {
    expect(analizar([...base, '--acepto-diferencias', 'inventario']).cfg).toMatchObject({ acepto: ['inventario'] });
    expect(problemasDe([...base, '--acepto-diferencias', 'inventarios'])).toContain('módulo desconocido');
    expect(problemasDe([...base, '--acepto-diferencias', 'inventario,inventario'])).toContain('módulo repetido');
    expect(problemasDe([...base, '--acepto-diferencias', '__proto__'])).toContain('módulo desconocido');
    expect(problemasDe([...base, '--acepto-diferencias', ''])).toContain('vacío');
  });

  it('--aplicar exige --respaldo (por omisión no hay respaldo)', () => {
    expect(problemasDe([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
  });

  it('--revertir exige --respaldo, no admite --modulos y valida --acepto-diferencias como la ida', () => {
    const rev = ['--revertir', '--tenant', 'qtaco', '--proyecto', PROYECTO];
    expect(problemasDe(rev)).toContain('--revertir exige --respaldo');
    const dir = nuevoDir();
    const resp = join(dir, 'x.json');
    writeFileSync(resp, '{}', { mode: 0o600 });
    expect(problemasDe([...rev, '--respaldo', resp, '--modulos', LISTA_QTACO], ENV_EMU)).toContain('--revertir no admite --modulos');
    expect(analizar([...rev, '--respaldo', resp, '--acepto-diferencias', 'inventario'], ENV_EMU).cfg).toMatchObject({ revertir: true, acepto: ['inventario'] });
    expect(problemasDe([...rev, '--respaldo', resp, '--acepto-diferencias', 'inventarios'], ENV_EMU)).toContain('módulo desconocido');
    expect(problemasDe([...rev, '--respaldo', resp, '--acepto-diferencias', '__proto__'], ENV_EMU)).toContain('módulo desconocido');
    expect(problemasDe([...rev, '--respaldo', resp, '--acepto-diferencias', 'inventario,inventario'], ENV_EMU)).toContain('módulo repetido');
  });

  // ------------------------------------------------------------ salvaguarda
  describe('salvaguarda de proyecto', () => {
    const cp = (p: unknown, env: Record<string, string>) => mod.comprobarProyecto(p, env);

    it('acepta exactamente staging y producción, y devuelve la ETIQUETA, nunca el id', () => {
      expect(cp(STAGING, ENV_REAL)).toEqual({ ok: true, entorno: 'staging' });
      expect(cp(PROD, ENV_REAL)).toEqual({ ok: true, entorno: 'produccion' });
      expect(cp(PROYECTO, ENV_EMU)).toEqual({ ok: true, entorno: 'emulador' });
    });

    it('rechaza un proyecto que no es de la lista blanca, vacío, con espacios o con mayúsculas', () => {
      expect(cp('otro-proyecto-ficticio', ENV_REAL).ok).toBe(false);
      expect(cp('', ENV_REAL).ok).toBe(false);
      expect(cp(undefined, ENV_REAL).ok).toBe(false);
      expect(cp(` ${STAGING}`, ENV_REAL).ok).toBe(false);
      expect(cp(`${STAGING}\n`, ENV_REAL).ok).toBe(false);
      expect(cp(STAGING.toUpperCase(), ENV_REAL).ok).toBe(false);
      expect(cp(`${PROD} `, ENV_REAL).ok).toBe(false);
      expect(cp(`${PROD}x`, ENV_REAL).ok).toBe(false);
    });

    it('rechaza si falta una de las dos variables, si están vacías, mal formadas o iguales', () => {
      expect(cp(STAGING, { GCP_PROJECT_ID_STAGING: STAGING }).motivo).toContain('GCP_PROJECT_ID_PROD');
      expect(cp(PROD, { GCP_PROJECT_ID_PROD: PROD }).motivo).toContain('GCP_PROJECT_ID_STAGING');
      expect(cp(STAGING, { ...ENV_REAL, GCP_PROJECT_ID_PROD: '' }).ok).toBe(false);
      expect(cp(STAGING, { ...ENV_REAL, GCP_PROJECT_ID_PROD: '   ' }).ok).toBe(false);
      expect(cp(STAGING, { ...ENV_REAL, GCP_PROJECT_ID_PROD: 'PROD MAL' }).ok).toBe(false);
      expect(cp(STAGING, { GCP_PROJECT_ID_STAGING: STAGING, GCP_PROJECT_ID_PROD: STAGING }).motivo).toContain('iguales');
    });

    it('un proyecto real con CUALQUIER variable de emulador se rechaza por ambiguo (también vacía)', () => {
      for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
        for (const valor of ['127.0.0.1:8080', '']) {
          const r = cp(PROD, { ...ENV_REAL, [v]: valor });
          expect(r.ok, `${v}=${valor}`).toBe(false);
          expect(r.motivo).toContain('ambiguo');
        }
      }
    });

    it('un proyecto demo-* exige FIRESTORE_EMULATOR_HOST local, y no se acepta con la nube', () => {
      expect(cp(PROYECTO, {}).ok).toBe(false);
      expect(cp(PROYECTO, { FIRESTORE_EMULATOR_HOST: '' }).ok).toBe(false);
      expect(cp(PROYECTO, { FIRESTORE_EMULATOR_HOST: 'maquina-remota.example.com:8080' }).ok).toBe(false);
      expect(cp(PROYECTO, ENV_REAL).ok).toBe(false);
      expect(cp('demo-Mal Escrito', ENV_EMU).ok).toBe(false);
      expect(cp('demo-', ENV_EMU).ok).toBe(false);
      expect(cp('demo-novuchat', { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }).ok).toBe(true);
    });

    it('un motivo de rechazo nunca trae el id del proyecto', () => {
      for (const [p, env] of [[STAGING, {}], [STAGING, { ...ENV_REAL, FIRESTORE_EMULATOR_HOST: 'x' }], ['no-esta-en-la-lista', ENV_REAL]] as [string, Record<string, string>][]) {
        const r = cp(p, env);
        expect(r.ok).toBe(false);
        expect(r.motivo).not.toContain(p);
        expect(r.motivo).not.toContain(STAGING);
        expect(r.motivo).not.toContain(PROD);
      }
    });

    it('contra producción, --aplicar exige --confirmo-produccion igual al tenant; contra otro entorno, la bandera sobra', () => {
      const dir = nuevoDir();
      const resp = join(dir, 'r', 'respaldo.json');
      const apl = ['--proyecto', PROD, '--tenant', 'qtaco', '--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp];
      expect(problemasDe(apl, ENV_REAL)).toContain('exige --confirmo-produccion');
      expect(problemasDe([...apl, '--confirmo-produccion', 'otro'], ENV_REAL)).toContain('no coincide con --tenant');
      expect(problemasDe([...apl, '--confirmo-produccion', 'qtaco,otro'], ENV_REAL)).toContain('no coincide con --tenant');
      const bien = analizar([...apl, '--confirmo-produccion', 'qtaco'], ENV_REAL);
      expect(bien.ok, JSON.stringify(bien)).toBe(true);
      expect(bien.cfg).toMatchObject({ entorno: 'produccion', aplicar: true });
      // En seco contra producción no hace falta (y se puede pasar igual).
      expect(analizar(['--proyecto', PROD, '--tenant', 'qtaco', '--modulos', LISTA_QTACO], ENV_REAL).ok).toBe(true);
      // Contra staging o el emulador, la confirmación de producción es una señal de que se creyó otro entorno.
      expect(problemasDe(['--proyecto', STAGING, '--tenant', 'qtaco', '--modulos', LISTA_QTACO, '--confirmo-produccion', 'qtaco'], ENV_REAL)).toContain('solo se usa contra producción');
      expect(problemasDe([...base, '--confirmo-produccion', 'qtaco'])).toContain('solo se usa contra producción');
      // Staging con --aplicar no pide confirmación.
      expect(analizar(['--proyecto', STAGING, '--tenant', 'qtaco', '--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp], ENV_REAL).ok).toBe(true);
    });
  });

  // ------------------------------------------------------------ evaluación
  describe("el caso Q'Taco con ficha SINTÉTICA", () => {
    it('flujos [venta] sin modulos → la ÚNICA capacidad que cambia es inventario', () => {
      const ev = mod.evaluar(FICHA_VENTA, QTACO);
      expect(ev.cambian).toEqual(['inventario']);
      expect(ev.propias).toEqual([]);
      expect(ev.actual).toContain('inventario');
      expect(ev.despues).not.toContain('inventario');
      // Los chequeos que lo ven: los nueve módulos y las pestañas (la de Inventario). Nada más.
      expect(ev.diferencias.map((d) => d.chequeo)).toEqual(['1 tieneModulo', '6a pestañas (conjunto)']);
      expect(mod.permitirAplicar(ev, ['inventario'])).toEqual({ ok: true });
    });

    it('sin declarar inventario (o declarando otra cosa) no se puede aplicar', () => {
      const ev = mod.evaluar(FICHA_VENTA, QTACO);
      const sin = mod.permitirAplicar(ev, []);
      expect(sin.ok).toBe(false);
      expect(sin.motivo).toContain('inventario');
      expect(mod.permitirAplicar(ev, ['campanas']).ok).toBe(false);
      expect(mod.permitirAplicar(ev, ['inventario', 'campanas']).ok).toBe(false);
    });

    it('otra capacidad perdida sin aceptar frena: quitar también pedidos', () => {
      const ev = mod.evaluar(FICHA_VENTA, ['productos', 'campanas', 'cobros', 'catalogo-web']);
      expect(ev.cambian).toEqual(['inventario', 'pedidos']);
      const r = mod.permitirAplicar(ev, ['inventario']);
      expect(r.ok).toBe(false);
      expect(r.motivo).toContain('inventario, pedidos');
      expect(mod.permitirAplicar(ev, ['pedidos', 'inventario']).ok).toBe(true);
    });

    it('agregar una capacidad también es un cambio que hay que declarar', () => {
      const ev = mod.evaluar(FICHA_VENTA, [...QTACO, 'inventario', 'agenda']);
      expect(ev.cambian).toEqual(['agenda']);
      expect(mod.permitirAplicar(ev, []).ok).toBe(false);
      expect(mod.permitirAplicar(ev, ['agenda']).ok).toBe(true);
    });

    it('la lista de la ficha sin inventario no cambia nada respecto de sí misma (ya escrita)', () => {
      const ya = { ...FICHA_VENTA, modulos: QTACO };
      const ev = mod.evaluar(ya, QTACO);
      expect(ev.yaEscrita).toBe(true);
      expect(ev.cambian).toEqual([]);
      expect(mod.permitirAplicar(ev, []).ok).toBe(true);
    });

    it('una ficha que ya difiere por sí sola (flujos que no es lista) no se aplica aunque los módulos coincidan', () => {
      const ev = mod.evaluar({ vertical: 'agendamiento', flujos: null }, ['productos', 'campanas']);
      expect(ev.propias.length).toBeGreaterThan(0);
      const r = mod.permitirAplicar(ev, ev.cambian);
      expect(r.ok).toBe(false);
      expect(r.motivo).toContain('difiere por sí sola');
    });
  });

  // ------------------------------------------------------------ respaldo
  describe('ruta y permisos del respaldo', () => {
    const cr = (ruta: unknown, op: { raiz?: string; lectura?: boolean } = {}) => mod.comprobarRespaldo(ruta, op);

    it('rechaza rutas relativas, no normalizadas y vacías', () => {
      const dir = nuevoDir();
      expect(cr('respaldo.json').motivo).toContain('absoluta');
      expect(cr(`${dir}/a/../b.json`).motivo).toContain('absoluta');
      expect(cr(`${dir}//b.json`).motivo).toContain('absoluta');
      expect(cr(`${dir}/b/`).motivo).toContain('absoluta');
      expect(cr('').ok).toBe(false);
      expect(cr(undefined).ok).toBe(false);
    });

    // Una carpeta que no es del usuario (la raíz, /usr, /tmp) no sirve, existente o por crear. Como root todo es «del usuario».
    it.skipIf(process.getuid?.() === 0)('rechaza una carpeta que no es del usuario: la raíz, /usr y /tmp', () => {
      expect(cr('/respaldo-que-no-debe-existir/b.json').motivo).toContain('carpeta del usuario');
      expect(cr('/usr/respaldo-que-no-debe-existir/b.json').motivo).toContain('carpeta del usuario');
      expect(cr('/tmp/respaldo-que-no-debe-existir/b.json').motivo).toContain('carpeta del usuario');
      expect(cr('/usr/b.json').motivo).toContain('no es del usuario');
      expect(cr(nuevoDir()).ok).toBe(false); // la carpeta de /tmp que lo contiene no es del usuario
    });

    it('rechaza una ruta dentro del repositorio y dentro de cualquier repositorio git', () => {
      const dir = nuevoDir();
      mkdirSync(join(dir, 'repo', 'sub'), { recursive: true });
      expect(cr(join(dir, 'repo', 'sub', 'r.json'), { raiz: join(dir, 'repo') }).motivo).toContain('dentro del repositorio');
      expect(cr(join(dir, 'repo', 'r.json'), { raiz: join(dir, 'repo') }).motivo).toContain('dentro del repositorio');
      mkdirSync(join(dir, 'otro', '.git'), { recursive: true });
      mkdirSync(join(dir, 'otro', 'dentro'), { recursive: true });
      expect(cr(join(dir, 'otro', 'dentro', 'r.json'), { raiz: join(dir, 'repo') }).motivo).toContain('repositorio git');
      // Y un enlace simbólico que entra al repositorio no lo esconde.
      symlinkSync(join(dir, 'repo'), join(dir, 'atajo'));
      expect(cr(join(dir, 'atajo', 'r.json'), { raiz: join(dir, 'repo') }).motivo).toContain('dentro del repositorio');
      // El repositorio REAL de esta suite también.
      expect(cr(join(REPO, 'admin', 'respaldo.json'), {}).motivo).toContain('dentro del repositorio');
    });

    it('rechaza una carpeta existente con permisos de grupo u otros, y acepta una 0700 o una por crear', () => {
      const dir = nuevoDir();
      mkdirSync(join(dir, 'abierta'), { mode: 0o755 }); chmodSync(join(dir, 'abierta'), 0o755);
      mkdirSync(join(dir, 'grupo'), { mode: 0o750 }); chmodSync(join(dir, 'grupo'), 0o750);
      mkdirSync(join(dir, 'privada'), { mode: 0o700 }); chmodSync(join(dir, 'privada'), 0o700);
      expect(cr(join(dir, 'abierta', 'r.json')).motivo).toContain('permisos de grupo u otros');
      expect(cr(join(dir, 'grupo', 'r.json')).motivo).toContain('permisos de grupo u otros');
      expect(cr(join(dir, 'privada', 'r.json')).ok).toBe(true);
      expect(cr(join(dir, 'nueva', 'honda', 'r.json')).ok).toBe(true);
    });

    it('un respaldo ya existente no se pisa; para revertir tiene que existir, ser un archivo regular y 0600', () => {
      const dir = nuevoDir();
      mkdirSync(join(dir, 'p'), { mode: 0o700 }); chmodSync(join(dir, 'p'), 0o700);
      const f = join(dir, 'p', 'r.json');
      expect(cr(f, { lectura: true }).motivo).toContain('no existe');
      writeFileSync(f, '{}', { mode: 0o600 });
      expect(cr(f).motivo).toContain('nunca se pisa');
      expect(cr(f, { lectura: true }).ok).toBe(true);
      chmodSync(f, 0o644);
      expect(cr(f, { lectura: true }).motivo).toContain('permisos de grupo u otros');
      chmodSync(f, 0o640);
      expect(cr(f, { lectura: true }).motivo).toContain('permisos de grupo u otros');
      chmodSync(f, 0o600);
      symlinkSync(f, join(dir, 'p', 'enlace.json'));
      expect(cr(join(dir, 'p', 'enlace.json'), { lectura: true }).motivo).toContain('enlace simbólico');
    });

    it('al aplicar, un respaldo ya existente pasa SOLO si es regular, del usuario y 0600 (para reaplicar sin error); si no, se rechaza', () => {
      const dir = nuevoDir();
      mkdirSync(join(dir, 'p'), { mode: 0o700 }); chmodSync(join(dir, 'p'), 0o700);
      const f = join(dir, 'p', 'r.json');
      expect(cr(f, { permitirExistente: true }).ok).toBe(true); // no existe: pasa, se creará
      writeFileSync(f, '{}', { mode: 0o600 });
      expect(cr(f, { permitirExistente: true }).ok).toBe(true);
      chmodSync(f, 0o644);
      expect(cr(f, { permitirExistente: true }).motivo).toContain('permisos de grupo u otros');
      chmodSync(f, 0o600);
      symlinkSync(f, join(dir, 'p', 'enlace.json'));
      expect(cr(join(dir, 'p', 'enlace.json'), { permitirExistente: true }).motivo).toContain('enlace simbólico');
      mkdirSync(join(dir, 'p', 'carpeta'));
      expect(cr(join(dir, 'p', 'carpeta'), { permitirExistente: true }).motivo).toContain('no es un archivo regular');
    });
  });
});

// ===========================================================================
describe('A2. el respaldo: lo que se guarda, lo que se acepta al leerlo y cómo se abre (sin «comprobar y luego abrir»)', () => {
  const ESCRITO = [...QTACO];
  const respaldoBueno = (cambios: Record<string, unknown> = {}, previo: Record<string, unknown> = {}) => ({
    version: 1, entorno: 'emulador', tenant: 'qtaco', creadoEn: '2026-10-05T00:00:00.000Z', fichaActualizadaEn: null,
    previo: { modulosPresente: false, modulos: null, flujos: ['venta'], vertical: 'venta', ...previo },
    escrito: ESCRITO,
    ...cambios,
  });
  const archivo = (contenido: unknown, modo = 0o600) => {
    const dir = nuevoDir();
    const f = join(dir, 'r.json');
    writeFileSync(f, typeof contenido === 'string' ? contenido : JSON.stringify(contenido), { mode: modo });
    chmodSync(f, modo);
    return f;
  };
  const leer = (c: unknown, modo?: number) => mod.leerRespaldo(archivo(c, modo), { entorno: 'emulador', tenant: 'qtaco' });

  it('modulosValidos: solo listas del registro, sin repetidos y con productos y campanas, elemento por elemento', () => {
    expect(mod.modulosValidos(QTACO)).toBe(true);
    expect(mod.modulosValidos([...IDS_MODULOS].reverse())).toBe(true);
    for (const malo of [[], ['pedidos'], ['productos'], ['campanas', 'pedidos'], ['productos', 'campanas', 'inventarios'],
      ['productos', 'campanas', '__proto__'], ['productos', 'campanas', 'constructor'], ['productos', 'campanas', 'productos'],
      ['productos', 'campanas', 5], ['productos', 'campanas', null], 'productos,campanas', { 0: 'productos', 1: 'campanas', length: 2 },
      null, undefined, ['productos', 'campanas', ...IDS_MODULOS]]) {
      expect(mod.modulosValidos(malo), JSON.stringify(malo)).toBe(false);
    }
    // «Elemento por elemento»: un solo texto «productos,campanas» no vale como dos módulos.
    expect(mod.modulosValidos(['productos,campanas'])).toBe(false);
  });

  it('mismoConjunto: mismo contenido en cualquier orden; un repetido o un elemento de menos no se cuelan; lo que no es lista no es nada', () => {
    expect(mod.mismoConjunto(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(mod.mismoConjunto([], [])).toBe(true);
    expect(mod.mismoConjunto(['a', 'a', 'b'], ['a', 'b', 'c'])).toBe(false); // mismo tamaño y todo lo primero está en lo segundo
    expect(mod.mismoConjunto(['a', 'b', 'c'], ['a', 'a', 'b'])).toBe(false);
    expect(mod.mismoConjunto(['a'], ['a', 'b'])).toBe(false);
    expect(mod.mismoConjunto(undefined, [])).toBe(false);
    expect(mod.mismoConjunto('ab', ['a', 'b'])).toBe(false);
    expect(mod.mismoConjunto(null, null)).toBe(false);
  });

  it('leerRespaldo acepta un respaldo bueno, con `modulos` ausente o presente', () => {
    expect(leer(respaldoBueno()).ok).toBe(true);
    expect(leer(respaldoBueno({}, { modulosPresente: true, modulos: ['productos', 'campanas', 'agenda'] })).ok).toBe(true);
  });

  it('leerRespaldo rechaza un valor previo inválido ([], [pedidos], desconocido, __proto__, repetido, sin comunes, no lista)', () => {
    for (const modulos of [[], ['pedidos'], ['productos', 'campanas', 'inexistente'], ['productos', 'campanas', '__proto__'],
      ['productos', 'campanas', 'campanas'], ['productos'], 'productos,campanas', null, [1, 2]]) {
      const r = leer(respaldoBueno({}, { modulosPresente: true, modulos }));
      expect(r.ok, JSON.stringify(modulos)).toBe(false);
      expect(r.motivo).toContain('valor previo');
    }
    // Y si `modulos` no existía, el valor previo tiene que ser exactamente null.
    expect(leer(respaldoBueno({}, { modulosPresente: false, modulos: [] })).ok).toBe(false);
    expect(leer(respaldoBueno({}, { modulosPresente: false, modulos: QTACO })).ok).toBe(false);
  });

  it('leerRespaldo rechaza una lista «escrito» inválida, ausente o con módulos que no existen', () => {
    for (const escrito of [[], ['pedidos'], ['productos', 'campanas', 'inexistente'], ['productos', 'campanas', '__proto__'],
      ['productos', 'campanas', 'productos'], 'productos,campanas', null, undefined]) {
      const r = leer(respaldoBueno({ escrito }));
      expect(r.ok, JSON.stringify(escrito)).toBe(false);
      expect(r.motivo).toContain('qué lista se escribió');
    }
    // También cuando `modulos` sí existía (la validación del previo no reemplaza la de `escrito`).
    expect(leer(respaldoBueno({ escrito: ['pedidos'] }, { modulosPresente: true, modulos: ['productos', 'campanas', 'agenda'] })).ok).toBe(false);
  });

  it('leerRespaldo mira el descriptor abierto: rechaza permisos abiertos, enlaces simbólicos y archivos enormes', () => {
    expect(leer(respaldoBueno(), 0o644).motivo).toContain('permisos de grupo u otros');
    expect(leer(respaldoBueno(), 0o640).motivo).toContain('permisos de grupo u otros');
    const f = archivo(respaldoBueno());
    symlinkSync(f, join(dirname(f), 'enlace.json'));
    expect(mod.leerRespaldo(join(dirname(f), 'enlace.json'), { entorno: 'emulador', tenant: 'qtaco' }).ok).toBe(false);
    expect(mod.leerRespaldo(join(dirname(f), 'no-existe.json'), { entorno: 'emulador', tenant: 'qtaco' }).ok).toBe(false);
    expect(mod.leerRespaldo(dirname(f), { entorno: 'emulador', tenant: 'qtaco' }).ok).toBe(false);
    expect(leer('x'.repeat(70_000)).ok).toBe(false);
    expect(leer('no es json').motivo).toContain('JSON legible');
  });

  it('guardarRespaldo: carpeta nueva 0700 y archivo 0600 releído; nunca pisa un archivo ni sigue un enlace simbólico', () => {
    const dir = nuevoDir();
    const f = join(dir, 'nueva', 'honda', 'r.json');
    mod.guardarRespaldo(f, respaldoBueno());
    // Se lee por descriptor (como el script): comprobar la ruta y luego leerla por ruta es la carrera de CodeQL.
    const abrir = (r: string) => { const fd = openSync(r, 'r'); try { return { modo: fstatSync(fd).mode & 0o777, texto: readFileSync(fd, 'utf8') }; } finally { closeSync(fd); } };
    const a = abrir(f);
    expect(a.modo).toBe(0o600);
    expect(statSync(dirname(f)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(a.texto).tenant).toBe('qtaco');
    // Un archivo existente no se pisa.
    expect(() => mod.guardarRespaldo(f, respaldoBueno({ tenant: 'otro' }))).toThrowError(expect.objectContaining({ code: 'EEXIST' }));
    expect(JSON.parse(abrir(f).texto).tenant).toBe('qtaco');
    // Un enlace simbólico en la ruta (aunque apunte a algo inexistente) tampoco: no se escribe a través de él.
    const objetivo = join(dir, 'objetivo-del-enlace.json');
    symlinkSync(objetivo, join(dirname(f), 'enlace.json'));
    expect(() => mod.guardarRespaldo(join(dirname(f), 'enlace.json'), respaldoBueno())).toThrowError(expect.objectContaining({ code: 'EEXIST' }));
    expect(existsSync(objetivo)).toBe(false);
  });

  it('guardarRespaldo rechaza una carpeta existente con permisos de grupo u otros y no deja el archivo', () => {
    const dir = nuevoDir();
    mkdirSync(join(dir, 'abierta'), { mode: 0o755 }); chmodSync(join(dir, 'abierta'), 0o755);
    expect(() => mod.guardarRespaldo(join(dir, 'abierta', 'r.json'), respaldoBueno())).toThrowError(expect.objectContaining({ code: 'respaldo-carpeta' }));
    expect(existsSync(join(dir, 'abierta', 'r.json'))).toBe(false);
    // Una carpeta existente 0700 se respeta tal cual (no se le cambia el modo).
    mkdirSync(join(dir, 'privada'), { mode: 0o700 }); chmodSync(join(dir, 'privada'), 0o700);
    mod.guardarRespaldo(join(dir, 'privada', 'r.json'), respaldoBueno());
    expect(lstatSync(join(dir, 'privada', 'r.json')).mode & 0o777).toBe(0o600);
  });

  it('el mensaje del Ctrl-C distingue antes de escribir, durante la escritura y después de escribir', () => {
    const antes = mod.mensajeDeInterrupcion('antes');
    expect(antes).toContain('No se escribió nada');
    const durante = mod.mensajeDeInterrupcion('escribiendo');
    expect(durante).toContain('DURANTE la escritura');
    expect(durante).not.toContain('No se escribió nada');
    const despues = mod.mensajeDeInterrupcion('escrito');
    expect(despues).toContain('SÍ se hizo');
    expect(despues).toContain('--revertir');
    expect(despues).toContain('seco');
    expect(despues).not.toContain('No se escribió nada');
    // Un estado que no se conoce es el peor caso, nunca «no se escribió nada».
    expect(mod.mensajeDeInterrupcion('raro')).toContain('DURANTE la escritura');
    expect(mod.mensajeDeInterrupcion(undefined as unknown as string)).not.toContain('No se escribió nada');
  });
});

// ===========================================================================
describe('B. el script como proceso contra el emulador', () => {
  const T = {
    seco: 'apl-mod-seco', aplicar: 'apl-mod-aplicar', freno: 'apl-mod-freno', revertir: 'apl-mod-revertir',
    conLista: 'apl-mod-con-lista', otro: 'apl-mod-otro', ajeno: 'apl-mod-ajeno', adultera: 'apl-mod-adultera',
    reaplica: 'apl-mod-reaplica', yaescrita: 'apl-mod-ya-escrita', invalida: 'apl-mod-invalida',
  };
  const TODOS = Object.values(T);
  const SECRETO = FICHA_VENTA.nombre;

  function correr(args: string[], op: { extra?: Record<string, string> } = {}) {
    const extra: Record<string, string> = { ...(op.extra ?? {}) };
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8', env: entornoDelEmulador(HOST, extra), timeout: 60_000,
    });
    return { codigo: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }
  const args = (tenant: string, extra: string[] = []) => ['--proyecto', PROYECTO, '--tenant', tenant, ...extra];
  const tiempo = async (t: string) => (await db.doc(`tenants/${t}`).get()).updateTime?.toMillis();
  const datos = async (t: string) => (await db.doc(`tenants/${t}`).get()).data() as Record<string, unknown>;
  const modo = (r: string) => statSync(r).mode & 0o777;

  beforeAll(async () => {
    for (const t of TODOS) await db.recursiveDelete(db.doc(`tenants/${t}`));
    for (const t of [T.seco, T.aplicar, T.freno, T.revertir, T.ajeno, T.adultera, T.reaplica]) await db.doc(`tenants/${t}`).set({ ...FICHA_VENTA });
    await db.doc(`tenants/${T.yaescrita}`).set({ ...FICHA_VENTA, modulos: QTACO });
    await db.doc(`tenants/${T.invalida}`).set({ ...FICHA_VENTA, modulos: [...QTACO, 'productos'] });
    await db.doc(`tenants/${T.conLista}`).set({ nombre: SECRETO, estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], modulos: ['productos', 'campanas', 'agenda'] });
    await db.doc(`tenants/${T.otro}`).set({ ...FICHA_VENTA });
  });

  it('SECO por omisión: imprime antes y después, las capacidades que cambian, y no escribe (updateTime igual)', async () => {
    const antes = await tiempo(T.seco);
    const r = correr(args(T.seco, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario']));
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toContain('SECO');
    expect(r.salida).toContain('emulador');
    expect(r.salida).toContain('módulos de hoy');
    expect(r.salida).toContain('módulos de después');
    expect(r.salida).toContain('6a pestañas (conjunto)');
    expect(r.salida).toContain('capacidades que cambian      : inventario (se quita)');
    expect(r.salida).toContain('Con --aplicar se aceptaría');
    expect(r.salida).toContain('no se escribió nada');
    expect(r.salida).not.toContain(SECRETO);
    expect(await tiempo(T.seco)).toBe(antes);
    expect(await datos(T.seco)).toEqual(FICHA_VENTA);
  });

  it('el seco sin --acepto-diferencias dice que con --aplicar no se escribiría', async () => {
    const r = correr(args(T.seco, ['--modulos', LISTA_QTACO]));
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toContain('Con --aplicar NO se escribiría');
  });

  it('una ficha inexistente sale con 1 y no escribe', async () => {
    const r = correr(args('apl-mod-no-existe', ['--modulos', LISTA_QTACO]));
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toContain('no existe la ficha');
    expect((await db.doc('tenants/apl-mod-no-existe').get()).exists).toBe(false);
  });

  it('el freno: --aplicar sin declarar inventario, o declarando otra cosa, sale con 2 y no escribe ni crea el respaldo', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'resp', 'r.json');
    const antes = await tiempo(T.freno);
    for (const extra of [[], ['--acepto-diferencias', 'campanas'], ['--acepto-diferencias', 'inventario,campanas']]) {
      const r = correr(args(T.freno, ['--modulos', LISTA_QTACO, '--aplicar', '--respaldo', resp, ...extra]));
      expect(r.codigo, r.salida).toBe(2);
      expect(r.salida).toContain('no son exactamente las declaradas');
      expect(await tiempo(T.freno)).toBe(antes);
      expect(existsSync(resp)).toBe(false);
      expect(existsSync(dirname(resp))).toBe(false);
    }
    // Otra capacidad perdida sin aceptar (pedidos), aunque inventario sí se declare.
    const r = correr(args(T.freno, ['--modulos', 'productos,campanas,cobros,catalogo-web', '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('inventario, pedidos');
    expect(await tiempo(T.freno)).toBe(antes);
    // Una lista sin productos ni siquiera llega a leer la ficha.
    const sinComunes = correr(args(T.freno, ['--modulos', 'campanas,cobros,pedidos', '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(sinComunes.codigo, sinComunes.salida).toBe(2);
    expect(sinComunes.salida).toContain('manda la lista');
    expect(await tiempo(T.freno)).toBe(antes);
  });

  it('--aplicar: respaldo 0600 en carpeta 0700, escribe SOLO modulos, relee y no toca flujos ni vertical; luego --revertir elimina el campo', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'resp', 'qtaco-sintetico.json');
    const antes = await tiempo(T.aplicar);
    const r = correr(args(T.aplicar, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('Respaldo guardado y releído');
    expect(r.salida).toContain('Escrito y releído');
    expect(r.salida).not.toContain(SECRETO);
    // El respaldo: permisos y contenido (solo la ficha de capacidades, nada de datos del comercio).
    expect(modo(resp)).toBe(0o600);
    expect(modo(dirname(resp))).toBe(0o700);
    const resguardo = JSON.parse(readFileSync(resp, 'utf8'));
    expect(resguardo).toMatchObject({
      version: 1, entorno: 'emulador', tenant: T.aplicar,
      previo: { modulosPresente: false, modulos: null, flujos: ['venta'], vertical: 'venta' },
      escrito: QTACO,
    });
    expect(readFileSync(resp, 'utf8')).not.toContain(SECRETO);
    expect(readFileSync(resp, 'utf8')).not.toContain('impulso');
    expect(readFileSync(resp, 'utf8')).not.toContain(PROYECTO);
    // La ficha: solo cambió `modulos`.
    const d = await datos(T.aplicar);
    expect(d).toEqual({ ...FICHA_VENTA, modulos: QTACO });
    expect(await tiempo(T.aplicar)).not.toBe(antes);

    // Reaplicar el MISMO comando (mismo respaldo, que ya existe) es idempotente: 0, sin escribir ni pisar el respaldo.
    const t0 = await tiempo(T.aplicar);
    const textoResp = readFileSync(resp, 'utf8');
    const otra = correr(args(T.aplicar, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(otra.codigo, otra.salida).toBe(0);
    expect(otra.salida).toContain('ya está escrita con esa lista: nada que hacer');
    expect(await tiempo(T.aplicar)).toBe(t0);
    expect(readFileSync(resp, 'utf8')).toBe(textoResp);

    // Revertir en seco no escribe y sale con 1: queda un cambio pendiente.
    const t1 = await tiempo(T.aplicar);
    const seco = correr(args(T.aplicar, ['--revertir', '--respaldo', resp, '--acepto-diferencias', 'inventario']));
    expect(seco.codigo, seco.salida).toBe(1);
    expect(seco.salida).toContain('AUSENTE (se eliminaría el campo)');
    expect(seco.salida).toContain('capacidades que cambian      : inventario');
    expect(seco.salida).toContain('Con --aplicar se aceptaría');
    expect(await tiempo(T.aplicar)).toBe(t1);
    // Sin declarar la capacidad, el seco también sale con 1 y dice que no se escribiría.
    const secoSin = correr(args(T.aplicar, ['--revertir', '--respaldo', resp]));
    expect(secoSin.codigo, secoSin.salida).toBe(1);
    expect(secoSin.salida).toContain('Con --aplicar NO se escribiría');
    expect(await tiempo(T.aplicar)).toBe(t1);

    // Revertir de verdad: como `modulos` no existía, se ELIMINA el campo (con el freno: inventario declarado).
    const rev = correr(args(T.aplicar, ['--revertir', '--aplicar', '--respaldo', resp, '--acepto-diferencias', 'inventario']));
    expect(rev.codigo, rev.salida).toBe(0);
    expect(rev.salida).toContain('eliminado (no existía)');
    expect(await datos(T.aplicar)).toEqual(FICHA_VENTA);
    expect('modulos' in (await datos(T.aplicar))).toBe(false);

    // Y revertir otra vez no hace nada: idempotente, sale 0 aunque no se declare nada (el freno va después).
    const t2 = await tiempo(T.aplicar);
    const de_nuevo = correr(args(T.aplicar, ['--revertir', '--aplicar', '--respaldo', resp]));
    expect(de_nuevo.codigo, de_nuevo.salida).toBe(0);
    expect(de_nuevo.salida).toContain('nada que revertir');
    expect(await tiempo(T.aplicar)).toBe(t2);
    const seco2 = correr(args(T.aplicar, ['--revertir', '--respaldo', resp]));
    expect(seco2.codigo, seco2.salida).toBe(0);
  });

  it('--revertir --aplicar exige --acepto-diferencias igual a lo que cambia, como la ida: sin él, o con otro, sale con 2 y no escribe', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'r.json');
    const ok = correr(args(T.reaplica, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(ok.codigo, ok.salida).toBe(0);
    const t = await tiempo(T.reaplica);
    for (const extra of [[], ['--acepto-diferencias', 'campanas'], ['--acepto-diferencias', 'inventario,campanas']]) {
      const r = correr(args(T.reaplica, ['--revertir', '--aplicar', '--respaldo', resp, ...extra]));
      expect(r.codigo, r.salida).toBe(2);
      expect(r.salida).toContain('no son exactamente las declaradas');
      expect(await tiempo(T.reaplica)).toBe(t);
      expect((await datos(T.reaplica))['modulos']).toEqual(QTACO);
    }
    const bien = correr(args(T.reaplica, ['--revertir', '--aplicar', '--respaldo', resp, '--acepto-diferencias', 'inventario']));
    expect(bien.codigo, bien.salida).toBe(0);
    expect('modulos' in (await datos(T.reaplica))).toBe(false);
  });

  it('--revertir NO pisa un cambio posterior de otra persona: si la ficha ya no tiene lo escrito, sale con 2 y conserva el cambio', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'r.json');
    const ok = correr(args(T.ajeno, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(ok.codigo, ok.salida).toBe(0);
    // Otro proceso (otra persona) agrega `agenda` después.
    await db.doc(`tenants/${T.ajeno}`).update({ modulos: [...QTACO, 'agenda'] });
    const t = await tiempo(T.ajeno);
    for (const extra of [[], ['--aplicar'], ['--aplicar', '--acepto-diferencias', 'inventario'], ['--aplicar', '--acepto-diferencias', 'inventario,agenda']]) {
      const r = correr(args(T.ajeno, ['--revertir', '--respaldo', resp, ...extra]));
      expect(r.codigo, r.salida).toBe(2);
      expect(r.salida).toContain('alguien la cambió después');
      expect(r.salida).toContain('No se escribe nada');
      expect(await tiempo(T.ajeno)).toBe(t);
      expect((await datos(T.ajeno))['modulos']).toEqual([...QTACO, 'agenda']);
    }
    // Mismo tamaño y todo lo suyo está en lo escrito, pero con un repetido y sin `catalogo-web`: no es lo escrito.
    const conRepetido = ['productos', 'campanas', 'cobros', 'cobros', 'pedidos'];
    await db.doc(`tenants/${T.ajeno}`).update({ modulos: conRepetido });
    const rr = correr(args(T.ajeno, ['--revertir', '--aplicar', '--respaldo', resp, '--acepto-diferencias', 'inventario']));
    expect(rr.codigo, rr.salida).toBe(2);
    expect((await datos(T.ajeno))['modulos']).toEqual(conRepetido);
    // El mismo conjunto en otro orden SÍ es lo escrito (se compara como conjunto): se revierte.
    await db.doc(`tenants/${T.ajeno}`).update({ modulos: [...QTACO].reverse() });
    const rev = correr(args(T.ajeno, ['--revertir', '--aplicar', '--respaldo', resp, '--acepto-diferencias', 'inventario']));
    expect(rev.codigo, rev.salida).toBe(0);
    expect('modulos' in (await datos(T.ajeno))).toBe(false);
  });

  it('un respaldo adulterado (previo o escrito inválidos) sale con 2 y no cambia la ficha ni su updateTime', async () => {
    const dir = nuevoDir();
    const base = (previo: Record<string, unknown>, escrito: unknown = QTACO) => ({
      version: 1, entorno: 'emulador', tenant: T.adultera, creadoEn: '2026-10-05T00:00:00.000Z', fichaActualizadaEn: null,
      previo: { modulosPresente: true, flujos: ['venta'], vertical: 'venta', ...previo }, escrito,
    });
    await db.doc(`tenants/${T.adultera}`).update({ modulos: QTACO });
    const t = await tiempo(T.adultera);
    const casos: [string, unknown][] = [
      ['vacio', base({ modulos: [] })],
      ['solo-pedidos', base({ modulos: ['pedidos'] })],
      ['desconocido', base({ modulos: ['productos', 'campanas', 'no-existe'] })],
      ['proto', base({ modulos: ['productos', 'campanas', '__proto__'] })],
      ['repetido', base({ modulos: ['productos', 'campanas', 'productos'] })],
      ['escrito-vacio', base({ modulos: ['productos', 'campanas', 'agenda'] }, [])],
      ['escrito-proto', base({ modulos: ['productos', 'campanas', 'agenda'] }, ['productos', 'campanas', '__proto__'])],
      ['previo-no-existia-con-lista', base({ modulosPresente: false, modulos: ['productos', 'campanas'] })],
    ];
    for (const [nombre, contenido] of casos) {
      const f = join(dir, `${nombre}.json`);
      writeFileSync(f, JSON.stringify(contenido), { mode: 0o600 });
      for (const extra of [[], ['--aplicar', '--acepto-diferencias', 'inventario,agenda']]) {
        const r = correr(args(T.adultera, ['--revertir', '--respaldo', f, ...extra]));
        expect(r.codigo, `${nombre}: ${r.salida}`).toBe(2);
        expect(r.salida, nombre).toContain('el respaldo no');
        expect(await tiempo(T.adultera), nombre).toBe(t);
        expect((await datos(T.adultera))['modulos'], nombre).toEqual(QTACO);
      }
    }
  });

  it('reaplicar es idempotente: la lista ya escrita sale con 0 ANTES del freno, sin respaldo nuevo ni escritura', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'resp', 'r.json');
    const t = await tiempo(T.yaescrita);
    // Sin --acepto-diferencias (el freno diría 2 si llegara a mirarse) y con el seco también.
    for (const extra of [['--aplicar', '--respaldo', resp], []]) {
      const r = correr(args(T.yaescrita, ['--modulos', LISTA_QTACO, ...extra]));
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toContain('nada que hacer');
      expect(r.salida).not.toContain('no son exactamente las declaradas');
    }
    expect(existsSync(dirname(resp))).toBe(false);
    expect(await tiempo(T.yaescrita)).toBe(t);
  });

  it('aplicar no escribe encima de un `modulos` que no se podría respaldar y restaurar (repetidos, desconocidos): sale con 2 sin respaldo', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'resp', 'r.json');
    const t = await tiempo(T.invalida);
    const r = correr(args(T.invalida, ['--modulos', LISTA_QTACO, '--aplicar', '--respaldo', resp]));
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('no es una lista válida del registro');
    expect(existsSync(dirname(resp))).toBe(false);
    expect(await tiempo(T.invalida)).toBe(t);
    expect((await datos(T.invalida))['modulos']).toEqual([...QTACO, 'productos']);
  });

  it('un respaldo que ya existe se acepta como argumento, pero si habría que escribir encima sale con 2 y no escribe', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'r.json');
    writeFileSync(resp, '{"viejo":true}', { mode: 0o600 });
    const t = await tiempo(T.freno);
    const r = correr(args(T.freno, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('nunca se pisa');
    expect(readFileSync(resp, 'utf8')).toBe('{"viejo":true}');
    expect(await tiempo(T.freno)).toBe(t);
    expect('modulos' in (await datos(T.freno))).toBe(false);
    // Con permisos abiertos ni siquiera se acepta.
    chmodSync(resp, 0o644);
    const abierto = correr(args(T.freno, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(abierto.codigo, abierto.salida).toBe(2);
    expect(abierto.salida).toContain('permisos de grupo u otros');
  });

  it('revertir RESTAURA el valor previo cuando `modulos` existía', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'r.json');
    const previo = ['productos', 'campanas', 'agenda'];
    const nueva = 'productos,campanas,agenda,cobros';
    const r = correr(args(T.conLista, ['--modulos', nueva, '--acepto-diferencias', 'cobros', '--aplicar', '--respaldo', resp]));
    expect(r.codigo, r.salida).toBe(0);
    expect((await datos(T.conLista))['modulos']).toEqual(nueva.split(','));
    expect(JSON.parse(readFileSync(resp, 'utf8')).previo).toMatchObject({ modulosPresente: true, modulos: previo });
    const rev = correr(args(T.conLista, ['--revertir', '--aplicar', '--respaldo', resp, '--acepto-diferencias', 'cobros']));
    expect(rev.codigo, rev.salida).toBe(0);
    expect(rev.salida).toContain('restaurado');
    expect((await datos(T.conLista))['modulos']).toEqual(previo);
    expect((await datos(T.conLista))['flujos']).toEqual(['agendamiento']);
  });

  it('revertir rechaza un respaldo de otro comercio, ilegible o con permisos abiertos, sin escribir', async () => {
    const dir = nuevoDir();
    const resp = join(dir, 'r.json');
    const ok = correr(args(T.revertir, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', resp]));
    expect(ok.codigo, ok.salida).toBe(0);
    const antes = await tiempo(T.otro);
    const ajeno = correr(args(T.otro, ['--revertir', '--aplicar', '--respaldo', resp]));
    expect(ajeno.codigo, ajeno.salida).toBe(2);
    expect(ajeno.salida).toContain('de otro comercio');
    expect(await tiempo(T.otro)).toBe(antes);

    const t = await tiempo(T.revertir);
    chmodSync(resp, 0o644);
    const abierto = correr(args(T.revertir, ['--revertir', '--aplicar', '--respaldo', resp]));
    expect(abierto.codigo, abierto.salida).toBe(2);
    expect(abierto.salida).toContain('permisos de grupo u otros');
    chmodSync(resp, 0o600);

    writeFileSync(join(dir, 'roto.json'), 'no es json', { mode: 0o600 });
    const roto = correr(args(T.revertir, ['--revertir', '--aplicar', '--respaldo', join(dir, 'roto.json')]));
    expect(roto.codigo, roto.salida).toBe(2);
    expect(roto.salida).toContain('JSON legible');
    writeFileSync(join(dir, 'otro-entorno.json'), JSON.stringify({ version: 1, entorno: 'produccion', tenant: T.revertir, previo: { modulosPresente: false, modulos: null }, escrito: [] }), { mode: 0o600 });
    const entorno = correr(args(T.revertir, ['--revertir', '--aplicar', '--respaldo', join(dir, 'otro-entorno.json')]));
    expect(entorno.codigo, entorno.salida).toBe(2);
    expect(entorno.salida).toContain('otro entorno');
    expect(await tiempo(T.revertir)).toBe(t);
    expect((await datos(T.revertir))['modulos']).toEqual(QTACO);
  });

  it('el respaldo no puede estar dentro del repositorio, ni en una carpeta abierta, ni en una carpeta ajena', async () => {
    const antes = await tiempo(T.seco);
    const base = [...args(T.seco, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar'])];
    const enRepo = correr([...base, '--respaldo', join(REPO, 'admin', 'respaldo-que-no-debe-existir', 'r.json')]);
    expect(enRepo.codigo, enRepo.salida).toBe(2);
    expect(enRepo.salida).toContain('dentro del repositorio');
    expect(existsSync(join(REPO, 'admin', 'respaldo-que-no-debe-existir'))).toBe(false);

    const dir = nuevoDir();
    mkdirSync(join(dir, 'abierta'), { mode: 0o755 }); chmodSync(join(dir, 'abierta'), 0o755);
    const abierta = correr([...base, '--respaldo', join(dir, 'abierta', 'r.json')]);
    expect(abierta.codigo, abierta.salida).toBe(2);
    expect(abierta.salida).toContain('permisos de grupo u otros');

    if (process.getuid?.() !== 0) {
      const fuera = correr([...base, '--respaldo', '/usr/respaldo-que-no-debe-existir/r.json']);
      expect(fuera.codigo, fuera.salida).toBe(2);
      expect(fuera.salida).toContain('carpeta del usuario');
    }

    const relativa = correr([...base, '--respaldo', 'r.json']);
    expect(relativa.codigo, relativa.salida).toBe(2);
    expect(relativa.salida).toContain('absoluta');
    expect(await tiempo(T.seco)).toBe(antes);
  });

  it('salvaguarda en el proceso: sin emulador, o con un proyecto real y variables de emulador, sale con 2 sin imprimir el id', () => {
    const lista = ['--modulos', LISTA_QTACO];
    // demo-* sin FIRESTORE_EMULATOR_HOST (se quita solo durante el lanzamiento).
    const host = process.env['FIRESTORE_EMULATOR_HOST'];
    delete process.env['FIRESTORE_EMULATOR_HOST'];
    let sinHost;
    try {
      sinHost = spawnSync(process.execPath, [SCRIPT, ...args(T.seco, lista)], { env: entornoDelEmulador(undefined), encoding: 'utf8', timeout: 15_000 });
    } finally {
      if (host !== undefined) process.env['FIRESTORE_EMULATOR_HOST'] = host;
    }
    expect(sinHost.status, `${sinHost.stdout}${sinHost.stderr}`).toBe(2);
    expect(sinHost.stderr).toContain('falta FIRESTORE_EMULATOR_HOST');

    // Proyecto real + el entorno hermético trae FIREBASE_AUTH_EMULATOR_HOST: se rechaza por ambiguo, producción o staging.
    for (const p of [STAGING, PROD]) {
      const r = correr(['--proyecto', p, '--tenant', T.seco, ...lista, '--aplicar', '--respaldo', '/x/r.json'], { extra: ENV_REAL });
      expect(r.codigo, r.salida).toBe(2);
      expect(r.salida).toContain('ambiguo');
      expect(r.salida).not.toContain(p);
    }
    // Un proyecto desconocido tampoco pasa.
    const desconocido = correr(['--proyecto', 'otro-proyecto-ficticio', '--tenant', T.seco, ...lista], { extra: ENV_REAL });
    expect(desconocido.codigo, desconocido.salida).toBe(2);
    expect(desconocido.salida).not.toContain('otro-proyecto-ficticio');
  });

  it('invocado por un enlace simbólico también corre: sin --proyecto sale 2, no un falso «0»', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apl-mod-enlace-'));
    dirs.push(dir);
    const enlace = join(dir, 'aplicar-modulos-enlace.mjs');
    symlinkSync(SCRIPT, enlace);
    const r = spawnSync(process.execPath, [enlace], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
    expect(r.stderr).toContain('falta --proyecto');
  });

  // Como root no hay carpeta que no se pueda escribir.
  it.skipIf(process.getuid?.() === 0)('un error de ejecución sale con 3 (no con 1), no imprime el mensaje y NO escribe en la ficha: el respaldo va antes', async () => {
    // La carpeta existente más cercana es del usuario y nadie más la escribe (la validación, que solo mira, la deja
    // pasar), pero no se puede crear nada dentro: `mkdir` falla con EACCES al guardar el respaldo, ANTES de la única
    // escritura a Firestore.
    const dir = nuevoDir();
    mkdirSync(join(dir, 'solo-lectura'), { mode: 0o500 }); chmodSync(join(dir, 'solo-lectura'), 0o500);
    const antes = await tiempo(T.freno);
    const r = correr(args(T.freno, ['--modulos', LISTA_QTACO, '--acepto-diferencias', 'inventario', '--aplicar', '--respaldo', join(dir, 'solo-lectura', 'sub', 'r.json')]));
    chmodSync(join(dir, 'solo-lectura'), 0o700);
    expect(r.codigo, r.salida).toBe(3);
    expect(r.salida).toContain('error de ejecución: EACCES');
    expect(await tiempo(T.freno)).toBe(antes);
    expect('modulos' in (await datos(T.freno))).toBe(false);
  });
});

// ===========================================================================
describe('C. la precondición: la ficha cambia entre la lectura y la escritura', () => {
  const T = 'apl-mod-carrera';
  const T2 = 'apl-mod-carrera-revertir';
  const lineas: string[] = [];
  const log = (t: string) => { lineas.push(t); };

  /** Una base que, justo antes de cada `update`, hace que OTRO cambie la ficha. */
  const baseConCarrera = () => ({
    getAll: (...a: unknown[]) => (db.getAll as (...x: unknown[]) => unknown)(...a),
    doc: (ruta: string) => {
      const ref = db.doc(ruta);
      return new Proxy(ref, {
        get: (t, p) => {
          if (p === 'update') {
            return async (d: unknown, pre: unknown) => {
              await t.set({ cambiadaPorOtro: true }, { merge: true });
              return (t.update as (...x: unknown[]) => unknown)(d, pre);
            };
          }
          const v = (t as unknown as Record<string | symbol, unknown>)[p];
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    },
  });

  beforeAll(async () => {
    await db.recursiveDelete(db.doc(`tenants/${T}`));
    await db.recursiveDelete(db.doc(`tenants/${T2}`));
  });

  it('--aplicar aborta sin escribir: modulos no aparece y el cambio del otro queda', async () => {
    await db.doc(`tenants/${T}`).set({ ...FICHA_VENTA });
    const dir = nuevoDir();
    lineas.length = 0;
    const codigo = await mod.ejecutar({
      proyecto: PROYECTO, entorno: 'emulador', tenant: T, modulos: QTACO, acepto: ['inventario'],
      aplicar: true, revertir: false, respaldo: join(dir, 'r', 'r.json'),
    }, { db: baseConCarrera(), FieldValue, log });
    expect(codigo, lineas.join('\n')).toBe(3);
    expect(lineas.join('\n')).toContain('La ficha cambió entre la lectura y la escritura: no se escribió nada');
    const d = (await db.doc(`tenants/${T}`).get()).data() as Record<string, unknown>;
    expect('modulos' in d).toBe(false);
    expect(d['cambiadaPorOtro']).toBe(true);
  });

  it('--revertir --aplicar también aborta sin escribir', async () => {
    await db.doc(`tenants/${T2}`).set({ ...FICHA_VENTA });
    const dir = nuevoDir();
    const resp = join(dir, 'r', 'r.json');
    // Primero se aplica de verdad (con la base real), para tener un respaldo.
    const lineasA: string[] = [];
    const cfg = { proyecto: PROYECTO, entorno: 'emulador', tenant: T2, modulos: QTACO, acepto: ['inventario'], aplicar: true, revertir: false, respaldo: resp };
    expect(await mod.ejecutar(cfg, { db, FieldValue, log: (t: string) => lineasA.push(t) }), lineasA.join('\n')).toBe(0);
    lineas.length = 0;
    const codigo = await mod.ejecutar({ ...cfg, revertir: true, modulos: null, acepto: ['inventario'] }, { db: baseConCarrera(), FieldValue, log });
    expect(codigo, lineas.join('\n')).toBe(3);
    expect(lineas.join('\n')).toContain('no se escribió nada');
    expect(((await db.doc(`tenants/${T2}`).get()).data() as Record<string, unknown>)['modulos']).toEqual(QTACO);
  });

  // El estado que ve el manejador de Ctrl-C: antes de escribir / escribiendo / escrito.
  it('la corrida avisa su estado: escribiendo y luego escrito; si la precondición rechaza, vuelve a antes', async () => {
    const T3 = 'apl-mod-carrera-estado';
    await db.recursiveDelete(db.doc(`tenants/${T3}`));
    await db.doc(`tenants/${T3}`).set({ ...FICHA_VENTA });
    const dir = nuevoDir();
    const estados: string[] = [];
    const cfg = { proyecto: PROYECTO, entorno: 'emulador', tenant: T3, modulos: QTACO, acepto: ['inventario'], aplicar: true, revertir: false, respaldo: join(dir, 'a', 'r.json') };
    // Seco: nunca marca nada.
    expect(await mod.ejecutar({ ...cfg, aplicar: false, respaldo: null }, { db, FieldValue, log, marcarEscritura: (e: string) => estados.push(e) })).toBe(1);
    expect(estados).toEqual([]);
    // Rechazada por la precondición: escribiendo -> antes (no se escribió nada).
    const codigo = await mod.ejecutar(cfg, { db: baseConCarrera(), FieldValue, log, marcarEscritura: (e: string) => estados.push(e) });
    expect(codigo).toBe(3);
    expect(estados).toEqual(['escribiendo', 'antes']);
    // Escritura buena: escribiendo -> escrito (y se queda en escrito mientras relee).
    estados.length = 0;
    await db.doc(`tenants/${T3}`).set({ ...FICHA_VENTA });
    const bien = await mod.ejecutar({ ...cfg, respaldo: join(dir, 'b', 'r.json') }, { db, FieldValue, log, marcarEscritura: (e: string) => estados.push(e) });
    expect(bien).toBe(0);
    expect(estados).toEqual(['escribiendo', 'escrito']);
    // Revertir: lo mismo.
    estados.length = 0;
    const rev = await mod.ejecutar({ ...cfg, revertir: true, modulos: null, respaldo: join(dir, 'b', 'r.json') }, { db, FieldValue, log, marcarEscritura: (e: string) => estados.push(e) });
    expect(rev).toBe(0);
    expect(estados).toEqual(['escribiendo', 'escrito']);
  });
});

// ===========================================================================
describe('D. el texto del script: la única escritura a Firestore es `modulos`', () => {
  const codigo = readFileSync(SCRIPT, 'utf8');
  const sinComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');

  it('no tiene ningún método de escritura salvo UN `update` cuyo único campo es `modulos`', () => {
    const sinBorrado = sinComentarios.replace(/FieldValue\.delete\(\)/g, '');
    expect(sinBorrado).not.toMatch(/\.(set|create|delete|add|commit|batch|bulkWriter|runTransaction|recursiveDelete)\s*\(/);
    expect(sinComentarios.match(/\.update\s*\(/g) ?? []).toHaveLength(1);
    expect(sinComentarios).toMatch(/\.update\(\{ modulos: valor \}, \{ lastUpdateTime: ultimaActualizacion \}\)/);
    // El único uso de FieldValue es el borrado del campo, y va como valor de `modulos`.
    // (Las demás menciones de FieldValue son el import y el paso de la dependencia: no se usa para nada más.)
    expect(sinComentarios.match(/FieldValue\.(?!delete\(\))\w+/g) ?? []).toEqual([]);
    expect(sinComentarios.match(/FieldValue\.delete\(\)/g) ?? []).toHaveLength(1);
    expect(sinComentarios).toMatch(/escribirModulos\(ref, previo\.modulosPresente \? previo\.modulos : FieldValue\.delete\(\)/);
  });

  it('nada escribe `flujos` ni `vertical`, y el campo de la escritura es fijo', () => {
    expect(sinComentarios).not.toMatch(/\{\s*(flujos|vertical)\s*:/);
    expect(sinComentarios).not.toMatch(/update\([^)]*(flujos|vertical)/);
    // Lee con máscara de campos: solo flujos, vertical y modulos.
    expect(sinComentarios).toContain("const CAMPOS = ['flujos', 'vertical', 'modulos'];");
    expect(sinComentarios).toContain('fieldMask: CAMPOS');
  });

  it('la precondición de la escritura se lee de la ficha ya leída (no se vuelve a leer antes de escribir)', () => {
    expect(sinComentarios.match(/escribirModulos\(/g) ?? []).toHaveLength(3); // definición y dos usos
    expect(sinComentarios.match(/snap\.updateTime/g) ?? []).toHaveLength(3);
  });

  it('el respaldo se abre UNA vez y se comprueba sobre el descriptor: ni `statSync`, `existsSync` ni `chmodSync` sobre la ruta al escribir o leer', () => {
    const desde = (marca: string) => {
      const a = sinComentarios.indexOf(marca);
      return sinComentarios.slice(a, sinComentarios.indexOf('\n}\n', a));
    };
    const guardar = desde('export function guardarRespaldo');
    const leer = desde('export function leerRespaldo');
    for (const [nombre, cuerpo] of [['guardarRespaldo', guardar], ['leerRespaldo', leer]]) {
      expect(cuerpo.length, nombre).toBeGreaterThan(200);
      expect(cuerpo, nombre).toContain('fstatSync(');
      expect(cuerpo, nombre).not.toMatch(/\b(statSync|lstatSync|existsSync|accessSync|chmodSync)\s*\(/);
      expect(cuerpo, nombre).not.toMatch(/readFileSync\(\s*ruta/);
    }
    // El archivo se crea exclusivo, sin seguir enlaces, y su modo se fija en el descriptor.
    expect(guardar).toContain('constants.O_EXCL');
    expect(guardar).toContain('constants.O_NOFOLLOW');
    expect(guardar).toContain('fchmodSync(fd, 0o600)');
    expect(leer).toContain('constants.O_NOFOLLOW');
    // Y no queda ningún `chmodSync`, `statSync(ruta)` ni `readFileSync(ruta)` suelto en el archivo.
    expect(sinComentarios).not.toMatch(/\bchmodSync\b/);
    expect(sinComentarios).not.toMatch(/readFileSync\(\s*ruta/);
  });

  it('el Ctrl-C usa el estado de tres valores y el mensaje propio; ya no hay un booleano `escribiendo`', () => {
    expect(sinComentarios).toContain('mensajeDeInterrupcion(estado)');
    expect(sinComentarios).toContain("marcar('escribiendo')");
    expect(sinComentarios).toContain("marcar('escrito')");
    expect(sinComentarios).toContain("marcar('antes')");
    expect(sinComentarios).not.toMatch(/marcar\((true|false)\)/);
    expect(sinComentarios).not.toContain('let escribiendo');
  });

  it('el respaldo no tiene ruta por omisión ni variable de entorno propia: la da quien corre el script', () => {
    expect(codigo).not.toMatch(/NOVUCHAT_DIR_RESPALDOS|homedir\(|os\.tmpdir|\/home\/|process\.env\[?\.?['"]?(HOME|RESPALDO)/);
    expect(sinComentarios).not.toMatch(/respaldo\s*=\s*valores\['respaldo'\]\s*\?\?/);
  });

  it('el id del proyecto no se imprime: ningún log o error nombra a `cfg.proyecto` ni al valor de --proyecto', () => {
    const impresiones = sinComentarios.split('\n').filter((l) => /console\.(log|error)|\blog\(/.test(l));
    expect(impresiones.join('\n')).not.toMatch(/cfg\.proyecto|PROYECTO|\$\{[^}]*[pP]royecto/);
  });
});
