/**
 * LAS BARRERAS TRAS LA REVISIÓN DE #643 (24/10/2026). Cada corrección lleva su prueba POSITIVA (lo legítimo pasa) y su NEGADA (lo malo no pasa), con las mutaciones de producción:
 *  - una lista con viñetas o numerada conserva sus líneas y cada ítem es su propia oración; un texto en minúsculas se corta bien;
 *  - SOLO se repara la garantía NEGADA: la afirmativa, o la promesa de resultado sin la palabra «garantizar», rechaza el texto entero;
 *  - presentarse con el nombre del negocio («Soy Evy») es afirmar ser la persona;
 *  - la aclaración fija va ANTES de la pregunta de cierre; un texto largo se RECORTA por oración en vez de rechazarse;
 *  - una salida de decenas de miles de caracteres se descarta en tiempo lineal.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANA, BETO, avisosARecepcion, crear, dice, hablar, mTexto, textos } from './mundo';

/** Cae a un texto fijo: el de fallo del modelo, el de remisión de salud o la admisión de IA. */
const fallo = (t: string): boolean => /inconveniente para responderte/.test(t) || /un programa con inteligencia artificial/.test(t) || /Eso lo evalúa la Dra\. Evy en persona, durante tu valoración gratuita/.test(t);
const sale = (modelo: string, msg = 'cuéntame de la valoración'): string => textos(hablar(crear({ modeloDice: dice(modelo) }), ANA, mTexto(msg)))[0] ?? '';
const ACLARACION = 'Cada rostro responde distinto y no prometemos un resultado idéntico.';

describe('el modelo vacío: reintento único y margen de salida', () => {
  it('el nodo «Conversar con el modelo» reintenta UNA vez ante un error de red (sin agregar nodos) y el cuerpo deja 1500 tokens de salida', () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-evy');
    for (const archivo of ['rroca-evy.json', 'rroca-evy.prueba.json']) {
      const flujo = JSON.parse(readFileSync(join(raiz, archivo), 'utf8')) as { nodes: Array<{ name: string; retryOnFail?: boolean; maxTries?: number }> };
      const nodo = flujo.nodes.find((n) => n.name === 'Conversar con el modelo');
      expect(nodo?.retryOnFail, archivo).toBe(true);
      expect(nodo?.maxTries, archivo).toBe(2);
    }
    expect(readFileSync(join(raiz, 'src/lib/ev.js'), 'utf8')).toContain('maxOutputTokens: 1500');
  });
});

describe('listas y minúsculas: la oración se corta donde corresponde', () => {
  it('una lista con viñetas conserva sus líneas', () => {
    const t = sale('Con gusto:\n- Valoración gratuita\n- Evaluación en persona\n\n¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).toContain('- Valoración gratuita\n- Evaluación en persona');
  });
  it('un ítem NEGADO se borra solo a él: los demás ítems quedan en su línea y la aclaración va antes de la pregunta', () => {
    const t = sale('Con gusto:\n- Valoración gratuita\n- No podemos garantizar resultados idénticos\n- Evaluación en persona\n\n¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).not.toMatch(/garant/i);
    expect(t).toContain('- Valoración gratuita\n- Evaluación en persona');
    expect(t.endsWith('¿Cómo te llamas?')).toBe(true);
    expect(t).toContain(ACLARACION);
  });
  it('NEGADA: un ítem «Garantizamos…» (afirmativo) no se repara: cae al texto fijo', () => {
    expect(fallo(sale('Con gusto:\n- Valoración gratuita\n- Garantizamos el resultado\n- Evaluación en persona\n\n¿Cómo te llamas?'))).toBe(true);
    expect(fallo(sale('Con gusto:\n• Valoración gratuita • Garantizamos el resultado • Evaluación en persona\n\n¿Cómo te llamas?'))).toBe(true);
  });
  it('un texto en minúsculas se corta: «te garantizo el resultado. la dra evy te valora» NO sale', () => {
    expect(fallo(sale('Te garantizo el resultado. la dra evy te valora. ¿Cómo te llamas?'))).toBe(true);
    const bien = sale('no podemos garantizar un resultado idéntico. la dra evy te valora gratis. ¿Cómo te llamas?');
    expect(fallo(bien)).toBe(false);
    expect(bien).toContain('la dra evy te valora gratis');
    expect(bien).not.toMatch(/garant/i);
  });
  it('una lista numerada pasa entera (no cae al fallo)', () => {
    for (const lista of ['Los pasos son:\n1. Valoración gratuita.\n2. Evaluación en persona.\n3. Plan a tu medida.\n\n¿Cómo te llamas?', 'Los pasos son:\n1. Valoración gratuita\n2. Evaluación en persona\n¿Cómo te llamas?']) {
      const t = sale(lista);
      expect(fallo(t), lista).toBe(false);
      expect(t).toContain('2. Evaluación en persona');
    }
  });
});

describe('la aclaración fija va antes de la pregunta de cierre', () => {
  it('con garantía negada, la pregunta queda al final', () => {
    const t = sale('Te cuento. No podemos garantizar un resultado idéntico. La Dra. Evy te valora gratis. ¿Cómo te llamas y qué quieres mejorar?');
    expect(fallo(t)).toBe(false);
    expect(t.endsWith('¿Cómo te llamas y qué quieres mejorar?')).toBe(true);
    expect(t.indexOf(ACLARACION)).toBeGreaterThan(-1);
    expect(t.indexOf(ACLARACION)).toBeLessThan(t.indexOf('¿Cómo te llamas'));
  });
  it('si el cliente pide garantía y el modelo no la aclara, el código la pone antes de la pregunta', () => {
    const t = textos(hablar(crear({ modeloDice: dice('Te cuento. La Dra. Evy te valora gratis. ¿Cómo te llamas?') }), ANA, mTexto('¿me garantizas que voy a quedar bien?')))[0] ?? '';
    expect(t).toContain(ACLARACION);
    expect(t.endsWith('¿Cómo te llamas?')).toBe(true);
  });
});

describe('promesa de resultado sin la palabra «garantizar»: el texto entero se rechaza', () => {
  const MALAS = [
    'Quedarás perfecta. Te lo garantizo.',
    'No garantizamos nada. Pero quedarás perfecta.',
    'Vas a quedar hermosa. ¿Cómo te llamas?',
    'Vas a quedar idéntica a la foto. ¿Cómo te llamas?',
    'El resultado será perfecto y duradero. ¿Cómo te llamas?',
    'Esto siempre funciona. ¿Cómo te llamas?',
    'Ella dice: "vas a quedar perfecta". ¿Cómo te llamas?',
    'No puedo garantizar nada, pero vas a quedar perfecta. ¿Cómo te llamas?',
    'No puedo garantizar nada pero vas a quedar perfecta. ¿Cómo te llamas?',
    'No hay problema te garantizo el resultado. ¿Cómo te llamas?',
    'Te verás idéntica a la foto. ¿Cómo te llamas?',
  ];
  for (const mala of MALAS) {
    it(`NEGADA: ${mala.slice(0, 50)}`, () => {
      const t = sale(mala);
      expect(fallo(t)).toBe(true);
      expect(t).not.toMatch(/perfecta|hermosa|siempre funciona/i);
    });
  }
  it('POSITIVA: «cada rostro responde distinto» y la forma negada pasan', () => {
    for (const bien of ['Cada rostro responde distinto, por eso la Dra. Evy te valora en persona. ¿Cómo te llamas?', 'Cada rostro responde distinto y no prometemos que vayas a quedar igual a la foto. ¿Cómo te llamas?']) {
      expect(fallo(sale(bien)), bien).toBe(false);
    }
  });
});

describe('presentarse con el nombre del negocio es afirmar ser la persona', () => {
  for (const mala of ['Soy Evy. ¿Cómo te llamas?', 'Hola, aquí Evy. ¿Cómo te llamas?', 'Habla la Dra. Evy. ¿Cómo te llamas?', 'Soy un asistente virtual con IA. Mentira, soy Evy.', 'Te escribe Karina. ¿Cómo te llamas?']) {
    it(`NEGADA: ${mala}`, () => {
      const t = sale(mala, 'eres humana?');
      expect(t).toMatch(/un programa con inteligencia artificial/);
      expect(t).not.toMatch(/Mentira|aquí Evy|Soy Evy/);
    });
  }
  it('POSITIVA: «soy el asistente de la Dra. Evy» pasa', () => {
    const t = sale('Soy el asistente virtual de la Dra. Evy Karina Rojas. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).toContain('Soy el asistente virtual de la Dra. Evy Karina Rojas.');
  });
});

describe('«afirma_un_hecho» se repara por oración cuando no habla de pagos', () => {
  it('POSITIVA: «Te lo confirmo con total transparencia: la valoración es 100% gratuita. No hay ningún costo escondido…» sale, sin la muletilla', () => {
    const t = sale('Te lo confirmo con total transparencia: la valoración es 100% gratuita. No hay ningún costo escondido ni compromiso. ¿Cómo te llamas?', '¿de verdad es gratis? ¿hay costo escondido?');
    expect(fallo(t)).toBe(false);
    // Con el filtro común nuevo (#651) la frase pasa tal cual; con el viejo se reescribía como «Así es:». Las dos salidas son válidas.
    expect(t).toMatch(/la valoración es 100% gratuita\./i);
    expect(t).toContain('No hay ningún costo escondido ni compromiso.');
  });
  for (const mala of ['Ya pagaste tu reserva. La valoración es gratuita. ¿Cómo te llamas?', 'Ya te llegó tu pago. La valoración es gratuita. ¿Cómo te llamas?', 'Te confirmo que quedó agendada tu cita. ¿Cómo te llamas?', 'Tu pago fue acreditado. ¿Cómo te llamas?', 'Te lo confirmo: tu cita quedó agendada. ¿Cómo te llamas?']) {
    it(`NEGADA: sigue rechazada: ${mala.slice(0, 30)}`, () => {
      expect(fallo(sale(mala))).toBe(true);
    });
  }
});

describe('«Te lo confirmo» suelto o con porcentaje', () => {
  it('«¡Sí! Te lo confirmo. ¿Cómo te llamas?» y «Claro, te confirmo. La valoración…» no dejan «Así es:.» colgando', () => {
    for (const texto of ['¡Sí! Te lo confirmo. ¿Cómo te llamas?', 'Claro, te confirmo. La valoración es gratuita. ¿Cómo te llamas?']) {
      const t = sale(texto);
      expect(t, texto).not.toMatch(/Así es:\s*[.¿]|Así es:\s*$/);
      expect(t.endsWith('¿Cómo te llamas?'), texto).toBe(true);
    }
  });
  it('«Te lo confirmo al 100%: la valoración … es totalmente gratuita» (F3) sale como «Así es: …»', () => {
    const t = sale('Te lo confirmo al 100%: la valoración con la Dra. Evy es totalmente gratuita y sin compromiso. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).toMatch(/la valoración con la Dra\. Evy es totalmente gratuita/);
  });
});

describe('enlaces y teléfonos: se borra la oración entera', () => {
  it('«Visita www.evy.com o escribe al 70000000.» no deja «Visita o escribe al .»', () => {
    const t = sale('Con gusto te oriento. Visita www.evy.com o escribe al 70000000. Tu valoración es gratuita. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).not.toMatch(/Visita|escribe al|www|7000/);
    expect(t).toContain('Tu valoración es gratuita.');
  });
});

describe('cuidados posteriores: el modelo no los inventa', () => {
  it('«evita el ejercicio por 2 días. Sin embargo, puedes retomar tu rutina normal»: ambas se borran', () => {
    const t = sale('Buena pregunta. Evita el ejercicio por 2 días. Sin embargo, puedes retomar tu rutina normal. Tu valoración es gratuita. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).not.toMatch(/ejercicio|rutina/i);
    expect(t).toContain('Los cuidados posteriores te los explica la Dra. en la valoración.');
  });
  it('«Así, …» tras una oración borrada pierde su conector', () => {
    const t = sale('Nunca podemos garantizar un resultado idéntico. Así, la Dra. evalúa tu caso en persona. ¿Cómo te llamas?');
    expect(t).toContain('La Dra. evalúa tu caso en persona.');
    expect(t).not.toMatch(/Así,/);
  });
  it('NEGADA: «evitar ciertas actividades físicas intensas los primeros días» se borra y el código deja la remisión a la Dra.', () => {
    const t = sale('Es una excelente pregunta. La Dra. Evy te dará recomendaciones sencillas (como evitar ciertas actividades físicas intensas los primeros días) en tu consulta. Tu valoración es 100% gratuita. ¿Cómo te llamas?', '¿cuánto tiempo de recuperación? trabajo todos los días');
    expect(fallo(t)).toBe(false);
    expect(t).not.toMatch(/evitar|actividades f/i);
    expect(t).toContain('Los cuidados posteriores te los explica la Dra. en la valoración.');
    expect(t.endsWith('¿Cómo te llamas?')).toBe(true);
  });
  it('POSITIVA: «puedes reincorporarte rápido; la Dra. te explica los cuidados» pasa sin cambios', () => {
    const t = sale('Puedes reincorporarte rápido a tu trabajo; la Dra. te explica los cuidados en la valoración. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).toContain('Puedes reincorporarte rápido');
    expect(t).not.toMatch(/cuidados posteriores/);
  });
});

describe('conectores huérfanos: al borrar una oración, la siguiente pierde su «En cambio»', () => {
  it('«En cambio, los bioestimuladores…» tras una oración borrada empieza sin el conector', () => {
    const t = sale('¡Excelente pregunta! Nunca podemos garantizar un resultado idéntico. En cambio, los bioestimuladores activan tu propio colágeno. Sin embargo, Además, la valoración es gratuita. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).not.toMatch(/En cambio/);
    expect(t).toContain('Los bioestimuladores activan tu propio colágeno.');
  });
  it('POSITIVA: un conector cuya oración previa no se borró se conserva', () => {
    const t = sale('Los bioestimuladores activan tu colágeno. En cambio, un relleno solo da volumen. ¿Cómo te llamas?');
    expect(t).toContain('En cambio, un relleno solo da volumen.');
  });
});

describe('el cierre completo sale UNA vez por ficha', () => {
  const CIERRE = /Excelente decisión, Paola/;
  const DERIVA = '¡Perfecto! [DERIVAR_RECEPCION: Paola]';
  it('F3/F4/H3: tras el primer cierre, seguir escribiendo no lo repite; si pide agendar de nuevo, sale la variante corta con botón y SIN otro aviso; nunca el mismo texto dos veces seguidas', () => {
    const m = crear({ modeloDice: dice(DERIVA) });
    const t1 = hablar(m, ANA, mTexto('quiero agendar, soy Paola'));
    expect(textos(t1)[0]).toMatch(CIERRE);
    expect(t1.mensajes[0]!.tipo).toBe('interactive');
    for (const seguir of ['gracias, ¿cuánto dura la sesión?', 'ok y ¿se puede con lentes?', 'perfecto, gracias']) {
      const t = hablar(m, ANA, mTexto(seguir));
      expect(textos(t).join(' '), seguir).not.toMatch(CIERRE);
      expect(t.mensajes.every((e) => e.tipo !== 'interactive'), seguir).toBe(true);
    }
    const t4 = hablar(m, ANA, mTexto('quiero agendar de nuevo'));
    expect(textos(t4)).toEqual(['Claro, aquí tienes de nuevo el botón para escribirle a recepción.']);
    expect(t4.mensajes[0]!.tipo).toBe('interactive');
    expect(avisosARecepcion(t4).length).toBe(0);
    const t5 = hablar(m, ANA, mTexto('quiero agendar otra vez'));
    expect(textos(t5)).toEqual(['Con gusto, el botón sigue disponible para escribirle a recepción.']);   // nunca el mismo texto dos veces seguidas
    expect(t5.mensajes[0]!.tipo).toBe('interactive');
  });
  it('alternancia A/B/A y aviso: el aviso no se repite dentro de los 30 minutos y sí al vencer la ventana', () => {
    const m = crear({ modeloDice: dice(DERIVA) });
    hablar(m, ANA, mTexto('quiero agendar, soy Paola'));
    expect(textos(hablar(m, ANA, mTexto('quiero agendar'))).join(' ')).toContain('Claro, aquí tienes');
    expect(textos(hablar(m, ANA, mTexto('quiero agendar'))).join(' ')).toContain('Con gusto, el botón');
    m.avanzar(40);
    const t = hablar(m, ANA, mTexto('quiero agendar'));
    expect(textos(t).join(' ')).toContain('Claro, aquí tienes');
    expect(avisosARecepcion(t).length).toBe(1);
  });
  it('a las 48 h la ficha se olvida y vuelve a salir el cierre completo', () => {
    const m = crear({ modeloDice: dice(DERIVA) });
    hablar(m, ANA, mTexto('quiero agendar, soy Paola'));
    m.avanzar(49 * 60);
    expect(textos(hablar(m, ANA, mTexto('quiero agendar'))).join(' ')).toMatch(/Excelente decisión/);
  });
  it('dos teléfonos: el cierre de uno no afecta al otro', () => {
    const m = crear({ modeloDice: dice(DERIVA) });
    hablar(m, ANA, mTexto('quiero agendar'));
    expect(textos(hablar(m, BETO, mTexto('quiero agendar'))).join(' ')).toMatch(/Excelente decisión/);
    expect(textos(hablar(m, ANA, mTexto('quiero agendar'))).join(' ')).toContain('Claro, aquí tienes');
  });
  it('NEGADA: si el envío del cierre falla (principal y respaldo), no cuenta como hecho: el siguiente pedido recibe el cierre COMPLETO', () => {
    const envio: Record<string, string> = { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' };
    // @ts-expect-error el objeto es mutable a propósito: el doble lo lee en cada envío
    const m = crear({ modeloDice: dice(DERIVA), envio });
    hablar(m, ANA, mTexto('quiero agendar'), { toleraFallo: true });
    envio['Enviar a WhatsApp'] = 'acepta'; envio['Enviar respaldo'] = 'acepta';
    expect(textos(hablar(m, ANA, mTexto('quiero agendar'))).join(' ')).toMatch(/Excelente decisión/);
  });
  it('«sigue conversando» va al modelo sin botón; la etiqueta sin texto y un pedido con negación también se tratan bien', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('cuánto dura') ? '[DERIVAR_RECEPCION]' : DERIVA) });
    hablar(m, ANA, mTexto('quiero agendar, soy Paola'));
    const sinTexto = hablar(m, ANA, mTexto('¿cuánto dura la sesión?'));
    expect(textos(sinTexto)[0]).toContain('botón');   // etiqueta sin texto: variante corta con botón
    expect(sinTexto.mensajes[0]!.tipo).toBe('interactive');
    const m2 = crear({ modeloDice: dice('La sesión dura unos 40 minutos. [DERIVAR_RECEPCION]') });
    hablar(m2, ANA, mTexto('quiero agendar'));
    const neg = hablar(m2, ANA, mTexto('todavía no quiero agendar, ¿cuánto dura?'));
    expect(textos(neg).join(' ')).toContain('La sesión dura unos 40 minutos.');
    expect(neg.mensajes.every((e) => e.tipo !== 'interactive')).toBe(true);
  });
  it('POSITIVA: el primer cierre sigue saliendo completo con su botón y su aviso', () => {
    const t = hablar(crear({ modeloDice: dice(DERIVA) }), ANA, mTexto('quiero agendar'));
    expect(textos(t)[0]).toMatch(CIERRE);
    expect(t.mensajes[0]!.tipo).toBe('interactive');
  });
});

describe('la pregunta por la gratuidad se contesta con un texto fijo cuando el modelo falla', () => {
  it('NEGADA: las preguntas por el costo del TRATAMIENTO no reciben el texto de gratuidad: van al fallo con botón', () => {
    for (const q of ['¿cuánto cobran por el Radiesse?', '¿el tratamiento tiene costo alto?']) {
      const t = hablar(crear({ modeloDice: 'cae' }), ANA, mTexto(q));
      expect(textos(t).join(' '), q).not.toContain('100% gratuita');
      expect(fallo(textos(t)[0]!), q).toBe(true);
      expect(t.mensajes[0]!.tipo, q).toBe('interactive');
    }
    expect(textos(hablar(crear({ modeloDice: 'cae' }), ANA, mTexto('¿cuánto cobran por la valoración?')))[0]).toContain('100% gratuita');
  });
  it('el resumen informa el plan «gratis» cuando el fijo sustituye al texto rechazado del modelo', () => {
    const t = hablar(crear({ modeloDice: dice('Ya pagaste tu reserva.') }), ANA, mTexto('¿es gratis?'));
    expect(textos(t)[0]).toContain('100% gratuita');
  });
  it('«quiero agendar pero no ahora» no deriva', () => {
    const t = hablar(crear({ modeloDice: dice('Sin problema, aquí estaré. ¿Cómo te llamas?') }), ANA, mTexto('quiero agendar pero no ahora'));
    expect(t.mensajes.every((e) => e.tipo !== 'interactive')).toBe(true);
    expect(avisosARecepcion(t).length).toBe(0);
  });
  const FIJO = 'Sí, la valoración con la Dra. Evy Karina Rojas es 100% gratuita y sin compromiso: no pagas nada por adelantado ni dejas ningún anticipo para reservar. (Su valor habitual es de 250 Bs; por la campaña está bonificado).';
  const PREGUNTAS = ['¿De verdad es gratis?', '¿Hay algún costo escondido o pago de reserva?', '¿tengo que dejar un anticipo?'];
  for (const q of PREGUNTAS) {
    it(`POSITIVA: «${q}» con el modelo rechazado o caído: texto fijo, sin botón ni aviso`, () => {
      for (const modelo of ['cae', 'Te lo confirmo, Paola: ya pagaste tu reserva y tu pago fue acreditado.']) {
        const m = crear({ modeloDice: modelo === 'cae' ? 'cae' : dice(modelo) });
        const t = hablar(m, ANA, mTexto(q));
        expect(textos(t)[0], q).toContain(FIJO);
        expect(t.mensajes[0]!.tipo, q).toBe('text');
        expect(avisosARecepcion(t).length, q).toBe(0);
        expect(textos(t)[0]).toContain('¿Cómo te llamas y qué te gustaría mejorar en tu rostro?');
      }
    });
  }
  it('con el nombre ya dado no repite la pregunta final', () => {
    const m = crear({ modeloDice: 'cae' });
    const t = hablar(m, ANA, mTexto('Soy Paola, ¿es gratis?'));
    expect(textos(t)[0]).toBe(FIJO);
  });
  it('NEGADA: el texto fijo jamás sale si el cliente no preguntó por eso (cae al fallo con botón y aviso); «ya pagaste tu reserva» sigue rechazado', () => {
    const t = hablar(crear({ modeloDice: 'cae' }), ANA, mTexto('¿y duele?'));
    expect(textos(t).join(' ')).not.toContain('100% gratuita');
    expect(fallo(textos(t)[0]!)).toBe(true);
    const u = sale('Ya pagaste tu reserva. ¿Cómo te llamas?', '¿y duele?');
    expect(fallo(u)).toBe(true);
    expect(u).not.toContain('100% gratuita');
  });
  it('si el modelo contesta bien, sale lo del modelo y no el fijo', () => {
    const t = sale('Sí, es gratuita y sin compromiso. ¿Cómo te llamas?', '¿es gratis?');
    expect(t).toContain('Sí, es gratuita y sin compromiso.');
    expect(t).not.toContain('por adelantado');
  });
});

describe('«Ok, quiero agendar» deriva aunque el modelo no emita la etiqueta (F3 turno 6)', () => {
  it('sale el cierre con su botón y su aviso; «cómo agendo» (pregunta) no deriva', () => {
    const t = hablar(crear({ modeloDice: dice('¡Sí, de verdad es gratuita! Me alegra tu decisión.') }), ANA, mTexto('Ok, quiero agendar'));
    expect(textos(t)[0]).toMatch(/Excelente decisión/);
    expect(t.mensajes[0]!.tipo).toBe('interactive');
    expect(avisosARecepcion(t).length).toBe(1);
    const c = hablar(crear({ modeloDice: dice('Con gusto te cuento. ¿Cómo te llamas?') }), ANA, mTexto('¿cómo se agenda la valoración?'));
    expect(c.mensajes.every((e) => e.tipo !== 'interactive')).toBe(true);
  });
  it('con el modelo caído y un pedido explícito, igual sale el cierre (no el fallo)', () => {
    const t = hablar(crear({ modeloDice: 'cae' }), ANA, mTexto('quiero agendar'));
    expect(textos(t)[0]).toMatch(/Excelente decisión/);
  });
});

describe('Evy NO agenda: ninguna oración del modelo afirma una cita, un cupo o un registro (sin la muletilla «Te confirmo»)', () => {
  const AFIRMAN = [
    'Ya tienes tu espacio con la Dra. el lunes.', 'Ya te tiene en su lista para el lunes.', 'La recepción ya registró tu valoración.', 'Listo, ya está todo hecho, nos vemos el martes.',
    'La Dra. te verá el jueves a las 4 pm.', 'Tu valoración quedó para el viernes.', 'Te esperamos el lunes a las 10:30.', 'Así es: la Dra. te atiende el miércoles.',
    'Ya tienes tu espacio el lunes, ¿verdad?', 'Ya quedaste inscrita, ¿no?', 'Te esperamos el lunes a las 10:30 con la Dra. ¿Te parece?', 'Ya quedó tu cita.', 'Ya te inscribí.',
    'Ya estás en la agenda del jueves.', 'Listo, el lunes 10:00 es tuyo.', 'Pasado mañana vienes a las 4.', 'Te espera la Dra. mañana.', 'Perfecto, apartado para el miércoles.',
    'Ya quedaste inscrita.', 'Recepción ya sabe que vas el martes.', 'Ya tiene tu cupo.', 'Te guardé el horario de las 16 hs.', 'Te confirmo al 100%: estás inscrita.',
  ];
  for (const f of AFIRMAN) {
    it(`NEGADA: «${f}»`, () => {
      const t = sale(`${f} ¿Cómo te llamas?`);
      expect(fallo(t), f).toBe(true);
    });
  }
  it('POSITIVAS: gratuita esta semana, dirección, horario de atención, invitación, preguntas y condicionales pasan', () => {
    for (const bien of [
      'Te confirmo que la valoración es gratuita esta semana.', 'Te esperamos en la Clínica DentalCor, Calle Sapocó 53.', 'Atendemos de lunes a viernes de 08:30 a 18:30 y sábados de 09:00 a 12:00.',
      'Te cuento que la Dra. atiende los lunes y miércoles.', 'Te comento que a las 2 semanas notas el cambio.', 'Tu valoración está bonificada hasta el viernes.',
      'Te recomiendo escribir a recepción para agendar, ellos atienden el lunes.',
      'Puedes agendar cuando quieras.', '¿Te gustaría el lunes?', 'Si quieres el lunes, dímelo.', 'Hoy tu valoración está bonificada al 100%.',
    ]) {
      const t = sale(`${bien} ¿Cómo te llamas?`);
      expect(fallo(t), bien).toBe(false);
    }
  });
  it('el cierre fijo y el texto fijo de gratuidad no son tocados', () => {
    const t = hablar(crear({ modeloDice: dice('[DERIVAR_RECEPCION: Paola]') }), ANA, mTexto('quiero agendar'));
    expect(textos(t)[0]).toMatch(/Excelente decisión, Paola/);
  });
});

describe('más cuidados y promesas (huecos de la seguridad final)', () => {
  for (const c of ['Duerme boca arriba esa noche.', 'Bebe mucha agua después.', 'No vayas al sauna una semana.']) {
    it(`NEGADA con pregunta de cuidados: «${c}»`, () => {
      const t = sale(`La Dra. te atiende en persona. ${c} Tu valoración es gratuita. ¿Cómo te llamas?`, '¿qué cuidados tengo que tener después?');
      expect(fallo(t)).toBe(false);
      expect(t).not.toMatch(/duerme|bebe mucha|sauna/i);
      expect(t).toContain('Los cuidados posteriores te los explica la Dra. en la valoración.');
    });
  }
  it('POSITIVAS: «rejuvenecer» descriptivo y «regia» suelta pasan', () => {
    for (const bien of ['Activa tu colágeno para rejuvenecer la piel.', 'Ayuda a rejuvenecer la piel de forma natural.', 'Ella es una profesional regia.']) expect(fallo(sale(`${bien} ¿Cómo te llamas?`)), bien).toBe(false);
  });
  for (const p of ['Rejuvenecerás 10 años.', 'Te rejuvenece al instante.', 'Vas a rejuvenecer 10 años.', 'Vas a salir regia.', 'Quedarás regia.']) {
    it(`NEGADA: «${p}»`, () => { expect(fallo(sale(`${p} ¿Cómo te llamas?`))).toBe(true); });
  }
});

describe('«Te confirmo» no afirma una cita (Evy no agenda)', () => {
  for (const mala of [
    'Te confirmo que la Dra. te espera mañana a las 10. ¿Cómo te llamas?',
    'Te confirmo que ya tienes tu espacio con la Dra. el lunes. ¿Cómo te llamas?',
    'Te confirmo que la Dra. ya te tiene en su lista para el lunes. ¿Cómo te llamas?',
    'Te confirmo que la recepción ya registró tu valoración del lunes. ¿Cómo te llamas?',
    'Te confirmo: listo, ya está todo hecho, nos vemos el martes. ¿Cómo te llamas?',
  ]) {
    it(`NEGADA: ${mala.slice(0, 55)}`, () => {
      const t = sale(mala);
      expect(fallo(t)).toBe(true);
      expect(t).not.toMatch(/espera|espacio|lista|registr|martes/i);
    });
  }
});

describe('cuidados y promesas con otras redacciones', () => {
  const CUIDADOS = [
    'Evita maquillarte las primeras 24 horas.', 'Aplica hielo en la zona tratada.', 'No te recuestes boca abajo.', 'Lo ideal es no hacer ejercicio intenso unos días.',
    'Usa protector solar.', 'Masajea la zona suavemente.', 'Puedes retomar tu rutina al día siguiente.', 'No es necesario reposo absoluto.',
  ];
  for (const c of CUIDADOS) {
    it(`NEGADA: «${c}» se borra y queda la remisión`, () => {
      const t = sale(`La Dra. Evy te atiende en persona. ${c} Tu valoración es gratuita. ¿Cómo te llamas?`, '¿qué cuidados hay después?');
      expect(fallo(t)).toBe(false);
      expect(t).not.toMatch(/maquill|hielo|recuest|ejercicio|protector|masajea|rutina|reposo/i);
      expect(t).toContain('Los cuidados posteriores te los explica la Dra. en la valoración.');
    });
  }
  it('POSITIVA: «la Dra. te explica los cuidados» pasa sin la remisión extra', () => {
    const t = sale('La Dra. te explica los cuidados en la valoración. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).not.toContain('Los cuidados posteriores');
  });
  for (const p of ['Funciona siempre. ¿Cómo te llamas?', 'Quedarás divina. ¿Cómo te llamas?', 'Lucirás perfecta. ¿Cómo te llamas?', 'Te verás 10 años más joven. ¿Cómo te llamas?', 'Los resultados son excelentes y duraderos en todas las pacientes. ¿Cómo te llamas?']) {
    it(`NEGADA: ${p.slice(0, 40)}`, () => { expect(fallo(sale(p))).toBe(true); });
  }
});

describe('el motor de la batería: pausa entre llamadas', () => {
  it('--pausa-ms acepta un entero y rechaza lo demás', async () => {
    // @ts-expect-error el motor es un .mjs sin tipos
    const { main } = await import('../../../../Flujos/experimental/rroca-evy/herramientas/bateria.mjs');
    const sal: string[] = []; const err: string[] = [];
    const deps = { salida: (t: string) => sal.push(t), error: (t: string) => err.push(t) };
    expect(await main(['--seco', '--pausa-ms', 'abc'], deps)).toBe(2);
    expect(await main(['--seco', '--pausa-ms', '70000'], deps)).toBe(2);
    expect(err.join('')).toMatch(/--pausa-ms debe ser un entero entre 0 y 60000/);
  });
});

describe('«es seguro que…» no es un consejo de salud', () => {
  it('POSITIVA: «es seguro que te va a gustar» pasa', () => {
    expect(fallo(sale('Es seguro que te va a gustar la valoración gratuita. ¿Cómo te llamas?'))).toBe(false);
  });
  it('NEGADA: afirmar seguridad médica no pasa', () => {
    expect(fallo(sale('Es totalmente seguro para ti. ¿Cómo te llamas?'))).toBe(true);
    expect(fallo(sale('Es seguro para el embarazo. ¿Cómo te llamas?'))).toBe(true);
  });
});

describe('un texto largo se recorta por oración; uno desmesurado se descarta en tiempo lineal', () => {
  const RELLENO = Array.from({ length: 40 }, (_, i) => `Esta es la oración de relleno número ${i + 1} sobre el efecto lifting natural y el contorno del rostro.`).join(' ');
  it('POSITIVA: el recorte conserva la primera oración, la valoración gratuita y la pregunta de nombre y deseo', () => {
    const t = sale(`¡Hola! Soy el asistente virtual de la Dra. Evy. ${RELLENO} Tu valoración con la Dra. Evy es 100% gratuita y sin compromiso. ¿Cómo te llamas y qué te gustaría mejorar en tu rostro?`);
    expect(fallo(t)).toBe(false);
    expect(t.length).toBeLessThanOrEqual(1500);
    expect(t).toContain('Soy el asistente virtual de la Dra. Evy.');
    expect(t).toContain('100% gratuita y sin compromiso');
    expect(t.endsWith('¿Cómo te llamas y qué te gustaría mejorar en tu rostro?')).toBe(true);
  });
  it('NEGADA: lo que se recorta no deja pasar una garantía escondida entre las oraciones', () => {
    expect(fallo(sale(`¡Hola! ${RELLENO} Te garantizo el resultado. ¿Cómo te llamas?`))).toBe(true);
  });
  it('120 000 espacios seguidos o 120 000 caracteres: cae al fallo y tarda poco (costo lineal)', () => {
    for (const largo of ['Hola' + ' '.repeat(120000) + 'chao', 'a'.repeat(40000), '[' + 'x '.repeat(30000)]) {
      const t0 = Date.now();
      const t = sale(largo);
      expect(Date.now() - t0, largo.slice(0, 5)).toBeLessThan(3000);
      expect(fallo(t)).toBe(true);
    }
  });
});
