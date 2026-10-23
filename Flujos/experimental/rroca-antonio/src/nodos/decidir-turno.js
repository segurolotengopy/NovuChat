// DECIDIR TURNO: el CÓDIGO decide qué pasa en este turno; el modelo solo conversa. Devuelve un `plan` (nada de texto libre del modelo sale de aquí):
//
//   nada           la puerta cerró el turno (suspendido, uso extendido, pausa por persona): no se hace nada más;
//   fuera_pais     un número no boliviano: el texto fijo con el botón de Antonio, sin QR (a lo más una vez en 24 horas: lo exige «Normalizar entrada»);
//   riesgo         violencia o miedo (raíces sobre texto, transcripción o texto leído de una imagen; o la marca del modelo en «Armar mensajes»): corta la venta, sin botones ni QR ni precios;
//   saludo         la presentación (UNA vez por teléfono) y la pregunta de apertura, sin montos. EL PRIMER TURNO de un teléfono es SIEMPRE este saludo fijo, por código, salvo que el mensaje traiga una intención que el código
//                  atiende (prellenado, ángulo de anuncio, derivación, precio, producto confirmado): el modelo no abre la conversación;
//   angulo         una entrada por un anuncio: el modelo redacta la apertura con el ángulo como dato (o el texto fijo del ángulo);
//   complemento    el prellenado de un bono: su precio, el ahorro del Pack calculado por el código (si el Pack está disponible) y los botones;
//   menu           las opciones principales (Pack, Libro, Bonos) con sus precios;   bonos   la lista de los 4 bonos;   precio   «¿cuánto cuesta…?» ya saludado, por código;
//   qr             el QR con el monto del CATÁLOGO (prellenados de Pack y Libro, o un botón o una fila de producto);
//   qr_pendiente   ya hay un QR abierto Y el cliente habla de pagar o pide un producto: el recordatorio (un solo QR a la vez, un pedido = un producto). Si ya fue lo último que se le dijo, se escala a Antonio (`derivar` con `qr_insistente`).
//                  Cualquier otra pregunta con un QR abierto se responde (precio, catálogo, imágenes, resultado o el modelo) SIN botones de producto y SIN abrir otro QR (`qrAbierto: true`);
//   catalogo       «qué vendes», «catálogo», «lista», «opciones»: los productos con precio leídos del catálogo de la consola, por código;   imagenes   «¿tienes imágenes?»: texto fijo, el flujo no envía imágenes;
//   cancelar_cobro «cancela ese qr» con un QR abierto y sin comprobante: el servidor cierra el cobro (llamada síncrona) y sale `cobro_cerrado`; si el servidor no responde 200, sale la derivación `cancelacion`;   cobro_ya_cerrado   la segunda cancelación seguida;
//   comprobante    el resultado del cotejo traducido por `cbResultadoVenta`;
//   derivar        pasa a Antonio (factura, otro medio de pago, garantía, reclamo, una persona; producto agotado; sin QR utilizable; «cancela mi pedido» con un QR abierto: `cancelacion`; SIN CONFIGURACIÓN del negocio: `sin_configuracion`): aviso + botón;
//   resultado      «¿me garantiza recuperar mi relación?»: frase fija;
//   modelo         una conversación libre: llama al modelo (memoria de 15 mensajes) y, desde la segunda respuesta, le pone el menú;
//   imagen_otra, audio_fijo, otro   respuestas fijas a lo que no es un comprobante ni texto. `audio_fijo` también cubre una nota de voz CORTA o ininteligible (menos de 3 palabras): se pide repetirla; el modelo nunca la contesta.
//
// EL MONTO NUNCA SALE DEL CLIENTE NI DEL MODELO: es el precio del catálogo del producto (`raPrecio`). Un producto que no sea uno de los 6, o que esté agotado, no genera QR. Un botón es un botón solo si llegó
// como `interactive` (un texto que diga «b_pack» no lo es). Si hay un QR abierto lo dice el SERVIDOR (`cobro.pendiente`); `ficha.qrHastaMs` evita abrir dos seguidos mientras la consola se entera.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const base = cnPrimero('Config base') || {};
raFijarNombre(cfg.nombreNegocio, base.nombreNegocio);   // el nombre sale de la consola; «Config base» y luego «Método Puente» son el respaldo
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
let textoDelTurno = '';   // lo que escribió (o dijo) el cliente en este turno: «Armar mensajes» lo guarda en la memoria de la charla
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, textoCliente: textoDelTurno, llamarModelo: false, cuerpoModelo: null, modelo: raModeloValido(base.modelo) }, extra || {}) }];
const panel = raPanelDe(cnPrimero('Traer configuración'));
const cat = raCatalogo(panel.cuerpo);
const agotados = raAgotados(panel.cuerpo);
const cobro = raCobro(panel);
const ficha = raFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);

// 0. LA PROTECCIÓN ANTE VIOLENCIA O MIEDO VA PRIMERO, también con la puerta cerrada y fuera del país: si el comercio está suspendido, el estado es «operador» (el cliente sí recibe un mensaje) o el número no es
//    boliviano, un texto de riesgo recibe el texto de protección y reporta `no_contactar`, nunca el texto neutro, el aviso de uso extendido ni el de «pago con QR boliviano». La pausa por persona («bloqueado»)
//    sigue en silencio: ahí responde Antonio. Aquí solo se mira el texto y el pie (los medios no se bajan con la puerta cerrada ni fuera del país).
const riesgoEscrito = ficha.riesgo || raEsRiesgo(raNorm([t.texto, t.pie].join(' ')));
const puertaResponde = puerta.ruta === 'sigue' || puerta.ruta === 'suspendido' || (puerta.ruta === 'uso_extendido' && puerta.responder === true);
if (puertaResponde && puerta.ruta !== 'sigue' && riesgoEscrito) return salir({ tipo: 'riesgo', aviso: null, cat: cat });
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });

// 0b. Un número no boliviano: el texto fijo y el botón de Antonio. Nada de modelo, de medios ni de QR.
if (t.fueraDePais === true) return salir(riesgoEscrito ? { tipo: 'riesgo', aviso: null, cat: cat } : { tipo: 'fuera_pais', cat: cat });

// El medio de este turno (solo uno de estos nodos corrió) y lo que se leyó en él.
const prep = cnPrimero('Preparar imagen') || cnPrimero('Preparar transcripción') || cnPrimero('Medio no aceptado') || {};
const entradaMedio = String(prep.userInput || '');
const esAudio = t.esMedioAudio === true;
const esVisual = t.esMedioVisual === true;
const categoriaMedio = String(prep.categoriaMedio || '');
// El texto leído en la imagen es un DATO del cliente: solo sirve para reconocer el ángulo del anuncio y para detectar riesgo; nunca llega al modelo como instrucción.
const jsonImagen = esVisual ? (cnJsonDeGemini(cnPrimero('Describir documento') || cnPrimero('Describir imagen')) || {}) : {};
const leido = esVisual && typeof jsonImagen.texto === 'string' ? raLineaCliente(jsonImagen.texto, 500) : '';
// La nota de voz: el texto transcrito (la primera línea), o la falla.
let transcrito = '';
let falloAudio = '';
if (esAudio) {
  if (/^\(audio transcripto\) /.test(entradaMedio)) transcrito = entradaMedio.slice('(audio transcripto) '.length).split('\n')[0].trim();
  else if (/más de cinco minutos/.test(entradaMedio)) falloAudio = 'largo';
  else if (/no se pudo entender/.test(entradaMedio)) falloAudio = 'no_entendido';
  else falloAudio = 'no_abierto';
}
const textoCliente = t.tipo === 'interactive' ? '' : (esAudio ? transcrito : String(t.texto || ''));
const norm = raNorm(textoCliente);
textoDelTurno = raLineaCliente(textoCliente, 300).replace(/\s+/g, ' ').trim();
// Un «Sí» o un «No» suelto con una pregunta nuestra vigente (30 min): el modelo recibe la pregunta como dato y qué hacer con ella. Sin pregunta vigente, nada.
const respSuelta = !esVisual && ficha.ultimaPregunta !== '' ? raRespuestaSuelta(norm) : '';
const respuestaAPregunta = respSuelta ? { tipo: respSuelta, pregunta: ficha.ultimaPregunta } : null;

// El aviso de consulta a Antonio lleva el MOTIVO exacto (`clave` + `motivo`). El límite (a lo más UN aviso cada 30 minutos por teléfono Y por motivo) lo aplica «Armar avisos», que ve la ficha.
const avisoDeConsulta = (clave, motivo) => ({ tipo: 'consulta', clave: clave, motivo: motivo, mensaje: t.tipo === 'interactive' ? '' : String(textoCliente || leido).slice(0, 200) });
// EL RECORDATORIO DEL QR ABIERTO (solo si el cliente habla de pagar o pide un producto). Nunca el mismo recordatorio dos veces seguidas: si ya fue lo último que se le dijo (`ficha.ultimaFirma`), se escala a Antonio.
const recordatorio = (boton) => (ficha.ultimaFirma === 'qr_pendiente'
  ? { tipo: 'derivar', motivo: 'qr_insistente', clave: 'qr_insistente', aviso: avisoDeConsulta('qr_insistente', 'insiste con un QR abierto: ya se le recordó el pago'), cat: cat, boton: boton || '' }
  : { tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat, boton: boton || '' });
const sinOpciones = (boton) => ({ tipo: 'derivar', motivo: 'sin_opciones', aviso: avisoDeConsulta('qr_no_disponible', 'sin opciones de compra disponibles'), cat: cat, boton: boton });
const hayQrAbierto = cobro.pendiente === true || ficha.qrHastaMs > ahora;
const hayCobro = cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null);
const producto = ficha.producto || '';
const nombreProducto = producto && RA_PRODUCTOS[producto] ? RA_PRODUCTOS[producto].nombre : 'sin producto';

// El resultado del cotejo (si corrió) como plan de comprobante. Solo corrió si la imagen era un comprobante y había un cobro real; si no, «cbResultadoVenta» lo deja en «sin cotejar» con aviso y botón: nunca «cuadra».
const planComprobante = () => {
  const resp = cnNodo('Cotejar en el servidor') ? cnPrimero('Cotejar en el servidor') : null;
  const r = cbResultadoVenta(resp);
  const avisa = r.resultado === 'cuadra' || r.resultado === 'aproximado' || r.resultado === 'sin_cotejo';
  const motivoSrv = cbCuerpoDe(resp).cuerpo.motivo;
  const motivoAviso = r.resultado === 'aproximado' ? raMotivoComprobante('aproximado', motivoSrv) : (r.resultado === 'sin_cotejo' ? raMotivoComprobante(r.causa, motivoSrv) : '');
  return {
    tipo: 'comprobante', resultado: r.resultado, causa: r.resultado === 'aproximado' && motivoSrv === 'monto_distinto' ? 'monto_distinto' : r.causa, diferencia: r.resultado === 'reintentar' ? cbDiferencia(r.diferencias, 'Bs') : '', cat: cat, producto: producto,
    aviso: avisa ? { tipo: 'comprobante', resultado: r.resultado, producto: nombreProducto, monto: cobro.monto, motivo: motivoAviso, clave: r.resultado === 'sin_cotejo' && !r.causa ? 'comprobante_sin_cotejo' : '' } : null,
  };
};

// 1. VIOLENCIA O MIEDO: antes que cualquier otra cosa (corta la venta). Se mira el texto, la transcripción, el texto leído de la imagen y el pie de foto; una vez activada, sigue activa 48 horas. El turno que trae
//    un COMPROBANTE (imagen o PDF) sigue su camino normal del cobro (cotejo y aviso a Antonio): el riesgo se detecta solo en turnos sin comprobante pendiente de cotejar. Sin aviso a Antonio, sin consejos.
if (!(esVisual && categoriaMedio === 'comprobante') && (ficha.riesgo || raEsRiesgo(raNorm([textoCliente, leido, t.pie].join(' '))))) {
  return salir({ tipo: 'riesgo', aviso: null, cat: cat });
}

// 1b. Lo que no necesita la configuración del negocio: una nota de voz que no se pudo usar (o que es corta o ininteligible: se pide repetirla, nunca la contesta el modelo) y lo que este canal no lee.
//     (La nota de voz corta con una intención clara —«hola», «quiero el pack»— no llega aquí: la atiende el código más abajo.)
if (esAudio && falloAudio) return salir({ tipo: 'audio_fijo', causa: falloAudio, cat: cat });
if (t.categoria === 'otro') return salir({ tipo: 'otro', cat: cat });
// 1c. SIN CONFIGURACIÓN (PR-D, orden de Andres): si «Traer configuración» falló o no trae catálogo, cobro ni venta, el flujo NO improvisa (ni el modelo, ni «no puedo mostrarte el QR» como si solo faltara el QR, ni precios):
//     texto honesto, aviso a Antonio y botón. El comprobante de una imagen tampoco se coteja a ciegas.
if (raSinConfiguracion(panel)) {
  // Con una imagen o un PDF el aviso dice que pudo ser un comprobante, sin copiar texto del cliente.
  const aviso = esVisual
    ? { tipo: 'consulta', clave: 'sin_configuracion', motivo: 'envió una imagen (posible comprobante) mientras la configuración no estaba disponible', mensaje: '' }
    : avisoDeConsulta('sin_configuracion', 'el asistente no pudo leer la configuración del negocio (catálogo, cobro o venta)');
  return salir({ tipo: 'derivar', motivo: 'sin_configuracion', clave: 'sin_configuracion', aviso: aviso, cat: cat });
}

// 2. Una imagen o un documento.
if (esVisual) {
  if (cnNodo('Medio no aceptado')) {
    // Demasiado pesado o ilegible: con un cobro real abierto probablemente sea el comprobante, y entonces va a Antonio sin cotejar; si no, se pide uno más liviano.
    if (hayCobro) return salir(Object.assign(planComprobante(), { resultado: 'sin_cotejo', causa: '', aviso: { tipo: 'comprobante', resultado: 'sin_cotejo', producto: nombreProducto, monto: cobro.monto, motivo: raMotivoComprobante('', ''), clave: 'comprobante_sin_cotejo' } }));
    return salir({ tipo: 'archivo', pesado: /demasiado pesado/.test(entradaMedio), cat: cat });
  }
  if (categoriaMedio === 'comprobante') {
    if (cnNodo('Cotejar en el servidor')) return salir(planComprobante());
    // Un comprobante sin cobro abierto: no se coteja nada; lo ve Antonio.
    return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cobro', clave: 'comprobante_sin_cobro', aviso: avisoDeConsulta('comprobante_sin_cobro', 'recibió una imagen que parece un comprobante, pero no hay un QR abierto'), cat: cat });
  }
  // La captura de un pago rechazado, pendiente o con error: nunca se coteja ni se afirma qué pasó con el dinero. Lo ve Antonio: aviso con ese motivo (a lo más uno cada 30 minutos por teléfono) y el botón.
  if (categoriaMedio === 'pago_con_problema') {
    return salir({ tipo: 'derivar', motivo: 'pago_con_problema', clave: 'pago_con_problema', aviso: { tipo: 'consulta', clave: 'pago_con_problema', motivo: 'envió la captura de un pago que parece no haberse completado', mensaje: '' }, cat: cat });
  }
  // Foto, captura de pantalla, «otro» (y la categoría inventada, que ya cayó en «otro») y una publicidad cuyo ángulo no se reconoce: el asistente dice lo que ve (descripción ya saneada por «Preparar imagen»; en una publicidad,
  // una frase fija del código) y ofrece el libro y los precios. Una publicidad con ángulo conocido sigue más abajo (apertura del ángulo).
  if (categoriaMedio !== 'publicidad' || raAngulo(raNorm(leido)) === '') {
    // Segunda barrera sobre la descripción: si traía un enlace, un correo, una cifra larga, un dominio o un delimitador, el módulo común lo quitó y quedaría una frase mutilada («Veo escribe a»): se descarta ENTERA.
    const cruda = String(jsonImagen.descripcion || '');
    const mutilada = /https?:|www\.|@|\d[\d\s.\-\/,]{3,}\d|\b\S+\.(?:com|net|org|bo|io|app|me|link|ly)\b|[\[\]{}<>«»"'`*_\\|#]/i.test(cruda);
    // Tercera barrera (revisión de seguridad de #602): la descripción se muestra tal cual al cliente, así que NO puede prometer ni afirmar nada (reembolso, devolución, descuento, regalo, dinero), ni afirmar un pago (`CB_PROHIBIDAS`), ni negar ser una IA.
    // Se mira la cruda y la saneada. No se descarta por «antonio» ni por «pago» a secas: el logo del comercio y «pago no se completó» siguen funcionando.
    const prometedora = [cruda, String(prep.descripcionMedio || '')].some((x) => {
      const n = raNorm(x);
      return /reembols|devol|devuelt|reintegr|anulad|rechazad|gratis|gratuit|descuent|promet|promoci|oferta|garant|regal|dinero|plata/.test(n) || CB_PROHIBIDAS.test(cbCanon(x)) || RA_NIEGA_IA.test(n);
    });
    const descripcion = categoriaMedio === 'publicidad' ? 'una imagen publicitaria' : (mutilada || prometedora ? '' : String(prep.descripcionMedio || ''));
    return salir({ tipo: 'imagen_descrita', documento: t.esDocumento === true, descripcion: descripcion, cat: cat });
  }
  // Una captura de anuncio: se reconoce el ángulo por el texto leído; sin ángulo, se sigue como una charla.
}

// 5. Elegir un producto: el QR con el monto del catálogo. Devuelve el plan.
const elegir = (k, boton) => {
  if (hayQrAbierto) return recordatorio(boton);
  if (cobro.enRevision === true) return { tipo: 'derivar', motivo: 'en_revision', aviso: null, cat: cat, boton: boton };
  const precio = raPrecio(cat, k);
  const agotado = agotados.indexOf(k) >= 0;
  const sinQr = precio === null ? (agotado ? 'agotado' : 'sin_precio') : (cobro.modo === 'ninguno' ? 'sin_cobro' : (cobro.mediaId === '' ? 'sin_medio' : ''));
  if (sinQr === 'agotado') return { tipo: 'derivar', motivo: 'agotado', aviso: avisoDeConsulta('producto_agotado', 'pidió ' + RA_PRODUCTOS[k].nombre + ', que figura como agotado'), cat: cat, boton: boton };
  if (sinQr) return { tipo: 'derivar', motivo: sinQr, aviso: avisoDeConsulta('qr_no_disponible', 'QR no disponible (' + sinQr + ')'), cat: cat, boton: boton };
  return { tipo: 'qr', producto: k, monto: precio, mediaId: cobro.mediaId, pedidoId: raIdPedido(ahora, ficha.pedidos + 1), conPresentacion: !ficha.saludado, cat: cat, boton: boton };
};
// Las opciones principales: el menú si queda algún botón; si no, la lista de bonos; si ninguna, Antonio (nunca «¿cuál prefieres?» sin opciones).
const opcionesDe = (usados, boton) => (raMenu(cat, usados).length ? { tipo: 'menu', cat: cat, boton: boton } : (raFilasBonos(cat, usados).length ? { tipo: 'bonos', cat: cat, boton: boton } : sinOpciones(boton)));
const saludo = (boton) => ({ tipo: 'saludo', cat: cat, boton: boton || '' });

// 6. Un toque de botón o de fila (solo si llegó como interactivo y es uno de los nuestros).
if (t.tipo === 'interactive') {
  const id = String(t.seleccionId || '');
  const k = raProductoDeBoton(id);
  if (k) return salir(elegir(k, id));
  if (id === RA_BOTON_BONOS) {
    if (hayQrAbierto) return salir(recordatorio(id));
    if (!ficha.saludado) return salir(saludo(id));
    return salir(raFilasBonos(cat, ficha.usados.concat([id])).length ? { tipo: 'bonos', cat: cat, boton: id } : sinOpciones(id));
  }
  // Un toque que no es de este flujo (un botón viejo, una lista de otro mensaje): nunca se toma por una conversación libre. Con un QR abierto, el recordatorio del QR; la primera vez, el saludo; ya saludado, las opciones.
  if (hayQrAbierto) return salir(recordatorio(id));
  if (ficha.saludado) return salir(opcionesDe(ficha.usados, ''));
  return salir(saludo());
}

// 7. Texto (escrito o transcrito): los prellenados de la landing, la derivación, el resultado, los ángulos de anuncio, el precio y la conversación.
const pre = raPrellenado(norm);
if (pre === 'pack' || pre === 'libro') return salir(elegir(pre, ''));
if (pre === 'info') return salir(hayQrAbierto ? recordatorio('') : saludo());
if (pre === 'workbook' || pre === 'calendario_preguntas') {
  const productos = pre === 'workbook' ? ['workbook'] : ['calendario', 'preguntas'];
  if (hayQrAbierto) return salir(elegir(productos[0], ''));
  // Sin el precio del bono o sin botones que ofrecer, «¿con cuál prefieres avanzar?» no tendría opciones: se deriva a Antonio.
  const hayPrecio = productos.some((k) => raPrecio(cat, k) !== null);
  return salir(!hayPrecio || !raMenuDeBonos(productos, cat, ficha.usados).length ? sinOpciones('') : { tipo: 'complemento', productos: productos, cat: cat, conPresentacion: !ficha.saludado });
}
const derivacion = raDerivacion(norm, { comprobante: ficha.comprobanteMs > 0 || cobro.enRevision === true, qrAbierto: hayQrAbierto });
if (derivacion) return salir({ tipo: 'derivar', motivo: 'consulta', clave: derivacion.clave, aviso: avisoDeConsulta(derivacion.clave, derivacion.motivo), cat: cat });
// «Cancela mi pedido», «no quiero comprar», «ya no lo quiero» (con un QR abierto o un pedido hecho). «Solo quiero saber…» no cancela nada: es un cliente que mira (se le responde más abajo).
// CANCELAR POR CÓDIGO: (a) QR abierto de regla 2 que el servidor ve (`cobro.pendiente`) y SIN comprobante previo: plan `cancelar_cobro`; «Cancelar cobro en el servidor» reporta `cobro_cancelado` ANTES de armar el texto
// y «Armar mensajes» dice «cerré tu pedido» solo si el servidor respondió 200; si no, cae a la escalada de siempre (`aviso` de este plan). (c) Con comprobante previo (en revisión o ya cotejado) NO se cancela: se escala y se
// reporta `anulacion_avisada` (solo avisa). Una segunda cancelación seguida recibe «ya cerrado» (la firma del último plan), sin repetir nada.
const cancelacion = raCancelaPedido(norm);
if (cancelacion === 'cancela') {
  if (ficha.ultimaFirma === 'cobro_cerrado' || ficha.ultimaFirma === 'cobro_ya_cerrado') return salir({ tipo: 'cobro_ya_cerrado', aviso: null, cat: cat });
  const conComprobante = ficha.comprobanteMs > 0 || cobro.enRevision === true;
  if (hayQrAbierto || ficha.pedidos > 0 || conComprobante) {
    const escalada = avisoDeConsulta('cancelacion', 'quiere cancelar su pedido o ya no quiere comprar (el cobro no se pudo cerrar desde el asistente)');
    if (!conComprobante && cobro.pendiente === true && cobro.regla === 2) {
      return salir({ tipo: 'cancelar_cobro', aviso: escalada, avisoCerrado: { tipo: 'consulta', clave: 'cancelacion', motivo: 'cerró su pedido; si pagó, revisar', mensaje: '' }, cat: cat, liberaGuarda: true });
    }
    return salir(Object.assign({ tipo: 'derivar', motivo: 'cancelacion', clave: 'cancelacion', aviso: escalada, cat: cat, liberaGuarda: hayQrAbierto }, conComprobante ? { evento: 'anulacion_avisada' } : {}));
  }
}
if (raPreguntaPorResultado(norm)) return salir({ tipo: 'resultado', cat: cat, qrAbierto: hayQrAbierto });
// CON UN QR ABIERTO (PR-D, «como Rubén»): el recordatorio SOLO sale si el cliente habla de pagar («ya pagué», «cómo pago», «comprobante», «QR», «monto») o pide un producto (más abajo). Todo lo demás se responde
// (resultado, imágenes, catálogo, precio, o el modelo para una pregunta) sin botones de producto y SIN abrir otro QR (`qrAbierto: true`).
if (hayQrAbierto && raHablaDelCobro(norm)) return salir(recordatorio(''));
// «¿Tienes imágenes?»: respuesta fija, el flujo no envía imágenes del libro. Como PRIMER mensaje, el saludo.
if (raPideImagenes(norm)) return salir(!ficha.saludado ? saludo() : { tipo: 'imagenes', cat: cat, qrAbierto: hayQrAbierto });
// El catálogo completo con precio, por código (texto y audio transcrito). Como PRIMER mensaje, el saludo (ningún primer mensaje lleva montos). Sin ningún precio en el catálogo, Antonio.
if (raPideCatalogo(norm)) {
  if (!ficha.saludado) return salir(saludo());
  return salir(Object.keys(cat).length ? { tipo: 'catalogo', cat: cat, qrAbierto: hayQrAbierto } : sinOpciones(''));
}
// El ángulo del anuncio: por el texto escrito o por el texto leído de una captura (publicidad). El modelo redacta la apertura con el ángulo como dato; si falla, sale el texto fijo del ángulo.
const angulo = raAngulo(norm) || (esVisual ? raAngulo(raNorm(leido)) : '');
if (angulo && !hayQrAbierto) {
  return salir({ tipo: 'angulo', angulo: angulo, conPresentacion: !ficha.saludado, cat: cat, textoCliente: String(textoCliente || leido).slice(0, 500) }, {
    llamarModelo: true, cuerpoModelo: raCuerpoModelo(textoCliente || leido, ficha.hist, RA_ANGULOS[angulo].tema, base.temperatura, respuestaAPregunta),
  });
}
// Una pregunta de precio: el PRIMER mensaje recibe el saludo, SIN monto; ya saludado, el precio exacto sale POR CÓDIGO desde el catálogo, sin modelo, con el menú. Sin ningún precio en el catálogo se deriva a Antonio.
const precioPedido = raPreguntaPorPrecio(norm);
if (precioPedido) {
  if (!ficha.saludado) return salir(saludo());
  return salir(Object.keys(cat).length ? { tipo: 'precio', producto: precioPedido.producto, cat: cat, qrAbierto: hayQrAbierto } : sinOpciones(''));
}
// La confirmación en texto (o por voz) de UN producto: el QR con el monto del catálogo, como un botón.
const confirmado = raProductoConfirmado(norm);
if (confirmado) return salir(elegir(confirmado, ''));
if (raQuiereOpciones(norm)) return salir(hayQrAbierto ? recordatorio('') : (ficha.saludado ? opcionesDe(ficha.usados, '') : saludo()));
if (!ficha.saludado && raEsSoloSaludo(norm)) return salir(saludo());
// Después de un comprobante recibido, hablar de pago, libro, material o entrega NO es una charla libre (y esto va DESPUÉS de las preguntas de precio, la confirmación de un producto y «cómo pago», que son una compra nueva): el modelo no habla del estado de un pago ni de una entrega. Va la derivación de no entrega
// (texto fijo con el plazo del dato, aviso y botón).
if (ficha.comprobanteMs > 0 && (raHablaDePagar(norm) || /\b(pago|pague|pagado|pagaste|comprobante|transferencia|deposito|material|llega\w*|llego|enviar\w*|enviaron|mandar\w*|mandaron|recib\w*|entrega\w*)\b/.test(norm) || (/\blibro\b/.test(norm) && /\b(cuando|donde|llega\w*|llego|envi\w*|mand\w*|recib\w*)\b/.test(norm)))) {
  return salir({ tipo: 'derivar', motivo: 'consulta', clave: 'no_entrega', aviso: avisoDeConsulta('no_entrega', 'queja de no entrega: el cliente pregunta por su pago o por el material'), cat: cat });
}
// Una nota de voz corta o ininteligible (menos de 3 palabras o sin letras que valgan) que el código no atendió arriba (ni siquiera la derivación de no entrega tras un comprobante, que va antes): se pide repetirla
// con un texto fijo; el modelo no inventa una respuesta.
if (esAudio && raAudioIlegible(norm)) return salir({ tipo: 'audio_fijo', causa: 'corto', cat: cat });
// Con un QR abierto, lo que queda: pedir un producto (recordatorio), una pregunta (el modelo, sin botones de producto ni otro QR) o cualquier otra cosa (recordatorio).
if (hayQrAbierto) {
  if (raPideProducto(norm) || !raEsPreguntaLibre(textoCliente, norm)) return salir(recordatorio(''));
  return salir({ tipo: 'modelo', cat: cat, qrAbierto: true, textoCliente: String(textoCliente).slice(0, 500) }, {
    llamarModelo: true, cuerpoModelo: raCuerpoModelo(textoCliente, ficha.hist, '', base.temperatura, respuestaAPregunta),
  });
}
// EL PRIMER TURNO de un teléfono (PR-D, [B]): el saludo fijo por código —la presentación una sola vez y la pregunta abierta, sin montos—; el modelo no abre la conversación. Lo que dijo queda en la memoria
// de la charla (el plan `saludo` la guarda), así que el modelo lo lee en la respuesta siguiente.
if (!ficha.saludado) return salir(saludo());
const paraElModelo = esVisual ? 'El cliente envió la captura de un anuncio. Texto leído: ' + leido : textoCliente;
return salir({ tipo: 'modelo', cat: cat, textoCliente: String(paraElModelo).slice(0, 500) }, {
  llamarModelo: true, cuerpoModelo: raCuerpoModelo(paraElModelo, ficha.hist, '', base.temperatura, respuestaAPregunta),
});
