import { reactivaTras, solicitudTras } from './solicitud.js';
import { CAMPOS_REGLA_2_EN_NULO, solicitudDeCobroTras, totalUtilizable, type EventoDeCobro } from '../cobros/cobroVenta.js';

/**
 * LA SOLICITUD EN CURSO DE UN MENSAJE (F3b-2e, `Analisis/41` §7 F3b).
 *
 * Es el trozo de la transacción de la ingesta que antes vivía en `ingesta.ts`,
 * movido SIN cambiar lógica: Agenda arma la solicitud (seña, seguimiento) y
 * Cobros (regla 2) mezcla sus cambios encima. Agenda declara `dependeDe:
 * ['cobros']`, por eso este archivo es de Agenda y no al revés. Es una
 * función PURA: no lee ni escribe; el coordinador la llama dentro de su
 * transacción con lo que ya leyó (cero lecturas y cero escrituras nuevas).
 */

/** Lo que mira la solicitud de un mensaje (un subconjunto de lo que ya normalizó la ingesta). */
export interface MensajeDeSolicitud {
  readonly evento?: Parameters<typeof solicitudTras>[1];
  readonly reglaCobro?: 2 | undefined;
  readonly idMeta?: string | undefined;
  readonly referencia?: string | undefined;
  readonly calendario?: string | undefined;
  readonly inicio?: string | undefined;
  readonly nueva?: string | undefined;
  readonly monto?: number | undefined;
  readonly direccion: Parameters<typeof reactivaTras>[1];
}

export interface SolicitudDelTurno {
  /** La solicitud que se escribe (completa si hay base; parcial si solo vino del cobro), o `null`. */
  readonly solicitud: ReturnType<typeof solicitudTras>;
  /** ¿Hubo solicitud de agenda (base)? Si no, la solicitud es un parche del cobro. */
  readonly hayBase: boolean;
  /** Un QR ignorado o sin id de Meta: ni se escribe solicitud ni se cuenta el QR. */
  readonly sinQr: boolean;
  /** El primer mensaje del paciente dentro de las 24 h de un seguimiento. */
  readonly reactivada: ReturnType<typeof reactivaTras>;
  /** El resultado del cobro (efecto y contadores de métricas), o `null` si el mensaje no trae hecho de cobro. */
  readonly cobro: ReturnType<typeof solicitudDeCobroTras> | null;
}

/** El total de un pedido que viaja en el cuerpo: solo un número finito y positivo dentro del techo. */
export const montoUtilizable = totalUtilizable;

export function solicitudDelTurno(solicitudPrevia: unknown, mensaje: MensajeDeSolicitud, ahoraMs: number): SolicitudDelTurno {
  // Con regla 2, una `referencia` vacía o igual al `idMeta` no identifica un
  // pedido (cada reenvío sería un cobro nuevo con plazo nuevo): se trata
  // como `sin_id_meta` y no abre cobro.
  const sinPedido = mensaje.reglaCobro === 2
    && (!mensaje.referencia || mensaje.referencia === (mensaje.idMeta ?? '').trim());
  const eventoDeCobro: EventoDeCobro | null =
    mensaje.evento === 'qr_enviado'
      ? { tipo: 'qr_enviado', reglaCobro: mensaje.reglaCobro, idMeta: sinPedido ? undefined : mensaje.idMeta,
          referencia: mensaje.referencia, monto: mensaje.monto }
      : mensaje.evento === 'cobro_cancelado' ? { tipo: 'cobro_cancelado' }
      : mensaje.evento === 'anulacion_avisada' ? { tipo: 'anulacion_avisada' } : null;
  const cobro = eventoDeCobro ? solicitudDeCobroTras(solicitudPrevia, eventoDeCobro, ahoraMs) : null;
  const sinQr = cobro !== null && mensaje.evento === 'qr_enviado'
    && (cobro.efecto === 'ignorado' || cobro.efecto === 'sin_id_meta');
  const base = sinQr ? null : solicitudTras(solicitudPrevia, mensaje.evento, ahoraMs,
    { referencia: mensaje.referencia, calendario: mensaje.calendario, inicio: mensaje.inicio,
      nueva: mensaje.nueva, monto: mensaje.monto });
  const cambiosDeCobro = cobro?.efecto === 'regla_1' && cobro.cambios
    ? { ...cobro.cambios, ...CAMPOS_REGLA_2_EN_NULO } : cobro?.cambios ?? null;
  const solicitud = sinQr ? null : base ? (cambiosDeCobro ? { ...base, ...cambiosDeCobro } : base)
    : cambiosDeCobro;
  // REACTIVADA (bloque 4): el primer mensaje del paciente dentro de las 24 h de un seguimiento.
  const reactivada = reactivaTras(solicitudPrevia, mensaje.direccion, ahoraMs);
  return { solicitud: solicitud as SolicitudDelTurno['solicitud'], hayBase: !!base, sinQr, reactivada, cobro };
}
