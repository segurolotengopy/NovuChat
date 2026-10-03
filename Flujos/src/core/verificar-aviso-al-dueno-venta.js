// VERIFICA QUE EL AVISO AL DUENO SALIO (regla R1/R5 del plan de entrega, 03/10/2026).
//
// Cuelga de `Avisar al dueño`, que comparten el pedido confirmado, el QR no
// enviado, el cobro y el uso extendido. Ese envio tiene `continueRegularOutput`
// (un aviso rechazado no debe cortar el turno del cliente: ya recibio su
// respuesta, y el registro del cierre de venta viene despues en el lienzo) y
// por eso un rechazo de Meta era un item con `error` que nadie leia. Aca se
// lee: el aviso salio solo si Meta devolvio un id de mensaje.
//
// NO CORTA LA EJECUCION a proposito: un `throw` aca detendria las ramas que
// siguen (registrar el cierre de la venta). Deja `avisoEntregado: false` en el
// item y una linea `AVISO_AL_DUENO_NO_SALIO` en el registro de n8n.
//
// NO ENVIA NADA: cuesta CERO mensajes de WhatsApp.
return $input.all().map((s, i) => {
  const j = s.json ?? {};
  const entregado = String((((j.messages ?? [])[0]) ?? {}).id ?? '') !== '';
  if (!entregado) console.error('AVISO_AL_DUENO_NO_SALIO', JSON.stringify({ error: j.error ?? null }).slice(0, 300));
  return { json: { ...j, avisoEntregado: entregado }, pairedItem: { item: i } };
});
