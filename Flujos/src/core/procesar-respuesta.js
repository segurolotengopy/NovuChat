// Separa la marca [TRANSFERIR] de la respuesta al cliente (criterio C-11).
const entradas = $('Normalizar entrada').all();
const cfg = $('Config del negocio').first().json;
const cierre = String(cfg.mensajeCierre ?? '').trim()
  || 'Gracias por escribirnos. Si necesita algo mas, escribame por aca.';
const falla = String(cfg.mensajeErrorTemporal ?? '').trim()
  || 'Disculpe, tuve un problema tecnico momentaneo. Me repite lo ultimo?';

// `isExecuted` es de toda la ejecucion, no del item: se lee una sola vez, y
// protegido, porque si la referencia fallara la verificacion tiene que
// seguir abierta por las otras dos vias.
let herramientaAgendarCorrio = false;
try { herramientaAgendarCorrio = $('agendar_cita').isExecuted === true; }
catch (e) { herramientaAgendarCorrio = false; }
// Lo mismo con `cancelar_cita` (revision de seguridad del #275): si el agente
// revienta, sus pasos se pierden, pero n8n sabe si la herramienta corrio.
// `null` si la referencia falla: entonces decide el registro de la cita.
let herramientaCancelarCorrio = null;
try { herramientaCancelarCorrio = $('cancelar_cita').isExecuted === true; }
catch (e) { herramientaCancelarCorrio = null; }

// ===== AGENDA DEL TURNO: BLOQUE COMPARTIDO (inicio) =========================
// LETRA POR LETRA el mismo en `Procesar respuesta` y en `Procesar reintento`:
// un nodo Code no puede importar a otro, y `candado-agenda.test.ts` exige que
// los dos sean identicos. Son solo funciones: no leen nada del flujo, cada nodo
// les pasa lo suyo. Para que sirven, en `Procesar respuesta` (27/09/2026).
const AG_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const AG_DIA_CORTO = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const AG_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const agDos = (n) => String(n).padStart(2, '0');
// La zona es fija, UTC-4 (CLAUDE.md): se resta el desfase y se lee en UTC, sin
// depender de la base de zonas de la imagen de n8n.
const agLaPaz = (ms) => {
  const d = new Date(ms - 4 * 3600000);
  return { fecha: d.toISOString().slice(0, 10), semana: d.getUTCDay(), dia: d.getUTCDate(),
    mes: d.getUTCMonth() + 1, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const agInstante = (fecha, min) => Date.parse(fecha + 'T' + agDos(Math.floor(min / 60)) + ':'
  + agDos(min % 60) + ':00-04:00');
const agHora = (min) => agDos(Math.floor(min / 60)) + ':' + agDos(min % 60);
const agSinTilde = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const agSumarDias = (fecha, n) => agLaPaz(agInstante(fecha, 720) + n * 86400000).fecha;
const agSemanaDe = (fecha) => agLaPaz(agInstante(fecha, 720)).semana;
// «lunes 28»: el dia de la semana lo pone el codigo, nunca el modelo.
const agDiaTexto = (fecha) => { const p = agLaPaz(agInstante(fecha, 720)); return AG_DIAS[p.semana] + ' ' + p.dia; };
// Donde termina una oracion: despues de . ! ? o …, salvo en una abreviatura
// («Dr.», «Dra.», «Lic.», «Av.»): «con el Dr. Pérez» es UNA oracion.
const AG_ORACION = /(?<=[.!?…])(?<!\b(?:Dr|Dra|Sr|Sra|Srta|Lic|Ing|Av|Nro|Edif|Of|of|Esq|esq)\.)\s+/;
const agLista = (mins) => {
  const h = mins.map(agHora);
  return h.length <= 1 ? (h[0] || '') : h.slice(0, -1).join(', ') + ' o ' + h[h.length - 1];
};
// Los tramos de un dia en el horario de una persona: `null` = no se puede
// juzgar (sin dato, o ilegible); lista vacia = ese dia no atiende. Misma
// lectura que `Comprobar reserva`: «09:00-12:00, 14:00-18:00» o «cerrado».
const agTramos = (horario, semana) => {
  const v = horario && typeof horario === 'object' ? horario[AG_DIA_CORTO[semana]] : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = v.trim();
  if (/^cerrad[oa]s?$/i.test(t)) return [];
  const tramos = [];
  for (const parte of t.split(/[,;]/)) {
    const m = /^(\d{1,2}):(\d{2})\s*[-–a]\s*(\d{1,2}):(\d{2})$/.exec(parte.trim());
    if (!m) continue;
    const i = Number(m[1]) * 60 + Number(m[2]);
    const f = Number(m[3]) * 60 + Number(m[4]);
    if (f > i && f <= 1440) tramos.push({ i, f });
  }
  return tramos.length ? tramos : null;
};
// Lo que devolvio una herramienta, como lista. `null` = la herramienta FALLO:
// n8n le entrega al modelo una observacion vacia (#5553), y una consulta que
// fallo no verifica nada.
const agObservacion = (obs) => {
  let o = obs;
  if (typeof o === 'string') {
    if (o.trim() === '') return null;
    try { o = JSON.parse(o); } catch (e) { return null; }
  }
  const lista = Array.isArray(o) ? o : (o && typeof o === 'object' ? [o] : null);
  if (!lista || lista.some((x) => x && typeof x === 'object' && x.error !== undefined)) return null;
  return lista;
};
// Las consultas de ESTE turno: el rango que se pidio, lo ocupado que volvio y
// el horario de la persona consultada (el de la lista `funcionarios`; si no se
// dijo quien, el de la unica persona, o el comun si todos tienen el mismo).
// `ignorar`: ids que no cuentan como ocupados (una cita cancelada en el mismo
// turno ya no ocupa nada).
const agConsultas = (pasos, equipo, ignorar) => {
  const lista = [];
  const iguales = equipo.length > 0
    && equipo.every((x) => JSON.stringify(x.horario || {}) === JSON.stringify(equipo[0].horario || {}));
  for (const p of (Array.isArray(pasos) ? pasos : [])) {
    if (!p || !p.action || p.action.tool !== 'consultar_disponibilidad') continue;
    const e = p.action.toolInput || {};
    const desde = Date.parse(String(e.inicio || ''));
    const hasta = Date.parse(String(e.fin || ''));
    const eventos = agObservacion(p.observation);
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde || eventos === null) continue;
    const ocupados = [];
    for (const ev of eventos) {
      if (!ev || typeof ev !== 'object' || ignorar.has(String(ev.id || ''))) continue;
      const i = Date.parse(String((ev.start || {}).dateTime || ''));
      const f = Date.parse(String((ev.end || {}).dateTime || ''));
      // Con su id: el aviso de «ya está tu cita» exige verla en la agenda.
      if (Number.isFinite(i) && Number.isFinite(f) && f > i) ocupados.push({ i, f, id: String(ev.id || '') });
    }
    const quien = agSinTilde(e.funcionario);
    const persona = (quien && equipo.find((x) => agSinTilde(x.nombre) === quien))
      || (equipo.length === 1 ? equipo[0] : null);
    const horario = persona ? persona.horario : (iguales ? equipo[0].horario : null);
    lista.push({ desde, hasta, fecha: agLaPaz(desde).fecha, ocupados,
      horario: horario && typeof horario === 'object' ? horario : null,
      persona: persona ? String(persona.nombre || '') : '' });
  }
  return lista;
};
// LA GRILLA DEL CHAT: cada 30 minutos desde las 00:00 (pedido del doctor de un
// consultorio, 27/09/2026, y vale para todos). El negocio puede cargar a mano
// citas cada 15 minutos —y hasta dos a la misma hora, hermanos—, pero por el
// chat solo se ofrecen y se agendan horas en punto o y media.
const AG_GRILLA_MIN = 30;
// Por que una hora NO se puede ofrecer: '' si se puede. En este orden: no cae
// en la grilla, ya paso (o no llega a la anticipacion minima), el dia esta
// cerrado, cae fuera del horario, nadie consulto esa hora en este turno, o
// esta ocupada.
const agMotivo = (consultas, fecha, min, duracion, limite) => {
  const t = agInstante(fecha, min);
  if (!Number.isFinite(t)) return 'sin_consulta';
  if (min % AG_GRILLA_MIN !== 0) return 'fuera_de_grilla';
  if (t < limite) return 'pasado';
  const delDia = consultas.filter((c) => c.fecha === fecha);
  if (!delDia.length) return 'sin_consulta';
  const orden = ['cerrado', 'fuera', 'sin_consulta', 'ocupado'];
  let peor = 'ocupado';
  for (const c of delDia) {
    const tramos = agTramos(c.horario, agSemanaDe(fecha));
    let motivo = '';
    if (tramos !== null && tramos.length === 0) motivo = 'cerrado';
    else if (tramos !== null && !tramos.some((r) => min >= r.i && min + duracion <= r.f)) motivo = 'fuera';
    else if (!(c.desde <= t && t < c.hasta)) motivo = 'sin_consulta';
    else if (c.ocupados.some((o) => t < o.f && o.i < t + duracion * 60000)) motivo = 'ocupado';
    if (!motivo) return '';
    if (orden.indexOf(motivo) < orden.indexOf(peor)) peor = motivo;
  }
  return peor;
};
// Una hora de 1 a 7 sin «tarde» ni «mañana» («a las 5») se juzga tambien doce
// horas despues; si asi vale, queda a la tarde.
const agMotivoDeHora = (juzgar, h) => {
  const motivo = juzgar(h.min);
  if (motivo && h.ambigua && juzgar(h.min + 720) === '') { h.min += 720; return ''; }
  return motivo;
};
// Las horas libres de un dia segun lo consultado, cada `paso` minutos.
const agLibres = (consultas, fecha, duracion, limite, paso) => {
  const libres = [];
  for (let min = 0; min + duracion <= 1440; min += paso) {
    if (agMotivo(consultas, fecha, min, duracion, limite) === '') libres.push(min);
  }
  return libres;
};
// Las horas escritas en un texto, con su posicion. Del modelo se toma lo que
// tiene minutos («11:00», «11.30», «16h30»), lo que viene tras «las» («a las
// 17») y «17 hs»; «2 horas» es una duracion, no una hora. «De la tarde» o «pm»
// suman doce; «en punto» tambien la marca. `ambigua`: de 1 a 7 sin tarde ni
// mañana, que en un consultorio casi siempre es de la tarde.
const agHorasDelTexto = (texto) => {
  const t = String(texto || '');
  const out = [];
  const re = /(?<![\d:.,/])([01]?\d|2[0-3])(?:\s*[:.h]\s*([0-5]\d)|\s+y\s+(media|cuarto))?(?![\d/]|[.:]\d)(\s*(?:hrs?\.?|hs\.?)(?![a-záéíóúñ]))?(\s*(?:de\s+la\s+(?:tarde|noche)|pm(?![a-záéíóúñ])|p\.\s?m\.?))?(\s*(?:de\s+la\s+ma[ñn]ana|am(?![a-záéíóúñ])|a\.\s?m\.?))?(\s+en\s+punto\b)?/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m[0] === '') { re.lastIndex += 1; continue; }
    let h = Number(m[1]);
    const conMinutos = m[2] !== undefined || m[3] !== undefined;
    const antes = t.slice(Math.max(0, m.index - 12), m.index);
    const trasLas = /\b(las?|para\s+las?)\s+$/i.test(antes);
    // «11 en punto» tambien es una hora (Bellido, prueba real del 28/09, #7570), y
    // «9 am» sin «las» (29/09, #8642: «el sabado 10 de octubre 9 am» no se leia
    // como hora y el turno perdia la fecha y la hora que el cliente dijo).
    if (!conMinutos && !trasLas && !m[4] && !m[5] && !m[6] && !m[7]) continue;
    // «15.00 Bs» es un precio, no una hora.
    if (/^\s*(bs\b|bolivianos|usd|\$|%)/i.test(t.slice(m.index + m[0].length, m.index + m[0].length + 12))) continue;
    const min = m[2] !== undefined ? Number(m[2]) : (m[3] ? (/media/i.test(m[3]) ? 30 : 15) : 0);
    if (m[5] && h < 12) h += 12;
    out.push({ min: h * 60 + min, ambigua: !m[5] && !m[6] && h >= 1 && h <= 7,
      desde: m.index, hasta: m.index + m[0].length });
  }
  return out;
};
// La fecha que nombra un texto, relativa a `hoy`: «28 de septiembre», «lunes
// 28», «el 28», «pasado mañana», «mañana», «hoy», o un dia de la semana solo.
// '' si no nombra ninguna. El numero manda sobre la palabra del dia.
const agFechaDelTexto = (texto, hoy) => {
  const t = agSinTilde(texto);
  const buscar = (ok) => { for (let i = 0; i <= 62; i++) { const f = agSumarDias(hoy, i); if (ok(f)) return f; } return ''; };
  const diaDe = (f) => Number(f.slice(8, 10));
  let m = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.exec(t);
  if (m) {
    const mes = AG_MESES.indexOf(m[2]) + 1;
    const f = buscar((x) => diaDe(x) === Number(m[1]) && Number(x.slice(5, 7)) === mes);
    if (f) return f;
  }
  // Un punto que cierra la oracion no es parte de una hora: «el lunes 5.» es
  // el dia 5 (ensayo del 28/09: se leia como «hoy lunes 28»); «5.30» si.
  m = /\b(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado|hoy|manana)\s+(\d{1,2})(?![\d:]|\.\d)/.exec(t)
    || /\b(?:el|para\s+el|del|dia)\s+(\d{1,2})(?![\d:]|\.\d)(?!\s*(?:hrs?|hs|horas?|de\s+la)\b)/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    const f = buscar((x) => diaDe(x) === Number(m[1]));
    if (f) return f;
  }
  if (/\bpasado\s+manana\b/.test(t)) return agSumarDias(hoy, 2);
  if (/(?<!\bla\s)\bmanana\b/.test(t)) return agSumarDias(hoy, 1);
  if (/\bhoy\b/.test(t)) return hoy;
  m = /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.exec(t);
  if (m) {
    const semana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].indexOf(m[1]);
    return buscar((x) => agSemanaDe(x) === semana);
  }
  return '';
};
// Las oraciones de una respuesta que OFRECEN horas, con la fecha de cada una.
// Ofrecer es nombrar horas como disponibles; no lo es confirmar una cita,
// describir la que ya tiene, cancelar, negar («a las 13 no hay») ni dar el
// horario de atencion («de 11:00 a 18:00»). Una linea que solo trae horas
// hereda de la anterior si esa terminaba en «:» o ya ofrecia.
const agOfertas = (texto, hoy) => {
  const partes = String(texto || '').split(new RegExp('(' + AG_ORACION.source + '|\\n+)'));
  const NO_OFERTA = /cancel|agendad|reservad|registrad|confirmad|reprogramad|anotad|\bqued[oó]\b|\b(tu|su|tus|sus)\s+citas?\b|\bten[ií]as?\b|\bhorario\s+de\s+atenci|\batendemos\s+de\b|\batiende\s+de\b/i;
  const NEGADA = /\bno\s+(hay|tengo|tenemos|tiene|tienen|queda|quedan|est[aá]|atiende|atendemos|trabaja|contamos|puedo|se\s+puede|es\s+posible)\b|\bocupad|\bcerrad|\btomad[oa]s?\b|\bno\s+disponible|\bya\s+pas/i;
  const POSITIVA = /disponib|libre|espacio|lugar|cupo|\btengo\b|\btenemos\b|\btiene\b|\bhay\b|ofrezco|\bpuedo\b/i;
  const OFERTA = /disponib|libre|espacio|lugar|cupo|turno|horario|opci[oó]n|\btengo\b|\btenemos\b|\btiene\b|\bhay\b|puedo\s+(ofrecer|dar)|ofrezco|\b(te|le)\s+(sirve|viene|queda|acomoda|parece)|prefier|qu[eé]\s+tal|podr[ií]a\s+ser|\?|¿/i;
  const ofertas = [];
  let previa = false;
  let fechaPrevia = '';
  for (let i = 0; i < partes.length; i += 2) {
    const oracion = partes[i] || '';
    // Un rango («de 11:00 a 18:00», «entre las 14:00 y las 16:00») o un borde
    // («después de las 15:00», «hasta las 18:00») describe un horario; no ofrece.
    const todas = agHorasDelTexto(oracion);
    const fuera = new Set();
    todas.forEach((h, k) => {
      const antes = oracion.slice(Math.max(0, h.desde - 22), h.desde);
      if (/((despu[eé]s|antes|a\s+partir)\s+de|desde|hasta)\s+(las?\s+)?$/i.test(antes)) fuera.add(k);
      const siguiente = todas[k + 1];
      if (!siguiente) return;
      const medio = oracion.slice(h.hasta, siguiente.desde);
      if (/^\s*(a|al|hasta|-|–)\s*(las?\s+)?$/i.test(medio)
        || (/^\s*y\s+(las?\s+)?$/i.test(medio) && /entre\s+(las?\s+)?$/i.test(antes))) { fuera.add(k); fuera.add(k + 1); }
    });
    const horas = todas.filter((_, k) => !fuera.has(k));
    const fechaAqui = agFechaDelTexto(oracion, hoy);
    if (fechaAqui) fechaPrevia = fechaAqui;
    if (!horas.length) { previa = /:\s*$/.test(oracion.trim()) && OFERTA.test(oracion); continue; }
    const sinFormato = oracion.replace(/[*_~]/g, '');
    // La negacion alcanza a lo que sigue hasta que algo vuelve a ofrecer:
    // «a las 13:00 no hay, pero tengo 12:30» ofrece 12:30; «no hay a las 13:00,
    // 13:30 ni 14:00» no ofrece ninguna.
    const negados = [];
    const reCorte = /,|;|\s+pero\s+/gi;
    let negando = false;
    let ini = 0;
    let corte;
    const tramo = (a, b) => {
      const x = oracion.slice(a, b);
      if (NEGADA.test(x)) negando = true;
      else if (POSITIVA.test(x)) negando = false;
      if (negando) negados.push([a, b]);
    };
    while ((corte = reCorte.exec(oracion)) !== null) { tramo(ini, corte.index); ini = corte.index + corte[0].length; }
    tramo(ini, oracion.length);
    const ofrecidas = horas.filter((h) => !negados.some(([a, b]) => h.desde >= a && h.hasta <= b));
    const esOferta = ofrecidas.length > 0 && !NO_OFERTA.test(sinFormato) && (OFERTA.test(sinFormato) || previa);
    previa = esOferta;
    if (!esOferta) continue;
    ofertas.push({ indice: i, horas: ofrecidas, fecha: fechaAqui || fechaPrevia });
  }
  return { partes, ofertas };
};
// Deja en una oracion solo las horas `validas`: cada lista de horas seguidas
// («11:00, 11:30 o 12:00») se vuelve a escribir con las que quedan.
const agDejarValidas = (oracion, horas, validas) => {
  const SEP = /^(\s*,\s*|\s+[oyu]\s+|\s*,\s*[oy]\s+)(a\s+las\s+|las\s+)?$/i;
  const corridas = [];
  for (const h of horas.slice().sort((a, b) => a.desde - b.desde)) {
    const ultima = corridas[corridas.length - 1];
    if (ultima && SEP.test(oracion.slice(ultima[ultima.length - 1].hasta, h.desde))) ultima.push(h);
    else corridas.push([h]);
  }
  let texto = oracion;
  for (const c of corridas.reverse()) {
    const quedan = c.filter((h) => validas.includes(h));
    if (quedan.length === c.length) continue;
    // Sin ninguna que quede, tambien se va el «a las» que las anunciaba (29/09, #8567:
    // «(por ejemplo, a las ).» quedaba en el mensaje al paciente).
    const antes = texto.slice(0, c[0].desde);
    texto = (quedan.length ? antes : antes.replace(/(?:\ba\s+las?\s+|\blas\s+)$/i, ''))
      + agLista(quedan.map((h) => h.min)) + texto.slice(c[c.length - 1].hasta);
  }
  return texto.replace(/\(\s*(?:por\s+ejemplo|p\.\s*ej\.?|ej\.?)?\s*[,:]?\s*\)/gi, '')
    .replace(/\s+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ');
};
// Cambia por `nuevo` las oraciones que hablan de horas; lo demas (una
// presentacion, el nombre que falta, un precio) se queda, en su lugar.
const agCambiarHoras = (texto, nuevo) => {
  const HABLA_DE_HORAS = /horario|disponib|\blibre|\bturno|cu[aá]l\s+de\s+est|prefier|te\s+sirve|le\s+sirve|atenci[oó]n|agend/i;
  const partes = String(texto || '').split(new RegExp(AG_ORACION.source + '|\\n+'));
  const quedan = [];
  let puesto = false;
  for (const parte of partes) {
    const o = parte.trim();
    if (!o) continue;
    if (agHorasDelTexto(o).length || HABLA_DE_HORAS.test(o)) {
      if (!puesto) { quedan.push(nuevo); puesto = true; }
      continue;
    }
    quedan.push(o);
  }
  if (!puesto) quedan.push(nuevo);
  return quedan.join(' ').trim();
};
// ===== AGENDA DEL TURNO: BLOQUE COMPARTIDO (fin) ============================

const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  // Emparejamiento por indice: nunca .first(), que le pondria el telefono del
  // primer cliente a la respuesta del segundo cuando llegan dos a la vez.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;
  const dato = items[i].json;

  // Gemini devuelve 500/503 en picos y entonces no llega `output`. Hay que
  // distinguirlo de una respuesta vacia: despedirse cuando en realidad se cayo
  // el modelo deja al cliente creyendo que la conversacion termino.
  const fallo = dato.error !== undefined || dato.output === undefined;
  const texto = String(dato.output ?? '').trim();
  // LA TRANSFERENCIA PUEDE VENIR FORZADA, y entonces no se le pide al modelo:
  // un pago de seña que llego DESPUES de que el horario se liberara tiene plata
  // de por medio y alguien esperando, asi que pasa a una persona si o si
  // (`Preparar imagen`, 19/09/2026). Un [TRANSFERIR] del modelo suma, no resta.
  const transferir = texto.includes('[TRANSFERIR]') || ent.forzarTransferencia === true;
  // UBICACION (Analisis/34 §2). La marca [ENVIAR_UBICACION] la escribe el
  // modelo SOLO cuando el cliente pidio expresamente el pin. Se quita del
  // texto siempre; el `location` nativo se manda solo si el comercio cargo
  // las coordenadas: sin ellas el texto ya lleva la direccion y el enlace, y
  // no hay nada mas que mandar. Cuesta un mensaje mas, solo en ese caso.
  const pideUbicacion = /\[ENVIAR_UBICACION\]/i.test(texto);
  // CONTACTO DE RECEPCION (19/09/2026). El modelo escribe la marca cuando el
  // cliente pide el numero o quiere hablar con una persona. El numero NO se
  // escribe en el texto: viaja en un boton que abre el chat de recepcion, asi
  // no hay que copiarlo a mano ni se equivoca un digito.
  const pideContacto = /\[CONTACTO_RECEPCION\]/i.test(texto);
  // REENVIAR EL QR (2026-09-20): el cliente dice que no le llegó y lo pide.
  const pideQr = /\[REENVIAR_QR\]/i.test(texto);
  let respuesta = texto.split('[TRANSFERIR]').join('')
    .replace(/\[ENVIAR_UBICACION\]/gi, '')
    .replace(/\[CONTACTO_RECEPCION\]/gi, '')
    .replace(/\[REENVIAR_QR\]/gi, '')
    // Cualquier otra marca en corchetes que el modelo invente, para que el
    // cliente nunca la vea (mismo criterio que el Demo B).
    .replace(/\[[A-ZÁÉÍÓÚÑ_ ]{3,30}\]/g, '')
    .trim();

  // El nodo de WhatsApp rechaza un cuerpo vacio con 400 Bad request. Pero una
  // respuesta vacia NO significa que la conversacion termino: el 2026-08-30 el
  // modelo devolvio cadena vacia en plena reserva y el cierre cortes hizo creer
  // al cliente que estaba todo listo, cuando no se habia agendado nada.
  // La despedida se detecta en lo que ESCRIBIO EL CLIENTE, no se deduce de que
  // el modelo no haya contestado. Ante la duda, un error recuperable -- que
  // invita a repetir -- es mucho mejor que un cierre, que corta.
  const DESPEDIDA = /^\s*(muchas\s+)?(gracias|grax|chau|chao|adios|adiós|listo|ok|oka|dale|perfecto|hasta\s+luego|nos\s+vemos|buenas\s+noches)\b[\s.!¡👍🙏😊]*$/i;
  const seDespide = DESPEDIDA.test(String(items[i].json.userInput ?? ''));

  // --- EL MONTO DE LA SEÑA NO LO ESCRIBE EL MODELO (2026-09-20) --------------
  // El prompt le inyecta el importe exacto y aun asi escribio «la seña de 50
  // Bs» con la seña en 1: confundio el precio del tratamiento con la seña. Una
  // clienta lo leyo. El prompt no es una barrera (CLAUDE.md), y esto es plata,
  // asi que se corrige aca: SOLO el importe que aparece pegado a la palabra
  // «seña» y dentro de la misma oracion. El precio del tratamiento —«cuesta
  // 500 Bs»— no se toca: esta en otra oracion y no lleva esa palabra al lado.
  const importeSena = String(cfg.senaImporte || '').trim();
  if (cfg.senaActiva === 'si' && importeSena !== '') {
    const moneda = String(cfg.senaMoneda || 'Bs').trim() || 'Bs';
    const correcto = importeSena + ' ' + moneda;
    respuesta = respuesta
      // El punto final va aparte: la version anterior se tragaba el de «50 Bs.»
      // --el grupo capturaba «Bs.» entero y lo reemplazaba sin el-- y la oracion
      // salia sin terminar (2026-09-20).
      .replace(/(se[ñn]a[^.!?\n]{0,40}?de\s+)(\d[\d.,]*)\s*(Bs\b\.?|bolivianos\b|BOB\b)/gi,
        (m, antes, n, unidad) => antes + correcto + (unidad.endsWith('.') ? '.' : ''))
      .replace(/(\d[\d.,]*)(\s*(?:Bs\b\.?|bolivianos\b|BOB\b))(\s+de\s+se[ñn]a)/gi,
        (m, n, mon, despues) => correcto + despues);
  }

  // --- UNA MARCA SOLA NO ES UNA RESPUESTA VACIA (21/09/2026) -----------------
  // Prueba con el telefono: el asistente ofrecio «¿Te comunico con ellos?», el
  // paciente dijo «ok» y despues «si, comunicame», y las dos veces el modelo
  // contesto SOLO [CONTACTO_RECEPCION]. Sin la marca el texto quedaba vacio y
  // salia «tuve un problema tecnico»: lo ofrecido no se cumplio nunca. Si el
  // modelo solo marco una accion, la accion ES la respuesta, con una linea fija.
  const tratoUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
  const numeroCargado = String(cfg.numeroRecepcion ?? '').replace(/\D/g, '') !== '';
  const soloMarca = !fallo && respuesta === '' && /\[[A-Za-z_ ]{3,30}\]/.test(texto);
  const direccionFija = String(cfg.direccion || '').trim();
  // Sin numero cargado no hay boton que mandar: lo resuelve una persona.
  const contactoSinNumero = pideContacto && !numeroCargado;
  if (soloMarca) {
    if (pideContacto && numeroCargado) {
      respuesta = tratoUsted ? 'Le paso el contacto de recepción para que les escriba directo.'
        : 'Te paso el contacto de recepción para que les escribas directo.';
    } else if (pideUbicacion && direccionFija && !/no\s+(est[aá]\s+)?definid/i.test(direccionFija)) {
      respuesta = (tratoUsted ? 'Nos encuentra en ' : 'Nos encuentras en ') + direccionFija.replace(/[.\s]+$/, '') + '.';
    } else if (transferir || contactoSinNumero) {
      respuesta = tratoUsted ? 'Le pido a recepción que le responda por este chat.'
        : 'Le pido a recepción que te responda por este chat.';
    }
  }

  const vacia = respuesta === '';
  if (fallo) respuesta = falla;
  else if (vacia) respuesta = seDespide ? cierre : falla;

  // NEGRITA DE WHATSAPP, POR CONSTRUCCION (2026-09-17). El prompt pide UN
  // asterisco y el modelo sigue escribiendo **texto**, que WhatsApp muestra
  // con los asteriscos a la vista. Se corrige aca, determinista, en vez de
  // pedirselo otra vez al modelo: ***x*** -> *_x_* (negrita cursiva) y
  // **x** -> *x*. Un asterisco solo (vinetas, «2 * 3») no se toca. La MISMA
  // linea vive en `Procesar reintento` y en `Mensaje a enviar`, que es la
  // salida unica al cliente; una prueba exige que las tres sean identicas.
  const NEGRITA_MD = (t) => String(t).replace(/\*\*\*([^*\n]+?)\*\*\*/g, '*_$1_*').replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
  respuesta = NEGRITA_MD(respuesta);

  // --- PROHIBICION 3 CON DINERO REAL (seña por QR, bloque 2) ------------------
  // Con la seña activa el asistente maneja un cobro REAL: el QR es el del
  // comercio y el dinero va a su cuenta. CLAUDE.md, prohibicion 3: NUNCA
  // «pago acreditado», «pago verificado» ni «recibimos tu pago». El prompt lo
  // dice, pero un prompt no es una barrera (ya se rompio al cambiar de
  // modelo): si el modelo lo afirma igual, la ORACION se reemplaza por lo
  // unico cierto --el comprobante lo revisa el negocio, y el negocio confirma
  // el pago-- y queda anotado en `avisos`. Mismo regex que la red del cobro
  // simulado del Demo B; se juzga sin marcas de formato.
  const avisos = [];
  const AFIRMA_COBRO = /((pago|cobro|transferencia|dep[oó]sito|abono)\s+(\S+\s+){0,3}(verificad|confirmad|recibid|acreditad|procesad|aprobad|realizad|efectuad|exitos)|ya\s+(recibimos|se\s+acredit|te\s+cobr|se\s+cobr)|(pago|cobro)\s+(\S+\s+){0,2}(real|de\s+verdad))/i;
  if (cfg.senaActiva === 'si' && AFIRMA_COBRO.test(respuesta.replace(/[*_~]/g, ''))) {
    const quienRevisa = String(cfg.nombreNegocio || '').trim() || 'el negocio';
    const CORRECCION = `El comprobante lo revisa ${quienRevisa} y ellos confirman el pago.`;
    respuesta = respuesta.split('\n').map((linea) => linea.split(/(?<=[.!?…])\s+/)
      .map((o) => (AFIRMA_COBRO.test(o.replace(/[*_~]/g, '')) ? CORRECCION : o)).join(' ')).join('\n').trim();
    avisos.push('correccion_cobro');
  }

  // Marca si la respuesta AFIRMA que la cita quedo agendada. Se decide aca y
  // no en una expresion del nodo IF para poder probarlo: la trampa es que
  // "ya tiene reservada su cita" no es una confirmacion nueva sino un aviso
  // de que el horario esta ocupado, y disparar la compuerta ahi romperia una
  // conversacion correcta. Probado contra las frases reales del agente.
  // Solo cuentan las formas de HECHO CONSUMADO. "agendamos" y "reservamos"
  // salieron de la lista: en espanol son a la vez presente y pasado, y el
  // agente las usa para OFRECER ("con gusto agendamos tu cita"). El
  // 2026-08-29 esa ambiguedad disparo la compuerta en plena conversacion y le
  // dijo al cliente que no se pudo registrar una cita que nadie habia pedido.
  // EL DETECTOR NO PUEDE DEPENDER DE UNA REDACCION. La version anterior exigia
// un verbo antes del participio --«quedó confirmada»-- y el 6 de septiembre el
// modelo escribio «✅ Cita confirmada para corte con José», sin verbo. No
// coincidio, la compuerta de verificacion NI SIQUIERA CORRIO, y el cliente
// recibio una confirmacion de una cita que no existia: la credencial de Google
// habia perdido el acceso y `agendar_cita` fallo.
//
// Lo que lo desencadeno fue cambiar de modelo: Flash-Lite redacta distinto, y
// el detector estaba afinado a las frases del modelo anterior. Un detector
// atado a como escribe un modelo se rompe cada vez que se cambia de modelo.
// Por eso ahora tambien reconoce la forma sin verbo, y hay una NEGACION
// explicita para que «No pude confirmar tu cita» no dispare la compuerta.
//
// 2026-09-17, ejecucion #2936: «He reprogramado tu cita» no coincidia con
// nada de esto y una cita quedo encima de otra sin verificar. Se agregan
// reprogram-, reagend-, mov-, «te anote/anotamos» y «cambie tu cita». PERO
// ESTE DETECTOR YA NO ES LA PRIMERA DEFENSA: la verificacion se dispara por
// lo que el modelo HIZO (ver mas abajo, `ejecutoAgendar`); el regex queda
// como red adicional, y se juzga sobre el texto SIN marcas de formato.
const CONFIRMA = /(ha sido|han sido|queda|quedó|quedo|fue|está|esta|ya está|ya esta)\s+(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad|anotad)|\b(he|hemos)\s+(agendado|reservado|registrado|confirmado|reprogramado|reagendado|movido|anotado)\b|(agendé|reservé|registré|reprogramé|reagendé|moví)(?![a-záéíóúñ])|\b(te|le|les|los|las)\s+anot(é|amos)(?![a-záéíóúñ])|\b(cambié|cambiamos|moví|movimos)\s+(tu|su|la)\s+cita\b|\b(cita|reserva|turno)\b[^.!?]{0,40}?\b(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad)[oa]s?\b/i;
  const NIEGA = /\bno\s+(pude|se pudo|pudimos|quedó|quedo|está|esta)\b/i;
  // «No encontramos ninguna cita registrada» / «No veo esa reserva» no afirman que se
  // agendo (Bellido, 28/09, #7624). SOLO la oracion que EMPIEZA asi: una negacion
  // cualquiera («No hay problema, quedo agendada…») no anula el detector (revision
  // de seguridad del #283). Se juzga oracion por oracion.
  const SIN_CITA = /^\W*(?:no\s+(?:encontr[a-záéíóúñ]*|veo|figura[a-záéíóúñ]*|registr[a-záéíóúñ]*)\s+(?:ning[uú]n[a]?\s+|esa\s+|tu\s+|la\s+|alguna\s+)?(?:citas?|reservas?|turnos?)\b|ninguna\s+(?:cita|reserva|turno)\b)/i;
  const YA_EXISTE = /\bya\s+(tiene|tienes|cuenta con|hay)/i;
  // Sin marcas de formato: «quedó *agendada*» cuenta igual que «quedó agendada».
  const plano = respuesta.replace(/[*_~]/g, '');
  const sinLasNegadas = plano.split(/(?<=[.!?])\s+|\n+/).filter((o) => !SIN_CITA.test(o)).join(' ');
  const afirmaAgendo = CONFIRMA.test(sinLasNegadas) && !YA_EXISTE.test(plano) && !NIEGA.test(plano);

  // Coordenadas del pin, de la configuracion (consola o respaldo). Viajan
  // como texto porque Config base es un Set de textos; aca se vuelven numero
  // y se comprueba el rango. Con una sola, o con basura, no se manda nada.
  const coordenada = (v, max) => {
    const t = String(v ?? '').trim();
    const n = Number(t);
    return t !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
  };
  const lat = coordenada(cfg.ubicacionLat, 90);
  const lng = coordenada(cfg.ubicacionLng, 180);
  // Si el modelo escribio SOLO la marca, la respuesta queda vacia y sale el
  // texto de error: ahi tampoco va el pin. Nunca un pin sin la direccion en el texto.
  // Y SOLO SI EL CLIENTE PREGUNTO POR LA UBICACION (2026-09-20). El modelo puso
  // la marca en una CONFIRMACION de cita, sin que nadie la pidiera: un mensaje
  // pagado de mas en cada reserva. La marca sigue siendo del modelo, pero acá
  // se comprueba contra lo que el cliente ESCRIBIO. Si no preguntó, no sale.
  const PREGUNTA_UBICACION = /\bd[oó]nde\b|ubicaci[oó]n|direcci[oó]n|c[oó]mo llego|c[oó]mo se llega|\bmapa\b|\bpin\b|googlemaps|google maps|queda(n|s)?\b/i;
  const preguntoPorLaUbicacion = PREGUNTA_UBICACION.test(String(ent.userInput || ''));
  const enviarUbicacion = pideUbicacion && preguntoPorLaUbicacion && !vacia && lat !== null && lng !== null;
  // El boton solo sale si hay numero cargado; si no, el texto del modelo ya
  // dice que lo atiende una persona y no se manda nada de mas.
  const numeroRecepcion = String(cfg.numeroRecepcion ?? '').replace(/\D/g, '');
  // Y SOLO SI EL CLIENTE LO PIDIO (2026-09-20). El modelo mandaba el boton por
  // su cuenta: salio mientras confirmaba una reserva, y otra vez para
  // deshacerse de una pregunta que no supo resolver. Es un mensaje pagado de
  // mas y, peor, empuja al paciente a otro canal sin que lo haya pedido. Si el
  // asistente necesita que intervenga una persona, para eso esta [TRANSFERIR],
  // que avisa a recepcion y no le cuesta un mensaje al cliente.
  const PIDE_CONTACTO = /n[uú]mero|tel[eé]fono|celular|whats?app\s+de|hablar con (alguien|una persona|un humano|recepci[oó]n)|comunic|contacto|me pas(as|es|a)|atienda alguien|una persona/i;
  const pidioContacto = PIDE_CONTACTO.test(String(ent.userInput || ''));
  // Si el modelo solo marco el contacto, o su texto dice que lo pasa, se
  // manda: un texto que anuncia el contacto y no lo trae es una promesa rota.
  const ANUNCIA_CONTACTO = /contacto|n[uú]mero|bot[oó]n|escrib[a-záéíóúñ]*\s+directo/i;
  const enviarContacto = pideContacto && (pidioContacto || soloMarca || ANUNCIA_CONTACTO.test(respuesta)) && !vacia && numeroRecepcion !== '';
  // Se reenvía SOLO si hay una seña pendiente de verdad y un QR que mandar: el
  // servidor lo dice, no el modelo. Sin eso, el texto ya explica qué pasa.
  const reenviarQr = pideQr && !vacia
    && String(cfg.senaPendiente || '') === 'si' && String(cfg.senaQrUrl || '') !== '';
  // SI PIDIO EL QR Y NO HAY NINGUNA SEÑA PENDIENTE, el modelo acaba de decir
  // que se lo reenvia y no hay nada que reenviar: lo resuelve una persona. No
  // se le pide al modelo que lo decida, porque ya se equivoco una vez
  // inventando que «el sistema de pagos no esta disponible» (20/09/2026).
  const qrSinSena = pideQr && !vacia && !reenviarQr;

  // --- LO QUE EL MODELO HIZO, no lo que dijo (2026-09-17, ejecucion #2936) --
  // La paciente insistio («¿A las 10 no tienes?»), consultar_disponibilidad
  // le devolvio una cita de 10:00 a 11:00 y el modelo llamo a agendar_cita a
  // las 10:00 igual, con la regla de intervalos recien publicada en el
  // prompt. Y escribio «He reprogramado tu cita», que CONFIRMA no cubria: la
  // compuerta no corrio y la cita quedo encima de otra. Dos lecciones: el
  // prompt no es una barrera, y el candado no puede depender de un verbo.
  // Desde aca la verificacion se dispara si la herramienta SE EJECUTO, por
  // dos vias que no dependen de la redaccion:
  //   1. `intermediateSteps` de la salida del agente (opcion «Return
  //      Intermediate Steps» del nodo): cada herramienta invocada, con sus
  //      argumentos y lo que devolvio. Es por item, y trae el `id` del
  //      evento que agendar_cita creo; `Comprobar reserva` lo usa para
  //      anclar el candado a ESA cita y no solo a «lo creado hace 5 min».
  //   2. `$('agendar_cita').isExecuted`: n8n lo responde con la presencia
  //      del nodo en los datos de la ejecucion, y una herramienta invocada
  //      queda ahi (en la #2936 `agendar_cita` figura con su salida bajo
  //      `ai_tool`; en la #2933, que no agendo, no figura). Lo que NO sirve
  //      es `$('agendar_cita').all()`: lee la salida `main`, y una
  //      herramienta solo tiene `ai_tool`.
  // El regex queda como tercera red. Cualquiera de las tres abre la
  // verificacion (`verificarReserva`), que es lo que lee `¿Afirma que agendó?`.
  const pasos = Array.isArray(dato.intermediateSteps) ? dato.intermediateSteps : [];
  const herramientas = pasos.map((p) => String((p && p.action && p.action.tool) || '')).filter(Boolean);
  const eventosCreados = [];
  // Las llamadas a agendar_cita cuya observacion NO trajo ninguna cita con id
  // (revision de seguridad de 98796fd): si una de dos llamadas no la trae, esa
  // cita no se puede anclar, y el candado tiene que volver a mirar toda la
  // ventana en vez de confiar en los ids que si vinieron.
  let agendarPasosSinId = 0;
  for (const p of pasos) {
    if (!p || !p.action || p.action.tool !== 'agendar_cita') continue;
    // La observacion es lo que devolvio la herramienta: el evento creado,
    // como texto JSON (asi lo entrega n8n) o ya como objeto.
    let obs = p.observation;
    if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
    const lista = Array.isArray(obs) ? obs : (obs && typeof obs === 'object' ? [obs] : []);
    if (!lista.some((ev) => ev && ev.id)) agendarPasosSinId += 1;
    for (const ev of lista) {
      if (!ev || !ev.id) continue;
      eventosCreados.push({
        id: String(ev.id),
        calendario: String((ev.organizer && ev.organizer.email) || ''),
        inicio: String((ev.start && ev.start.dateTime) || ''),
        fin: String((ev.end && ev.end.dateTime) || ''),
        titulo: String(ev.summary || ''),
        // La marca de creacion que puso Google, si vino: con ella el desempate
        // del candado no depende del reloj de n8n.
        ...(ev.created ? { creado: String(ev.created) } : {}),
      });
    }
  }
  const ejecutoAgendar = herramientas.includes('agendar_cita') || herramientaAgendarCorrio;

  // --- LA HERRAMIENTA CORRIO Y NO DEVOLVIO NINGUNA CITA (2026-09-25) --------
  // Cuando `agendar_cita` falla --Google rechaza la creacion, la fecha, un
  // 403--, n8n le entrega al modelo una observacion VACIA (#5553) y el modelo
  // escribe «quedo agendada» igual. `eventosCreados` queda vacio y el candado,
  // que ancla en esos ids, no tenia nada que verificar: fallaba ABIERTO y el
  // texto salia tal cual. Este hecho --la herramienta figura en los pasos y no
  // trajo ningun evento con id-- viaja al candado, que lo cierra. Solo con los
  // pasos a la vista: si el agente no los devolvio (`isExecuted` como respaldo)
  // no se puede afirmar que fallo, y queda como antes.
  const agendarSinEvento = herramientas.includes('agendar_cita') && eventosCreados.length === 0;
  // Lo que la herramienta DEVOLVIO cuando no trajo cita, recortado y en una
  // linea, para el aviso a recepcion (revision de seguridad del 25/09): si un
  // dia n8n cambia la forma de la observacion y una cita real deja de
  // reconocerse, se ve en el primer aviso y no por reclamo. Vacio = «vacia».
  const observacionAgendar = !agendarSinEvento ? '' : pasos
    .filter((p) => p && p.action && p.action.tool === 'agendar_cita')
    .map((p) => (typeof p.observation === 'string' ? p.observation : JSON.stringify(p.observation ?? '')))
    .join(' | ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'vacia';

  // --- NO NEGAR UN SERVICIO QUE NO CONOCE (2026-09-21) -----------------------
  // Dos pruebas seguidas con el telefono: a «¿hacen estetica facial?» el modelo
  // contesto «no realizamos estetica facial; nos enfocamos exclusivamente en
  // odontologia», aunque el prompt ya decia «lo que no sabes, no lo niegues:
  // te asesora una persona». Ninguna fuente dice que no lo hagan, y el logo
  // de la clinica dice «Clinica dental & estetica facial». El prompt no es una
  // barrera: si la respuesta NIEGA un servicio, se reemplaza por la derivacion
  // y se avisa a recepcion, que es quien sabe. Solo las formas de negar un
  // SERVICIO; «no atendemos los domingos» o «no tenemos horario» no entran.
  const NIEGA_SERVICIO = /\bno\s+(realizamos|ofrecemos|brindamos|hacemos|trabajamos|contamos\s+con|damos)\b|\bexclusivamente\s+(en\s+)?(odontolog|dental|estetica\s+dental|est[eé]tica\s+dental)|\bsolo\s+(hacemos|ofrecemos|realizamos|trabajamos)\b/i;
  const negoServicio = !fallo && NIEGA_SERVICIO.test(respuesta.replace(/[*_~]/g, ''));
  if (negoServicio) {
    respuesta = /\busted\b/i.test(String(cfg.tratamiento || ''))
      ? 'Sobre eso le asesora una persona del equipo: ya le paso su consulta y le escribe por acá.'
      : 'Sobre eso te asesora una persona del equipo: ya le paso tu consulta y te escribe por acá.';
    avisos.push('negacion_de_servicio');
  }

  // --- UNA CANCELACION SE AFIRMA SOLO SI GOOGLE LA CONFIRMO (2026-09-20) -----
  // Prueba real con el telefono: el cliente confirmo, el modelo llamo a
  // cancelar_cita con un identificador INVENTADO --la memoria guarda los
  // mensajes, no lo que devuelven las herramientas, y el id real se habia
  // quedado en el turno anterior--, Google contesto «Not Found», y el modelo
  // escribio igual «Listo, la cita quedo cancelada». La cita siguio en la
  // agenda. El prompt ya decia «si cancelar_cita falla, di que no se pudo»:
  // el prompt no es una barrera (CLAUDE.md), asi que se decide aca, por lo
  // que la herramienta DEVOLVIO. Borrar un evento en Google devuelve
  // `{ success: true }`; cualquier otra cosa --vacio, error, otra forma-- es
  // una cancelacion que no se puede afirmar. Falla CERRADA: en el peor caso,
  // recepcion confirma una cancelacion que si ocurrio.
  const canceloBien = (obs) => {
    let o = obs;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return false; } }
    const lista = Array.isArray(o) ? o : [o];
    return lista.length > 0 && lista.every((x) => x && x.success === true);
  };
  const pasosCancelar = pasos.filter((p) => p && p.action && p.action.tool === 'cancelar_cita');

  // --- SIN CONFIRMACION NO SE CANCELA (Andres, 21/09/2026, opcion 2) --------
  // El modelo cancelo dos veces en el mismo mensaje en que se lo pidieron
  // («quiero cancelar la cita», «quiero cancelar la de las 11»), con el prompt
  // diciendo que primero la muestre y pida confirmacion. Ahora la compuerta
  // esta en la herramienta: si el mensaje del cliente no confirma, cancelar_cita
  // recibe un identificador que no existe y Google no borra nada. Aca se
  // reemplaza lo que haya escrito el modelo por la pregunta, con la cita que
  // se busco en este mismo turno. La MISMA expresion regular esta en
  // `cancelar_cita`: una prueba exige que sean identicas. Termina con
  // `(?![a-z…])` y NO con `\b`: en JavaScript `\b` no ve la «í» como letra,
  // y «Sí» con tilde —la respuesta mas comun— no se reconocia.
  //
  // «SI QUIERO REAGENDAR» ES UNA CONFIRMACION (24/09/2026, ejecucion #5553 de
  // Bellido). El asistente pregunto «¿me confirmas que quieres reagendar esa
  // cita?», la paciente contesto «Si quiero reagendar», y la lista no tenia
  // «reagendar»: la herramienta recibio SIN-CONFIRMAR, Google no borro nada,
  // el modelo dijo «he cancelado» y esta compuerta lo reemplazo por la pregunta
  // otra vez. Resultado: un mensaje pagado de mas, seco, y las opciones de
  // horario recien en el siguiente. Se aceptan las formas de mover, cambiar,
  // reprogramar y reagendar, y las palabras «fecha», «hora», «horario» y «dia»
  // que las acompañan. Lo que sigue SIN entrar es lo del #4034: una respuesta
  // que nombra OTRA cita («la de las 16», «la del lunes», «la otra») no es una
  // confirmacion de la que se mostro.
  const CONFIRMA_CANCELAR = /^[^a-záéíóúñ0-9]*(s[ií]|dale|confirmo|confirmado|correcto|exacto|as[ií] es|ok|okay|okey|de acuerdo|claro|adelante|hazlo|procede|canc[eé]lal[ao]|mu[eé]vel[ao]|c[aá]mbial[ao]|reprogr[aá]mal[ao]|reag[eé]ndal[ao]|por favor)(?![a-záéíóúñ])(?:[^a-záéíóúñ0-9]+(?:s[ií]|sip|dale|confirm[a-záéíóúñ]*|correcto|exacto|as[ií]|es|ok|okay|okey|de|acuerdo|claro|adelante|hazlo|procede|canc[eé]l[a-záéíóúñ]*|anul[a-záéíóúñ]*|reag[eé]nd[a-záéíóúñ]*|reprogr[aá]m[a-záéíóúñ]*|mov[a-záéíóúñ]*|mu[eé]v[a-záéíóúñ]*|cambi[a-záéíóúñ]*|c[aá]mbi[a-záéíóúñ]*|fecha|hora|horario|d[ií]a|quiero|la|lo|esa|ese|esta|misma|mismo|por|favor|porfa|porfavor|gracias|muchas|ya|y|listo|perfecto|bueno|nom[aá]s|seguro|pues|entonces)(?![a-záéíóúñ]))*[^a-záéíóúñ0-9]*$/i;
  const textoCliente = String(ent.userInput || '').replace(/^\(audio transcripto\)\s*/i, '').split('\n')[0];
  // --- EL ID DE LA CITA QUE SE MOSTRO, GUARDADO POR TELEFONO (26/09/2026) ---
  // Ejecuciones #6086 y #6091 del Demo A: la compuerta de abajo pregunto
  // «¿confirmas que quieres cancelar tu cita de corte de las 10:00?», el
  // cliente dijo «si», y el modelo llamo a cancelar_cita con el id de OTRA cita
  // (la manicure de las 11:00) y escribio «he cancelado tu manicure». La
  // memoria del agente guarda mensajes, no lo que devolvieron las herramientas:
  // en el turno siguiente el id es lo que el modelo reconstruya. Por eso el id
  // de la cita que se mostro se guarda ACA, por telefono y por 30 minutos, en
  // los datos estaticos del flujo; `Config del negocio` lo expone en el turno
  // siguiente y `cancelar_cita` lo usa cuando el cliente confirma, en vez del
  // que el modelo elija. Barrera por hecho, no por prompt. Sin datos estaticos
  // (pruebas sin ese global) no se guarda nada y todo sigue como hasta hoy.
  const pendientesDeCancelar = (() => {
    try {
      const sd = $getWorkflowStaticData('global');
      sd.cancelacionesPendientes = (sd.cancelacionesPendientes && typeof sd.cancelacionesPendientes === 'object')
        ? sd.cancelacionesPendientes : {};
      return sd.cancelacionesPendientes;
    } catch (e) { return null; }
  })();
  const telefonoDelCliente = String(ent.from || '');
  // Como se describe una cita en la pregunta: «de corte del sabado, 26 de
  // septiembre a las 10:00». Es lo que el cliente lee, y lo que se guarda con
  // el id para que la pregunta siguiente pueda nombrar lo que va a cancelar.
  const describirCita = (cita) => {
    if (!cita) return '';
    const serv = (String(cita.summary || '').split('—')[1] || '').trim().replace(/-/g, ' ');
    let cuando = '';
    try {
      const d = new Date(cita.start && cita.start.dateTime);
      cuando = d.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' })
        + ' a las ' + d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
    } catch (e) { cuando = ''; }
    return (serv ? ' de ' + serv : '') + (cuando ? ' del ' + cuando : '');
  };
  // El registro de este telefono: el pendiente (la cita que se mostro al pedir
  // confirmacion) y los CANDIDATOS (todo lo que buscar_mi_cita le devolvio en
  // los ultimos 30 minutos, id y descripcion). Los candidatos son lo unico que
  // el cliente pudo haber visto: la herramienta rechaza cancelar otra cosa.
  const registroDe = () => (pendientesDeCancelar && telefonoDelCliente)
    ? (pendientesDeCancelar[telefonoDelCliente] = pendientesDeCancelar[telefonoDelCliente] || { eventoId: '', desc: '', desde: 0, candidatos: {} })
    : null;
  let guardoPendiente = false;
  const guardarPendiente = (id, desc) => {
    const r = registroDe();
    if (r && id) {
      r.eventoId = String(id).slice(0, 200); r.desc = String(desc || '').slice(0, 160); r.desde = Date.now();
      guardoPendiente = true;
    }
  };
  const olvidarPendiente = () => { const r = registroDe(); if (r) { r.eventoId = ''; r.desc = ''; } };
  const citasBuscadas = () => {
    const vistas = [];
    for (const p of pasos) {
      if (!p || !p.action || p.action.tool !== 'buscar_mi_cita') continue;
      let obs = p.observation;
      if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
      for (const ev of (Array.isArray(obs) ? obs : [])) {
        if (ev && ev.id && !vistas.some((v) => v.id === String(ev.id))) vistas.push({ id: String(ev.id), desc: describirCita(ev) });
      }
    }
    return vistas;
  };
  // Todo lo que buscar_mi_cita devolvio en este turno queda como candidato, con
  // su descripcion, por 30 minutos: hasta diez, que es mas de lo que un cliente
  // tiene por delante.
  const vistasEsteTurno = citasBuscadas();
  if (vistasEsteTurno.length) {
    const r = registroDe();
    if (r) {
      r.candidatos = (r.candidatos && typeof r.candidatos === 'object') ? r.candidatos : {};
      for (const v of vistasEsteTurno) r.candidatos[v.id.slice(0, 200)] = String(v.desc).slice(0, 160);
      const ids = Object.keys(r.candidatos);
      for (const id of ids.slice(0, Math.max(0, ids.length - 10))) delete r.candidatos[id];
      r.desde = Date.now();
    }
  }

  const cancelacionSinConfirmar = pasosCancelar.length > 0 && !CONFIRMA_CANCELAR.test(textoCliente);
  const cancelacionFallida = !cancelacionSinConfirmar && pasosCancelar.length > 0
    && pasosCancelar.some((p) => !canceloBien(p.observation));
  if (cancelacionSinConfirmar && !fallo) {
    const pedida = String((pasosCancelar[0].action.toolInput || {}).eventoId || '');
    const vista = vistasEsteTurno.find((v) => v.id === pedida) || null;
    const registro = registroDe();
    const candidatos = (registro && registro.candidatos && typeof registro.candidatos === 'object') ? registro.candidatos : {};
    let desc = '';
    // LA PREGUNTA NOMBRA SIEMPRE LO QUE SE VA A CANCELAR (revision de seguridad
    // del 26/09). Tres casos, en orden:
    //   1. el modelo busco en este turno y pidio una de las que encontro: esa;
    //   2. no busco, pero pidio una que el cliente YA VIO en los ultimos 30
    //      minutos (candidatos): esa. Es «no, mejor la de las 11» sin volver a
    //      buscar, y el pendiente viejo NO se queda pegado;
    //   3. pidio algo que nadie vio: si habia un pendiente, la pregunta nombra
    //      ESE (es lo que el «si» va a cancelar); si no, se olvida todo y la
    //      pregunta sale sin cita, y el «si» siguiente tampoco cancela nada que
    //      no se haya mostrado (la herramienta lo rechaza).
    if (vista) {
      desc = vista.desc;
      guardarPendiente(vista.id, desc);
    } else if (pedida && Object.prototype.hasOwnProperty.call(candidatos, pedida)) {
      desc = String(candidatos[pedida] || '');
      guardarPendiente(pedida, desc);
    } else if (registro && registro.eventoId) {
      desc = String(registro.desc || '');
      // La pregunta nombra ESE pendiente: sigue vigente para el «si» siguiente.
      guardoPendiente = true;
    } else {
      olvidarPendiente();
    }
    // SI VINO A MOVER LA CITA, LA PREGUNTA LO DICE (Andres, 24/09/2026): «primero
    // tienes que cancelar» sin ofrecer nada suena a tramite, y la persona
    // escribio para conseguir OTRO horario, no para perder el suyo. El horario
    // nuevo lo ofrece el turno siguiente, cuando la cancelacion ya es un hecho
    // (regla 4b.5 del prompt: primero cancelar, despues agendar).
    const quiereMover = /reagend|reprogram|\bmov[eé]r|mu[eé]v[ae]|cambi/i.test(textoCliente);
    const deUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
    respuesta = deUsted
      ? (quiereMover
        ? `Para moverla necesito que me confirme: ¿cancelo su cita${desc}? Respóndame «sí» y la cancelo para darle otro horario.`
        : `¿Confirma que quiere cancelar su cita${desc}? Respóndame «sí» y la cancelo.`)
      : (quiereMover
        ? `Para moverla necesito que me confirmes: ¿cancelo tu cita${desc}? Respóndeme «sí» y la cancelo para darte otro horario.`
        : `¿Confirmas que quieres cancelar tu cita${desc}? Respóndeme «sí» y la cancelo.`);
    avisos.push('cancelacion_sin_confirmar');
  }
  // Cuando el MODELO pide la confirmacion por su cuenta (sin llamar a la
  // herramienta) y en este turno busco y encontro UNA sola cita, esa es la que
  // se mostro: queda guardada igual. Con varias no se adivina cual.
  // Tambien cuando pregunta por MOVERLA (#7655 de Bellido, 28/09: «¿Confirmas
  // que es esa la cita que deseas cambiar?»): el «si» siguiente es para esa.
  if (!fallo && pasosCancelar.length === 0 && /cancel|cambi|mover|mu[eé]v|reagend|reprogram/i.test(respuesta) && /\?/.test(respuesta)) {
    if (vistasEsteTurno.length === 1) guardarPendiente(vistasEsteTurno[0].id, vistasEsteTurno[0].desc);
  }

  // --- UNA CITA PAGADA QUE SE CANCELA (2026-09-21) ---------------------------
  // Prueba con el telefono: el paciente pago la seña y enseguida cancelo; el
  // asistente contesto «listo, quedo cancelada» y nadie se entero de que habia
  // un adelanto de por medio. Con la seña activa, toda cita nace con el rotulo
  // «PENDIENTE DE SEÑA» y lo pierde solo cuando el comprobante cuadra: una cita
  // SIN el rotulo que se cancela es una cita pagada (o cargada a mano por la
  // clinica). Lo que se haga con el adelanto lo decide el negocio; lo que no
  // puede pasar es que nadie lo sepa.
  const idsCancelados = new Set(pasosCancelar.filter((p) => canceloBien(p.observation))
    .map((p) => String((p.action.toolInput && p.action.toolInput.eventoId) || '')).filter(Boolean));
  // LO QUE SE CANCELO EN ESTE TURNO, con su descripcion (revision de seguridad
  // del PR #244): si en el mismo turno se cancela la cita vieja y la nueva se
  // deshace por falta de confirmacion, el paciente se queda SIN cita. El
  // mensaje de `Comprobar reserva` tiene que decirle que la vieja ya no esta.
  // La descripcion sale de lo que buscar_mi_cita mostro (este turno o los
  // candidatos guardados), antes de olvidar el registro.
  const canceladasEnElTurno = (() => {
    if (!idsCancelados.size) return [];
    const reg = (pendientesDeCancelar && telefonoDelCliente && pendientesDeCancelar[telefonoDelCliente]) || null;
    const cand = (reg && reg.candidatos && typeof reg.candidatos === 'object') ? reg.candidatos : {};
    return [...idsCancelados].map((id) => {
      const vista = vistasEsteTurno.find((v) => v.id === id);
      const desc = vista ? vista.desc
        : (Object.prototype.hasOwnProperty.call(cand, id) ? String(cand[id] || '')
          : (reg && reg.eventoId === id ? String(reg.desc || '') : ''));
      return { id: id.slice(0, 200), desc: String(desc).slice(0, 160) };
    });
  })();
  // Cancelada de verdad: el pendiente y los candidatos de este telefono ya no
  // sirven (la cita cancelada no vuelve a mostrarse; las otras, cuando las
  // vuelva a buscar).
  if (idsCancelados.size && pendientesDeCancelar && telefonoDelCliente) delete pendientesDeCancelar[telefonoDelCliente];
  // --- LA FALLA DEL MODELO NO ESCONDE UNA CANCELACION (Bellido, 28/09, #7659) -
  // La paciente confirmo mover su cita («Si»), `cancelar_cita` la BORRO y la
  // llamada siguiente del modelo revento («Received tool input did not match
  // expected schema», le falto `servicio`). Con el error n8n pierde los pasos
  // del agente: este nodo no ve la cancelacion, y salio «tuve un problema
  // tecnico, ¿me repites lo ultimo?». La paciente se quedo sin cita y nadie lo
  // supo. Si el modelo fallo y el mensaje CONFIRMA una cancelacion pendiente
  // (la compuerta de `cancelar_cita` ya dejo pasar el id guardado), la cita
  // pudo quedar borrada: se le dice eso y pasa a recepcion, que revisa la
  // agenda. Falla CERRADA: en el peor caso recepcion confirma una cita que
  // seguia en pie.
  // Cuenta el pendiente (la cita que se mostro) y tambien los candidatos: en
  // el #7659 no habia pendiente y la compuerta dejo pasar el id del modelo
  // porque era uno de los que buscar_mi_cita le habia mostrado.
  const regCancelacion = pendientesDeCancelar && telefonoDelCliente ? pendientesDeCancelar[telefonoDelCliente] : null;
  const candidatosIncierta = (regCancelacion && regCancelacion.candidatos && typeof regCancelacion.candidatos === 'object')
    ? Object.values(regCancelacion.candidatos) : [];
  // POR HECHO (revision de seguridad del #275): lo decide si `cancelar_cita`
  // CORRIO en el turno. Por registro y texto fallaba en los dos sentidos: un
  // «sí» a otra cosa con un 503 transferia de mas, y una cancelacion sin
  // registro previo (busco y cancelo en el mismo turno) volvia a esconderse.
  // El registro queda solo para nombrar la cita, y como respaldo si la
  // referencia a la herramienta no se puede leer.
  const regVigente = !!regCancelacion && Date.now() - Number(regCancelacion.desde || 0) < 30 * 60 * 1000;
  const porRegistro = regVigente && (!!regCancelacion.eventoId || candidatosIncierta.length > 0)
    && CONFIRMA_CANCELAR.test(textoCliente);
  const cancelacionIncierta = fallo && (herramientaCancelarCorrio === null ? porRegistro : herramientaCancelarCorrio);
  const descIncierta = !cancelacionIncierta || !regVigente ? ''
    : String(regCancelacion.eventoId ? (regCancelacion.desc || '') : (candidatosIncierta.length === 1 ? candidatosIncierta[0] : '')).slice(0, 160);
  if (cancelacionIncierta) {
    avisos.push('cancelacion_incierta');
    respuesta = /\busted\b/i.test(String(cfg.tratamiento || ''))
      ? `Tuve un problema técnico mientras gestionaba su cita${descIncierta}, y puede que ya haya quedado cancelada. Le paso con recepción para que la revisen y se la confirmen.`
      : `Tuve un problema técnico mientras gestionaba tu cita${descIncierta}, y puede que ya haya quedado cancelada. Te paso con recepción para que la revisen y te la confirmen.`;
  }
  // EL PENDIENTE SE USA UNA SOLA VEZ (revision de seguridad del #275): vale
  // para el «si» del turno siguiente al que lo guardo. Un turno que no lo
  // vuelve a guardar lo olvida: si no, «¿deseas cambiarla?» sobre la cita del
  // lunes dejaba ese id pegado, y un «si» a «¿cancelo la del martes?» —con dos
  // citas encontradas, que no guarda nada— borraba la del lunes. La lectura
  // de arriba (cancelacion incierta) ya se hizo. Tras una falla del modelo se
  // conserva: el cliente va a repetir lo ultimo.
  if (!fallo && !guardoPendiente && regCancelacion && regCancelacion.eventoId) {
    regCancelacion.eventoId = ''; regCancelacion.desc = '';
  }
  let citaPagadaCancelada = null;
  if (idsCancelados.size && cfg.senaActiva === 'si') {
    for (const p of pasos) {
      if (!p || !p.action || p.action.tool !== 'buscar_mi_cita') continue;
      let obs = p.observation;
      if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
      for (const ev of (Array.isArray(obs) ? obs : [])) {
        if (ev && idsCancelados.has(String(ev.id)) && !/^PENDIENTE DE SEÑA/.test(String(ev.summary || ''))) {
          citaPagadaCancelada = ev;
        }
      }
    }
  }
  // CON ANTICIPACION, EL ADELANTO QUEDA A FAVOR (Andres, 21/09/2026): siete dias
  // para reagendar sin pagar otra seña, si se cancelo con al menos dos horas.
  // La regla la aplica el SERVIDOR con el evento `cita_cancelada`; aca se
  // calcula lo mismo solo para decirle al paciente lo que va a pasar. Con
  // menos anticipacion no hay credito automatico: lo decide recepcion.
  const inicioPagada = citaPagadaCancelada ? Date.parse(String((citaPagadaCancelada.start || {}).dateTime || '')) : NaN;
  const conAnticipacion = Number.isFinite(inicioPagada) && inicioPagada - Date.now() >= 2 * 3600 * 1000;
  // EL CREDITO LO DA EL SERVIDOR, Y SOLO POR LA CITA DE SU SEÑA (21/09/2026,
  // #4034). El flujo prometio «el adelanto queda a tu favor» por una cita sin
  // rotulo que NO era la de la seña registrada, y el servidor —que exige esa
  // cita— no dio nada: una promesa que nadie iba a cumplir. Ahora se promete
  // solo si la cita cancelada es la que el servidor tiene como pagada; si no,
  // lo coordina recepcion (aviso + boton).
  const esLaCitaDeLaSena = !!citaPagadaCancelada && String(cfg.senaEventoId || '') !== ''
    && String(cfg.senaEventoId) === String(citaPagadaCancelada.id) && cfg.senaPendiente !== 'si';
  const adelantoAFavor = !!citaPagadaCancelada && !cancelacionFallida && conAnticipacion && esLaCitaDeLaSena;
  const usted = /\busted\b/i.test(String(cfg.tratamiento || ''));
  if (adelantoAFavor) {
    respuesta = respuesta.trim() + (usted
      ? '\n\nEl adelanto que pagó queda a su favor por 7 días: si reagenda en ese plazo, no paga otra seña.'
      : '\n\nEl adelanto que pagaste queda a tu favor por 7 días: si reagendas en ese plazo, no pagas otra seña.');
  } else if (citaPagadaCancelada && !cancelacionFallida) {
    respuesta = respuesta.trim() + (usted
      ? '\n\nSobre el adelanto que pagó, le escribe recepción.'
      : '\n\nSobre el adelanto que pagaste, te escribe recepción.');
  }
  if (cancelacionFallida && !fallo) {
    respuesta = 'No pude cancelar la cita en la agenda en este momento. Le paso el pedido a recepción '
      + 'para que la cancele y le confirme por este chat.';
    avisos.push('cancelacion_no_confirmada');
  }
  // --- LAS HORAS QUE SE OFRECEN SALEN DE LA AGENDA DE ESTE TURNO (27/09/2026) -
  // Tres reclamos de un consultorio real, el mismo dia (ejecuciones #6509 a
  // #6587), con la regla «NUNCA propongas un horario que no hayas verificado
  // con consultar_disponibilidad en ESTE MISMO mensaje» ya publicada:
  //   · #6509, 00:06 de un DOMINGO, con el domingo «cerrado»: «tengo
  //     disponibles hoy domingo 27 los siguientes turnos: 11:00, 11:30 o
  //     12:00», sin haber llamado a consultar_disponibilidad.
  //   · #6555: el paciente pregunto «A las 17 no tiene?» y el turno consulto y
  //     AGENDO las 17:00 sin que nadie lo confirmara.
  //   · #6523, #6527, #6551, #6578, #6583: pidio otra hora, otra franja, «a las
  //     13», «a las 19», y recibio TRES VECES las mismas tres opciones. «Ya me
  //     diste 3 veces los mismos y no quiero».
  // El prompt no es una barrera (CLAUDE.md). Aca se hace cumplir por HECHO:
  //   1. (H1) toda hora que la respuesta ofrece como disponible se comprueba
  //      contra lo que consultar_disponibilidad devolvio EN ESTE TURNO: lo
  //      ocupado, el horario del dia de esa persona (el dia de la semana lo
  //      calcula el codigo), lo que ya paso y la anticipacion minima. La que no
  //      pasa se quita; si no queda ninguna, la respuesta pasa a ser una
  //      pregunta honesta, nunca un horario inventado.
  //   2. (H2) si agendar_cita corrio y el mensaje del paciente NO confirma ese
  //      horario —una pregunta nunca confirma—, `Comprobar reserva` deshace la
  //      cita por la misma via del candado y se le pregunta si la agenda.
  //   3. (M1) si pidio otra hora, una hora concreta o una franja, no se repiten
  //      las opciones que ya se le dieron ese dia.
  // Lo ofrecido y lo elegido se guardan por telefono en los datos estaticos
  // del flujo (como la barrera del #197): la memoria del agente guarda
  // mensajes, no hechos. Sin datos estaticos (pruebas) no se guarda nada.
  const agAhora = Date.now();
  const agHoy = agLaPaz(agAhora).fecha;
  const agNumero = (v, min, max, porDefecto) => {
    const n = Number(v);
    return v !== '' && v !== null && v !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
  };
  // La duracion con la que se juzga si una hora «cabe» y la anticipacion
  // minima: de la configuracion si viene (`Config del negocio`); si no, 30
  // minutos —la cita mas corta de los tres negocios— y ninguna anticipacion
  // mas alla de «no en el pasado». Con una duracion menor que la real el
  // candado sigue siendo la ultima defensa al agendar.
  const agDuracion = agNumero(cfg.duracionPorDefectoMin, 5, 480, 30);
  const agLimite = agAhora + agNumero(cfg.anticipacionMinimaMin, 0, 10080, 0) * 60000;
  let agEquipo = [];
  try { agEquipo = JSON.parse(cfg.funcionarios || '[]'); } catch (e) { agEquipo = []; }
  agEquipo = Array.isArray(agEquipo) ? agEquipo.filter((x) => x && x.nombre) : [];
  const agConsultasTurno = agConsultas(pasos, agEquipo, idsCancelados);
  // El registro de este telefono, por una hora: lo ofrecido por fecha, la
  // ultima oferta (con su fecha) y la hora que el paciente eligio sin que se
  // agendara todavia.
  const AG_VIGENCIA_MS = 60 * 60 * 1000;
  const AG_ELECCION_MS = 30 * 60 * 1000;
  const agRegistros = (() => {
    try {
      const sd = $getWorkflowStaticData('global');
      sd.agendaPorTelefono = (sd.agendaPorTelefono && typeof sd.agendaPorTelefono === 'object') ? sd.agendaPorTelefono : {};
      return sd.agendaPorTelefono;
    } catch (e) { return null; }
  })();
  const agPrevio = (agRegistros && telefonoDelCliente && agRegistros[telefonoDelCliente]
    && agAhora - Number(agRegistros[telefonoDelCliente].desde || 0) < AG_VIGENCIA_MS)
    ? agRegistros[telefonoDelCliente] : null;
  const agVigente = (x, ms) => !!x && typeof x === 'object' && agAhora - Number(x.desde || 0) < ms;
  const agOfrecidosAntes = (fecha) => (agPrevio && agPrevio.ofrecidos && Array.isArray(agPrevio.ofrecidos[fecha]))
    ? agPrevio.ofrecidos[fecha].filter((m) => Number.isFinite(m)) : [];
  const agUltima = agPrevio && agVigente(agPrevio.ultima, AG_VIGENCIA_MS) && Array.isArray(agPrevio.ultima.mins)
    ? agPrevio.ultima : null;
  const agElegido = agPrevio && agVigente(agPrevio.elegido, AG_ELECCION_MS) ? agPrevio.elegido : null;
  // Se lee ANTES de que este turno escriba el registro (es el mismo objeto).
  const agSinNombreAntes = Number((agPrevio && agPrevio.sinNombreSeguidos) || 0);

  // LO QUE ESCRIBIO EL PACIENTE, leido por codigo. Una pregunta nunca confirma:
  // «¿a las 17 no tiene?», «tienes a las 13», «hay a las 10?».
  // SOLO LO QUE EL CLIENTE TECLEO O DICTO (revision de seguridad de ca88ced):
  // el texto, la transcripcion del audio y el titulo de la opcion interactiva
  // que eligio. `userInput` trae ademas texto del SISTEMA —«(imagen) el
  // cliente envio una foto», «AVISO_SISTEMA: …», el envoltorio «El cliente
  // toco el boton:»— y esas palabras no pueden pasar por un nombre dicho ni
  // por una hora elegida. La transcripcion no esta en `Normalizar entrada`
  // (ahi solo dice «(audio) …»): la trae `Preparar transcripcion`.
  const agCliente = (() => {
    let crudo = String(ent.userInput || '');
    if (/^\s*\(audio\)/i.test(crudo)) {
      try { crudo = String(($('Preparar transcripción').first().json || {}).userInput || ''); } catch (e) { crudo = ''; }
    }
    const quedan = [];
    for (const linea of crudo.split('\n')) {
      let t = linea.trim();
      if (!t || /^AVISO_SISTEMA\b/i.test(t) || /^\((audio|imagen|documento)\)/i.test(t)) continue;
      t = t.replace(/^\(audio transcripto\)\s*/i, '');
      const menu = /^El cliente seleccionó la opción del menú:\s*(.*?)\s*\(id:[^)]*\)\s*$/i.exec(t);
      if (menu) t = menu[1];
      t = t.replace(/^El cliente tocó el botón:\s*/i, '');
      if (t.trim()) quedan.push(t.trim());
    }
    return quedan.join('\n');
  })();
  const agClientePlano = agSinTilde(agCliente);
  // Sin signos (un audio transcripto no los trae), un verbo de pregunta sin
  // ningun verbo de pedir o confirmar tambien es pregunta: «y a las 5 de la
  // tarde tendra». Ante la duda se pregunta: cuesta un turno, no una cita.
  //
  // PERO SOLO LA PREGUNTA QUE HABLA DE LA HORA (revision de seguridad del PR
  // #244). «Sí, la de 11:30. ¿Tengo que llevar algo?» y «Sí, perfecto. ¿Hay
  // estacionamiento?» confirman, y la pregunta de despues es otra cosa: con la
  // regla anterior se deshacia una cita confirmada. Ahora: si el mensaje EMPIEZA
  // confirmando («si,», «ok», «perfecto», «la segunda»), no es pregunta; si no,
  // cuenta como pregunta solo la oracion que nombra una hora o una
  // disponibilidad. «si tiene a las 17?» sigue siendo pregunta: ese «si» es
  // condicional, no una confirmacion.
  const agEmpiezaConfirmando = /^\s*((si|sip)\s*([,.!;:]|$|\s+(ok|dale|perfecto|listo|claro|por\s+favor|gracias|la|el|esa|ese|a\s+las)\b)|(ok|okay|okey|oki|dale|listo|perfecto|confirmo|confirmado|de\s+acuerdo|claro|correcto|exacto|vale|genial|excelente)\b|(la|el)\s+(primer[oa]|segund[oa]|tercer[oa]|ultim[oa])\b)/.test(agClientePlano);
  const AG_HABLA_DE_HORA = /disponib|libre|espacio|lugar|cupo|turno|horario|\bhora\b/;
  const agOracionPregunta = (o) => {
    const plano = agSinTilde(o);
    const pideOConfirma = /\b(quiero|prefiero|agend|reserv|dame|ponme|anotame|confirmo|me\s+quedo)/.test(plano);
    return /[?¿]/.test(o)
      || /^\s*(y\s+)?(a\s+las?\s+\d{1,2}([:.]\d{2})?\s+)?(no\s+)?(tiene[sn]?|tendr[a-z]*|hay|habr[a-z]*|puede[sn]?|podr[a-z]*|sera|esta\s+libre|queda[sn]?|existe)\b/.test(plano)
      || (!pideOConfirma && /\b(tiene[sn]?|tendr(a|as|an|ia|ian)|hay|habra|habria|podr(a|as|ia|ian)|sera|estara|esta\s+libre)\b/.test(plano));
  };
  const agPregunta = !agEmpiezaConfirmando && agCliente.split(/(?<=[.!?])\s+|\n+|(?=¿)/)
    .map((o) => o.trim()).filter(Boolean)
    .some((o) => (agHorasDelTexto(o).length > 0 || AG_HABLA_DE_HORA.test(agSinTilde(o))) && agOracionPregunta(o));
  const agNiega = /^\s*no\b(?!\s+(tiene|tienes|tienen|hay|habra))|\bmejor\s+(no|otr)|\bno\s+(quiero|puedo|me\s+(sirve|sirven|queda|conviene|viene))/.test(agClientePlano);
  const agFechaCliente = agFechaDelTexto(agCliente, agHoy);
  // «La primera», «la segunda», «la tercera», «la última»: la hora que ocupa
  // ese lugar en la ULTIMA oferta. Cuenta como nombrarla (revision del #244).
  const agHorasCliente = (() => {
    const nombradas = agHorasDelTexto(agCliente);
    if (nombradas.length || !agUltima || !agUltima.mins.length) return nombradas;
    const ord = /\b(?:la|el)\s+(primer[oa]|segund[oa]|tercer[oa]|ultim[oa])\b/.exec(agClientePlano);
    if (!ord) return nombradas;
    const lugar = /^primer/.test(ord[1]) ? 0 : (/^segund/.test(ord[1]) ? 1 : (/^tercer/.test(ord[1]) ? 2 : agUltima.mins.length - 1));
    const min = agUltima.mins[lugar];
    return Number.isFinite(min) ? [{ min, ambigua: false, ordinal: true }] : nombradas;
  })();
  // Un ordinal no trae fecha: es la de la ultima oferta.
  const agFechaDeLaHora = agFechaCliente || (agHorasCliente.some((h) => h.ordinal) && agUltima ? agUltima.fecha : '');
  const AG_CONFIRMA = /^\s*(si|sip|ok|okay|okey|oki|dale|listo|perfecto|confirmo|confirmado|de\s+acuerdo|claro|correcto|exacto|vale|bueno|genial|excelente|ese|esa|esta|este|la\s+primera|la\s+segunda|la\s+tercera|la\s+ultima|por\s+favor)\b|\b(agend(a|ame|ala|alo|amela|amelo|eme|ar)|reserv(a|ame|ala|alo|amela|amelo)|anota(me|la|lo)|confirm(o|ada|ado|amos)|me\s+quedo\s+con|quiero\s+(esa|ese|esta|este|la|el)\b|prefiero|dame|pon(me|la|lo))\b/;
  // «YA» ES UN «SI» EN BOLIVIA (bateria de Bellido del 29/09, casos N1 a N4):
  // «ya», «ya pues», «yaa», «ya esta», «de una», «va» y «asi es» confirman la
  // hora que se ofrecio, pero AG_CONFIRMA no los conocia y el candado deshacia
  // la cita como `sin_confirmar`. Va aparte y ANCLADO AL MENSAJE ENTERO, porque
  // «ya» al principio de una frase casi nunca confirma («ya te dije 10 de
  // octubre», «ya tengo cita», «ya no puedo», «ya pues, quiero otra hora»): solo
  // vale cuando lo unico que el cliente dijo es la afirmacion, con a lo sumo un
  // relleno («ya pues, esa nomas»). Un signo de pregunta, una hora, una franja
  // o cualquier otra palabra la descartan; ademas siguen mandando `agPregunta`,
  // `agNiega`, `agPideOtra` y `agFranja`, como con cualquier confirmacion.
  const AG_CONFIRMA_YA = /^\s*(ya+|ya\s+pues|ya\s+esta|ya\s+dale|dale\s+ya|de\s+una|va|va\s+pues|asi\s+es|ya\s+ya)(?:[\s,.;!]+(?:pues|nomas|esa|ese|esa\s+hora|ese\s+horario|listo|ok|okay|dale|por\s+favor|porfa|porfavor|perfecto)){0,4}[\s.!]*$/;
  // (revision de seguridad del #284) SIN repeticiones solapadas —«esa nomas»
  // se leia como una alternativa o como dos y el tiempo crecia como 2^n con un
  // mensaje de WhatsApp de unos 250 caracteres— y con el largo acotado: una
  // afirmacion asi nunca pasa de unas pocas palabras. Tampoco entran «no mas»
  // ni «gracias»: «ya no mas» y «ya, gracias» suelen ser un rechazo cortes.
  const agConfirmaPalabra = AG_CONFIRMA.test(agClientePlano) || (agClientePlano.length <= 60 && AG_CONFIRMA_YA.test(agClientePlano));
  // FRANJA u OTRA HORA: lo que el paciente pidio cuando no quiere lo ofrecido.
  // «La tarde» empieza a las 13:00 (decision de Andres, 27/09/2026): el
  // mediodia no es lo que pide quien dice «¿en la tarde?».
  const AG_TARDE_DESDE_MIN = 13 * 60;
  const agFranja = (() => {
    if (/\b(en|por|para)\s+la\s+tarde\b|\bde\s+tarde\b|\bla\s+tarde\b/.test(agClientePlano)) return { desde: AG_TARDE_DESDE_MIN, hasta: 1440, nombre: 'en la tarde' };
    if (/\b(en|por|para)\s+la\s+manana\b|\bde\s+manana\b|\btemprano\b/.test(agClientePlano)) return { desde: 0, hasta: 12 * 60, nombre: 'en la mañana' };
    if (/\b(en|por|para)\s+la\s+noche\b/.test(agClientePlano)) return { desde: 18 * 60, hasta: 1440, nombre: 'en la noche' };
    const tras = /\bdespues\s+de\s+(las?\s+)?(\d{1,2})/.exec(agClientePlano);
    if (tras) { const h = Number(tras[2]); const m = (h >= 1 && h <= 7 ? h + 12 : h) * 60; return { desde: m, hasta: 1440, nombre: 'después de las ' + agHora(m) }; }
    const antes = /\bantes\s+de\s+(las?\s+)?(\d{1,2})/.exec(agClientePlano);
    if (antes) { const h = Number(antes[2]); const m = (h >= 1 && h <= 7 ? h + 12 : h) * 60; return { desde: 0, hasta: m, nombre: 'antes de las ' + agHora(m) }; }
    return null;
  })();
  const agPideOtra = /\botr[oa]s?\s+(hora|horas|horario|horarios|turno|turnos|opcion|opciones)\b|\bmas\s+(horarios|opciones|horas|turnos)\b|\bningun[oa]?\s+(me\s+)?(sirve|queda|conviene)|\bno\s+me\s+(sirve|sirven|queda|quedan|conviene|vienen?|acomoda)|\blos\s+mismos\b|\bya\s+me\s+(diste|dijiste|pasaste)|\bque\s+otr/.test(agClientePlano);

  // --- H2: AGENDAR EXIGE HORA ELEGIDA Y NOMBRE DICHO POR EL CLIENTE ---------
  // Regla de Andres (27/09/2026), textual: «La confirmacion debe ser estricta
  // cuando el asistente tenga los datos del nombre y horario elegido, es decir
  // NO AGENDAR cuando consulta sobre horarios o solamente indica el nombre sin
  // el horario; el nombre es independiente del horario. Si el asistente
  // propone un conjunto de horarios y el cliente indica alguno de ellos, se
  // confirma (sabiendo el nombre previamente). Si el agente indica solo un
  // horario, el cliente debe indicar aceptacion y se agenda (sabiendo el
  // nombre previamente). No debe ser una confusion.»
  //
  // Una cita que agendar_cita creo en este turno queda en pie SOLO con las dos:
  //   (a) HORA ELEGIDA por el cliente: nombro una de las horas que se le
  //       ofrecieron (o un ordinal: «la segunda»), o dijo que si a una oferta
  //       de UNA sola hora; en este turno o en uno anterior (`elegido`). Una
  //       pregunta sobre horarios nunca elige. Una hora que nadie le ofrecio
  //       tampoco: primero se le dice si hay («¿Te la agendo?»).
  //   (b) NOMBRE DEL PACIENTE dicho por el cliente, en este turno o antes: el
  //       nombre del titulo de la cita tiene que estar, palabra por palabra, en
  //       lo que el cliente escribio. Ni inventado por el modelo ni sacado del
  //       perfil de WhatsApp. El nombre solo no elige hora, y la hora sola no
  //       da el nombre.
  // Sin (a) la cita se deshace como `sin_confirmar`; con (a) y sin (b), como
  // `sin_nombre`, y se le pide solo el nombre: la hora queda elegida.
  const AG_PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'dos', 'das', 'cita']);
  const agPalabrasDe = (t) => agSinTilde(t).split(/[^a-zñ]+/).filter((w) => w.length >= 2 && !AG_PARTICULAS.has(w));
  // Lo que el cliente escribio en la ultima hora, como palabras sueltas: es de
  // donde sale el nombre dicho «antes». Tope de 80 palabras.
  const agPalabrasCliente = new Set([...(agPrevio && Array.isArray(agPrevio.palabras) ? agPrevio.palabras : []),
    ...agPalabrasDe(agCliente)]);
  // EL NOMBRE DEL TITULO, ANCLADO (revision de seguridad de ca88ced): «Cita
  // <nombre> — <servicio>» empieza con «Cita» (despues del rotulo de la seña,
  // si lo hay) y el nombre termina en el primer guion, tenga o no espacio
  // delante. Sin anclar, «Cita — Consulta» daba el nombre «— Consulta».
  const agNombreDelTitulo = (titulo) => {
    const t = String(titulo || '').replace(/^\s*PENDIENTE DE SEÑA\s*·\s*/i, '');
    const m = /^\s*Cita\s*:?\s*([^—–-]*)/i.exec(t);
    // La marca del tipo de cita que el doctor pone al lado del nombre —«Cita Pedro (CNS)
    // — …», «(RN)»: control del nino sano y recien nacido, 29/09/2026— no es parte del
    // nombre: sin quitarla, el mensaje al paciente la tomaba por una palabra de mas.
    return m ? m[1].replace(/\(\s*(?:CNS|RN)\s*\)/gi, ' ').replace(/\s+/g, ' ').trim() : '';
  };
  // Palabras que NO son un nombre: las de los servicios del catalogo, las de
  // quienes atienden, y las genericas. «Cita Consulta — consulta» con un
  // cliente que escribio «quiero una consulta» no es un nombre dicho.
  // Palabras GENERICAS: no son un nombre en ningun negocio. Incluye las
  // funcionales y temporales (revision de 98796fd): «quiero una cita con la
  // doctora» no puede volver «Cita con Lucas» un nombre dicho, ni «es la primera
  // vez» a «Cita primera vez».
  const AG_GENERICAS = new Set(['cita', 'citas', 'consulta', 'consultas', 'control', 'controles', 'cliente', 'clienta',
    'paciente', 'bebe', 'bebito', 'bebita', 'nino', 'nina', 'ninos', 'ninas', 'hijo', 'hija', 'hijos', 'hijas', 'hijito', 'hijita',
    'senor', 'senora', 'senorita', 'sr', 'sra', 'don', 'dona', 'mama', 'papa', 'mi', 'su', 'tu', 'para', 'nombre', 'persona',
    'reserva', 'turno', 'servicio', 'recien', 'nacido', 'nacida', 'sano', 'sana', 'nuevo', 'nueva', 'dr', 'dra', 'doctor', 'doctora',
    'con', 'por', 'un', 'una', 'uno', 'unos', 'unas', 'al', 'que', 'es', 'primera', 'primer', 'primero', 'vez', 'urgente', 'urgencia',
    'hoy', 'manana', 'tarde', 'noche', 'general', 'revision', 'hora', 'horas', 'favor', 'quiero', 'queria', 'hola', 'buenas',
    'buenos', 'dias', 'gracias', 'si', 'no', 'ok', 'medico', 'medica', 'pediatra', 'especialista', 'atencion', 'agenda',
    // Las comunes (revision de f0c6957): «esta bien», «disponible», «reservar».
    'necesito', 'reservar', 'agendar', 'puedo', 'puede', 'tiene', 'tienes', 'hay', 'espacio', 'disponible', 'disponibles',
    'bien', 'esta', 'este', 'esa', 'ese', 'perfecto', 'dale', 'listo', 'bueno', 'claro', 'le', 'lo', 'me', 'te', 'se',
    'en', 'las', 'sip', 'va', 'vale', 'como', 'cuando', 'donde', 'cual', 'eso', 'esto', 'mejor', 'otra', 'otro', 'ya',
    'solo', 'nos', 'mas', 'muy', 'algo', 'todo', 'hacer', 'venir', 'ir', 'ser', 'estar', 'tengo', 'soy', 'llamo', 'seria',
    'sera', 'mismo', 'misma', 'cuanto', 'cuesta', 'precio', 'costo', 'cns', 'rn',
    ...AG_DIAS.map(agSinTilde), ...AG_MESES]);
  // Palabras DEL NEGOCIO: los servicios del catalogo y los nombres y servicios
  // de quienes atienden.
  const AG_DEL_NEGOCIO = new Set([
    ...agPalabrasDe(String(cfg.catalogoConPrecio || '')), ...agPalabrasDe(String(cfg.catalogoSinPrecio || '')),
    ...agEquipo.flatMap((x) => [...agPalabrasDe(x.nombre), ...(Array.isArray(x.servicios) ? x.servicios.flatMap((v) => agPalabrasDe(v)) : [])])]);
  // EL PRIMER NOMBRE ALCANZA (Andres, 27/09/2026): el nombre del titulo vale
  // si su PRIMERA palabra de nombre —la primera que no es generica ni del
  // negocio— la escribio el cliente, sin tildes. «Lucas» dicho y «Lucas
  // Méndez» en el titulo vale; «Lucía» por «Lucas», no. Si el paciente se
  // llama como alguien del equipo o como un servicio (revision de 98796fd), no
  // queda ninguna: se toma la primera que no sea generica, y tambien tiene que
  // haberla dicho. Sin eso se le preguntaba el nombre sin fin.
  const agPrimeraNombre = (titulo) => {
    const palabras = agPalabrasDe(agNombreDelTitulo(titulo)).filter((w) => !AG_GENERICAS.has(w));
    return palabras.find((w) => !AG_DEL_NEGOCIO.has(w)) || palabras[0] || '';
  };
  const agTieneNombre = (titulo) => {
    const primera = agPrimeraNombre(titulo);
    return !!primera && agPalabrasCliente.has(primera);
  };
  // Las horas que este mensaje ELIGE, cada una con su fecha.
  const agOfrecidasEn = (fecha) => Array.from(new Set([
    ...(agUltima && agUltima.fecha === fecha ? agUltima.mins : []), ...agOfrecidosAntes(fecha)]));
  const agElegidasAhora = (() => {
    if (agPregunta || agNiega) return [];
    const elegidas = [];
    for (const h of agHorasCliente) {
      const fechas = agFechaDeLaHora ? [agFechaDeLaHora]
        : (agUltima ? [agUltima.fecha] : Object.keys((agPrevio && agPrevio.ofrecidos) || {}));
      for (const fecha of fechas) {
        const ofrecidas = agOfrecidasEn(fecha);
        const min = ofrecidas.includes(h.min) ? h.min : (h.ambigua && ofrecidas.includes(h.min + 720) ? h.min + 720 : null);
        if (min !== null) { elegidas.push({ fecha, min }); break; }
      }
    }
    if (!agHorasCliente.length && agConfirmaPalabra && agUltima && agUltima.mins.length === 1) {
      elegidas.push({ fecha: agUltima.fecha, min: agUltima.mins[0] });
    }
    // UN «SI» A VARIAS CITAS QUE EL MODELO AGENDO (Bellido, 29/09, #8570 a
    // #8618): una mama pidio citas para sus dos hijos, el modelo agendo las dos
    // horas que acababa de ofrecer, una por nino, y el «Si» las deshizo a las
    // dos —un «si» solo valia para UNA hora—, ocho veces seguidas. Un «si» que
    // cierra una oferta de varias horas confirma el CONJUNTO solo cuando lo que
    // el modelo agendo es EXACTAMENTE ese conjunto: una cita por cada hora
    // ofrecida (ni una mas, ni una hora que nadie ofrecio), de pacientes
    // DISTINTOS, con el nombre de cada uno dicho por el cliente. Ante «cual de
    // estas», el modelo agenda una sola y todo sigue como hasta hoy.
    // (revision de seguridad del #283) Solo si la oferta la marco el CODIGO como
    // conjunto —la pregunta «¿Te las agendo?» de `Comprobar reserva`—, no cualquier
    // oferta de dos horas («¿16:00 o 16:30?» son alternativas); el paciente se
    // distingue por su primera palabra de nombre, no por el titulo entero; y si el
    // cliente pide otras horas o una franja, no confirmo nada.
    if (!agHorasCliente.length && agConfirmaPalabra && !agPideOtra && !agFranja && agUltima && agUltima.conjunto === true
      && agUltima.mins.length >= 2 && agUltima.mins.length <= 4 && eventosCreados.length === agUltima.mins.length) {
      const inicios = eventosCreados.map((ev) => Date.parse(ev.inicio)).filter(Number.isFinite).map(agLaPaz);
      const nombres = eventosCreados.map((ev) => agPrimeraNombre(ev.titulo));
      const exacto = inicios.length === eventosCreados.length
        && inicios.every((q) => q.fecha === agUltima.fecha && agUltima.mins.includes(q.min))
        && new Set(inicios.map((q) => q.min)).size === inicios.length;
      const distintos = nombres.every((n) => n !== '') && new Set(nombres).size === nombres.length;
      if (exacto && distintos) for (const q of inicios) elegidas.push({ fecha: q.fecha, min: q.min });
    }
    return elegidas;
  })();
  const agCitasSinConfirmar = [];
  const agCitasSinNombre = [];
  let agElegidaSinNombre = null;
  if (!fallo && eventosCreados.length) {
    for (const ev of eventosCreados) {
      const t = Date.parse(ev.inicio);
      if (!Number.isFinite(t)) continue;
      const lp = agLaPaz(t);
      // Si el mensaje nombra horas, mandan esas: la eleccion de antes no cuenta
      // cuando el cliente acaba de nombrar otra.
      const esElegidaAntes = !agHorasCliente.length && !agPregunta && !agNiega && !!agElegido
        && agElegido.fecha === lp.fecha && Number(agElegido.min) === lp.min;
      const elegida = esElegidaAntes || agElegidasAhora.some((e) => e.fecha === lp.fecha && e.min === lp.min);
      if (!elegida) agCitasSinConfirmar.push(ev.id);
      else if (!agTieneNombre(ev.titulo)) {
        agCitasSinNombre.push(ev.id);
        agElegidaSinNombre = { fecha: lp.fecha, min: lp.min };
      }
    }
    if (agCitasSinConfirmar.length) avisos.push('agendo_sin_confirmar');
    if (agCitasSinNombre.length) avisos.push('agendo_sin_nombre');
  }
  // «SI» ANTE VARIAS OPCIONES: no dice cual. La cita se deshace y la pregunta
  // no es «¿te la agendo?» sino cual de las que se le ofrecieron, las que
  // sigan libres segun la consulta de este turno (si la hubo para ese dia).
  const agOpcionesSinElegir = (() => {
    if (!agCitasSinConfirmar.length || agPregunta || agNiega || agHorasCliente.length || !agConfirmaPalabra
      || !agUltima || agUltima.mins.length < 2) return null;
    const consultado = agConsultasTurno.some((c) => c.fecha === agUltima.fecha);
    const mins = agUltima.mins.filter((m) => !consultado
      || agMotivo(agConsultasTurno, agUltima.fecha, m, agDuracion, agLimite) === '');
    return mins.length >= 2 ? { fecha: agUltima.fecha, dia: agDiaTexto(agUltima.fecha), horas: agLista(mins) } : null;
  })();

  // LA HORA QUE EL PACIENTE SI ELIGIO (ensayo del 28/09, ejecucion #7167):
  // eligio las 15:30, dio el nombre y el modelo agendo las 09:00. La cita se
  // deshace (sin confirmar), y la pregunta no es por las 09:00, que nadie
  // pidio: es por la hora elegida. Su «si» del turno siguiente la confirma.
  // La eleccion de ANTES vale solo si este mensaje no la cambia (revisiones
  // de a6f533a y 4556525): ni pregunta, ni pide otra franja u otras horas, ni
  // nombra horas u otro dia. Un solo predicado para las dos vias que la usan.
  // Y tampoco si DESPUES hubo una oferta nueva que no la incluye (Bellido,
  // 29/09, #8618): «Confirme ese horario» sobre las 14:00 del martes 6 revivio
  // las 17:30 del martes 29 que habia elegido media hora antes.
  const agElegidoVale = !agHorasCliente.length && !agPregunta && !agFranja && !agPideOtra && !!agElegido && !!agElegido.fecha
    && (!agFechaCliente || agFechaCliente === String(agElegido.fecha))
    && !(agUltima && Number(agUltima.desde || 0) > Number(agElegido.desde || 0)
      && (agUltima.fecha !== String(agElegido.fecha) || !agUltima.mins.includes(Number(agElegido.min))));
  const agEleccionPendiente = (() => {
    if (!agCitasSinConfirmar.length || agOpcionesSinElegir || agNiega) return null;
    // Conserva su hora de eleccion: preguntarla de nuevo no la renueva.
    const e = agElegidasAhora.length === 1 ? agElegidasAhora[0]
      : (agElegidoVale ? { fecha: String(agElegido.fecha), min: Number(agElegido.min), desde: Number(agElegido.desde) || 0 } : null);
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.fecha) || !Number.isFinite(e.min)) return null;
    const yaCreada = eventosCreados.some((ev) => {
      const t = Date.parse(ev.inicio);
      return Number.isFinite(t) && agLaPaz(t).fecha === e.fecha && agLaPaz(t).min === e.min;
    });
    return yaCreada ? null : { fecha: e.fecha, min: e.min, desde: e.desde || 0, dia: agDiaTexto(e.fecha), hora: agHora(e.min) };
  })();

  // La respuesta se toca solo si es texto del modelo: los textos fijos de
  // arriba (cancelacion, servicio negado, error) no ofrecen horas.
  const agTextoDelModelo = !fallo && !vacia && !soloMarca && !negoServicio && !cancelacionSinConfirmar
    && !cancelacionFallida;
  const agUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
  // LA HORA QUE PIDE YA ES LA DE SU PROPIA CITA (Bellido, prueba real del
  // 28/09, #7566 y #7570): agendo a Manuel para el martes a las 11:00 y cuatro
  // minutos despues, desde el mismo telefono, pidio «mañana a las 11». El
  // modelo agendo las 11:30 por su cuenta (el candado la deshizo) y la pregunta
  // decia «Sí, el martes 29 a las 11:30 hay espacio»; insistio con «11 en
  // punto» y recibio «te puedo ofrecer 11:30 o 12:00». Nadie le dijo que las
  // 11:00 eran de su cita, y pidio hablar con alguien. El codigo lo sabe
  // (`creadas`: las citas que ESTE telefono agendo por el chat) y lo dice.
  const AG_NOMBRE_DE_PACIENTE = /^[a-záéíóúüñ][a-záéíóúüñ']*( [a-záéíóúüñ][a-záéíóúüñ']*){0,3}$/i;
  const AG_LEXICO_COBRO = /(pag|señ|sena|abon|adelant|dep[oó]sit|transf|cobr|acredit|verific|confirm|recib|aprob|comprob|\bqr\b|cancel|sald|liquid|garantiz)/i;
  const agSuCitaEnLaHora = (() => {
    if (agHorasCliente.length !== 1 || agHorasCliente[0].ordinal || pasosCancelar.length || canceladasEnElTurno.length) return null;
    const reg = agRegistros && telefonoDelCliente ? agRegistros[telefonoDelCliente] : null;
    const creadas = (reg && reg.creadas && typeof reg.creadas === 'object')
      ? Object.entries(reg.creadas).filter(([, c]) => c && Number(c.hasta || 0) > agAhora) : [];
    const h = agHorasCliente[0];
    // UN HECHO, NO UN RECUERDO (revision de seguridad de bb96b4c): `creadas` no
    // se entera si recepcion la cancelo en el calendario, si vencio su seña o si
    // se cancelo en otro turno. El aviso sale solo si la agenda consultada en
    // ESTE turno muestra esa misma cita (su id) a esa hora; sin consulta de ese
    // dia, no hay aviso.
    const enLaAgenda = (id, t) => agConsultasTurno.some((k) => k.fecha === agLaPaz(t).fecha
      && k.ocupados.some((o) => o.id === String(id) && o.i === t));
    const mins = h.ambigua ? [h.min, h.min + 720] : [h.min];
    // Si nombro el dia, la de ese dia; si no, solo si es UNA: dos citas suyas a
    // esa hora en dias distintos no dicen de cual habla.
    const coinciden = creadas.map(([id, c]) => ({ id, c, t: Date.parse(String(c.inicio || '')) }))
      .filter(({ id, t }) => Number.isFinite(t) && t > agAhora && mins.includes(agLaPaz(t).min)
        && (!agFechaDeLaHora || agLaPaz(t).fecha === agFechaDeLaHora) && enLaAgenda(id, t));
    if (coinciden.length !== 1) return null;
    const { c, t } = coinciden[0];
    const p = agLaPaz(t);
    // El paciente sale del titulo que puso el flujo («Cita Manuel — consulta»):
    // de una a cuatro palabras de letras, y nada que afirme un cobro (revision
    // de seguridad de bb96b4c: el titulo lo escribe el modelo); ni una palabra
    // del lexico de cobro, que `AFIRMA_COBRO` no cubre entero («Manuel seña
    // acreditada», «Manuel ya pagó»: revision de 9dac4e6); si no, «tu cita».
    const paciente = agNombreDelTitulo(c.titulo);
    return { fecha: p.fecha, min: p.min, dia: agDiaTexto(p.fecha), hora: agHora(p.min),
      paciente: AG_NOMBRE_DE_PACIENTE.test(paciente) && !AFIRMA_COBRO.test(paciente) && !AG_LEXICO_COBRO.test(paciente)
        ? paciente : '' };
  })();
  const agAvisoSuCita = agSuCitaEnLaHora
    ? `El ${agSuCitaEnLaHora.dia} a las ${agSuCitaEnLaHora.hora} ya está `
      + (agSuCitaEnLaHora.paciente ? `la cita de ${agSuCitaEnLaHora.paciente}.` : (agUsted ? 'su cita.' : 'tu cita.'))
    : '';
  const agDeQuien = (() => {
    if (agEquipo.length !== 1) return '';
    const n = String(agEquipo[0].nombre || '').trim();
    if (/^dra\.?\s/i.test(n)) return ' de la ' + n;
    if (/^dr\.?\s/i.test(n)) return ' del ' + n;
    return n ? ' de ' + n : '';
  })();
  // Quien del equipo nombra un texto: por su apellido (la ultima palabra de su
  // nombre, sin titulo), que es como lo dicen el cliente y el modelo.
  const AG_TITULOS = new Set(['dr', 'dra', 'lic', 'sr', 'sra', 'srta', 'ing', 'odont']);
  // Si dos comparten apellido (revision de a6f533a: «la Dra. Pérez» con un
  // Dr. Juan Pérez y una Dra. Ana Pérez), gana quien tiene mas palabras de su
  // nombre en el texto, titulo incluido; si empatan, quedan los dos.
  const agPersonasEn = (t) => {
    const w = new Set(agPalabrasDe(t));
    const con = agEquipo.map((x) => {
      const todas = agPalabrasDe(x.nombre);
      const ps = todas.filter((p) => p.length >= 3 && !AG_TITULOS.has(p));
      const ok = ps.length > 0 && w.has(ps[ps.length - 1]);
      return { nombre: String(x.nombre), apellido: ps[ps.length - 1], puntos: ok ? todas.filter((p) => w.has(p)).length : 0 };
    }).filter((x) => x.puntos > 0);
    return con.filter((x) => x.puntos === Math.max(...con.filter((y) => y.apellido === x.apellido).map((y) => y.puntos)))
      .map((x) => x.nombre);
  };
  const agDeLaPersona = (n) => (/^dra\.?\s/i.test(n) ? ' de la ' : /^dr\.?\s/i.test(n) ? ' del ' : ' de ') + n;
  const agAgendo = agUsted ? '¿Se la agendo?' : '¿Te la agendo?';
  const agSirve = agUsted ? '¿Le sirve alguna?' : '¿Te sirve alguna?';
  const agOtroDia = agUsted ? '¿Le sirve otro día?' : '¿Te sirve otro día?';
  const agPrefiere = agUsted ? '¿Cuál prefiere?' : '¿Cuál prefieres?';
  let agFinal = null;             // lo ofrecido que queda en la respuesta final
  let agEleccion = null;          // la hora que el paciente eligio y no se agendo
  const agMotivosH1 = new Set();

  // Una hora elegida que no se agendo (falto el nombre, por ejemplo) queda
  // guardada: el turno siguiente, con el nombre, la agenda sin preguntar otra
  // vez. Tambien la de una cita deshecha por `sin_nombre`.
  if (agElegidaSinNombre) agEleccion = agElegidaSinNombre;
  else if (!ejecutoAgendar && agElegidasAhora.length === 1) agEleccion = agElegidasAhora[0];

  if (agTextoDelModelo) {
    const { partes, ofertas } = agOfertas(respuesta, agHoy);
    const fechasConsultadas = Array.from(new Set(agConsultasTurno.map((c) => c.fecha)));
    // La fecha de cada oferta: la que nombra la oracion (o una anterior); si no
    // nombra ninguna y se consulto un solo dia, ese.
    const fechaDe = (o) => o.fecha || (fechasConsultadas.length === 1 ? fechasConsultadas[0] : '');
    const motivoBase = (o, h, consultas) => {
      const f = fechaDe(o);
      if (f) return agMotivo(consultas, f, h.min, agDuracion, agLimite);
      // Sin fecha y con varias consultadas: vale si cabe en alguna.
      const motivos = fechasConsultadas.map((x) => agMotivo(consultas, x, h.min, agDuracion, agLimite));
      return motivos.includes('') ? '' : (motivos[0] || 'sin_consulta');
    };
    // POR PERSONA, NO SOLO POR DIA (ensayo del 28/09, #7117 y #7122): se
    // consulto la agenda de un doctor y la respuesta ofrecia la hora «con los
    // dos». Si la oracion nombra a alguien del equipo, la hora tiene que salir
    // de la consulta de ESA persona; la de otro no la sostiene.
    const motivoDe = (o, h) => {
      const m = motivoBase(o, h, agConsultasTurno);
      if (m || agEquipo.length < 2) return m;
      for (const quien of agPersonasEn(partes[o.indice] || '')) {
        const mp = motivoBase(o, h, agConsultasTurno.filter((c) => c.persona === quien));
        if (mp) return mp === 'sin_consulta' ? 'persona_sin_consulta' : mp;
      }
      return '';
    };
    // «a las 5» que vale a la tarde se lee como 17:00 desde aca en adelante.
    ofertas.forEach((o) => o.horas.forEach((h) => { if (h.ambigua) agMotivoDeHora((min) => motivoDe(o, { ...h, min }), h); }));

    // --- M1: PIDIO OTRA COSA, NO SE LE REPITE LO MISMO ----------------------
    const fechaPedida = agFechaCliente || (ofertas.length ? fechaDe(ofertas[0]) : '')
      || (agUltima ? agUltima.fecha : '') || (fechasConsultadas.length === 1 ? fechasConsultadas[0] : '');
    const consultoEseDia = !!fechaPedida && fechasConsultadas.includes(fechaPedida);
    // Una hora concreta se contesta sobre esa hora cuando es una PREGUNTA («¿a
    // las 13?») o cuando la pidio y no se puede dar («quiero a las 19»). Si la
    // eligio y se puede, el turno sigue como lo escribio el modelo (pedira el
    // nombre, por ejemplo) y queda guardada como eleccion.
    const horaPedida = agHorasCliente.length === 1 && !ejecutoAgendar && !agNiega ? agHorasCliente[0] : null;
    const pideAlgo = !ejecutoAgendar && (horaPedida || agFranja || agPideOtra);
    let reemplazo = '';
    if (pideAlgo && consultoEseDia) {
      const dia = agDiaTexto(fechaPedida);
      const libres = agLibres(agConsultasTurno, fechaPedida, agDuracion, agLimite, 30);
      const antes = agOfrecidosAntes(fechaPedida);
      const delModelo = ofertas.filter((o) => fechaDe(o) === fechaPedida)
        .flatMap((o) => o.horas.map((h) => h.min)).filter((m) => libres.includes(m));
      const repite = delModelo.some((m) => antes.includes(m));
      if (horaPedida) {
        // Una hora de 1 a 7 sin «tarde» ni «mañana» es de la tarde si esa es la
        // que cae dentro del horario.
        const candidatas = horaPedida.ambigua ? [horaPedida.min + 720, horaPedida.min] : [horaPedida.min];
        const hora = candidatas.find((m) => agMotivo(agConsultasTurno, fechaPedida, m, agDuracion, agLimite) !== 'fuera')
          ?? candidatas[0];
        const motivo = agMotivo(agConsultasTurno, fechaPedida, hora, agDuracion, agLimite);
        const nombraLaHora = ofertas.some((o) => o.horas.some((h) => h.min === hora));
        if (motivo === '') {
          if (agPregunta && (!nombraLaHora || repite || delModelo.length !== 1)) {
            reemplazo = `Sí, el ${dia} a las ${agHora(hora)} hay espacio. ${agAgendo}`;
            agFinal = { fecha: fechaPedida, mins: [hora] };
          }
        } else {
          // La libre mas cercana ANTES y la mas cercana DESPUES de la pedida.
          const previa = libres.filter((m) => m < hora).pop();
          const siguiente = libres.find((m) => m > hora);
          const cercanas = [previa, siguiente].filter((m) => m !== undefined);
          const porque = motivo === 'fuera_de_grilla'
            ? `Por este chat las citas son en punto o y media: las ${agHora(hora)} no ${agUsted ? 'se la puedo' : 'te la puedo'} dar.`
            : motivo === 'cerrado' ? `El ${dia} no atendemos.`
            : (motivo === 'fuera' ? `El ${dia} a las ${agHora(hora)} no atendemos.`
              : (motivo === 'pasado' ? `El ${dia} a las ${agHora(hora)} ya no llego a darte el turno.`
                // Ocupada por SU cita: se le dice de quien es (Bellido, 28/09).
                : (agSuCitaEnLaHora && agSuCitaEnLaHora.fecha === fechaPedida && agSuCitaEnLaHora.min === hora
                  ? agAvisoSuCita : `El ${dia} a las ${agHora(hora)} ya está ocupado.`)));
          reemplazo = porque + (cercanas.length
            ? ` Lo más cercano libre ese día es ${agLista(cercanas)}. ${cercanas.length > 1 ? agSirve : (agUsted ? '¿Le sirve?' : '¿Te sirve?')}`
            : ` Ese día ya no queda espacio libre. ${agOtroDia}`);
          if (agUsted) reemplazo = reemplazo.replace('llego a darte', 'llego a darle');
          agFinal = cercanas.length ? { fecha: fechaPedida, mins: cercanas } : null;
        }
        if (reemplazo) avisos.push('hora_pedida_respondida');
      } else {
        const enFranja = agFranja ? libres.filter((m) => m >= agFranja.desde && m < agFranja.hasta) : libres;
        const nuevas = enFranja.filter((m) => !antes.includes(m));
        const modeloBien = delModelo.length > 0 && !repite
          && (!agFranja || delModelo.every((m) => m >= agFranja.desde && m < agFranja.hasta));
        if (!modeloBien) {
          const donde = `El ${dia}` + (agFranja ? ' ' + agFranja.nombre : '');
          if (nuevas.length) {
            reemplazo = `${donde}${agFranja ? '' : ' también'} hay espacio a las ${agLista(nuevas.slice(0, 3))}. ${agPrefiere}`;
            agFinal = { fecha: fechaPedida, mins: nuevas.slice(0, 3) };
          } else if (enFranja.length) {
            reemplazo = `${donde} solo quedan las ${agLista(enFranja.slice(0, 3))}, que ya ${agUsted ? 'le pasé' : 'te pasé'}. `
              + (agUsted ? '¿Le sirve alguna, o prefiere otro día?' : '¿Te sirve alguna, o prefieres otro día?');
            agFinal = { fecha: fechaPedida, mins: enFranja.slice(0, 3) };
          } else {
            reemplazo = `${donde} ya no queda espacio libre. ${agOtroDia}`;
          }
          avisos.push(agFranja ? 'franja_sin_repetir' : 'otros_horarios_sin_repetir');
        }
      }
    }

    if (reemplazo) {
      respuesta = agCambiarHoras(respuesta, reemplazo);
    } else if (ofertas.length) {
      // --- H1: SE QUITA TODA HORA QUE NO SALE DE LA AGENDA DE ESTE TURNO -----
      const validasPorOferta = ofertas.map((o) => o.horas.filter((h) => {
        const motivo = agMotivoDeHora((min) => motivoDe(o, { ...h, min }), h);
        if (motivo) agMotivosH1.add(motivo);
        return motivo === '';
      }));
      const invalidas = ofertas.some((o, k) => validasPorOferta[k].length < o.horas.length);
      if (invalidas) {
        const quedanOfertas = validasPorOferta.some((v) => v.length > 0);
        if (!quedanOfertas && !ejecutoAgendar) {
          // Ninguna hora se sostiene: una pregunta honesta, nunca un horario
          // inventado. Si el dia que nombro esta cerrado, se le dice; si el
          // paciente pregunto por una hora, la pregunta la nombra, y su «si»
          // del turno siguiente cuenta como confirmacion de ESA hora.
          const fechaNombrada = ofertas.map(fechaDe).find(Boolean) || agFechaCliente
            || (agUltima && agHorasCliente.length ? agUltima.fecha : '');
          const iguales = agEquipo.length > 0
            && agEquipo.every((x) => JSON.stringify(x.horario || {}) === JSON.stringify(agEquipo[0].horario || {}));
          const tramos = fechaNombrada && iguales ? agTramos(agEquipo[0].horario, agSemanaDe(fechaNombrada)) : null;
          const cerrado = Array.isArray(tramos) && tramos.length === 0;
          const aviso = cerrado ? `El ${agDiaTexto(fechaNombrada)} no atendemos. ` : '';
          // La hora que nombro, pregunte o elija (ensayo del 28/09, #7126: «a
          // las 16:15 con perez» recibia «¿para que dia y en que horario?»).
          const hora = agHorasCliente.length === 1 && !cerrado ? agHorasCliente[0].min : null;
          // De quien es la agenda que se va a revisar: la persona que nombran el
          // cliente o la respuesta, si es una sola.
          // Solo lo que nombro el CLIENTE (revision de a6f533a): el nombre de un
          // paciente en la respuesta no elige agenda.
          // Sin su propio nombre (revision de 4556525): «soy Juan Pérez» no
          // elige a la Dra. Pérez. Lo que sigue a «soy / me llamo» se quita.
          const nombradas = agPersonasEn(agClientePlano
            .replace(/\b(soy|me\s+llamo|mi\s+nombre\s+es|a\s+nombre\s+de)\s+[a-zñ]+(\s+[a-zñ]+)?/g, ' '));
          const deQuien = agDeQuien || (nombradas.length === 1 ? agDeLaPersona(nombradas[0]) : '');
          // MEDIUM de a6f533a: nada fuera del horario ni ya pasado. El horario
          // es el de la persona nombrada; si no hay una, basta con que quepa en
          // el de alguien del equipo.
          const horarios = (nombradas.length === 1 ? agEquipo.filter((x) => String(x.nombre) === nombradas[0]) : agEquipo)
            .map((x) => (x.horario && typeof x.horario === 'object' ? x.horario : null));
          const cabe = (fecha, m) => (horarios.length ? horarios : [null]).some((h) => agMotivo(
            [{ fecha, desde: -Infinity, hasta: Infinity, horario: h, ocupados: [] }], fecha, m, agDuracion, agLimite) === '');
          const enGrilla = (m) => (m % AG_GRILLA_MIN === 0 ? [m] : [m - (m % AG_GRILLA_MIN), m - (m % AG_GRILLA_MIN) + AG_GRILLA_MIN]);
          // «a las 4:15» que vale a la tarde: la que tenga algo que quepa.
          const horaReal = hora === null || !fechaNombrada ? hora
            : ([hora, ...(agHorasCliente[0].ambigua ? [hora + 720] : [])]
              .find((m) => enGrilla(m).some((x) => cabe(fechaNombrada, x))) ?? null);
          const opciones = horaReal === null || !fechaNombrada ? [] : enGrilla(horaReal).filter((x) => cabe(fechaNombrada, x));
          // Consulto la agenda de UNA de las personas que nombra la oferta y la
          // hora cabe en ella (#7117): se ofrece con esa persona, sin la otra.
          const conUna = (() => {
            if (![...agMotivosH1].every((m) => m === 'persona_sin_consulta') || !fechaNombrada) return null;
            const consultadas = agEquipo.map((x) => String(x.nombre))
              .filter((n) => agConsultasTurno.some((c) => c.persona === n && c.fecha === fechaNombrada)
                && ofertas.some((o) => agPersonasEn(partes[o.indice] || '').includes(n)));
            if (consultadas.length !== 1) return null;
            const suyas = agConsultasTurno.filter((c) => c.persona === consultadas[0]);
            const horas = Array.from(new Set(ofertas.filter((o) => fechaDe(o) === fechaNombrada)
              .flatMap((o) => o.horas.map((h) => h.min))))
              .filter((m) => agMotivo(suyas, fechaNombrada, m, agDuracion, agLimite) === '');
            return horas.length ? { persona: consultadas[0], horas: horas.slice(0, 3) } : null;
          })();
          // EL DIA CONSULTADO EN ESTE TURNO (Bellido, 29/09, #8636 a #8654): Silvana
          // pidio el sabado 10 de octubre seis veces y siempre recibio «¿para que
          // dia y en que horario te acomoda?»: el modelo ofrecia horas ocupadas, el
          // codigo las quitaba todas y volvia a preguntar lo que ya se habia dicho.
          // Si ese dia se consulto en este turno y lo atiende UNA persona, el
          // codigo sabe que hay: si no queda nada, se dice; si queda algo, se ofrece
          // lo que el mismo verifico.
          // Revision de seguridad del #283: solo se afirma lo que se VERIFICO. Una sola
          // persona (la que pidio el cliente, si nombro una), con su horario cargado, y
          // una consulta que cubra TODO el horario de ese dia: con una consulta parcial
          // («de 15:00 a 16:00») no se sabe si el resto del dia esta lleno.
          const delDia = fechaNombrada && !cerrado ? agConsultasTurno.filter((c) => c.fecha === fechaNombrada) : [];
          const personaDia = delDia.length ? delDia[0].persona : '';
          const tramosDia = delDia.length && delDia[0].horario ? agTramos(delDia[0].horario, agSemanaDe(fechaNombrada)) : null;
          const verificable = delDia.length > 0 && new Set(delDia.map((c) => c.persona)).size === 1 && !!personaDia
            && delDia.every((c) => !!c.horario) && Array.isArray(tramosDia) && tramosDia.length > 0
            && (nombradas.length === 0 || (nombradas.length === 1 && nombradas[0] === personaDia))
            && tramosDia.every((t) => delDia.some((c) => c.desde <= agInstante(fechaNombrada, t.i) && c.hasta >= agInstante(fechaNombrada, t.f)));
          const libresDia = verificable
            ? agLibres(delDia, fechaNombrada, agDuracion, agLimite, AG_GRILLA_MIN)
              .filter((m) => !agFranja || (m >= agFranja.desde && m < agFranja.hasta)) : null;
          let pregunta;
          if (libresDia && libresDia.length === 0 && !conUna) {
            pregunta = `El ${agDiaTexto(fechaNombrada)} ya no queda espacio libre. ${agOtroDia}`;
            agFinal = null;
            avisos.push('dia_sin_espacio');
          } else if (libresDia && libresDia.length > 0 && !conUna && hora === null) {
            const nuevas = libresDia.filter((m) => !agOfrecidosAntes(fechaNombrada).includes(m));
            const ofrecer = (nuevas.length ? nuevas : libresDia).slice(0, 3);
            pregunta = `El ${agDiaTexto(fechaNombrada)} hay espacio a las ${agLista(ofrecer)}. ${agPrefiere}`;
            agFinal = { fecha: fechaNombrada, mins: ofrecer };
            avisos.push('horas_del_codigo');
          } else if (conUna) {
            const una = conUna.horas.length === 1;
            // «Sí» solo si el cliente pregunto por ESA persona (o por nadie).
            const siEsa = agPregunta && (!nombradas.length || nombradas.includes(conUna.persona));
            pregunta = (una && siEsa ? 'Sí, el ' : 'El ') + agDiaTexto(fechaNombrada)
              + (una ? ` a las ${agHora(conUna.horas[0])} hay espacio` : ` hay espacio a las ${agLista(conUna.horas)}`)
              + (/^dra\.?\s/i.test(conUna.persona) ? ' con la ' : /^dr\.?\s/i.test(conUna.persona) ? ' con el ' : ' con ') + conUna.persona
              + `. ${una ? agAgendo : agPrefiere}`;
            agFinal = { fecha: fechaNombrada, mins: conUna.horas };
          } else if (horaReal !== null && fechaNombrada && horaReal % AG_GRILLA_MIN !== 0 && opciones.length) {
            pregunta = `Por este chat las citas son en punto o y media: ${agUsted ? '¿quiere' : '¿quieres'} el ${agDiaTexto(fechaNombrada)}`
              + ` a las ${opciones.map(agHora).join(' o a las ')}? Así reviso la agenda${deQuien}.`;
            agFinal = { fecha: fechaNombrada, mins: opciones, soloUltima: true };
          } else if (horaReal !== null && fechaNombrada && opciones.length) {
            pregunta = (agUsted ? '¿Quiere' : '¿Quieres') + ` el ${agDiaTexto(fechaNombrada)} a las ${agHora(horaReal)}? Así reviso la agenda${deQuien}.`;
            agFinal = { fecha: fechaNombrada, mins: [horaReal], soloUltima: true };
          } else if (hora !== null && !fechaNombrada) {
            pregunta = `¿Para qué día ${agUsted ? 'quiere' : 'quieres'} las ${agHora(hora)}? Así reviso la agenda${deQuien}.`;
            agFinal = null;
          } else {
            pregunta = `¿Para qué día y en qué horario ${agUsted ? 'le' : 'te'} acomoda? Reviso la agenda${deQuien}.`;
            agFinal = null;
          }
          respuesta = agCambiarHoras(respuesta, aviso + pregunta);
        } else {
          // Quedan las validas, en el mismo lugar; una oracion que se queda sin
          // ninguna se quita entera.
          ofertas.forEach((o, k) => {
            const validas = validasPorOferta[k];
            partes[o.indice] = validas.length ? agDejarValidas(partes[o.indice], o.horas, validas) : '';
          });
          respuesta = partes.join('').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
          const vivas = ofertas.map((o, k) => ({ o, v: validasPorOferta[k] })).filter((x) => x.v.length);
          if (vivas.length) agFinal = { fecha: fechaDe(vivas[0].o), mins: vivas[0].v.map((h) => h.min) };
        }
        for (const m of agMotivosH1) avisos.push('horario_' + m);
      } else {
        const primera = ofertas.find((o) => fechaDe(o));
        if (primera) agFinal = { fecha: fechaDe(primera), mins: primera.horas.map((h) => h.min) };
      }
    }
  }

  // --- «SOLO LO DIJO»: RESPUESTA HONESTA (Andres, 27/09/2026) ---------------
  // El modelo AFIRMA que agendo («quedo agendada», «tu cita esta confirmada») y
  // agendar_cita NO se ejecuto en el turno (con los pasos del agente a la
  // vista): no hay cita. Una confirmacion sin cita es presentar algo como lo
  // que no es. El texto lo pone el codigo, y ninguna variante confirma:
  //   · hora elegida pendiente y nombre conocido → «Todavia no quedo agendada:
  //     ¿te la reservo el <dia> a las <hora>?» (su «si» la confirma);
  //   · hora elegida sin nombre → la pregunta de `sin_nombre`;
  //   · sin hora elegida → «Todavia no agende nada: ¿para que dia y horario te
  //     acomoda?».
  // Reemplaza la respuesta del turno: 0 mensajes agregados. Si el nombre
  // parece conocido o no solo decide cual de las dos preguntas sale; la
  // barrera real del nombre esta al agendar (H2, `sin_nombre`).
  // Si la afirmacion habla de una cita que YA EXISTE, no se toca (revision de
  // f0c6957): «¿mi cita esta confirmada?» → «Si, tu cita del lunes esta
  // confirmada». Existe si buscar_mi_cita la mostro en este turno, o si en los
  // ultimos 30 minutos se le mostro una (candidatos por telefono) y la
  // respuesta nombra su hora, o el cliente pregunta por «mi cita».
  // LA EVIDENCIA DE UNA CITA QUE YA EXISTE (revision de f962cef): lo que
  // buscar_mi_cita mostro en el turno, los candidatos de los ultimos 30
  // minutos, las citas que ESTE telefono agendo por el chat (`creadas`, vivas
  // hasta el dia de la cita) y la seña pendiente (la cita esta retenida).
  // Con el dia, no solo la hora (revision de c9d2304): «tu cita del viernes a
  // las 10:00» no es la del lunes a las 10:00.
  const agHorasDe = (iso) => {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return '';
    const p = agLaPaz(t);
    return `${AG_DIAS[p.semana]} ${p.dia} de ${AG_MESES[p.mes - 1]} a las ${agHora(p.min)}`;
  };
  const agEvidencia = (() => {
    const horas = [];
    let hay = false;
    for (const v of vistasEsteTurno) { hay = true; horas.push(v.desc); }
    try {
      const reg = pendientesDeCancelar && telefonoDelCliente ? pendientesDeCancelar[telefonoDelCliente] : null;
      if (reg && Date.now() - Number(reg.desde || 0) < 30 * 60 * 1000) {
        const descs = [...Object.values((reg.candidatos && typeof reg.candidatos === 'object') ? reg.candidatos : {}), reg.desc]
          .map((d) => String(d || '')).filter(Boolean);
        if (descs.length) { hay = true; horas.push(...descs); }
      }
    } catch (e) { /* sin datos estaticos */ }
    const creadas = (agRegistros && telefonoDelCliente && agRegistros[telefonoDelCliente]
      && agRegistros[telefonoDelCliente].creadas && typeof agRegistros[telefonoDelCliente].creadas === 'object')
      ? Object.values(agRegistros[telefonoDelCliente].creadas).filter((c) => c && Number(c.hasta || 0) > agAhora) : [];
    for (const c of creadas) { hay = true; horas.push(agHorasDe(c.inicio)); }
    const sena = String(cfg.senaPendiente || '') === 'si';
    return { hay: hay || sena, textos: horas.filter(Boolean) };
  })();
  // Existente: hay evidencia, TODAS las horas que nombra la respuesta coinciden
  // con una cita vista, candidata o creada, y la respuesta no dice que el
  // asistente agendo o movio algo, ni se cancelo nada en el turno (revision de
  // f962cef: «reprogramé tu cita para el martes» sin agendar_cita no es una
  // cita existente, es una que no existe).
  // Revision de c9d2304: una evidencia viva no basta para cualquier
  // afirmacion. Si la respuesta nombra horas, cada una coincide con una cita
  // de la evidencia, y el dia de la semana tambien si lo nombra. Si no nombra
  // ninguna, solo vale como respuesta a una pregunta por la cita que ya tiene
  // («¿ya quedo?», «¿mi cita esta confirmada?»): el cliente no pide otra, no
  // elige hora ni dia en el turno, y la respuesta no habla de una cita
  // «nueva», «otra» o «segunda».
  const AG_MOVIMIENTO = /(agend[eé]|reserv[eé]|anot[eé]|cambi[eé]|mov[ií])(?![a-záéíóúñ])|reprogram|reagend/i;
  const AG_OTRA_CITA = /\b(nuev[oa]s?|otr[oa]s?|segund[oa]s?|adicional(es)?)\s+(cita|reserva|turno|hora|consulta)s?\b/;
  const AG_PIDE_CITA = /\b(otr[oa]|nuev[oa]|segund[oa]|adicional|agendar(me|le|nos)?|agendame|agendeme|agende|reservar(me|le|nos)?|reservame|reserveme|sacar)\b/;
  const agDiasEn = (t) => AG_DIAS.map(agSinTilde).filter((d) => new RegExp('\\b' + d + '\\b').test(agSinTilde(t)));
  const agCitaExistente = (() => {
    const texto = respuesta.replace(/[*_~]/g, '');
    if (!agEvidencia.hay || pasosCancelar.length > 0 || AG_MOVIMIENTO.test(texto)) return false;
    if (AG_OTRA_CITA.test(agSinTilde(texto))) return false;
    const horasDichas = agHorasDelTexto(texto).map((h) => agHora(h.min));
    if (horasDichas.length > 0) {
      const dias = agDiasEn(texto);
      return horasDichas.every((h) => agEvidencia.textos.some((d) => d.includes(h)
        && (!dias.length || dias.some((dia) => agSinTilde(d).includes(dia)))));
    }
    return !agEleccion && !AG_PIDE_CITA.test(agClientePlano)
      && agHorasDelTexto(agCliente).length === 0 && agDiasEn(agCliente).length === 0;
  })();
  if (agTextoDelModelo && Array.isArray(dato.intermediateSteps) && !ejecutoAgendar && afirmaAgendo
    && !agCitaExistente) {
    const pendiente = agEleccion || (agElegidoVale
      ? { fecha: String(agElegido.fecha), min: Number(agElegido.min), desde: Number(agElegido.desde) || 0 } : null);
    const nombreConocido = [...agPalabrasCliente].some((w) => !AG_GENERICAS.has(w) && !AG_DEL_NEGOCIO.has(w));
    if (pendiente && Number.isFinite(pendiente.min) && pendiente.fecha) {
      respuesta = nombreConocido
        ? `Todavía no quedó agendada: ¿${agUsted ? 'se' : 'te'} la reservo el ${agDiaTexto(pendiente.fecha)} a las ${agHora(pendiente.min)}?`
        : `Para reservar las ${agHora(pendiente.min)} del ${agDiaTexto(pendiente.fecha)}, ¿a nombre de quién la agendo?`;
      if (nombreConocido) agFinal = { fecha: pendiente.fecha, mins: [pendiente.min] };
      if (!agEleccion) agEleccion = { fecha: pendiente.fecha, min: pendiente.min, desde: pendiente.desde };
    } else {
      // Sin hora elegida no se afirma «no agende nada» (revision de f962cef):
      // puede haber una cita que este turno no ve. Se pregunta para revisarla.
      respuesta = `No veo esa reserva en este chat: ¿me ${agUsted ? 'confirma' : 'confirmas'} el día para revisarla?`;
      agFinal = null;
    }
    // Si en el turno se cancelo la vieja, se le dice: la nueva no existe.
    if (canceladasEnElTurno.length) {
      respuesta = canceladasEnElTurno.map((c) => `${agUsted ? 'Su' : 'Tu'} cita${c.desc ? ' ' + String(c.desc).trim() : ' anterior'} quedó cancelada.`)
        .join(' ') + ' ' + respuesta;
    }
    avisos.push('afirmo_sin_agendar');
  }

  // Se dice antes de las horas que le ofrece el modelo, si no la nombra ya
  // («tu cita del martes a las 11:00 sigue en pie» no se toca). Si en el turno
  // se agendo algo, lo decide `Comprobar reserva`, que recibe el aviso.
  if (agAvisoSuCita && agTextoDelModelo && !transferir && !eventosCreados.length) {
    const horasDichas = agHorasDelTexto(respuesta.replace(/[*_~]/g, ''));
    if (horasDichas.length && !horasDichas.some((x) => x.min === agSuCitaEnLaHora.min)) {
      respuesta = agAvisoSuCita + ' ' + respuesta;
      avisos.push('hora_de_su_cita');
    }
  }
  // La hora que nombro el cliente, para que `Comprobar reserva` no le diga
  // «Sí» a otra: pidio las 11 y el modelo agendo las 11:30.
  const agHoraPedida = agHorasCliente.length === 1 && !agHorasCliente[0].ordinal
    ? { dia: agFechaDeLaHora ? agDiaTexto(agFechaDeLaHora) : '',
      horas: (agHorasCliente[0].ambigua ? [agHorasCliente[0].min, agHorasCliente[0].min + 720] : [agHorasCliente[0].min]).map(agHora) }
    : null;

  // Lo que queda guardado de este turno, por telefono: lo ofrecido (sumado al
  // de antes, por fecha), la ultima oferta y la eleccion. Se barren los
  // registros vencidos de todos los telefonos solo si hay algo que escribir.
  if (agRegistros && telefonoDelCliente) {
    // Un registro vencido se barre, salvo sus `creadas` vivas: esas duran
    // hasta el dia de la cita (revision de f962cef).
    const vivas = (r) => Object.fromEntries(Object.entries((r && r.creadas && typeof r.creadas === 'object') ? r.creadas : {})
      .filter(([, c]) => c && Number(c.hasta || 0) > agAhora));
    for (const [tel, r] of Object.entries(agRegistros)) {
      if (r && agAhora - Number(r.desde || 0) < AG_VIGENCIA_MS) { r.creadas = vivas(r); continue; }
      const quedan = vivas(r);
      if (Object.keys(quedan).length) {
        agRegistros[tel] = { ofrecidos: {}, ultima: null, elegido: null, palabras: [], creadas: quedan, desde: Number((r && r.desde) || 0) };
      } else delete agRegistros[tel];
    }
    // La pregunta sale por la hora elegida: su «si» confirma ESA, no la que
    // el modelo agendo por su cuenta.
    if (agEleccionPendiente) {
      agFinal = { fecha: agEleccionPendiente.fecha, mins: [agEleccionPendiente.min], soloUltima: true };
      agEleccion = { fecha: agEleccionPendiente.fecha, min: agEleccionPendiente.min, desde: agEleccionPendiente.desde };
    }
    const r = agRegistros[telefonoDelCliente] = agRegistros[telefonoDelCliente]
      || { ofrecidos: {}, ultima: null, elegido: null, desde: agAhora };
    r.ofrecidos = (r.ofrecidos && typeof r.ofrecidos === 'object') ? r.ofrecidos : {};
    if (agFinal && agFinal.fecha && agFinal.mins.length && !agFinal.soloUltima) {
      const previos = Array.isArray(r.ofrecidos[agFinal.fecha]) ? r.ofrecidos[agFinal.fecha] : [];
      r.ofrecidos[agFinal.fecha] = Array.from(new Set([...previos, ...agFinal.mins])).slice(-48);
      const fechas = Object.keys(r.ofrecidos);
      for (const f of fechas.slice(0, Math.max(0, fechas.length - 7))) delete r.ofrecidos[f];
    }
    if (agFinal && agFinal.fecha && agFinal.mins.length) {
      r.ultima = { fecha: agFinal.fecha, mins: agFinal.mins.slice(0, 12), desde: agAhora };
    }
    if (agEleccion) r.elegido = { fecha: agEleccion.fecha, min: agEleccion.min, desde: Number(agEleccion.desde) || agAhora };
    // Una cita que quedo agendada cierra la eleccion y la ultima oferta.
    if (eventosCreados.length && !agCitasSinConfirmar.length && !agCitasSinNombre.length) { r.elegido = null; r.ultima = null; }
    // Cuantas veces SEGUIDAS se deshizo una cita por falta de nombre: una cita
    // que queda en pie vuelve la cuenta a cero.
    // El contador de «sin nombre» seguidos lo sube `Procesar reintento` cuando
    // una cita de verdad se deshizo por el nombre; aca solo vuelve a cero
    // cuando una cita queda en pie.
    if (eventosCreados.length && !agCitasSinConfirmar.length && !agCitasSinNombre.length) r.sinNombreSeguidos = 0;
    // LAS CITAS QUE ESTE TELEFONO AGENDO POR EL CHAT (revision de f962cef): son
    // la evidencia de que una cita existe en los turnos siguientes («¿ya
    // quedo?»). Viven hasta el dia de la cita, minimo 24 horas. Las que se
    // deshacen por falta de confirmacion o de nombre no entran; las que el
    // candado deshace las borra `Comprobar reserva`.
    r.creadas = (r.creadas && typeof r.creadas === 'object') ? r.creadas : {};
    // Las que se cancelaron en este turno ya no son evidencia de nada.
    for (const id of idsCancelados) delete r.creadas[String(id).slice(0, 200)];
    for (const ev of eventosCreados) {
      if (agCitasSinConfirmar.includes(ev.id) || agCitasSinNombre.includes(ev.id)) continue;
      const t = Date.parse(ev.inicio);
      // Con su titulo, para decirle de quien es la cita si pide esa hora.
      r.creadas[String(ev.id).slice(0, 200)] = { inicio: String(ev.inicio), titulo: String(ev.titulo || '').slice(0, 120),
        desde: agAhora, hasta: Math.max(Number.isFinite(t) ? t + 3600000 : 0, agAhora + 24 * 3600000) };
    }
    const ids = Object.keys(r.creadas);
    for (const id of ids.slice(0, Math.max(0, ids.length - 10))) delete r.creadas[id];
    // Las palabras del cliente (de donde sale el nombre dicho antes), las mas
    // recientes al final, hasta 80.
    const previas = Array.isArray(r.palabras) ? r.palabras : [];
    const nuevas = agPalabrasDe(agCliente);
    r.palabras = [...previas.filter((w) => !nuevas.includes(w)), ...nuevas].slice(-80);
    r.desde = agAhora;
  }

  // --- NO SE OFRECE LO QUE NO SE VA A CUMPLIR (Andres, 21/09/2026) -----------
  // POLITICA DE NOVUCHAT, para todos los clientes. El asistente escribio «lo
  // consulto con recepcion para que te confirmen» y no tiene como consultar a
  // nadie: el paciente espero una respuesta que no iba a llegar. Lo unico que
  // puede ofrecer cuando le falta un dato o algo falla es pasar con recepcion,
  // que es un aviso a recepcion MAS el boton para escribirle directo (lo
  // agrega `Mensaje a enviar` a todo lo que se transfiere). Toda promesa de que
  // alguien le va a responder o avisar despues se CUMPLE: se transfiere. No se
  // toca el texto; lo que se hace es que sea verdad. Las preguntas («¿Quieres
  // que te pase con recepcion?») no prometen nada y no cuentan.
  const PROMESA = /(consult|averigu|pregunt|verific|revis|coordin)[a-záéíóúñ]*\s+(lo\s+|eso\s+)?(con|a)\s+(recepci|la\s+cl[ií]nica|el\s+equipo|el\s+personal|(el|la)\s+(doctor|doctora|dr|dra)(?![a-záéíóúñ])|administraci|caja|alguien|una\s+persona|la\s+empresa|el\s+negocio|mis\s+compa)|(te|le)\s+(avis|escrib|llam|contact|confirm|mand|env[ií]|respond)[a-záéíóúñ]*\s+(luego|despu[eé]s|m[aá]s\s+tarde|ma[ñn]ana|en\s+cuanto|apenas|pronto|en\s+un\s+rato|en\s+breve|a\s+la\s+brevedad)|(te|le)\s+(avisar|escribir|llamar|contactar|confirmar|responder)([eé]|[aá]n?)(?![a-záéíóúñ])|voy\s+a\s+(consultar|averiguar|preguntar|avisar|escribir|llamar|contactar|confirmar)/i;
  const frasePrometida = fallo ? '' : (respuesta.split(/(?<=[.!?…])\s+|\n+/)
    .map((o) => o.trim()).find((o) => o && !/\?\s*$/.test(o) && PROMESA.test(o)) || '');
  const prometeSinRespaldo = frasePrometida !== '' && !transferir;
  if (prometeSinRespaldo) avisos.push('promesa_cumplida_por_recepcion');
  const pasarARecepcion = prometeSinRespaldo || contactoSinNumero;

  // --- EL DIA DE LA SEMANA LO PONE EL CODIGO, NO EL MODELO (2026-09-23) ------
  // Bellido, prueba real del cliente con dos telefonos (#4790 y #4799):
  //   · `consultar_disponibilidad` recibio 2026-09-25 y el modelo escribio
  //     «el jueves 25 de septiembre». El 25 era viernes.
  //   · `buscar_mi_cita` DEVOLVIO la cita correcta, 2026-09-24T15:00-04:00, y
  //     el modelo escribio «el miercoles 24 de septiembre a las 15:00». El 24
  //     era jueves.
  // El dia del mes y la hora salieron BIEN las dos veces. Lo unico que el
  // modelo inventa es la PALABRA del dia de la semana, porque es lo unico que
  // tiene que calcular. El doctor lo leyo como «se ha confundido con las
  // fechas» y decidio no publicar el numero hasta que se arregle. Y el error
  // no se queda en el texto: con el dia equivocado el modelo consulto la
  // franja del jueves (14:00-18:00) sobre una fecha que era viernes.
  //
  // POR QUE EN CODIGO Y NO EN EL PROMPT. Pedirle que no calcule es una
  // instruccion mas, y ya sabemos como termina (la regla del candado, 17/09:
  // una instruccion se ignora bajo insistencia y cambia con cada modelo). Aca
  // no hay nada que interpretar: el turno SABE que fechas tocaron las
  // herramientas —lo que les entro y lo que devolvieron— y de una fecha al dia
  // de la semana hay una sola respuesta.
  //
  // SOLO CORRIGE LO QUE PUEDE PROBAR. Se toca la palabra unicamente cuando el
  // numero del dia coincide con una fecha real de este turno (y el mes, si el
  // texto lo dice). Si no coincide, o si dos fechas del turno caen en el mismo
  // numero con distinto dia de semana, el flujo no tiene con que decidir: deja
  // el texto como esta. Corregir de menos es un texto raro; corregir de mas es
  // mandar a un paciente otro dia.
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const sinTilde = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const porDia = new Map();   // dia del mes -> [{ semana, mes }]
  // UNA FECHA ANTERIOR A HOY NO ES EVIDENCIA (24/09/2026, ejecucion #5563 de
  // Bellido). El modelo llamo a consultar_disponibilidad y a agendar_cita con
  // el 25/09/2025 --un año atras-- y este corrector, fiel a «lo que las
  // herramientas tocaron», cambio un «viernes 25» que estaba BIEN por «jueves
  // 25», que era el dia de la semana del 25 de 2025. Una cita nunca esta en
  // el pasado: una fecha de ayer o de otro año en un paso de herramienta es
  // un error del modelo, no un dato, y no sirve para corregir nada. Se
  // compara el DIA en la zona del negocio (en-CA da AAAA-MM-DD, que ordena
  // como texto); lo de hoy si cuenta, porque un rango de hoy a las 09:00
  // consultado a las 19:00 es legitimo.
  const hoyLaPaz = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const anotarFecha = (iso) => {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return;
    const diaLaPaz = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t));
    if (diaLaPaz < hoyLaPaz) return;
    // El dia, el mes y el dia de la semana, los tres en la zona del negocio:
    // en UTC una cita de las 17:30 de La Paz ya pertenece al dia siguiente, y
    // ese desfase es justo el que se vino a arreglar.
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz', weekday: 'short', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(t));
    const valor = (tipo) => (partes.find((p) => p.type === tipo) || {}).value || '';
    const dia = parseInt(valor('day'), 10);
    const mes = parseInt(valor('month'), 10);
    const semana = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[valor('weekday')];
    if (!Number.isFinite(dia) || !Number.isFinite(mes) || !Number.isFinite(semana)) return;
    const ya = porDia.get(dia) || [];
    if (!ya.some((f) => f.mes === mes && f.semana === semana)) ya.push({ mes, semana });
    porDia.set(dia, ya);
  };
  for (const p of pasos) {
    if (!p || !p.action) continue;
    const entrada = p.action.toolInput || {};
    anotarFecha(entrada.inicio);
    anotarFecha(entrada.fin);
    let obs = p.observation;
    if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
    const eventos = Array.isArray(obs) ? obs : (obs && typeof obs === 'object' ? [obs] : []);
    for (const ev of eventos) {
      if (!ev || typeof ev !== 'object') continue;
      anotarFecha((ev.start || {}).dateTime);
      anotarFecha((ev.end || {}).dateTime);
    }
  }
  let diaCorregido = false;
  if (porDia.size && !fallo) {
    respuesta = respuesta.replace(
      /\b(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)(\s+)(\d{1,2})\b(\s+de\s+([a-záéíóú]+))?/gi,
      (todo, palabra, espacio, numero, colaMes, nombreMes) => {
        const dia = parseInt(numero, 10);
        const candidatas = porDia.get(dia) || [];
        if (!candidatas.length) return todo;
        let elegidas = candidatas;
        if (nombreMes) {
          const mes = MESES.findIndex((m) => m === sinTilde(nombreMes)) + 1;
          // Un mes escrito que no es ninguno de los del turno: no es esta fecha.
          if (!mes) return todo;
          elegidas = candidatas.filter((f) => f.mes === mes);
          if (!elegidas.length) return todo;
        }
        const semanas = Array.from(new Set(elegidas.map((f) => f.semana)));
        if (semanas.length !== 1) return todo;   // ambiguo: no se toca
        const correcto = DIAS[semanas[0]];
        if (sinTilde(palabra) === sinTilde(correcto)) return todo;
        diaCorregido = true;
        // Se conserva la mayuscula inicial: la palabra puede abrir la oracion.
        const puesto = /^[A-ZÁÉÍÓÚÑ]/.test(palabra)
          ? correcto.charAt(0).toUpperCase() + correcto.slice(1)
          : correcto;
        return puesto + espacio + numero + (colaMes || '');
      },
    );
  }
  if (diaCorregido) avisos.push('dia_de_semana_corregido');

  const verificarReserva = ejecutoAgendar || afirmaAgendo;

  out.push({ json: {
    respuesta,
    // Con el adelanto a favor no hace falta una persona: se aplica solo.
    transferir: transferir || qrSinSena || cancelacionFallida || negoServicio || (!!citaPagadaCancelada && !adelantoAFavor) || pasarARecepcion
      || cancelacionIncierta,
    motivoTransferencia: (transferir || qrSinSena || cancelacionFallida || negoServicio || (citaPagadaCancelada && !adelantoAFavor) || pasarARecepcion
      || cancelacionIncierta)
      ? (cancelacionIncierta ? 'el cliente CONFIRMÓ cancelar o mover su cita' + descIncierta
          + ' y el modelo falló en ese mismo turno: la cita PUEDE haber quedado cancelada sin una nueva. Revisar la agenda y confirmarle por este chat'
        : (citaPagadaCancelada && !adelantoAFavor) ? 'el cliente CANCELÓ una cita que ya tenía la seña pagada ('
          + String(citaPagadaCancelada.summary || '') + ', ' + String((citaPagadaCancelada.start || {}).dateTime || '')
          + '): coordinar con él qué pasa con el adelanto'
        : negoServicio ? 'el cliente preguntó por algo que el asistente no sabe si el negocio ofrece: asesorarlo. Escribió: «'
          + String(ent.userInput || '').replace(/\s+/g, ' ').slice(0, 160) + '»'
        : cancelacionFallida ? 'el cliente pidió CANCELAR su cita y cancelar_cita NO la borró (Google no confirmó): la cita sigue en la agenda, cancelarla a mano y avisarle'
        : pasarARecepcion ? (contactoSinNumero && !prometeSinRespaldo
          ? 'el cliente pidió hablar con recepción y no hay número de recepción cargado en la consola: escribirle por este chat. Escribió: «'
          : 'el asistente le dijo al cliente que alguien le iba a responder («' + frasePrometida.slice(0, 160)
            + '»): responderle por este chat. El cliente escribió: «')
          + String(ent.userInput || '').replace(/\s+/g, ' ').slice(0, 160) + '»'
        : qrSinSena ? 'pidió el QR de su seña y no hay ninguna pendiente: revisar si quedó a medias'
        : (ent.forzarTransferencia === true && ent.motivoForzado
          ? String(ent.motivoForzado)
          // EL MOTIVO DICE LO QUE PASO (2026-09-20). Antes decia siempre «tres
          // rechazos de horario consecutivos», y el modelo marca [TRANSFERIR] por
          // varias razones: un servicio que no conoce, una cancelacion que
          // fallo, una cita que no pudo verificar. Recepcion leia «tres
          // rechazos» cuando el paciente habia preguntado por estetica facial.
          // Sin saber la razon exacta, se le da lo unico cierto: que derivo el
          // asistente, y que escribio el cliente.
          : 'el asistente pidió que lo atienda una persona. El cliente escribió: «'
            + String(ent.userInput || '').replace(/\s+/g, ' ').slice(0, 160) + '»')) : '',
    afirmaAgendo,
    ejecutoAgendar,
    // LO QUE EL CANDADO NECESITA PARA NO JUZGAR DE MAS (revision de seguridad
    // de 98796fd): si el agente devolvio sus pasos y en ninguno agendo, el
    // modelo solo DIJO que agendo; el candado no puede borrar ni nombrar citas
    // de la ventana, que son de otros. `agendarPasosSinId`: llamadas sin id.
    pasosDelAgente: Array.isArray(dato.intermediateSteps),
    agendarEjecutado: ejecutoAgendar,
    agendarPasosSinId,
    // Las horas que se le pidieron a agendar_cita, para el motivo del aviso a
    // recepcion cuando no volvio el id.
    agendarInicios: pasos.filter((p) => p && p.action && p.action.tool === 'agendar_cita')
      .map((p) => String(((p.action.toolInput || {}).inicio) || '')).filter(Boolean).slice(0, 5),
    // H2 (27/09/2026): las citas que agendar_cita creo sin que el paciente
    // confirmara ese horario. `Comprobar reserva` las deshace por la via del
    // candado y el paciente recibe la pregunta.
    agendaSinConfirmar: agCitasSinConfirmar,
    // La misma regla, la otra mitad: hora elegida, pero el nombre del titulo no
    // es uno que el cliente haya dicho. Se deshace y se le pide el nombre.
    agendaSinNombre: agCitasSinNombre,
    opcionesSinElegir: agOpcionesSinElegir,
    eleccionPendiente: agEleccionPendiente ? { dia: agEleccionPendiente.dia, hora: agEleccionPendiente.hora } : null,
    // Prueba real de Bellido del 28/09 (#7566): la hora que pidio y, si es la
    // de su propia cita, el aviso que va antes de la pregunta.
    horaPedida: agHoraPedida,
    avisoSuCita: agAvisoSuCita,
    // AL SEGUNDO `sin_nombre` SEGUIDO, CON RECEPCION (revision de 98796fd): si
    // el nombre que dice el cliente no coincide dos veces, preguntarle de nuevo
    // es un bucle; lo resuelve una persona.
    sinNombreRepetido: agCitasSinNombre.length > 0 && agSinNombreAntes >= 1,
    canceladasEnElTurno,
    agendarSinEvento,
    observacionAgendar,
    verificarReserva,
    herramientas,
    eventosCreados,
    respuestaVacia: vacia,
    seDespide,
    falloModelo: fallo,
    from: ent.from,
    nombrePerfil: ent.nombrePerfil,
    enviarUbicacion, enviarContacto, numeroRecepcion, reenviarQr,
    // El hecho que el reporte del saliente le lleva al servidor, que es quien
    // decide el adelanto a favor.
    ...(adelantoAFavor ? { eventoSena: { evento: 'cita_cancelada', referencia: String(citaPagadaCancelada.id),
      inicio: String((citaPagadaCancelada.start || {}).dateTime || '') } } : {}),
    // Lo que el envio del pin necesita, arrastrado en el item (como en el
    // Demo B): `Enviar ubicacion` lo lee de `Mensaje a enviar`, porque el
    // $json que le llega de `Responder al cliente` es la respuesta de Meta.
    phoneNumberId: cfg.phoneNumberId,
    waGraphVersion: cfg.waGraphVersion || 'v26.0',
    ubicacionLat: lat,
    ubicacionLng: lng,
    direccion: String(cfg.direccion ?? ''),
    nombreNegocio: String(cfg.nombreNegocio ?? ''),
    // SEÑA (bloque 2): lo que `Preparar seña` y el QR necesitan, arrastrado
    // en el item; la compuerta `¿Enviar QR de la seña?` lee `senaActiva` de
    // aca, despues del candado. `calendarioDelEvento` es el del evento que
    // agendar_cita devolvio; `Preparar seña` lo confirma contra el calendario.
    avisos,
    senaActiva: cfg.senaActiva === 'si' ? 'si' : '',
    senaImporte: String(cfg.senaImporte ?? ''),
    senaMoneda: String(cfg.senaMoneda ?? 'Bs'),
    senaMinutosRetencion: String(cfg.senaMinutosRetencion ?? '30'),
    senaQrUrl: String(cfg.senaQrUrl ?? ''),
    senaNombreCuenta: String(cfg.senaNombreCuenta ?? ''),
    senaBanco: String(cfg.senaBanco ?? ''),
    direccionMaps: String(cfg.direccionMaps ?? ''),
    funcionarios: String(cfg.funcionarios ?? '[]'),
    calendarioDelEvento: eventosCreados.length ? eventosCreados[0].calendario : '',
  }});
}
return out;
