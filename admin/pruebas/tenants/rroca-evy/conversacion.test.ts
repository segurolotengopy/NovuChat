/**
 * LA CONVERSACIÓN REAL: las respuestas modelo del guion aprobado (el MD de Evy) tienen que PASAR las barreras sin caer al texto fijo (una barrera que rechaza lo que el guion manda decir no sirve), y una batería de
 * mensajes recorre las invariantes de UX de todos los chats: una idea por párrafo, ningún botón sin mecanismo, ninguna promesa sin respaldo, ninguna frase prohibida por Andres.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BETO, crear, hablar, mTexto, PRODUCCION, PRUEBA, textos } from './mundo';

const RESPUESTAS_DEL_GUION: Array<[string, string]> = [
  ['hola', '¡Hola! 👋 Qué gusto saludarte. Soy el asistente virtual de la Dra. Evy Karina Rojas (Armonización Facial), aplicadora certificada.\n\nTe cuento brevemente: realizamos tratamientos de armonización facial sin cirugía con bioestimuladores de colágeno (Radiesse® y HArmonyCa™), ideales para recuperar la firmeza, lograr un efecto lifting natural y definir el contorno de tu rostro (pómulos, mentón y mandíbula) activando tu propio colágeno.\n\nPor escribirnos desde nuestra campaña, tu valoración con la Dra. Evy es 100% gratuita y sin compromiso (su costo habitual es de 250 Bs, pero hoy está totalmente bonificada y no pagas nada para reservar). En esa cita ella evaluará tu rostro para indicarte el tratamiento ideal para ti.\n\nPara orientarte mejor antes de pasarte con recepción, cuéntame: ¿cómo te llamas y qué te gustaría mejorar en tu rostro?'],
  ['¿cuánto cuesta?', 'Entiendo perfectamente que quieras conocer la inversión. El tratamiento no tiene un precio fijo por chat porque depende del bioestimulador que la Dra. Evy indique para tu rostro (Radiesse® o HArmonyCa™), de las zonas a tratar y de la cantidad exacta que necesites. Justamente por eso bonificamos el 100% de la valoración (que habitualmente cuesta 250 Bs): vienes totalmente gratis, la doctora evalúa tu rostro, te entrega tu presupuesto claro y tú decides con total tranquilidad y sin compromiso. ¿Te gustaría aprovechar este beneficio y agendar tu espacio?'],
  ['¿de verdad es gratis?', 'Sí, es 100% gratuita por la campaña. No pagas los 250 Bs de consulta ni tienes que dejar ningún anticipo para reservar. Solo si después de la evaluación decides hacerte el tratamiento, la Dra. te da el presupuesto.'],
  ['¿y si no me hago nada?', 'No pasa absolutamente nada. La valoración es sin compromiso; vienes, conoces el diagnóstico profesional de la Dra. Evy y tú decides libremente.'],
  ['¿diferencia con el ácido hialurónico?', 'Un relleno tradicional solo aporta volumen. En cambio, los bioestimuladores activan tu propio colágeno para devolver firmeza de forma natural. Radiesse® es un bioestimulador puro, y HArmonyCa™ une lo mejor de los dos mundos: ácido hialurónico (efecto lifting) + hidroxiapatita de calcio (nuevo colágeno).'],
  ['me dan miedo las agujas', 'Es súper comprensible. Son procedimientos ambulatorios sin cirugía. Además, te dará mucha tranquilidad saber que HArmonyCa™ ya contiene lidocaína (un anestésico local) en su fórmula, haciendo que la aplicación sea sumamente cómoda y tolerable.'],
  ['no quiero verme operada', 'La filosofía de la Dra. Evy es "Armonía que se nota, pero natural". Al trabajar con tu propio colágeno se respetan tus facciones. La foto es de una paciente real de la Dra. Evy, pero cada rostro responde distinto y en la valoración gratuita sabrás qué es realista para ti.'],
  ['¿cuánto tiempo de recuperación?', 'Al no ser cirugía, es muy noble y puedes retomar tus actividades rápido. Los cuidados específicos dependen de la zona y la Dra. Evy te los detalla en la consulta gratuita para que lo organices con tu trabajo.'],
  ['ya probé otros', 'Es comprensible. Por eso la Dra. Evy (aplicadora certificada) no usa recetas genéricas, sino que analiza la anatomía de tu rostro en la valoración gratuita para indicarte solo lo que realmente te dará resultados.'],
  ['lo voy a pensar', '¡Claro, tómate tu tiempo! Solo recuerda que la valoración no tiene ningún costo por esta campaña (te ahorras los 250 Bs) ni te compromete a nada, así que no arriesgas nada viniendo a conocer tu diagnóstico.'],
  ['¿dónde están?', 'Atendemos en la Clínica DentalCor, ubicada en la Avenida Piraí, segundo anillo, Calle Sapocó # 53 (Santa Cruz).'],
  ['¿Radiesse o HArmonyCa?', 'Ambos activan tu colágeno natural. Radiesse® da firmeza y contorno preventivo, y HArmonyCa™ da efecto lifting en flacidez más marcada. La valoración de 250 Bs es 100% gratis por la campaña para que la Dra. defina cuál te corresponde. ¿Cómo te llamas y qué deseas mejorar?'],
];

describe('lo que el guion manda decir PASA las barreras', () => {
  for (const [msg, salida] of RESPUESTAS_DEL_GUION) {
    it(`«${msg}»`, () => {
      const t = hablar(crear({ modeloDice: () => salida }), ANA, mTexto(msg));
      const txt = textos(t)[0]!;
      expect(txt).not.toMatch(/inconveniente para responderte/);
      // sin cambios de fondo: las cifras del guion y los nombres se conservan
      expect(txt.replace(/\s+/g, ' ')).toContain(salida.replace(/\s+/g, ' ').slice(0, 40));
      if (/250 Bs/.test(salida)) expect(txt).toContain('250 Bs');
    });
  }
});

const BATERIA = ['hola', 'vi su anuncio', 'me interesa', 'mi nombre es Lucía', 'quiero mejorar los pómulos', 'cuánto cuesta', 'es gratis?', 'dónde queda', 'qué horario tienen', 'tengo miedo al dolor',
  'me da miedo quedar artificial', 'cuánto dura', 'puedo ir con mi hermana', 'gracias', 'ok', 'sí', 'no', 'lo voy a pensar', 'ya probé otras cosas', 'quiero agendar', 'dame horarios'];
const FRASES_PROHIBIDAS = [/no me escribas m[aá]s/i, /elige lo que te interesa/i, /ver tratamientos/i, /esa consulta la responde mejor la recepci[oó]n/i, /si no quieres recibir m[aá]s mensajes/i];

describe('invariantes de UX en toda la batería', () => {
  const salidas = ['Cuéntame, ¿qué te gustaría mejorar?', 'La valoración es gratuita y sin compromiso. ¿Cómo te llamas?', 'Entiendo. La Dra. Evy lo explica en la valoración gratuita. ¿Te gustaría agendar?', '[DERIVAR_RECEPCION: Lucía]'];
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
    const claves = Object.keys((m.sd as Record<string, Record<string, unknown>>)['evy'] ?? {});
    expect(claves.sort()).toEqual([ANA, BETO].sort());
  });
});
