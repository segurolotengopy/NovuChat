/**
 * El gancho de Cobros en el turno (F3b-2d). Puro: sin Firestore. La equivalencia con la respuesta de antes
 * la prueba la red diferencial; esto cierra lo que ella no ve: que los rótulos de PLATAFORMA llegan al cobro
 * simulado (la referencia coincide con los de respaldo) y que los dos modos de cobro son excluyentes.
 */
import { describe, expect, it } from 'vitest';
import { alTurnoCobroDeVenta } from '../../../functions/src/modulos/cobros/alTurno.ts';
import type { ContextoDelTurno } from '../../../functions/src/core/turno/ganchosDelTurno.ts';

function contexto(extra: Record<string, unknown> = {}, flujo = 'venta', cobroRealActivo = false): ContextoDelTurno {
  return {
    tenantId: 't', flujo, telefono: null, ahoraMs: 0, negocio: {}, cuenta: null, especifica: {},
    vigentesDeCampanas: [], catalogo: [], solicitud: undefined, cobroRealActivo, moneda: 'BOB',
    urlDelQr: (f) => f, citar: (t) => t, ...extra,
  } as ContextoDelTurno;
}

describe('gancho de Cobros', () => {
  it('los rótulos de plataforma llegan al cobro simulado y mandan sobre los de respaldo', () => {
    const base = alTurnoCobroDeVenta(contexto()) as { cobroSimulado: Record<string, unknown> };
    const campo = Object.keys(base.cobroSimulado).find((k) => k !== 'mediaIdQr')!;
    const r = alTurnoCobroDeVenta(contexto({ rotulosDeCobro: { [campo]: 'ROTULO-DE-PLATAFORMA' } })) as {
      cobroSimulado: Record<string, unknown>;
    };
    expect(r.cobroSimulado[campo]).not.toBe(base.cobroSimulado[campo]);
    expect(JSON.stringify(r.cobroSimulado)).toContain('ROTULO-DE-PLATAFORMA');
  });

  it('cobro real y cobro simulado nunca salen juntos', () => {
    const real = alTurnoCobroDeVenta(contexto({}, 'venta', true)) as Record<string, unknown>;
    const sim = alTurnoCobroDeVenta(contexto({}, 'venta', false)) as Record<string, unknown>;
    expect('cobroReal' in real && 'cobroSimulado' in real).toBe(false);
    expect('cobroReal' in real).toBe(true);
    expect('cobroSimulado' in sim && 'cobroReal' in sim).toBe(false);
    expect('cobroSimulado' in sim).toBe(true);
  });

  it('fuera del flujo de venta no aporta nada', () => {
    expect(alTurnoCobroDeVenta(contexto({}, 'agendamiento'))).toEqual({});
    expect(alTurnoCobroDeVenta(contexto({}, 'onboarding'))).toEqual({});
  });
});
