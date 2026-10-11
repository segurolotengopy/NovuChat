// PROSPECTO PARA LA PLANILLA: deja pasar a la planilla SOLO el prospecto que «Armar mensajes» decidio guardar
// (`guardarPlanilla`: hay id y hoja en `Config base` y la ficha cambio). Si no hay ninguno, no devuelve nada y Google ni se
// consulta. Quien ya es cliente nunca llega aca: `ccProspecto` lo deja en null.
//
// EL ORDEN IMPORTA (`executionOrder: v1`). Esta rama cuelga de «Armar mensajes» por debajo del envio al cliente y del CRM, y por
// encima de «Confirmar envío»: guardar no demora la respuesta. Si Meta rechazo el mensaje y «Confirmar envío» termina en error,
// la fila ya quedo guardada: el dato del prospecto es real aunque la respuesta no haya salido.
// MENSAJES: ninguno.
const out = [];
$input.all().forEach((it, i) => {
  const e = it.json;
  const p = e.prospectoPlanilla;
  if (e.guardarPlanilla !== true || !p || typeof p !== 'object' || !p.telefono) return;
  out.push({ json: Object.assign({}, p), pairedItem: { item: i } });
});
return out;
