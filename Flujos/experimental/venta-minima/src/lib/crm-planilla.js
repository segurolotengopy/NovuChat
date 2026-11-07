// ADAPTADOR DEL RESTAURANTE para «Decidir fila de la planilla» (miniCRM). Se concatena DESPUÉS de `adaptador-senales.js` (que define `CRM_ADAPTADOR`) y solo cambia el RESUMEN (columna I):
// si el prospecto trae `resumenVenta` (lo arma `vmProspectoCrm` desde el pedido que calculó el código), ese es el resumen. Sin él, al CREAR la fila rige el de las señales
// («Escribió por WhatsApp.») y al ACTUALIZAR no se toca la celda (una derivación o un primer contacto no borran el último pedido). Calificación y prioridad: las del adaptador general.
// NUNCA dice que alguien pagó. MENSAJES: ninguno.
const CRM_RESUMEN_SENALES = CRM_ADAPTADOR.resumir;
CRM_ADAPTADOR.resumir = function (p, conEstado, calificacionFinal) {
  const venta = p && typeof p.resumenVenta === 'string' ? crmLimpio(p.resumenVenta).slice(0, 200) : '';
  if (venta) return venta;
  return conEstado ? CRM_RESUMEN_SENALES(p, conEstado, calificacionFinal) : '';
};
