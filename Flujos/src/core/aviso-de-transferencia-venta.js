// El aviso al dueno por una TRANSFERENCIA, con su texto propio.
//
// `Avisar al dueño` lo comparten el pedido confirmado, el QR no enviado, el
// cobro y el uso extendido, y lee `textoAviso` si existe. `Procesar respuesta`
// NO emite `textoAviso` (es del pedido): con [PEDIDO_CONFIRMADO] y [TRANSFERIR]
// en el mismo turno, el dueno perdia el aviso del pedido y recibia dos veces el
// de la transferencia. Este nodo pasa el texto propio de la transferencia al
// campo que lee el envio, y solo en esta rama.
//
// NO ENVIA NADA: cuesta CERO mensajes de WhatsApp.
return $input.all().map((i, idx) => ({
  json: { ...i.json, textoAviso: i.json.textoAvisoTransferencia },
  pairedItem: { item: idx },
}));
