/**
 * `scripts/asignar-plan.mjs`, CONTRA EL EMULADOR.
 *
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que
 * impide asignar un plan inventado o pisar la mensualidad de un comercio es su
 * propia validación. Por eso se prueba ejecutándolo de verdad, como proceso,
 * contra el emulador que levanta `pruebas/correr.sh`, y se escribe negando.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOGO_PLANES, limitesDe } from '../functions/src/planes.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'asignar-plan.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'asignar-plan') ?? initializeApp({ projectId: PROYECTO }, 'asignar-plan');
const db = getFirestore(app);

// Identificadores propios de esta suite, para no pisar a ninguna otra.
const T = 'plan-demo';
const BAJA = 'plan-baja';
const SIN_CUENTA = 'plan-sin-cuenta';

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const cuenta = async (t = T) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const auditorias = async (t = T) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'cambiar_plan').get()).size;

beforeAll(async () => {
  for (const t of [T, BAJA, SIN_CUENTA]) {
    const previas = await db.collection(`tenants/${t}/auditoria`).get();
    for (const d of previas.docs) await d.ref.delete();
    await db.doc(`tenants/${t}/cuenta/estado`).delete();
  }
  // Un demo como los de hoy: plan viejo, sin copia de límites, con umbrales y
  // estado de pago cargados que el script NO debe tocar.
  await db.doc(`tenants/${T}`).set({ nombre: 'Demo', estado: 'activo', plan: 'basico', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({
    plan: 'basico', estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'BOB',
    motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
  });
  await db.doc(`tenants/${BAJA}`).set({ nombre: 'Se fue', estado: 'dado_de_baja', plan: 'basico' });
  await db.doc(`tenants/${SIN_CUENTA}`).set({ nombre: 'Nuevo', estado: 'activo', plan: 'basico' });
});

describe('asignar-plan.mjs', () => {
  it('sin los argumentos no hace nada', () => {
    const r = correr('--tenant', T);
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/--plan desconocido/);
  });

  it('NO acepta un plan que no está en el catálogo, ni el viejo «basico»', async () => {
    for (const plan of ['basico', 'premium', 'Pro', 'toString']) {
      const r = correr('--tenant', T, '--plan', plan, '--aplicar');
      expect(r.codigo, plan).toBe(2);
      expect(r.salida).toMatch(/Del catálogo: impulso, crecimiento, pro, demostracion/);
    }
    expect((await cuenta()).plan).toBe('basico');
  });

  it('en seco no escribe nada, y muestra el antes y el después', async () => {
    const r = correr('--tenant', T, '--plan', 'demostracion');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/Antes {5}: plan basico/);
    expect(r.salida).toMatch(/500 conversaciones · 500 productos · 10 agendas/);
    expect((await cuenta()).plan).toBe('basico');
    expect(await auditorias()).toBe(0);
  });

  it('con --aplicar escribe plan, copia de límites, catálogo, espejo y auditoría', async () => {
    const r = correr('--tenant', T, '--plan', 'demostracion', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación/);
    const c = await cuenta();
    expect(c).toMatchObject({
      plan: 'demostracion', limites: limitesDe('demostracion'), catalogoPlanes: CATALOGO_PLANES,
    });
    expect((await db.doc(`tenants/${T}`).get()).get('plan')).toBe('demostracion');
    const a = await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'cambiar_plan').get();
    expect(a.size).toBe(1);
    expect(a.docs[0]?.data()).toMatchObject({
      uid: 'asignar-plan', planAntes: 'basico', planDespues: 'demostracion',
      limitesAntes: null, limitesDespues: limitesDe('demostracion'),
    });
  });

  it('NO toca el estado de pago, la mensualidad, la moneda, el motivo ni los umbrales', async () => {
    expect(await cuenta()).toMatchObject({
      estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'BOB',
      motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
    });
  });

  it('repetirlo no escribe nada ni deja otra auditoría', async () => {
    const r = correr('--tenant', T, '--plan', 'demostracion', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Sin cambios/);
    expect(await auditorias()).toBe(1);
  });

  it('cambiar de plan reemplaza la copia entera y audita el antes', async () => {
    const r = correr('--tenant', T, '--plan', 'crecimiento', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await cuenta()).limites).toEqual(limitesDe('crecimiento'));
    const a = await db.collection(`tenants/${T}/auditoria`).where('planDespues', '==', 'crecimiento').get();
    expect(a.docs[0]?.data()).toMatchObject({ planAntes: 'demostracion', limitesAntes: limitesDe('demostracion') });
  });

  it('crea la cuenta si el comercio no la tenía', async () => {
    const r = correr('--tenant', SIN_CUENTA, '--plan', 'impulso', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta(SIN_CUENTA)).toMatchObject({ plan: 'impulso', limites: limitesDe('impulso') });
  });

  it('NO asigna plan a un comercio que no existe', () => {
    const r = correr('--tenant', 'plan-no-existe', '--plan', 'pro', '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/No existe el comercio/);
  });

  it('NO asigna plan a un comercio dado de baja', async () => {
    const r = correr('--tenant', BAJA, '--plan', 'pro', '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/dado de baja/);
    expect((await db.doc(`tenants/${BAJA}/cuenta/estado`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${BAJA}`).get()).get('plan')).toBe('basico');
  });

  it('un rechazo NO deja documentos bloqueados: escribirlos enseguida no espera', async () => {
    // Si el script lanzara dentro de la transacción y terminara, el rollback
    // (que el SDK no espera) no llegaría y el emulador retendría el bloqueo de
    // la ficha y la cuenta hasta que venza (~60 s). Se mide el tiempo de una
    // escritura sobre esos mismos documentos justo después del rechazo.
    expect(correr('--tenant', BAJA, '--plan', 'pro', '--aplicar').codigo).toBe(1);
    const t0 = Date.now();
    await db.doc(`tenants/${BAJA}`).update({ tocadoPorLaPrueba: true });
    await db.doc(`tenants/${BAJA}/cuenta/estado`).set({ tocadoPorLaPrueba: true });
    await db.doc(`tenants/${BAJA}/cuenta/estado`).delete();
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 15_000);
});
