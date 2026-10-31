/**
 * H2b-10: el descuento de stock del catálogo web lo decide `tieneModulo(ficha,
 * 'inventario')`, no el flujo. Pruebas puras, negando: sin el módulo no se descuenta.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fichaDescuentaStock } from '../../../functions/src/modulos/inventario/inventario.ts';

const aqui = dirname(fileURLToPath(import.meta.url));

describe('fichaDescuentaStock', () => {
  it('ficha de venta SIN modulos (puente de flujos): descuenta, igual que hoy', () => {
    expect(fichaDescuentaStock({ flujos: ['venta'] })).toBe(true);
    expect(fichaDescuentaStock({ vertical: 'venta' })).toBe(true);
  });
  it('flujos de reservas o captación sin modulos: no descuenta', () => {
    expect(fichaDescuentaStock({ flujos: ['agendamiento'] })).toBe(false);
    expect(fichaDescuentaStock({ flujos: ['onboarding'] })).toBe(false);
  });
  it('con modulos manda la lista: sin inventario NO descuenta aunque diga flujos venta', () => {
    expect(fichaDescuentaStock({ flujos: ['venta'], modulos: ['productos', 'catalogo-web', 'pedidos', 'cobros'] })).toBe(false);
    expect(fichaDescuentaStock({ modulos: [] })).toBe(false);
  });
  it('modulos que no es lista se ignora y manda el puente de flujos', () => {
    expect(fichaDescuentaStock({ modulos: 'x' as unknown as string[], flujos: ['venta'] })).toBe(true);
  });
  it('con modulos que incluyen inventario: descuenta', () => {
    expect(fichaDescuentaStock({ modulos: ['catalogo-web', 'inventario'] })).toBe(true);
  });
  it('ficha inexistente, o flujos que no es lista: no descuenta', () => {
    expect(fichaDescuentaStock(null)).toBe(false);
    expect(fichaDescuentaStock({ flujos: 'venta' as unknown as string[] })).toBe(false);
  });
});

describe('catalogoWeb.ts descuenta solo tras la guarda del módulo', () => {
  const fuente = readFileSync(
    join(aqui, '../../../functions/src/modulos/catalogo-web/catalogoWeb.ts'), 'utf8');
  it('la llamada a descontarPedido está detrás de fichaDescuentaStock', () => {
    const i = fuente.indexOf('await descontarPedido(');
    expect(i).toBeGreaterThan(0);
    expect(fuente.slice(Math.max(0, i - 400), i)).toContain('ficha.descuentaStock');
    expect(fuente.match(/descontarPedido\(/g)?.length).toBe(1);
  });
  it('la guarda se decide al leer la ficha: el checkout no hace una lectura nueva tras guardar', () => {
    expect(fuente).toContain('descuentaStock: fichaDescuentaStock(tenant.data())');
    expect(fuente).not.toContain('fichaDescuentaStock(fichaTenant');
  });
});
