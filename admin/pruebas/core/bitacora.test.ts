/**
 * EL ENMASCARADO DE LA BITÁCORA (`functions/src/core/turno/bitacora.ts`).
 *
 * `enmascarar` deja el teléfono con el patrón que exige la regla de
 * `/bitacora` (`5917****001`: los cuatro primeros dígitos y los tres últimos).
 * Es privacidad: el día que cambie, el comercio podría leer números enteros de
 * sus clientes en la consola. Esta prueba fija lo que hace hoy, que es lo que
 * hacía en `ingesta.ts` antes del corte C1 de F2.
 */
import { describe, expect, it } from 'vitest';
import { enmascarar } from '../../functions/src/core/turno/bitacora.ts';

describe('enmascarar', () => {
  it('deja los cuatro primeros y los tres últimos dígitos', () => {
    expect(enmascarar('59170000001')).toBe('5917****001');
    expect(enmascarar('59171234567')).toBe('5917****567');
  });
  it('descarta todo lo que no es dígito antes de enmascarar', () => {
    expect(enmascarar('+591 7000-0001')).toBe('5917****001');
  });
  it('lo que no alcanza a siete dígitos, o no es texto, queda en asteriscos', () => {
    for (const v of ['591700', '', undefined, null, 59170000001, {}]) expect(enmascarar(v), String(v)).toBe('****');
  });
  it('nunca devuelve el número entero', () => {
    for (const t of ['59170000001', '5917000000123456']) expect(enmascarar(t)).not.toContain(t);
  });
});
