/**
 * Texto del comercio que va al prompt o a un mensaje de WhatsApp: una línea
 * limpia (`textoPlano`) y sin marcas que finjan un bloque del sistema
 * (`sinMarcas`). Es Core porque lo usa el prompt de todo tenant. El resto del
 * saneo (correo, encabezados, URL) es de Central, en
 * `central/servicios/saneo.ts`, que reexporta esto. Salió de ahí en el corte
 * C2 de F2 sin cambiar una línea: solo `RE_BIDI` pasó a exportarse, porque
 * `neutralizar` y `textoConSaltos` también la usan.
 */

/** Marcas bidireccionales: un texto puede leerse distinto de como se guardó. */
/**
 * También quita lo que una persona no ve y el modelo sí lee: caracteres de etiqueta
 * (U+E0000-E007F), selectores de variación U+FE00-FE0E, relleno de Hangul, ancho cero
 * (U+200B, U+2060, U+FEFF) y guion blando. Quedan U+200C/U+200D y U+FE0F: los usan los emojis.
 */
export const RE_BIDI = /[\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200E}\u{200F}\u{200B}\u{2060}-\u{2064}\u{FEFF}\u{AD}\u{34F}\u{61C}\u{115F}\u{1160}\u{180E}\u{3164}\u{FE00}-\u{FE0E}\u{FFA0}\u{E0000}-\u{E007F}]/gu;

/** Separadores de línea y tabulación: en un texto de una sola línea, valen espacio. */
const RE_SEPARADORES = /[\r\n\t\u2028\u2029]+/g;
/** Todos los controles C0/C1, incluidos el salto de línea y la tabulación. */
const RE_TODO_CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Recorta por CARACTERES y no por unidades de UTF-16: `slice` a secas puede
 * partir un emoji por la mitad y dejar un sustituto suelto, que WhatsApp pinta
 * como un rombo con signo de pregunta.
 */
export function recortar(texto: string, maxLargo: number): string {
  const c = Array.from(texto);
  return c.length <= maxLargo ? texto : c.slice(0, maxLargo).join('');
}

/**
 * Texto de UNA línea, para lo que el asistente o un flujo repiten tal cual: sin
 * saltos de línea, sin caracteres de control ni marcas bidireccionales, con los
 * espacios colapsados y recortado a su largo. No escapa marcado: el destino es
 * WhatsApp o el prompt, no un HTML (para eso está `neutralizar`).
 *
 * El salto se convierte en espacio ANTES de barrer los controles, por la misma
 * razón que en `neutralizarEncabezado`: si no, «Plan\nPro» quedaría «PlanPro».
 */
/**
 * Quita lo que en un prompt puede fingir una marca o un bloque del sistema:
 * corchetes (`[CIERRE]`, `[ENVIAR_QR]`), llaves y ángulos, y los delimitadores
 * `<<<`/`>>>` que rodean el corpus. Para textos del comercio que van al prompt
 * o a un mensaje fijo (nombre del asistente, oferta de captación). Hasta el
 * 15/09 lo hacía cada flujo por su cuenta; un flujo que se olvidara dejaba pasar
 * la marca (revisión de seguridad, LOW-1).
 */
export function sinMarcas(s: string): string {
  return s.normalize('NFKC').replace(/<<<|>>>/g, '').replace(/[[\]{}<>]/g, '').replace(/ {2,}/g, ' ').trim();
}

export function textoPlano(valor: unknown, maxLargo: number): string {
  if (typeof valor !== 'string') return '';
  const limpio = valor
    .replace(RE_SEPARADORES, ' ')
    .replace(RE_TODO_CONTROL, '')
    .replace(RE_BIDI, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return recortar(limpio, maxLargo).trim();
}

