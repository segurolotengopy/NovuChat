/**
 * PEDIDO DE CATÁLOGO EXTERNO (B5a, Casa Bermejo / NovuTienda), NEGANDO PRIMERO.
 * Pura (`armarPedidoWa`) y emulador (`crearPedidoWa`, gancho). Sin `config/pedidos.catalogoExterno`
 * el comportamiento es el de siempre; con él, solo la forma cerrada entra.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bitacora = vi.hoisted(() => ({ registrar: vi.fn(async () => undefined) }));
vi.mock('../../../functions/src/core/turno/bitacora.ts', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), registrar: bitacora.registrar,
}));

const aqui = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO}`;
const requerir = createRequire(join(aqui, '..', '..', '..', 'functions', 'package.json'));
const { initializeApp, getApps } = requerir('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore } = requerir('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: 'demo-novuchat-pruebas' });
const db = getFirestore();

const { armarPedidoWa, crearPedidoWa, configExternaDe, MAX_LINEAS_WA, MAX_UNIDADES_WA } =
  await import('../../../functions/src/modulos/pedidos/pedidoDelQr.ts');
const { despuesDelTurnoPedidos } = await import('../../../functions/src/modulos/pedidos/alTurno.ts');

type Cfg = { monedas: Array<'BOB' | 'ARS'> };
const CFG_BOB_ARS: Cfg = { monedas: ['BOB', 'ARS'] };
const CFG_ARS: Cfg = { monedas: ['ARS'] };
const ln = (o: Record<string, unknown> = {}) => ({ externa: true, id: 'sku-1', nombre: 'Mesa', cantidad: 2, precioCentavos: 15050, moneda: 'BOB', ...o });
const armar = (lineas: unknown, cfg: Cfg | null = CFG_BOB_ARS, monto: unknown = undefined, fact: unknown = undefined) =>
  armarPedidoWa(lineas, 'retiro', fact, {}, 'BM1', '59170000009', monto, cfg);

describe('sin dato de catálogo externo: idéntico al comportamiento actual', () => {
  it('una línea externa sin config no crea pedido (sin catálogo propio no hay con qué recalcular)', () => {
    for (const cfg of [null, undefined]) {
      const r = armarPedidoWa([ln()], 'retiro', undefined, {}, 'BM1', '5917', undefined, cfg);
      expect(r.pedido).toBeNull(); expect(r.motivo).toBe('sin_lineas');
    }
  });
  it('línea externa sin config: ni el precio ni el nombre del flujo entran aunque el id exista en el catálogo', () => {
    const r = armarPedidoWa([ln({ id: 'taco', precioCentavos: 1 })], 'retiro', undefined,
      { taco: { nombre: 'Taco', precio: 10, moneda: 'BOB', activo: true } }, 'R1', '5917', undefined);
    expect(r.pedido?.total).toBe(20);
    expect(r.pedido?.items[0]).not.toHaveProperty('externa');
    expect(r.pedido).not.toHaveProperty('catalogo');
  });
  it('el camino de catálogo propio da la misma forma: sin `catalogo` ni `precioCentavos` por ítem', () => {
    const r = armarPedidoWa([{ id: 'taco', cantidad: 1 }], 'retiro', undefined,
      { taco: { nombre: 'Taco', precio: 10, moneda: 'BOB', activo: true } }, 'R1', '5917', 10);
    expect(r.pedido?.items[0]).toEqual({ id: 'taco', nombre: 'Taco', cantidad: 1, precio: 10, moneda: 'BOB', subtotal: 10 });
    expect(r.pedido?.totalDistinto).toBe(false);
    expect(r.pedido).not.toHaveProperty('catalogo');
  });
  it('con config activa pero líneas propias (sin `externa`), el camino es el de siempre', () => {
    const r = armarPedidoWa([{ id: 'taco', cantidad: 1 }], 'retiro', undefined,
      { taco: { nombre: 'Taco', precio: 10, moneda: 'BOB', activo: true } }, 'R1', '5917', 10, CFG_BOB_ARS);
    expect(r.pedido?.total).toBe(10); expect(r.pedido).not.toHaveProperty('catalogo');
  });
  it('configExternaDe: solo `activo: true` con monedas BOB/ARS; todo lo demás es null', () => {
    for (const d of [undefined, null, {}, { catalogoExterno: null }, { catalogoExterno: { activo: false, monedas: ['BOB'] } },
      { catalogoExterno: { activo: 'true', monedas: ['BOB'] } }, { catalogoExterno: { activo: true, monedas: [] } },
      { catalogoExterno: { activo: true, monedas: ['USD'] } }, { catalogoExterno: { activo: true } }, 'x']) {
      expect(configExternaDe(d)).toBeNull();
    }
    expect(configExternaDe({ catalogoExterno: { activo: true, monedas: ['ARS', 'USD', 'BOB'] } })).toEqual({ monedas: ['ARS', 'BOB'] });
  });
});

describe('línea externa: lo que NO entra', () => {
  const rechazada = (l: unknown, cfg: Cfg = CFG_BOB_ARS) => {
    const r = armar([l, ln({ id: 'ok-1', cantidad: 1 })], cfg);
    expect(r.pedido?.items.map((i) => i['id'])).toEqual(['ok-1']);
    expect(r.descartados.length).toBeGreaterThan(0);
  };
  it('id inválido', () => { for (const id of ['', '-a', 'a b', 'a/b', 'a__b', 'x'.repeat(101), '.a', 7, null, 'ñ']) rechazada(ln({ id })); });
  it('precio ≤ 0, NaN, Infinity, decimal, string, fuera de rango', () => {
    for (const p of [0, -1, NaN, Infinity, 150.5, '150', null, 100_000_001, Number.MAX_SAFE_INTEGER + 2]) rechazada(ln({ precioCentavos: p }));
  });
  it('moneda no permitida (USD, minúscula, vacía, ausente) o fuera de lo que habilita el tenant', () => {
    for (const m of ['USD', 'bob', '', undefined, 'EUR', 1]) rechazada(ln({ moneda: m }));
    const r = armar([ln({ moneda: 'BOB' }), ln({ id: 'ok-1', cantidad: 1, moneda: 'ARS', precioCentavos: 10000 })], CFG_ARS);
    expect(r.pedido?.items.map((i) => i['id'])).toEqual(['ok-1']); expect(r.descartados).toEqual(['sku-1']);
  });
  it('ARS con precio que no es múltiplo de 100', () => { rechazada(ln({ moneda: 'ARS', precioCentavos: 12345 })); });
  it('cantidad 0, negativa, decimal, string, NaN o sobre los topes', () => {
    for (const c of [0, -1, 1.5, '2', NaN, undefined, MAX_UNIDADES_WA + 1, 1_000_001]) rechazada(ln({ cantidad: c }));
  });
  it('clave desconocida (facturación, teléfono, total, nombre del cliente)', () => {
    for (const k of ['facturacion', 'telefono', 'total', 'totalCentavos', 'cliente']) rechazada(ln({ [k]: 'x' }));
  });
  it('subtotal declarado distinto del calculado', () => { rechazada(ln({ subtotalCentavos: 1 })); });
  it('nombre vacío', () => { rechazada(ln({ nombre: '   ' })); });
  it('sin `externa: true`, dentro de un pedido externo, no se trata como propia', () => {
    const r = armar([ln(), { id: 'taco', cantidad: 1 }]);
    expect(r.pedido?.items).toHaveLength(1); expect(r.descartados).toContain('taco');
  });
  it('id duplicado: queda la primera, la repetida va a descartados', () => {
    const r = armar([ln({ cantidad: 1 }), ln({ cantidad: 5 })]);
    expect(r.pedido?.items).toHaveLength(1); expect(r.pedido?.total).toBe(150.5); expect(r.descartados).toEqual(['sku-1']);
  });
  it('más de MAX_LINEAS_WA: solo entran las primeras', () => {
    const muchas = Array.from({ length: MAX_LINEAS_WA + 5 }, (_, i) => ln({ id: `s${i}`, cantidad: 1 }));
    expect(armar(muchas).pedido?.items).toHaveLength(MAX_LINEAS_WA);
  });
  it('monedas mezcladas: no hay pedido', () => {
    const r = armar([ln(), ln({ id: 'a', moneda: 'ARS', precioCentavos: 10000 })]);
    expect(r.pedido).toBeNull(); expect(r.motivo).toBe('monedas_mezcladas');
  });
  it('todo inválido: sin_lineas', () => { expect(armar([ln({ precioCentavos: 0 })]).motivo).toBe('sin_lineas'); });
});

describe('línea externa: lo que SÍ entra', () => {
  it('BOB: recalcula subtotal y total en centavos; el monto declarado solo marca totalDistinto', () => {
    const r = armar([ln(), ln({ id: 'b', cantidad: 1, precioCentavos: 1, nombre: 'Tornillo', detalle: 'zincado' })], CFG_BOB_ARS, 301.01);
    expect(r.pedido).toMatchObject({ origen: 'whatsapp', moneda: 'BOB', total: 301.01, totalServidorCentavos: 30101, montoQrCentavos: 30101, totalDistinto: false, catalogo: 'externo', estado: 'recibido', costoEnvio: 0 });
    expect(r.pedido?.items[0]).toEqual({ id: 'sku-1', nombre: 'Mesa', cantidad: 2, precio: 150.5, precioCentavos: 15050, moneda: 'BOB', subtotal: 301, externa: true });
    const x = armar([ln()], CFG_BOB_ARS, 1);
    expect(x.pedido?.total).toBe(301); expect(x.pedido?.totalDistinto).toBe(true);
  });
  it('ARS sin QR: moneda ARS, sin monto no es «total distinto»', () => {
    const r = armar([ln({ moneda: 'ARS', precioCentavos: 1250000, cantidad: 3 })], CFG_ARS);
    expect(r.pedido).toMatchObject({ moneda: 'ARS', total: 37500, totalDistinto: false, montoQrCentavos: null });
  });
  it('facturación: solo la que ya se guardaba (documento limpio); el teléfono solo enmascarado', () => {
    const r = armar([ln()], CFG_BOB_ARS, undefined, { nombre: 'Ana', documento: '123 45-6<' });
    expect(r.pedido?.facturacion).toEqual({ nombre: 'Ana', documento: '12345-6' });
    expect(JSON.stringify({ ...r.pedido, conversacionId: 0 })).not.toContain('59170000009');
  });
});

describe('crearPedidoWa / gancho contra el emulador', () => {
  const T = 'pex-a'; const TB = 'pex-b'; const TEL = '59170000009';
  const FICHA = { modulos: ['productos', 'pedidos'] };
  const ENTRADA = (o: Record<string, unknown> = {}) => ({ tenantId: T, ficha: FICHA, referencia: 'BM1', telefono: TEL, montoQr: 301, lineas: [ln()], entrega: 'retiro', ...o }) as Parameters<typeof crearPedidoWa>[0];
  const prender = (t: string, v: unknown = { activo: true, monedas: ['BOB', 'ARS'] }) => db.doc(`tenants/${t}/config/pedidos`).set({ catalogoExterno: v });
  beforeAll(async () => { await db.doc('tenants/pex-sonda').get(); });
  beforeEach(async () => { for (const t of [T, TB]) await db.recursiveDelete(db.doc(`tenants/${t}`)); bitacora.registrar.mockClear(); });

  it('sin config/pedidos: no crea pedido', async () => {
    expect(await crearPedidoWa(ENTRADA())).toEqual({ resultado: 'sin_pedido', motivo: 'sin_lineas' });
    expect((await db.collection(`tenants/${T}/pedidos`).get()).size).toBe(0);
  });
  it('config apagada o mal formada: no crea pedido', async () => {
    for (const v of [{ activo: false, monedas: ['BOB'] }, { activo: true, monedas: ['USD'] }, 'si']) {
      await prender(T, v);
      expect((await crearPedidoWa(ENTRADA())).resultado).toBe('sin_pedido');
    }
  });
  it('con config: crea wa_<ref> y es idempotente (.create → repetido, sin pisar)', async () => {
    await prender(T);
    expect(await crearPedidoWa(ENTRADA())).toEqual({ resultado: 'creado', id: 'wa_BM1' });
    expect(await crearPedidoWa(ENTRADA({ lineas: [ln({ cantidad: 9 })], montoQr: 9 }))).toEqual({ resultado: 'repetido', id: 'wa_BM1' });
    const d = (await db.doc(`tenants/${T}/pedidos/wa_BM1`).get()).data()!;
    expect(d).toMatchObject({ total: 301, catalogo: 'externo', moneda: 'BOB', telefonoEnmascarado: '5917****009' });
    expect(d).not.toHaveProperty('facturacion');
  });
  it('el dato de OTRO tenant no habilita: T sin config, TB con config', async () => {
    await prender(TB);
    expect((await crearPedidoWa(ENTRADA())).resultado).toBe('sin_pedido');
    expect((await db.collection(`tenants/${T}/pedidos`).get()).size).toBe(0);
    expect((await db.collection(`tenants/${TB}/pedidos`).get()).size).toBe(0);
  });
  it('módulo pedidos apagado: no crea aunque haya config', async () => {
    await prender(T);
    expect(await crearPedidoWa(ENTRADA({ ficha: { modulos: ['productos'] } }))).toEqual({ resultado: 'sin_pedido', motivo: 'modulo_apagado' });
  });
  it('ARS sin QR por `pedido_sin_cobro`: crea; sin forma externa o con evento ajeno, no', async () => {
    await prender(T, { activo: true, monedas: ['ARS'] });
    const d = (o: Record<string, unknown>) => ({ tenantId: T, ficha: FICHA, evento: 'pedido_sin_cobro', efectoDeCobro: undefined, referencia: 'BMAR1', referenciaAnterior: undefined, telefono: TEL, monto: undefined,
      lineas: [ln({ moneda: 'ARS', precioCentavos: 500000 })], entrega: 'retiro', facturacion: { nombre: 'X', documento: '999' }, ...o }) as Parameters<typeof despuesDelTurnoPedidos>[0];
    await despuesDelTurnoPedidos(d({ lineas: [{ id: 'taco', cantidad: 1 }], referencia: 'BMAR0' }));
    await despuesDelTurnoPedidos(d({ evento: 'horarios_ofrecidos', referencia: 'BMAR9' }));
    expect((await db.collection(`tenants/${T}/pedidos`).get()).size).toBe(0);
    await despuesDelTurnoPedidos(d({}));
    const p = (await db.doc(`tenants/${T}/pedidos/wa_BMAR1`).get()).data()!;
    expect(p).toMatchObject({ moneda: 'ARS', total: 10000, totalDistinto: false, catalogo: 'externo', estado: 'recibido' });
  });
  it('`qr_enviado` con efecto distinto de abierto no crea, aunque haya config', async () => {
    await prender(T);
    await despuesDelTurnoPedidos({ tenantId: T, ficha: FICHA, evento: 'qr_enviado', efectoDeCobro: 'ignorado', referencia: 'BM7', referenciaAnterior: undefined, telefono: TEL, monto: 301, lineas: [ln()], entrega: 'retiro', facturacion: undefined });
    expect((await db.collection(`tenants/${T}/pedidos`).get()).size).toBe(0);
  });
});
