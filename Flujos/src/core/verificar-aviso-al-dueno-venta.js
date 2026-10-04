// VERIFICA QUE EL AVISO AL DUENO FUE ACEPTADO (regla R1/R5 del plan de entrega, 03/10/2026).
//
// Cuelga de `Avisar al dueño`, que comparten el pedido confirmado, el QR no
// enviado, el cobro y el uso extendido. Ese envio tiene `continueRegularOutput`
// (un aviso rechazado no debe cortar el turno del cliente: ya recibio su
// respuesta, y el registro del cierre de venta viene despues en el lienzo) y
// por eso un rechazo de Meta era un item con `error` que nadie leia. Aca se
// lee: el aviso fue ACEPTADO solo si Meta devolvio un id de mensaje.
//
// NO CORTA LA EJECUCION a proposito: un `throw` aca detendria las ramas que
// siguen (registrar el cierre de la venta). Deja `avisoAceptado: false` y, en
// `avisoError`, solo el codigo y el subcodigo de Meta (nunca su mensaje, que
// puede traer datos). Eso queda EN LOS DATOS DE LA EJECUCION: no se promete
// ninguna linea en el registro del servidor (depende de la configuracion de la
// VM).
//
// LIMITE: el id de Meta prueba que Meta ACEPTO el mensaje, no que el dueño lo
// recibio (la entrega real llega despues por un acuse asincrono, y fuera de la
// ventana de 24 h de servicio un texto libre puede no llegar). La solucion de
// fondo (una plantilla aprobada para el aviso) la decide Andres.
//
// NO ENVIA NADA: cuesta CERO mensajes de WhatsApp.
return $input.all().map((s, i) => {
  const j = s.json ?? {};
  const aceptado = String((((j.messages ?? [])[0]) ?? {}).id ?? '') !== '';
  const e = (j.error && typeof j.error === 'object') ? j.error : {};
  const avisoError = aceptado ? undefined : { code: e.code ?? e.httpCode ?? null, subcode: e.error_subcode ?? null };
  return { json: { ...j, avisoAceptado: aceptado, ...(avisoError ? { avisoError } : {}) }, pairedItem: { item: i } };
});
