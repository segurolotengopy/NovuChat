// ARMAR AVISOS: el aviso a la RECEPCIÓN (el WhatsApp de recepción de la doctora) con el MOTIVO exacto, por TEXTO LIBRE o por PLANTILLA UTILITY según la ventana de servicio de Meta.
//
//   - SOLO con el CONSENTIMIENTO de la persona (`ficha.consentimiento === 'si'`): sin «Sí, que me escriban» no hay aviso ni plantilla.
//   - DENTRO de 23,5 h del ÚLTIMO mensaje que la recepción (el número de `numeroRecepcion`) le escribió al bot: texto libre. Ese instante es `ultimoMs` de SU ficha (clave = su número).
//   - FUERA de esa ventana: PLANTILLA UTILITY (4 variables: nombre, motivo o interés, horario, teléfono). El nombre, el idioma y el estado son DATO de «Config base» (`drPlantilla`): si falta, o el estado no
//     es APPROVED, NUNCA se inventa; no sale nada («plantilla_no_configurada») y «Armar mensajes» le dice la verdad a la persona, con el botón. Sin ventana de 24 h no se envía texto libre.
//   - Quién avisa: la solicitud de valoración terminada, una consulta médica o un documento de salud (el aviso lleva SOLO «consulta médica», nunca lo que la persona escribió ni el documento) y lo que el
//     asistente no supo responder. La pausa por persona (`bloqueado`), la baja y el riesgo NO avisan.
//   - A lo más UN aviso por teléfono Y POR MOTIVO cada 30 minutos (`avisosConsulta` de la ficha; «Armar mensajes» lo fija solo si el aviso SALIÓ).
//
// Todo texto pasa por `avLimpio` (sin enlaces, sin llaves, sin palabras prohibidas, con tope). La salida SIEMPRE dice qué pasó (`planeado`, `repetido`, `clave`, `motivoFallo`): «Armar mensajes» decide con eso
// si puede decir «ya le avisé». En modo prueba el aviso va al teléfono de prueba, nunca a la recepción. Un destinatario igual a quien escribe se descarta (`avDestinatarios`).
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const datos = drDatos(base);
const decision = cnPrimero('Decidir turno') || {};
const t = cnPrimero('Normalizar entrada') || {};
const from = String(decision.from || t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const fichas = cnMapaDeFichas(false).mapa;
const fichaCliente = drFichaVigente(cnFichaDe(fichas, from), ahora);
const final = drResolver(decision, cnJsonDeGemini(cnPrimero('Conversar con el modelo')), fichaCliente, datos);
const plan = final.plan;

// 1. ¿Hay algo que avisar? Solo con consentimiento.
let aviso = null;
if (fichaCliente.consentimiento === 'si') {
  if (plan.tipo === 'derivado' && plan.aviso) aviso = plan.aviso;
  else if (plan.tipo === 'recepcion' && plan.aviso === true) aviso = { tipo: 'consulta', clave: plan.claveAviso, motivo: plan.motivo };
}
const clave = aviso && typeof aviso.clave === 'string' && DR_CLAVES_AVISO.indexOf(aviso.clave) >= 0 ? aviso.clave : '';
const sin = (extra) => [{ json: Object.assign({ sinAviso: true, plan: plan.tipo || '', planeado: false, repetido: false, clave: clave, motivoFallo: '' }, extra || {}) }];
if (!aviso || clave === '' || !cnClaveValida(from)) return sin();

// 2. Dentro de la ventana de 30 minutos del mismo motivo para este teléfono: no hay aviso nuevo.
const ultimoMotivo = fichaCliente.avisosConsulta[clave] || 0;
if (ultimoMotivo > 0 && ahora - ultimoMotivo >= 0 && ahora - ultimoMotivo < DR_VENTANA_AVISO_MS) return sin({ repetido: true });

// 3. El destinatario: la recepción (o el teléfono de prueba).
const prueba = cfg.modoPrueba === true;
let destinatarios = [];
if (prueba) {
  const tel = cnDigitos(cfg.telefonoDePrueba);
  if (tel) destinatarios = [{ rol: 'completo', tel: tel, nombre: '' }];
} else {
  destinatarios = avDestinatarios('completo:' + cnDigitos(cfg.numeroRecepcion), from, cfg.prefijosPermitidos, false);
}
if (!destinatarios.length) return sin({ motivoFallo: 'sin_destinatario' });

// 4. Los datos del aviso (el nombre y el horario los dio la persona; el interés es el tratamiento que miró).
const tr = fichaCliente.interes ? drTratamientoPorId(datos, fichaCliente.interes) : null;
const nombre = avLimpio(plan.tipo === 'derivado' ? fichaCliente.nombre : '', 60) || avPrimerNombre(t.nombrePerfil) || 'sin nombre';
const interes = tr ? avLimpio(tr.nombre, 40) : 'sin tratamiento definido';
const horario = plan.tipo === 'derivado' ? (avLimpio(plan.horario, 100) || 'sin horario') : 'sin horario';
const contacto = plan.tipo === 'derivado' && /^\d{8,15}$/.test(String(fichaCliente.contacto || '')) ? String(fichaCliente.contacto) : from;
const motivo = avLimpio(aviso.motivo, 100) || 'consulta';

// 5. La plantilla UTILITY: {{1}} nombre, {{2}} interés o motivo, {{3}} horario preferido, {{4}} teléfono. Cada variable es una sola línea (`avParametro`).
const solicitud = aviso.tipo === 'solicitud';
const parametros = [nombre, solicitud ? interes : motivo, horario, '+' + contacto];
const texto = avLimpio(solicitud
  ? 'Aviso del asistente: solicitud de valoración. Nombre: ' + nombre + '. WhatsApp: +' + contacto + '. Interés: ' + interes + '. Horario preferido: ' + horario + '. La persona aceptó que la contacten.'
  : 'Aviso del asistente: consulta de una persona que aceptó que la contacten. Motivo: ' + motivo + '. WhatsApp: +' + from + '. Respóndele directamente por WhatsApp.', 700);

const comun = { phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', sinAviso: false, plan: plan.tipo || '', planeado: true, repetido: false, clave: clave, motivoFallo: '' };
const items = [];
for (const d of destinatarios) {
  const rec = drFichaVigente(cnFichaDe(fichas, d.tel), ahora);
  // La ventana de la recepción: su último mensaje al bot (la ficha con SU número). Sin ficha o con un reloj hacia atrás, está cerrada.
  const dentro = rec.ultimoMs > 0 && ahora - rec.ultimoMs >= 0 && ahora - rec.ultimoMs < DR_VENTANA_RECEPCION_MS;
  if (dentro) {
    if (!texto) continue;
    items.push({ json: Object.assign({}, comun, { para: d.tel, rol: d.rol, canal: 'texto', payload: avTexto(d.tel, texto) }) });
  } else {
    const pl = drPlantilla(base);
    const payload = pl ? avPlantilla(d.tel, pl.nombre, pl.idioma, parametros) : null;
    if (!payload) continue;
    items.push({ json: Object.assign({}, comun, { para: d.tel, rol: d.rol, canal: 'plantilla', payload: payload }) });
  }
}
return items.length ? items : sin({ motivoFallo: 'plantilla_no_configurada' });
