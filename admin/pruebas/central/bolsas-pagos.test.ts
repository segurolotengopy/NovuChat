/**
 * LAS TRES BOLSAS EN LAS PUERTAS DE COBRO (PR-3, Bloque 1 «planes y bolsas»).
 *
 * Lo que se prueba es que el SERVIDOR decide qué bolsa se vende, aunque la
 * pantalla la oculte y la petición se arme a mano. Cada negativa trae su
 * control positivo en la misma prueba: sin él, un rechazo por otra causa (un
 * pedido mal armado, un TCO vencido) pasaría por «la guarda funciona».
 *
 *  - `bolsa` (30 por USD 10): solo `meta_incluido`; una cuenta sin campo
 *    `tarifa` (Bellido) cuenta como `meta_incluido`.
 *  - `bolsaConversaciones` (300 por USD 15): solo `estandar`.
 *  - `bolsaSalientes` (300 mensajes por USD 10): apagada (`no_habilitada`)
 *    para todos, el propietario incluido, hasta que otro PR la encienda.
 *  - Un QR ya emitido se acredita con LO QUE SE PAGÓ aunque la tarifa haya
 *    cambiado después, y dos avisos del mismo QR no acreditan dos veces.
 *  - `corteSalientes` es del Bloque 2: acá no se toca.
 *
 * Tenants `bol-estandar`, `bol-meta` y `bol-sincampo`; rutas `bol-ruta-1` a `3`.
 * Mismo harness que `cobro-prepago.test.ts` (doble del cobrador, almacén en
 * memoria, emulador de Firestore); alias de ingesta de valor de prueba.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CobradorDoble, firmarAviso } from '../dobles/cobrador.ts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const FUENTE = join(aqui, '..', '..', 'functions', 'src');

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['COBRADOR_DOBLE'] = '1';
// Valores de prueba, no secretos.
const TOKEN = 'token-de-prueba-de-novuchat-sin-valor-real';
const SECRETO_AVISO = 'secreto-de-prueba-del-aviso-de-confirmacion';
process.env['COBRADOR_TOKEN'] = TOKEN;
process.env['COBRADOR_AVISO_SECRETO'] = SECRETO_AVISO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { crearClienteHttp, registrarCobradorDoble } = await import('../../functions/src/central/pagar/cobrador.ts');
const { crearCobroPrepago, avisoCobrador, fijarAlmacenDePrueba } = await import('../../functions/src/central/pagar/cobroPrepago.ts');
const {
  exigirBolsaPermitida, titularidadesDelComercio, aplicarPagoEnTransaccion,
} = await import('../../functions/src/central/pagar/pagos.ts');
const { registrarPagoManual } = await import('../../functions/src/central/pagar/pagosConCobrador.ts') as unknown as {
  registrarPagoManual: { run: (x: unknown) => Promise<Record<string, unknown>> };
};
const { MENSAJE_BOLSA_NO_PERMITIDA, bolsaPermitida } = await import('../../functions/src/central/cuenta/prepago.ts');

const E = 'bol-estandar';
const M = 'bol-meta';
const S = 'bol-sincampo';
const TCO = 12.6;
const HOY = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

// --- El doble, y el almacén en memoria ---------------------------------------
let doble: CobradorDoble;
fijarAlmacenDePrueba({ async guardar() { /* sin Storage */ }, async leer() { return null; } });
function nuevoDoble() {
  doble = new CobradorDoble({ tokens: { [TOKEN]: 'novuchat' } });
  registrarCobradorDoble(crearClienteHttp({ baseUrl: 'https://cobrador.prueba', token: TOKEN, fetchImpl: doble.fetch }));
}

// --- Identidades ---------------------------------------------------------------
const token = (nc: object, proveedor = 'password') =>
  ({ nc, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true });
const ADMIN = (t: string) => ({ uid: `adm-${t}`, token: token({ t: { [t]: 'admin' } }) });
const PROPIETARIO = { uid: 'prop', token: { ...token({ p: true }, 'google.com'), auth_time: Math.floor(Date.now() / 1000) } };

type Peticion = Parameters<typeof crearCobroPrepago.run>[0];
const crear = (data: Record<string, unknown>, auth: object | null) =>
  crearCobroPrepago.run({ data, auth, rawRequest: {} } as unknown as Peticion) as Promise<Record<string, unknown>>;
const manual = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  registrarPagoManual.run({ data, auth, rawRequest: {} });

async function rechaza(p: Promise<unknown>, codigo: string): Promise<{ message: string; details: Record<string, unknown> }> {
  try { await p; } catch (e) {
    expect(e).toMatchObject({ code: codigo });
    const x = e as { message: string; details?: Record<string, unknown> };
    return { message: x.message, details: x.details ?? {} };
  }
  throw new Error(`se esperaba ${codigo} y la llamada pasó`);
}

// --- Lecturas ------------------------------------------------------------------
const cuenta = async (t: string) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const pagos = async (t: string) => (await db.collection(`tenants/${t}/pagos`).get()).docs.map((d) => d.data());
const auditoria = async (t: string, accion: string) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

// --- El aviso del cobrador -----------------------------------------------------
async function avisar(referencia: string): Promise<unknown> {
  const cuerpo = JSON.stringify(doble.avisoDe(referencia));
  const bajas = Object.fromEntries(Object.entries({
    ...firmarAviso(SECRETO_AVISO, cuerpo, Date.now()), 'content-type': 'application/json',
  }).map(([k, v]) => [k.toLowerCase(), v]));
  const leer = (n: string) => bajas[n.toLowerCase()];
  const peticion = { method: 'POST', query: {}, headers: bajas, get: leer, header: leer, body: JSON.parse(cuerpo), rawBody: Buffer.from(cuerpo) };
  let salida: unknown = null;
  const respuesta = {
    status() { return respuesta; }, send(b: unknown) { salida = b; return respuesta; }, json(b: unknown) { salida = b; return respuesta; },
    set() { return respuesta; }, setHeader() { return respuesta; }, getHeader() { return undefined; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (avisoCobrador as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return salida;
}

// --- Semilla -------------------------------------------------------------------
async function limpiar(t: string) {
  for (const c of ['pagos', 'bitacora', 'auditoria']) {
    for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${t}/cuenta/estado`).delete();
}
async function borrarColecciones() {
  for (const c of ['cobrosPendientes', 'cobrosResueltos']) {
    for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  }
}
beforeAll(borrarColecciones);
beforeEach(async () => {
  nuevoDoble();
  await borrarColecciones();
  await Promise.all([E, M, S].map(limpiar));
  for (const t of [E, M, S]) await db.doc(`tenants/${t}`).set({ nombre: `Comercio ${t}`, estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'] });
  await db.doc(`tenants/${E}/cuenta/estado`).set({ plan: 'crecimiento', modalidad: 'prepago', tarifa: 'estandar', bolsa: 0 });
  await db.doc(`tenants/${M}/cuenta/estado`).set({ plan: 'crecimiento', modalidad: 'prepago', tarifa: 'meta_incluido', bolsa: 0 });
  // Como Bellido: sin campo `tarifa`.
  await db.doc(`tenants/${S}/cuenta/estado`).set({ plan: 'crecimiento', modalidad: 'prepago', bolsa: 0 });
  // E tiene un número de NovuChat; M, uno propio del comercio (ruta de OTRO comercio para E).
  await db.doc('rutasWhatsApp/bol-ruta-1').set({ tenantId: E, titularidad: 'novuchat' });
  await db.doc('rutasWhatsApp/bol-ruta-2').set({ tenantId: M, titularidad: 'comercio' });
  await db.doc('rutasWhatsApp/bol-ruta-3').set({ tenantId: S });
  await db.doc('plataforma/tipoCambio').set({ tco: TCO, fecha: HOY, fuente: 'BCB' });
  await db.doc('plataforma/prepago').set({ corteActivo: false, cobrador: { baseUrl: 'https://cobrador.prueba', consumidor: 'novuchat', vigenciaHoras: 72 } });
});

const pedido = (tenantId: string, tipo: string, cantidad: unknown = 1) => ({ tenantId, tipo, cantidad });
/** Datos de una carga manual; el importe sale de la lista y del TCO de la semilla. */
const datosManual = (tenantId: string, tipo: string, usd: number, extra: Record<string, unknown> = {}) => ({
  pagoId: nuevoId(), tenantId, tipo, cantidad: 1, medio: 'efectivo', referencia: 'recibido por prueba',
  tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: HOY, montoRecibidoBs: Math.round(usd * TCO), ...extra,
});
let secuencia = 0;
const nuevoId = () => `bolsa-prueba-${String(++secuencia).padStart(8, '0')}`.padEnd(22, 'x').slice(0, 22);

// ===========================================================================
describe('1. QR: qué bolsa puede pedir cada tarifa', () => {
  it('estandar NO obtiene `bolsa` (texto fijo, también con campos de más) y SÍ obtiene `bolsaConversaciones`', async () => {
    const admin = ADMIN(E);
    const d = await rechaza(crear(pedido(E, 'bolsa'), admin), 'permission-denied');
    expect(d.message).toBe(MENSAJE_BOLSA_NO_PERMITIDA.tarifa);
    expect(d.details).toMatchObject({ motivo: 'tarifa' });
    // Armada a mano, con campos que el servidor no lee: el precio y la cantidad no los pone quien pide.
    await rechaza(crear({ ...pedido(E, 'bolsa'), montoUsd: 0.01, monto: 1, tarifa: 'meta_incluido', plan: 'pro', meses: 6 }, admin), 'permission-denied');
    expect(await pagos(E)).toHaveLength(0);
    expect((await cuenta(E))['pagoPendienteId']).toBeUndefined();
    expect(doble.cobros.size).toBe(0);

    // Control positivo: la de 300 por USD 15 sí.
    const r = await crear(pedido(E, 'bolsaConversaciones'), admin);
    expect(r).toMatchObject({ estado: 'pendiente', tipo: 'bolsaConversaciones', montoUsd: 15 });
    expect(doble.cobros.size).toBe(1);
  });

  it.each([['meta_incluido', M], ['sin campo tarifa', S]])('%s NO obtiene `bolsaConversaciones` y SÍ obtiene `bolsa`', async (_n, t) => {
    const admin = ADMIN(t);
    const d = await rechaza(crear(pedido(t, 'bolsaConversaciones'), admin), 'permission-denied');
    expect(d.message).toBe(MENSAJE_BOLSA_NO_PERMITIDA.tarifa);
    expect(await pagos(t)).toHaveLength(0);
    expect(doble.cobros.size).toBe(0);

    const r = await crear(pedido(t, 'bolsa'), admin);
    expect(r).toMatchObject({ estado: 'pendiente', tipo: 'bolsa', montoUsd: 10 });
    expect(doble.cobros.size).toBe(1);
  });

  it('`bolsaSalientes` queda en failed-precondition (no_habilitada) para todos, el propietario incluido; sin nada reservado', async () => {
    for (const t of [E, M, S]) {
      for (const quien of [ADMIN(t), PROPIETARIO]) {
        const d = await rechaza(crear(pedido(t, 'bolsaSalientes'), quien), 'failed-precondition');
        expect(d.message).toBe(MENSAJE_BOLSA_NO_PERMITIDA.no_habilitada);
        expect(d.details).toMatchObject({ motivo: 'no_habilitada' });
      }
      expect(await pagos(t)).toHaveLength(0);
      expect((await cuenta(t))['pagoPendienteId']).toBeUndefined();
    }
    expect(doble.cobros.size).toBe(0);
    // Control positivo: el mismo comercio y el mismo actor compran la que sí le corresponde.
    expect(await crear(pedido(E, 'bolsaConversaciones'), PROPIETARIO)).toMatchObject({ estado: 'pendiente' });
  });

  it('cantidades 0, 13, 1.5, NaN, texto y null → invalid-argument en los tres tipos', async () => {
    const buenas: Array<[string, string]> = [[E, 'bolsaConversaciones'], [M, 'bolsa'], [E, 'bolsaSalientes']];
    for (const [t, tipo] of buenas) {
      for (const cantidad of [0, 13, 1.5, Number.NaN, '2', null, -1]) {
        await rechaza(crear(pedido(t, tipo, cantidad), ADMIN(t)), 'invalid-argument');
      }
    }
    for (const t of [E, M]) expect(await pagos(t)).toHaveLength(0);
    expect(doble.cobros.size).toBe(0);
    // Control positivo: los extremos válidos (1 y 12) se emiten.
    expect(await crear(pedido(E, 'bolsaConversaciones', 12), ADMIN(E))).toMatchObject({ estado: 'pendiente', montoUsd: 180 });
  });
});

// ===========================================================================
describe('2. QR emitido y tarifa cambiada: se acredita lo pagado, una sola vez', () => {
  it('un QR `bolsa` emitido en meta, con la tarifa pasada a estandar, se acredita con 30; dos avisos no acreditan dos veces', async () => {
    const pagoId = (await crear(pedido(M, 'bolsa'), ADMIN(M)))['pagoId'] as string;
    await db.doc(`tenants/${M}/cuenta/estado`).set({ tarifa: 'estandar' }, { merge: true });
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect(await avisar(pagoId)).toMatchObject({ aplicado: true, estado: 'confirmado' });
    expect(await cuenta(M)).toMatchObject({ bolsa: 30 });
    // Segundo aviso del mismo QR.
    expect(await avisar(pagoId)).toMatchObject({ aplicado: false, estado: 'confirmado' });
    expect(await cuenta(M)).toMatchObject({ bolsa: 30 });
    expect((await cuenta(M))['bolsaSalientes']).toBeUndefined();
  });

  it('el espejo: `bolsaConversaciones` emitida en estandar, con la tarifa vuelta a meta, se acredita con 300', async () => {
    const pagoId = (await crear(pedido(E, 'bolsaConversaciones'), ADMIN(E)))['pagoId'] as string;
    await db.doc(`tenants/${E}/cuenta/estado`).set({ tarifa: 'meta_incluido' }, { merge: true });
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect(await avisar(pagoId)).toMatchObject({ aplicado: true, estado: 'confirmado' });
    expect(await cuenta(E)).toMatchObject({ bolsa: 300 });
    expect(await avisar(pagoId)).toMatchObject({ aplicado: false, estado: 'confirmado' });
    expect(await cuenta(E)).toMatchObject({ bolsa: 300 });
  });
});

// ===========================================================================
describe('3. Pago manual (solo el propietario)', () => {
  it('control positivo: el propietario carga `bolsa` en meta (30) y `bolsaConversaciones` en estandar (300)', async () => {
    expect(await manual(datosManual(M, 'bolsa', 10))).toMatchObject({ bolsa: 30 });
    expect(await manual(datosManual(E, 'bolsaConversaciones', 15))).toMatchObject({ bolsa: 300 });
    expect(await auditoria(M, 'pago_manual')).toHaveLength(1);
    expect(await auditoria(E, 'pago_manual')).toHaveLength(1);
  });

  it('la bolsa que no corresponde a la tarifa NO se carga: ni pago, ni auditoría, ni saldo', async () => {
    const d = await rechaza(manual(datosManual(E, 'bolsa', 10)), 'permission-denied');
    expect(d.message).toBe(MENSAJE_BOLSA_NO_PERMITIDA.tarifa);
    await rechaza(manual(datosManual(M, 'bolsaConversaciones', 15)), 'permission-denied');
    await rechaza(manual(datosManual(S, 'bolsaConversaciones', 15)), 'permission-denied');
    for (const t of [E, M, S]) {
      expect(await pagos(t)).toHaveLength(0);
      expect(await auditoria(t, 'pago_manual')).toHaveLength(0);
      expect((await cuenta(t))['bolsa']).toBe(0);
    }
    // Control positivo: sin cambiar nada más, la que corresponde entra en S.
    expect(await manual(datosManual(S, 'bolsa', 10))).toMatchObject({ bolsa: 30 });
  });

  it('el propietario NO carga `bolsaSalientes`, y no queda pago, auditoría ni saldo; el administrador no carga nada', async () => {
    const d = await rechaza(manual(datosManual(E, 'bolsaSalientes', 10)), 'failed-precondition');
    expect(d.message).toBe(MENSAJE_BOLSA_NO_PERMITIDA.no_habilitada);
    expect(await pagos(E)).toHaveLength(0);
    expect(await auditoria(E, 'pago_manual')).toHaveLength(0);
    expect(await cuenta(E)).toMatchObject({ bolsa: 0 });
    expect((await cuenta(E))['bolsaSalientes']).toBeUndefined();

    for (const [t, tipo, usd] of [[E, 'bolsaConversaciones', 15], [M, 'bolsa', 10], [E, 'bolsaSalientes', 10]] as const) {
      await rechaza(manual(datosManual(t, tipo, usd), ADMIN(t)), 'permission-denied');
    }
    await rechaza(manual(datosManual(E, 'bolsaConversaciones', 15), null), 'unauthenticated');
    expect(await pagos(E)).toHaveLength(0);
    expect(await pagos(M)).toHaveLength(0);
    // Control positivo: el propietario, con la misma forma de petición, sí carga la que corresponde.
    expect(await manual(datosManual(E, 'bolsaConversaciones', 15))).toMatchObject({ bolsa: 300 });
  });

  it('cantidades 0, 13, 1.5, NaN, texto y null → invalid-argument en los tres tipos, y no queda nada', async () => {
    const casos: Array<[string, string, number]> = [[E, 'bolsaConversaciones', 15], [M, 'bolsa', 10], [E, 'bolsaSalientes', 10]];
    for (const [t, tipo, usd] of casos) {
      for (const cantidad of [0, 13, 1.5, Number.NaN, '2', null, undefined]) {
        await rechaza(manual(datosManual(t, tipo, usd, { cantidad })), 'invalid-argument');
      }
    }
    expect(await pagos(E)).toHaveLength(0);
    expect(await pagos(M)).toHaveLength(0);
    expect(await auditoria(E, 'pago_manual')).toHaveLength(0);
    expect(await manual(datosManual(M, 'bolsa', 10))).toMatchObject({ bolsa: 30 });
  });

  it('un pago manual con el mismo pagoId repetido → already-exists, y el saldo no se acredita dos veces', async () => {
    const datos = datosManual(E, 'bolsaConversaciones', 15);
    expect(await manual(datos)).toMatchObject({ bolsa: 300 });
    await rechaza(manual(datos), 'already-exists');
    expect(await cuenta(E)).toMatchObject({ bolsa: 300 });
    expect(await pagos(E)).toHaveLength(1);
    expect(await auditoria(E, 'pago_manual')).toHaveLength(1);
  });
});

// ===========================================================================
describe('4. Titularidades del comercio y bolsa de seguimiento', () => {
  it('`titularidadesDelComercio(E)` no devuelve las rutas de otro comercio', async () => {
    // Control positivo: E ve la suya.
    expect(await titularidadesDelComercio(E)).toEqual(['novuchat']);
    expect(await titularidadesDelComercio(M)).toEqual(['comercio']);
    // La ruta sin campo cuenta como novuchat (el lado seguro) y es de S, no de E.
    expect(await titularidadesDelComercio(S)).toEqual(['novuchat']);
    // Ni con una consulta dentro de transacción.
    const dentro = await db.runTransaction((tx) => titularidadesDelComercio(E, tx));
    expect(dentro).toEqual(['novuchat']);
    expect(await titularidadesDelComercio('bol-no-existe')).toEqual([]);
  });

  it('con la venta encendida (parámetro), la bolsa de seguimiento exige un número `comercio` PROPIO', async () => {
    const e = await cuenta(E);
    // E solo tiene un número de NovuChat (el `comercio` de la ruta-2 es de M).
    expect(bolsaPermitida(e, { tipo: 'bolsaSalientes' }, await titularidadesDelComercio(E), true)).toBe('titularidad');
    // Control positivo: con una ruta `comercio` propia, null.
    await db.doc('rutasWhatsApp/bol-ruta-1').set({ tenantId: E, titularidad: 'comercio' });
    expect(bolsaPermitida(e, { tipo: 'bolsaSalientes' }, await titularidadesDelComercio(E), true)).toBeNull();
    // Y una cuenta meta_incluido no, aunque tenga el número propio.
    expect(bolsaPermitida(await cuenta(M), { tipo: 'bolsaSalientes' }, await titularidadesDelComercio(M), true)).toBe('tarifa');
    // Apagada (por defecto), nunca.
    expect(bolsaPermitida(e, { tipo: 'bolsaSalientes' }, ['comercio'])).toBe('no_habilitada');
  });

  it('`exigirBolsaPermitida` traduce cada motivo a su código y su texto fijo; lo que no es bolsa pasa', () => {
    const estandar = { tarifa: 'estandar' };
    expect(() => exigirBolsaPermitida(estandar, { tipo: 'bolsa', cantidad: 1 }, [])).toThrowError(MENSAJE_BOLSA_NO_PERMITIDA.tarifa);
    expect(() => exigirBolsaPermitida(estandar, { tipo: 'bolsaSalientes', cantidad: 1 }, ['comercio'])).toThrowError(MENSAJE_BOLSA_NO_PERMITIDA.no_habilitada);
    expect(() => exigirBolsaPermitida(estandar, { tipo: 'bolsaConversaciones', cantidad: 1 }, [])).not.toThrow();
    expect(() => exigirBolsaPermitida(estandar, { tipo: 'instalacion' }, [])).not.toThrow();
  });
});

// ===========================================================================
describe('5. aplicarPagoEnTransaccion con una bolsa de seguimiento', () => {
  it('deja bolsaSalientes, Compra y Base; deja `bolsa` intacta y NO toca `corteSalientes`', async () => {
    const id = 'sembrado-a-mano-salientes'.slice(0, 22).padEnd(22, 'z');
    const corteSalientes = { motivo: 'sin_saldo', desde: Timestamp.now(), aplicado: true, marca: 'del-bloque-2' };
    await db.doc(`tenants/${E}/cuenta/estado`).set({
      plan: 'crecimiento', modalidad: 'prepago', tarifa: 'estandar', bolsa: 7, bolsaSalientes: 50, corteSalientes,
    });
    await db.doc(`tenants/${E}/pagos/${id}`).set({
      tipo: 'bolsaSalientes', cantidad: 2, estado: 'pendiente', montoUsd: 20, monto: 252, moneda: 'BOB', medio: 'qr', canal: 'consola',
    });
    const refs = {
      pago: db.doc(`tenants/${E}/pagos/${id}`), cuenta: db.doc(`tenants/${E}/cuenta/estado`),
      ficha: db.doc(`tenants/${E}`), cobroPendiente: db.doc(`cobrosPendientes/${id}`),
    };
    const ahoraMs = Date.now();
    await db.runTransaction(async (tx) => {
      const [p, c, f] = await Promise.all([tx.get(refs.pago), tx.get(refs.cuenta), tx.get(refs.ficha)]);
      aplicarPagoEnTransaccion(tx, refs, { id, datos: p.data() ?? {}, cuenta: c.data() ?? {}, ficha: f.data() ?? {} }, {
        origen: 'propietario', uid: 'prop', montoRecibidoBs: 252, confirmadoEn: Timestamp.fromMillis(ahoraMs), ahoraMs,
      });
    });
    const c = await cuenta(E);
    expect(c).toMatchObject({ bolsaSalientes: 650, bolsaSalientesCompra: id, bolsaSalientesBase: 650, bolsa: 7 });
    expect(c['corteSalientes']).toMatchObject({ motivo: 'sin_saldo', aplicado: true, marca: 'del-bloque-2' });
    expect((await db.doc(`tenants/${E}/pagos/${id}`).get()).get('estado')).toBe('confirmado');
  });

  it('control: una bolsa de conversaciones no escribe campos de seguimiento', async () => {
    expect(await manual(datosManual(E, 'bolsaConversaciones', 15))).toMatchObject({ bolsa: 300 });
    const c = await cuenta(E);
    expect(c['bolsaSalientes']).toBeUndefined();
    expect(c['bolsaSalientesCompra']).toBeUndefined();
    expect(c['bolsaSalientesBase']).toBeUndefined();
  });
});

// ===========================================================================
// UNA PRUEBA POR FUENTE: `bolsaPermitida` lleva TRES argumentos en producción.
// El cuarto existe solo para probar la rama encendida; si alguien lo pasa en
// código de producción, la venta de la bolsa de seguimiento se enciende sin
// que el interruptor (`VENTA_BOLSA_SALIENTES`) lo diga.
function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return n === 'node_modules' ? [] : archivosTs(ruta);
    return ruta.endsWith('.ts') ? [ruta] : [];
  });
}
/** Cuántos argumentos tiene cada llamada `nombre(`…`)` del texto; paréntesis balanceados, cadenas y corchetes. */
function argumentosDeLlamadas(texto: string, nombre: string): number[] {
  const cuentas: number[] = [];
  const re = new RegExp(`(?<![\\w.])${nombre}\\s*\\(`, 'g');
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (/function\s+$/.test(texto.slice(0, m.index))) continue; // la definición
    let nivel = 1, args = 0, hayAlgo = false, comilla = '';
    for (let i = m.index + m[0].length; i < texto.length && nivel > 0; i += 1) {
      const ch = texto[i]!;
      if (comilla) { if (ch === '\\') i += 1; else if (ch === comilla) comilla = ''; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { comilla = ch; hayAlgo = true; continue; }
      if ('([{'.includes(ch)) { nivel += 1; hayAlgo = true; continue; }
      if (')]}'.includes(ch)) { nivel -= 1; continue; }
      if (ch === ',' && nivel === 1) { args += 1; hayAlgo = false; continue; }
      if (!/\s/.test(ch)) hayAlgo = true;
    }
    cuentas.push(args + (hayAlgo ? 1 : 0));
  }
  return cuentas;
}

describe('6. Por fuente: nadie en functions/src pasa un cuarto argumento a `bolsaPermitida`', () => {
  it('el parser cuenta bien: una llamada de 3 argumentos, una de 4, una con coma final y comas dentro de paréntesis y cadenas', () => {
    expect(argumentosDeLlamadas('const m = bolsaPermitida(cuenta, pedido, titularidades);', 'bolsaPermitida')).toEqual([3]);
    expect(argumentosDeLlamadas('bolsaPermitida(cuenta, pedido, titularidades, true)', 'bolsaPermitida')).toEqual([4]);
    expect(argumentosDeLlamadas('bolsaPermitida(\n  f(a, b),\n  { tipo: \'x, y\' },\n  [1, 2],\n)', 'bolsaPermitida')).toEqual([3]);
    expect(argumentosDeLlamadas('export function bolsaPermitida(a, b, c, d = false) {}', 'bolsaPermitida')).toEqual([]);
    expect(argumentosDeLlamadas('unaBolsaPermitida(a, b, c, d)', 'bolsaPermitida')).toEqual([]);
  });

  it('ningún archivo bajo functions/src llama con más de 3 argumentos, y la llamada de pagos.ts SÍ se encuentra', () => {
    const porArchivo = new Map<string, number[]>();
    for (const f of archivosTs(FUENTE)) {
      const cuentas = argumentosDeLlamadas(readFileSync(f, 'utf8'), 'bolsaPermitida');
      if (cuentas.length) porArchivo.set(f.slice(FUENTE.length + 1), cuentas);
    }
    // Control positivo: sin esto, un parser que no encuentra nada pasaría siempre.
    expect(porArchivo.get(join('central', 'pagar', 'pagos.ts'))).toEqual([3]);
    const excedidas = [...porArchivo].filter(([, cs]) => cs.some((n) => n > 3)).map(([f]) => f);
    expect(excedidas).toEqual([]);
  });
});
