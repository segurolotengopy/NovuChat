// ARMAR MENSAJES: lo que sale al cliente, armado por CÓDIGO. UN mensaje por turno (el QR agrega su resumen y su imagen cuando se emite), o ninguno.
//
// La decisión es de `bmResolver` (la misma que tomó «Armar avisos»); aquí se arman los mensajes y se escribe la ficha. Según el plan:
//   puerta «suspendido»     el texto neutro del comercio (sin revelar el motivo);   «uso_extendido»  el aviso fijo con el botón para escribirle a recepción (y «Armar avisos» avisó);
//   «bloqueado»             pausa por Tomar: NO SALE NADA (cero envío, cero modelo, cero descarga);
//   «baja»                  el pedido de no recibir más mensajes: UN texto fijo de confirmación y nada más;
//   «fuera_de_pais», «cortes», «identidad», «audio_fijo», «archivo», «imagen_otra», «anuncio»   textos fijos (el producto del anuncio y su precio salen del catálogo);
//   «modelo»                la redacción del modelo, revisada, más el resumen del pedido que calcula el código;
//   «qr»                    el resumen del pedido y el QR REAL del comercio (imagen por id de medio, nunca por enlace) con el monto del carrito; «qr_pendiente» el recordatorio del QR abierto;
//   «comprobante»           «llegó y los datos coinciden» (NUNCA «acreditado» ni «verificado»), con el botón; «comprobante_pedir» pide uno correcto o más nítido;
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

const texto = (cuerpo, extra) => { const x = bmSeguro(cuerpo); return cmMensaje('cliente', cmTexto(x), x, x, Object.assign({ tipoReporte: 'text' }, extra || {})); };
// El botón de recepción: el contacto designado del comercio (o el número de recepción de la consola).
const contacto = cnDigitos(/^REEMPLAZAR_/.test(String(base.contactoAviso || '')) ? '' : base.contactoAviso) || cnDigitos(cfg.numeroRecepcion);
const conRecepcion = (cuerpo) => cmContactoConBoton({ numero: contacto, desde: from, cuerpo: bmSeguro(cuerpo), botonTexto: 'Escribir', saludo: 'Hola, te escribo desde el chat de ' + negocio, textoDelRespaldo: 'Escríbele aquí:' });
const saludo = 'Hola, soy el asistente virtual de ' + negocio + '.';
const conSaludo = (cuerpo) => (fichaAntes.saludado ? cuerpo : saludo + '\n\n' + cuerpo);

let tipoDePlan = d.tipo;
let msgs = [];          // los mensajes de este turno (casi siempre uno)
let llamadasModelo = 0;
let nuevos = {};        // lo que cambia en la ficha
let ev = {};            // lo que se devuelve a la ficha si el envío no sale
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
  else if (tipoDePlan === 'fuera_pais') tipoDePlan = 'fuera_de_pais';
  else if (tipoDePlan === 'otro') tipoDePlan = 'cortes';
}
if (puerta.ruta === 'sigue') {
  if (tipoDePlan === 'fuera_de_pais') {
    msgs = [texto(BM_TEXTO_FUERA_DE_PAIS)];
    nuevos.fueraDePaisMs = ahora; ev.fueraDePaisMs = fichaAntes.fueraDePaisMs;
  } else if (tipoDePlan === 'cortes') {
    msgs = [texto(conSaludo(BM_TEXTO_CORTES))];
  } else if (tipoDePlan === 'baja') {
    // La confirmación de la baja: UN texto fijo (sin saludo, sin botón, sin aviso); el `no_contactar` ya viajó con el entrante. La ficha y el carrito no se tocan.
    msgs = [texto(bjTextoBaja(c.base && c.base.tratamiento === 'usted' ? BM_TEXTO_BAJA_USTED : undefined))];
  } else if (tipoDePlan === 'identidad') {
    msgs = [texto(BM_TEXTO_IDENTIDAD.replace('{NEGOCIO}', negocio))];
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
    llamadasModelo = 1;
    msgs = [texto(conSaludo(d.texto + (d.resumen ? '\n\n' + d.resumen : '') + (d.qrAnulado === true ? '\n\nTu pedido cambió, así que el QR anterior quedó anulado: no pagues con él. Cuando confirmes tu pedido te envío uno nuevo.' : '')))];
    nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle }));
    nuevos.entrega = d.entrega;
    nuevos.cierre = d.cierre === true;
    nuevos.mostrados = d.lineas.map((l) => l.id).concat(fichaAntes.mostrados.filter((x) => !d.lineas.some((l) => l.id === x))).slice(0, 15);
    // La memoria de la charla: sin números largos (NIT, CI, teléfonos).
    const hist = fichaAntes.hist.concat([{ r: 'u', t: bmParaMemoria(c.plan.textoCliente) }, { r: 'm', t: bmParaMemoria(d.texto) }]).filter((x) => x.t !== '');
    nuevos.hist = hist.slice(-BM_RECUERDOS);
    if (d.patch) Object.assign(nuevos, d.patch);
    for (const k of ['carrito', 'entrega', 'cierre', 'mostrados', 'hist', 'qrHastaMs', 'qrCarrito']) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'qr') {
    // Nunca un QR sin monto del carrito, sin id de medio o sin un id de pedido válido: se pasa con recepción (sin decir que se avisó: aquí no hay aviso).
    const lineas = bmConNombres(d.lineas, c.vendibles);
    if (!Number.isSafeInteger(d.total) || d.total <= 0 || d.monto !== d.total / 100 || !/^[A-Za-z0-9_-]{5,100}$/.test(String(d.mediaId || '')) || !/^[A-Za-z0-9]{3,40}$/.test(String(d.pedidoId || ''))) {
      tipoDePlan = 'derivar';
      msgs = [conRecepcion(conSaludo(BM_INTROS.monto_invalido + ' Escríbele a recepción con el botón.'))];
    } else {
      const resumen = (d.cambioDePedido ? 'Actualicé tu pedido.\n\n' : '') + 'Este es el resumen de tu pedido:\n\n' + vcResumen(lineas)
        + '\n\nEntrega: ' + bmEntregaTexto(d.entrega) + '. El total no incluye el costo de entrega.\n\nAbajo va el QR para pagar.';
      const pie = bmSeguro('QR para pagar ' + vcMonto(d.total) + ' (pedido ' + d.pedidoId + '). Cuando pagues, envíame la foto del comprobante por este chat.');
      const respaldo = 'No pude mostrarte el QR en este momento. Escríbeme de nuevo en unos minutos para intentarlo otra vez.';
      const imagen = cmMensaje('cliente', Object.assign(cmBase('image'), { image: { id: d.mediaId, caption: pie } }), pie, respaldo, { tipoReporte: 'image' });
      // El evento que ABRE el cobro: `qr_enviado`, con `referencia` (el pedido) y `monto` (el del carrito, en bolivianos). Cobro real: regla 2 (15 minutos, 3 intentos).
      imagen.evento = 'qr_enviado'; imagen.reglaCobro = 2; imagen.referencia = String(d.pedidoId); imagen.monto = d.monto;
      // Para que el servidor cree el pedido `wa_<referencia>`: el catálogo es externo (NovuTienda) y el servidor no puede recalcularlo, así que viajan el precio y el nombre del CATÁLOGO, calculados aquí.
      // Líneas con la forma CERRADA del catálogo externo (`bmLineasPedido`): id, nombre, cantidad, precio y moneda salen del carrito del código, nunca del modelo.
      { const ls = bmLineasPedido(d.lineas, from); if (ls) { imagen.lineas = ls; imagen.entrega = pqrEntrega({ entrega: d.entrega.modo, direccion: d.entrega.direccion, ciudad: d.entrega.ciudad }); } }
      msgs = [texto(conSaludo(resumen)), imagen];
      nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle }));
      nuevos.entrega = d.entrega; nuevos.cierre = false;
      nuevos.pedidos = fichaAntes.pedidos + 1;
      nuevos.qrHastaMs = ahora + BM_MINUTOS_QR * 60 * 1000;
      nuevos.qrCarrito = d.lineas.map((l) => { const o = { id: l.id, cantidad: l.cantidad, precioCentavos: l.precioCentavos, detalle: l.detalle }; if (l.moneda === 'BOB' || l.moneda === 'ARS') o.moneda = l.moneda; return o; }); // con la moneda: `vcMismoCarrito` la compara
      for (const k of ['carrito', 'entrega', 'cierre', 'pedidos', 'qrHastaMs', 'qrCarrito']) ev[k] = fichaAntes[k];
    }
  } else if (tipoDePlan === 'qr_pendiente') {
    msgs = [texto(conSaludo('Ya tienes un QR abierto por ' + vcMonto(d.total) + '. Cuando pagues, envíame la foto del comprobante por este chat.'))];
    nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle })); nuevos.entrega = d.entrega; ev.carrito = fichaAntes.carrito; ev.entrega = fichaAntes.entrega;
  } else if (tipoDePlan === 'pedido_sin_cobro') {
    const lineas = bmConNombres(d.lineas, c.vendibles);
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
    // Argentina: el pedido se crea en el servidor con `pedido_sin_cobro` (sin QR, sin monto): mismas líneas de forma cerrada y la entrega. Solo viaja si el envío fue aceptado (lo decide el reporte saliente).
    // Bolivia sin QR configurado no lo emite (el evento es de Argentina). El contador sube para que dos pedidos seguidos no repitan la referencia.
    const ls = d.mercado === 'AR' && /^[A-Za-z0-9]{3,40}$/.test(String(d.pedidoId || '')) ? bmLineasPedido(d.lineas, from) : null;
    // El texto que ofrece «pagar» (el alias llega en el turno siguiente) solo sale si el pedido se reportó Y el aviso a recepción salió; si no, sigue el de siempre (el pago lo coordina recepción) sin prometer nada.
    const ofreceAlias = ls !== null && (salio === true || salio === 'repetido');
    msgs = [conRecepcion(conSaludo('Anoté tu pedido:\n\n' + vcResumen(lineas) + '\n\n' + bmTextoDerivacion(d.mercado === 'AR' ? (ofreceAlias ? 'pedido_ar_alias' : 'pedido_ar') : 'pedido_sin_cobro', salio)))];
    if (ls !== null) {
      msgs[0].evento = 'pedido_sin_cobro'; msgs[0].referencia = String(d.pedidoId); msgs[0].lineas = ls;
      msgs[0].entrega = pqrEntrega({ entrega: d.entrega.modo, direccion: d.entrega.direccion, ciudad: d.entrega.ciudad });
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
    msgs = [conRecepcion(bmTextoComprobante(d.resultado, d.diferencia, d.totalTexto, salio))];
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'comprobante_pedir') {
    msgs = [texto(bmTextoComprobante(d.resultado, d.diferencia, d.totalTexto, salio))];
  } else if (tipoDePlan === 'derivar') {
    // Pasar con recepción: el aviso MÁS el botón. «Ya avisé» solo con un `wamid` real; un motivo sin aviso nunca lo dice.
    const cuerpo = d.motivo === 'no_cancelo' ? BM_INTROS.no_cancelo + ' Escríbele a recepción con el botón.'
      : bmTextoDerivacion(d.motivo, salio);
    msgs = [conRecepcion(conSaludo(cuerpo))];
    if (salio === true && d.aviso && d.aviso.tipo === 'consulta') { nuevos.avisoConsultaMs = ahora; ev.avisoConsultaMs = fichaAntes.avisoConsultaMs; }
    // Un pedido cambiado cuyo cobro no se pudo cerrar: el pedido nuevo se conserva (el QR viejo sigue abierto y el cliente ya sabe que no pague con él).
    if (d.motivo === 'no_cancelo' && Array.isArray(d.lineas)) { nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle })); nuevos.entrega = d.entrega; ev.carrito = fichaAntes.carrito; ev.entrega = fichaAntes.entrega; }
    if (d.motivo === 'comprobante_sin_cotejo' && d.patch) { /* sin cotejo: el comprobante llegó; recepción lo ve */ }
    if (d.patch && typeof d.patch === 'object') { Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k]; }
  } else if (tipoDePlan !== 'nada') {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    msgs = [texto(BM_SALUDO_MINIMO)];
  }
}

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
