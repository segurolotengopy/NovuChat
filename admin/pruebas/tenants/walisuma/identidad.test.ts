/**
 * IDENTIDAD en Walisuma (decisión 2 de Andres, 18/11/2026): el asistente dice que es una IA SOLO SI LE PREGUNTAN, y nunca lo niega. El saludo es la identidad del MD
 * («asistente de atención y ventas de Walisuma»), sin «IA»; la respuesta a «¿eres un bot?» es un texto fijo del código que SÍ lo dice; todo texto que se presente como
 * «asistente virtual» sigue saliendo «con IA» (pieza común `identidad.js`, aplicada en `wlSeguro`). Costo: 0 mensajes. Se prueba NEGANDO.
 * PENDIENTE (informe del 18/11): la excepción declarada en `EXCEPCIONES_DE_IDENTIDAD` exige una fecha de vencimiento y Andres decidió que esta no tenga fecha.
 */
import { describe, expect, it } from 'vitest';
import { ANA, EXTRANJERO, crear, hablar, mTexto, modelo } from './mundo';

const NIEGA = /no soy (un |una )?(bot|robot|ia|inteligencia artificial)|soy (una )?persona (real|de verdad)|humano/i;

describe('Walisuma dice que es una IA si le preguntan, y nunca lo niega', () => {
  it('el saludo de la primera respuesta es «asistente de atención y ventas», sin «IA» (decisión 2)', () => {
    const t = hablar(crear({ modeloDice: modelo('Con gusto le ayudamos.') }), ANA, mTexto('hola'));
    const primero = t.mensajes[0]?.cuerpo ?? '';
    expect(primero).toMatch(/^Hola, soy el asistente de atención y ventas de /);
    expect(primero).not.toMatch(/\bIA\b|inteligencia artificial/);
  });
  it('«¿eres un bot?», «¿hablo con una persona?»: el texto fijo dice «inteligencia artificial», sin llamar al modelo', () => {
    for (const p of ['¿eres un bot?', '¿hablo con una persona?', '¿eres una IA?']) {
      const t = hablar(crear({ modeloDice: modelo('Soy una persona real.') }), ANA, mTexto(p));
      expect(t.mensajes[0]?.cuerpo, p).toMatch(/inteligencia artificial/);
      expect(t.registro.map((r) => r.nodo), p).not.toContain('Conversar con el modelo');
    }
  });
  it('NEGADO: ningún mensaje niega ser una IA, aunque el modelo lo intente', () => {
    const t = hablar(crear({ modeloDice: modelo('No soy un robot, soy una persona real.') }), ANA, mTexto('hola'));
    for (const m of t.mensajes) expect(m.cuerpo ?? '').not.toMatch(NIEGA);
  });
  it('un texto fijo que se presenta como «asistente virtual» sale «con IA» (la pieza común sigue aplicada)', () => {
    const t = hablar(crear(), EXTRANJERO, mTexto('hola'));
    for (const m of t.mensajes) expect(m.cuerpo ?? '').not.toMatch(/asistente virtual(?! con IA)/);
  });
});
