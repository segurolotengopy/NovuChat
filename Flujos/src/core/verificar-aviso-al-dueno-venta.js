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
// `avisoError`, el codigo de Meta sacado del texto del error. El item conserva
// ademas el `error` que n8n puso (con el mensaje de Meta): todo queda EN LOS
// DATOS DE LA EJECUCION. No se promete ninguna linea en el registro del
// servidor (depende de la configuracion de la VM).
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
  // En n8n 2.36.5, con `continueRegularOutput`, `json.error` es TEXTO («(#131047) …»), no un
  // objeto: el codigo de Meta se saca del texto. Mismo criterio que `Marcar aviso de transferencia`.
  const textoError = (j.error && typeof j.error === 'object') ? String(j.error.message ?? '') : String(j.error ?? '');
  const avisoError = aceptado ? undefined : { code: Number((/\(#(\d+)\)/.exec(textoError) ?? [])[1]) || null };
  return { json: { ...j, avisoAceptado: aceptado, ...(avisoError ? { avisoError } : {}) }, pairedItem: { item: i } };
});
