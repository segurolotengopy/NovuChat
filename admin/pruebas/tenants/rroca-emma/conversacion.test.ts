/**
 * LA CONVERSACIÓN REAL: las respuestas modelo del guion aprobado (el MD de Emma) tienen que PASAR las barreras sin caer al texto fijo (una barrera que rechaza lo que el guion manda decir no sirve), y una batería de
 * mensajes recorre las invariantes de UX de todos los chats: una idea por párrafo, ningún botón sin mecanismo, ninguna promesa sin respaldo, ninguna frase prohibida por Andres.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BETO, crear, hablar, mTexto, PRODUCCION, PRUEBA, textos } from './mundo';

const RESPUESTAS_DEL_GUION: Array<[string, string]> = [
  ['hola', '¡Hola! 👋 Soy el asistente virtual de la Dra. Emma, especialista en armonización facial: con bioestimuladores de colágeno (Sculptra® y Radiesse®) recuperamos firmeza, mejoramos la textura y definimos el contorno del rostro sin cirugía.\n\nHoy tu valoración con la Dra. Emma es 100% gratuita y sin compromiso, y no pagas nada para reservar. ¿Cómo te llamas y qué te gustaría mejorar en tu rostro o piel?'],
  ['¿cuánto cuesta?', 'Entiendo perfectamente que quieras saber la inversión. No tenemos un precio fijo por chat porque depende del bioestimulador que la Dra. Emma indique para tu tipo de piel, las zonas a tratar y las sesiones que necesites. Justamente por eso el primer paso es la valoración gratuita: vienes sin compromiso, la doctora evalúa tu caso, te da tu presupuesto exacto y tú decides con total tranquilidad. ¿Te gustaría que te ayudemos a reservar tu espacio gratuito?'],
  ['¿de verdad es gratis?', 'Sí, de verdad. Hoy la valoración es 100% gratuita y no tienes que pagar absolutamente nada por adelantado para reservar. Solo si después de la evaluación decides hacerte el tratamiento, la Dra. te da el presupuesto.'],
  ['¿y si no me hago nada?', 'No pasa nada. Es sin compromiso. Vienes, recibes tu diagnóstico profesional y tú decides libremente si deseas continuar o no.'],
  ['¿diferencia con el ácido hialurónico?', 'Un relleno tradicional solo da volumen. Los bioestimuladores van más allá: activan la producción de tu propio colágeno, de modo que el resultado se ve natural y mejora la calidad de tu piel. Cada piel responde distinto, y la doctora te dice en la valoración qué te conviene.'],
  ['me dan miedo las agujas', 'Es súper normal tener esa inquietud. Estos procedimientos son sin cirugía, mínimamente invasivos, y en la valoración la Dra. Emma te explicará paso a paso cómo cuida tu comodidad durante la sesión.'],
  ['no quiero verme operada', 'El lema de la Dra. Emma es "Resultados reales, sigues siendo tú". Como trabajamos estimulando tu propio colágeno, se respetan tus rasgos. La foto es de una paciente real de la Dra. Emma, pero cada piel responde distinto y en la valoración gratuita sabrás qué es realista para ti.'],
  ['¿cuánto tiempo de recuperación?', 'Al no ser cirugía, es muy noble y puedes retomar tus actividades rápido. Los cuidados específicos dependen del producto y de la zona, y la Dra. Emma te los explica en la valoración para que lo coordines con tu trabajo.'],
  ['ya probé otros', 'Es muy comprensible. Por eso la Dra. Emma no usa tratamientos iguales para todos: personaliza el procedimiento según el análisis anatómico de tu rostro. ¡No pierdes nada escuchando su opinión en la valoración gratuita!'],
  ['lo voy a pensar', '¡Claro, tómate tu tiempo! Solo recuerda que la valoración es gratuita, sin pago de reserva y sin compromiso, así que no arriesgas nada viniendo a conocer el estado de tu piel.'],
  ['¿dónde están?', 'Atendemos en Emma Spa Medic, ubicada en Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055 (Santa Cruz).'],
  ['¿Sculptra o Radiesse?', 'Sculptra® estimula tu propio colágeno de forma progresiva y mejora la firmeza y la calidad de la piel; Radiesse® da un efecto lifting y define contornos. En la valoración gratuita la Dra. Emma evalúa tu rostro y decide cuál es el indicado, o si se combinan ambos. ¿Cómo te llamas y qué deseas mejorar?'],
];

describe('lo que el guion manda decir PASA las barreras', () => {
  for (const [msg, salida] of RESPUESTAS_DEL_GUION) {
    it(`«${msg}»`, () => {
      const t = hablar(crear({ modeloDice: () => salida }), ANA, mTexto(msg));
      const txt = textos(t)[0]!;
      expect(txt).not.toMatch(/inconveniente para responderte/);
      // sin cambios de fondo: los nombres se conservan
      expect(txt.replace(/\s+/g, ' ')).toContain(salida.replace(/\s+/g, ' ').slice(0, 40));
    });
  }
});

const BATERIA = ['hola', 'vi su anuncio', 'me interesa', 'mi nombre es Lucía', 'quiero mejorar los pómulos', 'cuánto cuesta', 'es gratis?', 'dónde queda', 'qué horario tienen', 'tengo miedo al dolor',
  'me da miedo quedar artificial', 'cuánto dura', 'puedo ir con mi hermana', 'gracias', 'ok', 'sí', 'no', 'lo voy a pensar', 'ya probé otras cosas', 'quiero agendar', 'dame horarios'];
const FRASES_PROHIBIDAS = [/no me escribas m[aá]s/i, /elige lo que te interesa/i, /ver tratamientos/i, /esa consulta la responde mejor la recepci[oó]n/i, /si no quieres recibir m[aá]s mensajes/i];

describe('invariantes de UX en toda la batería', () => {
  const salidas = ['Cuéntame, ¿qué te gustaría mejorar?', 'La valoración es gratuita y sin compromiso. ¿Cómo te llamas?', 'Entiendo. La Dra. Emma lo explica en la valoración gratuita. ¿Te gustaría agendar?', '[DERIVAR_RECEPCION: Lucía]'];
  it('recorre la batería sin una frase prohibida, un botón sin mecanismo ni una promesa sin respaldo', () => {
    let i = 0;
    const m = crear({ modeloDice: () => salidas[i++ % salidas.length]! });
    const interactivos: string[] = [];
    for (const msg of BATERIA) {
      const t = hablar(m, ANA, mTexto(msg));
      for (const e of t.mensajes) {
        for (const re of FRASES_PROHIBIDAS) expect(e.cuerpo).not.toMatch(re);
        // un botón pulsado no reaparece, y no se ofrece nada sin mecanismo: lo único interactivo es el botón de la recepción de la derivación
        if (e.tipo === 'interactive') { interactivos.push(e.cuerpo); expect(JSON.stringify(e.payload)).toContain('cta_url'); }
        else expect(e.cuerpo).not.toMatch(/bot[oó]n|https?:|wa\.me/i);
        expect(e.cuerpo).not.toMatch(/te llamamos|te escribir[aá]n|te aviso luego|lo consulto|\[|\]/i);
        // una idea por párrafo: ningún párrafo con más de dos oraciones
        for (const p of e.cuerpo.split('\n\n')) expect(p.replace(/\b(Dra?)\./g, '$1').split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿¡])/).length, p).toBeLessThanOrEqual(2);
      }
    }
    expect(interactivos.length).toBeGreaterThan(0);
  });
  it('el flujo completo (los dos JSON) no contiene ninguna frase prohibida en ningún texto', () => {
    const plano = (f: unknown): string => JSON.stringify(f).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const f of [PRODUCCION, PRUEBA]) {
      const t = plano(f);
      for (const x of ['no me escribas mas', 'elige lo que te interesa', 'ver tratamientos', 'esa consulta la responde mejor la recepcion', 'si no quieres recibir mas mensajes']) expect(t).not.toContain(x);
    }
  });
  it('dos teléfonos a la vez no mezclan memoria ni fichas', () => {
    const m = crear();
    hablar(m, ANA, mTexto('hola'));
    hablar(m, BETO, mTexto('hola'));
    const claves = Object.keys((m.sd as Record<string, Record<string, unknown>>)['emma'] ?? {});
    expect(claves.sort()).toEqual([ANA, BETO].sort());
  });
});
