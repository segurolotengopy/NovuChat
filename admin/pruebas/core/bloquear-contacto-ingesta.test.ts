/**
 * =============================================================================
 * BLOQUEAR CONTACTO (31/10/2026): LA COMPUERTA EN LA INGESTA Y EN configuracionFlujo
 * =============================================================================
 *
 * La `ingesta` y `configuracionFlujo` REALES contra el emulador. Con `bloqueada === true` en la
 * conversación (la escribe `bloquearContacto`, aquí sembrada con el SDK Admin):
 *
 *  1. Las DOS respuestas dicen `bloqueado`, aviso vacío y `bloqueadoPorContacto: true` (silencio total).
 *  2. El entrante NO SE CUENTA: ni conversación del mes, ni bloque, ni `entrantes`/`mensajes` de métricas,
 *     ni `mensajesVentana`, `atencionDesde`, `periodoContado`, `atencionEstado`, `mensajesTotal`. Sí se guarda
 *     el mensaje y lo mínimo para listarlo (último mensaje, no leídos). Tampoco abre una ventana vencida.
 *  3. Desbloquear restaura todo: el siguiente entrante se cuenta y el asistente responde como siempre.
 *  4. Lo ajeno no se afecta: otro teléfono del mismo comercio, el mismo teléfono en otro comercio, los
 *     salientes de la misma conversación, y las claves de la respuesta de un contacto no bloqueado.
 *  5. Cero mensajes por conversación: esta suite no envía nada, y el bloqueo solo quita.
 *
 * Puerto del emulador: 8231 por convención.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias de esta suite: 05 y 06 (la reserva llega hasta el 20; las suites corren una por una). Valores de prueba, no secretos.
const TOKENES = { a: 'valor-de-prueba-bloqueo-a', b: 'valor-de-prueba-bloqueo-b' };
process.env['INGESTA_CLIENTE05'] = TOKENES.a;
process.env['INGESTA_CLIENTE06'] = TOKENES.b;

const { ingesta, configuracionFlujo } = await import('../../functions/src/index.ts');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();

const HORA = 3_600_000;

interface Comercio { id: string; numero: string; alias: string; token: string }
const A: Comercio = { id: 'bloqueo-a', numero: '1000000931', alias: 'cliente05', token: TOKENES.a };
const B: Comercio = { id: 'bloqueo-b', numero: '1000000932', alias: 'cliente06', token: TOKENES.b };
interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function llamar(funcion: unknown, c: Comercio, cuerpo: Record<string, unknown>): Promise<Respuesta> {
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
  await (funcion as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
const entrante = (c: Comercio, tel: string) =>
  llamar(ingesta, c, { telefono: tel, direccion: 'entrante', tipo: 'text', texto: 'hola, quiero reservar' });
const saliente = (c: Comercio, tel: string) =>
  llamar(ingesta, c, { telefono: tel, direccion: 'saliente', tipo: 'text', texto: 'con gusto, le ayudo' });
const configuracion = (c: Comercio, tel: string) => llamar(configuracionFlujo, c, { telefono: tel });

type Datos = Record<string, unknown>;
const refConv = (c: Comercio, tel: string) => db.doc(`tenants/${c.id}/conversaciones/wa_${tel}`);
const conversacion = async (c: Comercio, tel: string): Promise<Datos> => (await refConv(c, tel).get()).data() ?? {};
const mensajes = async (c: Comercio, tel: string) => (await refConv(c, tel).collection('mensajes').get()).docs.length;
const metricas = async (c: Comercio): Promise<Datos> =>
  (await db.doc(`tenants/${c.id}/metricas/${new Date().toISOString().slice(0, 7)}`).get()).data() ?? {};
const atencionDe = (r: Respuesta) => r.cuerpo['atencion'] as Datos;
const bloquear = (c: Comercio, tel: string) =>
  refConv(c, tel).update({ bloqueada: true, bloqueadaPor: 'u-admin', bloqueadaEn: Timestamp.now() });

async function limpiar(c: Comercio) {
  for (const col of ['auditoria', 'bitacora', 'metricas']) {
    for (const d of (await db.collection(`tenants/${c.id}/${col}`).get()).docs) await d.ref.delete();
  }
  for (const d of (await db.collection(`tenants/${c.id}/conversaciones`).get()).docs) {
    for (const m of (await d.ref.collection('mensajes').get()).docs) await m.ref.delete();
    await d.ref.delete();
  }
}
const cuentaAlDia = (c: Comercio) => db.doc(`tenants/${c.id}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia' });

beforeAll(async () => {
  for (const c of [A, B]) {
    await limpiar(c);
    await db.doc(`rutasWhatsApp/${c.numero}`).set({ tenantId: c.id, flujo: 'agendamiento', aliasSecreto: c.alias, estado: 'activo' });
    await db.doc(`tenants/${c.id}`).set({ nombre: `Comercio ${c.id}`, estado: 'activo', plan: 'pro' });
  }
}, 120_000);
afterAll(async () => {
  vi.restoreAllMocks();
  for (const c of [A, B]) { await limpiar(c); await db.doc(`rutasWhatsApp/${c.numero}`).delete(); }
});
beforeEach(async () => { for (const c of [A, B]) { await limpiar(c); await cuentaAlDia(c); } });

const TEL = '59100000001';
const CAMPOS_DE_CONTEO = ['mensajesVentana', 'atencionDesde', 'periodoContado', 'atencionEstado', 'mensajesTotal',
  'respuestasDelPeriodo', 'periodoInteraccion', 'origen'];
const CLAVES_NORMALES = ['atencion', 'avisarRecepcion'];

describe('un contacto bloqueado: silencio total en las dos respuestas', () => {
  it('la ingesta: bloqueado, aviso vacío y la marca; nada más en el cuerpo', async () => {
    await entrante(A, TEL);
    await bloquear(A, TEL);
    const r = await entrante(A, TEL);
    expect(r.codigo).toBe(200);
    expect(atencionDe(r)['estado']).toBe('bloqueado');
    expect(r.cuerpo['avisarRecepcion']).toBe('');
    expect(r.cuerpo['bloqueadoPorContacto']).toBe(true);
    expect(r.cuerpo['pausadoPorPersona']).toBeUndefined();
    expect(Object.keys(r.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion', 'bloqueadoPorContacto']);
  });

  it('configuracionFlujo: bloqueado, aviso vacío y la marca; lectura pura', async () => {
    await entrante(A, TEL);
    await bloquear(A, TEL);
    const antes = await conversacion(A, TEL);
    const r = await configuracion(A, TEL);
    expect(r.codigo).toBe(200);
    const a = atencionDe(r);
    expect(a['estado']).toBe('bloqueado');
    expect(a['avisarRecepcion']).toBe('');
    expect(a['bloqueadoPorContacto']).toBe(true);
    expect(await conversacion(A, TEL)).toEqual(antes);
  });

  it('`bloqueada` distinto de true exacto (texto, 1, false) NO bloquea: responde el asistente', async () => {
    await entrante(A, TEL);
    for (const valor of ['true', 1, false, { a: true }]) {
      await refConv(A, TEL).update({ bloqueada: valor });
      const r = await entrante(A, TEL);
      expect(atencionDe(r)['estado'], String(valor)).toBe('normal');
      expect(r.cuerpo['bloqueadoPorContacto']).toBeUndefined();
      const c = atencionDe(await configuracion(A, TEL));
      expect(c['estado'], String(valor)).toBe('normal');
      expect(c['bloqueadoPorContacto']).toBeUndefined();
    }
  });
});

describe('un contacto bloqueado NO cuenta para el plan', () => {
  it('el entrante no mueve ningún contador ni marca de conteo; el mensaje sí se guarda y se ve como no leído', async () => {
    await entrante(A, TEL);
    const antesM = await metricas(A);
    expect(antesM['conversaciones']).toBe(1);
    await bloquear(A, TEL);
    const antesC = await conversacion(A, TEL);
    const mens = await mensajes(A, TEL);

    for (let i = 0; i < 3; i++) await entrante(A, TEL);

    expect(await metricas(A)).toEqual(antesM);
    const c = await conversacion(A, TEL);
    for (const campo of CAMPOS_DE_CONTEO) expect(c[campo], campo).toEqual(antesC[campo]);
    expect(await mensajes(A, TEL)).toBe(mens + 3);
    expect(c['noLeidos']).toBe((antesC['noLeidos'] as number) + 3);
    expect(c['sinLeer']).toBe(true);
  });

  it('NEGATIVA: con la ventana de 24 h VENCIDA, un entrante bloqueado no abre conversación (sin bloqueo sí)', async () => {
    await entrante(A, TEL);
    await refConv(A, TEL).update({ atencionDesde: Timestamp.fromMillis(Date.now() - 30 * HORA) });
    await bloquear(A, TEL);
    await entrante(A, TEL);
    expect((await metricas(A))['conversaciones']).toBe(1);

    // Control positivo: la misma situación sin bloqueo SÍ abre una conversación.
    const otro = '59100000002';
    await entrante(A, otro);
    await refConv(A, otro).update({ atencionDesde: Timestamp.fromMillis(Date.now() - 30 * HORA) });
    await entrante(A, otro);
    expect((await metricas(A))['conversaciones']).toBe(3);
  });

  it('NEGATIVA: el bloqueo no cuenta tampoco en el aviso de transición de umbral (aviso nunca)', async () => {
    await entrante(A, TEL);
    // Estado guardado «normal» y 200 respuestas en la ventana: sin bloqueo el aviso sería de bloqueo por umbral.
    await refConv(A, TEL).update({ mensajesVentana: 200, atencionEstado: 'normal', atencionDesde: Timestamp.now() });
    await bloquear(A, TEL);
    const r = await entrante(A, TEL);
    expect(r.cuerpo['avisarRecepcion']).toBe('');
    expect((await conversacion(A, TEL))['atencionEstado']).toBe('normal');
    expect((await metricas(A))['bloqueadas']).toBeUndefined();
  });
});

describe('un entrante bloqueado no evalúa el servicio', () => {
  it('NEGATIVA: no toca la marca `incoherencia` de la cuenta (ni la escribe ni la borra) y no audita', async () => {
    await entrante(A, TEL);
    await db.doc(`tenants/${A.id}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia', incoherencia: { en: Timestamp.now(), campos: ['x'] } });
    await bloquear(A, TEL);
    const antes = (await db.doc(`tenants/${A.id}/cuenta/estado`).get()).data();
    await entrante(A, TEL);
    expect((await db.doc(`tenants/${A.id}/cuenta/estado`).get()).data()).toEqual(antes);
    expect((await db.collection(`tenants/${A.id}/auditoria`).get()).size).toBe(0);
  });

  const PREPAGO = () => ({ plan: 'pro', estadoPago: 'al_dia', modalidad: 'prepago', periodoPagado: new Date().toISOString().slice(0, 7), limites: { conversaciones: 500, productos: 100, agendas: 2, cambiosIncluidos: 10 } });

  it('con modalidad de prepago, la respuesta y el registro NO traen `servicio` (no se afirma «operativo»); un contacto normal sí', async () => {
    await db.doc(`tenants/${A.id}/cuenta/estado`).set(PREPAGO());
    await entrante(A, TEL);
    await bloquear(A, TEL);
    const r = await entrante(A, TEL);
    expect(r.cuerpo['servicio']).toBeUndefined();
    expect(Object.keys(r.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion', 'bloqueadoPorContacto']);
    const normal = await entrante(A, '59100000002');
    expect((normal.cuerpo['servicio'] as Datos)['estado']).toBe('operativo');
  });

  it('la bitácora registra `codigo: bloqueado` y NO resultado ok; un entrante normal sigue ok', async () => {
    await entrante(A, TEL);
    await bloquear(A, TEL);
    for (const d of (await db.collection(`tenants/${A.id}/bitacora`).get()).docs) await d.ref.delete();
    await entrante(A, TEL);
    const filas = (await db.collection(`tenants/${A.id}/bitacora`).get()).docs.map((d) => d.data());
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ tipo: 'mensaje_entrante', resultado: 'rechazado', codigo: 'bloqueado' });
  });

  it('NEGATIVA: con un corte APLICADO por prepago, un entrante bloqueado no cuenta como pérdida ni toca el corte', async () => {
    await db.doc('plataforma/prepago').set({ corteActivo: true });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set({ ...PREPAGO(), periodoPagado: '2020-01', corteActivo: true });
    await entrante(A, TEL); // cortado: no se atiende, pero la conversación existe
    await bloquear(A, TEL);
    const antes = (await db.doc(`tenants/${A.id}/cuenta/estado`).get()).data();
    const r = await entrante(A, TEL);
    expect(r.cuerpo['servicio']).toBeUndefined();
    expect((await db.doc(`tenants/${A.id}/cuenta/estado`).get()).data()).toEqual(antes);
    await db.doc('plataforma/prepago').delete();
  });
});

describe('un turno de persona vigente + contacto bloqueado: manda el bloqueo', () => {
  const turno = () => ({ responde: 'persona', tomadoPor: 'u-ana', tomadoEn: Timestamp.fromMillis(Date.now() - 300_000), actividadPersonaEn: Timestamp.fromMillis(Date.now() - 60_000) });

  it('la ingesta y configuracionFlujo devuelven SOLO `bloqueadoPorContacto` (sin `pausadoPorPersona`)', async () => {
    await entrante(A, TEL);
    await refConv(A, TEL).update({ turno: turno() });
    await bloquear(A, TEL);
    const r = await entrante(A, TEL);
    expect(Object.keys(r.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion', 'bloqueadoPorContacto']);
    const c = atencionDe(await configuracion(A, TEL));
    expect(c['bloqueadoPorContacto']).toBe(true);
    expect(c['pausadoPorPersona']).toBeUndefined();
    expect(c['estado']).toBe('bloqueado');
  });

  it('NEGATIVA: la rama bloqueada NO persiste el vencimiento de un turno (ni escribe auditoría `conversacion_devuelta`)', async () => {
    await entrante(A, TEL);
    const vencido = { ...turno(), actividadPersonaEn: Timestamp.fromMillis(Date.now() - 40 * 60_000) };
    await refConv(A, TEL).update({ turno: vencido });
    await bloquear(A, TEL);
    await entrante(A, TEL);
    expect((await conversacion(A, TEL))['turno']).toEqual(vencido);
    expect((await db.collection(`tenants/${A.id}/auditoria`).get()).size).toBe(0);
  });
});

describe('desbloquear por la CALLABLE, de punta a punta', () => {
  it('bloquear y desbloquear con las callables reales (administrador del comercio): el asistente calla y luego responde y cuenta', async () => {
    const BL = await import('../../functions/src/core/conversacion/bloquearContacto.ts');
    type Callable = { run: (r: unknown) => Promise<unknown> };
    const admin = { uid: 'u-admin-bloqueo', token: { nc: { v: 1, t: { [A.id]: 'admin' } }, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true } };
    const llamarCallable = (c: unknown, data: unknown) => (c as Callable).run({ data, auth: admin, rawRequest: {} });
    await db.doc(`tenants/${A.id}`).set({ nombre: A.id, estado: 'activo', plan: 'pro', consolaConversaciones: 'nueva' });
    await entrante(A, TEL);
    await refConv(A, TEL).update({ atencionDesde: Timestamp.fromMillis(Date.now() - 30 * HORA) });
    const datos = { tenantId: A.id, conversacionId: `wa_${TEL}` };

    expect(await llamarCallable(BL.bloquearContacto, datos)).toEqual({ bloqueada: true });
    const r1 = await entrante(A, TEL);
    expect(atencionDe(r1)['estado']).toBe('bloqueado');
    expect((await metricas(A))['conversaciones']).toBe(1);

    expect(await llamarCallable(BL.desbloquearContacto, datos)).toEqual({ bloqueada: false });
    const r2 = await entrante(A, TEL);
    expect(Object.keys(r2.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion']);
    expect(atencionDe(r2)['estado']).toBe('normal');
    expect((await metricas(A))['conversaciones']).toBe(2);
    expect(atencionDe(await configuracion(A, TEL))['estado']).toBe('normal');
    const acciones = (await db.collection(`tenants/${A.id}/auditoria`).get()).docs.map((d) => d.data()['accion']).sort();
    expect(acciones).toEqual(['bloquear_contacto', 'desbloquear_contacto']);
    for (const d of await db.collection('topesDeTurno').listDocuments()) await d.delete();
    await db.doc(`tenants/${A.id}`).set({ nombre: `Comercio ${A.id}`, estado: 'activo', plan: 'pro' });
  });
});

describe('desbloquear restaura todo', () => {
  it('sin el campo, el siguiente entrante se cuenta y las respuestas son las de siempre', async () => {
    await entrante(A, TEL);
    await refConv(A, TEL).update({ atencionDesde: Timestamp.fromMillis(Date.now() - 30 * HORA) });
    await bloquear(A, TEL);
    await entrante(A, TEL);
    expect((await metricas(A))['conversaciones']).toBe(1);

    const { FieldValue } = await import('firebase-admin/firestore');
    await refConv(A, TEL).update({ bloqueada: FieldValue.delete(), bloqueadaPor: FieldValue.delete(), bloqueadaEn: FieldValue.delete() });
    const r = await entrante(A, TEL);
    expect(Object.keys(r.cuerpo).sort()).toEqual(CLAVES_NORMALES);
    expect(atencionDe(r)['estado']).toBe('normal');
    expect((await metricas(A))['conversaciones']).toBe(2); // se cuenta otra vez
    expect(atencionDe(await configuracion(A, TEL))['estado']).toBe('normal');
  });
});

describe('lo ajeno no se afecta', () => {
  it('otro teléfono del mismo comercio y el mismo teléfono en otro comercio responden normal y se cuentan', async () => {
    await entrante(A, TEL);
    await bloquear(A, TEL);
    const otro = await entrante(A, '59100000003');
    expect(atencionDe(otro)['estado']).toBe('normal');
    expect(Object.keys(otro.cuerpo).sort()).toEqual(CLAVES_NORMALES);
    const enB = await entrante(B, TEL);
    expect(atencionDe(enB)['estado']).toBe('normal');
    expect((await metricas(B))['conversaciones']).toBe(1);
    expect((await metricas(A))['conversaciones']).toBe(2);
  });

  it('un SALIENTE de la conversación bloqueada sigue su camino (el bloqueo es del entrante)', async () => {
    await entrante(A, TEL);
    await bloquear(A, TEL);
    const antes = (await conversacion(A, TEL))['mensajesVentana'];
    const r = await saliente(A, TEL);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['bloqueadoPorContacto']).toBeUndefined();
    expect((await conversacion(A, TEL))['mensajesVentana']).toBe((antes as number) + 1);
  });
});
