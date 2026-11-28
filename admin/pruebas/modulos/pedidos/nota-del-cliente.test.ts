/**
 * LA CONSOLA MUESTRA LA NOTA DEL CLIENTE EN «PEDIDOS», COMO TEXTO PLANO.
 *
 * Se demuestra NEGANDO: la función pura nunca devuelve HTML ni deja pasar
 * controles o marcas bidi; todo lo que no es texto da vacío; y la pantalla
 * (leída como código fuente, igual que `csv-formulas.test.ts`) solo pinta el
 * bloque si hay nota, con el rótulo fijo, sin HTML crudo ni enlaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MAX_NOTA_CLIENTE, notaDelCliente, ROTULO_NOTA_CLIENTE,
} from '../../../web/src/modulos/pedidos/notaDelCliente.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const PEDIDOS = readFileSync(join(aqui, '../../../web/src/modulos/pedidos/Pedidos.tsx'), 'utf8');

/** El bloque JSX de la nota del cliente: desde su guarda hasta el cierre del `div`. */
function bloque(): string {
  const ini = PEDIDOS.indexOf("{notaCliente !== '' && (");
  expect(ini).toBeGreaterThan(-1);
  const fin = PEDIDOS.indexOf('</div>', ini);
  return PEDIDOS.slice(ini, fin + 6);
}

describe('notaDelCliente (función pura)', () => {
  it('un texto normal pasa tal cual, con sus saltos de línea', () => {
    expect(notaDelCliente('Sin cebolla, por favor')).toBe('Sin cebolla, por favor');
    expect(notaDelCliente('línea 1\nlínea 2')).toBe('línea 1\nlínea 2');
  });

  it('500 puntos de código entran enteros; más de 500 se recortan a 500 puntos', () => {
    expect(Array.from(notaDelCliente('a'.repeat(500)))).toHaveLength(500);
    expect(Array.from(notaDelCliente('a'.repeat(501)))).toHaveLength(MAX_NOTA_CLIENTE);
    expect(Array.from(notaDelCliente('b'.repeat(9000)))).toHaveLength(500);
    // Los emojis cuentan por punto de código, no por unidad UTF-16: 500 emojis (1000 unidades) entran enteros.
    expect(notaDelCliente('😀'.repeat(500))).toBe('😀'.repeat(500));
    expect(notaDelCliente('😀'.repeat(501))).toBe('😀'.repeat(500));
  });

  it('recorta espacios y saltos al inicio y al final', () => {
    expect(notaDelCliente('\n\n  hola \n')).toBe('hola');
  });

  it('el corte a 500 no parte un par sustituto (emoji)', () => {
    const r = notaDelCliente('a'.repeat(499) + '😀' + 'b');
    expect(r).toBe('a'.repeat(499) + '😀');
    expect(/[\uD800-\uDBFF]$/.test(r)).toBe(false);
  });

  it('conserva «&», «<», «>» y el ZWJ (emoji compuesto) sin escapar ni convertir', () => {
    expect(notaDelCliente('Juan & Maria <3')).toBe('Juan & Maria <3');
    expect(notaDelCliente('a > b && c < d')).toBe('a > b && c < d');
    const familia = '👨\u200d👩\u200d👧';
    expect(notaDelCliente(`hola ${familia}`)).toBe(`hola ${familia}`);
    expect(notaDelCliente(`${familia}\ufe0f`)).toBe(`${familia}\ufe0f`); // selector de variación
    expect(notaDelCliente('&lt;b&gt;')).toBe('&lt;b&gt;'); // no des-escapa ni re-escapa
  });

  it('quita controles y marcas bidi', () => {
    expect(notaDelCliente('ho\u0000l\u0007a')).toBe('hola');
    expect(notaDelCliente('‮abc‬⁦d⁩‎‏')).toBe('abcd');
  });

  it('HTML y enlaces quedan como texto inofensivo, sin elementos', () => {
    expect(notaDelCliente('<b>x</b>')).toBe('<b>x</b>');
    expect(notaDelCliente('<b>hola</b>')).toBe('<b>hola</b>');
    expect(notaDelCliente('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
    expect(notaDelCliente('https://malo.example/x')).toBe('https://malo.example/x');
  });

  it('lo que no es texto, lo vacío y lo de solo espacios dan vacío', () => {
    for (const v of [5, {}, [], ['a'], null, undefined, true, '', '   ', '\n\t ', '\u0000‎']) {
      expect(notaDelCliente(v)).toBe('');
    }
  });
});

describe('Pedidos.tsx — bloque de la nota del cliente', () => {
  it('el rótulo es la constante exportada y dice que no es un estado de pago', () => {
    expect(ROTULO_NOTA_CLIENTE).toBe('Nota escrita por el cliente (no es un estado de pago):');
    expect(bloque()).toContain('{ROTULO_NOTA_CLIENTE}');
    // El rótulo no se escribe a mano en la pantalla.
    expect(PEDIDOS).not.toContain('Nota escrita por el cliente');
  });

  it('solo se pinta si hay nota: la guarda usa la función pura sobre notaCliente', () => {
    expect(PEDIDOS).toContain('const notaCliente = notaDelCliente(p.notaCliente);');
    expect(PEDIDOS).toContain("{notaCliente !== '' && (");
    // Rótulo y texto viven DENTRO de la guarda, no fuera de ella.
    const antes = PEDIDOS.slice(0, PEDIDOS.indexOf("{notaCliente !== '' && ("));
    expect(antes).not.toContain('ROTULO_NOTA_CLIENTE}');
    expect(antes).not.toContain('pedido-nota-cliente-texto');
  });

  it('el bloque no usa role ni aria-label (no repite la nota al lector de pantalla)', () => {
    expect(bloque()).not.toMatch(/role=|aria-label/);
  });

  it('el campo viejo `nota` no alimenta este bloque', () => {
    expect(bloque()).not.toMatch(/p\.nota\b/);
    expect(PEDIDOS).not.toMatch(/notaDelCliente\(p\.nota\)/);
  });

  it('la nota se pinta como hijo de React (texto), nunca como elemento ni HTML', () => {
    expect(bloque()).toContain('<p className="pedido-nota-cliente-texto">{notaCliente}</p>');
    expect(PEDIDOS).not.toMatch(/dangerouslySetInnerHTML|innerHTML|createElement\(|DOMParser|marked|markdown/i);
    expect(PEDIDOS).not.toMatch(/notaCliente\s*[=.][^;\n]*\.replace\(/); // no se escapa a mano
  });

  it('texto plano: sin HTML crudo, sin enlaces ni markdown en el bloque', () => {
    const b = bloque();
    expect(PEDIDOS).not.toContain('dangerouslySetInnerHTML');
    expect(b).not.toContain('<a');
    expect(b).not.toContain('href');
    expect(b).not.toMatch(/markdown|innerHTML/i);
    expect(b).toContain('{notaCliente}');
  });

  it('el estilo conserva saltos de línea y no desborda', () => {
    const css = readFileSync(join(aqui, '../../../web/src/central/estilos/estilos.css'), 'utf8');
    const m = /\.pedido-nota-cliente-texto\s*\{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('white-space: pre-wrap');
    expect(m![1]).toContain('overflow-wrap: anywhere');
  });
});
