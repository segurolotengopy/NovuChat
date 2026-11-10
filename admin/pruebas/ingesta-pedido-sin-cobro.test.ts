/**
 * LA INGESTA REENVIA `pedido_sin_cobro` AL GANCHO DE PEDIDOS (B7, Casa Bermejo), NEGANDO.
 *
 * La función `ingesta` real contra el emulador: con `pedido_sin_cobro` con líneas externas crea el
 * pedido sinCobro; claves desconocidas, otro evento, tenant sin dato, y `qr_enviado` no cambian; el
 * conteo de conversaciones es el de cualquier mensaje saliente (cero mensajes agregados).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-sin-cobro';
process.env['INGESTA_CLIENTE20'] = TOKEN;

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


const T = 'pedido-sin-cobro-ing';
const TB = 'pedido-sin-cobro-otro';
const NUMERO = '1000000089';
const NUMERO_B = '1000000090';

interface Respuesta { codigo: number; cuerpo: unknown }

async function llamar(fn: unknown, cuerpo: Record<string, unknown>, numero = NUMERO): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': numero, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
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

const base = { direccion: 'saliente', tipo: 'text', texto: 'Recibimos tu pedido' };
const ext = (o: Record<string, unknown> = {}) => ({ externa: true, id: 'sku-1', nombre: 'Mesa', cantidad: 2, precioCentavos: 1500000, moneda: 'ARS', ...o });
const pedidos = async (t = T) => (await db.collection(`tenants/${t}/pedidos`).get()).docs;
const conv = async (t: string, tel: string) => (await db.doc(`tenants/${t}/conversaciones/wa_${tel}`).get()).data() as Record<string, any>;
let n = 0;
const tel = () => `5491100${String(1000 + ++n).padStart(4, '0')}`;

beforeAll(async () => {
  for (const [t, num, ext_] of [[T, NUMERO, true], [TB, NUMERO_B, false]] as const) {
    await db.recursiveDelete(db.doc(`tenants/${t}`));
    await db.doc(`rutasWhatsApp/${num}`).set({ tenantId: t, flujo: 'venta', aliasSecreto: 'cliente20', estado: 'activo' });
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', plan: 'basico', flujos: ['venta'], vertical: 'venta', modulos: ['productos', 'pedidos'] });
    await db.doc(`tenants/${t}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
    if (ext_) await db.doc(`tenants/${t}/config/pedidos`).set({ catalogoExterno: { activo: true, monedas: ['ARS'] } });
  }
}, 120_000);

describe('la ingesta reenvía pedido_sin_cobro al gancho de Pedidos', () => {
  it('con líneas externas crea wa_<ref> sinCobro con sus campos exactos y responde 200', async () => {
    const t = tel();
    const r = await llamar(ingesta, { ...base, telefono: t, evento: 'pedido_sin_cobro', referencia: 'ps-1', lineas: [ext()], entrega: 'retiro' });
    expect(r.codigo).toBe(200);
    const d = (await db.doc(`tenants/${T}/pedidos/wa_ps-1`).get()).data();
    expect(d).toMatchObject({ origen: 'whatsapp', catalogo: 'externo', estado: 'recibido', moneda: 'ARS', total: 30000, totalDistinto: false, referenciaQr: 'ps-1' });
    expect(d?.['items']).toHaveLength(1);
    expect(d?.['items'][0]).toMatchObject({ id: 'sku-1', cantidad: 2, precioCentavos: 1500000, moneda: 'ARS', externa: true });
  });

  it('no abre cobro y el conteo es el de un mensaje saliente cualquiera (cero mensajes agregados)', async () => {
    const metricas = async () => ((await db.collection(`tenants/${T}/metricas`).get()).docs[0]?.data() ?? {}) as Record<string, any>;
    const delta = (a: Record<string, any>, b: Record<string, any>) => {
      const r: Record<string, number> = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (typeof (b[k] ?? a[k]) === 'number') r[k] = (b[k] ?? 0) - (a[k] ?? 0);
      }
      return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== 0));
    };
    const m0 = await metricas();
    const t = tel();
    await llamar(ingesta, { ...base, telefono: t, evento: 'pedido_sin_cobro', referencia: 'ps-2', lineas: [ext()], entrega: 'retiro' });
    const m1 = await metricas();
    const t2 = tel();
    await llamar(ingesta, { ...base, telefono: t2 });
    const m2 = await metricas();
    const c = await conv(T, t);
    expect(c['solicitud']).toBeUndefined();
    expect(c['mensajesTotal']).toBe(1);
    expect(delta(m0, m1)).toEqual(delta(m1, m2));
    expect(delta(m0, m1)['senasEnviadas']).toBeUndefined();
  });

  it('negado: líneas del catálogo propio, claves desconocidas o sin líneas no crean pedido', async () => {
    const antes = (await pedidos()).length;
    const tels = [tel(), tel(), tel(), tel()];
    const rs = [
      await llamar(ingesta, { ...base, telefono: tels[0], evento: 'pedido_sin_cobro', referencia: 'ps-3', lineas: [{ id: 'taco', cantidad: 1 }], entrega: 'retiro' }),
      await llamar(ingesta, { ...base, telefono: tels[1], evento: 'pedido_sin_cobro', referencia: 'ps-4', lineas: [ext({ rareza: 1 })], entrega: 'retiro' }),
      await llamar(ingesta, { ...base, telefono: tels[2], evento: 'pedido_sin_cobro', referencia: 'ps-5' }),
      await llamar(ingesta, { ...base, telefono: tels[3], evento: 'pedido_sin_cobro_x', referencia: 'ps-6', lineas: [ext()], entrega: 'retiro' }),
    ];
    expect(rs.map((r) => r.codigo)).toEqual([200, 200, 200, 200]);
    expect((await pedidos()).length).toBe(antes);
  });

  it('negado: el campo `reemplaza` no viaja con pedido_sin_cobro (solo qr_enviado)', async () => {
    const t = tel();
    await db.doc(`tenants/${T}/pedidos/cat_ps_1`).set({ origen: 'catalogo-web', conversacionId: `wa_${t}`, estado: 'recibido', total: 20 });
    await llamar(ingesta, { ...base, telefono: t, evento: 'pedido_sin_cobro', referencia: 'ps-7', lineas: [ext()], entrega: 'retiro', reemplaza: 'cat_ps_1' });
    expect((await db.doc(`tenants/${T}/pedidos/cat_ps_1`).get()).get('estado')).toBe('recibido');
  });

  it('negado: un tenant sin catálogo externo habilitado no crea pedido, aunque llegue el evento', async () => {
    const r = await llamar(ingesta, { ...base, telefono: tel(), evento: 'pedido_sin_cobro', referencia: 'ps-8', lineas: [ext()], entrega: 'retiro' }, NUMERO_B);
    expect(r.codigo).toBe(200);
    expect((await pedidos(TB)).length).toBe(0);
    expect((await db.doc(`tenants/${T}/pedidos/wa_ps-8`).get()).exists).toBe(false);
  });

  it('qr_enviado no cambia: sigue abriendo solicitud y contando la seña', async () => {
    const t = tel();
    const r = await llamar(ingesta, { ...base, tipo: 'image', telefono: t, evento: 'qr_enviado', referencia: 'ps-9', idMeta: 'wamid.ps9', monto: 20 });
    expect(r.codigo).toBe(200);
    const c = await conv(T, t);
    expect(c['solicitud']).toMatchObject({ etapa: 'qr_enviado', evento: { id: 'ps-9' } });
    const m = (await db.collection(`tenants/${T}/metricas`).get()).docs[0]?.data() ?? {};
    expect(m['senasEnviadas']).toBe(1);
  });
});
