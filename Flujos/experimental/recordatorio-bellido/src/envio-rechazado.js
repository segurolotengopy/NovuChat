// Envío rechazado (solo en el flujo definitivo): llegan aquí las citas que Meta NO aceptó (sin id de mensaje).
// Ninguna se marcó [recordado], así que un reintento las vuelve a intentar. El nodo termina la ejecución en ERROR
// para que quede rastro visible en n8n. El mensaje lleva solo la cuenta y las causas de Meta, nunca datos del
// paciente: ni teléfono, ni título, ni descripción (cualquier secuencia de 7 o más dígitos se tapa).
const causas = [...new Set($input.all().map((it) => String((it.json || {}).causa || 'sin causa').replace(/\d{7,}/g, '#')))];
throw new Error('Recordatorio no enviado: ' + $input.all().length + ' cita(s) sin recordar. Causas: ' + causas.join(' | '));
