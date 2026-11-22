// CORE · CONVERSACIÓN · AVISO A RECEPCIÓN CON EL CLIENTE (prefijo `ap`, 22/11/2026). Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node,
// sin retorno de nivel superior. Se incluye con la misma marca que `baja.js`; nunca se copia a un flujo.
// Qué resuelve (reclamo de Andres): todo aviso a recepción fuera de la ventana de 24 h lleva SIEMPRE el nombre y el teléfono del cliente. Aquí vive, UNA vez, (1) cómo se escribe «quién»
// (`apCliente`) y (2) el selector de la plantilla de aviso a recepción de los flujos cuyo aviso hoy es solo texto libre (`apPlantillaAviso`).
// Privacidad (R2, decisión de Andres del 22/11): esta regla es para recepción y el rol `completo`. El rol `cocina` de Q'Taco sigue recibiendo solo el primer nombre y sin teléfono; esta pieza no
// lo toca (los avisos con rol de `avisos.js` se resuelven allí por rol).
// Costo: 0 mensajes agregados por conversación al cliente final. Con la plantilla APPROVED, 1 plantilla (UTILITY) por aviso cuando la ventana de 24 h de recepción está cerrada o es desconocida (hoy ese aviso se pierde:
// Meta acepta el texto con 200 y lo rechaza después por el webhook de estados); con la ventana abierta sale el texto de siempre, sin plantilla.
//
// Plantilla de aviso a recepción (UTILITY): {{1}} nombre del cliente, {{2}} su teléfono con «+», {{3}} el motivo. El nombre y el idioma NO tienen valor por omisión en el código: salen de la
// configuración del negocio (`plantillaAvisoRecepcion`, `plantillaAvisoRecepcionEstado`, `plantillaAvisoRecepcionIdioma`, por defecto `es`). Solo con estado APPROVED sale la plantilla; sin
// eso el selector devuelve `null` y el flujo se comporta exactamente como antes.

/** Un texto para una variable de plantilla: una sola línea, sin tabuladores ni 4 espacios seguidos, con tope y nunca vacío («—»). */
function apParametro(t, max) {
  const s = String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tope = max === undefined ? 500 : max;
  return (Array.from(s).slice(0, tope).join('').trim()) || '—';
}

/** Solo los dígitos de un teléfono (nunca el «+» ni los espacios). */
function apDigitos(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
}

/** El nombre del cliente en una línea y con tope; «sin nombre» si falta. */
function apNombre(nombre) {
  const s = String(nombre === undefined || nombre === null ? '' : nombre).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 60).join('').trim() || 'sin nombre';
}

/** «quién» en un aviso: «Nombre (+591…)». Sin teléfono utilizable, solo el nombre; sin nombre, «sin nombre». */
function apCliente(nombre, telefono) {
  const tel = apDigitos(telefono);
  return apNombre(nombre) + (tel.length >= 8 && tel.length <= 15 ? ' (+' + tel + ')' : '');
}

/** ¿La configuración trae la plantilla de aviso a recepción con estado APPROVED? Devuelve `{nombre, idioma}` o `null`. */
function apConfigPlantilla(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const nombre = String(c.plantillaAvisoRecepcion === undefined || c.plantillaAvisoRecepcion === null ? '' : c.plantillaAvisoRecepcion).trim();
  const estado = String(c.plantillaAvisoRecepcionEstado === undefined || c.plantillaAvisoRecepcionEstado === null ? '' : c.plantillaAvisoRecepcionEstado).trim().toUpperCase();
  if (!/^[a-z0-9_]{1,512}$/.test(nombre) || estado !== 'APPROVED') return null;
  const idioma = String(c.plantillaAvisoRecepcionIdioma === undefined || c.plantillaAvisoRecepcionIdioma === null ? '' : c.plantillaAvisoRecepcionIdioma).trim();
  return { nombre: nombre, idioma: /^[a-z]{2}(_[A-Z]{2})?$/.test(idioma) ? idioma : 'es' };
}

/**
 * El payload de la plantilla de aviso a recepción (`type: template`, `to` vacío: lo pone quien envía) o `null` si no está APPROVED.
 * {{1}} nombre (hasta 60), {{2}} «+<teléfono>», {{3}} motivo (hasta 200). Nunca lleva saltos de línea.
 */
function apPlantillaAviso(cfg, nombre, telefono, motivo) {
  const pl = apConfigPlantilla(cfg);
  if (!pl) return null;
  const tel = apDigitos(telefono);
  const vars = [apNombre(nombre), tel ? '+' + tel : '—', apParametro(motivo || 'no especificado', 200)];
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '', type: 'template',
    template: { name: pl.nombre, language: { code: pl.idioma }, components: [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: v })) }] },
  };
}

// ---- La ventana de 24 h de recepción: se elige texto o plantilla ANTES de enviar (patrón de `avAnotarEntrante` / `sd.av.ventana` de `avisos.js`). Meta acepta un texto fuera de ventana con 200 y avisa el rechazo
// (131047) después por el webhook de estados: el error de Graph NO sirve de respaldo. Ventana desconocida (nunca escribió) = cerrada.
const AP_VENTANA_MS = 23.5 * 60 * 60 * 1000; // 23 h 30 min

/** ¿Escribió `tel` (recepción) hace menos de 23 h 30 min? Solo lee `sd.av.ventana`. */
function apVentanaAbierta(sd, tel, ahoraMs) {
  const av = sd && sd.av;
  const ult = av && av.ventana ? av.ventana[apDigitos(tel)] : undefined;
  if (typeof ult !== 'number' || !Number.isFinite(ult) || !Number.isFinite(ahoraMs)) return false;
  const d = ahoraMs - ult;
  return d >= -300000 && d < AP_VENTANA_MS;
}

/** Anota que `tel` escribió ahora (nunca hacia atrás) en `sd.av.ventana`; acota el tamaño. */
function apAnotarEntrante(sd, tel, ahoraMs) {
  const t = apDigitos(tel);
  if (!sd || typeof sd !== 'object' || !t || !Number.isFinite(ahoraMs)) return false;
  if (!sd.av || typeof sd.av !== 'object') sd.av = {};
  if (!sd.av.ventana || typeof sd.av.ventana !== 'object') sd.av.ventana = {};
  const v = sd.av.ventana;
  v[t] = Math.max(typeof v[t] === 'number' ? v[t] : 0, ahoraMs);
  for (const k of Object.keys(v)) {
    if (typeof v[k] !== 'number' || ahoraMs - v[k] > 25 * 60 * 60 * 1000) delete v[k];
  }
  const resto = Object.keys(v);
  if (resto.length > 50) {
    resto.sort((a, b) => v[a] - v[b]);
    for (const k of resto.slice(0, resto.length - 50)) delete v[k];
  }
  return true;
}

/**
 * El selector: la plantilla (payload `template`, `to` vacío) SOLO si está APPROVED y la ventana de `recepcion` no está abierta; si no, `null` y el flujo manda el texto de siempre.
 * Sin plantilla APPROVED nunca devuelve nada (todo queda idéntico a antes).
 */
function apElegirPlantilla(cfg, sd, recepcion, ahoraMs, nombre, telefono, motivo) {
  if (!apConfigPlantilla(cfg)) return null;
  if (apVentanaAbierta(sd, recepcion, ahoraMs)) return null;
  return apPlantillaAviso(cfg, nombre, telefono, motivo);
}
