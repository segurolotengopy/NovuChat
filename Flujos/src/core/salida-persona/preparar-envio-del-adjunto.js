// SALIDA DE PERSONA (adjuntos, B3), paso B: de la respuesta de `Subir a Meta` al cuerpo del envio.
// Se ejecuta una vez por item (modo "cada item").
//
// Meta responde a `POST /{numero}/media` con { id }. Ese id va en el cuerpo del mensaje
// (`{ type, [type]: { id, caption?, filename?, voice? } }`): NUNCA un `link`. Una subida que no
// dio un id legible no envia nada: sale como `adjuntoSinEnvio` (rechazado reintentable, porque
// no se entrego ningun mensaje), sin binario, leyenda ni nombre.
const p = $('Planificar lote').item.json;
const r = $input.item.json || {};
const base = { mensajeId: p.mensajeId, conversacionId: p.conversacionId };
const falla = (c) => ({ json: { ...base, ruta: 'ninguna', adjuntoSinEnvio: c } });

if (r.statusCode === undefined) return falla('NV-ADJUNTO-SUBIDA');
const estado = Number(r.statusCode);
let cuerpo = r.body;
if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
if (cuerpo === null || typeof cuerpo !== 'object') cuerpo = {};

if (!(estado >= 200 && estado < 300)) {
  const err = (cuerpo.error && typeof cuerpo.error === 'object') ? cuerpo.error : {};
  const codigo = String(err.code ?? '');
  return falla(/^[0-9]{1,10}$/.test(codigo) ? 'NV-ADJUNTO-SUBIDA-' + codigo : 'NV-ADJUNTO-SUBIDA');
}
const id = typeof cuerpo.id === 'string' ? cuerpo.id : '';
if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id)) return falla('NV-ADJUNTO-SUBIDA');

const c = p.cuerpoAdjunto;
return { json: { ...base, ruta: 'enviar', cuerpoEnvio: { ...c, [c.type]: { id, ...c[c.type] } } } };
