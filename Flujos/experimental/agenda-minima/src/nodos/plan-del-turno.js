// PLAN DEL TURNO: con lo que dijo el modelo (si hubo extraccion) se decide QUE hacer y
// QUE leer del calendario. El modelo solo ENTENDIO el mensaje: aca todo es validado
// con codigo, y un campo raro del modelo se descarta, no se obedece.
//
// Tipos de plan (`plan`): nada, menu, emergencia, contacto_doctor, contacto_recepcion,
// derivar_medio, audio_ilegible, imagen_sin_texto, respuesta_fija (params.clave, params.conMenu), pedir_boton, pedir_nombre, transferir, error, responder,
// ofrecer, elegir_hueco, crear (con nombre), listar (cancelar o mover), cancelar,
// mover_elegido.
const d = cnPrimero('Decidir turno') || {};
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const ahora = Number(t.ahoraMs) || Date.now();
const est = Object.assign(cnEstadoBase(), d.estadoPrevio || {});
const en = Object.assign(cnEstadoBase(), d.estado || {});
const texto = String(d.texto || '');

const salir = (plan, extra) => {
  const cuerpo = Object.assign({}, d);
  delete cuerpo.cuerpoExtraccion;
  return [{ json: Object.assign(cuerpo, { plan: plan, leer: null, params: {}, estado: en, errores: [] }, extra || {}) }];
};
const leer14 = (fecha) => rangoALeer({ ahoraMs: ahora, fechaPreferida: fecha || null, dias: 14 });
// Las citas del telefono: desde hoy hasta la anticipacion maxima (90 dias como minimo), no el rango de una oferta.
const leer90 = () => rangoALeer({ ahoraMs: ahora, dias: Math.max(90, (Number(cfg.anticipacionMaximaDias) || 0) + 1) });
// HB4: los rechazos seguidos de ofertas se cuentan en el estado; cualquier turno que no sea un rechazo
// (una eleccion, un cambio de tema) los reinicia. Un «si» suelto que pide tocar el boton no los toca.
const rechazosPrevios = est.paso === 'ofreciendo_huecos' ? (Number(est.rechazos) || 0) : 0;
en.rechazos = 0;
const fechaDe = (iso) => fechaLocal(msDe(iso));

// Lo que sale del modelo, validado campo por campo.
function extraccionValida(o) {
  if (!o || typeof o !== 'object') return null;
  const en_ = (v, lista, defecto) => (lista.indexOf(v) >= 0 ? v : defecto);
  const intencion = en_(o.intencion, ['agendar', 'cancelar', 'mover', 'consultar', 'otro'], null);
  if (!intencion) return null;
  const fecha = typeof o.fechaPreferida === 'string' && diaDeLaSemana(o.fechaPreferida.trim()) ? o.fechaPreferida.trim() : null;
  const hm = typeof o.horaPreferida === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(o.horaPreferida.trim()) : null;
  const hora = hm && Number(hm[1]) < 24 && Number(hm[2]) < 60 ? (hm[1].length === 1 ? '0' : '') + hm[1] + ':' + hm[2] : null;
  const nombres = [];
  const agregar = (v) => { if (typeof v === 'string' && v.trim() && nombres.length < 2 && v.trim().length <= 80) nombres.push(v.trim()); };
  if (Array.isArray(o.pacientes)) o.pacientes.forEach(agregar);
  if (!nombres.length) agregar(o.nombrePaciente);
  return {
    intencion: intencion,
    servicio: en_(o.servicio, ['control_recien_nacido', 'control_nino_sano', 'vacunas_otros', 'desconocido'], 'desconocido'),
    fechaPreferida: fecha,
    horaPreferida: hora,
    franja: en_(o.franja, ['manana', 'tarde', 'cualquiera'], 'cualquiera'),
    pidioHoy: o.pidioHoy === true,
    masOpciones: o.masOpciones === true,
    hermanos: o.hermanos === true,
    pacientes: nombres,
    pregunta: typeof o.pregunta === 'string' && o.pregunta.trim() ? o.pregunta.trim().slice(0, 300) : null,
  };
}
const esClinica = (p) => /dosis|\bmg\b|\bml\b|gotas|paracetamol|ibuprofeno|amoxicilina|antibiotic|jarabe|medicamento|medicina|pastilla|receta|diagnostic|que le doy|cuanto le doy|le puedo dar|es grave|es normal|que tiene mi|sintoma|infeccion|tratamiento|remedio/.test(cnNorm(p));

// Los nombres a objetos {apellidos, nombres}; los que no traen apellido no sirven para el titulo.
function nombresValidos(lista) {
  const out = [];
  let sinApellido = false;
  for (const n of lista) {
    const p = partirNombre(String(n));
    if (p && p.apellidos && p.nombres) out.push(String(n).trim());
    else if (p) sinApellido = true;
  }
  return { validos: out, sinApellido: sinApellido };
}

const accion = d.accion;

// --- Planes que no necesitan modelo ni calendario ---------------------------------------
if (['nada', 'menu', 'emergencia', 'contacto_doctor', 'contacto_recepcion', 'derivar_medio', 'audio_ilegible', 'imagen_sin_texto', 'respuesta_fija'].indexOf(accion) >= 0) {
  if (accion !== 'nada' && est.paso === 'inicio') en.paso = 'menu';
  // Una pregunta sencilla contestada por codigo: `clave` dice cual y `conMenu` si es el primer mensaje de la
  // conversacion (la respuesta va en el cuerpo del menu) o si el menu ya paso (va sola). Los textos los pone
  // `Armar mensajes` con la configuracion; aca no hay ninguno. Una clave desconocida no se inventa: menu.
  if (accion === 'respuesta_fija') {
    if (['servicios', 'direccion', 'horario', 'costo'].indexOf(d.claveFija) < 0) return salir('menu');
    return salir('respuesta_fija', { params: { clave: d.claveFija, conMenu: est.paso === 'inicio' } });
  }
  return salir(accion);
}
if (accion === 'pedir_boton') { en.rechazos = rechazosPrevios; return salir('pedir_boton'); }

// --- Botones -----------------------------------------------------------------------------
// Un hueco elegido (tocando el boton o escribiendo su hora): el MISMO camino. Se revalida en
// `Resolver con agenda`, con el candado antes y despues de crear.
function comoBoton(inicio, servicio, nombreEscrito) {
  const srv = CN_SERVICIOS.indexOf(servicio) >= 0 ? servicio : null;
  if (!srv) return salir('menu');
  en.servicio = srv;
  if (nombreEscrito) {
    const pn = partirNombre(String(nombreEscrito));
    if (pn && pn.apellidos && pn.nombres) { en.pacientes = [String(nombreEscrito).trim()]; en.hermanos = false; }
  }
  const nombres = nombresValidos(en.pacientes || []);
  en.huecoElegido = inicio;
  return salir('elegir_hueco', {
    leer: leer14(fechaDe(inicio)),
    params: { inicio: inicio, servicio: srv, nombresListos: nombres.validos.length > 0 },
  });
}
if (accion === 'elegir_hueco') return comoBoton(d.boton.inicio, d.boton.servicio, d.nombreEscrito);
if (accion === 'cancelar_boton') return salir('cancelar', { leer: leer90(), params: { id: d.boton.id } });
if (accion === 'mover_boton') return salir('mover_elegido', { leer: leer90(), params: { id: d.boton.id } });

// --- El servicio recien elegido en el menu: se ofrece de una (sin preguntar el dia) -------
if (accion === 'ofrecer') {
  en.paso = 'ofreciendo_huecos';
  return salir('ofrecer', { leer: leer14(null), params: { servicio: en.servicio, franja: 'cualquiera' } });
}

// --- Extraccion: lo que dijo el modelo ------------------------------------------------
let x = null;
if (accion === 'extraer') {
  x = extraccionValida(cnJsonDeGemini(cnPrimero('Extraer')));
  if (!x && est.paso === 'esperando_nombre') {
    // El modelo fallo pero estamos esperando un nombre: se intenta con el codigo.
    const p = partirNombre(String(d.textoExtraer || texto));
    if (p) x = { intencion: 'agendar', servicio: 'desconocido', fechaPreferida: null, horaPreferida: null, franja: 'cualquiera',
      pidioHoy: false, masOpciones: false, hermanos: false, pacientes: [String(d.textoExtraer || texto).trim()], pregunta: null };
  }
}
if (!x && d.intencionForzada) {
  // El codigo ya sabe que quiere cancelar o mover: no depende de que el modelo responda.
  x = { intencion: d.intencionForzada, servicio: 'desconocido', fechaPreferida: null, horaPreferida: null, franja: 'cualquiera',
    pidioHoy: false, masOpciones: false, hermanos: false, pacientes: [], pregunta: null };
}
if (!x) {
  return salir('error', { errores: ['no se pudo interpretar el mensaje (modelo)'], params: { motivo: 'error del modelo al interpretar el mensaje' } });
}

// EL SERVICIO LO ELIGE EL MENU (o un boton), no el modelo: el modelo solo lo propone cuando no hay
// uno, y el texto lo cambia solo si nombra el servicio con todas sus letras.
const srvDelTexto = (() => {
  const n = cnNorm(texto);
  if (/recien nacido|neonat|bebe de dias/.test(n)) return 'control_recien_nacido';
  if (/nino sano|control de crecimiento|control del nino/.test(n)) return 'control_nino_sano';
  return null;
})();
const srv = srvDelTexto || en.servicio || (CN_SERVICIOS.indexOf(x.servicio) >= 0 ? x.servicio : null);
// HB3: una peticion de cancelar o mover gana sobre la oferta pendiente, diga lo que diga el modelo.
if (d.intencionForzada && x.intencion !== 'cancelar' && x.intencion !== 'mover') {
  x.intencion = d.intencionForzada;
  if (x.servicio === 'vacunas_otros') x.servicio = 'desconocido';
  x.pregunta = null;
}
if (x.servicio === 'vacunas_otros') { en.paso = est.paso === 'inicio' ? 'menu' : est.paso; return salir('contacto_doctor'); }

// Una pregunta de salud no se contesta: a una persona.
if (x.pregunta && esClinica(x.pregunta)) {
  return salir('transferir', { params: { motivo: 'consulta sobre salud (no se responde por el asistente)' } });
}

if (x.intencion === 'cancelar') { en.paso = 'cancelando'; return salir('listar', { leer: leer90(), params: { modo: 'c' } }); }
if (x.intencion === 'mover') { en.paso = 'moviendo'; return salir('listar', { leer: leer90(), params: { modo: 'm' } }); }

// Si dio nombres, se guardan (se validan al crear).
if (x.pacientes.length) {
  en.pacientes = x.pacientes.slice(0, 2);
  if (x.hermanos || x.pacientes.length > 1) en.hermanos = true;
}

// --- La FECHA que el paciente ESCRIBIÓ, leída por código (revisión de seguridad sobre c17552a) ----------
// El modelo toma la fecha solo de su tabla de 14 días: «el 30 de octubre» le da null, y entonces la hora se
// cruzaba con la oferta del jueves. Formas: ISO, «30 de octubre», «30/10», «el 30», un día de la semana (con o
// sin número), «hoy», «mañana», «pasado mañana». `dicho` dice si el texto nombra un día; `fecha` es la fecha
// concreta, o null si nombra un día que no se puede fijar («la próxima semana»).
function fechaEscrita(textoLibre) {
  const nf = cnNorm(String(textoLibre || '').slice(0, 300));
  const sinM = nf.replace(/\b(de|en|por|a) la manana\b/g, ' ');
  const hoyF = fechaLocal(ahora);
  const anio = Number(hoyF.slice(0, 4));
  const valida = (a, m, d) => { const f = a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); return m >= 1 && m <= 12 && d >= 1 && d <= 31 && sumarDias(f, 0) === f ? f : null; };
  const conAnio = (m, d) => { const f = valida(anio, m, d); return f && f < hoyF ? valida(anio + 1, m, d) : f; };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  let m;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(nf))) return { dicho: true, precisa: true, fecha: valida(Number(m[1]), Number(m[2]), Number(m[3])) };
  if ((m = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.exec(nf))) {
    return { dicho: true, precisa: true, fecha: conAnio(m[2] === 'setiembre' ? 9 : MESES.indexOf(m[2]) + 1, Number(m[1])) };
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/.exec(nf))) return { dicho: true, precisa: true, fecha: conAnio(Number(m[2]), Number(m[1])) };
  const sem = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+(\d{1,2})(?![\d:.]))?/.exec(nf);
  const elN = /\bel\s+(\d{1,2})(?![\d:.])(?!\s*(?:hs|horas|h)\b)/.exec(nf);
  const num = sem && sem[2] ? Number(sem[2]) : (elN ? Number(elN[1]) : null);
  if (num !== null) {
    // El próximo día con ese número (este mes o el siguiente); si además dijo el día de la semana, tiene que coincidir.
    for (let i = 0; i <= 62; i++) {
      const f = sumarDias(hoyF, i);
      if (Number(f.slice(8, 10)) !== num) continue;
      if (sem && cnNorm(diaDeLaSemana(f)) !== sem[1]) return { dicho: true, fecha: null };
      return { dicho: true, precisa: true, fecha: f };
    }
    return { dicho: true, fecha: null };
  }
  if (sem) { for (let i = 0; i < 7; i++) { const f = sumarDias(hoyF, i); if (cnNorm(diaDeLaSemana(f)) === sem[1]) return { dicho: true, fecha: f }; } }
  if (/\bpasado manana\b/.test(sinM)) return { dicho: true, fecha: sumarDias(hoyF, 2) };
  if (/\bmanana\b/.test(sinM)) return { dicho: true, fecha: sumarDias(hoyF, 1) };
  if (/\bhoy\b/.test(nf)) return { dicho: true, fecha: hoyF };
  // Un mes SUELTO no es un día: «Abril», «Mayo», «Junio» son nombres frecuentes. El mes cuenta solo con número
  // delante («2 de abril»), que ya se leyó arriba.
  if (/\b(semana|proxim[oa])\b/.test(nf)) return { dicho: true, fecha: null };
  return { dicho: false, fecha: null };
}
const escrita = fechaEscrita(texto);

// --- HB2 (con el modelo): la hora que dio coincide con UNA de las ofrecidas = tocar ese boton -------
// El codigo ya probo las frases simples sin el modelo (`Decidir turno`); esto cubre las que solo el
// modelo entiende («a las cuatro y media»). Una hora ofrecida en dos dias es ambigua; sin coincidencia,
// recien ahi se vuelve a ofrecer. Con una negacion o una peticion de mas opciones no se elige nada.
if (est.paso === 'ofreciendo_huecos' && (est.ultimaOferta || []).length > 0 && x.horaPreferida && !x.masOpciones && !x.pregunta
  && (x.intencion === 'agendar' || x.intencion === 'otro')
  && !/\b(no|nada|ni|ninguno|ninguna|tampoco|otra|otro|otras|otros|cambi\w*|despues|antes|pero|aunque)\b/.test(cnNorm(texto))
  // Una PREGUNTA por una hora ofrecida no es elegirla (ni agenda, ni mueve la cita): se contesta con la disponibilidad.
  && !/[?¿]/.test(texto) && !/\b(tien|hay|habr|se puede|puedo|podr|queda|libre|disponible)/.test(cnNorm(texto))) {
  // Si el TEXTO nombra un día, la hora ofrecida tiene que ser de ESE día (aunque el modelo no dé fecha).
  const coinciden = est.ultimaOferta.filter((iso) => horaLocal(msDe(iso)) === x.horaPreferida && (!x.fechaPreferida || fechaDe(iso) === x.fechaPreferida)
    && (!escrita.dicho || (escrita.fecha !== null && fechaDe(iso) === escrita.fecha)));
  if (coinciden.length === 1) return comoBoton(coinciden[0], srv || est.servicio, '');
  if (coinciden.length > 1) { en.rechazos = rechazosPrevios; return salir('pedir_boton'); }
}

// --- Esperando el nombre del nino ------------------------------------------------------
if (est.paso === 'esperando_nombre' && est.huecoElegido) {
  const nv = nombresValidos(x.pacientes);
  const hermanos = x.hermanos === true || nv.validos.length > 1;
  if (nv.validos.length) {
    if (hermanos && nv.validos.length < 2 && !est.pidioSegundoNombre) {
      en.pidioSegundoNombre = true;
      en.pacientes = nv.validos;
      en.hermanos = true;
      return salir('pedir_nombre', { params: { dos: true } });
    }
    en.pacientes = nv.validos.slice(0, 2);
    en.hermanos = nv.validos.length > 1;
    en.servicio = srv || en.servicio;
    return salir('crear', {
      leer: leer14(fechaDe(est.huecoElegido)),
      params: { inicio: est.huecoElegido, servicio: en.servicio },
    });
  }
  const pidioOtro = x.fechaPreferida || x.horaPreferida || x.franja !== 'cualquiera' || x.masOpciones;
  if (!pidioOtro) return salir('pedir_nombre', { params: { faltaApellido: nv.sinApellido } });
  // Cambio de idea mientras se esperaba el nombre: se ofrece de nuevo con lo que pidio.
  en.huecoElegido = null;
}

// --- Consulta que no es de agenda ----------------------------------------------------------
if ((x.intencion === 'consultar' || x.intencion === 'otro') && x.pregunta) {
  return salir('responder', { params: { pregunta: x.pregunta } });
}
if (!srv) return salir('menu');

// --- HB4: tres rechazos seguidos de ofertas pasan con recepcion -------------------------------
// Un rechazo es decir que ninguna sirve (la frase la marca el codigo; el modelo lo confirma con
// `masOpciones`) sin traer una preferencia nueva. Una eleccion o un cambio de tema reinicia la cuenta.
const pidioAlgoNuevo = x.fechaPreferida || x.horaPreferida || x.franja !== 'cualquiera' || x.pidioHoy;
if (est.paso === 'ofreciendo_huecos' && (est.ultimaOferta || []).length > 0 && !pidioAlgoNuevo && (d.rechazo === true || x.masOpciones)) {
  en.rechazos = rechazosPrevios + 1;
  if (en.rechazos >= 3) {
    en.rechazos = 0; en.paso = 'menu'; en.huecoElegido = null; en.ultimaOferta = [];
    return salir('transferir', { params: { motivo: 'el paciente rechazó tres ofertas seguidas de horarios', rechazos: true } });
  }
}

// --- El dia de una hora suelta --------------------------------------------------------------------
// «¿y a las 4?» es SOLO una hora: no dice el dia, asi que es el de la ULTIMA OFERTA (o, sin oferta, la
// ultima fecha pedida). Solo cambia de dia si el paciente lo dice con palabras; aunque el modelo devuelva una
// fecha, sin un dia en el texto no se le cree (era el jueves 1 cuando se hablaba del viernes 2).
const ofertaPrevia = est.paso === 'ofreciendo_huecos' ? (est.ultimaOferta || []) : [];
const diaHeredado = ofertaPrevia.length ? fechaDe(ofertaPrevia[0]) : (est.paso === 'ofreciendo_huecos' && est.ultimaFechaPedida ? est.ultimaFechaPedida : null);
const sinFranjaManana = cnNorm(texto).replace(/\b(de|en|por|a) la manana\b/g, ' ');
const dijoDia = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana|pasado manana|semana|proxim[oa])\b|\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b|\bel \d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/.test(sinFranjaManana);
// Una fecha CONCRETA escrita por el paciente manda sobre la del modelo (el modelo la deja en null fuera de su tabla).
// La numérica («el 30 de octubre», «30/10», «el 30») siempre; un día de la semana, «hoy» o «mañana», solo si el
// modelo no dio fecha (para «el jueves» dicho un jueves decide el modelo, como antes).
let fechaPref = (escrita.precisa && escrita.fecha) ? escrita.fecha : (x.fechaPreferida || escrita.fecha);
if (diaHeredado && diaHeredado >= fechaLocal(ahora) && (x.horaPreferida || x.franja !== 'cualquiera') && !x.masOpciones && !x.pidioHoy && !dijoDia) {
  fechaPref = diaHeredado;
}
// Se guarda la fecha que REALMENTE se usó (la del modelo puede haberse descartado por no estar en el texto).
if (fechaPref) en.ultimaFechaPedida = fechaPref;

// --- Oferta de huecos ----------------------------------------------------------------------
en.servicio = srv;
en.paso = 'ofreciendo_huecos';
const sinPreferencias = !fechaPref && !x.horaPreferida && x.franja === 'cualquiera' && !x.pidioHoy;
const excluir = est.paso === 'ofreciendo_huecos' && (x.masOpciones || sinPreferencias) ? (est.ultimaOferta || []) : [];
return salir('ofrecer', {
  leer: leer14(fechaPref),
  params: {
    servicio: srv, fechaPreferida: fechaPref, horaPreferida: x.horaPreferida, franja: x.franja,
    pidioHoy: x.pidioHoy, pregunta: x.pregunta, excluir: excluir,
  },
});
