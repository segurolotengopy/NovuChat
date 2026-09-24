/**
 * LO QUE LA PANTALLA «PAGAR» NECESITA SABER, SIN CALCULAR NADA PROPIO.
 *
 * Todo lo que decide un importe, un mes cubierto o una bolsa sale de
 * `functions/src/prepago.ts` a través de `lib/prepago.ts` (el mismo módulo que
 * corre en el servidor, `DISENO.md` §4undecies.4). Acá solo se arma la vista:
 * qué opciones ofrecer y cómo se lee cada una.
 *
 * POR QUÉ IMPORTA QUE NO CALCULE. El importe que el comercio ve antes de
 * apretar «Pagar» y el que sale impreso en el QR tienen que ser el mismo
 * número. Si la pantalla redondeara distinto, o tomara otro tipo de cambio, la
 * diferencia aparecería recién en el banco, con el cliente mirando. Por eso la
 * cifra de la vista previa se arma con `importeBs` y `tipoCambioVigente`, las
 * mismas funciones que usa `crearCobroInterno`, sobre el MISMO documento
 * `plataforma/tipoCambio`. Y la cifra que se muestra DESPUÉS de emitir no es
 * esta: es la que devolvió el servidor con el pago (`tcoAplicado`), que es la
 * que se factura.
 */
import {
  BOLSA, BOLSAS_MAXIMO, INSTALACION_USD, MESES_MAXIMO, PLANES,
  aplicarPago, descripcionDe, esPago, fechaEscrita, importeBs, montoUsdDe, tipoCambioVigente,
  type CuentaCruda, type Pago, type TipoCambio,
} from './prepago';
import { PLAN_POR_DEFECTO } from './planes';

export type { Pago, TipoCambio };

/** Un plan de la lista de precios. El interno de demostración no entra. */
export type PlanEnVenta = keyof typeof PLANES;

/** Los planes que se pueden comprar, en orden de precio. `demostracion` no está. */
export const PLANES_EN_VENTA: readonly PlanEnVenta[] = (Object.keys(PLANES) as PlanEnVenta[])
  .sort((a, b) => PLANES[a].precioUsd - PLANES[b].precioUsd);

/**
 * El que viene marcado al abrir la pantalla. Es `PLAN_POR_DEFECTO`, el más
 * chico, y no `PLANES_EN_VENTA[0]`: ante la duda se falla hacia el plan menor,
 * igual que el servidor, y así la pantalla no depende de que la lista esté
 * ordenada ni de que tenga al menos un elemento.
 */
export const PLAN_INICIAL: PlanEnVenta = PLAN_POR_DEFECTO;

export const MESES_POSIBLES = Array.from({ length: MESES_MAXIMO }, (_, i) => i + 1);
export const BOLSAS_POSIBLES = Array.from({ length: BOLSAS_MAXIMO }, (_, i) => i + 1);

/**
 * Lo que hay que mostrar de un pedido antes de emitirlo. `montoBs` es `null`
 * cuando no hay tipo de cambio vigente: entonces NO se inventa ninguna cifra
 * y el botón se deshabilita, porque el servidor también va a rechazar la
 * emisión («No hay tipo de cambio del día»). Mostrar un importe estimado sería
 * peor que no mostrar ninguno: el comercio decidiría sobre un número falso.
 */
export interface VistaDelPedido {
  descripcion: string;
  montoUsd: number;
  montoBs: number | null;
  tipoCambio: TipoCambio | null;
  /** Último mes que quedaría cubierto si este pago se confirma (`aaaa-mm`). */
  cubiertoHasta: string;
  /** Conversaciones de bolsa que quedarían. */
  bolsa: number;
  /** `true` si el pedido agrega la bolsa de regalo de los seis meses. */
  conRegalo: boolean;
}

export function vistaDelPedido(
  cuenta: CuentaCruda | null | undefined,
  pedido: Pago,
  tipoCambioCrudo: unknown,
  ahoraMs: number,
): VistaDelPedido | null {
  if (!esPago(pedido)) return null;
  const tipoCambio = tipoCambioVigente(tipoCambioCrudo, ahoraMs);
  const montoUsd = montoUsdDe(pedido);
  const tras = aplicarPago(cuenta, pedido, ahoraMs);
  return {
    descripcion: descripcionDe(pedido),
    montoUsd,
    montoBs: tipoCambio ? importeBs(montoUsd, tipoCambio.tco) : null,
    tipoCambio,
    cubiertoHasta: tras.cubiertoHasta,
    bolsa: tras.bolsa,
    conRegalo: pedido.tipo === 'mensualidad' && pedido.meses === MESES_MAXIMO,
  };
}

/** `aaaa-mm` escrito como lo lee una persona: «septiembre de 2026». */
export function mesEscrito(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return '—';
  // `fechaEscrita` es del módulo compartido y escribe el día también: acá se
  // toma el primero del mes y se le quita, para no repetir nombres de meses.
  return fechaEscrita(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) + 4 * 3_600_000)
    .replace(/^\d+ de /, '');
}

/** El precio de lista, para la tabla de planes. */
export const PRECIOS = { bolsa: BOLSA, instalacionUsd: INSTALACION_USD } as const;
