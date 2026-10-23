// ARMAR MENSAJES (PR-2): lo que sale al cliente, armado por CÓDIGO. UN SOLO MENSAJE por turno, o ninguno (+0 mensajes agregados).
//
// Lee el plan de «Decidir turno» y arma: un texto, un texto con botones (los menús, sin los botones que el cliente ya pulsó), el QR (una IMAGEN por `id` de medio, NUNCA por `link`: el relé de WAM
// rechaza cualquier clave `link` en el cuerpo) o un texto con el botón que abre el chat de Rubén. Lo que redacta el modelo pasa por `cmRevisarRedaccion` (filtro común): si se rechaza, cae al texto fijo.
//
//   puerta «suspendido»        -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido»     -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por persona) NO SALE NADA: cero envío, cero modelo, cero descarga;
//   puerta «sigue»             -> según `plan.tipo` (ver «Decidir turno»).
//
// «SOLO SE OFRECE LO QUE SE CUMPLE»: «ya pasé tu comprobante» / «le avisé» salen SOLO si «Enviar aviso» devolvió un `wamid` real (`avisoSalio`); si no, el texto dice que no se pudo avisar y trae el botón.
// En modo prueba sin `enviarDeVerdad` el aviso no se envía y cuenta como salido (igual que los mensajes al cliente: la prueba no gasta mensajes).
// Todo texto pasa por `rrSeguro` (NIEGA_IA y `CB_PROHIBIDAS`). La ficha del teléfono (`rroca[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno (y la entrada `a` del historial, en «Resumen del turno»).
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const decision = cnPrimero('Decidir turno') || {};
const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : { tipo: 'nada' };
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);
const cat = plan.cat && typeof plan.cat === 'object' ? plan.cat : {};
const fichaAntes = rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from));

const rrId = (j) => { const m = j && j.messages; return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''; };
// Lo que pasó con el aviso a Rubén lo dice «Armar avisos» (`planeado`: había un aviso y se armó, por texto libre o por plantilla; `repetido`: ya salió uno por el mismo motivo hace menos de 30 minutos;
// `motivoFallo`: por qué no se pudo armar, p. ej. «plantilla_no_configurada»). «Ya le avisé» exige un `wamid` real de «Enviar aviso»; sin eso, el texto dice la verdad y trae el botón.
const av = cnPrimero('Armar avisos') || {};
const avisoPlaneado = av.planeado === true;
const avisoRepetido = av.repetido === true;
const avisoEnviado = avisoPlaneado && (cnTodos('Enviar aviso').some(rrId) || (prueba && cfg.enviarDeVerdad !== true));
// Un aviso suprimido por el límite de 30 minutos trató OTRO contenido en los motivos de texto variable (la consulta que el modelo no supo, el comprobante sin cotejar): ahí NO se dice «le avisé» de esta vez.
const repetidoVariable = avisoRepetido && (av.clave === 'no_supo' || av.clave === 'comprobante_sin_cotejo');
const avisoSalio = avisoEnviado || (avisoRepetido && !repetidoVariable);
const estadoAviso = repetidoVariable ? 'repetido' : avisoSalio;

let m = null;               // el item del mensaje (cmMensaje) o null
let tipoDePlan = String(plan.tipo || 'nada');
let llamadasModelo = decision.llamarModelo === true ? 1 : 0;
let usadoNuevo = '';        // el botón de este turno que no debe reaparecer
let pedidoNuevo = null;
let qrPrevio = null;        // la ficha antes de la marca provisional del QR
let hashPrevio = null;      // lo último dicho a este teléfono antes de este turno (se restaura si el mensaje no salió)
let qrLiberado = null;      // la guarda de QR abierto que este turno de comprobante libera (se restaura si el aviso al cliente no sale)

// `fijo` = true SOLO para un texto fijo del código (la constante de «comprobante leído»): habilita la exención exacta de `rrSeguro`. Nada de lo que redacta el modelo lo pasa.
const texto = (cuerpo, extra, fijo) => { const c = rrSeguro(cuerpo, fijo === true); return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {})); };
const conBotones = (cuerpo, botones, extra) => {
  const c = rrSeguro(cuerpo);
  if (!botones.length) return texto(c, extra);
  const respaldo = c + '\n\nEscríbeme cuál prefieres: ' + botones.map((b) => b.title).join(', ') + '.';
  return cmMensaje('cliente', cmBotones(c, botones), c, respaldo, Object.assign({ tipoReporte: 'interactive' }, extra || {}));
};
const conRuben = (cuerpo) => {
  const c = rrSeguro(cuerpo);
  const x = cmContactoConBoton({ numero: cnDigitos(cfg.numeroRecepcion), desde: from, cuerpo: c, botonTexto: RR_BOTON_RUBEN, saludo: 'Hola Rubén, vengo del asistente virtual.', textoDelRespaldo: 'Escríbele aquí:', sinNumero: 'Eso lo ve Rubén directamente.', esRepetido: (x) => fichaAntes.ultimoHash !== '' && rrHashTexto(x) === fichaAntes.ultimoHash });
  return x;
};
const menu1 = () => rrMenu(1, cat, fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : []));
// REGLA DE ANDRES (20/10/2026): el PRIMER mensaje a un teléfono NO lleva botones con montos. Mientras no esté saludado, todo mensaje que ofrece opciones (ingresos, modelo, respaldos) usa los dos
// botones del saludo (sin precios); ya saludado, el menú de productos.
const menuAbierto = () => (fichaAntes.saludado ? menu1() : rrMenuSaludo(cat, fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : [])));

if (puerta.ruta === 'suspendido' || puerta.ruta === 'uso_extendido') {
  if (puerta.ruta === 'uso_extendido' && puerta.responder === true && String(puerta.texto || '').trim() !== '') {
    // Estado «operador»: el texto fijo promete que una persona continúa la conversación. Solo sale tal cual si el aviso a Rubén salió; si no, el texto dice la verdad. Siempre con el botón de Rubén.
    m = conRuben(avisoSalio ? String(puerta.texto) : rrTextoDerivacion('consulta', false));
  } else if (puerta.responder === true && String(puerta.texto || '').trim() !== '') m = texto(String(puerta.texto));
} else if (puerta.ruta === 'sigue') {
  // El botón «usado» sale del PRODUCTO del QR (también si el producto se eligió por texto prellenado, sin botón) o, si no, del botón pulsado.
  if (tipoDePlan === 'qr' && RR_PRODUCTOS[plan.producto]) usadoNuevo = RR_PRODUCTOS[plan.producto].boton;
  else usadoNuevo = rrProductoDeBoton(plan.boton) || plan.boton === RR_BOTON_COMPLEMENTOS || plan.boton === RR_BOTON_PRECIOS || plan.boton === RR_BOTON_INFO || plan.boton === RR_BOTON_HABLAR ? String(plan.boton) : '';
  if (tipoDePlan === 'saludo') {
    // Saludo corto con UNA presentación por teléfono y, en el MISMO mensaje, «Más información» (sin «Ver precios» desde el 21/10/2026; sin el que ya pulsó; el saludo NUNCA ofrece a Rubén). Ya saludado, el prellenado de consulta recibe SOLO su pregunta.
    const usadosYa = fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : []);
    m = conBotones(rrSaludo(cat, plan.pregunta === 'consulta' ? RR_PREGUNTA_CONSULTA : '', !fichaAntes.saludado), rrMenuSaludo(cat, usadosYa));
  } else if (tipoDePlan === 'precio') {
    // El cliente VIO los precios: «Ver precios» no se reofrece. Sin botones de producto que ofrecer, el texto no cierra con una pregunta sin opciones.
    usadoNuevo = RR_BOTON_PRECIOS;
    // Con un QR abierto no se ofrecen botones de producto (otro QR no se abre): solo el de Rubén.
    m = plan.qrAbierto === true ? conRuben(rrTextoPrecio(cat, plan.producto, false)) : conBotones(rrTextoPrecio(cat, plan.producto, menu1().length > 0), menu1());
  } else if (tipoDePlan === 'catalogo') {
    // El catálogo completo con precio, por código (los precios son los del catálogo de la consola). Con un QR abierto, sin botones de producto: solo el de Rubén.
    usadoNuevo = RR_BOTON_PRECIOS;
    m = plan.qrAbierto === true ? conRuben(rrTextoCatalogo(cat, false)) : conBotones(rrTextoCatalogo(cat, menu1().length > 0), menu1());
  } else if (tipoDePlan === 'imagenes') {
    // «¿Tienes imágenes?»: respuesta fija (no se envían imágenes del libro) y lo que sí hay, con los botones del menú vigente (con un QR abierto, solo el de Rubén).
    m = plan.qrAbierto === true ? conRuben(rrTextoImagenes(true)) : conBotones(rrTextoImagenes(false), menuAbierto());
  } else if (tipoDePlan === 'info') {
    // Datos fijos del guion, sin modelo. Quien vio la información no la ve reofrecida en el saludo; debajo, el menú de productos (ya saludado, es seguro).
    usadoNuevo = RR_BOTON_INFO;
    const op = menu1();
    m = plan.qrAbierto === true ? conRuben(rrTextoInfo(plan.tema, false)) : conBotones(rrTextoInfo(plan.tema, op.length > 0), op);
  } else if (tipoDePlan === 'identidad') {
    // Con un QR abierto no se ofrecen botones de producto (solo el de Rubén); si no, los botones normales.
    if (plan.qrAbierto === true) m = conRuben(RR_TEXTO_IDENTIDAD);
    else m = conBotones(RR_TEXTO_IDENTIDAD, menuAbierto());
  } else if (tipoDePlan === 'precios') {
    usadoNuevo = RR_BOTON_PRECIOS;
    m = conBotones(RR_TEXTO_PRECIOS, menu1());
  } else if (tipoDePlan === 'complemento') {
    m = conBotones(rrTextoComplemento(plan.producto, cat, plan.conPresentacion === true), rrMenuDeComplemento(plan.producto, cat, fichaAntes.usados));
  } else if (tipoDePlan === 'menu2') {
    m = conBotones(rrTextoComplementos(cat), rrMenu(2, cat, fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : [])));
  } else if (tipoDePlan === 'ingresos') {
    const op = menuAbierto();
    m = plan.qrAbierto === true ? conRuben(rrTextoIngresos(false)) : conBotones(rrTextoIngresos(op.length > 0), op);
  } else if (tipoDePlan === 'modelo') {
    // LO QUE REDACTA EL MODELO: se revisa y se pule; un rechazo (monto, promesa, enlace, negar ser IA, varias preguntas…), un error del servicio o un texto vacío caen al texto fijo.
    const crudo = cnTextoDeGemini(cnPrimero('Conversar con el modelo'));
    if (rrEsDerivar(crudo)) {
      // DERIVAR: el modelo no supo responder. La palabra jamás llega al cliente: aviso a Rubén (lo armó «Armar avisos», salvo en una imagen) y el botón.
      if (plan.origen === 'imagen') { tipoDePlan = 'imagen_derivar'; m = conRuben(RR_TEXTO_IMAGEN_DERIVAR); } else { tipoDePlan = 'derivar'; m = conRuben(rrTextoDerivacion('consulta', estadoAviso)); }
    } else if (rrSuplantaARuben(crudo)) {
      // SUPLANTACIÓN (prohibición 4): el modelo se dijo Rubén, el autor o una persona: el mensaje completo se sustituye por la identidad fija (con los botones normales). No se guarda en la memoria.
      tipoDePlan = 'identidad';
      m = plan.qrAbierto === true ? conRuben(RR_TEXTO_IDENTIDAD) : conBotones(RR_TEXTO_IDENTIDAD, menuAbierto());
    } else {
      const rev = crudo.trim() === '' ? { texto: '', motivo: 'vacio' } : cmRevisarRedaccion(crudo, {
        maximo: 700, enlacesPermitidos: [], quienPromete: ['ruben', 'el equipo'], nombreNegocio: cfg.nombreNegocio, textoDelCliente: plan.textoRevision || t.texto, extra: [rrExtraRedaccion],
      });
      // UNA sola presentación (Silvana, 20/10/2026): ya saludado, el modelo no vuelve a presentarse (se quita de su salida)... PERO la regla dura 4 manda: una oración de presentación que dice qué ES el asistente
      // (virtual, IA, programa, bot…) NUNCA se borra. Como primer mensaje cabe UNA, nunca dos. Si al quitar la presentación no queda nada, cae al texto fijo.
      const limpio = rev.motivo === '' ? rrUnaPresentacion(rev.texto, !fichaAntes.saludado || rrPreguntaPorIA(rrNorm(plan.textoRevision || t.texto)), true) : '';
      const bueno = rev.motivo === '' && limpio.trim() !== '';
      // Con un QR abierto el modelo NO abre otro (un `[ENVIAR_QR…]` o cualquier marcador es un rechazo del filtro y cae al texto fijo) y no se ofrecen botones de producto: solo el de Rubén.
      const op = plan.qrAbierto === true ? [] : menuAbierto();
      let cuerpo = bueno ? limpio : (plan.origen === 'imagen' ? RR_TEXTO_IMAGEN_CAIDO : rrTextoModeloCaido(op.length > 0));
      // Una imagen o un audio puede ser el PRIMER mensaje del teléfono: si el texto no se presenta, se antepone la presentación fija (regla dura 4, nunca una oración cruda del modelo).
      if ((plan.origen === 'imagen' || plan.origen === 'audio') && !fichaAntes.saludado && !/asistente virtual/i.test(cuerpo)) cuerpo = RR_PRESENTACION + ' ' + cuerpo;
      // PRESENTACIÓN GARANTIZADA: (a) el pulido común quita la presentación inicial del modelo: si el modelo dijo QUÉ ES (IA, virtual…) y eso no sobrevivió, se antepone la presentación fija (regla dura 4: jamás sale
      // «Gracias por escribir…» en lugar de reconocerlo); (b) como primer mensaje el cliente SIEMPRE lee una presentación que diga qué es (no basta la palabra suelta: «la inteligencia artificial puede ayudarte» o «crear tu asistente virtual»).
      const modeloDijoIA = rrTienePresentacionIA(crudo);
      const falta = !fichaAntes.saludado ? !rrTienePresentacionIA(cuerpo) : (modeloDijoIA && !rrTienePresentacionIA(cuerpo));
      // Se antepone SIEMPRE la constante fija (nunca una oración cruda del modelo: no pasó por la revisión de enlaces, cuentas, montos ni promesas).
      const conPresentacion = falta ? RR_PRESENTACION + '\n\n' + cuerpo : cuerpo;
      m = plan.qrAbierto === true ? conRuben(conPresentacion) : conBotones(conPresentacion, op);
      // La memoria (`rrHist`) guarda `m.texto`, el texto DESPUÉS de las barreras (`rrSeguro`, identidad): si se sustituyó lo que dijo el modelo, eso no se recuerda.
      tipoDePlan = (plan.origen ? plan.origen + '_' : '') + (bueno ? 'modelo' : 'modelo_caido');
    }
  } else if (tipoDePlan === 'qr') {
    const monto = rrPrecio(cat, plan.producto);
    const mediaId = rrMediaId(plan.mediaId);
    if (monto === null || monto !== plan.monto || mediaId === '' || !/^[A-Za-z0-9]{3,40}$/.test(String(plan.pedidoId || ''))) {
      // Nunca un QR sin monto del catálogo o sin id de medio: se deriva a Rubén.
      tipoDePlan = 'derivar';
      m = conRuben(rrTextoDerivacion('qr_sin_aviso', false));
    } else {
      const pie = rrSeguro(rrPieQr(plan.producto, monto, plan.pedidoId, plan.conPresentacion === true, plan.simulado === true));
      const respaldo = 'No pude mostrarte el QR en este momento. Escríbeme de nuevo en unos minutos para intentarlo otra vez.';
      m = cmMensaje('cliente', Object.assign(cmBase('image'), { image: { id: mediaId, caption: pie } }), pie, respaldo, { tipoReporte: 'image' });
      // El evento que ABRE el cobro: `qr_enviado`, con `referencia` (el pedido) y `monto` (el del catálogo). Solo el QR REAL abre un cobro de regla 2 (15 minutos, 3 intentos); el simulado no.
      m.evento = 'qr_enviado';
      if (plan.simulado !== true) m.reglaCobro = 2;
      m.referencia = String(plan.pedidoId);
      m.monto = monto;
      pedidoNuevo = { producto: plan.producto };
    }
  } else if (tipoDePlan === 'qr_pendiente') {
    m = conRuben(rrTextoQrPendiente(plan.producto, plan.monto));
  } else if (tipoDePlan === 'comprobante') {
    const r = rrTextoComprobante(plan.resultado, plan.causa, estadoAviso, plan.diferencia);
    m = r.boton === true ? conRuben(r.cuerpo) : texto(r.cuerpo, undefined, r.fijo === true);
  } else if (tipoDePlan === 'derivar') {
    m = conRuben(rrTextoDerivacion(plan.motivo, estadoAviso, plan.clave));
  } else if (tipoDePlan === 'imagen_otra') {
    // El documento y el archivo no aceptado salen con el botón de Rubén; la imagen no mirada, sin él.
    if (plan.variante === 'documento') m = conRuben(RR_TEXTO_DOCUMENTO);
    else if (plan.variante === 'archivo_no_aceptado') m = conRuben(RR_TEXTO_ARCHIVO_NO_ACEPTADO);
    else if (plan.variante === 'saturado') m = conRuben(RR_TEXTO_IMAGEN_NO_VISTA);
    else {
      // Con un cobro abierto, vencido o en revisión (`conRuben`), la foto que no se pudo mirar (tope diario lleno o visión apagada) lleva el botón de Rubén: puede ser un pago real.
      const t = plan.variante === 'tope' ? RR_TEXTO_IMAGEN_TOPE : (plan.variante === 'no_vista' ? RR_TEXTO_IMAGEN_NO_VISTA : RR_TEXTO_IMAGEN);
      m = plan.conRuben === true ? conRuben(t) : texto(t);
    }
  } else if (tipoDePlan === 'cancele_como_pago') {
    // «Ya cancelé» sin QR abierto = «ya pagué»: se pide el comprobante de un pedido; sin aviso a Rubén y sin afirmar que se recibió nada. Con opciones de compra, el menú; sin ellas, el botón de Rubén.
    const op = menuAbierto();
    m = op.length ? conBotones(RR_TEXTO_CANCELE_COMO_PAGO, op) : conRuben(RR_TEXTO_CANCELE_COMO_PAGO_RUBEN);
  } else if (tipoDePlan === 'imagen_comprobante') {
    // Una foto que parece un comprobante SIN pedido abierto: no se coteja ni se avisa; el cliente puede escribirle a Rubén.
    m = conRuben(RR_TEXTO_IMAGEN_COMPROBANTE);
  } else if (tipoDePlan === 'audio') {
    // `saturado`: el tope global por hora de llamadas a Gemini está lleno; el texto fijo de «no pude abrirlo» con el botón de Rubén, sin llamar a nadie.
    m = plan.variante === 'saturado' ? conRuben(RR_TEXTO_AUDIO_NO_ABIERTO) : texto(plan.variante === 'largo' ? RR_TEXTO_AUDIO_LARGO : plan.variante === 'no_entendido' ? RR_TEXTO_AUDIO_NO_ENTENDIDO : plan.variante === 'no_abierto' ? RR_TEXTO_AUDIO_NO_ABIERTO : plan.variante === 'tope' ? RR_TEXTO_AUDIO_TOPE : RR_TEXTO_AUDIO);
  } else if (tipoDePlan === 'audio_pago') {
    m = conRuben(RR_TEXTO_AUDIO_PAGO);
  } else if (tipoDePlan === 'extranjero') {
    m = conRuben(plan.conPresentacion === false ? RR_TEXTO_EXTRANJERO_DE_NUEVO : RR_TEXTO_EXTRANJERO);
  } else if (tipoDePlan === 'extranjero_repetido') {
    // Ya se le respondió hoy: dentro del día no se le responde otra vez (acota el costo de un barrido de números).
    m = null;
  } else if (tipoDePlan === 'otro') {
    m = texto(RR_TEXTO_OTRO);
  } else {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    m = texto(RR_PRESENTACION);
  }
}

// NUNCA EL MISMO TEXTO DOS VECES SEGUIDAS (21/10/2026): si lo que sale es idéntico (por hash) a lo último que se le envió a este teléfono, sale una alternativa fija (con el botón de Rubén). Ni el QR (su pie lleva el
// pedido) ni el resultado de un comprobante (cada comprobante es un hecho distinto) ni el silencio de un número extranjero entran, ni lo que dice qué ES el asistente (regla dura 4: esa respuesta nunca se sustituye). Es el MISMO mensaje: no agrega ni quita ninguno.
if (m && puerta.ruta === 'sigue' && t.extranjero !== true && m.tipoReporte !== 'image' && tipoDePlan !== 'comprobante' && tipoDePlan !== 'identidad' && !rrTienePresentacionIA(m.texto) && fichaAntes.ultimoHash !== '' && rrHashTexto(m.texto) === fichaAntes.ultimoHash) {
  const medio = /^(audio|imagen|otro)/.test(tipoDePlan);
  tipoDePlan = 'repetido';
  m = conRuben(rrAlternaDeRepetido(medio, fichaAntes.ultimoHash));
}

// La ficha: un solo lugar, al final del turno. Hasta en un turno sin mensaje (bloqueado) se recuerda el id de Meta (una entrega repetida no se cuenta dos veces).
if (claveOk && t.extranjero === true) {
  // UN NÚMERO DE OTRO PAÍS NO TIENE FICHA: solo { número: hora } en `rrExtranjeros` (tope y barrido propios) y el contador GLOBAL de respuestas por hora. Así un barrido de números nunca desplaza la ficha de un cliente real.
  if (m) {
    const rrEx = cnObjetoGlobal('rrExtranjeros', true);
    const rrTp = cnObjetoGlobal('rrTopes', true);
    if (rrEx.sd) { rrEx.mapa[from] = ahora; rrBarrerExtranjeros(rrEx.mapa, ahora); }
    if (rrTp.sd) rrTp.mapa.extranjeros = rrHoraContar(rrTp.mapa.extranjeros, ahora);
  }
} else if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const ficha = rrFichaVigente(cnFichaDe(fichas.mapa, from));
  // MEMORIA POR TELÉFONO (clave `messages[0].from`): vacía si pasaron más de 48 h. Aquí entra lo que dijo el cliente; lo del asistente lo agrega «Resumen del turno» SOLO si Meta lo aceptó.
  const histPrevio = rrHistorialVigente(ficha, ahora);
  // La entrada de un audio transcrito, de una imagen o de un documento la arma «Decidir turno» (`entradaHistorial`, ya enmascarada).
  ficha.historial = puerta.ruta === 'sigue' ? rrAgregarHistorial(histPrevio, 'u', typeof decision.entradaHistorial === 'string' && decision.entradaHistorial.trim() !== '' ? decision.entradaHistorial : rrEntradaCliente(t)) : histPrevio;
  rrRecordarId(ficha, t.mensajeId);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  if (m) ficha.saludado = true;
  // Lo último que se le dijo (hash del texto y tipo de plan): el recordatorio del QR no se repite dos veces seguidas y ningún texto sale idéntico dos veces seguidas. Solo cuenta el turno que contesta de verdad.
  hashPrevio = { h: ficha.ultimoHash, f: ficha.ultimaFirma };
  if (m && puerta.ruta === 'sigue') { ficha.ultimoHash = m.tipoReporte === 'image' ? '' : rrHashTexto(m.texto); ficha.ultimaFirma = /^[a-z_]{1,30}$/.test(tipoDePlan) ? tipoDePlan : ''; }
  // Los topes diarios de medios cuentan cada llamada a Gemini que corrió, aunque haya fallado (un cliente no gasta sin límite con audios ilegibles).
  if (decision.oyoAudio === true) ficha.audios = rrContarMedio(ficha.audios, ahora);
  if (decision.vioImagen === true) ficha.imagenes = rrContarMedio(ficha.imagenes, ahora);
  // El contador GLOBAL por hora de llamadas a Gemini (audio y visión) cuenta lo mismo.
  if (decision.oyoAudio === true || decision.vioImagen === true) { const rrTg = cnObjetoGlobal('rrTopes', true); if (rrTg.sd) rrTg.mapa.gemini = rrHoraContar(rrTg.mapa.gemini, ahora); }
  // Los contadores GLOBALES de avisos a Rubén por hora (`avisos` y `derivaciones`) cuentan solo los avisos de consulta que SALIERON de verdad (el comprobante que cuadra no entra).
  if (avisoPlaneado && !avisoRepetido && avisoEnviado && (av.limitado === 'avisos' || av.limitado === 'derivaciones')) { const rrTa = cnObjetoGlobal('rrTopes', true); if (rrTa.sd) rrTa.mapa[av.limitado] = rrHoraContar(rrTa.mapa[av.limitado], ahora); }
  // El límite de 30 minutos por motivo: se fija solo si el aviso SALIÓ (no si se repitió ni si no se pudo enviar).
  if (avisoPlaneado && !avisoRepetido && avisoSalio && typeof av.clave === 'string' && RR_CLAVES_AVISO.indexOf(av.clave) >= 0) ficha.avisosConsulta[av.clave] = ahora;
  if (usadoNuevo && ficha.usados.indexOf(usadoNuevo) < 0) ficha.usados = ficha.usados.concat([usadoNuevo]).slice(-10);
  // MARCA PROVISIONAL del QR: se fija aquí (el id del pedido y la guarda de 15 minutos necesitan existir ya) pero `Resumen del turno` la DESCARTA con `qrPrevio` si Meta no devolvió el `wamid` del QR
  // (sale el respaldo en texto): un QR que no salió no deja al cliente 15 minutos con «Ya tienes un QR abierto».
  if (pedidoNuevo) { qrPrevio = { pedidos: ficha.pedidos, producto: ficha.producto, qrHastaMs: ficha.qrHastaMs }; ficha.pedidos += 1; ficha.producto = pedidoNuevo.producto; ficha.qrHastaMs = ahora + RR_MINUTOS_QR * 60 * 1000; }
  // El comprobante resuelto (todo menos «reintentar» e «ilegible», que siguen con el cobro abierto) cierra el cobro o lo pasa a Rubén: la guarda de 15 minutos del QR ya no tiene sentido
  // y su tiempo restante daría un falso «Ya tienes un QR abierto». Se guarda el valor previo para restaurarlo si la respuesta no sale (`Resumen del turno`).
  // «Cancela mi pedido» (con un QR abierto): libera igual la guarda LOCAL (el servidor sigue con su solicitud: lo cierra Rubén, el flujo no puede).
  if (tipoDePlan === 'derivar' && plan.liberaGuarda === true && ficha.qrHastaMs > 0) { qrLiberado = { qrHastaMs: ficha.qrHastaMs }; ficha.qrHastaMs = 0; }
  if (tipoDePlan === 'comprobante' && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible' && ficha.qrHastaMs > 0) { qrLiberado = { qrHastaMs: ficha.qrHastaMs }; ficha.qrHastaMs = 0; }
  // Un comprobante recibido (todo menos «reintentar» e «ilegible») habilita la queja de no entrega: antes de pagar no hay nada que entregar.
  if (tipoDePlan === 'comprobante' && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible') ficha.comprobanteMs = ahora;
  fichas.mapa[from] = ficha;
  rrBarrer(fichas.mapa, ahora);
}

const resumen = { plan: tipoDePlan === 'nada' ? (puerta.ruta || 'nada') : tipoDePlan, mensajes: 0, categoria: t.categoria || '', llamadasModelo: llamadasModelo, tokensEntrada: 0, aviso: avisoPlaneado || avisoRepetido ? (avisoSalio || avisoRepetido ? 'salio' : 'no_salio') : (av.motivoFallo ? 'no_salio' : 'ninguno'), avisoMotivo: '' };
resumen.avisoMotivo = cmMotivoAviso({ aviso: resumen.aviso, motivoFallo: av.motivoFallo, planeado: avisoPlaneado, desde: from, numeroRecepcion: cnDigitos(cfg.numeroRecepcion) });
// Costo real del historial: los tokens de entrada que cobró el modelo en este turno (0 si no hubo llamada).
const rrUso = decision.llamarModelo === true ? ((cnPrimero('Conversar con el modelo') || {}).usageMetadata || null) : null;
if (rrUso && Number.isFinite(rrUso.promptTokenCount)) resumen.tokensEntrada = rrUso.promptTokenCount;
let numero = from;
if (prueba) numero = telPrueba;
// `mensajes` se calcula DESPUÉS de decidir el número: en prueba con un teléfono no permitido (`telPrueba` vacío) no sale nada y el resumen lo dice.
const sale = !!m && numero !== '';
resumen.mensajes = sale ? 1 : 0;
if (!sale) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
}
m.payload.to = numero;
const salida = {
  para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo,
  tipoReporte: m.tipoReporte, evento: m.evento || '', esInteractivo: m.tipoReporte === 'interactive', esAviso: false, marcaAvisado: false, empresaAviso: '',
  // Solo lo que sale al cliente se reporta; en modo prueba, nada. Un número de otro país no se reporta a la ingesta (el conteo es del servidor y no existe un campo para excluirlo).
  reportar: !prueba && t.extranjero !== true,
  phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  plan: resumen.plan, resumen: resumen,
};
if (qrPrevio) salida.qrPrevio = qrPrevio;
if (qrLiberado) salida.qrLiberado = qrLiberado;
if (hashPrevio) salida.hashPrevio = hashPrevio;
if (claveOk && puerta.ruta === 'sigue' && t.extranjero !== true) salida.rrHist = { a: rrEntradaAsistente(m.texto), b: rrEntradaAsistente(m.respaldo), tope: RR_TOPE_HISTORIAL };
if (m.reglaCobro === 2) salida.reglaCobro = 2;
if (m.referencia) salida.referencia = m.referencia;
if (m.monto !== undefined) salida.monto = m.monto;
return [{ json: salida }];
