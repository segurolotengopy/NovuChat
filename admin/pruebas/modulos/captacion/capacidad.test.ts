/**
 * H2b-4b: la comprobación de que el comercio tiene captación sale del
 * registro (`tieneModulo`). Equivalencia con la lista propia anterior en los
 * casos reales, negativas, y la diferencia documentada con `flujos` no lista.
 */
import { describe, expect, it } from 'vitest';
import { tieneCaptacion } from '../../../functions/src/modulos/captacion/captacion.ts';

describe('tieneCaptacion (registro)', () => {
  it('H2b-cierre: `flujos` con onboarding SIN `modulos` ya no cuenta: falla cerrado', () => {
    expect(tieneCaptacion({ flujos: ['onboarding'] })).toBe(false);
    expect(tieneCaptacion({ vertical: 'onboarding' })).toBe(false);
    expect(tieneCaptacion({ flujos: ['onboarding'], vertical: 'onboarding' })).toBe(false);
  });
  it('`modulos` con captacion: sí, sea cual sea `flujos` o `vertical`', () => {
    expect(tieneCaptacion({ modulos: ['captacion'], flujos: ['venta'], vertical: 'venta' })).toBe(true);
  });
  it('modulos sin captacion: no; con captacion: sí', () => {
    expect(tieneCaptacion({ modulos: ['productos'] })).toBe(false);
    expect(tieneCaptacion({ modulos: ['productos'], flujos: ['onboarding'] })).toBe(false);
    expect(tieneCaptacion({ modulos: ['captacion'] })).toBe(true);
  });
  it('ficha inexistente o null: no; ficha vacía: no', () => {
    expect(tieneCaptacion(null)).toBe(false);
    expect(tieneCaptacion(undefined)).toBe(false);
    expect(tieneCaptacion({})).toBe(false);
  });
  it('DIFERENCIA documentada: flujos que no es lista falla cerrado (antes caía a vertical con null)', () => {
    expect(tieneCaptacion({ flujos: null, vertical: 'onboarding' })).toBe(false);
    expect(tieneCaptacion({ flujos: 'onboarding' })).toBe(false);
    expect(tieneCaptacion({ flujos: { 0: 'onboarding' } })).toBe(false);
  });
});
