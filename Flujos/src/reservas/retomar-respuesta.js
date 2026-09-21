// El nodo de Calendar devuelve el resultado del borrado, no la conversacion.
// Se retoma el item de `Comprobar reserva` para que lo que sigue encuentre
// `respuesta`, `from` y el resto donde los espera.
//
// Y DECIDE SI HAY REINTENTO (2026-09-17, ejecucion #2867 de Clinica Platinum).
// El candado deshizo una cita solapada y el paciente recibio un texto fijo y
// una transferencia, sin ninguna alternativa; la clinica lo reclamo. Desde
// aca, si el borrado salio bien, el flujo le da al modelo UN turno mas
// (`Reintento tras cruce`) para decir que el horario estaba ocupado y ofrecer
// hasta tres alternativas verificadas. Si el borrado FALLO, no: la cita
// fantasma sigue en la agenda y decirle al cliente que «no quedo» seria
// mentirle; ahi va el texto fijo, la transferencia y el aviso, como siempre.
const base = $('Comprobar reserva').first().json;
const borradoFallo = $input.all().some((i) => i.json && i.json.error !== undefined);
const caidas = Array.isArray(base.citasCaidas) ? base.citasCaidas : [];

// Frase para el aviso del sistema al modelo: «las 14:30 del miercoles 17 de
// septiembre con el Dr. X». Sin hora conocida se describe lo que haya.
const describir = (c) => {
  const cuando = [c.hora ? `las ${c.hora}` : '', c.fecha ? `del ${c.fecha}` : ''].filter(Boolean).join(' ');
  const quien = c.persona ? ` con ${c.persona}` : '';
  return (cuando || 'el horario pedido') + quien;
};
// LA NOTA TIENE QUE DECIR LA VERDAD (2026-09-20). Cuando la cita se deshizo
// porque el negocio NO ATIENDE ese dia, decirle al modelo «ya estaba ocupado»
// lo lleva a repetirselo al cliente, y a ofrecer otra hora del mismo dia
// cerrado. La causa la decide `Comprobar reserva`.
const porHorario = caidas.length > 0 && caidas.every((c) => c && c.causa && c.causa !== 'cruce');
const notaCruce = caidas.length
  ? (porHorario
    ? `${caidas.map(describir).join(' y ')} cae fuera del horario de atencion`
    : `el horario de ${caidas.map(describir).join(' y el de ')} ya estaba ocupado`)
  : 'el horario pedido ya estaba ocupado con esa persona';

// El texto original del cliente vuelve a entrar en el turno del reintento:
// `Olvidar turno fallido` borra de la memoria el turno que no se envio, y sin
// esto la conversacion guardada perderia lo que el cliente pidio.
let userInput = '';
try { userInput = String($('Normalizar entrada').first().json.userInput || ''); } catch (e) { userInput = ''; }

const reintentar = !borradoFallo && caidas.length > 0;
const motivo = base.motivoCruce || 'hubo un cruce de horario';
return [{ json: { ...base,
  reintentar,
  notaCruce,
  userInput,
  // Sin reintento, la red de seguridad de siempre: texto fijo y recepcion.
  transferir: !reintentar,
  motivoTransferencia: reintentar ? '' : (borradoFallo
    ? `${motivo}, PERO NO SE PUDO DESHACER la cita nueva: hay dos citas a la misma hora en esa agenda y el cliente recibio el aviso de que no se pudo confirmar`
    : `${motivo} y el cliente quedo esperando otro horario`),
}, pairedItem: { item: 0 } }];
