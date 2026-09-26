/**
 * =============================================================================
 * PAGOS DEL PREPAGO — la colección `/tenants/{t}/pagos`, la puerta que suma
 * meses, y la carga manual del propietario (bloque A-1, `DISENO.md` §4undecies)
 * =============================================================================
 *
 * LO QUE ESTE MÓDULO GARANTIZA, y dónde:
 *
 *  1. SOLO DOS COSAS CONFIRMAN UN PAGO (decisión 1 del frente): el banco, por
 *     la consulta autenticada al cobrador (A-2, `cobroPrepago.ts`), o EL
 *     PROPIETARIO cargándolo con evidencia y auditoría (`registrarPagoManual`,
 *     acá). No existe `origen: 'comprobante'` ni `'webhook'`: un comprobante
 *     que manda un cliente es una imagen, y una imagen se edita.
 *  2. `aplicarPagoEnTransaccion` ES LA ÚNICA PUERTA QUE SUMA MESES O BOLSAS.
 *     A-2 la llama dentro de su transacción con el estado del cobrador ya
 *     verificado; `registrarPagoManual` usa la misma aritmética
 *     (`aplicacionDe`) y escribe el pago NACIDO confirmado: nunca pasa por
 *     `pendiente`. Los dos caminos terminan en `aplicarPago` de `prepago.ts`,
 *     que es puro y está probado mes por mes.
 *  3. NADIE ESCRIBE UN PAGO DESDE EL NAVEGADOR, ni el propietario
 *     (`firestore.rules`, `/pagos`: `create, update, delete: if false`). Si
 *     pudiera, no habría auditoría de quién confirmó qué. Las puertas son
 *     estas callables y las de A-2, todas con el SDK Admin.
 *  4. UN SOLO PENDIENTE POR CUENTA (decisión 8). La carga manual ANULA el QR
 *     vivo antes de cargar, o no carga: si el cobrador dice que ese QR ya se
 *     pagó, se aplica el del banco y el manual se rechaza. Nunca dos pagos
 *     vivos por el mismo mes. La anulación en el cobrador es una INYECCIÓN
 *     (`Deps.anular`) que A-2 enchufa con `anularCobroVivo`; sin ella, un
 *     pendiente con QR emitido ABORTA la carga (nunca se carga un manual
 *     encima de un QR vivo que no se pudo anular).
 *  5. SIN TCO NO SE COBRA. El manual trae `tcoAplicado`, `tcoFuente` y
 *     `tcoFecha` declarados por el propietario (la fuente es lo que él diga:
 *     «BCB», «BCB del 18/09»); `importeBs` lanza fuera de 5..40. Y si lo que
 *     entró no es lo de la lista, `motivoDiferencia` es obligatorio: un
 *     descuento manual tiene nombre y firma.
 *  6. LA EVIDENCIA VIVE EN STORAGE, no en el chat: obligatoria en
 *     transferencia, `tenants/{t}/pagos/{pagoId}/evidencia.(jpg|png|pdf)`,
 *     subida por el propietario bajo `storage.rules`. Antes de registrar, el
 *     servidor COMPRUEBA CON EL SDK ADMIN que el objeto existe: una ruta
 *     declarada no es una evidencia. Se guardan su generación y su hash
 *     (`evidenciaMeta`), y una vez registrado el pago las reglas de Storage
 *     no dejan reemplazarla.
 *  7. `cuenta/estado` SE DERIVA (§4undecies.2): `estadoPago`, `montoMensual`,
 *     `moneda` y `proximoVencimiento` los escribe `camposDerivados`, junto con
 *     cada pago; `actualizarEstadoCuenta` los RECHAZA si vienen a mano.
 *  8. TODO SE HACE CUMPLIR ACÁ, no en la pantalla (`CLAUDE.md` §7): meses ≤ 6,
 *     bolsas ≤ 12, plan del catálogo, `telefonosPago` ≤ 5 con formato, quién
 *     puede qué. Cada límite tiene su prueba negativa en `pruebas/pagos.test.ts`.
 *
 * EL IDENTIFICADOR DEL PAGO es opaco, 22 caracteres de `base64url` (128 bits),
 * y es también la referencia externa que viaja al cobrador (§4undecies.1). En
 * el manual LO ELIGE LA CONSOLA (con `crypto.getRandomValues`), una vez por
 * formulario: es la clave de idempotencia de los reintentos y, con evidencia,
 * la carpeta donde se subió ANTES; el servidor exige la forma y `tx.create`,
 * que falla si ya existe. Un id al azar del navegador es
 * tan opaco como uno del servidor: lo que importa es que nadie lo adivine y
 * que no se repita, y las dos cosas las garantiza el `create`.
 *
 * COSTO EN MENSAJES: 0. Ninguna de estas funciones manda WhatsApp.
 *
 * QUÉ NO HAY ACÁ: nada del cobrador (A-2), nada de la seña (`cobro.ts`,
 * `sena.ts`: es el comercio cobrándole a su cliente, decisión 9), ninguna
 * pantalla (A-3).
 */
import { HttpsError, onCall, type CallableOptions } from 'firebase-functions/v2/https';
import { REGION } from './region.js';
import { FieldValue, Timestamp, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomBytes } from 'node:crypto';
import { exigirAdminOPropietario, exigirPropietario, exigirSesionReciente } from './autorizacion.js';
import { registrar } from './ingesta.js';
import { RUTA_TIPO_CAMBIO, SinTipoDeCambio, tipoCambioDe, type TipoCambio } from './tipoCambio.js';
import { CATALOGO_PLANES, PLANES, copiaDeLimites, esPlanVendible, type IdPlanVendible } from './planes.js';
import {
  BOLSA, INSTALACION_USD, MONEDA_COBRO, MONEDA_LISTA, TCO_MAXIMO, TCO_MINIMO, aplicarPago, camposDerivados as derivadosDe,
  corteDe, descripcionDe, esFecha, esModalidad, esPago, estadoDeServicio, importeBs, montoUsdDe,
  type CuentaCruda, type Pago,
} from './prepago.js';

const db = () => getFirestore();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
/** `randomBytes(16).toString('base64url')`: 22 caracteres de `[A-Za-z0-9_-]`. */
export const ID_PAGO = /^[A-Za-z0-9_-]{22}$/;
/** Teléfono que puede pagar por WhatsApp: solo dígitos, con código de país. Igual que `cobranza.ts`. */
const TELEFONO = /^[0-9]{8,15}$/;
export const TELEFONOS_PAGO_MAXIMO = 5;
export const MEDIOS_MANUALES = ['efectivo', 'transferencia'] as const;
export type MedioManual = (typeof MEDIOS_MANUALES)[number];
export const ARCHIVOS_EVIDENCIA = ['evidencia.jpg', 'evidencia.png', 'evidencia.pdf'] as const;
/** Un TCO declarado de más de un mes no reconstruye ninguna factura de hoy. */
export const TCO_MANUAL_DIAS_MAXIMO = 31;
/** Tolerancia entre el TCO declarado y el de referencia antes de pedir motivo. */
const TCO_TOLERANCIA = 0.01;
/** Tope de cordura para lo recibido: diez millones de bolivianos. */
const MONTO_RECIBIDO_MAXIMO = 10_000_000;
/** El motivo más corto que explica algo; el mismo de la consola (`negocios.ts`). */
export const MOTIVO_CONFIRMACION_MINIMO = 3;

const texto = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const ultimos4 = (v: string) => v.slice(-4);
export const nuevoPagoId = (): string => randomBytes(16).toString('base64url');

// Alias para A-2, que nombró estas cosas antes de que A-0 fijara los nombres
// de `prepago.ts`: el pedido y su validación son los mismos objetos.
export type PedidoDePago = Pago;
export const esPedidoDePago = esPago;

/**
 * El concepto que ve el pagador en su app bancaria (`DISENO.md` §4undecies.5):
 * SIN nombre del comercio y sin datos de ninguna persona. «NovuChat · Pro · 3 meses».
 */
export function conceptoDe(pago: Pago): string {
  if (pago.tipo === 'instalacion') return 'NovuChat · Instalacion';
  if (pago.tipo === 'bolsa') return `NovuChat · Bolsa x ${pago.cantidad}`;
  return `NovuChat · ${PLANES[pago.plan].nombre} · ${pago.meses} ${pago.meses === 1 ? 'mes' : 'meses'}`;
}

// ---------------------------------------------------------------------------
// LOS TIPOS DEL CONTRATO CON A-2 (`pagos-stub.ts`, que este módulo reemplaza)
// ---------------------------------------------------------------------------

export interface RefsDePago {
  pago: DocumentReference;
  cuenta: DocumentReference;
  ficha: DocumentReference;
  /** `/cobrosPendientes/{pagoId}`. Acá no se escribe; lo borra el cliente del cobrador. */
  cobroPendiente: DocumentReference;
}

/** El pago y su contexto, YA LEÍDOS por el llamador dentro de la misma transacción. */
export interface PagoAConfirmar {
  id: string;
  datos: Record<string, unknown>;
  cuenta: Record<string, unknown>;
  ficha: Record<string, unknown>;
}

interface AdemasDeLaEscritura {
  ademas?: { pago?: Record<string, unknown>; cuenta?: Record<string, unknown> };
}

export type Confirmacion =
  | ({
    origen: 'banco';
    cobroId: string;
    riel: string | null;
    confirmadoPorCobrador: 'automatico' | 'revision-manual';
    avisoId?: string;
    montoRecibidoBs: number;
    confirmadoEn: Timestamp;
    ahoraMs: number;
  } & AdemasDeLaEscritura)
  | ({
    origen: 'propietario';
    uid: string;
    montoRecibidoBs: number;
    motivoDiferencia?: string;
    confirmadoEn: Timestamp;
    ahoraMs: number;
  } & AdemasDeLaEscritura);

export interface ResultadoDeAplicacion {
  periodoPagado: string;
  cubiertoHasta: string;
  bolsa: number;
  plan: string;
  modalidad: string;
  /** La cuenta tenía un corte APLICADO (no observado): el llamador escribe `reanudacion_servicio`. */
  corteEstabaAplicado: boolean;
  /**
   * Si el pago CAMBIÓ EL PLAN: la copia de límites antes y después, y lo que se
   * conservó por contrato (`copiaDeLimites`). Con el vocabulario de la
   * auditoría `cambiar_plan`, para que `pago_manual` y `pago_aplicado` digan
   * lo mismo que un cambio de plan desde Negocios (revisión de seguridad del
   * PR #212, LOW 1). `null` si el pago no cambió el plan. Opcional en el tipo
   * para no romper una puerta inyectada que no lo conozca.
   */
  cambioDeLimites?: CambioDeLimites | null;
}

/** Lo que la auditoría de un pago dice de la copia cuando el pago cambió el plan. */
export interface CambioDeLimites {
  limitesAntes: unknown;
  limitesDespues: Record<string, unknown>;
  /** Solo presente si algo se conservó por contrato. */
  conservadosPorContrato?: Record<string, number>;
}

/**
 * Los campos de la auditoría de un pago que cambió el plan, listos para
 * esparcir: vacío si no lo cambió. El mismo vocabulario que `cambiar_plan`.
 */
export function auditoriaDeLimites(c: CambioDeLimites | null | undefined): Record<string, unknown> {
  if (!c) return {};
  return {
    limitesAntes: c.limitesAntes ?? null, limitesDespues: c.limitesDespues,
    ...(c.conservadosPorContrato ? { conservadosPorContrato: c.conservadosPorContrato } : {}),
  };
}

export interface PuertaDePagos {
  aplicarPagoEnTransaccion(tx: Transaction, refs: RefsDePago, pago: PagoAConfirmar, confirmacion: Confirmacion): ResultadoDeAplicacion;
  camposDerivados(cuenta: Record<string, unknown>, corteGuardado: Record<string, unknown> | null, ahoraMs: number): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LOS DERIVADOS, listos para escribir
// ---------------------------------------------------------------------------

/**
 * Los campos de `cuenta/estado` que se DERIVAN (§4undecies.2), como se
 * escriben: `estadoPago`, `montoMensual`, `moneda` y `proximoVencimiento`
 * (Timestamp, o borrado). Envuelve `camposDerivados(estado, cuenta)` de
 * `prepago.ts`: calcula el estado del servicio con `estadoDeServicio` y le
 * pasa la cuenta. Las conversaciones consumidas no entran: `estadoPago` habla
 * del PAGO, y `sin_conversaciones` no lo cambia.
 *
 * `corteGuardado` viene por el contrato con A-2 y no decide nada: el corte
 * NO se borra por recalcular derivados (lo borra la ingesta cuando ya no hay
 * rechazo, y `aplicarPago` al reactivar), y `estadoPago` dice `vencido`
 * cuando la cuenta debe, esté el corte aplicado u observado.
 */
/**
 * ¿El prepago gobierna ya los derivados de esta cuenta? Sí si tiene una
 * `modalidad` explícita. NO si es un comercio que todavía no se migró (sin
 * modalidad): para el módulo sería «demostración» y derivaría «Sin cargo» con
 * monto cero, y el comercio vería cambiar su estado de cuenta sin que nada
 * hubiera pasado. Hasta que la migración le dé su modalidad, sus derivados
 * no se tocan (revisión de seguridad de A-1, LOW 8).
 *
 * Hasta F1 un `plan: 'demostracion'` también gobernaba; desde el 25/09 el
 * plan no dice nada sobre el cobro (`Analisis/41` §4), y los demos reciben su
 * `modalidad: 'demostracion'` explícita con `scripts/migrar-ejes.mjs`.
 */
export function derivadosGobernados(cuenta: Record<string, unknown> | null | undefined): boolean {
  return esModalidad(cuenta?.['modalidad']);
}

export function camposDerivadosDeCuenta(
  cuenta: Record<string, unknown>,
  _corteGuardado: Record<string, unknown> | null,
  ahoraMs: number,
): Record<string, unknown> {
  if (!derivadosGobernados(cuenta)) return {};
  const c = cuenta as CuentaCruda;
  const d = derivadosDe(estadoDeServicio(c, 0, ahoraMs), c);
  return {
    estadoPago: d.estadoPago,
    montoMensual: d.montoMensual,
    moneda: d.moneda,
    proximoVencimiento: d.proximoVencimientoMs === null ? FieldValue.delete() : Timestamp.fromMillis(d.proximoVencimientoMs),
  };
}

/** El nombre con el que A-2 la llama (`puertaDePagos.camposDerivados`). */
export const camposDerivados = camposDerivadosDeCuenta;

// ---------------------------------------------------------------------------
// LA ARITMÉTICA DE APLICAR UN PAGO — una sola, para el banco y para el manual
// ---------------------------------------------------------------------------

/** Lee el pedido guardado en el documento del pago, validado como `Pago`. */
export function pagoDe(datos: Record<string, unknown>): Pago | null {
  const tipo = datos['tipo'];
  const candidato: Record<string, unknown> = tipo === 'mensualidad'
    ? { tipo, plan: datos['plan'], meses: datos['meses'] }
    : tipo === 'bolsa' ? { tipo, cantidad: datos['cantidad'] }
    : { tipo };
  return esPago(candidato) ? candidato : null;
}

export interface Aplicacion {
  /** Lo que se escribe en el documento del pago (`update`, o parte del `create` en el manual). */
  escrituraPago: Record<string, unknown>;
  /** Lo que se escribe en `cuenta/estado`, con `merge`. */
  escrituraCuenta: Record<string, unknown>;
  /** El plan nuevo para el espejo de la ficha, si cambió. */
  cambioDePlan: IdPlanVendible | null;
  resultado: ResultadoDeAplicacion;
}

/**
 * ¿El propietario autorizó el cambio de plan de este pago? Lo anota
 * `crearCobroInterno` (`cambioAutorizadoPor: uid`) cuando el QR lo pide el
 * propietario con un plan distinto del vigente (revisión de #212, LOW 2).
 */
export const cambioAutorizado = (datos: Record<string, unknown> | undefined): boolean =>
  typeof datos?.['cambioAutorizadoPor'] === 'string' && datos['cambioAutorizadoPor'].length > 0;

/**
 * LO ÚNICO QUE `confirmacion.ademas` PUEDE AGREGAR (revisión de seguridad de
 * A-1, LOW 3). `ademas` existe para que el cliente del cobrador sume a la
 * MISMA escritura lo suyo: el estado del cobro en el pago y la confirmación
 * encolada en la cuenta. Nada más: si pudiera traer `estado`, `periodoPagado`
 * o `bolsa`, la puerta que suma meses dejaría de ser una sola. Cualquier otra
 * clave lanza, y lo que sí se admite se esparce ANTES de los campos propios,
 * que siempre ganan.
 */
const ADEMAS_PERMITIDO: Readonly<Record<'pago' | 'cuenta', readonly string[]>> = {
  pago: ['cobro'],
  cuenta: ['confirmacionesPendientes'],
};

function ademasValidado(confirmacion: Confirmacion): { pago: Record<string, unknown>; cuenta: Record<string, unknown> } {
  const ademas = confirmacion.ademas ?? {};
  const salida = { pago: {} as Record<string, unknown>, cuenta: {} as Record<string, unknown> };
  for (const [destino, valor] of Object.entries(ademas)) {
    if (destino !== 'pago' && destino !== 'cuenta') throw new Error(`confirmacion.ademas.${destino} no se admite`);
    if (valor === undefined) continue;
    if (typeof valor !== 'object' || valor === null) throw new Error(`confirmacion.ademas.${destino} tiene que ser un objeto`);
    for (const clave of Object.keys(valor)) {
      if (!ADEMAS_PERMITIDO[destino].includes(clave)) {
        throw new Error(`confirmacion.ademas.${destino}.${clave} no se admite: solo ${ADEMAS_PERMITIDO[destino].join(', ')}`);
      }
    }
    salida[destino] = valor as Record<string, unknown>;
  }
  return salida;
}

/**
 * Calcula, sin escribir, lo que un pago confirmado le hace a la cuenta. PURA
 * salvo por los `FieldValue` que arma. Lanza si el pedido guardado no es un
 * `Pago` válido (un documento corrupto, no un caso de negocio) o si
 * `confirmacion.ademas` trae una clave fuera de la lista. No se exporta: la
 * puerta es `aplicarPagoEnTransaccion`, y el manual la usa desde acá adentro.
 */
/**
 * Qué hacer con `cuenta.pagoPendienteId` al aplicar (revisión de seguridad del
 * #217, guarda 2). `si_es_este` --lo de siempre, por defecto-- lo suelta SOLO
 * si apunta al pago que se aplica: si apunta a OTRO pago, puede ser un QR vivo
 * distinto, y soltarlo lo dejaría cobrable sin que la cuenta lo sepa (ni el
 * sondeo, ni «Ya hay un cobro pendiente», ni la anulación desde Pagar).
 * `siempre` es solo para el manual, que verificó EN LA MISMA transacción que
 * lo apuntado no está `pendiente` (un puntero viejo a un pago cerrado).
 */
type SoltarPendiente = 'si_es_este' | 'siempre';

function aplicacionDe(pago: PagoAConfirmar, confirmacion: Confirmacion, soltar: SoltarPendiente = 'si_es_este'): Aplicacion {
  const ademas = ademasValidado(confirmacion);
  const pedido = pagoDe(pago.datos);
  if (!pedido) throw new Error(`el pago ${ultimos4(pago.id)} no tiene un pedido válido`);
  const cuenta = pago.cuenta as CuentaCruda;
  const ahora = Timestamp.fromMillis(confirmacion.ahoraMs);
  const tras = aplicarPago(cuenta, pedido, confirmacion.ahoraMs);
  const planAntes = esPlanVendible(cuenta.plan) ? cuenta.plan : null;

  const confirmadoPor = confirmacion.origen === 'banco'
    ? {
      origen: 'banco', cobroId: confirmacion.cobroId, riel: confirmacion.riel,
      confirmadoPorCobrador: confirmacion.confirmadoPorCobrador,
      ...(confirmacion.avisoId ? { avisoId: confirmacion.avisoId } : {}),
    }
    : { origen: 'propietario', uid: confirmacion.uid };

  const escrituraPago: Record<string, unknown> = {
    ...ademas.pago,
    estado: 'confirmado',
    confirmadoPor,
    confirmadoEn: confirmacion.confirmadoEn,
    montoRecibidoBs: confirmacion.montoRecibidoBs,
    ...(confirmacion.origen === 'propietario' && confirmacion.motivoDiferencia
      ? { motivoDiferencia: confirmacion.motivoDiferencia } : {}),
    cubiertoHasta: tras.cubiertoHasta || null,
    // UN PAGO CONFIRMADO YA NO ESTÁ EN REVISIÓN (revisión de seguridad de
    // #212, tercera vuelta, LOW 2). `revision: 'plan_distinto'` lo anota el
    // cliente del cobrador cuando el banco confirmó un QR de otro plan sin
    // firma; si quedara escrito en un pago confirmado, Negocios lo seguiría
    // listando como «por resolver». Se borra solo si existe: el manual crea
    // el pago con esta escritura (`tx.create`), y ahí un borrado no se admite.
    ...(pago.datos['revision'] !== undefined ? { revision: FieldValue.delete() } : {}),
    actualizadoEn: ahora,
  };

  // SOLO UNA MENSUALIDAD FIJA EL PLAN (revisión de seguridad de #212, LOW 1).
  // `aplicarPago` devuelve para la bolsa y la instalación el plan que RIGE
  // (con el de respaldo si la cuenta no tiene uno del catálogo): compararlo
  // con el guardado le asignaba Impulso a una cuenta `basico` que compraba
  // una bolsa, sin que nadie lo decidiera.
  const cambioDePlan = pedido.tipo === 'mensualidad' && tras.plan !== planAntes ? tras.plan : null;

  // La cuenta COMO VA A QUEDAR, para derivar sobre ella: sin pendiente, sin
  // corte, con el mes pagado y la bolsa nuevos, y el plan si cambió.
  // LA MODALIDAD NO LA TOCA UN PAGO (Andres, 26/09/2026, opción B): la cambia
  // solo el propietario. Una cuenta sin modalidad (sin migrar) sigue sin ella
  // y sus derivados sin tocar (`derivadosGobernados`).
  const cuentaNueva: Record<string, unknown> = {
    ...pago.cuenta, bolsa: tras.bolsa,
    ...(cambioDePlan ? { plan: cambioDePlan } : {}),
    ...(tras.periodoPagado ? { periodoPagado: tras.periodoPagado } : {}),
  };
  const suelta = soltar === 'siempre' || pago.cuenta['pagoPendienteId'] === pago.id;
  if (suelta) delete cuentaNueva['pagoPendienteId'];
  delete cuentaNueva['corte'];

  const escrituraCuenta: Record<string, unknown> = {
    ...ademas.cuenta,
    bolsa: tras.bolsa,
    ...(tras.periodoPagado ? { periodoPagado: tras.periodoPagado } : {}),
    ...(suelta ? { pagoPendienteId: FieldValue.delete() } : {}),
    corte: FieldValue.delete(),
    ...camposDerivadosDeCuenta(cuentaNueva, null, confirmacion.ahoraMs),
    actualizadoEn: ahora,
  };

  // UN QR DEL BANCO NO CAMBIA EL PLAN SIN QUE LO HAYA AUTORIZADO EL
  // PROPIETARIO (revisión de seguridad de #212, LOW 2). El cliente del
  // cobrador (`aplicarEstadoDelCobrador`) deja en revisión un pago así antes
  // de llegar acá; esto es la red: si alguien llamara a la puerta sin pasar
  // por esa revisión, no se aplica.
  if (cambioDePlan && confirmacion.origen === 'banco' && !cambioAutorizado(pago.datos)) {
    throw new Error(`el pago ${ultimos4(pago.id)} cambiaría el plan sin autorización del propietario`);
  }
  let cambioDeLimites: CambioDeLimites | null = null;
  if (cambioDePlan) {
    escrituraCuenta['plan'] = cambioDePlan;
    // PAGAR OTRO PLAN ES CAMBIAR DE PLAN, y un cambio de plan CONSERVA lo que
    // va por contrato (`copiaDeLimites`, `planes.ts`): un comercio con 4
    // cambios al mes por contrato que se pasa de plan pagando no vuelve a los
    // del plan. El marcador `limitesPorContrato` no se toca: sigue valiendo.
    // (Si un pago debe o no conservar el contrato es una decisión de Andres
    // pendiente; hasta entonces lo conserva, y la auditoría lo dice.)
    const copia = copiaDeLimites(pago.cuenta, { plan: cambioDePlan });
    escrituraCuenta['limites'] = copia.limites;
    escrituraCuenta['catalogoPlanes'] = CATALOGO_PLANES;
    cambioDeLimites = {
      limitesAntes: pago.cuenta['limites'] ?? null, limitesDespues: copia.limites,
      ...(Object.keys(copia.conservados).length ? { conservadosPorContrato: copia.conservados as Record<string, number> } : {}),
    };
  }

  return {
    escrituraPago, escrituraCuenta, cambioDePlan,
    resultado: {
      periodoPagado: tras.periodoPagado, cubiertoHasta: tras.cubiertoHasta, bolsa: tras.bolsa,
      // El plan que QUEDA: el nuevo si una mensualidad lo cambió; si no, el
      // que la cuenta tenía (no el de respaldo con que `aplicarPago` calcula).
      plan: cambioDePlan ?? (typeof pago.cuenta['plan'] === 'string' ? pago.cuenta['plan'] : tras.plan),
      modalidad: tras.modalidad,
      corteEstabaAplicado: corteDe(cuenta)?.aplicado === true,
      cambioDeLimites,
    },
  };
}

/**
 * LA ÚNICA PUERTA QUE SUMA MESES O BOLSAS, dentro de la transacción del
 * llamador. Contrato con A-2 (`pagos-stub.ts`, cabecera):
 *
 *   - SÍNCRONA: encola escrituras en `tx` y devuelve; nada de `await`.
 *   - NO LEE: recibe en `pago` lo que el llamador ya leyó (en una transacción
 *     las lecturas van antes que las escrituras).
 *   - UNA ESCRITURA POR DOCUMENTO: `refs.pago` (update), `refs.cuenta` (set con
 *     merge) y `refs.ficha` (solo si cambia el plan). `refs.cobroPendiente` NO
 *     se toca: es del cliente del cobrador.
 *   - LANZA si el pago no está `pendiente`: es un error del llamador, que ya
 *     lo comprobó y respondió `{ aplicado: false, ya: true }`.
 *   - `confirmacion.ademas` agrega campos a LA MISMA escritura, de una lista
 *     cerrada (`ademas.pago`: solo `cobro`; `ademas.cuenta`: solo
 *     `confirmacionesPendientes`). Cualquier otra clave lanza antes de escribir.
 */
export function aplicarPagoEnTransaccion(
  tx: Transaction, refs: RefsDePago, pago: PagoAConfirmar, confirmacion: Confirmacion,
): ResultadoDeAplicacion {
  if (pago.datos['estado'] !== 'pendiente') {
    throw new Error(`el pago …${ultimos4(pago.id)} no está pendiente: ${String(pago.datos['estado'])}`);
  }
  const a = aplicacionDe(pago, confirmacion);
  tx.update(refs.pago, a.escrituraPago);
  tx.set(refs.cuenta, a.escrituraCuenta, { merge: true });
  if (a.cambioDePlan) tx.set(refs.ficha, { plan: a.cambioDePlan }, { merge: true });
  return a.resultado;
}

export const puertaDePagos: PuertaDePagos = { aplicarPagoEnTransaccion, camposDerivados: camposDerivadosDeCuenta };

// ---------------------------------------------------------------------------
// DEPENDENCIAS INYECTABLES — lo que A-2 enchufa, y lo que las pruebas reemplazan
// ---------------------------------------------------------------------------

/**
 * Qué pasó al intentar anular el pendiente. Las cuatro primeras son las de
 * `anularCobroVivo` (A-2); `qr_vivo_sin_cliente` es la de esta versión sin
 * cobrador: hay un QR emitido allá y nadie que lo anule.
 */
export type ResultadoAnulacion =
  | { resultado: 'anulado' }
  | { resultado: 'sin_cobro' }
  | { resultado: 'pagado'; estado: string }
  | { resultado: 'en_revision' }
  | { resultado: 'qr_vivo_sin_cliente'; cobroId: string | null };

export interface Deps {
  /** Anula el pendiente en el cobrador y acá. A-2: `anularCobroVivo`. */
  anular?: (tenantId: string, pagoId: string, motivo: string) => Promise<ResultadoAnulacion>;
  /** Consulta el estado en el cobrador y lo aplica. A-2: `consultarYAplicar`. */
  /** `null` si no hubo con quién consultar. */
  consultar?: (tenantId: string, pagoId: string) => Promise<unknown>;
  /** Metadatos del objeto de evidencia en Storage, o `null` si no está. Por defecto, el SDK Admin. */
  metaEvidencia?: (ruta: string) => Promise<MetaEvidencia | null>;
  ahoraMs?: () => number;
}

const auditar = (tenantId: string, accion: string, uid: string, detalle: object = {}) =>
  db().collection(`tenants/${tenantId}/auditoria`).add({ accion, uid, en: Timestamp.now(), ...detalle });

const refsDe = (tenantId: string, pagoId: string): RefsDePago => ({
  pago: db().doc(`tenants/${tenantId}/pagos/${pagoId}`),
  cuenta: db().doc(`tenants/${tenantId}/cuenta/estado`),
  ficha: db().doc(`tenants/${tenantId}`),
  cobroPendiente: db().doc(`cobrosPendientes/${pagoId}`),
});

const cobroIdDe = (datos: Record<string, unknown> | undefined): string | null => {
  const cobro = datos?.['cobro'];
  if (typeof cobro !== 'object' || cobro === null) return null;
  const id = (cobro as Record<string, unknown>)['id'];
  return typeof id === 'string' && id !== '' ? id : null;
};

/**
 * La anulación SIN cobrador: cierra acá un pendiente que nunca llegó a tener
 * un QR emitido (una reserva sin emitir, o un manual a medio camino). Si el
 * pendiente TIENE `cobro.id`, hay un QR vivo en el banco y esta función no
 * puede anularlo allá: devuelve `qr_vivo_sin_cliente` y el llamador aborta.
 * Nunca se marca `anulado` acá un pago que el banco todavía puede cobrar.
 */
/** ¿Este pago salió alguna vez hacia el cobrador? Entonces solo el cobrador lo anula. */
function pasoPorElCobrador(p: Record<string, unknown>): boolean {
  return p['medio'] === 'qr' || (typeof p['cobro'] === 'object' && p['cobro'] !== null);
}

export async function anularPendienteLocal(tenantId: string, pagoId: string, motivo: string): Promise<ResultadoAnulacion> {
  if (!ID_PAGO.test(pagoId)) return { resultado: 'sin_cobro' };
  const r = refsDe(tenantId, pagoId);
  const antes = (await r.pago.get()).data();
  if (!antes || antes['estado'] !== 'pendiente') return { resultado: 'sin_cobro' };
  // Un pago que pasó por el cobrador (medio `qr`, o con su objeto `cobro`) NO se
  // anula acá aunque no tenga el id guardado: si la respuesta de `crearCobro`
  // se perdió, el QR existe en el banco con `cobro.id` en null, y anularlo acá
  // dejaría cobrable un QR que nadie mira (revisión de seguridad, 22/09).
  if (pasoPorElCobrador(antes)) return { resultado: 'qr_vivo_sin_cliente', cobroId: cobroIdDe(antes) || null };

  const ahoraMs = Date.now();
  const ahora = Timestamp.fromMillis(ahoraMs);
  const hecho = await db().runTransaction(async (tx) => {
    const [pd, cd] = await Promise.all([tx.get(r.pago), tx.get(r.cuenta)]);
    const p = pd.data();
    if (!p || p['estado'] !== 'pendiente') return false;
    if (pasoPorElCobrador(p)) return false;
    tx.update(r.pago, { estado: 'anulado', anuladoEn: ahora, anuladoPor: 'novuchat', motivoAnulacion: motivo.slice(0, 300), actualizadoEn: ahora });
    const cuenta = cd.data() ?? {};
    const escritura: Record<string, unknown> = { actualizadoEn: ahora };
    if (cuenta['pagoPendienteId'] === pagoId) {
      escritura['pagoPendienteId'] = FieldValue.delete();
      const sin = { ...cuenta }; delete sin['pagoPendienteId'];
      Object.assign(escritura, camposDerivadosDeCuenta(sin, null, ahoraMs));
    }
    tx.set(r.cuenta, escritura, { merge: true });
    tx.delete(r.cobroPendiente);
    return true;
  });
  if (!hecho) return { resultado: 'sin_cobro' };
  await auditar(tenantId, 'pago_anulado', 'novuchat', { pagoId, cobroId: null, motivo: motivo.slice(0, 300) });
  return { resultado: 'anulado' };
}

/**
 * LO QUE SE GUARDA DE LA EVIDENCIA, además de su ruta (revisión de seguridad
 * de A-1, MEDIUM 2): la generación del objeto y su hash. Con eso, si alguien
 * reemplazara el archivo después de registrar el pago, la auditoría dice qué
 * versión se miró. Y `storage.rules` ya no deja reemplazarla una vez que el
 * pago existe.
 */
export interface MetaEvidencia {
  generation: string;
  md5Hash: string | null;
  size: number;
  contentType: string;
}

const TIPO_DE_EVIDENCIA: Record<string, string> = {
  'evidencia.jpg': 'image/jpeg', 'evidencia.png': 'image/png', 'evidencia.pdf': 'application/pdf',
};

const metaEnStorage = async (ruta: string): Promise<MetaEvidencia | null> => {
  const archivo = getStorage().bucket().file(ruta);
  const [existe] = await archivo.exists();
  if (!existe) return null;
  const [meta] = await archivo.getMetadata();
  return {
    generation: String(meta.generation ?? ''),
    md5Hash: typeof meta.md5Hash === 'string' ? meta.md5Hash : null,
    size: Number(meta.size ?? 0),
    contentType: typeof meta.contentType === 'string' ? meta.contentType : '',
  };
};

const con = (deps: Deps) => ({
  anular: deps.anular ?? anularPendienteLocal,
  metaEvidencia: deps.metaEvidencia ?? metaEnStorage,
  ahoraMs: deps.ahoraMs ?? Date.now,
});

const cobroEstadoDe = (datos: Record<string, unknown> | undefined): string | null => {
  const cobro = datos?.['cobro'];
  if (typeof cobro !== 'object' || cobro === null) return null;
  const estado = (cobro as Record<string, unknown>)['estado'];
  return typeof estado === 'string' ? estado : null;
};

/**
 * CONFIRMAR A MANO UN QR QUE EL BANCO YA CONFIRMÓ Y NO SE APLICÓ (LOW 9).
 *
 * El caso: el cobrador dice `CONFIRMADO` pero NovuChat dejó el pago
 * `pendiente` (un importe menor al del QR, por ejemplo). La plata entró por el
 * QR, así que no se carga un pago nuevo: se confirma ESE `pagoId`, con
 * `origen: 'propietario'`, lo recibido y `motivoDiferencia` obligatorio, por
 * la misma puerta (`aplicarPagoEnTransaccion`), y queda auditado como
 * `pago_manual_confirma_qr`. Solo si el pago sigue `pendiente` y su último
 * estado del cobrador es `CONFIRMADO`: nunca sobre un QR vivo sin pago.
 */
async function confirmarQrConfirmado(
  tenantId: string, pagoId: string, uid: string, datos: Record<string, unknown>, ahoraMs: number,
) {
  if (!ID_PAGO.test(pagoId)) throw new HttpsError('invalid-argument', 'confirmarPendiente tiene que ser un pagoId.');
  const montoRecibidoBs = datos['montoRecibidoBs'];
  if (!enteroEntre(montoRecibidoBs, 0, MONTO_RECIBIDO_MAXIMO)) {
    throw new HttpsError('invalid-argument', 'montoRecibidoBs tiene que ser un entero en bolivianos.');
  }
  // CERO NO ES UN PAGO (revisión de seguridad del #217, LOW). Acá se confirma
  // un cobro que el banco YA confirmó: si no entró nada, no hay qué confirmar,
  // y sumar un mes con 0 Bs sería un regalo sin nombre. Un descuento total, si
  // alguna vez existe, va por otro camino, no por este.
  if (montoRecibidoBs === 0) {
    throw new HttpsError('invalid-argument',
      'montoRecibidoBs no puede ser 0: se confirma lo que el banco informó que entró por ese QR.');
  }
  // EL MOTIVO, CON LA MISMA COTA QUE LA CONSOLA (`motivoDeConfirmacionValido`,
  // 3 caracteres o más): un «x» no explica nada en la auditoría.
  const motivoDiferencia = texto(datos['motivoDiferencia'], 300);
  if (motivoDiferencia.length < MOTIVO_CONFIRMACION_MINIMO) {
    throw new HttpsError('invalid-argument',
      `Confirmar a mano un cobro del banco exige motivoDiferencia (${MOTIVO_CONFIRMACION_MINIMO} caracteres o más).`);
  }
  const r = refsDe(tenantId, pagoId);
  const ahora = Timestamp.fromMillis(ahoraMs);
  const salida = await db().runTransaction(async (tx) => {
    const [pagoDoc, cuentaDoc, fichaDoc] = await Promise.all([tx.get(r.pago), tx.get(r.cuenta), tx.get(r.ficha)]);
    if (!fichaDoc.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    const p = pagoDoc.data();
    if (!p) throw new HttpsError('not-found', 'No existe ese pago.');
    if (p['estado'] !== 'pendiente' || cobroEstadoDe(p) !== 'CONFIRMADO') {
      throw new HttpsError('failed-precondition',
        'Solo se confirma a mano un pago pendiente cuyo cobro el banco ya confirmó.');
    }
    const resultado = aplicarPagoEnTransaccion(tx, r, {
      id: pagoId, datos: p, cuenta: cuentaDoc.data() ?? {}, ficha: fichaDoc.data() ?? {},
    }, { origen: 'propietario', uid, montoRecibidoBs, motivoDiferencia, confirmadoEn: ahora, ahoraMs });
    tx.delete(r.cobroPendiente);
    tx.set(db().doc(`cobrosResueltos/${pagoId}`), {
      tenantId, pagoId, cobroId: cobroIdDe(p), estado: 'confirmado', cerradoEn: ahora,
    });
    // LA MISMA AUDITORÍA QUE UN CAMBIO DE PLAN (revisión de seguridad de
    // #212, tercera vuelta, LOW 2). Un pago en revisión por `plan_distinto`
    // confirmado acá CAMBIA el plan: sin el antes y el después de la copia
    // de límites, este cambio sería el único que no deja constancia de qué
    // se perdió o se conservó por contrato. `revision` dice por qué estaba
    // detenido.
    tx.create(db().collection(`tenants/${tenantId}/auditoria`).doc(), {
      accion: 'pago_manual_confirma_qr', uid, en: ahora, pagoId, cobroId: cobroIdDe(p),
      monto: p['monto'] ?? null, montoRecibidoBs, motivoDiferencia,
      revision: typeof p['revision'] === 'string' ? p['revision'] : null,
      // LO QUE INFORMÓ EL BANCO, leído antes de aplicar: `aplicacionDe`
      // sobrescribe `montoRecibidoBs` del pago con lo que declara el
      // propietario, y sin esto la auditoría perdería la diferencia.
      montoInformadoBanco: typeof p['montoRecibidoBs'] === 'number' ? p['montoRecibidoBs'] : null,
      cubiertoHasta: resultado.cubiertoHasta,
      planAntes: (cuentaDoc.data() ?? {})['plan'] ?? null, planDespues: resultado.plan,
      ...auditoriaDeLimites(resultado.cambioDeLimites),
    });
    return { resultado, descripcion: String(p['descripcion'] ?? ''), monto: p['monto'] };
  });
  await registrar(tenantId, {
    tipo: 'pago_registrado', resultado: 'ok', canal: 'panel', codigo: 'propietario',
    detalle: `${salida.descripcion}${salida.resultado.cubiertoHasta ? ` · hasta ${salida.resultado.cubiertoHasta}` : ''}`.slice(0, 120),
  });
  if (salida.resultado.corteEstabaAplicado) {
    await registrar(tenantId, { tipo: 'reanudacion_servicio', resultado: 'ok', canal: 'sistema', codigo: 'pago_manual' });
  }
  return {
    pagoId, monto: salida.monto, confirmadoQr: true,
    periodoPagado: salida.resultado.periodoPagado, cubiertoHasta: salida.resultado.cubiertoHasta,
    bolsa: salida.resultado.bolsa, plan: salida.resultado.plan, modalidad: salida.resultado.modalidad,
  };
}

/** Lo que se le devuelve a la consola cuando hay un pendiente vivo que hay que cerrar antes. */
const resumenDelPendiente = (pagoId: string, p: Record<string, unknown>) => ({
  pagoId, estado: p['estado'], monto: p['monto'], descripcion: p['descripcion'],
  cobroId: cobroIdDe(p),
  venceEn: p['venceEn'] instanceof Timestamp ? p['venceEn'].toMillis() : null,
});

/** Anula el pendiente de la cuenta antes de cargar un manual, o explica por qué no se puede. */
async function cerrarPendienteAntesDe(
  tenantId: string, pendienteId: string, p: Record<string, unknown>, anular: NonNullable<Deps['anular']>,
): Promise<void> {
  const r = await anular(tenantId, pendienteId, 'pago_manual');
  const vivo = resumenDelPendiente(pendienteId, p);
  switch (r.resultado) {
    case 'anulado':
    case 'sin_cobro':
      return;
    case 'pagado': {
      // ¿Se aplicó de verdad? Si el banco confirmó pero NovuChat no lo aplicó
      // (el cliente del cobrador lo dejó `pendiente` con `cobro.estado:
      // 'CONFIRMADO'`, por ejemplo por un importe menor), decir «se aplica el
      // cobro del banco» sería falso: se ofrece confirmar ESE pago a mano
      // (revisión de seguridad de A-1, LOW 9).
      const ahora = (await db().doc(`tenants/${tenantId}/pagos/${pendienteId}`).get()).data();
      if (ahora && ahora['estado'] === 'pendiente' && cobroEstadoDe(ahora) === 'CONFIRMADO') {
        throw new HttpsError('failed-precondition',
          'El banco confirmó un pago sobre ese QR, pero no se aplicó (el importe o el plan no coinciden). Confírmelo con confirmarPendiente y motivoDiferencia, en vez de cargar otro.',
          { ...vivo, estado: 'pendiente', cobroEstado: 'CONFIRMADO', ofrecerConfirmar: true });
      }
      throw new HttpsError('failed-precondition',
        'Ese QR ya se pagó: se aplica el cobro del banco, no el manual.', { ...vivo, estado: r.estado });
    }
    case 'en_revision':
      throw new HttpsError('failed-precondition',
        'Hay un pago tardío sobre ese QR en revisión en el cobrador: no se carga nada hasta que lo resuelvan.', vivo);
    case 'qr_vivo_sin_cliente':
      throw new HttpsError('failed-precondition',
        'Hay un QR emitido en el cobrador para esta cuenta y esta versión no puede anularlo: cancélelo allá antes de cargar un pago manual.',
        { ...vivo, cobroId: r.cobroId });
  }
}

// ---------------------------------------------------------------------------
// registrarPagoManual — el propietario carga efectivo o transferencia
// ---------------------------------------------------------------------------

const enteroEntre = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Lee y valida el pedido de la petición. Lo que no es del catálogo se rechaza. */
function pedidoDe(datos: Record<string, unknown>): Pago {
  const tipo = datos['tipo'];
  const candidato: Record<string, unknown> = tipo === 'mensualidad'
    ? { tipo, plan: datos['plan'], meses: datos['meses'] }
    : tipo === 'bolsa' ? { tipo, cantidad: datos['cantidad'] }
    : { tipo };
  if (!esPago(candidato)) {
    throw new HttpsError('invalid-argument',
      'Pedido inválido: tipo mensualidad (plan del catálogo, meses 1 a 6), bolsa (cantidad 1 a 12) o instalacion.');
  }
  return candidato;
}

/**
 * `registrarPagoManual({ tenantId, tipo, plan?, meses?, cantidad?, medio,
 * referencia, tcoAplicado, tcoFuente, tcoFecha, montoRecibidoBs,
 * motivoDiferencia?, pagoId?, evidencia? })` → `{ pagoId, monto, montoUsd,
 * periodoPagado, cubiertoHasta, bolsa, plan, modalidad, pendienteAnulado }`.
 *
 * Solo el propietario con Google. `pagoId` es OBLIGATORIO en todo registro,
 * cualquiera sea el medio: la consola lo genera UNA vez por formulario y lo
 * reusa en los reintentos, y `tx.create` hace de clave de idempotencia (un
 * reintento de red no suma dos meses; revisión de seguridad de A-1, MEDIUM 1).
 * En transferencia, además, `evidencia` (`evidencia.jpg|png|pdf`) es
 * obligatoria y el objeto tiene que existir en Storage bajo ese `pagoId`. `motivoDiferencia` es obligatorio si
 * `montoRecibidoBs` no es el importe de la lista al TCO declarado.
 *
 * Orden: validar todo → comprobar la evidencia → cerrar el pendiente vivo (o
 * abortar) → UNA transacción que crea el pago confirmado, aplica y audita →
 * bitácora. Si algo falla antes de la transacción, no se escribió nada.
 */
export function crearRegistrarPagoManual(deps: Deps = {}, opciones: CallableOptions = {}) {
  return onCall({ region: REGION, ...opciones }, async (peticion) => {
    const uid = exigirPropietario(peticion);
    const d = con(deps);
    exigirSesionReciente(peticion, d.ahoraMs());
    const datos = (peticion.data ?? {}) as Record<string, unknown>;
    const tenantId = texto(datos['tenantId'], 60);
    if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

    // El otro modo: confirmar a mano el QR que el banco ya confirmó (LOW 9).
    if (Object.prototype.hasOwnProperty.call(datos, 'confirmarPendiente')) {
      return confirmarQrConfirmado(tenantId, texto(datos['confirmarPendiente'], 40), uid, datos, d.ahoraMs());
    }

    const pedido = pedidoDe(datos);
    const medio = datos['medio'];
    if (medio !== 'efectivo' && medio !== 'transferencia') {
      throw new HttpsError('invalid-argument', 'medio tiene que ser efectivo o transferencia.');
    }
    const referencia = texto(datos['referencia'], 120);
    if (!referencia) {
      throw new HttpsError('invalid-argument',
        'referencia es obligatoria: el número de operación, o «recibido por <nombre>» en efectivo.');
    }
    const tcoAplicado = datos['tcoAplicado'];
    if (typeof tcoAplicado !== 'number' || !Number.isFinite(tcoAplicado) || tcoAplicado < TCO_MINIMO || tcoAplicado > TCO_MAXIMO) {
      throw new HttpsError('invalid-argument', `tcoAplicado tiene que ser un número entre ${TCO_MINIMO} y ${TCO_MAXIMO}.`);
    }
    const tcoFuente = texto(datos['tcoFuente'], 60);
    if (!tcoFuente) throw new HttpsError('invalid-argument', 'tcoFuente es obligatoria (por ejemplo, BCB).');
    const tcoFecha = datos['tcoFecha'];
    const ahoraMs = d.ahoraMs();
    if (!esFecha(tcoFecha) || !Number.isFinite(Date.parse(`${tcoFecha}T12:00:00Z`))
      || Date.parse(`${tcoFecha}T00:00:00Z`) > ahoraMs + 86_400_000) {
      throw new HttpsError('invalid-argument', 'tcoFecha tiene que ser aaaa-mm-dd y no puede ser futura.');
    }
    if (ahoraMs - Date.parse(`${tcoFecha}T00:00:00Z`) > (TCO_MANUAL_DIAS_MAXIMO + 1) * 86_400_000) {
      throw new HttpsError('invalid-argument', `tcoFecha no puede tener más de ${TCO_MANUAL_DIAS_MAXIMO} días.`);
    }
    const montoRecibidoBs = datos['montoRecibidoBs'];
    if (!enteroEntre(montoRecibidoBs, 0, MONTO_RECIBIDO_MAXIMO)) {
      throw new HttpsError('invalid-argument', 'montoRecibidoBs tiene que ser un entero en bolivianos.');
    }
    const montoUsd = montoUsdDe(pedido);
    const monto = importeBs(montoUsd, tcoAplicado);
    const motivoDiferencia = texto(datos['motivoDiferencia'], 300);
    if (montoRecibidoBs !== monto && !motivoDiferencia) {
      throw new HttpsError('invalid-argument',
        `Lo recibido (${montoRecibidoBs} Bs) no es el importe de la lista (${monto} Bs): motivoDiferencia es obligatorio.`);
    }

    // LA CLAVE DE IDEMPOTENCIA. Sin ella, un reintento del navegador tras un
    // corte de red registraba un segundo pago y sumaba otro mes.
    // EL TCO DE REFERENCIA (revisión de seguridad de A-1, LOW 5). Si hay un
    // TCO del BCB vigente en `plataforma/tipoCambio` y el declarado difiere
    // en más de un centavo, el propietario tiene que decir por qué (un pago
    // cobrado otro día, un acuerdo): el TCO es lo que convierte la lista en
    // bolivianos, y cambiarlo en silencio es un descuento sin firma. Sin
    // referencia vigente no se exige nada más, y queda escrito que no la había.
    let tcoReferencia: TipoCambio | null = null;
    try {
      tcoReferencia = tipoCambioDe((await db().doc(RUTA_TIPO_CAMBIO).get()).data(), ahoraMs);
    } catch (e) {
      if (!(e instanceof SinTipoDeCambio)) throw e;
    }
    if (tcoReferencia && Math.abs(tcoAplicado - tcoReferencia.tco) > TCO_TOLERANCIA + 1e-9 && !motivoDiferencia) {
      throw new HttpsError('invalid-argument',
        `El TCO declarado (${tcoAplicado}) no es el vigente del BCB (${tcoReferencia.tco}, ${tcoReferencia.fecha}): motivoDiferencia es obligatorio.`);
    }

    const pagoIdPedido = texto(datos['pagoId'], 40);
    if (!ID_PAGO.test(pagoIdPedido)) {
      throw new HttpsError('invalid-argument',
        'pagoId es obligatorio (22 caracteres de base64url): la consola lo genera una vez por formulario y lo reusa al reintentar.');
    }
    const evidencia = texto(datos['evidencia'], 40);
    let rutaEvidencia: string | null = null;
    let evidenciaMeta: MetaEvidencia | null = null;
    if (medio === 'transferencia') {
      if (!(ARCHIVOS_EVIDENCIA as readonly string[]).includes(evidencia)) {
        throw new HttpsError('invalid-argument',
          `Una transferencia exige evidencia: uno de ${ARCHIVOS_EVIDENCIA.join(', ')}, subido antes a Storage.`);
      }
      rutaEvidencia = `tenants/${tenantId}/pagos/${pagoIdPedido}/${evidencia}`;
      evidenciaMeta = await d.metaEvidencia(rutaEvidencia);
      if (!evidenciaMeta || evidenciaMeta.size <= 0) {
        throw new HttpsError('failed-precondition', 'La evidencia declarada no está en Storage. Súbala y vuelva a intentar.');
      }
      if (evidenciaMeta.contentType !== TIPO_DE_EVIDENCIA[evidencia]) {
        throw new HttpsError('failed-precondition', 'La evidencia en Storage no tiene el tipo que corresponde a su nombre.');
      }
    } else if (evidencia) {
      throw new HttpsError('invalid-argument', 'La evidencia va solo con transferencia.');
    }
    const pagoId = pagoIdPedido;
    const r = refsDe(tenantId, pagoId);

    // EL `pagoId` NO PUEDE SER UNO QUE YA EXISTE, NI EL DEL PENDIENTE, y eso
    // se mira ANTES de anular nada (revisión de seguridad de A-1, LOW 4): si
    // no, un reintento o un id repetido anulaba el QR vivo del comercio y
    // recién después fallaba en el `create`.
    const [pagoAntes, cuentaAntesDoc] = await Promise.all([r.pago.get(), r.cuenta.get()]);
    const cuentaAntes = cuentaAntesDoc.data() ?? {};
    const pendienteId = typeof cuentaAntes['pagoPendienteId'] === 'string' ? cuentaAntes['pagoPendienteId'] : '';
    if (pendienteId !== '' && pendienteId === pagoId) {
      throw new HttpsError('invalid-argument', 'El pagoId es el del cobro pendiente: el manual va con un id nuevo.');
    }
    if (pagoAntes.exists) throw new HttpsError('already-exists', 'Ese pagoId ya existe.');

    // EL PENDIENTE VIVO SE CIERRA ANTES, fuera de la transacción (la anulación
    // en el cobrador es una llamada de red). La transacción vuelve a mirar.
    let pendienteAnulado: string | null = null;
    if (ID_PAGO.test(pendienteId)) {
      const p = (await db().doc(`tenants/${tenantId}/pagos/${pendienteId}`).get()).data();
      if (p && p['estado'] === 'pendiente') {
        await cerrarPendienteAntesDe(tenantId, pendienteId, p, d.anular);
        pendienteAnulado = pendienteId;
      }
    }

    const ahora = Timestamp.fromMillis(ahoraMs);
    const confirmacion: Confirmacion = {
      origen: 'propietario', uid, montoRecibidoBs, confirmadoEn: ahora, ahoraMs,
      ...(motivoDiferencia ? { motivoDiferencia } : {}),
    };
    const base: Record<string, unknown> = {
      tipo: pedido.tipo,
      ...(pedido.tipo === 'mensualidad' ? { plan: pedido.plan, meses: pedido.meses } : {}),
      ...(pedido.tipo === 'bolsa' ? { cantidad: pedido.cantidad } : {}),
      montoUsd, monto, moneda: MONEDA_COBRO, monedaLista: MONEDA_LISTA,
      tcoAplicado, tcoFuente, tcoFecha, tcoReferencia,
      medio, canal: 'manual', referencia,
      ...(rutaEvidencia ? { evidencia: rutaEvidencia, evidenciaMeta } : {}),
      descripcion: descripcionDe(pedido),
      creadoEn: ahora, creadoPor: uid,
    };

    const salida = await db().runTransaction(async (tx) => {
      const [pagoDoc, cuentaDoc, fichaDoc] = await Promise.all([tx.get(r.pago), tx.get(r.cuenta), tx.get(r.ficha)]);
      if (!fichaDoc.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
      if (fichaDoc.get('estado') === 'dado_de_baja') {
        throw new HttpsError('failed-precondition', 'El comercio está dado de baja: no se le carga un pago.');
      }
      if (pagoDoc.exists) throw new HttpsError('already-exists', 'Ese pagoId ya existe.');
      const cuenta = cuentaDoc.data() ?? {};
      // SE VUELVE A MIRAR EL PENDIENTE, SIEMPRE, sin confiar en lo que dijo
      // `anular`: si la cuenta todavía apunta a un pago `pendiente` (el mismo
      // que no se cerró, u otro que apareció en el medio), no se carga nada.
      const vivoId = typeof cuenta['pagoPendienteId'] === 'string' ? cuenta['pagoPendienteId'] : '';
      if (ID_PAGO.test(vivoId)) {
        const vivo = (await tx.get(db().doc(`tenants/${tenantId}/pagos/${vivoId}`))).data();
        if (vivo && vivo['estado'] === 'pendiente') {
          throw new HttpsError('failed-precondition', 'Sigue habiendo un cobro pendiente en esta cuenta. Ciérrelo y vuelva a intentar.',
            resumenDelPendiente(vivoId, vivo));
        }
      }
      // `siempre`: arriba, en esta misma transacción, se comprobó que lo que
      // apunta `pagoPendienteId` no está `pendiente`; un puntero viejo se suelta.
      const a = aplicacionDe({ id: pagoId, datos: { ...base, estado: 'pendiente' }, cuenta, ficha: fichaDoc.data() ?? {} }, confirmacion, 'siempre');
      // NACE CONFIRMADO: un solo `create` con el pedido y la confirmación.
      tx.create(r.pago, { ...base, ...a.escrituraPago });
      tx.set(r.cuenta, a.escrituraCuenta, { merge: true });
      if (a.cambioDePlan) tx.set(r.ficha, { plan: a.cambioDePlan }, { merge: true });
      tx.create(db().collection(`tenants/${tenantId}/auditoria`).doc(), {
        accion: 'pago_manual', uid, en: ahora,
        pagoId, tipo: pedido.tipo,
        ...(pedido.tipo === 'mensualidad' ? { plan: pedido.plan, meses: pedido.meses } : {}),
        ...(pedido.tipo === 'bolsa' ? { cantidad: pedido.cantidad } : {}),
        montoUsd, monto, montoRecibidoBs, tcoAplicado, tcoFuente, tcoFecha, tcoReferencia, medio, referencia,
        evidencia: rutaEvidencia, evidenciaMeta, motivoDiferencia: motivoDiferencia || null,
        pendienteAnulado,
        cubiertoHasta: a.resultado.cubiertoHasta, planDespues: a.resultado.plan, bolsaDespues: a.resultado.bolsa,
        planAntes: cuenta['plan'] ?? null, periodoPagadoAntes: cuenta['periodoPagado'] ?? null,
        ...auditoriaDeLimites(a.resultado.cambioDeLimites),
      });
      return a.resultado;
    });

    await registrar(tenantId, {
      tipo: 'pago_registrado', resultado: 'ok', canal: 'panel', codigo: 'propietario',
      detalle: `${descripcionDe(pedido)}${salida.cubiertoHasta ? ` · hasta ${salida.cubiertoHasta}` : ''}`.slice(0, 120),
    });
    if (salida.corteEstabaAplicado) {
      await registrar(tenantId, { tipo: 'reanudacion_servicio', resultado: 'ok', canal: 'sistema', codigo: 'pago_manual' });
    }
    return {
      pagoId, monto, montoUsd, moneda: MONEDA_COBRO, monedaLista: MONEDA_LISTA,
      periodoPagado: salida.periodoPagado, cubiertoHasta: salida.cubiertoHasta,
      bolsa: salida.bolsa, plan: salida.plan, modalidad: salida.modalidad, pendienteAnulado,
    };
  });
}

// ---------------------------------------------------------------------------
// anularPagoPendiente — «cancelar y emitir otro»
// ---------------------------------------------------------------------------

/**
 * `anularPagoPendiente({ tenantId, pagoId?, motivo? })` → `{ ok, pagoId }`.
 * El administrador del comercio o el propietario. Sin `pagoId`, anula el
 * pendiente de la cuenta. Un pago que no está `pendiente` NO se anula: un
 * confirmado se compensa con otro asiento, nunca se corrige.
 */
export function crearAnularPagoPendiente(deps: Deps = {}, opciones: CallableOptions = {}) {
  return onCall({ region: REGION, ...opciones }, async (peticion) => {
    const datos = (peticion.data ?? {}) as Record<string, unknown>;
    const tenantId = texto(datos['tenantId'], 60);
    if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
    const { uid, quien } = exigirAdminOPropietario(peticion, tenantId);
    const motivo = texto(datos['motivo'], 300) || `anulado desde la consola (${quien})`;
    const pedido = texto(datos['pagoId'], 40);
    if (pedido && !ID_PAGO.test(pedido)) throw new HttpsError('invalid-argument', 'pagoId inválido.');

    const cuenta = (await db().doc(`tenants/${tenantId}/cuenta/estado`).get()).data() ?? {};
    const guardado = typeof cuenta['pagoPendienteId'] === 'string' && ID_PAGO.test(cuenta['pagoPendienteId'])
      ? cuenta['pagoPendienteId'] : '';
    const pagoId = pedido || guardado;
    if (!pagoId) throw new HttpsError('failed-precondition', 'No hay un pago pendiente que anular.');
    const p = (await db().doc(`tenants/${tenantId}/pagos/${pagoId}`).get()).data();
    if (!p) throw new HttpsError('not-found', 'No existe ese pago.');
    if (p['estado'] !== 'pendiente') {
      throw new HttpsError('failed-precondition', `Un pago ${String(p['estado'])} no se anula.`);
    }
    // EL BANCO YA CONFIRMÓ ESE QR Y NOVUCHAT NO LO APLICÓ (en revisión por
    // importe o por plan; revisión de seguridad de #212, tercera vuelta,
    // LOW 1). No hay nada que cancelar: la plata entró. Se dice así, sin
    // llamar al cobrador --que respondería `PAGADO_NO_SE_ANULA` y dejaría el
    // mensaje «se aplicó el cobro del banco», que acá sería falso--. Lo
    // resuelve el propietario desde Negocios (`confirmarPendiente`).
    if (cobroEstadoDe(p) === 'CONFIRMADO') {
      throw new HttpsError('failed-precondition',
        'El banco ya confirmó el pago de ese QR y NovuChat lo está registrando: no se cancela.',
        { ...resumenDelPendiente(pagoId, p), cobroEstado: 'CONFIRMADO' });
    }

    const r = await con(deps).anular(tenantId, pagoId, motivo);
    if (r.resultado !== 'anulado') {
      const vivo = resumenDelPendiente(pagoId, p);
      if (r.resultado === 'pagado') {
        throw new HttpsError('failed-precondition', 'Ese QR ya se pagó: se aplicó el cobro del banco.', { ...vivo, estado: r.estado });
      }
      if (r.resultado === 'en_revision') {
        throw new HttpsError('failed-precondition', 'Hay un pago tardío en revisión en el cobrador: lo resuelve una persona allá.', vivo);
      }
      if (r.resultado === 'qr_vivo_sin_cliente') {
        throw new HttpsError('failed-precondition',
          'Hay un QR emitido en el cobrador y esta versión no puede anularlo allá.', { ...vivo, cobroId: r.cobroId });
      }
      throw new HttpsError('failed-precondition', 'No había nada que anular.', vivo);
    }
    await auditar(tenantId, 'anular_pago_pendiente', uid, { pagoId, quien, motivo });
    return { ok: true, pagoId };
  });
}

// ---------------------------------------------------------------------------
// consultarPagoPendiente — la «consulta al abrir la pantalla»
// ---------------------------------------------------------------------------

/**
 * `consultarPagoPendiente({ tenantId })` → `{ pendiente: {...} | null }`.
 * Administrador o propietario. Si hay cliente del cobrador (`Deps.consultar`,
 * A-2: `consultarYAplicar`), primero pregunta allá y aplica; después devuelve
 * el pago guardado. Sin cliente, devuelve lo guardado tal cual.
 */
export function crearConsultarPagoPendiente(deps: Deps = {}, opciones: CallableOptions = {}) {
  return onCall({ region: REGION, ...opciones }, async (peticion) => {
    const datos = (peticion.data ?? {}) as Record<string, unknown>;
    const tenantId = texto(datos['tenantId'], 60);
    if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
    exigirAdminOPropietario(peticion, tenantId);

    const cuenta = (await db().doc(`tenants/${tenantId}/cuenta/estado`).get()).data() ?? {};
    const pagoId = typeof cuenta['pagoPendienteId'] === 'string' && ID_PAGO.test(cuenta['pagoPendienteId'])
      ? cuenta['pagoPendienteId'] : '';
    if (!pagoId) return { pendiente: null, consultado: false };

    let consultado = false;
    if (deps.consultar) {
      // `null` = no hubo con quién consultar (sin cobrador configurado): la
      // pantalla no puede decir que preguntó al banco si no preguntó.
      consultado = (await deps.consultar(tenantId, pagoId)) !== null;
    }
    const p = (await db().doc(`tenants/${tenantId}/pagos/${pagoId}`).get()).data();
    if (!p) return { pendiente: null, consultado };
    const cobro = typeof p['cobro'] === 'object' && p['cobro'] !== null ? p['cobro'] as Record<string, unknown> : null;
    const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);
    // UN QR QUE EL BANCO YA CONFIRMÓ NO SE VUELVE A MOSTRAR (tercera vuelta
    // de #212, LOW 1): el pago puede seguir `pendiente` --en revisión, hasta
    // que el propietario lo confirme--, pero pagar dos veces el mismo QR no
    // tiene sentido. Sin ficha, la pantalla no tiene qué dibujar, y
    // `imagenDePago` también responde 404.
    const confirmadoPorElBanco = cobro?.['estado'] === 'CONFIRMADO';
    const resumen = {
      pagoId, estado: p['estado'], tipo: p['tipo'], descripcion: p['descripcion'],
      monto: p['monto'], montoUsd: p['montoUsd'], moneda: p['moneda'], monedaLista: p['monedaLista'],
      tcoAplicado: p['tcoAplicado'], tcoFuente: p['tcoFuente'], tcoFecha: p['tcoFecha'],
      medio: p['medio'], canal: p['canal'],
      venceEn: ms(p['venceEn']), creadoEn: ms(p['creadoEn']),
      cobroEstado: cobro?.['estado'] ?? null,
      fichaQr: !confirmadoPorElBanco && typeof cobro?.['fichaQr'] === 'string' ? cobro['fichaQr'] : null,
      qrRuta: !confirmadoPorElBanco && typeof cobro?.['qrRuta'] === 'string' ? cobro['qrRuta'] : null,
    };
    return p['estado'] === 'pendiente'
      ? { pendiente: resumen, consultado }
      : { pendiente: null, ultimo: { pagoId, estado: p['estado'] }, consultado };
  });
}

// ---------------------------------------------------------------------------
// fijarTelefonosPago — quién puede pagar por WhatsApp y recibe la cobranza
// ---------------------------------------------------------------------------

/**
 * `fijarTelefonosPago({ tenantId, telefonos: string[] })` → `{ ok, telefonos }`.
 * El administrador del comercio o el propietario. Hasta 5, solo dígitos con
 * código de país (8 a 15), sin repetidos; la lista vacía los borra. Va en
 * `cuenta/estado` y no en la ficha porque la ficha la leen el operador y la
 * ingesta (§4undecies.2). Auditada con los últimos 4 de cada uno.
 */
// Región explícita, como en cobro.ts: index.ts importa este módulo ANTES de
// llamar a setGlobalOptions, y una Function creada sin objeto de opciones se
// quedaba sin región ni cuenta (se habría desplegado en us-central1 con la
// cuenta de cómputo, que no puede leer Firestore). Lo vigila region-y-cuenta.test.ts.
export const fijarTelefonosPago = onCall({ region: REGION }, async (peticion) => {
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const { uid, quien } = exigirAdminOPropietario(peticion, tenantId);

  const lista = datos['telefonos'];
  if (!Array.isArray(lista)) throw new HttpsError('invalid-argument', 'telefonos tiene que ser una lista.');
  if (lista.length > TELEFONOS_PAGO_MAXIMO) {
    throw new HttpsError('invalid-argument', `Hasta ${TELEFONOS_PAGO_MAXIMO} teléfonos de pago.`);
  }
  const telefonos: string[] = [];
  for (const t of lista) {
    const limpio = typeof t === 'string' ? t.replace(/[\s+()-]/g, '') : '';
    if (!TELEFONO.test(limpio)) {
      throw new HttpsError('invalid-argument', 'Cada teléfono va solo con dígitos y código de país (8 a 15 dígitos).');
    }
    if (!telefonos.includes(limpio)) telefonos.push(limpio);
  }

  const refFicha = db().doc(`tenants/${tenantId}`);
  const refCuenta = db().doc(`tenants/${tenantId}/cuenta/estado`);
  const ahora = Timestamp.now();
  await db().runTransaction(async (tx) => {
    const ficha = await tx.get(refFicha);
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    // Un comercio dado de baja no fija quién le paga (LOW 7). La verificación
    // del titular de cada teléfono y la unicidad entre comercios son
    // precondición del pago por WhatsApp (A-4), no de esta callable.
    if (ficha.get('estado') === 'dado_de_baja') {
      throw new HttpsError('failed-precondition', 'El comercio está dado de baja.');
    }
    tx.set(refCuenta, { telefonosPago: telefonos, actualizadoEn: ahora }, { merge: true });
    tx.create(db().collection(`tenants/${tenantId}/auditoria`).doc(), {
      accion: 'telefonos_pago', uid, en: ahora, quien,
      cantidad: telefonos.length, ultimos4: telefonos.map(ultimos4),
    });
  });
  return { ok: true, telefonos };
});

// Las callables que se despliegan, con las dependencias por defecto: sin
// cobrador (A-2 las enchufa), Storage real, reloj real.
export const registrarPagoManual = crearRegistrarPagoManual();
export const anularPagoPendiente = crearAnularPagoPendiente();
export const consultarPagoPendiente = crearConsultarPagoPendiente();

// Reexportado para quien arme un pago y necesite el precio de lista.
export { BOLSA, INSTALACION_USD, PLANES };
