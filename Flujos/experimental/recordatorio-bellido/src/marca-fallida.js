// Enviado pero NO marcado (solo en el flujo definitivo): llegan aqui las citas cuya plantilla Meta SI acepto pero cuya
// marca [recordado] no se pudo escribir en el calendario. Sin la marca, repetir la ejecucion completa las reenviaria al
// paciente, y «Retry» tampoco sirve (reintenta este nodo, que lanzo el error, y repite el throw). Recepcion agrega
// [recordado] a mano en la descripcion de los eventos listados.
// El mensaje lleva la cuenta y los eventoId (identificadores del calendario), nunca el telefono ni datos del paciente.
const items = $input.all();
const ids = items.map((it) => String((it.json || {}).eventoId || '').replace(/[^\w@.-]/g, '')).filter(Boolean);
throw new Error('Enviado pero no marcado: ' + items.length + ' cita(s)' + (ids.length ? ' (eventoId: ' + ids.join(', ') + ')' : '') + '. Recepcion agrega [recordado] a mano en la descripcion de los eventos listados. No se usa Retry ni una ejecucion completa el mismo dia (reenviaria la plantilla).');
