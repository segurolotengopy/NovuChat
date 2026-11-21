// USO EXTENDIDO: el cliente paso el umbral de operador o el de bloqueo (Analisis/27 §5). Lo decide
// el servidor; este nodo obedece. Cuelga de la rama falsa de «¿Atención normal?»: NO llama a ningun
// modelo y sale directo a `Armar avisos`.
//
//   operador  -> se responde el aviso fijo del panel (cuenta como cualquier respuesta) con el boton
//                para escribirle al local, y la PRIMERA vez que se entra en este estado se avisa
//                al restaurante;
//   bloqueado -> no se responde nada; la primera vez se avisa al restaurante.
//
// La atencion sale de lo que devolvio la ingesta del entrante si lo trae, y si no, de
// `configuracionFlujo`: `vmAtencion`. El texto sale del panel (`cfg.atencionMensajeFijo` ya trae el de
// respaldo en tuteo), no del codigo.
//
// SALIDA: un Plan (§4.3) con `estadoNuevo: null` (no toca el estado) y, cuando corresponde, un aviso
// de tipo `transferencia` con `datos: {motivo, codigo, from, nombre, ahoraMs}`. El mensaje con boton
// es `{tipo:'enlace', cuerpo, botones:[], url, etiqueta}`.
const cfg = vmCfg();
const t = vmPrimero('Interpretar entrada') || {};
const previo = vmPrimero('Reportar mensaje (entrante)');
const a = vmAtencion(previo, cfg);
const estado = a.estado === 'bloqueado' ? 'bloqueado' : 'operador';
const avisar = a.avisar === 'operador' || a.avisar === 'bloqueado';
const ahoraMs = Number(t.ahoraMs) || Date.now();
const recepcion = vmDigitos(cfg.numeroRecepcion);

// «mañana» si no se sabe cuando vence; «el <fecha y hora>» si se sabe.
function hastaCuando(iso) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return 'mañana';
  return 'el ' + vmFechaLegible(vmFechaLocal(ms), vmHoraLocal(ms));
}

const mensajes = [];
if (estado === 'operador') {
  const cuerpo = a.mensajeFijo || 'Gracias por tu paciencia. Una persona del equipo va a continuar esta conversación.';
  mensajes.push(recepcion
    ? { tipo: 'enlace', cuerpo: cuerpo, botones: [], url: 'https://wa.me/' + recepcion, etiqueta: 'Escribir al local' }
    : { tipo: 'texto', cuerpo: cuerpo, botones: [] });
}
const motivo = estado === 'operador'
  ? 'uso extendido: ' + a.respuestas + ' respuestas del asistente en su ventana de 24 horas; el asistente dejó de responder y le indicó que lo atiende una persona'
  : 'llegó a ' + a.respuestas + ' respuestas del asistente en su ventana de 24 horas; el asistente no le responde más hasta ' + hastaCuando(a.venceEn);

return [{ json: {
  estadoNuevo: null,
  mensajes: mensajes,
  condicionados: null,
  aviso: avisar
    ? { tipo: 'transferencia', datos: { motivo: motivo, codigo: vmCodigoCorto(ahoraMs), from: t.from, nombre: t.nombrePerfil || '', ahoraMs: ahoraMs } }
    : null,
  pedido: null,
  cierre: null,
  ruta: 'uso_extendido',
  errores: [],
} }];
