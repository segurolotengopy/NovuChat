/**
 * EL PULIDO CONSERVA LOS SALTOS DE LÍNEA DEL ORIGEN (`cmPulirRedaccion`, `Flujos/src/core/texto/filtro-redaccion.js`).
 *
 * Antes, el pulido partía por oraciones y las volvía a unir con un espacio: una lista con viñetas o dos párrafos del
 * modelo salían como UN párrafo corrido (reclamo de Andres: «los listados tienen que ir con viñetas»). Ahora el
 * separador entre oraciones es el del origen (espacio, `\n` o `\n\n`); un texto sin saltos queda idéntico.
 * Cada caso tiene su negativo: lo que no debe cambiar, no cambia.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from '../lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos');
const FUENTE = readFileSync(join(RAIZ, 'src/core/texto/filtro-redaccion.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const F = ejecutar(`${FUENTE}\nreturn [{ json: { cmPulirRedaccion, cmRevisarRedaccion, cmMotivoDeRechazo } }];`, [{}])[0] as
  Record<'cmPulirRedaccion' | 'cmRevisarRedaccion' | 'cmMotivoDeRechazo', Fn>;
const pulir = (t: string, o?: object): string => F.cmPulirRedaccion(t, o);

describe('las viñetas y los párrafos del origen se conservan', () => {
  it('una lista con viñetas sale una por línea (modo estricto y no estricto)', () => {
    const t = 'Tenemos estas opciones:\n- Pack básico\n- Pack medio\n- Pack completo\n¿Cuál te interesa?';
    expect(pulir(t, { maxOraciones: 8 })).toBe(t);
    expect(pulir(t)).toBe(t);
  });
  it('viñetas con punto final cada una siguen una por línea', () => {
    const t = 'Opciones:\n• Uno incluye mate.\n• Dos incluye taza.\n• Tres incluye ambos.';
    expect(pulir(t, { maxOraciones: 8 })).toBe(t);
    expect(pulir(t)).toBe(t);
  });
  it('dos párrafos separados por una línea en blanco se conservan', () => {
    const t = 'Te cuento del libro. Tiene doce capítulos.\n\n¿Cuál te interesa?';
    expect(pulir(t, { maxOraciones: 8 })).toBe(t);
    expect(pulir(t)).toBe(t);
  });
  it('dentro de una misma línea las oraciones siguen unidas con un espacio', () => {
    expect(pulir('Una. Dos.\nTres. Cuatro.', { maxOraciones: 8 })).toBe('Una. Dos.\nTres. Cuatro.');
    expect(pulir('Una.   Dos.', { maxOraciones: 8 })).toBe('Una. Dos.');
  });
  it('NEGATIVO: el salto que NO está en el origen no se inventa', () => {
    expect(pulir('Una. Dos. Tres.', { maxOraciones: 8 })).toBe('Una. Dos. Tres.');
  });
});

describe('un texto de una sola línea queda idéntico a antes (byte a byte)', () => {
  // Las salidas esperadas son LITERALES, tomadas del comportamiento anterior al cambio (27/11/2026).
  const CASOS: Array<[string, object | undefined, string]> = [
    ['Tenemos lugar el viernes a las 11:30. ¿Te sirve?', undefined, 'Tenemos lugar el viernes a las 11:30. ¿Te sirve?'],
    ['Hola. Soy la asistente de Casa. Claro que sí, atendemos hasta las 18:00. ¿Algo más?', undefined, 'Atendemos hasta las 18:00. ¿Algo más?'],
    ['Hola. Soy la asistente de Casa. Claro que sí, atendemos hasta las 18:00. ¿Algo más?', { maxOraciones: 2 }, 'Atendemos hasta las 18:00. ¿Algo más?'],
    ['Habla con el Dr. Pérez. Atiende hoy 😊 ¿Vienes?', { maxOraciones: 8 }, 'Habla con el Dr. Pérez. Atiende hoy 😊 ¿Vienes?'],
    ['Hola. Claro que sí, tenemos mesa. ¿Para cuántos?', undefined, 'Tenemos mesa. ¿Para cuántos?'],
    ['Sin signos al final', undefined, 'Sin signos al final'],
    ['Una.   Dos.  Tres.', { nombreNegocio: 'Casa Bermejo' }, 'Una. Dos. Tres.'],
    ['', undefined, ''],
    ['   ', undefined, ''],
  ];
  for (const [t, o, esperado] of CASOS) {
    it(`${JSON.stringify(t)} ${JSON.stringify(o)}`, () => {
      expect(pulir(t, o)).toBe(esperado);
    });
  }
});

describe('una lista NUNCA se recorta ni cuenta para maxOraciones (Estándar 3.2 y 2.2)', () => {
  const cinco = 'Tenemos:\n- Pack básico\n- Pack medio\n- Pack completo\n- Pack plus\n- Pack premium';
  it('con el tope de 4 de Walisuma, cinco viñetas salen las cinco y sin motivo', () => {
    expect(pulir(cinco, { maxOraciones: 4 })).toBe(cinco);
    expect(F.cmMotivoDeRechazo(cinco, { maxOraciones: 4 })).toBe('');
  });
  it('con el tope de 6 de Bermejo, siete viñetas salen las siete', () => {
    const siete = 'Tenemos:\n' + [1, 2, 3, 4, 5, 6, 7].map((n) => `• Producto ${n}`).join('\n');
    expect(pulir(siete, { maxOraciones: 6 })).toBe(siete);
    expect(F.cmRevisarRedaccion(siete, { maxOraciones: 6 })).toEqual({ texto: siete, motivo: '' });
  });
  it('una lista numerada tampoco se recorta', () => {
    const t = 'Opciones:\n1. Uno\n2. Dos\n3. Tres\n4. Cuatro';
    expect(pulir(t, { maxOraciones: 1 })).toBe(t);
  });
  it('la lista no se recorta ni con una pregunta al final: el tope sigue siendo de la prosa', () => {
    const t = 'Opciones:\n- A\n- B\n- C\n¿Cuál prefieres?';
    expect(pulir(t, { maxOraciones: 2 })).toBe(t);
  });
  it('NEGATIVO: la prosa que rodea a la lista SÍ cuenta y se recorta, con sus viñetas intactas', () => {
    const t = 'Uno. Dos. Tres.\n- A\n- B';
    expect(pulir(t, { maxOraciones: 2 })).toBe('Uno. Dos.\n- A\n- B');
    expect(F.cmMotivoDeRechazo(t, { maxOraciones: 2 })).toBe('largo_en_oraciones');
  });
  it('I-C NEGATIVO: la pregunta que conserva el tope no se pega a la última viñeta; toma el separador del lugar que reemplaza', () => {
    const t = 'Mira.\nUno más.\n- Pieza 1\n- Pieza 2\nOtra cosa. ¿Cuál?';
    expect(pulir(t, { maxOraciones: 2 })).toBe('Mira.\n- Pieza 1\n- Pieza 2\n¿Cuál?');
    expect(pulir('Uno. Dos.\n- A\n- B\nTres. ¿Cuál?', { maxOraciones: 2 })).toBe('Uno.\n- A\n- B\n¿Cuál?');
    expect(pulir('Uno. Dos.\n- A\n- B\nTres. ¿Cuál?', { maxOraciones: 2 })).not.toMatch(/B ¿/);
  });
  it('M2 NEGATIVO: una lista ANTES de la prosa tampoco consume el tope: la prosa de después se conserva', () => {
    const t = 'Opciones:\n- A\n- B\n- C\nUno. Dos.';
    expect(pulir(t, { maxOraciones: 3 })).toBe(t);
    expect(F.cmMotivoDeRechazo(t, { maxOraciones: 3 })).toBe('');
  });
  it('M7 NEGATIVO: la pregunta que conserva el tope toma el salto del lugar que reemplaza, sin viñetas de por medio', () => {
    expect(pulir('Uno.\nDos. Tres. ¿Cuál?', { maxOraciones: 2 })).toBe('Uno.\n¿Cuál?');
    expect(pulir('Uno.\n\nDos. Tres. ¿Cuál?', { maxOraciones: 2 })).toBe('Uno.\n\n¿Cuál?');
    expect(pulir('Uno.\nDos. Tres. ¿Cuál?', { maxOraciones: 2 })).not.toBe('Uno. ¿Cuál?');
  });
  it('M9 NEGATIVO: una viñeta de dos oraciones no cuenta para el tope: la segunda oración hereda la marca de lista', () => {
    const t = 'Hay:\n- Mate. Bs 25.\n- Taza. Bs 30.\n- Set. Bs 40.';
    expect(pulir(t, { maxOraciones: 2 })).toBe(t);
    // Con cifras en pesos el motivo es otro («monto», regla ajena al tope); sin ellas, el tope no rechaza.
    const sinMonto = 'Hay:\n- Mate. Muy útil.\n- Taza. Muy linda.\n- Set. Completo.';
    expect(pulir(sinMonto, { maxOraciones: 2 })).toBe(sinMonto);
    expect(F.cmMotivoDeRechazo(sinMonto, { maxOraciones: 2 })).toBe('');
  });
  it('NEGATIVO: sin viñetas, las líneas siguen contando como oraciones', () => {
    expect(pulir('Uno\nDos\nTres\nCuatro', { maxOraciones: 3 })).toBe('Uno\nDos\nTres');
    expect(F.cmMotivoDeRechazo('Uno\nDos\nTres\nCuatro', { maxOraciones: 3 })).toBe('largo_en_oraciones');
  });
  it('párrafos: se corta por oración entera y el salto de párrafo se queda', () => {
    expect(pulir('Uno. Dos.\n\nTres. Cuatro.', { maxOraciones: 3 })).toBe('Uno. Dos.\n\nTres.');
  });
});

describe('una viñeta que termina en un número y punto no se pega a la siguiente (B2)', () => {
  it('«Bs 25.» y «Pack de 2.» siguen cada una en su línea', () => {
    const t = 'Hay:\n• Mate Bs 25.\n• Taza Bs 30.\n• Pack de 2.\n• Set de 12.';
    expect(pulir(t, { maxOraciones: 8 })).toBe(t);
    expect(pulir(t, { maxOraciones: 8 })).not.toMatch(/25\. •/);
  });
  it('NEGATIVO: el numeral suelto sigue uniéndose a su texto y «Dr.» no cierra oración', () => {
    expect(pulir('1.\nPack básico', { maxOraciones: 8 })).toBe('1. Pack básico');
    expect(pulir('Habla con el Dr.\nPérez ahora', { maxOraciones: 8 })).toBe('Habla con el Dr. Pérez ahora');
  });
});

describe('el rechazo no cambia', () => {
  it('maxOraciones: la prosa con más líneas que el tope sigue rechazada, y la que cabe pasa', () => {
    expect(F.cmMotivoDeRechazo('Uno\nDos\nTres', { maxOraciones: 2 })).toBe('largo_en_oraciones');
    expect(F.cmMotivoDeRechazo('Uno\nDos\nTres', { maxOraciones: 3 })).toBe('');
  });
  it('maximo: el texto largo sigue rechazado como `largo`', () => {
    expect(F.cmMotivoDeRechazo('a'.repeat(50), { maximo: 40 })).toBe('largo');
    expect(F.cmMotivoDeRechazo('a'.repeat(30), { maximo: 40 })).toBe('');
  });
  it('cmRevisarRedaccion devuelve el texto con sus saltos y el motivo vacío', () => {
    const r = F.cmRevisarRedaccion('Opciones:\n- Uno\n- Dos', { maxOraciones: 5 });
    expect(r).toEqual({ texto: 'Opciones:\n- Uno\n- Dos', motivo: '' });
  });
});

describe('Walisuma y Q\'Taco: sus flujos no cambian', () => {
  // Los flujos de cliente usan el filtro con `maxOraciones` y textos de una sola línea; con el pulido nuevo,
  // un texto sin saltos sale igual. La prueba de «al día» (JSON contra fuente) la cubren sus suites de armado.
  it('un texto de venta de una línea sale igual con las opciones típicas', () => {
    const t = 'Tenemos el libro digital a la venta. ¿Te lo envío por este medio?';
    expect(pulir(t, { maxOraciones: 3, nombreNegocio: 'Walisuma' })).toBe(t);
    expect(pulir(t, { maxOraciones: 3, nombreNegocio: "Q'Taco" })).toBe(t);
  });
  it('NEGATIVO: el texto sin saltos nunca sale con un salto', () => {
    expect(pulir('Uno. Dos. Tres. ¿Cuatro?', { maxOraciones: 8 })).not.toMatch(/\n/);
  });
});
