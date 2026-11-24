/**
 * CATÁLOGO WEB CON FUENTE EXTERNA (B3, 24/11/2026), NEGANDO PRIMERO.
 *
 * Corre `catalogoPublico`, `checkoutCatalogo` y `enlaceDeLaCartaDelTurno` DE VERDAD contra el emulador de Firestore.
 * La fuente (NovuTienda v1) es un `fetch` global simulado: cada prueba mira cuántas llamadas recibió y cuáles. El
 * secreto de la fuente va por el entorno (`NOVUTIENDA_CATALOGO`), como en Secret Manager.
 *
 * Emulador, con puerto propio:
 *   FIRESTORE_EMULATOR_PORT=8771 FIRESTORE_EMULATOR_WS_PORT=9771 \
 *     bash pruebas/correr.sh --project emulador pruebas/modulos/catalogo-web/catalogo-externo.test.ts
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { modulosDeFlujos } from '../../../functions/src/registro.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['SITIO_PUBLICO'] = 'https://catalogo.ejemplo.test';
const ALIAS_VALOR = 'valor-de-prueba-del-alias-catalogo-externo';
process.env['INGESTA_CLIENTE16'] = ALIAS_VALOR;
const BEARER = 'bearer-secreto-de-prueba-catalogo-ext';
const BASE = 'https://tienda.ejemplo.test';

const T = 'ext-venta';          // vende en BOB y ARS
const T_BOB = 'ext-solo-bob';   // vende solo en BOB
const T_FS = 'ext-firestore';   // SIN fuente externa: todo como siempre
const tenants = [T, T_BOB, T_FS];
process.env['NOVUTIENDA_CATALOGO'] = JSON.stringify({
  [T]: { baseUrl: BASE, bearer: BEARER }, [T_BOB]: { baseUrl: BASE, bearer: BEARER },
  [T_FS]: { baseUrl: BASE, bearer: BEARER },
});

/** Todo lo que el servidor manda al logger de Functions: se revisa que no filtre el secreto. */
const registros: unknown[][] = [];
const requerir = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'functions', 'package.json'));
const { logger } = requerir('firebase-functions') as typeof import('firebase-functions');
for (const nivel of ['warn', 'info', 'error', 'log', 'debug', 'write'] as const) {
  (logger as unknown as Record<string, unknown>)[nivel] = (...a: unknown[]) => { registros.push(a); };
}

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { catalogoPublico, checkoutCatalogo, emitirFicha } =
  await import('../../../functions/src/modulos/catalogo-web/catalogoWeb.ts');
const { enlaceDeLaCartaDelTurno } = await import('../../../functions/src/modulos/catalogo-web/alTurno.ts');
const { vaciarCacheDelCatalogoExterno } = await import('../../../functions/src/modulos/catalogo-web/fuenteExterna.ts');
const { limitesDe } = await import('../../../functions/src/central/cuenta/planes.ts');

const LINEA = '1000000771';
const WEBHOOK = 'https://n8n.ejemplo.test/webhook/ruta-secreta-catalogo-externo';
const TEL_BO = '59170020001';
const TEL_AR = '5491155551234';
const TEL_OTRO = '5511987654321';

// ---------------------------------------------------------------------------
// LA FUENTE SIMULADA
// ---------------------------------------------------------------------------
const item = (o: Record<string, unknown> = {}) => ({
  id: 'p1', nombre: 'Polera', precioCentavos: 15000, moneda: 'BOB', stock: 5, disponible: true,
  foto: 'https://cdn.ejemplo.test/p1.jpg', fotos: [], area: 'Ropa', descripcion: 'Algodón', ...o,
});
const ITEMS_BO = [
  item({ id: 'polera', nombre: 'Polera', precioCentavos: 15000, stock: 5 }),
  item({ id: 'gorra', nombre: 'Gorra', precioCentavos: 8050, stock: 2 }),
  item({ id: 'sin-stock-pero-disponible', nombre: 'Medias', precioCentavos: 1000, stock: 3, disponible: false }),
  item({ id: 'agotada', nombre: 'Bufanda', precioCentavos: 2000, stock: 0, disponible: false }),
  item({ id: 'libre', nombre: 'Servicio', precioCentavos: 5000, stock: null }),
];
const ITEMS_AR = [
  item({ id: 'remera', nombre: 'Remera', moneda: 'ARS', precioCentavos: 123_400_000, stock: 10 }),
  item({ id: 'buzo', nombre: 'Buzo', moneda: 'ARS', precioCentavos: 5_550_050, stock: 1 }),
];

type Comportamiento = 'ok' | 401 | 429 | 503 | 'tiempo' | 'red';
let comportamiento: Comportamiento = 'ok';
const llamadasFuente: string[] = [];
const llamadasWebhook: Array<{ url: string; cuerpo: string; cabeceras: Record<string, string> }> = [];

function fetchSimulado(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = String(url);
  if (u.startsWith(WEBHOOK)) {
    llamadasWebhook.push({ url: u, cuerpo: String(init?.body ?? ''), cabeceras: init?.headers as Record<string, string> });
    return Promise.resolve(new Response('{}', { status: 200 }));
  }
  llamadasFuente.push(u);
  if (comportamiento === 'tiempo') return Promise.reject(new DOMException('timeout', 'TimeoutError'));
  if (comportamiento === 'red') return Promise.reject(new TypeError('fetch failed'));
  if (comportamiento !== 'ok') return Promise.resolve(new Response('{}', { status: comportamiento }));
  const ar = u.includes('mercado=AR');
  return Promise.resolve(new Response(JSON.stringify(ar
    ? { version: 1, mercado: 'AR', moneda: 'ARS', items: ITEMS_AR }
    : { version: 1, mercado: 'BO', moneda: 'BOB', items: ITEMS_BO }), { status: 200 }));
}

// ---------------------------------------------------------------------------
// SEMILLA
// ---------------------------------------------------------------------------
async function sembrar(id: string, o: { externo: Record<string, unknown> | null; venta?: Record<string, unknown> }) {
  await db.doc(`tenants/${id}`).set({
    nombre: id, estado: 'activo', plan: 'crecimiento', flujos: ['venta'], modulos: modulosDeFlujos(['venta'] as never[]),
  });
  await db.doc(`tenants/${id}/cuenta/estado`).set({ plan: 'crecimiento', limites: limitesDe('crecimiento'), modalidad: 'demostracion' });
  await db.doc(`tenants/${id}/config/negocio`).set({ nombreNegocio: `Negocio ${id}`, catalogoWebActivo: true });
  await db.doc(`tenants/${id}/config/venta`).set({ costoDelivery: 0, ...(o.venta ?? {}) });
  if (o.externo !== null) await db.doc(`tenants/${id}/config/pedidos`).set({ catalogoExterno: o.externo });
  // Un ítem de Firestore: en un comercio externo NO se usa; en el de control sí.
  await db.doc(`tenants/${id}/catalogo/fs1`).set({ nombre: 'Del Firestore', area: 'a', precio: 10, moneda: 'BOB', activo: true, stock: 1, controlaStock: true });
}

async function limpiar() {
  for (const t of tenants) await db.recursiveDelete(db.doc(`tenants/${t}`));
  await db.doc(`rutasWhatsApp/${LINEA}`).delete();
  for (const t of tenants) {
    for (const f of (await db.collection('fichasCatalogo').where('tenantId', '==', t).get()).docs) await f.ref.delete();
  }
}

beforeAll(async () => {
  await limpiar();
  await sembrar(T, { externo: { activo: true, monedas: ['BOB', 'ARS'] } });
  await sembrar(T_BOB, { externo: { activo: true, monedas: ['BOB'] } });
  await sembrar(T_FS, { externo: null });
  for (const t of tenants) {
    await db.doc(`rutasWhatsApp/${LINEA}`).set({
      tenantId: t, flujo: 'venta', aliasSecreto: 'cliente16', estado: 'activo', webhookCarrito: WEBHOOK,
    });
  }
}, 60_000);
afterAll(limpiar, 60_000);

beforeEach(() => {
  vaciarCacheDelCatalogoExterno();
  comportamiento = 'ok';
  llamadasFuente.length = 0; llamadasWebhook.length = 0; registros.length = 0;
  vi.stubGlobal('fetch', fetchSimulado);
});
afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
// AYUDAS
// ---------------------------------------------------------------------------
interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }
function doble(): { r: Respuesta; respuesta: unknown } {
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, type() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  return { r, respuesta };
}
async function pagina(ficha: string): Promise<Respuesta> {
  const ruta = `/api/catalogo/${ficha}`;
  const { r, respuesta } = doble();
  await (catalogoPublico as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method: 'GET', headers: {}, get: () => undefined, path: ruta, url: ruta, originalUrl: ruta }, respuesta);
  return r;
}
async function checkout(ficha: string, cuerpo: unknown): Promise<Respuesta> {
  const ruta = `/api/catalogo/${ficha}/checkout`;
  const cab: Record<string, string> = { 'content-type': 'application/json' };
  const { r, respuesta } = doble();
  await (checkoutCatalogo as unknown as (q: unknown, s: unknown) => Promise<void>)({
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cab,
    get: (n: string) => cab[n.toLowerCase()], header: (n: string) => cab[n.toLowerCase()], path: ruta, url: ruta, originalUrl: ruta,
  }, respuesta);
  return r;
}
const fichaDe = async (tenantId: string, telefono: string): Promise<string> =>
  (await emitirFicha({ tenantId, phoneNumberId: LINEA, flujo: 'venta', telefono, reutilizar: false })).id;
const pedidoDe = async (tenantId: string, r: Respuesta) =>
  (await db.doc(`tenants/${tenantId}/pedidos/${String(r.cuerpo['pedidoId'])}`).get()).data() ?? {};
const NO_DISPONIBLE = { error: 'catalogo no disponible' };

// ===========================================================================
describe('la página (catalogoPublico) con fuente externa', () => {
  it('Bolivia: lee la fuente en vivo y publica solo lo disponible, con el precio en unidades y sin stock', async () => {
    const r = await pagina(await fichaDe(T, TEL_BO));
    expect(r.codigo).toBe(200);
    const items = r.cuerpo['items'] as Array<Record<string, unknown>>;
    expect(items.map((i) => i['id']).sort()).toEqual(['gorra', 'libre', 'polera']);
    expect(items.find((i) => i['id'] === 'polera')).toMatchObject({ precio: 150, moneda: 'BOB', area: 'Ropa' });
    expect(items.find((i) => i['id'] === 'gorra')).toMatchObject({ precio: 80.5 });
    expect((r.cuerpo['negocio'] as Record<string, unknown>)['moneda']).toBe('BOB');
    expect(JSON.stringify(r.cuerpo)).not.toContain('"stock"');
    expect(JSON.stringify(r.cuerpo)).not.toContain('Del Firestore'); // el catálogo de Firestore no se mezcla
    expect(llamadasFuente).toEqual([`${BASE}/api/novuchat/v1/catalogo?mercado=BO`]);
  });

  it('NEGANDO: `disponible:false` con stock 3 y el agotado NO se publican', async () => {
    const r = await pagina(await fichaDe(T, TEL_BO));
    const ids = (r.cuerpo['items'] as Array<Record<string, unknown>>).map((i) => i['id']);
    expect(ids).not.toContain('sin-stock-pero-disponible');
    expect(ids).not.toContain('agotada');
  });

  it('Argentina: ARS, mercado AR, precio exacto', async () => {
    const r = await pagina(await fichaDe(T, TEL_AR));
    expect(r.codigo).toBe(200);
    expect((r.cuerpo['negocio'] as Record<string, unknown>)['moneda']).toBe('ARS');
    const items = r.cuerpo['items'] as Array<Record<string, unknown>>;
    expect(items.find((i) => i['id'] === 'remera')).toMatchObject({ precio: 1_234_000, moneda: 'ARS' });
    expect(items.find((i) => i['id'] === 'buzo')).toMatchObject({ precio: 55_500.5 });
    expect(llamadasFuente).toEqual([`${BASE}/api/novuchat/v1/catalogo?mercado=AR`]);
  });

  it('NEGANDO: la ficha de otro país no tiene catálogo (409) y ni siquiera se llama a la fuente', async () => {
    const r = await pagina(await fichaDe(T, TEL_OTRO));
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual(NO_DISPONIBLE);
    expect(llamadasFuente).toHaveLength(0);
  });

  it('NEGANDO: 401, 429, 503, tiempo agotado y red caída dan 409 «catálogo no disponible», NUNCA una vitrina vacía', async () => {
    for (const c of [401, 429, 503, 'tiempo', 'red'] as const) {
      vaciarCacheDelCatalogoExterno();
      comportamiento = c;
      const r = await pagina(await fichaDe(T, TEL_BO));
      expect(r.codigo, String(c)).toBe(409);
      expect(r.cuerpo, String(c)).toEqual(NO_DISPONIBLE);
      expect(r.cuerpo).not.toHaveProperty('items');
    }
  });

  it('NEGANDO: ARS en un comercio que solo vende BOB es una mezcla de monedas: 409 y no se publica', async () => {
    const r = await pagina(await fichaDe(T_BOB, TEL_AR));
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual(NO_DISPONIBLE);
    expect(r.cuerpo).not.toHaveProperty('items');
  });

  it('`detallePorLinea` viaja solo si el comercio lo pidió', async () => {
    expect((await pagina(await fichaDe(T, TEL_BO))).cuerpo).not.toHaveProperty('detallePorLinea');
    await db.doc(`tenants/${T}/config/venta`).set({ costoDelivery: 0, detallePorLinea: true });
    try {
      expect((await pagina(await fichaDe(T, TEL_BO))).cuerpo['detallePorLinea']).toBe(true);
    } finally {
      await db.doc(`tenants/${T}/config/venta`).set({ costoDelivery: 0 });
    }
  });

  it('el dato lo activa, y solo `activo === true` estricto: `false`, «true» y ausente dan el camino de siempre', async () => {
    for (const valor of [{ activo: false }, { activo: 'true' }, { activo: 1 }, {}, 'x', null]) {
      await db.doc(`tenants/${T_FS}/config/pedidos`).set({ catalogoExterno: valor });
      llamadasFuente.length = 0;
      const r = await pagina(await fichaDe(T_FS, TEL_BO));
      expect(r.codigo, JSON.stringify(valor)).toBe(200);
      expect((r.cuerpo['items'] as Array<{ id: string }>).map((i) => i.id), JSON.stringify(valor)).toEqual(['fs1']);
      expect(llamadasFuente, JSON.stringify(valor)).toHaveLength(0);
    }
    await db.doc(`tenants/${T_FS}/config/pedidos`).delete();
  });
});

// ===========================================================================
describe('el checkout con fuente externa', () => {
  it('NEGANDO: un precio mandado por el navegador se ignora; el pedido sale con el de la fuente', async () => {
    const r = await checkout(await fichaDe(T, TEL_BO), {
      items: [{ id: 'polera', cantidad: 2, precio: 1, precioCentavos: 1, subtotal: 1, total: 1 }], entrega: 'retiro', total: 1,
    });
    expect(r.codigo).toBe(200);
    const p = await pedidoDe(T, r);
    expect(p['items']).toEqual([expect.objectContaining({ id: 'polera', cantidad: 2, precio: 150, precioCentavos: 15000, subtotal: 300, moneda: 'BOB', externa: true })]);
    expect(p['total']).toBe(300);
    expect(r.cuerpo['total']).toBe(300);
  });

  it('NEGANDO: un id que no está en la fuente queda en `descartados`', async () => {
    const r = await checkout(await fichaDe(T, TEL_BO), {
      items: [{ id: 'polera', cantidad: 1 }, { id: 'fantasma', cantidad: 1 }, { id: 'fs1', cantidad: 1 }], entrega: 'retiro',
    });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['descartados']).toEqual(['fantasma', 'fs1']);
    expect(((await pedidoDe(T, r))['items'] as Array<{ id: string }>).map((i) => i.id)).toEqual(['polera']);
  });

  it('NEGANDO: `disponible:false` con stock 3 no se vende', async () => {
    const r = await checkout(await fichaDe(T, TEL_BO), {
      items: [{ id: 'sin-stock-pero-disponible', cantidad: 1 }, { id: 'polera', cantidad: 1 }], entrega: 'retiro',
    });
    expect(r.cuerpo['descartados']).toEqual(['sin-stock-pero-disponible']);
  });

  it('NEGANDO: stock 2 y pedido de 3 se descarta; con 2 entra', async () => {
    const tres = await checkout(await fichaDe(T, TEL_BO), { items: [{ id: 'gorra', cantidad: 3 }, { id: 'polera', cantidad: 1 }], entrega: 'retiro' });
    expect(tres.cuerpo['descartados']).toEqual(['gorra']);
    const dos = await checkout(await fichaDe(T, TEL_BO), { items: [{ id: 'gorra', cantidad: 2 }], entrega: 'retiro' });
    expect(dos.codigo).toBe(200);
    expect(dos.cuerpo['descartados']).toEqual([]);
    expect(dos.cuerpo['total']).toBe(161);
  });

  it('NEGANDO: si todo se descarta, 409 «nada de lo pedido sigue disponible» y no se escribe ningún pedido', async () => {
    const antes = (await db.collection(`tenants/${T}/pedidos`).get()).size;
    const r = await checkout(await fichaDe(T, TEL_BO), { items: [{ id: 'agotada', cantidad: 1 }], entrega: 'retiro' });
    expect(r.codigo).toBe(409);
    expect(r.cuerpo['error']).toBe('nada de lo pedido sigue disponible');
    expect((await db.collection(`tenants/${T}/pedidos`).get()).size).toBe(antes);
  });

  it('NEGANDO: la ficha de otro país no compra (409) y no llama a la fuente', async () => {
    const antes = (await db.collection(`tenants/${T}/pedidos`).get()).size;
    const r = await checkout(await fichaDe(T, TEL_OTRO), { items: [{ id: 'polera', cantidad: 1 }], entrega: 'retiro' });
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual(NO_DISPONIBLE);
    expect(llamadasFuente).toHaveLength(0);
    expect((await db.collection(`tenants/${T}/pedidos`).get()).size).toBe(antes);
  });

  it('NEGANDO: 401, 429, 503, tiempo agotado y red caída dan 409 y NO crean un pedido', async () => {
    for (const c of [401, 429, 503, 'tiempo', 'red'] as const) {
      vaciarCacheDelCatalogoExterno();
      comportamiento = c;
      const antes = (await db.collection(`tenants/${T}/pedidos`).get()).size;
      const r = await checkout(await fichaDe(T, TEL_BO), { items: [{ id: 'polera', cantidad: 1 }], entrega: 'retiro' });
      expect(r.codigo, String(c)).toBe(409);
      expect(r.cuerpo, String(c)).toEqual(NO_DISPONIBLE);
      expect((await db.collection(`tenants/${T}/pedidos`).get()).size, String(c)).toBe(antes);
    }
  });

  it('NEGANDO: ARS en un comercio que solo vende BOB (mezcla) da 409 «monedas mezcladas» y no escribe nada', async () => {
    const antes = (await db.collection(`tenants/${T_BOB}/pedidos`).get()).size;
    const r = await checkout(await fichaDe(T_BOB, TEL_AR), { items: [{ id: 'remera', cantidad: 1 }], entrega: 'retiro' });
    expect(r.codigo).toBe(409);
    expect(r.cuerpo['error']).toBe('monedas mezcladas');
    expect((await db.collection(`tenants/${T_BOB}/pedidos`).get()).size).toBe(antes);
  });

  it('NO toca el stock de Firestore ni escribe movimientos: el stock lo descuenta la otra plataforma', async () => {
    const antes = (await db.doc(`tenants/${T}/catalogo/fs1`).get()).data();
    const r = await checkout(await fichaDe(T, TEL_BO), { items: [{ id: 'polera', cantidad: 1 }], entrega: 'retiro' });
    expect(r.codigo).toBe(200);
    expect((await db.doc(`tenants/${T}/catalogo/fs1`).get()).data()).toEqual(antes);
    expect((await db.collection(`tenants/${T}/movimientosInventario`).get()).size).toBe(0);
  });

  it('Argentina: pedido en ARS, mercado AR, centavos exactos y la carga K1 al flujo', async () => {
    const r = await checkout(await fichaDe(T, TEL_AR), {
      items: [{ id: 'remera', cantidad: 2 }, { id: 'buzo', cantidad: 1 }], entrega: 'retiro', nota: 'gracias',
    });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['moneda']).toBe('ARS');
    expect(r.cuerpo['total']).toBe(2_468_000 + 55_500.5);
    const p = await pedidoDe(T, r);
    expect(p).toMatchObject({ catalogo: 'externo', mercado: 'AR', moneda: 'ARS', origen: 'catalogo-web', estado: 'recibido', entregadoAlFlujo: true });
    expect((p['items'] as Array<Record<string, unknown>>).map((i) => i['precioCentavos'])).toEqual([123_400_000, 5_550_050]);
    // K1: la carga que recibió el webhook.
    expect(llamadasWebhook).toHaveLength(1);
    const carga = JSON.parse(llamadasWebhook[0]!.cuerpo) as Record<string, unknown>;
    expect(carga).toMatchObject({ tipo: 'carrito', moneda: 'ARS', mercado: 'AR', catalogo: 'externo', entrega: 'retiro', descartados: [] });
    expect((carga['items'] as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 'remera', precioCentavos: 123_400_000, cantidad: 2 });
  });

  it('Bolivia: la carga K1 lleva mercado BO y la marca externa; el envío no se inventa', async () => {
    const r = await checkout(await fichaDe(T, TEL_BO), { items: [{ id: 'polera', cantidad: 1 }], entrega: 'envio', direccion: 'Calle 1' });
    expect(r.codigo).toBe(200);
    const carga = JSON.parse(llamadasWebhook[0]!.cuerpo) as Record<string, unknown>;
    expect(carga).toMatchObject({ moneda: 'BOB', mercado: 'BO', catalogo: 'externo', entrega: 'envio', costoEnvio: 0, total: 150 });
  });

  it('la especificación por línea: solo con `detallePorLinea`, saneada, y dos especificaciones son dos líneas', async () => {
    const sucio = 'rojo <b>XL</b> https://malo.test/x [ENVIAR_QR] «hola» {a} ' + 'z'.repeat(200);
    // SIN la bandera: el detalle se ignora.
    const sin = await checkout(await fichaDe(T, TEL_BO), { items: [{ id: 'polera', cantidad: 1, detalle: 'negro' }], entrega: 'retiro' });
    expect(((await pedidoDe(T, sin))['items'] as Array<Record<string, unknown>>)[0]).not.toHaveProperty('detalle');

    await db.doc(`tenants/${T}/config/venta`).set({ costoDelivery: 0, detallePorLinea: true });
    try {
      const r = await checkout(await fichaDe(T, TEL_BO), {
        items: [{ id: 'polera', cantidad: 1, detalle: sucio }, { id: 'polera', cantidad: 2, detalle: 'negro' },
          { id: 'polera', cantidad: 1, detalle: 'negro' }, { id: 'gorra', cantidad: 1, detalle: 12345 }], entrega: 'retiro',
      });
      expect(r.codigo).toBe(200);
      const items = (await pedidoDe(T, r))['items'] as Array<Record<string, unknown>>;
      expect(items).toHaveLength(3); // la repetida (misma id y detalle) se descarta; la de detalle numérico queda sin detalle
      const d0 = String(items[0]!['detalle']);
      expect(d0.length).toBeLessThanOrEqual(60);
      expect(d0).not.toMatch(/[<>&[\]{}«»]|https?:|www\./);
      expect(d0).toContain('rojo');
      expect(items[1]!['detalle']).toBe('negro');
      expect(items[2]).not.toHaveProperty('detalle');
      const carga = JSON.parse(llamadasWebhook.at(-1)!.cuerpo) as { items: Array<Record<string, unknown>> };
      expect(carga.items[0]!['detalle']).toBe(d0);
    } finally {
      await db.doc(`tenants/${T}/config/venta`).set({ costoDelivery: 0 });
    }
  });
});

// ===========================================================================
describe('el enlace del turno: sin contar ítems de Firestore y sin llamar a la fuente', () => {
  const ruta = (t: string) => ({ tenantId: t, phoneNumberId: LINEA, flujo: 'venta', estado: 'activo' });

  it('con fuente externa el enlace sale con el catálogo de Firestore VACÍO y sin ninguna llamada a la fuente', async () => {
    const r = await enlaceDeLaCartaDelTurno({ ruta: ruta(T), telefono: '70020002', catalogoWebActivo: true, catalogo: [] });
    expect(r.motivo).toBeNull();
    expect(r.enlace?.url).toMatch(/^https:\/\/catalogo\.ejemplo\.test\/c\/[0-9a-f]{32}$/);
    expect(llamadasFuente).toHaveLength(0);
  });

  it('NEGANDO: sin fuente externa y sin ítems vendibles, NO hay enlace (sinVendibles), como siempre', async () => {
    const r = await enlaceDeLaCartaDelTurno({ ruta: ruta(T_FS), telefono: '70020003', catalogoWebActivo: true, catalogo: [] });
    expect(r.enlace).toBeNull();
    expect(r.motivo).toBe('sinVendibles');
  });

  it('NEGANDO: con el catálogo web apagado no hay enlace aunque sea externo', async () => {
    const r = await enlaceDeLaCartaDelTurno({ ruta: ruta(T), telefono: '70020004', catalogoWebActivo: false, catalogo: [] });
    expect(r.enlace).toBeNull();
    expect(r.motivo).toBe('sinCatalogoWeb');
  });
});

// ===========================================================================
describe('sin `catalogoExterno` todo es igual que hoy (regresión)', () => {
  it('un comercio de Firestore: página y checkout salen del catálogo propio, con inventario, sin llamar a la fuente', async () => {
    const f = await fichaDe(T_FS, TEL_BO);
    const p = await pagina(f);
    expect(p.codigo).toBe(200);
    expect((p.cuerpo['items'] as Array<{ id: string }>).map((i) => i.id)).toEqual(['fs1']);
    const c = await checkout(f, { items: [{ id: 'fs1', cantidad: 1 }, { id: 'polera', cantidad: 1 }], entrega: 'retiro' });
    expect(c.codigo).toBe(200);
    expect(c.cuerpo['descartados']).toEqual(['polera']);
    const ped = await pedidoDe(T_FS, c);
    expect(ped).not.toHaveProperty('catalogo');
    expect(ped).not.toHaveProperty('mercado');
    expect(ped['items']).toEqual([expect.not.objectContaining({ externa: true })]);
    expect(llamadasFuente).toHaveLength(0);
    const carga = JSON.parse(llamadasWebhook[0]!.cuerpo) as Record<string, unknown>;
    expect(carga).not.toHaveProperty('mercado');
    expect(carga).not.toHaveProperty('catalogo');
  });
});

// ===========================================================================
describe('el secreto no sale por ningún lado', () => {
  it('ni el Bearer de la fuente ni su URL aparecen en lo respondido, lo guardado, lo mandado al flujo ni lo registrado', async () => {
    const salidas: unknown[] = [];
    for (const c of ['ok', 401, 429, 503, 'tiempo', 'red'] as const) {
      vaciarCacheDelCatalogoExterno();
      comportamiento = c;
      const f = await fichaDe(T, TEL_BO);
      salidas.push((await pagina(f)).cuerpo, (await checkout(f, { items: [{ id: 'polera', cantidad: 1 }], entrega: 'retiro' })).cuerpo);
    }
    comportamiento = 'ok';
    const pedidos = (await db.collection(`tenants/${T}/pedidos`).get()).docs.map((d) => d.data());
    const todo = JSON.stringify([salidas, pedidos, llamadasWebhook, registros]);
    expect(todo).not.toContain(BEARER);
    expect(todo).not.toContain('tienda.ejemplo.test');
    expect(llamadasWebhook.length).toBeGreaterThan(0);
  });
});
