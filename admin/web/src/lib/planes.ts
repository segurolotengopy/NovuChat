/**
 * PLANES EN LA CONSOLA — el MISMO módulo que usa el servidor.
 *
 * El catálogo de planes (precios, conversaciones, productos, agendas), la bolsa
 * y el aviso de consumo se leen de `functions/src/planes.ts`, importado
 * directamente, igual que `atencion.ts`. No hay una copia para el navegador: si
 * la hubiera, la pantalla podría prometer un límite que el servidor no aplica.
 * (La rama de la consola traía su propia tabla de respaldo; se quitó al
 * integrarla: dos tablas que dicen lo mismo dejan de decirlo el primer día que
 * alguien cambia una sola.)
 *
 * OJO al mostrar el límite de UN comercio: lo que rige es la copia guardada en
 * su `cuenta/estado.limites`, no el catálogo de hoy. Para eso está
 * `limitesDeCuenta(cuenta)`; `PLANES` es la oferta vigente.
 *
 * Lo que agrega este archivo son LECTURAS PARA PINTAR (nombre del plan, a qué
 * plan subir, el aviso del mes), todas derivadas del módulo del servidor: acá
 * no hay ningún número escrito.
 *
 * El módulo es puro (no importa Firebase), así que entra en el bundle sin
 * arrastrar nada del servidor.
 */
import {
  AVISO_CONSUMO, PLANES, PLANES_ASIGNABLES, PLAN_POR_DEFECTO, esIdPlan, limitesDeCuenta, periodoDe,
  type IdPlanVendible,
} from '../../../functions/src/planes';

export {
  AVISO_CONSUMO, BOLSA, CATALOGO_PLANES, INSTALACION_USD, LIMITE_MAXIMO, PLANES, PLANES_ASIGNABLES,
  PLAN_DEMOSTRACION, PLAN_POR_DEFECTO, avisoConsumoPendiente, avisoDeConsumo, esIdPlan, limitesDe,
  limitesDeCuenta, periodoDe, umbralDeAviso,
} from '../../../functions/src/planes';
export type {
  AvisoConsumo, IdPlan, IdPlanVendible, Limites, LimitesDeCuenta, Plan,
} from '../../../functions/src/planes';

/**
 * Tope de productos para ESTE comercio: la copia de `cuenta/estado.limites`;
 * si falta o está fuera de rango, la del plan; si el plan no se conoce, la del
 * más chico. Es `limitesDeCuenta`, la misma función que aplica `importarCatalogo`.
 */
export function limiteDeProductos(cuenta: Record<string, unknown> | null | undefined): number {
  return limitesDeCuenta(cuenta).productos;
}

/** «Crecimiento». Un plan desconocido NO se muestra crudo: devuelve `null`. */
export function nombreDePlan(plan: unknown): string | null {
  return esIdPlan(plan) ? PLANES_ASIGNABLES[plan].nombre : null;
}

/**
 * El plan al que conviene subir para tener más productos, con su tope. Sigue
 * el orden de `PLANES` (el de la oferta). Un plan desconocido se trata como el
 * más chico —igual que el servidor—, así que sugiere el segundo. El plan de
 * demostración y el más grande no tienen siguiente.
 */
export function planSiguiente(plan: unknown): { nombre: string; productos: number } | null {
  if (plan === 'demostracion') return null;
  const orden = Object.keys(PLANES) as IdPlanVendible[];
  const actual: IdPlanVendible = esIdPlan(plan) ? plan as IdPlanVendible : PLAN_POR_DEFECTO;
  const s = orden[orden.indexOf(actual) + 1];
  return s ? { nombre: PLANES[s].nombre, productos: PLANES[s].productos } : null;
}

/** Lo que la consola necesita para pintar el aviso del 80 %. */
export interface AvisoConsumoVista {
  /** 80, para decirlo en la frase. */
  porcentaje: number;
  conversaciones: number;
  limite: number;
}

const entero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * El aviso de consumo de ESTE PERÍODO, si el servidor lo marcó.
 *
 * Lo escribe la ingesta en `cuenta/estado.avisoConsumo` cuando el comercio
 * cruza el umbral; la consola no lo calcula. Un aviso de un período anterior
 * no se muestra: el conteo ya volvió a cero y decir «llegaste al 80 %» sería
 * falso. El período es `periodoDe()`, EL MISMO que usa la ingesta para marcar
 * el aviso: con otro cálculo (la rama de la consola usaba UTC−4 y el servidor
 * UTC) el aviso se escondía, o se mostraba vencido, cuatro horas por mes.
 */
export function avisoConsumoVigente(
  cuenta: Record<string, unknown> | null | undefined, ahora = Date.now(),
): AvisoConsumoVista | null {
  const a = cuenta?.['avisoConsumo'];
  if (typeof a !== 'object' || a === null) return null;
  const aviso = a as Record<string, unknown>;
  if (aviso['mes'] !== periodoDe(ahora)) return null;
  const conversaciones = entero(aviso['conversaciones']);
  const limite = entero(aviso['limite']);
  if (conversaciones === null || limite === null || limite === 0) return null;
  const umbral = typeof aviso['umbral'] === 'number' && aviso['umbral'] > 0 && aviso['umbral'] <= 1
    ? aviso['umbral'] : AVISO_CONSUMO;
  return { porcentaje: Math.round(umbral * 100), conversaciones, limite };
}
