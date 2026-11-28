import { sanearTexto } from '../../central/componentes/TextoSeguro';

/**
 * Rótulo FIJO del bloque de la nota del cliente en «Pedidos». Es presentación,
 * no dato: deja claro que es lo que el cliente escribió y que NO dice nada del
 * estado de un pago.
 */
export const ROTULO_NOTA_CLIENTE = 'Nota escrita por el cliente (no es un estado de pago):';

/** Largo máximo de la nota que guarda el servidor (`notaCliente`). */
export const MAX_NOTA_CLIENTE = 500;

/**
 * Texto de `notaCliente` listo para mostrar: saneado (sin controles ni marcas
 * bidi), recortado (`trim`, para que `pre-wrap` no muestre saltos al inicio o al
 * final) y como mucho 500 PUNTOS DE CÓDIGO (un emoji, aunque sea compuesto con
 * ZWJ, cuenta por sus puntos y no se parte por la mitad de un par sustituto); o
 * `''` si no es texto o queda vacío. Conserva «&», «<», «>» y el ZWJ tal como se
 * guardaron: el escape es de PRESENTACIÓN y lo hace React al pintar. Devuelve
 * TEXTO, nunca HTML: quien lo pinta lo hace como hijo de React, sin enlaces ni
 * markdown, y esta función no escapa ni convierte nada.
 */
export function notaDelCliente(valor: unknown): string {
  // Se sanea sin tope y se corta aquí, por puntos de código, para cuidar el par sustituto.
  const texto = sanearTexto(valor, Number.MAX_SAFE_INTEGER).trim();
  const puntos = Array.from(texto);
  return puntos.length > MAX_NOTA_CLIENTE ? puntos.slice(0, MAX_NOTA_CLIENTE).join('').trim() : texto;
}
