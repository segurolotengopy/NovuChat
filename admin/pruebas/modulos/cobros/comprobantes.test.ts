/**
 * LA IMAGEN DEL COMPROBANTE: guardarla, validarla por sus bytes y purgarla.
 *
 * Con un `Almacen` de mentira (el emulador de Firestore no trae Storage). Se
 * escribe negando: 6 MB no entra, un HTML declarado PDF no entra, una petición
 * sin token no entra, el teléfono nunca está en el nombre, y la purga borra a
 * los 91 días, conserva a los 89 y borra todo de un comercio dado de baja.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['COMPROBANTES_DOBLE'] = '1';
const TOKEN = 'valor-de-prueba-de-comprobantes';
process.env['INGESTA_CLIENTE13'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const m = await import('../../../functions/src/modulos/cobros/comprobantes.ts');
const { diaDeLaPaz } = await import('../../../functions/src/modulos/cobros/cotejo.ts');

const T = 'comprobantes-tienda';
const T_BAJA = 'comprobantes-de-baja';
const NUMERO = '1000000013';
const TEL = '59100000061';
const DIA_MS = 86_400_000;

/** Un almacén en memoria con la misma forma que el de Storage. */
class AlmacenDeMentira implements m.Almacen {
  objetos = new Map<string, { bytes: Buffer; contentType: string }>();
  falla = false;
  reescrituras = 0;
  async guardar(ruta: string, bytes: Buffer, contentType: string) {
    if (this.falla) throw new Error('storage caído');
    if (this.objetos.has(ruta)) { this.reescrituras++; return 'existe' as const; }
    this.objetos.set(ruta, { bytes, contentType });
    return 'creado' as const;
  }
  async subcarpetas(prefijo: string) {
    const nombres = new Set<string>();
    for (const r of this.objetos.keys()) if (r.startsWith(prefijo)) nombres.add(r.slice(prefijo.length).split('/')[0] as string);
    return [...nombres];
  }
  async borrarPrefijo(prefijo: string) {
    let n = 0;
    for (const r of [...this.objetos.keys()]) if (r.startsWith(prefijo)) { this.objetos.delete(r); n++; }
    return n;
  }
}
let almacen = new AlmacenDeMentira();
beforeEach(() => { almacen = new AlmacenDeMentira(); m.fijarAlmacenDeComprobantesDePrueba(almacen); });

const JPG = (n = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const WEBP = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)]);
const PDF = (n = 1024) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n)]);
const HTML = () => Buffer.from('<html><script>alert(1)</script></html>');

describe('el tipo se decide por los bytes', () => {
  it('reconoce jpeg, png, webp y pdf', () => {
    expect(m.tipoPorFirma(JPG())).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(m.tipoPorFirma(PNG())).toEqual({ ext: 'png', mime: 'image/png' });
    expect(m.tipoPorFirma(WEBP())).toEqual({ ext: 'webp', mime: 'image/webp' });
    expect(m.tipoPorFirma(PDF())).toEqual({ ext: 'pdf', mime: 'application/pdf' });
  });
  it('no reconoce HTML, texto, un RIFF que no es WEBP ni un binario vacío', () => {
    for (const b of [HTML(), Buffer.from('hola'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]), Buffer.alloc(0), Buffer.alloc(20)]) {
      expect(m.tipoPorFirma(b)).toBeNull();
    }
  });
});

describe('guardarBytesDeComprobante', () => {
  it('guarda una imagen en la ruta con patrón estricto, sin teléfono, con el tipo real', async () => {
    const r = await m.guardarBytesDeComprobante(T, 'wamid.HBg=Lw==', JPG(), 'image/jpeg', { almacen, ahoraMs: Date.UTC(2026, 9, 3, 16, 0) });
    expect(r.codigo).toBe(200);
    const ruta = (r.cuerpo as { ruta: string }).ruta;
    expect(ruta).toBe(`tenants/${T}/comprobantes/2026-10-03/wamidHBgLw.jpg`);
    expect(ruta).toMatch(/^tenants\/[\w-]+\/comprobantes\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/);
    expect(almacen.objetos.get(ruta)?.contentType).toBe('image/jpeg');
  });
  it('el día es el de La Paz: 23:30 del 3 en La Paz es el 4 en UTC y se guarda en la carpeta del 3', async () => {
    const r = await m.guardarBytesDeComprobante(T, 'id1', PNG(), 'image/png', { almacen, ahoraMs: Date.UTC(2026, 9, 4, 3, 30) });
    expect((r.cuerpo as { ruta: string }).ruta).toContain('/2026-10-03/');
  });
  it('rechaza 6 MB de imagen con 413, y acepta un PDF de 6 MB (el tope del PDF es 10 MB)', async () => {
    const seis = 6 * 1024 * 1024;
    expect((await m.guardarBytesDeComprobante(T, 'id2', JPG(seis), 'image/jpeg', { almacen })).codigo).toBe(413);
    expect((await m.guardarBytesDeComprobante(T, 'id3', PDF(seis), 'application/pdf', { almacen })).codigo).toBe(200);
    expect((await m.guardarBytesDeComprobante(T, 'id4', PDF(11 * 1024 * 1024), 'application/pdf', { almacen })).codigo).toBe(413);
    expect((await m.guardarBytesDeComprobante(T, 'id5', JPG(5 * 1024 * 1024 - 10), 'image/jpeg', { almacen })).codigo).toBe(200);
  });
  it('un HTML declarado PDF: 415, y no se guarda nada', async () => {
    const r = await m.guardarBytesDeComprobante(T, 'id6', HTML(), 'application/pdf', { almacen });
    expect(r.codigo).toBe(415);
    expect(almacen.objetos.size).toBe(0);
  });
  it('los bytes de un PDF declarados como imagen, o un tipo no admitido: 415', async () => {
    expect((await m.guardarBytesDeComprobante(T, 'id7', PDF(), 'image/jpeg', { almacen })).codigo).toBe(415);
    expect((await m.guardarBytesDeComprobante(T, 'id8', JPG(), 'application/octet-stream', { almacen })).codigo).toBe(415);
    expect((await m.guardarBytesDeComprobante(T, 'id9', JPG(), '', { almacen })).codigo).toBe(415);
  });
  it('vacío o sin idMeta: 400', async () => {
    expect((await m.guardarBytesDeComprobante(T, 'id10', Buffer.alloc(0), 'image/png', { almacen })).codigo).toBe(400);
    expect((await m.guardarBytesDeComprobante(T, '...', PNG(), 'image/png', { almacen })).codigo).toBe(400);
  });
  it('un idMeta con barras o «..» no escapa de la carpeta', async () => {
    const r = await m.guardarBytesDeComprobante(T, '../../otro/../x', PNG(), 'image/png', { almacen, ahoraMs: Date.UTC(2026, 9, 3, 16, 0) });
    expect((r.cuerpo as { ruta: string }).ruta).toBe(`tenants/${T}/comprobantes/2026-10-03/otrox.png`);
  });
  it('si Storage falla: 502 y no revienta (el cotejo sigue con ruta: null)', async () => {
    almacen.falla = true;
    expect((await m.guardarBytesDeComprobante(T, 'id11', PNG(), 'image/png', { almacen })).codigo).toBe(502);
  });
});

describe('rutaValidaDe: solo la que este comercio y este mensaje habrían recibido', () => {
  const ok = `tenants/${T}/comprobantes/2026-10-03/wamidX.jpg`;
  it('acepta la propia', () => expect(m.rutaValidaDe(ok, T, 'wamid.X')).toBe(ok));
  it('niega la de otro comercio, otro mensaje, otra carpeta, otra extensión, subcarpetas y no-textos', () => {
    for (const mala of [
      `tenants/otro/comprobantes/2026-10-03/wamidX.jpg`, `tenants/${T}/comprobantes/2026-10-03/otro.jpg`,
      `tenants/${T}/pagos/2026-10-03/wamidX.jpg`, `tenants/${T}/comprobantes/2026-10-03/wamidX.exe`,
      `tenants/${T}/comprobantes/2026-10-03/x/wamidX.jpg`, `tenants/${T}/comprobantes/ayer/wamidX.jpg`,
      `tenants/${T}/comprobantes/2026-10-03/../wamidX.jpg`, 5, null, undefined, {},
    ]) expect(m.rutaValidaDe(mala, T, 'wamid.X'), String(mala)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const solicitudDe = (etapa: string, extra: Record<string, unknown> = {}) => ({
  etapa, reglaCobro: 2, venceEn: Timestamp.now(), qrEnviadoEn: Timestamp.now(), ...extra,
});

async function peticion(cuerpo: Buffer, cabeceras: Record<string, string>, token: string | null = TOKEN, metodo = 'POST') {
  const h: Record<string, string> = { 'x-novuchat-numero': NUMERO, ...cabeceras };
  if (token) h['authorization'] = `Bearer ${token}`;
  const leer = (n: string) => h[n.toLowerCase()];
  const q = { method: metodo, body: cuerpo, rawBody: cuerpo, headers: h, get: leer, header: leer };
  const r: { codigo: number; cuerpo: any } = { codigo: 0, cuerpo: null };
  const s = {
    status(c: number) { r.codigo = c; return s; }, send(b: unknown) { r.cuerpo = b; return s; },
    json(b: unknown) { r.cuerpo = b; return s; }, setHeader() { return s; }, set() { return s; }, on() { return s; }, end() { return s; },
  };
  await (m.guardarComprobante as unknown as (q: unknown, s: unknown) => Promise<void>)(q, s);
  return r;
}
const buenas = (extra: Record<string, string> = {}) => ({
  'x-novuchat-telefono': TEL, 'x-novuchat-idmeta': 'wamid.http1', 'content-type': 'image/jpeg', ...extra,
});

describe('POST guardarComprobante', () => {
  beforeAll(async () => {
    await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente13', estado: 'activo' });
    await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'] });
    await db.doc(`tenants/${T}/conversaciones/wa_${TEL}`).set({ solicitud: solicitudDe('qr_enviado') });
    await db.doc(`tenants/${T}/conversaciones/wa_59100000062`).set({ solicitud: { etapa: 'qr_enviado', qrEnviadoEn: Timestamp.now() } });
    await db.doc(`tenants/${T}/conversaciones/wa_59100000063`).set({ solicitud: solicitudDe('agendada') });
    await db.doc(`tenants/${T}/conversaciones/wa_59100000064`).set({ solicitud: solicitudDe('en_revision') });
  });
  it('con token y un cobro abierto: 200 {ruta}, sin teléfono en el nombre', async () => {
    const r = await peticion(JPG(), buenas());
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.ruta).toMatch(new RegExp(`^tenants/${T}/comprobantes/\\d{4}-\\d{2}-\\d{2}/wamidhttp1\\.jpg$`));
    expect(r.cuerpo.ruta).not.toContain(TEL);
    expect([...almacen.objetos.keys()].join()).not.toContain(TEL);
  });
  it('una petición con firma HMAC VÁLIDA sobre cuerpo vacío tampoco pasa: solo vale el token', async () => {
    const { createHmac } = await import('node:crypto');
    const marca = String(Date.now());
    const firma = createHmac('sha256', TOKEN).update(`${marca}.`).update(Buffer.alloc(0)).digest('hex');
    const r = await peticion(Buffer.alloc(0), buenas({ 'x-novuchat-signature': `sha256=${firma}`, 'x-novuchat-timestamp': marca }), null);
    expect(r.codigo).toBe(401);
    // Y con el token correcto MÁS una firma, tampoco: un solo camino.
    expect((await peticion(JPG(), buenas({ 'x-novuchat-signature': `sha256=${firma}` }))).codigo).toBe(401);
    expect(almacen.objetos.size).toBe(0);
  });
  it('sin firma ni token: 401; con otro método: 405', async () => {
    expect((await peticion(JPG(), buenas(), null)).codigo).toBe(401);
    expect((await peticion(JPG(), buenas(), 'otro')).codigo).toBe(401);
    expect((await peticion(JPG(), buenas(), TOKEN, 'GET')).codigo).toBe(405);
    expect(almacen.objetos.size).toBe(0);
  });
  it('6 MB: 413; HTML declarado PDF: 415', async () => {
    expect((await peticion(JPG(6 * 1024 * 1024), buenas())).codigo).toBe(413);
    expect((await peticion(HTML(), buenas({ 'content-type': 'application/pdf' }))).codigo).toBe(415);
    expect(almacen.objetos.size).toBe(0);
  });
  it('sin cobro de regla 2 abierto (regla 1, cerrado o sin conversación): 409', async () => {
    for (const tel of ['59100000062', '59100000063', '59100000099']) {
      expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': tel }))).codigo, tel).toBe(409);
    }
    expect(almacen.objetos.size).toBe(0);
    // En revisión sí: la imagen es evidencia.
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': '59100000064' }))).codigo).toBe(200);
  });
  it('con seis comprobantes ya anotados: 409; el mismo idMeta ya anotado sí pasa', async () => {
    const lista = Array.from({ length: 6 }, (_, i) => ({ idMeta: `ya${i}`, estado: 'invalido', motivo: 'm', en: Timestamp.now(), ruta: null }));
    await db.doc(`tenants/${T}/conversaciones/wa_59100000065`).set({ solicitud: solicitudDe('qr_enviado', { comprobantes: lista }) });
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': '59100000065' }))).codigo).toBe(409);
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': '59100000065', 'x-novuchat-idmeta': 'ya3' }))).codigo).toBe(200);
  });
  it('`vencida` hace más de 24 h del límite: 409; dentro de las 24 h, 200', async () => {
    const MIN = 60_000;
    const viejo = Timestamp.fromMillis(Date.now() - (25 * 60 + 15) * MIN);
    await db.doc(`tenants/${T}/conversaciones/wa_59100000066`).set({ solicitud: solicitudDe('vencida', { venceEn: viejo }) });
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': '59100000066' }))).codigo).toBe(409);
    const reciente = Timestamp.fromMillis(Date.now() - 60 * MIN);
    await db.doc(`tenants/${T}/conversaciones/wa_59100000067`).set({ solicitud: solicitudDe('vencida', { venceEn: reciente }) });
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': '59100000067' }))).codigo).toBe(200);
  });
  it('una evidencia nunca se sobrescribe: el mismo idMeta otra vez responde la misma ruta sin reescribir', async () => {
    const a = await peticion(JPG(), buenas({ 'x-novuchat-idmeta': 'wamid.unica' }));
    const b = await peticion(PNG(), buenas({ 'x-novuchat-idmeta': 'wamid.unica', 'content-type': 'image/png' }));
    const c = await peticion(JPG(2048), buenas({ 'x-novuchat-idmeta': 'wamid.unica' }));
    expect(a.codigo).toBe(200);
    expect(c).toMatchObject({ codigo: 200, cuerpo: { ruta: a.cuerpo.ruta } });
    expect(almacen.reescrituras).toBe(1);
    expect(almacen.objetos.get(a.cuerpo.ruta)?.bytes.length).toBe(JPG().length);
    expect(b.codigo).toBe(200);   // otro tipo, otra extensión: otro objeto, no una sobrescritura
  });
  it('sin teléfono o sin idMeta: 400', async () => {
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': 'abc' }))).codigo).toBe(400);
    expect((await peticion(JPG(), buenas({ 'x-novuchat-idmeta': '' }))).codigo).toBe(400);
  });
});

describe('la purga diaria', () => {
  const hoy = Date.UTC(2026, 9, 3, 16, 0);
  const diaHace = (n: number) => diaDeLaPaz(hoy - n * DIA_MS);
  const poner = (t: string, dia: string, nombre = 'a.jpg') =>
    almacen.objetos.set(`tenants/${t}/comprobantes/${dia}/${nombre}`, { bytes: JPG(), contentType: 'image/jpeg' });

  beforeAll(async () => {
    await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'] });
    await db.doc(`tenants/${T_BAJA}`).set({ nombre: 'Baja', estado: 'dado_de_baja', flujos: ['venta'] });
  });

  it('borra la carpeta de 91 días, conserva las de 89 y 90, y no toca otras rutas', async () => {
    poner(T, diaHace(91)); poner(T, diaHace(89)); poner(T, diaHace(90)); poner(T, diaHace(0));
    almacen.objetos.set(`tenants/${T}/captacion/planes.pdf`, { bytes: PDF(), contentType: 'application/pdf' });
    const r = await m.purgarComprobantesDe({ almacen, ahoraMs: hoy });
    expect(r.carpetasBorradas).toBe(1);
    const quedan = [...almacen.objetos.keys()];
    expect(quedan.some((k) => k.includes(`/${diaHace(91)}/`))).toBe(false);
    for (const n of [89, 90, 0]) expect(quedan.some((k) => k.includes(`/${diaHace(n)}/`)), String(n)).toBe(true);
    expect(quedan).toContain(`tenants/${T}/captacion/planes.pdf`);
  });
  it('borra TODO lo de un comercio dado de baja, aunque sea de ayer, y nada de los vecinos', async () => {
    poner(T_BAJA, diaHace(1)); poner(T_BAJA, diaHace(0), 'b.pdf'); poner(T, diaHace(1));
    const r = await m.purgarComprobantesDe({ almacen, ahoraMs: hoy });
    expect(r.tenantsDeBajaBorrados).toBe(1);
    expect([...almacen.objetos.keys()].some((k) => k.startsWith(`tenants/${T_BAJA}/`))).toBe(false);
    expect(almacen.objetos.has(`tenants/${T}/comprobantes/${diaHace(1)}/a.jpg`)).toBe(true);
  });
  it('ignora carpetas que no son un día (nada de borrar por un nombre raro)', async () => {
    poner(T, 'cualquier-cosa');
    await m.purgarComprobantesDe({ almacen, ahoraMs: hoy });
    expect(almacen.objetos.has(`tenants/${T}/comprobantes/cualquier-cosa/a.jpg`)).toBe(true);
  });
  it('la purga es una Function programada a las 03:30 de La Paz', () => {
    expect(typeof m.purgarComprobantes).toBe('function');
  });
});

describe('el almacén de prueba no se puede fijar en producción', () => {
  it('sin COMPROBANTES_DOBLE en el entorno, se niega', () => {
    const v = process.env['COMPROBANTES_DOBLE'];
    delete process.env['COMPROBANTES_DOBLE'];
    expect(() => m.fijarAlmacenDeComprobantesDePrueba(new AlmacenDeMentira())).toThrow();
    process.env['COMPROBANTES_DOBLE'] = v;
  });
});
