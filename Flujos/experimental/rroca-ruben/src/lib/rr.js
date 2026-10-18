// =============================================================================
// LIBRERÍA PROPIA DE LA «VENTA DIGITAL DE RUBÉN» (prefijo `rr`) — PR-1: el esqueleto
// =============================================================================
// El constructor la pega delante de los nodos que la piden (modo `todo`). JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`, y nada de red.
// En PR-2 a PR-4 crece aquí lo propio del flujo (catálogo de 4 productos, total, estados, textos fijos de la venta, rescate); en PR-1 solo lo del esqueleto:
// el saludo fijo, la barrera NIEGA_IA y la ficha por teléfono.

// NIEGA_IA (prohibición 4 de CLAUDE.md): ningún texto que ve el cliente puede negar que es una IA. COPIA DECLARADA de `CH_NIEGA_IA` de
// `Flujos/experimental/chat-novuchat/src/lib/chat.js` (HUECO en PROPIO.md): la expresión es idéntica y una prueba la compara. Se aplica al texto NORMALIZADO (`rrNorm`).
const RR_NIEGA_IA = /\bno (?:soy|es|eres|estas hablando con|hablas con)\b[^.!?]{0,20}\b(?:ia|inteligencia|bot|chatbot|robot|maquina|programa|asistente|virtual)\b|\bpersona (?:real|de verdad)\b|\bcarne y hueso\b|\bno (?:contesta|responde|atiende|hay) (?:ningun\w* )?(?:ia|inteligencia|bot|robot|maquina)\b|\bnada de (?:robots?|bots?|maquinas?)\b|\bhumano\b|\bpersonalmente\b|\bconmigo (?:hablas|conversas)\b|\bequipo humano\b|\b(?:soy|es) (?:una )?persona\b|\balguien real\b|\bhuman[oa]s?\b|\b(?:personas?|gente) (?:real(?:es)?|de verdad)\b|\b(?:persona|gente|alguien|humano|equipo|ejecutiv\w*|asesor\w*) (?:real|de verdad)\b|\bde verdad\b[^.!?]{0,20}\b(?:persona|gente|humano)\w*|\bno (?:contesta|responde|atiende|hay|habla) (?:(?:un|una|el|la|ningun\w*) )?(?:ia|inteligencia|bot|chatbot|robot|maquina|programa)\b|\bno es (?:un )?(?:mensaje |chat )?automatic\w*|\b(?:es|soy) (?:una? )?(?:chica|chico|mujer|hombre|senorita|joven)\b/;

// Texto fijo de PR-1. Lo arma el código; no hay modelo. Se presenta como asistente virtual (prohibición 4) y no promete nada.
const RR_SALUDO = 'Hola, soy el asistente virtual de Rubén. Te puedo ayudar con el libro «IA para Emprendedores Independientes». ¿Qué te gustaría saber?';
// Lo mínimo si, por un cambio mal hecho, el saludo cayera en NIEGA_IA: nunca sale un texto que niegue ser una IA.
const RR_SALUDO_MINIMO = 'Hola, soy el asistente virtual de Rubén.';

const RR_TOPE_FICHAS = 300;   // fichas guardadas a lo más (n8n graba TODAS en cada ejecución)
const RR_TOPE_IDS = 5;        // ids de Meta que se recuerdan por ficha (entregas repetidas)
const RR_OLVIDO_MS = 48 * 60 * 60 * 1000;

function rrTexto(v) { return v === undefined || v === null ? '' : String(v); }
function rrNorm(t) {
  return rrTexto(t).normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// El texto que ve el cliente, con la barrera aplicada: si niega ser una IA, sale el mínimo.
function rrSeguro(texto) {
  return RR_NIEGA_IA.test(rrNorm(texto)) ? RR_SALUDO_MINIMO : texto;
}
// La ficha de un teléfono: nueva, o la guardada si es un objeto. Solo cuenta lo de ESE teléfono.
function rrFichaVigente(f) {
  const ids = f && Array.isArray(f.ultimosIds) ? f.ultimosIds.filter((x) => typeof x === 'string') : [];
  return { ultimosIds: ids.slice(-RR_TOPE_IDS), turnos: f && Number.isFinite(f.turnos) ? f.turnos : 0, ultimoMs: f && Number.isFinite(f.ultimoMs) ? f.ultimoMs : 0 };
}
function rrYaVisto(ficha, id) {
  const x = rrTexto(id);
  return x !== '' && !!ficha && typeof ficha === 'object' && Array.isArray(ficha.ultimosIds) && ficha.ultimosIds.includes(x);
}
function rrRecordarId(f, id) {
  const x = rrTexto(id);
  const ids = (Array.isArray(f.ultimosIds) ? f.ultimosIds : []).slice();
  if (x !== '' && x.length <= 200 && !ids.includes(x)) ids.push(x);
  f.ultimosIds = ids.slice(-RR_TOPE_IDS);
  return f;
}
// Barre el mapa: fuera las de más de 48 h (o sin hora) y, si pasan del tope, las más viejas.
function rrBarrer(mapa, ahoraMs) {
  if (!mapa || typeof mapa !== 'object') return mapa;
  for (const k of Object.keys(mapa)) {
    const u = mapa[k] && Number.isFinite(mapa[k].ultimoMs) ? mapa[k].ultimoMs : 0;
    if (!(u > 0) || ahoraMs - u > RR_OLVIDO_MS) delete mapa[k];
  }
  const claves = Object.keys(mapa);
  if (claves.length > RR_TOPE_FICHAS) {
    claves.sort((a, b) => mapa[a].ultimoMs - mapa[b].ultimoMs);
    for (const k of claves.slice(0, claves.length - RR_TOPE_FICHAS)) delete mapa[k];
  }
  return mapa;
}
