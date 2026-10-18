/**
 * LA CUENTA ACTIVA Y EL SELECTOR (PR-1 del selector de cuentas).
 *
 * Defiende: (1) la preferencia guardada es SOLO una preferencia: se descarta si
 * el id no está en los claims; (2) 0/1/varias cuentas; el propietario nunca ve
 * el selector; (3) `ingesta` no es una cuenta de persona; (4) el selector no
 * oculta cuentas ni habilita una dada de baja.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cuentasDe, destinoInicial, guardarUltima, leerUltima } from '../../web/src/core/lib/cuentaActiva';
import type { Permisos } from '../../web/src/core/lib/sesion';
import { ListaDeCuentas, type CuentaVista } from '../../web/src/central/componentes/ListaDeCuentas';

const aqui = dirname(fileURLToPath(import.meta.url));
const desdeWeb = createRequire(join(aqui, '..', '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p?: unknown, ...h: unknown[]) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { MemoryRouter } = desdeWeb('react-router-dom') as { MemoryRouter: unknown };

const permisos = (t: Record<string, 'admin' | 'oper' | 'ingesta'>, propietario = false): Permisos =>
  ({ propietario, tenants: t, version: 1 });

class Almacen {
  datos = new Map<string, string>();
  getItem(k: string) { return this.datos.has(k) ? this.datos.get(k)! : null; }
  setItem(k: string, v: string) { this.datos.set(k, v); }
}
const g = globalThis as { localStorage?: unknown };
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let almacen: Almacen;
beforeEach(() => { almacen = new Almacen(); Object.defineProperty(globalThis, 'localStorage', { value: almacen, configurable: true, writable: true }); });
afterEach(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete g.localStorage; });

describe('cuentasDe', () => {
  it('lista admin y oper, y excluye ingesta', () => {
    expect(cuentasDe(permisos({ a: 'admin', b: 'oper', c: 'ingesta' })).sort()).toEqual(['a', 'b']);
    expect(cuentasDe(permisos({ c: 'ingesta' }))).toEqual([]);
    expect(cuentasDe(permisos({}))).toEqual([]);
  });
});

describe('destinoInicial', () => {
  it('0 cuentas: ninguna; 1: directa; varias: selector', () => {
    expect(destinoInicial(permisos({}), null)).toEqual({ tipo: 'ninguna' });
    expect(destinoInicial(permisos({ a: 'oper' }), null)).toEqual({ tipo: 'directa', tenantId: 'a' });
    expect(destinoInicial(permisos({ a: 'admin', b: 'oper' }), 'b')).toEqual({ tipo: 'selector', ultima: 'b' });
  });
  it('con varias NUNCA entra sola a la última', () => {
    expect(destinoInicial(permisos({ a: 'admin', b: 'oper' }), 'a').tipo).toBe('selector');
  });
  it('una última ajena al token no se destaca', () => {
    expect(destinoInicial(permisos({ a: 'admin', b: 'oper' }), 'zzz')).toEqual({ tipo: 'selector', ultima: null });
  });
  it('una cuenta admin más una ingesta cuenta como UNA: entra directa', () => {
    expect(destinoInicial(permisos({ a: 'admin', m: 'ingesta' }), null)).toEqual({ tipo: 'directa', tenantId: 'a' });
  });
  it('el propietario nunca ve el selector, ni directa', () => {
    expect(destinoInicial(permisos({ a: 'admin', b: 'oper' }, true), 'a')).toEqual({ tipo: 'ninguna' });
    expect(destinoInicial(permisos({}, true), null)).toEqual({ tipo: 'ninguna' });
  });
});

describe('leerUltima / guardarUltima', () => {
  const p = permisos({ a: 'admin', b: 'oper', m: 'ingesta' });
  it('control positivo: lo guardado y vigente se lee', () => {
    guardarUltima('u1', 'b');
    expect(almacen.getItem('nc:ultimaCuenta:u1')).toBe('b');
    expect(leerUltima('u1', p)).toBe('b');
  });
  it('descarta una cuenta ajena, quitada, vacía o de rol ingesta', () => {
    for (const mala of ['ajena', 'b2', '', 'm']) {
      almacen.setItem('nc:ultimaCuenta:u1', mala);
      expect(leerUltima('u1', p), mala).toBeNull();
    }
    guardarUltima('u1', 'b');
    expect(leerUltima('u1', permisos({ a: 'admin' }))).toBeNull(); // quitada del token
  });
  it('es por usuario: otra persona del mismo navegador no hereda la preferencia', () => {
    guardarUltima('u1', 'b');
    expect(leerUltima('u2', p)).toBeNull();
  });
  it('un id con __proto__ o constructor no cuela', () => {
    for (const hostil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      almacen.setItem('nc:ultimaCuenta:u1', hostil);
      expect(leerUltima('u1', p), hostil).toBeNull();
    }
    expect(destinoInicial(p, '__proto__')).toEqual({ tipo: 'selector', ultima: null });
  });
  it('con el almacenamiento roto o lanzando no lanza y devuelve null', () => {
    const lanza = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('cuota'); } };
    Object.defineProperty(globalThis, 'localStorage', { value: lanza, configurable: true, writable: true });
    expect(() => guardarUltima('u1', 'a')).not.toThrow();
    expect(leerUltima('u1', p)).toBeNull();
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
    expect(() => guardarUltima('u1', 'a')).not.toThrow();
    expect(leerUltima('u1', p)).toBeNull();
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('denegado'); }, configurable: true });
    expect(leerUltima('u1', p)).toBeNull();
  });
  it('uid vacío no guarda ni lee', () => {
    guardarUltima('', 'a');
    expect(almacen.datos.size).toBe(0);
    expect(leerUltima('', p)).toBeNull();
  });
});

describe('ListaDeCuentas', () => {
  const pintar = (cuentas: CuentaVista[], ultima: string | null) => renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ListaDeCuentas, { cuentas, ultima })));
  const ok = (id: string, nombre: string, estado: string | null = 'activo'): CuentaVista =>
    ({ id, rol: 'admin', ficha: { lectura: 'ok', nombre, estado } });

  it('la última va primero con «Continuar con <nombre>»', () => {
    const html = pintar([ok('a', 'Alfa'), ok('b', 'Beta'), ok('c', 'Gama')], 'b');
    expect(html.indexOf('Beta')).toBeLessThan(html.indexOf('Alfa'));
    expect(html).toContain('Última usada');
    expect(html).toContain('Continuar con Beta');
    expect(html.match(/Continuar con/g)).toHaveLength(1);
    expect(html).toContain('href="/negocio/b/inicio"');
  });
  it('sin última no hay «Continuar con»', () => {
    expect(pintar([ok('a', 'Alfa'), ok('b', 'Beta')], null)).not.toContain('Continuar con');
  });
  it('suspendida: habilitada (con enlace) y con la marca', () => {
    const html = pintar([ok('a', 'Alfa', 'suspendido'), ok('b', 'Beta')], null);
    expect(html).toContain('Suspendida');
    expect(html).toContain('href="/negocio/a/inicio"');
  });
  it('dada de baja: deshabilitada, con marca y SIN enlace', () => {
    const html = pintar([ok('a', 'Alfa', 'dado_de_baja'), ok('b', 'Beta')], 'a');
    expect(html).toContain('Dada de baja');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href="/negocio/a/inicio"');
    expect(html).not.toContain('Continuar con Alfa');
    expect(html).toContain('href="/negocio/b/inicio"');
  });
  it('si la lectura falla no se oculta: id y «No se pudo leer esta cuenta»', () => {
    const html = pintar([{ id: 'rota', rol: 'oper', ficha: { lectura: 'error' } }, ok('b', 'Beta')], null);
    expect(html).toContain('rota');
    expect(html).toContain('No se pudo leer esta cuenta');
    expect(html).toContain('Operador');
    expect(html).toContain('href="/negocio/rota/inicio"');
  });
  it('el nombre hostil se escapa (sin HTML)', () => {
    const html = pintar([ok('a', '<img src=x onerror=alert(1)>')], null);
    expect(html).not.toContain('<img');
  });
});
