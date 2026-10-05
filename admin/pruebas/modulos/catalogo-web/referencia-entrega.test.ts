/**
 * REFERENCIAS PARA LLEGAR (Andres y Silvana, 04/10/2026, Q'Taco).
 *
 * El campo es opcional y de texto libre del cliente, así que lo que se defiende
 * es lo que sale del servidor: que se sanee, que se recorte por puntos de código
 * (sin partir un emoji), que con retiro no se guarde y que sin el campo el
 * pedido y la carga firmada sean idénticos a los de antes.
 *
 * `checkoutCatalogo` necesita Firestore y secretos; lo que se puede probar sin
 * desplegar son las funciones puras que usa, y que el punto de unión (guardar y
 * reenviar) esté escrito en el código. Esta suite no toca Firestore.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lineaLimpia, MAX_REFERENCIA, referenciaDelPedido,
} from '../../../functions/src/modulos/catalogo-web/catalogoWeb.ts';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fuente = () => readFileSync(
  join(ADMIN, 'functions', 'src', 'modulos', 'catalogo-web', 'catalogoWeb.ts'), 'utf8')
  .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

describe('lineaLimpia', () => {
  it('deja intacto un texto normal con tildes y eñes', () => {
    expect(lineaLimpia('Frente a la panadería, portón verde', 150)).toBe('Frente a la panadería, portón verde');
  });

  it('NEGANDO: saltos de línea, NUL y otros de control quedan como un solo espacio', () => {
    expect(lineaLimpia('al lado\ndel mercado', 150)).toBe('al lado del mercado');
    expect(lineaLimpia('uno\u0000dos', 150)).toBe('uno dos');
    expect(lineaLimpia('a\r\n\r\n\tb', 150)).toBe('a b');
    expect(lineaLimpia('x y z', 150)).toBe('x y z');
  });

  it('NEGANDO: la marca de derecha a izquierda (U+202E) y demás caracteres de formato no pasan', () => {
    const r = lineaLimpia('casa ‮odaznes‬ azul ​⁦', 150);
    expect(r).not.toMatch(/[‮‬​⁦]/);
    expect(r).toBe('casa odaznes azul');
  });

  it('NEGANDO: <, > y & se vuelven espacios (sin etiquetas ni entidades)', () => {
    const r = lineaLimpia('<b>porton</b> & timbre', 150);
    expect(r).not.toMatch(/[<>&]/);
    expect(r).toBe('b porton /b timbre');
  });

  it('NEGANDO: los enlaces se borran (http, https y www)', () => {
    expect(lineaLimpia('mira https://x.y/mapa?z=1 y llega', 150)).toBe('mira y llega');
    expect(lineaLimpia('HTTP://malo.test frente', 150)).toBe('frente');
    expect(lineaLimpia('en www.malo.test/ruta cerca', 150)).toBe('en cerca');
    expect(lineaLimpia('https://x.y', 150)).toBe('');
  });

  it('NEGANDO: 400 caracteres quedan en 150', () => {
    const r = lineaLimpia('a'.repeat(400), 150);
    expect(Array.from(r).length).toBe(150);
  });

  it('NEGANDO: el recorte no parte un emoji (puntos de código, no unidades UTF-16)', () => {
    // 149 letras y luego un emoji: el emoji ocupa dos unidades, y un `slice`
    // por unidades dejaría la mitad.
    const r = lineaLimpia('a'.repeat(149) + '😀' + 'b'.repeat(200), 150);
    expect(Array.from(r).length).toBe(150);
    expect(r.endsWith('😀')).toBe(true);
    expect(r).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    // Y de punta a punta con emojis seguidos.
    const e = lineaLimpia('😀'.repeat(400), 150);
    expect(Array.from(e).length).toBe(150);
    expect(e).toBe('😀'.repeat(150));
  });

  it('lo que no es texto, o es solo ruido, da vacío', () => {
    for (const v of [undefined, null, 5, {}, [], ['x'], true, '', '   ', '\n\u0000‮', '<>&']) {
      expect(lineaLimpia(v, 150), JSON.stringify(v)).toBe('');
    }
  });

  it('un cuerpo enorme no se procesa entero y sigue dando 150 como máximo', () => {
    const r = lineaLimpia('palabra '.repeat(50_000), 150);
    expect(Array.from(r).length).toBeLessThanOrEqual(150);
  });
});

describe('referenciaDelPedido', () => {
  it('con envío se guarda, saneada y recortada a 150', () => {
    expect(MAX_REFERENCIA).toBe(150);
    expect(referenciaDelPedido({ referencia: '  portón verde \n https://x.y ' }, 'envio'))
      .toBe('portón verde');
    expect(Array.from(referenciaDelPedido({ referencia: 'z'.repeat(400) }, 'envio')).length).toBe(150);
  });

  it('NEGANDO: con retiro no se guarda, aunque el cuerpo la traiga', () => {
    expect(referenciaDelPedido({ referencia: 'portón verde' }, 'retiro')).toBe('');
  });

  it('sin el campo, o con el campo vacío, es vacío: el pedido es el de hoy', () => {
    expect(referenciaDelPedido({}, 'envio')).toBe('');
    expect(referenciaDelPedido({ referencia: '' }, 'envio')).toBe('');
    expect(referenciaDelPedido({ referencia: 42 }, 'envio')).toBe('');
  });
});

describe('checkoutCatalogo: la referencia se guarda y se reenvía solo si existe', () => {
  const f = fuente();

  it('se calcula con el helper, a partir del cuerpo y de la entrega ya decidida', () => {
    expect(f).toContain('const referencia = referenciaDelPedido(cuerpo, entrega);');
  });

  it('se guarda en el pedido solo si no está vacía', () => {
    expect(f).toContain("...(referencia ? { referencia } : {}),\n      ...(descartados");
  });

  it('se reenvía en la carga firmada (clave `referencia`) solo si no está vacía', () => {
    const desde = f.indexOf("tipo: 'carrito',");
    expect(desde).toBeGreaterThan(0);
    const carga = f.slice(desde, f.indexOf('accion: ventanaAbierta', desde));
    expect(carga).toContain('...(referencia ? { referencia } : {}),');
    // Va dentro del cuerpo que se firma: `despertarFlujo` firma el JSON entero.
    expect(f).toContain('const cuerpo = JSON.stringify({ tenantId: ficha.tenantId, ...carga });');
  });

  it('NEGANDO: la referencia no hace falta para pedir (no hay un 400 por ella)', () => {
    expect(f).not.toMatch(/error: 'falta la referencia'/);
    expect(f).not.toMatch(/referencia === ''/);
  });

  it('NEGANDO: la nota y la dirección siguen igual que antes', () => {
    expect(f).toContain("const direccion = texto(cuerpo['direccion'], 200);");
    expect(f).toContain("const nota = texto(cuerpo['nota'], 300);");
  });
});
