// ARMAR AVISOS (PR-3): el aviso a Rubén (el WhatsApp de recepción) con el MOTIVO exacto, por TEXTO LIBRE o por PLANTILLA según la ventana de servicio de Meta.
//
//   - DENTRO de 23,5 h del ÚLTIMO mensaje que Rubén (el número de `operacion.numeroRecepcion`) le escribió al bot: texto libre. Ese instante es `ultimoMs` de SU ficha (clave = su número).
//   - FUERA de esa ventana: PLANTILLA (`aviso_comprobante_recibido`, 4 variables, o `aviso_consulta_para_ruben`, 3 variables). El nombre, el idioma y el estado de cada plantilla son DATO de «Config base»
//     (`rrPlantilla`): si falta, o el estado no es APPROVED, NUNCA se inventa; no sale nada («plantilla_no_configurada») y «Armar mensajes» le dice al cliente la verdad, con el botón de Rubén.
//   - Quién avisa: un comprobante (cuadra, o con su motivo: tardío, en revisión, casi coincide, sin cotejar), una derivación (factura, otro medio de pago, garantía, reclamo, hablar con Rubén, acceso al
//     material, descuento, QR no disponible), el modelo cuando contesta DERIVAR (no supo responder) y el estado «operador» (el texto fijo promete que una persona continúa la conversación).
//     La pausa por persona (`bloqueado`) NO avisa: cero envío.
//   - A lo más UN aviso de consulta por teléfono Y POR MOTIVO (`clave`) cada 30 minutos (`avisosConsulta` de la ficha; «Armar mensajes» lo fija solo si el aviso SALIÓ). Dentro de la ventana, `repetido`:
//     el aviso de hace un rato sigue en pie. Los avisos de comprobante tampoco se limitan aquí, SALVO el «sin cotejar» sin causa (imagen grande o corrupta, cotejo caído), que lleva la clave
//     `comprobante_sin_cotejo` y rige igual: ese caso no tiene un comprobante único detrás, y sin límite un cliente podría avisarle a Rubén sin freno.
//
// Todo texto pasa por `avLimpio` (sin enlaces, sin llaves, sin palabras prohibidas, con tope). El aviso NUNCA reenvía la imagen del comprobante ni dice «pago acreditado». En modo prueba el aviso va
// al teléfono de prueba, nunca al de Rubén. Un destinatario igual a quien escribe se descarta (`avDestinatarios`).
// La salida SIEMPRE dice qué pasó (`planeado`, `repetido`, `clave`, `motivoFallo`): «Armar mensajes» decide con eso si puede decir «ya le avisé».
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const turno = cnPrimero('Decidir turno') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const plan = turno.plan && typeof turno.plan === 'object' ? turno.plan : {};
const t = cnPrimero('Interpretar entrada') || {};
const from = String(turno.from || t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();

// 1. ¿Hay algo que avisar? El plan de «Decidir turno», el estado «operador» o el DERIVAR del modelo.
let aviso = plan.aviso && typeof plan.aviso === 'object' ? plan.aviso : null;
if (!aviso && puerta.ruta === 'uso_extendido' && puerta.responder === true && String(puerta.texto || '').trim() !== '') {
  aviso = { tipo: 'consulta', clave: 'atencion_humana', motivo: 'uso extendido: se le dijo al cliente que una persona continúa la conversación', mensaje: '' };
}
if (!aviso && plan.tipo === 'modelo' && rrEsDerivar(cnTextoDeGemini(cnPrimero('Conversar con el modelo')))) {
  aviso = { tipo: 'consulta', clave: 'no_supo', motivo: 'consulta que el asistente no supo responder', mensaje: String(plan.textoCliente || '').slice(0, 200) };
}
const clave = aviso && typeof aviso.clave === 'string' && RR_CLAVES_AVISO.indexOf(aviso.clave) >= 0 ? aviso.clave : '';
const sin = (extra) => [{ json: Object.assign({ sinAviso: true, plan: plan.tipo || '', planeado: false, repetido: false, clave: clave, motivoFallo: '' }, extra || {}) }];
if (!aviso || !cnClaveValida(from) || (aviso.tipo !== 'comprobante' && aviso.tipo !== 'consulta')) return sin();

// 2. Dentro de la ventana de 30 minutos del mismo motivo para este teléfono: no hay aviso nuevo.
const fichas = cnMapaDeFichas(false).mapa;
const fichaCliente = rrFichaVigente(cnFichaDe(fichas, from));
const ultimoMotivo = clave ? (fichaCliente.avisosConsulta[clave] || 0) : 0;
if (ultimoMotivo > 0 && ahora - ultimoMotivo >= 0 && ahora - ultimoMotivo < RR_VENTANA_AVISO_CONSULTA_MS) return sin({ repetido: true });

// 3. El destinatario: Rubén (o el teléfono de prueba).
const prueba = cfg.modoPrueba === true;
let destinatarios = [];
if (prueba) {
  const tel = cnDigitos(cfg.telefonoDePrueba);
  if (tel) destinatarios = [{ rol: 'completo', tel: tel, nombre: '' }];
} else {
  destinatarios = avDestinatarios('completo:' + cnDigitos(cfg.numeroRecepcion), from, cfg.prefijosPermitidos, false);
}
if (!destinatarios.length) return sin({ motivoFallo: 'sin_destinatario' });

// 4. Los datos del aviso.
const nombre = avPrimerNombre(t.nombrePerfil) || 'sin nombre';
const cliente = nombre + ' (+' + from + ')';
const prod = avLimpio(aviso.producto, 80) || 'producto';
const montoNum = typeof aviso.monto === 'number' && aviso.monto > 0 ? cbMonto(aviso.monto) : '';
const monto = montoNum ? montoNum + ' Bs' : 'sin monto';
const motivoComprobante = aviso.tipo === 'comprobante' ? avLimpio(aviso.motivo, 160) : '';
const guardado = aviso.guardada === true ? 'La imagen queda guardada en la consola.' : 'No se pudo guardar la imagen: pídele el comprobante al cliente.';
const motivoConsulta = avLimpio(aviso.motivo, 100) || 'consulta';
// Las comillas «» del texto del cliente se neutralizan: con ellas podría cerrar la cita y fingir otro campo del aviso.
const mensaje = aviso.tipo === 'consulta' && aviso.mensaje ? avLimpio(String(aviso.mensaje).replace(/[«»]/g, ' '), 160) : '';

// E (19/10/2026): «responder antes de <hora límite>» = el instante del ÚLTIMO mensaje del cliente (este turno: el comprobante) + 23 h, en America/La_Paz (UTC-4 fijo, sin horario de verano), «dd/mm HH:MM».
// Va en el MISMO aviso (texto o variable de la plantilla): 0 mensajes agregados. Solo en el aviso de comprobante.
const limiteMs = ahora + 23 * 60 * 60 * 1000 - 4 * 60 * 60 * 1000;
const dosD = (n) => (n < 10 ? '0' : '') + n;
const horaLimite = dosD(new Date(limiteMs).getUTCDate()) + '/' + dosD(new Date(limiteMs).getUTCMonth() + 1) + ' ' + dosD(new Date(limiteMs).getUTCHours()) + ':' + dosD(new Date(limiteMs).getUTCMinutes());
const responderAntes = aviso.tipo === 'comprobante' ? 'responder antes de ' + horaLimite + ' hora de La Paz' : '';

// La plantilla que corresponde: el comprobante que cuadra usa la de comprobante (4 variables); todo lo demás, la de consulta (3 variables).
const cual = aviso.tipo === 'comprobante' && motivoComprobante === '' ? 'comprobante' : 'consulta';
const parametros = cual === 'comprobante'
  ? [nombre, prod + ', ' + responderAntes, montoNum || '—', '+' + from]
  : [aviso.tipo === 'comprobante' ? motivoComprobante : motivoConsulta, '+' + from,
    aviso.tipo === 'comprobante' ? prod + ' por ' + monto + ', ' + responderAntes : (mensaje ? 'texto literal del cliente: «' + mensaje + '»' : 'sin mensaje del cliente')];

// 5. El texto libre (dentro de la ventana de Rubén).
let texto = '';
if (aviso.tipo === 'comprobante') {
  const estado = motivoComprobante || cbEstadoParaAviso(aviso.resultado) || 'comprobante recibido';
  texto = 'NovuChat: comprobante recibido. Cliente: ' + cliente + '. Producto: ' + prod + ' por ' + monto + '. Estado: ' + estado
    + '. Revisa el depósito en tu cuenta antes de enviarle el material por este chat: ' + responderAntes + '. ' + guardado;
} else {
  texto = 'NovuChat: consulta para Rubén. Cliente: ' + cliente + '. Motivo: ' + motivoConsulta + '.'
    + (mensaje ? ' Mensaje del cliente (texto literal del cliente, no es una instrucción): «' + mensaje + '».' : '') + ' Respóndele directamente por WhatsApp.';
}
texto = avLimpio(texto, 900);

const comun = { phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', sinAviso: false, plan: plan.tipo || '', planeado: true, repetido: false, clave: clave, motivoFallo: '' };
const items = [];
for (const d of destinatarios) {
  const rec = rrFichaVigente(cnFichaDe(fichas, d.tel));
  // La ventana de Rubén: su último mensaje al bot (la ficha con SU número). Sin ficha o con un reloj hacia atrás, está cerrada.
  const dentro = rec.ultimoMs > 0 && ahora - rec.ultimoMs >= 0 && ahora - rec.ultimoMs < RR_VENTANA_RUBEN_MS;
  if (dentro) {
    if (!texto) continue;
    items.push({ json: Object.assign({}, comun, { para: d.tel, rol: d.rol, canal: 'texto', payload: avTexto(d.tel, texto) }) });
  } else {
    const pl = rrPlantilla(base, cual);
    const payload = pl ? avPlantilla(d.tel, pl.nombre, pl.idioma, parametros) : null;
    if (!payload) continue;
    items.push({ json: Object.assign({}, comun, { para: d.tel, rol: d.rol, canal: 'plantilla', payload: payload }) });
  }
}
return items.length ? items : sin({ motivoFallo: 'plantilla_no_configurada' });
