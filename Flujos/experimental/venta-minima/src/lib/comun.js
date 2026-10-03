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
const VM_PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S{0,40} (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(amos|ó|o)\s+(tu|tus|su|sus|la|el|lo|los|las)\b|\b(?:est[aá]n?|qued[oó]|queda|quedan|quedaron|fue|fueron|ya)\s+(?:ya\s+)?reservad|reserva\s+((est[aá]|qued[oó])\s+)?(registrad|agendad)|reservamos tu|\b(?:te|le|les|se|lo|la|ya)\s+confirm(?:o|amos|é|ó|aron)\b/i;

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
// Confusables latino/cirilico/griego que se pliegan a ASCII SOLO para comparar (S-1): «pаgаdo» con una «а» cirilica se
// lee como «pagado». Las dos cadenas van en paralelo, letra por letra. El texto que sale NUNCA se pliega: es solo la forma
// en que se compara. Las letras latinas no estan en la tabla, asi que un texto legitimo no cambia.
const VM_CONFUSABLES_DE = 'аеорсухіјѕԁһӏ' + 'αεικορτυχνηβı';
const VM_CONFUSABLES_A = 'aeopcyxijsdhl' + 'aeikoptuxvnbi';
// La forma en que se COMPARA contra `VM_PROHIBIDAS` (S-1): NFKC, sin controles C1 (\u0080-\u009f) ni caracteres de formato
// (`\p{Cf}`), NFD sin marcas (`\p{M}`: tildes y marcas combinantes), en minusculas y con los confusables plegados a ASCII.
function vmCanon(t) {
  return _vmCadena(t).normalize('NFKC').replace(/[\u0080-\u009f]/g, '').replace(/\p{Cf}/gu, '').replace(/[\u115f\u1160\u3164\uffa0\u2800]/g, '')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[\u0370-\u03ff\u0400-\u052f\u0131]/g, (c) => {
      const i = VM_CONFUSABLES_DE.indexOf(c);
      return i < 0 ? c : VM_CONFUSABLES_A.charAt(i);
    });
}
// Para comparar: la forma canonica y todo lo que no es letra ni numero es un espacio.
function vmNorm(t) {
  return vmCanon(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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
  // Los controles C1 (\u0080-\u009f) se QUITAN (no se cambian por un espacio): «vali\u0090dado» queda «validado» y la red lo atrapa.
  // `\u0085` (salto de linea) si es un separador.
  const s = _vmCadena(t).replace(/[\u0080-\u0084\u0086-\u009f]/g, '').replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029<>&]/g, ' ').replace(/\s+/g, ' ').trim();
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
// `false` si el texto no es un texto o coincide con la red de palabras prohibidas. Se compara en la forma canonica
// (`vmCanon`: NFKC, sin controles C1 ni caracteres de formato, sin marcas combinantes y con los confusables plegados a
// ASCII): un «validado» con un ancho cero adentro, en ancho completo, con una «а» cirilica o con una marca combinante tambien
// se atrapa.
function vmTextoSeguro(t) {
  return typeof t === 'string' && !VM_PROHIBIDAS.test(vmCanon(t));
}

const VM_OMITIDO = '[texto omitido]';

// Las palabras de `s` (separadas por espacios) que caen dentro de una coincidencia de la red, mirando dos formas del texto:
// la canonica (`vmCanon`, con su puntuacion) y la sin puntuacion (`vmNorm`), cada una con las palabras unidas por un espacio.
// Devuelve {palabras, separadores, marcadas}; `separadores[k]` es el espacio que antecede a la palabra `k`, y `cola` el final.
function _vmPalabrasProhibidas(s) {
  const partes = s.split(/(\s+)/);
  const palabras = [];
  const separadores = [];
  let sep = '';
  for (let i = 0; i < partes.length; i++) {
    if (i % 2 === 1) { sep = partes[i]; continue; }
    if (partes[i] === '') continue;
    palabras.push(partes[i]);
    separadores.push(sep);
    sep = '';
  }
  const marcadas = palabras.map(() => false);
  const vacias = palabras.map(() => false);
  for (const forma of [vmCanon, vmNorm]) {
    const spans = [];
    let unido = '';
    palabras.forEach((w, k) => {
      const f = forma(w);
      if (f === '') { spans.push(null); if (forma === vmNorm) vacias[k] = true; return; }
      if (unido !== '') unido += ' ';
      spans.push([unido.length, unido.length + f.length]);
      unido += f;
    });
    const re = new RegExp(VM_PROHIBIDAS.source, 'gi');
    let m = re.exec(unido);
    while (m) {
      const a = m.index;
      const b = a + m[0].length;
      spans.forEach((p, k) => { if (p && p[0] < b && p[1] > a) marcadas[k] = true; });
      if (m[0].length === 0) re.lastIndex++;
      m = re.exec(unido);
    }
  }
  // Una palabra sin letras ni numeros («·», «-») entre dos marcadas se va con ellas: queda UNA marca.
  for (let k = 0; k < palabras.length; k++) {
    if (!marcadas[k]) continue;
    let j = k + 1;
    while (j < palabras.length && vacias[j] && !marcadas[j]) j++;
    if (j < palabras.length && marcadas[j]) for (let x = k + 1; x < j; x++) marcadas[x] = true;
  }
  return { palabras: palabras, separadores: separadores, marcadas: marcadas, cola: sep };
}

// El texto con cada PALABRA que forma parte de una coincidencia de la red cambiada por «[texto omitido]» (una sola marca por
// racha de palabras). Es para el texto de TERCEROS (la direccion, la referencia, las notas, el nombre): asi un «Calle 3 en,
// camino a Obrajes» no traba el mensaje entero. Se compara en las dos formas (con y sin puntuacion), se reemplaza por palabra
// entera (nada se corta ni se normaliza fuera de lo que coincide) y se llega a un punto fijo: tras reemplazar se vuelve a
// probar (hasta 3 pasadas) y, si aun coincide, devuelve solo la marca. Con `max` (opcional) el resultado no pasa de `max`
// caracteres: la marca es mas larga que una palabra corta, asi que se quitan palabras ENTERAS del final (un prefijo de palabras
// enteras de un texto limpio sigue limpio).
function vmSinProhibidas(t, max) {
  const r = _vmSinProhibidas(t);
  if (!(Number(max) > 0) || r.length <= max) return r;
  let salida = '';
  for (const w of (r.match(/\[texto omitido\]|\S+/g) || [])) {
    const sig = salida === '' ? w : salida + ' ' + w;
    if (sig.length > max) break;
    salida = sig;
  }
  return salida === '' ? r.slice(0, max) : salida;
}
function _vmSinProhibidas(t) {
  let s = _vmCadena(t);
  for (let pasada = 0; pasada < 3; pasada++) {
    const r = _vmPalabrasProhibidas(s);
    if (!r.marcadas.some(Boolean)) return s;
    let salida = '';
    let enMarca = false;
    r.palabras.forEach((w, k) => {
      if (r.marcadas[k]) {
        if (!enMarca) salida += r.separadores[k] + VM_OMITIDO;
        enMarca = true;
      } else {
        salida += r.separadores[k] + w;
        enMarca = false;
      }
    });
    s = salida + r.cola;
  }
  return VM_PROHIBIDAS.test(vmCanon(s)) || VM_PROHIBIDAS.test(vmNorm(s)) ? VM_OMITIDO : s;
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
// Claves estables (B0): el mismo estado de partida y la misma confirmacion dan SIEMPRE la misma clave
// ---------------------------------------------------------------------------
// n8n carga los datos estaticos al empezar cada ejecucion y los reescribe al terminar: dos ejecuciones
// simultaneas (el doble toque en «Confirmar pedido») parten del MISMO estado. Si la clave del pedido saliera
// del reloj (como hasta el PR-2) saldrian dos pedidos distintos; si sale de un ANCLA (el `ultimoMensajeMs` del
// estado leido, que ambas ejecuciones ven igual) y de lo que se confirma, saldria el mismo, y el servidor
// (`registrarCierre`, idempotente por tipo y referencia) cuenta UN cierre. Ningun reloj entra a la clave.

// El texto canonico de un valor JSON: claves ordenadas, sin `undefined`. Dos copias del mismo dato dan el mismo texto.
function _vmCanonico(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(_vmCanonico).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + _vmCanonico(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// Huella FNV-1a de 32 bits (sin signo) del texto canonico de `valor`. Recorre las unidades de 16 bits del texto:
// determinista, sin `crypto` (el sandbox de n8n no lo tiene). No es criptografica: es una clave, no un secreto.
function vmHuella(valor) {
  const t = typeof valor === 'string' ? valor : _vmCanonico(valor);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// La clave estable de un pedido o una reserva: {id, codigo, huella}.
//   id     = '<prefijo>-<fecha de La Paz del ancla>-<ultimos 4 del telefono>-<huella en base 36, 7 caracteres>'
//   codigo = 4 caracteres en base 36 de la misma huella (el que ve el cliente y el restaurante).
// La huella mezcla el ancla, el telefono ENTERO, la fecha y lo que se confirma (`contenido`: el carrito o la reserva).
// El ANCLA es el `ultimoMensajeMs` del estado leido al empezar el turno: dos ejecuciones simultaneas lo ven igual; el
// mismo cliente que repite despues el mismo pedido lo ve distinto, porque el estado se reescribe en cada turno.
// Sin ancla valida (0 o ausente) usa `respaldoMs`, y la clave deja de ser estable (como antes de B0).
function vmIdEstable(prefijo, from, contenido, anclaMs, respaldoMs) {
  const valido = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
  const ancla = valido(anclaMs) ? Math.floor(anclaMs) : (valido(respaldoMs) ? Math.floor(respaldoMs) : 0);
  const tel = _vmCadena(from).replace(/\D/g, '');
  const fecha = vmFechaLocal(ancla);
  const huella = vmHuella([prefijo, ancla, tel, fecha, _vmCanonico(contenido)].join('|'));
  return {
    id: prefijo + '-' + fecha + '-' + tel.slice(-4) + '-' + huella.toString(36).padStart(7, '0'),
    codigo: vmCodigoCorto(huella),
    huella: huella,
  };
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
