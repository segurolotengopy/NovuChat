/**
 * LO QUE LA PANTALLA «PAGAR» NECESITA SABER, SIN CALCULAR NADA PROPIO.
 *
 * Todo lo que decide un importe, un mes cubierto o una bolsa sale de
 * `functions/src/central/cuenta/prepago.ts` a través de `lib/prepago.ts` (el mismo módulo que
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
  BOLSA_CONVERSACIONES, BOLSA_META_INCLUIDO, BOLSA_SALIENTES, BOLSAS_MAXIMO, INSTALACION_USD, MENSAJE_BOLSA_NO_PERMITIDA,
  MESES_MAXIMO, bolsaPermitida,
  aplicarPago, descripcionDe, esPago, fechaEscrita, importeBs, modalidadDe, montoUsdDe, tipoCambioVigente,
  type CuentaCruda, type Pago, type TipoCambio,
} from './prepago';
import type { Titularidad } from './ejes';
import { PLANES, PLANES_PUBLICADOS, PLAN_POR_DEFECTO, esPlanVendible, limitesDe, limitesDeCuenta, type IdPlanVendible } from './planes';
import { porContratoDe, precioMensualDe, precioPorContratoDe, tarifaDe } from '../../../../functions/src/central/cuenta/planes';

export type { Pago, TipoCambio };

/**
 * LO QUE LA CUENTA PAGA Y RECIBE POR UN PLAN, para pintarlo (F1b). Con precio
 * por contrato, el precio es el del contrato (`precioMensualDe`, la misma
 * función con que el servidor emite el QR), no el de la lista; y las
 * conversaciones, las de la copia de la cuenta si van por contrato
 * (`porContratoDe`), que un cambio de plan conserva. Así «Pagar» y el
 * formulario de pago manual dicen lo mismo que el cobro.
 */
export interface PlanDeLaCuenta {
  nombre: string;
  precioUsd: number;
  precioPorContrato: boolean;
  conversaciones: number;
  conversacionesPorContrato: boolean;
}

export function planDeLaCuenta(cuenta: CuentaCruda | null | undefined, plan: PlanEnVenta): PlanDeLaCuenta {
  const c = (cuenta ?? null) as Record<string, unknown> | null;
  const conversacionesPorContrato = porContratoDe(c).includes('conversaciones');
  return {
    nombre: PLANES[plan].nombre,
    precioUsd: precioMensualDe(c, plan),
    precioPorContrato: precioPorContratoDe(c) !== null,
    // Sin contrato, lo que trae el plan con la TARIFA de esta cuenta
    // (`tarifaDe`): una cuenta sin campo es `meta_incluido` y ve 100 / 220 / 500,
    // no el 200 / 500 / 1.000 del catálogo estándar.
    conversaciones: conversacionesPorContrato ? limitesDeCuenta(c).conversaciones : limitesDe(plan, tarifaDe(c)).conversaciones,
    conversacionesPorContrato,
  };
}

/**
 * EL AVISO DE UN PLAN DISTINTO SOBRE UNA CUENTA CON PRECIO POR CONTRATO
 * (observación de diseño de la revisión de seguridad del #221). El contrato
 * manda sobre cualquier plan (`precioMensualDe`): cambiar el plan en Negocios
 * o cargar a mano la mensualidad de otro plan NO cambia lo que se cobra. La
 * lista de planes muestra el precio de lista, y sin este aviso el propietario
 * podía leer «Pro · USD 90» y suponer que ese sería el cobro.
 *
 * Solo dice lo que pasa y el único camino que existe para cambiarlo (la fila
 * «Precio» de Negocios, que llama a `actualizarEstadoCuenta` con
 * `precioPorContrato: null`). `null` si no hay contrato o si el plan pedido es
 * el que la cuenta ya tiene. Pagar (el comercio) no lo necesita: ahí no hay
 * selector de plan, se renueva el propio.
 */
export function avisoPrecioPorContrato(cuenta: CuentaCruda | Record<string, unknown> | null | undefined, plan: unknown): string | null {
  const c = (cuenta ?? null) as Record<string, unknown> | null;
  const contrato = precioPorContratoDe(c);
  if (contrato === null || !esPlanVendible(plan) || plan === c?.['plan']) return null;
  return `Esta cuenta tiene precio por contrato: con el plan ${PLANES[plan].nombre} se sigue cobrando USD ${contrato} `
    + `al mes, no los USD ${PLANES[plan].precioUsd} de la lista. Para cobrar el de lista, primero se quita el precio `
    + 'por contrato en la fila «Precio».';
}

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
 * ¿La cuenta está en DEMOSTRACIÓN, donde no se cobra? Con la opción B
 * (Andres, 26/09/2026) un pago ya no cambia la modalidad, y el servidor no
 * emite cobros en demostración (`crearCobroInterno`): la pantalla no ofrece
 * pagar. La modalidad la dice `modalidadDe`, la misma regla del servidor.
 */
export const cuentaEnDemostracion = (cuenta: CuentaCruda | null | undefined): boolean =>
  modalidadDe(cuenta) === 'demostracion';

/**
 * QUÉ PLAN PUEDE PAGARSE EL COMERCIO POR SU CUENTA: el que ya tiene, y nada
 * más (decisión de Andres, 26/09/2026). El cambio de plan —subir o bajar— lo
 * hace NovuChat; el servidor rechaza cualquier otro (`planQuePuedePedir`,
 * `crearCobroPrepago`). Una cuenta sin plan del catálogo no tiene qué renovar:
 * lista vacía, y la pantalla lo dice.
 *
 * `planesOfrecidos` (arriba) sigue siendo la lista del PROPIETARIO, que sí
 * cambia el plan al cargar un pago a mano (`FormularioPagoManual`).
 */
export function planesQuePuedePagar(cuenta: CuentaCruda | null | undefined): readonly PlanEnVenta[] {
  const actual = cuenta?.plan;
  return esPlanVendible(actual) ? [actual] : [];
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

// Quién le paga a Meta NO sale del plan: es la titularidad de cada número, que
// la pantalla lee de `ejesDeCuenta` (`facturaMetaAlComercio`, `web/src/central/lib/ejes.ts`).

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
  // Al precio de la CUENTA (F1b): el del contrato si tiene uno, como el QR.
  const montoUsd = montoUsdDe(pedido, cuenta ?? null);
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

/**
 * El precio de lista, para la tabla de planes. `bolsa` es la de 30 por USD 10
 * y la lee todavía `FormularioPagoManual` (zona de Plataforma, PR-4b): la
 * pantalla Pagar ya NO la usa, pide `bolsasOfrecidas` según la tarifa.
 * @deprecated `bolsa`: se quita cuando PR-4b elija la bolsa por tarifa.
 */
export const PRECIOS = { bolsa: BOLSA_META_INCLUIDO, instalacionUsd: INSTALACION_USD } as const;

/** Un tipo de pago que es una bolsa, tal como lo pide el servidor. */
export type TipoBolsa = 'bolsa' | 'bolsaConversaciones' | 'bolsaSalientes';

/** Una bolsa que se le puede ofrecer a la cuenta: qué tipo de pago es, cuánto trae y cuánto cuesta. */
export interface BolsaOfrecida {
  tipo: TipoBolsa;
  /** Qué trae cada bolsa, con su unidad. */
  unidades: number;
  unidad: 'conversaciones' | 'mensajes de seguimiento';
  precioUsd: number;
  /** El texto de la opción, para el radio. */
  etiqueta: string;
}

const BOLSAS_DEL_CATALOGO: Readonly<Record<TipoBolsa, BolsaOfrecida>> = {
  bolsa: {
    tipo: 'bolsa', unidades: BOLSA_META_INCLUIDO.conversaciones, unidad: 'conversaciones',
    precioUsd: BOLSA_META_INCLUIDO.precioUsd, etiqueta: 'Bolsa de conversaciones',
  },
  bolsaConversaciones: {
    tipo: 'bolsaConversaciones', unidades: BOLSA_CONVERSACIONES.conversaciones, unidad: 'conversaciones',
    precioUsd: BOLSA_CONVERSACIONES.precioUsd, etiqueta: 'Bolsa de conversaciones',
  },
  bolsaSalientes: {
    tipo: 'bolsaSalientes', unidades: BOLSA_SALIENTES.mensajes, unidad: 'mensajes de seguimiento',
    precioUsd: BOLSA_SALIENTES.precioUsd, etiqueta: 'Bolsa de mensajes de seguimiento',
  },
};

/**
 * LAS BOLSAS QUE ESTA CUENTA PUEDE COMPRAR, y ninguna otra. No decide la
 * pantalla: pregunta a `bolsaPermitida`, la misma función con la que el
 * servidor rechaza la bolsa que no corresponde (`crearCobroPrepago`,
 * `registrarPagoManual`). Si la pantalla ofreciera una que el servidor corta,
 * el comercio vería un botón que promete algo que no se cumple.
 *
 *  - `estandar`: la de 300 conversaciones por USD 15.
 *  - `meta_incluido` o sin campo `tarifa` (Bellido, demos): la de siempre, 30 por USD 10.
 *  - La de seguimiento, mientras `VENTA_BOLSA_SALIENTES` sea `false`, no sale;
 *    encendida, solo si algún número es del comercio (`titularidades`).
 */
export function bolsasOfrecidas(
  cuenta: CuentaCruda | Record<string, unknown> | null | undefined,
  titularidades: readonly Titularidad[] = [],
): readonly BolsaOfrecida[] {
  return (['bolsa', 'bolsaConversaciones', 'bolsaSalientes'] as const)
    .filter((tipo) => bolsaPermitida(cuenta, { tipo }, titularidades) === null)
    .map((tipo) => BOLSAS_DEL_CATALOGO[tipo]);
}

/**
 * LAS BOLSAS QUE MUESTRA LA PANTALLA. Mientras la cuenta no llegó (`null`, la
 * escucha de `cuenta/estado` todavía no respondió) NO se ofrece ninguna: el
 * respaldo de `bolsasOfrecidas` (sin tarifa = 30 por USD 10) vale para una
 * cuenta CARGADA sin el campo, no para una que aún no se leyó, porque a una
 * `estandar` se le ofrecería un instante lo que el servidor rechaza.
 */
export const bolsasParaPantalla = (
  cuenta: CuentaCruda | Record<string, unknown> | null,
  titularidades: readonly Titularidad[] = [],
): readonly BolsaOfrecida[] => (cuenta === null ? [] : bolsasOfrecidas(cuenta, titularidades));

/** Qué tipo de pago queda elegido si la bolsa elegida dejó de ofrecerse: vuelve a la mensualidad. */
export const tipoTrasCambioDeBolsas = <T extends string>(tipo: T, bolsas: readonly BolsaOfrecida[]): T | 'mensualidad' =>
  tipo !== 'mensualidad' && tipo !== 'instalacion' && !bolsas.some((b) => b.tipo === tipo) ? 'mensualidad' : tipo;

/** Los datos de una bolsa por su tipo (para el texto de «cada bolsa son…»). */
export const bolsaDe = (tipo: TipoBolsa): BolsaOfrecida => BOLSAS_DEL_CATALOGO[tipo];

/**
 * EL TEXTO DE UN RECHAZO DE BOLSA DEL SERVIDOR, o `null` si el error es otro.
 * El servidor rechaza con `permission-denied` o `failed-precondition` y
 * `details.motivo` ('tarifa' | 'titularidad' | 'no_habilitada'); el texto es
 * el fijo de `MENSAJE_BOLSA_NO_PERMITIDA`, no uno armado acá ni el genérico.
 */
export function rechazoDeBolsa(e: unknown): string | null {
  const err = e as { code?: unknown; details?: unknown } | null | undefined;
  if (err?.code !== 'functions/permission-denied' && err?.code !== 'functions/failed-precondition'
    && err?.code !== 'permission-denied' && err?.code !== 'failed-precondition') return null;
  const motivo = (err.details as { motivo?: unknown } | null | undefined)?.motivo;
  return typeof motivo === 'string' && Object.prototype.hasOwnProperty.call(MENSAJE_BOLSA_NO_PERMITIDA, motivo)
    ? MENSAJE_BOLSA_NO_PERMITIDA[motivo as keyof typeof MENSAJE_BOLSA_NO_PERMITIDA]
    : null;
}

// -----------------------------------------------------------------------------
// EL COBRO PENDIENTE, COMO LO LEE EL COMERCIO
// -----------------------------------------------------------------------------

/**
 * Lo que el comercio lee de cada estado del cobro en el banco.
 *
 * `CONFIRMADO` CON EL PAGO TODAVÍA PENDIENTE (revisión de seguridad de #212,
 * tercera vuelta, LOW 1): el banco confirmó, pero NovuChat no lo aplicó solo
 * --entró menos de lo que dice el QR, o el QR era de otro plan-- y lo tiene
 * que confirmar el propietario en Negocios. Se dice lo que pasa, sin decir que
 * el pago está acreditado (prohibición 3 de `CLAUDE.md`): lo acreditará
 * NovuChat al registrarlo.
 */
export const ESTADO_DEL_COBRO: Readonly<Record<string, string>> = {
  SIN_EMITIR: 'todavía sin QR',
  BORRADOR: 'el banco todavía no emitió el QR',
  QR_ACTIVO: 'esperando el pago',
  PAGO_DETECTADO: 'el banco detectó un pago y lo está confirmando',
  EN_REVISION: 'un pago tardío está en revisión en el banco',
  QR_SUELTO: 'NovuChat lo está revisando',
  CONFIRMADO: 'el banco confirmó el pago; NovuChat lo está registrando',
};

/**
 * ¿Se muestran el QR y el botón «Cancelar este cobro»? NO si el banco ya
 * confirmó: pagar dos veces el mismo QR no tiene sentido, y cancelar un cobro
 * cuya plata ya entró tampoco (el servidor lo rechaza igual:
 * `anularPagoPendiente`, e `imagenDePago` responde 404).
 */
export const cobroSeMuestraParaPagar = (cobroEstado: unknown): boolean => cobroEstado !== 'CONFIRMADO';

/**
 * El servidor pide volver a iniciar sesión (`unauthenticated`): pasa cuando
 * el propietario emite el cobro de OTRO plan con una sesión de más de media
 * hora (`crearCobroPrepago`, tercera vuelta de #212, LOW 3). La pantalla
 * ofrece volver a entrar con Google y repetir el pedido.
 */
export const pideVolverAEntrar = (e: unknown): boolean =>
  (e as { code?: unknown } | undefined)?.code === 'functions/unauthenticated';
