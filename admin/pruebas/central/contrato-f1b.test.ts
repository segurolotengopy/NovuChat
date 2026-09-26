/**
 * F1b — CONVERSACIONES, PRECIO Y PRUEBA POR CONTRATO, CONTRA EL EMULADOR.
 *
 * Las Functions reales (`actualizarEstadoCuenta`, `crearCobroPrepago`,
 * `registrarPagoManual`, la aplicación de lo que dice el cobrador y
 * `ejesDeCuenta`), invocadas con `.run()` y un contexto de autenticación
 * fabricado, como `copia-por-contrato.test.ts`. Se escribe negando:
 *
 *  1. UN ADMINISTRADOR DEL COMERCIO NO ESCRIBE NINGUNO de estos campos (ni el
 *     operador, ni el propietario con contraseña o con una sesión vieja). La
 *     prueba de reglas está en `contrato-f1b-reglas.test.ts`.
 *  2. LA COPIA MANDA SOBRE EL PLAN, para las conversaciones y el precio,
 *     también después de un cambio de plan.
 *  3. UN PRECIO FUERA DE CONTRATO SE RECHAZA: el pago manual con el importe de
 *     lista de una cuenta con contrato pide motivo; un QR emitido a otro
 *     importe no se acredita solo (queda en revisión `precio_distinto`); y el
 *     precio no se cambia con una mensualidad pendiente que quedaría así.
 *  4. LA PRUEBA: un mes pasado o sin modalidad prueba se rechaza; la bolsa
 *     fuera de rango también; extender no deja huecos y la bolsa escrita es la
 *     que usa `estadoDeServicio`.
 *
 * Tenants ficticios; ningún nombre de cliente. Los meses se calculan desde
 * el reloj (`mesBolivia`, `sumarMeses`), nunca escritos: la suite no caduca.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CobradorDoble } from '../dobles/cobrador.ts';
import { CATALOGO_PLANES, PLANES, limitesDe, limitesDeCuenta } from '../../functions/src/planes.ts';
import { estadoDeServicio, importeBs, mesBolivia, sumarMeses } from '../../functions/src/prepago.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Valores de prueba, no secretos. Cada suite fija su entorno (`pagos.test.ts`).
process.env['COBRADOR_DOBLE'] ??= '1';
const TOKEN = 'token-de-prueba-de-novuchat-sin-valor-real';
process.env['COBRADOR_TOKEN'] ??= TOKEN;
process.env['COBRADOR_AVISO_SECRETO'] ??= 'secreto-de-prueba-del-aviso-de-confirmacion';

const indice = await import('../../functions/src/index.ts');
const pagos = await import('../../functions/src/pagos.ts');
const { crearClienteHttp, registrarCobradorDoble } = await import('../../functions/src/cobrador.ts');
const { crearCobroPrepago, consultarYAplicar, fijarAlmacenDePrueba } = await import('../../functions/src/cobroPrepago.ts');
const conCobrador = await import('../../functions/src/pagosConCobrador.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'f1b-contrato-a';
const B = 'f1b-contrato-b';
const MES = mesBolivia(Date.now());
const MES_SIGUIENTE = sumarMeses(MES, 1);
const MES_PASADO = sumarMeses(MES, -1);
const TCO = 12.6;
const FECHA_HOY = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

const google = { sign_in_provider: 'google.com' };
const password = { sign_in_provider: 'password' };
const AUTH_TIME = Math.floor(Date.now() / 1000);
const PROPIETARIO = { uid: 'prop-f1b', token: { nc: { p: true }, firebase: google, auth_time: AUTH_TIME } };
const PROPIETARIO_SESION_VIEJA = { uid: 'prop-f1b', token: { nc: { p: true }, firebase: google, auth_time: AUTH_TIME - 7200 } };
const PROPIETARIO_CON_CONTRASENA = { uid: 'prop-f1b2', token: { nc: { p: true }, firebase: password, email_verified: true } };
const ADMIN_A = { uid: 'adm-a', token: { nc: { t: { [A]: 'admin' } }, firebase: password, email_verified: true } };
const ADMIN_B = { uid: 'adm-b', token: { nc: { t: { [B]: 'admin' } }, firebase: password, email_verified: true } };
const OPER_A = { uid: 'oper-a', token: { nc: { t: { [A]: 'oper' } }, firebase: password, email_verified: true } };

type Callable = { run: (r: unknown) => Promise<unknown> };
const correr = (f: unknown, data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  (f as Callable).run({ data, auth, rawRequest: {} }) as Promise<Record<string, unknown>>;
const cuentaDe = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  correr(indice.actualizarEstadoCuenta, { tenantId: A, ...data }, auth);
async function rechaza(p: Promise<unknown>, codigo: string, mensaje?: RegExp) {
  await expect(p).rejects.toMatchObject({ code: codigo, ...(mensaje ? { message: expect.stringMatching(mensaje) } : {}) });
}

const cuenta = async (t = A) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const auditoria = async (accion: string, t = A) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());
const pago = async (id: string, t = A) => (await db.doc(`tenants/${t}/pagos/${id}`).get()).data();

/** Un comercio en producción con Pro, al día, sin contrato. */
const PRO = {
  plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', periodoPagado: '2099-12',
};
/** El mismo, con 800 conversaciones y USD 120 por contrato. */
const PRO_CON_CONTRATO = {
  ...PRO, limites: { ...limitesDe('pro'), conversaciones: 800 }, limitesPorContrato: ['conversaciones'], precioPorContrato: 120,
};
/** Una cuenta en prueba este mes, con 7 conversaciones de prueba. */
const EN_PRUEBA = {
  plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prueba', periodoPrueba: MES, bolsaPrueba: 7,
};

// --- el cobrador en memoria, como `cobro-prepago.test.ts` --------------------
let doble: CobradorDoble;
const archivos = new Map<string, Buffer>();
fijarAlmacenDePrueba({
  async guardar(ruta, bytes) { archivos.set(ruta, bytes); },
  async leer(ruta) { return archivos.get(ruta) ?? null; },
});

async function sembrar(t: string, datos: Record<string, unknown>) {
  for (const col of ['auditoria', 'pagos', 'bitacora']) {
    for (const d of (await db.collection(`tenants/${t}/${col}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', plan: datos['plan'] ?? 'impulso', flujos: ['agendamiento'] });
  await db.doc(`tenants/${t}/cuenta/estado`).set(datos);
}

beforeEach(async () => {
  doble = new CobradorDoble({ tokens: { [TOKEN]: 'novuchat' } });
  registrarCobradorDoble(crearClienteHttp({ baseUrl: 'https://cobrador.prueba', token: TOKEN, fetchImpl: doble.fetch }));
  archivos.clear();
  for (const c of ['cobrosPendientes', 'cobrosResueltos']) {
    for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  }
  await sembrar(A, PRO);
  await sembrar(B, { plan: 'impulso', limites: limitesDe('impulso'), catalogoPlanes: CATALOGO_PLANES });
  await db.doc('plataforma/tipoCambio').set({ tco: TCO, fecha: FECHA_HOY, fuente: 'BCB' });
  await db.doc('plataforma/prepago').set({ corteActivo: false, cobrador: { baseUrl: 'https://cobrador.prueba', consumidor: 'novuchat', vigenciaHoras: 72 } });
});

// ===========================================================================
describe('1. Nadie más que el propietario, con sesión reciente, escribe lo que va por contrato', () => {
  const PEDIDOS: Record<string, unknown>[] = [
    { conversaciones: 800 }, { conversaciones: null }, { precioPorContrato: 120 }, { precioPorContrato: null },
    { modalidad: 'prueba', periodoPrueba: MES_SIGUIENTE }, { modalidad: 'prueba', bolsaPrueba: 40 },
  ];

  it('el ADMINISTRADOR del comercio NO escribe ninguno, ni el de otro comercio, ni el operador, ni el propietario con contraseña', async () => {
    for (const datos of PEDIDOS) {
      for (const quien of [ADMIN_A, ADMIN_B, OPER_A, PROPIETARIO_CON_CONTRASENA]) {
        await rechaza(cuentaDe(datos, quien), 'permission-denied');
      }
      await rechaza(cuentaDe(datos, null), 'unauthenticated');
    }
    expect(await cuenta()).toEqual(PRO);
    for (const accion of ['limites_por_contrato', 'precio_por_contrato', 'estado_cuenta']) expect(await auditoria(accion)).toHaveLength(0);
  });

  it('el propietario con una sesión VIEJA tampoco: todos exigen sesión reciente', async () => {
    for (const datos of PEDIDOS) await rechaza(cuentaDe(datos, PROPIETARIO_SESION_VIEJA), 'unauthenticated', /vuelva a iniciar sesión/);
    expect(await cuenta()).toEqual(PRO);
  });

  it('un valor fuera de rango NO entra, y frena lo demás de la misma llamada: no se escribe nada', async () => {
    for (const malo of [0, -1, 1.5, 100_001, '800', true, {}]) {
      await rechaza(cuentaDe({ conversaciones: malo }), 'invalid-argument', /conversaciones tiene que ser un entero de 1 a/);
    }
    for (const malo of [0, -5, 12.345, 1000.01, '120', Number.NaN, Number.POSITIVE_INFINITY, true, {}]) {
      await rechaza(cuentaDe({ precioPorContrato: malo, umbralOperador: 10, umbralBloqueo: 20 }), 'invalid-argument', /precioPorContrato/);
    }
    for (const malo of [0, -1, 2.5, 1001, '40', null]) {
      await rechaza(cuentaDe({ modalidad: 'prueba', bolsaPrueba: malo }), 'invalid-argument', /bolsaPrueba/);
    }
    expect(await cuenta()).toEqual(PRO);
  });
});

// ===========================================================================
describe('2. La copia y el precio mandan sobre el plan, también después de cambiarlo', () => {
  it('el propietario fija 800 conversaciones y USD 120: copia, marcador, derivados y auditoría con el antes y el después', async () => {
    await cuentaDe({ conversaciones: 800, precioPorContrato: 120 });
    const c = await cuenta();
    expect(c).toMatchObject({
      plan: 'pro', limites: { ...limitesDe('pro'), conversaciones: 800 }, limitesPorContrato: ['conversaciones'],
      precioPorContrato: 120, montoMensual: 120, estadoPago: 'al_dia',
    });
    expect(estadoDeServicio(c, 0, Date.now())).toMatchObject({ incluidas: 800, mensualidadUsd: 120 });
    const [conv] = await auditoria('limites_por_contrato');
    expect(conv).toMatchObject({
      uid: 'prop-f1b', clave: 'conversaciones', plan: 'pro', delPlan: 500,
      antes: { valor: 500, porContrato: false }, despues: { valor: 800, porContrato: true },
    });
    const [precio] = await auditoria('precio_por_contrato');
    expect(precio).toMatchObject({
      uid: 'prop-f1b', plan: 'pro', delPlanUsd: 90,
      antes: { valor: null, porContrato: false, mensualUsd: 90 }, despues: { valor: 120, porContrato: true, mensualUsd: 120 },
    });
    // Repetirlo no deja otra constancia.
    await cuentaDe({ conversaciones: 800, precioPorContrato: 120 });
    expect(await auditoria('limites_por_contrato')).toHaveLength(1);
    expect(await auditoria('precio_por_contrato')).toHaveLength(1);
  });

  it('UN CAMBIO DE PLAN NO PISA NI LAS CONVERSACIONES NI EL PRECIO: baja a Impulso y siguen 800 y USD 120', async () => {
    await sembrar(A, PRO_CON_CONTRATO);
    await cuentaDe({ plan: 'impulso' });
    const c = await cuenta();
    expect(c).toMatchObject({
      plan: 'impulso', limites: { ...limitesDe('impulso'), conversaciones: 800 }, limitesPorContrato: ['conversaciones'],
      precioPorContrato: 120, montoMensual: 120,
    });
    expect(limitesDeCuenta(c).conversaciones).toBe(800);
    const [a] = await auditoria('cambiar_plan');
    expect(a).toMatchObject({ planAntes: 'pro', planDespues: 'impulso', conservadosPorContrato: { conversaciones: 800 } });
    // Cambiar de plan no es fijar el precio: no deja `precio_por_contrato`.
    expect(await auditoria('precio_por_contrato')).toHaveLength(0);
  });

  it('pagar otro plan (pago manual del propietario) también conserva las conversaciones y cobra el precio del contrato', async () => {
    const { periodoPagado: _p, ...sinMesPagado } = PRO_CON_CONTRATO;
    await sembrar(A, sinMesPagado);
    await correr(indice.registrarPagoManual, {
      pagoId: pagos.nuevoPagoId(), tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 1,
      medio: 'efectivo', referencia: 'recibido por la prueba', tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY,
      montoRecibidoBs: importeBs(120, TCO),
    });
    const c = await cuenta();
    expect(c).toMatchObject({ plan: 'crecimiento', limites: { conversaciones: 800 }, precioPorContrato: 120, montoMensual: 120 });
  });

  it('quitarlos es explícito (`null`): vuelven los del plan, y la auditoría lo dice', async () => {
    await sembrar(A, PRO_CON_CONTRATO);
    await cuentaDe({ conversaciones: null, precioPorContrato: null });
    const c = await cuenta();
    expect(c['limites']).toEqual(limitesDe('pro'));
    expect(c['limitesPorContrato']).toBeUndefined();
    expect(c['precioPorContrato']).toBeUndefined();
    expect(c['montoMensual']).toBe(PLANES.pro.precioUsd);
    const [p] = await auditoria('precio_por_contrato');
    expect(p).toMatchObject({ antes: { valor: 120, porContrato: true }, despues: { valor: null, porContrato: false, mensualUsd: 90 } });
  });

  it('ejesDeCuenta dice la mensualidad y su origen, y cuántas conversaciones trae el plan', async () => {
    await sembrar(A, PRO_CON_CONTRATO);
    const r = await correr(indice.ejesDeCuenta, { tenantId: A }, ADMIN_A);
    expect(r['precio']).toEqual({ mensualUsd: 120, porContrato: 120, delPlanUsd: 90 });
    expect(r['limites']).toMatchObject({ conversaciones: 800, porContrato: ['conversaciones'], conversacionesDelPlan: 500 });
    await sembrar(A, PRO);
    expect((await correr(indice.ejesDeCuenta, { tenantId: A }))['precio']).toEqual({ mensualUsd: 90, porContrato: null, delPlanUsd: 90 });
  });

  it('sin cuenta NO se fija un precio suelto: primero el plan', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).delete();
    await rechaza(cuentaDe({ precioPorContrato: 120 }), 'failed-precondition');
    expect((await db.doc(`tenants/${A}/cuenta/estado`).get()).exists).toBe(false);
  });
});

// ===========================================================================
describe('3. Un precio fuera de contrato se rechaza', () => {
  it('el QR de mensualidad sale AL PRECIO DEL CONTRATO: nadie puede pedir otro importe', async () => {
    await sembrar(A, PRO_CON_CONTRATO);
    const r = await correr(crearCobroPrepago, { tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 2, montoUsd: 1 }, ADMIN_A);
    expect(r).toMatchObject({ montoUsd: 240, monto: importeBs(240, TCO) });
    expect(await pago(r['pagoId'] as string)).toMatchObject({ montoUsd: 240, monto: importeBs(240, TCO) });
    expect(doble.cobroPorReferencia(r['pagoId'] as string)).toMatchObject({ montoCentavos: importeBs(240, TCO) * 100 });
  });

  it('el PAGO MANUAL acepta el precio del contrato sin motivo, y RECHAZA el de lista sin motivo', async () => {
    const { periodoPagado: _p, ...sinMesPagado } = PRO_CON_CONTRATO;
    await sembrar(A, sinMesPagado);
    const base = {
      tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 1, medio: 'efectivo', referencia: 'recibido por la prueba',
      tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY,
    };
    // El importe de lista de Pro, en una cuenta de USD 120: fuera de contrato.
    await rechaza(correr(indice.registrarPagoManual, { ...base, pagoId: pagos.nuevoPagoId(), montoRecibidoBs: importeBs(90, TCO) }),
      'invalid-argument', /no es el importe de la cuenta .*motivoDiferencia es obligatorio/);
    expect(await auditoria('pago_manual')).toHaveLength(0);
    expect((await cuenta())['periodoPagado']).toBeUndefined();
    // El del contrato entra sin motivo, y el pago guarda el importe del contrato.
    const pagoId = pagos.nuevoPagoId();
    const r = await correr(indice.registrarPagoManual, { ...base, pagoId, montoRecibidoBs: importeBs(120, TCO) });
    expect(r).toMatchObject({ montoUsd: 120, monto: importeBs(120, TCO), periodoPagado: MES });
    expect(await pago(pagoId)).toMatchObject({ montoUsd: 120, estado: 'confirmado' });
    const [a] = await auditoria('pago_manual');
    expect(a).toMatchObject({ montoUsd: 120, motivoDiferencia: null });
  });

  it('con una mensualidad PENDIENTE, el precio no se cambia si la deja fuera de contrato; sin cambio de importe, sí', async () => {
    const r = await correr(crearCobroPrepago, { tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 1 }, ADMIN_A);
    const pagoId = r['pagoId'] as string;
    expect(r['montoUsd']).toBe(90);
    await rechaza(cuentaDe({ precioPorContrato: 120 }), 'failed-precondition', /fuera de contrato.*anule el cobro pendiente/);
    expect((await cuenta())['precioPorContrato']).toBeUndefined();
    expect(await auditoria('precio_por_contrato')).toHaveLength(0);
    // Fijar por contrato el MISMO importe no deja el QR fuera: se acepta.
    await cuentaDe({ precioPorContrato: 90 });
    expect((await cuenta())['precioPorContrato']).toBe(90);
    expect((await pago(pagoId))?.['estado']).toBe('pendiente');
  });

  it('un QR emitido a la lista y confirmado por el banco DESPUÉS de fijar el contrato NO se acredita solo: queda en revisión', async () => {
    const r = await correr(crearCobroPrepago, { tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 1 }, ADMIN_A);
    const pagoId = r['pagoId'] as string;
    // El contrato llega por otro camino (el script, sin la guarda del QR vivo): lo que importa es la red del cobro.
    await db.doc(`tenants/${A}/cuenta/estado`).set({ precioPorContrato: 120, periodoPagado: MES_PASADO }, { merge: true });
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    const res = await consultarYAplicar(A, pagoId, { via: 'consulta' });
    expect(res).toMatchObject({ aplicado: false, estado: 'pendiente' });
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', revision: 'precio_distinto', cobro: { estado: 'CONFIRMADO' } });
    expect((await cuenta())['periodoPagado']).toBe(MES_PASADO);
    const [a] = await auditoria('pago_precio_distinto');
    expect(a).toMatchObject({ pagoId, montoUsd: 90, precioVigenteUsd: 120 });
    // El propietario lo resuelve con motivo, por la misma puerta: ahí sí suma el mes.
    const conf = await (conCobrador.registrarPagoManual as unknown as Callable).run({
      data: { tenantId: A, confirmarPendiente: pagoId, montoRecibidoBs: r['monto'], motivoDiferencia: 'QR emitido antes del contrato' },
      auth: PROPIETARIO, rawRequest: {},
    }) as Record<string, unknown>;
    expect(conf).toMatchObject({ confirmadoQr: true });
    expect(await pago(pagoId)).toMatchObject({ estado: 'confirmado' });
  });
});

// ===========================================================================
describe('4. La prueba por contrato: su último mes y su bolsa', () => {
  it('un MES PASADO se rechaza, y nada se escribe', async () => {
    await sembrar(A, EN_PRUEBA);
    await rechaza(cuentaDe({ periodoPrueba: MES_PASADO }), 'invalid-argument', /mes pasado/);
    expect(await cuenta()).toEqual(EN_PRUEBA);
  });

  it('SIN MODALIDAD PRUEBA se rechaza (el período y la bolsa); con `modalidad: prueba` en la misma llamada, se acepta', async () => {
    await rechaza(cuentaDe({ periodoPrueba: MES_SIGUIENTE }), 'invalid-argument', /solo vale con modalidad prueba/);
    await rechaza(cuentaDe({ bolsaPrueba: 40 }), 'invalid-argument', /solo vale con modalidad prueba/);
    expect(await cuenta()).toEqual(PRO);
    await cuentaDe({ modalidad: 'prueba', periodoPrueba: MES_SIGUIENTE, bolsaPrueba: 40 });
    expect(await cuenta()).toMatchObject({ modalidad: 'prueba', periodoPrueba: MES_SIGUIENTE, pruebaDesde: MES, bolsaPrueba: 40 });
  });

  it('EXTENDER al mes siguiente no deja hueco: hoy sigue cubierta y en prueba, la bolsa no se reinicia, y la auditoría dice antes y después', async () => {
    await sembrar(A, EN_PRUEBA);
    await cuentaDe({ periodoPrueba: MES_SIGUIENTE });
    const c = await cuenta();
    expect(c).toMatchObject({ periodoPrueba: MES_SIGUIENTE, pruebaDesde: MES, bolsaPrueba: 7, estadoPago: 'al_dia', montoMensual: 0 });
    expect(estadoDeServicio(c, 0, Date.now())).toMatchObject({ cubierto: true, enPrueba: true, operativo: true, bolsaPrueba: 7 });
    const [a] = await auditoria('estado_cuenta');
    expect(a).toMatchObject({
      uid: 'prop-f1b', campos: ['periodoPrueba'], valores: { periodoPrueba: MES_SIGUIENTE }, antes: { periodoPrueba: MES },
      prueba: {
        antes: { periodoPrueba: MES, pruebaDesde: null, bolsaPrueba: 7 },
        despues: { periodoPrueba: MES_SIGUIENTE, pruebaDesde: MES, bolsaPrueba: 7 },
      },
    });
  });

  it('LA BOLSA DE PRUEBA POR CONTRATO se escribe y estadoDeServicio la usa tal cual', async () => {
    await sembrar(A, EN_PRUEBA);
    await cuentaDe({ bolsaPrueba: 40 });
    const c = await cuenta();
    expect(c['bolsaPrueba']).toBe(40);
    expect(estadoDeServicio(c, 0, Date.now())).toMatchObject({ bolsaPrueba: 40, disponibles: 40 });
    const [a] = await auditoria('estado_cuenta');
    expect(a).toMatchObject({ campos: ['bolsaPrueba'], valores: { bolsaPrueba: 40 }, antes: { bolsaPrueba: 7 } });
  });
});
