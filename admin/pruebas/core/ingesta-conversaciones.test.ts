/**
 * =============================================================================
 * H1-6: LA INGESTA ESCRIBE LOS CAMPOS DERIVADOS DE CONVERSACIONES, DE PUNTA A PUNTA
 * =============================================================================
 *
 * La función `ingesta` REAL, con su transacción, contra el emulador de
 * Firestore. Lo que se sostiene:
 *
 *  1. Un ENTRANTE sube `noLeidos` (de a uno), marca `sinLeer` y mueve la ventana
 *     de 24 h (`ultimoEntranteEn` y `ventanaVenceEn`, del MISMO instante). Un
 *     SALIENTE no mueve ninguno de los cuatro: contestar no es «leer» ni renueva
 *     la ventana de Meta. Los dos dejan los trozos del teléfono y las palabras
 *     del nombre. Lo mismo en la rama de CORTE.
 *  2. El mensaje lleva `tenantId` (el de la ruta, nunca el del cuerpo) y
 *     `palabras` (hasta 30, sin el texto completo; ausente si no hay texto).
 *  3. NADA MÁS CAMBIA: la respuesta a n8n conserva sus claves, los contadores
 *     de facturación son los de siempre, y la transacción hace las MISMAS
 *     lecturas y escrituras (los campos van en los create/set que ya existían).
 *     Cero mensajes por conversación: esta suite no envía nada.
 *  4. Con el comercio de Bellido incluido: los campos son del Core, iguales
 *     para todos (decisión P1), y no cambian lo que ve ningún flujo.
 *
 * SOBRE LOS DUPLICADOS. La ingesta NO deduplica por `idMeta`: cada POST guarda
 * un mensaje nuevo y suma `mensajesTotal`, `entrantes`, etc. (los repetidos los
 * descarta la entrada de n8n «entre ejecuciones», antes de llegar acá). Por eso
 * `noLeidos` sigue exactamente a `mensajesTotal`: nunca cuenta más que lo que
 * ya se cuenta para la facturación. Y un reintento de la TRANSACCIÓN (choque
 * entre mensajes simultáneos) tampoco suma dos veces: `increment` se aplica una
 * sola vez, al confirmar.
 *
 * Puertos del emulador propios de este PR: 8311 / 9231.
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

// =============================================================================
describe('entrante: no leídos, sinLeer y la ventana de 24 h', () => {
  it('el primero deja noLeidos 1, sinLeer, los dos instantes de la ventana (+24 h exactas), trozos y palabras del nombre', async () => {
    const antes = Date.now();
    const r = await entrante(A, '5910000001234', 'hola, quiero reservar', { nombreContacto: 'María Pérez' });
    const despues = Date.now();
    expect(r.codigo).toBe(200);

    const c = await conversacion(A, '5910000001234');
    expect(c['noLeidos']).toBe(1);
    expect(c['sinLeer']).toBe(true);
    const entrada = ms(c['ultimoEntranteEn']);
    expect(entrada).toBeGreaterThanOrEqual(antes);
    expect(entrada).toBeLessThanOrEqual(despues);
    // Los dos del MISMO `ahoraMs`: la consola nunca ve una ventana que no cuadra con su ancla.
    expect(ms(c['ventanaVenceEn'])).toBe(entrada + 24 * HORA);
    expect(c['telefonoTrozos']).toEqual(
      ['5910000001234', '910000001234', '10000001234', '0000001234', '000001234', '00001234',
        '0001234', '001234', '01234', '1234']);
    expect(c['nombrePalabras']).toEqual(['maria', 'perez']);
    // Lo de siempre sigue donde estaba.
    expect(c).toMatchObject({ telefono: '5910000001234', canal: 'whatsapp', nombreContacto: 'María Pérez', mensajesTotal: 1 });
  });

  it('cada entrante suma uno (nunca dos) y renueva la ventana; los instantes siguen siendo coherentes', async () => {
    await entrante(A, '5910000001235');
    const c1 = await conversacion(A, '5910000001235');
    await new Promise((f) => setTimeout(f, 15));
    await entrante(A, '5910000001235');
    await entrante(A, '5910000001235');
    const c3 = await conversacion(A, '5910000001235');
    expect(c3['noLeidos']).toBe(3);
    expect(c3['sinLeer']).toBe(true);
    expect(ms(c3['ultimoEntranteEn'])).toBeGreaterThan(ms(c1['ultimoEntranteEn']));
    expect(ms(c3['ventanaVenceEn'])).toBe(ms(c3['ultimoEntranteEn']) + 24 * HORA);
    // Y cuenta lo mismo que la facturación cuenta como mensajes de la conversación.
    expect(c3['mensajesTotal']).toBe(3);
  });
});

describe('saliente: contestar no es leer ni renueva la ventana', () => {
  it('en una conversación nueva (solo saliente) deja trozos y NINGÚN campo de lectura ni de ventana', async () => {
    await saliente(A, '5910000002001', 'hola, le escribimos del negocio', { nombreContacto: 'Juan Quispe' });
    const c = await conversacion(A, '5910000002001');
    expect(c['telefonoTrozos']).toContain('5910000002001');
    expect(c['nombrePalabras']).toEqual(['juan', 'quisp']);
    for (const campo of ['noLeidos', 'sinLeer', 'ultimoEntranteEn', 'ventanaVenceEn']) {
      expect(Object.keys(c), campo).not.toContain(campo);
    }
  });

  it('después de dos entrantes, un saliente no toca noLeidos, sinLeer ni la ventana (lo demás sí avanza)', async () => {
    await entrante(A, '5910000002002');
    await entrante(A, '5910000002002');
    const antes = await conversacion(A, '5910000002002');
    await new Promise((f) => setTimeout(f, 15));
    await saliente(A, '5910000002002', 'respuesta del asistente');
    const despues = await conversacion(A, '5910000002002');

    expect(despues['noLeidos']).toBe(2);
    expect(despues['sinLeer']).toBe(true);
    expect(ms(despues['ultimoEntranteEn'])).toBe(ms(antes['ultimoEntranteEn']));
    expect(ms(despues['ventanaVenceEn'])).toBe(ms(antes['ventanaVenceEn']));
    expect(despues['ultimoMensaje']).toBe('respuesta del asistente');
    expect(despues['mensajesTotal']).toBe(3);
  });

  it('un mensaje con dirección rara se trata como entrante en la ingesta (normalizar) y uno «saliente» exacto como saliente', async () => {
    // `normalizar` cierra la dirección a dos valores: cualquier cosa que no sea
    // exactamente «saliente» es «entrante» (comportamiento de siempre).
    await reportar(A, { telefono: '5910000002003', direccion: 'SALIENTE', tipo: 'text', texto: 'hola' });
    expect((await conversacion(A, '5910000002003'))['noLeidos']).toBe(1);
    await reportar(A, { telefono: '5910000002004', direccion: 'saliente', tipo: 'text', texto: 'hola' });
    expect((await conversacion(A, '5910000002004'))['noLeidos']).toBeUndefined();
    const m = await mensajes(A, '5910000002004');
    expect(m[0]!.get('direccion')).toBe('saliente');
  });
});

let contadorRaros = 0;
describe('el nombre del contacto y el reloj de la ventana', () => {
  it.each(['😀', 'Al', '李明'])('un contacto que pasa de «María Pérez» a «%s» (sin palabras buscables) pierde las palabras viejas', async (nuevo) => {
    await entrante(A, '5910000007001', 'hola', { nombreContacto: 'María Pérez' });
    expect((await conversacion(A, '5910000007001'))['nombrePalabras']).toEqual(['maria', 'perez']);
    await entrante(A, '5910000007001', 'hola otra vez', { nombreContacto: nuevo });
    const c = await conversacion(A, '5910000007001');
    expect(Object.keys(c)).not.toContain('nombrePalabras'); // borrado: igual que si nunca se hubiera escrito
    expect(c['nombreContacto']).toBe(nuevo);                // el nombre sí se actualiza (como siempre)
    expect(c['noLeidos']).toBe(2);
  });

  it('un mensaje SIN nombre no toca las palabras del nombre que ya había', async () => {
    await entrante(A, '5910000007002', 'hola', { nombreContacto: 'María Pérez' });
    await entrante(A, '5910000007002', 'hola otra vez');
    await saliente(A, '5910000007002');
    expect((await conversacion(A, '5910000007002'))['nombrePalabras']).toEqual(['maria', 'perez']);
  });

  it('el nombre nuevo sin palabras también borra en un saliente', async () => {
    await saliente(A, '5910000007003', 'hola', { nombreContacto: 'Luis Mamani' });
    await saliente(A, '5910000007003', 'hola', { nombreContacto: '😀' });
    expect(Object.keys(await conversacion(A, '5910000007003'))).not.toContain('nombrePalabras');
  });

  it('ultimoEntranteEn no retrocede si ya hay uno más nuevo (reintento de un choque); la ventana sale del mismo instante', async () => {
    const futuro = Date.now() + 60_000; // como si otro mensaje concurrente, más nuevo, ya hubiera confirmado (dentro del margen de 5 min)
    await db.doc(`tenants/${A.id}/conversaciones/wa_5910000007004`).set({
      telefono: '5910000007004', canal: 'whatsapp', ultimoEntranteEn: new Date(futuro),
    });
    await entrante(A, '5910000007004');
    const c = await conversacion(A, '5910000007004');
    expect(ms(c['ultimoEntranteEn'])).toBe(futuro);
    expect(ms(c['ventanaVenceEn'])).toBe(futuro + 24 * HORA);
    expect(c['noLeidos']).toBe(1);
  });

  it('un ultimoEntranteEn futuro por error (+1 día, más allá del margen de 5 min) se ignora: el reloj vuelve a ahoraMs', async () => {
    await db.doc(`tenants/${A.id}/conversaciones/wa_5910000007006`).set({
      telefono: '5910000007006', canal: 'whatsapp', ultimoEntranteEn: new Date(Date.now() + 24 * HORA),
    });
    const antes = Date.now();
    const r = await entrante(A, '5910000007006');
    const despues = Date.now();
    expect(r.codigo).toBe(200);
    const c = await conversacion(A, '5910000007006');
    expect(ms(c['ultimoEntranteEn'])).toBeGreaterThanOrEqual(antes);
    expect(ms(c['ultimoEntranteEn'])).toBeLessThanOrEqual(despues);
    expect(ms(c['ventanaVenceEn'])).toBe(ms(c['ultimoEntranteEn']) + 24 * HORA);
  });

  it.each([
    ['un mapa {toMillis: 5}', { toMillis: 5 }],
    ['un mapa {toMillis: "x"}', { toMillis: 'x' }],
    ['un texto', '2099-01-01'],
    ['un número enorme', 99_999_999_999_999],
    ['null', null],
    ['una lista', [1, 2]],
    ['un booleano', true],
  ])('un ultimoEntranteEn raro (%s) no tumba la ingesta: 200, mensaje guardado y reloj de ahora', async (_, raro) => {
    const tel = `5910000007${100 + (++contadorRaros)}`;
    await db.doc(`tenants/${A.id}/conversaciones/wa_${tel}`).set({ telefono: tel, canal: 'whatsapp', ultimoEntranteEn: raro });
    const antes = Date.now();
    const r = await entrante(A, tel, 'hola con previo raro');
    expect(r.codigo).toBe(200);
    expect(await mensajes(A, tel)).toHaveLength(1);
    const c = await conversacion(A, tel);
    expect(c['noLeidos']).toBe(1);
    expect(ms(c['ultimoEntranteEn'])).toBeGreaterThanOrEqual(antes);
  });

  it('sin ultimoEntranteEn previo (ausente) tampoco falla', async () => {
    const r = await entrante(A, '5910000007007');
    expect(r.codigo).toBe(200);
    expect((await conversacion(A, '5910000007007'))['noLeidos']).toBe(1);
  });

  it('con un ultimoEntranteEn viejo, el nuevo entrante sí lo avanza', async () => {
    const viejo = Date.now() - 5 * HORA;
    await db.doc(`tenants/${A.id}/conversaciones/wa_5910000007005`).set({
      telefono: '5910000007005', canal: 'whatsapp', ultimoEntranteEn: new Date(viejo),
    });
    const antes = Date.now();
    await entrante(A, '5910000007005');
    const c = await conversacion(A, '5910000007005');
    expect(ms(c['ultimoEntranteEn'])).toBeGreaterThanOrEqual(antes);
    expect(ms(c['ventanaVenceEn'])).toBe(ms(c['ultimoEntranteEn']) + 24 * HORA);
  });
});

// =============================================================================
describe('el mensaje: tenantId de la ruta, palabras y su id', () => {
  it('lleva tenantId y palabras (sin repetir y con raíz); el texto completo sigue siendo el de siempre', async () => {
    await entrante(A, '5910000003001', 'Quiero Alfajores, alfajor y chocolates!');
    const [m] = await mensajes(A, '5910000003001');
    expect(m!.get('tenantId')).toBe(A.id);
    expect(m!.get('palabras')).toEqual(['quiero', 'alfajor', 'chocolat']);
    expect(m!.get('texto')).toBe('Quiero Alfajores, alfajor y chocolates!');
    expect(m!.get('direccion')).toBe('entrante');
  });

  it('el id sigue siendo el automático: 20 caracteres alfanuméricos, aun cuando el mensaje trae idMeta', async () => {
    await entrante(A, '5910000003002', 'uno dos tres', { idMeta: 'wamid.PRUEBA-0001' });
    await entrante(A, '5910000003002', 'cuatro cinco seis');
    await saliente(A, '5910000003002', 'siete ocho nueve', { idMeta: 'wamid.OTRO-DISTINTO' });
    const docs = await mensajes(A, '5910000003002');
    expect(docs).toHaveLength(3);
    for (const d of docs) expect(d.id).toMatch(MENSAJE_ID);
    expect(new Set(docs.map((d) => d.id)).size).toBe(3);
    // `idMeta` se sigue guardando como dato (no como id).
    expect(docs.filter((d) => d.get('idMeta')).length).toBe(2);
  });

  it('el tenantId sale de la ruta autenticada: dos comercios no se mezclan y el cuerpo no lo pisa', async () => {
    // Un cuerpo malicioso intenta fijar el tenantId, las palabras y los campos de lectura.
    await entrante(A, '5910000003003', 'mensaje del comercio A', {
      tenantId: B.id, palabras: ['falso'], noLeidos: 99, sinLeer: false, ventanaVenceEn: '2099-01-01',
    });
    await entrante(B, '5910000003003', 'mensaje del comercio B');

    const deA = await mensajes(A, '5910000003003');
    const deB = await mensajes(B, '5910000003003');
    expect(deA).toHaveLength(1);
    expect(deB).toHaveLength(1);
    expect(deA[0]!.get('tenantId')).toBe(A.id);
    expect(deB[0]!.get('tenantId')).toBe(B.id);
    expect(deA[0]!.get('palabras')).toEqual(['mensaj', 'del', 'comercio']);
    const convA = await conversacion(A, '5910000003003');
    expect(convA['noLeidos']).toBe(1);
    expect(convA['sinLeer']).toBe(true);

    // Lo mismo, visto como lo ve la búsqueda: por tenantId + prefijo de la ruta.
    for (const c of [A, B]) {
      const grupo = await db.collectionGroup('mensajes').where('tenantId', '==', c.id).get();
      expect(grupo.size).toBeGreaterThan(0);
      for (const d of grupo.docs) expect(d.ref.path.startsWith(`tenants/${c.id}/conversaciones/`), d.ref.path).toBe(true);
    }
  });

  it('el comercio sale del código de la ingesta y se usa el MISMO identificador para la ruta y para el campo', () => {
    const fuente = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'ingesta.ts'), 'utf8');
    expect(fuente).toMatch(/camposDeMensajeIndexado\(mensaje\.texto, tenantId\)/);
    expect(fuente).toMatch(/db\.doc\(`tenants\/\$\{tenantId\}\/conversaciones\/\$\{idConversacion\}`\)/);
    expect(fuente).toContain('const { tenantId } = ruta;');
  });

  it('un texto largo se indexa con 30 palabras como máximo, cada una suelta, y el texto completo no se repite en ellas', async () => {
    const todas = Array.from({ length: 80 }, (_, i) => `palabra${String.fromCharCode(97 + (i % 26))}${i}x`);
    const texto = todas.join(' ');
    await entrante(A, '5910000003004', texto);
    const [m] = await mensajes(A, '5910000003004');
    const palabras = m!.get('palabras') as string[];
    expect(palabras).toHaveLength(30);
    expect(new Set(palabras).size).toBe(30);
    for (const p of palabras) expect(p).toMatch(/^[a-z0-9]{3,}$/); // una palabra, sin espacios
    // Las primeras 30 en orden de aparición; ni la 31 ni el texto entero.
    expect(palabras).toEqual(todas.slice(0, 30));
    expect(palabras).not.toContain(todas[30]);
    expect(palabras).not.toContain(texto);
    expect(m!.get('texto')).toBe(texto.slice(0, 4096));
  });

  it.each([
    ['una imagen sin texto', { tipo: 'image', texto: '' }],
    ['un audio sin texto', { tipo: 'audio', texto: '' }],
    ['un documento con texto de menos de 3 letras', { tipo: 'document', texto: 'ok si' }],
    ['un cuerpo sin campo texto', { tipo: 'image' }],
    ['4.096 «ⅷ» (NFKD los engorda a 16.384 letras: no es una palabra)', { tipo: 'text', texto: 'ⅷ'.repeat(4096) }],
  ])('%s: no rompe, queda el tenantId, NO hay palabras y el entrante cuenta como no leído', async (_, parte) => {
    const r = await reportar(A, { telefono: '5910000003005', direccion: 'entrante', ...parte });
    expect(r.codigo).toBe(200);
    const [m] = await mensajes(A, '5910000003005');
    expect(m!.get('tenantId')).toBe(A.id);
    expect(Object.keys(m!.data())).not.toContain('palabras');
    const c = await conversacion(A, '5910000003005');
    expect(c['noLeidos']).toBe(1);
    expect(c['sinLeer']).toBe(true);
  });
});

// =============================================================================
describe('duplicados y reintentos: nunca más no leídos que mensajes contados', () => {
  it('la ingesta no deduplica por idMeta (lo hace la entrada de n8n): un repetido cuenta como mensaje Y como no leído, igual que mensajesTotal y entrantes', async () => {
    const m = { idMeta: 'wamid.REPETIDO-001' };
    await entrante(A, '5910000004001', 'hola', m);
    await entrante(A, '5910000004001', 'hola', m);
    const c = await conversacion(A, '5910000004001');
    expect(await mensajes(A, '5910000004001')).toHaveLength(2);
    // La relación que importa: el no leído sigue al conteo de facturación, uno a uno.
    expect(c['noLeidos']).toBe(c['mensajesTotal']);
    expect(c['noLeidos']).toBe(2);
    expect((await metricas(A))['entrantes']).toBe(2);
  });

  it('mensajes simultáneos del mismo teléfono (la transacción se reintenta por choque): ni se pierde ni se duplica ninguno', async () => {
    const lote = await Promise.all(Array.from({ length: 4 }, (_, i) => entrante(A, '5910000004002', `mensaje simultaneo ${i}`)));
    expect(lote.map((r) => r.codigo)).toEqual([200, 200, 200, 200]);
    const c = await conversacion(A, '5910000004002');
    expect(c['noLeidos']).toBe(4);
    expect(c['mensajesTotal']).toBe(4);
    expect(await mensajes(A, '5910000004002')).toHaveLength(4);
    expect((await metricas(A))['entrantes']).toBe(4);
  });
});

// =============================================================================
describe('H2-3b: la conversación guarda la línea por la que escribió el cliente', () => {
  it('entrante y saliente dejan `phoneNumberId` = el de la ruta autenticada; el cuerpo no lo pisa y dos comercios no se mezclan', async () => {
    await entrante(A, '5910000007001', 'hola', { phoneNumberId: B.numero });
    expect((await conversacion(A, '5910000007001'))['phoneNumberId']).toBe(A.numero);
    await saliente(A, '5910000007001', 'con gusto', { phoneNumberId: B.numero });
    expect((await conversacion(A, '5910000007001'))['phoneNumberId']).toBe(A.numero);
    await entrante(B, '5910000007001', 'hola');
    expect((await conversacion(B, '5910000007001'))['phoneNumberId']).toBe(B.numero);
    expect((await conversacion(A, '5910000007001'))['phoneNumberId']).toBe(A.numero);
  });

  it('en la rama de corte también se guarda, y siguen siendo los mismos tx.set (cero escrituras extra)', async () => {
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set({
      modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'),
      periodoPagado: periodoAnterior(periodoAnterior(mesBolivia(Date.now()))), corteActivo: true,
    });
    const r = await entrante(A, '5910000007002', 'necesito una mesa');
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'cortado' });
    expect((await conversacion(A, '5910000007002'))['phoneNumberId']).toBe(A.numero);
  });
});

describe('la rama de corte también escribe los derivados', () => {
  const VENCIDA = () => ({
    modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'),
    periodoPagado: periodoAnterior(periodoAnterior(mesBolivia(Date.now()))), corteActivo: true,
  });

  it('un entrante cortado deja noLeidos, sinLeer, ventana, trozos y el mensaje con tenantId y palabras; la facturación no se mueve', async () => {
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set(VENCIDA());

    const antes = Date.now();
    const r = await entrante(A, '5910000005001', 'necesito una mesa', { nombreContacto: 'Ana Rojas' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'cortado' });

    const c = await conversacion(A, '5910000005001');
    expect(c['noLeidos']).toBe(1);
    expect(c['sinLeer']).toBe(true);
    expect(ms(c['ultimoEntranteEn'])).toBeGreaterThanOrEqual(antes);
    expect(ms(c['ventanaVenceEn'])).toBe(ms(c['ultimoEntranteEn']) + 24 * HORA);
    expect(c['telefonoTrozos']).toContain('5910000005001');
    expect(c['nombrePalabras']).toEqual(['ana', 'roja']);
    // Ningún contador de facturación: ni ventana de atención, ni mensajesTotal, ni métricas.
    for (const campo of ['atencionDesde', 'mensajesTotal', 'mensajesVentana', 'periodoContado', 'respuestasDelPeriodo']) {
      expect(Object.keys(c), campo).not.toContain(campo);
    }
    expect(await metricas(A)).toEqual({});

    const [m] = await mensajes(A, '5910000005001');
    expect(m!.get('tenantId')).toBe(A.id);
    expect(m!.get('palabras')).toEqual(['necesito', 'una', 'mesa']);
    expect(m!.id).toMatch(MENSAJE_ID);
  });

  it('en la rama de corte, un nombre nuevo sin palabras también borra el viejo; el reloj tampoco retrocede', async () => {
    await entrante(A, '5910000005003', 'hola', { nombreContacto: 'Ana Rojas' });
    const futuro = Date.now() + 60_000;
    await db.doc(`tenants/${A.id}/conversaciones/wa_5910000005003`).set({ ultimoEntranteEn: new Date(futuro) }, { merge: true });
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set(VENCIDA());
    const r = await entrante(A, '5910000005003', 'hola', { nombreContacto: '😀' });
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'cortado' });
    const c = await conversacion(A, '5910000005003');
    expect(Object.keys(c)).not.toContain('nombrePalabras');
    expect(ms(c['ultimoEntranteEn'])).toBe(futuro);
    expect(c['noLeidos']).toBe(2);
  });

  it('un saliente cortado deja los trozos y nada de lectura ni de ventana', async () => {
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set(VENCIDA());
    await entrante(A, '5910000005002');
    const antes = await conversacion(A, '5910000005002');
    await saliente(A, '5910000005002', 'respuesta cortada');
    const c = await conversacion(A, '5910000005002');
    expect(c['noLeidos']).toBe(1);
    expect(ms(c['ultimoEntranteEn'])).toBe(ms(antes['ultimoEntranteEn']));
    expect(ms(c['ventanaVenceEn'])).toBe(ms(antes['ventanaVenceEn']));
    expect(c['telefonoTrozos']).toContain('5910000005002');
  });
});

// =============================================================================
describe('lo que NO cambia: respuesta a n8n, facturación y operaciones', () => {
  // Las claves, los contadores y las operaciones de abajo se fijaron corriendo
  // esta misma prueba contra la ingesta de main (sin H1-6) y siguen siendo los mismos.

  it('la respuesta tiene exactamente las claves de siempre (entrante, saliente y cortado)', async () => {
    const e = await entrante(A, '5910000006001');
    const s = await saliente(A, '5910000006001');
    expect(Object.keys(e.cuerpo).sort()).toEqual(CLAVES_RESPUESTA.demostracion);
    expect(Object.keys(s.cuerpo).sort()).toEqual(CLAVES_RESPUESTA.demostracion);
    expect(Object.keys(e.cuerpo['atencion'] as object).sort()).toEqual(CLAVES_ATENCION);

    // Con modalidad (prepago al día) viaja además `servicio`.
    await db.doc(`tenants/${B.id}/cuenta/estado`).set({
      modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'),
      periodoPagado: mesBolivia(Date.now()), avisoConsumo: { mes: MES() },
    });
    const p = await entrante(B, '5910000006002');
    expect(Object.keys(p.cuerpo).sort()).toEqual(CLAVES_RESPUESTA.conModalidad);
    expect(Object.keys(p.cuerpo['servicio'] as object).sort()).toEqual(CLAVES_SERVICIO);

    // Cortado.
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${B.id}/cuenta/estado`).set({
      modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'),
      periodoPagado: periodoAnterior(periodoAnterior(mesBolivia(Date.now()))), corteActivo: true,
    });
    const c = await entrante(B, '5910000006003');
    expect(Object.keys(c.cuerpo).sort()).toEqual(CLAVES_RESPUESTA.cortado);
  });

  it('los contadores de facturación (conversación y métricas) son los de siempre, con todos los comercios', async () => {
    for (const c of [A, BEL]) {
      await entrante(c, '5910000006101');
      await saliente(c, '5910000006101');
      await entrante(c, '5910000006101');
      await entrante(c, '5910000006102');
      const conv = await conversacion(c, '5910000006101');
      expect(pick(conv, CAMPOS_FACTURACION_CONVERSACION)).toEqual({ ...FACTURACION_CONVERSACION, periodoContado: MES() });
      expect(pick(await metricas(c), CAMPOS_FACTURACION_METRICAS)).toEqual(FACTURACION_METRICAS);
    }
  });

  it('la transacción hace las mismas lecturas y escrituras de siempre: los campos van en los create/set que ya existían', async () => {
    contarTransacciones();
    await entrante(A, '5910000006201', 'hola, quiero reservar', { nombreContacto: 'Rosa Vega' });
    expect(ultimo).toEqual(OPERACIONES.entrante);
    await saliente(A, '5910000006201');
    expect(ultimo).toEqual(OPERACIONES.saliente);

    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set({
      modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'),
      periodoPagado: periodoAnterior(periodoAnterior(mesBolivia(Date.now()))), corteActivo: true,
    });
    await entrante(A, '5910000006202');
    expect(ultimo).toEqual(OPERACIONES.cortado);
  });

  it('el comercio de Bellido recibe los mismos campos que cualquier otro (P1: Core igual para todos, sin bandera)', async () => {
    await entrante(BEL, '5910000006301', 'consulta de turno para mañana', { nombreContacto: 'Luis Mamani' });
    await saliente(BEL, '5910000006301', 'le confirmo el turno');
    const c = await conversacion(BEL, '5910000006301');
    expect(c['noLeidos']).toBe(1);
    expect(c['sinLeer']).toBe(true);
    expect(ms(c['ventanaVenceEn'])).toBe(ms(c['ultimoEntranteEn']) + 24 * HORA);
    expect(c['nombrePalabras']).toEqual(['lui', 'mamani']);
    const docs = await mensajes(BEL, '5910000006301');
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d.get('tenantId')).toBe(BEL.id);
      expect(d.id).toMatch(MENSAJE_ID);
    }
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
