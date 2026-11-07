/**
 * HUMO DE SILVANA, RONDA 2 (07/11/2026). Garantía (#9): DOS casos, con el texto EXACTO de Silvana. Caso 1 (garantía de compra o devolución): confirma con Rubén, con botón, el aviso sale, y NUNCA dice que hay o no hay garantía
 * ni muestra «No pude avisarle». Caso 2 (garantía de dormir o de resultados): su propia frase, SIN botón ni aviso. «¿Cuánto tiempo dura el plan?» (#7): por código, sin modelo. Se prueba NEGANDO, con el vigilante de UX en cada turno.
 */
import { describe, expect, it } from 'vitest';
import type { Mundo } from '../../lib/n8n-de-mentira';
import type { ResultadoTurno } from './mundo';
import { ANA, crear, hablar, mTexto } from './mundo';
import { vigilarUx } from './vigilante-ux';

const nuevo = (o: Record<string, unknown> = {}): Mundo => { const w = crear(o as never); vigilarUx(w); return w; };
const esBoton = (t: ResultadoTurno): boolean => t.mensajes[0]?.payload['interactive']?.type === 'cta_url';
const CASO1 = /Déjame confirmarte las condiciones de garantía o devolución directamente con Rubén\.\s+Puedes tocar el botón de aquí abajo para conversar con él personalmente 🌙/;
const CASO2 = /No, y desconfía de quien lo prometa:\s+cada persona es distinta\.\s+El libro te da un método educativo para identificar qué afecta tus noches y un plan de 21 días para practicar\.\s+Los resultados dependen de tu constancia y de tu situación personal 🌙/;
const NUNCA_EN_1 = /no tiene garant|sin garant|pago único|No pude avisarle|ya le avisé|Le avisé|te devolvemos|reembolsamos/i;

describe('CASO 1: garantía de compra o devolución de dinero', () => {
  for (const frase of ['¿Tiene garantía?', '¿Hay garantía?', '¿Hay devolución?', '¿Qué pasa si quiero reembolso?', '¿Qué pasa si no me gusta, me devuelven?', '¿hay garantía si no me sirve?']) {
    it(`«${frase}»: el texto exacto, con el botón de Rubén y el aviso; sin modelo; sin afirmar si hay o no garantía`, () => {
      const w = nuevo({ modeloDice: 'cae' });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto(frase));
      expect(t.mensajes).toHaveLength(1);
      expect(t.mensajes[0]!.cuerpo).toMatch(CASO1);
      expect(t.mensajes[0]!.cuerpo).not.toMatch(NUNCA_EN_1);
      expect(esBoton(t)).toBe(true);
      expect(t.avisos).toHaveLength(1);
      expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    });
  }
  it('NEGADA: si el aviso a Rubén FALLA (ventana de 24 h), el cliente NO ve ningún error: el mismo texto, con el botón', () => {
    const w = nuevo({ aviso: 'error' });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('¿Tiene garantía?'));
    expect(t.mensajes[0]!.cuerpo).toMatch(CASO1);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(NUNCA_EN_1);
    expect(esBoton(t)).toBe(true);
  });
  it('como PRIMER mensaje el texto exacto no lo sustituye la barrera final (con la presentación delante)', () => {
    const w = nuevo();
    const t = hablar(w, ANA, mTexto('¿Tiene garantía?'));
    const c = t.mensajes.map((m) => m.cuerpo).join('\n');
    expect(c).toMatch(CASO1);
    expect(c).not.toMatch(NUNCA_EN_1);
    expect(esBoton(t)).toBe(true);
  });
});

describe('CASO 2: garantía de dormir o de resultados', () => {
  for (const frase of ['¿Me garantiza que voy a dormir?', '¿Me garantizan que voy a dormir bien?', '¿Me garantizan que funciona?', '¿Garantiza quitar el insomnio?', '¿Está garantizado que funciona?']) {
    it(`«${frase}»: la frase exacta, SIN botón de Rubén y SIN aviso; sin modelo`, () => {
      const w = nuevo({ modeloDice: 'cae' });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto(frase));
      expect(t.mensajes[0]!.cuerpo).toMatch(CASO2);
      expect(esBoton(t)).toBe(false);
      expect(t.avisos).toHaveLength(0);
      expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
      expect(t.mensajes[0]!.cuerpo).not.toMatch(/Déjame confirmarte|no tiene garantía/i);
    });
  }
});

describe('«¿Cuánto tiempo dura el plan?» lo responde el código (sin modelo)', () => {
  it('la pregunta sola recibe el plan de 21 días, sin promesas ni «Gracias por escribir»', () => {
    const w = nuevo({ modeloDice: 'cae' });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('¿Cuánto tiempo dura el plan?'));
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(t.mensajes[0]!.cuerpo).toMatch(/plan guiado es de 21 días/);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/Gracias por escribir|garantiz|primera noche|vas a dormir/i);
  });
  it('NEGADA: una frase con algo más («ya no puedo más, ¿cuánto dura el plan?») va al modelo, no al texto fijo', () => {
    const w = nuevo({ modeloDice: 'Cuéntame un poco más.' });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('ya no puedo más, ¿cuánto tiempo dura el plan?'));
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/plan guiado es de 21 días/);
  });
});
