// ARMAR PREVIOS: lo que sale ANTES del texto, y lo que decide qué texto sale. Cuelga de «Decidir turno» (sin modelo) y de «Conversar con el modelo». Sale UN ítem por cada previo, en este orden:
//
//   1. las IMÁGENES de apoyo que el modelo pidió con sus etiquetas (`[ENVIAR_ARTE_COMPARATIVO]`, `[ENVIAR_ARTE_ANTES_DESPUES]`, `[ENVIAR_ARTE_AUTORIDAD]`): el código las quita del texto y envía la imagen ANTES del texto,
//      una sola vez por imagen y por conversación (ficha de 48 h) y hasta 3 por conversación; sin el id de medio resuelto no se envía; el comparativo, además, exige `usarMarcas` Y que el cliente pregunte por la
//      diferencia o cuál le conviene (lo decide el CÓDIGO sobre el mensaje del cliente, nunca el modelo);
//   2. el AVISO a la recepción: la solicitud de valoración (el cliente quiere agendar: `[DERIVAR_RECEPCION]`), una consulta médica, o una consulta que el asistente no pudo responder (el modelo falló). Texto libre
//      dentro de la ventana de 23,5 h de la recepción; fuera, la plantilla UTILITY (4 variables: nombre, interés o motivo, horario preferido, teléfono) SOLO si Meta la tiene APPROVED. A lo más UN aviso por teléfono
//      y por motivo cada 30 minutos, y un tope global por hora.
//
// Si no hay ningún previo sale UN ítem `kind: 'ninguno'`. «Armar mensajes» lee los resultados del envío (`Enviar aviso`) y recién entonces escribe el texto: BARRERA POR HECHO, si la imagen no salió el texto no la
// promete y no habla de «la paciente real». Este nodo NO escribe la ficha ni envía nada. El modo prueba y los números de prueba van al teléfono de prueba, nunca a un cliente ni a la recepción real.
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const t = cnPrimero('Normalizar entrada') || {};
const decision = cnPrimero('Decidir turno') || {};
const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : { tipo: 'nada' };
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const fichas = cnMapaDeFichas(false).mapa;
const ficha = evFichaVigente(cnFichaDe(fichas, from), ahora);
const prueba = cfg.modoPrueba === true;
const destino = prueba ? cnDigitos(cfg.telefonoDePrueba) : from;
const enviar = !prueba || (cfg.enviarDeVerdad === true && destino !== '');
const comun = { from: from, phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', enviar: enviar };

// 1. Qué dijo el modelo y qué tipo de turno es de verdad.
let efectivo = plan.tipo;
let et = { texto: '', artes: [], derivar: false, nombre: '' };
let artesPlan = [];
let avisoDe = null;   // { clave, solicitud }
let rechazo = null;   // por qué se descartó la respuesta del modelo: { motivo, detalle } (lo lee la batería con --motivo)
if (plan.tipo === 'modelo') {
  const respuesta = cnPrimero('Conversar con el modelo');
  const crudo = cnTextoDeGemini(respuesta);
  // Una salida de más de 20 000 caracteres no es una respuesta: se descarta sin recorrerla (costo lineal).
  et = crudo.length > 20000 ? { texto: crudo.slice(0, 50), artes: [], derivar: false, nombre: '' } : evLeerEtiquetas(crudo);
  // Por qué vino vacía (para el diagnóstico): el motivo de corte y el bloqueo que Gemini informa, sin el texto.
  const cand = respuesta && Array.isArray(respuesta.candidates) ? respuesta.candidates[0] : null;
  const porque = (cand && cand.finishReason ? ' finishReason=' + String(cand.finishReason).slice(0, 30) : '') + (respuesta && respuesta.promptFeedback && respuesta.promptFeedback.blockReason ? ' blockReason=' + String(respuesta.promptFeedback.blockReason).slice(0, 30) : '') + (respuesta && respuesta.error ? ' error ' + (respuesta.error && typeof respuesta.error === 'object' ? String(respuesta.error.httpCode || respuesta.error.code || respuesta.error.status || '') + ' ' + String(respuesta.error.message || '').replace(/AIza\S+/g, '[clave]').slice(0, 80) : String(respuesta.error).slice(0, 80)) : '');
  if (crudo.length > 20000) { efectivo = 'fallo'; rechazo = { motivo: 'largo', detalle: 'la salida del modelo supera los 20 000 caracteres' }; }
  else if (crudo.trim() === '' || (et.texto.trim() === '' && !et.derivar)) { efectivo = 'fallo'; rechazo = { motivo: 'modelo_sin_texto', detalle: (crudo.trim() === '' ? 'el modelo no devolvió texto (caído o vacío)' : 'solo etiquetas, sin texto') + porque }; }
  else if (et.derivar) efectivo = 'derivar';
  else {
    // Las imágenes que SÍ pueden salir: lista cerrada, id resuelto, una vez, hasta 3, y el comparativo solo con marcas y si el cliente lo pidió.
    const ids = cfg.artesMedia && typeof cfg.artesMedia === 'object' ? cfg.artesMedia : {};
    for (const k of et.artes) {
      if (EV_ARTES.indexOf(k) < 0 || !evMediaIdValido(ids[k])) continue;
      if (ficha.artes.indexOf(k) >= 0 || artesPlan.indexOf(k) >= 0) continue;
      if (ficha.artes.length + artesPlan.length >= EV_TOPE_ARTES) continue;
      if (k === 'comparativo' && !(cfg.usarMarcas === true && evPideComparativo(plan.textoCliente))) continue;
      artesPlan.push(k);
    }
    // Si el texto no va a pasar la revisión (con las imágenes ya contadas), no se envía ninguna imagen: cae al texto fijo del fallo.
    const rev = evPulirSalida(et.texto, { artesEnviados: artesPlan, textoCliente: plan.textoCliente, nombreNegocio: cfg.nombreNegocio });
    if (rev.motivo === 'salud_sin_remision') { efectivo = 'remision'; artesPlan = []; rechazo = { motivo: rev.motivo, detalle: rev.detalle || '' }; }
    else if (rev.motivo !== '') { efectivo = 'fallo'; artesPlan = []; rechazo = { motivo: rev.motivo, detalle: rev.detalle || '' }; }
  }
}
if (efectivo === 'derivar') { avisoDe = { clave: 'solicitud', solicitud: true }; artesPlan = []; }
else if (efectivo === 'medica') avisoDe = { clave: 'consulta_medica', solicitud: false };
else if (efectivo === 'fallo') avisoDe = { clave: 'no_supo', solicitud: false };

const res = { efectivo: efectivo, textoModelo: et.texto, nombreDerivacion: et.nombre, rechazo: rechazo, artesPlan: artesPlan.slice(), aviso: { planeado: false, repetido: false, clave: avisoDe ? avisoDe.clave : '', motivoFallo: '' } };
const items = [];
if (!enviar && artesPlan.length === 0 && !avisoDe) return [{ json: Object.assign({ kind: 'ninguno', res: res }, comun) }];

// 2. Las imágenes (antes del texto).
if (enviar) {
  for (const k of artesPlan) {
    items.push({ json: Object.assign({ kind: 'arte', arte: k, para: destino, res: res, payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: destino, type: 'image', image: { id: String(cfg.artesMedia[k]) } } }, comun) });
  }
}

// 3. El aviso a la recepción.
let avisoItems = [];
if (avisoDe) {
  const clave = avisoDe.clave;
  const topes = evObjetoGlobal('evTopes', false).mapa;
  const tope = evTopeHora(base.topeAvisosHora, EV_AVISOS_HORA, 120);
  const ultimo = ficha.avisos[clave] || 0;
  if (ultimo > 0 && ahora - ultimo >= 0 && ahora - ultimo < EV_VENTANA_AVISO_MS) res.aviso.repetido = true;
  else if (evHoraN(topes.avisos, ahora) >= tope) res.aviso.motivoFallo = 'tope_avisos';
  else {
    let destinatarios = [];
    if (prueba) { if (cnDigitos(cfg.telefonoDePrueba)) destinatarios = [{ rol: 'completo', tel: cnDigitos(cfg.telefonoDePrueba), nombre: '' }]; }
    else destinatarios = avDestinatarios('completo:' + cnDigitos(cfg.numeroRecepcion), from, cfg.prefijosPermitidos, false);
    if (!destinatarios.length) res.aviso.motivoFallo = 'sin_destinatario';
    else {
      const historia = evHistorialVigente(cnFichaDe(fichas, from), ahora);
      const nombre = avLimpio(avisoDe.solicitud ? (res.nombreDerivacion || evPrimerNombre(t.nombrePerfil)) : evPrimerNombre(t.nombrePerfil), 60) || 'sin nombre';
      const interes = avisoDe.solicitud ? avLimpio(evInteres(historia, plan.textoCliente), 40) : (clave === 'consulta_medica' ? 'consulta médica' : 'consulta sin respuesta');
      const horario = avisoDe.solicitud ? (avLimpio(evHorarioPreferido(historia, plan.textoCliente), 100) || 'sin horario indicado') : 'sin horario';
      const parametros = [nombre, interes, horario, '+' + from];
      const texto = avLimpio(avisoDe.solicitud
        ? 'Aviso del asistente: solicitud de valoración. Nombre: ' + nombre + '. WhatsApp: +' + from + '. Interés: ' + interes + '. Horario preferido: ' + horario + '.'
        : (clave === 'consulta_medica'
          ? 'Aviso del asistente: consulta médica de una persona. WhatsApp: +' + from + '. Respóndele directamente por WhatsApp.'
          : 'Aviso del asistente: una persona hizo una consulta que el asistente no pudo responder. WhatsApp: +' + from + '. Respóndele directamente por WhatsApp.'), 700);
      for (const d of destinatarios) {
        const rec = evFichaVigente(cnFichaDe(fichas, d.tel), ahora);
        const dentro = rec.ultimoMs > 0 && ahora - rec.ultimoMs >= 0 && ahora - rec.ultimoMs < EV_VENTANA_RECEPCION_MS;
        if (dentro) { if (texto) avisoItems.push({ para: d.tel, canal: 'texto', payload: avTexto(d.tel, texto) }); }
        else {
          const pl = evPlantilla(base);
          const payload = pl ? avPlantilla(d.tel, pl.nombre, pl.idioma, parametros) : null;
          if (payload) avisoItems.push({ para: d.tel, canal: 'plantilla', payload: payload });
        }
      }
      if (!avisoItems.length) res.aviso.motivoFallo = 'plantilla_no_configurada';
      else res.aviso.planeado = true;
    }
  }
  // En modo prueba sin envío el aviso no se manda y cuenta como salido (la prueba no gasta mensajes).
  if (enviar) for (const a of avisoItems) items.push({ json: Object.assign({ kind: 'aviso', clave: clave, res: res }, comun, a) });
}

if (!items.length) return [{ json: Object.assign({ kind: 'ninguno', res: res }, comun) }];
return items;
