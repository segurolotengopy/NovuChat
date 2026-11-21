// SIMULAR AVISO (Venta mínima v0): solo en MODO PRUEBA SIN `enviarDeVerdad`. Ahí `Enviar aviso` no corre
// (no se manda nada a nadie) y, sin este nodo, `Armar mensajes` no vería ningún `wamid` y el cliente de la
// prueba leería «No pude pasarle tu pedido al restaurante», aunque el aviso se hubiera armado bien.
//
// Por cada aviso armado devuelve la forma de una respuesta aceptada de Meta con un `wamid` MARCADO como
// simulado, para que el ensayo recorra el mismo camino que producción. `Armar mensajes` lo lee junto a
// los de `Enviar aviso` (un solo aviso real o simulado por turno: son ramas excluyentes).
//
// NUNCA corre en producción: `¿Avisar de verdad?` solo manda aquí cuando `modoPrueba` es true y
// `enviarDeVerdad` no lo es, y `modoPrueba` solo lo activa el nodo `Entrada de prueba`, que el JSON de
// producción no tiene.
const SA_items = $input.all();
return SA_items.map((it, i) => ({
  json: { messages: [{ id: 'wamid.SIMULADO-' + (i + 1) }], simulado: true, para: String((it && it.json && it.json.para) || '') },
  pairedItem: { item: i },
}));
