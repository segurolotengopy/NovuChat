// DECIDIR TURNO («Venta mínima v0»): qué hace este turno, ANTES de llamar a ningún modelo.
//
// Todo lo que no necesita entender lenguaje se decide acá, con código: el resultado del
// cotejo, los medios, los botones, la campaña, la derivación a una persona, la pregunta por
// la identidad, los reinicios, las consultas fijas y el horario. SOLO el texto libre de un
// pedido o de una reserva va al modelo (`accion: 'extraer_pedido' | 'extraer_reserva'`), y
// solo para EXTRAER datos: ningún texto al cliente sale del modelo.
//
// UN «SÍ» ESCRITO NO CONFIRMA NADA. Un pedido o una reserva se confirman tocando el botón
// (`p|confirmar`, `r|enviar`): con un «sí», «dale» u «ok» suelto en un paso de confirmación
// se vuelve a mostrar el paso con sus botones (`accion: 'boton'`, `boton: null`).
//
// El estado NO se escribe acá: se lee, se copia (`estado`) y lo fija `Plan del turno`; lo
// guarda `Armar mensajes`.
//
// ORDEN (diseño §4.5, sin modelo): 1) cotejo, o comprobante simulado → `comprobante`; 2) medios (imagen o documento
// sin QR pendiente, audio); 3) botón, validado contra el estado; 4) texto exacto de una
// campaña vigente → `promo`; 5) pide una persona → `transferir`, pregunta si es una IA →
// `identidad` (la identidad se revisa primero); 6) intenciones GLOBALES, en cualquier paso salvo
// `esperando_comprobante` (ahí «menú» y pedir una persona NO sacan del cobro: se conserva el paso): «menú», «cancelar», «carta», «reserva» y,
// estando en una reserva, «pedir»; 7) en `inicio` o `menu`, consulta fija; 8) por paso; 9) pedido
// fuera de horario.
//
// CARRITO Y RESERVA VIVEN POR SEPARADO (03/10): ninguna transición borra uno por pasar al otro. Solo se
// limpian al confirmar, al cancelar (`limpiar` = 'pedido' | 'reserva' | 'todo' en la salida de `menu`) o al
// vencer el estado. «Menú» (texto o botón `m|menu`) muestra el menú y no borra el carrito ni la reserva (el paso pasa a `menu`); con un
// comprobante en espera conserva el paso y el pedido, y muestra el recordatorio del comprobante (`Plan del turno`: `aMenu`).
//
// EL CARRITO DEL CATÁLOGO WEB (`tipo: 'carrito'`) no es un mensaje de WhatsApp: se decide antes que todo lo demás, en
// `decidirCarrito` (ventana cerrada, panel sin respuesta, otro comercio, pedidos apagados, local cerrado, QR pendiente).
//
// LIBRERÍAS QUE LLAMA (contrato §4.2; en la suite van dobles mínimos):
//   comun: vmCfg, vmPrimero, vmNodo, vmSd, vmEstadoBase, vmLeerEstado, vmLeerBoton, vmNorm,
//     vmLinea, vmRecorte, vmTextoDeGemini, vmHorario, vmAbierto.
//   pedido: pdCarta, pdCuerpoExtraccion.   reserva: rsCuerpoExtraccion.   promos: prCampanaDelTexto.
//
// SUPUESTOS DECLARADOS (los de la tarea T7a, aprobados por la coordinadora):
//  1. `entrega` (en el estado) = {entrega, modalidad, direccion, referencia, nombre}.
//  6. `accion: 'boton'` con `boton: null` = «mostrar el paso actual» (botón viejo o no
//     válido en este paso, «sí» suelto, ubicación, pregunta orden/unidad pendiente); el
//     porqué va en `motivo` (`boton_viejo`, `si_suelto`, `ubicacion`, `forma_pendiente`).
//  7. «Pide una persona» exige «hablar con (una) persona/alguien/humano…» (o «quiero un
//     asesor», «pásame con el encargado») o una palabra inequívoca (reclamo, queja, humano);
//     «persona», «asesor» o «encargado» sueltos NO derivan («mesa para 1 persona», «déjalo con el
//     encargado del edificio»). La pregunta por la identidad se revisa primero.
// SUPUESTOS PROPIOS (a confirmar en la integración):
//  a. Las banderas de capacidad (`pedidosActivo`, `reservasActivo`, `promosActivo`) valen
//     solo si son `true` (lo mismo que `promos.js`); la lista de áreas y de zonas se pasa a
//     `pd*`/`rs*` como arreglo (acepta también un CSV en la configuración).
//  b. El estado por teléfono tiene, además de lo de `vmEstadoBase()`: `paso`, `carrito`,
//     `pendiente`, `entrega`, `reserva`, `pedido`, `vacias`, `ilegibles`, `transferencias`.
//  c. Un botón `m|*` vale en cualquier paso salvo `esperando_comprobante`, donde solo `m|menu` vale;
//     `g|pedir|<id>` y `g|agregar|<id>|<cantidad>` valen en `inicio`, `menu` y los pasos de pedido; `f|<i>|<forma>`
//     con la pregunta `i` pendiente; `e|…` en `pedido_entrega`; `p|…` en `pedido_confirmar`;
//     `r|…` en `reserva_confirmar`; `q|…` en `esperando_comprobante`. En otro paso, un botón
//     viejo muestra el paso actual y no cambia nada. `q|cancelar` es `menu` con el pedido
//     descartado (`limpiar: 'pedido'`); `q|reenviar` es `reenviar_qr`. LÍMITE CONOCIDO: `q|cancelar` descarta el pedido del
//     estado pero NO avisa al servidor (el cobro abierto por `qr_enviado` vence solo): no se construye aquí.
//  d. «Hacer un pedido» (`m|pedido`) y «Ver la carta» son la misma acción: `carta`.
//  e. Sin horario en la configuración (`horario` vacío) no se bloquea ningún pedido; con un
//     horario ilegible tampoco, pero se anota en `errores`.
//  f. Una ubicación compartida no se toma como dirección (supuesto 6): muestra el paso
//     actual, que en `pedido_datos` vuelve a pedir la dirección por escrito. (`Plan del turno` la traduce a
//     `entrega.ubicacion`: con delivery, el paso de entrega la toma como dirección.)
//  g. Tipos de mensaje que no son texto, botón, audio, imagen, documento ni ubicación
//     (sticker, contactos, pedido de catálogo…) → `medio_no_leido`.
const cfg = vmCfg();
const t = vmPrimero('Interpretar entrada') || {};
const ahora = Number(t.ahoraMs) || Date.now();
const sd = vmSd();
const previo = Object.assign(estadoBase(), vmLeerEstado(sd, t.from, ahora));
const estado = Object.assign({}, previo, { ultimoMensajeMs: ahora });
// El ANCLA de las claves estables (B0): el `ultimoMensajeMs` del estado tal como se LEYO, antes de ponerle la hora de este
// turno. Dos ejecuciones simultaneas (doble toque) leen el mismo estado y ven la misma ancla; `Plan del turno` la usa para
// derivar `pedidoId`, el codigo y la referencia de la reserva sin mirar el reloj. 0 si no habia estado (o estaba vencido).
const anclaMs = Number(previo.ultimoMensajeMs) || 0;
const errores = [];
const pedidosOn = cfg.pedidosActivo === true;
const reservasOn = cfg.reservasActivo === true;

let texto = vmRecorte(String(t.texto === undefined || t.texto === null ? '' : t.texto).trim(), 1500);
let tipoEf = t.tipo;

const salir = (accion, extra) => [{ json: Object.assign({
  accion: accion, boton: null, consulta: '', campana: null, motivo: '', cuerpoExtraccion: null,
  texto: texto, estado: estado, errores: errores, anclaMs: anclaMs,
}, extra || {}) }];

// --- 1. Resultado del cotejo: el comprobante llegó hasta el servidor ----------------------
// (o llegó una foto con el cobro SIMULADO y el QR pendiente, `comprobanteSimulado`, que no se coteja; o llegó una imagen que
// `Interpretar entrada` marcó como comprobante pero la lectura o el
// cotejo no corrieron: `Plan del turno` lo trata como «sin cotejar», nunca como «cuadra»).
if (vmNodo('Cotejar en el servidor') || t.esComprobante === true || t.comprobanteSimulado === true) return salir('comprobante');

// --- 1b. El carrito del catalogo web (no es un mensaje de WhatsApp: decide `decidirCarrito`, mas abajo) ----
if (t.tipo === 'carrito') return decidirCarrito();

// --- 2. Medios -------------------------------------------------------------------------
if (t.tipo === 'audio') {
  // El audio llega transcripto por fuera; acá solo se decide si se entendió.
  const dicho = t.esAudio === true ? vmLinea(vmTextoDeGemini(vmPrimero('Transcribir audio')), 1000) : '';
  if (!dicho) return salir('medio_no_leido', { motivo: 'audio' });
  texto = dicho;
  tipoEf = 'text';
} else if (t.tipo === 'image' || t.tipo === 'document') {
  // Una imagen o un documento NO son un pago si no hay un QR esperando comprobante (si lo hubiera,
  // `esComprobante` ya los habría mandado arriba). Con pie de foto, el pie es un texto más.
  if (texto) tipoEf = 'text';
  else return salir('imagen_sin_pendiente');
} else if (t.tipo === 'location' || t.ubicacion) {
  return salir('boton', { motivo: 'ubicacion' });
} else if (['text', 'interactive', 'button'].indexOf(tipoEf) < 0) {
  return salir('medio_no_leido', { motivo: 'tipo' });
}

const paso = previo.paso;
const norm = vmNorm(texto);

// --- 3. Botón: se valida contra el estado; uno viejo muestra el paso actual --------------
const idBoton = t.boton;
if (idBoton) {
  const b = typeof idBoton === 'object' ? idBoton : vmLeerBoton(String(idBoton));
  const viejo = () => salir('boton', { motivo: 'boton_viejo' });
  if (!b || typeof b.tipo !== 'string' || !Array.isArray(b.partes)) return viejo();
  const p0 = String(b.partes[0] === undefined ? '' : b.partes[0]);
  const enMenu = paso === 'inicio' || paso === 'menu';
  const enComp = paso === 'esperando_comprobante';
  const enPedido = paso.indexOf('pedido') === 0;
  const esDePedido = (b.tipo === 'm' && p0 === 'pedido') || ['g', 'f', 'e', 'p'].indexOf(b.tipo) >= 0;
  if (esDePedido && pedidosOn && cerrado()) return salir('fuera_de_horario');

  // «Menú» vale siempre: muestra el menú y no borra nada. Los demás `m|*` valen salvo con un comprobante en espera.
  if (b.tipo === 'm' && p0 === 'menu') return salir('menu', { boton: b, motivo: 'boton_menu' });
  if (b.tipo === 'm' && !enComp) {
    if (p0 === 'pedido' && pedidosOn) return salir('carta', { boton: b });
    if (p0 === 'reserva' && reservasOn) return salir('boton', { boton: b });
    if (p0 === 'promos' && cfg.promosActivo === true) return salir('consulta', { boton: b, consulta: 'promociones' });
  }
  if (b.tipo === 'g' && (enMenu || enPedido) && pedidosOn && p0 === 'pedir' && b.partes[1]) return salir('boton', { boton: b });
  if (b.tipo === 'g' && (enMenu || enPedido) && pedidosOn && p0 === 'agregar' && b.partes[1] && /^\d{1,2}$/.test(String(b.partes[2]))) return salir('boton', { boton: b });
  if (b.tipo === 'f' && paso === 'pedido') {
    // Solo se pregunta la primera pendiente (`pdResolverForma` resuelve `pendiente[0]`).
    const forma = b.partes[1];
    if (p0 === '0' && Array.isArray(previo.pendiente) && previo.pendiente.length
      && (forma === 'orden' || forma === 'unidad')) return salir('boton', { boton: b });
  }
  if (b.tipo === 'e' && paso === 'pedido_entrega' && (p0 === 'delivery' || p0 === 'recojo')) return salir('boton', { boton: b });
  if (b.tipo === 'p' && paso === 'pedido_confirmar' && (p0 === 'confirmar' || p0 === 'cambiar')) return salir('boton', { boton: b });
  if (b.tipo === 'r' && paso === 'reserva_confirmar' && (p0 === 'enviar' || p0 === 'corregir')) return salir('boton', { boton: b });
  if (b.tipo === 'q' && paso === 'esperando_comprobante') {
    if (p0 === 'reenviar') return salir('reenviar_qr', { boton: b });
    if (p0 === 'cancelar') return salir('menu', { boton: b, motivo: 'cancelar_pedido', limpiar: 'pedido' });
  }
  return viejo();
}

// Desde acá todo es TEXTO (escrito, dicho o el pie de una foto).

// --- 4. Texto exacto de una campaña vigente (reinicia el estado) ------------------------
if (cfg.promosActivo === true && Array.isArray(cfg.campanas) && cfg.campanas.length) {
  const campana = prCampanaDelTexto(cfg.campanas, texto, ahora);
  if (campana) return salir('promo', { campana: campana });
}

// --- 5. Identidad primero; después, pide una persona ---------------------------------------
const PREGUNTA_IDENTIDAD = /\b(eres|sos|seras|hablo con|hablando con|estoy hablando con|me atiende|me atiendes|atiende) (un |una |el |la )?(robot|bot|chatbot|ia|inteligencia artificial|maquina|programa|humano|humana|persona|real)\b|\b(robot|chatbot|bot|inteligencia artificial)\b/;
const PIDE_PERSONA = /\b(hablar|conversar|comunicar|comunicarme|comunicarnos|contactar|contactarme|pasar|pasame|pasenme|comunicame) (con|a) (una |un |la |el |algun |alguna |otra )?(persona|alguien|humano|humana|encargad[oa]|asesor|asesora|duen[oa]|gerente|administrador|administradora|recepcion)\b|\b(quiero|necesito|prefiero|quisiera|pido) (a )?(una |un |la |el )?(persona|humano|humana|asesor|asesora|encargad[oa])\b|\b(reclamo|queja|humano|humana)\b/;
if (PREGUNTA_IDENTIDAD.test(norm)) return salir('identidad');
if (PIDE_PERSONA.test(norm)) return salir('transferir', { motivo: 'pidió hablar con una persona' });

// --- 6. Intenciones GLOBALES: valen en cualquier paso, antes del «por paso» ------------------------
// Con un comprobante en espera (`esperando_comprobante`) «menú» no sale del cobro (muestra el recordatorio) y lo
// demás recibe el recordatorio. «Menú» no borra nada; «cancelar» y «empezar de nuevo» sí limpian.
const enComprobante = paso === 'esperando_comprobante';
const quierePedir = /\b(pedir|pedido)\b|\bdelivery\b|para llevar|\bquiero \d/.test(norm);
const quiereReservar = /reserv|\bmesa\b/.test(norm);
// FALSOS POSITIVOS (revisión del PR #382): las intenciones globales de CARTA y RESERVA valen en `inicio` y `menu` sin límite de largo, pero
// en los demás pasos solo con un mensaje CORTO (hasta 60 caracteres) y nunca mientras se piden los datos de entrega (`pedido_entrega`,
// `pedido_datos`): una dirección («edificio Mesa Grande») o una referencia no es «quiero una mesa». «Que tienen» no es la carta si el
// mensaje ya pide algo («quiero tacos, ¿qué tienen de postre?»), y «pedir» dentro de una reserva no es cambiar de rumbo si es una
// pregunta («¿se puede pedir torta?»).
const enDatosDeEntrega = paso === 'pedido_entrega' || paso === 'pedido_datos';
const globalCorto = paso === 'inicio' || paso === 'menu' || (norm.length <= 60 && !enDatosDeEntrega);
const pideAlgo = /\b(quiero|quisiera|queremos|necesito|dame|me das|ponme|pedir|pedido)\b/.test(norm);
const esPregunta = /[?¿]/.test(texto) || /\b(se puede|puedo|pueden|podria|podrian|hay|tienen|aceptan)\b/.test(norm);
if (/^(menu|menu principal|inicio|volver al menu)$/.test(norm) || (!enComprobante && /^(hola|volver|atras)$/.test(norm))) {
  return salir('menu', { motivo: 'menu' });
}
if (!enComprobante) {
  if (/^(empezar de nuevo|empezar otra vez|volver a empezar|reiniciar)$/.test(norm)) return salir('menu', { motivo: 'reinicio', limpiar: 'todo' });
  if (/^(cancelar pedido)$/.test(norm)) return salir('menu', { motivo: 'reinicio', limpiar: 'pedido' });
  if (/^(cancelar reserva)$/.test(norm)) return salir('menu', { motivo: 'reinicio', limpiar: 'reserva' });
  // «cancelar» a secas cancela lo que se está haciendo; sin nada en curso, todo.
  if (/^(cancelar|cancela)$/.test(norm)) {
    return salir('menu', { motivo: 'reinicio', limpiar: paso.indexOf('reserva') === 0 ? 'reserva' : (paso.indexOf('pedido') === 0 ? 'pedido' : 'todo') });
  }
  // La carta, en cualquier paso. Un pedido que la nombra («tres tacos de la carta») no es esta intención.
  if (pedidosOn && globalCorto && norm.length <= 80 && !/\d/.test(norm) && (/\b(carta|catalogo)\b/.test(norm) || (/\bque tienen\b/.test(norm) && !pideAlgo))
    && !/\b(de|en|segun) la carta\b/.test(norm)) return salir('carta', { motivo: 'carta', consulta: 'carta' });
  // La reserva, en cualquier paso (en un paso de reserva sigue su camino «por paso»).
  if (reservasOn && quiereReservar && paso.indexOf('reserva') !== 0 && globalCorto) return extraerReserva();
  // El pedido, estando en una reserva: el carrito sigue donde se dejó.
  if (pedidosOn && paso.indexOf('reserva') === 0 && norm.length <= 60 && !esPregunta && /\b(pedir|pedido)\b/.test(norm)) return extraerPedido();
}

// --- Un «sí» suelto no confirma nada; una pregunta orden/unidad pendiente se vuelve a mostrar --
const RELLENO = ['si', 'ya', 'dale', 'ok', 'okey', 'okay', 'listo', 'claro', 'bueno', 'confirmo', 'acepto', 'perfecto', 'adelante',
  'de', 'acuerdo', 'correcto', 'esta', 'bien', 'vale', 'sip', 'va', 'pues', 'una', 'enviar', 'envia', 'envialo', 'enviala',
  'manda', 'mandalo', 'mandala', 'confirmar', 'por', 'favor', 'gracias', 'asi', 'es', 'eso', 'lo', 'la', 'quiero'];
const palabras = norm.split(' ').filter(Boolean);
const soloAfirma = palabras.length > 0 && palabras.length <= 6 && palabras.every((w) => RELLENO.indexOf(w) >= 0);
if ((paso === 'pedido_confirmar' || paso === 'reserva_confirmar') && soloAfirma) return salir('boton', { motivo: 'si_suelto' });
// Una respuesta a la pregunta orden/unidad («sueltos», «la orden», «dale») repite la pregunta sin gastar un modelo; cualquier otro
// texto es un mensaje nuevo y se atiende (si no, «quiero un helado» recibía la misma pregunta una y otra vez). La
// pregunta sigue pendiente en el estado y vuelve a salir en cuanto el pedido avanza.
const RESPUESTA_FORMA = /^((la|las|en|por|una|un|el) )?(orden|ordenes|suelt[oa]s?|unidad|unidades)( completa)?$/;
if (paso === 'pedido' && Array.isArray(previo.pendiente) && previo.pendiente.length && (RESPUESTA_FORMA.test(norm) || soloAfirma)) return salir('boton', { motivo: 'forma_pendiente' });

// --- 7. En inicio o menú: consulta fija (dirección, horario, delivery, promociones, carta) ----
if (paso === 'inicio' || paso === 'menu') {
  const consulta = consultaFija();
  if (consulta === 'carta') return salir('carta', { consulta: consulta });
  if (consulta) return salir('consulta', { consulta: consulta });
}

// --- 8. Por paso ------------------------------------------------------------------------------
if (paso === 'esperando_comprobante') return salir('recordatorio_comprobante');
if (paso.indexOf('reserva') === 0) return extraerReserva();
if (paso.indexOf('pedido') === 0) return extraerPedido();
// inicio o menu, sin consulta fija: la intención de pedido o de reserva, o el menú.
if (pedidosOn && quierePedir) return extraerPedido();
return salir('menu');

// ---------------------------------------------------------------------------------------------
// EL CARRITO DEL CATALOGO WEB (`tipo === 'carrito'`, que solo produce `Carga de entrada` cuando corrio «Carrito del catálogo»).
// El servidor ya escribio el pedido en la consola y recalculo los precios; aca solo se decide si el flujo contesta y como.
// `carrito_*` en `motivo` = no se contesta nada (`Plan del turno` sale sin mensajes, sin aviso y sin tocar el estado):
//   1. ventana de 24 h cerrada (la calculo el servidor): fuera de ella Meta solo acepta una plantilla aprobada y no hay una
//      para esto; no sale nada y el pedido sigue en la consola (el Demo B tampoco manda plantilla);
//   2. el panel no contesto: no hay carta con que armar nada, se pasa con el local (aviso + boton);
//   3. el tenant del carrito no es el del panel de ESTE numero: no es de este comercio, no se contesta;
//   4. pedidos apagados: no hay nada que tomar;
//   5. con un QR esperando comprobante: el carrito se ignora y se recuerda el comprobante (antes que el horario);
//   6. local cerrado: fuera de horario (como un pedido por texto);
//   7. si no, `carrito`: `Plan del turno` arma el pedido desde la carta y sigue con el paso que corresponda.
function decidirCarrito() {
  const c = t.carrito && typeof t.carrito === 'object' ? t.carrito : {};
  if (c.ventanaAbierta !== true) return salir('carrito', { motivo: 'carrito_ventana_cerrada' });
  if (cfg.panelSinRespuesta === true) return salir('transferir', { motivo: 'carrito del catálogo sin respuesta del panel' });
  if (!mismoTexto(c.tenantId, tenantDelPanel())) return salir('carrito', { motivo: 'carrito_otro_tenant' });
  if (!pedidosOn) return salir('carrito', { motivo: 'carrito_sin_pedidos' });
  // El comprobante pendiente se revisa ANTES del horario: un cliente que ya pagó recibe el recordatorio de su comprobante aunque el local cerró.
  if (previo.paso === 'esperando_comprobante') return salir('recordatorio_comprobante');
  if (cerrado()) return salir('fuera_de_horario');
  return salir('carrito');
}

// El tenant que dijo el panel para este numero (`Traer configuración`): vacio si el panel no contesto con uno.
function tenantDelPanel() {
  const r = vmPrimero('Traer configuración') || {};
  let b = r.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return Number(r.statusCode) === 200 && b && typeof b === 'object' && typeof b.tenantId === 'string' ? b.tenantId : '';
}

// Igualdad de dos textos sin salida temprana; dos vacios NO son iguales (sin tenant no hay a quien atribuir el carrito).
function mismoTexto(a, b) {
  const x = String(a === undefined || a === null ? '' : a);
  const y = String(b === undefined || b === null ? '' : b);
  if (!x || !y) return false;
  let d = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}

// ---------------------------------------------------------------------------------------------
function estadoBase() {
  return Object.assign(vmEstadoBase(), {
    paso: 'inicio', carrito: [], pendiente: [],
    entrega: { entrega: '', modalidad: '', direccion: '', referencia: '', nombre: '' },
    reserva: null, pedido: null, vacias: 0, ilegibles: 0, transferencias: [],
    carritoGuardado: 0,
  });
}

// Una lista de la configuración (arreglo o CSV) como arreglo de textos.
function lista(v) {
  const base = Array.isArray(v) ? v : String(v === undefined || v === null ? '' : v).split(/[,;|]/);
  return base.map((x) => String(x).trim()).filter(Boolean);
}

// ¿Está cerrado el restaurante ahora? Sin horario (o ilegible) no se bloquea nada.
function cerrado() {
  if (!String(cfg.horario || '').trim()) return false;
  const h = vmHorario(cfg.horario);
  if (!h) { errores.push('horario_ilegible'); return false; }
  const a = vmAbierto(h, ahora);
  return !(a && a.abierto);
}

function cartaDelNegocio() {
  return pdCarta(Array.isArray(cfg.catalogo) ? cfg.catalogo : [], {
    areasExcluidas: lista(cfg.areasExcluidas), moneda: cfg.moneda,
  });
}

function extraerPedido() {
  if (cerrado()) return salir('fuera_de_horario');
  const carta = cartaDelNegocio();
  // Sin carta cargada no hay pedido que tomar: lo único que se ofrece es pasar con el local.
  if (!carta.length) return salir('transferir', { motivo: 'carta sin cargar' });
  return salir('extraer_pedido', { cuerpoExtraccion: pdCuerpoExtraccion(texto, carta, { ahoraMs: ahora }) });
}

function extraerReserva() {
  return salir('extraer_reserva', { cuerpoExtraccion: rsCuerpoExtraccion(texto, { ahoraMs: ahora, zonas: lista(cfg.zonasReserva) }) });
}

// Una de las consultas fijas, o '' si no es UNA sola (dos a la vez, un texto largo o una
// intención de pedir o reservar siguen su camino).
function consultaFija() {
  if (!norm || norm.length > 120 || /\d/.test(norm) || quiereReservar) return '';
  const pide = /\b(pedir|pedido|quiero|quisiera|queremos|necesito|para llevar)\b/.test(norm);
  const encontradas = [];
  if (!pide && /\b(direccion|ubicacion|ubicados|donde (estan|queda|quedan|se ubican|los encuentro)|como llego|como llegar|mapa)\b/.test(norm)) encontradas.push('direccion');
  if (!pide && /\b(horarios?|a que hora (abren|cierran|atienden)|hasta que hora|desde que hora|que dias (abren|atienden)|estan abiertos|abiertos?)\b/.test(norm)) encontradas.push('horario');
  if (!pide && /\b(delivery|domicilio|envios?)\b/.test(norm)) encontradas.push('delivery');
  if (!pide && /\b(promos?|promociones?|ofertas?|descuentos?|combos?)\b/.test(norm)) encontradas.push('promociones');
  if (!/\b(pedir|pedido)\b/.test(norm) && /\b(carta|menu|que (tienen|venden|ofrecen|sirven))\b/.test(norm)) encontradas.push('carta');
  return encontradas.length === 1 ? encontradas[0] : '';
}
