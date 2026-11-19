// NORMALIZAR ENTRADA: el mensaje entrante, normalizado a UN evento. Es el nodo que los módulos comunes de medios leen por nombre: «Preparar transcripción», «Preparar imagen» y «Medio no aceptado»
// buscan `$('Normalizar entrada')` (campos `esMedioAudio`, `mediaId`, `mimeType`), así que el nombre y esos campos son un contrato (probado en `medios.test.ts`).
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image, document, location, sticker, contacts, order y cualquier otro tipo. Nunca se lee `.text.body` sin pasar por aquí.
// LA CLAVE DE LA CONVERSACIÓN ES EL NÚMERO DE ORIGEN (`messages[0].from`): dos clientes jamás comparten ficha. Si no son solo dígitos (6 a 20), el mensaje se descarta. Solo se lee `messages[0]` (límite declarado).
//
// LA UBICACIÓN (location): con latitud y longitud NÚMEROS finitos en rango (|lat| <= 90, |lng| <= 180) y distintas de (0, 0) —el valor que ponen los clientes sin GPS—, el mensaje es una conversación y sale `ubicacion: {lat, lng}`.
// `ubicacion` se publica siempre (válida o null), pero el mensaje solo pasa a conversación si el tenant declara `aceptaUbicacion: true` en `CN_TENANT`; si no, o si la ubicación no es válida (sin coordenadas, cadenas, fuera de rango, (0,0), otro país), sigue siendo «otro», como siempre. El nombre y la dirección que manda el cliente en el pin NO se leen.
// EL ANUNCIO (referral): `anuncioId` (source_id, 64), `anuncioTitular` (headline, 200) y `anuncioCuerpo` (body, 200), saneados (sin controles, bidi, <, > ni &). Todos los campos nuevos existen SIEMPRE (vacíos o null).
// NADA se descarta salvo: no hay mensaje, el número no es válido, el prefijo de país no está permitido y ya se le respondió en las últimas 24 horas, Meta reenvió un mensaje que ya se procesó (los últimos ids de la ficha) y lo que no es una
// conversación (reacciones, bienvenida, sistema, efímeros). Este nodo SOLO LEE la ficha. `categoria`: `conversacion` (texto o toque), `medio` (audio, imagen o PDF con id de medio) u `otro` (lo que este canal
// no lee: texto cortés fijo, sin modelo). Un audio, una imagen o un documento salen SIN texto: lo arman los nodos de medios.
const carga = cnPrimero('Carga de entrada') || {};
const cfg = cnCfg();
const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;
if (!msg || typeof msg !== 'object') return [];
if (['reaction', 'request_welcome', 'system', 'ephemeral'].indexOf(String(msg.type || '')) >= 0) return [];

const from = String(msg.from || '');
if (!cnClaveValida(from)) return [];
const ahoraTurno = Number(carga.ahoraMs) || Date.now();
// UN PREFIJO NO PERMITIDO (número no boliviano) YA NO SE DESCARTA EN SILENCIO (decisión de Andres, 20/10/2026): recibe UNA vez en 24 horas el texto fijo del tenant, sin QR, sin modelo y sin
// descargar ningún medio; los mensajes siguientes de ese número dentro de las 24 horas se descartan sin responder. Este nodo solo LEE la ficha: la marca la escribe «Armar mensajes».
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
const fueraDePais = prefijos.length > 0 && !prefijos.some((p) => from.startsWith(p));
const fichaAntes = CN_TENANT.fichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahoraTurno);
if (fueraDePais && fichaAntes.fueraDePaisMs > 0 && ahoraTurno - fichaAntes.fueraDePaisMs >= 0 && ahoraTurno - fichaAntes.fueraDePaisMs < CN_TENANT.ventanaFueraDePaisMs) return [];

const mensajeId = String(msg.id || '').slice(0, 200);
if (mensajeId && CN_TENANT.yaVisto(fichaAntes, mensajeId)) return [];

const tipo = msg.type === 'voice' ? 'audio' : String(msg.type || 'desconocido');
const sel = msg.interactive ? (msg.interactive.list_reply || msg.interactive.button_reply) : null;
const audio = msg.audio || msg.voice || null;
const visual = tipo === 'image' ? msg.image : (tipo === 'document' ? msg.document : null);
const idDelMedio = (m) => { const id = m && m.id ? String(m.id) : ''; return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''; };
const mediaId = tipo === 'audio' ? idDelMedio(audio) : (visual ? idDelMedio(visual) : '');
const sinControles = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);

const coordenada = (v, max) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
const loc = tipo === 'location' && msg.location && typeof msg.location === 'object' ? msg.location : null;
const lat = loc ? coordenada(loc.latitude, 90) : null;
const lng = loc ? coordenada(loc.longitude, 180) : null;
const ubicacion = lat !== null && lng !== null && !(lat === 0 && lng === 0) ? { lat: lat, lng: lng } : null;
let texto = '';
let textoReporte = '';
let pie = '';
let seleccionId = '';
let seleccionTitulo = '';
let categoria = 'otro';
if (tipo === 'text') {
  // El texto del cliente se recorta en el borde (1.500): una regex de costo cuadrático sobre miles de espacios tardaba segundos.
  texto = CN_TENANT.lineaCliente(msg.text && msg.text.body, 1500);
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
  texto = CN_TENANT.lineaCliente(msg.button && (msg.button.text || msg.button.payload), 1500);
  textoReporte = 'El cliente tocó el botón: ' + texto;
  categoria = texto.trim() === '' ? 'otro' : 'conversacion';
} else if (tipo === 'audio') {
  textoReporte = '(audio) el cliente envió una nota de voz';
  categoria = mediaId !== '' ? 'medio' : 'otro';
} else if (tipo === 'image' || tipo === 'document') {
  // El pie de foto es texto que escribió el cliente; lo leído en la imagen va aparte, como dato.
  pie = CN_TENANT.lineaCliente(visual && visual.caption, 1500);
  texto = pie;
  textoReporte = tipo === 'image' ? '(imagen) el cliente envió una foto' : '(documento) el cliente envió un archivo';
  categoria = mediaId !== '' ? 'medio' : 'otro';
} else if (tipo === 'location') {
  textoReporte = '(ubicación) el cliente compartió su ubicación';
  // OPT-IN POR TENANT: solo si su librería declara `CN_TENANT.aceptaUbicacion === true` el pin es una conversación (con un texto fijo, nunca el del cliente); sin el parámetro sigue siendo «otro» (texto cortés, sin modelo), como siempre.
  if (ubicacion && typeof CN_TENANT === 'object' && CN_TENANT && CN_TENANT.aceptaUbicacion === true) {
    texto = '(el cliente compartió su ubicación)';
    categoria = 'conversacion';
  }
} else {
  const rotulo = tipo.replace(/[^a-z_]/g, '');
  textoReporte = '(' + rotulo + ') el cliente envió un mensaje de tipo ' + rotulo;
}
// Un texto vacío (solo espacios) no es una conversación.
if (categoria === '') return [];
// Fuera del país: nada de modelo ni de medios; la respuesta es el texto fijo.
if (fueraDePais) categoria = 'otro';
// La hora del mensaje (la `timestamp` de Meta, en segundos) para el plazo del aviso al comercio: solo si es de las últimas 24 horas; si no, el reloj del proceso.
const tsMeta = Number(msg.timestamp) * 1000;
const mensajeMs = Number.isFinite(tsMeta) && tsMeta <= ahoraTurno && ahoraTurno - tsMeta <= 24 * 60 * 60 * 1000 ? tsMeta : ahoraTurno;

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;
// Del texto de un anuncio: sin controles, sin marcas bidi, sin <, > ni & (un dato, nunca algo ejecutable) y sin espacios de más. Solo texto: un objeto o una lista valen vacío.
const textoDeAnuncio = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff<>&]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) : '');
const idDeAnuncio = ((v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : ''))(typeof (ref && ref.source_id) === 'string' && ref.source_id.length <= 64 ? ref.source_id : '');
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
  anuncioId: idDeAnuncio,
  anuncioTitular: textoDeAnuncio(ref && ref.headline, 200),
  anuncioCuerpo: textoDeAnuncio(ref && ref.body, 200),
  // Solo con una ubicación válida de un número atendido; si no, null.
  ubicacion: fueraDePais ? null : ubicacion,
  // El contrato con los módulos comunes de medios.
  esMedioAudio: !fueraDePais && tipo === 'audio' && mediaId !== '',
  esMedioVisual: !fueraDePais && (tipo === 'image' || tipo === 'document') && mediaId !== '',
  esDocumento: tipo === 'document',
  mediaId: fueraDePais ? '' : mediaId,
  fueraDePais: fueraDePais,
  // Violencia o miedo en el texto o en el pie de foto: el reporte del entrante lleva `no_contactar` (así no hace falta un reporte aparte que cree un mensaje de más).
  riesgoEscrito: CN_TENANT.esRiesgo(CN_TENANT.norm([texto, pie].join(' '))),
  mensajeMs: mensajeMs,
  mimeType: mimeType,
  ahoraMs: ahoraTurno,
  prueba: carga.prueba || null,
} }];
