// ARMAR MENSAJES: lo que sale a la persona, armado por CÓDIGO después de saber qué previos SALIERON (las imágenes y el aviso a recepción). UN mensaje por turno, o ninguno.
//
//   nada       -> nada sale (sin ítems: `sinMensajes`);
//   puerta     -> el texto neutro del comercio (suspendido) o el aviso fijo de uso extendido;
//   riesgo     -> el texto fijo de protección (sin botón, sin números, sin aviso) y `no_contactar`: 48 h de silencio;
//   baja       -> UNA confirmación breve y `no_contactar`: 48 h de silencio total (D1);
//   medica     -> texto fijo SIN consejo + el botón de la recepción («Ya avisé» solo si el aviso salió);
//   fijo       -> un texto cortés (archivo, audio ilegible…), sin botón;
//   derivar    -> el cierre fijo del guion con el nombre y la dirección de la Consola + UN botón `cta_url` a la recepción;
//   conversacion -> el texto del modelo, revisado AQUÍ con el resultado real de las imágenes (`evPulirSalida`); si no pasa la revisión, o el modelo falló: UN texto fijo y el botón de la recepción.
//
// «SOLO SE OFRECE LO QUE SE CUMPLE»: «ya avisé» sale SOLO si el aviso devolvió un `wamid` real; el botón aparece solo en la derivación, la consulta médica y el fallo; un texto del modelo que prometa una imagen que no
// salió, hable de «la paciente real» sin el antes y después, o prometa pasar con recepción sin el botón, pierde esas oraciones. La ficha del teléfono se escribe AQUÍ, una sola vez por turno.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const decision = cnPrimero('Decidir turno') || {};
const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : { tipo: 'nada' };
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);
const fichaBruta = cnFichaDe(cnMapaDeFichas(false).mapa, from);

// Lo que pasó con los previos. Un previo salió si Meta devolvió un `wamid` real; en modo prueba sin envío cuenta como salido.
const evId = (j) => { const m = j && j.messages; return !j || !!j.error ? false : (Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''); };
const previos = cnTodos('Armar previos');
const base0 = previos[0] || {};
const res = base0.res && typeof base0.res === 'object' ? base0.res : { efectivo: plan.tipo, textoModelo: '', nombreDerivacion: '', artesPlan: [], aviso: { planeado: false, repetido: false, clave: '', motivoFallo: '' } };
const enviados = previos.filter((i) => i && (i.kind === 'arte' || i.kind === 'aviso'));
const resultados = cnNodo('Enviar aviso') ? cnTodos('Enviar aviso') : [];
const simulado = base0.enviar === false;
const salio = (i) => (simulado ? true : (resultados.length === enviados.length && evId(resultados[i])));
const artesSalidos = [];
let avisoEnviado = false;
enviados.forEach((it, i) => {
  if (it.kind === 'arte' && salio(i) && artesSalidos.indexOf(it.arte) < 0) artesSalidos.push(it.arte);
  if (it.kind === 'aviso' && salio(i)) avisoEnviado = true;
});
// Con el envío saltado (modo prueba sin `enviarDeVerdad`) las imágenes y el aviso planeados cuentan como salidos.
if (simulado) {
  for (const k of (res.artesPlan || [])) if (artesSalidos.indexOf(k) < 0) artesSalidos.push(k);
  if (res.aviso && res.aviso.planeado === true) avisoEnviado = true;
}
const avisoRepetido = !!res.aviso && res.aviso.repetido === true;
const avisoSalio = avisoEnviado || avisoRepetido;

const efectivo = String(res.efectivo || plan.tipo || 'nada');
let planFinal = efectivo;   // el plan que se informa en el resumen (cambia a 'gratis' si el texto fijo de gratuidad sustituye al del modelo)
let ms = [];
let silencio = '';        // 'baja' | 'riesgo': el turno activa las 48 h de silencio
let rechazo = res.rechazo || null;   // por qué se descartó la respuesta del modelo (la batería lo imprime con --motivo)
let hist = null;          // lo que el asistente dijo y se recuerda si Meta lo acepta
const nombreNegocio = cfg.nombreNegocio || 'la Dra. Evy';
const texto = (cuerpo, extra) => {
  let c = evParrafos(cuerpo);
  if (EV_NIEGA_IA.test(evNorm(c))) c = evParrafos(EV_TEXTO_MINIMO);
  return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {}));
};
// El botón que abre el chat de la recepción. Sin número (o con el de quien escribe) no hay botón, y entonces el texto tampoco lo nombra.
const conRecepcion = (cuerpo) => {
  let c = evParrafos(cuerpo);
  if (EV_NIEGA_IA.test(evNorm(c))) c = evParrafos(EV_TEXTO_MINIMO);
  return cmContactoConBoton({ numero: cnDigitos(cfg.numeroRecepcion), desde: from, cuerpo: c, botonTexto: EV_BOTON_RECEPCION, saludo: 'Hola, escribo desde el chat de ' + nombreNegocio + '.', textoDelRespaldo: 'Escríbele aquí:', sinNumero: 'Eso lo ve la recepción directamente.', rotacion: Number(fichaBruta && fichaBruta.turnos) || 0 });
};
const fallo = () => conRecepcion(avisoSalio ? EV_TEXTO_FALLO_AVISADA : EV_TEXTO_FALLO);

if (puerta.ruta === 'fuera_de_prueba') {
  ms = [];
} else if (efectivo === 'nada') {
  ms = [];
} else if (efectivo === 'suspendido') {
  ms = [texto(String(plan.texto || ''))];
} else if (efectivo === 'uso_extendido') {
  // «Solo se ofrece lo que se cumple»: el texto que configura la Consola suele decir «una persona del equipo va a continuar esta conversación», y este flujo no avisa a nadie en ese estado. Se IGNORA ese texto y sale uno propio
  // que no promete nada y ofrece lo único que hay: el botón de la recepción.
  ms = [conRecepcion(EV_TEXTO_USO_EXTENDIDO)];
} else if (efectivo === 'riesgo') {
  silencio = 'riesgo';
  ms = [texto(EV_TEXTO_RIESGO, { evento: 'no_contactar' })];
} else if (efectivo === 'baja') {
  silencio = 'baja';
  ms = [texto(EV_TEXTO_BAJA_OK, { evento: 'no_contactar' })];
} else if (efectivo === 'medica') {
  ms = [conRecepcion(avisoSalio ? EV_TEXTO_MEDICA_AVISADA : EV_TEXTO_MEDICA)];
} else if (efectivo === 'fijo') {
  const fijos = { cortes: EV_TEXTO_CORTES, documento: EV_TEXTO_DOCUMENTO, audio_no_entendido: EV_TEXTO_AUDIO_NO_ENTENDIDO, audio_largo: EV_TEXTO_AUDIO_LARGO, audio_tope: EV_TEXTO_AUDIO_TOPE, archivo_no_abierto: EV_TEXTO_ARCHIVO_NO_ABIERTO, archivo_pesado: EV_TEXTO_ARCHIVO_PESADO };
  ms = [texto(fijos[plan.clave] || EV_TEXTO_CORTES)];
} else if (efectivo === 'derivar') {
  const nombre = res.nombreDerivacion || evNombreDelMensaje(plan.textoCliente, evHistorialVigente(evFichaVigente(fichaBruta, ahora), ahora)) || evPrimerNombre(t.nombrePerfil);
  // Con la comparación mostrada en esta conversación (el paciente aceptó la oferta de agendar) el cierre COMPLETO lleva la ubicación; sin ella, o sin enlace válido, queda exactamente como siempre.
  const cierre = evTextoCierre(cfg, nombre, evFichaVigente(fichaBruta, ahora).comparacionMostrada === true);
  ms = [conRecepcion(cierre)];
  hist = { a: ms[0].texto, b: ms[0].respaldo };
} else if (efectivo === 'derivar_corto') {
  // Nunca el mismo texto dos veces seguidas: dos variantes que se alternan.
  const ultimoA = evHistorialVigente(evFichaVigente(fichaBruta, ahora), ahora).filter((h) => h.r === 'a').slice(-1)[0];
  ms = [conRecepcion(ultimoA && String(ultimoA.t).indexOf(EV_TEXTO_DERIVAR_DE_NUEVO) === 0 ? EV_TEXTO_DERIVAR_DE_NUEVO_2 : EV_TEXTO_DERIVAR_DE_NUEVO)];
  hist = { a: ms[0].texto, b: ms[0].respaldo };
} else if (efectivo === 'comparacion') {
  // Texto de Andres, tal cual: no pasa por `evParrafos` (que lo reordenaría) ni por el recorte de 700. Sin pie de botón ni aviso.
  const c = evTextoComparacion(evNombreDeLaFicha(evHistorialVigente(evFichaVigente(fichaBruta, ahora), ahora), plan.textoCliente));
  ms = [cmMensaje('cliente', cmTexto(c), c, c, { tipoReporte: 'text' })];
  hist = { a: ms[0].texto, b: ms[0].texto };
} else if (efectivo === 'gratis') {
  ms = [texto(evTextoGratis(cfg, evDioNombre(evHistorialVigente(evFichaVigente(fichaBruta, ahora), ahora), plan.textoCliente)))];
  hist = { a: ms[0].texto, b: ms[0].texto };
} else if (efectivo === 'modelo') {
  const rev = evPulirSalida(res.textoModelo, { artesEnviados: artesSalidos, textoCliente: plan.textoCliente, nombreNegocio: cfg.nombreNegocio });
  if (rev.motivo === 'salud_sin_remision') { ms = [conRecepcion(EV_TEXTO_REMISION_SALUD)]; rechazo = { motivo: rev.motivo, detalle: rev.detalle || '' }; }
  else if ((rev.motivo !== '' || rev.texto === '') && evPreguntaGratis(plan.textoCliente)) {
    ms = [texto(evTextoGratis(cfg, evDioNombre(evHistorialVigente(evFichaVigente(fichaBruta, ahora), ahora), plan.textoCliente)))];
    hist = { a: ms[0].texto, b: ms[0].texto };
    rechazo = { motivo: rev.motivo || 'vacio', detalle: rev.detalle || '' };
    planFinal = 'gratis';
  }
  else if (rev.motivo !== '' || rev.texto === '') { ms = [fallo()]; rechazo = { motivo: rev.motivo || 'vacio', detalle: rev.detalle || '' }; }
  else {
    // Si el cliente pidió la ubicación y la Consola tiene el enlace de mapa, lo agrega el código (el prompt prohíbe enlaces al modelo).
    const mapa = evPideUbicacion(plan.textoCliente) ? evEnlaceDeMapa(cfg.direccionMaps) : '';
    ms = [texto(mapa && rev.texto.indexOf(mapa) < 0 ? rev.texto + '\n\n📍 Ubicación: ' + mapa : rev.texto)];
    hist = { a: rev.texto, b: rev.texto };
  }
} else if (efectivo === 'remision') {
  // La respuesta del modelo hablaba de la salud del cliente sin remitir a la valoración: sale el texto fijo de remisión, con el botón.
  ms = [conRecepcion(EV_TEXTO_REMISION_SALUD)];
} else if (efectivo === 'fallo') {
  ms = [fallo()];
} else {
  // Un plan desconocido jamás deja a la persona sin respuesta: el mínimo, con el botón.
  ms = [fallo()];
}

// La ficha: un solo lugar, al final del turno. Un número AJENO a la etapa de prueba, o de otro país, no deja ficha. Hasta en un turno sin mensaje (baja previa) se recuerda el id de Meta.
const sinFicha = puerta.ruta === 'fuera_de_prueba' || t.extranjero === true || !claveOk;
if (!sinFicha) {
  const fichas = cnMapaDeFichas(true);
  const ficha = evFichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  evRecordarId(ficha, t.mensajeId);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  // La memoria: la entrada del cliente se guarda cuando el turno es una conversación; lo que contó de su salud, su protección o su baja NO se guarda.
  if ((efectivo === 'modelo' || efectivo === 'fallo' || efectivo === 'derivar' || efectivo === 'derivar_corto' || efectivo === 'gratis' || efectivo === 'comparacion' || efectivo === 'fijo') && typeof decision.entradaHistorial === 'string' && decision.entradaHistorial.trim() !== '') {
    ficha.historial = evHistorialSaneado(ficha.historial.concat([{ r: 'u', t: decision.entradaHistorial }]));
  }
  if (decision.oyoAudio === true) ficha.audios = evContarMedio(ficha.audios, ahora);
  if (decision.vioImagen === true) ficha.imagenes = evContarMedio(ficha.imagenes, ahora);
  for (const k of artesSalidos) if (ficha.artes.indexOf(k) < 0) ficha.artes.push(k);
  if (silencio === 'baja' || silencio === 'riesgo') ficha.noContactarMs = ahora;
  if (silencio === 'riesgo') { ficha.riesgoMs = ahora; ficha.historial = []; }
  if (silencio === 'baja') ficha.historial = [];
  const clave = res.aviso ? String(res.aviso.clave || '') : '';
  if (res.aviso && res.aviso.planeado === true && avisoEnviado && EV_CLAVES_AVISO.indexOf(clave) >= 0) {
    ficha.avisos[clave] = ahora;
    const topes = evObjetoGlobal('evTopes', true);
    topes.mapa.avisos = evHoraContar(topes.mapa.avisos, ahora);
  }
  // Se guardan solo los campos vigentes (sin los derivados `noContactar` y `riesgo`, que se calculan al leer).
  const { noContactar, riesgo, comparacionMostrada, ...paraGuardar } = ficha;
  fichas.mapa[from] = paraGuardar;
  evBarrer(fichas.mapa, ahora);
}

const resumen = { plan: planFinal, mensajes: 0, categoria: t.categoria || '', llamadasModelo: decision.llamarModelo === true ? 1 : 0, imagenes: artesSalidos.length,
  aviso: res.aviso && (res.aviso.planeado === true || avisoRepetido) ? (avisoSalio ? 'salio' : 'no_salio') : (res.aviso && res.aviso.motivoFallo ? 'no_salio' : 'ninguno'),
  rechazo: rechazo, avisoMotivo: res.aviso && !avisoSalio && res.aviso.motivoFallo ? String(res.aviso.motivoFallo) : '' };
const numero = prueba ? telPrueba : from;
const sale = ms.length > 0 && numero !== '' && !sinFicha;
resumen.mensajes = sale ? ms.length : 0;
if (!sale) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
}
return ms.map((m) => {
  m.payload.to = numero;
  return { json: {
    para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo,
    tipoReporte: m.tipoReporte, evento: m.evento || '', esInteractivo: m.tipoReporte === 'interactive',
    // Solo lo que sale a la persona se reporta; en modo prueba, nada.
    reportar: !prueba,
    phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
    plan: resumen.plan, resumen: resumen, hist: hist,
  } };
});
