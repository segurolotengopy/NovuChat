// EL AUDIO, CONVERTIDO EN TEXTO PARA EL AGENTE (bloque 3, Analisis/34 §3.1).
//
// EL AGENTE NO RECIBE EL AUDIO: recibe lo que este nodo escribe en
// `userInput`. El binario entro al nodo de transcripcion y murio ahi; de aca
// sale texto y nada mas. No se guarda en Storage, ni en Firestore, ni en un
// archivo.
//
// CUANTO DURA EL AUDIO. Meta NO manda la duracion en el webhook: manda el id
// del medio, y `Obtener URL del medio (general)` devuelve `file_size`. El
// SUPUESTO es ~16 kB por segundo para el ogg/opus de WhatsApp, o sea 960 kB
// para los 60 s que `Analisis/34` §3.1 fija como tope (mas alla, la
// transcripcion compromete el p90 de 10 s del turno).
//
// EL SUPUESTO ES DELIBERADAMENTE GENEROSO. Una nota de voz de WhatsApp suele
// ir a ~16 kbps, que son 2 kB por segundo: con esa cuenta 960 kB serian ocho
// minutos. Se eligio el techo y no el promedio a proposito: equivocarse hacia
// arriba cuesta unos segundos de latencia; equivocarse hacia abajo le dice a
// un paciente que su audio de 40 s es «muy largo», que es exactamente el
// «atiendo por texto» que este bloque vino a sacar. HAY QUE MEDIRLO CON UN
// TELEFONO REAL y ajustar la constante con lo que devuelva `file_size`.
const SEGUNDOS_MAX = 60;
const BYTES_POR_SEGUNDO = 16000;
const LIMITE_BYTES = SEGUNDOS_MAX * BYTES_POR_SEGUNDO;

const PEDIR_TEXTO = 'AVISO_SISTEMA: el cliente mandó un audio largo o que no se pudo entender. '
  + 'Pídele con amabilidad que lo escriba o lo resuma en texto, y sigue atendiendo con normalidad.';
const REPETIR = 'AVISO_SISTEMA: antes de ofrecer horarios o agendar, repite en una línea lo que '
  + 'entendiste del audio para que el cliente pueda corregirte.';

// La salida simplificada del nodo Google Gemini trae el texto en
// `content.parts[].text`; se toleran las otras formas conocidas por si el nodo
// cambia de version o se apaga `simplify`. Es la misma funcion que usa
// `Interpretar lectura` en la rama del comprobante.
const textoDe = (j) => {
  if (!j || typeof j !== 'object') return '';
  const partes = (c) => (c && Array.isArray(c.parts))
    ? c.parts.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n') : '';
  if (typeof j.content === 'string') return j.content;
  const c1 = partes(j.content);
  if (c1) return c1;
  const cand = Array.isArray(j.candidates) ? j.candidates[0] : null;
  const c2 = cand ? partes(cand.content) : '';
  if (c2) return c2;
  for (const k of ['text', 'transcription', 'output', 'response']) {
    if (typeof j[k] === 'string' && j[k].trim()) return j[k];
  }
  return '';
};

const entradas = $('Normalizar entrada').all();
const medios = $('Obtener URL del medio (general)').all();
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  // Emparejamiento por indice, nunca .first(): con dos clientes a la vez,
  // .first() le pondria el audio de uno a la conversacion del otro.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;
  const medio = (medios[i] ?? medios[medios.length - 1] ?? { json: {} }).json;

  const tam = Number(medio.file_size ?? medio.fileSize ?? 0);
  const largo = Number.isFinite(tam) && tam > LIMITE_BYTES;

  // Se recorta: un audio de varios minutos podria traer miles de palabras, y
  // el prompt se paga en tokens en cada turno de la memoria.
  const texto = textoDe(items[i].json).replace(/\s+/g, ' ').trim().slice(0, 1200);

  // Vacio tambien cubre el fallo del nodo de transcripcion (`onError` sigue de
  // largo): antes que responder cualquier cosa, se pide que lo escriba.
  const userInput = (largo || texto === '')
    ? PEDIR_TEXTO
    : '(audio transcripto) ' + texto + '\n' + REPETIR;

  out.push({ json: { ...ent, userInput }, pairedItem: { item: i } });
}
return out;
