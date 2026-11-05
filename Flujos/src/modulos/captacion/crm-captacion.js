// ADAPTADOR DE CAPTACION PARA EL MODULO miniCRM: lo que SOLO sabe la captacion de NovuChat -- como se califica un prospecto (I), como se resume lo que hizo (J)
// y la prioridad de las calificaciones--. El modulo `crm` (Flujos/src/modulos/crm/crm.js) no lo importa: `nodo-decidir-fila.js` se lo pasa como argumento.
// Es la version de chat-novuchat (con «otros negocios» y la linea `seguro` estricta vive en crm.js). Corre en un nodo Code de n8n: JavaScript puro, sin require.
// MENSAJES: ninguno.
const capLimpio = (v) => String(v ?? '').replace(/[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

// I «Calificación IA», POR CODIGO Y POR HECHOS (Bloque 1, 03/10/2026). Lo que el
// prospecto HIZO, no lo que el modelo dijo: los hechos los deja `Procesar respuesta` y llegan saneados por `Salida` en `prospectoPlanilla.hechos`.
// Tabla de reglas, de arriba hacia abajo: la primera que se cumple gana. Para
// ajustarla se edita solo esta tabla.
//   Alta          pidio una persona (boton, fila o escrito) o pidio los planes
//   Descalificado el modelo propuso un motivo de la lista y el codigo lo acepto
//                 (un hecho de Alta posterior gana: va primero)
//   Media         eligio su rubro (o «Otro») e INTERACTUO despues de la explicacion (§16, documento comercial del 07/10/2026): escribio o dijo algo
//                 sustantivo —una pregunta de fondo, un comentario sobre su negocio, su necesidad—, no un saludo ni un acuse; en «Otro», respondio el cierre
//                 investigativo. El hecho se sigue llamando `respondioDolor` (nombre historico: ya no hay pregunta de dolor en los rubros estandar).
//   Baja          el resto: eligio rubro y no continuo
const CAP_CALIFICACION = [
  { valor: 'Alta', si: (p) => p.pidioAsesor === true || p.pidioPlanes === true },
  { valor: 'Descalificado', si: (p) => Object.hasOwn(CAP_MOTIVOS_DESCARTE, p.descarte) },
  { valor: 'Media', si: (p) => (!!p.rubro || p.eligioOtro === true) && p.respondioDolor === true },
  { valor: 'Baja', si: () => true },
];
// LA PRIORIDAD de la celda, de menor a mayor: Media no pisa Descalificado,
// Descalificado no pisa Alta, Alta pisa todo. Se escribe solo si la nueva es
// mayor que la de la celda (o igual y distinta no existe). Un valor que no esta
// aca -- lo escribio una persona -- se sobrescribe.
const CAP_PRIORIDAD = ['Baja', 'Media', 'Descalificado', 'Alta'];
// Los motivos de descarte, como los propone el modelo en [DESCARTE] -- la lista
// de `Procesar respuesta` y de `Salida`: una prueba compara las claves -- y la
// etiqueta que se lee en la hoja.
const CAP_MOTIVOS_DESCARTE = {
  numero_equivocado: 'Número equivocado',
  vende_o_busca_trabajo: 'Ofrece algo o busca trabajo',
  sin_negocio: 'No tiene negocio',
  spam_o_prueba: 'Spam o prueba',
};
// J «Resumen Chatbot IA», POR CODIGO (§16): «Rubro X. Necesidad: …. Preguntó por: …. Pidió: planes y hablar con el equipo.», con lo que haya (hasta 400 caracteres). La
// necesidad ya viene saneada de `Armar mensajes` (sin enlaces, formulas ni datos personales) y aca se recorta de nuevo; los temas son de un vocabulario CERRADO (nunca
// un texto del cliente). La celda no empieza nunca con lo que una planilla toma por formula: arranca con «Rubro», «Necesidad» o «Descalificado».
const CAP_TEMAS_PREGUNTADOS = {
  costos: 'costos', consumo: 'consumo de mensajes', integraciones: 'integraciones', pagos: 'pagos y comprobantes', dudas: 'otras dudas',
};
const CAP_RESUMEN_ESTADO = {
  cerrado: 'Pidió hablar con un asesor.',
  en_conversacion: 'En conversación con el asistente.',
  operador: 'Pasó a atención de una persona.',
  bloqueado: 'Llegó al límite de respuestas del día.',
};

function capCalificar(p) {
  return CAP_CALIFICACION.find((r) => r.si(p)).valor;
}
// `calificacionFinal` es la que QUEDA en la columna I: si la celda sigue en «Alta», el
// resumen no dice que se descalifico.
function capResumir(p, conEstado, calificacionFinal) {
  const partes = [];
  if (calificacionFinal === 'Descalificado') partes.push('Descalificado por el asistente: ' + CAP_MOTIVOS_DESCARTE[p.descarte] + '.');
  if (capLimpio(p.rubro)) partes.push('Rubro ' + capLimpio(p.rubro).slice(0, 60) + '.');
  // >>> otros negocios (R5, ajustes del 09/10): diverge a propósito de la copia de Captación mínima; la prueba lo declara.
  // Más de un negocio: C, D y F son los del primero; los otros van aquí, sin pisar nada.
  for (const o of (Array.isArray(p.otrosNegocios) ? p.otrosNegocios : []).slice(0, 3)) {
    const nombre = capLimpio(o && o.empresa).slice(0, 60);
    const rub = capLimpio(o && o.rubro).slice(0, 40);
    if (nombre || rub) partes.push('Otro negocio: ' + (nombre || 'sin nombre') + (rub ? ' (' + rub + ')' : '') + '.');
  }
  // <<< otros negocios
  if (p.flujos) partes.push('Interés: ' + p.flujos + '.');
  const necesidad = capLimpio(p.necesidad).slice(0, 160);
  if (necesidad) partes.push('Necesidad: ' + necesidad.replace(/[.!?…]+$/, '') + '.');
  const temas = (Array.isArray(p.temas) ? p.temas : []).filter((t) => Object.hasOwn(CAP_TEMAS_PREGUNTADOS, t)).map((t) => CAP_TEMAS_PREGUNTADOS[t]);
  if (temas.length) partes.push('Preguntó por: ' + temas.join(', ') + '.');
  const pidio = [p.pidioPlanes === true ? 'planes' : '', p.pidioAsesor === true ? 'hablar con el equipo' : ''].filter(Boolean);
  if (pidio.length) partes.push('Pidió: ' + pidio.join(' y ') + '.');
  else if (p.consulta) partes.push('Consulta: ' + p.consulta + '.');
  // Sin ningun dato del negocio, el resumen no dice nada que valga pisar.
  if (!partes.length && !conEstado) return '';
  // «Pidió hablar con un asesor» ya lo dice la linea «Pidió: …».
  if (CAP_RESUMEN_ESTADO[p.estado] && !(p.estado === 'cerrado' && pidio.length)) partes.push(CAP_RESUMEN_ESTADO[p.estado]);
  return partes.join(' ').slice(0, 400);
}
