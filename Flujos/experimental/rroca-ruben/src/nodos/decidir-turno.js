// DECIDIR TURNO: el CÓDIGO decide qué pasa en este turno; el modelo solo conversa. Devuelve un `plan` (nada de texto libre del modelo sale de aquí):
//
//   nada           la puerta cerró el turno (suspendido, uso extendido, pausa por persona): no se hace nada más;
//   saludo         el saludo fijo y CORTO con dos botones («Ver precios» y «Más información»; nunca «Hablar con Rubén») (hola, más información, precio, «cuánto cuesta» como PRIMER mensaje —sin precio—; o el prellenado 5, con su pregunta, sin presentación si ya fue saludado);
//   complemento    prellenado 3 o 4: el precio del complemento, el ahorro del Pack calculado por el código y DOS botones;
//   info           «Más información», «bonos», «capítulos», «qué incluye»: datos fijos del guion, POR CÓDIGO (sin modelo), con el menú de productos;
//   identidad      «¿eres un bot / una persona / Rubén?»: frase fija por código (prohibición 4), sin modelo;
//   menu2          «Ver complementos»;
//   precio         «¿cuánto cuesta…?» YA SALUDADO: el precio exacto del catálogo, por código y sin modelo, con el menú de productos;
//   precios        el botón «Ver precios» del saludo (o un botón desconocido ya saludado): el menú de productos con sus precios; sin opciones que mostrar, `derivar` con motivo `sin_opciones`;
//   qr             el QR con el monto del CATÁLOGO (prellenados 1 y 2, o un botón de producto);
//   qr_pendiente   ya hay un QR abierto: un solo QR a la vez, un pedido = un producto;
//   comprobante    el resultado del cotejo (o el de la prueba simulada) traducido por `cbResultadoVenta`;
//   derivar        pasa a Rubén (factura, otro medio de pago, garantía, reclamo, una persona; o no hay QR utilizable): aviso + botón;
//   ingresos       «¿me garantiza ganar dinero?»: frase fija;
//   modelo         una conversación libre: llama al modelo y le pone el menú;
//   imagen_otra, audio, otro   respuestas fijas a lo que no es un comprobante ni texto.
//
// EL MONTO NUNCA SALE DEL CLIENTE NI DEL MODELO: es el precio del catálogo del producto (`rrPrecio`). Un producto que no sea uno de los 4 no genera QR. Un botón es un botón solo si llegó como
// `interactive` (un texto que diga «b_pack» no lo es). El estado de si hay un QR abierto lo manda el SERVIDOR (`cobro.pendiente`); `ficha.qrHastaMs` evita abrir dos seguidos mientras la consola se entera (se libera al resolverse el comprobante).
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const base = cnPrimero('Config base') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, llamarModelo: false, cuerpoModelo: null, modelo: rrModeloValido(base.modelo) }, extra || {}) }];
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });

const panel = rrPanelDe(cnPrimero('Traer configuración'));
const cat = rrCatalogo(panel.cuerpo);
const cobro = rrCobro(panel, base);
const ficha = rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from));
const norm = rrNorm(t.texto);
const hayQrAbierto = cobro.pendiente === true || ficha.qrHastaMs > ahora;
const producto = ficha.producto || '';
// El aviso de consulta a Rubén lleva el MOTIVO exacto (`clave` + `motivo`). El límite (a lo más UN aviso cada 30 minutos por teléfono Y por motivo) lo aplica «Armar avisos», que ve la ficha.
const avisoDeConsulta = (clave, motivo) => ({ tipo: 'consulta', clave: clave, motivo: motivo, mensaje: t.tipo === 'interactive' ? '' : String(t.texto || '').slice(0, 200) });
// Sin opciones de compra que mostrar (catálogo vacío o agotado, o el cliente ya pulsó todo): nunca «¿cuál prefieres?» sin opciones; se deriva a Rubén (aviso + botón).
const sinOpciones = (boton) => ({ tipo: 'derivar', motivo: 'sin_opciones', aviso: avisoDeConsulta('qr_no_disponible', 'sin opciones de compra disponibles'), cat: cat, boton: boton });

// El plan de «mostrar las opciones»: el menú de productos si queda algún botón; si no, el de complementos si queda alguno; si ninguno, Rubén (nunca «¿cuál prefieres?» sin opciones).
const opcionesDe = (usados, boton) => (rrMenu(1, cat, usados).length ? { tipo: 'precios', cat: cat, boton: boton } : (rrMenu(2, cat, usados).length ? { tipo: 'menu2', cat: cat, boton: boton } : sinOpciones(boton)));

// 1. Un comprobante (o la foto de la prueba simulada).
if (t.esComprobante === true || t.comprobanteSimulado === true) {
  if (t.comprobanteSimulado === true) return salir({ tipo: 'comprobante', resultado: 'simulado', causa: '', diferencia: '', cat: cat, producto: producto, aviso: null });
  // El cotejo corrió solo si hubo medio utilizable; si no (tamaño, descarga, servidor caído), `cbResultadoVenta` lo deja en «sin cotejar» con aviso y botón: nunca «cuadra».
  const r = cbResultadoVenta(cnNodo('Cotejar en el servidor') ? cnPrimero('Cotejar en el servidor') : null);
  const guardada = cbRutaGuardada(cnNodo('Guardar comprobante') ? cnPrimero('Guardar comprobante') : null) !== null;
  const avisa = r.resultado === 'cuadra' || r.resultado === 'aproximado' || r.resultado === 'sin_cotejo';
  // El `motivo` del servidor (lista cerrada, nunca texto leído del comprobante) deja a Rubén saber QUÉ mirar: «cuadra» usa el aviso de siempre; lo demás lleva el motivo exacto.
  const motivoSrv = cbCuerpoDe(cnNodo('Cotejar en el servidor') ? cnPrimero('Cotejar en el servidor') : null).cuerpo.motivo;
  const motivoAviso = r.resultado === 'aproximado' ? rrMotivoComprobante('aproximado', motivoSrv) : (r.resultado === 'sin_cotejo' ? rrMotivoComprobante(r.causa, motivoSrv) : '');
  return salir({
    tipo: 'comprobante', resultado: r.resultado, causa: r.resultado === 'aproximado' && motivoSrv === 'monto_distinto' ? 'monto_distinto' : r.causa, diferencia: r.resultado === 'reintentar' ? cbDiferencia(r.diferencias, 'Bs') : '', cat: cat, producto: producto,
    aviso: avisa ? { tipo: 'comprobante', resultado: r.resultado, producto: producto && RR_PRODUCTOS[producto] ? RR_PRODUCTOS[producto].nombre : 'sin producto', monto: cobro.monto, guardada: guardada, motivo: motivoAviso, clave: r.resultado === 'sin_cotejo' && !r.causa ? 'comprobante_sin_cotejo' : '' } : null,
  });
}
// 2. Lo que no es texto ni toque.
if (t.categoria === 'medio') {
  // Una imagen o un documento SIN cobro pendiente es una imagen cualquiera: no se baja, no se lee, no se coteja.
  return salir({ tipo: t.tipo === 'audio' ? 'audio' : 'imagen_otra', cat: cat });
}
if (t.categoria === 'otro') return salir({ tipo: 'otro', cat: cat });

// 3. Elegir un producto: el QR con el monto del catálogo. Devuelve el plan.
const elegir = (k, boton) => {
  if (hayQrAbierto) return { tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat, boton: boton };
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
  if (id === RR_BOTON_COMPLEMENTOS && !ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
  if (id === RR_BOTON_COMPLEMENTOS) return salir(rrMenu(2, cat, ficha.usados.concat([id])).length ? { tipo: 'menu2', cat: cat, boton: id } : sinOpciones(id));
  // «Ver precios»: el menú de productos (con un QR abierto, el recordatorio del QR). Sin productos que mostrar pero con complementos aún comprables, el menú de complementos; sin ninguno, Rubén.
  // Si llegara como PRIMER mensaje (un botón de un chat viejo), no se muestran montos: el saludo corto. «Hablar con Rubén»: aviso + botón, como «quiero hablar con Rubén» escrito.
  if (id === RR_BOTON_PRECIOS) {
    if (hayQrAbierto) return salir({ tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat, boton: id });
    if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
    return salir(opcionesDe(ficha.usados.concat([id]), id));
  }
  // «Más información»: la explicación del libro y sus bonos, por código. Como PRIMER mensaje (un chat viejo) no se muestran montos: el saludo corto.
  if (id === RR_BOTON_INFO) {
    if (hayQrAbierto) return salir({ tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat, boton: id });
    // Sin `boton`: «Más información» NO pasa a `usados` si el cliente aún no la ha visto (el saludo la vuelve a ofrecer).
    if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
    return salir({ tipo: 'info', tema: 'info', cat: cat, boton: id });
  }
  if (id === RR_BOTON_HABLAR) return salir({ tipo: 'derivar', motivo: 'hablar_boton', clave: 'hablar_con_ruben', aviso: avisoDeConsulta('hablar_con_ruben', 'quiere hablar con Rubén'), cat: cat, boton: id });
  // Un toque que no es de este flujo (un botón viejo, una lista de otro mensaje): nunca se toma por una conversación libre. Con un QR abierto, el recordatorio del QR (como «Ver precios»); se contesta con el
  // saludo fijo si es la primera vez; si ya fue saludado, NO se repite el saludo: el menú de productos (o el de complementos, o Rubén si no hay opciones).
  if (hayQrAbierto) return salir({ tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat, boton: id });
  if (ficha.saludado) return salir(opcionesDe(ficha.usados, ''));
  return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
}
// 5. Texto: los prellenados de la landing, la derivación, los ingresos y la conversación.
const pre = rrPrellenado(norm);
if (pre === 'pack' || pre === 'libro') return salir(elegir(pre, ''));
if (pre === 'closer' || pre === 'videos') {
  if (hayQrAbierto) return salir(elegir(pre, ''));
  // Sin el precio del complemento o sin botones que ofrecer, «¿con cuál prefieres avanzar?» no tendría opciones: se deriva a Rubén.
  return salir(rrPrecio(cat, pre) === null || !rrMenuDeComplemento(pre, cat, ficha.usados).length ? sinOpciones('') : { tipo: 'complemento', producto: pre, cat: cat, conPresentacion: !ficha.saludado });
}
// Con un QR abierto, la consulta tampoco reabre el saludo: recibe el recordatorio del QR (un solo QR a la vez).
if (pre === 'consulta') return salir(hayQrAbierto ? { tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat } : { tipo: 'saludo', pregunta: 'consulta', cat: cat });
const derivacion = rrDerivacion(norm, { comprobante: ficha.comprobanteMs > 0 || cobro.enRevision === true, qrAbierto: hayQrAbierto });
if (derivacion) return salir({ tipo: 'derivar', motivo: 'consulta', clave: derivacion.clave, aviso: avisoDeConsulta(derivacion.clave, derivacion.motivo), cat: cat });
// Identidad POR CÓDIGO (prohibición 4): «¿eres un bot?», «¿quién eres?», «¿hablo con Rubén?»… reciben una frase fija que reconoce ser un asistente virtual con IA; el modelo no interviene.
if (rrPreguntaPorIA(norm)) return salir({ tipo: 'identidad', cat: cat, qrAbierto: hayQrAbierto });
if (rrPreguntaPorIngresos(norm)) return salir({ tipo: 'ingresos', cat: cat });
// Con un QR abierto, cualquier texto recibe el recordatorio (un solo QR a la vez); el modelo no interviene.
if (hayQrAbierto) return salir({ tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat });
// Una pregunta de precio («cuánto cuesta…», «precio»…): el PRIMER mensaje recibe el saludo corto con «Ver precios» y «Más información», SIN precio (Andres, 20/10/2026); ya saludado, el precio exacto
// sale POR CÓDIGO desde el catálogo, sin modelo, con el menú de productos. Sin ningún precio en el catálogo no hay nada que decir: se deriva a Rubén.
const precioPedido = rrPreguntaPorPrecio(norm);
if (precioPedido) {
  if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
  return salir(Object.keys(cat).length ? { tipo: 'precio', producto: precioPedido.producto, cat: cat } : sinOpciones(''));
}
// «¿Cuáles son los bonos?», «qué incluye el libro», «capítulos»: los datos fijos del guion, por código y sin modelo; como PRIMER mensaje, el saludo corto (ningún primer mensaje lleva montos).
const tema = rrTemaDeInfo(norm);
if (tema) return salir(ficha.saludado ? { tipo: 'info', tema: tema, cat: cat } : { tipo: 'saludo', pregunta: 'general', cat: cat });
if (!ficha.saludado && rrEsSoloSaludo(norm)) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
// «Desde solo 32 Bs» (la captura del anuncio general) sigue el camino fijo, sin modelo: primero el saludo corto; ya saludado, los precios por código.
const anuncio = rrAnuncioDe(t.texto);
if (anuncio && anuncio.clave === 'desde_32') {
  if (!ficha.saludado) return salir({ tipo: 'saludo', pregunta: 'general', cat: cat });
  return salir(Object.keys(cat).length ? { tipo: 'precio', producto: '', cat: cat } : sinOpciones(''));
}
return salir({ tipo: 'modelo', cat: cat, textoCliente: String(t.texto || '').slice(0, 500) }, {
  llamarModelo: true, cuerpoModelo: rrCuerpoModelo(t.texto, rrHistorialVigente(ficha, ahora)),
});
