/**
 * =============================================================================
 * H1-6, REVERSIÓN HACIA ADELANTE: la ingesta vuelve a ser la de main
 * =============================================================================
 *
 * Esta suite vive SOLO en la rama `core/h1-6-reversion` (nunca se fusiona con
 * H1-6 en main a la vez). Es `ingesta-conversaciones.test.ts` dada vuelta: con los
 * tres `...spread` de la ingesta fuera, la Function `ingesta` NO escribe ningún
 * campo derivado (ni en la conversación ni en el mensaje) y todo lo demás es lo
 * de siempre: claves de la respuesta, contadores de facturación y operaciones de
 * la transacción. Los valores de referencia son los capturados contra main.
 *
 * Puertos del emulador propios: 8311 / 9231.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8311'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias de esta suite: 05, 06 y 07. Cada suite fija su propio valor al cargarse y las suites corren
// una por una (`fileParallelism: false`), así que aunque otra suite use el mismo alias no se pisan.
// Valores de prueba, no secretos.
const TOKENES = { a: 'valor-de-prueba-ing-conv-a', b: 'valor-de-prueba-ing-conv-b', bel: 'valor-de-prueba-ing-conv-bel' };
process.env['INGESTA_CLIENTE05'] = TOKENES.a;
process.env['INGESTA_CLIENTE06'] = TOKENES.b;
process.env['INGESTA_CLIENTE07'] = TOKENES.bel;

// Se llama a la Function por el punto de entrada (`index.ts`), como la llamaría la red:
// una prueba de Core no importa el coordinador (ingesta.ts) ni a Central. Por lo mismo,
// el período de Bolivia y la copia de límites del plan se escriben acá en vez de importarse.
// index.ts inicializa la app por defecto al cargarse, como en producción.
const { ingesta } = await import('../../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const aqui = dirname(fileURLToPath(import.meta.url));
/** El mes de Bolivia (UTC-4 fijo) de un instante, 'aaaa-mm'. */
const mesBolivia = (ms: number): string => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 7);
const periodoAnterior = (p: string): string => {
  const [a, m] = p.split('-').map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
/** Copia de límites del plan «crecimiento» en la cuenta (alcanza con que sea válida). */
const limitesDe = (_plan: string) => ({ conversaciones: 500, productos: 100, agendas: 2, cambiosIncluidos: 10 });
const HORA = 3_600_000;
const MENSAJE_ID = /^[A-Za-z0-9]{20}$/; // el mismo que exige `buscarConversaciones`

interface Comercio { id: string; numero: string; alias: string; token: string }
const A: Comercio = { id: 'ing-conv-a', numero: '1000000611', alias: 'cliente05', token: TOKENES.a };
const B: Comercio = { id: 'ing-conv-b', numero: '1000000612', alias: 'cliente06', token: TOKENES.b };
// El comercio de Bellido: mismo código, mismos campos. No hay nada de Bellido en
// el Core; este comercio prueba que no hace falta una excepción.
const BEL: Comercio = { id: 'ing-conv-bellido', numero: '1000000613', alias: 'cliente07', token: TOKENES.bel };

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function reportar(c: Comercio, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': c.numero, authorization: `Bearer ${c.token}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(cod: number) { r.codigo = cod; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (ingesta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const entrante = (c: Comercio, telefono: string, texto = 'hola, quiero reservar una mesa', extra: Record<string, unknown> = {}) =>
  reportar(c, { telefono, direccion: 'entrante', tipo: 'text', texto, ...extra });
const saliente = (c: Comercio, telefono: string, texto = 'con gusto, le ayudo', extra: Record<string, unknown> = {}) =>
  reportar(c, { telefono, direccion: 'saliente', tipo: 'text', texto, ...extra });

type Datos = Record<string, unknown>;
const conversacion = async (c: Comercio, tel: string): Promise<Datos> =>
  (await db.doc(`tenants/${c.id}/conversaciones/wa_${tel}`).get()).data() ?? {};
const mensajes = async (c: Comercio, tel: string) =>
  (await db.collection(`tenants/${c.id}/conversaciones/wa_${tel}/mensajes`).get()).docs;
const MES = () => new Date().toISOString().slice(0, 7);
const metricas = async (c: Comercio): Promise<Datos> =>
  (await db.doc(`tenants/${c.id}/metricas/${MES()}`).get()).data() ?? {};
const ms = (v: unknown): number => (v as { toMillis: () => number }).toMillis();

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

// --- Operaciones de la transacción, contadas por un proxy sobre `runTransaction`.
// Solo cuenta el ÚLTIMO intento (el que se confirma): un reintento por choque
// vuelve a correr la función completa y no debe contarse dos veces.
interface Operacion { op: string; ruta: string }
let intento: Operacion[] = [];
let ultimo: Operacion[] = [];
const normalizar = (ruta: string) => ruta
  .replace(/^tenants\/[^/]+/, 'tenants/<T>')
  .replace(/wa_\d+/g, 'wa_<tel>')
  .replace(/(mensajes|auditoria)\/[^/]+$/, '$1/<id>')
  .replace(/metricas\/\d{4}-\d{2}$/, 'metricas/<periodo>');
function contarTransacciones() {
  const original = db.runTransaction.bind(db) as (f: (tx: unknown) => Promise<unknown>, o?: unknown) => Promise<unknown>;
  return vi.spyOn(db, 'runTransaction').mockImplementation(((f: (tx: unknown) => Promise<unknown>, o?: unknown) =>
    original(async (tx) => {
      intento = [];
      const proxy = new Proxy(tx as object, {
        get(objetivo, prop, receptor) {
          const valor = Reflect.get(objetivo, prop, receptor);
          if (typeof valor !== 'function') return valor;
          return (...args: unknown[]) => {
            if (['get', 'set', 'create', 'update', 'delete'].includes(String(prop))) {
              const ref = args[0] as { path?: string };
              intento.push({ op: String(prop), ruta: normalizar(ref.path ?? '?') });
            }
            return (valor as (...a: unknown[]) => unknown).apply(objetivo, args);
          };
        },
      });
      try { return await f(proxy); } finally { ultimo = intento; }
    }, o)) as unknown as typeof db.runTransaction);
}

beforeAll(async () => {
  for (const c of [A, B, BEL]) {
    await limpiar(c);
    await db.doc(`rutasWhatsApp/${c.numero}`).set({
      tenantId: c.id, flujo: 'agendamiento', aliasSecreto: c.alias, estado: 'activo',
    });
    await db.doc(`tenants/${c.id}`).set({ nombre: `Comercio ${c.id}`, estado: 'activo', plan: 'pro' });
    await cuentaAlDia(c);
  }
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await db.doc('plataforma/prepago').delete();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  for (const c of [A, B, BEL]) { await limpiar(c); await cuentaAlDia(c); }
});


const DERIVADOS_CONVERSACION = ['telefonoTrozos', 'nombrePalabras', 'ultimoEntranteEn', 'ventanaVenceEn', 'noLeidos', 'sinLeer'];

describe('sin los tres spread, la ingesta no escribe ningún derivado', () => {
  it('entrante, saliente y corte: la conversación y el mensaje quedan como en main', async () => {
    await entrante(A, '5910000001234', 'hola, quiero reservar', { nombreContacto: 'María Pérez' });
    await saliente(A, '5910000001234');
    const c = await conversacion(A, '5910000001234');
    for (const campo of DERIVADOS_CONVERSACION) expect(Object.keys(c), campo).not.toContain(campo);
    expect(c).toMatchObject({ telefono: '5910000001234', mensajesTotal: 2, nombreContacto: 'María Pérez' });
    for (const d of await mensajes(A, '5910000001234')) {
      expect(Object.keys(d.data()), d.id).not.toContain('tenantId');
      expect(Object.keys(d.data()), d.id).not.toContain('palabras');
      expect(d.id).toMatch(MENSAJE_ID);
    }

    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${B.id}/cuenta/estado`).set({
      modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'),
      periodoPagado: periodoAnterior(periodoAnterior(mesBolivia(Date.now()))), corteActivo: true,
    });
    const r = await entrante(B, '5910000005001', 'necesito una mesa', { nombreContacto: 'Ana Rojas' });
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'cortado' });
    const cc = await conversacion(B, '5910000005001');
    for (const campo of DERIVADOS_CONVERSACION) expect(Object.keys(cc), campo).not.toContain(campo);
    const [m] = await mensajes(B, '5910000005001');
    expect(Object.keys(m!.data()).sort()).toEqual(['direccion', 'texto', 'tipo', 'ts']);
  });

  it('el comercio de Bellido, igual', async () => {
    await entrante(BEL, '5910000006301', 'consulta de turno', { nombreContacto: 'Luis Mamani' });
    const c = await conversacion(BEL, '5910000006301');
    for (const campo of DERIVADOS_CONVERSACION) expect(Object.keys(c), campo).not.toContain(campo);
  });
});

describe('y todo lo demás es lo de siempre', () => {
  it('la respuesta tiene exactamente las claves de siempre', async () => {
    const e = await entrante(A, '5910000006001');
    const s = await saliente(A, '5910000006001');
    expect(Object.keys(e.cuerpo).sort()).toEqual(CLAVES_RESPUESTA.demostracion);
    expect(Object.keys(s.cuerpo).sort()).toEqual(CLAVES_RESPUESTA.demostracion);
    expect(Object.keys(e.cuerpo['atencion'] as object).sort()).toEqual(CLAVES_ATENCION);
  });

  it('los contadores de facturación son los de main', async () => {
    for (const c of [A, BEL]) {
      await entrante(c, '5910000006101');
      await saliente(c, '5910000006101');
      await entrante(c, '5910000006101');
      await entrante(c, '5910000006102');
      expect(pick(await conversacion(c, '5910000006101'), CAMPOS_FACTURACION_CONVERSACION))
        .toEqual({ ...FACTURACION_CONVERSACION, periodoContado: MES() });
      expect(pick(await metricas(c), CAMPOS_FACTURACION_METRICAS)).toEqual(FACTURACION_METRICAS);
    }
  });

  it('las operaciones de la transacción son las de main', async () => {
    contarTransacciones();
    await entrante(A, '5910000006201', 'hola, quiero reservar', { nombreContacto: 'Rosa Vega' });
    expect(ultimo).toEqual(OPERACIONES.entrante);
    await saliente(A, '5910000006201');
    expect(ultimo).toEqual(OPERACIONES.saliente);
  });
});

// --- Valores de referencia (capturados corriendo esta suite contra la ingesta de main) ---
const pick = (o: Datos, campos: readonly string[]): Datos =>
  Object.fromEntries(campos.filter((k) => k in o).map((k) => [k, o[k]]));

const CLAVES_ATENCION = ['bloque', 'estado', 'mensajeFijo', 'respuestasEnVentana', 'restanDelBloque', 'umbrales', 'ventanaVenceEn'];
const CLAVES_SERVICIO = ['estado', 'fase', 'graciaHasta', 'motivo'];
const CLAVES_RESPUESTA = {
  demostracion: ['atencion', 'avisarRecepcion'],
  conModalidad: ['atencion', 'avisarRecepcion', 'servicio'],
  cortado: ['atencion', 'avisarRecepcion', 'servicio'],
};
const CAMPOS_FACTURACION_CONVERSACION = [
  'mensajesTotal', 'respuestasDelPeriodo', 'mensajesVentana', 'periodoContado', 'periodoInteraccion', 'atencionEstado', 'origen',
] as const;
// (`periodoContado` es el mes en curso y se agrega al comparar.)
const FACTURACION_CONVERSACION: Datos = { mensajesTotal: 3, respuestasDelPeriodo: 1, mensajesVentana: 1, atencionEstado: 'normal', origen: 'directo' };
const CAMPOS_FACTURACION_METRICAS = [
  'mensajes', 'entrantes', 'conversaciones', 'personasAtendidas', 'interacciones', 'bloquesAdicionales',
] as const;
const FACTURACION_METRICAS: Datos = { mensajes: 4, entrantes: 3, conversaciones: 2, personasAtendidas: 2 };
const OPERACIONES: Record<'entrante' | 'saliente' | 'cortado', Operacion[]> = {
  entrante: [
  { op: 'get', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
  { op: 'get', ruta: 'tenants/<T>/cuenta/estado' },
  { op: 'get', ruta: 'plataforma/prepago' },
  { op: 'get', ruta: 'tenants/<T>/metricas/<periodo>' },
  { op: 'set', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
  { op: 'create', ruta: 'tenants/<T>/conversaciones/wa_<tel>/mensajes/<id>' },
  { op: 'set', ruta: 'tenants/<T>/metricas/<periodo>' },
],
  saliente: [
  { op: 'get', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
  { op: 'get', ruta: 'tenants/<T>/cuenta/estado' },
  { op: 'get', ruta: 'plataforma/prepago' },
  { op: 'set', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
  { op: 'create', ruta: 'tenants/<T>/conversaciones/wa_<tel>/mensajes/<id>' },
  { op: 'set', ruta: 'tenants/<T>/metricas/<periodo>' },
],
  // Dos `set` de la conversación: el de `corteVisto` (de siempre) y el que lleva los derivados.
  cortado: [
  { op: 'get', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
  { op: 'get', ruta: 'tenants/<T>/cuenta/estado' },
  { op: 'get', ruta: 'plataforma/prepago' },
  { op: 'get', ruta: 'tenants/<T>/metricas/<periodo>' },
  { op: 'set', ruta: 'tenants/<T>/cuenta/estado' },
  { op: 'create', ruta: 'tenants/<T>/auditoria/<id>' },
  { op: 'set', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
  { op: 'set', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
  { op: 'create', ruta: 'tenants/<T>/conversaciones/wa_<tel>/mensajes/<id>' },
],
};
