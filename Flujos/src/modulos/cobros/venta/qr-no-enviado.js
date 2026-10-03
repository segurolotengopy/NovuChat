// META RECHAZÓ EL QR DEL COBRO (salida de error de «Enviar QR de cobro»).
//
// El cliente ya leyó que le llega el QR --o ni siquiera eso, si el texto viajaba
// en el pie de la imagen que no salió: entonces no recibió NADA en su turno-- y
// del otro lado hay un pedido armado. No se puede dejar pasar en silencio: se
// avisa al negocio para que lo llame o le mande el QR a mano, Y el cliente recibe
// UN mensaje corto con el boton para escribirle directo al negocio (politica
// «solo se ofrece lo que se cumple»: lo unico que se ofrece es pasar con una
// persona). Ese mensaje sale por el embudo `Mensaje a enviar`, que arma el
// boton porque `transferir` es true, y se reporta como saliente solo si Meta
// devolvio un id (el reporte cuelga del envio, no de este nodo). No promete QR
// ni tiempos.
//
// EL QR QUE NO SALIÓ NO SE REPORTA A LA CONSOLA: no hubo mensaje, no se cuenta,
// y el servidor no abre un pago pendiente que nadie va a poder completar. Sin
// pago pendiente, la próxima imagen que mande el cliente vuelve a ser una
// imagen, que es lo correcto.
//
// COSTO: +1 mensaje al número del negocio y +1 al cliente (con el boton adentro),
// solo cuando Meta rechaza el envío. Lo paga NovuChat y no se le cuenta al comercio.
const item = $input.first().json;
// Viene del QR del pedido o del reenvio del QR: se lee el que corrio.
const corrio = (n) => { try { return $(n).isExecuted === true; } catch (e) { return false; } };
let previo = {};
try {
  previo = $(corrio('Preparar reenvío del QR') ? 'Preparar reenvío del QR' : 'Preparar QR de cobro').first().json;
} catch (e) { previo = {}; }

const detalle = String((item && (item.error && (item.error.message || item.error.description)))
  || (item && item.error) || '').slice(0, 160);
// UN SOLO TEXTO: lo que iba en el pie de la imagen (el rotulo de simulacro
// incluido: prohibicion 3, el cobro simulado nunca se presenta como real) mas
// la frase de que la imagen no salio. Lo que el ASISTENTE habia escrito dentro
// del pie («aqui tienes el codigo QR...») se QUITA: afirma algo que no ocurrio.
let pie = String(previo.captionQr || '');
const delAsistente = previo.textoEnElQr === true ? String(previo.respuesta || '').trim() : '';
if (delAsistente) pie = pie.split(delAsistente).join('');
pie = pie.replace(/\n{3,}/g, '\n\n').trim();
const respuestaAlCliente = (pie ? pie + '\n\n' : '') + 'No pude enviarte la imagen del QR.';
const total = String(previo.cobroTotal || '').trim();

return [{ json: {
  ...previo,
  transferir: true,
  textoAviso: '🔔 NovuChat: no se pudo enviar el QR de pago al cliente '
    + `${previo.nombrePerfil || 'sin nombre de perfil'} (${previo.from || 'sin número'})`
    + (detalle ? `. Meta lo rechazó: ${detalle}` : '.')
    + (total ? ` El pedido era de ${total}.` : '')
    + ' Escribirle y mandarle el QR a mano, o darle otra forma de pagar.',
  qrNoEnviado: true,
  // Lo que ve el cliente. El boton lo arma `Mensaje a enviar` solo si hay numero
  // del negocio; el texto no menciona ningun boton, asi que sirve igual sin el.
  respuesta: respuestaAlCliente,
  enviarQr: false,
  textoEnElQr: false,
}, pairedItem: { item: 0 } }];
