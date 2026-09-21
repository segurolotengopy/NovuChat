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
import { PRUEBA, mesBolivia } from '../functions/src/prepago.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

// index.ts inicializa la app por defecto al cargarse, como en producción.
const { actualizarEstadoCuenta } = await import('../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const T = 'cuenta-parcial';
const PROPIETARIO = { uid: 'prop-1', token: { nc: { p: true }, firebase: { sign_in_provider: 'google.com' } } };
// El mismo claim con una sesión de contraseña no es el propietario (T-19).
const PROPIETARIO_CON_CONTRASENA = { uid: 'prop-2', token: { nc: { p: true }, firebase: { sign_in_provider: 'password' } } };
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

// Un comercio que ya paga Crecimiento, con todo cargado. Desde el 20/09 (A-1)
// los derivados se recalculan en CADA llamada, así que la cuenta lleva la
// modalidad y un mes pagado lejano: sobre eso `camposDerivados` dice
// `al_dia` con 50 USD, que es lo que las pruebas de abajo esperan sin cambio.
const CUENTA_INICIAL = {
  plan: 'crecimiento', limites: limitesDe('crecimiento'), catalogoPlanes: '2026-09-15',
  modalidad: 'prepago', periodoPagado: '2099-12',
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

  it('el claim de propietario con una sesión de CONTRASEÑA no alcanza (T-19)', async () => {
    await rechaza(llamar({ tenantId: T, plan: 'pro' }, PROPIETARIO_CON_CONTRASENA), 'permission-denied');
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
    await rechaza(llamar({ tenantId: T, plan: 'premium', motivoVisible: 'x' }), 'invalid-argument');
    expect((await cuenta()).motivoVisible).toBe('Gracias por su pago.');
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

  it('cambiar el plan recalcula la mensualidad (es derivada) y NO toca el motivo ni los umbrales', async () => {
    await llamar({ tenantId: T, plan: 'impulso' });
    expect(await cuenta()).toMatchObject({
      estadoPago: 'al_dia', montoMensual: 25, moneda: 'USD',
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

  // LO QUE SE DERIVA DE LOS PAGOS NO SE ESCRIBE A MANO (20/09, bloque A-1,
  // `DISENO.md` §4undecies.2). Hasta ese día estas cuatro claves se
  // aceptaban; ahora se RECHAZAN aunque vengan bien formadas, y nada se
  // escribe, ni lo demás que venía en la misma llamada.
  it('estadoPago, montoMensual, moneda y proximoVencimiento se RECHAZAN: se derivan de los pagos', async () => {
    await rechaza(llamar({ tenantId: T, estadoPago: 'pendiente' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, estadoPago: 'al_dia' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, montoMensual: 90 }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, moneda: 'USD' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, proximoVencimiento: Date.now() + 86_400_000 }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, proximoVencimiento: null }), 'invalid-argument');
    // Y frenan lo demás que venía con ellos.
    await rechaza(llamar({ tenantId: T, estadoPago: 'pendiente', motivoVisible: 'x', umbralOperador: 3, umbralBloqueo: 5 }), 'invalid-argument');
    expect(await cuenta()).toEqual(CUENTA_INICIAL);
    expect(await auditoria('estado_cuenta')).toHaveLength(0);
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

  it('los derivados se recalculan en CADA llamada: uno pisado a mano se corrige al tocar cualquier otra cosa', async () => {
    await db.doc(`tenants/${T}/cuenta/estado`).update({ estadoPago: 'vencido', montoMensual: 1, moneda: 'BOB' });
    await llamar({ tenantId: T, motivoVisible: 'al día otra vez' });
    const c = await cuenta();
    expect(c).toMatchObject({ estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD', motivoVisible: 'al día otra vez' });
    expect(c.proximoVencimiento).toBeDefined();
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

// PREPAGO (bloques A-0 y A-1, `DISENO.md` §4undecies.2): la modalidad es
// cerrada, la bandera por tenant es solo booleana, y los campos de situación
// de pago se recalculan en cada llamada; escritos a mano, se rechazan (arriba).
describe('Prepago: modalidad cerrada, bandera por tenant y derivados', () => {
  it('una modalidad inventada se rechaza y NO escribe nada', async () => {
    for (const modalidad of ['gratis', 'Prepago', '', 7, null, 'toString']) {
      await rechaza(llamar({ tenantId: T, modalidad }), 'invalid-argument');
    }
    expect(await cuenta()).toEqual(CUENTA_INICIAL);
  });

  it('`corteActivo` solo acepta verdadero o falso; `null` lo borra; no toca los derivados', async () => {
    await rechaza(llamar({ tenantId: T, corteActivo: 'si' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, corteActivo: 1 }), 'invalid-argument');
    expect(await cuenta()).toEqual(CUENTA_INICIAL);
    await llamar({ tenantId: T, corteActivo: true });
    expect(await cuenta()).toEqual({
      ...CUENTA_INICIAL, corteActivo: true, actualizadoEn: expect.anything(), proximoVencimiento: expect.anything(),
    });
    await llamar({ tenantId: T, corteActivo: null });
    expect((await cuenta()).corteActivo).toBeUndefined();
    expect((await cuenta()).estadoPago).toBe('al_dia');
    const auds = await auditoria('estado_cuenta');
    expect(auds).toHaveLength(2);
    expect(auds.some((a) => (a['valores'] as Record<string, unknown>)['corteActivo'] === true)).toBe(true);
    for (const a of auds) expect(a['campos']).toEqual(['corteActivo']);
  });

  it('`periodoPrueba` tiene que ser aaaa-mm', async () => {
    await rechaza(llamar({ tenantId: T, periodoPrueba: '2026-1' }), 'invalid-argument');
    await rechaza(llamar({ tenantId: T, periodoPrueba: 'octubre' }), 'invalid-argument');
    expect(await cuenta()).toEqual(CUENTA_INICIAL);
  });

  it('no se puede borrar `periodoPrueba` de una cuenta que queda en PRUEBA (quedaría incoherente)', async () => {
    // Revisión de seguridad de A-0: en la misma llamada, o sobre una que ya es prueba.
    await rechaza(llamar({ tenantId: T, modalidad: 'prueba', periodoPrueba: null }), 'invalid-argument');
    expect(await cuenta()).toEqual(CUENTA_INICIAL);
    await llamar({ tenantId: T, modalidad: 'prueba' });
    await rechaza(llamar({ tenantId: T, periodoPrueba: null }), 'invalid-argument');
    expect((await cuenta()).periodoPrueba).toBe(mesBolivia(Date.now()));
    // Al salir de prueba sí se puede borrar.
    await llamar({ tenantId: T, modalidad: 'demostracion', periodoPrueba: null });
    expect((await cuenta()).periodoPrueba).toBeUndefined();
  });

  it('pasar a PRUEBA inicializa el mes en curso y su bolsa, y deriva al día con monto cero', async () => {
    await llamar({ tenantId: T, modalidad: 'prueba' });
    const c = await cuenta();
    expect(c).toMatchObject({
      modalidad: 'prueba', periodoPrueba: mesBolivia(Date.now()), bolsaPrueba: PRUEBA.conversaciones,
      estadoPago: 'al_dia', montoMensual: 0, moneda: 'USD', plan: 'crecimiento',
    });
    expect(c.proximoVencimiento).toBeDefined();
    // Volver a pedir prueba no reinicia el mes ni la bolsa.
    await db.doc(`tenants/${T}/cuenta/estado`).update({ bolsaPrueba: 3 });
    await llamar({ tenantId: T, modalidad: 'prueba' });
    expect((await cuenta()).bolsaPrueba).toBe(3);
    const [a] = await auditoria('estado_cuenta');
    expect(a).toMatchObject({ campos: ['modalidad'], valores: { modalidad: 'prueba' } });
  });

  it('pasar a DEMOSTRACIÓN deriva sin cargo, monto cero y sin vencimiento', async () => {
    await llamar({ tenantId: T, modalidad: 'demostracion' });
    const c = await cuenta();
    expect(c).toMatchObject({ modalidad: 'demostracion', estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'USD' });
    expect(c.proximoVencimiento).toBeUndefined();
  });

  it('pasar a PREPAGO sin un mes pagado deriva `vencido` con el precio del plan; `periodoPagado` no se acepta', async () => {
    const { modalidad: _m, periodoPagado: _p, ...sinPrepago } = CUENTA_INICIAL;
    await db.doc(`tenants/${T}/cuenta/estado`).set(sinPrepago);
    await llamar({ tenantId: T, modalidad: 'prepago' });
    expect(await cuenta()).toMatchObject({ modalidad: 'prepago', estadoPago: 'vencido', montoMensual: 50, moneda: 'USD' });
    // Solo un pago (A-1) o la migración escriben el mes pagado: la callable lo ignora.
    await llamar({ tenantId: T, modalidad: 'prepago', motivoVisible: 'x', periodoPagado: '2099-01' } as Record<string, unknown>);
    expect((await cuenta()).periodoPagado).toBeUndefined();
  });

  it('con modalidad, cambiar el plan recalcula el monto; SIN modalidad la cuenta es demostración y deriva sin cargo', async () => {
    await llamar({ tenantId: T, plan: 'pro' });
    expect(await cuenta()).toMatchObject({ plan: 'pro', montoMensual: 90, estadoPago: 'al_dia' });
    // Un comercio de antes del 20/09, sin modalidad: para el módulo es
    // demostración (`modalidadDe`), y eso es lo que se deriva. Por eso la
    // migración (`scripts/migrar-prepago.mjs`) le da su modalidad a cada
    // comercio real ANTES del primer pago, y por eso el pago la escribe.
    const { modalidad: _m, periodoPagado: _p, ...sinPrepago } = CUENTA_INICIAL;
    await db.doc(`tenants/${T}/cuenta/estado`).set(sinPrepago);
    await llamar({ tenantId: T, plan: 'impulso' });
    const c = await cuenta();
    expect(c).toMatchObject({ plan: 'impulso', montoMensual: 0, estadoPago: 'sin_cargo', moneda: 'USD' });
    expect(c.proximoVencimiento).toBeUndefined();
  });
});
