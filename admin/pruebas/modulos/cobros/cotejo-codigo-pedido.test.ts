/**
 * `codigoPedido` EN LA RESPUESTA DE `cotejarComprobanteVenta` (Walisuma, PR-S), contra el emulador.
 *
 * Contrato: al cerrarse la venta (válido o aproximado) y SOLO si el comercio tiene
 * `config/pedidos.prefijoCodigo`, la respuesta trae `codigoPedido: "<PREFIJO>-AAMMDD-NNN"`,
 * IDEMPOTENTE por pedido (el reintento del mismo comprobante, o un segundo cotejo del mismo
 * pedido, devuelve el MISMO código y no consume otro correlativo). `montoLeido` viaja en
 * el `aproximado` para que el flujo nombre la diferencia.
 *
 * LO QUE SE NIEGA: sin prefijo, ninguna respuesta lleva `codigoPedido` ni se crea contador; un
 * inválido, un tardío o un `ya_resuelto` no consumen correlativo; dos pedidos simultáneos no
 * comparten código.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-del-cotejo-de-venta-v2';
process.env['INGESTA_CLIENTE12'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { cotejarComprobanteVenta } = await import('../../../functions/src/modulos/cobros/cotejoVenta.ts');
const { solicitudDeCobroTras, idDeCierreDeVenta } = await import('../../../functions/src/modulos/cobros/cobroVenta.ts');
const { diaLaPaz } = await import('../../../functions/src/core/turno/correlativo.ts');

const CON = 'codigo-pedido-con';     // con prefijo
const SIN = 'codigo-pedido-sin';
const EXA = 'codigo-pedido-exacto';   // con prefijo y montoExacto === true
const CAD = 'codigo-pedido-cadena';   // con prefijo y montoExacto === 'true' (no activa)     // sin prefijo
const NUM_CON = '1000000071';
const NUM_SIN = '1000000072';
const NUM_EXA = '1000000073';
const NUM_CAD = '1000000074';
const MIN = 60_000;
const CUENTA = '1000000890';
const TITULAR = 'Juan Carlos Pérez Gómez';

interface Respuesta { codigo: number; cuerpo: any }

async function llamar(numero: string, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cab: Record<string, string> = { 'x-novuchat-numero': numero, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
  const leer = (n: string) => cab[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cab, get: leer, header: leer };
  const r: Respuesta = { codigo: 0, cuerpo: null };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (cotejarComprobanteVenta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

function enLaPaz(ms: number): { fecha: string; hora: string } {
  const d = new Date(ms - 4 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return { fecha: `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, hora: `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}` };
}
const leidoDe = (monto: string) => ({ monto, cuentaDestino: CUENTA, nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', banco: 'BNB', ...enLaPaz(Date.now()) });
const comp = (numero: string, tel: string, monto: string, idMeta: string) =>
  llamar(numero, { telefono: tel, legible: true, leido: leidoDe(monto), idMeta });

async function sembrar(t: string, tel: string, haceMin = 2) {
  const referencia = `wamid.qr-${tel}`;
  const enviado = Date.now() - haceMin * MIN;
  const tr = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: referencia }, enviado);
  await db.doc(`tenants/${t}/conversaciones/wa_${tel}`).set({
    nombreContacto: 'Cliente de prueba',
    solicitud: {
      etapa: 'qr_enviado', desde: Timestamp.fromMillis(enviado), qrEnviadoEn: Timestamp.fromMillis(enviado),
      evento: { id: referencia, calendario: '' }, cotejos: 0, seguimientos: 0, seguimientoEn: null,
      reactivadaEn: null, monto: 100, ...(tr.cambios ?? {}),
    },
  });
}

const contador = async (t: string) =>
  (await db.doc(`tenants/${t}/contadores/pedidos-${diaLaPaz(Date.now())}`).get());

async function limpiar(t: string, numero: string, prefijo: string | null, extraPedidos: Record<string, unknown> = {}) {
  for (const c of ['auditoria', 'bitacora', 'conversaciones', 'cierres', 'pedidos', 'contadores']) {
    for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) {
      for (const p of (await d.ref.collection('privado').get()).docs) await p.ref.delete();
      await d.ref.delete();
    }
  }
  await db.doc(`rutasWhatsApp/${numero}`).set({ tenantId: t, flujo: 'venta', aliasSecreto: 'cliente12', estado: 'activo' });
  await db.doc(`tenants/${t}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'] });
  await db.doc(`tenants/${t}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: 'Tienda', zonaHoraria: 'America/La_Paz', moneda: 'BOB' });
  await db.doc(`tenants/${t}/config/venta`).set({
    cobroReal: { activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'carga-de-prueba', nombreCuenta: TITULAR, cuentas: [CUENTA], banco: 'BNB' },
  });
  if (prefijo || Object.keys(extraPedidos).length) await db.doc(`tenants/${t}/config/pedidos`).set({ ...(prefijo ? { prefijoCodigo: prefijo } : {}), ...extraPedidos });
}

beforeAll(async () => {
  await limpiar(CON, NUM_CON, 'WAL');
  await limpiar(SIN, NUM_SIN, null);
  await limpiar(EXA, NUM_EXA, 'WAL', { montoExacto: true });
  await limpiar(CAD, NUM_CAD, 'WAL', { montoExacto: 'true' });
}, 120_000);

describe('con prefijo configurado', () => {
  it('un comprobante válido cierra y trae WAL-AAMMDD-001 con la fecha de La Paz', async () => {
    await sembrar(CON, '59100000101');
    const r = await comp(NUM_CON, '59100000101', '100', 'wamid.k1');
    expect(r.cuerpo).toMatchObject({ estado: 'valido', codigoPedido: `WAL-${diaLaPaz(Date.now())}-001` });
    expect((await contador(CON)).get('ultimo')).toBe(1);
  });
  it('el mismo comprobante reprocesado devuelve el MISMO código y no consume otro', async () => {
    const r = await comp(NUM_CON, '59100000101', '100', 'wamid.k1');
    expect(r.cuerpo).toMatchObject({ estado: 'valido', repetido: true, codigoPedido: `WAL-${diaLaPaz(Date.now())}-001` });
    expect((await contador(CON)).get('ultimo')).toBe(1);
  });
  it('un segundo comprobante del mismo pedido ya cerrado (ya_resuelto) no consume correlativo y repite el código', async () => {
    const r = await comp(NUM_CON, '59100000101', '100', 'wamid.k1-otro');
    expect(r.cuerpo).toMatchObject({ estado: 'ya_resuelto', codigoPedido: `WAL-${diaLaPaz(Date.now())}-001` });
    expect((await contador(CON)).get('ultimo')).toBe(1);
  });
  it('un pedido aproximado trae código Y el monto leído para nombrar la diferencia', async () => {
    await sembrar(CON, '59100000102');
    const r = await comp(NUM_CON, '59100000102', '101', 'wamid.k2');
    expect(r.cuerpo).toMatchObject({ estado: 'aproximado', montoLeido: 101, importe: 100, montoDistinto: true, codigoPedido: `WAL-${diaLaPaz(Date.now())}-002` });
  });
  it('un inválido NO consume correlativo ni trae código', async () => {
    await sembrar(CON, '59100000103');
    const r = await comp(NUM_CON, '59100000103', '50', 'wamid.k3');
    expect(r.cuerpo.estado).toBe('reintentar');
    expect(r.cuerpo.codigoPedido).toBeUndefined();
    expect((await contador(CON)).get('ultimo')).toBe(2);
  });
  it('un tardío NO consume correlativo', async () => {
    await sembrar(CON, '59100000104', 20);
    const r = await comp(NUM_CON, '59100000104', '100', 'wamid.k4');
    expect(r.cuerpo.estado).toBe('tardio');
    expect(r.cuerpo.codigoPedido).toBeUndefined();
    expect((await contador(CON)).get('ultimo')).toBe(2);
  });
  it('cinco ventas que cierran a la vez reciben códigos distintos', async () => {
    const tels = ['59100000111', '59100000112', '59100000113', '59100000114', '59100000115'];
    for (const t of tels) await sembrar(CON, t);
    const rs = await Promise.all(tels.map((t) => comp(NUM_CON, t, '100', `wamid.p-${t}`)));
    const codigos = rs.map((r) => r.cuerpo.codigoPedido);
    expect(codigos.every((c) => typeof c === 'string')).toBe(true);
    expect(new Set(codigos).size).toBe(5);
    expect((await contador(CON)).get('ultimo')).toBe(7);
  });
});

describe('cierre previo sin código (lo registró otro camino) y luego hay prefijo', () => {
  // DECISIÓN: si el cierre del pedido ya existía SIN código y el comercio ahora tiene prefijo, el cotejo que lo
  // reescribe LE ASIGNA el código (uno solo, en la misma transacción que el contador) y lo guarda en el cierre; de ahí
  // en adelante es idempotente: el reintento y el segundo comprobante devuelven ese mismo, sin mover el contador.
  it('se le asigna un código una sola vez y después se repite el mismo', async () => {
    const tel = '59100000121';
    await sembrar(CON, tel);
    await db.doc(`tenants/${CON}/cierres/${idDeCierreDeVenta(`wamid.qr-${tel}`)}`).set({
      tipo: 'venta', ocurridoEn: Timestamp.now(), referencia: `wamid.qr-${tel}`, monto: 100, moneda: 'BOB',
    });
    const antes = (await contador(CON)).get('ultimo');
    const r = await comp(NUM_CON, tel, '100', 'wamid.pc1');
    expect(r.cuerpo).toMatchObject({ estado: 'valido', codigoPedido: `WAL-${diaLaPaz(Date.now())}-${String(antes + 1).padStart(3, '0')}` });
    expect((await db.doc(`tenants/${CON}/cierres/${idDeCierreDeVenta(`wamid.qr-${tel}`)}`).get()).get('codigoPedido')).toBe(r.cuerpo.codigoPedido);
    expect((await contador(CON)).get('ultimo')).toBe(antes + 1);
    const otra = await comp(NUM_CON, tel, '100', 'wamid.pc1');            // reintento
    const segundo = await comp(NUM_CON, tel, '100', 'wamid.pc1-bis');    // otro comprobante del mismo pedido
    expect(otra.cuerpo.codigoPedido).toBe(r.cuerpo.codigoPedido);
    expect(segundo.cuerpo.codigoPedido).toBe(r.cuerpo.codigoPedido);
    expect((await contador(CON)).get('ultimo')).toBe(antes + 1);
  });
  it('un cierre previo SIN prefijo en el comercio sigue sin código', async () => {
    const tel = '59100000203';
    await sembrar(SIN, tel);
    await db.doc(`tenants/${SIN}/cierres/${idDeCierreDeVenta(`wamid.qr-${tel}`)}`).set({ tipo: 'venta', ocurridoEn: Timestamp.now(), referencia: `wamid.qr-${tel}`, monto: 100, moneda: 'BOB' });
    const r = await comp(NUM_SIN, tel, '100', 'wamid.pc2');
    expect(r.cuerpo.estado).toBe('valido');
    expect('codigoPedido' in r.cuerpo).toBe(false);
  });
});

describe('sin prefijo: nada cambia', () => {
  it('el cierre no trae codigoPedido y no se crea contador', async () => {
    await sembrar(SIN, '59100000201');
    const r = await comp(NUM_SIN, '59100000201', '100', 'wamid.s1');
    expect(r.cuerpo.estado).toBe('valido');
    expect('codigoPedido' in r.cuerpo).toBe(false);
    expect((await contador(SIN)).exists).toBe(false);
    const repetido = await comp(NUM_SIN, '59100000201', '100', 'wamid.s1');
    expect('codigoPedido' in repetido.cuerpo).toBe(false);
  });
  it('el aproximado sigue trayendo montoLeido', async () => {
    await sembrar(SIN, '59100000202');
    const r = await comp(NUM_SIN, '59100000202', '101', 'wamid.s2');
    expect(r.cuerpo).toMatchObject({ estado: 'aproximado', montoLeido: 101 });
    expect('codigoPedido' in r.cuerpo).toBe(false);
  });
});

describe('config/pedidos.montoExacto === true: un monto distinto es observado, no cierra', () => {
  // CONTRATO: con `montoExacto === true` (booleano estricto) un comprobante `aproximado` NO cierra la venta, NO consume
  // correlativo ni código y NO marca el cierre: responde `estado: 'reintentar'` (el estado que el contrato ya usa para «observado»,
  // con su tope de intentos) y `motivo: 'monto_distinto'`, más `montoLeido`, `montoEsperado` y `diferencia` (leído - esperado).
  it('el aproximado no cierra: reintentar con montoLeido, montoEsperado y diferencia; sin cierre ni contador', async () => {
    await sembrar(EXA, '59100000301');
    const r = await comp(NUM_EXA, '59100000301', '101', 'wamid.x1');
    expect(r.cuerpo).toMatchObject({
      estado: 'reintentar', motivo: 'monto_distinto', montoLeido: 101, montoEsperado: 100, diferencia: 1,
      montoDistinto: true, cierreId: null, intentos: 1, intentosRestantes: 2,
    });
    expect(r.cuerpo.codigoPedido).toBeUndefined();
    expect((await db.collection(`tenants/${EXA}/cierres`).get()).size).toBe(0);
    expect((await contador(EXA)).exists).toBe(false);
  });
  it('luego un comprobante exacto del mismo pedido SÍ cierra y recibe código', async () => {
    const r = await comp(NUM_EXA, '59100000301', '100', 'wamid.x2');
    expect(r.cuerpo).toMatchObject({ estado: 'valido', codigoPedido: `WAL-${diaLaPaz(Date.now())}-001` });
    expect((await db.collection(`tenants/${EXA}/cierres`).get()).size).toBe(1);
  });
  it('el mismo comprobante observado repetido repite lo contestado sin contar otro intento', async () => {
    await sembrar(EXA, '59100000302');
    await comp(NUM_EXA, '59100000302', '99', 'wamid.x3');
    const r = await comp(NUM_EXA, '59100000302', '99', 'wamid.x3');
    expect(r.cuerpo).toMatchObject({ estado: 'reintentar', repetido: true, intentos: 1, montoLeido: 99 });
  });
  it('el tope de intentos de siempre sigue: el tercero pasa a una persona, sin cierre', async () => {
    await sembrar(EXA, '59100000303');
    await comp(NUM_EXA, '59100000303', '101', 'wamid.y1');
    await comp(NUM_EXA, '59100000303', '102', 'wamid.y2');
    const r = await comp(NUM_EXA, '59100000303', '103', 'wamid.y3');
    expect(r.cuerpo).toMatchObject({ estado: 'en_revision', cierreId: null });
  });
  it('un monto exacto se comporta igual que siempre', async () => {
    await sembrar(EXA, '59100000304');
    expect((await comp(NUM_EXA, '59100000304', '100', 'wamid.z1')).cuerpo.estado).toBe('valido');
  });
  it('sin la bandera (comercio sin montoExacto) el aproximado cierra como hoy, con código', async () => {
    await sembrar(CON, '59100000305');
    const r = await comp(NUM_CON, '59100000305', '101', 'wamid.w1');
    expect(r.cuerpo).toMatchObject({ estado: 'aproximado', montoLeido: 101 });
    expect(r.cuerpo.codigoPedido).toBeDefined();
    expect(r.cuerpo.montoEsperado).toBeUndefined();
  });
  it("la bandera como cadena 'true' NO activa: el aproximado cierra", async () => {
    await sembrar(CAD, '59100000306');
    const r = await comp(NUM_CAD, '59100000306', '101', 'wamid.c1');
    expect(r.cuerpo).toMatchObject({ estado: 'aproximado', montoLeido: 101 });
    expect(r.cuerpo.montoEsperado).toBeUndefined();
  });
});
