/**
 * CARACTERES QUE UNA PERSONA NO VE Y EL MODELO SI LEE: UNA SOLA TABLA.
 *
 * Origen: la revision de seguridad de #608 y #614 (23/10/2026). Los caracteres de etiqueta
 * (U+E0000-E007F), los selectores de variacion (U+FE00-FE0F y los suplementarios U+E0100-E01EF),
 * el relleno de Hangul, el ancho cero y los de direccion de escritura esconden texto («emoji
 * smuggling»). Cada filtro que deja pasar texto al prompt usa ESTA tabla: los de servidor
 * RECHAZAN (`tieneInvisibles`), los de flujo SANEAN (`limpiarInvisibles`).
 *
 * Los flujos de n8n no pueden importar este modulo (el codigo se incluye byte a byte en el JSON), asi que
 * llevan una copia de `CLASE_INVISIBLES` y de `CONSERVAR_EMOJI`, y `pruebas/endurecer-invisibles.test.ts`
 * falla si alguna copia diverge de esta tabla. La tabla va escrita con escapes: nunca como caracteres crudos.
 *
 * UN CASO LEGITIMO: el selector de presentacion de emoji (U+FE0F) y el unidor (U+200D) forman parte de
 * «Promo ❤», «1 + keycap» o «emoji con unidor». Se conservan SOLO cuando siguen a un emoji, a un digito o a `#`/`*`
 * (teclas), una vez, y no seguidos de otro selector; sueltos, son invisibles como los demas.
 */

/** Cuerpo de una clase de caracteres (para `new RegExp('[' + ... + ']', 'u')`). */
export const CLASE_INVISIBLES =
  '\\p{Cf}\\u{0}-\\u{8}\\u{b}\\u{c}\\u{e}-\\u{1f}\\u{7f}-\\u{9f}\\u{34f}\\u{115f}\\u{1160}\\u{17b4}\\u{17b5}\\u{180b}-\\u{180f}'
  + '\\u{2028}\\u{2029}\\u{3164}\\u{fe00}-\\u{fe0f}\\u{ffa0}\\u{e0000}-\\u{e007f}\\u{e0100}-\\u{e01ef}';

/** Alternativas de lo que SE CONSERVA aunque este en la tabla: FE0F tras base de emoji y 200D entre dos emojis. */
export const CONSERVAR_EMOJI =
  '(?<=[\\p{Extended_Pictographic}\\p{Emoji_Modifier}0-9#*])\\u{fe0f}(?![\\u{fe00}-\\u{fe0f}\\u{e0100}-\\u{e01ef}])'
  + '|(?<=\\p{Extended_Pictographic}[\\p{Emoji_Modifier}\\u{fe0f}]?)\\u{200d}(?=\\p{Extended_Pictographic})';

/** TODOS los de la tabla, sin excepcion (para comparar patrones: se quitan hasta los de emoji). */
export const RE_INVISIBLES_TODOS = new RegExp('[' + CLASE_INVISIBLES + ']', 'gu');
const RE_LIMPIAR = new RegExp('(' + CONSERVAR_EMOJI + ')|[' + CLASE_INVISIBLES + ']', 'gu');

/** El texto sin los invisibles, salvo los de emoji legitimos. */
export function limpiarInvisibles(t: string): string {
  return t.replace(RE_LIMPIAR, (m: string, k: string | undefined) => (k === undefined ? '' : m));
}

/** ¿Trae algo que una persona no ve? (los de emoji legitimos no cuentan). Mirar `t.normalize('NFKC')`. */
export function tieneInvisibles(t: string): boolean {
  return limpiarInvisibles(t) !== t;
}

/**
 * Los que el copiado desde Word o WhatsApp deja sin querer: ancho cero, BOM, guion blando y
 * unidor de palabras. La consola los QUITA en silencio; el servidor sigue rechazando el resto.
 */
export const RE_RESIDUOS_DE_COPIADO = /[\u{200b}\u{feff}\u{ad}\u{2060}]/gu;

/** Delimitadores de bloque en cualquier forma de ancho completo o compatible: se detectan con NFKC. */
export function esMarcaDeBloque(c: string): boolean {
  return /[\u{226a}\u{226b}]/u.test(c) || /[<>[\]{}]/.test(c.normalize('NFKC'));
}
