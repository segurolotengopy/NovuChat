// Agrupar ráfaga (pieza común del core, Flujos/src/core/rafaga/).
//
// Quien escribe tres textos seguidos dispara tres ejecuciones; cada una espera
// («Esperar ráfaga»), consulta al servidor los últimos mensajes de ese
// teléfono («Consultar ráfaga») y llega acá. Solo UNA responde por grupo, con
// los textos unidos; las demás terminan sin enviar nada. Ahorra n-1 mensajes.
//
// FALLA ABIERTO: sin respuesta del servidor, con un dato mal formado o sin
// encontrar el propio mensaje, esta ejecución responde SOLA, como hoy.
//
// LA REGLA (determinista, sobre datos que no cambian, y RELATIVA A MI POSICIÓN,
// no a la del mensaje más nuevo: cada ejecución consulta en un momento distinto
// y ve una lista distinta, pero todas ven igual lo que está antes y a pocos
// segundos de ellas):
//   - Se ordenan TODAS las entradas (textos, medios y marcas de saliente) por (ms, idMeta).
//   - Agrupable: tipo «text», con idMeta, con texto y sin «[nº]» (la copia
//     guardada ocultó un número). Todo lo demás (audio, imagen, botón, marca
//     de saliente) es separador.
//   - Hay ARISTA entre dos entradas adyacentes en el orden si las dos son
//     agrupables y el salto es <= espera - 500 ms. Un separador entre ellas
//     las deja de ser adyacentes.
//   - Si hay arista entre YO y mi vecino SIGUIENTE: silencio (otro cubre mi texto).
//     Si no: respondo con mi componente hacia atrás (vecinos anteriores
//     mientras haya arista), en orden cronológico, unidos por salto de línea
//     (los ajenos como los devuelve el servidor, el mío crudo). Componente de uno: solo.
//   - Sin fallas, cada texto agrupable cae en exactamente un grupo y cada grupo lo
//     responde su último texto (lo prueba rafaga-propiedad.test.ts). Con fallas
//     el error es DUPLICAR (una consulta fallida responde sola), no perder;
//     la excepción declarada es la consulta fallida de quien debía responder el
//     grupo y las cadenas de 7 o más textos (docs/arquitectura/rafagas.md).
const MARGEN_MS = 500;
const CAMPO_ID = 'mensajeId';
const CAMPO_TEXTO = 'userInput';

function esAgrupable(f) {
  return f.tipo === 'text' && f.idMeta !== '' && f.texto.trim() !== '' && f.texto.indexOf('[nº]') < 0;
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
    if (!f || typeof f.idMeta !== 'string' || typeof f.tipo !== 'string'
      || typeof f.texto !== 'string' || typeof f.ms !== 'number' || !Number.isFinite(f.ms)) return solo();
    if (f.idMeta !== '') {
      if (vistos.has(f.idMeta)) continue;
      vistos.add(f.idMeta);
    }
    lista.push(f);
  }
  lista.sort((a, b) => (a.ms - b.ms) || (a.idMeta < b.idMeta ? -1 : a.idMeta > b.idMeta ? 1 : 0));
  const yo = lista.findIndex((f) => f.idMeta === idMeta);
  if (yo < 0 || !esAgrupable(lista[yo])) return solo();

  const arista = (a, b) => esAgrupable(a) && esAgrupable(b) && b.ms - a.ms <= salto;
  if (yo + 1 < lista.length && arista(lista[yo], lista[yo + 1])) return { accion: 'silencio', texto: '', ids: [] };
  let desde = yo;
  while (desde > 0 && arista(lista[desde - 1], lista[desde])) desde--;
  if (desde === yo) return solo();
  const grupo = lista.slice(desde, yo + 1);
  return {
    accion: 'agrupado',
    texto: grupo.map((f) => (f.idMeta === idMeta ? propio : f.texto)).join('\n'),
    ids: grupo.map((f) => f.idMeta),
  };
}

const entrada = $('¿Esperar ráfaga?').first().json;
let configuracion = {};
try { configuracion = $('Config base').first().json || {}; } catch (e) { configuracion = {}; }
const segundos = Number(configuracion.esperaRafagaSeg);
const esperaMs = (Number.isFinite(segundos) && segundos > 0 ? Math.min(5, Math.max(1, segundos)) : 2) * 1000;
const respuesta = ($input.all()[0] || { json: {} }).json || {};
const rafaga = respuesta.rafaga;
const valida = !!rafaga && rafaga.v === 1 && Array.isArray(rafaga.fragmentos);

const d = decidirRafaga({
  idMeta: String(entrada[CAMPO_ID] || ''),
  textoPropio: entrada[CAMPO_TEXTO],
  fragmentos: valida ? rafaga.fragmentos : null,
  esperaMs,
  fallo: !valida,
});
if (d.accion === 'silencio') return [];
const salida = { ...entrada, rafaga: { accion: d.accion, ids: d.ids } };
if (d.accion === 'agrupado') salida.textoDelTurno = d.texto;
return [{ json: salida }];
