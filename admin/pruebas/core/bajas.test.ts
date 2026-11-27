/**
 * =============================================================================
 * BAJAS DE LA CAMPAÑA SALIENTE (PR-A, 26/11/2026): `aplicarRespuestaDeCampana` y el evento `campana_respuesta`
 * =============================================================================
 *
 * La `ingesta` REAL contra el emulador. Un entrante con `evento: 'campana_respuesta'` («Sí, contáctenme» / «No,
 * gracias») escribe en la MISMA transacción que el mensaje:
 *   - «no»: `tenants/{t}/bajas/{wa_tel}` = { canal, origen, campanaId, desde } y `campanaRespuesta` en la conversación;
 *   - «sí»: solo `campanaRespuesta`; NUNCA una baja.
 * Se niega: un «sí» con `campanaId` malo, respuesta fuera de la lista, un evento saliente, una baja repetida (no duplica ni pisa
 * `desde`). Un «no» con id malo o ausente igual crea la baja con `campanaId` null, también con la conversación bloqueada o el
 * servicio cortado. La baja de un comercio no aparece en el otro.
 *
 * Puerto del emulador: 8231 por convención.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias de esta suite: 01 y 02. Valores de prueba, no secretos.
const TOKENES = { a: 'valor-de-prueba-bajas-a', b: 'valor-de-prueba-bajas-b' };
process.env['INGESTA_CLIENTE01'] = TOKENES.a;
process.env['INGESTA_CLIENTE02'] = TOKENES.b;

const { ingesta } = await import('../../functions/src/index.ts');
const BAJAS = await import('../../functions/src/core/conversacion/bajas.ts');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();

interface Comercio { id: string; numero: string; alias: string; token: string }
const A: Comercio = { id: 'bajas-a', numero: '1000000941', alias: 'cliente01', token: TOKENES.a };
const B: Comercio = { id: 'bajas-b', numero: '1000000942', alias: 'cliente02', token: TOKENES.b };
interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function llamar(c: Comercio, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': c.numero, authorization: `Bearer ${c.token}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cabeceras, get: leer, header: leer };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(cod: number) { r.codigo = cod; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (ingesta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
const TEL = '59100000001';
const CAMPANA = 'camp-prueba-01';
const responder = (c: Comercio, extra: Record<string, unknown>, tel = TEL, direccion = 'entrante') =>
  llamar(c, { telefono: tel, direccion, tipo: 'text', texto: 'No, gracias', evento: 'campana_respuesta', ...extra });

type Datos = Record<string, unknown>;
const refBaja = (c: Comercio, tel = TEL) => db.doc(`tenants/${c.id}/bajas/wa_${tel}`);
const baja = async (c: Comercio, tel = TEL) => { const s = await refBaja(c, tel).get(); return s.exists ? (s.data() as Datos) : null; };
const conversacion = async (c: Comercio, tel = TEL): Promise<Datos> =>
  (await db.doc(`tenants/${c.id}/conversaciones/wa_${tel}`).get()).data() ?? {};
const cuantasBajas = async (c: Comercio) => (await db.collection(`tenants/${c.id}/bajas`).get()).size;

async function limpiar(c: Comercio) {
  for (const col of ['auditoria', 'bitacora', 'metricas', 'bajas']) {
    for (const d of (await db.collection(`tenants/${c.id}/${col}`).get()).docs) await d.ref.delete();
  }
  for (const d of (await db.collection(`tenants/${c.id}/conversaciones`).get()).docs) {
    for (const m of (await d.ref.collection('mensajes').get()).docs) await m.ref.delete();
    await d.ref.delete();
  }
}

beforeAll(async () => {
  for (const c of [A, B]) {
    await limpiar(c);
    await db.doc(`rutasWhatsApp/${c.numero}`).set({ tenantId: c.id, flujo: 'agendamiento', aliasSecreto: c.alias, estado: 'activo' });
    await db.doc(`tenants/${c.id}`).set({ nombre: `Comercio ${c.id}`, estado: 'activo', plan: 'pro' });
  }
}, 120_000);
afterAll(async () => { for (const c of [A, B]) { await limpiar(c); await db.doc(`rutasWhatsApp/${c.numero}`).delete(); } });
beforeEach(async () => {
  for (const c of [A, B]) { await limpiar(c); await db.doc(`tenants/${c.id}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia' }); }
});

describe('«No, gracias»: crea la baja y anota la respuesta, en la misma transacción que el mensaje', () => {
  it('crea bajas/wa_tel con canal, origen, campanaId y desde; y `campanaRespuesta` en la conversación', async () => {
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(r.codigo).toBe(200);
    expect(await baja(A)).toEqual({ canal: 'whatsapp', origen: 'boton_campana', campanaId: CAMPANA, desde: expect.anything() });
    expect((await conversacion(A))['campanaRespuesta']).toMatchObject({ campanaId: CAMPANA, respuesta: 'no' });
    // El mensaje también quedó guardado: una sola transacción.
    expect((await db.collection(`tenants/${A.id}/conversaciones/wa_${TEL}/mensajes`).get()).size).toBe(1);
  });

  it('NIEGA: una baja repetida no duplica ni pisa `desde` ni `campanaId`', async () => {
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    const primera = (await baja(A))!;
    await responder(A, { campanaEnvioId: 'otra-campana', respuestaCampana: 'no' });
    expect(await cuantasBajas(A)).toBe(1);
    expect(await baja(A)).toEqual(primera);
    expect((await baja(A))!['desde']).toEqual(primera['desde']);
    expect((await baja(A))!['campanaId']).toBe(CAMPANA);
  });

  it('la baja es del comercio: la del mismo teléfono en B no aparece, y A no tiene la de B', async () => {
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(await baja(B)).toBeNull();
    await responder(B, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(await cuantasBajas(A)).toBe(1);
    expect(await cuantasBajas(B)).toBe(1);
  });
});

describe('«Sí, contáctenme»: anota la respuesta y NO crea baja', () => {
  it('NIEGA: «sí» no crea baja y deja `campanaRespuesta`', async () => {
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'si', texto: 'Sí, contáctenme' });
    expect(r.codigo).toBe(200);
    expect(await baja(A)).toBeNull();
    expect(await cuantasBajas(A)).toBe(0);
    expect((await conversacion(A))['campanaRespuesta']).toMatchObject({ campanaId: CAMPANA, respuesta: 'si' });
  });

  it('un «sí» no borra una baja anterior de la misma persona', async () => {
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'si' });
    expect(await baja(A)).not.toBeNull();
  });
});

const IDS_MALOS: [string, Record<string, unknown>][] = [
  ['campanaId con mayúsculas', { campanaEnvioId: 'Camp-Prueba' }],
  ['campanaId de 2', { campanaEnvioId: 'ab' }],
  ['campanaId de 41', { campanaEnvioId: 'a'.repeat(41) }],
  ['campanaId con barra', { campanaEnvioId: 'camp/x' }],
  ['campanaId con espacio', { campanaEnvioId: 'camp x' }],
  ['campanaId ausente', {}],
  ['campanaId no texto', { campanaEnvioId: 123 }],
];

describe('un «No» NUNCA se pierde: sin id de campaña válido igual crea la baja, con `campanaId` null', () => {
  it.each(IDS_MALOS)('%s', async (_n, id) => {
    const r = await responder(A, { ...id, respuestaCampana: 'no' });
    expect(r.codigo).toBe(200);
    expect(await baja(A)).toEqual({ canal: 'whatsapp', origen: 'boton_campana', campanaId: null, desde: expect.anything() });
    expect((await conversacion(A))['campanaRespuesta']).toMatchObject({ campanaId: null, respuesta: 'no' });
  });
});

describe('I2: la respuesta se normaliza (trim y minúsculas) antes de validar', () => {
  it.each(['No', ' no ', 'NO', '\tNo\n'])('«%s» vale como «no»: crea la baja', async (v) => {
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: v });
    expect(r.codigo).toBe(200);
    expect(await baja(A)).toMatchObject({ campanaId: CAMPANA, origen: 'boton_campana' });
    expect((await conversacion(A))['campanaRespuesta']).toMatchObject({ respuesta: 'no' });
  });
  it.each(['Sí', 'si', ' SI ', 'sí', 'sí'])('«%s» vale como «sí»: anota y no crea baja', async (v) => {
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: v });
    expect(await baja(A)).toBeNull();
    expect((await conversacion(A))['campanaRespuesta']).toMatchObject({ respuesta: 'si' });
  });
  it('la función pura: normaliza y rechaza lo demás', () => {
    expect(BAJAS.normalizarRespuestaDeCampana(' No ')).toBe('no');
    expect(BAJAS.normalizarRespuestaDeCampana('nop')).toBeNull();
    expect(BAJAS.normalizarRespuestaDeCampana(null)).toBeNull();
    // «sí» con la tilde DESCOMPUESTA (i + U+0301): vale como «sí» (NFC antes de comparar).
    expect(BAJAS.normalizarRespuestaDeCampana('sí')).toBe('si');
    expect(BAJAS.normalizarRespuestaDeCampana(' Sí ')).toBe('si');
    expect(BAJAS.respuestaDeCampanaValida('sí')).toBe(true);
    expect(BAJAS.respuestaDeCampanaValida('SÍ')).toBe(true);
    expect(BAJAS.respuestaDeCampanaValida('nop')).toBe(false);
  });
});

describe('I1: con el comercio NO activo, un «No» igual crea la baja (y la respuesta sigue siendo el 409)', () => {
  const mensajes = async () => (await db.collection(`tenants/${A.id}/conversaciones/wa_${TEL}/mensajes`).get()).size;
  afterEach(async () => { await db.doc(`tenants/${A.id}`).update({ estado: 'activo' }); });

  const convExiste = async () => (await db.doc(`tenants/${A.id}/conversaciones/wa_${TEL}`).get()).exists;

  it('suspendido: «no» crea SOLO bajas/wa_tel, responde 409, sin conversación, mensaje ni conteo', async () => {
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(r.codigo).toBe(409);
    expect(await baja(A)).toEqual({ canal: 'whatsapp', origen: 'boton_campana', campanaId: CAMPANA, desde: expect.anything() });
    expect(await convExiste()).toBe(false);
    expect(await mensajes()).toBe(0);
    expect((await db.collection(`tenants/${A.id}/metricas`).get()).size).toBe(0);
  });
  it('suspendido con la ficha ya existente: la baja se crea y la conversación NO se toca', async () => {
    const ref = db.doc(`tenants/${A.id}/conversaciones/wa_${TEL}`);
    await ref.set({ telefono: TEL, nombreContacto: 'Ficha previa' });
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    expect((await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' })).codigo).toBe(409);
    expect(await baja(A)).not.toBeNull();
    expect(await conversacion(A)).toEqual({ telefono: TEL, nombreContacto: 'Ficha previa' });
  });
  it.each(['baja', 'desconocido'])('NIEGA: con el comercio en estado «%s» (o sin ficha) no se escribe NADA, y responde 409', async (estado) => {
    if (estado === 'baja') await db.doc(`tenants/${A.id}`).update({ estado });
    else await db.doc(`tenants/${A.id}`).delete();
    try {
      const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
      expect(r.codigo).toBe(409);
      expect(await cuantasBajas(A)).toBe(0);
      expect(await convExiste()).toBe(false);
      expect(await mensajes()).toBe(0);
    } finally {
      await db.doc(`tenants/${A.id}`).set({ nombre: `Comercio ${A.id}`, estado: 'activo', plan: 'pro' });
    }
  });
  it('NIEGA: si la transacción de la baja falla, la respuesta sigue siendo 409 y se registra `campana_baja_fallida` sin el teléfono', async () => {
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    const espia = vi.spyOn(db, 'runTransaction').mockRejectedValue(new Error('falla simulada'));
    try {
      const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
      expect(r.codigo).toBe(409);
      expect(espia).toHaveBeenCalled();
    } finally { espia.mockRestore(); }
    expect(await cuantasBajas(A)).toBe(0);
    const fallidas = (await db.collection(`tenants/${A.id}/bitacora`).where('codigo', '==', 'campana_baja_fallida').get()).docs;
    expect(fallidas).toHaveLength(1);
    expect(JSON.stringify(fallidas[0]!.data())).not.toContain(TEL);
  });
  it('«No» en mayúscula, sin id de campaña, también; y repetido no pisa `desde`', async () => {
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    expect((await responder(A, { respuestaCampana: ' NO ' })).codigo).toBe(409);
    const primera = (await baja(A))!;
    expect(primera['campanaId']).toBeNull();
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(await baja(A)).toEqual(primera);
  });
  it('NIEGA: «sí» con el comercio suspendido no escribe nada', async () => {
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'si' });
    expect(r.codigo).toBe(409);
    expect(await cuantasBajas(A)).toBe(0);
    expect((await db.doc(`tenants/${A.id}/conversaciones/wa_${TEL}`).get()).exists).toBe(false);
    expect(await mensajes()).toBe(0);
  });
  it('NIEGA: un «no» SALIENTE o sin el evento no crea baja con el comercio suspendido', async () => {
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' }, TEL, 'saliente');
    await llamar(A, { telefono: TEL, direccion: 'entrante', tipo: 'text', texto: 'no', respuestaCampana: 'no' });
    expect(await cuantasBajas(A)).toBe(0);
  });
});

describe('NIEGA: lo mal formado que NO es un «No» no escribe ni baja ni respuesta (el mensaje se cuenta como uno cualquiera)', () => {
  it.each(IDS_MALOS)('un «sí» con %s no escribe nada', async (_n, id) => {
    const r = await responder(A, { ...id, respuestaCampana: 'si' });
    expect(r.codigo).toBe(200);
    expect(await cuantasBajas(A)).toBe(0);
    expect((await conversacion(A))['campanaRespuesta']).toBeUndefined();
  });

  it.each([
    ['respuesta fuera de la lista', { campanaEnvioId: CAMPANA, respuestaCampana: 'quizas' }],
    ['«nop» no es un «no»', { campanaEnvioId: CAMPANA, respuestaCampana: 'nop' }],
    ['«no gracias» escrito no es el botón', { campanaEnvioId: CAMPANA, respuestaCampana: 'no gracias' }],
    ['solo espacios', { campanaEnvioId: CAMPANA, respuestaCampana: '   ' }],
    ['respuesta ausente', { campanaEnvioId: CAMPANA }],
    ['respuesta no texto', { campanaEnvioId: CAMPANA, respuestaCampana: true }],
  ])('%s', async (_n, extra) => {
    const r = await responder(A, extra);
    expect(r.codigo).toBe(200);
    expect(await cuantasBajas(A)).toBe(0);
    expect((await conversacion(A))['campanaRespuesta']).toBeUndefined();
  });

  it('un `campana_respuesta` SALIENTE no crea baja (solo cuenta una respuesta del cliente)', async () => {
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' }, TEL, 'saliente');
    expect(r.codigo).toBe(200);
    expect(await cuantasBajas(A)).toBe(0);
    expect((await conversacion(A))['campanaRespuesta']).toBeUndefined();
  });

  it('los campos de campaña SIN el evento se ignoran', async () => {
    await llamar(A, { telefono: TEL, direccion: 'entrante', tipo: 'text', texto: 'hola', campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(await cuantasBajas(A)).toBe(0);
    expect((await conversacion(A))['campanaRespuesta']).toBeUndefined();
  });
});

describe('un «No» crea la baja IGUAL con la conversación bloqueada y con el servicio cortado', () => {
  it('conversación `bloqueada`: la baja se crea', async () => {
    await responder(A, { campanaEnvioId: 'otra-camp', respuestaCampana: 'si' });
    await db.doc(`tenants/${A.id}/conversaciones/wa_${TEL}`).update({ bloqueada: true, bloqueadaPor: 'u-admin', bloqueadaEn: Timestamp.now() });
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['bloqueadoPorContacto']).toBe(true);
    expect(await baja(A)).toMatchObject({ campanaId: CAMPANA, origen: 'boton_campana' });
  });

  it('servicio cortado: la baja se crea', async () => {
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set({
      modalidad: 'prepago', plan: 'crecimiento', limites: { conversaciones: 100 },
      periodoPagado: '2025-01', corteActivo: true,
    });
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'cortado' });
    expect(await baja(A)).toMatchObject({ campanaId: CAMPANA });
  });
});

describe('`aplicarRespuestaDeCampana` directo (la pieza que la ingesta llama dentro de su transacción)', () => {
  const ref = (c: Comercio) => db.doc(`tenants/${c.id}/conversaciones/wa_${TEL}`);
  const aplicar = (datos: { campanaId: unknown; respuesta: unknown }, c: Comercio = A) =>
    db.runTransaction((tx) => BAJAS.aplicarRespuestaDeCampana(tx, ref(c), datos, Timestamp.now()));

  it('devuelve baja, ya_baja, respuesta e invalida según el caso', async () => {
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'si' })).toBe('respuesta');
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'no' })).toBe('baja');
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'no' })).toBe('ya_baja');
    expect(await aplicar({ campanaId: 'MAL', respuesta: 'si' })).toBe('invalida');
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'tal vez' })).toBe('invalida');
  });
});
