// DECIDIR TURNO (PR-A, esqueleto): el código decide qué pasa con este turno. El modelo no participa.
//
// Llega por dos caminos: directo desde «Puerta del turno» (texto, toque, o un turno que la puerta cerró) o desde un nodo de medios («Preparar transcripción», «Preparar imagen», «Medio no aceptado»),
// cuyo ítem trae `userInput` (y `categoriaMedio`). En PR-A el `userInput` aún no se usa: es la entrada que PR-B conecta a la conversación.
//
// Lo que decide PR-A, y solo esto:
//   - puerta cerrada (comercio no operativo o uso extendido): el texto que la puerta ya armó;
//   - lo que este canal no lee (sticker, ubicación, contacto, pedido…): el texto cortés fijo;
//   - todo lo demás: SIN respuesta (`pendiente`). La conversación, el catálogo, el QR, el comprobante y la derivación son PR-B; este JSON lleva `meta.noPublicable` hasta entonces.
const puerta = cnPrimero('Puerta del turno') || {};
const ent = cnPrimero('Normalizar entrada') || {};
const previo = ($input.first() || {}).json || {};
let d;
if (puerta.ruta === 'suspendido' || puerta.ruta === 'uso_extendido') {
  d = { ruta: puerta.ruta, texto: String(puerta.texto || ''), responder: puerta.responder === true };
} else if (ent.categoria === 'otro') {
  d = { ruta: 'cortes', texto: RA_TEXTO_CORTES, responder: true };
} else {
  d = { ruta: 'pendiente', texto: '', responder: false };
}
return [{ json: Object.assign({ from: String(ent.from || ''), entrada: String(previo.userInput || '').slice(0, 1500), categoriaMedio: String(previo.categoriaMedio || '') }, d) }];
