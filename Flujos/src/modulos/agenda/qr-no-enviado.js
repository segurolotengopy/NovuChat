// META RECHAZO EL QR DE LA SEÑA (salida de error de `Enviar QR de la seña`).
//
// El paciente ya leyo que «a continuacion le llega el QR» y la cita quedo
// como PENDIENTE DE SEÑA en el calendario, asi que NO se puede dejar pasar en
// silencio: se avisa a recepcion para que lo llame o le mande el QR a mano.
// El QR que no salio NO se reporta a la consola (no hubo mensaje, no se
// cuenta, y el servidor no abre una solicitud que nadie puede completar); la
// cita retenida la limpia el flujo de señas vencidas cuando pasen los minutos.
const item = $input.first().json;
let previo = {};
try { previo = $('Preparar seña').first().json; } catch (e) { previo = {}; }
const detalle = String((item && (item.error && (item.error.message || item.error.description))) || item.error || '').slice(0, 160);
return [{ json: {
  ...previo,
  transferir: true,
  motivoTransferencia: 'no se pudo enviar el QR de la seña al paciente (Meta lo rechazo'
    + (detalle ? `: ${detalle}` : '') + '); la cita quedo retenida como PENDIENTE DE SEÑA: '
    + 'mandarle el QR a mano o darle otra forma de pagar la seña',
  qrNoEnviado: true,
}, pairedItem: { item: 0 } }];
