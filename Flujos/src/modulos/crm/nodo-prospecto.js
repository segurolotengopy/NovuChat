// PROSPECTO PARA LA PLANILLA: deja pasar a la planilla SOLO el prospecto que «Armar mensajes» decidio guardar
// (`guardarPlanilla`: hay id y hoja en `Config base` y la ficha cambio). Si no hay ninguno, no devuelve nada y Google ni se
// consulta. Quien ya es cliente nunca llega aca: `ccProspecto` lo deja en null.
//
// `crm.activo === false` en la configuracion de la consola APAGA el modulo: no devuelve nada y Google ni se consulta. Ausente o ilegible = encendido.
//
// EL ORDEN IMPORTA (`executionOrder: v1`). Esta rama cuelga de «Armar mensajes» por debajo del envio al cliente y del CRM, y por
// encima de «Confirmar envío»: guardar no demora la respuesta. Si Meta rechazo el mensaje y «Confirmar envío» termina en error,
// la fila ya quedo guardada: el dato del prospecto es real aunque la respuesta no haya salido.
// MENSAJES: ninguno.
let crmCfg = null;
try {
  const r = $('Traer configuración').first().json || {};
  let cuerpo = r.body === undefined ? r : r.body;
  if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
  crmCfg = cuerpo && typeof cuerpo === 'object' ? cuerpo.crm : null;
} catch (e) { crmCfg = null; }
if (!crmActivo(crmSanearConfig(crmCfg))) return [];

// UNA FILA POR CONVERSACION: el inicio de la conversacion sale de lo que devolvio la ingesta del entrante (`atencion.ventanaVenceEn` - 24 h), igual que la lee el
// cobro. Sin ese dato (ingesta caida) queda null y el modulo actualiza la fila mas reciente SIN crear.
let desdeMs = null;
try {
  const r = $('Reportar mensaje (entrante)').first().json || {};
  let cuerpo = r.body === undefined ? r : r.body;
  if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
  const a = cuerpo && typeof cuerpo === 'object' ? cuerpo.atencion : null;
  desdeMs = crmDesdeVentana(a && typeof a === 'object' ? a.ventanaVenceEn : null);
} catch (e) { desdeMs = null; }

const out = [];
$input.all().forEach((it, i) => {
  const e = it.json;
  const p = e.prospectoPlanilla;
  if (e.guardarPlanilla === true && p && typeof p === 'object' && p.telefono) {
    // «Ultima interaccion»: si el productor no la trae (captacion, chat), es el instante de este turno; sin ella la fila no se reconoceria como de esta conversacion.
    const ult = typeof p.ultimaInteraccionMs === 'number' && Number.isFinite(p.ultimaInteraccionMs) ? p.ultimaInteraccionMs : Date.now();
    out.push({ json: Object.assign({}, p, { ultimaInteraccionMs: ult, conversacionDesdeMs: desdeMs }), pairedItem: { item: i } });
  }
});
// FILA MINIMA (Andres, 08/11/2026): hay ancla (la conversacion abrio) y NINGUN item trajo prospecto porque el flujo filtro su CONTENIDO (proteccion por violencia o miedo,
// modo prueba, plan que no es de conversacion). Se filtra el contenido, no la fila: sale un prospecto con SOLO el telefono y `minima: true`; el modulo escribe telefono,
// fecha, «Ultima interaccion» y clasificacion generica, sin nombre, texto ni motivo. La planilla tiene que estar configurada (id y hoja en `Config del negocio`).
// Una 2.a vez en la misma ventana no crea otra: el modulo ve la fila de esta conversacion.
if (!out.length && desdeMs !== null) {
  let lista = false;
  try {
    const c = $('Config del negocio').first().json || {};
    lista = String(c.planillaProspectosId || '').trim() !== '' && String(c.planillaProspectosHoja || '').trim() !== '';
  } catch (e) { lista = false; }
  let tel = '';
  const todos = $input.all();
  for (let k = 0; k < todos.length && !tel; k++) tel = String((todos[k].json || {}).from || '').replace(/\D/g, '');
  if (!tel) { try { tel = String($('Normalizar entrada').first().json.from || '').replace(/\D/g, ''); } catch (e) { tel = ''; } }
  if (lista && tel) out.push({ json: { telefono: tel, minima: true, senales: {}, ultimaInteraccionMs: Date.now(), conversacionDesdeMs: desdeMs }, pairedItem: { item: 0 } });
}
return out;
