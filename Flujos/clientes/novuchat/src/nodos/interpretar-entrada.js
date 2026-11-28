// INTERPRETAR ENTRADA: el mensaje entrante, normalizado a UN evento de texto para el modelo.
//
// Cubre text, interactive (list_reply ANTES que button_reply), button, audio/voice, image, document, location, sticker, contacts y cualquier otro tipo. Nunca se lee `.text.body` sin
// pasar por aquí. LA CLAVE DE LA CONVERSACIÓN ES EL NÚMERO DE ORIGEN (`messages[0].from`): dos clientes jamás comparten ficha. Si no son solo dígitos (6 a 20), el mensaje se descarta.
//
// NADA se descarta antes del modelo salvo: no hay mensaje, el número no es válido, el prefijo de país no está permitido (responder a un número extranjero cuesta su tarifa), Meta
// reenvió un mensaje que ya se procesó (los últimos ids de la ficha del servidor y los de la cola), y lo que no es una conversación (reacciones, bienvenida, sistema, efímeros).
// Este nodo SOLO LEE la ficha (la que leyó «Traer configuración» del servidor). Un audio, una imagen o un documento salen SIN `evento`: lo arma «Registrar evento» con lo que lean los nodos de medios.
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
if (mensajeId && cfg.sesion && cfg.sesion.ok === true && chYaVisto(cfg.sesion.estado, mensajeId)) return [];
// Sin estado en el servidor (ruta `sin_estado`) no hay ficha donde mirar los ids: se recuerdan los últimos 5 por teléfono en los datos estáticos (solo para este fallback; a lo más 200 teléfonos), para que
// una entrega repetida de Meta no reciba un segundo genérico.
if (mensajeId && !(cfg.sesion && cfg.sesion.ok === true)) {
  let sd = null;
  try { sd = $getWorkflowStaticData('global'); } catch (e) { sd = null; }
  if (sd) {
    const mapa = sd.chatNovuchatSinEstado && typeof sd.chatNovuchatSinEstado === 'object' && !Array.isArray(sd.chatNovuchatSinEstado) ? sd.chatNovuchatSinEstado : (sd.chatNovuchatSinEstado = {});
    const previos = Object.prototype.hasOwnProperty.call(mapa, from) && Array.isArray(mapa[from]) ? mapa[from] : [];
    if (previos.includes(mensajeId)) return [];
    mapa[from] = previos.concat([mensajeId]).slice(-CH_TOPE_IDS);
    const claves = Object.keys(mapa);
    for (const k of claves.slice(0, Math.max(0, claves.length - 200))) delete mapa[k];
  }
}

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
// La respuesta a la campaña saliente (E1 híbrido: el servidor dijo en «Traer configuración» si el entrante CITA la última campaña, `cfg.campanaSaliente.citada`, y si es la primera respuesta de la ventana de 24 h, `primeraEnVentana`).
// El candidato es `{ respuesta, id, por, contextoId, probable }`; `probable` = no lo identificó un payload nuestro: lo confirma el servidor (la ingesta, «Reportar mensaje (entrante)») y la puerta del turno lo obedece.
//   - payload `cs:no:<id>` (de un botón): SIEMPRE cuenta, aunque su `context.id` no sea el de la última campaña (E3: solo lo generan nuestras plantillas; un «No» nunca se pierde).
//   - payload `cs:si:<id>`: solo si el entrante CITA la campaña (I-B3).
//   - la etiqueta exacta del botón (dato del tenant, `datos.campanaSaliente`; NFC en los dos lados; Meta a veces devuelve la etiqueta como payload): solo si CITA la campaña (I-B3).
//   - un «no» o «no gracias» ESCRITO (`cnNoEscritoDeCampana`, E8: acepta «.» y «!» finales): solo si CITA la campaña o es la primera respuesta de la ventana (D1); la ingesta confirma.
// El id del payload es en MINÚSCULAS (igual que `CAMPANA_ID` del servidor): la campaña saliente (PR-C) tiene que generarlos así (`docs/arquitectura/modulos/campanas.md`). Cualquier otro botón no es campaña.
let campanaSaliente = null;
const csrv = cfg.campanaSaliente && typeof cfg.campanaSaliente === 'object' ? cfg.campanaSaliente : {};
const citada = csrv.citada === true;
const contextoId = msg.context && typeof msg.context.id === 'string' ? msg.context.id.slice(0, 200) : '';
if (tipo === 'button' && msg.button && typeof msg.button === 'object') {
  const pl = /^cs:(si|no):([a-z0-9-]{3,40})$/.exec(typeof msg.button.payload === 'string' ? msg.button.payload : '');
  const bs = cfg.datos && cfg.datos.campanaSaliente && typeof cfg.datos.campanaSaliente === 'object' ? cfg.datos.campanaSaliente : {};
  const etiqueta = typeof msg.button.text === 'string' ? msg.button.text : '';
  if (pl) {
    if (pl[1] === 'no' || citada) campanaSaliente = { respuesta: pl[1], id: pl[2], por: 'payload', contextoId: contextoId, probable: false };
  } else if (etiqueta !== '' && citada) {
    const igual = (r) => typeof r === 'string' && r !== '' && etiqueta.normalize('NFC') === r.normalize('NFC');
    if (igual(bs.botonSi)) campanaSaliente = { respuesta: 'si', id: '', por: 'etiqueta', contextoId: contextoId, probable: true };
    else if (igual(bs.botonNo)) campanaSaliente = { respuesta: 'no', id: '', por: 'etiqueta', contextoId: contextoId, probable: true };
  }
} else if (tipo === 'text' && cnNoEscritoDeCampana(msg.text && msg.text.body) && (citada || csrv.primeraEnVentana === true)) {
  campanaSaliente = { respuesta: 'no', id: '', por: 'texto', contextoId: contextoId, probable: true };
}
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
  if (campanaSaliente) { textoReporte = 'El cliente respondió a un mensaje de seguimiento: ' + (campanaSaliente.respuesta === 'si' ? 'sí' : 'no'); // El «sí» pasa con recepción por la ruta de siempre (`boton: 'equipo'`); el «no» no llega a la cola: lo cierra la puerta del turno.
    evento = campanaSaliente.respuesta === 'si' ? { k: 'toque', t: '[Respondió que sí a un mensaje de seguimiento]', c: '', rubro: '', boton: 'equipo', campanaSaliente: true } : chEventoOtro('button'); }
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
  anuncio: anuncio,
  campana: campana,
  adId: idDelAnuncio,
  campanaId: campana ? campana.id : '',
  campanaPor: campana ? campana.por : '',
  campanaSaliente: campanaSaliente,
  origen: ref ? 'anuncio' : 'directo',
  esAudio: esAudio,
  esVisual: esVisual,
  esDocumento: tipo === 'document',
  mediaId: mediaId,
  ahoraMs: Number(carga.ahoraMs) || Date.now(),
  prueba: carga.prueba || null,
} }];
