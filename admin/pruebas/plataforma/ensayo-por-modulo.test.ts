/**
 * H2b-11 — `ensayo.mjs` decide si el comercio `ensayo` traía venta (y por tanto vacía sus restos de venta) por el
 * registro cuando la ficha está migrada: manda la lista `modulos`, no `flujos` ni `vertical`. Sin lista, lo de siempre.
 *
 * Solo en SECO contra el emulador (no escribe): se lee la línea «se vacían N documento(s)… (M de venta…)».
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'ensayo.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'ensayo-modulo') ?? initializeApp({ projectId: PROYECTO }, 'ensayo-modulo');
const db = getFirestore(app);

const NUMERO = '900000111';
const ORIGEN = 'demo-origen-ensayo';
const tmp = mkdtempSync(join(tmpdir(), 'ensayo-modulo-'));
afterAll(async () => {
  rmSync(tmp, { recursive: true, force: true });
  await db.doc(`rutasWhatsApp/${NUMERO}`).delete();
  await db.recursiveDelete(db.doc(`tenants/${ORIGEN}`));
  await db.recursiveDelete(db.doc('tenants/ensayo'));
});

const ARCHIVO = join(tmp, 'cliente.json');
beforeAll(async () => {
  writeFileSync(ARCHIVO, JSON.stringify({ negocio: { nombreNegocio: 'Cliente de prueba' } }));
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: ORIGEN, estado: 'activo', flujo: 'agendamiento' });
  await db.doc(`tenants/${ORIGEN}`).set({ nombre: ORIGEN, estado: 'activo' });
  await db.doc(`tenants/${ORIGEN}/cuenta/estado`).set({ modalidad: 'demostracion' });
}, 60_000);

/** Deja el comercio `ensayo` con la ficha dada y UN pedido, y corre `--preparar` en seco. */
async function seco(ficha: Record<string, unknown>) {
  await db.recursiveDelete(db.doc('tenants/ensayo'));
  await db.doc('tenants/ensayo').set({ nombre: 'Ensayo', estado: 'activo', ...ficha });
  await db.doc('tenants/ensayo/pedidos/p1').set({ x: 1 });
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--numero', NUMERO, '--preparar',
    '--cliente', 'cliente-x', '--archivo', ARCHIVO], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  const salida = `${r.stdout}${r.stderr}`;
  expect((await db.doc('tenants/ensayo/pedidos/p1').get()).exists, 'el seco no escribe').toBe(true);
  return { codigo: r.status, salida, venta: /\(\d+ de venta/.test(salida) };
}

describe('ensayo.mjs: los restos de venta se vacían siempre, sea cual sea la ficha del comercio ensayo', () => {
  it.each([
    ['migrada sin pedidos, con `flujos` venta', { vertical: 'venta', flujos: ['venta'], modulos: ['productos', 'campanas', 'cobros', 'agenda'] }],
    ['migrada con pedidos, con `flujos` agendamiento', { vertical: 'agendamiento', flujos: ['agendamiento'], modulos: ['productos', 'campanas', 'cobros', 'pedidos'] }],
    ['sin lista, de venta', { vertical: 'venta', flujos: ['venta'] }],
    ['sin lista, de agendamiento (un ensayo anterior pudo dejar pedidos)', { vertical: 'agendamiento', flujos: ['agendamiento'] }],
  ])('ficha %s: cuenta el pedido viejo y en seco no escribe', async (_n, ficha) => {
    const r = await seco(ficha);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida, r.salida).toMatch(/\(1 de venta/);
  }, 60_000);
});
