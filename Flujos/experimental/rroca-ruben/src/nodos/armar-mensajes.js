// ARMAR MENSAJES (PR-2): lo que sale al cliente, armado por CÓDIGO. UN SOLO MENSAJE por turno, o ninguno (+0 mensajes agregados).
//
// Lee el plan de «Decidir turno» y arma: un texto, un texto con botones (los menús, sin los botones que el cliente ya pulsó), el QR (una IMAGEN por `id` de medio, NUNCA por `link`: el relé de WAM
// rechaza cualquier clave `link` en el cuerpo) o un texto con el botón que abre el chat de Rubén. Lo que redacta el modelo pasa por `cmRevisarRedaccion` (filtro común): si se rechaza, cae al texto fijo.
//
//   puerta «suspendido»        -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido»     -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por persona) NO SALE NADA: cero envío, cero modelo, cero descarga;
//   puerta «sigue»             -> según `plan.tipo` (ver «Decidir turno»).
//
// «SOLO SE OFRECE LO QUE SE CUMPLE»: «ya pasé tu comprobante» / «le avisé» salen SOLO si «Enviar aviso» devolvió un `wamid` real (`avisoSalio`); si no, el texto dice que no se pudo avisar y trae el botón.
// En modo prueba sin `enviarDeVerdad` el aviso no se envía y cuenta como salido (igual que los mensajes al cliente: la prueba no gasta mensajes).
// Todo texto pasa por `rrSeguro` (NIEGA_IA y `CB_PROHIBIDAS`). La ficha del teléfono (`rroca[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno.
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const decision = cnPrimero('Decidir turno') || {};
const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : { tipo: 'nada' };
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);
const cat = plan.cat && typeof plan.cat === 'object' ? plan.cat : {};
const fichaAntes = rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from));

const rrId = (j) => { const m = j && j.messages; return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''; };
const avisoPlaneado = !!plan.aviso;
const avisoSalio = (avisoPlaneado && (cnTodos('Enviar aviso').some(rrId) || (prueba && cfg.enviarDeVerdad !== true))) || plan.avisoRepetido === true;

let m = null;               // el item del mensaje (cmMensaje) o null
let tipoDePlan = String(plan.tipo || 'nada');
let llamadasModelo = decision.llamarModelo === true ? 1 : 0;
let usadoNuevo = '';        // el botón de este turno que no debe reaparecer
let ultimoModelo = fichaAntes.ultimoModelo;
let pedidoNuevo = null;
let qrPrevio = null;        // la ficha antes de la marca provisional del QR

const texto = (cuerpo, extra) => { const c = rrSeguro(cuerpo); return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {})); };
const conBotones = (cuerpo, botones, extra) => {
  const c = rrSeguro(cuerpo);
  if (!botones.length) return texto(c, extra);
  const respaldo = c + '\n\nEscríbeme cuál prefieres: ' + botones.map((b) => b.title).join(', ') + '.';
  return cmMensaje('cliente', cmBotones(c, botones), c, respaldo, Object.assign({ tipoReporte: 'interactive' }, extra || {}));
};
const conRuben = (cuerpo) => {
  const c = rrSeguro(cuerpo);
  const x = cmContactoConBoton({ numero: cnDigitos(cfg.numeroRecepcion), desde: from, cuerpo: c, botonTexto: RR_BOTON_RUBEN, saludo: 'Hola Rubén, vengo del asistente virtual.', textoDelRespaldo: 'Escríbele aquí:', sinNumero: 'Eso lo ve Rubén directamente.' });
  return x;
};
const menu1 = () => rrMenu(1, cat, fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : []));

if (puerta.ruta === 'suspendido' || puerta.ruta === 'uso_extendido') {
  if (puerta.responder === true && String(puerta.texto || '').trim() !== '') m = texto(String(puerta.texto));
} else if (puerta.ruta === 'sigue') {
  usadoNuevo = rrProductoDeBoton(plan.boton) || plan.boton === RR_BOTON_COMPLEMENTOS ? String(plan.boton) : '';
  if (tipoDePlan === 'saludo') {
    m = conBotones(rrSaludo(cat, plan.pregunta === 'consulta' ? RR_PREGUNTA_CONSULTA : RR_PREGUNTA_GENERAL), plan.conMenu === true ? menu1() : []);
  } else if (tipoDePlan === 'complemento') {
    m = conBotones(rrTextoComplemento(plan.producto, cat, plan.conPresentacion === true), rrMenuDeComplemento(plan.producto, cat, fichaAntes.usados));
  } else if (tipoDePlan === 'menu2') {
    m = conBotones(rrTextoComplementos(cat), rrMenu(2, cat, fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : [])));
  } else if (tipoDePlan === 'ingresos') {
    m = conBotones(RR_TEXTO_INGRESOS, menu1());
  } else if (tipoDePlan === 'modelo') {
    // LO QUE REDACTA EL MODELO: se revisa y se pule; un rechazo (monto, promesa, enlace, negar ser IA, varias preguntas…), un error del servicio o un texto vacío caen al texto fijo.
    const crudo = cnTextoDeGemini(cnPrimero('Conversar con el modelo'));
    const rev = crudo.trim() === '' ? { texto: '', motivo: 'vacio' } : cmRevisarRedaccion(crudo, {
      maximo: 700, enlacesPermitidos: [], quienPromete: ['ruben', 'el equipo'], nombreNegocio: cfg.nombreNegocio, textoDelCliente: t.texto, extra: [rrExtraRedaccion],
    });
    const bueno = rev.motivo === '' && rev.texto.trim() !== '';
    const cuerpo = bueno ? rev.texto : RR_TEXTO_MODELO_CAIDO;
    if (bueno) ultimoModelo = cuerpo.slice(0, 300);
    m = conBotones(cuerpo, menu1());
    tipoDePlan = bueno ? 'modelo' : 'modelo_caido';
  } else if (tipoDePlan === 'qr') {
    const monto = rrPrecio(cat, plan.producto);
    const mediaId = rrMediaId(plan.mediaId);
    if (monto === null || monto !== plan.monto || mediaId === '' || !/^[A-Za-z0-9]{3,40}$/.test(String(plan.pedidoId || ''))) {
      // Nunca un QR sin monto del catálogo o sin id de medio: se deriva a Rubén.
      tipoDePlan = 'derivar';
      m = conRuben(rrTextoDerivacion('sin_medio', false));
    } else {
      const pie = rrSeguro(rrPieQr(plan.producto, monto, plan.pedidoId, plan.conPresentacion === true, plan.simulado === true));
      const respaldo = 'No pude mostrarte el QR en este momento. Escríbeme de nuevo en unos minutos para intentarlo otra vez.';
      m = cmMensaje('cliente', Object.assign(cmBase('image'), { image: { id: mediaId, caption: pie } }), pie, respaldo, { tipoReporte: 'image' });
      // El evento que ABRE el cobro: `qr_enviado`, con `referencia` (el pedido) y `monto` (el del catálogo). Solo el QR REAL abre un cobro de regla 2 (15 minutos, 3 intentos); el simulado no.
      m.evento = 'qr_enviado';
      if (plan.simulado !== true) m.reglaCobro = 2;
      m.referencia = String(plan.pedidoId);
      m.monto = monto;
      pedidoNuevo = { producto: plan.producto };
    }
  } else if (tipoDePlan === 'qr_pendiente') {
    m = conRuben(rrTextoQrPendiente(plan.producto, plan.monto));
  } else if (tipoDePlan === 'comprobante') {
    const r = rrTextoComprobante(plan.resultado, plan.causa, avisoSalio, plan.diferencia);
    m = r.boton === true ? conRuben(r.cuerpo) : texto(r.cuerpo);
  } else if (tipoDePlan === 'derivar') {
    m = conRuben(rrTextoDerivacion(plan.motivo, avisoSalio));
  } else if (tipoDePlan === 'imagen_otra') {
    m = texto(RR_TEXTO_IMAGEN);
  } else if (tipoDePlan === 'audio') {
    m = texto(RR_TEXTO_AUDIO);
  } else if (tipoDePlan === 'otro') {
    m = texto(RR_TEXTO_OTRO);
  } else {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    m = texto(RR_PRESENTACION);
  }
}

// La ficha: un solo lugar, al final del turno. Hasta en un turno sin mensaje (bloqueado) se recuerda el id de Meta (una entrega repetida no se cuenta dos veces).
if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const ficha = rrFichaVigente(cnFichaDe(fichas.mapa, from));
  rrRecordarId(ficha, t.mensajeId);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  if (m) ficha.saludado = true;
  if (avisoPlaneado && plan.aviso.tipo === 'consulta' && avisoSalio) ficha.ultimoAvisoConsultaMs = ahora;
  if (usadoNuevo && ficha.usados.indexOf(usadoNuevo) < 0) ficha.usados = ficha.usados.concat([usadoNuevo]).slice(-10);
  if (ultimoModelo !== undefined) ficha.ultimoModelo = ultimoModelo;
  // MARCA PROVISIONAL del QR: se fija aquí (el id del pedido y la guarda de 15 minutos necesitan existir ya) pero `Resumen del turno` la DESCARTA con `qrPrevio` si Meta no devolvió el `wamid` del QR
  // (sale el respaldo en texto): un QR que no salió no deja al cliente 15 minutos con «Ya tienes un QR abierto».
  if (pedidoNuevo) { qrPrevio = { pedidos: ficha.pedidos, producto: ficha.producto, qrHastaMs: ficha.qrHastaMs }; ficha.pedidos += 1; ficha.producto = pedidoNuevo.producto; ficha.qrHastaMs = ahora + RR_MINUTOS_QR * 60 * 1000; }
  fichas.mapa[from] = ficha;
  rrBarrer(fichas.mapa, ahora);
}

const resumen = { plan: tipoDePlan === 'nada' ? (puerta.ruta || 'nada') : tipoDePlan, mensajes: 0, categoria: t.categoria || '', llamadasModelo: llamadasModelo, aviso: avisoPlaneado ? (avisoSalio ? 'salio' : 'no_salio') : 'ninguno' };
let numero = from;
if (prueba) numero = telPrueba;
// `mensajes` se calcula DESPUÉS de decidir el número: en prueba con un teléfono no permitido (`telPrueba` vacío) no sale nada y el resumen lo dice.
const sale = !!m && numero !== '';
resumen.mensajes = sale ? 1 : 0;
if (!sale) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
}
m.payload.to = numero;
const salida = {
  para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo,
  tipoReporte: m.tipoReporte, evento: m.evento || '', esInteractivo: m.tipoReporte === 'interactive', esAviso: false, marcaAvisado: false, empresaAviso: '',
  // Solo lo que sale al cliente se reporta; en modo prueba, nada.
  reportar: !prueba,
  phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  plan: resumen.plan, resumen: resumen,
};
if (qrPrevio) salida.qrPrevio = qrPrevio;
if (m.reglaCobro === 2) salida.reglaCobro = 2;
if (m.referencia) salida.referencia = m.referencia;
if (m.monto !== undefined) salida.monto = m.monto;
return [{ json: salida }];
