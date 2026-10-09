// INTERPRETAR ENTRADA: el mensaje entrante, normalizado a UN evento de texto para el modelo.
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image, document, location, sticker, contacts y cualquier otro tipo. Nunca se lee `.text.body` sin
// pasar por aquí. LA CLAVE DE LA CONVERSACIÓN ES EL NÚMERO DE ORIGEN (`messages[0].from`): dos clientes jamás comparten ficha. Si no son solo dígitos (6 a 20), el mensaje se descarta.
//
// NADA se descarta antes del modelo salvo: no hay mensaje, el número no es válido, el prefijo de país no está permitido (responder a un número extranjero cuesta su tarifa), Meta
// reenvió un mensaje que ya se procesó (los últimos ids de la ficha y los de la cola), y lo que no es una conversación (reacciones, bienvenida, sistema, efímeros).
// Este nodo SOLO LEE la ficha. Un audio, una imagen o un documento salen SIN `evento`: lo arma «Registrar evento» con lo que lean los nodos de medios.
const carga = cnPrimero('Carga de entrada') || {};
const cfg = cnCfg();
const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;
if (!msg || typeof msg !== 'object') return [];
if (['reaction', 'request_welcome', 'system', 'ephemeral'].indexOf(String(msg.type || '')) >= 0) return [];

const from = String(msg.from || '');
if (!cnClaveValida(from)) return [];
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
if (prefijos.length && !prefijos.some((p) => from.startsWith(p))) return [];

const mensajeId = String(msg.id || '').slice(0, 200);
if (mensajeId && chYaVisto(cnFichaDe(cnMapaDeFichas(false).mapa, from), mensajeId)) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
const sel = msg.interactive ? (msg.interactive.list_reply || msg.interactive.button_reply) : null;
const audio = msg.audio || msg.voice || null;
const visual = tipo === 'image' ? msg.image : (tipo === 'document' ? msg.document : null);
const idDelMedio = (m) => { const id = m && m.id ? String(m.id) : ''; return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''; };
const mediaId = tipo === 'audio' ? idDelMedio(audio) : (visual ? idDelMedio(visual) : '');
const rubros = (cfg.datos && cfg.datos.rubros) || [];

// El texto del cliente se recorta en el borde (1.500): una regex de costo cuadrático sobre miles de espacios tardaba segundos.
let texto = '';
let textoReporte = '';
let pie = '';
let evento = null;
if (tipo === 'text') {
  texto = String((msg.text && msg.text.body) || '').slice(0, 1500);
  textoReporte = texto;
  evento = chEventoTexto(texto);
} else if (tipo === 'interactive') {
  // Un toque no es texto: lo que cuenta es su id (`rubro:<id>`, `planes`, `equipo`), y solo si tiene la forma esperada.
  const id = String((sel && sel.id) || '');
  evento = chEventoToque(/^[a-z0-9:_-]{1,200}$/.test(id) ? id : '', rubros);
  textoReporte = 'El cliente seleccionó una opción: ' + String((sel && sel.title) || '').slice(0, 100).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
} else if (tipo === 'button') {
  texto = String((msg.button && (msg.button.text || msg.button.payload)) || '').slice(0, 1500);
  textoReporte = 'El cliente tocó el botón: ' + texto;
  // Un botón sin texto no es una imagen: queda como «una respuesta rápida».
  evento = texto.trim() === '' ? chEventoOtro('button') : chEventoTexto(texto);
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
} else if (tipo === 'image') {
  // El pie de foto es texto que escribió el cliente. Lo leído en la imagen va aparte, rotulado como dato.
  pie = String((msg.image && msg.image.caption) || '').slice(0, 1500);
  texto = pie;
  textoReporte = '(imagen) el cliente envió una foto';
} else if (tipo === 'document') {
  pie = String((msg.document && msg.document.caption) || '').slice(0, 1500);
  texto = pie;
  textoReporte = '(documento) el cliente envió un archivo';
} else {
  textoReporte = '(' + tipo.replace(/[^a-z_]/g, '') + ') el cliente envió un mensaje de tipo ' + tipo.replace(/[^a-z_]/g, '');
  evento = chEventoOtro(tipo);
}
// Un texto vacío (solo espacios) no es una conversación.
if (tipo === 'text' && !evento) return [];

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;
const esAudio = tipo === 'audio' && mediaId !== '';
const esVisual = (tipo === 'image' || tipo === 'document') && mediaId !== '';

return [{ json: {
  from: from,
  // El nombre de perfil llega a avisos y planillas: sin <, >, &, saltos ni controles; 60 caracteres.
  nombrePerfil: String((contacto && contacto.profile && contacto.profile.name) || '').slice(0, 200).replace(/[\u0000-\u001f\u007f\u2028\u2029<>&]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60),
  phoneNumberId: carga.phoneNumberId || String((carga.metadata && carga.metadata.phone_number_id) || ''),
  mensajeId: mensajeId,
  tipo: tipo,
  texto: texto,
  textoReporte: textoReporte,
  pie: pie,
  evento: evento,
  anuncio: !!ref,
  origen: ref ? 'anuncio' : 'directo',
  esAudio: esAudio,
  esVisual: esVisual,
  esDocumento: tipo === 'document',
  mediaId: mediaId,
  ahoraMs: Number(carga.ahoraMs) || Date.now(),
  prueba: carga.prueba || null,
} }];
