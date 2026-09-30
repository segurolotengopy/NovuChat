// PLAN DEL TURNO: con lo que dijo el modelo (si hubo extraccion) se decide QUE hacer y
// QUE leer del calendario. El modelo solo ENTENDIO el mensaje: aca todo es validado
// con codigo, y un campo raro del modelo se descarta, no se obedece.
//
// Tipos de plan (`plan`): nada, menu, emergencia, contacto_doctor, contacto_recepcion,
// derivar_medio, audio_ilegible, pedir_boton, pedir_nombre, transferir, error, responder,
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
const leer90 = () => rangoALeer({ ahoraMs: ahora, dias: 90 });
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
if (['nada', 'menu', 'emergencia', 'contacto_doctor', 'contacto_recepcion', 'derivar_medio', 'audio_ilegible'].indexOf(accion) >= 0) {
  if (accion !== 'nada' && est.paso === 'inicio') en.paso = 'menu';
  return salir(accion);
}
if (accion === 'pedir_boton') return salir('pedir_boton');

// --- Botones -----------------------------------------------------------------------------
if (accion === 'elegir_hueco') {
  const b = d.boton;
  const srv = CN_SERVICIOS.indexOf(b.servicio) >= 0 ? b.servicio : null;
  if (!srv) return salir('menu');
  en.servicio = srv;
  const nombres = nombresValidos(est.pacientes || []);
  en.huecoElegido = b.inicio;
  return salir('elegir_hueco', {
    leer: leer14(fechaDe(b.inicio)),
    params: { inicio: b.inicio, servicio: srv, nombresListos: nombres.validos.length > 0 },
  });
}
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

// --- Oferta de huecos ----------------------------------------------------------------------
en.servicio = srv;
en.paso = 'ofreciendo_huecos';
const sinPreferencias = !x.fechaPreferida && !x.horaPreferida && x.franja === 'cualquiera' && !x.pidioHoy;
const excluir = est.paso === 'ofreciendo_huecos' && (x.masOpciones || sinPreferencias) ? (est.ultimaOferta || []) : [];
return salir('ofrecer', {
  leer: leer14(x.fechaPreferida),
  params: {
    servicio: srv, fechaPreferida: x.fechaPreferida, horaPreferida: x.horaPreferida, franja: x.franja,
    pidioHoy: x.pidioHoy, pregunta: x.pregunta, excluir: excluir,
  },
});
