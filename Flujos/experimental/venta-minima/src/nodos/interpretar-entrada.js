// INTERPRETAR ENTRADA: el mensaje entrante, normalizado.
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image,
// document, video, location, contacts, order y cualquier otro tipo. Nunca se lee `.text.body`
// sin pasar por aca. La clave de la conversacion es el numero de origen (`messages[0].from`).
//
// DEVUELVE [] (no responde nada, no cuesta nada) en estos casos:
//   - no hay mensaje, o `from` no es un numero;
//   - en modo prueba, `from` no es el `telefonoDePrueba` ni un destinatario de aviso ni el `numeroEnsayo`;
//   - el `phone_number_id` no es el esperado (`cfg.phoneNumberIdEsperado`): la WABA puede traer
//     mensajes de otro numero. Sin esperado configurado (marcador sin reemplazar) se descarta
//     TODO, salvo en modo prueba, que no mira este dato;
//   - el prefijo del telefono no esta permitido (responder a un numero extranjero cuesta su tarifa);
//   - el mensaje ya se vio en las ultimas 24 h (`vmYaVisto`; Meta reintenta);
//   - es una reaccion, un sticker o un tipo equivalente sin contenido (cada respuesta cuesta
//     dinero y no hay nada que contestar). CAMBIO AL CONTRATO §4.3, declarado.
//
// EL CARRITO DEL CATALOGO WEB (`tipo: 'carrito'`): solo si `Carga de entrada` marco `carritoWeb: true` (corrio «Carrito del
// catálogo») y con un `carrito` objeto; un `type: 'carrito'` sin esa marca, o la marca con otro tipo, no entra. Su id de mensaje es
// `carrito:<pedidoId>`: el control de «ya visto» (24 h) descarta un reintento del servidor. Sale con `carrito` y
// `reportarEntrante: false` (el servidor ya escribio el pedido y el hilo: `¿Reportar? (entrante)` no lo reporta de nuevo).
//
// LO QUE SE REPORTA A LA CONSOLA (`textoReporte`) no es el contenido de un medio: una nota de voz
// o una foto no dejan rastro escrito.
const SIN_CONTENIDO = ['reaction', 'sticker', 'request_welcome', 'system', 'ephemeral'];

const carga = vmPrimero('Carga de entrada') || {};
const cfg = vmCfg();
const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;
if (!msg || typeof msg !== 'object') return [];

const from = String(msg.from || '');
if (!/^\d{6,20}$/.test(from)) return [];

const prueba = carga.prueba && carga.prueba.modoPrueba === true ? carga.prueba : null;
// EN MODO PRUEBA `from` NO ES LIBRE: el cuerpo de la «Entrada de prueba» lo escribe quien la llama, y desde `from` salen la
// memoria, el cotejo del comprobante y los avisos. Solo pasa un `from` que sea el `telefonoDePrueba` o uno de los permitidos
// (los destinatarios de aviso de «Config base» y `numeroEnsayo`: la misma lista de `¿Avisar de verdad?` y `¿Enviar de verdad?`).
if (prueba) {
  const dig = (x) => String(x === undefined || x === null ? '' : x).replace(/\D/g, '');
  const base = vmPrimero('Config base') || {};
  const permitidos = String(base.destinatariosAviso || '').split(/[,;]/).map((x) => dig(x.split(':')[1]))
    .concat([dig(base.numeroEnsayo), dig(prueba.telefonoDePrueba)]).filter((x) => x.length >= 8);
  if (permitidos.indexOf(from) < 0) return [];
}
const phoneNumberId = String(carga.phoneNumberId || (carga.metadata && carga.metadata.phone_number_id) || '');
const esperado = String(cfg.phoneNumberIdEsperado || '');
if (!prueba && (esperado === '' || phoneNumberId !== esperado)) return [];

if (!vmPrefijoPermitido(from, cfg.prefijosPermitidos)) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
if (SIN_CONTENIDO.indexOf(tipo) >= 0) return [];
// EL CARRITO DEL CATALOGO WEB solo entra por `Carga de entrada` cuando corrio «Carrito del catálogo» (`carritoWeb: true`). Un
// mensaje de tipo `carrito` que NO viene de ahi (Meta no tiene ese tipo) no es nada, y un carrito web nunca se lee como otro tipo.
const esCarritoWeb = carga.carritoWeb === true;
if ((tipo === 'carrito') !== esCarritoWeb) return [];
if (esCarritoWeb && (!msg.carrito || typeof msg.carrito !== 'object' || Array.isArray(msg.carrito))) return [];

const ahoraMs = Number(carga.ahoraMs) || Date.now();
const mensajeId = String(msg.id || '');
const sd = vmSd();
if (sd && vmYaVisto(sd, mensajeId, ahoraMs)) return [];
if (sd) vmMarcarVisto(sd, mensajeId, ahoraMs);

// Si quien escribe es uno de los destinatarios de los avisos, su mensaje abre la ventana de 24 h en
// la que se le puede mandar el detalle en texto. Es un dato de apoyo: si falla, el turno sigue.
if (sd) {
  try {
    const dest = avDestinatarios(cfg.destinatariosAviso, '', cfg.prefijosPermitidos);
    if (Array.isArray(dest) && dest.some((d) => d && d.tel === from)) avAnotarEntrante(sd, from, ahoraMs);
  } catch (e) { /* el aviso con detalle simplemente no sale */ }
}

const sel = msg.interactive ? (msg.interactive.list_reply || msg.interactive.button_reply) : null;
const audio = msg.audio || msg.voice || null;
const medio = msg.image || msg.document || msg.video || audio || null;
// El id del medio va a la URL de Graph: solo letras, numeros, guion y guion bajo (A3). Un id con otra forma es un medio sin
// id utilizable: no se baja ni se transcribe, y el turno sigue como si no hubiera medio.
const mediaIdCrudo = medio && medio.id ? String(medio.id) : '';
const mediaId = /^[A-Za-z0-9_-]{1,100}$/.test(mediaIdCrudo) ? mediaIdCrudo : '';
const mimeType = medio && typeof medio.mime_type === 'string' ? medio.mime_type.slice(0, 100) : '';
// El texto del cliente se recorta en el borde (1.500): una regex de costo cuadratico sobre 80.000
// espacios tardaba 10 a 15 s por mensaje.
const recorta = (t) => String(t || '').slice(0, 1500);

let texto = '';
let textoReporte = '';
let boton = '';
let ubicacion = null;
if (tipo === 'text') {
  texto = recorta(msg.text && msg.text.body);
  textoReporte = texto;
} else if (tipo === 'interactive') {
  texto = recorta(sel && sel.title);
  boton = String((sel && sel.id) || '').slice(0, 256);
  textoReporte = 'El cliente seleccionó la opción: ' + texto + ' (id: ' + boton + ')';
} else if (tipo === 'button') {
  texto = recorta(msg.button && (msg.button.text || msg.button.payload));
  textoReporte = 'El cliente tocó el botón: ' + texto;
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
} else if (tipo === 'image') {
  // El pie de foto es texto que escribio el cliente: `Decidir turno` lo trata como un mensaje de
  // texto. Lo que se reporta sigue siendo solo «envio una foto»: la imagen no deja rastro.
  texto = recorta(msg.image && msg.image.caption);
  textoReporte = '(imagen) el cliente envió una foto';
} else if (tipo === 'document') {
  texto = recorta(msg.document && msg.document.caption);
  textoReporte = '(documento) el cliente envió un archivo';
} else if (tipo === 'location') {
  const l = msg.location && typeof msg.location === 'object' ? msg.location : {};
  const num = (x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) ? Number(x) : NaN;
  const lat = num(l.latitude);
  const lng = num(l.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    ubicacion = { latitud: lat, longitud: lng, nombre: vmLinea(l.name, 100), direccion: vmLinea(l.address, 200) };
  }
  textoReporte = '(ubicación) el cliente compartió una ubicación';
} else if (tipo === 'carrito') {
  // El servidor ya escribio el pedido y el hilo de la conversacion: NO se reporta como entrante (`textoReporte` vacio y
  // `reportarEntrante: false`; `¿Reportar? (entrante)` lo lee). Sin texto: `Decidir turno` decide por `tipo`.
  textoReporte = '';
} else {
  textoReporte = '(' + tipo + ') el cliente envió un mensaje de tipo ' + tipo;
}

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;
const cobro = cfg.cobro && typeof cfg.cobro === 'object' ? cfg.cobro : {};

// COBRO REAL ENCENDIDO CON UN PEDIDO SIMULADO PENDIENTE (simetrico de «real a simulado»): si el pedido al que apunta el QR pendiente es de
// ESTE telefono y salio como simulado, la foto NO es un comprobante real: no se baja, no se lee con Gemini ni se coteja en el servidor (daria
// «cuadra» o «no cuadra» sobre una prueba y un cierre de venta con monto). `comprobanteCruzado` la manda a una persona (`Decidir turno`).
const pedidoDeLaRef = (() => {
  const ref = typeof cobro.pedidoRef === 'string' ? cobro.pedidoRef : '';
  const guardados = sd && sd.pedidos && typeof sd.pedidos === 'object' ? sd.pedidos : {};
  const propio = ref && Object.prototype.hasOwnProperty.call(guardados, ref) ? guardados[ref] : null;
  if (propio && typeof propio === 'object' && String(propio.from) === from) return propio;
  // Igual que `aComprobante`: sin referencia del servidor (`pedido: null`) el pedido es el del estado; con referencia, solo si es ESE mismo.
  const enEstado = sd ? vmLeerEstado(sd, from, ahoraMs).pedido : null;
  if (!enEstado || typeof enEstado !== 'object') return null;
  return !ref || String(enEstado.pedidoId) === ref ? enEstado : null;
})();
const pedidoSimulado = !!pedidoDeLaRef && pedidoDeLaRef.simulado === true;
const llegaComoComprobanteReal = (tipo === 'image' || tipo === 'document') && cobro.activo === true && cobro.modo !== 'simulado' && cobro.pendiente === true;

return [{ json: {
  from: from,
  // El nombre de perfil acaba en los avisos al restaurante y en los resúmenes al cliente: sin <, >, &, saltos ni
  // controles, 60 caracteres y sin palabras de la red de prohibidas («…»): texto de un tercero no traba un mensaje.
  nombrePerfil: vmSinProhibidas(vmLinea(String((contacto && contacto.profile && contacto.profile.name) || '').slice(0, 200), 60), 60),
  phoneNumberId: phoneNumberId,
  mensajeId: mensajeId,
  tipo: tipo,
  texto: texto,
  textoReporte: textoReporte,
  origen: ref ? 'anuncio' : 'directo',
  boton: boton,
  esAudio: tipo === 'audio' && mediaId !== '',
  esComprobante: llegaComoComprobanteReal && mediaId !== '' && !pedidoSimulado,
  comprobanteCruzado: llegaComoComprobanteReal && pedidoSimulado,
  // Cobro SIMULADO: cualquier foto o archivo con el QR pendiente es el comprobante de la prueba. No exige `mediaId` porque no se baja
  // nada (ni se lee con Gemini ni se coteja en el servidor): `esComprobante` y esto nunca valen a la vez.
  comprobanteSimulado: (tipo === 'image' || tipo === 'document') && cobro.modo === 'simulado' && cobro.activo !== true && cobro.pendiente === true,
  mediaId: mediaId,
  mimeType: mimeType,
  ubicacion: ubicacion,
  // Solo el carrito del catalogo web trae estas dos claves (el resto de las entradas queda exactamente como estaba).
  ...(esCarritoWeb ? { carrito: msg.carrito, reportarEntrante: false } : {}),
  ahoraMs: ahoraMs,
  prueba: prueba,
} }];
