// NORMALIZAR ENTRADA: el mensaje entrante, normalizado a UN evento. Es el nodo que los módulos comunes de medios leen por nombre: «Preparar transcripción», «Preparar imagen» y «Medio no aceptado»
// buscan `$('Normalizar entrada')` (campos `esMedioAudio`, `mediaId`, `mimeType`), así que el nombre y esos campos son un contrato (probado en `medios.test.ts`).
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image, document, location, sticker, contacts, order y cualquier otro tipo. Nunca se lee `.text.body` sin pasar por aquí.
// LA CLAVE DE LA CONVERSACIÓN ES EL NÚMERO DE ORIGEN (`messages[0].from`): dos clientes jamás comparten ficha. Si no son solo dígitos (6 a 20), el mensaje se descarta. Solo se lee `messages[0]` (límite declarado).
//
// NADA se descarta salvo: no hay mensaje, el número no es válido, el prefijo de país no está permitido, Meta reenvió un mensaje que ya se procesó (los últimos ids de la ficha) y lo que no es una
// conversación (reacciones, bienvenida, sistema, efímeros). Este nodo SOLO LEE la ficha. `categoria`: `conversacion` (texto o toque), `medio` (audio, imagen o PDF con id de medio) u `otro` (lo que este canal
// no lee: texto cortés fijo, sin modelo). Un audio, una imagen o un documento salen SIN texto: lo arman los nodos de medios.
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
if (mensajeId && raYaVisto(cnFichaDe(cnMapaDeFichas(false).mapa, from), mensajeId)) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
const sel = msg.interactive ? (msg.interactive.list_reply || msg.interactive.button_reply) : null;
const audio = msg.audio || msg.voice || null;
const visual = tipo === 'image' ? msg.image : (tipo === 'document' ? msg.document : null);
const idDelMedio = (m) => { const id = m && m.id ? String(m.id) : ''; return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''; };
const mediaId = tipo === 'audio' ? idDelMedio(audio) : (visual ? idDelMedio(visual) : '');
const sinControles = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);

let texto = '';
let textoReporte = '';
let pie = '';
let seleccionId = '';
let seleccionTitulo = '';
let categoria = 'otro';
if (tipo === 'text') {
  // El texto del cliente se recorta en el borde (1.500): una regex de costo cuadrático sobre miles de espacios tardaba segundos.
  texto = raLineaCliente(msg.text && msg.text.body, 1500);
  textoReporte = texto;
  categoria = texto.trim() === '' ? '' : 'conversacion';
} else if (tipo === 'interactive') {
  // Un toque no es texto: lo que cuenta es su id, y solo si tiene la forma esperada.
  const id = String((sel && sel.id) || '');
  seleccionId = /^[a-z0-9:_-]{1,200}$/.test(id) ? id : '';
  seleccionTitulo = sinControles(sel && sel.title, 100);
  textoReporte = 'El cliente seleccionó una opción: ' + seleccionTitulo;
  categoria = seleccionId ? 'conversacion' : 'otro';
} else if (tipo === 'button') {
  texto = raLineaCliente(msg.button && (msg.button.text || msg.button.payload), 1500);
  textoReporte = 'El cliente tocó el botón: ' + texto;
  categoria = texto.trim() === '' ? 'otro' : 'conversacion';
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
  categoria = mediaId !== '' ? 'medio' : 'otro';
} else if (tipo === 'image' || tipo === 'document') {
  // El pie de foto es texto que escribió el cliente; lo leído en la imagen va aparte, como dato.
  pie = raLineaCliente(visual && visual.caption, 1500);
  texto = pie;
  textoReporte = tipo === 'image' ? '(imagen) el cliente envió una foto' : '(documento) el cliente envió un archivo';
  categoria = mediaId !== '' ? 'medio' : 'otro';
} else {
  const rotulo = tipo.replace(/[^a-z_]/g, '');
  textoReporte = '(' + rotulo + ') el cliente envió un mensaje de tipo ' + rotulo;
}
// Un texto vacío (solo espacios) no es una conversación.
if (categoria === '') return [];

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;
const mimeType = sinControles(visual && visual.mime_type, 100).toLowerCase();

return [{ json: {
  from: from,
  // El nombre de perfil llega a los avisos: sin <, >, &, saltos ni controles; 60 caracteres.
  nombrePerfil: String((contacto && contacto.profile && contacto.profile.name) || '').slice(0, 200).replace(/[\u0000-\u001f\u007f\u2028\u2029<>&]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60),
  phoneNumberId: carga.phoneNumberId || String((carga.metadata && carga.metadata.phone_number_id) || ''),
  mensajeId: mensajeId,
  tipo: tipo,
  categoria: categoria,
  texto: texto,
  textoReporte: textoReporte,
  pie: pie,
  seleccionId: seleccionId,
  seleccionTitulo: seleccionTitulo,
  anuncio: !!ref,
  origen: ref ? 'anuncio' : 'directo',
  // El contrato con los módulos comunes de medios.
  esMedioAudio: tipo === 'audio' && mediaId !== '',
  esMedioVisual: (tipo === 'image' || tipo === 'document') && mediaId !== '',
  esDocumento: tipo === 'document',
  mediaId: mediaId,
  mimeType: mimeType,
  ahoraMs: Number(carga.ahoraMs) || Date.now(),
  prueba: carga.prueba || null,
} }];
