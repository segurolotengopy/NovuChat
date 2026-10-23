/**
 * MEDIOS ENTRANTES GUARDADOS (Core, H3 PR-1): `guardarMedio` y `purgarMedios`.
 *
 * Con un `Almacen` de mentira (el emulador de Firestore no trae Storage). Se escribe negando: sin token,
 * con firma, token de otro número, bandera apagada, sin mensaje, mensaje saliente, HTML rotulado jpeg,
 * SVG, docx, cada tope +1 byte, cupo lleno por conteo y por bytes, repetido sin reescritura, y que
 * cierres, comprobantes, métricas y solicitud queden intactos. La purga: 89, 90 y 91 días, la baja y un
 * comercio que falla.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
    expect(r).toMatch(/^tenants\/[\w-]+\/medios\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{43}\.(jpg|png|webp|ogg|m4a|mp3|aac|amr|pdf)$/);
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
    expect(reg.data()).toMatchObject({ idMeta: id, conversacionId: `wa_${TEL}`, tipo, ext, tamano: bytes().length, ruta: r.cuerpo.ruta, estado: 'guardado' });
    expect(reg.get('sha256')).toMatch(/^[0-9a-f]{64}$/);
    const dias = (reg.get('vence').toMillis() - reg.get('en').toMillis()) / DIA_MS;
    expect(dias).toBe(90);
    const marca = (await m.get()).get('medio');
    expect(marca).toMatchObject({ estado: 'guardado', tamano: bytes().length });
    expect(marca.vence.toMillis()).toBe(reg.get('vence').toMillis());
    // El cupo del día se anotó, con vence para el TTL.
    expect((await cupoRef().get()).data()).toMatchObject({ n: 1, bytes: bytes().length });
    expect((await cupoRef().get()).get('vence')).toBeDefined();
  });

  it('exactamente en cada tope entra: imagen 5 MB, audio 16 MB, PDF 10 MB', async () => {
    for (const [tipo, bytes, ct] of [['image', JPG(5 * ti.MB), 'image/jpeg'], ['audio', OGG(16 * ti.MB), 'audio/ogg'], ['document', PDF(10 * ti.MB), 'application/pdf']] as const) {
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
    expect((await peticion(OGG(), buenas(id, 'video', 'audio/ogg'))).codigo).toBe(400);
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

  it('un HTML rotulado jpeg, un SVG, un docx: 415, y no se guarda nada', async () => {
    for (const [bytes, tipo, ct] of [
      [HTML(), 'image', 'image/jpeg'], [SVG(), 'image', 'image/svg+xml'], [SVG(), 'image', 'image/jpeg'],
      [DOCX(), 'document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], [DOCX(), 'document', 'application/pdf'],
      [HTML(), 'document', 'application/pdf'], [HTML(), 'audio', 'audio/ogg'],
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
    expect((await peticion(OGG(), buenas(id, 'document', 'audio/ogg'))).codigo).toBe(415);
    nada();
  });

  it('cada tope + 1 byte: imagen 5 MB, audio 16 MB, PDF 10 MB dan 413', async () => {
    for (const [tipo, bytes, ct] of [
      ['image', JPG(5 * ti.MB + 1), 'image/jpeg'], ['audio', OGG(16 * ti.MB + 1), 'audio/ogg'], ['document', PDF(10 * ti.MB + 1), 'application/pdf'],
    ] as const) {
      const id = idNuevo(); await mensaje(id, { tipo });
      expect((await peticion(bytes, buenas(id, tipo, ct))).codigo, tipo).toBe(413);
    }
    nada();
  });

  it('cupo lleno POR CONTEO (1.000 medios): 429, antes de tocar Storage, y sin registro', async () => {
    await cupoRef().set({ n: gm.CUPO_MEDIOS_POR_DIA, bytes: 0, vence: Timestamp.now() });
    const id = idNuevo(); await mensaje(id);
    const r = await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'));
    expect(r.codigo).toBe(429);
    nada();
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).exists).toBe(false);
    expect((await cupoRef().get()).get('n')).toBe(gm.CUPO_MEDIOS_POR_DIA);
  });

  it('cupo lleno POR BYTES (2 GB): 429; con un medio que cabe justo, 200', async () => {
    const bytes = OGG(2048);
    await cupoRef().set({ n: 5, bytes: gm.CUPO_BYTES_POR_DIA - 2047, vence: Timestamp.now() });
    const id = idNuevo(); await mensaje(id);
    expect((await peticion(bytes, buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(429);
    nada();
    await cupoRef().set({ n: 5, bytes: gm.CUPO_BYTES_POR_DIA - 2048, vence: Timestamp.now() });
    expect((await peticion(bytes, buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
    expect((await cupoRef().get()).get('bytes')).toBe(gm.CUPO_BYTES_POR_DIA);
  });

  it('si Storage falla: 502, el cupo se devuelve y no queda registro ni marca', async () => {
    const id = idNuevo(); const m = await mensaje(id);
    almacen.falla = true;
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(502);
    expect((await cupoRef().get()).get('n')).toBe(0);
    expect((await db.doc(`tenants/${T}/mediosRecibidos/${al.nombreDeObjeto(id)}`).get()).exists).toBe(false);
    expect((await m.get()).get('medio')).toBeUndefined();
    almacen.falla = false;
    expect((await peticion(OGG(), buenas(id, 'audio', 'audio/ogg'))).codigo).toBe(200);
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
