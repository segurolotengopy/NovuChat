// MÓDULO PEDIDOS — LO QUE EL FLUJO REPORTA AL ENVIAR EL QR PARA QUE EL SERVIDOR CREE EL PEDIDO `wa_<referencia>`.
// Se INCLUYE en los flujos que lo usan (construir.mjs), nunca se copia. Funciones puras, sin red ni globales de Node.
//
// El servidor (admin/functions/src/modulos/pedidos/pedidoDelQr.ts) recalcula precios y total desde el catálogo del tenant:
// del flujo salen SOLO identificadores, cantidades y un detalle de texto. Aquí nunca viaja precio, nombre, total ni la
// facturación del cliente: ese dato no sale del flujo por este camino.
const PQR_MAX_LINEAS = 30;
const PQR_MAX_DETALLE = 120;
const PQR_MAX_DIRECCION = 200;
function _pqrTexto(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, 1000).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}<>&]/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
// Recorta a `max` sin partir un par sustituto (emoji): si el corte cae entre las dos mitades, se quita la mitad que quedó.
function _pqrCorta(t, max) {
  let r = t.slice(0, max);
  if (/[\ud800-\udbff]$/.test(r)) r = r.slice(0, -1);
  return r.trim();
}
// [{id, cantidad, detalle}] — junta el mismo id sumando cantidades (el servidor se queda solo con la primera línea de cada id).
// Con más de una variante de detalle se anota la cantidad de cada una: «1 sin indicación · 1 sin cebolla».
// La suma NO se recorta: si pasa de 50 se manda tal cual y el servidor descarta esa línea y la deja en `descartados`
// (armarPedidoWa), en vez de que el pedido diga menos unidades de las que el cliente pidió.
function pqrLineas(lineas) {
  const porId = new Map();
  const orden = [];
  const crudas = Array.isArray(lineas) ? lineas.slice(0, PQR_MAX_LINEAS) : [];
  for (const l of crudas) {
    if (!l || typeof l !== 'object') continue;
    const id = l.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) || id.includes('..')) continue;
    const c = typeof l.cantidad === 'number' ? Math.trunc(l.cantidad)
      : (typeof l.cantidad === 'string' && /^\s*\d{1,3}\s*$/.test(l.cantidad) ? Number(l.cantidad) : NaN);
    if (!Number.isFinite(c) || c < 1) continue;
    const detalle = _pqrTexto(l.detalle, PQR_MAX_DETALLE);
    let p = porId.get(id);
    if (!p) { p = { id: id, cantidad: 0, variantes: new Map() }; porId.set(id, p); orden.push(p); }
    p.cantidad += c;
    p.variantes.set(detalle, (p.variantes.get(detalle) || 0) + c);
  }
  return orden.map((p) => {
    let detalle = '';
    if (p.variantes.size === 1) detalle = Array.from(p.variantes.keys())[0];
    else if (p.variantes.size > 1) {
      detalle = _pqrCorta(Array.from(p.variantes.entries()).map((e) => e[1] + ' ' + (e[0] || 'sin indicación')).join(' · '), PQR_MAX_DETALLE);
    }
    return { id: p.id, cantidad: p.cantidad, detalle: detalle };
  });
}
function _pqrUbicacion(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const lat = u.lat; const lng = u.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat: lat, lng: lng };
}
// {tipo:'envio', direccion, ubicacion?} para delivery, {tipo:'retiro'} para lo demás.
function pqrEntrega(e) {
  const x = e && typeof e === 'object' ? e : {};
  const crudo = [x.entrega, x.modalidad, x.tipo].find((v) => typeof v === 'string' && v);
  const t = String(crudo || '').toLowerCase().trim();
  if (!/^(delivery|domicilio|envio|envío|courier|encomienda)$/.test(t)) return { tipo: 'retiro' };
  const dir = _pqrTexto(x.direccion, PQR_MAX_DIRECCION);
  const ref = _pqrTexto(x.referencia || x.ciudad, PQR_MAX_DIRECCION);
  const direccion = _pqrTexto(dir && ref ? dir + ' · ' + ref : (dir || ref), PQR_MAX_DIRECCION);
  const ub = _pqrUbicacion(x.ubicacion);
  const out = { tipo: 'envio' };
  if (direccion) out.direccion = direccion;
  if (ub) out.ubicacion = ub;
  return out;
}
// Los campos extra del mensaje `qr_enviado`. {} si es simulado, si el pedido es del checkout web (`cat_…`: ya lo creó el servidor)
// o si no queda ninguna línea. NUNCA devuelve facturación.
// `catOriginal` es el `cat_…` del checkout web que este pedido modificó en el chat: viaja como `reemplaza` (solo esa cadena, validada)
// para que el servidor marque el pedido web como reemplazado y la Consola no muestre dos pedidos por una compra.
function pqrCampos(ref, lineas, entrega, simulado, catOriginal) {
  if (simulado) return {};
  if (typeof ref !== 'string' || ref === '' || ref.indexOf('cat_') === 0) return {};
  const ls = pqrLineas(lineas);
  if (!ls.length) return {};
  const out = { lineas: ls, entrega: pqrEntrega(entrega) };
  if (typeof catOriginal === 'string' && /^cat_[A-Za-z0-9_-]{1,56}$/.test(catOriginal)) out.reemplaza = catOriginal;
  return out;
}
