// CORE · TEXTO · TIPEO (23/10/2026). Tolerancia a errores de tipeo del cliente, aplicada UNA vez al texto del turno antes de los detectores. Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node, sin retorno de nivel superior.
// Origen: `chCerca`/`chTipeo` de chat.js (#513), sin su defecto: aquel quitaba la `s` final de TODA palabra y aceptaba una edición, y así «actuar» pasaba a «actual» y «celulas» a «celular».
// Las CLAVES (las palabras a las que se corrige) son de cada flujo y llegan por parámetro: el core no contiene claves ni texto de ningún cliente. Una clave es un texto («cobra») o `{ c: 'telefono', plural: true }` (acepta además la palabra sin su `s` final). Gana la primera clave en el orden declarado: los plurales van antes que los singulares.
// SALIDA: `ctTipeo` devuelve el texto con las palabras corregidas y TODO LO DEMÁS literal (puntuación, `?`, espacios): los detectores miran `?` en el crudo. Las palabras corregidas salen en minúsculas y sin tildes, tal como la clave.

// Palabras españolas reales a una edición de una clave habitual: nunca se tocan.
const CT_TIPEO_PROTEGIDAS = ['actuar', 'celula', 'celulas', 'sobra', 'cobre', 'integral', 'contesta', 'comenta', 'consulta', 'panes', 'metas', 'metal', 'metro'];

// ¿Una letra de más, de menos, cambiada o dos contiguas intercambiadas? Igual cuenta como cierto. Lineal.
function ctUnaEdicion(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (la - lb > 1 || lb - la > 1) return false;
  const m = la < lb ? la : lb;
  let i = 0;
  while (i < m && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i + 1] === b[i] && a[i] === b[i + 1] && a.slice(i + 2) === b.slice(i + 2);
  }
  if (la > lb) return a.slice(i + 1) === b.slice(i);
  return a.slice(i) === b.slice(i + 1);
}

// Junta las letras repetidas: «metta» -> «meta».
function ctColapsar(w) {
  return String(w).replace(/(.)\1+/g, '$1');
}

// `nw` YA viene normalizado (minúsculas, sin tildes). Devuelve la clave o la misma palabra.
function ctCorregirPalabra(nw, claves) {
  if (typeof nw !== 'string' || nw.length < 4 || nw.length > 30 || !/^[a-z0-9]+$/.test(nw) || !Array.isArray(claves)) return nw;
  if (CT_TIPEO_PROTEGIDAS.indexOf(nw) >= 0) return nw;
  const lista = [];
  for (let i = 0; i < claves.length; i++) {
    const c = claves[i];
    const k = typeof c === 'string' ? c : c && typeof c.c === 'string' ? c.c : '';
    if (k === nw) return nw;
    if (k) lista.push({ k: k, plural: !!(c && typeof c === 'object' && c.plural) });
  }
  const colapsada = ctColapsar(nw);
  for (let i = 0; i < lista.length; i++) {
    const k = lista[i].k;
    if (k.length >= 5) {
      if (ctUnaEdicion(nw, k)) return k;
      if (lista[i].plural && nw.length > 5 && nw.slice(-1) === 's' && ctUnaEdicion(nw.slice(0, -1), k)) return k;
    } else {
      if (colapsada === k) return k;
      if (lista[i].plural && nw.slice(-1) === 's' && ctColapsar(nw.slice(0, -1)) === k) return k;
    }
  }
  return nw;
}

// Corrige cada palabra (letras y dígitos seguidos) cuya forma sin tildes y en minúsculas se corrige. Idempotente. Una palabra con letras fuera de a-z tras quitar tildes (otro alfabeto, homoglifos) no se toca.
function ctTipeo(texto, claves) {
  const t = (texto === undefined || texto === null ? '' : String(texto)).slice(0, 4096).normalize('NFKC').slice(0, 4096);
  return t.replace(/[\p{L}\p{N}]+/gu, function (w) {
    const nw = w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const r = ctCorregirPalabra(nw, claves);
    return r === nw ? w : r;
  });
}
