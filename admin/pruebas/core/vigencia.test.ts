/**
 * VIGENCIA (`core/seguridad/vigencia.ts`): lo que el token no sabe.
 *
 * - `soporteVigenteDe` contra el emulador de Firestore: es el espejo de
 *   `soporteVigente()` en `firestore.rules` (l.317-322) y se prueba NEGANDO.
 * - `cuentaVigenteDe` con el lector inyectado: NO hay emulador de Auth en las
 *   pruebas, así que la cuenta de Auth se simula con una función.
 *
 * Cada `it` niega una guarda; el comentario dice cuál es.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { soporteVigenteDe, cuentaVigenteDe } = await import('../../functions/src/core/seguridad/vigencia.ts');
type CuentaLeida = import('../../functions/src/core/seguridad/vigencia.ts').CuentaLeida;

const A = 'vigencia-a';
const B = 'vigencia-b';
const UID = 'propietario-1';
const OTRO_UID = 'propietario-2';
const AHORA = Date.UTC(2026, 9, 9, 15, 0, 0);

interface Opciones {
  uid?: string | null;
  nc?: unknown;
  proveedor?: unknown;
}

/** Una petición con la forma que deja Firebase tras verificar el ID token. */
function peticion(o: Opciones = {}): CallableRequest {
  // `in` y no un valor por defecto: `nc: undefined` debe poder pasarse a propósito.
  const uid = 'uid' in o ? o.uid : UID;
  const nc = 'nc' in o ? o.nc : { p: true };
  const proveedor = 'proveedor' in o ? o.proveedor : 'google.com';
  return {
    data: {},
    rawRequest: {},
    auth: uid === null ? undefined : {
      uid,
      token: { nc, firebase: { sign_in_provider: proveedor }, email_verified: true },
    },
  } as unknown as CallableRequest;
}

const rutaDe = (t: string, uid: string) => `tenants/${t}/accesosSoporte/${uid}`;
const concederA = (t: string, uid: string, expira: unknown) => db.doc(rutaDe(t, uid)).set({ expira, otorgadoPor: 'admin-x' });

async function limpiar() {
  for (const t of [A, B]) {
    for (const uid of [UID, OTRO_UID]) await db.doc(rutaDe(t, uid)).delete();
  }
}

describe('soporteVigenteDe (emulador de Firestore)', () => {
  beforeAll(limpiar);
  beforeEach(limpiar);
  afterAll(limpiar);

  it('con una ventana vigente en ESE comercio: verdadero (el único caso)', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA + 3_600_000));
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(true);
  });

  it('sin documento de soporte: falso', async () => {
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(false);
  });

  it('ventana vencida: falso', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA - 1));
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(false);
  });

  it('vence justo ahora: falso (la comparación es estricta, como `>` en las reglas)', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA));
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(false);
  });

  it('documento SIN `expira`: falso', async () => {
    await db.doc(rutaDe(A, UID)).set({ otorgadoPor: 'admin-x' });
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(false);
  });

  it('`expira` que no es un Timestamp (número, texto, fecha como texto, nulo): falso', async () => {
    for (const malo of [AHORA + 3_600_000, '2099-01-01T00:00:00Z', null, true, { seconds: 4_000_000_000 }]) {
      await concederA(A, UID, malo);
      expect(await soporteVigenteDe(peticion(), A, AHORA), `expira=${JSON.stringify(malo)}`).toBe(false);
    }
  });

  it('ventana REVOCADA (el documento se borra): falso', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA + 3_600_000));
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(true);
    await db.doc(rutaDe(A, UID)).delete();
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(false);
  });

  it('ventana vigente en OTRO comercio: falso (aislamiento por comercio)', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA + 3_600_000));
    expect(await soporteVigenteDe(peticion(), B, AHORA)).toBe(false);
  });

  it('ventana vigente de OTRO propietario: falso', async () => {
    await concederA(A, OTRO_UID, Timestamp.fromMillis(AHORA + 3_600_000));
    expect(await soporteVigenteDe(peticion(), A, AHORA)).toBe(false);
  });

  it('sesión de contraseña con el claim de propietario (cuenta incoherente): falso', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA + 3_600_000));
    expect(await soporteVigenteDe(peticion({ proveedor: 'password' }), A, AHORA)).toBe(false);
  });

  it('sesión de Google SIN el claim de propietario: falso', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA + 3_600_000));
    expect(await soporteVigenteDe(peticion({ nc: { t: { [A]: 'admin' } } }), A, AHORA)).toBe(false);
    expect(await soporteVigenteDe(peticion({ nc: { p: false } }), A, AHORA)).toBe(false);
    expect(await soporteVigenteDe(peticion({ nc: undefined }), A, AHORA)).toBe(false);
  });

  it('un administrador del comercio con ventana a su nombre: falso (no es propietario)', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA + 3_600_000));
    const adm = peticion({ nc: { t: { [A]: 'admin' } }, proveedor: 'password' });
    expect(await soporteVigenteDe(adm, A, AHORA)).toBe(false);
  });

  it('sin sesión: falso', async () => {
    expect(await soporteVigenteDe(peticion({ uid: null }), A, AHORA)).toBe(false);
  });

  it("comercio con forma inválida o reservada ('a/b', '..', '', 61 caracteres, '__proto__'): falso y sin lanzar", async () => {
    for (const malo of ['a/b', '..', '', 'x'.repeat(61), '__proto__', 'a b', 'a.b']) {
      expect(await soporteVigenteDe(peticion(), malo, AHORA), `t=${malo}`).toBe(false);
    }
  });

  it("uid con forma inválida ('a/b', ''): falso", async () => {
    expect(await soporteVigenteDe(peticion({ uid: 'a/b' }), A, AHORA)).toBe(false);
    expect(await soporteVigenteDe(peticion({ uid: '' }), A, AHORA)).toBe(false);
  });

  it('hora no finita: falso', async () => {
    await concederA(A, UID, Timestamp.fromMillis(AHORA + 3_600_000));
    expect(await soporteVigenteDe(peticion(), A, Number.NaN)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// cuentaVigenteDe, con el lector inyectado
// -----------------------------------------------------------------------------

const AUTH_TIME = 1_790_000_000;   // segundos
const ISO = (seg: number) => new Date(seg * 1000).toUTCString();

/** Una cuenta de Auth vigente para el rol dado; `cambios` la estropea. */
function cuenta(rol: 'admin' | 'oper' | 'soporte', cambios: Partial<CuentaLeida> = {}): CuentaLeida {
  const nc = rol === 'soporte' ? { p: true } : { t: { [A]: rol } };
  return { disabled: false, customClaims: { nc }, tokensValidAfterTime: ISO(AUTH_TIME - 100), ...cambios };
}

const lector = (c: CuentaLeida) => async () => c;
const lectorQueLanza = (e: unknown) => async (): Promise<CuentaLeida> => { throw e; };

describe('cuentaVigenteDe (lector inyectado)', () => {
  it('cuenta habilitada con el rol del token: verdadero, para admin, oper y soporte', async () => {
    for (const rol of ['admin', 'oper', 'soporte'] as const) {
      expect(await cuentaVigenteDe('u', AUTH_TIME, rol, A, lector(cuenta(rol))), rol).toBe(true);
    }
  });

  it('sin `tokensValidAfterTime`: verdadero (nunca se revocaron sesiones)', async () => {
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(cuenta('admin', { tokensValidAfterTime: undefined })))).toBe(true);
  });

  it('el lector recibe el uid pedido', async () => {
    const vistos: string[] = [];
    await cuentaVigenteDe('uid-pedido', AUTH_TIME, 'admin', A, async (u) => { vistos.push(u); return cuenta('admin'); });
    expect(vistos).toEqual(['uid-pedido']);
  });

  // --- la cuenta ----------------------------------------------------------------

  it('la cuenta ya no existe (auth/user-not-found): falso', async () => {
    const e = Object.assign(new Error('no existe'), { code: 'auth/user-not-found' });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lectorQueLanza(e))).toBe(false);
  });

  it('otro error de Auth (caído, cuota) SE PROPAGA: ni falso ni verdadero', async () => {
    const e = Object.assign(new Error('interno'), { code: 'auth/internal-error' });
    await expect(cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lectorQueLanza(e))).rejects.toBe(e);
    const sinCodigo = new Error('red');
    await expect(cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lectorQueLanza(sinCodigo))).rejects.toBe(sinCodigo);
  });

  it('cuenta DESHABILITADA: falso, para los tres roles', async () => {
    for (const rol of ['admin', 'oper', 'soporte'] as const) {
      expect(await cuentaVigenteDe('u', AUTH_TIME, rol, A, lector(cuenta(rol, { disabled: true }))), rol).toBe(false);
    }
  });

  it('`disabled` ausente o no booleano: falso (solo `false` pasa)', async () => {
    for (const raro of [undefined, null, 0, '', 'false']) {
      const c = cuenta('admin', { disabled: raro as unknown as boolean });
      expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(c)), String(raro)).toBe(false);
    }
  });

  // --- los claims ------------------------------------------------------------------

  it('claim RETIRADO según getUser: falso (admin y oper)', async () => {
    for (const rol of ['admin', 'oper'] as const) {
      expect(await cuentaVigenteDe('u', AUTH_TIME, rol, A, lector(cuenta(rol, { customClaims: { nc: { t: {} } } }))), rol).toBe(false);
      expect(await cuentaVigenteDe('u', AUTH_TIME, rol, A, lector(cuenta(rol, { customClaims: {} }))), rol).toBe(false);
      expect(await cuentaVigenteDe('u', AUTH_TIME, rol, A, lector(cuenta(rol, { customClaims: undefined }))), rol).toBe(false);
    }
  });

  it('el rol cambió (el token decía admin y ahora es oper, o al revés): falso', async () => {
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(cuenta('oper')))).toBe(false);
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'oper', A, lector(cuenta('admin')))).toBe(false);
  });

  it('el rol de la cuenta es otro valor (ingesta): falso', async () => {
    const c = cuenta('admin', { customClaims: { nc: { t: { [A]: 'ingesta' } } } });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(c))).toBe(false);
  });

  it('la cuenta tiene el rol en OTRO comercio, no en este: falso', async () => {
    const c = cuenta('admin', { customClaims: { nc: { t: { [B]: 'admin' } } } });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(c))).toBe(false);
  });

  it('el rol llega por la cadena de prototipos (no es clave propia): falso', async () => {
    const heredado = Object.create({ [A]: 'admin' }) as Record<string, string>;
    const c = cuenta('admin', { customClaims: { nc: { t: heredado } } });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(c))).toBe(false);
  });

  it("tenantId '__proto__' / 'constructor' contra claims sin esa clave: falso", async () => {
    for (const id of ['__proto__', 'constructor']) {
      expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', id, lector(cuenta('admin'))), id).toBe(false);
    }
  });

  it('rol soporte con `nc.p` retirado, falso o ausente: falso', async () => {
    for (const nc of [{ p: false }, {}, { t: { [A]: 'admin' } }, { p: 'true' }]) {
      const c = cuenta('soporte', { customClaims: { nc } });
      expect(await cuentaVigenteDe('u', AUTH_TIME, 'soporte', A, lector(c)), JSON.stringify(nc)).toBe(false);
    }
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'soporte', A, lector(cuenta('soporte', { customClaims: {} })))).toBe(false);
  });

  it('un administrador del comercio NO sirve como soporte, ni al revés', async () => {
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'soporte', A, lector(cuenta('admin')))).toBe(false);
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(cuenta('soporte')))).toBe(false);
  });

  // --- la sesión ---------------------------------------------------------------------

  it('`auth_time` anterior a `tokensValidAfterTime` (sesiones revocadas): falso', async () => {
    const c = cuenta('admin', { tokensValidAfterTime: ISO(AUTH_TIME + 1) });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(c))).toBe(false);
    const s = cuenta('soporte', { tokensValidAfterTime: ISO(AUTH_TIME + 3600) });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'soporte', A, lector(s))).toBe(false);
  });

  it('`auth_time` igual a `tokensValidAfterTime`: verdadero (no es anterior)', async () => {
    const c = cuenta('admin', { tokensValidAfterTime: ISO(AUTH_TIME) });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(c))).toBe(true);
  });

  it('`tokensValidAfterTime` ilegible: falso (fail-closed)', async () => {
    const c = cuenta('admin', { tokensValidAfterTime: 'no es una fecha' });
    expect(await cuentaVigenteDe('u', AUTH_TIME, 'admin', A, lector(c))).toBe(false);
  });

  it('`auth_time` ausente o no finito: falso, y ni siquiera se lee la cuenta', async () => {
    let lecturas = 0;
    const cuentan = async () => { lecturas++; return cuenta('admin'); };
    for (const raro of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '1790000000']) {
      expect(await cuentaVigenteDe('u', raro as unknown as number, 'admin', A, cuentan), String(raro)).toBe(false);
    }
    expect(lecturas).toBe(0);
  });
});
