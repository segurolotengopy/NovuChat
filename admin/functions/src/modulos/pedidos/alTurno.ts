/**
 * EL GANCHO `despuesDelTurno` DE PEDIDOS (PR-4, cableado).
 *
 * La ingesta lo llama DESPUÉS de su transacción, con datos planos: no importa
 * de Cobros ni de Catálogo web (el manifiesto no declara `dependeDe`). El efecto
 * del cobro llega como texto y es lo único que dice si el QR se abrió de verdad:
 *  - `qr_enviado` + efecto `abierto` + líneas no vacías → crea `wa_<referencia>`.
 *  - `cobro_cancelado` + efecto `cancelado` → el pedido anterior pasa a `cancelado`.
 * Lo demás no hace nada (un reenvío, un QR ignorado o un evento sin cobro).
 *
 * NUNCA cambia la respuesta de la ingesta: todo va en try/catch y un fallo deja
 * `error_flujo` SIN datos del pedido (ni el NIT/CI). No agrega mensajes.
 */
import { registrar } from '../../core/turno/bitacora.js';
import { tieneModulo, type FichaConCapacidades } from '../../registro.js';
import { cerrarPedidoWa, crearPedidoWa } from './pedidoDelQr.js';

export interface DatosDelTurnoPedidos {
  tenantId: string;
  /** La ficha del tenant, ya leída por la ingesta. */
  ficha: FichaConCapacidades | null | undefined;
  evento: string | undefined;
  /** `EfectoDeCobro` del cobro de este turno, como texto. */
  efectoDeCobro: string | undefined;
  referencia: string | undefined;
  /** Referencia del QR abierto antes de este turno (solo si su etapa era `qr_enviado`). */
  referenciaAnterior: string | undefined;
  /** Pedido `cat_…` del checkout que este pedido reemplaza (viene del flujo, se revalida en el servidor). */
  reemplaza?: string | undefined;
  telefono: string;
  monto: number | undefined;
  lineas: unknown;
  entrega: unknown;
  facturacion: unknown;
}

export async function despuesDelTurnoPedidos(d: DatosDelTurnoPedidos): Promise<void> {
  try {
    if (d.evento === 'qr_enviado') {
      if (d.efectoDeCobro !== 'abierto') return;
      if (!Array.isArray(d.lineas) || d.lineas.length === 0) return;
      const r = await crearPedidoWa({
        tenantId: d.tenantId, ficha: d.ficha, referencia: d.referencia, telefono: d.telefono,
        montoQr: d.monto, lineas: d.lineas, entrega: d.entrega, facturacion: d.facturacion,
        referenciaAnterior: d.referenciaAnterior, reemplaza: d.reemplaza,
      });
      // Efecto `abierto` con un pedido que ya existía: el flujo reusó la referencia con otro carrito.
      // El pedido conserva lo viejo; se deja constancia, sin datos del pedido, para revisar a mano.
      if (r.resultado === 'repetido') {
        await registrar(d.tenantId, {
          tipo: 'error_flujo', resultado: 'fallo', codigo: 'pedido_wa_referencia_repetida',
          detalle: 'el cobro se abrio con una referencia que ya tenia pedido de WhatsApp',
        });
      }
      return;
    }
    if (d.evento === 'cobro_cancelado' && d.efectoDeCobro === 'cancelado') {
      if (!tieneModulo(d.ficha, 'pedidos') || !d.referenciaAnterior) return;
      await cerrarPedidoWa(d.tenantId, d.referenciaAnterior, 'cancelado', d.telefono);
    }
  } catch {
    try {
      await registrar(d.tenantId, {
        tipo: 'error_flujo', resultado: 'fallo', codigo: 'pedido_wa_gancho',
        detalle: 'no se pudo aplicar el gancho de pedidos de WhatsApp',
      });
    } catch { /* nunca lanza */ }
  }
}
