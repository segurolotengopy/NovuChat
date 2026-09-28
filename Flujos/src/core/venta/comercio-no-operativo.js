// El comercio no esta operativo (suspendido o dado de baja).
//
// FALTABA POR COMPLETO EN ESTE FLUJO, y se descubrio el 2026-09-07 revisando el
// defecto del 409: el Demo B no tenia NINGUNA compuerta de estado, asi que
// atendia siempre, cobrara o no el negocio. El Demo A la tenia desde el
// principio; la leccion no habia cruzado, que es el mismo patron ya anotado.
//
// PROHIBIDO REVELAR EL MOTIVO: el cliente final no tiene por que enterarse de
// que el negocio debe dinero. El texto es neutro y sale de la configuracion.
//
// Se corta ANTES del agente, asi que un comercio suspendido no consume ni
// tokens ni llamadas a ninguna herramienta.
const cfg = $('Config del negocio').first().json;
const aviso = String(cfg.mensajeComercioSuspendido ?? '').trim()
  || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';

return $input.all().map((i) => ({ json: {
  respuesta: aviso,
  comercioSuspendido: true,
  estadoComercio: cfg.estadoComercio,
  from: i.json.from,
  nombrePerfil: i.json.nombrePerfil,
  phoneNumberId: i.json.phoneNumberId,
} }));
