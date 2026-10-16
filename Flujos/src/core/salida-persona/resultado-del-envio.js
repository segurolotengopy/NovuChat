// SALIDA DE PERSONA, paso 5: de la respuesta del rele o de Graph al resultado
// que se confirma. Se ejecuta una vez por mensaje (modo "cada item").
//
// Reglas (contrato H2 §4; rele B9 y Graph):
//   2xx con id de mensaje ........................ aceptado + idMeta
//   2xx sin id legible ........................... incierto (Meta pudo aceptarlo)
//   error de red, tiempo agotado, 504, WM-3041 ... incierto: NUNCA se reenvia solo
//   rele: lista permitida (WM previos a Graph, WM-3040 con metaCodigo conocido) .. rechazado
//   rele: cualquier otra cosa ..................... incierto
//   Graph 4xx con error.code ...................... rechazado + codigo (+ reintentable)
//   sin envio por defecto propio ................. rechazado + codigo NV-*
// El texto del mensaje nunca sale de este nodo.
//
// Este nodo es el verificador de los envios 'Enviar por el relé' y 'Enviar por Graph'
// (ambos con continueRegularOutput, unidos por 'Juntar salidas'): lee el estado HTTP y el
// id de la respuesta de cada uno y decide aceptado / rechazado / incierto.
const p = $('Planificar lote').item.json;
const r = $input.item.json;

const base = { mensajeId: p.mensajeId, conversacionId: p.conversacionId };
const limpio = (v) => String(v ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40) || 'DESCONOCIDO';
const rechazo = (codigo, reintentable) => ({ json: { ...base, resultado: 'rechazado', codigo: limpio(codigo), reintentable: reintentable === true } });
const incierto = () => ({ json: { ...base, resultado: 'incierto' } });

if (p.sinEnvio) return rechazo(p.sinEnvio, p.reintentable === true);

// Un error del nodo HTTP (red, tiempo agotado): el mensaje pudo salir.
if (r.error !== undefined && r.statusCode === undefined) return incierto();

// Ni error ni respuesta: el nodo de envio no devolvio nada. Se grita (la confirmacion no se
// inventa); el mensaje queda `enviando` y el siguiente reclamo lo da por incierto.
const origen = p.canal === 'rele' ? 'Enviar por el relé' : 'Enviar por Graph';
if (r.statusCode === undefined) throw new Error('Salida de persona: ' + origen + ' no devolvio respuesta para ' + p.mensajeId);

const estado = Number(r.statusCode);
let cuerpo = r.body;
if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
if (cuerpo === null || typeof cuerpo !== 'object') cuerpo = {};

if (Number(r.statusCode) >= 200 && estado < 300) {
  const primero = Array.isArray(cuerpo.messages) ? cuerpo.messages[0] : undefined;
  const id = primero && typeof primero.id === 'string' ? primero.id : '';
  if (/^[A-Za-z0-9_.=:+/-]{1,120}$/.test(id)) return { json: { ...base, resultado: 'aceptado', idMeta: id } };
  return incierto();
}

const err = (cuerpo.error && typeof cuerpo.error === 'object') ? cuerpo.error : {};
if (p.canal === 'rele') {
  // LISTA PERMITIDA: solo es `rechazado` lo que el rele rechaza ANTES de llamar a Graph
  // (autenticacion, pedido invalido, numero ajeno, falta de clave, tope, saturacion,
  // medio grande, token del cliente) o un rechazo de Meta (WM-3040) con un codigo de
  // Meta conocido. TODO lo demas (WM-3030, 3035, 3036, 3041, 3042, un WM desconocido,
  // un 5xx o un cuerpo ilegible) es `incierto`: el mensaje pudo haber salido.
  const PREVIOS = ['WM-3010', 'WM-3011', 'WM-3012', 'WM-3031', 'WM-3032', 'WM-3033', 'WM-3034', 'WM-3037', 'WM-3038', 'WM-3039'];
  const METAS = ['131047', '131026', '131049', '131051', '131052', '131053', '130429'];
  const wm = typeof err.codigo === 'string' ? err.codigo : '';
  if (wm === 'WM-3040') {
    const meta = String(err.metaCodigo ?? '');
    if (!METAS.includes(meta)) return incierto();
    return rechazo(meta, err.reintentable === true || meta === '130429');
  }
  if (PREVIOS.includes(wm)) return rechazo(wm, err.reintentable === true || wm === 'WM-3037' || wm === 'WM-3038');
  return incierto();
}

// Graph directo: un 5xx o una respuesta sin codigo no dice si salio.
if (!(estado >= 400 && estado < 500) || (typeof err.code !== 'number' && typeof err.code !== 'string')) return incierto();
const codigoMeta = err.code;
return rechazo(codigoMeta, Number(codigoMeta) === 130429 || err.is_transient === true);
