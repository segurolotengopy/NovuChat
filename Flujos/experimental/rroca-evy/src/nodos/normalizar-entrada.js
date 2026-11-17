// NORMALIZAR ENTRADA: el mensaje entrante, normalizado (tipo, texto, medio y categoría). Nunca se lee `.text.body` sin pasar por aquí.
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image, document, location, sticker, contacts y cualquier otro tipo. LA CLAVE DE LA CONVERSACIÓN ES EL NÚMERO DE ORIGEN
// (`messages[0].from`): dos clientes jamás comparten ficha. Si no son solo dígitos (6 a 20), el mensaje se descarta.
// NADA se descarta antes del modelo salvo: no hay mensaje, el número no es válido, Meta reenvió un mensaje que ya se procesó y lo que no es una conversación (reacciones, bienvenida, sistema, efímeros).
// Un número de otro país (prefijo fuera de `prefijosPermitidos`) sale marcado `extranjero`: «Decidir turno» no le responde y no se reporta. Este nodo SOLO LEE la ficha.
// `bajaEscrita` y `riesgoEscrito`: la baja y la violencia o el miedo EN EL TEXTO o el pie de foto; el reporte del entrante lleva `no_contactar` con cualquiera de las dos.
const carga = cnPrimero('Carga de entrada') || {};
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;
const ahoraTurno = Number(carga.ahoraMs) || Date.now();
if (!msg || typeof msg !== 'object') return [];
if (['reaction', 'request_welcome', 'system', 'ephemeral'].indexOf(String(msg.type || '')) >= 0) return [];

const from = String(msg.from || '');
if (!cnClaveValida(from)) return [];
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
const extranjero = prefijos.length > 0 && !prefijos.some((p) => from.startsWith(p));

const mensajeId = String(msg.id || '').slice(0, 200);
const fichaLeida = cnFichaDe(cnMapaDeFichas(false).mapa, from);
if (mensajeId && evYaVisto(fichaLeida, mensajeId)) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
const sel = msg.interactive ? (msg.interactive.list_reply || msg.interactive.button_reply) : null;
const audio = msg.audio || msg.voice || null;
const visual = tipo === 'image' ? msg.image : (tipo === 'document' ? msg.document : null);
const idDelMedio = (m) => { const id = m && m.id ? String(m.id) : ''; return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''; };
const mediaId = tipo === 'audio' ? idDelMedio(audio) : (visual ? idDelMedio(visual) : '');

// El texto del cliente se recorta en el borde (1.500): una regex de costo cuadrático sobre miles de espacios tardaba segundos.
let texto = '';
let textoReporte = '';
let pie = '';
if (tipo === 'text') {
  texto = String((msg.text && msg.text.body) || '').slice(0, 1500);
  textoReporte = texto;
} else if (tipo === 'interactive') {
  // Este flujo no envía botones de respuesta: un toque viene de un mensaje anterior. Cuenta como el texto de la opción que tocó.
  texto = String((sel && sel.title) || '').slice(0, 100).replace(/[\u0000-\u001f\u007f]/g, ' ');
  textoReporte = 'El cliente seleccionó una opción: ' + texto;
} else if (tipo === 'button') {
  texto = String((msg.button && (msg.button.text || msg.button.payload)) || '').slice(0, 1500);
  textoReporte = 'El cliente tocó el botón: ' + texto;
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
} else if (tipo === 'image') {
  pie = String((msg.image && msg.image.caption) || '').slice(0, 1500);
  texto = pie;
  textoReporte = '(imagen) el cliente envió una foto';
} else if (tipo === 'document') {
  pie = String((msg.document && msg.document.caption) || '').slice(0, 1500);
  texto = pie;
  textoReporte = '(documento) el cliente envió un archivo';
} else {
  textoReporte = '(' + tipo.replace(/[^a-z_]/g, '') + ') el cliente envió un mensaje de tipo ' + tipo.replace(/[^a-z_]/g, '');
}
// Un texto vacío (solo espacios) no es una conversación.
if ((tipo === 'text' || tipo === 'interactive' || tipo === 'button') && texto.trim() === '') return [];

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' && !Array.isArray(msg.referral) ? msg.referral : null;
// EL VÍNCULO CON EL ANUNCIO (Andres, 17/11/2026): PRIMERO el Ad ID del anuncio (`referral.source_id`, igualdad exacta, cualquier tipo de mensaje) y LUEGO el texto exacto en palabras (solo mensajes `text`). `anuncio` sigue siendo booleano
// en este canal (lo leen los tenants con `=== true`); el ID, el clic y el vínculo viajan aparte. Vincular no cambia la respuesta: ningún nodo de decisión lee `campana`.
const planoAd = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const adId = ref ? planoAd(ref.source_id, 40) : '';
const palabrasDe = (t) => String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let campanasCfg = [];
try { campanasCfg = JSON.parse(String(cfg.campanasActivas || '[]')); } catch (e) { campanasCfg = []; }
const escrito = msg.type === 'text' ? palabrasDe(msg.text && msg.text.body) : '';
let laCampana = null;
let campanaPor = '';
if (Array.isArray(campanasCfg)) {
  if (adId !== '') {
    laCampana = campanasCfg.find((c) => c && Array.isArray(c.adIds) && c.adIds.some((a) => String(a) === adId)) || null;
    if (laCampana) campanaPor = 'adId';
  }
  if (!laCampana && escrito !== '') {
    laCampana = campanasCfg.find((c) => c && typeof c.texto === 'string' && palabrasDe(c.texto) === escrito) || null;
    if (laCampana) campanaPor = 'texto';
  }
}
const campana = laCampana ? { id: planoAd(laCampana.id, 60), texto: planoAd(laCampana.texto, 300).replace(/[\[\]]/g, ''), por: campanaPor } : null;
const categoria = (tipo === 'text' || tipo === 'interactive' || tipo === 'button') ? 'conversacion' : ((tipo === 'audio' || tipo === 'image' || tipo === 'document') ? 'medio' : 'otro');
const mimeType = visual && typeof visual.mime_type === 'string' ? visual.mime_type.slice(0, 100) : '';
// ¿Se escucha este audio o se mira esta foto? Lo decide el código ANTES de bajar nada (tipo, formato y el tope diario por teléfono). Un documento NUNCA se baja.
const medios = evMediosDelTurno({ tipo: tipo, mediaId: mediaId, mimeType: mimeType, extranjero: extranjero, ficha: evFichaVigente(fichaLeida, ahoraTurno), ahoraMs: ahoraTurno, base: base });

return [{ json: {
  from: from,
  // El nombre de perfil llega a los avisos: sin <, >, &, saltos ni controles; 60 caracteres.
  nombrePerfil: String((contacto && contacto.profile && contacto.profile.name) || '').slice(0, 200).replace(/[\u0000-\u001f\u007f<>&]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60),
  phoneNumberId: carga.phoneNumberId || String((carga.metadata && carga.metadata.phone_number_id) || ''),
  mensajeId: mensajeId,
  tipo: tipo,
  texto: texto,
  textoReporte: textoReporte,
  pie: pie,
  categoria: categoria,
  mimeType: mimeType,
  extranjero: extranjero,
  verImagen: medios.verImagen,
  imagenTope: medios.imagenTope,
  visionApagada: medios.visionApagada,
  oirAudio: medios.oirAudio,
  audioTope: medios.audioTope,
  audioApagado: medios.audioApagado,
  esMedioAudio: tipo === 'audio' && mediaId !== '',
  esMedioVisual: tipo === 'image' && mediaId !== '',
  esDocumento: tipo === 'document',
  mediaId: mediaId,
  anuncio: !!ref,
  campana: campana,
  adId: adId,
  campanaId: campana ? campana.id : '',
  campanaPor: campana ? campana.por : '',
  ctwaClid: ref ? planoAd(ref.ctwa_clid, 200) : '',
  origen: ref ? 'anuncio' : 'directo',
  bajaEscrita: evEsBaja(texto) || evEsBaja(pie),
  riesgoEscrito: evEsRiesgo(evNorm([texto, pie].join(' '))),
  ahoraMs: ahoraTurno,
  prueba: carga.prueba || null,
} }];
