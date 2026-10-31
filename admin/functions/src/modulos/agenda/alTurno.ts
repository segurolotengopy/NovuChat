import type { GanchoDelTurno } from '../../core/turno/ganchosDelTurno.js';
import { milisegundosDe } from '../../core/turno/tiempo.js';
import { MINUTOS_RETENCION_POR_DEFECTO, senaVencidaPorTiempo } from './retencion.js';

/**
 * EL GANCHO DE LA SEÑA EN EL TURNO (F3b-2d, `Analisis/41` §2.3 y §7 F3b).
 *
 * La seña es una pieza de Cobros (`MODULO_DE_GANCHO.sena = 'cobros'`) pero su
 * lógica vive aquí, con la retención y la solicitud de la cita: Cobros no puede
 * importar Agenda (Agenda depende de Cobros, y la frontera solo va hacia abajo).
 *
 * `modulosDelTurno` habilita este gancho en cualquier número con Cobros; que
 * corra SOLO en el número de agendamiento lo decide `contexto.flujo`, igual que
 * hacía `ingesta.ts` con `comercio.flujo`. No se mira el módulo.
 */
/**
 * ===========================================================================
 * LA SEÑA, COMO LA RECIBE EL FLUJO DE RESERVAS (`configuracionFlujo.sena`)
 * ===========================================================================
 *
 * `activa` exige LAS DOS cosas: un importe mayor que cero en
 * `config/agendamiento` Y el QR del comercio registrado y encendido
 * (`cobroReal`, el mismo criterio que el cobro real de venta: activo, con
 * ficha y con código). Un importe sin QR no puede cobrar; un QR sin importe no
 * tiene qué cobrar. En cualquiera de los dos casos el flujo agenda como
 * siempre, sin seña, y no manda ningún mensaje de más.
 *
 * Cuando NO está activa se devuelve igual el objeto, con `importe` 0 y
 * `qr` nulo, y no `null`: así el flujo distingue «este comercio no cobra
 * seña» de «el panel no contestó», que es lo que lo manda al respaldo.
 *
 * `pendiente`, `evento` y `qrEnviadoEn` son de la SOLICITUD del teléfono que
 * escribió, si el flujo mandó `telefono`: le dicen si el próximo archivo se
 * lee como comprobante y qué cita está retenida. Sin teléfono, van vacíos.
 */
export const IMPORTE_SENA_MAXIMO = 10000;

/** Un día, en minutos: la ventana en la que un pago tardío sigue siendo ESTE caso. */
const MINUTOS_DE_UN_DIA = 24 * 60;

export interface SenaParaElFlujo {
  activa: boolean;
  importe: number;
  moneda: string;
  minutosRetencion: number;
  qr: { url: string; nombreCuenta: string; banco: string } | null;
  pendiente: boolean;
  evento: { id: string; calendario: string } | null;
  qrEnviadoEn: string | null;
  /**
   * MINUTOS DESDE QUE SE LIBERÓ EL HORARIO por falta de pago, o `null`.
   *
   * Existe por un caso que solo aparece con dinero de por medio (19/09/2026):
   * el paciente no paga a tiempo, el horario se libera, y DESPUÉS paga. Hasta
   * ahora el flujo no distinguía eso de un comprobante caído del cielo y le
   * preguntaba «¿a qué corresponde?», que es lo peor que se le puede decir a
   * alguien que acaba de pagar lo que el asistente le pidió. Con esto el flujo
   * sabe que hubo una seña de ESE teléfono que venció recién, y puede decir la
   * verdad: llegó el comprobante, el horario ya se había liberado, lo resuelve
   * una persona. La ventana es de un día: más allá, es otra conversación.
   */
  vencidaHaceMin: number | null;
  /** El adelanto a favor vigente de este teléfono (Andres, 21/09/2026), o `null`. */
  aFavor: { hasta: string } | null;
}

export function senaParaElFlujo(
  agendamiento: Record<string, unknown> | undefined,
  cobroRealActivo: boolean,
  moneda: string,
  urlDelQr: (ficha: string) => string,
  solicitud: unknown,
): SenaParaElFlujo {
  const importeCrudo = agendamiento?.['senaImporte'];
  const importe = typeof importeCrudo === 'number' && Number.isInteger(importeCrudo)
    && importeCrudo > 0 && importeCrudo <= IMPORTE_SENA_MAXIMO ? importeCrudo : 0;
  const minutosCrudo = agendamiento?.['senaMinutosRetencion'];
  const minutosRetencion = typeof minutosCrudo === 'number' && Number.isInteger(minutosCrudo)
    && minutosCrudo >= 5 && minutosCrudo <= 180 ? minutosCrudo : MINUTOS_RETENCION_POR_DEFECTO;
  const cobroReal = (agendamiento?.['cobroReal'] ?? {}) as Record<string, unknown>;
  const activa = importe > 0 && cobroRealActivo;

  const s = (typeof solicitud === 'object' && solicitud !== null ? solicitud : {}) as Record<string, unknown>;
  const ev = s['evento'] as Record<string, unknown> | null | undefined;
  const enviado = s['qrEnviadoEn'] as { toMillis?: () => number } | null | undefined;
  const porReloj = senaVencidaPorTiempo(s, minutosRetencion, Date.now());
  return {
    activa,
    importe: activa ? importe : 0,
    moneda,
    minutosRetencion,
    qr: activa
      ? {
          // La imagen no viaja: viaja su dirección pública, que el flujo pone
          // tal cual en el `link` del mensaje de imagen de WhatsApp.
          url: urlDelQr(String(cobroReal['ficha'] ?? '')),
          nombreCuenta: String(cobroReal['nombreCuenta'] ?? ''),
          banco: String(cobroReal['banco'] ?? ''),
        }
      : null,
    // PENDIENTE ES POR ETAPA Y POR RELOJ (20/09/2026): una seña cuyo plazo pasó
    // ya no está pendiente aunque el calendario no la haya vencido todavía
    // (`retencion.ts`, `senaVencidaPorTiempo`).
    pendiente: s['etapa'] === 'qr_enviado' && !porReloj.vencida,
    evento: ev && typeof ev['id'] === 'string' && ev['id'] !== ''
      ? { id: ev['id'], calendario: String(ev['calendario'] ?? '') } : null,
    qrEnviadoEn: typeof enviado?.toMillis === 'function'
      ? new Date(enviado.toMillis()).toISOString() : null,
    vencidaHaceMin: (() => {
      // Vencida por el calendario (etapa) o por el reloj: en los dos casos el
      // flujo tiene que tratar un comprobante que llega como pago TARDÍO.
      let desdeMs: number | null = null;
      if (s['etapa'] === 'vencida') {
        const desde = s['desde'] as { toMillis?: () => number } | null | undefined;
        desdeMs = typeof desde?.toMillis === 'function' ? desde.toMillis() : null;
      } else if (porReloj.vencida) {
        desdeMs = porReloj.venceMs;
      }
      if (desdeMs === null) return null;
      const min = Math.floor((Date.now() - desdeMs) / 60000);
      return min >= 0 && min <= MINUTOS_DE_UN_DIA ? min : null;
    })(),
    aFavor: (() => {
      if (s['etapa'] !== 'a_favor') return null;
      const hasta = milisegundosDe(s['aFavorHasta']);
      return hasta !== null && Date.now() < hasta ? { hasta: new Date(hasta).toISOString() } : null;
    })(),
  };
}

export const alTurnoSena: GanchoDelTurno = (contexto) =>
  contexto.flujo === 'agendamiento'
    ? { sena: senaParaElFlujo(
        contexto.especifica, contexto.cobroRealActivo, contexto.moneda, contexto.urlDelQr, contexto.solicitud,
      ) }
    : {};
