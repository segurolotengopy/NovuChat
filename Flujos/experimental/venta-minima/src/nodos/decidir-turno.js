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
// ORDEN (diseño §4.5, sin modelo): 1) cotejo → `comprobante`; 2) medios (imagen o documento
// sin QR pendiente, audio); 3) botón, validado contra el estado; 4) texto exacto de una
// campaña vigente → `promo`; 5) pide una persona → `transferir`, pregunta si es una IA →
// `identidad` (la identidad se revisa primero); 6) «menu», «cancelar»… → `menu`; 7) en
// `inicio` o `menu`, consulta fija; 8) por paso; 9) pedido fuera de horario.
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
//  c. Un botón `m|*` solo vale en `inicio` o `menu`; `g|pedir|<id>` también; `f|<i>|<forma>`
//     con la pregunta `i` pendiente; `e|…` en `pedido_entrega`; `p|…` en `pedido_confirmar`;
//     `r|…` en `reserva_confirmar`; `q|…` en `esperando_comprobante`. En otro paso, un botón
//     viejo muestra el paso actual y no cambia nada. `q|cancelar` es `menu` con el pedido
//     descartado; `q|reenviar` es `reenviar_qr`.
//  d. «Hacer un pedido» (`m|pedido`) y «Ver la carta» son la misma acción: `carta`.
//  e. Sin horario en la configuración (`horario` vacío) no se bloquea ningún pedido; con un
//     horario ilegible tampoco, pero se anota en `errores`.
//  f. Una ubicación compartida no se toma como dirección (supuesto 6): muestra el paso
//     actual, que en `pedido_datos` vuelve a pedir la dirección por escrito.
//  g. Tipos de mensaje que no son texto, botón, audio, imagen, documento ni ubicación
//     (sticker, contactos, pedido de catálogo…) → `medio_no_leido`.
const cfg = vmCfg();
const t = vmPrimero('Interpretar entrada') || {};
const ahora = Number(t.ahoraMs) || Date.now();
const sd = vmSd();
const previo = Object.assign(estadoBase(), vmLeerEstado(sd, t.from, ahora));
const estado = Object.assign({}, previo, { ultimoMensajeMs: ahora });
const errores = [];
const pedidosOn = cfg.pedidosActivo === true;
const reservasOn = cfg.reservasActivo === true;

let texto = vmRecorte(String(t.texto === undefined || t.texto === null ? '' : t.texto).trim(), 1500);
let tipoEf = t.tipo;

const salir = (accion, extra) => [{ json: Object.assign({
  accion: accion, boton: null, consulta: '', campana: null, motivo: '', cuerpoExtraccion: null,
  texto: texto, estado: estado, errores: errores,
}, extra || {}) }];

// --- 1. Resultado del cotejo: el comprobante llegó hasta el servidor ----------------------
// (o llegó una imagen que `Interpretar entrada` marcó como comprobante pero la lectura o el
// cotejo no corrieron: `Plan del turno` lo trata como «sin cotejar», nunca como «cuadra»).
if (vmNodo('Cotejar en el servidor') || t.esComprobante === true) return salir('comprobante');

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
  const esDePedido = (b.tipo === 'm' && p0 === 'pedido') || ['g', 'f', 'e', 'p'].indexOf(b.tipo) >= 0;
  if (esDePedido && pedidosOn && cerrado()) return salir('fuera_de_horario');

  if (b.tipo === 'm' && enMenu) {
    if (p0 === 'pedido' && pedidosOn) return salir('carta', { boton: b });
    if (p0 === 'reserva' && reservasOn) return salir('boton', { boton: b });
  }
  if (b.tipo === 'g' && enMenu && pedidosOn && p0 === 'pedir' && b.partes[1]) return salir('boton', { boton: b });
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
    if (p0 === 'cancelar') return salir('menu', { boton: b, motivo: 'cancelar_pedido' });
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

// --- 6. Reinicios: «menu», «empezar de nuevo», «cancelar» ----------------------------------
if (/^(menu|menu principal|inicio|empezar de nuevo|empezar otra vez|volver a empezar|volver al menu|cancelar|cancela|cancelar pedido|cancelar reserva|reiniciar)$/.test(norm)) {
  return salir('menu', { motivo: 'reinicio' });
}

// --- Un «sí» suelto no confirma nada; una pregunta orden/unidad pendiente se vuelve a mostrar --
const RELLENO = ['si', 'ya', 'dale', 'ok', 'okey', 'okay', 'listo', 'claro', 'bueno', 'confirmo', 'acepto', 'perfecto', 'adelante',
  'de', 'acuerdo', 'correcto', 'esta', 'bien', 'vale', 'sip', 'va', 'pues', 'una', 'enviar', 'envia', 'envialo', 'enviala',
  'manda', 'mandalo', 'mandala', 'confirmar', 'por', 'favor', 'gracias', 'asi', 'es', 'eso', 'lo', 'la', 'quiero'];
const palabras = norm.split(' ').filter(Boolean);
const soloAfirma = palabras.length > 0 && palabras.length <= 6 && palabras.every((w) => RELLENO.indexOf(w) >= 0);
if ((paso === 'pedido_confirmar' || paso === 'reserva_confirmar') && soloAfirma) return salir('boton', { motivo: 'si_suelto' });
if (paso === 'pedido' && Array.isArray(previo.pendiente) && previo.pendiente.length) return salir('boton', { motivo: 'forma_pendiente' });

// --- 7. En inicio o menú: consulta fija (dirección, horario, delivery, promociones, carta) ----
const quierePedir = /\b(pedir|pedido)\b|\bdelivery\b|para llevar|\bquiero \d/.test(norm);
const quiereReservar = /reserv|\bmesa\b/.test(norm);
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
if (reservasOn && quiereReservar) return extraerReserva();
return salir('menu');

// ---------------------------------------------------------------------------------------------
function estadoBase() {
  return Object.assign(vmEstadoBase(), {
    paso: 'inicio', carrito: [], pendiente: [],
    entrega: { entrega: '', modalidad: '', direccion: '', referencia: '', nombre: '' },
    reserva: null, pedido: null, vacias: 0, ilegibles: 0, transferencias: [],
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
