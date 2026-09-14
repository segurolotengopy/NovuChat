/**
 * ATENCIÓN EN LA CONSOLA — el MISMO módulo que usa el servidor.
 *
 * El bloque de 25 y los umbrales de operador y bloqueo se leen de
 * `functions/src/atencion.ts`, importado directamente. No hay una copia para
 * el navegador: si la hubiera, la pantalla podría decir «se bloquea a las 100»
 * mientras el servidor bloquea a otra cifra, y sobre esa diferencia se discute
 * un reclamo. Una sola función, dos lectores.
 *
 * El módulo es puro (no importa Firebase), así que entra en el bundle sin
 * arrastrar nada del servidor.
 */
export {
  RESPUESTAS_POR_CONVERSACION, UMBRALES_ATENCION, UMBRAL_MAXIMO, umbralValido, umbralesDeAtencion,
} from '../../../functions/src/atencion';
export type { Umbrales } from '../../../functions/src/atencion';
