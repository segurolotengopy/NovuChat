// INTERPRETAR ENTRADA: el mensaje entrante, normalizado (criterio B-3 de Bellido).
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice,
// image, document, video, sticker, location, contacts, order, reaction y cualquier
// otro tipo. Nunca se lee `.text.body` sin pasar por aca. La clave de la conversacion
// es el numero de origen (`messages[0].from`).
//
// LO QUE SE REPORTA A LA CONSOLA (`textoReporte`) no es el contenido de un medio: una
// nota de voz o una foto de un nino no dejan rastro escrito (datos de salud).
const carga = cnPrimero('Carga de entrada') || {};
const cfg = cnCfg();
const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;
if (!msg) return [];

const from = String(msg.from || '');
// Filtro por pais de origen: responder a un numero extranjero cuesta su tarifa.
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
if (prefijos.length && !prefijos.some((p) => from.startsWith(p))) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
const sel = msg.interactive ? (msg.interactive.list_reply || msg.interactive.button_reply) : null;
const audio = msg.audio || msg.voice || null;
const medio = msg.image || msg.document || msg.video || msg.sticker || audio || null;
const mediaId = medio && medio.id ? String(medio.id) : '';

let texto = '';
let textoReporte = '';
if (tipo === 'text') {
  texto = String((msg.text && msg.text.body) || '');
  textoReporte = texto;
} else if (tipo === 'interactive') {
  texto = String((sel && sel.title) || '');
  textoReporte = 'El cliente seleccionó la opción del menú: ' + texto + ' (id: ' + String((sel && sel.id) || '') + ')';
} else if (tipo === 'button') {
  texto = String((msg.button && (msg.button.text || msg.button.payload)) || '');
  textoReporte = 'El cliente tocó el botón: ' + texto;
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
} else if (tipo === 'image') {
  textoReporte = '(imagen) el cliente envió una foto';
} else if (tipo === 'document') {
  textoReporte = '(documento) el cliente envió un archivo';
} else {
  textoReporte = '(' + tipo + ') el cliente envió un mensaje de tipo ' + tipo;
}

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;

return [{ json: {
  from: from,
  nombrePerfil: String((contacto && contacto.profile && contacto.profile.name) || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80),
  phoneNumberId: carga.phoneNumberId || String((carga.metadata && carga.metadata.phone_number_id) || ''),
  mensajeId: String(msg.id || ''),
  tipo: tipo,
  texto: texto,
  textoReporte: textoReporte,
  origen: ref ? 'anuncio' : 'directo',
  eleccion: tipo === 'interactive' ? String((sel && sel.id) || '') : '',
  esAudio: tipo === 'audio' && mediaId !== '',
  mediaId: mediaId,
  ahoraMs: Number(carga.ahoraMs) || Date.now(),
  prueba: carga.prueba || null,
} }];
