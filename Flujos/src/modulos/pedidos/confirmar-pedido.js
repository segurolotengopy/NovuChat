// MÓDULO PEDIDOS — EL BOTÓN «CONFIRMAR PEDIDO» ES EL DISPARADOR DEL QR (Andres, 23/11/2026; regla general para todo comercio con cobro por QR):
// «SIEMPRE se debe enviar el QR junto con el pedido confirmado, ESE es el disparador para enviar el QR».
// Se INCLUYE en los flujos con cobro por QR que arman el pedido por conversación (construir.mjs, lista de librerías), nunca se copia. Funciones puras, sin red ni globales de Node.
//
// QUÉ HACE. Cuando el pedido está listo (piezas y entrega completa) y todavía no hay un QR abierto, el mensaje de ese turno lleva el botón «Confirmar pedido» (el MISMO mensaje que ya salía: 0 mensajes por conversación
// más). Tocarlo es la orden de cierre: el QR sale en el mismo turno. El texto «pagar» o «confirmo mi pedido» sigue valiendo (lo reconoce cada flujo). Q'Taco ya lo hace con su propio plan; esta es la pieza común para
// los flujos de conversación libre (Casa Bermejo y, por Auxiliar 2, Walisuma). El id del botón llega por `seleccionId` de «Normalizar entrada» (un button_reply conserva su id).
const CF_ID_CONFIRMAR = 'pedido:confirmar';
const CF_TITULO_CONFIRMAR = 'Confirmar pedido';
const CF_MAX_CUERPO = 1024;   // el tope del cuerpo de un mensaje con botones de WhatsApp
// ¿El toque es el del botón «Confirmar pedido»? Solo el id exacto: ni el título escrito a mano ni otro botón.
function cfEsConfirmacion(seleccionId) { return seleccionId === CF_ID_CONFIRMAR; }
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
// El botón, en la forma que espera `cmBotones`.
function cfBoton() { return { id: CF_ID_CONFIRMAR, title: CF_TITULO_CONFIRMAR }; }
