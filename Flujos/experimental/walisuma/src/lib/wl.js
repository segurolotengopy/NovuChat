// =============================================================================
// WL (prefijo `wl`): lo PROPIO del flujo de venta de Walisuma (tenant `walisuma`)
// =============================================================================
// ESQUELETO (PR-2). Se pega DELANTE de `_comun.js` (de `venta-digital/src/nodos/`) y del código de cada nodo, DESPUÉS de la base común de las ventas digitales (`venta-digital/src/`: `cobro.js`, `avisos.js` y
// `conversacion.js`, prefijos `cb`, `av` y `vd`). Aquí quedan SOLO los datos y los textos de Walisuma, y el objeto `CN_TENANT` con el que los nodos comunes leen lo que es del tenant (la clave de su ficha y cómo se
// lee la ficha). JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`, y nada de red.
//
// Lo que PR-3 agrega a este archivo: la guía de voz y el prompt de la conversación, el lector del panel (catálogo, cobro y campañas de `configuracionFlujo`), los textos de la venta y del aviso al comercio. La guía de voz
// no está en el repositorio: la pone quien diseña la conversación (no se inventa aquí).
//
// REGLAS QUE ESTA LIBRERÍA HACE CUMPLIR (el prompt NO es una barrera):
//   - un texto fijo del flujo nunca dice «acreditado», «verificado» ni «recibimos tu pago», y nunca niega ser una IA (`wlSeguro`);
//   - la clave de la ficha de un teléfono es SIEMPRE `messages[0].from` (la fija el nodo «Normalizar entrada»); dos teléfonos nunca comparten ficha.

// La ficha de un teléfono se olvida a las 48 horas sin actividad; el mapa de fichas no pasa de 1.000 (n8n graba TODAS en cada ejecución).
const WL_OLVIDO_MS = 48 * 60 * 60 * 1000;
const WL_TOPE_FICHAS = 1000;
const WL_TOPE_IDS = 40;
const WL_VENTANA_FUERA_DE_PAIS_MS = 24 * 60 * 60 * 1000;   // el texto fijo a un número de otro país sale a lo más una vez en 24 h
const WL_MODELO = 'gemini-3.5-flash-lite';

// NIEGA_IA (prohibición 4 de CLAUDE.md): ningún texto que ve el cliente puede negar que es una IA. COPIA DECLARADA de la expresión de `rroca-antonio` (`RA_NIEGA_IA`; HUECO en PROPIO.md: no hay fuente común), idéntica salvo el nombre; una prueba la compara. Se aplica al texto NORMALIZADO (`wlNorm`).
const WL_NIEGA_IA = /\bno (?:soy|es|eres|estas hablando con|hablas con)\b[^.!?]{0,20}\b(?:ia|inteligencia|bot|chatbot|robot|maquina|programa|asistente|virtual)\b|\bpersona (?:real|de verdad)\b|\bcarne y hueso\b|\bno (?:contesta|responde|atiende|hay) (?:ningun\w* )?(?:ia|inteligencia|bot|robot|maquina)\b|\bnada de (?:robots?|bots?|maquinas?)\b|\bhumano\b|\bpersonalmente\b|\bconmigo (?:hablas|conversas)\b|\bequipo humano\b|\b(?:soy|es) (?:una )?persona\b|\balguien real\b|\bhuman[oa]s?\b|\b(?:personas?|gente) (?:real(?:es)?|de verdad)\b|\b(?:persona|gente|alguien|humano|equipo|ejecutiv\w*|asesor\w*) (?:real|de verdad)\b|\bde verdad\b[^.!?]{0,20}\b(?:persona|gente|humano)\w*|\bno (?:contesta|responde|atiende|hay|habla) (?:(?:un|una|el|la|ningun\w*) )?(?:ia|inteligencia|bot|chatbot|robot|maquina|programa)\b|\bno es (?:un )?(?:mensaje |chat )?automatic\w*|\b(?:es|soy) (?:una? )?(?:chica|chico|mujer|hombre|senorita|joven)\b/;
const WL_SALUDO_MINIMO = 'Hola, soy el asistente virtual.';

// Lo que el cliente ve cuando manda algo que este canal no lee (sticker, ubicación, contacto, mensaje no soportado o un medio sin id): texto cortés fijo, sin modelo, una sola invitación y ninguna promesa.
const WL_TEXTO_CORTES = 'Recibí tu mensaje, pero por este chat solo puedo leer texto, notas de voz, fotos y archivos PDF.\n\nCuéntame por escrito o con una nota de voz en qué te puedo ayudar.';
// Un número de otro país (prefijo no permitido en «Config del negocio»): un texto fijo, sin modelo, sin medios y sin promesas. PROVISIONAL: el texto definitivo lo decide el comercio.
const WL_TEXTO_FUERA_DE_PAIS = 'Hola, soy el asistente virtual. Por este chat atendemos pedidos de números de Bolivia.\n\nGracias por escribirnos.';

function wlTexto(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}
function wlNorm(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// El texto que escribe el cliente llega recortado en el borde y sin caracteres de control.
function wlLineaCliente(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);
}
// Un texto que el flujo escribe por su cuenta pasa por aquí: si cayera en NIEGA_IA o afirmara un pago (`CB_PROHIBIDAS`, de `cobro.js`), sale el mínimo.
function wlSeguro(texto) {
  const t = String(texto === undefined || texto === null ? '' : texto);
  if (WL_NIEGA_IA.test(wlNorm(t))) return WL_SALUDO_MINIMO;
  if (CB_PROHIBIDAS.test(cbCanon(t))) return WL_SALUDO_MINIMO;
  return t;
}
// Violencia o miedo: no es parte del servicio de este negocio. El gancho existe porque los nodos comunes lo piden; aquí no marca nada.
function wlEsRiesgo() {
  return false;
}

// -----------------------------------------------------------------------------
// LA FICHA por teléfono (`staticData.global.walisuma[<messages[0].from>]`). PR-3 agrega los campos de la venta (carrito, pedido, QR abierto…) a `wlFichaBase` y a `wlFichaVigente`.
//   v, ultimoMs (cuándo escribió por última vez), ultimosIds (últimos ids de mensaje de Meta: repetidos), turnos, saludado, fueraDePaisMs (cuándo se le envió el texto de otro país),
//   charlaN, pidioOpciones y opcionesVistas (la conversación antes de las opciones: `vdFichaCharla`).
// -----------------------------------------------------------------------------
function wlFichaBase() {
  return { v: 1, ultimoMs: 0, ultimosIds: [], turnos: 0, saludado: false, fueraDePaisMs: 0, charlaN: 0, pidioOpciones: false, opcionesVistas: false };
}
// La ficha vigente de un teléfono: si pasó el olvido, es una ficha nueva.
function wlFichaVigente(e, ahoraMs) {
  const base = wlFichaBase();
  if (!e || typeof e !== 'object' || Array.isArray(e)) return base;
  const ultimo = Number.isFinite(e.ultimoMs) && e.ultimoMs > 0 ? e.ultimoMs : 0;
  if (ultimo && ahoraMs - ultimo > WL_OLVIDO_MS) return base;
  const nums = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const charla = vdFichaCharla(e, ahoraMs);
  return {
    v: 1,
    ultimoMs: ultimo,
    ultimosIds: (Array.isArray(e.ultimosIds) ? e.ultimosIds : []).filter((x) => typeof x === 'string' && x !== '' && x.length <= 200).slice(-WL_TOPE_IDS),
    turnos: Number.isFinite(e.turnos) && e.turnos > 0 ? Math.floor(e.turnos) : 0,
    saludado: e.saludado === true,
    fueraDePaisMs: nums(e.fueraDePaisMs),
    charlaN: charla.charlaN,
    pidioOpciones: charla.pidioOpciones,
    opcionesVistas: charla.opcionesVistas,
  };
}
function wlYaVisto(ficha, id) {
  const x = wlTexto(id);
  return x !== '' && !!ficha && typeof ficha === 'object' && Array.isArray(ficha.ultimosIds) && ficha.ultimosIds.includes(x);
}
function wlRecordarIds(f, ids) {
  const x = (Array.isArray(f.ultimosIds) ? f.ultimosIds : []).slice();
  for (const id of ids) if (typeof id === 'string' && id !== '' && id.length <= 200 && !x.includes(id)) x.push(id);
  f.ultimosIds = x.slice(-WL_TOPE_IDS);
  return f;
}
// Barre el mapa: fuera las de más de 48 h (o sin hora) y, si pasan del tope, las más viejas.
function wlBarrer(mapa, ahoraMs) {
  if (!mapa || typeof mapa !== 'object') return mapa;
  for (const k of Object.keys(mapa)) {
    const u = mapa[k] && Number.isFinite(mapa[k].ultimoMs) ? mapa[k].ultimoMs : 0;
    if (!(u > 0) || ahoraMs - u > WL_OLVIDO_MS) delete mapa[k];
  }
  const claves = Object.keys(mapa);
  if (claves.length > WL_TOPE_FICHAS) {
    claves.sort((a, b) => mapa[a].ultimoMs - mapa[b].ultimoMs);
    for (const k of claves.slice(0, claves.length - WL_TOPE_FICHAS)) delete mapa[k];
  }
  return mapa;
}

// -----------------------------------------------------------------------------
// EL PARÁMETRO DEL TENANT para los nodos comunes de `venta-digital/src/nodos/` (`_comun.js` lo lee por este nombre).
// -----------------------------------------------------------------------------
const CN_TENANT = {
  claveFicha: 'walisuma',
  ventanaFueraDePaisMs: WL_VENTANA_FUERA_DE_PAIS_MS,
  fichaVigente: wlFichaVigente,
  yaVisto: wlYaVisto,
  lineaCliente: wlLineaCliente,
  norm: wlNorm,
  esRiesgo: wlEsRiesgo,
};
