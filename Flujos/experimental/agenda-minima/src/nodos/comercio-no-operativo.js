// COMERCIO NO OPERATIVO (suspendido o dado de baja). PROHIBIDO revelar el motivo: el
// paciente no tiene por que enterarse de que el negocio debe dinero. El texto es
// neutro y sale de `Config del negocio` (el del panel, o el de respaldo). Se corta
// ANTES de cualquier llamada al modelo o al calendario. Mismos textos que Bellido.
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const aviso = String(cfg.mensajeComercioSuspendido || '').trim()
  || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';
return [{ json: {
  accion: 'suspendido',
  texto: aviso,
  transferir: false,
  from: t.from,
  estadoNuevo: null,
} }];
