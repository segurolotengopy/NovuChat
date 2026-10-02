// INTERPRETAR ENTRADA: el mensaje entrante, normalizado.
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image,
// document, video, location, contacts, order y cualquier otro tipo. Nunca se lee `.text.body`
// sin pasar por aca. La clave de la conversacion es el numero de origen (`messages[0].from`).
//
// DEVUELVE [] (no responde nada, no cuesta nada) en estos casos:
//   - no hay mensaje, o `from` no es un numero;
//   - el `phone_number_id` no es el esperado (`cfg.phoneNumberIdEsperado`): la WABA puede traer
//     mensajes de otro numero. Sin esperado configurado (marcador sin reemplazar) se descarta
//     TODO, salvo en modo prueba, que no mira este dato;
//   - el prefijo del telefono no esta permitido (responder a un numero extranjero cuesta su tarifa);
//   - el mensaje ya se vio en las ultimas 24 h (`vmYaVisto`; Meta reintenta);
//   - es una reaccion, un sticker o un tipo equivalente sin contenido (cada respuesta cuesta
//     dinero y no hay nada que contestar). CAMBIO AL CONTRATO §4.3, declarado.
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
const phoneNumberId = String(carga.phoneNumberId || (carga.metadata && carga.metadata.phone_number_id) || '');
const esperado = String(cfg.phoneNumberIdEsperado || '');
if (!prueba && (esperado === '' || phoneNumberId !== esperado)) return [];

if (!vmPrefijoPermitido(from, cfg.prefijosPermitidos)) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
if (SIN_CONTENIDO.indexOf(tipo) >= 0) return [];

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
const mediaId = medio && medio.id ? String(medio.id) : '';
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
} else {
  textoReporte = '(' + tipo + ') el cliente envió un mensaje de tipo ' + tipo;
}

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;
const cobro = cfg.cobro && typeof cfg.cobro === 'object' ? cfg.cobro : {};

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
  esComprobante: (tipo === 'image' || tipo === 'document') && cobro.activo === true && cobro.pendiente === true && mediaId !== '',
  mediaId: mediaId,
  mimeType: mimeType,
  ubicacion: ubicacion,
  ahoraMs: ahoraMs,
  prueba: prueba,
} }];
