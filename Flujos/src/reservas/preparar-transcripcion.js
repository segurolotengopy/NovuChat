// EL AUDIO, CONVERTIDO EN TEXTO PARA EL AGENTE (bloque 3, Analisis/34 §3.1).
//
// EL AGENTE NO RECIBE EL AUDIO: recibe lo que este nodo escribe en
// `userInput`. El binario entro al nodo de transcripcion y murio ahi; de aca
// sale texto y nada mas. No se guarda en Storage, ni en Firestore, ni en un
// archivo.
//
// CUANTO DURA EL AUDIO. Meta NO manda la duracion en el webhook: manda el id
// del medio, y `Obtener URL del medio (general)` devuelve `file_size`. Hay que
// estimarla, y el supuesto de ayer estaba 6,8 VECES DE MAS.
//
// MEDIDO, NO SUPUESTO (2026-09-23). La nota de voz que el Dr. Bellido mando por
// WhatsApp: 604.186 bytes para 256 segundos = 2.360 B/s (ogg/opus a ~19 kbps).
// El supuesto anterior de 16.000 B/s daba un tope de 960 kB que el propio
// comentario admitia no haber medido nunca: con la tasa real, esos 960 kB eran
// SEIS MINUTOS Y MEDIO, no el minuto que decia la constante. El tope no era el
// que estaba escrito, y nadie lo sabia.
//
// LA DECISION, ahora que el numero es real: el tope no es un minuto, son CINCO.
// Un cliente que cuenta lo que le pasa a su hijo habla dos o tres minutos, y el
// propio doctor mando cuatro y cuarto. Cortarlo en 60 s es el «atiendo por
// texto» que este bloque vino a sacar. Cinco minutos son ~720 kB y unos pocos
// segundos mas de transcripcion; mas alla, se pide texto, porque ahi si se
// compromete el p90 de 10 s del turno (`Analisis/34` §3.1).
const SEGUNDOS_MAX = 300;
const BYTES_POR_SEGUNDO = 2400;   // medido 2.360; se redondea hacia arriba
const LIMITE_BYTES = SEGUNDOS_MAX * BYTES_POR_SEGUNDO;

// CUANTO TEXTO ENTRA. A ~850 caracteres por minuto de habla, cinco minutos son
// unos 4.250. El presupuesto anterior era 1.200: un audio de cuatro minutos
// llegaba al agente con UN TERCIO de lo que el cliente dijo, cortado a mitad de
// palabra y SIN QUE NADIE SE ENTERARA -- ni el cliente, ni el agente, ni las
// ejecuciones. Eso es lo que «no lleguen cortados» quiere decir.
const CARACTERES_MAX = 4400;

// TRES CASOS DISTINTOS, TRES AVISOS DISTINTOS. Antes «muy largo» y «no se
// entendio» compartian mensaje, y el cliente que mando un audio de seis minutos
// recibia lo mismo que el que mando uno inaudible: no sabia cual de las dos
// cosas arreglar.
const MUY_LARGO = 'AVISO_SISTEMA: el cliente mandó una nota de voz de más de cinco minutos. '
  + 'Dile con amabilidad que es muy larga para escucharla entera y pídele lo esencial '
  + 'en texto o en un audio más corto, y sigue atendiendo con normalidad.';
const NO_SE_ENTENDIO = 'AVISO_SISTEMA: llegó una nota de voz pero no se pudo entender. '
  + 'Pídele con amabilidad que la repita o la escriba, y sigue atendiendo con normalidad.';
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

  const completo = textoDe(items[i].json).replace(/\s+/g, ' ').trim();

  // SI HAY QUE RECORTAR, SE CORTA EN UNA ORACION Y SE DICE. Cortar a mitad de
  // palabra y callarlo es lo peor de los dos mundos: el agente contesta sobre
  // medio pedido creyendo que lo tiene entero. Se busca el ultimo punto,
  // interrogacion o exclamacion dentro del presupuesto; si no hay ninguno --un
  // audio sin puntuacion--, se corta en el ultimo espacio, nunca en el medio de
  // una palabra. Y el aviso le dice al agente que pida el resto.
  let texto = completo;
  let recortado = false;
  if (completo.length > CARACTERES_MAX) {
    const trozo = completo.slice(0, CARACTERES_MAX);
    const oracion = Math.max(trozo.lastIndexOf('. '), trozo.lastIndexOf('? '), trozo.lastIndexOf('! '));
    const corte = oracion > CARACTERES_MAX * 0.6 ? oracion + 1 : trozo.lastIndexOf(' ');
    texto = trozo.slice(0, corte > 0 ? corte : CARACTERES_MAX).trim();
    recortado = true;
  }

  // Vacio cubre tambien el fallo del nodo de transcripcion (`onError` sigue de
  // largo): antes que responder cualquier cosa, se pide que lo repita.
  let userInput;
  if (largo) userInput = MUY_LARGO;
  else if (texto === '') userInput = NO_SE_ENTENDIO;
  else {
    userInput = '(audio transcripto) ' + texto + '\n' + REPETIR;
    if (recortado) {
      userInput += '\nAVISO_SISTEMA: la nota de voz seguía y esto es solo la primera parte. '
        + 'Responde lo que sí entendiste y dile que te cuente el resto, sin inventar lo que falta.';
    }
  }

  out.push({ json: { ...ent, userInput }, pairedItem: { item: i } });
}
return out;
