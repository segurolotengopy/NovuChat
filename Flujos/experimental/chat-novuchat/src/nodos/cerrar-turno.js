// CERRAR TURNO: termina la ejecución en ERROR si Meta rechazó el mensaje al cliente (y su respaldo en texto), DESPUÉS del compromiso compensatorio de «Confirmar envío».
// El envío común no corta el turno (`continueRegularOutput`); sin este `throw` un texto rechazado terminaba en «success» sin que nadie se enterara. El mensaje trae el código y el texto de Meta
// (los arma «Confirmar envío», sin el teléfono). Un aviso a recepción rechazado NO corta: al cliente sí se le respondió.
// Este nodo mira POR SU CUENTA lo que Meta contestó (el id de cada envío al cliente y el de su respaldo): el corte no depende de que otro nodo haya decidido bien.
const idDe = (r) => {
  const id = r && Array.isArray(r.messages) && r.messages[0] ? r.messages[0].id : undefined;
  return typeof id === 'string' ? id.trim() : '';
};
const acepto = (r) => !!r && !r.error && idDe(r) !== '';
const enviables = cnTodos('Soltar mensajes').filter((i) => i && i.sinMensajes !== true);
if (!enviables.length || !cnNodo('Enviar a WhatsApp')) return [];
const envios = cnTodos('Enviar a WhatsApp');
const respaldos = cnTodos('Enviar respaldo');
let usados = 0;
let sinAceptar = false;
enviables.forEach((it, k) => {
  const porRespaldo = !acepto(envios[k]);
  const final = porRespaldo ? respaldos[usados++] : envios[k];
  if (it.destino !== 'recepcion' && !acepto(final)) sinAceptar = true;
});
if (!sinAceptar) return [];
const c = cnPrimero('Confirmar envío') || {};
const comp = cnNodo('Comprometer compensación') ? cnResultadoDeCompromiso(cnPrimero('Comprometer compensación')) : null;
throw new Error((c.error || 'Meta rechazó el mensaje al cliente') + (comp ? (comp.resultado === 'ok' ? ' [estado restaurado]' : ' [el estado NO se pudo restaurar: ' + comp.resultado + ']') : ''));
