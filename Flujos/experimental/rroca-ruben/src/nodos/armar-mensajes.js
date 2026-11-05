// ARMAR MENSAJES: lo que sale al cliente, armado por CÓDIGO. UN SOLO MENSAJE por turno, o ninguno (+0 mensajes agregados).
//
// Lee el plan de «Decidir turno» y arma: un texto, un texto con botones (los menús, sin los botones que el cliente ya pulsó), una lista (los bonos), el QR (una IMAGEN por `id` de medio, NUNCA por `link`: el relé
// de WAM rechaza cualquier clave `link` en el cuerpo) o un texto con el botón que abre el chat de Rubén. Lo que redacta el modelo pasa por `cmRevisarRedaccion` (filtro común): si se rechaza, cae al texto fijo.
//
//   puerta «suspendido»        -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido»     -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por persona) NO SALE NADA: cero envío, cero modelo, cero descarga;
//   puerta «sigue»             -> según `plan.tipo` (ver «Decidir turno»).
//
// «SOLO SE OFRECE LO QUE SE CUMPLE»: «ya pasé tu comprobante» / «le avisé» salen SOLO si «Enviar aviso» devolvió un `wamid` real (`avisoSalio`); si no, el texto dice que no se pudo avisar y trae el botón.
// En modo prueba sin `enviarDeVerdad` el aviso no se envía y cuenta como salido (igual que los mensajes al cliente: la prueba no gasta mensajes).
// LA CONVERSACIÓN ANTES DE LAS OPCIONES: las opciones (precio general, catálogo, menú de productos) salen SOLO si «Decidir turno» las habilitó (`opcionesHabilitadas`: dos mensajes de conversación o una excepción); este nodo no lo recalcula. El contador
// `charlaN` de la ficha lo suma este nodo (solo lo que cuenta como conversación) y «Resumen del turno» lo restaura si Meta no aceptó el envío. Sigue siendo UN mensaje por turno (+0 mensajes): el puente, la invitación a pagar y la pregunta pendiente viajan en él.
// El botón de Rubén va SOLO cuando el plan deriva (aviso + botón). Con un QR abierto la respuesta sale sin botones de producto y con la invitación a pagar el QR pendiente.
// Todo texto pasa por `rrSeguro` (NIEGA_IA, `CB_PROHIBIDAS` y párrafos). La ficha del teléfono (`ruben[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno.
// CRISIS EMOCIONAL: si «Decidir turno» la detectó, o el modelo contestó la marca RIESGO, sale SOLO el texto cálido de `RR_TEXTO_CRISIS` con el botón de Rubén (sin QR ni precios; «Le avisé» solo si el aviso salió) y el mensaje se reporta con el evento `no_contactar`.
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const decision = cnPrimero('Decidir turno') || {};
const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : { tipo: 'nada' };
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);
const cat = plan.cat && typeof plan.cat === 'object' ? plan.cat : {};
const atencionDelTurno = rrTurnoDeAtencion(cnPrimero('Reportar mensaje (entrante)'), puerta);
const fichaAntes = rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora, atencionDelTurno);
// El nombre del negocio (la Consola manda, `Config base` respalda: lo resuelve «Config del negocio») y los NOMBRES del catálogo de la consola, que son los que dicen las etiquetas de los botones.
const negocio = String(cfg.nombreNegocio || '');
const nom = rrNombres(rrPanelDe(cnPrimero('Traer configuración')).cuerpo);
// Las opciones (precios, catálogo, menú) solo con la compuerta abierta; la calcula «Decidir turno».
const habil = decision.opcionesHabilitadas === true;
const qrAbierto = plan.qrAbierto === true;
// El «No» a «¿Te muestro las opciones?» se respeta: esa respuesta sale sin el bloque de las opciones y sin botones de producto.
const sinMenu = plan.sinMenu === true;

const rrId = (j) => { const m = j && j.messages; return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''; };
// Lo que pasó con el aviso a Rubén lo dice «Armar avisos» (`planeado`: había un aviso y se armó, por texto libre o por plantilla; `repetido`: ya salió uno por el mismo motivo hace menos de 30 minutos;
// `motivoFallo`: por qué no se pudo armar, p. ej. «plantilla_no_configurada»). «Ya le avisé» exige un `wamid` real de «Enviar aviso»; sin eso, el texto dice la verdad y trae el botón.
const av = cnPrimero('Armar avisos') || {};
const avisoPlaneado = av.planeado === true;
const avisoRepetido = av.repetido === true;
const avisoEnviado = avisoPlaneado && (cnTodos('Enviar aviso').some(rrId) || (prueba && cfg.enviarDeVerdad !== true));
// Un aviso suprimido por el límite de 30 minutos trató OTRO contenido en los motivos de texto variable: ahí NO se dice «le avisé» de esta vez.
const repetidoVariable = avisoRepetido && (av.clave === 'no_supo' || av.clave === 'comprobante_sin_cotejo' || av.clave === 'cancelacion' || av.clave === 'sin_configuracion' || av.clave === 'pago_con_problema');
const avisoSalio = avisoEnviado || (avisoRepetido && !repetidoVariable);
const estadoAviso = repetidoVariable ? 'repetido' : avisoSalio;

let m = null;               // el item del mensaje (cmMensaje) o null
let tipoDePlan = String(plan.tipo || 'nada');
let llamadasModelo = decision.llamarModelo === true ? 1 : 0;
let usadoNuevo = '';        // el botón de este turno que no debe reaparecer
let respuestaDelModelo = false;   // el texto que sale es la redacción del modelo (cuenta para la memoria y para el menú)
let pedidoNuevo = null;
let riesgoNuevo = false;    // este turno activó (o mantiene) la protección ante una crisis
let senalDeRiesgo = false;  // este turno trae una SEÑAL de crisis (el texto, o la marca RIESGO del modelo): solo ella renueva el plazo de 48 h de la protección (`ficha.riesgoMs`)
let upgradeOfrecido = false;   // este turno ofreció el paso del Libro al Pack (se escribe en la ficha, una sola vez)
let qrPrevio = null;        // la ficha antes de la marca provisional del QR
let hashPrevio = null;      // lo último dicho al teléfono antes de este turno (hash y plan): vuelve si Meta no aceptó el envío
let qrLiberado = null;      // la guarda de QR abierto que este turno de comprobante libera (se restaura si el aviso al cliente no sale)

const texto = (cuerpo, extra) => { const c = rrSeguro(cuerpo); return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {})); };
const conBotones = (cuerpo, botones, extra, respaldoPropio) => {
  const c = rrSeguro(cuerpo);
  if (!botones.length) return texto(c, extra);
  const respaldo = respaldoPropio === true ? c : c + '\n\nEscríbeme cuál prefieres: ' + botones.map((b) => b.title).join(', ') + '.';
  return cmMensaje('cliente', cmBotones(c, botones), c, respaldo, Object.assign({ tipoReporte: 'interactive' }, extra || {}));
};
const conRuben = (cuerpo, extra) => {
  const c = rrSeguro(cuerpo);
  return cmContactoConBoton(Object.assign({ numero: cnDigitos(cfg.numeroRecepcion), desde: from, cuerpo: c, botonTexto: RR_BOTON_RUBEN, saludo: 'Hola Rubén, vengo del asistente virtual.', textoDelRespaldo: 'Escríbele aquí:', sinNumero: 'Eso lo ve Rubén directamente.', esRepetido: (x) => fichaAntes.ultimoHash !== '' && ctHashTexto(x) === fichaAntes.ultimoHash }, extra || {}));
};
const usadosHoy = () => fichaAntes.usados.concat(usadoNuevo ? [usadoNuevo] : []);
// REGLA (P7): un saludo SIN producto decidido no lleva botones con montos. Mientras no esté saludado, o la compuerta esté cerrada, no hay menú en las respuestas libres; ya saludado y habilitado, el menú principal sin los botones que ya pulsó.
// Un prellenado de la landing (Pack, Libro con bono, Audiolibro o Meditaciones) tiene el producto ya decidido y va directo al QR con su monto.
const menu1 = () => rrMenu(cat, usadosHoy(), nom);
const menuAbierto = () => (fichaAntes.saludado && habil ? menu1() : []);
const presentacion = !fichaAntes.saludado;
const textoPresentacion = rrPresentacion(negocio);
const conPresentacion = (cuerpo) => (presentacion ? textoPresentacion + '\n\n' + cuerpo : cuerpo);
// La invitación a pagar el QR pendiente: se agrega al final de toda respuesta que se da con un QR abierto (el producto y el monto son del código, nunca del modelo).
const invitar = (cuerpo) => (qrAbierto ? cuerpo + '\n\n' + rrInvitacionQr(plan.qrProducto, plan.qrMonto, nom) : cuerpo);
const botonOpciones = () => [rrBoton(RR_BOTON_OPCIONES, RR_ETIQUETA_OPCIONES)];

// La protección ante violencia o miedo se arma aunque la puerta no «siga» (comercio suspendido, estado «operador») o el número no sea boliviano.
const rutaDelTurno = tipoDePlan === 'riesgo' ? 'sigue' : puerta.ruta;
if (rutaDelTurno === 'suspendido' || rutaDelTurno === 'uso_extendido') {
  if (rutaDelTurno === 'uso_extendido' && puerta.responder === true && String(puerta.texto || '').trim() !== '') {
    // Estado «operador»: el texto fijo promete que una persona continúa la conversación. Solo sale tal cual si el aviso a Rubén salió; si no, el texto dice la verdad. Siempre con el botón de Rubén.
    m = conRuben(avisoSalio ? String(puerta.texto) : rrTextoDerivacion('consulta', false, '', base));
  } else if (puerta.responder === true && String(puerta.texto || '').trim() !== '') m = texto(String(puerta.texto));
} else if (rutaDelTurno === 'sigue') {
  // El botón «usado» sale del PRODUCTO del QR (también si el producto se eligió por texto prellenado, sin botón) o de «Solo audios» SOLO si el plan realmente atiende el toque. Un toque que no se
  // atendió (un QR ya abierto, el saludo, una derivación) no se marca: el botón sigue disponible.
  // CANCELAR EL COBRO: «cobro_cerrado» solo si el servidor respondió 200 al evento; si no, la escalada de siempre (nunca se dice que se cerró lo que no se cerró).
  if (tipoDePlan === 'cancelar_cobro') {
    if (rrCobroCerrado(cnPrimero('Avisar al servidor'))) tipoDePlan = 'cobro_cerrado';
    else { tipoDePlan = 'derivar'; plan.motivo = 'cancelacion'; plan.clave = 'cancelacion'; }
  }
  if (tipoDePlan === 'qr' && RR_PRODUCTOS[plan.producto]) usadoNuevo = RR_PRODUCTOS[plan.producto].boton;
  else if (tipoDePlan === 'audios' && plan.boton === RR_BOTON_AUDIOS) usadoNuevo = RR_BOTON_AUDIOS;
  // (El botón «Ver opciones» NO pasa a `usados`: contesta la pregunta pendiente, que se consume aparte, y el puente puede volver a ofrecerlo.)

  // LO QUE REDACTA EL MODELO: se revisa y se pule; un rechazo (monto, promesa, enlace, negar ser IA, varias preguntas…), un error del servicio o un texto vacío caen al texto fijo.
  // La marca RIESGO del modelo activa la protección; la palabra DERIVAR pasa a Rubén. Ninguna de las dos llega jamás al cliente.
  if (tipoDePlan === 'modelo' || tipoDePlan === 'angulo') {
    const crudo = rrQuitarEcoDeMarcador(cnTextoDeGemini(cnPrimero('Conversar con el modelo')));
    if (rrEsMarcaRiesgo(crudo)) { tipoDePlan = 'riesgo'; senalDeRiesgo = true; }
    else if (rrEsDerivar(crudo)) { tipoDePlan = 'derivar'; plan.motivo = 'consulta'; plan.clave = 'no_supo'; }
  }

  if (tipoDePlan === 'riesgo') {
    // CRISIS: el texto cálido lo pone el código, con el botón de Rubén; «Le avisé…» solo si el aviso salió de verdad. `no_contactar` viaja siempre (nunca el rescate de ventas a una persona en crisis).
    riesgoNuevo = true;
    if (plan.senal === true) senalDeRiesgo = true;
    // La continuación (la protección sigue activa, sin señal nueva) recibe el mismo texto, sin venta: la crisis sigue cortando la venta; lo que cambia es CUÁNTO dura (ver `riesgoMs`).
    m = conRuben(RR_TEXTO_CRISIS + (avisoSalio ? '\n\n' + RR_TEXTO_CRISIS_AVISO : ''));
    m.evento = 'no_contactar';
  } else if (tipoDePlan === 'fuera_pais') {
    m = conRuben(RR_TEXTO_FUERA_DE_PAIS);
  } else if (tipoDePlan === 'saludo') {
    m = texto(rrSaludo(presentacion, negocio));
  } else if (tipoDePlan === 'angulo' || tipoDePlan === 'modelo') {
    const crudo = rrQuitarEcoDeMarcador(cnTextoDeGemini(cnPrimero('Conversar con el modelo')));
    // `nombreNegocio` va VACÍO a propósito: el filtro común pasa a mayúscula toda palabra del nombre del negocio (≥ 4 letras) y «Noches Sin Insomnio» volvería «Noches» e «Insomnio» las palabras comunes de la charla.
    // Los filtros del texto del modelo: SIEMPRE sin datos de pago, sin afirmar una compra y sin promesas de aviso (el aviso a Rubén solo se dice si hubo un `wamid` real); como máximo 3 oraciones SOLO con un QR abierto (la invitación a pagar va debajo).
    const rev = crudo.trim() === '' ? { texto: '', motivo: 'vacio' } : cmRevisarRedaccion(crudo, {
      maximo: 700, enlacesPermitidos: [], quienPromete: ['ruben', 'el equipo'], nombreNegocio: '', textoDelCliente: t.texto || plan.textoCliente, extra: [(tx, nm) => rrExtraRedaccion(tx, nm, { textoCliente: t.texto || plan.textoCliente || '', precios: habil ? Object.values(cat).filter((x) => typeof x === 'number' && Number.isFinite(x)) : [] })],
      sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true, avisoRespaldado: avisoPlaneado && cnTodos('Enviar aviso').some(rrId), maxOraciones: qrAbierto ? 3 : undefined,
    });
    // SEGURIDAD (solo se ofrece lo que se cumple): en los modos `puente` y `opciones` el código pone las opciones, y con la compuerta cerrada no hay botones de producto: toda oración del modelo que prometa opciones o precios se QUITA.
    const modo = typeof plan.modo === 'string' ? plan.modo : 'charla';
    const modoPuente = modo === 'puente' && !qrAbierto;
    const modoOpciones = modo === 'opciones' && !qrAbierto && !sinMenu && menu1().length > 0;
    const modoAntes = modo === 'antes' && !qrAbierto;
    const sinPromesa = rev.motivo === '' && !qrAbierto && (!habil || modoPuente || modoOpciones) ? vdQuitarPromesaDeOpciones(rev.texto, RR_PROMETE_DEBILES) : rev.texto;
    let bueno = rev.motivo === '' && sinPromesa.trim() !== '';
    // RED DOBLE: con la compuerta cerrada, si tras quitar las promesas aún queda una (el detector la ve en cada línea), el turno completo cae al texto fijo.
    if (bueno && !habil && !qrAbierto && !modoPuente && sinPromesa.split('\n').some((l) => vdOraciones(l).some((o) => vdPrometeOpciones(o, RR_PROMETE_DEBILES)))) bueno = false;
    // Los modos `puente` y `opciones`: el código quita la pregunta del modelo y agrega la suya (nunca hay una pregunta antes de los botones ni dos preguntas). Sin nada que conservar, cuenta como no bueno.
    const sinPregunta = bueno && (modoPuente || modoOpciones) ? vdSinPreguntaFinal(sinPromesa) : sinPromesa;
    if (bueno && (modoPuente || modoOpciones) && sinPregunta.trim() === '') bueno = false;
    // Con un QR abierto jamás hay botones de producto: no se abre otro QR. Una respuesta resuelta sale en texto plano (el botón de Rubén va solo al derivar). Sin botones, el texto no habla de opciones.
    const op = qrAbierto || sinMenu ? [] : menuAbierto();
    let cuerpo;
    let ya = false;   // el texto fijo del ángulo ya trae la presentación
    if (modoPuente) cuerpo = (bueno ? sinPregunta : rrTextoPuenteFijo(fichaAntes.ultimoHash)) + '\n\n' + RR_CIERRE_PUENTE;
    else if (modoOpciones) cuerpo = (bueno ? sinPregunta + '\n\n' : '') + rrTextoOpciones(cat, usadosHoy(), nom);
    else if (bueno) cuerpo = sinPregunta;
    else if (tipoDePlan === 'angulo') { cuerpo = rrAperturaFija(plan.angulo, presentacion, negocio); ya = true; }
    else if (modoAntes) cuerpo = RR_TEXTO_CHARLA_FIJA;
    else {
      cuerpo = rrTextoModeloCaido(habil && op.length > 0);
      // Si el texto de respaldo del modelo caído es idéntico a lo último que se le envió, sale el alterno (no «Eso ya te lo conté…»).
      if (fichaAntes.ultimoHash !== '' && ctHashTexto(rrSeguro(conPresentacion(cuerpo))) === fichaAntes.ultimoHash) cuerpo = RR_TEXTO_CAIDO_ALTERNO;
    }
    if (bueno) respuestaDelModelo = true;
    const completo = ya ? cuerpo : conPresentacion(cuerpo);
    if (modoPuente) m = conBotones(completo, botonOpciones(), undefined, true);
    else if (modoOpciones) m = conBotones(completo, menu1());
    else m = qrAbierto ? texto(invitar(completo)) : conBotones(completo, op);
    tipoDePlan = modoPuente ? (bueno ? 'puente' : 'puente_fijo') : (modoOpciones ? (bueno ? 'opciones' : 'opciones_fijo') : (bueno ? tipoDePlan : (tipoDePlan === 'angulo' ? 'angulo_fijo' : (modoAntes ? 'charla_fija' : 'modelo_caido'))));
  } else if (tipoDePlan === 'precio') {
    if (plan.temprano === true && !qrAbierto) {
      // El precio de UN producto antes de la charla: lo dice el código (con la presentación si es el primer mensaje), sin botones de producto; el cierre es el del puente («¿Te muestro las opciones?» y el botón «Ver opciones»).
      m = conBotones(conPresentacion(plan.duracion === true ? rrTextoPrecio(cat, plan.producto, false, nom) + '\n\n' + RR_TEXTO_DURACION + '\n\n' + RR_CIERRE_PUENTE : rrTextoPrecio(cat, plan.producto, 'puente', nom)), botonOpciones(), undefined, true);
    } else {
      const op = qrAbierto ? [] : menuAbierto();
      // Con un QR abierto no se ofrecen botones de producto (no se abre otro QR) ni el de Rubén: el texto cierra con la invitación a pagar, no con una pregunta.
      const durP = plan.duracion === true ? '\n\n' + RR_TEXTO_DURACION : '';
      m = qrAbierto ? texto(invitar(rrTextoPrecio(cat, plan.producto, false, nom) + durP)) : conBotones(durP !== '' ? rrTextoPrecio(cat, plan.producto, false, nom) + durP + (op.length > 0 ? '\n\n¿Qué opción prefieres?' : '') : rrTextoPrecio(cat, plan.producto, op.length > 0, nom), op);
    }
  } else if (tipoDePlan === 'info') {
    // Textos fijos de la base de conocimiento que el código dice solo si hacen falta: «lo voy a pensar» (con los dos precios del catálogo) y la muestra de voz (solo si la piden). Sin botones, sin aviso.
    m = texto(conPresentacion(plan.clave === 'muestra' ? rrTextoMuestra(base) : rrTextoPensar(cat, nom)));
  } else if (tipoDePlan === 'catalogo') {
    // El catálogo completo con precio, por código (los precios son los del catálogo de la consola). Con un QR abierto, texto plano con la invitación a pagar.
    const op = qrAbierto ? [] : menuAbierto();
    m = qrAbierto ? texto(invitar(rrTextoCatalogo(cat, false, nom))) : conBotones(rrTextoCatalogo(cat, op.length > 0, nom), op);
  } else if (tipoDePlan === 'imagenes') {
    // «¿Tienes imágenes?»: respuesta fija (no se envían imágenes del libro) y lo que sí hay, con los botones del menú vigente (con un QR abierto, texto plano con la invitación a pagar).
    const op = qrAbierto ? [] : menuAbierto();
    m = qrAbierto ? texto(invitar(rrTextoImagenes(true, false))) : conBotones(rrTextoImagenes(false, op.length > 0), op);
  } else if (tipoDePlan === 'menu') {
    const op = menu1();
    if (op.length) m = conBotones(RR_TEXTO_OPCIONES, op);
    else { tipoDePlan = 'derivar'; m = conRuben('Por ahora no puedo mostrarte las opciones de compra. Escríbele directo a Rubén con el botón.'); }
  } else if (tipoDePlan === 'opciones_codigo') {
    // El bloque de las opciones por código (un «sí» al puente o el botón «Ver opciones»): el texto fijo con el ahorro CALCULADO y el menú de productos. Sin botones que ofrecer, nunca una promesa de opciones.
    const op = menu1();
    tipoDePlan = 'opciones_fijo';
    m = op.length ? conBotones(rrTextoOpciones(cat, usadosHoy(), nom), op) : texto(rrTextoModeloCaido(false));
  } else if (tipoDePlan === 'audios') {
    // «Solo audios»: Audiolibro, Meditaciones y «Mejor el Pack», con los nombres y los precios del catálogo. Sin ningún botón que ofrecer, nunca una pregunta sin opciones.
    const op = rrMenuDeAudios(cat, usadosHoy(), nom);
    if (op.length) m = conBotones(RR_TEXTO_AUDIOS, op);
    else { tipoDePlan = 'derivar'; m = conRuben('Por ahora no puedo mostrarte las opciones de audio. Escríbele directo a Rubén con el botón.'); }
  } else if (tipoDePlan === 'resultado') {
    const op = qrAbierto ? [] : menuAbierto();
    // CASOS (c) y (d): el precio y la duración de los audios, si también los preguntó, van DELANTE de la respuesta de resultado, en el MISMO mensaje (un solo envío).
    const antes = [];
    const precioR = plan.precio && typeof plan.precio === 'object' ? rrTextoPrecioSolo(cat, plan.precio.producto, nom) : '';
    if (precioR !== '') antes.push(precioR);
    if (plan.duracion === true) antes.push(RR_TEXTO_DURACION);
    const delante = antes.length ? antes.join('\n\n') + '\n\n' : '';
    m = qrAbierto ? texto(invitar(conPresentacion(delante + rrTextoResultado(false)))) : conBotones(conPresentacion(delante + rrTextoResultado(op.length > 0)), op);
  } else if (tipoDePlan === 'qr') {
    const monto = rrPrecio(cat, plan.producto);
    const mediaId = rrMediaId(plan.mediaId);
    if (monto === null || monto !== plan.monto || mediaId === '' || !/^[A-Za-z0-9]{3,40}$/.test(String(plan.pedidoId || ''))) {
      // Nunca un QR sin monto del catálogo o sin id de medio: se deriva a Rubén (sin decir que se le avisó: no hay aviso).
      tipoDePlan = 'derivar';
      m = conRuben(rrTextoDerivacion('qr_sin_aviso', false, '', base));
    } else {
      const pie = rrSeguro(rrPieQr(plan.producto, monto, plan.pedidoId, plan.conPresentacion === true, negocio, nom));
      const respaldo = 'No pude mostrarte el QR en este momento. Escríbeme de nuevo en unos minutos para intentarlo otra vez.';
      m = cmMensaje('cliente', Object.assign(cmBase('image'), { image: { id: mediaId, caption: pie } }), pie, respaldo, { tipoReporte: 'image' });
      // El evento que ABRE el cobro: `qr_enviado`, con `referencia` (el pedido) y `monto` (el del catálogo). Cobro real: regla 2 (15 minutos, 3 intentos).
      m.evento = 'qr_enviado';
      m.reglaCobro = 2;
      m.referencia = String(plan.pedidoId);
      m.monto = monto;
      pedidoNuevo = { producto: plan.producto };
    }
  } else if (tipoDePlan === 'identidad') {
    // La identidad fija (prohibición 4): solo texto, sin botones, sin QR, sin aviso, sin modelo.
    m = texto(rrTextoIdentidad(negocio));
  } else if (tipoDePlan === 'baja') {
    // Un pedido de baja: solo la confirmación (sin invitación a pagar, sin botones, sin aviso).
    m = texto(RR_TEXTO_BAJA);
  } else if (tipoDePlan === 'qr_pendiente') {
    m = texto(rrTextoQrPendiente(plan.producto, plan.monto, fichaAntes.ultimoHash, nom));
  } else if (tipoDePlan === 'cobro_cerrado') {
    m = conRuben(RR_TEXTO_COBRO_CERRADO);
  } else if (tipoDePlan === 'cobro_ya_cerrado') {
    m = conRuben(RR_TEXTO_COBRO_YA_CERRADO);
  } else if (tipoDePlan === 'comprobante') {
    const r = rrTextoComprobante(plan.resultado, plan.causa, estadoAviso, plan.diferencia, base);
    // EL PASO DEL LIBRO AL PACK (por código, UNA vez por ficha): solo cuando el comprobante de un LIBRO cuadra y el aviso a Rubén salió, y solo si el catálogo trae los dos precios. Es el MISMO mensaje del comprobante, con el botón de la diferencia;
    // si Meta no entrega el botón, sale el respaldo SIN la oferta (nunca se ofrece lo que el texto no puede cumplir).
    const botonUpgrade = plan.resultado === 'cuadra' && estadoAviso === true && plan.producto === 'libro' && fichaAntes.upgrade === 0 ? rrBotonUpgrade(cat) : null;
    if (botonUpgrade && r.boton !== true) {
      const c = rrSeguro(r.cuerpo + '\n\n' + rrTextoUpgrade(cat));
      m = cmMensaje('cliente', cmBotones(c, [botonUpgrade]), c, rrSeguro(r.cuerpo), { tipoReporte: 'interactive' });
      upgradeOfrecido = true;
    } else m = r.boton === true ? conRuben(r.cuerpo) : texto(r.cuerpo);
  } else if (tipoDePlan === 'derivar') {
    // CASO (b): si el cliente también preguntó el precio, el precio (por código, del catálogo) va DELANTE de la derivación, en el MISMO mensaje; si es el primer mensaje, con la presentación.
    const precioDeriva = plan.precio && typeof plan.precio === 'object' ? rrTextoPrecioSolo(cat, plan.precio.producto, nom) : '';
    const derivacion = rrTextoDerivacion(plan.motivo, estadoAviso, plan.clave, base);
    m = conRuben(precioDeriva !== '' ? conPresentacion(precioDeriva + '\n\n' + derivacion) : derivacion);
    // Con un comprobante previo, «cancelar» no cancela: el evento `anulacion_avisada` solo avisa al servidor (viaja con el reporte del mensaje).
    if (plan.evento === 'anulacion_avisada') m.evento = 'anulacion_avisada';
  } else if (tipoDePlan === 'imagen_descrita') {
    // Dice lo que ve (descripción saneada por el módulo común, solo mostrada) y ofrece el libro y los precios. Sin botón de Rubén: no se deriva nada. Si es el primer mensaje, la presentación va en el MISMO mensaje.
    const cuerpo = rrTextoImagenDescrita(plan.descripcion, plan.documento === true, fichaAntes.ultimoHash);
    m = texto(conPresentacion(cuerpo));
  } else if (tipoDePlan === 'imagen_otra') {
    m = texto(plan.documento === true ? RR_TEXTO_DOCUMENTO : RR_TEXTO_IMAGEN);
  } else if (tipoDePlan === 'audio_fijo') {
    // Si es el primer mensaje del teléfono, la presentación fija va en el MISMO mensaje, en su propio párrafo (sin agregar un envío).
    const fijoAudio = plan.causa === 'largo' ? RR_TEXTO_AUDIO_LARGO : (plan.causa === 'corto' ? RR_TEXTO_AUDIO_CORTO : plan.causa === 'no_entendido' ? RR_TEXTO_AUDIO_NO_ENTENDIDO : RR_TEXTO_ARCHIVO_NO_ABIERTO);
    m = texto(conPresentacion(fijoAudio));
  } else if (tipoDePlan === 'archivo') {
    m = texto(plan.pesado === true ? RR_TEXTO_ARCHIVO_PESADO : RR_TEXTO_ARCHIVO_NO_ABIERTO);
  } else if (tipoDePlan === 'otro') {
    m = texto(RR_TEXTO_CORTES);
  } else {
    // Un plan desconocido jamás deja al cliente sin respuesta: la presentación mínima.
    m = texto(RR_SALUDO_MINIMO);
  }
}

// NUNCA EL MISMO TEXTO DOS VECES SEGUIDAS (PR-D, [D]; core `no-repetir`): si lo que sale es idéntico (por hash) a lo último que se le envió a este teléfono, sale una alternativa fija (con el botón de Rubén). Una derivación por cancelación o sin configuración repetida NO usa la alterna de contenido (no tiene sentido ahí): sale el texto de «Rubén ya recibió tu aviso anterior» y solo si también fuera idéntico, la alterna. Quedan EXENTOS el QR (su pie
// lleva el pedido), el resultado de un comprobante (cada comprobante es un hecho distinto), la protección ante violencia o miedo (su texto fijo y breve nunca se sustituye), el texto a un número extranjero y lo que
// contiene la presentación del asistente (qué ES: nunca se sustituye). Es el MISMO mensaje: no agrega ni quita ninguno.
if (m && puerta.ruta === 'sigue' && m.tipoReporte !== 'image' && ['comprobante', 'riesgo', 'fuera_pais', 'imagen_descrita', 'baja'].indexOf(tipoDePlan) < 0 && !/asistente virtual/i.test(String(m.texto || '')) && fichaAntes.ultimoHash !== '' && ctHashTexto(m.texto) === fichaAntes.ultimoHash) {
  const medio = /^(audio|imagen|otro|archivo)/.test(tipoDePlan);
  const motivoDeriva = tipoDePlan === 'derivar' ? String(plan.motivo || '') : '';
  const repetidoDeriva = motivoDeriva === 'cancelacion' || motivoDeriva === 'sin_configuracion' ? rrTextoDerivacion(motivoDeriva, 'repetido', plan.clave, base) : '';
  if (repetidoDeriva !== '' && ctHashTexto(repetidoDeriva) !== fichaAntes.ultimoHash) {
    m = conRuben(repetidoDeriva);
  } else {
    tipoDePlan = 'repetido';
    // El botón de Rubén va SOLO cuando el plan deriva: una repetición no deriva nada, así que sale en texto plano; si lo que se repite era una derivación (ya traía el botón), la alternativa lo conserva.
    const eraDerivacion = !!m.payload && !!m.payload.interactive && m.payload.interactive.type === 'cta_url';
    const alterna = ctAlternaDeRepetido({ medio: medio, hashUltimo: fichaAntes.ultimoHash, titular: 'Rubén', tratamiento: 'tu', alternas: RR_ALTERNAS });
    m = eraDerivacion ? conRuben(alterna) : texto(alterna);
  }
}

// LA PLANILLA DEL miniCRM (módulo `crm`): `guardarPlanilla` solo si hay id y hoja, no es el modo prueba, la puerta dejó seguir, el plan es de CONVERSACIÓN (nunca riesgo, baja, nada ni un número de otro país; tampoco con
// la protección por violencia o miedo ya activa en la ficha) y hay un mensaje. El prospecto se arma con `rrProspectoCrm` (vocabulario cerrado: el texto libre del cliente no pasa). Sin id (vacío), el flujo ni consulta Google. 0 mensajes por conversación.
const planillaOk = String(cfg.planillaProspectosId || '').trim() !== '' && String(cfg.planillaProspectosHoja || '').trim() !== '';
const guardarPlanilla = planillaOk && !prueba && puerta.ruta === 'sigue' && claveOk && !!m && riesgoNuevo !== true && fichaAntes.riesgo !== true
  && ['nada', 'riesgo', 'baja', 'fuera_pais'].indexOf(tipoDePlan) < 0
  // «Decidir turno» no mira el riesgo en el turno de un COMPROBANTE (el cobro sigue su camino); la planilla sí: ni el texto ni el pie de foto de ese turno pueden hablar de violencia o miedo.
  && !rrEsCrisis(rrNorm([t.texto, t.pie].join(' ')));
let prospectoPlanilla = null;

// La ficha: un solo lugar, al final del turno. Hasta en un turno sin mensaje (bloqueado) se recuerda el id de Meta (una entrega repetida no se cuenta dos veces).
if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const ficha = rrFichaVigente(cnFichaDe(fichas.mapa, from), ahora, atencionDelTurno);
  rrRecordarIds(ficha, [t.mensajeId]);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  // «Saludado» = ya se le presentó el asistente (una vez por teléfono). Un texto sin presentación (una derivación, un recordatorio) no cuenta.
  if (m && /asistente virtual/i.test(String(m.texto || '')) && tipoDePlan !== 'fuera_pais') ficha.saludado = true;
  if (tipoDePlan === 'fuera_pais' && m) ficha.fueraDePaisMs = ahora;
  // El límite de 30 minutos por motivo: se fija solo si el aviso SALIÓ (no si se repitió ni si no se pudo enviar).
  if (avisoPlaneado && !avisoRepetido && avisoSalio && typeof av.clave === 'string' && RR_CLAVES_AVISO.indexOf(av.clave) >= 0) ficha.avisosConsulta[av.clave] = ahora;
  if (usadoNuevo && ficha.usados.indexOf(usadoNuevo) < 0) ficha.usados = ficha.usados.concat([usadoNuevo]).slice(-10);
  if (respuestaDelModelo) ficha.modeloN += 1;
  // Lo anterior de la conversación: «Resumen del turno» lo restaura si Meta no aceptó el envío (la conversación solo cuenta lo que se entregó).
  hashPrevio = { h: ficha.ultimoHash, f: ficha.ultimaFirma, c: ficha.charlaN, po: ficha.pidioOpciones, ov: ficha.opcionesVistas, u: ficha.upgrade, preg: { pendientes: ficha.pendientes.map((x) => ({ p: x.p, ms: x.ms, i: x.i, c: x.c, b: x.b })) } };
  if (m && puerta.ruta === 'sigue') {
    // LA CONVERSACIÓN ANTES DE LAS OPCIONES: cuenta el mensaje que salió si es conversación (`vdCuentaComoCharla`: el saludo solo si lleva presentación; el ángulo cuenta como respuesta del modelo; el precio de un producto antes de la charla,
    // si es el primer mensaje, lleva la presentación y cuenta como saludo). NO cuentan los textos fijos que no son conversación (modelo caído, repetido, información, derivaciones).
    const tipoCuenta = tipoDePlan === 'angulo' || tipoDePlan === 'angulo_fijo' ? 'modelo' : (tipoDePlan === 'precio' && plan.temprano === true && !fichaAntes.saludado ? 'saludo' : tipoDePlan);
    if (vdCuentaComoCharla(tipoCuenta, fichaAntes.saludado)) ficha.charlaN = Math.min(ficha.charlaN + 1, 1000);
    if (plan.pideOpciones === true) ficha.pidioOpciones = true;
    // Quien ya vio las opciones (el bloque, el catálogo, los precios, el menú o «Solo audios») no vuelve a recibir el bloque ni el puente. (El precio de UN producto antes de la charla no cuenta como «ver las opciones».)
    if (['opciones', 'opciones_fijo', 'catalogo', 'menu', 'audios'].indexOf(tipoDePlan) >= 0 || (tipoDePlan === 'precio' && plan.temprano !== true)) { ficha.opcionesVistas = true; ficha.pidioOpciones = false; }
    // Lo último que se le dijo (hash del texto y tipo de plan): el recordatorio del QR no se repite dos veces seguidas y ningún texto sale idéntico dos veces seguidas. Solo cuenta el turno que contesta de verdad.
    ctRecordarEnviado(ficha, m.texto, tipoDePlan, m.tipoReporte === 'image');
    // Las preguntas pendientes (para entender un «Sí» o un «No» suelto): salen del texto que de verdad se envía, con la intención `ver_opciones` si lo que se preguntó es «¿Te muestro las opciones?» (puente o precio antes de la charla). Un botón pulsado contesta su pregunta.
    if (t.tipo === 'interactive') ctConsumirPorBoton(ficha, String(t.seleccionId || ''));
    const preguntaDelPuente = tipoDePlan === 'puente' || tipoDePlan === 'puente_fijo' || (tipoDePlan === 'precio' && plan.temprano === true && !qrAbierto);
    ctRecordarPreguntas(ficha, m.texto, ahora, { esImagen: m.tipoReporte === 'image', intenciones: RR_INTENCIONES, vigenciaMs: RR_VENTANA_PREGUNTA_MS, intencion: preguntaDelPuente ? 'ver_opciones' : undefined });
  }
  // «Cancela mi pedido» con un QR abierto: se libera la guarda LOCAL del QR (si el servidor cerró el cobro, ya no hay nada abierto; si no, sigue hasta que venza); se restaura si la respuesta no sale (`Resumen del turno`).
  if ((tipoDePlan === 'derivar' || tipoDePlan === 'cobro_cerrado') && plan.liberaGuarda === true && ficha.qrHastaMs > 0) { qrLiberado = { qrHastaMs: ficha.qrHastaMs }; ficha.qrHastaMs = 0; }
  if (riesgoNuevo) { ficha.riesgo = true; if (senalDeRiesgo || !(ficha.riesgoMs > 0)) ficha.riesgoMs = ahora; }
  // Con la protección activa, anota que una persona (Rubén) tiene tomada la conversación: es lo que permite levantarla cuando la devuelva (`rrFichaVigente`).
  if (ficha.riesgo === true && atencionDelTurno.pausa === true) ficha.pausaPersonaMs = ahora;
  if (upgradeOfrecido && m && puerta.ruta === 'sigue') ficha.upgrade = 1;
  // La memoria de la charla (15 mensajes): lo que dijo el cliente y lo que se le respondió, solo en la conversación (no en el cobro) y NUNCA en la protección por violencia o miedo.
  if (m && ['saludo', 'angulo', 'angulo_fijo', 'modelo', 'modelo_caido', 'puente', 'puente_fijo', 'charla_fija', 'opciones', 'opciones_fijo', 'precio', 'resultado', 'info'].indexOf(tipoDePlan) >= 0) {
    rrRecordarMensaje(ficha, 'u', decision.textoCliente);
    rrRecordarMensaje(ficha, 'm', m.texto);
  }
  // MARCA PROVISIONAL del QR: se fija aquí (el id del pedido y la guarda de 15 minutos necesitan existir ya) pero `Resumen del turno` la DESCARTA con `qrPrevio` si Meta no devolvió el `wamid` del QR
  // (sale el respaldo en texto): un QR que no salió no deja al cliente 15 minutos con «Ya tienes un QR abierto».
  if (pedidoNuevo) { qrPrevio = { pedidos: ficha.pedidos, producto: ficha.producto, qrHastaMs: ficha.qrHastaMs, upgrade: ficha.upgrade }; ficha.pedidos += 1; ficha.producto = pedidoNuevo.producto; ficha.qrHastaMs = ahora + RR_MINUTOS_QR * 60 * 1000; if (pedidoNuevo.producto === 'upgrade') ficha.upgrade = 2; }
  // El comprobante resuelto (todo menos «reintentar» e «ilegible», que siguen con el cobro abierto) cierra el cobro o lo pasa a Rubén: la guarda de 15 minutos del QR ya no tiene sentido.
  // Se guarda el valor previo para restaurarlo si la respuesta no sale (`Resumen del turno`).
  const huboComprobante = tipoDePlan === 'comprobante';
  if (huboComprobante && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible' && ficha.qrHastaMs > 0) { qrLiberado = { qrHastaMs: ficha.qrHastaMs }; ficha.qrHastaMs = 0; }
  // Un comprobante recibido (todo menos «reintentar» e «ilegible») habilita la queja de no entrega: antes de pagar no hay nada que entregar.
  if (huboComprobante && plan.resultado !== 'reintentar' && plan.resultado !== 'ilegible') ficha.comprobanteMs = ahora;
  fichas.mapa[from] = ficha;
  rrBarrer(fichas.mapa, ahora);
  if (guardarPlanilla) {
    // LA PLANILLA NUNCA TUMBA LA ATENCIÓN: si calcular el prospecto lanzara por un dato inesperado, este turno igual responde y simplemente no se escribe en la hoja.
    try {
      // «Contacto nuevo» = sin mensajes en las últimas 48 h (la ficha de ANTES de este turno).
      const nuevoContacto = !(fichaAntes.ultimoMs > 0 && ahora - fichaAntes.ultimoMs <= RR_OLVIDO_MS);
      prospectoPlanilla = rrProspectoCrm({ from: from, tipo: tipoDePlan, plan: plan, fichaAntes: fichaAntes, anuncio: t.anuncio === true, avisoSalio: avisoSalio === true, nombrePerfil: t.nombrePerfil, nuevoContacto: nuevoContacto, ahoraMs: ahora });
    } catch (e) { prospectoPlanilla = null; }
  }
}

const resumen = { plan: tipoDePlan === 'nada' ? (puerta.ruta || 'nada') : tipoDePlan, mensajes: 0, categoria: t.categoria || '', llamadasModelo: llamadasModelo, aviso: avisoPlaneado || avisoRepetido ? (avisoSalio || avisoRepetido ? 'salio' : 'no_salio') : (av.motivoFallo ? 'no_salio' : 'ninguno'), avisoMotivo: '' };
resumen.avisoMotivo = cmMotivoAviso({ aviso: resumen.aviso, motivoFallo: av.motivoFallo, planeado: avisoPlaneado, desde: from, numeroRecepcion: cnDigitos(cfg.numeroRecepcion) });
let numero = from;
if (prueba) numero = telPrueba;
// `mensajes` se calcula DESPUÉS de decidir el número: en prueba con un teléfono no permitido (`telPrueba` vacío) no sale nada y el resumen lo dice.
const sale = !!m && numero !== '';
resumen.mensajes = sale ? 1 : 0;
if (!sale) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen, guardarPlanilla: false, prospectoPlanilla: null } }];
}
m.payload.to = numero;
const salida = {
  para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo,
  tipoReporte: m.tipoReporte, evento: m.evento || '', esInteractivo: m.tipoReporte === 'interactive', esAviso: false, marcaAvisado: false, empresaAviso: '',
  // Solo lo que sale al cliente se reporta; en modo prueba, nada.
  reportar: !prueba,
  phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  plan: resumen.plan, resumen: resumen,
  guardarPlanilla: prospectoPlanilla !== null, prospectoPlanilla: prospectoPlanilla,
};
if (qrPrevio) salida.qrPrevio = qrPrevio;
if (qrLiberado) salida.qrLiberado = qrLiberado;
if (hashPrevio) salida.hashPrevio = hashPrevio;
if (m.reglaCobro === 2) salida.reglaCobro = 2;
if (m.referencia) salida.referencia = m.referencia;
if (m.monto !== undefined) salida.monto = m.monto;
return [{ json: salida }];
