/**
 * El gancho de Captación en el turno (F3b-2b). Puro: sin Firestore. La equivalencia con la
 * respuesta de antes la prueba la red diferencial (ficha «onboarding»).
 */
import { describe, expect, it } from 'vitest';
import { alTurnoCaptacion } from '../../../functions/src/modulos/captacion/alTurno.ts';
import type { ContextoDelTurno } from '../../../functions/src/core/turno/ganchosDelTurno.ts';

function contexto(parte: Partial<ContextoDelTurno>): ContextoDelTurno {
  return {
    tenantId: 't', flujo: 'onboarding', telefono: null, ahoraMs: 0, negocio: {}, cuenta: null,
    especifica: undefined, vigentesDeCampanas: [], catalogo: [], solicitud: undefined,
    cobroRealActivo: false, moneda: 'BOB', urlDelQr: (f) => f, citar: (t) => t, ...parte,
  };
}

describe('gancho de Captación', () => {
  it('sin documento sale igual, saneado y con listas vacías', () => {
    const r = alTurnoCaptacion(contexto({ flujo: 'onboarding' }));
    expect(r['onboarding']).toMatchObject({ rubros: [] });
  });

  it('no deja pasar el QR del comercio', () => {
    const r = alTurnoCaptacion(contexto({ especifica: { cobroReal: { cargaUtil: 'carga' }, rubros: [] } }));
    expect(JSON.stringify(r)).not.toContain('cargaUtil');
  });
});

