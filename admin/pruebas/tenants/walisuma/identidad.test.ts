/**
 * IDENTIDAD en el esqueleto de Walisuma: el primer mensaje dice «asistente virtual con IA» (pieza común `Flujos/src/core/texto/identidad.js`, aplicada
 * en `Seguro` a todo texto que sale). Costo: 0 mensajes agregados (cambian dos palabras del texto que ya salía). Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, EXTRANJERO, crear, hablar, mTexto } from './mundo';

const CON_IA = /asistente virtual con IA/;
const SIN_IA = /asistente virtual(?! con IA)/;

describe('el primer mensaje dice que es una IA', () => {
  it('el saludo de la primera respuesta: «asistente virtual con IA»', () => {
    const t = hablar(crear(), ANA, mTexto('hola'));
    const primero = t.mensajes[0]?.cuerpo ?? '';
    expect(primero).toMatch(CON_IA);
    expect(primero).not.toMatch(SIN_IA);
  });
  it('desde fuera de los países atendidos, el texto fijo también lo dice', () => {
    const t = hablar(crear(), EXTRANJERO, mTexto('hola'));
    const texto = t.mensajes.map((m) => m.cuerpo ?? '').join('\n');
    expect(texto).toMatch(CON_IA);
    expect(texto).not.toMatch(SIN_IA);
  });
  it('NIEGA: ningún mensaje de la conversación se presenta como «asistente virtual» a secas', () => {
    const mundo = crear();
    const t1 = hablar(mundo, ANA, mTexto('hola'));
    const t2 = hablar(mundo, ANA, mTexto('quiero ver el catálogo'));
    for (const t of [t1, t2]) for (const m of t.mensajes) expect(m.cuerpo ?? '').not.toMatch(SIN_IA);
  });
});
