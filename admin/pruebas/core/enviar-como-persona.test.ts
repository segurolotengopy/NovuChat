/**
 * `enviarComoPersona` (H2-3): ESCRIBIR COMO PERSONA, ESCRITO NEGANDO
 *
 * Contrato único de H2 (16/10/2026), §2, §4, §7, §8 y §9. Cada guarda de `enviarComoPersona.ts` tiene
 * acá una prueba que falla si se quita. Dos comercios ficticios, personas ficticias y teléfonos con
 * seis ceros. El reloj entra por parámetro (`ahoraMs`); el timbre y la vigencia de la cuenta se inyectan.
 * Firestore: el emulador (puerto `FIRESTORE_EMULATOR_PORT`, 8231 por defecto).
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc as agregarDoc, collection as coleccion, deleteDoc as borrarDoc, doc as docCliente, getDoc as leerDoc,
  setDoc as escribirDoc, updateDoc as actualizarDoc, Timestamp as TsCliente,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const h = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase-admin/auth')>();
  return { ...original, getAuth: (...a: unknown[]) => h.getAuth(...a) };
});
// La callable REAL, tal como la cablea `index.ts` con los topes, la tarifa y la titularidad del plan.
const INDICE = await import('../../functions/src/index.ts'); // inicializa la app de Admin
const { getFirestore, Timestamp, Transaction } = await import('firebase-admin/firestore');
const db = getFirestore();

const aqui = dirname(fileURLToPath(import.meta.url));
const { default: logger } = await import('../../functions/node_modules/firebase-functions/lib/logger/index.js') as unknown as {
  default: Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...a: unknown[]) => void>;
};
const FUENTE = (archivo: string) => readFileSync(join(aqui, '..', '..', 'functions', 'src', 'core', 'conversacion', archivo), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- Actores -----------------------------------------------------------------
interface Actor { uid: string; token: Record<string, unknown> }
const actor = (uid: string, nc: Record<string, unknown>, proveedor = 'password'): Actor => ({
  uid, token: { nc: { v: 1, ...nc }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true, auth_time: 1 },
});
const oper = (t: string, uid: string) => actor(uid, { t: { [t]: 'oper' } });
const admin = (t: string, uid = `u-admin-${t}`) => actor(uid, { t: { [t]: 'admin' } });
const propietario = () => actor('u-propietario', { t: {}, p: true }, 'google.com');

const A = 'tienda-a';
const OTRO = 'tienda-b';
const TODOS = [A, OTRO, 'tienda-susp', 'tienda-clasica', 'tienda-sinbandera', 'consultorio-bellido'];
const ANA = oper(A, 'u-ana');
const BRUNO = oper(A, 'u-bruno');
const TEL1 = '59100000001';
const TEL2 = '59100000002';
const CONV1 = `wa_${TEL1}`;
const CONV2 = `wa_${TEL2}`;
const NUMERO = '1000000701';
const AHORA = Date.UTC(2026, 9, 16, 15, 0, 0);
const MIN = 60_000;
const HORA = 3_600_000;
const ts = (ms: number) => Timestamp.fromMillis(ms);
const CLAVE = 'clave-de-envio-0001';
const claveN = (n: number) => `clave-de-envio-${String(n).padStart(4, '0')}`;

const URL_TIMBRE = 'https://n8n.ejemplo.test/webhook/prueba-de-timbre';
const CLAVE_TIMBRE = 'clave-de-prueba-del-timbre';
let timbres: Array<[string, string, number]> = [];
let timbreResponde = true;
/** Lo que la cuenta de Auth dice del usuario: vigente, deshabilitada o una falla de Auth. */
const auth = { vigente: true, falla: false };
const usuarios = new Map<string, Record<string, unknown>>();
const entornoBase = (ahoraMs = AHORA, vigente = true) => ({ ahoraMs, vigente });
const CALLABLE = INDICE.enviarComoPersona as unknown as { run: (r: unknown) => Promise<unknown> };

interface ErrorLeido { code: string; message: string; details?: unknown }
async function rechazo(p: Promise<unknown>): Promise<ErrorLeido> {
  try { await p; } catch (e) { const x = e as ErrorLeido; return { code: x.code, message: x.message, details: x.details }; }
  throw new Error('la callable NO rechazó');
}
const base = (o: Record<string, unknown> = {}) => ({ tenantId: A, conversacionId: CONV1, texto: 'Hola, le atiendo yo.', claveIdempotencia: CLAVE, ...o });
const enviar = (data: unknown, a: Actor | null = ANA, entorno: ReturnType<typeof entornoBase> = entornoBase()) => {
  auth.vigente = entorno.vigente;
  if (a) usuarios.set(a.uid, a.token['nc'] as Record<string, unknown>);
  vi.setSystemTime(new Date(entorno.ahoraMs));
  return CALLABLE.run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} }) as Promise<Record<string, unknown>>;
};

// --- Semillas ------------------------------------------------------------------
async function ficha(t: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', consolaConversaciones: 'nueva', ...o });
}
async function conversacion(t: string, id: string, o: Record<string, unknown> = {}, quien = 'u-ana') {
  await db.doc(`tenants/${t}/conversaciones/${id}`).set({
    telefono: id.slice(3), canal: 'whatsapp', ultimoMensaje: 'Hola', mensajesTotal: 3, mensajesVentana: 2, atencionEstado: 'normal',
    noLeidos: 1, sinLeer: true, ultimoEntranteEn: ts(AHORA - 10 * MIN), ventanaVenceEn: ts(AHORA + 23 * HORA + 50 * MIN),
    turno: { responde: 'persona', tomadoPor: quien, tomadoEn: ts(AHORA - 5 * MIN), actividadPersonaEn: ts(AHORA - MIN) },
    ...o,
  });
}
async function ruta(o: Record<string, unknown> = {}, id = NUMERO) {
  await db.doc(`rutasWhatsApp/${id}`).set({ tenantId: A, estado: 'activo', aliasSecreto: 'cliente09', flujo: 'agendamiento', ...o });
}
const cuenta = (o: Record<string, unknown> = {}) => db.doc(`tenants/${A}/cuenta/estado`).set({ plan: 'pro', ...o });
const leerConv = async (t = A, id = CONV1) => (await db.doc(`tenants/${t}/conversaciones/${id}`).get()).data() ?? {};
const mensajes = async (t = A, id = CONV1) => (await db.collection(`tenants/${t}/conversaciones/${id}/mensajes`).get()).docs;
const auditorias = async (t = A) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());
const topes = async () => (await db.collection('topesDeEnvio').get()).docs.map((d) => [d.id, d.data()] as const);

let registros: string[] = [];
beforeAll(async () => { await db.doc('tenants/sonda-envio').get(); }, 60_000);
beforeEach(async () => {
  vi.useRealTimers();
  for (const t of TODOS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('topesDeEnvio').listDocuments()) await d.delete();
  for (const d of await db.collection('rutasWhatsApp').listDocuments()) await d.delete();
  await ficha(A); await ficha(OTRO);
  await conversacion(A, CONV1);
  await ruta();
  await cuenta();
  timbres = []; timbreResponde = true; registros = [];
  auth.vigente = true; auth.falla = false; usuarios.clear();
  process.env['SALIDA_PERSONA_RUTAS'] = JSON.stringify({ cliente09: { ruta: URL_TIMBRE, clave: CLAVE_TIMBRE } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    timbres.push([url, init.headers['X-NovuChat-Numero']!, Number(init.headers['X-NovuChat-Timestamp'])]);
    return new Response('', { status: timbreResponde ? 200 : 502 });
  }));
  h.getAuth.mockReset();
  h.getAuth.mockImplementation(() => ({
    getUser: async (uid: string) => {
      if (auth.falla) throw Object.assign(new Error('zanahoria'), { code: 'auth/internal' });
      return { disabled: !auth.vigente, customClaims: { nc: usuarios.get(uid) }, tokensValidAfterTime: undefined };
    },
  }));
  vi.useFakeTimers({ toFake: ['Date'] });
  const anotar = (...a: unknown[]) => { registros.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, nivel).mockImplementation(anotar);
    vi.spyOn(logger, nivel).mockImplementation(anotar);
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env['SALIDA_PERSONA_RUTAS']; });

// ===========================================================================
describe('el camino feliz', () => {
  it('crea el mensaje `pendiente`, toca el timbre UNA vez y devuelve el estado antes de Meta', async () => {
    const r = await enviar(base());
    expect(r).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(timbres).toEqual([[URL_TIMBRE, NUMERO, AHORA]]);
    const [m] = await mensajes();
    expect(m!.id).toBe(CLAVE);
    expect(m!.data()).toMatchObject({
      direccion: 'saliente', tipo: 'text', texto: 'Hola, le atiendo yo.', ts: ts(AHORA), autor: 'persona', autorUid: 'u-ana',
      estadoEnvio: 'pendiente', to: TEL1, phoneNumberId: NUMERO, tenantId: A,
    });
    expect(typeof m!.get('huellaEnvio')).toBe('string');
  });

  it('el destino sale de la conversación: un `to` o una ruta que mande el navegador se ignoran', async () => {
    await conversacion(OTRO, CONV1);
    await enviar(base({ to: '59100000099', telefono: '59100000099', ruta: `tenants/${OTRO}/conversaciones/${CONV1}`, autor: 'asistente', estadoEnvio: 'aceptado' }));
    const [m] = await mensajes();
    expect(m!.get('to')).toBe(TEL1);
    expect(m!.get('autor')).toBe('persona');
    expect(m!.get('estadoEnvio')).toBe('pendiente');
    expect(await mensajes(OTRO)).toHaveLength(0);
  });

  it('actualiza ultimoEn, ultimoMensaje, ultimoSalientePersonaEn y turno.actividadPersonaEn; NO toca conteo, umbrales ni ventana', async () => {
    const antes = await leerConv();
    await enviar(base());
    const d = await leerConv();
    expect(d['ultimoEn']).toEqual(ts(AHORA));
    expect(d['ultimoMensaje']).toBe('Hola, le atiendo yo.');
    expect(d['ultimoSalientePersonaEn']).toEqual(ts(AHORA));
    expect((d['turno'] as Record<string, unknown>)['actividadPersonaEn']).toEqual(ts(AHORA));
    expect(d['envioPersona']).toEqual({ desde: ts(AHORA), n: 1 });
    for (const k of ['mensajesVentana', 'mensajesTotal', 'atencionEstado', 'ultimoEntranteEn', 'ventanaVenceEn', 'noLeidos', 'sinLeer', 'telefono']) {
      expect(d[k], k).toEqual(antes[k]);
    }
    expect(d).not.toHaveProperty('necesitaHumano');
    expect((await db.collection(`tenants/${A}/metricas`).get()).size).toBe(0);
  });

  it('un administrador con el turno también envía; y el soporte no', async () => {
    await conversacion(A, CONV1, {}, `u-admin-${A}`);
    expect(await enviar(base(), admin(A))).toMatchObject({ estado: 'pendiente' });
    const e = await rechazo(enviar(base({ claveIdempotencia: claveN(2) }), propietario()));
    expect(e.code).toBe('permission-denied');
  });

  it('auditoría `mensaje_persona_creado`: sin el texto, con telefono4, sin el id de conversación', async () => {
    await enviar(base({ texto: 'secreto-confidencial-del-cliente' }));
    const [a] = await auditorias();
    expect(a).toEqual({ accion: 'mensaje_persona_creado', uid: 'u-ana', en: ts(AHORA), rol: 'oper', telefono4: '0001', resultado: 'ok', mensajeId: CLAVE, largo: 32 });
    const plano = JSON.stringify(a, (_k, v) => (v instanceof Timestamp ? 'ts' : v));
    expect(plano).not.toContain('secreto-confidencial');
    expect(plano).not.toContain(TEL1);
    expect(plano).not.toContain('wa_');
  });

  it('el timbre que falla NO falla el envío: queda pendiente', async () => {
    timbreResponde = false;
    expect(await enviar(base())).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(await mensajes()).toHaveLength(1);
  });

  it('los registros llevan solo comercio, uid, rol, telefono4 y motivo: ni teléfono, ni texto', async () => {
    await enviar(base({ texto: 'texto-privado-xyz' }));
    await rechazo(enviar(base({ texto: '' })));
    const todo = registros.join('\n');
    expect(todo).not.toContain(TEL1);
    expect(todo).not.toContain('texto-privado-xyz');
    expect(todo).not.toContain(CONV1);
    expect(todo).toContain('0001');
  });
});

// ===========================================================================
describe('idempotencia: la clave atada a (conversación, persona, texto)', () => {
  it('el reintento con la misma clave devuelve lo guardado, sin tocar el timbre, el cupo ni la auditoría', async () => {
    await enviar(base());
    const topesAntes = await topes();
    const r = await enviar(base(), ANA, entornoBase(AHORA + 5000));
    expect(r).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(timbres).toHaveLength(1);
    expect(await mensajes()).toHaveLength(1);
    expect(await auditorias()).toHaveLength(1);
    expect(await topes()).toEqual(topesAntes);
    expect((await leerConv())['envioPersona']).toEqual({ desde: ts(AHORA), n: 1 });
  });

  it('tras un rechazo del envío, el reintento devuelve el resultado guardado con su código', async () => {
    await enviar(base());
    await db.doc(`tenants/${A}/conversaciones/${CONV1}/mensajes/${CLAVE}`).update({ estadoEnvio: 'rechazado', codigoEnvio: '131047', reintentable: false });
    expect(await enviar(base())).toEqual({ estado: 'rechazado', mensajeId: CLAVE, codigoEnvio: '131047', reintentable: false });
    expect(timbres).toHaveLength(1);
  });

  it('NEGATIVA: la misma clave con OTRO texto es failed-precondition y no escribe nada', async () => {
    await enviar(base());
    const e = await rechazo(enviar(base({ texto: 'otro texto distinto' })));
    expect(e).toMatchObject({ code: 'failed-precondition', message: 'Esa clave de envío ya se usó con otro mensaje.' });
    expect(await mensajes()).toHaveLength(1);
    expect((await mensajes())[0]!.get('texto')).toBe('Hola, le atiendo yo.');
  });

  it('NEGATIVA: la clave de otra persona, de otra conversación o de un mensaje que no es de persona no se reutiliza', async () => {
    await db.doc(`tenants/${A}/conversaciones/${CONV1}/mensajes/${CLAVE}`).set({ direccion: 'saliente', autor: 'persona', autorUid: 'u-bruno', huellaEnvio: 'x', estadoEnvio: 'pendiente' });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await db.doc(`tenants/${A}/conversaciones/${CONV1}/mensajes/${claveN(7)}`).set({ direccion: 'saliente', texto: 'del asistente' });
    expect((await rechazo(enviar(base({ claveIdempotencia: claveN(7) })))).code).toBe('failed-precondition');
    await conversacion(A, CONV2);
    await enviar(base({ claveIdempotencia: claveN(8) }));
    // La clave es por conversación: en CONV2 es un envío nuevo, no una colisión.
    expect(await enviar(base({ conversacionId: CONV2, claveIdempotencia: claveN(8) }), ANA, entornoBase(AHORA + 60_000))).toMatchObject({ estado: 'pendiente' });
    expect(await mensajes(A, CONV2)).toHaveLength(1);
  });

  it('dos envíos a la vez con la misma clave: un solo mensaje, un solo cupo, ambos reciben `pendiente`', async () => {
    const [x, y] = await Promise.all([enviar(base()), enviar(base())]);
    expect(x).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(y).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(await mensajes()).toHaveLength(1);
    expect((await leerConv())['envioPersona']).toMatchObject({ n: 1 });
    expect(await auditorias()).toHaveLength(1);
  });
});

// ===========================================================================
describe('quién puede', () => {
  const sinEscrituras = async () => { expect(await mensajes()).toHaveLength(0); expect(await auditorias()).toHaveLength(0); expect(await topes()).toHaveLength(0); };

  it('sin sesión: unauthenticated', async () => {
    expect((await rechazo(enviar(base(), null))).code).toBe('unauthenticated');
    await sinEscrituras();
  });

  it('NEGATIVA: el soporte (propietario de NovuChat, aun con ventana vigente) NO envía', async () => {
    await db.doc(`tenants/${A}/accesosSoporte/u-propietario`).set({ expira: ts(AHORA + HORA) });
    expect((await rechazo(enviar(base(), propietario()))).code).toBe('permission-denied');
    await sinEscrituras();
  });

  it('NEGATIVA: un operador de OTRO comercio no envía en A', async () => {
    expect((await rechazo(enviar(base(), oper(OTRO, 'u-ana')))).code).toBe('permission-denied');
    await sinEscrituras();
  });

  it('NEGATIVA: cuenta dada de baja con el token vivo (`cuentaVigenteDe` falso) no envía', async () => {
    expect(await rechazo(enviar(base(), ANA, entornoBase(AHORA, false)))).toMatchObject({ code: 'permission-denied', message: 'No tiene permiso para atender esta conversación.' });
    await sinEscrituras();
  });

  it('una falla de Auth es `unavailable`, jamás un permiso ni un éxito', async () => {
    auth.falla = true;
    expect(await rechazo(enviar(base()))).toMatchObject({ code: 'unavailable' });
    expect(registros.join('\n')).not.toContain('zanahoria');
    await sinEscrituras();
  });

  it('NEGATIVA: bandera ausente o `clasica`, comercio suspendido y Bellido (aunque tenga la bandera)', async () => {
    const fichas: Array<[string, Record<string, unknown>]> = [
      ['tienda-sinbandera', { nombre: 'x', estado: 'activo' }],
      ['tienda-clasica', { nombre: 'x', estado: 'activo', consolaConversaciones: 'clasica' }],
      ['consultorio-bellido', { nombre: 'Bellido', estado: 'activo', consolaConversaciones: 'nueva' }],
      ['tienda-susp', { nombre: 'x', estado: 'suspendido', consolaConversaciones: 'nueva' }],
    ];
    for (const [t, f] of fichas) {
      await db.doc(`tenants/${t}`).set(f);
      await conversacion(t, CONV1);
      await db.doc(`rutasWhatsApp/${NUMERO}${t.length}`).set({ tenantId: t, estado: 'activo', aliasSecreto: 'cliente09' });
      const e = await rechazo(enviar(base({ tenantId: t }), oper(t, 'u-ana')));
      expect(e.code, t).toBe('permission-denied');
      expect(await mensajes(t), t).toHaveLength(0);
    }
    expect(timbres).toHaveLength(0);
  });
});

// ===========================================================================
describe('el turno de ESA persona, vigente', () => {
  it('NEGATIVA: sin turno', async () => {
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ turno: (await import('firebase-admin/firestore')).FieldValue.delete() });
    expect(await rechazo(enviar(base()))).toMatchObject({ code: 'failed-precondition', message: 'Para escribir, primero tome la conversación.' });
    expect(await mensajes()).toHaveLength(0);
  });

  it('NEGATIVA: turno de otra persona; turno devuelto; vencido por inactividad (30 min)', async () => {
    expect((await rechazo(enviar(base(), BRUNO))).message).toBe('Esta conversación la atiende otra persona.');
    await conversacion(A, CONV1, { turno: { responde: 'asistente', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - HORA), actividadPersonaEn: ts(AHORA - HORA), devueltoEn: ts(AHORA - 2 * MIN), motivoDevolucion: 'manual' } });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await conversacion(A, CONV1, { turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - HORA), actividadPersonaEn: ts(AHORA - 31 * MIN) } });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    expect(await mensajes()).toHaveLength(0);
  });

  it('NEGATIVA: turno ilegible no habilita el envío', async () => {
    await conversacion(A, CONV1, { turno: 'persona' });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
  });

  it('la conversación inexistente: not-found', async () => {
    expect((await rechazo(enviar(base({ conversacionId: 'wa_59100000009' })))).code).toBe('not-found');
  });

  it('enviar renueva la actividad: una persona que escribe cada 20 min no pierde el turno', async () => {
    await enviar(base(), ANA, entornoBase(AHORA));
    await enviar(base({ claveIdempotencia: claveN(2) }), ANA, entornoBase(AHORA + 20 * MIN));
    expect(await enviar(base({ claveIdempotencia: claveN(3) }), ANA, entornoBase(AHORA + 40 * MIN))).toMatchObject({ estado: 'pendiente' });
  });
});

// ===========================================================================
describe('la ventana de Meta: ultimoEntranteEn + 24 h con margen de 60 s (nunca ventanaVenceEn)', () => {
  const conEntrante = async (hace: number, o: Record<string, unknown> = {}) =>
    conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - hace), turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - MIN), actividadPersonaEn: ts(AHORA - MIN) }, ...o });

  it('a 23 h 58 min se envía; a 23 h 59 min 30 s (dentro del margen) no', async () => {
    await conEntrante(23 * HORA + 58 * MIN);
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
    await conEntrante(23 * HORA + 59 * MIN + 30_000);
    expect((await rechazo(enviar(base({ claveIdempotencia: claveN(2) })))).message).toBe('La ventana de 24 horas de esta conversación está cerrada.');
  });

  it('NEGATIVA: fuera de ventana (25 h) aunque `ventanaVenceEn` diga que sigue abierta', async () => {
    await conEntrante(25 * HORA, { ventanaVenceEn: ts(AHORA + HORA) });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    expect(await mensajes()).toHaveLength(0);
  });

  it('con `ventanaVenceEn` vencida pero un entrante reciente, SÍ envía (esa es la de facturación)', async () => {
    await conEntrante(10 * MIN, { ventanaVenceEn: ts(AHORA - HORA) });
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
  });

  it('NEGATIVA: sin `ultimoEntranteEn` (dato anómalo) rechaza y NO escribe nada, ni siquiera la devolución', async () => {
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: (await import('firebase-admin/firestore')).FieldValue.delete() });
    const antes = await leerConv();
    expect((await rechazo(enviar(base()))).message).toBe('La ventana de 24 horas de esta conversación está cerrada.');
    expect(await leerConv()).toEqual(antes);
    expect(await auditorias()).toHaveLength(0);
  });
});

// ===========================================================================
describe('el bloqueo de 45 s tras un entrante sin responder', () => {
  const conEntrante = (hace: number, o: Record<string, unknown> = {}) =>
    // Por defecto la persona tomó hace 30 s (después de que el entrante entró, o casi): hay carrera que cubrir.
    conversacion(A, CONV1, {
      ultimoEntranteEn: ts(AHORA - hace),
      turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 30_000), actividadPersonaEn: ts(AHORA - 20_000) },
      ...o,
    });

  it('NEGATIVA: a 10 s del entrante espera 35 s', async () => {
    await conEntrante(10_000);
    const e = await rechazo(enviar(base()));
    expect(e).toMatchObject({ code: 'failed-precondition', message: 'Espere unos segundos: el asistente puede estar respondiendo.' });
    expect(e.details).toEqual({ motivo: 'espera', esperaSegundos: 35 });
    expect(await mensajes()).toHaveLength(0);
    expect(timbres).toHaveLength(0);
  });

  it('a los 44 s todavía no; a los 45 s sí', async () => {
    await conEntrante(44_000);
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await conEntrante(45_000);
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
  });

  it('NO se aplica si el turno ya estaba tomado ANTES del entrante (más de 60 s): la ingesta ya calló al asistente', async () => {
    await conEntrante(10_000, { turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 10_000 - 61_000), actividadPersonaEn: ts(AHORA - 20_000) } });
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
  });

  it('el bloqueo SIGUE si tomó hace menos de 60 s antes del entrante, o después de él', async () => {
    await conEntrante(10_000, { turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 10_000 - 59_000), actividadPersonaEn: ts(AHORA - 20_000) } });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await conEntrante(10_000, { turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 3000), actividadPersonaEn: ts(AHORA - 3000) } });
    expect((await rechazo(enviar(base({ claveIdempotencia: claveN(2) })))).code).toBe('failed-precondition');
  });

  it('«el modelo respondió» (sin ultimoSalientePersonaEn) y la persona toma y envía dentro de los 45 s: sigue bloqueando', async () => {
    await conEntrante(20_000, { ultimoEn: ts(AHORA - 5000), turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 4000), actividadPersonaEn: ts(AHORA - 4000) } });
    expect((await rechazo(enviar(base()))).details).toMatchObject({ motivo: 'espera' });
  });

  it('si la persona ya respondió a ese entrante, escribe sin esperar; si su último mensaje es ANTERIOR al entrante, espera', async () => {
    await conEntrante(10_000, { ultimoSalientePersonaEn: ts(AHORA - 5000) });
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
    await conEntrante(10_000, { ultimoSalientePersonaEn: ts(AHORA - 60_000) });
    expect((await rechazo(enviar(base({ claveIdempotencia: claveN(2) })))).code).toBe('failed-precondition');
  });
});

// ===========================================================================
describe('la forma de lo que manda el navegador', () => {
  const invalida = async (data: unknown) => {
    expect(await rechazo(enviar(data))).toMatchObject({ code: 'invalid-argument', message: 'Solicitud inválida.' });
    expect(await mensajes()).toHaveLength(0);
    expect(await auditorias()).toHaveLength(0);
    expect(await topes()).toHaveLength(0);
  };
  it('NEGATIVA: texto vacío, en blanco, de 1.001 caracteres, no-texto o con controles', async () => {
    for (const texto of ['', '   \n ', 'a'.repeat(1001), 42, null, ['x'], 'hola\u0000mundo']) await invalida(base({ texto }));
  });
  it('1.000 caracteres sí; el texto no se recorta', async () => {
    const t = ` ${'a'.repeat(998)} `;
    await enviar(base({ texto: t }));
    expect((await mensajes())[0]!.get('texto')).toBe(t);
  });
  it('NEGATIVA: clave de 15, de 129, con caracteres no permitidos, reservada de Firestore o que no es texto', async () => {
    for (const c of ['a'.repeat(15), 'a'.repeat(129), 'clave con espacios 01', 'clave/con/barras-01', '__reservada-0001__', 7, null]) await invalida(base({ claveIdempotencia: c }));
    expect(await enviar(base({ claveIdempotencia: 'a'.repeat(128) }))).toMatchObject({ estado: 'pendiente' });
  });
  it('NEGATIVA: conversación mal formada y cuerpo que no es un objeto', async () => {
    for (const c of ['wa_123', '59100000001', `wa_${TEL1}/x`, 'wa_5910000000000000', 7]) await invalida(base({ conversacionId: c }));
    for (const d of [null, [], 'texto', 7]) {
      expect((await rechazo(enviar(d))).code).toBe('permission-denied');
    }
  });
  it('NEGATIVA: tenantId mal escrito recibe el mismo «sin permiso» y no llega a los registros', async () => {
    for (const t of ['../etc/passwd', 'TIENDA-A', '__proto__', 7]) expect((await rechazo(enviar(base({ tenantId: t })))).code).toBe('permission-denied');
    expect(registros.join('\n')).not.toContain('passwd');
  });
});

// ===========================================================================
describe('el canal: exactamente una ruta activa con alias', () => {
  const fijo = 'El canal de envío de este comercio no está disponible.';
  it('NEGATIVA: ninguna ruta, dos activas, una sin alias, o de otro comercio', async () => {
    await db.doc(`rutasWhatsApp/${NUMERO}`).delete();
    expect(await rechazo(enviar(base()))).toMatchObject({ code: 'failed-precondition', message: fijo });
    await ruta({ tenantId: OTRO });
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    await ruta({ aliasSecreto: '' });
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    await ruta(); await ruta({}, '1000000702');
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    expect(await mensajes()).toHaveLength(0);
    expect(timbres).toHaveLength(0);
  });
  it('una ruta suspendida al lado de la activa no estorba', async () => {
    await ruta({ estado: 'suspendido' }, '1000000702');
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
    expect(timbres[0]![1]).toBe(NUMERO);
  });
});

// ===========================================================================
describe('H2-3b: con dos líneas sale por la de la conversación (`phoneNumberId`)', () => {
  const fijo = 'El canal de envío de este comercio no está disponible.';
  const NUMERO_B = '1000000702';
  const dosLineas = async () => { await ruta({ aliasSecreto: 'cliente09' }); await ruta({ aliasSecreto: 'cliente10' }, NUMERO_B); };
  it('la conversación de la línea B envía por B y no por A (y el mensaje queda atado a B)', async () => {
    await dosLineas();
    process.env['SALIDA_PERSONA_RUTAS'] = JSON.stringify({
      cliente09: { ruta: URL_TIMBRE, clave: CLAVE_TIMBRE }, cliente10: { ruta: `${URL_TIMBRE}-b`, clave: CLAVE_TIMBRE } });
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: NUMERO_B });
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
    expect(timbres).toHaveLength(1);
    expect(timbres[0]![0]).toBe(`${URL_TIMBRE}-b`);
    expect(timbres[0]![1]).toBe(NUMERO_B);
    expect((await mensajes())[0]!.get('phoneNumberId')).toBe(NUMERO_B);
  });
  it('la conversación de la línea A envía por A', async () => {
    await dosLineas();
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: NUMERO });
    await enviar(base());
    expect(timbres[0]![1]).toBe(NUMERO);
  });
  it('NEGATIVA: un `phoneNumberId` de OTRO comercio rechaza con el mensaje fijo, sin enviar ni escribir', async () => {
    await ruta({ tenantId: OTRO }, NUMERO_B);
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: NUMERO_B });
    expect(await rechazo(enviar(base()))).toMatchObject({ code: 'failed-precondition', message: fijo });
    expect(await mensajes()).toHaveLength(0);
    expect(timbres).toHaveLength(0);
  });
  it('NEGATIVA: la ruta de la conversación inactiva (o sin alias) rechaza aunque la otra línea esté activa; nunca cae a la otra', async () => {
    await ruta({ estado: 'suspendido' }, NUMERO_B);
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: NUMERO_B });
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    await ruta({ aliasSecreto: '' }, NUMERO_B);
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    expect(await mensajes()).toHaveLength(0);
    expect(timbres).toHaveLength(0);
  });
  it('NEGATIVA: un `phoneNumberId` que no corresponde a ninguna ruta rechaza; uno malformado también (no se ignora)', async () => {
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: '1000000799' });
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    for (const malo of ['no-es-numero', '12345', '', 1000000701]) {
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: malo });
      expect((await rechazo(enviar(base()))).message).toBe(fijo);
    }
    expect(await mensajes()).toHaveLength(0);
    expect(timbres).toHaveLength(0);
  });
  it('NEGATIVA: si la línea de la conversación cambia entre elegir el canal y la transacción, no se envía', async () => {
    await dosLineas();
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: NUMERO });
    const original = db.runTransaction.bind(db) as (f: (tx: unknown) => Promise<unknown>, o?: unknown) => Promise<unknown>;
    vi.spyOn(db, 'runTransaction').mockImplementation((async (f: (tx: unknown) => Promise<unknown>, o?: unknown) => {
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ phoneNumberId: NUMERO_B });
      return original(f, o);
    }) as unknown as typeof db.runTransaction);
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    expect(await mensajes()).toHaveLength(0);
    expect(timbres).toHaveLength(0);
  });
  it('sin `phoneNumberId` (conversación anterior): con dos líneas activas rechaza; con una sola, envía', async () => {
    await dosLineas();
    expect((await rechazo(enviar(base()))).message).toBe(fijo);
    await db.doc(`rutasWhatsApp/${NUMERO_B}`).delete();
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
  });
});

// ===========================================================================
describe('los topes: las cifras salen del plan y se cuentan en la transacción', () => {
  const ritmo = (n: number) => entornoBase(AHORA + n * 7000); // 7 s entre envíos: nunca 10 en un minuto
  const mandar = (n: number, a: Actor = ANA, conv = CONV1) => enviar(base({ claveIdempotencia: claveN(n), conversacionId: conv }), a, ritmo(n));

  it('NEGATIVA: el envío 11 con titularidad `novuchat` falla con tope `conversacion`, sin esperaSegundos, sin escribir ni gastar cupo', async () => {
    for (let i = 1; i <= 10; i++) await mandar(i);
    const antes = { m: (await mensajes()).length, t: await topes(), a: (await auditorias()).length, c: await leerConv() };
    const e = await rechazo(mandar(11));
    expect(e).toMatchObject({ code: 'resource-exhausted', message: 'Llegó al tope de mensajes de persona para esta conversación.', details: { tope: 'conversacion' } });
    expect(e.details).not.toHaveProperty('esperaSegundos');
    expect({ m: (await mensajes()).length, t: await topes(), a: (await auditorias()).length, c: await leerConv() }).toEqual(antes);
    expect(timbres).toHaveLength(10);
  });

  it('el tope por defecto (cuenta sin tarifa, ruta sin titularidad) es el menor: 10', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).delete();
    for (let i = 1; i <= 10; i++) await mandar(i);
    expect((await rechazo(mandar(11))).details).toEqual({ tope: 'conversacion' });
  });

  it('NEGATIVA: BYOC (tarifa estandar Y titularidad comercio): 25 pasan y el 26 falla', async () => {
    await cuenta({ tarifa: 'estandar' }); await ruta({ titularidad: 'comercio' });
    for (let i = 1; i <= 25; i++) await mandar(i);
    expect(await mensajes()).toHaveLength(25);
    expect((await rechazo(mandar(26))).details).toEqual({ tope: 'conversacion' });
    expect(await mensajes()).toHaveLength(25);
  });

  it('NEGATIVA: una sola de las dos condiciones no da 25 (estandar+novuchat, meta_incluido+comercio)', async () => {
    for (const [tarifa, titularidad] of [['estandar', 'novuchat'], ['meta_incluido', 'comercio']] as const) {
      await cuenta({ tarifa }); await ruta({ titularidad });
      await conversacion(A, CONV1);
      await db.collection('topesDeEnvio').listDocuments().then((l) => Promise.all(l.map((d) => d.delete())));
      for (let i = 1; i <= 10; i++) await mandar(i);
      expect((await rechazo(mandar(11))).details, `${tarifa}+${titularidad}`).toEqual({ tope: 'conversacion' });
      for (const d of await db.collection(`tenants/${A}/conversaciones/${CONV1}/mensajes`).listDocuments()) await d.delete();
    }
  });

  it('el contador por conversación se reinicia pasadas 24 h desde el primer envío', async () => {
    await conversacion(A, CONV1, { envioPersona: { desde: ts(AHORA - 24 * HORA - 1000), n: 10 } });
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
    expect((await leerConv())['envioPersona']).toEqual({ desde: ts(AHORA), n: 1 });
    await conversacion(A, CONV1, { envioPersona: { desde: ts(AHORA - 23 * HORA), n: 10 } });
    expect((await rechazo(enviar(base({ claveIdempotencia: claveN(2) })))).details).toEqual({ tope: 'conversacion' });
  });

  it('NEGATIVA: el envío 11 en el MISMO minuto falla con tope `minuto` y esperaSegundos (solo en ese tope)', async () => {
    await cuenta({ tarifa: 'estandar' }); await ruta({ titularidad: 'comercio' });
    for (let i = 1; i <= 10; i++) await enviar(base({ claveIdempotencia: claveN(i) }), ANA, entornoBase(AHORA + i * 1000));
    const e = await rechazo(enviar(base({ claveIdempotencia: claveN(11) }), ANA, entornoBase(AHORA + 11_000)));
    expect(e).toMatchObject({ code: 'resource-exhausted', details: { tope: 'minuto', esperaSegundos: 49 } });
    expect(await mensajes()).toHaveLength(10);
    // Pasado el minuto, vuelve a poder.
    expect(await enviar(base({ claveIdempotencia: claveN(12) }), ANA, entornoBase(AHORA + 61_000))).toMatchObject({ estado: 'pendiente' });
  });

  it('NEGATIVA: el tope por minuto también es del COMERCIO (dos personas suman)', async () => {
    await cuenta({ tarifa: 'estandar' }); await ruta({ titularidad: 'comercio' });
    await conversacion(A, CONV2, {}, 'u-bruno');
    for (let i = 1; i <= 5; i++) {
      await enviar(base({ claveIdempotencia: claveN(i) }), ANA, entornoBase(AHORA + i * 1000));
      await enviar(base({ conversacionId: CONV2, claveIdempotencia: claveN(100 + i) }), BRUNO, entornoBase(AHORA + i * 1000 + 500));
    }
    const e = await rechazo(enviar(base({ claveIdempotencia: claveN(6) }), ANA, entornoBase(AHORA + 7000)));
    expect(e.details).toMatchObject({ tope: 'minuto' });
  });

  it('NEGATIVA: el envío 301 del día falla con tope `dia` (sin esperaSegundos); el 300 pasa; al día siguiente se reinicia', async () => {
    const dia = new Date(AHORA - 4 * HORA).toISOString().slice(0, 10);
    await db.doc(`topesDeEnvio/t_${A}`).set({ min: 'x', nMin: 0, dia, nDia: 299 });
    expect(await enviar(base())).toMatchObject({ estado: 'pendiente' });
    const e = await rechazo(enviar(base({ claveIdempotencia: claveN(2) }), ANA, entornoBase(AHORA + 7000)));
    expect(e).toMatchObject({ code: 'resource-exhausted', message: 'El comercio llegó al tope diario de mensajes de persona.', details: { tope: 'dia' } });
    expect(e.details).not.toHaveProperty('esperaSegundos');
    const manana = AHORA + 24 * HORA;
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(manana - 10 * MIN), turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(manana - MIN), actividadPersonaEn: ts(manana - MIN) } });
    expect(await enviar(base({ claveIdempotencia: claveN(3) }), ANA, entornoBase(manana))).toMatchObject({ estado: 'pendiente' });
  });

  it('un contador ilegible falla CERRADO (unavailable), no abre el tope', async () => {
    await db.doc(`topesDeEnvio/u_u-ana`).set({ min: new Date(AHORA).toISOString().slice(0, 16), n: 'muchos' });
    expect((await rechazo(enviar(base()))).code).toBe('unavailable');
    await db.doc(`topesDeEnvio/u_u-ana`).delete();
    await conversacion(A, CONV1, { envioPersona: { desde: 'ayer', n: 1 } });
    expect((await rechazo(enviar(base()))).code).toBe('unavailable');
    expect(await mensajes()).toHaveLength(0);
  });

  it('las cifras no están escritas en el código del envío (viven en planes.ts)', () => {
    const c = FUENTE('enviarComoPersona.ts');
    expect(c).not.toMatch(/porConversacion\s*[:=]\s*\d|porDia\s*[:=]\s*\d|porMinuto\s*[:=]\s*\d|>=\s*(10|25|300)\b/);
    expect(FUENTE('enviarComoPersona.ts')).not.toMatch(/central\//); // Core no importa Central
  });
});

// ===========================================================================
describe('la auditoría es falla-cerrada y atómica con el mensaje', () => {
  it('si no se puede escribir el documento de auditoría, no queda mensaje, ni cupo, ni actividad, ni timbre', async () => {
    const real = Transaction.prototype.create;
    vi.spyOn(Transaction.prototype, 'create').mockImplementation(function (this: unknown, ref: { path: string }, ...r: unknown[]) {
      if (ref.path.includes('/auditoria/')) throw Object.assign(new Error('zanahoria'), { code: 9 });
      return (real as (...a: unknown[]) => unknown).call(this, ref, ...r) as never;
    } as never);
    const antes = await leerConv();
    expect((await rechazo(enviar(base()))).code).toBe('unavailable');
    expect(await mensajes()).toHaveLength(0);
    expect(await topes()).toHaveLength(0);
    expect(await leerConv()).toEqual(antes);
    expect(timbres).toHaveLength(0);
    expect(registros.join('\n')).not.toContain('zanahoria');
  });
});

// ===========================================================================
describe('el cableado: index.ts exporta la callable real, en us-east1, con App Check solo en producción', () => {
  it('`enviarComoPersona`, `reclamarSalidaPersona` y `confirmarSalidaPersona` están en el índice', () => {
    const e = (INDICE as unknown as Record<string, { __endpoint: Record<string, unknown> }>);
    for (const n of ['enviarComoPersona', 'reclamarSalidaPersona', 'confirmarSalidaPersona']) {
      expect(e[n]?.__endpoint, n).toBeDefined();
      expect(e[n]!.__endpoint['region']).toEqual(['us-east1']);
    }
    expect(e['enviarComoPersona']!.__endpoint['callableTrigger']).toEqual({});
    expect(e['enviarComoPersona']!.__endpoint['secretEnvironmentVariables']).toEqual([{ key: 'SALIDA_PERSONA_RUTAS' }]);
  });
  it('opciones de la callable: App Check exigido en producción y no en staging', () => {
    expect(FUENTE('turnoServidor.ts')).toMatch(/enforceAppCheck: emulador \? false : staging \? APP_CHECK_DE_TURNO\.staging : APP_CHECK_DE_TURNO\.produccion/);
    expect(FUENTE('enviarComoPersona.ts')).toMatch(/opcionesDeTurno\(process\.env\)/);
  });
  it('el código del envío no menciona el token de Meta, el relé ni Graph: solo crea y toca el timbre', () => {
    expect(FUENTE('enviarComoPersona.ts')).not.toMatch(/graph\.facebook|WHATSAPP_TOKEN|Idempotency-Key|mensajesVentana|atencionEstado|ventanaVenceEn|respuestasDelPeriodo/);
  });
});

// ===========================================================================
describe('las reglas de Firestore cierran lo que escribe el servidor', () => {
  let entorno: RulesTestEnvironment;
  beforeAll(async () => {
    entorno = await initializeTestEnvironment({
      projectId: PROYECTO,
      firestore: { rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231) },
    });
  }, 60_000);
  beforeEach(async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await escribirDoc(docCliente(ctx.firestore(), 'tenants/tienda-a'), { nombre: 'A', estado: 'activo', consolaConversaciones: 'nueva' });
      await escribirDoc(docCliente(ctx.firestore(), 'topesDeEnvio/u_u-ana'), { min: 'x', n: 1 });
      await escribirDoc(docCliente(ctx.firestore(), `tenants/tienda-a/conversaciones/${CONV1}`), {
        telefono: TEL1, canal: 'whatsapp', turno: { responde: 'persona', tomadoPor: 'u-ana' },
        notaInterna: '', ultimoMensaje: 'hola',
        envioPersona: { desde: TsCliente.now(), n: 2 }, ultimoSalientePersonaEn: TsCliente.now(),
      });
    });
  });
  afterAll(async () => { await entorno?.cleanup(); });
  const claims = (nc: Record<string, unknown>, proveedor = 'password') => ({ nc: { v: 1, ...nc }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true });
  const ctx = {
    admin: () => entorno.authenticatedContext('u-admin', claims({ t: { 'tienda-a': 'admin' } })).firestore(),
    oper: () => entorno.authenticatedContext('u-ana', claims({ t: { 'tienda-a': 'oper' } })).firestore(),
    ingesta: () => entorno.authenticatedContext('svc-a', claims({ t: { 'tienda-a': 'ingesta' } }, 'custom')).firestore(),
    propietario: () => entorno.authenticatedContext('u-p', claims({ t: {}, p: true }, 'google.com')).firestore(),
    anonimo: () => entorno.unauthenticatedContext().firestore(),
  };
  const mensajeBase = () => ({ direccion: 'saliente', tipo: 'text', texto: 'hola', ts: TsCliente.now(), tenantId: 'tienda-a' });

  it('NEGATIVA: nadie lee ni escribe `topesDeEnvio` desde el cliente', async () => {
    for (const [q, f] of Object.entries(ctx)) {
      const fs = f();
      for (const p of [() => leerDoc(docCliente(fs, 'topesDeEnvio/u_u-ana')), () => escribirDoc(docCliente(fs, 'topesDeEnvio/t_tienda-a'), { nDia: 0 }),
        () => actualizarDoc(docCliente(fs, 'topesDeEnvio/u_u-ana'), { n: 0 }), () => borrarDoc(docCliente(fs, 'topesDeEnvio/u_u-ana'))]) {
        try { await assertFails(p()); } catch (e) { throw new Error(`${q} pudo tocar topesDeEnvio (${String(e)})`); }
      }
    }
  });

  it('NEGATIVA: el token de ingesta no escribe turno, autor, autorUid, estadoEnvio, codigoEnvio, reintentable ni los campos del envío', async () => {
    const fs = ctx.ingesta();
    for (const extra of [{ autor: 'persona' }, { autorUid: 'u-ana' }, { estadoEnvio: 'aceptado' }, { codigoEnvio: '131047' }, { reintentable: true },
      { to: '59100000099' }, { huellaEnvio: 'x' }, { phoneNumberId: '1' }, { contado: true }]) {
      await assertFails(escribirDoc(docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}/mensajes/m-${Object.keys(extra)[0]}`), { ...mensajeBase(), ...extra }));
    }
    const conv = docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}`);
    await assertFails(actualizarDoc(conv, { turno: { responde: 'asistente', tomadoPor: 'u-ana' } }));
    await assertFails(actualizarDoc(conv, { 'turno.actividadPersonaEn': TsCliente.now() }));
    // Cada campo del envío, UNO por vez, con la conversación ya válida: lo que falla es el campo, no «todo».
    await assertFails(actualizarDoc(conv, { envioPersona: { desde: TsCliente.now(), n: 0 } }));
    await assertFails(actualizarDoc(conv, { 'envioPersona.n': 0 }));
    await assertFails(actualizarDoc(conv, { ultimoSalientePersonaEn: TsCliente.fromMillis(5000) }));
    await assertFails(escribirDoc(docCliente(fs, `tenants/tienda-a/conversaciones/${CONV2}`), {
      telefono: TEL2, canal: 'whatsapp', envioPersona: { desde: TsCliente.now(), n: 0 } }));
    await assertFails(escribirDoc(docCliente(fs, `tenants/tienda-a/conversaciones/${CONV2}`), {
      telefono: TEL2, canal: 'whatsapp', ultimoSalientePersonaEn: TsCliente.now() }));
  });

  it('control positivo: una conversación que YA tiene esos campos sigue siendo actualizable por lo permitido (ingesta y persona)', async () => {
    const conv = (f: () => ReturnType<typeof ctx.oper>) => docCliente(f(), `tenants/tienda-a/conversaciones/${CONV1}`);
    await assertSucceeds(actualizarDoc(conv(ctx.ingesta), { ultimoMensaje: 'nuevo resumen' }));
    await assertSucceeds(actualizarDoc(conv(ctx.oper), { notaInterna: 'cliente frecuente' }));
    await assertSucceeds(actualizarDoc(conv(ctx.admin), { etiquetas: ['vip'] }));
    // La ingesta puede crear una conversación NUEVA sin esos campos.
    await assertSucceeds(escribirDoc(docCliente(ctx.ingesta(), `tenants/tienda-a/conversaciones/${CONV2}`), { telefono: TEL2, canal: 'whatsapp' }));
  });

  it('H2-3b NEGATIVA: `phoneNumberId` en la conversación NO lo escribe nadie por SDK cliente (ni la ingesta); la ingesta sí actualiza otros campos si ya lo tiene', async () => {
    const conv = (f: () => ReturnType<typeof ctx.oper>) => docCliente(f(), `tenants/tienda-a/conversaciones/${CONV1}`);
    for (const valor of ['1000000701', '123456', '1'.repeat(25), '12345', '1'.repeat(26), '10000007a1', '', 1000000701, null, ['1000000701']]) {
      await assertFails(actualizarDoc(conv(ctx.ingesta), { phoneNumberId: valor }));
    }
    for (const f of [ctx.admin, ctx.oper, ctx.propietario, ctx.anonimo]) {
      await assertFails(actualizarDoc(conv(f), { phoneNumberId: '1000000701' }));
    }
    const otro = entorno.authenticatedContext('svc-b', claims({ t: { 'tienda-b': 'ingesta' } }, 'custom')).firestore();
    await assertFails(actualizarDoc(docCliente(otro, `tenants/tienda-a/conversaciones/${CONV1}`), { phoneNumberId: '1000000701' }));
    await assertFails(escribirDoc(docCliente(otro, `tenants/tienda-a/conversaciones/${CONV2}`), { telefono: TEL2, canal: 'whatsapp', phoneNumberId: '1000000701' }));
    await assertFails(escribirDoc(docCliente(ctx.ingesta(), `tenants/tienda-a/conversaciones/${CONV2}`), { telefono: TEL2, canal: 'whatsapp', phoneNumberId: '1000000701' }));
    // Control positivo: una conversación que YA lo tiene sigue siendo actualizable por la ingesta (otros campos).
    await entorno.withSecurityRulesDisabled(async (c) => {
      await actualizarDoc(docCliente(c.firestore(), `tenants/tienda-a/conversaciones/${CONV1}`), { phoneNumberId: '1000000701' });
    });
    await assertSucceeds(actualizarDoc(conv(ctx.ingesta), { ultimoMensaje: 'nuevo resumen' }));
  });

  it('NEGATIVA: la persona (admin u operador) tampoco crea mensajes ni toca el turno; y el soporte menos', async () => {
    for (const f of [ctx.admin, ctx.oper, ctx.propietario, ctx.anonimo]) {
      const fs = f();
      await assertFails(escribirDoc(docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}/mensajes/${CLAVE}`), { ...mensajeBase(), autor: 'persona', autorUid: 'u-ana', estadoEnvio: 'pendiente' }));
      await assertFails(agregarDoc(coleccion(fs, `tenants/tienda-a/conversaciones/${CONV1}/mensajes`), mensajeBase()));
      await assertFails(actualizarDoc(docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}`), { turno: { responde: 'persona', tomadoPor: 'u-x' } }));
    }
  });
});
