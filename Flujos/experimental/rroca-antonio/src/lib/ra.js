// =============================================================================
// RA (prefijo `ra`): lo PROPIO del flujo de Antonio («El Puente», tenant rroca-antonio)
// =============================================================================
// PR-A (esqueleto): solo lo que el núcleo y los medios exigen. La conversación, el catálogo, el QR, el comprobante y los avisos llegan en PR-B y PR-C.
// Se pega DELANTE de `_comun.js` y del código de cada nodo (el nodo Code de n8n no tiene módulos). JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`, y nada de red.
// Ningún texto de este archivo nombra a otro cliente. Los textos que ve el cliente van en párrafos separados por una línea en blanco.

// La ficha de un teléfono se olvida a las 48 horas sin actividad; el mapa de fichas no pasa de 5.000 y cada ficha recuerda los últimos 40 ids de mensaje de Meta.
const RA_OLVIDO_MS = 48 * 60 * 60 * 1000;
const RA_TOPE_FICHAS = 5000;
const RA_TOPE_IDS = 40;

// Lo que el cliente ve cuando manda algo que este canal no lee (sticker, ubicación, contacto, pedido, mensaje no soportado, o un medio sin id): texto cortés fijo, sin modelo.
// Dos párrafos, una sola invitación, ninguna promesa y ninguna pregunta por opciones que no existen.
const RA_TEXTO_CORTES = 'Recibí tu mensaje, pero por este chat solo puedo leer texto, notas de voz, fotos y archivos PDF.\n\nCuéntame por escrito o con una nota de voz en qué te puedo ayudar.';

function raTexto(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}
// El texto que escribe el cliente llega recortado en el borde (1.500) y sin caracteres de control.
function raLineaCliente(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);
}
function raFichaBase() {
  return { v: 1, ultimoMs: 0, ultimosIds: [] };
}
// La ficha vigente de un teléfono: si pasó el olvido, es una ficha nueva.
function raFichaVigente(e, ahoraMs) {
  const base = raFichaBase();
  if (!e || typeof e !== 'object' || Array.isArray(e)) return base;
  const ultimo = Number.isFinite(e.ultimoMs) && e.ultimoMs > 0 ? e.ultimoMs : 0;
  if (ultimo && ahoraMs - ultimo > RA_OLVIDO_MS) return base;
  return {
    v: 1,
    ultimoMs: ultimo,
    ultimosIds: (Array.isArray(e.ultimosIds) ? e.ultimosIds : []).filter((x) => typeof x === 'string' && x !== '' && x.length <= 200).slice(-RA_TOPE_IDS),
  };
}
function raYaVisto(ficha, id) {
  const x = raTexto(id);
  return x !== '' && !!ficha && typeof ficha === 'object' && Array.isArray(ficha.ultimosIds) && ficha.ultimosIds.includes(x);
}
function raRecordarIds(f, ids) {
  const x = (Array.isArray(f.ultimosIds) ? f.ultimosIds : []).slice();
  for (const id of ids) if (typeof id === 'string' && id !== '' && id.length <= 200 && !x.includes(id)) x.push(id);
  f.ultimosIds = x.slice(-RA_TOPE_IDS);
  return f;
}
// Barre el mapa: fuera las de más de 48 h (o sin hora) y, si pasan de 5.000, las más viejas.
function raBarrer(mapa, ahoraMs) {
  if (!mapa || typeof mapa !== 'object') return mapa;
  for (const k of Object.keys(mapa)) {
    const u = mapa[k] && Number.isFinite(mapa[k].ultimoMs) ? mapa[k].ultimoMs : 0;
    if (!(u > 0) || ahoraMs - u > RA_OLVIDO_MS) delete mapa[k];
  }
  const claves = Object.keys(mapa);
  if (claves.length > RA_TOPE_FICHAS) {
    claves.sort((a, b) => mapa[a].ultimoMs - mapa[b].ultimoMs);
    for (const k of claves.slice(0, claves.length - RA_TOPE_FICHAS)) delete mapa[k];
  }
  return mapa;
}
