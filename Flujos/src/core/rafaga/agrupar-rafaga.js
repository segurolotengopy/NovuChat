// Agrupar ráfaga (pieza común del core, Flujos/src/core/rafaga/).
//
// Quien escribe tres textos seguidos dispara tres ejecuciones; cada una espera
// («Esperar ráfaga»), consulta al servidor los últimos mensajes de ese
// teléfono («Consultar ráfaga») y llega acá. Solo UNA responde, con los textos
// unidos; las demás terminan sin enviar nada. Ahorra n-1 mensajes por ráfaga.
//
// FALLA ABIERTO: sin respuesta del servidor, con un dato mal formado o sin
// encontrar el propio mensaje, esta ejecución responde SOLA, como si la ráfaga
// no existiera (a lo sumo se duplica una respuesta; jamás se pierde un mensaje).
//
// Reglas (la decisión es una función pura, sin reloj ni estado):
//   - Agrupable: tipo «text», con texto y sin «[nº]» (la copia guardada ocultó un número).
//   - Cadena: desde el fragmento MÁS NUEVO hacia atrás, mientras cada uno sea
//     agrupable y el salto entre dos consecutivos sea <= espera - 500 ms. Máximo 5.
//   - Audio, imagen, botón o cualquier otro tipo NO esperan ni se callan, y cortan la cadena.
//   - Estoy en la cadena y no soy el último: silencio. Soy el último y hay más de
//     uno: respondo con los textos unidos por salto de línea (el mío, crudo). Otro caso: solo.
//   - Mismo instante: se ordena por (ms, idMeta), así todas las ejecuciones ven
//     el mismo último y hay exactamente un ganador.
const MAXIMO_DE_LA_RAFAGA = 5;
const MARGEN_MS = 500;

function esAgrupable(f) {
  return f.tipo === 'text' && f.texto.trim() !== '' && f.texto.indexOf('[nº]') < 0;
}

function decidirRafaga({ idMeta, textoPropio, fragmentos, esperaMs, fallo }) {
  const propio = String(textoPropio === undefined || textoPropio === null ? '' : textoPropio);
  const solo = () => ({ accion: 'solo', texto: propio, ids: idMeta ? [idMeta] : [] });
  if (fallo || !idMeta || !Array.isArray(fragmentos)) return solo();
  const espera = Number(esperaMs);
  if (!Number.isFinite(espera) || espera <= 0) return solo();
  const salto = Math.max(0, espera - MARGEN_MS);

  const vistos = new Set();
  const lista = [];
  for (const f of fragmentos) {
    if (!f || typeof f.idMeta !== 'string' || f.idMeta === '' || typeof f.tipo !== 'string'
      || typeof f.texto !== 'string' || typeof f.ms !== 'number' || !Number.isFinite(f.ms)) return solo();
    if (vistos.has(f.idMeta)) continue;
    vistos.add(f.idMeta);
    lista.push(f);
  }
  if (!vistos.has(idMeta)) return solo();
  lista.sort((a, b) => (a.ms - b.ms) || (a.idMeta < b.idMeta ? -1 : a.idMeta > b.idMeta ? 1 : 0));

  const cadena = [];
  for (let i = lista.length - 1; i >= 0 && cadena.length < MAXIMO_DE_LA_RAFAGA; i--) {
    const f = lista[i];
    if (!esAgrupable(f)) break;
    if (cadena.length > 0 && cadena[0].ms - f.ms > salto) break;
    cadena.unshift(f);
  }
  if (cadena.length < 2 || !cadena.some((f) => f.idMeta === idMeta)) return solo();
  if (cadena[cadena.length - 1].idMeta !== idMeta) return { accion: 'silencio', texto: '', ids: [] };
  return {
    accion: 'agrupado',
    texto: cadena.map((f) => (f.idMeta === idMeta ? propio : f.texto)).join('\n'),
    ids: cadena.map((f) => f.idMeta),
  };
}

const entrada = $('¿Esperar ráfaga?').first().json;
const configuracion = $('Config base').first().json;
const segundos = Number(configuracion.esperaRafagaSeg);
const esperaMs = (Number.isFinite(segundos) && segundos > 0 ? Math.min(5, Math.max(1, segundos)) : 2) * 1000;
const respuesta = ($input.all()[0] || { json: {} }).json || {};
const rafaga = respuesta.rafaga;
const valida = !!rafaga && rafaga.v === 1 && Array.isArray(rafaga.fragmentos);

const d = decidirRafaga({
  idMeta: String(entrada.mensajeId || ''),
  textoPropio: entrada.userInput,
  fragmentos: valida ? rafaga.fragmentos : null,
  esperaMs,
  fallo: !valida,
});
if (d.accion === 'silencio') return [];
const salida = { ...entrada, rafaga: { accion: d.accion, ids: d.ids } };
if (d.accion === 'agrupado') salida.textoDelTurno = d.texto;
return [{ json: salida }];
