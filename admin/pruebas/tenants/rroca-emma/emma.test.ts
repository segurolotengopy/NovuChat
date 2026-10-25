/**
 * LO PROPIO DE EMMA frente al flujo de Evy del que sale (24/10/2026): sin ancla de monto (el asistente de Emma NUNCA menciona una cifra de dinero), valoración gratuita y sin pago de reserva, Sculptra® y Radiesse®,
 * dos imágenes activas (bata = autoridad y antes y después; la comparativa no existe), Caso B con las tres capturas de Emma (la lista cerrada de visión es de Emma, no la de Evy), horario de turno partido que sale
 * de la Consola, dirección con «2do y 3er anillo» que no se confunde con un rango de precio, nada de Evy en ningún archivo, y Emma NO agenda.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error el motor es un .mjs sin tipos
import { main } from '../../../../Flujos/experimental/rroca-emma/herramientas/bateria.mjs';
import { ANA, CARPETA, HORARIO_DE_LA_CONSOLA, IDS, PRODUCCION, PRUEBA, REC, avisosARecepcion, crear, dice, hablar, imagenes, mImagen, mTexto, panelOk, textos } from './mundo';

const sin = (t: string, ...palabras: string[]): boolean => palabras.every((p) => !t.toLowerCase().includes(p.toLowerCase()));
const fallo = (t: string): boolean => /inconveniente para responderte/.test(t);
const sale = (modelo: string, msg = 'cuéntame de la valoración'): string => textos(hablar(crear({ modeloDice: dice(modelo) }), ANA, mTexto(msg)))[0] ?? '';
const leer = (rel: string): string => readFileSync(join(CARPETA, rel), 'utf8');

describe('nada de Evy ni de otra doctora en ningún archivo del flujo de Emma', () => {
  it('ni en el prompt, ni en el código, ni en los dos JSON, ni en los datos', () => {
    const archivos = ['prompts/emma.md', 'src/lib/ev.js', 'flujo.plantilla.json', 'rroca-emma.json', 'rroca-emma.prueba.json', ...readdirSync(join(CARPETA, 'src/nodos')).map((f) => `src/nodos/${f}`)];
    for (const a of archivos) {
      const t = leer(a);
      // las notas de los nodos pueden nombrar al cliente del que se copió el diseño solo en DISENO/PROPIO; aquí, en el flujo y el código, nunca
      // sin distinguir mayúsculas; la lista blanca son los identificadores del código que contienen «evy» por casualidad (`evYaVisto`)
      const sinBlancos = t.replace(/evYaVisto/g, '');
      for (const x of ['evy', 'karina', 'dentalcor', 'harmonyca', 'sapocó', 'piraí', 'blazer']) expect(sinBlancos.toLowerCase(), `${a}: ${x}`).not.toContain(x);
    }
  });
  it('el nombre es «la Dra. Emma» (decisión de Andres): ni «Enma» en el flujo, ni «Emma Aguilera» inventado', () => {
    for (const a of ['prompts/emma.md', 'src/lib/ev.js', 'rroca-emma.json']) expect(leer(a), a).not.toMatch(/\bEnma\b|\bAguilera\b|\bMozer\b/);
  });
});

describe('SIN ancla de monto: Emma nunca menciona una cifra de dinero', () => {
  it('el prompt no tiene ninguna cifra de dinero ni «valor habitual»', () => {
    const p = leer('prompts/emma.md');
    expect(p).not.toMatch(/\b\d[\d.,]*\s*(?:bs|bolivianos|usd|\$)\b/i);
    expect(p).not.toMatch(/250|habitualmente cuesta|costo habitual de/i);
    expect(p).toContain('100% GRATUITA');
    expect(p).toMatch(/sin pagar nada de reserva o anticipo/);
  });
  for (const monto of ['La valoración habitualmente cuesta 250 Bs pero hoy es gratis. ¿Cómo te llamas?', 'Tu valoración es gratuita, ahorras 250 Bs. ¿Cómo te llamas?', 'El tratamiento cuesta 1500 Bs por sesión. ¿Cómo te llamas?', 'Sale entre 300 y 500 dólares. ¿Cómo te llamas?']) {
    it(`NEGADA: «${monto.slice(0, 50)}» cae al fallo con botón (ningún monto sale)`, () => {
      const t = hablar(crear({ modeloDice: dice(monto) }), ANA, mTexto('cuánto cuesta'));
      expect(fallo(textos(t)[0] ?? '')).toBe(true);
      expect(textos(t).join(' ')).not.toMatch(/\d{3}/);
      expect(t.mensajes[0]!.tipo).toBe('interactive');
    });
  }
  it('los textos fijos (cierre y gratuidad) dicen «100% gratuita» y «sin pago de reserva», sin «bonificada» ni cifras', () => {
    const cierre = textos(hablar(crear({ modeloDice: dice('[DERIVAR_RECEPCION: Ana]') }), ANA, mTexto('quiero agendar')))[0]!;
    expect(cierre).toContain('100% gratuita');
    expect(cierre).toContain('sin pago de reserva');
    const gratis = textos(hablar(crear({ modeloDice: 'cae' }), ANA, mTexto('¿es gratis?')))[0]!;
    expect(gratis).toContain('100% gratuita');
    for (const t of [cierre, gratis]) expect(t).not.toMatch(/bonific|\bBs\b/);
  });
});

describe('el horario y la dirección salen de la Consola, no del flujo', () => {
  it('el prompt que ve el modelo lleva el horario de TURNO PARTIDO de la Consola y la dirección de Emma', () => {
    let sistema = '';
    hablar(crear({ modeloDice: (ll) => { sistema = JSON.stringify(ll.cuerpo?.['systemInstruction']); return 'ok'; } }), ANA, mTexto('hola'));
    expect(sistema).toContain(HORARIO_DE_LA_CONSOLA.slice(0, 40));
    expect(sistema).toContain('14:00 a 18:00');
    expect(sistema).toContain('Emma Spa Medic');
    expect(sistema).toContain('Pauserna');
  });
  it('NEGADA: el flujo no trae el horario escrito (solo la dirección de respaldo, que se usa si la Consola cae); con la Consola caída no inventa un horario', () => {
    for (const j of [PRODUCCION, PRUEBA]) {
      const t = JSON.stringify(j);
      expect(t).not.toMatch(/14:00|18:00|09:00|\b9:00/);
    }
    let sistema = '';
    hablar(crear({ panel: 'cae', modeloDice: (ll) => { sistema = JSON.stringify(ll.cuerpo?.['systemInstruction']); return 'ok'; } }), ANA, mTexto('hola'));
    expect(sistema).toContain('no lo tienes cargado');
    expect(sistema).not.toMatch(/14:00 a 18:00/);
  });
  it('la dirección con «entre 2do y 3er anillo» NO se confunde con un rango de precio: la cadena exacta sale tal cual y una variante sale con los ordinales en palabras', () => {
    const t1 = sale('Atendemos en Emma Spa Medic, ubicada en Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055 (Santa Cruz).', '¿dónde están?');
    expect(fallo(t1)).toBe(false);
    expect(t1).toContain('Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055 (Santa Cruz)');
    // la dirección SIN el «(Santa Cruz)» final también se protege: sale tal cual
    const t2 = sale('Estamos en Emma Spa Medic: Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055.', '¿dónde están?');
    expect(fallo(t2)).toBe(false);
    expect(t2).toContain('Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055');
    expect(t2).toContain('2055');
  });
  it('NEGADA: un rango de precio con «entre» y cifras sigue cayendo al fallo', () => {
    expect(fallo(sale('Sale entre 2 y 3 mil bolivianos. ¿Cómo te llamas?'))).toBe(true);
    expect(fallo(sale('El tratamiento cuesta entre 500 y 800. ¿Cómo te llamas?'))).toBe(true);
  });
});

describe('las imágenes de Emma: dos activas, la comparativa preparada pero inactiva', () => {
  it('la bata (autoridad) y el antes y después salen con su id; la comparativa NO sale aunque pregunten la diferencia', () => {
    const bata = hablar(crear({ modeloDice: dice('[ENVIAR_ARTE_AUTORIDAD] Así activamos tu colágeno natural.') }), ANA, mTexto('¿cómo funciona el tratamiento?'));
    expect(imagenes(bata)).toEqual([IDS.autoridad]);
    const antes = hablar(crear({ modeloDice: dice('[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real de la Dra. Emma. Cada piel responde distinto.') }), ANA, mTexto('quiero ver cómo queda'));
    expect(imagenes(antes)).toEqual([IDS.antes_despues]);
    const comp = hablar(crear({ modeloDice: dice('[ENVIAR_ARTE_COMPARATIVO] Te explico la diferencia entre Sculptra y Radiesse.') }), ANA, mTexto('¿cuál es la diferencia entre Sculptra y Radiesse?'));
    expect(imagenes(comp)).toEqual([]);
    expect(textos(comp)[0]).not.toMatch(/\[|ENVIAR_ARTE/);
  });
  it('el prompt solo le enseña al modelo las dos etiquetas activas (la comparativa no se menciona)', () => {
    const p = leer('prompts/emma.md');
    expect(p).toContain('[ENVIAR_ARTE_AUTORIDAD]');
    expect(p).toContain('[ENVIAR_ARTE_ANTES_DESPUES]');
    expect(p).not.toContain('[ENVIAR_ARTE_COMPARATIVO]');
  });
  it('el código deja PREPARADA la etiqueta del comparativo (se reconoce y se quita del texto aunque no haya imagen)', () => {
    expect(leer('src/lib/ev.js')).toMatch(/ENVIAR\[\\s_-\]\*ARTE\[\\s_-\]\*\(COMPARATIVO/);
  });
});

describe('Caso B: la lista cerrada de visión es la de Emma (bata, antes y después, espejo, otra)', () => {
  const vision = (tipo: string, texto = ''): string => {
    let visto = '';
    const m = crear({ medio: { vision: { tipo, texto, descripcion: tipo === 'otra' ? 'una selfie' : '' } }, modeloDice: (ll) => { visto = JSON.stringify(ll.cuerpo); return 'Qué gusto saludarte. ¿Cómo te llamas?'; } });
    hablar(m, ANA, mImagen({ caption: '¿Qué es esto?' }));
    return visto;
  };
  it('los tres anuncios de Emma llegan al modelo con su rótulo canónico', () => {
    expect(vision('bata')).toContain('Activa tu colágeno natural');
    expect(vision('antes_despues')).toContain('Resultados reales, sigues siendo tú');
    expect(vision('espejo')).toContain('Te sientes joven por dentro');
  });
  it('NEGADA: los tipos de Evy (blazer, comparativo) no existen para Emma: llegan como «otra imagen» con su descripción, nunca con el rótulo de un anuncio', () => {
    for (const tipo of ['blazer_blanco', 'blazer_fucsia', 'comparativo']) {
      const visto = vision(tipo, 'texto leído');
      expect(visto, tipo).not.toMatch(/Armonía que se nota|blazer|¿Radiesse® o HArmonyCa/);
      expect(visto, tipo).toContain('IMAGEN_RECIBIDA');
    }
  });
  it('el prompt de visión (el nodo «Ver imagen») nombra los tres anuncios de Emma y no los de Evy', () => {
    const nodo = PRODUCCION.nodes.find((n) => n.name === 'Ver imagen')!;
    const texto = String((nodo.parameters as Record<string, unknown>)['text']);
    for (const x of ['bata', 'antes_despues', 'espejo', 'Activa tu colágeno natural', 'Resultados reales, sigues siendo tú', 'Te sientes joven por dentro']) expect(texto).toContain(x);
    for (const x of ['blazer', 'Armonía que se nota', 'HArmonyCa', 'comparativo']) expect(texto).not.toContain(x);
  });
});

describe('el prompt de Emma: las correcciones acordadas', () => {
  const p = leer('prompts/emma.md');
  it('«efecto lifting» sin «desde la primera sesión»; nada de «inmediato» (salvo la regla 11, que lo PROHÍBE)', () => {
    expect(p.split('\n').filter((l) => !l.startsWith('11. ')).join('\n')).not.toMatch(/primera sesi[oó]n|inmediat/i);
    expect(p).toContain('efecto lifting');
  });
  it('Sculptra® y Radiesse® van en bloques de marcas (se apagan con usarMarcas) y la valoración es gratuita y sin pago de reserva', () => {
    expect(p).toMatch(/\{\{#MARCAS\}\}[^]*Sculptra®[^]*\{\{\/MARCAS\}\}/);
    expect(p).toMatch(/\{\{\^MARCAS\}\}/);
    expect(p).toMatch(/GRATUITA/);
  });
  it('el saludo es corto: dos párrafos y menos de 700 caracteres', () => {
    const m = /Respuesta de Bienvenida Modelo[^\n]*\n\s*"([^]*?)"\n/.exec(p)!;
    const saludo = m[1]!.replace(/\{\{#MARCAS\}\}|\{\{\/MARCAS\}\}|\{\{\^MARCAS\}\}[^]*?\{\{\/MARCAS\}\}/g, '').replace(/\{\{NEGOCIO\}\}/g, 'Dra. Emma').replace(/\*\*/g, '');
    expect(saludo.split(/\n\s+/).length).toBe(2);
    expect(saludo.length).toBeLessThan(700);
  });
  it('los 3 anuncios del Caso B más «otra», con la valoración gratis y la pregunta de nombre', () => {
    for (const x of ['Activa tu colágeno natural', 'Resultados reales, sigues siendo tú', 'Te sientes joven por dentro']) expect(p).toContain(x);
  });
  it('Emma NO agenda: el prompt lo dice y el cierre va a recepción', () => {
    expect(p).toMatch(/Tú NO agendas horarios/);
    expect(p).toContain('[DERIVAR_RECEPCION');
  });
});

describe('Emma NO agenda: el cierre es el botón a recepción más el aviso, y ninguna oración afirma una cita', () => {
  it('«quiero agendar» → cierre con UN botón y UN aviso a la recepción; el cierre no promete que alguien llame', () => {
    const m = crear({ modeloDice: dice('[DERIVAR_RECEPCION: Ana] Listo.') });
    hablar(m, REC, mTexto('hola, soy recepción'));
    const t = hablar(m, ANA, mTexto('quiero agendar mi valoración'));
    expect(t.mensajes.filter((e) => e.tipo === 'interactive').length).toBe(1);
    expect(avisosARecepcion(t).length).toBe(1);
    expect(textos(t)[0]).not.toMatch(/te llamamos|te escribir[aá]n|de inmediato|tu cita quedó/i);
  });
  for (const f of ['Ya tienes tu espacio el martes a las 10.', 'Quedó agendada tu valoración para el jueves.', 'La Dra. Emma te espera mañana a las 4 pm.']) {
    it(`NEGADA: «${f}»`, () => { expect(fallo(sale(`${f} ¿Cómo te llamas?`))).toBe(true); });
  }
  it('la consola de Emma tiene su tenantId: la de OTRO tenant (Evy) se ignora', () => {
    const otra = panelOk(); (otra.body as Record<string, unknown>)['tenantId'] = 'rroca-evy';
    ((otra.body as Record<string, unknown>)['datosDelNegocio'] as Record<string, unknown>)['direccion'] = 'Calle de Evy 1';
    let sistema = '';
    hablar(crear({ panel: otra, modeloDice: (ll) => { sistema = JSON.stringify(ll.cuerpo?.['systemInstruction']); return 'ok'; } }), ANA, mTexto('hola'));
    expect(sistema).not.toContain('Calle de Evy');
    expect(sistema).toContain('Pauserna');
  });
});

describe('humo de la batería real (24/10/2026): los 2 duros y las fallas blandas', () => {
  it('B2 (duro): «¿esto es real?» sobre la FOTO del antes y después no es la pregunta de identidad: «Así es, es una paciente real…» sale; «¿eres real?» sigue rechazada', () => {
    const modelo = '¡Hola! Qué bueno que nos escribas. Así es: esa es una paciente real de la Dra. Emma. [ENVIAR_ARTE_ANTES_DESPUES] Recuerda que cada piel responde distinto y no prometemos resultados idénticos. ¿Cómo te llamas y qué te gustaría mejorar en tu rostro?';
    const t = hablar(crear({ modeloDice: dice(modelo) }), ANA, mTexto('¿esto es real?'));
    expect(fallo(textos(t)[0] ?? '')).toBe(false);
    expect(imagenes(t)).toEqual([IDS.antes_despues]);
    // la barrera común sigue en pie: a «¿eres real?» una respuesta que no admite ser IA cae al fallo
    expect(fallo(textos(hablar(crear({ modeloDice: dice('No, aquí estamos para ayudarte con tu valoración gratuita. ¿Cómo te llamas?') }), ANA, mTexto('¿eres real?')))[0] ?? '')).toBe(true);
    const bot = textos(hablar(crear({ modeloDice: dice('No, soy una persona real de la clínica. ¿Cómo te llamas?') }), ANA, mTexto('¿eres un bot?')))[0] ?? '';
    expect(bot).toContain('Soy un asistente virtual con inteligencia artificial.');   // se repara con la admisión fija: nunca sale la negación
    expect(bot).not.toMatch(/persona real/);
  });
  it('C4 (duro): si el cliente pregunta si le va a quedar IGUAL, la aclaración «cada rostro responde distinto» la pone el CÓDIGO aunque el modelo no la traiga; si no pregunta eso, no la agrega', () => {
    for (const q of ['¿Y me va a quedar igual que a ella?', 'quiero quedar como la foto, ¿me queda igual?', '¿tendré el mismo resultado?']) {
      const t = textos(hablar(crear({ modeloDice: dice('Cada caso se evalúa en la valoración gratuita con la Dra. Emma. ¿Cómo te llamas?') }), ANA, mTexto(q)))[0]!;
      expect(t, q).toContain('Cada rostro responde distinto y no prometemos un resultado idéntico.');
      expect(t.endsWith('¿Cómo te llamas?'), q).toBe(true);
    }
    expect(textos(hablar(crear({ modeloDice: dice('Dura unos cuarenta minutos. ¿Cómo te llamas?') }), ANA, mTexto('¿cuánto dura la sesión?')))[0]).not.toContain('responde distinto');
  });
  it('«desde la primera sesión / aplicación» se quita (segunda adición a las barreras); «de inmediato» pierde la frase y la oración conserva su contenido', () => {
    const t = sale('Notarás el efecto desde la primera sesión. Radiesse define el contorno de forma inmediata y da firmeza. La valoración es gratuita. ¿Cómo te llamas?');
    expect(fallo(t)).toBe(false);
    expect(t).not.toMatch(/primera sesi|inmediat/i);
    expect(t).toContain('Radiesse define el contorno y da firmeza.');
    expect(sale('Se nota desde la primera aplicación. La valoración es gratuita. ¿Cómo te llamas?')).not.toMatch(/primera aplicaci/i);
    expect(sale('La valoración es gratuita y la primera cita es sin compromiso. ¿Cómo te llamas?')).toContain('primera cita');
  });
  it('la dirección de la Consola tal cual y sus paráfrasis NO se confunden con un rango de precio; los rangos reales siguen rechazados', () => {
    const exacta = 'Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055 (Santa Cruz)';
    const t = sale(`Atendemos en Emma Spa Medic, ubicada en ${exacta}.`, '¿dónde están?');
    expect(fallo(t)).toBe(false);
    expect(t).toContain(exacta);   // la cadena exacta de la Consola sale tal cual
    for (const par of ['Estamos en Canal Cotoca, entre el 2do. y el 3er. anillo, Av. Pauserna 2055.', 'Nos encuentras entre 2 y 3 anillo, sobre la Av. Pauserna.', 'Estamos entre el segundo y tercer anillo, Av. Pauserna # 2055.', 'Canal Cotoca entre el 2° y el 3° anillo, Av. Pauserna # 2055 (Santa Cruz).']) {
      const r = sale(par, '¿dónde están?');
      expect(fallo(r), par).toBe(false);
      expect(r, par).toMatch(/segundo y (el )?tercer anillo/);
    }
    expect(fallo(sale('Sale entre 2 y 3 mil bolivianos. ¿Cómo te llamas?'))).toBe(true);
    expect(fallo(sale('El tratamiento cuesta entre 500 y 800 Bs. ¿Cómo te llamas?'))).toBe(true);
  });
  it('I-1: un número de calle, de avenida, de «#», «Nº», «nro» o «km» no es un precio; combinado con una cifra de precio real SIGUE rechazado', () => {
    const dir = 'Estamos en la Av. Pauserna # 2055, cerca del km 4 de la ruta.';
    const r = sale(dir, '¿cuánto cuesta y dónde están?');
    expect(fallo(r)).toBe(false);
    expect(r).toContain('2055');
    // la dirección de la Consola SIN el «(Santa Cruz)» final también se protege
    const sinCiudad = sale('Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055. ¿Cómo te llamas?', '¿cuánto cuesta y dónde están?');
    expect(fallo(sinCiudad)).toBe(false);
    expect(sinCiudad).toMatch(/Av\. Pauserna # 2055/);
    for (const par of ['Nos ubicamos en Nº 2055 de la Av. Pauserna.', 'Estamos en el nro 2055 de la avenida.']) { const r2 = sale(par, '¿cuánto cuesta y dónde están?'); expect(fallo(r2), par + ' => ' + r2).toBe(false); }
    // NEGADAS (revisión de código): un «#», «Nº», «nro», «calle» o «km» delante de una cifra de precio NO la deja pasar, ni tras «¿cuánto cuesta?» ni tras «hola»
    for (const cli of ['¿cuánto cuesta?', 'hola']) {
      for (const precio of ['El valor de la sesión es Nº 1500.', 'Sculptra Nº 1500, Radiesse Nº 2000.', 'Sculptra #1500.', 'La sesión es de # 1500.', 'La sesión sale nro 1500.', 'El tratamiento queda en calle 1500.', 'La sesión es km 1500.', 'Serían No 700 por sesión.', 'La sesión queda en No 1.275.']) {
        expect(fallo(sale(`${precio} ¿Cómo te llamas?`, cli)), `${cli} / ${precio}`).toBe(true);
      }
    }
    // NEGADA: la dirección no abre la puerta a una cifra de precio
    expect(fallo(sale('Estamos en la Av. Pauserna # 2055 y la valoración vale 700. ¿Cómo te llamas?', '¿cuánto cuesta y dónde están?'))).toBe(true);
    expect(fallo(sale('Estamos en la Av. Pauserna # 2055. El tratamiento cuesta 700. ¿Cómo te llamas?', '¿cuánto cuesta y dónde están?'))).toBe(true);
  });
  it('I-2 / I-3 / B-1: solo se perdona la cifra de la dirección de la Consola; «Estamos con promoción: # 1500» es un precio; la dirección junto a «valoración gratuita» sale bien', () => {
    for (const cli of ['¿cuánto cuesta y dónde están?', '¿dónde están?', 'hola']) {
      for (const okDir of ['Estamos en la Av. Pauserna # 2055.', 'Nuestra dirección: Av. Pauserna # 2055, Canal Cotoca.', 'Estamos en Canal Cotoca, Av. Pauserna # 2055. La valoración es gratuita.']) {
        expect(fallo(sale(`${okDir} ¿Cómo te llamas?`, cli)), `${cli} / ${okDir}`).toBe(false);
      }
      for (const precio of ['Estamos con promoción: # 1500 por todo.', 'Estamos en promo, nro 1500 por las dos.', 'Estamos ofreciendo Nº 1500 por paquete.', 'Te queda en 900.', 'Te hacemos 500 de descuento.', 'Te sale 900 la sesión.']) {
        expect(fallo(sale(`${precio} ¿Cómo te llamas?`, cli)), `${cli} / ${precio}`).toBe(true);
      }
    }
    // legítimos: un año, una cantidad de personas, una duración
    expect(fallo(sale('En 2026 incorporamos Radiesse. ¿Cómo te llamas?'))).toBe(false);
    expect(fallo(sale('Hemos atendido a más de 1000 pacientes. ¿Cómo te llamas?'))).toBe(false);
  });
  it('el precio que repite el número de la dirección NO pasa; la cifra de la dirección solo se perdona tras «#», «Nº», «Av.» o un nombre de la dirección; con separador de miles también', () => {
    for (const cli of ['¿cuánto cuesta y dónde están?', 'hola']) {
      for (const precio of ['Estamos en Av. Pauserna 2055, la promo es 2055 por todo.', 'Te queda en 2055.', 'Sculptra 2055.', 'Estamos en Av. Pauserna 2055 y la sesión sale 2055.']) {
        expect(fallo(sale(`${precio} ¿Cómo te llamas?`, cli)), `${cli} / ${precio}`).toBe(true);
      }
      for (const ok of ['Estamos en Av. Pauserna 2055.', 'Estamos en Av. Pauserna 2.055.', 'Nuestra dirección: Pauserna # 2055.']) expect(fallo(sale(`${ok} ¿Cómo te llamas?`, cli)), `${cli} / ${ok}`).toBe(false);
    }
    // «unos 700 pacientes por zona» es una cantidad de personas, no un precio
    expect(fallo(sale('Atendemos unos 700 pacientes por zona. ¿Cómo te llamas?'))).toBe(false);
  });
  it('B (Andres, 24/10): ningún saludo ni texto fijo de Emma menciona «campaña» (la campaña solo se menciona cuando el flujo reconozca su texto de entrada)', () => {
    for (const a of ['prompts/emma.md', 'src/lib/ev.js', 'flujo.plantilla.json', 'rroca-emma.json', 'rroca-emma.prueba.json', ...readdirSync(join(CARPETA, 'src/nodos')).map((f) => `src/nodos/${f}`)]) expect(leer(a), a).not.toMatch(/campa[ñn]a/i);
    expect(leer('prompts/emma.md')).toContain('Hoy tu valoración con la Dra. Emma es **100% gratuita y sin compromiso**');
  });
  it('M-c: evNumeroDePrecio no es cuadrática con salidas de 200 000 caracteres (≤ 100 ms)', () => {
    const lib = runInNewContext(`const EV_PROMPT='';\n${leer('../comun-sin-agente/src/filtro-redaccion.js')}\n${leer('src/lib/ev.js')}\n({ evNumeroDePrecio })`, {}) as { evNumeroDePrecio: (t: string, c: string, d: string) => string };
    for (const t of ['9'.repeat(200000), '1,'.repeat(100000), 'unos ' + '1.000'.repeat(40000), 'unos ' + '1'.repeat(200000) + ' minutos', '1.0001.000'.repeat(20000)]) {
      const ini = Date.now();
      lib.evNumeroDePrecio(t, '¿cuánto cuesta?', 'Av. Pauserna # 2055');
      expect(Date.now() - ini, t.slice(0, 12)).toBeLessThanOrEqual(100);
    }
  });
  it('M-1: el recorte mide la dirección con su texto real: el resultado no pasa de 700 caracteres', () => {
    const dir = 'Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055 (Santa Cruz)';
    const relleno = 'Trabajamos con técnica cuidadosa y productos de calidad para acompañarte en cada paso. ';
    const modelo = `Atendemos en ${dir}. ${relleno.repeat(7)}Radiesse define el contorno y da firmeza. La valoración es gratuita. ¿Cómo te llamas?`;
    const t = sale(modelo, '¿dónde están?');
    expect(fallo(t)).toBe(false);
    expect(t).toContain(dir);
    expect(t.length).toBeLessThanOrEqual(700);
  });
  it('M-3: al quitar «inmediatamente» del comienzo de una oración, la primera letra queda en mayúscula', () => {
    const t = sale('Inmediatamente te cuento cómo funciona la valoración, que es gratuita. ¿Cómo te llamas?');
    expect(t).not.toMatch(/inmediat/i);
    expect(t).toMatch(/^Te cuento/);
  });
  it('M-2: «unos / alrededor de / más o menos / serían + cifra» sobre valoración, tratamiento o zona se rechaza; un horario no', () => {
    for (const m of ['La valoración serían unos 700 en total. ¿Cómo te llamas?', 'Cada sesión ronda alrededor de 900. ¿Cómo te llamas?', 'El tratamiento de la zona sale más o menos 1500. ¿Cómo te llamas?', 'La sesión serían 800 aproximadamente. ¿Cómo te llamas?', 'Por zona, unos 600. ¿Cómo te llamas?']) expect(fallo(sale(m)), m).toBe(true);
    // el número aproximado también se rechaza si el que habla de tratamiento es el CLIENTE, y una palabra de horario en la oración no lo exime
    expect(fallo(sale('Serían unos 900 en total. ¿Cómo te llamas?', '¿y las dos zonas?'))).toBe(true);
    expect(fallo(sale('La sesión dura una hora y serían unos 1.500. ¿Cómo te llamas?'))).toBe(true);
    expect(fallo(sale('La valoración dura unos 100 minutos y atendemos de lunes a viernes. ¿Cómo te llamas?'))).toBe(false);
  });
  it('A2: el texto prellenado del anuncio («…quiero agendar mi valoración gratuita») NO cierra de golpe con el nombre del perfil: el saludo pide nombre y deseo; «Soy Rosa. Quiero agendar» sí cierra', () => {
    const saludo = '¡Hola! 👋 Soy el asistente virtual de la Dra. Emma. Tu valoración es 100% gratuita y sin compromiso. ¿Cómo te llamas y qué te gustaría mejorar?';
    const t = hablar(crear({ modeloDice: dice(saludo) }), ANA, mTexto('Hola Dra. Emma, vi su anuncio de bioestimuladores y quiero agendar mi valoración gratuita 🙌'));
    expect(t.mensajes.every((e) => e.tipo !== 'interactive')).toBe(true);
    expect(textos(t).join(' ')).toContain('¿Cómo te llamas');
    const rosa = hablar(crear({ modeloDice: dice(saludo) }), ANA, mTexto('Soy Rosa. Quiero agendar mi valoración'));
    expect(rosa.mensajes.some((e) => e.tipo === 'interactive')).toBe(true);
    const m = crear({ modeloDice: dice(saludo) });
    hablar(m, ANA, mTexto('hola'));
    expect(hablar(m, ANA, mTexto('Ok, quiero agendar')).mensajes.some((e) => e.tipo === 'interactive')).toBe(true);
  });
  it('la diferencia entre productos recortada a 700 conserva la valoración gratuita (dura) y no pierde los dos productos por una frase de relleno', () => {
    const largo = 'Te cuento que ambos son excelentes bioestimuladores de colágeno, pero actúan de formas distintas en tu piel y por eso conviene entenderlos bien antes de decidir nada. Sculptra® es a base de ácido poli-L-láctico y estimula tu propio colágeno de forma progresiva, mejorando la firmeza y la calidad de la piel. Radiesse® es a base de hidroxiapatita de calcio y define contornos como pómulos, mentón y mandíbula. Es muy común que las personas se pregunten cuál de los dos necesitan y por eso es una duda excelente que muchas pacientes plantean cada semana en la clínica. Además es normal sentir curiosidad por conocer todos los detalles técnicos de cada uno de ellos antes de decidir cualquier cosa sobre tu rostro con tranquilidad. En tu valoración con la Dra. Emma, que es 100% gratuita y sin compromiso, ella evalúa tu rostro y te dice cuál es el indicado. ¿Cómo te llamas?';
    expect(largo.length).toBeGreaterThan(800);
    const t = sale(largo, '¿cuál es la diferencia entre Sculptra y Radiesse?');
    expect(t.length).toBeLessThanOrEqual(700);
    expect(t).toContain('100% gratuita');
    expect(t).toMatch(/Sculptra/);
    expect(t.endsWith('¿Cómo te llamas?')).toBe(true);
  });
  it('el prompt: brevedad, nada de inmediatez, tuteo en el rol, sin «muy noble… retomar tus actividades rápido» y el Caso B se presenta como asistente virtual', () => {
    const p = leer('prompts/emma.md');
    expect(p).toContain('BREVEDAD');
    expect(p).toMatch(/nunca escribas «inmediato», «de inmediato»/);
    expect(p).toContain('orientarte sobre los tratamientos faciales y en ayudarte a pasar con la recepción para agendar tu valoración gratuita');
    expect(p).not.toMatch(/muy noble|retomar tus actividades r[aá]pido|orientarle/);
    expect((p.match(/presentándote como el asistente virtual/g) ?? []).length).toBe(3);
  });
});

describe('REGRESIÓN con las respuestas REALES del modelo de la batería de Emma (24/10/2026, n=1)', () => {
  const ruta = join(dirname(fileURLToPath(import.meta.url)), 'respuestas-reales.json');
  it('el replay gratuito de los casos que fallaron: las barreras duras al 100 % y ninguna respuesta rechazada por una barrera de código', async () => {
    const sal: string[] = []; const err: string[] = [];
    const codigo = await main(['--respuestas', ruta, '--casos', 'A2,A3,B1,B2,B3,C3,C5,D1,D3,D3b,E6,E8,E9,G16', '--n', '1', '--motivo'], { salida: (t: string) => sal.push(t), error: (t: string) => err.push(t) });
    const informe = sal.join('');
    expect(codigo, informe).toBe(0);
    expect(informe).toMatch(/Barreras duras: (\d+)\/\1 /);
    expect(informe).toMatch(/rechazadas por una barrera de código: ninguna/);
  });
});
