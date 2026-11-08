/**
 * Una sola fuente del filtro de redacción: `Flujos/src/core/texto/filtro-redaccion.js`. El armador de los flujos por cliente
 * solo lee dentro de `Flujos/experimental/` (rechaza enlaces que salgan de su raíz, a propósito), así que `comun-sin-agente/src/`
 * guarda un ESPEJO exacto hasta que cada cliente adopte el core. Si difieren, se edita el del core y se copia; nunca al revés.
 * El core, además, no importa nada de `experimental/` (el filtro no tiene `import`/`require`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FLUJOS = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos');
const CORE = readFileSync(join(FLUJOS, 'src/core/texto/filtro-redaccion.js'), 'utf8');
describe('core/texto/filtro-redaccion: única fuente', () => {
  it('el espejo de comun-sin-agente es idéntico byte a byte', () => {
    expect(readFileSync(join(FLUJOS, 'experimental/comun-sin-agente/src/filtro-redaccion.js'), 'utf8')).toBe(CORE);
  });
  it('negada: un espejo editado se detecta', () => {
    expect(CORE + ' ').not.toBe(CORE);
  });
  it('el core no depende de experimental ni de Node', () => {
    expect(CORE).not.toMatch(/\bimport\b|\brequire\s*\(|experimental\//);
    expect(CORE).not.toMatch(/\b(?:Buffer|crypto|URL)\b\s*[.(]/);
  });
});
