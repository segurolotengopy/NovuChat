/**
 * =============================================================================
 * LOS TRES EJES DE LA CUENTA — plan, modalidad, titularidad — y el modelo
 * =============================================================================
 *
 * ESTE MÓDULO ES PURO A PROPÓSITO, como `planes.ts`, `prepago.ts` y
 * `atencion.ts`: no importa Firebase ni lee la red. Lo usan las callables de
 * Central y de Plataforma (`cambiosOperados.ts`, `ejesDeCuenta.ts`,
 * `index.ts`), los scripts (`asignar-plan.mjs`, `asignar-numero.mjs`,
 * `migrar-ejes.mjs`) y, cuando el agente de consola lo tome, la consola. Un
 * solo criterio y varios lectores: si la consola tuviera su lista de modelos o
 * de titularidades, podría mostrar un valor que el servidor rechaza.
 *
 * LO QUE FIJA `Analisis/41` §4 (25/09/2026), y por qué son TRES ejes y no uno:
 *
 *   PLAN         qué contrató el comercio: precio en USD y el límite de cada
 *                cosa. Vive en `cuenta/estado.plan` + la copia `limites`
 *                (`planes.ts`). Desde F1 NO dice si se cobra ni quién paga Meta.
 *   MODALIDAD    la relación con el pago: demostración (nunca se corta, sin
 *                costo), prueba (un mes gratis), prepago (se cobra y se corta;
 *                la consola lo llama «Producción»). Vive en
 *                `cuenta/estado.modalidad` y la decide `prepago.ts`.
 *   TITULARIDAD  de quién es la WABA, quién paga Meta y de quién es la
 *                franquicia de 1.000 mensajes. Es POR NÚMERO
 *                (`rutasWhatsApp/{n}.titularidad`), porque un comercio puede
 *                tener un número propio y otro provisto por NovuChat, y la
 *                franquicia de Meta es por número.
 *
 * Hasta el 25/09 los tres estaban mezclados en el plan: `plan: 'demostracion'`
 * decidía la modalidad y `byoc.pagaMeta` decidía la titularidad. Mezclarlos
 * obligaba a mentir: un demo con los límites de Impulso tenía que decir «Pro»,
 * y un comercio con su propia WABA pero con 100 conversaciones tenía que decir
 * «BYOC». Separados, cada eje se asigna solo y se muestra solo.
 *
 * Y UN CUARTO DATO, QUE NO ES UN EJE: el MODELO DE IA por tenant
 * (`tenants/{t}.modelo`). Es una decisión de NovuChat, no del comercio
 * (`Analisis/39`: el tope de BYOC se fijó contra Gemini; con Haiku 4.5 el
 * equilibrio cae a 1.542 conversaciones y con Sonnet 5 a 771). Lo escribe solo
 * Plataforma. En F1 el flujo todavía no lo consume: existe para que se pueda
 * COMPROBAR contra qué modelo se fijó un plan, en vez de suponerlo.
 *
 * Y UN LÍMITE QUE NO ES DE NINGÚN MÓDULO: los CAMBIOS DE CONFIGURACIÓN QUE
 * NOVUCHAT OPERA por el comercio al mes (`cambiosIncluidos`, `planes.ts`). Ya
 * se vendió («hasta 4 al mes», `Analisis/40` §5.2) y nadie lo contaba. Acá
 * está la aritmética; la callable que cuenta y NIEGA es
 * `central/cambiosOperados.ts`.
 */
import { limitesDeCuenta } from '../planes.js';
import { mesBolivia, modalidadDe, type CuentaCruda } from '../prepago.js';

// -----------------------------------------------------------------------------
// TITULARIDAD DEL CANAL — por número
// -----------------------------------------------------------------------------

/**
 * `novuchat`: la WABA, la tarjeta y la franquicia son de NovuChat, y el
 * consumo de Meta entra en el precio del plan. `comercio`: el comercio trae su
 * portafolio verificado, su número y su tarjeta, y Meta le factura a él
 * (`Analisis/39`; lo que antes se llamaba BYOC como plan).
 */
export const TITULARIDADES = ['novuchat', 'comercio'] as const;
export type Titularidad = (typeof TITULARIDADES)[number];

export const esTitularidad = (v: unknown): v is Titularidad =>
  typeof v === 'string' && (TITULARIDADES as readonly string[]).includes(v);

/**
 * SIN TITULARIDAD, ES DE NOVUCHAT. Es lo que son todos los números dados de
 * alta antes de F1 salvo los BYOC, y es el lado seguro: decir que el comercio
 * paga Meta cuando no lo hace es presentar un cobro como algo que no es.
 */
export const TITULARIDAD_POR_DEFECTO: Titularidad = 'novuchat';

/** La titularidad que rige para una ruta (`rutasWhatsApp/{n}`). */
export function titularidadDe(ruta: Record<string, unknown> | null | undefined): Titularidad {
  const t = ruta?.['titularidad'];
  return esTitularidad(t) ? t : TITULARIDAD_POR_DEFECTO;
}

// -----------------------------------------------------------------------------
// MODELO DE IA — por tenant, lo elige NovuChat
// -----------------------------------------------------------------------------

/**
 * LISTA CERRADA. `gemini-3.5-flash-lite` es lo que corre hoy en los ocho JSON
 * de `Flujos/` (`Analisis/39` §2, verificado el 25/09/2026). Los dos de
 * Claude son los que `Analisis/39` evaluó y contra los que hay que rehacer la
 * cuenta de BYOC antes de asignarlos; están acá para que un `modelo` que se
 * escriba sea uno cuyo costo ya se midió, no un nombre suelto. Agregar uno es
 * agregar su fila de costo en `Analisis/39` primero.
 */
export const MODELOS = ['gemini-3.5-flash-lite', 'claude-haiku-4-5', 'claude-sonnet-5'] as const;
export type Modelo = (typeof MODELOS)[number];

export const esModelo = (v: unknown): v is Modelo =>
  typeof v === 'string' && (MODELOS as readonly string[]).includes(v);

/** Lo que corre en todos los flujos hoy, y lo que recibe un tenant sin `modelo`. */
export const MODELO_POR_DEFECTO: Modelo = 'gemini-3.5-flash-lite';

/** El modelo que rige para una ficha (`tenants/{t}`). */
export function modeloDe(ficha: Record<string, unknown> | null | undefined): Modelo {
  const m = ficha?.['modelo'];
  return esModelo(m) ? m : MODELO_POR_DEFECTO;
}

// -----------------------------------------------------------------------------
// CAMBIOS OPERADOS POR NOVUCHAT — el contador del mes
// -----------------------------------------------------------------------------

/**
 * EL MES ES EL CALENDARIO DE BOLIVIA (`mesBolivia`), no el mes UTC de las
 * métricas. Los cambios incluidos son una cláusula del contrato («al mes»), y
 * el contrato habla en el calendario del comercio; el agregado de métricas
 * usa UTC por herencia de la ingesta y `planes.ts` documenta por qué no se
 * mezclan las dos zonas.
 */
export function mesDeCambios(ahoraMs: number): string {
  return mesBolivia(ahoraMs);
}

export interface CambiosDelMes {
  /** `aaaa-mm` en Bolivia. */
  mes: string;
  /** Cambios ya registrados en el mes (`cuenta/estado.cambios.{mes}`). */
  usados: number;
  /** Los incluidos por la copia de la cuenta o por el plan. */
  incluidos: number;
  /**
   * `true` en modalidad demostración: un demo de NovuChat no tiene contrato
   * que agotar, igual que no tiene conversaciones que agotar
   * (`estadoDeServicio`: `disponibles: Infinity`). Se cuenta igual, para
   * saber cuánto trabajo lleva un demo; no se niega nunca.
   */
  ilimitado: boolean;
  /** Los que quedan; `Infinity` si es ilimitado. */
  restantes: number;
  /** ¿Se puede registrar UNO más sin forzar? */
  permitido: boolean;
}

const entero = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;

/** Los cambios ya registrados en un mes, leídos de `cuenta/estado.cambios`. */
export function cambiosUsadosEn(cuenta: Record<string, unknown> | null | undefined, mes: string): number {
  const c = cuenta?.['cambios'];
  if (typeof c !== 'object' || c === null) return 0;
  return entero((c as Record<string, unknown>)[mes]);
}

/**
 * La situación del contador en un instante. PURA: es lo que
 * `registrarCambioOperado` aplica dentro de su transacción, y lo que la
 * consola puede mostrar sin calcular nada distinto.
 */
export function cambiosDelMes(cuenta: Record<string, unknown> | null | undefined, ahoraMs: number): CambiosDelMes {
  const mes = mesDeCambios(ahoraMs);
  const usados = cambiosUsadosEn(cuenta, mes);
  const incluidos = limitesDeCuenta(cuenta).cambiosIncluidos;
  const ilimitado = modalidadDe(cuenta as CuentaCruda | null | undefined) === 'demostracion';
  const restantes = ilimitado ? Number.POSITIVE_INFINITY : Math.max(0, incluidos - usados);
  return { mes, usados, incluidos, ilimitado, restantes, permitido: ilimitado || usados < incluidos };
}
