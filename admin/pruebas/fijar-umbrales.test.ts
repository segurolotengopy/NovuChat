/**
 * `scripts/fijar-umbrales.mjs`, CONTRA EL EMULADOR.
 *
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que
 * impide dejar a un comercio con una pareja de umbrales que el servidor
 * descarta (bloqueo ≤ operador, un cero de más) es su propia validación, que
 * tiene que ser LA MISMA de `atencion.ts`. Por eso se prueba ejecutándolo de
 * verdad, como proceso, contra el emulador de `pruebas/correr.sh`, y se
 * escribe negando: lo que no debe escribir, no escribe.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UMBRALES_ATENCION, umbralesDeAtencion } from '../functions/src/atencion.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'fijar-umbrales.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'fijar-umbrales') ?? initializeApp({ projectId: PROYECTO }, 'fijar-umbrales');
const db = getFirestore(app);

// Identificadores propios de esta suite, para no pisar a ninguna otra.
const T = 'umbrales-demo';
const BAJA = 'umbrales-baja';
const SIN_CUENTA = 'umbrales-sin-cuenta';

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const cuenta = async (t = T) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const auditorias = async (t = T) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'cambiar_umbrales').get()).size;

const CUENTA_INICIAL = {
  plan: 'pro', estadoPago: 'al_dia', montoMensual: 120, moneda: 'USD',
  limites: { conversaciones: 500, productos: 500, agendas: 10 },
  motivoVisible: 'Cliente real',
};

beforeAll(async () => {
  for (const t of [T, BAJA, SIN_CUENTA]) {
    const previas = await db.collection(`tenants/${t}/auditoria`).get();
    for (const d of previas.docs) await d.ref.delete();
    await db.doc(`tenants/${t}/cuenta/estado`).delete();
  }
  // Un cliente real, con plan y mensualidad que el script NO debe tocar, y
  // sin umbrales cargados: rigen los de respaldo.
  await db.doc(`tenants/${T}`).set({ nombre: 'Clínica', estado: 'activo', plan: 'pro', flujos: ['agendamiento'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set(CUENTA_INICIAL);
  await db.doc(`tenants/${BAJA}`).set({ nombre: 'Se fue', estado: 'dado_de_baja', plan: 'pro' });
  await db.doc(`tenants/${BAJA}/cuenta/estado`).set(CUENTA_INICIAL);
  await db.doc(`tenants/${SIN_CUENTA}`).set({ nombre: 'Nuevo', estado: 'activo', plan: 'pro' });
});

describe('fijar-umbrales.mjs', () => {
  it('sin los dos umbrales, o con --restaurar mezclado, no hace nada', async () => {
    for (const args of [
      ['--tenant', T],
      ['--tenant', T, '--operador', '3'],
      ['--tenant', T, '--bloqueo', '5'],
      ['--tenant', T, '--restaurar', '--operador', '3'],
      ['--operador', '3', '--bloqueo', '5'],
    ]) {
      const r = correr(...args, '--aplicar');
      expect(r.codigo, args.join(' ')).toBe(2);
    }
    expect((await cuenta()).umbralOperador).toBeUndefined();
    expect(await auditorias()).toBe(0);
  });

  it('NO acepta una pareja que el servidor descartaría: bloqueo ≤ operador, cero, fuera de rango, no entero', async () => {
    for (const [op, bl] of [['5', '3'], ['5', '5'], ['0', '5'], ['3', '501'], ['3.5', '5'], ['-3', '5'], ['abc', '5']]) {
      const r = correr('--tenant', T, '--operador', op, '--bloqueo', bl, '--aplicar');
      expect(r.codigo, `${op}/${bl}`).toBe(2);
      expect(r.salida).toMatch(/entero entre 1 y 500|mayor que el de operador/);
    }
    const c = await cuenta();
    expect(c.umbralOperador).toBeUndefined();
    expect(c.umbralBloqueo).toBeUndefined();
    expect(umbralesDeAtencion(c)).toMatchObject({ ...UMBRALES_ATENCION, origen: 'estandar' });
    expect(await auditorias()).toBe(0);
  });

  it('en seco no escribe nada, y muestra el antes y el después', async () => {
    const r = correr('--tenant', T, '--operador', '3', '--bloqueo', '5');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/Antes {5}: operador 50 · bloqueo 100 \(de respaldo\)/);
    expect(r.salida).toMatch(/Después {3}: operador 3 · bloqueo 5 \(de la cuenta\)/);
    expect((await cuenta()).umbralOperador).toBeUndefined();
    expect(await auditorias()).toBe(0);
  });

  it('con --aplicar escribe la pareja, deja auditoría y no toca el resto de la cuenta', async () => {
    const r = correr('--tenant', T, '--operador', '3', '--bloqueo', '5', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Relectura : operador 3 · bloqueo 5 \(de la cuenta\) ✓/);
    const c = await cuenta();
    expect(c.umbralOperador).toBe(3);
    expect(c.umbralBloqueo).toBe(5);
    expect(umbralesDeAtencion(c)).toEqual({ operador: 3, bloqueo: 5, origen: 'cuenta' });
    // Lo que no se pidió, intacto.
    expect(c.plan).toBe('pro');
    expect(c.montoMensual).toBe(120);
    expect(c.moneda).toBe('USD');
    expect(c.limites).toEqual(CUENTA_INICIAL.limites);
    expect(c.estadoPago).toBe('al_dia');
    expect(await auditorias()).toBe(1);
    const a = (await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'cambiar_umbrales').get()).docs[0]!.data();
    expect(a.umbralesAntes).toEqual({ umbralOperador: null, umbralBloqueo: null });
    expect(a.umbralesDespues).toEqual({ umbralOperador: 3, umbralBloqueo: 5 });
  });

  it('volver a pedir lo mismo no escribe ni deja auditoría', async () => {
    const r = correr('--tenant', T, '--operador', '3', '--bloqueo', '5', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Sin cambios/);
    expect(await auditorias()).toBe(1);
  });

  it('--restaurar borra los dos campos y vuelven a regir 50 / 100', async () => {
    const seco = correr('--tenant', T, '--restaurar');
    expect(seco.codigo, seco.salida).toBe(0);
    expect(seco.salida).toMatch(/Seco/);
    expect((await cuenta()).umbralOperador).toBe(3);

    const r = correr('--tenant', T, '--restaurar', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Relectura : operador 50 · bloqueo 100 \(de respaldo\) ✓/);
    const c = await cuenta();
    expect(c.umbralOperador).toBeUndefined();
    expect(c.umbralBloqueo).toBeUndefined();
    expect(c.plan).toBe('pro');
    expect(await auditorias()).toBe(2);

    const otra = correr('--tenant', T, '--restaurar', '--aplicar');
    expect(otra.salida).toMatch(/Sin cambios/);
    expect(await auditorias()).toBe(2);
  });

  it('NO escribe en un comercio dado de baja, sin cuenta o inexistente', async () => {
    for (const t of [BAJA, SIN_CUENTA, 'umbrales-no-existe']) {
      const r = correr('--tenant', t, '--operador', '3', '--bloqueo', '5', '--aplicar');
      expect(r.codigo, t).toBe(1);
      expect(await auditorias(t)).toBe(0);
    }
    expect((await cuenta(BAJA)).umbralOperador).toBeUndefined();
    expect((await cuenta(SIN_CUENTA)).umbralOperador).toBeUndefined();
  });
});
