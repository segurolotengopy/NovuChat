// RESUMEN DEL TURNO: el último nodo. En producción no hace nada visible. En la variante de prueba, «Entrada de prueba» responde con lo que devuelve este nodo (modo `lastNode`):
// los mensajes del turno y un resumen, para que un corredor externo evalúe cada turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y no de lo que devolvieron los nodos de envío ni de reporte (un nodo desactivado deja pasar su entrada). Cuelga de «Armar mensajes» por debajo
// de todo el lienzo, así que con `executionOrder: v1` corre después de los envíos y del cierre.
const items = cnTodos('Armar mensajes');

// ENTREGA (regla I-ENTREGA, «se entrega lo que se promete»): este nodo corre DESPUÉS de los envíos (está abajo en el lienzo y `executionOrder` es v1). Un mensaje al cliente cuenta como
// entregado SOLO si Meta devolvió un `messages[0].id` no vacío, por el envío principal o por su respaldo en texto. Si hubo mensajes que no salieron ni por uno ni por el otro, la
// ejecución termina en ERROR (visible en n8n) en vez de en `success`. No se reporta nada como enviado (`¿Meta aceptó?` exige el id) y el error no lleva texto ni número del cliente.
// Con el envío saltado (modo prueba sin `enviarDeVerdad`) `Enviar a WhatsApp` no corrió y no hay nada que verificar.
const rrId = (j) => {
  const m = j && j.messages;
  return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
};
if (cnNodo('Enviar a WhatsApp')) {
  // Si el QR no salió por el envío principal (sale el respaldo en texto o nada), se DESCARTA la marca provisional de «Armar mensajes»: ni pedido contado ni QR «abierto» por 15 minutos.
  const rrPrevio = (items[0] || {}).qrPrevio;
  if (rrPrevio && typeof rrPrevio === 'object' && !cnTodos('Enviar a WhatsApp').some(rrId)) {
    const rrDesde = String((items[0] || {}).from || '');
    const rrFichas = cnMapaDeFichas(true);
    const rrF = cnFichaDe(rrFichas.mapa, rrDesde);
    if (rrF) { rrF.pedidos = Number(rrPrevio.pedidos) || 0; rrF.producto = String(rrPrevio.producto || ''); rrF.qrHastaMs = Number(rrPrevio.qrHastaMs) || 0; }
  }
  // La guarda liberada por un comprobante resuelto vuelve si no salió nada al cliente (ni el envío ni su respaldo).
  const rrLib = (items[0] || {}).qrLiberado;
  if (rrLib && typeof rrLib === 'object' && !cnTodos('Enviar a WhatsApp').some(rrId) && !cnTodos('Enviar respaldo').some(rrId)) {
    const rrFichas2 = cnMapaDeFichas(true);
    const rrF2 = cnFichaDe(rrFichas2.mapa, String((items[0] || {}).from || ''));
    if (rrF2) rrF2.qrHastaMs = Number(rrLib.qrHastaMs) || 0;
  }
  const rrEsperados = items.filter((i) => i && i.sinMensajes !== true).length;
  const rrEntregados = cnTodos('Enviar a WhatsApp').filter(rrId).length + cnTodos('Enviar respaldo').filter(rrId).length;
  if (rrEntregados < rrEsperados) {
    throw new Error('Entrega fallida: Meta rechazó el envío y su respaldo en texto; ' + (rrEsperados - rrEntregados) + ' de ' + rrEsperados + ' mensaje(s) al cliente sin entregar. El cliente no recibió respuesta.');
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
