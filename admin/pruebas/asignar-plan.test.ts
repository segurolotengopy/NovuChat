/**
 * `scripts/asignar-plan.mjs`, CONTRA EL EMULADOR.
 *
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que
 * impide asignar un plan inventado, pisar la mensualidad de un comercio o
 * cambiar la titularidad de un número ajeno es su propia validación. Por eso
 * se prueba ejecutándolo de verdad, como proceso, contra el emulador que
 * levanta `pruebas/correr.sh`, y se escribe negando.
 *
 * Desde F1 (`Analisis/41` §4) el script escribe los tres ejes más el modelo y
 * los umbrales; el plan sigue siendo lo primero que se prueba, y
 * `demostracion` YA NO ES UN PLAN: un demo es `--plan <del catálogo>
 * --modalidad demostracion`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOGO_PLANES, limitesDe } from '../functions/src/planes.ts';
import { PRUEBA, mesBolivia } from '../functions/src/prepago.ts';

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
const OTRO = 'plan-otro';
const NUM_T = '1000000071';
const NUM_OTRO = '1000000072';
const NUM_SIN_RUTA = '1000000073';

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const cuenta = async (t = T) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const ficha = async (t = T) => (await db.doc(`tenants/${t}`).get()).data() ?? {};
const ruta = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get()).data() ?? {};
const auditorias = async (accion: string, t = T) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

beforeAll(async () => {
  for (const t of [T, BAJA, SIN_CUENTA, OTRO]) {
    const previas = await db.collection(`tenants/${t}/auditoria`).get();
    for (const d of previas.docs) await d.ref.delete();
    await db.doc(`tenants/${t}/cuenta/estado`).delete();
  }
  // Un demo como los de hoy: plan viejo, sin copia de límites, sin modalidad,
  // con umbrales y estado de pago cargados que el script NO debe tocar.
  await db.doc(`tenants/${T}`).set({ nombre: 'Demo', estado: 'activo', plan: 'basico', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({
    plan: 'basico', estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'BOB',
    motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
  });
  await db.doc(`tenants/${BAJA}`).set({ nombre: 'Se fue', estado: 'dado_de_baja', plan: 'basico' });
  await db.doc(`tenants/${SIN_CUENTA}`).set({ nombre: 'Nuevo', estado: 'activo', plan: 'basico' });
  await db.doc(`tenants/${OTRO}`).set({ nombre: 'Otro', estado: 'activo', plan: 'pro' });
  await db.doc(`rutasWhatsApp/${NUM_T}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'demoB', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_OTRO}`).set({ tenantId: OTRO, flujo: 'venta', aliasSecreto: 'cliente50', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_SIN_RUTA}`).delete();
});

describe('asignar-plan.mjs: el plan', () => {
  it('sin ningún eje no hace nada', () => {
    const r = correr('--tenant', T);
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/nada que asignar/);
  });

  it('NO acepta un plan que no está en el catálogo: ni el viejo «basico» ni el viejo «demostracion»', async () => {
    for (const plan of ['basico', 'premium', 'Pro', 'toString', 'demostracion']) {
      const r = correr('--tenant', T, '--plan', plan, '--aplicar');
      expect(r.codigo, plan).toBe(2);
      expect(r.salida).toMatch(/Del catálogo: impulso, crecimiento, pro, byoc$/m);
    }
    expect((await cuenta()).plan).toBe('basico');
  });

  it('en seco no escribe nada, y muestra el antes y el después', async () => {
    const r = correr('--tenant', T, '--plan', 'pro');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/Antes {5}: plan basico/);
    expect(r.salida).toMatch(/500 conversaciones · 500 productos · 10 agendas · 2 cambios\/mes/);
    expect((await cuenta()).plan).toBe('basico');
    expect(await auditorias('cambiar_plan')).toHaveLength(0);
  });

  it('con --aplicar escribe plan, copia de límites (con cambiosIncluidos), catálogo, espejo y auditoría', async () => {
    const r = correr('--tenant', T, '--plan', 'pro', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación/);
    expect(await cuenta()).toMatchObject({ plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES });
    expect((await ficha()).plan).toBe('pro');
    const a = await auditorias('cambiar_plan');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      uid: 'asignar-plan', planAntes: 'basico', planDespues: 'pro', limitesAntes: null, limitesDespues: limitesDe('pro'),
    });
  });

  it('NO toca el estado de pago, la mensualidad, la moneda, el motivo ni los umbrales de una cuenta SIN modalidad (LOW 8)', async () => {
    expect(await cuenta()).toMatchObject({
      estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'BOB',
      motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
    });
  });

  it('repetirlo no escribe nada ni deja otra auditoría', async () => {
    const r = correr('--tenant', T, '--plan', 'pro', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Sin cambios/);
    expect(await auditorias('cambiar_plan')).toHaveLength(1);
  });

  it('cambiar de plan reemplaza la copia entera y audita el antes', async () => {
    const r = correr('--tenant', T, '--plan', 'crecimiento', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await cuenta()).limites).toEqual(limitesDe('crecimiento'));
    const a = (await auditorias('cambiar_plan')).find((x) => x['planDespues'] === 'crecimiento');
    expect(a).toMatchObject({ planAntes: 'pro', limitesAntes: limitesDe('pro') });
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

describe('asignar-plan.mjs: los otros ejes (F1)', () => {
  it('--modalidad demostracion convierte al demo: sin cargo, monto cero, USD; con auditoría estado_cuenta', async () => {
    const r = correr('--tenant', T, '--modalidad', 'demostracion', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Derivados : \{"estadoPago":"sin_cargo","montoMensual":0,"moneda":"USD"\}/);
    expect(await cuenta()).toMatchObject({
      plan: 'crecimiento', modalidad: 'demostracion', estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'USD',
      motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
    });
    const [a] = await auditorias('estado_cuenta');
    expect(a).toMatchObject({ uid: 'asignar-plan', campos: ['modalidad'], valores: { modalidad: 'demostracion' } });
  });

  it('--modalidad fuera de la lista no entra; --modalidad prueba inicializa el mes y la bolsa', async () => {
    const mala = correr('--tenant', T, '--modalidad', 'gratis', '--aplicar');
    expect(mala.codigo).toBe(2);
    expect(mala.salida).toMatch(/--modalidad desconocida/);
    const r = correr('--tenant', SIN_CUENTA, '--modalidad', 'prueba', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta(SIN_CUENTA)).toMatchObject({
      modalidad: 'prueba', periodoPrueba: mesBolivia(Date.now()), bolsaPrueba: PRUEBA.conversaciones, montoMensual: 0,
    });
  });

  it('--modelo escribe la ficha, con la auditoría asignar_ejes; uno fuera de la lista, no', async () => {
    const mal = correr('--tenant', T, '--modelo', 'gemini', '--aplicar');
    expect(mal.codigo).toBe(2);
    expect(mal.salida).toMatch(/--modelo desconocido/);
    expect((await ficha()).modelo).toBeUndefined();
    const r = correr('--tenant', T, '--modelo', 'claude-haiku-4-5', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await ficha()).modelo).toBe('claude-haiku-4-5');
    const [a] = await auditorias('asignar_ejes');
    expect(a).toMatchObject({ modeloAntes: 'gemini-3.5-flash-lite', modeloDespues: 'claude-haiku-4-5' });
    // No toca la cuenta.
    expect((await cuenta()).modalidad).toBe('demostracion');
  });

  it('--titularidad exige --numero, el número tiene que tener ruta y ser de ESTE comercio', async () => {
    expect(correr('--tenant', T, '--titularidad', 'comercio', '--aplicar').codigo).toBe(2);
    expect(correr('--tenant', T, '--numero', NUM_T, '--aplicar').codigo).toBe(2);
    expect(correr('--tenant', T, '--titularidad', 'byoc', '--numero', NUM_T, '--aplicar').codigo).toBe(2);
    const ajeno = correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_OTRO, '--aplicar');
    expect(ajeno.codigo).toBe(1);
    expect(ajeno.salida).toMatch(/es de OTRO comercio/);
    expect((await ruta(NUM_OTRO))['titularidad']).toBeUndefined();
    const sinRuta = correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_SIN_RUTA, '--aplicar');
    expect(sinRuta.codigo).toBe(1);
    expect(sinRuta.salida).toMatch(/no tiene ruta/);
  });

  it('--titularidad comercio escribe la ruta, sin mostrar el número completo, y audita', async () => {
    const r = correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_T, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).not.toContain(NUM_T);
    expect(r.salida).toMatch(/…0071 → titularidad comercio/);
    expect(await ruta(NUM_T)).toMatchObject({ titularidad: 'comercio', titularidadPor: 'asignar-plan', tenantId: T });
    const a = (await auditorias('asignar_ejes')).find((x) => x['phoneNumberId'] === NUM_T);
    expect(a).toMatchObject({ titularidadAntes: 'novuchat', titularidadDespues: 'comercio' });
    // Repetir: sin cambios.
    expect(correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_T, '--aplicar').salida).toMatch(/Sin cambios/);
  });

  it('los umbrales se validan como en atencion.ts: bloqueo mayor que operador, o nada', async () => {
    const mal = correr('--tenant', T, '--umbral-operador', '5', '--umbral-bloqueo', '3', '--aplicar');
    expect(mal.codigo).toBe(1);
    expect(mal.salida).toMatch(/mayor que el de operador/);
    expect(await cuenta()).toMatchObject({ umbralOperador: 3, umbralBloqueo: 5 });
    expect(correr('--tenant', T, '--umbral-operador', 'x', '--aplicar').codigo).toBe(2);
    const r = correr('--tenant', T, '--umbral-operador', '10', '--umbral-bloqueo', '20', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta()).toMatchObject({ umbralOperador: 10, umbralBloqueo: 20 });
  });

  it('todo junto, en una sola corrida, en seco y aplicado', async () => {
    const seco = correr('--tenant', SIN_CUENTA, '--plan', 'byoc', '--modalidad', 'prepago', '--modelo', 'claude-sonnet-5');
    expect(seco.codigo, seco.salida).toBe(0);
    expect(seco.salida).toMatch(/Seco/);
    expect((await cuenta(SIN_CUENTA)).plan).toBe('impulso');
    const r = correr('--tenant', SIN_CUENTA, '--plan', 'byoc', '--modalidad', 'prepago', '--modelo', 'claude-sonnet-5', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta(SIN_CUENTA)).toMatchObject({
      plan: 'byoc', limites: limitesDe('byoc'), modalidad: 'prepago', estadoPago: 'vencido', montoMensual: 50,
    });
    expect(await ficha(SIN_CUENTA)).toMatchObject({ plan: 'byoc', modelo: 'claude-sonnet-5' });
  });
});
