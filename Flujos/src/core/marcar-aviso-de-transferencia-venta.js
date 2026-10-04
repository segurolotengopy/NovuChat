// CIERRA LA VENTANA DE 24 H DEL AVISO AL DUENO, SOLO SI EL AVISO SALIO.
//
// Cuelga de `Avisar al dueño (transferencia)`, que es el envio exclusivo del
// aviso por una TRANSFERENCIA (antes compartia envio con el pedido, el cobro y
// el uso extendido, y este nodo tenia que adivinar de quien era cada salida).
// Marca el telefono del cliente en `$getWorkflowStaticData` unicamente si Meta
// devolvio un id de mensaje: un aviso rechazado no cierra la ventana y el
// proximo intento vuelve a avisar. Esa marca es lo que autoriza a
// `Procesar respuesta` a decir «ya le avisé» en un turno posterior.
//
// LIMITE: el id de Meta prueba que Meta ACEPTO el mensaje, no que el dueño lo recibio
// (la entrega real llega despues por un acuse asincrono y fuera de la ventana de 24 h
// de servicio un texto libre puede no llegar). La solucion de fondo (una plantilla
// aprobada para el aviso) la decide Andres; por eso el campo se llama `avisoAceptado`.
//
// NO ENVIA NADA: cuesta CERO mensajes de WhatsApp.
let previos = [];
try { previos = $('Aviso de transferencia').all(); } catch (e) { previos = []; }

const salidas = $input.all();
const sd = $getWorkflowStaticData('global');
sd.avisosTransferencia = sd.avisosTransferencia ?? {};
const resultado = salidas.map((s, i) => {
  const origen = (previos[i] ?? previos[previos.length - 1] ?? { json: {} }).json ?? {};
  const salio = String((((s.json ?? {}).messages ?? [])[0] ?? {}).id ?? '') !== '';
  if (salio && origen.from) sd.avisosTransferencia[origen.from] = Date.now();
  // `json.error` es TEXTO en n8n 2.36.5 («(#131047) …»): el codigo se saca del texto, igual que en
  // `Verificar aviso al dueño`. El item conserva el `error` de n8n, que queda en los datos de la ejecucion.
  const e = (s.json ?? {}).error;
  const textoError = (e && typeof e === 'object') ? String(e.message ?? '') : String(e ?? '');
  const avisoError = salio ? undefined : { code: Number((/\(#(\d+)\)/.exec(textoError) ?? [])[1]) || null };
  return { json: { ...(s.json ?? {}), avisoAceptado: salio, ...(avisoError ? { avisoError } : {}) }, pairedItem: { item: i } };
});
return resultado;
