/**
 * MEDIOS ENTRANTES GUARDADOS (Core, H3 PR-1): `guardarMedio` y `purgarMedios`.
 *
 * Con un `Almacen` de mentira (el emulador de Firestore no trae Storage). Se escribe negando: sin token,
 * con firma, token de otro número, bandera apagada, sin mensaje, mensaje saliente, HTML rotulado jpeg,
 * SVG, docx, cada tope +1 byte, tope diario de 3.000 (el 3.001 da 429) y por bytes, constancia de tope
 * acotada a 50, el modo anotar (solo docx/xlsx), repetido sin reescritura, y que
 * cierres, comprobantes, métricas y solicitud queden intactos. La purga: 89, 90 y 91 días, la baja y un
 * comercio que falla.
 *
 * Contrato v2 (30/10/2026, «guardar TODO»): video nuevo, documentos de cualquier tipo (16 MB, lo
 * desconocido como `bin`/octet-stream), objeto con octet-stream para documentos, sticker como image,
 * topes por teléfono (100 medios y 500 MiB, `cupo_telefono_lleno`) y 3 GiB por comercio.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['MEDIOS_DOBLE'] = '1';
const TOKEN = 'valor-de-prueba-de-medios-uno';
const TOKEN_AJENO = 'valor-de-prueba-de-medios-dos';
process.env['INGESTA_CLIENTE13'] = TOKEN;
process.env['INGESTA_CLIENTE14'] = TOKEN_AJENO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const al = await import('../../../functions/src/core/medios/almacen.ts');
const gm = await import('../../../functions/src/core/medios/guardarMedio.ts');
const pm = await import('../../../functions/src/core/medios/purgarMedios.ts');
const ti = await import('../../../functions/src/core/medios/tipos.ts');

const T = 'medios-tienda';
const T_APAGADO = 'medios-apagado';
const T_BAJA = 'medios-de-baja';
const T_FALLA = 'medios-que-falla';
const NUMERO = '1000000013';
const NUMERO_AJENO = '1000000014';
const TEL = '59100000091';
const DIA_MS = 86_400_000;
const MIN = 60_000;

class AlmacenDeMentira implements al.Almacen {
  objetos = new Map<string, { bytes: Buffer; contentType: string }>();
  falla = false;
  fallaSubcarpetasDe: string | null = null;
  reescrituras = 0;
  async existe(ruta: string) { return this.objetos.has(ruta); }
  async guardar(ruta: string, bytes: Buffer, contentType: string) {
    if (this.falla) throw new Error('storage caído');
    if (this.objetos.has(ruta)) { this.reescrituras++; return 'existe' as const; }
    this.objetos.set(ruta, { bytes, contentType });
    return 'creado' as const;
  }
  async subcarpetas(prefijo: string) {
    if (this.fallaSubcarpetasDe && prefijo.includes(this.fallaSubcarpetasDe)) throw Object.assign(new Error('boom con ruta'), { code: 500 });
    const nombres = new Set<string>();
    for (const r of this.objetos.keys()) if (r.startsWith(prefijo)) nombres.add(r.slice(prefijo.length).split('/')[0] as string);
    return [...nombres];
  }
  async borrarPrefijo(prefijo: string) {
    let n = 0;
    for (const r of [...this.objetos.keys()]) if (r.startsWith(prefijo)) { this.objetos.delete(r); n++; }
    return n;
  }
  async metadatos(ruta: string) { const o = this.objetos.get(ruta); return o ? { tamano: o.bytes.length } : null; }
  async leer(ruta: string) { return this.objetos.get(ruta)?.bytes ?? null; }
}
let almacen = new AlmacenDeMentira();

// Bytes de cada formato.
const JPG = (n = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4)]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const WEBP = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)]);
const OGG = (n = 2048) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(n - 4)]);
const M4A = () => Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(100)]);
const MP3_ID3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]);
const MP3_TRAMA = () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90]), Buffer.alloc(100)]);
const AAC = () => Buffer.concat([Buffer.from([0xff, 0xf1]), Buffer.alloc(100)]);
const AMR = () => Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(100)]);
const PDF = (n = 1024) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n - 9)]);
const HTML = () => Buffer.from('<html><script>alert(1)</script></html>');
const SVG = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const DOCX = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
const MP4 = (marca = 'isom', n = 256) => {
  const b = Buffer.alloc(Math.max(n, 24));
  b.writeUInt32BE(24, 0); b.write('ftyp', 4, 'latin1'); b.write(marca, 8, 'latin1');
  return b;
};
const MZ = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
const OOXML_DOCX = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('[Content_Types].xml'),
  Buffer.from('word/document.xml'), Buffer.alloc(64)]);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('el tipo se decide por los bytes', () => {
  it('reconoce jpeg, png, webp, ogg, m4a, mp3 (ID3 y trama), aac, amr y pdf', () => {
    const casos: [Buffer, string, string][] = [
      [JPG(), 'jpg', 'image'], [PNG(), 'png', 'image'], [WEBP(), 'webp', 'image'], [OGG(), 'ogg', 'audio'],
      [M4A(), 'm4a', 'audio'], [MP3_ID3(), 'mp3', 'audio'], [MP3_TRAMA(), 'mp3', 'audio'], [AAC(), 'aac', 'audio'],
      [AMR(), 'amr', 'audio'], [PDF(), 'pdf', 'document'],
    ];
    for (const [b, ext, tipo] of casos) expect(ti.tipoPorFirma(b), ext).toMatchObject({ ext, tipo });
  });
  it('NIEGA: ftyp de video (isom, mp42), y un PDF que también es ZIP (políglota)', () => {
    for (const marca of ['isom', 'mp42', 'mp41', 'iso2']) {
      expect(ti.tipoPorFirma(Buffer.concat([Buffer.alloc(4), Buffer.from(`ftyp${marca}`), Buffer.alloc(50)])), marca).toBeNull();
    }
    expect(ti.tipoPorFirma(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(50)]))).toBeNull();
    expect(ti.tipoPorFirma(PDF())).toMatchObject({ ext: 'pdf' });
  });
  it('NIEGA: HTML, SVG, docx, texto, un RIFF que no es WEBP, un ftyp de otra marca y bytes vacíos', () => {
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(50)]);
    for (const b of [HTML(), SVG(), DOCX(), Buffer.from('hola'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]), heic, Buffer.alloc(0), Buffer.alloc(20)]) {
      expect(ti.tipoPorFirma(b)).toBeNull();
    }
  });
});

describe('la ruta', () => {
  it('es tenants/{t}/medios/{día de La Paz}/{sha256(idMeta)}.{ext}, sin teléfono', () => {
    const r = gm.rutaDeMedio(T, '2026-10-23', 'wamid.HBg=Lw==', 'ogg');
    expect(r).toBe(`tenants/${T}/medios/2026-10-23/${al.nombreDeObjeto('wamid.HBg=Lw==')}.ogg`);
    expect(r).toMatch(/^tenants\/[\w-]+\/medios\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{43}\.(jpg|png|webp|ogg|m4a|mp3|aac|amr|mp4|3gp|pdf|docx|xlsx|pptx|zip|doc|xls|ppt|txt|csv|bin)$/);
  });
  it('el día es el de La Paz: 23:30 del 3 en La Paz es el 4 en UTC y cae en la carpeta del 3', () => {
    expect(al.diaDeLaPaz(Date.UTC(2026, 9, 4, 3, 30))).toBe('2026-10-03');
    expect(al.diaDeLaPaz(Date.UTC(2026, 9, 3, 16, 0))).toBe('2026-10-03');
  });
});

async function peticion(cuerpo: Buffer, cabeceras: Record<string, string>, token: string | null = TOKEN, metodo = 'POST', numero = NUMERO) {
  const h: Record<string, string> = { 'x-novuchat-numero': numero, ...cabeceras };
  if (token) h['authorization'] = `Bearer ${token}`;
  const leer = (n: string) => h[n.toLowerCase()];
  const q = { method: metodo, body: cuerpo, rawBody: cuerpo, headers: h, get: leer, header: leer };
  const r: { codigo: number; cuerpo: any } = { codigo: 0, cuerpo: null };
  const s = {
    status(c: number) { r.codigo = c; return s; }, send(b: unknown) { r.cuerpo = b; return s; },
    json(b: unknown) { r.cuerpo = b; return s; }, setHeader() { return s; }, set() { return s; }, on() { return s; }, end() { return s; },
  };
  await (gm.guardarMedio as unknown as (q: unknown, s: unknown) => Promise<void>)(q, s);
  return r;
}

let contador = 0;
const idNuevo = () => `wamid.medios.${Date.now()}.${contador++}`;
const buenas = (idMeta: string, tipo: string, contentType: string, extra: Record<string, string> = {}) => ({
  'x-novuchat-telefono': TEL, 'x-novuchat-idmeta': idMeta, 'x-novuchat-tipo': tipo, 'content-type': contentType, ...extra,
});
const anotar = (idMeta: string, mime: string, extra: Record<string, string> = {}) => ({
  'x-novuchat-telefono': TEL, 'x-novuchat-idmeta': idMeta, 'x-novuchat-tipo': 'document',
  'x-novuchat-anotar': '1', 'x-novuchat-mime': mime, ...extra,
});
async function mensaje(idMeta: string, extra: Record<string, unknown> = {}, tel = TEL, tenant = T) {
  const ref = db.collection(`tenants/${tenant}/conversaciones/wa_${tel}/mensajes`).doc();
  await ref.set({ direccion: 'entrante', tipo: 'audio', idMeta, texto: '', ts: Timestamp.now(), ...extra });
  return ref;
}
const hoy = () => al.diaDeLaPaz(Date.now());
const cupoRef = () => db.doc(`tenants/${T}/cuposDeMedios/${hoy()}`);

beforeAll(async () => {
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente13', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUMERO_AJENO}`).set({ tenantId: T_APAGADO, flujo: 'venta', aliasSecreto: 'cliente14', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'], guardarMedios: true });
  await db.doc(`tenants/${T_APAGADO}`).set({ nombre: 'Apagado', estado: 'activo', flujos: ['venta'] });
  await db.doc(`tenants/${T}/conversaciones/wa_${TEL}`).set({ telefono: TEL, ultimoMensaje: 'hola' });
});
beforeEach(async () => {
  almacen = new AlmacenDeMentira();
  al.fijarAlmacenDeMediosDePrueba(almacen);
  await cupoRef().delete();
});

describe('POST guardarMedio: lo que entra', () => {
  const formatos: [string, () => Buffer, string, string, string][] = [
    ['jpeg', () => JPG(), 'image', 'image/jpeg', 'jpg'], ['png', PNG, 'image', 'image/png', 'png'],
    ['webp', WEBP, 'image', 'image/webp', 'webp'], ['ogg con codecs', () => OGG(), 'audio', 'audio/ogg; codecs=opus', 'ogg'],
    ['m4a', M4A, 'audio', 'audio/mp4', 'm4a'], ['mp3', MP3_ID3, 'audio', 'audio/mpeg', 'mp3'],
    ['aac', AAC, 'audio', 'audio/aac', 'aac'], ['amr', AMR, 'audio', 'audio/amr', 'amr'], ['pdf', () => PDF(), 'document', 'application/pdf', 'pdf'],
    ['mp4', () => MP4('isom'), 'video', 'video/mp4', 'mp4'], ['3gp', () => MP4('3gp4'), 'video', 'video/3gpp', '3gp'],
    ['docx', OOXML_DOCX, 'document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['zip', DOCX, 'document', 'application/zip', 'zip'], ['exe como documento', MZ, 'document', 'application/x-msdownload', 'bin'],
  ];
  it.each(formatos)('%s: 200, ruta sin teléfono, registro, marca en el mensaje y vence a 90 días', async (_n, bytes, tipo, ct, ext) => {
    const id = idNuevo();
    const m = await mensaje(id, { tipo });
    const r = await peticion(bytes(), buenas(id, tipo, ct));
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.repetido).toBe(false);
    expect(r.cuerpo.ruta).toMatch(new RegExp(`^tenants/${T}/medios/\\d{4}-\\d{2}-\\d{2}/${al.nombreDeObjeto(id)}\\.${ext}$`));
    expect(r.cuerpo.ruta).not.toContain(TEL);
    expect([...almacen.objetos.keys()].join()).not.toContain(TEL);
    const reg = await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get();
    expect(reg.data()).toMatchObject({ idMeta: id, conversacionId: `wa_${TEL}`, tipo, categoria: tipo, ext, tamano: bytes().length, ruta: r.cuerpo.ruta, estado: 'guardado' });
    // El objeto: octet-stream si es documento; el mime verificado si es imagen, audio o video.
    const objeto = almacen.objetos.get(r.cuerpo.ruta);
    if (tipo === 'document') expect(objeto?.contentType).toBe('application/octet-stream');
    else expect(objeto?.contentType).toBe(reg.get('mime'));
    if (ext === 'bin') expect(reg.get('mime')).toBe('application/octet-stream');
    expect(reg.get('sha256')).toMatch(/^[0-9a-f]{64}$/);
    const dias = (reg.get('vence').toMillis() - reg.get('en').toMillis()) / DIA_MS;
    expect(dias).toBe(90);
    const marca = (await m.get()).get('medio');
    expect(marca).toMatchObject({ estado: 'guardado', tamano: bytes().length });
    expect(marca.vence.toMillis()).toBe(reg.get('vence').toMillis());
    // El cupo del día se anotó, con vence para el TTL.
    expect((await cupoRef().get()).data()).toMatchObject({ n: 1, bytes: bytes().length });
    // El contador caduca por TTL a los 2 días (contrato M1-M2 §3).
    const venceCupo = (await cupoRef().get()).get('vence').toMillis();
    expect(Math.round((venceCupo - reg.get('en').toMillis()) / DIA_MS)).toBe(2);
  });

  it('exactamente en cada tope entra: imagen 5 MB, audio 16 MB, video 16 MB, documento 16 MB', async () => {
    for (const [tipo, bytes, ct] of [['image', JPG(5 * ti.MB), 'image/jpeg'], ['audio', OGG(16 * ti.MB), 'audio/ogg'],
      ['video', MP4('isom', 16 * ti.MB), 'video/mp4'], ['document', PDF(16 * ti.MB), 'application/pdf']] as const) {
      const id = idNuevo();
      await mensaje(id, { tipo });
      expect((await peticion(bytes, buenas(id, tipo, ct))).codigo, tipo).toBe(200);
    }
  });

  it('el mensaje puede ser de una conversación TOMADA por una persona (D1): no se mira el turno', async () => {
    await db.doc(`tenants/${T}/conversaciones/wa_59100000092`).set({ telefono: '59100000092', turno: { responde: 'persona', tomadoPor: 'u-oper' } });
    const id = idNuevo();
    await mensaje(id, { tipo: 'image' }, '59100000092');
    expect((await peticion(JPG(), buenas(id, 'image', 'image/jpeg', { 'x-novuchat-telefono': '59100000092' }))).codigo).toBe(200);
  });
});

describe('POST guardarMedio: lo que NO entra', () => {
  const nada = () => expect(almacen.objetos.size).toBe(0);

  it('sin token: 401; con otro método: 405', async () => {
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'), null)).codigo).toBe(401);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'), 'otro')).codigo).toBe(401);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'), TOKEN, 'GET')).codigo).toBe(405);
    nada();
  });

  it('con firma HMAC (aunque sea válida, y aunque venga con el token correcto): 401, un solo camino', async () => {
    const { createHmac } = await import('node:crypto');
    const id = idNuevo(); await mensaje(id);
    const marca = String(Date.now());
    const firma = createHmac('sha256', TOKEN).update(`${marca}.`).update(Buffer.alloc(0)).digest('hex');
    expect((await peticion(Buffer.alloc(0), buenas(id, 'audio', 'audio/ogg', { 'x-novuchat-signature': `sha256=${firma}`, 'x-novuchat-timestamp': marca }), null)).codigo).toBe(401);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg', { 'x-novuchat-signature': `sha256=${firma}` }))).codigo).toBe(401);
    nada();
  });

  it('el token de OTRO número no sirve con este número (401) ni escribe en este comercio', async () => {
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'), TOKEN_AJENO)).codigo).toBe(401);
    nada();
  });

  it('el token de otro comercio solo llega a SU comercio: sin esa conversación ahí, 409 y nada en el comercio ajeno', async () => {
    await db.doc(`tenants/${T_APAGADO}`).update({ guardarMedios: true });
    try {
      const id = idNuevo(); await mensaje(id); // el mensaje existe en T, no en T_APAGADO
      const r = await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'), TOKEN_AJENO, 'POST', NUMERO_AJENO);
      expect(r.codigo).toBe(409);
      expect(r.cuerpo.error).toBe('sin_mensaje');
      nada();
      expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).exists).toBe(false);
      expect((await db.collection(`tenants/${T}/mediosRecibidos`).where('idMeta', '==', id).get()).size).toBe(0);
    } finally {
      await db.doc(`tenants/${T_APAGADO}`).update({ guardarMedios: (await import('firebase-admin/firestore')).FieldValue.delete() });
    }
  });

  it('la bandera APAGADA (ausente, false o no booleana): 409 y no se guarda NADA', async () => {
    const id = idNuevo(); await mensaje(id);
    for (const valor of [undefined, false, 'true', 1]) {
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.doc(`tenants/${T}`).update({ guardarMedios: valor === undefined ? FieldValue.delete() : valor });
      const r = await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'));
      expect(r.codigo, String(valor)).toBe(409);
      expect(r.cuerpo.error).toBe('guardado_apagado');
    }
    await db.doc(`tenants/${T}`).update({ guardarMedios: true });
    nada();
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).exists).toBe(false);
    expect((await cupoRef().get()).exists).toBe(false);
  });

  it('la ruta no activa: 409', async () => {
    await db.doc(`rutasWhatsApp/${NUMERO}`).update({ estado: 'pausada' });
    try {
      const id = idNuevo(); await mensaje(id);
      expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(409);
      nada();
    } finally { await db.doc(`rutasWhatsApp/${NUMERO}`).update({ estado: 'activo' }); }
  });

  it('teléfono o idMeta inválidos, tipo faltante o cuerpo vacío: 400', async () => {
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg', { 'x-novuchat-telefono': 'abc' }))).codigo).toBe(400);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg', { 'x-novuchat-telefono': '1234567' }))).codigo).toBe(400);
    expect((await peticion(OGG(), buenas('', 'audio', 'audio/ogg'))).codigo).toBe(400);
    expect((await peticion(OGG(), buenas(id, '', 'audio/ogg'))).codigo).toBe(400);
    // `video` ya es un tipo (contrato v2); `sticker` no: llega como image.
    expect((await peticion(OGG(), buenas(id, 'sticker', 'audio/ogg'))).codigo).toBe(400);
    expect((await peticion(Buffer.alloc(0), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(400);
    nada();
  });

  it('SIN MENSAJE: ni uno con ese idMeta, ni uno saliente, ni de otro tipo, ni de hace más de 30 minutos: 409', async () => {
    const solo = idNuevo();
    expect((await peticion(OGG(), buenas(solo, 'audio', 'audio/ogg'))).cuerpo).toEqual({ error: 'sin_mensaje' });
    const saliente = idNuevo(); await mensaje(saliente, { direccion: 'saliente' });
    expect((await peticion(OGG(), buenas(saliente, 'audio', 'audio/ogg'))).codigo).toBe(409);
    const otroTipo = idNuevo(); await mensaje(otroTipo, { tipo: 'image' });
    expect((await peticion(OGG(), buenas(otroTipo, 'audio', 'audio/ogg'))).codigo).toBe(409);
    const viejo = idNuevo(); await mensaje(viejo, { ts: Timestamp.fromMillis(Date.now() - 31 * MIN) });
    expect((await peticion(OGG(), buenas(viejo, 'audio', 'audio/ogg'))).codigo).toBe(409);
    const otraConversacion = idNuevo(); await mensaje(otraConversacion, {}, '59100000099');
    expect((await peticion(OGG(), buenas(otraConversacion, 'audio', 'audio/ogg'))).codigo).toBe(409);
    nada();
    // Control: de hace 29 minutos sí.
    const reciente = idNuevo(); await mensaje(reciente, { ts: Timestamp.fromMillis(Date.now() - 29 * MIN) });
    expect((await peticion(OGG(), buenas(reciente, 'audio', 'audio/ogg'))).codigo).toBe(200);
  });

  it('un HTML rotulado jpeg, un SVG o un exe como imagen, un video falso: 415, y no se guarda nada', async () => {
    // CAMBIO del contrato v2: docx/HTML como DOCUMENTO ya no son 415 (se guardan como bin): ver abajo.
    for (const [bytes, tipo, ct] of [
      [HTML(), 'image', 'image/jpeg'], [SVG(), 'image', 'image/svg+xml'], [SVG(), 'image', 'image/jpeg'], [MZ(), 'image', 'image/png'],
      [HTML(), 'audio', 'audio/ogg'], [HTML(), 'video', 'video/mp4'], [M4A(), 'video', 'video/mp4'], [MP4('isom'), 'audio', 'audio/mp4'],
    ] as const) {
      const id = idNuevo(); await mensaje(id, { tipo });
      const r = await peticion(bytes, buenas(id, tipo, ct));
      expect(r.codigo, `${tipo} ${ct}`).toBe(415);
    }
    nada();
  });

  it('el tipo real no coincide con la cabecera o con el Content-Type: 415', async () => {
    const id = idNuevo(); await mensaje(id, { tipo: 'audio' });
    expect((await peticion(JPG(), buenas(id, 'audio', 'image/jpeg'))).codigo).toBe(415);
    expect((await peticion(OGG(), buenas(id, 'audio', 'image/jpeg'))).codigo).toBe(415);
    expect((await peticion(OGG(), buenas(id, 'audio', ''))).codigo).toBe(415);
    nada();
  });

  it('cada tope + 1 byte: imagen 5 MB, audio, video y documento (cualquiera) 16 MB dan 413', async () => {
    for (const [tipo, bytes, ct] of [
      ['image', JPG(5 * ti.MB + 1), 'image/jpeg'], ['audio', OGG(16 * ti.MB + 1), 'audio/ogg'], ['video', MP4('isom', 16 * ti.MB + 1), 'video/mp4'],
      ['document', PDF(16 * ti.MB + 1), 'application/pdf'], ['document', Buffer.alloc(16 * ti.MB + 1, 0x41), 'application/octet-stream'],
    ] as const) {
      const id = idNuevo(); await mensaje(id, { tipo });
      expect((await peticion(bytes, buenas(id, tipo, ct))).codigo, tipo).toBe(413);
    }
    nada();
  });

  it('TOPE DIARIO de 3.000: el 3.000 entra, el 3.001 da 429 antes de tocar Storage y sin registro', async () => {
    expect(gm.TOPE_DIARIO_DE_MEDIOS).toBe(3000);
    await cupoRef().set({ n: gm.TOPE_DIARIO_DE_MEDIOS - 1, bytes: 0, vence: Timestamp.now() });
    const ultimo = idNuevo(); await mensaje(ultimo);
    expect((await peticion(OGG(), buenas(ultimo, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect((await cupoRef().get()).get('n')).toBe(3000);
    almacen = new AlmacenDeMentira(); al.fijarAlmacenDeMediosDePrueba(almacen);
    const id = idNuevo(); await mensaje(id);
    const r = await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'));
    expect(r).toMatchObject({ codigo: 429, cuerpo: { error: 'cupo_diario_lleno' } });
    nada();
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).exists).toBe(false);
    expect((await cupoRef().get()).get('n')).toBe(3000);
    // Tampoco se anota un docx con el tope lleno.
    const doc = idNuevo(); await mensaje(doc, { tipo: 'document' });
    expect((await peticion(Buffer.alloc(0), anotar(doc, DOCX_MIME))).codigo).toBe(429);
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(doc)}`).get()).exists).toBe(false);
  });

  it('la constancia de «tope superado» NO pasa de 50 por día: después el 429 no escribe nada', async () => {
    expect(gm.MAX_ANOTACIONES_DE_TOPE).toBe(50);
    await cupoRef().set({ n: gm.TOPE_DIARIO_DE_MEDIOS, bytes: 0, vence: Timestamp.now() });
    const id = idNuevo(); await mensaje(id);
    for (let i = 0; i < 53; i++) {
      // Un idMeta distinto por vez, como haría un abusador: el repetido no es lo que se cuenta.
      const otro = `${id}.${i}`; await mensaje(otro);
      expect((await peticion(OGG(), buenas(otro, 'audio', 'audio/ogg'))).codigo).toBe(429);
    }
    const c = await cupoRef().get();
    expect(c.get('rechazados')).toBe(50);
    expect(c.get('n')).toBe(3000);
    expect(c.get('ultimoRechazo')).toBeDefined();
    const tiempo = c.updateTime;
    const ultimo = `${id}.final`; await mensaje(ultimo);
    expect((await peticion(OGG(), buenas(ultimo, 'audio', 'audio/ogg'))).codigo).toBe(429);
    expect((await cupoRef().get()).updateTime.isEqual(tiempo)).toBe(true);
    expect((await db.collection(`tenants/${T}/mediosRecibidos`).where('idMeta', '>=', id).where('idMeta', '<', `${id}~`).get()).size).toBe(0);
    nada();
  });

  it('tope de BYTES por comercio (3 GiB, bajó de 15 el 30/10): 429 si no cabe; con un medio que cabe justo, 200', async () => {
    expect(gm.TOPE_DIARIO_DE_BYTES).toBe(3 * 1024 * 1024 * 1024);
    const bytes = OGG(2048);
    await cupoRef().set({ n: 5, bytes: gm.TOPE_DIARIO_DE_BYTES - 2047, vence: Timestamp.now() });
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(bytes, buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(429);
    nada();
    await cupoRef().set({ n: 5, bytes: gm.TOPE_DIARIO_DE_BYTES - 2048, vence: Timestamp.now() });
    expect((await peticion(bytes, buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect((await cupoRef().get()).get('bytes')).toBe(gm.TOPE_DIARIO_DE_BYTES);
  });

  it('si Storage falla: 502, el cupo se devuelve UNA vez y no queda registro ni marca', async () => {
    await cupoRef().set({ n: 7, bytes: 100, vence: Timestamp.now() });
    const id = idNuevo(); const m = await mensaje(id);
    almacen.falla = true;
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(502);
    expect((await cupoRef().get()).data()).toMatchObject({ n: 7, bytes: 100 });
    // Un segundo intento que también falla no devuelve de más: el cupo no baja de lo que había.
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(502);
    expect((await cupoRef().get()).data()).toMatchObject({ n: 7, bytes: 100 });
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).exists).toBe(false);
    expect((await m.get()).get('medio')).toBeUndefined();
    almacen.falla = false;
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect((await cupoRef().get()).get('n')).toBe(8);
  });
});

describe('POST guardarMedio: modo ANOTAR (docx y xlsx, sin bytes)', () => {
  const regDe = (id: string) => db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`);
  const nada = () => expect(almacen.objetos.size).toBe(0);

  it.each([['docx', DOCX_MIME], ['xlsx', XLSX_MIME]])('%s: 200 {anotado:true}, metadato anotado sin ruta ni bytes, marca y UN cupo', async (ext, mime) => {
    const id = idNuevo(); const m = await mensaje(id, { tipo: 'document' });
    const r = await peticion(Buffer.alloc(0), anotar(id, mime));
    expect(r).toEqual({ codigo: 200, cuerpo: { anotado: true, repetido: false } });
    expect(almacen.objetos.size).toBe(0);
    const reg = await regDe(id).get();
    expect(reg.data()).toMatchObject({ idMeta: id, conversacionId: `wa_${TEL}`, tipo: 'document', mime, ext, estado: 'anotado', ruta: null, tamano: null, sha256: null });
    expect((reg.get('vence').toMillis() - reg.get('en').toMillis()) / DIA_MS).toBe(90);
    expect((await m.get()).get('medio')).toMatchObject({ estado: 'anotado', mime, tamano: null });
    expect((await cupoRef().get()).data()).toMatchObject({ n: 1, bytes: 0 });
    // Repetido: 200 anotado, sin gastar otro cupo ni reescribir.
    const antes = reg.updateTime;
    expect(await peticion(Buffer.alloc(0), anotar(id, mime))).toEqual({ codigo: 200, cuerpo: { anotado: true, repetido: true } });
    expect((await regDe(id).get()).updateTime.isEqual(antes)).toBe(true);
    expect((await cupoRef().get()).get('n')).toBe(1);
  });

  it('NIEGA: con Anotar, un mime que no es docx/xlsx da 415 (pdf, jpeg, doc viejo, html, vacío) y nada se escribe', async () => {
    for (const mime of ['application/pdf', 'image/jpeg', 'application/msword', 'application/vnd.ms-excel', 'text/html', 'image/svg+xml', 'application/zip', '', '__proto__', 'constructor']) {
      const id = idNuevo(); await mensaje(id, { tipo: 'document' });
      const r = await peticion(Buffer.alloc(0), anotar(id, mime));
      expect(r, mime).toMatchObject({ codigo: 415, cuerpo: { error: 'tipo_no_admitido' } });
      expect((await regDe(id).get()).exists, mime).toBe(false);
    }
    expect((await cupoRef().get()).exists).toBe(false);
    nada();
  });

  it('NIEGA: Anotar con tipo image o audio da 415; Anotar CON BYTES da 400 anotar_con_cuerpo y no guarda los bytes', async () => {
    for (const tipo of ['image', 'audio']) {
      const id = idNuevo(); await mensaje(id, { tipo });
      expect((await peticion(Buffer.alloc(0), anotar(id, DOCX_MIME, { 'x-novuchat-tipo': tipo }))).codigo, tipo).toBe(415);
    }
    for (const bytes of [DOCX(), PDF(), JPG()]) {
      const id = idNuevo(); await mensaje(id, { tipo: 'document' });
      expect(await peticion(bytes, anotar(id, DOCX_MIME))).toMatchObject({ codigo: 400, cuerpo: { error: 'anotar_con_cuerpo' } });
      expect((await regDe(id).get()).exists).toBe(false);
    }
    // Un Anotar distinto de «1» no activa el modo: un cuerpo vacío sigue siendo 400 vacio.
    const id = idNuevo(); await mensaje(id, { tipo: 'document' });
    expect((await peticion(Buffer.alloc(0), anotar(id, DOCX_MIME, { 'x-novuchat-anotar': 'si' }))).cuerpo).toEqual({ error: 'vacio' });
    expect((await cupoRef().get()).exists).toBe(false);
    nada();
  });

  it('NIEGA: Anotar sin mensaje entrante del tipo document da 409 sin_mensaje; con la bandera apagada, 409 guardado_apagado', async () => {
    const solo = idNuevo();
    expect((await peticion(Buffer.alloc(0), anotar(solo, DOCX_MIME))).cuerpo).toEqual({ error: 'sin_mensaje' });
    const deImagen = idNuevo(); await mensaje(deImagen, { tipo: 'image' });
    expect((await peticion(Buffer.alloc(0), anotar(deImagen, DOCX_MIME))).codigo).toBe(409);
    const id = idNuevo(); await mensaje(id, { tipo: 'document' });
    await db.doc(`tenants/${T}`).update({ guardarMedios: false });
    try {
      expect((await peticion(Buffer.alloc(0), anotar(id, DOCX_MIME))).cuerpo).toEqual({ error: 'guardado_apagado' });
    } finally { await db.doc(`tenants/${T}`).update({ guardarMedios: true }); }
    expect((await regDe(id).get()).exists).toBe(false);
    expect((await cupoRef().get()).exists).toBe(false);
  });

  it('CAMBIO v2: un docx con bytes y SIN Anotar ahora se GUARDA (docx si la estructura coincide; bin si no)', async () => {
    const id = idNuevo(); await mensaje(id, { tipo: 'document' });
    const r = await peticion(DOCX(), buenas(id, 'document', DOCX_MIME));
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.ruta).toMatch(/\.bin$/);
    expect(almacen.objetos.get(r.cuerpo.ruta)?.contentType).toBe('application/octet-stream');
  });

  it('un medio ya GUARDADO al que luego llega un Anotar con su idMeta responde el repetido, sin tocar nada', async () => {
    const id = idNuevo(); await mensaje(id, { tipo: 'document' });
    const a = await peticion(PDF(), buenas(id, 'document', 'application/pdf'));
    expect(a.codigo).toBe(200);
    const b = await peticion(Buffer.alloc(0), anotar(id, DOCX_MIME));
    expect(b).toEqual({ codigo: 200, cuerpo: { ruta: a.cuerpo.ruta, repetido: true } });
    expect((await regDe(id).get()).get('estado')).toBe('guardado');
    expect((await cupoRef().get()).get('n')).toBe(1);
  });
});

describe('POST guardarMedio: un repetido y lo que no toca', () => {
  it('un repetido responde 200 con la misma ruta y NO reescribe (ni objeto, ni registro, ni marca, ni cupo)', async () => {
    const id = idNuevo(); const m = await mensaje(id);
    const a = await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'));
    expect(a.codigo).toBe(200);
    const registro = (await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get());
    const marca = (await m.get()).get('medio');
    const cupo = (await cupoRef().get()).data();
    const b = await peticion(OGG(4096), buenas(id, 'audio', 'audio/ogg'));
    expect(b).toMatchObject({ codigo: 200, cuerpo: { ruta: a.cuerpo.ruta, repetido: true } });
    expect(almacen.objetos.size).toBe(1);
    expect(almacen.objetos.get(a.cuerpo.ruta)?.bytes.length).toBe(2048);
    expect(almacen.reescrituras).toBe(0);
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).updateTime.isEqual(registro.updateTime)).toBe(true);
    expect((await m.get()).get('medio')).toEqual(marca);
    expect((await cupoRef().get()).data()).toEqual(cupo);
  });

  it('un objeto que ya estaba en Storage (intento anterior sin registro) se registra y gasta UN cupo', async () => {
    const id = idNuevo(); await mensaje(id);
    almacen.objetos.set(gm.rutaDeMedio(T, hoy(), id, 'ogg'), { bytes: OGG(), contentType: 'audio/ogg' });
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect((await cupoRef().get()).get('n')).toBe(1);
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).get('estado')).toBe('guardado');
  });

  it('CONCURRENCIA: 5 guardados simultáneos con el MISMO idMeta gastan UN solo cupo y un solo objeto', async () => {
    const id = idNuevo(); await mensaje(id);
    const bytes = OGG(3000);
    const rs = await Promise.all(Array.from({ length: 5 }, () => gm.guardarMedioDe(
      { tenantId: T, telefono: TEL, idMeta: id, tipo: 'audio', bytes, contentType: 'audio/ogg' }, { almacen })));
    for (const r of rs) expect([200, 409]).toContain(r.codigo);
    expect(rs.filter((r) => r.codigo === 200 && !(r.cuerpo as any).repetido)).toHaveLength(1);
    const cupo = (await cupoRef().get()).data();
    expect(cupo).toMatchObject({ n: 1, bytes: 3000 });
    expect(almacen.objetos.size).toBe(1);
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).get('estado')).toBe('guardado');
  });

  it('CONCURRENCIA con falla de Storage: el cupo vuelve exactamente UNA vez y no queda marcador', async () => {
    const id = idNuevo(); await mensaje(id);
    almacen.falla = true;
    const rs = await Promise.all(Array.from({ length: 4 }, () => gm.guardarMedioDe(
      { tenantId: T, telefono: TEL, idMeta: id, tipo: 'audio', bytes: OGG(3000), contentType: 'audio/ogg' }, { almacen })));
    for (const r of rs) expect([502, 409]).toContain(r.codigo);
    expect((await cupoRef().get()).get('n')).toBe(0);
    expect((await cupoRef().get()).get('bytes')).toBe(0);
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).exists).toBe(false);
  });

  it('un marcador pendiente reciente da 409 en_curso; uno viejo (instancia muerta) se retoma sin otro cupo', async () => {
    const id = idNuevo(); await mensaje(id);
    const ref = db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`);
    await cupoRef().set({ n: 1, bytes: 2048, vence: Timestamp.now() });
    await ref.set({ idMeta: id, estado: 'pendiente', ruta: gm.rutaDeMedio(T, hoy(), id, 'ogg'), en: Timestamp.now(), vence: Timestamp.now() });
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).cuerpo).toEqual({ error: 'en_curso' });
    expect(almacen.objetos.size).toBe(0);
    await ref.update({ en: Timestamp.fromMillis(Date.now() - 6 * MIN) });
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect((await cupoRef().get()).get('n')).toBe(1);
    expect((await ref.get()).get('estado')).toBe('guardado');
  });

  it('NO ES UN COMPROBANTE: no toca solicitud, cierres, comprobantesRecibidos, métricas ni conteo, ni la ficha', async () => {
    const conversacion = db.doc(`tenants/${T}/conversaciones/wa_${TEL}`);
    const antes = (await conversacion.get()).data();
    const fichaAntes = await db.doc(`tenants/${T}`).get();
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect((await conversacion.get()).data()).toEqual(antes);
    expect((await conversacion.get()).get('solicitud')).toBeUndefined();
    expect((await db.doc(`tenants/${T}`).get()).updateTime.isEqual(fichaAntes.updateTime)).toBe(true);
    const colecciones = (await db.doc(`tenants/${T}`).listCollections()).map((c) => c.id);
    for (const prohibida of ['cierres', 'comprobantesRecibidos', 'metricas', 'conteo', 'salida', 'auditoria']) {
      expect(colecciones, prohibida).not.toContain(prohibida);
    }
    expect(colecciones.sort()).toEqual(['conversaciones', 'cuposDeMedios', 'mediosRecibidos']);
  });
});

describe('la purga diaria', () => {
  const ahora = Date.UTC(2026, 9, 23, 16, 0);
  const diaHace = (n: number) => al.diaDeLaPaz(ahora - n * DIA_MS);
  const poner = (t: string, dia: string, nombre = 'a.ogg') =>
    almacen.objetos.set(`tenants/${t}/medios/${dia}/${nombre}`, { bytes: OGG(), contentType: 'audio/ogg' });
  const hay = (t: string, dia: string) => almacen.objetos.has(`tenants/${t}/medios/${dia}/a.ogg`);

  beforeAll(async () => {
    await db.doc(`tenants/${T_BAJA}`).set({ nombre: 'Baja', estado: 'dado_de_baja' });
    await db.doc(`tenants/${T_FALLA}`).set({ nombre: 'Falla', estado: 'activo' });
  });

  it('borra la carpeta de 91 días; conserva la de 90 y la de 89', async () => {
    poner(T, diaHace(91)); poner(T, diaHace(90)); poner(T, diaHace(89)); poner(T, diaHace(0));
    const r = await pm.purgarMediosDe({ almacen, ahoraMs: ahora });
    expect(hay(T, diaHace(91))).toBe(false);
    expect(hay(T, diaHace(90))).toBe(true);
    expect(hay(T, diaHace(89))).toBe(true);
    expect(hay(T, diaHace(0))).toBe(true);
    expect(r.carpetasBorradas).toBe(1);
    expect(r.errores).toBe(0);
  });

  it('un comercio dado de baja pierde todo: objetos, mediosRecibidos y cuposDeMedios', async () => {
    poner(T_BAJA, diaHace(1)); poner(T_BAJA, diaHace(60)); poner(T, diaHace(1));
    await db.doc(`tenants/${T_BAJA}/mediosRecibidos/x`).set({ idMeta: 'x' });
    await db.doc(`tenants/${T_BAJA}/cuposDeMedios/2026-10-22`).set({ n: 1 });
    const r = await pm.purgarMediosDe({ almacen, ahoraMs: ahora });
    expect(hay(T_BAJA, diaHace(1))).toBe(false);
    expect(hay(T_BAJA, diaHace(60))).toBe(false);
    expect(r.tenantsDeBajaBorrados).toBe(1);
    expect((await db.collection(`tenants/${T_BAJA}/mediosRecibidos`).get()).size).toBe(0);
    expect((await db.collection(`tenants/${T_BAJA}/cuposDeMedios`).get()).size).toBe(0);
    // Un comercio activo no pierde nada por la baja de otro.
    expect(hay(T, diaHace(1))).toBe(true);
  });

  it('un comercio que falla no detiene a los demás, y el aviso no trae rutas ni teléfonos', async () => {
    poner(T, diaHace(91)); poner(T_FALLA, diaHace(91));
    almacen.fallaSubcarpetasDe = T_FALLA;
    const avisos: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { avisos.push(a.join(' ')); };
    let r;
    try { r = await pm.purgarMediosDe({ almacen, ahoraMs: ahora }); } finally { console.error = original; }
    expect(r.errores).toBe(1);
    expect(hay(T, diaHace(91))).toBe(false);
    expect(hay(T_FALLA, diaHace(91))).toBe(true);
    expect(avisos.join('\n')).not.toMatch(/tenants\/|boom|\d{10,}/);
  });
});

describe('fallas de Firestore y pendientes retomados (revisión del #617)', () => {
  type Db = typeof db;
  /** El mismo Firestore con algunos métodos reemplazados. */
  const envuelto = (cambios: Record<string, unknown>): Db => new Proxy(db, {
    get(t, k) {
      if (typeof k === 'string' && k in cambios) return cambios[k];
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const falla = (code: number | string) => Object.assign(new Error(`falla con tenants/${T}/conversaciones/wa_${TEL}`), { code });
  const entrada = (id: string, extra: Record<string, unknown> = {}) =>
    ({ tenantId: T, telefono: TEL, idMeta: id, tipo: 'audio', bytes: OGG(), contentType: 'audio/ogg', ...extra });
  const regDe = (id: string) => db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`);
  const ayer = () => al.diaDeLaPaz(Date.now() - DIA_MS);
  const cupoDe = (dia: string) => db.doc(`tenants/${T}/cuposDeMedios/${dia}`);
  const sinTelefonoEnLogs = (espia: ReturnType<typeof vi.spyOn>) => {
    const texto = JSON.stringify(espia.mock.calls);
    expect(texto).not.toContain(TEL);
    expect(texto).not.toContain('wamid');
    expect(texto).toMatch(/código \d+/);
  };

  it('NIEGA: falla la CONSULTA del mensaje: 502 no_se_registro, nada escrito, y el log solo lleva el código', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const id = idNuevo(); await mensaje(id);
      const r = await gm.guardarMedioDe(entrada(id), { almacen, db: envuelto({ collection: () => { throw falla(14); } }) });
      expect(r).toEqual({ codigo: 502, cuerpo: { error: 'no_se_registro' } });
      expect((await regDe(id).get()).exists).toBe(false);
      expect((await cupoRef().get()).exists).toBe(false);
      expect(almacen.objetos.size).toBe(0);
      sinTelefonoEnLogs(espia);
    } finally { espia.mockRestore(); }
  });

  it('NIEGA: falla la RESERVA: 502 no_se_registro (o 409 en_curso si es ABORTED), sin cupo gastado ni marcador', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const [code, esperado] of [[14, { codigo: 502, cuerpo: { error: 'no_se_registro' } }], [10, { codigo: 409, cuerpo: { error: 'en_curso' } }], ['aborted', { codigo: 409, cuerpo: { error: 'en_curso' } }]] as const) {
        const id = idNuevo(); await mensaje(id);
        const r = await gm.guardarMedioDe(entrada(id), { almacen, db: envuelto({ runTransaction: async () => { throw falla(code); } }) });
        expect(r, String(code)).toEqual(esperado);
        expect((await regDe(id).get()).exists).toBe(false);
      }
      expect((await cupoRef().get()).exists).toBe(false);
      expect(almacen.objetos.size).toBe(0);
      sinTelefonoEnLogs(espia);
    } finally { espia.mockRestore(); }
  });

  it('NIEGA: ANOTADO con el mensaje borrado a medio camino: 502, sin metadato y sin gastar cupo', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const id = idNuevo(); const m = await mensaje(id, { tipo: 'document' });
      const borrarYSeguir = async (f: Parameters<Db['runTransaction']>[0]) => { await m.delete(); return db.runTransaction(f); };
      const r = await gm.guardarMedioDe(
        { tenantId: T, telefono: TEL, idMeta: id, tipo: 'document', bytes: Buffer.alloc(0), contentType: '', anotar: true, mime: DOCX_MIME },
        { almacen, db: envuelto({ runTransaction: borrarYSeguir }) });
      expect(r).toEqual({ codigo: 502, cuerpo: { error: 'no_se_registro' } });
      expect((await regDe(id).get()).exists).toBe(false);
      expect((await cupoRef().get()).exists).toBe(false);
      sinTelefonoEnLogs(espia);
    } finally { espia.mockRestore(); }
  });

  it('un pendiente VIEJO retomado con OTRO formato se guarda en la carpeta de su día y el cierre reescribe ruta, ext, mime y tamano', async () => {
    const id = idNuevo(); await mensaje(id);
    const viejaRuta = gm.rutaDeMedio(T, ayer(), id, 'ogg');
    await cupoDe(ayer()).set({ n: 1, bytes: 2048, vence: Timestamp.now() });
    await regDe(id).set({ idMeta: id, estado: 'pendiente', ext: 'ogg', mime: 'audio/ogg', tamano: 2048, ruta: viejaRuta, en: Timestamp.fromMillis(Date.now() - 6 * MIN), vence: Timestamp.now() });
    const r = await peticion(M4A(), buenas(id, 'audio', 'audio/mp4'));
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.ruta).toBe(gm.rutaDeMedio(T, ayer(), id, 'm4a'));
    expect((await regDe(id).get()).data()).toMatchObject({ estado: 'guardado', ruta: r.cuerpo.ruta, ext: 'm4a', mime: 'audio/mp4', tamano: M4A().length });
    expect(almacen.objetos.has(r.cuerpo.ruta)).toBe(true);
    expect((await cupoRef().get()).exists).toBe(false); // no se cobró otra vez, ni hoy
    expect((await cupoDe(ayer()).get()).get('n')).toBe(1);
  });

  it('CRUCE DE MEDIANOCHE: si Storage falla al retomar un pendiente de ayer, el cupo vuelve al contador de AYER, no al de hoy', async () => {
    const id = idNuevo(); await mensaje(id);
    await cupoDe(ayer()).set({ n: 1, bytes: 2048, vence: Timestamp.now() });
    await cupoRef().set({ n: 5, bytes: 500, vence: Timestamp.now() });
    await regDe(id).set({ idMeta: id, estado: 'pendiente', ext: 'ogg', mime: 'audio/ogg', tamano: 2048, ruta: gm.rutaDeMedio(T, ayer(), id, 'ogg'), en: Timestamp.fromMillis(Date.now() - 6 * MIN), vence: Timestamp.now() });
    almacen.falla = true;
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await peticion(OGG(4096), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(502);
    } finally { espia.mockRestore(); almacen.falla = false; }
    expect((await cupoDe(ayer()).get()).data()).toMatchObject({ n: 0, bytes: 0 });
    expect((await cupoRef().get()).data()).toMatchObject({ n: 5, bytes: 500 });
    expect((await regDe(id).get()).exists).toBe(false);
  });

  it('ANOTAR sobre un pendiente (reciente o viejo) de bytes: 409 en_curso, no lo pisa ni gasta cupo', async () => {
    for (const hace of [1 * MIN, 6 * MIN]) {
      const id = idNuevo(); await mensaje(id, { tipo: 'document' });
      const marcador = { idMeta: id, estado: 'pendiente', ext: 'pdf', mime: 'application/pdf', tamano: 1024, ruta: gm.rutaDeMedio(T, hoy(), id, 'pdf'), en: Timestamp.fromMillis(Date.now() - hace), vence: Timestamp.now() };
      await regDe(id).set(marcador);
      const r = await peticion(Buffer.alloc(0), anotar(id, DOCX_MIME));
      expect(r.cuerpo, `hace ${hace / MIN} min`).toEqual({ error: 'en_curso' });
      expect((await regDe(id).get()).data()).toMatchObject({ estado: 'pendiente', ext: 'pdf' });
    }
    expect((await cupoRef().get()).exists).toBe(false);
  });
});

describe('contrato v2: documentos de cualquier tipo, video, sticker y topes por teléfono', () => {
  const regDe = (id: string, t = T) => db.doc(`tenants/${t}/mediosRecibidos/${al.nombreDeObjeto(id)}`);
  const nada = () => expect(almacen.objetos.size).toBe(0);
  const telDe = async (tel = TEL) => (await cupoRef().get()).get(new (await import('firebase-admin/firestore')).FieldPath('telefonos', gm.claveDeTelefono(tel)));

  it('ejecutable, HTML, SVG, ZIP, script, PDF-ZIP, docm, xlsm y txt con NUL como DOCUMENTO: 200, bin y octet-stream', async () => {
    const pdfZip = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(50)]);
    for (const [b, m] of [
      [MZ(), 'application/x-msdownload'], [HTML(), 'text/html'], [SVG(), 'image/svg+xml'], [DOCX(), 'application/octet-stream'],
      [Buffer.from('#!/bin/sh\necho\n'), 'application/x-sh'], [pdfZip, 'application/pdf'],
      [OOXML_DOCX(), 'application/vnd.ms-word.document.macroenabled.12'], [DOCX(), 'application/vnd.ms-excel.sheet.macroenabled.12'],
      [Buffer.from('a\u0000b'), 'text/plain'],
    ] as const) {
      const id = idNuevo(); await mensaje(id, { tipo: 'document' });
      const r = await peticion(b, buenas(id, 'document', m));
      expect(r.codigo, m).toBe(200);
      expect(r.cuerpo.ruta, m).toMatch(/\.bin$/);
      expect(almacen.objetos.get(r.cuerpo.ruta)?.contentType, m).toBe('application/octet-stream');
      expect((await regDe(id).get()).data(), m).toMatchObject({ ext: 'bin', mime: 'application/octet-stream', categoria: 'document' });
    }
  });

  it('un PDF real se registra pdf/application/pdf, pero el OBJETO se escribe octet-stream', async () => {
    const id = idNuevo(); await mensaje(id, { tipo: 'document' });
    const r = await peticion(PDF(), buenas(id, 'document', 'application/pdf'));
    expect((await regDe(id).get()).data()).toMatchObject({ ext: 'pdf', mime: 'application/pdf' });
    expect(almacen.objetos.get(r.cuerpo.ruta)?.contentType).toBe('application/octet-stream');
  });

  it('un sticker registrado como `sticker` corresponde a image webp; un mensaje `otro` (video de la ingesta de hoy) no', async () => {
    const st = idNuevo(); await mensaje(st, { tipo: 'sticker' });
    expect((await peticion(WEBP(), buenas(st, 'image', 'image/webp'))).codigo).toBe(200);
    const vid = idNuevo(); await mensaje(vid, { tipo: 'otro' });
    expect((await peticion(MP4('mp42'), buenas(vid, 'video', 'video/mp4'))).cuerpo).toEqual({ error: 'sin_mensaje' });
    const conVideo = idNuevo(); await mensaje(conVideo, { tipo: 'video' });
    expect((await peticion(MP4('mp42'), buenas(conVideo, 'video', 'video/mp4'))).codigo).toBe(200);
  });

  it('TOPE POR TELÉFONO de 100: el 100 entra, el 101 da 429 cupo_telefono_lleno sin gastar cupo; otro teléfono sigue', async () => {
    expect(gm.TOPE_DIARIO_POR_TELEFONO).toBe(100);
    const clave = gm.claveDeTelefono(TEL);
    await cupoRef().set({ n: 500, bytes: 0, vence: Timestamp.now(), telefonos: { [clave]: { n: 99, bytes: 0 } } });
    const cien = idNuevo(); await mensaje(cien);
    expect((await peticion(OGG(), buenas(cien, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect(await telDe()).toEqual({ n: 100, bytes: 2048 });
    almacen = new AlmacenDeMentira(); al.fijarAlmacenDeMediosDePrueba(almacen);
    const id = idNuevo(); await mensaje(id);
    expect(await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).toMatchObject({ codigo: 429, cuerpo: { error: 'cupo_telefono_lleno' } });
    nada();
    expect((await regDe(id).get()).exists).toBe(false);
    expect((await cupoRef().get()).get('n')).toBe(501);
    expect(await telDe()).toEqual({ n: 100, bytes: 2048 });
    expect((await cupoRef().get()).get('rechazados')).toBe(1);
    // Tampoco se anota un docx de ese teléfono.
    const doc = idNuevo(); await mensaje(doc, { tipo: 'document' });
    expect((await peticion(Buffer.alloc(0), anotar(doc, DOCX_MIME))).cuerpo).toEqual({ error: 'cupo_telefono_lleno' });
    // Otro teléfono del mismo comercio no se frena.
    const otroTel = '59100000093';
    const o = idNuevo(); await mensaje(o, {}, otroTel);
    expect((await peticion(OGG(), buenas(o, 'audio', 'audio/ogg', { 'x-novuchat-telefono': otroTel }))).codigo).toBe(200);
    expect(await telDe(otroTel)).toEqual({ n: 1, bytes: 2048 });
    expect(JSON.stringify((await cupoRef().get()).data())).not.toContain(TEL);
  });

  it('TOPE DE BYTES POR TELÉFONO (500 MiB): 429 cupo_telefono_lleno si no cabe; cabe justo, 200', async () => {
    const clave = gm.claveDeTelefono(TEL);
    await cupoRef().set({ n: 1, bytes: 0, vence: Timestamp.now(), telefonos: { [clave]: { n: 1, bytes: gm.TOPE_DIARIO_DE_BYTES_POR_TELEFONO - 2047 } } });
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).cuerpo).toEqual({ error: 'cupo_telefono_lleno' });
    nada();
    await cupoRef().set({ n: 1, bytes: 0, vence: Timestamp.now(), telefonos: { [clave]: { n: 1, bytes: gm.TOPE_DIARIO_DE_BYTES_POR_TELEFONO - 2048 } } });
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect(await telDe()).toEqual({ n: 2, bytes: gm.TOPE_DIARIO_DE_BYTES_POR_TELEFONO });
  });

  it('el comercio lleno manda sobre el teléfono: 429 cupo_diario_lleno', async () => {
    await cupoRef().set({ n: gm.TOPE_DIARIO_DE_MEDIOS, bytes: 0, vence: Timestamp.now(), telefonos: { [gm.claveDeTelefono(TEL)]: { n: 100, bytes: 0 } } });
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).cuerpo).toEqual({ error: 'cupo_diario_lleno' });
  });

  it('NINGÚN rechazo gasta cupo: 413, 415, 400, 409 sin_mensaje dejan el contador (comercio y teléfono) como estaba', async () => {
    const clave = gm.claveDeTelefono(TEL);
    await cupoRef().set({ n: 3, bytes: 30, vence: Timestamp.now(), telefonos: { [clave]: { n: 3, bytes: 30 } } });
    const antes = (await cupoRef().get()).data();
    const id = idNuevo(); await mensaje(id, { tipo: 'image' });
    for (const [b, tipo, ct] of [[JPG(5 * ti.MB + 1), 'image', 'image/jpeg'], [HTML(), 'image', 'image/jpeg'], [Buffer.alloc(0), 'image', 'image/jpeg'],
      [OGG(), 'audio', 'audio/ogg'], [Buffer.alloc(16 * ti.MB + 1, 0x41), 'document', 'application/octet-stream']] as const) {
      expect((await peticion(b, buenas(id, tipo, ct))).codigo, `${tipo} ${ct}`).not.toBe(200);
    }
    expect((await cupoRef().get()).data()).toEqual(antes);
    nada();
  });

  it('si Storage falla, el cupo del TELÉFONO también vuelve (una vez)', async () => {
    const clave = gm.claveDeTelefono(TEL);
    await cupoRef().set({ n: 7, bytes: 100, vence: Timestamp.now(), telefonos: { [clave]: { n: 4, bytes: 40 } } });
    const id = idNuevo(); await mensaje(id);
    almacen.falla = true;
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(502);
    expect((await cupoRef().get()).data()).toMatchObject({ n: 7, bytes: 100 });
    expect(await telDe()).toEqual({ n: 4, bytes: 40 });
  });

  it('un documento de un comercio no cruza a otro: el token ajeno con el mismo idMeta da sin_mensaje', async () => {
    await db.doc(`tenants/${T_APAGADO}`).update({ guardarMedios: true });
    try {
      const id = idNuevo(); await mensaje(id, { tipo: 'document' });
      const r = await peticion(MZ(), buenas(id, 'document', 'application/x-msdownload'), TOKEN_AJENO, 'POST', NUMERO_AJENO);
      expect(r.cuerpo).toEqual({ error: 'sin_mensaje' });
      nada();
      expect((await regDe(id).get()).exists).toBe(false);
      expect((await regDe(id, T_APAGADO).get()).exists).toBe(false);
    } finally {
      await db.doc(`tenants/${T_APAGADO}`).update({ guardarMedios: (await import('firebase-admin/firestore')).FieldValue.delete() });
    }
  });
});
