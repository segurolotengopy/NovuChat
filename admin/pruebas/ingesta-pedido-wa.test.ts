/**
 * LA INGESTA CREA EL PEDIDO wa_ DE PUNTA A PUNTA (PR-4), NEGANDO.
 *
 * La función `ingesta` real contra el emulador: con `qr_enviado` + `reglaCobro: 2` +
 * líneas se crea el pedido; sin líneas, con otro evento o con el gancho roto la
 * respuesta HTTP es la de siempre y no se crea (o no se rompe) nada.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-del-pedido-wa';
process.env['INGESTA_CLIENTE19'] = TOKEN;

const roto = vi.hoisted(() => ({ activo: false }));
vi.mock('../functions/src/modulos/pedidos/pedidoDelQr.ts', async (orig) => {
  const m = await orig<Record<string, unknown>>();
  return {
    ...m,
    crearPedidoWa: async (e: unknown) => {
      if (roto.activo) throw new Error('gancho roto a proposito 59170000001');
      return (m['crearPedidoWa'] as (x: unknown) => Promise<unknown>)(e);
    },
  };
});

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');

const T = 'pedido-wa-ingesta';
const NUMERO = '1000000088';

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
beforeEach(() => { roto.activo = false; });

describe('la ingesta y el pedido wa_', () => {
  it('qr_enviado con líneas crea wa_<ref> con el precio del catálogo y responde 200', async () => {
    const t = tel();
    const r = await reportar({ telefono: t, evento: 'qr_enviado', referencia: 'ped-i-1', idMeta: 'wamid.i1', monto: 20, lineas: LINEAS, entrega: 'retiro' });
    expect(r.codigo).toBe(200);
    const d = await db.doc(`tenants/${T}/pedidos/wa_ped-i-1`).get();
    expect(d.data()).toMatchObject({ origen: 'whatsapp', total: 20, estado: 'recibido', totalDistinto: false });
  });

  it('sin líneas, o con líneas en OTRO evento, no crea nada y responde igual', async () => {
    const antes = (await pedidos()).length;
    const r1 = await reportar({ telefono: tel(), evento: 'qr_enviado', referencia: 'ped-i-2', idMeta: 'wamid.i2', monto: 20 });
    const r2 = await reportar({ telefono: tel(), evento: 'horarios_ofrecidos', referencia: 'ped-i-3', lineas: LINEAS });
    expect([r1.codigo, r2.codigo]).toEqual([200, 200]);
    expect((await pedidos()).length).toBe(antes);
  });

  it('el gancho roto no cambia la respuesta: mismo código y mismas claves que sin líneas', async () => {
    const base = await reportar({ telefono: tel(), evento: 'qr_enviado', referencia: 'ped-i-4', idMeta: 'wamid.i4', monto: 20 });
    roto.activo = true;
    const t = tel();
    const r = await reportar({ telefono: t, evento: 'qr_enviado', referencia: 'ped-i-5', idMeta: 'wamid.i5', monto: 20, lineas: LINEAS, entrega: 'retiro' });
    expect(r.codigo).toBe(base.codigo);
    expect(Object.keys(r.cuerpo as object).sort()).toEqual(Object.keys(base.cuerpo as object).sort());
    expect((await db.doc(`tenants/${T}/pedidos/wa_ped-i-5`).get()).exists).toBe(false);
    // Y la solicitud de cobro SÍ quedó abierta: el fallo del pedido no frena el cobro.
    const conv = (await db.doc(`tenants/${T}/conversaciones/wa_${t}`).get()).data() as Record<string, any>;
    expect(conv['solicitud']).toMatchObject({ etapa: 'qr_enviado', evento: { id: 'ped-i-5' } });
  });

  it('un QR nuevo con otra referencia reemplaza al anterior; cobro_cancelado cancela el vigente', async () => {
    const t = tel();
    await reportar({ telefono: t, evento: 'qr_enviado', referencia: 'ped-i-6', idMeta: 'wamid.i6', monto: 20, lineas: LINEAS, entrega: 'retiro' });
    await reportar({ telefono: t, evento: 'qr_enviado', referencia: 'ped-i-7', idMeta: 'wamid.i7', monto: 10, lineas: [{ id: 'taco', cantidad: 1 }], entrega: 'retiro' });
    expect(await estadoDe('wa_ped-i-6')).toBe('reemplazado');
    expect(await estadoDe('wa_ped-i-7')).toBe('recibido');
    await reportar({ telefono: t, evento: 'cobro_cancelado', direccion: 'entrante', tipo: 'text', texto: 'cancelar' });
    expect(await estadoDe('wa_ped-i-7')).toBe('cancelado');
  });

  it('la referencia anterior de OTRA conversación no se cierra', async () => {
    const a = tel(); const b = tel();
    await reportar({ telefono: a, evento: 'qr_enviado', referencia: 'ped-i-8', idMeta: 'wamid.i8', monto: 20, lineas: LINEAS, entrega: 'retiro' });
    await reportar({ telefono: b, evento: 'cobro_cancelado', direccion: 'entrante', tipo: 'text', texto: 'cancelar' });
    expect(await estadoDe('wa_ped-i-8')).toBe('recibido');
  });
});
