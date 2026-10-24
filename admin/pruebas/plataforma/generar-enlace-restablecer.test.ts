/**
 * `generar-enlace-restablecer.mjs`: la decisión es pura y el texto del script se lee para comprobar que el enlace nunca
 * existe como variable ni sale por la salida. Se prueba negando.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { motivoSiNoSePuede } from '../../scripts/plataforma/generar-enlace-restablecer-logica.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const RUTA = join(aqui, '..', '..', 'scripts', 'plataforma', 'generar-enlace-restablecer.mjs');
const s = readFileSync(RUTA, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const correo = (u: string) => [u, 'ejemplo.test'].join('@');

const BASE = {
  tenant: 'rroca-ruben', ficha: { flujos: ['venta'] },
  usuario: { deshabilitada: false, conSegundoFactor: false, proveedores: ['password'], claims: { 'rroca-ruben': 'admin' } },
  miembro: { estado: 'activo', rol: 'admin' },
};
const motivo = (o: Record<string, unknown> = {}) => motivoSiNoSePuede({ ...BASE, ...o } as never);

describe('generar-enlace-restablecer: cuándo se puede', () => {
  it('una cuenta de contraseña, con rol y membresía activa, sí', () => expect(motivo()).toBeNull());
  it('NEGACIÓN: no crea cuentas', () => expect(motivo({ usuario: null })).toContain('no crea cuentas'));
  it('NEGACIÓN: comercio inexistente, Bellido y Platinum', () => {
    expect(motivo({ ficha: null })).toContain('no existe');
    for (const t of ['bellido', 'clinica-platinum']) expect(motivo({ tenant: t })).toContain('no se toca');
  });
  it('NEGACIÓN: Google, deshabilitada o segundo factor', () => {
    expect(motivo({ usuario: { ...BASE.usuario, proveedores: ['google.com'] } })).toContain('proveedor');
    expect(motivo({ usuario: { ...BASE.usuario, deshabilitada: true } })).toContain('deshabilitada');
    expect(motivo({ usuario: { ...BASE.usuario, conSegundoFactor: true } })).toContain('segundo factor');
  });
  it('NEGACIÓN: propietario de la plataforma y rol de la membresía que no coincide', () => {
    expect(motivo({ usuario: { ...BASE.usuario, propietario: true } })).toContain('propietaria');
    expect(motivo({ miembro: { estado: 'activo', rol: 'oper' } })).toContain('no coincide');
  });
  it('NEGACIÓN: sin rol en ese comercio o membresía que no está activa', () => {
    expect(motivo({ usuario: { ...BASE.usuario, claims: { otro: 'admin' } } })).toContain('no tiene rol');
    expect(motivo({ miembro: { estado: 'baja', rol: 'admin' } })).toContain('miembro activo');
    expect(motivo({ miembro: null })).toContain('miembro activo');
  });
});

describe('generar-enlace-restablecer: el texto del script', () => {
  it('el enlace lo pide y lo escribe el módulo privado: el script no lo genera ni lo guarda', () => {
    expect(s).toContain('guardarEnlaceDeContrasena');
    expect(s).not.toContain('generatePasswordResetLink');
  });
  it('es seco por omisión: el enlace se pide después de `if (!APLICAR`', () => {
    expect(s.indexOf('guardarEnlaceDeContrasena({')).toBeGreaterThan(s.indexOf('if (!APLICAR'));
  });
  it('no escribe en los datos y no imprime correos completos', () => {
    expect(s).not.toMatch(/\.(set|update|create|delete)\(/);
    const logs = s.split('\n').filter((l) => /console\.(log|error)/.test(l) && /CORREO/.test(l));
    for (const l of logs) expect(l).toMatch(/enmascarar/);
    expect(s.split('\n').filter((l) => /console\./.test(l) && /(u\.email\b|\be\b\)|\$\{e\})/.test(l))).toEqual([]);
  });
  it('Bellido y Platinum salen con código 2 antes de abrir Firebase', () => {
    const r = spawnSync('node', [RUTA, '--proyecto', 'p', '--tenant', 'bellido', '--correo', correo('a')], { encoding: 'utf8', env: entornoDelEmulador() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no se toca desde este script');
  });
});
