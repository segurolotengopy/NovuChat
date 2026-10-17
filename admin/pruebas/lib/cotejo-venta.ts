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
