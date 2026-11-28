/**
 * LA NOTA DEL CLIENTE VIAJA POR LA INGESTA HASTA `notaCliente` (27/11/2026), NEGANDO.
 *
 * La función `ingesta` real contra el emulador. `nota` es un campo propio del cuerpo, junto a `lineas`/`entrega`/`facturacion`:
 * solo texto, solo con `qr_enviado` (o `pedido_sin_cobro`) y líneas; cualquier otra forma se IGNORA sin error. Un flujo viejo,
 * sin `nota`, produce el pedido de siempre (sin la clave).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-de-la-nota';
process.env['INGESTA_CLIENTE19'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');

const T = 'nota-pedido-ingesta';
const NUMERO = '1000000089';

interface Respuesta { codigo: number; cuerpo: unknown }

async function llamar(fn: unknown, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: null };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const reportar = (cuerpo: Record<string, unknown>) =>
  llamar(ingesta, { direccion: 'saliente', tipo: 'image', texto: 'QR', reglaCobro: 2, ...cuerpo });
const pedidos = async () => (await db.collection(`tenants/${T}/pedidos`).get()).docs;
const estadoDe = async (id: string) => (await db.doc(`tenants/${T}/pedidos/${id}`).get()).get('estado');
const LINEAS = [{ id: 'taco', cantidad: 2, precio: 0.01 }];
let n = 0;
const tel = () => `5917000${String(5000 + ++n).padStart(4, '0')}`;

beforeAll(async () => {
  await db.recursiveDelete(db.doc(`tenants/${T}`));
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente19', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Pedido WA', estado: 'activo', plan: 'basico', flujos: ['venta'], vertical: 'venta', modulos: ['productos', 'pedidos'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/catalogo/taco`).set({ nombre: 'Taco', precio: 10, moneda: 'BOB', activo: true });
}, 120_000);

const pedidoDe = async (ref: string) => (await db.doc(`tenants/${T}/pedidos/wa_${ref}`).get());
const qr = (ref: string, extra: Record<string, unknown> = {}) =>
  reportar({ telefono: tel(), evento: 'qr_enviado', referencia: ref, idMeta: `wamid.${ref}`, monto: 20, lineas: LINEAS, entrega: 'retiro', ...extra });

describe('la nota por la ingesta', () => {
  it('nota de texto con qr_enviado y líneas: el pedido guarda `notaCliente`', async () => {
    expect((await qr('nota-1', { nota: 'sin cebolla, por favor' })).codigo).toBe(200);
    const d = await pedidoDe('nota-1');
    expect(d.get('notaCliente')).toBe('sin cebolla, por favor');
    expect(d.data()).toMatchObject({ origen: 'whatsapp', total: 20, estado: 'recibido' }); // lo demás, igual que siempre
  });
  it('sin nota (flujo viejo): el pedido NO tiene la clave', async () => {
    expect((await qr('nota-2')).codigo).toBe(200);
    expect((await pedidoDe('nota-2')).data()).not.toHaveProperty('notaCliente');
  });
  it('nota que no es texto (número, objeto, arreglo, null, booleano): se ignora, sin error y sin la clave', async () => {
    let i = 0;
    for (const nota of [5, { a: 1 }, ['x'], null, true]) {
      const ref = `nota-nt-${++i}`;
      expect((await qr(ref, { nota })).codigo).toBe(200);
      const d = await pedidoDe(ref);
      expect(d.exists, JSON.stringify(nota)).toBe(true);
      expect(d.data(), JSON.stringify(nota)).not.toHaveProperty('notaCliente');
    }
  });
  it('nota vacía, solo espacios o solo un enlace: el pedido se crea sin `notaCliente`', async () => {
    let i = 0;
    for (const nota of ['', '   \n ', 'https://malo.example/x']) {
      const ref = `nota-va-${++i}`;
      await qr(ref, { nota });
      const d = await pedidoDe(ref);
      expect(d.exists).toBe(true);
      expect(d.data()).not.toHaveProperty('notaCliente');
    }
  });
  it('nota larga se recorta a 500; con enlaces, marcas y controles sale limpia', async () => {
    await qr('nota-lg', { nota: 'x'.repeat(900) });
    expect(Array.from(String((await pedidoDe('nota-lg')).get('notaCliente')))).toHaveLength(500);
    await qr('nota-sa', { nota: 'hola https://malo.example/x <b>mundo</b>\u0007' });
    const n = String((await pedidoDe('nota-sa')).get('notaCliente'));
    expect(n).not.toMatch(/http|[<>&]/); expect(n).not.toMatch(/\p{Cc}/u); expect(n).toContain('mundo');
  });
  it('nota SIN líneas, o con un evento que no es qr_enviado/pedido_sin_cobro: se ignora y no se crea pedido', async () => {
    const antes = (await db.collection(`tenants/${T}/pedidos`).get()).size;
    const r1 = await reportar({ telefono: tel(), evento: 'qr_enviado', referencia: 'nota-sl', idMeta: 'wamid.nota-sl', monto: 20, nota: 'hola' });
    const r2 = await reportar({ telefono: tel(), evento: 'horarios_ofrecidos', referencia: 'nota-ev', lineas: LINEAS, nota: 'hola' });
    expect([r1.codigo, r2.codigo]).toEqual([200, 200]);
    expect((await db.collection(`tenants/${T}/pedidos`).get()).size).toBe(antes);
  });
});
