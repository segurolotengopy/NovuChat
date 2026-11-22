// MÓDULO PEDIDOS — LA PLANTILLA DEL AVISO AL COMERCIO FUERA DE LA VENTANA, «código para las dos» (Andres, 18/11/2026; 22/11/2026: sube de Walisuma a común).
// Se INCLUYE en los flujos que lo usan (construir.mjs, paquete `aviso-plantilla`), nunca se copia. Funciones puras, sin red ni globales de Node.
//
// POR QUÉ EXISTE. Fuera de la ventana de 24 h de Meta el aviso solo puede salir por plantilla. La de 4 variables (`pedido_registrado`) no tiene dónde llevar el nombre ni el WhatsApp del cliente:
// el comercio recibía «Se registró una solicitud… Total: — Entrega: sin pedido» sin saber de quién. La de 10 variables (`aviso_pedido_equipo`) los lleva. Elegirla es DATO de «Config base»
// (`avisoPedidoPlantilla`/`avisoPedidoEstado`, `avisoRespaldoPlantilla`/`avisoRespaldoEstado`, `avisoPlantillaIdioma`); sin ninguna APPROVED no hay plantilla (nunca se inventa).
//
//   {{1}} el pedido (o «Consulta: motivo») y el estado del comprobante  {{2}} el total  {{3}} modalidad y envío  {{4}} el nombre  {{5}} el WhatsApp  {{6}} la factura
//   {{7}} la dirección y el GPS (o el mensaje del cliente en una consulta)  {{8}} las piezas  {{9}} el banco de origen  {{10}} el n.º de operación
function apPlantillaAviso(base) {
  const b = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const idioma = String(b.avisoPlantillaIdioma === undefined ? '' : b.avisoPlantillaIdioma).trim();
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(idioma)) return null;
  const una = (n, e, variables) => {
    const nombre = String(n === undefined ? '' : n).trim();
    const estado = String(e === undefined ? '' : e).trim().toUpperCase();
    return /^[a-z0-9_]{1,100}$/.test(nombre) && estado === 'APPROVED' ? { nombre: nombre, idioma: idioma, variables: variables } : null;
  };
  return una(b.avisoPedidoPlantilla, b.avisoPedidoEstado, 10) || una(b.avisoRespaldoPlantilla, b.avisoRespaldoEstado, 4);
}
// Los parámetros de un aviso de CONSULTA (una derivación): el nombre y el WhatsApp del cliente SIEMPRE viajan. `mensaje` ya viene limpio (sin enlaces ni «»).
// Devuelve las dos listas: la de 10 variables y la de 4 (la de respaldo, con el cliente empaquetado en {{3}}).
function apParametrosConsulta(motivo, nombre, telefono, mensaje) {
  const quien = String(nombre || '') !== '' ? String(nombre) : 'sin nombre';
  const wa = '+' + String(telefono || '').replace(/\D/g, '');
  const m = String(motivo || '') !== '' ? String(motivo) : 'consulta';
  const msg = String(mensaje || '');
  return {
    p10: ['Consulta: ' + m, '—', '—', quien, wa, '—', '—', msg !== '' ? 'Mensaje del cliente: ' + msg : '—', '—', '—'],
    p4: ['Consulta: ' + m, '—', quien + ' (' + wa + ')', 'sin pedido'],
  };
}
