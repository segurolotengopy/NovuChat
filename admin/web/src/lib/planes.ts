/**
 * PLANES EN LA CONSOLA — el MISMO módulo que usa el servidor.
 *
 * El catálogo de planes (precios, conversaciones, productos, agendas), la bolsa
 * y el aviso de consumo se leen de `functions/src/planes.ts`, importado
 * directamente, igual que `atencion.ts`. No hay una copia para el navegador: si
 * la hubiera, la pantalla podría prometer un límite que el servidor no aplica.
 *
 * OJO al mostrar el límite de UN comercio: lo que rige es la copia guardada en
 * su `cuenta/estado.limites`, no el catálogo de hoy. Para eso está
 * `limitesDeCuenta(cuenta)`; `PLANES` es la oferta vigente.
 *
 * El módulo es puro (no importa Firebase), así que entra en el bundle sin
 * arrastrar nada del servidor.
 */
export {
  AVISO_CONSUMO, BOLSA, CATALOGO_PLANES, INSTALACION_USD, LIMITE_MAXIMO, PLANES, PLANES_ASIGNABLES,
  PLAN_DEMOSTRACION, PLAN_POR_DEFECTO, avisoConsumoPendiente, avisoDeConsumo, esIdPlan, limitesDe,
  limitesDeCuenta, umbralDeAviso,
} from '../../../functions/src/planes';
export type {
  AvisoConsumo, IdPlan, IdPlanVendible, Limites, LimitesDeCuenta, Plan,
} from '../../../functions/src/planes';
