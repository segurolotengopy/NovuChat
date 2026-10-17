/**
 * Las respuestas de `POST /cotejarComprobanteVenta` (regla 2) y de `POST /guardarComprobante` tal como las
 * contestan las Functions (`admin/functions/src/modulos/cobros/cotejoVenta.ts` y `comprobantes.ts`), para los
 * dobles de red de las suites de Venta mínima. Una sola fuente: si el contrato cambia, cambia aquí.
 */
type J = Record<string, unknown>;

const BASE: J = {
  estado: 'valido', motivo: 'ok', intentos: 0, intentosRestantes: 3, importe: 84, moneda: 'BOB', montoLeido: 84,
  montoDistinto: false, cierreId: 'venta_prueba', evento: null, avisarComercio: true, repetido: false,
};

const r200 = (cuerpo: J) => ({ statusCode: 200, body: cuerpo });

/** `valido` o `aproximado`: cierra la venta; el local recibe el aviso. */
export const cotejoValido = (extra: J = {}) => r200({ ...BASE, ...extra });
/** Un comprobante que no se lee: el servidor lo cuenta como inválido y admite otro. */
export const cotejoIlegible = (extra: J = {}) => r200({ ...BASE, estado: 'reintentar', motivo: 'ilegible', montoLeido: null, cierreId: null, avisarComercio: false, intentos: 1, intentosRestantes: 2, ...extra });
/** Un comprobante legible que no coincide (por omisión, monto menor) y todavía admite otro. */
export const cotejoReintentar = (motivo = 'monto_menor', extra: J = {}) => r200({ ...BASE, estado: 'reintentar', motivo, montoLeido: 60, cierreId: null, avisarComercio: false, intentos: 1, intentosRestantes: 2, ...extra });
/** Llegó pasado el plazo de 15 minutos: se deriva al local (aviso una sola vez). */
export const cotejoTardio = (extra: J = {}) => r200({ ...BASE, estado: 'tardio', motivo: 'tardio', cierreId: null, avisarComercio: true, ...extra });
/** El tercer inválido: pasa a una persona. */
export const cotejoEnRevision = (extra: J = {}) => r200({ ...BASE, estado: 'en_revision', motivo: 'monto_menor', cierreId: null, avisarComercio: true, intentos: 3, intentosRestantes: 0, ...extra });
/** El cobro ya estaba resuelto: no hay aviso nuevo. */
export const cotejoYaResuelto = (extra: J = {}) => r200({ ...BASE, estado: 'ya_resuelto', motivo: 'ya_resuelto', avisarComercio: false, ...extra });
/** Un rechazo 409 (`sin_cobro_pendiente`, `regla_1`, `sin_total`, `cobro_cancelado`, `cobro_simulado`). */
export const cotejo409 = (error: string) => ({ statusCode: 409, body: { error } });

/** La ruta que devuelve `guardarComprobante` con un 200. */
export const RUTA_GUARDADA = 'tenants/qtaco/comprobantes/2026-10-05/Kq3aZ09bcdEFGHIJklmnopqrstuvwxyz0123456789_-A.jpg';
export const guardadoBien = () => ({ statusCode: 200, body: { ruta: RUTA_GUARDADA } });
/** Un rechazo de `guardarComprobante` (409 `sin_cobro_pendiente` o `demasiados_comprobantes`, 413, 415, 502...). */
export const guardadoFalla = (codigo = 409, error = 'sin_cobro_pendiente') => ({ statusCode: codigo, body: { error } });

// --- el doble de `guardarComprobante` que comprueba el tipo, como el servidor -----------------------------------------------
/** Lo que baja «Descargar medio» en el doble: el tipo que declara el binario y los primeros bytes (en hexadecimal). */
export interface BinarioDeMentira { mimeType: string; bytesHex: string }
export const BINARIOS: Record<string, BinarioDeMentira> = {
  jpeg: { mimeType: 'image/jpeg', bytesHex: 'ffd8ffe000104a464946' },
  png: { mimeType: 'image/png', bytesHex: '89504e470d0a1a0a0000' },
  webp: { mimeType: 'image/webp', bytesHex: '52494646a400000057454250' },
  pdf: { mimeType: 'application/pdf', bytesHex: '255044462d312e340a' },
};
/** El mismo criterio de `tipoPorFirma` (`comprobantes.ts`): el tipo real sale de los primeros bytes. */
function mimePorFirma(hex: string): string | null {
  const h = hex.toLowerCase();
  if (h.startsWith('ffd8ff')) return 'image/jpeg';
  if (h.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (h.startsWith('52494646') && h.slice(16, 24) === '57454250') return 'image/webp';
  if (h.startsWith('255044462d')) return 'application/pdf';
  return null;
}
/** `guardarComprobante` del servidor: 415 si los bytes no son de un tipo admitido o NO coinciden con el `Content-Type` declarado; si no, 200 con la ruta. */
export function guardadoSegunFirma(binario: unknown) {
  const b = (typeof binario === 'object' && binario !== null ? binario : {}) as Partial<BinarioDeMentira>;
  const real = mimePorFirma(String(b.bytesHex ?? ''));
  const declarado = String(b.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!real || declarado !== real) return guardadoFalla(415, 'tipo_no_admitido');
  return guardadoBien();
}
