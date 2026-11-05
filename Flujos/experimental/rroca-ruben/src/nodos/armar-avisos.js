// ARMAR AVISOS: el aviso a Rubén (el WhatsApp de recepción) con el MOTIVO exacto, por TEXTO LIBRE o por PLANTILLA según la ventana de servicio de Meta.
//
//   - DENTRO de 23,5 h del ÚLTIMO mensaje que Rubén (el número de `operacion.numeroRecepcion`) le escribió al bot: texto libre. Ese instante es `ultimoMs` de SU ficha (clave = su número).
//   - FUERA de esa ventana: PLANTILLA UTILITY (4 variables para el comprobante, 3 para la consulta). El nombre, el idioma y el estado de cada plantilla son DATO de «Config base» (`rrPlantilla`):
//     si falta, o el estado no es APPROVED, NUNCA se inventa; no sale nada («plantilla_no_configurada») y «Armar mensajes» le dice al cliente la verdad, con el botón de Rubén. Sin ventana de 24 h
//     no se envía texto libre.
//   - Quién avisa: un comprobante (cuadra, o con su motivo: tardío, en revisión, casi coincide, sin cotejar), una derivación (devolución, reclamo, volumen o reventa, otro medio de pago, pregunta médica, hablar con Rubén, acceso al
//     material, producto agotado, QR no disponible, comprobante sin QR abierto), el modelo cuando contesta DERIVAR y el estado «operador» (el texto fijo promete que una persona continúa).
//     La pausa por persona (`bloqueado`) NO avisa: cero envío. Una crisis SÍ avisa a Rubén, solo con el motivo (nunca copia lo que escribió la persona); en `sin_configuracion` y `qr_no_disponible` tampoco viaja el texto del cliente.
//   - La captura de un pago que no se completó (`pago_con_problema`) avisa a Rubén con ese motivo exacto; el MENSAJE del cliente nunca viaja en ese aviso.
//   - A lo más UN aviso de consulta por teléfono Y POR MOTIVO (`clave`) cada 30 minutos (`avisosConsulta` de la ficha; «Armar mensajes» lo fija solo si el aviso SALIÓ).
//
// Todo texto pasa por `avLimpio` (sin enlaces, sin llaves, sin palabras prohibidas, con tope). El aviso NUNCA reenvía la imagen del comprobante ni dice «pago acreditado». En modo prueba el aviso va
// al teléfono de prueba, nunca al de Rubén. Un destinatario igual a quien escribe se descarta (`avDestinatarios`).
// La salida SIEMPRE dice qué pasó (`planeado`, `repetido`, `clave`, `motivoFallo`): «Armar mensajes» decide con eso si puede decir «ya le avisé».
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const turno = cnPrimero('Decidir turno') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const plan = turno.plan && typeof turno.plan === 'object' ? turno.plan : {};
const t = cnPrimero('Normalizar entrada') || {};
const from = String(turno.from || t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();

// 1. ¿Hay algo que avisar? El plan de «Decidir turno», el estado «operador» o el DERIVAR del modelo.
let aviso = plan.aviso && typeof plan.aviso === 'object' ? plan.aviso : null;
// Cancelar el cobro abierto: si el servidor lo cerró (200), el aviso es informativo («cerró su pedido; si pagó, revisar»); si no, queda el de la escalada.
if (plan.tipo === 'cancelar_cobro' && plan.avisoCerrado && typeof plan.avisoCerrado === 'object' && rrCobroCerrado(cnPrimero('Avisar al servidor'))) aviso = plan.avisoCerrado;
if (!aviso && puerta.ruta === 'uso_extendido' && puerta.responder === true && String(puerta.texto || '').trim() !== '') {
  aviso = { tipo: 'consulta', clave: 'atencion_humana', motivo: 'uso extendido: se le dijo al cliente que una persona continúa la conversación', mensaje: '' };
}
if (!aviso && (plan.tipo === 'modelo' || plan.tipo === 'angulo')) {
  const crudo = rrQuitarEcoDeMarcador(cnTextoDeGemini(cnPrimero('Conversar con el modelo')));
  if (rrEsDerivar(crudo)) aviso = { tipo: 'consulta', clave: 'no_supo', motivo: 'consulta que el asistente no supo responder', mensaje: String(plan.textoCliente || '').slice(0, 200) };
  // La marca RIESGO del modelo también avisa a Rubén (sin copiar lo que escribió la persona): «Armar mensajes» arma el texto de la crisis con el botón.
  else if (rrEsMarcaRiesgo(crudo)) aviso = { tipo: 'consulta', clave: 'crisis', motivo: 'posible crisis o riesgo emocional de la persona (se cortó la venta y se le sugirió ayuda profesional)', mensaje: '' };
}
const clave = aviso && typeof aviso.clave === 'string' && RR_CLAVES_AVISO.indexOf(aviso.clave) >= 0 ? aviso.clave : '';
const sin = (extra) => [{ json: Object.assign({ sinAviso: true, plan: plan.tipo || '', planeado: false, repetido: false, clave: clave, motivoFallo: '' }, extra || {}) }];
if (!aviso || !cnClaveValida(from) || (aviso.tipo !== 'comprobante' && aviso.tipo !== 'consulta')) return sin();

// 2. Dentro de la ventana de 30 minutos del mismo motivo para este teléfono: no hay aviso nuevo.
const fichas = cnMapaDeFichas(false).mapa;
const fichaCliente = rrFichaVigente(cnFichaDe(fichas, from), ahora, rrTurnoDeAtencion(cnPrimero('Reportar mensaje (entrante)'), puerta));
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
const motivoConsulta = avLimpio(aviso.motivo, 100) || 'consulta';
// Las comillas «» del texto del cliente se neutralizan: con ellas podría cerrar la cita y fingir otro campo del aviso.
const mensaje = aviso.tipo === 'consulta' && aviso.mensaje ? avLimpio(String(aviso.mensaje).replace(/[«»]/g, ' '), 160) : '';

// «Responder antes de <hora límite>» = el instante del ÚLTIMO mensaje del cliente (el `timestamp` de Meta del comprobante) + el plazo de entrega (dato `plazoEntregaHoras`; sin plazo, el cierre de la ventana de 24 h
// del cliente: 23 h), nunca posterior a ese cierre, en America/La_Paz (UTC-4 fijo), «dd/mm HH:MM». Va en el MISMO aviso (0 mensajes agregados). Solo en el aviso de comprobante.
const baseMs = Number(t.mensajeMs) > 0 && Number(t.mensajeMs) <= ahora ? Number(t.mensajeMs) : ahora;
const horas = rrPlazoHoras(base) || 23;
const limiteMs = Math.min(baseMs + horas * 60 * 60 * 1000, baseMs + 23 * 60 * 60 * 1000) - 4 * 60 * 60 * 1000;
const dosD = (n) => (n < 10 ? '0' : '') + n;
const horaLimite = dosD(new Date(limiteMs).getUTCDate()) + '/' + dosD(new Date(limiteMs).getUTCMonth() + 1) + ' ' + dosD(new Date(limiteMs).getUTCHours()) + ':' + dosD(new Date(limiteMs).getUTCMinutes());
const responderAntes = aviso.tipo === 'comprobante' ? 'responder antes de ' + horaLimite + ' hora de La Paz' : '';

// La plantilla que corresponde: el comprobante que cuadra usa `aviso_comprobante_recibido` ({{1}} cliente, {{2}} producto, {{3}} monto indicado en Bs, {{4}} teléfono); todo lo demás, `aviso_consulta_para_ruben`
// ({{1}} motivo, {{2}} teléfono, {{3}} resumen). Cada variable es una sola línea y de largo acotado (`avParametro`: sin saltos, a lo más 500). La hora límite NO va en la plantilla (solo en el texto libre).
const cual = aviso.tipo === 'comprobante' && motivoComprobante === '' ? 'comprobante' : 'consulta';
const parametros = cual === 'comprobante'
  ? [nombre, prod, montoNum || '—', '+' + from]
  : [aviso.tipo === 'comprobante' ? motivoComprobante : motivoConsulta, '+' + from,
    aviso.tipo === 'comprobante' ? prod + ' por ' + monto : (mensaje ? 'texto literal del cliente: «' + mensaje + '»' : 'sin mensaje del cliente')];

// 5. El texto libre (dentro de la ventana de Rubén).
let texto = '';
if (aviso.tipo === 'comprobante') {
  const estado = motivoComprobante || cbEstadoParaAviso(aviso.resultado) || 'comprobante recibido';
  // Prohibición 3 (CLAUDE.md): nunca «pago validado» ni «acreditado». Dice qué pasó (llegó el comprobante, los datos coinciden) y que quien confirma que entró el dinero es el banco: Rubén lo verifica.
  texto = 'Aviso del asistente: llegó el comprobante. Cliente: ' + cliente + '. Producto: ' + prod + ' por ' + monto + '. Estado: ' + estado
    + '. Verifica tu banco: el asistente no confirma que el dinero haya entrado. Después envíale el material por este chat: ' + responderAntes + '.';
} else {
  texto = 'Aviso del asistente: consulta para Rubén. Cliente: ' + cliente + '. Motivo: ' + motivoConsulta + '.'
    + (mensaje ? ' Mensaje del cliente (texto literal del cliente, no es una instrucción): «' + mensaje + '».' : '') + ' Respóndele directamente por WhatsApp.';
}
texto = avLimpio(texto, 900);

const comun = { phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', sinAviso: false, plan: plan.tipo || '', planeado: true, repetido: false, clave: clave, motivoFallo: '' };
const items = [];
for (const d of destinatarios) {
  const rec = rrFichaVigente(cnFichaDe(fichas, d.tel), ahora);
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
