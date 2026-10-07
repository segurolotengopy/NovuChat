/**
 * LA DIRECCIÓN ES OPCIONAL CON ENVÍO (Andres, 07/10/2026, Q'Taco).
 *
 * Antes, `checkoutCatalogo` respondía 400 `falta la direccion` si el pedido era
 * de envío y no traía ni dirección ni una ubicación válida. Ahora el pedido
 * entra igual: la página avisa «Si no escribes la dirección, te pediremos tu
 * ubicación por WhatsApp.» y el flujo de n8n (PR-A) la pide en el mismo mensaje
 * con que ya preguntaba la dirección (0 mensajes agregados).
 *
 * Esta suite corre `checkoutCatalogo` DE VERDAD contra el emulador y fija,
 * negando, lo que NO cambió:
 *   - una ubicación inválida sigue sin guardarse (no es un permiso oculto);
 *   - con retiro no se guarda ni dirección ni ubicación;
 *   - el carrito vacío y la ficha inexistente siguen rechazándose;
 *   - la dirección pasada de largo (más de 200 caracteres) se recorta.
 *
 * Emulador, con puerto propio:
 *   FIRESTORE_EMULATOR_PORT=8762 FIRESTORE_EMULATOR_WS_PORT=9762 \
 *     bash pruebas/correr.sh --project emulador pruebas/modulos/catalogo-web/direccion-opcional.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['SITIO_PUBLICO'] = 'https://catalogo.ejemplo.test';
process.env['INGESTA_CLIENTE16'] = 'valor-de-prueba-de-la-direccion-opcional';

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { checkoutCatalogo, emitirFicha } =
  await import('../../../functions/src/modulos/catalogo-web/catalogoWeb.ts');
const { limitesDe } = await import('../../../functions/src/central/cuenta/planes.ts');

const T = 'dir-opc-venta';
const TELEFONO = '70020001';

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function checkout(ficha: string, cuerpo: unknown): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { 'content-type': 'application/json' };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const ruta = `/api/catalogo/${ficha}/checkout`;
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer, path: ruta, url: ruta, originalUrl: ruta,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, type() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (checkoutCatalogo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

/** Una ficha nueva por pedido: cada una admite un número limitado de carritos. */
async function fichaNueva(): Promise<string> {
  const f = await emitirFicha({
    tenantId: T, phoneNumberId: '1000000301', flujo: 'venta', telefono: TELEFONO, reutilizar: false,
  });
  return f.id;
}

const pedidoDe = async (r: Respuesta) =>
  (await db.doc(`tenants/${T}/pedidos/${String(r.cuerpo['pedidoId'])}`).get()).data() ?? {};
const ITEMS = [{ id: 'i000', cantidad: 1 }];

beforeAll(async () => {
  await db.doc('rutasWhatsApp/1000000301').set({
    tenantId: T, flujo: 'venta', aliasSecreto: 'cliente16', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: T, estado: 'activo', plan: 'crecimiento', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({
    plan: 'crecimiento', limites: limitesDe('crecimiento'), modalidad: 'demostracion',
  });
  await db.doc(`tenants/${T}/config/negocio`).set({
    nombreNegocio: T, numeroRecepcion: '70000001', catalogoWebActivo: true,
  });
  await db.doc(`tenants/${T}/catalogo/i000`).set({
    nombre: 'Taco 0', area: 'tacos', precio: 10, moneda: 'BOB', activo: true,
  });
}, 60_000);

afterAll(async () => {
  await db.recursiveDelete(db.doc(`tenants/${T}`));
  await db.doc('rutasWhatsApp/1000000301').delete();
  for (const f of (await db.collection('fichasCatalogo').where('tenantId', '==', T).get()).docs) {
    await f.ref.delete();
  }
});

describe('envío sin dirección: el pedido entra y llega sin dirección ni ubicación', () => {
  it('sin `direccion` ni `ubicacion`: 200 (antes, 400 «falta la direccion») y el pedido no las lleva', async () => {
    const r = await checkout(await fichaNueva(), { items: ITEMS, entrega: 'envio' });
    expect(r.cuerpo['error']).toBeUndefined();
    expect(r.codigo).toBe(200);
    const p = await pedidoDe(r);
    expect(p['entrega']).toBe('envio');
    expect(p).not.toHaveProperty('direccion');
    expect(p).not.toHaveProperty('ubicacion');
  });

  it('`direccion` en blanco o solo espacios cuenta como ausente: también entra', async () => {
    for (const direccion of ['', '   ', '\n\t ']) {
      const r = await checkout(await fichaNueva(), { items: ITEMS, entrega: 'envio', direccion });
      expect(r.codigo, JSON.stringify(direccion)).toBe(200);
      expect(await pedidoDe(r)).not.toHaveProperty('direccion');
    }
  });

  it('NEGANDO: una ubicación inválida no se guarda (se ignora y el pedido entra sin ella)', async () => {
    const invalidas: unknown[] = [
      { lat: '-16.5', lng: '-68.15' }, { lat: 91, lng: 0 }, { lat: 0, lng: 0 }, { lat: Number.NaN, lng: 1 }, null, 'x',
    ];
    for (const ubicacion of invalidas) {
      const r = await checkout(await fichaNueva(), { items: ITEMS, entrega: 'envio', ubicacion });
      expect(r.codigo, JSON.stringify(ubicacion)).toBe(200);
      expect(await pedidoDe(r), JSON.stringify(ubicacion)).not.toHaveProperty('ubicacion');
    }
  });

  it('con dirección escrita o con ubicación válida el pedido guarda lo que corresponde', async () => {
    const a = await checkout(await fichaNueva(), { items: ITEMS, entrega: 'envio', direccion: 'Calle 1 N 2' });
    expect((await pedidoDe(a))['direccion']).toBe('Calle 1 N 2');
    const b = await checkout(await fichaNueva(), {
      items: ITEMS, entrega: 'envio', ubicacion: { lat: -16.5, lng: -68.15 },
    });
    expect((await pedidoDe(b))['ubicacion']).toEqual({ lat: -16.5, lng: -68.15 });
  });

  it('NEGANDO: la dirección pasada de largo se recorta a 200; no entra entera', async () => {
    const r = await checkout(await fichaNueva(), { items: ITEMS, entrega: 'envio', direccion: 'a'.repeat(500) });
    expect(r.codigo).toBe(200);
    expect(String((await pedidoDe(r))['direccion']).length).toBe(200);
  });
});

describe('lo demás del checkout no se aflojó', () => {
  it('retiro: no guarda ubicación aunque venga en el cuerpo', async () => {
    const r = await checkout(await fichaNueva(), {
      items: ITEMS, entrega: 'retiro', ubicacion: { lat: -16.5, lng: -68.15 },
    });
    expect(r.codigo).toBe(200);
    const p = await pedidoDe(r);
    expect(p['entrega']).toBe('retiro');
    expect(p).not.toHaveProperty('ubicacion');
  });

  it('carrito vacío: 400; ficha inexistente: 404; el código «falta la direccion» ya no sale', async () => {
    const vacio = await checkout(await fichaNueva(), { items: [], entrega: 'envio' });
    expect(vacio.codigo).toBe(400);
    expect(vacio.cuerpo['error']).toBe('carrito vacio');
    expect((await checkout('0'.repeat(32), { items: ITEMS, entrega: 'envio' })).codigo).toBe(404);
    const r = await checkout(await fichaNueva(), { items: ITEMS, entrega: 'envio' });
    expect(r.cuerpo['error']).not.toBe('falta la direccion');
  });
});
