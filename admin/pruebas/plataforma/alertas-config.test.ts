/**
 * `scripts/plataforma/alertas-config.mjs`, CONTRA EL EMULADOR (proyecto propio para no cruzarse con otras suites).
 *
 * El script escribe `plataforma/alertas` con el SDK Admin, que se salta las reglas: lo único que impide un tope de 50, un
 * host con IP o un archivo versionado es su propia validación. Se prueba ejecutándolo de verdad y NEGANDO. Valores
 * sintéticos armados en ejecución (ningún dominio ni correo real en el repositorio).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TOPE_MAXIMO } from '../../functions/src/plataforma/alertaOperativa.ts';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'alertas-config.mjs');
const PROYECTO = 'demo-alertas-config';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps, deleteApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'alertas-config') ?? initializeApp({ projectId: PROYECTO }, 'alertas-config');
const db = getFirestore(app);
const ref = db.doc('plataforma/alertas');

const DOMINIO = ['avisos', 'ejemplo', 'test'].join('.');
const CORREO = ['persona', '@', 'ejemplo', '.test'].join('');
const DENEGADA = 'cadena-denegada-ficticia';
let tmp: string;
let runtime: string;

const doc = async () => (await ref.get());
const leer = (r: string): string => readFileSync(r, 'utf8');
const modoDe = (r: string): number => { const fd = openSync(r, 'r'); try { return fstatSync(fd).mode & 0o777; } finally { closeSync(fd); } };

function correr(...a: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...a], {
    encoding: 'utf8', env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: runtime }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  // Nada de lo que se escribe sale entero por pantalla: ni el correo, ni las cadenas denegadas.
  expect(salida).not.toContain(CORREO);
  expect(salida).not.toContain(DENEGADA);
  return { codigo: r.status, salida };
}
const BASE = ['--dominio', DOMINIO, '--destinatario', CORREO, '--hosts', 'github.com', '--repos', 'dueno/repo-uno'];

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'alertas-config-'));
  runtime = join(tmp, 'run'); (await import('node:fs')).mkdirSync(runtime, { mode: 0o700 }); chmodSync(runtime, 0o700);
  await ref.delete();
});
afterAll(async () => { await ref.delete(); await deleteApp(app); });

describe('alertas-config.mjs: seco por omisión, escritura con respaldo y relectura', () => {
  it('sin --aplicar NO escribe nada y dice qué haría, con el destinatario enmascarado', async () => {
    const r = correr(...BASE, '--denegar', DENEGADA);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Sin --aplicar no se escribió nada');
    expect(r.salida).toContain('p***@e***');
    expect(r.salida).toContain('1 cadena(s), no se imprimen');
    expect((await doc()).exists).toBe(false);
  });

  it('--aplicar escribe SOLO los campos pedidos, deja el respaldo (modo 600) y relee', async () => {
    await ref.set({ otroCampo: 'ajeno', topeDiario: 4 });
    const r = correr(...BASE, '--tope', '6', '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('escrito y comprobado');
    const d = await doc();
    expect(d.get('dominioAvisos')).toBe(DOMINIO);
    expect(d.get('destinatario')).toBe(CORREO);
    expect(d.get('enlaceHosts')).toBe('github.com');
    expect(d.get('enlaceRepos')).toBe('dueno/repo-uno');
    expect(d.get('topeDiario')).toBe(6);
    expect(d.get('otroCampo')).toBe('ajeno');                       // no toca lo que no es suyo
    const ruta = /Respaldo \(modo 600\): (\S+)/.exec(r.salida)![1]!;
    expect(modoDe(ruta)).toBe(0o600);
    expect(JSON.parse(leer(ruta))).toEqual({ existia: true, datos: { topeDiario: 4 } });
  });

  it('repetir lo mismo: «Nada que cambiar» y no escribe ni deja otro respaldo', async () => {
    correr(...BASE, '--aplicar');
    const r = correr(...BASE, '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Nada que cambiar');
    expect(r.salida).not.toContain('Respaldo');
  });

  it('--revertir devuelve el documento anterior (o lo borra si no existía) y relee', async () => {
    const a = correr(...BASE, '--aplicar');
    const ruta = /Respaldo \(modo 600\): (\S+)/.exec(a.salida)![1]!;
    expect((await doc()).exists).toBe(true);
    const seco = correr('--revertir', ruta);
    expect(seco.codigo).toBe(0);
    expect((await doc()).get('dominioAvisos')).toBe(DOMINIO);       // el seco no revierte
    const r = correr('--revertir', ruta, '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('revertido y comprobado');
    const d = await doc();
    expect(d.get('dominioAvisos')).toBeUndefined();
    expect(d.get('destinatario')).toBeUndefined();
  });

  it('--revertir restaura los valores previos de un documento que ya existía', async () => {
    await ref.set({ dominioAvisos: 'previo.ejemplo.test', topeDiario: 3 });
    const a = correr(...BASE, '--tope', '7', '--aplicar');
    const ruta = /Respaldo \(modo 600\): (\S+)/.exec(a.salida)![1]!;
    expect(correr('--revertir', ruta, '--aplicar').codigo).toBe(0);
    const d = await doc();
    expect([d.get('dominioAvisos'), d.get('topeDiario'), d.get('destinatario')]).toEqual(['previo.ejemplo.test', 3, undefined]);
  });

  it('un archivo local *.local.json sirve; las cadenas denegadas entran y NO se imprimen', async () => {
    const f = join(tmp, 'alertas.local.json');
    writeFileSync(f, JSON.stringify({ dominioAvisos: DOMINIO, destinatario: CORREO, enlaceHosts: ['github.com'], enlaceRepos: [], avisosDenegar: [DENEGADA, 'otra-cadena-ficticia'], topeDiario: 8 }));
    const r = correr('--archivo', f, '--aplicar');
    expect(r.codigo).toBe(0);
    const d = await doc();
    expect(d.get('avisosDenegar')).toBe(`${DENEGADA},otra-cadena-ficticia`);
    expect(d.get('enlaceRepos')).toBe('');                          // lista vacía = sin enlaces de Actions
    expect(d.get('topeDiario')).toBe(8);
  });
});

describe('alertas-config.mjs: lo que se NIEGA (sale 2 y no escribe)', () => {
  const sinEscribir = async (...a: string[]) => {
    const r = correr(...a, '--aplicar');
    expect(r.codigo, a.join(' ')).toBe(2);
    expect((await doc()).exists).toBe(false);
  };
  it('tope mayor que el máximo del código (9, 50), cero, negativo, decimal o texto: se RECHAZA, no se recorta', async () => {
    for (const t of ['9', '50', '0', '-1', '4.5', 'x', '']) await sinEscribir(...BASE, '--tope', t);
  });
  it('el máximo de este script es el del código', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toContain(`const TOPE_MAXIMO = ${TOPE_MAXIMO};`);
  });
  it('dominio con esquema o ruta, destinatario sin forma, host IP o con puerto, repo mal formado, cadena denegada corta', async () => {
    await sinEscribir('--dominio', `https://${DOMINIO}`);
    await sinEscribir('--dominio', `${DOMINIO}/x`);
    await sinEscribir('--destinatario', 'no-es-un-correo');
    await sinEscribir('--hosts', '10.0.0.5');
    await sinEscribir('--hosts', 'github.com:8443');
    await sinEscribir('--hosts', '');
    await sinEscribir('--repos', 'sin-barra');
    await sinEscribir('--repos', 'a/b/c');
    await sinEscribir('--denegar', 'ab');
  });
  it('sin proyecto, con proyecto mal formado o sin ningún campo pedido', async () => {
    const sin = spawnSync(process.execPath, [SCRIPT, ...BASE], { encoding: 'utf8', env: entornoDelEmulador(HOST) });
    expect(sin.status).toBe(2);
    expect(correr('--aplicar').codigo).toBe(2);
    const mal = spawnSync(process.execPath, [SCRIPT, '--proyecto', 'X', ...BASE, '--aplicar'], { encoding: 'utf8', env: entornoDelEmulador(HOST) });
    expect(mal.status).toBe(2);
  });
  it('un archivo que no se llama *.local.json (versionable) o con campos ajenos: se niega', async () => {
    const f = join(tmp, 'alertas.json');
    writeFileSync(f, JSON.stringify({ dominioAvisos: DOMINIO }));
    await sinEscribir('--archivo', f);
    const g = join(tmp, 'otra.local.json');
    writeFileSync(g, JSON.stringify({ dominioAvisos: DOMINIO, tenantId: 'x' }));
    await sinEscribir('--archivo', g);
  });
  it('sin $XDG_RUNTIME_DIR ni --respaldo no hay dónde dejar el respaldo: no escribe', async () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...BASE, '--aplicar'], { encoding: 'utf8', env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: '' }) });
    expect(r.status).toBe(2);
    expect((await doc()).exists).toBe(false);
  });
  it('un respaldo que ya existe no se pisa: no escribe', async () => {
    const respaldo = join(tmp, 'ya-existe.json');
    writeFileSync(respaldo, 'contenido-previo');
    const r = correr(...BASE, '--respaldo', respaldo, '--aplicar');
    expect(r.codigo).toBe(2);
    expect(leer(respaldo)).toBe('contenido-previo');
    expect((await doc()).exists).toBe(false);
  });
  it('--revertir con un respaldo ilegible o con campos ajenos se niega', async () => {
    const f = join(tmp, 'resp.json');
    writeFileSync(f, 'no-json');
    expect(correr('--revertir', f, '--aplicar').codigo).toBe(2);
    writeFileSync(f, JSON.stringify({ existia: true, datos: { tenantId: 'x' } }));
    expect(correr('--revertir', f, '--aplicar').codigo).toBe(2);
  });
  it('solo escribe plataforma/alertas: no crea ningún otro documento de plataforma', async () => {
    correr(...BASE, '--aplicar');
    const otros = await db.collection('plataforma').get();
    expect(otros.docs.map((d) => d.id)).toEqual(['alertas']);
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
