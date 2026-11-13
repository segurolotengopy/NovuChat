// REVISAR ANTES DE AGREGAR (reclamo 62, 12/11/2026): MITIGA la carrera que duplicó filas (dos ejecuciones casi a la vez que leyeron la hoja ANTES de que la otra agregara).
// «Releer teléfono antes de agregar» vuelve a leer, justo antes de escribir, las filas de ESTE teléfono; este nodo decide con esa lectura FRESCA:
//   - si ya hay una fila de ESTA conversación (la más reciente del teléfono es de la misma conversación de 24 h; sin ancla de la ingesta, cualquier fila del teléfono) otra ejecución se adelantó:
//     NO se agrega una segunda, y el prospecto de ESTE turno se convierte en una ACTUALIZACIÓN de esa fila (con la lógica de siempre de `crmDecidirFila`: no se pierde el nombre ni el negocio);
//   - si no, deja pasar la fila a agregar tal cual la decidió «Decidir fila de la planilla» (con su ID);
//   - si la lectura FALLA (Google caído) no se agrega a ciegas: sale una acción «nada» con su veredicto `no_leida`.
// La salida va a «¿Sigue siendo agregar?»: agregar → «Agregar fila»; actualizar o nada → «¿Actualizar fila?».
// LA VENTANA QUE QUEDA (Google Sheets no tiene candado): entre esta lectura y el «Agregar fila» (dos llamadas seguidas, cientos de milisegundos). Dos ejecuciones que lleguen a releer a la vez y vean
// «no hay fila» todavía pueden duplicar: esto MITIGA, no cierra. Tampoco evita que dos teléfonos DISTINTOS calculen el mismo ID (lo calcula «Decidir» con la lectura de IDs previa).
// MENSAJES: ninguno. Usa `crmMismaConversacion`, `crmFilaMasReciente`, `crmFallido` y `crmDecidirFila` de `crm.js` (el mismo criterio que «Decidir fila de la planilla»).
const crmDecididas = $('Decidir fila de la planilla').all();
const crmProspectos = $('Prospecto para la planilla').all();
const crmEntrada = $input.all();
const crmReleidas = crmEntrada.map((x) => x.json).filter((f) => f && typeof f === 'object' && f.row_number !== undefined);
const crmFalloLectura = crmEntrada.find(crmFallido);
const crmSalida = [];
crmDecididas.forEach((it, k) => {
  const j = it.json;
  if (!j || j.accionPlanilla !== 'agregar') return;
  const idx = it.pairedItem && typeof it.pairedItem.item === 'number' ? it.pairedItem.item : k;
  if (crmFalloLectura) { crmSalida.push({ json: { accionPlanilla: 'nada', veredictoPlanilla: 'no_leida: ' + crmPorque(crmFalloLectura.error ?? crmFalloLectura.json.error) }, pairedItem: { item: 0 } }); return; }
  const prospecto = crmProspectos[idx];
  if (!prospecto || !prospecto.json) { crmSalida.push({ json: { accionPlanilla: 'nada', veredictoPlanilla: 'sin_prospecto' }, pairedItem: { item: 0 } }); return; }
  const p = prospecto.json;
  const tel = crmDigitos(j[CRM_MAPA.columnas.telefono.titulo]);
  const desdeMs = crmMsValido(p.conversacionDesdeMs);
  const delTelefono = crmReleidas.filter((f) => crmDigitos(f[CRM_MAPA.columnas.telefono.titulo]) === tel);
  const reciente = crmFilaMasReciente(delTelefono);
  const yaExiste = !!reciente && (desdeMs === null || crmMismaConversacion(reciente, CRM_MAPA, desdeMs));
  if (!yaExiste) { crmSalida.push({ json: j, pairedItem: { item: 0 } }); return; }
  // otra ejecución se adelantó: este turno ACTUALIZA esa fila (sin IDs que calcular: no se agrega nada)
  const actualizacion = crmDecidirFila({
    prospectos: [{ json: { ...p, telefono: tel } }], // (con el teléfono en dígitos: el mismo criterio con que se filtró la relectura)
    busqueda: crmEntrada.filter((x) => x.json && x.json.row_number !== undefined),
    lecturaIds: [],
    mapa: CRM_MAPA,
    adaptador: typeof CRM_ADAPTADOR !== 'undefined' ? CRM_ADAPTADOR : { calificar: capCalificar, resumir: capResumir, prioridad: CAP_PRIORIDAD },
    ahoraMs: Date.now(),
  });
  // En este camino nunca se AGREGA (sin IDs leídos el ID saldría mal): lo que no sea actualizar o nada se descarta con su veredicto.
  for (const a of actualizacion) crmSalida.push({ json: a.json.accionPlanilla === 'agregar' ? { accionPlanilla: 'nada', veredictoPlanilla: 'sin_fila_para_actualizar' } : a.json, pairedItem: { item: 0 } });
});
return crmSalida;
