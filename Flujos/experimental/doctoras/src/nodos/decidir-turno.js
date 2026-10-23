// DECIDIR TURNO: el CÓDIGO decide qué pasa en este turno. El modelo, a lo más, CLASIFICA el mensaje en una lista cerrada y escribe UNA línea de empatía; ningún texto de contenido sale de él.
// Devuelve un `plan` (nada de texto libre del modelo sale de aquí):
//
//   nada         la puerta cerró el turno, la persona pidió la baja antes (cero mensajes) o es una pausa por persona;
//   riesgo       violencia o miedo (texto, transcripción, texto leído de una imagen o pie de foto): texto fijo, sin recursos ni números, con `no_contactar`;
//   baja         «no me escribas más»: UN mensaje de confirmación con `no_contactar`; desde entonces, cero mensajes (48 h de ficha);
//   apertura     el PRIMER turno: DOS mensajes (la presentación y la pregunta), todavía ningún catálogo;
//   lista        la lista de tratamientos (desde el turno siguiente), con una respuesta de contenido delante si la hay;
//   texto        la respuesta de contenido de una intención (texto fijo del dato de la doctora), con los botones que aún no pulsó;
//   tratamiento  qué es un tratamiento (frase del dato de la doctora) y «la doctora define en la valoración»;
//   recepcion    texto fijo + botón de la recepción (+ aviso a recepción solo si la persona dio su consentimiento): dirección, ¿eres una IA?, urgencia o consulta médica, lo que no se sabe;
//   consentimiento / pedir_nombre / pedir_contacto / pedir_otro_numero / pedir_horario / derivado   los pasos de la solicitud de valoración;
//   libre        un texto que ninguna regla reconoce: llama al modelo para clasificarlo (0 o 1 llamada por turno);
//   imagen_otra, documento (de salud), audio_fijo, archivo, otro, arte   lo que no es texto.
//
// EL CONSENTIMIENTO va ANTES de pedir nombre, WhatsApp u horario, y sin «sí» no hay aviso a recepción ni plantilla. La ficha no guarda lo que la persona escribió fuera de su nombre, su número y su horario, y los borra al derivar.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const base = cnPrimero('Config base') || {};
const datos = drDatosVivos(base, cnPrimero('Traer configuración'));
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const ficha = drFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, llamarModelo: false, cuerpoModelo: null, modelo: DR_MODELO }, extra || {}) }];

// 0. La baja de antes: cero mensajes. La protección ante violencia o miedo va PRIMERO, también con la puerta cerrada: un texto de riesgo recibe el texto de protección y reporta `no_contactar`, nunca el texto neutro.
//    La pausa por persona («bloqueado») sigue en silencio: ahí responde una persona.
if (ficha.baja) return salir({ tipo: 'nada' });
const puertaResponde = puerta.ruta === 'sigue' || puerta.ruta === 'suspendido' || (puerta.ruta === 'uso_extendido' && puerta.responder === true);
if (puertaResponde && puerta.ruta !== 'sigue' && (ficha.riesgo || t.riesgoEscrito === true)) return salir({ tipo: 'riesgo' });
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });

// El medio de este turno (solo uno de estos nodos corrió) y lo que se leyó en él.
const prep = cnPrimero('Preparar imagen') || cnPrimero('Preparar transcripción') || cnPrimero('Medio no aceptado') || {};
const entradaMedio = String(prep.userInput || '');
const esAudio = t.esMedioAudio === true;
const esVisual = t.esMedioVisual === true;
const categoriaMedio = String(prep.categoriaMedio || '');
// El texto leído en la imagen es un DATO de la persona: solo sirve para reconocer el arte y para detectar riesgo; nunca llega al modelo.
const jsonImagen = esVisual ? (cnJsonDeGemini(cnPrimero('Describir documento') || cnPrimero('Describir imagen')) || {}) : {};
const leido = esVisual && typeof jsonImagen.texto === 'string' ? drLineaCliente(jsonImagen.texto, 500) : '';
// La nota de voz: el texto transcrito (la primera línea), o la falla.
let transcrito = '';
let falloAudio = '';
if (esAudio) {
  if (/^\(audio transcripto\) /.test(entradaMedio)) transcrito = entradaMedio.slice('(audio transcripto) '.length).split('\n')[0].trim();
  else if (/más de cinco minutos/.test(entradaMedio)) falloAudio = 'largo';
  else if (/no se pudo entender/.test(entradaMedio)) falloAudio = 'no_entendido';
  else falloAudio = 'no_abierto';
}
const textoCliente = t.tipo === 'interactive' ? '' : (esAudio ? transcrito : String(t.texto || ''));
const norm = drNorm(textoCliente);

// 1. VIOLENCIA O MIEDO: antes que cualquier otra cosa. Se mira el texto, la transcripción, el texto leído de la imagen y el pie de foto; una vez activada, sigue activa 48 horas. Sin recursos, sin números, sin consejos.
if (ficha.riesgo || drEsRiesgo(drNorm([textoCliente, leido, t.pie].join(' ')))) return salir({ tipo: 'riesgo' });
// 2. LA BAJA: escrita (la detecta «Normalizar entrada») o dicha en una nota de voz.
if (t.bajaEscrita === true || (esAudio && drEsBaja(transcrito))) return salir({ tipo: 'baja' });
// 3. URGENCIA O PREGUNTA MÉDICA PERSONAL: texto fijo y derivación, cero consejo, antes que la presentación y que cualquier otra cosa.
const medica = { tipo: 'recepcion', clave: 'medica', motivo: 'consulta médica', aviso: true, claveAviso: 'consulta_medica' };
if (drIntencion(norm) === 'medica') return salir(medica);

// 4. Una imagen o un documento.
let entrada = null;   // el arte o el mensaje prellenado que la persona trae
if (esVisual) {
  if (cnNodo('Medio no aceptado')) return salir({ tipo: 'archivo', pesado: /demasiado pesado/.test(entradaMedio) });
  if (categoriaMedio === 'documento_salud') return salir({ tipo: 'recepcion', clave: 'medica_documento', motivo: 'envió un documento de salud', aviso: true, claveAviso: 'documento_salud' });
  entrada = categoriaMedio === 'publicidad' ? drEntrada(drNorm(leido), datos, true) : null;
  if (!entrada) return salir({ tipo: 'imagen_otra' });
}
// 5. Una nota de voz que no se pudo usar.
if (esAudio && falloAudio) return salir({ tipo: 'audio_fijo', causa: falloAudio });
// 6. Lo que este canal no lee.
if (t.categoria === 'otro') return salir({ tipo: 'otro' });
if (!entrada && textoCliente) entrada = drEntrada(norm, datos);

// 7. EL PRIMER TURNO: DOS mensajes (la presentación y la pregunta). Todavía NINGÚN catálogo, aunque la persona traiga un arte o un mensaje prellenado.
if (!ficha.saludado) return salir({ tipo: 'apertura', entrada: entrada ? entrada.id : '', aperturaArte: entrada ? entrada.apertura : '' });

const etapaCatalogo = ficha.etapa === 'catalogo';
const cancela = /\b(cancelar|cancela|ya no quiero|mejor no|no quiero seguir|dejalo)\b/.test(norm);
const SIGUE = ['consentimiento', 'nombre', 'contacto', 'contacto_otro', 'horario'];
const enPaso = SIGUE.indexOf(ficha.etapa) >= 0;
const solicitud = (horario) => ({
  tipo: 'derivado', horario: drLineaCliente(horario, 100).replace(/\s+/g, ' ').trim(),
  aviso: { tipo: 'solicitud', clave: 'solicitud', motivo: 'solicitud de valoración' },
});
const pasoHorario = () => ({ tipo: 'pedir_horario' });

// 8. Un toque (solo si llegó como interactivo y tiene la forma esperada).
if (t.tipo === 'interactive') {
  const id = String(t.seleccionId || '');
  if (/^c_si\d?$/.test(id) && ficha.etapa === 'consentimiento') return salir({ tipo: 'pedir_nombre', consentimiento: 'si' });
  if (/^c_no\d?$/.test(id) && ficha.etapa === 'consentimiento') return salir({ tipo: 'consentimiento_no' });
  if (id === 'n_este' && ficha.etapa === 'contacto') return salir(Object.assign(pasoHorario(), { contacto: from }));
  if (id === 'n_otro' && ficha.etapa === 'contacto') return salir({ tipo: 'pedir_otro_numero' });
  if (id === 'a_agendar') return salir(drPlanDeIntencion('agendar', ficha, datos, false));
  if (id === 'a_duda') return salir({ tipo: 'texto', clave: 'duda', sinOfertas: true });
  if (id === 'a_lista') return salir({ tipo: 'lista' });
  const m = /^t_([a-z0-9]{1,12})$/.exec(id);
  if (m && drTratamientoPorId(datos, m[1])) return salir({ tipo: 'tratamiento', id: m[1] });
  // Un toque viejo o de otro mensaje: nunca se toma por una conversación libre. En un paso, se repite la pregunta; si no, la lista.
  if (ficha.etapa === 'consentimiento') return salir({ tipo: 'consentimiento', repite: true });
  if (ficha.etapa === 'contacto') return salir({ tipo: 'pedir_contacto', repite: true });
  return salir({ tipo: 'lista' });
}

// 9. Los pasos de la solicitud de valoración (texto escrito o transcrito).
if (enPaso && cancela) return salir({ tipo: 'cancelar' });
if (ficha.etapa === 'consentimiento') {
  const r = drRespuestaConsentimiento(norm);
  if (r === 'si') return salir({ tipo: 'pedir_nombre', consentimiento: 'si' });
  if (r === 'no') return salir({ tipo: 'consentimiento_no' });
  return salir({ tipo: 'consentimiento', repite: true });
}
if (ficha.etapa === 'nombre') {
  const n = drNombre(textoCliente);
  if (n === '' && ficha.reintentos < 1) return salir({ tipo: 'nombre_repetir' });
  return salir({ tipo: 'pedir_contacto', nombre: n });
}
if (ficha.etapa === 'contacto') {
  const num = drNumero(textoCliente);
  if (num !== '') return salir(Object.assign(pasoHorario(), { contacto: num }));
  if (/\b(este|mismo|aqui|si)\b/.test(norm)) return salir(Object.assign(pasoHorario(), { contacto: from }));
  return salir({ tipo: 'pedir_contacto', repite: true });
}
if (ficha.etapa === 'contacto_otro') {
  const num = drNumero(textoCliente);
  if (num === '' && ficha.reintentos < 1) return salir({ tipo: 'pedir_otro_numero', repite: true });
  return salir(Object.assign(pasoHorario(), { contacto: num || from }));
}
if (ficha.etapa === 'horario') {
  if (norm === '') return salir({ tipo: 'pedir_horario', repite: true });
  // Una pregunta («¿cuánto cuesta?», «¿es gratis?», «¿dónde queda?») NO es el horario: se repite la pregunta del horario, sin derivar.
  if (['precio', 'gratis', 'sin_compromiso', 'donde', 'diferencia', 'cual_mejor', 'dolor', 'resultados', 'antes_despues', 'recuperacion', 'artificial', 'probe_otros', 'quien', 'que_es', 'ia', 'lista'].indexOf(drIntencion(norm)) >= 0) return salir({ tipo: 'pedir_horario', repite: true });
  return salir(solicitud(textoCliente));
}

// 10. Una arte capturado a mitad de la charla.
if (entrada && esVisual) return salir({ tipo: 'arte', entrada: entrada.id, aperturaArte: entrada.apertura });

// 11. Texto libre: un tratamiento nombrado, una intención reconocida por código o, si ninguna regla la reconoce, el modelo CLASIFICA.
const intencion = drIntencion(norm);
const tr = drTratamiento(norm, datos);
if (tr && ['', 'que_es', 'saludo', 'lista', 'quien'].indexOf(intencion) >= 0) return salir({ tipo: 'tratamiento', id: tr });
if (intencion) return salir(drPlanDeIntencion(intencion, ficha, datos, etapaCatalogo));
if (norm === '') return salir({ tipo: 'lista' });
return salir({ tipo: 'libre', etapaCatalogo: etapaCatalogo }, { llamarModelo: true, cuerpoModelo: drCuerpoModelo(textoCliente, base.temperatura) });
