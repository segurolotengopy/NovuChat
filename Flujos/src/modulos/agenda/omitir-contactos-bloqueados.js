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
// Cada item de salida lleva pairedItem con el indice ORIGINAL: los nodos
// siguientes usan $('Preparar recordatorios').item.
const originales = $('Preparar recordatorios').all();
const respuestas = $input.all();
const MOTIVO = 'bloqueo sin verificar';

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
    salida.push({ json: { ...json, bloqueoMotivo: MOTIVO }, pairedItem: { item: i } });
    continue;
  }
  if (bloqueado(respuestas[i])) { omitidos++; continue; }
  if (!verificado(respuestas[i])) {
    sinVerificar++;
    salida.push({ json: { ...json, bloqueoMotivo: MOTIVO }, pairedItem: { item: i } });
    continue;
  }
  salida.push({ json, pairedItem: { item: i } });
}

console.log(`recordatorios: ${originales.length}, omitidos por bloqueo: ${omitidos}, sin verificar (se envian): ${sinVerificar}`);
return salida;
