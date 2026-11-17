// INTERPRETAR ENTRADA: el mensaje entrante, normalizado.
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image, document y cualquier otro tipo.
// Nunca se lee `.text.body` sin pasar por aca. LA CLAVE DE LA CONVERSACION ES EL NUMERO DE ORIGEN (`messages[0].from`): dos
// clientes jamas comparten ficha. Si no son solo digitos (6 a 20), el mensaje se descarta: nunca una clave que toque el prototipo.
//
// Devuelve `[]` (no reporta ni responde) si: no hay mensaje; el numero no es valido; el prefijo de pais no esta permitido
// (responder a un numero extranjero cuesta su tarifa); o Meta reenvio un mensaje que ya se proceso (`ultimosIds` de la ficha).
// Este nodo SOLO LEE la ficha: el unico que la escribe es «Armar mensajes».
//
// Lo que se reporta a la consola (`textoReporte`) no es el contenido de un medio: una nota de voz o una foto no dejan rastro escrito.
const carga = cnPrimero('Carga de entrada') || {};
const cfg = cnCfg();
const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;
if (!msg || typeof msg !== 'object') return [];
// Lo que no es una conversacion (R10): una reaccion, un sticker, un saludo de bienvenida, un mensaje de sistema o uno efimero
// no se reporta ni se responde.
if (['reaction', 'sticker', 'request_welcome', 'system', 'ephemeral'].indexOf(String(msg.type || '')) >= 0) return [];

const from = String(msg.from || '');
if (!cnClaveValida(from)) return [];
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
if (prefijos.length && !prefijos.some((p) => from.startsWith(p))) return [];

const mensajeId = String(msg.id || '').slice(0, 200);
const ficha = cnMapaDeFichas(false).mapa;
if (mensajeId && Object.prototype.hasOwnProperty.call(ficha, from) && cnYaVisto(ficha[from], mensajeId)) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
const sel = msg.interactive ? (msg.interactive.list_reply || msg.interactive.button_reply) : null;
const audio = msg.audio || msg.voice || null;
const visual = tipo === 'image' ? msg.image : (tipo === 'document' ? msg.document : null);
const idDelMedio = (m) => { const id = m && m.id ? String(m.id) : ''; return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''; };
const mediaId = tipo === 'audio' ? idDelMedio(audio) : (visual ? idDelMedio(visual) : '');

// El texto del cliente se recorta en el borde (1.500): una regex de costo cuadratico sobre miles de espacios tardaba segundos.
let texto = '';
let textoReporte = '';
let idToque = '';
if (tipo === 'text') {
  texto = String((msg.text && msg.text.body) || '').slice(0, 1500);
  textoReporte = texto;
} else if (tipo === 'interactive') {
  // Un toque no es texto: lo que cuenta es su id (`rubro:<id>`, `planes`, `asesor`), y solo si tiene la forma esperada.
  const id = String((sel && sel.id) || '');
  idToque = /^[a-z0-9:_-]{1,200}$/.test(id) ? id : '';
  textoReporte = 'El cliente seleccionó una opción: ' + String((sel && sel.title) || '').slice(0, 100).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
} else if (tipo === 'button') {
  texto = String((msg.button && (msg.button.text || msg.button.payload)) || '').slice(0, 1500);
  textoReporte = 'El cliente tocó el botón: ' + texto;
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
} else if (tipo === 'image') {
  // El pie de foto es texto que escribio el cliente: se trata como su mensaje. Lo leido en la imagen va aparte (`textoDeImagen`).
  texto = String((msg.image && msg.image.caption) || '').slice(0, 1500);
  textoReporte = '(imagen) el cliente envió una foto';
} else if (tipo === 'document') {
  texto = String((msg.document && msg.document.caption) || '').slice(0, 1500);
  textoReporte = '(documento) el cliente envió un archivo';
} else {
  textoReporte = '(' + tipo.replace(/[^a-z_]/g, '') + ') el cliente envió un mensaje de tipo ' + tipo.replace(/[^a-z_]/g, '');
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
campanasAd = Array.isArray(cfg.campanas) ? cfg.campanas : [];
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
const esAudio = tipo === 'audio' && mediaId !== '';
const esVisual = (tipo === 'image' || tipo === 'document') && mediaId !== '';
// De qué manera llega lo que dijo (lo calcula este nodo y lo usa «Decidir turno»): texto escrito, audio, un toque, una imagen o
// un documento; cualquier otro tipo es `otro` (sticker, ubicación, contacto…).
const via = tipo === 'text' || tipo === 'button' ? 'texto' : (tipo === 'audio' ? 'audio' : (tipo === 'interactive' ? 'toque'
  : (tipo === 'image' ? 'imagen' : (tipo === 'document' ? 'documento' : 'otro'))));

return [{ json: {
  from: from,
  // El nombre de perfil llega a avisos y planillas: sin <, >, &, saltos ni controles; 60 caracteres.
  nombrePerfil: String((contacto && contacto.profile && contacto.profile.name) || '').slice(0, 200).replace(/[\u0000-\u001f\u007f\u2028\u2029<>&]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60),
  phoneNumberId: carga.phoneNumberId || String((carga.metadata && carga.metadata.phone_number_id) || ''),
  mensajeId: mensajeId,
  tipo: tipo,
  via: via,
  texto: texto,
  idToque: idToque,
  textoReporte: textoReporte,
  anuncio: anuncio,
  campana: campana,
  adId: idDelAnuncio,
  campanaId: campana ? campana.id : '',
  campanaPor: campana ? campana.por : '',
  origen: ref ? 'anuncio' : 'directo',
  esAudio: esAudio,
  esVisual: esVisual,
  esDocumento: tipo === 'document',
  mediaId: mediaId,
  ahoraMs: Number(carga.ahoraMs) || Date.now(),
  prueba: carga.prueba || null,
} }];
