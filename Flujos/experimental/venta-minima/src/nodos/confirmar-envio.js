// CONFIRMAR ENVÍO (PR-4a): lo único que se da por hecho es lo que Meta ACEPTÓ. Si el mensaje al cliente no salió (ni por el envío ni por su respaldo en texto), ARMA el compromiso
// compensatorio del estado; `Comprometer compensación` lo manda y `Resumen del turno` corta la ejecución en ERROR. No envía, no reporta y no escribe en ningún lado.
//
// CORRE AL FINAL: es el hijo más bajo de «Soltar mensajes» (`executionOrder: v1`), debajo de los envíos y del cierre, y lee lo que contestaron. devuelve un ítem SOLO si hay que compensar
// (así «Comprometer compensación» corre solo entonces; «Resumen del turno», que en la variante de prueba responde con el resumen, cuelga directo de «Soltar mensajes»).
//
// QUÉ SE RESTAURA (la regla de siempre, ahora con el bloque entero y con la versión recién comprometida):
//   - SIN hecho externo (ningún aviso salió y no corrió `Registrar cierre`): el bloque de ANTES del turno (`previo`: estado con su `ultimoMensajeMs`, o sea el ancla de las claves
//     estables, y SUS pedidos; null si no había nada). El cliente no recibió el paso nuevo (un QR, una pregunta): al reconfirmar, `pedidoId`, código y cierre salen IGUALES y nunca hay un
//     segundo pedido. Los pedidos también vuelven (antes quedaban guardados: límite I-3 del diseño anterior);
//   - CON hecho externo (el restaurante ya recibió el aviso o el cierre quedó registrado): el bloque comprometido queda, con el paso `menu` (un botón viejo solo muestra el menú), salvo que el
//     paso sea `esperando_comprobante`: reconfirmar armaría un segundo pedido con otro código, otro aviso y otro cierre.
// Si nada cambia (no hubo compromiso en este turno), no hay nada que compensar.
const rtId = (j) => {
  const m = j && j.messages;
  return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
};
// Sin compensación no se devuelve ningún ítem: «Comprometer compensación» no corre y «Resumen del turno» (hijo directo de «Soltar mensajes», debajo de todo) cierra el turno.
const sale = (extra) => (extra && extra.compensar === true ? [{ json: Object.assign({ compensar: true, compromiso: null, numero: '' }, extra) }] : []);
const items = vmTodos('Soltar mensajes');
const enviables = items.filter((i) => i && i.sinMensajes !== true);
if (!enviables.length || !vmNodo('Enviar a WhatsApp')) return sale();
const entregados = vmTodos('Enviar a WhatsApp').filter(rtId).length + vmTodos('Enviar respaldo').filter(rtId).length;
if (entregados >= enviables.length) return sale();
const primero = items[0] || {};
if (primero.comprometido !== true) return sale();
const hecho = vmNodo('Registrar cierre') !== null || vmTodos('Enviar aviso').concat(vmTodos('Aviso de respaldo')).some(rtId);
const from = String(primero.from || (enviables[0] && enviables[0].from) || '');
let bloque;
if (!hecho) {
  bloque = primero.previo && typeof primero.previo === 'object' && !Array.isArray(primero.previo) ? JSON.parse(JSON.stringify(primero.previo)) : null;
} else {
  const d = vmPrimero('Decidir turno');
  bloque = primero.bloque && typeof primero.bloque === 'object' ? JSON.parse(JSON.stringify(primero.bloque)) : null;
  // Solo si `Decidir turno` corrió (hubo una conversación que dejó un paso nuevo) y el paso no es `esperando_comprobante`: la derivación con un QR en espera conserva ese paso A PROPÓSITO.
  if (!d || !bloque || !bloque.estado || typeof bloque.estado !== 'object' || bloque.estado.paso === 'esperando_comprobante') return sale();
  bloque.estado.paso = 'menu';
}
const compromiso = ssCuerpoComprometer(from, $execution.id, 'comp', Number(primero.versionComprometida) || 0, bloque);
if (compromiso === null) return sale({ numero: primero.numero || ssNumeroHeader() });
compromiso.sesion.venceEnMin = vmVenceEnMin(bloque);
return sale({ compensar: true, compromiso: compromiso, numero: primero.numero || ssNumeroHeader() });
