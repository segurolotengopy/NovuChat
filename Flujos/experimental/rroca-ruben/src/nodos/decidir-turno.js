// DECIDIR TURNO: el CÓDIGO decide qué pasa en este turno; el modelo solo conversa. Devuelve un `plan` (nada de texto libre del modelo sale de aquí):
//
//   nada           la puerta cerró el turno (suspendido, uso extendido, pausa por persona): no se hace nada más;
//   saludo         el saludo fijo y CORTO con UN botón («Más información»; sin «Ver precios» desde el 21/10/2026; nunca «Hablar con Rubén») (hola, más información, precio, «cuánto cuesta» como PRIMER mensaje —sin precio—; o el prellenado 5, con su pregunta, sin presentación si ya fue saludado);
//   complemento    prellenado 3 o 4: el precio del complemento, el ahorro del Pack calculado por el código y DOS botones;
//   info           «Más información», «bonos», «capítulos», «qué incluye»: datos fijos del guion, POR CÓDIGO (sin modelo), con el menú de productos;
//   identidad      «¿eres un bot / una persona / Rubén?»: frase fija por código (prohibición 4), sin modelo;
//   menu2          «Ver complementos»;
//   precio         «¿cuánto cuesta…?» YA SALUDADO: el precio exacto del catálogo, por código y sin modelo, con el menú de productos;
//   catalogo       «dame tu catálogo», «qué vendes», «qué productos tienes», «lista», «opciones»…: los productos con precio leídos del catálogo de la consola, por código; con un QR abierto también (`qrAbierto`, sin abrir otro QR);
//   imagenes       «¿tienes imágenes / fotos / capturas?»: respuesta fija (no se envían imágenes del libro; solo existe el QR);
//   precios        el botón «Ver precios» del saludo (o un botón desconocido ya saludado): el menú de productos con sus precios; sin opciones que mostrar, `derivar` con motivo `sin_opciones`;
//   qr             el QR con el monto del CATÁLOGO (prellenados 1 y 2, o un botón de producto);
//   qr_pendiente   ya hay un QR abierto Y el cliente habla de pagar o pide un producto: el recordatorio (un solo QR a la vez). Si ya fue lo último que se le dijo, se escala a Rubén (`derivar`, `qr_insistente`) en vez de repetirlo;
//                  cualquier otra pregunta con un QR abierto se responde (info, bonos, capítulos, precio, catálogo, identidad, derivación, o el modelo) SIN abrir otro QR (`qrAbierto: true`);
//   comprobante    el resultado del cotejo (o el de la prueba simulada) traducido por `cbResultadoVenta`;
//   derivar        pasa a Rubén («cancela mi pedido» / «no quiero comprar» con un QR abierto: `cancelacion`, y libera la guarda LOCAL del QR; el flujo no puede cerrar la solicitud del servidor; factura, otro medio de pago, garantía, reclamo, una persona; o no hay QR utilizable; o SIN CONFIGURACIÓN del negocio: `sin_configuracion`, el panel falló o no trae catálogo, cobro ni venta): aviso + botón;
//   ingresos       «¿me garantiza ganar dinero?»: frase fija;
//   modelo         una conversación libre: llama al modelo y le pone el menú; ENTREGA 2: lleva un `modo` (`charla` | `antes` | `puente` | `opciones`) que viaja al modelo como línea del sistema (`[MODO_TURNO: …]`);
//   opciones_codigo  ENTREGA 2: el bloque de las opciones (texto fijo con el ahorro calculado + menú de productos), por código: un «sí» a «¿Te muestro las opciones?» o el botón «Ver opciones»;
//   audio          una nota de voz que no se pudo usar (`variante`: largo, no_entendido, no_abierto, tope, apagado): texto fijo; `no_entendido` también cubre una nota DUDOSA (menos de 3 palabras, muletillas o «no se oye»), que nunca llega al modelo; una que SÍ se transcribió sigue la cadena del TEXTO (con `origen: 'audio'` si llega al modelo);
//   audio_pago     «ya pagué / transferí / te mando el comprobante» dicho por audio, sin QR abierto: texto fijo con el botón de Rubén, sin aviso (el pago nunca lo redacta el modelo);
//   imagen_comprobante   una foto que PARECE un comprobante pero no hay pedido abierto: texto fijo con el botón; no se coteja ni se avisa;
//   imagen_otra    un documento o una imagen que no se mira (`variante`: documento, archivo_no_aceptado, tope, no_vista, '' = visión apagada o formato no soportado): texto fijo; una imagen que SÍ se miró llega al modelo (`modelo` con `origen: 'imagen'`);
//   extranjero     un número de otro país: UN texto fijo con el botón de Rubén por número y por día (sin QR, sin descarga, sin aviso); `extranjero_repetido` dentro del día: ningún mensaje;
//   otro           respuesta fija a lo que no es texto ni medio.
//
// LA COMPUERTA DE LAS OPCIONES (ENTREGA 2, 23/10/2026): antes de mostrar un precio, un catálogo o un menú de productos hay al menos DOS mensajes de conversación (`ficha.charlaN >= 2`; el saludo cuenta como uno) o una excepción
// (QR abierto, producto elegido, pedidos, comprobante, cobro en revisión). Lo calcula UNA sola vez este nodo (`habilitado`) y lo publica como `opcionesHabilitadas`; «Armar mensajes» solo lo lee. Quien pide precios antes de tiempo recibe
// el saludo (sin montos) o el «puente»: una idea y «¿Te muestro las opciones?» con el botón «Ver opciones». Los prellenados de producto de la landing, los comprobantes y «ya cancelé» no pasan por la compuerta.
//
// EL MONTO NUNCA SALE DEL CLIENTE NI DEL MODELO: es el precio del catálogo del producto (`rrPrecio`). Un producto que no sea uno de los 4 no genera QR. Un botón es un botón solo si llegó como
// `interactive` (un texto que diga «b_pack» no lo es). El estado de si hay un QR abierto lo manda el SERVIDOR (`cobro.pendiente`); `ficha.qrHastaMs` evita abrir dos seguidos mientras la consola se entera (se libera al resolverse el comprobante).
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const base = cnPrimero('Config base') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
// `medioExtra`: lo que este turno gastó de un medio (`oyoAudio`, `vioImagen`: «Armar mensajes» lo cuenta en la ficha, aunque Gemini falle) y la entrada de la memoria (`entradaHistorial`). Se fija más abajo.
let medioExtra = {};
// `habilitado` se calcula más abajo (necesita la ficha y el cobro); antes de eso vale false.
let habilitado = false;
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, llamarModelo: false, cuerpoModelo: null, modelo: rrModeloValido(base.modelo), opcionesHabilitadas: habilitado }, medioExtra, extra || {}) }];
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });

const panel = rrPanelDe(cnPrimero('Traer configuración'));
const cat = rrCatalogo(panel.cuerpo);
const cobro = rrCobro(panel, base);
const ficha = rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);
// UN NÚMERO DE OTRO PAÍS: se le responde UNA vez al día (el texto fijo con el botón de Rubén) y dentro del día no se le responde. Ni QR, ni descarga de medios, ni aviso, ni modelo.
// No tienen ficha: solo `{ número: hora }` en `rrExtranjeros`, y un contador GLOBAL por hora (`rrTopes.extranjeros`, configurable en «Config base»: `topeExtranjerosHora`); lleno, silencio y sin costo.
if (t.extranjero === true) {
  const rrEx = cnObjetoGlobal('rrExtranjeros', false).mapa;
  const rrExMs = Object.prototype.hasOwnProperty.call(rrEx, from) && Number.isFinite(rrEx[from]) ? rrEx[from] : 0;
  const rrExLleno = rrHoraN(cnObjetoGlobal('rrTopes', false).mapa.extranjeros, ahora) >= rrTopeHora(base.topeExtranjerosHora, RR_EXTRANJEROS_HORA, RR_EXTRANJEROS_HORA_MAX);
  return salir(rrExtranjeroRespondido({ extranjeroMs: rrExMs }, ahora) || rrExLleno ? { tipo: 'extranjero_repetido', cat: cat } : { tipo: 'extranjero', conPresentacion: !(rrExMs > 0), cat: cat });
}
// MEDIOS ENTRANTES. AUDIO: lo que dijo «Preparar transcripción» (la pieza común, incluida tal cual) o, si no corrió, por qué (muy largo, no se pudo abrir, tope, apagado). Un audio transcrito ES el texto del turno.
const au = t.categoria === 'medio' && t.tipo === 'audio' ? rrAudioDelTurno({ t: t, prep: cnNodo('Preparar transcripción') ? cnPrimero('Preparar transcripción') : null, url: cnNodo('Obtener URL del medio') ? cnPrimero('Obtener URL del medio') : null }) : null;
const deAudio = !!au && au.estado === 'ok';
const textoTurno = deAudio ? au.texto : String(t.texto || '');
medioExtra = { oyoAudio: cnNodo('Transcribir audio') !== null, vioImagen: cnNodo('Ver imagen') !== null, entradaHistorial: deAudio ? rrHistorialAudio(au.texto) : '' };
const norm = rrNorm(textoTurno);
// Un «Sí» o un «No» suelto con una pregunta nuestra vigente (30 min): el modelo recibe la pregunta como DATO y qué hacer con ella (port de rroca-antonio). Sin pregunta vigente, nada. Nunca abre un QR ni un cobro por sí solo:
// solo cambia lo que el modelo ve; el QR lo abre el código con un producto elegido.
const respSuelta = ficha.ultimaPregunta !== '' ? rrRespuestaSuelta(norm) : '';
const respuestaAPregunta = respSuelta ? { tipo: respSuelta, pregunta: ficha.ultimaPregunta } : null;
const hayQrAbierto = cobro.pendiente === true || ficha.qrHastaMs > ahora;
const producto = ficha.producto || '';
// La compuerta de las opciones (ver arriba): dos mensajes de conversación o una excepción declarada.
habilitado = hayQrAbierto || ficha.producto !== '' || ficha.pedidos > 0 || ficha.comprobanteMs > 0 || cobro.enRevision === true || ficha.charlaN >= 2;
// El aviso de consulta a Rubén lleva el MOTIVO exacto (`clave` + `motivo`). El límite (a lo más UN aviso cada 30 minutos por teléfono Y por motivo) lo aplica «Armar avisos», que ve la ficha.
const avisoDeConsulta = (clave, motivo) => ({ tipo: 'consulta', clave: clave, motivo: motivo, mensaje: t.tipo === 'interactive' ? '' : (deAudio ? '(audio) ' + rrEnmascarar(textoTurno) : textoTurno).slice(0, 200) });
// EL RECORDATORIO DEL QR ABIERTO (solo si el cliente habla de pagar o pide un producto). Nunca el mismo recordatorio dos veces seguidas: si ya fue lo último que se le dijo (`ficha.ultimaFirma`), se escala a Rubén.
const recordatorio = (boton) => (ficha.ultimaFirma === 'qr_pendiente'
  ? { tipo: 'derivar', motivo: 'qr_insistente', clave: 'qr_insistente', aviso: avisoDeConsulta('qr_insistente', 'insiste con un QR abierto: ya se le recordó el pago'), cat: cat, boton: boton || '' }
  : { tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat, boton: boton || '' });
// Sin opciones de compra que mostrar (catálogo vacío o agotado, o el cliente ya pulsó todo): nunca «¿cuál prefieres?» sin opciones; se deriva a Rubén (aviso + botón).
const sinOpciones = (boton) => ({ tipo: 'derivar', motivo: 'sin_opciones', aviso: avisoDeConsulta('qr_no_disponible', 'sin opciones de compra disponibles'), cat: cat, boton: boton });

// El plan de «mostrar las opciones»: el menú de productos si queda algún botón; si no, el de complementos si queda alguno; si ninguno, Rubén (nunca «¿cuál prefieres?» sin opciones).
const opcionesDe = (usados, boton) => (rrMenu(1, cat, usados).length ? { tipo: 'precios', cat: cat, boton: boton } : (rrMenu(2, cat, usados).length ? { tipo: 'menu2', cat: cat, boton: boton } : sinOpciones(boton)));

// Lo que se mira de una imagen (la clasificación de «Ver imagen» o la del lector del comprobante, que es la misma forma): anuncio / otra llegan al modelo como DATO rotulado, un comprobante sin pedido pasa con Rubén sin aviso.
const pieImagen = String(t.pie || '');
const planDeImagenVista = (lec) => {
  const h = (v) => ({ entradaHistorial: rrHistorialImagen(lec, v, pieImagen) });
  if (lec.tipo === 'comprobante') return salir({ tipo: 'imagen_comprobante', cat: cat }, h(''));
  if (lec.tipo === 'anuncio' && lec.anuncio && lec.anuncio.clave === 'desde_32' && !ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat }, h(''));
  if (lec.tipo === 'anuncio' || (lec.tipo === 'otra' && lec.descripcion !== '')) {
    return salir({ tipo: 'modelo', origen: 'imagen', caso: lec.tipo, cat: cat, textoCliente: pieImagen.slice(0, 500) },
      Object.assign(h(''), { llamarModelo: true, cuerpoModelo: rrCuerpoModelo(rrEtiquetaImagen(lec, pieImagen), rrHistorialVigente(ficha, ahora), { rotulado: true }) }));
  }
  return salir({ tipo: 'imagen_otra', variante: 'no_vista', cat: cat }, h('no_vista'));
};

// El plan del modelo para el turno de texto, de un toque o de un audio transcrito: el cuerpo lleva el `modo` del turno. `boton`: el id del botón tocado (sin texto): el modelo recibe el rótulo de CÓDIGO «[Tocó el botón «…»]»
// (nunca el id). `extra`: campos del plan (`qrAbierto`, `pideOpciones`).
const modeloDelTurno = (modo, extra, boton) => {
  const rotuloToque = boton ? '[Tocó el botón «' + (Object.prototype.hasOwnProperty.call(RR_ETIQUETA_BOTON, boton) ? RR_ETIQUETA_BOTON[boton] : 'otro botón') + '»]' : '';
  const historia = rrHistorialVigente(ficha, ahora);
  const cuerpo = rotuloToque !== '' ? rrCuerpoModelo(rotuloToque, historia, { rotulado: true, respuesta: respuestaAPregunta, modo: modo })
    : (deAudio ? rrCuerpoModelo(rrEtiquetaAudio(au), historia, { rotulado: true, tope: RR_TOPE_AUDIO_MODELO + 100, respuesta: respuestaAPregunta, modo: modo })
      : rrCuerpoModelo(t.texto, historia, { respuesta: respuestaAPregunta, modo: modo }));
  const plan = Object.assign({ tipo: 'modelo', origen: deAudio ? 'audio' : '', cat: cat, modo: modo, textoCliente: (rotuloToque !== '' ? rotuloToque : (deAudio ? '(audio) ' + rrEnmascarar(textoTurno) : textoTurno)).slice(0, 500), textoRevision: rotuloToque !== '' ? '' : textoTurno.slice(0, 500) }, extra || {});
  return salir(plan, { llamarModelo: true, cuerpoModelo: cuerpo });
};
// LA COMPUERTA: el cliente pidió precios, el catálogo, un menú o pagar y todavía no hay dos mensajes de conversación. Sin saludar: el saludo (sin montos), que recuerda que pidió opciones. Con UN mensaje de conversación: el puente (el modelo con
// el modo `puente`, o su texto fijo). Sin ninguno (se identificó o derivó primero): una charla antes de las opciones. En los tres casos `pideOpciones` deja la marca en la ficha.
const pedirOpciones = (boton) => (!ficha.saludado
  ? salir({ tipo: 'saludo', pregunta: 'general', cat: cat, pideOpciones: true })
  : modeloDelTurno(ficha.charlaN === 1 ? 'puente' : 'antes', { pideOpciones: true }, t.tipo === 'interactive' ? boton : ''));

// 0. SIN CONFIGURACIÓN (22/10/2026, port de rroca-antonio): si «Traer configuración» falló (401, 500, timeout, cuerpo vacío) o no trae catálogo, cobro ni venta, el flujo NO improvisa (ni el modelo, ni «no puedo mostrarte el QR»
// como si solo faltara el QR, ni precios): texto honesto, aviso a Rubén (cubeta `derivaciones`, una vez cada 30 minutos por teléfono) y botón. El comprobante de una imagen tampoco se coteja a ciegas. Con una imagen, un documento o un
// toque no se copia texto del cliente al aviso. (El audio ya se bajó y transcribió río arriba —eso no se puede evitar sin un nodo nuevo—, pero su transcripción solo viaja, enmascarada, en el aviso a Rubén.)
if (rrSinConfiguracion(panel)) {
  const visual = t.categoria === 'medio' && !deAudio;
  const aviso = visual
    ? { tipo: 'consulta', clave: 'sin_configuracion', motivo: 'envió una imagen o un archivo (posible comprobante) mientras la configuración no estaba disponible', mensaje: '' }
    : avisoDeConsulta('sin_configuracion', 'el asistente no pudo leer la configuración del negocio (catálogo, cobro o venta)');
  return salir({ tipo: 'derivar', motivo: 'sin_configuracion', clave: 'sin_configuracion', aviso: aviso, cat: cat });
}

// 1. Un comprobante (o la foto de la prueba simulada).
if (t.esComprobante === true || t.comprobanteSimulado === true) {
  if (t.comprobanteSimulado === true) return salir({ tipo: 'comprobante', resultado: 'simulado', causa: '', diferencia: '', cat: cat, producto: producto, aviso: null });
  // LO QUE LLEGÓ NO ERA UN COMPROBANTE (imagen o PDF con un cobro abierto, vencido o en revisión): el lector lo clasificó como anuncio u otra cosa y no leyó una cuenta, «¿Lo leído es comprobante?» lo desvió sin cotejar:
  // el servidor no cambió nada (ni intento ni revisión) y NO hay aviso a Rubén. El lector es una llamada que ya existía (no hay una más); la foto sí cuenta para el tope diario de fotos. Con un QR abierto, el recordatorio del QR (como
  // todo texto); sin él, se responde como a una imagen vista (anuncio → conectar con el libro; otra → caso 3). Un PDF recibe el texto fijo de los documentos.
  const delLector = cnNodo('Interpretar lectura') ? cnPrimero('Interpretar lectura') : null;
  // Lo que NO está registrado no se avisa: se responde como a una imagen vista (o el texto fijo de un documento), sin aviso.
  const comoImagenVista = () => {
    medioExtra.vioImagen = t.tipo !== 'document';
    const lecL = delLector && delLector.lec && typeof delLector.lec === 'object' ? delLector.lec : { tipo: '', titular: '', descripcion: '', anuncio: null };
    if (t.tipo === 'document') return salir({ tipo: 'imagen_otra', variante: hayQrAbierto ? 'archivo_no_aceptado' : 'documento', cat: cat }, { entradaHistorial: rrHistorialImagen(null, 'documento', pieImagen) });
    if (hayQrAbierto) return salir(recordatorio(''));
    const topeFotos = rrTopeMedio(base.topeImagenesDia, RR_TOPE_IMAGENES_DIA, 20);
    if (topeFotos === 0) return salir({ tipo: 'imagen_otra', variante: '', conRuben: true, cat: cat }, { entradaHistorial: rrHistorialImagen(null, 'no_vista', pieImagen) });
    if (rrConteoVigente(ficha.imagenes, ahora) >= topeFotos) return salir({ tipo: 'imagen_otra', variante: 'tope', conRuben: true, cat: cat }, { entradaHistorial: rrHistorialImagen(null, 'no_vista', pieImagen) });
    return planDeImagenVista(lecL);
  };
  if (delLector && delLector.noEsComprobante === true) return comoImagenVista();  // El cotejo corrió solo si hubo medio utilizable; si no (tamaño, descarga, servidor caído), `cbResultadoVenta` lo deja en «sin cotejar» con aviso y botón: nunca «cuadra».
  const r = cbResultadoVenta(cnNodo('Cotejar en el servidor') ? cnPrimero('Cotejar en el servidor') : null);
  const guardada = cbRutaGuardada(cnNodo('Guardar comprobante') ? cnPrimero('Guardar comprobante') : null) !== null;
  // ENTREGA 1 · [C]: NINGÚN aviso «tardío» (ni el texto «ya lo pasé a Rubén») sin un comprobante REGISTRADO: si «Guardar comprobante» no devolvió la ruta del archivo guardado, no hay nada que mostrarle a Rubén
  // (el 21/10 salió un aviso real por la foto de un anuncio sin que nada se registrara). La respuesta es la de una imagen vista (o la de visión), sin aviso.
  if (r.resultado === 'sin_cotejo' && r.causa === 'tardio' && !guardada) return comoImagenVista();
  const avisa = r.resultado === 'cuadra' || r.resultado === 'aproximado' || r.resultado === 'sin_cotejo';
  // El `motivo` del servidor (lista cerrada, nunca texto leído del comprobante) deja a Rubén saber QUÉ mirar: «cuadra» usa el aviso de siempre; lo demás lleva el motivo exacto.
  const motivoSrv = cbCuerpoDe(cnNodo('Cotejar en el servidor') ? cnPrimero('Cotejar en el servidor') : null).cuerpo.motivo;
  const motivoAviso = r.resultado === 'aproximado' ? rrMotivoComprobante('aproximado', motivoSrv) : (r.resultado === 'sin_cotejo' ? rrMotivoComprobante(r.causa, motivoSrv) : '');
  return salir({
    tipo: 'comprobante', resultado: r.resultado, causa: r.resultado === 'aproximado' && motivoSrv === 'monto_distinto' ? 'monto_distinto' : r.causa, diferencia: r.resultado === 'reintentar' ? cbDiferencia(r.diferencias, 'Bs') : '', cat: cat, producto: producto,
    aviso: avisa ? { tipo: 'comprobante', resultado: r.resultado, producto: producto && RR_PRODUCTOS[producto] ? RR_PRODUCTOS[producto].nombre : 'sin producto', monto: cobro.monto, guardada: guardada, motivo: motivoAviso, clave: r.resultado === 'sin_cotejo' && !r.causa ? 'comprobante_sin_cotejo' : '' } : null,
  });
}
// 2. Lo que no es texto ni toque. Un audio transcrito sigue la cadena del texto (más abajo). Una imagen o un documento SIN cobro pendiente nunca se coteja ni se avisa a Rubén: un documento no se baja; una foto
// se mira con Gemini (anuncio, parece comprobante, otra) y lo que se ve es un DATO rotulado para el modelo.
if (t.categoria === 'medio' && !deAudio) {
  if (t.tipo === 'audio') return salir({ tipo: 'audio', variante: au ? au.estado : 'no_abierto', cat: cat });
  const pie = pieImagen;
  const h = (lec, v) => ({ entradaHistorial: rrHistorialImagen(lec, v, pie) });
  if (t.tipo === 'document') return salir({ tipo: 'imagen_otra', variante: hayQrAbierto ? 'archivo_no_aceptado' : 'documento', cat: cat }, h(null, 'documento'));
  if (hayQrAbierto) return salir(recordatorio(''));
  if (t.geminiTope === true) return salir({ tipo: 'imagen_otra', variante: 'saturado', cat: cat }, h(null, 'no_vista'));
  if (t.visionApagada === true) return salir({ tipo: 'imagen_otra', variante: '', cat: cat }, h(null, 'no_vista'));
  if (t.imagenTope === true) return salir({ tipo: 'imagen_otra', variante: 'tope', cat: cat }, h(null, 'no_vista'));
  if (t.verImagen !== true || !cnNodo('Ver imagen')) return salir({ tipo: 'imagen_otra', variante: t.verImagen === true ? 'no_vista' : '', cat: cat }, h(null, 'no_vista'));
  return planDeImagenVista(rrLecturaImagen(cnPrimero('Ver imagen')));
}
if (t.categoria === 'otro') return salir({ tipo: 'otro', cat: cat });

// 3. Elegir un producto: el QR con el monto del catálogo. Devuelve el plan.
const elegir = (k, boton) => {
  if (hayQrAbierto) return recordatorio(boton);
  if (cobro.enRevision === true) return { tipo: 'derivar', motivo: 'en_revision', aviso: null, cat: cat, boton: boton };
  const precio = rrPrecio(cat, k);
  const sinQr = cobro.modo === 'ninguno' ? 'sin_cobro' : (cobro.mediaId === '' ? 'sin_medio' : (precio === null ? 'sin_precio' : ''));
  if (sinQr) return { tipo: 'derivar', motivo: sinQr, aviso: avisoDeConsulta('qr_no_disponible', 'QR no disponible (' + sinQr + ')'), cat: cat, boton: boton };
  return { tipo: 'qr', producto: k, monto: precio, simulado: cobro.modo === 'simulado', mediaId: cobro.mediaId, pedidoId: rrIdPedido(ahora, ficha.pedidos + 1), conPresentacion: !ficha.saludado, cat: cat, boton: boton };
};

// 4. Un toque de botón (solo si llegó como interactivo y es uno de los nuestros).
if (t.tipo === 'interactive') {
  const id = String(t.texto || '');
  const k = rrProductoDeBoton(id);
  if (k) return salir(elegir(k, id));
  // (Sin `boton` si es el PRIMER mensaje: el cliente aún no ha visto lo que pidió, así que no pasa a `usados`.)
  if (id === RR_BOTON_COMPLEMENTOS && !habilitado) return pedirOpciones(id);
  if (id === RR_BOTON_COMPLEMENTOS && !ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
  if (id === RR_BOTON_COMPLEMENTOS) return salir(rrMenu(2, cat, ficha.usados.concat([id])).length ? { tipo: 'menu2', cat: cat, boton: id } : sinOpciones(id));
  // «Ver precios» (un botón de un chat viejo: el saludo ya no lo ofrece): el menú de productos; con un QR abierto, el catálogo con precios SIN abrir otro QR (`qrAbierto`). Sin productos que mostrar pero con complementos aún comprables, el menú de complementos; sin ninguno, Rubén.
  // Si llegara como PRIMER mensaje (un botón de un chat viejo), no se muestran montos: el saludo corto. «Hablar con Rubén»: aviso + botón, como «quiero hablar con Rubén» escrito.
  if (id === RR_BOTON_PRECIOS) {
    if (hayQrAbierto) return salir(Object.keys(cat).length ? { tipo: 'catalogo', cat: cat, qrAbierto: true, boton: id } : sinOpciones(id));
    if (!habilitado) return pedirOpciones(id);
    if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
    return salir(opcionesDe(ficha.usados.concat([id]), id));
  }
  // «Ver opciones» (el botón del puente): habilitado, el bloque de las opciones por código; sin dos mensajes de conversación, la compuerta; con un QR abierto, el recordatorio (como cualquier botón viejo).
  if (id === RR_BOTON_OPCIONES) {
    if (hayQrAbierto) return salir(recordatorio(id));
    if (!habilitado) return pedirOpciones(id);
    return salir(rrMenu(1, cat, ficha.usados).length ? { tipo: 'opciones_codigo', cat: cat, boton: id } : sinOpciones(id));
  }
  // «Más información»: la explicación del libro y sus bonos, por código. Como PRIMER mensaje (un chat viejo) no se muestran montos: el saludo corto.
  if (id === RR_BOTON_INFO) {
    if (hayQrAbierto) return salir({ tipo: 'info', tema: 'info', cat: cat, boton: id, qrAbierto: true });
    // Sin `boton`: «Más información» NO pasa a `usados` si el cliente aún no la ha visto (el saludo la vuelve a ofrecer).
    if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
    return salir({ tipo: 'info', tema: 'info', cat: cat, boton: id });
  }
  if (id === RR_BOTON_HABLAR) return salir({ tipo: 'derivar', motivo: 'hablar_boton', clave: 'hablar_con_ruben', aviso: avisoDeConsulta('hablar_con_ruben', 'quiere hablar con Rubén'), cat: cat, boton: id });
  // Un toque que no es de este flujo (un botón viejo, una lista de otro mensaje): nunca se toma por una conversación libre. Con un QR abierto, el recordatorio del QR (como «Ver precios»); se contesta con el
  // saludo fijo si es la primera vez; si ya fue saludado, NO se repite el saludo: el menú de productos (o el de complementos, o Rubén si no hay opciones).
  if (hayQrAbierto) return salir(recordatorio(id));
  if (!habilitado) return pedirOpciones(id);
  if (ficha.saludado) return salir(opcionesDe(ficha.usados, ''));
  return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
}
// 5. Texto: los prellenados de la landing, la derivación, los ingresos y la conversación.
const pre = deAudio ? '' : rrPrellenado(norm);
if (pre === 'pack' || pre === 'libro') return salir(elegir(pre, ''));
if (pre === 'closer' || pre === 'videos') {
  if (hayQrAbierto) return salir(elegir(pre, ''));
  // Sin el precio del complemento o sin botones que ofrecer, «¿con cuál prefieres avanzar?» no tendría opciones: se deriva a Rubén.
  return salir(rrPrecio(cat, pre) === null || !rrMenuDeComplemento(pre, cat, ficha.usados).length ? sinOpciones('') : { tipo: 'complemento', producto: pre, cat: cat, conPresentacion: !ficha.saludado });
}
// La consulta prellenada recibe SOLO su pregunta (ya saludado, sin presentarse otra vez), también con un QR abierto: nunca abre un QR ni recibe el recordatorio.
if (pre === 'consulta') return salir({ tipo: 'saludo', pregunta: 'consulta', cat: cat });
const derivacion = rrDerivacion(norm, { comprobante: ficha.comprobanteMs > 0 || cobro.enRevision === true, qrAbierto: hayQrAbierto });
if (derivacion) return salir({ tipo: 'derivar', motivo: 'consulta', clave: derivacion.clave, aviso: avisoDeConsulta(derivacion.clave, derivacion.motivo), cat: cat });
// «Cancela mi pedido», «no quiero comprar», «ya no lo quiero» (con un QR abierto o un pedido hecho): pasa a Rubén con aviso y botón y libera la guarda LOCAL del QR. El flujo NO puede cerrar la solicitud de cobro del
// servidor, así que el texto nunca dice que el pedido quedó cancelado. «Solo quiero saber…» no cancela nada: es un cliente que mira (se le responde el contenido más abajo).
const cancelacion = rrCancelaPedido(norm);
if (cancelacion === 'cancela' && (hayQrAbierto || ficha.pedidos > 0)) return salir({ tipo: 'derivar', motivo: 'cancelacion', clave: 'cancelacion', aviso: avisoDeConsulta('cancelacion', 'quiere cancelar su pedido o ya no quiere comprar (el flujo no puede cerrar la solicitud del cobro)'), cat: cat, liberaGuarda: hayQrAbierto });
// «Ya cancelé» / «cancelado» SIN un QR abierto (en Bolivia = «ya pagué»): intención de pago. Texto fijo con el menú y SIN aviso a Rubén (con un QR abierto, `rrHablaDePagar` da el recordatorio más abajo).
if (!hayQrAbierto && rrCancelaComoPago(norm)) return salir({ tipo: 'cancele_como_pago', cat: cat });
// Identidad POR CÓDIGO (prohibición 4): «¿eres un bot?», «¿quién eres?», «¿hablo con Rubén?»… reciben una frase fija que reconoce ser un asistente virtual con IA; el modelo no interviene.
if (rrPreguntaPorIA(norm)) return salir({ tipo: 'identidad', cat: cat, qrAbierto: hayQrAbierto });
if (rrPreguntaPorIngresos(norm)) return salir({ tipo: 'ingresos', cat: cat, qrAbierto: hayQrAbierto });
// CON UN QR ABIERTO (21/10/2026): el recordatorio SOLO sale si el cliente habla de pagar («ya pagué», «cómo pago», «comprobante», «QR», «monto») o pide un producto (más abajo). Todo lo demás se responde: la identidad
// y los ingresos ya arriba; aquí las imágenes, el catálogo, el precio y la información, por código; y una pregunta que el código no sabe, el modelo. Nada de esto abre otro QR (`qrAbierto: true`).
if (hayQrAbierto && rrHablaDePagar(norm)) return salir(recordatorio(''));
// «¿Tienes imágenes?»: respuesta fija, el flujo no envía imágenes del libro. Como PRIMER mensaje, el saludo corto.
if (rrPideImagenes(norm)) return salir(!ficha.saludado ? { tipo: 'saludo', pregunta: 'general', cat: cat } : { tipo: 'imagenes', cat: cat, qrAbierto: hayQrAbierto });
// El catálogo completo con precio, por código (texto y audio transcrito). Como PRIMER mensaje, el saludo corto (ningún primer mensaje lleva montos). Sin ningún precio en el catálogo, Rubén.
if (rrPideCatalogo(norm)) {
  if (!habilitado) return pedirOpciones();
  if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
  return salir(Object.keys(cat).length ? { tipo: 'catalogo', cat: cat, qrAbierto: hayQrAbierto } : sinOpciones(''));
}
// Una pregunta de precio («cuánto cuesta…», «precio»…): el PRIMER mensaje recibe el saludo corto con «Más información», SIN precio (Andres, 20/10/2026); ya saludado, el precio exacto
// sale POR CÓDIGO desde el catálogo, sin modelo, con el menú de productos (con un QR abierto, sin botones de producto y sin abrir otro QR). Sin ningún precio en el catálogo no hay nada que decir: se deriva a Rubén.
const precioPedido = rrPreguntaPorPrecio(norm);
if (precioPedido) {
  // 23/10/2026 (Andres): ya saludado, la pregunta de precio sale por código SIN esperar la compuerta (insistir no produce otra charla sin precio): el precio de ESE producto, o el bloque de las opciones (lo que da el «sí» al puente) si es general
  // o nombra dos. Marca las opciones como vistas igual que ese camino. Nunca abre un QR. El primer mensaje sigue como antes: saludo corto sin montos.
  if (!habilitado && ficha.saludado && !hayQrAbierto) {
    if (!Object.keys(cat).length) return salir(sinOpciones(''));
    if (precioPedido.producto !== '') return salir({ tipo: 'precio', producto: precioPedido.producto, cat: cat });
    return salir(rrMenu(1, cat, ficha.usados).length ? { tipo: 'opciones_codigo', cat: cat } : sinOpciones(''));
  }
  if (!habilitado) return pedirOpciones();
  if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
  return salir(Object.keys(cat).length ? { tipo: 'precio', producto: precioPedido.producto, cat: cat, qrAbierto: hayQrAbierto } : sinOpciones(''));
}
// PAGOS POR AUDIO, por código y sin modelo: «ya pagué / transferí / te mando el comprobante» (sin QR abierto, que ya recibió el recordatorio arriba) pasa con Rubén sin aviso; cualquier otra mención de pagar, QR, banco o
// comprar recibe las opciones (ya saludado) o el saludo corto sin montos (primer mensaje). Antes van la derivación ("pagar con tarjeta"), el precio y los ingresos.
if (deAudio && !hayQrAbierto) {
  const pago = rrAudioDePago(norm);
  if (pago === 'hecho') return salir({ tipo: 'audio_pago', cat: cat });
  if (pago === 'compra' && !habilitado) return pedirOpciones();
  if (pago === 'compra') return salir(!ficha.saludado ? { tipo: 'saludo', pregunta: 'general', cat: cat } : opcionesDe(ficha.usados, ''));
}
// «¿Cuáles son los bonos?», «qué incluye el libro», «capítulos»: los datos fijos del guion, por código y sin modelo; como PRIMER mensaje, el saludo corto (ningún primer mensaje lleva montos).
// «No quiero comprar, solo quiero saber más de los capítulos»: un cliente que mira recibe el contenido (capítulos, bonos o la información general), no una cancelación.
const tema = rrTemaDeInfo(norm) || (cancelacion === 'curioso' ? (/\bcapitulos?\b/.test(norm) ? 'capitulos' : (/\bbonos?\b/.test(norm) ? 'bonos' : 'info')) : '');
if (tema) return salir(ficha.saludado ? { tipo: 'info', tema: tema, cat: cat, qrAbierto: hayQrAbierto } : { tipo: 'saludo', pregunta: 'general', cat: cat });
// ENTREGA 2: «¿cómo te pago?», «quiero comprar», «quiero el pack» SIN un QR abierto y antes de las opciones (después de lo que el código ya sabe contestar, como «¿qué recibo si compro el libro?»): el QR sale solo de un botón de producto o de un prellenado de la landing, así que se pasa por la compuerta (nunca un QR ni un precio sin conversación).
if (!hayQrAbierto && !habilitado && (rrPreguntaComoPagar(norm) || rrPideProducto(norm))) return pedirOpciones();
// AUDIO DUDOSO (22/10/2026, port de `raAudioIlegible` de rroca-antonio): una nota de voz cuya transcripción tiene menos de 3 palabras (sin muletillas), menos de 8 letras o una marca de «no se oye» y que el código no atendió arriba
// (precio, catálogo, información, pago, derivación, identidad…) NO llega al modelo: texto fijo «no se escuchó bien», sin modelo y sin aviso. Un saludo («hola»), que es válido, sigue su camino.
if (deAudio && rrAudioDudoso(norm) && !/^(hola|holi|holas|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|ola)( ruben)?$/.test(norm)) return salir({ tipo: 'audio', variante: 'no_entendido', cat: cat });
// Con un QR abierto, lo que queda: pedir un producto (recordatorio), una pregunta (el modelo, sin QR) o cualquier otra cosa (recordatorio).
if (hayQrAbierto) {
  if (rrPideProducto(norm) || !rrEsPreguntaLibre(textoTurno, norm)) return salir(recordatorio(''));
  return modeloDelTurno('charla', { qrAbierto: true });
}
if (!ficha.saludado && rrEsSoloSaludo(norm)) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
// «Desde solo 32 Bs» (la captura del anuncio general) sigue el camino fijo, sin modelo: primero el saludo corto; ya saludado, los precios por código.
const anuncio = rrAnuncioDe(textoTurno);
if (anuncio && anuncio.clave === 'desde_32') {
  if (!habilitado) return pedirOpciones();
  if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
  return salir(Object.keys(cat).length ? { tipo: 'precio', producto: '', cat: cat } : sinOpciones(''));
}
// ENTREGA 2: un «sí» suelto a «¿Te muestro las opciones?» (el puente, del modelo o fijo) da el bloque de las opciones por código; si no queda ningún botón de producto, Rubén.
if (respSuelta === 'si' && (ficha.ultimaFirma === 'puente' || ficha.ultimaFirma === 'puente_fijo') && habilitado) return salir(rrMenu(1, cat, ficha.usados).length ? { tipo: 'opciones_codigo', cat: cat } : sinOpciones(''));
// El modo del turno. Habilitado: la primera respuesta conversada que sigue lleva el bloque de las opciones (`opciones`) si aún no se vio y hay productos que ofrecer; después, charla. Sin habilitar: si pidió opciones y ya hubo UN mensaje de conversación, puente.
const modoFinal = habilitado ? (!ficha.opcionesVistas && rrMenu(1, cat, ficha.usados).length ? 'opciones' : 'charla') : (ficha.pidioOpciones && ficha.charlaN === 1 ? 'puente' : 'charla');
return modeloDelTurno(modoFinal);
