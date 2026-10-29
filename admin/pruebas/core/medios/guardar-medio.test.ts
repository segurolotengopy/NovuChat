/**
 * GUARDAR EL MEDIO ENTRANTE (Core): la Function HTTP, con Firestore del emulador
 * y un `Almacen` de mentira (el emulador de Firestore no trae Storage).
 *
 * Se escribe negando: un token ajeno, una firma HMAC (aunque sea válida), un
 * comercio suspendido o dado de baja, un cuerpo vacío, un tipo que miente, un
 * PDF de más de 10 MB, una imagen de más de 5 MB, un audio de más de 16 MB y un
 * docx no entran; un mismo idMeta no pisa lo guardado; el día 3001 recibe 429;
 * el teléfono no está en la ruta ni en los logs; la purga borra a los 91 días,
 * conserva a los 90 y borra todo de un comercio dado de baja.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['MEDIOS_DOBLE'] = '1';
const TOKEN = 'valor-de-prueba-de-medios';
process.env['INGESTA_CLIENTE15'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const m = await import('../../../functions/src/core/medios/guardarMedio.ts');
const { diaDeLaPaz, nombreDeObjeto } = await import('../../../functions/src/core/medios/almacen.ts');

const T = 'medios-tienda';
const OTRO = 'medios-otra-tienda';
const T_BAJA = 'medios-de-baja';
const NUMERO = '7000051';
const NUMERO_OTRO = '7000052';
const NUMERO_SUSPENDIDO = '7000053';
const NUMERO_BAJA = '7000054';
const TEL = '59100061';
const DIA_MS = 86_400_000;
const MB = 1024 * 1024;

/** Un almacén en memoria con la misma forma que el de Storage. */
class AlmacenDeMentira {
  objetos = new Map<string, { bytes: Buffer; contentType: string }>();
  falla = false;
  reescrituras = 0;
  async existe(ruta: string) { return this.objetos.has(ruta); }
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
  async metadatos(ruta: string) { const o = this.objetos.get(ruta); return o ? { tamano: o.bytes.length } : null; }
  async leer(ruta: string) { return this.objetos.get(ruta)?.bytes ?? null; }
}
let almacen = new AlmacenDeMentira();
beforeEach(() => { almacen = new AlmacenDeMentira(); m.fijarAlmacenDeMediosDePrueba(almacen); });
afterEach(() => { vi.restoreAllMocks(); });

const JPG = (n = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);
const PDF = (n = 1024) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n)]);
const OGG = (n = 1024) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(n)]);
const ZIP = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(1024)]);
const HTML = () => Buffer.from('<html><script>alert(1)</script></html>');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function peticion(
  cuerpo: Buffer, cabeceras: Record<string, string>, opciones: { token?: string | null; numero?: string; metodo?: string } = {},
) {
  const token = opciones.token === undefined ? TOKEN : opciones.token;
  const h: Record<string, string> = { 'x-novuchat-numero': opciones.numero ?? NUMERO, ...cabeceras };
  if (token) h['authorization'] = `Bearer ${token}`;
  const leer = (n: string) => h[n.toLowerCase()];
  const q = { method: opciones.metodo ?? 'POST', body: cuerpo, rawBody: cuerpo, headers: h, get: leer, header: leer };
  const r: { codigo: number; cuerpo: any } = { codigo: 0, cuerpo: null };
  const s = {
    status(c: number) { r.codigo = c; return s; }, send(b: unknown) { r.cuerpo = b; return s; },
    json(b: unknown) { r.cuerpo = b; return s; }, setHeader() { return s; }, set() { return s; }, on() { return s; }, end() { return s; },
  };
  await (m.guardarMedio as unknown as (q: unknown, s: unknown) => Promise<void>)(q, s);
  return r;
}
let contador = 0;
const buenas = (extra: Record<string, string> = {}) => ({
  'x-novuchat-telefono': TEL, 'x-novuchat-idmeta': `wamid.medio${++contador}`, 'content-type': 'image/jpeg', ...extra,
});
const filaDe = async (t: string, idMeta: string) => (await db.doc(`tenants/${t}/mediosRecibidos/${nombreDeObjeto(idMeta)}`).get());
const hoy = () => diaDeLaPaz(Date.now());
const topeDoc = (t: string) => db.doc(`topesDeMedios/${t}_${hoy()}`);

beforeAll(async () => {
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente15', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUMERO_OTRO}`).set({ tenantId: OTRO, flujo: 'agendamiento', aliasSecreto: 'cliente15', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUMERO_SUSPENDIDO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente15', estado: 'suspendido' });
  await db.doc(`rutasWhatsApp/${NUMERO_BAJA}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente15', estado: 'dado_de_baja' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'] });
  await db.doc(`tenants/${OTRO}`).set({ nombre: 'Otra', estado: 'activo', flujos: ['agendamiento'] });
});
beforeEach(async () => {
  await db.recursiveDelete(db.collection(`tenants/${T}/mediosRecibidos`));
  await db.recursiveDelete(db.collection(`tenants/${OTRO}/mediosRecibidos`));
  await topeDoc(T).delete();
  await topeDoc(OTRO).delete();
});

describe('guardar un medio entrante', () => {
  it('imagen: 200, ruta tenants/{t}/medios/{día}/{hash}.jpg, metadato completo y el objeto en el almacén', async () => {
    const h = buenas();
    const r = await peticion(JPG(), h);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.estado).toBe('guardado');
    expect(r.cuerpo.ruta).toBe(`tenants/${T}/medios/${hoy()}/${nombreDeObjeto(h['x-novuchat-idmeta'])}.jpg`);
    expect(almacen.objetos.get(r.cuerpo.ruta)?.contentType).toBe('image/jpeg');
    const fila = (await filaDe(T, h['x-novuchat-idmeta'])).data()!;
    expect(fila).toMatchObject({
      conversacionId: `wa_${TEL}`, idMeta: h['x-novuchat-idmeta'], tipo: 'imagen', mime: 'image/jpeg',
      tamano: JPG().length, ruta: r.cuerpo.ruta, estado: 'guardado', motivo: null,
    });
    const dias = (fila['vence'].toMillis() - fila['en'].toMillis()) / DIA_MS;
    expect(dias).toBe(90);
  });
  it('PDF y audio (ogg con parámetros) también se guardan, sin exigir ningún cobro abierto ni conversación', async () => {
    expect((await peticion(PDF(), buenas({ 'content-type': 'application/pdf' }))).codigo).toBe(200);
    const a = await peticion(OGG(), buenas({ 'content-type': 'audio/ogg; codecs=opus' }));
    expect(a.codigo).toBe(200);
    expect(a.cuerpo.ruta).toMatch(/\.ogg$/);
    expect(almacen.objetos.size).toBe(2);
  });
  it('el teléfono no está en la ruta, ni en Storage, ni en el metadato fuera de conversacionId', async () => {
    const h = buenas();
    const r = await peticion(JPG(), h);
    expect(r.cuerpo.ruta).not.toContain(TEL);
    expect([...almacen.objetos.keys()].join()).not.toContain(TEL);
    const fila = (await filaDe(T, h['x-novuchat-idmeta'])).data()!;
    const { conversacionId, ...resto } = fila;
    expect(conversacionId).toBe(`wa_${TEL}`);
    expect(JSON.stringify(resto)).not.toContain(TEL);
  });
  it('el teléfono ausente de los logs: ni en lo que sale bien ni en lo que falla', async () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => undefined));
    await peticion(JPG(), buenas());
    await peticion(HTML(), buenas({ 'content-type': 'application/pdf' }));
    almacen.falla = true;
    await peticion(JPG(), buenas());
    almacen.falla = false;
    const salida = espias.flatMap((e) => e.mock.calls.map((c) => JSON.stringify(c))).join('\n');
    expect(salida).not.toContain(TEL);
    expect(espias[3]!.mock.calls.length, 'control: el fallo de Storage sí se registra (sin datos)').toBeGreaterThan(0);
  });
});

describe('quién puede guardar', () => {
  it('sin token, con un token ajeno o con otro método: 401 / 405, y no se guarda ni se anota nada', async () => {
    const h = buenas();
    expect((await peticion(JPG(), h, { token: null })).codigo).toBe(401);
    expect((await peticion(JPG(), h, { token: 'otro' })).codigo).toBe(401);
    expect((await peticion(JPG(), h, { metodo: 'GET' })).codigo).toBe(405);
    expect((await peticion(JPG(), { ...h, 'x-novuchat-numero': 'abc' }, { numero: 'abc' })).codigo).toBe(401);
    expect((await peticion(JPG(), h, { numero: '7099999' })).codigo).toBe(401);
    expect(almacen.objetos.size).toBe(0);
    expect((await filaDe(T, h['x-novuchat-idmeta'])).exists).toBe(false);
  });
  it('una firma HMAC VÁLIDA tampoco pasa (solo vale el token), ni sola ni junto al token', async () => {
    const { createHmac } = await import('node:crypto');
    const marca = String(Date.now());
    const firma = createHmac('sha256', TOKEN).update(`${marca}.`).update(Buffer.alloc(0)).digest('hex');
    const h = buenas({ 'x-novuchat-signature': `sha256=${firma}`, 'x-novuchat-timestamp': marca });
    expect((await peticion(Buffer.alloc(0), h, { token: null })).codigo).toBe(401);
    expect((await peticion(JPG(), h)).codigo).toBe(401);
    expect(almacen.objetos.size).toBe(0);
  });
  it('un comercio suspendido o dado de baja (por su ruta): 409 y no se guarda nada', async () => {
    for (const numero of [NUMERO_SUSPENDIDO, NUMERO_BAJA]) {
      const h = buenas();
      const r = await peticion(JPG(), h, { numero });
      expect(r.codigo, numero).toBe(409);
      expect((await filaDe(T, h['x-novuchat-idmeta'])).exists).toBe(false);
    }
    expect(almacen.objetos.size).toBe(0);
  });
  it('sin teléfono válido o sin idMeta: 400', async () => {
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': 'abc' }))).codigo).toBe(400);
    expect((await peticion(JPG(), buenas({ 'x-novuchat-telefono': '' }))).codigo).toBe(400);
    expect((await peticion(JPG(), buenas({ 'x-novuchat-idmeta': '' }))).codigo).toBe(400);
  });
  it('el token del comercio A guarda en A: el medio nunca cae en la carpeta de otro comercio', async () => {
    const h = buenas();
    const r = await peticion(JPG(), h, { numero: NUMERO_OTRO });
    expect(r.cuerpo.ruta).toContain(`tenants/${OTRO}/medios/`);
    expect((await filaDe(T, h['x-novuchat-idmeta'])).exists).toBe(false);
    expect((await filaDe(OTRO, h['x-novuchat-idmeta'])).exists).toBe(true);
  });
});

describe('lo que NO se guarda: rechazo con anotación', () => {
  it('cuerpo vacío sin X-NovuChat-Fallo: 400 y se anota fallo «vacio»', async () => {
    const h = buenas();
    expect((await peticion(Buffer.alloc(0), h)).codigo).toBe(400);
    expect((await filaDe(T, h['x-novuchat-idmeta'])).data()).toMatchObject({ estado: 'fallo', motivo: 'vacio', ruta: null, tamano: 0 });
    expect(almacen.objetos.size).toBe(0);
  });
  it('cuerpo vacío CON X-NovuChat-Fallo: solo anota el fallo con el motivo del flujo (limpio), sin guardar', async () => {
    const h = buenas({ 'x-novuchat-fallo': 'Meta_no/entregó el medio!' });
    const r = await peticion(Buffer.alloc(0), h);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ estado: 'fallo' });
    expect((await filaDe(T, h['x-novuchat-idmeta'])).data()).toMatchObject({ estado: 'fallo', motivo: 'meta_noentregelmedio', ruta: null });
    expect(almacen.objetos.size).toBe(0);
  });
  it('la cabecera de fallo CON cuerpo no es un atajo: el cuerpo se valida como siempre', async () => {
    const h = buenas({ 'x-novuchat-fallo': 'x', 'content-type': 'application/pdf' });
    expect((await peticion(HTML(), h)).codigo).toBe(415);
    expect(almacen.objetos.size).toBe(0);
  });
  it('un tipo que no coincide con la firma (HTML declarado PDF, PDF declarado imagen): 415 y fallo', async () => {
    const h1 = buenas({ 'content-type': 'application/pdf' });
    expect((await peticion(HTML(), h1)).codigo).toBe(415);
    expect((await filaDe(T, h1['x-novuchat-idmeta'])).data()).toMatchObject({ estado: 'fallo', motivo: 'tipo_no_coincide', ruta: null });
    expect((await peticion(PDF(), buenas({ 'content-type': 'image/jpeg' }))).codigo).toBe(415);
    expect(almacen.objetos.size).toBe(0);
  });
  it('PDF de más de 10 MB, imagen de más de 5 MB y audio de más de 16 MB: 413 y fallo, sin guardar', async () => {
    const casos: [Buffer, string][] = [
      [PDF(10 * MB), 'application/pdf'], [JPG(5 * MB), 'image/jpeg'], [OGG(16 * MB), 'audio/ogg'],
    ];
    for (const [cuerpo, tipo] of casos) {
      const h = buenas({ 'content-type': tipo });
      expect((await peticion(cuerpo, h)).codigo, tipo).toBe(413);
      expect((await filaDe(T, h['x-novuchat-idmeta'])).data(), tipo).toMatchObject({ estado: 'fallo', motivo: 'demasiado_grande', ruta: null });
    }
    expect(almacen.objetos.size).toBe(0);
  });
  it('un docx: 200 «anotado», con su motivo, y NO se guarda en Storage', async () => {
    const h = buenas({ 'content-type': DOCX });
    const r = await peticion(ZIP(), h);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ estado: 'anotado' });
    expect((await filaDe(T, h['x-novuchat-idmeta'])).data()).toMatchObject({ estado: 'anotado', motivo: 'tipo_no_admitido', ruta: null, tipo: 'otro' });
    expect(almacen.objetos.size).toBe(0);
  });
  it('si Storage falla: 502, se anota fallo «storage» y el reintento sí guarda', async () => {
    const h = buenas();
    almacen.falla = true;
    expect((await peticion(JPG(), h)).codigo).toBe(502);
    expect((await filaDe(T, h['x-novuchat-idmeta'])).data()).toMatchObject({ estado: 'fallo', motivo: 'storage' });
    almacen.falla = false;
    expect((await peticion(JPG(), h)).codigo).toBe(200);
    expect((await filaDe(T, h['x-novuchat-idmeta'])).data()).toMatchObject({ estado: 'guardado', motivo: null });
    expect(almacen.objetos.size).toBe(1);
  });
});

describe('nunca se sobrescribe', () => {
  it('el mismo idMeta con otros bytes responde la misma ruta, sin tocar Storage ni gastar cupo', async () => {
    const h = buenas();
    const a = await peticion(JPG(), h);
    const antes = Number((await topeDoc(T).get()).get('n'));
    const b = await peticion(JPG(4096), h);
    const c = await peticion(PDF(), { ...h, 'content-type': 'application/pdf' });
    expect(b).toMatchObject({ codigo: 200, cuerpo: { estado: 'guardado', ruta: a.cuerpo.ruta, repetido: true } });
    expect(c).toMatchObject({ codigo: 200, cuerpo: { ruta: a.cuerpo.ruta } });
    expect(almacen.objetos.size).toBe(1);
    expect(almacen.objetos.get(a.cuerpo.ruta)?.bytes.length).toBe(JPG().length);
    expect(Number((await topeDoc(T).get()).get('n'))).toBe(antes);
  });
  it('aunque se pierda el metadato, Storage conserva el objeto original (ifGenerationMatch: 0 → «existe»)', async () => {
    const h = buenas();
    const a = await peticion(JPG(), h);
    await db.doc(`tenants/${T}/mediosRecibidos/${nombreDeObjeto(h['x-novuchat-idmeta'])}`).delete();
    await peticion(JPG(4096), h);
    expect(almacen.reescrituras).toBe(1);
    expect(almacen.objetos.get(a.cuerpo.ruta)?.bytes.length).toBe(JPG().length);
  });
});

describe('tope diario por comercio', () => {
  it('con el cupo lleno el siguiente da 429, se anota la constancia y no se guarda', async () => {
    expect(m.TOPE_DIARIO_DE_MEDIOS).toBe(3000);
    await topeDoc(T).set({ n: m.TOPE_DIARIO_DE_MEDIOS, rechazados: 0 });
    const h = buenas();
    const r = await peticion(JPG(), h);
    expect(r.codigo).toBe(429);
    expect((await filaDe(T, h['x-novuchat-idmeta'])).data()).toMatchObject({ estado: 'fallo', motivo: 'tope_diario', ruta: null });
    expect(almacen.objetos.size).toBe(0);
    expect((await topeDoc(T).get()).get('n')).toBe(m.TOPE_DIARIO_DE_MEDIOS);
  });
  it('queda un lugar: ese pasa y el siguiente ya no (el contador sube de a uno, en transacción)', async () => {
    await topeDoc(T).set({ n: m.TOPE_DIARIO_DE_MEDIOS - 1, rechazados: 0 });
    expect((await peticion(JPG(), buenas())).codigo).toBe(200);
    expect((await peticion(JPG(), buenas())).codigo).toBe(429);
    expect((await topeDoc(T).get()).get('n')).toBe(m.TOPE_DIARIO_DE_MEDIOS);
  });
  it('las constancias de tope son pocas: pasadas 50, se rechaza sin escribir un metadato por petición', async () => {
    await topeDoc(T).set({ n: m.TOPE_DIARIO_DE_MEDIOS, rechazados: m.MAX_ANOTACIONES_DE_TOPE });
    const h = buenas();
    expect((await peticion(JPG(), h)).codigo).toBe(429);
    expect((await filaDe(T, h['x-novuchat-idmeta'])).exists).toBe(false);
  });
  it('el tope es por comercio: el cupo lleno de A no frena a B', async () => {
    await topeDoc(T).set({ n: m.TOPE_DIARIO_DE_MEDIOS, rechazados: 0 });
    expect((await peticion(JPG(), buenas(), { numero: NUMERO_OTRO })).codigo).toBe(200);
  });
  it('un rechazo (tipo que miente) también gasta cupo: el tope cuida las escrituras, no solo los archivos', async () => {
    await peticion(HTML(), buenas({ 'content-type': 'application/pdf' }));
    expect((await topeDoc(T).get()).get('n')).toBe(1);
    expect((await topeDoc(T).get()).get('vence')).toBeInstanceOf(Timestamp);
  });
});

describe('retención de 90 días y baja', () => {
  const sembrar = (t: string, diasAtras: number, nombre: string) => {
    const ruta = `tenants/${t}/medios/${diaDeLaPaz(Date.now() - diasAtras * DIA_MS)}/${nombre}.jpg`;
    almacen.objetos.set(ruta, { bytes: JPG(), contentType: 'image/jpeg' });
    return ruta;
  };
  it('a los 91 días se borra; a los 90 y 89 se conserva', async () => {
    const r91 = sembrar(T, 91, 'a91');
    const r90 = sembrar(T, 90, 'a90');
    const r89 = sembrar(T, 89, 'a89');
    const hoyMismo = sembrar(T, 0, 'hoy');
    const r = await m.purgarMediosDe({ almacen: almacen as never, ahoraMs: Date.now() });
    expect(almacen.objetos.has(r91)).toBe(false);
    expect(almacen.objetos.has(r90)).toBe(true);
    expect(almacen.objetos.has(r89)).toBe(true);
    expect(almacen.objetos.has(hoyMismo)).toBe(true);
    expect(r.carpetasBorradas).toBeGreaterThanOrEqual(1);
    expect(r.errores).toBe(0);
  });
  it('un comercio dado de baja pierde TODO el prefijo medios/ y su colección mediosRecibidos; el vecino no', async () => {
    await db.doc(`tenants/${T_BAJA}`).set({ nombre: 'Baja', estado: 'dado_de_baja' });
    await db.doc(`tenants/${T_BAJA}/mediosRecibidos/uno`).set({ estado: 'guardado' });
    await db.doc(`tenants/${T}/mediosRecibidos/uno`).set({ estado: 'guardado' });
    sembrar(T_BAJA, 0, 'x'); sembrar(T_BAJA, 5, 'y'); sembrar(T_BAJA, 200, 'z');
    const vecino = sembrar(T, 5, 'v');
    const r = await m.purgarMediosDe({ almacen: almacen as never, ahoraMs: Date.now() });
    expect([...almacen.objetos.keys()].filter((k) => k.startsWith(`tenants/${T_BAJA}/medios/`))).toEqual([]);
    expect((await db.collection(`tenants/${T_BAJA}/mediosRecibidos`).get()).size).toBe(0);
    expect(almacen.objetos.has(vecino)).toBe(true);
    expect((await db.doc(`tenants/${T}/mediosRecibidos/uno`).get()).exists).toBe(true);
    expect(r.tenantsDeBajaBorrados).toBeGreaterThanOrEqual(1);
  });
  it('no toca la carpeta de comprobantes del mismo comercio (otro objeto, su propia purga)', async () => {
    const comprobante = `tenants/${T}/comprobantes/${diaDeLaPaz(Date.now() - 200 * DIA_MS)}/c.jpg`;
    almacen.objetos.set(comprobante, { bytes: JPG(), contentType: 'image/jpeg' });
    await m.purgarMediosDe({ almacen: almacen as never, ahoraMs: Date.now() });
    expect(almacen.objetos.has(comprobante)).toBe(true);
  });
});
