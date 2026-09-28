// META RECHAZÓ EL QR DEL COBRO (salida de error de «Enviar QR de cobro»).
//
// El cliente ya leyó que le llega el QR --o ni siquiera eso, si el texto viajaba
// en el pie de la imagen que no salió: entonces no recibió NADA en su turno-- y
// del otro lado hay un pedido armado. No se puede dejar pasar en silencio: se
// avisa al negocio para que lo llame o le mande el QR a mano.
//
// EL QR QUE NO SALIÓ NO SE REPORTA A LA CONSOLA: no hubo mensaje, no se cuenta,
// y el servidor no abre un pago pendiente que nadie va a poder completar. Sin
// pago pendiente, la próxima imagen que mande el cliente vuelve a ser una
// imagen, que es lo correcto.
//
// COSTO: +1 mensaje al número del negocio, solo cuando Meta rechaza el envío.
// Lo paga NovuChat y no se le cuenta al comercio.
const item = $input.first().json;
let previo = {};
try { previo = $('Preparar QR de cobro').first().json; } catch (e) { previo = {}; }

const detalle = String((item && (item.error && (item.error.message || item.error.description)))
  || (item && item.error) || '').slice(0, 160);
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
}, pairedItem: { item: 0 } }];
