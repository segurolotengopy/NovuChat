// ARMAR MENSAJES: lo que sale al cliente, armado por CÓDIGO. UN mensaje por turno (el QR agrega su resumen y su imagen cuando se emite), o ninguno.
//
// La decisión es de `bmResolver` (la misma que tomó «Armar avisos»); aquí se arman los mensajes y se escribe la ficha. Según el plan:
//   puerta «suspendido»     el texto neutro del comercio (sin revelar el motivo);   «uso_extendido»  el aviso fijo con el botón para escribirle a recepción (y «Armar avisos» avisó);
//   «bloqueado»             pausa por Tomar: NO SALE NADA (cero envío, cero modelo, cero descarga);
//   «baja»                  el pedido de no recibir más mensajes: UN texto fijo de confirmación y nada más;
//   «cortes», «identidad», «audio_fijo», «archivo», «imagen_otra», «anuncio»   textos fijos (el producto del anuncio y su precio salen del catálogo);
//   «modelo»                la redacción del modelo, revisada, más el resumen del pedido que calcula el código;
//   «qr»                    el resumen del pedido y el QR REAL del comercio (imagen por id de medio, nunca por enlace) con el monto del carrito; «qr_pendiente» el recordatorio del QR abierto;
//   «comprobante»           «llegó y los datos coinciden» (NUNCA «acreditado» ni «verificado»), con el botón; si NO coinciden (`no_cuadra`) se nombran TODAS las diferencias y pasa a recepción (aviso + botón), sin pedir otro; «comprobante_pedir» pide una foto más nítida;
//   «pedido_sin_cobro»      sin QR de cobro real: el pedido queda anotado y lo coordina recepción (aviso + botón);
//   «derivar»               pasar con recepción: el aviso MÁS el botón para escribirle directo. «Ya avisé» solo sale si «Enviar aviso» devolvió un `wamid` real.
// SOLO SE OFRECE LO QUE SE CUMPLE: ninguna promesa de «te aviso luego», «te llamamos» o «te escribirán»; el único ofrecimiento es pasar con recepción.
// El botón de recepción va SOLO al derivar. Todo texto pasa por `bmSeguro` (NIEGA_IA y palabras prohibidas del cobro). La ficha (`casabermejo[<messages[0].from>]`) se escribe AQUÍ, una vez por turno;
// «Resumen del turno» devuelve a la ficha lo que no salió. NIT y CI no se guardan en ningún lado.
const c = bmContexto();
c.modeloResp = cnPrimero('Conversar con el modelo');
c.cancelo = cnNodo('Avisar al servidor') ? bmCobroCerrado(cnPrimero('Avisar al servidor')) : undefined;
// La respuesta de `pedirAliasArs` (Argentina) sale del mismo nodo; si no corrió, es `{}` y el turno pasa con recepción (nunca queda sin definir).
c.aliasPedir = cnNodo('Avisar al servidor') ? (cnPrimero('Avisar al servidor') || {}) : {};
const d = bmResolver(c);
const { cfg, base, t, puerta, from, ahora, ficha: fichaAntes } = c;
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const negocio = bmNombreNegocio(cfg);
const sinSalida = (resumen) => [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
if (!cnClaveValida(from)) return sinSalida({ plan: 'nada', mensajes: 0, categoria: '', llamadasModelo: 0 });

const entregado = (j) => { const m = j && j.messages; return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''; };
// El aviso al comercio: «ya avisé» exige un `wamid` real de «Enviar aviso» (en modo prueba sin envío de verdad, cuenta como salido).
const av = cnPrimero('Armar avisos') || {};
const avisoPlaneado = av.planeado === true;
const avisoEnviado = avisoPlaneado && (cnTodos('Enviar aviso').some(entregado) || (prueba && cfg.enviarDeVerdad !== true));
const salio = avisoEnviado ? true : (av.repetido === true ? 'repetido' : false);

// El tratamiento es dato del comercio: con «usted», todo texto fijo del flujo sale en usted (`bmAUsted`).
const usted = base.tratamiento === 'usted';
const texto = (cuerpo, extra) => { const x = bmSeguro(cuerpo, usted); return cmMensaje('cliente', cmTexto(x), x, x, Object.assign({ tipoReporte: 'text' }, extra || {})); };
// El botón de recepción: el contacto designado del comercio (o el número de recepción de la consola).
const contacto = cnDigitos(/^REEMPLAZAR_/.test(String(base.contactoAviso || '')) ? '' : base.contactoAviso) || cnDigitos(cfg.numeroRecepcion);
const conRecepcion = (cuerpo) => cmContactoConBoton({ numero: contacto, desde: from, cuerpo: bmSeguro(cuerpo, usted), botonTexto: 'Escribir', saludo: 'Hola, te escribo desde el chat de ' + negocio, textoDelRespaldo: usted ? 'Escríbale aquí:' : 'Escríbele aquí:' });
const saludo = 'Hola, soy el asistente virtual de ' + negocio + '.';
const conSaludo = (cuerpo) => (fichaAntes.saludado ? cuerpo : saludo + '\n\n' + cuerpo);
// Una pregunta de la tienda que vino CON otra cosa («¿dónde están ubicados? ¿eres un bot?», «… quiero pagar»): la respuesta de la tienda (del dato del comercio, por código) va ANTEPUESTA en el mismo mensaje de cualquier respuesta del turno (0 mensajes agregados).
// `Decidir turno` solo marca la pregunta (`plan.ubicacion`, `plan.horario`) cuando hay dato; aquí se vuelve a comprobar: sin dato no se antepone nada, jamás una dirección ni un horario inventados.
const uTienda = bmUbicacionTienda(c.base, cnPrimero('Traer catálogo'), cfg);
const pideUA = c.plan.tipo !== 'ubicacion_tienda' && c.plan.ubicacion === true;
const pideHA = c.plan.tipo !== 'ubicacion_tienda' && c.plan.horario === true;
const uAntes = (pideUA || pideHA) && bmTiendaTieneDato(uTienda, pideUA, pideHA) ? bmRespuestaDeTienda(uTienda, pideUA, pideHA, true) : '';
const antepone = (cuerpo) => (uAntes !== '' ? uAntes + '\n\n' + cuerpo : cuerpo);
// El resumen del pedido que cabe en `tope` caracteres: con un pedido grande se quitan líneas de piezas («… y N piezas más») y NUNCA el total ni lo que va detrás (los datos, «Corregir datos»).
function ajustarResumen(resumen, tope) {
  if (resumen.length <= tope) return resumen;
  const filas = resumen.split('\n');
  const total = filas.pop();
  for (let k = filas.length - 1; k >= 0; k--) {
    const r = filas.slice(0, k).concat(['… y ' + (filas.length - k) + (filas.length - k === 1 ? ' pieza más' : ' piezas más'), total]).join('\n');
    if (r.length <= tope) return r;
  }
  return total;
}

let tipoDePlan = d.tipo;
let msgs = [];          // los mensajes de este turno (casi siempre uno)
let llamadasModelo = 0;
let nuevos = {};        // lo que cambia en la ficha
let ev = {};            // lo que se devuelve a la ficha si el envío no sale
// La memoria de la charla (sin números largos: NIT, CI, teléfonos): el turno COMPLETO, lo que escribió el cliente (entero, aunque parte la haya contestado la tienda) y lo que se le respondió. El estado «el asistente pidió el nombre» sale de aquí:
// un turno que se deriva o que cambia de tema tiene que dejarlo en la memoria, o el siguiente turno decide con un estado viejo.
const recordar = (delCliente, delAsistente) => {
  const hist = fichaAntes.hist.concat([{ r: 'u', t: bmParaMemoria(delCliente) }, { r: 'm', t: bmParaMemoria(delAsistente) }]).filter((x) => x.t !== '');
  nuevos.hist = hist.slice(-BM_RECUERDOS);
  ev.hist = fichaAntes.hist;
};
if (puerta.ruta === 'suspendido') {
  tipoDePlan = 'suspendido';
  msgs = [texto(puerta.texto)];
} else if (puerta.ruta === 'uso_extendido') {
  // «bloqueado» (pausa por Tomar) no responde nada; «operador» responde el aviso fijo CON el botón (el texto promete que una persona continúa y «Armar avisos» avisó).
  tipoDePlan = puerta.responder === true && String(puerta.texto || '').trim() !== '' ? 'uso_extendido' : 'bloqueado';
  if (tipoDePlan === 'uso_extendido') {
    msgs = [conRecepcion(puerta.texto)];
    // A lo más UN aviso de «una persona continúa» cada 30 minutos por teléfono: si salió, se anota (y se devuelve si el envío no sale).
    if (salio === true) { nuevos.avisoConsultaMs = ahora; ev.avisoConsultaMs = fichaAntes.avisoConsultaMs; }
  }
} else if (puerta.ruta === 'sigue') {
  if (tipoDePlan === 'nada') tipoDePlan = 'nada';
  else if (tipoDePlan === 'otro') tipoDePlan = 'cortes';
}
if (puerta.ruta === 'sigue') {
  if (tipoDePlan === 'cortes') {
    msgs = [texto(conSaludo(BM_TEXTO_CORTES))];
  } else if (tipoDePlan === 'baja') {
    // La confirmación de la baja: UN texto fijo (sin saludo, sin botón, sin aviso); el `no_contactar` ya viajó con el entrante (si fue una nota de voz, `t.texto` iba vacío: el evento viaja en el reporte de ESTE mensaje saliente). La ficha y el carrito no se tocan.
    msgs = [texto(bjTextoBaja(c.base && c.base.tratamiento === 'usted' ? BM_TEXTO_BAJA_USTED : undefined), d.porVoz === true ? { evento: 'no_contactar' } : undefined)];
  // UBICACIÓN Y HORARIO DE LA TIENDA (25/11/2026): la dirección en texto, el enlace de Maps como botón «Ver ubicación» y el horario: UN mensaje, todo del dato del comercio (nada inventado). Un `cmEnlace` solo deja pasar https.
  } else if (tipoDePlan === 'ubicacion_tienda') {
    const u = bmUbicacionTienda(c.base, cnPrimero('Traer catálogo'), cfg);
    const pideU = c.plan.ubicacion === true || (c.plan.ubicacion === undefined && c.plan.horario !== true);
    const pideH = c.plan.horario === true;
    if (!bmTiendaTieneDato(u, pideU, pideH)) {
      // No debería pasar (Decidir turno ya derivó sin dato): jamás una dirección ni un horario inventados; pasa con recepción.
      tipoDePlan = 'derivar';
      msgs = [conRecepcion(conSaludo(bmTextoDerivacion(pideU && !u.hayDato ? 'ubicacion_sin_dato' : 'horario_sin_dato', false)))];
    } else if (pideU && u.mapa !== '') {
      const cuerpoUb = bmSeguro(conSaludo(bmRespuestaDeTienda(u, pideU, pideH, false)), usted);
      msgs = [cmMensaje('cliente', cmEnlace(cuerpoUb, 'Ver ubicación', u.mapa), cuerpoUb, cuerpoUb + '\n\n' + u.mapa, { tipoReporte: 'interactive', conBoton: true })];
    } else msgs = [texto(conSaludo(bmRespuestaDeTienda(u, pideU, pideH, false)))];
  } else if (tipoDePlan === 'identidad') {
    msgs = [texto(antepone(BM_TEXTO_IDENTIDAD.replace('{NEGOCIO}', negocio)))];
  } else if (tipoDePlan === 'audio_fijo') {
    msgs = [texto(conSaludo(d.causa === 'largo' ? BM_TEXTO_AUDIO_LARGO : BM_TEXTO_AUDIO_NO_ENTENDIDO))];
  } else if (tipoDePlan === 'archivo') {
    msgs = [texto(conSaludo(d.pesado === true ? BM_TEXTO_ARCHIVO_PESADO : BM_TEXTO_ARCHIVO_NO_ABIERTO))];
  } else if (tipoDePlan === 'imagen_otra') {
    msgs = [texto(conSaludo(d.documento === true ? BM_TEXTO_DOCUMENTO : BM_TEXTO_IMAGEN))];
  } else if (tipoDePlan === 'anuncio') {
    // El producto del anuncio sale POR CÓDIGO y su precio, del catálogo: nunca del modelo ni de la imagen.
    const v = c.vendibles.find((x) => x.id === d.producto);
    if (v) {
      msgs = [texto(conSaludo('Sí, tenemos ' + v.nombre + ': ' + vcMonto(v.precioCentavos, v.moneda) + '.\n\n¿Cuántas unidades te gustaría?'))];
      nuevos.mostrados = fichaAntes.mostrados.filter((x) => x !== v.id).concat([v.id]).slice(-15); ev.mostrados = fichaAntes.mostrados;
    } else {
      tipoDePlan = 'derivar';
      msgs = [conRecepcion(conSaludo(bmTextoDerivacion('quiere_hablar', false)))];
    }
  } else if (tipoDePlan === 'modelo') {
    llamadasModelo = c.plan.tipo === 'modelo' ? 1 : 0;   // el toque de «Confirmar pedido» o de un botón de entrega lo decide el código: 0 llamadas
    // Una pregunta de la tienda que vino CON otra cosa («¿dónde están ubicados? quiero una billetera»): la respuesta de la tienda va ANTEPUESTA, en este mismo mensaje (`antepone`).
    const textoTurno = antepone(d.texto);
    const cuerpoModelo = conSaludo(textoTurno + (d.resumen ? '\n\n' + d.resumen : '') + (d.qrAnulado === true ? '\n\nTu pedido cambió, así que el QR anterior quedó anulado: no pagues con él. Cuando confirmes tu pedido te envío uno nuevo.' : ''));
    // Sin botón «Ver catálogo» (Andres, 24/11/2026, D7): las piezas se muestran por este chat. Lo que el mensaje puede llevar es UN botón de respuesta que el código cumple: «Confirmar pedido» (pedido listo) o los de entrega (solo falta el modo).
    if (d.confirmable === true) {
      // El pedido está listo: el MISMO mensaje lleva el botón «Confirmar pedido» (0 mensajes más); tocarlo emite el QR en el mismo turno. Antes del QR el cliente VE los datos capturados (modo, nombre y, en el envío, departamento o provincia, ciudad, aclaración y documento)
      // y tiene un segundo botón de respuesta, «Corregir datos» (el mismo mensaje: 0 mensajes agregados): un dato mal leído nunca llega al cobro sin que el cliente lo vea. Si el texto es largo se recorta ÉL, nunca los datos ni las instrucciones.
      const datos = bmDatosResumen(d.entrega, c.mercado, uTienda.direccion, uTienda.mapa);   // R54: con el retiro, la dirección de la tienda va en los datos
      const lineaCorregir = usted ? 'Si algún dato no está bien, toque «' + BM_TITULO_CORREGIR + '».' : 'Si algún dato no está bien, toca «' + BM_TITULO_CORREGIR + '».';
      // El cuerpo cabe en 1.024 caracteres con la instrucción de `cfCuerpo` al final. Orden de sacrificio con un pedido grande: primero el texto del modelo, luego las líneas de piezas del resumen («… y N piezas más», siempre con el total), luego el saludo y la respuesta de la tienda;
      // NUNCA se corta el enlace del mapa ni los datos de entrega ni «Corregir datos» (un dato mal leído no puede llegar al cobro sin que el cliente lo vea).
      const sitio = 1024 - cfInstruccion(usted).length - 2;
      const anulado = d.qrAnulado === true ? '\n\nTu pedido cambió, así que el QR anterior quedó anulado: no pagues con él. Cuando confirmes tu pedido te envío uno nuevo.' : '';
      const fijoCola = [datos, lineaCorregir].filter((x) => typeof x === 'string' && x !== '').join('\n\n') + anulado;
      // La cabeza: saludo + respuesta de la tienda (si la hay) + texto del modelo. La respuesta de la tienda se CONSERVA: primero se acorta el resumen de piezas («… y N piezas más») para dejarle lugar;
      // solo si ni con el resumen mínimo (el total) cabe, se suelta la respuesta de la tienda y, al final, el saludo.
      const armarCabeza = (conTienda, conSaludoPrimero) => (conSaludoPrimero && !fichaAntes.saludado ? saludo + '\n\n' : '') + (conTienda && uAntes !== '' ? uAntes + '\n\n' : '');
      const colaCon = (reserva) => {
        const r = typeof d.resumen === 'string' && d.resumen !== '' ? ajustarResumen(d.resumen, Math.max(0, sitio - fijoCola.length - 2 - reserva)) : '';
        return (r !== '' ? r + '\n\n' : '') + fijoCola;
      };
      let fijo = armarCabeza(true, true);
      let cola = colaCon(fijo.length);
      if (fijo.length + cola.length + 2 > sitio) { fijo = armarCabeza(false, true); cola = colaCon(fijo.length); }
      if (fijo.length + cola.length + 2 > sitio) { fijo = armarCabeza(false, false); cola = colaCon(fijo.length); }
      const sitioTexto = sitio - cola.length - 2 - fijo.length;
      const textoModelo = d.texto.length > sitioTexto ? (sitioTexto > 1 ? d.texto.slice(0, sitioTexto - 1).trimEnd() + '…' : '') : d.texto;
      const cabezaCorta = (fijo + textoModelo).trimEnd();
      const cuerpoCf = bmSeguro(cfCuerpo((cabezaCorta !== '' ? cabezaCorta + '\n\n' : '') + cola, usted), usted);
      // El documento (CI) viaja en el mensaje al cliente, pero el texto que se REPORTA a la conversación del comercio lo lleva enmascarado.
      const docEntrega = bmEntregaDeFicha(d.entrega).documento;
      const reportado = bmEnmascararDocumento(cuerpoCf, docEntrega);
      msgs = [cmMensaje('cliente', cmBotones(cuerpoCf, [cfBoton(d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle || '', precioCentavos: l.precioCentavos })), bmEntregaDeFicha(d.entrega), fichaAntes.pedidos), { id: BM_ID_CORREGIR, title: BM_TITULO_CORREGIR }]), reportado, cuerpoCf, { tipoReporte: 'interactive', conBoton: true })];
    } else if (d.botonesEntrega === true && bmBotonesDeEntrega(c.modos).length > 0) {
      // Lo único que falta es el modo de entrega: el MISMO mensaje lleva «Recojo en tienda» y «Envío» (0 mensajes más); tocar uno lo anota sin modelo. Si el texto no pregunta por la entrega, la pregunta la agrega el código.
      const pregunta = /\b(recib|entrega|retir|recoj|envi)/.test(bmNorm(d.texto)) ? '' : '¿Cómo prefieres recibir tu pedido?';
      const cuerpoBe = bmSeguro(pregunta === '' ? cuerpoModelo : (cuerpoModelo.length > 1024 - pregunta.length - 2 ? cuerpoModelo.slice(0, Math.max(0, 1024 - pregunta.length - 3)).trimEnd() + '…' : cuerpoModelo) + '\n\n' + pregunta, usted);
      msgs = [cmMensaje('cliente', cmBotones(cuerpoBe, bmBotonesDeEntrega(c.modos)), cuerpoBe, cuerpoBe, { tipoReporte: 'interactive', conBoton: true })];
    } else if (bmInteractivoDePide(d.pide, d.entrega) !== null) {
      // El dato que pide el código es de una LISTA (departamento, región, provincia): el MISMO mensaje lleva la lista (0 mensajes más); el texto libre nunca fija una opción de lista.
      // El cuerpo cabe en 1.024: si no cabe se quita el resumen de piezas y, si aún no, se conserva la COLA (la pregunta va al final).
      const it = bmInteractivoDePide(d.pide, d.entrega);
      let cuerpoIt = cuerpoModelo;
      if (cuerpoIt.length > 1024) cuerpoIt = conSaludo(textoTurno);
      if (cuerpoIt.length > 1024) cuerpoIt = '…' + cuerpoIt.slice(-1020).trimStart();
      cuerpoIt = bmSeguro(cuerpoIt, usted);
      const respaldoLista = cuerpoIt + '\n\nEscríbame el nombre exacto de una opción: ' + it.filas.map((x) => x.title).join(', ') + '.';
      msgs = [cmMensaje('cliente', cmLista(cuerpoIt, it.boton, it.titulo, it.filas), cuerpoIt, respaldoLista, { tipoReporte: 'interactive', conBoton: true })];
    } else if (bmEsRetiro(bmEntregaDeFicha(d.entrega).modo) && Array.isArray(d.pide) && d.pide.includes('nombre') && uTienda.mapa !== '') {
      // RECOJO: la pregunta del nombre lleva el botón «Ver ubicación» de la TIENDA (Maps de NovuTienda), en el mismo mensaje (0 más). Sin mapa válido, texto como siempre.
      const cuerpoR = bmSeguro(cuerpoModelo.length > 1024 ? '…' + cuerpoModelo.slice(-1020).trimStart() : cuerpoModelo, usted);
      msgs = [cmMensaje('cliente', cmEnlace(cuerpoR, 'Ver ubicación', uTienda.mapa), cuerpoR, cuerpoR + '\n\n' + uTienda.mapa, { tipoReporte: 'interactive', conBoton: true })];
    } else msgs = [texto(cuerpoModelo)];
    nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle }));
    nuevos.entrega = d.entrega;
    nuevos.cierre = d.cierre === true;
    // QUÉ DATO PIDIÓ EL CÓDIGO en este mensaje (séptima ronda): lo decide `bmResolverModelo` del estado de la entrega y garantiza que la pregunta sale en el texto; el turno siguiente decide por esto, no por el texto del modelo.
    nuevos.pide = Array.isArray(d.pide) ? d.pide : [];
    nuevos.mostrados = d.lineas.map((l) => l.id).concat(fichaAntes.mostrados.filter((x) => !d.lineas.some((l) => l.id === x))).slice(0, 15);
    // La memoria de la charla: sin números largos (NIT, CI, teléfonos).
    // El turno COMPLETO: lo que escribió el cliente entero (`textoCompleto`, aunque la tienda haya contestado una parte) y lo que se le respondió, con la respuesta de la tienda.
    recordar(typeof c.plan.textoCompleto === 'string' && c.plan.textoCompleto !== '' ? c.plan.textoCompleto : c.plan.textoCliente, d.texto + (uAntes !== '' ? ' (respuesta de la tienda enviada)' : ''));   // la respuesta de la tienda es dato de otro: a la memoria va una marca fija, nunca su texto (volvería al modelo sin <<< >>>); el texto del asistente primero: la memoria es corta y el estado («pidió el nombre») sale de él
    if (d.patch) Object.assign(nuevos, d.patch);
    for (const k of ['carrito', 'entrega', 'cierre', 'mostrados', 'hist', 'qrHastaMs', 'qrCarrito', 'pide']) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'qr') {
    // Nunca un QR sin monto del carrito, sin id de medio o sin un id de pedido válido: se pasa con recepción (sin decir que se avisó: aquí no hay aviso).
    const lineas = bmConNombres(d.lineas, c.vendibles);
    if (!Number.isSafeInteger(d.total) || d.total <= 0 || d.monto !== d.total / 100 || !/^[A-Za-z0-9_-]{5,100}$/.test(String(d.mediaId || '')) || !/^[A-Za-z0-9]{3,40}$/.test(String(d.pedidoId || ''))) {
      tipoDePlan = 'derivar';
      msgs = [conRecepcion(conSaludo(BM_INTROS.monto_invalido + ' Escríbele a recepción con el botón.'))];
    } else {
      const resumen = (d.cambioDePedido ? 'Actualicé tu pedido.\n\n' : '') + 'Este es el resumen de tu pedido:\n\n' + vcResumen(lineas)
        + '\n\nEntrega: ' + bmEntregaTexto(d.entrega) + '. El total no incluye el costo de entrega.\n\nAbajo va el QR para pagar.';
      const pie = bmSeguro('QR para pagar ' + vcMonto(d.total) + ' (pedido ' + d.pedidoId + '). Cuando pagues, envíame la foto del comprobante por este chat.', usted);
      const respaldo = 'No pude mostrarte el QR en este momento. Escríbeme de nuevo en unos minutos para intentarlo otra vez.';
      const imagen = cmMensaje('cliente', Object.assign(cmBase('image'), { image: { id: d.mediaId, caption: pie } }), pie, respaldo, { tipoReporte: 'image' });
      // El evento que ABRE el cobro: `qr_enviado`, con `referencia` (el pedido) y `monto` (el del carrito, en bolivianos). Cobro real: regla 2 (15 minutos, 3 intentos).
      imagen.evento = 'qr_enviado'; imagen.reglaCobro = 2; imagen.referencia = String(d.pedidoId); imagen.monto = d.monto;
      // Para que el servidor cree el pedido `wa_<referencia>`: el catálogo es externo (NovuTienda) y el servidor no puede recalcularlo, así que viajan el precio y el nombre del CATÁLOGO, calculados aquí.
      // Líneas con la forma CERRADA del catálogo externo (`bmLineasPedido`): id, nombre, cantidad, precio y moneda salen del carrito del código, nunca del modelo.
      { const ls = bmLineasPedido(d.lineas, from); if (ls) { imagen.lineas = ls; imagen.entrega = pqrEntrega({ entrega: d.entrega.modo, direccion: bmDireccionPedido(d.entrega, ceMercadoDePrefijo(from) || 'BO') }); } }
      msgs = [texto(conSaludo(antepone(resumen))), imagen];
      nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle }));
      nuevos.entrega = d.entrega; nuevos.cierre = false; nuevos.pide = []; ev.pide = fichaAntes.pide;
      nuevos.pedidos = fichaAntes.pedidos + 1;
      nuevos.qrHastaMs = ahora + BM_MINUTOS_QR * 60 * 1000;
      nuevos.qrCarrito = d.lineas.map((l) => { const o = { id: l.id, cantidad: l.cantidad, precioCentavos: l.precioCentavos, detalle: l.detalle }; if (l.moneda === 'BOB' || l.moneda === 'ARS') o.moneda = l.moneda; return o; }); // con la moneda: `vcMismoCarrito` la compara
      for (const k of ['carrito', 'entrega', 'cierre', 'pedidos', 'qrHastaMs', 'qrCarrito']) ev[k] = fichaAntes[k];
    }
  } else if (tipoDePlan === 'qr_pendiente') {
    msgs = [texto(conSaludo(antepone('Ya tienes un QR abierto por ' + vcMonto(d.total) + '. Cuando pagues, envíame la foto del comprobante por este chat.')))];
    nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle })); nuevos.entrega = d.entrega; ev.carrito = fichaAntes.carrito; ev.entrega = fichaAntes.entrega;
  } else if (tipoDePlan === 'pedido_sin_cobro') {
    const lineas = bmConNombres(d.lineas, c.vendibles);
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
    // Argentina: el pedido se crea en el servidor con `pedido_sin_cobro` (sin QR, sin monto): mismas líneas de forma cerrada y la entrega. Solo viaja si el envío fue aceptado (lo decide el reporte saliente).
    // Bolivia sin QR configurado no lo emite (el evento es de Argentina). El contador sube para que dos pedidos seguidos no repitan la referencia.
    const ls = d.mercado === 'AR' && /^[A-Za-z0-9]{3,40}$/.test(String(d.pedidoId || '')) ? bmLineasPedido(d.lineas, from) : null;
    // El texto que ofrece «pagar» (el alias llega en el turno siguiente) solo sale si el pedido se reportó Y el aviso a recepción salió; si no, sigue el de siempre (el pago lo coordina recepción) sin prometer nada.
    const ofreceAlias = ls !== null && (salio === true || salio === 'repetido');
    const cabeza = antepone('Anoté tu pedido:\n\n' + vcResumen(lineas)) + '\n\n';
    if (ofreceAlias) {
      // Argentina: el ofrecimiento de pagar es un BOTÓN de respuesta (`pedido:alias`, «Pagar»): nunca se le pide escribir «pagar». Un mensaje no puede llevar a la vez un botón de respuesta y el enlace a recepción: el aviso a recepción ya salió.
      // Si el botón no sale, el respaldo es el texto de siempre (el pago lo coordina recepción), sin prometer nada.
      // El cuerpo del botón NO nombra «el botón» de recepción (el único botón es «Pagar»): solo dice que el aviso salió. El respaldo en texto sí lleva el enlace a recepción.
      const colaAl = salio === 'repetido' ? ' Recepción ya recibió tu aviso anterior.' : ' Ya avisé a recepción.';
      const cuerpoAl = bmSeguro(conSaludo(cabeza + BM_INTROS.pedido_ar_alias + colaAl), usted);
      const respaldoAl = conRecepcion(conSaludo(cabeza + bmTextoDerivacion('pedido_ar', salio))).respaldo;
      msgs = [cmMensaje('cliente', cmBotones(cuerpoAl, [{ id: BM_ID_PAGAR_ALIAS, title: 'Pagar' }]), cuerpoAl, respaldoAl, { tipoReporte: 'interactive', conBoton: true })];
    } else msgs = [conRecepcion(conSaludo(cabeza + bmTextoDerivacion(d.mercado === 'AR' ? 'pedido_ar' : 'pedido_sin_cobro', salio)))];
    if (ls !== null) {
      msgs[0].evento = 'pedido_sin_cobro'; msgs[0].referencia = String(d.pedidoId); msgs[0].lineas = ls;
      msgs[0].entrega = pqrEntrega({ entrega: d.entrega.modo, direccion: bmDireccionPedido(d.entrega, ceMercadoDePrefijo(from) || 'BO') });
      nuevos.pedidos = fichaAntes.pedidos + 1; ev.pedidos = fichaAntes.pedidos;
      // «pagar» en el turno siguiente pide el alias de ESTE pedido (`wa_<referencia>`, el id que el servidor le da).
      Object.assign(nuevos, { aliasPedidoId: 'wa_' + String(d.pedidoId), aliasEstado: 'pedido', aliasVenceMs: 0, aliasMontoCent: Number.isSafeInteger(d.total) ? d.total : 0, aliasAr: '' });
      for (const k of ['aliasPedidoId', 'aliasEstado', 'aliasVenceMs', 'aliasMontoCent', 'aliasAr']) ev[k] = fichaAntes[k];
    }
  } else if (tipoDePlan === 'alias_texto') {
    // El alias, el monto exacto y los minutos que quedan los pone el CÓDIGO con lo que devolvió el servidor; sin saludo ni botón: es la respuesta a «pagar».
    msgs = [texto(d.texto)];
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'alias_cerrado') {
    // El cobro por alias está apagado (409 `cerrado`): vuelve el comportamiento de antes. El pedido ya está anotado y el pago lo coordina recepción; no se promete nada ni se dice que se avisó.
    msgs = [conRecepcion(conSaludo(bmTextoDerivacion('alias_cerrado', false)))];
  } else if (tipoDePlan === 'alias_pedir') {
    // Sin respuesta del servidor (no debería pasar: el nodo corrió): pasa con recepción, sin prometer.
    msgs = [conRecepcion(conSaludo(bmTextoDerivacion('alias_problema', salio)))];
  } else if (tipoDePlan === 'comprobante') {
    msgs = [conRecepcion(bmTextoComprobante(d.resultado, d.diferencia, d.totalTexto, salio, usted))];
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
    // Un comprobante que NO coincide: el aviso a recepción sale a lo más una vez cada 30 minutos; se anota solo si salió (y se devuelve si el envío no sale).
    if (d.resultado === 'no_cuadra' && salio === true) { nuevos.avisoNoCuadraMs = ahora; ev.avisoNoCuadraMs = fichaAntes.avisoNoCuadraMs; }
  } else if (tipoDePlan === 'comprobante_pedir') {
    msgs = [texto(bmTextoComprobante(d.resultado, d.diferencia, d.totalTexto, salio))];
  } else if (tipoDePlan === 'derivar') {
    // Pasar con recepción: el aviso MÁS el botón. «Ya avisé» solo con un `wamid` real; un motivo sin aviso nunca lo dice.
    const cuerpo = d.motivo === 'no_cancelo' ? BM_INTROS.no_cancelo + ' Escríbele a recepción con el botón.'
      : bmTextoDerivacion(d.motivo, salio);
    msgs = [conRecepcion(conSaludo(antepone(cuerpo)))];
    // La memoria también registra la derivación (lo que dijo el cliente, entero, y lo que se le respondió): sin esto, el turno siguiente decidiría con un estado viejo («el asistente pidió el nombre»).
    recordar(typeof c.plan.textoCompleto === 'string' && c.plan.textoCompleto !== '' ? c.plan.textoCompleto : c.plan.textoCliente, cuerpo + (uAntes !== '' ? ' (respuesta de la tienda enviada)' : ''));
    // `pide` PERSISTE al derivar (26/11/2026): el dato que se estaba pidiendo sigue pedido; la lista o el botón del mensaje anterior siguen valiendo y el turno siguiente vuelve a pedir el MISMO dato.
    if (salio === true && d.aviso && d.aviso.tipo === 'consulta') { nuevos.avisoConsultaMs = ahora; ev.avisoConsultaMs = fichaAntes.avisoConsultaMs; }
    // Un pedido cambiado cuyo cobro no se pudo cerrar: el pedido nuevo se conserva (el QR viejo sigue abierto y el cliente ya sabe que no pague con él).
    // Derivar por un `quiereHablar` del modelo NO borra lo que el cliente ya dio: se guardan las piezas y la entrega capturadas (3.ª revisión independiente, 24/11/2026).
    if (d.guardaPedido === true && Array.isArray(d.lineas) && d.entrega) { nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle })); nuevos.entrega = d.entrega; ev.carrito = fichaAntes.carrito; ev.entrega = fichaAntes.entrega; }
    if (d.motivo === 'no_cancelo' && Array.isArray(d.lineas)) { nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle })); nuevos.entrega = d.entrega; ev.carrito = fichaAntes.carrito; ev.entrega = fichaAntes.entrega; }
    if (d.motivo === 'comprobante_sin_cotejo' && d.patch) { /* sin cotejo: el comprobante llegó; recepción lo ve */ }
    if (d.patch && typeof d.patch === 'object') { Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k]; }
  } else if (tipoDePlan !== 'nada') {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    msgs = [texto(BM_SALUDO_MINIMO)];
  }
}

// Un número de otro país: el aviso a la tienda sale UNA vez por teléfono; se anota solo si el aviso salió (en prueba sin envío de verdad cuenta como salido).
if (puerta.ruta === 'sigue' && d.aviso && d.aviso.clave === 'otro_pais' && salio === true) { nuevos.avisoPaisMs = ahora; ev.avisoPaisMs = fichaAntes.avisoPaisMs; }
// La ficha: se escribe siempre (también cuando no sale nada), una vez por turno, y solo la de ESTE teléfono.
const fichas = cnMapaDeFichas(true);
if (fichas.sd) {
  const ficha = CN_TENANT.fichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  bmRecordarIds(ficha, [t.mensajeId]);
  ficha.ultimoMs = ahora;
  ficha.turnos = Math.min(ficha.turnos + 1, 100000);
  if (msgs.length) ficha.saludado = true;
  for (const k of Object.keys(nuevos)) ficha[k] = nuevos[k];
  fichas.mapa[from] = CN_TENANT.fichaVigente(ficha, ahora);
  bmBarrer(fichas.mapa, ahora);
  // El tope de la alerta del catálogo se consume solo con un `wamid` REAL: una corrida de prueba sin envío de verdad no lo gasta.
  if (salio === true && cnTodos('Enviar aviso').some(entregado) && typeof av.alertaCatalogo === 'string' && av.alertaCatalogo !== '') bmAnotarAlerta(fichas.sd, av.alertaCatalogo, ahora);
}

const resumen = { plan: tipoDePlan === 'nada' ? (puerta.ruta || 'nada') : tipoDePlan, mensajes: 0, categoria: t.categoria || '', llamadasModelo: llamadasModelo, aviso: avisoPlaneado ? (salio === true ? 'salio' : 'no_salio') : 'ninguno' };
let numero = from;
if (prueba) numero = telPrueba;
// `mensajes` se calcula DESPUÉS de decidir el número: en prueba con un teléfono no permitido (`telPrueba` vacío) no sale nada y el resumen lo dice.
const sale = msgs.length > 0 && numero !== '';
resumen.mensajes = sale ? msgs.length : 0;
if (!sale) return sinSalida(resumen);
const salida = msgs.map((m, i) => {
  m.payload.to = numero;
  const item = {
    para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo,
    tipoReporte: m.tipoReporte, evento: m.evento || '', esInteractivo: m.tipoReporte === 'interactive', esAviso: false,
    // Solo lo que sale al cliente se reporta; en modo prueba, nada.
    reportar: !prueba,
    phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
    plan: resumen.plan, resumen: resumen,
  };
  if (m.reglaCobro === 2) item.reglaCobro = 2;
  if (m.referencia) item.referencia = m.referencia;
  if (m.monto !== undefined) item.monto = m.monto;
  if ((m.evento === 'qr_enviado' || m.evento === 'pedido_sin_cobro') && Array.isArray(m.lineas) && m.lineas.length) { item.lineas = m.lineas; if (m.entrega) item.entrega = m.entrega; }
  // «Resumen del turno» lee esto del primer ítem: lo que no salió vuelve a su valor anterior.
  if (i === 0 && Object.keys(ev).length) item.revertirFicha = ev;
  // Solo el ítem del QR (`qr_enviado`) devuelve el cobro a como estaba si SU envío falla: el texto del resumen puede fallar y el QR salir (el servidor ya abrió el cobro).
  if (tipoDePlan === 'qr' && m.evento === 'qr_enviado') item.revertirSiFalloElPrincipal = { qrHastaMs: ev.qrHastaMs, pedidos: ev.pedidos, qrCarrito: ev.qrCarrito };
  return { json: item };
});
return salida;
