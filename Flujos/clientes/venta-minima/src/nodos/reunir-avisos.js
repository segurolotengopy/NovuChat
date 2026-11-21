// REUNIR AVISOS (Venta mínima v0): de lo que devolvió `Enviar aviso` deja SOLO lo que hay que reintentar.
//
// POR QUÉ EXISTE. Con `executionOrder: v1` un nodo que recibe datos por dos ramas corre dos veces. Si
// `¿Falló el aviso?` repartiera los avisos de a uno (uno salió, otro falló), `Armar mensajes` correría
// dos veces y el cliente recibiría su respuesta duplicada. Aquí se junta todo en UNA sola decisión:
//
//   - hay avisos que fallaron y tienen respaldo (un payload Graph completo) -> sale un ítem por cada
//     uno, con el aviso armado tal cual (`respaldo` incluido), y van a `Aviso de respaldo`;
//   - no hay ninguno -> sale UN ítem `{sinRespaldos: true}` y el flujo sigue directo a `Armar mensajes`.
//
// «Falló» = la respuesta de Meta no trae `messages[0].id`: un error, un cuerpo vacío o un nodo que no
// corrió no cuentan como enviado (el mismo criterio que usa `Armar mensajes` para decir «el aviso salió»).
// Un aviso sin respaldo (`respaldo: null`, como el detalle de texto) no se reintenta: con la ventana
// abierta el detalle YA es el respaldo de la plantilla. Quién lee el resultado final de los envíos es
// `Armar mensajes`, por nombre de nodo; este nodo solo decide a quién se reintenta.
const RA_enviados = $input.all();
const RA_armados = $('Armar avisos').all();
const RA_reintentar = [];
RA_enviados.forEach((it, i) => {
  const j = (it && it.json) || {};
  const m = j.messages;
  const salio = Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
  const armado = (RA_armados[i] && RA_armados[i].json) || {};
  const r = armado.respaldo;
  if (!salio && r && typeof r === 'object' && !Array.isArray(r)) {
    RA_reintentar.push({ json: Object.assign({}, armado), pairedItem: { item: i } });
  }
});
if (!RA_reintentar.length) return [{ json: { sinRespaldos: true } }];
return RA_reintentar;
