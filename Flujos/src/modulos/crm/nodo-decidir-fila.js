// DECIDIR FILA DE LA PLANILLA: con lo que se leyo de la hoja, decide si el prospecto es una fila NUEVA o una que YA EXISTE, y arma lo que se escribe.
// La logica y el mapa de columnas estan en `crm.js` (modulo `crm`); como se califica y se resume, en el adaptador de captacion (`crm-captacion.js`).
//
// SE LEE LO MINIMO. Dos lecturas chicas: `Buscar teléfono en planilla` (solo las filas de ESTE telefono, solo las columnas del bot: nunca las del equipo)
// y `Leer IDs de la planilla` (solo la columna del ID). No escribe: eso lo hacen `Agregar fila` y `Actualizar fila`, segun `accionPlanilla`. Sin modelo.
// MENSAJES: ninguno.
// El adaptador: `CRM_ADAPTADOR` si el paquete lo trae (adaptador-senales.js); si no, el de captacion (capCalificar, capResumir, CAP_PRIORIDAD).
// «Leer encabezados de la planilla» es de la rama `ramaCrm`: con el paquete de senales es OBLIGATORIO (sin la lectura no se agrega: cierra en falla);
// en captacion y chat, que no la tienen, rige la comprobacion de siempre (`encabezados` indefinido).
const exigeEncabezados = typeof CRM_ADAPTADOR !== 'undefined';
let encabezados = exigeEncabezados ? [] : undefined;
try {
  const leidos = $('Leer encabezados de la planilla');
  if (leidos.isExecuted !== false) encabezados = leidos.all();
} catch (e) { /* el nodo no existe en este flujo */ }
return crmDecidirFila({
  prospectos: $('Prospecto para la planilla').all(),
  busqueda: $('Buscar teléfono en planilla').all(),
  lecturaIds: $input.all(),
  mapa: CRM_MAPA,
  encabezados,
  adaptador: typeof CRM_ADAPTADOR !== 'undefined' ? CRM_ADAPTADOR : { calificar: capCalificar, resumir: capResumir, prioridad: CAP_PRIORIDAD },
  ahoraMs: Date.now(),
});
