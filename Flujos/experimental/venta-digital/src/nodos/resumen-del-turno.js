// RESUMEN DEL TURNO: el último nodo. En producción no hace nada visible. En la variante de prueba, «Entrada de prueba» responde con lo que devuelve este nodo (modo `lastNode`):
// los mensajes del turno y un resumen, para que un corredor externo evalúe cada turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y no de lo que devolvieron los nodos de envío ni de reporte (un nodo desactivado deja pasar su entrada). Cuelga de «Armar mensajes» por debajo
// de todo el lienzo, así que con `executionOrder: v1` corre después de los envíos y del cierre.
const items = cnTodos('Armar mensajes');

// ENTREGA (regla I-ENTREGA, «se entrega lo que se promete»): este nodo corre DESPUÉS de los envíos (está abajo en el lienzo y `executionOrder` es v1). Un mensaje al cliente cuenta como
// entregado SOLO si Meta devolvió un `messages[0].id` no vacío, por el envío principal o por su respaldo en texto. Si hubo mensajes que no salieron ni por uno ni por el otro, la
// ejecución termina en ERROR (visible en n8n) en vez de en `success`. No se reporta nada como enviado (`¿Meta aceptó?` exige el id) y el error no lleva texto ni número del cliente.
// Con el envío saltado (modo prueba sin `enviarDeVerdad`) `Enviar a WhatsApp` no corrió y no hay nada que verificar.
const entregado = (j) => {
  const m = j && j.messages;
  return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
};
if (cnNodo('Enviar a WhatsApp')) {
  // REVERSIÓN DE LA FICHA (parámetro del flujo, no lógica de un negocio): «Armar mensajes» escribe la ficha ANTES de enviar y deja en el ítem 0 lo que hay que devolver si el mensaje no salió.
  //   revertirSiFalloElPrincipal  se aplica si el envío PRINCIPAL no devolvió `messages[0].id` (aunque el respaldo en texto haya salido): lo que solo vale si salió el mensaje bueno (p. ej. un cobro abierto);
  //   revertirFicha               se aplica si no salió nada al cliente (ni el envío ni su respaldo).
  // Cada una es un objeto plano `{ campo: valorAnterior }`; solo se copian campos con nombre simple. La ficha se busca por `from` (nunca por otro dato).
  const desde = String((items[0] || {}).from || '');
  const copiar = (rev) => {
    if (!rev || typeof rev !== 'object' || Array.isArray(rev)) return;
    const fichas = cnMapaDeFichas(true);
    const ficha = cnFichaDe(fichas.mapa, desde);
    if (!ficha) return;
    for (const k of Object.keys(rev)) {
      if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) && k !== 'constructor' && k !== 'prototype') ficha[k] = rev[k];
    }
  };
  if (!cnTodos('Enviar a WhatsApp').some(entregado)) copiar((items[0] || {}).revertirSiFalloElPrincipal);
  if (!cnTodos('Enviar a WhatsApp').some(entregado) && !cnTodos('Enviar respaldo').some(entregado)) copiar((items[0] || {}).revertirFicha);
  const esperados = items.filter((i) => i && i.sinMensajes !== true).length;
  const entregados = cnTodos('Enviar a WhatsApp').filter(entregado).length + cnTodos('Enviar respaldo').filter(entregado).length;
  if (entregados < esperados) {
    throw new Error('Entrega fallida: Meta rechazó el envío y su respaldo en texto; ' + (esperados - entregados) + ' de ' + esperados + ' mensaje(s) al cliente sin entregar. El cliente no recibió respuesta.');
  }
}
const cfg = cnCfg();
const primero = items[0] || {};
const mensajes = items.filter((i) => i && i.sinMensajes !== true).map((i) => ({
  para: i.para, destino: i.destino, payload: i.payload, texto: i.texto, respaldo: i.respaldo, reportar: i.reportar === true,
}));
const r = primero.resumen || { plan: primero.plan || 'nada', mensajes: 0 };
return [{ json: {
  ok: true,
  modoPrueba: cfg.modoPrueba === true,
  mensajes: mensajes,
  resumen: Object.assign({}, r, { mensajesSalientes: mensajes.length }),
} }];
