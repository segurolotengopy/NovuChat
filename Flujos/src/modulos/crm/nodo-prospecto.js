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

// UNA FILA POR CONVERSACION (contrato de la ingesta, `atencion` de la respuesta 200 de «Reportar mensaje (entrante)», ya aplicado este mensaje):
//   `conversacionDesde` = ISO UTC con Z, sin fracciones, o null: el inicio de la conversacion del cobro (ventana fija de 24 h);
//   `conversacionNueva` = true solo si ESTE mensaje abrio conversacion (o bloque nuevo; el CRM NO crea fila por bloque, solo por conversacion).
// El ancla se acota a [ahora - 24 h - 5 min, ahora + 5 min]; fuera de ahi o ilegible = null: el modulo actualiza la fila mas reciente SIN crear.
let desdeMs = null;
let conversacionNueva = false;
try {
  const r = $('Reportar mensaje (entrante)').first().json || {};
  let cuerpo = r.body === undefined ? r : r.body;
  if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
  const a = cuerpo && typeof cuerpo === 'object' ? cuerpo.atencion : null;
  if (a && typeof a === 'object') {
    desdeMs = crmDesdeVentana(a.conversacionDesde, Date.now());
    conversacionNueva = a.conversacionNueva === true;
  }
} catch (e) { desdeMs = null; conversacionNueva = false; }

const out = [];
$input.all().forEach((it, i) => {
  const e = it.json;
  const p = e.prospectoPlanilla;
  if (e.guardarPlanilla === true && p && typeof p === 'object' && p.telefono) {
    // «Ultima interaccion»: si el productor no la trae (captacion, chat), es el instante de este turno.
    const ult = typeof p.ultimaInteraccionMs === 'number' && Number.isFinite(p.ultimaInteraccionMs) ? p.ultimaInteraccionMs : Date.now();
    out.push({ json: Object.assign({}, p, { ultimaInteraccionMs: ult, conversacionDesdeMs: desdeMs }), pairedItem: { item: i } });
  }
});
// FILA MINIMA (Andres, 08/11/2026): ESTE mensaje abrio la conversacion (`conversacionNueva`, con ancla) y NINGUN item trajo prospecto porque el flujo filtro su CONTENIDO
// (proteccion por violencia o miedo, modo prueba, otro pais, plan). Se filtra el contenido, no la fila: sale un prospecto con SOLO el telefono y `minima: true`; el modulo
// escribe telefono, fecha y «Ultima interaccion», con Etapa, Origen y clasificacion vacios y Estado «Sin seguimiento»; sin nombre, texto ni motivo. La planilla tiene que
// estar configurada (id y hoja en `Config del negocio`). Solo en la apertura: los demas turnos no consultan la hoja. Una carrera de dos mensajes simultaneos puede dar dos filas.
// El telefono sale de «Normalizar entrada» si existe; si no, del `from` del item (solo digitos, 8 a 15). Sin telefono verificado FALLA a la vista (no se inventa uno).
if (!out.length && desdeMs !== null && conversacionNueva === true) {
  let lista = false;
  try {
    const c = $('Config del negocio').first().json || {};
    lista = String(c.planillaProspectosId || '').trim() !== '' && String(c.planillaProspectosHoja || '').trim() !== '';
  } catch (e) { lista = false; }
  if (lista) {
    const solo = (v) => { const d = String(v === undefined || v === null ? '' : v).replace(/\D/g, ''); return d.length >= 8 && d.length <= 15 ? d : ''; };
    let verificado = '';
    try { verificado = solo($('Normalizar entrada').first().json.from); } catch (e) { verificado = ''; }
    let delItem = '';
    const todos = $input.all();
    for (let k = 0; k < todos.length && !delItem; k++) delItem = solo((todos[k].json || {}).from);
    if (verificado !== '' && delItem !== '' && verificado !== delItem) throw new Error('miniCRM: el telefono de la fila minima no coincide entre «Normalizar entrada» y el turno');
    const tel = verificado || delItem;
    if (tel === '') throw new Error('miniCRM: la conversacion abrio y no hay un telefono verificado para la fila minima');
    out.push({ json: { telefono: tel, minima: true, senales: {}, ultimaInteraccionMs: Date.now(), conversacionDesdeMs: desdeMs }, pairedItem: { item: 0 } });
  }
}
return out;
