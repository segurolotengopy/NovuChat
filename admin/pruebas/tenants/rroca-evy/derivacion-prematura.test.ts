/**
 * DERIVACIÓN PREMATURA Y TOPE DE 700 (humo del 24/10/2026). «Quiero ver cómo queda» derivó a recepción porque el MODELO emitió [DERIVAR_RECEPCION] por su cuenta, y la rama de derivación descartó las imágenes pedidas.
 * La etiqueta del modelo solo se honra si el cliente pidió agendar, aceptó una oferta de agendar o de pasar con recepción, o dio su nombre; si no, se ignora, se conserva el texto y salen las imágenes.
 * Y ningún mensaje del modelo pasa de 700 caracteres: se recorta por oración, nunca a mitad de oración, y la pregunta final es lo último que se conserva.
 */
import { describe, expect, it } from 'vitest';
import { ANA, IDS, avisosARecepcion, crear, dice, hablar, imagenes, mTexto, textos } from './mundo';

const ANTES = '[ENVIAR_ARTE_ANTES_DESPUES] Mira el caso real de una paciente de la Dra. Evy. [DERIVAR_RECEPCION]';
const esBoton = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((e) => e.tipo === 'interactive');

describe('la etiqueta de derivación del modelo no se honra sin que el cliente pida agendar', () => {
  it('NEGADA: «Quiero ver cómo queda» con la etiqueta del modelo no deriva y envía el ANTES_DESPUES', () => {
    const t = hablar(crear({ modeloDice: dice(ANTES) }), ANA, mTexto('Quiero ver cómo queda'));
    expect(esBoton(t)).toBe(false);
    expect(avisosARecepcion(t).length).toBe(0);
    expect(imagenes(t)).toEqual([IDS.antes_despues]);
    expect(textos(t).join(' ')).toContain('Mira el caso real');
  });
  for (const q of ['¿Cuánto cuesta?', '¿Qué diferencia hay entre Radiesse y HArmonyCa?', 'Hola', 'Cuéntame más']) {
    it(`NEGADA: «${q}» con la etiqueta del modelo no deriva`, () => {
      const t = hablar(crear({ modeloDice: dice('Con gusto te cuento sobre la valoración. [DERIVAR_RECEPCION]') }), ANA, mTexto(q));
      expect(esBoton(t), q).toBe(false);
      expect(avisosARecepcion(t).length, q).toBe(0);
      expect(textos(t).join(' '), q).toContain('Con gusto te cuento');
    });
  }
  it('NEGADA: «Soy Paola, ¿qué es HArmonyCa?» (un nombre CON una pregunta) con la etiqueta no deriva', () => {
    const t = hablar(crear({ modeloDice: dice('Es un bioestimulador. [DERIVAR_RECEPCION: Paola]') }), ANA, mTexto('Soy Paola, ¿qué es HArmonyCa?'));
    expect(esBoton(t)).toBe(false);
  });
  it('POSITIVA: «Quiero agendar mi valoración» deriva (con o sin la etiqueta)', () => {
    for (const modelo of ['[DERIVAR_RECEPCION: Ana]', 'Perfecto.']) {
      const t = hablar(crear({ modeloDice: dice(modelo) }), ANA, mTexto('Quiero agendar mi valoración'));
      expect(esBoton(t), modelo).toBe(true);
      expect(textos(t)[0]).toMatch(/Excelente decisión/);
    }
  });
  it('POSITIVA: «sí» tras la oferta de agendar deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? 'Excelente. [DERIVAR_RECEPCION]' : 'Te cuento: la valoración es gratuita. ¿Te gustaría agendar tu valoración?') });
    const t1 = hablar(m, ANA, mTexto('cuéntame de la valoración'));
    expect(esBoton(t1)).toBe(false);
    const t2 = hablar(m, ANA, mTexto('sí'));
    expect(esBoton(t2)).toBe(true);
  });
  it('POSITIVA: «dale» tras «¿te paso con recepción?» deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<dale>>>') ? '[DERIVAR_RECEPCION]' : 'Perfecto. ¿Te paso con recepción para elegir el horario?') });
    hablar(m, ANA, mTexto('me interesa'));
    expect(esBoton(hablar(m, ANA, mTexto('dale')))).toBe(true);
  });
  it('POSITIVA: el nombre tras la oferta (etiqueta con nombre, sin pregunta) deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<Paola>>>') ? 'Gracias. [DERIVAR_RECEPCION: Paola]' : 'Con gusto. ¿Cómo te llamas para pasarte con recepción?') });
    hablar(m, ANA, mTexto('quiero información'));
    const t = hablar(m, ANA, mTexto('Paola'));
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]).toMatch(/Excelente decisión, Paola/);
  });
  it('NEGADA: un «sí» SIN oferta previa de agendar (el asistente preguntó otra cosa) no deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<claro>>>') ? 'Genial. [DERIVAR_RECEPCION]' : 'Radiesse activa el colágeno. ¿Te cuento la diferencia con HArmonyCa?') });
    hablar(m, ANA, mTexto('qué es Radiesse'));
    expect(esBoton(hablar(m, ANA, mTexto('claro')))).toBe(false);
  });
  it('no rompe la etiqueta sin texto (variante corta) ni el cierre completo único', () => {
    const m = crear({ modeloDice: dice('[DERIVAR_RECEPCION: Paola]') });
    expect(textos(hablar(m, ANA, mTexto('quiero agendar')))[0]).toMatch(/Excelente decisión, Paola/);
    expect(textos(hablar(m, ANA, mTexto('quiero agendar de nuevo')))[0]).toContain('Claro, aquí tienes');
  });
});

describe('tope de 700 caracteres por mensaje: recorte por oración, la pregunta final al final', () => {
  const RELLENO = Array.from({ length: 12 }, (_, i) => `Esta es la oración de relleno número ${i + 1} sobre el efecto lifting natural y el contorno del rostro.`).join(' ');
  const SALUDO = `¡Hola! Soy el asistente virtual de la Dra. Evy. ${RELLENO} Tu valoración con la Dra. Evy es 100% gratuita y sin compromiso. ¿Cómo te llamas y qué te gustaría mejorar en tu rostro?`;
  it('un saludo de ~1000+ caracteres sale en 700 o menos, termina en oración completa y conserva la pregunta', () => {
    expect(SALUDO.length).toBeGreaterThan(1000);
    const t = textos(hablar(crear({ modeloDice: dice(SALUDO) }), ANA, mTexto('hola')))[0]!;
    expect(t.length).toBeLessThanOrEqual(700);
    expect(t.endsWith('¿Cómo te llamas y qué te gustaría mejorar en tu rostro?')).toBe(true);
    expect(t).toContain('Soy el asistente virtual de la Dra. Evy.');
    expect(t).toContain('100% gratuita y sin compromiso');
    // nunca a mitad de oración: cada oración del relleno que queda está completa
    for (const m of t.matchAll(/Esta es la oración de relleno número (\d+)([^.]*)\./g)) expect(m[2]).toBe(' sobre el efecto lifting natural y el contorno del rostro');
    expect(t).not.toMatch(/relleno número \d+ sobre el efecto lifting natural y el contorno del rostro\.\s*Esta es la oración de relleno número \d+ sobre el efecto lifting natural y el contor$/);
  });
  it('un texto corto no cambia', () => {
    const corto = 'Con gusto. Tu valoración es gratuita y sin compromiso. ¿Cómo te llamas?';
    expect(textos(hablar(crear({ modeloDice: dice(corto) }), ANA, mTexto('hola')))[0]).toBe('Con gusto. Tu valoración es gratuita y sin compromiso.\n\n¿Cómo te llamas?');
  });
  it('los textos fijos (cierre, gratuidad, cuidados) no se recortan: ninguno pasa de 700', () => {
    const cierre = textos(hablar(crear({ modeloDice: dice('[DERIVAR_RECEPCION: Paola]') }), ANA, mTexto('quiero agendar')))[0]!;
    expect(cierre.length).toBeLessThanOrEqual(700);
    const gratis = textos(hablar(crear({ modeloDice: 'cae' }), ANA, mTexto('¿es gratis?')))[0]!;
    expect(gratis.length).toBeLessThanOrEqual(700);
    expect(gratis).toContain('100% gratuita');
  });
});
