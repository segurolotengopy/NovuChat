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
import { comprobarBucket, comprobarProyecto, esTenantDePrueba, esUsuarioDePrueba, fichaDeVenta, nombresDePrueba } from '../../scripts/plataforma/verificar-reglas-staging.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'plataforma', 'verificar-reglas-staging.mjs');

/**
 * El hijo hereda el entorno hermético de las suites (`entornoDelEmulador`: Auth a un puerto
 * muerto, sin ADC): aunque la salvaguarda fallara, el script no podría salir a la nube.
 * Ese entorno deja puesto FIREBASE_AUTH_EMULATOR_HOST, así que ningún proyecto real pasa
 * la salvaguarda aquí: los casos de «destino válido» van con un demo-*.
 */
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
    expect(comprobarProyecto('demo-x', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:2' })).toEqual({ ok: true, emulador: true });
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
    const r = correrScript(['--proyecto', 'demo-verif-reglas']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SECO/);
    expect(r.stdout).toMatch(/no se escribió nada/);
    expect(r.stdout).toContain('zz-verif-reglas-');
  });

  it('L3: el id de un proyecto real no se imprime, ni siquiera en el rechazo', () => {
    const r = correrScript(['--proyecto', PROD, '--aplicar'], { GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: STAGING });
    expect(r.stdout + r.stderr).not.toContain(PROD);
  });

  it('--aplicar y --limpiar juntos se rechazan', () => {
    const r = correrScript(['--proyecto', 'demo-verif-reglas', '--aplicar', '--limpiar']);
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
  function conEmuladores(reglasFirestore: string, comandos: string[]) {
    expect(existsSync(firebase)).toBe(true);
    const tmp = mkdtempSync(join(RAIZ, 'pruebas', '.emu-verif.'));
    try {
      writeFileSync(join(tmp, 'firestore.rules'), reglasFirestore);
      copyFileSync(join(RAIZ, 'storage.rules'), join(tmp, 'storage.rules'));
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

  it('con la capacidad exigida la matriz pasa entera; esperado distinto sale 1; limpia siempre; --conservar no; señuelos intactos', () => {
    const [sen, ok, mal, conservar, l1, l2, resto] = conEmuladores(reglasConAgenda, [
      '{D} sembrar',
      '{S} --aplicar --fecha 20261004',
      // Espera permitir una ruta que las reglas niegan (captación sin el flujo): tiene que fallar.
      "{S} --aplicar --fecha 20261004 --storage-ruta-propia 'tenants/{t}/captacion/planes.pdf'",
      '{S} --aplicar --fecha 20261004 --conservar',
      '{S} --limpiar',
      '{S} --limpiar',
      '{D} contar',
    ]);
    expect(sen.codigo, sen.texto).toBe(0);
    expect(ok.codigo, ok.texto).toBe(0);
    expect(ok.texto).toMatch(/, 0 fallos,/);
    expect(ok.texto).toMatch(/Limpieza previa: 0 tenants y 0 usuarios/); // los señuelos no cuentan
    expect(ok.texto).toMatch(/Limpieza final: 2 tenants y 2 usuarios/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/venta\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/marca\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/campanas\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/catalogo \+ contadores\/catalogo \(lote, alta\)\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/fotosCatalogo\s+permitir\s+permitir/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/config\/onboarding\s+negar\s+negar/);
    expect(ok.texto).toMatch(/venta→propio escribir\s+\{propio\}\/funcionarios\/\{f\}\/privado\/datos\s+negar\s+negar/);
    expect(ok.texto).toMatch(/venta→ajeno listar\s+\{ajeno\}\/catalogo\s+negar\s+negar/);
    expect(ok.texto).toMatch(/agenda→ajeno leer\s+\{ajeno\}\/config\/venta\s+negar\s+negar/);
    expect(ok.texto).toMatch(/SIN VERIFICAR/); // no se indicó la ruta propia de Storage

    expect(mal.codigo, mal.texto).toBe(1);
    expect(mal.texto).toMatch(/✗ storage venta→propio subir\s+tenants\/\{propio\}\/captacion\/planes\.pdf\s+permitir\s+negar/);
    expect(mal.texto).toMatch(/Limpieza final: 2 tenants y 2 usuarios/);

    // --conservar: lo sembrado queda, y --limpiar lo borra.
    expect(conservar.codigo, conservar.texto).toBe(0);
    expect(conservar.texto).toMatch(/--conservar/);
    expect(conservar.texto).not.toMatch(/Limpieza final/);
    expect(l1.codigo).toBe(0);
    expect(l1.texto).toMatch(/borrados 2 tenants y 2 usuarios/);
    expect(l2.texto).toMatch(/borrados 0 tenants y 0 usuarios/);

    // L2: ningún señuelo se tocó en ninguna de las limpiezas.
    expect(resto.texto).toMatch(/tenants=6 usuarios=2/);
    for (const x of [ok, mal, conservar, l1, l2]) sinSensibles(x.texto);
  }, 300000);
});

/** Siembra o cuenta los señuelos de la limpieza: parecidos a lo de prueba, pero no lo son. */
const SENUELOS = `
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
const [, , proyecto, modo] = process.argv;
const app = initializeApp({ projectId: proyecto }, 'senuelos');
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
if (modo === 'sembrar') {
  for (const [id, por] of Object.entries(TENANTS)) {
    await db.doc('tenants/' + id).set(por === null ? { estado: 'activo' } : { estado: 'activo', creadoPor: por });
  }
  for (const c of CORREOS) await auth.createUser({ email: c, password: 'x'.repeat(24) });
} else {
  let t = 0; for (const id of Object.keys(TENANTS)) if ((await db.doc('tenants/' + id).get()).exists) t += 1;
  let u = 0; for (const c of CORREOS) if (await auth.getUserByEmail(c).catch(() => null)) u += 1;
  console.log('tenants=' + t + ' usuarios=' + u);
}
process.exit(0);
`;
