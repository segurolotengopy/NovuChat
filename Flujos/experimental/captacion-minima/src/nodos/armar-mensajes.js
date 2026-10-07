// ARMAR MENSAJES: lo que sale al cliente (y a recepcion), y el UNICO nodo que escribe la ficha del telefono.
//
// Llega por cuatro caminos —el plan de «Decidir turno» (con la salida del modelo si se la pidio), «Comercio no operativo» y
// «Uso extendido»— y siempre hace lo mismo: arma UN ITEM POR MENSAJE, cada uno con su destinatario, su `payload` de la Cloud API,
// su texto de respaldo y si se reporta. El aviso a recepcion es un item mas (D6) y sale por el mismo «Enviar a WhatsApp».
//
// LA FICHA (`staticData.global.captacionMinima[<telefono>]`) SE ESCRIBE AQUI Y EN NINGUN OTRO LADO, salvo `avisado` y
// `avisoFalla`, que marca «Confirmar envío» con lo que Meta contesto. Aca tambien se recuerda el id del mensaje de Meta (los
// repetidos se descartan en «Interpretar entrada») y se barren las fichas de mas de 48 horas.
//
// MENSAJES POR TURNO: uno al cliente (salvo bloqueado, ninguno) y, si pide una persona por primera vez, la plantilla a recepcion.
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const recepcion = cnDigitos(cfg.numeroRecepcion);

const decidir = cnPrimero('Decidir turno');
const noOperativo = cnPrimero('Comercio no operativo');
const usoExtendido = cnPrimero('Uso extendido');

const fichas = cnMapaDeFichas(true);
// S6: este flujo se publica ENCIMA del anterior (mismo workflow): lo que el flujo viejo dejo en los datos estaticos (`conversaciones`
// y `vistos`, con datos de prospectos) no se lee y se borra. La ficha de este flujo vive en otra clave (`captacionMinima`).
if (fichas.sd) { delete fichas.sd.conversaciones; delete fichas.sd.vistos; }
const claveOk = cnClaveValida(from);
const previa = claveOk && Object.prototype.hasOwnProperty.call(fichas.mapa, from) ? fichas.mapa[from] : null;
const antes = ccEstadoVigente(previa, ahora);

let mensajes = [];
let estado = antes;
let accion = 'nada';
let avisos = [];        // avisos de configuracion del turno (p. ej. `rubro_sin_guion`): la suite y la bateria los cuentan
let conversacion = false;   // true si fue un turno del guion (los demas no tocan la planilla)

if (decidir && decidir.plan) {
  const ids = ccIdsDeAclaraciones(cfg);
  const aclaraciones = (Array.isArray(cfg.aclaraciones) ? cfg.aclaraciones : []).slice(0, 15).map((a, i) => ({ id: ids[i], texto: a.texto }));
  const modelo = decidir.llamarModelo === true
    ? ccLeerModelo(cnPrimero('Llamar al modelo') || {}, {
      rubroIds: ccIdsDeRubros(cfg), aclaracionIds: ids, aclaraciones: aclaraciones,
      textoCliente: decidir.plan.texto, textoDeImagen: decidir.plan.textoDeImagen, nombreNegocio: cfg.nombreNegocio, asesor: cfg.asesor,
      // Los nombres propios que el modelo puede decir (§16): el asistente y los planes de la consola.
      nombreAsistente: cfg.nombreAsistente, planes: cfg.planes,
      // Lo que ve el modelo: una `respuesta` solo puede traer los numeros que estan ahi (S3).
      datos: String((((decidir.cuerpoModelo || {}).systemInstruction || {}).parts || [{}])[0].text || ''),
    }) : null;
  const r = ccCompletar({ plan: decidir.plan, modelo: modelo, cfg: cfg });
  mensajes = r.mensajes;
  estado = r.e;
  accion = r.accion;
  avisos = Array.isArray(r.avisos) ? r.avisos : [];
  conversacion = true;
} else if (noOperativo) {
  const texto = String(noOperativo.texto || '');
  mensajes = [cmMensaje('cliente', cmTexto(texto), texto, texto, { tipoReporte: 'text', evento: 'suspendido' })];
  accion = 'suspendido';
} else if (usoExtendido) {
  accion = 'uso_extendido';
  if (usoExtendido.responder === true && usoExtendido.texto) {
    const texto = String(usoExtendido.texto);
    mensajes.push(cmMensaje('cliente', cmTexto(texto), texto, texto, { tipoReporte: 'text', evento: 'uso_extendido' }));
  }
  if (usoExtendido.transferir === true) {
    const payload = ccAviso({
      avisado: false, numeroRecepcion: cfg.numeroRecepcion, desde: from, plantilla: cfg.plantillaAviso, idioma: cfg.idiomaPlantillaAviso,
      estado: 'uso extendido: ya no se responde con IA', empresa: antes.empresa, contacto: '', nombrePerfil: t.nombrePerfil, rubro: '', flujos: '',
    });
    if (payload) mensajes.push({ para: 'recepcion', payload: payload, texto: 'Aviso a recepción: uso extendido.', respaldo: '', tipoReporte: null, esAviso: true, marcaAvisado: false, evento: 'aviso' });
  }
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
  let texto = m.texto;
  if (prueba && m.para === 'recepcion') {
    texto = PREFIJO_RECEPCION + texto;
    if (p.type === 'template') p.template.components[0].parameters[0].text = cnRecorte(PREFIJO_RECEPCION + p.template.components[0].parameters[0].text, 60);
  }
  salida.push({ json: {
    para: numero, destino: m.para, payload: p, texto: texto, respaldo: m.respaldo || m.texto,
    tipoReporte: m.tipoReporte || null, evento: m.evento || '', esInteractivo: p.type === 'interactive',
    esAviso: m.esAviso === true, marcaAvisado: m.marcaAvisado === true,
    // Solo lo que sale al cliente se reporta; en modo prueba, nada.
    reportar: !prueba && m.para === 'cliente' && !!m.tipoReporte,
    phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  } });
}

// ============================================ LA FICHA: un solo lugar, al final del turno
if (claveOk) {
  const nueva = ccClon(estado);
  nueva.ultimoMensajeMs = ahora;
  ccRecordarId(nueva, t.mensajeId);
  fichas.mapa[from] = nueva;
  // Primero se escribe y despues se barre: asi el total nunca pasa del tope (5.000), contando esta ficha.
  ccBarrer(fichas.mapa, ahora);
}

// ============================================ el prospecto: planilla y CRM, solo si la ficha cambio
// En modo prueba la planilla NO se escribe (S7): una prueba no puede llenar la hoja de prospectos de nadie.
const planillaOk = !prueba && String(cfg.planillaProspectosId || '').trim() !== '' && String(cfg.planillaProspectosHoja || '').trim() !== '';
const crmOk = /^https:\/\//.test(String(cfg.crmUrl || ''));
const datosDe = (e) => ({ from: from, nombrePerfil: t.nombrePerfil, rubros: cfg.rubros });
const despues = conversacion ? ccProspecto(estado, datosDe(estado)) : null;
const primeraVez = !previa || antes.ultimoMensajeMs === 0;
const cambio = despues !== null && (primeraVez || JSON.stringify(despues) !== JSON.stringify(ccProspecto(antes, datosDe(antes))));
const guardarPlanilla = cambio && planillaOk;
const guardarCrm = cambio && crmOk;
const celda = (v) => String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200);

// R8: la ficha de ANTES de este turno viaja en el primer item: si Meta rechaza el mensaje y su respaldo, «Confirmar envío» la restaura.
const fichaAntes = claveOk ? antes : null;
const resumen = { plan: accion, estadoDespues: claveOk ? estado : null, mensajes: salida.length, hechos: estado.hechos, paso: estado.paso, avisos: avisos };
if (!salida.length) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: accion, resumen: resumen, fichaAntes: fichaAntes, avisos: avisos,
    guardarPlanilla: guardarPlanilla, prospectoPlanilla: guardarPlanilla ? despues : null, guardarCrm: false, cuerpoCrm: null } }];
}
const primero = salida[0].json;
primero.resumen = resumen;
primero.avisos = avisos;
primero.fichaAntes = fichaAntes;
primero.guardarPlanilla = guardarPlanilla;
primero.prospectoPlanilla = guardarPlanilla ? despues : null;
primero.guardarCrm = guardarCrm;
primero.crmUrl = guardarCrm ? String(cfg.crmUrl) : '';
primero.cuerpoCrm = guardarCrm ? Object.assign({
  origen: 'whatsapp', telefono: despues.telefono, nombrePerfil: celda(t.nombrePerfil), estado: despues.estado,
  empresa: despues.empresa, rubro: despues.rubro, fecha: new Date(ahora).toISOString(),
}, despues.anuncio ? { anuncio: true } : {}) : null;
return salida;
