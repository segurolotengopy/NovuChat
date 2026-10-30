/**
 * LA VOZ DE WALISUMA (guía de tono y voz del cliente) hecha código: ningún mensaje niega ser una IA, lleva más de 2 emojis, presiona con tiempo, inventa existencias ni dice un importe que no sea un precio del catálogo.
 * Se prueba NEGANDO sobre una batería de turnos donde el modelo (doble) intenta romper cada regla.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, mTexto, modelo, textos } from './mundo';

const EMOJI = /\p{Extended_Pictographic}/gu;
const PRESION = /oferta por tiempo limitado|tiempo limitado|[uú]ltimas? (unidades|piezas)|solo quedan|quedan \d|stock|aprovecha|no te lo pierdas|lujo [uú]nico|experiencia incomparable|hecho con amor/i;
const NIEGA = /no soy (un |una )?(bot|robot|ia|inteligencia artificial|asistente virtual)|soy (una )?persona (real|de verdad)|humano/i;

const SALIDAS_DEL_MODELO = [
  'Nos encantaría ayudarte 😀😀😀😀 con tu elección.',
  '¡Oferta por tiempo limitado en nuestras bufandas! ¿Cuál te gusta?',
  'Quedan 3 unidades de la billetera, ¿quieres una?',
  'Son las últimas unidades de la bufanda de vicuña.',
  'Tenemos stock de sobra de todo.',
  'Una experiencia incomparable, un lujo único para ti.',
  'Soy una persona real y te atiendo personalmente.',
  'No soy un robot, soy humano.',
  'La bufanda sale Bs 3.000 solo hoy. ¿La quieres?',
  'Hecho con amor, cada pieza. ¿Qué buscas?',
  'La billetera de cuero cuesta Bs 450. ¿Te interesa?',
  'Trabajamos cada pieza con paciencia: nada es casual. ¿Qué buscas?',
];

describe('batería de turnos: la voz se cumple en código', () => {
  SALIDAS_DEL_MODELO.forEach((salida, i) => {
    it(`salida ${i + 1} del modelo: «${salida.slice(0, 48)}…» no rompe la voz`, () => {
      const t = hablar(crear({ modeloDice: modelo(salida) }), ANA, mTexto('hola, quisiera ver algo para regalar'));
      const cuerpo = textos(t).join('\n');
      expect(t.mensajes.length).toBeGreaterThan(0);
      expect((cuerpo.match(EMOJI) ?? []).length).toBeLessThanOrEqual(2);
      expect(cuerpo).not.toMatch(PRESION);
      expect(cuerpo).not.toMatch(NIEGA);
      // Todo importe que aparezca es el precio de una pieza del catálogo de prueba.
      for (const m of cuerpo.matchAll(/Bs\s*(\d[\d.,]*\d|\d)/g)) expect(['450', '7.795', '35,50']).toContain(m[1]);
    });
  });
  it('la salida legítima SÍ sale (la prueba tiene dientes): precio del catálogo y mensaje madre', () => {
    const t = hablar(crear({ modeloDice: modelo('La billetera de cuero cuesta Bs 450. ¿Te interesa?') }), ANA, mTexto('¿cuánto cuesta la billetera?'));
    expect(textos(t).join(' ')).toMatch(/cuesta Bs 450/);
    const t2 = hablar(crear({ modeloDice: modelo('Trabajamos cada pieza con paciencia: nada es casual. ¿Qué buscas?') }), ANA, mTexto('hola'));
    expect(textos(t2).join(' ')).toMatch(/nada es casual/);
  });
  it('con 2 emojis se conservan, con más se quitan los sobrantes', () => {
    const t = hablar(crear({ modeloDice: modelo('Qué gusto 😀 verte por aquí 🙂 cuéntame 😍 qué buscas ✨') }), ANA, mTexto('hola'));
    expect(((textos(t).join('\n')).match(EMOJI) ?? []).length).toBeLessThanOrEqual(2);
  });
  it('NEGADO: «¿eres un bot?» no lo contesta el modelo: sale el texto fijo, que dice que es una IA', () => {
    const t = hablar(crear({ modeloDice: modelo('Soy una persona real.') }), ANA, mTexto('¿eres un robot o una persona?'));
    expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
    expect(textos(t).join(' ')).toMatch(/asistente virtual.*inteligencia artificial/);
    expect(textos(t).join(' ')).not.toMatch(NIEGA);
  });
  it('el prompt lleva la guía de voz y el catálogo SOLO con piezas vendibles (ni el tapiz sin precio ni el licor apagado)', () => {
    let prompt = '';
    const m = crear({ modeloDice: (ll) => { prompt = JSON.stringify(ll.cuerpo); return modelo('Con gusto.'); } });
    hablar(m, ANA, mTexto('hola, busco una bufanda'));
    expect(prompt).toMatch(/primera persona del plural/);
    expect(prompt).toMatch(/nada es casual/);
    expect(prompt).toMatch(/bufanda-vicuna\|Bufanda de vicuña\|7795/);
    expect(prompt).not.toMatch(/tapiz-mujer-rio|licor-de-coca/);
    expect(prompt).toMatch(/asistente virtual de Tienda de prueba/);
    expect(prompt).toMatch(/domingo|lunes|martes|miércoles|jueves|viernes|sábado/);
  });
  it('el saludo de la primera vez es del asistente virtual del negocio y NO se repite', () => {
    const m = crear({ modeloDice: modelo('Con gusto, cuéntame qué buscas.') });
    expect(textos(hablar(m, ANA, mTexto('hola')))[0]).toMatch(/^Hola, soy el asistente virtual de Tienda de prueba\./);
    expect(textos(hablar(m, ANA, mTexto('busco una billetera')))[0]).not.toMatch(/soy el asistente virtual/);
  });
});
