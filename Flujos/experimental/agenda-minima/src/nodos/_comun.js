// =============================================================================
// UTILIDADES COMUNES DE LOS NODOS DE «AGENDA MINIMA v0» (prefijo `cn` / `CN_`)
// =============================================================================
// El constructor las pega entre la libreria de agenda y el codigo de cada nodo
// (salvo en los nodos marcados «@@solo:»). Son JavaScript plano: sin `require`,
// sin `URL`, `Buffer` ni `crypto`, y nada de red. Lo que lee de otros nodos lo
// lee POR NOMBRE y solo si corrieron (`isExecuted`): un nodo que no corrio no
// se lee con `$('X').item`, y un nodo de envio o de reporte desactivado deja
// pasar su entrada, asi que nada de aca depende de lo que ellos devuelvan.

const CN_VENCE_MS = 30 * 60 * 1000;
const CN_SERVICIOS = ['control_recien_nacido', 'control_nino_sano'];
const CN_NOMBRE_SERVICIO = {
  control_recien_nacido: 'control del recién nacido',
  control_nino_sano: 'control del niño sano',
};

// El nodo `nombre` si existe Y corrio en esta ejecucion; si no, null. En un JSON
// que no lo trae (el de produccion no tiene «Entrada de prueba») `$()` lanza.
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

function cnNorm(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function cnDigitos(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
}
function cnRecorte(t, max) {
  const s = String(t === undefined || t === null ? '' : t);
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
// Una lista «a|b|c» de la configuracion a una regex que no cae en un patron de usuario.
function cnRegexDeLista(lista) {
  const partes = String(lista || '').split('|').map((p) => cnNorm(p)).filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()[\]\\]/g, '\\$&'));
  return partes.length ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + partes.join('|') + ')', 'iu') : null;
}

// El texto de una respuesta de Gemini (generateContent, o el nodo de LangChain con
// `simplify`). '' si vino un error o algo que no se reconoce.
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
// El objeto JSON que Gemini devolvio como texto; null si no es un objeto.
function cnJsonDeGemini(j) {
  const t = cnTextoDeGemini(j).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!t) return null;
  try {
    const o = JSON.parse(t);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// El estado por telefono (CONTRATO §4). Se LEE aca y se ESCRIBE en un solo lugar,
// al final del turno (`Armar mensajes`).
// ---------------------------------------------------------------------------
function cnEstadoBase() {
  return {
    paso: 'inicio', servicio: null, hermanos: false, huecoElegido: null, moverId: null,
    ultimaOferta: [], ultimoMensajeMs: 0,
    // Agregados al contrato: lo que no cabe en el id de un boton y hay que
    // recordar entre dos mensajes.
    pacientes: [], moverInicio: null, moverTitulo: '', primerTexto: '', ultimoMensajeId: '', pidioSegundoNombre: false,
  };
}
function cnClaveValida(from) {
  return /^\d{6,20}$/.test(String(from || ''));
}
// Un estado vencido (30 minutos) es `inicio`. Sin datos estaticos, tambien.
function cnLeerEstado(from, ahoraMs) {
  const base = cnEstadoBase();
  if (!cnClaveValida(from)) return base;
  let sd = null;
  try { sd = $getWorkflowStaticData('global'); } catch (e) { sd = null; }
  const mapa = sd && sd.agendaMinima && typeof sd.agendaMinima === 'object' ? sd.agendaMinima : null;
  if (!mapa || !Object.prototype.hasOwnProperty.call(mapa, from)) return base;
  const e = mapa[from];
  if (!e || typeof e !== 'object' || !(ahoraMs - Number(e.ultimoMensajeMs || 0) < CN_VENCE_MS)) return base;
  return Object.assign(base, e);
}

// La atencion del telefono: lo que devolvio la ingesta del entrante si lo trae, y si
// no, lo que dijo `configuracionFlujo`. Ante la duda, normal.
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
    respuestas: Number((a && a.respuestasEnVentana) !== undefined ? a.respuestasEnVentana : cfg.atencionRespuestas) || 0,
    venceEn: String((a && a.ventanaVenceEn) || cfg.atencionVenceEn || ''),
  };
}
