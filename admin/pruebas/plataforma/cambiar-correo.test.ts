/**
 * `scripts/plataforma/cambiar-correo.mjs`: la decisión es pura (`cambiar-correo-logica.mjs`) y el texto del script se lee
 * para comprobar sus salvaguardas. Se prueba sobre todo NEGANDO. Los correos se arman al vuelo (saneo del repo público).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { enmascarar, planearCambioCorreo } from '../../scripts/plataforma/cambiar-correo-logica.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const RUTA = join(aqui, '..', '..', 'scripts', 'plataforma', 'cambiar-correo.mjs');
const SCRIPT = readFileSync(RUTA, 'utf8');
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const correo = (u: string) => [u, 'ejemplo.test'].join('@');

const USUARIO = { uid: 'u1', email: correo('viejo'), proveedores: ['password'], ultimoIngreso: null, claims: { 'rroca-antonio': 'admin', 'rroca-emma': 'admin' } };
const MIEMBROS = [
  { tenant: 'rroca-antonio', existe: true, correo: correo('viejo') },
  { tenant: 'rroca-emma', existe: true, correo: correo('viejo') },
];
const planear = (o: Record<string, unknown> = {}) =>
  planearCambioCorreo({ usuario: USUARIO, nuevo: correo('nuevo'), miembros: MIEMBROS, ...o } as never) as Record<string, any>;

describe('cambiar-correo: lo que sí hace', () => {
  it('cambia Auth y las dos membresías de la misma cuenta', () => {
    const p = planear();
    expect(p.error).toBeUndefined();
    expect(p.haceAuth).toBe(true);
    expect(p.miembros).toEqual(['rroca-antonio', 'rroca-emma']);
    expect(p.uid).toBe('u1');
  });
  it('normaliza el correo nuevo a minúsculas', () => {
    expect(planear({ nuevo: correo('NUEVO') }).nuevo).toBe(correo('nuevo'));
  });
  it('reanuda: si Auth ya tiene el correo nuevo, solo completa las membresías pendientes', () => {
    const p = planear({ usuario: { ...USUARIO, email: correo('nuevo'), ultimoIngreso: 'ayer' }, miembros: [MIEMBROS[0], { ...MIEMBROS[1], correo: correo('nuevo') }] });
    expect(p.haceAuth).toBe(false);
    expect(p.miembros).toEqual(['rroca-antonio']);
  });
  it('sin cambios si todo ya está así', () => {
    const p = planear({ usuario: { ...USUARIO, email: correo('nuevo') }, miembros: MIEMBROS.map((m) => ({ ...m, correo: correo('nuevo') })) });
    expect(p.sinCambios).toBe(true);
  });
});

describe('cambiar-correo: lo que NO debe hacer', () => {
  it('NEGACIÓN: rechaza un correo nuevo que ya es de OTRA cuenta', () => {
    expect(planear({ uidDelNuevo: 'otra' }).error).toContain('otra cuenta');
  });
  it('NEGACIÓN: rechaza un valor que no es correo', () => {
    expect(planear({ nuevo: 'no-es-correo' }).error).toContain('no es un correo');
  });
  it('NEGACIÓN: rechaza una cuenta que ya ingresó, salvo que se pida a propósito', () => {
    const u = { ...USUARIO, ultimoIngreso: 'ayer' };
    expect(planear({ usuario: u }).error).toContain('ya ingresó');
    expect(planear({ usuario: u, permitirIngresada: true }).error).toBeUndefined();
  });
  it('NEGACIÓN: rechaza una cuenta con Google u otro proveedor', () => {
    expect(planear({ usuario: { ...USUARIO, proveedores: ['google.com', 'password'] } }).error).toContain('proveedor');
  });
  it('NEGACIÓN: no toca cuentas con acceso a Bellido o Platinum', () => {
    for (const t of ['bellido', 'platinum2']) {
      const u = { ...USUARIO, claims: { ...USUARIO.claims, [t]: 'admin' } };
      expect(planear({ usuario: u, miembros: [...MIEMBROS, { tenant: t, existe: true, correo: correo('viejo') }] }).error).toContain('no se toca');
    }
  });
  it('NEGACIÓN: rechaza una cuenta sin comercios o con una membresía que falta', () => {
    expect(planear({ usuario: { ...USUARIO, claims: {} } }).error).toContain('ningún comercio');
    expect(planear({ miembros: [MIEMBROS[0]] }).error).toContain('falta la membresía en rroca-emma');
  });
  it('NEGACIÓN: una cuenta inexistente se rechaza', () => {
    expect(planear({ usuario: null }).error).toContain('no existe');
  });
  it('el correo se enmascara', () => {
    expect(enmascarar(correo('viejo'))).not.toContain('viejo');
    expect(enmascarar(undefined)).toBe('(sin correo)');
  });
});

describe('cambiar-correo: el texto del script', () => {
  const s = sinComentarios(SCRIPT);
  it('es seco por omisión: Auth y Firestore se escriben después de `if (!APLICAR`', () => {
    const corte = s.indexOf('if (!APLICAR');
    expect(corte).toBeGreaterThan(-1);
    for (const w of ['updateUser', 'revokeRefreshTokens', 'lote.commit', 'lote.update', 'lote.create']) {
      expect(s.indexOf(w)).toBeGreaterThan(corte);
    }
  });
  it('NEGACIÓN: rechaza una cuenta deshabilitada o con segundo factor', () => {
    expect(planear({ usuario: { ...USUARIO, deshabilitada: true } }).error).toContain('deshabilitada');
    expect(planear({ usuario: { ...USUARIO, conSegundoFactor: true } }).error).toContain('segundo factor');
  });
  it('NEGACIÓN: Bellido y Platinum se excluyen aunque no estén al principio del nombre', () => {
    const u = { ...USUARIO, claims: { 'clinica-bellido': 'admin' } };
    expect(planear({ usuario: u, miembros: [{ tenant: 'clinica-bellido', existe: true, correo: correo('viejo') }] }).error).toContain('no se toca');
  });
  it('invalida la contraseña anterior y revoca sesiones también al reanudar', () => {
    expect(s).toMatch(/password: randomBytes/);
    expect(s.indexOf('revokeRefreshTokens')).toBeGreaterThan(s.indexOf('}\n  await auth.revoke') - 1);
    expect(s).toContain('correoNuevo: plan.nuevo');
  });
  it('--revertir solo confía en una auditoría de la misma cuenta que lleva al correo actual', () => {
    expect(s).toContain("d.get('uidAfectado') === uid");
    expect(s).toContain("d.get('correoNuevo')");
  });
  it('pone emailVerified en false, no borra nada y deja auditoría', () => {
    expect(s).toContain('emailVerified: false');
    expect(s).not.toMatch(/\.delete\(|deleteUser/);
    expect(s).toContain("accion: 'cambiar_correo'");
  });
  it('solo imprime correos enmascarados', () => {
    const logs = s.split('\n').filter((l) => /console\.(log|error)/.test(l) && /(NUEVO|anterior|u\.email|v\.email|plan\.nuevo)/.test(l));
    for (const l of logs) expect(l).toMatch(/enmascarar/);
  });
  it('los comercios excluidos salen con código 2 antes de abrir Firebase', () => {
    for (const tenant of ['bellido', 'platinum-x']) {
      const r = spawnSync('node', [RUTA, '--proyecto', 'p', '--operador', correo('operador'), '--tenant', tenant, '--a', correo('nuevo')], { encoding: 'utf8', env: entornoDelEmulador() });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('no se toca desde este script');
    }
  });
  it('exige --a o --revertir, uno solo', () => {
    const r = spawnSync('node', [RUTA, '--proyecto', 'p', '--operador', correo('operador'), '--tenant', 'rroca-antonio'], { encoding: 'utf8', env: entornoDelEmulador() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--revertir');
  });
});
