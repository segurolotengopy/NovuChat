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
import { comprobarProyecto, fichaDeVenta, nombresDePrueba } from '../../scripts/plataforma/verificar-reglas-staging.mjs';

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
  const STAGING = 'otro-proyecto-staging';

  it('acepta solo el proyecto de la lista blanca que además dice «staging»', () => {
    expect(comprobarProyecto(STAGING, { GCP_PROJECT_ID_STAGING: STAGING, GCP_PROJECT_ID: 'otro-proyecto-prod' }).ok).toBe(true);
  });

  it('rechaza producción, aunque se llame como staging o esté en la lista blanca', () => {
    expect(comprobarProyecto('otro-proyecto-prod', { GCP_PROJECT_ID: 'otro-proyecto-prod', GCP_PROJECT_ID_STAGING: STAGING }).ok).toBe(false);
    const r = comprobarProyecto(STAGING, { GCP_PROJECT_ID: STAGING, GCP_PROJECT_ID_STAGING: STAGING });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/PRODUCCIÓN/);
  });

  it('rechaza lo que no está en la lista blanca, y la lista blanca vacía', () => {
    expect(comprobarProyecto('cualquier-staging', { GCP_PROJECT_ID_STAGING: STAGING }).ok).toBe(false);
    expect(comprobarProyecto(STAGING, {}).ok).toBe(false);
    expect(comprobarProyecto('', { GCP_PROJECT_ID_STAGING: STAGING }).ok).toBe(false);
  });

  it('rechaza un nombre que no dice staging aunque esté en la lista blanca', () => {
    expect(comprobarProyecto('proyecto-real', { GCP_PROJECT_ID_STAGING: 'proyecto-real' }).ok).toBe(false);
    expect(comprobarProyecto('restaging-x', { GCP_PROJECT_ID_STAGING: 'restaging-x' }).ok).toBe(false);
  });

  it('un demo-* solo vale con el emulador, y un proyecto real no vale con el emulador puesto', () => {
    expect(comprobarProyecto('demo-x', {}).ok).toBe(false);
    expect(comprobarProyecto('demo-x', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' }).ok).toBe(false);
    expect(comprobarProyecto('demo-x', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:2' })).toEqual({ ok: true, emulador: true });
    expect(comprobarProyecto(STAGING, { GCP_PROJECT_ID_STAGING: STAGING, FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' }).ok).toBe(false);
  });

  it('el script, como proceso, sale con 2 y no abre nada ante un proyecto prohibido (también en seco)', () => {
    for (const args of [
      ['--proyecto', 'otro-proyecto-prod'],
      ['--proyecto', 'otro-proyecto-prod', '--aplicar'],
      ['--proyecto', 'otro-proyecto-prod', '--limpiar'],
      ['--proyecto', STAGING, '--aplicar'], // sin lista blanca
    ]) {
      const r = correrScript(args, { GCP_PROJECT_ID: 'otro-proyecto-prod' });
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

  /** Levanta Auth+Firestore+Storage con las reglas dadas y corre la lista de comandos del script. */
  function conEmuladores(reglasFirestore: string, comandos: string[]) {
    expect(existsSync(firebase)).toBe(true);
    const tmp = mkdtempSync(join(RAIZ, 'pruebas', '.emu-verif.'));
    try {
      writeFileSync(join(tmp, 'firestore.rules'), reglasFirestore);
      copyFileSync(join(RAIZ, 'storage.rules'), join(tmp, 'storage.rules'));
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
      const base = `node ${SCRIPT} --proyecto ${proy}`;
      const orden = comandos
        .map((c, i) => `${base} ${c} > ${join(tmp, `${i}.txt`)} 2>&1; echo $? > ${join(tmp, `${i}.cod`)}`)
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
  // Lo que haría H2b-6: el privado del funcionario también exige la capacidad de agenda.
  const ANCLA = `allow create, update: if esAdmin(tenantId) && tenantOperativo(tenantId)
                                && datosPersonalesValidos();`;
  const reglasConAgenda = reglasActuales.replace(ANCLA, ANCLA.replace('tenantOperativo(tenantId)', 'tenantOperativo(tenantId) && tieneAgenda(tenantId)'));

  const sinSensibles = (t: string) => {
    expect(t).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(t).not.toMatch(/@verif-reglas\.invalid/);
    expect(t).not.toMatch(/password|clave|token/i);
  };

  it('con las reglas de main de hoy, marca como fallo el privado de funcionarios y sale 1', () => {
    const [m, l] = conEmuladores(reglasActuales, ['--aplicar --fecha 20261004', '--limpiar']);
    expect(m.codigo, m.texto).toBe(1);
    const fallos = m.texto.split('\n').filter((x) => x.includes('✗'));
    expect(fallos.length, fallos.join('\n')).toBe(1);
    expect(fallos[0]).toMatch(/venta→propio escribir\s+\{propio\}\/funcionarios\/\{f\}\/privado\/datos\s+negar\s+permitir/);
    expect(m.texto).toMatch(/, 1 fallos,/);
    expect(l.codigo).toBe(0);
    sinSensibles(m.texto);
  }, 300000);

  it('con la capacidad exigida en el privado la matriz pasa entera; un esperado distinto sale 1; --limpiar borra solo lo de prueba', () => {
    expect(reglasConAgenda).not.toBe(reglasActuales);
    const [ok, mal, l1, l2] = conEmuladores(reglasConAgenda, [
      '--aplicar --fecha 20261004',
      // Espera permitir una ruta que las reglas niegan (captación sin el flujo): tiene que fallar.
      "--aplicar --fecha 20261004 --storage-ruta-propia 'tenants/{t}/captacion/planes.pdf'",
      '--limpiar',
      '--limpiar',
    ]);
    expect(ok.codigo, ok.texto).toBe(0);
    expect(ok.texto).toMatch(/, 0 fallos,/);
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

    expect(l1.codigo).toBe(0);
    expect(l1.texto).toMatch(/borrados 2 tenants y 2 usuarios/);
    expect(l2.texto).toMatch(/borrados 0 tenants y 0 usuarios/);
    for (const x of [ok, mal, l1, l2]) sinSensibles(x.texto);
  }, 300000);
});
