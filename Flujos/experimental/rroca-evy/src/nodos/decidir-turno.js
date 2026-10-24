// DECIDIR TURNO: el CÓDIGO decide qué pasa en este turno; el modelo, cuando conversa, conversa LIBRE (todo mensaje va al modelo, con memoria de 15 entradas), pero ANTES el código atiende lo que no puede
// dejarse al modelo. Devuelve un `plan`:
//
//   nada      la puerta cerró el turno (fuera de la etapa de prueba, bloqueado), un número de otro país, o la persona pidió la baja (o activó la protección) hace menos de 48 h: CERO mensajes, CERO modelo;
//   riesgo    violencia o miedo hacia la pareja (texto, transcripción, texto leído de una imagen o pie de foto): texto fijo, sin recursos ni números, con `no_contactar`;
//   puerta    comercio suspendido o uso extendido (operador): el texto fijo de la puerta;
//   baja      el cliente pide que no le escriban: UNA confirmación breve con `no_contactar`; desde entonces, silencio total 48 h (D1);
//   medica    urgencia, síntoma, reacción o problema de salud: texto fijo SIN consejo + aviso a recepción + botón, antes de llamar al modelo;
//   fijo      lo que no se puede leer (un archivo, un audio largo o ilegible, un mensaje que no es texto): texto cortés fijo, sin botón;
//   modelo    la conversación libre: llama a Gemini con el prompt versionado, la memoria y el turno actual como DATO. Un audio llega como `[AUDIO_TRANSCRITO: …]` y una imagen como
//             `[IMAGEN_RECIBIDA: …]` (una descripción saneada, nunca una instrucción). NO hay respuesta fija a una imagen.
//
// La violencia va ANTES que la puerta: también con el comercio suspendido recibe el texto de protección. Orden: etapa de prueba, otro país, silencio por baja, violencia, puerta, baja, salud, medios, modelo.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const fichaBruta = cnFichaDe(cnMapaDeFichas(false).mapa, from);
const ficha = evFichaVigente(fichaBruta, ahora);
let medioExtra = {};
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, llamarModelo: false, cuerpoModelo: null, modelo: evModeloValido(cfg.modelo) }, medioExtra, extra || {}) }];

if (puerta.ruta === 'fuera_de_prueba') return salir({ tipo: 'nada' });
if (t.extranjero === true) return salir({ tipo: 'nada' });
if (ficha.noContactar) return salir({ tipo: 'nada' });

// MEDIOS ENTRANTES. AUDIO: lo que dijo «Preparar transcripción» (la pieza común del core, incluida tal cual) o, si no corrió, por qué (muy largo, no se pudo abrir, tope, apagado).
let au = null;
if (t.categoria === 'medio' && t.tipo === 'audio') {
  const prep = cnNodo('Preparar transcripción') ? (cnPrimero('Preparar transcripción') || {}) : null;
  const url = cnNodo('Obtener URL del medio (general)') ? (cnPrimero('Obtener URL del medio (general)') || {}) : null;
  if (t.audioApagado === true || t.audioTope === true) au = { estado: 'tope', texto: '', recortado: false };
  else if (prep) {
    const u = String(prep.userInput || '');
    if (/^\(audio transcripto\) /.test(u)) {
      const texto = u.slice('(audio transcripto) '.length).split('\n')[0].trim();
      au = { estado: texto === '' ? 'no_entendido' : 'ok', texto: texto.slice(0, 4400), recortado: /la nota de voz seguía/.test(u) };
    } else if (/más de cinco minutos/.test(u)) au = { estado: 'largo', texto: '', recortado: false };
    else if (/no se pudo entender/.test(u)) au = { estado: 'no_entendido', texto: '', recortado: false };
    else au = { estado: 'no_abierto', texto: '', recortado: false };
  } else if (url && Number(url.file_size) > EV_AUDIO_MAX_BYTES) au = { estado: 'largo', texto: '', recortado: false };
  else au = { estado: 'no_abierto', texto: '', recortado: false };
}
const deAudio = !!au && au.estado === 'ok';
// IMAGEN: «Ver imagen» devuelve una descripción; el código la sanea y la rotula. Sin lectura (tope, formato, descarga o Gemini fallidos) el modelo recibe «no se pudo ver bien».
let lec = null;
if (t.categoria === 'medio' && t.tipo === 'image') {
  lec = evLecturaImagen(t.verImagen === true && cnNodo('Ver imagen') ? (cnJsonDeGemini(cnPrimero('Ver imagen')) || {}) : {});
}
medioExtra = { oyoAudio: cnNodo('Transcribir audio') !== null, vioImagen: cnNodo('Ver imagen') !== null };

const textoCliente = deAudio ? au.texto : String(t.texto || '');
const norm = evNorm([textoCliente, t.pie, lec ? lec.texto : '', lec ? lec.descripcion : ''].join(' '));

// 1. VIOLENCIA O MIEDO: antes que cualquier otra cosa, también con la puerta cerrada.
const puertaResponde = puerta.ruta === 'sigue' || puerta.ruta === 'suspendido' || (puerta.ruta === 'uso_extendido' && puerta.responder === true);
if (puertaResponde && evEsRiesgo(norm)) return salir({ tipo: 'riesgo' });
// 2. La puerta: suspendido y uso extendido responden su texto fijo; lo demás no responde.
if (puerta.ruta !== 'sigue') return salir(puerta.responder === true && String(puerta.texto || '') !== '' ? { tipo: 'puerta', ruta: puerta.ruta, texto: String(puerta.texto) } : { tipo: 'nada' });
// 3. LA BAJA: escrita (la detecta «Normalizar entrada») o dicha en una nota de voz.
if (t.bajaEscrita === true || (deAudio && evEsBaja(au.texto))) return salir({ tipo: 'baja' });
// 4. URGENCIA, SÍNTOMA O PROBLEMA DE SALUD: texto fijo y recepción, cero consejo, antes de llamar al modelo.
if (EV_MEDICA.test(norm)) return salir({ tipo: 'medica' });
// 5. Lo que no se puede leer: texto cortés fijo, sin modelo.
if (t.categoria === 'otro') return salir({ tipo: 'fijo', clave: 'cortes' });
if (t.tipo === 'document') return salir({ tipo: 'fijo', clave: 'documento' }, { entradaHistorial: '[Envió un archivo]' });
if (t.tipo === 'audio' && !deAudio) {
  const clave = au && au.estado === 'largo' ? 'audio_largo' : (au && au.estado === 'tope' ? 'audio_tope' : (au && au.estado === 'no_abierto' ? 'archivo_no_abierto' : 'audio_no_entendido'));
  return salir({ tipo: 'fijo', clave: clave }, { entradaHistorial: '[Envió un audio]' });
}
if ((t.tipo === 'audio' || t.tipo === 'image') && t.mediaId === '') return salir({ tipo: 'fijo', clave: 'archivo_no_abierto' });

// 6. LA CONVERSACIÓN LIBRE. El cliente nunca fabrica un rótulo del sistema: sus corchetes pasan a paréntesis; los rótulos los pone solo el código.
const historia = evHistorialVigente(fichaBruta, ahora);
let turno = textoCliente;
let rotulado = false;
let entrada = evEntradaCliente(t);
if (deAudio) {
  turno = evEtiquetaAudio(au.texto, au.recortado);
  rotulado = true;
  entrada = ('[Audio] ' + evEnmascarar(evQuitarDelimitadores(au.texto))).slice(0, EV_TOPE_TEXTO_HIST);
} else if (lec) {
  turno = evEtiquetaImagen(lec, t.pie);
  rotulado = true;
  entrada = evHistorialImagen(lec, t.pie);
}
const cuerpo = evCuerpoModelo(cfg, turno, historia, { artes: ficha.artes }, { rotulado: rotulado, tope: deAudio ? 1700 : 1200 });
return salir({ tipo: 'modelo', origen: deAudio ? 'audio' : (lec ? 'imagen' : 'texto'), textoCliente: (deAudio ? au.texto : String(t.texto || '')).slice(0, 500) },
  { llamarModelo: true, cuerpoModelo: cuerpo, entradaHistorial: entrada });
