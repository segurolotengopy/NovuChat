/**
 * =============================================================================
 * LO QUE CUESTA ATENDER — la factura de Meta, antes de que llegue
 * =============================================================================
 *
 * POR QUÉ EXISTE. Desde el 1 de octubre de 2026 Meta cobra cada respuesta del
 * asistente, y **Meta es el 94 % de lo que cuesta el servicio** (`CLAUDE.md`,
 * Base comercial §1). Hasta ahora la consola mostraba conversaciones, que es lo
 * que se le factura al comercio, y no mostraba mensajes, que es lo que nos
 * factura Meta. Son dos números distintos y el segundo es el que se paga.
 *
 * LA CIFRA QUE IMPORTA ES UNA: **cuántos mensajes lleva enviados el número este
 * mes, contra los 1.000 gratis**. Por debajo de mil, atender no cuesta nada; por
 * encima, cada mensaje cuesta. Un comercio que va en 900 el día 20 va a pagar;
 * uno que va en 300 no. Sin ese número, la primera noticia es la factura.
 *
 * ESTE MÓDULO ES PURO. Recibe contadores y devuelve cuentas. Nada de Firestore,
 * nada de red: sobre esto se decide si hay que hablar con un cliente, y una
 * cuenta que no se puede probar mes por mes no sirve para eso.
 *
 * LAS TARIFAS SON DATOS, NO OPINIONES. Salen de las hojas oficiales de Meta
 * vigentes desde el 1 de julio de 2026, mercado «Rest of Latin America», que es
 * donde cae Bolivia. Meta puede cambiarlas el 1 de enero, abril, julio u
 * octubre con aviso previo: cuando cambien, se cambian ACÁ y en ningún otro
 * lado. Ver `Analisis/14-costo-por-conversacion-y-precios.md`.
 */

/** USD por mensaje de SERVICIO (una respuesta del asistente), desde el 01/10/2026. */
export const USD_POR_MENSAJE_SERVICIO = 0.0113;

/** USD por mensaje de UTILIDAD (el recordatorio, que va por plantilla). */
export const USD_POR_MENSAJE_UTILIDAD = 0.0113;

/**
 * USD por mensaje de MARKETING (una difusión).
 *
 * Está acá para que nadie lo descubra tarde: una difusión a 1.000 contactos
 * cuesta 74 dólares, **más que cualquiera de los planes**. Si alguna vez se
 * ofrece difusión masiva, tiene que ser aparte y por paquete.
 */
export const USD_POR_MENSAJE_MARKETING = 0.0740;

/**
 * Mensajes de servicio gratis por NÚMERO DE EMPRESA y por MES. No se acumulan
 * de un mes al siguiente. Cada comercio tiene su número, así que tiene los
 * suyos: es la razón por la que un comercio con dos flujos paga menos, no más.
 */
export const FRANQUICIA_MENSUAL = 1000;

/** Fecha desde la cual Meta cobra los mensajes de servicio. */
export const DESDE = '2026-10-01';

/** ¿Ya rige el cobro? Antes del 1 de octubre los mensajes de servicio son gratis. */
export function seCobra(periodo: string): boolean {
  return periodo >= DESDE.slice(0, 7);
}

export interface ConsumoDelMes {
  /** Mensajes que el asistente ENVIÓ este mes. Es lo que Meta cuenta. */
  salientes: number;
  /** Conversaciones abiertas este mes (ventanas de 24 h). Es lo que se factura. */
  conversaciones: number;
}

export interface Proyeccion {
  salientes: number;
  conversaciones: number;
  /** Mensajes de la franquicia todavía sin usar. Cero si ya se agotó. */
  franquiciaRestante: number;
  /** Mensajes por encima de la franquicia: los que se pagan. */
  facturables: number;
  costoUsd: number;
  /** Qué porcentaje de la franquicia se lleva consumido (0 a 100, o más). */
  porcentajeFranquicia: number;
  /** Mensajes por conversación en lo que va del mes. `null` sin conversaciones. */
  mensajesPorConversacion: number | null;
}

/**
 * Cuánto va a cobrar Meta por lo que ya se envió este mes.
 *
 * NO PROYECTA HACIA ADELANTE a propósito. Estimar el cierre de mes exige
 * suponer un ritmo, y una suposición metida en una cifra de dinero se lee como
 * un hecho. Acá está lo ya ocurrido, que es indiscutible; quien quiera estimar
 * el cierre tiene el día del mes a la vista.
 */
export function proyectar(consumo: ConsumoDelMes, periodo: string): Proyeccion {
  const salientes = Math.max(0, Math.trunc(consumo.salientes));
  const conversaciones = Math.max(0, Math.trunc(consumo.conversaciones));
  const franquicia = seCobra(periodo) ? FRANQUICIA_MENSUAL : Number.POSITIVE_INFINITY;
  const facturables = Math.max(0, salientes - (seCobra(periodo) ? FRANQUICIA_MENSUAL : salientes));

  return {
    salientes,
    conversaciones,
    franquiciaRestante: Number.isFinite(franquicia)
      ? Math.max(0, FRANQUICIA_MENSUAL - salientes) : Number.POSITIVE_INFINITY,
    facturables,
    costoUsd: Math.round(facturables * USD_POR_MENSAJE_SERVICIO * 10000) / 10000,
    porcentajeFranquicia: Math.round((salientes / FRANQUICIA_MENSUAL) * 1000) / 10,
    mensajesPorConversacion: conversaciones > 0
      ? Math.round((salientes / conversaciones) * 10) / 10
      : null,
  };
}

/**
 * LOS TRAMOS DE LA DISTRIBUCIÓN DE MENSAJES POR CONVERSACIÓN.
 *
 * POR QUÉ UNA DISTRIBUCIÓN Y NO UN PROMEDIO. El promedio esconde justamente lo
 * que cuesta. Diez conversaciones de 4 mensajes y una de 40 dan un promedio de
 * 7, que parece sano; lo que se paga es la de 40. `Analisis/16` lo llama «la
 * cola» y dice que pesa más que el tope, y que **nadie la tiene medida**. Estos
 * tramos son para medirla.
 *
 * El último tramo es el que toca el tope: si crece, o el tope está bajo para
 * ese negocio, o hay conversaciones que se atascan y conviene mirarlas.
 */
export const TRAMOS = [
  { clave: 't1_2', desde: 1, hasta: 2 },
  { clave: 't3_5', desde: 3, hasta: 5 },
  { clave: 't6_10', desde: 6, hasta: 10 },
  { clave: 't11_15', desde: 11, hasta: 15 },
  { clave: 't16_20', desde: 16, hasta: 20 },
  { clave: 't21_25', desde: 21, hasta: 25 },
  { clave: 't26_mas', desde: 26, hasta: Number.POSITIVE_INFINITY },
] as const;

export type TramoClave = (typeof TRAMOS)[number]['clave'];

/** En qué tramo cae una conversación que tuvo `mensajes` respuestas. */
export function tramoDe(mensajes: number): TramoClave | null {
  const n = Math.trunc(mensajes);
  if (!Number.isFinite(n) || n < 1) return null;   // sin respuestas: no es un tramo
  return (TRAMOS.find((t) => n >= t.desde && n <= t.hasta)?.clave) ?? 't26_mas';
}

export interface Distribucion {
  tramos: { clave: TramoClave; desde: number; hasta: number; cuenta: number; porcentaje: number }[];
  total: number;
  /** Conversaciones de más de 10 respuestas: la cola que decide el costo. */
  cola: number;
  porcentajeCola: number;
}

/** Arma la distribución legible a partir de los contadores guardados. */
export function distribucionDe(guardado: Record<string, unknown> | undefined): Distribucion {
  const cuenta = (c: string): number => {
    const v = guardado?.[c];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
  };
  const total = TRAMOS.reduce((n, t) => n + cuenta(t.clave), 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  const cola = TRAMOS.filter((t) => t.desde > 10).reduce((n, t) => n + cuenta(t.clave), 0);

  return {
    tramos: TRAMOS.map((t) => ({
      clave: t.clave, desde: t.desde, hasta: t.hasta,
      cuenta: cuenta(t.clave), porcentaje: pct(cuenta(t.clave)),
    })),
    total,
    cola,
    porcentajeCola: pct(cola),
  };
}
