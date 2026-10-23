/**
 * BASE COMÚN DE LAS VENTAS DIGITALES (`Flujos/experimental/venta-digital/`).
 *
 * Tres garantías:
 *  1. Las copias de la primera venta digital (`cobro.js`, `avisos.js`) son exactamente «su cabecera + el cuerpo común».
 *  2. La carpeta común no tiene nombres de cliente ni montos: todo eso entra por parámetro.
 *  3. Las funciones `vd*` son puras y se prueban NEGANDO (lo que no debe pasar, no pasa).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental');
const COMUN = join(RAIZ, 'venta-digital');
const COPIAS = join(RAIZ, 'rroca-ruben/src/lib');
const leer = (ruta: string): string => readFileSync(ruta, 'utf8');

type F = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const EXPORTADOS = [
  'vdFichaCharla', 'vdHabilitado', 'vdCuentaComoCharla', 'vdLineaModo', 'vdSinPreguntaFinal', 'vdQuitarPromesaDeOpciones', 'vdPrometeOpciones', 'vdEtiquetaConPrecio',
  'vdAhorro', 'vdTextoPuente', 'vdPrecioPedido', 'vdHashTexto', 'vdNorm', 'vdOraciones', 'VD_MODOS',
];
// El código evaluado es el de los archivos del propio repositorio, no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
const VD = new Function(leer(join(COMUN, 'src/cobro.js')) + '\n' + leer(join(COMUN, 'src/conversacion.js')) + `\nreturn { ${EXPORTADOS.join(', ')} };`)() as Record<string, any>;
const vd = (n: string): F => VD[n] as F;

// Catálogo de PRUEBA (no es de ningún negocio): los ids y las palabras entran como dato.
const SINONIMOS = { libro: ['libro', 'ebook'], workbook: ['workbook', 'cuaderno de trabajo'], guia: ['guia'], paquete: ['paquete completo'] };

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : [r];
  });
}
// Parte un archivo en [cabecera, cuerpo] por su primera línea en blanco.
function partir(texto: string): [string, string] {
  const i = texto.indexOf('\n\n');
  return [texto.slice(0, i), texto.slice(i + 2)];
}

describe('las copias de la primera venta digital son cabecera + cuerpo común', () => {
  for (const nombre of ['cobro.js', 'avisos.js']) {
    it(`${nombre}: mismo cuerpo, byte a byte`, () => {
      const [cabeceraCopia, cuerpoCopia] = partir(leer(join(COPIAS, nombre)));
      const [cabeceraComun, cuerpoComun] = partir(leer(join(COMUN, 'src', nombre)));
      expect(cuerpoComun.length).toBeGreaterThan(1000);
      expect(cuerpoComun).toBe(cuerpoCopia);
      // Las dos cabeceras son solo comentarios.
      for (const c of [cabeceraCopia, cabeceraComun]) expect(c.split('\n').every((l) => l.startsWith('//'))).toBe(true);
    });
    it(`${nombre}: negado, cambiar un solo carácter del cuerpo común lo rompe`, () => {
      const [, cuerpoCopia] = partir(leer(join(COPIAS, nombre)));
      const [, cuerpoComun] = partir(leer(join(COMUN, 'src', nombre)));
      expect(cuerpoComun.replace('const ', 'let ')).not.toBe(cuerpoCopia);
    });
  }
});

describe('la carpeta común no tiene nombres de cliente ni montos', () => {
  const PROHIBIDOS = /rub[eé]n|antonio|dauber|\broca\b|m[eé]todo puente|rroca/i;
  const MONTO = /\b\d+(?:[.,]\d+)?\s?Bs\b/;
  const lista = archivos(COMUN);
  it('hay archivos que revisar', () => {
    expect(lista.map((r) => r.slice(COMUN.length + 1)).sort()).toEqual(['LEEME.md', 'src/avisos.js', 'src/cobro.js', 'src/conversacion.js']);
  });
  for (const r of lista) {
    it(`${r.slice(COMUN.length + 1)}: sin nombres de cliente ni montos`, () => {
      const t = leer(r);
      expect(t.match(PROHIBIDOS)).toBeNull();
      expect(t.match(MONTO)).toBeNull();
    });
  }
  it('negado: el detector sí ve un nombre y un monto', () => {
    expect('Soy el asistente de Rubén').toMatch(PROHIBIDOS);
    expect('de Antonio Dauber').toMatch(PROHIBIDOS);
    expect('Pack 49Bs').toMatch(MONTO);
    expect('Pack 49 Bs').toMatch(MONTO);
  });
  it('los .js no usan módulos ni lo que el nodo Code de n8n no tiene', () => {
    for (const r of lista.filter((x) => x.endsWith('.js'))) {
      const sinComentarios = leer(r).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(sinComentarios, r).not.toMatch(/^\s*(import|export)\s/m);
      expect(sinComentarios, r).not.toMatch(/\brequire\s*\(|\bnew URL\b|\bBuffer\.|\bcrypto\./);
    }
  });
});

describe('vdFichaCharla', () => {
  it('sanea el contador y los booleanos son estrictos', () => {
    const f = vd('vdFichaCharla');
    expect(f({})).toEqual({ charlaN: 0, pidioOpciones: false, opcionesVistas: false });
    expect(f(null).charlaN).toBe(0);
    expect(f({ charlaN: 'abc' }).charlaN).toBe(0);
    expect(f({ charlaN: -1 }).charlaN).toBe(0);
    expect(f({ charlaN: Number.NaN }).charlaN).toBe(0);
    expect(f({ charlaN: Infinity }).charlaN).toBe(0);
    expect(f({ charlaN: 1e9 }).charlaN).toBe(1000);
    expect(f({ charlaN: 2.9 }).charlaN).toBe(2);
    expect(f({ pidioOpciones: 'true', opcionesVistas: 1 })).toMatchObject({ pidioOpciones: false, opcionesVistas: false });
    expect(f({ pidioOpciones: true, opcionesVistas: true })).toMatchObject({ pidioOpciones: true, opcionesVistas: true });
  });
  it('vence a las 48 h solo si se pasa la hora; sin hora, se conserva', () => {
    const f = vd('vdFichaCharla');
    const ficha = { charlaN: 3, pidioOpciones: true, opcionesVistas: true, ultimoMs: 1_000_000 };
    const h48 = 48 * 3600 * 1000;
    expect(f(ficha).charlaN).toBe(3);
    expect(f(ficha, 1_000_000 + h48).charlaN).toBe(3);
    expect(f(ficha, 1_000_000 + h48 + 1)).toEqual({ charlaN: 0, pidioOpciones: false, opcionesVistas: false });
  });
});

describe('vdHabilitado (la compuerta)', () => {
  const h = (c: unknown) => vd('vdHabilitado')(c);
  it('cerrada sin charla ni excepción', () => {
    expect(h({})).toBe(false);
    expect(h(null)).toBe(false);
    expect(h({ charlaN: 0 })).toBe(false);
    expect(h({ charlaN: 1 })).toBe(false);
  });
  it('abierta con dos mensajes de charla o con cada excepción', () => {
    expect(h({ charlaN: 2 })).toBe(true);
    expect(h({ qrAbierto: true })).toBe(true);
    expect(h({ producto: 'libro' })).toBe(true);
    expect(h({ pedidos: 1 })).toBe(true);
    expect(h({ comprobanteMs: 5 })).toBe(true);
    expect(h({ enRevision: true })).toBe(true);
  });
  it('negado: valores de otro tipo o vacíos no abren', () => {
    expect(h({ qrAbierto: 'true' })).toBe(false);
    expect(h({ producto: '' })).toBe(false);
    expect(h({ producto: 5 })).toBe(false);
    expect(h({ pedidos: 0 })).toBe(false);
    expect(h({ pedidos: '3' })).toBe(false);
    expect(h({ comprobanteMs: 0 })).toBe(false);
    expect(h({ enRevision: 1 })).toBe(false);
    expect(h({ charlaN: '2' })).toBe(false);
    expect(h({ charlaN: Number.NaN })).toBe(false);
  });
});

describe('vdCuentaComoCharla y vdLineaModo', () => {
  it('cuentan la conversación; no cuentan el modelo caído, lo repetido, la identidad ni las derivaciones', () => {
    const c = vd('vdCuentaComoCharla');
    for (const t of ['modelo', 'audio_modelo', 'imagen_modelo', 'puente', 'puente_fijo', 'charla_fija', 'opciones', 'opciones_fijo']) expect(c(t, true)).toBe(true);
    for (const t of ['modelo_caido', 'repetido', 'identidad', 'info', 'ingresos', 'imagenes', 'derivar', 'derivacion', '', undefined, null, 5, 'constructor']) expect(c(t, false)).toBe(false);
  });
  it('el saludo cuenta solo si el teléfono no estaba saludado', () => {
    expect(vd('vdCuentaComoCharla')('saludo', false)).toBe(true);
    expect(vd('vdCuentaComoCharla')('saludo', undefined)).toBe(true);
    expect(vd('vdCuentaComoCharla')('saludo', true)).toBe(false);
  });
  it('la línea de modo existe solo para los cuatro modos', () => {
    const l = vd('vdLineaModo');
    expect(l('charla')).toBe('[MODO_TURNO: CHARLA]\n');
    expect(l('antes')).toBe('[MODO_TURNO: CHARLA_ANTES_DE_OPCIONES]\n');
    expect(l('puente')).toBe('[MODO_TURNO: PUENTE]\n');
    expect(l('opciones')).toBe('[MODO_TURNO: OPCIONES]\n');
    for (const m of ['', 'otro', 'toString', '__proto__', 'constructor', undefined, null, 3]) expect(l(m)).toBe('');
  });
});

describe('vdSinPreguntaFinal', () => {
  const q = (t: string) => vd('vdSinPreguntaFinal')(t);
  it('quita toda oración interrogativa, también la de en medio', () => {
    expect(q('Qué buena idea. ¿Y tú qué haces? Te sirve mucho.')).toBe('Qué buena idea. Te sirve mucho.');
    expect(q('Cuenta. ¿A qué te dedicas? 😊')).toBe('Cuenta.');
    expect(q('Una idea.\n\n¿Cuál prefieres?')).toBe('Una idea.');
  });
  it('si solo hay preguntas, queda vacío; un texto sin preguntas no cambia', () => {
    expect(q('¿Te muestro algo?')).toBe('');
    expect(q('Sin preguntas aquí.\n\nOtro párrafo.')).toBe('Sin preguntas aquí.\n\nOtro párrafo.');
    expect(q(undefined)).toBe('');
  });
  it('negado: no queda ningún signo de interrogación', () => {
    expect(q('A. ¿B? C. ¿D?\n\n¿E?')).not.toContain('?');
  });
});

describe('vdQuitarPromesaDeOpciones', () => {
  const q = (t: string, d?: string[]) => vd('vdQuitarPromesaDeOpciones')(t, d);
  it('quita las promesas de precios, opciones y catálogo', () => {
    for (const p of ['Ahorita te paso los precios.', 'Te muestro las opciones en un momento.', 'Abajo tienes el catálogo.', 'Luego te cuento cuánto cuesta.', 'Ya te mando las opciones.', 'Te los paso enseguida.']) {
      expect(q('Qué bueno. ' + p), p).toBe('Qué bueno.');
    }
  });
  it('conserva lo que no promete nada', () => {
    const ok = 'Me encanta tu idea. Con la práctica sale mejor.';
    expect(q(ok)).toBe(ok);
    expect(q('Te preguntan precios todos los días, entiendo.')).toBe('Te preguntan precios todos los días, entiendo.');
    expect(q('Hay versiones sin costo de las herramientas.')).toBe('Hay versiones sin costo de las herramientas.');
  });
  it('una línea suelta que era solo una promesa se va entera y los párrafos se conservan', () => {
    expect(q('Hola 😊\nAhí van los precios 👇\n\nTe leo.')).toBe('Hola 😊\n\nTe leo.');
  });
  it('un nombre de producto promete solo si se pasa como dato y va junto a un verbo de mostrar', () => {
    const t = 'Te muestro el estuche.';
    expect(q(t)).toBe(t);
    expect(q(t, ['estuche'])).toBe('');
    expect(q('El estuche es lindo.', ['estuche'])).toBe('El estuche es lindo.');
    expect(q('Ahorita te muestro el estuche.')).toBe('');   // con marca de inminencia promete aun sin dato
  });
});

describe('vdEtiquetaConPrecio', () => {
  const e = (n: string, m: number) => vd('vdEtiquetaConPrecio')(n, m);
  it('usa el nombre y el monto que recibe, sin espacio antes de «Bs»', () => {
    expect(e('Pack completo', 49)).toBe('Pack completo 49Bs');
    expect(e('Libro', 12.5)).toBe('Libro 12,50Bs');
    expect(e('Otro nombre', 7)).toBe('Otro nombre 7Bs');
  });
  it('nunca pasa de 20 caracteres y conserva el «Bs»', () => {
    for (const [n, m] of [['Libro + Bonos extra premium', 1234.56], ['Un nombre larguísimo de producto', 99.99], ['Superlargonombresinespacios', 20], ['x', 1000000], ['', 5]] as const) {
      const r = e(n, m);
      expect(r.length, r).toBeLessThanOrEqual(20);
      expect(r, r).toMatch(/Bs$/);
    }
    expect(e('Pack completo premium', 60.5)).toBe('Pack completo 60,50Bs'.length <= 20 ? 'Pack completo 60,50Bs' : 'Pack 60,50Bs');
  });
  it('negado: sin emojis ni signos de HTML, y distinto monto da distinta etiqueta', () => {
    expect(e('<b>Libro</b> 😀', 10)).not.toMatch(/[<>&]/);
    expect(e('Libro', 10)).not.toBe(e('Libro', 11));
  });
});

describe('vdAhorro', () => {
  const cat = { a: 10, b: 20, c: 5, p: 25 };
  it('suma los componentes y resta el paquete', () => {
    expect(vd('vdAhorro')(cat, 'p', ['a', 'b'])).toBe(5);
    expect(vd('vdAhorro')({ a: 10.1, b: 20.2, p: 25 }, 'p', ['a', 'b'])).toBe(5.3);
  });
  it('null si falta un precio, no ahorra, o los datos son raros', () => {
    const a = vd('vdAhorro');
    expect(a(cat, 'p', ['a', 'zz'])).toBeNull();
    expect(a(cat, 'zz', ['a', 'b'])).toBeNull();
    expect(a(cat, 'p', [])).toBeNull();
    expect(a(cat, 'p', 'a')).toBeNull();
    expect(a(cat, 'p', ['c'])).toBeNull();            // 5 - 25 < 0
    expect(a({ a: 10, b: 15, p: 25 }, 'p', ['a', 'b'])).toBeNull();   // iguala, no ahorra
    expect(a({ a: '10', b: 20, p: 25 }, 'p', ['a', 'b'])).toBeNull();
    expect(a({ a: Number.NaN, b: 20, p: 25 }, 'p', ['a', 'b'])).toBeNull();
    expect(a({ a: -5, b: 40, p: 25 }, 'p', ['a', 'b'])).toBeNull();
    expect(a(null, 'p', ['a'])).toBeNull();
    expect(a([], 'p', ['a'])).toBeNull();
    expect(a({}, 'constructor', ['toString'])).toBeNull();
  });
});

describe('vdTextoPuente', () => {
  const textos = { variantes: ['Primera idea.', 'Segunda idea.'], cierre: '¿Te muestro?' };
  const t = (h: string) => vd('vdTextoPuente')(textos, h);
  it('la primera variante, salvo que sea idéntica a lo último enviado', () => {
    expect(t('')).toBe('Primera idea.');
    expect(t(vd('vdHashTexto')('Primera idea.'))).toBe('Segunda idea.');
    expect(t(vd('vdHashTexto')('Primera idea.\n\n¿Te muestro?'))).toBe('Segunda idea.');
  });
  it('si todas coinciden con lo último, la primera; sin variantes, vacío', () => {
    expect(vd('vdTextoPuente')({ variantes: ['Única.'], cierre: '¿Sí?' }, vd('vdHashTexto')('Única.'))).toBe('Única.');
    expect(vd('vdTextoPuente')({ variantes: [], cierre: 'x' }, '')).toBe('');
    expect(vd('vdTextoPuente')(null, '')).toBe('');
    expect(vd('vdTextoPuente')({ variantes: [5, '', '  '], cierre: 'x' }, '')).toBe('');
  });
});

describe('vdPrecioPedido', () => {
  const p = (t: string, s: unknown = SINONIMOS) => vd('vdPrecioPedido')(t, s);
  it('«precio» suelto, o dicho de pasada, NO cuenta', () => {
    for (const t of ['precio', 'Precios', 'qué precios bajos', 'el precio no importa', 'me preguntan precio de las tortas', 'quiero responder precios por WhatsApp', 'tengo precios altos',
      'hola', '', 'el libro me gusta', 'no importa cuánto cuesta el libro', 'cuánto tarda la entrega del libro', 'cuánto pesa el libro', 'quiero comprar cuanto antes']) {
      expect(p(t), t).toBeNull();
    }
  });
  it('«cuánto cuesta X», «precio de X» y «qué precio tiene X» cuentan, con el producto resuelto por sinónimos', () => {
    expect(p('¿Cuánto cuesta el libro?')).toEqual({ producto: 'libro' });
    expect(p('precio del workbook')).toEqual({ producto: 'workbook' });
    expect(p('¿qué precio tiene la guía?')).toEqual({ producto: 'guia' });
    expect(p('cuanto vale el ebook')).toEqual({ producto: 'libro' });
    expect(p('Precio del cuaderno de trabajo')).toEqual({ producto: 'workbook' });
    expect(p('a cuánto está el paquete completo')).toEqual({ producto: 'paquete' });
    expect(p('dame el precio del libro')).toEqual({ producto: 'libro' });
  });
  it('una pregunta de precio sin producto, o con varios, es general: producto vacío', () => {
    expect(p('¿cuánto cuesta?')).toEqual({ producto: '' });
    expect(p('cuánto es')).toEqual({ producto: '' });
    expect(p('cuál es el precio')).toEqual({ producto: '' });
    expect(p('pásame los precios')).toEqual({ producto: '' });
    expect(p('cuánto cuestan el libro y la guía')).toEqual({ producto: '' });
  });
  it('el producto sale del dato que se pasa, no del código: otro catálogo, otra respuesta', () => {
    expect(p('¿cuánto cuesta el libro?', { novela: ['libro'] })).toEqual({ producto: 'novela' });
    expect(p('¿cuánto cuesta el libro?', {})).toEqual({ producto: '' });
    expect(p('¿cuánto cuesta el libro?', null)).toEqual({ producto: '' });
    expect(p('precio del libro', {})).toBeNull();
    expect(p('precio del libro', { libro: [] })).toBeNull();
  });
  it('negado: un producto nombrado sin pregunta de precio no cuenta, ni como palabra suelta dentro de otra', () => {
    expect(p('quiero el libro')).toBeNull();
    expect(p('me gusta la guía')).toBeNull();
    expect(p('cuánto cuesta el libroteca')).toEqual({ producto: '' });
    expect(p('precio de libros usados')).toBeNull();
    expect(p('el precio del carro es alto, pero el libro me interesa')).toBeNull();
  });
  it('una frase con caracteres de expresión regular en los sinónimos no rompe', () => {
    expect(p('cuánto cuesta el (kit+', { kit: ['(kit+'] })).toEqual({ producto: 'kit' });
  });
});
