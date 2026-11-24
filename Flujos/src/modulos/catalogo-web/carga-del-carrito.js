// CARGA DEL CARRITO (módulo catalogo-web): el carrito que el cliente confirma en la página del catálogo web entra al flujo como UN mensaje sintético.
//
// Se ANTEPONE al código de «Carga de entrada» (`core/sin-agente/turno/carga-de-entrada.js`, que no se toca): este bloque corre primero y, SOLO si CORRIÓ el nodo Webhook «Carrito del catálogo»
// (el que despierta `despertarFlujo` del servidor, ver `carrito-del-catalogo.mjs`), devuelve la entrada y el código común ya no se ejecuta. Si ese nodo no corrió (la variante de prueba ni siquiera lo tiene),
// no hace nada y sigue el código común, intacto.
//
// REGLAS (las mismas de la entrada de Q'Taco, de la que se extrajo):
//   - El nodo Webhook MANDA sobre las demás formas: nada de lo que traiga ese webhook se lee como un mensaje de WhatsApp (ni `messages` en la raíz ni dentro de `body`). O el cuerpo pasa la validación y sale
//     como carrito, o no sale nada (el flujo termina sin costo).
//   - La VALIDACIÓN es `validar-carrito.js` (módulo común; también la usa el Demo B), INCLUIDA por `carrito-del-catalogo.mjs` en el lugar de la marca de abajo: nunca copiada ni reescrita.
//   - QUIEN AUTENTICA es el nodo Webhook (credencial de cabecera de la ingesta); aquí se comprueba la FORMA, la marca de tiempo reciente y que el número y el teléfono sean números.
//   - El mensaje sintético es `{from, id: 'carrito:<pedidoId>', type: 'carrito', carrito}` con `carritoWeb: true`: `Normalizar entrada` solo acepta ese tipo con esa marca. Su id es la clave de «ya visto»
//     (un reintento del servidor con el mismo pedido no se procesa dos veces).
//   - El filtro de eventos de la carga común se aplica igual: el número de la cabecera tiene que ser el `phoneNumberIdEsperado` de «Config base» (el webhook cuelga de «Config base», que corre antes).
/* @@validar-carrito@@ */

// La ubicación del carrito web: {lat, lng} con números (no texto), en rango, distinta de (0, 0); 5 decimales. Si no, null.
function ccUbicacion(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  if (typeof u.lat !== 'number' || typeof u.lng !== 'number' || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) return null;
  if (Math.abs(u.lat) > 90 || Math.abs(u.lng) > 180) return null;
  // Se redondea PRIMERO y se valida el resultado: (0,000004; -0,000003) queda en (0, 0), el punto nulo de un GPS sin fijar.
  const r = { lat: Math.round(u.lat * 1e5) / 1e5, lng: Math.round(u.lng * 1e5) / 1e5 };
  return r.lat === 0 && r.lng === 0 ? null : r;
}
// Una línea limpia: sin controles, sin separadores de línea, sin < > &, espacios colapsados, con tope.
function ccLinea(t, max) {
  const s = String(t === undefined || t === null ? '' : t).replace(/[\u0080-\u0084\u0086-\u009f]/g, '').replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029<>&]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
// Texto libre del cliente (nota, dirección): sin corchetes, llaves ni comillas angulares (no imita una marca interna como [ENVIAR_QR]) y sin enlaces.
function ccTextoLibre(t) {
  return String(t === undefined || t === null ? '' : t).replace(/https?:\/\/\S+/gi, ' ').replace(/[[\]{}«»]/g, ' ').replace(/\s+/g, ' ').trim();
}
// El id de cada item viaja en el cuerpo del servidor; `validar-carrito.js` solo conserva nombre, cantidad y subtotal. Se emparejan por posición (el módulo toma `items.slice(0, 50)` en el mismo orden).
// Un id con otra forma queda vacío: ese item no se vende. Devuelve los carritos que pasaron la validación (puede ser ninguno) con su número de origen.
function ccCarritos(entradas) {
  const salida = [];
  const validados = ccValidarCarrito({ all: () => entradas });
  validados.forEach((it, i) => {
    const v = (it && it.json) || {};
    const crudo = (entradas[i] && entradas[i].json) || {};
    const cuerpo = crudo.body && typeof crudo.body === 'object' ? crudo.body : {};
    const crudos = Array.isArray(cuerpo.items) ? cuerpo.items.slice(0, 50) : [];
    // El id del pedido es la clave de «ya visto»: sin uno usable, no entra.
    const pedidoId = /^[A-Za-z0-9_-]{1,60}$/.test(String(v.pedidoId || '')) ? String(v.pedidoId) : '';
    if (v.procesar !== true || !pedidoId) return;
    salida.push({
      numero: String(v.numero), from: String(v.from), pedidoId: pedidoId,
      carrito: {
        pedidoId: pedidoId, tenantId: String(v.tenantId || ''), accion: String(v.accion || ''), ventanaAbierta: v.ventanaAbierta === true,
        fichaCompartida: v.fichaCompartida === true, moneda: String(v.moneda || 'Bs'), total: Number(v.total) || 0,
        costoEnvio: Number(v.costoEnvio) || 0, entrega: v.entrega === 'envio' ? 'envio' : 'retiro',
        direccion: ccTextoLibre(v.direccion), nota: ccTextoLibre(v.nota), descartados: Number(v.descartados) || 0,
        // La referencia y la ubicación (opcionales) las manda la página nueva; van FUERA de la validación incluida.
        referencia: ccLinea(String(cuerpo.referencia || ''), 150),
        ubicacion: ccUbicacion(cuerpo.ubicacion),
        itemsTotal: Number(v.itemsTotal) || 0,
        items: (Array.isArray(v.items) ? v.items : []).map((x, k) => {
          const id = crudos[k] && typeof crudos[k].id === 'string' ? crudos[k].id : '';
          return { id: /^[A-Za-z0-9_.:-]{1,100}$/.test(id) ? id : '', nombre: String(x.nombre), cantidad: x.cantidad, subtotal: x.subtotal };
        }),
      },
    });
  });
  return salida;
}
// `null` si «Carrito del catálogo» NO corrió (sigue el código común); si corrió, la lista de entradas (vacía si nada pasó la validación o el número no es el del comercio).
function ccEntradaDelCarrito() {
  if (!cnNodo('Carrito del catálogo')) return null;
  const ahoraCc = Date.now();
  const esperadoCc = String((cnPrimero('Config base') || {}).phoneNumberIdEsperado || '');
  return ccCarritos($input.all()).filter((c) => esperadoCc !== '' && c.numero === esperadoCc).map((c) => ({ json: {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: c.numero },
    contacts: [],
    messages: [{ from: c.from, id: 'carrito:' + c.pedidoId, timestamp: String(Math.floor(ahoraCc / 1000)), type: 'carrito', carrito: c.carrito }],
    statuses: [],
    phoneNumberId: c.numero,
    ahoraMs: ahoraCc,
    prueba: null,
    carritoWeb: true,
  } }));
}
const ccEntrada = ccEntradaDelCarrito();
if (ccEntrada !== null) {
  return ccEntrada;
}
