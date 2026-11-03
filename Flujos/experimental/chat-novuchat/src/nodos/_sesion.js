// =============================================================================
// AYUDANTES DEL ESTADO DE LA CONVERSACIÓN EN EL SERVIDOR (PR-4c1; prefijo `cn`; todavía NO incluidos en ningún nodo)
// =============================================================================
// Contrato: `docs/arquitectura/estado-de-conversacion.md`. Las pega el constructor en los nodos que las pidan (PR-4c2). JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`.
// Aquí NO se llama a la red: solo se arman cuerpos y se leen respuestas. El HTTP lo hacen nodos HTTP del lienzo.
const CN_ESPACIO = 'chat-novuchat';
const CN_ESPACIO_PRUEBA = 'chat-novuchat-prueba'; // la variante de PRUEBA nunca toca los documentos de producción
const CN_VENCE_MIN = 2880; // 48 h: el olvido de la ficha (CH_OLVIDO_MS)
const CN_MAX_ESTADO = 15000; // el servidor admite 16 KiB; se deja margen

// El id de ejecución con la forma que pide el servidor (`/^[A-Za-z0-9_-]{1,64}$/`).
function cnEjecucion(id) {
  const s = String(id === undefined || id === null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return s || 'sin-id';
}
// El teléfono lo valida el servidor con 8 a 15 dígitos; antes de pedir nada se comprueba igual.
function cnTelefonoDeSesion(from) { return /^[0-9]{8,15}$/.test(String(from || '')); }
// Bytes UTF-8 sin `Buffer` ni `TextEncoder` (el Code de n8n no los tiene): cada %XX de encodeURIComponent es un byte.
function cnBytes(t) { return encodeURIComponent(String(t)).replace(/%[0-9A-F]{2}/g, 'x').length; }
// ¿Es una ejecución de la variante de prueba? (solo la «Entrada de prueba» la activa; `Carga de entrada` lo deja en `prueba`). Sin los nodos (una prueba aislada), producción.
function cnEsPrueba() {
  if (typeof cnPrimero !== 'function') return false;
  const c = cnPrimero('Carga de entrada') || {};
  return !!c.prueba && c.prueba.modoPrueba === true;
}
function cnEspacio() { return cnEsPrueba() ? CN_ESPACIO_PRUEBA : CN_ESPACIO; }
// En PRUEBA solo pueden leer y comprometer los teléfonos de `telefonosDePrueba` de «Config base»; sin lista, ninguno (ruta sin_estado). En producción, cualquiera.
function cnDesdeAutorizado(from) {
  if (!cnEsPrueba()) return true;
  const lista = String((cnPrimero('Config base') || {}).telefonosDePrueba || '').split(',').map((x) => x.replace(/\D/g, '')).filter((x) => x.length >= 6);
  return lista.length > 0 && lista.indexOf(String(from)) >= 0;
}
function cnCuerpoLeer(from, ejecucion) {
  return { telefono: String(from), sesion: { v: 1, accion: 'leer', espacio: cnEspacio(), canal: 'wa', ejecucion: cnEjecucion(ejecucion) } };
}
// `paso` identifica el compromiso dentro de la ejecución (`reg1`, `reg2`, `reg3`, `fin1`, `fin2`, `comp`): reintentar el MISMO paso es idempotente (`repetido`); cada intento lleva el suyo.
function cnIdCompromiso(ejecucion, paso) { return 'chat-' + String(paso).replace(/[^A-Za-z0-9]/g, '') + '-' + cnEjecucion(ejecucion); }
// Devuelve el cuerpo, o null si el estado no cabe (nunca se manda algo que el servidor rechazaría con 413).
function cnCuerpoComprometer(from, ejecucion, paso, versionLeida, estado) {
  if (!cnTelefonoDeSesion(from) || !cnDesdeAutorizado(from) || !Number.isInteger(versionLeida) || versionLeida < 0) return null;
  if (estado !== null && (typeof estado !== 'object' || Array.isArray(estado) || cnBytes(JSON.stringify(estado)) > CN_MAX_ESTADO)) return null;
  return { telefono: String(from), sesion: { v: 1, accion: 'comprometer', espacio: cnEspacio(), canal: 'wa', ejecucion: cnEjecucion(ejecucion), idCompromiso: cnIdCompromiso(ejecucion, paso), versionLeida: versionLeida, estado: estado, venceEnMin: CN_VENCE_MIN } };
}
function cnConversacionValida(c) {
  return !!c && typeof c === 'object' && Number.isInteger(c.version) && c.version >= 0 && (c.estado === null || (typeof c.estado === 'object' && !Array.isArray(c.estado)));
}
// Lo que contestó `leer` (dentro de la respuesta de configuración): { ok, version, estado, vencido, corrupta }. Sin `conversacion` válida o con otro código que 200, ok:false (falla: genérico con botón, §6).
function cnSesionDeLaConfig(codigo, cuerpo) {
  const c = codigo === 200 && cuerpo && typeof cuerpo === 'object' ? cuerpo.conversacion : null;
  if (!cnConversacionValida(c)) return { ok: false, version: 0, estado: null, vencido: false, corrupta: false };
  return { ok: true, version: c.version, estado: c.estado, vencido: c.vencido === true, corrupta: c.corrupta === true };
}
// Lo que contestó un nodo HTTP de `comprometer` (ítem con `statusCode` y `body`; o `{error}` si el nodo falló):
//   { resultado: 'ok' | 'conflicto' | 'falla', version, ganador }.  `repetido` cuenta como ok (ya estaba aplicado). `ganador` = estado ganador (objeto o null) solo en `conflicto`.
// Cualquier otra cosa (5xx, timeout, cupo, datos inválidos, forma rara) es `falla`.
function cnResultadoDeCompromiso(item) {
  const j = item && typeof item === 'object' ? item : {};
  let cuerpo = j.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  if (Number(j.statusCode) !== 200 || !cuerpo || typeof cuerpo !== 'object' || !cnConversacionValida(cuerpo.conversacion)) return { resultado: 'falla', version: 0, ganador: null };
  const conv = cuerpo.conversacion;
  if (cuerpo.resultado === 'comprometido' || cuerpo.resultado === 'repetido') return { resultado: 'ok', version: conv.version, ganador: null };
  if (cuerpo.resultado === 'conflicto_version') return { resultado: 'conflicto', version: conv.version, ganador: conv.estado };
  return { resultado: 'falla', version: 0, ganador: null };
}
// La cabecera `X-NovuChat-Numero` con la MISMA regla que «Traer configuración»: en modo prueba, el número esperado de «Config base»; si no, el del entrante.
function cnNumeroHeader() {
  const carga = cnPrimero('Carga de entrada') || {};
  const base = cnPrimero('Config base') || {};
  return carga.prueba && carga.prueba.modoPrueba === true ? String(base.phoneNumberIdEsperado || '') : String(carga.phoneNumberId || '');
}
// Qué quedó comprometido del registro de eventos: recorre los intentos de atrás hacia adelante y toma el último que corrió.
//   { ok, falla, version, ficha, seq } — `ficha` es la que ESE intento propuso (la que el servidor guardó si ok).
const CN_INTENTOS_REGISTRO = [['Comprometer evento (3.º intento)', 'Replanificar registro (2.º)'], ['Comprometer evento (2.º intento)', 'Replanificar registro'], ['Comprometer evento', 'Registrar evento']];
function cnRegistro() {
  for (const par of CN_INTENTOS_REGISTRO) {
    if (!cnNodo(par[0])) continue;
    const r = cnResultadoDeCompromiso(cnPrimero(par[0]));
    const prop = cnPrimero(par[1]) || {};
    // Agotados los intentos con conflicto: si el ganador ya trae un evento tan nuevo como el que se quiso registrar (`seq`), otra ejecución lo responderá; esta termina sin enviar (`cede`).
    if (r.resultado === 'conflicto' && prop.ficha && r.ganador && Number(r.ganador.seq) >= Number(prop.ficha.seq)) return { ok: false, falla: false, cede: true, version: 0, ficha: null, seq: 0 };
    if (r.resultado !== 'ok' || !prop.ficha) return { ok: false, falla: true, version: 0, ficha: null, seq: 0 };
    return { ok: true, falla: false, version: r.version, ficha: prop.ficha, seq: prop.seq };
  }
  return { ok: false, falla: false, version: 0, ficha: null, seq: 0 };
}
