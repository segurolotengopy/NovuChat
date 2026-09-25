/**
 * DE DÓNDE NACIÓ LA CONVERSACIÓN, DE PUNTA A PUNTA: la función `ingesta` real,
 * con su transacción, contra el emulador de Firestore.
 *
 * QUÉ SOSTIENE ESTA PRUEBA. Una conversación que nace de un anuncio de clic a
 * WhatsApp abre la ventana de punto de entrada gratuito de Meta: 72 horas en
 * las que la empresa no paga ningún mensaje y no gasta franquicia. La fracción
 * del tráfico que entra así decide el margen de un contrato —con 30 % no se
 * pierde y con 0 % se pierden 38 USD al mes (`Analisis/38`)—, y hasta ahora no
 * se podía medir: el flujo leía el `referral` de Meta y no lo reportaba.
 *
 * EL MODO DE FALLO QUE MÁS IMPORTA no es no contarlo: es contarlo de más o
 * perderlo en el segundo mensaje. Meta manda `referral` SOLO en el primer
 * mensaje de la conversación, así que un origen que se refrescara con cada
 * mensaje convertiría en `directo` a toda conversación que vino de un anuncio,
 * y la cifra diría que las campañas no traen a nadie. Por eso el origen se
 * escribe al ABRIR la ventana y no se vuelve a tocar, igual que `atencionDesde`.
 *
 * Y ANTE LA DUDA, `directo`: un valor desconocido no se toma por `anuncio`.
 * Sobreestimar la fracción por anuncio infla el margen esperado, que es el
 * error caro; subestimarla solo hace la cuenta más conservadora.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-del-origen';
process.env['INGESTA_CLIENTE14'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');

const T = 'origen-anuncio';
const NUMERO = '1000000092';
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
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (ingesta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

/** Un mensaje del cliente. `origen` es lo que reportaría el flujo. */
const entrante = (telefono: string, origen?: string) =>
  reportar({
    telefono, direccion: 'entrante', tipo: 'text', texto: 'hola, quiero información',
    ...(origen === undefined ? {} : { origen }),
  });

/** Una respuesta del asistente. Nunca trae origen: no lo decide el asistente. */
const saliente = (telefono: string) =>
  reportar({ telefono, direccion: 'saliente', tipo: 'text', texto: 'con gusto' });

const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const conversacion = async (telefono: string) =>
  (await db.doc(`tenants/${T}/conversaciones/wa_${telefono}`).get()).data() ?? {};

beforeAll(async () => {
  const previos = await db.collection(`tenants/${T}/conversaciones`).get();
  for (const d of previos.docs) await d.ref.delete();
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente14', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Origen', estado: 'activo', plan: 'pro' });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia' });
}, 120_000);

describe('El origen de la conversación', () => {
  it('una que nace de un anuncio se cuenta como conversación Y como por anuncio', async () => {
    const r = await entrante('5910000000011', 'anuncio');
    expect(r.codigo).toBe(200);
    expect(await conversacion('5910000000011')).toMatchObject({ origen: 'anuncio' });
    expect(await metricas()).toMatchObject({ conversaciones: 1, conversacionesPorAnuncio: 1 });
  });

  it('una directa suma conversación pero NO suma por anuncio', async () => {
    await entrante('5910000000012', 'directo');
    expect(await conversacion('5910000000012')).toMatchObject({ origen: 'directo' });
    expect(await metricas()).toMatchObject({ conversaciones: 2, conversacionesPorAnuncio: 1 });
  });

  it('sin el campo (un flujo viejo que todavía no lo reporta) se cuenta como directa', async () => {
    // Es el caso que hay que soportar mientras los flujos se van publicando:
    // la cifra queda conservadora, nunca inflada.
    await entrante('5910000000013');
    expect(await conversacion('5910000000013')).toMatchObject({ origen: 'directo' });
    expect(await metricas()).toMatchObject({ conversaciones: 3, conversacionesPorAnuncio: 1 });
  });
});

describe('El origen es de la ventana, no del mensaje', () => {
  const T1 = '5910000000021';

  it('el segundo mensaje NO borra el anuncio del primero', async () => {
    // EL MODO DE FALLO CARO. Meta manda `referral` solo en el primer mensaje;
    // si el origen se refrescara, toda conversación de más de un mensaje
    // terminaría contada como directa.
    await entrante(T1, 'anuncio');
    expect(await conversacion(T1)).toMatchObject({ origen: 'anuncio' });

    await saliente(T1);
    await entrante(T1);            // sin origen, como llegan todos los siguientes
    await entrante(T1, 'directo'); // y aunque llegara diciendo «directo»

    expect(await conversacion(T1)).toMatchObject({ origen: 'anuncio' });
    // Y los mensajes siguientes no suman otra conversación ni otro por anuncio.
    expect(await metricas()).toMatchObject({ conversaciones: 4, conversacionesPorAnuncio: 2 });
  });

  it('un bloque adicional hereda el origen de la ventana que lo trajo', async () => {
    // La respuesta 26 factura OTRA conversación (`Analisis/27`). Nace de la
    // misma ventana, así que se atribuye a la campaña que trajo esa ventana.
    const T2 = '5910000000022';
    await entrante(T2, 'anuncio');
    const antes = await metricas();

    // Se adelanta el contador de la ventana, como hacen las pruebas del bloque:
    // lo que se ejercita acá es la atribución, no el conteo de 25.
    await db.doc(`tenants/${T}/conversaciones/wa_${T2}`).set({ mensajesVentana: 25 }, { merge: true });
    await saliente(T2);

    const despues = await metricas();
    expect(despues.bloquesAdicionales).toBe(1);
    expect(despues.conversaciones).toBe(antes.conversaciones + 1);
    expect(despues.conversacionesPorAnuncio).toBe(antes.conversacionesPorAnuncio + 1);
  });
});

describe('Ante la duda, directo', () => {
  it('un valor inventado NO se toma por anuncio', async () => {
    // Escrita negando: lo que llega es dato no confiable, lo arma el flujo.
    for (const [i, valor] of ['campaña', 'ANUNCIO', 'anuncio ', 'ad', '', 'true'].entries()) {
      const t = `591000000003${i}`;
      await entrante(t, valor);
      expect(await conversacion(t), valor).toMatchObject({ origen: 'directo' });
    }
  });

  it('un tipo que no es cadena tampoco', async () => {
    for (const [i, valor] of [1, true, null, { origen: 'anuncio' }, ['anuncio']].entries()) {
      const t = `591000000004${i}`;
      await reportar({ telefono: t, direccion: 'entrante', tipo: 'text', texto: 'hola', origen: valor });
      expect(await conversacion(t), JSON.stringify(valor)).toMatchObject({ origen: 'directo' });
    }
  });

  it('las conversaciones por anuncio NUNCA superan al total de conversaciones', async () => {
    // La fracción se calcula contra `conversaciones`: si el subconjunto pudiera
    // pasarla, cualquier informe que las divida daría más del 100 %.
    const m = await metricas();
    expect(m.conversacionesPorAnuncio).toBeLessThanOrEqual(m.conversaciones);
  });
});
