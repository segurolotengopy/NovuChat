/**
 * TITULAR: si la lectura de la ficha FALLA, la acción NO pasa (falla cerrado). Pura: se inyecta un
 * `titularDe` que lanza y se vigila que no se borre, revoque ni audite nada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tocados = vi.hoisted(() => ({ db: vi.fn(), asignarRol: vi.fn(), auditar: vi.fn(), set: vi.fn() }));

vi.mock('../../functions/src/central/titular.ts', async (orig) => ({
  ...(await orig<typeof import('../../functions/src/central/titular.ts')>()),
  titularDe: vi.fn(async () => { throw new Error('lectura fallida'); }),
}));
vi.mock('../../functions/src/central/comunes.ts', async (orig) => ({
  ...(await orig<typeof import('../../functions/src/central/comunes.ts')>()),
  db: tocados.db, auditar: tocados.auditar,
}));
vi.mock('../../functions/src/core/seguridad/claims.ts', () => ({ asignarRol: tocados.asignarRol }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ getUserByEmail: async () => ({ uid: 'TA', emailVerified: true }) }),
}));

const { quitarUsuario, invitarUsuario } = await import('../../functions/src/central/usuarios.ts');
const sesion = { uid: 'adminA', token: { nc: { t: { 'ti-a': 'admin' }, v: 1 }, firebase: { sign_in_provider: 'password' }, email_verified: true } };

describe('la lectura fallida de la ficha no deja pasar la accion', () => {
  beforeEach(() => { for (const f of Object.values(tocados)) f.mockClear(); });

  it('quitarUsuario rechaza y no borra, ni revoca, ni audita', async () => {
    await expect((quitarUsuario.run as (p: unknown) => Promise<unknown>)({
      data: { tenantId: 'ti-a', uid: 'TA' }, auth: sesion, rawRequest: {},
    })).rejects.toThrow();
    expect(tocados.db).not.toHaveBeenCalled();
    expect(tocados.asignarRol).not.toHaveBeenCalled();
    expect(tocados.auditar).not.toHaveBeenCalled();
  });

  it('invitarUsuario rechaza y no escribe ficha ni claims ni auditoria', async () => {
    await expect((invitarUsuario.run as (p: unknown) => Promise<unknown>)({
      data: { tenantId: 'ti-a', correo: `ta@${'prueba.invalid'}`, rol: 'oper' }, auth: sesion, rawRequest: {},
    })).rejects.toThrow();
    expect(tocados.db).not.toHaveBeenCalled();
    expect(tocados.asignarRol).not.toHaveBeenCalled();
    expect(tocados.auditar).not.toHaveBeenCalled();
  });
});
