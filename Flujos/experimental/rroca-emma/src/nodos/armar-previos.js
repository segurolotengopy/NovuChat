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
// Observaciones de Rubén (28/10/2026): el primer turno de la ficha (la bienvenida, la única que nombra los 250 Bs), el aviso de llamada ya salido (respalda «recepción te llama…»), y la pregunta de preferencia.
const historiaDeLaFicha = evHistorialVigente(cnFichaDe(fichas, from), ahora);
const primerTurno = historiaDeLaFicha.length === 0;
const llamadaAvisada = ficha.llamadaMs > 0;
let preguntaNombre = false;
// La respuesta a la pregunta de preferencia o el «sí» a la oferta de llamada: deriva sin modelo, con el nombre que decidió «Decidir turno» (nunca el día que contestó tomado por un nombre).
if (plan.tipo === 'derivar' || plan.tipo === 'preferencia') et.nombre = evPrimerNombre(plan.nombre);
if (plan.tipo === 'modelo') {
  const respuesta = cnPrimero('Conversar con el modelo');
  const crudo = cnTextoDeGemini(respuesta);
  // Una salida de más de 20 000 caracteres no es una respuesta: se descarta sin recorrerla (costo lineal).
  et = crudo.length > 20000 ? { texto: crudo.slice(0, 50), artes: [], derivar: false, nombre: '' } : evLeerEtiquetas(crudo);
  // Por qué vino vacía (para el diagnóstico): el motivo de corte y el bloqueo que Gemini informa, sin el texto.
  const cand = respuesta && Array.isArray(respuesta.candidates) ? respuesta.candidates[0] : null;
  const porque = (cand && cand.finishReason ? ' finishReason=' + String(cand.finishReason).slice(0, 30) : '') + (respuesta && respuesta.promptFeedback && respuesta.promptFeedback.blockReason ? ' blockReason=' + String(respuesta.promptFeedback.blockReason).slice(0, 30) : '') + (respuesta && respuesta.error ? ' error ' + (respuesta.error && typeof respuesta.error === 'object' ? String(respuesta.error.httpCode || respuesta.error.code || respuesta.error.status || '') + ' ' + String(respuesta.error.message || '').replace(/AIza\S+/g, '[clave]').slice(0, 80) : String(respuesta.error).slice(0, 80)) : '');
  // Pedido EXPLÍCITO de agendar («Ok, quiero agendar»): el cierre no depende de que el modelo se acuerde de la etiqueta.
  // EMMA (declarado en PROPIO.md): en el PRIMER contacto «quiero agendar mi valoración» (el texto prellenado del anuncio) no cierra de golpe con el nombre del perfil: primero el saludo, que pide el nombre y qué desea mejorar,
  // como manda el MD. El cierre automático solo aplica si ya hubo conversación o el cliente dio su nombre en ese mensaje («Soy Rosa. Quiero agendar»).
  const puedeCerrar = ficha.historial.length > 0 || evNombreDelMensaje(plan.textoCliente, ficha.historial) !== '';
  // Observaciones de Rubén (28/10/2026): un «sí» a la oferta de agendar del asistente (también a las variantes fijas del código) cuenta como pedido: no depende de que el modelo emita la etiqueta.
  const quiere = (evQuiereAgendar(plan.textoCliente) || evAceptaOferta(plan.textoCliente, ficha.historial)) && puedeCerrar;
  if (quiere && crudo.length <= 20000) et.derivar = true;
  // La etiqueta del modelo se honra solo si el cliente pidió agendar, aceptó una oferta, o el modelo ya capturó su nombre en la etiqueta («[DERIVAR_RECEPCION: Paola]») / el cliente dijo «soy …»; con la etiqueta SOLA y sin texto se conserva (variante corta).
  // PRIMER CONTACTO (sin historial y sin nombre dado en el mensaje): la etiqueta del modelo se IGNORA, sola o con texto. Se conserva el texto (el saludo pide nombre y deseo); si venía sola, sale el fallo conocido, no el cierre.
  if (et.derivar && !puedeCerrar) et.derivar = false;
  if (et.derivar && !quiere && et.texto.trim() !== '') {
    const esNombre = evEsNombre(plan.textoCliente);
    const pidio = evPideAgendar(plan.textoCliente) && !evNegaAgendar(plan.textoCliente) && String(plan.textoCliente || '').indexOf('?') < 0;   // la etiqueta ajena no se honra con «?» ni con una negación («no quiero cita todavía», «¿cuáles son sus horarios?»)
    const acepto = evAceptaOferta(plan.textoCliente, ficha.historial);
    const nombreOk = esNombre && (evNombreTrasAceptar(ficha.historial) || evNombreTrasPedirAgendar(ficha.historial));
    // Aceptó la oferta pero el modelo, en el mismo turno, le pide el nombre: la derivación ESPERA el nombre (el cierre no sale con el nombre del perfil antes de que dé el suyo).
    if (!(pidio || nombreOk || (acepto && !(EV_PIDE_NOMBRE.test(evNorm(et.texto)) && et.nombre === '')))) et.derivar = false;
  }
  // (1) Aceptó la oferta de agendar y el modelo le pide el nombre (con la etiqueta o sin ella): si además falta el día o el horario, el CÓDIGO pregunta las dos cosas en UNA sola pregunta (más abajo);
  // si el día o el horario ya estaban, el modelo pide el nombre como siempre.
  if (!et.derivar && puedeCerrar && crudo.length <= 20000 && !(ficha.cierreMs > 0) && et.nombre === '' && EV_PIDE_NOMBRE.test(evNorm(et.texto)) && evAceptaOferta(plan.textoCliente, ficha.historial)
    && evSinHorario(evHorarioPreferido(historiaDeLaFicha, plan.textoCliente))) { et.derivar = true; et.texto = ''; }
  if (crudo.length > 20000) { efectivo = 'fallo'; rechazo = { motivo: 'largo', detalle: 'la salida del modelo supera los 20 000 caracteres' }; }
  else if ((crudo.trim() === '' && !quiere) || (et.texto.trim() === '' && !et.derivar)) { efectivo = 'fallo'; rechazo = { motivo: 'modelo_sin_texto', detalle: (crudo.trim() === '' ? 'el modelo no devolvió texto (caído o vacío)' : 'solo etiquetas, sin texto') + porque }; }
  else if (et.derivar && !(ficha.cierreMs > 0)) {
    // (1) ANTES del cierre, el día y el horario: si la conversación no los trae, el CÓDIGO los pregunta (con el nombre si falta) y la respuesta cierra (`Decidir turno`). Un pedido de hablar con una persona
    // («quiero chatear con la secretaria») no es un pedido de agendar: cierra directo.
    const soloPersona = EV_QUIERE_PERSONA.test(evNorm(plan.textoCliente)) && !EV_QUIERE_AGENDAR.test(evNorm(plan.textoCliente));
    if (!soloPersona && evSinHorario(evHorarioPreferido(historiaDeLaFicha, plan.textoCliente))) {
      efectivo = 'preferencia';
      preguntaNombre = et.nombre === '' && evNombreDado(historiaDeLaFicha, plan.textoCliente, ficha.nombre) === '';
    } else efectivo = 'derivar';
  }
  // El cierre completo ya salió en esta ficha (48 h): si pide agendar de nuevo (o el modelo solo emitió la etiqueta), sale la variante corta con el botón; si sigue conversando, contesta el modelo sin cierre ni botón.
  else if (et.derivar && ((evPideAgendar(plan.textoCliente) && !(et.texto.trim() !== '' && evNegaAgendar(plan.textoCliente))) || et.texto.trim() === '')) efectivo = 'derivar_corto';
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
    const rev = evPulirSalida(et.texto, { artesEnviados: artesPlan, textoCliente: plan.textoCliente, nombreNegocio: cfg.nombreNegocio, direccion: cfg.direccion, primerTurno: primerTurno, llamadaAvisada: llamadaAvisada });
    if (rev.motivo === 'salud_sin_remision') { efectivo = 'remision'; artesPlan = []; rechazo = { motivo: rev.motivo, detalle: rev.detalle || '' }; }
    else if (rev.motivo !== '') { efectivo = 'fallo'; artesPlan = []; rechazo = { motivo: rev.motivo, detalle: rev.detalle || '' }; }
  }
}
// La pregunta por la gratuidad («¿es gratis?», «¿hay costo escondido o pago de reserva?») que el modelo no logró contestar (o que una barrera rechazó) la contesta un TEXTO FIJO, sin botón ni aviso.
if (efectivo === 'fallo' && plan.tipo === 'modelo' && evPreguntaGratis(plan.textoCliente)) { efectivo = 'gratis'; artesPlan = []; }
if (efectivo === 'derivar' || efectivo === 'derivar_corto') { avisoDe = { clave: 'solicitud', solicitud: true }; artesPlan = []; }
else if (efectivo === 'medica') avisoDe = { clave: 'consulta_medica', solicitud: false };
else if (efectivo === 'fallo') avisoDe = { clave: 'no_supo', solicitud: false };

const res = { efectivo: efectivo, textoModelo: et.texto, nombreDerivacion: et.nombre, rechazo: rechazo, artesPlan: artesPlan.slice(), aviso: { planeado: false, repetido: false, clave: avisoDe ? avisoDe.clave : '', motivoFallo: '' },
  primerTurno: primerTurno, llamadaAvisada: llamadaAvisada, preguntaNombre: preguntaNombre, llamada: plan.tipo === 'derivar' && plan.llamada === true, preferencia: '' };
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
      const nombre = avLimpio(avisoDe.solicitud ? (res.nombreDerivacion || (plan.tipo === 'derivar' ? '' : evNombreDelMensaje(plan.textoCliente, ficha.historial)) || ficha.nombre || evPrimerNombre(t.nombrePerfil)) : evPrimerNombre(t.nombrePerfil), 60) || 'sin nombre';
      const interes = avisoDe.solicitud ? avLimpio(evInteres(historia, plan.textoCliente), 40) : (clave === 'consulta_medica' ? 'consulta médica' : 'consulta sin respuesta');
      // La preferencia: «pidió que la llamen» (aceptó la oferta de llamada), la que respondió a la pregunta del código, o la que trae la conversación.
      const horario = avisoDe.solicitud ? (avLimpio(res.llamada ? 'pidió que la llamen' : (plan.tipo === 'derivar' && !evSinHorario(plan.preferencia) ? String(plan.preferencia) : evHorarioPreferido(historia, plan.textoCliente)), 100) || 'sin horario indicado') : 'sin horario';
      if (avisoDe.solicitud) res.preferencia = horario;
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
