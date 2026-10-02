// =============================================================================
// AVISOS AL RESTAURANTE (`av*`) — «Venta mínima v0» de Q'Taco (T4, §4.2 del diseño)
// =============================================================================
//
// Qué hace. Arma, SIN enviar nada, los mensajes que el flujo le manda al
// restaurante cuando entra un pedido, un comprobante, una solicitud de reserva
// o una derivación. Todo texto sale de código: el modelo no escribe aquí.
//
// JavaScript plano para un nodo Code de n8n: sin require, URL, Buffer ni crypto;
// el reloj entra por parámetro (`ahoraMs`); zona La Paz, UTC-4 fijo. Autosuficiente:
// no llama a `comun.js`. Si existe `VM_PROHIBIDAS` (la define `comun.js`), manda esa;
// si no, rige la copia local `AV_PROHIBIDAS`.
//
// ESTADO. Todo vive en `sd.av = { ventana: {<tel>: msUltimoEntrante}, dia: {fecha, n} }`
// (`sd` es el estado estático del flujo, el que `comun.js` llama `ventaMinima`).
// Solo escriben `avAnotarEntrante` y `avContar`. `avArmar`, `avPlan` y las demás
// NO modifican `sd`. `avContar` lo llama `Armar mensajes` (T7b) con los envíos que
// SÍ salieron; `avAnotarEntrante`, `Interpretar entrada` (T1) cuando quien escribe
// es un destinatario.
//
// DOS TIEMPOS (DD5). 1) Plantilla de utilidad a cada destinatario, siempre.
// 2) Texto con el detalle completo SOLO si la ventana de 24 h de ese destinatario
// está abierta: se cuenta como abierta si su último mensaje entrante fue hace
// MENOS de 23 h 30 min. Jamás se intenta el texto «a ver si pasa». La imagen del
// comprobante (solo rol `completo`, si `datos.mediaId` viene) también va solo con
// ventana abierta. Derivación: ventana abierta → solo texto libre; cerrada → plantilla.
// Con ventana abierta el texto de detalle hace de respaldo de la plantilla, así que
// `respaldo` es siempre `null` y T7b salta «Aviso de respaldo» cuando es null.
//
// PLANTILLAS POR EVENTO, configurables (claves de `cfg`, que salen de `configBase`). NO HAY NOMBRE
// POR OMISIÓN: ninguna plantilla se inventa en el código. Sin la clave del evento, ningún ítem de tipo
// plantilla sale y se anota `plantilla_no_configurada_<evento>` (con ventana abierta cae al texto). Los
// nombres reales (`pedido_registrado`, `appointment_confirmed`…) viven en la configuración del negocio.
// Las claves son estas tres (más sus idiomas y órdenes); `plantillaAviso` e `idiomaPlantilla`, del diseño
// original, quedan DESCARTADAS: no existe una plantilla única para todos los eventos.
//   pedido      → `plantillaPedido`, idioma `idiomaPlantillaPedido` (def. `es`),
//                 orden `ordenPedido` (def. `items,total,modalidad,cotejo`):
//                 items «N.º <código> de <n> ítems» · total «Bs <total>» · modalidad · cotejo.
//                 La variable `modalidad` ({{3}}) lleva el detalle POR ROL (ver `avModalidadVariable`):
//                 `completo`, en delivery: «Delivery a <dirección> (<referencia>) · recibe <nombre> · cel <teléfono>»;
//                 `cocina`: «<modalidad> · <ítems compactos con sus notas>», sin teléfono ni dirección.
//   reserva     → `plantillaReserva` (p. ej. `appointment_confirmed`, de la biblioteca de Meta, texto
//                 fijo; NO se edita), `idiomaPlantillaReserva`, `ordenReserva`
//                 (def. `destinatario,cuando,detalle,codigo`): destinatario = nombre de quien
//                 recibe el aviso («equipo» si falta) · cuando = fecha y hora de la solicitud
//                 · detalle «Reserva N personas · cliente · zona» · codigo.
//                 Esa plantilla presenta como programada una SOLICITUD: es la decisión P2
//                 pendiente de Andres, por eso nombre y orden son configuración.
//   derivación  → `plantillaDerivacion` (si no existe, hereda `plantillaReserva` SOLO si esa sí está
//                 configurada; '' = sin plantilla), `idiomaPlantillaDerivacion`, `ordenDerivacion`
//                 (mismos tokens que reserva).
//   Idiomas: def. `es` (la derivación que hereda la plantilla de reserva hereda su idioma).
//   Otras claves: `prefijosPermitidos` (def. «591»), `topeAvisosDia` (def. 150, en MENSAJES de aviso).
//   Una variable de plantilla no admite saltos de línea, 5+ espacios seguidos ni vacío:
//   `avParametro` las sanea siempre (vacío → «—»).
//
// DESTINATARIOS. CSV `rol:tel[:Nombre]` (coma o punto y coma). `completo` ve teléfono y
// dirección del cliente; `cocina` solo ítems y notas (primer nombre, sin teléfono, sin
// dirección, sin diferencias del cotejo, sin números largos). Rol desconocido → `cocina`.
// Un número repetido queda con el rol de menos privilegio. Nunca va al propio número de
// quien escribe. Las variables de plantilla de reserva y de derivación no llevan teléfono ni dirección;
// la `modalidad` del pedido lleva teléfono y dirección SOLO para el rol `completo` (R2) y los ítems
// SOLO para `cocina`.
//
// TEXTO DEL CLIENTE. Todo texto que escribió un tercero pasa por `avLimpio`: sin enlaces (ni siquiera una
// palabra con la forma `a.bc`), sin `{}<>&`, sin las marcas de formato `* _ ~` y la comilla invertida, en
// NFKC y sin caracteres de formato (`\p{Cf}`) antes de compararlo con la red de prohibidas, y en tiempo
// lineal. En la derivación el texto libre sale enmarcado: «Nota del cliente: …».
//
// FORMA DE `datos` (todos los campos son opcionales; lo que falta sale como «—»):
//   tipo `pedido` | `comprobante`:
//     lineas:[{cantidad, nombre, detalle}]   total: número en Bs (nunca el delivery)
//     modalidad: 'delivery' | 'recojo'       codigo: código corto del pedido
//     resultado: 'cuadra'|'no_cuadra'|'ilegible'|'sin_cotejo'|'sin_qr'|'ya_cotejado'
//       (por defecto: `sin_qr` en `pedido`, `sin_cotejo` en `comprobante`; con
//        `ya_cotejado` NO hay aviso: error `sin_aviso_ya_cotejado`)
//     nombre, telefono (quien escribe), direccion, referencia (solo se muestran en delivery y rol completo)
//     diferencias: [texto]  (solo rol completo)   mediaId: id del medio del comprobante (solo rol completo)
//   tipo `reserva`:
//     reserva:{personas, fecha 'AAAA-MM-DD', hora 'HH:MM', zona, nombre, celebracion, requerimiento}
//     codigo, nombre, telefono
//   tipo `transferencia` (derivación a una persona):
//     motivo (lo que escribió el cliente), nombre, telefono, codigo
//
// CIERRES del detalle. Pedido y comprobante con QR: «Revisen el pago en su banco antes
// de despachar.» Con `resultado: 'sin_qr'`: «El pago se coordina con el cliente al entregar
// o al recoger.» Reserva y derivación tienen cierres propios, sin la frase del banco.
//
// ERRORES de `avPlan` (arreglo de textos): `tope_avisos_dia`, `sin_destinatarios`,
// `sin_aviso_ya_cotejado`, `tipo_desconocido`, `sin_datos_reserva`, `plantilla_invalida`,
// `sin_plantilla_derivacion`, `plantilla_no_configurada_<evento>` (pedido, reserva, derivacion),
// `sin_aviso_posible`, `orden_invalido_<evento>`.
//
// Ítems devueltos: {para, rol, payload, respaldo:null, esPlantilla, clase} con
// `clase` ∈ `plantilla` | `detalle` | `imagen`. La imagen NO cuenta como «el aviso salió».

// La copia local de la red de palabras que el asistente jamás dice (la de `comun.js` manda si existe).
const AV_PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S* (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(ó|amos|o\b)|reservad/i;

const AV_VENTANA_MS = 23.5 * 60 * 60 * 1000; // 23 h 30 min
const AV_TOPE_DIA_DEF = 150;
const AV_UTC_MENOS_4_MS = 4 * 60 * 60 * 1000;
const AV_TIPOS = ['pedido', 'comprobante', 'reserva', 'transferencia'];
const AV_ORDEN_PEDIDO = ['items', 'total', 'modalidad', 'cotejo'];
const AV_ORDEN_AGENDA = ['destinatario', 'cuando', 'detalle', 'codigo'];
const AV_CIERRE_PAGO = 'Revisen el pago en su banco antes de despachar.';
const AV_CIERRE_SIN_QR = 'El pago se coordina con el cliente al entregar o al recoger.';
const AV_CIERRE_RESERVA = 'Es una solicitud: revísenla según sus mesas y respondan al cliente.';
const AV_CIERRE_DERIVACION = 'El cliente también puede escribirles directo con el botón.';
const AV_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const AV_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const AV_ENLACE = /(?:https?:\/\/|www\.)\S+|\b(?:wa\.me|t\.me|bit\.ly|goo\.gl|tinyurl\.com)\/\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|bo|me|io|co|app|ly|link|info|biz|xyz|site|online)\b(?:\/\S*)?/gi;

// --- Red de palabras y saneo ------------------------------------------------------------------

function avProhibidas() {
  try {
    if (typeof VM_PROHIBIDAS !== 'undefined' && VM_PROHIBIDAS instanceof RegExp) return VM_PROHIBIDAS;
  } catch (e) { /* VM_PROHIBIDAS aún sin declarar: rige la copia local */ }
  return AV_PROHIBIDAS;
}

// Se COMPARA en NFKC y sin caracteres de formato (`avCanon`): «va​lidado» con un ancho cero, o en ancho completo,
// también se atrapa. Solo el texto que coincide sale normalizado; el resto sale tal cual (para no cambiar «N.º»).
function avSinProhibidas(t) {
  const re = avProhibidas();
  const s = String(t);
  const c = avCanon(s);
  const base = re.flags.replace(/[gy]/g, '');
  if (!new RegExp(re.source, base).test(c)) return s;
  return c.replace(new RegExp(re.source, base + 'g'), '…');
}

function avDigitos(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
}

/** NFKC y sin caracteres de formato (`\p{Cf}`: ancho cero, controles bidireccionales, guion blando): la forma en que se COMPARA. */
function avCanon(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').replace(/\p{Cf}/gu, '');
}

/** Quita, sin regex (tiempo lineal), los espacios y los «·» del principio y del final. */
function avSinBordes(s) {
  const sep = (c) => c === '·' || /\s/.test(c);
  let i = 0;
  let j = s.length;
  while (i < j && sep(s.charAt(i))) i++;
  while (j > i && sep(s.charAt(j - 1))) j--;
  return s.slice(i, j);
}

/**
 * Una sola línea limpia: sin saltos ni tabuladores (quedan « · »), sin enlaces («[enlace omitido]», también cualquier
 * palabra con la forma `a.bc`), sin `{}<>&` ni marcas de formato de WhatsApp (`* _ ~` y la comilla invertida), sin palabras
 * prohibidas («…»), sin espacios repetidos y con tope de caracteres. Con `opc.cocina` se quitan además los números largos
 * (teléfonos, cuentas, documentos). Devuelve '' si no queda nada.
 * TIEMPO LINEAL: el texto se recorta a `max * 2` antes de aplicar ninguna expresión regular, y los bordes « · » se quitan
 * a mano (la forma `(\s*·\s*)+$` tenía retroceso exponencial: 24 «· » seguidos tardaban 1,6 s y 90 no terminaban).
 */
function avLimpio(t, max, opc) {
  const tope = (Number.isFinite(max) && max > 0) ? Math.floor(max) : 500;
  let s = (t === undefined || t === null) ? '' : String(t);
  if (s.length > tope * 2) s = Array.from(s.slice(0, tope * 2 + 1)).slice(0, tope * 2).join('');
  // NFKC (ancho completo, ligaduras) y sin caracteres de formato, salvo «º» y «ª» (NFKC los cambia por «o» y «a»: «N.º»).
  s = s.split(/([ºª])/).map((p, i) => (i % 2 ? p : p.normalize('NFKC'))).join('').replace(/\p{Cf}/gu, '');
  s = s.replace(AV_ENLACE, ' [enlace omitido] ');
  s = s.replace(/[\r\n\t\u000b\u000c\u0085\u2028\u2029]+/g, ' · ');
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '');
  s = s.replace(/[{}<>&*_~`]/g, ' ');
  // Cualquier palabra con la forma `a.bc` (un dominio sin lista, un enlace sin esquema) se omite entera.
  s = s.split(' ').map((w) => (/\w\.\w{2,}/.test(w) ? '[enlace omitido]' : w)).join(' ');
  if (opc && opc.cocina) {
    s = s.replace(/\+?\d[\d\s.-]{5,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '…' : m));
    s = s.replace(/\d{7,}/g, '…');
  }
  s = avSinProhibidas(s);
  s = avSinBordes(s.replace(/\s{2,}/g, ' '));
  s = avSinBordes(s.replace(/(?:\s·){2,}/g, ' ·'));
  const cps = Array.from(s);
  if (cps.length > tope) s = avSinBordes(cps.slice(0, tope).join(''));
  return s;
}

/** El texto de una variable de plantilla: sin saltos, sin 5+ espacios, con tope (500) y nunca vacío («—»). */
function avParametro(t, max, opc) {
  return avLimpio(t, max === undefined ? 500 : max, opc) || '—';
}

function avPrimerNombre(n, opc) {
  return avLimpio(n, 60, opc).split(' ')[0] || '';
}

// --- Destinatarios ----------------------------------------------------------------------------

function avPrefijos(prefijos) {
  const lista = String(prefijos === undefined || prefijos === null || prefijos === '' ? '591' : prefijos)
    .split(/[,;\s]+/).map(avDigitos).filter(Boolean);
  return lista.length ? lista : ['591'];
}

/** Quita repetidos (queda el rol de menos privilegio), el propio número y lo que no es un teléfono permitido. */
function avUnificar(lista, propio, pref) {
  const porTel = {};
  const out = [];
  for (const x of lista) {
    const tel = avDigitos(x && x.tel);
    if (tel.length < 8 || tel.length > 15) continue;
    if (!pref.some((p) => tel.indexOf(p) === 0)) continue;
    if (propio && tel === propio) continue;
    const rol = (x && x.rol === 'completo') ? 'completo' : 'cocina';
    const nombre = avLimpio(x && x.nombre, 40);
    if (porTel[tel]) {
      if (rol === 'cocina') porTel[tel].rol = 'cocina';
      if (!porTel[tel].nombre) porTel[tel].nombre = nombre;
      continue;
    }
    porTel[tel] = { rol, tel, nombre };
    out.push(porTel[tel]);
  }
  return out;
}

/**
 * `rol:tel[:Nombre]` separados por coma o punto y coma → `[{rol, tel, nombre}]`: únicos, de 8 a 15 dígitos,
 * con prefijo permitido (def. «591») y distintos de `from`. Rol desconocido → `cocina`; un marcador sin
 * número válido (`REEMPLAZAR_…`) se descarta.
 */
function avDestinatarios(csv, from, prefijos) {
  const crudos = [];
  const partes = String(csv === undefined || csv === null ? '' : csv).split(/[,;\n]+/);
  for (const tok of partes) {
    const p = tok.split(':').map((x) => x.trim());
    if (!p[0] && p.length < 2) continue;
    let rol = 'cocina';
    let tel = '';
    let resto = [];
    if (p.length === 1) { tel = avDigitos(p[0]); }
    else if (avDigitos(p[0]).length >= 8 && avDigitos(p[1]).length < 8) { tel = avDigitos(p[0]); resto = p.slice(1); }
    else {
      rol = p[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === 'completo' ? 'completo' : 'cocina';
      tel = avDigitos(p[1]);
      resto = p.slice(2);
    }
    crudos.push({ rol, tel, nombre: resto.join(':') });
  }
  return avUnificar(crudos, avDigitos(from), avPrefijos(prefijos));
}

// --- Cargas útiles para la Cloud API ----------------------------------------------------------

function avCuerpoBase(tel, tipo) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: avDigitos(tel), type: tipo };
}

/** Mensaje de plantilla con 4 variables (o las que lleguen), todas saneadas. `null` si el nombre o el teléfono no sirven. */
function avPlantilla(tel, nombre, idioma, params4) {
  const n = String(nombre === undefined || nombre === null ? '' : nombre).trim();
  if (!/^[a-z0-9_]{1,512}$/.test(n) || !avDigitos(tel)) return null;
  const lang = /^[a-z]{2,3}(?:_[A-Za-z]{2})?$/.test(String(idioma || '').trim()) ? String(idioma).trim() : 'es';
  const lista = Array.isArray(params4) ? params4 : [];
  return Object.assign(avCuerpoBase(tel, 'template'), {
    template: {
      name: n,
      language: { code: lang },
      components: [{ type: 'body', parameters: lista.map((p) => ({ type: 'text', text: avParametro(p) })) }],
    },
  });
}

/** Mensaje de texto libre (solo con ventana abierta). */
function avTexto(tel, cuerpo) {
  const t = Array.from(String(cuerpo === undefined || cuerpo === null ? '' : cuerpo)).slice(0, 4000).join('');
  return Object.assign(avCuerpoBase(tel, 'text'), { text: { preview_url: false, body: t } });
}

function avImagen(tel, mediaId, caption) {
  return Object.assign(avCuerpoBase(tel, 'image'), { image: { id: mediaId, caption: avLimpio(caption, 200) } });
}

// --- Ventana de 24 h y tope diario ------------------------------------------------------------

function avFechaLocal(ms) {
  const d = new Date(ms - AV_UTC_MENOS_4_MS);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/** ¿Escribió el destinatario hace menos de 23 h 30 min? Solo lee. */
function avVentanaAbierta(sd, tel, ahoraMs) {
  const av = sd && sd.av;
  const ult = av && av.ventana ? av.ventana[avDigitos(tel)] : undefined;
  if (typeof ult !== 'number' || !Number.isFinite(ult) || !Number.isFinite(ahoraMs)) return false;
  const d = ahoraMs - ult;
  return d >= -300000 && d < AV_VENTANA_MS;
}

/** Anota que `tel` escribió ahora (nunca hacia atrás). Escribe en `sd.av.ventana`; acota el tamaño. */
function avAnotarEntrante(sd, tel, ahoraMs) {
  const t = avDigitos(tel);
  if (!sd || typeof sd !== 'object' || !t || !Number.isFinite(ahoraMs)) return false;
  if (!sd.av || typeof sd.av !== 'object') sd.av = {};
  if (!sd.av.ventana || typeof sd.av.ventana !== 'object') sd.av.ventana = {};
  const v = sd.av.ventana;
  v[t] = Math.max(typeof v[t] === 'number' ? v[t] : 0, ahoraMs);
  const claves = Object.keys(v);
  for (const k of claves) {
    if (typeof v[k] !== 'number' || ahoraMs - v[k] > 25 * 60 * 60 * 1000) delete v[k];
  }
  const resto = Object.keys(v);
  if (resto.length > 50) {
    resto.sort((a, b) => v[a] - v[b]);
    for (const k of resto.slice(0, resto.length - 50)) delete v[k];
  }
  return true;
}

function avTope(tope) {
  if (tope === undefined || tope === null || tope === '') return AV_TOPE_DIA_DEF;
  const n = Number(tope);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : AV_TOPE_DIA_DEF;
}

/** Cuántos mensajes de aviso salieron hoy (hora de La Paz). Solo lee. */
function avContadosHoy(sd, ahoraMs) {
  const dia = sd && sd.av && sd.av.dia;
  if (!dia || dia.fecha !== avFechaLocal(ahoraMs)) return 0;
  return Number.isFinite(dia.n) && dia.n > 0 ? Math.floor(dia.n) : 0;
}

/** ¿Queda cupo hoy? Con el día cambiado el contador vuelve a cero. Solo lee. */
function avDentroDelTopeDiario(sd, ahoraMs, tope) {
  return avContadosHoy(sd, ahoraMs) < avTope(tope);
}

/** Suma `n` (def. 1) mensajes de aviso enviados al contador del día. Escribe en `sd.av.dia`. Devuelve el total de hoy. */
function avContar(sd, ahoraMs, n) {
  if (!sd || typeof sd !== 'object' || !Number.isFinite(ahoraMs)) return 0;
  const sumar = n === undefined ? 1 : Math.max(0, Math.floor(Number(n) || 0));
  if (!sd.av || typeof sd.av !== 'object') sd.av = {};
  const hoy = avFechaLocal(ahoraMs);
  const previo = (sd.av.dia && sd.av.dia.fecha === hoy && Number.isFinite(sd.av.dia.n)) ? Math.max(0, Math.floor(sd.av.dia.n)) : 0;
  sd.av.dia = { fecha: hoy, n: previo + sumar };
  return sd.av.dia.n;
}

// --- Piezas de texto --------------------------------------------------------------------------

function avMonto(n) {
  const v = typeof n === 'string' ? Number(n.replace(',', '.')) : n;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return '—';
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',');
}

function avFechaLegible(fecha, hhmm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || ''));
  if (!m) return '';
  const a = Number(m[1]); const me = Number(m[2]); const di = Number(m[3]);
  const d = new Date(Date.UTC(a, me - 1, di));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== me - 1 || d.getUTCDate() !== di) return '';
  const h = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  const hora = h && Number(h[1]) < 24 && Number(h[2]) < 60 ? ' a las ' + String(h[1]).padStart(2, '0') + ':' + h[2] : '';
  return AV_DIAS[d.getUTCDay()] + ' ' + di + ' de ' + AV_MESES[me - 1] + hora;
}

function avAhoraLegible(ahoraMs) {
  if (!Number.isFinite(ahoraMs)) return '';
  const d = new Date(ahoraMs - AV_UTC_MENOS_4_MS);
  const hhmm = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  return avFechaLegible(avFechaLocal(ahoraMs), hhmm);
}

function avCodigoCorto(ms) {
  const n = Number.isFinite(ms) ? Math.abs(Math.floor(ms)) % 1679616 : 0;
  return n.toString(36).toUpperCase().padStart(4, '0');
}

function avCotejoTexto(resultado) {
  if (resultado === 'cuadra') return 'comprobante: datos coinciden';
  if (resultado === 'no_cuadra') return 'comprobante: NO coinciden los datos';
  if (resultado === 'ilegible') return 'comprobante ilegible';
  if (resultado === 'sin_qr') return 'sin QR: se cobra al entregar o al recoger';
  return 'comprobante sin cotejar';
}

function avModalidadTexto(m) {
  if (m === 'delivery') return 'Delivery';
  if (m === 'recojo') return 'Recojo en el local';
  return '—';
}

function avResultado(tipo, r) {
  const v = String(r === undefined || r === null ? '' : r);
  if (['cuadra', 'no_cuadra', 'ilegible', 'sin_cotejo', 'sin_qr', 'ya_cotejado'].indexOf(v) >= 0) return v;
  return tipo === 'pedido' ? 'sin_qr' : 'sin_cotejo';
}

function avLineas(lineas) {
  const out = [];
  for (const l of (Array.isArray(lineas) ? lineas : [])) {
    if (!l || typeof l !== 'object') continue;
    const c = Math.floor(Number(l.cantidad));
    out.push({ cantidad: Number.isFinite(c) && c >= 1 ? Math.min(c, 999) : 1, nombre: l.nombre, detalle: l.detalle });
    if (out.length >= 30) break;
  }
  return out;
}

/** Orden de variables de la plantilla: una permutación de `base`, en CSV o arreglo; si no lo es, `base`. */
function avOrden(valor, base) {
  if (valor === undefined || valor === null || valor === '') return { orden: base.slice(), valido: true };
  const lista = (Array.isArray(valor) ? valor : String(valor).split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const ok = lista.length === base.length && base.every((b) => lista.indexOf(b) >= 0);
  return ok ? { orden: lista, valido: true } : { orden: base.slice(), valido: false };
}

// Clave de configuración → qué plantilla, idioma y orden rige para el evento. NO HAY NOMBRE POR OMISIÓN: una plantilla
// sin configurar (`plantillaPedido`, `plantillaReserva`, `plantillaDerivacion`) no se inventa; el evento falla cerrado
// (`plantilla_no_configurada_<evento>`) y los nombres reales viven en la configuración del negocio, no en el código.
// La derivación hereda la de reserva SOLO si `plantillaDerivacion` no existe y `plantillaReserva` sí está configurada.
function avConfigPlantilla(tipo, c, errores) {
  const texto = (v) => String(v === undefined || v === null ? '' : v).trim();
  let nombre; let idioma; let ordenCsv; let base; let evento;
  if (tipo === 'pedido' || tipo === 'comprobante') {
    evento = 'pedido';
    nombre = texto(c.plantillaPedido);
    idioma = texto(c.idiomaPlantillaPedido) || 'es';
    ordenCsv = c.ordenPedido; base = AV_ORDEN_PEDIDO;
  } else if (tipo === 'reserva') {
    evento = 'reserva';
    nombre = texto(c.plantillaReserva);
    idioma = texto(c.idiomaPlantillaReserva) || 'es';
    ordenCsv = c.ordenReserva; base = AV_ORDEN_AGENDA;
  } else {
    evento = 'derivacion';
    const heredada = c.plantillaDerivacion === undefined || c.plantillaDerivacion === null;
    nombre = heredada ? texto(c.plantillaReserva) : texto(c.plantillaDerivacion);
    idioma = texto(c.idiomaPlantillaDerivacion) || (heredada ? texto(c.idiomaPlantillaReserva) : '') || 'es';
    ordenCsv = c.ordenDerivacion; base = AV_ORDEN_AGENDA;
  }
  const o = avOrden(ordenCsv, base);
  if (!o.valido) errores.push('orden_invalido_' + evento);
  const valida = /^[a-z0-9_]{1,512}$/.test(nombre);
  if (nombre && !valida) errores.push('plantilla_invalida');
  return { nombre: valida ? nombre : '', configurada: nombre !== '', evento, idioma, orden: o.orden };
}

// La variable `modalidad` ({{3}} del pedido) por ROL: con la ventana cerrada es lo único del detalle que llega.
//  - `completo`: modalidad + «a <dirección> (<referencia>)» + «recibe <nombre>» + «cel <teléfono>», solo en delivery;
//  - `cocina`: modalidad + los ítems compactos con sus notas; SIN teléfono ni dirección.
// Sigue siendo UNA variable: sin saltos de línea, saneada como las demás y con el tope de la variable (500).
function avModalidadVariable(d, dest, opc) {
  const base = avModalidadTexto(d.modalidad);
  if (dest.rol === 'completo') {
    if (d.modalidad !== 'delivery') return base;
    const dir = avLimpio(d.direccion, 160);
    const ref = avLimpio(d.referencia, 100);
    const recibe = avLimpio(d.nombre, 60);
    const tel = avDigitos(d.telefono);
    return [base + (dir ? ' a ' + dir : '') + (ref ? ' (' + ref + ')' : ''), recibe ? 'recibe ' + recibe : '', tel ? 'cel ' + tel : '']
      .filter(Boolean).join(' · ');
  }
  const items = avLineas(d.lineas).map((l) => {
    const nota = avLimpio(l.detalle, 80, opc);
    return l.cantidad + ' × ' + (avLimpio(l.nombre, 60, opc) || 'ítem') + (nota ? ' (' + nota + ')' : '');
  });
  return items.length ? base + ' · ' + items.join(', ') : base;
}

// Las cuatro variables, ya saneadas, por token. `rol` decide cuánto se muestra.
function avVariables(tipo, d, dest, resultado, ahoraMs) {
  const opc = { cocina: dest.rol === 'cocina' };
  const nombreDe = (n) => (dest.rol === 'cocina' ? avPrimerNombre(n, opc) : avLimpio(n, 60)) || 'cliente';
  if (tipo === 'pedido' || tipo === 'comprobante') {
    const lineas = avLineas(d.lineas);
    const n = lineas.reduce((a, l) => a + l.cantidad, 0);
    const cod = avLimpio(d.codigo, 20) || '—';
    return {
      items: avParametro('N.º ' + cod + (n > 0 ? ' de ' + n + (n === 1 ? ' ítem' : ' ítems') : ''), 60),
      total: avParametro('Bs ' + avMonto(d.total), 30),
      modalidad: avParametro(avModalidadVariable(d, dest, opc), 500),
      cotejo: avParametro(avCotejoTexto(resultado), 80),
    };
  }
  const destinatario = avParametro(dest.nombre || 'equipo', 40);
  if (tipo === 'reserva') {
    const r = (d.reserva && typeof d.reserva === 'object') ? d.reserva : {};
    const p = Math.floor(Number(r.personas));
    const partes = [
      'Reserva ' + (Number.isFinite(p) && p >= 1 ? p + (p === 1 ? ' persona' : ' personas') : '—'),
      nombreDe(r.nombre || d.nombre),
      avLimpio(r.zona, 40, opc),
    ].filter(Boolean);
    return {
      destinatario,
      cuando: avParametro(avFechaLegible(r.fecha, r.hora), 70),
      detalle: avParametro(partes.join(' · '), 200),
      codigo: avParametro(avLimpio(d.codigo, 20), 20),
    };
  }
  const motivo = avLimpio(d.motivo, 120, opc);
  return {
    destinatario,
    cuando: avParametro(avAhoraLegible(ahoraMs), 70),
    detalle: avParametro(['Consulta de cliente', nombreDe(d.nombre), motivo ? 'Nota del cliente: ' + motivo : ''].filter(Boolean).join(' · '), 200),
    codigo: avParametro(avLimpio(d.codigo, 20) || avCodigoCorto(ahoraMs), 20),
  };
}

// Detalle completo en texto libre. Cada pieza dinámica pasa por `avLimpio`; el cierre va al final.
function avDetalle(tipo, d, rol, resultado, ahoraMs) {
  const opc = { cocina: rol === 'cocina' };
  const completo = rol === 'completo';
  const lineas = [];
  const nombre = completo ? avLimpio(d.nombre, 60) : avPrimerNombre(d.nombre, opc);
  const tel = avDigitos(d.telefono);
  const cliente = () => {
    if (completo) return 'Cliente: ' + (nombre || 'sin nombre') + (tel ? ' · tel ' + tel : '');
    return nombre ? 'Cliente: ' + nombre : '';
  };
  let cierre = '';
  if (tipo === 'pedido' || tipo === 'comprobante') {
    const cod = avLimpio(d.codigo, 20) || '—';
    lineas.push('Pedido N.º ' + cod + ' (' + avCotejoTexto(resultado) + ')');
    lineas.push(cliente());
    if (d.modalidad === 'delivery') {
      const dir = completo ? avLimpio(d.direccion, 200) : '';
      const ref = completo ? avLimpio(d.referencia, 120) : '';
      lineas.push('Entrega: delivery' + (dir ? ' a ' + dir : '') + (ref ? ' (' + ref + ')' : ''));
    } else if (d.modalidad === 'recojo') {
      lineas.push('Entrega: recojo en el local');
    }
    lineas.push('Ítems:');
    const todas = avLineas(d.lineas);
    let largo = 0;
    for (let i = 0; i < todas.length; i++) {
      const l = todas[i];
      const nota = avLimpio(l.detalle, 120, opc);
      const linea = '• ' + l.cantidad + ' × ' + (avLimpio(l.nombre, 80, opc) || 'ítem') + (nota ? ' (' + nota + ')' : '');
      if (largo + linea.length > 2200) { lineas.push('• … y ' + (todas.length - i) + ' más'); break; }
      lineas.push(linea);
      largo += linea.length + 1;
    }
    if (!todas.length) lineas.push('• (sin ítems)');
    lineas.push('Total de la comida: Bs ' + avMonto(d.total));
    if (completo && Array.isArray(d.diferencias) && d.diferencias.length) {
      const dif = d.diferencias.slice(0, 6).map((x) => avLimpio(x, 100)).filter(Boolean).join('; ');
      if (dif) lineas.push('Diferencias: ' + dif);
    }
    cierre = resultado === 'sin_qr' ? AV_CIERRE_SIN_QR : AV_CIERRE_PAGO;
  } else if (tipo === 'reserva') {
    const r = (d.reserva && typeof d.reserva === 'object') ? d.reserva : {};
    const p = Math.floor(Number(r.personas));
    const cod = avLimpio(d.codigo, 20);
    lineas.push('Solicitud de reserva' + (cod ? ' N.º ' + cod : ''));
    lineas.push('• ' + (avFechaLegible(r.fecha, r.hora) || 'fecha sin indicar'));
    lineas.push('• ' + (Number.isFinite(p) && p >= 1 ? p + (p === 1 ? ' persona' : ' personas') : 'personas sin indicar')
      + (avLimpio(r.zona, 40, opc) ? ', ' + avLimpio(r.zona, 40, opc) : ''));
    const aNombre = completo ? avLimpio(r.nombre || d.nombre, 60) : avPrimerNombre(r.nombre || d.nombre, opc);
    lineas.push('• A nombre de ' + (aNombre || 'sin nombre'));
    if (avLimpio(r.celebracion, 120, opc)) lineas.push('• Celebración: ' + avLimpio(r.celebracion, 120, opc));
    if (avLimpio(r.requerimiento, 200, opc)) lineas.push('• Pedido especial: ' + avLimpio(r.requerimiento, 200, opc));
    if (completo && tel) lineas.push('Cliente: tel ' + tel);
    cierre = AV_CIERRE_RESERVA;
  } else {
    const cod = avLimpio(d.codigo, 20) || avCodigoCorto(ahoraMs);
    lineas.push('Consulta de un cliente N.º ' + cod);
    lineas.push(cliente());
    const motivo = avLimpio(d.motivo, 300, opc);
    if (motivo) lineas.push('Nota del cliente: «' + motivo + '»');
    cierre = AV_CIERRE_DERIVACION;
  }
  lineas.push(cierre);
  // Última red: nada que coincida con la lista de palabras prohibidas sale en el detalle.
  return avSinProhibidas(lineas.filter(Boolean).join('\n')).trim();
}

// --- Armado -----------------------------------------------------------------------------------

function avNormalizarDestinatarios(destinatarios, d, c) {
  const propio = avDigitos(d.telefono || d.from);
  if (typeof destinatarios === 'string') return avDestinatarios(destinatarios, propio, c.prefijosPermitidos);
  if (!Array.isArray(destinatarios)) return [];
  return avUnificar(destinatarios, propio, avPrefijos(c.prefijosPermitidos));
}

// Núcleo puro: ítems y errores, sin tope diario y sin tocar `sd`.
function avConstruir(tipo, datos, destinatarios, cfg, sd, ahoraMs) {
  const d = (datos && typeof datos === 'object') ? datos : {};
  const c = (cfg && typeof cfg === 'object') ? cfg : {};
  const errores = [];
  if (AV_TIPOS.indexOf(tipo) < 0) return { items: [], errores: ['tipo_desconocido'] };
  const esPedido = tipo === 'pedido' || tipo === 'comprobante';
  const resultado = esPedido ? avResultado(tipo, d.resultado) : '';
  if (resultado === 'ya_cotejado') return { items: [], errores: ['sin_aviso_ya_cotejado'] };
  if (tipo === 'reserva' && !(d.reserva && typeof d.reserva === 'object')) return { items: [], errores: ['sin_datos_reserva'] };
  const dests = avNormalizarDestinatarios(destinatarios, d, c);
  if (!dests.length) return { items: [], errores: ['sin_destinatarios'] };

  const pl = avConfigPlantilla(tipo, c, errores);
  const idMedio = /^[A-Za-z0-9_.-]{1,100}$/.test(String(d.mediaId || '')) ? String(d.mediaId) : '';
  const items = [];
  for (const dest of dests) {
    const abierta = avVentanaAbierta(sd, dest.tel, ahoraMs);
    const conTexto = () => {
      const cuerpo = avDetalle(tipo, d, dest.rol, resultado, ahoraMs);
      items.push({ para: dest.tel, rol: dest.rol, payload: avTexto(dest.tel, cuerpo), respaldo: null, esPlantilla: false, clase: 'detalle' });
    };
    const conPlantilla = () => {
      if (!pl.nombre) {
        // Sin plantilla configurada no se inventa un nombre: el evento falla cerrado (con ventana abierta cae al texto).
        if (!pl.configurada && errores.indexOf('plantilla_no_configurada_' + pl.evento) < 0) errores.push('plantilla_no_configurada_' + pl.evento);
        return false;
      }
      const vars = avVariables(tipo, d, dest, resultado, ahoraMs);
      const payload = avPlantilla(dest.tel, pl.nombre, pl.idioma, pl.orden.map((k) => vars[k]));
      if (!payload) return false;
      items.push({ para: dest.tel, rol: dest.rol, payload, respaldo: null, esPlantilla: true, clase: 'plantilla' });
      return true;
    };
    if (tipo === 'transferencia') {
      if (abierta) conTexto();
      else if (!conPlantilla() && errores.indexOf('sin_plantilla_derivacion') < 0) errores.push('sin_plantilla_derivacion');
      continue;
    }
    conPlantilla();
    if (abierta) {
      conTexto();
      if (tipo === 'comprobante' && dest.rol === 'completo' && idMedio) {
        const cod = avLimpio(d.codigo, 20);
        items.push({ para: dest.tel, rol: dest.rol, payload: avImagen(dest.tel, idMedio, 'Comprobante del pedido' + (cod ? ' N.º ' + cod : '')), respaldo: null, esPlantilla: false, clase: 'imagen' });
      }
    }
  }
  if (!items.length && !errores.length) errores.push('sin_aviso_posible');
  return { items, errores };
}

/** Los mensajes de aviso de un evento: `[{para, rol, payload, respaldo:null, esPlantilla, clase}]`. No toca `sd` ni aplica el tope. */
function avArmar(tipo, datos, destinatarios, cfg, sd, ahoraMs) {
  return avConstruir(tipo, datos, destinatarios, cfg, sd, ahoraMs).items;
}

/**
 * Como `avArmar`, pero con el tope diario de `cfg.topeAvisosDia` (def. 150 mensajes) y con los errores.
 * Sin cupo: `items` vacío y `tope_avisos_dia`. Con cupo parcial se conservan primero las plantillas, luego los
 * textos y por último la imagen, en el orden original. No toca `sd`: el contador lo escribe `avContar`.
 */
function avPlan(tipo, datos, destinatarios, cfg, sd, ahoraMs) {
  const r = avConstruir(tipo, datos, destinatarios, cfg, sd, ahoraMs);
  const cupo = avTope(cfg && cfg.topeAvisosDia) - avContadosHoy(sd, ahoraMs);
  if (!r.items.length) return r;
  if (cupo <= 0) return { items: [], errores: r.errores.concat('tope_avisos_dia') };
  if (r.items.length <= cupo) return r;
  const prioridad = { plantilla: 0, detalle: 1, imagen: 2 };
  const orden = r.items.map((it, i) => ({ i, p: prioridad[it.clase] })).sort((a, b) => (a.p - b.p) || (a.i - b.i));
  const quedan = {};
  for (const o of orden.slice(0, cupo)) quedan[o.i] = true;
  return { items: r.items.filter((it, i) => quedan[i]), errores: r.errores.concat('tope_avisos_dia') };
}
