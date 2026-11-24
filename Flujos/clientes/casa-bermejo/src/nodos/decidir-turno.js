// DECIDIR TURNO: el código decide qué es este turno; el modelo solo conversa cuando hace falta (una sola llamada: conversa Y propone el pedido).
//
//   nada           la puerta está cerrada (suspendido, uso extendido, pausa por Tomar): CERO modelo, CERO medios; lo que corresponde lo dice «Armar mensajes» desde la puerta;
//   (otro país     se atiende como Bolivia y se avisa a la tienda una vez; ya no hay texto fijo de «fuera de país»)
//   otro           un tipo de mensaje que este canal no lee: el texto cortés;
//   derivar        pasar con recepción (aviso + botón): pidió hablar con una persona, volumen o regalos corporativos, factura, algo que el catálogo no tiene (tapiz a consultar), un comprobante sin pedido, un pago con problema,
//                  o el catálogo no se pudo leer. Lo decide el CÓDIGO sobre el texto, no el modelo;
//   identidad      «¿eres un bot?»: el texto fijo (prohibición 4: nunca niega ser una IA);
//   audio_fijo     una nota de voz demasiado larga o que no se entendió; archivo: un medio demasiado pesado o que no se abrió; imagen_otra: una foto o captura que no es un comprobante;
//   anuncio        la imagen de un anuncio reconocido por su titular: el producto sale POR CÓDIGO (nunca el modelo), con el precio del catálogo;
//   comprobante    la imagen de un comprobante con un cobro abierto: ya corrió «Cotejar en el servidor»; «Armar avisos» y «Armar mensajes» interpretan el resultado;
//   entrega_boton  el toque de «Recojo en tienda» o «Envío» (`entrega:retiro` / `entrega:envio`): el CÓDIGO escribe el modo de entrega, SIN modelo; un id inventado o un modo que el comercio no ofrece no cambia nada (`toque_viejo`);
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
const panel = bmPanelDe(cnPrimero('Traer configuración'));
// El catálogo viene de NovuTienda (`Traer catálogo`) y se adapta con `ceVendibles`; la consola solo aporta el cobro, las campañas y la atención.
const catalogo = bmCatalogo(cnPrimero('Traer catálogo'), ahora, base, (ceMercadoDePrefijo(from) || 'BO'));
const vendibles = catalogo.ok === true ? catalogo.vendibles : [];
const cobro = bmCobro(panel);
const ficha = CN_TENANT.fichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);
const esAr = ceMercadoDePrefijo(from) === 'AR';
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, textoCliente: textoDelTurno, llamarModelo: false, cuerpoModelo: null, modelo: BM_MODELO }, extra || {}) }];

// 0. La puerta cerrada: nada de modelo, de medios ni de cobro. Quien responde (suspendido, operador) lo arma «Armar mensajes» desde la puerta.
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });
// 0b. Un número de otro país: se atiende como Bolivia.
// (Un número de otro país ya no se corta aquí: se atiende como Bolivia y «Resolver» avisa a la tienda una vez. Decisión de Andres, 20/11/2026.)

// 1. El medio de este turno (solo uno de estos nodos corrió) y lo que se leyó en él.
const prep = cnPrimero('Preparar imagen') || cnPrimero('Preparar transcripción') || cnPrimero('Medio no aceptado') || {};
const entradaMedio = String(prep.userInput || '');
const esAudio = t.esMedioAudio === true;
const esVisual = t.esMedioVisual === true;
const categoriaMedio = String(prep.categoriaMedio || '');
const configLista = catalogo.ok === true && vendibles.length > 0;
const sinConfig = () => salir({ tipo: 'derivar', motivo: 'sin_configuracion' }, { catalogoMotivo: catalogo.ok === true ? '' : catalogo.motivo, catalogoAlerta: catalogo.ok === true ? false : catalogo.alerta === true });

if (esVisual) {
  if (cnNodo('Medio no aceptado')) {
    // Demasiado pesado o ilegible: con un cobro real abierto probablemente sea el comprobante y va a recepción sin cotejar; si no, se pide uno más liviano.
    if (esAr ? ficha.aliasEstado === 'abierto' : (cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null))) return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cotejo' });
    return salir({ tipo: 'archivo', pesado: /demasiado pesado/.test(entradaMedio) });
  }
  if (categoriaMedio === 'comprobante') {
    // Argentina: el comprobante se coteja contra el pago por alias abierto de ESTE teléfono (`cotejarAliasArs`); sin alias abierto no se coteja nada y lo ve recepción.
    if (esAr) return cnNodo('Cotejar en el servidor') && ficha.aliasEstado === 'abierto' ? salir({ tipo: 'comprobante_alias' }) : salir({ tipo: 'derivar', motivo: 'comprobante_sin_alias' });
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
    return salir({ tipo: 'derivar', motivo: 'quiere_hablar' });
  }
  return salir({ tipo: 'imagen_otra', documento: t.esDocumento === true });
}

// 2. Una nota de voz: el texto transcrito (la primera línea después de la marca), o la falla.
let texto = '';
if (esAudio) {
  const m = /^\(audio transcripto\) (.*)$/m.exec(entradaMedio);
  if (!m || String(m[1]).trim() === '') return salir({ tipo: 'audio_fijo', causa: /más de cinco minutos/.test(entradaMedio) ? 'largo' : 'no_entendido' });
  texto = cbLinea(m[1], 1500);
} else if (t.categoria === 'conversacion' || (t.fueraDePais === true && String(t.texto || '').trim() !== '')) {   // un texto de otro país es conversación; sus medios no se leen
  texto = t.seleccionId ? cbLinea(t.seleccionTitulo, 100) : cbLinea(t.texto, 1500);
} else {
  return salir({ tipo: 'otro' });
}
textoDelTurno = texto;
const n = bmNorm(texto);
if (n === '') return salir({ tipo: 'otro' });
// 2b. Un pedido de BAJA («no me escribas más», «dame de baja», «stop»): UN texto fijo y nada más, decidido ANTES de cualquier otra intención y del modelo (con o sin QR abierto; el carrito y el pedido no se tocan). `bjPideBaja` es la pieza común del core.
// Un mensaje ESCRITO se decide sobre `t.texto`, LA MISMA FUENTE que usa «Reportar mensaje (entrante)» para marcar `no_contactar`. Una NOTA DE VOZ (decisión de Andres, 16/11/2026) se decide sobre su TRANSCRIPCIÓN (`texto`, ya con el tope
// de siempre): ahí `t.texto` va vacío y el entrante no marca nada, así que la ruta `baja` lleva `porVoz: true` y «Armar mensajes» pone `evento: 'no_contactar'` en el reporte del mensaje SALIENTE de la confirmación (el servidor lo registra igual que el del entrante):
// confirmar una baja que el servidor no registró sería prometer lo que no se cumple. Un audio no entendido o vacío ya salió arriba (`audio_fijo`). Un toque de lista no es una baja; una foto con pie de baja queda marcada sin confirmación (el lado seguro).
// TOPE (decisión de Andres, segunda pasada 16/11/2026): solo una transcripción CORTA (hasta `BJ_VOZ_MAX` caracteres) es una baja; un audio largo sigue su camino normal.
const BJ_VOZ_MAX = 160;
if (esAudio ? (texto.length <= BJ_VOZ_MAX && bjPideBaja(texto)) : (!t.seleccionId && bjPideBaja(t.texto))) return salir({ tipo: 'baja', porVoz: esAudio });

// 3a. Argentina, con un pedido anotado y sin un pedido nuevo a medias: el botón «Pagar» (id `pedido:alias`, el único que vale en un toque) o el texto «pagar» pide el alias al servidor (`pedirAliasArs`). No necesita el catálogo.
if (esAr && (ficha.aliasEstado === 'pedido' || ficha.aliasEstado === 'abierto') && ficha.carrito.length === 0 && bmPideAlias(t.seleccionId, n)) return salir({ tipo: 'alias_pedir' });
// 3. Sin catálogo no se improvisa: recepción.
if (!configLista) return sinConfig();
// 4. Lo que decide el código sobre el texto, ANTES de cualquier modelo.
// Ya no hay botón «Ver catálogo» (Andres, 24/11/2026, D7): el asistente muestra las piezas por el chat. `bmEnlaceCatalogo` devuelve '' mientras NovuChat no tenga un enlace propio.
// El toque de «Recojo en tienda» o «Envío»: el modo lo escribe el CÓDIGO, sin modelo. Un id `entrega:` que no es de un botón de este comercio no cambia nada (contesta con el pedido de ahora).
if (typeof t.seleccionId === 'string' && t.seleccionId.indexOf('entrega:') === 0) return salir({ tipo: bmModoDeBoton(t.seleccionId, bmModos(base)) !== '' ? 'entrega_boton' : 'toque_viejo' });
if (bmPideIdentidad(n)) return salir({ tipo: 'identidad' });
if (bmCorporativo(n)) return salir({ tipo: 'derivar', motivo: 'corporativo' });
if (bmPideFactura(n)) return salir({ tipo: 'derivar', motivo: 'factura' });
if (bmQuiereHablar(n) || bmPideDescuento(n)) return salir({ tipo: 'derivar', motivo: 'quiere_hablar' });

// 4b. El toque de «Confirmar pedido» (módulo común Pedidos) con el pedido ya listo: la orden de cierre la da el botón, no el modelo. Sin modelo (0 llamadas); `Resolver` emite el QR en este mismo turno. Sin pedido listo (el botón es de un mensaje viejo) sigue como una conversación normal.
if (Array.isArray(ficha.carrito) && ficha.carrito.length > 0 && cfEsConfirmacion(t.seleccionId, bmLineasParaHuella(ficha.carrito, vendibles), bmEntregaDeFicha(ficha.entrega), ficha.pedidos) && bmEntregaCompleta(ficha.entrega, ceMercadoDePrefijo(from) || 'BO') && bmCarritoVigente(ficha.carrito, vendibles)) return salir({ tipo: 'confirmar' });
// 4c. El toque de un botón «Confirmar pedido» que YA no corresponde (pedido cerrado, o una pieza, un precio o la entrega cambiaron): lo contesta el código con el pedido de ahora, sin modelo y sin cerrar nada.
if (cfEsToqueDeConfirmar(t.seleccionId)) return salir({ tipo: 'toque_viejo' });
// 5. La conversación libre: una sola llamada al modelo.
const contexto = { cfg: cfg, base: base, plan: { textoCliente: texto }, ficha: ficha, vendibles: vendibles, modos: bmModos(base), ahora: ahora, mercado: (ceMercadoDePrefijo(from) || 'BO') };
return salir({ tipo: 'modelo' }, { llamarModelo: true, cuerpoModelo: bmCuerpoModelo(contexto) });
