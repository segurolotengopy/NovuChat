/**
 * EL CONTRATO DE LA INGESTA PARA EL CRM, en un solo sitio (Andres, 08/11/2026). Todas las pruebas del CRM fabrican la respuesta de «Reportar mensaje (entrante)» con este
 * helper y no inventan otra forma. En `atencion` de la respuesta 200 (ya aplicado el mensaje):
 *   - `conversacionDesde`: ISO UTC con Z, SIN fracciones, o null (el inicio de la conversacion del cobro);
 *   - `conversacionNueva`: boolean, true solo si ESTE mensaje abrio conversacion (o bloque nuevo).
 * Apertura: `{ desdeMs: ahora, nueva: true }`; despues: `{ desdeMs: el mismo, nueva: false }`.
 */
export const isoSinFracciones = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function atencionDeConversacion(o: { desdeMs: number | null; nueva: boolean }): Record<string, unknown> {
  return { conversacionDesde: o.desdeMs === null ? null : isoSinFracciones(o.desdeMs), conversacionNueva: o.nueva };
}

/** La respuesta 200 completa de «Reportar mensaje (entrante)» con ese contrato. */
export function respuestaDeIngesta(o: { desdeMs: number | null; nueva: boolean }): Record<string, unknown> {
  return { ok: true, atencion: atencionDeConversacion(o) };
}
