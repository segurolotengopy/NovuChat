// ARMAR MENSAJES: lo que sale al cliente (y a recepción), y el nodo que escribe la ficha del turno.
//
// Llega por tres caminos: el plan de «Armar turno» resuelto por el código (lista, planes, equipo, fijo), el plan que contestó el modelo (con su validación y, si hubo, su reintento) y la puerta
// cerrada (suspendido, uso extendido). Siempre hace lo mismo: arma UN ÍTEM POR MENSAJE, cada uno con su destinatario, su `payload` de la Cloud API, su texto de respaldo y si se reporta.
// El aviso a recepción es un ítem más y sale por el mismo «Enviar a WhatsApp».
//
// MENSAJES POR TURNO: uno al cliente (salvo bloqueado, ninguno) y, si el cliente pide hablar con el equipo y no se avisó en esta ventana, la plantilla a recepción (una vez por ventana).
// TODO mensaje del asistente, salvo la lista de rubros, el traspaso con su botón de enlace y los avisos del sistema, lleva los dos botones «Ver planes» y «Hablar con el equipo».
//
// LA FICHA SE ESCRIBE AQUÍ (la cola, el historial, el rubro, lo que el cliente dijo de sí mismo) y en «Registrar evento» (el evento que llega); `avisado` y `avisoFalla` los marca «Confirmar envío»
// con lo que Meta contestó. Aquí también se recuerdan los ids de Meta y se barren las fichas de más de 48 horas.
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const recepcion = cnDigitos(cfg.numeroRecepcion);
const puerta = cnPrimero('Puerta del turno') || {};
const turno = cnPrimero('Armar turno');
if (!turno || !turno.plan) return [];

const fichas = cnMapaDeFichas(true);
const claveOk = cnClaveValida(from);
const previa = claveOk ? cnFichaDe(fichas.mapa, from) : null;
const antes = chFichaVigente(previa, ahora);

let mensajes = [];
let nueva = antes;
let accion = turno.plan.ruta;
let conversacion = false;
let res = null;
let origen = '';
const plan = JSON.parse(JSON.stringify(turno.plan));

const texto = (s) => cmMensaje('cliente', cmTexto(s), s, s, { tipoReporte: 'text', evento: accion });
const aviso = (estado, marca, yaAvisado) => {
  const payload = chAviso({
    avisado: yaAvisado === true, numeroRecepcion: cfg.numeroRecepcion, desde: from, plantilla: cfg.plantillaAviso, idioma: cfg.idiomaPlantillaAviso,
    estado: estado, empresa: nueva.empresa, contacto: nueva.nombre, nombrePerfil: chNombreDelPerfil(t.nombrePerfil),
    rubro: (chRubroDe(cfg, nueva.rubro) || {}).nombre || '', flujos: (chRubroDe(cfg, nueva.rubro) || {}).flujo || '',
  });
  return payload ? { para: 'recepcion', payload: payload, texto: 'Aviso a recepción: ' + estado + '.', respaldo: '', tipoReporte: null, esAviso: true, marcaAvisado: marca, evento: 'aviso' } : null;
};

if (plan.ruta === 'suspendido' || plan.ruta === 'uso_extendido') {
  // La puerta cerró el turno: nada de modelo, planilla ni historial. Solo se recuerda el id (los repetidos de Meta no se vuelven a contar).
  nueva = chClon(antes);
  chRecordarIds(nueva, [t.mensajeId]);
  nueva.ultimoMs = ahora;
  if (plan.ruta === 'suspendido') {
    if (puerta.texto) mensajes.push(texto(String(puerta.texto)));
  } else {
    if (puerta.responder === true && puerta.texto) mensajes.push(texto(String(puerta.texto)));
    if (puerta.transferir === true) { const a = aviso('uso extendido: ya no se responde con IA', false); if (a) mensajes.push(a); }
  }
} else {
  conversacion = true;
  const eventos = Array.isArray(turno.eventos) ? turno.eventos : [];
  const validacion = chValidacion({ cfg: cfg, plan: plan, eventos: eventos, precios: turno.precios === true, ficha: antes });
  const intentos = [];
  if (turno.llamarModelo === true) {
    const v1 = cnPrimero('Validar respuesta');
    if (v1 && v1.primero) intentos.push({ lectura: v1.primero.lectura, causa: v1.primero.causa });
    const seg = cnPrimero('Reintentar el modelo');
    if (seg) intentos.push(chRevisarModelo(seg, validacion));
  }
  res = chResolver({ plan: plan, intentos: intentos, cfg: cfg, ficha: antes, eventos: eventos });
  origen = plan.ruta === 'modelo' ? res.origen : 'codigo';
  // `accion` del modelo: solo se ejecuta si el CÓDIGO la confirma con lo que el cliente escribió. La etiqueta del modelo no basta.
  if (plan.ruta === 'modelo' && res.accionConfirmada === 'equipo') { plan.ruta = 'equipo'; plan.hechos.pidioEquipo = true; }
  else if (plan.ruta === 'modelo' && res.accionConfirmada === 'planes') { plan.ruta = 'planes'; plan.hechos.pidioPlanes = true; }
  accion = plan.ruta;
  // El mensaje del turno. La ficha que se guarda dice lo que salió (historial) y lo que el cliente dijo.
  let m;
  if (plan.ruta === 'lista') m = chLista(cfg);
  else if (plan.ruta === 'planes') m = chMensajePlanes(cfg, { aMedida: plan.aMedida, repite: antes.planesMostrados === true, tope: plan.tope === true });
  else if (plan.ruta === 'fijo') m = chCliente(chRespuestaFija(plan.fijo, cfg), cfg, 'fijo');
  else if (plan.ruta === 'equipo') {
    // Si el cliente dio su nombre y su negocio en este mismo turno, el traspaso no los vuelve a pedir: se usan los de la ficha NUEVA (como el aviso).
    const previa = chAplicarTurno({ ficha: antes, eventos: eventos, hasta: turno.hasta, plan: plan, res: res, mensaje: '', ahoraMs: ahora, anuncio: t.anuncio === true });
    m = chMensajeEquipo(cfg, Object.assign({}, antes, { nombre: previa.nombre, empresa: previa.empresa }), from);
  }
  else m = chCliente(res.texto, cfg, res.evento);
  mensajes.push(m);
  nueva = chAplicarTurno({ ficha: antes, eventos: eventos, hasta: turno.hasta, plan: plan, res: res, mensaje: m.texto, ahoraMs: ahora, anuncio: t.anuncio === true });
  // Pedir hablar con el equipo: la plantilla a recepción, UNA vez por ventana (`avisado` cuenta solo lo que Meta aceptó) y nunca al propio número de recepción.
  if (plan.ruta === 'equipo') { const a = aviso((chDatos(cfg).textos || {}).estadoAviso, true, antes.avisado === true); if (a) mensajes.push(a); }
}

// ====================================================== destinatarios, modo prueba, ids
const PREFIJO_RECEPCION = '[a recepción] ';
const salida = [];
for (const m of mensajes) {
  let numero = m.para === 'recepcion' ? recepcion : from;
  if (prueba) numero = telPrueba;
  if (!numero) continue;
  const p = m.payload;
  p.to = numero;
  let tx = m.texto;
  if (prueba && m.para === 'recepcion') {
    tx = PREFIJO_RECEPCION + tx;
    if (p.type === 'template') p.template.components[0].parameters[0].text = cnRecorte(PREFIJO_RECEPCION + p.template.components[0].parameters[0].text, 60);
  }
  salida.push({ json: {
    para: numero, destino: m.para, payload: p, texto: tx, respaldo: m.respaldo || m.texto,
    tipoReporte: m.tipoReporte || null, evento: m.evento || '', esInteractivo: p.type === 'interactive',
    esAviso: m.esAviso === true, marcaAvisado: m.marcaAvisado === true,
    // Solo lo que sale al cliente se reporta; en modo prueba, nada.
    reportar: !prueba && m.para === 'cliente' && !!m.tipoReporte,
    phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  } });
}

// ============================================ LA FICHA: un solo lugar, al final del turno
if (claveOk) {
  fichas.mapa[from] = nueva;
  // Primero se escribe y después se barre: así el total nunca pasa del tope (5.000), contando esta ficha.
  chBarrer(fichas.mapa, ahora);
}

// ============================================ el prospecto: solo si la ficha cambió. En modo prueba la planilla NO se escribe (una prueba no llena la hoja de nadie).
const planillaOk = !prueba && String(cfg.planillaProspectosId || '').trim() !== '' && String(cfg.planillaProspectosHoja || '').trim() !== '';
const datosDe = { from: from, nombrePerfil: chNombreDelPerfil(t.nombrePerfil) };
const despues = conversacion ? chProspecto(nueva, cfg, datosDe) : null;
const primeraVez = antes.historial.length === 0;
const cambio = despues !== null && (primeraVez || JSON.stringify(despues) !== JSON.stringify(chProspecto(antes, cfg, datosDe)));
const guardarPlanilla = cambio && planillaOk;

// R8: la ficha de ANTES de este turno (con su cola de eventos sin responder) viaja en el primer ítem: si Meta rechaza el mensaje y su respaldo, «Confirmar envío» la restaura.
const fichaAntes = claveOk ? chClon(antes) : null;
const resumen = {
  plan: accion, contexto: plan.contexto || '', origen: origen, causas: res ? res.causas : [], eventos: (turno.eventos || []).length, mensajes: salida.length,
  llamadasModelo: turno.llamarModelo === true ? ((cnNodo('Reintentar el modelo') ? 2 : 1)) : 0, rubro: nueva.rubro, hechos: nueva.hechos, descarte: res ? res.descarte : '',
};
if (!salida.length) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: accion, resumen: resumen, fichaAntes: fichaAntes,
    guardarPlanilla: guardarPlanilla, prospectoPlanilla: guardarPlanilla ? despues : null } }];
}
const primero = salida[0].json;
primero.resumen = resumen;
primero.fichaAntes = fichaAntes;
primero.guardarPlanilla = guardarPlanilla;
primero.prospectoPlanilla = guardarPlanilla ? despues : null;
return salida;
