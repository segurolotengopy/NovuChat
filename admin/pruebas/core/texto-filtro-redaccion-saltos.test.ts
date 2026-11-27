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

describe('el recorte por maxOraciones corta por línea u oración entera', () => {
  it('no deja una viñeta partida y conserva los saltos de las que quedan', () => {
    const t = 'Opciones:\n- Pack básico\n- Pack medio\n- Pack completo\n- Pack plus';
    expect(pulir(t, { maxOraciones: 3 })).toBe('Opciones:\n- Pack básico\n- Pack medio');
  });
  it('si la última era una pregunta, esa pregunta reemplaza a la última conservada, con su salto', () => {
    const t = 'Opciones:\n- Pack básico\n- Pack medio\n¿Cuál prefieres?';
    expect(pulir(t, { maxOraciones: 3 })).toBe('Opciones:\n- Pack básico\n¿Cuál prefieres?');
  });
  it('párrafos: se corta por oración entera y el salto de párrafo se queda', () => {
    const t = 'Uno. Dos.\n\nTres. Cuatro.';
    expect(pulir(t, { maxOraciones: 3 })).toBe('Uno. Dos.\n\nTres.');
  });
});

describe('el rechazo no cambia', () => {
  it('maxOraciones: la lista con más líneas que el tope sigue rechazada, y la que cabe pasa', () => {
    const t = 'Opciones:\n- A\n- B\n- C';
    expect(F.cmMotivoDeRechazo(t, { maxOraciones: 3 })).toBe('largo_en_oraciones');
    expect(F.cmMotivoDeRechazo(t, { maxOraciones: 4 })).toBe('');
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
