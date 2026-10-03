// META RECHAZO EL QR DE LA SEÑA (salida de error de `Enviar QR de la seña`).
//
// El paciente ya leyo que «a continuacion le llega el QR» y la cita quedo
// como PENDIENTE DE SEÑA en el calendario, asi que NO se puede dejar pasar en
// silencio: se avisa a recepcion para que lo llame o le mande el QR a mano, Y
// el paciente recibe UN mensaje corto con el boton para escribirle directo a
// recepcion (politica «solo se ofrece lo que se cumple»: lo unico que se ofrece
// es pasar con recepcion). Ese mensaje sale por el embudo `Mensaje a enviar`,
// que arma el boton porque `transferir` es true, y se reporta como saliente
// porque sale con id de Meta (el reporte cuelga del envio, no de este nodo).
// El texto no promete QR, tiempos ni llamadas.
//
// EL QR QUE NO SALIO NO SE REPORTA A LA CONSOLA: no hubo mensaje, no se
// cuenta, y el servidor no abre una solicitud que nadie puede completar; la
// cita retenida la limpia el flujo de señas vencidas cuando pasen los minutos.
//
// VIENE DE DOS CAMINOS: el QR de una reserva nueva (`Preparar seña`) o el
// reenvio que pidio el paciente (`Preparar reenvío del QR`). Se lee el
// preparador que corrio, con `isExecuted`: leer `Preparar seña` en un reenvio
// tira la ejecucion, porque ese nodo no corrio (defecto del inventario (e),
// el mismo que corrigio el #378 en el Demo B).
//
// LIMITACION CONOCIDA: `Responder al cliente` no tiene `onError`. Si Meta
// rechaza tambien ese texto, la ejecucion se detiene (ultimo recurso ruidoso)
// y no corre el aviso a recepcion. Lo normal es una caida de Meta, y el aviso
// tambien fallaria.
//
// COSTO: +1 mensaje al paciente (con el boton adentro) y +1 a recepcion, solo
// cuando Meta rechaza el QR. 0 en el camino normal.
const item = $input.first().json;
const corrio = (n) => { try { return $(n).isExecuted === true; } catch (e) { return false; } };
let previo = {};
try {
  previo = $(corrio('Preparar reenvío del QR') ? 'Preparar reenvío del QR' : 'Preparar seña').first().json;
} catch (e) { previo = {}; }
// Respaldo si fallan las dos referencias: al menos el telefono y el negocio.
if (!previo || Object.keys(previo).length === 0) {
  try { previo = $('Normalizar entrada').first().json ?? {}; } catch (e) { previo = {}; }
}
let cfg = {};
try { cfg = $('Config del negocio').first().json ?? {}; } catch (e) { cfg = {}; }

// El error puede ser texto u objeto sin `message`: nunca «[object Object]».
const err = item && item.error;
const detalle = String((err && typeof err === 'object')
  ? (err.message || err.description || '')
  : (err || '')).slice(0, 160);
const usa = /\busted\b/i.test(String(cfg.tratamiento || ''));

return [{ json: {
  ...previo,
  transferir: true,
  motivoTransferencia: 'no se pudo enviar el QR de la seña al paciente (Meta lo rechazo'
    + (detalle ? `: ${detalle}` : '') + '); la cita quedo retenida como PENDIENTE DE SEÑA: '
    + 'mandarle el QR a mano o darle otra forma de pagar la seña',
  qrNoEnviado: true,
  // Lo que ve el paciente. El boton lo arma `Mensaje a enviar` solo si hay
  // numero de recepcion; el texto no menciona ningun boton, asi que sirve igual
  // sin el. Sin promesas: ni «le llega», ni «le escribimos», ni «le llamamos».
  respuesta: usa ? 'No pude enviarle la imagen del QR de la seña.' : 'No pude enviarte la imagen del QR de la seña.',
  // Este mensaje no es el del turno: no repite el pin ni el QR, y su reporte
  // no lleva el evento de seña del mensaje original.
  enviarUbicacion: false,
  reenviarQr: false,
  eventoSena: null,
}, pairedItem: { item: 0 } }];
