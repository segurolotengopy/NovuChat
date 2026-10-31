/**
 * El gancho de Inventario en el turno (F3b-2c). Puro: sin Firestore. La
 * equivalencia con la respuesta de antes la prueba la red diferencial
 * (`pruebas/core/turno/configuracion-diferencial.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { alTurnoInventario } from '../../../functions/src/modulos/inventario/alTurno.ts';
import type { ContextoDelTurno } from '../../../functions/src/core/turno/ganchosDelTurno.ts';

function contexto(catalogo: ContextoDelTurno['catalogo'], flujo = 'venta'): ContextoDelTurno {
  return {
    tenantId: 't', flujo, telefono: null, ahoraMs: 0, negocio: {}, cuenta: null, especifica: undefined,
    vigentesDeCampanas: [], catalogo, solicitud: undefined, cobroRealActivo: false, moneda: 'BOB',
    urlDelQr: (f) => f, citar: (t) => t,
  };
}

describe('gancho de Inventario', () => {
  it('stock 0 sale agotado, stock positivo no', () => {
    const r = alTurnoInventario(contexto([
      { id: 'a', datos: { stock: 0 } }, { id: 'b', datos: { stock: 3 } },
    ]));
    expect(r).toEqual({ agotados: { a: true, b: false } });
  });

  it('un ítem sin control de existencias nunca sale agotado', () => {
    const r = alTurnoInventario(contexto([{ id: 'a', datos: { nombre: 'x' } }]));
    expect(r).toEqual({ agotados: {} });
  });

  it('corre igual en un flujo de agendamiento (agotado no se pierde)', () => {
    const r = alTurnoInventario(contexto([{ id: 's', datos: { stock: 0 } }], 'agendamiento'));
    expect(r).toEqual({ agotados: { s: true } });
  });
});
