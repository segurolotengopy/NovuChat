// INTERPRETAR ENTRADA: el mensaje entrante, normalizado (tipo, texto, medio y categoría). PR-1 no tiene modelo: la categoría solo dice qué clase de entrada llegó.
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image, document, location, sticker, contacts y cualquier otro tipo. Nunca se lee `.text.body` sin
// pasar por aquí. LA CLAVE DE LA CONVERSACIÓN ES EL NÚMERO DE ORIGEN (`messages[0].from`): dos clientes jamás comparten ficha. Si no son solo dígitos (6 a 20), el mensaje se descarta.
//
// NADA se descarta antes del modelo salvo: no hay mensaje, el número no es válido, Meta
// reenvió un mensaje que ya se procesó (los últimos ids de la ficha y los de la cola), y lo que no es una conversación (reacciones, bienvenida, sistema, efímeros).
// UN NÚMERO DE OTRO PAÍS (prefijo fuera de `prefijosPermitidos`) YA NO SE DESCARTA EN SILENCIO: sale marcado `extranjero` (sin descargar nada, sin QR, sin aviso) y «Decidir turno» le responde una vez al día.
// Este nodo SOLO LEE la ficha. Un audio, una imagen o un documento salen con `categoria: medio` y su `mediaId`; todo lo demás conversable, con `categoria: conversacion`; cualquier otro tipo, con `categoria: otro` (el flujo igual contesta cortésmente).
const carga = cnPrimero('Carga de entrada') || {};
const cfg = cnCfg();
const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;
// El instante en que el CLIENTE escribió (Meta manda `timestamp` en segundos): de ahí parte la hora límite del aviso. Solo vale si es un número finito, no posterior al reloj del proceso y
// de las últimas 24 h; si no, `mensajeMs` es el reloj del proceso. `ahoraMs` (el reloj del proceso) sigue siendo el de las ventanas y las fichas.
const ahoraTurno = Number(carga.ahoraMs) || Date.now();
const tsMeta = msg && /^\d{1,12}$/.test(String(msg.timestamp)) ? Number(msg.timestamp) * 1000 : NaN;
const mensajeMs = Number.isFinite(tsMeta) && tsMeta <= ahoraTurno && ahoraTurno - tsMeta <= 24 * 60 * 60 * 1000 ? tsMeta : ahoraTurno;
if (!msg || typeof msg !== 'object') return [];
if (['reaction', 'request_welcome', 'system', 'ephemeral'].indexOf(String(msg.type || '')) >= 0) return [];

const from = String(msg.from || '');
if (!cnClaveValida(from)) return [];
const extranjero = rrEsExtranjero(from, cfg.prefijosPermitidos);

const mensajeId = String(msg.id || '').slice(0, 200);
if (mensajeId && rrYaVisto(cnFichaDe(cnMapaDeFichas(false).mapa, from), mensajeId)) return [];

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
  // Un toque no es texto: lo que cuenta es su id, y solo si tiene la forma esperada.
  const id = String((sel && sel.id) || '');
  texto = /^[a-z0-9:_-]{1,200}$/.test(id) ? id : '';
  textoReporte = 'El cliente seleccionó una opción: ' + String((sel && sel.title) || '').slice(0, 100).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
} else if (tipo === 'button') {
  texto = String((msg.button && (msg.button.text || msg.button.payload)) || '').slice(0, 1500);
  textoReporte = 'El cliente tocó el botón: ' + texto;
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
}
// Un texto vacío (solo espacios) no es una conversación.
if (tipo === 'text' && texto.trim() === '') return [];

const contacto = Array.isArray(carga.contacts) ? carga.contacts[0] : undefined;
const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;
const esAudio = tipo === 'audio' && mediaId !== '';
const esVisual = (tipo === 'image' || tipo === 'document') && mediaId !== '';
const categoria = (tipo === 'text' || tipo === 'interactive' || tipo === 'button') ? 'conversacion' : ((tipo === 'audio' || tipo === 'image' || tipo === 'document') ? 'medio' : 'otro');
// PR-2: ¿esta imagen o documento es el comprobante de un QR abierto? Lo dice el SERVIDOR (`cobro` de `Traer configuración`), nunca el texto ni la imagen. Con cobro REAL: hay un QR pendiente, el cobro está
// en revisión o el plazo venció hace menos de 24 h (el servidor decide qué hacer). Con cobro SIMULADO: cualquier foto con el QR pendiente es el comprobante de la prueba (no se baja ni se coteja).
const rrCobroDelTurno = rrCobro(rrPanelDe(cnPrimero('Traer configuración')), cnPrimero('Config base'));
const rrEsVisual = (tipo === 'image' || tipo === 'document');
const esComprobante = rrEsVisual && mediaId !== '' && rrCobroDelTurno.modo === 'real' && (rrCobroDelTurno.pendiente || rrCobroDelTurno.enRevision || rrCobroDelTurno.vencidoHaceMin !== null);
const comprobanteSimulado = rrEsVisual && rrCobroDelTurno.modo === 'simulado' && rrCobroDelTurno.pendiente;
const mimeType = visual && typeof visual.mime_type === 'string' ? visual.mime_type.slice(0, 100) : '';
// MEDIOS ENTRANTES: un documento solo es comprobante si es un PDF o una imagen (lo demás no lo lee Gemini: un archivo no soportado nunca se baja). ¿Se mira esta foto o se escucha este audio? Lo decide el código ANTES de bajar nada (tipo y formato, sin cobro pendiente ni QR en la guarda para la foto, y el tope diario por teléfono: `rrMediosDelTurno`, rr.js).
const mimeBase = mimeType.split(';')[0].trim().toLowerCase();
const docIlegible = tipo === 'document' && mimeBase !== 'application/pdf' && RR_MIME_VISION.indexOf(mimeBase) < 0;
const rrMedios = rrMediosDelTurno({ tipo: tipo, mediaId: mediaId, mimeType: mimeType, esComprobante: esComprobante, comprobanteSimulado: comprobanteSimulado, extranjero: extranjero, ficha: rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from)), ahoraMs: ahoraTurno, base: cnPrimero('Config base') || {} });

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
  categoria: categoria,
  esComprobante: esComprobante && !extranjero && !docIlegible,
  comprobanteSimulado: comprobanteSimulado && !extranjero,
  mimeType: mimeType,
  extranjero: extranjero,
  verImagen: rrMedios.verImagen,
  imagenTope: rrMedios.imagenTope,
  visionApagada: rrMedios.visionApagada,
  oirAudio: rrMedios.oirAudio,
  audioTope: rrMedios.audioTope,
  audioApagado: rrMedios.audioApagado,
  anuncio: !!ref,
  origen: ref ? 'anuncio' : 'directo',
  esAudio: esAudio,
  esVisual: esVisual,
  esDocumento: tipo === 'document',
  mediaId: mediaId,
  ahoraMs: ahoraTurno,
  mensajeMs: mensajeMs,
  prueba: carga.prueba || null,
} }];
