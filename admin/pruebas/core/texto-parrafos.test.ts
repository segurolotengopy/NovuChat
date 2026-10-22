/**
 * Core · texto · párrafos (`Flujos/src/core/texto/parrafos.js`). Los resultados LITERALES son los que dio `rrParrafos` de Rubén (rr.js) el 22/10/2026: el core no cambia el comportamiento ya publicado.
 * El archivo se carga con `new Function` (como lo hace el Code de n8n: sin globales de Node).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos/src/core/texto');
// El código evaluado es el de un archivo del propio repositorio: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
const L = new Function(readFileSync(join(RAIZ, 'parrafos.js'), 'utf8') + '\nreturn { CT_PARRAFO_MAX, ctOraciones, ctEsPregunta, ctParrafos };')() as {
  CT_PARRAFO_MAX: number; ctOraciones: (b: string) => string[]; ctEsPregunta: (o: string) => boolean; ctParrafos: (t: unknown) => string;
};

const CASOS: Array<[string, unknown, string]> = [
  ['abreviaturas', 'Hable con el Dr. Pérez. Es el Sr. López. Atiende hoy. Vienen todos etc. Luego sigue. Nº 5. Abre.', 'Hable con el Dr. Pérez. Es el Sr. López.\n\nAtiende hoy. Vienen todos etc. Luego sigue.\n\nNº 5. Abre.'],
  ['Bs. con cifra', 'Cuesta Bs. 150. Incluye todo. Es el pack. Sale ya.', 'Cuesta Bs. 150. Incluye todo.\n\nEs el pack. Sale ya.'],
  ['lista en línea', '1. Pack 2. Libro 3. Bono', '1. Pack 2. Libro 3. Bono'],
  ['año final parte', 'Vale en 2026. Tiene bonos. Es útil. Llega hoy.', 'Vale en 2026. Tiene bonos.\n\nEs útil. Llega hoy.'],
  ['«No.» no es abreviatura', 'No. El libro no trae videos. Solo texto.', 'No. El libro no trae videos.\n\nSolo texto.'],
  ['pregunta final con emoji', 'Te cuento del libro. Tiene 12 capítulos. ¿Cuál te interesa? 😊', 'Te cuento del libro. Tiene 12 capítulos.\n\n¿Cuál te interesa? 😊'],
  ['bloque con salto no se toca', 'Línea uno.\nLínea dos. Otra más. Y otra.', 'Línea uno.\nLínea dos. Otra más. Y otra.'],
  ['\\r\\n', 'Hola. Qué tal.\r\nSigo. Otra cosa. Más.', 'Hola. Qué tal.\nSigo. Otra cosa. Más.'],
  ['saltos triples', 'Uno.\n\n\n\nDos. Tres. Cuatro. Cinco.', 'Uno.\n\nDos. Tres.\n\nCuatro. Cinco.'],
  ['cifra final parte', 'Cuesta 150. Incluye bonos. Es bueno. Sale hoy.', 'Cuesta 150. Incluye bonos.\n\nEs bueno. Sale hoy.'],
  ['dos preguntas', 'Hola. ¿Puedo ayudarte? ¿Qué necesitas?', 'Hola. ¿Puedo ayudarte?\n\n¿Qué necesitas?'],
  ['vacío', '', ''],
  ['solo espacios', '   ', ''],
  ['null', null, ''],
  ['undefined', undefined, ''],
];

describe('core/texto/parrafos', () => {
  it('tope de 220', () => expect(L.CT_PARRAFO_MAX).toBe(220));
  for (const [nombre, entrada, esperado] of CASOS) it(`literal: ${nombre}`, () => expect(L.ctParrafos(entrada)).toBe(esperado));

  it('negada: ningún párrafo de 3 oraciones ni de más de 220 caracteres con dos', () => {
    const largo = Array.from({ length: 9 }, (_, i) => `Esta es la oración número ${i + 1} del texto de prueba.`).join(' ') + ' ¿Te sirve?';
    for (const entrada of [largo, ...CASOS.map((c) => c[1])]) {
      for (const p of L.ctParrafos(entrada).split('\n\n')) {
        if (p.indexOf('\n') >= 0) continue;
        const n = L.ctOraciones(p).length;
        expect(n).toBeLessThanOrEqual(2);
        if (n === 2) expect(p.length).toBeLessThanOrEqual(220);
      }
    }
  });
  it('negada: dos oraciones que no caben juntas en 220 se separan', () => {
    const a = 'Alfa '.repeat(30).trim() + '.';
    const b = 'Beta '.repeat(20).trim() + '.';
    expect((a + ' ' + b).length).toBeGreaterThan(220);
    expect(L.ctParrafos(a + ' ' + b)).toBe(a + '\n\n' + b);
  });
  it('negada: nunca cambia una palabra, solo reparte espacios en blanco', () => {
    for (const [, entrada] of CASOS) expect(L.ctParrafos(entrada).replace(/\s+/g, '')).toBe(String(entrada ?? '').replace(/\s+/g, ''));
  });
  it('ctEsPregunta: con emoji o espacios tras el «?», no con una afirmación', () => {
    expect(L.ctEsPregunta('¿Cuál te interesa? 😊')).toBe(true);
    expect(L.ctEsPregunta('¿Cuál?  ')).toBe(true);
    expect(L.ctEsPregunta('Te interesa. ¿Cuál? Dime')).toBe(false);
    expect(L.ctEsPregunta('Es el pack.')).toBe(false);
  });
  it('ctOraciones: no parte tras Sr. ni «Bs.» + cifra; sí tras «No.»', () => {
    expect(L.ctOraciones('Habla el Sr. López. Hoy.')).toEqual(['Habla el Sr. López.', 'Hoy.']);
    expect(L.ctOraciones('Son Bs. 150. Listo.')).toEqual(['Son Bs. 150.', 'Listo.']);
    expect(L.ctOraciones('No. El libro.')).toEqual(['No.', 'El libro.']);
  });
  it('corta la entrada a 4096 caracteres antes de partir; hasta 4096 es idéntica a rr.js', () => {
    const base = 'Esta es una oración de prueba. ';
    const largo = base.repeat(400);
    expect(largo.length).toBeGreaterThan(4096);
    expect(L.ctParrafos(largo).replace(/\s+/g, '').length).toBeLessThanOrEqual(4096);
    expect(L.ctParrafos(' '.repeat(100000) + 'x').length).toBeLessThanOrEqual(1);
    const justo = base.repeat(100).slice(0, 4096);
    expect(L.ctParrafos(justo).replace(/\s+/g, '')).toBe(justo.replace(/\s+/g, ''));
  });
});
