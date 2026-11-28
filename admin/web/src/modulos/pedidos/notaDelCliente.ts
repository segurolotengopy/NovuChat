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
 * final), hasta 500 sin partir un par sustituto (emoji); o `''` si no es texto o
 * queda vacío. Devuelve TEXTO, nunca HTML: quien lo pinta lo hace como hijo de
 * React, sin enlaces ni markdown.
 */
export function notaDelCliente(valor: unknown): string {
  // Se sanea sin tope y se corta aquí, para cuidar el par sustituto.
  let texto = sanearTexto(valor, Number.MAX_SAFE_INTEGER).trim();
  if (texto.length > MAX_NOTA_CLIENTE) {
    const ultimo = texto.charCodeAt(MAX_NOTA_CLIENTE - 1);
    // Si el carácter 500 es la mitad alta de un par, se descarta esa mitad.
    texto = texto.slice(0, ultimo >= 0xd800 && ultimo <= 0xdbff ? MAX_NOTA_CLIENTE - 1 : MAX_NOTA_CLIENTE).trim();
  }
  return texto;
}
