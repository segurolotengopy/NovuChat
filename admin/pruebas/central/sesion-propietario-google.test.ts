/**
 * El claim de propietario solo vale con sesión de Google (igual que `esPropietario` en firestore.rules).
 * Con contraseña la consola trata a la persona como admin/oper normal de sus comercios.
 */
import { describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import { leerPermisos } from '../../web/src/core/lib/sesion';
import { puedeGestionarConversaciones } from '../../web/src/central/lib/conversaciones';

const usuario = (nc: unknown, signInProvider: string | null): User =>
  ({ getIdTokenResult: async () => ({ claims: { nc }, signInProvider }) }) as unknown as User;

const nc = { p: true, t: { acme: 'admin', otro: 'oper' }, v: 3 };

describe('propietario efectivo según el proveedor de la sesión', () => {
  it('p:true con contraseña: no es propietario y conserva sus roles', async () => {
    const r = await leerPermisos(usuario(nc, 'password'));
    expect(r.propietario).toBe(false);
    expect(r.tenants).toEqual({ acme: 'admin', otro: 'oper' });
    expect(r.version).toBe(3);
    expect(puedeGestionarConversaciones(r.tenants['acme']!, r.propietario)).toBe(true);
  });
  it('p:true con Google: es propietario y no gestiona conversaciones', async () => {
    const r = await leerPermisos(usuario(nc, 'google.com'));
    expect(r.propietario).toBe(true);
    expect(r.tenants).toEqual({ acme: 'admin', otro: 'oper' });
    expect(puedeGestionarConversaciones(r.tenants['acme']!, r.propietario)).toBe(false);
  });
  it('p ausente o falso: nunca propietario, con cualquier proveedor', async () => {
    for (const prov of ['google.com', 'password', null, 'github.com']) {
      expect((await leerPermisos(usuario({ t: {}, v: 1 }, prov))).propietario).toBe(false);
      expect((await leerPermisos(usuario({ p: false, t: {}, v: 1 }, prov))).propietario).toBe(false);
    }
  });
  it('p:true con proveedor nulo u otro: no es propietario', async () => {
    for (const prov of [null, 'github.com', 'phone', 'custom']) {
      expect((await leerPermisos(usuario(nc, prov))).propietario).toBe(false);
    }
  });
});
