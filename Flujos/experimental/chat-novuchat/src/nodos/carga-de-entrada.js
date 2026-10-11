// CARGA DE ENTRADA: deja la entrada en UNA forma, venga de donde venga, y FILTRA los eventos: solo pasan las cargas con `messages`, sin `statuses` y del número esperado
// (`phone_number_id` = `phoneNumberIdEsperado` de «Config base»). Los acuses de estado y los mensajes de otro número se descartan AQUÍ, antes de traer la configuración.
//
// Formas que acepta:
//   1. el disparador de WhatsApp: {messages, metadata, contacts} en la raíz;
//   2. un Webhook: lo mismo dentro de `body`;
//   3. la carga completa de la Cloud API: {entry:[{changes:[{value:{...}}]}]}, en la raíz o dentro de `body`.
//
// EL MODO PRUEBA NO SE LEE DE LA CARGA. Solo lo activa el nodo «Entrada de prueba» (un Webhook que el JSON de producción NO tiene): se pregunta si ese nodo corrió y se
// lee SU cuerpo, con `=== true`. Una carga de WhatsApp con `modoPrueba` adentro —en la raíz, en el mensaje o en un texto— no lo activa jamás.
function cnValorDeMeta(c) {
  if (!c || typeof c !== 'object') return null;
  if (Array.isArray(c.messages) || Array.isArray(c.statuses)) return c;
  const entradas = Array.isArray(c.entry) ? c.entry : [];
  for (const e of entradas) {
    const cambios = e && Array.isArray(e.changes) ? e.changes : [];
    for (const ch of cambios) {
      const v = ch && ch.value;
      if (v && typeof v === 'object' && (Array.isArray(v.messages) || Array.isArray(v.statuses))) return v;
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
    telefonoDePrueba: cnDigitos(b.telefonoDePrueba),
    enviarDeVerdad: b.enviarDeVerdad === true,
  };
}

const ahoraMs = Date.now();
const prueba = cnPrueba();
const esperado = String((cnPrimero('Config base') || {}).phoneNumberIdEsperado || '');
const salida = [];
for (const it of $input.all()) {
  const j = (it && it.json) || {};
  const b = j.body && typeof j.body === 'object' ? j.body : null;
  const v = cnValorDeMeta(j) || cnValorDeMeta(b);
  const metadata = (v && v.metadata) || (j.metadata) || (b && b.metadata) || {};
  const messages = v && Array.isArray(v.messages) ? v.messages : [];
  const statuses = v && Array.isArray(v.statuses) ? v.statuses : [];
  const phoneNumberId = String(metadata.phone_number_id || '');
  // El filtro de eventos: nada de acuses, nada sin mensaje y nada de otro número.
  if (!messages.length || statuses.length || esperado === '' || phoneNumberId !== esperado) continue;
  salida.push({ json: {
    messaging_product: 'whatsapp',
    metadata: metadata,
    contacts: v && Array.isArray(v.contacts) ? v.contacts : [],
    messages: messages,
    statuses: statuses,
    phoneNumberId: phoneNumberId,
    ahoraMs: ahoraMs,
    prueba: prueba,
  } });
}
return salida;
