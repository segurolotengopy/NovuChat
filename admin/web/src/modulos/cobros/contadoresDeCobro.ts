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
      vencidos: n(p['cobrosVencidos']),
      porConfirmar: n(n(p['cobrosAproximados']) + n(p['cobrosEnRevision'])),
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

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-10' -> 'octubre 2026'. Si no tiene la forma, se devuelve tal cual. */
export function mesLegible(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  const nombre = m ? MESES[Number(m[2]) - 1] : undefined;
  return m && nombre ? `${nombre} ${m[1]}` : periodo;
}

/**
 * Columnas de la tabla, en orden. Cada cabecera lleva su dato: una prueba
 * fija que ninguna se cruce. Las cifras son SUCESOS del mes, no cobros
 * pendientes: cada comprobante que no coincide se cuenta, y un cobro puede
 * tener hasta tres.
 */
export const COLUMNAS: { titulo: string; valor: (l: LineaDeCobros) => number }[] = [
  { titulo: 'QR enviados', valor: (l) => l.qrEnviados },
  { titulo: 'Datos coinciden', valor: (l) => l.validos },
  { titulo: 'Aproximados', valor: (l) => l.aproximados },
  { titulo: 'Pasaron a revisión', valor: (l) => l.enRevision },
  { titulo: 'Comprobantes que no coinciden', valor: (l) => l.invalidos },
  { titulo: 'Cancelados', valor: (l) => l.cancelados },
  { titulo: 'Vencidos', valor: (l) => l.vencidos },
  { titulo: 'Tardíos', valor: (l) => l.tardios },
];

/**
 * ¿El comercio cobra con su QR real? Mismo criterio que el servidor
 * (`cotejoVenta.ts`): `config/venta.cobroReal` encendido y con ficha y código.
 * En simulado el cotejo responde 409 y los contadores (QR enviados, vencidos,
 * tardíos, cancelados) no hablan de clientes que no pagaron: no se pintan.
 */
export function cobroRealActivo(venta: unknown): boolean {
  const c = (venta as { cobroReal?: Record<string, unknown> } | undefined)?.cobroReal;
  if (!c || typeof c !== 'object') return false;
  const hay = (v: unknown) => typeof v === 'string' && v !== '';
  return c['activo'] === true && hay(c['ficha']) && hay(c['cargaUtil']);
}
