import { describe, expect, it } from 'vitest';
import { solicitudDelTurno, type MensajeDeSolicitud } from '../../../functions/src/modulos/agenda/solicitudDelTurno.ts';

const AHORA = Date.UTC(2026, 10, 15, 15, 0, 0);
const msg = (m: Partial<MensajeDeSolicitud>): MensajeDeSolicitud => ({ direccion: 'saliente', ...m } as MensajeDeSolicitud);

describe('G-2: solicitudDelTurno entrega metricas (señas enviadas)', () => {
  it('un QR de seña enviado cuenta una seña', () => {
    const r = solicitudDelTurno(undefined, msg({ evento: 'qr_enviado', idMeta: 'wamid.1', referencia: 'R1', monto: 50 }), AHORA);
    expect(r.sinQr).toBe(false);
    expect(r.metricas).toEqual({ senasEnviadas: 1 });
  });
  it('con regla 2 (cobro de pedido) no cuenta seña', () => {
    const r = solicitudDelTurno(undefined, msg({ evento: 'qr_enviado', reglaCobro: 2, idMeta: 'wamid.1', referencia: 'P1', monto: 50 }), AHORA);
    expect(r.metricas).toEqual({});
  });
  it('un QR sin pedido identificable (sinQr) no cuenta', () => {
    const r = solicitudDelTurno(undefined, msg({ evento: 'qr_enviado', reglaCobro: 2, idMeta: 'x', referencia: 'x' }), AHORA);
    expect(r.sinQr).toBe(true);
    expect(r.metricas).toEqual({});
  });
  it('otros eventos y mensajes sin evento no cuentan', () => {
    expect(solicitudDelTurno(undefined, msg({ evento: 'cobro_cancelado' }), AHORA).metricas).toEqual({});
    expect(solicitudDelTurno(undefined, msg({}), AHORA).metricas).toEqual({});
  });
});
