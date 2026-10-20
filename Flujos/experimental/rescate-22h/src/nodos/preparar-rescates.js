// «Preparar rescates»: valida lo que reclamó el servidor y arma, por rescate, la llamada al modelo.
// Entrada: la respuesta completa de «Reclamar rescates» ({ statusCode, body }). Salida: un ítem por rescate; sin rescates, ninguno
// (y entonces no hay llamadas al modelo ni envíos).
const cfg = $('Config base').first().json;
const r = $input.first().json || {};
const codigo = Number(r.statusCode);
let cuerpo = r.body;
if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
if (!cuerpo || typeof cuerpo !== 'object') cuerpo = {};
if (codigo === 409) {
  if (cuerpo.estado === 'flujo_no_admitido') throw new Error('RS-FLUJO');
  return [];
}
if (codigo !== 200) throw new Error('RS-RECLAMO-' + (Number.isFinite(codigo) ? codigo : 'x'));
// Solo se rescata desde la línea de este flujo: si el servidor contesta por otra, no se envía nada.
if (!rsDigitos(cfg.phoneNumberId) || rsDigitos(cuerpo.phoneNumberId) !== rsDigitos(cfg.phoneNumberId)) throw new Error('RS-LINEA');
const soloPrueba = cfg.listaDePrueba !== false;
const lista = rsLista(cfg.telefonosDePrueba);
const excluidos = rsLista(cfg.telefonosExcluidos);
const ahora = Date.now();
const vistos = new Set();
const salida = [];
for (const x of (Array.isArray(cuerpo.rescates) ? cuerpo.rescates.slice(0, 20) : [])) {
  if (!x || typeof x !== 'object') continue;
  const telefono = x.telefono;
  if (typeof telefono !== 'string' || !/^[0-9]{8,15}$/.test(telefono) || vistos.has(telefono)) continue;
  // Cota superior (ventana de Meta por cerrar) e inferior (un instante futuro, o con menos de 22 h de silencio, no se rescata).
  if (typeof x.ultimoEntranteMs !== 'number' || !Number.isFinite(x.ultimoEntranteMs) || ahora >= x.ultimoEntranteMs + RS_CORTE_MS || ahora < x.ultimoEntranteMs + RS_MINIMO_MS) continue;
  // Defensa en profundidad: los excluidos de «Config base» no reciben nada aunque el servidor los devuelva.
  if (excluidos.includes(telefono)) continue;
  // Defensa en profundidad: con la lista de prueba encendida, solo sale a un teléfono de la lista.
  if (soloPrueba && !lista.includes(telefono)) continue;
  vistos.add(telefono);
  const textos = (Array.isArray(x.textos) ? x.textos.filter((t) => typeof t === 'string') : []).slice(0, 6);
  // Sin historial suficiente NO se arma la llamada al modelo (y «¿Hay historial?» no la deja pasar): los textos del cliente no salen hacia Gemini.
  const suficiente = rsHistorialSuficiente(textos);
  const json = { telefono, ultimoEntranteMs: x.ultimoEntranteMs, textos, suficiente, modelo: rsModeloValido(cfg.modelo) };
  if (suficiente) json.cuerpoModelo = rsCuerpoModelo(cfg, textos);
  salida.push({ json });
}
return salida;
