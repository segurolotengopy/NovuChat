// OMITIR A LOS CONTACTOS BLOQUEADOS (recordatorios de cita).
//
// Un contacto bloqueado (bloquear contacto, conversaciones.md §13) no debe
// recibir un recordatorio. Este nodo corre despues de «Estado del contacto»,
// que consulta a `configuracionFlujo` una vez por recordatorio y devuelve la
// respuesta completa (statusCode + body). Se empareja por INDICE con lo que
// salio de «Preparar recordatorios».
//
// REGLA: se omite SOLO si statusCode === 200 y atencion.bloqueadoPorContacto
// === true (el booleano exacto). Un 409, la pausa por persona, atencion:null,
// 'true', 1 o un objeto NO omiten.
//
// FALLA ABIERTA (decision de Andres, D3=a): ante error, tiempo de espera,
// respuesta ilegible o cantidades distintas, el recordatorio SE ENVIA IGUAL y
// queda el motivo «bloqueo sin verificar». Nunca se pierden todos los
// recordatorios por una caida de la Function. Este nodo solo QUITA envios.
// No registra telefonos completos: solo cuentas.
//
// pairedItem apunta SIEMPRE a una entrada que existe en «Estado del contacto»
// (indice < respuestas.length; si hay menos respuestas que originales, se
// acota al ultimo). Los nodos siguientes no dependen de ese indice: leen
// $('Omitir bloqueados').item.json (lleva el JSON original completo) y
// $('Config del recordatorio').first().
// Sin conversacion (atencion:null) se envia igual con el motivo «sin conversacion».
const originales = $('Preparar recordatorios').all();
const respuestas = $input.all();
const MOTIVO = 'bloqueo sin verificar';
const SIN_CONVERSACION = 'sin conversación';
const par = (i) => (respuestas.length ? { pairedItem: { item: Math.min(i, respuestas.length - 1) } } : {});

function bloqueado(r) {
  try {
    if (!r || !r.json) return false;
    const j = r.json;
    if (j.statusCode !== 200) return false;
    let cuerpo = j.body;
    if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
    return !!(cuerpo && cuerpo.atencion && cuerpo.atencion.bloqueadoPorContacto === true);
  } catch (e) {
    return false;
  }
}

function sinConversacion(r) {
  try {
    let cuerpo = r.json.body;
    if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
    return cuerpo.atencion === null || cuerpo.atencion === undefined;
  } catch (e) {
    return false;
  }
}

function verificado(r) {
  // 200 con un cuerpo legible es una respuesta de verdad; el resto no se pudo verificar.
  try {
    if (!r || !r.json || r.json.error || r.json.statusCode !== 200) return false;
    let cuerpo = r.json.body;
    if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
    return !!cuerpo && typeof cuerpo === 'object';
  } catch (e) {
    return false;
  }
}

const parejas = originales.length === respuestas.length;
const salida = [];
let omitidos = 0;
let sinVerificar = 0;

for (let i = 0; i < originales.length; i++) {
  const json = originales[i].json;
  if (!parejas) {
    sinVerificar++;
    salida.push({ json: { ...json, bloqueoMotivo: MOTIVO }, ...par(i) });
    continue;
  }
  if (bloqueado(respuestas[i])) { omitidos++; continue; }
  if (!verificado(respuestas[i])) {
    sinVerificar++;
    salida.push({ json: { ...json, bloqueoMotivo: MOTIVO }, ...par(i) });
    continue;
  }
  if (sinConversacion(respuestas[i])) {
    salida.push({ json: { ...json, bloqueoMotivo: SIN_CONVERSACION }, ...par(i) });
    continue;
  }
  salida.push({ json, ...par(i) });
}

console.log(`recordatorios: ${originales.length}, omitidos por bloqueo: ${omitidos}, sin verificar (se envian): ${sinVerificar}`);
return salida;
