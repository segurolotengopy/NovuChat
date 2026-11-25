/**
 * RÁFAGAS por HTTP: la rama `rafaga` de `configuracionFlujo` contra el emulador (negando). La lógica pura
 * está en `pruebas/core/rafaga-servidor.test.ts`; vive acá, fuera de `core/`, porque importa `ingesta.ts`.
 * Teléfonos ficticios (seis ceros seguidos).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MensajeCrudo } from '../functions/src/core/conversacion/rafaga.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN_A = 'valor-de-prueba-rafaga-a';
const TOKEN_B = 'valor-de-prueba-rafaga-b';
process.env['INGESTA_CLIENTE19'] = TOKEN_A;
process.env['INGESTA_CLIENTE20'] = TOKEN_B;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { configuracionFlujo } = await import('../functions/src/ingesta.ts');

const TA = 'rafaga-a';
const TB = 'rafaga-b';
const NUMERO_A = '1000000731';
const NUMERO_B = '1000000732';
const TEL = '59100000031';
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);
const ent = (idMeta: string, texto: string, ms: number): MensajeCrudo =>
  ({ direccion: 'entrante', tipo: 'text', texto, idMeta, ts: ms });

// ---------------------------------------------------------------- por HTTP, contra el emulador

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function pedir(cuerpo: Record<string, unknown>, numero = NUMERO_A, token: string | null = TOKEN_A): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { 'x-novuchat-numero': numero, 'content-type': 'application/json' };
  if (token) cabeceras['authorization'] = `Bearer ${token}`;
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const conv = (t: string) => db.collection(`tenants/${t}/conversaciones/wa_${TEL}/mensajes`);
async function sembrar(t: string, docs: MensajeCrudo[]) {
  for (const d of docs) await conv(t).add({ ...d, ts: Timestamp.fromMillis(d.ts as number) });
}
async function contarTodo(t: string): Promise<number> {
  return (await db.collectionGroup('mensajes').where('tenantId', '==', t).get()).size
    + (await db.collection(`tenants/${t}/conversaciones/wa_${TEL}/mensajes`).get()).size;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.doc(`rutasWhatsApp/${NUMERO_A}`).set({ tenantId: TA, flujo: 'agendamiento', aliasSecreto: 'cliente19', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUMERO_B}`).set({ tenantId: TB, flujo: 'agendamiento', aliasSecreto: 'cliente20', estado: 'activo' });
  for (const [t, nombre] of [[TA, 'Rafaga A'], [TB, 'Rafaga B']] as const) {
    await db.doc(`tenants/${t}`).set({ nombre, estado: 'activo', plan: 'crecimiento' });
    await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: nombre, numeroRecepcion: '70000001' });
  }
  await sembrar(TA, [ent('a1', 'hola', T0 - 3000), ent('a2', 'quiero cita', T0 - 2000), ent('a3', 'para mañana', T0 - 1000)]);
  await sembrar(TB, [ent('b1', 'SECRETO DE B', T0 - 500)]);
}, 120_000);

afterAll(() => { vi.useRealTimers(); });

const R = (idMeta = 'a3') => ({ v: 1, idMeta });

describe('configuracionFlujo con `rafaga`', () => {
  it('devuelve los fragmentos del tenant de la ruta, en orden', async () => {
    const r = await pedir({ telefono: TEL, rafaga: R() });
    expect(r.codigo).toBe(200);
    expect(Object.keys(r.cuerpo)).toEqual(['rafaga']);
    const f = (r.cuerpo['rafaga'] as { v: number; fragmentos: { texto: string }[] });
    expect(f.v).toBe(1);
    expect(f.fragmentos.map((x) => x.texto)).toEqual(['hola', 'quiero cita', 'para mañana']);
  });

  it('el tenant ajeno nunca se lee: ni con la firma de A, ni con `tenantId` en el cuerpo', async () => {
    const r = await pedir({ telefono: TEL, rafaga: R(), tenantId: TB });
    expect(JSON.stringify(r.cuerpo)).not.toContain('SECRETO DE B');
    const rb = await pedir({ telefono: TEL, rafaga: R('b1') }, NUMERO_B, TOKEN_B);
    expect(JSON.stringify(rb.cuerpo)).toContain('SECRETO DE B');
    expect(JSON.stringify(rb.cuerpo)).not.toContain('quiero cita');
  });

  it('con la cabecera de B y el token de A, 401', async () => {
    expect((await pedir({ telefono: TEL, rafaga: R() }, NUMERO_B, TOKEN_A)).codigo).toBe(401);
  });
  it('sin firma, 401', async () => {
    expect((await pedir({ telefono: TEL, rafaga: R() }, NUMERO_A, null)).codigo).toBe(401);
  });

  it('`rafaga` con `sesion` a la vez, 400', async () => {
    const r = await pedir({ telefono: TEL, rafaga: R(), sesion: { v: 1, espacio: 'venta', ejecucion: 'e-1', accion: 'leer' } });
    expect(r.codigo).toBe(400);
  });
  it.each([
    ['idMeta vacío', { v: 1, idMeta: '' }],
    ['idMeta largo', { v: 1, idMeta: 'a'.repeat(121) }],
    ['otra clave', { v: 1, idMeta: 'a', extra: 1 }],
    ['versión', { v: 2, idMeta: 'a' }],
  ])('pedido mal formado (%s), 400', async (_n, rafaga) => {
    expect((await pedir({ telefono: TEL, rafaga })).codigo).toBe(400);
  });
  it('sin teléfono válido, 400', async () => {
    expect((await pedir({ rafaga: R() })).codigo).toBe(400);
    expect((await pedir({ telefono: '123', rafaga: R() })).codigo).toBe(400);
  });

  it('comercio suspendido, 409 sin leer mensajes', async () => {
    await db.doc(`tenants/${TA}`).update({ estado: 'suspendido' });
    try {
      const r = await pedir({ telefono: TEL, rafaga: R() });
      expect(r.codigo).toBe(409);
      expect(r.cuerpo).toEqual({ estado: 'suspendido' });
    } finally { await db.doc(`tenants/${TA}`).update({ estado: 'activo' }); }
  });

  it('con 10 mensajes devuelve como mucho 6 entradas, las más nuevas, y no escribe nada', async () => {
    const antes = await contarTodo(TA);
    await sembrar(TA, Array.from({ length: 10 }, (_, i) => ent(`m${i}`, `m${i}`, T0 + 1000 + i * 10)));
    const despues = await contarTodo(TA);
    const r = await pedir({ telefono: TEL, rafaga: R('m9') });
    const f = (r.cuerpo['rafaga'] as { fragmentos: { idMeta: string }[] }).fragmentos;
    expect(f.map((x) => x.idMeta)).toEqual(['m4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect(await contarTodo(TA)).toBe(despues);
    expect(despues).toBeGreaterThan(antes);
  });

  it('un wamid que la conversación no tiene (teléfono ajeno) no devuelve texto', async () => {
    const r = await pedir({ telefono: TEL, rafaga: R('wamid.QUE-NO-TENGO') });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['rafaga']).toEqual({ v: 1, fragmentos: [] });
    const rb = await pedir({ telefono: '59100000099', rafaga: R('a3') });
    expect(rb.cuerpo['rafaga']).toEqual({ v: 1, fragmentos: [] });
  });

  it('descarta lo anterior a 30 s y entrega los salientes como marca', async () => {
    const T = 'rafaga-c';
    const numero = '1000000733';
    await db.doc(`rutasWhatsApp/${numero}`).set({ tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente19', estado: 'activo' });
    await db.doc(`tenants/${T}`).set({ nombre: 'Rafaga C', estado: 'activo', plan: 'crecimiento' });
    await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'C', numeroRecepcion: '70000001' });
    await sembrar(T, [
      ent('v1', 'MUY VIEJO', T0 - 31_000),
      { direccion: 'saliente', tipo: 'text', texto: 'respuesta del bot', idMeta: 'wamid.S', ts: T0 - 2000 },
      ent('n1', 'reciente', T0 - 1000),
    ]);
    const r = await pedir({ telefono: TEL, rafaga: R('n1') }, numero);
    expect(JSON.stringify(r.cuerpo)).not.toContain('MUY VIEJO');
    expect(JSON.stringify(r.cuerpo)).not.toContain('respuesta del bot');
    expect((r.cuerpo['rafaga'] as { fragmentos: unknown[] }).fragmentos).toEqual([
      { idMeta: '', tipo: 'saliente', texto: '', ms: T0 - 2000 },
      { idMeta: 'n1', tipo: 'text', texto: 'reciente', ms: T0 - 1000 },
    ]);
  });

  it('si la lectura falla: 500 rafaga_lectura y el registro no lleva teléfono ni ruta', async () => {
    const proto = Object.getPrototypeOf(db.collection('x').orderBy('ts')) as { get: (...a: unknown[]) => Promise<unknown> };
    const original = proto.get;
    // `functions/` tiene su propio node_modules: el registro se espía en la misma copia que usa `ingesta.ts`.
    const { logger } = await import('../functions/node_modules/firebase-functions/lib/v2/index.js') as unknown as
      { logger: { warn: (...a: unknown[]) => void } };
    const escrito: unknown[][] = [];
    const aviso = vi.spyOn(logger, 'warn').mockImplementation((...a: unknown[]) => { escrito.push(a); });
    proto.get = function (this: unknown) { return Promise.reject(new Error(`falla con ${TEL} en tenants/${TA}`)); };
    try {
      const r = await pedir({ telefono: TEL, rafaga: R() });
      expect(r.codigo).toBe(500);
      expect(r.cuerpo).toEqual({ error: 'rafaga_lectura' });
    } finally { proto.get = original; aviso.mockRestore(); }
    expect(escrito).toHaveLength(1);
    const lineaDeRegistro = JSON.stringify(escrito[0]);
    expect(escrito[0]![1]).toEqual({ evento: 'configuracion_flujo', tenantId: TA, accion: 'rafaga' });
    expect(lineaDeRegistro).not.toContain(TEL);
    expect(lineaDeRegistro).not.toContain('conversaciones');
  });
});

describe('`rafagaApagada` en la respuesta normal', () => {
  it('sin la bandera, o con false, la respuesta es idéntica byte a byte', async () => {
    await db.doc(`tenants/${TA}`).update({ rafagaApagada: false });
    const conFalse = await pedir({ telefono: TEL });
    await db.doc(`tenants/${TA}`).update({ rafagaApagada: (await import('firebase-admin/firestore')).FieldValue.delete() });
    const sin = await pedir({ telefono: TEL });
    expect(sin.codigo).toBe(200);
    expect('rafagaApagada' in sin.cuerpo).toBe(false);
    expect(JSON.stringify(conFalse.cuerpo)).toBe(JSON.stringify(sin.cuerpo));
  });
  it('solo con `true` exacto se agrega, y no cambia nada más', async () => {
    const sin = await pedir({ telefono: TEL });
    await db.doc(`tenants/${TA}`).update({ rafagaApagada: 'true' });
    expect('rafagaApagada' in (await pedir({ telefono: TEL })).cuerpo).toBe(false);
    await db.doc(`tenants/${TA}`).update({ rafagaApagada: true });
    try {
      const con = await pedir({ telefono: TEL });
      expect(con.cuerpo['rafagaApagada']).toBe(true);
      const { rafagaApagada: _r, ...resto } = con.cuerpo;
      expect(JSON.stringify(resto)).toBe(JSON.stringify(sin.cuerpo));
    } finally {
      await db.doc(`tenants/${TA}`).update({ rafagaApagada: (await import('firebase-admin/firestore')).FieldValue.delete() });
    }
  });
});
