/**
 * `enviarAdjuntoComoPersona` (B2 de «Envío de medios por consola»): ENVIAR UN ARCHIVO COMO PERSONA, ESCRITO NEGANDO
 *
 * Cada guarda de `enviarAdjuntoComoPersona.ts` tiene acá una prueba que falla si se quita. El almacén es un doble en
 * memoria (`fijarAlmacenDeMediosDePrueba`); Firestore, el emulador. Dos comercios ficticios, personas ficticias y
 * teléfonos con seis ceros. El reloj entra con `vi.setSystemTime`; el timbre y Auth, simulados como en
 * `enviar-como-persona.test.ts`, que NO se toca (es la prueba de que el texto no cambió).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['MEDIOS_DOBLE'] = '1';
// Alias de esta suite: 09 (valor de prueba, no secreto). El alias 'cliente09' lo usa la ruta sembrada.
process.env['INGESTA_CLIENTE09'] = 'valor-de-prueba-adjunto-09';

const h = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase-admin/auth')>();
  return { ...original, getAuth: (...a: unknown[]) => h.getAuth(...a) };
});
const INDICE = await import('../../functions/src/index.ts');
const { getFirestore, Timestamp, Transaction, FieldValue } = await import('firebase-admin/firestore');
const { fijarAlmacenDeMediosDePrueba, objetoDeEnviado, diaDeLaPaz } = await import('../../functions/src/core/medios/almacen.ts');
const { reclamarSalida } = await import('../../functions/src/core/conversacion/reclamarSalidaPersona.ts');
const { confirmarSalida } = await import('../../functions/src/core/conversacion/confirmarSalidaPersona.ts');
const { leerAdjunto } = await import('../../functions/src/core/medios/leerAdjuntoPersona.ts');
const { LARGO_MAXIMO_DE_BASE64, TOPE_DIARIO_DE_ADJUNTOS, TOPE_DIARIO_DE_BYTES_ENVIADOS } =
  await import('../../functions/src/core/conversacion/enviarAdjuntoComoPersona.ts');
const db = getFirestore();

const aqui = dirname(fileURLToPath(import.meta.url));
const { default: logger } = await import('../../functions/node_modules/firebase-functions/lib/logger/index.js') as unknown as {
  default: Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...a: unknown[]) => void>;
};
const FUENTE = (archivo: string, carpeta = 'conversacion') =>
  readFileSync(join(aqui, '..', '..', 'functions', 'src', 'core', carpeta, archivo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- Archivos de prueba, armados a mano (ver `medios/salientes.test.ts`) -------------------------------------------
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
};
const chunkPng = (tipo: string, datos: Buffer) => {
  const t = Buffer.from(tipo, 'latin1');
  const l = Buffer.alloc(4); l.writeUInt32BE(datos.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([l, t, datos, c]);
};
const png = (w = 8, h = 8) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunkPng('IHDR', ihdr),
    chunkPng('IDAT', Buffer.from([1, 2, 3, 4])), chunkPng('IEND', Buffer.alloc(0))]);
};
const seg = (m: number, datos: Buffer) => { const l = Buffer.alloc(2); l.writeUInt16BE(datos.length + 2); return Buffer.concat([Buffer.from([0xff, m]), l, datos]); };
const jpeg = (extra: Buffer[] = []) => {
  const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(16, 1); sof.writeUInt16BE(16, 3); sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')), ...extra,
    seg(0xc0, sof), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0x56]), Buffer.from([0xff, 0xd9]),
  ]);
};
const JPEG = jpeg();
const zip = (...nombres: string[]) => Buffer.concat([
  ...nombres.map((n) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(n, 'latin1'), Buffer.from('x')])),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18),
]);
const DOCX = (...mas: string[]) => zip('[Content_Types].xml', 'word/document.xml', ...mas);
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdf = (relleno = '') => Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${relleno}%%EOF\n`, 'latin1');
const crcOggAparte = (b: Buffer) => {
  let c = 0;
  for (const x of b) { c ^= x << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; c >>>= 0; }
  return c >>> 0;
};
const pagina = (banderas: number, granule: bigint, sec: number, paquetes: Buffer[]) => {
  const tabla: number[] = [];
  for (const p of paquetes) { for (let r = p.length; r >= 255; r -= 255) tabla.push(255); tabla.push(p.length % 255); }
  const cab = Buffer.alloc(27 + tabla.length);
  cab.write('OggS', 0, 'latin1'); cab[5] = banderas; cab.writeBigUInt64LE(granule, 6); cab.writeUInt32LE(7, 14); cab.writeUInt32LE(sec, 18);
  cab[26] = tabla.length; Buffer.from(tabla).copy(cab, 27);
  const p = Buffer.concat([cab, ...paquetes]); p.writeUInt32LE(crcOggAparte(p), 22); return p;
};
const opusHead = () => { const x = Buffer.alloc(19); x.write('OpusHead', 0, 'latin1'); x[8] = 1; x[9] = 1; x.writeUInt16LE(312, 10); x.writeUInt32LE(48000, 12); return x; };
const OGG = Buffer.concat([
  pagina(2, 0n, 0, [opusHead()]), pagina(0, 0n, 1, [Buffer.concat([Buffer.from('OpusTags', 'latin1'), Buffer.alloc(8)])]),
  pagina(4, 960n, 2, [Buffer.from([0xfc, 1, 2, 3])]),
]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(40)]);
const b64 = (b: Buffer) => b.toString('base64');

// --- El almacén doble ------------------------------------------------------------------------------------------------
const objetos = new Map<string, { bytes: Buffer; contentType: string }>();
let subidas = 0;
/** Se ejecuta DENTRO de `guardar`, o sea entre el ensayo y la transacción real (para probar sus barreras). */
let dentroDeGuardar: (() => Promise<void>) | null = null;
const almacenDoble = {
  async guardar(ruta: string, bytes: Buffer, contentType: string) {
    subidas++;
    if (dentroDeGuardar) await dentroDeGuardar();
    if (objetos.has(ruta)) return 'existe' as const;
    objetos.set(ruta, { bytes, contentType }); return 'creado' as const;
  },
  async existe(ruta: string) { return objetos.has(ruta); },
  async subcarpetas() { return []; },
  async borrarPrefijo(prefijo: string) { let n = 0; for (const k of [...objetos.keys()]) if (k.startsWith(prefijo)) { objetos.delete(k); n++; } return n; },
  async metadatos(ruta: string) { const o = objetos.get(ruta); return o ? { tamano: o.bytes.length } : null; },
  async leer(ruta: string) { return objetos.get(ruta)?.bytes ?? null; },
};

// --- Actores -----------------------------------------------------------------
interface Actor { uid: string; token: Record<string, unknown> }
const actor = (uid: string, nc: Record<string, unknown>, proveedor = 'password'): Actor => ({
  uid, token: { nc: { v: 1, ...nc }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true, auth_time: 1 },
});
const oper = (t: string, uid: string) => actor(uid, { t: { [t]: 'oper' } });
const propietario = () => actor('u-propietario', { t: {}, p: true }, 'google.com');

const A = 'tienda-a';
const OTRO = 'tienda-b';
const TODOS = [A, OTRO];
const ANA = oper(A, 'u-ana');
const BRUNO = oper(A, 'u-bruno');
const TEL1 = '59100000001';
const CONV1 = `wa_${TEL1}`;
const NUMERO = '1000000701';
const AHORA = Date.UTC(2026, 9, 16, 15, 0, 0); // 11:00 en La Paz
const MIN = 60_000;
const HORA = 3_600_000;
const DIA = 24 * HORA;
const ts = (ms: number) => Timestamp.fromMillis(ms);
const CLAVE = 'clave-adjunto-aaaaaa';
const claveN = (n: number) => `clave-adjunto-${String(n).padStart(6, 'x')}`;
const LEYENDA = 'LEYENDA-RESERVADA-DEL-ENVIO';
const NOMBRE = 'NOMBRE-RESERVADO-DEL-ARCHIVO';

const URL_TIMBRE = 'https://n8n.ejemplo.test/webhook/prueba-de-timbre';
let timbres: Array<[string, string, number]> = [];
const auth = { vigente: true };
const usuarios = new Map<string, Record<string, unknown>>();
const CALLABLE = INDICE.enviarAdjuntoComoPersona as unknown as { run: (r: unknown) => Promise<unknown> };

interface ErrorLeido { code: string; message: string; details?: unknown }
async function rechazo(p: Promise<unknown>): Promise<ErrorLeido> {
  try { await p; } catch (e) { const x = e as ErrorLeido; return { code: x.code, message: x.message, details: x.details }; }
  throw new Error('la callable NO rechazó');
}
const adjunto = (bytes: Buffer = JPEG, o: Record<string, unknown> = {}) => ({ base64: b64(bytes), mime: 'image/jpeg', nombre: 'foto.jpg', ...o });
const base = (o: Record<string, unknown> = {}) => ({ tenantId: A, conversacionId: CONV1, clave: CLAVE, adjunto: adjunto(), ...o });
const enviar = (data: unknown, a: Actor | null = ANA, ahoraMs = AHORA) => {
  if (a) usuarios.set(a.uid, a.token['nc'] as Record<string, unknown>);
  vi.setSystemTime(new Date(ahoraMs));
  return CALLABLE.run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} }) as Promise<Record<string, unknown>>;
};
const TEXTO = INDICE.enviarComoPersona as unknown as { run: (r: unknown) => Promise<unknown> };
const enviarTexto = (data: unknown, a: Actor = ANA, ahoraMs = AHORA) => {
  usuarios.set(a.uid, a.token['nc'] as Record<string, unknown>);
  vi.setSystemTime(new Date(ahoraMs));
  return TEXTO.run({ data, auth: { uid: a.uid, token: a.token }, rawRequest: {} }) as Promise<Record<string, unknown>>;
};

// --- Semillas ------------------------------------------------------------------
async function ficha(t: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', consolaConversaciones: 'nueva', personaPuedeEscribir: true, personaPuedeEnviarMedios: true, ...o });
}
async function conversacion(t: string, id: string, o: Record<string, unknown> = {}, quien = 'u-ana', ahora = AHORA) {
  await db.doc(`tenants/${t}/conversaciones/${id}`).set({
    telefono: id.slice(3), canal: 'whatsapp', ultimoMensaje: 'Hola', mensajesTotal: 3, mensajesVentana: 2, atencionEstado: 'normal',
    noLeidos: 1, sinLeer: true, ultimoEntranteEn: ts(ahora - 10 * MIN), ventanaVenceEn: ts(ahora + 23 * HORA + 50 * MIN),
    turno: { responde: 'persona', tomadoPor: quien, tomadoEn: ts(ahora - 5 * MIN), actividadPersonaEn: ts(ahora - MIN) },
    solicitud: { estado: 'abierta', monto: 25 },
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
const topes = async () => Object.fromEntries((await db.collection('topesDeEnvio').get()).docs.map((d) => [d.id, d.data()]));
const metadatos = async (t = A) => (await db.collection(`tenants/${t}/mediosEnviados`).get()).docs;
/**
 * Las cifras del plan con la cuenta de estas pruebas (plan `pro`, tarifa por omisión, titularidad de NovuChat): las MISMAS que
 * fija `enviar-como-persona.test.ts` (10 por conversación y por minuto, 300 por día). Se escriben acá y no se importan de
 * Central porque una prueba de Core no puede importar hacia arriba (`fronteras.test.ts`); si el plan cambia, falla la del texto.
 */
const limites = () => ({ porConversacion: 10, porDia: 300, porMinuto: 10 });
/** Nada se escribió: ni un objeto, ni un mensaje, ni un metadato, ni un contador, ni un timbre. */
async function nadaEscrito() {
  expect(objetos.size, 'objetos en Storage').toBe(0);
  expect(subidas, 'subidas').toBe(0);
  expect(await mensajes(), 'mensajes').toHaveLength(0);
  expect(await metadatos(), 'metadatos').toHaveLength(0);
  expect(await topes(), 'contadores').toEqual({});
  expect(timbres, 'timbres').toHaveLength(0);
  expect(await auditorias(), 'auditoría').toHaveLength(0);
}

let registros: string[] = [];
beforeAll(async () => {
  await db.doc('tenants/sonda-adjunto').get();
  fijarAlmacenDeMediosDePrueba(almacenDoble);
}, 60_000);
beforeEach(async () => {
  vi.useRealTimers();
  for (const t of TODOS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('topesDeEnvio').listDocuments()) await d.delete();
  for (const d of await db.collection('rutasWhatsApp').listDocuments()) await d.delete();
  await ficha(A); await ficha(OTRO);
  await conversacion(A, CONV1);
  await ruta();
  await cuenta();
  objetos.clear(); subidas = 0; dentroDeGuardar = null;
  for (const d of await db.collection('topesDeMedios').listDocuments()) await d.delete();
  timbres = []; registros = [];
  auth.vigente = true; usuarios.clear();
  process.env['SALIDA_PERSONA_RUTAS'] = JSON.stringify({ cliente09: { ruta: URL_TIMBRE, clave: 'clave-de-prueba-del-timbre' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    timbres.push([url, init.headers['X-NovuChat-Numero']!, Number(init.headers['X-NovuChat-Timestamp'])]);
    return new Response('', { status: 200 });
  }));
  h.getAuth.mockReset();
  h.getAuth.mockImplementation(() => ({
    getUser: async (uid: string) => ({ disabled: !auth.vigente, customClaims: { nc: usuarios.get(uid) }, tokensValidAfterTime: undefined }),
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
  it('imagen con leyenda: mensaje `pendiente` con su `medio`, metadato, objeto en Storage, timbre UNA vez', async () => {
    const r = await enviar(base({ leyenda: LEYENDA, adjunto: adjunto(JPEG, { nombre: NOMBRE }) }));
    expect(r).toEqual({ estado: 'pendiente', mensajeId: CLAVE });
    expect(timbres).toEqual([[URL_TIMBRE, NUMERO, AHORA]]);
    const [m] = await mensajes();
    const objeto = objetoDeEnviado(CONV1, CLAVE);
    expect(m!.id).toBe(CLAVE);
    expect(m!.data()).toMatchObject({
      direccion: 'saliente', tipo: 'image', texto: LEYENDA, ts: ts(AHORA), autor: 'persona', autorUid: 'u-ana',
      estadoEnvio: 'pendiente', to: TEL1, phoneNumberId: NUMERO, tenantId: A,
      medio: { estado: 'guardado', origen: 'enviado', mime: 'image/jpeg', tamano: expect.any(Number), voz: false, objeto, vence: ts(AHORA + 30 * DIA) },
    });
    // La imagen no lleva nombre: solo el documento lo necesita (Graph lo pide como `filename`).
    expect((m!.get('medio') as Record<string, unknown>)['nombre']).toBeUndefined();
    const ruta = `tenants/${A}/mediosEnviados/${diaDeLaPaz(AHORA)}/${objeto}.jpg`;
    expect([...objetos.keys()]).toEqual([ruta]);
    expect(objetos.get(ruta)!.contentType).toBe('image/jpeg');
    const [meta] = await metadatos();
    expect(meta!.id).toBe(objeto);
    expect(meta!.data()).toMatchObject({
      conversacionId: CONV1, mensajeId: CLAVE, autorUid: 'u-ana', tipo: 'image', categoria: 'image', mime: 'image/jpeg', ext: 'jpg',
      tamano: objetos.get(ruta)!.bytes.length, sha256: createHash('sha256').update(objetos.get(ruta)!.bytes).digest('hex'), ruta,
      voz: false, estado: 'guardado', en: ts(AHORA), vence: ts(AHORA + 30 * DIA),
    });
  });

  it('documento: el nombre saneado vive solo en `medio.nombre`; el objeto va como octet-stream', async () => {
    await enviar(base({ adjunto: adjunto(pdf(), { mime: 'application/pdf', nombre: 'Factura de julio.pdf' }), leyenda: LEYENDA }));
    const [m] = await mensajes();
    expect(m!.get('tipo')).toBe('document');
    expect(m!.get('medio.nombre')).toBe('Factura de julio.pdf');
    expect([...objetos.values()][0]!.contentType).toBe('application/octet-stream');
  });

  it('`ultimoMensaje` = la leyenda, o un rótulo fijo; y NO toca conteo, umbrales ni ventana', async () => {
    const antes = await leerConv();
    await enviar(base({ leyenda: LEYENDA }));
    expect((await leerConv())['ultimoMensaje']).toBe(LEYENDA);
    for (const [i, [bytes, mime, rotulo]] of ([
      [JPEG, 'image/jpeg', '[Imagen]'], [pdf(), 'application/pdf', '[Documento]'], [OGG, 'audio/ogg', '[Nota de voz]'],
    ] as const).entries()) {
      await enviar(base({ clave: claveN(i + 2), adjunto: adjunto(bytes, { mime, nombre: 'a' }) }));
      expect((await leerConv())['ultimoMensaje'], rotulo).toBe(rotulo);
    }
    const d = await leerConv();
    for (const k of ['mensajesVentana', 'mensajesTotal', 'atencionEstado', 'ultimoEntranteEn', 'ventanaVenceEn', 'noLeidos', 'sinLeer', 'telefono', 'solicitud']) {
      expect(d[k], k).toEqual(antes[k]);
    }
    expect((d['envioPersona'] as Record<string, unknown>)['n']).toBe(4);
    expect((await db.collection(`tenants/${A}/metricas`).get()).size).toBe(0);
  });

  it('la nota de voz (Ogg/Opus mono) lleva `voz: true`', async () => {
    await enviar(base({ adjunto: adjunto(OGG, { mime: 'audio/ogg', nombre: 'nota.ogg' }) }));
    const [m] = await mensajes();
    expect(m!.get('tipo')).toBe('audio');
    expect(m!.get('medio.voz')).toBe(true);
    expect((await metadatos())[0]!.get('voz')).toBe(true);
  });

  it('auditoría `adjunto_persona_creado`: solo {mensajeId, tipo, tamano}; sin teléfono, ni sus 4 últimos dígitos, ni leyenda, ni nombre', async () => {
    await enviar(base({ leyenda: LEYENDA, adjunto: adjunto(JPEG, { nombre: NOMBRE }) }));
    const [a] = await auditorias();
    expect(a).toEqual({
      accion: 'adjunto_persona_creado', uid: 'u-ana', en: ts(AHORA), rol: 'oper', resultado: 'ok',
      mensajeId: CLAVE, tipo: 'image', tamano: JPEG.length,
    });
    const plano = JSON.stringify(a, (_k, v) => (v instanceof Timestamp ? 'ts' : v));
    for (const prohibido of [TEL1, TEL1.slice(-4), LEYENDA, NOMBRE]) expect(plano).not.toContain(prohibido);
    expect(a).not.toHaveProperty('telefono4');
  });

  it('cada adjunto cuenta como UN mensaje de persona en los contadores del plan (usuario, comercio) y en el de seguridad', async () => {
    await enviar(base());
    const t = await topes();
    const minuto = new Date(AHORA).toISOString().slice(0, 16);
    expect(t['u_u-ana']).toMatchObject({ min: minuto, n: 1 });
    expect(t[`t_${A}`]).toMatchObject({ min: minuto, nMin: 1, dia: '2026-10-16', nDia: 1 });
    expect(t[`a_${A}`]).toMatchObject({ dia: '2026-10-16', n: 1, bytes: JPEG.length });
  });

  it('el texto no escribe el contador de adjuntos (la rama texto no lo toca)', async () => {
    await enviarTexto({ tenantId: A, conversacionId: CONV1, texto: 'hola', claveIdempotencia: 'clave-de-envio-0001' });
    expect(Object.keys(await topes()).sort()).toEqual([`t_${A}`, 'u_u-ana']);
  });
});

// ===========================================================================
describe('las dos banderas y el canal (nada se escribe)', () => {
  it.each([
    ['ausente', undefined], ['false', false], ['la cadena "true"', 'true'], ['1', 1], ['un objeto', {}],
  ])('personaPuedeEnviarMedios %s: permission-denied «sinMedios», 0 objetos, 0 documentos', async (_n, valor) => {
    await ficha(A, valor === undefined ? {} : { personaPuedeEnviarMedios: valor });
    if (valor === undefined) await db.doc(`tenants/${A}`).update({ personaPuedeEnviarMedios: FieldValue.delete() });
    const e = await rechazo(enviar(base()));
    expect(e).toMatchObject({ code: 'permission-denied', message: 'El envío de archivos no está activo para su negocio.' });
    await nadaEscrito();
  });

  it('personaPuedeEscribir apagada: rechaza aunque la de medios esté encendida, sin escribir nada', async () => {
    await ficha(A, { personaPuedeEscribir: false });
    expect((await rechazo(enviar(base()))).code).toBe('permission-denied');
    await nadaEscrito();
  });

  it('la bandera de medios NO afecta al texto: con ella apagada el texto sigue saliendo', async () => {
    await ficha(A, { personaPuedeEnviarMedios: false });
    expect(await enviarTexto({ tenantId: A, conversacionId: CONV1, texto: 'hola', claveIdempotencia: 'clave-de-envio-0001' })).toMatchObject({ estado: 'pendiente' });
  });

  it('D-A13: un número que sale por el relé rechaza el adjunto (failed-precondition) y no crea nada; el texto sí sale', async () => {
    await ruta({ canalSalida: 'rele' });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await nadaEscrito();
    expect(await enviarTexto({ tenantId: A, conversacionId: CONV1, texto: 'hola', claveIdempotencia: 'clave-de-envio-0001' })).toMatchObject({ estado: 'pendiente' });
  });

  it('sin ruta activa: failed-precondition y nada escrito', async () => {
    await ruta({ estado: 'inactivo' });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await nadaEscrito();
  });
});

// ===========================================================================
describe('quién y cuándo (turno, ventana, bloqueo): nada se escribe', () => {
  it('sin sesión: unauthenticated', async () => {
    expect((await rechazo(enviar(base(), null))).code).toBe('unauthenticated');
    await nadaEscrito();
  });
  it('el propietario (soporte) no envía', async () => {
    expect((await rechazo(enviar(base(), propietario()))).code).toBe('permission-denied');
    await nadaEscrito();
  });
  it('un operador de OTRO comercio no envía al comercio A', async () => {
    expect((await rechazo(enviar(base(), oper(OTRO, 'u-otro')))).code).toBe('permission-denied');
    await nadaEscrito();
  });
  it('cuenta no vigente (token vivo de una persona dada de baja)', async () => {
    auth.vigente = false;
    expect((await rechazo(enviar(base()))).code).toBe('permission-denied');
    await nadaEscrito();
  });
  it('sin turno: failed-precondition', async () => {
    await conversacion(A, CONV1, { turno: { responde: 'asistente' } });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await nadaEscrito();
  });
  it('con el turno de OTRA persona', async () => {
    const e = await rechazo(enviar(base(), BRUNO));
    expect(e.code).toBe('failed-precondition');
    await nadaEscrito();
  });
  it('fuera de la ventana de 24 h', async () => {
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - 25 * HORA) });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await nadaEscrito();
  });
  it('el bloqueo de 45 s tras un entrante sin responder', async () => {
    await conversacion(A, CONV1, {
      ultimoEntranteEn: ts(AHORA - 10_000),
      turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 20_000), actividadPersonaEn: ts(AHORA - 5_000) },
    });
    const e = await rechazo(enviar(base()));
    expect(e.details).toMatchObject({ motivo: 'espera' });
    await nadaEscrito();
  });
  it('contacto bloqueado', async () => {
    await conversacion(A, CONV1, { bloqueada: true });
    expect((await rechazo(enviar(base()))).code).toBe('failed-precondition');
    await nadaEscrito();
  });
  it('conversación inexistente', async () => {
    expect((await rechazo(enviar(base({ conversacionId: 'wa_59100000099' })))).code).toBe('not-found');
    await nadaEscrito();
  });
});

// ===========================================================================
describe('los topes del PLAN (el adjunto es un mensaje de persona más)', () => {
  it('por conversación: texto y adjunto suman; el +1 se rechaza con details.tope y no sube nada', async () => {
    const L = limites();
    await conversacion(A, CONV1, { envioPersona: { desde: ts(AHORA - MIN), n: L.porConversacion - 1 } });
    expect(await enviarTexto({ tenantId: A, conversacionId: CONV1, texto: 'hola', claveIdempotencia: 'clave-de-envio-0001' })).toMatchObject({ estado: 'pendiente' });
    const e = await rechazo(enviar(base()));
    expect(e).toMatchObject({ code: 'resource-exhausted', details: { tope: 'conversacion' } });
    expect(objetos.size).toBe(0);
    expect(subidas).toBe(0);
    expect(await metadatos()).toHaveLength(0);
    expect(Object.keys(await topes())).not.toContain(`a_${A}`);
  });
  it('el adjunto llena el tope y el texto +1 se rechaza', async () => {
    const L = limites();
    await conversacion(A, CONV1, { envioPersona: { desde: ts(AHORA - MIN), n: L.porConversacion - 1 } });
    await enviar(base());
    const e = await rechazo(enviarTexto({ tenantId: A, conversacionId: CONV1, texto: 'otro', claveIdempotencia: 'clave-de-envio-0002' }));
    expect(e.details).toMatchObject({ tope: 'conversacion' });
  });
  it('por minuto: el tope del comercio cuenta también los adjuntos', async () => {
    const L = limites();
    await db.doc(`topesDeEnvio/t_${A}`).set({ min: new Date(AHORA).toISOString().slice(0, 16), nMin: L.porMinuto, dia: '2026-10-16', nDia: 1 });
    const e = await rechazo(enviar(base()));
    expect(e).toMatchObject({ code: 'resource-exhausted', details: { tope: 'minuto' } });
    expect(objetos.size).toBe(0);
  });
  it('por día: el tope del plan gana al de seguridad (se comprueba primero)', async () => {
    const L = limites();
    await db.doc(`topesDeEnvio/t_${A}`).set({ min: 'otro', nMin: 0, dia: '2026-10-16', nDia: L.porDia });
    await db.doc(`topesDeEnvio/a_${A}`).set({ dia: '2026-10-16', n: TOPE_DIARIO_DE_ADJUNTOS, bytes: 0 });
    const e = await rechazo(enviar(base()));
    expect(e.details).toMatchObject({ tope: 'dia' });
  });
});

// ===========================================================================
describe('los topes de SEGURIDAD (no del plan): 50 archivos y 500 MiB por comercio y día de La Paz', () => {
  it('las constantes son las decididas', () => {
    expect(TOPE_DIARIO_DE_ADJUNTOS).toBe(50);
    expect(TOPE_DIARIO_DE_BYTES_ENVIADOS).toBe(500 * 1024 * 1024);
  });
  it('el 50.º pasa y el 51.º se rechaza con `adjuntosDia`, sin subir nada ni consumir cupo', async () => {
    await db.doc(`topesDeEnvio/a_${A}`).set({ dia: '2026-10-16', n: TOPE_DIARIO_DE_ADJUNTOS - 1, bytes: 0 });
    await enviar(base());
    expect((await topes())[`a_${A}`]).toMatchObject({ n: TOPE_DIARIO_DE_ADJUNTOS });
    const antes = await topes();
    const e = await rechazo(enviar(base({ clave: claveN(2) })));
    expect(e).toMatchObject({ code: 'resource-exhausted', details: { tope: 'adjuntosDia' } });
    expect(objetos.size).toBe(1);
    expect(subidas).toBe(1);
    expect(await topes()).toEqual(antes);
    expect(await mensajes()).toHaveLength(1);
  });
  it('bytes: con el contador sembrado a 500 MiB menos 10 bytes, el archivo siguiente se rechaza con `bytesDia`', async () => {
    await db.doc(`topesDeEnvio/a_${A}`).set({ dia: '2026-10-16', n: 1, bytes: TOPE_DIARIO_DE_BYTES_ENVIADOS - 10 });
    const e = await rechazo(enviar(base()));
    expect(e).toMatchObject({ code: 'resource-exhausted', details: { tope: 'bytesDia' } });
    expect(objetos.size).toBe(0);
    expect((await topes())[`a_${A}`]).toMatchObject({ n: 1, bytes: TOPE_DIARIO_DE_BYTES_ENVIADOS - 10 });
  });
  it('un contador ilegible falla CERRADO (unavailable)', async () => {
    await db.doc(`topesDeEnvio/a_${A}`).set({ dia: '2026-10-16', n: 'muchos', bytes: 0 });
    expect((await rechazo(enviar(base()))).code).toBe('unavailable');
    expect(objetos.size).toBe(0);
  });
  it('el día cambia a las 00:00 de La Paz (04:00 UTC): ayer lleno, hoy limpio', async () => {
    await db.doc(`topesDeEnvio/a_${A}`).set({ dia: '2026-10-16', n: TOPE_DIARIO_DE_ADJUNTOS, bytes: TOPE_DIARIO_DE_BYTES_ENVIADOS });
    const antes = Date.UTC(2026, 9, 17, 3, 59, 0); // 23:59 del 16 en La Paz: sigue lleno
    await conversacion(A, CONV1, {}, 'u-ana', antes);
    expect((await rechazo(enviar(base(), ANA, antes))).details).toMatchObject({ tope: 'adjuntosDia' });
    const despues = Date.UTC(2026, 9, 17, 4, 1, 0); // 00:01 del 17: reinicia
    await conversacion(A, CONV1, {}, 'u-ana', despues);
    expect(await enviar(base(), ANA, despues)).toMatchObject({ estado: 'pendiente' });
    expect((await topes())[`a_${A}`]).toMatchObject({ dia: '2026-10-17', n: 1, bytes: JPEG.length });
    // y la ruta del objeto lleva el día de La Paz, no el UTC
    expect([...objetos.keys()][0]).toContain('/mediosEnviados/2026-10-17/');
  });
});

// ===========================================================================
describe('el archivo se decide por sus bytes: lo malo da `invalid-argument` con su motivo y no sube nada', () => {
  it.each([
    ['webp', () => adjunto(WEBP, { mime: 'image/webp' }), 'tipo_no_admitido'],
    ['HTML rotulado como jpg', () => adjunto(Buffer.from('<html><script>alert(1)</script></html>'), { mime: 'image/jpeg', nombre: 'a.jpg' }), 'tipo_no_admitido'],
    ['docx con macros', () => adjunto(DOCX('word/vbaProject.bin'), { mime: MIME_DOCX, nombre: 'a.docx' }), 'con_macros'],
    ['PDF activo (JavaScript)', () => adjunto(Buffer.from('%PDF-1.7\n1 0 obj\n<< /JavaScript (x) >>\nendobj\n%%EOF'), { mime: 'application/pdf' }), 'pdf_activo'],
    ['políglota PDF+ZIP', () => adjunto(Buffer.concat([pdf(), zip('a.txt')]), { mime: 'application/pdf' }), 'poliglota'],
    ['imagen de 4.097 px', () => adjunto(png(4097, 10), { mime: 'image/png' }), 'imagen_dimensiones'],
    ['un jpg con mime de pdf declarado', () => adjunto(JPEG, { mime: 'application/pdf' }), 'tipo_no_coincide'],
  ])('%s', async (_n, armar, motivo) => {
    const e = await rechazo(enviar(base({ adjunto: armar() })));
    expect(e.code).toBe('invalid-argument');
    expect(e.details).toEqual({ motivo });
    await nadaEscrito();
  });

  it('un archivo de más de 16 MiB (documento) se rechaza `demasiado_grande`', async () => {
    const grande = pdf('x'.repeat(16 * 1024 * 1024 + 1 - pdf().length));
    expect(grande.length).toBe(16 * 1024 * 1024 + 1);
    const e = await rechazo(enviar(base({ adjunto: adjunto(grande, { mime: 'application/pdf' }) })));
    expect(e.details).toEqual({ motivo: 'demasiado_grande' });
    await nadaEscrito();
  });

  it.each([
    ['base64 con caracteres inválidos', 'estoNoEsBase64!!'],
    ['base64 vacío', ''],
    ['base64 sin el relleno que le falta', b64(JPEG).replace(/=+$/, '').slice(0, -1)],
    ['base64 de más de 22.369.624 caracteres', 'A'.repeat(LARGO_MAXIMO_DE_BASE64 + 4)],
    ['no es texto', 42],
  ])('%s: invalid-argument sin detalle', async (_n, valor) => {
    const e = await rechazo(enviar(base({ adjunto: { base64: valor } })));
    expect(e.code).toBe('invalid-argument');
    await nadaEscrito();
  });

  it('el largo máximo del base64 es el de 16 MiB', () => {
    expect(LARGO_MAXIMO_DE_BASE64).toBe(22_369_624);
    expect(Math.ceil((16 * 1024 * 1024) / 3) * 4).toBe(22_369_624);
  });
});

describe('la leyenda', () => {
  it('en un audio: `leyenda_en_audio` (la consola hace dos envíos), nada escrito', async () => {
    const e = await rechazo(enviar(base({ leyenda: 'hola', adjunto: adjunto(OGG, { mime: 'audio/ogg' }) })));
    expect(e).toMatchObject({ code: 'invalid-argument', details: { motivo: 'leyenda_en_audio' } });
    await nadaEscrito();
  });
  it.each([
    ['vacía', ''], ['solo espacios', '   '], ['con un carácter de control', 'a\u0007b'], ['de 1.001 caracteres', 'x'.repeat(1001)], ['no es texto', 5],
  ])('%s: invalid-argument', async (_n, leyenda) => {
    expect((await rechazo(enviar(base({ leyenda })))).code).toBe('invalid-argument');
    await nadaEscrito();
  });
  it('de 1.000 caracteres en un documento: pasa', async () => {
    await enviar(base({ leyenda: 'x'.repeat(1000), adjunto: adjunto(pdf(), { mime: 'application/pdf' }) }));
    expect((await mensajes())[0]!.get('texto')).toHaveLength(1000);
  });
});

describe('la entrada es EXACTA: un solo adjunto, sin teléfono ni ruta (D-A3)', () => {
  it.each([
    ['una lista `adjuntos`', { adjuntos: [adjunto()] }],
    ['`adjunto` como lista', { adjunto: [adjunto()] }],
    ['`adjunto` con una clave de más', { adjunto: { ...adjunto(), tipo: 'document' } }],
    ['un teléfono', { telefono: '59100000099' }],
    ['un destino `to`', { to: '59100000099' }],
    ['una ruta de Storage', { ruta: 'tenants/otro/mediosEnviados/2026-10-16/x.jpg' }],
    ['la clave con el nombre del texto', { claveIdempotencia: 'clave-de-envio-0001' }],
    ['un `texto` suelto', { texto: 'hola' }],
    ['sin adjunto', { adjunto: undefined }],
    ['clave corta', { clave: 'corta' }],
    ['clave reservada', { clave: '__reservada_xxxxxxxx__' }],
    ['conversación mal formada', { conversacionId: 'wa_1' }],
  ])('%s: invalid-argument y nada escrito', async (_n, extra) => {
    const e = await rechazo(enviar(base(extra as Record<string, unknown>)));
    expect(e.code).toBe('invalid-argument');
    await nadaEscrito();
  });
  it('un adjunto de otro comercio en la conversación pedida: el comercio sale del rol del token', async () => {
    await conversacion(OTRO, CONV1, {}, 'u-ana');
    const e = await rechazo(enviar(base({ tenantId: OTRO })));
    expect(e.code).toBe('permission-denied');
    expect(await mensajes(OTRO)).toHaveLength(0);
    await nadaEscrito();
  });
});

// ===========================================================================
describe('la clave repetida', () => {
  it('mismos bytes, leyenda y nombre: devuelve lo guardado, SIN segunda subida, sin segundo timbre ni cupo', async () => {
    const dato = base({ leyenda: 'hola' });
    const primero = await enviar(dato);
    const topesAntes = await topes();
    const segundo = await enviar(dato);
    expect(segundo).toEqual(primero);
    expect(subidas).toBe(1);
    expect(objetos.size).toBe(1);
    expect(timbres).toHaveLength(1);
    expect(await mensajes()).toHaveLength(1);
    expect(await metadatos()).toHaveLength(1);
    expect(await topes()).toEqual(topesAntes);
    expect(await auditorias()).toHaveLength(1);
  });
  it('la misma clave con OTROS bytes, otra leyenda u otro nombre: failed-precondition y nada nuevo', async () => {
    await enviar(base({ leyenda: 'hola', adjunto: adjunto(pdf(), { mime: 'application/pdf', nombre: 'a.pdf' }) }));
    for (const otro of [
      base({ leyenda: 'hola', adjunto: adjunto(pdf('%otro\n'), { mime: 'application/pdf', nombre: 'a.pdf' }) }),
      base({ leyenda: 'otra', adjunto: adjunto(pdf(), { mime: 'application/pdf', nombre: 'a.pdf' }) }),
      base({ leyenda: 'hola', adjunto: adjunto(pdf(), { mime: 'application/pdf', nombre: 'b.pdf' }) }),
    ]) {
      expect((await rechazo(enviar(otro))).code).toBe('failed-precondition');
    }
    expect(subidas).toBe(1);
    expect(objetos.size).toBe(1);
    expect(await mensajes()).toHaveLength(1);
  });
  it('la misma clave de OTRA persona: failed-precondition', async () => {
    await conversacion(A, CONV1, {}, 'u-ana');
    await enviar(base());
    await conversacion(A, CONV1, {}, 'u-bruno');
    expect((await rechazo(enviar(base(), BRUNO))).code).toBe('failed-precondition');
    expect(objetos.size).toBe(1);
  });
  it('si la subida a Storage falla: unavailable, ningún mensaje ni contador', async () => {
    const real = almacenDoble.guardar;
    almacenDoble.guardar = async () => { throw Object.assign(new Error('zanahoria'), { code: 503 }); };
    try {
      expect((await rechazo(enviar(base()))).code).toBe('unavailable');
    } finally { almacenDoble.guardar = real; }
    expect(await mensajes()).toHaveLength(0);
    expect(await metadatos()).toHaveLength(0);
    expect(await topes()).toEqual({});
    expect(timbres).toHaveLength(0);
    expect(registros.join('\n')).not.toContain('zanahoria');
  });
  it('la auditoría es falla-cerrada: sin poder auditar no queda mensaje ni metadato ni contador ni timbre', async () => {
    const real = Transaction.prototype.create;
    vi.spyOn(Transaction.prototype, 'create').mockImplementation(function (this: unknown, ref: { path: string }, ...r: unknown[]) {
      if (ref.path.includes('/auditoria/')) throw Object.assign(new Error('zanahoria'), { code: 9 });
      return (real as (...a: unknown[]) => unknown).call(this, ref, ...r) as never;
    } as never);
    expect((await rechazo(enviar(base()))).code).toBe('unavailable');
    expect(await mensajes()).toHaveLength(0);
    expect(await metadatos()).toHaveLength(0);
    expect(await topes()).toEqual({});
    expect(timbres).toHaveLength(0);
  });
});

// ===========================================================================
describe('un objeto que ya existe y los huérfanos (correcciones de la revisión)', () => {
  /** Hace fallar la transacción real: la baja la bandera entre el ensayo y la escritura. */
  const fallarLaReal = () => { dentroDeGuardar = async () => { await db.doc(`tenants/${A}`).update({ personaPuedeEnviarMedios: false }); }; };

  it('clave K con bytes A cuya transacción real falla; K con bytes B se rechaza sin escribir; K con A sale bien', async () => {
    const A_ = adjunto(pdf('%A\n'), { mime: 'application/pdf', nombre: 'a.pdf' });
    const B_ = adjunto(pdf('%B\n'), { mime: 'application/pdf', nombre: 'a.pdf' });
    // 1. falla la real; el objeto debe BORRARSE (sin huérfano)...
    fallarLaReal();
    expect((await rechazo(enviar(base({ adjunto: A_ })))).code).toBe('permission-denied');
    expect(objetos.size).toBe(0);
    // ...pero para fabricar el sobrante de un intento que no pudo borrar, se siembra el objeto de A a mano.
    dentroDeGuardar = null;
    await db.doc(`tenants/${A}`).update({ personaPuedeEnviarMedios: true });
    const ruta = `tenants/${A}/mediosEnviados/${diaDeLaPaz(AHORA)}/${objetoDeEnviado(CONV1, CLAVE)}.pdf`;
    objetos.set(ruta, { bytes: Buffer.from(A_.base64, 'base64'), contentType: 'application/octet-stream' });
    // 2. K con bytes B: rechazo `claveUsada` ANTES de la transacción real
    subidas = 0;
    const e = await rechazo(enviar(base({ adjunto: B_ })));
    expect(e).toMatchObject({ code: 'failed-precondition', message: 'Esa clave de envío ya se usó con otro mensaje.' });
    expect(await mensajes()).toHaveLength(0);
    expect(await metadatos()).toHaveLength(0);
    expect(await topes()).toEqual({});
    expect(timbres).toHaveLength(0);
    expect(objetos.get(ruta)!.bytes.equals(Buffer.from(A_.base64, 'base64'))).toBe(true); // el sobrante no se tocó ni se borró
    // 3. K otra vez con A: sale bien
    expect(await enviar(base({ adjunto: A_ }))).toMatchObject({ estado: 'pendiente' });
    expect(await mensajes()).toHaveLength(1);
    expect(await metadatos()).toHaveLength(1);
  });

  it('si la transacción real rechaza tras crear el objeto, el objeto se borra (0 objetos)', async () => {
    fallarLaReal();
    expect((await rechazo(enviar(base()))).code).toBe('permission-denied');
    expect(subidas).toBe(1);
    expect(objetos.size).toBe(0);
  });

  it('un fallo del borrado no tapa el error original ni registra la ruta', async () => {
    fallarLaReal();
    const real = almacenDoble.borrarPrefijo;
    almacenDoble.borrarPrefijo = async () => { throw new Error('zanahoria con ruta tenants/'); };
    try {
      expect((await rechazo(enviar(base()))).code).toBe('permission-denied');
    } finally { almacenDoble.borrarPrefijo = real; }
    expect(registros.join('\n')).not.toMatch(/zanahoria|tenants\//);
  });

  it('el objeto que NO creó esta llamada (repetido) no se borra aunque algo falle después', async () => {
    await enviar(base());
    expect(objetos.size).toBe(1);
    await db.doc(`tenants/${A}`).update({ personaPuedeEnviarMedios: false });
    expect((await rechazo(enviar(base()))).code).toBe('permission-denied');
    expect(objetos.size).toBe(1);
  });

  it('las barreras de la transacción REAL, cambiadas entre el ensayo y la escritura: rechazo, sin mensaje, metadato ni contador, sin objeto', async () => {
    const casos: Array<[string, () => Promise<void>, Record<string, unknown>]> = [
      ['bandera de medios apagada', async () => { await db.doc(`tenants/${A}`).update({ personaPuedeEnviarMedios: false }); }, { code: 'permission-denied' }],
      ['tope de seguridad en 50', async () => { await db.doc(`topesDeEnvio/a_${A}`).set({ dia: '2026-10-16', n: TOPE_DIARIO_DE_ADJUNTOS, bytes: 0 }); },
        { code: 'resource-exhausted', details: { tope: 'adjuntosDia' } }],
      ['tope del plan consumido', async () => { await db.doc(`topesDeEnvio/t_${A}`).set({ min: 'x', nMin: 0, dia: '2026-10-16', nDia: 300 }); },
        { code: 'resource-exhausted', details: { tope: 'dia' } }],
    ];
    for (const [nombre, cambio, esperado] of casos) {
      dentroDeGuardar = cambio;
      const e = await rechazo(enviar(base()));
      expect(e, nombre).toMatchObject(esperado);
      expect(await mensajes(), nombre).toHaveLength(0);
      expect(await metadatos(), nombre).toHaveLength(0);
      expect(objetos.size, nombre).toBe(0);
      const t = await topes();
      expect(t[`a_${A}`]?.['n'] ?? 0, nombre).toBe(nombre.startsWith('tope de seg') ? TOPE_DIARIO_DE_ADJUNTOS : 0);
      expect(t['u_u-ana'], nombre).toBeUndefined();
      expect(timbres, nombre).toHaveLength(0);
      expect(await auditorias(), nombre).toHaveLength(0);
      // restaurar
      dentroDeGuardar = null;
      await db.doc(`tenants/${A}`).update({ personaPuedeEnviarMedios: true });
      for (const d of await db.collection('topesDeEnvio').listDocuments()) await d.delete();
      subidas = 0;
    }
  });
});

// ===========================================================================
describe('verMedio de una nota de voz enviada (Ogg/Opus mono) y de una que entró como WebM', () => {
  const ebml = (id: number[], dato: Buffer, desconocido = false) => {
    const n = dato.length;
    const sz = desconocido ? Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) : n < 127 ? Buffer.from([0x80 | n]) : Buffer.from([0x40 | (n >> 8), n & 0xff]);
    return Buffer.concat([Buffer.from(id), sz, dato]);
  };
  const u = (...x: number[]) => Buffer.from(x);
  const WEBM = (() => {
    const pista = ebml([0xae], Buffer.concat([ebml([0xd7], u(1)), ebml([0x86], Buffer.from('A_OPUS')), ebml([0x63, 0xa2], opusHead()), ebml([0xe1], ebml([0x9f], u(1)))]));
    const bloques = Array.from({ length: 60 }, (_, i) => ebml([0xa3], Buffer.concat([u(0x81, 0, i), u(0x80), Buffer.from([0xfc, i, i, i])])));
    return Buffer.concat([
      ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from('webm'))),
      ebml([0x18, 0x53, 0x80, 0x67], Buffer.concat([ebml([0x16, 0x54, 0xae, 0x6b], pista), ebml([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([ebml([0xe7], u(0)), ...bloques]), true)]), true),
    ]);
  })();
  const verMedio = INDICE.verMedio as unknown as { run: (r: unknown) => Promise<Record<string, unknown>> };
  const administrador = actor('u-admin-a', { t: { [A]: 'admin' } });
  const ver = (mensajeId: string) => {
    usuarios.set(administrador.uid, administrador.token['nc'] as Record<string, unknown>);
    return verMedio.run({ data: { tenantId: A, conversacionId: CONV1, mensajeId, accion: 'ver' }, auth: { uid: administrador.uid, token: { ...administrador.token, auth_time: Math.floor(AHORA / 1000) } }, rawRequest: {} });
  };

  it.each([
    ['Ogg/Opus mono', () => adjunto(OGG, { mime: 'audio/ogg', nombre: 'nota.ogg' })],
    ['WebM/Opus reempaquetado a Ogg', () => adjunto(WEBM, { mime: 'audio/webm', nombre: 'nota.webm' })],
  ])('%s: lo enviado se ve en la consola con el mime de su firma', async (_n, armar) => {
    await enviar(base({ adjunto: armar() }));
    const guardado = [...objetos.values()][0]!.bytes;
    expect(guardado.subarray(0, 4).toString('latin1')).toBe('OggS');
    expect((await mensajes())[0]!.get('medio.voz')).toBe(true);
    const r = await ver(CLAVE);
    expect(r).toMatchObject({ tipo: 'audio', categoria: 'audio', mime: 'audio/ogg', extension: 'ogg', tamano: guardado.length });
    expect(Buffer.from(r['base64'] as string, 'base64').equals(guardado)).toBe(true);
    expect((await metadatos())[0]!.get('mime')).toBe('audio/ogg');
  });
});

// ===========================================================================
describe('un adjunto de persona NUNCA toca cobros', () => {
  it('tras crear, reclamar, leer y confirmar: `solicitud` intacta y cierres, comprobantes, alias de cobro y pedidos vacíos', async () => {
    const solicitudAntes = (await leerConv())['solicitud'];
    await enviar(base({ leyenda: LEYENDA }));
    const rutaAuth = { phoneNumberId: NUMERO, tenantId: A, flujo: 'agendamiento', estado: 'activo' };
    const reclamo = await reclamarSalida(rutaAuth, db, AHORA + 10_000, true);
    expect(reclamo.mensajes).toHaveLength(1);
    const lectura = await leerAdjunto(rutaAuth, { mensajeId: CLAVE, conversacionId: CONV1 }, { db, almacen: almacenDoble, ahoraMs: AHORA + 11_000 });
    expect(lectura.codigo).toBe(200);
    const conf = await confirmarSalida(rutaAuth, { mensajeId: CLAVE, conversacionId: CONV1, resultado: 'aceptado', idMeta: 'wamid.ABC' }, db, AHORA + 12_000);
    expect(conf.codigo).toBe(200);
    expect((await leerConv())['solicitud']).toEqual(solicitudAntes);
    for (const c of ['cierres', 'comprobantesRecibidos', 'cobrosAlias', 'comprobantesAlias', 'pedidos']) {
      expect((await db.collection(`tenants/${A}/${c}`).get()).size, c).toBe(0);
    }
    expect((await db.collection(`tenants/${A}/conversaciones`).get()).size).toBe(1);
  });

  it('estático: los fuentes nuevos no mencionan solicitud, cierre, comprobante, OCR, cotejo ni Graph', () => {
    const prohibidas = /solicitud|cierre|comprobante|\bocr\b|cotej|graph\.facebook/i;
    expect(FUENTE('enviarAdjuntoComoPersona.ts')).not.toMatch(prohibidas);
    expect(FUENTE('leerAdjuntoPersona.ts', 'medios')).not.toMatch(prohibidas);
  });
});

// ===========================================================================
describe('nada de teléfono, nombre ni leyenda en Storage, registros ni auditoría', () => {
  it('rutas de Storage, registros y documentos de auditoría y de metadato no llevan el teléfono, la leyenda ni el nombre', async () => {
    await enviar(base({ leyenda: LEYENDA, adjunto: adjunto(pdf(), { mime: 'application/pdf', nombre: `${NOMBRE}.pdf` }) }));
    await rechazo(enviar(base({ clave: claveN(2), leyenda: 'x'.repeat(2000) }))); // un rechazo también se registra
    await rechazo(enviar(base({ clave: claveN(3), adjunto: adjunto(WEBP, { mime: 'image/webp', nombre: NOMBRE }) })));
    const registrado = registros.join('\n');
    expect(registrado.length).toBeGreaterThan(0);
    for (const prohibido of [TEL1, TEL1.slice(-4), LEYENDA, NOMBRE, 'telefono4']) expect(registrado, prohibido).not.toContain(prohibido);
    for (const ruta of objetos.keys()) for (const prohibido of [TEL1, LEYENDA, NOMBRE, 'foto']) expect(ruta, prohibido).not.toContain(prohibido);
    const auditoria = JSON.stringify(await auditorias(), (_k, v) => (v instanceof Timestamp ? 'ts' : v));
    for (const prohibido of [TEL1, TEL1.slice(-4), LEYENDA, NOMBRE]) expect(auditoria, prohibido).not.toContain(prohibido);
  });
  it('el metadato y el mensaje no guardan el nombre de una imagen ni de un audio', async () => {
    await enviar(base({ adjunto: adjunto(JPEG, { nombre: NOMBRE }) }));
    const plano = JSON.stringify([(await mensajes())[0]!.data(), (await metadatos())[0]!.data()], (_k, v) => (v instanceof Timestamp ? 'ts' : v));
    expect(plano).not.toContain(NOMBRE);
  });
});

// ===========================================================================
describe('el cableado: index.ts, región, opciones y TTL', () => {
  it('callable en us-east1 con 1 GiB, 120 s, 3 instancias, concurrencia 4 y el secreto del timbre', () => {
    const e = (INDICE as unknown as Record<string, { __endpoint: Record<string, unknown> }>);
    const ep = e['enviarAdjuntoComoPersona']!.__endpoint;
    expect(ep['region']).toEqual(['us-east1']);
    expect(ep['callableTrigger']).toEqual({});
    expect(ep['availableMemoryMb']).toBe(1024);
    expect(ep['timeoutSeconds']).toBe(120);
    expect(ep['maxInstances']).toBe(3);
    expect(ep['concurrency']).toBe(4);
    expect(ep['secretEnvironmentVariables']).toEqual([{ key: 'SALIDA_PERSONA_RUTAS' }]);
  });
  it('`leerAdjuntoPersona` es HTTP en us-east1 con 1 GiB, 120 s y concurrencia 4', () => {
    const ep = (INDICE as unknown as Record<string, { __endpoint: Record<string, unknown> }>)['leerAdjuntoPersona']!.__endpoint;
    expect(ep['region']).toEqual(['us-east1']);
    expect(ep['httpsTrigger']).toEqual({});
    expect(ep['availableMemoryMb']).toBe(1024);
    expect(ep['timeoutSeconds']).toBe(120);
    expect(ep['concurrency']).toBe(4);
  });
  it('Core no importa Central, y la callable usa las opciones de turno (App Check solo en producción)', () => {
    const f = FUENTE('enviarAdjuntoComoPersona.ts');
    expect(f).not.toMatch(/central\//);
    expect(f).toMatch(/opcionesDeTurno\(process\.env\)/);
    expect(f).not.toMatch(/TOPE_DE_PLAN|porConversacion\s*[:=]\s*\d|porDia\s*[:=]\s*\d|porMinuto\s*[:=]\s*\d/);
  });
  it('los topes de seguridad no son del plan: el código no los lee de `limitesDePersona`', () => {
    expect(FUENTE('enviarAdjuntoComoPersona.ts')).toMatch(/TOPE_DIARIO_DE_ADJUNTOS = 50/);
  });
  it('el TTL de `mediosEnviados` (campo `vence`) está declarado en firestore.indexes.json', () => {
    const idx = JSON.parse(readFileSync(join(aqui, '..', '..', 'firestore.indexes.json'), 'utf8')) as { fieldOverrides: Array<Record<string, unknown>> };
    expect(idx.fieldOverrides.find((f) => f['collectionGroup'] === 'mediosEnviados')).toMatchObject({ fieldPath: 'vence', ttl: true });
  });
});
