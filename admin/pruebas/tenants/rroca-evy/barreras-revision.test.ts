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
import { ANA, crear, dice, hablar, mTexto, textos } from './mundo';

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
    expect(t).toContain('Así es: la valoración es 100% gratuita.');
    expect(t).toContain('No hay ningún costo escondido ni compromiso.');
    expect(t).not.toMatch(/Te lo confirmo/);
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
      expect(t, texto).not.toMatch(/confirmo/i);
      expect(t.endsWith('¿Cómo te llamas?'), texto).toBe(true);
    }
  });
  it('«Te lo confirmo al 100%: la valoración … es totalmente gratuita» (F3) sale como «Así es: …»', () => {
    const t = sale('Te lo confirmo al 100%: la valoración con la Dra. Evy es totalmente gratuita y sin compromiso. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).toContain('Así es: la valoración con la Dra. Evy es totalmente gratuita');
    expect(t).not.toMatch(/100%:|confirmo/);
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
