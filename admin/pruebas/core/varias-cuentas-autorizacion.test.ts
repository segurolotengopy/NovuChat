/**
 * VARIAS CUENTAS, CALLABLES: la autorización por cuenta de `autorizacion.ts`.
 *
 * Las callables no pasan por `firestore.rules`: vuelven a decidir con los claims
 * del token. Con varias cuentas por persona (selector de cuentas, opción A) la
 * cuenta viene en cada petición, así que cada una se decide por separado.
 * PURA: construye el `CallableRequest` a mano, sin emulador.
 */
import { describe, expect, it } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  esAdminDe, esOperDe, exigirAdminDe, exigirAdminOPropietario,
} from '../../functions/src/core/seguridad/autorizacion.js';

function pedido(
  uid: string, tenants: Record<string, string>,
  o: { p?: boolean; proveedor?: string; verificado?: boolean } = {},
): CallableRequest {
  return {
    auth: {
      uid,
      token: {
        nc: { t: tenants, ...(o.p ? { p: true } : {}), v: 1 },
        firebase: { sign_in_provider: o.proveedor ?? 'password' },
        email_verified: o.verificado ?? true,
      },
    },
    data: {},
  } as unknown as CallableRequest;
}

const ruben = pedido('u-ruben', { r1: 'admin', r2: 'admin' });
const antonio = pedido('u-antonio', { a1: 'admin', a2: 'admin' });
const manager = pedido('u-manager', { r1: 'admin', r2: 'admin', a1: 'admin', a2: 'admin' });
const mixto = pedido('u-mixto', { r1: 'admin', r2: 'oper' });

const codigo = (f: () => unknown): string => {
  try { f(); } catch (e) { return (e as { code?: string }).code ?? 'otro'; }
  return 'paso';
};

describe('exigirAdminDe por cuenta', () => {
  it('Rubén pasa en las suyas y es rechazado en las de Antonio', () => {
    expect(codigo(() => exigirAdminDe(ruben, 'r1'))).toBe('paso');
    expect(codigo(() => exigirAdminDe(ruben, 'r2'))).toBe('paso');
    expect(codigo(() => exigirAdminDe(ruben, 'a1'))).toBe('permission-denied');
    expect(codigo(() => exigirAdminDe(ruben, 'a2'))).toBe('permission-denied');
  });
  it('Antonio, al revés', () => {
    expect(codigo(() => exigirAdminDe(antonio, 'a1'))).toBe('paso');
    expect(codigo(() => exigirAdminDe(antonio, 'r1'))).toBe('permission-denied');
    expect(codigo(() => exigirAdminDe(antonio, 'r2'))).toBe('permission-denied');
  });
  it('el manager pasa en las cuatro y no en un quinto', () => {
    for (const t of ['r1', 'r2', 'a1', 'a2']) expect(codigo(() => exigirAdminDe(manager, t))).toBe('paso');
    expect(codigo(() => exigirAdminDe(manager, 'c1'))).toBe('permission-denied');
  });
  it('sin sesión: unauthenticated', () => {
    expect(codigo(() => exigirAdminDe({ auth: undefined, data: {} } as unknown as CallableRequest, 'r1'))).toBe('unauthenticated');
  });
});

describe('admin en una cuenta y oper en otra', () => {
  it('admin en r1 no es admin en r2, donde solo es operador', () => {
    expect(esAdminDe(mixto, 'r1')).toBe(true);
    expect(esAdminDe(mixto, 'r2')).toBe(false);
    expect(esOperDe(mixto, 'r2')).toBe(true);
    expect(esOperDe(mixto, 'r1')).toBe(false);
    expect(codigo(() => exigirAdminDe(mixto, 'r2'))).toBe('permission-denied');
  });
  it('esOperDe no cruza entre personas', () => {
    const o = pedido('u-o', { r1: 'oper' });
    expect(esOperDe(o, 'r1')).toBe(true);
    expect(esOperDe(o, 'a1')).toBe(false);
    expect(esOperDe(o, 'r2')).toBe(false);
  });
});

describe('exigirAdminOPropietario', () => {
  it('el manager lanza sobre c1 y pasa sobre las suyas', () => {
    expect(codigo(() => exigirAdminOPropietario(manager, 'c1'))).toBe('permission-denied');
    expect(exigirAdminOPropietario(manager, 'a2')).toEqual({ uid: 'u-manager', quien: 'admin' });
  });
  it('Rubén lanza sobre a1', () => {
    expect(codigo(() => exigirAdminOPropietario(ruben, 'a1'))).toBe('permission-denied');
  });
  it('el propietario con Google pasa en cualquiera; con contraseña no', () => {
    const prop = pedido('u-n', {}, { p: true, proveedor: 'google.com' });
    expect(exigirAdminOPropietario(prop, 'c1').quien).toBe('propietario');
    const falso = pedido('u-n', {}, { p: true, proveedor: 'password' });
    expect(codigo(() => exigirAdminOPropietario(falso, 'c1'))).toBe('permission-denied');
  });
});

describe('ids hostiles: ninguno resuelve por prototipo ni por parecido', () => {
  const ids = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'R1', 'r1 ', ' r1', 'r1/x', 'r1/../a1', '', 'r', '*'];
  for (const id of ids) {
    it(`«${id}» no es admin ni oper de nadie`, () => {
      for (const p of [ruben, antonio, manager, mixto]) {
        expect(esAdminDe(p, id)).toBe(false);
        expect(esOperDe(p, id)).toBe(false);
        expect(codigo(() => exigirAdminDe(p, id))).toBe('permission-denied');
        expect(codigo(() => exigirAdminOPropietario(p, id))).toBe('permission-denied');
      }
    });
  }
  it('tipos que no son texto tampoco (salvo el arreglo de un elemento: ver abajo)', () => {
    for (const id of [undefined, null, 1, {}] as unknown[]) {
      expect(esAdminDe(ruben, id as string)).toBe(false);
      expect(esOperDe(mixto, id as string)).toBe(false);
    }
  });
  // Corregido en #540: esAdminDe exige tenantId de texto y clave propia.
  it('un tenantId que no es texto (arreglo de un elemento) no autoriza', () => {
    expect(esAdminDe(ruben, ['r1'] as unknown as string)).toBe(false);
  });
});

describe('el proveedor y el correo valen en cada cuenta', () => {
  const cuatro = { r1: 'admin', r2: 'admin', a1: 'admin', a2: 'admin' };
  it('Google o sin verificar: ninguna cuenta', () => {
    for (const p of [
      pedido('u', cuatro, { proveedor: 'google.com' }),
      pedido('u', cuatro, { verificado: false }),
      pedido('u', cuatro, { proveedor: 'custom' }),
    ]) {
      for (const t of ['r1', 'r2', 'a1', 'a2']) {
        expect(esAdminDe(p, t)).toBe(false);
        expect(esOperDe(p, t)).toBe(false);
      }
    }
  });
  it('un claim ingesta no autoriza a una persona (ni como admin ni como oper)', () => {
    const p = pedido('u', { r1: 'ingesta' });
    expect(esAdminDe(p, 'r1')).toBe(false);
    expect(esOperDe(p, 'r1')).toBe(false);
    expect(codigo(() => exigirAdminDe(p, 'r1'))).toBe('permission-denied');
  });
  it('un token sin claims nc no es nadie', () => {
    const p = { auth: { uid: 'u', token: { firebase: { sign_in_provider: 'password' }, email_verified: true } }, data: {} } as unknown as CallableRequest;
    expect(esAdminDe(p, 'r1')).toBe(false);
  });
});
