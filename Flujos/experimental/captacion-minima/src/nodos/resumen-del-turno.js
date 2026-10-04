// RESUMEN DEL TURNO: el ultimo nodo. En produccion no hace nada visible. En la variante de prueba, «Entrada de prueba» responde
// con lo que devuelve este nodo (modo `lastNode`): los mensajes del turno y un resumen, para que un corredor externo evalue cada
// turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y no de lo que devolvieron los nodos de envio ni de reporte (un nodo desactivado deja
// pasar su entrada). Cuelga de «Armar mensajes» por debajo de todo el lienzo, asi que con `executionOrder: v1` corre despues de
// los envios y del cierre.
const items = cnTodos('Armar mensajes');
const cfg = cnCfg();
const primero = items[0] || {};
const mensajes = items.filter((i) => i && i.sinMensajes !== true).map((i) => ({
  para: i.para, destino: i.destino, payload: i.payload, texto: i.texto, respaldo: i.respaldo, reportar: i.reportar === true,
}));
const r = primero.resumen || { plan: primero.plan || 'nada', estadoDespues: null, mensajes: 0 };
return [{ json: {
  ok: true,
  modoPrueba: cfg.modoPrueba === true,
  mensajes: mensajes,
  resumen: Object.assign({}, r, { mensajesSalientes: mensajes.length }),
} }];
