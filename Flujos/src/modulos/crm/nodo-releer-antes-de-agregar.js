// REVISAR ANTES DE AGREGAR (reclamo 62, 12/11/2026): cierra la carrera que duplicó filas (dos ejecuciones casi a la vez que leyeron la hoja ANTES de que la otra agregara).
// «Releer teléfono antes de agregar» vuelve a leer, justo antes de escribir, las filas de ESTE teléfono; este nodo decide con esa lectura FRESCA:
//   - si ya hay una fila de ESTA conversación (la más reciente del teléfono es de la misma conversación de 24 h; sin ancla de la ingesta, cualquier fila del teléfono), NO agrega:
//     otra ejecución se adelantó y la siguiente actualización del turno escribirá sobre esa fila (la regla de siempre: la más reciente);
//   - si no, deja pasar la fila a agregar tal cual la decidió «Decidir fila de la planilla».
// La ventana que queda: entre esta lectura y el «Agregar fila» (dos llamadas a Google seguidas, de cientos de milisegundos). Google Sheets no tiene candado.
// Si la lectura FALLA (Google caído) no se agrega a ciegas: la fila queda sin crear y el turno sigue (la cuota y el error ya los muestra «Buscar teléfono»).
// MENSAJES: ninguno. Usa `crmMismaConversacion` y `crmFilaMasReciente` de `crm.js` (el mismo criterio que «Decidir fila de la planilla»).
const crmDecididas = $('Decidir fila de la planilla').all();
const crmProspectos = $('Prospecto para la planilla').all();
const crmReleidas = $input.all().map((x) => x.json).filter((f) => f && typeof f === 'object');
const crmLecturaFallo = crmReleidas.some((f) => f.error !== undefined && f.row_number === undefined);
const crmSalida = [];
crmDecididas.forEach((it, k) => {
  const j = it.json;
  if (!j || j.accionPlanilla !== 'agregar') return;
  if (crmLecturaFallo) return; // sin lectura fresca no se agrega a ciegas
  const idx = it.pairedItem && typeof it.pairedItem.item === 'number' ? it.pairedItem.item : k;
  const p = (crmProspectos[idx] && crmProspectos[idx].json) || {};
  const tel = crmDigitos(j[CRM_MAPA.columnas.telefono.titulo]);
  const desdeMs = crmMsValido(p.conversacionDesdeMs);
  const delTelefono = crmReleidas.filter((f) => f.row_number !== undefined && crmDigitos(f[CRM_MAPA.columnas.telefono.titulo]) === tel);
  const reciente = crmFilaMasReciente(delTelefono);
  const yaExiste = !!reciente && (desdeMs === null || crmMismaConversacion(reciente, CRM_MAPA, desdeMs));
  if (!yaExiste) crmSalida.push({ json: j, pairedItem: { item: idx } });
});
return crmSalida;
