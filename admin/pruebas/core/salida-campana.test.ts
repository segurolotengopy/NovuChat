/**
 * LA COLA PROPIA DE LA CAMPAÑA SALIENTE DEL CHAT (PR-C, 27/11/2026): `materializarCampana` dentro de `reclamarSalidaPersona`
 * y los contadores y la pausa de `confirmarSalidaPersona`, contra el emulador. Cada prueba falla si se quita lo que prueba.
 *
 * Secciones: topes en el servidor · campaña o envío que no corresponde · pausa por errores · uno por contacto · camino feliz ·
 * cola de personas (la campaña nunca las hace caducar) · clave de la baja y omisiones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Valores de prueba, no secretos (alias 08: el mismo de `salida-persona.test.ts`; las suites corren una por una).
const TOKEN_A = 'valor-de-prueba-campana-a';
process.env['INGESTA_CLIENTE08'] = TOKEN_A;

const INDICE = await import('../../functions/src/index.ts');
const CAMP = await import('../../functions/src/core/conversacion/salidaCampana.ts');
const { getFirestore, FieldValue, Timestamp, Transaction } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'campana-a';
const NUM_A = '1000000901';
const CAMPANA = 'camp-prueba';
const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const CON_PLANTILLAS = { 'x-novuchat-plantillas': '1' };
const CONFIG = { porTanda: 45, porDia: 200, porReclamo: 3, ventanaDias: 60, pausaErroresPct: 10, pausaMinimoEnviados: 10, pausaNoPct: 25 };
const PLANTILLA_RUTA = { nombre: 'campana_chat', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 0, cabecera: 'ninguna', botones: 2 };
const CONV = (i: number) => `wa_5917100${String(1000 + i)}`;
const CLAVE_P = (n: number) => `clave-de-persona-${String(n).padStart(4, '0')}`;
const periodo = () => new Date().toISOString().slice(0, 7);
const hoy = () => CAMP.diaDeLaPaz(Date.now());
/** La fecha base de la ventana de un destinatario: hace 2 días (dentro de los 60 de CONFIG). */
const baseDentro = () => Timestamp.fromMillis(Date.now() - 2 * DIA);

type Datos = Record<string, unknown>;
interface Respuesta { codigo: number; cuerpo: unknown }
async function llamar(funcion: unknown, cuerpo: unknown, extra: Record<string, string> = {}): Promise<Respuesta> {
  const cab: Record<string, string> = { 'content-type': 'application/json', 'x-novuchat-numero': NUM_A, authorization: `Bearer ${TOKEN_A}`, ...extra };
  const leer = (n: string) => cab[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo ?? {})), headers: cab, get: leer, header: leer };
  const r: Respuesta = { codigo: 0, cuerpo: undefined };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; }, send(b: unknown) { r.cuerpo = b; return respuesta; }, json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; }, on() { return respuesta; },
    end(b: unknown) { if (b !== undefined) r.cuerpo = b; return respuesta; },
  };
  await (funcion as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
interface Entregado { mensajeId: string; conversacionId: string; claveRele: string; to: string; texto: string; tipo: string; canal: string; plantilla?: Datos }
const reclamar = (extra: Record<string, string> = CON_PLANTILLAS) => llamar((INDICE as Record<string, unknown>)['reclamarSalidaPersona'], {}, extra);
const confirmar = (cuerpo: unknown) => llamar((INDICE as Record<string, unknown>)['confirmarSalidaPersona'], cuerpo);
const entregados = (r: Respuesta) => (r.cuerpo as { mensajes: Entregado[] }).mensajes;
const delaCampana = (r: Respuesta) => entregados(r).filter((m) => m.mensajeId.startsWith('camp_'));
const resolver = (m: Entregado, resultado: 'aceptado' | 'rechazado' | 'incierto' = 'aceptado') => confirmar({
  mensajeId: m.mensajeId, conversacionId: m.conversacionId, resultado,
  ...(resultado === 'aceptado' ? { idMeta: `wamid.${m.mensajeId}` } : {}), ...(resultado === 'rechazado' ? { codigo: '131026' } : {}),
});

const refCampana = () => db.doc(`tenants/${A}/campanasSalientes/${CAMPANA}`);
const refDest = (conv: string) => refCampana().collection('destinatarios').doc(conv);
const refContador = () => db.doc(`topesDeEnvio/c_${A}`);
const campana = async (): Promise<Datos> => (await refCampana().get()).data() ?? {};
const dest = async (conv: string): Promise<Datos> => (await refDest(conv).get()).data() ?? {};
const mensaje = async (conv: string, clave: string): Promise<Datos | undefined> =>
  (await db.doc(`tenants/${A}/conversaciones/${conv}/mensajes/${clave}`).get()).data();
const claveDe = (conv: string) => CAMP.claveDeMensajeCampana(CAMPANA, conv);
const metricas = async (): Promise<Datos> => (await db.doc(`tenants/${A}/metricas/${periodo()}`).get()).data() ?? {};
const todosLosMensajes = async () => (await db.collectionGroup('mensajes').where('tenantId', '==', A).get()).size;

interface Opciones { n?: number; config?: unknown; campana?: Datos; ruta?: Datos; sinConfig?: boolean; ultimoEntrante?: number }
/** Siembra la ruta (puntero y plantilla), las cifras, la campaña `enCurso` con una tanda de 45 y `n` destinatarios con su conversación. */
async function preparar(o: Opciones = {}) {
  await db.doc(`rutasWhatsApp/${NUM_A}`).set({
    tenantId: A, estado: 'activo', aliasSecreto: 'cliente08', flujo: 'agendamiento',
    campanaSalienteEnCurso: CAMPANA, plantillas: { campana: PLANTILLA_RUTA }, ...(o.ruta ?? {}),
  });
  if (!o.sinConfig) await db.doc(`tenants/${A}/config/campanaSaliente`).set((o.config ?? CONFIG) as Datos);
  await refCampana().set({
    estado: 'enCurso', phoneNumberId: NUM_A, plantilla: { nombre: 'campana_chat', idioma: 'es', categoria: 'UTILITY' }, prueba: false, creadaEn: Timestamp.now(),
    total: o.n ?? 8, conteos: {}, tanda: { id: 't1', cupo: 45, usados: 0, calidad: 'VERDE', autorizadaEn: Timestamp.now() }, tandasHechas: [],
    materializados: 0, aceptados: 0, rechazados: 0, inciertos: 0, ...(o.campana ?? {}),
  });
  for (let i = 0; i < (o.n ?? 8); i++) {
    await db.doc(`tenants/${A}/conversaciones/${CONV(i)}`).set({
      telefono: CONV(i).slice(3), canal: 'whatsapp', ultimoEntranteEn: Timestamp.fromMillis(Date.now() - (o.ultimoEntrante ?? 3 * DIA)),
    });
    await refDest(CONV(i)).set({ estado: 'pendiente', fechaBase: baseDentro() });
  }
}
/** Un mensaje de PERSONA `pendiente` dentro de la ventana de Meta, de una conversación que no es de la campaña. */
async function sembrarPersona(n: number, conv = 'wa_59188800001') {
  await db.doc(`tenants/${A}/conversaciones/${conv}`).set({ telefono: conv.slice(3), canal: 'whatsapp', ultimoEntranteEn: Timestamp.fromMillis(Date.now() - MIN) }, { merge: true });
  await db.doc(`tenants/${A}/conversaciones/${conv}/mensajes/${CLAVE_P(n)}`).set({
    direccion: 'saliente', tipo: 'text', texto: `texto ${n}`, ts: Timestamp.fromMillis(Date.now() - 5_000), tenantId: A,
    autor: 'persona', autorUid: 'u-ana', estadoEnvio: 'pendiente', to: conv.slice(3), phoneNumberId: NUM_A, huellaEnvio: 'h',
  });
}

beforeEach(async () => {
  vi.useRealTimers();
  await db.recursiveDelete(db.doc(`tenants/${A}`));
  for (const d of await db.collection('rutasWhatsApp').listDocuments()) await d.delete();
  await db.recursiveDelete(db.collection('topesDeEnvio'));
  await db.doc(`tenants/${A}`).set({ nombre: 'A', estado: 'activo' });
});
afterEach(() => { vi.restoreAllMocks(); });

// ===========================================================================
describe('topes en el servidor: sin cifras legibles la campaña está cerrada', () => {
  it('sin `config/campanaSaliente`: 0 mensajes y 0 escrituras', async () => {
    await preparar({ sinConfig: true });
    const antes = await campana();
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toEqual(antes);
    expect((await refContador().get()).exists).toBe(false);
    expect(await todosLosMensajes()).toBe(0);
    expect((await dest(CONV(0)))['estado']).toBe('pendiente');
  });

  it.each([
    ['«45» como texto', { ...CONFIG, porTanda: '45' }], ['porDia 0', { ...CONFIG, porDia: 0 }], ['porReclamo -1', { ...CONFIG, porReclamo: -1 }],
    ['porReclamo 11', { ...CONFIG, porReclamo: 11 }], ['pausaErroresPct 101', { ...CONFIG, pausaErroresPct: 101 }],
    ['pausaNoPct 101', { ...CONFIG, pausaNoPct: 101 }], ['sin ventanaDias', { ...CONFIG, ventanaDias: undefined }],
    ['porTanda decimal', { ...CONFIG, porTanda: 4.5 }],
  ])('NIEGA: cifras ilegibles (%s): 0 mensajes y 0 escrituras', async (_n, config) => {
    await preparar({ config: JSON.parse(JSON.stringify(config)) });
    const antes = await campana();
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toEqual(antes);
    expect((await refContador().get()).exists).toBe(false);
    expect(await todosLosMensajes()).toBe(0);
  });

  it('NIEGA: una tanda con cupo mayor que `porTanda` no sale; una agotada (usados == cupo) tampoco', async () => {
    await preparar({ campana: { tanda: { id: 't1', cupo: 46, usados: 0, calidad: 'VERDE' } } });
    expect(delaCampana(await reclamar())).toEqual([]);
    await preparar({ campana: { tanda: { id: 't1', cupo: 5, usados: 5, calidad: 'VERDE' } } });
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await todosLosMensajes()).toBe(0);
  });

  it('un cupo de 5 con 8 pendientes, en varios reclamos, envía EXACTAMENTE 5 (3 + 2) y deja 3 pendientes', async () => {
    await preparar({ campana: { tanda: { id: 't1', cupo: 5, usados: 0, calidad: 'VERDE' } } });
    const primero = delaCampana(await reclamar());
    expect(primero).toHaveLength(3);
    for (const m of primero) expect((await resolver(m)).codigo).toBe(200);
    const segundo = delaCampana(await reclamar());
    expect(segundo).toHaveLength(2);
    for (const m of segundo) expect((await resolver(m)).codigo).toBe(200);
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toMatchObject({ materializados: 5, aceptados: 5, tanda: { usados: 5, cupo: 5 } });
    let pendientes = 0;
    for (let i = 0; i < 8; i++) if ((await dest(CONV(i)))['estado'] === 'pendiente') pendientes += 1;
    expect(pendientes).toBe(3);
  });

  it('`porDia` alcanzado: 0; el contador de AYER vuelve a empezar; y a mitad de la vuelta salen solo los que caben', async () => {
    await preparar();
    await refContador().set({ dia: hoy(), nDia: 200, actualizadoEn: Timestamp.now() });
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await todosLosMensajes()).toBe(0);

    await refContador().set({ dia: '2000-01-01', nDia: 200, actualizadoEn: Timestamp.now() });
    const m = delaCampana(await reclamar());
    expect(m).toHaveLength(3);
    expect((await refContador().get()).data()).toMatchObject({ dia: hoy(), nDia: 3 });
    for (const x of m) await resolver(x);

    await refContador().set({ dia: hoy(), nDia: 198, actualizadoEn: Timestamp.now() });
    expect(delaCampana(await reclamar())).toHaveLength(2);
    expect((await refContador().get()).data()).toMatchObject({ dia: hoy(), nDia: 200 });
  });

  it('el contador del día lo respeta aunque el servidor escriba sus mensajes: sin `porReclamo` mayor que el configurado (porReclamo 1 envía 1)', async () => {
    await preparar({ config: { ...CONFIG, porReclamo: 1 } });
    expect(delaCampana(await reclamar())).toHaveLength(1);
  });
});

// ===========================================================================
describe('campaña o envío que no corresponde: 0 mensajes', () => {
  const sinSalida = async () => {
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await todosLosMensajes()).toBe(0);
    expect((await dest(CONV(0)))['estado']).toBe('pendiente');
  };
  it.each(['creada', 'pausada', 'terminada'])('NIEGA: la campaña %s no sale', async (estado) => {
    await preparar({ campana: { estado } });
    await sinSalida();
  });
  it('NIEGA: una campaña de otra línea no sale', async () => {
    await preparar({ campana: { phoneNumberId: '1000009999' } });
    await sinSalida();
  });
  it.each([
    ['con mayúsculas y espacio', 'Camp Prueba'], ['corto', 'ab'], ['con barra', 'camp/prueba'], ['numérico', 12345],
  ])('NIEGA: un puntero inválido (%s) no sale', async (_n, puntero) => {
    await preparar({ ruta: { campanaSalienteEnCurso: puntero } });
    await sinSalida();
  });
  it('NIEGA: un puntero a una campaña inexistente no sale; sin puntero tampoco', async () => {
    await preparar({ ruta: { campanaSalienteEnCurso: 'otra-campana' } });
    await sinSalida();
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ campanaSalienteEnCurso: FieldValue.delete() });
    await sinSalida();
  });
  it.each([
    ['PENDING', { ...PLANTILLA_RUTA, estado: 'PENDING' }], ['con variables', { ...PLANTILLA_RUTA, variables: 1 }],
    ['con cabecera', { ...PLANTILLA_RUTA, cabecera: 'imagen' }], ['con un botón', { ...PLANTILLA_RUTA, botones: 1 }],
    ['categoría AUTHENTICATION', { ...PLANTILLA_RUTA, categoria: 'AUTHENTICATION' }],
  ])('NIEGA: la plantilla %s no sale', async (_n, plantilla) => {
    await preparar({ ruta: { plantillas: { campana: plantilla } } });
    await sinSalida();
  });
  it('NIEGA: sin plantilla de campaña registrada (solo Retomar) no sale', async () => {
    await preparar({ ruta: { plantillas: { retomar: PLANTILLA_RUTA } } });
    await sinSalida();
  });
  it('NIEGA: sin la cabecera `x-novuchat-plantillas` no sale (un flujo viejo nunca la recibe a medias)', async () => {
    await preparar();
    expect(delaCampana(await reclamar({}))).toEqual([]);
    expect(await todosLosMensajes()).toBe(0);
    expect(await campana()).toMatchObject({ materializados: 0 });
  });
  it('NIEGA: una campaña con contadores rotos (más resueltos que enviados) no sale', async () => {
    await preparar({ campana: { materializados: 1, aceptados: 3 } });
    await sinSalida();
  });
  it('NIEGA: un comercio suspendido no entrega nada', async () => {
    await preparar();
    await db.doc(`tenants/${A}`).update({ estado: 'suspendido' });
    await sinSalida();
  });
  it('control: con todo en regla sale (la prueba de que las negativas de arriba no pasan en vacío)', async () => {
    await preparar();
    expect(delaCampana(await reclamar())).toHaveLength(3);
  });
});

// ===========================================================================
describe('pausa por errores, en el servidor', () => {
  /** Una campaña con `resueltos` ya contados y UN mensaje en vuelo que se confirma con `resultado`. */
  async function conUnoEnVuelo(contadores: { aceptados: number; rechazados: number }) {
    const resueltos = contadores.aceptados + contadores.rechazados;
    await preparar({ campana: { materializados: resueltos + 1, ...contadores, tanda: { id: 't1', cupo: 45, usados: resueltos + 1, calidad: 'VERDE' } }, n: 4 });
    const conv = CONV(0);
    await db.doc(`tenants/${A}/conversaciones/${conv}/mensajes/${claveDe(conv)}`).set({
      direccion: 'saliente', tipo: 'plantilla', texto: '', ts: Timestamp.now(), reclamadoEn: Timestamp.now(), autor: 'campana', estadoEnvio: 'enviando',
      tenantId: A, phoneNumberId: NUM_A, campanaId: CAMPANA, tandaId: 't1', contado: false,
      plantilla: { nombre: 'campana_chat', idioma: 'es', parametros: [], botones: [{ indice: 0, payload: `cs:si:${CAMPANA}` }, { indice: 1, payload: `cs:no:${CAMPANA}` }] },
    });
    await refDest(conv).update({ estado: 'enviado', mensajeId: claveDe(conv) });
    return { conv, mensajeId: claveDe(conv) };
  }

  it('con 5 rechazos de 10 resueltos queda pausada (`errores`) y el reclamo siguiente da 0', async () => {
    const { conv, mensajeId } = await conUnoEnVuelo({ aceptados: 5, rechazados: 4 });
    expect((await confirmar({ mensajeId, conversacionId: conv, resultado: 'rechazado', codigo: '131026' })).codigo).toBe(200);
    expect(await campana()).toMatchObject({ estado: 'pausada', motivoPausa: 'errores', aceptados: 5, rechazados: 5 });
    expect(delaCampana(await reclamar())).toEqual([]);
    expect((await dest(CONV(1)))['estado']).toBe('pendiente');
  });

  it('NIEGA la pausa en el borde: EXACTAMENTE el 10 % (1 de 10) no pausa y la campaña sigue saliendo', async () => {
    const { conv, mensajeId } = await conUnoEnVuelo({ aceptados: 8, rechazados: 1 });
    expect((await confirmar({ mensajeId, conversacionId: conv, resultado: 'aceptado', idMeta: 'wamid.X1' })).codigo).toBe(200);
    expect(await campana()).toMatchObject({ estado: 'enCurso', aceptados: 9, rechazados: 1 });
    expect(delaCampana(await reclamar())).toHaveLength(3);
  });

  it('NIEGA la pausa por debajo del mínimo: 9 resueltos, todos rechazados, no pausa', async () => {
    const { conv, mensajeId } = await conUnoEnVuelo({ aceptados: 0, rechazados: 8 });
    expect((await confirmar({ mensajeId, conversacionId: conv, resultado: 'rechazado', codigo: '131026' })).codigo).toBe(200);
    expect(await campana()).toMatchObject({ estado: 'enCurso', rechazados: 9 });
  });

  it('con 2 de 10 (20 %) pausa: el porcentaje se lee de la configuración', async () => {
    const { conv, mensajeId } = await conUnoEnVuelo({ aceptados: 8, rechazados: 1 });
    expect((await confirmar({ mensajeId, conversacionId: conv, resultado: 'rechazado', codigo: '131026' })).codigo).toBe(200);
    expect(await campana()).toMatchObject({ estado: 'pausada', motivoPausa: 'errores' });
  });

  it('el mismo resultado repetido no cuenta dos veces', async () => {
    const { conv, mensajeId } = await conUnoEnVuelo({ aceptados: 5, rechazados: 0 });
    for (let i = 0; i < 3; i++) expect((await confirmar({ mensajeId, conversacionId: conv, resultado: 'aceptado', idMeta: 'wamid.R1' })).codigo).toBe(200);
    expect(await campana()).toMatchObject({ aceptados: 6, rechazados: 0 });
    expect(await metricas()).toEqual({ plantillasCampana: 1 });
  });

  it('un `incierto` suma `inciertos`; al resolverse como aceptado lo resta (no queda contado en dos lugares)', async () => {
    const { conv, mensajeId } = await conUnoEnVuelo({ aceptados: 2, rechazados: 0 });
    expect((await confirmar({ mensajeId, conversacionId: conv, resultado: 'incierto' })).codigo).toBe(200);
    expect(await campana()).toMatchObject({ aceptados: 2, inciertos: 1 });
    expect((await confirmar({ mensajeId, conversacionId: conv, resultado: 'aceptado', idMeta: 'wamid.I1' })).codigo).toBe(200);
    expect(await campana()).toMatchObject({ aceptados: 3, inciertos: 0 });
  });

  it('un `enviando` viejo que el reclamo da por `incierto` suma `inciertos` en la campaña, y libera el cupo en vuelo', async () => {
    const { conv, mensajeId } = await conUnoEnVuelo({ aceptados: 2, rechazados: 0 });
    await db.doc(`tenants/${A}/conversaciones/${conv}/mensajes/${mensajeId}`).update({ reclamadoEn: Timestamp.fromMillis(Date.now() - 5 * MIN) });
    const r = await reclamar();
    expect(await campana()).toMatchObject({ inciertos: 1 });
    expect((await mensaje(conv, mensajeId))?.['estadoEnvio']).toBe('incierto');
    // Ya no hay nada en vuelo (el incierto salió de «en vuelo»): la misma vuelta pudo materializar los siguientes.
    expect(delaCampana(r).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe('uno por contacto, por estructura', () => {
  it('cada contacto recibe UN mensaje: 4 reclamos seguidos (con confirmación) no repiten a nadie', async () => {
    await preparar({ n: 6 });
    const vistos: string[] = [];
    for (let v = 0; v < 4; v++) {
      const m = delaCampana(await reclamar());
      for (const x of m) { vistos.push(x.conversacionId); await resolver(x); }
    }
    expect(vistos.sort()).toEqual([0, 1, 2, 3, 4, 5].map(CONV));
    expect(new Set(vistos).size).toBe(6);
    expect(await campana()).toMatchObject({ materializados: 6, aceptados: 6, tanda: { usados: 6 } });
  });

  it('NIEGA: un destinatario manipulado (vuelto a `pendiente` con su mensaje ya creado) queda `omitido/repetido` y no sale otra vez', async () => {
    await preparar({ n: 1 });
    const [m] = delaCampana(await reclamar());
    await resolver(m!);
    const antes = await mensaje(CONV(0), claveDe(CONV(0)));
    await refDest(CONV(0)).set({ estado: 'pendiente', fechaBase: baseDentro() });
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await dest(CONV(0))).toMatchObject({ estado: 'omitido', motivo: 'repetido' });
    expect(await mensaje(CONV(0), claveDe(CONV(0)))).toEqual(antes);
    expect(await campana()).toMatchObject({ materializados: 1 });
  });

  it('NIEGA: el mensaje `camp_…` se escribe con `tx.create` (falla si ya existe), nunca con `set`: se fija con un espía', async () => {
    await preparar({ n: 3 });
    const crea = vi.spyOn(Transaction.prototype, 'create');
    const pone = vi.spyOn(Transaction.prototype, 'set');
    const m = delaCampana(await reclamar());
    expect(m).toHaveLength(3);
    const rutas = crea.mock.calls.map((c) => (c[0] as { path: string }).path).sort();
    expect(rutas).toEqual(m.map((x) => `tenants/${A}/conversaciones/${x.conversacionId}/mensajes/${x.mensajeId}`).sort());
    // `set` solo puede tocar el contador del día: ningún mensaje de la campaña se escribe con él.
    for (const c of pone.mock.calls) expect((c[0] as { path: string }).path).not.toContain('/mensajes/');
  });

  it('NIEGA: dos reclamos a la vez no envían dos veces (3 en total, cada contacto una vez)', async () => {
    await preparar({ n: 8 });
    const [r1, r2] = await Promise.all([reclamar(), reclamar()]);
    const todos = [...delaCampana(r1), ...delaCampana(r2)].map((m) => m.conversacionId);
    expect(todos).toHaveLength(3);
    expect(new Set(todos).size).toBe(3);
    expect(await campana()).toMatchObject({ materializados: 3, tanda: { usados: 3 } });
    expect(await todosLosMensajes()).toBe(3);
  });

  it('NIEGA: con mensajes de la campaña en vuelo no se materializa más (nunca más de `porReclamo` en vuelo)', async () => {
    await preparar({ n: 8 });
    const primero = delaCampana(await reclamar());
    expect(primero).toHaveLength(3);
    expect(delaCampana(await reclamar())).toEqual([]);
    await resolver(primero[0]!);
    expect(delaCampana(await reclamar())).toEqual([]);
    for (const m of primero.slice(1)) await resolver(m);
    expect(delaCampana(await reclamar())).toHaveLength(3);
  });
});

// ===========================================================================
describe('integración con el script del módulo: crear -> reclamo 0 -> autorizar-tanda -> reclamo N -> cerrar-tanda -> reclamo 0', () => {
  it('la campaña recién creada (sin puntero, tanda null) no sale; autorizada sale dentro de los topes; cerrada (tanda null, sin puntero) no sale', async () => {
    await preparar({ n: 8, campana: { estado: 'creada', tanda: null, tandasHechas: [] } });
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ campanaSalienteEnCurso: FieldValue.delete() });
    // `crear`: destinatarios pendientes, sin puntero.
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await todosLosMensajes()).toBe(0);

    // `autorizar-tanda` (cupo 4): estado enCurso, tanda y puntero.
    await refCampana().update({ estado: 'enCurso', tanda: { id: 't1', cupo: 4, usados: 0, calidad: 'VERDE', autorizadaEn: Timestamp.now() } });
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ campanaSalienteEnCurso: CAMPANA });
    const primero = delaCampana(await reclamar());
    expect(primero).toHaveLength(3);
    for (const m of primero) await resolver(m);
    const segundo = delaCampana(await reclamar());
    expect(segundo).toHaveLength(1);
    for (const m of segundo) await resolver(m);
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toMatchObject({ materializados: 4, aceptados: 4, tanda: { usados: 4, cupo: 4 } });

    // `cerrar-tanda`: queda enCurso con `tanda: null`, sin puntero, `tandasHechas` con la tanda; quedan pendientes y no sale nada.
    await refCampana().update({ tanda: null, tandasHechas: [{ id: 't1', cupo: 4, usados: 4, calidad: 'VERDE', autorizadaEn: Timestamp.now(), cerradaEn: Timestamp.now() }] });
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ campanaSalienteEnCurso: FieldValue.delete() });
    expect(delaCampana(await reclamar())).toEqual([]);
    // Aunque el puntero quedara puesto, `tanda: null` tampoco materializa.
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ campanaSalienteEnCurso: CAMPANA });
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await todosLosMensajes()).toBe(4);
  });
});

// ===========================================================================
describe('camino feliz', () => {
  it('el mensaje sale con su plantilla, 0 parámetros y los payloads en minúsculas; todo queda anotado y contado', async () => {
    await preparar({ n: 4 });
    const r = await reclamar();
    expect(r.codigo).toBe(200);
    const m = delaCampana(r);
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({
      mensajeId: claveDe(CONV(0)), conversacionId: CONV(0), to: CONV(0).slice(3), texto: '', tipo: 'plantilla', canal: 'graph',
      plantilla: { nombre: 'campana_chat', idioma: 'es', parametros: [], botones: [{ indice: 0, payload: 'cs:si:camp-prueba' }, { indice: 1, payload: 'cs:no:camp-prueba' }] },
    });
    expect(m[0]!.claveRele).toMatch(/^[0-9a-f]{48}$/);
    expect(await mensaje(CONV(0), claveDe(CONV(0)))).toMatchObject({
      direccion: 'saliente', tipo: 'plantilla', texto: '', autor: 'campana', estadoEnvio: 'enviando', tenantId: A, phoneNumberId: NUM_A,
      campanaId: CAMPANA, tandaId: 't1', contado: false,
    });
    expect(await dest(CONV(0))).toMatchObject({ estado: 'enviado', tandaId: 't1', mensajeId: claveDe(CONV(0)) });
    expect(await dest(CONV(3))).toEqual({ estado: 'pendiente', fechaBase: expect.anything() });
    expect(await campana()).toMatchObject({ materializados: 3, aceptados: 0, tanda: { id: 't1', cupo: 45, usados: 3 } });
    expect((await refContador().get()).data()).toMatchObject({ dia: hoy(), nDia: 3 });
    expect(await metricas()).toEqual({});
  });

  it('al aceptar: cuenta en `plantillasCampana`, suma `aceptados` y la conversación recuerda la campaña (PR-B)', async () => {
    await preparar({ n: 1 });
    const [m] = delaCampana(await reclamar());
    expect((await resolver(m!)).codigo).toBe(200);
    expect(await campana()).toMatchObject({ aceptados: 1, rechazados: 0 });
    expect(await metricas()).toEqual({ plantillasCampana: 1 });
    const conv = (await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).get()).data()!;
    expect(conv['campanaEnviada']).toMatchObject({ campanaId: CAMPANA, idMeta: `wamid.${claveDe(CONV(0))}` });
  });

  it('un rechazo suma `rechazados`, no cuenta en `plantillasCampana` y libera el lugar en vuelo', async () => {
    await preparar({ n: 5 });
    const m = delaCampana(await reclamar());
    for (const x of m) await resolver(x, 'rechazado');
    expect(await campana()).toMatchObject({ rechazados: 3, aceptados: 0 });
    expect(await metricas()).toEqual({});
    // 3 rechazos de 3 no llegan al mínimo de 10: no pausa y sigue.
    expect(delaCampana(await reclamar())).toHaveLength(2);
  });

  it('la campaña de un número con relé sale con `canal: rele`', async () => {
    await preparar({ n: 1, ruta: { canalSalida: 'rele' } });
    expect(delaCampana(await reclamar())[0]).toMatchObject({ canal: 'rele' });
  });
});

// ===========================================================================
describe('cola de personas: la campaña nunca las hace caducar', () => {
  it('con 10 mensajes de personas salen los 10 y 0 de la campaña', async () => {
    await preparar({ n: 8 });
    for (let i = 1; i <= 10; i++) await sembrarPersona(i);
    const r = await reclamar();
    expect(entregados(r)).toHaveLength(10);
    expect(delaCampana(r)).toEqual([]);
    expect(await campana()).toMatchObject({ materializados: 0 });
  });

  it('con 3 de personas salen 3 + min(7, porReclamo) de la campaña', async () => {
    await preparar({ n: 8, config: { ...CONFIG, porReclamo: 5 } });
    for (let i = 1; i <= 3; i++) await sembrarPersona(i);
    const r = await reclamar();
    expect(entregados(r)).toHaveLength(3 + 5);
    expect(delaCampana(r)).toHaveLength(5);
    // Las personas van primero, en orden.
    expect(entregados(r).slice(0, 3).map((m) => m.mensajeId)).toEqual([CLAVE_P(1), CLAVE_P(2), CLAVE_P(3)]);
  });

  it('con 8 de personas la campaña solo recibe los 2 lugares que quedan', async () => {
    await preparar({ n: 8, config: { ...CONFIG, porReclamo: 5 } });
    for (let i = 1; i <= 8; i++) await sembrarPersona(i);
    const r = await reclamar();
    expect(entregados(r)).toHaveLength(10);
    expect(delaCampana(r)).toHaveLength(2);
  });

  it('INANICIÓN: 20 reclamos con una campaña de 45 y 2 mensajes nuevos de personas por vuelta: ninguno de personas caduca', async () => {
    await preparar({ n: 45, config: { ...CONFIG, porReclamo: 3 } });
    let persona = 0;
    let deCampana = 0;
    for (let v = 0; v < 20; v++) {
      await sembrarPersona(++persona);
      await sembrarPersona(++persona);
      const r = await reclamar();
      const delasPersonas = entregados(r).filter((m) => !m.mensajeId.startsWith('camp_'));
      expect(delasPersonas.map((m) => m.mensajeId), `vuelta ${v}`).toEqual([CLAVE_P(persona - 1), CLAVE_P(persona)]);
      deCampana += delaCampana(r).length;
      for (const m of entregados(r)) await resolver(m);
    }
    expect(deCampana).toBe(45); // 15 vueltas de 3: la campaña también avanza
    let caducados = 0;
    for (let i = 1; i <= persona; i++) {
      const d = await mensaje('wa_59188800001', CLAVE_P(i));
      if (d?.['codigoEnvio'] === 'caducado') caducados += 1;
      expect(d?.['estadoEnvio'], CLAVE_P(i)).toBe('aceptado');
    }
    expect(caducados).toBe(0);
    expect(await campana()).toMatchObject({ materializados: 45, aceptados: 45, tanda: { usados: 45 } });
  });

  it('si la materialización lanza un error, las personas salen igual con 200 (y la campaña no avanza)', async () => {
    await preparar({ n: 8 });
    await sembrarPersona(1);
    vi.spyOn(Transaction.prototype, 'getAll').mockRejectedValue(Object.assign(new Error('falla simulada'), { code: 'prueba-de-falla' }));
    const r = await reclamar();
    expect(r.codigo).toBe(200);
    expect(entregados(r).map((m) => m.mensajeId)).toEqual([CLAVE_P(1)]);
    vi.restoreAllMocks();
    expect(await campana()).toMatchObject({ materializados: 0 });
    expect(await dest(CONV(0))).toEqual({ estado: 'pendiente', fechaBase: expect.anything() });
  });

  it('un `pendiente` de campaña escrito a mano queda `rechazado/fueraDeCola`, no sale y no cuenta', async () => {
    await preparar({ n: 1 });
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ campanaSalienteEnCurso: FieldValue.delete() });
    const conv = CONV(0);
    await db.doc(`tenants/${A}/conversaciones/${conv}/mensajes/clave-a-mano-0001`).set({
      direccion: 'saliente', tipo: 'plantilla', texto: '', ts: Timestamp.fromMillis(Date.now() - 5_000), tenantId: A, autor: 'campana',
      estadoEnvio: 'pendiente', phoneNumberId: NUM_A, campanaId: CAMPANA,
      plantilla: { nombre: 'campana_chat', idioma: 'es', parametros: [], botones: [{ indice: 0, payload: 'cs:si:camp-prueba' }, { indice: 1, payload: 'cs:no:camp-prueba' }] },
    });
    const r = await reclamar();
    expect(entregados(r)).toEqual([]);
    expect(await mensaje(conv, 'clave-a-mano-0001')).toMatchObject({ estadoEnvio: 'rechazado', codigoEnvio: 'fueraDeCola', reintentable: false, contado: false });
    expect(await metricas()).toEqual({});
  });

  it('un `pendiente` de campaña a mano NO ocupa la cola de las personas: la persona de la misma vuelta sale', async () => {
    await preparar({ n: 0 });
    await sembrarPersona(1);
    await db.doc(`tenants/${A}/conversaciones/wa_59188800001/mensajes/clave-a-mano-0002`).set({
      direccion: 'saliente', tipo: 'plantilla', texto: '', ts: Timestamp.fromMillis(Date.now() - 20_000), tenantId: A, autor: 'campana',
      estadoEnvio: 'pendiente', phoneNumberId: NUM_A,
      plantilla: { nombre: 'campana_chat', idioma: 'es', parametros: [], botones: [{ indice: 0, payload: 'cs:si:camp-prueba' }] },
    });
    const r = await reclamar();
    expect(entregados(r).map((m) => m.mensajeId)).toEqual([CLAVE_P(1)]);
    expect(await mensaje('wa_59188800001', 'clave-a-mano-0002')).toMatchObject({ estadoEnvio: 'rechazado', codigoEnvio: 'fueraDeCola' });
  });

  it('sin puntero en la ruta el reclamo no lee la campaña ni las cifras (ninguna lectura de más)', async () => {
    await preparar({ n: 2 });
    await db.doc(`rutasWhatsApp/${NUM_A}`).update({ campanaSalienteEnCurso: FieldValue.delete() });
    await sembrarPersona(1);
    const espia = vi.spyOn(Transaction.prototype, 'getAll');
    const r = await reclamar();
    expect(entregados(r)).toHaveLength(1);
    expect(espia).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe('clave de la baja y omisiones del servidor (no consumen cupo)', () => {
  const siembraUna = async (cambio: () => Promise<unknown>, n = 1) => {
    await preparar({ n });
    await cambio();
  };
  const omitido = async (conv: string, motivo: string) => {
    expect(await dest(conv)).toMatchObject({ estado: 'omitido', motivo });
    expect(await mensaje(conv, claveDe(conv))).toBeUndefined();
  };

  it('la baja `bajas/wa_591…` deja `omitido/baja`; la baja de OTRO teléfono no frena', async () => {
    await preparar({ n: 2 });
    await db.doc(`tenants/${A}/bajas/${CONV(0)}`).set({ canal: 'whatsapp', origen: 'boton_campana', campanaId: CAMPANA, desde: Timestamp.now() });
    const m = delaCampana(await reclamar());
    expect(m.map((x) => x.conversacionId)).toEqual([CONV(1)]);
    await omitido(CONV(0), 'baja');
  });

  it('la clave de la baja es `wa_` + dígitos: una baja escrita sin 591 o con `+` NO frena (es otra clave; por eso la lista usa `claveDeContacto`)', async () => {
    await preparar({ n: 1 });
    await db.doc(`tenants/${A}/bajas/${CONV(0).replace('wa_591', 'wa_')}`).set({ canal: 'whatsapp', desde: Timestamp.now() });
    await db.doc(`tenants/${A}/bajas/${CONV(0).replace('wa_', 'wa_+')}`).set({ canal: 'whatsapp', desde: Timestamp.now() });
    expect(delaCampana(await reclamar())).toHaveLength(1);
  });

  it.each([
    ['`noContactar` true', { noContactar: true }], ['`bloqueada` true', { bloqueada: true }], ['`noContactar` «true» (texto)', { noContactar: 'true' }],
    ['`noContactar` 1', { noContactar: 1 }], ['`noContactar` null', { noContactar: null }], ['`bloqueada` un mapa', { bloqueada: { x: 1 } }],
    ['`riesgoEn` una marca de tiempo', { riesgoEn: Timestamp.now() }], ['`riesgoEn` true', { riesgoEn: true }], ['`riesgoEn` null', { riesgoEn: null }],
  ])('NIEGA: %s deja `omitido/marcas` (la campaña cierra ante la duda)', async (_n, marcas) => {
    await siembraUna(() => db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).update(marcas));
    expect(delaCampana(await reclamar())).toEqual([]);
    await omitido(CONV(0), 'marcas');
    expect(await metricas()).toEqual({});
  });

  it('control: `noContactar`, `bloqueada` y `riesgoEn` en false o ausentes NO frenan', async () => {
    await siembraUna(() => db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).update({ noContactar: false, bloqueada: false, riesgoEn: false }));
    expect(delaCampana(await reclamar())).toHaveLength(1);
  });

  it('NIEGA: quien escribió hace menos de 24 h queda `omitido/reciente`; a las 25 h sí sale', async () => {
    await preparar({ n: 2 });
    await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).update({ ultimoEntranteEn: Timestamp.fromMillis(Date.now() - 23 * 60 * MIN) });
    await db.doc(`tenants/${A}/conversaciones/${CONV(1)}`).update({ ultimoEntranteEn: Timestamp.fromMillis(Date.now() - 25 * 60 * MIN) });
    const m = delaCampana(await reclamar());
    expect(m.map((x) => x.conversacionId)).toEqual([CONV(1)]);
    await omitido(CONV(0), 'reciente');
  });

  it('NIEGA: la ventana la aplica el SERVIDOR con `ventanaDias` de la configuración: fuera de ella queda `omitido/fueraDeVentana`, dentro sale', async () => {
    await preparar({ n: 3 });
    await refDest(CONV(0)).update({ fechaBase: Timestamp.fromMillis(Date.now() - 61 * DIA) });
    await refDest(CONV(1)).update({ fechaBase: Timestamp.fromMillis(Date.now() - 59 * DIA) });
    await refDest(CONV(2)).update({ fechaBase: Timestamp.fromMillis(Date.now() - 62 * DIA) });
    expect(delaCampana(await reclamar()).map((x) => x.conversacionId)).toEqual([CONV(1)]);
    await omitido(CONV(0), 'fueraDeVentana');
    await omitido(CONV(2), 'fueraDeVentana');
  });

  it('NIEGA: la cifra sale de la configuración, no de un literal: con `ventanaDias` 1 una fecha de hace 2 días queda `fueraDeVentana`', async () => {
    await preparar({ n: 1, config: { ...CONFIG, ventanaDias: 1 } });
    expect(delaCampana(await reclamar())).toEqual([]);
    await omitido(CONV(0), 'fueraDeVentana');
  });

  it('NIEGA: un destinatario SIN fecha base, con una ilegible o futura queda `omitido/sinFechaBase` (falla cerrada)', async () => {
    await preparar({ n: 4 });
    await refDest(CONV(0)).set({ estado: 'pendiente' });
    await refDest(CONV(1)).set({ estado: 'pendiente', fechaBase: 'ayer' });
    await refDest(CONV(2)).set({ estado: 'pendiente', fechaBase: Timestamp.fromMillis(Date.now() + 3 * DIA) });
    expect(delaCampana(await reclamar()).map((x) => x.conversacionId)).toEqual([CONV(3)]);
    for (const i of [0, 1, 2]) await omitido(CONV(i), 'sinFechaBase');
  });

  it('las omisiones por la ventana no consumen cupo ni cuentan', async () => {
    await preparar({ n: 5 });
    for (let i = 0; i < 2; i++) await refDest(CONV(i)).update({ fechaBase: Timestamp.fromMillis(Date.now() - 100 * DIA) });
    const m = delaCampana(await reclamar());
    expect(m.map((x) => x.conversacionId)).toEqual([CONV(2), CONV(3), CONV(4)]);
    expect(await campana()).toMatchObject({ materializados: 3, tanda: { usados: 3 } });
  });

  it('NIEGA: sin conversación, o sin `ultimoEntranteEn` legible, queda `omitido/sinConversacion`', async () => {
    await preparar({ n: 3 });
    await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).delete();
    await db.doc(`tenants/${A}/conversaciones/${CONV(1)}`).update({ ultimoEntranteEn: 'ayer' });
    await db.doc(`tenants/${A}/conversaciones/${CONV(2)}`).update({ ultimoEntranteEn: FieldValue.delete() });
    expect(delaCampana(await reclamar())).toEqual([]);
    for (let i = 0; i < 3; i++) await omitido(CONV(i), 'sinConversacion');
  });

  it('NIEGA: una conversación de otra línea queda `omitido/otraLinea`; la de la misma línea sale', async () => {
    await preparar({ n: 2 });
    await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).update({ phoneNumberId: '1000009999' });
    await db.doc(`tenants/${A}/conversaciones/${CONV(1)}`).update({ phoneNumberId: NUM_A });
    expect(delaCampana(await reclamar()).map((x) => x.conversacionId)).toEqual([CONV(1)]);
    await omitido(CONV(0), 'otraLinea');
  });

  it('NIEGA: los ids `wa_+591…` y `591…` (sin la forma `wa_<dígitos>`) quedan `omitido/idInvalido` y no se leen conversaciones con ellos', async () => {
    await preparar({ n: 1 });
    await refDest('wa_+59171234567').set({ estado: 'pendiente', fechaBase: baseDentro() });
    await refDest('59171234567').set({ estado: 'pendiente', fechaBase: baseDentro() });
    await refDest('wa_5917123').set({ estado: 'pendiente', fechaBase: baseDentro() });
    const m = delaCampana(await reclamar());
    expect(m.map((x) => x.conversacionId)).toEqual([CONV(0)]);
    for (const id of ['wa_+59171234567', '59171234567', 'wa_5917123']) expect(await dest(id)).toMatchObject({ estado: 'omitido', motivo: 'idInvalido' });
    expect(await todosLosMensajes()).toBe(1);
  });

  it('las omisiones NO consumen cupo ni cuentan: 3 omitidos al frente y 3 buenos salen en la MISMA vuelta, con `usados` 3', async () => {
    await preparar({ n: 6 });
    for (let i = 0; i < 3; i++) await db.doc(`tenants/${A}/bajas/${CONV(i)}`).set({ canal: 'whatsapp', desde: Timestamp.now() });
    const m = delaCampana(await reclamar());
    expect(m.map((x) => x.conversacionId)).toEqual([CONV(3), CONV(4), CONV(5)]);
    for (let i = 0; i < 3; i++) await omitido(CONV(i), 'baja');
    expect(await campana()).toMatchObject({ materializados: 3, tanda: { usados: 3 } });
    expect((await refContador().get()).data()).toMatchObject({ nDia: 3 });
  });

  it('un contacto omitido no se vuelve a mirar (ya no está `pendiente`): 2 reclamos no cambian su motivo', async () => {
    await siembraUna(() => db.doc(`tenants/${A}/bajas/${CONV(0)}`).set({ canal: 'whatsapp', desde: Timestamp.now() }));
    await reclamar();
    const antes = await dest(CONV(0));
    await reclamar();
    expect(await dest(CONV(0))).toEqual(antes);
  });
});

// ===========================================================================
describe('la excepción de la prueba (PR-C, 27/11/2026): solo `prueba: true`, UN destinatario, y su número en `telefonosDePrueba`', () => {
  // Números ficticios evidentes (CONV(0) = wa_59171001000).
  const TEL0 = CONV(0).slice(3);
  const OTRO = '59170000999';
  const CON_LISTA = { ...CONFIG, telefonosDePrueba: [TEL0, OTRO] };
  const omitido = async (conv: string, motivo: string) => expect(await dest(conv)).toMatchObject({ estado: 'omitido', motivo });
  const prueba = (o: Opciones = {}): Opciones => ({ n: 1, config: CON_LISTA, ...o, campana: { prueba: true, total: 1, ...(o.campana ?? {}) } });
  const rechazada = async (motivo: string) => {
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toMatchObject({ estado: 'pausada', motivoPausa: motivo, materializados: 0 });
    expect(await todosLosMensajes()).toBe(0);
    expect(await dest(CONV(0))).toMatchObject({ estado: 'pendiente' });
    expect((await refContador().get()).exists).toBe(false);
    expect(delaCampana(await reclamar())).toEqual([]); // ya pausada: no vuelve a salir ni a escribir
  };

  it('PRUEBA: quien escribió hace 1 minuto (24 h) y tiene la fecha base fuera de la ventana SALE, y el mensaje queda registrado', async () => {
    await preparar(prueba({ ultimoEntrante: MIN }));
    await refDest(CONV(0)).update({ fechaBase: Timestamp.fromMillis(Date.now() - 400 * DIA) });
    const m = delaCampana(await reclamar());
    expect(m.map((x) => x.conversacionId)).toEqual([CONV(0)]);
    expect(await dest(CONV(0))).toMatchObject({ estado: 'enviado' });
    expect(await mensaje(CONV(0), claveDe(CONV(0)))).toMatchObject({ autor: 'campana', estadoEnvio: 'enviando', campanaId: CAMPANA });
    expect(await campana()).toMatchObject({ materializados: 1, tanda: { usados: 1 } });
  });

  it('PRUEBA: SIN conversación y SIN fecha base sale igual (el servidor no crea la conversación) y su confirmación se cuenta', async () => {
    await preparar(prueba());
    await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).delete();
    await refDest(CONV(0)).set({ estado: 'pendiente' });
    const m = delaCampana(await reclamar());
    expect(m.map((x) => x.conversacionId)).toEqual([CONV(0)]);
    expect((await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).get()).exists).toBe(false);
    expect((await resolver(m[0]!)).codigo).toBe(200);
    expect(await campana()).toMatchObject({ aceptados: 1 });
  });

  it('NIEGA: la excepción NO levanta la baja, las marcas, la otra línea ni los topes', async () => {
    await preparar(prueba());
    await db.doc(`tenants/${A}/bajas/${CONV(0)}`).set({ canal: 'whatsapp', desde: Timestamp.now() });
    expect(delaCampana(await reclamar())).toEqual([]);
    await omitido(CONV(0), 'baja');
    for (const [marca, valor, motivo] of [['noContactar', true, 'marcas'], ['bloqueada', true, 'marcas'], ['riesgoEn', Timestamp.now(), 'marcas'], ['phoneNumberId', '1000009999', 'otraLinea']] as const) {
      await db.recursiveDelete(db.doc(`tenants/${A}/bajas/${CONV(0)}`));
      await refDest(CONV(0)).set({ estado: 'pendiente' });
      await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).set({ telefono: TEL0, canal: 'whatsapp', ultimoEntranteEn: Timestamp.fromMillis(Date.now() - MIN), [marca]: valor });
      expect(delaCampana(await reclamar())).toEqual([]);
      await omitido(CONV(0), motivo);
    }
    expect(await todosLosMensajes()).toBe(0);
  });

  it('NIEGA: el tope diario, la tanda agotada y un mensaje en vuelo siguen frenando la prueba', async () => {
    await preparar(prueba());
    await refContador().set({ dia: hoy(), nDia: CONFIG.porDia, actualizadoEn: Timestamp.now() });
    expect(delaCampana(await reclamar())).toEqual([]);
    await refContador().delete();
    await refCampana().update({ tanda: { id: 't1', cupo: 1, usados: 1, calidad: 'VERDE' } });
    expect(delaCampana(await reclamar())).toEqual([]);
    await refCampana().update({ tanda: { id: 't1', cupo: 5, usados: 0, calidad: 'VERDE' }, materializados: 1 });
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await todosLosMensajes()).toBe(0);
  });

  it('NIEGA: más de un destinatario rechaza la campaña ENTERA (pausada, motivo propio) aunque todos estén en la lista', async () => {
    await preparar(prueba({ n: 2, config: { ...CONFIG, telefonosDePrueba: [TEL0, CONV(1).slice(3)] }, campana: { total: 2 } }));
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toMatchObject({ estado: 'pausada', motivoPausa: 'pruebaVariosDestinatarios', materializados: 0 });
    expect(await todosLosMensajes()).toBe(0);
    expect(await dest(CONV(0))).toMatchObject({ estado: 'pendiente' });
    expect(await dest(CONV(1))).toMatchObject({ estado: 'pendiente' });
  });

  it('NIEGA: un destinatario ya enviado cuenta: una campaña de prueba con 2 destinatarios, uno ya `enviado`, sigue rechazada', async () => {
    await preparar(prueba({ n: 2, campana: { total: 2 } }));
    await refDest(CONV(1)).update({ estado: 'enviado' });
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toMatchObject({ estado: 'pausada', motivoPausa: 'pruebaVariosDestinatarios' });
  });

  it('NIEGA: el número no está en la lista -> rechazada entera', async () => {
    await preparar(prueba({ config: { ...CONFIG, telefonosDePrueba: [OTRO] } }));
    await rechazada('pruebaFueraDeLista');
  });

  it.each([
    ['sin el campo', CONFIG], ['lista vacía', { ...CONFIG, telefonosDePrueba: [] }], ['no es una lista', { ...CONFIG, telefonosDePrueba: TEL0 }],
    ['con más de 5', { ...CONFIG, telefonosDePrueba: [TEL0, '59170000001', '59170000002', '59170000003', '59170000004', '59170000005'] }],
    ['con un elemento que no son dígitos', { ...CONFIG, telefonosDePrueba: [TEL0, '+59170000001'] }],
    ['con un elemento numérico', { ...CONFIG, telefonosDePrueba: [Number(TEL0)] }],
    ['con repetidos', { ...CONFIG, telefonosDePrueba: [TEL0, TEL0] }],
  ])('NIEGA: la lista %s -> rechazada entera (falla cerrada)', async (_n, config) => {
    await preparar(prueba({ config: JSON.parse(JSON.stringify(config)) }));
    await rechazada('pruebaSinLista');
  });

  it('NIEGA: `prueba` que no es un booleano (la cadena «true») no sale ni escribe: ilegible = cerrada', async () => {
    await preparar(prueba({ campana: { prueba: 'true' } }));
    const antes = await campana();
    expect(delaCampana(await reclamar())).toEqual([]);
    expect(await campana()).toEqual(antes);
    expect(await todosLosMensajes()).toBe(0);
  });

  it.each([['`prueba: false`', true], ['sin el campo `prueba`', false]])(
    'REAL (%s): con el número EN la lista, las exclusiones de 24 h, sin conversación, ventana y fecha base siguen rigiendo', async (_n, conFalse) => {
      await preparar({ n: 4, config: { ...CONFIG, telefonosDePrueba: [CONV(0).slice(3), CONV(1).slice(3), CONV(2).slice(3), CONV(3).slice(3)] } });
      if (!conFalse) await refCampana().update({ prueba: FieldValue.delete() });
      await db.doc(`tenants/${A}/conversaciones/${CONV(0)}`).update({ ultimoEntranteEn: Timestamp.fromMillis(Date.now() - MIN) });
      await db.doc(`tenants/${A}/conversaciones/${CONV(1)}`).delete();
      await refDest(CONV(2)).update({ fechaBase: Timestamp.fromMillis(Date.now() - 400 * DIA) });
      await refDest(CONV(3)).update({ fechaBase: FieldValue.delete() });
      expect(delaCampana(await reclamar())).toEqual([]);
      await omitido(CONV(0), 'reciente');
      await omitido(CONV(1), 'sinConversacion');
      await omitido(CONV(2), 'fueraDeVentana');
      await omitido(CONV(3), 'sinFechaBase');
      expect(await campana()).toMatchObject({ estado: 'enCurso', materializados: 0 });
      expect(await todosLosMensajes()).toBe(0);
    });

  it('REAL: con varios destinatarios y la lista cargada NO se pausa ni se rechaza: la regla de «un solo destinatario» es solo de la prueba', async () => {
    await preparar({ n: 4, config: { ...CONFIG, telefonosDePrueba: [CONV(0).slice(3)] } });
    expect(delaCampana(await reclamar())).toHaveLength(3);
    expect(await campana()).toMatchObject({ estado: 'enCurso' });
  });

  it('REAL: sin `telefonosDePrueba` en la configuración nada cambia (el control de las negativas anteriores)', async () => {
    await preparar({ n: 2 });
    expect(delaCampana(await reclamar())).toHaveLength(2);
  });

  it('el motivo de la pausa y el resto de lo que escribe el servidor no contienen el teléfono completo', async () => {
    await preparar(prueba({ config: { ...CONFIG, telefonosDePrueba: [OTRO] } }));
    await reclamar();
    expect(JSON.stringify(await campana())).not.toContain(TEL0);
    expect(JSON.stringify(await campana())).not.toContain(OTRO);
  });
});
