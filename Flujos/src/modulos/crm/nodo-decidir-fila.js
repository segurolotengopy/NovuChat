// DECIDIR FILA DE LA PLANILLA: con lo que se leyo de la hoja, decide si el prospecto es una fila NUEVA o una que YA EXISTE, y arma lo que se escribe.
// La logica y el mapa de columnas estan en `crm.js` (modulo `crm`); como se califica y se resume, en el adaptador de captacion (`crm-captacion.js`).
//
// SE LEE LO MINIMO. Dos lecturas chicas: `Buscar teléfono en planilla` (solo las filas de ESTE telefono, solo las columnas del bot: nunca las del equipo)
// y `Leer IDs de la planilla` (solo la columna del ID). No escribe: eso lo hacen `Agregar fila` y `Actualizar fila`, segun `accionPlanilla`. Sin modelo.
// MENSAJES: ninguno.
return crmDecidirFila({
  prospectos: $('Prospecto para la planilla').all(),
  busqueda: $('Buscar teléfono en planilla').all(),
  lecturaIds: $input.all(),
  mapa: CRM_MAPA,
  adaptador: { calificar: capCalificar, resumir: capResumir, prioridad: CAP_PRIORIDAD },
  ahoraMs: Date.now(),
});
