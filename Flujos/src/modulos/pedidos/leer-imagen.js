// LEER IMAGEN (módulo común de Pedidos, prefijo `li`): la imagen de una pieza o de un anuncio se cruza, POR CÓDIGO, con el catálogo.
//
// POR QUÉ (Andres, 23/11/2026, MD de Walisuma puntos 38 y 39): Silvana mandó la foto de un anuncio de individuales tejidos con «¿tienes estos?» y el asistente
// contestó «por aquí no podemos verla con detalle». La lectura YA existe: la llamada del clasificador de imágenes (la misma de siempre, 0 llamadas de más) devuelve
// `categoria`, `texto`, `titular_principal` y `descripcion`. Lo que faltaba es que el CÓDIGO la use.
//
// LA FRASE DE VISIÓN ES UN DATO NO CONFIABLE (la escribió un modelo leyendo lo que envió el cliente). Por construcción:
//   - en el camino «hay coincidencia» NADA de lo leído llega al cliente: el texto leído solo se parte en palabras y se compara con el catálogo; lo que sale
//     es el nombre y el precio del CATÁLOGO (nunca los de la imagen). Una instrucción escondida solo podría hacer coincidir una pieza real, con su precio real;
//   - si el texto leído parece una instrucción o afirma un pago, NO se usa para nada (ni para coincidir ni para mostrar);
//   - en el camino «sin coincidencia» solo viaja la descripción, saneada con una lista blanca de caracteres (letras, dígitos, espacios, coma y punto), sin
//     enlaces ni cifras largas, de hasta 100 caracteres, y se muestra como «parece ser…», nunca como una orden ni como un hecho.
// 0 mensajes extra, 0 llamadas de modelo extra: el turno sale en el mismo mensaje que hoy.
//
//   liLeer(salidaDelClasificador)      → { ok, categoria, partes[], descripcion }  (las partes son SOLO para comparar; la descripción es la única que se muestra)
//   liCoincidencias(lectura, vendibles) → [{ id, puntaje }]  las piezas del catálogo (vendibles, con precio) que la imagen nombra, de mejor a peor (hasta 4)
//
// `vendibles` es la salida de `vcVendibles`: [{ id, nombre, precioCentavos, area, descripcion }].

const LI_PARTES_MAX = 1200;
const LI_MAX_PIEZAS = 4;
const LI_CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿­]/g;
const LI_INSTRUCCION = /(\basistente\s*:|\b(ignor|olvid|desobedec|disregard|forget|instrucci|prompt|sistema|system|actua\s+como|eres\s+ahora|you\s+are|responde\s+(con|que)|di\s+que|aviso_sistema|transferir|nuevas?\s+(orden|regla)))/;
const LI_INSTRUCCION_PEGADA = /(ignor|olvid|desobedec|disregard|forget|instrucci|prompt|actuacomo|eresahora|youare|respondecon|respondeque|dique|nuevas?(orden|regla))/;
const LI_PAGO = /\b(acredit\w*|verificad\w*|confirmad\w*|aprobad\w*|exitos\w*|pagad\w*|depositad\w*|transferid\w*|paid|success\w*|approv\w*)\b/;
const LI_PARADAS = new Set(['para', 'con', 'sin', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'por', 'que', 'como', 'esta', 'este', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'muy', 'mas', 'son', 'hay', 'tienen', 'tienes', 'tiene', 'tenemos', 'imagen', 'foto', 'fotografia', 'captura', 'pantalla', 'anuncio', 'publicidad', 'promocion', 'oferta', 'ofertas', 'nuevo', 'nueva', 'nuevos', 'nuevas', 'solo', 'hoy', 'precio', 'precios', 'tienda', 'venta', 'pieza', 'piezas', 'producto', 'productos', 'hecho', 'hecha', 'hechos', 'hechas', 'mano', 'color', 'colores', 'diseno', 'disenos', 'modelo', 'modelos', 'varios', 'varias', 'cada', 'todo', 'toda', 'todos', 'todas', 'sobre', 'entre', 'desde', 'hasta', 'bolivia', 'texto', 'persona', 'personas', 'fondo', 'sobre', 'mesa']);

function liNorm(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').replace(LI_CONTROL, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Una palabra «raíz»: sin plural ni diminutivo corriente (individuales → individual, tejidos → tejido). Solo letras, de 4 o más.
function liRaiz(p) {
  let r = p;
  if (r.length > 6 && /(es)$/.test(r) && /[lrnzd]es$/.test(r)) r = r.slice(0, -2);
  else if (r.length > 5 && /s$/.test(r)) r = r.slice(0, -1);
  return r;
}
function liPalabras(texto) {
  const out = [];
  for (const p of liNorm(texto).split(/[^a-z]+/)) {
    if (p.length < 4 || LI_PARADAS.has(p)) continue;
    const r = liRaiz(p);
    if (r.length >= 4 && !LI_PARADAS.has(r) && out.indexOf(r) < 0) out.push(r);
  }
  return out.slice(0, 80);
}
// Para la descripción que SÍ se muestra al cliente: se descarta ENTERA si parece una instrucción, afirma o nombra un pago, promete algo (gratis, descuento, envío…),
// trae cifras, enlaces o dominios, o letras de otro alfabeto (homóglifos). Para COINCIDIR con el catálogo no hace falta ningún filtro: en ese camino nada de lo leído llega al cliente.
const LI_PROMESA = /\b(gratis|gratuit\w*|descuent\w*|regal\w*|promo\w*|garanti\w*|devoluc\w*|envio\w*|oferta\w*|rebaja\w*|pago|pagos|pagad\w*|transferenc\w*|deposit\w*|comprobante\w*|acredit\w*|realizad\w*|exitos\w*|aprobad\w*|confirmad\w*|verificad\w*|recibid\w*|paid|success\w*|approv\w*)\b/;
function liParece(texto) {
  const plano = liNorm(texto);
  const pegado = plano.replace(/[^a-z]/g, '');
  return LI_INSTRUCCION.test(plano) || LI_INSTRUCCION_PEGADA.test(pegado) || LI_PROMESA.test(plano) || LI_PAGO.test(plano);
}
function liTextoDe(j) {
  if (!j || typeof j !== 'object') return '';
  const partes = (c) => (c && Array.isArray(c.parts)) ? c.parts.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n') : '';
  if (typeof j.content === 'string') return j.content;
  const c1 = partes(j.content);
  if (c1) return c1;
  const cand = Array.isArray(j.candidates) ? j.candidates[0] : null;
  const c2 = cand ? partes(cand.content) : '';
  if (c2) return c2;
  for (const k of ['text', 'output', 'response']) if (typeof j[k] === 'string' && j[k].trim()) return j[k];
  return '';
}
// La descripción que SÍ puede viajar al cliente: lista blanca de caracteres, sin instrucciones ni pagos, de hasta 100 caracteres, cortada en una palabra entera.
function liDescripcionSegura(v) {
  if (typeof v !== 'string') return '';
  const base = v.slice(0, 400).normalize('NFKC').replace(LI_CONTROL, ' ');
  if (liParece(base) || /\d/.test(base) || /\w\.[a-z]{2,}\b/i.test(base) || /[^\u0000-\u024f\u2010-\u2027]/.test(base)) return '';
  let t = base.replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, ' ').replace(/\d{3,}/g, ' ').replace(/[^\p{L}\p{N} ,.]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 100) { t = t.slice(0, 100); const k = t.lastIndexOf(' '); if (k > 20) t = t.slice(0, k); t = t.trim(); }
  return t.replace(/[,.]+$/, '');
}
// La lectura de la salida del clasificador (el nodo «Describir imagen»). `ok` es falso si no se pudo leer o si el texto parece una instrucción o un pago: entonces no se usa nada.
function liLeer(salida) {
  const vacio = { ok: false, categoria: '', partes: [], descripcion: '', mencionaPago: false };
  let objeto = null;
  const m = /\{[\s\S]*\}/.exec(liTextoDe(salida));
  if (m) { try { objeto = JSON.parse(m[0]); } catch (e) { objeto = null; } }
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return vacio;
  // Coincidir: SOLO con lo escrito en la imagen (titular y texto), nunca con la `descripcion` libre del modelo (decía «un collar» y coincidía con «Cuello»). Sin filtros: nada de esto se muestra.
  const campo = (k) => (typeof objeto[k] === 'string' ? objeto[k].slice(0, 600) : '');
  const escrito = [campo('titular_principal'), campo('texto')].join(' ').slice(0, LI_PARTES_MAX);
  const categoria = liNorm(typeof objeto.categoria === 'string' ? objeto.categoria.slice(0, 40) : '').trim().replace(/[\s-]+/g, '_');
  const descripcion = liDescripcionSegura(campo('descripcion'));
  // ¿La imagen habla de un pago? (para que, con un cobro abierto, un comprobante mal clasificado nunca se tome por una pieza ni se pierda)
  const todo = liNorm([escrito, campo('descripcion')].join(' '));
  const mencionaPago = LI_PAGO.test(todo) || /\b(pago|pagos|transferenc\w*|comprobante\w*|deposit\w*|operacion|transaccion)\b/.test(todo);
  if (escrito.trim() === '' && descripcion === '') return { ok: false, categoria: categoria, partes: [], descripcion: '', mencionaPago: mencionaPago };
  return { ok: true, categoria: categoria, partes: liPalabras(escrito), descripcion: descripcion, mencionaPago: mencionaPago };
}
// Las piezas que la imagen nombra. El nombre de una pieza empieza por QUÉ ES («Individual tejido…», «Billetera de cuero», «Llavero de llama»): una pieza coincide si la imagen
// nombra ESA palabra (el tipo de pieza) o DOS palabras distintas de su nombre. Una sola palabra suelta del material («cuero») no basta: un sillón de cuero no es una billetera.
// Las palabras de la categoría y la descripción de la pieza suman al orden, pero nunca bastan solas.
function liCoincidencias(lectura, vendibles) {
  if (!lectura || lectura.ok !== true || !Array.isArray(lectura.partes) || !lectura.partes.length || !Array.isArray(vendibles) || !vendibles.length) return [];
  const imagen = new Set(lectura.partes);
  const fichas = vendibles.map((v) => ({ id: v.id, nombre: liPalabras(v.nombre), resto: liPalabras((v.area || '') + ' ' + (v.descripcion || '')) }));
  const df = new Map();
  for (const f of fichas) for (const p of new Set(f.nombre.concat(f.resto))) df.set(p, (df.get(p) || 0) + 1);
  const res = [];
  for (const f of fichas) {
    if (!f.nombre.length) continue;
    const enNombre = f.nombre.filter((p) => imagen.has(p));
    const enResto = f.resto.filter((p) => imagen.has(p) && f.nombre.indexOf(p) < 0);
    if (!(imagen.has(f.nombre[0]) || enNombre.length >= 2)) continue;
    let puntaje = 0;
    for (const p of enNombre) puntaje += 3 / Math.max(1, df.get(p) || 1) + 1;
    for (const p of enResto) puntaje += 0.5 / Math.max(1, df.get(p) || 1);
    res.push({ id: f.id, puntaje: puntaje });
  }
  res.sort((a, b) => b.puntaje - a.puntaje);
  const mejor = res.length ? res[0].puntaje : 0;
  return res.filter((r) => r.puntaje >= mejor * 0.5).slice(0, LI_MAX_PIEZAS);
}
