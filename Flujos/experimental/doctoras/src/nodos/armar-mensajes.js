// ARMAR MENSAJES: lo que sale a la persona, armado por CÓDIGO. UN mensaje por turno, o ninguno; la ÚNICA excepción es el PRIMER turno, que emite DOS (la presentación y la pregunta, +1 mensaje por conversación).
//
// Lee el plan de «Decidir turno» (o, si fue `libre`, la intención que el modelo clasificó: `drResolver`) y arma: un texto, un texto con botones, una lista, o un texto con el botón que abre el chat de la recepción.
// TODO texto de contenido sale FIJO del dato de la doctora; lo único que escribe el modelo es UNA línea de empatía, que pasa por `cmRevisarRedaccion` (filtro común) y por `drExtraEmpatia`; si se rechaza, no sale.
//
//   puerta «suspendido»    -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido» -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por persona) NO SALE NADA: cero envío, cero modelo, cero descarga;
//   puerta «sigue»         -> según `plan.tipo` (ver «Decidir turno»).
//
// «SOLO SE OFRECE LO QUE SE CUMPLE»: «te escribirá la recepción» / «ya avisé» salen SOLO si «Enviar aviso» devolvió un `wamid` real (`avisoSalio`); si no, el texto dice la verdad y trae el botón.
// En modo prueba sin `enviarDeVerdad` el aviso no se envía y cuenta como salido (igual que los mensajes: la prueba no gasta mensajes). Todo texto pasa por `drSeguro` (NIEGA_IA, palabras prohibidas y párrafos).
// La ficha del teléfono (`doctoras[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno. La baja y el riesgo se reportan con el evento `no_contactar`.
const cfg = cnCfg();
const base = cnPrimero('Config base') || {};
const datos = drDatosVivos(base, cnPrimero('Traer configuración'));
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const decision = cnPrimero('Decidir turno') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);
const fichaAntes = drFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);
const final = drResolver(decision, cnJsonDeGemini(cnPrimero('Conversar con el modelo')), fichaAntes, datos);
const plan = final.plan && typeof final.plan === 'object' ? final.plan : { tipo: 'nada' };

const drId = (j) => { const m = j && j.messages; return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== ''; };
// Lo que pasó con el aviso a la recepción lo dice «Armar avisos» (`planeado`, `repetido`, `motivoFallo`). «Ya avisé» exige un `wamid` real de «Enviar aviso».
const av = cnPrimero('Armar avisos') || {};
const avisoPlaneado = av.planeado === true;
const avisoRepetido = av.repetido === true;
const avisoEnviado = avisoPlaneado && (cnTodos('Enviar aviso').some(drId) || (prueba && cfg.enviarDeVerdad !== true));
const avisoSalio = avisoEnviado || avisoRepetido;

const doctora = drDatoLleno(datos.nombreCorto) || 'la doctora';
const dt = (clave, extra) => drTextoDe(datos, clave, extra);
let ms = [];               // los mensajes del turno (cmMensaje)
let riesgoNuevo = false;
let bajaNueva = false;
let cambios = {};          // lo que el turno cambia en la ficha
const texto = (cuerpo, extra) => { const c = drSeguro(cuerpo); return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {})); };
const conBotones = (cuerpo, botones, extra) => {
  const c = drSeguro(cuerpo);
  if (!botones.length) return texto(cuerpo, extra);
  const respaldo = c + '\n\nEscríbeme cuál prefieres: ' + botones.map((b) => b.title).join(', ') + '.';
  return cmMensaje('cliente', cmBotones(c, botones), c, respaldo, Object.assign({ tipoReporte: 'interactive' }, extra || {}));
};
const conLista = (cuerpo, filas) => {
  const c = drSeguro(cuerpo);
  const respaldo = c + '\n\nEscríbeme cuál prefieres: ' + filas.map((f) => f.title).join(', ') + '.';
  return cmMensaje('cliente', cmLista(c, DR_TITULOS.a_lista, 'Tratamientos', filas), c, respaldo, { tipoReporte: 'interactive' });
};
// El botón que abre el chat de la recepción. Sin número (o con el de quien escribe) no hay botón, y entonces el texto tampoco lo nombra.
const numeroRecepcion = cnDigitos(cfg.numeroRecepcion);
const hayBoton = numeroRecepcion !== '' && numeroRecepcion !== cnDigitos(from);
const conRecepcion = (cuerpo) => {
  const pars = String(cuerpo).split('\n\n').filter((p) => hayBoton || !/bot[oó]n/i.test(p));
  const c = drSeguro(pars.join('\n\n') || dt('otra').split('\n\n')[0]);
  return cmContactoConBoton({ numero: numeroRecepcion, desde: from, cuerpo: c, botonTexto: DR_BOTON_RECEPCION, saludo: 'Hola, escribo desde el chat de la ' + doctora + '.', textoDelRespaldo: 'Escríbele aquí:', sinNumero: 'Eso lo ve la recepción directamente.', rotacion: fichaAntes.turnos });
};
// La línea de empatía del modelo: solo si pasa el filtro común y las reglas propias; si no, no sale.
let empatia = '';
if (final.empatia && ['texto', 'lista', 'tratamiento'].indexOf(plan.tipo) >= 0) {
  const rev = cmRevisarRedaccion(final.empatia, { maximo: 160, enlacesPermitidos: [], quienPromete: [], nombreNegocio: cfg.nombreNegocio, textoDelCliente: t.texto, extra: [drExtraEmpatia] });
  if (rev.motivo === '' && rev.texto.trim() !== '') empatia = rev.texto.trim();
}
const conEmpatia = (c) => (empatia ? empatia + '\n\n' + c : c);

// La protección ante violencia o miedo se arma aunque la puerta no «siga» (comercio suspendido, estado «operador»).
const rutaDelTurno = plan.tipo === 'riesgo' ? 'sigue' : puerta.ruta;
if (rutaDelTurno === 'suspendido' || rutaDelTurno === 'uso_extendido') {
  if (puerta.responder === true && String(puerta.texto || '').trim() !== '') ms = [texto(String(puerta.texto))];
} else if (rutaDelTurno === 'sigue') {
  const tipo = plan.tipo;
  if (tipo === 'riesgo') {
    riesgoNuevo = true;
    ms = [texto(DR_TEXTO_RIESGO, { evento: 'no_contactar' })];
  } else if (tipo === 'baja') {
    bajaNueva = true;
    ms = [texto(dt('baja_ok'), { evento: 'no_contactar' })];
  } else if (tipo === 'apertura') {
    // EL PRIMER TURNO: DOS mensajes (+1 por conversación). El 1.º, la presentación como asistente virtual de la doctora (una sola vez); el 2.º, SOLO la pregunta: sin lista ni botones.
    const partes = [dt('presentacion'), drDatoLleno(plan.aperturaArte), dt('apertura'), dt('baja_instruccion')].filter((x) => x !== '');
    ms = [texto(partes.join('\n\n')), texto(dt('pregunta'))];
    cambios = { saludado: true, etapa: 'catalogo', arte: /^[a-z0-9]{1,16}$/.test(String(plan.entrada || '')) ? String(plan.entrada) : '' };
  } else if (tipo === 'lista') {
    const filas = drFilas(fichaAntes, datos);
    const prefijo = plan.prefijo ? conEmpatia(dt(plan.prefijo)) : conEmpatia('');
    if (filas.length) {
      ms = [conLista((prefijo ? prefijo.replace(/\n+$/, '') + '\n\n' : '') + dt('lista_intro'), filas)];
    } else ms = [prefijo.trim() !== '' ? texto(prefijo) : conRecepcion(dt('otra'))];
    cambios = { etapa: 'consulta' };
  } else if (tipo === 'texto') {
    const botones = plan.sinOfertas === true ? [] : drOfertas(fichaAntes);
    ms = [conBotones(conEmpatia(dt(plan.clave)), botones)];
    if (fichaAntes.etapa === 'catalogo') cambios = { etapa: 'consulta' };
  } else if (tipo === 'tratamiento') {
    const tr = drTratamientoPorId(datos, plan.id);
    ms = [conBotones(conEmpatia(drDatoLleno(tr && tr.frase) + '\n\n' + dt('especifico')), drOfertas(fichaAntes))];
    cambios = { interes: tr ? String(tr.id) : '', etapa: fichaAntes.etapa === 'catalogo' ? 'consulta' : fichaAntes.etapa };
  } else if (tipo === 'arte') {
    ms = [conBotones([drDatoLleno(plan.aperturaArte), dt('apertura')].filter((x) => x !== '').join('\n\n'), drOfertas(fichaAntes))];
  } else if (tipo === 'recepcion') {
    let clave = plan.clave;
    if (plan.aviso === true && avisoSalio && drTextoDe(datos, clave + '_con_aviso') !== '') clave = clave + '_con_aviso';
    ms = [conRecepcion(dt(clave))];
  } else if (tipo === 'consentimiento') {
    const n = plan.repite === true ? Math.max(1, fichaAntes.pedidos) : fichaAntes.pedidos + 1;
    const botones = [{ id: 'c_si' + n, title: 'Sí, que me escriban' }, { id: 'c_no' + n, title: 'Ahora no' }];
    ms = [conBotones(dt('consentimiento'), botones)];
    cambios = { etapa: 'consentimiento', pedidos: n };
  } else if (tipo === 'consentimiento_no') {
    ms = [texto(dt('consentimiento_no'))];
    cambios = { consentimiento: 'no', etapa: 'consulta' };
  } else if (tipo === 'pedir_nombre') {
    ms = [texto(dt('pedir_nombre'))];
    cambios = { consentimiento: 'si', etapa: 'nombre', reintentos: 0 };
  } else if (tipo === 'nombre_repetir') {
    ms = [texto(dt('nombre_repetir'))];
    cambios = { reintentos: 1 };
  } else if (tipo === 'pedir_contacto') {
    const nombre = plan.repite === true ? fichaAntes.nombre : drNombre(plan.nombre);
    ms = [conBotones(dt('pedir_contacto', { nombre: nombre }), drSinUsar(fichaAntes, ['n_este', 'n_otro']).map((id) => ({ id: id, title: DR_TITULOS[id] })))];
    cambios = { etapa: 'contacto', reintentos: 0, nombre: nombre };
  } else if (tipo === 'pedir_otro_numero') {
    ms = [texto(dt('pedir_otro_numero'))];
    cambios = { etapa: 'contacto_otro', reintentos: plan.repite === true ? 1 : 0 };
  } else if (tipo === 'pedir_horario') {
    ms = [texto(drTieneHorario(datos) ? dt('pedir_horario_con') : dt('pedir_horario'))];
    cambios = { etapa: 'horario', contacto: plan.contacto && /^\d{8,15}$/.test(String(plan.contacto)) ? String(plan.contacto) : fichaAntes.contacto };
  } else if (tipo === 'derivado') {
    ms = [conRecepcion(dt(avisoSalio ? 'cierre_con_aviso' : 'cierre_sin_aviso', { nombre: fichaAntes.nombre }))];
    // Los datos de la persona se borran de la ficha al derivar: lo que viajó, viajó en el aviso.
    cambios = { etapa: 'consulta', derivado: avisoSalio, nombre: '', horario: '', contacto: '' };
  } else if (tipo === 'cancelar') {
    ms = [texto(dt('cancelar_ok'))];
    cambios = { etapa: 'consulta' };
  } else if (tipo === 'imagen_otra') {
    ms = [texto(DR_TEXTO_IMAGEN)];
  } else if (tipo === 'audio_fijo') {
    ms = [texto(plan.causa === 'largo' ? DR_TEXTO_AUDIO_LARGO : (plan.causa === 'no_entendido' ? DR_TEXTO_AUDIO_NO_ENTENDIDO : DR_TEXTO_ARCHIVO_NO_ABIERTO))];
  } else if (tipo === 'archivo') {
    ms = [texto(plan.pesado === true ? DR_TEXTO_ARCHIVO_PESADO : DR_TEXTO_ARCHIVO_NO_ABIERTO)];
  } else if (tipo === 'otro') {
    ms = [texto(DR_TEXTO_CORTES)];
  } else if (tipo !== 'nada') {
    // Un plan desconocido jamás deja a la persona sin respuesta: el mínimo.
    ms = [conRecepcion(DR_TEXTO_MINIMO)];
  }
}

// La ficha: un solo lugar, al final del turno. Hasta en un turno sin mensaje (bloqueado, baja) se recuerda el id de Meta (una entrega repetida no se cuenta dos veces).
if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const ficha = drFichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  drRecordarIds(ficha, [t.mensajeId]);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  Object.assign(ficha, cambios);
  // Un toque que el turno atendió no reaparece (las filas de la lista y los botones, por su id).
  const id = String(t.seleccionId || '');
  if (ms.length && /^[a-z]_[a-z0-9]{1,16}$/.test(id) && ficha.usados.indexOf(id) < 0) ficha.usados = ficha.usados.concat([id]).slice(-20);
  if (riesgoNuevo) ficha.riesgo = true;
  if (bajaNueva) ficha.baja = true;
  if (plan.tipo === 'derivado') ficha.horario = '';
  // El límite de 30 minutos por motivo: se fija solo si el aviso SALIÓ (no si se repitió ni si no se pudo enviar).
  if (avisoPlaneado && !avisoRepetido && avisoSalio && typeof av.clave === 'string' && DR_CLAVES_AVISO.indexOf(av.clave) >= 0) ficha.avisosConsulta[av.clave] = ahora;
  fichas.mapa[from] = ficha;
  drBarrer(fichas.mapa, ahora);
}

const llamadas = decision.llamarModelo === true ? 1 : 0;
const resumen = { plan: plan.tipo === 'nada' ? (puerta.ruta || 'nada') : plan.tipo, mensajes: 0, categoria: t.categoria || '', llamadasModelo: llamadas, aviso: avisoPlaneado || avisoRepetido ? (avisoSalio ? 'salio' : 'no_salio') : (av.motivoFallo ? 'no_salio' : 'ninguno'), avisoMotivo: '' };
resumen.avisoMotivo = cmMotivoAviso({ aviso: resumen.aviso, motivoFallo: av.motivoFallo, planeado: avisoPlaneado, desde: from, numeroRecepcion: cnDigitos(cfg.numeroRecepcion) });
const numero = prueba ? telPrueba : from;
const sale = ms.length > 0 && numero !== '';
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
    plan: resumen.plan, resumen: resumen,
  } };
});
