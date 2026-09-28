// ¿HUBO UN CIERRE DE VENTA? POR HECHO, NO POR DICHO.
//
// LO QUE ESTE NODO DECIDÍA ANTES, Y POR QUÉ ESTABA MAL (Andres, 23/09/2026).
// Exigía dos cosas: que el cliente hubiera mandado una imagen o un documento, y
// que el texto del asistente contuviera la palabra «SIMULADO». La segunda es
// una AFIRMACIÓN DEL MODELO --lo que dijo, no lo que pasó--, y es exactamente
// el modo de fallo que costó las citas duplicadas del 17/09: una instrucción se
// ignora bajo insistencia y cambia con cada modelo. Con un prompt nuevo que ya
// no dice «SIMULADO» en esa frase, el cierre deja de registrarse y nadie se
// entera; con uno que la diga de más, se registra un cierre que nadie pagó.
// Y la primera tampoco alcanzaba sola: la foto de un gato es una imagen.
//
// LO QUE DECIDE AHORA. Dos HECHOS, ninguno escrito por el modelo:
//
//   1. HABÍA UN QR ESPERANDO. Lo dice el SERVIDOR, no el flujo: cuando el QR
//      salió, `Reportar QR (saliente)` lo reportó como `evento: 'qr_enviado'` y
//      la ingesta abrió la solicitud en la misma transacción que contó ese
//      mensaje. `configuracionFlujo` devuelve `cobro.pendiente`, y caduca sola
//      a las 24 h (`cobroVenta.ts`). El flujo solo lo lee.
//   2. EL CLIENTE MANDÓ EL ARCHIVO. Imagen **o documento**: lo encontramos
//      probando, porque WhatsApp clasifica como `document` el PDF del banco y
//      también la foto adjuntada como archivo. Exigir `image` dejaba afuera la
//      mitad de los comprobantes reales, sin un solo error a la vista.
//
// ESTE CAMINO ES EL DEL COBRO SIMULADO. Con cobro REAL el comprobante ni
// siquiera llega hasta acá: se desvía antes del agente, lo lee el modelo de
// visión y el cierre lo crea el SERVIDOR al cotejar (`cotejarComprobante`), con
// el monto y el resultado del cotejo adentro. Un cierre por cada camino, nunca
// dos: el de allá se llama `venta_<referencia>` y nace de otro lado.
//
// DE DÓNDE SALE CADA DATO, que es donde me equivoqué la primera vez:
// `Procesar respuesta` NO arrastra `tipo` ni `mensajeId`, y al texto del
// asistente lo llama `respuesta`, no `texto`. El tipo y el id del mensaje hay
// que ir a buscarlos al normalizador, con `.first()` y no `.item` --después de
// un nodo Code, `.item` puede no resolver.
// `$input.first().json` Y NO `$json` (23/09/2026). El nodo corre en el modo
// por defecto --«Run Once for All Items»-- y ahí `$json` no forma parte del
// contexto documentado del sandbox: no se pudo confirmar contra el paquete de
// n8n 2.36.5 que exista, y ninguna prueba lo ejecutaba nunca, así que el
// defecto habría aparecido recién en producción. Era el ÚNICO nodo Code de los
// cuatro flujos que lo usaba como variable; los demás lo nombran solo en
// comentarios. Con `$input.first().json` no hay nada que suponer, y es la forma
// que usa el resto del lienzo.
const item = $input.first().json;
const entrada = $('Normalizar entrada').first().json;

// `pagoDeclarado` es las dos condiciones juntas, calculadas en el normalizador
// con la configuración del servidor delante. Acá no se vuelve a deducir: un
// mismo hecho decidido en dos lugares termina decidiéndose distinto en uno.
const referencia = String(entrada.mensajeId ?? '');
const hayCierre = entrada.pagoDeclarado === true
  && referencia !== ''
  // Con cobro real el cierre lo crea el servidor; acá sería el segundo.
  && String(entrada.cobroRealActivo ?? '') !== 'si';

return [{ json: {
  ...item,
  hayCierre,
  referenciaCierre: referencia,
} }];
