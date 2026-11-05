// SOLTAR MENSAJES: decide qué sale, con lo que contestó el servidor al compromiso del turno (PR-4c2). Un ÍTEM POR MENSAJE: de aquí cuelgan el envío común, la hoja, «Confirmar envío» y «Resumen del turno».
//
// «Armar mensajes» (o «Replanificar mensajes», tras un primer conflicto de versión) armó TODO en un solo ítem y pidió comprometer la ficha ANTES de enviar. Aquí:
//   - comprometido (o turno sin estado que comprometer): salen los mensajes armados, el prospecto de la hoja y la marca del contacto nuevo;
//   - el compromiso falló, o hubo un segundo conflicto (§6 del contrato): sale SOLO el genérico con el botón a recepción, sin avisos, sin hoja y sin compromiso. Reemplaza la respuesta (0 mensajes más).
// La marca de contacto nuevo (`chatNovuchatCrm`, última hora por teléfono, aparte de la ficha) se escribe SOLO si el turno quedó comprometido.
const rep = cnNodo('Replanificar mensajes') ? cnPrimero('Replanificar mensajes') : null;
const a = rep || cnPrimero('Armar mensajes');
if (!a) return [];
const reciente = cnNodo('Comprometer turno (2.º intento)') ? 'Comprometer turno (2.º intento)' : 'Comprometer turno';
const r = a.comprometer === true ? ssResultadoDeCompromiso(cnPrimero(reciente)) : { resultado: 'ok', version: 0, ganador: null };
const comprometido = a.comprometer === true && r.resultado === 'ok';
// Segundo conflicto: si otra ejecución ya respondió estos eventos o hay uno más nuevo (misma condición que «Replanificar mensajes»), esta termina SIN enviar.
if (r.resultado === 'conflicto' && rep && Array.isArray(a.seqs) && chOtraEjecucionResponde(chFichaVigente(r.ganador, Number(a.ahoraMs) || Date.now()), a.seqs)) return [];
// Las puertas cerradas (suspendido, uso extendido, bloqueado) comprometen solo para guardar los ids: si el compromiso falla sale igual lo suyo (bloqueado: nada), nunca el genérico.
// (también sin pedido de compromiso —`from` fuera de `telefonosDePrueba`, teléfono que el servidor no admite, estado que no cabe—: la puerta cerrada NO cae al genérico)
const mejor = a.mejorEsfuerzo === true && (a.comprometer !== true || r.resultado !== 'ok');
const bien = (a.fallaEstado !== true && r.resultado === 'ok') || mejor;
const salida = bien ? a.salida : a.salidaFalla;
const resumen = Object.assign({}, a.resumen, { estado: { comprometido: comprometido, version: comprometido ? r.version : null, resultado: a.comprometer === true ? r.resultado : (a.fallaEstado === true ? 'sin_estado' : 'sin_compromiso') } });
if (mejor) resumen.estado.resultado = 'mejor_esfuerzo_' + (a.comprometer === true ? r.resultado : 'sin_compromiso');
if (!bien) Object.assign(resumen, { plan: 'falla_estado', mensajes: Array.isArray(salida) ? salida.length : 0, rubro: a.nueva ? a.nueva.rubro : '' });

const ahora = Number(a.ahoraMs) || Date.now();
let prospectoSalida = null;
if (bien && !mejor && a.guardarPlanilla === true && a.despues) {
  const crm = (() => {
    let sd = null;
    try { sd = $getWorkflowStaticData('global'); } catch (e) { sd = null; }
    if (!sd) return null;
    return sd.chatNovuchatCrm && typeof sd.chatNovuchatCrm === 'object' && !Array.isArray(sd.chatNovuchatCrm) ? sd.chatNovuchatCrm : (sd.chatNovuchatCrm = {});
  })();
  const nuevoContacto = a.primeraVez === true && !(crm && Number.isFinite(crm[a.from]) && ahora - crm[a.from] < CH_OLVIDO_MS);
  prospectoSalida = Object.assign({}, a.despues, { nuevoContacto: nuevoContacto });
}
// La marca de «último mensaje» se escribe aunque no se guarde la planilla, como siempre (una conversación en curso no es un contacto nuevo).
if (bien && !mejor && a.conversacion === true && cnClaveValida(a.from)) {
  let sd = null;
  try { sd = $getWorkflowStaticData('global'); } catch (e) { sd = null; }
  if (sd) {
    const crm = sd.chatNovuchatCrm && typeof sd.chatNovuchatCrm === 'object' && !Array.isArray(sd.chatNovuchatCrm) ? sd.chatNovuchatCrm : (sd.chatNovuchatCrm = {});
    crm[a.from] = ahora;
    for (const k of Object.keys(crm)) if (!Number.isFinite(crm[k]) || ahora - crm[k] >= CH_OLVIDO_MS) delete crm[k];
  }
}
if (!Array.isArray(salida) || !salida.length) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: a.from, plan: resumen.plan, resumen: resumen, fichaAntes: a.fichaAntes, comprometido: comprometido,
    estadoComprometido: comprometido ? a.nueva : null, versionComprometida: comprometido ? r.version : 0, numero: a.numero, guardarPlanilla: false, prospectoPlanilla: null } }];
}
const items = salida.map((x) => ({ json: Object.assign({}, x) }));
Object.assign(items[0].json, { resumen: resumen, fichaAntes: bien ? a.fichaAntes : null, comprometido: comprometido, estadoComprometido: comprometido ? a.nueva : null, versionComprometida: comprometido ? r.version : 0,
  numero: a.numero, guardarPlanilla: !!prospectoSalida, prospectoPlanilla: prospectoSalida });
return items;
