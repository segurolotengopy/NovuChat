// CARGA DE ENTRADA: deja la entrada en UNA forma, venga de donde venga.
//
// Formas que acepta (en cualquier orden de preferencia):
//   1. el disparador de WhatsApp: {messages, metadata, contacts} en la raiz;
//   2. un Webhook: lo mismo dentro de `body`;
//   3. la carga completa de la Cloud API: {entry:[{changes:[{value:{...}}]}]}, en la
//      raiz o dentro de `body`.
// Un acuse de estado (sin `messages`) sale con `messages: []`: «¿Es un mensaje?»
// lo descarta.
//
// EL MODO PRUEBA NO SE LEE DE LA CARGA. Solo lo activa el nodo «Entrada de prueba»
// (un Webhook que el JSON de produccion NO tiene): se pregunta si ese nodo corrio
// y se lee SU cuerpo, con `=== true`. Una carga de WhatsApp con `modoPrueba`
// adentro —en la raiz, en el mensaje o en un texto— no lo activa jamas, porque
// en produccion `$('Entrada de prueba')` ni siquiera existe.
function cnValorDeMeta(c) {
  if (!c || typeof c !== 'object') return null;
  if (Array.isArray(c.messages)) return c;
  const entradas = Array.isArray(c.entry) ? c.entry : [];
  for (const e of entradas) {
    const cambios = e && Array.isArray(e.changes) ? e.changes : [];
    for (const ch of cambios) {
      const v = ch && ch.value;
      if (v && typeof v === 'object' && Array.isArray(v.messages)) return v;
    }
  }
  return null;
}

function cnPrueba() {
  const w = cnPrimero('Entrada de prueba');
  const b = w && w.body && typeof w.body === 'object' ? w.body : null;
  if (!b || b.modoPrueba !== true) return null;
  return {
    modoPrueba: true,
    calendarioDePrueba: String(b.calendarioDePrueba || '').trim(),
    telefonoDePrueba: cnDigitos(b.telefonoDePrueba),
    enviarDeVerdad: b.enviarDeVerdad === true,
  };
}

const ahoraMs = Date.now();
const prueba = cnPrueba();
const salida = [];
for (const it of $input.all()) {
  const j = (it && it.json) || {};
  const b = j.body && typeof j.body === 'object' ? j.body : null;
  const v = cnValorDeMeta(j) || cnValorDeMeta(b);
  const metadata = (v && v.metadata) || (j.metadata) || (b && b.metadata) || {};
  salida.push({ json: {
    messaging_product: 'whatsapp',
    metadata: metadata,
    contacts: v && Array.isArray(v.contacts) ? v.contacts : [],
    messages: v ? v.messages : [],
    phoneNumberId: String(metadata.phone_number_id || ''),
    ahoraMs: ahoraMs,
    prueba: prueba,
  } });
}
return salida;
