/**
 * Vocabulario del estado de cuenta.
 *
 * POR QUÉ VIVE ACÁ Y NO EN UNA PANTALLA. La tabla de etiquetas estaba dentro de
 * `EstadoCuenta.tsx`, así que el tablero —que muestra el mismo dato en una
 * tarjeta— no la tenía y pintaba el valor crudo de la base. En la consola del
 * comercio de demostración se leía **`sin_cargo`**, con guion bajo y todo. Un
 * identificador interno asomando en la pantalla del cliente le dice, sin que
 * nadie se lo diga, que está mirando algo a medio terminar.
 *
 * `sin_cargo` además no estaba en la tabla original: la sembradora lo escribe
 * para los comercios de demostración y ninguna pantalla sabía traducirlo.
 */
const ETIQUETA_PAGO: Record<string, string> = {
  al_dia: 'Al día',
  pendiente: 'Pago pendiente',
  vencido: 'Vencido',
  sin_cargo: 'Sin cargo',
};

/**
 * Traduce el estado de pago a algo que una persona pueda leer.
 *
 * Ante un valor que no conocemos NO se muestra el valor crudo: se dice que no
 * hay información. Es dato que viene de la base y podría ser cualquier cosa;
 * mostrarlo tal cual sería a la vez feo y una vía para colar texto ajeno en la
 * pantalla.
 */
export function etiquetaDePago(estado: unknown): string {
  return ETIQUETA_PAGO[String(estado)] ?? 'Sin información';
}

/** El único estado que se pinta en verde. Todo lo demás pide atención. */
export function pagoAlDia(estado: unknown): boolean {
  return estado === 'al_dia' || estado === 'sin_cargo';
}
