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
//   * No decide por el titular del anuncio, ni por el `referral`, ni por el
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
