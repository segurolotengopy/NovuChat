/**
 * `quitar-miembro-visualizacion.mjs`: borra la fila del espejo de miembros solo si está en baja. Núcleo puro con io falso. Se prueba NEGANDO.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { comprobarRespaldo, motivoParaSaltar, quitar, restituir } from '../../scripts/plataforma/quitar-miembro-visualizacion.mjs';

const UID = 'uid-de-prueba';
const mundo = (filas: Record<string, any>) => {
  const borradas: string[] = [];
  const respaldos: any[] = [];
  const auditadas: string[] = [];
  return {
    borradas, respaldos, auditadas,
    io: {
      leer: async (t: string) => filas[t] ?? { miembro: null, claimRol: null, titularUid: null },
      respaldar: async (f: any) => { respaldos.push(f); },
      borrar: async (t: string) => { borradas.push(t); },
      auditar: async (t: string) => { auditadas.push(t); },
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
    expect(m.auditadas).toEqual(['a']);
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
  it('restituir NIEGA uid ajeno, comercio inválido, fila no en baja, comercio inexistente y fila ya existente', async () => {
    const creadas: string[] = [];
    const io = (ficha = true, fila = false) => ({ fichaExiste: async () => ficha, filaExiste: async () => fila, crear: async (t: string) => { creadas.push(t); } });
    const ok = { tenant: 'aaa', datos: { estado: 'baja' } };
    expect((await restituir({ uidRespaldo: 'x', uid: UID, filas: [ok], aplicar: true, io: io() })).codigo).toBe(1);
    expect((await restituir({ uidRespaldo: UID, uid: UID, filas: [{ tenant: '../x', datos: { estado: 'baja' } }], aplicar: true, io: io() })).codigo).toBe(1);
    expect((await restituir({ uidRespaldo: UID, uid: UID, filas: [{ tenant: 'aaa', datos: { estado: 'activo' } }], aplicar: true, io: io() })).codigo).toBe(1);
    expect((await restituir({ uidRespaldo: UID, uid: UID, filas: [ok], aplicar: true, io: io(false) })).codigo).toBe(1);
    expect((await restituir({ uidRespaldo: UID, uid: UID, filas: [ok], aplicar: true, io: io(true, true) })).codigo).toBe(1);
    expect(creadas).toHaveLength(0);
    expect((await restituir({ uidRespaldo: UID, uid: UID, filas: [ok], aplicar: false, io: io() })).codigo).toBe(0);
    expect(creadas).toHaveLength(0);
    expect((await restituir({ uidRespaldo: UID, uid: UID, filas: [ok], aplicar: true, io: io() })).codigo).toBe(0);
    expect(creadas).toEqual(['aaa']);
  });
  it('el script no toca Auth ni claims ni imprime el correo', () => {
    const f = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/plataforma/quitar-miembro-visualizacion.mjs'), 'utf8');
    expect(f).not.toMatch(/deleteUser|setCustomUserClaims|revokeRefreshTokens|createUser|updateUser/);
    expect(f).not.toMatch(/\$\{correo\}/);
  });
});
