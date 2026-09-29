// EL SEGUNDO TURNO TRAS UN CRUCE DE HORARIO (2026-09-17).
//
// `Reintento tras cruce` NO tiene la herramienta de agendar: por diseño no
// puede crear una cita, asi que aca no hay nada que verificar en el
// calendario. Lo que si hay que vigilar es lo que DICE: si afirma que agendo,
// le mentiria al cliente igual que la respuesta que se deshizo. En ese caso,
// si el modelo fallo o si devolvio vacio, se cae a la red de seguridad de
// siempre: el texto fijo de `Config del negocio`, la transferencia y el aviso
// a recepcion. Una sola vez: este nodo no vuelve al agente.
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
      if (Number.isFinite(i) && Number.isFinite(f) && f > i) ocupados.push({ i, f });
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
  const re = /(?<![\d:.,/])([01]?\d|2[0-3])(?:\s*[:.h]\s*([0-5]\d)|\s+y\s+(media|cuarto))?(?![\d/]|[.:]\d)(\s*(?:hrs?\.?|hs\.?)(?![a-záéíóúñ]))?(\s*(?:de\s+la\s+(?:tarde|noche)|pm|p\.\s?m\.?))?(\s*(?:de\s+la\s+ma[ñn]ana|am|a\.\s?m\.?))?(\s+en\s+punto\b)?/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m[0] === '') { re.lastIndex += 1; continue; }
    let h = Number(m[1]);
    const conMinutos = m[2] !== undefined || m[3] !== undefined;
    const antes = t.slice(Math.max(0, m.index - 12), m.index);
    const trasLas = /\b(las?|para\s+las?)\s+$/i.test(antes);
    // «11 en punto» tambien es una hora (Bellido, prueba real del 28/09, #7570).
    if (!conMinutos && !trasLas && !m[4] && !m[5] && !m[7]) continue;
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
    texto = texto.slice(0, c[0].desde) + agLista(quedan.map((h) => h.min)) + texto.slice(c[c.length - 1].hasta);
  }
  return texto.replace(/[ \t]{2,}/g, ' ');
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

const base = $('Retomar respuesta').first().json;
const dato = ($input.first() && $input.first().json) || {};
const fallo = dato.error !== undefined || dato.output === undefined;
const bruto = String(dato.output ?? '');
const marca = bruto.includes('[TRANSFERIR]');
// Negrita de WhatsApp por construccion: la misma linea que en `Procesar
// respuesta` y `Mensaje a enviar` (ver el comentario alla).
const NEGRITA_MD = (t) => String(t).replace(/\*\*\*([^*\n]+?)\*\*\*/g, '*_$1_*').replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
const texto = NEGRITA_MD(bruto.split('[TRANSFERIR]').join('').trim());
// Los detectores juzgan el texto sin marcas de formato.
const plano = texto.replace(/[*_~]/g, '');

// LOS MISMOS DETECTORES QUE `Procesar respuesta`, letra por letra: una prueba
// (`platinum-flujo.test.ts`) exige que sean identicos para que un ajuste en
// uno no deje al otro con una version vieja.
const CONFIRMA = /(ha sido|han sido|queda|quedó|quedo|fue|está|esta|ya está|ya esta)\s+(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad|anotad)|\b(he|hemos)\s+(agendado|reservado|registrado|confirmado|reprogramado|reagendado|movido|anotado)\b|(agendé|reservé|registré|reprogramé|reagendé|moví)(?![a-záéíóúñ])|\b(te|le|les|los|las)\s+anot(é|amos)(?![a-záéíóúñ])|\b(cambié|cambiamos|moví|movimos)\s+(tu|su|la)\s+cita\b|\b(cita|reserva|turno)\b[^.!?]{0,40}?\b(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad)[oa]s?\b/i;
const NIEGA = /\bno\s+(pude|se pudo|pudimos|quedó|quedo|está|esta)\b/i;
const YA_EXISTE = /\bya\s+(tiene|tienes|cuenta con|hay)/i;
// Y uno propio de este turno: «ese horario ya esta ocupado» es exactamente lo
// que el reintento tiene que decir, y CONFIRMA lo confunde con «esta
// reservado» de una cita nueva.
const OCUPADO = /\b(ya\s+)?(est[aá]|estaba|se encuentra|estar[ií]a)\s+(ocupad|reservad|tomad)|\bya\s+no\s+est[aá]\s+disponible/i;
// Se juzga ORACION por ORACION: un «no quedo registrada» al principio no
// puede tapar un «quedo agendada a las 15:00» al final.
const oraciones = plano.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
const afirmaAgendo = oraciones.some((s) =>
  CONFIRMA.test(s) && !NIEGA.test(s) && !YA_EXISTE.test(s) && !OCUPADO.test(s));

const motivo = base.motivoCruce || 'hubo un cruce de horario';

// LO QUE SE GUARDA POR TELEFONO, igual que en `Procesar respuesta`: lo ofrecido
// por fecha y la ultima oferta, para que el «si» del turno siguiente confirme
// ESA hora y para no repetirle lo mismo. Sin datos estaticos, nada.
const registrarOferta = (fecha, mins) => {
  if (!fecha || !mins.length) return;
  try {
    const sd = $getWorkflowStaticData('global');
    sd.agendaPorTelefono = (sd.agendaPorTelefono && typeof sd.agendaPorTelefono === 'object') ? sd.agendaPorTelefono : {};
    const tel = String(base.from || '');
    if (!tel) return;
    // Un registro vencido (mas de una hora) no se reutiliza: se barre y se
    // empieza de cero, igual que en `Procesar respuesta` (revision del #244).
    const previo = sd.agendaPorTelefono[tel];
    if (previo && !(Date.now() - Number(previo.desde || 0) < 60 * 60 * 1000)) {
      // Se barre, salvo las citas creadas que siguen vivas (revision de f962cef).
      const creadas = Object.fromEntries(Object.entries((previo.creadas && typeof previo.creadas === 'object') ? previo.creadas : {})
        .filter(([, c]) => c && Number(c.hasta || 0) > Date.now()));
      sd.agendaPorTelefono[tel] = Object.keys(creadas).length
        ? { ofrecidos: {}, ultima: null, elegido: null, palabras: [], creadas, desde: Date.now() } : undefined;
      if (!sd.agendaPorTelefono[tel]) delete sd.agendaPorTelefono[tel];
    }
    const r = sd.agendaPorTelefono[tel] = sd.agendaPorTelefono[tel] || { ofrecidos: {}, ultima: null, elegido: null, desde: Date.now() };
    r.ofrecidos = (r.ofrecidos && typeof r.ofrecidos === 'object') ? r.ofrecidos : {};
    const previos = Array.isArray(r.ofrecidos[fecha]) ? r.ofrecidos[fecha] : [];
    r.ofrecidos[fecha] = Array.from(new Set([...previos, ...mins])).slice(-48);
    r.ultima = { fecha, mins: mins.slice(0, 12), desde: Date.now() };
    r.desde = Date.now();
  } catch (e) { /* sin datos estaticos: no se guarda */ }
};
const hoyLaPaz = agLaPaz(Date.now()).fecha;

// --- SIN CONFIRMAR (27/09/2026, #6555) ---------------------------------------
// El paciente solo pregunto por esa hora y la cita se deshizo. Lo que recibe es
// la pregunta que armo `Comprobar reserva`, fija, sea lo que sea que haya
// escrito el modelo: el reintento corre solo para que la memoria del agente
// guarde esa pregunta (el turno que no se envio ya se olvido). Sin aviso a
// recepcion: no hay nada que resolver, falta que el paciente diga que si.
// `ejecutoAgendar` vuelve a falso: para el reporte, este turno OFRECIO horarios.
if (base.causaDeLaCaida === 'sin_confirmar' || base.causaDeLaCaida === 'sin_nombre') {
  const { ofertas } = agOfertas(base.respuesta, hoyLaPaz);
  const primera = ofertas.find((o) => o.fecha);
  if (primera) registrarOferta(primera.fecha, primera.horas.map((h) => h.min));
  // Al segundo «sin nombre» seguido, la respuesta ya dice que pasa con
  // recepcion: se transfiere (aviso y boton), que es lo unico que se ofrece.
  // Tambien con causas mezcladas: basta que una de las caidas sea sin nombre
  // (revision de f0c6957). El motivo ya viene en `avisoDelTurno`.
  const caidas = Array.isArray(base.citasCaidas) ? base.citasCaidas : [];
  const huboSinNombre = caidas.some((c) => c && c.causa === 'sin_nombre');
  const aRecepcion = base.sinNombreRepetido === true && huboSinNombre;
  // EL CONTADOR DE «SIN NOMBRE» SEGUIDOS lo lleva este nodo (revision de
  // f0c6957): cuenta solo cuando una cita de verdad se deshizo por el nombre.
  // `Procesar respuesta` lo vuelve a cero cuando una cita queda en pie.
  if (huboSinNombre) {
    try {
      const sd = $getWorkflowStaticData('global');
      const tel = String(base.from || '');
      const r = tel && sd.agendaPorTelefono && sd.agendaPorTelefono[tel];
      if (r) { r.sinNombreSeguidos = Number(r.sinNombreSeguidos || 0) + 1; r.desde = Date.now(); }
    } catch (e) { /* sin datos estaticos: no se cuenta */ }
  }
  const avisoDelTurno = String(base.avisoDelTurno || '');
  return [{ json: { ...base,
    respuesta: base.respuesta,
    // Un solo aviso por turno: el de este nodo.
    transferir: aRecepcion || avisoDelTurno !== '',
    motivoTransferencia: avisoDelTurno,
    ejecutoAgendar: false,
    reintentoTrasCruce: fallo ? 'sin-confirmar-sin-modelo' : 'sin-confirmar',
  }, pairedItem: { item: 0 } }];
}

// --- LAS HORAS DEL REINTENTO TAMBIEN SALEN DE SU CONSULTA (27/09/2026) -------
// La misma regla que `Procesar respuesta`: toda hora que el reintento ofrece
// sale de un consultar_disponibilidad de ESTE turno, libre, dentro del horario
// de ese dia y no en el pasado. La que no pasa se quita; si no queda ninguna,
// el reintento no salio y va la red de siempre (texto fijo y recepcion). Solo
// si el agente devolvio sus pasos (`Return Intermediate Steps`): sin ellos no
// hay con que juzgar y el texto sigue como hasta hoy.
let textoFinal = texto;
let horarioNoVerificado = false;
const avisosReintento = Array.isArray(base.avisos) ? base.avisos.slice() : [];
if (!fallo && texto !== '' && !afirmaAgendo && Array.isArray(dato.intermediateSteps)) {
  let cfgR = {};
  try { cfgR = $('Config del negocio').first().json || {}; } catch (e) { cfgR = {}; }
  const numero = (v, min, max, porDefecto) => {
    const n = Number(v);
    return v !== '' && v !== null && v !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
  };
  const duracion = numero(cfgR.duracionPorDefectoMin, 5, 480, 30);
  const limite = Date.now() + numero(cfgR.anticipacionMinimaMin, 0, 10080, 0) * 60000;
  let equipo = [];
  try { equipo = JSON.parse(cfgR.funcionarios || '[]'); } catch (e) { equipo = []; }
  equipo = Array.isArray(equipo) ? equipo.filter((x) => x && x.nombre) : [];
  const consultas = agConsultas(dato.intermediateSteps, equipo, new Set());
  const fechas = Array.from(new Set(consultas.map((c) => c.fecha)));
  const { partes, ofertas } = agOfertas(texto, hoyLaPaz);
  const fechaDe = (o) => o.fecha || (fechas.length === 1 ? fechas[0] : '');
  const motivos = new Set();
  const validas = ofertas.map((o) => o.horas.filter((h) => {
    const f = fechaDe(o);
    const m = agMotivoDeHora((min) => (f ? agMotivo(consultas, f, min, duracion, limite)
      : (fechas.some((x) => agMotivo(consultas, x, min, duracion, limite) === '') ? '' : 'sin_consulta')), h);
    if (m) motivos.add(m);
    return m === '';
  }));
  if (ofertas.some((o, k) => validas[k].length < o.horas.length)) {
    for (const m of motivos) avisosReintento.push('horario_' + m);
    if (!validas.some((v) => v.length)) {
      horarioNoVerificado = true;
    } else {
      ofertas.forEach((o, k) => { partes[o.indice] = validas[k].length ? agDejarValidas(partes[o.indice], o.horas, validas[k]) : ''; });
      textoFinal = partes.join('').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    }
  }
  const viva = ofertas.findIndex((o, k) => validas[k].length && fechaDe(o));
  if (viva >= 0 && !horarioNoVerificado) registrarOferta(fechaDe(ofertas[viva]), validas[viva].map((h) => h.min));
}

const salio = !fallo && texto !== '' && !afirmaAgendo && !horarioNoVerificado;
if (salio) {
  return [{ json: { ...base,
    respuesta: textoFinal,
    avisos: avisosReintento,
    transferir: marca || String(base.avisoDelTurno || '') !== '',
    motivoTransferencia: [marca ? `${motivo}; al ofrecer alternativas el asistente pidio atencion humana` : '',
      String(base.avisoDelTurno || '')].filter(Boolean).join('; '),
    reintentoTrasCruce: 'ok',
  }, pairedItem: { item: 0 } }];
}

const porQue = fallo ? 'fallo el modelo' : (texto === '' ? 'el modelo no devolvio texto'
  : (horarioNoVerificado ? 'ofrecio horarios que no salen de la agenda consultada' : 'el modelo volvio a afirmar que agendo'));
return [{ json: { ...base,
  respuesta: base.respuesta,
  avisos: avisosReintento,
  transferir: true,
  motivoTransferencia: `${motivo}; el reintento de ofrecer alternativas no salio (${porQue}) y el cliente quedo esperando otro horario`
    + (base.avisoDelTurno ? `; ${base.avisoDelTurno}` : ''),
  reintentoTrasCruce: fallo ? 'fallo' : (texto === '' ? 'vacio' : (horarioNoVerificado ? 'horario-no-verificado' : 'afirmo-agendar')),
}, pairedItem: { item: 0 } }];
