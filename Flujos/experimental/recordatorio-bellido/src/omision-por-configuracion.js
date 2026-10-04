// Revisar omision (solo en el flujo definitivo): llega aqui lo que «Preparar recordatorios» dejo sin recordatorios.
// Si fue porque no hay citas que correspondan, la ejecucion termina en verde. Si fue por CONFIGURACION (una variable de
// la plantilla de mas de 30 caracteres o `prefijosPermitidos` vacio), ninguna cita pudo salir por un defecto del flujo,
// no por el calendario: termina en ERROR visible. El mensaje lleva solo la causa de configuracion, sin datos del paciente.
const fallas = [...new Set($input.all().flatMap((it) => (it.json && Array.isArray(it.json.fallaConfiguracion) ? it.json.fallaConfiguracion : [])))];
if (fallas.length) throw new Error('Recordatorio no enviado: configuracion invalida (' + fallas.join(' | ') + ').');
return [];
