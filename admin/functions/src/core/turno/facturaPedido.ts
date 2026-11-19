/**
 * LA FACTURA DEL ÚLTIMO PEDIDO (Walisuma, PR-F; Andres, 19/11/2026: «guardar el pedido en el servidor»).
 *
 * EL PROBLEMA. El flujo pide razón social y NIT en el mensaje de «Pedido confirmado» y recuerda el pedido
 * en su ficha 48 h. Si los datos llegan después, la ficha ya no existe y el flujo no distingue a ese cliente
 * de uno nuevo. El servidor guarda entonces el ÚLTIMO pedido confirmado de cada teléfono, con el ESTADO de
 * su factura, y lo devuelve en «Traer configuración».
 *
 * DÓNDE. En `tenants/{t}/conversaciones/wa_<tel>.ultimoPedido`: ese documento YA está indexado por teléfono
 * y por comercio, el cotejo ya lo escribe en su transacción y `configuracionFlujo` ya lo lee en cada turno.
 * Cero lecturas nuevas por turno y ningún registro nuevo de teléfonos. El cierre NO se toca después de
 * crearse: es un registro de auditoría (`firestore.rules`, `cierres`).
 *
 * PRIVACIDAD. Se guarda solo `codigo`, `cierreId`, `factura` ('pedida' | 'dada' | 'sin'), `desdeMs`,
 * `venceMs` y `facturaEnMs`. NUNCA la razón social ni el NIT: viajan solo en el aviso de WhatsApp a la
 * encargada, que manda el flujo. Al flujo se le entrega aún menos: `codigo`, `factura`, `desdeMs`.
 *
 * EL PLAZO. 30 días por defecto; el comercio lo ajusta con `config/pedidos.plazoFacturaDias` (entero de 1
 * a 90; más de 90 queda en 90). Se fija AL CERRAR (`venceMs`), con la lectura de `config/pedidos` que el
 * cotejo ya hace: cambiar el dato vale para los pedidos siguientes, no para los ya cerrados.
 */

export const PLAZO_FACTURA_DIAS = 30;
export const PLAZO_FACTURA_TOPE_DIAS = 90;
const DIA_MS = 86_400_000;
/** Desfase de relojes tolerado para un `desdeMs` «en el futuro». */
const TOLERANCIA_RELOJ_MS = 10 * 60_000;

export type EstadoFactura = 'pedida' | 'dada' | 'sin';
const ESTADOS: ReadonlySet<string> = new Set(['pedida', 'dada', 'sin']);

/** Lo que se guarda en la conversación. */
export interface UltimoPedidoGuardado {
  codigo: string;
  cierreId: string;
  factura: EstadoFactura;
  desdeMs: number;
  venceMs: number;
  facturaEnMs?: number;
}

/** Lo que recibe el flujo: nada más que esto. */
export interface UltimoPedidoDelFlujo {
  codigo: string;
  factura: EstadoFactura;
  desdeMs: number;
}

/** La forma del correlativo (`correlativo.ts`): `<PREFIJO>-AAMMDD-NNN`. */
const CODIGO = /^[A-Z0-9]{2,6}-[0-9]{6}-[0-9]{3,6}$/;

export function codigoDePedidoValido(v: unknown): string | null {
  return typeof v === 'string' && CODIGO.test(v) ? v : null;
}

export function plazoFacturaDias(configPedidos: Record<string, unknown> | undefined | null): number {
  const v = configPedidos?.['plazoFacturaDias'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return PLAZO_FACTURA_DIAS;
  return Math.min(v, PLAZO_FACTURA_TOPE_DIAS);
}

/** El registro al cerrar la venta con código: factura pedida desde ahora. */
export function ultimoPedidoAlCerrar(
  codigo: string, cierreId: string, ahoraMs: number, configPedidos: Record<string, unknown> | undefined | null,
): UltimoPedidoGuardado {
  return { codigo, cierreId, factura: 'pedida', desdeMs: ahoraMs, venceMs: ahoraMs + plazoFacturaDias(configPedidos) * DIA_MS };
}

function leerGuardado(crudo: unknown): UltimoPedidoGuardado | null {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return null;
  const u = crudo as Record<string, unknown>;
  const codigo = codigoDePedidoValido(u['codigo']);
  const factura = typeof u['factura'] === 'string' && ESTADOS.has(u['factura']) ? (u['factura'] as EstadoFactura) : null;
  const desdeMs = u['desdeMs'];
  const venceMs = u['venceMs'];
  if (!codigo || !factura || typeof desdeMs !== 'number' || !Number.isFinite(desdeMs)
    || typeof venceMs !== 'number' || !Number.isFinite(venceMs)) return null;
  return { codigo, cierreId: typeof u['cierreId'] === 'string' ? u['cierreId'] : '', factura, desdeMs, venceMs };
}

/** Para «Traer configuración»: el último pedido si está en plazo, o `null`. Sin NIT ni razón social. */
export function ultimoPedidoParaElFlujo(crudo: unknown, ahoraMs: number): UltimoPedidoDelFlujo | null {
  const g = leerGuardado(crudo);
  if (!g) return null;
  if (g.desdeMs > ahoraMs + TOLERANCIA_RELOJ_MS) return null;
  const vence = Math.min(g.venceMs, g.desdeMs + PLAZO_FACTURA_TOPE_DIAS * DIA_MS);
  if (ahoraMs >= vence) return null;
  return { codigo: g.codigo, factura: g.factura, desdeMs: g.desdeMs };
}

export type MarcaDeFactura =
  | { resultado: 'marcada'; cambios: { factura: 'dada' | 'sin'; facturaEnMs: number } }
  | { resultado: 'ya_marcada' }
  | { resultado: 'rechazada'; motivo: 'sin_pedido' | 'codigo_ajeno' | 'codigo_invalido' };

/**
 * El evento `factura_dada` / `factura_sin` del flujo sobre el último pedido de ESE teléfono (el documento
 * de la conversación es de ese comercio y ese teléfono por su ruta). Idempotente: una factura ya
 * resuelta no cambia, ni de 'dada' a 'sin'.
 */
export function marcaDeFactura(
  crudo: unknown, evento: 'factura_dada' | 'factura_sin', codigoPedido: unknown, ahoraMs: number,
): MarcaDeFactura {
  const codigo = codigoDePedidoValido(codigoPedido);
  if (!codigo) return { resultado: 'rechazada', motivo: 'codigo_invalido' };
  const g = leerGuardado(crudo);
  if (!g) return { resultado: 'rechazada', motivo: 'sin_pedido' };
  if (g.codigo !== codigo) return { resultado: 'rechazada', motivo: 'codigo_ajeno' };
  if (g.factura !== 'pedida') return { resultado: 'ya_marcada' };
  return { resultado: 'marcada', cambios: { factura: evento === 'factura_dada' ? 'dada' : 'sin', facturaEnMs: ahoraMs } };
}
