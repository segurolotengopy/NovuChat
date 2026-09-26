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
  BOLSA, BOLSAS_MAXIMO, INSTALACION_USD, MESES_MAXIMO,
  aplicarPago, descripcionDe, esPago, fechaEscrita, importeBs, montoUsdDe, tipoCambioVigente,
  type CuentaCruda, type Pago, type TipoCambio,
} from './prepago';
import { PLANES_PUBLICADOS, PLAN_POR_DEFECTO, esPlanVendible, type IdPlanVendible } from './planes';
import { facturaMetaAlComercio, type RutaWhatsApp } from './ejes';

export type { Pago, TipoCambio };

/** Un plan que se puede contratar y pagar. El interno de demostración no entra. */
export type PlanEnVenta = IdPlanVendible;

/**
 * QUÉ PLANES SE LE OFRECEN A ESTE COMERCIO, y en qué orden.
 *
 * Los TRES PUBLICADOS (`PLANES_PUBLICADOS`, en el orden del sitio) **más el
 * suyo, si el suyo no se publica**. Hoy ese caso es BYOC, que se ofrece caso
 * por caso contra un portafolio verificado y no aparece en ninguna lista de
 * precios (`Analisis/39`).
 *
 * LA SEGUNDA PARTE NO ES UNA CORTESÍA, ES CORRECCIÓN. Pagar una mensualidad
 * **fija el plan** (`aplicarPago`: `plan: pago.plan`). Si a un comercio BYOC se
 * le ofrecieran solo los tres publicados, al renovar tendría que elegir uno de
 * ellos y su renovación lo sacaría de BYOC sin que nadie lo decidiera: pasaría
 * de 2.000 conversaciones a 500, y de pagarle él a Meta a que le facture
 * NovuChat. Un cambio de modalidad no puede ser el efecto colateral de apretar
 * «Pagar».
 *
 * No se recorre `PLANES` entero justamente por esto: estar en el catálogo
 * significa «se puede pagar», no «se le ofrece a cualquiera».
 */
export function planesOfrecidos(cuenta: CuentaCruda | null | undefined): readonly PlanEnVenta[] {
  const publicados = PLANES_PUBLICADOS as readonly PlanEnVenta[];
  const actual = cuenta?.plan;
  // «Vendible» y no «del catálogo»: el interno de demostración está en el
  // catálogo asignable y no se paga. Se pregunta por el catálogo, no por el
  // nombre (`esPlanVendible`).
  return esPlanVendible(actual) && !publicados.includes(actual)
    ? [...publicados, actual]
    : publicados;
}

/**
 * El plan que viene marcado al abrir la pantalla: **el que el comercio tiene
 * hoy**, para que renovar sea apretar un botón y no una elección con
 * consecuencias. Sin plan conocido, `PLAN_POR_DEFECTO`, que es el más chico:
 * ante la duda se falla hacia el límite menor, igual que el servidor.
 */
export function planInicial(cuenta: CuentaCruda | null | undefined): PlanEnVenta {
  const actual = cuenta?.plan;
  return esPlanVendible(actual) ? actual : PLAN_POR_DEFECTO;
}

/**
 * ¿A este comercio le factura Meta el consumo directamente? Lo dice la
 * TITULARIDAD de sus números, no el plan (`Analisis/41` §4: BYOC deja de ser
 * un plan; es titularidad `comercio` más un plan). Antes lo decía
 * `PLANES[plan].pagaMeta`, y un comercio con un número propio y un plan
 * publicado se quedaba sin el aviso.
 */
export const paganEllosAMeta = (rutas: readonly RutaWhatsApp[]): boolean => facturaMetaAlComercio(rutas);

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
