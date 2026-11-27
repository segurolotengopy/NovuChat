// =============================================================================
// INTENCION DE CATALOGO (prefijo `ic`): ¿el cliente pide ver lo que se vende? y el mensaje de lista, PURAS
// =============================================================================
// Se pega DETRAS de `Flujos/src/core/sin-agente/mensajes.js` (cmLista) y de `lista-de-catalogo.js` (lc*), y, si el
// nodo la lleva, de `Flujos/src/core/texto/parrafos.js` (ctParrafos: se usa solo si existe). Sin `require`, `URL`,
// `Buffer` ni `crypto`; no lee la configuración, no llama a la red y no conoce a ningún cliente. Funciones globales
// sin `export`.
//
// El precio y los productos salen SOLO de `vendibles` (ver lista-de-catalogo.js): nunca se inventa uno. Una lista
// nunca pasa de 10 filas (límite de Meta) y todo id de fila cumple `^[a-z0-9:_-]{1,200}$`.

function icNormalizar(texto) {
  return String(texto === undefined || texto === null ? '' : texto).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// ¿El cliente pide VER lo que se vende (listado, catálogo, productos)? ESTRECHO a propósito: sin cifras (cantidades,
// montos, números de pieza), sin negación, pago, comprobante ni «ya vi»: ahí el mensaje sigue su camino. Un mensaje de
// hasta cuatro palabras que nombra el objeto, o un verbo de pedir/preguntar cerca del objeto. El llamador decide la
// precedencia frente al enlace del catálogo web.
function icPideListado(texto) {
  var t = icNormalizar(texto);
  if (!t || t.length > 120) return false;
  if (/\d/.test(t)) return false;
  if (/\b(no|ya vi|ya vio|ya tengo|ya conozco|comprobante|pago|pagar|pague|qr|transferencia|deposito|captura|recibo|factura|nit)\b/.test(t)) return false;
  var palabras = t.split(' ').length;
  var objeto = /\b(catalogos?|listas?|listados?|productos?|todo|todos|que (tienen|venden|ofrecen|manejan|hay))\b/;
  if (!objeto.test(t)) return false;
  if (palabras <= 4) return true;
  return /\b(quiero|quisiera|necesito|dame|damelo|manda|mandame|envia|enviame|muestra|muestras|muestrame|pasa|pasas|pasame|mandas|envias|tienen|tiene|hay|venden|ofrecen|manejan|ver|veo|a ver|podria ver|puedo ver)\b[^.?!]{0,40}\b(catalogos?|listas?|listados?|productos?|todo|todos|que (tienen|venden|ofrecen|manejan|hay))\b/.test(t)
    || /\bque (tienen|venden|ofrecen|manejan|hay)\b/.test(t);
}
// El texto de respaldo (para quien no ve listas): una viñeta «• Nombre — precio» por producto, con líneas enteras.
function icRespaldo(vendibles, catIds, monto, limite) {
  var cats = Array.isArray(catIds) && catIds.length ? catIds : lcCategorias(vendibles).map(function (c) { return c.id; });
  return lcBloquesPorCategoria(vendibles, cats, monto, limite);
}
function icParrafos(texto) {
  return typeof ctParrafos === 'function' ? ctParrafos(texto) : String(texto);
}
// El mensaje de lista del catálogo. `opciones`: { catId, pag }. Sin `catId` y con varias categorías, la lista es de
// categorías; con una sola categoría, o con `catId`, es de productos. Devuelve null si no hay nada que mostrar (el
// llamador no inventa un producto): { payload, texto, respaldo, tipo:'list', filas, hayMas, pag }.
// `texto` es el cuerpo de la lista; `respaldo` el mismo contenido en texto con viñetas.
function icMensajeLista(vendibles, monto, opciones) {
  var op = opciones || {};
  var cats = lcCategorias(vendibles);
  if (!cats.length) return null;
  var catId = op.catId;
  if (!catId && cats.length === 1) catId = cats[0].id;
  var pag = Number.isInteger(op.pag) ? op.pag : 0;
  var filas;
  var cuerpo;
  var titulo;
  var respaldoCats;
  if (catId) {
    var r = lcResolverId(String(catId).indexOf('cat:') === 0 ? String(catId) : 'cat:' + catId, vendibles);
    if (r.tipo !== 'cat') return null;
    var pr = lcFilasProductos(vendibles, r.cat, pag, monto);
    if (!pr.filas.length) return null;
    filas = pr.filas;
    pag = pr.pag;
    cuerpo = icParrafos('Estos son los productos de ' + r.nombre + '. Elige uno para ver su detalle.');
    titulo = r.nombre;
    respaldoCats = ['cat:' + r.cat];
  } else {
    var pc = lcFilasCategorias(cats, pag);
    filas = pc.filas;
    pag = pc.pag;
    cuerpo = icParrafos('Tenemos productos en ' + cats.length + ' categorías. Elige una para ver qué hay.');
    titulo = 'Categorías';
    respaldoCats = cats.map(function (c) { return c.id; });
  }
  var respaldo = icRespaldo(vendibles, respaldoCats, monto, 3500);
  // Nunca se recorta en silencio (estándar 2.2): si no cupo todo en el texto, se dice cuántos faltan y se ofrece pedirlos por chat.
  var faltan = respaldo.total - respaldo.mostrados;
  var remision = faltan > 0 ? '\n\n' + (faltan === 1 ? 'Hay 1 producto más.' : 'Hay ' + faltan + ' productos más.') + ' Dime cuál buscas y te lo muestro.' : '';
  var hayMas = filas.length > 0 && filas[filas.length - 1].id.indexOf('mas:') === 0;
  return {
    tipo: 'list',
    payload: cmLista(cuerpo, 'Ver opciones', titulo, filas),
    texto: cuerpo,
    respaldo: cuerpo + '\n\n' + respaldo.texto + remision,
    filas: filas,
    hayMas: hayMas,
    pag: pag,
  };
}
