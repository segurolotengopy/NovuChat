// COMERCIO NO OPERATIVO (suspendido o dado de baja). PROHIBIDO revelar el motivo: el cliente no tiene
// por que enterarse de que el negocio debe dinero. El texto es neutro y sale de `Config del negocio`
// (el del panel, o el de respaldo). Se corta ANTES de cualquier llamada al modelo.
//
// SALIDA: un Plan (§4.3) que contesta ese texto y nada mas: sin boton, sin aviso, sin cambio de estado.
const cfg = vmCfg();
const texto = String(cfg.mensajeComercioSuspendido || '').trim()
  || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';
return [{ json: {
  estadoNuevo: null,
  mensajes: [{ tipo: 'texto', cuerpo: texto, botones: [] }],
  condicionados: null,
  aviso: null,
  pedido: null,
  cierre: null,
  ruta: 'suspendido',
  errores: [],
} }];
