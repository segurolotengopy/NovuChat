// EL MEDIO QUE NO SE BAJA: demasiado grande, o sin tamaño (revision de
// seguridad del PR #256, M2; 28/09/2026).
//
// «¿Tamaño aceptable?» corta ANTES de la descarga: un archivo de 50 MB no se
// baja, no se le manda a Gemini y no se paga. Aca se arma el aviso que recibe
// el agente, del mismo estilo que los de «Preparar transcripción». Sigue al
// agente como cualquier turno: CERO mensajes agregados, el cliente recibe la
// respuesta que ya iba a recibir, ahora diciendole que hacer.
//
// Los topes son los mismos que ya usaba el modulo comun: cinco minutos de audio
// (720 kB a 2.400 B/s medidos, «Preparar transcripción») y 5 MB para una foto o
// un PDF, que alcanza para cualquier captura o comprobante.
const MAX_AUDIO = 720000;
const MAX_ARCHIVO = 5000000;
const AUDIO_LARGO = 'AVISO_SISTEMA: el cliente mandó una nota de voz de más de cinco minutos. '
  + 'Dile con amabilidad que es muy larga para escucharla entera y pídele lo esencial '
  + 'en texto o en un audio más corto, y sigue atendiendo con normalidad.';
const ARCHIVO_PESADO = 'AVISO_SISTEMA: el cliente mandó una foto o un archivo demasiado pesado para abrirlo. '
  + 'Pídele con amabilidad uno más liviano, o que te escriba lo que necesita, y sigue atendiendo con normalidad.';
const SIN_ABRIR = 'AVISO_SISTEMA: llegó un archivo o una nota de voz pero no se pudo abrir. '
  + 'Pídele con amabilidad que lo reenvíe o que te lo escriba, y sigue atendiendo con normalidad.';

const entradas = $('Normalizar entrada').all();
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  // Emparejamiento por indice, nunca .first(): con dos clientes a la vez,
  // .first() le pondria el aviso de uno a la conversacion del otro.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;
  const tam = Number(items[i].json.file_size);
  const audio = ent.esMedioAudio === true;
  let userInput;
  if (!Number.isFinite(tam) || tam <= 0) userInput = SIN_ABRIR;
  else if (audio && tam > MAX_AUDIO) userInput = AUDIO_LARGO;
  else if (!audio && tam > MAX_ARCHIVO) userInput = ARCHIVO_PESADO;
  else userInput = SIN_ABRIR;
  out.push({ json: { ...ent, userInput }, pairedItem: { item: i } });
}
return out;
