/**
 * PAGOS DEL PREPAGO — LAS CALLABLES REALES, CONTRA EL EMULADOR (bloque A-1,
 * `DISENO.md` §4undecies.1, §4undecies.2 y §4undecies.7).
 *
 * Se invocan con `.run()`, que es la misma función que despliega Firebase, con
 * un contexto de autenticación fabricado. SE ESCRIBE NEGANDO (`CLAUDE.md` §7):
 * por cada caso que pasa hay varios que tienen que fallar, y después de cada
 * rechazo se verifica que NO se escribió nada. Lo que la pantalla no puede
 * impedir —un administrador que se carga un pago, un propietario sin TCO, una
 * transferencia sin comprobante— lo impide el servidor, y acá está la prueba.
 *
 * Las dependencias que no existen en este bloque (el cobrador, Storage) se
 * inyectan con las fábricas `crear…` de `pagos.ts`; las callables por defecto
 * (`registrarPagoManual`, etc.) se prueban también, para que el camino
 * desplegado sea el probado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGO_PLANES, limitesDe } from '../functions/src/planes.ts';
import { mesBolivia, sumarMeses } from '../functions/src/prepago.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

// index.ts inicializa la app por defecto al cargarse, como en producción.
const indice = await import('../functions/src/index.ts');
const pagos = await import('../functions/src/pagos.ts');
const { exigirAdminDe } = await import('../functions/src/autorizacion.ts');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'pagos-a';
const B = 'pagos-b';
const HOY = mesBolivia(Date.now());
const FECHA_HOY = new Date().toISOString().slice(0, 10);
const TCO = 12.6;
const PAGO_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const OTRO_ID = 'zYxWvUtSrQpOnMlKjIhGfE';

const google = { sign_in_provider: 'google.com' };
const password = { sign_in_provider: 'password' };
/** `auth_time` en segundos: la sesión se abrió al cargar esta suite (reciente). */
const AUTH_TIME = Math.floor(Date.now() / 1000);
const PROPIETARIO = { uid: 'prop-1', token: { nc: { p: true }, firebase: google, auth_time: AUTH_TIME } };
const PROPIETARIO_CON_CONTRASENA = { uid: 'prop-2', token: { nc: { p: true }, firebase: password, email_verified: true } };
const ADMIN_A = { uid: 'adm-a', token: { nc: { t: { [A]: 'admin' } }, firebase: password, email_verified: true } };
const ADMIN_A_CON_GOOGLE = { uid: 'adm-a', token: { nc: { t: { [A]: 'admin' } }, firebase: google, email_verified: true } };
const ADMIN_A_SIN_VERIFICAR = { uid: 'adm-a', token: { nc: { t: { [A]: 'admin' } }, firebase: password, email_verified: false } };
/** El token «viejo»: solo el claim, sin proveedor. Hasta el 20/09 pasaba. */
const ADMIN_A_SOLO_CLAIM = { uid: 'adm-a', token: { nc: { t: { [A]: 'admin' } } } };
const ADMIN_B = { uid: 'adm-b', token: { nc: { t: { [B]: 'admin' } }, firebase: password, email_verified: true } };
const OPER_A = { uid: 'oper-a', token: { nc: { t: { [A]: 'oper' } }, firebase: password, email_verified: true } };

type Callable = { run: (r: unknown) => Promise<unknown> };
const correr = (f: unknown, data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  (f as Callable).run({ data, auth, rawRequest: {} }) as Promise<Record<string, unknown>>;

/** Espera que la llamada falle con ese código y devuelve los `details`. */
async function rechaza(p: Promise<unknown>, codigo: string): Promise<Record<string, unknown>> {
  let error: unknown = null;
  try { await p; } catch (e) { error = e; }
  expect(error, 'se esperaba un rechazo').not.toBeNull();
  expect(error).toMatchObject({ code: codigo });
  return ((error as { details?: unknown }).details ?? {}) as Record<string, unknown>;
}

const cuenta = async (t = A) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const ficha = async (t = A) => (await db.doc(`tenants/${t}`).get()).data() ?? {};
const pago = async (id: string, t = A) => (await db.doc(`tenants/${t}/pagos/${id}`).get()).data();
const pagosDe = async (t = A): Promise<Record<string, unknown>[]> => (await db.collection(`tenants/${t}/pagos`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const auditoria = async (accion: string, t = A) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());
const bitacora = async (tipo: string, t = A) =>
  (await db.collection(`tenants/${t}/bitacora`).where('tipo', '==', tipo).get()).docs.map((d) => d.data());

const CUENTA_BASE = { plan: 'crecimiento', limites: limitesDe('crecimiento'), catalogoPlanes: CATALOGO_PLANES };

/**
 * Un manual válido en efectivo, 1 mes de Crecimiento: 50 USD × 12,6 = 630 Bs.
 * Cada llamada trae su propio `pagoId`, como un formulario nuevo de la consola.
 */
const manual = (extra: Record<string, unknown> = {}) => ({
  pagoId: pagos.nuevoPagoId(),
  tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 1,
  medio: 'efectivo', referencia: 'recibido por Andres',
  tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY, montoRecibidoBs: 630,
  ...extra,
});

async function limpiar(t: string) {
  for (const col of ['pagos', 'auditoria', 'bitacora', 'rutasWhatsApp']) {
    const docs = await db.collection(col === 'rutasWhatsApp' ? col : `tenants/${t}/${col}`).get();
    for (const d of docs.docs) if (col !== 'rutasWhatsApp' || d.get('tenantId') === t) await d.ref.delete();
  }
  for (const d of (await db.collection('cobrosPendientes').get()).docs) await d.ref.delete();
}

/** Deja un pago PENDIENTE sembrado como lo haría el cliente del cobrador (A-2). */
async function sembrarPendiente(id: string, cobroId: string | null, t = A) {
  await db.doc(`tenants/${t}/pagos/${id}`).set({
    tipo: 'mensualidad', plan: 'crecimiento', meses: 1, montoUsd: 50, monto: 630,
    moneda: 'BOB', monedaLista: 'USD', tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY,
    montoRecibidoBs: null, estado: 'pendiente', medio: 'qr', canal: 'consola', referencia: id,
    descripcion: 'Crecimiento · 1 mes',
    cobro: { id: cobroId, estado: cobroId ? 'QR_ACTIVO' : 'SIN_EMITIR', venceEn: null, creadoEn: null, fichaQr: 'f'.repeat(32), qrRuta: null },
    creadoEn: Timestamp.now(), creadoPor: 'adm-a', actualizadoEn: Timestamp.now(),
  });
  await db.doc(`tenants/${t}/cuenta/estado`).set({ pagoPendienteId: id }, { merge: true });
  await db.doc(`cobrosPendientes/${id}`).set({ tenantId: t, pagoId: id, cobroId, fichaQr: 'f'.repeat(32), venceEn: null, creadoEn: Timestamp.now() });
}

beforeEach(async () => {
  await limpiar(A); await limpiar(B);
  await db.doc(`tenants/${A}`).set({ nombre: 'Salón A', estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'] });
  await db.doc(`tenants/${A}/cuenta/estado`).set(CUENTA_BASE);
  await db.doc(`tenants/${B}`).set({ nombre: 'Resto B', estado: 'activo', plan: 'impulso', flujos: ['venta'] });
  await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', limites: limitesDe('impulso'), catalogoPlanes: CATALOGO_PLANES });
});

// ===========================================================================
describe('registrarPagoManual: quién puede', () => {
  it('el administrador del comercio NO puede, ni sobre su propio comercio', async () => {
    await rechaza(correr(indice.registrarPagoManual, manual(), ADMIN_A), 'permission-denied');
    expect(await pagosDe()).toHaveLength(0);
    expect(await cuenta()).toEqual(CUENTA_BASE);
  });

  it('el claim de propietario con sesión de CONTRASEÑA no alcanza (T-19)', async () => {
    await rechaza(correr(indice.registrarPagoManual, manual(), PROPIETARIO_CON_CONTRASENA), 'permission-denied');
    expect(await pagosDe()).toHaveLength(0);
  });

  it('con una sesión de hace más de media hora, o sin auth_time, pide volver a iniciar sesión (LOW 6)', async () => {
    const vieja = { uid: 'prop-1', token: { ...PROPIETARIO.token, auth_time: Math.floor(Date.now() / 1000) - 1801 } };
    const sinHora = { uid: 'prop-1', token: { nc: { p: true }, firebase: google } };
    const texto = { uid: 'prop-1', token: { ...PROPIETARIO.token, auth_time: String(AUTH_TIME) } };
    for (const quien of [vieja, sinHora, texto]) {
      await rechaza(correr(indice.registrarPagoManual, manual(), quien), 'unauthenticated');
    }
    expect(await pagosDe()).toHaveLength(0);
    expect(await cuenta()).toEqual(CUENTA_BASE);
  });

  it('ni el operador, ni el admin de otro comercio, ni sin sesión', async () => {
    await rechaza(correr(indice.registrarPagoManual, manual(), OPER_A), 'permission-denied');
    await rechaza(correr(indice.registrarPagoManual, manual(), ADMIN_B), 'permission-denied');
    await rechaza(correr(indice.registrarPagoManual, manual(), null), 'unauthenticated');
    expect(await pagosDe()).toHaveLength(0);
  });
});

// ===========================================================================
describe('registrarPagoManual: sin TCO válido no se registra', () => {
  it('TCO ausente, fuera de 5..40 o no numérico → se rechaza y no se escribe nada', async () => {
    for (const tcoAplicado of [undefined, 4.99, 40.01, 0, -12, 'doce', null, Number.NaN]) {
      await rechaza(correr(indice.registrarPagoManual, manual({ tcoAplicado })), 'invalid-argument');
    }
    expect(await pagosDe()).toHaveLength(0);
    expect(await cuenta()).toEqual(CUENTA_BASE);
    expect(await auditoria('pago_manual')).toHaveLength(0);
  });

  it('fecha del TCO mal formada o futura, o fuente vacía → se rechaza', async () => {
    for (const tcoFecha of ['2026/09/21', '21-09-2026', '2026-13-01', '', 20260921, '2999-01-01']) {
      await rechaza(correr(indice.registrarPagoManual, manual({ tcoFecha })), 'invalid-argument');
    }
    await rechaza(correr(indice.registrarPagoManual, manual({ tcoFuente: '' })), 'invalid-argument');
    await rechaza(correr(indice.registrarPagoManual, manual({ tcoFuente: 7 })), 'invalid-argument');
    expect(await pagosDe()).toHaveLength(0);
  });
});

// ===========================================================================
describe('registrarPagoManual: lo que exige el pedido', () => {
  it('meses 7 no, meses 0 no, plan demostracion no, bolsa 13 no, tipo inventado no', async () => {
    const malos = [
      { meses: 7 }, { meses: 0 }, { meses: 1.5 }, { plan: 'demostracion' }, { plan: 'basico' }, { plan: 'Pro' },
      { tipo: 'bolsa', cantidad: 13 }, { tipo: 'bolsa', cantidad: 0 }, { tipo: 'bolsa' }, { tipo: 'regalo' }, { tipo: undefined },
    ];
    for (const m of malos) await rechaza(correr(indice.registrarPagoManual, manual(m)), 'invalid-argument');
    expect(await pagosDe()).toHaveLength(0);
  });

  it('el medio es efectivo o transferencia: `qr` solo lo escribe el cobrador', async () => {
    for (const medio of ['qr', 'cheque', '', undefined]) {
      await rechaza(correr(indice.registrarPagoManual, manual({ medio })), 'invalid-argument');
    }
    expect(await pagosDe()).toHaveLength(0);
  });

  it('la referencia es obligatoria; lo recibido tiene que ser un entero en bolivianos', async () => {
    await rechaza(correr(indice.registrarPagoManual, manual({ referencia: '' })), 'invalid-argument');
    await rechaza(correr(indice.registrarPagoManual, manual({ referencia: '   ' })), 'invalid-argument');
    for (const montoRecibidoBs of [undefined, 630.5, '630', -1, 10_000_001]) {
      await rechaza(correr(indice.registrarPagoManual, manual({ montoRecibidoBs })), 'invalid-argument');
    }
    expect(await pagosDe()).toHaveLength(0);
  });

  it('un importe distinto del de la lista SIN motivo se rechaza; CON motivo queda escrito', async () => {
    await rechaza(correr(indice.registrarPagoManual, manual({ montoRecibidoBs: 600 })), 'invalid-argument');
    await rechaza(correr(indice.registrarPagoManual, manual({ montoRecibidoBs: 600, motivoDiferencia: '  ' })), 'invalid-argument');
    expect(await pagosDe()).toHaveLength(0);
    const r = await correr(indice.registrarPagoManual, manual({ montoRecibidoBs: 600, motivoDiferencia: 'descuento por referido' }));
    const p = await pago(r['pagoId'] as string);
    expect(p).toMatchObject({ monto: 630, montoRecibidoBs: 600, motivoDiferencia: 'descuento por referido', estado: 'confirmado' });
    const [a] = await auditoria('pago_manual');
    expect(a).toMatchObject({ monto: 630, montoRecibidoBs: 600, motivoDiferencia: 'descuento por referido' });
  });

  it('un comercio inexistente → not-found; uno dado de baja → failed-precondition; nada se escribe', async () => {
    await rechaza(correr(indice.registrarPagoManual, manual({ tenantId: 'pagos-no-existe' })), 'not-found');
    expect((await db.collection('tenants/pagos-no-existe/pagos').get()).size).toBe(0);
    await db.doc(`tenants/${A}`).update({ estado: 'dado_de_baja' });
    await rechaza(correr(indice.registrarPagoManual, manual()), 'failed-precondition');
    expect(await pagosDe()).toHaveLength(0);
  });
});

// ===========================================================================
describe('registrarPagoManual: idempotencia por pagoId (MEDIUM 1)', () => {
  it('sin pagoId, o con uno mal formado, no se registra nada, tampoco en efectivo', async () => {
    for (const pagoId of [undefined, '', 'p1', 'AbCdEfGhIjKlMnOpQrStU', '../../x/AbCdEfGhIjKlMnOpQ']) {
      await rechaza(correr(indice.registrarPagoManual, manual({ pagoId })), 'invalid-argument');
    }
    expect(await pagosDe()).toHaveLength(0);
    expect(await cuenta()).toEqual(CUENTA_BASE);
  });

  it('dos llamadas idénticas en efectivo con el mismo pagoId: la segunda already-exists y el mes avanza UNA vez', async () => {
    const pedido = manual({ pagoId: PAGO_ID });
    await correr(indice.registrarPagoManual, pedido);
    await rechaza(correr(indice.registrarPagoManual, pedido), 'already-exists');
    expect(await cuenta()).toMatchObject({ periodoPagado: HOY });
    expect(await pagosDe()).toHaveLength(1);
    expect(await auditoria('pago_manual')).toHaveLength(1);
    expect(await bitacora('pago_registrado')).toHaveLength(1);
  });
});

describe('registrarPagoManual: transferencia y evidencia', () => {
  const META = { generation: '1726870000000001', md5Hash: 'aGFzaA==', size: 2048, contentType: 'image/jpeg' };
  const conEvidencia = (existe: boolean, meta: Record<string, unknown> = META) =>
    pagos.crearRegistrarPagoManual({ metaEvidencia: async () => (existe ? meta as never : null) });

  it('una transferencia SIN evidencia no se registra', async () => {
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 12345', pagoId: PAGO_ID })), 'invalid-argument');
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 12345', pagoId: PAGO_ID, evidencia: 'comprobante.pdf' })), 'invalid-argument');
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 12345', pagoId: PAGO_ID, evidencia: 'evidencia.jpeg' })), 'invalid-argument');
    expect(await pagosDe()).toHaveLength(0);
  });

  it('con evidencia hace falta el pagoId de la carpeta, y con la forma correcta', async () => {
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 1', evidencia: 'evidencia.pdf', pagoId: undefined })), 'invalid-argument');
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 1', evidencia: 'evidencia.pdf', pagoId: 'p1' })), 'invalid-argument');
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 1', evidencia: 'evidencia.pdf', pagoId: '../../otro/evidencia' })), 'invalid-argument');
    expect(await pagosDe()).toHaveLength(0);
  });

  it('una evidencia declarada que NO está en Storage no registra nada', async () => {
    const existe = vi.fn(async () => null);
    const f = pagos.crearRegistrarPagoManual({ metaEvidencia: existe });
    await rechaza(correr(f, manual({ medio: 'transferencia', referencia: 'op 12345', pagoId: PAGO_ID, evidencia: 'evidencia.pdf' })), 'failed-precondition');
    expect(existe).toHaveBeenCalledWith(`tenants/${A}/pagos/${PAGO_ID}/evidencia.pdf`);
    expect(await pago(PAGO_ID)).toBeUndefined();
    expect(await cuenta()).toEqual(CUENTA_BASE);
  });

  it('una evidencia vacía, o con un tipo que no corresponde a su nombre, no registra nada', async () => {
    await rechaza(correr(conEvidencia(true, { ...META, size: 0 }), manual({ medio: 'transferencia', referencia: 'op 1', pagoId: PAGO_ID, evidencia: 'evidencia.jpg' })), 'failed-precondition');
    await rechaza(correr(conEvidencia(true, { ...META, contentType: 'text/html' }), manual({ medio: 'transferencia', referencia: 'op 1', pagoId: PAGO_ID, evidencia: 'evidencia.jpg' })), 'failed-precondition');
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 1', pagoId: PAGO_ID, evidencia: 'evidencia.pdf' })), 'failed-precondition');
    expect(await pagosDe()).toHaveLength(0);
  });

  it('la evidencia va SOLO con transferencia: en efectivo se rechaza', async () => {
    await rechaza(correr(conEvidencia(true), manual({ pagoId: PAGO_ID, evidencia: 'evidencia.pdf' })), 'invalid-argument');
    expect(await pagosDe()).toHaveLength(0);
  });

  it('con evidencia existente se registra con el id elegido y la ruta exacta de Storage', async () => {
    const r = await correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 12345', pagoId: PAGO_ID, evidencia: 'evidencia.jpg' }));
    expect(r['pagoId']).toBe(PAGO_ID);
    expect(await pago(PAGO_ID)).toMatchObject({
      medio: 'transferencia', referencia: 'op 12345', evidencia: `tenants/${A}/pagos/${PAGO_ID}/evidencia.jpg`, estado: 'confirmado',
      evidenciaMeta: META,
    });
    expect((await auditoria('pago_manual'))[0]).toMatchObject({ evidenciaMeta: META });
    // El mismo id no se registra dos veces.
    await rechaza(correr(conEvidencia(true), manual({ medio: 'transferencia', referencia: 'op 12345', pagoId: PAGO_ID, evidencia: 'evidencia.jpg' })), 'already-exists');
    expect(await pagosDe()).toHaveLength(1);
  });
});

// ===========================================================================
describe('registrarPagoManual: lo que hace un pago bien cargado', () => {
  it('efectivo, 1 mes: el pago nace confirmado con todo, la cuenta se deriva, hay auditoría y bitácora', async () => {
    const r = await correr(indice.registrarPagoManual, manual());
    expect(r).toMatchObject({
      monto: 630, montoUsd: 50, moneda: 'BOB', monedaLista: 'USD',
      periodoPagado: HOY, cubiertoHasta: HOY, bolsa: 0, plan: 'crecimiento', modalidad: 'prepago', pendienteAnulado: null,
    });
    const id = r['pagoId'] as string;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await pago(id)).toMatchObject({
      tipo: 'mensualidad', plan: 'crecimiento', meses: 1, montoUsd: 50, monto: 630, moneda: 'BOB', monedaLista: 'USD',
      tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY, montoRecibidoBs: 630,
      estado: 'confirmado', medio: 'efectivo', canal: 'manual', referencia: 'recibido por Andres',
      confirmadoPor: { origen: 'propietario', uid: 'prop-1' }, descripcion: 'Crecimiento · 1 mes', cubiertoHasta: HOY, creadoPor: 'prop-1',
    });
    const c = await cuenta();
    expect(c).toMatchObject({
      modalidad: 'prepago', periodoPagado: HOY, plan: 'crecimiento', limites: limitesDe('crecimiento'),
      estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD', bolsa: 0,
    });
    expect(c['proximoVencimiento']).toBeDefined();
    expect(c['pagoPendienteId']).toBeUndefined();
    const [a] = await auditoria('pago_manual');
    expect(a).toMatchObject({ uid: 'prop-1', pagoId: id, tipo: 'mensualidad', plan: 'crecimiento', meses: 1, medio: 'efectivo', cubiertoHasta: HOY, evidencia: null });
    const [b] = await bitacora('pago_registrado');
    expect(b).toMatchObject({ resultado: 'ok', canal: 'panel', codigo: 'propietario' });
    expect(await bitacora('reanudacion_servicio')).toHaveLength(0);
  });

  it('con un corte APLICADO, pagar lo borra y deja `reanudacion_servicio`; uno observado no la deja', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).set({ modalidad: 'prepago', corte: { motivo: 'sin_pago', desde: Timestamp.now(), perdidas: 3, aplicado: true } }, { merge: true });
    await correr(indice.registrarPagoManual, manual());
    expect((await cuenta())['corte']).toBeUndefined();
    expect(await bitacora('reanudacion_servicio')).toHaveLength(1);

    await limpiar(A);
    await db.doc(`tenants/${A}/cuenta/estado`).set({ ...CUENTA_BASE, modalidad: 'prepago', corte: { motivo: 'sin_pago', desde: Timestamp.now(), perdidas: 3, aplicado: false } });
    await correr(indice.registrarPagoManual, manual());
    expect((await cuenta())['corte']).toBeUndefined();
    expect(await bitacora('reanudacion_servicio')).toHaveLength(0);
  });

  it('6 meses regalan una bolsa; una bolsa suma 30 por unidad; la instalación no cambia la cuenta', async () => {
    await correr(indice.registrarPagoManual, manual({ meses: 6, montoRecibidoBs: 3780 }));
    expect(await cuenta()).toMatchObject({ periodoPagado: sumarMeses(HOY, 5), bolsa: 30, modalidad: 'prepago' });
    await correr(indice.registrarPagoManual, manual({ tipo: 'bolsa', cantidad: 2, plan: undefined, meses: undefined, montoRecibidoBs: 252 }));
    expect(await cuenta()).toMatchObject({ periodoPagado: sumarMeses(HOY, 5), bolsa: 90 });
    const r = await correr(indice.registrarPagoManual, manual({ tipo: 'instalacion', plan: undefined, meses: undefined, montoRecibidoBs: 819 }));
    expect(await pago(r['pagoId'] as string)).toMatchObject({ tipo: 'instalacion', montoUsd: 65, monto: 819, estado: 'confirmado' });
    expect(await cuenta()).toMatchObject({ periodoPagado: sumarMeses(HOY, 5), bolsa: 90 });
    expect(await pagosDe()).toHaveLength(3);
  });

  it('pagar otro plan ES cambiar de plan: límites, catálogo y espejo de la ficha', async () => {
    await correr(indice.registrarPagoManual, manual({ plan: 'pro', meses: 3, montoRecibidoBs: 3402 }));
    expect(await cuenta()).toMatchObject({ plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, periodoPagado: sumarMeses(HOY, 2), montoMensual: 90 });
    expect((await ficha())['plan']).toBe('pro');
  });

  it('con el mes en curso ya pagado, la mensualidad cubre el siguiente', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).set({ modalidad: 'prepago', periodoPagado: HOY }, { merge: true });
    await correr(indice.registrarPagoManual, manual());
    expect(await cuenta()).toMatchObject({ periodoPagado: sumarMeses(HOY, 1) });
  });

  it('una bolsa sola sobre un comercio sin modalidad lo vuelve prepago sin mes pagado: queda vencido', async () => {
    await correr(indice.registrarPagoManual, manual({ tipo: 'bolsa', cantidad: 1, plan: undefined, meses: undefined, montoRecibidoBs: 126 }));
    const c = await cuenta();
    expect(c).toMatchObject({ modalidad: 'prepago', bolsa: 30, estadoPago: 'vencido' });
    expect(c['periodoPagado']).toBeUndefined();
  });
});

// ===========================================================================
describe('registrarPagoManual: un solo pendiente por cuenta', () => {
  it('con un QR EMITIDO en el cobrador y sin cliente para anularlo, ABORTA y no carga nada', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + 'a'.repeat(64));
    const d = await rechaza(correr(indice.registrarPagoManual, manual()), 'failed-precondition');
    expect(d).toMatchObject({ pagoId: PAGO_ID, cobroId: 'cons-' + 'a'.repeat(64) });
    expect((await pago(PAGO_ID))!['estado']).toBe('pendiente');
    expect((await cuenta())['pagoPendienteId']).toBe(PAGO_ID);
    expect(await pagosDe()).toHaveLength(1);
    expect((await db.doc(`cobrosPendientes/${PAGO_ID}`).get()).exists).toBe(true);
  });

  it('un pagoId igual al del pendiente, o uno que ya existe, se rechaza SIN anular el QR (LOW 4)', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + '9'.repeat(64));
    const anular = vi.fn(async () => ({ resultado: 'anulado' as const }));
    const f = pagos.crearRegistrarPagoManual({ anular });
    await rechaza(correr(f, manual({ pagoId: PAGO_ID })), 'invalid-argument');
    // Un id de un pago que ya existe (otro, confirmado) tampoco llega a anular.
    await db.doc(`tenants/${A}/pagos/${OTRO_ID}`).set({ estado: 'confirmado', tipo: 'bolsa', cantidad: 1 });
    await rechaza(correr(f, manual({ pagoId: OTRO_ID })), 'already-exists');
    expect(anular).not.toHaveBeenCalled();
    expect((await pago(PAGO_ID))!['estado']).toBe('pendiente');
    expect((await cuenta())['pagoPendienteId']).toBe(PAGO_ID);
  });

  it('una reserva SIN QR emitido se anula acá antes de cargar, y queda escrito', async () => {
    await sembrarPendiente(PAGO_ID, null);
    const r = await correr(indice.registrarPagoManual, manual());
    expect(r['pendienteAnulado']).toBe(PAGO_ID);
    expect(await pago(PAGO_ID)).toMatchObject({ estado: 'anulado', motivoAnulacion: 'pago_manual', anuladoPor: 'novuchat' });
    expect((await pago(r['pagoId'] as string))!['estado']).toBe('confirmado');
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect((await db.doc(`cobrosPendientes/${PAGO_ID}`).get()).exists).toBe(false);
    expect(await auditoria('pago_anulado')).toHaveLength(1);
    expect((await auditoria('pago_manual'))[0]).toMatchObject({ pendienteAnulado: PAGO_ID });
  });

  it('si el cobrador dice que ese QR YA SE PAGÓ, se aplica el del banco y el manual se rechaza', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + 'b'.repeat(64));
    const anular = vi.fn(async () => ({ resultado: 'pagado' as const, estado: 'confirmado' }));
    const f = pagos.crearRegistrarPagoManual({ anular });
    const d = await rechaza(correr(f, manual()), 'failed-precondition');
    expect(anular).toHaveBeenCalledWith(A, PAGO_ID, 'pago_manual');
    expect(d).toMatchObject({ pagoId: PAGO_ID, estado: 'confirmado' });
    expect(await pagosDe()).toHaveLength(1);
    expect(await auditoria('pago_manual')).toHaveLength(0);
  });

  it('con un pago tardío EN REVISIÓN en el cobrador, no se carga nada', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + 'c'.repeat(64));
    const f = pagos.crearRegistrarPagoManual({ anular: async () => ({ resultado: 'en_revision' as const }) });
    await rechaza(correr(f, manual()), 'failed-precondition');
    expect(await pagosDe()).toHaveLength(1);
  });

  it('si el cobrador anuló el QR, el manual se carga (el camino de A-2)', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + 'd'.repeat(64));
    const anular = vi.fn(async () => {
      // Lo que hace `anularCobroVivo`: marca el pendiente acá y libera la cuenta.
      await db.doc(`tenants/${A}/pagos/${PAGO_ID}`).update({ estado: 'anulado' });
      await db.doc(`tenants/${A}/cuenta/estado`).update({ pagoPendienteId: FieldValue.delete() });
      return { resultado: 'anulado' as const };
    });
    const r = await correr(pagos.crearRegistrarPagoManual({ anular }), manual());
    expect(r['pendienteAnulado']).toBe(PAGO_ID);
    expect((await pago(r['pagoId'] as string))!['estado']).toBe('confirmado');
  });

  it('si la anulación no dejó cerrado el pendiente, la transacción lo ve y no carga', async () => {
    await sembrarPendiente(PAGO_ID, null);
    // Un `anular` que miente: dice anulado y no toca nada.
    const miente = pagos.crearRegistrarPagoManual({ anular: async () => ({ resultado: 'anulado' as const }) });
    const d = await rechaza(correr(miente, manual()), 'failed-precondition');
    expect(d).toMatchObject({ pagoId: PAGO_ID });
    // Y uno que cierra el pendiente pero deja OTRO en su lugar, en el medio.
    const cambia = pagos.crearRegistrarPagoManual({ anular: async () => {
      await db.doc(`tenants/${A}/pagos/${PAGO_ID}`).update({ estado: 'anulado' });
      await sembrarPendiente(OTRO_ID, null);
      return { resultado: 'anulado' as const };
    } });
    const d2 = await rechaza(correr(cambia, manual()), 'failed-precondition');
    expect(d2).toMatchObject({ pagoId: OTRO_ID });
    expect((await pagosDe()).filter((p) => p['estado'] === 'confirmado')).toHaveLength(0);
    expect(await auditoria('pago_manual')).toHaveLength(0);
  });
});

// ===========================================================================
describe('anularPagoPendiente', () => {
  it('el admin de B sobre A → permission-denied; el operador, el admin con Google, sin verificar o solo con el claim, también', async () => {
    await sembrarPendiente(PAGO_ID, null);
    for (const quien of [ADMIN_B, OPER_A, ADMIN_A_CON_GOOGLE, ADMIN_A_SIN_VERIFICAR, ADMIN_A_SOLO_CLAIM, PROPIETARIO_CON_CONTRASENA]) {
      await rechaza(correr(indice.anularPagoPendiente, { tenantId: A }, quien), 'permission-denied');
    }
    await rechaza(correr(indice.anularPagoPendiente, { tenantId: A }, null), 'unauthenticated');
    expect((await pago(PAGO_ID))!['estado']).toBe('pendiente');
    expect((await cuenta())['pagoPendienteId']).toBe(PAGO_ID);
  });

  it('el admin de A (contraseña, verificado) anula la reserva de su cuenta; queda auditado con quién', async () => {
    await sembrarPendiente(PAGO_ID, null);
    const r = await correr(indice.anularPagoPendiente, { tenantId: A, motivo: 'quiero otro plan' }, ADMIN_A);
    expect(r).toMatchObject({ ok: true, pagoId: PAGO_ID });
    expect(await pago(PAGO_ID)).toMatchObject({ estado: 'anulado', motivoAnulacion: 'quiero otro plan' });
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect((await db.doc(`cobrosPendientes/${PAGO_ID}`).get()).exists).toBe(false);
    expect((await auditoria('anular_pago_pendiente'))[0]).toMatchObject({ uid: 'adm-a', quien: 'admin', pagoId: PAGO_ID });
  });

  it('el propietario también, y la auditoría dice propietario', async () => {
    await sembrarPendiente(PAGO_ID, null);
    await correr(indice.anularPagoPendiente, { tenantId: A, pagoId: PAGO_ID });
    expect((await auditoria('anular_pago_pendiente'))[0]).toMatchObject({ uid: 'prop-1', quien: 'propietario' });
  });

  it('un CONFIRMADO no se anula: se compensa con otro asiento', async () => {
    const r = await correr(indice.registrarPagoManual, manual());
    const id = r['pagoId'] as string;
    await rechaza(correr(indice.anularPagoPendiente, { tenantId: A, pagoId: id }), 'failed-precondition');
    await rechaza(correr(indice.anularPagoPendiente, { tenantId: A, pagoId: id }, ADMIN_A), 'failed-precondition');
    expect((await pago(id))!['estado']).toBe('confirmado');
    expect(await cuenta()).toMatchObject({ periodoPagado: HOY, modalidad: 'prepago' });
  });

  it('sin pendiente → failed-precondition; un pagoId inexistente → not-found; uno mal formado → invalid-argument', async () => {
    await rechaza(correr(indice.anularPagoPendiente, { tenantId: A }, ADMIN_A), 'failed-precondition');
    await rechaza(correr(indice.anularPagoPendiente, { tenantId: A, pagoId: OTRO_ID }, ADMIN_A), 'not-found');
    await rechaza(correr(indice.anularPagoPendiente, { tenantId: A, pagoId: 'p1' }, ADMIN_A), 'invalid-argument');
  });

  it('con un QR emitido en el cobrador y sin cliente, no se marca anulado acá: el banco todavía podría cobrarlo', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + 'e'.repeat(64));
    const d = await rechaza(correr(indice.anularPagoPendiente, { tenantId: A }, ADMIN_A), 'failed-precondition');
    expect(d).toMatchObject({ cobroId: 'cons-' + 'e'.repeat(64) });
    expect((await pago(PAGO_ID))!['estado']).toBe('pendiente');
  });

  it('con el cliente del cobrador inyectado, lo que él diga manda: pagado → se rechaza y no se toca', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + 'f'.repeat(64));
    const f = pagos.crearAnularPagoPendiente({ anular: async () => ({ resultado: 'pagado' as const, estado: 'confirmado' }) });
    await rechaza(correr(f, { tenantId: A }, ADMIN_A), 'failed-precondition');
    expect(await auditoria('anular_pago_pendiente')).toHaveLength(0);
  });
});

// ===========================================================================
describe('suspender y reactivar ya no afirman nada sobre el pago', () => {
  it('suspenderTenant no escribe estadoPago; reactivarTenant tampoco', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).set({ ...CUENTA_BASE, estadoPago: 'al_dia', modalidad: 'prepago', periodoPagado: '2099-12' });
    await correr(indice.suspenderTenant, { tenantId: A, motivo: 'prueba' });
    expect(await cuenta()).toMatchObject({ estadoPago: 'al_dia' });
    expect((await cuenta())['motivoVisible']).toContain('suspendido');
    expect((await ficha())['estado']).toBe('suspendido');

    await db.doc(`tenants/${A}/cuenta/estado`).update({ estadoPago: 'vencido' });
    await correr(indice.reactivarTenant, { tenantId: A });
    expect(await cuenta()).toMatchObject({ estadoPago: 'vencido', motivoVisible: '' });
    expect((await ficha())['estado']).toBe('activo');
  });
});

// ===========================================================================
describe('fijarTelefonosPago', () => {
  it('rechaza más de 5, formatos malos y lo que no es una lista; nada se escribe', async () => {
    await rechaza(correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: ['59170000001', '59170000002', '59170000003', '59170000004', '59170000005', '59170000006'] }, ADMIN_A), 'invalid-argument');
    for (const malo of [['abc'], ['1234567'], ['+591 7 no'], [''], [12345678], ['59170000001x'], ['5917000000123456']]) {
      await rechaza(correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: malo }, ADMIN_A), 'invalid-argument');
    }
    await rechaza(correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: '59170000001' }, ADMIN_A), 'invalid-argument');
    await rechaza(correr(indice.fijarTelefonosPago, { tenantId: A }, ADMIN_A), 'invalid-argument');
    expect((await cuenta())['telefonosPago']).toBeUndefined();
    expect(await auditoria('telefonos_pago')).toHaveLength(0);
  });

  it('el operador, el admin de otro comercio y el admin con proveedor equivocado no pueden', async () => {
    for (const quien of [OPER_A, ADMIN_B, ADMIN_A_CON_GOOGLE, ADMIN_A_SIN_VERIFICAR, ADMIN_A_SOLO_CLAIM]) {
      await rechaza(correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: ['59170000001'] }, quien), 'permission-denied');
    }
    expect((await cuenta())['telefonosPago']).toBeUndefined();
  });

  it('el admin del comercio fija hasta 5, se limpian espacios y símbolos, sin repetidos; auditado con los últimos 4', async () => {
    const r = await correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: ['+591 70000001', '59170000001', '(591) 70000002'] }, ADMIN_A);
    expect(r).toEqual({ ok: true, telefonos: ['59170000001', '59170000002'] });
    expect((await cuenta())['telefonosPago']).toEqual(['59170000001', '59170000002']);
    expect((await auditoria('telefonos_pago'))[0]).toMatchObject({ uid: 'adm-a', quien: 'admin', cantidad: 2, ultimos4: ['0001', '0002'] });
    // La lista vacía los borra, y no toca lo demás de la cuenta.
    await correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: [] }, PROPIETARIO);
    expect(await cuenta()).toMatchObject({ ...CUENTA_BASE, telefonosPago: [] });
  });

  it('un comercio inexistente → not-found; uno dado de baja → failed-precondition, sin escribir (LOW 7)', async () => {
    await rechaza(correr(indice.fijarTelefonosPago, { tenantId: 'pagos-no-existe', telefonos: [] }, PROPIETARIO), 'not-found');
    await db.doc(`tenants/${A}`).update({ estado: 'dado_de_baja' });
    await rechaza(correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: ['59170000001'] }, PROPIETARIO), 'failed-precondition');
    await rechaza(correr(indice.fijarTelefonosPago, { tenantId: A, telefonos: ['59170000001'] }, ADMIN_A), 'failed-precondition');
    expect((await cuenta())['telefonosPago']).toBeUndefined();
    expect(await auditoria('telefonos_pago')).toHaveLength(0);
  });
});

// ===========================================================================
describe('consultarPagoPendiente', () => {
  it('sin pendiente devuelve null; con uno guardado lo resume sin exponer el documento entero', async () => {
    expect(await correr(indice.consultarPagoPendiente, { tenantId: A }, ADMIN_A)).toEqual({ pendiente: null, consultado: false });
    await sembrarPendiente(PAGO_ID, 'cons-' + '1'.repeat(64));
    const r = await correr(indice.consultarPagoPendiente, { tenantId: A }, ADMIN_A);
    expect(r['consultado']).toBe(false);
    expect(r['pendiente']).toMatchObject({ pagoId: PAGO_ID, estado: 'pendiente', monto: 630, montoUsd: 50, cobroEstado: 'QR_ACTIVO', fichaQr: 'f'.repeat(32) });
    expect(r['pendiente']).not.toHaveProperty('creadoPor');
  });

  it('con el cliente del cobrador inyectado, consulta antes de responder', async () => {
    await sembrarPendiente(PAGO_ID, 'cons-' + '2'.repeat(64));
    const consultar = vi.fn(async () => {
      await db.doc(`tenants/${A}/pagos/${PAGO_ID}`).update({ estado: 'vencido' });
      return { aplicado: true, estado: 'vencido' };
    });
    const r = await correr(pagos.crearConsultarPagoPendiente({ consultar }), { tenantId: A }, ADMIN_A);
    expect(consultar).toHaveBeenCalledWith(A, PAGO_ID);
    expect(r).toMatchObject({ pendiente: null, ultimo: { pagoId: PAGO_ID, estado: 'vencido' }, consultado: true });
  });

  it('el admin de B, el operador de A y el admin sin proveedor no consultan A', async () => {
    await sembrarPendiente(PAGO_ID, null);
    for (const quien of [ADMIN_B, OPER_A, ADMIN_A_SOLO_CLAIM, ADMIN_A_CON_GOOGLE]) {
      await rechaza(correr(indice.consultarPagoPendiente, { tenantId: A }, quien), 'permission-denied');
    }
  });
});

// ===========================================================================
describe('aplicarPagoEnTransaccion: la puerta, con una transacción falsa', () => {
  const refs = () => ({
    pago: db.doc(`tenants/${A}/pagos/x`), cuenta: db.doc(`tenants/${A}/cuenta/estado`),
    ficha: db.doc(`tenants/${A}`), cobroPendiente: db.doc('cobrosPendientes/x'),
  });
  const tx = () => ({ update: vi.fn(), set: vi.fn(), delete: vi.fn(), create: vi.fn(), get: vi.fn() });
  const confirmacion = () => ({
    origen: 'banco' as const, cobroId: 'cons-1', riel: 'api-baneco', confirmadoPorCobrador: 'automatico' as const,
    montoRecibidoBs: 630, confirmadoEn: Timestamp.now(), ahoraMs: Date.now(),
  });

  it('lanza si el pago no está pendiente, sin escribir nada', () => {
    const t = tx();
    for (const estado of ['confirmado', 'vencido', 'anulado', undefined]) {
      expect(() => pagos.aplicarPagoEnTransaccion(t as never, refs(), {
        id: 'x', datos: { tipo: 'mensualidad', plan: 'crecimiento', meses: 1, estado }, cuenta: {}, ficha: {},
      }, confirmacion())).toThrow(/no está pendiente/);
    }
    expect(t.update).not.toHaveBeenCalled();
    expect(t.set).not.toHaveBeenCalled();
  });

  it('con un pendiente: una escritura por documento, síncrona, y el resultado', () => {
    const t = tx();
    const r = pagos.aplicarPagoEnTransaccion(t as never, refs(), {
      id: 'x', datos: { tipo: 'mensualidad', plan: 'pro', meses: 2, estado: 'pendiente' },
      cuenta: { plan: 'crecimiento', modalidad: 'prepago', corte: { motivo: 'sin_pago', aplicado: true } }, ficha: {},
    }, { ...confirmacion(), ademas: {
      pago: { cobro: { id: 'cons-1', estado: 'CONFIRMADO' } },
      cuenta: { confirmacionesPendientes: { x: { plantilla: 'pago_confirmado' } } },
    } });
    expect(r).toMatchObject({ periodoPagado: sumarMeses(HOY, 1), cubiertoHasta: sumarMeses(HOY, 1), plan: 'pro', modalidad: 'prepago', bolsa: 0, corteEstabaAplicado: true });
    expect(t.update).toHaveBeenCalledTimes(1);
    expect(t.update.mock.calls[0]![1]).toMatchObject({
      estado: 'confirmado', montoRecibidoBs: 630, cubiertoHasta: sumarMeses(HOY, 1), cobro: { id: 'cons-1', estado: 'CONFIRMADO' },
      confirmadoPor: { origen: 'banco', cobroId: 'cons-1', riel: 'api-baneco', confirmadoPorCobrador: 'automatico' },
    });
    // La cuenta y el espejo de la ficha (cambió el plan): una vez cada uno.
    expect(t.set).toHaveBeenCalledTimes(2);
    const escrituraCuenta = t.set.mock.calls.find((c) => c[0].path.endsWith('cuenta/estado'))![1];
    expect(escrituraCuenta).toMatchObject({ plan: 'pro', limites: limitesDe('pro'), periodoPagado: sumarMeses(HOY, 1), modalidad: 'prepago', estadoPago: 'al_dia', montoMensual: 90, moneda: 'USD', confirmacionesPendientes: { x: { plantilla: 'pago_confirmado' } } });
    expect(t.set.mock.calls.find((c) => c[0].path === `tenants/${A}`)![1]).toEqual({ plan: 'pro' });
    expect(t.delete).not.toHaveBeenCalled();
  });

  it('`ademas` es una lista cerrada: cualquier otra clave lanza y no se escribe nada (LOW 3)', () => {
    const pendiente = { id: 'x', datos: { tipo: 'mensualidad', plan: 'crecimiento', meses: 1, estado: 'pendiente' }, cuenta: {}, ficha: {} };
    const malos = [
      { pago: { estado: 'confirmado' } }, { pago: { cubiertoHasta: '2099-12' } }, { pago: { confirmadoPor: { origen: 'banco' } } },
      { cuenta: { periodoPagado: '2099-12' } }, { cuenta: { bolsa: 9999 } }, { cuenta: { modalidad: 'demostracion' } },
      { cuenta: { cobro: {} } }, { pago: { confirmacionesPendientes: {} } }, { ficha: { plan: 'pro' } }, { pago: 'x' },
    ];
    for (const ademas of malos) {
      const t = tx();
      expect(() => pagos.aplicarPagoEnTransaccion(t as never, refs(), pendiente, { ...confirmacion(), ademas } as never)).toThrow(/no se admite|objeto/);
      expect(t.update).not.toHaveBeenCalled();
      expect(t.set).not.toHaveBeenCalled();
    }
    expect((pagos as Record<string, unknown>)['aplicacionDe']).toBeUndefined();
  });

  it('los campos propios ganan sobre `ademas` aunque vinieran con el mismo nombre', () => {
    // `cobro` es lo único admitido en el pago: no puede pisar el estado.
    const t = tx();
    pagos.aplicarPagoEnTransaccion(t as never, refs(), {
      id: 'x', datos: { tipo: 'mensualidad', plan: 'crecimiento', meses: 1, estado: 'pendiente' }, cuenta: {}, ficha: {},
    }, { ...confirmacion(), ademas: { pago: { cobro: { estado: 'CONFIRMADO' } } } });
    expect(t.update.mock.calls[0]![1]).toMatchObject({ estado: 'confirmado', cobro: { estado: 'CONFIRMADO' } });
  });

  it('camposDerivadosDeCuenta: los cuatro campos, listos para escribir', () => {
    const d = pagos.camposDerivadosDeCuenta({ plan: 'crecimiento', modalidad: 'prepago', periodoPagado: '2099-12' }, null, Date.now());
    expect(d).toMatchObject({ estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD' });
    expect(d['proximoVencimiento']).toBeInstanceOf(Timestamp);
    expect(pagos.camposDerivadosDeCuenta({ plan: 'crecimiento' }, null, Date.now())).toMatchObject({ estadoPago: 'sin_cargo', montoMensual: 0 });
    expect(pagos.camposDerivadosDeCuenta({ plan: 'crecimiento', modalidad: 'prepago' }, null, Date.now())).toMatchObject({ estadoPago: 'vencido', montoMensual: 50 });
    expect(pagos.camposDerivadosDeCuenta({ plan: 'crecimiento', modalidad: 'prepago', periodoPagado: '2099-12', pagoPendienteId: PAGO_ID }, null, Date.now())).toMatchObject({ estadoPago: 'pendiente' });
    expect(pagos.puertaDePagos.camposDerivados).toBe(pagos.camposDerivadosDeCuenta);
  });
});

// ===========================================================================
describe('exigirAdminDe exige el proveedor, como las reglas', () => {
  const p = (auth: object | null) => ({ data: {}, auth, rawRequest: {} }) as never;
  it('solo el claim, Google, o sin verificar → permission-denied; contraseña verificada → el uid', () => {
    for (const quien of [ADMIN_A_SOLO_CLAIM, ADMIN_A_CON_GOOGLE, ADMIN_A_SIN_VERIFICAR, ADMIN_B, PROPIETARIO]) {
      expect(() => exigirAdminDe(p(quien), A)).toThrow(expect.objectContaining({ code: 'permission-denied' }));
    }
    expect(() => exigirAdminDe(p(null), A)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
    expect(exigirAdminDe(p(ADMIN_A), A)).toBe('adm-a');
  });
});
