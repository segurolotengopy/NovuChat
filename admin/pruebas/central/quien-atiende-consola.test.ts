/**
 * La consola frena «nombre de quien atiende» con los mismos patrones que el
 * servidor y la regla. La autoridad es el servidor; la consola solo dice POR QUÉ
 * antes de guardar. Aquí también se cotejan las TRES fuentes de patrones (la
 * regla de Firestore se lee como texto; nada se evalúa).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  errorQuienAtiende, QUIEN_RE_CARACTERES as WEB_CARACTERES, QUIEN_RE_VOCABULARIO as WEB_VOCABULARIO,
  COMPACTO_PROHIBIDO as WEB_COMPACTO, compactarQuien as webCompactar,
} from '../../web/src/central/lib/payloadNegocio.ts';
import {
  motivoQuienAtiendeInvalido, QUIEN_RE_CARACTERES, QUIEN_RE_VOCABULARIO, COMPACTO_PROHIBIDO, compactarQuien,
} from '../../functions/src/core/prompt/prompt.ts';
import { ARNES_REGLA, ARNES_SOLO_NORMALIZADO, NOMBRES_QUE_PASAN, PASAN_POR_DISENO } from '../lib/quien-atiende-arnes.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const regla = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');

describe('una sola fuente de patrones: servidor, consola y regla', () => {
  const enRegla = (c: string): string => c.replace(/\\/g, '\\\\');
  it('la consola usa las cadenas y la lista compacta del servidor', () => {
    expect(WEB_CARACTERES).toBe(QUIEN_RE_CARACTERES);
    expect(WEB_VOCABULARIO).toBe(QUIEN_RE_VOCABULARIO);
    expect(WEB_COMPACTO).toEqual(COMPACTO_PROHIBIDO);
  });
  it('compactarQuien da lo mismo en servidor y consola', () => {
    for (const t of ['B A N C O', 'b.a.n.c.o', 'b4nco', 'Rubén Núñez', 'p@g0', 'Ｒｕｂéｎ', 'Yape']) {
      expect(webCompactar(t)).toBe(compactarQuien(t));
    }
  });
  it('la regla de Firestore lleva las mismas cadenas', () => {
    expect(regla).toContain(`matches('${enRegla(QUIEN_RE_CARACTERES)}')`);
    expect(regla).toContain(`matches('(?is).*(${enRegla(QUIEN_RE_VOCABULARIO)}).*')`);
  });
});

describe('consola: nombre de quien atiende', () => {
  it.each([...ARNES_REGLA, ...ARNES_SOLO_NORMALIZADO, ['61 caracteres', 'x'.repeat(61)]])(
    '%s: la consola lo rechaza igual que el servidor', (_n, valor) => {
      expect(errorQuienAtiende(valor)).not.toBeNull();
      expect(motivoQuienAtiendeInvalido(valor)).not.toBeNull();
    });
  it.each(['', ...NOMBRES_QUE_PASAN, ...PASAN_POR_DISENO])('«%s» pasa', (valor) => {
    expect(errorQuienAtiende(valor)).toBeNull();
    expect(motivoQuienAtiendeInvalido(valor)).toBeNull();
  });
});
