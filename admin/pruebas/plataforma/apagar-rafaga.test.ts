/**
 * `scripts/plataforma/apagar-rafaga.mjs`, CONTRA EL EMULADOR (proceso real).
 * Se escribe negando: simulacro no escribe, sin confirmación no escribe, comercio inexistente sale 1,
 * `--encender` borra el campo (no lo pone en false), nada más cambia y otros comercios no se tocan.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { analizar } from '../../scripts/plataforma/apagar-rafaga.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'apagar-rafaga.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'apagar-rafaga') ?? initializeApp({ projectId: PROYECTO }, 'apagar-rafaga');
const db = getFirestore(app);

const T = 'rafaga-uno';
const OTRO = 'rafaga-otro';
const FICHA = { nombre: 'Comercio de prueba', estado: 'activo', plan: 'pro', flujos: ['venta'] };

const correr = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
};
const ficha = async (t = T) => (await db.doc(`tenants/${t}`).get());
const auditorias = async (t = T) => (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'cambiar_rafaga').get()).size;

beforeEach(async () => {
  for (const t of [T, OTRO, 'rafaga-nunca']) {
    const a = await db.collection(`tenants/${t}/auditoria`).get();
    for (const d of a.docs) await d.ref.delete();
    await db.doc(`tenants/${t}`).delete();
  }
  await db.doc(`tenants/${T}`).set(FICHA);
  await db.doc(`tenants/${OTRO}`).set(FICHA);
});

describe('apagar-rafaga.mjs', () => {
  it('el simulacro dice «pondría» y no escribe', async () => {
    const r = correr('--tenant', T, '--apagar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('pondría');
    expect((await ficha()).data()).toEqual(FICHA);
    expect(await auditorias()).toBe(0);
  });

  it('--apagar --aplicar deja exactamente true y no toca otros campos', async () => {
    const r = correr('--tenant', T, '--apagar', '--aplicar');
    expect(r.codigo).toBe(0);
    expect((await ficha()).data()).toEqual({ ...FICHA, rafagaApagada: true });
    expect((await ficha()).get('rafagaApagada')).toBe(true);
    expect(await auditorias()).toBe(1);
  });

  it('--encender borra el campo (no lo pone en false)', async () => {
    await db.doc(`tenants/${T}`).update({ rafagaApagada: true });
    const r = correr('--tenant', T, '--encender', '--aplicar');
    expect(r.codigo).toBe(0);
    const d = (await ficha()).data() ?? {};
    expect(Object.prototype.hasOwnProperty.call(d, 'rafagaApagada')).toBe(false);
    expect(d).toEqual(FICHA);
  });

  it('el simulacro de --encender no borra', async () => {
    await db.doc(`tenants/${T}`).update({ rafagaApagada: true });
    const r = correr('--tenant', T, '--encender');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('quitaría');
    expect((await ficha()).get('rafagaApagada')).toBe(true);
  });

  it('es idempotente: la segunda corrida no escribe ni audita', async () => {
    correr('--tenant', T, '--apagar', '--aplicar');
    const r = correr('--tenant', T, '--apagar', '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Nada que hacer');
    expect(await auditorias()).toBe(1);
    correr('--tenant', T, '--encender', '--aplicar');
    const r2 = correr('--tenant', T, '--encender', '--aplicar');
    expect(r2.salida).toContain('Nada que hacer');
    expect(await auditorias()).toBe(2);
  });

  it('un valor distinto de true (false) cuenta como no apagado y --apagar lo deja en true', async () => {
    await db.doc(`tenants/${T}`).update({ rafagaApagada: false });
    expect(correr('--tenant', T, '--apagar', '--aplicar').codigo).toBe(0);
    expect((await ficha()).get('rafagaApagada')).toBe(true);
  });

  it('un comercio inexistente sale 1 y no crea nada', async () => {
    const r = correr('--tenant', 'rafaga-nunca', '--apagar', '--aplicar');
    expect(r.codigo).toBe(1);
    expect((await ficha('rafaga-nunca')).exists).toBe(false);
  });

  it('no toca a otros comercios', async () => {
    correr('--tenant', T, '--apagar', '--aplicar');
    expect((await ficha(OTRO)).data()).toEqual(FICHA);
  });

  it('ids inválidos, sin modo o con los dos modos: sale 2 y no escribe', async () => {
    for (const args of [
      ['--tenant', 'Mayus', '--apagar', '--aplicar'], ['--tenant', 'a', '--apagar', '--aplicar'],
      ['--tenant', 'uno,dos', '--apagar', '--aplicar'], ['--tenant', 'ab_c', '--apagar'],
      ['--tenant', T, '--aplicar'], ['--tenant', T, '--apagar', '--encender', '--aplicar'],
      ['--apagar', '--aplicar'], ['--tenant', T, '--apagar', '--todos'],
    ]) expect(correr(...args).codigo, args.join(' ')).toBe(2);
    expect((await ficha()).data()).toEqual(FICHA);
  });
});

describe('apagar-rafaga.mjs: salvaguarda de producción (análisis de argumentos, sin tocar Firestore)', () => {
  const base = ['--proyecto', 'proyecto-real-x1', '--tenant', T, '--apagar'];
  it('--aplicar sin --confirmo-produccion se rechaza', () => {
    const r = analizar([...base, '--aplicar']);
    expect(r.ok).toBe(false);
    expect(r.problemas.join(' ')).toContain('--confirmo-produccion');
  });
  it('--confirmo-produccion que no coincide se rechaza', () => {
    expect(analizar([...base, '--aplicar', '--confirmo-produccion', OTRO]).ok).toBe(false);
  });
  it('con la confirmación igual al tenant pasa; el simulacro no la exige', () => {
    expect(analizar([...base, '--aplicar', '--confirmo-produccion', T]).ok).toBe(true);
    expect(analizar(base).ok).toBe(true);
  });
});
