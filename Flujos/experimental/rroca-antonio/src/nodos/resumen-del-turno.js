// RESUMEN DEL TURNO: el último nodo. En producción no hace nada visible. En la variante de prueba, «Entrada de prueba» responde con lo que devuelve este nodo (modo `lastNode`):
// los mensajes del turno y un resumen, para que un corredor externo evalúe cada turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y no de lo que devolvieron los nodos de envío ni de reporte (un nodo desactivado deja pasar su entrada). Cuelga de «Armar mensajes» por debajo
// de todo el lienzo, así que con `executionOrder: v1` corre después de los envíos.
const items = cnTodos('Armar mensajes');

// ENTREGA (regla I-ENTREGA, «se entrega lo que se promete»): este nodo corre DESPUÉS de los envíos (está abajo en el lienzo y `executionOrder` es v1). Un mensaje al cliente cuenta como
// entregado SOLO si Meta devolvió un `messages[0].id` no vacío, por el envío principal o por su respaldo en texto. Si hubo mensajes que no salieron ni por uno ni por el otro, la
// ejecución termina en ERROR (visible en n8n) en vez de en `success`. No se reporta nada como enviado (`¿Meta aceptó?` exige el id) y el error no lleva texto ni número del cliente.
// Con el envío saltado (modo prueba sin `enviarDeVerdad`) `Enviar a WhatsApp` no corrió y no hay nada que verificar.
const raId = (j) => {
  const m = j && j.messages;
  return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
};
if (cnNodo('Enviar a WhatsApp')) {
  const raEsperados = items.filter((i) => i && i.sinMensajes !== true).length;
  const raEntregados = cnTodos('Enviar a WhatsApp').filter(raId).length + cnTodos('Enviar respaldo').filter(raId).length;
  if (raEntregados < raEsperados) {
    throw new Error('Entrega fallida: Meta rechazó el envío y su respaldo en texto; ' + (raEsperados - raEntregados) + ' de ' + raEsperados + ' mensaje(s) al cliente sin entregar. El cliente no recibió respuesta.');
  }
}
const cfg = cnCfg();
const primero = items[0] || {};
const mensajes = items.filter((i) => i && i.sinMensajes !== true).map((i) => ({
  para: i.para, destino: i.destino, payload: i.payload, texto: i.texto, respaldo: i.respaldo, reportar: i.reportar === true,
}));
const r = primero.resumen || { plan: primero.plan || 'nada', mensajes: 0 };
return [{ json: {
  ok: true,
  modoPrueba: cfg.modoPrueba === true,
  mensajes: mensajes,
  resumen: Object.assign({}, r, { mensajesSalientes: mensajes.length }),
} }];
