// COMERCIO NO OPERATIVO (suspendido o dado de baja). PROHIBIDO revelar el motivo: el prospecto no tiene por que enterarse de
// que el negocio debe dinero. El texto es neutro y sale de `Config del negocio` (el del panel, o el de respaldo). Se corta ANTES
// de cualquier llamada al modelo, a la planilla o a recepcion. Sin modelo: nada que validar.
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const aviso = String(cfg.mensajeComercioSuspendido || '').trim()
  || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';
return [{ json: {
  accion: 'suspendido',
  texto: aviso,
  responder: true,
  transferir: false,
  from: t.from,
} }];
