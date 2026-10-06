/**
 * LA UBICACIÓN COMPARTIDA EN LA PANTALLA DE PEDIDOS.
 *
 * El campo `ubicacion { lat, lng }` lo escribe el servidor a partir de lo que
 * mandó el navegador del cliente final: la consola no se fía. Esta suite lo
 * demuestra NEGANDO: todo lo que no sea un par de números finitos, en rango y
 * distinto de (0, 0), no produce enlace; y el enlace que sí se produce sale
 * solo de esos dos números, nunca de un texto del pedido.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { enlaceAMaps, ubicacionValida } from '../../../web/src/modulos/pedidos/ubicacion.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const PAGINA = readFileSync(join(aqui, '../../../web/src/modulos/pedidos/Pedidos.tsx'), 'utf8');

describe('el enlace a Maps de un pedido', () => {
  it('se arma con 5 decimales y la coma codificada', () => {
    expect(enlaceAMaps({ lat: -17.783327, lng: -63.182141 }))
      .toBe('https://www.google.com/maps/search/?api=1&query=-17.78333%2C-63.18214');
    expect(enlaceAMaps({ lat: 10, lng: 20.5 }))
      .toBe('https://www.google.com/maps/search/?api=1&query=10.00000%2C20.50000');
  });

  it('acepta los extremos del rango', () => {
    expect(enlaceAMaps({ lat: 90, lng: 180 })).not.toBeNull();
    expect(enlaceAMaps({ lat: -90, lng: -180 })).not.toBeNull();
    expect(enlaceAMaps({ lat: 0, lng: 1 })).not.toBeNull();
    expect(enlaceAMaps({ lat: 1, lng: 0 })).not.toBeNull();
  });

  it('sin ubicación (pedidos viejos) no hay enlace', () => {
    for (const v of [undefined, null, {}, [], 'x', 5, true]) expect(enlaceAMaps(v)).toBeNull();
  });

  it('un valor que no es número no pasa, ni siquiera un número escrito como texto', () => {
    for (const v of [
      { lat: '-17.78', lng: '-63.18' },
      { lat: -17.78, lng: '-63.18' },
      { lat: null, lng: -63.18 },
      { lat: -17.78 },
      { lng: -63.18 },
      { lat: [-17.78], lng: [-63.18] },
      { lat: { valueOf: () => -17.78 }, lng: -63.18 },
      { lat: true, lng: false },
    ]) expect(enlaceAMaps(v)).toBeNull();
  });

  it('NaN e infinitos no pasan', () => {
    for (const v of [
      { lat: NaN, lng: 1 }, { lat: 1, lng: NaN },
      { lat: Infinity, lng: 1 }, { lat: 1, lng: -Infinity },
    ]) expect(enlaceAMaps(v)).toBeNull();
  });

  it('fuera de rango no pasa', () => {
    for (const v of [
      { lat: 90.00001, lng: 0.5 }, { lat: -90.1, lng: 0.5 },
      { lat: 0.5, lng: 180.00001 }, { lat: 0.5, lng: -181 },
      { lat: 1e9, lng: 1e9 },
    ]) expect(enlaceAMaps(v)).toBeNull();
  });

  it('el punto (0, 0) no pasa, ni lo que redondea a él, ni el cero negativo', () => {
    for (const v of [
      { lat: 0, lng: 0 }, { lat: -0, lng: 0 }, { lat: 0, lng: -0 },
      { lat: 0.000001, lng: -0.000001 },
    ]) expect(enlaceAMaps(v)).toBeNull();
  });

  it('el cero negativo no se imprime como «-0.00000»', () => {
    const e = enlaceAMaps({ lat: -0.000001, lng: 5 });
    expect(e).toBe('https://www.google.com/maps/search/?api=1&query=0.00000%2C5.00000');
  });

  it('solo importan lat y lng: texto o URL extra del pedido no entra al enlace', () => {
    const hostil = {
      lat: -17.78, lng: -63.18,
      url: 'https://malo.example/robo', href: 'javascript:alert(1)',
      texto: '"><script>1</script>', enlace: 'data:text/html,x',
    };
    const e = enlaceAMaps(hostil)!;
    expect(e).toBe('https://www.google.com/maps/search/?api=1&query=-17.78000%2C-63.18000');
    expect(e).not.toMatch(/malo|javascript|script|data:/);
    expect(ubicacionValida(hostil)).toEqual({ lat: -17.78, lng: -63.18 });
  });

  it('el enlace tiene siempre la misma forma: https, dominio fijo, solo dígitos', () => {
    const forma = /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-?\d{1,2}\.\d{5}%2C-?\d{1,3}\.\d{5}$/;
    for (const [lat, lng] of [[-17.78, -63.18], [89.999999, 179.999999], [-0.5, 0.5], [12, -12.123456789]]) {
      expect(enlaceAMaps({ lat, lng })).toMatch(forma);
    }
  });
});

describe('la pantalla de Pedidos', () => {
  it('arma el enlace solo con la función pura y lo abre sin dar acceso a la consola', () => {
    expect(PAGINA).toContain("import { enlaceAMaps } from './ubicacion'");
    expect(PAGINA).toContain('enlaceAMaps(p.ubicacion)');
    expect(PAGINA).toContain('target="_blank"');
    expect(PAGINA).toContain('rel="noopener noreferrer"');
    // El único href de la página es el que sale de la función pura.
    const hrefs = PAGINA.match(/href=\{[^}]*\}|href="[^"]*"/g) ?? [];
    expect(hrefs).toEqual(['href={enlaceMaps}']);
  });

  it('sin ubicación válida no se pinta nada: la línea depende del enlace', () => {
    expect(PAGINA).toMatch(/\{enlaceMaps && \(/);
  });

  it('la dirección sigue mostrándose aparte: si hay las dos, salen las dos', () => {
    expect(PAGINA).toMatch(/typeof p\.direccion === 'string' && p\.direccion !== ''/);
    expect(PAGINA).toContain('Ubicación compartida');
    expect(PAGINA).toContain('Abrir en Maps');
  });
});
