// =============================================================================
// CARRITO COMÚN DE LAS VENTAS DIGITALES (prefijo `vc` / `VC_`): vendibles, líneas y totales
// =============================================================================
// El carrito que arma el modelo y VALIDA el código: el modelo solo propone `id`, `cantidad` y `detalle`; el nombre, el precio, el subtotal y el total salen SIEMPRE del catálogo del negocio, nunca de lo que escriba el modelo.
// Aquí no hay textos, nombres, productos ni montos de ningún negocio: todo entra por parámetro. Cada función es pura: sin reloj, sin red, sin estado.
//
// Va delante del código de un nodo Code de n8n. NO depende de otras librerías (ni de `cobro.js`): se puede pegar sola. JavaScript plano, sin módulos ni globales de Node (el nodo Code de n8n no los tiene); los nombres globales
// llevan el prefijo `vc`/`VC_` para no chocar con los de la librería propia de cada flujo. Contrato de cada función: `venta-digital/LEEME.md`.

const VC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;   // un solo segmento de ruta: sin «/», sin «..», sin espacios

function vcTexto(v) { return v === undefined || v === null ? '' : String(v); }

// La forma en que se compara: NFKC, sin tildes, en minúsculas y solo letras y dígitos separados por un espacio.
function vcNorm(t) {
  return vcTexto(t).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function vcObjeto(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

// Un entero positivo de `opciones` o, si no lo es, el valor por defecto.
function vcTope(v, defecto) { return Number.isInteger(v) && v > 0 ? v : defecto; }

// Texto libre del cliente o del modelo, limpio para guardarlo y para enviarlo: en NFKC (los signos de ancho completo pasan a su forma normal), sin invisibles (\p{Cf} y los rellenos que parecen vacíos: U+115F, U+1160, U+3164, U+FFA0, U+2800),
// sin caracteres de control ni saltos de línea (\p{Cc}, que pasan a espacio), sin enlaces (con esquema, con «www.» o con forma de dominio) y con los espacios colapsados. El recorte `max` cuenta caracteres, no mitades de un emoji.
function vcLimpiar(t, max) {
  let s = vcTexto(t).normalize('NFKC').replace(/[\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu, '').replace(/\p{Cc}/gu, ' ');
  s = s.replace(/(?:https?|ftp):\/\/\S*|www\.\S*/gi, ' ')
    .replace(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b\S*/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return typeof max === 'number' ? Array.from(s).slice(0, max).join('').trim() : s;
}

// -----------------------------------------------------------------------------
// Vendibles: lo único que el carrito puede contener
// -----------------------------------------------------------------------------
// `catalogo` = arreglo de ítems { id, nombre, descripcion, area, precio (en bolivianos), moneda, activo }. Es vendible solo si está activo (`=== true`), tiene un precio finito mayor que cero (que al pasar a centavos sea al menos 1),
// la moneda es 'BOB' o falta, el `id` es un solo segmento de ruta y no se repite en el catálogo, y el nombre no queda vacío al limpiarlo. Lo demás NO es vendible. Devuelve { id, nombre, precioCentavos, area, descripcion } con el precio en centavos enteros, recortado a `max` (200 por defecto).
function vcVendibles(catalogo, opciones) {
  const max = vcTope(vcObjeto(opciones) ? opciones.max : undefined, 200);
  const out = [];
  if (!Array.isArray(catalogo)) return out;
  // Un id repetido es ambiguo: NO se vende ninguna de sus apariciones.
  const veces = new Map();
  for (const it of catalogo) if (vcObjeto(it) && typeof it.id === 'string') veces.set(it.id, (veces.get(it.id) || 0) + 1);
  for (const it of catalogo) {
    if (out.length >= max) break;
    if (!vcObjeto(it) || it.activo !== true) continue;
    if (typeof it.id !== 'string' || !VC_ID.test(it.id) || veces.get(it.id) !== 1) continue;
    if (typeof it.precio !== 'number' || !Number.isFinite(it.precio) || it.precio <= 0) continue;
    if (it.moneda !== undefined && it.moneda !== null && it.moneda !== 'BOB') continue;
    const centavos = Math.round(it.precio * 100);
    if (!Number.isSafeInteger(centavos) || centavos < 1) continue;
    const nombre = typeof it.nombre === 'string' ? vcLimpiar(it.nombre) : '';
    if (nombre === '') continue;
    out.push({
      id: it.id,
      nombre: nombre,
      precioCentavos: centavos,
      area: typeof it.area === 'string' ? vcLimpiar(it.area) : '',
      descripcion: typeof it.descripcion === 'string' ? vcLimpiar(it.descripcion) : '',
    });
  }
  return out;
}

// Un monto en centavos como número para el índice: sin decimales si son 00, con dos si hacen falta. «450» o «12.50».
function vcNumeroCorto(centavos) {
  const e = Math.floor(centavos / 100);
  const d = centavos % 100;
  return d === 0 ? String(e) : e + '.' + (d < 10 ? '0' : '') + d;
}

// El índice compacto para el prompt: una línea por ítem, `id|nombre|precio`. El nombre no lleva «|» ni saltos de línea.
function vcIndice(vendibles) {
  return (Array.isArray(vendibles) ? vendibles : []).filter((v) => vcObjeto(v) && typeof v.id === 'string' && VC_ID.test(v.id) && Number.isSafeInteger(v.precioCentavos) && v.precioCentavos > 0)
    .map((v) => vcTexto(v.id) + '|' + vcLimpiar(vcTexto(v.nombre).replace(/\|/g, ' ')) + '|' + vcNumeroCorto(v.precioCentavos))
    .join('\n');
}

// -----------------------------------------------------------------------------
// Selección: qué descripciones van al prompt
// -----------------------------------------------------------------------------
// ¿La frase normalizada `frase` aparece en `texto` (también normalizado) como palabras completas?
function vcContiene(texto, frase) { return frase !== '' && (' ' + texto + ' ').indexOf(' ' + frase + ' ') >= 0; }

// Los segmentos de un área («Familia · Subfamilia» → ['familia subfamilia', 'familia', 'subfamilia']), normalizados, de al menos 3 caracteres.
function vcSegmentosDeArea(area) {
  const completa = vcNorm(area);
  const partes = vcTexto(area).split(/[·|>\/\\,;]+/).map(vcNorm);
  return [completa].concat(partes).filter((s, i, a) => s.length >= 3 && a.indexOf(s) === i);
}

// Los ids (a lo más `max`, 15 por defecto) cuyas descripciones van al prompt, sin repetir y en este orden: los del carrito de la ficha, los mostrados recién, los de un área nombrada en `texto` y los que coinciden por una palabra
// de material de `opciones.palabras` ({ palabraNormalizada: [fragmentos de nombre o descripción] }, dato del negocio). Determinista; solo devuelve ids que están en `vendibles`.
function vcSeleccion(vendibles, texto, ficha, opciones) {
  const lista = (Array.isArray(vendibles) ? vendibles : []).filter((v) => vcObjeto(v) && typeof v.id === 'string');
  const max = vcTope(vcObjeto(opciones) ? opciones.max : undefined, 15);
  const palabras = vcObjeto(opciones) && vcObjeto(opciones.palabras) ? opciones.palabras : {};
  const f = vcObjeto(ficha) ? ficha : {};
  const validos = new Set(lista.map((v) => v.id));
  const salida = [];
  const agrega = (id) => { if (typeof id === 'string' && validos.has(id) && salida.indexOf(id) < 0 && salida.length < max) salida.push(id); };

  (Array.isArray(f.carrito) ? f.carrito : []).forEach((l) => agrega(vcObjeto(l) ? l.id : undefined));
  (Array.isArray(f.mostrados) ? f.mostrados : []).forEach(agrega);

  const t = vcNorm(texto);
  if (t !== '') {
    for (const v of lista) if (vcSegmentosDeArea(v.area).some((s) => vcContiene(t, s))) agrega(v.id);
    for (const clave of Object.keys(palabras)) {
      if (!vcContiene(t, vcNorm(clave))) continue;
      const fragmentos = (Array.isArray(palabras[clave]) ? palabras[clave] : []).map(vcNorm).filter((x) => x !== '');
      for (const v of lista) {
        const base = vcNorm(vcTexto(v.nombre) + ' ' + vcTexto(v.descripcion));
        if (fragmentos.some((x) => base.indexOf(x) >= 0)) agrega(v.id);
      }
    }
  }
  return salida;
}

// -----------------------------------------------------------------------------
// Líneas: lo que propone el modelo, validado contra el catálogo
// -----------------------------------------------------------------------------
// `crudas` = lo que devuelve el modelo (se procesan a lo más 100 elementos). De cada elemento SOLO se leen `id`, `cantidad` y `detalle`: cualquier `precio`, `total`, `subtotal` o `descuento` se IGNORA. El nombre y el precio salen de `vendibles`.
// `cantidad` es un número entero > 0 o un texto de solo dígitos («3»); «1.5», «abc», «0» y «-1» se descartan.
// Descartes (en `descartadas`, como { id, motivo }; el id se limpia y se recorta a 100): 'desconocido' (id que no es vendible, o elemento sin forma), 'cantidad' (no es un entero mayor que cero), 'exceso' (más de `maxLineas` líneas distintas),
// 'monto' (el subtotal no sería un entero seguro). 'tope' AVISA que una cantidad se recortó a `maxCantidad` (al pedirla o al sumar): la línea se conserva. El mismo id con el MISMO detalle (comparado sin tildes ni mayúsculas) se suma en
// una sola línea; con otro detalle es otra línea. Nunca lanza.
function vcLineas(crudas, vendibles, opciones) {
  const o = vcObjeto(opciones) ? opciones : {};
  const maxLineas = vcTope(o.maxLineas, 30);
  const maxCantidad = vcTope(o.maxCantidad, 50);
  const maxDetalle = vcTope(o.maxDetalle, 120);
  const porId = new Map();
  for (const v of Array.isArray(vendibles) ? vendibles : []) {
    if (vcObjeto(v) && typeof v.id === 'string' && VC_ID.test(v.id) && Number.isSafeInteger(v.precioCentavos) && v.precioCentavos > 0) porId.set(v.id, v);
  }
  const lineas = [];
  const claves = new Map();
  const descartadas = [];
  const descarta = (id, motivo) => descartadas.push({ id: vcLimpiar(id, 100), motivo: motivo });
  for (const c of (Array.isArray(crudas) ? crudas : []).slice(0, 100)) {
    const x = vcObjeto(c) ? c : {};
    const id = typeof x.id === 'string' ? x.id : '';
    const v = porId.get(id);
    if (v === undefined) { descarta(id, 'desconocido'); continue; }
    const pedida = typeof x.cantidad === 'string' && /^\s*[1-9]\d{0,5}\s*$/.test(x.cantidad) ? Number(x.cantidad) : x.cantidad;
    if (typeof pedida !== 'number' || !Number.isInteger(pedida) || pedida <= 0) { descarta(id, 'cantidad'); continue; }
    const cantidad = Math.min(pedida, maxCantidad);
    const detalle = typeof x.detalle === 'string' ? vcLimpiar(x.detalle, maxDetalle) : '';
    const clave = id + '\u0000' + vcNorm(detalle);
    const previa = claves.get(clave);
    if (previa !== undefined) {
      const suma = previa.cantidad + cantidad;
      const total = Math.min(suma, maxCantidad);
      if (!Number.isSafeInteger(total * previa.precioCentavos)) { descarta(id, 'monto'); continue; }
      previa.cantidad = total;
      previa.subtotalCentavos = total * previa.precioCentavos;
      if (pedida > maxCantidad || suma > maxCantidad) descarta(id, 'tope');
      continue;
    }
    if (lineas.length >= maxLineas) { descarta(id, 'exceso'); continue; }
    if (!Number.isSafeInteger(cantidad * v.precioCentavos)) { descarta(id, 'monto'); continue; }
    const linea = { id: id, nombre: v.nombre, cantidad: cantidad, precioCentavos: v.precioCentavos, subtotalCentavos: cantidad * v.precioCentavos, detalle: detalle };
    lineas.push(linea);
    claves.set(clave, linea);
    if (pedida > maxCantidad) descarta(id, 'tope');
  }
  return { lineas: lineas, descartadas: descartadas };
}

// El total del carrito: la suma de los subtotales, en centavos enteros. Nunca suma envío ni descuentos.
function vcTotalCentavos(lineas) {
  return (Array.isArray(lineas) ? lineas : []).reduce((s, l) => s + (vcObjeto(l) && Number.isSafeInteger(l.subtotalCentavos) ? l.subtotalCentavos : 0), 0);
}

// -----------------------------------------------------------------------------
// Texto: monto, resumen y línea del aviso
// -----------------------------------------------------------------------------
// «Bs 1.234,50» / «Bs 450»: miles con «.», decimales con «,», y sin decimales si son 00. ATENCIÓN: recibe CENTAVOS (`cbMonto` de `cobro.js` recibe bolivianos). Si no es un entero seguro devuelve '' (como `cbMonto`).
function vcMonto(centavos) {
  if (!Number.isSafeInteger(centavos)) return '';
  const a = Math.abs(centavos);
  const enteros = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const d = a % 100;
  return (centavos < 0 ? '-' : '') + 'Bs ' + enteros + (d === 0 ? '' : ',' + (d < 10 ? '0' : '') + d);
}

// El resumen: una línea por ítem, `cantidad × nombre (detalle) — subtotal` (el paréntesis solo si hay detalle), y el total al final. Sin emojis.
function vcResumen(lineas) {
  const ls = (Array.isArray(lineas) ? lineas : []).filter(vcObjeto);
  const filas = ls.map((l) => {
    const detalle = vcLimpiar(l.detalle);
    return vcTexto(l.cantidad) + ' × ' + vcLimpiar(l.nombre) + (detalle === '' ? '' : ' (' + detalle + ')') + ' — ' + vcMonto(l.subtotalCentavos);
  });
  filas.push('Total: ' + vcMonto(vcTotalCentavos(ls)));
  return filas.join('\n');
}

// La línea corta para una variable de plantilla: los primeros `max` ítems (4 por defecto) como `cantidad × nombre`, separados por «, », y «y N más» si hay más. Sin saltos de línea, con los espacios colapsados (una variable
// de plantilla no admite saltos ni más de 4 espacios seguidos), de a lo más 200 caracteres y nunca vacía: sin líneas dice «sin ítems».
function vcLineaAviso(lineas, opciones) {
  const max = vcTope(vcObjeto(opciones) ? opciones.max : undefined, 4);
  const ls = (Array.isArray(lineas) ? lineas : []).filter(vcObjeto);
  const primeras = ls.slice(0, max).map((l) => vcLimpiar(vcTexto(l.cantidad) + ' × ' + vcTexto(l.nombre)));
  const resto = ls.length - primeras.length;
  const texto = vcLimpiar(primeras.join(', ') + (resto > 0 ? ' y ' + resto + ' más' : ''), 200);
  return texto === '' ? 'sin ítems' : texto;
}

// ¿Dos carritos son el mismo? Igual en id, cantidad, precio y detalle de cada línea, sin importar el orden. Sirve para saber si el carrito (o un precio) cambió con un QR abierto. Algo que no es un arreglo nunca es igual.
function vcMismoCarrito(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const claves = (ls) => ls.map((l) => (vcObjeto(l) ? vcTexto(l.id) + '\u0000' + vcTexto(l.cantidad) + '\u0000' + vcTexto(l.precioCentavos) + '\u0000' + vcTexto(l.detalle) : '\u0001')).sort();
  const ka = claves(a);
  const kb = claves(b);
  return ka.every((k, i) => k === kb[i]) && ka.indexOf('\u0001') < 0;
}
