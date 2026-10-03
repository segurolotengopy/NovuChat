// RESUMEN DEL TURNO (Venta mínima v0): el último nodo. En producción no hace nada visible. En la
// variante de prueba, «Entrada de prueba» responde con lo que devuelve este nodo: los mensajes al
// cliente, los avisos al restaurante y un resumen del turno, para que un corredor externo evalúe
// cada turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y «Armar avisos», y no de lo que devolvieron los nodos de
// envío ni de reporte (un nodo desactivado deja pasar su entrada). Corre una vez por cada rama que
// llega hasta acá y siempre da lo mismo. (Excepción deliberada: la verificación de entrega de abajo SÍ lee lo que devolvieron
// `Enviar a WhatsApp` y `Enviar respaldo`, porque su objetivo es justamente saber si Meta aceptó el mensaje.)
const RT_items = vmTodos('Armar mensajes');

// R3, ULTIMO RECURSO («se entrega lo que se promete»). Este nodo corre despues de los envios (esta por debajo de `¿Enviar de
// verdad?` en el lienzo y `executionOrder` es v1). Un mensaje al cliente cuenta como entregado SOLO si Meta devolvio un
// `messages[0].id` no vacio, por el envio principal o por su respaldo en texto. Si hubo mensajes que no salieron ni por uno ni
// por el otro, la ejecucion termina en ERROR (visible en n8n) en vez de en `success`, y antes se DEVUELVE el estado del telefono
// al de antes del turno: el cliente no recibio el paso nuevo (un QR, una pregunta), asi que el estado no puede quedar en ese
// paso. No se reporta nada como enviado (`¿Reportar? (saliente)` exige el id) y el error no lleva texto ni numero del cliente.
// Con el envio saltado (modo prueba sin `enviarDeVerdad`) `Enviar a WhatsApp` no corrio y no hay nada que verificar.
const rtId = (j) => {
  const m = j && j.messages;
  return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
};
if (vmNodo('Enviar a WhatsApp')) {
  const RT_esperados = RT_items.filter((i) => i && i.sinMensajes !== true).length;
  const RT_entregados = vmTodos('Enviar a WhatsApp').filter(rtId).length + vmTodos('Enviar respaldo').filter(rtId).length;
  if (RT_entregados < RT_esperados) {
    const RT_d = vmPrimero('Decidir turno');
    const RT_t = vmPrimero('Interpretar entrada') || {};
    const RT_sd = vmSd();
    if (RT_sd && RT_d && RT_d.estado && typeof RT_d.estado === 'object' && RT_t.from) {
      vmEscribirEstado(RT_sd, String(RT_t.from), RT_d.estado, Number(RT_t.ahoraMs) || Date.now());
    }
    throw new Error('Entrega fallida: Meta rechazó el envío y su respaldo en texto; ' + (RT_esperados - RT_entregados) + ' de ' + RT_esperados + ' mensaje(s) al cliente sin entregar. El cliente no recibió respuesta.');
  }
}
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
