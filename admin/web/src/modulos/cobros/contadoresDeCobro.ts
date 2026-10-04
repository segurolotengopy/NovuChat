/**
 * Lógica pura de los CONTADORES DE COBRO (C4 del comprobante de venta).
 *
 * La consola solo cuenta: nada de listas, imágenes ni datos personales del
 * comprobante. Los contadores viven en `tenants/{t}/metricas/{aaaa-mm}` y los
 * escribe el servidor (SDK Admin). Un mes sin ningún contador de la regla nueva
 * no se muestra: los comercios con la regla vieja no ven cambios.
 */

/** Los siete de la regla nueva. `cobrosCotejados` y `cobrosVencidos` ya existían. */
export const CONTADORES_REGLA_NUEVA = [
  'cobrosQrEnviados', 'cobrosValidos', 'cobrosAproximados', 'cobrosInvalidos',
  'cobrosEnRevision', 'cobrosCancelados', 'cobrosTardios',
] as const;

export interface LineaDeCobros {
  periodo: string;
  qrEnviados: number;
  validos: number;
  aproximados: number;
  invalidos: number;
  enRevision: number;
  cancelados: number;
  tardios: number;
  cotejados: number;
  vencidos: number;
  /** `aproximado` + `en_revision`: los confirma una persona del negocio. */
  porConfirmar: number;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Una línea por mes con datos de la regla nueva; los más recientes primero. */
export function lineasDeCobros(periodos: { id: string; [k: string]: unknown }[]): LineaDeCobros[] {
  return periodos
    .filter((p) => CONTADORES_REGLA_NUEVA.some((k) => n(p[k]) > 0))
    .map((p) => ({
      periodo: p.id,
      qrEnviados: n(p['cobrosQrEnviados']),
      validos: n(p['cobrosValidos']),
      aproximados: n(p['cobrosAproximados']),
      invalidos: n(p['cobrosInvalidos']),
      enRevision: n(p['cobrosEnRevision']),
      cancelados: n(p['cobrosCancelados']),
      tardios: n(p['cobrosTardios']),
      cotejados: n(p['cobrosCotejados']),
      vencidos: n(p['cobrosVencidos']),
      porConfirmar: n(p['cobrosAproximados']) + n(p['cobrosEnRevision']),
    }))
    .sort((a, b) => b.periodo.localeCompare(a.periodo));
}

/** Los últimos `cantidad` meses, 'aaaa-mm', del más reciente al más antiguo. */
export function ultimosMesesDeCobro(cantidad: number, hoy = new Date()): string[] {
  return Array.from({ length: cantidad }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}
