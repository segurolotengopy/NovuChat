// DECIDIR TURNO: el CÓDIGO decide qué pasa en este turno; el modelo solo conversa. Devuelve un `plan` (nada de texto libre del modelo sale de aquí):
//
//   nada           la puerta cerró el turno (suspendido, uso extendido, pausa por persona): no se hace nada más;
//   fuera_pais     un número no boliviano: el texto fijo con el botón de Rubén, sin QR (a lo más una vez en 24 horas: lo exige «Normalizar entrada»);
//   riesgo         crisis emocional (raíces sobre texto, transcripción o texto leído de una imagen; o la marca del modelo en «Armar mensajes»): corta la venta (texto cálido con el botón de Rubén y su aviso, sin QR ni precios);
//   saludo         la presentación (UNA vez por teléfono, «asistente virtual de <el negocio de la Consola>») y la pregunta de apertura, sin montos. EL PRIMER TURNO de un teléfono es SIEMPRE este saludo fijo, por código, salvo que el mensaje traiga una intención que el código
//                  atiende (prellenado, ángulo de anuncio, derivación, precio de UN producto, producto confirmado): el modelo no abre la conversación. `pideOpciones`: pidió precios, catálogo u opciones antes de tiempo;
//   angulo         una entrada por un anuncio: el modelo redacta la apertura con el ángulo como dato (o el texto fijo del ángulo);
//   menu           las opciones principales (Pack, Libro, «Solo audios») con sus precios;   audios   Audiolibro, Meditaciones y «Mejor el Pack»;   precio   «¿cuánto cuesta…?» por código (`temprano`: el precio de UN producto antes de la charla);
//   opciones_codigo  el bloque de las opciones (texto fijo con el ahorro calculado + el menú): un «sí» a «¿Te muestro las opciones?» o el botón «Ver opciones»;
//   qr             el QR con el monto del CATÁLOGO (prellenados de Pack y Libro, o un botón o una fila de producto);
//   qr_pendiente   ya hay un QR abierto Y el cliente habla de pagar o pide un producto: el recordatorio (un solo QR a la vez, un pedido = un producto). Ya no se escala a Rubén por insistir: el recordatorio tiene dos formas y nunca sale idéntico dos veces seguidas.
//                  Cualquier otra pregunta con un QR abierto se RESPONDE (precio, catálogo, imágenes, resultado o el modelo) SIN botones de producto y SIN abrir otro QR (`qrAbierto: true`, con `qrProducto` y `qrMonto` para la invitación a pagar que «Armar mensajes» agrega al final);
//   catalogo       «qué vendes», «catálogo», «lista», «opciones»: los productos con precio leídos del catálogo de la consola, por código;   imagenes   «¿tienes imágenes?»: texto fijo, el flujo no envía imágenes;   contenido   «¿qué incluye el pack/libro/audiolibro/meditaciones?»: el contenido del producto, por código;
//   cancelar_cobro «cancela ese qr» con un QR abierto y sin comprobante: el servidor cierra el cobro (llamada síncrona) y sale `cobro_cerrado`; si el servidor no responde 200, sale la derivación `cancelacion`;   cobro_ya_cerrado   la segunda cancelación seguida;
//   comprobante    el resultado del cotejo traducido por `cbResultadoVenta`;
//   derivar        pasa a Rubén (lista cerrada de `rrDerivacion`: devolución (no hay garantía), reclamo, volumen o reventa, otro medio de pago, el material que no abre, pregunta médica, una persona; producto agotado; sin QR utilizable; «cancela mi pedido» con un QR abierto: `cancelacion`; SIN CONFIGURACIÓN del negocio: `sin_configuracion`): aviso + botón;
//   resultado      «¿me garantizan que voy a dormir?»: frase fija, sin promesa de resultado;
//   baja           «no me escribas más»: texto fijo de confirmación, sin modelo, sin invitación a pagar, sin botones y sin aviso (el `no_contactar` viaja con el entrante);
//   modelo         una conversación libre: llama al modelo (memoria de 15 mensajes) con un `modo` (`charla` | `antes` | `puente` | `opciones`) que viaja como línea del sistema (`[MODO_TURNO: …]`);
//   imagen_otra, audio_fijo, otro   respuestas fijas a lo que no es un comprobante ni texto. `audio_fijo` también cubre una nota de voz CORTA o ininteligible (menos de 3 palabras): se pide repetirla; el modelo nunca la contesta.
//
// LA COMPUERTA DE LAS OPCIONES: antes de mostrar un precio general, el catálogo o el menú hay dos mensajes de conversación (`vdHabilitado`: `charlaN >= 2`; el saludo cuenta como uno) o una excepción (QR abierto, producto, pedidos, comprobante, cobro
// en revisión). Lo calcula UNA sola vez este nodo y lo publica como `opcionesHabilitadas`; «Armar mensajes» solo lo lee. La excepción es el precio de UN producto nombrado, que se dice por código ya. Los prellenados, los productos confirmados,
// los comprobantes y los botones de producto no pasan por la compuerta.
//
// EL MONTO NUNCA SALE DEL CLIENTE NI DEL MODELO: es el precio del catálogo del producto (`rrPrecio`). Un producto que no sea uno de los 4 (o el paso del Libro al Pack), o que esté agotado, no genera QR. Un botón es un botón solo si llegó
// como `interactive` (un texto que diga «b_pack» no lo es). Si hay un QR abierto lo dice el SERVIDOR (`cobro.pendiente`); `ficha.qrHastaMs` evita abrir dos seguidos mientras la consola se entera.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const base = cnPrimero('Config base') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
let textoDelTurno = '';   // lo que escribió (o dijo) el cliente en este turno: «Armar mensajes» lo guarda en la memoria de la charla
let habilitado = false;   // la compuerta de las opciones; se calcula más abajo (necesita la ficha y el cobro) y antes de eso vale false
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, textoCliente: textoDelTurno, llamarModelo: false, cuerpoModelo: null, modelo: rrModeloValido(base.modelo), opcionesHabilitadas: habilitado }, extra || {}) }];
const panel = rrPanelDe(cnPrimero('Traer configuración'));
const cat = rrCatalogo(panel.cuerpo);
// Los NOMBRES del catálogo de la Consola: los motivos de los avisos a Rubén nombran el producto como lo escribió el comercio.
const nom = rrNombres(panel.cuerpo);
const agotados = rrAgotados(panel.cuerpo);
const cobro = rrCobro(panel);
const ficha = rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);

// 0. LA PROTECCIÓN ANTE UNA CRISIS EMOCIONAL VA PRIMERO, también con la puerta cerrada y fuera del país: si el comercio está suspendido, el estado es «operador» (el cliente sí recibe un mensaje) o el número no es
//    boliviano, un texto de riesgo recibe el texto de protección y reporta `no_contactar`, nunca el texto neutro, el aviso de uso extendido ni el de «pago con QR boliviano». La pausa por persona («bloqueado»)
//    sigue en silencio: ahí responde Rubén. Aquí solo se mira el texto y el pie (los medios no se bajan con la puerta cerrada ni fuera del país).
// El aviso de una crisis NUNCA copia lo que escribió la persona: solo el motivo.
const avisoCrisis = { tipo: 'consulta', clave: 'crisis', motivo: 'posible crisis o riesgo emocional de la persona (se cortó la venta y se le sugirió ayuda profesional)', mensaje: '' };
const senalEscrita = rrEsCrisis(rrNorm([t.texto, t.pie].join(' '))) || (ficha.riesgo && t.tipo !== 'interactive' && String(t.texto || '').trim() !== '' && !rrEsNeutro(rrNorm(t.texto), t.texto));   // ESTE turno trae una señal de crisis (renueva el plazo de 48 h de `ficha.riesgoMs`; escribir otra cosa no lo renueva)
const riesgoEscrito = ficha.riesgo || senalEscrita;
const puertaResponde = puerta.ruta === 'sigue' || puerta.ruta === 'suspendido' || (puerta.ruta === 'uso_extendido' && puerta.responder === true);
if (puertaResponde && puerta.ruta !== 'sigue' && riesgoEscrito) return salir({ tipo: 'riesgo', aviso: avisoCrisis, cat: cat, senal: senalEscrita });
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });

// 0b. Un número no boliviano: el texto fijo y el botón de Rubén. Nada de modelo, de medios ni de QR.
if (t.fueraDePais === true) return salir(riesgoEscrito ? { tipo: 'riesgo', aviso: avisoCrisis, cat: cat, senal: senalEscrita } : { tipo: 'fuera_pais', cat: cat });

// El medio de este turno (solo uno de estos nodos corrió) y lo que se leyó en él.
const prep = cnPrimero('Preparar imagen') || cnPrimero('Preparar transcripción') || cnPrimero('Medio no aceptado') || {};
const entradaMedio = String(prep.userInput || '');
const esAudio = t.esMedioAudio === true;
const esVisual = t.esMedioVisual === true;
const categoriaMedio = String(prep.categoriaMedio || '');
// El texto leído en la imagen es un DATO del cliente: solo sirve para reconocer el ángulo del anuncio y para detectar riesgo; nunca llega al modelo como instrucción.
const jsonImagen = esVisual ? (cnJsonDeGemini(cnPrimero('Describir documento') || cnPrimero('Describir imagen')) || {}) : {};
const leido = esVisual && typeof jsonImagen.texto === 'string' ? rrLineaCliente(jsonImagen.texto, 500) : '';
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
const norm = rrNorm(textoCliente);
textoDelTurno = rrLineaCliente(textoCliente, 300).replace(/\s+/g, ' ').trim();
// Un «Sí» o un «No» suelto con una pregunta nuestra vigente (30 min) se resuelve con la pregunta pendiente que guardó la ficha (`ctInterpretarSiNo`, core): si es una pregunta que el código hizo con su intención (`ver_opciones`), el código
// responde; si no, el modelo recibe la pregunta como dato y qué hacer con ella. Sin pregunta vigente, nada. Nunca abre un QR por sí solo.
const siNo = !esVisual && t.tipo !== 'interactive' ? ctInterpretarSiNo(textoCliente, ficha, ahora, { usados: ficha.usados, intenciones: RR_INTENCIONES, vigenciaMs: RR_VENTANA_PREGUNTA_MS }) : null;
const respuestaAPregunta = siNo && (siNo.estado === 'resuelta' || siNo.estado === 'ambigua') ? siNo : null;

// El aviso de consulta a Rubén lleva el MOTIVO exacto (`clave` + `motivo`). El límite (a lo más UN aviso cada 30 minutos por teléfono Y por motivo) lo aplica «Armar avisos», que ve la ficha.
// En `sin_configuracion` y `qr_no_disponible` el texto del cliente NO viaja en el aviso (no hace falta para atender el motivo).
const sinTexto = (clave) => clave === 'sin_configuracion' || clave === 'qr_no_disponible';
const avisoDeConsulta = (clave, motivo) => ({ tipo: 'consulta', clave: clave, motivo: motivo, mensaje: t.tipo === 'interactive' || sinTexto(clave) ? '' : String(textoCliente || leido).slice(0, 200) });
// EL RECORDATORIO DEL QR ABIERTO (solo si el cliente habla de pagar o pide un producto). Ya NO se escala a Rubén por insistir: «Armar mensajes» alterna dos formas para no repetir el mismo texto dos veces seguidas.
const recordatorio = (boton) => ({ tipo: 'qr_pendiente', producto: producto, monto: cobro.monto, cat: cat, boton: boton || '' });
const sinOpciones = (boton) => ({ tipo: 'derivar', motivo: 'sin_opciones', aviso: avisoDeConsulta('qr_no_disponible', 'sin opciones de compra disponibles'), cat: cat, boton: boton });
const hayQrAbierto = cobro.pendiente === true || ficha.qrHastaMs > ahora;
// Con un QR abierto toda respuesta se da sin botones de producto, sin abrir otro QR y con la invitación a pagar el QR pendiente (el producto y el monto son del código).
// (Si el servidor no dice el monto, es el del catálogo del producto del pedido: un QR de Rubén siempre se abre por el precio del catálogo.)
const abierto = () => (hayQrAbierto ? { qrAbierto: true, qrProducto: producto, qrMonto: cobro.monto !== null ? cobro.monto : rrPrecio(cat, producto) } : {});
const hayCobro = cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null);
const producto = ficha.producto || '';
// La compuerta de las opciones (`vdHabilitado`, base común): dos mensajes de conversación o una excepción declarada.
habilitado = vdHabilitado({ charlaN: ficha.charlaN, qrAbierto: hayQrAbierto, producto: ficha.producto, pedidos: ficha.pedidos, comprobanteMs: ficha.comprobanteMs, enRevision: cobro.enRevision === true });
const nombreProducto = producto && RR_PRODUCTOS[producto] ? rrTitulo(nom, producto) : 'sin producto';

// El resultado del cotejo (si corrió) como plan de comprobante. Solo corrió si la imagen era un comprobante y había un cobro real; si no, «cbResultadoVenta» lo deja en «sin cotejar» con aviso y botón: nunca «cuadra».
const planComprobante = () => {
  const resp = cnNodo('Cotejar en el servidor') ? cnPrimero('Cotejar en el servidor') : null;
  const r = cbResultadoVenta(resp);
  const avisa = r.resultado === 'cuadra' || r.resultado === 'aproximado' || r.resultado === 'sin_cotejo';
  const motivoSrv = cbCuerpoDe(resp).cuerpo.motivo;
  const motivoAviso = r.resultado === 'aproximado' ? rrMotivoComprobante('aproximado', motivoSrv) : (r.resultado === 'sin_cotejo' ? rrMotivoComprobante(r.causa, motivoSrv) : '');
  return {
    tipo: 'comprobante', resultado: r.resultado, causa: r.resultado === 'aproximado' && motivoSrv === 'monto_distinto' ? 'monto_distinto' : r.causa, diferencia: r.resultado === 'reintentar' ? cdDiferenciaParaElTexto(cbCuerpoDe(resp).cuerpo, r, 'Bs') : '', cat: cat, producto: producto,
    aviso: avisa ? { tipo: 'comprobante', resultado: r.resultado, producto: nombreProducto, monto: cobro.monto, motivo: motivoAviso, clave: r.resultado === 'sin_cotejo' && !r.causa ? 'comprobante_sin_cotejo' : '' } : null,
  };
};

// 1. VIOLENCIA O MIEDO: antes que cualquier otra cosa (corta la venta). Se mira el texto, la transcripción, el texto leído de la imagen y el pie de foto; una vez activada, sigue activa 48 horas. El turno que trae
//    un COMPROBANTE (imagen o PDF) sigue su camino normal del cobro (cotejo y aviso a Rubén), salvo que su PIE DE FOTO hable de una crisis (arriba). Sin consejos.
const senalDelTurno = rrEsCrisis(rrNorm([textoCliente, leido, t.pie].join(' '))) || (ficha.riesgo && t.tipo !== 'interactive' && textoCliente.trim() !== '' && !rrEsNeutro(norm, textoCliente));
// El PIE DE FOTO de un comprobante que habla de una crisis (LOW de seguridad del PR-1): responde la protección (texto, botón, aviso y `no_contactar`) y renueva el plazo; un pie sin crisis no corta el cotejo.
if (esVisual && categoriaMedio === 'comprobante' && rrEsCrisis(rrNorm(t.pie))) return salir({ tipo: 'riesgo', aviso: avisoCrisis, cat: cat, nuevo: ficha.riesgo !== true, senal: true });
if (!(esVisual && categoriaMedio === 'comprobante') && (ficha.riesgo || senalDelTurno)) {
  // `nuevo`: el riesgo se activa AHORA (no lo traía la ficha) y no lo dijo el texto escrito: «¿Avisar al servidor?» reporta `no_contactar` una sola vez, antes de armar el mensaje (un audio, una imagen o el pie ya viajan por su vía).
  return salir({ tipo: 'riesgo', aviso: avisoCrisis, cat: cat, nuevo: ficha.riesgo !== true, senal: senalDelTurno });
}

// 1a. UN PEDIDO DE BAJA («no me escribas más», «ya no me escriban», «no me escribás»), con o sin QR abierto: un texto fijo corto de confirmación y NADA más —ni el modelo, ni la invitación a pagar, ni botones de producto, ni aviso a Rubén—.
//     El `no_contactar` ya viaja con el reporte del entrante. El QR abierto queda como está (no se cancela solo). Va justo después de la protección y ANTES de la configuración, los medios, los botones y el cobro con el QR abierto: quien pidió la baja no recibe nada más.
if (rrPideBaja(textoCliente)) return salir({ tipo: 'baja', cat: cat });

// 1a-gmail. EL GMAIL TRAS UNA VENTA CONFIRMADA: si el flujo ya se lo pidió a este teléfono (`gmailPedidoMs`) y aún no lo tiene (`gmail`), un TEXTO ESCRITO con una «@» es su respuesta. Lo lee el CÓDIGO sobre el texto literal del cliente
//     (`vgExtraerGmail`); el modelo no interviene, no ve el correo y el turno no entra en la memoria de la charla. Solo `@gmail.com`: otro dominio, varios correos o un correo mal escrito reciben un texto fijo que lo pide de nuevo. Un audio, una imagen o un botón
//     nunca se capturan (el correo no se acepta dictado ni leído de una imagen). Va antes de la identidad y de las derivaciones para que un correo escrito no se tome por otra intención. Con un correo válido hay UN aviso a Rubén (enlace de Drive por el chat).
if (t.tipo === 'text' && ficha.gmailPedidoMs > 0 && ficha.gmail === '' && String(t.texto || '').indexOf('@') >= 0) {
  const g = vgExtraerGmail(String(t.texto || ''));
  textoDelTurno = '';
  return salir({
    tipo: 'gmail', resultado: g.resultado, correo: g.resultado === 'recibido' ? g.correo : '', cat: cat,
    aviso: g.resultado === 'recibido' ? { tipo: 'consulta', clave: 'gmail', motivo: 'venta con comprobante: enviar el enlace de Drive por el chat', mensaje: '', correo: g.correo, producto: nombreProducto } : null,
  });
}

// 1a'. IDENTIDAD POR CÓDIGO (prohibición 4): «¿eres un bot?», «¿quién eres?», «¿hablo con Rubén?»… reciben una frase fija que reconoce ser un asistente virtual con IA; el modelo no interviene. Va antes de la configuración, la compuerta de
//      las opciones, el precio y el modelo, y también con un QR abierto (esa respuesta no abre otro QR, no deriva y no avisa a Rubén). Solo texto escrito o transcrito: un toque de botón o una imagen no son esta pregunta.
//      SOLO si el mensaje no trae OTRA intención reconocida (cancelar, pedir un producto, hablar del pago o del comprobante, pedir una persona): «cancela mi pedido, eres un robot» o «quiero el pack, ¿eres un bot?» siguen su camino
//      —esa intención gana— y el modelo no recibe la pregunta como instrucción. La pregunta sola, con o sin QR abierto, la contesta el código.
if (!esVisual && t.tipo !== 'interactive' && (rrPreguntaPorIA(norm) || rrPreguntaPorIAPlegada(textoCliente))
  && !(rrCancelaPedido(norm) || rrPideProducto(norm) || rrHablaDePagar(norm) || rrHablaDelCobro(norm) || rrPrellenado(norm) !== '' || rrDerivacion(norm, { comprobante: ficha.comprobanteMs > 0 || cobro.enRevision === true, qrAbierto: hayQrAbierto }))) return salir({ tipo: 'identidad', cat: cat });

// 1b. Lo que no necesita la configuración del negocio: una nota de voz que no se pudo usar (o que es corta o ininteligible: se pide repetirla, nunca la contesta el modelo) y lo que este canal no lee.
//     (La nota de voz corta con una intención clara —«hola», «quiero el pack»— no llega aquí: la atiende el código más abajo.)
if (esAudio && falloAudio) return salir({ tipo: 'audio_fijo', causa: falloAudio, cat: cat });
if (t.categoria === 'otro') return salir({ tipo: 'otro', cat: cat });
// 1c. SIN CONFIGURACIÓN (PR-D, orden de Andres): si «Traer configuración» falló o no trae catálogo, cobro ni venta, el flujo NO improvisa (ni el modelo, ni «no puedo mostrarte el QR» como si solo faltara el QR, ni precios):
//     texto honesto, aviso a Rubén y botón. El comprobante de una imagen tampoco se coteja a ciegas.
if (rrSinConfiguracion(panel)) {
  // Con una imagen o un PDF el aviso dice que pudo ser un comprobante, sin copiar texto del cliente.
  const aviso = esVisual
    ? { tipo: 'consulta', clave: 'sin_configuracion', motivo: 'envió una imagen (posible comprobante) mientras la configuración no estaba disponible', mensaje: '' }
    : avisoDeConsulta('sin_configuracion', 'el asistente no pudo leer la configuración del negocio (catálogo, cobro o venta)');
  return salir({ tipo: 'derivar', motivo: 'sin_configuracion', clave: 'sin_configuracion', aviso: aviso, cat: cat });
}

// 2. Una imagen o un documento.
if (esVisual) {
  if (cnNodo('Medio no aceptado')) {
    // Demasiado pesado o ilegible: con un cobro real abierto probablemente sea el comprobante, y entonces va a Rubén sin cotejar; si no, se pide uno más liviano.
    if (hayCobro) return salir(Object.assign(planComprobante(), { resultado: 'sin_cotejo', causa: '', aviso: { tipo: 'comprobante', resultado: 'sin_cotejo', producto: nombreProducto, monto: cobro.monto, motivo: rrMotivoComprobante('', ''), clave: 'comprobante_sin_cotejo' } }));
    return salir({ tipo: 'archivo', pesado: /demasiado pesado/.test(entradaMedio), cat: cat });
  }
  if (categoriaMedio === 'comprobante') {
    if (cnNodo('Cotejar en el servidor')) return salir(planComprobante());
    // Un comprobante sin cobro abierto: no se coteja nada; lo ve Rubén.
    return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cobro', clave: 'comprobante_sin_cobro', aviso: avisoDeConsulta('comprobante_sin_cobro', 'recibió una imagen que parece un comprobante, pero no hay un QR abierto'), cat: cat });
  }
  // La captura de un pago rechazado, pendiente o con error: nunca se coteja ni se afirma qué pasó con el dinero. Lo ve Rubén: aviso con ese motivo (a lo más uno cada 30 minutos por teléfono) y el botón.
  if (categoriaMedio === 'pago_con_problema') {
    return salir({ tipo: 'derivar', motivo: 'pago_con_problema', clave: 'pago_con_problema', aviso: { tipo: 'consulta', clave: 'pago_con_problema', motivo: 'envió la captura de un pago que parece no haberse completado', mensaje: '' }, cat: cat });
  }
  // UNA IMAGEN DE CAMPAÑA RECONOCIDA POR SU TITULAR (punto 9 de la lista aprobada): «Preparar imagen» comparó el titular principal que leyó el clasificador con los `anuncios` de la Consola y, SOLO si coincide, deja `anuncioMedio` (el id del anuncio). Aquí el código
  // responde con SU producto, por código y SIN compuerta (el cliente ya mostró de qué anuncio viene): el precio es el del catálogo de la Consola (nunca el de la imagen ni uno inventado); si el anuncio no tiene producto (o es uno que este flujo no vende, o no tiene
  // precio) no se inventa ninguno: la conversación sigue con el ángulo del anuncio como dato; si el producto figura agotado, Rubén con aviso y botón. Un titular que no es de los anuncios no llega aquí (`anuncioMedio` vacío).
  const idAnuncio = categoriaMedio === 'publicidad' ? String(prep.anuncioMedio || '') : '';
  const anuncio = idAnuncio !== '' && Array.isArray(cfg.anuncios) ? cfg.anuncios.find((a) => a && a.id === idAnuncio) || null : null;
  if (anuncio) {
    const prodAnuncio = anuncio.producto && typeof anuncio.producto === 'object' ? anuncio.producto : null;
    const k = prodAnuncio ? Object.keys(RR_PRODUCTOS).find((x) => RR_PRODUCTOS[x].catId === prodAnuncio.id) : undefined;
    textoDelTurno = rrLineaCliente('Imagen del anuncio «' + String(anuncio.titulares && anuncio.titulares[0] || '').replace(/[«»\[\]]/g, ' ') + '»', 300).replace(/\s+/g, ' ').trim();
    if (k && (agotados.indexOf(k) >= 0 || (prodAnuncio && prodAnuncio.agotado === true))) return salir({ tipo: 'derivar', motivo: 'agotado', aviso: avisoDeConsulta('producto_agotado', 'preguntó por un anuncio de ' + rrTitulo(nom, k) + ', que figura como agotado'), cat: cat, anuncio: idAnuncio });
    if (k && rrPrecio(cat, k) !== null) return salir(Object.assign({ tipo: 'precio', producto: k, cat: cat, conPresentacion: !ficha.saludado, temprano: !habilitado, anuncio: idAnuncio }, abierto()));
    // Sin producto con precio: nada de montos; el ángulo del anuncio (dato aprobado por el negocio) abre la conversación. CASO (a) del PDF (PR-2): como PRIMER mensaje, una captura de anuncio SIN texto abre con SU ángulo —la presentación,
    // una vez, y la apertura que redacta el modelo con el ángulo como dato—, no con el saludo genérico. Si el modelo falla, cae al saludo fijo (`angulo_fijo`). Un anuncio sin ángulo (dato vacío) sí recibe el saludo fijo.
    if (!ficha.saludado) {
      if (String(anuncio.angulo || '').trim() === '') return salir({ tipo: 'saludo', cat: cat, boton: '', anuncio: idAnuncio });
      return salir(Object.assign({ tipo: 'angulo', angulo: '', conPresentacion: true, cat: cat, anuncio: idAnuncio, textoCliente: textoDelTurno }, abierto()), {
        llamarModelo: true, cuerpoModelo: rrCuerpoModelo(textoDelTurno, ficha.hist, String(anuncio.angulo), base.temperatura, null, 'charla', cfg.nombreNegocio),
      });
    }
    return salir(Object.assign({ tipo: 'modelo', cat: cat, modo: 'charla', anuncio: idAnuncio, textoCliente: textoDelTurno }, abierto()), {
      llamarModelo: true, cuerpoModelo: rrCuerpoModelo(textoDelTurno, ficha.hist, String(anuncio.angulo || anuncio.titulares && anuncio.titulares[0] || ''), base.temperatura, null, 'charla', cfg.nombreNegocio),
    });
  }
  // Foto, captura de pantalla, «otro» (y la categoría inventada, que ya cayó en «otro») y una publicidad cuyo ángulo no se reconoce: el asistente dice lo que ve (descripción ya saneada por «Preparar imagen»; en una publicidad,
  // una frase fija del código) y ofrece el libro y los precios. Una publicidad con ángulo conocido sigue más abajo (apertura del ángulo).
  if (categoriaMedio !== 'publicidad' || rrAngulo(rrNorm(leido)) === '') {
    // Segunda barrera sobre la descripción: si traía un enlace, un correo, una cifra larga, un dominio o un delimitador, el módulo común lo quitó y quedaría una frase mutilada («Veo escribe a»): se descarta ENTERA.
    const cruda = String(jsonImagen.descripcion || '');
    const mutilada = /https?:|www\.|@|\d[\d\s.\-\/,]{3,}\d|\b\S+\.(?:com|net|org|bo|io|app|me|link|ly)\b|[\[\]{}<>«»"'`*_\\|#]/i.test(cruda);
    // Tercera barrera (revisión de seguridad de #602): la descripción se muestra tal cual al cliente, así que NO puede prometer ni afirmar nada (reembolso, devolución, descuento, regalo, dinero), ni afirmar un pago (`CB_PROHIBIDAS`), ni negar ser una IA.
    // Se mira la cruda y la saneada. No se descarta por «ruben» ni por «pago» a secas: el logo del comercio y «pago no se completó» siguen funcionando.
    const prometedora = [cruda, String(prep.descripcionMedio || '')].some((x) => {
      const n = rrNorm(x);
      return /reembols|devol|devuelt|reintegr|anulad|rechazad|gratis|gratuit|descuent|promet|promoci|oferta|garant|regal|dinero|plata/.test(n) || CB_PROHIBIDAS.test(cbCanon(x)) || RR_NIEGA_IA.test(n);
    });
    // Una publicidad que NO es de los anuncios de la Consola no se nombra «imagen publicitaria» (ronda 2: una foto, una captura de la web y un PDF salían así): sin descripción, el texto neutro «Recibí tu imagen/archivo».
    const descripcion = categoriaMedio === 'publicidad' ? '' : (mutilada || prometedora ? '' : String(prep.descripcionMedio || ''));
    return salir({ tipo: 'imagen_descrita', documento: t.esDocumento === true, descripcion: descripcion, cat: cat });
  }
  // Una captura de anuncio: se reconoce el ángulo por el texto leído; sin ángulo, se sigue como una charla.
}

// 5. Elegir un producto: el QR con el monto del catálogo. Devuelve el plan.
const elegir = (k, boton) => {
  if (hayQrAbierto) return recordatorio(boton);
  if (cobro.enRevision === true) return { tipo: 'derivar', motivo: 'en_revision', aviso: null, cat: cat, boton: boton };
  const precio = rrPrecio(cat, k);
  const agotado = agotados.indexOf(k) >= 0;
  const sinQr = precio === null ? (agotado ? 'agotado' : 'sin_precio') : (cobro.modo === 'ninguno' ? 'sin_cobro' : (cobro.mediaId === '' ? 'sin_medio' : ''));
  if (sinQr === 'agotado') return { tipo: 'derivar', motivo: 'agotado', aviso: avisoDeConsulta('producto_agotado', 'pidió ' + rrTitulo(nom, k) + ', que figura como agotado'), cat: cat, boton: boton };
  if (sinQr) return { tipo: 'derivar', motivo: sinQr, aviso: avisoDeConsulta('qr_no_disponible', 'QR no disponible (' + sinQr + ')'), cat: cat, boton: boton };
  return { tipo: 'qr', producto: k, monto: precio, mediaId: cobro.mediaId, pedidoId: rrIdPedido(ahora, ficha.pedidos + 1), conPresentacion: !ficha.saludado, cat: cat, boton: boton };
};
// Las opciones principales: el menú si queda algún botón; si no, «Solo audios»; si ninguna, Rubén (nunca «¿cuál prefieres?» sin opciones).
const opcionesDe = (usados, boton) => (rrMenu(cat, usados).length ? { tipo: 'menu', cat: cat, boton: boton } : (rrMenuDeAudios(cat, usados).length ? { tipo: 'audios', cat: cat, boton: boton } : sinOpciones(boton)));
const saludo = (boton, extra) => Object.assign({ tipo: 'saludo', cat: cat, boton: boton || '' }, extra || {});

// El plan del modelo para el turno: el cuerpo lleva el `modo` (línea del sistema fuera de <<< >>>). `extra`: campos del plan (`pideOpciones`, `angulo`…). `tema`: el ángulo del anuncio. `paraElModelo`: lo que el modelo lee como mensaje del cliente.
// Con un QR abierto el plan lleva `qrAbierto` (sin botones de producto, con la invitación a pagar).
const modeloDelTurno = (modo, extra, tema, paraElModelo) => {
  const para = paraElModelo === undefined ? textoCliente : paraElModelo;
  return salir(Object.assign({ tipo: 'modelo', cat: cat, modo: modo, textoCliente: String(para).slice(0, 500) }, abierto(), extra || {}), {
    llamarModelo: true, cuerpoModelo: rrCuerpoModelo(para, ficha.hist, tema || '', base.temperatura, respuestaAPregunta, modo, cfg.nombreNegocio),
  });
};
// LA COMPUERTA: el cliente pidió precios, el catálogo, un menú o pagar y todavía no hay dos mensajes de conversación. Sin saludar: el saludo (sin montos), que recuerda que pidió opciones. Con UN mensaje de conversación: el puente (el modelo con el modo
// `puente`, o su texto fijo con «¿Te muestro las opciones?» y el botón «Ver opciones»). Sin ninguno (se identificó o derivó primero): una charla antes de las opciones. En los tres casos `pideOpciones` deja la marca en la ficha.
const pedirOpciones = (rotuloDelToque) => (!ficha.saludado
  ? salir(saludo('', { pideOpciones: true }))
  : modeloDelTurno(ficha.charlaN === 1 ? 'puente' : 'antes', { pideOpciones: true }, '', rotuloDelToque));

// 6. Un toque de botón o de fila (solo si llegó como interactivo y es uno de los nuestros).
if (t.tipo === 'interactive') {
  const id = String(t.seleccionId || '');
  const k = rrProductoDeBoton(id);
  // EL PASO DEL LIBRO AL PACK solo existe como un botón que ofreció el código, UNA vez (`ficha.upgrade === 1`), tras una compra del Libro con comprobante, y solo con los dos precios en el catálogo.
  // Cualquier otro toque de `b_upgrade` (un chat viejo, una ficha olvidada, una segunda vez) cae en «un botón que ya no está disponible».
  const upgradeValido = ficha.upgrade === 1 && ficha.producto === 'libro' && ficha.comprobanteMs > 0 && rrPrecio(cat, 'upgrade') !== null;
  if (k && (k !== 'upgrade' || upgradeValido)) return salir(elegir(k, id));
  if (id === RR_BOTON_AUDIOS) {
    if (hayQrAbierto) return salir(recordatorio(id));
    if (!habilitado) return pedirOpciones('(El cliente tocó el botón «' + RR_ETIQUETA_AUDIOS + '»)');
    if (!ficha.saludado) return salir(saludo(id));
    return salir(rrMenuDeAudios(cat, ficha.usados.concat([id])).length ? { tipo: 'audios', cat: cat, boton: RR_BOTON_AUDIOS } : sinOpciones(id));
  }
  // «Ver opciones» (el botón del puente): contesta nuestra pregunta «¿Te muestro las opciones?», así que las opciones salen por código aunque la charla no llegara a dos mensajes; con un QR abierto, el recordatorio.
  if (id === RR_BOTON_OPCIONES) {
    if (hayQrAbierto) return salir(recordatorio(id));
    if (!ficha.saludado) return salir(saludo());
    return salir(rrMenu(cat, ficha.usados).length ? { tipo: 'opciones_codigo', cat: cat, boton: id } : sinOpciones(id));
  }
  // Un toque que no es de este flujo (un botón viejo, una lista de otro mensaje): nunca se toma por una conversación libre. Con un QR abierto, el recordatorio del QR; sin las opciones habilitadas, la compuerta; ya saludado, las opciones.
  if (hayQrAbierto) return salir(recordatorio(id));
  if (!habilitado) return pedirOpciones('(El cliente tocó un botón que ya no está disponible)');
  if (ficha.saludado) return salir(opcionesDe(ficha.usados, ''));
  return salir(saludo());
}

// 7. Texto (escrito o transcrito): los prellenados de la landing, la derivación, la cancelación, el «Sí»/«No», el ángulo de anuncio, el precio y la conversación.
const pre = rrPrellenado(norm);
if (pre !== '') return salir(elegir(pre, ''));
// ORIGEN «landing»: quien llega de la landing manda la frase de entrada del tenant (`landingFrase`, igualdad de palabras: ver `rrEsEntradaLanding`). Como PRIMER mensaje y sin QR abierto: el saludo fijo (presentación una vez, la pregunta de siempre, sin montos).
// Ya saludado o con un QR abierto no hace nada especial (no repite la presentación ni reinicia): sigue su camino normal. Una palabra de más no es la frase. Un anuncio reconocido va antes (imagen) o después (su texto tiene su ángulo): este bloque no los desplaza.
if (!esAudio && !esVisual && !hayQrAbierto && !ficha.saludado && rrEsEntradaLanding(norm, base.landingFrase)) return salir(saludo('', { origen: 'landing' }));
// DERIVA SOLO LO QUE RUBÉN TIENE QUE VER (lista cerrada de `rrDerivacion`): devolución (no hay garantía), reclamo, volumen o reventa, otro medio de pago, no entrega, hablar con una persona, el material que no abre, una pregunta médica específica (y la cancelación, más abajo). Todo lo demás se conversa, también con un QR abierto.
const derivacion = rrDerivacion(norm, { comprobante: ficha.comprobanteMs > 0 || cobro.enRevision === true, qrAbierto: hayQrAbierto });
// CASO (b) del PDF (PR-2): «vi el video, ¿precio y devolución?» da el PRECIO por código y deriva la devolución en el MISMO mensaje (un solo envío): aviso a Rubén y botón; nunca solo la derivación sin el precio.
const precioMencionado = rrPrecioMencionado(norm);
const pideDuracion = rrPideDuracion(norm);
if (derivacion) return salir({ tipo: 'derivar', motivo: 'consulta', clave: derivacion.clave, aviso: avisoDeConsulta(derivacion.clave, derivacion.motivo), cat: cat, precio: precioMencionado !== null && ['devolucion', 'otro_medio_pago', 'reclamo', 'volumen'].indexOf(derivacion.clave) >= 0 ? precioMencionado : null });
// «Cancela mi pedido», «no quiero comprar», «ya no lo quiero» (con un QR abierto o un pedido hecho). «Solo quiero saber…» no cancela nada: es un cliente que mira (se le responde más abajo).
// CANCELAR POR CÓDIGO: (a) QR abierto de regla 2 que el servidor ve (`cobro.pendiente`) y SIN comprobante previo: plan `cancelar_cobro`; «Avisar al servidor» reporta `cobro_cancelado` ANTES de armar el texto
// y «Armar mensajes» dice «cerré tu pedido» solo si el servidor respondió 200; si no, cae a la escalada de siempre (`aviso` de este plan). (c) Con comprobante previo (en revisión o ya cotejado) NO se cancela: se escala y se
// reporta `anulacion_avisada` (solo avisa). Una segunda cancelación seguida recibe «ya cerrado» (la firma del último plan), sin repetir nada.
const cancelacion = rrCancelaPedido(norm);
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
// El «Sí» suelto a «¿Te muestro las opciones?» (la pregunta FIJA del puente, con su intención `ver_opciones`): las opciones salen por código, aunque la charla no llegara a dos mensajes; con un QR abierto, el catálogo sin botones. El «No» y los demás siguen
// al modelo, que recibe la pregunta como dato (`respuestaAPregunta`).
if (siNo && siNo.estado === 'resuelta' && siNo.intencion === 'ver_opciones' && siNo.tipo === 'si') {
  if (hayQrAbierto) return salir(Object.assign({ tipo: 'catalogo', cat: cat }, abierto()));
  return salir(rrMenu(cat, ficha.usados).length ? { tipo: 'opciones_codigo', cat: cat, boton: '' } : sinOpciones(''));
}
// CASOS (c) y (d): «¿me garantizan que voy a dormir?» no promete nada y recuerda el plan de 21 días; si la misma frase trae otra pregunta (el precio, la duración de los audios), el código responde TODO en UN solo mensaje.
if (rrPreguntaPorResultado(norm)) return salir(Object.assign({ tipo: 'resultado', cat: cat, precio: precioMencionado, duracion: pideDuracion }, abierto()));
// CON UN QR ABIERTO: el recordatorio SOLO sale si el cliente habla de pagar («ya pagué», «cómo pago», «comprobante», «QR», «monto») o pide un producto (más abajo). Todo lo demás se responde (resultado, imágenes, catálogo, precio, o el modelo
// para una pregunta) sin botones de producto y SIN abrir otro QR (`qrAbierto: true`), y «Armar mensajes» agrega la invitación a pagar.
if (hayQrAbierto && rrHablaDelCobro(norm)) return salir(recordatorio(''));
// «¿Qué incluye el pack?»: el contenido del producto lo dice el CÓDIGO (con QR abierto, sin botones y con la invitación a pagar una sola vez). Como PRIMER mensaje, con la presentación.
const contenidoDe = rrPideContenido(norm, hayQrAbierto ? producto : '');
if (contenidoDe !== '') return salir(Object.assign({ tipo: 'contenido', producto: contenidoDe, conPresentacion: !ficha.saludado, cat: cat }, abierto()));
// El ángulo del anuncio: por el texto escrito o por el texto leído de una captura (publicidad). El modelo redacta la apertura con el ángulo como dato; si falla, sale el texto fijo del ángulo.
const angulo = rrAngulo(norm) || (esVisual ? rrAngulo(rrNorm(leido)) : '');
// Con un QR abierto (24/10/2026): la captura de un anuncio o el texto de un anuncio TAMBIÉN se responde con la apertura de su ángulo, y «Armar mensajes» le suma la invitación a pagar el QR pendiente (monto del pedido, nunca el del sello de la imagen):
// sin QR nuevo, sin botones de producto y sin derivar. Un comprobante real o un pago con problema no llegan aquí (se resolvieron arriba).
if (angulo) {
  return salir(Object.assign({ tipo: 'angulo', angulo: angulo, conPresentacion: !ficha.saludado, cat: cat, textoCliente: String(textoCliente || leido).slice(0, 500) }, abierto()), {
    llamarModelo: true, cuerpoModelo: rrCuerpoModelo(textoCliente || leido, ficha.hist, RR_ANGULOS[angulo].tema, base.temperatura, respuestaAPregunta, 'charla', cfg.nombreNegocio),
  });
}
// EL PRECIO DE UN PRODUCTO NOMBRADO («¿cuánto cuesta el libro?»): lo dice el CÓDIGO desde el catálogo, ya, aunque la charla no llegara a dos mensajes (si es el primer mensaje, con la presentación). Antes de las opciones, el cierre es el del puente.
// Una pregunta de precios EN GENERAL (sin producto) sí pasa por la compuerta. Sin ningún precio en el catálogo se deriva a Rubén.
const precioPedido = rrPrecioPedido(norm);
if (precioPedido && precioPedido.producto !== '') {
  const k = precioPedido.producto;
  // Un producto sin precio en el catálogo (agotado, o ausente) no se cotiza: con la bandera `agotado` se dice la verdad con el aviso y el botón; si no, no hay opciones que mostrar. Nunca se lista OTRO precio en su lugar.
  if (rrPrecio(cat, k) === null) return salir(agotados.indexOf(k) >= 0 ? { tipo: 'derivar', motivo: 'agotado', aviso: avisoDeConsulta('producto_agotado', 'preguntó el precio de ' + rrTitulo(nom, k) + ', que figura como agotado'), cat: cat } : sinOpciones(''));
  return salir(Object.assign({ tipo: 'precio', producto: k, cat: cat, conPresentacion: !ficha.saludado, temprano: !habilitado, duracion: pideDuracion }, abierto()));
}
// «¿Tienes imágenes?»: respuesta fija, el flujo no envía imágenes del libro. Como PRIMER mensaje, el saludo.
if (rrPideImagenes(norm)) return salir(!ficha.saludado ? saludo() : Object.assign({ tipo: 'imagenes', cat: cat }, abierto()));
// El catálogo completo con precio, por código (texto y audio transcrito). Sin dos mensajes de conversación, la compuerta (saludo o puente). Sin ningún precio en el catálogo, Rubén.
if (rrPideCatalogo(norm)) {
  if (!habilitado) return pedirOpciones();
  if (!ficha.saludado) return salir(saludo());
  return salir(Object.keys(cat).length ? Object.assign({ tipo: 'catalogo', cat: cat }, abierto()) : sinOpciones(''));
}
// Los precios en general («¿qué precios tienen?», «precios»): igual que el catálogo, tras la compuerta.
if (precioPedido) {
  if (!habilitado) return pedirOpciones();
  if (!ficha.saludado) return salir(saludo());
  return salir(Object.keys(cat).length ? Object.assign({ tipo: 'precio', producto: '', cat: cat, temprano: false }, abierto()) : sinOpciones(''));
}
// La confirmación en texto (o por voz) de UN producto: el QR con el monto del catálogo, como un botón.
const confirmado = rrProductoConfirmado(norm);
if (confirmado) return salir(elegir(confirmado, ''));
// «Lo voy a pensar»: sin presión, con los dos precios principales, por código, ya con las opciones habilitadas (antes de la charla no hay montos: lo contesta el modelo; con un QR abierto sigue el camino de siempre). La muestra de voz solo si la piden.
if (!hayQrAbierto && habilitado && rrDiceLoVoyAPensar(norm)) return salir({ tipo: 'info', clave: 'pensar', cat: cat });
if (!hayQrAbierto && rrPideMuestra(norm)) return salir({ tipo: 'info', clave: 'muestra', cat: cat });
// «Quiero comprar», «cómo pago», «opciones»: las opciones, tras la compuerta (el QR sale solo de un producto elegido).
if (rrQuiereOpciones(norm)) {
  if (hayQrAbierto) return salir(recordatorio(''));
  if (!habilitado) return pedirOpciones();
  return salir(ficha.saludado ? opcionesDe(ficha.usados, '') : saludo());
}
if (!ficha.saludado && rrEsSoloSaludo(norm)) return salir(saludo());
// Después de un comprobante recibido, hablar de pago, libro, material o entrega NO es una charla libre (y esto va DESPUÉS de las preguntas de precio, la confirmación de un producto y «cómo pago», que son una compra nueva): el modelo no habla del estado de un pago ni de una entrega. Va la derivación de no entrega
// (texto fijo con el plazo del dato, aviso y botón).
if (ficha.comprobanteMs > 0 && (rrHablaDePagar(norm) || /\b(pago|pague|pagado|pagaste|comprobante|transferencia|deposito|material|llega\w*|llego|enviar\w*|enviaron|mandar\w*|mandaron|recib\w*|entrega\w*)\b/.test(norm) || (/\blibro\b/.test(norm) && /\b(cuando|donde|llega\w*|llego|envi\w*|mand\w*|recib\w*)\b/.test(norm)))) {
  return salir({ tipo: 'derivar', motivo: 'consulta', clave: 'no_entrega', aviso: avisoDeConsulta('no_entrega', 'queja de no entrega: el cliente pregunta por su pago o por el material'), cat: cat });
}
// Una nota de voz corta o ininteligible (menos de 3 palabras o sin letras que valgan) que el código no atendió arriba (ni siquiera la derivación de no entrega tras un comprobante, que va antes): se pide repetirla
// con un texto fijo; el modelo no inventa una respuesta.
if (esAudio && rrAudioIlegible(norm)) return salir({ tipo: 'audio_fijo', causa: 'corto', cat: cat });
// Con un QR abierto, lo que queda: pedir un producto (el recordatorio: un solo QR a la vez) o CUALQUIER otra cosa —una pregunta, una afirmación («casi no hablamos», «me parece bien») o un audio transcrito sin «?»—: la contesta el modelo
// (sin botones de producto ni otro QR) y «Armar mensajes» agrega la invitación a pagar. La conversación sigue; el recordatorio de pago solo sale cuando habla de pagar (más arriba) o pide un producto.
if (hayQrAbierto) {
  if (rrPideProducto(norm)) return salir(recordatorio(''));
  return modeloDelTurno('charla');
}
// EL PRIMER TURNO de un teléfono (PR-D, [B]): el saludo fijo por código —la presentación una sola vez y la pregunta abierta, sin montos—; el modelo no abre la conversación. Lo que dijo queda en la memoria
// de la charla (el plan `saludo` la guarda), así que el modelo lo lee en la respuesta siguiente.
if (!ficha.saludado) return salir(saludo());
const paraElModelo = esVisual ? 'El cliente envió la captura de un anuncio. Texto leído: ' + leido : textoCliente;
// El «No» a «¿Te muestro las opciones?» se respeta: esa respuesta es charla pura, sin el bloque de las opciones y sin botones de producto (`sinMenu`).
const declino = !!siNo && siNo.estado === 'resuelta' && siNo.intencion === 'ver_opciones' && siNo.tipo === 'no';
// El modo del turno. Habilitado: la primera respuesta conversada que sigue lleva el bloque de las opciones (`opciones`) si aún no se vieron y hay productos que ofrecer; después, charla. Sin habilitar: si pidió opciones y ya hubo UN mensaje de conversación, puente.
const modoFinal = declino ? 'charla' : (habilitado ? (!ficha.opcionesVistas && rrMenu(cat, ficha.usados).length ? 'opciones' : 'charla') : (ficha.pidioOpciones && ficha.charlaN === 1 ? 'puente' : 'charla'));
return modeloDelTurno(modoFinal, declino ? { sinMenu: true } : {}, '', paraElModelo);
