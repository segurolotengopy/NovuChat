/**
 * H2b-2: `prompt.ts` ya no tiene su propia lista de flujos: la deriva del
 * registro. Esta prueba fija que el resultado es idéntico al de la tabla vieja
 * (copiada acá) y que lo que no es un flujo da `null`, incluidos los nombres
 * heredados de `Object.prototype`.
 */
import { describe, expect, it } from 'vitest';
import { VERTICALES_CONOCIDOS, documentoDeVertical } from '../../functions/src/core/prompt/prompt.ts';
import { IDS_FLUJOS } from '../../functions/src/registro.ts';

// La tabla de antes del cambio, tal cual.
const VIEJA = ['agendamiento', 'venta', 'onboarding'];
const viejoDocumentoDeVertical = (v: string): string | null =>
  v === 'agendamiento' ? 'agendamiento' : v === 'venta' ? 'venta' : v === 'onboarding' ? 'onboarding' : null;

describe('prompt.ts deriva los flujos del registro', () => {
  it('VERTICALES_CONOCIDOS es la lista del registro y trae los mismos tres flujos', () => {
    expect(VERTICALES_CONOCIDOS).toBe(IDS_FLUJOS);
    expect([...VERTICALES_CONOCIDOS].sort()).toEqual([...VIEJA].sort());
  });

  it.each(VIEJA)('documentoDeVertical(%s) da lo mismo que la tabla anterior', (v) => {
    expect(documentoDeVertical(v)).toBe(viejoDocumentoDeVertical(v));
  });

  it.each(['otro', '', 'toString', '__proto__', 'constructor', 'hasOwnProperty'])(
    'documentoDeVertical(%j) es null', (v) => {
      expect(documentoDeVertical(v)).toBeNull();
      expect(viejoDocumentoDeVertical(v)).toBeNull();
    });
});
