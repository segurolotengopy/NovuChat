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
// Lo que NO es pedir el listado aunque nombre una palabra del objeto: negación, pago o comprobante («antes de pagar» no es pagar), «ya vi», y las frases de
// cierre o cortesía con «todo», «todos» o «lista» («eso es todo», «todo bien», «gracias a todos», «estoy lista», «lista para pagar»).
var IC_NO_ES_PEDIDO = /\b(no|ya vi|ya vio|ya tengo|ya conozco|comprobante|pago|pagar|pague|qr|transferencia|deposito|captura|recibo|factura|nit|eso es todo|es todo|esto es todo|solo eso|nada mas|todo (bien|ok|okay|listo|claro|perfecto|correcto|en orden|gracias)|(a|de) todos|(estoy|esta|estas|estamos|ya estoy|ya esta|ya estamos|quedo|queda) list[oa]s?|list[oa]s? (para|cuando|si)|gracias)\b/;
// Un verbo de pedir, preguntar o mandar (con sus formas de usted y de ustedes: «mándenme», «pásenme», «díganme»).
var IC_VERBO = /\b(quier\w*|quis\w*|necesit\w*|dam\w*|dem\w*|dig\w*|mand\w*|envi\w*|muestr\w*|pas\w*|ver|veo|vea|ve|tienen|tiene|hay|venden|ofrecen|manejan|a ver|podria\w* ver|puedo ver)\b/;
// Un PEDIDO de una pieza («quiero la heladera más barata»): el pedido nunca se pierde por contestar un listado.
var IC_PEDIDO = /\b(quier\w*|necesit\w*|dam\w*|me llevo|llevo|compro|comprar|anota\w*|agrega\w*|apart\w*)\s+(la|el|los|las|un|una|unos|unas)\s+(?!lista|listado|catalogo|carta|productos?|todo|todos)\w+/;
// El objeto FUERTE: nombra sin ambigüedad lo que se vende. El DÉBIL («lista», «todo») solo vale solo o con un verbo de pedir.
var IC_OBJETO_FUERTE = /\b(catalogos?|listados?|productos?|cartas?|que (cosas |mas |otras cosas )?(tienen|venden|ofrecen|manejan|hay)|q (cosas |mas )?(tienen|venden|ofrecen|manejan|hay)|k (tienen|venden))\b/;
var IC_OBJETO_DEBIL = /\b(listas?|todo|todos)\b/;
// ¿El cliente pide VER lo que se vende (listado, catálogo, carta, productos)? ESTRECHO a propósito: sin cifras (cantidades,
// montos, números de pieza), sin negación, pago, comprobante ni «ya vi», sin frases de cierre («eso es todo», «estoy lista») y sin un pedido
// de una pieza en el mismo mensaje: ahí el mensaje sigue su camino. El llamador decide la precedencia frente al enlace del catálogo web y
// frente a una CATEGORÍA nombrada (`icIntencion`).
function icPideListado(texto) {
  var t = icNormalizar(texto);
  if (!t || t.length > 120) return false;
  if (/\d/.test(t)) return false;
  // «antes de pagar/comprar» no es un pago.
  t = t.replace(/\bantes de (pagar|comprar|confirmar|pedir)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (IC_NO_ES_PEDIDO.test(t)) return false;
  if (IC_PEDIDO.test(t)) return false;
  var palabras = t.split(' ');
  var fuerte = IC_OBJETO_FUERTE.test(t);
  var debil = IC_OBJETO_DEBIL.test(t);
  if (!fuerte && !debil) return false;
  // Solo la palabra («todo», «lista», «catalogo», «carta», «productos»), con cortesía.
  if (/^(por favor |porfa |hola )?(la |el |los |las )?(lista|listas|todo|todos|catalogo|carta|productos|listado)( por favor| porfa)?$/.test(t)) return true;
  if (fuerte && palabras.length <= 4) return true;
  // Con un verbo de pedir cerca del objeto, o una pregunta de «qué tienen».
  var objeto = fuerte ? IC_OBJETO_FUERTE.source : '(?:la |una |su |tu |el )(?:lista|listas|todo|todos)\\b|\\bprecios? de (?:todo|todos)\\b|\\bde todo\\b';
  if (new RegExp(IC_VERBO.source + '[^.?!]{0,40}(?:' + objeto + ')').test(t)) return true;
  if (!fuerte && /\bprecios? de (todo|todos)\b/.test(t)) return true;
  return /\b(que|q) (cosas |mas |otras cosas )?(tienen|venden|ofrecen|manejan|hay)\b/.test(t);
}

// ---------------------------------------------------------------------------------------------------------------------------
// CATEGORÍA NOMBRADA («¿qué televisores tienen?», «tele», «heladera», «bicis y teles»): se reconoce contra las categorías REALES
// del catálogo vivo (`lcCategorias`), nunca contra una lista escrita a mano. Plural en «s» y en «es», sin tildes, abreviaturas y
// sinónimos usuales («tele», «refri», «bici»). Una categoría nombrada GANA frente al listado genérico.
// ---------------------------------------------------------------------------------------------------------------------------
var IC_SINONIMOS = {
  tele: ['televisor', 'tv'], teles: ['televisor', 'tv'], tv: ['televisor', 'tv'], tvs: ['televisor', 'tv'],
  refri: ['heladera', 'refrigerador'], refris: ['heladera', 'refrigerador'], refrigerador: ['heladera'], refrigeradores: ['heladera'], nevera: ['heladera'], frigobar: ['heladera'],
  bici: ['bicicleta'], bicis: ['bicicleta'], ac: ['aire'], lavarropas: ['lavadora'], celu: ['celular'], celus: ['celular'], compu: ['computadora'], compus: ['computadora'],
};
var IC_RELLENO = /^(que|q|k|cual|cuales|cuanto|cuantos|como|tienen|tienes|tiene|venden|vendes|hay|manejan|ofrecen|quiero|quisiera|necesito|dame|damelo|dime|mandame|mandenme|manden|mande|enviame|envien|muestrame|muestren|pasame|pasen|ver|veo|a|ver|mira|mas|menos|otro|otros|otra|otras|demas|todo|todos|toda|todas|completo|completa|con|sin|de|del|la|el|los|las|un|una|unos|unas|por|favor|porfa|para|y|o|e|en|que|precio|precios|catalogo|lista|listado|producto|productos|barato|baratos|barata|baratas|economico|economicos|hola|buenas|buenos|dias|tardes|noches|me|mi|su|tu|se|lo|si|no|es|son|cosas|cosa|algo|tambien|ademas)$/;
function icRaices(w) {
  var r = [w];
  if (w.length > 3 && /s$/.test(w)) r.push(w.slice(0, -1));
  if (w.length > 4 && /es$/.test(w)) r.push(w.slice(0, -2));
  return r;
}
function icPalabras(texto) {
  return icNormalizar(texto).split(' ').filter(function (w) { return w; });
}
// ¿`a` y `b` difieren en UNA letra (cambiada, de más o de menos)? Un error de ortografía («telebisores»).
function icUnaLetra(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  var i = 0;
  while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
// ¿La palabra `w` del cliente nombra la palabra `c` de una categoría? Misma raíz (plural en «s» o «es»), un sinónimo usual o una abreviatura de 4 letras o más.
function icNombra(w, c) {
  var rw = icRaices(w).concat((IC_SINONIMOS[w] || []).reduce(function (a, x) { return a.concat(icRaices(x)); }, []));
  var rc = icRaices(c);
  for (var i = 0; i < rw.length; i++) {
    for (var j = 0; j < rc.length; j++) {
      if (rw[i] === rc[j]) return true;
      if (rw[i].length >= 6 && rc[j].length >= 6 && icUnaLetra(rw[i], rc[j])) return true;
      if (rw[i].length >= 4 && rc[j].length > rw[i].length && rc[j].indexOf(rw[i]) === 0 && !IC_RELLENO.test(rw[i])) return true;
    }
  }
  return false;
}
// Las categorías (de `lcCategorias`) que nombra un trozo de texto, en el orden del catálogo.
function icCategoriasNombradas(palabras, cats) {
  var salida = [];
  for (var i = 0; i < cats.length; i++) {
    var cp = icPalabras(cats[i].nombre).filter(function (c) { return c.length >= 2 && !IC_RELLENO.test(c); });
    var ok = false;
    for (var k = 0; k < palabras.length && !ok; k++) {
      if (IC_RELLENO.test(palabras[k]) || palabras[k].length < 2) continue;
      for (var j = 0; j < cp.length && !ok; j++) ok = icNombra(palabras[k], cp[j]);
    }
    if (ok) salida.push(cats[i]);
  }
  return salida;
}
// La intención del mensaje frente al catálogo vivo `vendibles`. Devuelve
//   { tipo: 'categoria' | 'listado' | 'sin_categoria' | 'ninguna', catIds: ['cat:…'], faltan: ['bicis'], pedido: bool }
//   categoria      nombra una o más categorías REALES (todas, en el orden del catálogo): se responden TODAS (estándar 2.4);
//   listado        pide el catálogo en general (`icPideListado`): lista de categorías;
//   sin_categoria  pregunta si hay algo («¿tienen bicicletas?») y NO es una categoría real: el código dice «no tenemos X» y ofrece las que sí hay;
//   faltan         lo nombrado que no existe, cuando va junto con una categoría real («bicis y teles»);
//   pedido         el mensaje además pide una pieza («quiero la heladera más barata y …»): el pedido SIGUE su camino, nunca se pierde.
// Sin cifras, negación, pago ni frases de cierre: 'ninguna'.
function icIntencion(texto, vendibles) {
  var vacio = { tipo: 'ninguna', catIds: [], faltan: [], pedido: false };
  var t = icNormalizar(texto);
  if (!t || t.length > 160 || /\d/.test(t)) return vacio;
  t = t.replace(/\bantes de (pagar|comprar|confirmar|pedir)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (IC_NO_ES_PEDIDO.test(t)) return vacio;
  var pedido = IC_PEDIDO.test(t);
  var cats = lcCategorias(vendibles);
  var segmentos = t.split(/\s+y\s+|\s+o\s+|\s+e\s+|,/).map(icPalabras).filter(function (p) { return p.length; });
  var ids = [];
  var faltan = [];
  var nombradas = icCategoriasNombradas(icPalabras(t), cats);
  for (var i = 0; i < nombradas.length; i++) ids.push(nombradas[i].id);
  var preguntaPorHay = /\b(tienen|tienes|tiene|venden|vendes|hay|manejan|ofrecen|consigo|conseguir)\b/.test(t);
  for (var s = 0; s < segmentos.length; s++) {
    var contenido = segmentos[s].filter(function (w) { return !IC_RELLENO.test(w) && w.length >= 3; });
    if (!contenido.length) continue;
    if (!icCategoriasNombradas(contenido, cats).length) {
      // Un trozo con contenido que no nombra nada real: solo es «lo que no tenemos» si el cliente pregunta si hay.
      // Con una categoría real en el mismo mensaje («bicis y teles») solo cuenta un trozo corto, de una o dos palabras.
      if ((preguntaPorHay || (ids.length && segmentos[s].length <= 2)) && contenido.length <= 2 && !IC_OBJETO_FUERTE.test(segmentos[s].join(' '))) faltan.push(contenido.join(' '));
    }
  }
  if (ids.length) return { tipo: 'categoria', catIds: ids, faltan: faltan, pedido: pedido };
  if (icPideListado(texto)) return { tipo: 'listado', catIds: [], faltan: [], pedido: false };
  if (faltan.length && !pedido) return { tipo: 'sin_categoria', catIds: [], faltan: faltan, pedido: false };
  return vacio;
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
