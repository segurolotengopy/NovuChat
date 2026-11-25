// MÓDULO PEDIDOS — EL BOTÓN «CONFIRMAR PEDIDO» ES EL DISPARADOR DEL QR (Andres, 23/11/2026; regla general para todo comercio con cobro por QR):
// «SIEMPRE se debe enviar el QR junto con el pedido confirmado, ESE es el disparador para enviar el QR».
// Se INCLUYE en los flujos con cobro por QR que arman el pedido por conversación (construir.mjs, lista de librerías), nunca se copia. Funciones puras, sin red ni globales de Node.
//
// QUÉ HACE. Cuando el pedido está listo (piezas y entrega completa) y todavía no hay un QR abierto, el mensaje de ese turno lleva el botón «Confirmar pedido» (el MISMO mensaje que ya salía: 0 mensajes por conversación
// más). Tocarlo es la orden de cierre: el QR sale en el mismo turno. El texto «pagar» o «confirmo mi pedido» sigue valiendo (lo reconoce cada flujo). Q'Taco ya lo hace con su propio plan; esta es la pieza común para
// los flujos de conversación libre (Casa Bermejo y, por Auxiliar 2, Walisuma). El id del botón llega por `seleccionId` de «Normalizar entrada» (un button_reply conserva su id).
const CF_ID_CONFIRMAR = 'pedido:confirmar';   // el id del botón es `pedido:confirmar:<huella del carrito>`: confirma SOLO el pedido que el cliente vio
const CF_TITULO_CONFIRMAR = 'Confirmar pedido';
const CF_MAX_CUERPO = 1024;   // el tope del cuerpo de un mensaje con botones de WhatsApp
// La huella del PEDIDO que muestra el mensaje: un hash corto de sus piezas (id, cantidad, detalle y precio) y de la entrega (todos sus campos, en orden), en minúsculas y cifras (un id de botón admite [a-z0-9:_-]). Si el carrito o la entrega
// cambian, el botón viejo ya no coincide. Solo viaja el hash: ningún dato de la entrega (el documento incluido) sale en el id.
function cfHuella(lineas, entrega, numeroDePedido) {
  const piezas = (Array.isArray(lineas) ? lineas : []).map((l) => String(l && l.id) + ':' + String(l && l.cantidad) + ':' + String((l && l.detalle) || '') + ':' + String((l && l.precioCentavos) || '')).sort().join('|');
  const e = entrega && typeof entrega === 'object' && !Array.isArray(entrega) ? entrega : {};
  const envio = Object.keys(e).sort().map((k) => k + '=' + String(e[k])).join(';');
  const texto = piezas + '#' + envio + '#' + String(Number.isFinite(numeroDePedido) ? numeroDePedido : 0);   // el contador de pedidos: el botón de un pedido ya cerrado no vuelve a coincidir nunca
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
// ¿El toque es el del botón «Confirmar pedido» DE ESTE PEDIDO? Solo el id exacto con la huella del pedido actual: ni el título escrito a mano, ni otro botón, ni el botón de un mensaje con otro carrito u otra entrega.
function cfEsConfirmacion(seleccionId, lineasActuales, entregaActual, numeroDePedido) { return seleccionId === CF_ID_CONFIRMAR + ':' + cfHuella(lineasActuales, entregaActual, numeroDePedido); }
// ¿Es el toque de un botón «Confirmar pedido» (de cualquier pedido)? Para responder a los que ya no corresponden.
function cfEsToqueDeConfirmar(seleccionId) { return typeof seleccionId === 'string' && seleccionId.indexOf(CF_ID_CONFIRMAR + ':') === 0; }
// ¿Se ofrece el botón? Hay piezas, la entrega está completa y NO hay un QR abierto (con un QR abierto ya se confirmó).
function cfSeOfrece(cantidadDePiezas, entregaCompleta, qrAbierto) { return cantidadDePiezas > 0 && entregaCompleta === true && qrAbierto !== true; }
// La frase que acompaña al botón, en el trato del comercio.
function cfInstruccion(usted) { return usted ? 'Si todo está bien, toque «' + CF_TITULO_CONFIRMAR + '».' : 'Si todo está bien, toca «' + CF_TITULO_CONFIRMAR + '».'; }
// El cuerpo del mensaje con el botón: el texto del turno MÁS la instrucción, sin pasar de 1.024 caracteres (si el texto es largo se recorta ÉL, nunca la instrucción).
function cfCuerpo(cuerpo, usted) {
  const instr = cfInstruccion(usted);
  const base = String(cuerpo === undefined || cuerpo === null ? '' : cuerpo).trim();
  if (base === '') return instr;
  if (base.indexOf(instr) >= 0) return base.slice(0, CF_MAX_CUERPO);
  const sitio = CF_MAX_CUERPO - instr.length - 2;
  const corto = base.length > sitio ? base.slice(0, Math.max(0, sitio - 1)).trimEnd() + '…' : base;
  return corto + '\n\n' + instr;
}
// El botón, en la forma que espera `cmBotones`, con la huella del pedido que se muestra.
function cfBoton(lineas, entrega, numeroDePedido) { return { id: CF_ID_CONFIRMAR + ':' + cfHuella(lineas, entrega, numeroDePedido), title: CF_TITULO_CONFIRMAR }; }
