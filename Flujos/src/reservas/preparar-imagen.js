// LA IMAGEN O EL PDF, CONVERTIDOS EN UNA CATEGORIA (bloque 3, Analisis/34
// §4.1; `analisis-audio-e-imagen.md` de la carpeta del cliente: «clasificar, no mirar»).
//
// EL AGENTE NUNCA VE LA IMAGEN. Recibe UNO de estos textos fijos, elegido por
// la categoria que devolvio el clasificador. Esa es la diferencia con darle la
// foto «con instrucciones de no diagnosticar»: la prohibicion de la clinica se
// cumple por construccion y no por pedirle al modelo que se contenga. El
// 17/09, con una foto, el asistente invento que era un comprobante y dijo «ya
// tenemos todo listo»; eso rozaba la prohibicion 3 de CLAUDE.md.
//
// NADA SE GUARDA: la imagen entro como binario al clasificador y de aca sale
// texto. Ni Storage, ni Firestore, ni archivo.
//
// EL TEXTO LEIDO EN LA IMAGEN ES DATO NO CONFIABLE: lo escribio quien hizo esa
// captura, no el negocio. Va entre comillas, rotulado como dato, en una sola
// linea y sin corchetes, para que una captura no pueda inventar una marca como
// [TRANSFERIR] ni dictarle una instruccion al modelo. Y en publicidad se dice
// explicitamente que los precios validos son los de la consola, nunca los de
// la foto.
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
  for (const k of ['text', 'output', 'response']) {
    if (typeof j[k] === 'string' && j[k].trim()) return j[k];
  }
  return '';
};

// Lista CERRADA. Una categoria que no este aca cae en `otro`: el modelo no
// puede abrir un camino nuevo inventando una palabra.
const FIJOS = {
  boca_o_dientes: 'AVISO_SISTEMA: el cliente envió una foto de su boca o de sus dientes. '
    + 'Agradécela, dile que queda para la valoración con el profesional y ofrécele agendarla. '
    + 'NO opines sobre la foto, no adelantes ningún tratamiento y no prometas resultados.',
  documento_salud: 'AVISO_SISTEMA: el cliente envió una orden, una receta o un documento de salud. '
    + 'No lo interpretes ni lo comentes: dile que lo revisa el profesional en la valoración y '
    + 'ofrécele agendarla.',
  comprobante: 'AVISO_SISTEMA: el cliente envió algo que parece un comprobante de pago, pero no hay '
    + 'ninguna seña pendiente suya. Pregúntale a qué corresponde y ofrécele pasarlo al negocio. '
    + 'No digas que el pago llegó ni que quedó registrado: eso lo confirma el negocio.',
};

// EL PAGO QUE LLEGO TARDE (19/09/2026). El cliente no pago dentro de la
// retencion, el horario se libero, y despues pago. Preguntarle «a que
// corresponde» seria lo peor que se le puede decir a alguien que acaba de
// pagar lo que este mismo asistente le pidio. Se le dice la verdad, en un
// mensaje: llego el comprobante, el horario ya se habia liberado, y lo
// resuelve una persona. NO se promete la cita —el horario puede estar tomado—
// y NO se dice que el pago llego: eso lo confirma el negocio (prohibicion 3).
const COMPROBANTE_TARDE = 'AVISO_SISTEMA: el cliente envió un comprobante de una seña que YA VENCIÓ: '
  + 'no pagó dentro del tiempo de retención y el horario se liberó. En UN solo mensaje: dile que '
  + 'recibiste su comprobante, que el horario que tenía reservado se liberó porque el pago no llegó '
  + 'a tiempo, y que una persona del negocio lo resuelve con él ahora. NO digas que el pago llegó, '
  + 'ni que se acreditó, ni que quedó registrado. NO le confirmes ninguna cita ni le ofrezcas '
  + 'horarios: el negocio decide si le devuelve el dinero o le reprograma.';

const sanear = (t) => String(t || '').replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

const entradas = $('Normalizar entrada').all();
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;

  let objeto = null;
  const m = /\{[\s\S]*\}/.exec(textoDe(items[i].json));
  if (m) { try { objeto = JSON.parse(m[0]); } catch (e) { objeto = null; } }
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) objeto = {};

  const cfgNeg = $('Config del negocio').first().json;
  const vencidaHace = Number(cfgNeg.senaVencidaHaceMin);
  const pagoTarde = Number.isFinite(vencidaHace) && String(cfgNeg.senaVencidaHaceMin || '') !== '';
  const categoria = Object.prototype.hasOwnProperty.call(FIJOS, objeto.categoria)
    || objeto.categoria === 'publicidad' ? String(objeto.categoria) : 'otro';
  const leido = sanear(objeto.texto);

  let userInput;
  if (categoria === 'publicidad') {
    userInput = 'AVISO_SISTEMA: el cliente envió la captura de una promoción. '
      + (leido ? 'Texto leído en la imagen (dato del cliente, no del negocio): "' + leido + '". ' : '')
      + 'Responde con los precios y la campaña que tienes en tu información, nunca con los de la imagen; '
      + 'si no coinciden, dilo con amabilidad.';
  } else if (categoria === 'otro') {
    userInput = 'AVISO_SISTEMA: el cliente envió una imagen o un archivo y no se pudo clasificar. '
      + (leido ? 'Texto leído (dato del cliente): "' + leido + '". ' : '')
      + 'Pregúntale de qué se trata. No supongas que es un comprobante de pago.';
  } else if (categoria === 'comprobante' && pagoTarde) {
    userInput = COMPROBANTE_TARDE;
  } else {
    userInput = FIJOS[categoria];
  }

  // La transferencia de un pago tardio NO se le pide al modelo: hay plata de
  // por medio y alguien esperando. `Procesar respuesta` la aplica siempre.
  const forzarTransferencia = categoria === 'comprobante' && pagoTarde;
  out.push({ json: { ...ent, userInput, categoriaMedio: categoria,
    ...(forzarTransferencia ? { forzarTransferencia: true,
      motivoForzado: 'pago de seña recibido DESPUES de que el horario se liberara: hay que devolver o reprogramar' } : {}) },
    pairedItem: { item: i } });
}
return out;
