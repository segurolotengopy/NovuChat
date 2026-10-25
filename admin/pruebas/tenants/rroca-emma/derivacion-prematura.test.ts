/**
 * DERIVACIÓN PREMATURA Y TOPE DE 700 (humo del 24/10/2026). «Quiero ver cómo queda» derivó a recepción porque el MODELO emitió [DERIVAR_RECEPCION] por su cuenta, y la rama de derivación descartó las imágenes pedidas.
 * La etiqueta del modelo solo se honra si el cliente pidió agendar, aceptó una oferta de agendar o de pasar con recepción, o dio su nombre; si no, se ignora, se conserva el texto y salen las imágenes.
 * Y ningún mensaje del modelo pasa de 700 caracteres: se recorta por oración, nunca a mitad de oración, y la pregunta final es lo último que se conserva.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANA, IDS, avisosARecepcion, crear, dice, hablar, hablarYa, imagenes, mTexto, textos } from './mundo';

const ANTES = '[ENVIAR_ARTE_ANTES_DESPUES] Mira el caso real de una paciente de la Dra. Emma. [DERIVAR_RECEPCION]';
const esBoton = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((e) => e.tipo === 'interactive');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental');
const lib = runInNewContext(`const EV_PROMPT='';\n${readFileSync(join(RAIZ, 'comun-sin-agente/src/filtro-redaccion.js'), 'utf8')}\n${readFileSync(join(RAIZ, 'rroca-emma/src/lib/ev.js'), 'utf8')}\n({ evOfreceAgendar })`, {}) as { evOfreceAgendar: (t: string) => boolean };

describe('la oferta de agendar: raíces de verbo con exclusiones (la función sola)', () => {
  it('son ofertas', () => {
    for (const q of ['¿Te gustaría agendarla?', '¿Quieres que te agende?', '¿Quieres que te reserve un horario?', '¿Te reservo un espacio?', '¿Te coordino la valoración?', '¿Quieres que te aparte un horario?']) expect(lib.evOfreceAgendar(q), q).toBe(true);
  });
  it('NO son ofertas', () => {
    for (const q of ['¿Aparte de las ojeras, hay algo más?', '¿Quieres conocer el programa de cuidados?', '¿Quieres saber cómo se programa el tratamiento?', '¿Te explico en un apartado los cuidados?', '¿Sabías que no se cobra reserva?', '¿Quieres un tratamiento progresivo?', '¿Cómo te llamas y qué te gustaría mejorar?']) expect(lib.evOfreceAgendar(q), q).toBe(false);
  });
});

describe('la etiqueta de derivación del modelo no se honra sin que el cliente pida agendar', () => {
  it('NEGADA: «Quiero ver cómo queda» con la etiqueta del modelo no deriva y envía el ANTES_DESPUES', () => {
    const t = hablar(crear({ modeloDice: dice(ANTES) }), ANA, mTexto('Quiero ver cómo queda'));
    expect(esBoton(t)).toBe(false);
    expect(avisosARecepcion(t).length).toBe(0);
    expect(imagenes(t)).toEqual([IDS.antes_despues]);
    expect(textos(t).join(' ')).toContain('Mira el caso real');
  });
  for (const q of ['¿Cuánto cuesta?', '¿Qué diferencia hay entre Radiesse y Sculptra?', 'Hola', 'Cuéntame más']) {
    it(`NEGADA: «${q}» con la etiqueta del modelo no deriva`, () => {
      const t = hablar(crear({ modeloDice: dice('Con gusto te cuento sobre la valoración. [DERIVAR_RECEPCION]') }), ANA, mTexto(q));
      expect(esBoton(t), q).toBe(false);
      expect(avisosARecepcion(t).length, q).toBe(0);
      expect(textos(t).join(' '), q).toContain('Con gusto te cuento');
    });
  }
  it('NEGADA: «Soy Paola, ¿qué es Sculptra?» (un nombre CON una pregunta) con la etiqueta no deriva', () => {
    const t = hablar(crear({ modeloDice: dice('Es un bioestimulador. [DERIVAR_RECEPCION: Paola]') }), ANA, mTexto('Soy Paola, ¿qué es Sculptra?'));
    expect(esBoton(t)).toBe(false);
  });
  it('POSITIVA: «Quiero agendar mi valoración» deriva (con o sin la etiqueta)', () => {
    // EMMA: en el PRIMER contacto sin etiqueta del modelo ni nombre el saludo pide el nombre antes de cerrar (ver emma.test.ts); con la etiqueta, o ya en conversación, cierra.
    for (const modelo of ['[DERIVAR_RECEPCION: Ana]', 'Perfecto.']) {
      const m = crear({ modeloDice: dice(modelo) });
      const t = hablarYa(m, ANA, mTexto('Quiero agendar mi valoración'));
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
  it('POSITIVA: «dale» tras «¿Quieres que agendemos…?» deriva (la oferta «te paso con recepción» la quita la barrera de promesas, así que nunca llega al historial)', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<dale>>>') ? '[DERIVAR_RECEPCION]' : 'Perfecto. ¿Quieres que agendemos tu valoración?') });
    hablar(m, ANA, mTexto('me interesa'));
    expect(esBoton(hablar(m, ANA, mTexto('dale')))).toBe(true);
  });
  /** Un asistente que ofrece agendar, pide el nombre al aceptar, y emite la etiqueta cuando el cliente da su nombre. */
  const guion = () => crear({
    modeloDice: (ll) => {
      const c = JSON.stringify(ll.cuerpo);
      if (c.includes('<<<Paola>>>') && c.includes('cómo te llamas para pasarte')) return 'Gracias. [DERIVAR_RECEPCION: Paola]';
      if (c.includes('<<<sí>>>') || c.includes('<<<dale>>>')) return '¡Perfecto! Para pasarte con recepción, ¿cómo te llamas para pasarte con ella? [DERIVAR_RECEPCION]'.replace('¿cómo te llamas para pasarte con ella?', '¿cómo te llamas para pasarte?');
      return 'Te cuento. La valoración es gratuita. ¿Te gustaría agendar tu valoración?';
    },
  });
  it('POSITIVA: «¿Te gustaría agendar?» → «sí» → «¿cómo te llamas?» → «Paola» deriva con el cierre completo UNA vez; en el «sí» ESPERA el nombre (sin botón)', () => {
    const m = guion();
    hablar(m, ANA, mTexto('cuéntame de la valoración'));
    const t2 = hablar(m, ANA, mTexto('sí'));
    expect(esBoton(t2)).toBe(false);                       // el modelo emitió la etiqueta y pidió el nombre en el mismo turno: espera el nombre
    expect(textos(t2).join(' ')).toContain('cómo te llamas');
    const t3 = hablar(m, ANA, mTexto('Paola'));
    expect(esBoton(t3)).toBe(true);
    expect(textos(t3)[0]).toMatch(/Excelente decisión, Paola/);
    expect(avisosARecepcion(t3).length).toBe(1);
    const t4 = hablar(m, ANA, mTexto('gracias'));
    expect(textos(t4).join(' ')).not.toMatch(/Excelente decisión/);
  });
  it('POSITIVA: «dale» tras la oferta, con la etiqueta SIN pedir nombre, deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<dale>>>') ? 'Listo. [DERIVAR_RECEPCION]' : 'Con gusto. ¿Quieres que agendemos tu valoración?') });
    hablar(m, ANA, mTexto('me interesa'));
    expect(esBoton(hablar(m, ANA, mTexto('dale')))).toBe(true);
  });
  for (const nombre of ['Paola', 'Me llamo Paola', 'Paola, quiero mejorar mis ojeras', 'soy diabética', 'de La Paz', 'soy nueva']) {
    it(`NEGADA: «${nombre}» tras el saludo (que pregunta el nombre) con la etiqueta del modelo no deriva`, () => {
      const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<hola>>>') ? '¡Hola! Soy el asistente virtual de la Dra. Emma. Tu valoración es gratuita. ¿Cómo te llamas y qué te gustaría mejorar en tu rostro?' : 'Gracias. [DERIVAR_RECEPCION: Paola]') });
      hablar(m, ANA, mTexto('hola'));
      expect(esBoton(hablar(m, ANA, mTexto(nombre))), nombre).toBe(false);
    });
  }
  it('NEGADA: «soy diabética» o «de La Paz» tras aceptar la oferta y pedir el nombre tampoco es un nombre', () => {
    for (const x of ['soy diabética', 'de La Paz', 'soy nueva']) {
      const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? '¿Cómo te llamas para pasarte con recepción?' : (JSON.stringify(ll.cuerpo).includes(`<<<${x}>>>`) ? 'Listo. [DERIVAR_RECEPCION]' : 'Te cuento. ¿Te gustaría agendar tu valoración?')) });
      hablar(m, ANA, mTexto('cuéntame'));
      hablar(m, ANA, mTexto('sí'));
      expect(esBoton(hablar(m, ANA, mTexto(x))), x).toBe(false);
    }
  });
  it('NEGADA: «Soy Paola, quiero ver cómo queda» + ANTES_DESPUES + etiqueta no deriva y SALE la imagen', () => {
    const t = hablar(crear({ modeloDice: dice('[ENVIAR_ARTE_ANTES_DESPUES] Mira el caso. [DERIVAR_RECEPCION: Paola]') }), ANA, mTexto('Soy Paola, quiero ver cómo queda'));
    expect(esBoton(t)).toBe(false);
    expect(imagenes(t)).toEqual([IDS.antes_despues]);
  });
  it('con historial real: el saludo corto del prompt → «Quiero ver cómo queda» + etiqueta no deriva y sale el ANTES_DESPUES', () => {
  const SALUDO = '¡Hola! 👋 Soy el asistente virtual de la Dra. Emma (Armonización Facial), aplicadora certificada: hacemos armonización facial sin cirugía con bioestimuladores de colágeno para recuperar firmeza y definir el contorno del rostro.\n\nHoy tu valoración con la Dra. Emma es 100% gratuita y sin compromiso (su costo habitual es de 250 Bs, hoy bonificado). ¿Cómo te llamas y qué te gustaría mejorar en tu rostro?';
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<Quiero ver cómo queda>>>') ? ANTES : SALUDO) });
    hablar(m, ANA, mTexto('hola'));
    const t = hablar(m, ANA, mTexto('Quiero ver cómo queda'));
    expect(esBoton(t)).toBe(false);
    expect(imagenes(t)).toEqual([IDS.antes_despues]);
  });
  for (const x of ['si pero no ahora', 'si, cuánto cuesta', 'ok pero no ahora', 'ya no', 'bueno no se', 'quiero ver como queda', 'me interesa el Radiesse', 'me gustaria saber el precio']) {
    it(`NEGADA: «${x}» tras una oferta de agendar no la acepta`, () => {
      const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes(`<<<${x}>>>`) ? 'Entiendo. [DERIVAR_RECEPCION]' : 'Con gusto. ¿Te gustaría agendar tu valoración?') });
      hablar(m, ANA, mTexto('cuéntame'));
      expect(esBoton(hablar(m, ANA, mTexto(x))), x).toBe(false);
    });
  }
  it('(A-i) la oferta puede llevar una coletilla después de la pregunta: «¿Te gustaría agendar? Es sin compromiso.» → «sí» deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? 'Listo. [DERIVAR_RECEPCION]' : 'Te cuento. ¿Te gustaría agendar tu valoración? Es sin compromiso.') });
    hablar(m, ANA, mTexto('cuéntame'));
    expect(esBoton(hablar(m, ANA, mTexto('sí')))).toBe(true);
  });
  it('(A-ii) otros verbos de oferta: coordinar, programar, apartar', () => {
    for (const oferta of ['¿Quieres que coordinemos tu valoración?', '¿Quieres que programemos tu valoración?', '¿Quieres que te aparte un horario?']) {
      const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<claro>>>') ? 'Listo. [DERIVAR_RECEPCION]' : `Con gusto. ${oferta}`) });
      hablar(m, ANA, mTexto('cuéntame'));
      expect(esBoton(hablar(m, ANA, mTexto('claro'))), oferta).toBe(true);
    }
  });
  it('(ronda final 1) más ofertas por raíz: «agendarla» y «te coordino» (más «te aparte», arriba) + sí + nombre derivan. «Te agende / te reserve / te reservo» el filtro común (core) los rechaza antes: nunca llegan al cliente', () => {
    for (const oferta of ['¿Te gustaría agendarla?', '¿Te coordino la valoración?']) {
      const m = crear({ modeloDice: (ll) => {
        const c = JSON.stringify(ll.cuerpo);
        if (c.includes('<<<Paola>>>')) return 'Gracias. [DERIVAR_RECEPCION: Paola]';
        if (c.includes('<<<sí>>>')) return '¿Cómo te llamas para pasarte con recepción?';
        return `Con gusto. ${oferta}`;
      } });
      hablar(m, ANA, mTexto('cuéntame'));
      hablar(m, ANA, mTexto('sí'));
      expect(esBoton(hablar(m, ANA, mTexto('Paola'))), oferta).toBe(true);
    }
  });
  it('(ronda final 1) «progresivo» y el saludo no son ofertas', () => {
    for (const pregunta of ['¿Quieres un tratamiento progresivo?', '¿Cómo te llamas y qué te gustaría mejorar?']) {
      const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<ok>>>') ? 'Listo. [DERIVAR_RECEPCION]' : `Te cuento. ${pregunta}`) });
      hablar(m, ANA, mTexto('cuéntame'));
      expect(esBoton(hablar(m, ANA, mTexto('ok'))), pregunta).toBe(false);
    }
  });
  it('(ronda final 2) una negación no gana si después viene un «quiero agendar» positivo: derivan con etiqueta', () => {
    for (const x of ['Hola, no sé mucho del tema, quiero agendar una cita', 'si no es molestia, quiero agendar mi valoración', 'no vivo en Santa Cruz pero quiero agendar']) {
      const t = hablarYa(crear({ modeloDice: dice('Perfecto. [DERIVAR_RECEPCION]') }), ANA, mTexto(x));
      expect(esBoton(t), x).toBe(true);
    }
  });
  it('(ronda final 2) siguen sin derivar: «no quiero cita todavía», «quiero agendar pero no ahora», «no tengo tiempo para la cita»', () => {
    for (const x of ['no quiero cita todavía', 'quiero agendar pero no ahora', 'no tengo tiempo para la cita']) {
      const t = hablar(crear({ modeloDice: dice('Entiendo. [DERIVAR_RECEPCION]') }), ANA, mTexto(x));
      expect(esBoton(t), x).toBe(false);
    }
  });
  it('(ronda final 3) «clienta», «señora», «madre», «yo», «estudiante» no son nombres tras pedirlos', () => {
    for (const x of ['clienta', 'señora', 'madre', 'yo', 'estudiante', 'usuaria']) {
      const m = crear({ modeloDice: (ll) => {
        const c = JSON.stringify(ll.cuerpo);
        if (c.includes(`<<<${x}>>>`)) return 'Gracias. [DERIVAR_RECEPCION]';
        if (c.includes('<<<sí>>>')) return '¿Cómo te llamas para pasarte con recepción?';
        return 'Te cuento. ¿Te gustaría agendar tu valoración?';
      } });
      hablar(m, ANA, mTexto('cuéntame'));
      hablar(m, ANA, mTexto('sí'));
      expect(esBoton(hablar(m, ANA, mTexto(x))), x).toBe(false);
    }
  });
  it('(A-iii) el nombre con preferencia («Paola, mejor el jueves») y de 4 palabras deriva tras aceptar y pedir el nombre; el cierre lleva el nombre del CLIENTE', () => {
    for (const [dicho, esperado] of [['Paola, mejor el jueves', 'Paola'], ['María José Fernández López', 'María']] as const) {
      const m = crear({ modeloDice: (ll) => {
        const c = JSON.stringify(ll.cuerpo);
        if (c.includes(`<<<${dicho}>>>`)) return 'Gracias. [DERIVAR_RECEPCION]';
        if (c.includes('<<<sí>>>')) return '¿Cómo te llamas para pasarte con recepción?';
        return 'Te cuento. ¿Te gustaría agendar tu valoración?';
      } });
      hablar(m, ANA, mTexto('cuéntame'));
      hablar(m, ANA, mTexto('sí'));
      const t = hablar(m, ANA, mTexto(dicho));
      expect(esBoton(t), dicho).toBe(true);
      expect(textos(t)[0], dicho).toContain(`Excelente decisión, ${esperado}`);
    }
  });
  it('(A) «¿Cómo te llamas y qué te gustaría mejorar?» del saludo NO es una oferta', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? 'Genial. [DERIVAR_RECEPCION]' : '¡Hola! Soy el asistente virtual. Tu valoración es gratuita. ¿Cómo te llamas y qué te gustaría mejorar?') });
    hablar(m, ANA, mTexto('hola'));
    expect(esBoton(hablar(m, ANA, mTexto('sí')))).toBe(false);
  });
  it('(ronda final 1) el nombre del cierre NO sale de frases que no son un nombre: sale el del perfil', () => {
    for (const x of ['tienen turno el sábado', 'quiero agendar, soy muy nerviosa', 'quiero agendar, soy tu paciente', 'Quiero agendar, soy hipertensa', 'quiero agendar, mejor el lunes', 'Quiero agendar para el lunes, Paola', 'quiero un horario']) {
      const t = hablarYa(crear({ modeloDice: dice('Perfecto. [DERIVAR_RECEPCION]') }), ANA, mTexto(x), { nombre: 'Ana' });
      const c = textos(t)[0] ?? '';
      expect(c, x).toMatch(/Excelente decisión/);
      expect(c, x).not.toMatch(/Excelente decisión, (Muy|Tu|Mejor|Para|Paola|Hipertensa|Tienen)/);
    }
  });
  it('(ronda final 1) tras oferta + sí + «¿cómo te llamas?», «Botox», «Radiesse» e «Hipertensa» no son un nombre: no derivan', () => {
    for (const x of ['Botox', 'Radiesse', 'Hipertensa']) {
      const m = crear({ modeloDice: (ll) => {
        const c = JSON.stringify(ll.cuerpo);
        if (c.includes(`<<<${x}>>>`)) return 'Gracias. [DERIVAR_RECEPCION]';
        if (c.includes('<<<sí>>>')) return '¿Cómo te llamas para pasarte con recepción?';
        return 'Te cuento. ¿Te gustaría agendar tu valoración?';
      } });
      hablar(m, ANA, mTexto('cuéntame'));
      hablar(m, ANA, mTexto('sí'));
      expect(esBoton(hablar(m, ANA, mTexto(x))), x).toBe(false);
    }
  });
  it('(ronda final 2) preguntas con forma parecida pero que no ofrecen agendar: «sí» + etiqueta no deriva', () => {
    for (const pregunta of ['¿Aparte de las ojeras, hay algo más que te gustaría mejorar?', '¿Quieres conocer el programa de cuidados?', '¿Quieres saber cómo se programa el tratamiento por sesiones?', '¿Te explico en un apartado los cuidados posteriores?', '¿Sabías que no se cobra reserva?']) {
      const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<ok>>>') ? 'Listo. [DERIVAR_RECEPCION]' : `Te cuento. ${pregunta}`) });
      hablar(m, ANA, mTexto('cuéntame'));
      expect(esBoton(hablar(m, ANA, mTexto('ok'))), pregunta).toBe(false);
    }
  });
  it('(ronda final 3) con dos preguntas gana la última: «¿Te gustaría agendar? ¿O prefieres que te cuente más del Radiesse?» + «sí» no deriva; con coletilla afirmativa sí', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? 'Listo. [DERIVAR_RECEPCION]' : 'Con gusto. ¿Te gustaría agendar tu valoración? ¿O prefieres que te cuente más del Radiesse?') });
    hablar(m, ANA, mTexto('cuéntame'));
    expect(esBoton(hablar(m, ANA, mTexto('sí')))).toBe(false);
  });
  it('(ronda final 5) «no tengo tiempo para la cita» y «aparte del botox hacen otra cosa» no derivan con etiqueta ajena', () => {
    for (const x of ['no tengo tiempo para la cita', 'Aparte del botox ¿hacen otra cosa?', 'aparte del botox hacen otra cosa']) {
      const t = hablar(crear({ modeloDice: dice('Entiendo. [DERIVAR_RECEPCION]') }), ANA, mTexto(x));
      expect(esBoton(t), x).toBe(false);
    }
  });
  it('(B) «no quiero cita todavía» y «¿cuáles son sus horarios?» con la etiqueta del modelo no derivan; «quiero agendar mi valoración» sí', () => {
    for (const x of ['no quiero cita todavía', '¿cuáles son sus horarios?']) {
      const t = hablar(crear({ modeloDice: dice('Entiendo, aquí estoy. [DERIVAR_RECEPCION]') }), ANA, mTexto(x));
      expect(esBoton(t), x).toBe(false);
    }
    expect(esBoton(hablarYa(crear({ modeloDice: dice('Perfecto. [DERIVAR_RECEPCION]') }), ANA, mTexto('quiero agendar mi valoración')))).toBe(true);
  });
  it('(D) el cierre usa el nombre que el cliente dio en su mensaje, antes que el del perfil', () => {
    const t = hablar(crear({ modeloDice: dice('Perfecto. [DERIVAR_RECEPCION]') }), ANA, mTexto('Hola, soy Paola y quiero agendar'), { nombre: 'Ana' });
    expect(textos(t)[0]).toContain('Excelente decisión, Paola');
    expect(textos(t)[0]).not.toContain('Ana');
  });
  it('NEGADA: el saludo (valoración + «¿Cómo te llamas?») nunca es una oferta: «sí» después del saludo no deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? 'Genial. [DERIVAR_RECEPCION]' : 'Tu valoración con la Dra. es gratuita. ¿Cómo te llamas y qué te gustaría mejorar?') });
    hablar(m, ANA, mTexto('hola'));
    expect(esBoton(hablar(m, ANA, mTexto('sí')))).toBe(false);
  });
  it('NEGADA: un «sí» SIN oferta previa de agendar (el asistente preguntó otra cosa) no deriva', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<claro>>>') ? 'Genial. [DERIVAR_RECEPCION]' : 'Radiesse activa el colágeno. ¿Te cuento la diferencia con Sculptra?') });
    hablar(m, ANA, mTexto('qué es Radiesse'));
    expect(esBoton(hablar(m, ANA, mTexto('claro')))).toBe(false);
  });
  it('no rompe la etiqueta sin texto (variante corta) ni el cierre completo único', () => {
    const m = crear({ modeloDice: dice('[DERIVAR_RECEPCION: Paola]') });
    expect(textos(hablarYa(m, ANA, mTexto('quiero agendar')))[0]).toMatch(/Excelente decisión, Paola/);
    expect(textos(hablar(m, ANA, mTexto('quiero agendar de nuevo')))[0]).toContain('Claro, aquí tienes');
  });
});

describe('tope de 700 caracteres por mensaje: recorte por oración, la pregunta final al final', () => {
  const RELLENO = Array.from({ length: 12 }, (_, i) => `Esta es la oración de relleno número ${i + 1} sobre el efecto lifting natural y el contorno del rostro.`).join(' ');
  const SALUDO = `¡Hola! Soy el asistente virtual de la Dra. Emma. ${RELLENO} Tu valoración con la Dra. Emma es 100% gratuita y sin compromiso. ¿Cómo te llamas y qué te gustaría mejorar en tu rostro?`;
  it('un saludo de ~1000+ caracteres sale en 700 o menos, termina en oración completa y conserva la pregunta', () => {
    expect(SALUDO.length).toBeGreaterThan(1000);
    const t = textos(hablar(crear({ modeloDice: dice(SALUDO) }), ANA, mTexto('hola')))[0]!;
    expect(t.length).toBeLessThanOrEqual(700);
    expect(t.endsWith('¿Cómo te llamas y qué te gustaría mejorar en tu rostro?')).toBe(true);
    expect(t).toContain('Soy el asistente virtual de la Dra. Emma.');
    expect(t).toContain('100% gratuita y sin compromiso');
    // nunca a mitad de oración: cada oración del relleno que queda está completa
    for (const m of t.matchAll(/Esta es la oración de relleno número (\d+)([^.]*)\./g)) expect(m[2]).toBe(' sobre el efecto lifting natural y el contorno del rostro');
    expect(t).not.toMatch(/relleno número \d+ sobre el efecto lifting natural y el contorno del rostro\.\s*Esta es la oración de relleno número \d+ sobre el efecto lifting natural y el contor$/);
  });
  it('si el recorte vaciaría el texto o lo dejaría solo con la pregunta, se devuelve el ORIGINAL (decide el filtro común)', () => {
    const una = 'Esta es una sola oración muy larga ' + 'de relleno sobre el tratamiento '.repeat(28) + 'del rostro.';
    expect(una.length).toBeGreaterThan(850);
    expect(textos(hablar(crear({ modeloDice: dice(una) }), ANA, mTexto('hola')))[0]).toBe(una);
    const sinSignos = 'texto largo sin ningún signo de puntuación '.repeat(22).trim();
    expect(textos(hablar(crear({ modeloDice: dice(sinSignos) }), ANA, mTexto('hola')))[0]).toBe(sinSignos);
    const conPregunta = `${una} ¿Cómo te llamas?`;
    const t = textos(hablar(crear({ modeloDice: dice(conPregunta) }), ANA, mTexto('hola')))[0]!;
    expect(t).toContain('sola oración muy larga');
    expect(t.endsWith('¿Cómo te llamas?')).toBe(true);
  });
  it('el recorte no quita la aclaración fija ni una pregunta que no va al final', () => {
    const relleno = Array.from({ length: 10 }, (_, i) => `Esta es la oración de relleno número ${i + 1} sobre el efecto lifting natural.`).join(' ');
    const t = textos(hablar(crear({ modeloDice: dice(`${relleno} ¿Quieres saber más? No podemos garantizar un resultado idéntico. Tu valoración es gratuita.`) }), ANA, mTexto('hola')))[0]!;
    expect(t).toContain('Cada rostro responde distinto y no prometemos un resultado idéntico.');
    expect(t).toContain('¿Quieres saber más?');
    expect(t.length).toBeLessThanOrEqual(700);
  });
  it('(C) «Hola. <1200 caracteres>. ¿Cómo te llamas?» sale ENTERO (el recorte lo dejaría casi vacío)', () => {
    const larga = 'Esta es una oración larga ' + 'sobre el tratamiento de armonización facial '.repeat(25) + 'del rostro.';
    const texto = `Hola. ${larga} ¿Cómo te llamas?`;
    expect(texto.length).toBeGreaterThan(1000);
    expect(texto.length).toBeLessThan(1500);
    const t = textos(hablar(crear({ modeloDice: dice(texto) }), ANA, mTexto('hola')))[0]!;
    expect(t).toContain(larga);
    expect(t.startsWith('Hola.')).toBe(true);
    expect(t.endsWith('¿Cómo te llamas?')).toBe(true);
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

describe('PRIMER CONTACTO: la etiqueta del modelo se ignora sin historial y sin nombre dado', () => {
  const SIN_GRATUITA = 'Hola, vi su anuncio y quiero agendar mi valoración';
  const PRELLENADO = 'Hola Dra. Emma, vi su anuncio y quiero agendar mi valoración gratuita 🙌';
  const SALUDO = '¡Hola! 👋 Soy el asistente virtual de la Dra. Emma. Tu valoración es 100% gratuita y sin compromiso. ¿Cómo te llamas y qué te gustaría mejorar?';
  it('NEGADA: con el texto prellenado, ni la etiqueta con texto, ni la etiqueta sola, ni la etiqueta con nombre cierran: sin botón ni aviso', () => {
    for (const modelo of [SALUDO + ' [DERIVAR_RECEPCION]', SALUDO + ' [DERIVAR_RECEPCION: Ana]']) {
      const t = hablar(crear({ modeloDice: dice(modelo) }), ANA, mTexto(PRELLENADO));
      expect(esBoton(t), modelo).toBe(false);
      expect(avisosARecepcion(t).length, modelo).toBe(0);
      expect(textos(t).join(' '), modelo).toContain('¿Cómo te llamas');
      expect(textos(t).join(' '), modelo).not.toMatch(/Excelente decisión|DERIVAR/);
    }
    // la etiqueta SOLA, sin texto: sale el fallo conocido con su aviso, no el cierre
    const sola = hablar(crear({ modeloDice: dice('[DERIVAR_RECEPCION]') }), ANA, mTexto(SIN_GRATUITA));
    expect(textos(sola).join(' ')).toMatch(/inconveniente para responderte/);
    expect(textos(sola).join(' ')).not.toMatch(/Excelente decisión/);
    expect(avisosARecepcion(sola).length).toBe(1);
  });
  it('NEGADA: primer contacto «quiero agendar» con el modelo caído: fallo con aviso a recepción (no_supo), no el cierre', () => {
    const t = hablar(crear({ modeloDice: 'cae' }), ANA, mTexto(SIN_GRATUITA));
    expect(textos(t).join(' ')).toMatch(/inconveniente para responderte/);
    expect(textos(t).join(' ')).not.toMatch(/Excelente decisión/);
    expect(avisosARecepcion(t).length).toBe(1);
  });
  it('POSITIVAS: con nombre en el mensaje cierra; con historial (segundo mensaje «quiero agendar») cierra, con o sin etiqueta', () => {
    expect(esBoton(hablar(crear({ modeloDice: dice(SALUDO + ' [DERIVAR_RECEPCION]') }), ANA, mTexto('Soy Rosa. Quiero agendar mi valoración')))).toBe(true);
    for (const modelo of ['Perfecto.', '[DERIVAR_RECEPCION: Ana]']) {
      const m = crear({ modeloDice: dice(modelo) });
      hablar(m, ANA, mTexto('hola'));
      const t = hablar(m, ANA, mTexto('Ok, quiero agendar'));
      expect(esBoton(t), modelo).toBe(true);
      expect(textos(t)[0], modelo).toMatch(/Excelente decisión/);
    }
  });
});
