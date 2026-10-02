// RESUMEN DEL TURNO (Venta mínima v0): el último nodo. En producción no hace nada visible. En la
// variante de prueba, «Entrada de prueba» responde con lo que devuelve este nodo: los mensajes al
// cliente, los avisos al restaurante y un resumen del turno, para que un corredor externo evalúe
// cada turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y «Armar avisos», y no de lo que devolvieron los nodos de
// envío ni de reporte (un nodo desactivado deja pasar su entrada). Corre una vez por cada rama que
// llega hasta acá y siempre da lo mismo.
const RT_items = vmTodos('Armar mensajes');
const RT_avisos = vmTodos('Armar avisos').filter((i) => i && i.sinAviso !== true && i.payload);
const RT_cfg = vmCfg();
const RT_primero = RT_items[0] || {};
const RT_mensajes = RT_items.filter((i) => i && i.sinMensajes !== true).map((i) => ({
  para: i.para, destino: i.destino, payload: i.payload, texto: i.texto, respaldo: i.respaldo, reportar: i.reportar === true,
  evento: i.evento, referencia: i.referencia, monto: i.monto,
}));
const RT_avisosSalida = RT_avisos.map((i) => ({
  para: i.para, rol: i.rol, tipoAviso: i.tipoAviso, esPlantilla: i.esPlantilla === true, payload: i.payload, respaldo: i.respaldo,
}));
const RT_r = RT_primero.resumen || {
  ruta: 'nada', estadoDespues: null, errores: RT_primero.errores || [], avisoSalio: false, avisosArmados: RT_avisos.length,
  avisosConWamid: 0, qrRechazado: false, mensajesSalientes: 0,
};
return [{ json: {
  ok: true,
  modoPrueba: RT_cfg.modoPrueba === true,
  mensajes: RT_mensajes,
  avisos: RT_avisosSalida,
  resumen: {
    ruta: RT_r.ruta, estadoDespues: RT_r.estadoDespues, errores: RT_r.errores, avisoSalio: RT_r.avisoSalio === true,
    avisosArmados: RT_avisos.length, avisosConWamid: RT_r.avisosConWamid || 0, qrRechazado: RT_r.qrRechazado === true,
    cierre: RT_primero.cierre || null, mensajesSalientes: RT_mensajes.length,
  },
} }];
