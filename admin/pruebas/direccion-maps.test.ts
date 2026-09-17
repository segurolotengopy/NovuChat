/**
 * DÓNDE QUEDA EL LOCAL: el enlace de Google Maps y las coordenadas del pin
 * (Analisis/34 §2, bloque 1 del plan de Platinum). Mitad del servidor.
 *
 * `direccionMaps` es el único texto del comercio que el asistente REENVÍA TAL
 * CUAL a un cliente final, dentro de la confirmación de la cita. Un texto libre
 * acá sería un enlace a cualquier sitio, firmado con el nombre del negocio, en
 * el WhatsApp de un tercero. Por eso `enlaceDeMapaValido` es una lista cerrada
 * de dominios y se escribe NEGANDO: lo que no es un mapa de Google no pasa,
 * aunque las reglas ya lo hayan frenado (segunda barrera, como los derivados).
 *
 * `ubicacionDe` solo devuelve coordenadas con las DOS y en rango: un pin con
 * una sola coordenada cae en el mar, y Meta lo cobraría igual.
 *
 * Son funciones puras: se prueban sin emulador, como `planes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ENLACE_DE_MAPA, enlaceDeMapaValido, ubicacionDe } from '../functions/src/prompt.ts';

describe('enlaceDeMapaValido: solo https:// de un dominio de mapas de Google', () => {
  it.each([
    'https://maps.app.goo.gl/AbCdEf123',
    'https://goo.gl/maps/AbCdEf123',
    'https://www.google.com/maps/place/Cl%C3%ADnica+X/@-17.78,-63.18,17z/data=!3m1!4b1',
    'https://www.google.com/maps?q=-17.78,-63.18',
    'https://google.com/maps/place/algo',
    'https://maps.google.com/?q=-17.78,-63.18',
    'https://maps.google.com',
  ])('acepta %s', (v) => {
    expect(enlaceDeMapaValido(v)).toBe(v);
  });

  it('recorta el espacio de los bordes, como los demás textos', () => {
    expect(enlaceDeMapaValido('  https://maps.app.goo.gl/AbC \n')).toBe('https://maps.app.goo.gl/AbC');
  });

  it.each([
    ['http, no https', 'http://maps.app.goo.gl/AbC'],
    ['otro dominio', 'https://ejemplo.com/maps'],
    ['un dominio que EMPIEZA como el de mapas', 'https://maps.app.goo.gl.ejemplo.com/AbC'],
    ['el dominio de mapas como usuario de otra dirección', 'https://maps.app.goo.gl@ejemplo.com/AbC'],
    ['google.com sin /maps', 'https://www.google.com/search?q=mapa'],
    ['un espacio adentro', 'https://maps.app.goo.gl/Ab C'],
    ['un salto de línea adentro', 'https://maps.app.goo.gl/AbC\nhttps://ejemplo.com'],
    ['javascript:', 'javascript:alert(1)'],
    ['solo el esquema', 'https://'],
    ['texto que no es un enlace', 'Radial 26, tercer anillo'],
  ])('rechaza %s', (_, v) => {
    expect(enlaceDeMapaValido(v)).toBe('');
  });

  it('rechaza más de 200 caracteres, y acepta exactamente 200', () => {
    const base = 'https://maps.app.goo.gl/';
    expect(enlaceDeMapaValido(base + 'a'.repeat(200 - base.length))).not.toBe('');
    expect(enlaceDeMapaValido(base + 'a'.repeat(201 - base.length))).toBe('');
  });

  it('lo que no es texto no es un enlace: vacío, null, número, objeto', () => {
    for (const v of ['', '   ', null, undefined, 7, { href: 'https://maps.app.goo.gl/AbC' }, ['https://maps.app.goo.gl/AbC']]) {
      expect(enlaceDeMapaValido(v), String(v)).toBe('');
    }
  });

  it('la expresión es la MISMA que la de las reglas, salvo la forma de escapar el punto', () => {
    // Las reglas escriben el punto como `[.]` (no admiten `\.` dentro de una
    // cadena). Si alguien agrega un dominio en un lado y no en el otro, el
    // panel acepta lo que el servidor descarta, o al revés, sin que nadie lo
    // note hasta que un comercio pregunte por qué el asistente no manda el mapa.
    const enReglas = "^https://(maps[.]app[.]goo[.]gl|goo[.]gl/maps|www[.]google[.]com/maps|google[.]com/maps|maps[.]google[.]com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$";
    expect(ENLACE_DE_MAPA.source.replace(/\\\//g, '/').replace(/\\\./g, '[.]')).toBe(enReglas);
  });
});

describe('ubicacionDe: las dos coordenadas, numéricas y en rango, o nada', () => {
  it('con lat y lng en rango devuelve el par', () => {
    expect(ubicacionDe({ lat: -17.7833, lng: -63.1821 })).toEqual({ lat: -17.7833, lng: -63.1821 });
    expect(ubicacionDe({ lat: 90, lng: -180 })).toEqual({ lat: 90, lng: -180 });
    expect(ubicacionDe({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
  });

  it.each([
    ['sin ubicación', undefined],
    ['null', null],
    ['un texto', '-17.78,-63.18'],
    ['solo la latitud', { lat: -17.78 }],
    ['solo la longitud', { lng: -63.18 }],
    ['coordenadas como texto', { lat: '-17.78', lng: '-63.18' }],
    ['latitud fuera de rango', { lat: 91, lng: 0 }],
    ['longitud fuera de rango', { lat: 0, lng: -181 }],
    ['NaN', { lat: Number.NaN, lng: 0 }],
    ['infinito', { lat: 0, lng: Number.POSITIVE_INFINITY }],
    ['una lista', [-17.78, -63.18]],
  ])('devuelve null con %s', (_, v) => {
    expect(ubicacionDe(v)).toBeNull();
  });

  it('ignora claves de más sin fallar: las reglas ya las rechazan al guardar', () => {
    expect(ubicacionDe({ lat: 1, lng: 2, nombre: 'x' })).toEqual({ lat: 1, lng: 2 });
  });
});
