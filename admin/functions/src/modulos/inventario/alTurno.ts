import type { GanchoDelTurno } from '../../core/turno/ganchosDelTurno.js';
import { existencias } from './inventario.js';

/**
 * EL GANCHO DE INVENTARIO EN EL TURNO (F3b-2c, `Analisis/41` §2.3 y §7 F3b).
 *
 * Devuelve, por id de ítem del catálogo activo que el turno YA leyó, si está
 * agotado. Solo aparecen los ítems CON control de existencias: no saber
 * cuántos hay no es saber que hay cero, y un ítem sin control nunca sale
 * agotado (tampoco una clave `agotado: false`). El aporte es
 * `{ agotados: { [id]: boolean } }`: el coordinador lo vuelca en cada ítem del
 * catálogo (el del prompt y el que ven Campañas y los demás ganchos), no lo
 * mezcla como clave de primer nivel de la respuesta.
 *
 * Los `datos` del contexto son el documento COMPLETO del ítem (con `stock`):
 * Inventario lo necesita para `existencias`; los demás ganchos reciben después
 * solo lo que el coordinador decide mostrarles.
 *
 * QUIÉN LO LLAMA, Y POR QUÉ SIEMPRE. Hoy `agotado` sale en el catálogo de TODO
 * flujo (agendamiento y onboarding con stock incluidos), pero `modulosDelTurno`
 * solo enciende `inventario` en el número de venta. Para no cambiar la
 * respuesta de nadie el coordinador lo corre en cada turno: el saldo es un
 * campo del catálogo (Productos, capa común) y sin control de existencias el
 * gancho no aporta nada. Costo: cero lecturas, una pasada sobre lo ya leído.
 */
export const alTurnoInventario: GanchoDelTurno = (contexto) => {
  const agotados: Record<string, boolean> = {};
  for (const item of contexto.catalogo) {
    const quedan = existencias(item.datos as Record<string, unknown>);
    if (quedan !== null) agotados[item.id] = quedan === 0;
  }
  return { agotados };
};
