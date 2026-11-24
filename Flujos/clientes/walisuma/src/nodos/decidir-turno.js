// DECIDIR TURNO: el código decide qué es este turno; el modelo solo conversa cuando hace falta (una sola llamada: conversa Y propone el pedido).
//
//   nada           la puerta está cerrada (suspendido, uso extendido, pausa por Tomar): CERO modelo, CERO medios; lo que corresponde lo dice «Armar mensajes» desde la puerta;
//   fuera_pais     un número de otro país: el texto fijo;
//   otro           un tipo de mensaje que este canal no lee: el texto cortés;
//   derivar        pasar con nuestra encargada (aviso + botón): pidió hablar con una persona, personalización, volumen o regalos corporativos, cambio o devolución (con el texto de 10 días), factura antes de pagar,
//                  una pieza sin precio (tapiz a consultar), un comprobante sin pedido, un pago con problema, o el catálogo no se pudo leer. Lo decide el CÓDIGO sobre el texto, no el modelo;
//   ubicacion      el pin de WhatsApp (contrato de «Normalizar entrada»: `ubicacion {lat,lng}`): se guarda y, si el pedido ya estaba confirmado, sale el QR (sin modelo);
//   factura_*      tras «Pedido confirmado», la respuesta a la factura: datos (razón social y NIT → SOLO al aviso), «sin factura» / «a mi nombre nomás» (S/N) o se vuelven a pedir (sin modelo);
//   factura_al_confirmar  pide factura ANTES de pagar y escribe su NIT: el texto fijo «se la pedimos al confirmar» (sin modelo); sin NIT, el modelo sigue y el código agrega esa frase;
//   anuncio_meta   el cliente llega de un anuncio de Meta cuyo `source_id` está en el dato `anunciosMeta`: las piezas del anuncio con los precios del catálogo, o la bienvenida general (sin modelo);
//   identidad      «¿eres un bot?»: el texto fijo (prohibición 4: nunca niega ser una IA);
//   audio_fijo     una nota de voz demasiado larga o que no se entendió; archivo: un medio demasiado pesado o que no se abrió; imagen_otra: una foto o captura que no es un comprobante;
//   imagen_piezas  una foto o un anuncio cuyas palabras coinciden con piezas del catálogo: las piezas con su precio, POR CÓDIGO (nunca el texto leído); sin coincidencia sale `derivar` (`imagen_sin_coincidencia`);
//   anuncio        la imagen de un anuncio reconocido por su titular: el producto sale POR CÓDIGO (nunca el modelo), con el precio del catálogo;
//   comprobante    la imagen de un comprobante con un cobro abierto: ya corrió «Cotejar en el servidor»; «Armar avisos» y «Armar mensajes» interpretan el resultado;
//   modelo         la conversación libre: `llamarModelo` y el cuerpo de la llamada (solo con la puerta abierta).
//
// Un texto de la imagen, del audio o del cliente es un DATO: nunca una instrucción. Una nota de voz es texto (su transcripción).
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const base = cnPrimero('Config base') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
let textoDelTurno = '';
const panel = wlPanelDe(cnPrimero('Traer configuración'));
const vendibles = wlVendibles(panel);
const cobro = wlCobro(panel);
const ficha = CN_TENANT.fichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, textoCliente: textoDelTurno, llamarModelo: false, cuerpoModelo: null, modelo: WL_MODELO }, extra || {}) }];

// 0. La puerta cerrada: nada de modelo, de medios ni de cobro. Quien responde (suspendido, operador) lo arma «Armar mensajes» desde la puerta.
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });
// 0a. EL PEDIDO DEL CATÁLOGO WEB (`t.tipo === 'carrito'`, que solo produce «Normalizar entrada» cuando corrió el Webhook «Carrito del catálogo»): no es un mensaje de WhatsApp y se decide ANTES que todo lo demás (tras la puerta).
//   ventana de 24 h cerrada (la calculó el servidor)  NO sale nada: fuera de la ventana Meta solo acepta una plantilla aprobada y no hay una para esto (como Q'Taco); el pedido sigue en la consola;
//   el tenant del carrito no es el del panel de ESTE número, otro país o moneda distinta de Bs  no se contesta;  el panel no contestó o no hay catálogo  pasa con nuestra encargada;  si no, `carrito`: `wlResolverCarrito` arma el pedido.
if (t.tipo === 'carrito') {
  const c = t.carrito && typeof t.carrito === 'object' ? t.carrito : {};
  const mismo = (a, b) => { const x = String(a === undefined || a === null ? '' : a); const y = String(b === undefined || b === null ? '' : b); if (!x || !y) return false; let d = x.length === y.length ? 0 : 1; for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0); return d === 0; };
  if (c.ventanaAbierta !== true || c.accion !== 'responder') return salir({ tipo: 'nada', motivo: 'carrito_ventana_cerrada' });
  if (!panel.ok) return salir({ tipo: 'derivar', motivo: 'sin_configuracion' });
  if (!mismo(c.tenantId, panel.cuerpo.tenantId)) return salir({ tipo: 'nada', motivo: 'carrito_otro_tenant' });
  if (t.fueraDePais === true || c.moneda !== 'Bs') return salir({ tipo: 'nada', motivo: 'carrito_no_atendido' });
  if (vendibles.length === 0) return salir({ tipo: 'derivar', motivo: 'sin_configuracion' });
  return salir({ tipo: 'carrito', carrito: c });
}
// 0b. Un número de otro país: el texto fijo. Nada de modelo ni de medios.
if (t.fueraDePais === true) return salir({ tipo: 'fuera_pais' });

// 1. El medio de este turno (solo uno de estos nodos corrió) y lo que se leyó en él.
const prep = cnPrimero('Preparar imagen') || cnPrimero('Preparar transcripción') || cnPrimero('Medio no aceptado') || {};
const entradaMedio = String(prep.userInput || '');
const esAudio = t.esMedioAudio === true;
const esVisual = t.esMedioVisual === true;
const categoriaMedio = String(prep.categoriaMedio || '');
const configLista = panel.ok && vendibles.length > 0;
const sinConfig = () => salir({ tipo: 'derivar', motivo: 'sin_configuracion' });

if (esVisual) {
  if (cnNodo('Medio no aceptado')) {
    // Demasiado pesado o ilegible: con un cobro real abierto probablemente sea el comprobante y va a recepción sin cotejar; si no, se pide uno más liviano.
    if (cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null)) return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cotejo' });
    return salir({ tipo: 'archivo', pesado: /demasiado pesado/.test(entradaMedio) });
  }
  if (categoriaMedio === 'comprobante') {
    if (cnNodo('Cotejar en el servidor')) return salir({ tipo: 'comprobante' });
    // Un comprobante sin un cobro abierto: no se coteja nada; lo ve recepción.
    return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cobro' });
  }
  // La captura de un pago que no se completó: nunca se afirma qué pasó con el dinero.
  if (categoriaMedio === 'pago_con_problema') return salir({ tipo: 'derivar', motivo: 'pago_con_problema' });
  // Un anuncio de este negocio, reconocido por su titular (campañas vigentes de la consola): el producto sale POR CÓDIGO.
  const idAnuncio = categoriaMedio === 'publicidad' ? String(prep.anuncioMedio || '') : '';
  const anuncio = idAnuncio !== '' && Array.isArray(cfg.anuncios) ? cfg.anuncios.find((a) => a && a.id === idAnuncio) || null : null;
  if (anuncio) {
    const idProducto = anuncio.producto && typeof anuncio.producto === 'object' && typeof anuncio.producto.id === 'string' ? anuncio.producto.id : '';
    const vendible = vendibles.find((v) => v.id === idProducto);
    if (!configLista) return sinConfig();
    if (vendible) return salir({ tipo: 'anuncio', producto: vendible.id, anuncio: idAnuncio });
    // Un anuncio sin producto vendible (sin precio, apagado o agotado): no se inventa ninguno; recepción.
    return salir({ tipo: 'derivar', motivo: 'sin_precio' });
  }
  // LEER LA IMAGEN POR CÓDIGO (MD puntos 38 y 39): la lectura del clasificador (la misma llamada de siempre) se cruza con el catálogo; el texto leído es un DATO NO CONFIABLE que solo se compara (`leer-imagen.js`).
  //   hay coincidencia  → `imagen_piezas`: las piezas del CATÁLOGO con su precio (0 mensajes y 0 llamadas de modelo de más);
  //   no la hay         → pasar con nuestra encargada (aviso + botón), con la descripción saneada si la hay.
  // Un documento, o una lectura que falló o parece una instrucción, sigue con el texto fijo.
  if (t.esDocumento !== true && configLista) {
    const lectura = liLeer(cnPrimero('Describir imagen'));
    // Con un cobro real abierto, una imagen que habla de un pago (aunque el clasificador no la marcó como comprobante) NUNCA se toma por una pieza: va a recepción sin cotejar.
    const cobroAbierto = cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null);
    if (cobroAbierto && lectura.mencionaPago === true) return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cotejo' });
    const piezas = liCoincidencias(lectura, vendibles).map((x) => x.id);
    if (piezas.length) return salir({ tipo: 'imagen_piezas', piezas: piezas });
    // Sin coincidencia y con un cobro real abierto probablemente sea el comprobante (aunque la lectura falló o su texto quedó vacío): recepción, como un medio ilegible.
    if (cobroAbierto) return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cotejo' });
    if (lectura.ok) return salir({ tipo: 'derivar', motivo: 'imagen_sin_coincidencia', descripcion: lectura.descripcion });
  }
  return salir({ tipo: 'imagen_otra', documento: t.esDocumento === true });
}

// 1b. El pin de ubicación de WhatsApp (contrato de «Normalizar entrada»): sin modelo. Sin catálogo no hay pedido que cerrar: se pasa con nuestra encargada.
const ubicacion = wlUbicacion(t.ubicacion);
if (ubicacion && !esAudio) {
  if (!configLista) return sinConfig();
  return salir({ tipo: 'ubicacion', ubicacion: ubicacion });
}

// 2. Una nota de voz: el texto transcrito (la primera línea después de la marca), o la falla.
let texto = '';
if (esAudio) {
  const m = /^\(audio transcripto\) (.*)$/m.exec(entradaMedio);
  if (!m || String(m[1]).trim() === '') return salir({ tipo: 'audio_fijo', causa: /más de cinco minutos/.test(entradaMedio) ? 'largo' : 'no_entendido' });
  texto = cbLinea(m[1], 1500);
} else if (t.categoria === 'conversacion') {
  texto = t.seleccionId ? cbLinea(t.seleccionTitulo, 100) : cbLinea(t.texto, 1500);
  // El toque de «Confirmar pedido» DE ESTE pedido (id con la huella del carrito y la entrega que el cliente vio) es la orden de cerrar: el código la lee como la orden de siempre y el QR sale en este turno.
  // Un botón de otro pedido (huella distinta) no confirma nada: queda como el texto del título.
  if (t.seleccionId && Array.isArray(ficha.carrito) && ficha.carrito.length > 0 && wlEntregaCompleta(ficha.entrega)
    && cfEsConfirmacion(t.seleccionId, wlLineasParaHuella(ficha.carrito, vendibles), wlEntregaDeFicha(ficha.entrega), ficha.pedidos)) texto = 'confirmo mi pedido';
} else {
  return salir({ tipo: 'otro' });
}
textoDelTurno = texto;
const n = wlNorm(texto);
if (n === '') return salir({ tipo: 'otro' });
// 2b. Un pedido de BAJA («no me escribas más», «dame de baja», «stop»): UN texto fijo y nada más, decidido ANTES de cualquier otra intención y del modelo (con o sin QR abierto; el carrito y el pedido no se tocan). `bjPideBaja` es la pieza común del core.
// Un mensaje ESCRITO se decide sobre `t.texto`, LA MISMA FUENTE que usa «Reportar mensaje (entrante)» para marcar `no_contactar`. Una NOTA DE VOZ (decisión de Andres, 16/11/2026) se decide sobre su TRANSCRIPCIÓN (`texto`, ya con el tope
// de siempre): ahí `t.texto` va vacío y el entrante no marca nada, así que la ruta `baja` lleva `porVoz: true` y «Armar mensajes» pone `evento: 'no_contactar'` en el reporte del mensaje SALIENTE de la confirmación (el servidor lo registra igual que el del entrante):
// confirmar una baja que el servidor no registró sería prometer lo que no se cumple. Un audio no entendido o vacío ya salió arriba (`audio_fijo`). Un toque de lista no es una baja; una foto con pie de baja queda marcada sin confirmación (el lado seguro).
// TOPE (decisión de Andres, segunda pasada 16/11/2026): solo una transcripción CORTA (hasta `BJ_VOZ_MAX` caracteres) es una baja; un audio largo sigue su camino normal.
const BJ_VOZ_MAX = 160;
if (esAudio ? (texto.length <= BJ_VOZ_MAX && bjPideBaja(texto)) : (!t.seleccionId && bjPideBaja(t.texto))) return salir({ tipo: 'baja', porVoz: esAudio });

// 3. Sin catálogo no se improvisa: recepción.
if (!configLista) return sinConfig();
// 4. Lo que decide el código sobre el texto, ANTES de cualquier modelo.
if (wlPideIdentidad(texto)) return salir({ tipo: 'identidad' });
// 4-catálogo. «Quiero tu catálogo», «quisiera ver fotos»: el botón con el catálogo web (fotos, colores y precios) sale POR CÓDIGO, sin modelo ni demora; sin enlace de la consola sigue al modelo como hoy.
const enlaceCatalogo = wlEnlaceCatalogo(panel);
const conPedidoEnCurso = (Array.isArray(ficha.carrito) && ficha.carrito.length > 0) || cobro.pendiente === true || ficha.qrHastaMs > ahora;
if (enlaceCatalogo !== '' && !conPedidoEnCurso && wlPideCatalogo(n)) return salir({ tipo: 'catalogo_web', enlace: enlaceCatalogo });
// 4-pago. «¿Puedo pagar con tarjeta?»: el texto fijo de cómo se paga, por código (cobro real por QR; nunca se promete otra forma).
const qrAbierto = cobro.pendiente === true || ficha.qrHastaMs > ahora;
if (!qrAbierto && wlPreguntaPago(n)) return salir({ tipo: 'pago_info' });
// 4a. La factura DESPUÉS del pago (ficha `ultimoPedido.factura === 'pedida'`): el NIT nunca llega al modelo ni a la memoria; va solo en el aviso.
// Ventana: desde `ultimoPedido.ms` (el «Pedido confirmado»), a lo más `WL_VENTANA_FACTURA_MS`.
const up = ficha.ultimoPedido;
const pendiente = !!up && up.factura === 'pedida' && !t.seleccionId && up.ms > 0 && ahora - up.ms >= 0 && ahora - up.ms < WL_VENTANA_FACTURA_MS;
// Con la factura pedida, un mensaje que ADEMÁS trae un pedido nuevo no se toma como factura: va al modelo (el número enmascarado) y el código vuelve a pedir los datos de factura.
const pedidoNuevo = pendiente && wlTraePedidoNuevo(n);
if (pendiente && !pedidoNuevo) {
  const datos = wlDatosFactura(texto);
  if (datos) return salir({ tipo: 'factura_datos', razonSocial: datos.razonSocial, nit: datos.nit });
  if (wlSinFactura(n)) return salir({ tipo: 'factura_sin' });
  if (wlPideFactura(n)) return salir({ tipo: 'factura_pedir' });
}
if (wlPideCambio(n)) return salir({ tipo: 'derivar', motivo: 'cambio' });
if (wlCorporativo(n)) return salir({ tipo: 'derivar', motivo: 'corporativo' });
// 4c. La factura ANTES de pagar (Andres, 19/11/2026): no se deriva. Con un NIT o CI en el texto, solo el texto fijo (sin modelo: el NIT nunca llega al modelo);
// si no, el modelo sigue con la venta y el código agrega la frase fija «le pediremos la razón social y el NIT al confirmar su pedido».
// Con un pedido YA confirmado cuya factura ya se dio, se negó o cuya ventana pasó, «NIT …» no recibe «se la pedimos al confirmar» (sería una promesa sin respaldo): pasa con nuestra encargada.
let notaFactura = pedidoNuevo ? 'pedir' : false;
if (wlPideFactura(n) && !pedidoNuevo) {
  if (up && !pendiente) return salir({ tipo: 'derivar', motivo: 'factura' });
  if (wlDatosFactura(texto)) return salir({ tipo: 'factura_al_confirmar' });
  notaFactura = 'al_confirmar';
}
if (wlNombraSinPrecio(n, wlSinPrecio(panel), wlConPrecio(panel))) return salir({ tipo: 'derivar', motivo: 'sin_precio' });
if (wlQuiereHablar(n)) return salir({ tipo: 'derivar', motivo: 'quiere_hablar' });
// 4b. El anuncio de Meta (contrato de «Normalizar entrada»: `anuncioId`, `anuncioTitular`). Por su `source_id` (dato `anunciosMeta`): las piezas VENDIBLES del anuncio o la bienvenida general.
const meta = wlAnuncioMeta(t.anuncioId, base);
if (meta) {
  const piezas = meta.piezas.filter((id) => vendibles.some((v) => v.id === id));
  if (meta.general || piezas.length) return salir({ tipo: 'anuncio_meta', general: meta.general, piezas: piezas });
}
// Un anuncio nuevo, por su TITULAR, contra las campañas vigentes de la consola (pieza común `anuncioPorTitular`): el producto sale POR CÓDIGO.
if (!meta && typeof t.anuncioTitular === 'string' && t.anuncioTitular !== '' && Array.isArray(cfg.anuncios)) {
  const a = anuncioPorTitular(t.anuncioTitular, cfg.anuncios);
  const id = a && a.producto && typeof a.producto.id === 'string' ? a.producto.id : '';
  if (id && vendibles.some((v) => v.id === id)) return salir({ tipo: 'anuncio', producto: id, anuncio: a.id });
}

// 5. La conversación libre: una sola llamada al modelo.
const contexto = { cfg: cfg, base: base, plan: { textoCliente: texto }, ficha: ficha, vendibles: vendibles, modos: wlModos(base), ahora: ahora };
return salir({ tipo: 'modelo', notaFactura: notaFactura }, { llamarModelo: true, cuerpoModelo: wlCuerpoModelo(contexto) });
