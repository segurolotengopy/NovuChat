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
