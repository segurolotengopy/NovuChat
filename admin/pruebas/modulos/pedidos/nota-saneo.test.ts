/**
 * EL SANEO PROPIO DE LA NOTA DEL CLIENTE, `notaLimpia` (28/11/2026, «entera, una vez»), NEGANDO.
 * Pura: sin emulador ni red. Conserva «&», «<», «>», ZWJ y selectores de variación; quita controles (los vuelve espacio),
 * marcas bidi, sustitutos sueltos, uso privado y enlaces; recorta a 500 PUNTOS de código sin partir pares.
 * `lineaLimpia` (que sirve al `detalle`) NO cambia: sigue convirtiendo «&», «<», «>» en espacio.
 *
 * Mutación por razonamiento: quitar la excepción del ZWJ (`(?!‍)`) hace fallar «ZWJ entero»; quitar `\p{Cf}` hace
 * fallar «marcas bidi quitadas»; quitar `quitarEnlaces` hace fallar «enlaces quitados».
 */
import { describe, expect, it } from 'vitest';
import { lineaLimpia, notaLimpia } from '../../../functions/src/modulos/pedidos/comprable.ts';
import { armarPedidoWa, MAX_NOTA_WA } from '../../../functions/src/modulos/pedidos/pedidoDelQr.ts';

const FAMILIA = '👨‍👩‍👧';
const armar = (nota: unknown) => armarPedidoWa(
  [{ externa: true, id: 'a', nombre: 'P', cantidad: 1, precioCentavos: 1000, moneda: 'BOB' }],
  'retiro', null, {}, 'R1', '59170000009', 10, { monedas: ['BOB'] }, false, nota,
).pedido;

describe('notaLimpia', () => {
  it('conserva «&», «<» y «>» tal cual (el escape es de presentación)', () => {
    expect(notaLimpia('Juan & Maria <3')).toBe('Juan & Maria <3');
    expect(notaLimpia('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
    expect(notaLimpia('<b>hola</b>')).toBe('<b>hola</b>');
    expect(notaLimpia('a > b && c < d')).toBe('a > b && c < d');
    expect(notaLimpia('&lt;b&gt;')).toBe('&lt;b&gt;'); // no escapa ni des-escapa
  });
  it('el ZWJ y los selectores de variación llegan enteros (el emoji compuesto no se parte)', () => {
    expect(notaLimpia(`hola ${FAMILIA}`)).toBe(`hola ${FAMILIA}`);
    expect(notaLimpia('❤️')).toBe('❤️');
    expect(notaLimpia('👍🏽')).toBe('👍🏽');
    expect(notaLimpia(FAMILIA.repeat(100))).toBe(FAMILIA.repeat(100)); // 500 puntos exactos
  });
  it('saltos de línea, tabulaciones y controles → espacio (y se colapsan)', () => {
    expect(notaLimpia('uno\ndos\r\n\ttres')).toBe('uno dos tres');
    for (const c of [' ', ' ', '\u0085', '\u007f', '\u0000', '\u001f', '\u009f']) {
      expect(notaLimpia(`a${c}b`), JSON.stringify(c)).toBe('a b');
    }
  });
  it('marcas bidi y demás Cf (salvo el ZWJ) se QUITAN', () => {
    for (const c of ['‮', '‪', '‬', '‎', '‏', '⁦', '⁩', '​', '⁠', '﻿']) {
      expect(notaLimpia(`a${c}b`), JSON.stringify(c)).toBe('ab');
    }
  });
  it('sustitutos sueltos y uso privado se quitan; un par válido se conserva', () => {
    expect(notaLimpia('a\ud83db')).toBe('ab');
    expect(notaLimpia('a\ude00b')).toBe('ab');
    expect(notaLimpia('ab')).toBe('ab');
    expect(notaLimpia('a😀b')).toBe('a😀b');
  });
  it('enlaces quitados con la misma regla que lineaLimpia', () => {
    for (const t of ['https://x.y', 'http://x.y/a?b=1', 'HTTPS://X.Y', 'www.x.y', 'WWW.X.Y/ruta']) {
      expect(notaLimpia(`mire ${t} gracias`), t).toBe('mire gracias');
      expect(notaLimpia(`mire ${t} gracias`)).toBe(lineaLimpia(`mire ${t} gracias`, 500)); // misma regla
    }
    expect(notaLimpia('ht​tps://x.y')).toBe(''); // un Cf escondido no esquiva la regla
    expect(notaLimpia('https://x.y')).toBe('');
  });
  it('recorta a 500 PUNTOS sin partir pares; 500 entran enteros', () => {
    expect(notaLimpia('a'.repeat(500))).toBe('a'.repeat(500));
    expect(notaLimpia('a'.repeat(501))).toBe('a'.repeat(500));
    expect(notaLimpia('😀'.repeat(500))).toBe('😀'.repeat(500));
    expect(notaLimpia('😀'.repeat(501))).toBe('😀'.repeat(500));
    expect(notaLimpia('a'.repeat(499) + '😀😀')).toBe('a'.repeat(499) + '😀');
    expect(notaLimpia('😀'.repeat(501))).not.toMatch(/\p{Cs}/u);
    expect(notaLimpia('x'.repeat(20000)).length).toBe(500); // el trabajo previo está acotado
    expect(notaLimpia('hola', 2)).toBe('ho');
  });
  it('vacío, solo controles/espacios/enlaces o algo que no es texto = sin nota', () => {
    for (const v of ['', '   ', '\n\t ', '‮​', 'https://x.y', 5, null, undefined, {}, ['a'], true]) {
      expect(notaLimpia(v), JSON.stringify(v)).toBe('');
    }
  });
  it('lineaLimpia NO cambió: sigue convirtiendo «&», «<», «>» y Cf en espacio (sirve al detalle)', () => {
    expect(lineaLimpia('Juan & Maria <3', 100)).toBe('Juan Maria 3');
    expect(lineaLimpia('a‍b', 100)).toBe('a b');
  });
});

describe('armarPedidoWa usa notaLimpia para `notaCliente`', () => {
  it('«Juan & Maria <3» y el HTML literal se guardan tal cual', () => {
    expect(armar('Juan & Maria <3')?.notaCliente).toBe('Juan & Maria <3');
    expect(armar('<script>alert(1)</script>')?.notaCliente).toBe('<script>alert(1)</script>');
    expect(armar('<b>hola</b>')?.notaCliente).toBe('<b>hola</b>');
  });
  it('emoji compuesto entero; 500 puntos con ZWJ no se parten; 501 se recorta a 500 puntos', () => {
    expect(armar(`x ${FAMILIA}`)?.notaCliente).toBe(`x ${FAMILIA}`);
    const quinientos = FAMILIA.repeat(100); // 5 puntos cada uno = 500
    expect(armar(quinientos)?.notaCliente).toBe(quinientos);
    expect(Array.from(armar(quinientos + '😀')?.notaCliente ?? '')).toHaveLength(MAX_NOTA_WA);
  });
  it('controles → espacio, bidi y enlaces fuera, vacía = sin la clave', () => {
    expect(armar('uno\ndos\ttres cuatro')?.notaCliente).toBe('uno dos tres cuatro');
    expect(armar('a‮b https://x.y')?.notaCliente).toBe('ab');
    for (const v of ['', '\n\t', '‮', 'www.x.y', undefined, 5]) {
      expect(armar(v), JSON.stringify(v)).not.toHaveProperty('notaCliente');
    }
  });
});
