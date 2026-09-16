/**
 * Las dos Functions que el flujo llama en serie en cada mensaje tienen una
 * instancia mínima: sin ella, la primera respuesta tras un rato sin tráfico
 * tardaba ~20 s por el arranque en frío (medido el 15/09/2026). Es un costo
 * fijo decidido (~16 USD al mes las dos): esta prueba evita que se pierda, o
 * que se suba, sin que nadie lo note.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../functions/src/ingesta.ts'), 'utf8');

/** Las opciones del `onRequest` de una Function exportada, como texto. */
function opcionesDe(nombre: string): string {
  const i = fuente.indexOf(`export const ${nombre} = onRequest(`);
  expect(i, `no encontré ${nombre}`).toBeGreaterThan(-1);
  return fuente.slice(i, fuente.indexOf('async (', i));
}

describe('instancias mínimas de las Functions que el flujo llama en cada mensaje', () => {
  for (const nombre of ['ingesta', 'configuracionFlujo']) {
    it(`${nombre} tiene exactamente una instancia siempre despierta`, () => {
      expect(opcionesDe(nombre)).toMatch(/\bminInstances: 1,/);
    });
  }
});
