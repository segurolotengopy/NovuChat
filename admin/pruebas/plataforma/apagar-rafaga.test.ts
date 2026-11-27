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

  it('un comercio dado de baja sale 1 y no se le escribe ni audita', async () => {
    await db.doc(`tenants/${T}`).update({ estado: 'dado_de_baja' });
    const r = correr('--tenant', T, '--apagar', '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('no está activo ni suspendido');
    expect((await ficha()).get('rafagaApagada')).toBeUndefined();
    expect(await auditorias()).toBe(0);
  });

  it('un comercio inexistente no deja auditoría', async () => {
    correr('--tenant', 'rafaga-nunca', '--apagar', '--aplicar');
    expect((await db.collection('tenants/rafaga-nunca/auditoria').get()).size).toBe(0);
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
  // Ids armados al vuelo; ninguno es un proyecto real.
  const STG = 'proyecto-stg-x1';
  const PRD = 'proyecto-prd-x1';
  const ENV = { GCP_PROJECT_ID_STAGING: STG, GCP_PROJECT_ID_PROD: PRD };
  const con = (proyecto: string, ...mas: string[]) => ['--proyecto', proyecto, '--tenant', T, '--apagar', ...mas];

  it('producción y staging: --aplicar sin --confirmo-produccion se rechaza; con el tenant igual pasa; el simulacro no la exige', () => {
    for (const p of [PRD, STG]) {
      const r = analizar(con(p, '--aplicar'), ENV);
      expect(r.ok).toBe(false);
      expect(r.problemas.join(' ')).toContain('--confirmo-produccion');
      expect(analizar(con(p, '--aplicar', '--confirmo-produccion', T), ENV).ok).toBe(true);
      expect(analizar(con(p), ENV).ok).toBe(true);
    }
    expect(analizar(con(PRD), ENV).cfg.entorno).toBe('produccion');
    expect(analizar(con(STG), ENV).cfg.entorno).toBe('staging');
  });
  it('--confirmo-produccion que no coincide o vacío se rechaza, en cualquier orden de argumentos', () => {
    expect(analizar(con(PRD, '--aplicar', '--confirmo-produccion', OTRO), ENV).ok).toBe(false);
    expect(analizar(con(PRD, '--aplicar', '--confirmo-produccion', ''), ENV).ok).toBe(false);
    expect(analizar(['--confirmo-produccion', '', '--aplicar', ...con(PRD)], ENV).ok).toBe(false);
    expect(analizar(['--aplicar', '--apagar', '--tenant', T, '--proyecto', PRD], ENV).ok).toBe(false);
    expect(analizar(['--tenant', T, '--aplicar', '--proyecto', PRD, '--apagar', '--confirmo-produccion', OTRO], ENV).ok).toBe(false);
  });
  it('un proyecto real que no es de la lista blanca, o sin lista blanca, se rechaza', () => {
    expect(analizar(con('proyecto-otro-x1', '--aplicar', '--confirmo-produccion', T), ENV).ok).toBe(false);
    expect(analizar(con(PRD, '--aplicar', '--confirmo-produccion', T), {}).ok).toBe(false);
    expect(analizar(con(PRD, '--aplicar', '--confirmo-produccion', T), { ...ENV, GCP_PROJECT_ID_STAGING: PRD }).ok).toBe(false);
  });
  it('un proyecto real con FIRESTORE_EMULATOR_HOST sobrante se rechaza (no escribe en el emulador con el nombre de uno real)', () => {
    for (const extra of [{ FIRESTORE_EMULATOR_HOST: HOST }, { FIRESTORE_EMULATOR_HOST: '' }, { FIREBASE_AUTH_EMULATOR_HOST: HOST }]) {
      const r = analizar(con(PRD, '--aplicar', '--confirmo-produccion', T), { ...ENV, ...extra });
      expect(r.ok).toBe(false);
      expect(r.problemas.join(' ')).toContain('ambiguo');
    }
  });
  it('demo-*: solo con el host local; ids demo con forma rara se rechazan; la confirmación no se usa contra el emulador', () => {
    const demo = con(PROYECTO, '--aplicar');
    expect(analizar(demo, {}).ok).toBe(false);
    expect(analizar(demo, { FIRESTORE_EMULATOR_HOST: 'ejemplo.com:80' }).ok).toBe(false);
    expect(analizar(demo, { FIRESTORE_EMULATOR_HOST: HOST }).ok).toBe(true);
    expect(analizar(demo, { FIRESTORE_EMULATOR_HOST: HOST }).cfg.entorno).toBe('emulador');
    expect(analizar(con('demo-X Y', '--aplicar'), { FIRESTORE_EMULATOR_HOST: HOST }).ok).toBe(false);
    expect(analizar([...demo, '--confirmo-produccion', T], { FIRESTORE_EMULATOR_HOST: HOST }).ok).toBe(false);
  });
  it('un id de comercio con «/» o «..» se rechaza', () => {
    for (const t of ['a/b', '../x', 'abc/auditoria/x']) {
      expect(analizar(['--proyecto', PROYECTO, '--tenant', t, '--apagar'], { FIRESTORE_EMULATOR_HOST: HOST }).ok, t).toBe(false);
    }
  });
});

describe('apagar-rafaga.mjs: estado del comercio, auditoría y atomicidad', () => {
  it('solo activo y suspendido: dado de baja, ausente, null o raro salen 1 sin escribir ni auditar', async () => {
    const sinEstado: Record<string, unknown> = { ...FICHA };
    delete sinEstado['estado'];
    for (const f of [{ ...FICHA, estado: 'dado_de_baja' }, sinEstado, { ...FICHA, estado: null }, { ...FICHA, estado: 'raro' }]) {
      await db.doc(`tenants/${T}`).set(f);
      const r = correr('--tenant', T, '--apagar', '--aplicar');
      expect(r.codigo, JSON.stringify(f.estado)).toBe(1);
      expect((await ficha()).data()).toEqual(f);
      expect(await auditorias()).toBe(0);
    }
  });
  it('un comercio suspendido sí se puede apagar', async () => {
    await db.doc(`tenants/${T}`).update({ estado: 'suspendido' });
    expect(correr('--tenant', T, '--apagar', '--aplicar').codigo).toBe(0);
    expect((await ficha()).get('rafagaApagada')).toBe(true);
  });
  it('el contenido de la auditoría: acción, uid del script, hora del servidor, antes y después', async () => {
    correr('--tenant', T, '--apagar', '--aplicar');
    correr('--tenant', T, '--encender', '--aplicar');
    const docs = (await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'cambiar_rafaga').get()).docs.map((d) => d.data());
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d['uid']).toBe('apagar-rafaga');
      expect(typeof d['en'].toDate).toBe('function');
      expect(Object.keys(d).sort()).toEqual(['accion', 'antes', 'despues', 'en', 'uid']);
    }
    expect(docs.find((d) => d['despues'] === true)?.['antes']).toBeNull();
    expect(docs.find((d) => d['despues'] === null)?.['antes']).toBe(true);
  });
  it('atomicidad: si la auditoría falla, la bandera no queda escrita', async () => {
    const { ejecutar } = await import('../../scripts/plataforma/apagar-rafaga.mjs');
    const { FieldValue } = await import('firebase-admin/firestore');
    const dbRota = {
      doc: (p: string) => db.doc(p),
      collection: (p: string) => db.collection(p),
      runTransaction: (fn: (tx: unknown) => Promise<void>) => db.runTransaction((tx) => fn({
        get: (r: never) => tx.get(r),
        update: (...a: [never, never]) => tx.update(...a),
        create: () => { throw new Error('falla simulada'); },
      })),
    };
    await expect(ejecutar({ proyecto: PROYECTO, tenant: T, apagar: true, aplicar: true, entorno: 'emulador' },
      { db: dbRota, FieldValue, log: () => {} })).rejects.toThrow('falla simulada');
    expect((await ficha()).data()).toEqual(FICHA);
    expect(await auditorias()).toBe(0);
  });
});
