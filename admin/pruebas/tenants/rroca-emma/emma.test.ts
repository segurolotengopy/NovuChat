/**
 * LO PROPIO DE EMMA frente al flujo de Evy del que sale (24/10/2026): sin ancla de monto (el asistente de Emma NUNCA menciona una cifra de dinero), valoración gratuita y sin pago de reserva, Sculptra® y Radiesse®,
 * dos imágenes activas (bata = autoridad y antes y después; la comparativa no existe), Caso B con las tres capturas de Emma (la lista cerrada de visión es de Emma, no la de Evy), horario de turno partido que sale
 * de la Consola, dirección con «2do y 3er anillo» que no se confunde con un rango de precio, nada de Evy en ningún archivo, y Emma NO agenda.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      for (const x of ['Evy', 'Karina', 'DentalCor', 'HArmonyCa', 'Sapocó', 'Piraí', 'blazer', 'rroca-evy']) expect(t, `${a}: ${x}`).not.toContain(x);
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
  it('la dirección con «entre 2do y 3er anillo» NO se confunde con un rango de precio: el modelo puede dársela al cliente (con los ordinales en palabras)', () => {
    for (const modelo of ['Atendemos en Emma Spa Medic, ubicada en Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055 (Santa Cruz).', 'Estamos en Emma Spa Medic: Canal Cotoca entre 2do y 3er anillo, Av. Pauserna # 2055.']) {
      const t = sale(modelo, '¿dónde están?');
      expect(fallo(t), modelo).toBe(false);
      expect(t).toContain('entre segundo y tercer anillo');
      expect(t).toContain('2055');
    }
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
  it('«efecto lifting» sin «desde la primera sesión»; nada de «inmediato»', () => {
    expect(p).not.toMatch(/primera sesi[oó]n|inmediat/i);
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
