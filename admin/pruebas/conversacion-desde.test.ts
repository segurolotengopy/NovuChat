/**
 * `conversacionDesde` / `conversacionNueva` de la respuesta de la ingesta (CRM por conversación).
 * Puras: usan `contadoresDelMensaje` y `estadoDeAtencion` reales, sin emulador. Se niega el caso
 * que fallaba: `ventanaVenceEn` del mensaje que abre es null porque mira lo guardado ANTES.
 */
import { describe, expect, it } from 'vitest';
import { contadoresDelMensaje, type MarcasDeConteo } from '../functions/src/ingesta.ts';
import {
  conversacionDelMensaje, estadoDeAtencion, isoSinFracciones, umbralesDeAtencion,
} from '../functions/src/core/conteo/atencion.ts';

const PERIODO = '2026-10';
const HORA = 3_600_000;
const T0 = Date.UTC(2026, 9, 5, 14, 0, 0, 417);
const ts = (ms: number) => ({ toMillis: () => ms });

function mensaje(marcas: MarcasDeConteo, dir: 'entrante' | 'saliente', ahora: number, texto = 'quiero reservar') {
  const conteo = contadoresDelMensaje(marcas, PERIODO, dir, ahora, texto);
  return { conteo, conv: conversacionDelMensaje(marcas, conteo, ahora, dir) };
}
const abierta = (desde: number, n = 0): MarcasDeConteo => ({
  atencionDesde: ts(desde), mensajesVentana: n, periodoContado: PERIODO,
});

describe('conversacionDesde / conversacionNueva', () => {
  it('primer mensaje de un contacto nuevo: nueva y desde = ahora (aunque ventanaVenceEn de hoy sea null)', () => {
    const { conv } = mensaje({}, 'entrante', T0);
    expect(conv).toEqual({ desdeMs: T0, nueva: true });
    expect(estadoDeAtencion({}, umbralesDeAtencion(undefined), T0).ventanaVenceEn).toBeNull();
    expect(isoSinFracciones(T0)).toBe('2026-10-05T14:00:00Z');
  });
  it('2.º mensaje dentro de la ventana: no nueva, mismo desde', () => {
    expect(mensaje(abierta(T0), 'entrante', T0 + HORA).conv).toEqual({ desdeMs: T0, nueva: false });
  });
  it('a las 23 h 59: no nueva', () => {
    expect(mensaje(abierta(T0), 'entrante', T0 + 24 * HORA - 60_000).conv).toEqual({ desdeMs: T0, nueva: false });
  });
  it('a las 24 h exactas: nueva con desde nuevo', () => {
    expect(mensaje(abierta(T0), 'entrante', T0 + 24 * HORA).conv).toEqual({ desdeMs: T0 + 24 * HORA, nueva: true });
  });
  it('cortesía con ventana vencida: null/false', () => {
    expect(mensaje(abierta(T0), 'entrante', T0 + 30 * HORA, 'gracias').conv).toEqual({ desdeMs: null, nueva: false });
  });
  it('cortesía dentro de la ventana: pertenece a la conversación, no es nueva', () => {
    expect(mensaje(abierta(T0), 'entrante', T0 + HORA, 'gracias').conv).toEqual({ desdeMs: T0, nueva: false });
  });
  it('saliente que no abre bloque: null/false', () => {
    expect(mensaje(abierta(T0, 5), 'saliente', T0 + HORA).conv).toEqual({ desdeMs: null, nueva: false });
  });
  it('respuesta 26: nueva (bloque) con el desde fijo de la ventana', () => {
    const r = mensaje(abierta(T0, 25), 'saliente', T0 + 2 * HORA);
    expect(r.conteo.bloqueNuevo).toBe(true);
    expect(r.conv).toEqual({ desdeMs: T0, nueva: true });
    expect(mensaje(abierta(T0, 24), 'saliente', T0 + 2 * HORA).conv.nueva).toBe(false);
  });
  it('saliente sobre ventana vencida: no abre nada', () => {
    expect(mensaje(abierta(T0, 25), 'saliente', T0 + 30 * HORA).conv).toEqual({ desdeMs: null, nueva: false });
  });
  it('el cobro no cambia: los contadores salen de la misma función', () => {
    const c = contadoresDelMensaje({}, PERIODO, 'entrante', T0, 'quiero reservar');
    expect(c.conversacion).toBe(true);
    expect(c.mensajesVentana).toBe(0);
  });
});
