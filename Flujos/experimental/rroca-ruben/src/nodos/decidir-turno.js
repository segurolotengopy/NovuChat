// DECIDIR TURNO: el CÓDIGO decide qué pasa en este turno; el modelo solo conversa. Devuelve un `plan` (nada de texto libre del modelo sale de aquí):
//
//   nada           la puerta cerró el turno (suspendido, uso extendido, pausa por persona): no se hace nada más;
//   saludo         el saludo fijo (hola, más información, precio; o el prellenado 5, con su pregunta);
//   complemento    prellenado 3 o 4: el precio del complemento, el ahorro del Pack calculado por el código y DOS botones;
//   menu2          «Ver complementos»;
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
const avisoDeConsulta = (clave, motivo) => ({ tipo: 'consulta', clave: clave, motivo: motivo, mensaje: String(t.texto || '').slice(0, 200) });

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
    aviso: avisa ? { tipo: 'comprobante', resultado: r.resultado, producto: producto && RR_PRODUCTOS[producto] ? RR_PRODUCTOS[producto].nombre : 'sin producto', monto: cobro.monto, guardada: guardada, motivo: motivoAviso } : null,
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
  if (id === RR_BOTON_COMPLEMENTOS) return salir({ tipo: 'menu2', cat: cat, boton: id });
  // Un toque que no es de este flujo (un botón viejo, una lista de otro mensaje): nunca se toma por una conversación libre; se contesta con el saludo fijo y el menú.
  return salir({ tipo: 'saludo', pregunta: 'general', conMenu: true, cat: cat });
}
// 5. Texto: los prellenados de la landing, la derivación, los ingresos y la conversación.
const pre = rrPrellenado(norm);
if (pre === 'pack' || pre === 'libro') return salir(elegir(pre, ''));
if (pre === 'closer' || pre === 'videos') return salir(hayQrAbierto ? elegir(pre, '') : { tipo: 'complemento', producto: pre, cat: cat, conPresentacion: !ficha.saludado });
// Con un QR abierto, la consulta tampoco reabre el saludo: recibe el recordatorio del QR (un solo QR a la vez).
if (pre === 'consulta') return salir(hayQrAbierto ? { tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat } : { tipo: 'saludo', pregunta: 'consulta', cat: cat });
const derivacion = rrDerivacion(norm);
if (derivacion) return salir({ tipo: 'derivar', motivo: 'consulta', aviso: avisoDeConsulta(derivacion.clave, derivacion.motivo), cat: cat });
if (rrPreguntaPorIngresos(norm)) return salir({ tipo: 'ingresos', cat: cat });
// Con un QR abierto, cualquier texto recibe el recordatorio (un solo QR a la vez); el modelo no interviene.
if (hayQrAbierto) return salir({ tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat });
if (!ficha.saludado && rrEsSoloSaludo(norm)) return salir({ tipo: 'saludo', pregunta: 'general', conMenu: rrIntencionDeCompra(norm), cat: cat });
if (rrEsSoloSaludo(norm) && rrIntencionDeCompra(norm)) return salir({ tipo: 'saludo', pregunta: 'general', conMenu: true, cat: cat });
return salir({ tipo: 'modelo', cat: cat, textoCliente: String(t.texto || '').slice(0, 500) }, {
  llamarModelo: true, cuerpoModelo: rrCuerpoModelo(t.texto, ficha.ultimoModelo),
});
