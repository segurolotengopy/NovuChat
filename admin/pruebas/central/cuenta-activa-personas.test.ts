/**
 * LA CUENTA ACTIVA, POR PERSONA: lo que la consola ofrece y recuerda.
 *
 * Depende de `web/src/core/lib/cuentaActiva.ts` (PR #538, rama
 * central/selector-pr1-cuenta-activa). Es solo preferencia de pantalla: el
 * servidor decide en cada petición. Acá se prueba que esa preferencia no
 * cruza personas ni cuentas que el token no tiene.
 * PURA: localStorage es un doble en memoria.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cuentasDe, destinoInicial, guardarUltima, leerUltima,
} from '../../web/src/core/lib/cuentaActiva';
import type { Permisos } from '../../web/src/core/lib/sesion';

const memoria = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => { memoria.set(k, v); },
  removeItem: (k: string) => { memoria.delete(k); },
  clear: () => memoria.clear(),
  key: () => null,
  get length() { return memoria.size; },
} as Storage;

const permisos = (tenants: Permisos['tenants'], propietario = false): Permisos =>
  ({ propietario, tenants, version: 1 });

const ruben = permisos({ r1: 'admin', r2: 'admin' });
const antonio = permisos({ a1: 'admin', a2: 'admin' });
const manager = permisos({ r1: 'admin', r2: 'admin', a1: 'admin', a2: 'admin' });

beforeEach(() => memoria.clear());

describe('qué cuentas se ofrecen', () => {
  it('Rubén [r1, r2], Antonio [a1, a2], el manager las cuatro', () => {
    expect(cuentasDe(ruben)).toEqual(['r1', 'r2']);
    expect(cuentasDe(antonio)).toEqual(['a1', 'a2']);
    expect(cuentasDe(manager)).toEqual(['r1', 'r2', 'a1', 'a2']);
  });
  it('ingesta (una máquina) nunca se ofrece', () => {
    expect(cuentasDe(permisos({ r1: 'admin', r2: 'ingesta' }))).toEqual(['r1']);
  });
  it('Rubén y Antonio no comparten ninguna', () => {
    expect(cuentasDe(ruben).filter((c) => cuentasDe(antonio).includes(c))).toEqual([]);
  });
});

describe('destino al entrar', () => {
  it('con dos o más cuentas: selector siempre, nunca directo', () => {
    expect(destinoInicial(ruben, null)).toEqual({ tipo: 'selector', ultima: null });
    expect(destinoInicial(antonio, 'a2')).toEqual({ tipo: 'selector', ultima: 'a2' });
    expect(destinoInicial(manager, 'r1').tipo).toBe('selector');
  });
  it('una «última» que no es del token se descarta', () => {
    expect(destinoInicial(ruben, 'a1')).toEqual({ tipo: 'selector', ultima: null });
    expect(destinoInicial(manager, 'c1')).toEqual({ tipo: 'selector', ultima: null });
  });
  it('una sola cuenta: directa; ninguna: ninguna; el propietario: ninguna', () => {
    expect(destinoInicial(permisos({ r1: 'admin' }), null)).toEqual({ tipo: 'directa', tenantId: 'r1' });
    expect(destinoInicial(permisos({}), null)).toEqual({ tipo: 'ninguna' });
    expect(destinoInicial(permisos({ r1: 'admin', r2: 'admin' }, true), 'r1')).toEqual({ tipo: 'ninguna' });
  });
});

describe('la última cuenta recordada', () => {
  it('un localStorage de Rubén con a1 se descarta', () => {
    guardarUltima('u-ruben', 'a1');
    expect(leerUltima('u-ruben', ruben)).toBeNull();
  });
  it('lo guardado en el navegador no es un permiso: una cuenta quitada del token se descarta', () => {
    guardarUltima('u-ruben', 'r2');
    expect(leerUltima('u-ruben', ruben)).toBe('r2');
    expect(leerUltima('u-ruben', permisos({ r1: 'admin' }))).toBeNull();
  });
  it('la última de otra persona en el mismo navegador no se usa (clave por uid)', () => {
    guardarUltima('u-ruben', 'r2');
    guardarUltima('u-antonio', 'a1');
    expect(leerUltima('u-antonio', antonio)).toBe('a1');
    expect(leerUltima('u-ruben', ruben)).toBe('r2');
    // Antonio entra en el navegador de Rubén sin historial propio
    memoria.clear();
    guardarUltima('u-ruben', 'r2');
    expect(leerUltima('u-antonio', antonio)).toBeNull();
    // y aunque forzara el id de Rubén, no es de su token
    expect(leerUltima('u-antonio', permisos({ a1: 'admin', r2: 'admin' }))).toBeNull();
  });
  it('uid vacío o ids raros: nada se lee ni se guarda', () => {
    guardarUltima('', 'r1');
    guardarUltima('u-ruben', '');
    expect(memoria.size).toBe(0);
    expect(leerUltima('', ruben)).toBeNull();
    memoria.set('nc:ultimaCuenta:u-ruben', '__proto__');
    expect(leerUltima('u-ruben', ruben)).toBeNull();
    memoria.set('nc:ultimaCuenta:u-ruben', 'R1');
    expect(leerUltima('u-ruben', ruben)).toBeNull();
    memoria.set('nc:ultimaCuenta:u-ruben', ' r1');
    expect(leerUltima('u-ruben', ruben)).toBeNull();
  });
});
