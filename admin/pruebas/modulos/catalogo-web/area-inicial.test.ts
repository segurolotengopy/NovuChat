/**
 * EL FILTRO DE ÁREA ARRANCA DESDE LA URL (pedido de Andres, 05/11/2026).
 *
 * Si el enlace del catálogo trae `?area=<nombre>`, el filtro arranca en esa área (sin mayúsculas ni tildes, contra las áreas del negocio). Si el
 * parámetro falta, está vacío o no corresponde a ninguna área, arranca en «Todo», como siempre. Es solo estado de la pantalla: no hay servidor,
 * ni mensajes, ni precios, y nunca se usa el texto de la URL como HTML ni se guarda: solo se COMPARA con las áreas que el negocio ya publicó
 * y se devuelve el nombre exacto de una de ellas.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaInicial } from '../../../web/src/modulos/catalogo-web/publico/saneo.ts';

const AREAS = ['Bebidas', 'Promos', 'Café y Té', 'Menú del día'];

describe('areaInicial: NEGADO primero (todo lo que NO debe arrancar filtrado)', () => {
  it('un área inexistente → Todo', () => {
    expect(areaInicial('?area=inexistente', AREAS)).toBe('');
    expect(areaInicial('?area=promo', AREAS)).toBe(''); // casi igual no es igual: no hay coincidencia parcial
    expect(areaInicial('?area=promos2', AREAS)).toBe('');
  });
  it('sin parámetro, con el parámetro vacío o con espacios → Todo', () => {
    expect(areaInicial('', AREAS)).toBe('');
    expect(areaInicial('?', AREAS)).toBe('');
    expect(areaInicial('?otro=promos', AREAS)).toBe('');
    expect(areaInicial('?area=', AREAS)).toBe('');
    expect(areaInicial('?area=%20%20', AREAS)).toBe('');
  });
  it('sin áreas en el negocio → Todo', () => {
    expect(areaInicial('?area=promos', [])).toBe('');
  });
  it('un valor con HTML, con comodines o muy largo no coincide con nada y no rompe', () => {
    expect(areaInicial('?area=%3Cscript%3Ealert(1)%3C%2Fscript%3E', AREAS)).toBe('');
    expect(areaInicial('?area=.*', AREAS)).toBe('');
    expect(areaInicial(`?area=${'a'.repeat(5000)}`, AREAS)).toBe('');
    expect(areaInicial('?area=%E0%A4%A', AREAS)).toBe(''); // porcentaje mal formado: no lanza
  });
  it('lo que devuelve es SIEMPRE una de las áreas del negocio o vacío (nunca el texto de la URL)', () => {
    for (const q of ['?area=promos', '?area=PROMOS', '?area=cafe%20y%20te', '?area=zzz', '?area=<b>x</b>']) {
      const r = areaInicial(q, AREAS);
      expect(r === '' || AREAS.includes(r), q).toBe(true);
    }
  });
});

describe('areaInicial: lo que SÍ debe arrancar filtrado', () => {
  it('?area=promos → «Promos»', () => {
    expect(areaInicial('?area=promos', AREAS)).toBe('Promos');
  });
  it('sin importar mayúsculas ni tildes, y devuelve el nombre exacto del negocio', () => {
    expect(areaInicial('?area=PROMOS', AREAS)).toBe('Promos');
    expect(areaInicial('?area=cafe%20y%20te', AREAS)).toBe('Café y Té');
    expect(areaInicial('?area=Menu+del+dia', AREAS)).toBe('Menú del día');
    expect(areaInicial('?area=men%C3%BA%20del%20d%C3%ADa', AREAS)).toBe('Menú del día');
  });
  it('con otros parámetros en la URL, o con el parámetro repetido (vale el primero)', () => {
    expect(areaInicial('?utm=x&area=bebidas&y=1', AREAS)).toBe('Bebidas');
    expect(areaInicial('?area=bebidas&area=promos', AREAS)).toBe('Bebidas');
  });
});

describe('el componente usa areaInicial para el estado inicial, y no agrega red ni mensajes', () => {
  const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const fuente = readFileSync(join(ADMIN, 'web/src/modulos/catalogo-web/publico/SitioCatalogo.tsx'), 'utf8');
  it('el estado `area` se inicia con areaInicial(...) y sigue siendo \'\' si no hay ventana', () => {
    expect(fuente).toMatch(/useState\(\(\) => \(typeof window === 'undefined' \? '' : areaInicial\(window\.location\.search, areas\)\)\)/);
    expect(fuente).not.toMatch(/const \[area, setArea\] = useState\(''\)/);
  });
  it('no usa dangerouslySetInnerHTML ni agrega fetch por el parámetro', () => {
    expect(fuente).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
