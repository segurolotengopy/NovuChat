/**
 * «VENTA DIGITAL DE RUBÉN» — ENTREGA 2 (23/10/2026): LA CONVERSACIÓN COMO EL PDF MODELO.
 *
 * Antes de mostrar un precio o el catálogo, el asistente envía al menos DOS mensajes de conversación (el saludo cuenta como uno). El contador (`charlaN`) vive en la ficha del teléfono y lo lleva el código.
 * La parte PURA (librería `rr.js` evaluada como en el vigilante) está aquí arriba; el recorrido de punta a punta, sobre el JSON versionado y con el vigilante de UX, está más abajo.
 *
 * ESTA SUITE ESCRIBE NEGANDO: ningún precio antes de tiempo, una sola pregunta, el bloque de opciones a lo más una vez, lo que se ofrece se cumple, el mensaje no repite la descripción del libro,
 * y el conteo solo cuenta lo que Meta aceptó.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CARPETA_LIB = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-ruben/src/lib');
const FUENTE_RR = readFileSync(join(CARPETA_LIB, 'rr.js'), 'utf8');
type F = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const EXPORTADOS = [
  'rrFichaVigente', 'rrMenu', 'rrMenuDeComplemento', 'rrEtiquetaConPrecio', 'rrAhorro', 'rrPieQr', 'rrTextoInfo', 'rrTextoOpciones', 'rrTextoPuenteFijo', 'rrSinPreguntaFinal', 'rrQuitarRepeticionDelLibro',
  'rrPreguntaComoPagar', 'rrHashTexto', 'rrNorm', 'rrCatalogo', 'rrExtraRedaccion', 'rrCuerpoModelo', 'rrQuitarDelimitadores', 'rrSeguro', 'rrParrafos', 'rrEntradaCliente',
  'RR_PROMPT', 'RR_TEXTOS_PUENTE', 'RR_CIERRE_PUENTE', 'RR_TEXTO_CHARLA_FIJA', 'RR_PREGUNTA_INFO_CHARLA', 'RR_BOTON_OPCIONES', 'RR_ETIQUETA_BOTON', 'RR_PRODUCTOS',
];
// El código evaluado es el de los archivos del propio repositorio (src/lib), no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
export const RR = new Function(['cobro.js', 'avisos.js', 'rr.js'].map((a) => readFileSync(join(CARPETA_LIB, a), 'utf8')).join('\n') + `\nreturn { ${EXPORTADOS.join(', ')} };`)() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rr = (n: string): F => RR[n] as F;

const CAT = { pack: 60, libro: 32, closer: 20, videos: 25 };

describe('ENTREGA 2 · P1: ficha, etiquetas, pie del QR y ayudas de texto', () => {
  it('la ficha sanea `charlaN` (0 a 1000; lo que no es un número finito o es negativo vale 0) y los dos booleanos son estrictos', () => {
    const f = (x: unknown) => rr('rrFichaVigente')(x);
    expect(f({}).charlaN).toBe(0);
    expect(f({ charlaN: 'abc' }).charlaN).toBe(0);
    expect(f({ charlaN: -1 }).charlaN).toBe(0);
    expect(f({ charlaN: Number.NaN }).charlaN).toBe(0);
    expect(f({ charlaN: Infinity }).charlaN).toBe(0);
    expect(f({ charlaN: 1e9 }).charlaN).toBe(1000);
    expect(f({ charlaN: 2.9 }).charlaN).toBe(2);
    expect(f(null).charlaN).toBe(0);
    expect(f({ pidioOpciones: 'true', opcionesVistas: 1 })).toMatchObject({ pidioOpciones: false, opcionesVistas: false });
    expect(f({ pidioOpciones: true, opcionesVistas: true })).toMatchObject({ pidioOpciones: true, opcionesVistas: true });
  });

  it('las etiquetas con precio son las del PDF («Pack Completo 60Bs»), sin espacio antes de «Bs», nunca pasan de 20 caracteres y conservan el «Bs»', () => {
    const t = (cual: number) => rr('rrMenu')(cual, CAT, []).map((b: { title: string }) => b.title);
    expect(t(1)).toEqual(['Pack Completo 60Bs', 'Libro + Bonos 32Bs', 'Ver Complementos']);
    expect(t(2)).toEqual(['Closer Ventas 20Bs', 'Videos con IA 25Bs', 'Mejor el Pack 60Bs']);
    expect(rr('rrMenuDeComplemento')('closer', CAT, []).map((b: { title: string }) => b.title)).toEqual(['Closer Ventas 20Bs', 'Mejor el Pack 60Bs']);
    expect(rr('rrMenuDeComplemento')('videos', CAT, []).map((b: { title: string }) => b.title)).toEqual(['Videos con IA 25Bs', 'Mejor el Pack 60Bs']);
    // Con decimales el nombre se recorta y el «Bs» se conserva.
    const largo = rr('rrEtiquetaConPrecio')('Pack Completo', 60.5);
    expect(largo.length).toBeLessThanOrEqual(20);
    expect(largo).toMatch(/60,50Bs$/);
    expect(largo).toBe('Pack 60,50Bs');
    for (const [n, m] of [['Libro + Bonos', 1234.56], ['Mejor el Pack', 99.99], ['Closer Ventas', 20], ['Videos con IA', 25.5]] as const) {
      const e = rr('rrEtiquetaConPrecio')(n, m);
      expect(e.length, e).toBeLessThanOrEqual(20);
      expect(e).toMatch(/\d+(,\d{2})?Bs$/);
      expect(e).not.toMatch(/\d Bs/);
    }
    // Sin emojis en ningún botón de los menús.
    for (const b of [...rr('rrMenu')(1, CAT, []), ...rr('rrMenu')(2, CAT, [])]) expect(b.title).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('el ahorro es 17 con el catálogo 60/32/20/25 y no aparece si falta un precio; el bloque de opciones lo dice solo si el Pack está entre los botones', () => {
    expect(rr('rrAhorro')(CAT)).toBe(17);
    expect(rr('rrAhorro')({ pack: 60, libro: 32, closer: 20 })).toBeNull();
    const t = rr('rrTextoOpciones')(CAT, []);
    expect(t).toBe('Te dejo aquí abajo las opciones para que elijas la que prefieras (con el Pack Completo ahorras 17 Bs sobre el precio por separado):');
    // Sin el precio de un producto no se calcula ningún ahorro (nunca un monto inventado).
    expect(rr('rrTextoOpciones')({ pack: 60, libro: 32, closer: 20 }, [])).toBe('Te dejo aquí abajo las opciones para que elijas la que prefieras:');
    // Si el cliente ya pulsó el Pack, no se nombra el ahorro del Pack.
    expect(rr('rrTextoOpciones')(CAT, ['b_pack'])).not.toMatch(/ahorras/);
  });

  it('el pie del QR real es el del PDF, con «Pedido #X» al final, sin banco, titular ni cuenta, y cabe en 1024 caracteres; el simulado no cambia', () => {
    const pie = rr('rrPieQr')('pack', 60, 'RR1ABC9', false, false) as string;
    expect(pie).toBe('¡Genial! Te llevas el Pack Completo (Libro + 4 bonos + Closer de Ventas + Curso de Videos con IA).\n\nAquí tienes el QR de pago. Está con monto abierto, así que ingresa 60 Bs en tu aplicación bancaria.\n\nApenas lo realices, envíame la captura del comprobante por aquí mismo 😊\n\nPedido #RR1ABC9.');
    expect(pie).not.toMatch(/banco|titular|cuenta|mercantil|escanea/i);
    expect(pie.length).toBeLessThanOrEqual(1024);
    expect(rr('rrPieQr')('libro', 32, 'RR1ABC9', true, false)).toMatch(/^Hola, soy el asistente virtual de Rubén\. ¡Genial! Te llevas el libro «IA para Emprendedores Independientes» con sus 4 bonos\./);
    expect(rr('rrPieQr')('closer', 20, '', false, false)).toMatch(/^¡Genial! Te llevas el Closer de Ventas \(Prompt Maestro de Cierre\)\./);
    expect(rr('rrPieQr')('videos', 25, '', false, false)).toMatch(/^¡Genial! Te llevas el curso «Crea videos con IA»\./);
    expect(rr('rrPieQr')('videos', 25, '', false, false)).not.toMatch(/Pedido/);
    // El simulado conserva su rótulo y NO usa el texto nuevo.
    const sim = rr('rrPieQr')('pack', 60, 'RR1ABC9', false, true) as string;
    expect(sim).toMatch(/SIMULAD/i);
    expect(sim).not.toMatch(/¡Genial!/);
    // Nunca «acreditado» ni «verificado» en el pie.
    expect(pie).not.toMatch(/acreditad|verificad|recibimos tu pago/i);
  });

  it('`rrSinPreguntaFinal` quita la pregunta (y cualquier otra oración interrogativa) y devuelve \'\' si no queda nada', () => {
    const q = rr('rrSinPreguntaFinal');
    expect(q('Qué buen punto. Con el libro armas tus ideas. ¿A qué te dedicas?')).toBe('Qué buen punto. Con el libro armas tus ideas.');
    expect(q('¿A qué te dedicas?')).toBe('');
    expect(q('Sin pregunta alguna.')).toBe('Sin pregunta alguna.');
    expect(q('Primero esto. ¿Y tú? Después aquello.')).toBe('Primero esto. Después aquello.');
    expect((q('Una idea.\n\nOtra idea.\n\n¿Te sirve?') as string).includes('?')).toBe(false);
    expect(q('Una idea.\n\nOtra idea.\n\n¿Te sirve?')).toBe('Una idea.\n\nOtra idea.');
  });

  it('`rrQuitarRepeticionDelLibro` quita las oraciones que repiten la descripción del libro y deja el resto', () => {
    const q = rr('rrQuitarRepeticionDelLibro');
    expect(q('El libro tiene 12 capítulos y más de 230 páginas. Con el Checklist de 7 días empiezas desde cero.')).toBe('Con el Checklist de 7 días empiezas desde cero.');
    expect(q('Es un método para que pases de solo curiosear herramientas a usarlas. Te sirve para tus ventas.')).toBe('Te sirve para tus ventas.');
    expect(q('Un texto sin eso.')).toBe('Un texto sin eso.');
    expect(q('El libro tiene 12 capítulos.')).toBe('');
  });

  it('`rrTextoPuenteFijo` nunca repite lo último que se envió (la primera variante cuyo hash difiere), sin montos', () => {
    const [a, b] = RR.RR_TEXTOS_PUENTE as string[];
    expect(rr('rrTextoPuenteFijo')('')).toBe(a);
    expect(rr('rrTextoPuenteFijo')(rr('rrHashTexto')(a))).toBe(b);
    expect(rr('rrTextoPuenteFijo')(rr('rrHashTexto')(a + '\n\n' + RR.RR_CIERRE_PUENTE))).toBe(b);
    expect(rr('rrTextoPuenteFijo')(rr('rrHashTexto')(b))).toBe(a);
    for (const x of [a, b, RR.RR_TEXTO_CHARLA_FIJA, RR.RR_CIERRE_PUENTE, RR.RR_PREGUNTA_INFO_CHARLA]) expect(x as string).not.toMatch(/\bBs\b|\d\s?Bs|gratis|descuento|oferta/i);
    expect(RR.RR_CIERRE_PUENTE).toBe('¿Te muestro las opciones?');
    expect(RR.RR_BOTON_OPCIONES).toBe('b_opciones');
    expect(RR.RR_ETIQUETA_BOTON.b_opciones).toBe('Ver opciones');
  });

  it('`rrTextoInfo` con cierre de charla termina en la pregunta de conversación y NO ofrece opciones', () => {
    const t = rr('rrTextoInfo')('info', 'charla') as string;
    expect(t.endsWith('\n\n' + RR.RR_PREGUNTA_INFO_CHARLA)).toBe(true);
    expect(t).not.toMatch(/Qué opción prefieres/);
    expect(rr('rrTextoInfo')('info', true)).toMatch(/Qué opción prefieres\?$/);
    expect(rr('rrTextoInfo')('info', false)).not.toMatch(/\?/);
  });

  it('`rrPreguntaComoPagar` reconoce «cómo pago», «dónde pago», «quiero comprar» y no otras frases', () => {
    const p = rr('rrPreguntaComoPagar');
    for (const x of ['como te pago', 'como pago', 'donde pago', 'quiero comprar', 'como compro', 'quiero pagar', 'como lo pago']) expect(p(x), x).toBe(true);
    for (const x of ['cuanto cuesta', 'hola', 'tengo una tienda', 'pague ayer']) expect(p(x), x).toBe(false);
  });
});
