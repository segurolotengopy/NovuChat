/**
 * LA COPIA POR CONTRATO DE `cambiosIncluidos` — lo que distingue un valor
 * fijado por contrato de uno que viene del plan, y por qué un cambio de plan
 * NO lo pisa (recomendación de la revisión de F1, H1).
 *
 * El defecto que cierra este bloque: `asignar-plan.mjs --plan`,
 * `actualizarEstadoCuenta` con `plan` y el pago de otro plan reescribían la
 * copia `cuenta/estado.limites` con `limitesDe(plan)`, así que a un comercio
 * con 4 cambios al mes por contrato (su plan trae 2) un cambio de plan
 * posterior se los devolvía a los del plan, en silencio. El contrato se
 * marca ahora en `cuenta/estado.limitesPorContrato` y `copiaDeLimites`
 * (`planes.ts`) lo conserva en los tres escritores.
 *
 * Se escribe negando (`CLAUDE.md`, Base comercial §7): un cambio de plan NO
 * pisa el contrato, ni por la callable ni por el pago; un valor fuera de rango
 * NO entra; un administrador del comercio NO lo fija; y el contador de cambios
 * operados NIEGA el quinto de cuatro por contrato aunque el plan cambie. La
 * prueba de reglas está en `copia-por-contrato-reglas.test.ts` y la del script
 * en `pruebas/asignar-plan.test.ts`.
 *
 * Tenants ficticios; ningún nombre de cliente.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOGO_PLANES, MAXIMO_CAMBIOS_INCLUIDOS, copiaDeLimites, limitesDe, limitesDeCuenta, mismoMarcador, porContratoDe,
} from '../../functions/src/planes.ts';
import { mesBolivia } from '../../functions/src/prepago.ts';
import { cambiosDelMes } from '../../functions/src/central/ejes.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// El pago manual llega hasta el cliente del cobrador (doble en memoria):
// valores de prueba, no secretos. Cada suite fija su entorno (`pagos.test.ts`).
process.env['COBRADOR_DOBLE'] ??= '1';
process.env['COBRADOR_TOKEN'] ??= 'token-de-prueba-de-novuchat-sin-valor-real';
process.env['COBRADOR_AVISO_SECRETO'] ??= 'secreto-de-prueba-del-aviso-de-confirmacion';

const indice = await import('../../functions/src/index.ts');
const pagos = await import('../../functions/src/pagos.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'contrato-a';
const B = 'contrato-b';
const MES = mesBolivia(Date.now());
const TCO = 12.6;
const FECHA_HOY = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

const google = { sign_in_provider: 'google.com' };
const password = { sign_in_provider: 'password' };
const PROPIETARIO = { uid: 'prop-c', token: { nc: { p: true }, firebase: google, auth_time: Math.floor(Date.now() / 1000) } };
const PROPIETARIO_CON_CONTRASENA = { uid: 'prop-c2', token: { nc: { p: true }, firebase: password, email_verified: true } };
const ADMIN_A = { uid: 'adm-a', token: { nc: { t: { [A]: 'admin' } }, firebase: password, email_verified: true } };
const ADMIN_B = { uid: 'adm-b', token: { nc: { t: { [B]: 'admin' } }, firebase: password, email_verified: true } };
const OPER_A = { uid: 'oper-a', token: { nc: { t: { [A]: 'oper' } }, firebase: password, email_verified: true } };

type Callable = { run: (r: unknown) => Promise<unknown> };
const correr = (f: unknown, data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  (f as Callable).run({ data, auth, rawRequest: {} }) as Promise<Record<string, unknown>>;
const cuentaDe = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  correr(indice.actualizarEstadoCuenta, { tenantId: A, ...data }, auth);
async function rechaza(p: Promise<unknown>, codigo: string) {
  await expect(p).rejects.toMatchObject({ code: codigo });
}

const cuenta = async (t = A) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const auditoria = async (accion: string, t = A) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

/** Un comercio en producción con Pro (2 cambios al mes) y 4 por contrato, ya marcados. */
const PRO_CON_CONTRATO = {
  plan: 'pro', limites: { ...limitesDe('pro'), cambiosIncluidos: 4 }, limitesPorContrato: ['cambiosIncluidos'],
  catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', periodoPagado: '2099-12',
};
/** El mismo, sin contrato: la copia es la del plan. */
const PRO_SIN_CONTRATO = {
  plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', periodoPagado: '2099-12',
};

async function sembrar(t: string, datos: Record<string, unknown>) {
  for (const col of ['auditoria', 'pagos']) {
    for (const d of (await db.collection(`tenants/${t}/${col}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', plan: datos['plan'] ?? 'impulso', flujos: ['agendamiento'] });
  await db.doc(`tenants/${t}/cuenta/estado`).set(datos);
}

beforeEach(async () => {
  await sembrar(A, PRO_CON_CONTRATO);
  await sembrar(B, { plan: 'impulso', limites: limitesDe('impulso'), catalogoPlanes: CATALOGO_PLANES });
  for (const d of (await db.collection('cobrosPendientes').get()).docs) await d.ref.delete();
  await db.doc('plataforma/tipoCambio').set({ tco: TCO, fecha: FECHA_HOY, fuente: 'BCB' });
});

// ===========================================================================
describe('copiaDeLimites (pura): qué distingue un contrato de un plan', () => {
  it('SIN marcador no hay contrato, aunque la copia diga otro número que el plan (no se adivina comparando)', () => {
    const vieja = { plan: 'pro', limites: { ...limitesDe('pro'), cambiosIncluidos: 4 } };
    expect(porContratoDe(vieja)).toEqual([]);
    // Y un cambio de plan la reescribe con los del plan, como siempre.
    expect(copiaDeLimites(vieja, { plan: 'crecimiento' }).limites).toEqual(limitesDe('crecimiento'));
  });

  it('un marcador sobre un valor inválido NO es contrato: rige el del plan y no se afirma lo contrario', () => {
    for (const malo of [-1, 2.5, MAXIMO_CAMBIOS_INCLUIDOS + 1, '4', null]) {
      const c = { plan: 'pro', limites: { ...limitesDe('pro'), cambiosIncluidos: malo }, limitesPorContrato: ['cambiosIncluidos'] };
      expect(porContratoDe(c), String(malo)).toEqual([]);
      expect(limitesDeCuenta(c).cambiosIncluidos).toBe(limitesDe('pro').cambiosIncluidos);
    }
    // Claves que no pueden ir por contrato se ignoran.
    expect(porContratoDe({ limites: { conversaciones: 9000 }, limitesPorContrato: ['conversaciones', 'toString'] })).toEqual([]);
  });

  it('un cambio de plan CONSERVA el valor por contrato y lo informa; el resto es la copia del plan nuevo', () => {
    const r = copiaDeLimites(PRO_CON_CONTRATO, { plan: 'crecimiento' });
    expect(r.limites).toEqual({ ...limitesDe('crecimiento'), cambiosIncluidos: 4 });
    expect(r.porContrato).toEqual(['cambiosIncluidos']);
    expect(r.conservados).toEqual({ cambiosIncluidos: 4 });
    expect(r.delPlan.cambiosIncluidos).toBe(limitesDe('crecimiento').cambiosIncluidos);
  });

  it('fijar sin plan toca SOLO esa clave (una clave ajena como `campanas` se queda); `null` vuelve al del plan', () => {
    const conCampanas = { ...PRO_SIN_CONTRATO, limites: { ...limitesDe('pro'), campanas: 5 } };
    const fija = copiaDeLimites(conCampanas, { cambiosIncluidos: 6 });
    expect(fija.limites).toEqual({ ...limitesDe('pro'), campanas: 5, cambiosIncluidos: 6 });
    expect(fija.porContrato).toEqual(['cambiosIncluidos']);
    const quita = copiaDeLimites(PRO_CON_CONTRATO, { cambiosIncluidos: null });
    expect(quita.limites['cambiosIncluidos']).toBe(limitesDe('pro').cambiosIncluidos);
    expect(quita.porContrato).toEqual([]);
    expect(mismoMarcador(PRO_CON_CONTRATO, quita.porContrato)).toBe(false);
  });

  it('un valor fuera de rango NO se convierte en contrato: lanza', () => {
    for (const malo of [-1, 1.5, MAXIMO_CAMBIOS_INCLUIDOS + 1, Number.NaN]) {
      expect(() => copiaDeLimites(PRO_SIN_CONTRATO, { cambiosIncluidos: malo }), String(malo)).toThrow(RangeError);
    }
  });
});

// ===========================================================================
describe('actualizarEstadoCuenta: fijar y quitar el contrato (la callable de Negocios)', () => {
  it('el administrador del comercio NO lo fija ni lo quita; el operador, un propietario con contraseña o sin sesión tampoco', async () => {
    await sembrar(A, PRO_SIN_CONTRATO);
    await rechaza(cuentaDe({ cambiosIncluidos: 4 }, ADMIN_A), 'permission-denied');
    await rechaza(cuentaDe({ cambiosIncluidos: null }, ADMIN_A), 'permission-denied');
    await rechaza(cuentaDe({ cambiosIncluidos: 4 }, ADMIN_B), 'permission-denied');
    await rechaza(cuentaDe({ cambiosIncluidos: 4 }, OPER_A), 'permission-denied');
    await rechaza(cuentaDe({ cambiosIncluidos: 4 }, PROPIETARIO_CON_CONTRASENA), 'permission-denied');
    await rechaza(cuentaDe({ cambiosIncluidos: 4 }, null), 'unauthenticated');
    const c = await cuenta();
    expect(c['limites']).toEqual(limitesDe('pro'));
    expect(c['limitesPorContrato']).toBeUndefined();
    expect(await auditoria('limites_por_contrato')).toHaveLength(0);
  });

  it('un valor fuera de rango NO entra, ni frena en silencio lo demás: no se escribe nada', async () => {
    await sembrar(A, PRO_SIN_CONTRATO);
    for (const malo of [-1, 1.5, MAXIMO_CAMBIOS_INCLUIDOS + 1, '4', true, {}, []]) {
      await rechaza(cuentaDe({ cambiosIncluidos: malo }), 'invalid-argument');
      await rechaza(cuentaDe({ cambiosIncluidos: malo, plan: 'crecimiento' }), 'invalid-argument');
    }
    expect(await cuenta()).toMatchObject({ plan: 'pro', limites: limitesDe('pro') });
    expect((await cuenta())['limitesPorContrato']).toBeUndefined();
  });

  it('el propietario lo fija por contrato: copia, marcador y auditoría con el antes y el después', async () => {
    await sembrar(A, PRO_SIN_CONTRATO);
    const r = await cuentaDe({ cambiosIncluidos: 4 });
    expect(r).toMatchObject({ ok: true, limites: { ...limitesDe('pro'), cambiosIncluidos: 4 } });
    const c = await cuenta();
    expect(c['limites']).toEqual({ ...limitesDe('pro'), cambiosIncluidos: 4 });
    expect(c['limitesPorContrato']).toEqual(['cambiosIncluidos']);
    // No es un cambio de plan: ni plan, ni catálogo, ni auditoría de plan.
    expect(c['plan']).toBe('pro');
    expect(await auditoria('cambiar_plan')).toHaveLength(0);
    const [a] = await auditoria('limites_por_contrato');
    expect(a).toMatchObject({
      uid: 'prop-c', clave: 'cambiosIncluidos', plan: 'pro', delPlan: 2,
      antes: { valor: 2, porContrato: false }, despues: { valor: 4, porContrato: true },
    });
  });

  it('UN CAMBIO DE PLAN NO PISA EL CONTRATO: sube y baja de plan y los 4 siguen, con constancia en la auditoría', async () => {
    await cuentaDe({ plan: 'crecimiento' });
    let c = await cuenta();
    expect(c['limites']).toEqual({ ...limitesDe('crecimiento'), cambiosIncluidos: 4 });
    expect(c['limitesPorContrato']).toEqual(['cambiosIncluidos']);
    const [a] = await auditoria('cambiar_plan');
    expect(a).toMatchObject({ planAntes: 'pro', planDespues: 'crecimiento', conservadosPorContrato: { cambiosIncluidos: 4 } });
    // Y con un plan que trae 0.
    await cuentaDe({ plan: 'impulso' });
    c = await cuenta();
    expect(c['limites']).toMatchObject({ conversaciones: 100, cambiosIncluidos: 4 });
    expect(limitesDeCuenta(c).cambiosIncluidos).toBe(4);
  });

  it('quitarlo es explícito (`null`): vuelve al del plan, se borra el marcador, y el siguiente cambio de plan ya sigue al plan', async () => {
    await cuentaDe({ cambiosIncluidos: null });
    let c = await cuenta();
    expect(c['limites']).toEqual(limitesDe('pro'));
    expect(c['limitesPorContrato']).toBeUndefined();
    const [a] = await auditoria('limites_por_contrato');
    expect(a).toMatchObject({ antes: { valor: 4, porContrato: true }, despues: { valor: 2, porContrato: false } });
    await cuentaDe({ plan: 'crecimiento' });
    c = await cuenta();
    expect(c['limites']).toEqual(limitesDe('crecimiento'));
  });

  it('plan y contrato en la misma llamada: manda lo pedido, en una sola escritura', async () => {
    await cuentaDe({ plan: 'crecimiento', cambiosIncluidos: 7 });
    expect((await cuenta())['limites']).toEqual({ ...limitesDe('crecimiento'), cambiosIncluidos: 7 });
    await cuentaDe({ plan: 'pro', cambiosIncluidos: null });
    const c = await cuenta();
    expect(c['limites']).toEqual(limitesDe('pro'));
    expect(c['limitesPorContrato']).toBeUndefined();
  });

  it('sin cuenta NO se fija un contrato suelto (quedaría una cuenta parcial sin plan)', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).delete();
    await rechaza(cuentaDe({ cambiosIncluidos: 4 }), 'failed-precondition');
    expect((await db.doc(`tenants/${A}/cuenta/estado`).get()).exists).toBe(false);
  });
});

// ===========================================================================
describe('el contador de cambios operados respeta el contrato, también después de cambiar de plan', () => {
  const registrar = (auth: object = PROPIETARIO) =>
    correr(indice.registrarCambioOperado, { tenantId: A, descripcion: 'Ajuste del horario de atención' }, auth);

  it('con 4 por contrato entran 4 y el QUINTO se niega, aunque el plan (Pro) traiga 2', async () => {
    for (let i = 1; i <= 4; i++) expect(await registrar()).toMatchObject({ usados: i, incluidos: 4, forzado: false });
    await rechaza(registrar(), 'resource-exhausted');
    expect(((await cuenta())['cambios'] as Record<string, number>)[MES]).toBe(4);
  });

  it('pasar a un plan que trae 1 NO baja el tope: después del cambio de plan siguen siendo 4', async () => {
    await registrar(); await registrar();
    await cuentaDe({ plan: 'crecimiento' });
    expect(cambiosDelMes(await cuenta(), Date.now())).toMatchObject({ usados: 2, incluidos: 4, permitido: true });
    await registrar(); await registrar();
    await rechaza(registrar(), 'resource-exhausted');
  });

  it('quitado el contrato, rige el del plan: con 2 ya usados, el tercero se niega', async () => {
    await registrar(); await registrar();
    await cuentaDe({ cambiosIncluidos: null });
    await rechaza(registrar(), 'resource-exhausted');
  });

  it('el administrador del comercio no registra cambios (solo NovuChat cuenta su trabajo)', async () => {
    await rechaza(registrar(ADMIN_A), 'permission-denied');
  });
});

// ===========================================================================
describe('pagar otro plan también es cambiar de plan: NO pisa el contrato', () => {
  // Sin mes pagado: el pago cubre el mes en curso (un 2099-12 empujaría al 2100).
  const { periodoPagado: _p, ...sinMesPagado } = PRO_CON_CONTRATO;

  it('un pago manual de Crecimiento sobre Pro con 4 por contrato deja Crecimiento con 4', async () => {
    await sembrar(A, sinMesPagado);
    await correr(indice.registrarPagoManual, {
      pagoId: pagos.nuevoPagoId(), tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 1,
      medio: 'efectivo', referencia: 'recibido por la prueba', tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY,
      montoRecibidoBs: 630,
    });
    const c = await cuenta();
    expect(c['plan']).toBe('crecimiento');
    expect(c['limites']).toEqual({ ...limitesDe('crecimiento'), cambiosIncluidos: 4 });
    expect(c['limitesPorContrato']).toEqual(['cambiosIncluidos']);
  });

  it('sin contrato, pagar otro plan sigue dejando la copia del plan (como siempre)', async () => {
    const { limitesPorContrato: _m, ...sinContrato } = sinMesPagado;
    await sembrar(A, { ...sinContrato, limites: limitesDe('pro') });
    await correr(indice.registrarPagoManual, {
      pagoId: pagos.nuevoPagoId(), tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 1,
      medio: 'efectivo', referencia: 'recibido por la prueba', tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY,
      montoRecibidoBs: 630,
    });
    expect((await cuenta())['limites']).toEqual(limitesDe('crecimiento'));
  });
});

// ===========================================================================
describe('ejesDeCuenta dice el origen: por contrato o del plan', () => {
  it('con contrato: porContrato y cuántos trae el plan; el administrador del comercio lo LEE', async () => {
    const r = await correr(indice.ejesDeCuenta, { tenantId: A }, ADMIN_A);
    expect(r['limites']).toMatchObject({ cambiosIncluidos: 4, porContrato: ['cambiosIncluidos'], cambiosIncluidosDelPlan: 2 });
  });

  it('sin contrato: lista vacía; y el administrador de OTRO comercio no lo lee', async () => {
    await sembrar(A, PRO_SIN_CONTRATO);
    const r = await correr(indice.ejesDeCuenta, { tenantId: A });
    expect(r['limites']).toMatchObject({ cambiosIncluidos: 2, porContrato: [], cambiosIncluidosDelPlan: 2 });
    await rechaza(correr(indice.ejesDeCuenta, { tenantId: A }, ADMIN_B), 'permission-denied');
  });
});
