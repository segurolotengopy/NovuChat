// CIERRA LA VENTANA DE 24 H DEL AVISO AL DUENO, SOLO SI EL AVISO SALIO.
//
// Cuelga de `Avisar al dueño`. Marca el telefono del cliente en
// `$getWorkflowStaticData` unicamente si Meta devolvio un id de mensaje: un
// aviso rechazado no cierra la ventana y el proximo intento vuelve a avisar.
//
// SOLO ACTUA SI CORRIO `Aviso de transferencia`. `Avisar al dueño` tambien lo
// alimentan el pedido confirmado y otros avisos; en el turno con pedido y
// transferencia, el aviso del pedido llega PRIMERO (esta mas arriba en el
// lienzo, `executionOrder: v1`) y en ese momento `Aviso de transferencia`
// todavia no corrio, asi que no marca. El que llega despues es el de la
// transferencia, y ese si.
//
// NO ENVIA NADA: cuesta CERO mensajes de WhatsApp.
const corrio = (() => { try { return $('Aviso de transferencia').isExecuted === true; } catch (e) { return false; } })();
let previos = [];
try { previos = $('Aviso de transferencia').all(); } catch (e) { previos = []; }

const salidas = $input.all();
if (corrio && previos.length > 0) {
  const sd = $getWorkflowStaticData('global');
  sd.avisosTransferencia = sd.avisosTransferencia ?? {};
  salidas.forEach((s, i) => {
    const id = String((((s.json ?? {}).messages ?? [])[0] ?? {}).id ?? '');
    const origen = (previos[i] ?? previos[previos.length - 1]).json ?? {};
    if (id !== '' && origen.from) sd.avisosTransferencia[origen.from] = Date.now();
  });
}
return salidas.map((s, idx) => ({ json: s.json, pairedItem: { item: idx } }));
