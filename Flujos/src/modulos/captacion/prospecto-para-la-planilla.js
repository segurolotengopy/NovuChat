// PROSPECTO PARA LA PLANILLA: deja pasar a la planilla SOLO los prospectos que
// `Salida` decidio guardar (`guardarPlanilla`: hay id en `Config base` y la
// ficha cambio). Si no hay ninguno, no devuelve nada y Google ni se consulta.
//
// EL ORDEN IMPORTA (`executionOrder: v1`). Esta rama cuelga de `Salida` por
// debajo del envio al cliente, del aviso y del CRM, y por encima de
// `Confirmar envio`: guardar no demora la respuesta, y `Confirmar envio` puede
// anotar un fallo (`planilla_no_guardada`) en los avisos del turno. Si Meta
// rechazo el mensaje y `Confirmar envio` termina en error, la fila ya quedo
// guardada: el dato del prospecto es real aunque la respuesta no haya salido.
//
// EL ID Y LA HOJA los usan los nodos de Google directamente desde
// `Config del negocio`, que los toma de `Config base` y los valida. Aca solo se
// comprueba que haya id: sin el, no pasa nada aunque llegue la marca.
//
// MENSAJES: ninguno.
const cfg = $('Config del negocio').first().json;
if (!String(cfg.planillaProspectosId ?? '').trim() || !String(cfg.planillaProspectosHoja ?? '').trim()) return [];

const out = [];
$input.all().forEach((it, i) => {
  const e = it.json;
  const p = e.prospectoPlanilla;
  if (e.guardarPlanilla !== true || !p || typeof p !== 'object' || !p.telefono) return;
  out.push({ json: { ...p }, pairedItem: { item: i } });
});
return out;
