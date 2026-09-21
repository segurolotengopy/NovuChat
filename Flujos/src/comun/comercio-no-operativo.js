// El comercio no esta operativo (suspendido o dado de baja).
// PROHIBIDO revelar el motivo: el cliente final no tiene por que enterarse de
// que el negocio debe dinero. El texto es neutro y sale de Config del negocio.
// Se corta ANTES del agente, asi que un comercio suspendido no consume ni
// tokens ni llamadas al calendario.
const cfg = $('Config del negocio').first().json;
const aviso = String(cfg.mensajeComercioSuspendido ?? '').trim()
  || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';

return $input.all().map(i => ({ json: {
  respuesta: aviso,
  transferir: false,
  comercioSuspendido: true,
  estadoComercio: cfg.estadoComercio,
  from: i.json.from,
  nombrePerfil: i.json.nombrePerfil,
}}));
