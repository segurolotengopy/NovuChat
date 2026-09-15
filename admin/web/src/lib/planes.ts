/**
 * PLANES EN LA CONSOLA — límites del plan y aviso de consumo.
 *
 * LA FUENTE ES `functions/src/planes.ts`, no este archivo. Esa tabla la aplica
 * el servidor —las reglas y `importarCatalogo`— y es la que decide si un
 * producto entra o no. Lo de acá es el RESPALDO para PINTAR la pantalla cuando
 * `cuenta/estado` todavía no trae `limites`: cuando exista el módulo del
 * servidor, este archivo tiene que pasar a reexportarlo, igual que
 * `lib/atencion.ts` reexporta `atencion.ts`. Dos tablas que dicen lo mismo
 * dejan de decirlo el primer día que alguien cambia una sola.
 *
 * Y AUNQUE ESTA TABLA SE EQUIVOQUE, NO ABRE NADA: si la pantalla creyera que el
 * tope es mayor, el servidor rechaza igual y la consola dice por qué. Una
 * pantalla que se equivoca a favor del comercio solo cambia CUÁNDO se entera.
 */

export type Plan = 'impulso' | 'crecimiento' | 'pro' | 'demostracion';

interface DatosDelPlan {
  nombre: string;
  /** Productos del catálogo (decisión de Andres del 15/09: 20 / 100 / 500). */
  productos: number;
  /** El plan al que se sube para tener más productos, si hay uno. */
  siguiente: Plan | null;
}

/** Respaldo. La fuente es `functions/src/planes.ts`. */
const PLANES: Record<Plan, DatosDelPlan> = {
  impulso: { nombre: 'Impulso', productos: 20, siguiente: 'crecimiento' },
  crecimiento: { nombre: 'Crecimiento', productos: 100, siguiente: 'pro' },
  pro: { nombre: 'Pro', productos: 500, siguiente: null },
  demostracion: { nombre: 'Demostración', productos: 500, siguiente: null },
};

/** Sin plan conocido rige el más chico: equivocarse para arriba promete de más. */
const PRODUCTOS_SIN_PLAN = 20;

export function planConocido(plan: unknown): Plan | null {
  return typeof plan === 'string' && plan in PLANES ? plan as Plan : null;
}

/** «Crecimiento». Un plan desconocido NO se muestra crudo: sale «tu plan». */
export function nombreDePlan(plan: unknown): string | null {
  const p = planConocido(plan);
  return p ? PLANES[p].nombre : null;
}

/** El plan al que conviene subir para tener más productos, con su tope. */
export function planSiguiente(plan: unknown): { nombre: string; productos: number } | null {
  const p = planConocido(plan);
  const s = p ? PLANES[p].siguiente : 'crecimiento';
  return s ? { nombre: PLANES[s].nombre, productos: PLANES[s].productos } : null;
}

const enteroPositivo = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * Tope de productos para ESTE comercio: el que escribió el servidor en
 * `cuenta/estado.limites.productos`; si falta, el del plan; si el plan tampoco
 * se conoce, el más chico.
 */
export function limiteDeProductos(cuenta: Record<string, unknown> | null | undefined): number {
  const limites = cuenta?.['limites'];
  const propio = typeof limites === 'object' && limites !== null
    ? enteroPositivo((limites as Record<string, unknown>)['productos']) : null;
  if (propio !== null) return propio;
  const p = planConocido(cuenta?.['plan']);
  return p ? PLANES[p].productos : PRODUCTOS_SIN_PLAN;
}

/** `AAAA-MM` del mes boliviano en curso. UTC−4 fijo, como todo el proyecto. */
export function mesEnCurso(ahora = Date.now()): string {
  return new Date(ahora - 4 * 3_600_000).toISOString().slice(0, 7);
}

export interface AvisoConsumo {
  /** 80, para decirlo en la frase. */
  porcentaje: number;
  conversaciones: number;
  limite: number;
}

/**
 * El aviso de consumo de ESTE MES, si el servidor lo marcó.
 *
 * Lo escribe el servidor en `cuenta/estado.avisoConsumo` cuando el comercio
 * cruza el umbral; la consola no lo calcula. Un aviso de un mes anterior no se
 * muestra: el contador ya volvió a cero y decir «llegaste al 80 %» sería falso.
 */
export function avisoConsumoVigente(
  cuenta: Record<string, unknown> | null | undefined, ahora = Date.now(),
): AvisoConsumo | null {
  const a = cuenta?.['avisoConsumo'];
  if (typeof a !== 'object' || a === null) return null;
  const aviso = a as Record<string, unknown>;
  if (aviso['mes'] !== mesEnCurso(ahora)) return null;
  const conversaciones = enteroPositivo(aviso['conversaciones']);
  const limite = enteroPositivo(aviso['limite']);
  if (conversaciones === null || limite === null || limite === 0) return null;
  const umbral = typeof aviso['umbral'] === 'number' && aviso['umbral'] > 0 && aviso['umbral'] <= 1
    ? aviso['umbral'] : 0.8;
  return { porcentaje: Math.round(umbral * 100), conversaciones, limite };
}
