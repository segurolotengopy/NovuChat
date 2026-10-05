/**
 * `documentoQueCobra` decide ahora por el registro (H2b-4a). NO NECESITA
 * EMULADOR. Se pasan fichas CRUDAS (los campos tal como los entrega Firestore):
 * lo que importa es la diferencia con la lógica vieja fuera del dominio bien
 * formado, que queda declarada y probada, y la identidad dentro de él.
 */
import { describe, expect, it } from 'vitest';
import { documentoQueCobra } from '../../../functions/src/modulos/cobros/cobro.ts';

const ficha = (d: Record<string, unknown>) => ({ get: (k: string) => d[k] });
const crudo = (d: Record<string, unknown>) => documentoQueCobra(ficha(d));

/** La lógica anterior, copiada tal cual, para probar la identidad en fichas reales. */
function anterior(f: { get(c: string): unknown }): 'venta' | 'agendamiento' | null {
  const lista = f.get('flujos');
  const flujos = Array.isArray(lista) ? lista.map(String) : [String(f.get('vertical') ?? '')];
  if (flujos.includes('venta')) return 'venta';
  if (flujos.includes('agendamiento')) return 'agendamiento';
  return null;
}

describe('documentoQueCobra: fichas reales, resultado idéntico al anterior', () => {
  const reales: Array<[string, Record<string, unknown>, 'venta' | 'agendamiento' | null]> = [
    ['flujos venta', { flujos: ['venta'] }, 'venta'],
    ['vertical venta', { vertical: 'venta' }, 'venta'],
    ['flujos agendamiento', { flujos: ['agendamiento'] }, 'agendamiento'],
    ['vertical agendamiento', { vertical: 'agendamiento' }, 'agendamiento'],
    ['ambos', { flujos: ['agendamiento', 'venta'] }, 'venta'],
    ['onboarding', { flujos: ['onboarding'] }, null],
    ['lista vacía', { flujos: [] }, null],
    ['ficha vacía', {}, null],
  ];
  for (const [nombre, d, esperado] of reales) {
    it(nombre, () => {
      expect(crudo(d)).toBe(esperado);
      expect(anterior(ficha(d))).toBe(esperado);
    });
  }
});

describe('documentoQueCobra: fuera del dominio bien formado, el registro falla cerrado o manda `modulos`', () => {
  it('flujos null con vertical: null (antes venta)', () => {
    expect(crudo({ flujos: null, vertical: 'venta' })).toBeNull();
    expect(anterior(ficha({ flujos: null, vertical: 'venta' }))).toBe('venta');
  });
  it('flujos que no es lista: null (antes agendamiento)', () => {
    expect(crudo({ flujos: 'venta', vertical: 'agendamiento' })).toBeNull();
    expect(anterior(ficha({ flujos: 'venta', vertical: 'agendamiento' }))).toBe('agendamiento');
  });
  it('modulos manda sobre flujos: pedidos da venta (antes agendamiento)', () => {
    const d = { flujos: ['agendamiento'], modulos: ['cobros', 'pedidos'] };
    expect(crudo(d)).toBe('venta');
    expect(anterior(ficha(d))).toBe('agendamiento');
  });
  it('modulos manda sobre flujos: agenda da agendamiento (antes venta)', () => {
    const d = { flujos: ['venta'], modulos: ['cobros', 'agenda'] };
    expect(crudo(d)).toBe('agendamiento');
    expect(anterior(ficha(d))).toBe('venta');
  });
  it('modulos vacío: null (antes venta)', () => {
    const d = { flujos: ['venta'], modulos: [] };
    expect(crudo(d)).toBeNull();
    expect(anterior(ficha(d))).toBe('venta');
  });
  it('negativa: sin cobros no hay documento aunque haya pedidos o agenda', () => {
    expect(crudo({ modulos: ['pedidos'] })).toBeNull();
    expect(crudo({ modulos: ['agenda'] })).toBeNull();
    expect(crudo({ modulos: ['pedidos', 'agenda'] })).toBeNull();
  });
  it('valores esperados escritos a mano, independientes del registro', () => {
    expect(crudo({ flujos: ['venta'] })).toBe('venta');
    expect(crudo({ modulos: ['cobros', 'pedidos'] })).toBe('venta');
    expect(crudo({ modulos: ['cobros', 'agenda'] })).toBe('agendamiento');
    expect(crudo({ flujos: null, vertical: 'venta' })).toBeNull();
    expect(crudo({})).toBeNull();
  });
});

describe('documentoQueCobra: la ficha completa de Q\'Taco (valores sintéticos)', () => {
  it('da venta', () => {
    expect(crudo({
      creadoEn: '2026-01-01T00:00:00Z', creadoPor: 'uid-sintetico', estado: 'activo',
      flujos: ['venta'], nombre: 'Comercio de prueba', plan: 'plan-sintetico',
      vertical: 'venta', waPhoneNumberId: 'phone-sintetico', waWabaId: 'waba-sintetico',
    })).toBe('venta');
  });
});
