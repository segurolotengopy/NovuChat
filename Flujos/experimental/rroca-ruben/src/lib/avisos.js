// =============================================================================
// AVISOS DE LA «VENTA DIGITAL DE RUBÉN» (prefijo `av` / `AV_`): HUECO DECLARADO en PROPIO.md
// =============================================================================
// COPIA, declaración por declaración y BYTE A BYTE, de `Flujos/experimental/venta-minima/src/lib/avisos.js` (rama #519): el módulo común de avisos todavía no existe. Solo lo
// que usan el aviso mínimo de PR-2 (texto libre a Rubén, dentro de las 24 h) y los ganchos de PR-3 (`avPlantilla`). Cada declaración tiene su prueba contra el origen en
// `armado.test.ts`. Sin `require`, `URL`, `Buffer` ni `crypto`.

// La copia local de la red de palabras que el asistente jamás dice (la de `comun.js` manda si existe).
const AV_PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos\s+tu\s+pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S{0,40}\s+(tu|el|su|mi|un|este|ese|la|tus|sus|los)\s+(pago|transferencia|dep[oó]sito|abono)s?|lleg[oó]\s+(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)|(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+)?(lleg|ingres|entr)(o|ó|aron)\b|(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+|fue\s+|fueron\s+|est[aá]\s+)?(recibid|aprobad|[eé]xitos|realizad|registrad|llegad|ingresad|efectuad)|confirm(amos|ó|o)\s+(tu|tus|su|sus|la|el|lo|los|las)\b|\b(?:est[aá]n?|qued[oó]|queda|quedan|quedaron|fue|fueron|ya)\s+(?:ya\s+)?reservad|reserva\s+((est[aá]|qued[oó])\s+)?(registrad|agendad)|reservamos tu|\b(?:te|le|les|se|lo|la|ya)\s+confirm(?:o|amos|é|ó|aron)\b|gracias\s+por\s+(tu|su|el)\s+(pago|transferencia|dep[oó]sito|abono)s?|\b(lleg|ingres|entr)(o|ó|aron)\s+(tu|tus|el|los|su|sus|mi|la|las)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata|monto)|\b(tu|tus|el|los|su|sus|mi|la|las)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata|monto)s?\s+(ya\s+)?(lleg|ingres|entr)(o|ó|aron)\b|\brecib(imos|i|í|ido)\s+(el|la|tu|su)\s+(dinero|plata|monto)|(pago|transferencia|dep[oó]sito|abono|cobro)s?\s+(ya\s+|fue\s+|fueron\s+|est[aá]\s+|qued[oó]\s+|se\s+)?(ya\s+)?(recibid|aprobad|[eé]xitos|realizad|registrad|llegad|ingresad|efectuad|aceptad|completad|procesad|reflejad|comprobad)|\breflej(o|ó)\s+(tu|el|su)\s+(pago|transferencia|dep[oó]sito|abono)|\b(verificamos|comprobamos|validamos|aceptamos|tenemos|vimos|cobramos)\s+(tu|tus|su|sus|el|la)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata)|\bpago\s+(listo|ok)\b|\b(tu|su|el)\s+pago\s+(ya\s+)?(est[aá]|qued[oó])\s+(ya\s+)?(listo|ok|en\s+orden|bien|correcto|completo|hecho)\b|en\s+orden\s+con\s+(tu|su|el)\s+pago|\bsaldad[oa]s?\b|\b(pedido|cuenta|pago|total|orden|deuda)s?\s+((ya\s+)?(est[aá]n?|qued[oó]|fue|queda)\s+)?(ya\s+)?cancelad[oa]s?\b|\bya\s+nos\s+pag(aste|o|ó|aron)\b|\bgracias\s+por\s+pagar\b|\bya\s+pagaste\W{0,3}\s*(muchas\s+)?gracias|\brecib(imos|i|í|ido)\s+(bs\.?\s*|bob\s*)?\d+([.,]\d+)?\s*(bs|bob|bolivianos)\b|\bconfirm(amos|e|é)\s+que\s+(ya\s+)?pag|(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+)?se\s+reflej/i;

const AV_ENLACE = /(?:https?:\/\/|www\.)\S+|\b(?:wa\.me|t\.me|bit\.ly|goo\.gl|tinyurl\.com)\/\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|bo|me|io|co|app|ly|link|info|biz|xyz|site|online)\b(?:\/\S*)?/gi;

function avProhibidas() {
  try {
    if (typeof VM_PROHIBIDAS !== 'undefined' && VM_PROHIBIDAS instanceof RegExp) return VM_PROHIBIDAS;
  } catch (e) { /* VM_PROHIBIDAS aún sin declarar: rige la copia local */ }
  return AV_PROHIBIDAS;
}

// Confusables latino/cirílico/griego que se pliegan a ASCII SOLO para comparar (S-1). Las dos cadenas van en paralelo, letra
// por letra. El texto que sale nunca se pliega, y las letras latinas no están en la tabla (un texto legítimo no cambia).
const AV_CONFUSABLES_DE = 'аеорсухіјѕԁһӏ' + 'αεικορτυχνηβı';

const AV_CONFUSABLES_A = 'aeopcyxijsdhl' + 'aeikoptuxvnbi';

const AV_OMITIDO = '[texto omitido]';

/** La forma en que se COMPARA (S-1): NFKC, sin controles C1 ni caracteres de formato, NFD sin marcas, en minúsculas y con los confusables plegados. */
function avCanon(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').replace(/[\u0080-\u009f]/g, '').replace(/\p{Cf}/gu, '').replace(/[\u115f\u1160\u3164\uffa0\u2800]/g, '')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[Ͱ-ϿЀ-ԯı]/g, (c) => {
      const i = AV_CONFUSABLES_DE.indexOf(c);
      return i < 0 ? c : AV_CONFUSABLES_A.charAt(i);
    });
}

/** La forma canónica sin puntuación: todo lo que no es letra ni número es un espacio. */
function avNorm(t) {
  return avCanon(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Las palabras de `s` que caen dentro de una coincidencia de la red, mirando la forma canónica (con puntuación) y la sin
// puntuación, cada una con las palabras unidas por un espacio. `separadores[k]` es el espacio que antecede a la palabra `k`.
function avPalabrasProhibidas(s) {
  const re0 = avProhibidas();
  const base = re0.flags.replace(/[gy]/g, '');
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
  for (const forma of [avCanon, avNorm]) {
    const spans = [];
    let unido = '';
    palabras.forEach((w, k) => {
      const f = forma(w);
      if (f === '') { spans.push(null); if (forma === avNorm) vacias[k] = true; return; }
      if (unido !== '') unido += ' ';
      spans.push([unido.length, unido.length + f.length]);
      unido += f;
    });
    const re = new RegExp(re0.source, base + 'g');
    let m = re.exec(unido);
    while (m) {
      const a = m.index;
      const b = a + m[0].length;
      spans.forEach((p, k) => { if (p && p[0] < b && p[1] > a) marcadas[k] = true; });
      if (m[0].length === 0) re.lastIndex++;
      m = re.exec(unido);
    }
  }
  // Una palabra sin letras ni números («·», «-») entre dos marcadas se va con ellas: queda UNA marca.
  for (let k = 0; k < palabras.length; k++) {
    if (!marcadas[k]) continue;
    let j = k + 1;
    while (j < palabras.length && vacias[j] && !marcadas[j]) j++;
    if (j < palabras.length && marcadas[j]) for (let x = k + 1; x < j; x++) marcadas[x] = true;
  }
  return { palabras, separadores, marcadas, cola: sep };
}

// Cada PALABRA que forma parte de una coincidencia de la red (en la forma canónica o en la sin puntuación) se cambia por
// «[texto omitido]» (una marca por racha). No se corta ninguna palabra ni se normaliza nada fuera de la coincidencia. Llega a
// un punto fijo: tras reemplazar se vuelve a probar (hasta 3 pasadas) y, si aún coincide, devuelve solo la marca.
function avSinProhibidas(t) {
  let s = String(t === undefined || t === null ? '' : t);
  for (let pasada = 0; pasada < 3; pasada++) {
    const r = avPalabrasProhibidas(s);
    if (!r.marcadas.some(Boolean)) return s;
    let salida = '';
    let enMarca = false;
    r.palabras.forEach((w, k) => {
      if (r.marcadas[k]) {
        if (!enMarca) salida += r.separadores[k] + AV_OMITIDO;
        enMarca = true;
      } else {
        salida += r.separadores[k] + w;
        enMarca = false;
      }
    });
    s = salida + r.cola;
  }
  const re = avProhibidas();
  const rx = new RegExp(re.source, re.flags.replace(/[gy]/g, ''));
  return rx.test(avCanon(s)) || rx.test(avNorm(s)) ? AV_OMITIDO : s;
}

function avDigitos(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
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

/** Recorta a `n` puntos de código sin partir un par sustituto (acotado: solo mira los primeros `2n` caracteres). */
function avCortar(s, n) {
  return s.length > n ? Array.from(s.slice(0, n * 2)).slice(0, n).join('') : s;
}

/**
 * Una sola línea limpia: sin saltos ni tabuladores (quedan « · »), sin enlaces («[enlace omitido]»; una abreviatura con punto
 * pegada a la palabra siguiente, como «Nro.123» o «Av.Arce», recibe un espacio: «Nro. 123», «Av. Arce»), sin `{}<>&` ni marcas
 * de formato de WhatsApp (`* _ ~` y la comilla invertida), sin palabras prohibidas (cada palabra afectada, entera, por
 * «[texto omitido]»), sin espacios repetidos y con tope de caracteres. Con `opc.cocina` se quitan además los números largos
 * (teléfonos, cuentas, documentos). Devuelve '' si no queda nada.
 * TIEMPO LINEAL: el texto se recorta a `max * 2` antes de aplicar ninguna expresión regular y otra vez después de NFKC (una
 * ligadura como «㏂» crece 4×), y los bordes « · » se quitan a mano (la forma `(\s*·\s*)+$` tenía retroceso exponencial: 24
 * «· » seguidos tardaban 1,6 s y 90 no terminaban).
 */
function avLimpio(t, max, opc) {
  const tope = (Number.isFinite(max) && max > 0) ? Math.floor(max) : 500;
  let s = avCortar((t === undefined || t === null) ? '' : String(t), tope * 2);
  // NFKC (ancho completo, ligaduras) y sin caracteres de formato, salvo «º» y «ª» (NFKC los cambia por «o» y «a»: «N.º»).
  // Tampoco «…»: NFKC lo cambiaría por «...» y la marca «… y N más» de una lista recortada dejaría de ser la que armó el código.
  s = s.split(/([ºª…])/).map((p, i) => (i % 2 ? p : p.normalize('NFKC'))).join('').replace(/\p{Cf}/gu, '');
  s = avCortar(s, tope * 2);
  // El punto ideográfico («。» U+3002) y el de media anchura («｡» U+FF61) NFKC no los lleva a «.»: se normalizan aquí, antes del filtro.
  s = s.replace(/[。｡]/g, '.');
  s = s.replace(AV_ENLACE, ' [enlace omitido] ');
  s = s.replace(/[\r\n\t\u000b\u000c\u0085\u2028\u2029]+/g, ' · ');
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '');
  s = s.replace(/[{}<>&*_~`]/g, ' ');
  // Un punto pegado a lo que sigue (letra.letra, letra.número o número.letras) recibe un espacio: así «Nro.123», «Av.Arce» o
  // «dpto.4B» llegan enteros, y «malo.test/x» o «x.ru» no quedan como un enlace que WhatsApp convierta en tocable. Los
  // decimales y las horas («4.50», «12.30», «1.25L») no se tocan.
  s = s.replace(/(?<=[\p{L}\p{M}])(?<![ºª])\.(?=[\p{L}\p{M}\p{N}])(?![ºª])|(?<=\p{N})\.(?=\p{L}{2})/gu, '. ');
  if (opc && opc.cocina) {
    s = s.replace(/\+?\d[\d\s.-]{5,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '…' : m));
    s = s.replace(/\d{7,}/g, '…');
  }
  // Se colapsan espacios y « · » ANTES de comparar con la red: quitar `*_~` deja huecos que juntan frases («te *avisamos»).
  s = avSinBordes(s.replace(/\s{2,}/g, ' '));
  s = avSinBordes(s.replace(/(?:\s·){2,}/g, ' ·'));
  s = avSinBordes(avSinProhibidas(s).replace(/\s{2,}/g, ' '));
  if (Array.from(s).length > tope) {
    // El corte PUEDE volver a formar una coincidencia de la red («confirmo tubos» recortado a «confirmo tu»): tras cortar se vuelve
    // a sanear, y como la marca es más larga que una palabra corta, se vuelve a cortar (hasta 4 vueltas, siempre acotado).
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      s = Array.from(s).slice(0, tope).join('');
      // Un corte que cae dentro de una marca («[texto omit») se retrocede hasta el corchete que la abre.
      const ab = s.lastIndexOf('[');
      if (ab >= 0 && ab > s.lastIndexOf(']')) s = s.slice(0, ab);
      s = avSinBordes(avSinProhibidas(avSinBordes(s)).replace(/\s{2,}/g, ' '));
      if (Array.from(s).length <= tope) break;
    }
  }
  return avAjustarFinal(s, tope);
}

/** Verdadero si `s` coincide con la red en la forma canónica o en la sin puntuación (la misma comprobación de `avSinProhibidas`). */
function avCoincide(s) {
  const re = avProhibidas();
  const rx = new RegExp(re.source, re.flags.replace(/[gy]/g, ''));
  return rx.test(avCanon(s)) || rx.test(avNorm(s));
}

/**
 * Última garantía de `avLimpio`: el resultado respeta el tope y NO coincide con la red. Si algo falla, se quitan palabras
 * ENTERAS del final hasta que cumpla (y, en el peor caso, devuelve '').
 */
function avAjustarFinal(s, tope) {
  if (Array.from(s).length <= tope && !avCoincide(s)) return s;
  const palabras = s.split(' ');
  while (palabras.length > 0) {
    palabras.pop();
    const t = avSinBordes(palabras.join(' '));
    if (Array.from(t).length <= tope && !avCoincide(t)) return t;
  }
  return '';
}

/** El texto de una variable de plantilla: sin saltos, sin 5+ espacios, con tope (500) y nunca vacío («—»). */
function avParametro(t, max, opc) {
  return avLimpio(t, max === undefined ? 500 : max, opc) || '—';
}

function avPrimerNombre(n, opc) {
  return avLimpio(n, 60, opc).split(' ')[0] || '';
}

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
 *
 * `incluirPropio` es el INTERRUPTOR SOLO DE ENSAYO (`avisarAlPropioNumero` de «Config base»): con `true` EXACTO, el destinatario
 * igual a `from` no se descarta (un solo teléfono hace de cliente y de restaurante). Es la ÚNICA excepción a «nunca al propio
 * número»; el resto de los filtros (prefijo, 8 a 15 dígitos, unicidad, rol) sigue igual. `construir.mjs` solo deja la clave en
 * `ensayo-demo-a.json`. Cualquier otro valor (ausente, «true» como texto, 1, un objeto) es falso: la regla de producción.
 */
function avDestinatarios(csv, from, prefijos, incluirPropio) {
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
  return avUnificar(crudos, incluirPropio === true ? '' : avDigitos(from), avPrefijos(prefijos));
}

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
