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
  // El texto del paciente se recorta en el borde (1.500): una regex de costo cuadratico sobre 80.000
  // espacios tardaba 10 a 15 s por mensaje.
  texto = String((msg.text && msg.text.body) || '').slice(0, 1500);
  textoReporte = texto;
} else if (tipo === 'interactive') {
  texto = String((sel && sel.title) || '').slice(0, 1500);
  textoReporte = 'El cliente seleccionó la opción del menú: ' + texto + ' (id: ' + String((sel && sel.id) || '') + ')';
} else if (tipo === 'button') {
  texto = String((msg.button && (msg.button.text || msg.button.payload)) || '').slice(0, 1500);
  textoReporte = 'El cliente tocó el botón: ' + texto;
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
} else if (tipo === 'image') {
  // El pie de foto (`image.caption`) es texto que escribio el paciente: `Decidir turno` lo trata como un
  // mensaje de texto. Lo que se reporta sigue siendo solo «envio una foto»: la imagen no deja rastro.
  texto = String((msg.image && msg.image.caption) || '').slice(0, 1500);
  textoReporte = '(imagen) el cliente envió una foto';
} else if (tipo === 'document') {
  texto = String((msg.document && msg.document.caption) || '').slice(0, 1500);
  textoReporte = '(documento) el cliente envió un archivo';
} else {
  textoReporte = '(' + tipo + ') el cliente envió un mensaje de tipo ' + tipo;
}

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' && !Array.isArray(msg.referral) ? msg.referral : null;
// EL ANUNCIO Y LA CAMPAÑA (Andres, 17/11/2026; contrato Ad ID + texto). `anuncio` es DATO de Meta, no una orden: recortado y sin saltos. La campaña se reconoce PRIMERO por el Ad ID
// (`referral.source_id`, igualdad exacta de la cadena contra los `adIds` de la campaña vigente, para cualquier tipo de mensaje) y LUEGO por su texto exacto en palabras (solo `text`).
// Reconocerla solo VINCULA la conversación: no salta ningún menú ni cambia la respuesta. Sin referral y sin texto igual, `campana` es null.
const planoAd = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const anuncio = ref ? { titular: planoAd(ref.headline, 120), fuente: planoAd(ref.source_type, 20), idAnuncio: planoAd(ref.source_id, 40), ctwaClid: planoAd(ref.ctwa_clid, 200) } : null;
const palabrasAd = (t) => String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let campanasAd = [];
try { campanasAd = JSON.parse(String(cfg.campanasActivas || '[]')); } catch (e) { campanasAd = []; }
const escritoAd = tipo === 'text' ? palabrasAd(msg.text && msg.text.body) : '';
const idDelAnuncio = anuncio ? anuncio.idAnuncio : '';
let laCampana = null;
let campanaPor = '';
if (Array.isArray(campanasAd)) {
  if (idDelAnuncio !== '') {
    laCampana = campanasAd.find((c) => c && Array.isArray(c.adIds) && c.adIds.some((a) => String(a) === idDelAnuncio)) || null;
    if (laCampana) campanaPor = 'adId';
  }
  if (!laCampana && escritoAd !== '') {
    laCampana = campanasAd.find((c) => c && typeof c.texto === 'string' && palabrasAd(c.texto) === escritoAd) || null;
    if (laCampana) campanaPor = 'texto';
  }
}
const campana = laCampana ? { id: planoAd(laCampana.id, 60), texto: planoAd(laCampana.texto, 300), por: campanaPor } : null;

return [{ json: {
  from: from,
  // El nombre de perfil acaba en la descripcion de la cita y en avisos: sin <, >, &, saltos ni controles; 60 caracteres.
  nombrePerfil: String((contacto && contacto.profile && contacto.profile.name) || '').slice(0, 200).replace(/[\u0000-\u001f\u007f\u2028\u2029<>&]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60),
  phoneNumberId: carga.phoneNumberId || String((carga.metadata && carga.metadata.phone_number_id) || ''),
  mensajeId: String(msg.id || ''),
  tipo: tipo,
  texto: texto,
  textoReporte: textoReporte,
  origen: ref ? 'anuncio' : 'directo',
  anuncio: anuncio,
  campana: campana,
  adId: idDelAnuncio,
  campanaId: campana ? campana.id : '',
  campanaPor: campana ? campana.por : '',
  eleccion: tipo === 'interactive' ? String((sel && sel.id) || '') : '',
  esAudio: tipo === 'audio' && mediaId !== '',
  mediaId: mediaId,
  ahoraMs: Number(carga.ahoraMs) || Date.now(),
  prueba: carga.prueba || null,
} }];
