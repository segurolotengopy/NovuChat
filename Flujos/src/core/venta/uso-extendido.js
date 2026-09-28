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
//                entra en este estado se avisa al negocio.
//   bloqueado -> no se responde nada. La primera vez se avisa al negocio.
//
// El aviso al negocio sale por `Avisar al dueño`, que ya existe: con
// `textoAviso` manda este texto; sin el, el del pedido confirmado de siempre.
// No se crea otro envio porque un nodo de WhatsApp nuevo no recibiria la
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
  const avisar = j.atencionAvisarRecepcion === 'operador' || j.atencionAvisarRecepcion === 'bloqueado';
  const n = Number(j.atencionRespuestas) || 0;
  const cliente = `${j.nombrePerfil || 'sin nombre de perfil'} (${j.from})`;
  return { json: {
    from: j.from,
    nombrePerfil: j.nombrePerfil,
    phoneNumberId: j.phoneNumberId,
    numeroDueno: j.numeroDueno,
    atencionEstado: estado,
    responder: estado === 'operador',
    respuesta: estado === 'operador' ? (String(j.atencionMensajeFijo ?? '').trim() || FIJO) : '',
    avisar,
    textoAviso: estado === 'operador'
      ? `🔔 NovuChat: el cliente ${cliente} lleva ${n} respuestas del asistente en su ventana de 24 horas. ` +
        'El asistente dejó de responder con IA y le avisó que lo atiende una persona del equipo. ' +
        'Tome la conversación.'
      : `🔔 NovuChat: el cliente ${cliente} llegó a ${n} respuestas del asistente en su ventana de 24 horas. ` +
        `El asistente no le responde más hasta ${hasta(j.atencionVenceEn)}. ` +
        'Si hace falta, escríbale directamente.',
  } };
});
