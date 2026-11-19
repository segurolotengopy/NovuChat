// ARMAR MENSAJES: lo que sale al cliente, armado por CÓDIGO. UN mensaje por turno (el QR agrega su resumen y su imagen cuando se emite), o ninguno.
//
// La decisión es de `wlResolver` (la misma que tomó «Armar avisos»); aquí se arman los mensajes y se escribe la ficha. Según el plan:
//   puerta «suspendido»     el texto neutro del comercio (sin revelar el motivo);   «uso_extendido»  el aviso fijo con el botón para escribirle a recepción (y «Armar avisos» avisó);
//   «bloqueado»             pausa por Tomar: NO SALE NADA (cero envío, cero modelo, cero descarga);
//   «fuera_de_pais», «cortes», «identidad», «audio_fijo», «archivo», «imagen_otra», «anuncio»   textos fijos (el producto del anuncio y su precio salen del catálogo);
//   «modelo»                la redacción del modelo, revisada, más el resumen del pedido que calcula el código;
//   «qr»                    el resumen del pedido y el QR REAL del comercio (imagen por id de medio, nunca por enlace) con el monto del carrito; «qr_pendiente» el recordatorio del QR abierto;
//   «comprobante»           «llegó y los datos coinciden» (NUNCA «acreditado» ni «verificado»), con el botón; «comprobante_pedir» pide uno correcto o más nítido;
//   «pedido_sin_cobro»      sin QR de cobro real: el pedido queda anotado y lo coordina recepción (aviso + botón);
//   «derivar»               pasar con recepción: el aviso MÁS el botón para escribirle directo. «Ya avisé» solo sale si «Enviar aviso» devolvió un `wamid` real.
// SOLO SE OFRECE LO QUE SE CUMPLE: ninguna promesa de «te aviso luego», «te llamamos» o «te escribirán»; el único ofrecimiento es pasar con recepción.
// El botón de recepción va SOLO al derivar. Todo texto pasa por `wlSeguro` (NIEGA_IA y palabras prohibidas del cobro). La ficha (`walisuma[<messages[0].from>]`) se escribe AQUÍ, una vez por turno;
// «Resumen del turno» devuelve a la ficha lo que no salió. NIT y CI no se guardan en ningún lado.
const c = wlContexto();
c.modeloResp = cnPrimero('Conversar con el modelo');
c.cancelo = cnNodo('Avisar al servidor') ? wlCobroCerrado(cnPrimero('Avisar al servidor')) : undefined;
const d = wlResolver(c);
const { cfg, base, t, puerta, from, ahora, ficha: fichaAntes } = c;
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const negocio = wlNombreNegocio(cfg);
const sinSalida = (resumen) => [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen, guardarPlanilla: false, prospectoPlanilla: null } }];
if (!cnClaveValida(from)) return sinSalida({ plan: 'nada', mensajes: 0, categoria: '', llamadasModelo: 0 });

const entregado = (j) => { const m = j && j.messages; return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''; };
// El aviso al comercio: «ya avisé» exige un `wamid` real de «Enviar aviso» (en modo prueba sin envío de verdad, cuenta como salido).
const av = cnPrimero('Armar avisos') || {};
const avisoPlaneado = av.planeado === true;
const avisoEnviado = avisoPlaneado && (cnTodos('Enviar aviso').some(entregado) || (prueba && cfg.enviarDeVerdad !== true));
const salio = avisoEnviado ? true : (av.repetido === true ? 'repetido' : false);

const texto = (cuerpo, extra) => { const x = wlSeguro(cuerpo); return cmMensaje('cliente', cmTexto(x), x, x, Object.assign({ tipoReporte: 'text' }, extra || {})); };
// El botón de nuestra encargada (decisión 6 y MD): «Atención al Cliente» (19 caracteres; `cta_url` admite 20), al contacto designado del comercio (o al número de recepción de la consola),
// con el saludo precargado del MD (dato `saludoBotonDerivacion`). `permiso` (solo `WL_PERMISO_CONFIRMADO`) deja pasar la frase fija «Pedido confirmado» del código.
const contacto = cnDigitos(/^REEMPLAZAR_/.test(String(base.contactoAviso || '')) ? '' : base.contactoAviso) || cnDigitos(cfg.numeroRecepcion);
const saludoBoton = cbLinea(/^REEMPLAZAR_/.test(String(base.saludoBotonDerivacion || '')) ? '' : base.saludoBotonDerivacion, 120) || 'Hola, necesito asistencia con una consulta';
const conRecepcion = (cuerpo, permiso) => cmContactoConBoton({ numero: contacto, desde: from, cuerpo: wlSeguro(cuerpo, permiso), botonTexto: 'Atención al Cliente', saludo: saludoBoton, textoDelRespaldo: 'Escríbale aquí:', sinNumero: 'Eso lo coordina nuestra encargada.' });
// El saludo de la primera respuesta (identidad del MD, sin «IA»: decisión 2) con el ofrecimiento de asesoría y del catálogo por chat (sin enlace: Andres, 19/11/2026).
const saludo = WL_TEXTO_SALUDO.replace('{NEGOCIO}', negocio);
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
    // El texto por defecto de la puerta común tutea: Walisuma usa el suyo, de usted (el que traiga la consola es dato del comercio y se respeta).
    msgs = [conRecepcion(String(puerta.texto).trim() === WL_TEXTO_USO_EXTENDIDO_COMUN ? WL_TEXTO_USO_EXTENDIDO : puerta.texto)];
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
    msgs = [texto(WL_TEXTO_FUERA_DE_PAIS)];
    nuevos.fueraDePaisMs = ahora; ev.fueraDePaisMs = fichaAntes.fueraDePaisMs;
  } else if (tipoDePlan === 'cortes') {
    msgs = [texto(conSaludo(WL_TEXTO_CORTES))];
  } else if (tipoDePlan === 'baja') {
    // La confirmación de la baja: UN texto fijo (sin saludo, sin botón, sin aviso); el `no_contactar` ya viajó con el entrante (si fue una nota de voz, `t.texto` iba vacío: el evento viaja en el reporte de ESTE mensaje saliente). La ficha y el carrito no se tocan.
    msgs = [texto(bjTextoBaja(WL_TEXTO_BAJA), d.porVoz === true ? { evento: 'no_contactar' } : undefined)];
  } else if (tipoDePlan === 'identidad') {
    msgs = [texto(WL_TEXTO_IDENTIDAD.replace('{NEGOCIO}', negocio))];
  } else if (tipoDePlan === 'audio_fijo') {
    msgs = [texto(conSaludo(d.causa === 'largo' ? WL_TEXTO_AUDIO_LARGO : WL_TEXTO_AUDIO_NO_ENTENDIDO))];
  } else if (tipoDePlan === 'archivo') {
    msgs = [texto(conSaludo(d.pesado === true ? WL_TEXTO_ARCHIVO_PESADO : WL_TEXTO_ARCHIVO_NO_ABIERTO))];
  } else if (tipoDePlan === 'imagen_otra') {
    msgs = [texto(conSaludo(d.documento === true ? WL_TEXTO_DOCUMENTO : WL_TEXTO_IMAGEN))];
  } else if (tipoDePlan === 'anuncio') {
    // El producto del anuncio sale POR CÓDIGO y su precio, del catálogo: nunca del modelo ni de la imagen.
    const v = c.vendibles.find((x) => x.id === d.producto);
    if (v) {
      msgs = [texto(conSaludo('Sí, tenemos ' + v.nombre + ': ' + vcMonto(v.precioCentavos) + '.\n\n¿Cuántas unidades desea?'))];
      nuevos.mostrados = fichaAntes.mostrados.filter((x) => x !== v.id).concat([v.id]).slice(-15); ev.mostrados = fichaAntes.mostrados;
    } else {
      tipoDePlan = 'derivar';
      msgs = [conRecepcion(conSaludo(wlTextoDerivacion('sin_precio', false)))];
    }
  } else if (tipoDePlan === 'anuncio_meta') {
    // El anuncio de Meta por su `source_id`: las piezas y sus precios salen del CATÁLOGO (nunca del modelo ni del anuncio).
    const piezas = (Array.isArray(d.piezas) ? d.piezas : []).map((id) => c.vendibles.find((x) => x.id === id)).filter((v) => !!v);
    const cuerpo = d.general === true || !piezas.length ? WL_TEXTO_ANUNCIO_GENERAL.replace('{NEGOCIO}', negocio)
      : WL_TEXTO_ANUNCIO_PIEZAS + '\n' + piezas.map((v) => '• ' + v.nombre + ': ' + vcMonto(v.precioCentavos)).join('\n') + '\n\n¿Cuál le interesa?';
    msgs = [texto(conSaludo(cuerpo))];
    if (piezas.length) { nuevos.mostrados = piezas.map((v) => v.id).concat(fichaAntes.mostrados.filter((x) => !piezas.some((v) => v.id === x))).slice(0, 15); ev.mostrados = fichaAntes.mostrados; }
  } else if (tipoDePlan === 'ubicacion') {
    // El pin guardado (sin pedido confirmado todavía): un agradecimiento fijo; responde a su mensaje (0 mensajes extra).
    msgs = [texto(conSaludo(WL_TEXTO_UBICACION_RECIBIDA))];
    nuevos.entrega = d.entrega; ev.entrega = fichaAntes.entrega;
  } else if (tipoDePlan === 'factura_datos') {
    // Los datos de factura: el aviso a nuestra encargada (lo ÚNICO que lleva el NIT) MÁS el botón; el texto al cliente no repite los datos.
    msgs = [conRecepcion(wlTextoDerivacion('factura_datos', salio))];
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'factura_sin') {
    // «Sin factura» o «a mi nombre nomás» (decisión 10: S/N y NIT 0): el aviso del pedido ya salió con S/N; no se insiste.
    msgs = [texto(WL_TEXTO_FACTURA_SIN)];
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'factura_al_confirmar') {
    // Factura ANTES de pagar con el NIT en el texto: el texto fijo y nada más (sin modelo ni aviso; el NIT no se guarda ni se repite).
    msgs = [texto(conSaludo(WL_TEXTO_FACTURA_AL_CONFIRMAR))];
  } else if (tipoDePlan === 'factura_pedir') {
    msgs = [texto(WL_TEXTO_PIDE_FACTURA)];
  } else if (tipoDePlan === 'modelo' || tipoDePlan === 'pedir_ubicacion') {
    llamadasModelo = 1;
    const anulado = d.qrAnulado === true ? '\n\nSu pedido cambió, así que el QR anterior quedó anulado: no pague con él. Cuando confirme su pedido le enviamos uno nuevo.' : '';
    if (tipoDePlan === 'pedir_ubicacion') {
      // Un ENVÍO sin el pin: el resumen y el pedido de la ubicación con el botón «Enviar ubicación» (`location_request_message`). +1 mensaje por pedido de envío sin GPS.
      const cuerpo = wlSeguro(conSaludo((d.texto ? d.texto + '\n\n' : '') + d.resumen + anulado + '\n\n' + WL_TEXTO_PIDE_UBICACION));
      const payload = Object.assign(cmBase('interactive'), { interactive: { type: 'location_request_message', body: { text: cmRecorte(cuerpo, 1024) }, action: { name: 'send_location' } } });
      msgs = [cmMensaje('cliente', payload, cuerpo, cuerpo, { tipoReporte: 'interactive' })];
    } else {
      msgs = [texto(conSaludo(d.texto + (d.notaFactura === true ? '\n\n' + WL_TEXTO_FACTURA_AL_CONFIRMAR : '') + (d.politicaEnvio ? '\n\n' + d.politicaEnvio : '') + (d.resumen ? '\n\n' + d.resumen : '') + anulado))];
    }
    nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle }));
    nuevos.entrega = d.entrega;
    nuevos.cierre = d.cierre === true;
    nuevos.mostrados = d.lineas.map((l) => l.id).concat(fichaAntes.mostrados.filter((x) => !d.lineas.some((l) => l.id === x))).slice(0, 15);
    // La memoria de la charla: sin números largos (NIT, CI, teléfonos).
    const hist = fichaAntes.hist.concat([{ r: 'u', t: wlParaMemoria(c.plan.textoCliente) }, { r: 'm', t: wlParaMemoria(d.texto || '') }]).filter((x) => x.t !== '');
    nuevos.hist = hist.slice(-WL_RECUERDOS);
    if (d.patch) Object.assign(nuevos, d.patch);
    for (const k of ['carrito', 'entrega', 'cierre', 'mostrados', 'hist', 'qrHastaMs', 'qrCarrito']) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'qr') {
    // Nunca un QR sin monto del carrito, sin id de medio o sin un id de pedido válido: se pasa con recepción (sin decir que se avisó: aquí no hay aviso).
    const lineas = wlConNombres(d.lineas, c.vendibles);
    if (!Number.isSafeInteger(d.total) || d.total <= 0 || d.monto !== d.total / 100 || !/^[A-Za-z0-9_-]{5,100}$/.test(String(d.mediaId || '')) || !/^[A-Za-z0-9_-]{3,40}$/.test(String(d.pedidoId || ''))) {
      tipoDePlan = 'derivar';
      msgs = [conRecepcion(conSaludo(WL_INTROS.monto_invalido + ' Escríbale a nuestra encargada con el botón.'))];
    } else {
      // El QR cobra SOLO los productos. Envío gratis desde el umbral (dato); bajo el umbral se cotiza por fuera: el aviso a recepción (si salió) MÁS el botón; recojo: sin costo de envío.
      const frase = wlFraseEnvio(d.envio, d.umbralBs, d.envio === 'recojo' ? wlDireccionTienda(base, d.entrega.ciudad) : '', false, wlHorarioTiendas(base));
      const aCotizar = d.envio === 'cotizar';
      // Un pedido que cambió con un QR abierto no avisa a recepción (el aviso se arma antes de saber si el cobro anterior se cerró): el texto manda al botón.
      const pieEnvio = !aCotizar ? '' : '\n\n' + (d.cambioDePedido ? 'El costo del envío de este pedido se lo indicará nuestra encargada: escríbale con el botón.' : wlTextoDerivacion('envio_a_cotizar', salio));
      const cabeza = (d.cambioDePedido ? 'Actualizamos su pedido.\n\n' : '') + 'Este es el resumen de su pedido:\n\n';
      const cola = '\n\nEntrega: ' + wlEntregaTexto(d.entrega) + (frase ? '. ' + frase : '.') + pieEnvio + '\n\nAbajo va el QR para pagar.';
      // Bajo el umbral el resumen sale con el botón (cuerpo de a lo más 1.024 caracteres, y el recorte corta el FINAL): se acorta la LISTA de líneas («… y N más»), nunca la cola con la política y el pie. El total siempre queda.
      const filas = vcResumen(lineas).split('\n');
      const filaTotal = filas.length > 0 && /^Total:/.test(filas[filas.length - 1]) ? filas.pop() : '';
      let omitidas = 0;
      if (aCotizar) {
        const reserva = 1000 - (fichaAntes.saludado ? 0 : saludo.length + 2) - cabeza.length - cola.length - (filaTotal ? filaTotal.length + 1 : 0) - 20;
        while (filas.length > 0 && filas.join('\n').length > reserva) { filas.pop(); omitidas++; }
      }
      const resumen = cabeza + filas.concat(omitidas > 0 ? ['… y ' + omitidas + ' más'] : [], filaTotal ? [filaTotal] : []).join('\n') + cola;
      const pie = wlSeguro('QR para pagar ' + vcMonto(d.total) + ' (pedido ' + d.pedidoId + '). Cuando pague, envíenos la foto del comprobante por este chat.');
      const respaldo = 'No pudimos mostrarle el QR en este momento. Escríbanos de nuevo en unos minutos para intentarlo otra vez.';
      const imagen = cmMensaje('cliente', Object.assign(cmBase('image'), { image: { id: d.mediaId, caption: pie } }), pie, respaldo, { tipoReporte: 'image' });
      // El evento que ABRE el cobro: `qr_enviado`, con `referencia` (el pedido) y `monto` (el del carrito, en bolivianos). Cobro real: regla 2 (15 minutos, 3 intentos).
      imagen.evento = 'qr_enviado'; imagen.reglaCobro = 2; imagen.referencia = String(d.pedidoId); imagen.monto = d.monto;
      // Para que el servidor cree el pedido `wa_<referencia>`: solo ids, cantidades y entrega (el servidor recalcula precios y total desde el catálogo).
      // La ubicación del pin viaja en la entrega del pedido (el servidor la acepta: `_pqrUbicacion`). El módulo de pedidos reconoce el envío por la palabra `envio`; los modos de Walisuma («Envío en La Paz»…) se pasan como `envio`.
      { const pqr = pqrCampos(imagen.referencia, d.lineas, { entrega: d.envio === 'recojo' ? d.entrega.modo : 'envio', direccion: d.envio === 'recojo' ? '' : d.entrega.direccion, ciudad: d.entrega.ciudad, ubicacion: d.envio === 'recojo' ? null : d.entrega.ubicacion }, false); if (pqr.lineas) { imagen.lineas = pqr.lineas; imagen.entrega = pqr.entrega; } }
      msgs = [aCotizar ? conRecepcion(conSaludo(resumen)) : texto(conSaludo(resumen)), imagen];
      nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle }));
      nuevos.entrega = d.entrega; nuevos.cierre = false;
      nuevos.pedidos = fichaAntes.pedidos + 1;
      nuevos.qrHastaMs = ahora + WL_MINUTOS_QR * 60 * 1000;
      nuevos.qrCarrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, precioCentavos: l.precioCentavos, detalle: l.detalle }));
      for (const k of ['carrito', 'entrega', 'cierre', 'pedidos', 'qrHastaMs', 'qrCarrito']) ev[k] = fichaAntes[k];
    }
  } else if (tipoDePlan === 'qr_pendiente') {
    msgs = [texto(conSaludo('Ya tiene un QR abierto por ' + vcMonto(d.total) + '. Cuando pague, envíenos la foto del comprobante por este chat.'))];
    nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle })); nuevos.entrega = d.entrega; ev.carrito = fichaAntes.carrito; ev.entrega = fichaAntes.entrega;
  } else if (tipoDePlan === 'pedido_sin_cobro') {
    const lineas = wlConNombres(d.lineas, c.vendibles);
    const fraseSc = wlFraseEnvio(d.envio, d.umbralBs, d.envio === 'recojo' ? wlDireccionTienda(base, d.entrega.ciudad) : '', true, wlHorarioTiendas(base));
    msgs = [conRecepcion(conSaludo('Anotamos su pedido:\n\n' + vcResumen(lineas) + (fraseSc ? '\n\n' + fraseSc : '') + '\n\n' + wlTextoDerivacion('pedido_sin_cobro', salio)))];
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'comprobante') {
    // «Pedido confirmado» (frase fija del código, excepción acotada en `wlSeguro`), el aviso, «fuera de horario» y, en el MISMO mensaje, el pedido de los datos de factura.
    msgs = [conRecepcion(wlTextoComprobante(d.resultado, d.diferencia, d.totalTexto, salio, { codigo: d.codigo, fueraDeHorario: d.fueraDeHorario === true }), WL_PERMISO_CONFIRMADO)];
    Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k];
  } else if (tipoDePlan === 'comprobante_pedir') {
    msgs = [texto(wlTextoComprobante(d.resultado, d.diferencia, d.totalTexto, salio))];
  } else if (tipoDePlan === 'derivar') {
    // Pasar con recepción: el aviso MÁS el botón. «Ya avisé» solo con un `wamid` real; un motivo sin aviso nunca lo dice.
    const cuerpo = d.motivo === 'no_cancelo' ? WL_INTROS.no_cancelo + ' Escríbale a nuestra encargada con el botón.'
      : wlTextoDerivacion(d.motivo, salio);
    msgs = [conRecepcion(conSaludo(cuerpo))];
    // La guarda de 30 minutos cuenta también el aviso de un comprobante sin cotejar o en revisión (de tipo `pedido`).
    if (salio === true && d.aviso && (d.aviso.tipo === 'consulta' || d.motivo === 'comprobante_sin_cotejo' || d.motivo === 'comprobante_en_revision')) { nuevos.avisoConsultaMs = ahora; ev.avisoConsultaMs = fichaAntes.avisoConsultaMs; }
    // Un pedido cambiado cuyo cobro no se pudo cerrar: el pedido nuevo se conserva (el QR viejo sigue abierto y el cliente ya sabe que no pague con él).
    if (d.motivo === 'no_cancelo' && Array.isArray(d.lineas)) { nuevos.carrito = d.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, detalle: l.detalle })); nuevos.entrega = d.entrega; ev.carrito = fichaAntes.carrito; ev.entrega = fichaAntes.entrega; }
    if (d.motivo === 'comprobante_sin_cotejo' && d.patch) { /* sin cotejo: el comprobante llegó; recepción lo ve */ }
    if (d.patch && typeof d.patch === 'object') { Object.assign(nuevos, d.patch); for (const k of Object.keys(d.patch)) ev[k] = fichaAntes[k]; }
  } else if (tipoDePlan !== 'nada') {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    msgs = [texto(WL_SALUDO_MINIMO)];
  }
}

// La ficha: se escribe siempre (también cuando no sale nada), una vez por turno, y solo la de ESTE teléfono.
const fichas = cnMapaDeFichas(true);
if (fichas.sd) {
  const ficha = CN_TENANT.fichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  wlRecordarIds(ficha, [t.mensajeId]);
  ficha.ultimoMs = ahora;
  ficha.turnos = Math.min(ficha.turnos + 1, 100000);
  if (msgs.length) ficha.saludado = true;
  for (const k of Object.keys(nuevos)) ficha[k] = nuevos[k];
  fichas.mapa[from] = CN_TENANT.fichaVigente(ficha, ahora);
  wlBarrer(fichas.mapa, ahora);
}

// LA PLANILLA DEL miniCRM (módulo `crm`): `guardarPlanilla` solo si hay id y hoja, no es el modo prueba, la puerta dejó seguir, la clave es válida, hay un mensaje y el plan es de CONVERSACIÓN (nunca «nada», un número de otro país, el comercio suspendido, el uso extendido ni un cliente bloqueado por Tomar).
// El prospecto se arma con `wlProspectoCrm` (vocabulario cerrado: el texto libre del cliente no pasa). Sin id (vacío), el flujo ni consulta Google. 0 mensajes por conversación.
const planillaOk = String(cfg.planillaProspectosId || '').trim() !== '' && String(cfg.planillaProspectosHoja || '').trim() !== '';
const guardarPlanilla = planillaOk && !prueba && puerta.ruta === 'sigue' && cnClaveValida(from) && msgs.length > 0
  && ['nada', 'fuera_de_pais', 'suspendido', 'uso_extendido', 'bloqueado'].indexOf(tipoDePlan) < 0;
let prospectoPlanilla = null;
if (guardarPlanilla) {
  // LA PLANILLA NUNCA TUMBA LA ATENCIÓN: si calcular el prospecto lanzara por un dato inesperado, este turno igual responde y simplemente no se escribe en la hoja.
  try {
    prospectoPlanilla = wlProspectoCrm({ from: from, tipo: tipoDePlan, plan: d, fichaAntes: fichaAntes, anuncio: t.anuncio === true, avisoSalio: salio === true, nombrePerfil: t.nombrePerfil, ahoraMs: ahora });
  } catch (e) { prospectoPlanilla = null; }
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
    // Solo el ítem 0 lleva el prospecto: un turno con dos mensajes (el resumen y el QR) guarda UN solo prospecto.
    guardarPlanilla: i === 0 && prospectoPlanilla !== null, prospectoPlanilla: i === 0 ? prospectoPlanilla : null,
  };
  if (m.reglaCobro === 2) item.reglaCobro = 2;
  if (m.referencia) item.referencia = m.referencia;
  if (m.monto !== undefined) item.monto = m.monto;
  if (m.evento === 'qr_enviado' && Array.isArray(m.lineas) && m.lineas.length) { item.lineas = m.lineas; if (m.entrega) item.entrega = m.entrega; }
  // «Resumen del turno» lee esto del primer ítem: lo que no salió vuelve a su valor anterior.
  if (i === 0 && Object.keys(ev).length) item.revertirFicha = ev;
  // Solo el ítem del QR (`qr_enviado`) devuelve el cobro a como estaba si SU envío falla: el texto del resumen puede fallar y el QR salir (el servidor ya abrió el cobro).
  if (tipoDePlan === 'qr' && m.evento === 'qr_enviado') item.revertirSiFalloElPrincipal = { qrHastaMs: ev.qrHastaMs, pedidos: ev.pedidos, qrCarrito: ev.qrCarrito };
  return { json: item };
});
return salida;
