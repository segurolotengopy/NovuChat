/**
 * CONFIRMAR UN PEDIDO DE CATÁLOGO EXTERNO (B5b, NovuTienda), NEGANDO PRIMERO.
 *
 * Emulador de Firestore; la red (`http`), el reloj, la espera y la cuenta de Auth son dobles inyectados en
 * `crearConfirmarPedidoExterno`. La callable se ejecuta de verdad con `.run`. Cada prueba afirma sobre lo que el
 * doble de red RECIBIÓ (cuántas llamadas, qué bytes, qué cabeceras), no solo sobre lo que devolvió la función.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

/** Todo lo que el servidor manda al logger de Functions: se revisa que no filtre secretos. */
const registros: unknown[][] = [];
const requerir = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'functions', 'package.json'));
const { logger } = requerir('firebase-functions') as typeof import('firebase-functions');
for (const nivel of ['warn', 'info', 'error', 'log', 'debug', 'write'] as const) {
  (logger as unknown as Record<string, unknown>)[nivel] = (...a: unknown[]) => { registros.push(a); };
}

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const M = await import('../../../functions/src/modulos/pedidos/confirmarExterno.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(aqui, '..', '..', '..', 'functions', 'src', 'modulos', 'pedidos', 'confirmarExterno.ts'), 'utf8');
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// ACTORES
// ---------------------------------------------------------------------------
interface Actor { uid: string; token: Record<string, unknown> }
function actor(uid: string, nc: Record<string, unknown>, o: { proveedor?: string; verificado?: boolean } = {}): Actor {
  return {
    uid,
    token: {
      nc: { v: 1, ...nc },
      firebase: { sign_in_provider: o.proveedor ?? 'password', identities: {} },
      email_verified: o.verificado ?? true,
      auth_time: Math.floor(Date.now() / 1000) - 60,
    },
  };
}
const admin = (t: string) => actor(`u-admin-${t}`, { t: { [t]: 'admin' } });
const oper = (t: string) => actor(`u-oper-${t}`, { t: { [t]: 'oper' } });

// ---------------------------------------------------------------------------
// DOBLES
// ---------------------------------------------------------------------------
const AHORA = Date.UTC(2026, 10, 9, 15, 0, 0);
const BEARER = 'BEARER-SECRETO-DE-PRUEBA';
const FIRMA = 'FIRMA-SECRETA-DE-PRUEBA';
const T = 'bermejo-prueba';
const OTRO = 'otro-comercio';
const mapaDe = (extra: Record<string, unknown> = {}) => JSON.stringify({
  [T]: { baseUrl: 'https://tienda.example.org/', bearer: BEARER, firmaSecreto: FIRMA }, ...extra,
});

interface Llamada { url: string; init: RequestInit; cuerpo: string; cab: Record<string, string> }
const h = {
  llamadas: [] as Llamada[],
  respuestas: [] as Array<{ estado: number; cuerpo: string } | Error>,
  secreto: mapaDe() as string | (() => string),
  dormidas: [] as number[],
  vigente: true as boolean | Error,
  reloj: AHORA,
  /** Se ejecuta DENTRO de la llamada de red (el pedido está `confirmando`). */
  durante: null as null | (() => Promise<void>),
};
const respuesta = (estado: number, cuerpo = '') => ({ estado, cuerpo });

const http = (async (url: string | URL | Request, init?: RequestInit) => {
  const cab = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
  h.llamadas.push({ url: String(url), init: init ?? {}, cuerpo: String(init?.body ?? ''), cab });
  if (h.durante) await h.durante();
  const r = h.respuestas.length > 1 ? h.respuestas.shift()! : h.respuestas[0] ?? respuesta(200);
  if (r instanceof Error) throw r;
  return new Response(r.cuerpo === '' ? null : r.cuerpo, { status: r.estado });
}) as unknown as typeof fetch;

const callable = M.crearConfirmarPedidoExterno({
  leerSecreto: () => (typeof h.secreto === 'function' ? h.secreto() : h.secreto),
  cuentaVigente: (async () => { if (h.vigente instanceof Error) throw h.vigente; return h.vigente; }) as never,
  db: () => db,
  http,
  dormir: async (ms) => { h.dormidas.push(ms); },
  ahora: () => h.reloj,
});
/** La entrada del contrato: `{tenantId, pedidoId}`. */
const P = (o: Record<string, unknown> = {}) => ({ tenantId: T, pedidoId: 'wa_BM1', ...o });
const llamar = (data: unknown, a?: Actor) =>
  (callable as unknown as { run: (r: unknown) => Promise<unknown> })
    .run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} });

async function rechazo(p: Promise<unknown>): Promise<{ code: string; message: string; details?: unknown }> {
  try { await p; } catch (e) { return e as { code: string; message: string; details?: unknown }; }
  throw new Error('debía rechazar y devolvió');
}

// ---------------------------------------------------------------------------
// SEMILLAS
// ---------------------------------------------------------------------------
const TELEFONO = 'TEL-SECRETO-DEL-CLIENTE';
const itemExt = (id: string, cantidad: number, o: Record<string, unknown> = {}) => (
  { id, nombre: `Producto ${id}`, cantidad, precio: 150.5, precioCentavos: 15050, moneda: 'BOB', subtotal: 150.5 * cantidad, externa: true, ...o });

async function sembrar(o: {
  t?: string; id?: string; pedido?: Record<string, unknown> | null; ficha?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
} = {}) {
  const t = o.t ?? T;
  const id = o.id ?? 'wa_BM1';
  await db.recursiveDelete(db.doc(`tenants/${t}`));
  if (o.ficha !== null) await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', flujos: ['venta'], modulos: ['productos', 'pedidos'], ...o.ficha });
  if (o.config !== null) await db.doc(`tenants/${t}/config/pedidos`).set(o.config ?? { catalogoExterno: { activo: true, monedas: ['BOB'] } });
  if (o.pedido !== null) {
    const doc: Record<string, unknown> = {
      origen: 'whatsapp', conversacionId: 'wa_59170000009', telefonoEnmascarado: '****009', total: 301, moneda: 'BOB',
      costoEnvio: 0, entrega: 'retiro', referenciaQr: 'BM1', totalServidorCentavos: 30100, montoQrCentavos: 30100,
      totalDistinto: false, catalogo: 'externo', estado: 'recibido', facturacion: { nombre: 'X', documento: TELEFONO },
      items: [itemExt('sku-1', 2), itemExt('mesa.2_a-3', 5, { detalle: 'roble' })],
      ...o.pedido,
    };
    for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
    await db.doc(`tenants/${t}/pedidos/${id}`).set(doc);
  }
  return { t, id };
}
const estadoDe = async (t = T, id = 'wa_BM1') => (await db.doc(`tenants/${t}/pedidos/${id}`).get()).get('estado');
/** El pedido sigue `recibido` y SIN rastro de reclamo (`confirmando*`): volvió al estado de antes, o nunca salió de él. */
const recibidoLimpio = async (t = T, id = 'wa_BM1') => {
  const p = await pedidoCrudo(t, id);
  expect(p['estado']).toBe('recibido');
  expect(p).not.toHaveProperty('confirmandoEn'); expect(p).not.toHaveProperty('confirmandoPor');
  expect(p).not.toHaveProperty('confirmadoEn'); expect(p).not.toHaveProperty('confirmadoPor');
};
const pedidoCrudo = async (t = T, id = 'wa_BM1') => (await db.doc(`tenants/${t}/pedidos/${id}`).get()).data()!;

beforeEach(() => {
  h.llamadas = []; h.respuestas = [respuesta(200)]; h.secreto = mapaDe(); h.dormidas = []; h.vigente = true; h.reloj = AHORA; h.durante = null;
  registros.length = 0;
});

// ===========================================================================
describe('quién puede confirmar (se niega antes de leer o llamar)', () => {
  it('sin sesión: unauthenticated y NovuTienda no recibe nada', async () => {
    await sembrar();
    expect((await rechazo(llamar(P()))).code).toBe('unauthenticated');
    expect(h.llamadas).toHaveLength(0); await recibidoLimpio();
  });
  it('tenantId AJENO: la sesión es de otro comercio (admin u oper) y rechaza sin leer ni llamar, en las dos direcciones', async () => {
    await sembrar(); await sembrar({ t: OTRO });
    for (const a of [admin(OTRO), oper(OTRO)]) {
      expect((await rechazo(llamar(P(), a))).code).toBe('permission-denied'); // pide T con sesión de OTRO
    }
    for (const a of [admin(T), oper(T)]) {
      expect((await rechazo(llamar(P({ tenantId: OTRO }), a))).code).toBe('permission-denied'); // pide OTRO con sesión de T
    }
    expect(h.llamadas).toHaveLength(0);
    await recibidoLimpio(); expect(await estadoDe(OTRO)).toBe('recibido');
  });
  it('propietario de NovuChat (sin rol en el comercio), ingesta y sin claims: rechaza', async () => {
    await sembrar();
    const propietario = actor('u-p', { t: {}, p: true }, { proveedor: 'google.com' });
    const ingesta = actor('u-i', { t: { [T]: 'ingesta' } });
    const vacio = actor('u-v', {});
    for (const a of [propietario, ingesta, vacio]) expect((await rechazo(llamar(P(), a))).code).toBe('permission-denied');
    expect(h.llamadas).toHaveLength(0);
  });
  it('rol correcto pero con Google, o sin correo verificado: rechaza', async () => {
    await sembrar();
    const google = actor('u-g', { t: { [T]: 'admin' } }, { proveedor: 'google.com' });
    const sinVerificar = actor('u-s', { t: { [T]: 'oper' } }, { verificado: false });
    for (const a of [google, sinVerificar]) expect((await rechazo(llamar(P(), a))).code).toBe('permission-denied');
    expect(h.llamadas).toHaveLength(0);
  });
  it('sesión con dos comercios: manda el rol DE ESE tenantId; en un tercero (o donde solo es ingesta) no puede', async () => {
    await sembrar();
    const dos = actor('u-dos', { t: { [T]: 'admin', [OTRO]: 'ingesta' } });
    expect(await llamar(P(), dos)).toMatchObject({ estado: 'confirmado' });
    await sembrar({ t: OTRO });
    expect((await rechazo(llamar(P({ tenantId: OTRO }), dos))).code).toBe('permission-denied');
    expect((await rechazo(llamar(P({ tenantId: 'tercer-comercio' }), dos))).code).toBe('permission-denied');
    expect(h.llamadas).toHaveLength(1);
  });
  it('la entrada es SOLO {tenantId, pedidoId}: falta el tenantId, forma inválida o cualquier clave extra se rechaza', async () => {
    await sembrar();
    for (const malo of [
      { pedidoId: 'wa_BM1' }, P({ tenantId: undefined }), P({ tenantId: 7 }), P({ tenantId: '' }), P({ tenantId: 'A/B' }),
      P({ tenantId: '../x' }), P({ tenantId: 'X' }), P({ items: [] }), P({ confirmadoEn: 1 }), P({ rol: 'admin' }),
    ]) {
      expect((await rechazo(llamar(malo, admin(T)))).code, JSON.stringify(malo)).toBe('invalid-argument');
    }
    expect(h.llamadas).toHaveLength(0);
  });
  it('un tenantId con nombre de propiedad heredada (__proto__, constructor) no resuelve por la cadena de prototipos', async () => {
    await sembrar();
    for (const t of ['__proto__', 'constructor', 'toString']) {
      const e = await rechazo(llamar(P({ tenantId: t }), admin(T)));
      expect(['invalid-argument', 'permission-denied']).toContain(e.code);
    }
    expect(h.llamadas).toHaveLength(0);
  });
  it('la cuenta ya no es vigente (revocada, deshabilitada): rechaza; si Auth cae, unavailable (no un permiso)', async () => {
    await sembrar();
    h.vigente = false;
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('permission-denied');
    h.vigente = new Error('auth caído');
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('unavailable');
    expect(h.llamadas).toHaveLength(0); await recibidoLimpio();
  });
  it('el administrador y el operador del comercio sí pueden', async () => {
    for (const a of [admin(T), oper(T)]) {
      await sembrar(); h.llamadas = [];
      expect(await llamar(P(), a)).toMatchObject({ estado: 'confirmado', yaConfirmado: false });
      expect(h.llamadas).toHaveLength(1);
    }
  });
});

describe('entrada, comercio y pedido', () => {
  it('pedidoId inválido (vacío, tipo, "__", caracteres, largo) no llega a leer ni llamar', async () => {
    await sembrar();
    for (const malo of [undefined, null, 7, '', 'a/b', '../x', '_x', 'wa__x', 'a b', 'x'.repeat(101), { $ne: 1 }]) {
      expect((await rechazo(llamar(P({ pedidoId: malo }), admin(T)))).code).toBe('invalid-argument');
    }
    expect((await rechazo(llamar(undefined, admin(T)))).code).toBe('invalid-argument');
    expect((await rechazo(llamar('wa_BM1', admin(T)))).code).toBe('invalid-argument');
    expect(h.llamadas).toHaveLength(0);
  });
  it('pedido inexistente: not-found y no llama', async () => {
    await sembrar({ pedido: null });
    expect((await rechazo(llamar(P({ pedidoId: 'wa_NOEXISTE' }), admin(T)))).code).toBe('not-found');
    expect(h.llamadas).toHaveLength(0);
  });
  it('el pedido de OTRO comercio con ese id no se ve (se busca solo bajo el comercio del token)', async () => {
    await sembrar({ pedido: null }); await sembrar({ t: OTRO });
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('not-found');
    expect(h.llamadas).toHaveLength(0); expect(await estadoDe(OTRO)).toBe('recibido');
  });
  it('un pedido que NO es de catálogo externo (propio o del checkout web) no se confirma', async () => {
    for (const pedido of [{ catalogo: undefined }, { catalogo: 'propio' }, { catalogo: 'externo', estado: 'recibido', items: [{ id: 'taco', nombre: 'Taco', cantidad: 1 }] }]) {
      await sembrar({ pedido: pedido as never });
      const e = await rechazo(llamar(P(), admin(T)));
      expect(e.code).toBe('failed-precondition');
      expect(h.llamadas).toHaveLength(0);
    }
  });
  it('estados que no son `recibido` ni `confirmado` (reemplazado, cancelado, otro): no se confirma', async () => {
    for (const estado of ['reemplazado', 'cancelado', 'preparando', undefined]) {
      await sembrar({ pedido: { estado } });
      expect((await rechazo(llamar(P(), admin(T)))).code).toBe('failed-precondition');
    }
    expect(h.llamadas).toHaveLength(0);
  });
  it('comercio suspendido, dado de baja o sin módulo Pedidos, o sin catálogo externo habilitado: no sale nada', async () => {
    for (const o of [
      { ficha: { estado: 'suspendido' } }, { ficha: { estado: 'baja' } }, { ficha: { modulos: ['productos'] } },
    ]) {
      await sembrar(o);
      expect((await rechazo(llamar(P(), admin(T)))).code).toBe('permission-denied');
    }
    for (const config of [null, { catalogoExterno: { activo: false, monedas: ['BOB'] } }, {}] as const) {
      await sembrar({ config });
      expect((await rechazo(llamar(P(), admin(T)))).code).toBe('failed-precondition');
    }
    await sembrar({ ficha: null });
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('permission-denied');
    expect(h.llamadas).toHaveLength(0);
  });
  it('un pedido con datos fuera del contrato (id con "__", cantidad 0 / fraccionaria / enorme, repetidos, vacío) no sale', async () => {
    const casos: unknown[][] = [
      [itemExt('a__b', 1)], [itemExt('ok', 0)], [itemExt('ok', 1.5)], [itemExt('ok', 1_000_001)], [itemExt('ok', '2')],
      [itemExt('ok', 1), itemExt('ok', 2)], [], [{ ...itemExt('ok', 1), externa: false }], ['x'], [itemExt('-no', 1)],
    ];
    for (const items of casos) {
      await sembrar({ pedido: { items } });
      expect((await rechazo(llamar(P(), admin(T)))).code).toBe('failed-precondition');
    }
    await sembrar({ id: 'a__b' });
    expect((await rechazo(llamar(P({ pedidoId: 'a__b' }), admin(T)))).code).toBe('invalid-argument');
    expect(h.llamadas).toHaveLength(0);
  });
});

describe('lo que sale a NovuTienda', () => {
  it('el cuerpo es EXACTAMENTE {pedidoId, items[{productoId,cantidad}], confirmadoEn}: ninguna clave extra, nada del cliente', async () => {
    await sembrar();
    await llamar(P(), admin(T));
    expect(h.llamadas).toHaveLength(1);
    const l = h.llamadas[0]!;
    const cuerpo = JSON.parse(l.cuerpo) as Record<string, unknown>;
    expect(Object.keys(cuerpo)).toEqual(['pedidoId', 'items', 'confirmadoEn']);
    expect(cuerpo['pedidoId']).toBe('wa_BM1');
    expect(cuerpo['items']).toEqual([{ productoId: 'sku-1', cantidad: 2 }, { productoId: 'mesa.2_a-3', cantidad: 5 }]);
    for (const i of cuerpo['items'] as Array<Record<string, unknown>>) expect(Object.keys(i)).toEqual(['productoId', 'cantidad']);
    expect(cuerpo['confirmadoEn']).toBe(new Date(AHORA).toISOString());
    for (const nunca of [TELEFONO, 'Producto', 'roble', '150', 'precio', 'telefono', 'BOB', 'facturacion', 'tenant', T]) {
      expect(l.cuerpo, `el cuerpo no debe llevar «${nunca}»`).not.toContain(nunca);
    }
  });
  it('un ítem guardado con claves de más (una futura, una maliciosa) NO sale: el armado copia campo por campo', () => {
    const c = M.armarCuerpo('wa_X', [{ ...itemExt('s1', 3), extra: 'secreto', precio: 9, __proto__x: 1 }], AHORA)!;
    expect(JSON.stringify(c.items)).toBe('[{"productoId":"s1","cantidad":3}]');
    expect(M.armarCuerpo('wa__X', [itemExt('s1', 1)], AHORA)).toBeNull();
  });
  it('POST a {baseUrl}/api/novuchat/v1/pedidos/confirmar, con Bearer del comercio, sin seguir redirecciones', async () => {
    await sembrar();
    await llamar(P(), admin(T));
    const l = h.llamadas[0]!;
    expect(l.url).toBe('https://tienda.example.org/api/novuchat/v1/pedidos/confirmar');
    expect(l.init.method).toBe('POST');
    expect(l.cab['Authorization']).toBe(`Bearer ${BEARER}`);
    expect(l.init.redirect).toBe('error');
    expect(l.init.signal).toBeInstanceOf(AbortSignal);
  });
  it('la firma es verificable con el secreto: HMAC-SHA256 hex de "{marca}.{cuerpo exacto enviado}"', async () => {
    await sembrar();
    await llamar(P(), admin(T));
    const l = h.llamadas[0]!;
    const marca = l.cab['X-Marca-Tiempo']!;
    expect(marca).toBe(String(AHORA));
    expect(l.cab['X-Firma']).toBe(createHmac('sha256', FIRMA).update(`${marca}.${l.cuerpo}`).digest('hex'));
    // NIEGA: con otro secreto, otra marca o un cuerpo alterado, la firma no coincide.
    expect(l.cab['X-Firma']).not.toBe(createHmac('sha256', 'otro-secreto').update(`${marca}.${l.cuerpo}`).digest('hex'));
    expect(l.cab['X-Firma']).not.toBe(createHmac('sha256', FIRMA).update(`${Number(marca) + 1}.${l.cuerpo}`).digest('hex'));
    expect(l.cab['X-Firma']).not.toBe(createHmac('sha256', FIRMA).update(`${marca}.${l.cuerpo} `).digest('hex'));
    expect(l.cab['X-Firma']).toMatch(/^[0-9a-f]{64}$/);
  });
  it('ventana de 5 min: la marca es la hora de ESTE intento (no una vieja ni futura) y cada reintento firma con la suya', async () => {
    await sembrar();
    h.respuestas = [respuesta(503), respuesta(503), respuesta(200)];
    // El reloj avanza con cada llamada del doble de espera.
    let n = 0;
    const c2 = M.crearConfirmarPedidoExterno({
      leerSecreto: () => mapaDe(), cuentaVigente: (async () => true) as never, db: () => db, http,
      dormir: async () => undefined, ahora: () => AHORA + (n++) * 1000,
    });
    await (c2 as unknown as { run: (r: unknown) => Promise<unknown> }).run({ data: P(), auth: admin(T), rawRequest: {} });
    // El reloj se consulta una vez al reclamar (AHORA) y una por intento para su marca: marcas EXACTAS, una por intento.
    expect(h.llamadas.map((l) => l.cab['X-Marca-Tiempo'])).toEqual([String(AHORA + 1000), String(AHORA + 2000), String(AHORA + 3000)]);
    for (const l of h.llamadas) {
      // Dentro de la ventana de 5 min del contrato respecto de la hora de ESTE intento, y firmada con ESA marca.
      expect(l.cab['X-Firma']).toBe(createHmac('sha256', FIRMA).update(`${l.cab['X-Marca-Tiempo']}.${l.cuerpo}`).digest('hex'));
    }
    expect(JSON.parse(h.llamadas[0]!.cuerpo).confirmadoEn).toBe(new Date(AHORA).toISOString());
    // El cuerpo es el MISMO en todos los intentos (la idempotencia es por pedidoId, no por instante).
    expect(new Set(h.llamadas.map((l) => l.cuerpo)).size).toBe(1);
  });
  it('NIEGA: una marca fuera de la ventana de 5 min no es la de este intento (la marca nunca es la del cliente ni la de la semilla)', async () => {
    await sembrar();
    await llamar(P(), admin(T));
    const marca = Number(h.llamadas[0]!.cab['X-Marca-Tiempo']);
    expect(Math.abs(marca - AHORA)).toBeLessThan(5 * 60_000);
    expect(Math.abs(marca - (AHORA + 5 * 60_000 + 1))).toBeGreaterThan(5 * 60_000 - 2);
  });
  it('la marca de tiempo del intento sale del reloj del servidor, nunca del cliente', async () => {
    await sembrar();
    h.reloj = AHORA + 123_456;
    await llamar(P(), admin(T));
    expect(h.llamadas[0]!.cab['X-Marca-Tiempo']).toBe(String(AHORA + 123_456));
  });
});

describe('qué pasa con cada respuesta de NovuTienda', () => {
  it('200: el pedido pasa a `confirmado`, con quién y cuándo, y la respuesta lo dice', async () => {
    await sembrar();
    const r = await llamar(P(), oper(T));
    expect(r).toEqual({ pedidoId: 'wa_BM1', estado: 'confirmado', yaConfirmado: false });
    const p = await pedidoCrudo();
    expect(p['estado']).toBe('confirmado'); expect(p['confirmadoPor']).toBe(`u-oper-${T}`);
    expect((p['confirmadoEn'] as { toMillis(): number }).toMillis()).toBe(AHORA);
    // Lo demás del pedido queda intacto.
    expect(p['total']).toBe(301); expect(p['items']).toHaveLength(2);
  });
  it('`confirmadoEn` guardado es EXACTAMENTE el instante enviado, con un reloj que avanza entre el reclamo y el 200', async () => {
    await sembrar();
    h.respuestas = [respuesta(503), respuesta(200)];
    let n = 0;
    const c2 = M.crearConfirmarPedidoExterno({
      leerSecreto: () => mapaDe(), cuentaVigente: (async () => true) as never, db: () => db, http,
      dormir: async () => undefined, ahora: () => AHORA + (n++) * 7000,
    });
    await (c2 as unknown as { run: (r: unknown) => Promise<unknown> }).run({ data: P(), auth: admin(T), rawRequest: {} });
    const enviado = JSON.parse(h.llamadas[0]!.cuerpo).confirmadoEn as string;
    expect(enviado).toBe(new Date(AHORA).toISOString());
    const p = await pedidoCrudo();
    expect((p['confirmadoEn'] as { toMillis(): number }).toMillis()).toBe(Date.parse(enviado));
    // No es la hora de la última marca ni la del momento de escribir.
    expect((p['confirmadoEn'] as { toMillis(): number }).toMillis()).not.toBe(Number(h.llamadas[1]!.cab['X-Marca-Tiempo']));
    for (const l of h.llamadas) expect(JSON.parse(l.cuerpo).confirmadoEn).toBe(enviado);
    expect(p).not.toHaveProperty('confirmandoEn'); expect(p).not.toHaveProperty('confirmandoPor');
  });
  it('idempotente: confirmar un pedido ya confirmado devuelve OK y NO llama a NovuTienda otra vez', async () => {
    await sembrar();
    await llamar(P(), admin(T));
    expect(h.llamadas).toHaveLength(1);
    const otra = await llamar(P(), admin(T));
    expect(otra).toEqual({ pedidoId: 'wa_BM1', estado: 'confirmado', yaConfirmado: true });
    expect(h.llamadas).toHaveLength(1);
  });
  it('un pedido sembrado ya `confirmado` tampoco llama, aunque el secreto esté ausente', async () => {
    await sembrar({ pedido: { estado: 'confirmado' } });
    h.secreto = () => { throw new Error('no existe'); };
    expect(await llamar(P(), admin(T))).toMatchObject({ yaConfirmado: true });
    expect(h.llamadas).toHaveLength(0);
  });
  it('409: el pedido NO cambia, no se reintenta y el operador recibe los faltantes legibles (con el nombre del PEDIDO, no el de la respuesta)', async () => {
    await sembrar();
    h.respuestas = [respuesta(409, JSON.stringify({ ok: false, error: 'stock-insuficiente', faltantes: [
      { productoId: 'sku-1', nombre: 'NOMBRE-DE-LA-RESPUESTA', pedido: 2, disponible: 1 },
      { productoId: 'inventado', pedido: 9, disponible: 0 },
      { productoId: 'mesa.2_a-3', pedido: 5, disponible: 0, tokenFiltrado: 'x' },
      { id: 'sku-1', pedido: 2, disponible: 0 }, // sin productoId: no cuenta
    ] }))];
    const e = await rechazo(llamar(P(), admin(T)));
    expect(e.code).toBe('failed-precondition');
    expect(e.details).toEqual({ motivo: 'stock_insuficiente', faltantes: [
      { productoId: 'sku-1', nombre: 'Producto sku-1', solicitado: 2, disponible: 1 },
      { productoId: 'mesa.2_a-3', nombre: 'Producto mesa.2_a-3', solicitado: 5, disponible: 0 },
    ] });
    expect(JSON.stringify(e)).not.toContain('NOMBRE-DE-LA-RESPUESTA');
    expect(h.llamadas).toHaveLength(1); expect(h.dormidas).toEqual([]);
    await recibidoLimpio();
  });
  it('409 con el alias `solicitado` en lugar de `pedido`: se lee igual, y `pedido` manda si vienen los dos', async () => {
    await sembrar();
    h.respuestas = [respuesta(409, JSON.stringify({ ok: false, error: 'stock-insuficiente', faltantes: [
      { productoId: 'sku-1', solicitado: 2, disponible: 1 }, { productoId: 'mesa.2_a-3', pedido: 4, solicitado: 9, disponible: 0 },
    ] }))];
    const e = await rechazo(llamar(P(), admin(T)));
    expect((e.details as { faltantes: unknown[] }).faltantes).toEqual([
      { productoId: 'sku-1', nombre: 'Producto sku-1', solicitado: 2, disponible: 1 },
      { productoId: 'mesa.2_a-3', nombre: 'Producto mesa.2_a-3', solicitado: 4, disponible: 0 },
    ]);
    await recibidoLimpio();
  });
  it('409 que NO es stock-insuficiente con faltantes (el error es otro, o no hay lista, o el cuerpo es ilegible): no se toma por stock, no se inventan faltantes y el pedido vuelve a `recibido`', async () => {
    const faltantes = [{ productoId: 'sku-1', pedido: 2, disponible: 0 }];
    const casos = [
      JSON.stringify({ ok: false, error: 'inventario-bloqueado', mensaje: 'MENSAJE-AJENO', faltantes }),
      JSON.stringify({ ok: false, error: 'conflicto-de-inventario', mensaje: 'MENSAJE-AJENO' }),
      JSON.stringify({ ok: false, faltantes }), // sin `error`
      JSON.stringify({ ok: false, error: 'stock-insuficiente' }), // sin lista
      JSON.stringify({ ok: false, error: 'stock-insuficiente', faltantes: 'x' }),
      JSON.stringify({ faltantes }), '', 'no es json', '[]',
    ];
    for (const cuerpo of casos) {
      await sembrar(); h.respuestas = [respuesta(409, cuerpo)]; const antes = h.llamadas.length;
      const e = await rechazo(llamar(P(), admin(T)));
      expect(e.code).toBe('failed-precondition');
      expect(e.details).toEqual({ motivo: 'inventario_rechazo' });
      expect(e.details).not.toHaveProperty('faltantes');
      expect(e.message).toBe(M.MENSAJES.inventarioRechazo);
      expect(JSON.stringify(e)).not.toContain('MENSAJE-AJENO');
      expect(h.llamadas.length - antes).toBe(1); // no se reintenta
      await recibidoLimpio();
    }
    expect(h.dormidas).toEqual([]);
  });
  it('409 stock-insuficiente con lista vacía o solo de ítems ajenos: sigue siendo stock, sin faltantes inventados', async () => {
    for (const faltantes of [[], [{ productoId: 'inventado', pedido: 9, disponible: 0 }]]) {
      await sembrar(); h.respuestas = [respuesta(409, JSON.stringify({ ok: false, error: 'stock-insuficiente', faltantes }))];
      const e = await rechazo(llamar(P(), admin(T)));
      expect(e.details).toEqual({ motivo: 'stock_insuficiente', faltantes: [] });
      await recibidoLimpio();
    }
  });
  it('429 y 503 se reintentan (acotado) y, si luego dan 200, confirma', async () => {
    await sembrar();
    h.respuestas = [respuesta(429), respuesta(503), respuesta(200)];
    expect(await llamar(P(), admin(T))).toMatchObject({ estado: 'confirmado' });
    expect(h.llamadas).toHaveLength(3); expect(h.dormidas).toEqual([500, 1500]);
  });
  it('429/503 que no se arreglan: tras MAX_INTENTOS falla con unavailable y el pedido NO cambia', async () => {
    for (const estado of [429, 503]) {
      await sembrar(); h.llamadas = []; h.dormidas = []; h.respuestas = [respuesta(estado)];
      expect((await rechazo(llamar(P(), admin(T)))).code).toBe('unavailable');
      expect(h.llamadas).toHaveLength(M.MAX_INTENTOS); expect(h.dormidas).toHaveLength(M.MAX_INTENTOS - 1);
      await recibidoLimpio();
    }
  });
  it('400, 401, 405 y cualquier otro código: no se reintenta, el pedido no cambia y se avisa que NovuTienda rechazó', async () => {
    for (const estado of [400, 401, 403, 404, 405, 500, 502, 204, 201, 302]) {
      await sembrar(); h.llamadas = []; h.respuestas = [respuesta(estado)];
      const e = await rechazo(llamar(P(), admin(T)));
      expect(e.code, `estado ${estado}`).toBe('internal');
      expect(h.llamadas).toHaveLength(1); await recibidoLimpio();
    }
  });
  it('error de red o tiempo agotado: unavailable y el pedido no cambia', async () => {
    await sembrar(); h.respuestas = [new TypeError('fetch failed')];
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('unavailable');
    await recibidoLimpio();
  });
  it('la respuesta de NovuTienda no se copia al pedido ni al error del operador', async () => {
    await sembrar(); h.respuestas = [respuesta(400, 'DETALLE-INTERNO-DE-NOVUTIENDA')];
    const e = await rechazo(llamar(P(), admin(T)));
    expect(JSON.stringify(e)).not.toContain('DETALLE-INTERNO');
  });
});

describe('el secreto: falla cerrado y nunca se muestra', () => {
  const peores: Array<[string, string | (() => string)]> = [
    ['ausente (lanza)', () => { throw new Error('secreto sin versión'); }],
    ['vacío', ''],
    ['JSON roto', '{no es json'],
    ['no es un mapa', '[]'],
    ['sin la entrada del comercio', JSON.stringify({ [OTRO]: { baseUrl: 'https://x.example.org', bearer: BEARER, firmaSecreto: FIRMA } })],
    ['bearer presente pero nulo', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', bearer: null, firmaSecreto: FIRMA } })],
    ['bearer presente pero vacío', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', bearer: '', firmaSecreto: FIRMA } })],
    ['clave sobrante mal escrita (Bearer)', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', Bearer: 'abcdefgh1234', firmaSecreto: FIRMA } })],
    ['bearer presente pero no es texto', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', bearer: 12345678, firmaSecreto: FIRMA } })],
    ['bearer presente pero corto (menos de 8)', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', bearer: 'abc', firmaSecreto: FIRMA } })],
    ['firmaSecreto corta sin bearer', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', firmaSecreto: 'abc' } })],
    ['entrada sin firmaSecreto', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', bearer: BEARER } })],
    ['claves cortas', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', bearer: 'abc', firmaSecreto: 'abc' } })],
    ['baseUrl http', JSON.stringify({ [T]: { baseUrl: 'http://x.example.org', bearer: BEARER, firmaSecreto: FIRMA } })],
    ['baseUrl con usuario', JSON.stringify({ [T]: { baseUrl: 'https://u:p@x.example.org', bearer: BEARER, firmaSecreto: FIRMA } })],
    ['baseUrl con parámetros', JSON.stringify({ [T]: { baseUrl: 'https://x.example.org/?a=1', bearer: BEARER, firmaSecreto: FIRMA } })],
    ['baseUrl que no es URL', JSON.stringify({ [T]: { baseUrl: 'tienda', bearer: BEARER, firmaSecreto: FIRMA } })],
    ['comercio llamado __proto__', '{"__proto__":{"baseUrl":"https://x.example.org","bearer":"12345678","firmaSecreto":"12345678"}}'],
  ];
  for (const [nombre, valor] of peores) {
    it(`${nombre}: no sale nada, failed-precondition y el pedido no cambia`, async () => {
      await sembrar(); h.secreto = valor;
      const e = await rechazo(llamar(P(), admin(T)));
      expect(e.code).toBe('failed-precondition');
      expect(h.llamadas).toHaveLength(0); await recibidoLimpio();
    });
  }
  it('el bearer es opcional: un mapa sin bearer es válido y no lo inventa; con bearer, se conserva', () => {
    const sin = M.destinoDeNovuTienda(JSON.stringify({ [T]: { baseUrl: 'https://x.example.org', firmaSecreto: FIRMA } }), T)!;
    expect(sin).not.toBeNull();
    expect(sin).not.toHaveProperty('bearer');
    expect(sin.firmaSecreto).toBe(FIRMA);
    expect(M.destinoDeNovuTienda(mapaDe(), T)!.bearer).toBe(BEARER);
  });
  it('un tenant con nombre de propiedad heredada no resuelve por la cadena de prototipos', () => {
    expect(M.destinoDeNovuTienda('{}', 'constructor')).toBeNull();
    expect(M.destinoDeNovuTienda('{}', 'toString')).toBeNull();
  });
  it('el baseUrl con ruta y barra final se normaliza una sola vez', () => {
    const d = M.destinoDeNovuTienda(JSON.stringify({ [T]: { baseUrl: 'https://x.example.org/tienda//', bearer: BEARER, firmaSecreto: FIRMA } }), T)!;
    expect(d.url).toBe('https://x.example.org/tienda/api/novuchat/v1/pedidos/confirmar');
  });
  it('NO se loguea el secreto, el Bearer, la URL, el teléfono ni el cuerpo, en ningún camino', async () => {
    const prohibidos = [BEARER, FIRMA, 'tienda.example.org', TELEFONO, 'sku-1', 'DETALLE-INTERNO'];
    const escenarios: Array<() => Promise<unknown>> = [
      async () => { await sembrar(); await llamar(P(), admin(T)); },
      async () => { await sembrar(); h.respuestas = [respuesta(503, 'DETALLE-INTERNO')]; await rechazo(llamar(P(), admin(T))); },
      async () => { await sembrar(); h.respuestas = [respuesta(409, 'DETALLE-INTERNO {"faltantes":[]}')]; await rechazo(llamar(P(), admin(T))); },
      async () => { await sembrar(); h.respuestas = [respuesta(401, 'DETALLE-INTERNO')]; await rechazo(llamar(P(), admin(T))); },
      async () => { await sembrar(); h.secreto = () => { throw new Error(`falla con ${BEARER}`); }; await rechazo(llamar(P(), admin(T))); },
      async () => { await sembrar(); h.respuestas = [new TypeError(`fetch failed ${BEARER}`)]; await rechazo(llamar(P(), admin(T))); },
    ];
    for (const e of escenarios) { h.secreto = mapaDe(); h.respuestas = [respuesta(200)]; await e(); }
    expect(registros.length).toBeGreaterThan(0);
    const todo = JSON.stringify(registros);
    for (const p of prohibidos) expect(todo, `el log no debe contener «${p}»`).not.toContain(p);
    // Y el código fuente no loguea nada fuera del helper `registrar` (código + estado HTTP).
    expect(CODIGO.match(/logger\./g)?.length).toBe(1);
    expect(CODIGO).not.toMatch(/console\./);
  });
  it('el mapa no se escribe en el repositorio: el código no trae URLs ni claves de NovuTienda', () => {
    expect(CODIGO).not.toMatch(/https?:\/\/(?!\$)/);
    expect(CODIGO).toContain("defineSecret('NOVUTIENDA_CONFIRMAR')");
  });
});

const { cerrarPedidoWa } = await import('../../../functions/src/modulos/pedidos/pedidoDelQr.ts');
const correrCon = (c: unknown, data: unknown, a: Actor) =>
  (c as { run: (r: unknown) => Promise<unknown> }).run({ data, auth: { uid: a.uid, token: a.token }, rawRequest: {} });

describe('estado intermedio `confirmando`', () => {
  it('durante la llamada el pedido está `confirmando` (con quién y desde cuándo) y el cliente NO puede reemplazarlo ni cancelarlo', async () => {
    await sembrar();
    let durante: Record<string, unknown> | null = null;
    let reemplazo: boolean | null = null; let cancelacion: boolean | null = null;
    h.durante = async () => {
      durante = await pedidoCrudo();
      reemplazo = await cerrarPedidoWa(T, 'BM1', 'reemplazado');
      cancelacion = await cerrarPedidoWa(T, 'BM1', 'cancelado');
    };
    expect(await llamar(P(), oper(T))).toMatchObject({ estado: 'confirmado', yaConfirmado: false });
    expect(durante).toMatchObject({ estado: 'confirmando', confirmandoPor: `u-oper-${T}` });
    expect((durante!['confirmandoEn'] as { toMillis(): number }).toMillis()).toBe(AHORA);
    expect(reemplazo).toBe(false); expect(cancelacion).toBe(false);
    expect(await estadoDe()).toBe('confirmado'); // ni el reemplazo ni la cancelación lo pisaron
  });
  it('dos confirmaciones simultáneas hacen UNA sola llamada; la otra espera o ve «ya confirmado», nunca llama', async () => {
    await sembrar();
    h.durante = async () => { await new Promise((ok) => setTimeout(ok, 150)); };
    const resultados = await Promise.allSettled([llamar(P(), admin(T)), llamar(P(), oper(T))]);
    expect(h.llamadas).toHaveLength(1);
    const buenos = resultados.filter((r) => r.status === 'fulfilled') as Array<PromiseFulfilledResult<{ yaConfirmado: boolean }>>;
    const malos = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(buenos.filter((r) => !r.value.yaConfirmado)).toHaveLength(1); // exactamente una confirmó de verdad
    for (const m of malos) expect((m.reason as { code: string }).code).toBe('failed-precondition');
    expect(await estadoDe()).toBe('confirmado');
  });
  it('un `confirmando` reciente (de otra persona) se rechaza sin llamar; uno de más de 2 min se puede retomar', async () => {
    await sembrar({ pedido: { estado: 'confirmando', confirmandoPor: 'u-otro', confirmandoEn: Timestamp.fromMillis(AHORA - 60_000) } });
    const e = await rechazo(llamar(P(), admin(T)));
    expect(e.code).toBe('failed-precondition'); expect(e.message).toContain('se está confirmando');
    expect(h.llamadas).toHaveLength(0);
    expect((await pedidoCrudo())['confirmandoPor']).toBe('u-otro'); // no lo tocó
    h.reloj = AHORA + 61_000 + 60_000; // ahora el reclamo tiene 121 s
    expect(await llamar(P(), admin(T))).toMatchObject({ estado: 'confirmado', yaConfirmado: false });
    expect(h.llamadas).toHaveLength(1);
    const p = await pedidoCrudo();
    expect(p['confirmadoPor']).toBe(`u-admin-${T}`); expect(p).not.toHaveProperty('confirmandoPor');
  });
  it('el borde: justo a 2 min sigue vigente; un reclamo sin fecha legible se considera abandonado', async () => {
    await sembrar({ pedido: { estado: 'confirmando', confirmandoPor: 'u-otro', confirmandoEn: Timestamp.fromMillis(AHORA - M.CONFIRMANDO_MAXIMO_MS) } });
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('failed-precondition');
    await sembrar({ pedido: { estado: 'confirmando', confirmandoPor: 'u-otro' } });
    expect(await llamar(P(), admin(T))).toMatchObject({ yaConfirmado: false });
  });
  it('si la función muere después del reclamo, el pedido queda `confirmando` y NO `confirmado` (nadie lo da por hecho)', async () => {
    await sembrar();
    h.durante = async () => { throw new Error('la instancia murió'); };
    const e = await rechazo(llamar(P(), admin(T)));
    expect(e.code).toBe('unavailable');
    await recibidoLimpio(); // la excepción de la llamada devuelve el reclamo propio
  });
  it('SIN bearer en el mapa: la llamada firmada sale sin cabecera Authorization (ni ninguna variante) y confirma', async () => {
    await sembrar(); h.secreto = JSON.stringify({ [T]: { baseUrl: 'https://tienda.example.org/', firmaSecreto: FIRMA } });
    expect(await llamar(P(), admin(T))).toMatchObject({ estado: 'confirmado' });
    const l = h.llamadas[0]!;
    expect(Object.keys(l.cab).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(JSON.stringify(l.cab)).not.toMatch(/bearer/i);
    expect(l.cab['X-Firma']).toBe(createHmac('sha256', FIRMA).update(`${l.cab['X-Marca-Tiempo']}.${l.cuerpo}`).digest('hex'));
  });
  it('CON bearer válido en el mapa: se sigue enviando Authorization con ese valor', async () => {
    await sembrar();
    await llamar(P(), admin(T));
    expect(h.llamadas[0]!.cab['Authorization']).toBe(`Bearer ${BEARER}`);
  });
  it('409, 429/503 agotados, red, 400/401 y tiempo agotado: el pedido VUELVE a `recibido` y se puede intentar de nuevo', async () => {
    for (const r of [respuesta(409, '{"ok":false,"error":"stock-insuficiente","faltantes":[]}'), respuesta(409, '{"error":"x","mensaje":"y"}'), respuesta(503), respuesta(429), respuesta(400), respuesta(401), new TypeError('x')]) {
      await sembrar(); h.respuestas = [r];
      await rechazo(llamar(P(), admin(T)));
      await recibidoLimpio();
    }
    h.respuestas = [respuesta(200)];
    expect(await llamar(P(), admin(T))).toMatchObject({ estado: 'confirmado' }); // se reintenta sin esperar 2 min
  });
  it('lo devuelto a `recibido` no pisa un reclamo ajeno: si otra persona lo retomó, no se toca', async () => {
    await sembrar();
    h.respuestas = [respuesta(503)];
    h.durante = async () => {
      await db.doc(`tenants/${T}/pedidos/wa_BM1`).update({ confirmandoPor: 'u-otro' }); // otro lo retomó mientras tanto
    };
    await rechazo(llamar(P(), admin(T)));
    expect(await estadoDe()).toBe('confirmando');
    expect((await pedidoCrudo())['confirmandoPor']).toBe('u-otro');
  });
  it('NovuTienda respondió 200 y el pedido se BORRÓ durante la llamada: not-found, y no se crea ningún documento', async () => {
    await sembrar();
    h.durante = async () => { await db.doc(`tenants/${T}/pedidos/wa_BM1`).delete(); };
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('not-found');
    expect((await db.doc(`tenants/${T}/pedidos/wa_BM1`).get()).exists).toBe(false);
  });
  it('el 200 llega pero la escritura final falla: queda `confirmando` (no `recibido`), unavailable; pasados 2 min se retoma y confirma', async () => {
    await sembrar();
    let transacciones = 0;
    const parcial = { doc: db.doc.bind(db), runTransaction: (f: never) => { transacciones++; if (transacciones === 2) throw new Error('firestore caído'); return db.runTransaction(f); } };
    const c2 = M.crearConfirmarPedidoExterno({
      leerSecreto: () => mapaDe(), cuentaVigente: (async () => true) as never, db: () => parcial as never, http,
      dormir: async () => undefined, ahora: () => h.reloj,
    });
    expect((await rechazo(correrCon(c2, P(), admin(T)))).code).toBe('unavailable');
    expect(await estadoDe()).toBe('confirmando');
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('failed-precondition'); // antes de 2 min: nadie más llama
    expect(h.llamadas).toHaveLength(1);
    h.reloj = AHORA + 121_000;
    expect(await llamar(P(), admin(T))).toMatchObject({ estado: 'confirmado' });
    expect(h.llamadas).toHaveLength(2); // NovuTienda es idempotente por pedidoId
  });
});

describe('opciones de despliegue y registro', () => {
  it('App Check por ambiente (producción sí; staging y emulador no) y concurrencia explícita baja (10), no en staging', () => {
    expect(M.APP_CHECK_DE_CONFIRMAR).toEqual({ produccion: true, staging: false });
    expect(M.opcionesDeConfirmar({})).toMatchObject({ enforceAppCheck: true, concurrency: 10, maxInstances: 3, timeoutSeconds: 60 });
    expect(M.opcionesDeConfirmar({ CPU_FRACCIONARIA: '' }).enforceAppCheck).toBe(true);
    expect(M.opcionesDeConfirmar({ CPU_FRACCIONARIA: 'no' })).toMatchObject({ enforceAppCheck: true, concurrency: 10 });
    const staging = M.opcionesDeConfirmar({ CPU_FRACCIONARIA: 'si' });
    expect(staging.enforceAppCheck).toBe(false); expect(staging).not.toHaveProperty('concurrency');
    expect(M.opcionesDeConfirmar({ FUNCTIONS_EMULATOR: 'true' }).enforceAppCheck).toBe(false);
    expect(M.opcionesDeConfirmar({ FUNCTIONS_EMULATOR: 'false' }).enforceAppCheck).toBe(true);
    expect(CODIGO).toContain('onCall(opcionesDeConfirmar(process.env)');
  });
  it('registro: la callable está declarada en el módulo Pedidos', async () => {
    const { REGISTRO } = await import('../../../functions/src/registro.ts') as unknown as { REGISTRO: Array<{ modulo: string; functions: string[] }> };
    expect(REGISTRO.find((m) => m.modulo === 'pedidos')!.functions).toContain('confirmarPedidoExterno');
  });
  it('un estado ajeno al conjunto nunca se confirma (y `confirmando` es parte del conjunto)', async () => {
    expect(M.estadoDelPedido('confirmando')).toBe('confirmando');
    for (const raro of ['preparando', 'CONFIRMADO', '', null, undefined, 7]) expect(M.estadoDelPedido(raro)).toBeNull();
    await sembrar({ pedido: { estado: 'preparando' } });
    expect((await rechazo(llamar(P(), admin(T)))).code).toBe('failed-precondition');
    expect(h.llamadas).toHaveLength(0);
  });
});
