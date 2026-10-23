// CORE · TEXTO · NO REPETIR (21/10/2026). Nunca el mismo texto dos veces seguidas a un teléfono. Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node, sin retorno de nivel superior.
// Origen canónico: `rrNorm`, `rrHashTexto`, `rrFichaVigente` y `rrAlternaDeRepetido` de Rubén (rr.js) y `chSimilitud` de chat.js. `ctNormTexto` y `ctHashTexto` dan EXACTAMENTE los mismos valores que `rrNorm` y `rrHashTexto`, para que los hashes ya guardados en las fichas sigan valiendo.
// SALIDA: lo que devuelve `ctAlternaDeRepetido` (sobre todo con `alternas` del tenant) DEBE pasar en el consumidor por el filtro de salida común (`cmMotivoDeRechazo` de comun-sin-agente/src/filtro-redaccion.js, NIEGA_IA y CB_PROHIBIDAS de procesar-respuesta.js); si lo rechaza, se usa el conjunto base. El PR que conecte esta función a un flujo no puede fusionarse sin ese filtro.
// Las EXENCIONES (qué planes o textos no se verifican: el QR, el comprobante, la protección ante violencia…) las decide cada cliente, no el core.

function ctNormTexto(t) {
  return (t === undefined || t === null ? '' : String(t)).normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// Hash corto (djb2 sobre el texto normalizado) para comparar textos enviados; no es criptográfico ni se usa para nada de seguridad.
function ctHashTexto(t) {
  const s = ctNormTexto(t);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return ('00000000' + h.toString(16)).slice(-8);
}
// Parecido entre dos textos: similitud de CONJUNTOS de palabras de 3 letras o más, sin tildes. 1 = mismas palabras, 0 = ninguna en común.
function ctSimilitud(a, b) {
  const conj = (x) => new Set(ctNormTexto(x).split(' ').filter((w) => w.length >= 3));
  const A = conj(a);
  const B = conj(b);
  if (!A.size || !B.size) return 0;
  let comun = 0;
  for (const w of A) if (B.has(w)) comun += 1;
  return comun / (A.size + B.size - comun);
}
// Lo que la ficha de un teléfono guarda para no repetir: el hash del último texto enviado y la firma del plan de ese turno. Lo que no cumple el formato se descarta.
function ctFichaNoRepetir(f) {
  return {
    ultimoHash: f && typeof f.ultimoHash === 'string' && /^[0-9a-f]{8}$/.test(f.ultimoHash) ? f.ultimoHash : '',
    ultimaFirma: f && typeof f.ultimaFirma === 'string' && /^[a-z_]{1,30}$/.test(f.ultimaFirma) ? f.ultimaFirma : '',
  };
}
// ¿El texto repite al anterior? Por hash igual; y, si hay umbral y texto previo, por similitud >= umbral. Sin hash ni previo no hay con qué comparar: no es repetido.
function ctEsRepetido(texto, opciones) {
  const o = opciones && typeof opciones === 'object' ? opciones : {};
  if (typeof o.hash === 'string' && o.hash !== '' && ctHashTexto(texto) === o.hash) return true;
  if (typeof o.umbral === 'number' && o.umbral > 0 && typeof o.previo === 'string' && o.previo !== '') return ctSimilitud(texto, o.previo) >= o.umbral;
  return false;
}
// Los textos alternos de base; `{titular}` es el nombre de quien atiende (el negocio decide cómo se llama).
// El conjunto `tu` de `contenido` es el de Rubén (rr.js) con «Rubén» → {titular}; el de `medio` se reescribió el 23/10/2026 por reclamo de Andres (el «Sigo sin poder…» salía la primera vez que el cliente mandaba el archivo): redacción NEUTRA, sin «sigo», «tampoco» ni nada que presuponga una repetición previa; sus tres textos son los de Antonio (#593). Las de `contenido` sí presuponen repetición porque solo se usan cuando el bot iba a repetir exactamente el mismo texto.
// El conjunto `usted` es la conjugación literal de las mismas frases: SU TEXTO SIGUE PENDIENTE DE APROBACIÓN de Silvana y de Andres.
const CT_ALTERNAS = {
  tu: {
    contenido: [
      'Eso ya te lo conté en mi mensaje anterior. Si te quedó alguna duda, cuéntame cuál; y si prefieres hablar con {titular}, escríbele con el botón.',
      'Prefiero no repetirte lo mismo. Dime con otras palabras qué necesitas saber, o escríbele directo a {titular} con el botón.',
      'Esa información ya está más arriba en este chat. Si algo no quedó claro, pregúntamelo de otra forma o escríbele a {titular} con el botón.',
    ],
    medio: [
      'Por aquí no puedo trabajar con ese archivo. Cuéntame por escrito qué necesitas, o escríbele a {titular} con el botón.',
      'No pude usar ese archivo en este chat. Escríbeme lo que necesitas en un mensaje, o escríbele directo a {titular} con el botón.',
      'Ese archivo no lo puedo revisar por aquí. Dime con palabras qué buscas, o escríbele a {titular} con el botón.',
    ],
  },
  usted: {
    contenido: [
      'Eso ya se lo conté en mi mensaje anterior. Si le quedó alguna duda, cuénteme cuál; y si prefiere hablar con {titular}, escríbale con el botón.',
      'Prefiero no repetirle lo mismo. Dígame con otras palabras qué necesita saber, o escríbale directo a {titular} con el botón.',
      'Esa información ya está más arriba en este chat. Si algo no quedó claro, pregúnteme de otra forma o escríbale a {titular} con el botón.',
    ],
    medio: [
      'Por aquí no puedo trabajar con ese archivo. Cuénteme por escrito qué necesita, o escríbale a {titular} con el botón.',
      'No pude usar ese archivo en este chat. Escríbame lo que necesita en un mensaje, o escríbale directo a {titular} con el botón.',
      'Ese archivo no lo puedo revisar por aquí. Dígame con palabras qué busca, o escríbale a {titular} con el botón.',
    ],
  },
};
for (const k of ['tu', 'usted']) { Object.freeze(CT_ALTERNAS[k].contenido); Object.freeze(CT_ALTERNAS[k].medio); Object.freeze(CT_ALTERNAS[k]); }
Object.freeze(CT_ALTERNAS);
// El texto alternativo que no repite el último enviado (`hashUltimo`): la primera alterna cuyo hash difiere; si ninguna, la primera.
// `medio` = la respuesta era a un audio, imagen o documento. `tratamiento` 'usted' usa ese conjunto; cualquier otro valor (tu, vos, neutro…) usa `tu` (nunca voseo).
// `alternas` opcional del tenant ({contenido, medio} o una lista): si es una lista válida de textos no vacíos reemplaza la base; si no, se descarta.
function ctAlternaDeRepetido(opciones) {
  const o = opciones && typeof opciones === 'object' ? opciones : {};
  const conj = o.tratamiento === 'usted' ? CT_ALTERNAS.usted : CT_ALTERNAS.tu;
  const clave = o.medio === true ? 'medio' : 'contenido';
  // Alternas del tenant: a lo más 5 textos de a lo más 400 caracteres, sin caracteres de control ni de dirección (salvo el salto de línea).
  const valida = (l) => Array.isArray(l) && l.length > 0 && l.length <= 5 && l.every((x) => typeof x === 'string' && x.trim() !== '' && x.length <= 400 && !/[\p{C}\u200E\u200F\u202A-\u202E\u2066-\u2069]/u.test(x.replace(/\n/g, '')));
  let lista = conj[clave];
  if (o.alternas && typeof o.alternas === 'object' && !Array.isArray(o.alternas)) { if (valida(o.alternas[clave])) lista = o.alternas[clave]; } else if (valida(o.alternas)) lista = o.alternas;
  // El titular se sanea: sin caracteres de control ni de dirección, a lo más 60 caracteres; vacío → «el negocio».
  const crudo = typeof o.titular === 'string' ? o.titular.slice(0, 400).replace(/[\p{C}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '').trim().slice(0, 60).replace(/[\uD800-\uDBFF]$/, '').trim() : '';
  const titular = crudo !== '' ? crudo : 'el negocio';
  const textos = lista.map((x) => x.split('{titular}').join(titular));
  const h = typeof o.hashUltimo === 'string' ? o.hashUltimo : '';
  return textos.find((x) => ctHashTexto(x) !== h) || textos[0];
}
// Anota en la ficha el último texto enviado (una imagen no guarda hash) y devuelve lo anterior para poder deshacerlo.
function ctRecordarEnviado(ficha, texto, firma, esImagen) {
  if (!ficha || typeof ficha !== 'object') return null;
  const previo = { h: ficha.ultimoHash, f: ficha.ultimaFirma };
  ficha.ultimoHash = esImagen === true ? '' : ctHashTexto(texto);
  ficha.ultimaFirma = typeof firma === 'string' && /^[a-z_]{1,30}$/.test(firma) ? firma : '';
  return previo;
}
// Deshace `ctRecordarEnviado` (por ejemplo si el envío falló y el texto nunca salió).
function ctRestaurarEnviado(ficha, previo) {
  if (ficha && previo) { ficha.ultimoHash = String(previo.h || ''); ficha.ultimaFirma = String(previo.f || ''); }
}
