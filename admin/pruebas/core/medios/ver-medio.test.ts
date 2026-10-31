/**
 * `verMedio`: LOS BYTES DE UN MEDIO ENTRANTE POR UNA CALLABLE, ESCRITO NEGANDO
 *
 * Contrato M3 (30/10/2026) §1 y contrato v2 §2 («guardar y descargar TODO»): entrada EXACTA
 * de CUATRO claves `{tenantId, conversacionId, idMeta, accion}` (`accion`: `'ver'` o `'descargar'`), salida exacta `{tipo, categoria, mime, extension, tamano, base64}`
 * con mime SEGURO (imagen y audio por firma; video y documento, `application/octet-stream`). Cada guarda de `core/medios/verMedio.ts` tiene acá una prueba que
 * falla si se quita. Adaptadas de `pruebas/modulos/cobros/ver-comprobante.test.ts` (T1 a T23).
 *
 * CÓMO SE PRUEBA SIN NUBE:
 *  - Firestore: el emulador (la callable corre de verdad con `.run`, que salta App Check: esa opción
 *    se prueba aparte, pura).
 *  - Storage: un almacén doble que CUENTA llamadas y rutas (`MEDIOS_DOBLE=1`).
 *  - Auth: sin emulador; `firebase-admin/auth` se simula y `getUser` devuelve la cuenta vigente.
 *  - La auditoría se puede hacer fallar (`fijarAuditorDeMediosDePrueba`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['MEDIOS_DOBLE'] = '1';

const h = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('firebase-admin/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase-admin/auth')>();
  return { ...original, getAuth: () => ({ getUser: (uid: string) => h.getUser(uid) }) };
});

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
const db = getFirestore();
const V = await import('../../../functions/src/core/medios/verMedio.ts');
const AL = await import('../../../functions/src/core/medios/almacen.ts');
const TI = await import('../../../functions/src/core/medios/tipos.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(aqui, '..', '..', '..', 'functions', 'src', 'core', 'medios', 'verMedio.ts'), 'utf8');
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// EL ALMACÉN DOBLE, QUE CUENTA
// ---------------------------------------------------------------------------
class AlmacenDoble implements AL.Almacen {
  objetos = new Map<string, Buffer>();
  metadatosRutas: string[] = [];
  leerRutas: string[] = [];
  tamanoFalso = new Map<string, number>();
  fallaMetadatos: Error | null = null;
  fallaLeer: Error | null = null;
  bytesRaros: unknown = undefined;
  async guardar(ruta: string, bytes: Buffer) { this.objetos.set(ruta, bytes); return 'creado' as const; }
  async existe(ruta: string) { return this.objetos.has(ruta); }
  async subcarpetas() { return []; }
  async borrarPrefijo() { return 0; }
  async metadatos(ruta: string) {
    this.metadatosRutas.push(ruta);
    if (this.fallaMetadatos) throw this.fallaMetadatos;
    const o = this.objetos.get(ruta);
    return o ? { tamano: this.tamanoFalso.get(ruta) ?? o.length } : null;
  }
  async leer(ruta: string) {
    this.leerRutas.push(ruta);
    if (this.fallaLeer) throw this.fallaLeer;
    if (this.bytesRaros !== undefined) return this.bytesRaros as Buffer;
    return this.objetos.get(ruta) ?? null;
  }
  get llamadas() { return this.metadatosRutas.length + this.leerRutas.length; }
}
let almacen = new AlmacenDoble();

const JPG = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
const PDF = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(40, 9)]);
const OGG = (n = 40) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(n, 1)]);
const MP4 = (marca = 'isom') => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(`ftyp${marca}`), Buffer.alloc(40, 4)]);
const ZIP = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20, 1)]);
const OLE = () => Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Un ZIP con los nombres en claro de un Office moderno (lo que mira `documentoPorFirma`; nunca descomprime). */
const OFFICE = (carpeta: string, extra = '') => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml ${carpeta}document.xml ${extra}`), Buffer.alloc(20, 1)]);
const M4A = () => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(40, 2)]);

// ---------------------------------------------------------------------------
// ACTORES
// ---------------------------------------------------------------------------
interface Actor { uid: string; token: Record<string, unknown> }
const cuentas = new Map<string, Record<string, unknown>>();
function actor(uid: string, nc: Record<string, unknown>, o: { proveedor?: string; verificado?: boolean } = {}): Actor {
  const token = {
    nc: { v: 1, ...nc },
    firebase: { sign_in_provider: o.proveedor ?? 'password', identities: {} },
    email_verified: o.verificado ?? true,
    auth_time: Math.floor(Date.now() / 1000) - 60,
  };
  cuentas.set(uid, { disabled: false, customClaims: { nc: token.nc }, tokensValidAfterTime: undefined });
  return { uid, token };
}
const admin = (t: string, uid = `u-admin-${t}`) => actor(uid, { t: { [t]: 'admin' } });
const oper = (t: string, uid = `u-oper-${t}`) => actor(uid, { t: { [t]: 'oper' } });
const soporte = (uid = 'u-soporte') => actor(uid, { t: {}, p: true }, { proveedor: 'google.com' });

const llamar = (data: unknown, a?: Actor) =>
  (V.verMedio as unknown as { run: (r: unknown) => Promise<unknown> })
    .run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} });

// ---------------------------------------------------------------------------
// SEMILLAS
// ---------------------------------------------------------------------------
const T = 'medio-tienda';
const OTRO = 'medio-otro';
const TODOS = [T, OTRO, 'medio-baja', 'medio-suspendido', 'medio-fantasma'];
// Armados por partes: el saneo del repositorio público rechaza literales de 10 o más dígitos.
const TEL = `591${'70000123'}`;
const OTRA_CONV = `wa_591${'70000999'}`;
const CONV = `wa_${TEL}`;
const DIA_MS = 86_400_000;

interface Escena { t: string; conversacionId: string; idMeta: string; ruta: string; bytes: Buffer }
async function ficha(t: string, extra: Record<string, unknown> = {}) {
  const datos: Record<string, unknown> = { nombre: t, estado: 'activo', flujos: ['agendamiento'], ...extra };
  for (const k of Object.keys(datos)) if (datos[k] === undefined) delete datos[k];
  await db.doc(`tenants/${t}`).set(datos);
}
/** Un medio guardado hoy: el metadato como lo deja `guardarMedio` y el objeto en el almacén. */
async function escena(t = T, o: {
  idMeta?: string; conversacionId?: string; bytes?: Buffer; ext?: V.ExtensionLeida; fichaExtra?: Record<string, unknown>;
  meta?: Record<string, unknown>; sinObjeto?: boolean;
} = {}): Promise<Escena> {
  const idMeta = o.idMeta ?? `wamid.${t}.1`;
  const conversacionId = o.conversacionId ?? CONV;
  const bytes = o.bytes ?? JPG();
  const firma = TI.tipoPorFirma(bytes);
  const ext: V.ExtensionLeida = o.ext ?? firma?.ext ?? 'bin';
  const tipo = V.CATEGORIA_DE_EXTENSION[ext];
  const mime = firma && firma.ext === ext ? firma.mime : V.MIME_DE_DESCARGA;
  await ficha(t, o.fichaExtra);
  const ruta = `tenants/${t}/medios/${AL.diaDeLaPaz(Date.now())}/${AL.nombreDeObjeto(idMeta)}.${ext}`;
  await db.doc(`tenants/${t}/mediosRecibidos/${AL.nombreDeObjeto(idMeta)}`).set({
    idMeta, conversacionId, tipo, categoria: tipo, mime, ext, estado: 'guardado', tamano: bytes.length, ruta,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    en: Timestamp.now(), vence: Timestamp.fromMillis(Date.now() + 90 * DIA_MS), ...o.meta,
  });
  if (!o.sinObjeto) almacen.objetos.set(ruta, bytes);
  return { t, conversacionId, idMeta, ruta, bytes };
}
const pedir = (e: Escena, accion: 'ver' | 'descargar' = 'ver') => ({ tenantId: e.t, conversacionId: e.conversacionId, idMeta: e.idMeta, accion });
const refMeta = (e: Escena) => db.doc(`tenants/${e.t}/mediosRecibidos/${AL.nombreDeObjeto(e.idMeta)}`);

async function documentosDe(t: string): Promise<string[]> {
  const ruta: string[] = [];
  const visitar = async (r: FirebaseFirestore.DocumentReference) => {
    if ((await r.get()).exists) ruta.push(r.path);
    for (const col of await r.listCollections()) for (const d of await col.listDocuments()) await visitar(d);
  };
  await visitar(db.doc(`tenants/${t}`));
  return ruta.sort();
}
const topes = async () => (await db.collection('topesDeMedios').get()).docs.map((d) => d.id).sort();
const auditoria = async (t: string) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());

const FIJOS = { sinSesion: 'Inicie sesión.', ...V.MENSAJES };
const falla = (code: string, message: string) => ({ code, message });

let salida: string[] = [];
beforeAll(async () => { await db.doc('tenants/medio-sonda').get(); }, 60_000);
beforeEach(async () => {
  for (const t of TODOS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('topesDeMedios').listDocuments()) await d.delete();
  for (const d of await db.collection('topesDelVisor').listDocuments()) await d.delete();
  almacen = new AlmacenDoble();
  AL.fijarAlmacenDeMediosDePrueba(almacen);
  V.fijarAuditorDeMediosDePrueba(null);
  cuentas.clear();
  h.getUser.mockReset();
  h.getUser.mockImplementation(async (uid: string) => {
    const c = cuentas.get(uid);
    if (!c) throw Object.assign(new Error('no existe'), { code: 'auth/user-not-found' });
    return c;
  });
  salida = [];
  for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => { salida.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// ===========================================================================
describe('el camino feliz: administrador, operador, soporte con ventana y comercio suspendido', () => {
  it('el administrador ve la imagen: {tipo, mime, tamano, base64} exactos y UN asiento «admin» con el objeto', async () => {
    const e = await escena();
    const r = await llamar(pedir(e), admin(T));
    expect(r).toEqual({ tipo: 'image', categoria: 'image', mime: 'image/jpeg', extension: 'jpg', tamano: e.bytes.length, base64: e.bytes.toString('base64') });
    const a = await auditoria(T);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ accion: 'medio_visto', uid: `u-admin-${T}`, rol: 'admin', objeto: AL.nombreDeObjeto(e.idMeta), resultado: 'ok' });
    expect(await topes()).toEqual([`u-admin-${T}`]);
  });
  it('el operador ve y queda como «oper»', async () => {
    const e = await escena();
    expect(await llamar(pedir(e), oper(T))).toMatchObject({ tipo: 'image' });
    expect((await auditoria(T))[0]).toMatchObject({ rol: 'oper', resultado: 'ok' });
  });
  it('el soporte con ventana vigente en ESE comercio ve y queda como «soporte»', async () => {
    const e = await escena();
    await db.doc(`tenants/${T}/accesosSoporte/u-soporte`).set({ expira: Timestamp.fromMillis(Date.now() + 3_600_000) });
    expect(await llamar(pedir(e), soporte())).toMatchObject({ tipo: 'image' });
    expect((await auditoria(T))[0]).toMatchObject({ rol: 'soporte', uid: 'u-soporte', resultado: 'ok' });
  });
  it('un comercio SUSPENDIDO sí puede ver', async () => {
    const e = await escena('medio-suspendido', { fichaExtra: { estado: 'suspendido' } });
    expect(await llamar(pedir(e), admin(e.t))).toMatchObject({ tipo: 'image' });
  });
  it('imagen y audio salen con el mime de su firma; PDF, video y documentos SIEMPRE como octet-stream', async () => {
    const casos: Array<[Buffer, V.ExtensionLeida | undefined, string, string, string]> = [
      [JPG(), undefined, 'image', 'image/jpeg', 'jpg'], [PNG(), undefined, 'image', 'image/png', 'png'],
      [OGG(), undefined, 'audio', 'audio/ogg', 'ogg'], [M4A(), undefined, 'audio', 'audio/mp4', 'm4a'],
      [PDF(), 'pdf', 'document', V.MIME_DE_DESCARGA, 'pdf'],
      [MP4(), 'mp4', 'video', V.MIME_DE_DESCARGA, 'mp4'], [MP4('3gp4'), '3gp', 'video', V.MIME_DE_DESCARGA, '3gp'],
      [Buffer.from('MZ\x90ejecutable'), 'bin', 'document', V.MIME_DE_DESCARGA, 'bin'],
    ];
    for (const [i, [bytes, ext, tipo, mime, extension]] of casos.entries()) {
      const e = await escena(T, { idMeta: `wamid.tipo${i}`, bytes, ...(ext ? { ext } : {}) });
      const r = await llamar(pedir(e), admin(T)) as V.MedioVisto;
      expect([r.tipo, r.categoria, r.mime, r.extension], String(i)).toEqual([tipo, tipo, mime, extension]);
      expect(Buffer.from(r.base64, 'base64').equals(bytes)).toBe(true);
    }
  });
  it('lee SOLO la ruta del metadato: un getMetadata y una descarga, de esa ruta', async () => {
    const e = await escena();
    await llamar(pedir(e), admin(T));
    expect(almacen.metadatosRutas).toEqual([e.ruta]);
    expect(almacen.leerRutas).toEqual([e.ruta]);
  });
  it('el audio de 16 MiB (el tope de WhatsApp) sale entero y su respuesta cabe en los 32 MiB de una callable gen2', async () => {
    const bytes = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(V.TOPE_DE_LECTURA.audio - 4, 1)]);
    const e = await escena(T, { idMeta: 'wamid.audio16', bytes });
    const r = await llamar(pedir(e), admin(T)) as V.MedioVisto;
    expect(r.tamano).toBe(16 * 1024 * 1024);
    expect(r.base64.length).toBe(22_369_624);
    const sobre = Buffer.byteLength(JSON.stringify({ result: r }));
    expect(sobre).toBeLessThan(32 * 1024 * 1024);
    expect(sobre).toBeGreaterThan(10 * 1024 * 1024); // no cabría en 1.ª generación
  }, 60_000);
});

// ===========================================================================
describe('quién NO pasa (y no deja nada escrito)', () => {
  it('sin sesión: unauthenticated, sin almacén ni Firestore', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    await expect(llamar(pedir(e), undefined)).rejects.toMatchObject(falla('unauthenticated', FIJOS.sinSesion));
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
  it('administrador y operador de OTRO comercio: permission-denied, sin almacén y sin escribir en el pedido', async () => {
    const e = await escena(OTRO);
    const antes = await documentosDe(OTRO);
    for (const quien of [admin(T, 'u-a-de-t'), oper(T, 'u-o-de-t')]) {
      await expect(llamar(pedir(e), quien)).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(OTRO)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
  it('correo sin verificar, sesión de Google con rol de comercio, ingesta y sesión sin claims: denegados sin escribir', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    const intrusos = [
      actor('u-sin-correo-a', { t: { [T]: 'admin' } }, { verificado: false }),
      actor('u-sin-correo-o', { t: { [T]: 'oper' } }, { verificado: false }),
      actor('u-google', { t: { [T]: 'admin' } }, { proveedor: 'google.com' }),
      actor('svc-ingesta-1', { t: { [T]: 'ingesta' } }, { proveedor: 'custom' }),
      actor('svc-ingesta-2', { t: { [T]: 'ingesta' } }, { proveedor: 'password' }),
      actor('u-huerfano', {}),
    ];
    for (const quien of intrusos) await expect(llamar(pedir(e), quien), quien.uid).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
  it('soporte sin ventana, vencida, de otro comercio o con sesión de contraseña: denegado sin escribir', async () => {
    const e = await escena();
    await escena(OTRO);
    await db.doc(`tenants/${T}/accesosSoporte/u-vencido`).set({ expira: Timestamp.fromMillis(Date.now() - 1000) });
    await db.doc(`tenants/${OTRO}/accesosSoporte/u-de-otro`).set({ expira: Timestamp.fromMillis(Date.now() + 3_600_000) });
    await db.doc(`tenants/${T}/accesosSoporte/u-pass`).set({ expira: Timestamp.fromMillis(Date.now() + 3_600_000) });
    const antes = await documentosDe(T);
    for (const quien of [soporte('u-sin-ventana'), soporte('u-vencido'), soporte('u-de-otro'), actor('u-pass', { t: {}, p: true }, { proveedor: 'password' })]) {
      await expect(llamar(pedir(e), quien), quien.uid).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
  it('la cuenta deshabilitada o sin el rol según Auth (el token sí lo trae): denegado', async () => {
    const e = await escena();
    const a = admin(T);
    cuentas.set(a.uid, { disabled: true, customClaims: { nc: a.token['nc'] }, tokensValidAfterTime: undefined });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'permission-denied' });
    cuentas.set(a.uid, { disabled: false, customClaims: { nc: { t: {} } }, tokensValidAfterTime: undefined });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(almacen.llamadas).toBe(0);
  });
  it('Auth caído: unavailable (no «sin permiso»), sin escribir y sin el mensaje del error en el log', async () => {
    const e = await escena();
    h.getUser.mockRejectedValue(Object.assign(new Error(`Auth caído en tenants/${T}`), { code: 'auth/internal-error' }));
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    expect(salida.join('\n')).not.toContain('Auth caído');
    expect(await topes()).toEqual([]);
  });
  it('comercio dado de baja, estado raro o inexistente: not-found y no nace NADA bajo ese comercio', async () => {
    for (const estado of ['dado_de_baja', 'pendiente', 'ACTIVO']) {
      const e = await escena('medio-baja', { fichaExtra: { estado } });
      const antes = await documentosDe(e.t);
      await expect(llamar(pedir(e), admin(e.t)), estado).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
      expect(await documentosDe(e.t)).toEqual(antes);
    }
    const t = 'medio-fantasma';
    await expect(llamar({ tenantId: t, conversacionId: CONV, idMeta: 'wamid.x', accion: 'ver' }, admin(t))).rejects.toMatchObject({ code: 'not-found' });
    expect(await documentosDe(t)).toEqual([]);
    expect(almacen.llamadas).toBe(0);
    expect(await topes()).toEqual([]);
  });
});

// ===========================================================================
describe('la forma de la entrada', () => {
  it('una clave de más (cierreId, ruta, path, rutaComprobante): invalid-argument, y la ruta del cliente no llega al almacén', async () => {
    const e = await escena();
    const intrusa = `tenants/${OTRO}/medios/${AL.diaDeLaPaz(Date.now())}/${AL.nombreDeObjeto('wamid.ajeno')}.jpg`;
    almacen.objetos.set(intrusa, PNG());
    for (const extra of [{ cierreId: 'venta_x' }, { ruta: intrusa }, { path: intrusa }, { rutaComprobante: intrusa }, { tipo: 'audio' }]) {
      await expect(llamar({ ...pedir(e), ...extra }, admin(T)), JSON.stringify(extra)).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await topes()).toEqual([]);
  });
  it('tenantId, conversacionId o idMeta con forma inválida, o datos que no son objeto: invalid-argument sin tocar nada', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    const malos: unknown[] = [
      { ...pedir(e), tenantId: '../otro' }, { ...pedir(e), tenantId: 'A-Mayus' }, { ...pedir(e), tenantId: 42 },
      { ...pedir(e), conversacionId: TEL }, { ...pedir(e), conversacionId: 'wa_123' }, { ...pedir(e), conversacionId: `wa_${'1'.repeat(16)}` },
      { ...pedir(e), conversacionId: `${CONV}/mensajes` },
      { ...pedir(e), idMeta: '' }, { ...pedir(e), idMeta: 'con espacio' }, { ...pedir(e), idMeta: 'x'.repeat(121) }, { ...pedir(e), idMeta: 7 },
      { tenantId: T, conversacionId: CONV }, { tenantId: T, idMeta: e.idMeta },
      { ...pedir(e), accion: undefined }, { ...pedir(e), accion: 'borrar' }, { ...pedir(e), accion: 'VER' }, { ...pedir(e), accion: ['ver'] },
      { tenantId: T, conversacionId: CONV, idMeta: e.idMeta },
      undefined, null, 'texto', ['x'], 7,
    ];
    for (const data of malos) await expect(llamar(data, admin(T)), JSON.stringify(data)).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
  });
  it('una conversación de 8 dígitos (el mínimo de guardarMedio) se acepta', async () => {
    const e = await escena(T, { conversacionId: 'wa_70000123' });
    expect(await llamar(pedir(e), admin(T))).toMatchObject({ tipo: 'image' });
  });
});

// ===========================================================================
describe('el metadato: de ESTA conversación, guardado y vigente', () => {
  it('pedido desde OTRA conversación (el idMeta sí existe): not-found, sin almacén, auditado «sin_medio»', async () => {
    const e = await escena();
    await expect(llamar({ ...pedir(e), conversacionId: OTRA_CONV }, admin(T))).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
    expect(almacen.llamadas).toBe(0);
    expect((await auditoria(T))[0]).toMatchObject({ resultado: 'rechazado', motivo: 'sin_medio' });
  });
  it('un metadato cuyo idMeta guardado difiere del pedido (mismo hash forzado): not-found', async () => {
    const e = await escena();
    await refMeta(e).update({ idMeta: 'wamid.otro' });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
  });
  it('un medio que no existe: not-found', async () => {
    await escena();
    await expect(llamar({ tenantId: T, conversacionId: CONV, idMeta: 'wamid.no-existe', accion: 'ver' }, admin(T))).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
    expect(almacen.llamadas).toBe(0);
  });
  it('ANOTADO (docx/xlsx sin bytes): failed-precondition con detalle «anotado», sin tocar el almacén', async () => {
    const e = await escena(T, { meta: { estado: 'anotado', ruta: null, tamano: null, sha256: null, ext: 'docx', tipo: 'document' } });
    const error = await llamar(pedir(e), admin(T)).catch((x) => x) as { code: string; message: string; details: unknown };
    expect(error).toMatchObject(falla('failed-precondition', FIJOS.anotado));
    expect(error.details).toBe('anotado');
    expect(almacen.llamadas).toBe(0);
    expect((await auditoria(T))[0]).toMatchObject({ resultado: 'rechazado', motivo: 'anotado' });
  });
  it('PENDIENTE: failed-precondition con detalle «pendiente», sin tocar el almacén (aunque el objeto ya esté)', async () => {
    const e = await escena(T, { meta: { estado: 'pendiente' } });
    const error = await llamar(pedir(e), admin(T)).catch((x) => x) as { code: string; details: unknown };
    expect(error).toMatchObject(falla('failed-precondition', FIJOS.pendiente));
    expect(error.details).toBe('pendiente');
    expect(almacen.llamadas).toBe(0);
  });
  it('un estado raro o ausente: not-found', async () => {
    for (const [i, estado] of (['GUARDADO', 'borrado', null] as const).entries()) {
      const e = await escena(T, { idMeta: `wamid.raro${i}`, meta: { estado } });
      await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    }
    const e = await escena(T, { idMeta: 'wamid.sin-estado' });
    await refMeta(e).update({ estado: FieldValue.delete() });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
  });
  it('VENCIDO (vence en el pasado, el TTL aún no lo borró) o sin vence: not-found «caducado», sin almacén', async () => {
    const e = await escena(T, { meta: { vence: Timestamp.fromMillis(Date.now() - 1000) } });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
    const e2 = await escena(T, { idMeta: 'wamid.sin-vence', meta: { vence: 'mañana' } });
    await expect(llamar(pedir(e2), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
    expect((await auditoria(T)).map((x) => x['motivo'])).toEqual(['caducado', 'caducado']);
  });
});

// ===========================================================================
describe('una ruta que no es de ESTE comercio y ESTE medio no llega al almacén', () => {
  const dia = () => AL.diaDeLaPaz(Date.now());
  const malas = (idMeta: string): Array<[string, unknown]> => [
    ['de otro comercio', `tenants/${OTRO}/medios/${dia()}/${AL.nombreDeObjeto(idMeta)}.jpg`],
    ['de otro medio', `tenants/${T}/medios/${dia()}/${AL.nombreDeObjeto('wamid.otro-medio')}.jpg`],
    ['con «..»', `tenants/${T}/medios/../../${OTRO}/medios/${dia()}/${AL.nombreDeObjeto(idMeta)}.jpg`],
    ['con «..» en el día', `tenants/${T}/medios/..//${AL.nombreDeObjeto(idMeta)}.jpg`],
    ['en comprobantes', `tenants/${T}/comprobantes/${dia()}/${AL.nombreDeObjeto(idMeta)}.jpg`],
    ['día sin forma de fecha', `tenants/${T}/medios/hoy/${AL.nombreDeObjeto(idMeta)}.jpg`],
    ['extensión fuera de la lista', `tenants/${T}/medios/${dia()}/${AL.nombreDeObjeto(idMeta)}.html`],
    ['con un tramo de más', `tenants/${T}/medios/${dia()}/x/${AL.nombreDeObjeto(idMeta)}.jpg`],
    ['absoluta de otro bucket', `gs://otro/tenants/${T}/medios/${dia()}/${AL.nombreDeObjeto(idMeta)}.jpg`],
    ['no es cadena', 12345],
    ['nula', null],
  ];
  it('cada ruta indebida en el metadato: not-found «ruta_invalida», y el almacén no recibe NADA', async () => {
    for (const [i, [nombre, mala]] of malas('wamid.base').entries()) {
      const e = await escena(T, { idMeta: 'wamid.base' });
      if (typeof mala === 'string') almacen.objetos.set(mala, PNG());
      await refMeta(e).update({ ruta: mala });
      await expect(llamar(pedir(e), admin(T, `u-r${i}`)), nombre).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
      expect(almacen.llamadas, nombre).toBe(0);
    }
    const a = await auditoria(T);
    expect(a.every((x) => x['motivo'] === 'ruta_invalida')).toBe(true);
    expect(a).toHaveLength(malas('x').length);
  });
  it('la extensión de la ruta tiene que ser la del metadato', async () => {
    const e = await escena();
    await refMeta(e).update({ ext: 'png' });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
  });
  it('rutaValidaDeMedio acepta la forma exacta y nada más', () => {
    const ok = `tenants/${T}/medios/2026-10-30/${AL.nombreDeObjeto('wamid.z')}.ogg`;
    expect(V.rutaValidaDeMedio(ok, T, 'wamid.z')).toBe(ok);
    expect(V.rutaValidaDeMedio(ok, OTRO, 'wamid.z')).toBeNull();
    expect(V.rutaValidaDeMedio(ok, T, 'wamid.y')).toBeNull();
    expect(V.rutaValidaDeMedio(ok.replace('.ogg', '.docx'), T, 'wamid.z')).toBe(ok.replace('.ogg', '.docx'));
    for (const mala of ['.exe', '.html', '.svg', '.js', '.EXE', '']) expect(V.rutaValidaDeMedio(ok.replace('.ogg', mala), T, 'wamid.z'), mala).toBeNull();
    expect(V.rutaValidaDeMedio(`${ok}\\..`, T, 'wamid.z')).toBeNull();
  });
});

// ===========================================================================
describe('el tipo se decide por los bytes; la huella, por el guardado', () => {
  const sinBytes = async (e: Escena) => {
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
  };
  it('un .jpg que trae SVG, HTML o texto (el metadato dice jpeg): sin bytes, auditado «tipo_no_coincide»', async () => {
    for (const [i, cuerpo] of (['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<html><script>alert(1)</script></html>', 'texto'] as const).entries()) {
      const e = await escena(T, { idMeta: `wamid.h${i}` });
      almacen.objetos.set(e.ruta, Buffer.from(cuerpo));
      await refMeta(e).update({ sha256: createHash('sha256').update(cuerpo).digest('hex'), tamano: cuerpo.length });
      await sinBytes(e);
    }
    expect((await auditoria(T)).every((x) => x['motivo'] === 'tipo_no_coincide')).toBe(true);
  });
  it('imagen o audio con bytes de otra cosa (png en .jpg, jpg en .ogg, ogg en .m4a, HTML en .webp): sin bytes', async () => {
    const casos: Array<[V.ExtensionLeida, Buffer]> = [['jpg', PNG()], ['ogg', JPG()], ['m4a', OGG()], ['webp', Buffer.from('<html/>')]];
    for (const [i, [ext, bytes]] of casos.entries()) {
      const e = await escena(T, { idMeta: `wamid.x${i}`, bytes: JPG(), ext });
      almacen.objetos.set(e.ruta, bytes);
      await refMeta(e).update({ sha256: createHash('sha256').update(bytes).digest('hex') });
      await sinBytes(e);
    }
  });
  it('la extensión se RECALCULA desde los bytes y tiene que ser la de la ruta: si no, sin bytes', async () => {
    const malos: Array<[V.ExtensionLeida, Buffer, string | undefined]> = [
      ['pdf', Buffer.from('MZ no es pdf'), undefined], ['docx', Buffer.from('no es zip'), DOCX], ['doc', ZIP(), 'application/msword'],
      ['txt', Buffer.from([0x41, 0, 0x42]), 'text/plain'], ['docx', ZIP(), 'application/vnd.ms-word.document.macroEnabled.12'],
      ['mp4', MP4('M4A '), undefined], ['mp4', Buffer.from('video falso'), undefined], ['3gp', MP4('isom'), undefined],
      ['bin', PDF(), undefined],
    ];
    for (const [i, [ext, bytes, mime]] of malos.entries()) {
      const e = await escena(T, { idMeta: `wamid.dm${i}`, bytes, ext, ...(mime ? { meta: { mime } } : {}) });
      await expect(llamar(pedir(e, 'descargar'), admin(T)), `${ext} ${i}`).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
    }
    expect((await auditoria(T)).every((x) => x['motivo'] === 'tipo_no_coincide')).toBe(true);
  });
  it('documentos que sí se sostienen: docx (PK + su mime), xls (OLE), csv (texto UTF-8), todos como octet-stream', async () => {
    const buenos: Array<[V.ExtensionLeida, Buffer, string]> = [
      ['docx', OFFICE('word/'), DOCX], ['xlsx', OFFICE('xl/'), XLSX], ['xls', OLE(), 'application/vnd.ms-excel'], ['csv', Buffer.from('a,b\nñ,2'), 'text/csv'], ['zip', ZIP(), 'application/zip'],
    ];
    for (const [i, [ext, bytes, mime]] of buenos.entries()) {
      const e = await escena(T, { idMeta: `wamid.db${i}`, bytes, ext, meta: { mime } });
      const r = await llamar(pedir(e, 'descargar'), admin(T)) as V.MedioVisto;
      expect([r.extension, r.mime, r.categoria], ext).toEqual([ext, V.MIME_DE_DESCARGA, 'document']);
    }
  });
  it('NUNCA el mime declarado: un «bin» con metadato «text/html» o un video «video/mp4» salen como octet-stream', async () => {
    const d = await escena(T, { idMeta: 'wamid.html', bytes: Buffer.from('<html><script>x</script></html>'), ext: 'bin', meta: { mime: 'text/html' } });
    expect(await llamar(pedir(d, 'descargar'), admin(T))).toMatchObject({ mime: V.MIME_DE_DESCARGA, extension: 'bin' });
    const v = await escena(T, { idMeta: 'wamid.vid', bytes: MP4(), ext: 'mp4', meta: { mime: 'video/mp4' } });
    expect(await llamar(pedir(v, 'descargar'), admin(T))).toMatchObject({ mime: V.MIME_DE_DESCARGA, categoria: 'video' });
  });
  it('sin categoria, ext, tipo ni mime en el metadato (anterior a M1b): se deducen de la ruta', async () => {
    const e = await escena();
    await refMeta(e).update({ categoria: FieldValue.delete(), ext: FieldValue.delete(), tipo: FieldValue.delete(), mime: FieldValue.delete() });
    expect(await llamar(pedir(e), admin(T))).toMatchObject({ categoria: 'image', mime: 'image/jpeg', extension: 'jpg' });
  });
  it('una categoria del metadato que contradice la ruta (video en un .jpg, o desconocida): sin tocar el almacén', async () => {
    for (const [i, categoria] of (['video', 'sticker', 'IMAGE'] as const).entries()) {
      const e = await escena(T, { idMeta: `wamid.c${i}`, meta: { categoria } });
      await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
    }
    expect(almacen.llamadas).toBe(0);
  });
  it('el mime del metadato manda: unos bytes png con metadato «image/jpeg» no salen', async () => {
    const e = await escena(T, { bytes: PNG() });
    await refMeta(e).update({ mime: 'image/jpeg' });
    await sinBytes(e);
  });
  it('el tipo del metadato tiene que ser el de la extensión (audio en un .jpg): sin tocar el almacén', async () => {
    const e = await escena();
    await refMeta(e).update({ tipo: 'audio' });
    await sinBytes(e);
    expect(almacen.llamadas).toBe(0);
  });
  it('bytes válidos pero DISTINTOS de los guardados (sha256 no coincide) o sin sha256: «integridad», sin bytes', async () => {
    const e = await escena();
    almacen.objetos.set(e.ruta, JPG(99));
    await sinBytes(e);
    const e2 = await escena(T, { idMeta: 'wamid.sin-huella', meta: { sha256: null } });
    await sinBytes(e2);
    expect((await auditoria(T)).map((x) => x['motivo'])).toEqual(['integridad', 'integridad']);
  });
});

// ===========================================================================
describe('lo que no está y lo demasiado grande', () => {
  it('objeto purgado: not-found con texto fijo, sin la ruta en el mensaje, y sin descargar', async () => {
    const e = await escena(T, { sinObjeto: true });
    const error = await llamar(pedir(e), admin(T)).catch((x) => x) as { code: string; message: string };
    expect(error).toMatchObject(falla('not-found', FIJOS.noHay));
    expect(error.message).not.toContain('tenants/');
    expect(almacen.leerRutas).toEqual([]);
  });
  it('getMetadata dice que existe y la descarga da 404: not-found', async () => {
    const e = await escena();
    almacen.leer = async (ruta: string) => { almacen.leerRutas.push(ruta); return null; };
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'not-found' });
  });
  it('imagen > 5 MB, y documento, video y audio > 16 MB según getMetadata: failed-precondition SIN descargar', async () => {
    const casos: Array<[Buffer, V.ExtensionLeida | undefined, number]> = [
      [JPG(), undefined, 5 * TI.MB + 1], [PDF(), 'pdf', 16 * TI.MB + 1], [OGG(), undefined, 16 * TI.MB + 1], [MP4(), 'mp4', 16 * TI.MB + 1],
    ];
    for (const [i, [bytes, ext, tamano]] of casos.entries()) {
      const e = await escena(T, { idMeta: `wamid.g${i}`, bytes, ...(ext ? { ext } : {}) });
      almacen.tamanoFalso.set(e.ruta, tamano);
      await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
    }
    expect(almacen.leerRutas).toEqual([]);
    expect((await auditoria(T)).map((x) => x['motivo'])).toEqual(['demasiado_grande', 'demasiado_grande', 'demasiado_grande', 'demasiado_grande']);
    expect(V.TOPE_DE_LECTURA).toEqual({ image: 5 * TI.MB, audio: 16 * TI.MB, video: 16 * TI.MB, document: 16 * TI.MB });
  });
  it('un audio de 6 MB pasa el tamaño; una imagen de 6 MB no', async () => {
    const a = await escena(T, { idMeta: 'wamid.a6', bytes: OGG() });
    almacen.tamanoFalso.set(a.ruta, 6 * TI.MB);
    expect(await llamar(pedir(a), admin(T))).toMatchObject({ tipo: 'audio' });
    const i = await escena(T, { idMeta: 'wamid.i6' });
    almacen.tamanoFalso.set(i.ruta, 6 * TI.MB);
    await expect(llamar(pedir(i), admin(T))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('getMetadata dice poco pero llegan más bytes que el tope: rechazado; un tamaño infinito, también', async () => {
    const e = await escena(T, { bytes: Buffer.concat([JPG(), Buffer.alloc(V.TOPE_DE_LECTURA.image + 10)]) });
    almacen.tamanoFalso.set(e.ruta, 100);
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
    const e2 = await escena(T, { idMeta: 'wamid.inf' });
    almacen.tamanoFalso.set(e2.ruta, Number.POSITIVE_INFINITY);
    await expect(llamar(pedir(e2), admin(T))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ===========================================================================
describe('auditoría fail-closed y lo que queda escrito', () => {
  it('la auditoría caída en una vista correcta: unavailable, mensaje fijo, sin bytes', async () => {
    const e = await escena();
    V.fijarAuditorDeMediosDePrueba(async () => { throw Object.assign(new Error(`caída en tenants/${T}/auditoria`), { code: 14 }); });
    const error = await llamar(pedir(e), admin(T)).catch((x) => x);
    expect(error).toMatchObject(falla('unavailable', FIJOS.noDisponible));
    expect(JSON.stringify(error)).not.toContain(e.bytes.toString('base64'));
    expect(await auditoria(T)).toEqual([]);
    expect(salida.join('\n')).not.toContain('caída en');
  });
  it('un rechazo cuya auditoría falla responde unavailable, no el rechazo', async () => {
    const e = await escena(T, { meta: { estado: 'anotado' } });
    V.fijarAuditorDeMediosDePrueba(async () => { throw new Error('caída'); });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
  });
  it('la auditoría se escribe ANTES de devolver, una vez, con el detalle exacto; nunca la bitácora', async () => {
    const e = await escena();
    const llamadas: unknown[][] = [];
    V.fijarAuditorDeMediosDePrueba(async (...a) => { llamadas.push(a); return V.auditarEnFirestore(...a); });
    await llamar(pedir(e), admin(T));
    expect(llamadas).toEqual([[T, `u-admin-${T}`, 'medio_visto', { rol: 'admin', objeto: AL.nombreDeObjeto(e.idMeta), resultado: 'ok' }]]);
    expect((await db.collection(`tenants/${T}/bitacora`).get()).size).toBe(0);
    expect(CODIGO).not.toMatch(/\bregistrar\s*\(/);
    expect(CODIGO).not.toMatch(/bitacora/i);
  });
  it('el asiento de una vista tiene EXACTAMENTE {accion, uid, rol, objeto, resultado, en}, sin teléfono, idMeta, ruta ni bytes', async () => {
    const e = await escena();
    await llamar(pedir(e), oper(T));
    const a = await auditoria(T);
    expect(Object.keys(a[0]!).sort()).toEqual(['accion', 'en', 'objeto', 'resultado', 'rol', 'uid']);
    const crudo = JSON.stringify(a);
    for (const prohibido of [TEL, CONV, e.idMeta, e.ruta, 'tenants/', e.bytes.toString('base64')]) expect(crudo).not.toContain(prohibido);
  });
  it('la fuente no importa Central ni módulos (core no depende de nada de arriba)', () => {
    expect(FUENTE).not.toMatch(/from '\.\.\/\.\.\/(central|modulos|plataforma)\//);
    expect(FUENTE).not.toMatch(/registro\.js/);
  });
});

// ===========================================================================
describe('el tope por usuario, en topesDeMedios', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.UTC(2026, 9, 9, 14, 30)); });
  const hora = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 13);
  const dia = () => hora().slice(0, 10);

  it('con el tope de la hora lleno (60): resource-exhausted auditado «tope», sin almacén ni lectura del metadato; otro usuario sigue pudiendo', async () => {
    const e = await escena();
    const a = admin(T);
    await db.doc(`topesDeMedios/${a.uid}`).set({ hora: hora(), vistasHora: V.TOPE_POR_HORA, dia: dia(), vistasDia: V.TOPE_POR_HORA });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject(falla('resource-exhausted', FIJOS.tope));
    expect(almacen.llamadas).toBe(0);
    expect((await db.doc(`topesDeMedios/${a.uid}`).get()).get('vistasHora')).toBe(V.TOPE_POR_HORA);
    expect((await auditoria(T))[0]).toMatchObject({ motivo: 'tope', resultado: 'rechazado' });
    expect(await llamar(pedir(e), oper(T))).toMatchObject({ tipo: 'image' });
  });
  it('la última vista de la hora pasa; un pedido que termina en not-found también consume el cupo', async () => {
    const e = await escena();
    const a = admin(T);
    await db.doc(`topesDeMedios/${a.uid}`).set({ hora: hora(), vistasHora: V.TOPE_POR_HORA - 2, dia: dia(), vistasDia: V.TOPE_POR_HORA - 2 });
    await expect(llamar({ ...pedir(e), idMeta: 'wamid.no' }, a)).rejects.toMatchObject({ code: 'not-found' });
    expect(await llamar(pedir(e), a)).toMatchObject({ tipo: 'image' });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
  it('el tope del día (300) con la hora renovada: la última pasa y la siguiente no', async () => {
    const e = await escena();
    const a = admin(T);
    await db.doc(`topesDeMedios/${a.uid}`).set({ hora: '1999-01-01T00', vistasHora: 3, dia: dia(), vistasDia: V.TOPE_POR_DIA - 1 });
    expect(await llamar(pedir(e), a)).toMatchObject({ tipo: 'image' });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
  it('un contador corrupto falla cerrado', async () => {
    const e = await escena();
    const a = admin(T);
    for (const malo of [{ vistasHora: 'x' }, { vistasHora: -1 }, { vistasHora: 1.5 }, { vistasDia: null }]) {
      await db.doc(`topesDeMedios/${a.uid}`).set({ hora: hora(), vistasHora: 0, dia: dia(), vistasDia: 0, ...malo });
      await expect(llamar(pedir(e), a), JSON.stringify(malo)).rejects.toMatchObject({ code: 'resource-exhausted' });
    }
  });
  it('NO comparte cupo con el visor de comprobantes: topesDelVisor lleno no frena, y verMedio no lo toca', async () => {
    const e = await escena();
    const a = admin(T);
    const lleno = { hora: hora(), vistasHora: 30, dia: dia(), vistasDia: 100 };
    await db.doc(`topesDelVisor/${a.uid}`).set(lleno);
    expect(await llamar(pedir(e), a)).toMatchObject({ tipo: 'image' });
    expect((await db.doc(`topesDelVisor/${a.uid}`).get()).data()).toEqual(lleno);
    expect(V.COLECCION_DEL_TOPE).toBe('topesDeMedios');
  });
  it('dos pedidos simultáneos con un solo cupo: solo uno lo consigue; un uid con forma de ruta lanza', async () => {
    const uid = 'u-carrera';
    await db.doc(`topesDeMedios/${uid}`).set({ hora: hora(), vistasHora: V.TOPE_POR_HORA - 1, dia: dia(), vistasDia: V.TOPE_POR_HORA - 1 });
    const r = await Promise.all([1, 2, 3].map(() => V.consumirCupoDeMedios(uid, Date.now())));
    expect(r.filter((x) => x === 'ok')).toHaveLength(1);
    await expect(V.consumirCupoDeMedios('../tenants/x', Date.now())).rejects.toThrow();
  });
  it('el tope declarado es 60 por hora y 300 por día (cifras del integrador)', () => {
    expect([V.TOPE_POR_HORA, V.TOPE_POR_DIA]).toEqual([60, 300]);
    expect(CODIGO.match(/TOPE_POR_HORA = \d+/g)).toHaveLength(1);
    expect(CODIGO.match(/TOPE_POR_DIA = \d+/g)).toHaveLength(1);
  });
  it('el caso que motivó el ajuste: un operador revisa las 31 fotos de un paciente sin quedarse sin cuota', async () => {
    const a = oper(T);
    for (let i = 0; i < 31; i++) {
      const e = await escena(T, { idMeta: `wamid.foto${i}` });
      expect(await llamar(pedir(e), a), String(i)).toMatchObject({ categoria: 'image' });
    }
    expect((await db.doc(`topesDeMedios/${a.uid}`).get()).data()).toMatchObject({ vistasHora: 31, vistasDia: 31 });
  }, 120_000);
  it('consumirCupoDeMedios: 60 en la hora y la 61 no; con la hora nueva sigue hasta 300 en el día', async () => {
    const uid = 'u-cifras';
    const t0 = Date.UTC(2026, 9, 9, 14, 0);
    await db.doc(`topesDeMedios/${uid}`).set({ hora: '2026-10-09T10', vistasHora: 59, dia: '2026-10-09', vistasDia: 59 });
    expect(await V.consumirCupoDeMedios(uid, t0)).toBe('ok');
    expect(await V.consumirCupoDeMedios(uid, t0 + 1)).toBe('agotado_anotar');
    await db.doc(`topesDeMedios/${uid}`).set({ hora: '2026-10-09T10', vistasHora: 60, dia: '2026-10-09', vistasDia: 299 });
    expect(await V.consumirCupoDeMedios(uid, Date.UTC(2026, 9, 9, 15, 0))).toBe('ok');
    expect(await V.consumirCupoDeMedios(uid, Date.UTC(2026, 9, 9, 16, 0))).toBe('agotado_anotar');
  });
  it('sin cupo, a lo sumo UN asiento de «tope» por usuario y hora: el intento 61 escribe uno; el 62 y siguientes, ninguno', async () => {
    const e = await escena();
    const a = admin(T);
    await db.doc(`topesDeMedios/${a.uid}`).set({ hora: hora(), vistasHora: V.TOPE_POR_HORA, dia: dia(), vistasDia: V.TOPE_POR_HORA });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject(falla('resource-exhausted', FIJOS.tope));
    expect(await auditoria(T)).toHaveLength(1);
    const tras61 = (await db.doc(`topesDeMedios/${a.uid}`).get()).data();
    expect(tras61).toMatchObject({ constanciaHora: hora(), vistasHora: V.TOPE_POR_HORA });
    const antes = await documentosDe(T);
    for (let i = 0; i < 5; i++) await expect(llamar(pedir(e), a)).rejects.toMatchObject(falla('resource-exhausted', FIJOS.tope));
    expect(await auditoria(T)).toHaveLength(1);
    expect(await documentosDe(T)).toEqual(antes);
    expect((await db.doc(`topesDeMedios/${a.uid}`).get()).get('actualizadoEn')).toEqual(tras61!['actualizadoEn']);
    expect(almacen.llamadas).toBe(0);
    // En la hora siguiente (día también agotado), otra constancia: una por hora, no una para siempre.
    vi.setSystemTime(Date.now() + 3_600_000);
    await db.doc(`topesDeMedios/${a.uid}`).update({ dia: dia(), vistasDia: V.TOPE_POR_DIA });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'resource-exhausted' });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(await auditoria(T)).toHaveLength(2);
  });
  it('un contador corrupto también deja una sola constancia por hora', async () => {
    const e = await escena();
    const a = admin(T);
    await db.doc(`topesDeMedios/${a.uid}`).set({ hora: hora(), vistasHora: 'x', dia: dia(), vistasDia: 0 });
    for (let i = 0; i < 3; i++) await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(await auditoria(T)).toHaveLength(1);
  });
});

// ===========================================================================
describe('ninguna salida de console trae teléfono, idMeta, ruta, hash ni comercio', () => {
  const secreto = (e: Escena) => [TEL, CONV, e.idMeta, e.ruta, AL.nombreDeObjeto(e.idMeta), e.t, 'tenants/', 'medios/', 'ENOTFOUND'];
  it('un error de Storage cuyo mensaje trae la ruta: unavailable fijo, log solo con el código', async () => {
    const e = await escena();
    almacen.fallaMetadatos = Object.assign(new Error(`getaddrinfo ENOTFOUND al leer ${e.ruta}`), { code: 500 });
    const error = await llamar(pedir(e), admin(T, 'u-a1')).catch((x) => x);
    expect(error).toMatchObject(falla('unavailable', FIJOS.noDisponible));
    for (const parte of secreto(e)) {
      expect(salida.join('\n'), parte).not.toContain(parte);
      expect(JSON.stringify(error), parte).not.toContain(parte);
    }
    expect((await auditoria(T))[0]).toMatchObject({ motivo: 'error_almacen' });
  });
  it('lo mismo si falla la descarga, y si revienta algo inesperado', async () => {
    const e = await escena();
    almacen.fallaLeer = Object.assign(new Error(`falló ${e.ruta}`), { code: 'ECONNRESET' });
    await expect(llamar(pedir(e), admin(T, 'u-a1'))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    almacen.fallaLeer = null;
    almacen.bytesRaros = { length: 10 };
    await expect(llamar(pedir(e), admin(T, 'u-a1'))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    for (const parte of secreto(e)) expect(salida.join('\n'), parte).not.toContain(parte);
    expect(salida.some((l) => l.includes('verMedio'))).toBe(true);
  });
  it('ningún camino (sin rol, invalid, anotado, tope, tipo, otra conversación) imprimió algo del medio', async () => {
    const e = await escena();
    await llamar(pedir(e), admin(OTRO, 'u-otro')).catch(() => undefined);
    await llamar({ ...pedir(e), ruta: e.ruta }, admin(T, 'u-a1')).catch(() => undefined);
    await llamar({ ...pedir(e), conversacionId: OTRA_CONV }, admin(T, 'u-a1')).catch(() => undefined);
    almacen.objetos.set(e.ruta, Buffer.from('<svg/>'));
    await llamar(pedir(e), admin(T, 'u-a1')).catch(() => undefined);
    await refMeta(e).update({ estado: 'anotado' });
    await llamar(pedir(e), admin(T, 'u-a1')).catch(() => undefined);
    for (const parte of secreto(e)) expect(salida.join('\n'), parte).not.toContain(parte);
    const lineas = salida.filter((l) => l.includes('verMedio'));
    expect(lineas.length).toBeGreaterThanOrEqual(5);
    for (const l of lineas) expect(Object.keys(JSON.parse(l) as object).every((k) => ['funcion', 'codigo', 'motivo', 'uid'].includes(k))).toBe(true);
  });
  it('la fuente no imprime la petición ni el mensaje de ningún error', () => {
    expect(CODIGO).not.toMatch(/\.message\b/);
    expect(CODIGO).not.toMatch(/console\.(log|info|error|debug)/);
    expect(CODIGO).not.toMatch(/console\.\w+\([^)]*\b(p\.data|datos\b)/);
  });
});

// ===========================================================================
describe('la respuesta y las opciones de la función', () => {
  it('la respuesta es exactamente {tipo, categoria, mime, extension, tamano, base64}, sin nada del metadato', async () => {
    const e = await escena();
    const r = await llamar(pedir(e), admin(T)) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['base64', 'categoria', 'extension', 'mime', 'tamano', 'tipo']);
    const crudo = JSON.stringify({ ...r, base64: '' });
    for (const prohibido of [TEL, CONV, e.idMeta, e.ruta, 'tenants/', 'wamid', AL.nombreDeObjeto(e.idMeta)]) expect(crudo).not.toContain(prohibido);
  });
  it('producción: 1 GiB, 120 s, 3 instancias, concurrencia 4 explícita, App Check exigido', () => {
    expect(V.opcionesDeVerMedio({})).toMatchObject({ memory: '1GiB', timeoutSeconds: 120, maxInstances: 3, concurrency: 4, enforceAppCheck: true, region: 'us-east1' });
  });
  it('staging (CPU fraccionaria): SIN concurrencia y sin App Check; emulador sin App Check', () => {
    const o = V.opcionesDeVerMedio({ CPU_FRACCIONARIA: 'si' });
    expect(o).toMatchObject({ memory: '1GiB', enforceAppCheck: false });
    expect(Object.hasOwn(o, 'concurrency')).toBe(false);
    expect(V.opcionesDeVerMedio({ FUNCTIONS_EMULATOR: 'true' }).enforceAppCheck).toBe(false);
    expect(V.opcionesDeVerMedio({ CPU_FRACCIONARIA: 'no' })).toMatchObject({ concurrency: 4, enforceAppCheck: true });
  });
  it('la callable real usa esas opciones (callable, 1024 MB, 120 s, 3 instancias, concurrencia 4)', () => {
    expect(CODIGO).toContain('onCall(opcionesDeVerMedio(process.env)');
    const ep = (V.verMedio as unknown as { __endpoint: Record<string, unknown> }).__endpoint;
    expect(ep['callableTrigger']).toBeDefined();
    expect([ep['availableMemoryMb'], ep['timeoutSeconds'], ep['maxInstances'], ep['concurrency']]).toEqual([1024, 120, 3, 4]);
  });
  it('fijar el auditor de prueba sin MEDIOS_DOBLE lanza', () => {
    const previo = process.env['MEDIOS_DOBLE'];
    delete process.env['MEDIOS_DOBLE'];
    try { expect(() => V.fijarAuditorDeMediosDePrueba(null)).toThrow(); } finally { process.env['MEDIOS_DOBLE'] = previo; }
  });
});

// ===========================================================================
describe('la acción (adenda §7.7): ver o descargar, y lo que puede el soporte', () => {
  const ventana = () => db.doc(`tenants/${T}/accesosSoporte/u-soporte`).set({ expira: Timestamp.fromMillis(Date.now() + 3_600_000) });
  it('descargar queda auditado como «medio_descargado», y ver como «medio_visto»', async () => {
    const e = await escena();
    await llamar(pedir(e, 'descargar'), admin(T));
    await llamar(pedir(e, 'ver'), oper(T));
    expect((await auditoria(T)).map((x) => [x['accion'], x['rol']]).sort()).toEqual([['medio_descargado', 'admin'], ['medio_visto', 'oper']]);
  });
  it('la auditoría caída en una descarga: unavailable y sin bytes', async () => {
    const e = await escena(T, { bytes: PDF(), ext: 'pdf' });
    V.fijarAuditorDeMediosDePrueba(async () => { throw new Error('caída'); });
    await expect(llamar(pedir(e, 'descargar'), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
  });
  it('admin y operador descargan un documento', async () => {
    const e = await escena(T, { bytes: PDF(), ext: 'pdf' });
    for (const quien of [admin(T), oper(T)]) expect(await llamar(pedir(e, 'descargar'), quien)).toMatchObject({ extension: 'pdf' });
  });
  it('el soporte con ventana TAMBIÉN descarga y ve todo (contrato v2 §8.3), auditado con su acción', async () => {
    await ventana();
    const d = await escena(T, { idMeta: 'wamid.sd', bytes: PDF(), ext: 'pdf' });
    const v = await escena(T, { idMeta: 'wamid.sv', bytes: MP4(), ext: 'mp4' });
    const a = await escena(T, { idMeta: 'wamid.sa', bytes: OGG() });
    expect(await llamar(pedir(d, 'descargar'), soporte())).toMatchObject({ extension: 'pdf', mime: V.MIME_DE_DESCARGA });
    expect(await llamar(pedir(v, 'descargar'), soporte())).toMatchObject({ categoria: 'video' });
    expect(await llamar(pedir(a, 'ver'), soporte())).toMatchObject({ categoria: 'audio', mime: 'audio/ogg' });
    expect((await auditoria(T)).map((x) => [x['accion'], x['rol'], x['resultado']]).sort()).toEqual([
      ['medio_descargado', 'soporte', 'ok'], ['medio_descargado', 'soporte', 'ok'], ['medio_visto', 'soporte', 'ok'],
    ]);
  });
  it('el soporte SIN ventana no descarga ni ve, y no deja nada escrito', async () => {
    const e = await escena(T, { bytes: PDF(), ext: 'pdf' });
    const antes = await documentosDe(T);
    for (const accion of ['ver', 'descargar'] as const) {
      await expect(llamar(pedir(e, accion), soporte())).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
});

// ===========================================================================
describe('las firmas que usa verMedio son las de tipos.ts (las mismas de guardarMedio)', () => {
  it('la fuente importa documentoPorFirma y tipoPorFirma de ./tipos.js y no define firmas propias', () => {
    expect(FUENTE).toMatch(/import \{[^}]*\bdocumentoPorFirma\b[^}]*\btipoPorFirma\b[^}]*\} from '\.\/tipos\.js'/);
    expect(CODIGO).not.toMatch(/function (documentoPorFirma|videoPorFirma|tipoPorFirma)\b/);
    expect(CODIGO).not.toMatch(/ftyp|0x50, 0x4b|0xd0, 0xcf/);
  });
  it('documentos: pdf, docx, xlsx y zip se reconocen; el políglota PDF-ZIP, el docx con macros y el txt con NUL son «bin»', async () => {
    const casos: Array<[string, Buffer, string, V.ExtensionLeida]> = [
      ['pdf', PDF(), 'application/pdf', 'pdf'],
      ['docx', OFFICE('word/'), DOCX, 'docx'],
      ['xlsx', OFFICE('xl/'), XLSX, 'xlsx'],
      ['zip', ZIP(), 'application/zip', 'zip'],
      ['políglota PDF que es ZIP', Buffer.concat([Buffer.from('%PDF-1.4 '), ZIP()]), 'application/pdf', 'bin'],
      ['docx con macros', OFFICE('word/', 'vbaProject.bin'), DOCX, 'bin'],
      ['txt con NUL', Buffer.from('a\0b'), 'text/plain', 'bin'],
    ];
    for (const [i, [nombre, bytes, mime, ext]] of casos.entries()) {
      expect(TI.documentoPorFirma(bytes, mime).ext, nombre).toBe(ext);
      // Y la callable llega a lo mismo leyendo el mime GUARDADO: con la ruta correcta sale; con otra, no.
      const e = await escena(T, { idMeta: `wamid.real${i}`, bytes, ext, meta: { mime: TI.documentoPorFirma(bytes, mime).mime } });
      expect(await llamar(pedir(e, 'descargar'), admin(T)), nombre).toMatchObject({ extension: ext, mime: V.MIME_DE_DESCARGA });
    }
  });
  it('mp4 contra m4a: la marca decide; un m4a guardado como video y un mp4 guardado como audio no salen', async () => {
    expect(TI.tipoPorFirma(MP4('isom'))).toMatchObject({ tipo: 'video', ext: 'mp4' });
    expect(TI.tipoPorFirma(MP4('M4A '))).toMatchObject({ tipo: 'audio', ext: 'm4a' });
    const m4aComoVideo = await escena(T, { idMeta: 'wamid.m4av', bytes: MP4('M4A '), ext: 'mp4' });
    await refMeta(m4aComoVideo).update({ tipo: 'video', categoria: 'video', mime: 'video/mp4' });
    await expect(llamar(pedir(m4aComoVideo, 'descargar'), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
    const mp4ComoAudio = await escena(T, { idMeta: 'wamid.mp4a', bytes: MP4('isom'), ext: 'm4a' });
    await refMeta(mp4ComoAudio).update({ tipo: 'audio', categoria: 'audio', mime: 'audio/mp4' });
    await expect(llamar(pedir(mp4ComoAudio), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
  });
});

// ===========================================================================
describe('si Firestore falla en el tope o en el metadato, con rol válido: asiento de rechazo y unavailable', () => {
  it('la transacción del tope falla: unavailable fijo, un asiento «error_firestore», sin almacén ni bytes', async () => {
    const e = await escena();
    const proto = Object.getPrototypeOf(db) as { runTransaction: (...a: unknown[]) => unknown };
    vi.spyOn(proto, 'runTransaction').mockRejectedValueOnce(Object.assign(new Error(`caída en topesDeMedios/${TEL}`), { code: 14 }));
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    expect((await auditoria(T)).map((x) => [x['motivo'], x['resultado']])).toEqual([['error_firestore', 'rechazado']]);
    expect(almacen.llamadas).toBe(0);
    expect(salida.join('\n')).not.toContain(TEL);
  });
  it('la lectura del metadato falla: unavailable fijo, un asiento «error_firestore», sin almacén', async () => {
    const e = await escena();
    const ref = db.doc(`tenants/${T}/mediosRecibidos/x`);
    const proto = Object.getPrototypeOf(ref) as { get: (...a: unknown[]) => unknown };
    const original = proto.get;
    vi.spyOn(proto, 'get').mockImplementation(function (this: { path: string }, ...a: unknown[]) {
      if (this.path.includes('/mediosRecibidos/')) return Promise.reject(Object.assign(new Error(`caída en ${this.path}`), { code: 14 }));
      return original.apply(this, a);
    });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    vi.restoreAllMocks();
    expect((await auditoria(T)).map((x) => x['motivo'])).toEqual(['error_firestore']);
    expect(almacen.llamadas).toBe(0);
    expect(salida.join('\n')).not.toContain('mediosRecibidos');
  });
  it('si además la auditoría falla, igual unavailable y nada sale (fail-closed)', async () => {
    const e = await escena();
    const proto = Object.getPrototypeOf(db) as { runTransaction: (...a: unknown[]) => unknown };
    vi.spyOn(proto, 'runTransaction').mockRejectedValueOnce(Object.assign(new Error('caída'), { code: 14 }));
    V.fijarAuditorDeMediosDePrueba(async () => { throw new Error('caída'); });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    expect(almacen.llamadas).toBe(0);
  });
});
