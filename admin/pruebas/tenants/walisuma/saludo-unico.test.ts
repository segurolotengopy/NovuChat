/**
 * EL SALUDO SALE UNA VEZ POR CONVERSACIÓN, también en una ráfaga (20/11/2026). Tres mensajes en el mismo segundo corrían en paralelo y los tres saludaban: la ficha de n8n no
 * es atómica entre ejecuciones. El servidor sí: `atencion.conversacionNueva` lo recibe true UN solo mensaje. Si dice false y la ficha no tiene el saludo, ese turno NO saluda.
 * Sin respuesta del servidor (modo prueba, error) se saluda como siempre. Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, modelo, mTexto, textos } from './mundo';

const SALUDO = /soy el asistente de atención y ventas/;
const rta = (nueva: unknown) => ({ ok: true, atencion: { estado: 'normal', conversacionNueva: nueva } });

describe('el saludo y la ráfaga', () => {
  it('el mensaje que ABRIÓ la conversación (servidor: true) saluda', () => {
    const t = hablar(crear({ ingesta: rta(true), modeloDice: modelo('Con gusto le ayudamos.') }), ANA, mTexto('hola'));
    expect(textos(t).join(' ')).toMatch(SALUDO);
  });
  it('NEGADO: un mensaje que NO abrió la conversación (servidor: false) no saluda aunque la ficha esté vacía', () => {
    const t = hablar(crear({ ingesta: rta(false), modeloDice: modelo('Con gusto le ayudamos.') }), ANA, mTexto('hola'));
    expect(textos(t).join(' ')).not.toMatch(SALUDO);
    expect(textos(t).join(' ')).toMatch(/Con gusto le ayudamos/);
  });
  it('sin dato del servidor (null, ausente o no booleano) se saluda como siempre', () => {
    for (const v of [undefined, null, 'true', 1]) {
      const t = hablar(crear({ ingesta: rta(v), modeloDice: modelo('Con gusto le ayudamos.') }), ANA, mTexto('hola'));
      expect(textos(t).join(' '), String(v)).toMatch(SALUDO);
    }
    expect(textos(hablar(crear({ ingesta: { ok: true }, modeloDice: modelo('Con gusto.') }), ANA, mTexto('hola'))).join(' ')).toMatch(SALUDO);
  });
  it('con la ficha ya saludada nunca se repite, diga lo que diga el servidor', () => {
    const m = crear({ ingesta: rta(true), modeloDice: modelo('Con gusto.') });
    hablar(m, ANA, mTexto('hola'));
    expect(textos(hablar(m, ANA, mTexto('quiero ver bufandas'))).join(' ')).not.toMatch(SALUDO);
  });
  it('el texto fijo de un turno sin modelo (baja, identidad) tampoco saluda si no abrió la conversación', () => {
    const t = hablar(crear({ ingesta: rta(false), modeloDice: modelo('x') }), ANA, mTexto('¿eres un robot?'));
    expect(textos(t).join(' ')).not.toMatch(SALUDO);
  });
});
