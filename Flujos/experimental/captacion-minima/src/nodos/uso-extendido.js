// USO EXTENDIDO: el cliente paso el umbral de operador o el de bloqueo. Lo decide el servidor; este nodo obedece.
//
//   operador  -> se responde el aviso fijo (cuenta como cualquier respuesta), y la PRIMERA vez que se entra en este estado se
//                avisa a recepcion;
//   bloqueado -> no se responde nada; la primera vez se avisa a recepcion.
//
// NO SE LLAMA AL MODELO: este nodo cuelga de la rama falsa de «¿Atención normal?». La atencion sale de lo que devolvio la
// ingesta del entrante si lo trae, y si no, de `configuracionFlujo`: `cnAtencion`.
const FIJO = 'Gracias por tu paciencia. Para atenderte mejor, una persona del equipo va a continuar esta conversación.';
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const previo = cnPrimero('Reportar mensaje (entrante)');
const a = cnAtencion(previo, cfg);
const estado = a.estado === 'bloqueado' ? 'bloqueado' : 'operador';
return [{ json: {
  accion: 'uso_extendido',
  from: t.from,
  responder: estado === 'operador',
  texto: estado === 'operador' ? (a.mensajeFijo || FIJO) : '',
  transferir: a.avisar === 'operador' || a.avisar === 'bloqueado',
  motivo: estado === 'operador'
    ? 'uso extendido: ' + a.respuestas + ' respuestas en su ventana de 24 horas; el asistente le avisó que lo atiende una persona'
    : 'llegó a ' + a.respuestas + ' respuestas en su ventana de 24 horas; el asistente no le responde más',
} }];
