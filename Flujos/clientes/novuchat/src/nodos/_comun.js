// =============================================================================
// UTILIDADES COMUNES DE LOS NODOS DE «CHAT NOVUCHAT v2» (prefijo `cn`)
// =============================================================================
// El constructor las pega entre la librería (`chat.js`, y las `cm*` en los nodos que las piden) y el código de cada nodo. JavaScript plano: sin `require`, `URL`,
// `Buffer` ni `crypto`, y nada de red. Lo que se lee de otro nodo se lee POR NOMBRE y solo si corrió (`isExecuted`): un nodo que no corrió no se lee con `.item`.
// Ningún nodo lee por nombre algo que corre más de una vez en la ejecución (no hay ciclos): `first()` es siempre «el único».

// El nodo `nombre` si existe Y corrió en esta ejecución; si no, null. En un JSON que no lo trae (el de producción no tiene «Entrada de prueba») `$()` lanza.
function cnNodo(nombre) {
  try {
    const n = $(nombre);
    return n && n.isExecuted ? n : null;
  } catch (e) {
    return null;
  }
}
function cnPrimero(nombre) {
  const n = cnNodo(nombre);
  if (!n) return null;
  try {
    const i = n.first();
    return i && i.json ? i.json : null;
  } catch (e) {
    return null;
  }
}
function cnTodos(nombre) {
  const n = cnNodo(nombre);
  if (!n) return [];
  try {
    return n.all().map((i) => (i && i.json) || {});
  } catch (e) {
    return [];
  }
}
function cnCfg() {
  return cnPrimero('Config del negocio') || {};
}
function cnDigitos(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
}
function cnRecorte(t, max) {
  const s = String(t === undefined || t === null ? '' : t);
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
// El texto de una respuesta de Gemini (generateContent, o el nodo de LangChain con `simplify`). '' si vino un error o algo que no se reconoce.
function cnTextoDeGemini(j) {
  if (!j || typeof j !== 'object' || j.error) return '';
  const partes = (c) => (c && Array.isArray(c.parts))
    ? c.parts.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n') : '';
  if (typeof j.content === 'string') return j.content;
  const c1 = partes(j.content);
  if (c1) return c1;
  const cand = Array.isArray(j.candidates) ? j.candidates[0] : null;
  const c2 = cand ? partes(cand.content) : '';
  if (c2) return c2;
  for (const k of ['text', 'transcription', 'output', 'response']) {
    if (typeof j[k] === 'string' && j[k].trim()) return j[k];
  }
  return '';
}
// El objeto JSON que Gemini devolvió como texto; null si no es un objeto.
function cnJsonDeGemini(j) {
  const t = cnTextoDeGemini(j).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!t) return null;
  const m = /\{[\s\S]*\}/.exec(t);
  try {
    const o = JSON.parse(m ? m[0] : t);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch (e) {
    return null;
  }
}
// La clave de la ficha es el teléfono de origen y solo dígitos: nunca un nombre que toque el prototipo.
function cnClaveValida(from) {
  return /^\d{6,20}$/.test(String(from || ''));
}
// Las fichas de los teléfonos (`staticData.global.chatNovuchat`). Un nodo que SOLO LEE no escribe nada en los datos estáticos. Los que escriben (con `escribir` verdadero)
// además borran lo que dejaron los flujos anteriores de este mismo workflow (`captacionMinima`, `conversaciones`, `vistos`: datos de prospectos que este flujo no lee).
function cnMapaDeFichas(escribir) {
  let sd = null;
  try { sd = $getWorkflowStaticData('global'); } catch (e) { sd = null; }
  if (!sd) return { sd: null, mapa: {} };
  const valido = sd.chatNovuchat && typeof sd.chatNovuchat === 'object' && !Array.isArray(sd.chatNovuchat);
  if (!valido) {
    if (escribir !== true) return { sd: sd, mapa: {} };
    sd.chatNovuchat = {};
  }
  if (escribir === true) { delete sd.captacionMinima; delete sd.conversaciones; delete sd.vistos; }
  return { sd: sd, mapa: sd.chatNovuchat };
}
function cnFichaDe(mapa, from) {
  return cnClaveValida(from) && Object.prototype.hasOwnProperty.call(mapa, from) ? mapa[from] : null;
}
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// LA CAMPAÑA SALIENTE: el «No» escrito, las cortesías y el silencio tras el «No» (E4, E8 del plan de correcciones del #1140).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// El «no» ESCRITO se normaliza IGUAL que en el servidor (`esNoEscritoDeCampana`, `bajas.ts`): NFD, sin tildes, minúsculas, la coma pasa a espacio, se quitan «.» y «!» finales y se colapsan los espacios.
// Tiene que quedar EXACTAMENTE «no» o «no gracias». Nada más cuenta («no me interesa», «no sé», «no quiero»): ante la duda, conversación normal.
function cnNoEscritoDeCampana(texto) {
  const s = String(texto === undefined || texto === null ? '' : texto).slice(0, 200).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\s.!]+$/, '').replace(/\s+/g, ' ').trim();
  return s === 'no' || s === 'no gracias';
}
// Las cortesías cortas que NO reabren la conversación tras el «No» (lista CERRADA): se quitan la puntuación, los signos de apertura y los acentos; los emojis 👍 y 🙏 (con su tono de piel) cuentan solos.
const CN_CORTESIAS = ['ok', 'okey', 'okay', 'vale', 'gracias', 'muchas gracias', 'listo', 'entendido', 'perfecto', 'dale', 'de acuerdo', 'bien', 'bueno', 'genial', 'excelente', 'ok gracias', 'vale gracias', 'gracias ok', 'ok listo', 'ok entendido'];
function cnCortesiaCorta(texto) {
  const crudo = String(texto === undefined || texto === null ? '' : texto).slice(0, 200);
  const solo = crudo.replace(/[\u{1F3FB}-\u{1F3FF}️\s]/gu, '');
  if (solo !== '' && /^[\u{1F44D}\u{1F64F}]+$/u.test(solo)) return true;
  const s = crudo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,!¡?¿…]/g, ' ').replace(/\s+/g, ' ').trim();
  return CN_CORTESIAS.indexOf(s) >= 0;
}
// La marca `campanaNoMs` de la ficha (el instante del «No», ya con su vencimiento de 24 h en `chFichaVigente`): `rafaga` = dentro de los 120 s en que TODO cae en silencio.
const CN_CAMPANA_RAFAGA_MS = 120 * 1000; // tras el «No»: 120 s en que NADA se responde (la ráfaga del «No» y lo que se escriba enseguida)
function cnMarcaCampanaNo(ficha, ahoraMs) {
  const ms = ficha && Number.isFinite(ficha.campanaNoMs) ? ficha.campanaNoMs : 0;
  if (!(ms > 0)) return { activa: false, rafaga: false, ms: 0 };
  const edad = Number(ahoraMs) - ms;
  if (edad > CH_VENTANA_MS) return { activa: false, rafaga: false, ms: 0 };
  return { activa: true, rafaga: edad <= CN_CAMPANA_RAFAGA_MS, ms: ms };
}
// ¿Cae en silencio TODO lo que llegó? `escritos`: un elemento por mensaje; el texto que escribió el cliente, o null si no es un texto escrito (audio, imagen, un toque). Sin marca: nunca.
// Dentro de la ráfaga (120 s) todo es silencio. Pasada la ráfaga y hasta las 24 h: solo las cortesías cortas y un «no» / «no gracias» repetido; cualquier otra cosa es una intención clara (conversación normal).
function cnSilencioPorCampana(ficha, ahoraMs, escritos) {
  const m = cnMarcaCampanaNo(ficha, ahoraMs);
  if (!m.activa || !Array.isArray(escritos) || escritos.length === 0) return false;
  if (m.rafaga) return true;
  return escritos.every((x) => typeof x === 'string' && (cnNoEscritoDeCampana(x) || cnCortesiaCorta(x)));
}
// La atención del teléfono: lo que devolvió la ingesta del entrante si lo trae, y si no, lo que dijo `configuracionFlujo`. Ante la duda, normal.
function cnAtencion(rIngesta, cfg) {
  const a = rIngesta && typeof rIngesta === 'object' && rIngesta.atencion && typeof rIngesta.atencion === 'object'
    ? rIngesta.atencion : null;
  const estados = ['normal', 'operador', 'bloqueado'];
  const estado = a && estados.indexOf(a.estado) >= 0 ? a.estado
    : (estados.indexOf(cfg.atencionEstado) >= 0 ? cfg.atencionEstado : 'normal');
  const avisarIngesta = rIngesta && typeof rIngesta === 'object' ? rIngesta.avisarRecepcion : '';
  const avisarCfg = a && a.avisarRecepcion !== undefined ? a.avisarRecepcion : cfg.atencionAvisarRecepcion;
  const avisar = ['operador', 'bloqueado'].indexOf(avisarIngesta || avisarCfg) >= 0 ? (avisarIngesta || avisarCfg) : '';
  return {
    estado: estado,
    avisar: avisar,
    mensajeFijo: String((a && a.mensajeFijo) || cfg.atencionMensajeFijo || '').trim(),
    respuestas: Number(a && a.respuestasEnVentana !== undefined ? a.respuestasEnVentana : cfg.atencionRespuestas) || 0,
    venceEn: String((a && a.ventanaVenceEn) || cfg.atencionVenceEn || ''),
  };
}
