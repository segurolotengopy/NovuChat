// SALIDA DE PERSONA, paso 5: de la respuesta del rele o de Graph al resultado
// que se confirma. Se ejecuta una vez por mensaje (modo "cada item").
//
// Reglas (contrato H2 §4; rele B9 y Graph):
//   2xx con id de mensaje ........................ aceptado + idMeta
//   2xx sin id legible ........................... incierto (Meta pudo aceptarlo)
//   error de red, tiempo agotado, 504, WM-3041 ... incierto: NUNCA se reenvia solo
//   5xx sin codigo, WM-3030/3035/3042 ............ incierto
//   codigo de Meta o del rele (4xx / WM-3040) .... rechazado + codigo (+ reintentable)
//   sin envio por defecto propio ................. rechazado + codigo NV-*
// El texto del mensaje nunca sale de este nodo.
const p = $('Planificar lote').item.json;
const r = $input.item.json;

const base = { mensajeId: p.mensajeId, conversacionId: p.conversacionId };
const limpio = (v) => String(v ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40) || 'DESCONOCIDO';
const rechazo = (codigo, reintentable) => ({ json: { ...base, resultado: 'rechazado', codigo: limpio(codigo), reintentable: reintentable === true } });
const incierto = () => ({ json: { ...base, resultado: 'incierto' } });

if (p.sinEnvio) return rechazo(p.sinEnvio, p.reintentable === true);

// Un error del nodo HTTP (red, tiempo agotado): el mensaje pudo salir.
if (r.error !== undefined && r.statusCode === undefined) return incierto();

const estado = Number(r.statusCode);
let cuerpo = r.body;
if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
if (cuerpo === null || typeof cuerpo !== 'object') cuerpo = {};

if (estado >= 200 && estado < 300) {
  const primero = Array.isArray(cuerpo.messages) ? cuerpo.messages[0] : undefined;
  const id = primero && typeof primero.id === 'string' ? primero.id : '';
  if (/^[A-Za-z0-9_.=:+/-]{1,120}$/.test(id)) return { json: { ...base, resultado: 'aceptado', idMeta: id } };
  return incierto();
}

const err = (cuerpo.error && typeof cuerpo.error === 'object') ? cuerpo.error : {};
if (p.canal === 'rele') {
  const wm = typeof err.codigo === 'string' ? err.codigo : '';
  if (estado === 504 || ['WM-3041', 'WM-3035', 'WM-3030', 'WM-3042'].includes(wm)) return incierto();
  if (wm === '') return (estado >= 500 || !Number.isFinite(estado)) ? incierto() : rechazo('HTTP-' + estado, false);
  // WM-3040: Meta rechazo; el codigo de Meta (131047...) manda sobre el del rele.
  const codigo = err.metaCodigo !== undefined && err.metaCodigo !== null ? err.metaCodigo : wm;
  const reintentable = err.reintentable === true || wm === 'WM-3037' || wm === 'WM-3038';
  return rechazo(codigo, reintentable);
}

// Graph directo: un 5xx o una respuesta sin codigo no dice si salio.
if (!(estado >= 400 && estado < 500) || (typeof err.code !== 'number' && typeof err.code !== 'string')) return incierto();
const codigoMeta = err.code;
return rechazo(codigoMeta, Number(codigoMeta) === 130429 || err.is_transient === true);
