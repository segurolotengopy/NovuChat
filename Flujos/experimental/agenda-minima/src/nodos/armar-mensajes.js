// ARMAR MENSAJES: todo lo que sale por WhatsApp se arma ACA, con codigo, y sale un item
// por mensaje: {para, payload, texto, respaldo, tipoReporte, ...}. Tambien es el UNICO
// lugar donde se escribe el estado por telefono (`staticData`), al final del turno.
//
// LO QUE NUNCA HACE:
//   - confirmar una cita que el calendario no creo (la confirmacion la arma el codigo
//     con el dia y la hora del evento; el modelo no interviene);
//   - dejar salir un texto redactado por el modelo que nombre una hora que no este entre
//     los huecos calculados, que diga «no quedan horarios» habiendolos, que deje un hueco
//     («a las )»), que sea clinico, mencione el 168 o prometa algo que el flujo no cumple:
//     en esos casos se descarta la redaccion y se usa un texto fijo armado por codigo;
//   - ofrecer algo distinto de pasar con recepcion (aviso a recepcion MAS un boton que abre
//     su chat) cuando no sabe responder o algo falla.
//
// MODO PRUEBA: todo mensaje va a `telefonoDePrueba`, sea cual sea el destinatario, con el
// prefijo «[a recepción]» o «[al doctor]» cuando corresponde.
const base = cnPrimero('Candado') || cnPrimero('Comercio no operativo') || cnPrimero('Uso extendido') || {};
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const ahora = Number(t.ahoraMs) || Date.now();
const plan = String(base.plan || base.accion || 'nada');
const nombreNegocio = String(cfg.nombreNegocio || 'el negocio');
const rec = String(cfg.numeroRecepcionDigitos || '');
const doc = String(cfg.numeroDoctorDigitos || '');
const desdeDigitos = cnDigitos(t.from);
const msgs = [];
const errores = (base.errores || []).slice();

// ----------------------------------------------------------------- constructores
const cuerpoBase = (tipo) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '', type: tipo });
const mTexto = (cuerpo) => Object.assign(cuerpoBase('text'), { text: { preview_url: true, body: cnRecorte(cuerpo, 4000) } });
const mBotones = (cuerpo, botones) => Object.assign(cuerpoBase('interactive'), { interactive: {
  type: 'button', body: { text: cnRecorte(cuerpo, 1024) },
  action: { buttons: botones.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: cnRecorte(b.title, 20) } })) },
} });
const mLista = (cuerpo, boton, titulo, filas) => Object.assign(cuerpoBase('interactive'), { interactive: {
  type: 'list', body: { text: cnRecorte(cuerpo, 1024) },
  action: { button: cnRecorte(boton, 20), sections: [{ title: cnRecorte(titulo, 24), rows: filas.slice(0, 10).map((f) => ({
    id: f.id, title: cnRecorte(f.title, 24), description: cnRecorte(f.description || '', 72) })) }] },
} });
const mEnlace = (cuerpo, texto, url) => Object.assign(cuerpoBase('interactive'), { interactive: {
  type: 'cta_url', body: { text: cnRecorte(cuerpo, 1024) },
  action: { name: 'cta_url', parameters: { display_text: cnRecorte(texto, 20), url: url } },
} });
const urlWa = (numero, saludo) => 'https://wa.me/' + numero + '?text=' + encodeURIComponent(saludo);
function agregar(para, payload, texto, respaldo, extra) {
  msgs.push(Object.assign({ para: para, payload: payload, texto: texto, respaldo: respaldo || texto }, extra || {}));
}

// Un mensaje AL PACIENTE con el boton que abre el chat de recepcion (o solo texto, si no hay numero).
function mensajeConBoton(numero, cuerpo, botonTexto, saludo, evento) {
  if (numero) {
    const url = urlWa(numero, saludo);
    agregar('paciente', mEnlace(cuerpo, botonTexto, url), cuerpo, cuerpo + '\n\nEscríbele aquí: ' + url, { tipoReporte: 'interactive', evento: evento });
  } else {
    agregar('paciente', mTexto(cuerpo), cuerpo, cuerpo, { tipoReporte: 'text', evento: evento });
  }
}
// PASAR CON RECEPCION = el aviso a recepcion MAS el boton para escribirle. Nada mas se ofrece.
function transferir(motivo, cuerpo) {
  mensajeConBoton(rec, cuerpo, 'Escribir a recepción', 'Hola, escribo desde el asistente de ' + nombreNegocio + '.', 'no_contactar');
  avisarARecepcion(motivo);
}
function avisarARecepcion(motivo) {
  if (!rec || rec === desdeDigitos) return; // un aviso nunca va al propio numero
  const aviso = '🔔 NovuChat (' + nombreNegocio + '): el cliente ' + (t.nombrePerfil || '') + ' (' + String(t.from || '') + ') necesita atención humana. Motivo: '
    + (motivo || 'no especificado') + '. Tomar el chat.';
  agregar('recepcion', mTexto(aviso), aviso, aviso, { tipoReporte: null });
}
const conEmoji = (e) => (cfg.nivelEmojis === 'ninguno' ? '' : e + ' ');

// ------------------------------------------------------- verificar lo que redacto el modelo
const CLINICO = /dosis|\bmg\b|\bml\b|gotas|paracetamol|ibuprofeno|amoxicilina|antibiotic|jarabe|medicamento|pastilla|receta medica|diagnostic|sintoma|tratamiento|remedio/;
const PROMESAS = /lo consulto|lo consultar[eé]|te aviso|te avisar[eé]|te avisamos|te llamamos|te llamar[eé]|te escribir[aá]n|te escribiremos|te contactar[eé]|nos comunicaremos|te confirmo luego|recepcion te|el doctor te/;
const NEGACION = /no (nos )?(quedan?|hay) (mas )?(horarios?|espacios?|turnos?|citas?|disponibilidad)|sin horarios|no tenemos (horarios|espacio|disponibilidad)|agenda (llena|completa)/;
function clavesDeHora(texto) {
  const claves = [];
  const t2 = String(texto);
  let m;
  const a = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
  while ((m = a.exec(t2)) !== null) claves.push((Number(m[1]) % 12) + ':' + m[2]);
  const b = /\ba las? (\d{1,2})(?![:.]\d)\b/gi;
  while ((m = b.exec(t2)) !== null) claves.push((Number(m[1]) % 12) + ':00');
  const c = /\b(\d{1,2})\s*(?:am|pm|a\.m\.|p\.m\.)/gi;
  while ((m = c.exec(t2)) !== null) claves.push((Number(m[1]) % 12) + ':00');
  return claves;
}
function redaccionValida(texto, huecos, aviso) {
  const s = String(texto || '').trim();
  if (!s || s.length > 900 || /^SIN_RESPUESTA/.test(s)) return false;
  const n = cnNorm(s);
  if (/\b168\b/.test(n) || CLINICO.test(n) || PROMESAS.test(n)) return false;
  if (huecos.length && !aviso && NEGACION.test(n)) return false;
  // R13: un hueco («a las )») nunca sale.
  if (/\(\s*\)|\ba las?\s*[).,;:!?]|\ba las?\s*$|\bde\s*\)|«\s*»|\{\{|undefined|null\b/.test(n)) return false;
  const propios = [String(cfg.direccionMaps || ''), String(cfg.instruccionesExtra || ''), String(cfg.mensajeRedes || '')].join(' ');
  const enlaces = s.match(/https?:\/\/\S+/gi) || [];
  if (enlaces.some((e) => propios.indexOf(e.replace(/[).,;:!?]+$/, '')) < 0)) return false;
  if (/\bh\|\d{4}/.test(s)) return false;
  // Ninguna hora que no este entre los huecos (ni entre los horarios del negocio).
  const permitidas = {};
  for (const h of huecos) { const hm = horaLocal(msDe(h.inicio)).split(':'); permitidas[(Number(hm[0]) % 12) + ':' + hm[1]] = true; }
  for (const k of clavesDeHora([String(cfg.horarioAtencion || ''), JSON.stringify(cfg.horario || {}), String(cfg.instruccionesExtra || '')].join(' '))) permitidas[k] = true;
  return clavesDeHora(s).every((k) => permitidas[k] === true);
}
// Pulido de la redaccion, en codigo (prueba real del 30/09 en n8n):
//  - P1: el modelo escribio «Andrés» con acento aunque la configuracion dice «Andres». Toda
//    palabra de `nombreNegocio` que el modelo escriba con otros acentos o mayusculas vuelve
//    a la forma de la configuracion.
//  - El menu ya saludo: la oferta no vuelve a decir «¡Hola! Soy la asistente…». Se quitan
//    las oraciones iniciales de saludo o presentacion.
function pulirRedaccion(texto) {
  let t = String(texto || '').trim();
  for (let i = 0; i < 2; i++) {
    const m = t.match(/^[¡!]?\s*(hola|buen[oa]s? (d[ií]as|tardes|noches)|soy (la|el|tu) asistente)[^.!?\n]*[.!?]+\s*/i);
    if (!m) break;
    t = t.slice(m[0].length).trim();
  }
  const sinTilde = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const palabras = String(cfg.nombreNegocio || '').split(/[^A-Za-zÀ-ÿ]+/).filter((w) => w.length >= 4);
  for (const w of palabras) {
    t = t.replace(/[A-Za-zÀ-ÿ]+/g, (x) => (x !== w && sinTilde(x) === sinTilde(w)) ? w : x);
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
// Los textos fijos, armados con los huecos reales, para cuando la redaccion no sirve.
function textoFijoDeOferta(o, srvTxt) {
  const intro = {
    dia_lleno: o.franjaLlena ? 'Ese día ya no queda espacio en esa franja. Tengo estos horarios:' : 'Ese día ya no queda espacio. Los horarios más cercanos son:',
    dia_cerrado: 'Ese día no atendemos. Los horarios más cercanos son:',
    fecha_pasada: 'Esa fecha ya pasó. Estos son los próximos horarios disponibles:',
    hora_ocupada: 'A esa hora no está disponible. Las más cercanas son:',
    hora_propia: 'Esa hora ya es la de tu cita actual. Estas son otras opciones:',
    hueco_perdido: 'Ese horario ya no está disponible. Estos son los más cercanos:',
    cruce: 'Ese horario se ocupó justo ahora y no pude dejar tu cita. Estos son los más cercanos:',
  }[o.aviso] || ('Estos son los horarios más cercanos para ' + srvTxt + ':');
  return intro + '\n' + o.huecos.map((h) => '• ' + textoDeFecha(h.inicio)).join('\n') + '\n\nToca el horario que prefieras.';
}
function botonesDeHuecos(huecos, servicio) {
  const out = [];
  for (const h of huecos) {
    const id = idDeBoton('h', { inicio: h.inicio, servicio: servicio });
    if (id) out.push({ id: id, title: h.etiqueta || etiquetaDeHueco(h.inicio) });
  }
  return out;
}
function respaldoDeBotones(cuerpo, botones) {
  const lista = botones.map((b) => '• ' + b.title).join('\n');
  return cuerpo + (lista ? '\n\n' + lista : '') + (rec ? '\n\nSi no ves los botones, escríbele directo a recepción: ' + urlWa(rec, 'Hola, escribo desde el asistente de ' + nombreNegocio + '.') : '');
}

// ================================================================== segun el plan
const srv = base.estado && base.estado.servicio ? base.estado.servicio : (base.params && base.params.servicio) || null;
const srvTxt = CN_NOMBRE_SERVICIO[srv] || 'tu consulta';
const params = base.params || {};
let deshacerFallo = false;

function ofertaConBotones(o, cuerpo, servicio) {
  const botones = botonesDeHuecos(o.huecos, servicio);
  if (!botones.length) return false;
  agregar('paciente', mBotones(cuerpo, botones), cuerpo, respaldoDeBotones(cuerpo, botones), { tipoReporte: 'interactive', evento: 'horarios_ofrecidos' });
  return true;
}

switch (plan) {
  case 'nada':
    break;

  case 'suspendido':
    agregar('paciente', mTexto(base.texto), base.texto, base.texto, { tipoReporte: 'text' });
    break;

  case 'uso_extendido':
    if (base.responder) agregar('paciente', mTexto(base.texto), base.texto, base.texto, { tipoReporte: 'text', evento: base.transferir ? 'no_contactar' : undefined });
    if (base.transferir) avisarARecepcion(base.motivo);
    break;

  case 'menu': {
    const cuerpo = String(cfg.mensajeMenu || '').trim() || '¿Qué necesitas hoy?';
    const filas = [
      { id: 'emergencia', title: 'Emergencia', description: 'Te comunico ahora con una persona' },
      { id: 'control_recien_nacido', title: 'Recién nacido', description: 'Control del recién nacido o menor de 2 meses' },
      { id: 'control_nino_sano', title: 'Control niño sano', description: 'Control de crecimiento, desde los 2 meses' },
      { id: 'vacunas_otros', title: 'Vacunas y otros', description: 'Te paso directo con el doctor' },
    ];
    agregar('paciente', mLista(cuerpo, 'Ver opciones', '¿Qué necesitas?', filas), cuerpo,
      cuerpo + '\n\nRespóndeme «emergencia», «recién nacido», «niño sano» o «vacunas».', { tipoReporte: 'interactive' });
    break;
  }

  case 'emergencia': {
    // P3: solo el boton a recepcion y «ya le avise al doctor», con el texto de la configuracion.
    // Sin el 168 y sin consejos. El mensaje al paciente es el mismo salga como salga el aviso.
    let cuerpo = String(cfg.mensajeEmergencia || '').trim();
    if (!cuerpo || /\b168\b/.test(cuerpo)) cuerpo = 'Comunícate AHORA con recepción tocando el botón. Ya le avisé al doctor.';
    mensajeConBoton(rec, cuerpo, 'Escribir a recepción', 'EMERGENCIA: escribo desde el asistente de ' + nombreNegocio + '.');
    if (doc && doc !== desdeDigitos) {
      const escrito = (t.tipo === 'text' ? String(base.texto || t.texto || '') : '').trim().replace(/\s+/g, ' ').slice(0, 300);
      const alerta = '🚨 EMERGENCIA en el asistente\nPaciente: ' + (t.nombrePerfil || 'sin nombre') + ' · +' + String(t.from || '')
        + (escrito ? '\nEscribió: «' + escrito + '»' : '\nTocó el botón de emergencia sin escribir nada.')
        + '\nSe le indicó comunicarse con recepción.';
      // Una variable de plantilla no admite saltos de linea ni mas de cuatro espacios seguidos, y no puede ir vacia.
      const variable = (v, max) => { const s = String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' · ').replace(/\s{2,}/g, ' ').trim(); return (s || 'no indicado').slice(0, max || 200); };
      const plantilla = Object.assign(cuerpoBase('template'), { template: { name: 'alerta_emergencia', language: { code: 'es' }, components: [{ type: 'body', parameters: [
        { type: 'text', text: variable(t.nombrePerfil || 'sin nombre', 60) },
        { type: 'text', text: variable(t.from, 20) },
        { type: 'text', text: variable(escrito || 'tocó el botón de emergencia sin escribir nada') },
      ] }] } });
      agregar('doctor', plantilla, alerta, alerta, { tipoReporte: null });
    }
    break;
  }

  case 'contacto_doctor':
  case 'contacto_recepcion': {
    const aDoctor = plan === 'contacto_doctor';
    const numero = aDoctor ? doc : rec;
    const cuerpo = String(aDoctor ? cfg.mensajeContactoDoctor : cfg.mensajeContactoRecepcion || '').trim()
      || 'Para eso te atiende una persona del consultorio. Tócale el botón y le escribes directo.';
    mensajeConBoton(numero, cuerpo, aDoctor ? 'Escribir al doctor' : 'Escribir a recepción',
      aDoctor ? 'Hola doctor, escribo desde su asistente virtual.' : 'Hola, escribo desde el asistente de ' + nombreNegocio + '.');
    break;
  }

  case 'derivar_medio':
    transferir('el paciente envió un mensaje que este canal no lee (foto, archivo u otro)',
      'Por este chat solo puedo ayudarte a agendar, cancelar o mover citas. Para otra cosa, escríbele directo a recepción tocando el botón.');
    break;

  case 'audio_ilegible': {
    const cuerpo = base.audioMuyLargo
      ? 'Tu nota de voz es muy larga para escucharla entera. ¿Me cuentas lo esencial por escrito o en un audio más corto?'
      : 'No pude escuchar bien tu nota de voz. ¿Me lo puedes escribir?';
    agregar('paciente', mTexto(cuerpo), cuerpo, cuerpo, { tipoReporte: 'text' });
    break;
  }

  case 'pedir_boton': {
    const ult = ((base.estadoPrevio && base.estadoPrevio.ultimaOferta) || []).map((iso) => ({ inicio: iso, etiqueta: etiquetaDeHueco(iso) }));
    const cuerpo = 'Para agendar toca uno de los horarios de abajo; escribir «sí» o «ya» no alcanza. Si ninguno te sirve, dime qué día y a qué hora prefieres.';
    if (!ofertaConBotones({ huecos: ult }, cuerpo, srv || 'control_nino_sano')) {
      agregar('paciente', mTexto(cuerpo), cuerpo, cuerpo, { tipoReporte: 'text' });
    }
    break;
  }

  case 'pedir_nombre': {
    const cuerpo = params.dos
      ? 'Escribe el nombre completo de los dos niños, con sus apellidos.'
      : (params.faltaApellido
        ? 'Necesito el nombre y el apellido para dejar la cita. ¿Cómo se llama el niño o la niña, con sus apellidos?'
        : '¿Cómo se llama el niño o la niña? Escribe nombre y apellidos. Si son dos hermanos, escribe los dos nombres.');
    agregar('paciente', mTexto(cuerpo), cuerpo, cuerpo, { tipoReporte: 'text' });
    break;
  }

  case 'ofrecer':
  case 'responder': {
    const o = base.oferta || { huecos: [], aviso: null, franjaLlena: false };
    const pregunta = params.pregunta || null;
    const redactado = base.redactar ? pulirRedaccion(cnTextoDeGemini(cnPrimero('Redactar'))) : '';
    const valida = redactado !== '' && redaccionValida(redactado, o.huecos, o.aviso);
    if (pregunta && !valida) {
      // La respuesta no esta en la configuracion (o el modelo no dio una que sirva): a una persona.
      transferir('el paciente preguntó algo que el asistente no puede responder: «' + cnRecorte(pregunta, 200) + '»',
        'Esa consulta no la puedo resolver por este chat. Escríbele directo a recepción tocando el botón.');
      break;
    }
    if (plan === 'responder') {
      agregar('paciente', mTexto(redactado), redactado, redactado, { tipoReporte: 'text' });
      break;
    }
    if (o.aviso === 'fuera_de_rango') {
      const dias = Number(cfg.anticipacionMaximaDias) || 60;
      const cuerpo = 'Solo agendamos con hasta ' + dias + ' días de anticipación. ¿Para qué otra fecha te sirve?';
      agregar('paciente', mTexto(cuerpo), cuerpo, cuerpo, { tipoReporte: 'text' });
      break;
    }
    const cuerpo = valida && !(o.aviso && !pregunta) ? redactado : textoFijoDeOferta(o, srvTxt);
    if (!ofertaConBotones(o, cuerpo, srv || (params.servicio) || 'control_nino_sano')) {
      transferir('no se pudo armar una oferta de horarios', 'No encuentro horarios para ofrecerte por este chat. Escríbele directo a recepción tocando el botón.');
    }
    break;
  }

  case 'cruce': {
    // El candado deshizo la cita propia: se dice y se ofrece de nuevo con lo que se ve ahora.
    const o = base.oferta || { huecos: [] };
    o.aviso = 'cruce';
    if (!o.huecos.length || !ofertaConBotones(o, textoFijoDeOferta(o, srvTxt), srv || 'control_nino_sano')) {
      transferir('la cita se cruzó con otra y se deshizo; no se pudo volver a ofrecer',
        'Ese horario se ocupó justo ahora y no pude dejar tu cita. Escríbele directo a recepción tocando el botón.');
    }
    break;
  }

  case 'listar': {
    const modo = params.modo === 'm' ? 'm' : 'c';
    const verbo = modo === 'm' ? 'Mover' : 'Cancelar';
    const filas = (base.citas || []).map((c) => ({ c: c, id: idDeBoton(modo, { id: c.id }) })).filter((x) => x.id);
    if (!filas.length) { transferir('no se pudo listar sus citas', 'No pude mostrarte tus citas. Escríbele directo a recepción tocando el botón.'); break; }
    const detalle = filas.map((x) => '• ' + textoDeFecha(x.c.inicio)).join('\n');
    const cuerpo = (modo === 'm' ? '¿Cuál de tus citas quieres mover?' : (filas.length === 1 ? 'Esta es tu cita. Para cancelarla, toca el botón:' : '¿Cuál de tus citas quieres cancelar?'))
      + '\n' + detalle;
    if (filas.length <= 3) {
      const botones = filas.map((x) => ({ id: x.id, title: verbo + ' ' + x.c.etiqueta }));
      agregar('paciente', mBotones(cuerpo, botones), cuerpo, respaldoDeBotones(cuerpo, botones), { tipoReporte: 'interactive' });
    } else {
      const lista = filas.map((x) => ({ id: x.id, title: verbo + ' ' + x.c.etiqueta, description: x.c.titulo }));
      agregar('paciente', mLista(cuerpo, 'Ver mis citas', 'Tus citas', lista), cuerpo, cuerpo, { tipoReporte: 'interactive' });
    }
    break;
  }

  case 'sin_citas':
    transferir(params.motivo || 'no encontró sus citas',
      'No encuentro ninguna cita registrada con este número de WhatsApp. Si crees que es un error, escríbele directo a recepción tocando el botón.');
    break;

  case 'cancelar': {
    const b = cnPrimero('Borrar evento');
    if (!b || b.error) {
      errores.push('no se pudo borrar la cita del calendario');
      transferir('no se pudo cancelar la cita en el calendario', 'No pude cancelar tu cita. Escríbele directo a recepción tocando el botón.');
      break;
    }
    const c = base.cancelada || {};
    const cuerpo = conEmoji('✅') + 'Listo, cancelé tu cita del ' + textoDeFecha(c.inicio) + '.';
    agregar('paciente', mTexto(cuerpo), cuerpo, cuerpo, { tipoReporte: 'text' });
    break;
  }

  case 'crear': {
    if (!base.creada) { // no deberia pasar: `Candado` cambia el plan si no se creo
      transferir('no se pudo crear la cita', String(cfg.mensajeErrorTemporal || '') + ' Si prefieres, escríbele directo a recepción.');
      break;
    }
    const c = base.crear;
    const nombres = c.titulo.replace(/\s*\((?:CNS|RN)\)\s*$/, '');
    const partes = [
      conEmoji('✅') + 'Listo, quedó agendada la cita de ' + nombres + ' (' + (CN_NOMBRE_SERVICIO[c.servicio] || 'consulta') + '): ' + textoDeFecha(c.inicio) + '.',
      cfg.direccion ? 'Te esperamos en ' + cfg.direccion + (cfg.direccionMaps ? ' · ' + cfg.direccionMaps : '') + '.' : '',
      // P10: la tolerancia va dentro del mismo mensaje y sale de la configuracion; sin frase, no se agrega.
      String(cfg.toleranciaTexto || ''),
      String(cfg.mensajeCierre || ''),
      String(cfg.mensajeRedes || ''),
    ].filter(Boolean);
    let cuerpo = partes.join('\n\n');
    const b = cnPrimero('Borrar evento');
    if (base.borrarId && (!b || b.error)) {
      // Reagendo, la nueva quedo, pero la anterior no se pudo borrar: se dice y pasa a recepcion.
      errores.push('no se pudo borrar la cita anterior al reagendar');
      cuerpo += '\n\nNo pude cancelar tu cita anterior: escríbele directo a recepción para que la anulen.';
      mensajeConBoton(rec, cnRecorte(cuerpo, 1024), 'Escribir a recepción', 'Hola, escribo desde el asistente de ' + nombreNegocio + '.', 'no_contactar');
      avisarARecepcion('reagendó y no se pudo borrar la cita anterior: quedan dos citas de este paciente');
    } else {
      agregar('paciente', mTexto(cuerpo), cuerpo, cuerpo, { tipoReporte: 'text' });
    }
    break;
  }

  case 'transferir':
    transferir(params.motivo || 'consulta sin respuesta',
      'Esa consulta no la puedo resolver por este chat. Escríbele directo a recepción tocando el botón.');
    break;

  case 'error':
  default: {
    const motivo = params.motivo || errores.join('; ') || 'error del flujo';
    const cuerpo = String(cfg.mensajeErrorTemporal || '').trim() + ' Si prefieres, escríbele directo a recepción.';
    transferir(motivo, cuerpo);
  }
}

// La cita cruzada no se pudo deshacer: dos eventos quedaron en el calendario.
if (base.deshacerId) {
  const d = cnPrimero('Deshacer cita');
  if (!d || d.error) {
    deshacerFallo = true;
    errores.push('no se pudo deshacer la cita cruzada');
    avisarARecepcion('la cita cruzada no se pudo borrar del calendario (evento ' + base.deshacerId + '): revisar la agenda de ese horario');
  }
}

// ====================================================== destinatarios, modo prueba, ids
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const PREFIJO = { recepcion: '[a recepción] ', doctor: '[al doctor] ' };
const salida = [];
for (const m of msgs) {
  let numero = m.para === 'paciente' ? String(t.from || '') : (m.para === 'recepcion' ? rec : doc);
  if (prueba) numero = telPrueba;
  if (!numero && !prueba) continue;
  const pre = prueba ? (PREFIJO[m.para] || '') : '';
  const p = m.payload;
  p.to = numero;
  let texto = pre + m.texto;
  let respaldo = pre + m.respaldo;
  if (pre) {
    if (p.type === 'text') p.text.body = pre + p.text.body;
    else if (p.type === 'interactive') p.interactive.body.text = cnRecorte(pre + p.interactive.body.text, 1024);
    else if (p.type === 'template') p.template.components[0].parameters[0].text = cnRecorte(pre + p.template.components[0].parameters[0].text, 200);
  }
  salida.push({ json: {
    para: numero, destino: m.para, payload: p, texto: texto, respaldo: respaldo,
    tipoReporte: m.tipoReporte || null, evento: m.evento,
    reportar: !prueba && m.para === 'paciente' && !!m.tipoReporte,
    phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0',
    from: t.from, sinMensajes: false,
  } });
}

// ============================================ EL ESTADO: un solo lugar, al final del turno
const estado = base.estado && typeof base.estado === 'object' ? base.estado : null;
let estadoDespues = null;
if (estado && cnClaveValida(t.from) && plan !== 'nada') {
  const e = Object.assign(cnEstadoBase(), estado, { ultimoMensajeMs: ahora });
  e.pacientes = (e.pacientes || []).slice(0, 2).map((n) => String(n).slice(0, 80));
  e.ultimaOferta = (e.ultimaOferta || []).slice(0, 10);
  e.primerTexto = String(e.primerTexto || '').slice(0, 300);
  e.moverTitulo = String(e.moverTitulo || '').slice(0, 120);
  estadoDespues = e;
  let sd = null;
  try { sd = $getWorkflowStaticData('global'); } catch (err) { sd = null; }
  if (sd) {
    if (!sd.agendaMinima || typeof sd.agendaMinima !== 'object') sd.agendaMinima = {};
    for (const k of Object.keys(sd.agendaMinima)) {
      const v = sd.agendaMinima[k];
      if (!v || !(ahora - Number(v.ultimoMensajeMs || 0) < CN_VENCE_MS)) delete sd.agendaMinima[k];
    }
    sd.agendaMinima[String(t.from)] = e;
  }
}

if (!salida.length) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: t.from,
    plan: plan, estadoDespues: estadoDespues, errores: errores, huecosOfrecidos: [], eventoCreadoId: '', eventoBorradoId: '' } }];
}
const oferta = base.oferta && Array.isArray(base.oferta.huecos) ? base.oferta.huecos : [];
const borradoOk = (() => { const b = cnPrimero('Borrar evento'); return !!base.borrarId && !!b && !b.error; })();
const resumen = {
  plan: plan, estadoDespues: estadoDespues, errores: errores,
  huecosOfrecidos: (plan === 'ofrecer' || plan === 'cruce' || plan === 'pedir_boton') ? oferta.map((h) => h.inicio) : [],
  eventoCreadoId: base.creada ? String(base.eventoCreadoId || '') : '',
  eventoBorradoId: borradoOk ? String(base.borrarId) : (base.deshacerId && !deshacerFallo ? String(base.deshacerId) : ''),
};
salida[0].json.resumen = resumen;
return salida;
