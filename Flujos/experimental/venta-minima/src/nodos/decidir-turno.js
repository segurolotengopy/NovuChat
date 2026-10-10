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
// `identidad` (la identidad se revisa primero); 5b) pide EXPRESAMENTE la ubicación o la dirección del LOCAL → `consulta:direccion_local`
// (09/10, Q'Taco: en cualquier paso y también por audio; `Plan del turno` responde SIN tocar el estado); 6) intenciones GLOBALES, en cualquier paso salvo
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
// H5: una foto con PIE llegada FUERA del cobro (el cliente ya no espera un comprobante: cancelo, termino o empezo otro pedido) es una imagen con pie y el
// pie se atiende como texto. Una sola excepcion: si la referencia del QR pendiente es un pedido REAL y de ESTE telefono (el modo cambio a simulado), la foto
// puede ser un pago y sigue como comprobante (`Plan del turno` la manda sin cotejo al restaurante). Sin pie, una foto fuera del cobro sigue siendo un
// comprobante (ya cotejado, o sin pendiente) y no toca el paso.
const fotoConPieFueraDelCobro = (() => {
  if (t.comprobanteSimulado !== true || previo.paso === 'esperando_comprobante' || !String(t.texto || '').trim()) return false;
  const ref = String((cfg.cobro && cfg.cobro.pedidoRef) || '');
  const guardados = sd && sd.pedidos && typeof sd.pedidos === 'object' ? sd.pedidos : {};
  const p = ref && Object.prototype.hasOwnProperty.call(guardados, ref) ? guardados[ref] : null;
  const esRealMio = !!p && typeof p === 'object' && String(p.from) === String(t.from) && p.simulado !== true;
  return !esRealMio;
})();
if (vmNodo('Cotejar en el servidor') || t.esComprobante === true || (t.comprobanteSimulado === true && !fotoConPieFueraDelCobro)) return salir('comprobante');
// Un pedido SIMULADO con el cobro real encendido y su QR pendiente: la foto no es un comprobante real ni se coteja; se pasa con una persona.
if (t.comprobanteCruzado === true) return salir('transferir', { motivo: 'el modo de cobro cambió: comprobante de un pedido simulado' });

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
  // Con un comprobante en espera el boton de pedido no saca del cobro (cae abajo en el recordatorio), ni siquiera con el local cerrado.
  if (esDePedido && pedidosOn && !enComp && cerrado()) return salir('fuera_de_horario');

  // «Menú» (`m|menu`) es valido en todo paso, pero con un comprobante en espera NO sale del cobro: muestra el recordatorio (`Plan del turno`: `aMenu`).
  // Los demás `m|*` valen salvo con un comprobante en espera.
  if (b.tipo === 'm' && p0 === 'menu') return salir('menu', { boton: b, motivo: 'boton_menu' });
  if (b.tipo === 'm' && !enComp) {
    if (p0 === 'persona') return salir('transferir', { boton: b, motivo: 'pidió hablar con una persona' });
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
  // «Dejarlo como estaba» (tras «Cambiar algo»): vale mientras el pedido anterior siga guardado (`carritoAnterior`).
  if (b.tipo === 'p' && p0 === 'seguir' && enPedido) return salir('boton', { boton: b });
  if (b.tipo === 'p' && p0 === 'dejar' && (enPedido || paso === 'menu') && previo.carritoAnterior && typeof previo.carritoAnterior === 'object') return salir('boton', { boton: b });
  if (b.tipo === 'r' && paso === 'reserva_confirmar' && (p0 === 'enviar' || p0 === 'corregir')) return salir('boton', { boton: b });
  if (b.tipo === 'q' && paso === 'esperando_comprobante') {
    if (p0 === 'reenviar') return salir('reenviar_qr', { boton: b });
    if (p0 === 'cancelar') return salir('cancelar', { boton: b, motivo: 'cancelar_pedido', limpiar: 'pedido' });
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

// --- 5b. Pide la ubicación o la dirección del LOCAL (09/10/2026, pedido de Q'Taco) ---------------------------------------
// «Cada vez que una persona pida expresamente la ubicación o la dirección del local, se le manda el enlace de Google Maps, sea cual sea el
// flujo que siga o la etapa en que esté.» Va ANTES de las intenciones globales y del «por paso»: con un comprobante en espera, un pedido a medias
// o una reserva en curso la consulta se responde igual y el estado NO se toca (`Plan del turno`: `aUbicacionLocal`). Solo si hay algo que dar
// (la dirección en texto o un enlace de Maps válido); sin ninguno no se intercepta y todo sigue como antes. Cero llamadas al modelo.
// DAR no es PEDIR: dentro de `pedido_datos` con delivery el flujo está pidiendo SU dirección de entrega, así que ahí «ubicación» o «dirección»
// sueltas se leen como darla y solo cuenta lo que nombra al local (`pideElLocal(norm, true)`). Compartir la ubicación (`type: location`) ya salió arriba.
const hayDatoDelLocal = !!vmLinea(cfg.direccion, 200) || !!vmEnlaceDeMapa(cfg.direccionMaps);
const pidiendoSuDireccion = paso === 'pedido_datos' && !!previo.entrega && previo.entrega.entrega === 'delivery';
if (hayDatoDelLocal && pideElLocal(norm, pidiendoSuDireccion)) return salir('consulta', { consulta: 'direccion_local', motivo: 'ubicacion_del_local' });

// --- 6. Intenciones GLOBALES: valen en cualquier paso, antes del «por paso» ------------------------
// Con un comprobante en espera (`esperando_comprobante`) «menú» no sale del cobro (muestra el recordatorio) y lo
// demás recibe el recordatorio. «Menú» no borra nada; «cancelar» y «empezar de nuevo» sí limpian.
const enComprobante = paso === 'esperando_comprobante';
// CANCELAR (04/10): «cancela mi pedido» y sus variantes naturales CANCELAN el pedido guardado (`Plan del turno`: `aCancelar`), no derivan a una persona.
// Un rechazo («no cancela», «no quiero cancelar») NO cancela: el pedido sigue donde estaba.
const cancelacion = intencionDeCancelar(norm);
if (cancelacion === 'no') {
  if (enComprobante || (paso.indexOf('pedido') === 0 && (previo.carrito.length > 0 || previo.carritoAnterior))) return salir('boton', { motivo: 'no_cancela' });
} else if (cancelacion && enComprobante) {
  // Con el QR enviado, escribir «cancela mi pedido» es lo mismo que tocar «Cancelar pedido».
  if (cancelacion !== 'reserva') return salir('cancelar', { motivo: 'cancelar_pedido', limpiar: 'pedido' });
}
// «¿Qué tengo guardado?»: muestra el pedido guardado con sus botones (sin pedido, lo dice). Con un QR esperando comprobante rige el recordatorio de siempre.
if (pedidosOn && !enComprobante && /^(ver |mostrar |muestrame |dime |cual es |quiero ver )?(mi |el )?(pedido|carrito)( guardado| actual)?$|^(que|cual) (tengo|llevo|pedi)( guardado| en mi pedido| en el pedido| pedido)?$|^cuanto (va|llevo)( en mi pedido| en el pedido| mi pedido)?$|^(mi pedido|mi carrito)$/.test(norm)
  && /\b(pedido|carrito|tengo|llevo|pedi|va)\b/.test(norm) && norm !== 'pedido' && norm.length <= 40) {
  return salir('boton', { motivo: 'ver_pedido' });
}
const quierePedir = /\b(pedir|pedido)\b|\bdelivery\b|para llevar|\bquiero \d/.test(norm) || intencionDePedir(norm);
const quiereReservar = /reserv|\bmesa\b/.test(norm);
// FALSOS POSITIVOS (revisión del PR #382): las intenciones globales de CARTA y RESERVA valen en `inicio` y `menu` sin límite de largo, pero
// en los demás pasos solo con un mensaje CORTO (hasta 60 caracteres) y nunca mientras se piden los datos de entrega (`pedido_entrega`,
// `pedido_datos`, donde la reserva solo vale con el verbo «reservar»): una dirección («edificio Mesa Grande») o una referencia no es «quiero una mesa». «Que tienen» no es la carta si el
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
  if (cancelacion === 'pedido') return salir('cancelar', { motivo: 'reinicio', limpiar: 'pedido' });
  if (cancelacion === 'reserva') return salir('menu', { motivo: 'reinicio', limpiar: 'reserva' });
  if (cancelacion === 'todo') return salir('cancelar', { motivo: 'reinicio', limpiar: 'todo' });
  // «cancelar» a secas cancela lo que se está haciendo; sin nada en curso, todo.
  if (cancelacion === 'solo') {
    if (paso.indexOf('reserva') === 0) return salir('menu', { motivo: 'reinicio', limpiar: 'reserva' });
    return salir('cancelar', { motivo: 'reinicio', limpiar: paso.indexOf('pedido') === 0 ? 'pedido' : 'todo' });
  }
  // La carta, en cualquier paso. Un pedido que la nombra («tres tacos de la carta») no es esta intención.
  if (pedidosOn && globalCorto && norm.length <= 80 && !/\d/.test(norm) && (/\b(carta|catalogo)\b/.test(norm) || (/\bque tienen\b/.test(norm) && !pideAlgo))
    && !/\b(de|en|segun) la carta\b/.test(norm)) return salir('carta', { motivo: 'carta', consulta: 'carta' });
  // La reserva, en cualquier paso (en un paso de reserva sigue su camino «por paso»).
  // En los pasos de datos de entrega solo vale el VERBO («quiero reservar», corto y sin numeros); «mesa» suelta es parte de una direccion.
  const reservaEnDatos = norm.length <= 60 && !/\d/.test(norm) && /\breserv/.test(norm);
  if (reservasOn && quiereReservar && paso.indexOf('reserva') !== 0 && (enDatosDeEntrega ? reservaEnDatos : globalCorto)) return extraerReserva();
  // El pedido, estando en una reserva: el carrito sigue donde se dejó.
  if (pedidosOn && paso.indexOf('reserva') === 0 && norm.length <= 60 && !esPregunta && /\b(pedir|pedido)\b/.test(norm)) return extraerPedido();
}

// --- Pedido en curso: cosas que se resuelven con código, sin modelo --------------------------------
// «Dejarlo como estaba», escrito: vuelve el pedido de antes de «Cambiar algo» (el botón de enlace de la carta no admite un botón de respuesta).
// Tras «Cambiar algo» el carrito está vacío: lo que vale es que el pedido anterior siga guardado.
// Se reconocen por código las formas naturales de pedir lo mismo («déjalo como estaba», «no, déjalo no más», «te dije que lo deses como estaba», «ya no cambio»)
// (`intencionDeVolver`). También con el paso en `menu`: una derivación manda el paso a `menu` y el pedido anterior sigue guardado.
// TOLERANCIA SOLO AL ELEGIR DE NUEVO (revisión de seguridad del PR #426): con tipeo/voz tolerados y con «duda» posible únicamente cuando el carrito nuevo está
// vacío, sin una pregunta pendiente y sin que el cliente esté dando datos de entrega. Con un pedido nuevo en curso (carrito con productos, `pedido_entrega`,
// `pedido_datos`) valen solo las formas CERRADAS y nunca se pregunta: «Déjalo en portería nomás» es una instrucción de entrega, no volver al pedido anterior.
// La pregunta se hace UNA vez (`preguntoDejar`); la segunda vez la frase sigue su camino normal.
if (!enComprobante && (paso.indexOf('pedido') === 0 || paso === 'menu') && previo.carritoAnterior && typeof previo.carritoAnterior === 'object') {
  const hayCarritoNuevo = (Array.isArray(previo.carrito) && previo.carrito.length > 0) || (Array.isArray(previo.pendiente) && previo.pendiente.length > 0);
  const dandoDatos = paso === 'pedido_entrega' || paso === 'pedido_datos';
  const tolerante = !hayCarritoNuevo && !dandoDatos && (paso === 'pedido' || paso === 'menu');
  // «No, dejarlo como estaba» (con coma o punto tras el «no»): el «no» es una respuesta aparte y lo que sigue es lo que quiere, no un rechazo del verbo (LOW del PR
  // #426). Sin la puntuación («no dejarlo como estaba») sigue siendo un rechazo. `vmNorm` borra la puntuación: se mira el texto crudo.
  const sinNoAparte = String(texto).replace(/^\s*(?:(?:ya|pues|mejor)\s+)?no\s*[,;:.!]+\s*(?=\S)/i, '');
  const quiere = intencionDeVolver(sinNoAparte !== String(texto) ? vmNorm(sinNoAparte) : norm, tolerante);
  const sePuedePedir = !(pedidosOn && cerrado()); // el camino por texto respeta el horario igual que el botón
  if (quiere === 'si') return sePuedePedir ? salir('boton', { motivo: 'dejar_como_estaba', boton: { tipo: 'p', partes: ['dejar'] } }) : salir('fuera_de_horario');
  if (quiere === 'duda' && previo.preguntoDejar !== true) return sePuedePedir ? salir('boton', { motivo: 'dejar_o_elegir' }) : salir('fuera_de_horario');
}
const enPasoDePedido = paso.indexOf('pedido') === 0 && Array.isArray(previo.carrito) && previo.carrito.length > 0;
if (!enComprobante && enPasoDePedido) {
  // CAMBIO DE ENTREGA por texto («prefiero recoger», «¿puedo cambiar al delivery?», «quiero que me manden», «mándamelo», «a domicilio», «mejor recojo»),
  // también con tipeo («quiero que me mandn»): `cambioDeEntrega` exige que TODAS las palabras sean de un vocabulario cerrado (una dirección o una referencia
  // —«Barrio El Retiro», «ella va a recoger en portería», «Calle Domicilio 5»— tiene palabras ajenas y NO es un cambio), sin «no/nada/sin», y que no mezcle
  // delivery con recojo. Mensaje entero y corto (revisión de seguridad del PR #417/#426).
  const eligioDelivery = previo.entrega && previo.entrega.entrega === 'delivery';
  const cambio = cambioDeEntrega(norm);
  if (cambio === 'recojo' && cfg.aceptaRetiroEnLocal !== false && (eligioDelivery || paso === 'pedido_entrega')
    && ['pedido_entrega', 'pedido_datos', 'pedido_confirmar'].indexOf(paso) >= 0) {
    if (pedidosOn && cerrado()) return salir('fuera_de_horario');
    return salir('boton', { motivo: 'cambio_a_recojo', boton: { tipo: 'e', partes: ['recojo'] } });
  }
  if (cambio === 'delivery' && cfg.aceptaDelivery !== false && ['pedido_entrega', 'pedido_confirmar'].indexOf(paso) >= 0) {
    if (pedidosOn && cerrado()) return salir('fuera_de_horario');
    return salir('boton', { motivo: 'cambio_a_delivery', boton: { tipo: 'e', partes: ['delivery'] } });
  }
  // El costo del delivery no es algo que el asistente cobre ni decida: se pasa con el local, SIN la frase de «menú» (el pedido sigue guardado).
  const preguntaCostoDelivery = norm.length <= 100
    && (/\b(cobrar|cobren|cobras|cobran|cobre|cobres|cobrarme|costo|cuesta|cuanto|precio|gratis|pagar)\b.*\b(delivery|envio|domicilio)\b|\b(delivery|envio|domicilio)\b.*\b(gratis|cobr\w*|costo|cuesta|precio|cuanto)\b/.test(norm));
  if (preguntaCostoDelivery && paso !== 'pedido') return salir('transferir', { motivo: 'consulta sobre el costo del delivery', sinFraseMenu: true });
}

// --- Un «sí» suelto no confirma nada; una pregunta orden/unidad pendiente se vuelve a mostrar --
const RELLENO = ['si', 'ya', 'dale', 'ok', 'okey', 'okay', 'listo', 'claro', 'bueno', 'confirmo', 'acepto', 'perfecto', 'adelante',
  'de', 'acuerdo', 'correcto', 'esta', 'bien', 'vale', 'sip', 'va', 'pues', 'una', 'enviar', 'envia', 'envialo', 'enviala',
  'manda', 'mandalo', 'mandala', 'confirmar', 'por', 'favor', 'gracias', 'asi', 'es', 'eso', 'lo', 'la', 'quiero'];
const palabras = norm.split(' ').filter(Boolean);
const soloAfirma = palabras.length > 0 && palabras.length <= 6 && palabras.every((w) => RELLENO.indexOf(w) >= 0);
if ((paso === 'pedido_confirmar' || paso === 'reserva_confirmar') && soloAfirma) return salir('boton', { motivo: 'si_suelto' });
// Lo mismo con el pedido a medias (entrega, datos del delivery, o la carta ya armada): «quiero confirmar», «confirmo», «ok» no se toman por una
// pregunta ni se derivan a una persona; vuelve a salir el paso en que está (el resumen con «Confirmar pedido» cuando ya tiene todo). No confirma solo.
const CONFIRMA = /^(quiero|quisiera|deseo|voy a) (confirmar|enviar|mandar)( (mi|el|este))?( pedido)?( por favor)?$|^(confirmar|confirmo|confirma|enviar|mandar)( (mi|el|este))? pedido( por favor)?$/;
const pedidoEnCurso = ['pedido_entrega', 'pedido_datos'].indexOf(paso) >= 0 || (paso === 'pedido' && Array.isArray(previo.carrito) && previo.carrito.length > 0 && !(Array.isArray(previo.pendiente) && previo.pendiente.length));
if (pedidoEnCurso && !enComprobante && (soloAfirma || CONFIRMA.test(norm))) return salir('boton', { motivo: 'si_suelto' });
if (paso === 'pedido_confirmar' && CONFIRMA.test(norm)) return salir('boton', { motivo: 'si_suelto' });
// Con el resumen mostrado, pedir por texto que se cambie el pedido («cámbiame el pedido», «quiero cambiar mi pedido», «modifica el pedido») abre el cambio igual que el botón
// «Cambiar algo» (`p|cambiar`: la carta de nuevo; lo que se elija reemplaza el pedido). Vocabulario cerrado y comprobación lineal por palabras (sin regex con cuantificadores
// anidados): si la frase lleva algo más («… a recoger», «… de la mesa 3», una dirección), no es esto y sigue su camino de siempre. Cero mensajes agregados: sale el de la carta.
function pideCambiarElPedido(ps) {
  const PRE = ['mejor', 'ya', 'pues', 'entonces', 'por', 'favor', 'quiero', 'quisiera', 'necesito', 'deseo', 'queremos', 'puedo', 'podria', 'puedes', 'podrias', 'voy', 'a'];
  const VERBO = ['cambia', 'cambiame', 'cambialo', 'cambiar', 'cambiarlo', 'modifica', 'modificame', 'modificalo', 'modificar', 'modificarlo', 'corrige', 'corrigeme', 'corregir', 'corregirlo'];
  let i = 0;
  while (i < ps.length && PRE.indexOf(ps[i]) >= 0) i += 1;
  if (i >= ps.length || VERBO.indexOf(ps[i]) < 0) return false;
  i += 1;
  while (i < ps.length && ['me', 'nos', 'el', 'mi', 'mis', 'este', 'la', 'lo'].indexOf(ps[i]) >= 0) i += 1;
  if (i >= ps.length || ['pedido', 'orden', 'compra'].indexOf(ps[i]) < 0) return false;
  i += 1;
  while (i < ps.length && ['por', 'favor', 'otra', 'vez'].indexOf(ps[i]) >= 0) i += 1;
  return i === ps.length;
}
if (paso === 'pedido_confirmar' && pedidosOn && pideCambiarElPedido(palabras)) return cerrado() ? salir('fuera_de_horario') : salir('boton', { motivo: 'cambiar_pedido', boton: { tipo: 'p', partes: ['cambiar'] } }); // respeta el horario igual que el botón
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

// ¿El texto PIDE comida sin decir «pedir» ni escribir un dígito? (05/10: un audio transcrito «quiero cuatro tacos de birria» caía al menú sin llamar al modelo.)
// Cuenta si hay un verbo de pedido («quiero», «dame», «ponme», «mándame», «necesito», «me das»…) junto a una cantidad en palabras que no deja dudas
// («dos» a «diez», «media docena», «docena») o a una palabra de la CARTA CARGADA (sus nombres, con `vmNorm`: nada de productos escritos en el código), o una cantidad
// fuerte junto a una palabra de la carta sin verbo («cuatro tacos de birria por favor»). «un/una» solos NO son cantidad (sin una palabra de la carta, «quiero un
// descuento» no es un pedido). Nunca si habla de una persona, una mesa, la ubicación, el horario o una reserva: eso lo atienden otras reglas.
// El resto sigue igual: si el modelo no saca líneas, no se inventa nada (la carta, o pasar con el local a la segunda vez).
function intencionDePedir(n) {
  if (!n || n.length > 200 || /\b(persona|personas|mesa|mesas|reserv\w*|ubicacion|direccion|horario|hablar|asesor\w*|encargad\w*|humano|humana|queja|reclamo)\b/.test(n)) return false;
  const verbo = /\b(quiero|quisiera|queremos|quisieramos|dame|deme|damelo|ponme|pongame|ponga|mandame|mandeme|necesito|necesitamos|pido|pedimos|traeme|traigame|regalame|me das|me da|me pones|me pone|me manda|me mandas|me regalas|voy a querer|vamos a querer)\b/.test(n);
  const fuerte = /\b(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|docena|media docena)\b/.test(n);
  const sueltas = n.split(' ').filter(Boolean);
  const comunes = ['orden', 'ordenes', 'combo', 'combos', 'promo', 'promos', 'para', 'sin', 'con', 'del', 'los', 'las', 'una', 'unos', 'unas', 'plato', 'platos'];
  const raiz = (w) => w.replace(/(es|s)$/, '');
  // Solo lo que se vende (`cartaDelNegocio`: sin áreas excluidas, agotados ni precios inválidos), y sin las palabras del propio nombre del negocio
  // («Q'Taco» no vuelve «quiero la promo de Q'Taco» un pedido de tacos).
  const delNegocio = vmNorm(cfg.nombreNegocio).split(' ');
  const deLaCarta = [];
  for (const it of cartaDelNegocio()) {
    for (const w of vmNorm(it.nombre).split(' ')) if (w.length >= 4 && comunes.indexOf(w) < 0) deLaCarta.push(raiz(w));
  }
  const nombraLaCarta = sueltas.some((w) => w.length >= 4 && comunes.indexOf(w) < 0 && delNegocio.indexOf(w) < 0 && deLaCarta.indexOf(raiz(w)) >= 0);
  return (verbo && (fuerte || nombraLaCarta)) || (fuerte && nombraLaCarta);
}

// ¿Qué quiere cancelar? '' = nada; 'no' = lo rechaza («no cancela», «no quiero cancelar»); 'pedido' («cancela mi pedido», «ya no quiero el pedido»);
// 'reserva'; 'todo' («cancela todo»); 'solo' = la palabra a secas («cancelar», «quiero cancelar»: se cancela lo que se está haciendo). Mensaje ENTERO
// y corto: «cancelar» dentro de otra frase («¿se puede cancelar después?») no cancela nada.
function intencionDeCancelar(norm) {
  if (!norm || norm.length > 50 || /\d/.test(norm)) return '';
  if (/\bno\b.{0,20}\b(cancel\w*|anul\w*)\b/.test(norm) || /\b(cancel\w*|anul\w*)\b.{0,12}\bno\b/.test(norm)) return /\b(cancel|anul)/.test(norm) ? 'no' : '';
  const V = '(cancelar|cancela|cancelo|cancelame|anular|anula|anulame)';
  if (new RegExp('^(quiero |quisiera |deseo |necesito |voy a |por favor |ya |entonces )*' + V + ' (la |mi |esta |esa )?reserva( por favor)?$').test(norm)) return 'reserva';
  if (new RegExp('^(quiero |quisiera |deseo |necesito |voy a |por favor |ya |entonces )*' + V + ' (todo|todo mi pedido|todo el pedido|todo por favor)( por favor)?$').test(norm)) return 'todo';
  if (new RegExp('^(quiero |quisiera |deseo |necesito |voy a |por favor |ya |entonces )*' + V + '( me)? ?(mi |el |este |ese )(pedido|orden)( por favor)?$').test(norm)
    || /^(cancelar|cancela) pedido( por favor)?$/.test(norm)) return 'pedido';
  if (/^(ya )?no quiero (el |mi |este |ese )?(pedido|nada)( por favor)?$/.test(norm)) return 'pedido';
  if (new RegExp('^(quiero |quisiera |deseo |necesito |voy a |por favor |ya |entonces )*' + V + '(lo|la|melo)?( por favor)?$').test(norm)) return 'solo';
  return '';
}

// ¿Hay un «no» seguido (con «lo/la/me/se/te» a lo sumo) de una palabra que es el verbo dejar en SUBJUNTIVO o INFINITIVO con un error de una letra («dejez», «deges»,
// «dejarl»)? El imperativo afirmativo («dejalo», «dejala», «deja», «dejemoslo») y sus tipeos NO cuentan: «No déjalo como estaba no más.» sigue siendo «volver».
function rechazoConTipeo(palabras) {
  const NEGATIVAS = ['dejes', 'dejen', 'deses', 'dejar', 'dejarlo', 'dejarla'];
  const AFIRMATIVAS = ['dejalo', 'dejala', 'dejemoslo'];
  for (let i = 0; i < palabras.length; i++) {
    if (palabras[i] !== 'no') continue;
    let j = i + 1;
    while (j < palabras.length && ['lo', 'la', 'me', 'se', 'te'].indexOf(palabras[j]) >= 0) j++;
    const w = palabras[j];
    if (!w || w.length < 5) continue;
    if (AFIRMATIVAS.some((k) => distancia(w, k) <= 1)) continue;
    if (NEGATIVAS.some((k) => distancia(w, k) <= 1)) return true;
  }
  return false;
}

// ¿El mensaje ES un pedido de cambiar la entrega? 'delivery' | 'recojo' | ''. TODAS las palabras deben ser del vocabulario cerrado de abajo (rellenos,
// verbos de cambiar, y las palabras de delivery o de recojo, con tolerancia de una letra para las de 5 o más letras: «mandn», «envien», «recojer»);
// sin dígitos, de hasta 8 palabras, y nunca con «no», «nada», «sin», «ni» ni mezclando las dos entregas.
function cambioDeEntrega(norm) {
  const palabras = norm.split(' ').filter(Boolean);
  if (!palabras.length || palabras.length > 8 || norm.length > 60 || /\d/.test(norm)) return '';
  const RELLENO = ['quiero', 'quisiera', 'queremos', 'que', 'me', 'lo', 'la', 'el', 'al', 'a', 'mi', 'por', 'para', 'favor', 'mejor', 'prefiero', 'prefiere',
    'preferimos', 'ya', 'entonces', 'pues', 'yo', 'en', 'local', 'casa', 'puedo', 'podria', 'podrian', 'se', 'puede', 'es', 'posible', 'cambiar', 'cambio',
    'cambialo', 'cambiarlo', 'cambiamelo', 'pasar', 'pasarlo', 'pasalo', 'pasame', 'paso', 'voy', 'ire', 'si', 'ok', 'dale', 'bueno', 'nomas', 'tambien', 'pero'];
  const DELIVERY = ['delivery', 'domicilio', 'envio', 'enviar', 'enviarlo', 'envien', 'envienlo', 'envienmelo', 'enviamelo', 'envialo', 'envian', 'manden', 'mandar',
    'mandarlo', 'mandamelo', 'mandalo', 'mandenlo', 'mandenmelo', 'mandan', 'traigan', 'traer', 'traerlo', 'traiganlo', 'traiganmelo', 'traen', 'lleven', 'llevar',
    'llevarlo', 'llevenlo', 'llevenmelo', 'llevamelo', 'llevan'];
  const RECOJO = ['recoger', 'recogerlo', 'recojo', 'recogo', 'retirar', 'retirarlo', 'retiro', 'buscar', 'buscarlo', 'buscaria'];
  const cerca = (w, lista) => lista.some((k) => w === k || (w.length >= 5 && k.length >= 5 && distancia(w, k) <= 1));
  if (palabras.some((w) => ['no', 'nada', 'sin', 'ni', 'nunca', 'jamas'].indexOf(w) >= 0)) return '';
  let hayDelivery = false;
  let hayRecojo = false;
  for (const w of palabras) {
    if (RELLENO.indexOf(w) >= 0) continue;
    if (cerca(w, DELIVERY)) { hayDelivery = true; continue; }
    if (cerca(w, RECOJO)) { hayRecojo = true; continue; }
    return ''; // una palabra ajena: es una dirección, una referencia o una pregunta, no el pedido de cambiar
  }
  if (hayDelivery === hayRecojo) return '';
  // Un verbo suelto («enviar», «mándalo») es la forma de CONFIRMAR («un “sí” escrito no confirma nada», más abajo), no un cambio de entrega: una sola palabra
  // vale solo si es delivery/domicilio/envío o lleva el «me» («mándamelo»).
  if (palabras.length === 1 && hayDelivery && !/melo$/.test(palabras[0]) && ['delivery', 'domicilio', 'envio'].indexOf(palabras[0]) < 0) return '';
  return hayDelivery ? 'delivery' : 'recojo';
}

// Distancia de edición (Levenshtein) entre dos palabras cortas.
function distancia(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2; // corte temprano: todos los usos comparan con `<= 1`
  let fila = [];
  for (let j = 0; j <= n; j++) fila.push(j);
  for (let i = 1; i <= m; i++) {
    const nueva = [i];
    for (let j = 1; j <= n; j++) nueva.push(Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)));
    fila = nueva;
  }
  return fila[n];
}

// ¿Quiere volver al pedido de antes de «Cambiar algo»? 'si' = se entiende sin duda; 'duda' = habla de dejarlo pero no se entiende del todo o lo rechaza
// («no quiero dejarlo como estaba»); '' = es otra cosa. `norm` ya viene sin tildes, en minúscula y sin signos. Un «no» aislado al comienzo
// («no, déjalo como estaba») es parte de la respuesta y cuenta como volver; un «no» pegado al verbo («no lo dejes») es un rechazo y se trata como duda.
// `tolerante` = solo cuando se está eligiendo de nuevo (carrito nuevo vacío). Reglas de seguridad (PR #426):
//  - TODAS las palabras del mensaje deben ser del vocabulario cerrado de abajo (como `soloAfirma`): una palabra de más («portería», «guardia», «hermana»)
//    hace que NO sea «volver» ni «duda»;
//  - nunca con dígitos ni con más de 6 palabras para la duda (8 para el «sí»);
//  - la tolerancia de edición vale solo para palabras de 5 letras o más (las de 4, por igualdad exacta) y hay una lista negra («deme», «dije», «debe»…);
//  - sin `tolerante` (pedido nuevo en curso) solo valen las formas cerradas y NUNCA se devuelve 'duda'.
function intencionDeVolver(norm, tolerante) {
  const palabras = norm.split(' ').filter(Boolean);
  if (!palabras.length || palabras.length > 8) return '';
  const DEJAR = ['dejalo', 'dejarlo', 'deja', 'dejar', 'deje', 'dejes', 'dejemoslo', 'dejala'];
  const NEGRAS = ['deme', 'dije', 'debe', 'debes', 'dejo', 'teja', 'reja', 'deben', 'dedo'];
  const esDejar = (w) => NEGRAS.indexOf(w) < 0 && DEJAR.some((k) => w === k || (w.length >= 5 && k.length >= 5 && distancia(w, k) <= 1));
  const esEstaba = (w) => w.length >= 5 && w.length <= 7 && distancia(w, 'estaba') <= 1;
  // Vocabulario cerrado del «sí»: lo único que puede decir quien pide dejarlo como estaba.
  const VOCAB = ['como', 'antes', 'igual', 'asi', 'nomas', 'mas', 'no', 'si', 'lo', 'la', 'que', 'te', 'dije', 'ya', 'mejor', 'por', 'favor', 'mi', 'pedido', 'anterior', 'pues', 'quiero', 'tenia', 'el', 'esta', 'estaba'];
  const VOCAB_DUDA = VOCAB.concat(['se', 'cual', 'era', 'puedo', 'podria', 'volver', 'vuelve']);
  const enVocab = (w, v) => v.indexOf(w) >= 0 || esDejar(w) || esEstaba(w);
  const todas = (v) => palabras.every((w) => enVocab(w, v));
  const hayDejar = palabras.some(esDejar);
  const hayEstaba = palabras.some(esEstaba);
  // Un rechazo («no lo dejes como estaba», «no quiero dejarlo») NUNCA es «volver»: con pedido nuevo en curso no es nada; al elegir de nuevo, se pregunta.
  const rechazo = /\bno (quiero|queremos|lo|me|vayas a|deseo)( (lo|me))? (dejar|dejarlo|dejalo|dejes|deje|deses)\b/.test(norm) || /\bno (quiero|queremos) (que )?(lo )?(dejes|dejen|dejemos)\b/.test(norm)
    // «no dejes como estaba», «ya no dejes…», «mejor no dejes…», «no la dejes», «no lo dejen», «no dejarlo», «no dejar…»: un «no» seguido (con «lo/la/me/se/te» a lo sumo) del verbo.
    // El imperativo afirmativo («no, déjalo…», «dejala», «deja») no está en la lista: «No déjalo como estaba no más.» sigue siendo «volver».
    || /\bno (lo |la |me |se |te )*(dejes|dejen|deje|deses|dejar|dejarlo|dejarla)\b/.test(norm)
    // …y con un error de tipeo o de voz en el verbo («no dejez», «no deges»): el verbo, dicho con una letra de más o de menos, tras un «no».
    || rechazoConTipeo(palabras);
  if (rechazo) return tolerante && !/\d/.test(norm) && palabras.length <= 6 && todas(VOCAB_DUDA) ? 'duda' : '';
  // Formas que no llevan el verbo (cerradas).
  const SIN_VERBO = /^((ya|no|si|mejor|pues|es que|entonces) )*(como estaba( antes)?|como antes|lo que tenia|lo anterior|el anterior|mi pedido anterior|(volver|vuelve|volvamos|regresa|regresar) (al|a mi|a el) (pedido )?(anterior|de antes)|(volver|vuelve|volvamos|regresa|regresar) a mi pedido|(manten|mantener|mantenlo|mantengamoslo|mantenga)( mi| el)?( pedido)?|(no|ya no) (quiero )?(cambiar|cambio)( nada)?|no cambiar nada|cancelar( el)? cambio|cancela( el)? cambio|olvida el cambio)( no mas| nomas| igual)?( por favor)?$/;
  if (SIN_VERBO.test(norm)) return 'si';
  // «dejar» + «como estaba» / «como antes» en una frase corta de vocabulario cerrado: la forma cerrada que vale siempre.
  const comoEstaba = (hayEstaba && palabras.indexOf('como') >= 0) || /\bcomo (antes|tenia)\b/.test(norm);
  if (hayDejar && comoEstaba && palabras.length <= 6 && todas(VOCAB)) return 'si';
  if (!tolerante || /\d/.test(norm)) return '';
  // Solo al elegir de nuevo: tolerancia a otras formas de vocabulario cerrado.
  if (hayDejar && todas(VOCAB) && (hayEstaba || /\b(antes|igual|asi|anterior|nomas|mas|tenia)\b/.test(norm))) return 'si';
  if (hayDejar && palabras.length <= 4 && palabras.every((w) => esDejar(w) || ['no', 'si', 'mejor', 'lo', 'ya', 'pues', 'por', 'favor', 'nomas', 'mas'].indexOf(w) >= 0)) return 'si';
  // Modismos y frases de conformidad con lo que había («así nomás», «está bien así», «así está bien», «nomás», «sin cambios», «no cambies nada»): SOLO aquí (al
  // elegir de nuevo, mensaje ENTERO de vocabulario cerrado). Un «no» seguido de «está bien» / «así» («no está bien», «no así») es un rechazo: se pregunta.
  const CONFORME = ['asi', 'nomas', 'esta', 'bien', 'ya', 'pues', 'si', 'ok', 'okey', 'bueno', 'dale', 'entonces', 'mejor', 'dejalo', 'dejarlo', 'sin', 'cambios',
    'no', 'cambies', 'nada', 'quiero', 'cambiar', 'por', 'favor'];
  if (palabras.every((w) => CONFORME.indexOf(w) >= 0)) {
    if (palabras.indexOf('no') >= 0) {
      if (/^((ya|pues|si|ok|okey|bueno|dale|entonces|mejor) )*(no cambies nada|no quiero cambiar nada)( por favor)?$/.test(norm)) return 'si';
      if (palabras.some((w) => ['asi', 'bien', 'esta'].indexOf(w) >= 0)) return 'duda';
    } else if (palabras.some((w) => ['asi', 'nomas', 'bien', 'cambios'].indexOf(w) >= 0)) {
      return 'si';
    }
  }
  // Habla de dejarlo o de lo de antes con palabras de vocabulario cerrado, pero no se entiende del todo: se pregunta (una vez), no se deriva.
  if (palabras.length <= 6 && todas(VOCAB_DUDA) && (hayDejar || hayEstaba || /\b(anterior|tenia)\b/.test(norm) || /\bcomo antes\b/.test(norm))) return 'duda';
  return '';
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

// ¿El texto PIDE la ubicación o la dirección del LOCAL? Función pura sobre el texto ya normalizado con `vmNorm` (sin tildes, en minúsculas, sin signos).
// `restringido` = el flujo está pidiendo la dirección de ENTREGA del cliente (`pedido_datos` con delivery): ahí «ubicación» y «dirección» sueltas son
// DARLA y solo vale lo que nombra al local («dónde están», «del local», «de ustedes», «su dirección», «mapa», «link»).
// 1) NUNCA si da algo: un dígito, una marca de entrega («mi», «estoy en», «calle», «zona», «barrio», «frente a», «nro»…), «te paso…», un enlace pegado.
// 2) Pedidos expresos que nombran al local: «dónde están/queda(n)/se ubican/se encuentran/los encuentro», «dónde está el local», «ubicados», «cómo llego/
//    llegar/se llega», «dirección/ubicación del local/de ustedes», «su dirección», «mapa», «google maps», «link de la ubicación».
// 3) Fuera de lo restringido, el mensaje ENTERO de vocabulario cerrado con una palabra de dirección («ubicación», «pásame la ubicación», «k direccion»,
//    «cuál es la dirección»): una palabra ajena («cambiar la dirección», «dirección de entrega») hace que no sea esto. Con faltas habituales
//    («ubicasion», «direcion»). Las constantes van DENTRO de la función (lo declarado con `const` después del `return` del nodo no se inicializa).
function pideElLocal(n, restringido) {
  if (!n || n.length > 200 || /\d/.test(n)) return false;
  const DA = /\b(?:mi|mis|mio|mia|nuestra|nuestro)\b|\b(?:estoy|estamos|vivo|vivimos|trabajo|trabajamos) (?:en|por|cerca|frente|a)\b|\b(?:te|les|le) (?:paso|mando|envio|comparto|dejo|doy)\b|\b(?:ahi|aqui|aca) (?:va|esta|es|queda)\b|\b(?:adjunto|adjunta|entregar|entregalo|entreguen|entregue|entrega|entregas)\b|\b(?:llevalo|llevamelo|llevenlo|llevenmelo|envialo|enviamelo|envienlo|envienmelo|mandalo|mandamelo|mandenlo|mandenmelo|traelo|traemelo|traiganlo|traiganmelo) a\b|\b(?:calle|calles|avenida|av|avda|zona|barrio|esquina|frente|cerca|nro|numero|casa|edificio|condominio|urbanizacion|urb|piso|departamento|depto|oficina|porteria|referencia|referencias)\b|\bhttps?\b|\bwww\b|\bgoo gl\b|\bmaps app\b/;
  if (DA.test(n)) return false;
  const DIR = '(?:dir[ei]c{1,2}ion(?:es)?|ubi[ck]a[cs]ion(?:es)?)';
  const ESDIR = new RegExp('^' + DIR + '$');
  const LOCAL = '(?:local|locales|restaurante|negocio|tienda|sucursal|lugar|establecimiento)';
  const DONDE = '(?:donde|dnde|dnd|onde)';
  // Qué sigue a «dónde están/queda…»: «los tacos» o «mi pedido» no es el local; «el local» o «ustedes» sí.
  const sigueUnLocal = (resto) => {
    const w = resto.trim().split(' ').filter(Boolean);
    if (!w.length) return true;
    if (['mi', 'mis', 'tu', 'tus', 'los', 'las', 'unos', 'unas', 'pedido', 'orden'].indexOf(w[0]) >= 0) return false;
    if (['el', 'la', 'un', 'una'].indexOf(w[0]) >= 0) return new RegExp('^' + LOCAL + '$').test(w[1] || '');
    return true;
  };
  const dondeEstan = new RegExp('\\b' + DONDE + ' (?:estan|queda|quedan|se ubican|se ubica|se encuentran|se encuentra|los encuentro|las encuentro|los puedo encontrar|funcionan)\\b(.*)$').exec(n);
  if (dondeEstan && sigueUnLocal(dondeEstan[1])) return true;
  if (new RegExp('\\b' + DONDE + ' (?:esta|se ubica|queda) (?:el |la )' + LOCAL + '\\b').test(n)) return true;
  if (/\bubicad[oa]s?\b/.test(n)) return true;
  if (/\bcomo (?:llego|llegar|llegamos|llegare|se llega|puedo llegar|hago para llegar|podemos llegar|llegariamos)\b/.test(n)) return true;
  if (new RegExp('\\b' + DIR + ' (?:del|de el) ' + LOCAL + '\\b').test(n) || new RegExp('\\b' + DIR + ' de (?:ustedes|uds)\\b').test(n)) return true;
  if (new RegExp('\\b(?:su|vuestra|vuestro|tu) ' + DIR + '\\b').test(n)) return true;
  if (/\b(?:mapa|google maps|gmaps|maps)\b/.test(n)) return true;
  if (new RegExp('\\b(?:link|enlace) (?:de |a |al |del )(?:la |el )?(?:' + DIR + '|mapa|' + LOCAL + '|google maps|maps)\\b').test(n)) return true;
  // Mensaje entero de vocabulario cerrado.
  const VOCAB = ['hola', 'buenas', 'buenos', 'buen', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches', 'por', 'favor', 'porfa', 'porfavor', 'plis', 'pls', 'gracias',
    'disculpa', 'disculpe', 'perdon', 'oye', 'una', 'un', 'la', 'el', 'su', 'tu', 'de', 'del', 'local', 'restaurante', 'negocio', 'ustedes', 'uds', 'exacta', 'exacto',
    'cual', 'cuales', 'es', 'seria', 'k', 'q', 'que', 'y', 'o', 'tienen', 'tienes', 'tiene', 'me', 'nos', 'das', 'dan', 'darian', 'darme', 'dar', 'daria', 'dame', 'denme',
    'pasas', 'pasan', 'pasar', 'pasarme', 'pasame', 'pasenme', 'mandas', 'mandan', 'mandar', 'mandarme', 'mandame', 'mandenme', 'compartes', 'comparten', 'compartir',
    'compartirme', 'comparteme', 'compartame', 'comparte', 'compartan', 'pasa', 'pasen', 'manda', 'manden', 'envia', 'envien', 'envias', 'envian', 'enviar', 'enviarme', 'enviame', 'envienme', 'puedes', 'puede', 'pueden', 'podrias', 'podria',
    'podrian', 'necesito', 'necesitamos', 'quiero', 'quisiera', 'queremos', 'saber', 'conocer', 'decirme', 'decir', 'dime', 'digame', 'indicame', 'indicarme', 'indiquen',
    'mapa', 'maps', 'google', 'gmaps', 'link', 'enlace', 'ver', 'muestrame', 'si', 'ok', 'tambien', 'ademas', 'ahora', 'ir', 'a', 'al', 'en'];
  const ps = n.split(' ').filter(Boolean);
  if (ps.length > 12 || !ps.every((w) => VOCAB.indexOf(w) >= 0 || ESDIR.test(w))) return false;
  if (!ps.some((w) => ESDIR.test(w) || ['mapa', 'maps', 'gmaps', 'google', 'link', 'enlace'].indexOf(w) >= 0)) return false;
  // En la entrega del cliente solo cuenta lo que nombra al local.
  if (restringido) return ps.some((w) => ['local', 'restaurante', 'negocio', 'ustedes', 'uds', 'su', 'tu', 'mapa', 'maps', 'gmaps', 'google', 'link', 'enlace'].indexOf(w) >= 0);
  return true;
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
