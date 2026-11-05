/**
 * LAS ÁREAS DEL CATÁLOGO SIEMPRE SE PUEDEN ALCANZAR (Q'Taco, 05/11/2026).
 *
 * La barra de áreas («Todo, bebidas, birria, del-mar…») iba en UNA fila con `overflow-x: auto` y la barra de desplazamiento OCULTA: en escritorio, sin
 * rueda horizontal ni trackpad, quedaba cortada («tac…») y las últimas áreas no se podían alcanzar. Ahora se ENVUELVEN en varias filas: todas
 * visibles, con ratón o con el dedo. La prueba lee la hoja de estilos y niega la combinación que causó el defecto.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const css = readFileSync(join(ADMIN, 'web/src/modulos/catalogo-web/publico/catalogo.css'), 'utf8');

/** El cuerpo de la primera regla cuyo selector es exactamente `selector`. */
const regla = (selector: string): string => {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
};

describe('la barra de áreas del catálogo', () => {
  const barra = regla('.cat-areas');
  it('existe la regla de la barra', () => {
    expect(barra).not.toBe('');
  });
  it('se envuelve en varias filas (flex-wrap: wrap): todas las áreas quedan a la vista', () => {
    expect(barra).toMatch(/flex-wrap:\s*wrap/);
  });
  it('NEGADO: no vuelve a ser una sola fila con desplazamiento horizontal oculto', () => {
    expect(barra).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(css).not.toMatch(/\.cat-areas::-webkit-scrollbar\s*\{\s*display:\s*none/);
    expect(barra).not.toMatch(/scrollbar-width:\s*none/);
  });
  it('un chip nunca es más ancho que la pantalla (un nombre de área larguísimo no desborda la página)', () => {
    expect(css).toMatch(/\.cat-areas button\s*\{[^}]*max-width:\s*100%/);
  });
});
