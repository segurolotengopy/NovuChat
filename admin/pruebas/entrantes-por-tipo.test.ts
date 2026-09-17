/**
 * ENTRANTES POR TIPO, DE PUNTA A PUNTA: la función `ingesta` real, con su
 * transacción, contra el emulador de Firestore (bloque 3, 17/09/2026).
 *
 * POR QUÉ EXISTE ESTE CONTADOR. Hasta hoy el agregado del mes decía cuántos
 * mensajes mandaron los clientes (`entrantes`) pero no de qué clase. La
 * clínica sostiene que en la vida real llegan muchos audios y muchas fotos, y
 * no había ninguna cifra para confirmarlo: el flujo respondía «por ahora
 * atiendo por texto» —un mensaje pagado que no avanza nada— y nadie sabía
 * cuántas veces al mes pasaba eso. La consola lo muestra en «Consumo».
 *
 * LO QUE SE PRUEBA ACÁ y no se puede probar sin emulador: que el incremento
 * sobre la clave anidada viaja en la MISMA transacción que `entrantes`, que
 * `merge: true` fusiona el mapa en vez de pisarlo, que un tipo desconocido cae
 * en `otro` —y por lo tanto nunca siembra una clave arbitraria en la colección
 * que factura— y que un saliente no toca el mapa.
 *
 * La regla de Firestore que niega las claves fuera de lista está en
 * `reglas.test.ts` («Entrantes por tipo»), negando.
 *
 * La petición se autentica con el token por número, igual que n8n
 * (`firma.ts`): el valor del secreto sale del entorno, como en producción.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-de-los-entrantes';
process.env['INGESTA_CLIENTE20'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');

const T = 'entrantes-por-tipo';
const NUMERO = '1000000092';
const MES = new Date().toISOString().slice(0, 7);   // el mismo período que usa la ingesta

interface Respuesta { codigo: number; cuerpo: unknown }

/** Un mensaje como el que manda n8n, con su tipo y su dirección. */
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
  // Lo mínimo de una respuesta de Express que usan la ingesta y el envoltorio
  // de firebase-functions (el middleware de CORS escucha `finish`).
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

const entrante = (telefono: string, tipo: string, texto = 'hola') =>
  reportar({ telefono, direccion: 'entrante', tipo, texto });

const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const porTipo = async () => (await metricas())['entrantesPorTipo'] as Record<string, number> | undefined;

// Dos minutos de margen: el emulador puede quedar con un bloqueo de otra suite
// (ver la nota larga en `aviso-consumo.test.ts`).
beforeAll(async () => {
  for (const c of ['conversaciones', 'bitacora']) {
    const previos = await db.collection(`tenants/${T}/${c}`).get();
    for (const d of previos.docs) await d.ref.delete();
  }
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente20', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Entrantes', estado: 'activo', plan: 'basico' });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
}, 120_000);

describe('Entrantes por tipo en la ingesta', () => {
  it('cada entrante suma uno a su tipo, y el total sigue cuadrando', async () => {
    expect((await entrante('5910000000101', 'text')).codigo).toBe(200);
    expect((await entrante('5910000000102', 'text')).codigo).toBe(200);
    expect((await entrante('5910000000103', 'audio')).codigo).toBe(200);
    expect((await entrante('5910000000104', 'image')).codigo).toBe(200);
    expect((await entrante('5910000000105', 'document')).codigo).toBe(200);

    expect(await porTipo()).toEqual({ text: 2, audio: 1, image: 1, document: 1 });
    // La suma de los tipos ES el total de entrantes: van en la misma
    // transacción, así que no pueden quedar desfasados.
    const m = await metricas();
    expect(m['entrantes']).toBe(5);
    expect(Object.values(await porTipo() ?? {}).reduce((a, b) => a + b, 0)).toBe(m['entrantes']);
  });

  it('el mapa se fusiona: un tipo nuevo no pisa a los que ya estaban', async () => {
    await entrante('5910000000106', 'interactive');
    await entrante('5910000000107', 'location');
    expect(await porTipo()).toEqual({ text: 2, audio: 1, image: 1, document: 1, interactive: 1, location: 1 });
  });

  it('un tipo que Meta manda y la ingesta no conoce cae en «otro», nunca siembra una clave nueva', async () => {
    // `sticker`, `video`, `contacts`, o lo que Meta agregue mañana: la clave
    // del mapa es el tipo YA NORMALIZADO, así que la colección que factura no
    // se llena de campos que nadie declaró.
    for (const tipo of ['sticker', 'video', 'contacts', 'reaction', '../../otro']) {
      await entrante('5910000000108', tipo);
    }
    expect((await porTipo())?.['otro']).toBe(5);
    expect(Object.keys(await porTipo() ?? {}).sort()).toEqual(
      ['audio', 'document', 'image', 'interactive', 'location', 'otro', 'text']);
  });

  it('un saliente NO toca el mapa: cuenta lo que el cliente manda, no lo que el asistente responde', async () => {
    const antes = await porTipo();
    const r = await reportar({ telefono: '5910000000101', direccion: 'saliente', tipo: 'text', texto: 'listo' });
    expect(r.codigo).toBe(200);
    expect(await porTipo()).toEqual(antes);
    // Pero el mensaje sí se contó: es el que Meta cobra.
    expect((await metricas())['mensajes']).toBe(13);
  });

  it('no cambia nada de lo que recibe n8n: 0 mensajes agregados', async () => {
    const r = await entrante('5910000000109', 'audio');
    expect(r.codigo).toBe(200);
    // La respuesta a n8n es la de siempre: el estado de atención y nada más.
    // Este contador no agrega ni quita un solo mensaje de WhatsApp.
    expect(r.cuerpo).toMatchObject({ atencion: { estado: 'normal' }, avisarRecepcion: null });
    expect(Object.keys(r.cuerpo as object).sort()).toEqual(['atencion', 'avisarRecepcion']);
  });
});
