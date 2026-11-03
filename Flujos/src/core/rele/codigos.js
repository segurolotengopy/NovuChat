// CÓDIGOS DEL RELÉ B9 (módulo común de envío por el relé, PR 1 de la migración de los flujos de Rubén Roca).
//
// Se pega DELANTE de `decidir-envio.js` en el nodo Code «Leer respuesta del relé» (lo hace `envio.mjs`): el Code de n8n no tiene módulos.
// JavaScript plano: sin require, URL, Buffer ni crypto.
//
// Las listas son las mismas de `core/salida-persona/resultado-del-envio.js` (contrato H2 §4): son LISTA PERMITIDA. Solo es rechazo seguro lo que el
// relé rechaza ANTES de llamar a Meta, o un rechazo de Meta (WM-3040) con un código de Meta conocido. Todo lo demás es `incierto`: el mensaje pudo salir.
//
//   WM-3010 3011 3012 ... autenticación, pedido inválido, número ajeno
//   WM-3031 3032 3033 3034 ... falta de clave, link de medio (3032 rechaza CUALQUIER link), tope, token del cliente
//   WM-3035 ... otro pedido igual en curso (409): se espera 2 a 3 s y se repite con la MISMA clave
//   WM-3037 ... tope por minuto (429): una espera de 61 a 64 s y se repite con la MISMA clave
//   WM-3038 ... saturación (reintentable)
//   WM-3039 ... medio mayor de 16 MiB (413): nunca se reintenta
//   WM-3040 ... Meta rechazó; `metaCodigo` dice por qué (un id de medio vencido también da 502 WM-3040, no 404)
//   WM-3041 ... 504, el relé no sabe si Meta lo aceptó: NUNCA se reenvía
//   WM-3042 ... tipo de contenido inválido del medio
const RELE_PREVIOS = ['WM-3010', 'WM-3011', 'WM-3012', 'WM-3031', 'WM-3032', 'WM-3033', 'WM-3034', 'WM-3037', 'WM-3038', 'WM-3039'];
const RELE_METAS = ['131047', '131026', '131049', '131051', '131052', '131053', '130429'];
// Cuántas veces se repite el MISMO mensaje (con la misma Idempotency-Key) por cada causa.
const RELE_TOPE_429 = 1;
const RELE_TOPE_409 = 2;
const RELE_PAUSAS_REINTENTABLE_S = [2, 8];
// Estos NUNCA se repiten, diga lo que diga el relé en `reintentable`: el mismo pedido fallaría igual (un link, un medio de más de 16 MiB).
const RELE_NUNCA_REINTENTAR = ['WM-3032', 'WM-3039'];
