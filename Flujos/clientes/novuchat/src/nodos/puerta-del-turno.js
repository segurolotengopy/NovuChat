// PUERTA DEL TURNO: ¿se sigue con este mensaje? Reúne lo que antes eran «Comercio no operativo» y «Uso extendido» (el servidor decide; este nodo obedece).
//
//   suspendido    -> el comercio está suspendido o dado de baja (la consola o el reporte del entrante lo dicen). PROHIBIDO revelar el motivo: el prospecto no tiene por qué enterarse de
//                    que el negocio debe dinero. El texto es neutro y sale de «Config del negocio». Se corta ANTES de cualquier llamada al modelo, a la planilla o a recepción.
//   uso_extendido -> el cliente pasó el umbral de operador o el de bloqueo: operador responde el aviso fijo (cuenta como cualquier respuesta) y la PRIMERA vez avisa a recepción;
//                    bloqueado no responde nada. NO se llama al modelo.
//   baja          -> el cliente pidió no recibir más mensajes (`bjPideBaja`, pieza común): UN texto fijo de confirmación y nada más. Sin modelo, sin botones, sin aviso a recepción y sin fila en la planilla.
//                    Va después de la puerta cerrada y del uso extendido. El `no_contactar` ya viajó con el entrante; la ficha no se borra (si vuelve a escribir, se le atiende como siempre).
//   silencio      -> tras el «No» de la campaña saliente (marca `campanaNoMs` de la ficha): 0 mensajes (un «No» repetido, el contacto «bloqueado» sigue por su camino). El «No» mismo es `baja` con `campana: true`.
//   sin_estado    -> el servidor no entregó el estado de la conversación: genérico con el botón a recepción más el aviso a recepción (tope por hora), sin compromiso.
//   sigue         -> todo lo demás: medios, registro del evento, espera de la ráfaga, modelo.
//
// La atención sale de lo que devolvió la ingesta del entrante si lo trae y, si no, de `configuracionFlujo` (`cnAtencion`). Sin modelo; sin ficha.
const FIJO = 'Gracias por tu paciencia. Para atenderte mejor, una persona del equipo va a continuar esta conversación.';
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const previo = cnPrimero('Reportar mensaje (entrante)');
const cortado = !!(previo && previo.servicio && previo.servicio.estado === 'cortado');
if (cfg.estadoComercio !== 'operativo' || cortado) {
  const aviso = String(cfg.mensajeComercioSuspendido || '').trim() || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';
  return [{ json: { ruta: 'suspendido', texto: aviso, responder: true, transferir: false, motivo: '', from: t.from } }];
}
const a = cnAtencion(previo, cfg);
// EL «NO» DE LA CAMPAÑA SALIENTE (M-B1: va ANTES del uso extendido, salvo «bloqueado», que sigue en silencio). `t.campanaSaliente` es el candidato de «Interpretar entrada»; lo CONFIRMA la ingesta (E1, híbrido): con
// `campanaSaliente.resultado` en `baja` o `ya_baja` sale `campanaNo`; si la ingesta no respondió, `campanaNoSinConfirmar` (no promete nada: solo `campanaNo` se respalda con la baja escrita); con `respuesta`, `invalida` o
// `no_aplica` el servidor no lo tomó por un «No» de campaña y el mensaje sigue como cualquier otro. En la variante de PRUEBA la ingesta no se llama: decide el candidato.
const ficha = chFichaVigente(cfg.sesion && cfg.sesion.ok === true ? cfg.sesion.estado : null, t.ahoraMs);
const marca = cnMarcaCampanaNo(ficha, t.ahoraMs);
const candidato = t.campanaSaliente && t.campanaSaliente.respuesta === 'no' ? t.campanaSaliente : null;
const resultadoIngesta = previo && previo.campanaSaliente && typeof previo.campanaSaliente === 'object' && typeof previo.campanaSaliente.resultado === 'string' ? previo.campanaSaliente.resultado : '';
let noDeCampana = '';
if (candidato) {
  if (cfg.modoPrueba === true || resultadoIngesta === 'baja' || resultadoIngesta === 'ya_baja') noDeCampana = 'confirmado';
  else if (resultadoIngesta === '') noDeCampana = 'sinConfirmar';
}
const SILENCIO = { ruta: 'silencio', texto: '', responder: false, transferir: false, motivo: '', from: t.from };
if (a.estado !== 'bloqueado') {
  // Un «No» repetido (otro toque o «no» escrito) con la marca viva: silencio, sin un segundo cierre.
  if (noDeCampana !== '' && marca.activa) return [{ json: SILENCIO }];
  if (noDeCampana !== '') {
    const tx = (cfg.datos || {}).textos || {};
    const textoCampana = String((noDeCampana === 'confirmado' ? tx.campanaNo : tx.campanaNoSinConfirmar) || '').trim(); // (`validarDatos` exige los dos: sin texto de respaldo)
    return [{ json: { ruta: 'baja', campana: true, sinConfirmar: noDeCampana === 'sinConfirmar', texto: textoCampana, responder: true, transferir: false, motivo: '', from: t.from } }];
  }
  // Con la marca viva (E4): hasta las 24 h del «No» callan SOLO las cortesías cortas y un «no» repetido (después de la baja el negocio nunca inicia un mensaje, pero lo que la persona escribe se responde). Un pedido de baja escrito sigue su camino (se confirma). Lo demás es una intención clara
  // y sigue como conversación (la marca se borra al responder, en «Armar mensajes»).
  if (!bjPideBaja(t.texto) && cnSilencioPorCampana(ficha, t.ahoraMs, [t.tipo === 'text' ? t.texto : null])) return [{ json: SILENCIO }];
}
if (a.estado !== 'normal') {
  const operador = a.estado !== 'bloqueado';
  return [{ json: {
    ruta: 'uso_extendido', from: t.from,
    responder: operador,
    texto: operador ? (a.mensajeFijo || FIJO) : '',
    transferir: a.avisar === 'operador' || a.avisar === 'bloqueado',
    motivo: operador
      ? 'uso extendido: ' + a.respuestas + ' respuestas en su ventana de 24 horas; el asistente le avisó que lo atiende una persona'
      : 'llegó a ' + a.respuestas + ' respuestas en su ventana de 24 horas; el asistente no le responde más',
  } }];
}
if (bjPideBaja(t.texto)) return [{ json: { ruta: 'baja', texto: bjTextoBaja(cfg.textoBaja), responder: true, transferir: false, motivo: '', from: t.from } }];
// Sin estado en el servidor (el `leer` falló o no trajo la conversación) no se puede seguir sin arriesgar una ficha falsa: genérico con botón, sin medios, sin modelo y sin compromiso, con el aviso a recepción de la falla (§6).
if (!cfg.sesion || cfg.sesion.ok !== true) return [{ json: { ruta: 'sin_estado', texto: '', responder: false, transferir: false, motivo: '', from: t.from } }];
return [{ json: { ruta: 'sigue', texto: '', responder: false, transferir: false, motivo: '', from: t.from } }];
