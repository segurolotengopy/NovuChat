// RESUMEN DEL TURNO (Venta mínima v0): el último nodo. En producción no hace nada visible. En la
// variante de prueba, «Entrada de prueba» responde con lo que devuelve este nodo: los mensajes al
// cliente, los avisos al restaurante y un resumen del turno, para que un corredor externo evalúe
// cada turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Soltar mensajes» (los mensajes ya decididos, con el estado comprometido) y «Armar avisos», y no de lo que devolvieron los nodos de
// envío ni de reporte (un nodo desactivado deja pasar su entrada). Corre una vez por cada rama que
// llega hasta acá y siempre da lo mismo. (Excepción deliberada: la verificación de entrega de abajo SÍ lee lo que devolvieron
// `Enviar a WhatsApp` y `Enviar respaldo`, porque su objetivo es justamente saber si Meta aceptó el mensaje.)
const RT_items = vmTodos('Soltar mensajes');

// R3, ULTIMO RECURSO («se entrega lo que se promete»). Este nodo corre despues de los envios (esta por debajo de `¿Enviar de
// verdad?` en el lienzo y `executionOrder` es v1). Un mensaje al cliente cuenta como entregado SOLO si Meta devolvio un
// `messages[0].id` no vacio, por el envio principal o por su respaldo en texto. Si hubo mensajes que no salieron ni por uno ni
// por el otro, la ejecucion termina en ERROR (visible en n8n) en vez de en `success`. El estado del telefono se trata asi:
//   - SIN hecho externo (no salio ningun aviso a terceros y no corrio `Registrar cierre`): el estado VUELVE al de antes del turno (bloque entero, con su `ultimoMensajeMs`: la ancla de las
//     claves estables, B0) y tambien sus pedidos; el cliente no recibio el paso nuevo (un QR, una pregunta) y, al reconfirmar, `pedidoId`, codigo y cierre salen IGUALES (nunca un segundo pedido);
//   - CON hecho externo (el restaurante ya recibio el aviso o el cierre quedo registrado): el estado nuevo queda, en el paso `menu` (salvo `esperando_comprobante`): un boton viejo solo muestra el
//     menu. LIMITE CONOCIDO: no se deshace el aviso ya enviado ni el cierre; el error de n8n es la senal para que una persona le escriba al cliente.
// Quien arma y manda esa compensacion es `Confirmar envio` -> `Comprometer compensacion` (el estado vive en el servidor); aqui solo se corta y se cuenta cual fue el resultado.
// No se reporta nada como enviado (`¿Reportar? (saliente)` exige el id) y el error no lleva texto ni numero del cliente.
// Con el envio saltado (modo prueba sin `enviarDeVerdad`) `Enviar a WhatsApp` no corrio y no hay nada que verificar.
const rtId = (j) => {
  const m = j && j.messages;
  return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
};
if (vmNodo('Enviar a WhatsApp')) {
  // Solo cuentan los mensajes AL CLIENTE: el aviso de transferencia que acompaña al genérico de una falla (destino `recepcion`, siempre el último ítem) no corta el turno si Meta lo rechaza.
  const RT_enviables = RT_items.filter((i) => i && i.sinMensajes !== true);
  const RT_envios = vmTodos('Enviar a WhatsApp');
  const RT_respaldos = vmTodos('Enviar respaldo');
  let RT_usados = 0;
  let RT_esperados = 0;
  let RT_entregados = 0;
  RT_enviables.forEach((it, k) => {
    const final = rtId(RT_envios[k]) ? RT_envios[k] : RT_respaldos[RT_usados++];
    if (it.destino === 'recepcion') return;
    RT_esperados++;
    if (rtId(final)) RT_entregados++;
  });
  if (RT_entregados < RT_esperados) {
    const RT_comp = vmNodo('Comprometer compensación') ? ssResultadoDeCompromiso(vmPrimero('Comprometer compensación')) : null;
    throw new Error('Entrega fallida: Meta rechazó el envío y su respaldo en texto; ' + (RT_esperados - RT_entregados) + ' de ' + RT_esperados + ' mensaje(s) al cliente sin entregar. El cliente no recibió respuesta.'
      + (RT_comp ? (RT_comp.resultado === 'ok' ? ' [estado restaurado]' : ' [el estado NO se pudo restaurar: ' + RT_comp.resultado + ']') : ''));
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
