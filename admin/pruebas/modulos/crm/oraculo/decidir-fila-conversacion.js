// ORÁCULO NUEVO (08/11/2026): la regla de «una fila por conversación» escrita APARTE y en simple, para compararla con el módulo. Nunca entra a un flujo.
//   - Sin fila previa del teléfono: se agrega.
//   - Sin ancla (la ingesta no respondió): se actualiza la fila más reciente, NUNCA se crea.
//   - Con ancla: la fila más reciente es de esta conversación si su celda «Se cierra la ventana de 24 h» (AAAA-MM-DD HH:MM, hora de La Paz, UTC-4) es mayor o igual
//     que ancla + 24 h, ambos al minuto; si es de otra conversación o no se lee, se agrega.
//   - `nuevoContacto` (la regla de 48 h) no decide nada.
export function decidirAccion({ hayFila, desdeMs, ventanaCelda }) {
  if (!hayFila) return 'agregar';
  if (desdeMs === null || desdeMs === undefined) return 'actualizar';
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(ventanaCelda ?? '').trim());
  if (!m) return 'agregar';
  const celdaMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + 4, Number(m[5]));
  const minimo = Math.floor((desdeMs + 24 * 3600 * 1000) / 60000) * 60000;
  return celdaMs >= minimo ? 'actualizar' : 'agregar';
}
