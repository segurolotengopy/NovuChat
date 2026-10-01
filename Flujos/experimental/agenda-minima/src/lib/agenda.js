// =============================================================================
// LIBRERIA DE AGENDA DE «AGENDA MINIMA v0»
// =============================================================================
//
// PRINCIPIO: el codigo calcula, el modelo conversa. Toda hora que se ofrece sale
// de aca; el modelo nunca la calcula (el 17/09 agendo encima de otra cita y el
// «dia lleno» de Bellido se lo inventaba con aritmetica mental). Ver CONTRATO.md §3.
//
// COMO SE USA. Es JavaScript plano para un nodo Code de n8n: el constructor del
// flujo pega este archivo delante del codigo de cada nodo. Por eso:
//   - solo declaraciones `function` (y unas pocas constantes `AGM_*`) en el ambito
//     global del nodo; sin `require`, `import`, `export`;
//   - nada de `URL`, `Buffer`, `crypto`, `process`: el sandbox de n8n no los tiene;
//   - nada de `Date.now()` ni `new Date()` sin argumento: el tiempo entra por
//     `ahoraMs` (milisegundos desde 1970), asi la prueba controla el reloj;
//   - nada de `Intl` ni de la zona del proceso: La Paz es UTC-4 fijo, sin horario
//     de verano, y se calcula con un desplazamiento fijo (`TZ_OFFSET_MIN`).
// Todas las funciones son puras: reciben datos y devuelven datos.
//
// FORMAS DEL HORARIO QUE ACEPTA `tramosDelDia` (`horario`)
//   La real, la que devuelve `configuracionFlujo` (nodo «Config del negocio» de
//   Bellido: `horario: f.horarioTrabajo`, que sale de `negocio.horarios` de
//   `negocio-bellido.json`): un objeto con una clave por dia, `lun mar mie jue vie
//   sab dom`, y de valor un TEXTO:
//       { lun: '11:00-18:00', jue: '14:00-18:00', sab: '09:00-12:00', dom: 'cerrado' }
//       { lun: '09:00-12:00, 14:00-18:00' }        // dos tramos: coma o punto y coma
//   El separador de la hora puede ser «-», «–» o «a» (`09:00 a 12:00`). «cerrado»
//   (o «cerrada») es un dia sin tramos. Claves extra como `_nota` se ignoran.
//   Ademas, por tolerancia (no las emite hoy ningun panel):
//     - la clave del dia tambien como `lunes`, `miercoles`, `miércoles`, `sábado`…;
//     - el valor como lista: `['09:00-12:00', '14:00-18:00']` o
//       `[{desde:'09:00', hasta:'12:00'}]` (tambien `{abre, cierra}`), y como un
//       solo objeto `{desde, hasta}`; `null`, `false` o `[]` = cerrado;
//     - el horario entero como texto JSON de un objeto de esas formas.
//   Decision segura (falla cerrado): un dia que falta, o cuyo texto no se entiende,
//   NO tiene tramos: nunca se ofrece una hora que el horario no confirma. (`Procesar
//   respuesta` de Bellido lo trata como «no se puede juzgar»; aca no hay modelo que
//   juzgue, y ofrecer de mas es lo grave.)
// =============================================================================

const TZ_OFFSET_MIN = -240; // America/La_Paz, UTC-4 fijo.
const AGM_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const AGM_DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const AGM_CLAVES_DIA = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const AGM_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const AGM_GRILLA_MIN = 30; // por el chat solo se ofrece en punto o y media.
const AGM_MAX_DIAS_BUSQUEDA = 14;
const AGM_MAX_ID_BOTON = 256; // tope de Meta para el id de un boton.

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------
function _agmPad2(n) { return (n < 10 ? '0' : '') + n; }
function _agmEsFecha(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const p = f.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}
// 'HH:MM' o 'H:MM' -> minutos desde las 00:00; NaN si no es una hora (24:00 vale, como fin de dia).
function _agmMinutos(hhmm) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(hhmm === undefined || hhmm === null ? '' : hhmm));
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return NaN;
  return h * 60 + mi;
}
function _agmHHMM(min) { return _agmPad2(Math.floor(min / 60)) + ':' + _agmPad2(min % 60); }
// Sin tildes, en minusculas y con espacios simples: para comparar textos.
function _agmSimple(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// El instante (ms) en que empieza `fecha` (00:00 de La Paz) sumando `min` minutos locales.
function _agmMsLocal(fecha, min) {
  const p = fecha.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]) + min * 60000 - TZ_OFFSET_MIN * 60000;
}
function _agmLista(x) {
  if (Array.isArray(x)) return x;
  if (x === undefined || x === null || x === '') return [];
  return [x];
}

// ---------------------------------------------------------------------------
// Fechas en La Paz
// ---------------------------------------------------------------------------
function fechaLocal(ms) {
  const d = new Date(Number(ms) + TZ_OFFSET_MIN * 60000);
  return d.getUTCFullYear() + '-' + _agmPad2(d.getUTCMonth() + 1) + '-' + _agmPad2(d.getUTCDate());
}

function horaLocal(ms) {
  const d = new Date(Number(ms) + TZ_OFFSET_MIN * 60000);
  return _agmPad2(d.getUTCHours()) + ':' + _agmPad2(d.getUTCMinutes());
}

// 'AAAA-MM-DD' -> 'lunes' | ... | 'domingo'; null si la fecha no existe.
function diaDeLaSemana(fecha) {
  if (!_agmEsFecha(fecha)) return null;
  const p = fecha.split('-').map(Number);
  return AGM_DIAS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
}

function isoLocal(fecha, hhmm) {
  const min = _agmMinutos(hhmm);
  const h = Number.isNaN(min) ? '00:00' : _agmHHMM(min % 1440);
  return fecha + 'T' + h + ':00-04:00';
}

// Un ISO a milisegundos. Sin desplazamiento explicito se toma como hora de La Paz
// (nunca la zona del proceso); una fecha sola es la medianoche de La Paz.
function msDe(iso) {
  if (typeof iso === 'number') return iso;
  const t = String(iso === undefined || iso === null ? '' : iso).trim();
  if (_agmEsFecha(t)) return _agmMsLocal(t, 0);
  if (/T/.test(t) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) return Date.parse(t + '-04:00');
  return Date.parse(t);
}

function sumarDias(fecha, n) {
  const p = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(n)));
  return d.getUTCFullYear() + '-' + _agmPad2(d.getUTCMonth() + 1) + '-' + _agmPad2(d.getUTCDate());
}

// 'Jue 15:00' (el dia de la semana y la hora local; cabe en un boton).
function etiquetaDeHueco(iso) {
  const ms = msDe(iso);
  if (Number.isNaN(ms)) return '';
  const f = fechaLocal(ms).split('-').map(Number);
  const dia = new Date(Date.UTC(f[0], f[1] - 1, f[2])).getUTCDay();
  return AGM_DIAS_CORTOS[dia] + ' ' + horaLocal(ms);
}

// 'jueves 2 de octubre a las 15:00'.
function textoDeFecha(iso) {
  const ms = msDe(iso);
  if (Number.isNaN(ms)) return '';
  const fecha = fechaLocal(ms);
  const p = fecha.split('-').map(Number);
  return diaDeLaSemana(fecha) + ' ' + p[2] + ' de ' + AGM_MESES[p[1] - 1] + ' a las ' + horaLocal(ms);
}

// ---------------------------------------------------------------------------
// Horario
// ---------------------------------------------------------------------------
// Un tramo suelto («09:00-12:00», «09:00 a 12:00») a {desde, hasta}; null si no se entiende.
function _agmTramoDeTexto(texto) {
  const m = /^\s*(\d{1,2}:\d{2})\s*(?:-|–|—|a)\s*(\d{1,2}:\d{2})\s*$/i.exec(String(texto));
  if (!m) return null;
  return _agmTramoDe(m[1], m[2]);
}
function _agmTramoDe(desde, hasta) {
  const i = _agmMinutos(desde);
  const f = _agmMinutos(hasta);
  if (Number.isNaN(i) || Number.isNaN(f) || !(f > i) || i >= 1440) return null;
  return { desde: _agmHHMM(i), hasta: _agmHHMM(f) };
}
function _agmTramosDeValor(v) {
  if (v === undefined || v === null || v === false || v === '') return [];
  if (typeof v === 'string') {
    if (/^\s*cerrad[oa]s?\s*$/i.test(v)) return [];
    return v.split(/[,;]/).map(_agmTramoDeTexto).filter(Boolean);
  }
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) {
      for (const t of _agmTramosDeValor(x)) out.push(t);
    }
    return out;
  }
  if (typeof v === 'object') {
    if (v.cerrado === true) return [];
    const t = _agmTramoDe(v.desde !== undefined ? v.desde : v.abre, v.hasta !== undefined ? v.hasta : v.cierra);
    return t ? [t] : [];
  }
  return [];
}

// `horario` + 'AAAA-MM-DD' -> [{desde:'HH:MM', hasta:'HH:MM'}] ordenados; [] si ese dia
// esta cerrado, no figura o no se entiende. Las formas aceptadas, arriba.
function tramosDelDia(horario, fecha) {
  let h = horario;
  if (typeof h === 'string') {
    try { h = JSON.parse(h); } catch (e) { return []; }
  }
  const dia = diaDeLaSemana(fecha);
  if (!h || typeof h !== 'object' || Array.isArray(h) || !dia) return [];
  const idx = AGM_DIAS.indexOf(dia);
  const claves = [AGM_CLAVES_DIA[idx], dia, _agmSimple(dia)];
  let valor;
  for (const c of claves) {
    if (Object.prototype.hasOwnProperty.call(h, c)) { valor = h[c]; break; }
  }
  const tramos = _agmTramosDeValor(valor);
  tramos.sort((a, b) => _agmMinutos(a.desde) - _agmMinutos(b.desde));
  return tramos;
}

// ---------------------------------------------------------------------------
// Eventos del calendario
// ---------------------------------------------------------------------------
// -> [{inicioMs, finMs, id}]. Ignora los cancelados, los `transparent` (no bloquean) y los
// de `opciones.ignorarIds` (mover: la cita propia no bloquea). Un evento de dia entero
// (`start.date`) ocupa el dia local completo; su `end.date` es exclusivo, como en Google.
// Un evento con inicio legible y fin ilegible se toma de 30 minutos (falla cerrado: mejor
// bloquear de mas que ofrecer encima); sin inicio legible no se puede ubicar y se omite.
function ocupados(eventos, opciones) {
  const ignorar = ((opciones && opciones.ignorarIds) || []).filter(Boolean).map(String);
  const out = [];
  for (const e of _agmLista(eventos)) {
    if (!e || typeof e !== 'object') continue;
    if (e.status === 'cancelled') continue;
    if (e.transparency === 'transparent') continue;
    if (e.id !== undefined && ignorar.indexOf(String(e.id)) >= 0) continue;
    const s = e.start || {};
    const f = e.end || {};
    let inicioMs;
    let finMs;
    if (s.dateTime) {
      inicioMs = msDe(s.dateTime);
      finMs = f.dateTime ? msDe(f.dateTime) : NaN;
      if (Number.isNaN(inicioMs)) continue;
      if (Number.isNaN(finMs)) finMs = inicioMs + 30 * 60000;
    } else if (s.date) {
      inicioMs = msDe(String(s.date).slice(0, 10));
      finMs = f.date ? msDe(String(f.date).slice(0, 10)) : NaN;
      if (Number.isNaN(inicioMs)) continue;
      if (Number.isNaN(finMs) || finMs <= inicioMs) finMs = inicioMs + 1440 * 60000;
    } else {
      continue;
    }
    out.push({ inicioMs: inicioMs, finMs: finMs, id: e.id === undefined ? '' : String(e.id) });
  }
  return out;
}

function _agmSeCruza(ocupado, inicioMs, finMs) {
  return ocupado.inicioMs < finMs && inicioMs < ocupado.finMs;
}

// Los huecos de UN dia: en punto o y media, la cita entera dentro de un tramo del
// horario, sin tocar ningun ocupado y no antes de `ahoraMs + anticipacionMin`.
// `franja`: 'manana' (antes de 12:00) | 'tarde' (12:00 o despues) | 'cualquiera'.
function huecosDelDia(p) {
  const fecha = p.fecha;
  const duracion = Number(p.duracionMin) > 0 ? Number(p.duracionMin) : 30;
  const anticipacion = Number(p.anticipacionMin) > 0 ? Number(p.anticipacionMin) : 0;
  const limiteMs = Number(p.ahoraMs) + anticipacion * 60000;
  const franja = p.franja === 'manana' || p.franja === 'tarde' ? p.franja : 'cualquiera';
  if (!_agmEsFecha(fecha)) return [];
  const bloques = ocupados(p.eventos, { ignorarIds: p.ignorarIds });
  const huecos = [];
  for (const tramo of tramosDelDia(p.horario, fecha)) {
    const desde = _agmMinutos(tramo.desde);
    const hasta = _agmMinutos(tramo.hasta);
    let min = Math.ceil(desde / AGM_GRILLA_MIN) * AGM_GRILLA_MIN;
    for (; min + duracion <= hasta; min += AGM_GRILLA_MIN) {
      if (franja === 'manana' && min >= 720) continue;
      if (franja === 'tarde' && min < 720) continue;
      const inicioMs = _agmMsLocal(fecha, min);
      const finMs = inicioMs + duracion * 60000;
      if (inicioMs < limiteMs) continue;
      if (bloques.some((o) => _agmSeCruza(o, inicioMs, finMs))) continue;
      const inicio = isoLocal(fecha, _agmHHMM(min));
      // El fin sale del instante, no del texto: un fin a las 24:00 es 00:00 del dia siguiente.
      const fin = isoLocal(fechaLocal(finMs), horaLocal(finMs));
      huecos.push({ inicio: inicio, fin: fin, etiqueta: etiquetaDeHueco(inicio) });
    }
  }
  return huecos;
}

// La oferta de huecos de un turno. Ver CONTRATO.md §3 para la forma; decisiones de esta
// implementacion, ademas de las del contrato:
//  - Sin fecha, desde MAÑANA (P12). Hoy solo si `pidioHoy` o si `fechaPreferida` es hoy;
//    pedir hoy cuenta como pedir un dia: si hoy no queda nada, hay aviso.
//  - El dia pedido sin huecos -> 'dia_cerrado' (sin tramos) o 'dia_lleno' (con tramos y
//    sin lugar), y los huecos del siguiente dia que tenga, hasta 14 dias adelante. Un dia
//    con UNA hora libre NO esta lleno: esa hora se ofrece.
//  - `franja` es un filtro duro. Si el dia pedido tiene lugar pero no en esa franja sale
//    'dia_lleno' con `franjaLlena: true` (campo extra) para que el texto no diga que no
//    queda espacio en todo el dia.
//  - `horaPreferida` ('HH:MM') se busca en el dia elegido, sin filtro de franja. Libre ->
//    va primera y le siguen las mas cercanas; no disponible (ocupada, fuera de horario o
//    ya pasada) -> aviso 'hora_ocupada' y las mas cercanas, en orden de hora. Sin fecha,
//    se aplica al primer dia con huecos.
//  - `fechaPreferida` anterior a hoy -> 'fecha_pasada' y la oferta desde la fecha por
//    defecto. Posterior a `anticipacionMaximaDias` -> 'fuera_de_rango' y sin huecos.
//  - Ningun dia con huecos en 14 dias -> 'sin_huecos'.
//  - Los huecos salen en orden de hora, salvo la preferida libre, que va primera.
function ofertaDeHuecos(p) {
  const cfg = p.cfg || {};
  const maximo = Number(p.maximo) > 0 ? Math.floor(Number(p.maximo)) : 3;
  const duracion = Number(cfg.duracionPorDefectoMin) > 0 ? Number(cfg.duracionPorDefectoMin) : 30;
  const hoy = fechaLocal(p.ahoraMs);
  const limite = Number(cfg.anticipacionMaximaDias) > 0 ? sumarDias(hoy, Math.floor(Number(cfg.anticipacionMaximaDias))) : null;
  const preferida = _agmEsFecha(p.fechaPreferida) ? p.fechaPreferida : null;
  const minPref = p.horaPreferida ? _agmMinutos(p.horaPreferida) : NaN;
  const conHoraPreferida = !Number.isNaN(minPref);
  const franja = conHoraPreferida ? 'cualquiera' : p.franja;
  const resultado = (huecos, dia, aviso, extra) => Object.assign(
    { huecos: huecos, dia: dia, aviso: aviso, diaPedido: preferida || (p.pidioHoy ? hoy : null) }, extra || {});
  const deUnDia = (fecha, fr) => huecosDelDia({
    eventos: p.eventos, fecha: fecha, horario: cfg.horario, duracionMin: duracion, ahoraMs: p.ahoraMs,
    anticipacionMin: cfg.anticipacionMinimaMin, franja: fr, ignorarIds: p.ignorarIds,
  });

  let aviso = null;
  let extra = {};
  let inicioBusqueda;
  let diaPedido = null;
  if (preferida) {
    if (preferida < hoy) {
      aviso = 'fecha_pasada';
      inicioBusqueda = p.pidioHoy ? hoy : sumarDias(hoy, 1);
    } else if (limite && preferida > limite) {
      return resultado([], null, 'fuera_de_rango');
    } else {
      diaPedido = preferida;
      inicioBusqueda = preferida;
    }
  } else if (p.pidioHoy) {
    diaPedido = hoy;
    inicioBusqueda = hoy;
  } else {
    inicioBusqueda = sumarDias(hoy, 1);
  }

  let dia = null;
  let huecos = [];
  for (let k = 0; k < AGM_MAX_DIAS_BUSQUEDA; k++) {
    const fecha = sumarDias(inicioBusqueda, k);
    if (limite && fecha > limite) break;
    const h = deUnDia(fecha, franja);
    if (h.length) { dia = fecha; huecos = h; break; }
    if (k === 0 && diaPedido) {
      const hayTramos = tramosDelDia(cfg.horario, fecha).length > 0;
      aviso = hayTramos ? 'dia_lleno' : 'dia_cerrado';
      if (hayTramos && franja !== 'cualquiera' && deUnDia(fecha, 'cualquiera').length) extra = { franjaLlena: true };
    }
  }
  if (!dia) return resultado([], null, 'sin_huecos', extra);

  if (conHoraPreferida) {
    const distancia = (h) => Math.abs(_agmMinutos(horaLocal(msDe(h.inicio))) - minPref);
    const exacto = huecos.find((h) => distancia(h) === 0);
    const cercanos = huecos.filter((h) => h !== exacto)
      .sort((a, b) => distancia(a) - distancia(b) || msDe(a.inicio) - msDe(b.inicio));
    if (exacto) {
      huecos = [exacto].concat(cercanos.slice(0, maximo - 1));
    } else {
      huecos = cercanos.slice(0, maximo).sort((a, b) => msDe(a.inicio) - msDe(b.inicio));
      if (!aviso) aviso = 'hora_ocupada';
    }
  } else {
    huecos = huecos.slice(0, maximo);
  }
  return resultado(huecos, dia, aviso, extra);
}

// El rango que lee el nodo de Google Calendar: desde el inicio de la fecha de partida
// (hoy, o la fecha pedida si es futura) hasta `dias` dias despues (14 por defecto: lo
// que recorre `ofertaDeHuecos`). Siempre a las 00:00 de La Paz.
function rangoALeer(p) {
  const hoy = fechaLocal(p.ahoraMs);
  const dias = Number(p.dias) > 0 ? Math.floor(Number(p.dias)) : AGM_MAX_DIAS_BUSQUEDA;
  const desdeFecha = _agmEsFecha(p.fechaPreferida) && p.fechaPreferida > hoy ? p.fechaPreferida : hoy;
  return { desde: isoLocal(desdeFecha, '00:00'), hasta: isoLocal(sumarDias(desdeFecha, dias), '00:00') };
}

// El candado. Se llama antes de crear (`exceptoId` vacio) y despues de crear (`exceptoId` =
// el evento propio, que no se cruza consigo mismo). `inicio` y `fin` son ISO (o ms). Falla
// cerrado: si el intervalo no se entiende, hay cruce.
function hayCruce(p) {
  const inicioMs = msDe(p.inicio);
  const finMs = msDe(p.fin);
  if (Number.isNaN(inicioMs) || Number.isNaN(finMs) || !(finMs > inicioMs)) return { cruce: true, con: [] };
  const con = ocupados(p.eventos, { ignorarIds: p.exceptoId ? [p.exceptoId] : [] })
    .filter((o) => _agmSeCruza(o, inicioMs, finMs)).map((o) => o.id);
  return { cruce: con.length > 0, con: con };
}

// ---------------------------------------------------------------------------
// Titulo y descripcion de la cita
// ---------------------------------------------------------------------------
function _agmLimpiarNombre(t) {
  return String(t === undefined || t === null ? '' : t).replace(/[()\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}
function _agmMarcaDeServicio(servicio) {
  const s = _agmSimple(servicio);
  if (/recien nacido|neonat/.test(s)) return 'RN';
  if (/nino sano|^cns$/.test(s)) return 'CNS';
  return '';
}
function _agmNombreCompleto(p) {
  const ap = _agmLimpiarNombre(p && p.apellidos);
  const no = _agmLimpiarNombre(p && p.nombres);
  return ap && no ? ap + ', ' + no : (ap || no);
}

// «Apellidos, Nombres (CNS)» para el control del niño sano y «(RN)» para el recien nacido
// (la marca la pone el codigo, no el modelo; el orden es el del doctor y `Comprobar
// reserva` lo lee con o sin «Cita» delante). Hermanos del mismo apellido:
// «Pérez Gómez, Ana y Luis (CNS)»; de apellido distinto: «Pérez, Ana / Rojas, Luis (CNS)».
// Otro servicio: solo el nombre, sin marca. Sin paciente con nombre: '' (no se agenda sin nombre).
function tituloDeLaCita(p) {
  const pacientes = _agmLista(p.pacientes).filter((x) => x && _agmNombreCompleto(x));
  let base = '';
  if (pacientes.length === 1) {
    base = _agmNombreCompleto(pacientes[0]);
  } else if (pacientes.length > 1) {
    const aps = pacientes.map((x) => _agmSimple(_agmLimpiarNombre(x.apellidos)));
    const mismo = aps[0] !== '' && aps.every((a) => a === aps[0]) && pacientes.every((x) => _agmLimpiarNombre(x.nombres));
    if (mismo) {
      const nombres = pacientes.map((x) => _agmLimpiarNombre(x.nombres));
      base = _agmLimpiarNombre(pacientes[0].apellidos) + ', '
        + nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1];
    } else {
      base = pacientes.map(_agmNombreCompleto).join(' / ');
    }
  }
  if (!base) return '';
  const marca = _agmMarcaDeServicio(p.servicio);
  return marca ? base + ' (' + marca + ')' : base;
}

// La descripcion del evento, con el MISMO formato que escribe la herramienta `agendar_cita`
// del flujo vivo (Bellido, Demo A, Platinum) y `admin/scripts/citas-a-calendario.mjs`:
//     Cliente: <nombre del perfil>
//     Telefono: <telefono>
//     Agendado por NovuChat.
// Quien las lee: `buscar_mi_cita` del flujo vivo busca el telefono como texto libre en el
// calendario (`query`), y `citasDelTelefono` (abajo) reconoce esa linea. Si el rotulo
// cambiara, las citas creadas por un flujo dejarian de verse desde el otro. Entre la del
// telefono y la ultima linea van, si se conocen, el servicio y los pacientes.
function descripcionDeLaCita(p) {
  const marca = _agmMarcaDeServicio(p.servicio);
  const servicio = marca === 'CNS' ? 'Control del niño sano'
    : (marca === 'RN' ? 'Control del recién nacido' : _agmLimpiarNombre(p.servicio));
  const nombres = _agmLista(p.pacientes).map(_agmNombreCompleto).filter(Boolean);
  const lineas = [
    'Cliente: ' + _agmLimpiarNombre(p.nombrePerfil),
    'Telefono: ' + String(p.telefono === undefined || p.telefono === null ? '' : p.telefono).trim(),
  ];
  if (servicio) lineas.push('Servicio: ' + servicio);
  if (nombres.length) lineas.push((nombres.length > 1 ? 'Pacientes: ' : 'Paciente: ') + nombres.join(' / '));
  lineas.push('Agendado por NovuChat.');
  return lineas.join('\n');
}

// Las citas FUTURAS (inicio desde `ahoraMs`) cuya descripcion trae una linea de telefono
// con el numero completo y exacto. Reconoce `Telefono:` (lo que escribe el flujo vivo),
// `Teléfono:` y `Tel:`, sin distinguir mayusculas, con espacios opcionales y un `+`
// opcional delante del numero. Un numero que es prefijo o sufijo de otro NO coincide
// (un número que es prefijo de otro no es ese otro). Una cita sin linea de telefono (las que el doctor carga a
// mano) no es del paciente del chat y no aparece. Los cancelados no cuentan; los de dia
// entero tampoco (una cita tiene hora). En orden de hora.
function citasDelTelefono(p) {
  const tel = String(p.telefono === undefined || p.telefono === null ? '' : p.telefono).trim().replace(/^\+/, '');
  if (!tel) return [];
  const out = [];
  for (const e of _agmLista(p.eventos)) {
    if (!e || typeof e !== 'object' || e.status === 'cancelled') continue;
    if (!e.start || !e.start.dateTime) continue;
    const inicioMs = msDe(e.start.dateTime);
    if (Number.isNaN(inicioMs) || inicioMs < Number(p.ahoraMs)) continue;
    // El telefono se reconoce SOLO en la linea que le toca al formato que se escribe: la segunda si la
    // primera es «Cliente: ...», la primera si no hay linea «Cliente:». Un nombre de perfil con
    // «Telefono: <otro>» o con un `<br>` adentro no hace aparecer la cita en la lista de otro numero.
    // Los saltos son `\n` (lo que escriben los flujos); solo una descripcion SIN ningun `\n` (la que
    // Google Calendar convierte a HTML al editarla) se parte por `<br>`.
    const descripcion = String(e.description || '').slice(0, 4000);
    const lineas = /\n/.test(descripcion) ? descripcion.split(/\r?\n/) : descripcion.split(/<br\s*\/?>/i);
    const linea = lineas.length > 1 && /^\s*Cliente\s*:/i.test(lineas[0]) ? lineas[1] : lineas[0];
    const m = /^\s*Tel(?:[eé]fono)?\s*:\s*\+?(\S+)\s*$/i.exec(linea || '');
    const suyo = !!m && m[1] === tel;
    if (!suyo) continue;
    let finMs = e.end && e.end.dateTime ? msDe(e.end.dateTime) : NaN;
    if (Number.isNaN(finMs)) finMs = inicioMs + 30 * 60000;
    const inicio = isoLocal(fechaLocal(inicioMs), horaLocal(inicioMs));
    out.push({
      id: e.id === undefined ? '' : String(e.id), inicioMs: inicioMs,
      inicio: inicio, fin: isoLocal(fechaLocal(finMs), horaLocal(finMs)),
      titulo: String(e.summary || ''), etiqueta: etiquetaDeHueco(inicio),
    });
  }
  out.sort((a, b) => a.inicioMs - b.inicioMs);
  return out.map((x) => ({ id: x.id, inicio: x.inicio, fin: x.fin, titulo: x.titulo, etiqueta: x.etiqueta }));
}

// ---------------------------------------------------------------------------
// Ids de boton (lo que cabe aca no se guarda en el estado)
// ---------------------------------------------------------------------------
//   'h|<inicio iso>|<servicio>'  hueco:    idDeBoton('h', {inicio, servicio})
//   'c|<eventId>'                cancelar: idDeBoton('c', {id})   (tambien idDeBoton('c', 'id'))
//   'm|<eventId>'                mover:    idDeBoton('m', {id})
// Devuelve null si falta un dato, si trae un caracter que no cabe («|», espacios…) o si el
// id pasa de 256 caracteres (el tope de Meta). `leerIdDeBoton` devuelve `{tipo:'h', inicio,
// servicio}`, `{tipo:'c', id}` o `{tipo:'m', id}`, y null con cualquier otra cosa.
function idDeBoton(tipo, datos) {
  const d = (datos && typeof datos === 'object') ? datos : { id: datos };
  let id = null;
  if (tipo === 'h') {
    if (typeof d.inicio !== 'string' || typeof d.servicio !== 'string') return null;
    id = 'h|' + d.inicio + '|' + d.servicio;
  } else if (tipo === 'c' || tipo === 'm') {
    if (typeof d.id !== 'string') return null;
    id = tipo + '|' + d.id;
  } else {
    return null;
  }
  if (id.length > AGM_MAX_ID_BOTON) return null;
  return leerIdDeBoton(id) ? id : null;
}

function leerIdDeBoton(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > AGM_MAX_ID_BOTON) return null;
  const partes = id.split('|');
  if (partes[0] === 'h' && partes.length === 3) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-04:00$/.test(partes[1]) || Number.isNaN(msDe(partes[1]))) return null;
    if (!/^[a-z0-9_]{1,80}$/.test(partes[2])) return null;
    return { tipo: 'h', inicio: partes[1], servicio: partes[2] };
  }
  if ((partes[0] === 'c' || partes[0] === 'm') && partes.length === 2) {
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(partes[1])) return null;
    return { tipo: partes[0], id: partes[1] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nombre del paciente
// ---------------------------------------------------------------------------
const AGM_NO_ES_NOMBRE = ['hola', 'holi', 'buenas', 'buenos', 'buen', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches',
  'gracias', 'si', 'no', 'ok', 'okey', 'ya', 'dale', 'listo', 'bueno', 'claro', 'perfecto', 'quiero', 'cita', 'una', 'un',
  'por', 'favor', 'menu', 'saludos', 'hello', 'hi'];
const AGM_PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von'];

function _agmCapitalizar(texto) {
  // Solo si vino todo en minusculas o todo en mayusculas; si el paciente lo escribio con
  // su mayuscula, se respeta.
  if (texto !== texto.toLowerCase() && texto !== texto.toUpperCase()) return texto;
  return texto.toLowerCase().split(' ').map((w, i) => (i > 0 && AGM_PARTICULAS.indexOf(w) >= 0)
    ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// 'Ana Pérez Gómez' -> {apellidos:'Pérez Gómez', nombres:'Ana'}. Heuristica simple, para el
// caso en que el modelo no separo el nombre:
//   - con coma: «Apellidos, Nombres»;
//   - 1 palabra: solo nombre (`apellidos` queda vacio: hay que pedirlo);
//   - 2 palabras: nombre + apellido; 3: la primera es el nombre;
//   - 4 o mas palabras (sin contar «de», «la», «del»…): las DOS primeras son el nombre
//     («Juan Carlos Pérez Gómez»). El contrato decia «la primera» para 3 o mas; con cuatro
//     palabras eso dejaba un nombre compuesto dentro de los apellidos, tan comun aca, y
//     aca se corrige.
// Devuelve null si esta vacio, es demasiado largo, lleva digitos, o son solo palabras de
// saludo o de relleno («hola», «buenas tardes», «si», «ya»).
function partirNombre(texto) {
  if (typeof texto !== 'string') return null;
  const t = texto.replace(/[.;:!?¡¿"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80 || /\d/.test(t)) return null;
  const palabras = _agmSimple(t.replace(/,/g, ' ')).split(' ').filter(Boolean);
  if (!palabras.length || palabras.every((w) => AGM_NO_ES_NOMBRE.indexOf(w) >= 0)) return null;
  const limpio = _agmCapitalizar(t);
  const coma = limpio.indexOf(',');
  if (coma >= 0) {
    const ap = limpio.slice(0, coma).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const no = limpio.slice(coma + 1).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (ap && no) return { apellidos: ap, nombres: no };
  }
  const w = limpio.replace(/,/g, ' ').replace(/\s+/g, ' ').split(' ');
  if (w.length === 1) return { apellidos: '', nombres: w[0] };
  // Las particulas («de», «la»…) no cuentan como palabras al decidir cuantas son del nombre.
  const nNombres = w.filter((x) => AGM_PARTICULAS.indexOf(x.toLowerCase()) < 0).length >= 4 ? 2 : 1;
  return { apellidos: w.slice(nNombres).join(' '), nombres: w.slice(0, nNombres).join(' ') };
}
