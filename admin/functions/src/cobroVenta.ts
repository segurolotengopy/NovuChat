/**
 * =============================================================================
 * COBRO REAL DE UNA VENTA — lo propio de vender, frente a lo propio de agendar
 * =============================================================================
 *
 * POR QUÉ ESTE MÓDULO EXISTE. La maquinaria del cobro por QR se construyó para
 * la SEÑA de una reserva (`sena.ts`, `Analisis/30` §4): un importe FIJO que
 * vive en la configuración del comercio, un horario que se retiene y un reloj
 * que lo libera. Una venta no tiene nada de eso. Tiene un pedido, y el pedido
 * tiene un total distinto cada vez.
 *
 * LA DIFERENCIA QUE ORDENA TODO LO DEMÁS, y es una sola:
 *
 *   En una reserva, el importe esperado se LEE de la configuración.
 *   En una venta, el importe esperado se FIJA cuando sale el QR.
 *
 * De ahí sale la regla de este archivo: **el importe contra el que se coteja es
 * el que se cotizó en el momento de mandar el QR, no el que alguien repita
 * después**. El flujo lo reporta junto con el QR (`evento: 'qr_enviado'`,
 * campo `monto`), la ingesta lo guarda en `solicitud.monto` dentro de la misma
 * transacción que cuenta ese mensaje, y el cotejo lo lee de ahí. Es «por hecho,
 * no por dicho» aplicado al dinero: si el modelo escribiera después «son 200»,
 * no cambia nada, porque el número ya está guardado.
 *
 * Y CUANDO EL PEDIDO VINO DEL CARRITO WEB, el importe es todavía mejor:
 * `pedidos/{id}.total` lo calculó el servidor (`catalogoWeb.ts`, incluido el
 * costo de envío, «también del servidor, nunca del navegador»). Si la solicitud
 * trae un pedido, ese total gana sobre lo que mande el flujo.
 *
 * LO QUE NO SE PORTA DE LA SEÑA, y conviene decir por qué:
 *
 *  - **La retención del horario.** No hay horario que liberar. Lo que sí hay es
 *    un QR pendiente que tiene que CADUCAR, para que la foto de un pago de
 *    anteayer no se coteje contra el pedido de hoy (ver `MINUTOS_QR_VENTA`).
 *  - **El adelanto a favor.** Lo contrario de una cita cancelada con seña es
 *    una devolución de dinero, y eso no lo decide un asistente.
 *
 * LA PROHIBICIÓN 3 NO CAMBIA NI UNA LETRA. Con cobro real el asistente nunca
 * dice «pago acreditado», «pago verificado» ni «recibimos tu pago»: dice que el
 * comprobante llegó y que los datos coinciden. Quien confirma que entró la
 * plata es el negocio, en su banco. Ninguna frase de este archivo afirma un
 * pago, y `pruebas/cobro-venta.test.ts` lo comprueba con una expresión regular
 * sobre cada texto que sale de acá.
 */

import type { Esperado } from './cotejo.js';
import type { ResultadoCotejo } from './sena.js';

/**
 * CUÁNTO VIVE UN QR DE VENTA SIN PAGAR, en minutos.
 *
 * En una reserva el plazo es corto y tiene un motivo duro: hay un horario
 * bloqueado que otro paciente quiere. En una venta no hay nada bloqueado, así
 * que apretar el plazo solo sirve para castigar al cliente que fue al banco y
 * volvió media hora después.
 *
 * VEINTICUATRO HORAS, que es la ventana de la conversación (`Analisis/27`).
 * Dentro de ella el pedido sigue siendo el mismo asunto y el pago le
 * corresponde; fuera, es otra conversación y el comprobante lo mira una
 * persona. El plazo se ata a una unidad que ya existe en el sistema, en vez de
 * inventar un número nuevo que nadie pueda defender.
 */
export const MINUTOS_QR_VENTA = 24 * 60;

/** Techo del total de un pedido que se acepta para cotejar. Un número fuera de rango no coteja. */
export const TOTAL_VENTA_MAXIMO = 1_000_000;

/**
 * El identificador del cierre de una venta cotejada.
 *
 * ES LA MISMA CUENTA que `idDesdeReferencia` de `cierres.ts` —tipo, guion bajo,
 * referencia saneada a `[a-zA-Z0-9_-]` y recortada— y tiene que seguir
 * siéndolo: el cierre que crea el cotejo y el que crearía `registrarCierre`
 * para la misma venta tienen que caer en el MISMO documento, o la venta se
 * contaría dos veces. `pruebas/cobro-venta.test.ts` compara las dos.
 */
export function idDeCierreDeVenta(referencia: string): string {
  return `venta_${referencia.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)}`;
}

/**
 * Lo que se ESPERA del comprobante de una venta.
 *
 * Igual que `esperadoDeLaSena`, pero el importe entra por parámetro en vez de
 * leerse de la configuración. Pura, para poder probar que el total que se
 * coteja es el del pedido y que la ventana de fechas va desde el envío del QR
 * hasta la llegada del comprobante.
 */
export function esperadoDeLaVenta(
  total: number,
  cobroReal: Record<string, unknown> | undefined,
  qrEnviadoEnMs: number,
  ahoraMs: number,
  toleranciaMin: number,
): Esperado {
  const cuentas = Array.isArray(cobroReal?.['cuentas'])
    ? (cobroReal['cuentas'] as unknown[]).slice(0, 5).map(String) : [];
  return {
    monto: total,
    nombreCuenta: String(cobroReal?.['nombreCuenta'] ?? ''),
    cuentas,
    qrEnviadoEn: qrEnviadoEnMs,
    comprobanteRecibidoEn: ahoraMs,
    toleranciaMin,
  };
}

/**
 * ¿Es un total de pedido utilizable para cotejar?
 *
 * Un total que no se puede usar NO se convierte en cero: con cero, el cotejo
 * diría «el comprobante dice 350 y el pedido es de 0» y mandaría a una persona
 * con un motivo falso. Sin total no se coteja nada y se lo dice tal cual.
 */
export function totalUtilizable(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v <= 0 || v > TOTAL_VENTA_MAXIMO) return null;
  return Math.round(v * 100) / 100;
}

/** La frase del detalle privado del cierre, por resultado. Sin «acreditado». */
export function detalleDeLaVenta(total: number, moneda: string, resultado: ResultadoCotejo): string {
  const palabra = resultado === 'cuadra' ? 'los datos coinciden'
    : resultado === 'no_cuadra' ? 'con una diferencia' : 'ilegible';
  return `Pedido de ${total} ${moneda === 'BOB' ? 'Bs' : moneda}, comprobante ${palabra}`;
}

/**
 * ===========================================================================
 * EL COBRO, COMO LO RECIBE EL FLUJO DE VENTA (`configuracionFlujo.cobro`)
 * ===========================================================================
 *
 * Es el gemelo de `SenaParaElFlujo`, y existe por una razón que no es de
 * simetría: **sin esto, el flujo no sabe si hay un QR pendiente**, y sin eso
 * una foto cualquiera se toma por comprobante. Es lo que el Demo B hacía hasta
 * hoy —`esComprobante = true` para toda imagen— y es la puerta por la que se
 * colaba un cierre de venta que nadie pagó.
 *
 * SALE EN LOS DOS MODOS, real y simulado, y esto es deliberado: la compuerta
 * del comprobante tiene que funcionar también en la demostración, o el camino
 * que se prueba delante de un prospecto no es el que corre en producción.
 * `activo` distingue uno de otro; `pendiente` es del teléfono que escribió.
 *
 * QUÉ NO VIAJA: la carga útil del QR. Viaja su dirección pública, que el flujo
 * pone tal cual en el `link` del mensaje de imagen de WhatsApp.
 */
export interface CobroParaElFlujo {
  /** Cobro REAL encendido. `false` = el comercio está en cobro simulado. */
  activo: boolean;
  moneda: string;
  /** Importe grabado en el QR, si se pudo leer. En una venta, tenerlo es un defecto. */
  montoFijo: number | null;
  qr: { url: string; nombreCuenta: string; banco: string } | null;
  /** Hay un QR enviado y sin comprobante que cuadre: el próximo archivo se lee como comprobante. */
  pendiente: boolean;
  /** El total que se cotizó al mandar el QR. `null` si el flujo no lo mandó. */
  monto: number | null;
  /** El pedido al que corresponde el QR pendiente (`cat_…` si vino del carrito), o `null`. */
  pedido: string | null;
  qrEnviadoEn: string | null;
  /**
   * MINUTOS DESDE QUE EL QR PENDIENTE CADUCÓ, o `null`. Es el caso del cliente
   * que paga tarde: el comprobante llega, el pedido ya no está en curso, y el
   * asistente tiene que decir la verdad —llegó el comprobante, lo revisa una
   * persona— en vez de preguntarle «¿a qué corresponde?» a alguien que acaba de
   * pagar lo que se le pidió.
   */
  vencidoHaceMin: number | null;
}

/** La ventana en la que un pago tardío sigue siendo ESTE caso y no otra conversación. */
const MINUTOS_DE_UN_DIA = 24 * 60;

/** Milisegundos de un Timestamp de Firestore, de un ISO o de un número. */
function ms(v: unknown): number | null {
  const t = v as { toMillis?: () => number; seconds?: unknown } | null | undefined;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const p = Date.parse(v); return Number.isFinite(p) ? p : null; }
  return null;
}

/**
 * ¿El QR de venta pendiente ya caducó por reloj?
 *
 * Misma forma que `senaVencidaPorTiempo` y misma razón de fondo: un pendiente
 * que no caduca nunca convierte cualquier imagen en un pago. Acá no hay
 * calendario que lo cierre por el otro lado, así que el reloj es lo único que
 * hay, y por eso esta función es la que manda.
 */
export function qrDeVentaVencido(
  solicitud: { etapa?: unknown; qrEnviadoEn?: unknown } | null | undefined,
  ahoraMs: number,
  minutos: number = MINUTOS_QR_VENTA,
): { vencido: boolean; venceMs: number | null } {
  if (!solicitud || solicitud.etapa !== 'qr_enviado') return { vencido: false, venceMs: null };
  const enviado = ms(solicitud.qrEnviadoEn);
  if (enviado === null) return { vencido: false, venceMs: null };
  const venceMs = enviado + minutos * 60 * 1000;
  return { vencido: ahoraMs >= venceMs, venceMs };
}

export function cobroParaElFlujo(
  venta: Record<string, unknown> | undefined,
  cobroRealActivo: boolean,
  moneda: string,
  urlDelQr: (ficha: string) => string,
  solicitud: unknown,
  ahoraMs: number = Date.now(),
): CobroParaElFlujo {
  const cobroReal = (venta?.['cobroReal'] ?? {}) as Record<string, unknown>;
  const s = (typeof solicitud === 'object' && solicitud !== null ? solicitud : {}) as Record<string, unknown>;
  const enviado = s['qrEnviadoEn'];
  const porReloj = qrDeVentaVencido(s, ahoraMs);
  const ev = s['evento'] as Record<string, unknown> | null | undefined;

  return {
    activo: cobroRealActivo,
    moneda,
    montoFijo: typeof cobroReal['montoFijo'] === 'number' ? cobroReal['montoFijo'] : null,
    qr: cobroRealActivo
      ? {
          url: urlDelQr(String(cobroReal['ficha'] ?? '')),
          nombreCuenta: String(cobroReal['nombreCuenta'] ?? ''),
          banco: String(cobroReal['banco'] ?? ''),
        }
      : null,
    // PENDIENTE ES POR ETAPA Y POR RELOJ, igual que la seña: un QR cuyo plazo
    // pasó ya no está pendiente, y la próxima imagen vuelve a ser una imagen.
    pendiente: s['etapa'] === 'qr_enviado' && !porReloj.vencido,
    monto: totalUtilizable(s['monto']),
    pedido: ev && typeof ev['id'] === 'string' && ev['id'] !== '' ? ev['id'] : null,
    qrEnviadoEn: ms(enviado) !== null ? new Date(ms(enviado) as number).toISOString() : null,
    vencidoHaceMin: (() => {
      if (!porReloj.vencido || porReloj.venceMs === null) return null;
      const min = Math.floor((ahoraMs - porReloj.venceMs) / 60000);
      return min >= 0 && min <= MINUTOS_DE_UN_DIA ? min : null;
    })(),
  };
}
