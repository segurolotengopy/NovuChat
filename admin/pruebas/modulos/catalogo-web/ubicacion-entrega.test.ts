/**
 * UBICACIÓN COMPARTIDA PARA LA ENTREGA (Andres, 05/10/2026, Q'Taco).
 *
 * El cliente puede tocar «Usar mi ubicación actual» y mandar `{lat, lng}` junto
 * con el pedido. Es un dato personal y viene del navegador, así que lo que se
 * defiende es: que solo pase un objeto con números reales dentro de los rangos
 * de la Tierra (las cadenas no se convierten), que se redondee a 5 decimales,
 * que con retiro no se guarde, que (0,0) y todo lo inválido se ignore SIN
 * guardarse, que viaje solo en el pedido y
 * en la carga firmada (nunca a un log, a `registrar` ni al resumen del hilo) y
 * que sin la clave el pedido y la carga sean idénticos a los de antes.
 *
 * `checkoutCatalogo` necesita Firestore y secretos: se prueban las funciones
 * puras y que el punto de unión esté escrito en el código. No toca Firestore.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECIMALES_UBICACION, ubicacionDelPedido,
} from '../../../functions/src/modulos/catalogo-web/catalogoWeb.ts';
import { coordenadasValidas } from '../../../web/src/modulos/catalogo-web/publico/saneo.ts';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fuente = () => readFileSync(
  join(ADMIN, 'functions', 'src', 'modulos', 'catalogo-web', 'catalogoWeb.ts'), 'utf8')
  .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

/** Los mismos casos para el servidor y para la página: la regla es una sola. */
const VALIDOS: Array<[unknown, unknown, { lat: number; lng: number }]> = [
  [-16.5, -68.15, { lat: -16.5, lng: -68.15 }],
  [-17.783327, -63.182141, { lat: -17.78333, lng: -63.18214 }], // redondeo a 5
  [-16.123456789, -68.987654321, { lat: -16.12346, lng: -68.98765 }],
  [90, 180, { lat: 90, lng: 180 }],
  [-90, -180, { lat: -90, lng: -180 }],
  [0, 10, { lat: 0, lng: 10 }], // solo (0,0) se rechaza
  [10, 0, { lat: 10, lng: 0 }],
];
const INVALIDOS: Array<[string, unknown, unknown]> = [
  ['cadenas', '-16.5', '-68.15'],
  ['una cadena y un número', -16.5, '-68.15'],
  ['NaN', Number.NaN, -68.15],
  ['Infinity', Number.POSITIVE_INFINITY, -68.15],
  ['-Infinity en lng', -16.5, Number.NEGATIVE_INFINITY],
  ['null', null, null],
  ['undefined', undefined, undefined],
  ['lat sin lng', -16.5, undefined],
  ['lng sin lat', undefined, -68.15],
  ['lat fuera de rango', 90.000001, 10],
  ['lat fuera de rango (negativa)', -90.000001, 10],
  ['lng fuera de rango', 10, 180.000001],
  ['lng fuera de rango (negativa)', 10, -180.000001],
  ['(0,0)', 0, 0],
  ['(-0,-0)', -0, -0],
  ['(0,0) tras redondear', 0.000001, -0.000001],
  ['objetos', {}, {}],
  ['booleanos', true, false],
];

describe('ubicacionDelPedido (servidor)', () => {
  it('con envío, un objeto {lat, lng} válido sale redondeado a 5 decimales', () => {
    expect(DECIMALES_UBICACION).toBe(5);
    for (const [lat, lng, esperado] of VALIDOS) {
      expect(ubicacionDelPedido({ ubicacion: { lat, lng } }, 'envio'), `${lat},${lng}`).toEqual(esperado);
    }
  });

  it('−0 pasa a 0 (no viaja un «-0»)', () => {
    const r = ubicacionDelPedido({ ubicacion: { lat: -0.000001, lng: 10 } }, 'envio');
    expect(Object.is(r?.lat, 0)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('-0');
  });

  it('NEGANDO: tipo, rango y (0,0) dan null', () => {
    for (const [que, lat, lng] of INVALIDOS) {
      expect(ubicacionDelPedido({ ubicacion: { lat, lng } }, 'envio'), que).toBeNull();
    }
  });

  it('NEGANDO: lo que no es un objeto plano en `ubicacion` da null', () => {
    for (const v of [undefined, null, 'x', '-16.5,-68.15', 5, true, [], [-16.5, -68.15], [{ lat: 1, lng: 1 }]]) {
      expect(ubicacionDelPedido({ ubicacion: v }, 'envio'), JSON.stringify(v)).toBeNull();
    }
    expect(ubicacionDelPedido({}, 'envio')).toBeNull();
    expect(ubicacionDelPedido({ lat: -16.5, lng: -68.15 }, 'envio'), 'lat y lng sueltos no valen').toBeNull();
  });

  it('NEGANDO: con retiro no se guarda, aunque el cuerpo la traiga y sea válida', () => {
    expect(ubicacionDelPedido({ ubicacion: { lat: -16.5, lng: -68.15 } }, 'retiro')).toBeNull();
    expect(ubicacionDelPedido({ ubicacion: { lat: -16.5, lng: -68.15 } }, '')).toBeNull();
  });

  it('las claves de más se ignoran: `accuracy` y lo demás no pasan', () => {
    const r = ubicacionDelPedido(
      { ubicacion: { lat: -16.5, lng: -68.15, accuracy: 12, altitude: 3800, x: '<b>' } }, 'envio');
    expect(r).toEqual({ lat: -16.5, lng: -68.15 });
    expect(Object.keys(r ?? {}).sort()).toEqual(['lat', 'lng']);
  });
});

describe('coordenadasValidas (página): la misma regla que el servidor', () => {
  it('los mismos casos válidos dan lo mismo', () => {
    for (const [lat, lng, esperado] of VALIDOS) {
      expect(coordenadasValidas(lat, lng), `${lat},${lng}`).toEqual(esperado);
      expect(coordenadasValidas(lat, lng)).toEqual(ubicacionDelPedido({ ubicacion: { lat, lng } }, 'envio'));
    }
  });

  it('NEGANDO: los mismos casos inválidos dan null en las dos', () => {
    for (const [que, lat, lng] of INVALIDOS) {
      expect(coordenadasValidas(lat, lng), que).toBeNull();
      expect(ubicacionDelPedido({ ubicacion: { lat, lng } }, 'envio'), que).toBeNull();
    }
  });
});

describe('checkoutCatalogo: la ubicación se guarda y se reenvía solo si existe, y nunca se registra', () => {
  const f = fuente();
  /** Desde la línea donde el checkout calcula la ubicación hasta el final del archivo. */
  const checkout = () => f.slice(f.indexOf('const ubicacion = ubicacionDelPedido(cuerpo, entrega);'));

  it('se calcula con el helper, a partir del cuerpo y de la entrega ya decidida', () => {
    expect(f).toContain('const ubicacion = ubicacionDelPedido(cuerpo, entrega);');
  });

  // REEMPLAZA a «el 400 falta la direccion se mantiene» (Andres, 07/10/2026): con envío la
  // dirección pasó a ser OPCIONAL y el flujo de WhatsApp pide la ubicación. No es un debilitamiento
  // por descuido: el comportamiento real (200 sin dirección ni ubicación) lo prueba
  // `direccion-opcional.test.ts` contra el emulador; acá se niega que el 400 siga escrito y que la
  // ubicación se lea de otro lado que no sea el helper que la valida.
  it('NEGANDO: ya no hay 400 «falta la direccion», y la validez la sigue decidiendo solo el helper', () => {
    expect(f).not.toContain("error: 'falta la direccion'");
    expect(f).not.toMatch(/entrega === 'envio' && direccion === '' && !ubicacion/);
    expect(f.match(/cuerpo\['ubicacion'\]/g)?.length).toBe(1);
  });

  it('NEGANDO: una ubicación inválida no tiene un 400 propio', () => {
    expect(f).not.toMatch(/error: 'ubicacion/);
    expect(f).not.toMatch(/error: 'falta la ubicacion/);
  });

  it('`ubicacion` aparece solo con `...(ubicacion ?` en el pedido y en la carga firmada', () => {
    const c = checkout();
    // En el checkout: la constante y dos usos (pedido y carga), cada uno con dos
    // menciones. Ninguna más (desde el 07/10 ya no hay condición del 400: eran 6
    // con ella y son 5 sin ella; el conteo sigue siendo exacto).
    expect(c.match(/\bubicacion\b/g)?.length).toBe(5);
    expect(c.match(/\.\.\.\(ubicacion \? \{ ubicacion \} : \{\}\),/g)?.length).toBe(2);
    const pedido = f.slice(f.indexOf("origen: 'catalogo-web',"), f.indexOf('entregadoAlFlujo: false,'));
    expect(pedido).toContain('...(ubicacion ? { ubicacion } : {}),');
    const desde = f.indexOf("tipo: 'carrito',");
    const carga = f.slice(desde, f.indexOf('accion: ventanaAbierta', desde));
    expect(carga).toContain('...(ubicacion ? { ubicacion } : {}),');
    // Va dentro del cuerpo que se firma: `despertarFlujo` firma el JSON entero.
    expect(f).toContain('const cuerpo = JSON.stringify({ tenantId: ficha.tenantId, ...carga });');
  });

  it('NEGANDO: la ubicación no llega a `registrar`, al resumen del hilo ni a ningún log', () => {
    for (const nombre of ['ubicacion', 'lat', 'lng']) {
      const re = new RegExp(`\\b${nombre}\\b`);
      // Cada llamada a registrar( … ) hasta su cierre.
      let desde = f.indexOf('registrar(');
      let llamadas = 0;
      while (desde !== -1) {
        const hasta = f.indexOf('});', desde);
        expect(re.test(f.slice(desde, hasta)), `registrar( con ${nombre}`).toBe(false);
        llamadas += 1;
        desde = f.indexOf('registrar(', hasta);
      }
      expect(llamadas).toBeGreaterThan(0);
    }
    const resumen = f.slice(f.indexOf('function resumenDelPedido('));
    expect(resumen.slice(0, resumen.indexOf('\n}\n'))).not.toMatch(/ubicacion|\blat\b|\blng\b/);
    expect(f).not.toMatch(/console\.[a-z]+\([^)]*ubicacion/);
    expect(f).not.toMatch(/logger\.[a-z]+\([^)]*ubicacion/);
    expect(f).not.toMatch(/ultimoMensaje[^\n]*ubicacion/);
  });

  it('compatibilidad: sin la clave, ni el pedido ni la carga cambian (la clave va siempre condicionada)', () => {
    // Ninguna escritura incondicional de `ubicacion`.
    expect(f).not.toMatch(/^\s*ubicacion[,:]/m);
    expect(f).not.toMatch(/\bubicacion: /);
    // Y la carga sigue siendo la de antes en lo demás.
    expect(f).toContain('items, total, moneda: monedaPedido, costoEnvio, entrega, direccion, nota,');
    expect(f).toContain("const direccion = texto(cuerpo['direccion'], 200);");
    expect(f).toContain('...(direccion ? { direccion } : {}),');
  });

  it('la dirección sola sigue valiendo: sin ubicación el helper da null y el pedido es el de hoy', () => {
    expect(ubicacionDelPedido({ direccion: 'Av. Siempre Viva 123' }, 'envio')).toBeNull();
  });
});
