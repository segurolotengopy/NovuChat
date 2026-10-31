import type { GanchoDelTurno } from '../../core/turno/ganchosDelTurno.js';
import { sanearCaptacion } from './captacion.js';

/**
 * EL GANCHO DE CAPTACION EN EL TURNO (F3b-2b, `Analisis/41` §2.3 y §7 F3b).
 *
 * La captacion va SANEADA, no cruda: la escribe el administrador de cada
 * comercio y sus listas (rubros, planes, cargos, aclaraciones) las reglas no
 * pueden recorrer; `sanearCaptacion` descarta cada elemento que no cumple su
 * forma antes de que el asistente lo diga. Sale siempre, aunque falte el
 * documento (`especifica` indefinido), con valores por defecto y listas
 * vacias: el flujo tiene un solo camino.
 *
 * Y el QR del comercio no viaja aca: `sanearCaptacion` solo conserva los campos
 * de captacion, nunca `cobroReal`.
 */
export const alTurnoCaptacion: GanchoDelTurno = (contexto) => ({
  onboarding: sanearCaptacion(contexto.especifica ?? {}),
});
