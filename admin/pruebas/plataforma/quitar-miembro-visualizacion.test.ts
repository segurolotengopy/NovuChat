/**
 * `quitar-miembro-visualizacion.mjs`: borra la fila del espejo de miembros solo si está en baja. Núcleo puro con io falso. Se prueba NEGANDO.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { comprobarRespaldo, motivoParaSaltar, quitar } from '../../scripts/plataforma/quitar-miembro-visualizacion.mjs';

const UID = 'uid-de-prueba';
const mundo = (filas: Record<string, any>) => {
  const borradas: string[] = [];
  const respaldos: any[] = [];
  return {
    borradas, respaldos,
    io: {
      leer: async (t: string) => filas[t] ?? { miembro: null, claimRol: null, titularUid: null },
      respaldar: async (f: any) => { respaldos.push(f); },
      borrar: async (t: string) => { borradas.push(t); },
    },
  };
};
const baja = { miembro: { estado: 'baja', rol: 'admin' }, claimRol: null, titularUid: 'otro' };

describe('quitar-miembro-visualizacion', () => {
  it('en seco no borra ni respalda', async () => {
    const m = mundo({ a: baja });
    const r = await quitar({ uid: UID, tenants: ['a'], aplicar: false, io: m.io });
    expect(r.filas).toHaveLength(1);
    expect(m.borradas).toHaveLength(0);
    expect(m.respaldos).toHaveLength(0);
  });
  it('con --aplicar respalda antes de borrar y borra solo lo nombrado', async () => {
    const m = mundo({ a: baja, b: baja });
    const r = await quitar({ uid: UID, tenants: ['a'], aplicar: true, io: m.io });
    expect(r.codigo).toBe(0);
    expect(m.borradas).toEqual(['a']);
    expect(m.respaldos).toHaveLength(1);
  });
  it('NIEGA una fila activa, con claim vigente, de la titular o inexistente', async () => {
    const m = mundo({
      activa: { miembro: { estado: 'activo' }, claimRol: null, titularUid: null },
      claim: { miembro: { estado: 'baja' }, claimRol: 'admin', titularUid: null },
      titular: { miembro: { estado: 'baja' }, claimRol: null, titularUid: UID },
    });
    const r = await quitar({ uid: UID, tenants: ['activa', 'claim', 'titular', 'nada'], aplicar: true, io: m.io });
    expect(r.codigo).toBe(1);
    expect(r.saltados).toHaveLength(4);
    expect(m.borradas).toHaveLength(0);
    expect(m.respaldos).toHaveLength(0);
  });
  it('motivoParaSaltar es vacío solo si todo cuadra', () => {
    expect(motivoParaSaltar({ miembro: baja.miembro, claimRol: null, titularUid: 'x', uid: UID })).toBe('');
    expect(motivoParaSaltar({ miembro: { estado: 'revocado' }, claimRol: null, titularUid: null, uid: UID })).not.toBe('');
  });
  it('el respaldo debe ser absoluto, fuera de un repositorio y nuevo', () => {
    expect(comprobarRespaldo('relativo/x.json')).not.toBe('');
    expect(comprobarRespaldo('/r/x/y.json', { existe: (p: string) => p === '/r/.git', stat: () => ({ mode: 0o40700 }) })).toMatch(/repositorio/);
    expect(comprobarRespaldo('/r/y.json', { existe: (p: string) => p === '/r/y.json', stat: () => ({ mode: 0o40700 }) })).toMatch(/existe/);
    expect(comprobarRespaldo('/r/y.json', { existe: (p: string) => p === '/r', stat: () => ({ mode: 0o40755 }) })).toMatch(/0700/);
    expect(comprobarRespaldo('/r/y.json', { existe: (p: string) => p === '/r', stat: () => ({ mode: 0o40700 }) })).toBe('');
  });
  it('el script no toca Auth ni claims ni imprime el correo', () => {
    const f = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/plataforma/quitar-miembro-visualizacion.mjs'), 'utf8');
    expect(f).not.toMatch(/deleteUser|setCustomUserClaims|revokeRefreshTokens|createUser|updateUser/);
    expect(f).not.toMatch(/\$\{correo\}/);
  });
});
