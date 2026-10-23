/**
 * La consola frena «nombre de quien atiende» con los mismos patrones que el
 * servidor y la regla (el cotejo de cadenas está en `core/voz-quien-atiende.test.ts`).
 * La autoridad es el servidor; esto solo dice POR QUÉ antes de guardar.
 */
import { describe, expect, it } from 'vitest';
import { errorQuienAtiende } from '../../web/src/central/lib/payloadNegocio.ts';
import { motivoQuienAtiendeInvalido } from '../../functions/src/core/prompt/prompt.ts';
import { ARNES_REGLA, ARNES_SOLO_NORMALIZADO } from '../lib/quien-atiende-arnes.ts';

describe('consola: nombre de quien atiende', () => {
  it.each([...ARNES_REGLA, ...ARNES_SOLO_NORMALIZADO, ['61 caracteres', 'x'.repeat(61)]])(
    '%s: la consola lo rechaza igual que el servidor', (_n, valor) => {
      expect(errorQuienAtiende(valor)).not.toBeNull();
      expect(motivoQuienAtiendeInvalido(valor)).not.toBeNull();
    });
  it.each(['', 'Rubén', 'Rubén Núñez', 'María José (recepción)', 'Clínica Sofía & Equipo', 'Turno 123', 'nuestro equipo'])(
    '«%s» pasa', (valor) => {
      expect(errorQuienAtiende(valor)).toBeNull();
      expect(motivoQuienAtiendeInvalido(valor)).toBeNull();
    });
});
