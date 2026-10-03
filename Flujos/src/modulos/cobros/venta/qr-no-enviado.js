// META RECHAZÓ EL QR DEL COBRO (salida de error de «Enviar QR de cobro»).
//
// El cliente ya leyó que le llega el QR --o ni siquiera eso, si el texto viajaba
// en el pie de la imagen que no salió: entonces no recibió NADA en su turno-- y
// del otro lado hay un pedido armado. No se puede dejar pasar en silencio: se
// avisa al negocio para que lo llame o le mande el QR a mano, Y el cliente recibe
// UN mensaje corto con el boton para escribirle directo al negocio (politica
// «solo se ofrece lo que se cumple»: lo unico que se ofrece es pasar con una
// persona). Ese mensaje sale por el embudo `Mensaje a enviar`, que arma el
// boton porque `transferir` es true. Ese mensaje SI se reporta como saliente,
// porque sale con id de Meta (el reporte cuelga del envio, no de este nodo);
// solo el aviso al dueno queda fuera del reporte. No promete QR ni tiempos.
//
// EL QR QUE NO SALIÓ NO SE REPORTA A LA CONSOLA: no hubo mensaje, no se cuenta,
// y el servidor no abre un pago pendiente que nadie va a poder completar. Sin
// pago pendiente, la próxima imagen que mande el cliente vuelve a ser una
// imagen, que es lo correcto.
//
// LIMITACION CONOCIDA (decision D11, aceptada por Andres): `Responder al cliente`
// no tiene `onError`. Si Meta rechaza tambien el texto al cliente, la ejecucion
// se detiene y no corren el aviso al dueno ni `¿Pedido confirmado?`. Es el
// «ultimo recurso ruidoso» para el texto al cliente. La razon: si Meta rechaza el
// texto y el QR a la vez, lo normal es una caida de Meta, y el aviso al dueno
// tambien fallaria.
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
// Respaldo si fallan las dos referencias: al menos el telefono y el negocio.
if (!previo || Object.keys(previo).length === 0) {
  try { previo = $('Normalizar entrada').first().json ?? {}; } catch (e) { previo = {}; }
}

// El error puede ser texto u objeto sin `message`: nunca «[object Object]».
const err = item && item.error;
const detalle = String((err && typeof err === 'object')
  ? (err.message || err.description || '')
  : (err || '')).slice(0, 160);
// EL TEXTO AL CLIENTE SE ARMA DESDE SUS PARTES; el pie de la imagen NO se recicla.
// El pie lleva lineas que piden cosas imposibles sin el QR («Escanea el QR»,
// «envia la foto de tu comprobante», «Este es el QR de tu pedido»). Con cobro
// simulado se conserva solo el rotulo de simulacro (prohibicion 3); con cobro
// real, solo la frase. El boton de `Mensaje a enviar` ya ofrece pasar con el negocio.
let cfg = {};
try { cfg = $('Config del negocio').first().json ?? {}; } catch (e) { cfg = {}; }
// Sin `qrEsReal` (el preparador no se pudo leer) se decide por la configuracion:
// ante la duda, simulado, que es el modo que obliga al rotulo.
const simulado = previo.qrEsReal === undefined
  ? String(cfg.cobroRealActivo || '') !== 'si'
  : previo.qrEsReal !== true;
const rotulo = simulado ? String(cfg.rotuloDemo || '').trim() : '';
const respuestaAlCliente = (rotulo ? rotulo + '\n\n' : '') + 'No pude enviarte la imagen del QR.';
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
