/**
 * GANCHO `despuesDelTurno` DE PEDIDOS (PR-4), NEGANDO.
 *
 * Parte pura (`armarPedidoWa`) y parte contra el emulador (`crearPedidoWa`).
 * Cada prueba dice lo que NO debe pasar: el precio del flujo no entra, un ítem
 * ajeno no entra, el documento de facturación no sale del pedido.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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

const { despuesDelTurnoPedidos } = await import('../../../functions/src/modulos/pedidos/alTurno.ts');

const FICHA = { flujos: ['venta'], vertical: 'venta', modulos: ['productos', 'pedidos'] };
const T = 'pdg-a';
const TB = 'pdg-b';
const TEL = '59170000001';
const DOC = '1234567-1B';
const pedidos = async (t: string) => (await db.collection(`tenants/${t}/pedidos`).get()).docs;

const datos = (o: Record<string, unknown> = {}) => ({
  tenantId: T, ficha: FICHA, evento: 'qr_enviado', efectoDeCobro: 'abierto', referencia: 'ped-1',
  referenciaAnterior: undefined, telefono: TEL, monto: 20,
  lineas: [{ id: 'taco', cantidad: 2, precio: 0.01 }], entrega: 'retiro', facturacion: undefined, ...o,
}) as Parameters<typeof despuesDelTurnoPedidos>[0];

beforeAll(async () => { await db.doc('tenants/pdg-sonda').get(); });
beforeEach(async () => {
  for (const t of [T, TB]) await db.recursiveDelete(db.doc(`tenants/${t}`));
  await db.doc(`tenants/${T}/catalogo/taco`).set({ nombre: 'Taco', precio: 10, moneda: 'BOB', activo: true });
  await db.doc(`tenants/${TB}/catalogo/taco`).set({ nombre: 'Taco', precio: 99, moneda: 'BOB', activo: true });
  bitacora.registrar.mockClear();
});

describe('gancho de Pedidos: crea el wa_ solo con QR abierto y líneas', () => {
  it('reemplaza: con QR abierto y líneas el cat_ de la misma conversación queda en `reemplazado`', async () => {
    await db.doc(`tenants/${T}/pedidos/cat_g_1`).set({ origen: 'catalogo-web', conversacionId: `wa_${TEL}`, estado: 'recibido' });
    await despuesDelTurnoPedidos({ ...datos(), reemplaza: 'cat_g_1' });
    expect((await db.doc(`tenants/${T}/pedidos/cat_g_1`).get()).get('estado')).toBe('reemplazado');
  });
  it('reemplaza, negado: sin líneas, sin qr_enviado, efecto no abierto, forma inválida u otro tenant → el cat_ sigue en `recibido`', async () => {
    await db.doc(`tenants/${T}/pedidos/cat_g_2`).set({ origen: 'catalogo-web', conversacionId: `wa_${TEL}`, estado: 'recibido' });
    await db.doc(`tenants/${TB}/pedidos/cat_g_2`).set({ origen: 'catalogo-web', conversacionId: `wa_${TEL}`, estado: 'recibido' });
    await despuesDelTurnoPedidos({ ...datos({ lineas: [] }), reemplaza: 'cat_g_2' });
    await despuesDelTurnoPedidos({ ...datos({ lineas: undefined }), reemplaza: 'cat_g_2' });
    await despuesDelTurnoPedidos({ ...datos({ evento: 'cobro_cancelado', efectoDeCobro: 'cancelado', referenciaAnterior: 'ped-0' }), reemplaza: 'cat_g_2' });
    await despuesDelTurnoPedidos({ ...datos({ efectoDeCobro: 'ignorado' }), reemplaza: 'cat_g_2' });
    for (const mal of ['ped-1', 'cat_a/b', 'cat_..', '']) await despuesDelTurnoPedidos({ ...datos({ referencia: `ped-m${mal.length}` }), reemplaza: mal });
    expect((await db.doc(`tenants/${T}/pedidos/cat_g_2`).get()).get('estado')).toBe('recibido');
    // Con QR abierto pero para el tenant B (el cat_ de B no es el de T): cada tenant toca solo lo suyo.
    await despuesDelTurnoPedidos({ ...datos({ tenantId: T, referencia: 'ped-b' }), reemplaza: 'cat_g_2' });
    expect((await db.doc(`tenants/${TB}/pedidos/cat_g_2`).get()).get('estado')).toBe('recibido');
  });
  it('con lineas y efecto abierto crea wa_<ref> con el precio del catálogo y el teléfono enmascarado', async () => {
    await despuesDelTurnoPedidos(datos());
    const d = await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get();
    expect(d.data()).toMatchObject({ origen: 'whatsapp', total: 20, telefonoEnmascarado: '5917****001', estado: 'recibido' });
    expect(JSON.stringify({ ...d.data(), conversacionId: undefined })).not.toContain(TEL);
  });
  it('efecto abierto con una referencia que ya tenía pedido: no lo pisa y deja error_flujo sin datos', async () => {
    await despuesDelTurnoPedidos(datos());
    await despuesDelTurnoPedidos(datos({ monto: 30, lineas: [{ id: 'taco', cantidad: 3 }] }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('total')).toBe(20);
    const llamadas = bitacora.registrar.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]![1]).toMatchObject({ tipo: 'error_flujo', codigo: 'pedido_wa_referencia_repetida' });
    expect(JSON.stringify(llamadas)).not.toContain(TEL);
  });
  it('sin líneas, con líneas vacías o no arreglo: no crea nada', async () => {
    for (const lineas of [undefined, [], 'taco', { id: 'taco' }]) await despuesDelTurnoPedidos(datos({ lineas }));
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('un efecto distinto de abierto no crea nada', async () => {
    for (const e of ['reenvio', 'regla_1', 'ignorado', 'sin_id_meta', 'repetido', 'cancelado', undefined, '']) {
      await despuesDelTurnoPedidos(datos({ efectoDeCobro: e }));
    }
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('otro evento (no qr_enviado) no crea nada aunque traiga líneas y efecto abierto', async () => {
    for (const ev of ['horarios_ofrecidos', 'no_contactar', 'adelanto_aplicado', undefined]) {
      await despuesDelTurnoPedidos(datos({ evento: ev }));
    }
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('con el módulo pedidos apagado no crea nada', async () => {
    for (const ficha of [{ flujos: ['agendamiento'], modulos: ['agenda'] }, { modulos: [] }, null]) {
      await despuesDelTurnoPedidos(datos({ ficha }));
    }
    expect(await pedidos(T)).toHaveLength(0);
  });
  it('el ítem que solo existe en otro tenant no entra, ni se lee su precio', async () => {
    await db.doc(`tenants/${TB}/catalogo/solo-de-b`).set({ nombre: 'B', precio: 1, moneda: 'BOB', activo: true });
    await despuesDelTurnoPedidos(datos({ lineas: [{ id: 'solo-de-b', cantidad: 1 }] }));
    expect(await pedidos(T)).toHaveLength(0);
    await despuesDelTurnoPedidos(datos({ lineas: [{ id: 'taco', cantidad: 1 }] }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('total')).toBe(10);
    expect(await pedidos(TB)).toHaveLength(0);
  });
});

describe('gancho de Pedidos: reemplazo y cancelación', () => {
  it('un QR nuevo con otro carrito reemplaza al anterior', async () => {
    await despuesDelTurnoPedidos(datos());
    await despuesDelTurnoPedidos(datos({ referencia: 'ped-2', referenciaAnterior: 'ped-1', monto: 10, lineas: [{ id: 'taco', cantidad: 1 }] }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('reemplazado');
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-2`).get()).get('estado')).toBe('recibido');
  });
  it('cobro_cancelado con efecto cancelado pasa recibido → cancelado', async () => {
    await despuesDelTurnoPedidos(datos());
    await despuesDelTurnoPedidos(datos({ evento: 'cobro_cancelado', efectoDeCobro: 'cancelado', referenciaAnterior: 'ped-1', lineas: undefined }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('cancelado');
  });
  it('cobro_cancelado con otro efecto, sin referencia anterior o con módulo apagado no toca nada', async () => {
    await despuesDelTurnoPedidos(datos());
    for (const o of [{ efectoDeCobro: 'ignorado' }, { efectoDeCobro: undefined }, { referenciaAnterior: undefined }, { ficha: { modulos: [] } }]) {
      await despuesDelTurnoPedidos(datos({ evento: 'cobro_cancelado', efectoDeCobro: 'cancelado', referenciaAnterior: 'ped-1', ...o }));
    }
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('recibido');
  });
  it('no cierra el pedido de OTRA conversación del mismo comercio con la misma referencia', async () => {
    await despuesDelTurnoPedidos(datos());
    await despuesDelTurnoPedidos(datos({ telefono: '59170000002', evento: 'cobro_cancelado', efectoDeCobro: 'cancelado', referenciaAnterior: 'ped-1', lineas: undefined }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('recibido');
    await despuesDelTurnoPedidos(datos({ referencia: 'ped-2', telefono: '59170000002', referenciaAnterior: 'ped-1' }));
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-1`).get()).get('estado')).toBe('recibido');
  });
  it('no cancela el pedido de otro comercio con la misma referencia', async () => {
    await despuesDelTurnoPedidos(datos({ tenantId: TB }));
    await despuesDelTurnoPedidos(datos({ evento: 'cobro_cancelado', efectoDeCobro: 'cancelado', referenciaAnterior: 'ped-1', lineas: undefined }));
    expect((await db.doc(`tenants/${TB}/pedidos/wa_ped-1`).get()).get('estado')).toBe('recibido');
  });
});

describe('gancho de Pedidos: un fallo nunca sale ni lleva datos del pedido', () => {
  it('si algo lanza, resuelve igual y deja error_flujo sin teléfono ni documento', async () => {
    const ficha = new Proxy({}, { get() { throw new Error(`boom ${TEL} ${DOC}`); } });
    await expect(despuesDelTurnoPedidos(datos({ ficha, facturacion: { nombre: 'Ana', documento: DOC } }))).resolves.toBeUndefined();
    expect(await pedidos(T)).toHaveLength(0);
    const llamadas = bitacora.registrar.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(llamadas.length).toBeGreaterThan(0);
    expect(llamadas[0]![1]).toMatchObject({ tipo: 'error_flujo', resultado: 'fallo' });
    const todo = JSON.stringify(llamadas);
    expect(todo).not.toContain(TEL);
    expect(todo).not.toContain(DOC);
  });
  it('si hasta la bitácora falla, tampoco lanza', async () => {
    bitacora.registrar.mockRejectedValueOnce(new Error('bitacora caida'));
    const ficha = new Proxy({}, { get() { throw new Error('boom'); } });
    await expect(despuesDelTurnoPedidos(datos({ ficha }))).resolves.toBeUndefined();
  });
});

describe('la ingesta llama al gancho DESPUÉS de la transacción y sin camino para el corte', () => {
  const fuente = readFileSync(join(aqui, '..', '..', '..', 'functions', 'src', 'ingesta.ts'), 'utf8');
  it('la llamada va después del runTransaction del conteo', () => {
    expect(fuente.indexOf('await despuesDelTurnoPedidos(')).toBeGreaterThan(fuente.indexOf('const veredicto = await db.runTransaction'));
  });
  it('el camino cortado devuelve pedidos: null', () => {
    expect(fuente).toMatch(/cortado: true, conModalidad, pausadaPorPersona, pedidos: null/);
  });
  it('el tenantId del gancho sale de la ruta, no del cuerpo (normalizar no lo toma)', () => {
    const norm = fuente.slice(fuente.indexOf('function normalizar('), fuente.indexOf('const ID_TENANT'));
    expect(norm).not.toMatch(/c\['tenantId'\]/);
  });
});
