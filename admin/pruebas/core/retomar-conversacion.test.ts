/**
 * `retomarConversacion` (plan «Retomar», 23/11/2026, R1): RETOMAR UNA CONVERSACIÓN CON LA VENTANA CERRADA, ESCRITO NEGANDO
 *
 * Cada guarda de `retomarConversacion.ts` tiene acá una prueba que falla si se quita, y TODO rechazo comprueba que no quedó
 * nada: 0 mensajes, 0 cupo, 0 auditoría, conversación intacta y 0 timbres. La callable se arma con la fábrica y los topes se
 * inyectan (así esta suite no depende de que `index.ts` ya la exporte). El reloj entra por `Date` falso; el timbre y la
 * vigencia de la cuenta, por `fetch` y `getAuth` simulados. Firestore: el emulador (`FIRESTORE_EMULATOR_PORT`, 8231 por defecto).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const h = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase-admin/auth')>();
  return { ...original, getAuth: (...a: unknown[]) => h.getAuth(...a) };
});
await import('../../functions/src/index.ts'); // inicializa la app de Admin
const { crearRetomarConversacion, nombreComoParametro, plantillaDeRetomarDe } = await import('../../functions/src/core/conversacion/retomarConversacion.ts');
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
const TODOS = [A, OTRO, 'tienda-susp', 'tienda-clasica'];
const ANA = oper(A, 'u-ana');
const BRUNO = oper(A, 'u-bruno');
const TEL1 = '59100000001';
const CONV1 = `wa_${TEL1}`;
const NUMERO = '1000000901';
const AHORA = Date.UTC(2026, 10, 23, 15, 0, 0);
const MIN = 60_000;
const HORA = 3_600_000;
const DIA = 24 * HORA;
const ts = (ms: number) => Timestamp.fromMillis(ms);
const CLAVE = 'clave-de-retomar-0001';
const claveN = (n: number) => `clave-de-retomar-${String(n).padStart(4, '0')}`;
const PLANTILLA = { nombre: 'retomar_consulta', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 1, registradaEn: ts(AHORA - 5 * DIA) };

const URL_TIMBRE = 'https://n8n.ejemplo.test/webhook/prueba-de-timbre';
const CLAVE_TIMBRE = 'clave-de-prueba-del-timbre';
let timbres: Array<[string, string, number]> = [];
let timbreResponde = true;
const auth = { vigente: true, falla: false };
const usuarios = new Map<string, Record<string, unknown>>();
/** Las cifras del plan, inyectadas: core no las conoce. Cada prueba las puede bajar. */
let limites = { diasEntreRetomadas: 7, porDia: 20, porMes: 100 };
let llamadasAPlan: Array<[unknown, unknown, unknown]> = [];
const CALLABLE = crearRetomarConversacion({
  limitesDeRetomar: (plan, tarifa, titularidad) => { llamadasAPlan.push([plan, tarifa, titularidad]); return limites; },
  titularidadDe: () => 'comercio',
  tarifaDe: () => 'estandar',
}) as unknown as { run: (r: unknown) => Promise<unknown> };

interface ErrorLeido { code: string; message: string; details?: unknown }
async function rechazo(p: Promise<unknown>): Promise<ErrorLeido> {
  try { await p; } catch (e) { const x = e as ErrorLeido; return { code: x.code, message: x.message, details: x.details }; }
  throw new Error('la callable NO rechazó');
}
const base = (o: Record<string, unknown> = {}) => ({ tenantId: A, conversacionId: CONV1, claveIdempotencia: CLAVE, ...o });
const retomar = (data: unknown, a: Actor | null = ANA, ahoraMs = AHORA, vigente = true) => {
  auth.vigente = vigente;
  if (a) usuarios.set(a.uid, a.token['nc'] as Record<string, unknown>);
  vi.setSystemTime(new Date(ahoraMs));
  return CALLABLE.run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} }) as Promise<Record<string, unknown>>;
};

// --- Semillas ------------------------------------------------------------------
async function ficha(t: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}`).set({
    nombre: 'Comercio de Prueba', estado: 'activo', consolaConversaciones: 'nueva', personaPuedeEscribir: true, personaPuedeRetomar: true, ...o,
  });
}
/** Una conversación cuyo cliente escribió hace 30 h: ventana cerrada. */
async function conversacion(t: string, id: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}/conversaciones/${id}`).set({
    telefono: id.slice(3), canal: 'whatsapp', ultimoMensaje: 'Hola', mensajesTotal: 3, mensajesVentana: 2, atencionEstado: 'normal',
    noLeidos: 1, sinLeer: true, ultimoEntranteEn: ts(AHORA - 30 * HORA), ventanaVenceEn: ts(AHORA - 6 * HORA), ...o,
  });
}
async function ruta(o: Record<string, unknown> = {}, id = NUMERO) {
  await db.doc(`rutasWhatsApp/${id}`).set({ tenantId: A, estado: 'activo', aliasSecreto: 'cliente09', flujo: 'agendamiento', plantillas: { retomar: PLANTILLA }, ...o });
}
const cuenta = (o: Record<string, unknown> = {}) => db.doc(`tenants/${A}/cuenta/estado`).set({ plan: 'pro', ...o });
const leerConv = async (t = A, id = CONV1) => (await db.doc(`tenants/${t}/conversaciones/${id}`).get()).data() ?? {};
const mensajes = async (t = A, id = CONV1) => (await db.collection(`tenants/${t}/conversaciones/${id}/mensajes`).get()).docs;
const auditorias = async (t = A) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());
const topes = async () => (await db.collection('topesDeEnvio').get()).docs.map((d) => [d.id, d.data()] as const);
const metricas = async () => (await db.collection(`tenants/${A}/metricas`).get()).size;

/** Lo que NINGÚN rechazo puede dejar: mensaje, cupo, auditoría, cambios en la conversación ni timbre. */
async function sinEfectos(antes: Record<string, unknown>) {
  expect(await mensajes(), 'mensajes').toHaveLength(0);
  expect(await topes(), 'topes').toHaveLength(0);
  expect(await auditorias(), 'auditoría').toHaveLength(0);
  expect(await leerConv(), 'conversación').toEqual(antes);
  expect(timbres, 'timbres').toHaveLength(0);
  expect(await metricas(), 'métricas').toBe(0);
}
/** Prepara el escenario, intenta retomar y exige el rechazo con 0 efectos. */
async function rechaza(esperado: Partial<ErrorLeido>, data: unknown = base(), a: Actor | null = ANA, ahoraMs = AHORA, vigente = true): Promise<ErrorLeido> {
  const antes = await leerConv();
  const e = await rechazo(retomar(data, a, ahoraMs, vigente));
  expect(e).toMatchObject(esperado);
  await sinEfectos(antes);
  return e;
}

/** `recursiveDelete` se cuelga con el reloj falso: dentro de una prueba se borra con el reloj real y se vuelve al falso. */
async function borrarReal(r: Parameters<typeof db.recursiveDelete>[0]) {
  vi.useRealTimers();
  try { await db.recursiveDelete(r); } finally { vi.useFakeTimers({ toFake: ['Date'] }); }
}

let registros: string[] = [];
beforeAll(async () => { await db.doc('tenants/sonda-retomar').get(); }, 60_000);
beforeEach(async () => {
  vi.useRealTimers();
  for (const t of TODOS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('topesDeEnvio').listDocuments()) await d.delete();
  for (const d of await db.collection('rutasWhatsApp').listDocuments()) await d.delete();
  await ficha(A); await ficha(OTRO);
  await conversacion(A, CONV1);
  await ruta();
  await cuenta();
  timbres = []; timbreResponde = true; registros = []; llamadasAPlan = [];
  limites = { diasEntreRetomadas: 7, porDia: 20, porMes: 100 };
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
  it('crea el mensaje de plantilla `pendiente`, toma el turno con `retomadoEn`, cuenta el cupo, audita y toca el timbre UNA vez', async () => {
    const r = await retomar(base());
    expect(r).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(timbres).toEqual([[URL_TIMBRE, NUMERO, AHORA]]);
    const [m] = await mensajes();
    expect(m!.id).toBe(CLAVE);
    expect(m!.data()).toMatchObject({
      direccion: 'saliente', tipo: 'plantilla', texto: '', ts: ts(AHORA), autor: 'persona', autorUid: 'u-ana',
      estadoEnvio: 'pendiente', to: TEL1, phoneNumberId: NUMERO, tenantId: A,
      plantilla: { nombre: 'retomar_consulta', idioma: 'es', parametros: ['Comercio de Prueba'] },
    });
    expect(typeof m!.get('huella')).toBe('string');
    const d = await leerConv();
    expect(d['ultimaRetomadaEn']).toEqual(ts(AHORA));
    expect(d['ultimoEn']).toEqual(ts(AHORA));
    expect(d['ultimoMensaje']).toBe('Plantilla para retomar enviada');
    expect(d['turno']).toEqual({ responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA), actividadPersonaEn: ts(AHORA), retomadoEn: ts(AHORA) });
    expect(await topes()).toEqual([[`r_${A}`, { dia: '2026-11-23', nDia: 1, mes: '2026-11', nMes: 1, actualizadoEn: ts(AHORA) }]]);
  });

  it('NO toca el conteo ni la ventana de facturación: mensajesVentana, bloque de 25, umbrales, ventanaVenceEn, atencionEstado, envioPersona, métricas', async () => {
    const antes = await leerConv();
    await retomar(base());
    const d = await leerConv();
    for (const k of ['mensajesVentana', 'mensajesTotal', 'atencionEstado', 'ultimoEntranteEn', 'ventanaVenceEn', 'noLeidos', 'sinLeer', 'telefono']) {
      expect(d[k], k).toEqual(antes[k]);
    }
    expect(d).not.toHaveProperty('envioPersona');
    expect(d).not.toHaveProperty('ultimoSalientePersonaEn');
    expect(await metricas()).toBe(0); // la métrica de plantillas se cuenta al confirmar, no al crear
  });

  it('el plan se consulta con (plan de la cuenta, tarifa, titularidad): las cifras no están en core', async () => {
    await retomar(base());
    expect(llamadasAPlan).toEqual([['pro', 'estandar', 'comercio']]);
    expect(FUENTE('retomarConversacion.ts')).not.toMatch(/\b(20|100)\b/);
  });

  it('el destino sale de la conversación: un teléfono, una ruta, un nombre de plantilla o un parámetro del navegador se ignoran', async () => {
    await conversacion(OTRO, CONV1);
    await retomar(base({
      to: '59100000099', telefono: '59100000099', ruta: `tenants/${OTRO}/conversaciones/${CONV1}`, autor: 'asistente',
      estadoEnvio: 'aceptado', plantilla: { nombre: 'otra', idioma: 'en', parametros: ['x'] }, texto: 'hola', parametros: ['x'], phoneNumberId: '1',
    }));
    const [m] = await mensajes();
    expect(m!.get('to')).toBe(TEL1);
    expect(m!.get('autor')).toBe('persona');
    expect(m!.get('estadoEnvio')).toBe('pendiente');
    expect(m!.get('texto')).toBe('');
    expect(m!.get('plantilla')).toEqual({ nombre: 'retomar_consulta', idioma: 'es', parametros: ['Comercio de Prueba'] });
    expect(m!.get('phoneNumberId')).toBe(NUMERO);
    expect(await mensajes(OTRO)).toHaveLength(0);
  });

  it('un administrador también retoma; el soporte no', async () => {
    expect(await retomar(base(), admin(A))).toMatchObject({ estado: 'pendiente' });
    await borrarReal(db.collection(`tenants/${A}/conversaciones/${CONV1}/mensajes`));
    await conversacion(A, CONV1);
    for (const d of await db.collection('topesDeEnvio').listDocuments()) await d.delete();
    for (const d of await db.collection(`tenants/${A}/auditoria`).listDocuments()) await d.delete();
    timbres = [];
    await rechaza({ code: 'permission-denied' }, base({ claveIdempotencia: claveN(2) }), propietario());
  });

  it('auditoría `conversacion_retomada`: con telefono4, sin teléfono, sin id de conversación ni nombre de plantilla', async () => {
    await retomar(base());
    const [a] = await auditorias();
    expect(a).toEqual({ accion: 'conversacion_retomada', uid: 'u-ana', en: ts(AHORA), rol: 'oper', telefono4: '0001', resultado: 'ok', mensajeId: CLAVE });
    const plano = JSON.stringify(a, (_k, v) => (v instanceof Timestamp ? 'ts' : v));
    expect(plano).not.toContain(TEL1);
    expect(plano).not.toContain('wa_');
  });

  it('el timbre que falla NO falla el uso: queda `pendiente`', async () => {
    timbreResponde = false;
    expect(await retomar(base())).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(await mensajes()).toHaveLength(1);
  });

  it('los registros llevan solo comercio, uid, rol, telefono4 y motivo: ni teléfono ni nombre del comercio', async () => {
    await retomar(base());
    await rechazo(retomar(base({ conversacionId: 'wa_mal' })));
    const todo = registros.join('\n');
    expect(todo).not.toContain(TEL1);
    expect(todo).not.toContain(CONV1);
    expect(todo).not.toContain('Comercio de Prueba');
    expect(todo).toContain('0001');
  });
});

// ===========================================================================
describe('quién llama', () => {
  it('NEGATIVA: sin sesión, el soporte, un operador de otro comercio y un token sin rol no retoman', async () => {
    await rechaza({ code: 'unauthenticated' }, base(), null);
    await rechaza({ code: 'permission-denied' }, base(), propietario());
    await rechaza({ code: 'permission-denied' }, base(), oper(OTRO, 'u-otro'));
    await rechaza({ code: 'permission-denied' }, base(), actor('u-sin-rol', { t: {} }));
  });

  it('NEGATIVA: una cuenta deshabilitada con el token todavía vivo no retoma; y una falla de Auth falla cerrada', async () => {
    await rechaza({ code: 'permission-denied' }, base(), ANA, AHORA, false);
    auth.falla = true;
    await rechaza({ code: 'unavailable', message: 'No se pudo completar la operación. Intente de nuevo.' });
    expect(registros.join('\n')).not.toContain('zanahoria');
  });

  it('NEGATIVA: un comercio suspendido, o sin la consola nueva, no retoma', async () => {
    await db.doc(`tenants/${A}`).update({ estado: 'suspendido' });
    await rechaza({ code: 'permission-denied' });
    await ficha(A, { consolaConversaciones: 'clasica' });
    await rechaza({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('la forma de la entrada', () => {
  it('NEGATIVA: un id de Messenger o Instagram (`fb_…`), mal formado o sin teléfono no es una conversación de WhatsApp', async () => {
    for (const malo of ['fb_59100000001', 'ig_59100000001', 'wa_123', `wa_${TEL1}/x`, '59100000001', '', 7, null, undefined]) {
      await rechaza({ code: 'invalid-argument', message: 'Solicitud inválida.' }, base({ conversacionId: malo }));
    }
  });
  it('NEGATIVA: la clave de idempotencia tiene que ser de 16 a 128 caracteres válidos', async () => {
    for (const mala of ['corta', 'x'.repeat(129), 'con espacio 0123456789', '__reservado__', 7, undefined]) {
      await rechaza({ code: 'invalid-argument' }, base({ claveIdempotencia: mala }));
    }
  });
  it('NEGATIVA: un cuerpo que no es un objeto no retoma', async () => {
    await rechaza({ code: 'permission-denied' }, 'hola');
    await rechaza({ code: 'permission-denied' }, null);
  });
});

// ===========================================================================
describe('las banderas de la ficha, exactas', () => {
  it('NEGATIVA: sin `personaPuedeRetomar === true` (ausente, false, "true", 1) no se escribe nada ni se toca el timbre', async () => {
    const mensajeFijo = { code: 'permission-denied', message: 'Retomar conversaciones todavía no está activo para su negocio.' };
    await db.doc(`tenants/${A}`).update({ personaPuedeRetomar: FieldValueBorrar() });
    await rechaza(mensajeFijo);
    for (const valor of [false, 'true', 1, {}, []]) {
      await db.doc(`tenants/${A}`).update({ personaPuedeRetomar: valor });
      await rechaza(mensajeFijo);
    }
  });
  it('NEGATIVA: sin `personaPuedeEscribir === true` tampoco (se exigen las dos)', async () => {
    for (const valor of [false, 'true', 1]) {
      await ficha(A, { personaPuedeEscribir: valor });
      await rechaza({ code: 'permission-denied', message: 'Esta función todavía no está activa para su negocio.' });
    }
  });
  it('NEGATIVA: si la bandera se apaga DESPUÉS de la lectura previa, la transacción lo vuelve a comprobar', async () => {
    const real = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementation(((f: never, o?: never) =>
      db.doc(`tenants/${A}`).update({ personaPuedeRetomar: false }).then(() => real(f, o))) as unknown as typeof db.runTransaction);
    const antes = await leerConv();
    expect((await rechazo(retomar(base()))).code).toBe('permission-denied');
    await sinEfectos(antes);
  });
});
const FieldValueBorrar = () => FieldValueProxy.delete();
import { FieldValue as FieldValueProxy } from 'firebase-admin/firestore';

// ===========================================================================
describe('la ventana: solo se retoma con la ventana de 24 h CERRADA', () => {
  it('NEGATIVA: con la ventana abierta (hace 1 h, 23 h, y a 61 s de cerrar) es `ventanaAbierta`: se usa Tomar', async () => {
    const fijo = { code: 'failed-precondition', message: 'La ventana de 24 horas está abierta: use Tomar conversación.' };
    for (const hace of [HORA, 23 * HORA, 24 * HORA - 61_000]) {
      await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - hace) });
      await rechaza(fijo);
    }
  });
  it('el límite exacto: dentro del margen de 60 s ya no hay escritura posible, así que se retoma (una vía u otra)', async () => {
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - 24 * HORA + 59_000) });
    expect(await retomar(base())).toMatchObject({ estado: 'pendiente' });
  });
  it('NEGATIVA: sin `ultimoEntranteEn` (o ilegible) no se retoma lo que el cliente nunca inició', async () => {
    await borrarReal(db.doc(`tenants/${A}/conversaciones/${CONV1}`));
    await conversacion(A, CONV1);
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: FieldValueProxy.delete() });
    await rechaza({ code: 'not-found' });
    await conversacion(A, CONV1, { ultimoEntranteEn: 'ayer' });
    await rechaza({ code: 'not-found' });
  });
  it('NEGATIVA: una conversación que no existe, o un `ultimoEntranteEn` del futuro lejano (dato malo)', async () => {
    await borrarReal(db.doc(`tenants/${A}/conversaciones/${CONV1}`));
    await rechaza({ code: 'not-found' });
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA + 2 * HORA) });
    await rechaza({ code: 'unavailable' });
  });
});

// ===========================================================================
describe('el cliente, el turno y la retomada previa', () => {
  it('NEGATIVA: contacto bloqueado', async () => {
    await conversacion(A, CONV1, { bloqueada: true, bloqueadaPor: 'u-admin', bloqueadaEn: ts(AHORA - MIN) });
    await rechaza({ code: 'failed-precondition', message: 'Este contacto está bloqueado. Desbloquéelo para atenderlo.' });
  });
  it('NEGATIVA: `noContactar === true`: el cliente pidió que no se le escriba', async () => {
    await conversacion(A, CONV1, { noContactar: true });
    await rechaza({ code: 'failed-precondition', message: 'Este cliente pidió que no se le escriba.' });
  });
  it('un `noContactar` que no es `true` exacto no bloquea (contraprueba de la regla anterior)', async () => {
    await conversacion(A, CONV1, { noContactar: 'false' });
    expect(await retomar(base())).toMatchObject({ estado: 'pendiente' });
  });
  it('NEGATIVA: el turno vigente de OTRA persona (una retomada suya sin respuesta) es `ocupada`', async () => {
    await conversacion(A, CONV1, {
      turno: { responde: 'persona', tomadoPor: 'u-bruno', tomadoEn: ts(AHORA - 5 * MIN), actividadPersonaEn: ts(AHORA - MIN), retomadoEn: ts(AHORA - 5 * MIN) },
      ultimaRetomadaEn: ts(AHORA - 5 * MIN),
    });
    await rechaza({ code: 'failed-precondition', message: 'Esta conversación la atiende otra persona.' });
  });
  it('el turno vencido de otra persona (inactividad o ventana) no estorba, y se reemplaza entero', async () => {
    await conversacion(A, CONV1, {
      turno: { responde: 'persona', tomadoPor: 'u-bruno', tomadoEn: ts(AHORA - 40 * HORA), actividadPersonaEn: ts(AHORA - 39 * HORA), devueltoEn: ts(AHORA - 6 * HORA), motivoDevolucion: 'ventana' },
    });
    expect(await retomar(base())).toMatchObject({ estado: 'pendiente' });
    expect((await leerConv())['turno']).toEqual({ responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA), actividadPersonaEn: ts(AHORA), retomadoEn: ts(AHORA) });
  });
  it('NEGATIVA: un segundo Retomar antes de que el cliente responda es `retomadaPendiente` (aun por otra persona), hasta cumplir los días del plan', async () => {
    const fijo = { code: 'failed-precondition', message: 'Ya se envió una plantilla a este cliente; espere su respuesta.' };
    // el cliente escribió por última vez hace 10 días y nunca respondió a la plantilla
    const sinResponder = { ultimoEntranteEn: ts(AHORA - 10 * DIA) };
    await conversacion(A, CONV1, { ...sinResponder, ultimaRetomadaEn: ts(AHORA - 2 * DIA) });
    await rechaza(fijo);
    await rechaza(fijo, base({ claveIdempotencia: claveN(2) }), BRUNO);
    // justo antes del plazo sigue pendiente; cumplido el plazo ya no
    await conversacion(A, CONV1, { ...sinResponder, ultimaRetomadaEn: ts(AHORA - 7 * DIA + MIN) });
    await rechaza(fijo);
    await conversacion(A, CONV1, { ...sinResponder, ultimaRetomadaEn: ts(AHORA - 7 * DIA - MIN) });
    expect(await retomar(base())).toMatchObject({ estado: 'pendiente' });
  });
  it('el plazo sale del plan inyectado, no de un número en core', async () => {
    const sinResponder = { ultimoEntranteEn: ts(AHORA - 10 * DIA), ultimaRetomadaEn: ts(AHORA - 2 * DIA) };
    await conversacion(A, CONV1, sinResponder);
    await rechaza({ code: 'failed-precondition', message: 'Ya se envió una plantilla a este cliente; espere su respuesta.' }); // con 7 días
    limites = { ...limites, diasEntreRetomadas: 1 };
    expect(await retomar(base())).toMatchObject({ estado: 'pendiente' });
  });
  it('si el cliente respondió después de la retomada anterior, se puede volver a retomar cuando la ventana vuelva a cerrarse', async () => {
    await conversacion(A, CONV1, { ultimaRetomadaEn: ts(AHORA - 40 * HORA), ultimoEntranteEn: ts(AHORA - 30 * HORA) });
    expect(await retomar(base())).toMatchObject({ estado: 'pendiente' });
  });
  it('NEGATIVA: un `ultimaRetomadaEn` ilegible falla cerrado', async () => {
    await conversacion(A, CONV1, { ultimaRetomadaEn: 'hoy' });
    await rechaza({ code: 'unavailable' });
  });
});

// ===========================================================================
describe('la plantilla registrada en la ruta (C1) y la línea', () => {
  const mensajeFijo = { code: 'failed-precondition', message: 'La plantilla para retomar no está disponible en este número.' };
  it('NEGATIVA: sin plantilla registrada, o con cualquier campo fuera del contrato, no sale nada', async () => {
    await db.doc(`rutasWhatsApp/${NUMERO}`).update({ plantillas: FieldValueProxy.delete() });
    await rechaza(mensajeFijo);
    const malas: Array<[string, Record<string, unknown>]> = [
      ['estado PENDING', { estado: 'PENDING' }], ['estado PAUSED', { estado: 'PAUSED' }], ['estado en minúscula', { estado: 'approved' }],
      ['categoría MARKETING', { categoria: 'MARKETING' }], ['categoría AUTHENTICATION', { categoria: 'AUTHENTICATION' }],
      ['categoría en minúscula', { categoria: 'utility' }],
      ['nombre con mayúscula', { nombre: 'Retomar_consulta' }], ['nombre con guion', { nombre: 'retomar-consulta' }], ['nombre vacío', { nombre: '' }],
      ['nombre de 101', { nombre: 'a'.repeat(101) }], ['nombre no texto', { nombre: 7 }],
      ['idioma ES', { idioma: 'ES' }], ['idioma largo', { idioma: 'espanol' }], ['idioma es_bo', { idioma: 'es_bo' }], ['idioma vacío', { idioma: '' }],
      ['2 variables', { variables: 2 }], ['0 variables', { variables: 0 }], ['variables como texto', { variables: '1' }],
    ];
    for (const [nombre, cambio] of malas) {
      await ruta({ plantillas: { retomar: { ...PLANTILLA, ...cambio } } });
      await rechaza(mensajeFijo);
      expect(nombre).toBeTruthy();
    }
    await ruta({ plantillas: { retomar: 'retomar_consulta' } });
    await rechaza(mensajeFijo);
  });
  it('contraprueba: idiomas válidos `es`, `es_BO`, `pt_BR`', async () => {
    for (const idioma of ['es', 'es_BO', 'pt_BR']) {
      for (const d of await db.collection('topesDeEnvio').listDocuments()) await d.delete();
      await borrarReal(db.collection(`tenants/${A}/conversaciones/${CONV1}/mensajes`));
      await conversacion(A, CONV1);
      await ruta({ plantillas: { retomar: { ...PLANTILLA, idioma } } });
      await retomar(base());
      expect((await mensajes())[0]!.get('plantilla.idioma')).toBe(idioma);
    }
  });
  it('la plantilla de OTRO uso (`plantillas.aviso`) no sirve para retomar', async () => {
    await ruta({ plantillas: { aviso: PLANTILLA } });
    await rechaza(mensajeFijo);
  });
  it('NEGATIVA: la línea de la conversación manda; si es de otro comercio, inactiva o sin alias, no sale por otra', async () => {
    const canal = { code: 'failed-precondition', message: 'El canal de envío de este comercio no está disponible.' };
    await ruta({ tenantId: OTRO }, '1000000902');
    await conversacion(A, CONV1, { phoneNumberId: '1000000902' });
    await rechaza(canal);
    await ruta({ estado: 'inactivo' });
    await conversacion(A, CONV1, { phoneNumberId: NUMERO });
    await rechaza(canal);
    await ruta({ aliasSecreto: '' });
    await rechaza(canal);
  });
  it('con dos líneas sin `phoneNumberId` en la conversación no se adivina cuál: rechaza', async () => {
    await ruta({}, '1000000903');
    await rechaza({ code: 'failed-precondition', message: 'El canal de envío de este comercio no está disponible.' });
  });
  it('con dos líneas y `phoneNumberId`, sale por la del cliente y toca SU timbre', async () => {
    await ruta({ aliasSecreto: 'cliente09' }, '1000000903');
    await conversacion(A, CONV1, { phoneNumberId: '1000000903' });
    await retomar(base());
    expect((await mensajes())[0]!.get('phoneNumberId')).toBe('1000000903');
    expect(timbres[0]![1]).toBe('1000000903');
  });
  it('las funciones puras de C1 y del parámetro', () => {
    expect(plantillaDeRetomarDe({ plantillas: { retomar: PLANTILLA } })).toEqual({ nombre: 'retomar_consulta', idioma: 'es' });
    expect(plantillaDeRetomarDe(null)).toBeNull();
    expect(plantillaDeRetomarDe({ plantillas: [] })).toBeNull();
    expect(nombreComoParametro('  Casa\nBermejo\t\tSRL  ')).toBe('Casa Bermejo SRL');
    expect(nombreComoParametro('a    b')).toBe('a b'); // cuatro espacios seguidos no pasan
    expect(nombreComoParametro('x'.repeat(80))).toBe('x'.repeat(60));
    for (const malo of ['', '   ', '\n\t', 7, null, undefined, {}]) expect(nombreComoParametro(malo)).toBeNull();
  });
});

// ===========================================================================
describe('el parámetro {{1}}: el nombre del comercio, sin respaldo', () => {
  it('NEGATIVA: un comercio sin nombre (ausente, vacío, solo espacios, no texto) no retoma: no hay texto de respaldo', async () => {
    for (const nombre of [FieldValueProxy.delete(), '', '   ', '\n\t', 7]) {
      await ficha(A);
      await db.doc(`tenants/${A}`).update({ nombre });
      await rechaza({ code: 'unavailable' });
    }
    expect(FUENTE('retomarConversacion.ts')).not.toMatch(/\|\|\s*'/);
  });
  it('el nombre se sanea: saltos y tabulaciones fuera, espacios colapsados, 60 caracteres', async () => {
    await ficha(A, { nombre: `  Casa\nBermejo\t     SRL ${'x'.repeat(80)}` });
    await retomar(base());
    const [p] = (await mensajes())[0]!.get('plantilla.parametros') as string[];
    expect(p!.length).toBeLessThanOrEqual(60);
    expect(p).not.toMatch(/[\n\t]| {4}/);
    expect(p!.startsWith('Casa Bermejo SRL x')).toBe(true);
  });
});

// ===========================================================================
describe('los topes del plan (D-R3): por día y por mes por comercio, contados en la misma transacción', () => {
  it('NEGATIVA: el tope DIARIO rechaza con `retomarDia` y no consume cupo; mañana vuelve a andar', async () => {
    limites = { ...limites, porDia: 2 };
    for (let i = 1; i <= 2; i++) {
      await conversacion(A, `wa_5910000010${i}`);
      await retomar(base({ conversacionId: `wa_5910000010${i}`, claveIdempotencia: claveN(i) }));
    }
    const antes = await topes();
    await conversacion(A, 'wa_59100000103');
    const e = await rechazo(retomar(base({ conversacionId: 'wa_59100000103', claveIdempotencia: claveN(3) })));
    expect(e).toMatchObject({ code: 'resource-exhausted', details: { tope: 'retomarDia' } });
    expect(await topes()).toEqual(antes);
    expect(await mensajes(A, 'wa_59100000103')).toHaveLength(0);
    expect(timbres).toHaveLength(2);
    expect(await retomar(base({ conversacionId: 'wa_59100000103', claveIdempotencia: claveN(3) }), ANA, AHORA + DIA)).toMatchObject({ estado: 'pendiente' });
  });
  it('NEGATIVA: el tope MENSUAL rechaza con `retomarMes` aunque el diario alcance, y el mes siguiente se reinicia', async () => {
    limites = { ...limites, porMes: 2, porDia: 50 };
    for (let i = 1; i <= 2; i++) {
      await conversacion(A, `wa_5910000010${i}`);
      await retomar(base({ conversacionId: `wa_5910000010${i}`, claveIdempotencia: claveN(i) }), ANA, AHORA + i * DIA);
    }
    await conversacion(A, 'wa_59100000103');
    const antes = await topes();
    const e = await rechazo(retomar(base({ conversacionId: 'wa_59100000103', claveIdempotencia: claveN(3) }), ANA, AHORA + 3 * DIA));
    expect(e).toMatchObject({ code: 'resource-exhausted', details: { tope: 'retomarMes' } });
    expect(await topes()).toEqual(antes);
    expect(await retomar(base({ conversacionId: 'wa_59100000103', claveIdempotencia: claveN(3) }), ANA, AHORA + 10 * DIA)).toMatchObject({ estado: 'pendiente' });
  });
  it('los topes son por COMERCIO: los usos de otra persona del mismo comercio cuentan; los de otro comercio no', async () => {
    limites = { ...limites, porDia: 1 };
    await retomar(base());
    await conversacion(A, 'wa_59100000102');
    await rechazo(retomar(base({ conversacionId: 'wa_59100000102', claveIdempotencia: claveN(2) }), BRUNO));
    await db.doc(`tenants/${OTRO}`).update({ nombre: 'Otro' });
    await ruta({ tenantId: OTRO, aliasSecreto: 'cliente09' }, '1000000904');
    await conversacion(OTRO, CONV1, { phoneNumberId: '1000000904' });
    expect(await retomar(base({ tenantId: OTRO, claveIdempotencia: claveN(3) }), oper(OTRO, 'u-otro'))).toMatchObject({ estado: 'pendiente' });
  });
  it('NEGATIVA: cifras ilegibles del plan o un contador roto fallan cerrado (ni cupo inventado ni «sin tope»)', async () => {
    for (const malo of [{ diasEntreRetomadas: NaN, porDia: 1, porMes: 1 }, { diasEntreRetomadas: 7, porDia: -1, porMes: 1 }, { diasEntreRetomadas: 7, porDia: 1, porMes: Infinity }, { diasEntreRetomadas: 7, porDia: '20', porMes: 1 }]) {
      limites = malo as typeof limites;
      await rechaza({ code: 'unavailable' });
    }
    limites = { diasEntreRetomadas: 7, porDia: 20, porMes: 100 };
    await db.doc(`topesDeEnvio/r_${A}`).set({ dia: '2026-11-23', nDia: 'muchos', mes: '2026-11', nMes: 1 });
    const antes = await leerConv();
    expect((await rechazo(retomar(base()))).code).toBe('unavailable');
    expect(await mensajes()).toHaveLength(0);
    expect(await leerConv()).toEqual(antes);
    expect(timbres).toHaveLength(0);
  });
});

// ===========================================================================
describe('idempotencia: la clave atada a (conversación, persona)', () => {
  it('el reintento con la misma clave devuelve lo guardado, sin tocar el timbre, el cupo ni la auditoría', async () => {
    await retomar(base());
    const topesAntes = await topes();
    const r = await retomar(base(), ANA, AHORA + 5000);
    expect(r).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(timbres).toHaveLength(1);
    expect(await mensajes()).toHaveLength(1);
    expect(await auditorias()).toHaveLength(1);
    expect(await topes()).toEqual(topesAntes);
  });
  it('tras un rechazo del envío, el reintento devuelve el estado guardado', async () => {
    await retomar(base());
    await db.doc(`tenants/${A}/conversaciones/${CONV1}/mensajes/${CLAVE}`).update({ estadoEnvio: 'rechazado', codigoEnvio: '132001' });
    expect(await retomar(base())).toEqual({ estado: 'rechazado', mensajeId: CLAVE });
    expect(timbres).toHaveLength(1);
  });
  it('el reintento pasa antes que «retomada pendiente» y que el tope, pero no antes que las banderas', async () => {
    limites = { ...limites, porDia: 1 };
    await retomar(base());
    expect(await retomar(base())).toMatchObject({ estado: 'pendiente' }); // aun con el cupo agotado y la retomada pendiente
    await db.doc(`tenants/${A}`).update({ personaPuedeRetomar: false });
    expect((await rechazo(retomar(base()))).code).toBe('permission-denied');
  });
  it('NEGATIVA: la misma clave de OTRA persona, de un mensaje que no es de persona o con otra huella es `claveUsada`', async () => {
    await retomar(base());
    const fijo = { code: 'failed-precondition', message: 'Esa clave de envío ya se usó con otro mensaje.' };
    expect(await rechazo(retomar(base(), BRUNO))).toMatchObject(fijo);
    await db.doc(`tenants/${A}/conversaciones/${CONV1}/mensajes/${claveN(7)}`).set({ direccion: 'saliente', texto: 'del asistente' });
    expect(await rechazo(retomar(base({ claveIdempotencia: claveN(7) })))).toMatchObject(fijo);
    await db.doc(`tenants/${A}/conversaciones/${CONV1}/mensajes/${CLAVE}`).update({ huella: 'otra' });
    expect(await rechazo(retomar(base()))).toMatchObject(fijo);
    expect(timbres).toHaveLength(1);
  });
  it('dos usos a la vez con la misma clave: un solo mensaje, un solo cupo, un solo timbre, ambos reciben `pendiente`', async () => {
    const [x, y] = await Promise.all([retomar(base()), retomar(base())]);
    expect(x).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(y).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(await mensajes()).toHaveLength(1);
    expect(await auditorias()).toHaveLength(1);
    expect((await topes())[0]![1]).toMatchObject({ nDia: 1, nMes: 1 });
    expect(timbres).toHaveLength(1);
  });
});

// ===========================================================================
describe('la auditoría es falla-cerrada y atómica con el mensaje', () => {
  it('si no se puede escribir el documento de auditoría, no queda mensaje, ni cupo, ni turno, ni timbre', async () => {
    const real = Transaction.prototype.create;
    vi.spyOn(Transaction.prototype, 'create').mockImplementation(function (this: unknown, ref: { path: string }, ...r: unknown[]) {
      if (ref.path.includes('/auditoria/')) throw Object.assign(new Error('zanahoria'), { code: 9 });
      return (real as (...a: unknown[]) => unknown).call(this, ref, ...r) as never;
    } as never);
    const antes = await leerConv();
    expect((await rechazo(retomar(base()))).code).toBe('unavailable');
    await sinEfectos(antes);
    expect(registros.join('\n')).not.toContain('zanahoria');
  });
});

// ===========================================================================
describe('lo que el código NO hace', () => {
  it('no habla con Meta ni con el relé, no lee el token, no crea plantillas y no importa Central', () => {
    const f = FUENTE('retomarConversacion.ts');
    expect(f).not.toMatch(/graph\.facebook|WHATSAPP_TOKEN|Idempotency-Key|message_templates|subscribed_apps|mensajesVentana|atencionEstado|ventanaVenceEn|respuestasDelPeriodo/);
    expect(f).not.toMatch(/from '\.\.\/\.\.\/(central|modulos|plataforma)|from '\.\.\/(central|modulos|plataforma)/);
  });
  it('no hay un nombre de comercio, de plantilla ni un texto de respaldo en el código', () => {
    const f = FUENTE('retomarConversacion.ts');
    expect(f).not.toMatch(/retomar_consulta|Bellido|Q'Taco|Bermejo|Walisuma/i);
  });
});
