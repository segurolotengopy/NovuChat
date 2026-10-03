// PLAN DEL TURNO («Venta mínima v0»): con lo que decidió `Decidir turno` (y lo que extrajo el
// modelo, si hubo extracción) se arma TODO lo que sale del turno: los mensajes, el aviso al
// restaurante, el cierre, el pedido a guardar y el estado nuevo. El modelo solo EXTRAJO datos:
// los totales, las horas, los días y los textos los pone el código.
//
// Qué NO hace: no envía nada, no escribe el estado (lo guarda `Armar mensajes`) ni arma las
// plantillas de aviso (las posee `avisos.js`; acá solo se pide un aviso de tipo `pedido`,
// `comprobante`, `reserva` o `transferencia`, con sus `datos`).
//
// SALIDA (contrato §4.3). `estadoNuevo`; `mensajes` [{tipo: 'texto'|'botones'|'enlace'|'imagen',
// cuerpo, botones, url, evento, referencia, monto}]; `condicionados` {siSalio, siNoSalio} | null
// (los textos que dependen de si el aviso salió: «ya pasé tu pedido» solo sale con el aviso
// enviado); `aviso` {tipo, datos} | null; `pedido` (a guardar); `cierre` {tipo: 'registro',
// detalle, referencia} | null; `ruta`; `errores`. Además, `anotarReserva` (ver el supuesto 4) y `accion`.
//
// LIBRERÍAS QUE LLAMA (contrato §4.2; en la suite van dobles mínimos):
//   comun: vmCfg, vmPrimero, vmNodo, vmSd, vmIdDeBoton, vmLinea, vmRecorte, vmCodigoCorto, vmIdEstable, vmJsonDeGemini, vmSinProhibidas, vmHorarioLegible.
//   pedido: pdCarta, pdExcluidos, pdNombreCorto, pdBotonAgregar, pdTextoExcluido, pdTextoDeLaCarta, pdValidarExtraccion, pdAgregarLineas, pdResolverForma,
//     pdQuitarSinDelivery, pdTotal, pdFaltanEntrega, pdResumen, pdLineaCompacta, pdNuevoPedido y
//     las ayudas ADITIVAS de la versión final de `pedido.js` (T2): pdTextoForma, pdTextoNoEncontrado,
//     pdTextoFaltanEntrega, pdLineasAviso, pdMonto (así los textos del pedido tienen un solo dueño).
//   reserva: rsValidarExtraccion, rsFusionar, rsValidar, rsPreguntaFaltantes, rsResumen,
//     rsLineaCompacta, rsDentroDelTope.   promos: prFicha, prTexto.
//   cobro: cbCaption, cbResultado, cbEstadoParaAviso, cbTextoAlCliente.
//
// SUPUESTOS DECLARADOS (los de la tarea T7a, aprobados por la coordinadora):
//  1. `entrega` = {entrega, modalidad, direccion, referencia, nombre} (`entrega` y `modalidad`
//     valen lo mismo: 'delivery' | 'recojo' | '').
//  2. `pendiente` y `noEncontrados` de `pdAgregarLineas` son listas de {cantidad, producto,
//     opciones: [itemOrden, itemUnidad], …}. Forma final de T2: `pdAgregarLineas` y
//     `pdResolverForma(carrito, pendiente, forma)` devuelven {carrito, pendiente, noEncontrados}; la
//     segunda recibe la LISTA de pendientes y resuelve el primero, y devuelve el resto.
//  3. `aviso.datos`: pedido o comprobante = campos del pedido ({codigo, nombre, telefono,
//     direccion, referencia, lineas: [{cantidad, nombre, detalle}], total (número en Bs),
//     modalidad, mediaId}) más {pedido, resultado, estado, diferencias, from, nombrePerfil};
//     reserva = {from, nombrePerfil, telefono, nombre, codigo, reserva}; transferencia =
//     {from, nombrePerfil, telefono, nombre, codigo, motivo}, donde `motivo` es lo que escribió
//     el cliente (lo pide `avisos.js`) y la razón interna va en `ruta`. `resultado` ∈ cuadra |
//     no_cuadra | ilegible | sin_cotejo | sin_qr | ya_cotejado.
//  4. `rsAnotar` escribe en `sd`, y este nodo no escribe en `sd`: el plan pide `anotarReserva:
//     true` y T7b llama `rsAnotar(sd, from, ahoraMs)` cuando `aviso.tipo === 'reserva'`. SIN
//     ESE LLAMADO EL TOPE DE RESERVAS POR DÍA NO FUNCIONA.
//  5. `botones` = {id, title}. Botón con enlace = {tipo: 'enlace', cuerpo, botones: [{id: '',
//     title: 'Escribir al local'}], url} (url = enlace al número de recepción).
//  6. `accion: 'boton'` con `boton: null` = mostrar el paso actual (botón viejo, «sí» suelto,
//     ubicación, pregunta orden/unidad pendiente).
//  8. El ejemplo del cierre de la carta sale de `pdEjemploDePedido(carta)` (los dos primeros productos del negocio); con la carta
//     sin productos nombrables se omite. Ya no hay un plato de un cliente en el código común (se cerró la deuda de F3).
// SUPUESTOS PROPIOS (a confirmar en la integración):
//  a. Las banderas de capacidad valen solo si son `true`; `aceptaDelivery` y
//     `aceptaRetiroEnLocal` solo se apagan con `false` (la falta del dato es «sí», como en el servidor y en
//     `Config del negocio`). Las áreas y zonas se pasan como arreglo.
//  b. `pdTotal` devuelve el total en Bs (número); `pdResumen` devuelve el texto completo del
//     resumen (con el total y la nota del delivery); `pdNuevoPedido` devuelve {pedidoId, codigo, …};
//     `pdQuitarSinDelivery` devuelve `quitados` como lista de textos o de líneas con `nombre`.
//  c. `rsValidar` recibe `horario` tal cual viene de la configuración (texto), y su `reserva`
//     (con el campo inválido vacío) es lo que se guarda en el estado.
//  d. `cbTextoAlCliente` devuelve {cuerpo, enlace, aviso}; se pasa `ilegibles` contando el
//     comprobante de este turno, y `diferencia` como la lista de diferencias del servidor.
//     `cbResultado(resp, previo)` recibe como `previo` el resultado guardado del pedido ('' si
//     no hay), así un 409 de un QR vencido no se lee como «ya cotejado».
//  e. El pedido de un comprobante se busca primero por la referencia que manda el servidor
//     (`cobro.pedidoRef`, en `sd.pedidos`) y, si no está, en el estado del teléfono. Sin pedido,
//     el comprobante se deriva a una persona.
//  f. «Reenviar QR» no reporta `qr_enviado` otra vez: el servidor ya abrió ese cobro. El mensaje lleva `monto`
//     y `referencia` (para que `Armar mensajes` compruebe el total) y NO lleva `evento`.
//  g. La derivación (`transferir`) SIEMPRE pide el aviso: el tope `topeTransferenciasHora` por teléfono y por hora
//     (por defecto 1; 0 = ninguno) lo aplica `Armar avisos` con la marca que `Armar mensajes` escribe SOLO si el aviso
//     salió. Este nodo no escribe la marca ni suprime nada: si el primer aviso falla, el siguiente se intenta.
//  i. El texto de terceros (dirección, referencia, nombre, notas de las líneas, zona, celebración, requerimiento) se
//     sanea al entrar al estado: las palabras de la red de prohibidas quedan en «[texto omitido]» (`vmSinProhibidas`). Así un texto del
//     cliente («Calle 3 en camino a Obrajes») no traba el mensaje entero. La red de `Armar mensajes` queda para el texto fijo.
//  j. Una ubicación compartida vale como dirección de un delivery: `t.ubicacion` {latitud, longitud} pasa a
//     `entrega.ubicacion` {lat, lng} (solo con delivery y en un paso de pedido) y el restaurante recibe las coordenadas.
//  k. Un resumen con más de 1.024 caracteres se PARTE: UN texto (de hasta 3.800 caracteres) con las líneas y un mensaje
//     corto con el total, la nota del delivery y los botones. Agrega A LO SUMO UN mensaje, solo en pedidos largos (cuesta un
//     mensaje más por esa conversación). Para que las líneas quepan en un solo texto se recortan las notas del resumen y, si
//     aun así no caben, el texto termina en «• … y N más» (el total sigue siendo el de todas las líneas).
//  m. Con el panel sin respuesta (`cfg.panelSinRespuesta`) no se sabe si el local hace delivery ni qué cobro tiene: a mitad de
//     un pedido NO se ofrece ni se afirma nada de la entrega, se deriva (aviso + botón), igual que `aConsulta('delivery')`.
//     COSTO: una consulta de delivery con el panel caído, o un pedido en curso que lo encuentra caído, suma 1 o 2 avisos
//     al restaurante (la plantilla y, con la ventana abierta, el texto de detalle), y 0 mensajes extra al cliente: sale la
//     derivación de siempre (el botón), como hasta ahora.
//  l. El comprobante busca su pedido por la referencia del servidor SOLO en `sd.pedidos` (propio y del mismo teléfono) o,
//     si la referencia es la del pedido del estado, en el estado; si no hay forma, deriva.
//  h. Textos que el diseño no fija (se agregaron los mínimos): avisos de producto quitado por
//     delivery, producto que sigue sin entenderse, consultas fijas (dirección, horario, delivery,
//     promociones), tope de reservas, recordatorio del comprobante, imagen sin pedido, medio no
//     leído. Ninguno usa palabras de `VM_PROHIBIDAS`.
//
//  n. CARRITO Y RESERVA VIVEN POR SEPARADO (03/10): ninguna transición borra uno por pasar al otro (ni el menú, ni la
//     derivación, ni entrar a la reserva, ni volver al pedido). Se limpian solo al confirmar, al cancelar (`d.limpiar`) o cuando
//     vence el estado. Campo nuevo `carritoGuardado` (número): al entrar a una reserva con un carrito en curso vale el número
//     de productos del carrito (que sigue en `carrito`); vuelve a 0 al retomar el pedido o al vaciar el carrito. El nombre se
//     comparte: `entrega.nombre` y `reserva.nombre` se completan uno al otro.
//  o. La derivación deja `paso = 'menu'` (nunca el paso en que estaba): el siguiente mensaje se atiende de nuevo y no vuelve a
//     derivar en bucle. Un medio que no se pudo leer, una imagen sin comprobante pendiente, un producto excluido o no encontrado
//     salen con el botón «Ver la carta» o con los del menú; el botón «Menú» (`m|menu`) lo agrega `Armar mensajes` a todo mensaje
//     interactivo con espacio (no agrega mensajes).
//  p. CATÁLOGO WEB. La carta sale como UN mensaje con el botón «Ver la carta» si hay un enlace válido (`cfg.catalogoWebEnlace`, que
//     trae `Traer configuración`); sin enlace, en texto. El carrito que vuelve de la página (`aCarrito`) se arma por ID desde la
//     carta y sigue por `siguientePasoPedido`: el cliente confirma con el botón, como en un pedido escrito. El mensaje de enlace lleva
//     `catalogo: true` y `Armar mensajes` solo lo manda con su URL si esa marca viene y la URL pasa la misma validación.
//     La nota del carrito vive en `en.entrega.notaPedido` (se borra sola con `limpiarCarrito`) y sale en el resumen y en el pedido avisado.
//
// LÍMITES CONOCIDOS (no se construyen aquí): si el modelo da un sábado para «este viernes», nadie lo
// detecta (el cruce entre el día nombrado y la fecha queda fuera); `q|cancelar` («Cancelar pedido») descarta el
// pedido del estado pero NO avisa al servidor: el cobro que abrió `qr_enviado` queda abierto hasta que vence; el cierre
// `registro` sale aunque el aviso al restaurante no haya salido (no afirma nada del aviso); `cierre.referencia` es
// ESTABLE (B0): el `pedidoId` del pedido o `res-<fecha>-<tel4>-<huella>` de la reserva, nunca el `wamid` del aviso; la
// anotación de la reserva la resuelve T7b según los `wamid` del aviso.
const d = vmPrimero('Decidir turno') || {};
const cfg = vmCfg();
const t = vmPrimero('Interpretar entrada') || {};
const ahora = Number(t.ahoraMs) || Date.now();
// El ancla de las claves estables (B0): el `ultimoMensajeMs` del estado LEIDO que fija `Decidir turno`. Sin ancla (un
// doble de prueba, o sin estado previo) se usa `ahora` y la clave deja de ser estable.
const ancla = Number(d.anclaMs) > 0 ? Number(d.anclaMs) : ahora;
const sd = vmSd();
const en = estadoDe(d.estado);
const errores = Array.isArray(d.errores) ? d.errores.slice() : [];
const monedaTxt = /^(bob|bs\.?)?$/i.test(String(cfg.moneda || '').trim()) ? 'Bs' : String(cfg.moneda).trim();
const pedidosOn = cfg.pedidosActivo === true;
const reservasOn = cfg.reservasActivo === true;
const notas = [];

let mensajes = [];
let condicionados = null;
let aviso = null;
let pedidoGuardar = null;
let cierre = null;
let anotarReserva = false;
let ruta = String(d.accion || '');

despachar();
if (d.accion === 'carta') notaDelPedidoGuardado();
// Al volver a un paso de pedido el carrito guardado deja de estar «guardado»: ya se retomó.
if (en.paso.indexOf('pedido') === 0) en.carritoGuardado = 0;
mensajes = partirLargos(conNotaDelPedido(mensajes));
en.ultimoMensajeMs = ahora;
return [{ json: {
  accion: d.accion, estadoNuevo: en, mensajes: mensajes, condicionados: condicionados, aviso: aviso,
  pedido: pedidoGuardar, cierre: cierre, anotarReserva: anotarReserva, ruta: ruta, errores: errores,
} }];

// =============================================================================================
function despachar() {
  const a = d.accion;
  const b = d.boton && typeof d.boton === 'object' ? d.boton : null;
  if (a === 'menu') return aMenu();
  if (a === 'carta') return aCarta();
  if (a === 'carrito') return aCarrito();
  if (a === 'consulta') return aConsulta(d.consulta);
  if (a === 'promo') return aPromo();
  // Con un comprobante en espera, pedir una persona NO saca al cliente del cobro: el paso y el pedido se conservan.
  if (a === 'transferir') return derivar(d.motivo || 'derivación', en.paso === 'esperando_comprobante' && !!en.pedido);
  if (a === 'identidad') {
    if (en.paso === 'inicio') en.paso = 'menu';
    return (mensajes = [enlace('Soy un asistente virtual con inteligencia artificial de ' + negocio()
      + '. Si prefieres hablar con una persona del restaurante, toca el botón.')]);
  }
  if (a === 'medio_no_leido') return aMedioNoLeido();
  if (a === 'imagen_sin_pendiente') return aImagenSinPendiente();
  if (a === 'fuera_de_horario') return aFueraDeHorario();
  if (a === 'recordatorio_comprobante') return aRecordatorio();
  if (a === 'reenviar_qr') return aReenviarQr();
  if (a === 'comprobante') return aComprobante();
  if (a === 'extraer_pedido') return aExtraerPedido();
  if (a === 'extraer_reserva') return aExtraerReserva();
  if (a === 'boton') return aBoton(b);
  errores.push('accion_desconocida');
  return derivar('acción desconocida');
}

// Al mostrar la carta con un pedido ya empezado, se le dice que sigue ahí (es lo que dejó al irse al menú, a la reserva o a una derivación).
function notaDelPedidoGuardado() {
  const n = en.carrito.reduce((suma, l) => suma + (l && Number.isInteger(l.cantidad) && l.cantidad > 0 ? l.cantidad : 0), 0);
  const primero = mensajes[0];
  if (!n || !primero || typeof primero.cuerpo !== 'string') return;
  const aviso = 'Tu pedido sigue guardado (' + n + (n === 1 ? ' producto' : ' productos') + ').';
  // La carta en texto lleva el aviso en su propio párrafo; la carta como enlace (un solo mensaje con botón) lo lleva al comienzo del cuerpo.
  if (primero.tipo === 'texto') mensajes[0] = Object.assign({}, primero, { cuerpo: aviso + '\n\n' + primero.cuerpo });
  else if (primero.tipo === 'enlace' && primero.catalogo === true) mensajes[0] = Object.assign({}, primero, { cuerpo: aviso + ' ' + primero.cuerpo });
}

// --- Un resumen más largo que un mensaje con botones ---------------------------------------
// Un mensaje con botones admite 1.024 caracteres. Si el resumen del pedido los pasa, `Armar mensajes` lo recortaría y el
// cliente perdería justo lo que confirma: el total. Entonces se PARTE en DOS mensajes, nunca más: UN texto (de hasta 3.800
// caracteres) con el detalle de las líneas y un mensaje corto con «Total de la comida: X Bs.», la nota del delivery (si no
// está incluido) y los botones. `pdResumen` ya recibe un tope para el bloque de líneas (`maxDetalle`: recorta las notas y,
// si hace falta, termina en «• … y N más»), así que el detalle cabe en un solo texto; aquí queda además un tope duro por si
// las notas del turno (`conNotas`) lo empujaran más allá. Es el ÚNICO caso en que el flujo agrega un mensaje: solo en un
// pedido largo (un mensaje más para ese cliente en esa conversación).
// (Las constantes van DENTRO de la función: lo que se declara después del `return` del nodo no llega a inicializarse.)
function partirLargos(lista_) {
  const MAX_CUERPO_BOTONES = 1024;
  const MAX_CUERPO_TEXTO = 3800;
  const salida = [];
  for (const m of (Array.isArray(lista_) ? lista_ : [])) {
    const cuerpo = m && m.tipo === 'botones' ? String(m.cuerpo || '') : '';
    const i = cuerpo.lastIndexOf('\nTotal de la comida:');
    if (cuerpo.length <= MAX_CUERPO_BOTONES || i < 0) { salida.push(m); continue; }
    let detalle = cuerpo.slice(0, i);
    if (detalle.length > MAX_CUERPO_TEXTO) {
      // Tope duro: se corta por línea y se cierra con la marca (nunca un segundo texto).
      const ls = detalle.split('\n');
      let k = ls.length;
      while (k > 1 && (ls.slice(0, k).join('\n') + '\n… y ' + (ls.length - k) + ' líneas más').length > MAX_CUERPO_TEXTO) k--;
      detalle = (ls.slice(0, k).join('\n') + '\n… y ' + (ls.length - k) + ' líneas más').slice(0, MAX_CUERPO_TEXTO);
    }
    salida.push(texto(detalle));
    salida.push(Object.assign({}, m, { cuerpo: cuerpo.slice(i + 1) }));
  }
  return salida;
}

// --- Estado ------------------------------------------------------------------------------
function entregaVacia() { return { entrega: '', modalidad: '', direccion: '', referencia: '', nombre: '' }; }

function estadoDe(e) {
  const s = e && typeof e === 'object' ? JSON.parse(JSON.stringify(e)) : {};
  if (typeof s.paso !== 'string') s.paso = 'inicio';
  if (!Array.isArray(s.carrito)) s.carrito = [];
  if (!Array.isArray(s.pendiente)) s.pendiente = [];
  s.entrega = Object.assign(entregaVacia(), s.entrega && typeof s.entrega === 'object' ? s.entrega : {});
  if (!Array.isArray(s.transferencias)) s.transferencias = [];
  s.vacias = Number(s.vacias) || 0;
  s.ilegibles = Number(s.ilegibles) || 0;
  s.carritoGuardado = Number(s.carritoGuardado) || 0;
  if (!s.reserva || typeof s.reserva !== 'object') s.reserva = null;
  if (!s.pedido || typeof s.pedido !== 'object') s.pedido = null;
  if (!s.pedidoWeb || typeof s.pedidoWeb !== 'object') s.pedidoWeb = null;
  return s;
}

// Cada cosa se limpia por separado y solo al confirmar, cancelar o vencer: nada la borra de paso (ver el supuesto n).
function limpiarCarrito() {
  en.carrito = [];
  en.pendiente = [];
  en.entrega = entregaVacia();
  en.carritoGuardado = 0;
  en.pedidoWeb = null;
}
function limpiarConfirmado() {
  en.pedido = null;
  en.ilegibles = 0;
}
function limpiarReserva() { en.reserva = null; }
// `que` = lo que pide `Decidir turno` al cancelar: 'pedido' (carrito y pedido en espera), 'reserva' o 'todo'.
function limpiarSegun(que) {
  if (que === 'pedido' || que === 'todo') { limpiarCarrito(); limpiarConfirmado(); }
  if (que === 'reserva' || que === 'todo') limpiarReserva();
}
// Cambia de paso sin tocar el carrito ni la reserva.
function irA(paso) {
  en.paso = paso;
  en.vacias = 0;
}

// --- Utilidades de texto --------------------------------------------------------------------
function texto(cuerpo) { return { tipo: 'texto', cuerpo: cuerpo }; }
function conBotones(cuerpo, botones) { return botones.length ? { tipo: 'botones', cuerpo: cuerpo, botones: botones } : texto(cuerpo); }

// Botón con enlace al número de recepción. Sin un número utilizable no hay enlace: se anota.
function enlace(cuerpo) {
  const digitos = String(cfg.numeroRecepcion === undefined || cfg.numeroRecepcion === null ? '' : cfg.numeroRecepcion).replace(/\D/g, '');
  if (digitos.length < 8) errores.push('sin_numero_recepcion');
  return {
    tipo: 'enlace', cuerpo: cuerpo, botones: [{ id: '', title: 'Escribir al local' }],
    url: digitos.length >= 8 ? 'https://wa.me/' + digitos : '',
  };
}

function negocio() { return vmLinea(cfg.nombreNegocio, 60) || 'nuestro restaurante'; }

// Texto de un TERCERO (la dirección, la referencia, las notas, el nombre, la zona): una línea limpia y SIN palabras de la
// red de prohibidas (cambiadas por «…»). Se sanea al entrar al estado, antes de componer ningún mensaje: así «Calle 3 en
// camino a Obrajes» no hace que `Armar mensajes` reemplace el resumen entero por la derivación genérica.
function delCliente(x, max) { return vmSinProhibidas(vmLinea(x, max), max); }

// «Por delivery no enviamos <áreas>.» sale de `areasSinDelivery` (configuración), con el nombre de cada área.
// Sin áreas configuradas no se dice nada: nunca un texto fijo sobre un rubro que el negocio no declaró.
function textoSinDelivery() {
  const areas = lista(cfg.areasSinDelivery).map((a) => vmSinProhibidas(vmLinea(a, 40), 40).toLowerCase());
  return areas.length ? ' Por delivery no enviamos ' + unirY(areas) + '.' : '';
}

function lista(v) {
  const base = Array.isArray(v) ? v : String(v === undefined || v === null ? '' : v).split(/[,;|]/);
  return base.map((x) => String(x).trim()).filter(Boolean);
}
function unir(partes, y) {
  if (partes.length <= 1) return partes.join('');
  return partes.slice(0, -1).join(', ') + ' ' + y + ' ' + partes[partes.length - 1];
}
function unirY(partes) { return unir(partes, 'y'); }

// Antepone las notas del turno (producto quitado, producto no encontrado) al primer mensaje.
function conNotas(lista_) {
  const ms = Array.isArray(lista_) ? lista_ : [];
  if (!notas.length) return ms;
  const previo = notas.join(' ');
  if (!ms.length) return [texto(previo)];
  const primero = Object.assign({}, ms[0], { cuerpo: previo + '\n\n' + ms[0].cuerpo });
  return [primero].concat(ms.slice(1));
}

// ¿Hay una campaña vigente con ficha que mostrar? Solo entonces el menú ofrece «Promociones».
function hayPromociones() {
  if (cfg.promosActivo !== true || !Array.isArray(cfg.campanas) || !cfg.campanas.length) return false;
  try {
    const carta = cartaDelNegocio();
    return cfg.campanas.some((c) => {
      const ficha = prFicha(c, carta, ahora);
      const tx = ficha ? prTexto(ficha, cfg) : null;
      return !!tx && Array.isArray(tx.botones) && tx.botones.length > 0;
    });
  } catch (e) {
    return false;
  }
}

// Los botones del menú: lo que el negocio tiene activo, más «Promociones» si hay una campaña vigente.
function menuBotones() {
  const botones = capacidades();
  if (hayPromociones()) botones.push({ id: vmIdDeBoton('m', 'promos'), title: 'Promociones' });
  return botones;
}
function capacidades() {
  const botones = [];
  if (pedidosOn) botones.push({ id: vmIdDeBoton('m', 'pedido'), title: 'Hacer un pedido' });
  if (reservasOn) botones.push({ id: vmIdDeBoton('m', 'reserva'), title: 'Reservar mesa' });
  return botones;
}

// --- Derivar a una persona -----------------------------------------------------------------
// Lo único que se ofrece ante un error o una consulta sin respuesta: el aviso al restaurante
// MÁS el botón para escribirle (política «solo se ofrece lo que se cumple»). El plan SIEMPRE pide el
// aviso: el tope por teléfono y por hora lo aplica `Armar avisos` leyendo la marca que escribe
// `Armar mensajes` SOLO si el aviso salió (hecho, no dicho). Este nodo ni escribe esa marca ni suprime
// el aviso por su cuenta: si el primer aviso falla (Graph en error), el siguiente SÍ se intenta.
// `conservarPaso` (solo cuando el cliente PIDE una persona con un comprobante en espera): el paso y el pedido quedan como están,
// para que «Reenviar QR» y «Cancelar pedido» sigan funcionando; el texto no manda a «menú» (con un QR pendiente el menú no está
// disponible: solo se ofrece lo que se cumple) y el mensaje sale sin el botón «Menú».
function derivar(razon, conservarPaso) {
  // (Las constantes van DENTRO de la función: lo que se declara después del `return` del nodo no llega a inicializarse.)
  const TEXTO_DERIVACION = 'Esto prefiero que lo vea una persona del restaurante 🙂. Toca «Escribir al local» para hablar con ellos. '
    + (conservarPaso ? 'Tu pedido sigue esperando el comprobante.' : 'Si quieres seguir con tu pedido o tu reserva, escribe «menú».');
  ruta = 'transferir:' + razon;
  aviso = { tipo: 'transferencia', datos: {
    from: t.from, nombrePerfil: t.nombrePerfil, telefono: t.from, nombre: vmLinea(t.nombrePerfil, 60),
    codigo: vmCodigoCorto(ahora),
    // Una foto sin pie no trae texto: el comprobante derivado por el cambio de modo lleva un motivo fijo para que el restaurante sepa qué es.
    motivo: vmLinea(d.texto, 300) || (/^el modo de cobro cambió: comprobante/.test(razon) ? 'comprobante recibido con el modo de cobro cambiado' : ''),
  } };
  // El paso queda en `menu` y no se borra nada: el siguiente mensaje se atiende de nuevo (antes, un paso de pedido volvía a
  // derivar cada mensaje) y el cliente retoma su pedido o su reserva escribiendo «menú». Con un comprobante en espera
  // (`conservarPaso`) el paso no cambia.
  if (!conservarPaso) irA('menu');
  mensajes = [conservarPaso ? Object.assign(enlace(TEXTO_DERIVACION), { sinMenu: true }) : enlace(TEXTO_DERIVACION)];
  condicionados = null;
  return null;
}

// --- Menú, carta, consultas, promoción ------------------------------------------------------
function aMenu() {
  // Con un comprobante en espera, «menú» NO saca al cliente del cobro: el paso y el pedido se conservan y se vuelve a mostrar el
  // recordatorio (con «Reenviar QR» y «Cancelar pedido»). El menú no se ofrece: sus botones no valen con un QR pendiente. Solo
  // «Cancelar pedido» (`d.limpiar`) lleva al menú, y borra el pedido.
  if (en.paso === 'esperando_comprobante' && en.pedido && !d.limpiar) {
    if (d.motivo) ruta = 'menu:' + d.motivo;
    return aRecordatorio();
  }
  irA('menu');
  if (d.limpiar) limpiarSegun(d.limpiar);
  if (d.motivo) ruta = 'menu:' + d.motivo;
  const botones = menuBotones();
  if (capacidades().length === 0) return derivar('sin capacidades activas');
  // Con una sola capacidad no hay nada que elegir: se va directo a ella.
  if (capacidades().length === 1) return pedidosOn ? aCarta() : iniciarReserva();
  const asistente = vmLinea(cfg.nombreAsistente, 40);
  // `sinMenu`: el menú ya es el menú; `Armar mensajes` no le agrega el botón «Menú».
  mensajes = [Object.assign(conBotones('¡Hola! 👋 Soy ' + (asistente ? asistente + ', el asistente virtual' : 'el asistente virtual')
    + ' de ' + negocio() + '. ¿Qué te gustaría hacer?', botones), { sinMenu: true })];
}

function cartaDelNegocio() {
  return pdCarta(Array.isArray(cfg.catalogo) ? cfg.catalogo : [], { areasExcluidas: lista(cfg.areasExcluidas), moneda: cfg.moneda });
}

// Los mensajes de la carta, o null (y se deriva) si no hay carta cargada.
// LA CARTA COMO ENLACE (catalogo web): si hay un enlace VALIDO (`enlace`, o el que trajo la consola en `cfg.catalogoWebEnlace`),
// la carta sale como UN mensaje con el boton «Ver la carta» que abre la pagina (el servidor recalcula los precios y escribe el
// pedido; el carrito vuelve por `aCarrito`). Sin enlace —la consola no lo dio, el catalogo esta apagado, un 409, un timeout o una
// URL que no pasa la validacion— sale la carta en texto de siempre: solo se ofrece lo que se cumple. Un solo mensaje en los dos casos.
function mensajesDeCarta(enlace) {
  const carta = cartaDelNegocio();
  if (!carta.length) return derivar('carta sin cargar');
  const crudo = enlace === undefined ? cfg.catalogoWebEnlace : enlace;
  const url = urlDelCatalogo(crudo);
  if (url) {
    return [{
      tipo: 'enlace', catalogo: true,
      cuerpo: 'Esta es nuestra carta. Elige ahí tus productos y vuelve al chat para confirmar el pedido, o escríbeme lo que quieres. Si quieres seguir con tu pedido o tu reserva, escribe «menú».',
      botones: [{ id: '', title: 'Ver la carta' }], url: url,
    }];
  }
  if (typeof crudo === 'string' && crudo.trim() !== '') errores.push('catalogo_url_invalida');
  const partes = pdTextoDeLaCarta(carta, { moneda: monedaTxt, max: 3500 });
  if (!Array.isArray(partes) || !partes.length) return derivar('carta sin texto');
  // El ejemplo sale de los dos primeros productos de la carta del negocio: nunca un plato de un cliente en el código común.
  const ejemplo = pdEjemploDePedido(carta);
  const cierreTxt = 'Escríbeme en un mensaje qué quieres y cuántos' + (ejemplo ? ' (por ejemplo: «' + ejemplo + '»)' : '')
    + ' y si es para delivery o para recoger.' + textoSinDelivery();
  return partes.map((p, i) => {
    const inicio = i === 0 ? 'Esta es nuestra carta:\n\n' : '';
    const fin = i === partes.length - 1 ? '\n\n' + cierreTxt : '';
    return texto(inicio + p + fin);
  });
}

function aCarta() {
  const m = mensajesDeCarta();
  if (!m) return;
  // Después de la carta, cualquier texto es un pedido (aunque no diga «quiero»).
  en.paso = 'pedido';
  mensajes = m;
}

function aConsulta(clave) {
  let cuerpo = '';
  if (clave === 'direccion') {
    const x = vmLinea(cfg.direccion, 200);
    cuerpo = x ? 'Estamos en ' + x + '.' : '';
  } else if (clave === 'horario') {
    const x = vmLinea(cfg.horarioAtencion, 200);
    cuerpo = x ? 'Atendemos ' + x + '.' : '';
  } else if (clave === 'delivery') {
    // Con el panel sin respuesta no se sabe si hay delivery: no se afirma ni se niega, se pasa con el local.
    if (cfg.panelSinRespuesta === true) cuerpo = '';
    else if (cfg.aceptaDelivery === false) cuerpo = cfg.aceptaRetiroEnLocal === false ? '' : 'Por ahora no hacemos delivery: puedes recoger tu pedido en el local.';
    else cuerpo = 'Sí, hacemos delivery.' + textoSinDelivery();
  } else if (clave === 'promociones') {
    const camp = Array.isArray(cfg.campanas) ? cfg.campanas : [];
    const carta = cfg.promosActivo === true ? cartaDelNegocio() : [];
    for (let i = 0; i < camp.length; i++) {
      const ficha = prFicha(camp[i], carta, ahora);
      const tx = ficha ? prTexto(ficha, cfg) : null;
      if (tx && Array.isArray(tx.botones) && tx.botones.length) {
        if (en.paso === 'inicio') en.paso = 'menu';
        return (mensajes = [conBotones(tx.cuerpo, tx.botones)]);
      }
    }
    cuerpo = 'Por ahora no tengo promociones para mostrarte.';
  }
  if (!cuerpo) return derivar('consulta sin dato cargado');
  en.paso = 'menu';
  mensajes = [conBotones(cuerpo, menuBotones())];
}

function aPromo() {
  // Con un comprobante en espera, el texto de una campaña NO saca del cobro: se recuerda el comprobante (el paso y el pedido se conservan).
  if (en.paso === 'esperando_comprobante' && en.pedido) return aRecordatorio();
  const carta = cartaDelNegocio();
  const ficha = prFicha(d.campana, carta, ahora);
  const tx = ficha ? prTexto(ficha, cfg) : null;
  // Sin ficha (producto agotado, excluido o sin precio) o sin botones, es el menú normal.
  if (!tx || !Array.isArray(tx.botones) || !tx.botones.length) {
    ruta = 'menu:promo_sin_ficha';
    return aMenu();
  }
  irA('menu');
  mensajes = [{ tipo: 'botones', cuerpo: tx.cuerpo, botones: tx.botones }];
}

function aImagenSinPendiente() {
  const cuerpo = '¡Gracias por la imagen! Por aquí solo leo comprobantes de un pedido con QR, y ahora no tienes ninguno pendiente. ¿Qué te gustaría hacer?';
  if (en.paso === 'inicio') en.paso = 'menu';
  mensajes = [conBotones(cuerpo, capacidades())];
}

// Un audio que no se entendió, un sticker, un contacto…: se pide que lo escriba, con la carta a un toque.
function aMedioNoLeido() {
  const cuerpo = d.motivo === 'audio'
    ? 'No pude escuchar bien ese mensaje 😅. ¿Me lo escribes?'
    : 'No pude entender bien ese mensaje 😅. ¿Me lo escribes?';
  mensajes = [conBotones(cuerpo, pedidosOn ? [{ id: vmIdDeBoton('m', 'pedido'), title: 'Ver la carta' }] : [])];
}

function aFueraDeHorario() {
  // El texto de la consola manda; sin él, el horario de la configuración dicho en palabras (`vmHorarioLegible`).
  const h = vmLinea(cfg.horarioAtencion, 200) || vmLinea(vmHorarioLegible(cfg.horario), 200);
  const cuerpo = 'Por ahora no estamos tomando pedidos 🕒.' + (h ? ' Atendemos ' + h + '.' : '');
  irA('menu');
  mensajes = [conBotones(cuerpo, reservasOn ? [{ id: vmIdDeBoton('m', 'reserva'), title: 'Reservar mesa' }] : [])];
}

// --- Botones ---------------------------------------------------------------------------------
function aBoton(b) {
  if (!b) return mostrarPaso();
  const p0 = String(b.partes[0] === undefined ? '' : b.partes[0]);
  if (b.tipo === 'm' && p0 === 'reserva') return iniciarReserva();
  if (b.tipo === 'g' && p0 === 'agregar') return sumarItem(String(b.partes[1]), Number(b.partes[2]));
  if (b.tipo === 'g') return pedirItem(String(b.partes[1]));
  if (b.tipo === 'f') return resolverForma(Number(p0), String(b.partes[1]));
  if (b.tipo === 'e') {
    ponerModalidad(p0);
    return mostrarPedido();
  }
  if (b.tipo === 'p' && p0 === 'cambiar') {
    // «Cambiar algo» reinicia el carrito y la modalidad (la reserva no se toca); la dirección y el nombre ya dados se conservan.
    const e = en.entrega;
    limpiarCarrito();
    irA('pedido');
    en.entrega = Object.assign(entregaVacia(), { direccion: e.direccion, referencia: e.referencia, nombre: e.nombre });
    if (e.ubicacion) en.entrega.ubicacion = e.ubicacion;
    const m = mensajesDeCarta();
    if (m) mensajes = m;
    return;
  }
  if (b.tipo === 'p' && p0 === 'confirmar') return confirmarPedido();
  if (b.tipo === 'r' && p0 === 'enviar') return enviarReserva();
  if (b.tipo === 'r' && p0 === 'corregir') return evaluarReserva(en.reserva || {});
  return mostrarPaso();
}

// La ubicación compartida vale como dirección del delivery. `Interpretar entrada` la emite como {latitud, longitud} y
// `pdFaltanEntrega` espera {lat, lng}: acá se traduce, solo en un pedido con delivery. Sin esto el cliente compartía su
// ubicación y el asistente le volvía a pedir la dirección por escrito.
function tomarUbicacion() {
  const u = t.ubicacion;
  if (!u || typeof u !== 'object' || typeof u.latitud !== 'number' || typeof u.longitud !== 'number') return;
  if (!isFinite(u.latitud) || !isFinite(u.longitud) || Math.abs(u.latitud) > 90 || Math.abs(u.longitud) > 180) return;
  if (en.paso.indexOf('pedido') !== 0 || en.entrega.entrega !== 'delivery') return;
  en.entrega.ubicacion = { lat: u.latitud, lng: u.longitud };
}

// Vuelve a mostrar el paso actual (botón viejo, «sí» suelto, ubicación, pregunta pendiente).
function mostrarPaso() {
  ruta = 'boton:' + (d.motivo || 'paso_actual');
  if (d.motivo === 'ubicacion') tomarUbicacion();
  const p = en.paso;
  if (p === 'inicio' || p === 'menu') return aMenu();
  if (p === 'esperando_comprobante') return aRecordatorio();
  if (p.indexOf('reserva') === 0) return evaluarReserva(en.reserva || {});
  return mostrarPedido();
}

// =============================================================================================
// PEDIDO
// =============================================================================================
function modalidades() {
  const m = [];
  if (cfg.aceptaDelivery !== false) m.push('delivery');
  if (cfg.aceptaRetiroEnLocal !== false) m.push('recojo');
  return m;
}

function ponerModalidad(m) {
  en.entrega.entrega = m;
  en.entrega.modalidad = m;
}

// Un producto de un área sin delivery se quita ANTES de pedir la entrega o los datos. Con
// recojo se queda. Idempotente: lo ya quitado no vuelve a salir.
function quitarSinDelivery() {
  const areas = lista(cfg.areasSinDelivery);
  if (en.entrega.entrega !== 'delivery' || !areas.length || !en.carrito.length) return;
  const r = pdQuitarSinDelivery(en.carrito, cartaDelNegocio(), areas);
  if (r && Array.isArray(r.carrito)) en.carrito = r.carrito;
  const quitados = r && Array.isArray(r.quitados)
    ? r.quitados.map((q) => (typeof q === 'string' ? q : (q && q.nombre) || '')).filter(Boolean) : [];
  if (quitados.length) {
    notas.push('Por delivery no enviamos ' + unirY(quitados) + ': ' + (quitados.length > 1 ? 'los' : 'lo') + ' quité de tu pedido.');
  }
}

function preguntaForma() {
  const p = en.pendiente[0];
  return {
    tipo: 'botones',
    cuerpo: pdTextoForma(p, { moneda: monedaTxt }),
    botones: [
      { id: vmIdDeBoton('f', 0, 'orden'), title: 'Orden' },
      { id: vmIdDeBoton('f', 0, 'unidad'), title: 'Sueltos' },
    ],
  };
}

// Lo que no entró al carrito: un producto EXCLUIDO a propósito (área excluida) tiene su texto amable y no es una búsqueda fallida.
function textoNoEncontrados(lista_) {
  return lista_.slice(0, 3).map((e) => (e && e.motivo === 'excluido' && e.excluido
    ? pdTextoExcluido(pdNombreCorto(e.excluido), { nivelEmojis: cfg.nivelEmojis })
    : pdTextoNoEncontrado(e))).join(' ');
}

// El mensaje de cuando NADA de lo pedido se pudo tomar: el texto, «Agregar <producto>» solo si hay UNA sugerencia clara, y
// «Ver la carta». (El botón «Menú» lo agrega `Armar mensajes`.)
function mensajeNoEncontrado(noEnc) {
  const botones = [];
  const e = noEnc.length === 1 ? noEnc[0] : null;
  if (e && e.motivo === 'ninguno' && Array.isArray(e.sugerencias) && e.sugerencias.length === 1) {
    const agregar = pdBotonAgregar(e.sugerencias[0], e.cantidad);
    if (agregar) botones.push(agregar);
  }
  botones.push({ id: vmIdDeBoton('m', 'pedido'), title: 'Ver la carta' });
  return conBotones(textoNoEncontrados(noEnc), botones);
}

// El paso que sigue según lo que ya hay en el estado. Devuelve los mensajes, o null si derivó.
function siguientePasoPedido() {
  // Con el panel sin respuesta no se sabe si hay delivery (ni qué cobro tiene el local): no se ofrece ni se afirma, se deriva.
  if (cfg.panelSinRespuesta === true) return derivar('panel sin respuesta: no se sabe si hay delivery');
  quitarSinDelivery();
  if (en.pendiente.length) {
    en.paso = 'pedido';
    return [preguntaForma()];
  }
  if (!en.carrito.length) {
    en.paso = 'pedido';
    return mensajesDeCarta();
  }
  const perm = modalidades();
  if (!perm.length) return derivar('el local no acepta delivery ni recojo');
  if (perm.indexOf(en.entrega.entrega) < 0) {
    if (perm.length === 1) {
      ponerModalidad(perm[0]);
      return siguientePasoPedido();
    }
    en.paso = 'pedido_entrega';
    return [{ tipo: 'botones', cuerpo: '¿Es para delivery o para recoger en el local?', botones: [
      { id: vmIdDeBoton('e', 'delivery'), title: 'Delivery' },
      { id: vmIdDeBoton('e', 'recojo'), title: 'Recoger en el local' },
    ] }];
  }
  if (en.entrega.entrega === 'delivery') {
    const faltan = pdFaltanEntrega(en.entrega, t.nombrePerfil);
    if (faltan.length) {
      en.paso = 'pedido_datos';
      return [texto(pdTextoFaltanEntrega(faltan))];
    }
  }
  if (!en.entrega.nombre) en.entrega.nombre = vmLinea(t.nombrePerfil, 60);
  en.paso = 'pedido_confirmar';
  return [{ tipo: 'botones', cuerpo: pdResumen(en.carrito, en.entrega, { moneda: monedaTxt, nombrePerfil: t.nombrePerfil, maxDetalle: 3000 }), botones: [
    { id: vmIdDeBoton('p', 'confirmar'), title: 'Confirmar pedido' },
    { id: vmIdDeBoton('p', 'cambiar'), title: 'Cambiar algo' },
  ] }];
}

function mostrarPedido() {
  const m = siguientePasoPedido();
  if (m) mensajes = conNotas(m);
}

// Lo que el cliente escribió en una línea (el producto pedido y su nota) se sanea; cantidad y forma las valida `pdValidarExtraccion`.
function lineaSaneada(l) {
  return Object.assign({}, l, { producto: delCliente(l.producto, 120), detalle: delCliente(l.detalle, 120) });
}

function agregarLineas(lineas) {
  const carta = cartaDelNegocio();
  const excluidos = pdExcluidos(Array.isArray(cfg.catalogo) ? cfg.catalogo : [], { areasExcluidas: lista(cfg.areasExcluidas), moneda: cfg.moneda });
  // Quinto parámetro: `palabrasExcluidas` (datos), para reconocer «helado», «cerveza», «cóctel»… aunque esos ítems estén inactivos y el servidor no los mande.
  const r = pdAgregarLineas(en.carrito, carta, lineas, excluidos, lista(cfg.palabrasExcluidas)) || {};
  if (Array.isArray(r.carrito)) en.carrito = r.carrito;
  const lista1 = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
  en.pendiente = en.pendiente.concat(lista1(r.pendiente));
  // Una palabra que el negocio no vende, escrita como nota de una linea que SI entra: la linea se conserva y se le dice cual no se incluyo.
  for (const q of lista1(r.notasQuitadas).slice(0, 3)) notas.push('«' + vmLinea(q.palabra, 40) + '» no lo podemos incluir en tu pedido.');
  return lista1(r.noEncontrados);
}

// «Pedir la promo» y el botón «Agregar <producto>» de una sugerencia SUMAN al carrito que ya hay (no lo reinician).
function pedirItem(id) { return sumarItem(id, 1); }

function sumarItem(id, cantidad) {
  const item = cartaDelNegocio().find((i) => String(i.id) === id);
  if (!item) {
    ruta = 'menu:item_no_disponible';
    return aMenu();
  }
  irA('pedido');
  agregarLineas([{ producto: item.nombre, cantidad: Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 1, forma: '', detalle: '' }]);
  mostrarPedido();
}

function resolverForma(i, forma) {
  // Solo se pregunta la primera: `pdResolverForma` resuelve `pendiente[0]` y devuelve el resto.
  if (i !== 0 || !en.pendiente.length) return mostrarPedido();
  const r = pdResolverForma(en.carrito, en.pendiente, forma);
  if (!r || !Array.isArray(r.carrito) || !Array.isArray(r.pendiente)) {
    errores.push('forma_no_resuelta');
    return derivar('no se pudo resolver orden o unidad');
  }
  en.carrito = r.carrito;
  en.pendiente = r.pendiente;
  const falto = Array.isArray(r.noEncontrados) && r.noEncontrados.length ? textoNoEncontrados(r.noEncontrados) : '';
  if (falto) notas.push(falto);
  mostrarPedido();
}

function aExtraerPedido() {
  const j = vmJsonDeGemini(vmPrimero('Extraer'));
  if (!j) {
    errores.push('extraccion_invalida');
    return derivar('el modelo no devolvió un pedido legible');
  }
  const x = pdValidarExtraccion(j);
  if (x.quiereHablar === true) return derivar('pidió hablar con una persona');
  const lineas = Array.isArray(x.lineas) ? x.lineas : [];
  const datosEntrega = ['entrega', 'direccion', 'referencia', 'nombre'].some((k) => x[k]);
  if (!lineas.length && !datosEntrega) {
    // Dos extracciones seguidas sin nada que tomar: se pasa con el local.
    en.vacias += 1;
    if (en.vacias >= 2) return derivar('dos mensajes seguidos sin líneas de pedido');
    const m = en.carrito.length || en.pendiente.length ? siguientePasoPedido() : mensajesDeCarta();
    if (m) {
      if (!en.carrito.length) en.paso = 'pedido';
      mensajes = m;
    }
    return;
  }
  en.vacias = 0;
  if (x.entrega && modalidades().indexOf(x.entrega) >= 0) ponerModalidad(x.entrega);
  ['direccion', 'referencia', 'nombre'].forEach((k) => { if (x[k]) en.entrega[k] = delCliente(x[k], 160); });
  const noEnc = lineas.length ? agregarLineas(lineas.map(lineaSaneada)) : [];
  const falto = noEnc.length ? textoNoEncontrados(noEnc) : '';
  const agrego = lineas.length > noEnc.length;
  if (noEnc.length && !agrego && (!datosEntrega || !(en.carrito.length || en.pendiente.length))) {
    // Nada de lo pedido se pudo tomar: solo se dice qué pasó (sin repetir la carta), con la carta a un toque. Si ya había
    // un pedido en curso se queda donde estaba (sus botones siguen valiendo, y la pregunta pendiente vuelve a salir).
    if (en.paso.indexOf('pedido') !== 0) irA('pedido');
    return (mensajes = [mensajeNoEncontrado(noEnc)]);
  }
  if (falto) notas.push(falto);
  mostrarPedido();
}

// El pedido a guardar y a avisar: los campos del código (nunca un precio del modelo).
// La huella del carrito (ids, cantidades, notas Y la modalidad de entrega): si el cliente lo cambia despues de llegar de la pagina (otra cantidad,
// un producto de mas, una bebida quitada por delivery, o retiro por delivery), ya no es el pedido que escribio el checkout y deja de usar su
// id: la consola diria una entrega y el aviso otra. La modalidad se fija en `aCarrito` con la de la pagina; si el local no la ofrece y el flujo
// toma otra, la huella no coincide y el pedido conserva su id propio.
function huellaDelCarrito() {
  return vmHuella(en.carrito.map((l) => String(l.id) + 'x' + String(l.cantidad) + '|' + String(l.detalle || '')).join(';') + '#' + String(en.entrega.entrega || ''));
}

function armarPedido() {
  const total = pdTotal(en.carrito);
  if (!(total > 0)) return null;
  let nuevo = pdNuevoPedido(t.from, t.nombrePerfil, en.carrito, en.entrega, total, monedaTxt, ahora, ancla) || {};
  if (!nuevo.pedidoId) return null;
  // Un pedido que llego de la pagina y sigue intacto conserva el `cat_…` del checkout; el codigo sale de ESE id (estable al reconfirmar).
  const web = en.pedidoWeb;
  if (web && web.id && web.huella === huellaDelCarrito()) {
    nuevo = Object.assign({}, nuevo, { pedidoId: web.id, codigo: vmCodigoCorto(vmHuella('cat|' + web.id)) });
  }
  const delivery = en.entrega.entrega === 'delivery';
  // Con una ubicación compartida el restaurante recibe las coordenadas (con coma decimal, que no se confunde con un enlace),
  // en su propio campo: `Avisos` las pone en su propio segmento y la dirección no las arrastra ni las corta.
  const u = en.entrega.ubicacion;
  const coordenadas = delivery && u && isFinite(u.lat) && isFinite(u.lng)
    ? 'ubicación compartida (' + u.lat.toFixed(5).replace('.', ',') + '; ' + u.lng.toFixed(5).replace('.', ',') + ')' : '';
  return Object.assign({}, nuevo, {
    lineas: pdLineasAviso(en.carrito),
    total: total, modalidad: en.entrega.entrega, moneda: monedaTxt,
    nombre: en.entrega.nombre || vmLinea(t.nombrePerfil, 60), direccion: delivery ? en.entrega.direccion : '', coordenadas: coordenadas,
    notaPedido: en.entrega.notaPedido || '', // la nota del carrito del catalogo web (texto del cliente, ya saneado)
    referencia: delivery ? en.entrega.referencia : '',
    from: t.from, nombrePerfil: t.nombrePerfil,
  });
}

function datosDePedido(ped, resultado, diferencias) {
  return Object.assign({}, ped, {
    pedido: ped, resultado: resultado, estado: cbEstadoParaAviso(resultado), diferencias: diferencias || [],
    from: t.from, nombrePerfil: t.nombrePerfil, telefono: t.from,
  });
}

function mensajeDeCb(r) { return r.enlace ? enlace(r.cuerpo) : texto(r.cuerpo); }

function confirmarPedido() {
  // Sin respuesta del panel no se confirma nada: no se sabe si hay delivery ni qué cobro corresponde (se deriva).
  if (cfg.panelSinRespuesta === true) return derivar('panel sin respuesta: no se confirma el pedido');
  // Si falta algo (carrito, forma, entrega, datos), se muestra lo que falta: no se confirma.
  quitarSinDelivery();
  const completo = en.pendiente.length === 0 && en.carrito.length > 0 && en.entrega.entrega
    && !(en.entrega.entrega === 'delivery' && pdFaltanEntrega(en.entrega, t.nombrePerfil).length);
  if (!completo) return mostrarPedido();
  const ped = armarPedido();
  if (!ped) {
    errores.push('pedido_sin_total');
    return derivar('no se pudo armar el pedido');
  }
  const cobro = cfg.cobro && typeof cfg.cobro === 'object' ? cfg.cobro : {};
  const simulado = cobro.modo === 'simulado';
  const conQr = cbHayQr(cobro);
  if (conQr) {
    const pie = cbCaption(ped, { titular: simulado ? '' : cobro.titular, moneda: monedaTxt, delivery: ped.modalidad === 'delivery', simulado: simulado });
    if (pie) {
      // El monto del QR es el del código; el servidor coteja el comprobante contra ESE número (en simulado no se coteja nada).
      // El pedido guarda el modo con que se mandó el QR: un comprobante o un reenvío con otro modo vigente no se acepta.
      const pedConModo = Object.assign({}, ped, { simulado: simulado });
      mensajes = [{ tipo: 'imagen', cuerpo: pie, url: cobro.qrUrl, evento: 'qr_enviado', referencia: ped.pedidoId, monto: ped.total }];
      pedidoGuardar = pedConModo;
      limpiarCarrito();
      irA('esperando_comprobante');
      en.ilegibles = 0;
      en.pedido = pedConModo;
      ruta = simulado ? 'pedido:qr_simulado' : 'pedido:qr';
      return;
    }
    errores.push('qr_sin_pie');
  }
  // Plan B (sin QR real): el pedido va al restaurante y el pago se coordina con él.
  const base = { codigo: ped.codigo, entrega: ped.modalidad };
  const salio = cbTextoAlCliente('sin_qr', Object.assign({ avisoSalio: true }, base));
  const noSalio = cbTextoAlCliente('sin_qr', Object.assign({ avisoSalio: false }, base));
  pedidoGuardar = Object.assign({}, ped, { resultado: 'sin_qr', estado: cbEstadoParaAviso('sin_qr') });
  aviso = { tipo: 'pedido', datos: datosDePedido(pedidoGuardar, 'sin_qr', []) };
  condicionados = { siSalio: [mensajeDeCb(salio)], siNoSalio: [mensajeDeCb(noSalio)] };
  cierre = { tipo: 'registro', detalle: vmRecorte('Pedido #' + ped.codigo + ' (sin QR, ' + ped.modalidad + '): '
    + pdLineaCompacta(en.carrito, 200) + '. Total ' + pdMonto(ped.total, monedaTxt) + '.', 300), referencia: ped.pedidoId };
  mensajes = [];
  ruta = 'pedido:sin_qr';
  limpiarCarrito();
  irA('menu');
}

// =============================================================================================
// COMPROBANTE
// =============================================================================================
function aRecordatorio() {
  const ped = en.pedido;
  if (!ped) return derivar('esperando comprobante sin pedido en el flujo');
  // El texto lo decide EL PEDIDO (`ped.simulado`, fijado al mandar su QR), no el modo vigente: un pedido real nunca se rotula «SIMULADO».
  const sim = ped.simulado === true;
  // H3: Meta puede aceptar `image.link` y fallar DESPUES (estado `failed` asincrono) y el respaldo en texto no cubre ese fallo: el recordatorio
  // simulado lleva el enlace de la imagen (ya validado como https) para que el cliente la abra. Solo con el modo simulado vigente y un QR
  // utilizable; nunca el QR del cobro real.
  const cobroVigente = cfg.cobro && typeof cfg.cobro === 'object' ? cfg.cobro : {};
  const enlaceQr = sim && cobroVigente.modo === 'simulado' && cbHayQr(cobroVigente) ? ' Si no ves el QR, ábrelo aquí: ' + String(cobroVigente.qrUrl).trim() : '';
  const cuerpo = sim
    ? 'Estoy esperando el comprobante SIMULADO de tu pedido #' + ped.codigo + ' (es una prueba: no se paga nada). Envíame aquí cualquier foto, o usa los botones.' + enlaceQr
    : 'Estoy esperando el comprobante de tu pedido #' + ped.codigo + '. Envíame aquí la foto o el PDF, o usa los botones.';
  mensajes = [{ tipo: 'botones',
    cuerpo: cuerpo,
    botones: [
      { id: vmIdDeBoton('q', 'reenviar'), title: 'Reenviar QR' },
      { id: vmIdDeBoton('q', 'cancelar'), title: 'Cancelar pedido' },
    ], sinMenu: true }];
}

function aReenviarQr() {
  const ped = en.pedido;
  const cobro = cfg.cobro && typeof cfg.cobro === 'object' ? cfg.cobro : {};
  const simulado = cobro.modo === 'simulado';
  // Un pedido cuyo QR salió en otro modo (el cobro cambió entre la confirmación y el reenvío) no se reenvía con el modo de ahora.
  if (ped && (ped.simulado === true) !== simulado) return derivar('el modo de cobro cambió: no se reenvía el QR');
  const pie = ped && cbHayQr(cobro) ? cbCaption(ped, { titular: simulado ? '' : cobro.titular, moneda: monedaTxt, delivery: ped.modalidad === 'delivery', simulado: simulado }) : '';
  if (!pie) return derivar('no se pudo reenviar el QR');
  // Lleva el monto y la referencia del pedido para que `Armar mensajes` compruebe el total, pero NO el evento
  // `qr_enviado`: el servidor ya abrió ese cobro y reenviar la imagen no lo reabre.
  mensajes = [{ tipo: 'imagen', cuerpo: pie, url: cobro.qrUrl, monto: ped.total, referencia: ped.pedidoId }];
}

function aComprobante() {
  const cobro = cfg.cobro && typeof cfg.cobro === 'object' ? cfg.cobro : {};
  const ref = String(cobro.pedidoRef || '');
  const guardados = sd && sd.pedidos && typeof sd.pedidos === 'object' ? sd.pedidos : {};
  // La referencia del servidor se busca SOLO entre los pedidos propios de `sd.pedidos` y solo si el pedido es de ESTE
  // teléfono (`hasOwnProperty`: «constructor» o «__proto__» no son un pedido; otro teléfono tampoco). Si la referencia
  // no sirve y el pedido del estado no es ese mismo, no se coteja contra otro pedido: se deriva.
  let ped = null;
  if (ref) {
    const propio = Object.prototype.hasOwnProperty.call(guardados, ref) ? guardados[ref] : null;
    if (propio && typeof propio === 'object' && String(propio.from) === String(t.from)) ped = propio;
    else if (en.pedido && String(en.pedido.pedidoId) === ref) ped = en.pedido;
  } else {
    ped = en.pedido;
  }
  if (!ped || !ped.pedidoId) return derivar('comprobante sin pedido en el flujo');

  // COBRO SIMULADO: la foto es el comprobante de la prueba. NUNCA se coteja en el servidor (no distingue modos: daría «no cuadra» y
  // un cierre de venta con monto) ni se lee con Gemini. Un pedido SIMULADO que ya no espera su comprobante (cancelado o terminado) se trata como una
  // imagen sin pendiente. Un pedido REAL (salió con el cobro real y el modo pasó a simulado) NO entra a esta rama: su foto puede ser un pago, así
  // que sigue el camino del cobro real SIN cotejo (`sin_cotejo`: «no pude revisarlo», aviso de comprobante con la foto al restaurante, que lo revisa
  // en su banco); nunca se rotula «SIMULADO», nunca se descarta como imagen sin pendiente, y el cliente no queda esperando.
  // Un segundo comprobante del mismo pedido (simulado) no repite el
  // aviso ni el cierre (`ya_cotejado`). El cierre es un `registro` de PRUEBA, sin monto.
  if (t.comprobanteSimulado === true && !vmNodo('Cotejar en el servidor') && ped.simulado === true) {
    if (ped.resultado !== 'simulado' && en.paso !== 'esperando_comprobante') return aImagenSinPendiente();
    const resSim = ped.resultado === 'simulado' ? 'ya_cotejado' : 'simulado';
    const baseSim = { codigo: ped.codigo, entrega: ped.modalidad };
    const conA = cbTextoAlCliente(resSim, Object.assign({ avisoSalio: true }, baseSim));
    ruta = 'comprobante:' + resSim;
    if (!conA.aviso) {
      mensajes = [mensajeDeCb(conA)];
      // «Ya tengo el comprobante» no cambia el paso si el cliente ya no esta esperando uno (empezo otro pedido): solo cierra un cobro en espera.
      if (en.paso === 'esperando_comprobante') { limpiarConfirmado(); irA('menu'); }
      return;
    }
    const sinA = cbTextoAlCliente(resSim, Object.assign({ avisoSalio: false }, baseSim));
    pedidoGuardar = Object.assign({}, ped, { resultado: 'simulado', estado: cbEstadoParaAviso('simulado'), diferencias: [], mediaId: '', cierreId: '' });
    aviso = { tipo: 'comprobante', datos: Object.assign(datosDePedido(pedidoGuardar, 'simulado', []), { mediaId: '' }) };
    condicionados = { siSalio: [mensajeDeCb(conA)], siNoSalio: [mensajeDeCb(sinA)] };
    cierre = { tipo: 'registro', referencia: ped.pedidoId,
      detalle: vmRecorte('PRUEBA · cobro SIMULADO (sin dinero) · Pedido #' + ped.codigo + ' (' + (ped.modalidad || '—') + '). Total ' + pdMonto(ped.total, monedaTxt) + '.', 300) };
    mensajes = [];
    limpiarConfirmado();
    irA('menu');
    return;
  }

  // Segunda cerradura (la primera es `comprobanteCruzado` en `Interpretar entrada`): un pedido SIMULADO nunca se coteja ni se avisa como real.
  if (ped.simulado === true) return derivar('el modo de cobro cambió: comprobante de un pedido simulado', en.paso === 'esperando_comprobante' && !!en.pedido);

  let resultado = 'sin_cotejo';
  let diferencias = [];
  let cierreId = '';
  if (vmNodo('Cotejar en el servidor')) {
    const c = cbResultado(vmPrimero('Cotejar en el servidor'), String(ped.resultado || ''));
    resultado = c.resultado;
    diferencias = c.diferencias || [];
    cierreId = c.cierreId || '';
  } else {
    const lectura = vmPrimero('Interpretar lectura');
    if (lectura && lectura.legible === false) resultado = 'ilegible';
  }
  const ilegibles = resultado === 'ilegible' ? en.ilegibles + 1 : en.ilegibles;
  const base = { codigo: ped.codigo, diferencia: diferencias, ilegibles: ilegibles, entrega: ped.modalidad };
  const conAviso = cbTextoAlCliente(resultado, Object.assign({ avisoSalio: true }, base));
  ruta = 'comprobante:' + resultado;

  if (!conAviso.aviso) {
    // Primer comprobante ilegible (se pide de nuevo) o uno ya cotejado: sin aviso.
    mensajes = [mensajeDeCb(conAviso)];
    if (resultado === 'ilegible') {
      en.ilegibles = ilegibles;
      en.pedido = en.pedido || ped;
      en.paso = 'esperando_comprobante';
    } else {
      limpiarConfirmado();
      irA('menu');
    }
    return;
  }
  const sinAviso = cbTextoAlCliente(resultado, Object.assign({ avisoSalio: false }, base));
  pedidoGuardar = Object.assign({}, ped, {
    resultado: resultado, estado: cbEstadoParaAviso(resultado), diferencias: diferencias, mediaId: String(t.mediaId || ''), cierreId: cierreId,
  });
  aviso = { tipo: 'comprobante', datos: Object.assign(datosDePedido(pedidoGuardar, resultado, diferencias), { mediaId: String(t.mediaId || '') }) };
  condicionados = { siSalio: [mensajeDeCb(conAviso)], siNoSalio: [mensajeDeCb(sinAviso)] };
  mensajes = [];
  limpiarConfirmado();
  irA('menu');
}

// =============================================================================================
// RESERVA
// =============================================================================================
function limitesReserva() {
  return {
    horario: cfg.horario, zonas: lista(cfg.zonasReserva), maxPersonas: cfg.maxPersonasReserva,
    anticipacionMin: cfg.anticipacionReservaMin, maxDias: cfg.maxDiasReserva,
  };
}

// Entrar a la reserva desde otro paso: un carrito en curso queda guardado (sigue en `carrito`; `carritoGuardado` dice cuántos
// productos tiene y el aviso sale UNA vez, en el primer mensaje de la reserva) y el nombre ya dado en el pedido se aprovecha.
function entrarAReserva() {
  if (en.paso.indexOf('reserva') === 0) return;
  const n = en.carrito.reduce((suma, l) => suma + (l && Number.isInteger(l.cantidad) && l.cantidad > 0 ? l.cantidad : 0), 0);
  if (n > 0) {
    en.carritoGuardado = n;
    notas.push('Guardé tu pedido (' + n + (n === 1 ? ' producto' : ' productos')
      + '). Cuando termines la reserva, escribe «carta» para seguir con el pedido.');
  }
  if (en.entrega.nombre && !(en.reserva && en.reserva.nombre)) en.reserva = Object.assign({}, en.reserva || {}, { nombre: en.entrega.nombre });
}

function iniciarReserva() {
  entrarAReserva();
  irA('reserva');
  // Una reserva que ya estaba a medias se retoma donde quedó; si no, se empieza por las preguntas.
  if (en.reserva) return evaluarReserva(en.reserva);
  mensajes = conNotas([texto(rsPreguntaFaltantes(['personas', 'fecha', 'hora', 'nombre'], { zonas: lista(cfg.zonasReserva) }))]);
}

// Valida lo que hay y muestra lo que sigue: el error concreto, lo que falta, o el resumen.
function evaluarReserva(reserva) {
  const v = rsValidar(reserva || {}, limitesReserva(), t.nombrePerfil, ahora);
  en.reserva = v.reserva;
  en.paso = 'reserva';
  // El nombre se comparte: el de la reserva completa al del pedido (si no tenía).
  if (v.reserva && v.reserva.nombre && !en.entrega.nombre) en.entrega.nombre = delCliente(v.reserva.nombre, 60);
  if (v.error) {
    // Sin horario cargado no se puede tomar ninguna solicitud: se pasa con el local.
    if (v.error.campo === 'horario') return derivar('reservas sin horario cargado');
    mensajes = conNotas([texto(v.error.texto)]);
    return v;
  }
  if (!v.completa) {
    const pregunta = rsPreguntaFaltantes(v.faltan, { zonas: lista(cfg.zonasReserva) });
    if (!pregunta) return derivar('reserva incompleta sin pregunta');
    mensajes = conNotas([texto(pregunta)]);
    return v;
  }
  en.paso = 'reserva_confirmar';
  mensajes = conNotas([{ tipo: 'botones', cuerpo: rsResumen(v.reserva), botones: [
    { id: vmIdDeBoton('r', 'enviar'), title: 'Enviar solicitud' },
    { id: vmIdDeBoton('r', 'corregir'), title: 'Corregir' },
  ] }]);
  return v;
}

function aExtraerReserva() {
  const j = vmJsonDeGemini(vmPrimero('Extraer'));
  if (!j) {
    errores.push('extraccion_invalida');
    return derivar('el modelo no devolvió una reserva legible');
  }
  const x = rsValidarExtraccion(j);
  ['zona', 'nombre', 'celebracion', 'requerimiento'].forEach((k) => { x[k] = delCliente(x[k], 200); });
  entrarAReserva();
  evaluarReserva(rsFusionar(en.reserva || {}, x));
}

function enviarReserva() {
  // El tiempo pasó desde el resumen: se vuelve a validar antes de avisar.
  const v = rsValidar(en.reserva || {}, limitesReserva(), t.nombrePerfil, ahora);
  if (v.error || !v.completa) return evaluarReserva(en.reserva || {});
  // Una solicitud más allá del tope diario: texto de tope y botón, sin aviso.
  if (!rsDentroDelTope(sd, t.from, ahora, Number(cfg.topeReservasDia))) {
    ruta = 'reserva:tope';
    limpiarReserva();
    irA('menu');
    return (mensajes = [enlace('Por hoy ya no puedo tomar más solicitudes de reserva por aquí 🙏. Escríbele al restaurante con el botón.')]);
  }
  const reserva = v.reserva;
  // La referencia y el codigo salen del ancla y de los datos de la reserva (no del reloj): un doble toque en «Enviar solicitud»
  // da el mismo codigo y la misma referencia de cierre, y el servidor cuenta UN cierre.
  const clave = vmIdEstable('res', t.from, reserva, ancla, ahora);
  const codigo = clave.codigo;
  const nombre = String(reserva.nombre || '').split(' ')[0];
  aviso = { tipo: 'reserva', datos: {
    from: t.from, nombrePerfil: t.nombrePerfil, telefono: t.from, nombre: reserva.nombre, codigo: codigo, reserva: reserva,
  } };
  condicionados = {
    siSalio: [enlace('Listo, ' + nombre + ': tu solicitud de reserva llegó al restaurante. Todavía es una solicitud: el restaurante la revisa según sus mesas. Si quieres hablar con ellos, toca el botón.')],
    siNoSalio: [enlace('No pude hacer llegar tu solicitud al restaurante en este momento. Escríbeles con el botón para reservar.')],
  };
  cierre = { tipo: 'registro', detalle: vmRecorte('Solicitud de reserva #' + codigo + ': ' + rsLineaCompacta(reserva, 'completo'), 300), referencia: clave.id };
  anotarReserva = true;
  mensajes = [];
  ruta = 'reserva:enviada';
  limpiarReserva();
  irA('menu');
}

// =============================================================================================
// CARRITO DEL CATALOGO WEB
// =============================================================================================
// La URL del catalogo, o '' si no sirve. LA MISMA FORMA que `amUrlSegura` de `Armar mensajes` (https, host por segmentos con un dominio de
// primer nivel alfabetico —sin IP, sin `localhost`, SIN puerto—, sin usuario ni `<>"'@` en la ruta, hasta 2.000 caracteres): lo que
// `Armar mensajes` rechazaria cae aca a la carta en texto, y no a la derivacion generica. Tampoco vale un anfitrion de WhatsApp (`wa.me`,
// `whatsapp.com`): el enlace de la carta es la pagina, nunca el chat de alguien. Sin `URL` (en el Code de n8n no existe; el 23/09/2026 un
// `new URL` en un `try/catch` dejo sin enlace a un cliente con un 200 bueno): solo `String`, `RegExp` y `Array`. El host se compara por
// segmentos, nunca por subcadena.
function urlDelCatalogo(v) {
  if (typeof v !== 'string') return '';
  const u = v.trim();
  if (u === '' || u.length > 2000) return '';
  const m = /^https:\/\/([A-Za-z0-9.-]{1,253})([/?#][^\s<>"'@]*)?$/.exec(u);
  if (!m) return '';
  const segmentos = m[1].toLowerCase().split('.');
  if (segmentos.length < 2) return '';
  if (!segmentos.every((s) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(s))) return '';
  if (!/^[A-Za-z]{2,63}$/.test(segmentos[segmentos.length - 1])) return '';
  const base = segmentos.slice(-2).join('.');
  if (base === 'wa.me' || base === 'whatsapp.com') return '';
  return u;
}

// El id de una linea del carrito, con la misma forma que el id de `pdCarta` (sin «|» ni espacios, hasta 60 caracteres).
function idDeCarrito(v) {
  return typeof v === 'string' ? v.replace(/[|\s]+/g, '-').slice(0, 60) : '';
}

// La cantidad de una linea: entero de 1 a `PD_MAX_CANTIDAD`; 0 si no es un numero utilizable.
function cantidadDeCarrito(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, PD_MAX_CANTIDAD) : 0;
}

// «Tu nota: …» (la del carrito del catalogo) va en el resumen, justo antes del total. Se aplica a todo resumen del turno, no solo al del
// carrito: la direccion que falta se pide en otro turno y el resumen vuelve a salir con la nota del cliente.
function conNotaDelPedido(lista_) {
  const nota = en.entrega && typeof en.entrega.notaPedido === 'string' ? en.entrega.notaPedido : '';
  if (!nota || !Array.isArray(lista_)) return lista_;
  return lista_.map((m) => (m && m.tipo === 'botones' && String(m.cuerpo).indexOf('\nTotal de la comida:') > 0
    // Con una FUNCION de reemplazo: la nota es texto del cliente y un `$&`, `$'` o `$\`` suyo no se interpreta como patron de reemplazo.
    ? Object.assign({}, m, { cuerpo: String(m.cuerpo).replace('\nTotal de la comida:', () => '\nTu nota: ' + nota + '\nTotal de la comida:') }) : m));
}

// El pedido que volvio de la pagina. EL CODIGO CALCULA: cada linea se busca POR ID en la carta del panel (nunca por el nombre ni por
// el precio que traiga el carrito), la cantidad se acota y el total lo hace `pdTotal`. Lo que no esta en la carta (un area excluida
// como cocteleria, un item dado de baja) no se vende: se nombra en la respuesta. Si el total del servidor difiere, manda el del flujo
// y la diferencia queda en `errores`. Despues sigue el flujo de siempre (`siguientePasoPedido`): el cliente confirma con el boton.
function aCarrito() {
  const c = t.carrito && typeof t.carrito === 'object' ? t.carrito : {};
  if (String(d.motivo || '').indexOf('carrito_') === 0) {
    // Nada que contestar (ventana cerrada, otro comercio, pedidos apagados): sin mensajes, sin aviso y sin tocar el estado.
    errores.push(String(d.motivo));
    ruta = 'nada';
    return;
  }
  // Un carrito nuevo reemplaza el pedido en curso; una reserva a medias sobrevive (`limpiarCarrito` no la toca). El nombre, la
  // dirección y la referencia ya dados se conservan (como en «Cambiar algo»): el carrito no trae el nombre del cliente y, sin
  // esto, un pedido para recoger llegaba a cocina sin nombre.
  const entregaPrevia = en.entrega;
  limpiarCarrito();
  limpiarConfirmado();
  irA('pedido');
  en.entrega = Object.assign(entregaVacia(), { direccion: entregaPrevia.direccion, referencia: entregaPrevia.referencia, nombre: entregaPrevia.nombre });
  if (entregaPrevia.ubicacion) en.entrega.ubicacion = entregaPrevia.ubicacion;

  const carta = cartaDelNegocio();
  const lineas = [];
  const fuera = [];
  const recortadas = [];
  for (const it of (Array.isArray(c.items) ? c.items.slice(0, 50) : [])) {
    const x = it && typeof it === 'object' ? it : {};
    const nombre = delCliente(x.nombre, 80) || 'un producto';
    const id = idDeCarrito(x.id);
    const item = id ? carta.find((i) => String(i.id) === id) : undefined;
    const cantidad = cantidadDeCarrito(x.cantidad);
    if (!item || !cantidad) { fuera.push(nombre); continue; }
    if (Math.floor(Number(x.cantidad)) > PD_MAX_CANTIDAD) recortadas.push(item.nombre);
    const previa = lineas.find((l) => l.id === item.id);
    if (previa) previa.cantidad = Math.min(PD_MAX_CANTIDAD, previa.cantidad + cantidad);
    else if (lineas.length >= PD_MAX_LINEAS) fuera.push(nombre);
    else {
      lineas.push({ id: item.id, nombre: item.nombre, precio: item.precio, cantidad: cantidad, detalle: '', forma: item.forma,
        piezas: item.piezas, area: item.area, moneda: item.moneda });
    }
  }
  en.carrito = lineas;

  // La entrega que eligio en la pagina, si el local la ofrece; si no, se dice y el flujo pregunta o toma la unica que hay.
  const quiere = c.entrega === 'envio' ? 'delivery' : 'recojo';
  if (modalidades().indexOf(quiere) >= 0) {
    ponerModalidad(quiere);
    if (quiere === 'delivery' && c.direccion) en.entrega.direccion = delCliente(c.direccion, 160);
  } else if (modalidades().length) {
    notas.push(quiere === 'delivery' ? 'Por ahora no hacemos delivery: tu pedido sería para recoger en el local.' : 'Por ahora solo hacemos delivery.');
  }
  // La nota del carrito tampoco esquiva las palabras excluidas («con tequila»): no se guarda ni llega al restaurante, y se le dice.
  const nota = delCliente(c.nota, 200);
  const notaExcluida = nota ? pdPalabraExcluida(nota, lista(cfg.palabrasExcluidas)) : '';
  if (nota && !notaExcluida) en.entrega.notaPedido = nota;
  if (notaExcluida) notas.push('No pude incluir tu nota: «' + notaExcluida + '» no lo podemos incluir en el pedido.');

  const nombres = (l) => unirY(l.slice(0, 3).map((n) => '«' + n + '»')) + (l.length > 3 ? ' y ' + (l.length - 3) + ' más' : '');
  if (fuera.length) notas.push('No pude incluir ' + nombres(fuera) + ' en tu pedido: no está disponible por este medio.');
  if (recortadas.length) notas.push('De ' + nombres(recortadas) + ' tomé ' + PD_MAX_CANTIDAD + ', que es el máximo por pedido.');
  const descartados = Math.floor(Number(c.descartados)) || 0;
  if (descartados > 0) {
    notas.push(descartados === 1 ? 'Hay 1 producto del catálogo que no entró en tu pedido. Si quieres agregarlo, escríbeme cuál era.'
      : 'Hay ' + descartados + ' productos del catálogo que no entraron en tu pedido. Si quieres agregarlos, escríbeme cuáles eran.');
  }

  // El total del servidor es solo un control: la comida, sin el costo de envio (que el flujo nunca suma).
  const servidor = Math.round((Number(c.total) || 0) * 100) - Math.round((Number(c.costoEnvio) || 0) * 100);
  const flujo = Math.round(pdTotal(en.carrito) * 100);
  if (flujo !== servidor) errores.push('carrito_total_no_coincide: servidor ' + (servidor / 100) + ', flujo ' + (flujo / 100));

  // UN SOLO REGISTRO POR PEDIDO WEB (decision de Andres, 03/10): el `cat_…` que escribio el checkout es el `pedidoId` del turno, asi el
  // codigo, el cierre, la referencia del cobro y el aviso hablan del MISMO pedido que ve la consola (y es estable: no depende del reloj ni
  // del estado leido). SOLO si el pedido del flujo es EL de la pagina: el id tiene la forma del checkout, el flujo no quito ni acoto
  // nada, el total coincide con el del servidor y no hay costo de envio (el servidor coteja el comprobante contra el total del pedido
  // `cat_…`, con envio incluido; el QR de este flujo es solo la comida). Cualquier otro caso conserva el id propio `ped-…`.
  const motivoSinId = !/^cat_[A-Za-z0-9_]{1,56}$/.test(String(c.pedidoId || '')) ? 'id_sin_la_forma_del_checkout'
    : (fuera.length || recortadas.length) ? 'lineas_quitadas_o_acotadas'
      : flujo !== servidor ? 'total_distinto'
        : Math.round((Number(c.costoEnvio) || 0) * 100) !== 0 ? 'con_costo_de_envio' : '';
  if (motivoSinId) errores.push('carrito_con_id_propio: ' + motivoSinId);
  else en.pedidoWeb = { id: String(c.pedidoId), huella: huellaDelCarrito() };

  const m = siguientePasoPedido();
  if (m) mensajes = conNotas(m);
}
