/**
 * RESCATE DE 22 H — LA LIBRERÍA (`Flujos/experimental/rescate-22h/src/rescate.js`).
 *
 * Lo que esta suite niega: que el cuerpo que redacta el modelo salga si no pasa TODAS las revisiones del código (no es FIJO, largo de 20 a 240,
 * sin dígitos, UNA pregunta, sin saludo propio, sin temas de cobro ni de tiempo, sin enlaces, sin promesas, sin afirmar un hecho ni negar ser una IA);
 * que un texto fijo o un saludo inválidos se acepten; que el modelo reciba más de 6 textos, ángulos o caracteres de control; y que el texto final
 * salga sin el saludo que dice «asistente virtual» (prohibición 4) o con el saludo repetido.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const RESCATE = join(aqui, '../../Flujos/experimental/rescate-22h');
const FILTRO = join(aqui, '../../Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js');

interface Cfg { rescateQuien: string; rescateContexto: string; rescateSaludo: string; rescateTextoFijo: string; quienPromete: string }
interface Lib {
  RS_CORTE_MS: number;
  rsDigitos(v: unknown): string;
  rsLista(v: unknown): string[];
  rsModeloValido(v: unknown): string;
  rsLimpio(t: unknown): string;
  rsHistorialSuficiente(t: unknown): boolean;
  rsCuerpoModelo(cfg: Cfg, textos: string[]): { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[]; generationConfig: Record<string, number> };
  rsTextoDeGemini(j: unknown): string;
  rsRevisarCuerpo(crudo: unknown, cfg: Partial<Cfg>): { texto: string; motivo: string };
  rsTextoFijoValido(t: unknown): boolean;
  rsSaludoValido(s: unknown): boolean;
  rsElegirTexto(cfg: Cfg, base: { suficiente: boolean }, crudo: string): { texto: string; origen: string; motivo: string };
}

function cargar(): Lib {
  const codigo = `${readFileSync(FILTRO, 'utf8')}\n${readFileSync(join(RESCATE, 'src/rescate.js'), 'utf8')}\n`
    + 'return { RS_CORTE_MS, rsDigitos, rsLista, rsModeloValido, rsLimpio, rsHistorialSuficiente, rsCuerpoModelo, rsTextoDeGemini, rsRevisarCuerpo, rsTextoFijoValido, rsSaludoValido, rsElegirTexto };';
  // Excepción deliberada a `devsecops.js-eval-prohibido`: se ejecutan dos archivos NUESTROS y versionados (el cuerpo de un nodo Code de n8n no es un
  // módulo importable) dentro de una prueba que no corre en ningún servidor; es el código que corre de verdad en n8n, no una copia suya.
  // nosemgrep: devsecops.js-eval-prohibido
  return new Function(codigo)() as Lib;
}
const L = cargar();

const CFG: Cfg = {
  rescateQuien: 'Rubén',
  rescateContexto: 'Rubén es autor de un libro digital para emprendedores.',
  rescateSaludo: 'Hola, soy el asistente virtual de Rubén.',
  rescateTextoFijo: 'Hola, soy el asistente virtual de Rubén. Quedó pendiente tu consulta sobre el libro. ¿Te quedó alguna duda para empezar?',
  quienPromete: 'ruben',
};
const BUENO = 'Vi que tienes una tienda de ropa y quieres ordenar tus ventas. ¿Te quedó alguna duda para empezar?';

describe('rsRevisarCuerpo: el cuerpo del modelo no sale si falla CUALQUIER revisión', () => {
  const malos: [string, string, string?][] = [
    ['FIJO', 'FIJO', 'fijo'],
    ['«fijo.» con comillas', '"fijo."', 'fijo'],
    ['un monto con dígitos', 'Con 60 Bs empiezas hoy mismo con tu negocio, ¿te animas a hacerlo?', 'digitos'],
    ['un enlace con www.', 'Mira www.ejemplo.com para más detalles de tu negocio, ¿te quedó alguna duda?'],
    ['dos preguntas', 'Vi que tienes una tienda. ¿Qué vendes? ¿Te quedó alguna duda para empezar?', 'pregunta'],
    ['ninguna pregunta', 'Vi que tienes una tienda de ropa y quieres ordenar tus ventas con calma.', 'pregunta'],
    ['la pregunta no cierra el texto', 'Vi que tienes una tienda de ropa. ¿Te quedó alguna duda? Cuéntame más', 'pregunta'],
    ['«acreditado»', 'Tu pago fue acreditado, ¿todo bien con tu negocio de ropa?'],
    ['«soy una persona»', 'Soy una persona real y quiero ayudarte con tu tienda, ¿tienes alguna duda?'],
    ['«ayer»', 'Ayer me contaste de tu negocio de ropa, ¿te quedó alguna duda para empezar?', 'tema_prohibido'],
    ['«QR»', 'Recuerda que tu negocio puede usar un QR sin problema, ¿tienes alguna duda?', 'tema_prohibido'],
    ['una promesa de Rubén', 'Rubén te escribirá pronto para ayudarte con tu tienda, ¿te quedó alguna duda?'],
    ['un saludo propio', 'Hola, vi que tienes una tienda de ropa y quieres crecer, ¿te quedó alguna duda?', 'saludo'],
    ['un texto vacío', '', 'largo'],
    ['un texto de 241 caracteres', `${'a'.repeat(200)} ${'b'.repeat(39)}?`, 'largo'],
  ];
  for (const [nombre, texto, motivo] of malos) {
    it(`rechaza ${nombre}`, () => {
      const r = L.rsRevisarCuerpo(texto, CFG);
      expect(r.motivo, JSON.stringify(r)).not.toBe('');
      expect(r.texto).toBe('');
      if (motivo) expect(r.motivo).toBe(motivo);
    });
  }

  it('acepta un cuerpo correcto, también envuelto en comillas', () => {
    expect(L.rsRevisarCuerpo(BUENO, CFG)).toEqual({ texto: BUENO, motivo: '' });
    expect(L.rsRevisarCuerpo(`"${BUENO}"`, CFG).motivo).toBe('');
    expect(L.rsRevisarCuerpo(`«${BUENO}»`, CFG).motivo).toBe('');
  });
});

// Las frases que la revisión de seguridad citó como malas (plurales, formas verbales, sinónimos bolivianos, identidad, promesas, enlaces en palabras): todas
// salen con el texto fijo. Cada una lleva una sola pregunta al final para llegar a la revisión del tema y no caer antes en «pregunta».
const PREGUNTA = '¿Te quedó alguna duda sobre el libro?';
describe('rsRevisarCuerpo: las formas que la lista de palabras exactas dejaba pasar', () => {
  const frases = [
    'Recibimos tus pagos.', 'Ya nos llegaron tus comprobantes.', 'Tus pagos están en orden.', 'Ya tenemos tu plata.', 'Ya cancelaste el libro.', 'Tu cobro quedó pendiente.',
    'Puedes abonar en efectivo o con tarjeta.', 'Aceptamos pagos por Tigo Money o Yape.', 'Te cuento sobre los precios.', 'Mira los comprobantes y enlaces.', 'Mira las ofertas.',
    'Hablemos de los bancos.', 'Puedes pagarlo cuando quieras.', 'Sigues pagando por partes.', 'Te mando los QRs.', 'Te paso los links.', 'Visita las paginas del libro.', 'Tus cuentas están listas.',
    'Hay descuentos para ti.', 'Es gratuito para ti.', 'Hay una garantía de devolución.', 'Entra al sitio del libro.', 'Mira el depósito y la transferencia.',
    // identidad (prohibición 4)
    'Soy Rubén, no un asistente.', 'Soy Rubén en persona.', 'Quien te escribe es Rubén.', 'Aquí no responde ningún robot.', 'Te atiendo directamente.', 'Habla con Rubén sin intermediarios.', 'Te respondo yo mismo.',
    // promesas, plazos, enlaces en palabras, plataformas
    'Te regalo un bono.', 'Esta noche te cuento más.', 'Luego te cuento más.', 'Pronto tendrás novedades.', 'Búscame en Instagram.', 'Escríbeme por WhatsApp.', 'Entra a hotmart punto com.',
    'Mi correo es ruben arroba gmail.', 'Tu clave está lista.', 'Te escribiré con más detalles.', 'Te contactaré en breve.', 'Un asesor te ayudará con el libro.', 'Te busco en un rato.', 'Seguro que te sirve.',
    // el tema partido con separadores, y letras de otro alfabeto o invisibles
    'Tu p-a-g-o sigue pendiente.', 'Tu p.a.g.o sigue pendiente.', 'Tu pаgo sigue pendiente.', 'Tu pa\u200bgo sigue pendiente.',
    'Cuéntame de tu негocio.',
  ];
  for (const f of frases) {
    it(`rechaza «${f}»`, () => {
      const r = L.rsRevisarCuerpo(`${f} ${PREGUNTA}`, CFG);
      expect(r.motivo, JSON.stringify(r)).not.toBe('');
      expect(r.texto).toBe('');
      const e = L.rsElegirTexto(CFG, { suficiente: true }, `${f} ${PREGUNTA}`);
      expect(e.origen).toBe('fijo');
      expect(e.texto).toBe(CFG.rescateTextoFijo);
    });
  }
  it('el alfabeto: el cirílico y las letras de ancho cero se rechazan por el alfabeto, no por casualidad', () => {
    expect(L.rsRevisarCuerpo('Vi que tu tienda de ropa necesita orden. ¿Te quedó alguna duda para emp\u0435zar?', CFG).motivo).toBe('alfabeto');
    expect(L.rsRevisarCuerpo('Vi que tu tienda de ropa necesita orden. ¿Te quedó alguna duda para empezar?\u200b', CFG).motivo).not.toBe('');
  });
  it('más de dos oraciones se rechaza', () => {
    expect(L.rsRevisarCuerpo('Vi que tienes una tienda. Quieres ordenar tus ventas. Y crecer con calma. ¿Te quedó alguna duda?', CFG).motivo).toBe('oraciones');
  });
  it('un saludo o una presentación repetida después del pulido se rechazan', () => {
    expect(L.rsRevisarCuerpo('Como asistente virtual vi que tienes una tienda de ropa. ¿Te quedó alguna duda?', CFG).motivo).not.toBe('');
  });
  const legitimas = [
    BUENO,
    'Me contaste que vendes comida y te cuesta llevar el orden. ¿Te quedó alguna duda?',
    'Mencionaste que tu peluquería tiene muchos clientes y poco tiempo. ¿Qué parte te gustaría resolver primero?',
    'Vi que quieres aprender inteligencia artificial para tu negocio de ropa. ¿Te quedó alguna duda para empezar?',
  ];
  for (const t of legitimas) {
    it(`sigue aceptando «${t.slice(0, 50)}…»`, () => expect(L.rsRevisarCuerpo(t, CFG)).toEqual({ texto: t, motivo: '' }));
  }
});

describe('rsTextoFijoValido y rsSaludoValido: también con raíces, «junto» y alfabeto', () => {
  const base = 'Hola, soy el asistente virtual de Rubén.';
  for (const frase of ['Tus pagos están en orden.', 'Ya cancelaste el libro.', 'Mira las ofertas.', 'Tu p-a-g-o sigue pendiente.', 'Tu pаgo sigue pendiente.', 'Búscame en Instagram.', 'Te contactaré en breve.']) {
    it(`el texto fijo con «${frase}» se rechaza`, () => expect(L.rsTextoFijoValido(`${base} ${frase} ¿Te quedó alguna duda?`)).toBe(false));
  }
  it('el texto fijo vigente de Rubén sigue siendo válido', () => {
    expect(L.rsTextoFijoValido('Hola, soy el asistente virtual de Rubén. Quedó pendiente tu consulta sobre «IA para Emprendedores». ¿Te quedó alguna duda para empezar?')).toBe(true);
  });
  it('un saludo con letras de otro alfabeto se rechaza', () => expect(L.rsSaludoValido('Hola, soy el asistеnte virtual de Rubén.')).toBe(false));
});

describe('rsElegirTexto: el saludo fijo va delante, una sola vez, y todo cae en el texto fijo', () => {
  it('con un cuerpo válido, el texto final empieza con el saludo y lo contiene una sola vez', () => {
    const e = L.rsElegirTexto(CFG, { suficiente: true }, BUENO);
    expect(e.origen).toBe('modelo');
    expect(e.texto.startsWith(`${CFG.rescateSaludo} `)).toBe(true);
    expect(e.texto.split(CFG.rescateSaludo).length - 1).toBe(1);
    expect(e.texto).toContain('asistente virtual');
  });

  it('un historial insuficiente sale con el texto fijo, aunque el modelo haya redactado algo válido', () => {
    expect(L.rsElegirTexto(CFG, { suficiente: false }, BUENO)).toEqual({ texto: CFG.rescateTextoFijo, origen: 'fijo', motivo: 'historial' });
  });

  it('cada cuerpo malo, la respuesta vacía y FIJO salen con el texto fijo', () => {
    for (const crudo of ['', 'FIJO', '60 Bs', 'Con tu pago acreditado, ¿todo bien con tu tienda de ropa?']) {
      const e = L.rsElegirTexto(CFG, { suficiente: true }, crudo);
      expect(e.texto, crudo).toBe(CFG.rescateTextoFijo);
      expect(e.origen).toBe('fijo');
    }
  });

  it('si el texto final pasa de 400 caracteres, sale el texto fijo', () => {
    const e = L.rsElegirTexto({ ...CFG, rescateSaludo: `Hola, soy el asistente virtual de Rubén. ${'x'.repeat(40)}` }, { suficiente: true }, BUENO);
    expect(e.origen).toBe('fijo');
    const largo = 'Vi que tienes una tienda de ropa y quieres ordenar tus ventas con tranquilidad. '.repeat(2).trim();
    const f = L.rsElegirTexto({ ...CFG, rescateSaludo: `Hola, soy el asistente virtual de Rubén. ${'y'.repeat(37)}` }, { suficiente: true }, `${largo.slice(0, 150)} ¿Te quedó alguna duda?`);
    expect(f.texto.length).toBeLessThanOrEqual(400);
  });

  it('un texto fijo inválido en ejecución NO se envía (origen «ninguno», sin texto)', () => {
    const roto = { ...CFG, rescateTextoFijo: 'Quedó pendiente tu consulta, sin presentarse' };
    expect(L.rsElegirTexto(roto, { suficiente: false }, '')).toEqual({ texto: '', origen: 'ninguno', motivo: 'texto_fijo_invalido' });
  });
});

describe('rsTextoFijoValido y rsSaludoValido: los casos negativos', () => {
  it('el texto fijo válido pasa y admite palabras de tiempo', () => {
    expect(L.rsTextoFijoValido(CFG.rescateTextoFijo)).toBe(true);
    expect(L.rsTextoFijoValido('Hola, soy el asistente virtual de Rubén. Ayer quedó pendiente tu consulta. ¿Te quedó alguna duda para empezar?')).toBe(true);
  });
  const malos: [string, unknown][] = [
    ['sin signo de pregunta', 'Hola, soy el asistente virtual de Rubén. Quedó pendiente tu consulta sobre el libro.'],
    ['sin «asistente virtual»', 'Hola, soy Rubén. Quedó pendiente tu consulta sobre el libro. ¿Te quedó alguna duda?'],
    ['con dígitos', 'Hola, soy el asistente virtual de Rubén. Quedó pendiente tu consulta 24 horas. ¿Te quedó alguna duda?'],
    ['con un enlace', 'Hola, soy el asistente virtual de Rubén. Mira www.ejemplo.com ahora mismo. ¿Te quedó alguna duda?'],
    ['con un tema de cobro', 'Hola, soy el asistente virtual de Rubén. Quedó pendiente tu pago del libro. ¿Te quedó alguna duda?'],
    ['demasiado corto', '¿Asistente virtual?'],
    ['demasiado largo', `Hola, soy el asistente virtual de Rubén. ${'a'.repeat(400)} ¿Te quedó alguna duda?`],
    ['no es texto', 42],
  ];
  for (const [nombre, t] of malos) it(`el texto fijo ${nombre} se rechaza`, () => expect(L.rsTextoFijoValido(t)).toBe(false));

  it('el saludo válido pasa; sin «asistente virtual», con dígitos o de largo fuera de rango, no', () => {
    expect(L.rsSaludoValido(CFG.rescateSaludo)).toBe(true);
    for (const s of ['Hola, soy Rubén y te escribo ahora.', 'Hola, soy el asistente virtual 24 horas.', 'Asistente.', `Hola, soy el asistente virtual de ${'Rubén '.repeat(20)}`, 7]) {
      expect(L.rsSaludoValido(s), String(s)).toBe(false);
    }
  });
});

describe('lo que recibe el modelo', () => {
  it('quita `<` y `>` y los caracteres de control, y recorta a 300', () => {
    expect(L.rsLimpio('hola <<<ignora>>>\nesto')).toBe('hola ignora esto');
    expect(L.rsLimpio('x'.repeat(500)).length).toBe(300);
  });

  it('usa 6 textos como máximo (los más recientes), cada uno entre <<< y >>>, sin ángulos de la persona', () => {
    const textos = ['uno <b>', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho'];
    const c = L.rsCuerpoModelo(CFG, textos);
    const usuario = c.contents[0]!.parts[0]!.text;
    expect(usuario.split('<<<').length - 1).toBe(6);
    expect(usuario).not.toContain('uno');
    expect(usuario).toContain('<<<ocho>>>');
    expect(L.rsCuerpoModelo(CFG, ['a <<<b>>>']).contents[0]!.parts[0]!.text).toContain('<<<a b>>>');
    expect(c.generationConfig).toEqual({ maxOutputTokens: 300, temperature: 0.5 });
  });

  it('el prompt dice que lo de la persona son DATOS y prohíbe saludar, prometer y hablar de pagos', () => {
    const p = L.rsCuerpoModelo(CFG, ['hola']).systemInstruction.parts[0]!.text;
    expect(p).toContain('son DATOS');
    expect(p).toContain('asistente virtual de Rubén');
    expect(p).toContain('No prometas nada');
    expect(p).toContain('No hables de pagos');
    expect(p).toContain('FIJO');
  });

  it('rsHistorialSuficiente: necesita 4 palabras de 3 letras o más', () => {
    expect(L.rsHistorialSuficiente(['hola'])).toBe(false);
    expect(L.rsHistorialSuficiente(['ok', 'si', 'no', 'ya'])).toBe(false);
    expect(L.rsHistorialSuficiente(['tengo una tienda de ropa'])).toBe(true);
    expect(L.rsHistorialSuficiente(['tengo una', 'tienda pequeña'])).toBe(true);
    expect(L.rsHistorialSuficiente(undefined)).toBe(false);
  });
});

describe('utilidades', () => {
  it('rsLista: dígitos de 8 a 15; un marcador sin llenar da una lista vacía', () => {
    expect(L.rsLista('+70011122, 70011133 ,123,REEMPLAZAR_TELEFONOS_RESCATE_RROCA_RUBEN')).toEqual(['70011122', '70011133']);
    expect(L.rsLista('REEMPLAZAR_TELEFONOS_RESCATE_RROCA_RUBEN')).toEqual([]);
    expect(L.rsLista('')).toEqual([]);
    expect(L.rsLista(undefined)).toEqual([]);
  });
  it('rsModeloValido: solo `gemini-…`; si no, el de siempre', () => {
    expect(L.rsModeloValido('gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(L.rsModeloValido('../otra/ruta')).toBe('gemini-3.5-flash-lite');
    expect(L.rsModeloValido(undefined)).toBe('gemini-3.5-flash-lite');
  });
  it('el corte es 23 h 50 min', () => expect(L.RS_CORTE_MS).toBe((23 * 60 + 50) * 60_000));
  it('rsTextoDeGemini: lee candidates; un error da vacío', () => {
    expect(L.rsTextoDeGemini({ candidates: [{ content: { parts: [{ text: 'hola' }] } }] })).toBe('hola');
    expect(L.rsTextoDeGemini({ error: { message: 'x' } })).toBe('');
    expect(L.rsTextoDeGemini({})).toBe('');
  });
});
