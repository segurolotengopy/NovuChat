// ARMAR MENSAJES: lo que sale al cliente, armado por CÓDIGO. UN SOLO MENSAJE por turno, o ninguno (+0 mensajes agregados).
//
// Lee el plan de «Decidir turno» y arma: un texto, un texto con botones (los menús, sin los botones que el cliente ya pulsó), una lista (los bonos), el QR (una IMAGEN por `id` de medio, NUNCA por `link`: el relé
// de WAM rechaza cualquier clave `link` en el cuerpo) o un texto con el botón que abre el chat de Antonio. Lo que redacta el modelo pasa por `cmRevisarRedaccion` (filtro común): si se rechaza, cae al texto fijo.
//
//   puerta «suspendido»        -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido»     -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por persona) NO SALE NADA: cero envío, cero modelo, cero descarga;
//   puerta «sigue»             -> según `plan.tipo` (ver «Decidir turno»).
//
// «SOLO SE OFRECE LO QUE SE CUMPLE»: «ya pasé tu comprobante» / «le avisé» salen SOLO si «Enviar aviso» devolvió un `wamid` real (`avisoSalio`); si no, el texto dice que no se pudo avisar y trae el botón.
// En modo prueba sin `enviarDeVerdad` el aviso no se envía y cuenta como salido (igual que los mensajes al cliente: la prueba no gasta mensajes).
// Todo texto pasa por `raSeguro` (NIEGA_IA, `CB_PROHIBIDAS` y párrafos). La ficha del teléfono (`antonio[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno.
// VIOLENCIA O MIEDO: si «Decidir turno» la detectó, o el modelo contestó la marca RIESGO, sale SOLO el texto fijo («Este asistente no atiende ese tipo de consultas.»: sin botones, sin QR, sin precios, sin aviso a Antonio) y el mensaje se reporta con el evento `no_contactar`.
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const decision = cnPrimero('Decidir turno') || {};
const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : { tipo: 'nada' };
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);
const cat = plan.cat && typeof plan.cat === 'object' ? plan.cat : {};
const fichaAntes = raFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);

const raId = (j) => { const m = j && j.messages; return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''; };
// Lo que pasó con el aviso a Antonio lo dice «Armar avisos» (`planeado`: había un aviso y se armó, por texto libre o por plantilla; `repetido`: ya salió uno por el mismo motivo hace menos de 30 minutos;
// `motivoFallo`: por qué no se pudo armar, p. ej. «plantilla_no_configurada»). «Ya le avisé» exige un `wamid` real de «Enviar aviso»; sin eso, el texto dice la verdad y trae el botón.
const av = cnPrimero('Armar avisos') || {};
const avisoPlaneado = av.planeado === true;
const avisoRepetido = av.repetido === true;
const avisoEnviado = avisoPlaneado && (cnTodos('Enviar aviso').some(raId) || (prueba && cfg.enviarDeVerdad !== true));
// Un aviso suprimido por el límite de 30 minutos trató OTRO contenido en los motivos de texto variable: ahí NO se dice «le avisé» de esta vez.
const repetidoVariable = avisoRepetido && (av.clave === 'no_supo' || av.clave === 'comprobante_sin_cotejo' || av.clave === 'cancelacion' || av.clave === 'qr_insistente' || av.clave === 'sin_configuracion');
const avisoSalio = avisoEnviado || (avisoRepetido && !repetidoVariable);
const estadoAviso = repetidoVariable ? 'repetido' : avisoSalio;

let m = null;               // el item del mensaje (cmMensaje) o null
let tipoDePlan = String(plan.tipo || 'nada');
let llamadasModelo = decision.llamarModelo === true ? 1 : 0;
let usadoNuevo = '';        // el botón de este turno que no debe reaparecer
let respuestaDelModelo = false;   // el texto que sale es la redacción del modelo (cuenta para la memoria y para el menú)
let pedidoNuevo = null;
let riesgoNuevo = false;    // este turno activó (o mantiene) la protección
let qrPrevio = null;        // la ficha antes de la marca provisional del QR
let hashPrevio = null;      // lo último dicho al teléfono antes de este turno (hash y plan): vuelve si Meta no aceptó el envío
let qrLiberado = null;      // la guarda de QR abierto que este turno de comprobante libera (se restaura si el aviso al cliente no sale)

const texto = (cuerpo, extra) => { const c = raSeguro(cuerpo); return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {})); };
const conBotones = (cuerpo, botones, extra) => {
  const c = raSeguro(cuerpo);
  if (!botones.length) return texto(c, extra);
  const respaldo = c + '\n\nEscríbeme cuál prefieres: ' + botones.map((b) => b.title).join(', ') + '.';
  return cmMensaje('cliente', cmBotones(c, botones), c, respaldo, Object.assign({ tipoReporte: 'interactive' }, extra || {}));
};
const conLista = (cuerpo, filas) => {
  const c = raSeguro(cuerpo);
  const respaldo = c + '\n\nEscríbeme cuál prefieres: ' + filas.map((f) => f.title + ' (' + f.description + ')').join(', ') + '.';
  return cmMensaje('cliente', cmLista(c, 'Ver bonos', 'Bonos individuales', filas), c, respaldo, { tipoReporte: 'interactive' });
};
const conAntonio = (cuerpo, extra) => {
  const c = raSeguro(cuerpo);
  return cmContactoConBoton(Object.assign({ numero: cnDigitos(cfg.numeroRecepcion), desde: from, cuerpo: c, botonTexto: RA_BOTON_ANTONIO, saludo: 'Hola Antonio, vengo del asistente virtual.', textoDelRespaldo: 'Escríbele aquí:', sinNumero: 'Eso lo ve Antonio directamente.' }, extra || {}));
};
const usadosHoy = () => fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : []);
// REGLA (P7): un saludo SIN producto decidido no lleva botones con montos. Mientras no esté saludado no hay menú en las respuestas libres; ya saludado, el menú principal sin los botones que ya pulsó.
// Un prellenado con producto ya decidido (Workbook, Calendario/Preguntas) SÍ muestra el precio y los botones con montos desde el primer mensaje, y el Pack o el Libro van directo al QR con su monto.
const menuAbierto = () => (fichaAntes.saludado ? raMenu(cat, usadosHoy()) : []);
const presentacion = !fichaAntes.saludado;
const conPresentacion = (cuerpo) => (presentacion ? RA_SALUDO_APERTURA + '\n\n' + cuerpo : cuerpo);

// La protección ante violencia o miedo se arma aunque la puerta no «siga» (comercio suspendido, estado «operador») o el número no sea boliviano.
const rutaDelTurno = tipoDePlan === 'riesgo' ? 'sigue' : puerta.ruta;
if (rutaDelTurno === 'suspendido' || rutaDelTurno === 'uso_extendido') {
  if (rutaDelTurno === 'uso_extendido' && puerta.responder === true && String(puerta.texto || '').trim() !== '') {
    // Estado «operador»: el texto fijo promete que una persona continúa la conversación. Solo sale tal cual si el aviso a Antonio salió; si no, el texto dice la verdad. Siempre con el botón de Antonio.
    m = conAntonio(avisoSalio ? String(puerta.texto) : raTextoDerivacion('consulta', false, '', base));
  } else if (puerta.responder === true && String(puerta.texto || '').trim() !== '') m = texto(String(puerta.texto));
} else if (rutaDelTurno === 'sigue') {
  // El botón «usado» sale del PRODUCTO del QR (también si el producto se eligió por texto prellenado, sin botón) o de «Bonos» SOLO si el plan realmente atiende el toque (la lista). Un toque que no se
  // atendió (un QR ya abierto, el saludo, una derivación) no se marca: el botón sigue disponible.
  // CANCELAR EL COBRO: «cobro_cerrado» solo si el servidor respondió 200 al evento; si no, la escalada de siempre (nunca se dice que se cerró lo que no se cerró).
  if (tipoDePlan === 'cancelar_cobro') {
    if (raCobroCerrado(cnPrimero('Cancelar cobro en el servidor'))) tipoDePlan = 'cobro_cerrado';
    else { tipoDePlan = 'derivar'; plan.motivo = 'cancelacion'; plan.clave = 'cancelacion'; }
  }
  if (tipoDePlan === 'qr' && RA_PRODUCTOS[plan.producto]) usadoNuevo = RA_PRODUCTOS[plan.producto].boton;
  else if (tipoDePlan === 'bonos' && plan.boton === RA_BOTON_BONOS) usadoNuevo = RA_BOTON_BONOS;

  // LO QUE REDACTA EL MODELO: se revisa y se pule; un rechazo (monto, promesa, enlace, negar ser IA, varias preguntas…), un error del servicio o un texto vacío caen al texto fijo.
  // La marca RIESGO del modelo activa la protección; la palabra DERIVAR pasa a Antonio. Ninguna de las dos llega jamás al cliente.
  if (tipoDePlan === 'modelo' || tipoDePlan === 'angulo') {
    const crudo = cnTextoDeGemini(cnPrimero('Conversar con el modelo'));
    if (raEsMarcaRiesgo(crudo)) tipoDePlan = 'riesgo';
    else if (raEsDerivar(crudo)) { tipoDePlan = 'derivar'; plan.motivo = 'consulta'; plan.clave = 'no_supo'; }
  }

  if (tipoDePlan === 'riesgo') {
    riesgoNuevo = true;
    m = texto(RA_TEXTO_RIESGO, { evento: 'no_contactar' });
  } else if (tipoDePlan === 'fuera_pais') {
    m = conAntonio(RA_TEXTO_FUERA_DE_PAIS);
  } else if (tipoDePlan === 'saludo') {
    m = texto(raSaludo(presentacion));
  } else if (tipoDePlan === 'angulo' || tipoDePlan === 'modelo') {
    const crudo = cnTextoDeGemini(cnPrimero('Conversar con el modelo'));
    const rev = crudo.trim() === '' ? { texto: '', motivo: 'vacio' } : cmRevisarRedaccion(crudo, {
      maximo: 700, enlacesPermitidos: [], quienPromete: ['antonio', 'el equipo'], nombreNegocio: cfg.nombreNegocio, textoDelCliente: t.texto, extra: [raExtraRedaccion],
    });
    const bueno = rev.motivo === '' && rev.texto.trim() !== '';
    // PR-D: el menú NO sale antes de tiempo. Las dos primeras respuestas de la charla (el saludo fijo y una conversación) son solo para acompañar; desde la TERCERA el menú acompaña a la respuesta del modelo.
    // Con un QR abierto jamás hay botones de producto: no se abre otro QR. Una respuesta resuelta sale en texto plano (el botón de Antonio va solo al derivar). Sin botones, el texto no habla de opciones.
    const op = plan.qrAbierto === true ? [] : (fichaAntes.charlaN >= 2 ? menuAbierto() : []);
    let cuerpo;
    if (bueno) { cuerpo = conPresentacion(rev.texto); respuestaDelModelo = true; }
    else if (tipoDePlan === 'angulo') cuerpo = raAperturaFija(plan.angulo, presentacion);
    else cuerpo = conPresentacion(raTextoModeloCaido(op.length > 0));
    m = plan.qrAbierto === true ? texto(cuerpo) : conBotones(cuerpo, op);
    tipoDePlan = bueno ? tipoDePlan : (tipoDePlan === 'angulo' ? 'angulo_fijo' : 'modelo_caido');
  } else if (tipoDePlan === 'precio') {
    const op = plan.qrAbierto === true ? [] : menuAbierto();
    // Con un QR abierto no se ofrecen botones de producto (no se abre otro QR) ni el de Antonio, y el texto no cierra con una pregunta.
    m = plan.qrAbierto === true ? texto(raTextoPrecio(cat, plan.producto, false)) : conBotones(raTextoPrecio(cat, plan.producto, op.length > 0), op);
  } else if (tipoDePlan === 'catalogo') {
    // El catálogo completo con precio, por código (los precios son los del catálogo de la consola). Con un QR abierto, texto plano.
    const op = plan.qrAbierto === true ? [] : menuAbierto();
    m = plan.qrAbierto === true ? texto(raTextoCatalogo(cat, false)) : conBotones(raTextoCatalogo(cat, op.length > 0), op);
  } else if (tipoDePlan === 'imagenes') {
    // «¿Tienes imágenes?»: respuesta fija (no se envían imágenes del libro) y lo que sí hay, con los botones del menú vigente (con un QR abierto, texto plano).
    const op = plan.qrAbierto === true ? [] : menuAbierto();
    m = plan.qrAbierto === true ? texto(raTextoImagenes(true, false)) : conBotones(raTextoImagenes(false, op.length > 0), op);
  } else if (tipoDePlan === 'menu') {
    const op = menuAbierto().length ? menuAbierto() : raMenu(cat, usadosHoy());
    if (op.length) m = conBotones(RA_TEXTO_OPCIONES, op);
    else { tipoDePlan = 'derivar'; m = conAntonio('Por ahora no puedo mostrarte las opciones de compra. Escríbele directo a Antonio con el botón.'); }
  } else if (tipoDePlan === 'bonos') {
    const filas = raFilasBonos(cat, usadosHoy());
    if (filas.length) m = conLista(RA_TEXTO_BONOS, filas);
    else { tipoDePlan = 'derivar'; m = conAntonio('Por ahora no puedo mostrarte los bonos. Escríbele directo a Antonio con el botón.'); }
  } else if (tipoDePlan === 'complemento') {
    const productos = Array.isArray(plan.productos) ? plan.productos.filter((k) => Object.prototype.hasOwnProperty.call(RA_PRODUCTOS, k)) : [];
    m = conBotones(raTextoBonos(productos, cat, plan.conPresentacion === true), raMenuDeBonos(productos, cat, fichaAntes.usados));
  } else if (tipoDePlan === 'resultado') {
    const op = plan.qrAbierto === true ? [] : menuAbierto();
    m = plan.qrAbierto === true ? texto(conPresentacion(raTextoResultado(false))) : conBotones(conPresentacion(raTextoResultado(op.length > 0)), op);
  } else if (tipoDePlan === 'qr') {
    const monto = raPrecio(cat, plan.producto);
    const mediaId = raMediaId(plan.mediaId);
    if (monto === null || monto !== plan.monto || mediaId === '' || !/^[A-Za-z0-9]{3,40}$/.test(String(plan.pedidoId || ''))) {
      // Nunca un QR sin monto del catálogo o sin id de medio: se deriva a Antonio (sin decir que se le avisó: no hay aviso).
      tipoDePlan = 'derivar';
      m = conAntonio(raTextoDerivacion('qr_sin_aviso', false, '', base));
    } else {
      const pie = raSeguro(raPieQr(plan.producto, monto, plan.pedidoId, plan.conPresentacion === true));
      const respaldo = 'No pude mostrarte el QR en este momento. Escríbeme de nuevo en unos minutos para intentarlo otra vez.';
      m = cmMensaje('cliente', Object.assign(cmBase('image'), { image: { id: mediaId, caption: pie } }), pie, respaldo, { tipoReporte: 'image' });
      // El evento que ABRE el cobro: `qr_enviado`, con `referencia` (el pedido) y `monto` (el del catálogo). Cobro real: regla 2 (15 minutos, 3 intentos).
      m.evento = 'qr_enviado';
      m.reglaCobro = 2;
      m.referencia = String(plan.pedidoId);
      m.monto = monto;
      pedidoNuevo = { producto: plan.producto };
    }
  } else if (tipoDePlan === 'qr_pendiente') {
    m = texto(raTextoQrPendiente(plan.producto, plan.monto));
  } else if (tipoDePlan === 'cobro_cerrado') {
    m = conAntonio(RA_TEXTO_COBRO_CERRADO);
  } else if (tipoDePlan === 'cobro_ya_cerrado') {
    m = conAntonio(RA_TEXTO_COBRO_YA_CERRADO);
  } else if (tipoDePlan === 'comprobante') {
    const r = raTextoComprobante(plan.resultado, plan.causa, estadoAviso, plan.diferencia, base);
    m = r.boton === true ? conAntonio(r.cuerpo) : texto(r.cuerpo);
  } else if (tipoDePlan === 'derivar') {
    m = conAntonio(raTextoDerivacion(plan.motivo, estadoAviso, plan.clave, base));
    // Con un comprobante previo, «cancelar» no cancela: el evento `anulacion_avisada` solo avisa al servidor (viaja con el reporte del mensaje).
    if (plan.evento === 'anulacion_avisada') m.evento = 'anulacion_avisada';
  } else if (tipoDePlan === 'imagen_otra') {
    m = texto(plan.documento === true ? RA_TEXTO_DOCUMENTO : RA_TEXTO_IMAGEN);
  } else if (tipoDePlan === 'audio_fijo') {
    // Si es el primer mensaje del teléfono, la presentación fija va en el MISMO mensaje, en su propio párrafo (sin agregar un envío).
    const fijoAudio = plan.causa === 'largo' ? RA_TEXTO_AUDIO_LARGO : (plan.causa === 'corto' ? RA_TEXTO_AUDIO_CORTO : plan.causa === 'no_entendido' ? RA_TEXTO_AUDIO_NO_ENTENDIDO : RA_TEXTO_ARCHIVO_NO_ABIERTO);
    m = texto(presentacion ? RA_SALUDO_APERTURA + '\n\n' + fijoAudio : fijoAudio);
  } else if (tipoDePlan === 'archivo') {
    m = texto(plan.pesado === true ? RA_TEXTO_ARCHIVO_PESADO : RA_TEXTO_ARCHIVO_NO_ABIERTO);
  } else if (tipoDePlan === 'otro') {
    m = texto(RA_TEXTO_CORTES);
  } else {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    m = texto(RA_SALUDO_MINIMO);
  }
}

// NUNCA EL MISMO TEXTO DOS VECES SEGUIDAS (PR-D, [D]): si lo que sale es idéntico (por hash) a lo último que se le envió a este teléfono, sale una alternativa fija (con el botón de Antonio). Una derivación por cancelación, QR insistente o sin configuración repetida NO usa la alterna de contenido (no tiene sentido ahí): sale el texto de «Antonio ya recibió tu aviso anterior» y solo si también fuera idéntico, la alterna. Quedan EXENTOS el QR (su pie
// lleva el pedido), el resultado de un comprobante (cada comprobante es un hecho distinto), la protección ante violencia o miedo (su texto fijo y breve nunca se sustituye), el texto a un número extranjero y lo que
// contiene la presentación del asistente (qué ES: nunca se sustituye). Es el MISMO mensaje: no agrega ni quita ninguno.
if (m && puerta.ruta === 'sigue' && m.tipoReporte !== 'image' && ['comprobante', 'riesgo', 'fuera_pais'].indexOf(tipoDePlan) < 0 && !/asistente virtual/i.test(String(m.texto || '')) && fichaAntes.ultimoHash !== '' && raHashTexto(m.texto) === fichaAntes.ultimoHash) {
  const medio = /^(audio|imagen|otro|archivo)/.test(tipoDePlan);
  const motivoDeriva = tipoDePlan === 'derivar' ? String(plan.motivo || '') : '';
  const repetidoDeriva = motivoDeriva === 'cancelacion' || motivoDeriva === 'qr_insistente' || motivoDeriva === 'sin_configuracion' ? raTextoDerivacion(motivoDeriva, 'repetido', plan.clave, base) : '';
  if (repetidoDeriva !== '' && raHashTexto(repetidoDeriva) !== fichaAntes.ultimoHash) {
    m = conAntonio(repetidoDeriva);
  } else {
    tipoDePlan = 'repetido';
    m = conAntonio(raAlternaDeRepetido(medio, fichaAntes.ultimoHash));
  }
}

// La ficha: un solo lugar, al final del turno. Hasta en un turno sin mensaje (bloqueado) se recuerda el id de Meta (una entrega repetida no se cuenta dos veces).
if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const ficha = raFichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  raRecordarIds(ficha, [t.mensajeId]);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  // «Saludado» = ya se le presentó el asistente (una vez por teléfono). Un texto sin presentación (una derivación, un recordatorio) no cuenta.
  if (m && /asistente virtual/i.test(String(m.texto || '')) && tipoDePlan !== 'fuera_pais') ficha.saludado = true;
  if (tipoDePlan === 'fuera_pais' && m) ficha.fueraDePaisMs = ahora;
  // El límite de 30 minutos por motivo: se fija solo si el aviso SALIÓ (no si se repitió ni si no se pudo enviar).
  if (avisoPlaneado && !avisoRepetido && avisoSalio && typeof av.clave === 'string' && RA_CLAVES_AVISO.indexOf(av.clave) >= 0) ficha.avisosConsulta[av.clave] = ahora;
  if (usadoNuevo && ficha.usados.indexOf(usadoNuevo) < 0) ficha.usados = ficha.usados.concat([usadoNuevo]).slice(-10);
  if (respuestaDelModelo) ficha.modeloN += 1;
  // Las respuestas de conversación entregadas (saludo, ángulo, modelo): el menú que no se pidió sale desde la tercera.
  if (m && ['saludo', 'angulo', 'angulo_fijo', 'modelo', 'modelo_caido'].indexOf(tipoDePlan) >= 0) ficha.charlaN = Math.min(ficha.charlaN + 1, 1000);
  // Lo último que se le dijo (hash del texto y tipo de plan): el recordatorio del QR no se repite dos veces seguidas y ningún texto sale idéntico dos veces seguidas. Solo cuenta el turno que contesta de verdad.
  hashPrevio = { h: ficha.ultimoHash, f: ficha.ultimaFirma, p: ficha.ultimaPregunta, pm: ficha.ultimaPreguntaMs };
  if (m && puerta.ruta === 'sigue') { ficha.ultimoHash = m.tipoReporte === 'image' ? '' : raHashTexto(m.texto); ficha.ultimaFirma = /^[a-z_]{1,30}$/.test(tipoDePlan) ? tipoDePlan : ''; }
  // La última pregunta que se le hizo (para entender un «Sí» o un «No» suelto): sale del texto que de verdad se envía; si ese texto no termina en pregunta, se borra. Vuelve si Meta no aceptó el envío.
  if (m && puerta.ruta === 'sigue') { ficha.ultimaPregunta = m.tipoReporte === 'image' ? '' : raUltimaPregunta(m.texto); ficha.ultimaPreguntaMs = ficha.ultimaPregunta !== '' ? ahora : 0; }
  // «Cancela mi pedido» con un QR abierto: se libera la guarda LOCAL del QR (si el servidor cerró el cobro, ya no hay nada abierto; si no, sigue hasta que venza); se restaura si la respuesta no sale (`Resumen del turno`).
  if ((tipoDePlan === 'derivar' || tipoDePlan === 'cobro_cerrado') && plan.liberaGuarda === true && ficha.qrHastaMs > 0) { qrLiberado = { qrHastaMs: ficha.qrHastaMs }; ficha.qrHastaMs = 0; }
  if (riesgoNuevo) ficha.riesgo = true;
  // La memoria de la charla (15 mensajes): lo que dijo el cliente y lo que se le respondió, solo en la conversación (no en el cobro) y NUNCA en la protección por violencia o miedo.
  if (m && ['saludo', 'angulo', 'angulo_fijo', 'modelo', 'modelo_caido', 'precio', 'resultado', 'complemento'].indexOf(tipoDePlan) >= 0) {
    raRecordarMensaje(ficha, 'u', decision.textoCliente);
    raRecordarMensaje(ficha, 'm', m.texto);
  }
  // MARCA PROVISIONAL del QR: se fija aquí (el id del pedido y la guarda de 15 minutos necesitan existir ya) pero `Resumen del turno` la DESCARTA con `qrPrevio` si Meta no devolvió el `wamid` del QR
  // (sale el respaldo en texto): un QR que no salió no deja al cliente 15 minutos con «Ya tienes un QR abierto».
  if (pedidoNuevo) { qrPrevio = { pedidos: ficha.pedidos, producto: ficha.producto, qrHastaMs: ficha.qrHastaMs }; ficha.pedidos += 1; ficha.producto = pedidoNuevo.producto; ficha.qrHastaMs = ahora + RA_MINUTOS_QR * 60 * 1000; }
  // El comprobante resuelto (todo menos «reintentar» e «ilegible», que siguen con el cobro abierto) cierra el cobro o lo pasa a Antonio: la guarda de 15 minutos del QR ya no tiene sentido.
  // Se guarda el valor previo para restaurarlo si la respuesta no sale (`Resumen del turno`).
  const huboComprobante = tipoDePlan === 'comprobante';
  if (huboComprobante && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible' && ficha.qrHastaMs > 0) { qrLiberado = { qrHastaMs: ficha.qrHastaMs }; ficha.qrHastaMs = 0; }
  // Un comprobante recibido (todo menos «reintentar» e «ilegible») habilita la queja de no entrega: antes de pagar no hay nada que entregar.
  if (huboComprobante && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible') ficha.comprobanteMs = ahora;
  fichas.mapa[from] = ficha;
  raBarrer(fichas.mapa, ahora);
}

const resumen = { plan: tipoDePlan === 'nada' ? (puerta.ruta || 'nada') : tipoDePlan, mensajes: 0, categoria: t.categoria || '', llamadasModelo: llamadasModelo, aviso: avisoPlaneado || avisoRepetido ? (avisoSalio || avisoRepetido ? 'salio' : 'no_salio') : (av.motivoFallo ? 'no_salio' : 'ninguno') };
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
  // Solo lo que sale al cliente se reporta; en modo prueba, nada.
  reportar: !prueba,
  phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  plan: resumen.plan, resumen: resumen,
};
if (qrPrevio) salida.qrPrevio = qrPrevio;
if (qrLiberado) salida.qrLiberado = qrLiberado;
if (hashPrevio) salida.hashPrevio = hashPrevio;
if (m.reglaCobro === 2) salida.reglaCobro = 2;
if (m.referencia) salida.referencia = m.referencia;
if (m.monto !== undefined) salida.monto = m.monto;
return [{ json: salida }];
