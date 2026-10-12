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
 * En simulado el cotejo responde 409, y aun así el servidor SÍ suma contadores
 * de la regla nueva (QR enviados, vencidos, cancelados, tardíos): un comercio que
 * pasó de real a simulado conserva sus meses. Esas cifras no hablan de clientes
 * que pagaron: en simulado no se pintan, y si no se sabe el modo se avisa.
 */
export function cobroRealActivo(venta: unknown): boolean {
  const c = (venta as { cobroReal?: Record<string, unknown> } | undefined)?.cobroReal;
  if (!c || typeof c !== 'object') return false;
  const hay = (v: unknown) => typeof v === 'string' && v !== '';
  return c['activo'] === true && hay(c['ficha']) && hay(c['cargaUtil']);
}

// ---------------------------------------------------------------------------
// Lectura de la pantalla: dos lecturas INDEPENDIENTES (`metricas` y `config/venta`).
//
// Las reglas dejan a un miembro leer las dos, pero al propietario de NovuChat
// solo `metricas`: si fueran un solo `Promise.all`, la denegación de
// `config/venta` tumbaba también los contadores. Ahora cada lectura tiene su
// propio estado, y «no sé si el cobro es real» se trata distinto de «no es real».
// ---------------------------------------------------------------------------

/** Resultado de una lectura: leída, denegada por las reglas, o fallida por otra causa. */
export type EstadoLectura = 'ok' | 'denegada' | 'error';

export type Pintado = 'error' | 'nada' | 'simulado' | 'tabla' | 'tabla_sin_modo';

export interface PeriodoDeCobro { id: string; [k: string]: unknown }

export interface LecturaDeContadores {
  metricas: EstadoLectura;
  config: EstadoLectura;
  periodos: PeriodoDeCobro[];
  /** Solo vale si `config === 'ok'`; en cualquier otro caso es «desconocido», no «falso». */
  real: boolean;
}

/** `permission-denied` de Firestore (el SDK web lo da sin prefijo) es «denegada»; cualquier otra falla, «error». */
export function estadoDeError(e: unknown): EstadoLectura {
  const codigo = (e as { code?: unknown } | null | undefined)?.code;
  return codigo === 'permission-denied' ? 'denegada' : 'error';
}

/**
 * La línea neutra que acompaña SIEMPRE a la tabla cuando no se pudo leer el
 * modo de cobro. No afirma ningún modo (prohibición 3).
 */
export const NOTA_SIN_MODO =
  'No se pudo leer el modo de cobro de este negocio (real o simulado): estas cifras pueden ser de demostración.';

/**
 * Qué se pinta. Si `metricas` no se leyó es siempre error: no se oculta. Con
 * los contadores leídos:
 *  - `config/venta` leída y cobro no real: solo «Cobro simulado» (los contadores
 *    de un negocio simulado no hablan de clientes que pagaron: no se pintan);
 *  - leída y real: la tabla;
 *  - denegada o fallida (el modo se DESCONOCE): `tabla_sin_modo`, la misma tabla
 *    con la nota neutra delante. Un comercio simulado, o que pasó de real a
 *    simulado, conserva contadores de la regla nueva; pintarlos sin aviso sería
 *    presentar un cobro como lo que no es. «Desconocido» no es «real» ni
 *    «simulado». Se elige la nota también para `error` (en vez de ocultar todo):
 *    la nota es cierta en ambos casos y no esconde datos que sí se leyeron.
 */
export function decidirPintado(
  metricas: EstadoLectura, config: EstadoLectura, real: boolean, hayLineas: boolean,
): Pintado {
  if (metricas !== 'ok') return 'error';
  if (!hayLineas) return 'nada';
  if (config !== 'ok') return 'tabla_sin_modo';
  return real ? 'tabla' : 'simulado';
}

/**
 * Hace las dos lecturas por separado: ninguna puede tumbar a la otra. Los
 * lectores se inyectan para probarlo sin Firestore.
 */
export async function leerContadores(
  leerMetricas: () => Promise<PeriodoDeCobro[]>,
  leerVenta: () => Promise<unknown>,
): Promise<LecturaDeContadores> {
  const config = (async (): Promise<{ estado: EstadoLectura; real: boolean }> => {
    try {
      return { estado: 'ok', real: cobroRealActivo(await leerVenta()) };
    } catch (e) {
      return { estado: estadoDeError(e), real: false };
    }
  })();
  let metricas: EstadoLectura = 'ok';
  let periodos: PeriodoDeCobro[] = [];
  try {
    periodos = await leerMetricas();
  } catch (e) {
    metricas = estadoDeError(e);
  }
  const c = await config;
  return { metricas, config: c.estado, periodos, real: c.real };
}
