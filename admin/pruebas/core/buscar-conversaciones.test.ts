/**
 * `buscarConversaciones` (H1-4): BUSCAR UNA PALABRA EN LOS MENSAJES, ESCRITO NEGANDO
 *
 * Contrato: entrada `{tenantId, texto, cursor?}`, salida `{palabras, resultados,
 * cursor}`. Cada guarda de `acceso.ts` y `buscarConversaciones.ts` tiene acá una
 * prueba que falla si se quita. Dos comercios ficticios (tienda-a, tienda-b), la
 * misma palabra en los dos, y teléfonos de prueba con seis ceros.
 *
 * CÓMO SE PRUEBA SIN NUBE:
 *  - Firestore: el emulador; la callable se ejecuta de verdad con `.run`.
 *  - Auth: `firebase-admin/auth` se simula entero y se exige que NUNCA se llame
 *    (decisión D13: sin `cuentaVigenteDe`; el permiso es el de las reglas).
 *  - El reloj: solo `Date`, fijo. Ninguna prueba depende de la hora de la corrida.
 *  - Los registros: `logger` y `console` se espían; ninguno recibe el texto buscado.
 *
 * El emulador NO exige índices: que el índice exista lo prueba la lectura de
 * `firestore.indexes.json` (más abajo) y el despliegue.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const h = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase-admin/auth')>();
  return { ...original, getAuth: (...a: unknown[]) => h.getAuth(...a) };
});

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const B = await import('../../functions/src/core/conversacion/buscarConversaciones.ts');
const { camposDeMensajeIndexado } = await import('../../functions/src/core/conversacion/derivados.ts');
const { REGION } = await import('../../functions/src/core/region.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
/** El MISMO módulo `logger` que carga el código de Functions (CJS: una sola instancia en el caché de Node), para espiarlo. */
const { default: logger } = await import('../../functions/node_modules/firebase-functions/lib/logger/index.js') as unknown as {
  default: Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...a: unknown[]) => void>;
};
const SRC = join(aqui, '..', '..', 'functions', 'src', 'core', 'conversacion');
const CODIGO = (archivo: string) => readFileSync(join(SRC, archivo), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// ACTORES
// ---------------------------------------------------------------------------
interface Actor { uid: string; token: Record<string, unknown> }
function actor(
  uid: string, nc: Record<string, unknown>, opciones: { proveedor?: string; verificado?: boolean } = {},
): Actor {
  return {
    uid,
    token: {
      nc: { v: 1, ...nc },
      firebase: { sign_in_provider: opciones.proveedor ?? 'password', identities: {} },
      email_verified: opciones.verificado ?? true,
    },
  };
}
const admin = (t: string, uid = `u-admin-${t}`) => actor(uid, { t: { [t]: 'admin' } });
const oper = (t: string, uid = `u-oper-${t}`) => actor(uid, { t: { [t]: 'oper' } });
const propietario = (uid = 'u-propietario') => actor(uid, { t: {}, p: true }, { proveedor: 'google.com' });

const llamar = (data: unknown, a?: Actor) =>
  (B.buscarConversaciones as unknown as { run: (r: unknown) => Promise<unknown> })
    .run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} });

/** El error con el que la callable rechazó, para comparar `code` y `message`. */
async function rechazo(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try { await p; } catch (e) { const x = e as { code: string; message: string }; return { code: x.code, message: x.message }; }
  throw new Error('la callable NO rechazó');
}
const salidaDe = async (data: unknown, a: Actor) => await llamar(data, a) as import('../../functions/src/core/conversacion/buscarConversaciones.ts').SalidaDeBusqueda;

// ---------------------------------------------------------------------------
// SEMILLAS
// ---------------------------------------------------------------------------
const A = 'tienda-a';
const OTRO = 'tienda-b';
const TODOS = [A, OTRO, 'tienda-baja', 'tienda-susp', 'tienda-fantasma', 'tienda-rara', 'constructor'];
const TEL1 = '59100000001';
const TEL2 = '59100000002';
const AHORA = Date.UTC(2026, 9, 9, 15, 0, 0);
const BASE = Date.UTC(2026, 8, 1, 12, 0, 0); // los mensajes sembrados nacen antes de AHORA
const HORA = 3_600_000;

const FIJOS = {
  sinSesion: 'Inicie sesión.',
  sinPermiso: 'No tiene permiso para buscar en estas conversaciones.',
  pocoTexto: 'Escriba al menos una palabra de 3 letras.',
  cursor: 'La búsqueda cambió; vuelva a buscar.',
  noDisponible: 'La búsqueda no está disponible en este momento. Intente de nuevo.',
};

/** La ficha del comercio. `estado` omitido = activo; para una ficha SIN estado se usa `fichaSinEstado`. */
async function ficha(t: string, estado: unknown = 'activo') {
  await db.doc(`tenants/${t}`).set({ nombre: t, estado });
}
const fichaSinEstado = (t: string) => db.doc(`tenants/${t}`).set({ nombre: t });

/** Un mensaje como lo deja la ingesta: con `tenantId` y `palabras` (salvo `viejo`). */
async function mensaje(t: string, tel: string, texto: string, ms: number, o: {
  direccion?: string; viejo?: boolean; tenantDelCampo?: string;
} = {}): Promise<string> {
  const ref = db.collection(`tenants/${t}/conversaciones/wa_${tel}/mensajes`).doc();
  await ref.set({
    direccion: o.direccion ?? 'entrante', tipo: 'texto', texto, ts: Timestamp.fromMillis(ms),
    ...(o.viejo ? {} : camposDeMensajeIndexado(texto, o.tenantDelCampo ?? t)),
  });
  return ref.id;
}

let registros: string[] = [];
const reciente = (n: number) => BASE + n * 1000;

beforeAll(async () => {
  await db.doc('tenants/sonda-buscar').get();
}, 60_000);
beforeEach(async () => {
  // La limpieza va con el reloj REAL: el BulkWriter de `recursiveDelete` regula su ritmo con `Date.now()`
  // y, con la hora congelada, dejaría de recibir cupo y se colgaría.
  vi.useRealTimers();
  for (const t of [...TODOS, 'sonda-buscar']) await db.recursiveDelete(db.doc(`tenants/${t}`));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AHORA));
  await ficha(A);
  await ficha(OTRO);
  h.getAuth.mockReset();
  h.getAuth.mockImplementation(() => { throw new Error('buscarConversaciones NO debe mirar Auth (D13)'); });
  registros = [];
  const anotar = (...a: unknown[]) => { registros.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, nivel).mockImplementation(anotar);
    vi.spyOn(logger, nivel).mockImplementation(anotar);
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// ===========================================================================
describe('el camino feliz', () => {
  it('el administrador de A halla la palabra en A: forma exacta de la salida', async () => {
    const id = await mensaje(A, TEL1, 'Quiero dos alfajores de maicena para mañana', reciente(1));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(Object.keys(r).sort()).toEqual(['cursor', 'palabras', 'resultados']);
    expect(r.palabras).toEqual(['alfajor']);
    expect(r.cursor).toBeNull();
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0]).toEqual({
      conversacionId: `wa_${TEL1}`, telefono: TEL1, mensajeId: id, ts: reciente(1), direccion: 'entrante',
      fragmento: 'Quiero dos alfajores de maicena para mañana',
    });
  });

  it('el operador de A también busca en A', async () => {
    await mensaje(A, TEL1, 'hay alfajores hoy', reciente(1));
    expect((await salidaDe({ tenantId: A, texto: 'alfajor' }, oper(A))).resultados).toHaveLength(1);
  });

  it('un mensaje saliente aparece y se rotula «saliente»', async () => {
    await mensaje(A, TEL1, 'Le enviamos el alfajor', reciente(1), { direccion: 'saliente' });
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(r.resultados[0]?.direccion).toBe('saliente');
  });

  it('el servidor ignora las claves de más: ni una ruta ni un límite del cliente cuentan', async () => {
    await mensaje(A, TEL1, 'alfajor de A', reciente(1));
    await mensaje(OTRO, TEL1, 'alfajor de B', reciente(2));
    const r = await salidaDe({
      tenantId: A, texto: 'alfajor', ruta: `tenants/${OTRO}/conversaciones/wa_${TEL1}/mensajes`, limite: 500, collection: 'x',
    }, admin(A));
    expect(r.resultados.map((x) => x.fragmento)).toEqual(['alfajor de A']);
  });

  it('NO mira Auth: ni getAuth ni getUser (sin cuentaVigenteDe)', async () => {
    await mensaje(A, TEL1, 'alfajor', reciente(1));
    await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(h.getAuth).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe('quién puede buscar: ninguna otra pertenencia sirve', () => {
  beforeEach(async () => { await mensaje(A, TEL1, 'alfajor secreto de A', reciente(1)); await mensaje(OTRO, TEL1, 'alfajor de B', reciente(2)); });

  it('sin sesión: unauthenticated «Inicie sesión.»', async () => {
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }))).toEqual({ code: 'unauthenticated', message: FIJOS.sinSesion });
  });

  it('el administrador de A pidiendo B: permission-denied (no se autoriza contra «el primer comercio del token»)', async () => {
    expect(await rechazo(llamar({ tenantId: OTRO, texto: 'alfajor' }, admin(A)))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
  });

  it('el operador de A pidiendo B: permission-denied', async () => {
    expect(await rechazo(llamar({ tenantId: OTRO, texto: 'alfajor' }, oper(A)))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
  });

  it('con roles en A y en B, cada uno lee SOLO el suyo', async () => {
    const dos = actor('u-dos', { t: { [A]: 'admin', [OTRO]: 'oper' } });
    const deA = await salidaDe({ tenantId: A, texto: 'alfajor' }, dos);
    const deB = await salidaDe({ tenantId: OTRO, texto: 'alfajor' }, dos);
    expect(deA.resultados.map((r) => r.fragmento)).toEqual(['alfajor secreto de A']);
    expect(deB.resultados.map((r) => r.fragmento)).toEqual(['alfajor de B']);
  });

  it('un usuario con claims de otro comercio, o sin claims, no entra', async () => {
    for (const a of [admin('tienda-zzz'), actor('u-sin', { t: {} }), actor('u-nada', {}), { uid: 'u-sin-nc', token: {} }]) {
      expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, a)), a.uid).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
    }
  });

  it('el administrador con sesión de Google o con el correo sin verificar: claim inerte', async () => {
    const casos = [
      actor('u-g', { t: { [A]: 'admin' } }, { proveedor: 'google.com' }),
      actor('u-v', { t: { [A]: 'admin' } }, { verificado: false }),
      actor('u-go', { t: { [A]: 'oper' } }, { proveedor: 'google.com' }),
      actor('u-vo', { t: { [A]: 'oper' } }, { verificado: false }),
    ];
    for (const a of casos) expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, a)), a.uid).toMatchObject({ code: 'permission-denied' });
  });

  it('un claim de rol desconocido (viewer, administrador) no sirve', async () => {
    for (const rol of ['viewer', 'administrador', 'ADMIN', '']) {
      expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, actor('u-r', { t: { [A]: rol } }))), rol).toMatchObject({ code: 'permission-denied' });
    }
  });
});

// ===========================================================================
describe('el propietario de NovuChat: solo con una ventana de soporte vigente', () => {
  const ventana = (t: string, uid: string, expiraMs: unknown) =>
    db.doc(`tenants/${t}/accesosSoporte/${uid}`).set({ expira: expiraMs, creadoEn: Timestamp.fromMillis(AHORA) });
  beforeEach(async () => { await mensaje(A, TEL1, 'alfajor de A', reciente(1)); });

  it('sin ventana: permission-denied, y NO se lee la ficha', async () => {
    const espiaDoc = vi.spyOn(db, 'doc');
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, propietario()))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
    expect(espiaDoc.mock.calls.map((c) => c[0]).filter((r) => r === `tenants/${A}`)).toEqual([]);
  });

  it('con ventana vigente: entra y ve lo del comercio', async () => {
    await ventana(A, 'u-propietario', Timestamp.fromMillis(AHORA + HORA));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, propietario());
    expect(r.resultados).toHaveLength(1);
  });

  it('con la ventana vencida (o venciendo justo ahora): permission-denied', async () => {
    for (const expira of [AHORA - 1000, AHORA]) {
      await ventana(A, 'u-propietario', Timestamp.fromMillis(expira));
      expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, propietario())), String(expira)).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('la ventana de OTRO comercio no abre este', async () => {
    await ficha(OTRO);
    await ventana(OTRO, 'u-propietario', Timestamp.fromMillis(AHORA + HORA));
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, propietario()))).toMatchObject({ code: 'permission-denied' });
  });

  it('la ventana de OTRO usuario no abre al propietario', async () => {
    await ventana(A, 'u-otro-propietario', Timestamp.fromMillis(AHORA + HORA));
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, propietario()))).toMatchObject({ code: 'permission-denied' });
  });

  it('una ventana sin `expira` o con un `expira` que no es fecha: permission-denied', async () => {
    for (const expira of [undefined, 'mañana', AHORA + HORA, null]) {
      await db.doc(`tenants/${A}/accesosSoporte/u-propietario`).set(expira === undefined ? { creadoEn: 1 } : { expira });
      expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, propietario())), String(expira)).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('el propietario sin sesión de Google (contraseña) o sin el claim: no entra aunque tenga ventana', async () => {
    await ventana(A, 'u-p2', Timestamp.fromMillis(AHORA + HORA));
    await ventana(A, 'u-p3', Timestamp.fromMillis(AHORA + HORA));
    const conContrasena = actor('u-p2', { t: {}, p: true }, { proveedor: 'password' });
    const sinClaim = actor('u-p3', { t: {} }, { proveedor: 'google.com' });
    for (const a of [conContrasena, sinClaim]) expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, a)), a.uid).toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('el estado del comercio: suspendido sí lee, dado de baja o inexistente no', () => {
  it('suspendido: permitido', async () => {
    await ficha('tienda-susp', 'suspendido');
    await mensaje('tienda-susp', TEL1, 'alfajor en pausa', reciente(1));
    expect((await salidaDe({ tenantId: 'tienda-susp', texto: 'alfajor' }, admin('tienda-susp'))).resultados).toHaveLength(1);
  });

  it('dado de baja: permission-denied aunque tenga mensajes y el rol del token', async () => {
    await ficha('tienda-baja', 'dado_de_baja');
    await mensaje('tienda-baja', TEL1, 'alfajor de una baja', reciente(1));
    expect(await rechazo(llamar({ tenantId: 'tienda-baja', texto: 'alfajor' }, admin('tienda-baja')))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
  });

  it('inexistente, sin estado o con un estado raro: permission-denied', async () => {
    await mensaje('tienda-fantasma', TEL1, 'alfajor fantasma', reciente(1)); // hay mensajes, no hay ficha
    expect(await rechazo(llamar({ tenantId: 'tienda-fantasma', texto: 'alfajor' }, admin('tienda-fantasma')))).toMatchObject({ code: 'permission-denied' });
    for (const estado of [undefined, 'inactivo', 'ACTIVO', 7, null, { a: 1 }]) {
      if (estado === undefined) await fichaSinEstado('tienda-rara'); else await ficha('tienda-rara', estado);
      expect(await rechazo(llamar({ tenantId: 'tienda-rara', texto: 'alfajor' }, admin('tienda-rara'))), String(estado)).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('el propietario con ventana vigente tampoco entra a un comercio dado de baja', async () => {
    await ficha('tienda-baja', 'dado_de_baja');
    await db.doc('tenants/tienda-baja/accesosSoporte/u-propietario').set({ expira: Timestamp.fromMillis(AHORA + HORA) });
    expect(await rechazo(llamar({ tenantId: 'tienda-baja', texto: 'alfajor' }, propietario()))).toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('la forma del tenantId se valida ANTES de armar ninguna ruta', () => {
  const malos: unknown[] = [
    '__proto__', '../x', '../tienda-b', 'tienda-a/../tienda-b', 'tienda-a/', 'TIENDA-A', 'Tienda-A', '',
    'a', 'ab', '-tienda', 'tienda a', 'tienda.a', `${'x'.repeat(61)}`, undefined, null, 42, {}, ['tienda-a'], true,
  ];

  it('permission-denied con el mismo mensaje fijo, sin leer Firestore', async () => {
    const espiaDoc = vi.spyOn(db, 'doc');
    const espiaGrupo = vi.spyOn(db, 'collectionGroup');
    const todosConRol = actor('u-todo', { t: { __proto__x: 'admin', 'tienda-a': 'admin' } });
    for (const t of malos) {
      for (const a of [admin(A), todosConRol, propietario()]) {
        expect(await rechazo(llamar({ tenantId: t, texto: 'alfajor' }, a)), `${String(t)}/${a.uid}`).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
      }
    }
    expect(espiaDoc).not.toHaveBeenCalled();
    expect(espiaGrupo).not.toHaveBeenCalled();
  });

  it('«__proto__» y «constructor» no se resuelven por la cadena de prototipos del mapa de roles', async () => {
    const a = actor('u-p', { t: {} });
    for (const t of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(await rechazo(llamar({ tenantId: t, texto: 'alfajor' }, a)), t).toMatchObject({ code: 'permission-denied' });
    }
    await ficha('constructor');
    expect(await rechazo(llamar({ tenantId: 'constructor', texto: 'alfajor' }, a))).toMatchObject({ code: 'permission-denied' });
    await db.doc('tenants/constructor').delete();
  });

  it('sin `data` (o con data que no es objeto) también se rechaza como sin permiso', async () => {
    for (const data of [undefined, null, 'tienda-a', 42, [A]]) {
      expect(await rechazo(llamar(data, admin(A))), String(data)).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('el permiso se decide ANTES que el texto: sin rol, un texto inválido no revela nada', async () => {
    expect(await rechazo(llamar({ tenantId: OTRO, texto: '' }, admin(A)))).toMatchObject({ code: 'permission-denied' });
    expect(await rechazo(llamar({ tenantId: A, texto: '' }))).toMatchObject({ code: 'unauthenticated' });
  });
});

// ===========================================================================
describe('el texto buscado: de 1 a 100 caracteres y con una palabra de 3 letras', () => {
  it('vacío, de 2 letras, solo símbolos, de 101 caracteres o que no es texto: invalid-argument', async () => {
    const malos: unknown[] = ['', ' ', '   ', 'ab', 'a b', '12 34', '¿?!', '😀😀😀', 'x'.repeat(101), `${'alfajor '.repeat(13)}`, undefined, null, 42, {}, ['alfajor'], true];
    for (const texto of malos) {
      expect(await rechazo(llamar({ tenantId: A, texto }, admin(A))), String(texto).slice(0, 20)).toEqual({ code: 'invalid-argument', message: FIJOS.pocoTexto });
    }
  });

  it('justo en el límite: 100 caracteres con una palabra buena se acepta', async () => {
    await mensaje(A, TEL1, 'alfajor', reciente(1));
    const texto = `alfajor ${'a '.repeat(46)}`.slice(0, 100);
    expect(texto).toHaveLength(100);
    expect((await salidaDe({ tenantId: A, texto }, admin(A))).resultados).toHaveLength(1);
  });

  it('con más de 6 palabras solo cuentan las 6 primeras (y se devuelven)', async () => {
    const r = await salidaDe({ tenantId: A, texto: 'uno dos tres cuatro cinco seis siete ocho' }, admin(A));
    expect(r.palabras).toHaveLength(6);
    expect(r.palabras).not.toContain('siete');
  });
});

// ===========================================================================
describe('el cursor: una forma cerrada y una ruta que se arma BAJO el comercio', () => {
  beforeEach(async () => { await mensaje(A, TEL1, 'alfajor de A', reciente(1)); });

  it('mal formado u otra forma: invalid-argument «La búsqueda cambió»', async () => {
    const malos: unknown[] = [
      '', 'x', 'wa_1/abc', `wa_${TEL1}`, `wa_${TEL1}/`, `wa_${TEL1}/${'a'.repeat(19)}`, `wa_${TEL1}/${'a'.repeat(21)}`,
      `wa_${TEL1}/${'a'.repeat(19)}-`, `${TEL1}/${'a'.repeat(20)}`, `WA_${TEL1}/${'a'.repeat(20)}`, `wa_${'1'.repeat(16)}/${'a'.repeat(20)}`,
      `wa_${'1'.repeat(7)}/${'a'.repeat(20)}`, `wa_${TEL1}/${'a'.repeat(20)}\n`, ` wa_${TEL1}/${'a'.repeat(20)}`,
      `tenants/${OTRO}/conversaciones/wa_${TEL1}/mensajes/${'a'.repeat(20)}`, `../${OTRO}/wa_${TEL1}/${'a'.repeat(20)}`,
      `wa_${TEL1}/../../${'a'.repeat(20)}`, 42, true, {}, ['x'], { path: `tenants/${OTRO}/x` },
    ];
    for (const cursor of malos) {
      expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor', cursor }, admin(A))), JSON.stringify(cursor)).toEqual({ code: 'invalid-argument', message: FIJOS.cursor });
    }
  });

  it('con la forma correcta pero que no existe: invalid-argument', async () => {
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor', cursor: `wa_${TEL1}/${'a'.repeat(20)}` }, admin(A)))).toEqual({ code: 'invalid-argument', message: FIJOS.cursor });
  });

  it('un cursor que apunta a un mensaje de OTRO comercio: la ruta se rearma bajo el pedido y no existe', async () => {
    const ajeno = await mensaje(OTRO, TEL2, 'alfajor de B', reciente(5)); // solo existe bajo B
    const r = await rechazo(llamar({ tenantId: A, texto: 'alfajor', cursor: `wa_${TEL2}/${ajeno}` }, admin(A)));
    expect(r).toEqual({ code: 'invalid-argument', message: FIJOS.cursor });
  });

  it('un cursor sobre un documento sin `ts` no sirve', async () => {
    const ref = db.collection(`tenants/${A}/conversaciones/wa_${TEL1}/mensajes`).doc();
    await ref.set({ direccion: 'entrante', texto: 'sin fecha' });
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor', cursor: `wa_${TEL1}/${ref.id}` }, admin(A)))).toEqual({ code: 'invalid-argument', message: FIJOS.cursor });
  });

  it('cursor ausente, undefined o null: primera página', async () => {
    for (const cursor of [undefined, null]) {
      expect((await salidaDe({ tenantId: A, texto: 'alfajor', cursor }, admin(A))).resultados).toHaveLength(1);
    }
  });

  it('el cursor se valida DESPUÉS del permiso: quien no tiene rol recibe «sin permiso», no «cambió»', async () => {
    expect(await rechazo(llamar({ tenantId: OTRO, texto: 'alfajor', cursor: 'basura' }, admin(A)))).toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('un comercio nunca ve las palabras de otro', () => {
  it('la misma palabra en A y en B: cada uno ve solo la suya, con la misma conversación y el mismo teléfono', async () => {
    const idA = await mensaje(A, TEL1, 'quiero alfajor de A', reciente(1));
    const idB = await mensaje(OTRO, TEL1, 'quiero alfajor de B', reciente(2));
    const deA = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    const deB = await salidaDe({ tenantId: OTRO, texto: 'alfajor' }, admin(OTRO));
    expect(deA.resultados.map((r) => r.mensajeId)).toEqual([idA]);
    expect(deB.resultados.map((r) => r.mensajeId)).toEqual([idB]);
    expect(JSON.stringify(deA)).not.toContain('de B');
    expect(JSON.stringify(deB)).not.toContain('de A');
  });

  it('la consulta lleva el filtro tenantId: sin él, la palabra de B más nueva saldría en A', async () => {
    await mensaje(A, TEL1, 'alfajor viejo de A', reciente(1));
    for (let i = 0; i < 25; i++) await mensaje(OTRO, TEL2, `alfajor ajeno ${i}`, reciente(10 + i));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(r.resultados.map((x) => x.fragmento)).toEqual(['alfajor viejo de A']);
    expect(r.cursor).toBeNull();
  });

  it('un documento bajo B que dice tenantId «A» (dato corrupto) no sale en A: se comprueba también la ruta', async () => {
    await mensaje(OTRO, TEL2, 'alfajor mal etiquetado', reciente(3), { tenantDelCampo: A });
    await mensaje(A, TEL1, 'alfajor legítimo', reciente(1));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(r.resultados.map((x) => x.fragmento)).toEqual(['alfajor legítimo']);
  });

  it('un documento bajo A que dice tenantId «B» no sale en A', async () => {
    await mensaje(A, TEL2, 'alfajor etiquetado a B', reciente(3), { tenantDelCampo: OTRO });
    expect((await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A))).resultados).toEqual([]);
  });

  it('el propietario con ventana en A ve A, y la ventana de A no le abre B', async () => {
    await db.doc(`tenants/${A}/accesosSoporte/u-propietario`).set({ expira: Timestamp.fromMillis(AHORA + HORA) });
    await mensaje(A, TEL1, 'alfajor de A', reciente(1));
    await mensaje(OTRO, TEL1, 'alfajor de B', reciente(2));
    expect((await salidaDe({ tenantId: A, texto: 'alfajor' }, propietario())).resultados.map((r) => r.fragmento)).toEqual(['alfajor de A']);
    expect(await rechazo(llamar({ tenantId: OTRO, texto: 'alfajor' }, propietario()))).toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
describe('qué se halla: la normalización de Core, la misma que usa la ingesta', () => {
  it('«alfajor» halla «alfajores» y «alfajores» halla «alfajor»', async () => {
    await mensaje(A, TEL1, 'dos alfajores por favor', reciente(1));
    await mensaje(A, TEL2, 'un alfajor solo', reciente(2));
    for (const buscado of ['alfajor', 'alfajores', 'ALFAJORES']) {
      const r = await salidaDe({ tenantId: A, texto: buscado }, admin(A));
      expect(r.resultados.map((x) => x.conversacionId).sort(), buscado).toEqual([`wa_${TEL1}`, `wa_${TEL2}`]);
    }
  });

  it('con tildes, eñes y mayúsculas, en cualquiera de las dos direcciones', async () => {
    await mensaje(A, TEL1, 'Las SALTEÑAS estaban Riquísimas', reciente(1));
    await mensaje(A, TEL2, 'quiero saltenas y una Cañería', reciente(2));
    for (const buscado of ['salteñas', 'saltenas', 'SALTEÑA', 'riquisimas']) {
      const r = await salidaDe({ tenantId: A, texto: buscado }, admin(A));
      expect(r.resultados.length, buscado).toBeGreaterThanOrEqual(1);
    }
    expect((await salidaDe({ tenantId: A, texto: 'saltenas' }, admin(A))).resultados).toHaveLength(2);
    expect((await salidaDe({ tenantId: A, texto: 'caneria' }, admin(A))).resultados).toHaveLength(1);
  });

  it('varias palabras exigen TODAS, en cualquier orden', async () => {
    await mensaje(A, TEL1, 'alfajor de maicena', reciente(1));
    await mensaje(A, TEL1, 'maicena y también alfajor', reciente(2));
    await mensaje(A, TEL2, 'solo alfajor de dulce', reciente(3));
    await mensaje(A, TEL2, 'solo maicena para la torta', reciente(4));
    await mensaje(A, TEL2, 'alfajor y torta', reciente(5));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor maicena' }, admin(A));
    expect(r.resultados.map((x) => x.fragmento)).toEqual(['maicena y también alfajor', 'alfajor de maicena']);
    const tres = await salidaDe({ tenantId: A, texto: 'maicena alfajor torta' }, admin(A));
    expect(tres.resultados).toEqual([]);
  });

  it('una palabra que no existe no halla nada (y no devuelve «todo»)', async () => {
    await mensaje(A, TEL1, 'alfajor', reciente(1));
    expect((await salidaDe({ tenantId: A, texto: 'zanahoria' }, admin(A))).resultados).toEqual([]);
  });

  it('un mensaje ANTERIOR a la indexación (sin `palabras` ni `tenantId`) no aparece', async () => {
    await mensaje(A, TEL1, 'alfajor de antes', reciente(1), { viejo: true });
    await db.collection(`tenants/${A}/conversaciones/wa_${TEL1}/mensajes`).doc().set({
      direccion: 'entrante', texto: 'alfajor con tenantId pero sin palabras', ts: Timestamp.fromMillis(reciente(2)), tenantId: A,
    });
    await mensaje(A, TEL1, 'alfajor de ahora', reciente(3));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(r.resultados.map((x) => x.fragmento)).toEqual(['alfajor de ahora']);
  });
});

// ===========================================================================
describe('el orden, el tope de 20 y la paginación', () => {
  it('más nuevo primero (ts descendente), entre conversaciones distintas', async () => {
    await mensaje(A, TEL1, 'alfajor uno', reciente(1));
    await mensaje(A, TEL2, 'alfajor tres', reciente(3));
    await mensaje(A, TEL1, 'alfajor dos', reciente(2));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(r.resultados.map((x) => x.fragmento)).toEqual(['alfajor tres', 'alfajor dos', 'alfajor uno']);
    const ts = r.resultados.map((x) => x.ts);
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
  });

  it('NEGATIVA: nunca más de 20 resultados, aunque haya 25; y trae cursor', async () => {
    for (let i = 0; i < 25; i++) await mensaje(A, TEL1, `alfajor número ${i}`, reciente(i));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(r.resultados).toHaveLength(20);
    expect(r.cursor).toMatch(/^wa_[0-9]{8,15}\/[A-Za-z0-9]{20}$/);
  });

  it('paginar sin duplicados ni saltos: 20 + 5 = 25 ids distintos, en orden, y la última página cierra con null', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await mensaje(A, i % 2 ? TEL1 : TEL2, `alfajor número ${i}`, reciente(i)));
    const p1 = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    const p2 = await salidaDe({ tenantId: A, texto: 'alfajor', cursor: p1.cursor }, admin(A));
    expect(p1.resultados).toHaveLength(20);
    expect(p2.resultados).toHaveLength(5);
    expect(p2.cursor).toBeNull();
    const todos = [...p1.resultados, ...p2.resultados].map((r) => r.mensajeId);
    expect(new Set(todos).size).toBe(25);
    expect(todos).toEqual([...ids].reverse());
  });

  it('con exactamente 20 resultados la página trae cursor y la siguiente viene vacía y cierra', async () => {
    for (let i = 0; i < 20; i++) await mensaje(A, TEL1, `alfajor ${i}`, reciente(i));
    const p1 = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    expect(p1.resultados).toHaveLength(20);
    const p2 = await salidaDe({ tenantId: A, texto: 'alfajor', cursor: p1.cursor }, admin(A));
    expect(p2).toMatchObject({ resultados: [], cursor: null });
  });

  it('mensajes con el mismo `ts` tampoco se duplican ni se pierden entre páginas', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await mensaje(A, TEL1, `alfajor igual ${i}`, reciente(7)));
    const p1 = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    const p2 = await salidaDe({ tenantId: A, texto: 'alfajor', cursor: p1.cursor }, admin(A));
    const vistos = [...p1.resultados, ...p2.resultados].map((r) => r.mensajeId);
    expect(vistos).toHaveLength(30);
    expect(new Set(vistos)).toEqual(new Set(ids));
  });

  it('varias palabras: la segunda pasada descarta, y se leen hasta 3 lotes para no devolver páginas vacías', async () => {
    // 45 mensajes recientes con solo «alfajor» y 3 viejos con «alfajor» y «maicena».
    for (let i = 0; i < 3; i++) await mensaje(A, TEL1, `alfajor maicena ${i}`, reciente(i));
    for (let i = 0; i < 45; i++) await mensaje(A, TEL2, `alfajor solo ${i}`, reciente(100 + i));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor maicena' }, admin(A));
    expect(r.resultados).toHaveLength(3);
    expect(r.cursor).toBeNull();
  });

  it('varias palabras: si la página se llena a mitad de un lote, el cursor es el último DEVUELTO (nada se salta)', async () => {
    // De más nuevo a más viejo: lote 1 = 10 buenos + 10 solo «alfajor»; lote 2 = 10 buenos (con ellos van 20),
    // 5 buenos más y 5 solo «alfajor». La página 1 se llena en el mensaje 30 y los 5 buenos restantes deben llegar en la página 2.
    const orden = [...Array(10).fill('b'), ...Array(10).fill('n'), ...Array(10).fill('b'), ...Array(5).fill('b'), ...Array(5).fill('n')];
    const buenos: string[] = [];
    for (const [i, tipo] of orden.entries()) {
      const id = await mensaje(A, TEL1, tipo === 'b' ? `alfajor maicena ${i}` : `alfajor solo ${i}`, reciente(1000 - i));
      if (tipo === 'b') buenos.push(id);
    }
    const p1 = await salidaDe({ tenantId: A, texto: 'alfajor maicena' }, admin(A));
    expect(p1.resultados).toHaveLength(20);
    const p2 = await salidaDe({ tenantId: A, texto: 'alfajor maicena', cursor: p1.cursor }, admin(A));
    expect(p2.resultados).toHaveLength(5);
    expect([...p1.resultados, ...p2.resultados].map((r) => r.mensajeId)).toEqual(buenos);
  });

  it('varias palabras: si tras 3 lotes no se llegó al final, el cursor es el último LEÍDO y la página siguiente sigue de ahí', async () => {
    for (let i = 0; i < 2; i++) await mensaje(A, TEL1, `alfajor maicena ${i}`, reciente(i));
    for (let i = 0; i < 70; i++) await mensaje(A, TEL2, `alfajor solo ${i}`, reciente(100 + i));
    const p1 = await salidaDe({ tenantId: A, texto: 'alfajor maicena' }, admin(A));
    expect(p1.resultados).toEqual([]);
    expect(p1.cursor).not.toBeNull();
    const p2 = await salidaDe({ tenantId: A, texto: 'alfajor maicena', cursor: p1.cursor }, admin(A));
    expect(p2.resultados.map((x) => x.fragmento).sort()).toEqual(['alfajor maicena 0', 'alfajor maicena 1']);
    expect(p2.cursor).toBeNull();
  });
});

// ===========================================================================
describe('la salida no entrega el texto completo', () => {
  it('un mensaje largo sale como fragmento (≤ 120) alrededor de la palabra, sin la propiedad `texto`', async () => {
    const relleno = 'palabras de relleno que no importan para nada en esta conversación larga ';
    const largo = `${relleno.repeat(6)}el alfajor llegó roto ${relleno.repeat(6)}FINAL-DEL-MENSAJE`;
    expect(largo.length).toBeGreaterThan(800);
    await mensaje(A, TEL1, largo, reciente(1));
    const r = await salidaDe({ tenantId: A, texto: 'alfajor' }, admin(A));
    const x = r.resultados[0]!;
    expect(x.fragmento.length).toBeLessThanOrEqual(120);
    expect(x.fragmento).toContain('alfajor');
    expect(Object.keys(x).sort()).toEqual(['conversacionId', 'direccion', 'fragmento', 'mensajeId', 'telefono', 'ts']);
    const json = JSON.stringify(r);
    expect(json).not.toContain('FINAL-DEL-MENSAJE');
    expect(json.length).toBeLessThan(600);
  });
});

// ===========================================================================
describe('los registros: nunca el texto buscado', () => {
  const SECRETO = 'zanahoriasecreta';

  it('éxito, sin permiso, texto inválido, cursor inválido y sin sesión: ningún registro contiene el texto', async () => {
    await mensaje(A, TEL1, `compré ${SECRETO} ayer`, reciente(1));
    await salidaDe({ tenantId: A, texto: SECRETO }, admin(A));
    await rechazo(llamar({ tenantId: OTRO, texto: SECRETO }, admin(A)));
    await rechazo(llamar({ tenantId: A, texto: SECRETO, cursor: 'mal' }, admin(A)));
    await rechazo(llamar({ tenantId: A, texto: SECRETO }));
    await rechazo(llamar({ tenantId: '__proto__', texto: SECRETO }, admin(A)));
    await rechazo(llamar({ tenantId: A, texto: `${SECRETO} `.repeat(20) }, admin(A))); // 101 o más
    expect(registros.length).toBeGreaterThan(0);
    expect(registros.join('\n')).not.toContain(SECRETO);
    expect(registros.join('\n').toLowerCase()).not.toContain('zanahoria');
  });

  it('el registro de éxito trae solo comercio, uid, cantidad de palabras, resultados y código', async () => {
    await mensaje(A, TEL1, 'alfajor de maicena', reciente(1));
    await salidaDe({ tenantId: A, texto: 'alfajor maicena' }, admin(A));
    const lineas = registros.map((x) => JSON.parse(x.slice(x.indexOf('{'))) as Record<string, unknown>)
      .filter((l) => l['funcion'] === 'buscarConversaciones');
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toEqual({
      funcion: 'buscarConversaciones', codigo: 'ok', tenantId: A, uid: `u-admin-${A}`, palabras: 2, resultados: 1,
    });
    expect(registros.join('\n')).not.toContain('maicena');
  });

  it('un comercio con forma rara no se copia a los registros (no se escribe lo que cada cual quiera)', async () => {
    const raro = 'tienda-a\nINYECTADO={"x":1}';
    await rechazo(llamar({ tenantId: raro, texto: 'alfajor' }, admin(A)));
    expect(registros.join('\n')).not.toContain('INYECTADO');
  });

  it('la fuente nunca pasa el texto a `registrar` ni al logger', () => {
    const fuente = CODIGO('buscarConversaciones.ts');
    const sinCadenas = fuente.replace(/'[^'\n]*'/g, "''"); // 'texto' entre comillas es un rótulo, no la variable
    expect(sinCadenas).not.toMatch(/registrar\([^)]*\btexto\b/);
    expect(sinCadenas).not.toMatch(/registrar\([^)]*\bcrudo\b/);
    expect(fuente).not.toMatch(/console\./);
    expect(fuente.match(/logger\.\w+\(/g)).toEqual(['logger.info(', 'logger.warn(']);
  });
});

// ===========================================================================
describe('una falla de infraestructura es «no disponible», nunca un permiso', () => {
  const fallo = (texto = 'detalle interno con ruta tenants/tienda-a y zanahoriasecreta') => Object.assign(new Error(texto), { code: 14 });
  const refQueFalla = () => ({ get: () => Promise.reject(fallo()) }) as never;

  it('al leer la ficha del comercio: unavailable con el mensaje fijo, y el mensaje del error no sale a ningún lado', async () => {
    vi.spyOn(db, 'doc').mockImplementation(refQueFalla);
    const r = await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, admin(A)));
    expect(r).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect(registros.join('\n')).not.toContain('detalle interno');
    expect(registros.join('\n')).not.toContain('zanahoria');
    expect(registros.join('\n')).toContain('unavailable');
  });

  it('al leer la ventana de soporte: unavailable (no «sin permiso»)', async () => {
    vi.spyOn(db, 'doc').mockImplementation(refQueFalla);
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, propietario()))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
  });

  it('al consultar los mensajes (por ejemplo, el índice aún sin construir): unavailable', async () => {
    vi.spyOn(db, 'collectionGroup').mockImplementation(() => { throw Object.assign(new Error('The query requires an index'), { code: 9 }); });
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor' }, admin(A)))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect(registros.join('\n')).not.toContain('requires an index'); // solo el código
    expect(registros.join('\n')).toContain('error_9');
  });

  it('al leer el cursor: unavailable', async () => {
    await mensaje(A, TEL1, 'alfajor', reciente(1));
    const real = db.doc.bind(db);
    vi.spyOn(db, 'doc').mockImplementation(((ruta: string) => (ruta.includes('/mensajes/') ? refQueFalla() : real(ruta))) as never);
    expect(await rechazo(llamar({ tenantId: A, texto: 'alfajor', cursor: `wa_${TEL1}/${'a'.repeat(20)}` }, admin(A)))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
  });
});

// ===========================================================================
describe('el despliegue: opciones, índice y puertas', () => {
  it('opciones: región como las demás, hasta 5 instancias, ninguna mínima, sin App Check ni concurrencia propia', () => {
    const o = B.opcionesDeBuscarConversaciones();
    expect(o).toEqual({ region: REGION, maxInstances: 5 });
    expect(Object.hasOwn(o, 'minInstances')).toBe(false);
    expect(Object.hasOwn(o, 'enforceAppCheck')).toBe(false);
  });

  it('la callable exportada lleva esas opciones', () => {
    const e = (B.buscarConversaciones as unknown as { __endpoint: { region?: string[]; maxInstances?: number; minInstances?: number } }).__endpoint;
    expect(e.maxInstances).toBe(5);
    // Sin instancias mínimas: el SDK deja el valor sin fijar (un «reset»), nunca un número.
    expect(typeof e.minInstances).not.toBe('number');
    expect(e.region).toEqual([REGION]);
  });

  it('CONSULTA_PALABRAS: el índice COLLECTION_GROUP de mensajes (tenantId ASC, palabras CONTAINS, ts DESC) está declarado', () => {
    expect(B.CONSULTA_PALABRAS).toMatchObject({
      grupo: 'mensajes', igualdad: 'tenantId', contiene: 'palabras', orden: { campo: 'ts', direccion: 'desc' }, limite: 20,
    });
    const indices = JSON.parse(readFileSync(join(aqui, '..', '..', 'firestore.indexes.json'), 'utf8')) as {
      indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }> }>;
    };
    const hay = indices.indexes.some((i) => i.collectionGroup === B.CONSULTA_PALABRAS.grupo && i.queryScope === 'COLLECTION_GROUP'
      && JSON.stringify(i.fields) === JSON.stringify([
        { fieldPath: B.CONSULTA_PALABRAS.igualdad, order: 'ASCENDING' },
        { fieldPath: B.CONSULTA_PALABRAS.contiene, arrayConfig: 'CONTAINS' },
        { fieldPath: B.CONSULTA_PALABRAS.orden.campo, order: 'DESCENDING' },
      ]));
    expect(hay).toBe(true);
  });

  it('acceso.ts no usa cuentaVigenteDe ni Auth (D13) y la callable no se exporta aún desde index.ts', () => {
    expect(CODIGO('acceso.ts')).not.toMatch(/cuentaVigenteDe|getAuth|firebase-admin\/auth/);
    const index = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'index.ts'), 'utf8');
    expect(index).not.toMatch(/buscarConversaciones/); // la exporta H1-6, después de #439
  });

  it('las reglas siguen sin abrir los mensajes a una consulta de grupo', () => {
    const reglas = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
    expect(reglas).not.toMatch(/\{path=\*\*\}\/mensajes/);
  });
});
