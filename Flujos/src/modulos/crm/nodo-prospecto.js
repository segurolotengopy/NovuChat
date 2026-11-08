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
    out.push({ json: Object.assign({}, p, { conversacionDesdeMs: desdeMs }), pairedItem: { item: i } });
    return;
  }
  // Fila minima: la conversacion abre en este turno (primer mensaje de la ventana hace menos de 10 minutos) y el flujo no armo prospecto, pero declaro que la
  // planilla esta lista y el turno es apto (`planillaMinima === true`: hay planilla, no es prueba ni proteccion). Telefono, nombre de perfil y «Tibio» por defecto.
  const tel = String(e.from === undefined || e.from === null ? '' : e.from).replace(/\D/g, '');
  if (e.planillaMinima === true && tel && desdeMs !== null && Date.now() - desdeMs >= 0 && Date.now() - desdeMs <= 10 * 60 * 1000) {
    out.push({ json: { telefono: tel, nombre: typeof e.nombrePerfil === 'string' ? e.nombrePerfil : '', nombreDePerfil: true, senales: {},
      ultimaInteraccionMs: Date.now(), conversacionDesdeMs: desdeMs }, pairedItem: { item: i } });
  }
});
return out;
