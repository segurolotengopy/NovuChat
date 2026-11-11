/**
 * `motivosParaElCliente`: reordena los motivos del cotejo para mostrarlos (destinatario primero, luego monto, luego fecha) sin quitar ni agregar ninguno.
 * Puro, sin emulador. Se prueba NEGANDO: no inventa, no pierde, no repite y no toca el orden dentro de cada grupo.
 */
import { describe, expect, it } from 'vitest';
import { motivosParaElCliente } from '../../../functions/src/modulos/cobros/cotejo.ts';

describe('motivosParaElCliente', () => {
  it('el destinatario primero, luego el monto, luego la fecha (el orden interno de calificarComprobante es monto, fecha, destino)', () => {
    expect(motivosParaElCliente(['monto_mayor', 'fecha_anterior', 'cuenta_distinta', 'nombre_distinto'])).toEqual(['cuenta_distinta', 'nombre_distinto', 'monto_mayor', 'fecha_anterior']);
  });
  it('NO quita ni agrega: mismos elementos que la entrada, sin repetidos', () => {
    const e = ['monto_menor', 'destino_no_coincide', 'monto_menor', 'fecha_sin_hora', 'ilegible'];
    const r = motivosParaElCliente(e);
    expect([...r].sort()).toEqual([...new Set(e)].sort());
    expect(r).toHaveLength(4);
    expect(r[0]).toBe('destino_no_coincide');
  });
  it('conserva el orden relativo dentro de cada grupo y deja lo desconocido al final', () => {
    expect(motivosParaElCliente(['nombre_distinto', 'cuenta_distinta', 'algo_nuevo', 'monto_distinto'])).toEqual(['nombre_distinto', 'cuenta_distinta', 'monto_distinto', 'algo_nuevo']);
  });
  it('vacío y «ok» pasan tal cual', () => {
    expect(motivosParaElCliente([])).toEqual([]);
    expect(motivosParaElCliente(['ok'])).toEqual(['ok']);
  });
  it('no muta la entrada', () => {
    const e = ['monto_mayor', 'cuenta_distinta'];
    motivosParaElCliente(e);
    expect(e).toEqual(['monto_mayor', 'cuenta_distinta']);
  });
});
