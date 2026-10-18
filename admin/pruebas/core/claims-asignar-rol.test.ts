/**
 * `asignarRol(uid, tenant, null)` sobre un tenant que el usuario NO tiene no
 * debe tocar al usuario. Hallazgo de la Constructora: `quitarUsuario` no
 * comprobaba la pertenencia, y quitar un rol inexistente subía `nc.v` y revocaba
 * los refresh tokens: un administrador del comercio A le cerraba la sesión a un
 * usuario del comercio B.
 *
 * Auth es un doble en memoria inyectado con vi.mock: la lógica corre siempre,
 * sin emulador de Auth (en CI solo hay emulador de Firestore). Ninguna prueba
 * de este archivo depende del emulador de Auth.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bitacora: string[] = [];
let fallaRevocacion = 0;

interface Cuenta { customClaims?: Record<string, unknown>; providerData: Array<{ providerId: string }>; revocaciones: number; escrituras: number }
const cuentas = new Map<string, Cuenta>();

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUser: async (uid: string) => {
      const c = cuentas.get(uid);
      if (!c) throw new Error('no existe');
      return c;
    },
    setCustomUserClaims: async (uid: string, claims: Record<string, unknown>) => {
      const c = cuentas.get(uid)!; c.customClaims = claims; c.escrituras++; bitacora.push('set');
    },
    revokeRefreshTokens: async (uid: string) => {
      if (fallaRevocacion > 0) { fallaRevocacion--; throw new Error('revocación caída'); }
      cuentas.get(uid)!.revocaciones++; bitacora.push('revoke');
    },
  }),
}));

import { asignarRol } from '../../functions/src/core/seguridad/claims.ts';

const alta = (uid: string, t: Record<string, string>, v: number) =>
  cuentas.set(uid, { customClaims: { nc: { t, v } }, providerData: [{ providerId: 'password' }], revocaciones: 0, escrituras: 0 });

beforeEach(() => {
  cuentas.clear(); bitacora.length = 0; fallaRevocacion = 0;
  alta('ana-a', { comercioa: 'admin' }, 3);
  alta('beto-b', { comerciob: 'oper' }, 5);
});

describe('quitar un rol que no existe', () => {
  it('el admin de A no puede cerrarle la sesión a un usuario de B (ruta quitarUsuario)', async () => {
    // Lo mismo que hace quitarUsuario del comercio A con el uid de un usuario de B.
    const r = await asignarRol('beto-b', 'comercioa', null, { revocarSesiones: true });
    expect(r).toEqual({ cambio: false });
    const b = cuentas.get('beto-b')!;
    expect(b.revocaciones).toBe(0);
    expect(b.escrituras).toBe(0);
    expect(b.customClaims).toEqual({ nc: { t: { comerciob: 'oper' }, v: 5 } });
  });

  it('tampoco con el valor por defecto de revocación', async () => {
    expect(await asignarRol('beto-b', 'comercioa', null)).toEqual({ cambio: false });
    expect(cuentas.get('beto-b')!.revocaciones).toBe(0);
  });

  it('un usuario sin claims no se toca', async () => {
    cuentas.set('nuevo', { providerData: [], revocaciones: 0, escrituras: 0 });
    expect(await asignarRol('nuevo', 'comercioa', null, { revocarSesiones: true })).toEqual({ cambio: false });
    expect(cuentas.get('nuevo')!.escrituras).toBe(0);
    expect(cuentas.get('nuevo')!.revocaciones).toBe(0);
  });

  it('claves heredadas del prototipo no cuentan como pertenencia', async () => {
    expect(await asignarRol('beto-b', 'constructor', null)).toEqual({ cambio: false });
    expect(cuentas.get('beto-b')!.revocaciones).toBe(0);
  });
});

describe('lo que no cambia', () => {
  it('quitar un rol que sí existía sube nc.v, quita solo ese tenant y revoca', async () => {
    cuentas.get('beto-b')!.customClaims = { nc: { t: { comercioa: 'oper', comerciob: 'oper' }, v: 5 } };
    const r = await asignarRol('beto-b', 'comercioa', null, { revocarSesiones: true });
    expect(r).toEqual({ cambio: true });
    const b = cuentas.get('beto-b')!;
    expect(b.customClaims).toEqual({ nc: { t: { comerciob: 'oper' }, v: 6 } });
    expect(b.revocaciones).toBe(1);
  });

  it('asignar un rol no nulo sube nc.v y conserva los otros tenants', async () => {
    const r = await asignarRol('ana-a', 'comerciox', 'oper');
    expect(r).toEqual({ cambio: true });
    expect(cuentas.get('ana-a')!.customClaims).toEqual({ nc: { t: { comercioa: 'admin', comerciox: 'oper' }, v: 4 } });
    expect(cuentas.get('ana-a')!.revocaciones).toBe(0);
  });

  it('reasignar el mismo tenant con otro rol también cuenta como cambio', async () => {
    expect(await asignarRol('ana-a', 'comercioa', 'oper')).toEqual({ cambio: true });
    expect(cuentas.get('ana-a')!.customClaims).toEqual({ nc: { t: { comercioa: 'oper' }, v: 4 } });
  });
});

describe('más garantías', () => {
  it('el orden es primero set y después revoke', async () => {
    cuentas.get('beto-b')!.customClaims = { nc: { t: { comercioa: 'oper' }, v: 1 } };
    await asignarRol('beto-b', 'comercioa', null);
    expect(bitacora).toEqual(['set', 'revoke']);
  });

  it('quitar un rol existente revoca por defecto, sin pasar la opción', async () => {
    cuentas.get('beto-b')!.customClaims = { nc: { t: { comercioa: 'oper' }, v: 1 } };
    await asignarRol('beto-b', 'comercioa', null);
    expect(cuentas.get('beto-b')!.revocaciones).toBe(1);
  });

  it('asignar con revocarSesiones: true también revoca', async () => {
    await asignarRol('ana-a', 'comerciox', 'oper', { revocarSesiones: true });
    expect(cuentas.get('ana-a')!.revocaciones).toBe(1);
  });

  it('el tope de bytes de los claims sigue rechazando y no escribe', async () => {
    const muchos: Record<string, string> = {};
    for (let i = 0; i < 80; i++) muchos[`comercio${i}`] = 'admin';
    cuentas.get('ana-a')!.customClaims = { nc: { t: muchos, v: 1 } };
    await expect(asignarRol('ana-a', 'comerciozz', 'oper')).rejects.toThrow(/bytes/);
    expect(cuentas.get('ana-a')!.escrituras).toBe(0);
  });

  it.each([['string', 'admin'], ['null', null], ['array', ['a']], ['número', 7]])(
    'claim t corrupto (%s): nada que quitar, sin escribir',
    async (_n, t) => {
      cuentas.get('beto-b')!.customClaims = { nc: { t, v: 5 } };
      expect(await asignarRol('beto-b', 'comercioa', null, { revocarSesiones: true })).toEqual({ cambio: false });
      expect(cuentas.get('beto-b')!.escrituras).toBe(0);
      expect(cuentas.get('beto-b')!.revocaciones).toBe(0);
    },
  );

  it('«__proto__» como tenant pedido, sin clave propia, no es pertenencia', async () => {
    expect(await asignarRol('beto-b', '__proto__', null, { revocarSesiones: true })).toEqual({ cambio: false });
    expect(cuentas.get('beto-b')!.escrituras).toBe(0);
    expect(cuentas.get('beto-b')!.revocaciones).toBe(0);
  });

  // CASO LÍMITE DOCUMENTADO Y ACEPTADO (decisión de la coordinadora, PR #530).
  // Si setCustomUserClaims funciona y revokeRefreshTokens falla una vez, el
  // reintento ve que el tenant ya no está en `t` y devuelve { cambio: false }
  // sin revocar. Se acepta porque son dos llamadas sin transacción (ya era así),
  // el ID token vigente caduca en ~1 h de todos modos, el usuario ya no tiene el
  // rol en sus claims y las callables sensibles verifican el rol real.
  it('revocación caída una vez: el reintento no revoca (aceptado)', async () => {
    cuentas.get('beto-b')!.customClaims = { nc: { t: { comercioa: 'oper' }, v: 1 } };
    fallaRevocacion = 1;
    await expect(asignarRol('beto-b', 'comercioa', null)).rejects.toThrow(/revocación caída/);
    expect(cuentas.get('beto-b')!.customClaims).toEqual({ nc: { t: {}, v: 2 } });
    expect(await asignarRol('beto-b', 'comercioa', null)).toEqual({ cambio: false });
    expect(cuentas.get('beto-b')!.revocaciones).toBe(0);
  });
});
