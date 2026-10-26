/**
 * `cnNorm` DE «AGENDA MÍNIMA» NO SE DEJA EVADIR CON CARACTERES INVISIBLES (23/10/2026).
 *
 * Las reglas de las prohibiciones 3 (cobro) y 4 (negar ser IA) comparan el texto ya normalizado. Un
 * carácter de etiqueta (U+E0061…) cada dos o tres letras no se ve, pero rompía la frase y la regla no
 * disparaba. La normalización los quita SOLO de la copia que se compara; el texto que sale no se toca.
 *
 * - Diferencial: sin invisibles, la salida es IDÉNTICA a la de la versión anterior (main).
 * - Negadas: las seis frases con etiquetas, ZWSP, ZWJ, selectores de variación y separadores
 *   invisibles quedan iguales a la frase limpia.
 * - Los JSON versionados llevan el mismo código que el fuente.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codigoDe, ejecutar, leerFlujo } from './lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/agenda-minima');
const COMUN = readFileSync(join(RAIZ, 'src/nodos/_comun.js'), 'utf8');
const FUENTE_CNNORM = /function cnNorm\(t\) \{[\s\S]*?\n\}\n/.exec(COMUN)?.[0] ?? '';

type Norm = (t: unknown) => string;
const nueva = ejecutar(`${FUENTE_CNNORM}\nreturn [{ json: { f: cnNorm } }];`, [{}])[0].f as Norm;
// La versión anterior, tal como estaba en main.
const vieja: Norm = (t) =>
  String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

const FRASES = [
  'Tu pago fue acreditado', 'Recibimos tu pago', 'Pago verificado', 'No soy un bot',
  'Soy una persona real', 'Quedó agendada tu cita',
];
const etiqueta = (c: string) => String.fromCodePoint(0xe0000 + c.charCodeAt(0));
const conEtiquetas = (s: string, cada: number) =>
  [...s].map((c, i) => (i % cada === cada - 1 ? c + etiqueta('a') : c)).join('');

describe('cnNorm de agenda-minima', () => {
  it('el fuente lleva escapes, sin caracteres invisibles crudos', () => {
    expect(FUENTE_CNNORM).toContain('\\p{Default_Ignorable_Code_Point}');
    expect(FUENTE_CNNORM).toContain('\\p{Cf}');
    for (const t of [COMUN, ...['agenda-minima.v0.json', 'agenda-minima.prueba.json'].map((j) => readFileSync(join(RAIZ, j), 'utf8'))]) {
      expect(/[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]/u.test(t)).toBe(false);
    }
    expect(/[\u{e0000}-\u{e007f}]/u.test(COMUN)).toBe(false);
  });

  it('diferencial: sin invisibles la salida es idéntica a la de antes', () => {
    const corpus = [
      ...FRASES, 'Hola, ¿tienen hora MAÑANA a las 3:30 pm?', '  Más   espacios\ty\nsaltos ', 'ñandú, canción, ÁÉÍÓÚ ü',
      '', null, undefined, 42, 'reservar 🙂', 'Jueves 01/10 — 9:00-10:00', 'a|b|c',
    ];
    for (const t of corpus) expect(nueva(t)).toBe(vieja(t));
  });

  it.each(FRASES)('«%s» con etiquetas cada 2 y 3 letras queda igual a la limpia', (f) => {
    const limpia = vieja(f);
    expect(limpia).not.toBe('');
    // Control: la versión anterior sí se dejaba romper.
    expect(vieja(conEtiquetas(f, 2))).not.toBe(limpia);
    expect(nueva(conEtiquetas(f, 2))).toBe(limpia);
    expect(nueva(conEtiquetas(f, 3))).toBe(limpia);
  });

  it('otros invisibles: ZWSP, ZWNJ, ZWJ, BOM, joiners, selector de variación, mongol, etiquetas', () => {
    for (const inv of ['\u200b', '\u200c', '\u200d', '\ufeff', '\u2060', '\u2061', '\u2064', '\ufe0f', '\u180e', '\u{e0100}', '\u{e0001}', '\u115f', '\u1160', '\u3164', '\uffa0', '\u17b4', '\u17b5', '\u180b', '\u180c', '\u180d', '\u034f']) {
      expect(nueva(`pago${inv} verificado`)).toBe('pago verificado');
      expect(nueva(`re${inv}ci${inv}bimos tu pago`)).toBe('recibimos tu pago');
    }
  });

  it('Braille U+2800 cuenta como espacio: separa palabras en vez de pegarlas', () => {
    expect(nueva('pago\u2800verificado')).toBe('pago verificado');
    expect(nueva('no\u2800soy\u2800un\u2800bot')).toBe('no soy un bot');
  });

  it('emojis con ZWJ, VS16 y keycap, y el texto sano, se normalizan sin perder letras', () => {
    expect(nueva('no hemos recibido comprobante')).toBe('no hemos recibido comprobante');
    for (const e of ['\u{1F468}\u200D\u2695\uFE0F', '\u2764\uFE0F', '\u{1F469}\u200D\u{1F469}\u200D\u{1F467}', '1\uFE0F\u20E3', '\u{1F44B}\u{1F3FD}']) {
      expect(nueva(`hola ${e} mundo`)).toBe(vieja(`hola ${e} mundo`.replace(/[\u200D\uFE0F]/g, '')));
    }
  });

  it('un invisible entre palabras no quita el espacio real', () => {
    expect(nueva(`no soy${etiqueta('a')} un bot`)).toBe('no soy un bot');
  });

  it('los JSON versionados llevan el cnNorm del fuente', () => {
    for (const j of ['agenda-minima.v0.json', 'agenda-minima.prueba.json']) {
      const f = leerFlujo(`experimental/agenda-minima/${j}`);
      const conNorm = f.nodes.filter((n) => typeof n.parameters?.jsCode === 'string' && n.parameters.jsCode.includes('function cnNorm'));
      expect(conNorm.length).toBeGreaterThan(0);
      for (const n of conNorm) expect(codigoDe(f, n.name)).toContain(FUENTE_CNNORM.trimEnd());
    }
  });
});
