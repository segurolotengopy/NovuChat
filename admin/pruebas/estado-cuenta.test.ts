/**
 * `actualizarEstadoCuenta` (functions/src/index.ts), LA CALLABLE REAL, contra
 * el emulador de Firestore.
 *
 * Hasta el 15/09 ninguna callable tenía pruebas (`Analisis/29` §3.4), y esta
 * PISABA el plan, la mensualidad y el motivo en cada llamada (§2.4). Se invoca
 * con `.run()`, que es la misma función que despliega Firebase, con un contexto
 * de autenticación fabricado. Se escribe negando: lo que no debe pasar, no pasa.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOGO_PLANES, limitesDe } from '../functions/src/planes.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

// index.ts inicializa la app por defecto al cargarse, como en producción.
const { actualizarEstadoCuenta } = await import('../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const T = 'cuenta-parcial';
const PROPIETARIO = { uid: 'prop-1', token: { nc: { p: true } } };
const ADMIN_DEL_COMERCIO = { uid: 'adm-1', token: { nc: { t: { [T]: 'admin' } } } };

type Peticion = Parameters<typeof actualizarEstadoCuenta.run>[0];
const llamar = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  actualizarEstadoCuenta.run({ data, auth, rawRequest: {} } as unknown as Peticion);

/** Espera que la llamada falle con ese código de HttpsError. */
async function rechaza(p: Promise<unknown>, codigo: string) {
  await expect(p).rejects.toMatchObject({ code: codigo });
}

const cuenta = async () => (await db.doc(`tenants/${T}/cuenta/estado`).get()).data() ?? {};
const ficha = async () => (await db.doc(`tenants/${T}`).get()).data() ?? {};
const auditoria = async (accion: string) =>
  (await db.collection(`tenants/${T}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

// Un comercio que ya paga Crecimiento, con todo cargado.
const CUENTA_INICIAL = {
  plan: 'crecimiento', limites: limitesDe('crecimiento'), catalogoPlanes: '2026-09-15',
  estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD',
  motivoVisible: 'Gracias por su pago.', umbralOperador: 40, umbralBloqueo: 90,
};

beforeEach(async () => {
  const previas = await db.collection(`tenants/${T}/auditoria`).get();
  for (const d of previas.docs) await d.ref.delete();
  await db.doc(`tenants/${T}`).set({ nombre: 'Salón', estado: 'activo', plan: 'crecimiento' });
  await db.doc(`tenants/${T}/cuenta/estado`).set(CUENTA_INICIAL);
});

describe('Quién puede llamarla', () => {
  it('el administrador del comercio NO puede, ni sobre su propio comercio', async () => {
    await rechaza(llamar({ tenantId: T, plan: 'pro' }, ADMIN_DEL_COMERCIO), 'permission-denied');
    expect(await cuenta()).toMatchObject({ plan: 'crecimiento' });
  });

  it('sin sesión, NO', async () => {
    await rechaza(llamar({ tenantId: T, plan: 'pro' }, null), 'unauthenticated');
  });
});

describe('El plan es cerrado', () => {
  it('rechaza un plan inventado y NO escribe nada', async () => {
    for (const plan of ['basico', 'premium', 'Pro', '', 'toString', 7, null]) {
      await rechaza(llamar({ tenantId: T, plan }), 'invalid-argument');
    }
    expect(await cuenta()).toEqual(CUENTA_INICIAL);
    expect((await ficha()).plan).toBe('crecimiento');
    expect(await auditoria('cambiar_plan')).toHaveLength(0);
  });

  it('rechazar el plan también frena lo demás que venía en la misma llamada', async () => {
    await rechaza(llamar({ tenantId: T, plan: 'premium', montoMensual: 1 }), 'invalid-argument');
    expect((await cuenta()).montoMensual).toBe(50);
  });

  it('con un plan del catálogo escribe la copia de límites, el catálogo, el espejo y la auditoría', async () => {
    const r = await llamar({ tenantId: T, plan: 'pro' });
    expect(r).toMatchObject({ ok: true, plan: 'pro', limites: limitesDe('pro') });
    expect(await cuenta()).toMatchObject({
      plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES,
    });
    expect((await ficha()).plan).toBe('pro');
    const [a] = await auditoria('cambiar_plan');
    expect(a).toMatchObject({
      uid: 'prop-1', planAntes: 'crecimiento', planDespues: 'pro',
      limitesAntes: limitesDe('crecimiento'), limitesDespues: limitesDe('pro'),
      catalogoPlanes: CATALOGO_PLANES,
    });
  });

  it('cambiar el plan NO toca la mensualidad, la moneda, el estado de pago, el motivo ni los umbrales', async () => {
    await llamar({ tenantId: T, plan: 'impulso' });
    expect(await cuenta()).toMatchObject({
      estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD',
      motivoVisible: 'Gracias por su pago.', umbralOperador: 40, umbralBloqueo: 90,
    });
  });

  it('la copia de límites se reemplaza entera, sin arrastrar claves viejas', async () => {
    await db.doc(`tenants/${T}/cuenta/estado`).update({ limites: { ...limitesDe('crecimiento'), precioUsd: 50 } });
    await llamar({ tenantId: T, plan: 'impulso' });
    expect((await cuenta()).limites).toEqual(limitesDe('impulso'));
  });

  it('NO asigna plan a un comercio que no existe, ni le crea la cuenta', async () => {
    await rechaza(llamar({ tenantId: 'cuenta-no-existe', plan: 'pro' }), 'not-found');
    expect((await db.doc('tenants/cuenta-no-existe/cuenta/estado').get()).exists).toBe(false);
  });
});

describe('Escritura parcial: solo cambia lo que se manda', () => {
  it('una llamada SOLO con umbrales NO toca el plan, el monto, la moneda, el estado de pago ni el motivo', async () => {
    await llamar({ tenantId: T, umbralOperador: 3, umbralBloqueo: 5 });
    expect(await cuenta()).toMatchObject({
      ...CUENTA_INICIAL, umbralOperador: 3, umbralBloqueo: 5,
    });
    expect((await ficha()).plan).toBe('crecimiento');
    expect(await auditoria('cambiar_plan')).toHaveLength(0);
    const [a] = await auditoria('estado_cuenta');
    expect(a).toMatchObject({ campos: ['umbralBloqueo', 'umbralOperador'], valores: { umbralOperador: 3, umbralBloqueo: 5 } });
  });

  it('devolver los umbrales con null los borra, y tampoco toca el plan', async () => {
    await llamar({ tenantId: T, umbralOperador: null, umbralBloqueo: null });
    const c = await cuenta();
    expect(c['umbralOperador']).toBeUndefined();
    expect(c['umbralBloqueo']).toBeUndefined();
    expect(c).toMatchObject({ plan: 'crecimiento', montoMensual: 50, motivoVisible: 'Gracias por su pago.' });
  });

  it('una pareja incoherente de umbrales se rechaza y NO se escribe', async () => {
    await rechaza(llamar({ tenantId: T, umbralOperador: 95 }), 'invalid-argument');
    expect((await cuenta()).umbralOperador).toBe(40);
  });

  it('el estado de pago ya no es obligatorio, y solo cambia él', async () => {
    await llamar({ tenantId: T, estadoPago: 'pendiente' });
    expect(await cuenta()).toMatchObject({ ...CUENTA_INICIAL, estadoPago: 'pendiente' });
  });

  it('un valor mal formado se RECHAZA en vez de cambiarse por uno por defecto', async () => {
    await rechaza(llamar({ tenantId: T, montoMensual: -1 }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, montoMensual: 'cincuenta' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, moneda: 'EUR' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, estadoPago: 'sin_cargo' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, proximoVencimiento: 'mañana' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, motivoVisible: 3 }), 'invalid-argument');
    expect(await cuenta()).toEqual(CUENTA_INICIAL);
  });

  it('una llamada sin nada que cambiar se rechaza', async () => {
    await rechaza(llamar({ tenantId: T }), 'invalid-argument');
  });

  it('el motivo vacío es un valor: se puede borrar a propósito', async () => {
    await llamar({ tenantId: T, motivoVisible: '' });
    expect((await cuenta()).motivoVisible).toBe('');
    expect((await cuenta()).plan).toBe('crecimiento');
  });
});
