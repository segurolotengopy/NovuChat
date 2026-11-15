/**
 * Core · texto · identidad «asistente virtual con IA» (`Flujos/src/core/texto/identidad.js`). El archivo se carga con `node:vm` en un
 * contexto vacío (como el Code de n8n: sin globales de Node).
 */
import { describe, expect, it } from 'vitest';
import { cargarFuente } from './fuente-vm';

const L = cargarFuente<{ ctConIA: (t: unknown) => string; ctDiceIA: (t: unknown) => boolean; CT_ROTULO_IA: string }>(
  ['Flujos/src/core/texto/identidad.js'], ['ctConIA', 'ctDiceIA', 'CT_ROTULO_IA'],
);

describe('ctConIA', () => {
  it.each([
    ['Hola, soy el asistente virtual de Casa X.', 'Hola, soy el asistente virtual con IA de Casa X.'],
    ['Hola, soy el asistente virtual.', 'Hola, soy el asistente virtual con IA.'],
    ['¡Hola! 👋 Soy Ana, el asistente virtual. ¿Qué te gustaría hacer?', '¡Hola! 👋 Soy Ana, el asistente virtual con IA. ¿Qué te gustaría hacer?'],
    ['Soy el Asistente Virtual de X', 'Soy el Asistente Virtual con IA de X'],
    ['Hola, soy el asistente virtual de X.\n\nSomos A y asistente virtual otra vez', 'Hola, soy el asistente virtual con IA de X.\n\nSomos A y asistente virtual otra vez'],
  ])('SÍ agrega «con IA» una vez: «%s»', (entra, sale) => { expect(L.ctConIA(entra)).toBe(sale); });

  it.each([
    'Hola, soy el asistente virtual con IA de X.',
    'Soy el asistente virtual de X, una inteligencia artificial.',
    'Soy el asistente virtual con inteligencia artificial.',
    'Soy un asistente virtual de X, una IA que ayuda.',
    'Hola, ¿en qué te ayudo?',
    '',
  ])('NIEGA: no cambia «%s» (ya lo dice o no se presenta)', (t) => { expect(L.ctConIA(t)).toBe(t); });

  it('NIEGA: una «IA» en OTRA oración (un producto, una URL, el modelo) no tapa la presentación', () => {
    expect(L.ctConIA('Hola, soy el asistente virtual de Tienda.\n\nSí, tenemos Crema IA a 45 Bs.')).toBe('Hola, soy el asistente virtual con IA de Tienda.\n\nSí, tenemos Crema IA a 45 Bs.');
    expect(L.ctConIA('Hola, soy el asistente virtual de Tienda. Mira tienda.com/ia/catalogo')).toBe('Hola, soy el asistente virtual con IA de Tienda. Mira tienda.com/ia/catalogo');
  });
  it('NIEGA: «asistente virtuales» no es la presentación (no queda «con IAes»)', () => {
    expect(L.ctConIA('Los asistente virtuales del negocio')).toBe('Los asistente virtuales del negocio');
  });
  it('es idempotente', () => {
    const una = L.ctConIA('Hola, soy el asistente virtual de X.');
    expect(L.ctConIA(una)).toBe(una);
  });
  it('NIEGA: lo que no es texto no rompe', () => {
    for (const v of [undefined, null]) expect(L.ctConIA(v)).toBe('');
    expect(L.ctConIA(42)).toBe('42');
  });
  it('NIEGA: palabras que contienen «ia» no cuentan como que ya lo dijo («María», «Kia», «farmacia»)', () => {
    expect(L.ctConIA('Hola, soy el asistente virtual de la farmacia de María.')).toBe('Hola, soy el asistente virtual con IA de la farmacia de María.');
    expect(L.ctDiceIA('Kia Motors')).toBe(false);
  });
  it('ctDiceIA: «IA», «I.A.», «con IA», «inteligencia artificial» sí', () => {
    for (const t of ['una IA', 'con IA.', 'I.A.', 'Inteligencia Artificial', 'inteligencía artificial']) expect(L.ctDiceIA(t)).toBe(true);
  });
  it('un texto larguísimo no cuelga (menos de 250 ms)', () => {
    const t0 = Date.now();
    L.ctConIA('asistente '.repeat(2000) + 'virtual');
    L.ctDiceIA('i.'.repeat(4000));
    expect(Date.now() - t0).toBeLessThan(250);
  });
});
