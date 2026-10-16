// SALIDA DE PERSONA, paso 1: ¿este toque es para este flujo?
//
// El flujo atiende UN numero (se instala por alias: la misma plantilla con otro
// `phoneNumberId` en `Config base`). Dos disparadores llegan aqui: el
// timbre de la Function (POST sin datos) y el barrido de cada minuto, que
// reclama igual por si un timbre se perdio.
//
// - Sin `phoneNumberId` configurado el flujo NO corre: un error visible en la
//   ejecucion, nunca un reclamo con un numero de marcador.
// - Un timbre que trae `X-NovuChat-Numero` de OTRO numero se descarta: la ruta
//   del webhook ya es de este numero, esto es solo un cinturon.
// - La clave y la firma del timbre las verifica el Header Auth del webhook; este
//   nodo no tiene `crypto` y no las toca.
const cfg = $('Config base').first().json;
const numero = String(cfg.phoneNumberId ?? '').trim();
if (!/^[0-9]{8,20}$/.test(numero)) {
  throw new Error('Salida de persona: Config base no tiene el phoneNumberId de este flujo.');
}

const timbre = $('Timbre');
let origen = 'barrido';
if (timbre.isExecuted) {
  origen = 'timbre';
  const cabeceras = (timbre.first().json.headers) || {};
  const deQuien = String(cabeceras['x-novuchat-numero'] ?? '').trim();
  if (deQuien && deQuien !== numero) return [];
}

return [{ json: { origen, phoneNumberId: numero } }];
