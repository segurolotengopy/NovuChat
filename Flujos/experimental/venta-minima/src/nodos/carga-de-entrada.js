// CARGA DE ENTRADA: deja la entrada en UNA forma, venga de donde venga.
//
// Formas que acepta:
//   1. el disparador de WhatsApp: {messages, metadata, contacts} en la raiz;
//   2. el `body` de la «Entrada de prueba»: lo mismo dentro de `body`. SOLO si ese nodo corrio: el `body` de cualquier otro
//      Webhook NUNCA se lee como un mensaje;
//   3. la carga completa de la Cloud API: {entry:[{changes:[{value:{...}}]}]}, en la raiz o
//      dentro de `body` (este ultimo, solo con «Entrada de prueba», como la forma 2);
//   4. la del receptor: si CORRIO «Entrega del receptor», el evento es su `body.value`, y si
//      `body.field` viene, tiene que ser `messages` (otro campo —un cambio de plantilla, de
//      calidad— no es un mensaje). Ese nodo manda sobre las otras tres: lo que pasa por
//      «Verificar firma con el receptor» ya no es el evento sino su veredicto.
//   5. el carrito del catalogo web: SOLO si CORRIO «Carrito del catálogo» (el Webhook que despierta
//      `despertarFlujo` del servidor). Ese nodo manda sobre TODAS las demas formas, incluida la del
//      receptor: nada de lo que traiga ese Webhook se lee como un mensaje de WhatsApp (ni `messages` en
//      la raiz ni dentro de `body`), y un cuerpo
//      que no pasa la validacion sale con ninguna salida. Lo que pasa se entrega como UN mensaje
//      sintetico `{from, id: 'carrito:<pedidoId>', type: 'carrito', carrito}` con `carritoWeb: true`;
//      `Interpretar entrada` solo acepta ese tipo con esa marca.
// Un acuse de estado (sin `messages`) sale con `messages: []`: «¿Es un mensaje?» lo descarta.
//
// EL MODO PRUEBA NO SE LEE DE LA CARGA. Solo lo activa el nodo «Entrada de prueba» (un Webhook
// que el JSON de produccion NO tiene): se pregunta si ese nodo corrio y, si corrio, SIEMPRE es modo
// prueba (el cuerpo solo aporta `telefonoDePrueba` y `enviarDeVerdad === true`). Una carga de
// WhatsApp con `modoPrueba` adentro —en la raiz, en el mensaje o en un texto— no lo activa jamas,
// porque en produccion `$('Entrada de prueba')` ni siquiera existe.
function cdeValorDeMeta(c) {
  if (!c || typeof c !== 'object') return null;
  if (Array.isArray(c.messages)) return c;
  const entradas = Array.isArray(c.entry) ? c.entry : [];
  for (const e of entradas) {
    const cambios = e && Array.isArray(e.changes) ? e.changes : [];
    for (const ch of cambios) {
      const v = ch && ch.value;
      if (v && typeof v === 'object' && Array.isArray(v.messages)) return v;
    }
  }
  return null;
}

function cdePrueba() {
  const w = vmPrimero('Entrada de prueba');
  if (!w) return null;
  // FALLA CERRADA: si «Entrada de prueba» corrió, es modo prueba SIEMPRE, diga lo que diga el cuerpo. Un cuerpo sin
  // `modoPrueba` (o con un valor raro) no puede dejar a la variante de prueba hablando con la ingesta, el cierre y el
  // Graph de produccion como si fuera una entrega real.
  const b = w.body && typeof w.body === 'object' ? w.body : {};
  return {
    modoPrueba: true,
    telefonoDePrueba: vmDigitos(b.telefonoDePrueba),
    enviarDeVerdad: b.enviarDeVerdad === true,
  };
}

function cdeSalida(v, metadataAlterna, ahoraMs, prueba) {
  const metadata = (v && v.metadata && typeof v.metadata === 'object' && v.metadata) || metadataAlterna || {};
  return { json: {
    messaging_product: 'whatsapp',
    metadata: metadata,
    contacts: v && Array.isArray(v.contacts) ? v.contacts : [],
    messages: v && Array.isArray(v.messages) ? v.messages : [],
    phoneNumberId: String(metadata.phone_number_id || ''),
    ahoraMs: ahoraMs,
    prueba: prueba,
    carritoWeb: false,
  } };
}

// -------------------------------------------------------------------------------------------------
// 5. EL CARRITO DEL CATALOGO WEB.
//
// LA VALIDACION ES LA DEL DEMO B, SIN EDITAR: el bloque de abajo es `Flujos/src/modulos/catalogo-web/validar-carrito.js`
// copiado LITERAL dentro de una funcion (el modulo usa `$input` y `return` en el nivel superior). Es una dependencia
// TEMPORAL hasta que `construir.mjs` lo incluya como modulo; mientras tanto la prueba `venta-minima-catalogo-logica`
// comprueba que la copia es identica al archivo (una sola fuente de verdad).
// QUIEN AUTENTICA es el nodo Webhook (credencial de cabecera); aca se comprueba la FORMA, la marca de tiempo reciente y que
// el numero y el telefono sean numeros. El numero contra `phoneNumberIdEsperado` lo cotejan `¿Es un mensaje?` e
// `Interpretar entrada` (este nodo corre ANTES de `Config base`), y el tenant contra el del panel, `Decidir turno`.
// >>> INICIO validar-carrito.js (Demo B; copia de SU CODIGO, sin las lineas de comentario)
function cdeValidarCarritoDemoB($input) {
const AHORA = Date.now();
const TOLERANCIA_MS = 10 * 60 * 1000;
const NUMERO = /^[0-9]{6,25}$/;
const TELEFONO = /^[0-9]{8,15}$/;
const FIRMA = /^sha256=[0-9a-f]{64}$/;
const ACCIONES = ['responder', 'plantilla_carrito_espera'];

const limpio = (v, max) => String(v ?? '')
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const numero = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;

const out = [];

for (const item of $input.all()) {
  const p = item.json ?? {};
  const cab = {};
  for (const clave of Object.keys(p.headers ?? {})) {
    cab[String(clave).toLowerCase()] = String((p.headers ?? {})[clave] ?? '');
  }
  const cuerpo = (p.body && typeof p.body === 'object') ? p.body : {};

  const num = String(cab['x-novuchat-numero'] ?? '');
  const marca = Number(cab['x-novuchat-timestamp']);
  const firma = String(cab['x-novuchat-signature'] ?? '');
  const telefono = String(cuerpo.telefono ?? '');
  const items = Array.isArray(cuerpo.items) ? cuerpo.items : [];
  const descartados = Array.isArray(cuerpo.descartados) ? cuerpo.descartados : [];

  const fallas = [];
  if (limpio(cuerpo.tipo, 20) !== 'carrito') fallas.push('tipo');
  if (!NUMERO.test(num)) fallas.push('numero');
  if (!TELEFONO.test(telefono)) fallas.push('telefono');
  if (typeof cuerpo.tenantId !== 'string' || cuerpo.tenantId.trim() === '') fallas.push('tenant');
  if (items.length === 0) fallas.push('items');
  if (!ACCIONES.includes(String(cuerpo.accion ?? ''))) fallas.push('accion');
  if (!FIRMA.test(firma)) fallas.push('firma');
  if (!Number.isFinite(marca) || Math.abs(AHORA - marca) > TOLERANCIA_MS) fallas.push('marca');

  out.push({ json: {
    procesar: fallas.length === 0,
    fallas,
    numero: num,
    from: telefono,
    tenantId: limpio(cuerpo.tenantId, 60),
    pedidoId: limpio(cuerpo.pedidoId, 60),
    conversacionId: limpio(cuerpo.conversacionId, 80),
    accion: String(cuerpo.accion ?? ''),
    ventanaAbierta: cuerpo.ventanaAbierta === true,
    fichaCompartida: cuerpo.fichaCompartida === true,
    items: items.slice(0, 50).map((i) => ({
      nombre: limpio((i ?? {}).nombre, 80) || 'producto',
      cantidad: numero((i ?? {}).cantidad) || 1,
      subtotal: numero((i ?? {}).subtotal),
    })),
    itemsTotal: items.length,
    total: numero(cuerpo.total),
    moneda: cuerpo.moneda === 'USD' ? 'USD' : 'Bs',
    costoEnvio: numero(cuerpo.costoEnvio),
    entrega: String(cuerpo.entrega ?? '') === 'envio' ? 'envio' : 'retiro',
    direccion: limpio(cuerpo.direccion, 200),
    nota: limpio(cuerpo.nota, 200),
    descartados: descartados.length,
  } });
}

return out;
}
// <<< FIN validar-carrito.js

// La ubicación del carrito web: {lat, lng} con números (no texto), en rango, distinta de (0, 0); 5 decimales. Si no, null.
function cdeUbicacion(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  if (typeof u.lat !== 'number' || typeof u.lng !== 'number' || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) return null;
  if (Math.abs(u.lat) > 90 || Math.abs(u.lng) > 180) return null;
  // Se redondea PRIMERO y se valida el resultado: (0,000004; -0,000003) queda en (0, 0), el punto nulo de un GPS sin fijar.
  const r = { lat: Math.round(u.lat * 1e5) / 1e5, lng: Math.round(u.lng * 1e5) / 1e5 };
  return r.lat === 0 && r.lng === 0 ? null : r;
}

// El id de cada item viaja en el cuerpo del servidor; `validar-carrito.js` solo conserva nombre, cantidad y subtotal. Se emparejan
// por posicion (el modulo toma `items.slice(0, 50)` en el mismo orden). Un id con otra forma queda vacio: ese item no se vende.
// Devuelve un arreglo con los carritos que pasaron la validacion (puede estar vacio) y su numero de origen.
function cdeCarrito(entradas) {
  const salida = [];
  const validados = cdeValidarCarritoDemoB({ all: () => entradas });
  validados.forEach((it, i) => {
    const v = (it && it.json) || {};
    const crudo = (entradas[i] && entradas[i].json) || {};
    const cuerpo = crudo.body && typeof crudo.body === 'object' ? crudo.body : {};
    const crudos = Array.isArray(cuerpo.items) ? cuerpo.items.slice(0, 50) : [];
    // El id del pedido es la clave de «ya visto» (un reintento del servidor no se procesa dos veces): sin uno usable, no entra.
    const pedidoId = /^[A-Za-z0-9_-]{1,60}$/.test(String(v.pedidoId || '')) ? String(v.pedidoId) : '';
    if (v.procesar !== true || !pedidoId) return;
    salida.push({
      numero: String(v.numero), from: String(v.from), pedidoId: pedidoId,
      carrito: {
        pedidoId: pedidoId, tenantId: String(v.tenantId || ''), accion: String(v.accion || ''), ventanaAbierta: v.ventanaAbierta === true,
        fichaCompartida: v.fichaCompartida === true, moneda: String(v.moneda || 'Bs'), total: Number(v.total) || 0,
        costoEnvio: Number(v.costoEnvio) || 0, entrega: v.entrega === 'envio' ? 'envio' : 'retiro',
        direccion: String(v.direccion || ''), nota: String(v.nota || ''), descartados: Number(v.descartados) || 0,
        // La referencia (opcional) la manda la página nueva; va FUERA del bloque copiado de validar-carrito.js (esa copia la fija una prueba).
        referencia: vmLinea(String(cuerpo.referencia || ''), 150),
        // La ubicación (opcional) la manda la página: {lat, lng}. También FUERA del bloque copiado. Solo vale con dos números finitos en rango y no (0, 0),
        // y se guarda con 5 decimales; cualquier otra cosa (texto, NaN, fuera de rango) es `null`: no se toma.
        ubicacion: cdeUbicacion(cuerpo.ubicacion),
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

const ahoraMs = Date.now();
// EL CARRITO MANDA SOBRE TODO LO DEMAS, pero SOLO si corrio su nodo. Si el Webhook del carrito corrio, nada de su cuerpo se
// toma por un mensaje de WhatsApp: o pasa la validacion y sale como carrito, o no sale nada (el flujo termina sin costo).
if (vmNodo('Carrito del catálogo')) {
  return cdeCarrito($input.all()).map((c) => {
    const s = cdeSalida({ messages: [{ from: c.from, id: 'carrito:' + c.pedidoId, timestamp: String(Math.floor(ahoraMs / 1000)), type: 'carrito', carrito: c.carrito }],
      metadata: { phone_number_id: c.numero }, contacts: [] }, null, ahoraMs, null);
    s.json.carritoWeb = true;
    return s;
  });
}
const prueba = cdePrueba();
const receptor = vmPrimero('Entrega del receptor');
if (receptor) {
  const b = receptor.body && typeof receptor.body === 'object' ? receptor.body : {};
  const valorOk = b.value && typeof b.value === 'object' && (b.field === undefined || b.field === 'messages');
  return [cdeSalida(valorOk ? cdeValorDeMeta(b.value) : null, null, ahoraMs, prueba)];
}
const salida = [];
for (const it of $input.all()) {
  const j = (it && it.json) || {};
  // El `body` solo se lee como un mensaje si CORRIO «Entrada de prueba» (`prueba` no nulo): en produccion ningun otro Webhook
  // puede hacerse pasar por un mensaje de WhatsApp (antes lo protegia solo la precedencia del carrito y del receptor).
  const b = prueba && j.body && typeof j.body === 'object' ? j.body : null;
  const v = cdeValorDeMeta(j) || cdeValorDeMeta(b);
  salida.push(cdeSalida(v, j.metadata || (b && b.metadata), ahoraMs, prueba));
}
return salida;
