// USO EXTENDIDO: el cliente paso el umbral de operador o el de bloqueo
// (`Analisis/27` §5). El estado lo decide el panel; ver `Config del negocio`.
//
// NO SE LLAMA AL MODELO en ninguno de los dos casos: este nodo cuelga de la
// rama falsa de `¿Atención normal?`, antes del agente. Es lo que pone techo al
// costo de una ventana: pasado el umbral de operador cada consulta cuesta un
// mensaje fijo, y pasado el de bloqueo no cuesta nada.
//
//   operador  -> se responde el aviso fijo, y se reporta como saliente: cuenta
//                y se factura como cualquier respuesta. La PRIMERA vez que se
//                entra en este estado se avisa a recepcion.
//   bloqueado -> no se responde nada. La primera vez se avisa a recepcion.
//
// `transferir` y `motivoTransferencia` son los campos que ya leen
// `¿Transferir a humano?` y `Avisar a recepción`: se reutilizan esos nodos en
// vez de crear otro envio, porque un nodo de WhatsApp nuevo no recibiria la
// credencial al publicar (publicar-flujo.sh la injerta por NOMBRE de nodo).
//
// «EN SU VENTANA DE 24 HORAS» y no «hoy»: la ventana arranca con el primer
// mensaje del cliente y no coincide con el dia calendario.
const FIJO = 'Gracias por su paciencia. Para atenderle mejor, una persona del equipo va a continuar esta conversación en breve.';

// «hasta mañana» si no se sabe cuando vence; «hasta el <dia y hora>» si se sabe.
const hasta = (iso) => {
  if (!iso) return 'mañana';
  try {
    return 'el ' + new Date(iso).toLocaleString('es-BO', {
      timeZone: 'America/La_Paz', weekday: 'long', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return 'el ' + iso;
  }
};

return $input.all().map((i) => {
  const j = i.json;
  const estado = j.atencionEstado === 'bloqueado' ? 'bloqueado' : 'operador';
  const aviso = j.atencionAvisarRecepcion === 'operador' || j.atencionAvisarRecepcion === 'bloqueado';
  const n = Number(j.atencionRespuestas) || 0;
  return { json: {
    from: j.from,
    nombrePerfil: j.nombrePerfil,
    atencionEstado: estado,
    responder: estado === 'operador',
    respuesta: estado === 'operador' ? (String(j.atencionMensajeFijo ?? '').trim() || FIJO) : '',
    transferir: aviso,
    motivoTransferencia: estado === 'operador'
      ? `uso extendido: ${n} respuestas del asistente en su ventana de 24 horas. El asistente dejó de responder con IA y le avisó que lo atiende una persona`
      : `llegó a ${n} respuestas del asistente en su ventana de 24 horas. El asistente no le responde más hasta ${hasta(j.atencionVenceEn)}; si hace falta, escríbale directamente`,
  } };
});
