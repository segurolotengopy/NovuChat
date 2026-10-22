// =============================================================================
// DR (prefijo `dr`): lo COMÚN a las doctoras del flujo «captación con derivación a recepción» (un código, un archivo de datos por doctora)
// =============================================================================
// UN solo código para las dos doctoras: nada de lo que es de una doctora (nombre, clínica, producto, dirección, horario, textos) vive aquí; todo sale del dato `doctora` de «Config base»
// (`drDatos`). Se pega DELANTE de `_comun.js` y del código de cada nodo, DESPUÉS de `avisos.js` (incluido desde `venta-minima`). JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`, y nada de red.
// Los textos que ve la persona van en párrafos separados por una línea en blanco.
//
// REGLAS QUE ESTA LIBRERÍA HACE CUMPLIR (el prompt NO es una barrera):
//   - el modelo SOLO clasifica y, a lo más, escribe UNA línea de empatía; todo texto de contenido sale fijo del dato de cada doctora;
//   - sin consejo médico, sin diagnóstico, sin precio ni rango del tratamiento, sin promesa de resultado, sin enlaces de mapas;
//   - nunca se niega ser una IA (`drSeguro`); «te escribirá la recepción» solo si el aviso devolvió un `wamid` real.

const DR_OLVIDO_MS = 48 * 60 * 60 * 1000;   // la ficha de un teléfono se olvida a las 48 h sin actividad
const DR_TOPE_FICHAS = 1000;                // n8n graba TODAS las fichas en cada ejecución
const DR_TOPE_IDS = 40;
const DR_MODELO = 'gemini-3.5-flash-lite';   // el ÚNICO modelo de este flujo (decisión de Andres)

// NIEGA_IA (prohibición 4 de CLAUDE.md): ningún texto que ve la persona puede negar que es una IA. COPIA DECLARADA de `RA_NIEGA_IA` de `rroca-antonio/src/lib/ra.js` (a su vez de `CH_NIEGA_IA` de chat-novuchat):
// la expresión es idéntica y una prueba la compara. Se aplica al texto NORMALIZADO (`drNorm`).
const DR_NIEGA_IA = /\bno (?:soy|es|eres|estas hablando con|hablas con)\b[^.!?]{0,20}\b(?:ia|inteligencia|bot|chatbot|robot|maquina|programa|asistente|virtual)\b|\bpersona (?:real|de verdad)\b|\bcarne y hueso\b|\bno (?:contesta|responde|atiende|hay) (?:ningun\w* )?(?:ia|inteligencia|bot|robot|maquina)\b|\bnada de (?:robots?|bots?|maquinas?)\b|\bhumano\b|\bpersonalmente\b|\bconmigo (?:hablas|conversas)\b|\bequipo humano\b|\b(?:soy|es) (?:una )?persona\b|\balguien real\b|\bhuman[oa]s?\b|\b(?:personas?|gente) (?:real(?:es)?|de verdad)\b|\b(?:persona|gente|alguien|humano|equipo|ejecutiv\w*|asesor\w*) (?:real|de verdad)\b|\bde verdad\b[^.!?]{0,20}\b(?:persona|gente|humano)\w*|\bno (?:contesta|responde|atiende|hay|habla) (?:(?:un|una|el|la|ningun\w*) )?(?:ia|inteligencia|bot|chatbot|robot|maquina|programa)\b|\bno es (?:un )?(?:mensaje |chat )?automatic\w*|\b(?:es|soy) (?:una? )?(?:chica|chico|mujer|hombre|senorita|joven)\b/;

// PROTECCIÓN ANTE VIOLENCIA O MIEDO: COPIA DECLARADA de `RA_RIESGO` de `rroca-antonio/src/lib/ra.js` (prueba de igualdad). Texto fijo y breve, sin recursos ni números ni instituciones.
const DR_RIESGO = new RegExp([
  '\\b(violen\\w*|golpe\\w*|golpea\\w*|golpeo\\w*|maltrat\\w*|amenaz\\w*|agred\\w*|agresi\\w*|abus\\w*|acoso|acosa\\w*|femicid\\w*|feminicid\\w*|suicid\\w*)\\b',
  '\\bme (pega|pegan|pego|golpea|golpeo|empuja|empujo|insulta|insulto|humilla|humillo|controla|controlo|persigue|persiguio|encierra|encerro|grita|agrede|maltrata|amenaza|amenazo|obliga|obligo|lastima|lastimo|ahorca|ahorco|patea|patalea|asfixia)\\b',
  '\\b(me quiere|me va a|quiere|va a) (matar|matarme|pegarme|golpearme|lastimarme)\\b',
  '\\b(miedo|temor|terror|pavor) (de|a|por|con) (el|ella|mi pareja|mi esposo|mi esposa|mi marido|mi mujer|mi novio|mi novia|mi expareja|mi ex|que me (haga|pegue|golpee|lastime|mate|haga dano))\\b',
  '\\b(le|lo|la) (tengo|temo|tenemos) (miedo|terror)\\b',
  '\\bme (da|dan) (miedo|terror)\\b (?:el|ella|mi|llegar|volver|estar)',
  '\\b(temo|tengo miedo) por mi (vida|seguridad|integridad)\\b',
  '\\b(no me deja|no me permite) (salir|hablar|trabajar|ver a)\\b',
].join('|'));
function drEsRiesgo(norm) {
  return DR_RIESGO.test(String(norm || ''));
}
const DR_TEXTO_RIESGO = 'Este asistente no atiende ese tipo de consultas.';

// LA BAJA («no me escribas más»): COPIA DECLARADA de la expresión acotada de `Reportar mensaje (entrante)` de `rroca-antonio/flujo.plantilla.json` (prueba de igualdad con el origen). Se aplica al texto
// sin acentos y con los espacios colapsados (`drParaBaja`). Acepta tú, usted y voseo; no marca el relato de un tercero («mi ex no deja de escribirme») ni las quejas («no me llegó»).
const DR_BAJA = /(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?(?:escrib(?:a|as|an|ais|is)|contact(?:e|es|en)|moleste[sn]?)\b|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?llam(?:e|es|en)\b(?! la atencion)|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?(?:mand|envi)(?:e|es|en)\b(?= (?:mas|mensajes|nada mas)\b|\W*$|,? por favor)|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?vuelv(?:a|as|an) a (?:escribir|llamar|contactar|mandar)(?:me|nos)?\b|\bno quiero (?:que (?:me|nos) (?:escrib|contact|mand|llam|molest)(?:a|as|an|e|es|en)\b|recibir (?:mas )?mensajes\b|mas mensajes\b)|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?sig(?:a|as|an) escribiendo\b|(?<!\bno )\bdej(?:a|as|e|es|en|ame|eme|enme)\b(?: me)? de (?:escribir|mandar|molestar|llamar|contactar)(?![^]*\b(?:dice|dijo|dicen)\b)|\b(?:dar|darme|dame|deme|denme) de baja\b(?! (?:el|la|los|las|un|una|mi|mis|a)\b)|(?:^|\s)(?:borr|quit|elimin|saqu)(?:a|e|en)(?:me|nos)(?: de (?:la lista|aqui|sus contactos|tu lista|su lista|esta lista)\b|(?: por favor)?\W*$)|^\W*stop(?: por favor)?\W*$/i;
function drParaBaja(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function drEsBaja(t) {
  return DR_BAJA.test(drParaBaja(t));
}

// Lo que ve la persona cuando manda algo que este canal no lee (sticker, ubicación, contacto, pedido, mensaje no soportado, o un medio sin id): texto cortés fijo, sin modelo.
const DR_TEXTO_CORTES = 'Recibí tu mensaje, pero por este chat solo puedo leer texto, notas de voz, fotos y archivos PDF.\n\nCuéntame por escrito o con una nota de voz en qué te puedo ayudar.';

function drTexto(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}
function drNorm(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// El texto que escribe la persona llega recortado en el borde y sin caracteres de control.
function drLineaCliente(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);
}

// -----------------------------------------------------------------------------
// La ficha de un teléfono (48 h): lo que recuerda el flujo de ESTE teléfono y de ningún otro. NO guarda lo que la persona escribió (ni texto clínico): solo el avance y las banderas.
//   saludado (ya se presentó), etapa, usados (los toques que ya pulsó: no reaparecen), consentimiento ('' | 'si' | 'no'), nombre, interes (tratamiento), contacto, horario (se borran al derivar),
//   riesgo, baja (cero mensajes), avisosConsulta (límite de 30 min por motivo), modeloN (llamadas al modelo del turno actual no se guardan; solo cuántas respuestas con empatía).
// -----------------------------------------------------------------------------
function drFichaBase() {
  return { v: 1, ultimoMs: 0, ultimosIds: [], turnos: 0, saludado: false, etapa: 'inicio', usados: [], consentimiento: '', nombre: '', interes: '', contacto: '', horario: '', arte: '', riesgo: false, baja: false, derivado: false, avisosConsulta: {} };
}
// La ficha vigente de un teléfono: si pasó el olvido, es una ficha nueva.
function drFichaVigente(e, ahoraMs) {
  const base = drFichaBase();
  if (!e || typeof e !== 'object' || Array.isArray(e)) return base;
  const ultimo = Number.isFinite(e.ultimoMs) && e.ultimoMs > 0 ? e.ultimoMs : 0;
  if (ultimo && ahoraMs - ultimo > DR_OLVIDO_MS) return base;
  const corto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').trim().slice(0, max) : '');
  const aviso = {};
  if (e.avisosConsulta && typeof e.avisosConsulta === 'object' && !Array.isArray(e.avisosConsulta)) {
    for (const k of Object.keys(e.avisosConsulta)) if (/^[a-z_]{1,30}$/.test(k) && Number.isFinite(e.avisosConsulta[k]) && e.avisosConsulta[k] > 0) aviso[k] = e.avisosConsulta[k];
  }
  return {
    v: 1,
    ultimoMs: ultimo,
    ultimosIds: (Array.isArray(e.ultimosIds) ? e.ultimosIds : []).filter((x) => typeof x === 'string' && x !== '' && x.length <= 200).slice(-DR_TOPE_IDS),
    turnos: Number.isFinite(e.turnos) && e.turnos > 0 ? Math.floor(e.turnos) : 0,
    saludado: e.saludado === true,
    etapa: ['inicio', 'catalogo', 'consulta', 'consentimiento', 'nombre', 'contacto', 'contacto_otro', 'horario', 'derivado'].indexOf(e.etapa) >= 0 ? e.etapa : 'inicio',
    usados: (Array.isArray(e.usados) ? e.usados : []).filter((x) => typeof x === 'string' && /^[a-z]_[a-z0-9]{1,16}$/.test(x)).slice(-20),
    consentimiento: e.consentimiento === 'si' || e.consentimiento === 'no' ? e.consentimiento : '',
    nombre: corto(e.nombre, 60),
    interes: /^[a-z0-9]{1,16}$/.test(String(e.interes || '')) ? String(e.interes) : '',
    contacto: /^\d{8,15}$/.test(String(e.contacto || '')) ? String(e.contacto) : '',
    horario: corto(e.horario, 100),
    arte: /^[a-z0-9]{1,16}$/.test(String(e.arte || '')) ? String(e.arte) : '',
    riesgo: e.riesgo === true,
    baja: e.baja === true,
    derivado: e.derivado === true,
    avisosConsulta: aviso,
  };
}
function drYaVisto(ficha, id) {
  const x = drTexto(id);
  return x !== '' && !!ficha && typeof ficha === 'object' && Array.isArray(ficha.ultimosIds) && ficha.ultimosIds.includes(x);
}
function drRecordarIds(f, ids) {
  const x = (Array.isArray(f.ultimosIds) ? f.ultimosIds : []).slice();
  for (const id of ids) if (typeof id === 'string' && id !== '' && id.length <= 200 && !x.includes(id)) x.push(id);
  f.ultimosIds = x.slice(-DR_TOPE_IDS);
  return f;
}
// Barre el mapa: fuera las de más de 48 h (o sin hora) y, si pasan del tope, las más viejas.
function drBarrer(mapa, ahoraMs) {
  if (!mapa || typeof mapa !== 'object') return mapa;
  for (const k of Object.keys(mapa)) {
    const u = mapa[k] && Number.isFinite(mapa[k].ultimoMs) ? mapa[k].ultimoMs : 0;
    if (!(u > 0) || ahoraMs - u > DR_OLVIDO_MS) delete mapa[k];
  }
  const claves = Object.keys(mapa);
  if (claves.length > DR_TOPE_FICHAS) {
    claves.sort((a, b) => mapa[a].ultimoMs - mapa[b].ultimoMs);
    for (const k of claves.slice(0, claves.length - DR_TOPE_FICHAS)) delete mapa[k];
  }
  return mapa;
}

// -----------------------------------------------------------------------------
// LOS DATOS DE LA DOCTORA: «Config base» trae el bloque `doctora` como UN texto JSON (lo arma `construir.mjs` desde el archivo de datos del tenant). Un dato ilegible deja el bloque vacío:
// el flujo no inventa nada de la doctora. Un valor de texto con un marcador `REEMPLAZAR_` cuenta como VACÍO (`drDatoLleno`): nunca se dice a la persona.
// -----------------------------------------------------------------------------
function drDatoLleno(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s !== '' && !/reemplazar_/i.test(s) ? s : '';
}
function drDatos(base) {
  let d = base && typeof base === 'object' ? base.doctora : null;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}
