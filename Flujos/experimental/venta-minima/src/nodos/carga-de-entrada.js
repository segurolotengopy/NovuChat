// CARGA DE ENTRADA: deja la entrada en UNA forma, venga de donde venga.
//
// Formas que acepta:
//   1. el disparador de WhatsApp: {messages, metadata, contacts} en la raiz;
//   2. el `body` de la «Entrada de prueba» (o de cualquier Webhook): lo mismo dentro de `body`;
//   3. la carga completa de la Cloud API: {entry:[{changes:[{value:{...}}]}]}, en la raiz o
//      dentro de `body`;
//   4. la del receptor: si CORRIO «Entrega del receptor», el evento es su `body.value`, y si
//      `body.field` viene, tiene que ser `messages` (otro campo —un cambio de plantilla, de
//      calidad— no es un mensaje). Ese nodo manda sobre las otras tres: lo que pasa por
//      «Verificar firma con el receptor» ya no es el evento sino su veredicto.
// Un acuse de estado (sin `messages`) sale con `messages: []`: «¿Es un mensaje?» lo descarta.
//
// EL MODO PRUEBA NO SE LEE DE LA CARGA. Solo lo activa el nodo «Entrada de prueba» (un Webhook
// que el JSON de produccion NO tiene): se pregunta si ese nodo corrio y se lee SU cuerpo, con
// `=== true`. Una carga de WhatsApp con `modoPrueba` adentro —en la raiz, en el mensaje o en un
// texto— no lo activa jamas, porque en produccion `$('Entrada de prueba')` ni siquiera existe.
function cdeValorDeMeta(c) {
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

function cdePrueba() {
  const w = vmPrimero('Entrada de prueba');
  const b = w && w.body && typeof w.body === 'object' ? w.body : null;
  if (!b || b.modoPrueba !== true) return null;
  return {
    modoPrueba: true,
    telefonoDePrueba: vmDigitos(b.telefonoDePrueba),
    enviarDeVerdad: b.enviarDeVerdad === true,
  };
}

function cdeSalida(v, metadataAlterna, ahoraMs, prueba) {
  const metadata = (v && v.metadata && typeof v.metadata === 'object' && v.metadata) || metadataAlterna || {};
  return { json: {
    messaging_product: 'whatsapp',
    metadata: metadata,
    contacts: v && Array.isArray(v.contacts) ? v.contacts : [],
    messages: v && Array.isArray(v.messages) ? v.messages : [],
    phoneNumberId: String(metadata.phone_number_id || ''),
    ahoraMs: ahoraMs,
    prueba: prueba,
  } };
}

const ahoraMs = Date.now();
const prueba = cdePrueba();
const receptor = vmPrimero('Entrega del receptor');
if (receptor) {
  const b = receptor.body && typeof receptor.body === 'object' ? receptor.body : {};
  const valorOk = b.value && typeof b.value === 'object' && (b.field === undefined || b.field === 'messages');
  return [cdeSalida(valorOk ? cdeValorDeMeta(b.value) : null, null, ahoraMs, prueba)];
}
const salida = [];
for (const it of $input.all()) {
  const j = (it && it.json) || {};
  const b = j.body && typeof j.body === 'object' ? j.body : null;
  const v = cdeValorDeMeta(j) || cdeValorDeMeta(b);
  salida.push(cdeSalida(v, j.metadata || (b && b.metadata), ahoraMs, prueba));
}
return salida;
