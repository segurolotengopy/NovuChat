/**
 * `verificar-reglas-staging.mjs`, PROBADO CONTRA EL EMULADOR (nunca contra staging).
 *
 * Dos partes:
 *   1. La SALVAGUARDA de proyecto, sin red ni emulador: rechaza producción, lo que no
 *      es de la lista blanca, lo que no se llama staging y un emulador a medias. Se
 *      prueba negando, con la función pura y con el script como proceso.
 *   2. El script entero contra Auth + Firestore + Storage del emulador, con las reglas
 *      de este repositorio. SE SALTA sin VERIFICAR_REGLAS_EMULADOR=1 porque levanta su
 *      propio `firebase emulators:exec` (puertos propios, abajo) y un emulador de
 *      Storage cuelga a veces: `pruebas/correr.sh` y el CI no deben cargar con eso.
 *
 *        cd admin && VERIFICAR_REGLAS_EMULADOR=1 npx vitest run \
 *          pruebas/plataforma/verificar-reglas-staging.test.ts
 *
 * FRAGILIDAD CONOCIDA (L4): una vez, antes de estos cambios, una corrida del emulador salió con
 * código 2 y la siguiente pasó; no se reprodujo en las 3 corridas completas posteriores sin cambios (`emulators:exec`
 * ya espera a que Auth, Firestore y Storage estén listos antes de lanzar el comando). Si vuelve,
 * mire primero si otro proceso ocupa los puertos propios (VERIF_*_PORT) y repita una vez.
 *
 * H1: con un `storage.rules` que niega TODO la corrida tiene que fallar (el control positivo de
 * Storage lo exige); antes daba «0 fallos» porque todas las filas de Storage esperaban «negar».
 *
 * Lo que la parte 2 demuestra:
 *   · HALLAZGO REAL con las reglas de main de hoy: el administrador de un comercio de
 *     venta SÍ puede escribir `funcionarios/*\/privado/*` (esa regla no pide
 *     `tieneAgenda`, a diferencia de `funcionarios/{id}`). La matriz lo marca como
 *     fallo y sale con código 1: es lo que el PR H2b-6 tiene que cerrar.
 *   · con esa única condición agregada en una COPIA de las reglas (lo que haría
 *     H2b-6), la matriz pasa entera, con código 0;
 *   · un resultado distinto del esperado hace salir con código ≠ 0, `--limpiar` borra
 *     solo lo que lleva el prefijo y la salida no lleva tokens ni contraseñas.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
// @ts-expect-error — módulo .mjs sin tipos
import { borrarTenants, comprobarBucket, comprobarProyecto, esHuerfanoDePrueba, esObjetoDePrueba, esTenantDePrueba, esUsuarioDePrueba, fichaDeAgenda, fichaDeVenta, marcarFichas, nombresDePrueba } from '../../scripts/plataforma/verificar-reglas-staging.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'plataforma', 'verificar-reglas-staging.mjs');

/**
 * El hijo hereda el entorno hermético de las suites (`entornoDelEmulador`: Auth a un puerto
 * muerto, sin ADC): aunque la salvaguarda fallara, el script no podría salir a la nube.
 * Ese entorno deja puesto FIREBASE_AUTH_EMULATOR_HOST, así que ningún proyecto real pasa
 * la salvaguarda aquí: los casos de «destino válido» van con un demo-*.
 */
const ST = { FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:1' };
const correrScript = (args: string[], extra: Record<string, string> = {}, host = '127.0.0.1:1') =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', timeout: 30000, env: entornoDelEmulador(host, extra),
  });

describe('verificar-reglas-staging — la salvaguarda de proyecto', () => {
  // Ids sintéticos: el de staging contiene «staging» pegado a otras letras, como el real.
  const STAGING = 'miappstaging';
  const PROD = 'miapp-produccion';
  const DEMOS = 'miapp-demos';
  const BUENO = { GCP_PROJECT_ID_STAGING: STAGING, GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID: DEMOS };

  it('acepta solo el proyecto de la lista blanca que además contiene «staging» (F1: el id real no lo tiene entre guiones)', () => {
    expect(comprobarProyecto(STAGING, BUENO)).toEqual({ ok: true, emulador: false });
    expect(comprobarProyecto('otro-staging-2', { ...BUENO, GCP_PROJECT_ID_STAGING: 'otro-staging-2' }).ok).toBe(true);
  });

  it('Seguridad LOW 1b: un proyecto real se rechaza si CUALQUIER variable de emulador existe, aunque esté en blanco', () => {
    for (const k of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST']) {
      for (const valor of ['127.0.0.1:1', '', '  ']) {
        const r = comprobarProyecto(STAGING, { ...BUENO, [k]: valor });
        expect(r.ok, `${k}=«${valor}»`).toBe(false);
        expect(r.motivo).toMatch(/emulador/);
      }
    }
    // Y un demo-* con una variable en blanco NO cuenta como emulador completo.
    const todas = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:2', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:3' };
    expect(comprobarProyecto('demo-x', todas).ok).toBe(true);
    for (const k of Object.keys(todas)) expect(comprobarProyecto('demo-x', { ...todas, [k]: ' ' }).ok, k).toBe(false);
  });

  it('Seguridad LOW 3: un espacio o salto de línea de más en las variables no esquiva la comparación', () => {
    expect(comprobarProyecto(PROD, { GCP_PROJECT_ID_PROD: `${PROD}\n`, GCP_PROJECT_ID_STAGING: PROD }).ok).toBe(false);
    expect(comprobarProyecto(PROD, { GCP_PROJECT_ID_PROD: ` ${PROD} `, GCP_PROJECT_ID_STAGING: `${PROD} ` }).ok).toBe(false);
    expect(comprobarProyecto(STAGING, { GCP_PROJECT_ID_PROD: '  ', GCP_PROJECT_ID_STAGING: STAGING }).ok).toBe(false);
    expect(comprobarProyecto(STAGING, { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: ` ${STAGING}\n` }).ok).toBe(true);
  });

  it('M2: sin GCP_PROJECT_ID_PROD (ausente o vacía) rechaza, aunque el resto esté bien', () => {
    for (const prod of [undefined, '']) {
      const r = comprobarProyecto(STAGING, { GCP_PROJECT_ID_STAGING: STAGING, GCP_PROJECT_ID: DEMOS, GCP_PROJECT_ID_PROD: prod });
      expect(r.ok).toBe(false);
      expect(r.motivo).toMatch(/GCP_PROJECT_ID_PROD/);
    }
  });

  it('M2: rechaza si coincide con GCP_PROJECT_ID_PROD, FIREBASE_PROJECT_ID o GCP_PROJECT_ID, aunque esté en la lista blanca', () => {
    for (const [v, id] of [['GCP_PROJECT_ID_PROD', PROD], ['FIREBASE_PROJECT_ID', 'miapp-staging-fb'], ['GCP_PROJECT_ID', 'miapp-staging-demos']] as const) {
      const r = comprobarProyecto(id, { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: id, [v]: id });
      expect(r.ok, v).toBe(false);
      expect(r.motivo, v).toContain(v);
    }
  });

  it('F1: el proyecto de producción NO pasa aunque GCP_PROJECT_ID esté vacía o falte', () => {
    for (const env of [
      { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: STAGING, GCP_PROJECT_ID: '' },
      { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: STAGING },
      { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: PROD }, // lista blanca mal puesta con el id de producción
    ]) {
      expect(comprobarProyecto(PROD, env).ok).toBe(false);
    }
    // Y un nombre de producción que casualmente dijera «staging» tampoco pasa si es el de producción.
    expect(comprobarProyecto('x-staging-prod', { GCP_PROJECT_ID_PROD: 'x-staging-prod', GCP_PROJECT_ID_STAGING: 'x-staging-prod' }).ok).toBe(false);
  });

  it('rechaza lo que no está en la lista blanca, y la lista blanca vacía', () => {
    expect(comprobarProyecto('cualquier-staging', BUENO).ok).toBe(false);
    expect(comprobarProyecto(STAGING, { GCP_PROJECT_ID_PROD: PROD }).ok).toBe(false);
    expect(comprobarProyecto('', BUENO).ok).toBe(false);
  });

  it('rechaza un nombre sin «staging» aunque esté en la lista blanca', () => {
    expect(comprobarProyecto('proyecto-real', { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: 'proyecto-real' }).ok).toBe(false);
  });

  it('M1: el bucket tiene que ser del proyecto; el de producción (o cualquier otro) se rechaza', () => {
    expect(comprobarBucket(STAGING, `${STAGING}.firebasestorage.app`, false).ok).toBe(true);
    expect(comprobarBucket(STAGING, `${STAGING}.appspot.com`, false).ok).toBe(true);
    for (const malo of [`${PROD}.firebasestorage.app`, `${PROD}.appspot.com`, 'otro-bucket', '', `${STAGING}.firebasestorage.app.evil`, `x${STAGING}.appspot.com`, `${STAGING}-x.appspot.com`]) {
      const r = comprobarBucket(STAGING, malo, false);
      expect(r.ok, malo).toBe(false);
    }
    expect(comprobarBucket('demo-x', 'cualquiera', true).ok).toBe(true); // contra el emulador, vale cualquiera
  });

  it('M3: un padre huérfano solo se borra si su id tiene la forma exacta de los de prueba y NO existe', () => {
    expect(esHuerfanoDePrueba('zz-verif-reglas-20261004', false)).toBe(true);
    expect(esHuerfanoDePrueba('zz-verif-reglas-20261004-ag', false)).toBe(true);
    for (const [id, existe] of [
      ['zz-verif-reglas-20261004', true], ['zz-verif-reglas-ajeno-huerfano', false], ['cliente-huerfano', false],
      ['zz-verif-reglas', false], ['zz-verif-reglasX-20261004', false], ['zz-verif-reglas-2026100', false],
      ['zz-verif-reglas-20261004-otro', false], ['zz-verif-reglas-20261004', undefined],
    ] as const) {
      expect(esHuerfanoDePrueba(id, existe), id).toBe(false);
    }
  });

  it('Storage: un objeto es de prueba solo si el segundo segmento tiene la forma exacta del id', () => {
    expect(esObjetoDePrueba('tenants/zz-verif-reglas-20261004/captacion/planes.pdf')).toBe(true);
    expect(esObjetoDePrueba('tenants/zz-verif-reglas-20261004-ag/captacion/planes.pdf')).toBe(true);
    for (const n of ['tenants/cliente-real/captacion/planes.pdf', 'tenants/zz-verif-reglas-/x', 'tenants/zz-verif-reglas-ajeno-real/x',
      'tenants/zz-verif-reglas-20261004', 'tenants/zz-verif-reglas-20261004/', 'otra/zz-verif-reglas-20261004/x', 'zz-verif-reglas-20261004/x', '', undefined]) {
      expect(esObjetoDePrueba(n as string), String(n)).toBe(false);
    }
  });

  it('M1 (limpieza): si falla Storage de un tenant NO se borra su árbol de Firestore (se conserva el ancla); un 404 no cuenta', async () => {
    const arboles: string[] = [];
    const r = await borrarTenants({
      borrarObjetos: async (id: string) => {
        if (id === 'zz-verif-reglas-20261004') throw Object.assign(new Error('x'), { code: 403 });
        if (id === 'zz-verif-reglas-20261005') throw Object.assign(new Error('x'), { code: 404 });
      },
      borrarArbol: async (id: string) => { arboles.push(id); },
    }, ['zz-verif-reglas-20261004', 'zz-verif-reglas-20261005', 'zz-verif-reglas-20261006']);
    expect(arboles).toEqual(['zz-verif-reglas-20261005', 'zz-verif-reglas-20261006']); // el 403 conserva el ancla
    expect(r.borrados).toBe(2);
    expect(r.falloStorage?.code).toBe(403);
    // Sin fallos: todo se borra.
    arboles.length = 0;
    const ok = await borrarTenants({ borrarObjetos: async () => {}, borrarArbol: async (id: string) => { arboles.push(id); } }, ['a', 'b']);
    expect(ok).toEqual({ borrados: 2, falloStorage: null });
    expect(arboles).toEqual(['a', 'b']);
  });

  it('L3 (limpieza): se borra primero SOLO la ficha, y solo de lo que es de prueba', async () => {
    const MARCA = { creadoPor: 'verificar-reglas-staging' };
    const docs: Record<string, { existe: boolean; data?: object }> = {
      'zz-verif-reglas-20261004': { existe: true, data: MARCA },
      'zz-verif-reglas-20261004-ag': { existe: true, data: MARCA },
      'zz-verif-reglas-20250101': { existe: false },                 // huérfano con id de prueba
      'zz-verif-reglas-ajeno-huerfano': { existe: false },           // huérfano ajeno
      'zz-verif-reglas-ajeno-real': { existe: true, data: { creadoPor: 'otra' } },
      'zz-verif-reglas-': { existe: true, data: MARCA },             // el prefijo a secas
      'cliente-real': { existe: true, data: MARCA },
    };
    const fichas: string[] = [];
    const leidos: string[] = [];
    const c = await marcarFichas({
      ids: Object.keys(docs),
      leer: async (id: string) => { leidos.push(id); return docs[id]; },
      borrarFicha: async (id: string) => { fichas.push(id); },
    });
    expect(c).toEqual(['zz-verif-reglas-20261004', 'zz-verif-reglas-20261004-ag', 'zz-verif-reglas-20250101']);
    expect(fichas).toEqual(['zz-verif-reglas-20261004', 'zz-verif-reglas-20261004-ag']); // al huérfano no hay ficha que borrar
    expect(leidos).not.toContain('cliente-real'); // ni se lee lo que no lleva el prefijo
  });

  it('H1/M1: el comercio de agenda tiene captación (la capacidad de lo que el de venta no puede)', () => {
    expect(fichaDeAgenda('t').flujos).toEqual(['agendamiento', 'onboarding']);
    expect(fichaDeVenta('t').flujos).toEqual(['venta']);
  });

  it('L2: solo se borra lo que lleva prefijo Y dominio reservado (usuarios) o prefijo Y marca (tenants)', () => {
    // Correos armados con una función: el saneo del repositorio público no admite literales de correo.
    const correo = (u: string, d = 'verif-reglas.invalid') => `${u}@${d}`;
    expect(esUsuarioDePrueba(correo('zz-verif-reglas-20261004-admin'))).toBe(true);
    for (const c of [correo('zz-verif-reglas-alguien', 'gmail.example'), correo('cliente'), correo('zz-verif-reglas'),
      correo('zz-verif-reglasX-1'), '', undefined, null]) {
      expect(esUsuarioDePrueba(c as string), String(c)).toBe(false);
    }
    expect(esTenantDePrueba('zz-verif-reglas-20261004', { creadoPor: 'verificar-reglas-staging' })).toBe(true);
    for (const [id, ficha] of [
      // Seguridad 1b: el mismo regex que el huérfano; el prefijo a secas ya no alcanza.
      ['zz-verif-reglas-', { creadoPor: 'verificar-reglas-staging' }], ['zz-verif-reglas-x', { creadoPor: 'verificar-reglas-staging' }],
      ['zz-verif-reglas-20261004-otro', { creadoPor: 'verificar-reglas-staging' }],
      ['zz-verif-reglas-ajeno-real', { creadoPor: 'alguien' }], ['zz-verif-reglas-x', {}], ['zz-verif-reglas-x', undefined],
      ['cliente-real', { creadoPor: 'verificar-reglas-staging' }], ['zz-verif-reglas', { creadoPor: 'verificar-reglas-staging' }],
      ['zz-verif-reglasX-1', { creadoPor: 'verificar-reglas-staging' }],
    ] as const) {
      expect(esTenantDePrueba(id, ficha), id).toBe(false);
    }
  });

  it('un demo-* solo vale con el emulador, y un proyecto real no vale con el emulador puesto', () => {
    expect(comprobarProyecto('demo-x', {}).ok).toBe(false);
    expect(comprobarProyecto('demo-x', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' }).ok).toBe(false);
    // Seguridad LOW 2: también exige el emulador de Storage (si no, el cliente iría al bucket real).
    expect(comprobarProyecto('demo-x', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:2' }).ok).toBe(false);
    expect(comprobarProyecto('demo-x', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:2', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:3' })).toEqual({ ok: true, emulador: true });
    expect(comprobarProyecto(STAGING, { ...BUENO, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:3' }).ok).toBe(false);
    expect(comprobarProyecto(STAGING, { ...BUENO, FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' }).ok).toBe(false);
  });

  it('el script, como proceso, sale con 2 y no abre nada ante un proyecto prohibido (también en seco)', () => {
    for (const args of [
      ['--proyecto', PROD],
      ['--proyecto', PROD, '--aplicar'],
      ['--proyecto', PROD, '--limpiar'],
      ['--proyecto', STAGING, '--aplicar'], // un proyecto real con el entorno hermético (emulador puesto) se rechaza
    ]) {
      const r = correrScript(args, { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: STAGING });
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/Proyecto rechazado/);
    }
  });

  it('en seco contra un destino válido (el emulador) imprime el plan, no escribe y sale 0', () => {
    const r = correrScript(['--proyecto', 'demo-verif-reglas'], ST);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SECO/);
    expect(r.stdout).toMatch(/no se escribió nada/);
    expect(r.stdout).toContain('zz-verif-reglas-');
  });

  it('L3: el id de un proyecto real no se imprime, ni siquiera en el rechazo', () => {
    const r = correrScript(['--proyecto', PROD, '--aplicar'], { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: STAGING });
    expect(r.stdout + r.stderr).not.toContain(PROD);
  });

  it('un demo-* sin el emulador de Storage se rechaza también en seco; y --storage-ruta-propia fuera de tenants/{t}/ también', () => {
    expect(correrScript(['--proyecto', 'demo-verif-reglas']).status).toBe(2);
    for (const ruta of ['otra/{t}/x.png', 'tenants/{t}/../x.png', 'tenants/x/logo.png']) {
      const r = correrScript(['--proyecto', 'demo-verif-reglas', '--storage-ruta-propia', ruta], ST);
      expect(r.status, ruta).toBe(2);
    }
  });

  it('--aplicar y --limpiar juntos se rechazan', () => {
    const r = correrScript(['--proyecto', 'demo-verif-reglas', '--aplicar', '--limpiar'], ST);
    expect(r.status).toBe(2);
  });

  it('los identificadores llevan el prefijo que --limpiar exige, y la ficha tiene la forma de la de Q\'Taco sin modulos', () => {
    const n = nombresDePrueba('20261004');
    expect(n.venta).toBe('zz-verif-reglas-20261004');
    for (const v of [n.venta, n.agenda, n.correoVenta, n.correoAgenda]) expect(v.startsWith('zz-verif-reglas-')).toBe(true);
    const f = fichaDeVenta('t');
    expect(Object.keys(f).sort()).toEqual([
      'creadoEn', 'creadoPor', 'estado', 'flujos', 'nombre', 'plan', 'vertical', 'waPhoneNumberId', 'waWabaId',
    ]);
    expect(f).not.toHaveProperty('modulos');
    expect(f.flujos).toEqual(['venta']);
  });
});

// ---------------------------------------------------------------------------
// Parte 2: contra los emuladores, con puertos propios.
// ---------------------------------------------------------------------------
const P = {
  fs: process.env.VERIF_FS_PORT ?? '8951', ws: process.env.VERIF_WS_PORT ?? '9351',
  auth: process.env.VERIF_AUTH_PORT ?? '9451', st: process.env.VERIF_ST_PORT ?? '9551',
  hub: process.env.VERIF_HUB_PORT ?? '4851', log: process.env.VERIF_LOG_PORT ?? '4951',
};

describe.skipIf(!process.env.VERIFICAR_REGLAS_EMULADOR)('verificar-reglas-staging — contra el emulador', () => {
  const firebase = join(RAIZ, 'node_modules', '.bin', 'firebase');
  const proy = 'demo-verif-reglas';

  /**
   * Levanta Auth+Firestore+Storage con las reglas dadas y corre los comandos en orden.
   * En cada comando, `{S}` es el script con el proyecto demo y `{D}` el sembrador de señuelos.
   */
  function conEmuladores(reglasFirestore: string, comandos: string[], reglasStorage?: string) {
    expect(existsSync(firebase)).toBe(true);
    const tmp = mkdtempSync(join(RAIZ, 'pruebas', '.emu-verif.'));
    try {
      writeFileSync(join(tmp, 'firestore.rules'), reglasFirestore);
      if (reglasStorage) writeFileSync(join(tmp, 'storage.rules'), reglasStorage);
      else copyFileSync(join(RAIZ, 'storage.rules'), join(tmp, 'storage.rules'));
      // Señuelos de la limpieza (L2): lo que se parece a lo de prueba y NO lo es. Corre dentro de
      // los emuladores, con el SDK Admin, y se resuelve desde admin/node_modules (el tmp está en admin/).
      writeFileSync(join(tmp, 'senuelos.mjs'), SENUELOS);
      writeFileSync(join(tmp, 'firebase.json'), JSON.stringify({
        firestore: { rules: 'firestore.rules' },
        storage: { rules: 'storage.rules' },
        emulators: {
          auth: { host: '127.0.0.1', port: Number(P.auth) },
          firestore: { host: '127.0.0.1', port: Number(P.fs), websocketPort: Number(P.ws) },
          storage: { host: '127.0.0.1', port: Number(P.st) },
          hub: { host: '127.0.0.1', port: Number(P.hub) },
          logging: { host: '127.0.0.1', port: Number(P.log) },
          ui: { enabled: false },
          singleProjectMode: true,
        },
      }));
      const S = `node ${SCRIPT} --proyecto ${proy}`;
      const D = `node ${join(tmp, 'senuelos.mjs')} ${proy}`;
      const orden = comandos
        .map((c, i) => `${c.replace('{S}', S).replace('{D}', D)} > ${join(tmp, `${i}.txt`)} 2>&1; echo $? > ${join(tmp, `${i}.cod`)}`)
        .join('; ');
      const r = spawnSync(firebase, [
        'emulators:exec', '--config', join(tmp, 'firebase.json'), '--project', proy,
        '--only', 'auth,firestore,storage', orden,
      ], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: entornoDelEmulador(undefined, { STORAGE_EMULATOR_PORT: P.st }) });
      expect(r.status, r.stderr.slice(-500)).toBe(0);
      return comandos.map((_, i) => ({
        texto: readFileSync(join(tmp, `${i}.txt`), 'utf8'),
        codigo: Number(readFileSync(join(tmp, `${i}.cod`), 'utf8').trim()),
      }));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  const reglasActuales = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');
  // Lo que hace H2b-6 (#422): el privado del funcionario también exige la capacidad de agenda.
  // F2: al fusionar #422 ESTE ancla deja de existir en las reglas. Entonces `reglasConAgenda` es
  // igual a `reglasActuales` y las dos pruebas de abajo cambian de sentido a propósito: se
  // exige 0 fallos con las reglas reales (y se avisa por consola), en vez de saltarse en silencio.
  const ANCLA = `allow create, update: if esAdmin(tenantId) && tenantOperativo(tenantId)
                                && datosPersonalesValidos();`;
  const anclaVigente = reglasActuales.includes(ANCLA);
  const reglasConAgenda = reglasActuales.replace(ANCLA, ANCLA.replace('tenantOperativo(tenantId)', 'tenantOperativo(tenantId) && tieneAgenda(tenantId)'));
  if (!anclaVigente) {
    console.warn('AVISO verificar-reglas-staging.test: el ancla de funcionarios/privado ya no está en firestore.rules (¿se fusionó #422?). '
      + 'La prueba «reglas de hoy» ahora exige 0 fallos con las reglas reales; si cambió la forma de la regla, actualice ANCLA.');
  }

  const sinSensibles = (t: string) => {
    expect(t).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(t).not.toMatch(/@verif-reglas\.invalid/);
    expect(t).not.toMatch(/password|clave|token/i);
  };

  it('con las reglas de hoy: si el privado de funcionarios sigue abierto, marca ese único fallo y sale 1; si #422 ya lo cerró, 0 fallos', () => {
    const [m] = conEmuladores(reglasActuales, ['{S} --aplicar --fecha 20261004']);
    sinSensibles(m.texto);
    if (anclaVigente) {
      expect(m.codigo, m.texto).toBe(1);
      const fallos = m.texto.split('\n').filter((x) => x.includes('✗'));
      expect(fallos.length, fallos.join('\n')).toBe(1);
      expect(fallos[0]).toMatch(/venta→propio escribir\s+\{propio\}\/funcionarios\/\{f\}\/privado\/datos\s+negar\s+permitir/);
      expect(m.texto).toMatch(/, 1 fallos,/);
    } else {
      expect(m.codigo, m.texto).toBe(0);
      expect(m.texto).toMatch(/, 0 fallos,/);
    }
    expect(m.texto).toMatch(/Limpieza final: 2 tenants y 2 usuarios/); // L1: limpia también cuando la matriz falla
  }, 300000);

  it('H1: con un storage.rules que niega TODO la corrida falla (sale 1) por el control positivo de Storage', () => {
    const NIEGA_TODO = "rules_version = '2';\nservice firebase.storage { match /b/{bucket}/o { match /{todo=**} { allow read, write: if false; } } }\n";
    const [m] = conEmuladores(reglasConAgenda, ['{S} --aplicar --fecha 20261004'], NIEGA_TODO);
    expect(m.codigo, m.texto).toBe(1);
    expect(m.texto).toMatch(/✗ storage agenda→propio subir\s+tenants\/\{propio\}\/captacion\/planes\.pdf\s+permitir\s+negar/);
    expect(m.texto).toMatch(/✗ storage agenda→propio leer/);
    expect(m.texto).not.toMatch(/SIN VERIFICAR/);
    expect(m.texto).toMatch(/Limpieza final/); // y limpia igual
  }, 300000);

  it('con la capacidad exigida la matriz pasa entera; esperado distinto sale 1; limpia siempre; --conservar no; señuelos intactos', () => {
    const [sen, ok, mal, conservar, objetos, l1, l2, resto] = conEmuladores(reglasConAgenda, [
      '{D} sembrar',
      '{S} --aplicar --fecha 20261004',
      // Espera permitir una ruta que las reglas niegan (captación sin el flujo): tiene que fallar.
      "{S} --aplicar --fecha 20261004 --storage-ruta-propia 'tenants/{t}/captacion/planes.pdf'",
      '{S} --aplicar --fecha 20261004 --conservar',
      '{D} objetos',
      '{S} --limpiar',
      '{S} --limpiar',
      '{D} contar',
    ]);
    expect(sen.codigo, sen.texto).toBe(0);
    expect(ok.codigo, ok.texto).toBe(0);
    expect(ok.texto).toMatch(/, 0 fallos,/);
    expect(ok.texto).toMatch(/de 71 filas/);
    // M3: el padre huérfano con id de prueba se barre; los señuelos no cuentan.
    expect(ok.texto).toMatch(/Limpieza previa: 1 tenants y 0 usuarios/);
    expect(ok.texto).toMatch(/Limpieza final: 2 tenants y 2 usuarios/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/venta\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/marca\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/campanas\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/catalogo \+ contadores\/catalogo \(lote, alta\)\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/fotosCatalogo\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/onboarding\s+negar\s+negar/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/funcionarios\/\{f\}\s+negar\s+negar/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/funcionarios\/\{f\}\/privado\/datos\s+negar\s+negar/);
    // M1: los controles positivos de lo que el de venta no puede, en el comercio que SÍ tiene la capacidad.
    expect(ok.texto).toMatch(/agenda→propio escribir\s+\{propio\}\/config\/onboarding\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/agenda→propio escribir\s+\{propio\}\/funcionarios\/\{f\}\s+permitir\s+permitir/);
    // H1: control positivo de Storage, y las negativas contra un comercio con captación.
    expect(ok.texto).toMatch(/storage agenda→propio subir\s+tenants\/\{propio\}\/captacion\/planes\.pdf\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/storage agenda→propio leer\s+tenants\/\{propio\}\/captacion\/planes\.pdf\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/storage venta→ajeno leer\s+tenants\/\{ajeno\}\/captacion\/planes\.pdf\s+negar\s+negar/);
    expect(ok.texto).toMatch(/venta→ajeno listar\s+\{ajeno\}\/catalogo\s+negar\s+negar/);
    expect(ok.texto).toMatch(/agenda→ajeno leer\s+\{ajeno\}\/config\/venta\s+negar\s+negar/);
    expect(ok.texto).not.toMatch(/SIN VERIFICAR/);

    expect(mal.codigo, mal.texto).toBe(1);
    expect(mal.texto).toMatch(/de 77 filas/);
    expect(mal.texto).toMatch(/✗ storage venta→propio subir \(ruta extra\)\s+tenants\/\{propio\}\/captacion\/planes\.pdf\s+permitir\s+negar/);
    expect(mal.texto).toMatch(/Limpieza final: 2 tenants y 2 usuarios/);

    // --conservar: lo sembrado queda (también el objeto de Storage), y --limpiar lo borra todo.
    expect(conservar.codigo, conservar.texto).toBe(0);
    expect(conservar.texto).toMatch(/--conservar/);
    expect(conservar.texto).not.toMatch(/Limpieza final/);
    expect(objetos.texto).toMatch(/objetos=1/);
    expect(l1.codigo).toBe(0);
    expect(l1.texto).toMatch(/borrados 2 tenants y 2 usuarios/);
    expect(l2.texto).toMatch(/borrados 0 tenants y 0 usuarios/);

    // L2/M3: ningún señuelo se tocó; el objeto de Storage y el huérfano con id de prueba se fueron.
    expect(resto.texto).toMatch(/tenants=6 usuarios=2 huerfanos-ajenos=2 huerfano-valido=0 objetos=0 objetos-ajenos=2/);
    for (const x of [ok, mal, conservar, l1, l2]) sinSensibles(x.texto);
  }, 300000);
});

/** Siembra o cuenta los señuelos de la limpieza: parecidos a lo de prueba, pero no lo son. */
const SENUELOS = `
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
const [, , proyecto, modo] = process.argv;
const app = initializeApp({ projectId: proyecto, storageBucket: proyecto + '.appspot.com' }, 'senuelos');
const bucket = getStorage(app).bucket();
// Objetos de prueba (segundo segmento con forma de id de prueba): sin contar los señuelos ajenos.
const objetos = async () => (await bucket.getFiles({ prefix: 'tenants/zz-verif-reglas-' }))[0].filter((f) => !f.name.includes('ajeno-real')).length;
// Objetos AJENOS que no se pueden tocar nunca: otro tenant, y un id con el prefijo pero sin la forma.
const AJENOS = ['tenants/cliente-real/captacion/planes.pdf', 'tenants/zz-verif-reglas-ajeno-real/captacion/planes.pdf'];
const ajenos = async () => { let n = 0; for (const a of AJENOS) if ((await bucket.file(a).exists())[0]) n += 1; return n; };
const db = getFirestore(app); const auth = getAuth(app);
const TENANTS = {
  'cliente-real': 'verificar-reglas-staging',          // marca, pero sin prefijo
  'zz-verif-reglas-ajeno-real': 'otra-persona',        // prefijo, pero sin marca
  'zz-verif-reglas-sin-marca': null,                   // prefijo, sin creadoPor
  'zz-verif-reglas': 'verificar-reglas-staging',       // sin guion final
  'zz-verif-reglasX-20261004': 'verificar-reglas-staging', // prefijo parecido
  'zz-verif-reglas-20261004-otro': 'otra-persona',     // casi el id de prueba, de otro
};
const CORREOS = ['zz-verif-reglas-alguien', 'cliente-real'].map((u) => u + '@' + 'gmail.example');
// Padres HUÉRFANOS (sin documento, solo con subcolección), como los que deja registrarCambioConfig:
// el de id de prueba (fecha válida) se barre; los ajenos NO.
const HUERFANO_VALIDO = 'zz-verif-reglas-20250101';
const HUERFANOS_AJENOS = ['zz-verif-reglas-ajeno-huerfano', 'cliente-huerfano'];
if (modo === 'sembrar') {
  for (const a of AJENOS) await bucket.file(a).save('x');
  // Un objeto con id de prueba cuyo tenant YA NO existe: el barrido lo borra.
  await bucket.file('tenants/zz-verif-reglas-20250102/captacion/planes.pdf').save('x');
  await db.doc('tenants/' + HUERFANO_VALIDO + '/bitacora/x').set({ x: 1 });
  for (const id of HUERFANOS_AJENOS) await db.doc('tenants/' + id + '/bitacora/x').set({ x: 1 });
  for (const [id, por] of Object.entries(TENANTS)) {
    await db.doc('tenants/' + id).set(por === null ? { estado: 'activo' } : { estado: 'activo', creadoPor: por });
  }
  for (const c of CORREOS) await auth.createUser({ email: c, password: 'x'.repeat(24) });
} else if (modo === 'objetos') {
  console.log('objetos=' + (await objetos()));
} else {
  let h = 0; for (const id of HUERFANOS_AJENOS) if ((await db.doc('tenants/' + id + '/bitacora/x').get()).exists) h += 1;
  const hv = (await db.doc('tenants/' + HUERFANO_VALIDO + '/bitacora/x').get()).exists ? 1 : 0;
  let t = 0; for (const id of Object.keys(TENANTS)) if ((await db.doc('tenants/' + id).get()).exists) t += 1;
  let u = 0; for (const c of CORREOS) if (await auth.getUserByEmail(c).catch(() => null)) u += 1;
  console.log('tenants=' + t + ' usuarios=' + u + ' huerfanos-ajenos=' + h + ' huerfano-valido=' + hv + ' objetos=' + (await objetos()) + ' objetos-ajenos=' + (await ajenos()));
}
process.exit(0);
`;
