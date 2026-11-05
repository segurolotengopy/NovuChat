// =============================================================================
// REGISTRO DE EVENTOS DEL CHAT (propio del chat de NovuChat) y los PARÁMETROS del módulo común `sesion`
// =============================================================================
// Los ayudantes del estado de la conversación (`ss*`) son el módulo común `comun-sin-agente/src/sesion.js` (paquete `sesion`): aquí solo se declaran sus parámetros para ESTE flujo y lo que depende
// de los nombres de nodo del chat (`cnRegistro`).
const SS_CONFIG = { espacio: 'chat-novuchat', espacioPrueba: 'chat-novuchat-prueba', venceMin: 2880, maxBytes: 15000, prefijo: 'chat', nodoCarga: 'Carga de entrada', nodoBase: 'Config base' };
// Qué quedó comprometido del registro de eventos: recorre los intentos de atrás hacia adelante y toma el último que corrió.
//   { ok, falla, version, ficha, seq } — `ficha` es la que ESE intento propuso (la que el servidor guardó si ok).
const CN_INTENTOS_REGISTRO = [['Comprometer evento (3.º intento)', 'Replanificar registro (2.º)'], ['Comprometer evento (2.º intento)', 'Replanificar registro'], ['Comprometer evento', 'Registrar evento']];
function cnRegistro() {
  // Si una replanificación corrió pero NO armó el pedido (no hay HTTP del intento siguiente), el registro FALLÓ: no se cede con el conflicto del intento anterior.
  for (const par of [['Replanificar registro (2.º)', 'Comprometer evento (3.º intento)'], ['Replanificar registro', 'Comprometer evento (2.º intento)']]) {
    if (cnNodo(par[0]) && !cnNodo(par[1])) return { ok: false, falla: true, version: 0, ficha: null, seq: 0 };
  }
  for (const par of CN_INTENTOS_REGISTRO) {
    if (!cnNodo(par[0])) continue;
    const r = ssResultadoDeCompromiso(cnPrimero(par[0]));
    const prop = cnPrimero(par[1]) || {};
    // Agotados los intentos con conflicto: si el ganador ya trae un evento tan nuevo como el que se quiso registrar (`seq`), otra ejecución lo responderá; esta termina sin enviar (`cede`).
    if (r.resultado === 'conflicto' && prop.ficha && r.ganador && Number(r.ganador.seq) >= Number(prop.ficha.seq)) return { ok: false, falla: false, cede: true, version: 0, ficha: null, seq: 0 };
    if (r.resultado !== 'ok' || !prop.ficha) return { ok: false, falla: true, version: 0, ficha: null, seq: 0 };
    return { ok: true, falla: false, version: r.version, ficha: prop.ficha, seq: prop.seq };
  }
  return { ok: false, falla: false, version: 0, ficha: null, seq: 0 };
}
