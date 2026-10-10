/**
 * `esOperDe`: el operador de UN comercio, con contraseña y correo verificado.
 *
 * Espejo de `esOperador()` en `firestore.rules` (l.135-140). Se prueba NEGANDO:
 * el único caso verdadero es oper + password + correo verificado, en ese
 * comercio; todo lo demás debe ser falso. Es pura: no abre Firebase.
 */
import { describe, expect, it } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { esAdminDe, esOperDe } from '../../functions/src/core/seguridad/autorizacion.ts';

const T = 'comercio-uno';
const OTRO = 'comercio-dos';

interface Opciones {
  uid?: string | null;
  nc?: unknown;
  proveedor?: unknown;
  verificado?: unknown;
}

/** Una petición con la forma que deja Firebase tras verificar el ID token. */
function peticion(o: Opciones = {}): CallableRequest {
  // `in` y no un valor por defecto: `undefined` debe poder pasarse a propósito.
  const uid = 'uid' in o ? o.uid : 'u-1';
  const nc = 'nc' in o ? o.nc : { t: { [T]: 'oper' } };
  const proveedor = 'proveedor' in o ? o.proveedor : 'password';
  const verificado = 'verificado' in o ? o.verificado : true;
  return {
    data: {},
    rawRequest: {},
    auth: uid === null ? undefined : {
      uid,
      token: { nc, firebase: { sign_in_provider: proveedor }, email_verified: verificado },
    },
  } as unknown as CallableRequest;
}

describe('esOperDe: el único caso verdadero', () => {
  it('oper de ESE comercio, con contraseña y correo verificado', () => {
    expect(esOperDe(peticion(), T)).toBe(true);
  });
});

describe('esOperDe: todo lo demás es falso', () => {
  it('sin sesión', () => {
    expect(esOperDe(peticion({ uid: null }), T)).toBe(false);
  });

  it('uid vacío', () => {
    expect(esOperDe(peticion({ uid: '' }), T)).toBe(false);
  });

  it('sesión de Google (el rol oper exige contraseña)', () => {
    expect(esOperDe(peticion({ proveedor: 'google.com' }), T)).toBe(false);
  });

  it('sin proveedor en el token', () => {
    expect(esOperDe(peticion({ proveedor: undefined }), T)).toBe(false);
  });

  it('correo sin verificar', () => {
    expect(esOperDe(peticion({ verificado: false }), T)).toBe(false);
  });

  it('correo_verificado ausente o no booleano', () => {
    expect(esOperDe(peticion({ verificado: undefined }), T)).toBe(false);
    expect(esOperDe(peticion({ verificado: 'true' }), T)).toBe(false);
  });

  it('rol admin: no es operador, y el operador tampoco pasa por administrador', () => {
    expect(esOperDe(peticion({ nc: { t: { [T]: 'admin' } } }), T)).toBe(false);
    expect(esAdminDe(peticion(), T)).toBe(false);
  });

  it('rol ingesta', () => {
    expect(esOperDe(peticion({ nc: { t: { [T]: 'ingesta' } } }), T)).toBe(false);
  });

  it('operador de OTRO comercio', () => {
    expect(esOperDe(peticion({ nc: { t: { [OTRO]: 'oper' } } }), T)).toBe(false);
    expect(esOperDe(peticion(), OTRO)).toBe(false);
  });

  it('el propietario (nc.p) sin rol en el comercio', () => {
    expect(esOperDe(peticion({ nc: { p: true, t: {} }, proveedor: 'google.com' }), T)).toBe(false);
    expect(esOperDe(peticion({ nc: { p: true } }), T)).toBe(false);
  });

  it('sin claims de NovuChat o con forma rota', () => {
    expect(esOperDe(peticion({ nc: undefined }), T)).toBe(false);
    expect(esOperDe(peticion({ nc: 'oper' }), T)).toBe(false);
    expect(esOperDe(peticion({ nc: { t: 'oper' } }), T)).toBe(false);
    expect(esOperDe(peticion({ nc: { t: null } }), T)).toBe(false);
  });

  it("tenantId '__proto__', 'constructor' y similares no se resuelven por prototipo", () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(esOperDe(peticion(), id)).toBe(false);
    }
  });

  it('un rol heredado por la cadena de prototipos no cuenta (solo claves propias)', () => {
    // Un objeto cuyo prototipo trae el rol: sin `Object.hasOwn` pasaría.
    const heredado = Object.create({ [T]: 'oper' }) as Record<string, string>;
    expect(heredado[T]).toBe('oper');
    expect(esOperDe(peticion({ nc: { t: heredado } }), T)).toBe(false);
  });
});
