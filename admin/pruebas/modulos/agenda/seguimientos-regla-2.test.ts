/**
 * Seguimiento y regla 2 de Cobros (obligación (d) de C1b): una solicitud de
 * cobro de regla 2 vencida por reloj, aunque siga en `qr_enviado`, NO recibe
 * recordatorio de pago. Pura, sin emulador. Escrita negando.
 */
import { describe, expect, it } from 'vitest';
import { esPendienteDeSeguimiento, VENTANAS } from '../../../functions/src/modulos/agenda/seguimientos.ts';

const AHORA = Date.UTC(2026, 9, 10, 15, 0, 0);
const HORA = 60 * 60 * 1000;
// Silencio dentro de la ventana de texto.
const ultimoEn = { seconds: Math.floor((AHORA - VENTANAS.texto.desde - 1000) / 1000) };

function conv(solicitud: Record<string, unknown>) {
  return { ultimoEn, solicitud: { seguimientos: 0, ...solicitud } };
}

describe('seguimiento con regla 2', () => {
  it('regla 2 vencida por reloj con etapa qr_enviado: null', () => {
    expect(esPendienteDeSeguimiento(conv({ etapa: 'qr_enviado', reglaCobro: 2, venceEn: AHORA - HORA }), AHORA)).toBeNull();
  });
  it('vence justo ahora (límite <= ahora): null', () => {
    expect(esPendienteDeSeguimiento(conv({ etapa: 'qr_enviado', reglaCobro: 2, venceEn: AHORA }), AHORA)).toBeNull();
  });
  it('regla 2 con prórroga vigente sigue pendiente', () => {
    expect(esPendienteDeSeguimiento(conv({ etapa: 'qr_enviado', reglaCobro: 2, venceEn: AHORA - HORA, prorrogaHasta: AHORA + HORA }), AHORA)).toBe('texto');
  });
  it('regla 2 vigente sigue siendo pendiente', () => {
    expect(esPendienteDeSeguimiento(conv({ etapa: 'qr_enviado', reglaCobro: 2, venceEn: AHORA + HORA }), AHORA)).toBe('texto');
  });
  it('sin reglaCobro (regla 1) es idéntico a hoy, aunque traiga venceEn pasado', () => {
    expect(esPendienteDeSeguimiento(conv({ etapa: 'qr_enviado' }), AHORA)).toBe('texto');
    expect(esPendienteDeSeguimiento(conv({ etapa: 'qr_enviado', venceEn: AHORA - HORA }), AHORA)).toBe('texto');
  });
  it('reglaCobro 2 sin venceEn legible no es regla 2: no cambia nada', () => {
    expect(esPendienteDeSeguimiento(conv({ etapa: 'qr_enviado', reglaCobro: 2 }), AHORA)).toBe('texto');
  });
  it('horarios con restos de regla 2 vencidos sigue siendo texto', () => {
    expect(esPendienteDeSeguimiento(conv({ etapa: 'horarios', reglaCobro: 2, venceEn: AHORA - HORA }), AHORA)).toBe('texto');
  });
  it('en_revision y cancelada no son pendientes, vencidas o no', () => {
    for (const etapa of ['en_revision', 'cancelada']) {
      expect(esPendienteDeSeguimiento(conv({ etapa }), AHORA)).toBeNull();
      expect(esPendienteDeSeguimiento(conv({ etapa, reglaCobro: 2, venceEn: AHORA + HORA }), AHORA)).toBeNull();
    }
  });
});
