// El comercio no esta operativo (suspendido o dado de baja). Aplica tambien a
// NovuChat: si alguien suspende el tenant `novuchat`, este flujo deja de
// atender, igual que el de cualquier cliente. Se corta ANTES del agente, asi
// que no consume tokens.
//
// PROHIBIDO REVELAR EL MOTIVO: el texto es neutro y sale de la configuracion.
const cfg = $('Config del negocio').first().json;
const aviso = String(cfg.mensajeComercioSuspendido ?? '').trim()
  || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';

return $input.all().map((it, i) => ({ json: { ...it.json,
  respuesta: aviso,
  comercioSuspendido: true,
}, pairedItem: { item: i } }));
