/**
 * EL PEDIDO TOMADO POR WHATSAPP (PR-4), NEGANDO.
 *
 * Parte pura (`armarPedidoWa`) y parte contra el emulador (`crearPedidoWa`).
 * Cada prueba dice lo que NO debe pasar: el precio del flujo no entra, un ítem
 * ajeno no entra, el documento de facturación no sale del pedido.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bitacora = vi.hoisted(() => ({ registrar: vi.fn(async () => undefined) }));
vi.mock('../../../functions/src/core/turno/bitacora.ts', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), registrar: bitacora.registrar,
}));
const auditoria = vi.hoisted(() => ({ auditar: vi.fn(async () => undefined) }));
vi.mock('../../../functions/src/central/comunes.ts', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), auditar: auditoria.auditar,
}));

const aqui = dirname(fileURLToPath(import.meta.url));
const PROYECTO = 'demo-novuchat-pruebas';
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO}`;
const requerir = createRequire(join(aqui, '..', '..', '..', 'functions', 'package.json'));
const { initializeApp, getApps } = requerir('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore } = requerir('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const logger = requerir('firebase-functions/logger') as typeof import('firebase-functions/logger');

const P = await import('../../../functions/src/modulos/pedidos/pedidoDelQr.ts');
const { armarPedidoWa, crearPedidoWa, cerrarPedidoWa, idDePedidoWa } = P;

const CAT = {
  taco: { nombre: 'Taco', precio: 10, moneda: 'BOB', activo: true },
  jugo: { nombre: 'Jugo', precio: 7.5, moneda: 'BOB', activo: true },
  baja: { nombre: 'Viejo', precio: 5, moneda: 'BOB', activo: false },
  sinprecio: { nombre: 'A consultar', moneda: 'BOB', activo: true },
  dolar: { nombre: 'Dolar', precio: 3, moneda: 'USD', activo: true },
} as Record<string, Record<string, unknown>>;
const TEL = '59170000001';
const armar = (lineas: unknown, o: { entrega?: unknown; fact?: unknown; docs?: typeof CAT; monto?: unknown } = {}) =>
  armarPedidoWa(lineas, o.entrega ?? 'retiro', o.fact, o.docs ?? CAT, 'ped-1', TEL, 'monto' in o ? o.monto : 20);

describe('armarPedidoWa: el precio sale del catálogo, no del flujo', () => {
  it('ignora precio, total y subtotal que mande el flujo', () => {
    const r = armar([{ id: 'taco', cantidad: 2, precio: 0.01, total: 0.02, subtotal: 1, detalle: 'sin picante' }]);
    expect(r.pedido?.items[0]).toMatchObject({ precio: 10, subtotal: 20, detalle: 'sin picante' });
    expect(r.pedido?.total).toBe(20);
    expect(r.pedido?.totalDistinto).toBe(false);
  });
  it('ítem inexistente, inactivo o sin precio se descarta; sin nada queda sin pedido', () => {
    const r = armar([{ id: 'fantasma', cantidad: 1 }, { id: 'baja', cantidad: 1 }, { id: 'sinprecio', cantidad: 1 }]);
    expect(r.pedido).toBeNull();
    expect(r.motivo).toBe('sin_lineas');
    expect(r.descartados).toEqual(['fantasma', 'baja', 'sinprecio']);
    const mixto = armar([{ id: 'baja', cantidad: 1 }, { id: 'taco', cantidad: 1 }]);
    expect(mixto.pedido?.items).toHaveLength(1);
    expect(mixto.pedido?.descartados).toEqual(['baja']);
  });
  it('cantidad 0, 51, negativa o no numérica no entra; 1 y 50 sí', () => {
    for (const cantidad of [0, 51, -2, NaN, '3', null]) {
      expect(armar([{ id: 'taco', cantidad }]).pedido).toBeNull();
    }
    expect(armar([{ id: 'taco', cantidad: 50 }]).pedido?.items[0]?.['cantidad']).toBe(50);
    expect(armar([{ id: 'taco', cantidad: 1 }]).pedido).not.toBeNull();
  });
  it('más de 30 líneas: solo entran las 30 primeras', () => {
    const docs: typeof CAT = {}; const lineas = [];
    for (let i = 0; i < 40; i += 1) { docs[`i${i}`] = { nombre: 'x', precio: 1, moneda: 'BOB', activo: true }; lineas.push({ id: `i${i}`, cantidad: 1 }); }
    const r = armar(lineas, { docs, monto: 30 });
    expect(r.pedido?.items).toHaveLength(30);
    expect(r.pedido?.total).toBe(30);
  });
  it('el detalle se recorta a 120, sin enlaces ni marcas', () => {
    const r = armar([{ id: 'taco', cantidad: 1, detalle: `<b>${'a'.repeat(300)}</b> http://malo.example` }]);
    const d = r.pedido?.items[0]?.['detalle'] as string;
    expect(d.length).toBeLessThanOrEqual(120);
    expect(d).not.toMatch(/[<>]|http/);
  });
  it('monedas mezcladas: no hay pedido', () => {
    const r = armar([{ id: 'taco', cantidad: 1 }, { id: 'dolar', cantidad: 1 }]);
    expect(r.pedido).toBeNull();
    expect(r.motivo).toBe('monedas_mezcladas');
  });
  it('cero líneas o líneas que no son lista: no hay pedido', () => {
    for (const l of [[], undefined, null, 'taco', {}]) expect(armar(l).pedido).toBeNull();
  });
  it('un id repetido cuenta una sola vez', () => {
    expect(armar([{ id: 'taco', cantidad: 1 }, { id: 'taco', cantidad: 9 }]).pedido?.total).toBe(10);
  });
  it('NO suma delivery aunque haya envío', () => {
    const r = armar([{ id: 'taco', cantidad: 1 }], { entrega: { tipo: 'envio', direccion: 'Calle 1' }, monto: 10 });
    expect(r.pedido?.total).toBe(10);
    expect(r.pedido?.costoEnvio).toBe(0);
    expect(r.pedido?.entrega).toBe('envio');
    expect(r.pedido?.totalDistinto).toBe(false);
  });
  it('total distinto del QR: queda marcado con las dos cifras y no se corrige', () => {
    const r = armar([{ id: 'taco', cantidad: 2 }], { monto: 25 });
    expect(r.pedido).toMatchObject({ totalDistinto: true, montoQrCentavos: 2500, totalServidorCentavos: 2000, total: 20 });
  });
  it('sin monto de QR utilizable también queda marcado', () => {
    for (const m of [undefined, 0, -1, NaN, '20']) {
      expect(armar([{ id: 'taco', cantidad: 2 }], { monto: m }).pedido).toMatchObject({ totalDistinto: true, montoQrCentavos: null });
    }
  });
  it('con retiro no se guardan dirección ni ubicación', () => {
    const r = armar([{ id: 'taco', cantidad: 1 }], { entrega: { tipo: 'retiro', direccion: 'Calle 1', ubicacion: { lat: -17.7, lng: -63.1 } }, monto: 10 });
    expect(r.pedido).not.toHaveProperty('direccion');
    expect(r.pedido).not.toHaveProperty('ubicacion');
    const e = armar([{ id: 'taco', cantidad: 1 }], { entrega: { tipo: 'envio', ubicacion: { lat: -17.7, lng: -63.1 } }, monto: 10 });
    expect(e.pedido?.ubicacion).toEqual({ lat: -17.7, lng: -63.1 });
  });
  it('el teléfono va enmascarado, nunca completo', () => {
    const p = armar([{ id: 'taco', cantidad: 1 }]).pedido;
    expect(p?.telefonoEnmascarado).toBe('5917****001');
    // El teléfono completo solo está en `conversacionId`, que es el vínculo con
    // la conversación (igual que el checkout web): en ningún otro campo.
    expect(JSON.stringify({ ...p, conversacionId: undefined })).not.toContain(TEL);
  });
  it('facturación: solo dentro del pedido, limpia; sin documento no hay facturación', () => {
    const p = armar([{ id: 'taco', cantidad: 1 }], { fact: { nombre: 'Ana <b>', documento: '1234567 ab/..' } }).pedido;
    expect(p?.facturacion).toEqual({ nombre: 'Ana b', documento: '1234567ab' });
    for (const f of [undefined, {}, { nombre: 'x' }, { documento: '' }, 'doc', []]) {
      expect(armar([{ id: 'taco', cantidad: 1 }], { fact: f }).pedido).not.toHaveProperty('facturacion');
    }
  });
  it('un ítem que solo existe en otro tenant (no está en los docs leídos) no entra', () => {
    expect(armar([{ id: 'ajeno', cantidad: 1 }], { docs: {} }).pedido).toBeNull();
    // ni por la cadena de prototipos
    expect(armar([{ id: 'constructor', cantidad: 1 }], { docs: {} }).pedido).toBeNull();
  });
  it('ids con / o .. no entran', () => {
    const docs = { 'a/b': CAT['taco'], '..': CAT['taco'], 'a..b': CAT['taco'] } as typeof CAT;
    const r = armar([{ id: 'a/b', cantidad: 1 }, { id: '..', cantidad: 1 }, { id: 'a..b', cantidad: 1 }], { docs });
    expect(r.pedido).toBeNull();
  });
});

describe('idDePedidoWa', () => {
  it('es wa_ + [A-Za-z0-9_-]{1,60}, un solo segmento', () => {
    expect(idDePedidoWa('ped-20261028-1234-ab12')).toBe('wa_ped-20261028-1234-ab12');
    const raro = idDePedidoWa('a/../b c')!;
    expect(raro).toMatch(/^wa_[A-Za-z0-9_-]{1,60}$/);
    expect(raro).not.toMatch(/[/.]/);
    expect(idDePedidoWa('x'.repeat(200))!.length).toBe(63);
  });
  it('vacía, no texto o solo símbolos: no hay id', () => {
    for (const r of ['', '   ', '///', undefined, 5, null]) expect(idDePedidoWa(r)).toBeNull();
  });
});

// ===========================================================================
// Escritura, contra el emulador
// ===========================================================================
const FICHA = { flujos: ['venta'], vertical: 'venta', modulos: ['productos', 'pedidos'] };
const T = 'pdq-a';
const TB = 'pdq-b';
const pedidos = async (t: string) => (await db.collection(`tenants/${t}/pedidos`).get()).docs;

async function sembrar() {
  for (const t of [T, TB]) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const [id, d] of Object.entries(CAT)) await db.doc(`tenants/${T}/catalogo/${id}`).set(d);
  await db.doc(`tenants/${TB}/catalogo/solo-de-b`).set({ nombre: 'B', precio: 1, moneda: 'BOB', activo: true });
}
const entrada = (o: Record<string, unknown> = {}) => ({
  tenantId: T, ficha: FICHA, referencia: 'ped-1', telefono: TEL, montoQr: 20,
  lineas: [{ id: 'taco', cantidad: 2 }], entrega: 'retiro', ...o,
});

beforeAll(async () => { await db.doc('tenants/pdq-sonda').get(); });
beforeEach(async () => {
  await sembrar();
  bitacora.registrar.mockClear(); auditoria.auditar.mockClear();
});

describe('crearPedidoWa: el pedido llega a su colección', () => {
  it('crea wa_<referencia> con origen whatsapp y el precio del catálogo', async () => {
    expect(await crearPedidoWa(entrada({ lineas: [{ id: 'taco', cantidad: 2, precio: 1 }] })))
      .toEqual({ resultado: 'creado', id: 'wa_ped-1' });
    const d = await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get();
    expect(d.data()).toMatchObject({ origen: 'whatsapp', total: 20, estado: 'recibido', telefonoEnmascarado: '5917****001' });
    expect(JSON.stringify({ ...d.data(), conversacionId: undefined })).not.toContain(TEL);
  });
  it('un reenvío no duplica ni pisa: repetido', async () => {
    await crearPedidoWa(entrada());
    expect(await crearPedidoWa(entrada({ lineas: [{ id: 'jugo', cantidad: 9 }] }))).toEqual({ resultado: 'repetido', id: 'wa_ped-1' });
    expect(await pedidos(T)).toHaveLength(1);
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('total')).toBe(20);
  });
  it('una referencia cat_ no crea nada (ese pedido lo escribió el checkout web)', async () => {
    expect(await crearPedidoWa(entrada({ referencia: 'cat_abc_1234' }))).toMatchObject({ resultado: 'sin_pedido' });
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('con el módulo pedidos apagado no crea nada', async () => {
    for (const ficha of [{ flujos: ['agendamiento'], modulos: ['agenda'] }, { flujos: ['venta'], modulos: [] }, null, undefined]) {
      expect(await crearPedidoWa(entrada({ ficha }))).toEqual({ resultado: 'sin_pedido', motivo: 'modulo_apagado' });
    }
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('un ítem que solo existe en OTRO tenant no entra, y el otro tenant no recibe nada', async () => {
    expect(await crearPedidoWa(entrada({ lineas: [{ id: 'solo-de-b', cantidad: 1 }] }))).toMatchObject({ resultado: 'sin_pedido', motivo: 'sin_lineas' });
    expect(await pedidos(T)).toHaveLength(0);
    expect(await pedidos(TB)).toHaveLength(0);
  });
  it('un tenantId fabricado (con / o ..) no escribe en ninguna parte', async () => {
    for (const tenantId of ['pdq-a/pedidos/x', '../pdq-b', '', 'PDQ', 'a']) {
      expect(await crearPedidoWa(entrada({ tenantId }))).toEqual({ resultado: 'sin_pedido', motivo: 'tenant_invalido' });
    }
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('una referencia con / o .. produce un id de un solo segmento dentro de pedidos/', async () => {
    const r = await crearPedidoWa(entrada({ referencia: '../../tenants/pdq-b/pedidos/x' }));
    expect(r.resultado).toBe('creado');
    expect(await pedidos(TB)).toHaveLength(0);
    const docs = await pedidos(T);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toMatch(/^wa_[A-Za-z0-9_-]{1,60}$/);
  });
  it('sin líneas válidas no hay pedido', async () => {
    expect(await crearPedidoWa(entrada({ lineas: [] }))).toMatchObject({ resultado: 'sin_pedido' });
    expect(await crearPedidoWa(entrada({ lineas: [{ id: 'taco', cantidad: 51 }] }))).toMatchObject({ resultado: 'sin_pedido' });
    expect(await crearPedidoWa(entrada({ lineas: [{ id: 'taco', cantidad: 1 }, { id: 'dolar', cantidad: 1 }] }))).toMatchObject({ resultado: 'sin_pedido', motivo: 'monedas_mezcladas' });
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('total distinto: el pedido se crea marcado y no se frena', async () => {
    expect(await crearPedidoWa(entrada({ montoQr: 99 }))).toMatchObject({ resultado: 'creado' });
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).data())
      .toMatchObject({ totalDistinto: true, montoQrCentavos: 9900, totalServidorCentavos: 2000 });
  });
});

describe('reemplazo y cancelación', () => {
  it('otra referencia con el QR anterior en recibido: el anterior pasa a reemplazado', async () => {
    await crearPedidoWa(entrada());
    await crearPedidoWa(entrada({ referencia: 'ped-2', referenciaAnterior: 'ped-1', lineas: [{ id: 'jugo', cantidad: 1 }], montoQr: 7.5 }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('reemplazado');
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-2`).get()).get('estado')).toBe('recibido');
  });
  it('un pedido que ya no está en recibido no se reemplaza ni se cancela', async () => {
    await crearPedidoWa(entrada());
    await db.doc(`tenants/${T}/pedidos/wa_ped-1`).update({ estado: 'entregado' });
    expect(await cerrarPedidoWa(T, 'ped-1', 'cancelado')).toBe(false);
    await crearPedidoWa(entrada({ referencia: 'ped-2', referenciaAnterior: 'ped-1' }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('entregado');
  });
  it('cobro cancelado: recibido pasa a cancelado, y cat_ o ajenos no se tocan', async () => {
    await crearPedidoWa(entrada());
    await db.doc(`tenants/${T}/pedidos/cat_x`).set({ origen: 'catalogo-web', estado: 'recibido' });
    expect(await cerrarPedidoWa(T, 'cat_x', 'cancelado')).toBe(false);
    expect(await cerrarPedidoWa(TB, 'ped-1', 'cancelado')).toBe(false);
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('recibido');
    expect(await cerrarPedidoWa(T, 'ped-1', 'cancelado')).toBe(true);
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('cancelado');
  });
});

describe('el documento de facturación no sale del pedido', () => {
  const DOC = 'NIT-98765432-X';
  const reunir = (...espias: Array<ReturnType<typeof vi.spyOn> | ReturnType<typeof vi.fn>>) =>
    JSON.stringify(espias.map((e) => e.mock.calls));

  it('ni en logger, ni en registrar, ni en auditoría, con éxito o con error', async () => {
    const esp = (['log', 'info', 'warn', 'error', 'debug', 'write'] as const)
      .filter((m) => typeof (logger as Record<string, unknown>)[m] === 'function')
      .map((m) => vi.spyOn(logger, m as 'log'));
    const consola = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const fact = { nombre: 'Ana Perez', documento: DOC };
    // éxito, repetido
    await crearPedidoWa(entrada({ facturacion: fact }));
    await crearPedidoWa(entrada({ facturacion: fact }));
    // error forzado dentro del armado
    const hostil = { get tipo(): string { throw new Error(`boom ${DOC}`); } };
    expect(await crearPedidoWa(entrada({ referencia: 'ped-9', entrega: hostil, facturacion: fact }))).toEqual({ resultado: 'error' });
    expect(bitacora.registrar).toHaveBeenCalled();
    const visto = reunir(bitacora.registrar, auditoria.auditar, ...esp, ...consola);
    expect(visto).not.toContain('98765432');
    expect(visto).not.toContain('Ana Perez');
    // y sí está donde debe
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('facturacion')).toEqual({ nombre: 'Ana Perez', documento: DOC.replace(/[^A-Za-z0-9-]/g, '') });
    [...esp, ...consola].forEach((e) => e.mockRestore());
  });
  it('no queda en otras colecciones del tenant (conversaciones, bitácora, fichas)', async () => {
    await crearPedidoWa(entrada({ facturacion: { nombre: 'Ana', documento: DOC } }));
    for (const col of ['conversaciones', 'bitacora', 'auditoria', 'clientes', 'fichas']) {
      expect(JSON.stringify((await db.collection(`tenants/${T}/${col}`).get()).docs.map((d) => d.data()))).not.toContain('98765432');
    }
    expect(JSON.stringify((await db.doc(`tenants/${T}`).get()).data() ?? {})).not.toContain('98765432');
  });
});
