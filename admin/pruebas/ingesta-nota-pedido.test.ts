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
const { ingesta, normalizarParaPruebas: normalizar } = await import('../functions/src/ingesta.ts');

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

describe('`normalizar`: la nota solo pasa con texto, con qr_enviado o pedido_sin_cobro y con líneas', () => {
  const base = { telefono: '59170000001', direccion: 'saliente', tipo: 'image', texto: 'QR', evento: 'qr_enviado', referencia: 'n-1', monto: 20, lineas: LINEAS, entrega: 'retiro' };
  const sinNota = () => normalizar(base) as Record<string, unknown>;
  it('string con qr_enviado y líneas: sale como `nota`; y con pedido_sin_cobro también', () => {
    expect((normalizar({ ...base, nota: 'hola' }) as Record<string, unknown>)['nota']).toBe('hola');
    expect((normalizar({ ...base, evento: 'pedido_sin_cobro', nota: 'hola' }) as Record<string, unknown>)['nota']).toBe('hola');
  });
  it('no-string (número, objeto, arreglo, null, booleano): sin `nota` y el resto idéntico', () => {
    for (const nota of [5, { a: 1 }, ['x'], null, true]) {
      expect(normalizar({ ...base, nota }), JSON.stringify(nota)).toEqual(sinNota());
      expect(normalizar({ ...base, nota })).not.toHaveProperty('nota');
    }
  });
  it('sin líneas, o con un evento que no es qr_enviado/pedido_sin_cobro: sin `nota`', () => {
    const { lineas: _l, ...sinLineas } = base;
    expect(normalizar({ ...sinLineas, nota: 'hola' })).not.toHaveProperty('nota');
    expect(normalizar({ ...base, lineas: [], nota: 'hola' })).not.toHaveProperty('nota');
    for (const evento of ['horarios_ofrecidos', 'cobro_cancelado', undefined]) {
      expect(normalizar({ ...base, evento, nota: 'hola' }), String(evento)).not.toHaveProperty('nota');
    }
  });
  it('el mensaje SIN `nota` es el de siempre: sin la clave y con lo demás (toEqual)', () => {
    const m = sinNota();
    expect(m).not.toHaveProperty('nota');
    expect(m).toEqual({
      telefono: '59170000001', direccion: 'saliente', tipo: 'image', texto: 'QR', origen: expect.anything(),
      lineas: LINEAS, entrega: 'retiro', evento: 'qr_enviado', referencia: 'n-1', monto: 20, ...(m['reglaCobro'] !== undefined ? { reglaCobro: m['reglaCobro'] } : {}),
    });
    expect(Object.keys(normalizar({ ...base, nota: 'x' }) as object).filter((k) => !(k in m))).toEqual(['nota']); // la única diferencia es `nota`
  });
});

describe('pedido_sin_cobro con nota (catálogo externo)', () => {
  it('termina en `notaCliente` del pedido', async () => {
    await db.doc(`tenants/${T}/config/pedidos`).set({ catalogoExterno: { activo: true, monedas: ['ARS'] } });
    const lineas = [{ externa: true, id: 'sku-1', nombre: 'Producto', cantidad: 1, precioCentavos: 10000, moneda: 'ARS' }];
    const r = await reportar({ telefono: tel(), evento: 'pedido_sin_cobro', referencia: 'nota-sc', idMeta: 'wamid.nota-sc', lineas, entrega: 'retiro', nota: 'sin sal' });
    expect(r.codigo).toBe(200);
    const d = await pedidoDe('nota-sc');
    expect(d.exists).toBe(true);
    expect(d.get('notaCliente')).toBe('sin sal');
    expect(d.get('catalogo')).toBe('externo');
  });
});

describe('`lineaLimpia`: los saltos de línea se vuelven espacios', () => {
  it('una nota de varias líneas se guarda en una sola línea', async () => {
    await qr('nota-ml', { nota: 'línea uno\nlínea dos\r\n\nlínea tres' });
    expect((await pedidoDe('nota-ml')).get('notaCliente')).toBe('línea uno línea dos línea tres');
  });
});
