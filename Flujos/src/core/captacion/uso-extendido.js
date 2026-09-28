// USO EXTENDIDO: el servidor dice que este telefono paso el umbral de
// operador o el de bloqueo (`Analisis/27` §5, `atencion.ts`). Es el mismo
// mecanismo que obedecen los flujos A y B, con los umbrales de la cuenta del
// tenant (`cuenta/estado`: 50 y 100 por defecto). Cubre lo que la
// especificacion de Silvana llamaba «tope duro».
//
// NO SE LLAMA AL MODELO en ninguno de los dos casos: este nodo cuelga antes
// del agente.
//
//   operador  -> un mensaje fijo: una persona sigue la conversacion. Cuenta y
//                se factura como cualquier respuesta.
//   bloqueado -> no se responde nada al cliente.
//   En los dos, la PRIMERA vez que se entra al estado (el servidor lo marca en
//   `atencionAvisarRecepcion`) se avisa a una persona con la plantilla.
//
// El texto va con TUTEO, que es la voz de NovuChat. El del servidor
// (`MENSAJE_USO_EXTENDIDO`) es neutro y de usted, para los comercios.
const FIJO = 'Gracias por tu paciencia. Para atenderte mejor, una persona del equipo de ' +
  'NovuChat va a seguir esta conversación en breve, por este mismo WhatsApp.';

return $input.all().map((it, i) => {
  const e = it.json;
  const bloqueado = e.atencionEstado === 'bloqueado';
  const avisar = e.atencionAvisarRecepcion === 'operador' || e.atencionAvisarRecepcion === 'bloqueado';
  return { json: { ...e,
    responder: !bloqueado,
    respuesta: bloqueado ? '' : FIJO,
    avisar,
    estadoAviso: bloqueado ? 'llegó al límite de respuestas del día' : 'pasó a atención de una persona',
    estadoLead: bloqueado ? 'bloqueado' : 'operador',
    guardarLead: avisar,
  }, pairedItem: { item: i } };
});
