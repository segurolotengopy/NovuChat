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
// Todo texto pasa por `rrSeguro` (NIEGA_IA y `CB_PROHIBIDAS`). La ficha del teléfono (`rroca[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno.
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
let ultimoModelo = fichaAntes.ultimoModelo;
let pedidoNuevo = null;
let qrPrevio = null;        // la ficha antes de la marca provisional del QR
let qrLiberado = null;      // la guarda de QR abierto que este turno de comprobante libera (se restaura si el aviso al cliente no sale)

const texto = (cuerpo, extra) => { const c = rrSeguro(cuerpo); return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {})); };
const conBotones = (cuerpo, botones, extra) => {
  const c = rrSeguro(cuerpo);
  if (!botones.length) return texto(c, extra);
  const respaldo = c + '\n\nEscríbeme cuál prefieres: ' + botones.map((b) => b.title).join(', ') + '.';
  return cmMensaje('cliente', cmBotones(c, botones), c, respaldo, Object.assign({ tipoReporte: 'interactive' }, extra || {}));
};
const conRuben = (cuerpo) => {
  const c = rrSeguro(cuerpo);
  const x = cmContactoConBoton({ numero: cnDigitos(cfg.numeroRecepcion), desde: from, cuerpo: c, botonTexto: RR_BOTON_RUBEN, saludo: 'Hola Rubén, vengo del asistente virtual.', textoDelRespaldo: 'Escríbele aquí:', sinNumero: 'Eso lo ve Rubén directamente.' });
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
    // Saludo corto con UNA presentación por teléfono y, en el MISMO mensaje, «Ver precios» y «Más información» (sin los que ya pulsó; el saludo NUNCA ofrece a Rubén). Ya saludado, el prellenado de consulta recibe SOLO su pregunta.
    const usadosYa = fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : []);
    m = conBotones(rrSaludo(cat, plan.pregunta === 'consulta' ? RR_PREGUNTA_CONSULTA : '', !fichaAntes.saludado), rrMenuSaludo(cat, usadosYa));
  } else if (tipoDePlan === 'precio') {
    // El cliente VIO los precios: «Ver precios» no se reofrece. Sin botones de producto que ofrecer, el texto no cierra con una pregunta sin opciones.
    usadoNuevo = RR_BOTON_PRECIOS;
    m = conBotones(rrTextoPrecio(cat, plan.producto, menu1().length > 0), menu1());
  } else if (tipoDePlan === 'info') {
    // Datos fijos del guion, sin modelo. Quien vio la información no la ve reofrecida en el saludo; debajo, el menú de productos (ya saludado, es seguro).
    usadoNuevo = RR_BOTON_INFO;
    const op = menu1();
    m = conBotones(rrTextoInfo(plan.tema, op.length > 0), op);
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
    m = conBotones(rrTextoIngresos(op.length > 0), op);
  } else if (tipoDePlan === 'modelo') {
    // LO QUE REDACTA EL MODELO: se revisa y se pule; un rechazo (monto, promesa, enlace, negar ser IA, varias preguntas…), un error del servicio o un texto vacío caen al texto fijo.
    const crudo = cnTextoDeGemini(cnPrimero('Conversar con el modelo'));
    if (rrEsDerivar(crudo)) {
      // DERIVAR: el modelo no supo responder. La palabra jamás llega al cliente: aviso a Rubén (lo armó «Armar avisos») y el botón.
      tipoDePlan = 'derivar';
      m = conRuben(rrTextoDerivacion('consulta', estadoAviso));
    } else {
      const rev = crudo.trim() === '' ? { texto: '', motivo: 'vacio' } : cmRevisarRedaccion(crudo, {
        maximo: 700, enlacesPermitidos: [], quienPromete: ['ruben', 'el equipo'], nombreNegocio: cfg.nombreNegocio, textoDelCliente: t.texto, extra: [rrExtraRedaccion],
      });
      // UNA sola presentación (Silvana, 20/10/2026): ya saludado, el modelo no vuelve a presentarse (se quita de su salida)... PERO la regla dura 4 manda: una oración de presentación que dice qué ES el asistente
      // (virtual, IA, programa, bot…) NUNCA se borra. Como primer mensaje cabe UNA, nunca dos. Si al quitar la presentación no queda nada, cae al texto fijo.
      const limpio = rev.motivo === '' ? rrUnaPresentacion(rev.texto, !fichaAntes.saludado || rrPreguntaPorIA(rrNorm(t.texto)), true) : '';
      const bueno = rev.motivo === '' && limpio.trim() !== '';
      const op = menuAbierto();
      const cuerpo = bueno ? limpio : rrTextoModeloCaido(op.length > 0);
      if (bueno) ultimoModelo = cuerpo.slice(0, 300);
      // PRESENTACIÓN GARANTIZADA: (a) el pulido común quita la presentación inicial del modelo: si el modelo dijo QUÉ ES (IA, virtual…) y eso no sobrevivió, se antepone la presentación fija (regla dura 4: jamás sale
      // «Gracias por escribir…» en lugar de reconocerlo); (b) como primer mensaje, el cliente que llega por un anuncio siempre lee «asistente virtual» una vez.
      const modeloDijoIA = rrTienePresentacionIA(crudo);
      const diceAsistenteVirtual = /asistente virtual|inteligencia artificial/.test(rrNorm(cuerpo));
      // Primer mensaje: el cliente SIEMPRE lee «asistente virtual» (o «inteligencia artificial»); si el modelo dijo qué es y eso se perdió, también.
      const falta = modeloDijoIA ? !rrTienePresentacionIA(cuerpo) : (!fichaAntes.saludado && !diceAsistenteVirtual);
      const conPresentacion = falta ? RR_PRESENTACION + '\n\n' + cuerpo : cuerpo;
      m = conBotones(conPresentacion, op);
      tipoDePlan = bueno ? 'modelo' : 'modelo_caido';
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
    m = r.boton === true ? conRuben(r.cuerpo) : texto(r.cuerpo);
  } else if (tipoDePlan === 'derivar') {
    m = conRuben(rrTextoDerivacion(plan.motivo, estadoAviso, plan.clave));
  } else if (tipoDePlan === 'imagen_otra') {
    m = texto(RR_TEXTO_IMAGEN);
  } else if (tipoDePlan === 'audio') {
    m = texto(RR_TEXTO_AUDIO);
  } else if (tipoDePlan === 'otro') {
    m = texto(RR_TEXTO_OTRO);
  } else {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    m = texto(RR_PRESENTACION);
  }
}

// La ficha: un solo lugar, al final del turno. Hasta en un turno sin mensaje (bloqueado) se recuerda el id de Meta (una entrega repetida no se cuenta dos veces).
if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const ficha = rrFichaVigente(cnFichaDe(fichas.mapa, from));
  rrRecordarId(ficha, t.mensajeId);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  if (m) ficha.saludado = true;
  // El límite de 30 minutos por motivo: se fija solo si el aviso SALIÓ (no si se repitió ni si no se pudo enviar).
  if (avisoPlaneado && !avisoRepetido && avisoSalio && typeof av.clave === 'string' && RR_CLAVES_AVISO.indexOf(av.clave) >= 0) ficha.avisosConsulta[av.clave] = ahora;
  if (usadoNuevo && ficha.usados.indexOf(usadoNuevo) < 0) ficha.usados = ficha.usados.concat([usadoNuevo]).slice(-10);
  if (ultimoModelo !== undefined) ficha.ultimoModelo = ultimoModelo;
  // MARCA PROVISIONAL del QR: se fija aquí (el id del pedido y la guarda de 15 minutos necesitan existir ya) pero `Resumen del turno` la DESCARTA con `qrPrevio` si Meta no devolvió el `wamid` del QR
  // (sale el respaldo en texto): un QR que no salió no deja al cliente 15 minutos con «Ya tienes un QR abierto».
  if (pedidoNuevo) { qrPrevio = { pedidos: ficha.pedidos, producto: ficha.producto, qrHastaMs: ficha.qrHastaMs }; ficha.pedidos += 1; ficha.producto = pedidoNuevo.producto; ficha.qrHastaMs = ahora + RR_MINUTOS_QR * 60 * 1000; }
  // El comprobante resuelto (todo menos «reintentar» e «ilegible», que siguen con el cobro abierto) cierra el cobro o lo pasa a Rubén: la guarda de 15 minutos del QR ya no tiene sentido
  // y su tiempo restante daría un falso «Ya tienes un QR abierto». Se guarda el valor previo para restaurarlo si la respuesta no sale (`Resumen del turno`).
  if (tipoDePlan === 'comprobante' && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible' && ficha.qrHastaMs > 0) { qrLiberado = { qrHastaMs: ficha.qrHastaMs }; ficha.qrHastaMs = 0; }
  // Un comprobante recibido (todo menos «reintentar» e «ilegible») habilita la queja de no entrega: antes de pagar no hay nada que entregar.
  if (tipoDePlan === 'comprobante' && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible') ficha.comprobanteMs = ahora;
  fichas.mapa[from] = ficha;
  rrBarrer(fichas.mapa, ahora);
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
if (m.reglaCobro === 2) salida.reglaCobro = 2;
if (m.referencia) salida.referencia = m.referencia;
if (m.monto !== undefined) salida.monto = m.monto;
return [{ json: salida }];
