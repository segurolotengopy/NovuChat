/**
 * `verComprobante`, SEGUNDA FORMA SIN CIERRE: `{tenantId, conversacionId, idMeta}`, ESCRITO NEGANDO
 *
 * Abre un comprobante que NO tiene cierre (inválido, ilegible, tardío, en revisión) desde
 * `solicitud.comprobantes[]` de la conversación. Mismo arnés que `ver-comprobante.test.ts`:
 * emulador de Firestore, almacén doble que cuenta, Auth simulado y auditoría que puede fallar.
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

// ---------------------------------------------------------------------------
// SEMILLAS DE LA FORMA SIN CIERRE
// ---------------------------------------------------------------------------
// Armado en tiempo de ejecución: el saneo del repo público prohíbe secuencias de 10 o más dígitos.
const TEL = ['5917', '0012', '345'].join('');
const TEL_AJENO = ['5917', '0099', '999'].join('');
const CONV = `wa_${TEL}`;

interface Recibido { t: string; conv: string; idMeta: string; ruta: string }
/** Una conversación con un comprobante anotado (cualquier estado) y su objeto en el almacén. NINGÚN cierre. */
async function recibido(t = T, o: {
  idMeta?: string; estado?: string; ext?: C.ExtensionDeComprobante; bytes?: Buffer; rutaEnEntrada?: unknown;
  enMs?: number; conv?: string; extras?: Array<Record<string, unknown>>;
} = {}): Promise<Recibido> {
  const idMeta = o.idMeta ?? `wamid.${t}.rec1`;
  const ext = o.ext ?? 'jpg';
  const enMs = o.enMs ?? Date.now();
  const conv = o.conv ?? CONV;
  await ficha(t);
  const ruta = C.rutaDeComprobante(t, diaDeLaPaz(enMs), idMeta, ext);
  await db.doc(`tenants/${t}/conversaciones/${conv}`).set({
    solicitud: {
      comprobantes: [
        ...(o.extras ?? []),
        {
          idMeta, estado: o.estado ?? 'invalido', motivo: 'no_cuadra', en: Timestamp.fromMillis(enMs),
          ruta: o.rutaEnEntrada !== undefined ? o.rutaEnEntrada : ruta, importe: null, montoLeido: 50, montoDistinto: true, intentos: 1,
        },
      ],
    },
  });
  almacen.objetos.set(ruta, { bytes: o.bytes ?? JPG(), contentType: 'image/jpeg' });
  return { t, conv, idMeta, ruta };
}
const pedirR = (r: Recibido) => ({ tenantId: r.t, conversacionId: r.conv, idMeta: r.idMeta });
const FIJOS_R = { noHayR: 'No se encontró ese comprobante.', noElegibleR: 'Este comprobante no se puede mostrar.' };
const sinDatosPersonales = (x: unknown) => {
  const s = JSON.stringify(x);
  return !s.includes(TEL) && !s.includes(CONV);
};

// ===========================================================================
describe('forma de la entrada: excluyente y estricta', () => {
  it('cierreId + conversacionId juntos: invalid-argument, sin tope ni almacén ni escritura', async () => {
    const r = await recibido();
    const antes = await documentosDe(T);
    await expect(llamar({ ...pedirR(r), cierreId: 'venta_visor1' }, admin(T))).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    await expect(llamar({ tenantId: T, cierreId: 'venta_visor1', idMeta: r.idMeta }, admin(T))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(almacen.llamadas).toBe(0);
    expect(await topes()).toEqual([]);
    expect(await documentosDe(T)).toEqual(antes);
  });
  it.each([
    ['sin prefijo wa_', TEL], ['con letras', 'wa_5917abc12345'], ['corto (7 dígitos)', 'wa_1234567'], ['corto (9 dígitos)', 'wa_123456789'],
    ['largo (16 dígitos)', `wa_${'1'.repeat(16)}`], ['con ruta', `wa_${TEL}/../x`], ['con barra', `wa_${TEL}/privado`],
    ['vacío', ''], ['número', Number(TEL)], ['objeto', { a: 1 }],
  ])('conversacionId de forma inválida (%s): invalid-argument', async (_n, conversacionId) => {
    const r = await recibido();
    await expect(llamar({ tenantId: T, conversacionId, idMeta: r.idMeta }, admin(T))).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    expect(almacen.llamadas).toBe(0);
    expect(await topes()).toEqual([]);
  });
  it.each([
    ['falta', undefined], ['vacío', ''], ['solo espacios', '   '], ['con salto de línea', 'wamid.a\nb'], ['con salto al final', 'wamid.a\n'], ['con control', 'wamid.a\u0000b'], ['con tabulación', 'wamid.a\tb'], ['con barra invertida', 'wamid.a\\b'], ['con espacio', 'wamid. a'], ['de 121 caracteres', 'x'.repeat(121)], ['número', 7], ['arreglo', ['a']],
  ])('idMeta inválido (%s): invalid-argument', async (_n, idMeta) => {
    await recibido();
    await expect(llamar({ tenantId: T, conversacionId: CONV, idMeta }, admin(T))).rejects.toMatchObject(falla('invalid-argument', FIJOS.invalido));
    expect(almacen.llamadas).toBe(0);
  });
  it('ninguna de las dos formas ({tenantId} solo): invalid-argument', async () => {
    await expect(llamar({ tenantId: T }, admin(T))).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

// ===========================================================================
describe('quién puede: nada escrito para quien no tiene rol, mismas guardas que la forma con cierre', () => {
  it('el administrador de OTRO comercio: permission-denied y NADA escrito en Firestore', async () => {
    const r = await recibido();
    await ficha(OTRO);
    const antes = [await documentosDe(T), await documentosDe(OTRO)];
    await expect(llamar(pedirR(r), admin(OTRO))).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect([await documentosDe(T), await documentosDe(OTRO)]).toEqual(antes);
    expect(await topes()).toEqual([]);
    expect(almacen.llamadas).toBe(0);
  });
  it('sin sesión: unauthenticated; con sesión sin ningún rol: permission-denied y nada escrito', async () => {
    const r = await recibido();
    await expect(llamar(pedirR(r))).rejects.toMatchObject({ code: 'unauthenticated' });
    const antes = await documentosDe(T);
    await expect(llamar(pedirR(r), actor('u-nadie', { t: {} }))).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
    expect(almacen.llamadas).toBe(0);
  });
  it('el propietario SIN ventana de soporte: permission-denied, nada escrito y el almacén intacto', async () => {
    const r = await recibido();
    const antes = await documentosDe(T);
    await expect(llamar(pedirR(r), soporte())).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect(await documentosDe(T)).toEqual(antes);
    expect(await topes()).toEqual([]);
    expect(almacen.llamadas).toBe(0);
  });
  it('el propietario CON ventana vigente sí lo ve, y queda como «soporte»', async () => {
    const r = await recibido();
    await db.doc(`tenants/${T}/accesosSoporte/u-soporte`).set({ expira: Timestamp.fromMillis(Date.now() + 3_600_000) });
    expect(await llamar(pedirR(r), soporte())).toMatchObject({ mime: 'image/jpeg' });
    expect((await auditoria(T))[0]).toMatchObject({ rol: 'soporte', origen: 'recibido', resultado: 'ok' });
  });
  it('un comercio sin el módulo de cobros: permission-denied auditado «sin_modulo» y sin tope', async () => {
    const r = await recibido();
    await db.doc(`tenants/${T}`).update({ modulos: ['productos'] });
    await expect(llamar(pedirR(r), admin(T))).rejects.toMatchObject(falla('permission-denied', FIJOS.sinPermiso));
    expect((await auditoria(T))[0]).toMatchObject({ resultado: 'rechazado', motivo: 'sin_modulo', origen: 'recibido' });
    expect(await topes()).toEqual([]);
    expect(almacen.llamadas).toBe(0);
  });
  it('tope agotado (30 en la hora): resource-exhausted, auditado «tope» y sin tocar el almacén', async () => {
    const r = await recibido();
    const a = admin(T);
    const sello = new Date(Date.now() - 4 * 3_600_000).toISOString();
    await db.doc(`topesDelVisor/${a.uid}`).set({
      hora: sello.slice(0, 13), vistasHora: 30, dia: sello.slice(0, 10), vistasDia: 30, actualizadoEn: Timestamp.now(),
    });
    await expect(llamar(pedirR(r), a)).rejects.toMatchObject(falla('resource-exhausted', FIJOS.tope));
    expect((await auditoria(T))[0]).toMatchObject({ resultado: 'rechazado', motivo: 'tope' });
    expect(almacen.llamadas).toBe(0);
  });
  it('el tope diario (100) también corta', async () => {
    const r = await recibido();
    const a = admin(T);
    const sello = new Date(Date.now() - 4 * 3_600_000).toISOString();
    await db.doc(`topesDelVisor/${a.uid}`).set({
      hora: sello.slice(0, 13), vistasHora: 1, dia: sello.slice(0, 10), vistasDia: 100, actualizadoEn: Timestamp.now(),
    });
    await expect(llamar(pedirR(r), a)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(almacen.llamadas).toBe(0);
  });
});

// ===========================================================================
describe('la resolución: solo lo que la conversación tiene anotado', () => {
  it('un idMeta que NO está en la conversación: not-found y el almacén no se toca', async () => {
    await recibido();
    const a = admin(T);
    await expect(llamar({ tenantId: T, conversacionId: CONV, idMeta: 'wamid.no-esta' }, a)).rejects.toMatchObject(falla('not-found', FIJOS_R.noHayR));
    expect(almacen.llamadas).toBe(0);
    // El cupo se gasta ANTES de resolver: mover el consumo después de la resolución rompe esta prueba.
    expect((await db.doc(`topesDelVisor/${a.uid}`).get()).get('vistasHora')).toBe(1);
  });
  it('una conversación que no existe: not-found', async () => {
    await ficha(T);
    await expect(llamar({ tenantId: T, conversacionId: `wa_${TEL_AJENO}`, idMeta: 'wamid.x' }, admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
  });
  it('la misma conversación en OTRO comercio no se lee: se busca solo bajo el comercio pedido', async () => {
    const r = await recibido(OTRO);
    await ficha(T);
    await expect(llamar({ tenantId: T, conversacionId: r.conv, idMeta: r.idMeta }, admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
  });
  it('el idMeta es EXACTO: un prefijo o distinta mayúscula no encuentra', async () => {
    const r = await recibido(T, { idMeta: 'wamid.Exacto' });
    for (const idMeta of ['wamid.exacto', 'wamid.Exact', 'wamid.Exacto.']) {
      await expect(llamar({ tenantId: T, conversacionId: r.conv, idMeta }, admin(T))).rejects.toMatchObject({ code: 'not-found' });
    }
    expect(almacen.llamadas).toBe(0);
  });
  it('entre varias entradas se abre la del idMeta pedido', async () => {
    const otro = C.rutaDeComprobante(T, diaDeLaPaz(Date.now()), 'wamid.otro', 'png');
    almacen.objetos.set(otro, { bytes: PNG(), contentType: 'image/png' });
    const r = await recibido(T, { extras: [{ idMeta: 'wamid.otro', estado: 'valido', motivo: 'ok', en: Timestamp.now(), ruta: otro }] });
    const resp = await llamar(pedirR(r), admin(T)) as { mime: string };
    expect(resp.mime).toBe('image/jpeg');
    expect(almacen.leerRutas).toEqual([r.ruta]);
  });
});

// ===========================================================================
describe('la ruta sale SIEMPRE de la entrada y pasa por rutaValidaDe', () => {
  const sembrarRuta = (ruta: string) => almacen.objetos.set(ruta, { bytes: PNG(), contentType: 'image/png' });
  const nadaAjeno = (ajena: string) => {
    expect(almacen.metadatosRutas).not.toContain(ajena);
    expect(almacen.leerRutas).not.toContain(ajena);
    for (const ruta of [...almacen.metadatosRutas, ...almacen.leerRutas]) expect(ruta).not.toContain('..');
  };
  it('una ruta de OTRO comercio en la entrada no llega al almacén; se deriva la propia', async () => {
    const ajena = C.rutaDeComprobante(OTRO, diaDeLaPaz(Date.now()), 'wamid.rec-ajena', 'jpg');
    sembrarRuta(ajena);
    const r = await recibido(T, { idMeta: 'wamid.rec-ajena', rutaEnEntrada: ajena });
    const resp = await llamar(pedirR(r), admin(T)) as { mime: string };
    expect(resp.mime).toBe('image/jpeg');
    nadaAjeno(ajena);
    expect(almacen.leerRutas).toEqual([r.ruta]);
  });
  it('una ruta de OTRO idMeta (mismo comercio) no llega al almacén', async () => {
    const ajena = C.rutaDeComprobante(T, diaDeLaPaz(Date.now()), 'wamid.de-otro-mensaje', 'png');
    sembrarRuta(ajena);
    const r = await recibido(T, { rutaEnEntrada: ajena });
    await llamar(pedirR(r), admin(T));
    nadaAjeno(ajena);
    expect(almacen.leerRutas).toEqual([r.ruta]);
  });
  it('una ruta con `..` no llega al almacén', async () => {
    const r0 = C.rutaDeComprobante(OTRO, '2026-10-01', 'wamid.x', 'jpg');
    const traversal = `tenants/${T}/comprobantes/2026-10-01/../../../${r0}`;
    sembrarRuta(traversal);
    const r = await recibido(T, { rutaEnEntrada: traversal });
    await llamar(pedirR(r), admin(T));
    nadaAjeno(traversal);
  });
  it('una ruta que no es texto (objeto) tampoco', async () => {
    const r = await recibido(T, { rutaEnEntrada: { a: 1 } });
    await llamar(pedirR(r), admin(T));
    expect(almacen.leerRutas).toEqual([r.ruta]);
  });
  it('una ruta ajena y sin `en` utilizable: not-found sin tocar el almacén', async () => {
    const ajena = C.rutaDeComprobante(OTRO, diaDeLaPaz(Date.now()), 'wamid.sinen', 'jpg');
    sembrarRuta(ajena);
    const r = await recibido(T, { idMeta: 'wamid.sinen', rutaEnEntrada: ajena });
    await db.doc(`tenants/${T}/conversaciones/${CONV}`).update({
      'solicitud.comprobantes': [{ idMeta: 'wamid.sinen', estado: 'invalido', motivo: 'x', en: 'ayer', ruta: ajena }],
    });
    await expect(llamar(pedirR(r), admin(T))).rejects.toMatchObject({ code: 'not-found' });
    expect(almacen.llamadas).toBe(0);
  });
  it('sin ruta en la entrada se deriva del día de `en`, validada', async () => {
    const r = await recibido(T, { rutaEnEntrada: null });
    expect(await llamar(pedirR(r), admin(T))).toMatchObject({ mime: 'image/jpeg' });
    for (const ruta of almacen.metadatosRutas) expect(C.rutaValidaDe(ruta, T, r.idMeta)).toBe(ruta);
  });
});

// ===========================================================================
describe('los bytes: tipo por la firma, tamaño sin descargar, auditoría fail-closed', () => {
  it('un .jpg que trae HTML: failed-precondition y auditado «tipo_no_coincide»', async () => {
    const r = await recibido(T, { bytes: Buffer.from('<html><script>alert(1)</script></html>') });
    await expect(llamar(pedirR(r), admin(T))).rejects.toMatchObject(falla('failed-precondition', FIJOS_R.noElegibleR));
    expect((await auditoria(T))[0]).toMatchObject({ resultado: 'rechazado', motivo: 'tipo_no_coincide', origen: 'recibido' });
  });
  it('un .jpg que en realidad es PNG: no coincide con la extensión', async () => {
    const r = await recibido(T, { bytes: PNG() });
    await expect(llamar(pedirR(r), admin(T))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('una imagen de más del tope: failed-precondition sin descargar', async () => {
    const r = await recibido();
    almacen.tamanoFalso.set(r.ruta, C.MAXIMO_IMAGEN + 1);
    await expect(llamar(pedirR(r), admin(T))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(almacen.leerRutas).toHaveLength(0);
  });
  it('si la auditoría del resultado ok falla: unavailable, mensaje fijo y NINGÚN byte', async () => {
    const r = await recibido();
    h.auditar = async () => { throw Object.assign(new Error(`caída en tenants/${T}/auditoria ${TEL}`), { code: 14 }); };
    const error = await llamar(pedirR(r), admin(T)).catch((e: unknown) => e) as { code: string; message: string };
    expect(error).toMatchObject(falla('unavailable', FIJOS.noDisponible));
    expect(JSON.stringify(error)).not.toContain(JPG().toString('base64'));
    expect(salida.join('\n')).not.toContain(TEL);
  });
  it('si la auditoría de un rechazo falla: unavailable, no el rechazo', async () => {
    const r = await recibido(T, { bytes: Buffer.from('<html>') });
    h.auditar = async () => { throw new Error('caída'); };
    await expect(llamar(pedirR(r), admin(T))).rejects.toMatchObject(falla('unavailable', FIJOS.noDisponible));
  });
});

// ===========================================================================
describe('el camino feliz sin cierre', () => {
  it.each(['invalido', 'en_revision', 'tardio', 'aproximado', 'valido'])(
    'un comprobante «%s» de la conversación se entrega al administrador, con auditoría y teléfono enmascarado',
    async (estado) => {
      const r = await recibido(T, { estado });
      const resp = await llamar(pedirR(r), admin(T));
      expect(resp).toEqual({ mime: 'image/jpeg', base64: JPG().toString('base64') });
      const a = await auditoria(T);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({
        accion: 'comprobante_visto', uid: `u-admin-${T}`, rol: 'admin', origen: 'recibido', resultado: 'ok',
        telefonoEnmascarado: '****345', objeto: C.nombreDeObjeto(r.idMeta),
      });
      expect(JSON.stringify(a)).not.toContain(r.idMeta);
      expect(JSON.stringify(a)).not.toContain(TEL.slice(0, 8));
      expect(a[0]).not.toHaveProperty('cierreId');
      expect(sinDatosPersonales(a)).toBe(true);
      expect(sinDatosPersonales(salida)).toBe(true);
      expect((await documentosDe(T)).filter((x) => x.includes('/cierres/'))).toEqual([]);
    },
  );
  it('el operador también lo ve y queda como «oper»', async () => {
    const r = await recibido();
    expect(await llamar(pedirR(r), oper(T))).toMatchObject({ mime: 'image/jpeg' });
    expect((await auditoria(T))[0]).toMatchObject({ rol: 'oper', origen: 'recibido' });
  });
  it('un PDF se entrega con application/pdf', async () => {
    const r = await recibido(T, { ext: 'pdf', bytes: PDF() });
    const resp = await llamar(pedirR(r), admin(T)) as { mime: string; base64: string };
    expect(resp.mime).toBe('application/pdf');
    expect(Buffer.from(resp.base64, 'base64').equals(PDF())).toBe(true);
  });
  it('PNG y WEBP también', async () => {
    const a = await recibido(T, { idMeta: 'wamid.p', ext: 'png', bytes: PNG() });
    expect(await llamar(pedirR(a), admin(T))).toMatchObject({ mime: 'image/png' });
    const b = await recibido(T, { idMeta: 'wamid.w', ext: 'webp', bytes: WEBP() });
    expect(await llamar(pedirR(b), admin(T))).toMatchObject({ mime: 'image/webp' });
  });
  it('la respuesta es exactamente {mime, base64}: nunca una URL', async () => {
    const r = await recibido();
    expect(Object.keys(await llamar(pedirR(r), admin(T)) as object).sort()).toEqual(['base64', 'mime']);
  });
  it('la forma con cierre sigue igual: mismo resultado y asiento con cierreId', async () => {
    const e = await escena();
    expect(await llamar(pedir(e), admin(T))).toEqual({ mime: 'image/jpeg', base64: JPG().toString('base64') });
    const a = await auditoria(T);
    expect(a[0]).toMatchObject({ rol: 'admin', cierreId: e.cierreId, resultado: 'ok' });
    expect(a[0]).not.toHaveProperty('origen');
  });
});
