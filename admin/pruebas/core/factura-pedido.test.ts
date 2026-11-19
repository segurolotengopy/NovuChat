/**
 * LA FACTURA DEL ÚLTIMO PEDIDO — piezas puras (Walisuma, PR-F; decisión de Andres del 19/11/2026:
 * «guardar el pedido en el servidor»).
 *
 * El servidor guarda SOLO el ESTADO de la factura ('pedida' | 'dada' | 'sin'), sus fechas y el código
 * del pedido, en `conversaciones/wa_<tel>.ultimoPedido`. NUNCA la razón social ni el NIT: esos viajan
 * solo en el aviso de WhatsApp a la encargada, que manda el flujo.
 *
 * LO QUE SE NIEGA: un plazo vencido no se entrega; un plazo pedido por encima del tope queda en el
 * tope; un código que no es el del último pedido de ESE teléfono se rechaza; el segundo reporte no
 * cambia nada; lo que se entrega al flujo no tiene más que `codigo`, `factura` y `desdeMs`.
 */
import { describe, expect, it } from 'vitest';
import {
  PLAZO_FACTURA_DIAS, PLAZO_FACTURA_TOPE_DIAS, codigoDePedidoValido, marcaDeFactura, plazoFacturaDias,
  ultimoPedidoAlCerrar, ultimoPedidoParaElFlujo,
} from '../../functions/src/core/turno/facturaPedido.ts';

const DIA = 86_400_000;
const AHORA = Date.UTC(2026, 10, 19, 16, 0, 0);
const COD = 'WAL-261119-001';

describe('plazo', () => {
  it('por defecto 30 días; el dato del comercio lo ajusta; nunca más de 90 ni menos de 1', () => {
    expect(PLAZO_FACTURA_DIAS).toBe(30);
    expect(PLAZO_FACTURA_TOPE_DIAS).toBe(90);
    expect(plazoFacturaDias(undefined)).toBe(30);
    expect(plazoFacturaDias({})).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: 45 })).toBe(45);
    expect(plazoFacturaDias({ plazoFacturaDias: 200 })).toBe(90);
    expect(plazoFacturaDias({ plazoFacturaDias: 0 })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: -5 })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: '45' })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: 2.5 })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: 3.5 })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: 'abc' })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: 1e9 })).toBe(90);
    expect(plazoFacturaDias({ plazoFacturaDias: Number.NaN })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: Number.POSITIVE_INFINITY })).toBe(30);
    expect(plazoFacturaDias({ plazoFacturaDias: 1 })).toBe(1);
  });

  it('al cerrar: pedida, desde ahora, vence a los días del plazo', () => {
    expect(ultimoPedidoAlCerrar(COD, 'venta_x', AHORA, { plazoFacturaDias: 45 })).toEqual({
      codigo: COD, cierreId: 'venta_x', factura: 'pedida', desdeMs: AHORA, venceMs: AHORA + 45 * DIA,
    });
    expect(ultimoPedidoAlCerrar(COD, 'venta_x', AHORA, { plazoFacturaDias: 500 }).venceMs).toBe(AHORA + 90 * DIA);
  });

  it('dentro del plazo se entrega; vencido, no; un vence guardado por encima del tope se recorta al tope', () => {
    const g = ultimoPedidoAlCerrar(COD, 'venta_x', AHORA, undefined);
    expect(ultimoPedidoParaElFlujo(g, AHORA + 29 * DIA)).toEqual({ codigo: COD, factura: 'pedida', desdeMs: AHORA });
    expect(ultimoPedidoParaElFlujo(g, AHORA + 30 * DIA)).toBeNull();
    const forzado = { ...g, venceMs: AHORA + 400 * DIA };
    expect(ultimoPedidoParaElFlujo(forzado, AHORA + 89 * DIA)).not.toBeNull();
    expect(ultimoPedidoParaElFlujo(forzado, AHORA + 91 * DIA)).toBeNull();
  });
});

describe('lo que se entrega al flujo', () => {
  it('solo codigo, factura y desdeMs, aunque lo guardado traiga otros campos', () => {
    const sucio = { ...ultimoPedidoAlCerrar(COD, 'venta_x', AHORA, undefined), nit: '1000000', razonSocial: 'X', facturaEnMs: AHORA };
    const r = ultimoPedidoParaElFlujo(sucio, AHORA + DIA);
    expect(Object.keys(r!).sort()).toEqual(['codigo', 'desdeMs', 'factura']);
  });

  it('lo malformado no se entrega', () => {
    const g = ultimoPedidoAlCerrar(COD, 'venta_x', AHORA, undefined);
    for (const malo of [null, undefined, 'x', [], { ...g, codigo: 'wal 1' }, { ...g, factura: 'quizas' },
      { ...g, desdeMs: 'ayer' }, { ...g, venceMs: undefined }, { ...g, desdeMs: AHORA + 2 * DIA }]) {
      expect(ultimoPedidoParaElFlujo(malo, AHORA + DIA)).toBeNull();
    }
  });

  it('el código válido tiene la forma del correlativo', () => {
    expect(codigoDePedidoValido(COD)).toBe(COD);
    expect(codigoDePedidoValido('WAL-261119-1234')).toBe('WAL-261119-1234');
    for (const malo of ['', 'WAL', 'wal-261119-001', 'WAL-26111-001', 'WAL-261119-01', 'WAL-261119-001/x', 7]) {
      expect(codigoDePedidoValido(malo)).toBeNull();
    }
  });
});

describe('marcar la factura', () => {
  const g = ultimoPedidoAlCerrar(COD, 'venta_x', AHORA, undefined);

  it('dada o sin, con el código de su último pedido: se marca con la fecha', () => {
    expect(marcaDeFactura(g, 'factura_dada', COD, AHORA + DIA)).toEqual({
      resultado: 'marcada', cambios: { factura: 'dada', facturaEnMs: AHORA + DIA },
    });
    expect(marcaDeFactura(g, 'factura_sin', COD, AHORA + DIA)).toEqual({
      resultado: 'marcada', cambios: { factura: 'sin', facturaEnMs: AHORA + DIA },
    });
  });

  it('idempotente: ya marcada no cambia (ni de dada a sin)', () => {
    const dada = { ...g, factura: 'dada', facturaEnMs: AHORA + DIA };
    expect(marcaDeFactura(dada, 'factura_dada', COD, AHORA + 2 * DIA)).toEqual({ resultado: 'ya_marcada' });
    expect(marcaDeFactura(dada, 'factura_sin', COD, AHORA + 2 * DIA)).toEqual({ resultado: 'ya_marcada' });
  });

  it('se rechaza: sin pedido, código ajeno, código malformado', () => {
    expect(marcaDeFactura(undefined, 'factura_dada', COD, AHORA)).toEqual({ resultado: 'rechazada', motivo: 'sin_pedido' });
    expect(marcaDeFactura(g, 'factura_dada', 'WAL-261119-002', AHORA)).toEqual({ resultado: 'rechazada', motivo: 'codigo_ajeno' });
    expect(marcaDeFactura(g, 'factura_dada', 'nada', AHORA)).toEqual({ resultado: 'rechazada', motivo: 'codigo_invalido' });
    expect(marcaDeFactura(g, 'factura_dada', undefined, AHORA)).toEqual({ resultado: 'rechazada', motivo: 'codigo_invalido' });
  });
});
