// CONFIG DEL NEGOCIO: lo configurable del negocio, en UN solo nodo.
//
// LA CONSOLA MANDA, PERO NUNCA DEJA AL PACIENTE SIN RESPUESTA (mismo contrato que el
// nodo del flujo de Bellido). `Traer configuración` devuelve la respuesta completa
// (codigo y cuerpo, `neverError`) y aca se decide con el codigo:
//   200 + tenantId -> configuracion del panel; sus valores PISAN al respaldo;
//   409            -> SUSPENDIDO: respuesta valida, no un error;
//   otra           -> no se pudo saber -> respaldo local (SIN datos reales) y
//                     `panelSinRespuesta: true`. El respaldo tiene calendario vacio:
//                     el flujo nunca agenda en un calendario que nadie eligio.
//
// EL CALENDARIO SALE DE UN SOLO LUGAR. `calendarioId` es lo que usan TODOS los nodos
// de calendario, y se resuelve asi: `calendarioForzado` de «Config base» (vacio en el
// JSON versionado), y si no, en modo prueba el `calendarioDePrueba`, y si no, el del
// panel. En modo prueba, sin `calendarioDePrueba` queda VACIO: nunca se cae al real.
//
// LO QUE ESTE NODO TAMBIEN DECIDE DEL MODO PRUEBA. `Carga de entrada` ya dijo si
// «Entrada de prueba» activo el modo; aca se resuelve calendario y destinatario.

const RESPALDO = {
  nombreNegocio: 'Consultorio de ejemplo',
  descripcion: '',
  direccion: '',
  direccionMaps: '',
  politicaCancelacion: '',
  instruccionesExtra: '',
  mensajeMenu: '¡Hola! Soy la asistente virtual del consultorio. Elige la opción que necesitas:',
  mensajeCierre: 'Gracias por escribirnos. Si necesitas algo más, escríbeme por acá.',
  mensajeErrorTemporal: 'Disculpa, tuve un problema técnico momentáneo. ¿Me repites lo último?',
  mensajeComercioSuspendido: 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.',
  mensajeContactoRecepcion: 'Eso lo coordina recepción. Tócale el botón y le escribes directo.',
  mensajeContactoDoctor: 'Eso lo coordina directamente el doctor. Tócale el botón y le escribes directo.',
  mensajeEmergencia: 'Comunícate AHORA con recepción tocando el botón. Ya le avisé al doctor.',
  mensajeRedes: '',
  reglasAgenda: '',
  numeroDoctor: '',
  numeroRecepcion: '',
  calendarioId: '',
  horarioAtencion: '',
  tratamiento: 'Tutea siempre a quien escribe (tú, te, ti). Nunca uses "usted" y nunca vosees.',
  estiloEmojis: 'Usa POCOS emojis: como mucho uno por mensaje, y solo cuando aporte.',
  nivelEmojis: 'pocos',
  prefijosPermitidos: '591',
  // Palabras que llevan a una persona sin pasar por el modelo. `Emergencia` va a
  // recepcion y avisa al doctor; `Doctor` (vacunas, cremas, consultas virtuales) va
  // al doctor; `Recepcion` esta vacia (P5 del 23/09: vacunas y cremas NO van a recepcion).
  palabrasClaveEmergencia: 'emergencia|urgencia|urgente|no respira|convulsion|convulsión|convulsiona|se ahoga|inconsciente|desmayo|se desmayó',
  palabrasClaveDoctor: 'vacuna|vacunas|vacunar|vacunacion|vacunación|crema|cremas|consulta virtual|consultas virtuales|virtual|virtuales|videollamada|video llamada|en linea|en línea|online|a distancia',
  palabrasClaveRecepcion: '',
  datosQueNoTenemos: '',
  estadoComercio: 'operativo',
  // Horario FICTICIO del respaldo. Sin calendario no se ofrece nada de todos modos.
  horario: { lun: '09:00-17:00', mar: '09:00-17:00', mie: '09:00-17:00', jue: '09:00-17:00', vie: '09:00-17:00', sab: '09:00-12:00', dom: 'cerrado' },
  duracionPorDefectoMin: 30,
  anticipacionMinimaMin: 120,
  anticipacionMaximaDias: 60,
  waGraphVersion: 'v26.0',
};

const carga = cnPrimero('Carga de entrada') || {};
const base = cnPrimero('Config base') || {};
const primero = $input.first();
const resp = (primero && primero.json) || {};
const codigo = Number(resp.statusCode);
let cuerpo = resp.body === undefined ? {} : resp.body;
if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
if (!cuerpo || typeof cuerpo !== 'object') cuerpo = {};

const util = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : undefined;
const soloLlenos = (o) => Object.fromEntries(Object.entries(o).filter((par) => par[1] !== undefined));
const entero = (v, min, max) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) ? v : undefined;

// --- ATENCION: los umbrales de uso extendido (Analisis/27 §5) -----------------
const at = (codigo === 200 && cuerpo.atencion && typeof cuerpo.atencion === 'object') ? cuerpo.atencion : {};
const atencion = {
  atencionEstado: ['normal', 'operador', 'bloqueado'].indexOf(at.estado) >= 0 ? at.estado : 'normal',
  atencionMensajeFijo: util(at.mensajeFijo)
    || 'Gracias por su paciencia. Para atenderle mejor, una persona del equipo va a continuar esta conversación en breve.',
  atencionAvisarRecepcion: ['operador', 'bloqueado'].indexOf(at.avisarRecepcion) >= 0 ? at.avisarRecepcion : '',
  atencionRespuestas: (typeof at.respuestasEnVentana === 'number' && Number.isFinite(at.respuestasEnVentana)) ? at.respuestasEnVentana : 0,
  atencionVenceEn: util(at.ventanaVenceEn) || '',
};

// --- LO DEL CLIENTE EN «Config base» (como en el flujo de Bellido) -------------
// Textos y listas que el panel no sirve (saludo del menú, contactos, emergencia,
// redes, reglas de agenda, palabras que transfieren). Orden: panel > «Config base» >
// respaldo. Un marcador sin reemplazar cuenta como vacío.
const CAMPOS_BASE = ['nombreNegocio','descripcion','direccion','direccionMaps','politicaCancelacion','instruccionesExtra',
  'mensajeCierre','mensajeErrorTemporal','mensajeReservaNoConfirmada','mensajeComercioSuspendido','mensajeMenu',
  'mensajeContactoRecepcion','mensajeContactoDoctor','mensajeEmergencia','mensajeRedes','reglasAgenda','tratamiento',
  'estiloEmojis','nivelEmojis','datosQueNoTenemos','prefijosPermitidos','palabrasClaveRecepcion','palabrasClaveDoctor',
  'palabrasClaveEmergencia','horarioAtencion','respuestaServicios','respuestaCosto'];
const deBase = {};
for (const k of CAMPOS_BASE) {
  const v = typeof base[k] === 'string' ? base[k].trim() : '';
  if (v && !v.startsWith('REEMPLAZAR_')) deBase[k] = v;
}

let cfg;
if (codigo === 409) {
  cfg = Object.assign({}, RESPALDO, deBase, atencion, {
    estadoComercio: 'suspendido',
    mensajeComercioSuspendido: util(cuerpo.mensajeCortesia) || RESPALDO.mensajeComercioSuspendido,
    configDeLaConsola: false, panelDice: 'no operativo',
  });
} else if (!(codigo === 200 && typeof cuerpo.tenantId === 'string')) {
  cfg = Object.assign({}, RESPALDO, deBase, atencion, {
    configDeLaConsola: false, panelSinRespuesta: true, codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
  });
} else {
  const dn = cuerpo.datosDelNegocio || {};
  const op = cuerpo.operacion || {};
  const voz = cuerpo.voz || {};
  const funcs = Array.isArray(cuerpo.funcionarios) ? cuerpo.funcionarios : [];
  const f0 = funcs.filter((f) => f && f.porDefecto === true)[0] || funcs[0] || {};
  // El horario dia por dia es el de la persona que atiende (el propio, o el del negocio).
  const horarioDelPanel = !!(f0.horarioTrabajo && typeof f0.horarioTrabajo === 'object' && Object.keys(f0.horarioTrabajo).length);
  const horario = (f0.horarioTrabajo && typeof f0.horarioTrabajo === 'object' && Object.keys(f0.horarioTrabajo).length)
    ? f0.horarioTrabajo : RESPALDO.horario;
  const ag = cuerpo.agendamiento && typeof cuerpo.agendamiento === 'object' ? cuerpo.agendamiento : {};
  const ENLACE_MAPA = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/;
  const mapa = util(dn.direccionMaps);
  const deLaConsola = soloLlenos({
    nombreNegocio: util(dn.nombreNegocio),
    descripcion: util(dn.descripcion),
    direccion: util(dn.direccion),
    direccionMaps: mapa && mapa.length <= 200 && ENLACE_MAPA.test(mapa) ? mapa : undefined,
    politicaCancelacion: util(dn.politicaCancelacion),
    instruccionesExtra: util(dn.instruccionesExtra),
    mensajeCierre: util(dn.mensajeCierre),
    mensajeErrorTemporal: util(dn.mensajeErrorTemporal),
    mensajeComercioSuspendido: util(dn.mensajeComercioSuspendido),
    mensajeMenu: util(dn.mensajeMenu),
    mensajeContactoRecepcion: util(dn.mensajeContactoRecepcion),
    mensajeContactoDoctor: util(dn.mensajeContactoDoctor),
    mensajeEmergencia: util(dn.mensajeEmergencia),
    mensajeRedes: util(dn.mensajeRedes),
    respuestaServicios: util(dn.respuestaServicios),
    respuestaCosto: util(dn.respuestaCosto),
    reglasAgenda: util(dn.reglasAgenda),
    numeroDoctor: util(op.numeroDoctor),
    numeroRecepcion: util(op.numeroRecepcion),
    calendarioId: util(op.calendarioId) || util(f0.calendarioId) || util(f0.calendario),
    horarioAtencion: util(op.horarioAtencion),
    datosQueNoTenemos: Array.isArray(dn.datosQueNoTenemos) && dn.datosQueNoTenemos.length ? dn.datosQueNoTenemos.join(', ') : undefined,
    tratamiento: util(voz.tratamiento),
    estiloEmojis: util(voz.emojis),
    nivelEmojis: ['ninguno', 'pocos', 'muchos'].indexOf(voz.nivelEmojis) >= 0 ? voz.nivelEmojis : undefined,
    prefijosPermitidos: Array.isArray(op.prefijosPermitidos) && op.prefijosPermitidos.length ? op.prefijosPermitidos.join(',') : undefined,
    duracionPorDefectoMin: entero(ag.duracionPorDefectoMin, 5, 480),
    anticipacionMinimaMin: entero(ag.anticipacionMinimaMin, 0, 10080),
    anticipacionMaximaDias: entero(ag.anticipacionMaximaDias, 1, 365),
  });
  const util2 = util(cuerpo.estadoComercio);
  const estadoComercio = util2 === 'activo' ? 'operativo' : (util2 ? 'suspendido' : 'operativo');
  cfg = Object.assign({}, RESPALDO, deBase, atencion, deLaConsola, { horario: horario, horarioDelPanel: horarioDelPanel, estadoComercio: estadoComercio, configDeLaConsola: true });
}

// --- MODO PRUEBA Y CALENDARIO --------------------------------------------------
const prueba = carga.prueba && carga.prueba.modoPrueba === true ? carga.prueba : null;
const forzado = String(base.calendarioForzado || '').trim();
// Respaldo de destinatarios (solo si el panel no los dio): recepción y doctor vienen de
// «Config base», con los marcadores que el publicador reemplaza, como en Bellido. Un marcador
// sin reemplazar cuenta como vacío. El CALENDARIO no tiene respaldo a propósito: nunca se
// agenda en un calendario que nadie eligió.
const cnRespaldo = (v) => { const t = String(v || '').trim(); return t && !t.startsWith('REEMPLAZAR_') ? t : ''; };
if (!String(cfg.numeroRecepcion || '').trim()) cfg.numeroRecepcion = cnRespaldo(base.respaldoNumeroRecepcion);
if (!String(cfg.numeroDoctor || '').trim()) cfg.numeroDoctor = cnRespaldo(base.respaldoNumeroDoctor);
// El MAPA: si el panel no manda `direccionMaps`, el primer enlace de mapas de `instruccionesExtra` (la del panel o,
// si esa no lo trae, la de «Config base»). Solo enlaces de Google Maps, de hasta 200 caracteres.
if (!String(cfg.direccionMaps || '').trim()) {
  const reMapa = /https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)[/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*/;
  for (const fuente of [cfg.instruccionesExtra, deBase.instruccionesExtra]) {
    const m = String(fuente || '').match(reMapa);
    if (m && m[0].length <= 200) { cfg.direccionMaps = m[0].replace(/[).,;:!?]+$/, ''); break; }
  }
}
const calendarioId = forzado || (prueba ? String(prueba.calendarioDePrueba || '') : String(cfg.calendarioId || ''));

// --- LA TOLERANCIA (P10): la frase sale de la configuracion, no del codigo -----
function cnTolerancia(textos) {
  const t = textos.join('\n');
  const citas = t.match(/«[^»]*»|"[^"]*"|“[^”]*”/g) || [];
  for (const c of citas) {
    if (/toleranc/i.test(c)) return c.slice(1, -1).trim().slice(0, 300);
  }
  const oraciones = t.split(/(?<=[.!?])\s+|\n+/);
  for (const o of oraciones) {
    if (/toleranc/i.test(o)) return o.replace(/^.*?aclaraci[oó]n:\s*/i, '').trim().slice(0, 300);
  }
  return '';
}

return [{ json: Object.assign({}, cfg, {
  calendarioId: calendarioId,
  numeroRecepcionDigitos: cnDigitos(cfg.numeroRecepcion),
  numeroDoctorDigitos: cnDigitos(cfg.numeroDoctor),
  toleranciaTexto: cnTolerancia([String(cfg.instruccionesExtra || ''), String(cfg.reglasAgenda || '')]),
  waGraphVersion: String(base.waGraphVersion || cfg.waGraphVersion || 'v26.0'),
  phoneNumberId: String(carga.phoneNumberId || ''),
  // El modo prueba. Solo lo trae `Carga de entrada` cuando corrio «Entrada de prueba».
  modoPrueba: prueba !== null,
  telefonoDePrueba: prueba ? String(prueba.telefonoDePrueba || '') : '',
  enviarDeVerdad: prueba ? prueba.enviarDeVerdad === true : true,
}) }];
