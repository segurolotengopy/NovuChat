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
 * bidi, hasta 500) o `''` si no es texto o queda vacío. Devuelve TEXTO, nunca
 * HTML: quien lo pinta lo hace como hijo de React, sin enlaces ni markdown.
 */
export function notaDelCliente(valor: unknown): string {
  const texto = sanearTexto(valor, MAX_NOTA_CLIENTE);
  return texto.trim() === '' ? '' : texto;
}
