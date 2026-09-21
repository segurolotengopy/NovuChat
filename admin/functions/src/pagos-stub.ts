/**
 * =============================================================================
 * STUB DE `pagos.ts` (bloque A-1) — REEMPLAZAR CUANDO A-1 ESTÉ EN `main`
 * =============================================================================
 *
 * ESTE ARCHIVO ES PROVISORIO Y ESTÁ MARCADO COMO TAL. El bloque A-2 (el cliente
 * del cobrador, `cobroPrepago.ts`) se desarrolló en paralelo con A-1 (pagos y
 * carga manual) y con A-0 (`prepago.ts`, el módulo puro). Cuando los dos estén
 * en `main`:
 *
 *   1. `cobroPrepago.ts` cambia `import … from './pagos-stub.js'` por
 *      `'./pagos.js'`, y los cálculos de período por los de `'./prepago.js'`.
 *   2. Este archivo se borra.
 *   3. `pruebas/cobro-prepago.test.ts` tiene que seguir en verde sin tocar
 *      ninguna aserción: es la prueba de que A-1 respetó la firma.
 *
 * LA FIRMA QUE A-1 TIENE QUE RESPETAR (DISENO.md §4undecies.7, «Necesita»):
 *
 *   aplicarPagoEnTransaccion(tx, refs, pago, confirmacion): ResultadoDeAplicacion
 *   camposDerivados(cuenta, corteGuardado, ahoraMs): Record<string, unknown>
 *
 * con los tipos de abajo. Las reglas del contrato, que A-2 da por hechas:
 *
 *   - `aplicarPagoEnTransaccion` es LA ÚNICA PUERTA QUE SUMA MESES O BOLSAS.
 *     Escribe, dentro de la transacción que recibe, EXACTAMENTE UNA VEZ cada
 *     uno de estos documentos: `refs.pago` (estado `confirmado`, `confirmadoPor`,
 *     `confirmadoEn`, `montoRecibidoBs`, `cubiertoHasta`, más `confirmacion.ademas.pago`),
 *     `refs.cuenta` (`periodoPagado`, `plan`/`limites`/`catalogoPlanes` si cambia
 *     el plan, `modalidad: 'prepago'` al confirmar una mensualidad, `bolsa`,
 *     `pagoPendienteId: delete`, `corte: delete`, los derivados de
 *     `camposDerivados`, más `confirmacion.ademas.cuenta`) y `refs.ficha` (el
 *     espejo `plan`, solo si cambia). NO escribe `refs.cobroPendiente`: eso es
 *     del cliente del cobrador, que lo borra en la misma transacción.
 *   - No lee nada: recibe en `pago` los datos ya leídos por el llamador
 *     (`pago.datos`, `pago.cuenta`, `pago.ficha`), porque en una transacción
 *     las lecturas van antes que las escrituras y el llamador ya leyó.
 *   - Es SÍNCRONA: encola escrituras en `tx` y devuelve el resultado. Nada de
 *     `await` adentro, para que el llamador pueda seguir escribiendo después.
 *   - Un pago que no está `pendiente` es un error del llamador: lanza. El
 *     llamador (A-2) ya lo comprobó y respondió `{ aplicado: false, ya: true }`.
 *   - `confirmacion.ademas` existe para que el llamador agregue campos a la
 *     MISMA escritura (A-2: `cobro.estado` en el pago, la confirmación
 *     encolada en la cuenta) sin escribir el documento dos veces.
 *
 * LO QUE ESTE STUB HACE DE MENOS, a propósito: no valida transiciones
 * finas, no distingue `prueba` de `prepago` en la cobertura, no conoce
 * `corteActivo` ni `modo observación`. Suma meses con la misma regla que el
 * `aplicarPago` del 08/09 (cubre el mes en curso si no estaba cubierto; si ya
 * lo estaba, el siguiente; 6 meses regalan una bolsa; tope 6), que es lo que
 * las pruebas de A-2 verifican y lo que A-0 conserva (§4undecies.3).
 */
import { FieldValue, Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { BOLSA, CATALOGO_PLANES, INSTALACION_USD, PLANES, esIdPlan, limitesDe, type IdPlanVendible } from './planes.js';

// ---------------------------------------------------------------------------
// LO QUE A-0 TRAE EN `prepago.ts` (copiado mínimo; se borra con el stub)
// ---------------------------------------------------------------------------

export const MESES_MAXIMO = 6;
export const BOLSAS_MAXIMO = 12;
export const TCO_MINIMO = 5;
export const TCO_MAXIMO = 40;
export const MONEDA_LISTA = 'USD';
export const MONEDA_COBRO = 'BOB';

/** Importe en bolivianos, redondeado al boliviano. Lanza sin TCO válido: sin TCO no se cobra. */
export function importeBs(usd: number, tco: number): number {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`importe invalido: ${usd}`);
  if (!Number.isFinite(tco) || tco < TCO_MINIMO || tco > TCO_MAXIMO) throw new Error(`tipo de cambio invalido: ${tco}`);
  return Math.round(usd * tco);
}

const CUATRO_HORAS = 4 * 3_600_000;
const PERIODO = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const esPeriodo = (v: unknown): v is string => typeof v === 'string' && PERIODO.test(v);

function partes(periodo: string): [number, number] {
  const m = PERIODO.exec(periodo);
  if (!m) throw new Error(`periodo invalido: ${periodo}`);
  return [Number(m[1]), Number(m[2])];
}
const armar = (anio: number, mes: number): string => {
  const d = new Date(Date.UTC(anio, mes - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export function sumarMeses(periodo: string, meses: number): string {
  const [a, m] = partes(periodo);
  return armar(a, m + meses);
}
/** Mes calendario (`aaaa-mm`) del instante, en hora de Bolivia (UTC−4). */
export function periodoBolivia(ms: number): string {
  const d = new Date(ms - CUATRO_HORAS);
  return armar(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
/** `aaaa-mm-dd` del instante, en hora de Bolivia. */
export function fechaBolivia(ms: number): string {
  const d = new Date(ms - CUATRO_HORAS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** Último instante del mes, en milisegundos (23:59:59 de Bolivia). */
export function finDelPeriodoMs(periodo: string): number {
  const [a, m] = partes(periodo);
  return Date.UTC(a, m, 0, 23, 59, 59) + CUATRO_HORAS;
}

export type PedidoDePago =
  | { tipo: 'mensualidad'; plan: IdPlanVendible; meses: number }
  | { tipo: 'bolsa'; cantidad: number }
  | { tipo: 'instalacion' };

export function esPedidoDePago(v: unknown): v is PedidoDePago {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p['tipo'] === 'instalacion') return true;
  if (p['tipo'] === 'bolsa') {
    return Number.isInteger(p['cantidad']) && (p['cantidad'] as number) >= 1 && (p['cantidad'] as number) <= BOLSAS_MAXIMO;
  }
  if (p['tipo'] === 'mensualidad') {
    return esIdPlan(p['plan']) && p['plan'] !== 'demostracion'
      && Number.isInteger(p['meses']) && (p['meses'] as number) >= 1 && (p['meses'] as number) <= MESES_MAXIMO;
  }
  return false;
}

/** Lo que cuesta, EN DÓLARES. El importe en bolivianos es derivado. */
export function montoUsdDe(pedido: PedidoDePago): number {
  switch (pedido.tipo) {
    case 'mensualidad': return PLANES[pedido.plan].precioUsd * pedido.meses;
    case 'bolsa': return BOLSA.precioUsd * pedido.cantidad;
    case 'instalacion': return INSTALACION_USD;
  }
}

/** «Crecimiento · 3 meses», para el historial del comercio. */
export function descripcionDe(pedido: PedidoDePago): string {
  switch (pedido.tipo) {
    case 'mensualidad':
      return `${PLANES[pedido.plan].nombre} · ${pedido.meses === 1 ? '1 mes' : `${pedido.meses} meses`}`;
    case 'bolsa':
      return pedido.cantidad === 1
        ? `Bolsa de ${BOLSA.conversaciones} conversaciones`
        : `${pedido.cantidad} bolsas de ${BOLSA.conversaciones} conversaciones`;
    case 'instalacion':
      return 'Instalación';
  }
}

/**
 * El concepto que ve el pagador en su app bancaria (docs/10 §4.1). Va sin el
 * nombre del comercio y sin datos de ninguna persona: «NovuChat · Pro · 3 meses».
 */
export function conceptoDe(pedido: PedidoDePago): string {
  switch (pedido.tipo) {
    case 'mensualidad': return `NovuChat · ${PLANES[pedido.plan].nombre} · ${pedido.meses} ${pedido.meses === 1 ? 'mes' : 'meses'}`;
    case 'bolsa': return `NovuChat · Bolsa x ${pedido.cantidad}`;
    case 'instalacion': return 'NovuChat · Instalacion';
  }
}

// ---------------------------------------------------------------------------
// TIPO DE CAMBIO DEL DÍA (A-1 lo trae en `tipoCambio.ts`)
// ---------------------------------------------------------------------------

export interface TipoCambioDelDia { tco: number; fecha: string; fuente: string }
export class SinTipoDeCambio extends Error {
  constructor(motivo: string) { super(`sin tipo de cambio del dia: ${motivo}`); this.name = 'SinTipoDeCambio'; }
}
/** Días de tolerancia: el BCB no publica los fines de semana ni feriados. */
export const TCO_DIAS_MAXIMO = 4;

/** Lee `plataforma/tipoCambio { tco, fecha, fuente }`; lanza si falta o es viejo. */
export function tipoCambioDelDia(datos: Record<string, unknown> | undefined, ahoraMs: number): TipoCambioDelDia {
  const tco = datos?.['tco']; const fecha = datos?.['fecha']; const fuente = datos?.['fuente'];
  if (typeof tco !== 'number' || !Number.isFinite(tco) || tco < TCO_MINIMO || tco > TCO_MAXIMO) throw new SinTipoDeCambio('tco ausente o fuera de rango');
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new SinTipoDeCambio('fecha ausente');
  const dia = Date.parse(`${fecha}T00:00:00Z`) + CUATRO_HORAS;
  if (!Number.isFinite(dia) || dia > ahoraMs + 86_400_000) throw new SinTipoDeCambio('fecha futura');
  if (ahoraMs - dia > (TCO_DIAS_MAXIMO + 1) * 86_400_000) throw new SinTipoDeCambio(`fecha de mas de ${TCO_DIAS_MAXIMO} dias`);
  return { tco, fecha, fuente: typeof fuente === 'string' && fuente ? fuente : 'BCB' };
}

// ---------------------------------------------------------------------------
// LA PUERTA QUE A-1 IMPLEMENTA
// ---------------------------------------------------------------------------

export interface RefsDePago {
  pago: DocumentReference;
  cuenta: DocumentReference;
  ficha: DocumentReference;
  /** `/cobrosPendientes/{pagoId}`. A-1 no lo escribe; lo borra A-2. */
  cobroPendiente: DocumentReference;
}

/** El pago y su contexto, ya leídos por el llamador dentro de la misma transacción. */
export interface PagoAConfirmar {
  id: string;
  datos: Record<string, unknown>;
  cuenta: Record<string, unknown>;
  ficha: Record<string, unknown>;
}

export type Confirmacion =
  | {
    origen: 'banco';
    cobroId: string;
    riel: string | null;
    confirmadoPorCobrador: 'automatico' | 'revision-manual';
    avisoId?: string;
    montoRecibidoBs: number;
    confirmadoEn: Timestamp;
    ahoraMs: number;
    ademas?: { pago?: Record<string, unknown>; cuenta?: Record<string, unknown> };
  }
  | {
    origen: 'propietario';
    uid: string;
    montoRecibidoBs: number;
    motivoDiferencia?: string;
    confirmadoEn: Timestamp;
    ahoraMs: number;
    ademas?: { pago?: Record<string, unknown>; cuenta?: Record<string, unknown> };
  };

export interface ResultadoDeAplicacion {
  periodoPagado: string;
  cubiertoHasta: string;
  bolsa: number;
  plan: string;
  modalidad: string;
  /** Si la cuenta tenía un corte APLICADO (no observado): el llamador escribe `reanudacion_servicio`. */
  corteEstabaAplicado: boolean;
}

export interface PuertaDePagos {
  aplicarPagoEnTransaccion(tx: Transaction, refs: RefsDePago, pago: PagoAConfirmar, confirmacion: Confirmacion): ResultadoDeAplicacion;
  camposDerivados(cuenta: Record<string, unknown>, corteGuardado: Record<string, unknown> | null, ahoraMs: number): Record<string, unknown>;
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Derivados de `cuenta/estado` (§4undecies.2): nunca se escriben a mano. El
 * stub calcula los cuatro que la consola ya pinta con los mismos nombres.
 */
export function camposDerivados(
  cuenta: Record<string, unknown>, corteGuardado: Record<string, unknown> | null, ahoraMs: number,
): Record<string, unknown> {
  const plan = texto(cuenta['plan']);
  const modalidad = texto(cuenta['modalidad']);
  const demostracion = !modalidad || modalidad === 'demostracion' || plan === 'demostracion';
  const periodoPagado = esPeriodo(cuenta['periodoPagado']) ? cuenta['periodoPagado'] : '';
  const actual = periodoBolivia(ahoraMs);
  let estadoPago: 'al_dia' | 'pendiente' | 'vencido' | 'sin_cargo';
  if (demostracion) estadoPago = 'sin_cargo';
  else if (periodoPagado >= actual) estadoPago = typeof cuenta['pagoPendienteId'] === 'string' ? 'pendiente' : 'al_dia';
  else if (corteGuardado?.['motivo'] === 'sin_pago' && corteGuardado?.['aplicado'] === true) estadoPago = 'vencido';
  else estadoPago = 'pendiente';
  const precio = esIdPlan(plan) && plan !== 'demostracion' ? PLANES[plan].precioUsd : 0;
  return {
    estadoPago,
    proximoVencimiento: periodoPagado ? Timestamp.fromMillis(finDelPeriodoMs(periodoPagado)) : FieldValue.delete(),
    montoMensual: precio,
    moneda: MONEDA_LISTA,
  };
}

/**
 * Aplica un pago dentro de la transacción del llamador. Ver la cabecera: una
 * escritura por documento, sin lecturas, síncrona, y lanza si el pago no
 * está `pendiente`.
 */
export function aplicarPagoEnTransaccion(
  tx: Transaction, refs: RefsDePago, pago: PagoAConfirmar, confirmacion: Confirmacion,
): ResultadoDeAplicacion {
  const d = pago.datos;
  if (d['estado'] !== 'pendiente') throw new Error(`el pago ${pago.id} no está pendiente: ${String(d['estado'])}`);

  const cuenta = pago.cuenta;
  const actual = periodoBolivia(confirmacion.ahoraMs);
  const periodoPagado = esPeriodo(cuenta['periodoPagado']) ? cuenta['periodoPagado'] : '';
  const modalidadAntes = texto(cuenta['modalidad']);
  const planAntes = texto(cuenta['plan']);
  const bolsaAntes = typeof cuenta['bolsa'] === 'number' && Number.isFinite(cuenta['bolsa']) ? Math.max(0, cuenta['bolsa']) : 0;
  const corte = typeof cuenta['corte'] === 'object' && cuenta['corte'] !== null ? cuenta['corte'] as Record<string, unknown> : null;

  let plan = planAntes; let modalidad = modalidadAntes || 'demostracion';
  let nuevoPeriodo = periodoPagado; let bolsa = bolsaAntes;

  const tipo = d['tipo'];
  if (tipo === 'mensualidad') {
    const pedido = d['plan']; const meses = d['meses'];
    if (!esIdPlan(pedido) || pedido === 'demostracion' || !Number.isInteger(meses) || (meses as number) < 1 || (meses as number) > MESES_MAXIMO) {
      throw new Error(`mensualidad invalida en el pago ${pago.id}`);
    }
    const cubiertoAhora = modalidad !== 'demostracion' && periodoPagado >= actual;
    const ultimoCubierto = cubiertoAhora ? periodoPagado : sumarMeses(actual, -1);
    nuevoPeriodo = sumarMeses(ultimoCubierto, meses as number);
    if ((meses as number) === MESES_MAXIMO) bolsa += BOLSA.conversaciones;
    plan = pedido; modalidad = 'prepago';
  } else if (tipo === 'bolsa') {
    const cantidad = d['cantidad'];
    if (!Number.isInteger(cantidad) || (cantidad as number) < 1) throw new Error(`bolsa invalida en el pago ${pago.id}`);
    bolsa += BOLSA.conversaciones * (cantidad as number);
    if (modalidad === 'demostracion') modalidad = 'prepago';
  } else if (tipo !== 'instalacion') {
    throw new Error(`tipo de pago desconocido en ${pago.id}: ${String(tipo)}`);
  }

  const confirmadoPor = confirmacion.origen === 'banco'
    ? {
      origen: 'banco', cobroId: confirmacion.cobroId, riel: confirmacion.riel,
      confirmadoPorCobrador: confirmacion.confirmadoPorCobrador,
      ...(confirmacion.avisoId ? { avisoId: confirmacion.avisoId } : {}),
    }
    : { origen: 'propietario', uid: confirmacion.uid };

  tx.update(refs.pago, {
    estado: 'confirmado',
    confirmadoPor,
    confirmadoEn: confirmacion.confirmadoEn,
    montoRecibidoBs: confirmacion.montoRecibidoBs,
    ...(confirmacion.origen === 'propietario' && confirmacion.motivoDiferencia ? { motivoDiferencia: confirmacion.motivoDiferencia } : {}),
    cubiertoHasta: nuevoPeriodo || null,
    actualizadoEn: confirmacion.confirmadoEn,
    ...(confirmacion.ademas?.pago ?? {}),
  });

  const cuentaNueva: Record<string, unknown> = {
    ...cuenta, plan, modalidad, periodoPagado: nuevoPeriodo, bolsa,
  };
  delete cuentaNueva['pagoPendienteId']; delete cuentaNueva['corte'];
  const escrituraCuenta: Record<string, unknown> = {
    modalidad, bolsa,
    ...(nuevoPeriodo ? { periodoPagado: nuevoPeriodo } : {}),
    pagoPendienteId: FieldValue.delete(),
    corte: FieldValue.delete(),
    ...camposDerivados(cuentaNueva, null, confirmacion.ahoraMs),
    actualizadoEn: confirmacion.confirmadoEn,
    ...(confirmacion.ademas?.cuenta ?? {}),
  };
  if (plan && plan !== planAntes && esIdPlan(plan)) {
    escrituraCuenta['plan'] = plan;
    escrituraCuenta['limites'] = limitesDe(plan);
    escrituraCuenta['catalogoPlanes'] = CATALOGO_PLANES;
    tx.set(refs.ficha, { plan }, { merge: true });
  }
  tx.set(refs.cuenta, escrituraCuenta, { merge: true });

  return {
    periodoPagado: nuevoPeriodo, cubiertoHasta: nuevoPeriodo, bolsa, plan, modalidad,
    corteEstabaAplicado: corte?.['aplicado'] === true,
  };
}

export const puertaDePagos: PuertaDePagos = { aplicarPagoEnTransaccion, camposDerivados };
