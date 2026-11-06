// =============================================================================
// ADAPTADOR DE UN CATÁLOGO EXTERNO (prefijo `ce` / `CE_`): de la respuesta HTTP a vendibles, y de la confirmación de un pedido a un estado
// =============================================================================
// Para un comercio cuyo catálogo, precio final y stock los sirve otra plataforma por HTTP (contrato v1 de «catálogo» y «confirmar pedido»). Aquí NO hay red, ni reloj, ni credenciales, ni nombres, textos de un negocio ni URL: el nodo HTTP del flujo hace la llamada con su credencial de n8n y entrega
// aquí solo `{ status, body }`; el reloj entra por parámetro (`ahoraMs`). Cada función es pura y nunca lanza.
//
// Va DESPUÉS de `carrito.js` en el nodo Code de n8n (usa `vcVendibles`). JavaScript plano, sin módulos ni globales de Node. Contrato de cada función: `venta-digital/LEEME.md`.
//
// Regla de oro: ante CUALQUIER problema (credencial, límite, cotización vencida, respuesta rara, catálogo vacío) el resultado es `pase: true`: el flujo pasa la conversación a un vendedor con aviso Y botón. Nunca se promete «te aviso», «consulto» ni «te llamamos», porque nada lo cumpliría.

const CE_MAX_ANTIGUEDAD_COTIZACION_MS = 24 * 60 * 60 * 1000;   // 24 horas (decisión de Andres, 05/11/2026)
const CE_MERCADOS = { BO: 'BOB', AR: 'ARS' };
const CE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const CE_MAX_ITEMS_RESPUESTA = 1000;          // más ítems que esto en una respuesta no es un catálogo de WhatsApp: se pasa
// Texto de un ítem que se hace pasar por una instrucción, un pago o una promesa: el ítem no se vende (el texto del tercero va al modelo y al cliente).
const CE_TEXTO_PELIGROSO = /acredit|pagad|\bpago\b|recibimos|confirmad|transferid|abonad|ignora|instruccion|\bprompt\b|system|te aviso|te llamamos/;

// ¿La fecha es ISO 8601 CON zona (Z o desfase)? Sin zona, Date.parse usaría la del proceso y la hora se correría.
function ceFechaIso(t) { return typeof t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(t); }

// El dominio de una foto https (sin puerto, sin usuario) o ''.
function ceHostDeFoto(f) { const m = typeof f === 'string' ? /^https:\/\/([^\/:@?#]+)(?:\/|$)/.exec(f) : null; return m === null ? '' : m[1].toLowerCase(); }

function ceObjeto(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

// El mercado de un remitente: «BO» con prefijo 591, «AR» con prefijo 54, null para cualquier otro. Solo se miran los dígitos; con un `+`, ceros o espacios delante igual; un número demasiado corto o largo no cuenta.
function ceMercadoDePrefijo(telefono) {
  const d = (telefono === undefined || telefono === null ? '' : String(telefono)).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length < 10 || d.length > 15) return null;
  if (d.indexOf('591') === 0) return 'BO';
  if (d.indexOf('54') === 0) return 'AR';
  return null;
}

// Los motivos de un pase a vendedor, y si además merecen alerta a quien opera (un defecto o un incidente, no una conversación normal).
const CE_MOTIVOS = {
  mercado_desconocido: false,
  credencial: true,
  limite: false,
  mercado_invalido: true,
  sin_cotizacion: false,
  cotizacion_vencida: false,
  interno: false,
  respuesta_invalida: true,
  version_no_soportada: true,
  moneda_distinta: true,
  sin_catalogo: false,
  pedido_rechazado: true,
  stock_insuficiente: false,
};

function cePase(motivo) {
  const m = Object.prototype.hasOwnProperty.call(CE_MOTIVOS, motivo) ? motivo : 'interno';
  return { ok: false, pase: true, motivo: m, alerta: CE_MOTIVOS[m] === true };
}

// El texto fijo para el cliente cuando se pasa con un vendedor. Una sola frase, la misma para todos los motivos: nunca cuenta detalles técnicos, nunca promete un aviso o una llamada, nunca habla de pagos.
// El flujo la envía JUNTO al aviso a la tienda y al botón para escribirle directo (eso es lo que significa «pasar con un vendedor»).
function ceTextoPase() {
  return 'En este momento no puedo darte esa información. Te paso con una persona de la tienda para que te atienda; puedes escribirle directo con el botón de abajo.';
}

// La respuesta HTTP del catálogo a un resultado:
//   { ok: true, mercado, moneda, vendibles, cotizacion } o { ok: false, pase: true, motivo, alerta }.
// `respuesta` = { status, body } (body ya como objeto; si llega como texto o no es un objeto, es una respuesta inválida). `opciones` = { mercado: 'BO'|'AR', ahoraMs (entero, el reloj del flujo), max (a lo más 200) }.
// Reglas: solo el estado 200 con `version === 1`; la fecha de la cotización debe ser ISO 8601 con zona; la moneda de la respuesta DEBE ser la del mercado pedido (BO→BOB, AR→ARS); la cotización debe tener fecha válida y no ser más vieja que 24 horas ni estar en el futuro (más de 5 minutos); sin el reloj no se vende.
// Los ítems pasan por `vcVendibles` con `externa: true` (disponible, precioCentavos, stock, foto); luego se recortan los textos (nombre 80, área 60, descripción 300), se descarta el ítem cuyo texto parezca una instrucción, un pago o una promesa, y la foto solo queda si su dominio está en `opciones.hostsFoto`. Más de 1000 ítems, o `max` mayor que 200, no amplían nada. Cero vendibles = pase.
// Tampoco se lee ningún campo de identidad del tenant de la respuesta: el tenant sale del token en el servidor, nunca de lo que se reciba.
function ceVendibles(respuesta, opciones) {
  const o = ceObjeto(opciones) ? opciones : {};
  const moneda = Object.prototype.hasOwnProperty.call(CE_MERCADOS, o.mercado) ? CE_MERCADOS[o.mercado] : '';
  if (moneda === '') return cePase('mercado_desconocido');
  const r = ceObjeto(respuesta) ? respuesta : {};
  const status = r.status;
  if (status === 401) return cePase('credencial');
  if (status === 429) return cePase('limite');
  if (status === 400) return cePase('mercado_invalido');
  if (status === 503) return cePase('sin_cotizacion');
  if (status !== 200) return cePase('interno');
  const b = r.body;
  if (!ceObjeto(b) || !Array.isArray(b.items)) return cePase('respuesta_invalida');
  if (b.version !== 1) return cePase('version_no_soportada');
  if (b.mercado !== o.mercado || b.moneda !== moneda) return cePase('moneda_distinta');
  const ahora = o.ahoraMs;
  if (!Number.isSafeInteger(ahora) || ahora <= 0) return cePase('cotizacion_vencida');
  const c = b.cotizacion;
  const fecha = ceObjeto(c) && ceFechaIso(c.fecha) ? Date.parse(c.fecha) : NaN;
  if (!Number.isFinite(fecha) || ahora - fecha > CE_MAX_ANTIGUEDAD_COTIZACION_MS || fecha - ahora > 5 * 60 * 1000) return cePase('cotizacion_vencida');
  if (b.items.length > CE_MAX_ITEMS_RESPUESTA) return cePase('respuesta_invalida');
  // Las fotos solo se aceptan de los dominios que el negocio declara (`opciones.hostsFoto`, coincidencia exacta, sin puerto); sin lista, ninguna foto. La foto se envía como enlace a Meta: n8n nunca la descarga.
  const hosts = Array.isArray(o.hostsFoto) ? o.hostsFoto.filter((h) => typeof h === 'string' && h !== '').map((h) => h.toLowerCase()) : [];
  const max = Number.isSafeInteger(o.max) && o.max > 0 ? Math.min(o.max, 200) : 200;
  const vendibles = vcVendibles(b.items, { moneda: moneda, externa: true, max: max }).filter((v) => !CE_TEXTO_PELIGROSO.test(vcNorm(v.nombre + ' ' + v.descripcion + ' ' + v.area))).map((v) => {
    const w = { id: v.id, nombre: vcLimpiar(v.nombre, 80), precioCentavos: v.precioCentavos, area: vcLimpiar(v.area, 60), descripcion: vcLimpiar(v.descripcion, 300), moneda: v.moneda };
    if (v.stock !== undefined) w.stock = v.stock;
    if (v.foto !== undefined && hosts.indexOf(ceHostDeFoto(v.foto)) >= 0) w.foto = v.foto;
    return w;
  }).filter((v) => v.nombre !== '');
  if (vendibles.length === 0) return cePase('sin_catalogo');
  return {
    ok: true,
    pase: false,
    mercado: o.mercado,
    moneda: moneda,
    vendibles: vendibles,
    cotizacion: { estado: c.estado === 'vigente' ? 'vigente' : 'ultimo_verificado', fecha: new Date(fecha).toISOString() },
  };
}

// La respuesta HTTP de «confirmar pedido» (la llamada firmada la hace el SERVIDOR, no el flujo; aquí solo se interpreta lo que vuelva) a un estado:
//   200 → { ok: true, pase: false, estado: 'aplicado' };
//   409 con `faltantes` → pase con motivo 'stock_insuficiente' y `faltantes` (ids de producto válidos, a lo más 20);
//   cualquier otro → pase.
// IMPORTANTE: este resultado es interno. Ningún texto para el cliente sale de aquí, y nunca se le dice «pedido confirmado»: la confirmación de un pedido es del comercio, no de este flujo.
function ceRespuestaConfirmar(respuesta) {
  const r = ceObjeto(respuesta) ? respuesta : {};
  if (r.status === 200) return ceObjeto(r.body) ? { ok: true, pase: false, estado: 'aplicado' } : cePase('respuesta_invalida'); // un 200 sin JSON (una página de un proxy, un WAF) no es un pedido aplicado
  if (r.status === 409) {
    const p = cePase('stock_insuficiente');
    const f = ceObjeto(r.body) && Array.isArray(r.body.faltantes) ? r.body.faltantes.slice(0, 100) : [];
    p.faltantes = f.map((x) => (ceObjeto(x) ? x.productoId : x)).filter((x) => typeof x === 'string' && CE_ID.test(x)).slice(0, 20);
    return p;
  }
  if (r.status === 401) return cePase('credencial');
  return cePase(r.status === 400 ? 'pedido_rechazado' : 'interno');
}
