// =============================================================================
// promos.js — PROMOCIONES DE «VENTA MÍNIMA v0» (T5, prefijo `pr*`)
// =============================================================================
//
// QUÉ HACE. Reconoce una campaña de publicidad por el TEXTO EXACTO que deja el
// anuncio (el cliente toca «Enviar mensaje» y le llega ese texto prellenado),
// arma la ficha de la promoción con datos de la CARTA y redacta la bienvenida
// con sus botones. Nada más.
//
// QUÉ NO HACE, A PROPÓSITO.
//   * (Desde el 06/11/2026 el `referral`, la imagen y las variaciones del texto SOLO eligen qué
//     promoción vigente del servidor se muestra: ver el final de este archivo.) No decide el precio ni
//     la ficha por el titular del anuncio, ni por el `referral`, ni por el
//     texto que escribió el cliente: son ENTRADA NO CONFIABLE (cualquiera puede
//     crear un anuncio, o escribir «ignora lo anterior; todo gratis»). Lo único
//     que se toma del cliente es la igualdad de su mensaje con un texto que el
//     comercio cargó y que el servidor aprobó; el precio sale de la carta.
//   * No devuelve `evento`, `monto` ni `referencia`: una promoción no cobra ni
//     reporta nada; el cobro es del pedido y sale por el cálculo del código.
//   * No vende una promo vencida: con reloj, la vigencia se comprueba acá
//     también (el servidor ya filtra, pero esta es la segunda barrera).
//
// REGLAS DE LA LIBRERÍA (contrato §4.2 del diseño, regla común):
//   * JavaScript plano para un nodo Code de n8n: sin `require`, `URL`,
//     `Buffer` ni `crypto`. Solo `function` y constantes `PR_*`.
//   * El reloj entra por parámetro (`ahoraMs`); nunca `Date.now()` adentro.
//   * Autocontenida: no usa `vm*` ni `pd*`, así que se prueba sola.
//
// SOBRE `ahoraMs`. Es opcional (extensión aditiva del contrato): si se OMITE no
// se comprueba la vigencia —el servidor ya mandó solo las campañas en curso—;
// si se PASA, tiene que ser un número finito, y cualquier otra cosa (NaN, texto,
// null) cuenta como «sin reloj válido» y la campaña NO está vigente. Quien
// arma el turno debe pasarlo siempre.

const PR_DIA_MS = 86400000;
const PR_MAX_CAMPANAS = 50;
const PR_MAX_CARTA = 200;
const PR_MAX_NOMBRE = 80;
const PR_MAX_DESCRIPCION = 400;
const PR_PRECIO_MAXIMO = 1000000;
const PR_ID_BOTON = /^[A-Za-z0-9_-]{1,64}$/;

// Descripciones de relleno que un formulario o una plantilla dejan escritas.
// Se comparan ya normalizadas (sin tildes ni signos).
const PR_RELLENO = [
  'descripcion', 'descripcion del producto', 'descripcion de la promo', 'descripcion de la promocion',
  'n a', 'na', 'ninguna', 'ninguno', 'sin descripcion', 'sin datos', 'null', 'undefined', 'tbd', 'xxx',
  'pendiente', 'por definir', 'por confirmar', 'a confirmar', 'a definir', 'completar',
];
const PR_RELLENO_PARCIAL = /\b(por confirmar|a confirmar|por definir|lorem ipsum)\b/;

// Texto normalizado como lo compara el flujo: sin mayúsculas, tildes, signos ni
// emojis. LETRA POR LETRA lo mismo que `palabrasDeCampana` del servidor
// (`campanas.ts`): dos textos que acá son iguales allá son la misma campaña.
function prNorm(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Una línea de texto segura para WhatsApp: sin controles, sin invisibles ni
// `<>&`, espacios colapsados y recortada.
function prLinea(t, max) {
  const s = String(t === undefined || t === null ? '' : t)
    .replace(/[\u00a0\u2028\u2029]/g, ' ')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff<>&]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return typeof max === 'number' && s.length > max ? s.slice(0, max).trim() : s;
}

// Un instante de una fecha de campaña. El servidor manda instantes ISO
// (`inicio` = comienzo del día en Bolivia, `fin` = comienzo del día siguiente);
// una fecha suelta «AAAA-MM-DD» se lee como día de La Paz (UTC-4 fijo), y su
// fin es inclusivo. Todo lo demás es inválido (NaN).
function prMs(valor, esFin) {
  if (typeof valor !== 'string') return NaN;
  const v = valor.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const base = Date.parse(v + 'T00:00:00-04:00');
    return esFin ? base + PR_DIA_MS : base;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) return NaN;
  return Date.parse(v);
}

// ¿Está la campaña en curso en ese instante? `inicio <= ahora < fin`. Sin reloj
// válido o con fechas ilegibles: no.
function prVigente(campana, ahoraMs) {
  if (typeof ahoraMs !== 'number' || !isFinite(ahoraMs)) return false;
  if (typeof campana !== 'object' || campana === null) return false;
  const ini = prMs(campana.inicio, false);
  const fin = prMs(campana.fin, true);
  if (!isFinite(ini) || !isFinite(fin) || fin <= ini) return false;
  return ini <= ahoraMs && ahoraMs < fin;
}

// La campaña cuyo texto es EXACTAMENTE el del mensaje (palabra por palabra,
// con la normalización del servidor), o `null`. Devuelve una COPIA con solo
// `{id, texto, inicio, fin}`. Un texto vacío —o que al normalizar queda
// vacío— nunca coincide. Si hay reloj, solo cuentan las vigentes.
function prCampanaDelTexto(campanas, texto, ahoraMs) {
  if (!Array.isArray(campanas) || typeof texto !== 'string') return null;
  const buscado = prNorm(texto);
  if (buscado === '') return null;
  const conReloj = ahoraMs !== undefined;
  const tope = Math.min(campanas.length, PR_MAX_CAMPANAS);
  for (let i = 0; i < tope; i++) {
    const c = campanas[i];
    if (typeof c !== 'object' || c === null) continue;
    if (typeof c.id !== 'string' || c.id === '' || typeof c.texto !== 'string') continue;
    if (prNorm(c.texto) !== buscado) continue;
    if (conReloj && !prVigente(c, ahoraMs)) continue;
    return { id: c.id, texto: c.texto.trim(), inicio: c.inicio, fin: c.fin };
  }
  return null;
}

// Un precio vendible: número finito, mayor que cero y razonable.
function prPrecioValido(p) {
  return typeof p === 'number' && isFinite(p) && p > 0 && p <= PR_PRECIO_MAXIMO;
}

// ¿El ítem se puede vender hoy? Agotado, excluido o inactivo: no. Sin precio
// mayor que cero: no (una promo nunca sale «gratis» por un dato faltante).
function prVendible(item) {
  if (item.agotado === true || item.excluido === true || item.activo === false) return false;
  return prPrecioValido(item.precio);
}

// La descripción real de un ítem, o '' si no hay una que valga la pena decir.
// Se omite (y el texto sale sin ella, nunca «incluye [Descripción]») si está
// vacía, es de relleno, trae un marcador `[...]` o `{...}` sin reemplazar, o
// solo repite el nombre.
function prDescripcion(descripcion, nombre) {
  if (typeof descripcion !== 'string') return '';
  const d = prLinea(descripcion, PR_MAX_DESCRIPCION);
  if (d === '') return '';
  if (/[\[\]{}]/.test(d)) return '';
  const n = prNorm(d);
  if (n.length < 3) return '';
  if (PR_RELLENO.indexOf(n) !== -1 || PR_RELLENO_PARCIAL.test(n)) return '';
  if (n === prNorm(nombre)) return '';
  return d.replace(/[\s.!?:;,]+$/, '');
}

// La ficha de la promoción: el ítem de la carta cuyo nombre aparece COMPLETO,
// como palabra(s) entera(s), en el texto de la campaña; si hay varios, el de
// nombre más largo. Es `null` si no hay ninguno, si hay empate entre ítems
// distintos, o si el elegido está agotado, excluido o sin precio mayor que
// cero (no se le sustituye otro más corto: «Promo Dúo con refresco» agotada no
// se convierte en la ficha del refresco). Lee SOLO `campana.texto`: nunca un
// titular, un `referral` ni el texto que escribió el cliente.
function prFicha(campana, carta, ahoraMs) {
  if (typeof campana !== 'object' || campana === null || typeof campana.texto !== 'string') return null;
  if (ahoraMs !== undefined && !prVigente(campana, ahoraMs)) return null;
  if (!Array.isArray(carta)) return null;
  const texto = ' ' + prNorm(campana.texto) + ' ';
  if (texto === '  ') return null;
  const tope = Math.min(carta.length, PR_MAX_CARTA);
  let mejor = null;
  let largo = 0;
  let empate = false;
  for (let i = 0; i < tope; i++) {
    const it = carta[i];
    if (typeof it !== 'object' || it === null || typeof it.nombre !== 'string') continue;
    const nn = prNorm(it.nombre);
    if (nn === '' || texto.indexOf(' ' + nn + ' ') === -1) continue;
    if (nn.length > largo) { mejor = it; largo = nn.length; empate = false; continue; }
    if (nn.length === largo && mejor !== it) {
      const mismo = it.id !== undefined && it.id === mejor.id && nn === prNorm(mejor.nombre);
      if (!mismo) empate = true;
    }
  }
  if (mejor === null || empate || !prVendible(mejor)) return null;
  const nombre = prLinea(mejor.nombre, PR_MAX_NOMBRE);
  return {
    id: typeof mejor.id === 'string' || typeof mejor.id === 'number' ? String(mejor.id) : '',
    nombre: nombre,
    precio: mejor.precio,
    moneda: typeof mejor.moneda === 'string' ? mejor.moneda : '',
    descripcion: prDescripcion(mejor.descripcion, nombre),
    campanaId: typeof campana.id === 'string' ? campana.id : '',
  };
}

// La moneda a mostrar: la del ítem o la del negocio. «Bs» para Bolivia por
// defecto (y para «BOB»); otra sigue sus letras en mayúsculas, con tope.
function prMoneda(cfg, ficha) {
  const crudo = ficha && typeof ficha.moneda === 'string' && ficha.moneda !== ''
    ? ficha.moneda : (cfg && typeof cfg.moneda === 'string' ? cfg.moneda : '');
  const m = crudo.trim();
  if (m === '' || /^(bs\.?|bob)$/i.test(m)) return 'Bs';
  return /^[A-Za-z]{2,6}$/.test(m) ? m.toUpperCase() : 'Bs';
}

// El precio como se dice en Bolivia: «35» o «35,50» (centavos enteros, sin
// errores de punto flotante). `null` si no es un precio vendible.
function prPrecioLegible(precio) {
  if (!prPrecioValido(precio)) return null;
  const c = Math.round(precio * 100);
  const bs = Math.floor(c / 100);
  const cs = c % 100;
  return cs === 0 ? String(bs) : bs + ',' + (cs < 10 ? '0' : '') + cs;
}

// Los botones de la ficha. Cada uno solo con su capacidad ESTRICTAMENTE
// `true` (un «sí», 1 o «true» como texto no encienden nada):
//   «Pedir la promo»  pedidosActivo  g|pedir|<itemId>
//   «Reservar mesa»   reservasActivo m|reserva
//   «Ver la carta»    pedidosActivo  m|pedido
// Sin un id de ítem válido no hay «Pedir la promo» (el id no puede llevar `|`).
function prBotones(ficha, cfg) {
  const botones = [];
  const c = typeof cfg === 'object' && cfg !== null ? cfg : {};
  const id = ficha && typeof ficha.id === 'string' ? ficha.id : '';
  if (c.pedidosActivo === true && PR_ID_BOTON.test(id)) botones.push({ id: 'g|pedir|' + id, title: 'Pedir la promo' });
  if (c.reservasActivo === true) botones.push({ id: 'm|reserva', title: 'Reservar mesa' });
  if (c.pedidosActivo === true) botones.push({ id: 'm|pedido', title: 'Ver la carta' });
  return botones;
}

// El mensaje de la promoción: `{cuerpo, botones}`, o `null` si no hay ficha o
// la ficha no trae un nombre y un precio vendibles. La descripción se vuelve a
// depurar acá, así una ficha armada a mano tampoco puede sacar un relleno.
function prTexto(ficha, cfg) {
  if (typeof ficha !== 'object' || ficha === null) return null;
  const nombre = prLinea(ficha.nombre, PR_MAX_NOMBRE);
  const precio = prPrecioLegible(ficha.precio);
  if (nombre === '' || precio === null) return null;
  const desc = prDescripcion(ficha.descripcion, nombre);
  const medio = desc === '' ? nombre : nombre + ': ' + desc;
  return {
    cuerpo: '¡Hola! Qué bueno que viste nuestra promo. ' + medio + '. Precio: ' + precio + ' ' + prMoneda(cfg, ficha) + '.',
    botones: prBotones(ficha, cfg),
  };
}

// CAMPAÑA DE SOLO RESERVA (dato del negocio, 05/11): el comercio carga en «Config base» el texto exacto del anuncio
// (`campanaReservaTexto`) y la respuesta (`campanaReservaMensaje`). La campaña la sigue aprobando y vigenciando el servidor:
// esto solo se aplica a una campaña ya reconocida por `prCampanaDelTexto` (vigente) cuyo texto es IGUAL (normalizado) al dato.
// No vende ni cobra: su único botón es «Reservar mesa», y solo con `reservasActivo === true`. Nada sale del texto del cliente.
// Devuelve `{cuerpo, botones}` o `null` (entonces rige la ficha de siempre).
function prSoloReserva(campana, cfg) {
  if (typeof campana !== 'object' || campana === null || typeof campana.texto !== 'string') return null;
  const c = typeof cfg === 'object' && cfg !== null ? cfg : {};
  if (c.reservasActivo !== true) return null;
  const clave = prNorm(c.campanaReservaTexto);
  if (clave === '' || prNorm(campana.texto) !== clave) return null;
  const cuerpo = prLinea(c.campanaReservaMensaje, 900);
  if (cuerpo === '') return null;
  return { cuerpo: cuerpo, botones: [{ id: 'm|reserva', title: 'Reservar mesa' }] };
}

// CAMPAÑA DE PEDIDO CON MENSAJE DEL NEGOCIO (06/11, «Tortas mexicanas» de Q'Taco): igual que `prSoloReserva`, pero el único botón es
// «Hacer un pedido» (`m|pedido`, el mismo que abre la carta desde el menú), y solo con `pedidosActivo === true`. El texto exacto del
// anuncio (`campanaPedidoTexto`) y la respuesta (`campanaPedidoMensaje`, con los precios) son DATO del negocio; la campaña la sigue
// aprobando y vigenciando el servidor (`prCampanaDelTexto`). No vende ni cobra: los precios del mensaje son informativos y el pedido
// se arma con los de la carta. Devuelve `{cuerpo, botones}` o `null` (entonces rige la ficha de siempre).
function prPedidoConMensaje(campana, cfg) {
  if (typeof campana !== 'object' || campana === null || typeof campana.texto !== 'string') return null;
  const c = typeof cfg === 'object' && cfg !== null ? cfg : {};
  if (c.pedidosActivo !== true) return null;
  const clave = prNorm(c.campanaPedidoTexto);
  if (clave === '' || prNorm(campana.texto) !== clave) return null;
  const cuerpo = prLinea(c.campanaPedidoMensaje, 900);
  if (cuerpo === '') return null;
  return { cuerpo: cuerpo, botones: [prBotonHacerPedido(c)] };
}

// El área del catálogo web a la que lleva «Hacer un pedido» de la campaña de pedido (`campanaPedidoArea`, dato del negocio, p. ej. «promociones»): solo letras,
// números, espacios, guion y guion bajo (viaja como `?area=` en la URL del catálogo; la web la COMPARA con sus áreas y, si no existe, abre «Todo»). '' = sin área.
function prAreaDelPedido(cfg) {
  const c = typeof cfg === 'object' && cfg !== null ? cfg : {};
  const a = prLinea(c.campanaPedidoArea, 60);
  return a !== '' && /^[\p{L}\p{N} _-]{1,60}$/u.test(a) ? a : '';
}

// «Hacer un pedido»: `m|pedido` abre la carta completa; con área configurada es `m|pedido|promos`, el MISMO botón de pedido (mismas reglas de horario y de paso)
// con una marca que hace que la carta se abra en esa área. El nombre del área NO viaja en el botón: lo toma `Plan del turno` del dato del negocio.
function prBotonHacerPedido(cfg) {
  return { id: prAreaDelPedido(cfg) !== '' ? 'm|pedido|promos' : 'm|pedido', title: 'Hacer un pedido' };
}

// =============================================================================
// VARIACIONES, ANUNCIO (referral) E IMAGEN DEL ANUNCIO — 06/11/2026 (adenda de campañas de Q'Taco)
// =============================================================================
// Todo se decide por CÓDIGO y SIEMPRE contra una campaña VIGENTE que el servidor aprobó (`campanas` / `anuncios`): lo que escribe el cliente, el
// `referral` del anuncio y el texto que Gemini leyó en una imagen son entrada NO confiable que SOLO elige cuál de esas campañas se muestra. Ninguno
// vende, cobra ni abre un pedido: la respuesta es el mismo mensaje de promoción (reemplaza al saludo; 0 mensajes agregados).
//
// Las dos campañas con mensaje del negocio se identifican por los datos de «Config base» que ya existen: «A» (pedido) es la campaña vigente cuyo texto es
// `campanaPedidoTexto`; «B» (reserva) la de `campanaReservaTexto`. Con la campaña apagada, vencida o sin esos datos, nada de esto se activa.
function prCampanaPorId(campanas, id, ahoraMs) {
  if (!Array.isArray(campanas) || typeof id !== 'string' || id === '') return null;
  const tope = Math.min(campanas.length, PR_MAX_CAMPANAS);
  for (let i = 0; i < tope; i++) {
    const c = campanas[i];
    if (typeof c !== 'object' || c === null || c.id !== id || typeof c.texto !== 'string') continue;
    if (ahoraMs !== undefined && !prVigente(c, ahoraMs)) continue;
    return { id: c.id, texto: c.texto.trim(), inicio: c.inicio, fin: c.fin };
  }
  return null;
}

// La campaña «A» (pedido) o «B» (reserva) vigente, o `null`. A exige `pedidosActivo === true`; B, `reservasActivo === true`.
function prCampanaDeTipo(campanas, cfg, tipo, ahoraMs) {
  const c = typeof cfg === 'object' && cfg !== null ? cfg : {};
  if (tipo === 'A') return c.pedidosActivo === true && prNorm(c.campanaPedidoTexto) !== '' ? prCampanaDelTexto(campanas, c.campanaPedidoTexto, ahoraMs) : null;
  if (tipo === 'B') return c.reservasActivo === true && prNorm(c.campanaReservaTexto) !== '' ? prCampanaDelTexto(campanas, c.campanaReservaTexto, ahoraMs) : null;
  return null;
}

// Minúsculas y sin tildes, CONSERVANDO los signos (para ver el «+» de «Jueves de +2»).
function prSinTildes(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Palabras que dicen «hablo de la promoción o del anuncio» (ya normalizado).
const PR_DICE_PROMO = /\b(promo|promos|promocion|promociones|oferta|ofertas|anuncio|anuncios|publicidad|publicacion|propaganda|facebook|face|fb|instagram|insta|ig|vi|vimos|redes)\b/;
// Pide los detalles de lo que incluye el combo (campaña B).
const PR_PIDE_DETALLE = /\b(que (incluye|incluyen|trae|traen|viene|vienen|lleva|llevan|contiene|contienen|tiene|tienen)|incluye|incluyen|detalles?|detallame|en que consiste|mas info|mas informacion|informacion|de que se trata|que es lo que (incluye|trae|viene))\b/;
// Pregunta por qué el arte dice «solo delivery» (campaña A).
const PR_PREGUNTA_DELIVERY = /\b(solo|solamente|unicamente|nomas)\b.*\b(delivery|domicilio)\b|\b(delivery|domicilio)\b.*\b(solo|solamente|unicamente|nomas)\b/;

// ¿El texto habla de la promo de las tortas mexicanas? Exige «tortas mexicanas» Y una palabra de promoción/anuncio: «quiero tortas», «quiero 2 tortas mexicanas
// con queso» (un pedido) o «una torta» NO la activan, y siguen el camino de siempre.
function prMencionaA(n) {
  return /\btortas? mexicanas?\b/.test(n) && PR_DICE_PROMO.test(n);
}
// ¿Habla del «Jueves de +2» o de agrandar el Q'Taco Dúo? «jueves de +2» / «jueves de mas 2» valen solos; «jueves de 2» (sin el «+») solo con una palabra de
// promoción y sin ser un horario («jueves de 2 a 4»); «agrandar … Q'Taco Dúo» en cualquier orden.
function prMencionaB(crudo, n) {
  if (/jueves de ?(\+|mas) ?2\b/.test(crudo)) return true;
  if (/\bjueves de 2\b/.test(n) && !/\bjueves de 2 (a|al|am|pm|hrs?|horas?|y|hasta|de la|en la)\b/.test(n) && PR_DICE_PROMO.test(n)) return true;
  return /\bagrand\w*\b/.test(n) && /\b(q ?taco|qtaco) duo\b/.test(n);
}

// Palabras que una pregunta SOBRE la promoción puede traer sin pedir nada más (saludos, la propia promo, precio, pedir o reservar). Si queda alguna otra, la
// pregunta es de otra cosa (C-09, 06/11/2026).
const PR_VOCABULARIO_PROMO = ('hola buenas buenos dias tardes noches vi vimos el la las los lo un una unos unas de del al en a y o u e que cual cuales como cuanto cuantos cuesta cuestan precio precios '
  + 'es son hay tienen tiene tienes quiero quisiera queria quisieramos saber info informacion promo promos promocion promociones anuncio anuncios oferta ofertas torta tortas mexicana mexicanas '
  + 'jueves mas 2 agrandar agranda agrandan agrandarlo q taco tacos qtaco duo por para con sin queso facebook face fb instagram insta ig redes publicidad publicacion me puedes pueden favor gracias '
  + 'ver sobre acerca esta esa ese este se mi su tu si no pedido pedir hacer reserva reservar mesa dime decir dinos puede puedo agrandado dia dias solo disponible vigente aun todavia valida valido').split(' ');
// ¿Es una PREGUNTA (con «?» o que empieza con una palabra interrogativa) que el mensaje de la promoción NO contesta? Solo se dice cuando queda al menos una
// palabra fuera del vocabulario de la promo. Ante la duda se pasa con el local: hay falsos positivos (se avisa de más), nunca una promesa.
function prPreguntaSinResponder(texto) {
  if (typeof texto !== 'string') return false;
  const corto = texto.slice(0, 600);
  const n = prNorm(corto);
  if (n === '') return false;
  if (!/[?¿]/.test(corto) && !/^(que|cual|cuales|cuanto|cuantos|como|donde|cuando|hay|tienen|puedo|se puede|pueden|hacen|aceptan|incluye|tiene|venden|quien)\b/.test(n)) return false;
  const palabras = n.split(' ');
  for (let i = 0; i < palabras.length; i++) {
    if (palabras[i] !== '' && PR_VOCABULARIO_PROMO.indexOf(palabras[i]) === -1) return true;
  }
  return false;
}

// La VARIACIÓN del texto de una campaña: `{campana, variante}` o `null`. `variante`: 'promo' (el mensaje de la promoción), 'detalle' (campaña B: «¿qué incluye?»)
// o 'solo_delivery' (campaña A: «¿por qué dice solo delivery?»). `contexto` ('A', 'B' o ''): la campaña que el cliente acaba de ver (estado de la conversación) o
// la de la imagen que mandó; con contexto, una pregunta SUELTA («¿qué incluye?», «¿solo delivery?», de hasta 200 caracteres) se atiende, y sin pregunta
// específica nunca activa nada. Nombrar las dos campañas a la vez es ambiguo: `null`. Sin campaña vigente que mostrar: `null`.
function prVariacion(texto, campanas, cfg, ahoraMs, contexto) {
  if (typeof texto !== 'string') return null;
  const corto = texto.slice(0, 600);
  const n = prNorm(corto);
  if (n === '') return null;
  const crudo = prSinTildes(corto);
  const dichoA = prMencionaA(n);
  const dichoB = prMencionaB(crudo, n);
  if (dichoA && dichoB) return null;
  const tipo = dichoA ? 'A' : dichoB ? 'B' : (contexto === 'A' || contexto === 'B') && n.length <= 200 ? contexto : '';
  if (tipo === '') return null;
  const campana = prCampanaDeTipo(campanas, cfg, tipo, ahoraMs);
  if (!campana) return null;
  if (tipo === 'B' && PR_PIDE_DETALLE.test(n)) return { campana: campana, variante: 'detalle' };
  if (tipo === 'A' && PR_PREGUNTA_DELIVERY.test(n)) return { campana: campana, variante: 'solo_delivery' };
  return dichoA || dichoB ? { campana: campana, variante: 'promo', sinResponder: prPreguntaSinResponder(texto) } : null;
}

// Las respuestas a una pregunta específica, con DATO del negocio (`campanaReservaDetalle`, `campanaPedidoEntrega`): `{cuerpo, botones}` o `null` si falta el
// dato o la capacidad (entonces rige el mensaje de la promoción). Nunca cobra ni vende: el botón es el mismo de la campaña.
function prRespuestaDeVariante(campana, cfg, variante) {
  if (typeof campana !== 'object' || campana === null) return null;
  const c = typeof cfg === 'object' && cfg !== null ? cfg : {};
  if (variante === 'detalle') {
    const base = prSoloReserva(campana, c);
    const cuerpo = prLinea(c.campanaReservaDetalle, 900);
    return base && cuerpo !== '' ? { cuerpo: cuerpo, botones: base.botones } : null;
  }
  if (variante === 'solo_delivery') {
    const base = prPedidoConMensaje(campana, c);
    const cuerpo = prLinea(c.campanaPedidoEntrega, 900);
    return base && cuerpo !== '' ? { cuerpo: cuerpo, botones: base.botones } : null;
  }
  return null;
}

// El anuncio por el que llegó el cliente (`referral` de WhatsApp: ya reducido a `{headline, body}` por `Interpretar entrada`). `reconocer` es
// `anuncioPorTitular` (módulo core, inyectado): compara el titular y el cuerpo con los `titulares` de los anuncios VIGENTES del servidor. Devuelve la campaña
// vigente de ese anuncio o `null` (referral ajeno, forjado, sin coincidencia, o dos campos que apuntan a anuncios distintos). NO vende ni abre nada.
function prCampanaDelReferral(campanas, anuncios, referral, ahoraMs, reconocer) {
  if (typeof referral !== 'object' || referral === null || typeof reconocer !== 'function' || !Array.isArray(anuncios)) return null;
  const ids = [];
  const campos = [referral.headline, referral.body];
  for (let i = 0; i < campos.length; i++) {
    const t = prLinea(campos[i], 200);
    if (t === '') continue;
    let a = null;
    try { a = reconocer(t, anuncios); } catch (e) { a = null; }
    if (a && typeof a.id === 'string' && a.id !== '') ids.push(a.id);
  }
  if (!ids.length || ids.some(function (x) { return x !== ids[0]; })) return null;
  return prCampanaPorId(campanas, ids[0], ahoraMs);
}

// Un titular leído de una imagen, apto SOLO para compararse: sin precios (el clasificador no debe devolverlos) y sin más de 100 caracteres.
function prTitularSeguro(v) {
  const t = prLinea(v, 100);
  if (/\b(bs|bob)\b|\$|\d{3,}|\d+\s*[.,]\s*\d{2}\b/i.test(t)) return '';
  return t;
}

// La campaña vigente a la que corresponde la IMAGEN que mandó el cliente, según lo que leyó el clasificador (`crudoGemini`: su respuesta como TEXTO, un JSON
// `{categoria, titular_principal, campana}`). Solo cuenta `categoria: 'publicidad'`. Se decide por el titular (`reconocer` = `anuncioPorTitular`, contra los
// anuncios vigentes) Y/O por el campo `campana` ('A' o 'B', el arte reconocido por sus elementos visuales); si los dos hablan y no coinciden, `null`. Lo leído
// en la imagen NUNCA llega a un modelo ni al cliente: solo decide un id de campaña aprobada. Una imagen no vende ni cobra.
function prCampanaDeLaImagen(campanas, anuncios, crudoGemini, ahoraMs, reconocer, cfg) {
  if (typeof crudoGemini !== 'string') return null;
  const m = /\{[\s\S]*\}/.exec(crudoGemini);
  if (!m) return null;
  let o = null;
  try { o = JSON.parse(m[0]); } catch (e) { o = null; }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
  if (typeof o.categoria !== 'string' || prNorm(o.categoria) !== 'publicidad') return null;
  let porTitular = null;
  const titular = prTitularSeguro(o.titular_principal);
  if (titular !== '' && typeof reconocer === 'function' && Array.isArray(anuncios)) {
    let a = null;
    try { a = reconocer(titular, anuncios); } catch (e) { a = null; }
    if (a && typeof a.id === 'string') porTitular = prCampanaPorId(campanas, a.id, ahoraMs);
  }
  const letra = typeof o.campana === 'string' ? o.campana.trim().toUpperCase() : '';
  const porCampo = letra === 'A' || letra === 'B' ? prCampanaDeTipo(campanas, cfg, letra, ahoraMs) : null;
  if (porTitular && porCampo) return porTitular.id === porCampo.id ? porTitular : null;
  return porTitular || porCampo;
}

// C-12 (06/11/2026): ¿es jueves en La Paz (UTC-4 fijo) en ese instante? Lo calcula el código; el día de la semana nunca lo dice el modelo.
function prEsJueves(ahoraMs) {
  if (typeof ahoraMs !== 'number' || !isFinite(ahoraMs)) return false;
  return new Date(ahoraMs - 4 * 3600000).getUTCDay() === 4;
}

// ¿Qué campaña de mensaje del negocio es esta (para recordarla en el estado y atender la pregunta que sigue)? 'A', 'B' o ''.
function prTipoDeCampana(campana, cfg) {
  if (typeof campana !== 'object' || campana === null || typeof campana.texto !== 'string') return '';
  const c = typeof cfg === 'object' && cfg !== null ? cfg : {};
  const t = prNorm(campana.texto);
  if (t === '') return '';
  if (t === prNorm(c.campanaPedidoTexto)) return 'A';
  if (t === prNorm(c.campanaReservaTexto)) return 'B';
  return '';
}
