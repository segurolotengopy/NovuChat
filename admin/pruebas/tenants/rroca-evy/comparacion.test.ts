/**
 * LA COMPARACIÓN FIJA «Radiesse® o HArmonyCa®» y la UBICACIÓN en el cierre (Andres, 25/10/2026). Mundo simulado: el modelo es un doble, sin red ni clave. El enlace de Maps de estas pruebas es SINTÉTICO.
 *  1. La pregunta «¿cuál es mejor?» / «¿qué diferencia hay?» / «¿cuál me conviene?» / «Radiesse o HArmonyCa» la contesta un TEXTO FIJO por código (solo con `usarMarcas`), sin pasar por el modelo ni por el recorte de 700.
 *  2. La ubicación («📍 Ubicación: <enlace>») se agrega al cierre COMPLETO solo si el paciente ya vio la comparación y la Consola trae un `direccionMaps` válido; si no, el cierre queda exactamente como siempre.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, CARPETA, CARPETA_DE_DATOS, IDS, avisosARecepcion, crear, dice, hablar, imagenes, mTexto, panelOk, textos } from './mundo';

const MAPS = 'https://maps.app.goo.gl/PruebaSintetica1';
const conMaps = (valor: unknown) => { const p = panelOk(); (p.body['datosDelNegocio'] as J)['direccionMaps'] = valor; return p; };
const esBoton = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((e) => e.tipo === 'interactive');

const SIN_NOMBRE = [
  'Buena pregunta. Los dos son bioestimuladores que activan tu propio colágeno, con un resultado natural y sin cirugía. Ninguno es “mejor”: cada uno se indica según lo que necesita tu rostro.',
  '✨ Radiesse®: hidroxiapatita de calcio. Define el contorno de pómulos, mentón y mandíbula, y estimula colágeno y elastina, por eso tu piel va ganando firmeza de forma progresiva. Suele indicarse para firmeza y prevención.',
  '✨ HArmonyCa®: combina ácido hialurónico e hidroxiapatita de calcio. El ácido hialurónico da un efecto lifting desde la aplicación y la hidroxiapatita sigue estimulando tu colágeno con el tiempo. Suele indicarse para flacidez más marcada.',
  'La Dra. Evy analiza tu rostro en la valoración gratuita y te dice cuál es el ideal para ti. ¿Te ayudo a agendarla?',
].join('\n\n');
const PREGUNTAS = ['¿Cuál es mejor, Radiesse o HArmonyCa?', '¿Qué diferencia hay entre Radiesse y HArmonyCa?', 'Radiesse o HArmonyCa', '¿Cuál de los dos me conviene? Radiesse o HArmonyCa'];
/** El modelo: contesta la etiqueta de derivar cuando el cliente acepta, y algo corto en los demás turnos. */
const MODELO = (ll: { cuerpo?: Record<string, unknown> }): string => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? '[DERIVAR_RECEPCION]' : 'Cuéntame, ¿qué te gustaría mejorar en tu rostro?');

describe('la comparación fija', () => {
  it('sin nombre dado el arranque es «Buena pregunta.» (nunca el nombre del perfil) y el texto es el de Andres, tal cual', () => {
    for (const p of PREGUNTAS) {
      const t = hablar(crear({ modeloDice: 'NO DEBE SALIR' }), ANA, mTexto(p), { nombre: 'Ana Pérez' });
      expect(textos(t), p).toEqual([SIN_NOMBRE]);
    }
    expect(SIN_NOMBRE.length).toBeLessThan(1024);
  });
  it('con el nombre que el paciente dio, el arranque es «Buena pregunta, Nombre.»', () => {
    const m = crear({ modeloDice: MODELO });
    hablar(m, ANA, mTexto('Hola, soy Rosa'));
    const t = hablar(m, ANA, mTexto('¿Qué diferencia hay entre Radiesse y HArmonyCa?'));
    expect(textos(t)[0]).toBe(SIN_NOMBRE.replace('Buena pregunta.', 'Buena pregunta, Rosa.'));
  });
  it('no pasa por el modelo: no lo llama, ni siquiera cuando el modelo está caído', () => {
    const t = hablar(crear({ modeloDice: 'cae' }), ANA, mTexto(PREGUNTAS[0]!));
    expect(textos(t)).toEqual([SIN_NOMBRE]);
  });
  it('sin usarMarcas no hay comparación fija: contesta el modelo', () => {
    const t = hablar(crear({ modeloDice: dice('Con gusto te cuento más. ¿Cómo te llamas?'), base: { usarMarcas: '' } }), ANA, mTexto(PREGUNTAS[0]!));
    expect(textos(t)[0]).toContain('Con gusto te cuento');
    expect(textos(t)[0]).not.toContain('Ninguno es');
  });
  it('NEGADAS: sin nombrar un producto (ni en el mensaje ni en lo último que dijo el asistente), o con pregunta de precio, no dispara', () => {
    for (const p of ['¿Cuál me conviene?', '¿Qué diferencia hay entre el botox y el relleno?', '¿Cuánto cuesta la diferencia entre Radiesse y HArmonyCa?', 'Hola, vi su anuncio']) {
      const t = hablar(crear({ modeloDice: dice('Respuesta del modelo.') }), ANA, mTexto(p));
      expect(textos(t).join(' '), p).not.toContain('Ninguno es');
    }
  });
  it('NEGADAS (revisión): salud, seguridad, otro tratamiento, duración, precio extendido y un solo producto sin comparativo explícito no disparan; contesta el modelo', () => {
    for (const p of ['Tomo anticoagulantes, ¿cuál me conviene, Radiesse o HArmonyCa?', 'Estoy embarazada, ¿qué es mejor Radiesse o HArmonyCa?', 'Tengo diabetes, ¿me conviene Radiesse?', '¿Es seguro Radiesse o HArmonyCa?',
      '¿Radiesse es diferente al botox?', 'Radiesse vs ácido hialurónico', 'No quiero Radiesse, ¿qué diferencia tiene con el botox?', '¿Cuál dura más, Radiesse o HArmonyCa?',
      'Radiesse o HArmonyCa, cuantos bs', '¿Cuál es más caro, Radiesse o HArmonyCa?', '¿Qué diferencia tiene Radiesse?']) {
      const t = hablar(crear({ modeloDice: dice('Respuesta del modelo.') }), ANA, mTexto(p));
      expect(textos(t).join(' '), p).not.toContain('Ninguno es');
    }
  });
  it('un pedido explícito de agendar que ya puede cerrar gana: sale el cierre, no la comparación', () => {
    for (const p of ['Quiero agendar mi valoración. ¿Cuál me conviene, Radiesse o HArmonyCa?', 'Sí, quiero agendar. Pero ¿qué diferencia hay entre Radiesse y HArmonyCa?']) {
      const m = crear({ modeloDice: dice('Perfecto.') });
      hablar(m, ANA, mTexto('hola'));
      const t = hablar(m, ANA, mTexto(p));
      expect(esBoton(t), p).toBe(true);
      expect(textos(t)[0], p).toMatch(/Excelente decisión/);
      expect(textos(t).join(' '), p).not.toContain('Ninguno es');
    }
  });
  it('la imagen comparativa sale como hoy: una vez, antes del texto; la segunda vez solo el texto', () => {
    const m = crear({ modeloDice: 'x' });
    const t1 = hablar(m, ANA, mTexto(PREGUNTAS[0]!));
    expect(imagenes(t1)).toEqual([IDS.comparativo]);
    expect(textos(t1)).toEqual([SIN_NOMBRE]);
    expect(imagenes(hablar(m, ANA, mTexto(PREGUNTAS[1]!)))).toEqual([]);
    // sin usarMarcas la imagen no sale (ni el texto fijo)
    expect(imagenes(hablar(crear({ modeloDice: 'x', base: { usarMarcas: '' } }), ANA, mTexto(PREGUNTAS[0]!)))).toEqual([]);
  });
  it('es respuesta de texto fijo: sin botón, sin aviso a recepción, sin cifras de dinero ni promesas, y «mejor» solo en la frase fija', () => {
    const t = hablar(crear({ modeloDice: 'x' }), ANA, mTexto(PREGUNTAS[0]!));
    expect(esBoton(t)).toBe(false);
    expect(avisosARecepcion(t).length).toBe(0);
    const c = textos(t)[0]!;
    expect(c).not.toMatch(/\b\d|\bBs\b|\$|garantiz|asegur|promet|resultado (id|ex|ig|per)/i);
    expect(c.replace('Ninguno es “mejor”', '')).not.toMatch(/mejor\b/i);
    expect(c).toContain('Ninguno es “mejor”');
  });
  it('queda en el historial como lo dicho por el asistente: la oferta «¿Te ayudo a agendarla?» se reconoce y el «sí» deriva', () => {
    const m = crear({ modeloDice: MODELO });
    hablar(m, ANA, mTexto(PREGUNTAS[0]!));
    const t = hablar(m, ANA, mTexto('sí'));
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]).toMatch(/Excelente decisión/);
    expect(avisosARecepcion(t).length).toBe(1);
  });
});

describe('la ubicación en el cierre', () => {
  const cierreTras = (panel: ReturnType<typeof panelOk> | 'cae' | undefined, comparar: boolean) => {
    const m = crear({ modeloDice: MODELO, panel });
    if (comparar) hablar(m, ANA, mTexto(PREGUNTAS[0]!)); else hablar(m, ANA, mTexto('Cuéntame del Radiesse'));
    return { m, t: hablar(m, ANA, mTexto('sí')) };
  };
  it('tras la comparación y el «sí», el cierre lleva «📍 Ubicación: <enlace>» antes de la línea del botón, con el botón y el aviso de siempre', () => {
    const { t } = cierreTras(conMaps(MAPS), true);
    const c = textos(t)[0]!;
    expect(esBoton(t)).toBe(true);
    expect(c).toContain(`📍 Ubicación: ${MAPS}`);
    const partes = c.split('\n\n');
    expect(partes[partes.length - 1]).toMatch(/^Para elegir el día y horario/);
    expect(partes[partes.length - 2]).toBe(`📍 Ubicación: ${MAPS}`);
    expect(c.length).toBeLessThanOrEqual(1024);
    expect(avisosARecepcion(t).length).toBe(1);
  });
  it('el cierre con Maps es el de siempre MÁS esa línea (idéntico quitándola) y el aviso a recepción es el mismo', () => {
    const con = cierreTras(conMaps(MAPS), true).t;
    const sin = cierreTras(undefined, true).t;
    expect(textos(con)[0]!.replace(`📍 Ubicación: ${MAPS}\n\n`, '')).toBe(textos(sin)[0]);
    expect(avisosARecepcion(con).map((a) => [a.tipo, a.cuerpo])).toEqual(avisosARecepcion(sin).map((a) => [a.tipo, a.cuerpo]));
  });
  it('sin haber visto la comparación el cierre queda como hoy (sin Maps), aunque la Consola traiga el enlace', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('<<<sí>>>') ? '[DERIVAR_RECEPCION]' : 'Te cuento del Radiesse. ¿Te gustaría agendar tu valoración?'), panel: conMaps(MAPS) });
    hablar(m, ANA, mTexto('Cuéntame del Radiesse'));
    const t = hablar(m, ANA, mTexto('sí'));
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]).not.toContain('📍');
  });
  it('NEGADAS: direccionMaps vacía, inválida, http, de otro dominio, con espacios, larga o con letras raras: no sale ninguna línea', () => {
    const malas: unknown[] = ['', undefined, null, 42, 'http://maps.app.goo.gl/PruebaSintetica1', 'https://evil.example/maps/abc', 'https://maps.app.goo.gl.evil.example/x', 'https://www.google.com.evil.example/maps',
      'https://maps.app.goo.gl/Prueba Sintetica', 'https://maps.app.goo.gl/' + 'a'.repeat(300), 'https://maps.app.goo.gl/<script>', 'javascript:alert(1)', 'wa.me/123', 'https://maps.app.goo.gl/x\nhttps://evil.example'];
    for (const mala of malas) {
      const t = cierreTras(conMaps(mala), true).t;
      expect(esBoton(t), String(mala)).toBe(true);
      expect(textos(t)[0], String(mala)).not.toContain('📍');
      expect(textos(t)[0], String(mala)).not.toMatch(/https?:|evil|goo\.gl/i);
    }
  });
  it('la Consola caída: sin Maps y el cierre sigue saliendo', () => {
    const t = cierreTras('cae', true).t;
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]).not.toContain('📍');
  });
  it('una vez mostrado, no se repite: el cierre corto (derivar_corto) no lleva Maps', () => {
    const { m } = cierreTras(conMaps(MAPS), true);
    const otra = hablar(m, ANA, mTexto('quiero agendar de nuevo'));
    expect(esBoton(otra)).toBe(true);
    expect(textos(otra)[0]).not.toContain('📍');
  });
  it('si el cierre completo ya había salido antes de la comparación, el «sí» posterior es el cierre corto y sin Maps', () => {
    const m = crear({ modeloDice: MODELO, panel: conMaps(MAPS) });
    hablar(m, ANA, mTexto('Quiero agendar, soy Rosa'));
    hablar(m, ANA, mTexto(PREGUNTAS[0]!));
    const t = hablar(m, ANA, mTexto('sí'));
    expect(textos(t)[0]).not.toContain('📍');
  });
  it('D5: ni los datos versionados, ni el prompt, ni los dos JSON, ni el código llevan un enlace de Maps', () => {
    for (const ruta of [join(CARPETA_DE_DATOS, 'rroca-evy.json'), join(CARPETA_DE_DATOS, 'negocio-rroca-evy.json'), join(CARPETA, 'prompts/evy.md'), join(CARPETA, 'rroca-evy.json'), join(CARPETA, 'rroca-evy.prueba.json')]) {
      const t = readFileSync(ruta, 'utf8');
      expect(t, ruta).not.toMatch(/maps\.app\.goo\.gl\/[A-Za-z0-9]|"direccionMaps"\s*:\s*"https/i);
    }
  });
});
