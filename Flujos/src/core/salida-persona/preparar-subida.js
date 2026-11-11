// SALIDA DE PERSONA (adjuntos, B3), paso A: de la lectura del adjunto a la subida a Meta.
// Se ejecuta una vez por item (modo "cada item"), tras `Leer adjunto`.
//
// `leerAdjuntoPersona` devuelve los bytes crudos como `application/octet-stream` (no el mime
// real) con `X-NovuChat-Mime`, `X-NovuChat-Sha256` y `Content-Length`. Meta valida el mime de la
// parte (error 131053), asi que aqui se corrige `mimeType`/`fileName` del binario con el mime ya
// validado en `Planificar lote`. El sha256 NO se recalcula aqui (el Code de n8n no tiene
// `crypto` ni `Buffer`): se exige que la cabecera coincida con el del reclamo, y los bytes los
// verifica el servidor (503 si no cuadran).
//
// Cualquier falla sale como `adjuntoSinEnvio` (sin binario, sin leyenda ni nombre): llega a
// `Resultado del envío` como rechazado reintentable. NUNCA incierto: nada se entrego.
const p = $('Planificar lote').item.json;
const r = $input.item.json || {};
const binario = $input.item.binary && $input.item.binary.adjunto;
const a = p.adjunto;
const base = { mensajeId: p.mensajeId, conversacionId: p.conversacionId };
const falla = (c) => ({ json: { ...base, ruta: 'ninguna', adjuntoSinEnvio: c } });

if (r.statusCode === undefined) return falla('NV-ADJUNTO-LECTURA');
const estado = Number(r.statusCode);
if (estado === 404) return falla('NV-ADJUNTO-NO-EXISTE');
if (estado === 409) return falla('NV-ADJUNTO-ESTADO');
if (estado !== 200) return falla('NV-ADJUNTO-LECTURA');

const h = (r.headers && typeof r.headers === 'object') ? r.headers : {};
const largo = h['content-length'];
if (!binario || !a || String(h['x-novuchat-mime'] ?? '') !== a.mime || String(h['x-novuchat-sha256'] ?? '') !== a.sha256
  || (largo !== undefined && Number(largo) !== a.tamano)) return falla('NV-ADJUNTO-INTEGRIDAD');

return { json: { ...base, ruta: 'subir', mime: a.mime },
  binary: { adjunto: { ...binario, mimeType: a.mime, fileName: 'adjunto.' + a.ext, fileExtension: a.ext } } };
