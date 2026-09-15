/**
 * =============================================================================
 * PLANES — el catálogo de lo que se vende, y los límites que se copian a cada
 * cuenta
 * =============================================================================
 *
 * ESTE MÓDULO ES PURO A PROPÓSITO, igual que `atencion.ts`: no importa Firebase
 * ni lee la red. Lo usan las Functions (`actualizarEstadoCuenta`, la ingesta),
 * el script `scripts/asignar-plan.mjs` y la consola (`web/src/lib/planes.ts`).
 * Un solo catálogo y cuatro lectores: si la consola tuviera su copia, podría
 * decir «hasta 100 productos» mientras el servidor corta en otra cifra, y sobre
 * esa diferencia se discute un reclamo.
 *
 * DÓNDE VIVE LA VERDAD DEL PLAN (`Analisis/29` §2.2-2.3, adoptado por Andres el
 * 15/09/2026):
 *
 *  - El CATÁLOGO (qué planes existen y cuánto incluye cada uno) vive ACÁ, en
 *    código versionado: un cambio de precio pasa por un PR que Andres y Silvana
 *    ven junto con `CLAUDE.md` y el sitio, no por un clic en producción.
 *  - El PLAN DE CADA COMERCIO vive en `tenants/{t}/cuenta/estado.plan`, y al
 *    asignarlo se escribe ahí una COPIA de sus límites (`limites`) y la versión
 *    del catálogo que se aplicó (`catalogoPlanes`). Quien hace cumplir un
 *    límite lee la COPIA, no este archivo: así el número no está escrito en
 *    quien lo aplica (`CLAUDE.md` §7.4), las reglas de Firestore lo pueden leer
 *    (no importan TypeScript), un cambio de precios no toca a quien ya
 *    contrató, y una factura se reconstruye con lo que dice la cuenta.
 *  - `tenants/{t}.plan` es un ESPEJO para pintar la lista de comercios. Lo
 *    escribe solo quien cambia el plan, en la misma transacción, y NINGÚN
 *    límite ni ninguna regla lo lee nunca.
 *
 * LOS NÚMEROS son los que publica el sitio (`Novuchat-site`,
 * `src/contenido/precios.es.ts`, verificado el 15/09/2026) y los de la «Base
 * comercial» de `CLAUDE.md`. Un PR que cambie uno de ellos cambia los tres
 * lugares; `pruebas/planes.test.ts` compara este archivo con `CLAUDE.md`.
 */

// -----------------------------------------------------------------------------
// EL CATÁLOGO
// -----------------------------------------------------------------------------

/** Los planes que se venden, en el orden en que se muestran. */
export type IdPlanVendible = 'impulso' | 'crecimiento' | 'pro';
/** Todo lo que puede decir `cuenta/estado.plan`. `demostracion` no se vende. */
export type IdPlan = IdPlanVendible | 'demostracion';

/** Lo que se copia a la cuenta al asignar un plan, y lo que el servidor hace cumplir. */
export interface Limites {
  /** Conversaciones incluidas por mes (bloques de 25 respuestas en 24 h, `atencion.ts`). */
  conversaciones: number;
  /** Productos del catálogo del comercio. */
  productos: number;
  /** Agendas (calendarios de Google) conectadas. */
  agendas: number;
}

export interface Plan extends Limites {
  nombre: string;
  /** La lista se denomina en dólares; se cobra en bolivianos al TCO del BCB (`CLAUDE.md` §3). */
  precioUsd: number;
}

/**
 * VERSIÓN DEL CATÁLOGO: la fecha del último cambio de algún número de este
 * archivo. Viaja a la cuenta como `catalogoPlanes` junto con la copia de los
 * límites, para saber más tarde con qué catálogo se asignó cada plan. Se cambia
 * CADA VEZ que cambia un número de abajo.
 */
export const CATALOGO_PLANES = '2026-09-15';

/**
 * Impulso 25/100, Crecimiento 50/220, Pro 90/500 (`Analisis/21`, adoptado el
 * 08/09). Productos 20/100/500 (decisión de Andres, 15/09, como promete el
 * sitio). Agendas 1/5/10 (`Analisis/24`: el techo lo pone la latencia del
 * candado, que consulta cada calendario; no prometer más sin el arreglo del §4).
 */
export const PLANES: Readonly<Record<IdPlanVendible, Readonly<Plan>>> = {
  impulso: { nombre: 'Impulso', precioUsd: 25, conversaciones: 100, productos: 20, agendas: 1 },
  crecimiento: { nombre: 'Crecimiento', precioUsd: 50, conversaciones: 220, productos: 100, agendas: 5 },
  pro: { nombre: 'Pro', precioUsd: 90, conversaciones: 500, productos: 500, agendas: 10 },
};

/**
 * PLAN INTERNO DE LOS DEMOS y de la propia NovuChat. No se vende ni se muestra
 * en ninguna lista de precios: tiene los límites de Pro, para que un demo no se
 * quede corto el día de una presentación, y precio cero. Está fuera de `PLANES`
 * a propósito: quien recorra `PLANES` para pintar una oferta no lo encuentra.
 */
export const PLAN_DEMOSTRACION: Readonly<Plan> = {
  nombre: 'Demostración',
  precioUsd: 0,
  conversaciones: PLANES.pro.conversaciones,
  productos: PLANES.pro.productos,
  agendas: PLANES.pro.agendas,
};

/** Todo lo que se puede asignar a una cuenta: los que se venden más el interno. */
export const PLANES_ASIGNABLES: Readonly<Record<IdPlan, Readonly<Plan>>> = {
  ...PLANES,
  demostracion: PLAN_DEMOSTRACION,
};

/**
 * EL RESPALDO ES EL PLAN MÁS CHICO. Un comercio sin copia de límites y con un
 * plan que no está en el catálogo (el `'basico'` que escribían las altas viejas)
 * se trata como Impulso: ante la duda, se falla hacia el límite menor, nunca
 * hacia el mayor.
 */
export const PLAN_POR_DEFECTO: IdPlanVendible = 'impulso';

/**
 * LA BOLSA: 30 conversaciones por USD 10, que no vencen (`Analisis/23`). El
 * precio mínimo depende del bloque de 25 (`atencion.ts`): si el bloque sube,
 * hay que recalcularla. El sitio la llama «excedente»; acá, y en la consola, es
 * «bolsa» (decisión de Andres, 15/09).
 */
export const BOLSA = { conversaciones: 30, precioUsd: 10 } as const;

/** Instalación estándar, llave en mano, en dólares. */
export const INSTALACION_USD = 65;

/**
 * AVISO DE CONSUMO: fracción de las conversaciones incluidas a la que se le
 * avisa al comercio, una vez por mes. Es lo que promete el sitio («te avisamos
 * al llegar al 80 % de tu plan»). No manda ningún WhatsApp: se anota en la
 * cuenta y lo muestra la consola.
 */
export const AVISO_CONSUMO = 0.8;

/**
 * Cota de cordura de un límite copiado en una cuenta. No es una opinión
 * comercial: es un seguro contra un dato corrupto o un cero de más, que dejaría
 * a un comercio sin techo. Un límite fuera de rango se descarta y rige el del
 * plan.
 */
export const LIMITE_MAXIMO = 100_000;

// -----------------------------------------------------------------------------
// LECTURAS
// -----------------------------------------------------------------------------

/**
 * ¿Es un identificador de plan del catálogo? Se mira con `hasOwnProperty`, no
 * con `in`: `'toString' in PLANES_ASIGNABLES` es verdadero y no es un plan.
 */
export function esIdPlan(v: unknown): v is IdPlan {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLANES_ASIGNABLES, v);
}

/** Los límites de un plan del catálogo. Uno desconocido da los del más chico. */
export function limitesDe(plan: unknown): Limites {
  const p = esIdPlan(plan) ? PLANES_ASIGNABLES[plan] : PLANES[PLAN_POR_DEFECTO];
  return { conversaciones: p.conversaciones, productos: p.productos, agendas: p.agendas };
}

const limiteValido = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LIMITE_MAXIMO;

export interface LimitesDeCuenta extends Limites {
  /**
   * De dónde salieron: `cuenta` si la copia estaba completa y sana; `plan` si
   * faltaba (en todo o en parte) y el plan de la cuenta es del catálogo;
   * `respaldo` si hubo que caer en el plan más chico.
   */
  origen: 'cuenta' | 'plan' | 'respaldo';
}

/**
 * LOS LÍMITES QUE RIGEN PARA UNA CUENTA. Es la función que usa quien hace
 * cumplir un límite.
 *
 * Manda la COPIA (`cuenta.limites`), que es lo que se contrató. Sin copia —los
 * comercios dados de alta antes del 15/09— rigen los del plan, si el plan es
 * del catálogo, y si no, los de Impulso. Cada límite se decide por separado: un
 * `productos` corrupto en la copia no invalida las conversaciones.
 */
export function limitesDeCuenta(cuenta: Record<string, unknown> | null | undefined): LimitesDeCuenta {
  const delPlan = limitesDe(cuenta?.['plan']);
  const crudo = cuenta?.['limites'];
  const copia = typeof crudo === 'object' && crudo !== null ? crudo as Record<string, unknown> : {};
  const elegir = (k: keyof Limites): number => {
    const v = copia[k];
    return limiteValido(v) ? v : delPlan[k];
  };
  const completa = (['conversaciones', 'productos', 'agendas'] as const)
    .every((k) => limiteValido(copia[k]));
  return {
    conversaciones: elegir('conversaciones'),
    productos: elegir('productos'),
    agendas: elegir('agendas'),
    origen: completa ? 'cuenta' : esIdPlan(cuenta?.['plan']) ? 'plan' : 'respaldo',
  };
}

// -----------------------------------------------------------------------------
// EL AVISO DE CONSUMO
// -----------------------------------------------------------------------------

/** Lo que se anota en `cuenta/estado.avisoConsumo` (más `en`, que pone el servidor). */
export interface AvisoConsumo {
  /** Mes del aviso, `AAAA-MM`, el mismo período que el agregado de métricas. */
  mes: string;
  /** Fracción que disparó el aviso (`AVISO_CONSUMO` al momento de avisar). */
  umbral: number;
  /** Conversaciones del mes al avisar, contando la que lo disparó. */
  conversaciones: number;
  /** Conversaciones incluidas contra las que se midió. */
  limite: number;
}

/**
 * A partir de cuántas conversaciones se avisa. Se redondea hacia arriba, y con
 * un margen contra el error de coma flotante: el 80 % de 220 es 176, no
 * 176,00000000000003 (que redondeado hacia arriba daría 177).
 */
export function umbralDeAviso(limite: number): number {
  return Math.ceil(limite * AVISO_CONSUMO - 1e-9);
}

/** ¿Falta avisar este mes? Falso si la cuenta ya tiene el aviso del mes. */
export function avisoConsumoPendiente(
  cuenta: Record<string, unknown> | null | undefined, mes: string,
): boolean {
  const previo = cuenta?.['avisoConsumo'];
  return !(typeof previo === 'object' && previo !== null
    && (previo as Record<string, unknown>)['mes'] === mes);
}

/**
 * ¿Hay que avisar AHORA? Devuelve el aviso a anotar, o `null`.
 *
 * UNA VEZ POR MES: si la cuenta ya tiene el aviso de este mes, no se repite
 * aunque el consumo siga subiendo. Se compara con `>=` y no con `===`: si los
 * límites bajaron a mitad de mes (un cambio de plan) y el comercio ya estaba
 * por encima, el aviso sale igual con la siguiente conversación.
 */
export function avisoDeConsumo(
  cuenta: Record<string, unknown> | null | undefined,
  conversacionesDelMes: number,
  mes: string,
): AvisoConsumo | null {
  if (!avisoConsumoPendiente(cuenta, mes)) return null;
  if (typeof conversacionesDelMes !== 'number' || !Number.isFinite(conversacionesDelMes)) return null;
  const limite = limitesDeCuenta(cuenta).conversaciones;
  if (conversacionesDelMes < umbralDeAviso(limite)) return null;
  return { mes, umbral: AVISO_CONSUMO, conversaciones: Math.trunc(conversacionesDelMes), limite };
}
