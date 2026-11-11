// SALIDA DE PERSONA, paso 3: de la lista reclamada a un envio por mensaje.
//
// Entra la respuesta de `reclamarSalidaPersona`: { mensajes: [...] } con hasta 10
// mensajes ya pasados a `enviando`. Sale UN item por mensaje con lo que los nodos
// de envio necesitan. Lista vacia = fin del bucle (no sale ningun item).
//
// Un mensaje que NO se puede enviar por un defecto propio (canal que no es
// 'rele' ni 'graph', texto vacio, direccion invalida, rele sin configurar) lleva
// `sinEnvio` con un codigo: el Switch lo manda directo a `Resultado del envío`,
// que lo confirma como rechazado. Nunca se queda en `enviando` ni se envia a ciegas.
const cfg = $('Config base').first().json;
const entrada = $input.all()[0];
const lista = entrada && entrada.json && Array.isArray(entrada.json.mensajes) ? entrada.json.mensajes : [];
const releBase = String(cfg.releBaseUrl ?? '').trim();
const releListo = /^http:\/\/[A-Za-z0-9._-]+(:[0-9]{2,5})?$/.test(releBase);

// ADJUNTOS (B3): un mensaje con `tipo` image|audio|document se planifica aparte. Se valida la
// FORMA del reclamo (el servidor ya la valida; esto es el cinturon) y sale con `ruta: 'adjunto'`
// y `cuerpoAdjunto` SIN el id de Meta: el id lo pone `Preparar envío del adjunto` tras la subida.
// NUNCA hay `link`: el medio se sube a Meta con `/media` y se envia por `id`.
const MIMES = {
  image: { 'image/jpeg': 'jpg', 'image/png': 'png' },
  audio: { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac' },
  document: {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
  },
};
const TOPES = { image: 5 * 1024 * 1024, audio: 16 * 1024 * 1024, document: 16 * 1024 * 1024 };
// Controles, marcas bidireccionales, separadores de linea y barras en el nombre del archivo.
const NOMBRE_MALO = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff/\\]/;
let adjuntosEnLote = 0;

function planAdjunto(p, tipo, mensajeId, conversacionId, to, canal, claveRele, texto) {
  const a = p.adjunto;
  let sinEnvio = '';
  let reintentable = false;
  if (!mensajeId || !conversacionId) sinEnvio = 'NV-RECLAMO';
  else if (!MIMES[tipo]) sinEnvio = 'NV-TIPO';
  else if (canal !== 'graph') sinEnvio = 'NV-ADJUNTO-CANAL';
  else if (!/^[0-9]{8,15}$/.test(to)) sinEnvio = 'NV-DESTINO';
  else {
    let forma = false;
    if (a === null || typeof a !== 'object' || Array.isArray(a)) forma = true;
    else if (typeof a.mime !== 'string' || !Object.prototype.hasOwnProperty.call(MIMES[tipo], a.mime)) forma = true;
    else if (texto !== '') forma = true;
    else if (!Number.isInteger(a.tamano) || a.tamano < 1 || a.tamano > TOPES[tipo]) forma = true;
    else if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) forma = true;
    else if (typeof a.voz !== 'boolean' || (a.voz === true && a.mime !== 'audio/ogg')) forma = true;
    else if (a.leyenda !== undefined && (typeof a.leyenda !== 'string' || tipo === 'audio' || a.leyenda.trim() === '' || a.leyenda.length > 1000)) forma = true;
    else if (a.nombre !== undefined && (typeof a.nombre !== 'string' || tipo !== 'document' || a.nombre.length < 1 || a.nombre.length > 240 || NOMBRE_MALO.test(a.nombre))) forma = true;
    if (forma) sinEnvio = 'NV-ADJUNTO-FORMA';
    else if (adjuntosEnLote >= 1) { sinEnvio = 'NV-ADJUNTO-LOTE'; reintentable = true; }
    else adjuntosEnLote += 1;
  }
  const base = { mensajeId, conversacionId, canal, claveRele, sinEnvio, reintentable, ruta: sinEnvio ? 'ninguna' : 'adjunto', tipo };
  if (sinEnvio) return { json: { ...base, adjunto: null, cuerpoAdjunto: null } };
  const medio = {};
  if (a.leyenda !== undefined) medio.caption = a.leyenda;
  if (tipo === 'document' && a.nombre !== undefined) medio.filename = a.nombre;
  if (tipo === 'audio' && a.voz === true) medio.voice = true;
  return { json: {
    ...base,
    adjunto: { mime: a.mime, ext: MIMES[tipo][a.mime], tamano: a.tamano, sha256: a.sha256 },
    cuerpoAdjunto: { messaging_product: 'whatsapp', to, type: tipo, [tipo]: medio },
  }};
}

const salida = [];
for (const m of lista) {
  const p = (m && typeof m === 'object') ? m : {};
  const mensajeId = String(p.mensajeId ?? '');
  const conversacionId = String(p.conversacionId ?? '');
  const texto = typeof p.texto === 'string' ? p.texto : '';
  const to = String(p.to ?? '');
  const canal = String(p.canal ?? '');
  const claveRele = String(p.claveRele ?? '');
  const tipo = p.tipo === undefined ? 'text' : String(p.tipo);
  if (tipo !== 'text') { salida.push(planAdjunto(p, tipo, mensajeId, conversacionId, to, canal, claveRele, texto)); continue; }

  let sinEnvio = '';
  let reintentable = false;
  if (!mensajeId || !conversacionId) sinEnvio = 'NV-RECLAMO';
  else if (canal !== 'rele' && canal !== 'graph') sinEnvio = 'NV-CANAL';
  else if (!/^[0-9]{8,15}$/.test(to)) sinEnvio = 'NV-DESTINO';
  else if (texto.trim() === '' || texto.length > 1000) sinEnvio = 'NV-TEXTO';
  else if (canal === 'rele' && !/^[A-Za-z0-9_.:-]{16,128}$/.test(claveRele)) sinEnvio = 'NV-CLAVE';
  else if (canal === 'rele' && !releListo) { sinEnvio = 'NV-RELE-CONFIG'; reintentable = true; }

  salida.push({ json: {
    mensajeId, conversacionId, canal, claveRele,
    sinEnvio, reintentable,
    // Por donde sigue el Switch: un mensaje con defecto propio NUNCA entra a un nodo de envio.
    ruta: sinEnvio ? 'ninguna' : canal,
    // Mismo cuerpo para el rele y para Graph: el rele reenvia a Graph tal cual.
    cuerpoEnvio: { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } },
  }});
}
return salida;
