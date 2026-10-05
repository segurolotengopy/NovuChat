/**
 * `tieneVenta` del catálogo web decide con el registro (H2b-4d). Es la
 * capacidad que da el enlace de la carta y las ventas: las fichas reales deben
 * dar lo de siempre, y lo que no vende, no.
 */
import { describe, expect, it } from 'vitest';
import { fichaVende } from '../../../functions/src/modulos/catalogo-web/catalogoWeb.ts';
import { PUENTE_DE_FLUJOS } from '../../../functions/src/registro.ts';

/** La lista propia que había antes, para comparar. */
const antes = (t: Record<string, unknown>): boolean =>
  Array.isArray(t['flujos']) ? (t['flujos'] as unknown[]).includes('venta') : t['vertical'] === 'venta';

describe('tieneVenta con el registro', () => {
  it('el flujo venta trae catalogo-web en el registro', () => {
    expect(PUENTE_DE_FLUJOS.venta.modulos).toContain('catalogo-web');
  });

  it.each([
    [{ flujos: ['venta'] }],
    [{ flujos: ['agendamiento', 'venta'] }],
    [{ vertical: 'venta' }],
    [{ flujos: ['agendamiento'] }],
    [{ flujos: [] }],
    [{ vertical: 'agendamiento' }],
    [{ flujos: ['onboarding'] }],
    [{}],
  ])('fichas reales: igual que antes %j', (f) => {
    expect(fichaVende(f)).toBe(antes(f));
  });

  it('vende: flujos [venta] y vertical venta', () => {
    expect(fichaVende({ flujos: ['venta'] })).toBe(true);
    expect(fichaVende({ vertical: 'venta' })).toBe(true);
  });

  it('negativas: no vende', () => {
    expect(fichaVende({ modulos: ['pedidos'] })).toBe(false);
    expect(fichaVende(null)).toBe(false);
    expect(fichaVende(undefined)).toBe(false);
    expect(fichaVende({ flujos: ['agendamiento'] })).toBe(false);
  });

  it('con modulos (lista) manda la lista', () => {
    expect(fichaVende({ modulos: ['catalogo-web'] })).toBe(true);
    expect(fichaVende({ flujos: ['venta'], modulos: ['pedidos'] })).toBe(false);
  });

  it('DIFERENCIA documentada: flujos que no es lista falla cerrado, ya no cae a vertical', () => {
    expect(antes({ flujos: null, vertical: 'venta' })).toBe(true);
    expect(fichaVende({ flujos: null, vertical: 'venta' })).toBe(false);
    expect(fichaVende({ flujos: 'venta', vertical: 'venta' })).toBe(false);
  });
});
