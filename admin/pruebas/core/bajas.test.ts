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
const CTX = 'wamid.CAMPANA-ENVIADA-01';
// Por defecto llega «por payload» (el toque del botón `cs:no:<id>`): E3, el único «no» que da de baja sin cita.
const responder = (c: Comercio, extra: Record<string, unknown>, tel = TEL, direccion = 'entrante') =>
  llamar(c, { telefono: tel, direccion, tipo: 'text', texto: 'No, gracias', evento: 'campana_respuesta', respuestaPor: 'payload', ...extra });
/** La conversación con una campaña enviada hace `haceMs` (lo que escribe `confirmarSalida` al aceptar la plantilla). */
const sembrarEnviada = async (c: Comercio, haceMs = 3_600_000, extra: Record<string, unknown> = {}, tel = TEL) => {
  await db.doc(`tenants/${c.id}/conversaciones/wa_${tel}`).set({
    telefono: tel, campanaEnviada: { idMeta: CTX, campanaId: CAMPANA, en: Timestamp.fromMillis(Date.now() - haceMs), ...extra },
  }, { merge: true });
};
/** Un «sí» con cita: es el que responde a la campaña enviada. */
const SI = { campanaEnvioId: CAMPANA, respuestaCampana: 'si', texto: 'Sí, contáctenme', contextoId: CTX };

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
  it('NIEGA: «sí» con cita no crea baja y deja `campanaRespuesta`; responde `respuesta`', async () => {
    await sembrarEnviada(A);
    const r = await responder(A, SI);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'respuesta' });
    expect(await baja(A)).toBeNull();
    expect(await cuantasBajas(A)).toBe(0);
    expect((await conversacion(A))['campanaRespuesta']).toMatchObject({ campanaId: CAMPANA, respuesta: 'si' });
  });

  it('un «sí» no borra una baja anterior de la misma persona', async () => {
    await sembrarEnviada(A);
    await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
    await responder(A, SI);
    expect(await baja(A)).not.toBeNull();
  });
});

describe('E1/E3: lo que responde la ingesta (`campanaSaliente.resultado`) y el payload «no» que nunca se pierde', () => {
  it('«no» por payload: `baja`; repetido con OTRO id de mensaje: `ya_baja`', async () => {
    expect((await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no', idMeta: 'wamid.A1' })).cuerpo['campanaSaliente']).toEqual({ resultado: 'baja' });
    expect((await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no', idMeta: 'wamid.A2' })).cuerpo['campanaSaliente']).toEqual({ resultado: 'ya_baja' });
  });
  it('E3: el payload «no» de una campaña ANTERIOR (context.id distinto de la última) da de baja igual', async () => {
    await sembrarEnviada(A);
    const r = await responder(A, { campanaEnvioId: 'campana-vieja', respuestaCampana: 'no', contextoId: 'wamid.DE-OTRA-CAMPANA' });
    expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'baja' });
    expect(await baja(A)).toMatchObject({ campanaId: 'campana-vieja', origen: 'boton_campana' });
  });
  it('E3: el payload «no» sin conversación ni campaña enviada da de baja (nunca se pierde)', async () => {
    expect((await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' })).cuerpo['campanaSaliente']).toEqual({ resultado: 'baja' });
  });
  it('sin el evento `campana_respuesta` la respuesta NO trae `campanaSaliente` (byte a byte la de siempre)', async () => {
    const r = await llamar(A, { telefono: TEL, direccion: 'entrante', tipo: 'text', texto: 'hola' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['campanaSaliente']).toBeUndefined();
  });
  it('un `campana_respuesta` SALIENTE no trae `campanaSaliente`', async () => {
    const r = await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no' }, TEL, 'saliente');
    expect(r.cuerpo['campanaSaliente']).toBeUndefined();
  });
  it('reintento de Meta (mismo idMeta): no reescribe `campanaRespuesta.en` ni crea otra baja; responde `ya_baja`', async () => {
    const e = { campanaEnvioId: CAMPANA, respuestaCampana: 'no', idMeta: 'wamid.REINTENTO-1' };
    await responder(A, e);
    const antes = (await conversacion(A))['campanaRespuesta'] as Datos;
    expect(antes['idMetaEntrante']).toBe('wamid.REINTENTO-1');
    const r = await responder(A, e);
    expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'ya_baja' });
    expect((await conversacion(A))['campanaRespuesta']).toEqual(antes);
    expect(await cuantasBajas(A)).toBe(1);
  });
  it('reintento de un «sí»: responde `respuesta` y no reescribe', async () => {
    await sembrarEnviada(A);
    const e = { ...SI, idMeta: 'wamid.REINTENTO-2' };
    await responder(A, e);
    const antes = (await conversacion(A))['campanaRespuesta'] as Datos;
    expect((await responder(A, e)).cuerpo['campanaSaliente']).toEqual({ resultado: 'respuesta' });
    expect((await conversacion(A))['campanaRespuesta']).toEqual(antes);
  });
});

describe('E3/E8, NIEGA: sin cita, solo el payload «no» da de baja; etiqueta y texto exigen coincidencia', () => {
  const NO = { campanaEnvioId: CAMPANA, respuestaCampana: 'no' };
  it('I-B3: la etiqueta «No, gracias» de OTRA plantilla (context.id ajeno) NO da de baja, y responde `no_aplica`', async () => {
    await sembrarEnviada(A);
    const r = await responder(A, { ...NO, respuestaPor: 'etiqueta', contextoId: 'wamid.OTRA-PLANTILLA' });
    expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
    expect(await cuantasBajas(A)).toBe(0);
    expect((await conversacion(A))['campanaRespuesta']).toBeUndefined();
  });
  it('la etiqueta con cita sí da de baja (y toma el id de la campaña enviada)', async () => {
    await sembrarEnviada(A);
    const r = await responder(A, { respuestaCampana: 'no', respuestaPor: 'etiqueta', contextoId: CTX });
    expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'baja' });
    expect(await baja(A)).toMatchObject({ campanaId: CAMPANA });
  });
  it('la etiqueta sin NINGUNA campaña enviada no da de baja', async () => {
    const r = await responder(A, { ...NO, respuestaPor: 'etiqueta', contextoId: CTX });
    expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
    expect(await cuantasBajas(A)).toBe(0);
  });
  it('un «sí» por payload SIN cita (o con la cita de otra campaña) no anota nada: `no_aplica`', async () => {
    await sembrarEnviada(A);
    for (const contextoId of [undefined, 'wamid.AJENO']) {
      const r = await responder(A, { ...SI, contextoId });
      expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
    }
    expect((await conversacion(A))['campanaRespuesta']).toBeUndefined();
  });
  it('un «sí» por etiqueta con cita anota la respuesta; sin cita no', async () => {
    await sembrarEnviada(A);
    expect((await responder(A, { ...SI, respuestaPor: 'etiqueta', campanaEnvioId: undefined, contextoId: 'wamid.AJENO' })).cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
    expect((await responder(A, { ...SI, respuestaPor: 'etiqueta', campanaEnvioId: undefined })).cuerpo['campanaSaliente']).toEqual({ resultado: 'respuesta' });
    expect((await conversacion(A))['campanaRespuesta']).toMatchObject({ campanaId: CAMPANA, respuesta: 'si' });
  });
  it('un «sí» escrito nunca es una respuesta a la campaña', async () => {
    await sembrarEnviada(A);
    const r = await responder(A, { ...SI, respuestaPor: 'texto' });
    expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
    expect((await conversacion(A))['campanaRespuesta']).toBeUndefined();
  });

  describe('el «no» escrito', () => {
    const escrito = (texto: string, extra: Record<string, unknown> = {}) =>
      responder(A, { ...NO, respuestaPor: 'texto', texto, ...extra });
    it.each(['no', 'No', 'NO', 'No.', 'No!', 'no gracias', 'No, gracias', 'No gracias!', 'No, gracias.'])('«%s» con cita: da de baja', async (t) => {
      await sembrarEnviada(A);
      const r = await escrito(t, { contextoId: CTX });
      expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'baja' });
      expect(await baja(A)).toMatchObject({ campanaId: CAMPANA });
    });
    it('sin cita pero PRIMERA respuesta dentro de las 24 h del envío: da de baja', async () => {
      await sembrarEnviada(A);
      expect((await escrito('No gracias')).cuerpo['campanaSaliente']).toEqual({ resultado: 'baja' });
    });
    it('NIEGA: sin cita y con una respuesta ya registrada después del envío, el «no» escrito NO da de baja', async () => {
      await sembrarEnviada(A);
      await responder(A, { ...SI, idMeta: 'wamid.PRIMERA' }); // la primera respuesta (un «sí»)
      const r = await escrito('no');
      expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
      expect(await cuantasBajas(A)).toBe(0);
    });
    it('NIEGA: pasadas las 24 h del envío no hay campaña vigente: ni con cita ni sin ella', async () => {
      await sembrarEnviada(A, 25 * 3_600_000);
      expect((await escrito('no')).cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
      expect((await escrito('no', { contextoId: CTX })).cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
      expect(await cuantasBajas(A)).toBe(0);
    });
    it('NIEGA: sin ninguna campaña enviada, el «no» escrito no da de baja', async () => {
      expect((await escrito('no')).cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
      expect(await cuantasBajas(A)).toBe(0);
    });
    it('NIEGA: el «no» escrito que SOBRA («no me interesa») es conversación, no una baja', async () => {
      await sembrarEnviada(A);
      expect((await escrito('no me interesa', { contextoId: CTX })).cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
      expect(await cuantasBajas(A)).toBe(0);
    });
    it('NIEGA: un `campana_respuesta` sin `respuestaPor` se trata como texto (la lectura estricta): sin cita ni ventana no da de baja', async () => {
      const r = await llamar(A, { telefono: TEL, direccion: 'entrante', tipo: 'text', texto: 'No, gracias', evento: 'campana_respuesta', campanaEnvioId: CAMPANA, respuestaCampana: 'no' });
      expect(r.cuerpo['campanaSaliente']).toEqual({ resultado: 'no_aplica' });
      expect(await cuantasBajas(A)).toBe(0);
    });
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
    await sembrarEnviada(A);
    await responder(A, { ...SI, respuestaCampana: v });
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
  it('E3 con el comercio suspendido: la etiqueta o el texto SIN cita no dan de baja; con cita sí; el reintento no repite', async () => {
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    await sembrarEnviada(A);
    const antes = await conversacion(A);
    for (const [por, texto] of [['etiqueta', 'No, gracias'], ['texto', 'no me interesa']]) {
      expect((await responder(A, { campanaEnvioId: CAMPANA, respuestaCampana: 'no', respuestaPor: por, texto, contextoId: 'wamid.AJENO' })).codigo).toBe(409);
    }
    expect(await cuantasBajas(A)).toBe(0);
    expect((await responder(A, { respuestaCampana: 'no', respuestaPor: 'etiqueta', contextoId: CTX })).codigo).toBe(409);
    expect(await baja(A)).toMatchObject({ campanaId: CAMPANA });
    expect(await conversacion(A)).toEqual(antes); // la conversación no se toca con el comercio suspendido
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
    await sembrarEnviada(A);
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

  it('devuelve baja, ya_baja, respuesta, invalida y no_aplica según el caso', async () => {
    await sembrarEnviada(A);
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'si', por: 'payload', contextoId: CTX })).toBe('respuesta');
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'no', por: 'payload' })).toBe('baja');
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'no', por: 'payload' })).toBe('ya_baja');
    expect(await aplicar({ campanaId: 'MAL', respuesta: 'si', por: 'payload', contextoId: CTX })).toBe('invalida');
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'tal vez' })).toBe('invalida');
    expect(await aplicar({ campanaId: CAMPANA, respuesta: 'si', por: 'payload' })).toBe('no_aplica');
  });
});

describe('funciones puras: `esNoEscritoDeCampana`, `hechosDeCampana` y `resolverRespuestaDeCampana`', () => {
  const ahora = 1_800_000_000_000;
  const conv = (haceMs: number, extra: Record<string, unknown> = {}) => ({
    campanaEnviada: { idMeta: CTX, campanaId: CAMPANA, en: Timestamp.fromMillis(ahora - haceMs) }, ...extra,
  });
  it('la tabla compartida del «no» escrito (la misma que recorre el chat)', async () => {
    const { NO_ESCRITO_SI, NO_ESCRITO_NO } = await import('../lib/casos-campana-no-escrito.ts');
    for (const t of NO_ESCRITO_SI) expect(BAJAS.esNoEscritoDeCampana(t), JSON.stringify(t)).toBe(true);
    for (const t of NO_ESCRITO_NO) expect(BAJAS.esNoEscritoDeCampana(t), JSON.stringify(t)).toBe(false);
    expect(BAJAS.esNoEscritoDeCampana(null)).toBe(false);
  });
  it('`hechosDeCampana` nunca incluye el idMeta; la ventana es de 24 h', () => {
    const h = BAJAS.hechosDeCampana(conv(3_600_000), CTX, ahora);
    expect(h).toEqual({ citada: true, primeraEnVentana: true, campanaId: CAMPANA });
    expect(JSON.stringify(h)).not.toContain(CTX);
    expect(BAJAS.hechosDeCampana(conv(3_600_000), 'otro', ahora).citada).toBe(false);
    expect(BAJAS.hechosDeCampana(conv(BAJAS.VENTANA_CAMPANA_MS), CTX, ahora).citada).toBe(true);
    expect(BAJAS.hechosDeCampana(conv(BAJAS.VENTANA_CAMPANA_MS + 1), CTX, ahora)).toEqual({ citada: false, primeraEnVentana: false, campanaId: null });
    expect(BAJAS.hechosDeCampana(undefined, CTX, ahora)).toEqual({ citada: false, primeraEnVentana: false, campanaId: null });
  });
  it('orden: el reintento va antes que todo; el payload «no» antes que la cita', () => {
    const c = conv(1000, { campanaRespuesta: { respuesta: 'no', en: Timestamp.fromMillis(ahora - 500), idMetaEntrante: 'wamid.X' } });
    expect(BAJAS.resolverRespuestaDeCampana(c, { respuesta: 'no', por: 'payload', idMetaEntrante: 'wamid.X' }, ahora)).toEqual({ decision: 'reintento', respuesta: 'no' });
    expect(BAJAS.resolverRespuestaDeCampana(undefined, { respuesta: 'no', por: 'payload', campanaId: CAMPANA }, ahora)).toMatchObject({ decision: 'baja' });
    expect(BAJAS.resolverRespuestaDeCampana(undefined, { respuesta: 'no', por: 'texto', texto: 'no' }, ahora)).toEqual({ decision: 'no_aplica' });
  });
});
