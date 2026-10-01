// RESUMEN DEL TURNO: el ultimo nodo. En produccion no hace nada visible. En la variante
// de prueba, «Entrada de prueba» responde con lo que devuelve este nodo: la lista de
// mensajes salientes del turno y un resumen, para que un corredor externo evalue cada
// turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y no de lo que devolvieron los nodos de envio
// ni de reporte (un nodo desactivado deja pasar su entrada). Corre una vez por cada rama
// que llega hasta aca y siempre da lo mismo.
const items = cnTodos('Armar mensajes');
const cfg = cnCfg();
const primero = items[0] || {};
const mensajes = items.filter((i) => i && i.sinMensajes !== true).map((i) => ({
  para: i.para, destino: i.destino, payload: i.payload, texto: i.texto, respaldo: i.respaldo, reportar: i.reportar === true,
}));
const r = primero.resumen || {
  plan: primero.plan || 'nada', estadoDespues: primero.estadoDespues || null, errores: primero.errores || [],
  huecosOfrecidos: primero.huecosOfrecidos || [], eventoCreadoId: primero.eventoCreadoId || '', eventoBorradoId: primero.eventoBorradoId || '',
};
let accion = r.plan;
if (r.eventoCreadoId) accion = r.eventoBorradoId ? 'cita_movida' : 'cita_creada';
else if (r.plan === 'cancelar' && r.eventoBorradoId) accion = 'cita_cancelada';
else if (r.plan === 'cruce') accion = 'cruce_deshecho';
return [{ json: {
  ok: true,
  modoPrueba: cfg.modoPrueba === true,
  mensajes: mensajes,
  resumen: {
    ruta: r.plan, accion: accion, huecosOfrecidos: r.huecosOfrecidos, eventoCreadoId: r.eventoCreadoId,
    eventoBorradoId: r.eventoBorradoId, estadoDespues: r.estadoDespues, errores: r.errores, mensajesSalientes: mensajes.length,
  },
} }];
