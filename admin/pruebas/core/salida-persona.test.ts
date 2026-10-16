/**
 * H2-3: LA SALIDA DE UN MENSAJE DE PERSONA — timbre, `reclamarSalidaPersona` y `confirmarSalidaPersona`
 *
 * Contrato único de H2 (16/10/2026), §4 y §9. Los dos endpoints REALES (los que exporta `index.ts`)
 * contra el emulador, con la credencial de la ingesta de un número (Bearer, como la manda n8n). Lo que se
 * sostiene, negando:
 *
 *  1. Sin credencial, o con la de otro número, no hay nada (401); el comercio sale de la ruta, no del cuerpo.
 *  2. `pendiente -> enviando` es atómico: un mensaje se entrega UNA vez aunque el timbre suene dos veces.
 *  3. Un mensaje solo llega al flujo de SU número; un comercio o una ruta no activos no entregan nada.
 *  4. Un `enviando` de más de 2 minutos pasa a `incierto` y NO se reenvía.
 *  5. Las únicas transiciones del token de ingesta son las del contrato; el resto es 409.
 *  6. `mensajesPersona` cuenta aceptado e incierto una sola vez, no el rechazado; sin tocar `salientes`.
 *  7. El timbre: sin datos, con Bearer, número, marca de tiempo y firma; la ruta solo vive en el secreto.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias de esta suite: 08 y 09 (las suites corren una por una). Valores de prueba, no secretos.
const TOKEN_A = 'valor-de-prueba-salida-a';
const TOKEN_B = 'valor-de-prueba-salida-b';
process.env['INGESTA_CLIENTE08'] = TOKEN_A;
process.env['INGESTA_CLIENTE09'] = TOKEN_B;

const INDICE = await import('../../functions/src/index.ts');
const SALIDA = await import('../../functions/src/core/conversacion/salidaPersona.ts');
const CONF = await import('../../functions/src/core/conversacion/confirmarSalidaPersona.ts');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'salida-a';
const B = 'salida-b';
const NUM_A = '1000000801';
const NUM_B = '1000000802';
const NUM_A2 = '1000000803';
const CONV1 = 'wa_59100000001';
const CONV2 = 'wa_59100000002';
const MIN = 60_000;
const periodo = () => new Date().toISOString().slice(0, 7);
const CLAVE = (n: number) => `clave-de-envio-${String(n).padStart(4, '0')}`;

interface Respuesta { codigo: number; cuerpo: unknown }
async function llamar(funcion: unknown, numero: string | null, token: string | null, cuerpo: unknown, metodo = 'POST'): Promise<Respuesta> {
  const cab: Record<string, string> = { 'content-type': 'application/json' };
  if (numero) cab['x-novuchat-numero'] = numero;
  if (token) cab['authorization'] = `Bearer ${token}`;
  const leer = (n: string) => cab[n.toLowerCase()];
  const peticion = { method: metodo, body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo ?? {})), headers: cab, get: leer, header: leer };
  const r: Respuesta = { codigo: 0, cuerpo: undefined };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (funcion as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
interface Entregado { mensajeId: string; conversacionId: string; claveRele: string; to: string; texto: string; tipo: string; canal: string }
const reclamar = (numero = NUM_A, token: string | null = TOKEN_A, cuerpo: unknown = {}) =>
  llamar((INDICE as Record<string, unknown>)['reclamarSalidaPersona'], numero, token, cuerpo);
const confirmar = (cuerpo: unknown, numero = NUM_A, token: string | null = TOKEN_A) =>
  llamar((INDICE as Record<string, unknown>)['confirmarSalidaPersona'], numero, token, cuerpo);
const entregados = (r: Respuesta) => (r.cuerpo as { mensajes: Entregado[] }).mensajes;

type Datos = Record<string, unknown>;
const refMsg = (clave: string, t = A, conv = CONV1) => db.doc(`tenants/${t}/conversaciones/${conv}/mensajes/${clave}`);
const msg = async (clave: string, t = A, conv = CONV1): Promise<Datos> => (await refMsg(clave, t, conv).get()).data() ?? {};
async function sembrar(clave: string, o: Datos = {}, t = A, conv = CONV1) {
  await refMsg(clave, t, conv).set({
    direccion: 'saliente', tipo: 'text', texto: `texto ${clave}`, ts: Timestamp.fromMillis(Date.now() - 10_000), tenantId: t,
    autor: 'persona', autorUid: 'u-ana', estadoEnvio: 'pendiente', to: conv.slice(3), phoneNumberId: t === A ? NUM_A : NUM_B, huellaEnvio: 'h',
    ...o,
  });
}
const metricas = async (t = A): Promise<Datos> => (await db.doc(`tenants/${t}/metricas/${periodo()}`).get()).data() ?? {};

beforeEach(async () => {
  vi.useRealTimers();
  for (const t of [A, B]) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('rutasWhatsApp').listDocuments()) await d.delete();
  await db.doc(`tenants/${A}`).set({ nombre: 'A', estado: 'activo' });
  await db.doc(`tenants/${B}`).set({ nombre: 'B', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_A}`).set({ tenantId: A, estado: 'activo', aliasSecreto: 'cliente08', flujo: 'agendamiento' });
  await db.doc(`rutasWhatsApp/${NUM_B}`).set({ tenantId: B, estado: 'activo', aliasSecreto: 'cliente09', flujo: 'agendamiento' });
  for (const [t, conv] of [[A, CONV1], [A, CONV2], [B, CONV1]] as const) {
    await db.doc(`tenants/${t}/conversaciones/${conv}`).set({
      telefono: conv.slice(3), canal: 'whatsapp', ultimoEntranteEn: Timestamp.fromMillis(Date.now() - MIN),
    });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env['SALIDA_PERSONA_RUTAS']; });

// ===========================================================================
describe('reclamar: quién puede y de qué comercio', () => {
  it('405 con otro método; 401 sin credencial, con token equivocado, con el de otro número o con un número sin ruta', async () => {
    await sembrar(CLAVE(1));
    expect((await llamar(INDICE.reclamarSalidaPersona, NUM_A, TOKEN_A, {}, 'GET')).codigo).toBe(405);
    expect((await reclamar(NUM_A, null)).codigo).toBe(401);
    expect((await reclamar(NUM_A, 'otro-valor')).codigo).toBe(401);
    expect((await reclamar(NUM_A, TOKEN_B)).codigo).toBe(401);
    expect((await reclamar('1000000899', TOKEN_A)).codigo).toBe(401);
    expect((await msg(CLAVE(1)))['estadoEnvio']).toBe('pendiente');
  });

  it('el comercio sale de la ruta: un `tenantId` en el cuerpo no trae mensajes de otro; y B nunca recibe lo de A', async () => {
    await sembrar(CLAVE(1), {}, A);
    const r = await reclamar(NUM_B, TOKEN_B, { tenantId: A, mensajes: 'todos' });
    expect(r.codigo).toBe(200);
    expect(entregados(r)).toEqual([]);
    expect((await msg(CLAVE(1), A))['estadoEnvio']).toBe('pendiente');
  });
});

describe('reclamar: el reclamo atómico', () => {
  it('entrega el contenido y el canal, y deja el mensaje `enviando` con la hora del reclamo', async () => {
    await sembrar(CLAVE(1), { texto: 'Hola, le escribo yo' });
    const r = await reclamar();
    expect(r.codigo).toBe(200);
    expect(entregados(r)).toEqual([{
      mensajeId: CLAVE(1), conversacionId: CONV1, claveRele: SALIDA.claveReleDe(A, CONV1, CLAVE(1)),
      to: '59100000001', texto: 'Hola, le escribo yo', tipo: 'text', canal: 'graph',
    }]);
    expect(entregados(r)[0]!.claveRele).toMatch(/^[0-9a-f]{48}$/);
    const m = await msg(CLAVE(1));
    expect(m['estadoEnvio']).toBe('enviando');
    expect(m['reclamadoEn']).toBeDefined();
    expect(m['texto']).toBe('Hola, le escribo yo');
  });

  it('el canal es el de la ruta: `rele` si lo dice `canalSalida`; cualquier otro valor, `graph`', async () => {
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ canalSalida: 'rele' });
    await sembrar(CLAVE(1));
    expect(entregados(await reclamar())[0]!.canal).toBe('rele');
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ canalSalida: 'cualquier-cosa' });
    await sembrar(CLAVE(2));
    expect(entregados(await reclamar())[0]!.canal).toBe('graph');
  });

  it('NEGATIVA: un segundo timbre no encuentra nada (el mensaje se entrega una sola vez)', async () => {
    await sembrar(CLAVE(1));
    expect(entregados(await reclamar())).toHaveLength(1);
    expect(entregados(await reclamar())).toEqual([]);
  });

  it('NEGATIVA: dos reclamos a la vez se reparten los mensajes y ninguno se repite', async () => {
    for (let i = 1; i <= 6; i++) await sembrar(CLAVE(i));
    const [x, y] = await Promise.all([reclamar(), reclamar()]);
    const ids = [...entregados(x), ...entregados(y)].map((m) => m.mensajeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([1, 2, 3, 4, 5, 6].map(CLAVE));
  });

  it('entrega en orden de `ts` y hasta 10 por reclamo; el resto espera', async () => {
    const t0 = Date.now() - 60_000;
    for (let i = 1; i <= 12; i++) await sembrar(CLAVE(i), { ts: Timestamp.fromMillis(t0 + (13 - i) * 1000) }); // el 12 es el más viejo
    const ids = entregados(await reclamar()).map((m) => m.mensajeId);
    expect(ids).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map(CLAVE));
    expect(entregados(await reclamar()).map((m) => m.mensajeId)).toEqual([2, 1].map(CLAVE));
  });

  it('NEGATIVA: no entrega lo que no es un mensaje de persona pendiente de ESTE comercio y ESTE número', async () => {
    await sembrar(CLAVE(1), { phoneNumberId: NUM_A2 });            // de otra línea del mismo comercio
    await sembrar(CLAVE(2), { autor: 'asistente' });              // no es de persona
    await sembrar(CLAVE(3), { direccion: 'entrante' });           // no es saliente
    await sembrar(CLAVE(4), { estadoEnvio: 'aceptado' });         // ya terminado
    await sembrar(CLAVE(5), { tenantId: B });                     // tenantId que no es el del camino
    await sembrar(CLAVE(6), {}, B);                               // de otro comercio
    await refMsg(CLAVE(7)).set({ direccion: 'saliente', texto: 'del asistente', tenantId: A, ts: Timestamp.now() }); // sin estado
    expect(entregados(await reclamar())).toEqual([]);
    for (const [n, t] of [[1, A], [2, A], [3, A], [4, A], [5, A], [6, B]] as const) {
      expect((await msg(CLAVE(n), t))['estadoEnvio'], `${n}`).not.toBe('enviando');
    }
  });

  it('NEGATIVA: comercio suspendido, ruta suspendida o ruta que apunta a otro comercio: no entrega y el mensaje sigue pendiente', async () => {
    await sembrar(CLAVE(1));
    await db.doc(`tenants/${A}`).update({ estado: 'suspendido' });
    expect(entregados(await reclamar())).toEqual([]);
    await db.doc(`tenants/${A}`).update({ estado: 'activo' });
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ estado: 'suspendido' });
    expect(entregados(await reclamar())).toEqual([]);
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ estado: 'activo', tenantId: B });
    expect(entregados(await reclamar())).toEqual([]);
    expect((await msg(CLAVE(1)))['estadoEnvio']).toBe('pendiente');
  });

  it('un mensaje sin `phoneNumberId` (de antes de que hubiera dos líneas) lo reclama el flujo del comercio', async () => {
    await sembrar(CLAVE(1));
    await refMsg(CLAVE(1)).update({ phoneNumberId: (await import('firebase-admin/firestore')).FieldValue.delete() });
    expect(entregados(await reclamar())).toHaveLength(1);
  });
});

describe('reclamar: la caducidad del `pendiente`', () => {
  it('NEGATIVA: un pendiente de 10 min no se entrega: queda rechazado `caducado`, reintentable y SIN contar', async () => {
    await sembrar(CLAVE(1), { ts: Timestamp.fromMillis(Date.now() - 10 * MIN) });
    expect(entregados(await reclamar())).toEqual([]);
    expect(await msg(CLAVE(1))).toMatchObject({ estadoEnvio: 'rechazado', codigoEnvio: 'caducado', reintentable: true, contado: false });
    expect(await metricas()).toEqual({});
  });
  it('NEGATIVA: un pendiente reciente con la ventana de Meta ya cerrada no se entrega ni cuenta', async () => {
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: Timestamp.fromMillis(Date.now() - 25 * 3_600_000) });
    await sembrar(CLAVE(1));
    expect(entregados(await reclamar())).toEqual([]);
    expect(await msg(CLAVE(1))).toMatchObject({ estadoEnvio: 'rechazado', codigoEnvio: 'caducado', reintentable: true });
    expect(await metricas()).toEqual({});
  });
  it('NEGATIVA: sin `ultimoEntranteEn` (dato anómalo) tampoco se entrega', async () => {
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: (await import('firebase-admin/firestore')).FieldValue.delete() });
    await sembrar(CLAVE(1));
    expect(entregados(await reclamar())).toEqual([]);
    expect((await msg(CLAVE(1)))['codigoEnvio']).toBe('caducado');
  });
  it('un pendiente viejo de OTRA línea también caduca y no atasca el lote: los pendientes buenos salen', async () => {
    for (let i = 1; i <= 25; i++) await sembrar(CLAVE(i), { phoneNumberId: NUM_A2, ts: Timestamp.fromMillis(Date.now() - 20 * MIN + i) });
    await sembrar(CLAVE(90));
    for (let vuelta = 0; vuelta < 3; vuelta++) await reclamar(); // cada reclamo mira hasta 20
    const todos = (await db.collection(`tenants/${A}/conversaciones/${CONV1}/mensajes`).get()).docs;
    expect(todos.filter((d) => d.get('codigoEnvio') === 'caducado')).toHaveLength(25);
    expect((await msg(CLAVE(90)))['estadoEnvio']).toBe('enviando');
  });
  it('un pendiente de menos de 2 minutos con ventana abierta sigue entregándose', async () => {
    await sembrar(CLAVE(1), { ts: Timestamp.fromMillis(Date.now() - 100_000) });
    expect(entregados(await reclamar())).toHaveLength(1);
  });
});

describe('reclamar: el `enviando` viejo pasa a `incierto` y no se reenvía', () => {
  it('con más de 2 minutos: incierto, contado una vez en el mes, y NO se entrega', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando', reclamadoEn: Timestamp.fromMillis(Date.now() - 3 * MIN) });
    expect(entregados(await reclamar())).toEqual([]);
    const m = await msg(CLAVE(1));
    expect(m['estadoEnvio']).toBe('incierto');
    expect(m['contado']).toBe(true);
    expect((await metricas())['mensajesPersona']).toBe(1);
    expect(entregados(await reclamar())).toEqual([]);
    expect((await metricas())['mensajesPersona']).toBe(1); // no vuelve a contar
  });
  it('con menos de 2 minutos no se toca', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando', reclamadoEn: Timestamp.fromMillis(Date.now() - 30_000) });
    await reclamar();
    expect((await msg(CLAVE(1)))['estadoEnvio']).toBe('enviando');
    expect(await metricas()).toEqual({});
  });
});

// ===========================================================================
describe('confirmar: forma y credencial', () => {
  const ok = (o: Datos = {}) => ({ mensajeId: CLAVE(1), conversacionId: CONV1, resultado: 'aceptado', idMeta: 'wamid.HBgLNTkxMDAwMDAwMDEV', ...o });

  it('405, 401 y 400 (cada campo de más o de menos)', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    expect((await llamar(INDICE.confirmarSalidaPersona, NUM_A, TOKEN_A, ok(), 'GET')).codigo).toBe(405);
    expect((await confirmar(ok(), NUM_A, null)).codigo).toBe(401);
    expect((await confirmar(ok(), NUM_A, TOKEN_B)).codigo).toBe(401);
    for (const malo of [
      null, [], 'x', {}, ok({ mensajeId: 'corta' }), ok({ mensajeId: 7 }), ok({ conversacionId: 'wa_1' }), ok({ resultado: 'pendiente' }),
      ok({ resultado: 'enviando' }), ok({ resultado: 'aceptado', idMeta: undefined }), ok({ idMeta: '' }), ok({ idMeta: 'x'.repeat(121) }),
      ok({ idMeta: 'con espacios' }), ok({ resultado: 'rechazado', idMeta: undefined, codigo: undefined }),
      ok({ resultado: 'rechazado', idMeta: undefined, codigo: 'x'.repeat(41) }), ok({ resultado: 'rechazado', idMeta: undefined, codigo: '1 2' }),
      ok({ resultado: 'rechazado', idMeta: undefined, codigo: '131047', reintentable: 'si' }),
    ]) {
      expect((await confirmar(malo)).codigo, JSON.stringify(malo)).toBe(400);
    }
    expect((await msg(CLAVE(1)))['estadoEnvio']).toBe('enviando');
  });

  it('404: mensaje que no existe, de otro comercio, de otra línea, o que no es de persona', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' }, B);
    expect((await confirmar(ok())).codigo).toBe(404);
    await sembrar(CLAVE(2), { estadoEnvio: 'enviando', phoneNumberId: NUM_A2 });
    expect((await confirmar(ok({ mensajeId: CLAVE(2) }))).codigo).toBe(404);
    await sembrar(CLAVE(3), { estadoEnvio: 'enviando', autor: 'asistente' });
    expect((await confirmar(ok({ mensajeId: CLAVE(3) }))).codigo).toBe(404);
    expect((await confirmar(ok({ mensajeId: CLAVE(9) }))).codigo).toBe(404);
    expect((await msg(CLAVE(1), B))['estadoEnvio']).toBe('enviando'); // el de B no se tocó
  });

  it('NEGATIVA: con el token de ingesta solo cambia el estado y sus campos: un `texto`, `autor` o `to` en el cuerpo no tocan nada', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    const antes = await msg(CLAVE(1));
    const r = await confirmar(ok({ texto: 'otro', autor: 'asistente', autorUid: 'x', to: '59100000099', tenantId: B, phoneNumberId: '1' }));
    expect(r.codigo).toBe(200);
    const d = await msg(CLAVE(1));
    for (const k of ['texto', 'autor', 'autorUid', 'to', 'tenantId', 'phoneNumberId', 'huellaEnvio', 'direccion', 'ts']) expect(d[k], k).toEqual(antes[k]);
  });
});

describe('confirmar: las transiciones y el conteo', () => {
  const aceptado = (n = 1) => ({ mensajeId: CLAVE(n), conversacionId: CONV1, resultado: 'aceptado', idMeta: `wamid.${n}` });
  const rechazado = (n = 1, o: Datos = {}) => ({ mensajeId: CLAVE(n), conversacionId: CONV1, resultado: 'rechazado', codigo: '131047', ...o });
  const incierto = (n = 1) => ({ mensajeId: CLAVE(n), conversacionId: CONV1, resultado: 'incierto' });

  it('enviando -> aceptado: idMeta, contado y mensajesPersona +1', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    const r = await confirmar(aceptado());
    expect(r).toEqual({ codigo: 200, cuerpo: { ok: true, estado: 'aceptado' } });
    const m = await msg(CLAVE(1));
    expect(m).toMatchObject({ estadoEnvio: 'aceptado', idMeta: 'wamid.1', contado: true });
    expect(m['confirmadoEn']).toBeDefined();
    expect((await metricas())['mensajesPersona']).toBe(1);
  });

  it('enviando -> rechazado: codigoEnvio y reintentable, y NO cuenta', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    expect((await confirmar(rechazado(1, { reintentable: false }))).codigo).toBe(200);
    expect(await msg(CLAVE(1))).toMatchObject({ estadoEnvio: 'rechazado', codigoEnvio: '131047', reintentable: false });
    expect(await metricas()).toEqual({});
  });

  it('enviando -> incierto: cuenta (pudo llegar)', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    expect((await confirmar(incierto())).codigo).toBe(200);
    expect(await msg(CLAVE(1))).toMatchObject({ estadoEnvio: 'incierto', contado: true });
    expect((await metricas())['mensajesPersona']).toBe(1);
  });

  it('incierto -> aceptado: sin doble conteo', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    await confirmar(incierto());
    expect((await confirmar(aceptado())).codigo).toBe(200);
    expect(await msg(CLAVE(1))).toMatchObject({ estadoEnvio: 'aceptado', resueltoDeIncierto: true, contado: true, idMeta: 'wamid.1' });
    expect((await metricas())['mensajesPersona']).toBe(1);
  });

  it('incierto -> rechazado: se resta el que ya se había contado', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    await confirmar(incierto());
    expect((await confirmar(rechazado())).codigo).toBe(200);
    expect(await msg(CLAVE(1))).toMatchObject({ estadoEnvio: 'rechazado', resueltoDeIncierto: true, contado: false });
    expect((await metricas())['mensajesPersona']).toBe(0);
  });

  it('NEGATIVA: un incierto se resuelve UNA sola vez; un aceptado o rechazado no cambia más', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    await confirmar(incierto());
    await confirmar(aceptado());
    expect((await confirmar(rechazado())).codigo).toBe(409);
    expect((await confirmar(incierto())).codigo).toBe(409);
    expect((await confirmar(aceptado(1))).codigo).toBe(200); // el mismo resultado repetido es inofensivo
    await sembrar(CLAVE(2), { estadoEnvio: 'enviando' });
    await confirmar(rechazado(2));
    expect((await confirmar(aceptado(2))).codigo).toBe(409);
    expect((await msg(CLAVE(2)))['estadoEnvio']).toBe('rechazado');
    expect((await metricas())['mensajesPersona']).toBe(1);
  });

  it('NEGATIVA: un `pendiente` no se confirma (nadie lo reclamó); tampoco un estado inventado', async () => {
    await sembrar(CLAVE(1));
    for (const c of [aceptado(), rechazado(), incierto()]) expect((await confirmar(c)).codigo).toBe(409);
    expect((await msg(CLAVE(1)))['estadoEnvio']).toBe('pendiente');
    await sembrar(CLAVE(2), { estadoEnvio: 'raro' });
    expect((await confirmar(aceptado(2))).codigo).toBe(409);
  });

  it('el mismo resultado repetido: 200 sin doble conteo; con otro idMeta o código: 409', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    await confirmar(aceptado());
    await confirmar(aceptado());
    expect((await confirmar({ ...aceptado(), idMeta: 'wamid.otro' })).codigo).toBe(409);
    expect((await metricas())['mensajesPersona']).toBe(1);
    await sembrar(CLAVE(2), { estadoEnvio: 'enviando' });
    await confirmar(rechazado(2));
    expect((await confirmar(rechazado(2))).codigo).toBe(200);
    expect((await confirmar(rechazado(2, { codigo: '130429' }))).codigo).toBe(409);
  });

  it('dos confirmaciones a la vez del mismo mensaje cuentan una sola vez', async () => {
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    const [x, y] = await Promise.all([confirmar(aceptado()), confirmar(aceptado())]);
    expect([x.codigo, y.codigo]).toEqual([200, 200]);
    expect((await metricas())['mensajesPersona']).toBe(1);
  });

  it('NO toca `salientes`, `mensajes` ni el conteo de la conversación: solo `mensajesPersona`', async () => {
    await db.doc(`tenants/${A}/metricas/${periodo()}`).set({ salientes: 4, mensajes: 9 });
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ mensajesVentana: 3, atencionEstado: 'normal' });
    await sembrar(CLAVE(1), { estadoEnvio: 'enviando' });
    await confirmar(aceptado());
    expect(await metricas()).toEqual({ salientes: 4, mensajes: 9, mensajesPersona: 1 });
    expect(await (await db.doc(`tenants/${A}/conversaciones/${CONV1}`).get()).data()).toMatchObject({ mensajesVentana: 3, atencionEstado: 'normal' });
  });

  it('el recorrido completo: reclamar y confirmar', async () => {
    await sembrar(CLAVE(1));
    const [m] = entregados(await reclamar());
    expect(m!.mensajeId).toBe(CLAVE(1));
    expect((await confirmar({ mensajeId: m!.mensajeId, conversacionId: m!.conversacionId, resultado: 'aceptado', idMeta: 'wamid.zzz' })).codigo).toBe(200);
    expect((await msg(CLAVE(1)))['estadoEnvio']).toBe('aceptado');
    expect(entregados(await reclamar())).toEqual([]);
  });
});

// ===========================================================================
describe('el timbre', () => {
  const RUTAS = JSON.stringify({ cliente08: { ruta: 'https://n8n.ejemplo.test/webhook/capacidad-de-prueba', clave: 'clave-de-prueba-del-timbre' } });

  it('`destinoDeTimbre` solo acepta https sin credenciales, clave de 8+ y un alias propio del mapa', () => {
    const d = SALIDA.destinoDeTimbre;
    expect(d(RUTAS, 'cliente08')).toEqual({ ruta: 'https://n8n.ejemplo.test/webhook/capacidad-de-prueba', clave: 'clave-de-prueba-del-timbre' });
    expect(d(RUTAS, 'cliente09')).toBeNull();
    expect(d(RUTAS, '__proto__')).toBeNull();
    expect(d(RUTAS, 'toString')).toBeNull();
    for (const malo of ['', 'no es json', '[]', '7', 'null',
      JSON.stringify({ cliente08: { ruta: 'http://n8n.ejemplo.test/x', clave: 'clave-de-prueba' } }),
      JSON.stringify({ cliente08: { ruta: ['https://u:p', 'n8n.ejemplo.test/x'].join('@'), clave: 'clave-de-prueba' } }),
      JSON.stringify({ cliente08: { ruta: 'javascript:alert(1)', clave: 'clave-de-prueba' } }),
      JSON.stringify({ cliente08: { ruta: 'https://n8n.ejemplo.test/x', clave: 'corta' } }),
      JSON.stringify({ cliente08: { ruta: 'https://n8n.ejemplo.test/x' } }),
      JSON.stringify({ cliente08: 'https://n8n.ejemplo.test/x' })]) {
      expect(d(malo, 'cliente08'), malo).toBeNull();
    }
  });

  it('POST sin datos con Bearer, número, marca de tiempo y firma HMAC de "<marca>."; sin seguir redirecciones', async () => {
    process.env['SALIDA_PERSONA_RUTAS'] = RUTAS;
    const fetchFalso = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchFalso);
    expect(await SALIDA.tocarTimbre('cliente08', NUM_A, 1_790_000_000_000)).toBe(true);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://n8n.ejemplo.test/webhook/capacidad-de-prueba');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('error');
    const h = init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer clave-de-prueba-del-timbre');
    expect(h['X-NovuChat-Numero']).toBe(NUM_A);
    expect(h['X-NovuChat-Timestamp']).toBe('1790000000000');
    expect(h['X-NovuChat-Signature']).toBe(`sha256=${createHmac('sha256', 'clave-de-prueba-del-timbre').update('1790000000000.').digest('hex')}`);
  });

  it('falla sin lanzar: sin secreto, alias ausente, respuesta no 2xx o red caída dan `false`', async () => {
    const f = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', f);
    expect(await SALIDA.tocarTimbre('cliente08', NUM_A, 1)).toBe(false); // sin secreto
    process.env['SALIDA_PERSONA_RUTAS'] = RUTAS;
    expect(await SALIDA.tocarTimbre('cliente09', NUM_A, 1)).toBe(false); // alias que no está
    expect(f).not.toHaveBeenCalled();
    expect(await SALIDA.tocarTimbre('cliente08', NUM_A, 1)).toBe(false); // 500
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('red caída'); }));
    expect(await SALIDA.tocarTimbre('cliente08', NUM_A, 1)).toBe(false);
  });

  it('la ruta y la clave del timbre no están en el repositorio ni en ningún registro', async () => {
    process.env['SALIDA_PERSONA_RUTAS'] = RUTAS;
    const lineas: string[] = [];
    for (const n of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, n).mockImplementation((...a: unknown[]) => { lineas.push(a.join(' ')); });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('https://n8n.ejemplo.test/webhook/capacidad-de-prueba clave-de-prueba-del-timbre'); }));
    await SALIDA.tocarTimbre('cliente08', NUM_A, 1);
    expect(lineas.join('\n')).not.toMatch(/capacidad-de-prueba|clave-de-prueba/);
  });
});

describe('claves y huellas', () => {
  it('la clave del relé: 48 hex, estable, distinta entre comercios, conversaciones y claves', () => {
    const k = SALIDA.claveReleDe(A, CONV1, CLAVE(1));
    expect(k).toMatch(/^[0-9a-f]{48}$/);
    expect(SALIDA.claveReleDe(A, CONV1, CLAVE(1))).toBe(k);
    for (const otra of [SALIDA.claveReleDe(B, CONV1, CLAVE(1)), SALIDA.claveReleDe(A, CONV2, CLAVE(1)), SALIDA.claveReleDe(A, CONV1, CLAVE(2))]) expect(otra).not.toBe(k);
    expect(k).not.toContain(CLAVE(1));
  });
  it('la huella ata (conversación, persona, texto): cambiar cualquiera la cambia', () => {
    const h = SALIDA.huellaDeEnvio(CONV1, 'u-ana', 'hola');
    expect(SALIDA.huellaDeEnvio(CONV1, 'u-ana', 'hola')).toBe(h);
    for (const otra of [SALIDA.huellaDeEnvio(CONV2, 'u-ana', 'hola'), SALIDA.huellaDeEnvio(CONV1, 'u-bruno', 'hola'), SALIDA.huellaDeEnvio(CONV1, 'u-ana', 'hola!')]) expect(otra).not.toBe(h);
  });
  it('`leerConfirmacion` es pura y rechaza lo que no es exactamente del contrato', () => {
    expect(CONF.leerConfirmacion({ mensajeId: CLAVE(1), conversacionId: CONV1, resultado: 'incierto' })).toEqual({ mensajeId: CLAVE(1), conversacionId: CONV1, resultado: 'incierto' });
    expect(CONF.leerConfirmacion({ mensajeId: CLAVE(1), conversacionId: CONV1, resultado: 'aceptado' })).toBeNull();
  });
});
