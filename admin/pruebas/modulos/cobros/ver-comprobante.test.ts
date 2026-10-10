/**
 * `verComprobante`: LOS BYTES DEL COMPROBANTE POR UNA CALLABLE, ESCRITO NEGANDO
 *
 * Contrato (visor de comprobantes, PR-1): entrada `{tenantId, cierreId}`, salida
 * exactamente `{mime, base64}`. Cada guarda crítica de `verComprobante.ts` tiene
 * acá una prueba que falla si se quita (T1 a T21 y T23 de los requisitos; la
 * parte de servidor de T24 es del manifiesto y de `despliegue.json`).
 *
 * CÓMO SE PRUEBA SIN NUBE:
 *  - Firestore: el emulador (la callable se ejecuta de verdad con `.run`, que
 *    salta App Check: de esa opción se prueba la función pura aparte).
 *  - Storage: un almacén doble que CUENTA llamadas y rutas
 *    (`COMPROBANTES_DOBLE=1`). «El almacén nunca recibe esa ruta» es una
 *    aserción sobre lo que recibió, no sobre lo que devolvió.
 *  - Auth: NO hay emulador de Auth. `firebase-admin/auth` se simula entero y
 *    `getUser` devuelve, por defecto, la cuenta vigente con los claims del token;
 *    cada prueba de T19 la cambia.
 *  - La auditoría se puede hacer fallar (`auditar` envuelto), para T17.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['COMPROBANTES_DOBLE'] = '1';

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  auditar: null as null | ((...a: unknown[]) => Promise<unknown>),
  auditarOriginal: null as null | ((...a: unknown[]) => Promise<unknown>),
}));

vi.mock('firebase-admin/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase-admin/auth')>();
  return { ...original, getAuth: () => ({ getUser: (uid: string) => h.getUser(uid) }) };
});
vi.mock('../../../functions/src/central/comunes.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../functions/src/central/comunes.ts')>();
  h.auditarOriginal = original.auditar as never;
  return { ...original, auditar: (...a: unknown[]) => (h.auditar ?? h.auditarOriginal!)(...a) };
});

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
const db = getFirestore();
const V = await import('../../../functions/src/modulos/cobros/verComprobante.ts');
const C = await import('../../../functions/src/modulos/cobros/comprobantes.ts');
const { diaDeLaPaz } = await import('../../../functions/src/modulos/cobros/cotejo.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(aqui, '..', '..', '..', 'functions', 'src', 'modulos', 'cobros', 'verComprobante.ts'), 'utf8');
/** La fuente sin comentarios: las guardas de abajo miran el código, no lo que el encabezado explica. */
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// EL ALMACÉN DOBLE, QUE CUENTA
// ---------------------------------------------------------------------------
class AlmacenDoble implements C.Almacen {
  objetos = new Map<string, { bytes: Buffer; contentType: string }>();
  metadatosRutas: string[] = [];
  leerRutas: string[] = [];
  /** Tamaños que `metadatos` declara aunque los bytes sean otros. */
  tamanoFalso = new Map<string, number>();
  fallaMetadatos: Error | null = null;
  fallaLeer: Error | null = null;
  /** Devuelve esto en lugar de los bytes (para forzar un error inesperado). */
  bytesRaros: unknown = undefined;
  async guardar(ruta: string, bytes: Buffer, contentType: string) { this.objetos.set(ruta, { bytes, contentType }); return 'creado' as const; }
  async existe(ruta: string) { return this.objetos.has(ruta); }
  async subcarpetas() { return []; }
  async borrarPrefijo() { return 0; }
  async metadatos(ruta: string) {
    this.metadatosRutas.push(ruta);
    if (this.fallaMetadatos) throw this.fallaMetadatos;
    const o = this.objetos.get(ruta);
    if (!o) return null;
    return { tamano: this.tamanoFalso.get(ruta) ?? o.bytes.length };
  }
  async leer(ruta: string) {
    this.leerRutas.push(ruta);
    if (this.fallaLeer) throw this.fallaLeer;
    if (this.bytesRaros !== undefined) return this.bytesRaros as Buffer;
    return this.objetos.get(ruta)?.bytes ?? null;
  }
  get llamadas() { return this.metadatosRutas.length + this.leerRutas.length; }
}
let almacen = new AlmacenDoble();

const JPG = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
const WEBP = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40, 5)]);
const PDF = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(40, 9)]);

// ---------------------------------------------------------------------------
// ACTORES
// ---------------------------------------------------------------------------
interface Actor { uid: string; token: Record<string, unknown> }
const cuentas = new Map<string, Record<string, unknown>>();
const authTime = () => Math.floor(Date.now() / 1000) - 60;

function actor(
  uid: string, nc: Record<string, unknown>, opciones: { proveedor?: string; verificado?: boolean } = {},
): Actor {
  const token = {
    nc: { v: 1, ...nc },
    firebase: { sign_in_provider: opciones.proveedor ?? 'password', identities: {} },
    email_verified: opciones.verificado ?? true,
    auth_time: authTime(),
  };
  // Lo que Auth "tiene" por defecto: los mismos claims que el token.
  cuentas.set(uid, { disabled: false, customClaims: { nc: token.nc }, tokensValidAfterTime: undefined });
  return { uid, token };
}
const admin = (t: string, uid = `u-admin-${t}`) => actor(uid, { t: { [t]: 'admin' } });
const oper = (t: string, uid = `u-oper-${t}`) => actor(uid, { t: { [t]: 'oper' } });
const soporte = (uid = 'u-soporte') => actor(uid, { t: {}, p: true }, { proveedor: 'google.com' });

const llamar = (data: unknown, a?: Actor) =>
  (V.verComprobante as unknown as { run: (r: unknown) => Promise<unknown> })
    .run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} });

// ---------------------------------------------------------------------------
// SEMILLAS
// ---------------------------------------------------------------------------
const T = 'visor-tienda';
const OTRO = 'visor-otro';
const TELEFONO = 'TELEFONO-SECRETO-DEL-CLIENTE';
const NOMBRE = 'NOMBRE-SECRETO-DEL-CLIENTE';
const TODOS = [T, OTRO, 'visor-baja', 'visor-suspendido', 'visor-sin-modulo', 'visor-fantasma', 'visor-tope', 'visor-tope-b'];

const cotejoDe = (idMeta: unknown, enMs: number, calidad: unknown = 'valido') => ({
  resultado: 'cuadra', calidad, motivo: 'ok', diferencias: [], montoLeido: 100, montoDistinto: false,
  banco: 'BNB', idMeta, intentos: 1, en: Timestamp.fromMillis(enMs),
});
const MODULOS_VENTA = ['productos', 'pedidos', 'cobros'];

async function ficha(t: string, extra: Record<string, unknown> = {}) {
  const datos: Record<string, unknown> = { nombre: t, estado: 'activo', flujos: ['venta'], modulos: MODULOS_VENTA, ...extra };
  for (const k of Object.keys(datos)) if (datos[k] === undefined) delete datos[k];
  await db.doc(`tenants/${t}`).set(datos);
}

interface Escena { t: string; cierreId: string; idMeta: string; ruta: string }
/** Una venta con comprobante guardado hoy, el cierre con su cotejo y la ruta en privado/datos. */
async function escena(t = T, o: {
  cierreId?: string; idMeta?: string; ext?: C.ExtensionDeComprobante; bytes?: Buffer; contentType?: string;
  sinRutaGuardada?: boolean; tipo?: string; cotejo?: unknown; fichaExtra?: Record<string, unknown>; enMs?: number; diaDelObjetoMs?: number;
} = {}): Promise<Escena> {
  const cierreId = o.cierreId ?? 'venta_visor1';
  const idMeta = o.idMeta ?? `wamid.${t}.1`;
  const ext = o.ext ?? 'jpg';
  const enMs = o.enMs ?? Date.now();
  await ficha(t, o.fichaExtra);
  await db.doc(`tenants/${t}/cierres/${cierreId}`).set({
    tipo: o.tipo ?? 'venta', monto: 100, moneda: 'BOB', referencia: 'visor1',
    cotejo: o.cotejo !== undefined ? o.cotejo : cotejoDe(idMeta, enMs),
  });
  const ruta = C.rutaDeComprobante(t, diaDeLaPaz(o.diaDelObjetoMs ?? enMs), idMeta, ext);
  await db.doc(`tenants/${t}/cierres/${cierreId}/privado/datos`).set({
    telefono: TELEFONO, nombreCliente: NOMBRE, detalle: 'detalle privado', ...(o.sinRutaGuardada ? {} : { rutaComprobante: ruta }),
  });
  almacen.objetos.set(ruta, { bytes: o.bytes ?? JPG(), contentType: o.contentType ?? 'image/jpeg' });
  return { t, cierreId, idMeta, ruta };
}

const pedir = (e: Escena) => ({ tenantId: e.t, cierreId: e.cierreId });

async function contarBajo(ref: FirebaseFirestore.DocumentReference): Promise<string[]> {
  const ruta: string[] = [];
  const visitar = async (r: FirebaseFirestore.DocumentReference) => {
    if ((await r.get()).exists) ruta.push(r.path);
    for (const col of await r.listCollections()) {
      for (const d of await col.listDocuments()) await visitar(d);
    }
  };
  await visitar(ref);
  return ruta.sort();
}
const documentosDe = (t: string) => contarBajo(db.doc(`tenants/${t}`));
const topes = async () => (await db.collection('topesDelVisor').get()).docs.map((d) => d.id).sort();
const auditoria = async (t: string) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());

const FIJOS = {
  sinSesion: 'Inicie sesión.',
  invalido: 'Solicitud inválida.',
  sinPermiso: 'Sin permiso para ver este comprobante.',
  noElegible: 'Este cobro no tiene un comprobante que se pueda mostrar.',
  noHay: 'No hay un comprobante guardado para este cobro.',
  tope: 'Alcanzó el tope de comprobantes por hora o por día.',
  noDisponible: 'No se pudo abrir el comprobante. Intente más tarde.',
};
const falla = (code: string, message: string) => ({ code, message });

let salida: string[] = [];
beforeAll(async () => {
  await db.doc('tenants/visor-sonda').get();
}, 60_000);
beforeEach(async () => {
  for (const t of [...TODOS, 'visor-sonda']) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('topesDelVisor').listDocuments()) await d.delete();
  almacen = new AlmacenDoble();
  C.fijarAlmacenDeComprobantesDePrueba(almacen);
  cuentas.clear();
  h.auditar = null;
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
describe('el camino feliz: administrador, operador y soporte vigente', () => {
  it('el administrador ve la imagen: {mime, base64} exactos y UN asiento «admin»', async () => {
    const e = await escena();
    const r = await llamar(pedir(e), admin(T));
    expect(r).toEqual({ mime: 'image/jpeg', base64: JPG().toString('base64') });
    const a = await auditoria(T);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ accion: 'comprobante_visto', uid: `u-admin-${T}`, rol: 'admin', cierreId: e.cierreId, resultado: 'ok' });
    expect((await topes())).toEqual([`u-admin-${T}`]);
  });
  it('el operador ve la imagen y queda como «oper»', async () => {
    const e = await escena();
    expect(await llamar(pedir(e), oper(T))).toMatchObject({ mime: 'image/jpeg' });
    expect((await auditoria(T))[0]).toMatchObject({ rol: 'oper', resultado: 'ok' });
  });
  it('un comercio SUSPENDIDO sí puede ver (decisión 2)', async () => {
    const e = await escena('visor-suspendido', { fichaExtra: { estado: 'suspendido' } });
    expect(await llamar(pedir(e), admin(e.t))).toMatchObject({ mime: 'image/jpeg' });
  });
  it('cada tipo sale con su mime por los bytes: jpg, png, webp y pdf', async () => {
    const casos: Array<[C.ExtensionDeComprobante, Buffer, string]> = [
      ['jpg', JPG(), 'image/jpeg'], ['png', PNG(), 'image/png'], ['webp', WEBP(), 'image/webp'], ['pdf', PDF(), 'application/pdf'],
    ];
    for (const [i, [ext, bytes, mime]] of casos.entries()) {
      const e = await escena(T, { cierreId: `venta_tipo${i}`, idMeta: `wamid.tipo${i}`, ext, bytes });
      const r = await llamar(pedir(e), admin(T)) as { mime: string; base64: string };
      expect(r.mime).toBe(mime);
      expect(Buffer.from(r.base64, 'base64').equals(bytes)).toBe(true);
    }
  });
  it('la ruta guardada en el cierre se usa DIRECTO: un solo getMetadata y una descarga, de esa ruta', async () => {
    const e = await escena();
    await llamar(pedir(e), admin(T));
    expect(almacen.metadatosRutas).toEqual([e.ruta]);
    expect(almacen.leerRutas).toEqual([e.ruta]);
  });
  it('sin ruta guardada se DERIVA del idMeta: el día del cotejo y el anterior, en las cuatro extensiones (máx. 8)', async () => {
    // Reloj fijo (solo `Date`): 10:30 en La Paz, lejos de la medianoche, así «ayer» no depende de la hora de la corrida.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 9, 14, 30));
    const ayerMs = Date.now() - 86_400_000;
    const e = await escena(T, { sinRutaGuardada: true, ext: 'webp', bytes: WEBP(), diaDelObjetoMs: ayerMs });
    const r = await llamar(pedir(e), admin(T)) as { mime: string };
    expect(r.mime).toBe('image/webp');
    expect(almacen.metadatosRutas.length).toBeLessThanOrEqual(8);
    expect(almacen.metadatosRutas).toContain(e.ruta);
    for (const ruta of almacen.metadatosRutas) expect(C.rutaValidaDe(ruta, T, e.idMeta)).toBe(ruta);
  });
  it('sin ruta guardada y sin objeto: probó las 8 candidatas y responde not-found', async () => {
    const e = await escena(T, { sinRutaGuardada: true });
    almacen.objetos.clear();
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
    expect(almacen.metadatosRutas).toHaveLength(8);
    expect(almacen.leerRutas).toHaveLength(0);
  });
  it('si el cotejo no trae `en` como instante, no se deriva nada: not-found sin tocar el almacén', async () => {
    const e = await escena(T, { sinRutaGuardada: true, cotejo: { ...cotejoDe('wamid.x', Date.now()), en: 'ayer' } });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
  });
  it('el servidor ignora cualquier otra clave de la entrada (una `ruta` del cliente no llega al almacén)', async () => {
    const e = await escena();
    const intrusa = C.rutaDeComprobante(OTRO, diaDeLaPaz(Date.now()), 'wamid.ajeno', 'jpg');
    almacen.objetos.set(intrusa, { bytes: PNG(), contentType: 'image/png' });
    const r = await llamar({ ...pedir(e), ruta: intrusa, path: intrusa, rutaComprobante: intrusa }, admin(T)) as { mime: string };
    expect(r.mime).toBe('image/jpeg');
    expect(almacen.metadatosRutas).not.toContain(intrusa);
    expect(almacen.leerRutas).not.toContain(intrusa);
  });
});

// ===========================================================================
describe('T1: sin sesión', () => {
  it('unauthenticated, mensaje fijo, y no se toca el almacén ni Firestore', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    await expect(llamar(pedir(e), undefined)).rejects.toMatchObject(falla('unauthenticated', FIJOS.sinSesion));
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
});

// ===========================================================================
describe('T2 y T3: el rol vale para ESE comercio, nunca para «el primero del token»', () => {
  // QUÉ PRUEBA CUBRE EL PASO 3 AISLADO. `cuentaVigenteDe` (paso 4) vuelve a exigir `nc.t[comercio] === rol`,
  // así que la mutación «autorizar contra el primer comercio del token» (o contra cualquiera) NO se ve en las
  // dos pruebas de abajo: el paso 4 la tapa. Solo muere en «roles en A y en B a la vez» y en el tope global de
  // T18 (el mismo uid con dos comercios). La defensa en profundidad es a propósito; estas pruebas fijan el
  // resultado, no cuál de las dos capas lo produjo.
  for (const [nombre, hacer] of [['administrador', admin], ['operador', oper]] as const) {
    it(`el ${nombre} de A pide el comprobante de B (el cierre existe): permission-denied, sin almacén y sin escribir en B`, async () => {
      const e = await escena(OTRO);
      const antes = await documentosDe(OTRO);
      const deA = hacer(T, `u-${nombre}-de-a`);
      await expect(llamar(pedir(e), deA)).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
      expect(almacen.llamadas).toBe(0);
      expect(await documentosDe(OTRO)).toEqual(antes);
      expect(await topes()).toEqual([]);
    });
  }
  it('con roles en A y en B a la vez, solo vale el comercio que se pide', async () => {
    const e = await escena(OTRO);
    const dos = actor('u-doble', { t: { [T]: 'admin', [OTRO]: 'oper' } });
    // En OTRO es operador: pasa. En un tercero donde no tiene nada, no.
    expect(await llamar(pedir(e), dos)).toMatchObject({ mime: 'image/jpeg' });
    const e2 = await escena('visor-sin-modulo');
    await expect(llamar(pedir(e2), dos)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('T4, T5 y T6: el vínculo rol - proveedor - correo, y la ingesta', () => {
  it('T4: administrador y operador con sesión de Google: denegado, sin escribir', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    for (const [i, rol] of (['admin', 'oper'] as const).entries()) {
      const g = actor(`u-google-${i}`, { t: { [T]: rol } }, { proveedor: 'google.com' });
      await expect(llamar(pedir(e), g)).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
  });
  it('T5: correo sin verificar: denegado, sin escribir', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    for (const [i, rol] of (['admin', 'oper'] as const).entries()) {
      const sinVerificar = actor(`u-sin-verificar-${i}`, { t: { [T]: rol } }, { verificado: false });
      await expect(llamar(pedir(e), sinVerificar)).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
  });
  it('T6: la cuenta de la ingesta (rol `ingesta`, token personalizado o contraseña) no pasa', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    for (const [i, proveedor] of (['custom', 'password'] as const).entries()) {
      const ingesta = actor(`svc-ingesta-${i}`, { t: { [T]: 'ingesta' } }, { proveedor });
      await expect(llamar(pedir(e), ingesta)).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
  it('una sesión sin claims de NovuChat tampoco', async () => {
    const e = await escena();
    await expect(llamar(pedir(e), actor('u-huerfano', {}))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('T7: el propietario solo pasa con una ventana de soporte VIGENTE en ese comercio', () => {
  const ventana = (t: string, uid: string, datos: Record<string, unknown>) => db.doc(`tenants/${t}/accesosSoporte/${uid}`).set(datos);
  const enUnaHora = () => Timestamp.fromMillis(Date.now() + 3_600_000);

  it('sin ventana, vencida, sin `expira`, con `expira` que no es instante, de OTRO comercio, o con sesión de contraseña: todo denegado y sin una sola escritura', async () => {
    const e = await escena();
    await escena(OTRO);
    await ventana(T, 'u-vencido', { expira: Timestamp.fromMillis(Date.now() - 1000) });
    await ventana(T, 'u-sin-expira', { otorgadoPor: 'x' });
    await ventana(T, 'u-expira-numero', { expira: Date.now() + 3_600_000 });
    await ventana(T, 'u-expira-cadena', { expira: '2999-01-01T00:00:00Z' });
    await ventana(OTRO, 'u-de-otro', { expira: enUnaHora() });
    const casos: Array<[string, Actor]> = [
      ['sin ventana', soporte('u-sin-ventana')],
      ['vencida', soporte('u-vencido')],
      ['sin expira', soporte('u-sin-expira')],
      ['expira numérico', soporte('u-expira-numero')],
      ['expira cadena', soporte('u-expira-cadena')],
      ['ventana de otro comercio', soporte('u-de-otro')],
    ];
    await ventana(T, 'u-pass', { expira: enUnaHora() });
    casos.push(['sesión de contraseña con claim p', actor('u-pass', { t: {}, p: true }, { proveedor: 'password' })]);
    const antes = await documentosDe(T);
    for (const [nombre, quien] of casos) {
      await expect(llamar(pedir(e), quien), nombre).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
  it('con ventana vigente en ese comercio: pasa y se audita como «soporte»', async () => {
    const e = await escena();
    await ventana(T, 'u-soporte', { expira: enUnaHora() });
    expect(await llamar(pedir(e), soporte())).toMatchObject({ mime: 'image/jpeg' });
    const a = await auditoria(T);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ rol: 'soporte', uid: 'u-soporte', resultado: 'ok', accion: 'comprobante_visto' });
  });
  it('la ventana REVOCADA (documento borrado) se niega de inmediato', async () => {
    const e = await escena();
    await ventana(T, 'u-soporte', { expira: enUnaHora() });
    expect(await llamar(pedir(e), soporte())).toMatchObject({ mime: 'image/jpeg' });
    await db.doc(`tenants/${T}/accesosSoporte/u-soporte`).delete();
    const antes = await documentosDe(T);
    await expect(llamar(pedir(e), soporte())).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect(await documentosDe(T)).toEqual(antes);
  });
  it('el soporte con la cuenta ya sin el claim de propietario (según Auth) no pasa aunque su ventana siga vigente', async () => {
    const e = await escena();
    await ventana(T, 'u-soporte', { expira: enUnaHora() });
    const s = soporte();
    cuentas.set('u-soporte', { disabled: false, customClaims: { nc: { t: {} } }, tokensValidAfterTime: undefined });
    await expect(llamar(pedir(e), s)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('T8: el estado del comercio', () => {
  it('dado de baja: denegado, y no se escribe NADA bajo ese comercio', async () => {
    const e = await escena('visor-baja', { fichaExtra: { estado: 'dado_de_baja' } });
    const antes = await documentosDe(e.t);
    await expect(llamar(pedir(e), admin(e.t))).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect(await documentosDe(e.t)).toEqual(antes);
    expect(almacen.llamadas).toBe(0);
    expect(await topes()).toEqual([]);
  });
  it('inexistente: denegado y no nace ningún documento bajo ese id', async () => {
    const t = 'visor-fantasma';
    await expect(llamar({ tenantId: t, cierreId: 'venta_x' }, admin(t))).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect(await documentosDe(t)).toEqual([]);
    expect(await topes()).toEqual([]);
  });
  it('un estado raro o ausente tampoco abre', async () => {
    for (const [i, estado] of ([undefined, 'pendiente', 'ACTIVO', null] as const).entries()) {
      const e = await escena('visor-baja', { fichaExtra: { estado } });
      if (estado === undefined) await db.doc(`tenants/${e.t}`).update({ estado: FieldValue.delete() });
      await expect(llamar(pedir(e), admin(e.t)), `caso ${i}`).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(almacen.llamadas).toBe(0);
  });
});

// ===========================================================================
describe('T9: sin el módulo de cobros', () => {
  it('permission-denied, con asiento «rechazado / sin_modulo» (quien llama sí tiene rol) y sin tocar el tope ni el almacén', async () => {
    const e = await escena('visor-sin-modulo', { fichaExtra: { modulos: ['productos', 'pedidos'], flujos: ['agendamiento'] } });
    await expect(llamar(pedir(e), admin(e.t))).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    const a = await auditoria(e.t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ accion: 'comprobante_visto', resultado: 'rechazado', motivo: 'sin_modulo', rol: 'admin' });
    expect(almacen.llamadas).toBe(0);
    expect(await topes()).toEqual([]);
  });
  it('una lista de módulos vacía tampoco abre', async () => {
    const e = await escena('visor-sin-modulo', { fichaExtra: { modulos: [] } });
    await expect(llamar(pedir(e), oper(e.t))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(almacen.llamadas).toBe(0);
  });
});

// ===========================================================================
describe('T10: la forma de la entrada', () => {
  const buenoT = T;
  it('tenantId inválido: invalid-argument y NADA se toca', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    const malos: unknown[] = ['a/b', '..', '', 'x'.repeat(61), 42, null, undefined, ['visor-tienda'], { a: 1 }, '__proto__', 'A-Mayuscula', '-empieza', 'ab', 'con espacio', 'tenants/x'];
    for (const tenantId of malos) {
      await expect(llamar({ tenantId, cierreId: e.cierreId }, admin(buenoT)), JSON.stringify(tenantId)).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
  });
  it('cierreId inválido (ruta, otro tipo de cierre, demasiado largo, no cadena): invalid-argument', async () => {
    await escena();
    const antes = await documentosDe(T);
    const malos: unknown[] = ['venta_x/privado/datos', 'cita_x', 'venta_', 'venta', '', `venta_${'a'.repeat(121)}`, 'venta_con espacio', 'venta_a.b', 42, null, undefined, { id: 1 }, 'venta_../x'];
    for (const cierreId of malos) {
      await expect(llamar({ tenantId: T, cierreId }, admin(T)), JSON.stringify(cierreId)).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    }
    expect(almacen.llamadas).toBe(0);
    expect(await documentosDe(T)).toEqual(antes);
  });
  it('un cierreId de 126 caracteres (venta_ y 120) es el máximo y se acepta (llega a «no hay comprobante»)', async () => {
    await escena();
    await expect(llamar({ tenantId: T, cierreId: `venta_${'a'.repeat(120)}` }, admin(T))).rejects.toMatchObject({ code: 'not-found' });
  });
  it('sin datos, con datos que no son un objeto, o con una lista: invalid-argument', async () => {
    for (const data of [undefined, null, 'texto', 7, ['x'], true]) {
      await expect(llamar(data, admin(T))).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    }
  });
});

// ===========================================================================
describe('T11: solo una venta con cotejo válido o aproximado', () => {
  const sinBytes = async (e: Escena, codigo = 'failed-precondition') => {
    await expect(llamar(pedir(e), admin(e.t))).rejects.toMatchObject(falla(codigo, codigo === 'failed-precondition' ? FIJOS.noElegible : FIJOS.noHay));
    expect(almacen.llamadas).toBe(0);
  };
  it('un cierre de cita o de registro con cotejo (aunque el id empiece con venta_)', async () => {
    for (const [i, tipo] of (['cita', 'registro', 'pedido', undefined] as const).entries()) {
      const e = await escena(T, { cierreId: `venta_t${i}`, tipo: tipo as string });
      if (tipo === undefined) await db.doc(`tenants/${T}/cierres/${e.cierreId}`).update({ tipo: FieldValue.delete() });
      await sinBytes(e);
    }
  });
  it('una venta sin cotejo, con cotejo que no es mapa, o sin calidad', async () => {
    const sin = await escena(T, { cierreId: 'venta_a' });
    await db.doc(`tenants/${T}/cierres/venta_a`).update({ cotejo: FieldValue.delete() });
    await sinBytes(sin);
    for (const [i, cotejo] of ([['lista'], 'texto', 5, null] as unknown[]).entries()) {
      await sinBytes(await escena(T, { cierreId: `venta_b${i}`, cotejo }));
    }
    const { calidad: _c, ...sinCalidad } = cotejoDe('wamid.sc', Date.now());
    await sinBytes(await escena(T, { cierreId: 'venta_c', idMeta: 'wamid.sc', cotejo: sinCalidad }));
  });
  it('calidad que no es válido ni aproximado (invalido, no_es_comprobante, vacío, mayúsculas, lista)', async () => {
    for (const [i, calidad] of (['invalido', 'no_es_comprobante', '', 'VALIDO', ['valido'], 1, null] as unknown[]).entries()) {
      await sinBytes(await escena(T, { cierreId: `venta_q${i}`, idMeta: `wamid.q${i}`, cotejo: cotejoDe(`wamid.q${i}`, Date.now(), calidad) }));
    }
  });
  it('aproximado SÍ se muestra', async () => {
    const e = await escena(T, { cierreId: 'venta_ap', idMeta: 'wamid.ap', cotejo: cotejoDe('wamid.ap', Date.now(), 'aproximado') });
    expect(await llamar(pedir(e), admin(T))).toMatchObject({ mime: 'image/jpeg' });
  });
  it('un idMeta que no es cadena o está vacío: sin bytes', async () => {
    for (const [i, idMeta] of ([7, '', '   ', null, { a: 1 }] as unknown[]).entries()) {
      await sinBytes(await escena(T, { cierreId: `venta_i${i}`, idMeta: 'wamid.base', cotejo: cotejoDe(idMeta, Date.now()) }));
    }
  });
  it('un cierre que no existe: not-found', async () => {
    await escena();
    await expect(llamar({ tenantId: T, cierreId: 'venta_no_existe' }, admin(T))).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
    expect(almacen.llamadas).toBe(0);
  });
  it('todo rechazo de esta lista queda auditado como «rechazado» con su motivo, con rol válido', async () => {
    await escena(T, { cierreId: 'venta_r1', tipo: 'cita' });
    await expect(llamar({ tenantId: T, cierreId: 'venta_r1' }, oper(T))).rejects.toBeTruthy();
    await expect(llamar({ tenantId: T, cierreId: 'venta_r2' }, oper(T))).rejects.toBeTruthy();
    const a = await auditoria(T);
    expect(a.map((x) => [x['motivo'], x['resultado'], x['rol']]).sort()).toEqual([
      ['no_elegible', 'rechazado', 'oper'], ['sin_comprobante', 'rechazado', 'oper'],
    ]);
  });
});

// ===========================================================================
describe('T12: una ruta que no es de ESTE comercio y ESTE mensaje no llega al almacén', () => {
  const malas = (idMeta: string): Array<[string, string]> => [
    ['de otro comercio', C.rutaDeComprobante(OTRO, diaDeLaPaz(Date.now()), idMeta, 'jpg')],
    ['de otro mensaje', C.rutaDeComprobante(T, diaDeLaPaz(Date.now()), 'wamid.otro-mensaje', 'jpg')],
    ['con «..»', `tenants/${T}/comprobantes/../../${OTRO}/comprobantes/${diaDeLaPaz(Date.now())}/${C.nombreDeObjeto(idMeta)}.jpg`],
    ['sin extensión permitida', `tenants/${T}/comprobantes/${diaDeLaPaz(Date.now())}/${C.nombreDeObjeto(idMeta)}.html`],
    ['absoluta de otro bucket', `gs://otro/${C.nombreDeObjeto(idMeta)}.jpg`],
    ['no es cadena', 12345 as unknown as string],
  ];
  it('cada ruta guardada indebida se IGNORA: el almacén no la recibe nunca y se usa la derivada del idMeta', async () => {
    for (const [i, [nombre, mala]] of malas('wamid.base').entries()) {
      almacen = new AlmacenDoble();
      C.fijarAlmacenDeComprobantesDePrueba(almacen);
      const e = await escena(T, { cierreId: `venta_m${i}`, idMeta: 'wamid.base', ext: 'png', bytes: PNG() });
      // El objeto indebido EXISTE y es de otro tipo: si alguien lo lee, se nota.
      if (typeof mala === 'string') almacen.objetos.set(mala, { bytes: WEBP(), contentType: 'image/webp' });
      await db.doc(`tenants/${T}/cierres/${e.cierreId}/privado/datos`).update({ rutaComprobante: mala });
      const r = await llamar(pedir(e), admin(T)) as { mime: string };
      expect(r.mime, nombre).toBe('image/png');
      expect(almacen.metadatosRutas, nombre).not.toContain(mala);
      expect(almacen.leerRutas, nombre).not.toContain(mala);
      for (const ruta of [...almacen.metadatosRutas, ...almacen.leerRutas]) {
        expect(ruta.startsWith(`tenants/${T}/comprobantes/`), nombre).toBe(true);
        expect(ruta, nombre).not.toContain('..');
      }
    }
  });
  it('la ruta de OTRO comercio guardada en el cierre y SIN objeto propio: not-found, y el objeto ajeno no se tocó', async () => {
    const ajena = C.rutaDeComprobante(OTRO, diaDeLaPaz(Date.now()), 'wamid.base', 'jpg');
    const e = await escena(T, { idMeta: 'wamid.base' });
    almacen.objetos.clear();
    almacen.objetos.set(ajena, { bytes: JPG(), contentType: 'image/jpeg' });
    await db.doc(`tenants/${T}/cierres/${e.cierreId}/privado/datos`).update({ rutaComprobante: ajena });
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.metadatosRutas).not.toContain(ajena);
    expect(almacen.leerRutas).toEqual([]);
  });
});

// ===========================================================================
describe('T13: el tipo se decide por los bytes y debe coincidir con la extensión', () => {
  const sinBytes = async (e: Escena) => {
    await expect(llamar(pedir(e), admin(e.t))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
  };
  it('un .jpg que trae SVG o HTML (con contentType que miente): sin bytes, y la vista rechazada queda auditada', async () => {
    for (const [i, cuerpo] of (['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<html><script>alert(1)</script></html>', 'texto plano'] as const).entries()) {
      const e = await escena(T, { cierreId: `venta_h${i}`, idMeta: `wamid.h${i}`, bytes: Buffer.from(cuerpo), contentType: 'image/jpeg' });
      await sinBytes(e);
    }
    const a = await auditoria(T);
    expect(a).toHaveLength(3);
    expect(a.every((x) => x['motivo'] === 'tipo_no_coincide' && x['resultado'] === 'rechazado')).toBe(true);
  });
  it('bytes de un tipo con la extensión de otro (png en .jpg, pdf en .png, jpg en .pdf): sin bytes', async () => {
    const casos: Array<[C.ExtensionDeComprobante, Buffer]> = [['jpg', PNG()], ['png', PDF()], ['pdf', JPG()], ['webp', JPG()]];
    for (const [i, [ext, bytes]] of casos.entries()) {
      await sinBytes(await escena(T, { cierreId: `venta_x${i}`, idMeta: `wamid.x${i}`, ext, bytes }));
    }
  });
  it('un contentType «seguro» guardado no salva a unos bytes que no son lo que dicen', async () => {
    const e = await escena(T, { bytes: Buffer.from('MZ-ejecutable'), contentType: 'application/pdf', ext: 'pdf' });
    await sinBytes(e);
  });
});

// ===========================================================================
describe('T14: lo que no está', () => {
  it('objeto purgado (no existe): not-found con texto fijo, sin la ruta en el mensaje, y sin descargar', async () => {
    const e = await escena();
    almacen.objetos.clear();
    const error = await llamar(pedir(e), admin(T)).catch((x) => x) as { code: string; message: string };
    expect(error.code).toBe('not-found');
    expect(error.message).toBe(FIJOS.noHay);
    expect(error.message).not.toContain('tenants/');
    expect(almacen.leerRutas).toEqual([]);
    expect((await auditoria(T))[0]).toMatchObject({ resultado: 'rechazado', motivo: 'sin_comprobante' });
  });
  it('existe en getMetadata pero la descarga da 404: not-found', async () => {
    const e = await escena();
    const original = almacen.leer.bind(almacen);
    almacen.leer = async (ruta: string) => { await original(ruta); return null; };
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
    expect(almacen.leerRutas).toEqual([e.ruta]);
  });
});

// ===========================================================================
describe('T15: lo demasiado grande no se descarga', () => {
  it('un PDF de más de 10 MB y una imagen de más de 5 MB: failed-precondition sin leer el objeto', async () => {
    const pdf = await escena(T, { cierreId: 'venta_g1', idMeta: 'wamid.g1', ext: 'pdf', bytes: PDF() });
    almacen.tamanoFalso.set(pdf.ruta, C.MAXIMO_PDF + 1);
    await expect(llamar(pedir(pdf), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
    const img = await escena(T, { cierreId: 'venta_g2', idMeta: 'wamid.g2', ext: 'jpg', bytes: JPG() });
    almacen.tamanoFalso.set(img.ruta, C.MAXIMO_IMAGEN + 1);
    await expect(llamar(pedir(img), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
    expect(almacen.leerRutas).toEqual([]);
    const a = await auditoria(T);
    expect(a.map((x) => x['motivo'])).toEqual(['demasiado_grande', 'demasiado_grande']);
  });
  it('el tope del PDF (10 MB) es mayor que el de una imagen: un PDF de 6 MB pasa el tamaño, una imagen de 6 MB no', async () => {
    const pdf = await escena(T, { cierreId: 'venta_g3', idMeta: 'wamid.g3', ext: 'pdf', bytes: PDF() });
    almacen.tamanoFalso.set(pdf.ruta, 6 * C.MB);
    expect(await llamar(pedir(pdf), admin(T))).toMatchObject({ mime: 'application/pdf' });
    const img = await escena(T, { cierreId: 'venta_g4', idMeta: 'wamid.g4', ext: 'jpg', bytes: JPG() });
    almacen.tamanoFalso.set(img.ruta, 6 * C.MB);
    await expect(llamar(pedir(img), admin(T))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('si getMetadata dice poco pero los bytes que llegan son más que el tope, también se rechaza', async () => {
    const e = await escena(T, { bytes: Buffer.concat([JPG(), Buffer.alloc(C.MAXIMO_IMAGEN + 10)]) });
    almacen.tamanoFalso.set(e.ruta, 100);
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
  });
  it('un tamaño ilegible (infinito) se rechaza', async () => {
    const e = await escena();
    almacen.tamanoFalso.set(e.ruta, Number.POSITIVE_INFINITY);
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(almacen.leerRutas).toEqual([]);
  });
});

// ===========================================================================
describe('T16: lo que queda escrito', () => {
  it('una vista correcta deja EXACTAMENTE un asiento con las claves {accion, uid, rol, cierreId, resultado, en}', async () => {
    const e = await escena();
    await llamar(pedir(e), admin(T));
    const a = await auditoria(T);
    expect(a).toHaveLength(1);
    expect(Object.keys(a[0]!).sort()).toEqual(['accion', 'cierreId', 'en', 'resultado', 'rol', 'uid']);
    expect(a[0]!['en']).toBeInstanceOf(Timestamp);
    const crudo = JSON.stringify(a);
    for (const prohibido of [TELEFONO, NOMBRE, e.ruta, e.idMeta, C.nombreDeObjeto(e.idMeta), JPG().toString('base64'), 'tenants/']) {
      expect(crudo).not.toContain(prohibido);
    }
  });
  it('un rechazo con rol válido deja un asiento «rechazado» con las claves {accion, uid, rol, cierreId, resultado, motivo, en}', async () => {
    await escena();
    await llamar({ tenantId: T, cierreId: 'venta_no_existe' }, oper(T)).catch(() => undefined);
    const a = await auditoria(T);
    expect(a).toHaveLength(1);
    expect(Object.keys(a[0]!).sort()).toEqual(['accion', 'cierreId', 'en', 'motivo', 'resultado', 'rol', 'uid']);
    expect(a[0]).toMatchObject({ accion: 'comprobante_visto', rol: 'oper', resultado: 'rechazado', motivo: 'sin_comprobante', cierreId: 'venta_no_existe' });
  });
  it('un rechazo SIN rol válido deja CERO documentos nuevos bajo el comercio y ninguno en topesDelVisor', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    const intrusos: Actor[] = [
      admin(OTRO, 'u-otro-admin'),
      actor('u-google', { t: { [T]: 'admin' } }, { proveedor: 'google.com' }),
      actor('u-sin-correo', { t: { [T]: 'oper' } }, { verificado: false }),
      actor('svc-ingesta', { t: { [T]: 'ingesta' } }, { proveedor: 'custom' }),
      soporte('u-sin-ventana'),
    ];
    for (const quien of intrusos) await expect(llamar(pedir(e), quien)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(llamar({ tenantId: T, cierreId: 'cita_x' }, intrusos[0])).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(llamar(pedir(e), undefined)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await documentosDe(T)).toEqual(antes);
    expect(await auditoria(T)).toEqual([]);
    expect(await topes()).toEqual([]);
    expect(almacen.llamadas).toBe(0);
  });
  it('el rechazo sin rol deja UNA línea de log con código y uid, sin comercio, cierre, ruta ni hash', async () => {
    const e = await escena();
    await llamar(pedir(e), admin(OTRO, 'u-otro-admin')).catch(() => undefined);
    const lineas = salida.filter((l) => l.includes('verComprobante'));
    expect(lineas).toHaveLength(1);
    const o = JSON.parse(lineas[0]!) as Record<string, unknown>;
    expect(o).toMatchObject({ funcion: 'verComprobante', codigo: 'permission-denied', uid: 'u-otro-admin' });
    for (const prohibido of [T, e.cierreId, e.ruta, e.idMeta, 'tenants/']) expect(lineas[0]).not.toContain(prohibido);
  });
});

// ===========================================================================
describe('T17: si la auditoría falla, no sale ningún byte (fail-closed)', () => {
  it('la vista correcta con la auditoría caída: unavailable, mensaje fijo, y el cliente no recibe nada', async () => {
    const e = await escena();
    h.auditar = async () => { throw Object.assign(new Error(`caída en tenants/${T}/auditoria`), { code: 14 }); };
    const error = await llamar(pedir(e), admin(T)).catch((x) => x) as { code: string; message: string };
    expect(error.code).toBe('unavailable');
    expect(error.message).toBe(FIJOS.noDisponible);
    expect(JSON.stringify(error)).not.toContain('base64');
    expect(await auditoria(T)).toEqual([]);
  });
  it('un rechazo cuya auditoría falla responde unavailable, no el rechazo (no se calla lo que no se pudo anotar)', async () => {
    const e = await escena();
    h.auditar = async () => { throw new Error('caída'); };
    await expect(llamar({ tenantId: T, cierreId: 'venta_no_existe' }, admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('la auditoría se escribe ANTES de devolver los bytes y con las claves exactas, sin pasar por la bitácora', async () => {
    const e = await escena();
    const llamadas: unknown[][] = [];
    h.auditar = async (...a: unknown[]) => { llamadas.push(a); return h.auditarOriginal!(...a); };
    await llamar(pedir(e), admin(T));
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toEqual([T, 'comprobante_visto', `u-admin-${T}`, { rol: 'admin', cierreId: e.cierreId, resultado: 'ok' }]);
    expect((await db.collection(`tenants/${T}/bitacora`).get()).size).toBe(0);
    expect(CODIGO).not.toMatch(/\bregistrar\s*\(/);
    expect(CODIGO).not.toMatch(/bitacora/i);
  });
});

// ===========================================================================
describe('T18: el tope por usuario, contado en el servidor', () => {
  // Reloj fijo (solo `Date`): 10:30 en La Paz del 9, lejos de hh:59 y de la medianoche. Ninguna prueba de acá
  // depende del reloj real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 9, 14, 30));
  });
  const dia = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
  const hora = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 13);

  it('la vista 31 dentro de la hora: resource-exhausted (auditada «tope»); otro usuario sigue pudiendo; la rechazada no suma', async () => {
    const e = await escena();
    const a = admin(T);
    for (let i = 0; i < V.TOPE_POR_HORA; i++) await llamar(pedir(e), a);
    const tope = (await db.doc(`topesDelVisor/${a.uid}`).get()).data()!;
    expect(tope['vistasHora']).toBe(30);
    const error = await llamar(pedir(e), a).catch((x) => x) as { code: string; message: string };
    expect(error).toMatchObject(falla('resource-exhausted', FIJOS.tope));
    expect((await db.doc(`topesDelVisor/${a.uid}`).get()).data()).toEqual(tope);
    const asientos = await auditoria(T);
    expect(asientos.filter((x) => x['resultado'] === 'ok')).toHaveLength(30);
    expect(asientos.filter((x) => x['motivo'] === 'tope')).toHaveLength(1);
    // Otro usuario del mismo comercio no se ve afectado.
    expect(await llamar(pedir(e), oper(T))).toMatchObject({ mime: 'image/jpeg' });
  }, 120_000);

  describe('el tope cuenta TODO intento autorizado que pasó el módulo, antes de mirar el cierre y el almacén', () => {
    const sembrarCupo = (uid: string, vistasHora = 29) =>
      db.doc(`topesDelVisor/${uid}`).set({ hora: hora(), vistasHora, dia: dia(), vistasDia: vistasHora, actualizadoEn: Timestamp.now() });
    const vistasHora = async (uid: string) => (await db.doc(`topesDelVisor/${uid}`).get()).get('vistasHora');

    it('(a) un cierre inexistente (not-found) igual consume el cupo; (b) con el cupo agotado, un pedido válido es resource-exhausted y no toca el almacén', async () => {
      const e = await escena();
      const a = admin(T);
      await sembrarCupo(a.uid);
      await expect(llamar({ tenantId: T, cierreId: 'venta_no_existe' }, a)).rejects.toMatchObject(falla('not-found', FIJOS.noHay));
      expect(await vistasHora(a.uid)).toBe(30);
      await expect(llamar(pedir(e), a)).rejects.toMatchObject(falla('resource-exhausted', FIJOS.tope));
      expect(almacen.llamadas).toBe(0);
      expect(await vistasHora(a.uid)).toBe(30);
    });
    it('(c) un cierre no elegible (failed-precondition) también consume el cupo, y el siguiente pedido ya no pasa', async () => {
      const cita = await escena(T, { cierreId: 'venta_cita', idMeta: 'wamid.cita', tipo: 'cita' });
      const buena = await escena(T, { cierreId: 'venta_buena', idMeta: 'wamid.buena' });
      const a = oper(T);
      await sembrarCupo(a.uid);
      await expect(llamar(pedir(cita), a)).rejects.toMatchObject(falla('failed-precondition', FIJOS.noElegible));
      expect(await vistasHora(a.uid)).toBe(30);
      await expect(llamar(pedir(buena), a)).rejects.toMatchObject({ code: 'resource-exhausted' });
    });
    it('el que falla DESPUÉS de hallar el objeto (tipo que no coincide) también consume el cupo', async () => {
      const e = await escena(T, { bytes: Buffer.from('<html/>') });
      const a = admin(T);
      await sembrarCupo(a.uid, 28);
      await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(await vistasHora(a.uid)).toBe(29);
    });
  });

  it('la vista 101 del día, con la hora renovada: resource-exhausted; la 100 todavía pasa', async () => {
    const e = await escena();
    const a = admin(T);
    await db.doc(`topesDelVisor/${a.uid}`).set({ hora: '1999-01-01T00', vistasHora: 7, dia: dia(), vistasDia: 99, actualizadoEn: Timestamp.now() });
    expect(await llamar(pedir(e), a)).toMatchObject({ mime: 'image/jpeg' });
    expect((await db.doc(`topesDelVisor/${a.uid}`).get()).data()).toMatchObject({ hora: hora(), vistasHora: 1, dia: dia(), vistasDia: 100 });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject(falla('resource-exhausted', FIJOS.tope));
    expect((await db.doc(`topesDelVisor/${a.uid}`).get()).get('vistasDia')).toBe(100);
  });

  it('el tope es por usuario y global: el mismo uid agota su tope aunque cambie de comercio', async () => {
    const e1 = await escena(T);
    const e2 = await escena(OTRO);
    const dos = actor('u-dos-comercios', { t: { [T]: 'admin', [OTRO]: 'oper' } });
    await db.doc(`topesDelVisor/${dos.uid}`).set({ hora: hora(), vistasHora: 29, dia: dia(), vistasDia: 29, actualizadoEn: Timestamp.now() });
    expect(await llamar(pedir(e1), dos)).toMatchObject({ mime: 'image/jpeg' });
    await expect(llamar(pedir(e2), dos)).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('un contador ilegible o corrupto falla cerrado (agotado)', async () => {
    const e = await escena();
    const a = admin(T);
    for (const malo of [{ vistasHora: 'x' }, { vistasHora: -1 }, { vistasHora: 1.5 }, { vistasHora: null }] as Array<Record<string, unknown>>) {
      await db.doc(`topesDelVisor/${a.uid}`).set({ hora: hora(), vistasHora: 0, dia: dia(), vistasDia: 0, ...malo });
      await expect(llamar(pedir(e), a), JSON.stringify(malo)).rejects.toMatchObject({ code: 'resource-exhausted' });
    }
  });

  it('consumirCupoDelVisor: al cambiar la hora (La Paz) se renueva la hora y no el día; al cambiar el día se renuevan los dos', async () => {
    const uid = 'u-reloj';
    // 10:30 en La Paz del 9 (14:30 UTC).
    const t0 = Date.UTC(2026, 9, 9, 14, 30);
    for (let i = 0; i < 30; i++) expect(await V.consumirCupoDelVisor(uid, t0 + i)).toBe(true);
    expect(await V.consumirCupoDelVisor(uid, t0 + 31)).toBe(false);
    // 11:00 en La Paz: hora nueva, mismo día.
    const t1 = Date.UTC(2026, 9, 9, 15, 0);
    expect(await V.consumirCupoDelVisor(uid, t1)).toBe(true);
    expect((await db.doc(`topesDelVisor/${uid}`).get()).data()).toMatchObject({ hora: '2026-10-09T11', vistasHora: 1, dia: '2026-10-09', vistasDia: 31 });
    // 00:10 UTC del 10 es 20:10 del 9 en La Paz: SIGUE siendo el mismo día.
    expect(await V.consumirCupoDelVisor(uid, Date.UTC(2026, 9, 10, 0, 10))).toBe(true);
    expect((await db.doc(`topesDelVisor/${uid}`).get()).get('dia')).toBe('2026-10-09');
    // 04:00 UTC del 10 es 00:00 del 10 en La Paz: día nuevo.
    expect(await V.consumirCupoDelVisor(uid, Date.UTC(2026, 9, 10, 4, 0))).toBe(true);
    expect((await db.doc(`topesDelVisor/${uid}`).get()).data()).toMatchObject({ hora: '2026-10-10T00', vistasHora: 1, dia: '2026-10-10', vistasDia: 1 });
  });

  it('consumirCupoDelVisor: cien en el día, repartidas en horas distintas, cierran el día; si rechaza no escribe', async () => {
    const uid = 'u-dia';
    for (let h2 = 0; h2 < 10; h2++) {
      for (let i = 0; i < 10; i++) expect(await V.consumirCupoDelVisor(uid, Date.UTC(2026, 9, 9, 4 + h2, i))).toBe(true);
    }
    const antes = (await db.doc(`topesDelVisor/${uid}`).get()).data();
    expect(antes).toMatchObject({ vistasDia: 100, vistasHora: 10 });
    expect(await V.consumirCupoDelVisor(uid, Date.UTC(2026, 9, 9, 15, 0))).toBe(false);
    expect((await db.doc(`topesDelVisor/${uid}`).get()).data()).toEqual(antes);
  }, 120_000);

  it('dos pedidos simultáneos con un solo cupo: solo uno lo consigue (transacción)', async () => {
    const uid = 'u-carrera';
    const t0 = Date.UTC(2026, 9, 9, 14, 30);
    await db.doc(`topesDelVisor/${uid}`).set({ hora: '2026-10-09T10', vistasHora: 29, dia: '2026-10-09', vistasDia: 29, actualizadoEn: Timestamp.now() });
    const r = await Promise.all([V.consumirCupoDelVisor(uid, t0), V.consumirCupoDelVisor(uid, t0), V.consumirCupoDelVisor(uid, t0)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect((await db.doc(`topesDelVisor/${uid}`).get()).get('vistasHora')).toBe(30);
  });

  it('un uid con forma de ruta no abre un documento ajeno', async () => {
    await expect(V.consumirCupoDelVisor('../tenants/x', Date.now())).rejects.toThrow();
    await expect(V.consumirCupoDelVisor('a/b', Date.now())).rejects.toThrow();
  });
});

// ===========================================================================
describe('T19: el token no basta, se vuelve a leer la cuenta', () => {
  const casos: Array<[string, (rol: 'admin' | 'oper') => Record<string, unknown>]> = [
    // Con los claims INTACTOS: lo único que falla es `disabled` (si no, otra guarda taparía la mutación).
    ['cuenta deshabilitada', (rol) => ({ disabled: true, customClaims: { nc: { t: { [T]: rol } } }, tokensValidAfterTime: undefined })],
    ['`disabled` ausente (no es un `false` explícito)', (rol) => ({ customClaims: { nc: { t: { [T]: rol } } }, tokensValidAfterTime: undefined })],
    ['sin el claim del comercio (retirado)', () => ({ disabled: false, customClaims: { nc: { t: {}, v: 1 } }, tokensValidAfterTime: undefined })],
    ['sin ningún claim', () => ({ disabled: false, customClaims: undefined, tokensValidAfterTime: undefined })],
    ['con otro rol en la cuenta', (rol) => ({ disabled: false, customClaims: { nc: { t: { [T]: rol === 'admin' ? 'oper' : 'admin' } } }, tokensValidAfterTime: undefined })],
    ['rol de otro comercio solamente', () => ({ disabled: false, customClaims: { nc: { t: { [OTRO]: 'admin' } } }, tokensValidAfterTime: undefined })],
    ['sesiones revocadas después de la emisión del token', () => ({ disabled: false, customClaims: { nc: { t: { [T]: 'admin' } } }, tokensValidAfterTime: new Date(Date.now() + 60_000).toUTCString() })],
    ['fecha de revocación ilegible', () => ({ disabled: false, customClaims: { nc: { t: { [T]: 'admin' } } }, tokensValidAfterTime: 'no-es-fecha' })],
  ];
  for (const rol of ['admin', 'oper'] as const) {
    for (const [nombre, cuenta] of casos) {
      it(`${rol}, ${nombre}: permission-denied sin una sola escritura`, async () => {
        const e = await escena();
        const antes = await documentosDe(T);
        const quien = rol === 'admin' ? admin(T) : oper(T);
        cuentas.set(quien.uid, cuenta(rol));
        await expect(llamar(pedir(e), quien)).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
        expect(almacen.llamadas).toBe(0);
        expect(await documentosDe(T)).toEqual(antes);
        expect(await topes()).toEqual([]);
      });
    }
  }
  it('la cuenta ya no existe: permission-denied', async () => {
    const e = await escena();
    const a = admin(T);
    cuentas.delete(a.uid);
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('un token con auth_time ANTERIOR a tokensValidAfterTime: denegado; igual o posterior: pasa', async () => {
    const e = await escena();
    const a = admin(T);
    const authMs = (a.token['auth_time'] as number) * 1000;
    cuentas.set(a.uid, { disabled: false, customClaims: { nc: a.token['nc'] }, tokensValidAfterTime: new Date(authMs + 5000).toUTCString() });
    await expect(llamar(pedir(e), a)).rejects.toMatchObject({ code: 'permission-denied' });
    cuentas.set(a.uid, { disabled: false, customClaims: { nc: a.token['nc'] }, tokensValidAfterTime: new Date(authMs - 5000).toUTCString() });
    expect(await llamar(pedir(e), a)).toMatchObject({ mime: 'image/jpeg' });
  });
  it('un token sin auth_time numérico no pasa', async () => {
    const e = await escena();
    for (const auth_time of [undefined, 'ayer', null]) {
      const a = admin(T);
      a.token['auth_time'] = auth_time;
      await expect(llamar(pedir(e), a), String(auth_time)).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('Auth caído (error que no es «no existe»): unavailable, no «sin permiso», y sin escribir', async () => {
    const e = await escena();
    const antes = await documentosDe(T);
    h.getUser.mockRejectedValue(Object.assign(new Error('Auth caído en tenants/x'), { code: 'auth/internal-error' }));
    await expect(llamar(pedir(e), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    expect(await documentosDe(T)).toEqual(antes);
    expect(almacen.llamadas).toBe(0);
    expect(salida.join('\n')).not.toContain('Auth caído');
  });
});

// ===========================================================================
describe('T21: la respuesta es exactamente {mime, base64}', () => {
  it('dos claves, mime de la lista cerrada, y nada del cierre ni de privado/datos', async () => {
    const e = await escena();
    const r = await llamar(pedir(e), admin(T)) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['base64', 'mime']);
    expect(V.MIMES_DEL_VISOR).toContain(r['mime']);
    expect(typeof r['base64']).toBe('string');
    const crudo = JSON.stringify(r);
    for (const prohibido of [TELEFONO, NOMBRE, 'detalle privado', e.ruta, e.idMeta, 'tenants/', 'wamid']) expect(crudo).not.toContain(prohibido);
  });
  it('la lista cerrada de mimes es exactamente la de la consola', () => {
    expect([...V.MIMES_DEL_VISOR]).toEqual(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  });
});

// ===========================================================================
describe('T23: ninguna salida de console trae la ruta, el hash, el comercio ni el cierre', () => {
  const secreto = (e: Escena) => [e.ruta, C.nombreDeObjeto(e.idMeta), e.idMeta, e.t, e.cierreId, 'tenants/', 'comprobantes/', TELEFONO, 'ENOTFOUND'];
  it('un error de Storage cuyo mensaje trae la ruta: unavailable fijo y el log solo trae el código', async () => {
    const e = await escena();
    const filtrado = Object.assign(new Error(`getaddrinfo ENOTFOUND al leer ${e.ruta}`), { code: 500 });
    almacen.fallaMetadatos = filtrado;
    const error = await llamar(pedir(e), admin(T, 'u-a1')).catch((x) => x) as { code: string; message: string };
    expect(error).toMatchObject(falla('unavailable', FIJOS.noDisponible));
    for (const parte of secreto(e)) {
      expect(salida.join('\n'), parte).not.toContain(parte);
      expect(JSON.stringify(error), parte).not.toContain(parte);
    }
    expect((await auditoria(T))[0]).toMatchObject({ resultado: 'rechazado', motivo: 'error_almacen' });
  });
  it('lo mismo si el que falla es la descarga', async () => {
    const e = await escena();
    almacen.fallaLeer = Object.assign(new Error(`falló ${e.ruta}`), { code: 'ECONNRESET' });
    await expect(llamar(pedir(e), admin(T, 'u-a1'))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
    for (const parte of secreto(e)) expect(salida.join('\n'), parte).not.toContain(parte);
  });
  it('un error inesperado dentro del handler (no HttpsError): unavailable, y solo su código al log', async () => {
    const e = await escena();
    // Algo con forma de bytes pero que revienta al leer su firma.
    almacen.bytesRaros = { length: 100 };
    const error = await llamar(pedir(e), admin(T, 'u-a1')).catch((x) => x) as { code: string; message: string };
    expect(error).toMatchObject(falla('unavailable', FIJOS.noDisponible));
    for (const parte of secreto(e)) expect(salida.join('\n'), parte).not.toContain(parte);
    expect(salida.some((l) => l.includes('verComprobante'))).toBe(true);
  });
  it('NINGÚN camino de la prueba (rechazos, tope, tipo, tamaño) imprimió algo con el hash o la ruta', async () => {
    const e = await escena();
    await llamar({ tenantId: T, cierreId: 'venta_no_existe' }, admin(T, 'u-a1')).catch(() => undefined);
    almacen.tamanoFalso.set(e.ruta, C.MAXIMO_IMAGEN + 1);
    await llamar(pedir(e), admin(T, 'u-a1')).catch(() => undefined);
    almacen.tamanoFalso.clear();
    almacen.objetos.set(e.ruta, { bytes: Buffer.from('<svg/>'), contentType: 'image/jpeg' });
    await llamar(pedir(e), admin(T, 'u-a1')).catch(() => undefined);
    await llamar(pedir(e), oper(OTRO, 'u-o1')).catch(() => undefined);
    for (const parte of secreto(e)) expect(salida.join('\n'), parte).not.toContain(parte);
  });
  it('la fuente no imprime la petición ni el mensaje de ningún error', () => {
    expect(CODIGO).not.toMatch(/console\.\w+\([^)]*\b(p\.data|peticion\.data|datos\b|e\.message|error\.message)/);
    expect(CODIGO).not.toMatch(/\.message\b/);
    expect(CODIGO).not.toMatch(/console\.(log|info|error|debug)/);
  });
});

// ===========================================================================
describe('T24 (servidor) y D3: las opciones de la función', () => {
  it('producción: 512 MiB, 3 instancias, concurrencia 4, App Check exigido', () => {
    const o = V.opcionesDeVerComprobante({});
    expect(o).toMatchObject({ memory: '512MiB', maxInstances: 3, concurrency: 4, enforceAppCheck: true, region: 'us-east1' });
  });
  it('staging (CPU fraccionaria): SIN concurrencia y sin App Check; las dos mitades salen de la constante', () => {
    const o = V.opcionesDeVerComprobante({ CPU_FRACCIONARIA: 'si' });
    expect(o).toMatchObject({ memory: '512MiB', maxInstances: 3, enforceAppCheck: false });
    expect(Object.hasOwn(o, 'concurrency')).toBe(false);
    expect(V.APP_CHECK_DEL_VISOR).toEqual({ produccion: true, staging: false });
  });
  it('emulador: App Check apagado, aunque sea «producción»', () => {
    expect(V.opcionesDeVerComprobante({ FUNCTIONS_EMULATOR: 'true' }).enforceAppCheck).toBe(false);
    expect(V.opcionesDeVerComprobante({ FUNCTIONS_EMULATOR: 'false' }).enforceAppCheck).toBe(true);
    expect(V.opcionesDeVerComprobante({ CPU_FRACCIONARIA: '' }).enforceAppCheck).toBe(true);
    expect(V.opcionesDeVerComprobante({ CPU_FRACCIONARIA: 'no' })).toMatchObject({ concurrency: 4 });
  });
  it('la callable real usa esas opciones, y App Check queda solo acá', () => {
    expect(CODIGO).toContain('onCall(opcionesDeVerComprobante(process.env)');
    // La función exportada declara su disparador callable con la memoria fijada.
    const endpoint = (V.verComprobante as unknown as { __endpoint: { availableMemoryMb?: number; callableTrigger?: unknown; maxInstances?: number } }).__endpoint;
    expect(endpoint.callableTrigger).toBeDefined();
    expect(endpoint.availableMemoryMb).toBe(512);
    expect(endpoint.maxInstances).toBe(3);
  });
  it('el tope declarado es 30 por hora y 100 por día', () => {
    expect([V.TOPE_POR_HORA, V.TOPE_POR_DIA]).toEqual([30, 100]);
  });
});
