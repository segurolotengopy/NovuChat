// CERRAR TURNO: termina la ejecución en ERROR si Meta rechazó el mensaje al cliente (y su respaldo), DESPUÉS del compromiso compensatorio de «Confirmar envío».
// El envío común no corta el turno (`continueRegularOutput`); sin este `throw` un texto rechazado terminaba en «success» sin que nadie se enterara. El mensaje trae el código y el texto de Meta,
// sin el teléfono. Un aviso a recepción rechazado NO llega aquí con error: al cliente sí se le respondió.
const c = cnPrimero('Confirmar envío') || {};
if (!c.error) return [];
const comp = cnNodo('Comprometer compensación') ? cnResultadoDeCompromiso(cnPrimero('Comprometer compensación')) : null;
throw new Error(c.error + (comp ? (comp.resultado === 'ok' ? ' [estado restaurado]' : ' [el estado NO se pudo restaurar: ' + comp.resultado + ']') : ''));
