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
      const c = cuentas.get(uid)!; c.customClaims = claims; c.escrituras++;
    },
    revokeRefreshTokens: async (uid: string) => { cuentas.get(uid)!.revocaciones++; },
  }),
}));

import { asignarRol } from '../../functions/src/core/seguridad/claims.ts';

const alta = (uid: string, t: Record<string, string>, v: number) =>
  cuentas.set(uid, { customClaims: { nc: { t, v } }, providerData: [{ providerId: 'password' }], revocaciones: 0, escrituras: 0 });

beforeEach(() => {
  cuentas.clear();
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
