/**
 * `scripts/plataforma/ensayo.mjs --demo a|b` — DOS NÚMEROS DE ENSAYO A LA VEZ (Andres, 10/11/2026).
 *
 * Con `--demo b` el comercio del ensayo es `ensayo-b`; sin la opción (o con `--demo a`) es `ensayo`, como siempre.
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que impide que el ensayo del Demo B vacíe la
 * configuración del que corre en el Demo A (o al revés) son sus cerrojos. Se prueba como proceso contra el emulador,
 * y se escribe negando:
 *   - sin `--demo` nada toca `ensayo-b`; con `--demo b` nada toca `ensayo`;
 *   - olvidar `--demo b` con el Demo A en ensayo NO vacía `ensayo` (otro número ya está ahí);
 *   - una ruta en el ensayo de un demo no se prepara ni se restaura con el `--demo` del otro.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import { modulosDeFlujos } from '../functions/src/registro.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'plataforma', 'ensayo.mjs');
const VENTA = join(aqui, '..', 'scripts', 'datos', 'negocio-demo-venta-resto.json');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'ensayo-demo-b') ?? initializeApp({ projectId: PROYECTO }, 'ensayo-demo-b');
const db = getFirestore(app);

const DEMO_A = 'ensb-demo-a';
const DEMO_B = 'ensb-demo-b';
const NUM_A = '1000000081';
const NUM_B = '1000000082';
const TESTER = '59100000098';

const tmp = mkdtempSync(join(tmpdir(), 'ensayo-demo-b-'));
const LOCAL = join(tmp, 'CONFIGURACION.local.md');
writeFileSync(LOCAL, ['| Marcador | Valor | Nota |', '|---|---|---|',
  `| \`REEMPLAZAR_NUMERO_RECEPCION_ENSAYO\` | ${TESTER} | quien prueba |`, ''].join('\n'));

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const preparar = (numero: string, extra: string[] = []) => correr('--numero', numero, '--preparar',
  '--cliente', 'qtaco', '--archivo', VENTA, '--local', LOCAL, '--flujo', 'venta', ...extra);
const ruta = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get()).data() ?? {};
const existe = async (d: string) => (await db.doc(d).get()).exists;

async function limpiar() {
  for (const n of [NUM_A, NUM_B]) await db.doc(`rutasWhatsApp/${n}`).delete();
  for (const t of ['ensayo', 'ensayo-b', DEMO_A, DEMO_B]) await db.recursiveDelete(db.doc(`tenants/${t}`));
}

beforeAll(async () => {
  await limpiar();
  for (const [t, flujo] of [[DEMO_A, 'agendamiento'], [DEMO_B, 'venta']] as const) {
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', vertical: flujo, modulos: modulosDeFlujos([flujo] as never[]), plan: 'pro' });
    await db.doc(`tenants/${t}/cuenta/estado`).set({ plan: 'pro', modalidad: 'demostracion' });
  }
  await db.doc(`rutasWhatsApp/${NUM_A}`).set({ tenantId: DEMO_A, flujo: 'agendamiento', aliasSecreto: 'demoA', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_B}`).set({ tenantId: DEMO_B, flujo: 'venta', aliasSecreto: 'demoB', estado: 'activo' });
});
// Las rutas y los dos comercios de ensayo se van: la suite que sigue (`ensayo.test.ts`) no hereda un número desviado.
afterAll(async () => { await limpiar(); rmSync(tmp, { recursive: true, force: true }); });

describe('ensayo.mjs --demo', () => {
  it('un valor que no es a ni b sale con 2 sin leer nada', async () => {
    for (const malo of ['c', 'ab', '']) {
      const r = preparar(NUM_B, ['--demo', malo, '--aplicar']);
      expect(r.codigo, malo).toBe(2);
      expect(r.salida, malo).toMatch(/--demo es a o b/);
    }
    expect((await ruta(NUM_B))['tenantId']).toBe(DEMO_B);
  });

  it('SIN --demo todo queda como siempre: el comercio es `ensayo` y `ensayo-b` no se crea', async () => {
    const r = preparar(NUM_A, ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(await ruta(NUM_A)).toMatchObject({ tenantId: 'ensayo', ensayoDe: DEMO_A, ensayoCliente: 'qtaco' });
    expect(await existe('tenants/ensayo/config/negocio')).toBe(true);
    expect(await existe('tenants/ensayo-b')).toBe(false);
  });

  it('olvidar `--demo b` con el Demo A en ensayo NO vacía `ensayo`: otro número ya está ahí', async () => {
    await db.doc('tenants/ensayo/pedidos/del-ensayo-en-curso').set({ x: 1 });
    for (const extra of [['--aplicar'], ['--demo', 'a', '--aplicar']]) {
      const r = preparar(NUM_B, extra);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/Otro número .* ya está en el ensayo `ensayo`/);
      expect(r.salida).not.toContain(NUM_A);
    }
    expect(await ruta(NUM_B)).toMatchObject({ tenantId: DEMO_B, flujo: 'venta' });
    expect(await existe('tenants/ensayo/pedidos/del-ensayo-en-curso')).toBe(true);
    expect(await existe('tenants/ensayo/config/negocio')).toBe(true);
  });

  it('con `--demo b` el ensayo va a `ensayo-b` y el del Demo A (`ensayo`) no se toca; en seco no escribe', async () => {
    const seco = preparar(NUM_B, ['--demo', 'b']);
    expect(seco.codigo, seco.salida).toBe(0);
    expect(await existe('tenants/ensayo-b')).toBe(false);
    expect((await ruta(NUM_B))['tenantId']).toBe(DEMO_B);
    const antes = (await db.doc('tenants/ensayo/config/negocio').get()).data();
    const r = preparar(NUM_B, ['--demo', 'b', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(await ruta(NUM_B)).toMatchObject({ tenantId: 'ensayo-b', ensayoDe: DEMO_B, ensayoCliente: 'qtaco', flujo: 'venta' });
    expect((await db.doc('tenants/ensayo-b').get()).get('nombre')).toBe('Ensayo de NovuChat (Demo B)');
    expect((await db.doc('tenants/ensayo-b/cuenta/estado').get()).get('modalidad')).toBe('demostracion');
    expect(await existe('tenants/ensayo-b/config/negocio')).toBe(true);
    // El ensayo del Demo A sigue entero: su ruta, su configuración y lo que escribió.
    expect(await ruta(NUM_A)).toMatchObject({ tenantId: 'ensayo', ensayoDe: DEMO_A });
    expect((await db.doc('tenants/ensayo/config/negocio').get()).data()).toEqual(antes);
    expect(await existe('tenants/ensayo/pedidos/del-ensayo-en-curso')).toBe(true);
  });

  it('una ruta en el ensayo de un demo NO se prepara ni se restaura con el `--demo` del otro', async () => {
    for (const [numero, demo, mio] of [[NUM_A, 'b', 'ensayo'], [NUM_B, 'a', 'ensayo-b']] as const) {
      for (const modo of [['--restaurar', '--aplicar'], ['--preparar', '--cliente', 'qtaco', '--archivo', VENTA, '--local', LOCAL, '--flujo', 'venta', '--aplicar']]) {
        const r = correr('--numero', numero, '--demo', demo, ...modo);
        expect(r.codigo, `${numero} ${modo[0]}: ${r.salida}`).toBe(1);
        expect(r.salida).toMatch(/está en el ensayo del otro demo/);
        expect((await ruta(numero))['tenantId']).toBe(mio);
      }
    }
    // `--estado` con el --demo cambiado no dice «no»: dice dónde está.
    expect(correr('--numero', NUM_B, '--estado').salida).toMatch(/Desviada {2}: sí, pero en el ensayo del otro demo \(ensayo-b\)/);
    // Sin --demo, la del Demo B tampoco se restaura (el defecto es a).
    expect(correr('--numero', NUM_B, '--restaurar', '--aplicar').codigo).toBe(1);
    expect((await ruta(NUM_B))['tenantId']).toBe('ensayo-b');
  });

  it('el número del Demo A con `--demo b` se niega mientras el Demo B está en `ensayo-b`', async () => {
    // Se restaura el A para que el único motivo de la negativa sea el otro número en `ensayo-b`.
    expect(correr('--numero', NUM_A, '--restaurar', '--aplicar').codigo).toBe(0);
    await db.doc('tenants/ensayo-b/pedidos/del-ensayo-b').set({ x: 1 });
    const r = correr('--numero', NUM_A, '--demo', 'b', '--preparar', '--cliente', 'qtaco', '--archivo', VENTA, '--local', LOCAL, '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/Otro número .* ya está en el ensayo `ensayo-b`/);
    expect((await ruta(NUM_A))['tenantId']).toBe(DEMO_A);
    expect(await existe('tenants/ensayo-b/pedidos/del-ensayo-b')).toBe(true);
  });

  it('`--restaurar --demo b` devuelve la ruta SOLO a su comercio de origen y no toca `ensayo`', async () => {
    const r = correr('--numero', NUM_B, '--demo', 'b', '--restaurar', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const d = await ruta(NUM_B);
    expect(d).toMatchObject({ tenantId: DEMO_B, flujo: 'venta' });
    expect(d['ensayoDe']).toBeUndefined();
    expect(await existe('tenants/ensayo/config/negocio')).toBe(true);
    const estado = correr('--numero', NUM_B, '--demo', 'b', '--estado');
    expect(estado.salida).toMatch(/Desviada {2}: no/);
    expect(estado.salida).not.toContain(NUM_B);
  });

  it('el propio comercio de ensayo (cualquiera de los dos) no es un cliente', () => {
    for (const c of ['ensayo', 'ensayo-b']) {
      const r = correr('--numero', NUM_B, '--demo', 'b', '--preparar', '--cliente', c, '--archivo', VENTA, '--local', LOCAL);
      expect(r.codigo, c).toBe(2);
      expect(r.salida, c).toMatch(/no puede ser el propio ensayo/);
    }
  });
});
