// PUERTA DEL TURNO: ¿se sigue con este mensaje? Reúne lo que antes eran «Comercio no operativo» y «Uso extendido» (el servidor decide; este nodo obedece).
//
//   fuera_de_prueba -> `etapaPrueba = si` y el teléfono no está en `telefonosDePrueba`: no se responde, no se avisa, no se llama al modelo. Nunca se le escribe a un cliente. Es lo PRIMERO que se mira.
//   suspendido      -> el comercio está suspendido o dado de baja (la consola o el reporte del entrante lo dicen). PROHIBIDO revelar el motivo. Se corta ANTES de cualquier llamada al modelo o a recepción.
//   uso_extendido   -> el cliente pasó el umbral de operador o el de bloqueo: operador responde el aviso fijo (cuenta como cualquier respuesta); bloqueado no responde nada. NO se llama al modelo.
//   sigue           -> todo lo demás: medios, modelo.
//
// La atención sale de lo que devolvió la ingesta del entrante si lo trae y, si no, de `configuracionFlujo` (`cnAtencion`). Sin modelo; sin ficha.
// Sigue el patrón de las doctoras (COPIA ADAPTADA declarada en PROPIO.md).
const FIJO = 'Gracias por tu paciencia. Para atenderte mejor, una persona del equipo va a continuar esta conversación.';
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
// `fueraDePrueba` lo calcula «Config del negocio» (una sola fuente; también lo lee «¿Reportar? (entrante)»).
if (cfg.fueraDePrueba === true) return [{ json: { ruta: 'fuera_de_prueba', texto: '', responder: false, transferir: false, motivo: '', from: t.from } }];
const previo = cnPrimero('Reportar mensaje (entrante)');
const cortado = !!(previo && previo.servicio && previo.servicio.estado === 'cortado');
if (cfg.estadoComercio !== 'operativo' || cortado) {
  const aviso = String(cfg.mensajeComercioSuspendido || '').trim() || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';
  return [{ json: { ruta: 'suspendido', texto: aviso, responder: true, transferir: false, motivo: '', from: t.from } }];
}
const a = cnAtencion(previo, cfg);
if (a.estado !== 'normal') {
  const operador = a.estado !== 'bloqueado';
  return [{ json: {
    ruta: 'uso_extendido', from: t.from,
    responder: operador,
    texto: operador ? (a.mensajeFijo || FIJO) : '',
    transferir: false,
    motivo: operador
      ? 'uso extendido: ' + a.respuestas + ' respuestas en su ventana de 24 horas; el asistente le avisó que lo atiende una persona'
      : 'llegó a ' + a.respuestas + ' respuestas en su ventana de 24 horas; el asistente no le responde más',
  } }];
}
return [{ json: { ruta: 'sigue', texto: '', responder: false, transferir: false, motivo: '', from: t.from } }];
