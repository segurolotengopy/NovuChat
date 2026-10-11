import type { GanchoDeCobroAlCierre } from '../../core/turno/cierres.js';
import { MS_VENTANA_DEL_CASO, esReglaDos, limiteDe } from './cobroVenta.js';

/**
 * =============================================================================
 * LO QUE COBROS APORTA AL CIERRE (`registrarCierre`)
 * =============================================================================
 *
 * F3b-1b (05/10/2026): estas piezas vivían una en `core/turno/cierres.ts`
 * (`cobroRealActivo`) y las demás en `modulos/agenda/solicitud.ts` (los dos
 * predicados), y Core las importaba a través de `ingesta.ts`, que es lo que la
 * deuda de `fronteras.test.ts` registraba. Se mudaron AQUÍ, a quien sabe qué es
 * un cobro de regla 2, SIN cambiar una línea de lógica (la equivalencia la
 * fija `pruebas/modulos/agenda/solicitud-equivalencia.test.ts`, con un golden
 * generado antes de mover nada). Agenda las importa de aquí (`dependeDe:
 * ['cobros']`), y Core las recibe inyectadas por `ganchos.ts`
 * (`COBRO_AL_CIERRE`), sin importar nada de un módulo.
 *
 * Son puras, salvo `cobroRealActivo` del gancho, que lee `config/venta` por el
 * lector de solo lectura que le da Core: Firestore reintenta la transacción
 * entera, y un gancho con efectos se ejecutaría dos veces.
 */

type Plano = Record<string, unknown>;
const comoPlano = (v: unknown): Plano | null => (typeof v === 'object' && v !== null ? v as Plano : null);

/** ¿Es un cobro de regla 2 que ya no está en curso (en revisión, cancelado, vencido o vencido por reloj)? */
export function cobroDosCerrado(p: Plano, ahoraMs: number): boolean {
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
  return limite !== null && ahoraMs - limite <= MS_VENTANA_DEL_CASO;
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
 * Cobro real encendido y con ficha y código: el mismo criterio de
 * `configuracionFlujo` y del cotejo de venta. Recibe el campo `cobroReal` de
 * `config/venta` (o lo que haya), y es pura.
 */
export function cobroRealActivo(cobroReal: unknown): boolean {
  const c = cobroReal as Record<string, unknown> | undefined;
  return c?.['activo'] === true && String(c['ficha'] ?? '') !== '' && String(c['cargaUtil'] ?? '') !== '';
}

/** El gancho de Cobros para el cierre: lo que `ganchos.ts` le entrega a `crearRegistrarCierre`. */
export const COBRO_AL_CIERRE: GanchoDeCobroAlCierre = {
  async cobroRealActivo(leer) {
    return cobroRealActivo((await leer('config/venta')).get('cobroReal'));
  },
  cierreDeVentaLoHaceElCotejo,
};
