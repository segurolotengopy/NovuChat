import type { ContextoDelTurno, GanchoDelTurno } from '../../core/turno/ganchosDelTurno.js';
import { rotulosCobroSimulado } from '../../core/prompt/prompt.js';
import { cobroParaElFlujo } from './cobroVenta.js';

/**
 * EL GANCHO DEL COBRO DE UNA VENTA EN EL TURNO (F3b-2d, `Analisis/41` §2.3).
 *
 * Aporta `cobroReal` | `cobroSimulado` (NUNCA los dos: excluyentes por
 * definicion) y `cobro` (el estado del cobro de ESTE telefono). Sale SOLO en el
 * numero de venta: `modulosDelTurno` habilita Cobros tambien en agendamiento,
 * asi que el gancho mira `contexto.flujo`, no el modulo, como hacia `ingesta.ts`.
 *
 * PROHIBICION 3, mientras el cobro sea simulado: los rotulos salen de
 * plataforma (`config/rotulos`), nunca de la configuracion del comercio, y si
 * faltan rigen los de respaldo. Por eso el contexto puede traer
 * `rotulosDeCobro`, el documento que el turno YA leyo (cero lecturas nuevas).
 * El campo es opcional: sin el rigen los rotulos de respaldo, que es el
 * comportamiento de un documento ausente. El QR del comercio no viaja (solo su
 * ficha). Es una extension local del contexto para no tocar el contrato de Core.
 */
export type ContextoDeCobro = ContextoDelTurno & {
  readonly rotulosDeCobro?: Readonly<Record<string, unknown>> | undefined;
};

export const alTurnoCobroDeVenta: GanchoDelTurno = (contexto: ContextoDeCobro) => {
  if (contexto.flujo !== 'venta') return {};
  const especifica = contexto.especifica as Record<string, unknown> | undefined;
  const cobroReal = especifica?.['cobroReal'] as Record<string, unknown> | undefined;
  return {
    ...(contexto.cobroRealActivo
      ? { cobroReal: {
            nombreCuenta: String(cobroReal?.['nombreCuenta'] ?? ''),
            // Con esto el flujo coteja el comprobante del cliente.
            cuentas: Array.isArray(cobroReal?.['cuentas'])
              ? (cobroReal['cuentas'] as unknown[]).slice(0, 5).map(String) : [],
            banco: String(cobroReal?.['banco'] ?? ''),
            venceEl: String(cobroReal?.['venceEl'] ?? ''),
            moneda: String(cobroReal?.['moneda'] ?? 'BOB'),
            montoFijo: typeof cobroReal?.['montoFijo'] === 'number' ? cobroReal['montoFijo'] : null,
            // La imagen NO viaja: viaja su ficha.
            fichaQr: String(cobroReal?.['ficha'] ?? ''),
          } }
      : { cobroSimulado: {
            ...rotulosCobroSimulado(contexto.rotulosDeCobro as Record<string, unknown> | undefined),
            // Sin media ID no hay QR que enviar: mejor nada que una imagen sin rotular.
            mediaIdQr: String(especifica?.['mediaIdQr'] ?? ''),
          } }),
    // Sale en los DOS modos: la compuerta del comprobante funciona tambien en la demostracion.
    cobro: cobroParaElFlujo(
      especifica, contexto.cobroRealActivo, contexto.moneda, contexto.urlDelQr, contexto.solicitud,
    ),
  };
};
