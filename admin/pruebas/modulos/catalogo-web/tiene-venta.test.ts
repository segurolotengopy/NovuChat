/**
 * `tieneVenta` del catálogo web decide con el registro (H2b-4d). Es la
 * capacidad que da el enlace de la carta y las ventas: las fichas reales deben
 * dar lo de siempre, y lo que no vende, no.
 */
import { describe, expect, it } from 'vitest';
import { fichaVende } from '../../../functions/src/modulos/catalogo-web/catalogoWeb.ts';
import { FLUJOS_DE_RUTA } from '../../../functions/src/registro.ts';

import { modulosDeFlujos } from '../../../functions/src/registro.ts';
/** La lista propia que había antes, para comparar. */
const antes = (t: Record<string, unknown>): boolean =>
  Array.isArray(t['flujos']) ? (t['flujos'] as unknown[]).includes('venta') : t['vertical'] === 'venta';

describe('tieneVenta con el registro', () => {
  it('el flujo venta trae catalogo-web en el registro', () => {
    expect(FLUJOS_DE_RUTA.venta.modulos).toContain('catalogo-web');
  });

  it.each([
    [{ flujos: ['venta'], modulos: modulosDeFlujos(['venta'] as never[]) }],
    [{ flujos: ['agendamiento', 'venta'], modulos: modulosDeFlujos(['agendamiento', 'venta'] as never[]) }],
    [{ vertical: 'venta', modulos: modulosDeFlujos(['venta'] as never[]) }],
    [{ flujos: ['agendamiento'], modulos: modulosDeFlujos(['agendamiento'] as never[]) }],
    [{ flujos: [], modulos: modulosDeFlujos([] as never[]) }],
    [{ vertical: 'agendamiento' }],
    [{ flujos: ['onboarding'], modulos: modulosDeFlujos(['onboarding'] as never[]) }],
    [{}],
  ])('fichas reales: igual que antes %j', (f) => {
    expect(fichaVende(f)).toBe(antes(f));
  });

  it('vende: con `modulos` que trae catalogo-web; H2b-cierre: `flujos`/`vertical` venta SIN `modulos` ya no vende', () => {
    expect(fichaVende({ flujos: ['venta'], modulos: modulosDeFlujos(['venta'] as never[]) })).toBe(true);
    expect(fichaVende({ flujos: ['venta'] })).toBe(false);
    expect(fichaVende({ vertical: 'venta' })).toBe(false);
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
