// =============================================================================
// LISTA DE CATALOGO (prefijo `lc`): categorias, filas de lista interactiva y listas en texto, PURAS
// =============================================================================
// Se pega DELANTE del código de un nodo Code (el armador la incluye por texto): el nodo Code de n8n no tiene
// módulos. Es AUTOSUFICIENTE: no usa ninguna función de otro paquete, no lee la configuración, no llama a la red
// y no conoce a ningún cliente. Sin `require`, `URL`, `Buffer` ni `crypto`. Funciones globales sin `export`.
//
// Entrada: `vendibles` = [{ id, nombre, area, precio, precioCentavos, moneda, disponible? }]. Solo se muestra lo
// que tiene `precioCentavos` entero > 0 y no tiene `disponible === false`. El precio SIEMPRE sale de
// `precioCentavos`, formateado por `monto(centavos)` (lo pasa el llamador: «Bs 7.655»); nunca se inventa un
// precio ni un producto. Un producto cuyo id no puede viajar como id de fila (fuera de `^[a-z0-9:_-]{1,200}$`
// una vez en minúsculas, con el prefijo `pro:`) no se muestra: no se podría elegir. Con un id repetido (en
// minúsculas) vale el primero.
//
// Ids de fila (Meta: 200 caracteres como máximo):
//   cat:<slug>          una categoría
//   pro:<id>            un producto (el id del catálogo, en minúsculas; el real se recupera con lcResolverId)
//   mas:cats:<pag>      «Ver más» de la lista de categorías, hacia la página <pag> (la primera es la 0)
//   mas:<slug>:<pag>    «Ver más» de los productos de una categoría
// Paginado: si caben todas (hasta 10) no hay «Ver más»; si no, páginas de 9 ítems + la fila «Ver más».

var LC_FILAS_MAX = 10;
var LC_POR_PAGINA = 9;
var LC_PATRON_ID = /^[a-z0-9:_-]{1,200}$/;

function lcSlug(texto) {
  var s = String(texto === undefined || texto === null ? '' : texto).normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 40).replace(/-+$/, '');
}
// El slug de una categoría nunca es vacío ni «cats» (esa palabra es de la lista de categorías en `mas:`).
function lcSlugCategoria(nombre) {
  var s = lcSlug(nombre);
  if (!s) return 'otros';
  return s === 'cats' ? 'cats-1' : s;
}
function lcLinea(t) {
  return String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim();
}
// Corta por palabra entera. Devuelve { cabeza, resto }: `cabeza` (con «…» si se cortó) mide `max` como máximo.
function lcCortar(texto, max) {
  var s = lcLinea(texto);
  if (s.length <= max) return { cabeza: s, resto: '' };
  var c = s.slice(0, max - 1);
  if (s.charAt(max - 1) !== ' ') {
    var i = c.lastIndexOf(' ');
    if (i > 0) c = c.slice(0, i);
  }
  if (/[\uD800-\uDBFF]$/.test(c)) c = c.slice(0, -1);
  c = c.replace(/[\s,;:·–—-]+$/, '');
  return { cabeza: c + '…', resto: s.slice(c.length).trim() };
}
function lcMonto(monto, centavos) {
  return String(monto(centavos));
}
// Los vendibles que se pueden mostrar y elegir, en su orden, con el id real y el id de fila.
function lcValidos(vendibles) {
  var out = [];
  var vistos = {};
  var lista = Array.isArray(vendibles) ? vendibles : [];
  for (var i = 0; i < lista.length; i++) {
    var v = lista[i];
    if (!v || typeof v !== 'object') continue;
    if (!Number.isInteger(v.precioCentavos) || v.precioCentavos <= 0) continue;
    if (v.disponible === false) continue;
    if (typeof v.id !== 'string' && typeof v.id !== 'number') continue;
    var nombre = lcLinea(v.nombre);
    if (!nombre) continue;
    var minus = String(v.id).toLowerCase();
    if (!LC_PATRON_ID.test('pro:' + minus)) continue;
    if (Object.prototype.hasOwnProperty.call(vistos, minus)) continue;
    vistos[minus] = true;
    var area = lcLinea(v.area);
    var cat = area ? lcLinea(area.split(' · ')[0]) : '';
    if (!cat) cat = 'Otros';
    out.push({ id: String(v.id), minus: minus, nombre: nombre, centavos: v.precioCentavos, cat: cat, slug: lcSlugCategoria(cat) });
  }
  return out;
}
function lcCategoriasDe(validos) {
  var cats = [];
  var por = {};
  for (var i = 0; i < validos.length; i++) {
    var v = validos[i];
    if (!Object.prototype.hasOwnProperty.call(por, v.slug)) {
      por[v.slug] = { id: 'cat:' + v.slug, nombre: v.cat, n: 0 };
      cats.push(por[v.slug]);
    }
    por[v.slug].n++;
  }
  return cats;
}
function lcCategorias(vendibles) {
  return lcCategoriasDe(lcValidos(vendibles));
}
// Cuántas páginas tiene una lista de `n` filas.
function lcPaginas(n) {
  return n <= LC_FILAS_MAX ? 1 : Math.ceil(n / LC_POR_PAGINA);
}
// Una página de `filas`: { filas, hayMas, pag } con la fila «Ver más» (id `mas:<clave>:<pag+1>`) al final.
function lcPagina(filas, pag, clave) {
  var n = filas.length;
  var paginas = lcPaginas(n);
  var p = Number.isInteger(pag) && pag > 0 ? Math.min(pag, paginas - 1) : 0;
  if (n <= LC_FILAS_MAX) return { filas: filas.slice(), hayMas: false, pag: 0 };
  var desde = p * LC_POR_PAGINA;
  var hasta = Math.min(desde + LC_POR_PAGINA, n);
  var res = filas.slice(desde, hasta);
  var hayMas = hasta < n;
  if (hayMas) res.push({ id: 'mas:' + clave + ':' + (p + 1), title: 'Ver más', description: 'Siguientes opciones' });
  return { filas: res, hayMas: hayMas, pag: p };
}
function lcFilasCategorias(cats, pag) {
  var filas = (Array.isArray(cats) ? cats : []).map(function (c) {
    return {
      id: c.id,
      title: lcCortar(c.nombre, 24).cabeza,
      description: c.n === 1 ? '1 producto' : c.n + ' productos',
    };
  });
  return lcPagina(filas, pag, 'cats');
}
function lcSlugDe(catId) {
  var s = String(catId === undefined || catId === null ? '' : catId);
  return s.indexOf('cat:') === 0 ? s.slice(4) : s;
}
function lcFilasProductos(vendibles, catId, pag, monto) {
  var slug = lcSlugDe(catId);
  var validos = lcValidos(vendibles).filter(function (v) { return v.slug === slug; });
  if (!validos.length) return { filas: [], hayMas: false, total: 0, pag: 0 };
  var filas = validos.map(function (v) {
    var corte = lcCortar(v.nombre, 24);
    var desc = lcMonto(monto, v.centavos);
    if (corte.resto) {
      var cabe = 72 - desc.length - 3;
      if (cabe >= 8) desc += ' · ' + lcCortar(corte.resto, cabe).cabeza;
    }
    return { id: 'pro:' + v.minus, title: corte.cabeza, description: desc.slice(0, 72) };
  });
  var p = lcPagina(filas, pag, slug);
  return { filas: p.filas, hayMas: p.hayMas, total: validos.length, pag: p.pag };
}
function lcPaginaValida(texto, paginas) {
  if (!/^[0-9]{1,4}$/.test(texto) || String(Number(texto)) !== texto) return -1;
  var n = Number(texto);
  return n >= 1 && n < paginas ? n : -1;
}
function lcResolverId(id, vendibles) {
  var obsoleto = { tipo: 'obsoleto' };
  if (typeof id !== 'string' || !LC_PATRON_ID.test(id)) return obsoleto;
  var validos = lcValidos(vendibles);
  if (id.indexOf('pro:') === 0) {
    var minus = id.slice(4);
    for (var i = 0; i < validos.length; i++) {
      if (validos[i].minus === minus) return { tipo: 'pro', id: validos[i].id };
    }
    return obsoleto;
  }
  var cats = lcCategoriasDe(validos);
  if (id.indexOf('cat:') === 0) {
    var slug = id.slice(4);
    for (var j = 0; j < cats.length; j++) {
      if (cats[j].id === id) return { tipo: 'cat', cat: slug, nombre: cats[j].nombre };
    }
    return obsoleto;
  }
  if (id.indexOf('mas:') === 0) {
    var partes = id.split(':');
    if (partes.length !== 3) return obsoleto;
    var n = -1;
    if (partes[1] === 'cats') {
      n = cats.length;
    } else {
      for (var k = 0; k < cats.length; k++) {
        if (cats[k].id === 'cat:' + partes[1]) n = cats[k].n;
      }
    }
    if (n < 0) return obsoleto;
    var pag = lcPaginaValida(partes[2], lcPaginas(n));
    return pag < 0 ? obsoleto : { tipo: 'mas', cat: partes[1], pag: pag };
  }
  return obsoleto;
}
function lcLineaProducto(v, monto) {
  return '• ' + v.nombre + ' — ' + lcMonto(monto, v.centavos);
}
// Una línea por producto, sin pasar de `opciones.limite` (3500 por omisión) y nunca cortando una línea.
function lcTextoLista(items, monto, opciones) {
  var limite = opciones && Number.isInteger(opciones.limite) && opciones.limite > 0 ? opciones.limite : 3500;
  var validos = lcValidos(items);
  var lineas = [];
  var largo = 0;
  for (var i = 0; i < validos.length; i++) {
    var l = lcLineaProducto(validos[i], monto);
    var nuevo = largo + (lineas.length ? 1 : 0) + l.length;
    if (nuevo > limite) break;
    lineas.push(l);
    largo = nuevo;
  }
  return { texto: lineas.join('\n'), mostrados: lineas.length, total: validos.length, completo: lineas.length === validos.length };
}
function lcEncabezado(nombre, mostrados, total) {
  return '*' + nombre + '* (' + (mostrados === total ? total : mostrados + ' de ' + total) + ')';
}
// Un bloque por categoría en un solo texto. Devuelve { texto, categorias:[{cat,nombre,mostrados,total}],
// mostrados, total, completo }. Se llena en el orden de `catIds`; cuando una categoría no cabe entera, se corta
// por producto entero y las siguientes no se muestran (mostrados 0). Un id que no es una categoría de hoy se ignora.
function lcBloquesPorCategoria(vendibles, catIds, monto, limite) {
  var tope = Number.isInteger(limite) && limite > 0 ? limite : 3500;
  var validos = lcValidos(vendibles);
  var cats = lcCategoriasDe(validos);
  var pedidas = [];
  var ids = Array.isArray(catIds) ? catIds : [];
  for (var a = 0; a < ids.length; a++) {
    var slug = lcSlugDe(ids[a]);
    for (var b = 0; b < cats.length; b++) {
      if (cats[b].id === 'cat:' + slug && pedidas.indexOf(cats[b]) < 0) pedidas.push(cats[b]);
    }
  }
  var bloques = [];
  var detalle = [];
  var texto = '';
  var cortado = false;
  var mostradosTotal = 0;
  var total = 0;
  for (var c = 0; c < pedidas.length; c++) {
    var cat = pedidas[c];
    var lineas = validos.filter(function (v) { return v.slug === cat.id.slice(4); })
      .map(function (v) { return lcLineaProducto(v, monto); });
    total += lineas.length;
    var k = 0;
    if (!cortado) {
      while (k < lineas.length) {
        var cand = lcEncabezado(cat.nombre, k + 1, lineas.length) + '\n' + lineas.slice(0, k + 1).join('\n');
        if ((texto ? texto.length + 2 : 0) + cand.length > tope) break;
        k++;
      }
      if (k > 0) {
        var bloque = lcEncabezado(cat.nombre, k, lineas.length) + '\n' + lineas.slice(0, k).join('\n');
        texto = texto ? texto + '\n\n' + bloque : bloque;
        bloques.push(bloque);
      }
      if (k < lineas.length) cortado = true;
    }
    mostradosTotal += k;
    detalle.push({ cat: cat.id.slice(4), nombre: cat.nombre, mostrados: k, total: lineas.length });
  }
  return { texto: texto, categorias: detalle, mostrados: mostradosTotal, total: total, completo: mostradosTotal === total };
}
