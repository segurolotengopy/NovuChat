// =============================================================================
// CONVERSACIÓN COMÚN DE LAS VENTAS DIGITALES (prefijo `vd` / `VD_`): la charla antes de las opciones
// =============================================================================
// El motor de «la conversación como el PDF modelo» (dos mensajes de charla antes de cualquier precio), sacado de `rr.js` (commit fb3b8994) y PARAMETRIZADO: aquí no hay textos, nombres, productos ni montos de
// un negocio; todo eso entra por parámetro (catálogo, sinónimos, textos del puente). Cada función es pura: sin reloj (la hora, si hace falta, es un parámetro), sin red, sin estado.
//
// Va DESPUÉS de `cobro.js` en el nodo Code (usa `cbLinea` y `cbMonto`). JavaScript plano: sin `import`/`export`, `require`, `URL`, `Buffer` ni `crypto`; los nombres globales llevan el prefijo `vd`/`VD_` para no chocar
// con los de la librería propia de cada flujo. Contrato de cada función: `venta-digital/LEEME.md`.

const VD_OLVIDO_MS = 48 * 60 * 60 * 1000;   // la charla vence a las 48 h sin mensajes (como el historial)
const VD_CHARLA_MINIMA = 2;                 // mensajes de conversación antes de mostrar precios u opciones (el saludo cuenta como el primero)
const VD_CHARLA_TOPE = 1000;
const VD_MODOS = { charla: 'CHARLA', antes: 'CHARLA_ANTES_DE_OPCIONES', puente: 'PUENTE', opciones: 'OPCIONES' };
// Los tipos de plan que cuentan como CONVERSACIÓN. NO cuentan el modelo caído, el repetido, la identidad, la información fija ni las derivaciones (ante la duda, se conversa de más).
const VD_TIPOS_DE_CHARLA = ['modelo', 'audio_modelo', 'imagen_modelo', 'puente', 'puente_fijo', 'charla_fija', 'opciones', 'opciones_fijo'];

function vdTexto(v) { return v === undefined || v === null ? '' : String(v); }

// La forma en que se compara: NFKC, sin tildes, en minúsculas y solo letras y dígitos separados por un espacio.
function vdNorm(t) {
  return vdTexto(t).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Hash corto (djb2 sobre el texto normalizado) para comparar textos enviados; no es criptográfico ni se usa para nada de seguridad.
function vdHashTexto(t) {
  const s = vdNorm(t);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return ('00000000' + h.toString(16)).slice(-8);
}

// -----------------------------------------------------------------------------
// La ficha de charla y la compuerta de las opciones
// -----------------------------------------------------------------------------
// De la ficha de un teléfono solo se lee la charla: { charlaN (0 a 1000), pidioOpciones, opcionesVistas } con los booleanos ESTRICTOS (`=== true`). Con `ahoraMs` (opcional), una charla sin mensajes
// hace más de 48 h (`f.ultimoMs`) se reinicia: quien vuelve después empieza otra charla. Una ficha ausente o rara vale { 0, false, false }.
function vdFichaCharla(f, ahoraMs) {
  const x = f !== null && typeof f === 'object' ? f : {};
  const vencida = Number.isFinite(ahoraMs) && Number.isFinite(x.ultimoMs) && x.ultimoMs > 0 && ahoraMs - x.ultimoMs > VD_OLVIDO_MS;
  return {
    charlaN: !vencida && Number.isFinite(x.charlaN) && x.charlaN > 0 ? Math.min(Math.floor(x.charlaN), VD_CHARLA_TOPE) : 0,
    pidioOpciones: !vencida && x.pidioOpciones === true,
    opcionesVistas: !vencida && x.opcionesVistas === true,
  };
}

// LA COMPUERTA: ¿ya se pueden mostrar precios, catálogo o menú? Sí con dos mensajes de conversación, o con una excepción: QR abierto, producto elegido, pedidos, comprobante recibido o cobro en revisión.
// `ctx` = { charlaN, qrAbierto, producto, pedidos, comprobanteMs, enRevision }; un campo ausente o de otro tipo no abre la compuerta.
function vdHabilitado(ctx) {
  const c = ctx !== null && typeof ctx === 'object' ? ctx : {};
  return c.qrAbierto === true
    || (typeof c.producto === 'string' && c.producto !== '')
    || (Number.isFinite(c.pedidos) && c.pedidos > 0)
    || (Number.isFinite(c.comprobanteMs) && c.comprobanteMs > 0)
    || c.enRevision === true
    || (Number.isFinite(c.charlaN) && c.charlaN >= VD_CHARLA_MINIMA);
}

// ¿Este tipo de plan cuenta como un mensaje de conversación? El saludo cuenta SOLO si lleva presentación, es decir, si el teléfono NO estaba saludado antes (`saludadoAntes`).
function vdCuentaComoCharla(tipo, saludadoAntes) {
  if (tipo === 'saludo') return saludadoAntes !== true;
  return typeof tipo === 'string' && VD_TIPOS_DE_CHARLA.indexOf(tipo) >= 0;
}

// La línea del SISTEMA que le dice al modelo en qué modo va el turno: '[MODO_TURNO: CHARLA]\n', etc. Un modo desconocido (o heredado de Object) da ''.
function vdLineaModo(modo) {
  return typeof modo === 'string' && Object.prototype.hasOwnProperty.call(VD_MODOS, modo) ? '[MODO_TURNO: ' + VD_MODOS[modo] + ']\n' : '';
}

// -----------------------------------------------------------------------------
// Texto: oraciones, preguntas y promesas
// -----------------------------------------------------------------------------
// Parte un bloque en oraciones tras . ! ? … cuando sigue una mayúscula, una cifra o una apertura, y vuelve a unir las abreviaturas («Sr.», «Dr.», «etc.»), «Bs.» seguido de una cifra y el número corto de una lista en línea.
function vdOraciones(bloque) {
  const partes = vdTexto(bloque).split(/(?<=[.!?…])\s+(?=[¿¡«"A-ZÁÉÍÓÚÑ0-9])/);
  const out = [];
  for (const p of partes) {
    const previa = out.length ? out[out.length - 1] : '';
    const une = out.length && (/(^|\s)(Sr|Sra|Srta|Dr|Dra|Lic|Ing|etc|Nº|N°)\.$/.test(previa)
      || (/(^|\s)Bs\.$/.test(previa) && /^\d/.test(p))
      || (/(^|\s)\d{1,2}\.$/.test(previa) && /^[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p) && (/\s\d{1,2}\.$/.test(p) || /(^|\s)\d{1,2}\.\s/.test(previa))));
    if (une) out[out.length - 1] += ' ' + p; else out.push(p);
  }
  return out;
}

// ¿Esta oración es una pregunta? Cuenta aunque tras el «?» venga un emoji o espacios.
function vdEsPregunta(oracion) { return /\?[^\p{L}\p{N}]*$/u.test(vdTexto(oracion)); }

// Quita del texto del modelo toda oración interrogativa (la final y cualquier otra): el sistema agrega la suya y NUNCA hay dos preguntas ni una pregunta antes de los botones. '' si no queda nada.
function vdSinPreguntaFinal(texto) {
  const bloques = vdTexto(texto).split('\n\n').map((bloque) => {
    if (bloque.indexOf('\n') >= 0) return vdEsPregunta(bloque) ? '' : bloque;
    return vdOraciones(bloque).filter((o) => o.indexOf('?') < 0).join(' ');
  }).filter((b) => b.trim() !== '');
  return bloques.join('\n\n').trim();
}

// PROMESAS DE OPCIONES O PRECIOS. Con la compuerta cerrada, el modelo no puede prometer mostrar precios, opciones ni catálogo («Ahorita te paso los precios»): lo que se promete lo cumple el código, y antes de tiempo no hay con qué.
// Una oración promete si nombra un objeto de precio (precios, costos, opciones, catálogo, «cuánto cuesta»…), o si junta un marcador de inminencia (ya te, ahorita, luego, abajo, en un momento…) con un verbo de comunicar, en cualquier orden.
const VD_PROMETE_OBJETO = /\b(precios?|costos?|montos?|tarifas?|paquetes?|planes|opciones|opcion|alternativas?|catalogo|lista de (precios|opciones|productos)|carta|menu|botones|los de abajo|cotizacion(es)?|inversion(es)?|packs|combos?|productos disponibles|modalidades|formas? de pago|(link|enlace)s? de pago|como comprar\w*|para comprar\w*|valor(?! de (tu|su|la|mi) (marca|empresa|negocio))|cuanto (te )?(cuesta|cuestan|sale|salen|vale|valen|es|seria|serian|saldria|costaria)|(lo )?que (cuesta|cuestan|sale|salen|vale|valen)|lo que (tenemos|ofrecemos)|los numeros|precos?|custos?|opcoes|planos|prices?|costs?|options|pricing)\b/;
// Objetos «débiles»: solo prometen junto a un verbo de mostrar («Te muestro el detalle»). Los nombres de los productos de cada negocio entran por `debiles` (parámetro de las funciones de abajo), nunca aquí.
const VD_PROMETE_DEBIL_BASE = ['versiones', 'detalles'];
const VD_PROMETE_MARCA = /\b(ya te|ya le|ya me|ahorita|abajito|ahora te|ahora le|enseguida|en seguida|en un momento|luego|mas tarde|en el proximo mensaje|en el siguiente mensaje|a continuacion|abajo|mas abajo|ahora mismo|dame un (segundo|momento|instante)|ya (viene|vienen|llega|llegan|van)|en breve|ya mismo|al toque|ahi (van|va)|vou|ja te|ja vou|daqui a pouco|agora)\b/;
const VD_PROMETE_VERBO = /\b(muestro|muestra|mostrar|mostrare|paso|pasare|pasar|doy|dare|dar|envio|enviare|enviar|mando|mandare|mandar|dejo|dejare|dejar|comparto|compartire|compartir|cuento|contare|contar|digo|dire|decir|comento|comentare|comentar|presento|presentare|presentar|enseno|ensenare|ensenar|explico|explicare|explicar|detallo|detallare|detallar|informo|informar|suelto|armo|armare|preparo|preparare|(mostrar|pasar|enviar|mandar|dejar|compartir|contar|decir|ensenar|explicar|presentar|dar|informar|detallar|escribir)(te|le|me|selos|selas|tela|telas|telo|telos)|llegan|llega|llegaran|viene|vienen|va|van|ver|veras|vas a ver|pase|mira|mire|ve|revisa|adjunto|aqui tienes|tienes|hago llegar|passo|mostro|conto|falo)\b/;
// Contextos que NO prometen nada aunque nombren un objeto de precio: el negocio del cliente («te preguntan precios», «tu catálogo en fotos») y «sin costo».
const VD_PROMETE_EXENTO = /\b(preguntan|pregunta|preguntar|preguntas|piden|pide|pedir|consultan|consulta|cotizan|piden por|escriben por|sin costo|sin costos)( por| los| las| el| la)?( los| las)? (precios?|costos?|precio|tarifas?)\b|\bsin costos?\b|\b(bajar|reducir|ahorrar|recortar) (los )?costos\b|\b(tu|tus|su|sus|mi|mis) (catalogo|precios|tarifas|costos|paquetes|planes|menu|carta|opciones de negocio)\b/g;

function vdEscapar(s) { return vdTexto(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// `debiles`: lista opcional de palabras (nombres de producto) que prometen solo junto a un verbo de mostrar. Cada una se compara normalizada y como palabra completa.
function vdPrometeOpciones(oracion, debiles) {
  const n = vdNorm(oracion).replace(VD_PROMETE_EXENTO, ' ');
  if (VD_PROMETE_OBJETO.test(n)) return true;
  const verbo = VD_PROMETE_VERBO.test(n);
  const extras = (Array.isArray(debiles) ? debiles : []).map(vdNorm).filter((w) => w !== '').map(vdEscapar);
  const debil = new RegExp('\\b(' + VD_PROMETE_DEBIL_BASE.concat(extras).join('|') + ')\\b');
  return (verbo && (VD_PROMETE_MARCA.test(n) || debil.test(n))) || /\bte (las|los|lo|la) (paso|dejo|muestro|mando|envio|comparto|pasare|dejare|mostrare|mandare|enviare|digo|comento|hago llegar)\b/.test(n);
}

// Quita del texto las oraciones que prometen opciones o precios (los párrafos se conservan). Cada LÍNEA es una unidad y, dentro de ella, cada ORACIÓN: un salto de línea simple no esconde la promesa. '' si no queda nada.
function vdQuitarPromesaDeOpciones(texto, debiles) {
  const original = vdTexto(texto).split('\n');
  const lineas = original.map((l) => (l.trim() === '' ? '' : vdOraciones(l).filter((o) => !vdPrometeOpciones(o, debiles)).join(' ')));
  const salida = [];
  for (let i = 0; i < lineas.length; i += 1) {
    if (lineas[i] === '' && original[i].trim() !== '') continue;   // la línea era solo una promesa: se va entera
    salida.push(lineas[i]);
  }
  return salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// -----------------------------------------------------------------------------
// Etiquetas, ahorro y puente
// -----------------------------------------------------------------------------
// La etiqueta de un botón con precio, como en el PDF modelo: «<nombre> <precio>Bs» (sin espacio antes de «Bs», sin emojis). Nunca pasa de 20 caracteres y conserva el «NNBs»: si no cabe, se recortan palabras del nombre.
// El nombre y el monto los pone quien llama (salen del catálogo del negocio, nunca de este archivo).
function vdEtiquetaConPrecio(nombre, monto) {
  const sufijo = ' ' + cbMonto(monto) + 'Bs';
  const palabras = cbLinea(nombre, 40).split(' ').filter((w) => w !== '');
  while (palabras.length > 1 && (palabras.join(' ') + sufijo).length > 20) palabras.pop();
  let n = palabras.join(' ');
  if ((n + sufijo).length > 20) n = n.slice(0, Math.max(0, 20 - sufijo.length)).trimEnd();
  return (n + sufijo).trim();
}

// El ahorro del paquete frente a comprar sus componentes por separado: lo CALCULA el código con los precios del catálogo. `cat` = { <id>: precio }, `pack` = el id del paquete, `componentes` = los ids que reemplaza.
// null si falta algún precio (no es un número finito), si no hay componentes o si no ahorra. Redondeado a centavos.
function vdAhorro(cat, pack, componentes) {
  const c = cat !== null && typeof cat === 'object' && !Array.isArray(cat) ? cat : {};
  const ids = Array.isArray(componentes) ? componentes : [];
  const precio = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(c, id) && typeof c[id] === 'number' && Number.isFinite(c[id]) && c[id] > 0 ? c[id] : null);
  const p = precio(pack);
  const partes = ids.map(precio);
  if (p === null || ids.length === 0 || partes.some((x) => x === null)) return null;
  const a = Math.round((partes.reduce((s, x) => s + x, 0) - p) * 100) / 100;
  return a > 0 ? a : null;
}

// El texto del puente (el mensaje que, cuando el cliente pidió precios demasiado pronto, aporta una idea antes del cierre «¿…las opciones?»): la primera variante cuyo mensaje, solo o con el cierre, NO sea idéntico a lo último
// que se envió (`hashUltimo`, de `vdHashTexto`). `textos` = { variantes: [texto, …], cierre: texto }. Sin variantes, ''. Si todas coinciden con lo último, la primera.
function vdTextoPuente(textos, hashUltimo) {
  const t = textos !== null && typeof textos === 'object' ? textos : {};
  const variantes = Array.isArray(t.variantes) ? t.variantes.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
  const cierre = typeof t.cierre === 'string' ? t.cierre : '';
  return variantes.find((x) => vdHashTexto(x) !== hashUltimo && vdHashTexto(cierre === '' ? x : x + '\n\n' + cierre) !== hashUltimo) || variantes[0] || '';
}

// -----------------------------------------------------------------------------
// La pregunta por el precio de UN producto
// -----------------------------------------------------------------------------
// «¿Cuánto cuesta el libro?», «precio del workbook», «¿qué precio tiene la guía?»: el precio lo dice el CÓDIGO desde el catálogo. `norm` = el mensaje del cliente (se normaliza de nuevo: es idempotente) y `sinonimos` =
// { <idProducto>: [palabras o frases con que el cliente lo nombra] } (dato del negocio, nunca de este archivo).
// Devuelve { producto: <id> } si pregunta el precio y nombra EXACTAMENTE un producto; { producto: '' } si pregunta el precio en general (o nombra varios); null si no es una pregunta de precio.
// Afinado frente al defecto de la primera versión: la palabra «precio» SUELTA no es una pregunta («qué precios bajos», «el precio no importa», «me preguntan precio de las tortas», «responder precios por WhatsApp»).
// Cuentan las FORMAS de preguntar: «cuánto cuesta/vale/sale X», «a cuánto», «cuánto es» (mensaje corto o con producto), «qué/cuál precio tiene», «cuál es el precio», «dame/pásame/quiero saber el precio» y «precio de X» con X un producto.
function vdPrecioPedido(norm, sinonimos) {
  const n = vdNorm(norm);
  if (n === '') return null;
  // «No importa cuánto cueste»: no pregunta.
  if (/\b(no (me )?(importa|interesa)|da igual|me da lo mismo)\b/.test(n)) return null;
  const mapa = sinonimos !== null && typeof sinonimos === 'object' && !Array.isArray(sinonimos) ? sinonimos : {};
  const nombrados = [];
  const regexSin = {};
  for (const id of Object.keys(mapa)) {
    const lista = (Array.isArray(mapa[id]) ? mapa[id] : []).map(vdNorm).filter((w) => w !== '').map(vdEscapar);
    if (lista.length === 0) continue;
    regexSin[id] = lista.join('|');
    if (new RegExp('\\b(' + regexSin[id] + ')\\b').test(n)) nombrados.push(id);
  }
  const otraMedida = /\b(plazo|plazos|entrega|entregan|envio|envios|tiempo|tarda|tardan|demora|demoran|dura|duran|duracion|horas|dias|minutos|pesa|descarga|ganar|gano|ganan|ingresos|veces|personas|clientes|antes)\b/.test(n);
  const palabras = n.split(' ').length;
  const articulos = '(?:(?:el|la|los|las|tu|tus|su|sus|un|una|este|esta|ese|esa|mi|nuestro|nuestra)\\s+){0,2}';
  const nombreVerbo = '\\bcuanto\\s+(?:(?:me|te|nos|lo|la|los|las|le)\\s+)*(?:cuesta|cuestan|costaria|costarian|vale|valen|sale|salen|saldria|cobran|cobras|cobra|cobrarias|dejas|dejarias|queda|quedaria)\\b'
    + '|\\ben cuanto\\s+(?:esta|estan|sale|salen|queda|quedan|me lo dejas|lo dejas)\\b|\\ba cuanto\\s+(?:esta|estan|sale|salen|lo|la|los|las|vendes|dejas|me)\\b';
  const pregunta = new RegExp(nombreVerbo).test(n)
    || (/\bcuanto\b/.test(n) && !otraMedida && (palabras <= 5 || nombrados.length > 0))
    || /\b(?:que|cual)\s+(?:precio|valor|costo|tarifa)s?\s+(?:tiene|tienen|tendra|tendria|manejas|manejan)\b/.test(n)
    || /\bcual(?:es)?\s+(?:es|son|seria|serian)\s+(?:el|la|los|las|su|tu|sus|tus)\s+(?:precio|precios|costo|costos|tarifa|tarifas)\b/.test(n)
    || /\b(?:pasa|pasame|pasas|manda|mandame|mandas|envia|enviame|envias|dame|dime|muestra|muestrame|comparte|compartime|dejame|quiero saber|quisiera saber|quiero ver|quisiera ver|necesito saber|me interesa saber)\s+(?:(?:el|la|los|las|tu|tus|su|sus|todos los)\s+)?(?:precio|precios|costo|costos|tarifa|tarifas)\b/.test(n);
  // «Precio de X»: solo cuenta con un producto del negocio inmediatamente después («precio de las tortas» no es de aquí).
  let nominal = false;
  for (const id of nombrados) {
    if (new RegExp('\\b(?:precio|precios|valor|costo|costos|tarifa|tarifas)\\s+(?:de|del|para|por)\\s+' + articulos + '(?:' + regexSin[id] + ')\\b').test(n)) nominal = true;
  }
  if (!pregunta && !nominal) return null;
  return { producto: nombrados.length === 1 ? nombrados[0] : '' };
}
