// =============================================================================
// UTILIDADES COMUNES DE «VENTA MINIMA v0» (prefijo `vm` / `VM_`; privadas `_vm`)
// =============================================================================
// El constructor las pega delante del codigo de cada nodo (salvo en los marcados
// «@@solo:»). Es JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`, y
// nada de red. El reloj entra por parametro (`ahoraMs`), nunca con `Date.now()`
// adentro, y la zona es America/La_Paz (UTC-4 fijo, sin horario de verano).
//
// Lo que se lee de otros nodos se lee POR NOMBRE y solo si corrieron
// (`isExecuted`): un nodo que no corrio no se lee con `$('X').item`, y un nodo de
// envio o de reporte desactivado deja pasar su entrada.
//
// EL ESTADO VIVE EN `$getWorkflowStaticData('global').ventaMinima`, con tres
// mapas: `estados` (por telefono), `vistos` (mensajes ya procesados) y `pedidos`
// (pedidos guardados, 72 h). `vmBarrer` limpia estados y vistos; los pedidos los
// barre `Armar mensajes` (T7b), porque un pedido vive mas que una conversacion.

const VM_VENCE_MS = 60 * 60 * 1000;
const VM_VENCE_COMPROBANTE_MS = 24 * 60 * 60 * 1000;
const VM_VISTOS_MS = 24 * 60 * 60 * 1000;
const VM_MAX_ESTADOS = 1000;
const VM_MAX_VISTOS = 2000;
const VM_TZ_OFFSET_MIN = -240;
const VM_MAX_ID_BOTON = 256;
const VM_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const VM_CLAVES_DIA = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const VM_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// La red de palabras que un texto al cliente o al restaurante nunca puede traer:
// presentan como hecho lo que el flujo no verifico (prohibicion 3) o prometen lo
// que no tiene mecanismo detras («solo se ofrece lo que se cumple»).
const VM_PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S* (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(ó|amos|o\b)|reservad/i;

// ---------------------------------------------------------------------------
// Nodos de n8n
// ---------------------------------------------------------------------------
// El nodo `n` si existe Y corrio en esta ejecucion; si no, null. En un JSON que no
// lo trae (el de produccion no tiene «Entrada de prueba») `$()` lanza.
function vmNodo(n) {
  try {
    const x = $(n);
    return x && x.isExecuted ? x : null;
  } catch (e) {
    return null;
  }
}
function vmPrimero(n) {
  const x = vmNodo(n);
  if (!x) return null;
  try {
    const i = x.first();
    return i && i.json ? i.json : null;
  } catch (e) {
    return null;
  }
}
function vmTodos(n) {
  const x = vmNodo(n);
  if (!x) return [];
  try {
    return x.all().map((i) => (i && i.json) || {});
  } catch (e) {
    return [];
  }
}
function vmCfg() {
  return vmPrimero('Config del negocio') || {};
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------
function _vmCadena(v) {
  return String(v === undefined || v === null ? '' : v);
}
// Para comparar: sin tildes, en minusculas, todo lo que no es letra ni numero es un espacio.
function vmNorm(t) {
  return _vmCadena(t).normalize('NFKC').replace(/\p{Cf}/gu, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function vmDigitos(v) {
  return _vmCadena(v).replace(/\D/g, '');
}
function vmRecorte(t, max) {
  const s = _vmCadena(t);
  if (!(Number(max) > 0)) return s;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
// Una linea limpia: sin controles, sin separadores de linea, sin < > &, espacios colapsados.
function vmLinea(t, max) {
  const s = _vmCadena(t).replace(/[\u0000-\u001f\u007f\u2028\u2029<>&]/g, ' ').replace(/\s+/g, ' ').trim();
  return Number(max) > 0 ? vmRecorte(s, max) : s;
}
// Una lista (arreglo o CSV) de lineas cortas, sin vacios, sin repetidos y sin marcadores `REEMPLAZAR_`.
function vmLista(v) {
  const partes = Array.isArray(v) ? v : _vmCadena(v).split(',');
  const vistos = {};
  const salida = [];
  for (const p of partes) {
    const s = vmLinea(p, 80);
    const k = vmNorm(s);
    if (!s || s.indexOf('REEMPLAZAR_') >= 0 || k === '' || Object.prototype.hasOwnProperty.call(vistos, k)) continue;
    vistos[k] = true;
    salida.push(s);
  }
  return salida;
}
function vmEntero(v, min, max, def) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}
function _vmObjeto(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o);
}
function _vmHay(o, k) {
  return _vmObjeto(o) && Object.prototype.hasOwnProperty.call(o, k);
}

// El texto de una respuesta de Gemini (generateContent, o el nodo de LangChain con
// `simplify`). '' si vino un error o algo que no se reconoce.
function vmTextoDeGemini(j) {
  if (!j || typeof j !== 'object' || j.error) return '';
  const partes = (c) => (c && Array.isArray(c.parts))
    ? c.parts.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n') : '';
  if (typeof j.content === 'string') return j.content;
  const c1 = partes(j.content);
  if (c1) return c1;
  const cand = Array.isArray(j.candidates) ? j.candidates[0] : null;
  const c2 = cand ? partes(cand.content) : '';
  if (c2) return c2;
  for (const k of ['text', 'transcription', 'output', 'response']) {
    if (typeof j[k] === 'string' && j[k].trim()) return j[k];
  }
  return '';
}
// El objeto JSON que Gemini devolvio como texto; null si no es un objeto.
function vmJsonDeGemini(j) {
  const t = vmTextoDeGemini(j).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!t) return null;
  try {
    const o = JSON.parse(t);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch (e) {
    return null;
  }
}
// `false` si el texto no es un texto o coincide con la red de palabras prohibidas. Se compara en NFKC y sin
// caracteres de formato (`\p{Cf}`: ancho cero, guion blando, marcas bidireccionales): un «validado» con un
// ancho cero adentro, o escrito en ancho completo, también se atrapa.
function vmTextoSeguro(t) {
  return typeof t === 'string' && !VM_PROHIBIDAS.test(t.normalize('NFKC').replace(/\p{Cf}/gu, ''));
}
// El texto con cada coincidencia de la red de prohibidas cambiada por «…». Es para el texto de TERCEROS (la dirección, la
// referencia, las notas, el nombre): así un «Calle 3 en camino a Obrajes» no traba el mensaje entero al cliente. Solo el texto
// que coincide sale normalizado (NFKC y sin `\p{Cf}`); el resto sale tal cual.
function vmSinProhibidas(t) {
  const s = _vmCadena(t);
  const c = s.normalize('NFKC').replace(/\p{Cf}/gu, '');
  if (!VM_PROHIBIDAS.test(c)) return s;
  return c.replace(new RegExp(VM_PROHIBIDAS.source, 'gi'), '…');
}

// ---------------------------------------------------------------------------
// Estado por telefono, repetidos y pedidos
// ---------------------------------------------------------------------------
function _vmClaveValida(from) {
  return /^\d{6,20}$/.test(_vmCadena(from));
}
function _vmIdValido(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 300
    && id !== '__proto__' && id !== 'constructor' && id !== 'prototype';
}
function _vmVence(paso) {
  return paso === 'esperando_comprobante' ? VM_VENCE_COMPROBANTE_MS : VM_VENCE_MS;
}

// `ventaMinima` de los datos estaticos, con sus tres mapas (`estados`, `vistos`,
// `pedidos`); los crea si faltan. `null` si el nodo no tiene datos estaticos. Crea
// tambien `reservasDelDia` (vacio): es de `reserva.js` (T3, tope diario de reservas
// por telefono, `{dia, n}`), que se limpia sola; `vmBarrer` no la toca.
function vmSd() {
  let raiz = null;
  try { raiz = $getWorkflowStaticData('global'); } catch (e) { return null; }
  if (!_vmObjeto(raiz)) return null;
  if (!_vmObjeto(raiz.ventaMinima)) raiz.ventaMinima = {};
  const sd = raiz.ventaMinima;
  for (const k of ['estados', 'vistos', 'pedidos', 'reservasDelDia']) {
    if (!_vmObjeto(sd[k])) sd[k] = {};
  }
  return sd;
}

function vmEstadoBase() {
  return {
    paso: 'inicio',
    carrito: [], pendiente: null,
    entrega: '', direccion: '', referencia: '', nombre: '',
    pedidoId: '', reserva: null,
    extraccionesVacias: 0, ilegibles: 0, ultimaDerivacionMs: 0,
    ultimoMensajeMs: 0, ultimoMensajeId: '',
  };
}

// El estado de `from`; el de partida si no hay, si esta vencido (60 min; 24 h en
// `esperando_comprobante`, como el QR del servidor) o si no hay datos estaticos.
// Siempre una copia: quien lo cambia no toca lo guardado hasta `vmEscribirEstado`.
function vmLeerEstado(sd, from, ahoraMs) {
  const base = vmEstadoBase();
  if (!sd || !_vmClaveValida(from) || !_vmHay(sd.estados, from)) return base;
  const e = sd.estados[from];
  if (!_vmObjeto(e)) return base;
  if (!(Number(ahoraMs) - Number(e.ultimoMensajeMs || 0) < _vmVence(e.paso))) return base;
  return Object.assign(base, JSON.parse(JSON.stringify(e)));
}

// Guarda una copia del estado con `ultimoMensajeMs = ahoraMs`. `false` si no se pudo.
function vmEscribirEstado(sd, from, estado, ahoraMs) {
  if (!sd || !_vmClaveValida(from) || !_vmObjeto(estado) || !Number.isFinite(Number(ahoraMs))) return false;
  if (!_vmObjeto(sd.estados)) sd.estados = {};
  const copia = JSON.parse(JSON.stringify(estado));
  copia.ultimoMensajeMs = Number(ahoraMs);
  sd.estados[String(from)] = copia;
  vmBarrer(sd, ahoraMs);
  return true;
}

// Quita estados vencidos y repetidos de mas de 24 h, y recorta cada mapa a su tope
// (se van los mas viejos). NO toca `pedidos`: los barre `Armar mensajes` con 72 h.
function vmBarrer(sd, ahoraMs) {
  const r = { estados: 0, vistos: 0 };
  const ahora = Number(ahoraMs);
  if (!sd || !Number.isFinite(ahora)) return r;
  if (_vmObjeto(sd.estados)) {
    for (const k of Object.keys(sd.estados)) {
      const e = sd.estados[k];
      if (!_vmObjeto(e) || !(ahora - Number(e.ultimoMensajeMs || 0) < _vmVence(e.paso))) {
        delete sd.estados[k];
        r.estados++;
      }
    }
    const claves = Object.keys(sd.estados);
    if (claves.length > VM_MAX_ESTADOS) {
      claves.sort((a, b) => Number(sd.estados[a].ultimoMensajeMs || 0) - Number(sd.estados[b].ultimoMensajeMs || 0));
      for (const k of claves.slice(0, claves.length - VM_MAX_ESTADOS)) { delete sd.estados[k]; r.estados++; }
    }
  }
  if (_vmObjeto(sd.vistos)) {
    for (const k of Object.keys(sd.vistos)) {
      if (!(ahora - Number(sd.vistos[k]) < VM_VISTOS_MS)) { delete sd.vistos[k]; r.vistos++; }
    }
    const claves = Object.keys(sd.vistos);
    if (claves.length > VM_MAX_VISTOS) {
      claves.sort((a, b) => Number(sd.vistos[a]) - Number(sd.vistos[b]));
      for (const k of claves.slice(0, claves.length - VM_MAX_VISTOS)) { delete sd.vistos[k]; r.vistos++; }
    }
  }
  return r;
}

// ¿Este mensaje ya se proceso en las ultimas 24 h? Un id vacio o raro nunca cuenta como visto.
function vmYaVisto(sd, idMensaje, ahoraMs) {
  if (!sd || !_vmIdValido(idMensaje) || !_vmHay(sd.vistos, idMensaje)) return false;
  return Number(ahoraMs) - Number(sd.vistos[idMensaje]) < VM_VISTOS_MS;
}
function vmMarcarVisto(sd, idMensaje, ahoraMs) {
  if (!sd || !_vmIdValido(idMensaje) || !Number.isFinite(Number(ahoraMs))) return false;
  if (!_vmObjeto(sd.vistos)) sd.vistos = {};
  sd.vistos[idMensaje] = Number(ahoraMs);
  vmBarrer(sd, ahoraMs);
  return true;
}

// La atencion del telefono: lo que devolvio la ingesta del entrante si lo trae, y si
// no, lo que dijo `configuracionFlujo`. Ante la duda, normal.
function vmAtencion(rIngesta, cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const a = rIngesta && typeof rIngesta === 'object' && rIngesta.atencion && typeof rIngesta.atencion === 'object'
    ? rIngesta.atencion : null;
  const estados = ['normal', 'operador', 'bloqueado'];
  const estado = a && estados.indexOf(a.estado) >= 0 ? a.estado
    : (estados.indexOf(c.atencionEstado) >= 0 ? c.atencionEstado : 'normal');
  const avisarIngesta = rIngesta && typeof rIngesta === 'object' ? rIngesta.avisarRecepcion : '';
  const avisarCfg = a && a.avisarRecepcion !== undefined ? a.avisarRecepcion : c.atencionAvisarRecepcion;
  const avisar = ['operador', 'bloqueado'].indexOf(avisarIngesta || avisarCfg) >= 0 ? (avisarIngesta || avisarCfg) : '';
  return {
    estado: estado,
    avisar: avisar,
    mensajeFijo: String((a && a.mensajeFijo) || c.atencionMensajeFijo || '').trim(),
    respuestas: Number(a && a.respuestasEnVentana !== undefined ? a.respuestasEnVentana : c.atencionRespuestas) || 0,
    venceEn: String((a && a.ventanaVenceEn) || c.atencionVenceEn || ''),
  };
}

// ¿El telefono empieza con alguno de los prefijos del CSV? Sin prefijos NO se permite
// (responder a un numero extranjero cuesta su tarifa).
function vmPrefijoPermitido(from, csv) {
  const f = vmDigitos(from);
  if (!f) return false;
  const ps = _vmCadena(csv).split(',').map(vmDigitos).filter(Boolean);
  return ps.length > 0 && ps.some((p) => f.startsWith(p));
}

// ---------------------------------------------------------------------------
// Botones y codigos
// ---------------------------------------------------------------------------
// El id de un boton: `tipo|parte|parte…`, hasta 256 caracteres. Devuelve `null` (nunca
// un id recortado) si el tipo o una parte llevan un caracter que no es de la lista
// (`A-Z a-z 0-9 _ . : = ~ + -`), si una parte esta vacia o si el id pasa de 256.
const _VM_TIPO_BOTON = /^[A-Za-z0-9_]{1,20}$/;
const _VM_PARTE_BOTON = /^[A-Za-z0-9_.:=~+-]{1,200}$/;
function vmIdDeBoton(tipo, ...partes) {
  const todas = [tipo].concat(partes).map(_vmCadena);
  if (!_VM_TIPO_BOTON.test(todas[0])) return null;
  for (const p of todas.slice(1)) {
    if (!_VM_PARTE_BOTON.test(p)) return null;
  }
  const id = todas.join('|');
  return id.length <= VM_MAX_ID_BOTON ? id : null;
}
function vmLeerBoton(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > VM_MAX_ID_BOTON) return null;
  const p = id.split('|');
  if (!_VM_TIPO_BOTON.test(p[0])) return null;
  for (const x of p.slice(1)) {
    if (!_VM_PARTE_BOTON.test(x)) return null;
  }
  return { tipo: p[0], partes: p.slice(1) };
}

// 4 caracteres en base 36, en mayusculas, de un instante (el codigo que ve el cliente).
function vmCodigoCorto(ms) {
  const n = Math.floor(Math.abs(Number(ms)) || 0);
  return n.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

// ---------------------------------------------------------------------------
// Fechas y horario (America/La_Paz)
// ---------------------------------------------------------------------------
function _vmPad2(n) { return (n < 10 ? '0' : '') + n; }
function _vmEsFecha(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const p = f.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}
// Minutos desde medianoche de «H:MM» o «HH:MM» (24:00 vale 1440); NaN si no se entiende.
function _vmMinutos(hhmm) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(_vmCadena(hhmm));
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return NaN;
  return h * 60 + mi;
}
function _vmHHMM(min) { return _vmPad2(Math.floor(min / 60)) + ':' + _vmPad2(min % 60); }

function vmFechaLocal(ms) {
  const d = new Date(Number(ms) + VM_TZ_OFFSET_MIN * 60000);
  return d.getUTCFullYear() + '-' + _vmPad2(d.getUTCMonth() + 1) + '-' + _vmPad2(d.getUTCDate());
}
function vmHoraLocal(ms) {
  const d = new Date(Number(ms) + VM_TZ_OFFSET_MIN * 60000);
  return _vmPad2(d.getUTCHours()) + ':' + _vmPad2(d.getUTCMinutes());
}
// «viernes» de «2026-10-09»; null si la fecha no existe. Lo calcula el codigo, nunca el modelo.
function vmDiaSemana(fecha) {
  if (!_vmEsFecha(fecha)) return null;
  const p = fecha.split('-').map(Number);
  return VM_DIAS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
}
// El instante de una fecha y hora de La Paz; NaN si no se entiende. Sin hora, la medianoche.
function vmMsLocal(fecha, hhmm) {
  if (!_vmEsFecha(fecha)) return NaN;
  const min = hhmm === undefined ? 0 : _vmMinutos(hhmm);
  if (Number.isNaN(min)) return NaN;
  const p = fecha.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]) + min * 60000 - VM_TZ_OFFSET_MIN * 60000;
}
// «viernes 9 de octubre a las 20:00» (sin hora: «viernes 9 de octubre»); '' si la fecha no existe.
function vmFechaLegible(fecha, hhmm) {
  if (!_vmEsFecha(fecha)) return '';
  const p = fecha.split('-').map(Number);
  const base = vmDiaSemana(fecha) + ' ' + p[2] + ' de ' + VM_MESES[p[1] - 1];
  if (hhmm === undefined || hhmm === null || hhmm === '') return base;
  const min = _vmMinutos(hhmm);
  return Number.isNaN(min) ? base : base + ' a las ' + _vmHHMM(min % 1440);
}
// Los proximos `n` dias (14 por omision) desde hoy en La Paz: `[{fecha, dia, texto, relativo}]`,
// con `relativo` «hoy», «mañana» o ''. Es la tabla que se le da al modelo para que no calcule fechas.
function vmTablaDeDias(ahoraMs, n) {
  const cuantos = Math.max(1, Math.min(62, Number.isInteger(n) ? n : 14));
  const hoy = vmFechaLocal(ahoraMs).split('-').map(Number);
  const tabla = [];
  for (let i = 0; i < cuantos; i++) {
    const d = new Date(Date.UTC(hoy[0], hoy[1] - 1, hoy[2] + i));
    const fecha = d.getUTCFullYear() + '-' + _vmPad2(d.getUTCMonth() + 1) + '-' + _vmPad2(d.getUTCDate());
    tabla.push({
      fecha: fecha,
      dia: VM_DIAS[d.getUTCDay()],
      texto: vmFechaLegible(fecha),
      relativo: i === 0 ? 'hoy' : (i === 1 ? 'mañana' : ''),
    });
  }
  return tabla;
}

// Los tramos de un dia: «cerrado», «12:00-22:00» o «12:00-15:00/18:00-23:00». Un tramo
// no cruza la medianoche (hasta 24:00 si cierra a esa hora). null si algo no se entiende.
function _vmTramos(texto) {
  const val = _vmCadena(texto).trim().toLowerCase();
  if (val === 'cerrado' || val === 'cerrada') return [];
  const tramos = [];
  for (const tr of val.split('/')) {
    const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(tr);
    if (!m) return null;
    const d = _vmMinutos(m[1]);
    const f = _vmMinutos(m[2]);
    if (Number.isNaN(d) || Number.isNaN(f) || !(f > d) || d >= 1440) return null;
    tramos.push({ d: d, f: f });
  }
  tramos.sort((a, b) => a.d - b.d);
  for (let j = 1; j < tramos.length; j++) {
    if (tramos[j].d < tramos[j - 1].f) return null;
  }
  return tramos.map((x) => ({ desde: _vmHHMM(x.d), hasta: _vmHHMM(x.f) }));
}
// El horario en la forma `{lun:[{desde,hasta}], mar:[…], …, dom:[]}` desde el CSV
// «lun=12:00-22:00,…,dom=cerrado» o desde un objeto ya convertido (sus valores pueden ser
// arreglos de tramos o el texto de un dia). Un dia que no se nombra queda cerrado. `null` si
// algo no se entiende (clave de dia desconocida o repetida, hora invalida, tramos cruzados).
function vmHorario(v) {
  const h = {};
  for (const k of VM_CLAVES_DIA) h[k] = [];
  if (_vmObjeto(v)) {
    let alguno = false;
    for (const k of Object.keys(v)) {
      if (k.charAt(0) === '_') continue;
      if (VM_CLAVES_DIA.indexOf(k) < 0) return null;
      alguno = true;
      const x = v[k];
      if (typeof x === 'string') {
        const tr = _vmTramos(x);
        if (tr === null) return null;
        h[k] = tr;
      } else if (Array.isArray(x)) {
        const tr = [];
        for (const t of x) {
          const d = t ? _vmMinutos(t.desde) : NaN;
          const f = t ? _vmMinutos(t.hasta) : NaN;
          if (Number.isNaN(d) || Number.isNaN(f) || !(f > d) || d >= 1440) return null;
          tr.push({ desde: _vmHHMM(d), hasta: _vmHHMM(f) });
        }
        h[k] = tr;
      } else {
        return null;
      }
    }
    return alguno ? h : null;
  }
  const t = _vmCadena(v).trim();
  if (!t) return null;
  const nombrados = {};
  for (const par of t.split(',')) {
    if (!par.trim()) continue;
    const i = par.indexOf('=');
    if (i < 0) return null;
    const clave = vmNorm(par.slice(0, i)).slice(0, 3);
    if (VM_CLAVES_DIA.indexOf(clave) < 0 || nombrados[clave]) return null;
    nombrados[clave] = true;
    const tr = _vmTramos(par.slice(i + 1));
    if (tr === null) return null;
    h[clave] = tr;
  }
  return Object.keys(nombrados).length ? h : null;
}

// ¿Esta abierto ahora? `{abierto, hoyCerrado, sinHorario}`. Sin horario (o uno que no se
// entiende) NO se bloquea nada: abierto con `sinHorario: true`. `hoyCerrado`: hoy no tiene tramos.
function vmAbierto(horario, ahoraMs) {
  const h = vmHorario(horario);
  if (!h) return { abierto: true, hoyCerrado: false, sinHorario: true };
  const d = new Date(Number(ahoraMs) + VM_TZ_OFFSET_MIN * 60000);
  const tramos = h[VM_CLAVES_DIA[d.getUTCDay()]];
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return {
    abierto: tramos.some((x) => min >= _vmMinutos(x.desde) && min < _vmMinutos(x.hasta)),
    hoyCerrado: tramos.length === 0,
    sinHorario: false,
  };
}
