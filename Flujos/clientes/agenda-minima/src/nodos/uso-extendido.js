// USO EXTENDIDO: el paciente paso el umbral de operador o el de bloqueo
// (Analisis/27 §5). Lo decide el servidor; este nodo obedece. Mismos textos que Bellido.
//
//   operador  -> se responde el aviso fijo (cuenta como cualquier respuesta), y la
//                PRIMERA vez que se entra en este estado se avisa a recepcion.
//   bloqueado -> no se responde nada; la primera vez se avisa a recepcion.
//
// NO SE LLAMA AL MODELO: este nodo cuelga de la rama falsa de «¿Atención normal?».
// La atencion sale de lo que devolvio la ingesta del entrante si lo trae, y si no, de
// `configuracionFlujo`: `cnAtencion`.
const FIJO = 'Gracias por su paciencia. Para atenderle mejor, una persona del equipo va a continuar esta conversación en breve.';
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const previo = cnPrimero('Reportar mensaje (entrante)');
const a = cnAtencion(previo, cfg);
const estado = a.estado === 'bloqueado' ? 'bloqueado' : 'operador';
const aviso = a.avisar === 'operador' || a.avisar === 'bloqueado';
// «hasta mañana» si no se sabe cuando vence; «hasta el <fecha>» si se sabe.
function hasta(iso) {
  if (!iso) return 'mañana';
  const ms = msDe(iso);
  if (Number.isNaN(ms)) return 'mañana';
  return 'el ' + textoDeFecha(isoLocal(fechaLocal(ms), horaLocal(ms)));
}
return [{ json: {
  accion: 'uso_extendido',
  from: t.from,
  responder: estado === 'operador',
  texto: estado === 'operador' ? (a.mensajeFijo || FIJO) : '',
  transferir: aviso,
  motivo: estado === 'operador'
    ? 'uso extendido: ' + a.respuestas + ' respuestas del asistente en su ventana de 24 horas. El asistente dejó de responder con IA y le avisó que lo atiende una persona'
    : 'llegó a ' + a.respuestas + ' respuestas del asistente en su ventana de 24 horas. El asistente no le responde más hasta ' + hasta(a.venceEn) + '; si hace falta, escríbale directamente',
  estadoNuevo: null,
} }];
