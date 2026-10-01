/**
 * =============================================================================
 * LA RETENCIÓN DE UNA SEÑA, EN EL TIEMPO
 * =============================================================================
 *
 * Módulo propio porque lo usan dos lados que no pueden importarse entre sí:
 * `sena.ts` (el cotejo y el vencimiento) ya importa de `ingesta.ts`, e
 * `ingesta.ts` (lo que recibe el flujo) necesita la misma regla. Una regla que
 * vive en dos copias termina diciendo dos cosas distintas.
 */

/**
 * CUÁNTO SE PROTEGE UNA CITA CON UN COMPROBANTE QUE NO CUADRÓ.
 *
 * Las dos posturas puras están mal, y las dos costaron algo el 20/09/2026:
 *
 *  - Liberar siempre: el paciente pagó de verdad, el cotejo dijo «no cuadra»
 *    por un defecto NUESTRO --no entendía «20 de Septiembre, 2026»--, el
 *    asistente le prometió «tu horario sigue reservado», y cinco minutos
 *    después la cita se borró. Perdió el turno que pagó.
 *  - Proteger siempre: cualquier imagen mandada a propósito bloquea un horario
 *    para siempre, que es el problema que las huérfanas vinieron a resolver.
 *
 * El híbrido es el TIEMPO: un comprobante que no cuadra abre una revisión
 * humana --recepción ya recibió el aviso con la diferencia-- y la cita se
 * protege mientras esa persona puede actuar. Pasada la ventana, el horario se
 * libera igual, pero NO en silencio: queda contado y anotado como liberado CON
 * un comprobante de por medio, que es lo que hay que ir a mirar.
 *
 * Dos horas: alcanza para que alguien abra el banco y conteste, y no quema el
 * día del horario. Un comprobante que SÍ cuadró no entra acá: esa cita no se
 * libera nunca (`cita_pagada`).
 */
export const MINUTOS_DE_REVISION = 120;

/** La marca de un `Timestamp` de Firestore, de un ISO o de un número. */
export function marcaMs(v: unknown): number | null {
  const t = v as { toMillis?: () => number; _seconds?: unknown; seconds?: unknown } | undefined;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  const seg = (t?._seconds ?? t?.seconds);
  if (typeof seg === 'number') return seg * 1000;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const p = Date.parse(v); return Number.isFinite(p) ? p : null; }
  return null;
}

/**
 * ¿Hay un comprobante esperando a una persona, y todavía dentro de la ventana?
 *
 * `desdeSiFalta` es la marca de respaldo cuando el cierre no guardó `en`: se
 * usa cuándo se creó la cita, para que la ventana SIEMPRE tenga un final. Sin
 * ninguna de las dos no se puede acotar nada, y entonces se protege: el que
 * mandó un comprobante pesa más que un horario, y queda a la vista igual.
 */
export function comprobanteEnRevision(
  cotejo: { resultado?: unknown; en?: unknown } | undefined,
  ahoraMs: number, desdeSiFalta: number | null = null,
): boolean {
  const r = cotejo?.resultado;
  if (r !== 'no_cuadra' && r !== 'ilegible') return false;
  const desde = marcaMs(cotejo?.en) ?? desdeSiFalta;
  if (desde === null) return true;
  return (ahoraMs - desde) < MINUTOS_DE_REVISION * 60 * 1000;
}

/**
 * ¿LA SEÑA PENDIENTE YA VENCIÓ POR TIEMPO? (Andres, 20/09/2026: «el QR y la
 * reserva pendiente de pago deberían soltarse a los 15 minutos, porque así es
 * la regla que pusimos».)
 *
 * Hasta hoy la seña pasaba a «vencida» SOLO cuando el flujo de señas vencidas
 * encontraba en el calendario la misma cita que la solicitud tenía anotada. Si
 * esa coincidencia no llegaba nunca —la cita la borró alguien a mano, o la
 * solicitud quedó atada a la cita de otro paciente, que es lo que pasó el 20/09
 * con dos reservas a un minuto—, la seña quedaba PENDIENTE PARA SIEMPRE: el
 * asistente seguía pidiendo el comprobante y cualquier imagen se cotejaba como
 * pago de una reserva que ya no existía.
 *
 * El calendario sigue liberando el horario; esto hace que la SEÑA venza por el
 * reloj, que es la regla. Con un comprobante en revisión el plazo es el de la
 * revisión (`MINUTOS_DE_REVISION`), el mismo que usa `senaVencida` para no
 * borrar la cita: mientras una persona puede resolverlo, la seña sigue viva.
 */
export function senaVencidaPorTiempo(
  solicitud: { etapa?: unknown; qrEnviadoEn?: unknown; cotejos?: unknown } | null | undefined,
  minutosRetencion: number,
  ahoraMs: number,
): { vencida: boolean; venceMs: number | null } {
  if (!solicitud || solicitud.etapa !== 'qr_enviado') return { vencida: false, venceMs: null };
  const enviado = marcaMs(solicitud.qrEnviadoEn);
  if (enviado === null) return { vencida: false, venceMs: null };
  const conComprobante = typeof solicitud.cotejos === 'number' && solicitud.cotejos > 0;
  const plazo = conComprobante ? Math.max(minutosRetencion, MINUTOS_DE_REVISION) : minutosRetencion;
  const venceMs = enviado + plazo * 60 * 1000;
  return { vencida: ahoraMs >= venceMs, venceMs };
}
