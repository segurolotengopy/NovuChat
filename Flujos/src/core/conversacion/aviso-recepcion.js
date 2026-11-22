// CORE · CONVERSACIÓN · AVISO A RECEPCIÓN CON EL CLIENTE (prefijo `ap`, 22/11/2026). Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node,
// sin retorno de nivel superior. Se incluye con la misma marca que `baja.js`; nunca se copia a un flujo.
// Qué resuelve (reclamo de Andres): todo aviso a recepción fuera de la ventana de 24 h lleva SIEMPRE el nombre y el teléfono del cliente. Aquí vive, UNA vez, (1) cómo se escribe «quién»
// (`apCliente`) y (2) el selector de la plantilla de aviso a recepción de los flujos cuyo aviso hoy es solo texto libre (`apPlantillaAviso`).
// Privacidad (R2, decisión de Andres del 22/11): esta regla es para recepción y el rol `completo`. El rol `cocina` de Q'Taco sigue recibiendo solo el primer nombre y sin teléfono; esta pieza no
// lo toca (los avisos con rol de `avisos.js` se resuelven allí por rol).
// Costo: 0 mensajes agregados. `apPlantillaAviso` solo arma el contenido de UN mensaje que el flujo ya enviaba (y que sin la ventana abierta se perdía).
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
