/**
 * La VOZ COMÚN de «Venta mínima» (UX común, 16/11/2026) para las pruebas: lo que `Armar mensajes` le hace a todo texto que sale al cliente
 * (la identidad «asistente virtual con IA», `ctConIA`, y los párrafos separados, `ctParrafos`). Son las piezas REALES del core, cargadas en un
 * contexto vacío; las pruebas que comparan un texto del plan con el que sale lo pasan por `voz()` en vez de copiar el formato a mano.
 */
import { cargarFuente } from '../core/fuente-vm';

const L = cargarFuente<{ ctConIA: (t: unknown) => string; ctParrafos: (t: unknown) => string }>(
  ['Flujos/src/core/texto/identidad.js', 'Flujos/src/core/texto/parrafos.js'], ['ctConIA', 'ctParrafos'],
);

/** El texto tal como sale al cliente: con IA y en párrafos. */
export const voz = (texto: string): string => L.ctParrafos(L.ctConIA(texto));
