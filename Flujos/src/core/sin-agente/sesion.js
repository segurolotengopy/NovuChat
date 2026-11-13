// =============================================================================
// ESTADO DE LA CONVERSACIÓN EN EL SERVIDOR: AYUDANTES COMUNES DE LOS NODOS CODE (paquete `sesion`; prefijo `ss`)
// =============================================================================
// Contrato: `docs/arquitectura/estado-de-conversacion.md`. Lo INCLUYE el armador del flujo (`@@todo+sesion:...`, `@@comun+sesion:...`); nunca se copia. JavaScript plano: sin `require`, `URL`,
// `Buffer` ni `crypto` (el Code de n8n no los tiene). Aquí NO se llama a la red: solo se arman cuerpos y se leen respuestas; el HTTP lo hacen nodos HTTP del lienzo.
//
// PREFIJO `ss` («sesión»): el de los paquetes comunes no se confunde con `cn` (utilidades de nodo de cada flujo) ni con el `ch`/`vm`/… propio de cada flujo.
//
// PARÁMETROS: el flujo declara UNA constante `SS_CONFIG` en su código común (antes de que corra ningún nodo), por ejemplo el chat de NovuChat:
//     const SS_CONFIG = { espacio: 'chat-novuchat', espacioPrueba: 'chat-novuchat-prueba', venceMin: 2880, maxBytes: 15000, prefijo: 'chat', nodoCarga: 'Carga de entrada', nodoBase: 'Config base' };
//   espacio / espacioPrueba  partición lógica del estado (`^[a-z][a-z0-9-]{0,31}$`): la variante de PRUEBA nunca toca los documentos de producción
//   venceMin                 minutos de vida del estado desde el último compromiso (1 a 4320)
//   maxBytes                 tope del estado en BYTES UTF-8 (el servidor admite 16 KiB: se deja margen)
//   prefijo                  abre el `idCompromiso` (`<prefijo>-<paso>-<ejecución>`)
//   nodoCarga / nodoBase     los nodos que dicen si es una ejecución de prueba y de dónde salen `telefonosDePrueba` y el número esperado
// DEPENDE de `cnNodo`/`cnPrimero` del código común del flujo (leer un nodo por nombre solo si corrió).

// El id de ejecución con la forma que pide el servidor (`/^[A-Za-z0-9_-]{1,64}$/`).
function ssEjecucion(id) {
  const s = String(id === undefined || id === null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return s || 'sin-id';
}
// El teléfono lo valida el servidor con 8 a 15 dígitos; antes de pedir nada se comprueba igual.
function ssTelefonoDeSesion(from) { return /^[0-9]{8,15}$/.test(String(from || '')); }
// Bytes UTF-8 sin `Buffer` ni `TextEncoder` (el Code de n8n no los tiene): cada %XX de encodeURIComponent es un byte.
function ssBytes(t) { return encodeURIComponent(String(t).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')).replace(/%[0-9A-F]{2}/g, 'x').length; }
// ¿Es una ejecución de la variante de prueba? (solo la «Entrada de prueba» la activa; `nodoCarga` lo deja en `prueba`). Sin los nodos (una prueba aislada), producción.
function ssEsPrueba() {
  if (typeof cnPrimero !== 'function') return false;
  const c = cnPrimero(SS_CONFIG.nodoCarga) || {};
  return !!c.prueba && c.prueba.modoPrueba === true;
}
function ssEspacio() { return ssEsPrueba() ? SS_CONFIG.espacioPrueba : SS_CONFIG.espacio; }
// En PRUEBA solo pueden leer y comprometer los teléfonos de `telefonosDePrueba` de `nodoBase`; sin lista, ninguno (ruta sin_estado). En producción, cualquiera.
function ssDesdeAutorizado(from) {
  if (!ssEsPrueba()) return true;
  const lista = String((cnPrimero(SS_CONFIG.nodoBase) || {}).telefonosDePrueba || '').split(',').map((x) => x.replace(/\D/g, '')).filter((x) => x.length >= 6);
  return lista.length > 0 && lista.indexOf(String(from)) >= 0;
}
function ssCuerpoLeer(from, ejecucion) {
  return { telefono: String(from), sesion: { v: 1, accion: 'leer', espacio: ssEspacio(), canal: 'wa', ejecucion: ssEjecucion(ejecucion) } };
}
// `paso` identifica el compromiso dentro de la ejecución (`reg1`, `reg2`, `reg3`, `fin1`, `fin2`, `comp`): reintentar el MISMO paso es idempotente (`repetido`); cada intento lleva el suyo.
function ssIdCompromiso(ejecucion, paso) { return SS_CONFIG.prefijo + '-' + String(paso).replace(/[^A-Za-z0-9]/g, '') + '-' + ssEjecucion(ejecucion); }
// Devuelve el cuerpo, o null si el estado no cabe (nunca se manda algo que el servidor rechazaría con 413).
function ssCuerpoComprometer(from, ejecucion, paso, versionLeida, estado) {
  if (!ssTelefonoDeSesion(from) || !ssDesdeAutorizado(from) || !Number.isInteger(versionLeida) || versionLeida < 0) return null;
  if (estado !== null && (typeof estado !== 'object' || Array.isArray(estado) || ssBytes(JSON.stringify(estado)) > SS_CONFIG.maxBytes)) return null;
  return { telefono: String(from), sesion: { v: 1, accion: 'comprometer', espacio: ssEspacio(), canal: 'wa', ejecucion: ssEjecucion(ejecucion), idCompromiso: ssIdCompromiso(ejecucion, paso), versionLeida: versionLeida, estado: estado, venceEnMin: SS_CONFIG.venceMin } };
}
function ssConversacionValida(c) {
  return !!c && typeof c === 'object' && Number.isInteger(c.version) && c.version >= 0 && (c.estado === null || (typeof c.estado === 'object' && !Array.isArray(c.estado)));
}
// Lo que contestó `leer` (dentro de la respuesta de configuración): { ok, version, estado, vencido, corrupta }. Sin `conversacion` válida o con otro código que 200, ok:false (falla: genérico con botón, §6).
function ssSesionDeLaConfig(codigo, cuerpo) {
  const c = codigo === 200 && cuerpo && typeof cuerpo === 'object' ? cuerpo.conversacion : null;
  if (!ssConversacionValida(c)) return { ok: false, version: 0, estado: null, vencido: false, corrupta: false };
  return { ok: true, version: c.version, estado: c.estado, vencido: c.vencido === true, corrupta: c.corrupta === true };
}
// Lo que contestó un nodo HTTP de `comprometer` (ítem con `statusCode` y `body`; o `{error}` si el nodo falló):
//   { resultado: 'ok' | 'conflicto' | 'falla', version, ganador }.  `repetido` cuenta como ok (ya estaba aplicado). `ganador` = estado ganador (objeto o null) solo en `conflicto`.
// Cualquier otra cosa (5xx, timeout, cupo, datos inválidos, forma rara) es `falla`.
function ssResultadoDeCompromiso(item) {
  const j = item && typeof item === 'object' ? item : {};
  let cuerpo = j.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  if (Number(j.statusCode) !== 200 || !cuerpo || typeof cuerpo !== 'object' || !ssConversacionValida(cuerpo.conversacion)) return { resultado: 'falla', version: 0, ganador: null };
  const conv = cuerpo.conversacion;
  if (cuerpo.resultado === 'comprometido' || cuerpo.resultado === 'repetido') return { resultado: 'ok', version: conv.version, ganador: null };
  if (cuerpo.resultado === 'conflicto_version') return { resultado: 'conflicto', version: conv.version, ganador: conv.estado };
  return { resultado: 'falla', version: 0, ganador: null };
}
// La cabecera `X-NovuChat-Numero` con la MISMA regla que «Traer configuración» del flujo: en modo prueba, el número esperado de `nodoBase`; si no, el del entrante.
function ssNumeroHeader() {
  const carga = cnPrimero(SS_CONFIG.nodoCarga) || {};
  const base = cnPrimero(SS_CONFIG.nodoBase) || {};
  return carga.prueba && carga.prueba.modoPrueba === true ? String(base.phoneNumberIdEsperado || '') : String(carga.phoneNumberId || '');
}
