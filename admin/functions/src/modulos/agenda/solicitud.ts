import { Timestamp } from 'firebase-admin/firestore';
import { MS_VENTANA_ATENCION } from '../../core/conteo/atencion.js';
import { milisegundosDe } from '../../core/turno/tiempo.js';
import { CAMPOS_REGLA_2_EN_NULO, esReglaDos, limiteDe, totalUtilizable } from '../cobros/cobroVenta.js';

/**
 * =============================================================================
 * LA SOLICITUD DE UN TELÉFONO: su forma y las reglas puras que la mueven
 * =============================================================================
 *
 * F3b-1a (05/10/2026): estas piezas vivían en `ingesta.ts` y se mudaron aquí SIN
 * cambiar una línea de lógica, para que ningún módulo importe el archivo del
 * coordinador (la deuda de `fronteras.test.ts`). `ingesta.ts` las reexporta para
 * que sus importadores de siempre no cambien; la equivalencia con lo de antes la
 * fija `pruebas/core/equivalencia-f3b1a.test.ts`.
 *
 * Por qué viven en Agenda y no en Cobros: la solicitud es el estado de la seña de
 * una cita (y de la venta que comparte su forma), y Agenda declara `dependeDe:
 * ['cobros']`, de modo que los predicados de la regla 2 se toman de
 * `cobros/cobroVenta.ts` (`limiteDe`, `esReglaDos`) sin importar hacia arriba.
 */

/**
 * ===========================================================================
 * LA SEÑA EN CURSO DE UN TELÉFONO — `solicitud` en la conversación
 * ===========================================================================
 *
 * Es el estado que le dice al flujo qué hacer con el próximo archivo que manda
 * el paciente: si hay un QR enviado y sin comprobante, una imagen o un PDF se
 * lee como comprobante y se coteja; si no, es una imagen cualquiera. Y es lo
 * que `senaVencida` mira para saber qué cita borrar.
 *
 * Vive en el documento de la conversación —que ya está indexado por teléfono
 * y ya se escribe con cada mensaje— por la misma razón que las marcas de
 * conteo: no crea ningún registro nuevo de teléfonos y se escribe en la
 * transacción que ya existe. Cero lecturas y cero escrituras extra.
 *
 * ETAPAS: `horarios` (bloque 4: el asistente ofreció horarios y el paciente
 * no eligió), `qr_enviado` (retenida, esperando el comprobante), `agendada`
 * (el comprobante cuadró, o `registrarCierre` registró la cita), `vencida`
 * (pasaron los minutos de retención sin comprobante y la cita se borró).
 *
 * Las dos PENDIENTES son `horarios` y `qr_enviado`: sobre ellas corre el
 * recordatorio de solicitud pendiente (`seguimientos.ts`), una sola vez.
 */
export interface Solicitud {
  /**
   * `en_revision` y `cancelada` son de la REGLA 2 del cobro de venta (tercer
   * comprobante inválido, y el cliente que canceló; `cobroVenta.ts`). Los campos
   * propios de esa regla (`reglaCobro`, `venceEn`, `prorrogaHasta`, ...) los
   * arma `solicitudDeCobroTras` y se mezclan sobre la solicitud.
   */
  etapa: 'horarios' | 'qr_enviado' | 'agendada' | 'vencida' | 'a_favor' | 'en_revision' | 'cancelada';
  /** Cuándo entró en esta etapa. */
  desde: Timestamp;
  qrEnviadoEn: Timestamp | null;
  /** La cita retenida en el calendario: su identificador y en qué calendario. */
  evento: { id: string; calendario: string } | null;
  /** Comprobantes recibidos para esta solicitud. */
  cotejos: number;
  /** Seguimientos enviados sobre ESTA solicitud. El tope es uno (bloque 4). */
  seguimientos: number;
  /** Cuándo salió el seguimiento; `null` mientras no salió. */
  seguimientoEn: Timestamp | null;
  /**
   * Cuándo el paciente volvió a escribir dentro de las 24 h del seguimiento;
   * `null` si no volvió. Es la marca que hace que `reactivadas` cuente UNA
   * vez por solicitud y no una por cada mensaje que siga.
   */
  reactivadaEn: Timestamp | null;
  /**
   * ADELANTO A FAVOR (Andres, 21/09/2026): hasta cuándo vale el adelanto de una
   * cita pagada que se canceló, y de qué cita venía. `null` fuera de `a_favor`.
   */
  aFavorHasta?: Timestamp | null;
  aFavorDe?: { id: string; calendario: string } | null;
  /**
   * EL TOTAL COTIZADO AL MANDAR EL QR, solo en venta (`cobroVenta.ts`).
   *
   * En una reserva el importe esperado se lee de `config/agendamiento`; en una
   * venta cambia con cada pedido y por eso se guarda acá, en el mismo instante
   * en que el QR salió. Es el número contra el que se coteja el comprobante, y
   * nada de lo que el modelo escriba después lo mueve.
   *
   * `null` en las reservas y cuando el flujo no lo mandó. Sin él no se coteja
   * el importe: se manda a una persona, que es lo honesto.
   */
  monto?: number | null;
}

/**
 * LA REGLA DEL ADELANTO A FAVOR (Andres, 21/09/2026). El asistente ya le decía
 * al paciente «para cancelar o reprogramar, escríbenos con al menos 2 horas de
 * anticipación y lo resolvemos sin costo», y el sistema le cobraba otra seña
 * al reagendar. Ahora: el adelanto de una cita PAGADA que se cancela con esa
 * anticipación queda a favor del paciente por siete días, y se aplica a la
 * próxima cita que agende en ese plazo. Con menos anticipación no hay crédito
 * automático: lo decide recepción, que recibe el aviso.
 */
export const DIAS_ADELANTO_A_FAVOR = 7;
export const HORAS_ANTICIPACION_PARA_CANCELAR = 2;

export const ETAPAS_PENDIENTES: ReadonlySet<string> = new Set(['horarios', 'qr_enviado']);

/** Una solicitud nueva, con todos los contadores y marcas en cero. */
function solicitudNueva(etapa: Solicitud['etapa'], ahora: Timestamp): Solicitud {
  return {
    etapa, desde: ahora, qrEnviadoEn: null, evento: null, cotejos: 0, seguimientos: 0,
    seguimientoEn: null, reactivadaEn: null, aFavorHasta: null, aFavorDe: null, monto: null,
  };
}

/** La ventana en la que un cobro de regla 2 cerrado sigue siendo ESTE caso: pasada, es otra conversación. */
const MS_VENTANA_COBRO = 24 * 3_600_000;

type Plano = Record<string, unknown>;
const comoPlano = (v: unknown): Plano | null => (typeof v === 'object' && v !== null ? v as Plano : null);

/** ¿Es un cobro de regla 2 que ya no está en curso (en revisión, cancelado, vencido o vencido por reloj)? */
function cobroDosCerrado(p: Plano, ahoraMs: number): boolean {
  const etapa = typeof p['etapa'] === 'string' ? p['etapa'] : '';
  const limite = limiteDe(p);
  return etapa === 'en_revision' || etapa === 'cancelada' || etapa === 'vencida'
    || (etapa === 'qr_enviado' && limite !== null && ahoraMs >= limite);
}

/**
 * ¿Un cierre (`cita_agendada`, o el de una venta) NO debe mover esta solicitud?
 * Sí cuando es un cobro de regla 2 que ya no está en curso —`en_revision`,
 * `cancelada`, `vencida`, o `qr_enviado` con el límite efectivo ya pasado
 * (vencida por reloj sin que nadie la anotara; D6).
 * **`en_revision` bloquea SIEMPRE**: no vence por reloj, lo resuelve una persona.
 * `cancelada`, `vencida` y `qr_enviado` vencido bloquean **solo mientras sigue
 * siendo ESTE caso**, hasta 24 h después del límite efectivo (`limiteDe`);
 * pasado ese plazo `solicitudDeCobroTras` lo trata como otra conversación y el
 * cierre ya puede crear su solicitud. Pura. Con regla 1, nunca.
 */
export function cierreBloqueadoPorCobro(previa: unknown, ahoraMs: number): boolean {
  const p = comoPlano(previa);
  if (!p || !esReglaDos(p) || !cobroDosCerrado(p, ahoraMs)) return false;
  if (p['etapa'] === 'en_revision') return true;
  const limite = limiteDe(p);
  return limite !== null && ahoraMs - limite <= MS_VENTANA_COBRO;
}

/**
 * ¿Un cierre de VENTA con cobro REAL lo debe hacer solo `cotejarComprobanteVenta`?
 * Sí si el cobro de regla 2 está bloqueado (arriba) o sigue a tiempo en
 * `qr_enviado`: con cobro real el único que cierra es el cotejo del comprobante.
 * Lo consulta `registrarCierre`; el modo simulado sigue cerrando por ahí.
 */
export function cierreDeVentaLoHaceElCotejo(previa: unknown, ahoraMs: number): boolean {
  const p = comoPlano(previa);
  if (!p || !esReglaDos(p)) return false;
  const limite = limiteDe(p);
  return cierreBloqueadoPorCobro(p, ahoraMs)
    || (p['etapa'] === 'qr_enviado' && limite !== null && ahoraMs < limite);
}

/**
 * Qué `solicitud` queda guardada después de este mensaje. `null` = no se toca.
 *
 * ES PURA Y ESTÁ PROBADA APARTE, como `contadoresDelMensaje`: sobre esto se
 * decide si el próximo archivo del paciente se coteja como pago y si le llega
 * un recordatorio, y la decisión separada de la base se prueba sin emulador.
 *
 * `previa` es lo que hay guardado. Por evento:
 *
 *  - `qr_enviado` SIEMPRE abre una solicitud nueva, aunque hubiera una: el
 *    flujo manda el QR cuando acaba de retener una cita, y esa cita nueva es
 *    la que hay que seguir, no la de hace dos días que venció o ya se pagó.
 *  - `horarios_ofrecidos` abre una solicitud `horarios` SOLO si no hay
 *    ninguna, o si la que hay está cerrada (`agendada` o `vencida`) desde hace
 *    más de 24 h: el paciente que agendó ayer y hoy pregunta por otro horario
 *    no es una solicitud pendiente nueva, es el mismo asunto. Sobre una
 *    `horarios` ya abierta NO cambia `desde` ni los contadores —si cambiara,
 *    cada turno con horarios reiniciaría el reloj del seguimiento y el
 *    recordatorio no saldría nunca—, y sobre un `qr_enviado` no toca nada: la
 *    seña pendiente manda.
 *  - `cita_agendada` (lo llama `registrarCierre` tipo cita, con la cita ya en
 *    el calendario) cierra la solicitud pendiente como `agendada`. Sin
 *    solicitud, la crea ya `agendada`: así un `horarios_ofrecidos` de la
 *    misma conversación en las 24 h siguientes no abre una pendiente que no
 *    existe. Sobre una `agendada` no mueve nada (idempotente).
 *
 * `merge: true` de Firestore fusiona los mapas campo a campo, así que una
 * solicitud nueva escribe TODOS sus campos, incluidos los nulos: si no, el
 * `seguimientoEn` de la solicitud anterior sobreviviría en la nueva.
 */
export function solicitudTras(
  previa: unknown,
  evento: string | undefined,
  ahoraMs: number,
  datos: {
    referencia?: string; calendario?: string; inicio?: string; nueva?: string; monto?: number;
    /** Solo con `cita_agendada`: el comercio tiene cobro REAL activo (lo lee `registrarCierre`). */
    cobroReal?: boolean;
  },
): Solicitud | null {
  const ahora = Timestamp.fromMillis(ahoraMs);
  const p = typeof previa === 'object' && previa !== null ? (previa as Partial<Solicitud>) : null;
  const etapaPrevia = typeof p?.etapa === 'string' ? p.etapa : '';

  if (evento === 'qr_enviado') {
    const id = (datos.referencia ?? '').trim();
    return {
      ...solicitudNueva('qr_enviado', ahora),
      qrEnviadoEn: ahora,
      // Sin identificador de la cita no hay cita que seguir: el cotejo igual
      // corre (el cierre se referencia con el mensaje del comprobante), pero
      // `senaVencida` no tiene qué borrar. El flujo siempre lo manda.
      //
      // EN VENTA, `referencia` es SIEMPRE el pedido (el `cat_…` del carrito web
      // o su id; con `reglaCobro: 2` nunca el id del mensaje del QR: la
      // ingesta lo trata como `sin_id_meta`) y `calendario` no viene: no hay agenda. La forma
      // del campo no cambia porque lo que significa es lo mismo —qué quedó
      // reservado esperando este pago— y duplicarlo por vertical partiría en
      // dos una regla que es una sola.
      evento: id ? { id, calendario: (datos.calendario ?? '').trim() } : null,
      // EL TOTAL COTIZADO, en venta. Se escribe acá y no se vuelve a tocar: es
      // el número contra el que se cotejará el comprobante (`cobroVenta.ts`).
      monto: totalUtilizable(datos.monto),
    };
  }

  if (evento === 'horarios_ofrecidos') {
    // Una solicitud NUEVA sobre los restos de un cobro de regla 2 los anula
    // (`merge` los conservaría): si no, `reglaCobro`/`venceEn` sobrevivirían.
    const nueva = (): Solicitud => (p as Record<string, unknown> | null)?.['reglaCobro'] === 2
      ? { ...solicitudNueva('horarios', ahora), ...CAMPOS_REGLA_2_EN_NULO } as Solicitud
      : solicitudNueva('horarios', ahora);
    if (!p || etapaPrevia === '') return nueva();
    if (ETAPAS_PENDIENTES.has(etapaPrevia)) return null;
    // Un cobro de regla 2 EN REVISIÓN está con una persona: no se reemplaza,
    // ni siquiera pasadas 24 h (perdería sus comprobantes y subidas).
    if (etapaPrevia === 'en_revision' && esReglaDos(p as Record<string, unknown>)) return null;
    const desdeMs = milisegundosDe(p.desde);
    const cerradaHaceMas24h = desdeMs === null || ahoraMs - desdeMs >= MS_VENTANA_ATENCION;
    return cerradaHaceMas24h ? nueva() : null;
  }

  // CANCELÓ UNA CITA PAGADA: el adelanto queda a su favor, si hubo anticipación.
  // Solo la cita de ESTA solicitud, ya pagada (`agendada` con cotejo): una cita
  // sin seña, o de otra solicitud, no deja ningún crédito. Sin anticipación —o
  // sin saber cuándo era— no se da: lo resuelve recepción.
  if (evento === 'cita_cancelada') {
    const id = (datos.referencia ?? '').trim();
    const pagada = etapaPrevia === 'agendada' && typeof p?.cotejos === 'number' && p.cotejos > 0
      && !!p?.evento && p.evento.id === id && id !== '';
    if (!pagada) return null;
    const inicioMs = Date.parse(datos.inicio ?? '');
    const conAnticipacion = Number.isFinite(inicioMs)
      && inicioMs - ahoraMs >= HORAS_ANTICIPACION_PARA_CANCELAR * 3_600_000;
    if (!conAnticipacion) return null;
    return {
      ...solicitudNueva('a_favor', ahora), ...p, etapa: 'a_favor', desde: ahora, evento: null,
      aFavorHasta: Timestamp.fromMillis(ahoraMs + DIAS_ADELANTO_A_FAVOR * 24 * 3_600_000),
      aFavorDe: p!.evento ?? null,
    };
  }

  // REPROGRAMADA EN UN SOLO TURNO: la cancelación y la aplicación juntas. Misma
  // regla que las dos por separado —cita pagada de esta solicitud, con
  // anticipación—, y el adelanto pasa directo a la cita nueva, sin quedar «a
  // favor» en el medio. Si la regla no se cumple, no se toca nada.
  if (evento === 'reprogramada') {
    const nueva = (datos.nueva ?? '').trim();
    if (!nueva) return null;
    const aFavor = solicitudTras(previa, 'cita_cancelada', ahoraMs, datos);
    if (!aFavor) return null;
    return solicitudTras(aFavor, 'adelanto_aplicado', ahoraMs, { referencia: nueva, calendario: datos.calendario });
  }

  // SE APLICÓ EL ADELANTO A UNA CITA NUEVA: vuelve a `agendada`, con la cita
  // nueva. Una sola vez, y solo dentro del plazo: vencido, no se aplica nada.
  if (evento === 'adelanto_aplicado') {
    const id = (datos.referencia ?? '').trim();
    const hasta = milisegundosDe(p?.aFavorHasta);
    if (etapaPrevia !== 'a_favor' || !id || hasta === null || ahoraMs >= hasta) return null;
    return {
      ...solicitudNueva('agendada', ahora), ...p, etapa: 'agendada', desde: ahora,
      evento: { id, calendario: (datos.calendario ?? '').trim() }, aFavorHasta: null,
    };
  }

  if (evento === 'cita_agendada') {
    if (etapaPrevia === 'agendada') return null;
    // REGLA 2 (obligación (c) de `cobros.md` §4duodecies.6): un cobro en
    // revisión, cancelado o vencido (escrito, o por reloj sin que nadie lo
    // anotara) NO se cierra como agendado: el cierre de la cita no resucita un
    // pedido que ya no está en curso. Con regla 1 nada cambia.
    if (cierreBloqueadoPorCobro(previa, ahoraMs)) return null;
    // Con COBRO REAL, un cobro de regla 2 a tiempo (`qr_enviado`) lo cierra solo
    // el cotejo, sea cual sea el `tipo` del cierre que lo pida (una cita del
    // mismo teléfono no lo cierra): la solicitud no se mueve.
    if (datos.cobroReal === true && cierreDeVentaLoHaceElCotejo(previa, ahoraMs)) return null;
    // Un cobro de regla 2 cerrado hace MÁS de 24 h es otra conversación: el
    // cierre crea su solicitud nueva y anula los restos (`merge` los conservaría).
    const pp = comoPlano(previa);
    if (pp && esReglaDos(pp) && cobroDosCerrado(pp, ahoraMs)) {
      return { ...solicitudNueva('agendada', ahora), ...CAMPOS_REGLA_2_EN_NULO } as Solicitud;
    }
    if (!p || etapaPrevia === '') return solicitudNueva('agendada', ahora);
    return { ...solicitudNueva('agendada', ahora), ...p, etapa: 'agendada', desde: ahora };
  }

  return null;
}

/**
 * ¿Este mensaje REACTIVA una solicitud que recibió seguimiento? Sí cuando es
 * del cliente, hay un seguimiento enviado hace menos de 24 h y es el primer
 * mensaje suyo después de ese seguimiento (`reactivadaEn` todavía vacío).
 * Cuenta `reactivadas` en el mes: es la cifra que dice si el recordatorio
 * recupera a alguien o solo cuesta (`Analisis/31` §6). Pura, probada aparte.
 */
export function reactivaTras(
  previa: unknown, direccion: 'entrante' | 'saliente', ahoraMs: number,
): boolean {
  if (direccion !== 'entrante') return false;
  const p = typeof previa === 'object' && previa !== null ? (previa as Partial<Solicitud>) : null;
  if (!p) return false;
  const seguimientoMs = milisegundosDe(p.seguimientoEn);
  if (seguimientoMs === null) return false;
  if (milisegundosDe(p.reactivadaEn) !== null) return false;
  const transcurrido = ahoraMs - seguimientoMs;
  return transcurrido >= 0 && transcurrido < MS_VENTANA_ATENCION;
}
