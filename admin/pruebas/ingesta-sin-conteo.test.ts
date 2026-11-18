/**
 * SALIENTE DE IMAGEN SIN CONTEO (16/11/2026), de punta a punta: la `ingesta` real contra el emulador.
 *
 * Las fotos de catálogo que el asistente de Evy y Emma manda por media id se reportan para que se vean y se
 * guarden, pero NO cuestan una conversación. Se prueba NEGANDO: `sinConteo` solo vale con saliente + image y
 * con el booleano exacto `true`; todo lo demás se cuenta como siempre (ante la duda, se cuenta).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-sin-conteo';
process.env['INGESTA_CLIENTE14'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');

const T = 'sin-conteo-imagen';
const NUMERO = '1000000093';
const MES = new Date().toISOString().slice(0, 7);

interface Respuesta { codigo: number; cuerpo: unknown }

async function reportar(cuerpo: Record<string, unknown>): Promise<Respuesta> {
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
  await (ingesta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const conv = async (tel: string) => (await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).get()).data() ?? {};
const mensajes = async (tel: string) =>
  (await db.collection(`tenants/${T}/conversaciones/wa_${tel}/mensajes`).get()).docs.map((d) => d.data());

const entrante = (tel: string) =>
  reportar({ telefono: tel, direccion: 'entrante', tipo: 'text', texto: 'hola, quiero ver fotos' });
const saliente = (tel: string, extra: Record<string, unknown>) =>
  reportar({ telefono: tel, direccion: 'saliente', tipo: 'image', texto: '', idMeta: 'media-1', ...extra });

beforeAll(async () => {
  const previos = await db.collection(`tenants/${T}/conversaciones`).get();
  for (const d of previos.docs) {
    for (const m of (await d.ref.collection('mensajes').get()).docs) await m.ref.delete();
    await d.ref.delete();
  }
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente14', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Sin conteo', estado: 'activo', plan: 'pro' });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia' });
}, 120_000);

describe('saliente image con sinConteo: true', () => {
  const TEL = '5910000000031';

  it('queda en el hilo con su idMeta y NO mueve ningún contador, bloque, métrica ni último mensaje', async () => {
    await entrante(TEL);
    const antesConv = await conv(TEL);
    const antesMet = await metricas();

    const r = await saliente(TEL, { sinConteo: true });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ sinConteo: true, avisarRecepcion: '' });

    // (c) en el hilo, con idMeta.
    const imagenes = (await mensajes(TEL)).filter((m) => m['tipo'] === 'image');
    expect(imagenes).toHaveLength(1);
    expect(imagenes[0]).toMatchObject({ direccion: 'saliente', idMeta: 'media-1' });

    // (a) ni un campo de la conversación cambió, ni las métricas.
    const despuesConv = await conv(TEL);
    expect(despuesConv).toEqual(antesConv);
    expect(await metricas()).toEqual(antesMet);
    expect(despuesConv['respuestasDelPeriodo']).toBe(0);
    expect(despuesConv['mensajesVentana']).toBe(0);
    expect(despuesConv['mensajesTotal']).toBe(1);
  });

  it('26 fotos sin conteo no abren un bloque adicional', async () => {
    const T26 = '5910000000032';
    await entrante(T26);
    const antes = await metricas();
    for (let i = 0; i < 26; i++) await saliente(T26, { sinConteo: true, idMeta: `m${i}` });
    expect((await conv(T26))['mensajesVentana']).toBe(0);
    expect(await metricas()).toEqual(antes);
    expect((await metricas())['bloquesAdicionales']).toBeUndefined();
  });

  it('sobre una conversación que no existe no la crea', async () => {
    const nueva = '5910000000035';
    const r = await saliente(nueva, { sinConteo: true });
    expect(r.codigo).toBe(200);
    expect((await db.doc(`tenants/${T}/conversaciones/wa_${nueva}`).get()).exists).toBe(false);
    // Y tampoco deja un mensaje huérfano: no hay hilo donde colgarlo (revisión del PR #1016).
    expect((await db.collection(`tenants/${T}/conversaciones/wa_${nueva}/mensajes`).get()).size).toBe(0);
  });

  it('el rótulo se recorta a 60 caracteres', async () => {
    const tel = '5910000000034';
    await entrante(tel);
    await saliente(tel, { sinConteo: true, texto: 'x'.repeat(500) });
    const m = await db.collection(`tenants/${T}/conversaciones/wa_${tel}/mensajes`).where('direccion', '==', 'saliente').get();
    expect(m.size).toBe(1);
    expect(String(m.docs[0]!.get('texto')).length).toBe(60);
  });
});

describe('sinConteo que NO vale: se cuenta como siempre', () => {
  it('(d) un saliente image sin sinConteo cuenta igual que hoy', async () => {
    const tel = '5910000000041';
    await entrante(tel);
    await saliente(tel, {});
    expect(await conv(tel)).toMatchObject({ respuestasDelPeriodo: 1, mensajesVentana: 1, mensajesTotal: 2 });
  });

  it('(b) en un entrante se ignora', async () => {
    const tel = '5910000000042';
    await reportar({ telefono: tel, direccion: 'entrante', tipo: 'image', texto: '', sinConteo: true });
    expect(await conv(tel)).toMatchObject({ mensajesTotal: 1 });
    expect((await metricas())['entrantes']).toBeGreaterThan(0);
  });

  it('(b) en un saliente de texto se ignora', async () => {
    const tel = '5910000000043';
    await entrante(tel);
    await reportar({ telefono: tel, direccion: 'saliente', tipo: 'text', texto: 'hola', sinConteo: true });
    expect(await conv(tel)).toMatchObject({ respuestasDelPeriodo: 1, mensajesVentana: 1, mensajesTotal: 2, ultimoMensaje: 'hola' });
  });

  it.each([
    ['"true"', 'true', '5910000000051'], ['1', 1, '5910000000052'], ['"si"', 'si', '5910000000053'],
    ['null', null, '5910000000054'], ['[true]', [true], '5910000000055'],
  ])('(b) con valor %s en un saliente image cuenta como siempre', async (_n, valor, tel) => {
    await entrante(tel);
    await saliente(tel, { sinConteo: valor });
    expect(await conv(tel)).toMatchObject({ respuestasDelPeriodo: 1, mensajesVentana: 1, mensajesTotal: 2 });
  });
});
