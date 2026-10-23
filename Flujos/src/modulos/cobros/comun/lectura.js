// =============================================================================
// COBROS · VENTA · LECTURA DEL COMPROBANTE (prefijo `cb` / `CB_`)  —  `Flujos/src/modulos/cobros/comun/lectura.js`
// =============================================================================
// MÓDULO COMÚN de Cobros para los flujos de venta. Es el PRIMER archivo de los tres (`lectura.js`, `cotejo.js`, `textos.js`) y debe incluirse antes que los otros: trae la BASE
// compartida (la red de frases prohibidas, `cbCanon`, `cbLinea`, `cbEsObjeto`, `cbMonto`…) y la lectura del comprobante.
// Cada declaración es COPIA BYTE A BYTE de `Flujos/experimental/venta-minima/src/lib/cobro.js` de la rama de #519 (`cartera/qtaco-visor-comprobantes`), que es el canon: la prueba
// `cobros-venta-comun.test.ts` la compara declaración por declaración. NO se edita aquí lo que viene de ahí; si cambia el canon, se decide en un PR aparte.
// Funciones puras: sin globales de Node, reloj ni red. Ningún flujo incluye todavía este archivo.
// NOTA: `CB_PROHIBIDAS` es la misma red que `core/avisos/avisos.js` (`AV_PROHIBIDAS`) y que el filtro común de salida; cada librería la lleva copiada a propósito (se prueba sola).
// =============================================================================

// La red de palabras de `comun.js` (`VM_PROHIBIDAS`), copiada acá a propósito: esta
// librería se prueba sola y no puede depender de otro archivo.
const CB_PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos\s+tu\s+pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S{0,40}\s+(tu|el|su|mi|un|este|ese|la|tus|sus|los)\s+(pago|transferencia|dep[oó]sito|abono)s?|lleg[oó]\s+(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)|(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+)?(lleg|ingres|entr)(o|ó|aron)\b|(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+|fue\s+|fueron\s+|est[aá]\s+)?(recibid|aprobad|[eé]xitos|realizad|registrad|llegad|ingresad|efectuad)|confirm(amos|ó|o)\s+(tu|tus|su|sus|la|el|lo|los|las)\b|\b(?:est[aá]n?|qued[oó]|queda|quedan|quedaron|fue|fueron|ya)\s+(?:ya\s+)?reservad|reserva\s+((est[aá]|qued[oó])\s+)?(registrad|agendad)|reservamos tu|\b(?:te|le|les|se|lo|la|ya)\s+confirm(?:o|amos|é|ó|aron)\b|gracias\s+por\s+(tu|su|el)\s+(pago|transferencia|dep[oó]sito|abono)s?|\b(lleg|ingres|entr)(o|ó|aron)\s+(tu|tus|el|los|su|sus|mi|la|las)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata|monto)|\b(tu|tus|el|los|su|sus|mi|la|las)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata|monto)s?\s+(ya\s+)?(lleg|ingres|entr)(o|ó|aron)\b|\brecib(imos|i|í|ido)\s+(el|la|tu|su)\s+(dinero|plata|monto)|(pago|transferencia|dep[oó]sito|abono|cobro)s?\s+(ya\s+|fue\s+|fueron\s+|est[aá]\s+|qued[oó]\s+|se\s+)?(ya\s+)?(recibid|aprobad|[eé]xitos|realizad|registrad|llegad|ingresad|efectuad|aceptad|completad|procesad|reflejad|comprobad)|\breflej(o|ó)\s+(tu|el|su)\s+(pago|transferencia|dep[oó]sito|abono)|\b(verificamos|comprobamos|validamos|aceptamos|tenemos|vimos|cobramos)\s+(tu|tus|su|sus|el|la)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata)|\bpago\s+(listo|ok)\b|\b(tu|su|el)\s+pago\s+(ya\s+)?(est[aá]|qued[oó])\s+(ya\s+)?(listo|ok|en\s+orden|bien|correcto|completo|hecho)\b|en\s+orden\s+con\s+(tu|su|el)\s+pago|\bsaldad[oa]s?\b|\b(pedido|cuenta|pago|total|orden|deuda)s?\s+((ya\s+)?(est[aá]n?|qued[oó]|fue|queda)\s+)?(ya\s+)?cancelad[oa]s?\b|\bya\s+nos\s+pag(aste|o|ó|aron)\b|\bgracias\s+por\s+pagar\b|\bya\s+pagaste\W{0,3}\s*(muchas\s+)?gracias|\brecib(imos|i|í|ido)\s+(bs\.?\s*|bob\s*)?\d+([.,]\d+)?\s*(bs|bob|bolivianos)\b|\bconfirm(amos|e|é)\s+que\s+(ya\s+)?pag|(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+)?se\s+reflej/i;

// El total que acepta el servidor para cotejar (`TOTAL_VENTA_MAXIMO`).
const CB_TOTAL_MAXIMO = 1000000;

// El rótulo del QR simulado en el pie (el otro va IMPRESO en la imagen): sin él, el simulado no sale (PROHIBICIÓN 3).
const CB_ROTULO_SIMULADO = 'PRUEBA · COBRO SIMULADO: este QR es de demostración, no cobra ni mueve dinero.';

// Confusables latino/cirílico/griego plegados a ASCII SOLO para comparar (S-1); las dos cadenas van en paralelo, letra por letra.
const CB_CONFUSABLES_DE = 'аеорсухіјѕԁһӏ' + 'αεικορτυχνηβı';

const CB_CONFUSABLES_A = 'aeopcyxijsdhl' + 'aeikoptuxvnbi';

// La forma en que se COMPARA contra `CB_PROHIBIDAS` (S-1): NFKC, sin controles C1 (\u0080-\u009f) ni caracteres de formato
// (`\p{Cf}`), NFD sin marcas (`\p{M}`), en minúsculas y con los confusables plegados a ASCII.
function cbCanon(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').replace(/[\u0080-\u009f]/g, '').replace(/\p{Cf}/gu, '').replace(/[\u115f\u1160\u3164\uffa0\u2800]/g, '')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[Ͱ-ϿЀ-ԯı]/g, (c) => {
      const i = CB_CONFUSABLES_DE.indexOf(c);
      return i < 0 ? c : CB_CONFUSABLES_A.charAt(i);
    });
}

// Una línea de texto: sin controles, sin `<>&`, espacios colapsados, recortada.
function cbLinea(t, max) {
  const s = String(t === undefined || t === null ? '' : t)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

function cbEsObjeto(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// El total de un pedido: SOLO un número del código. Un texto («63»), NaN, cero, un
// negativo o uno por encima del tope del servidor no son un total: devuelve null.
function cbTotalValido(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const r = Math.round(v * 100) / 100;
  return r > 0 && r <= CB_TOTAL_MAXIMO ? r : null;
}

// «55» o «12,50»: enteros sin decimales, y con coma decimal (así se lee en Bolivia).
function cbMonto(n) {
  const c = Math.round(Number(n) * 100);
  if (!Number.isFinite(c)) return '';
  const a = Math.abs(c);
  const cen = a % 100;
  return (c < 0 ? '-' : '') + Math.floor(a / 100) + (cen ? ',' + (cen < 10 ? '0' : '') + cen : '');
}

function cbMoneda(m) {
  const s = cbLinea(m, 8);
  return s === '' || /^(bob|bs)\.?$/i.test(s) ? 'Bs' : s;
}

// El código del pedido que se le muestra al cliente: letras y dígitos, sin más.
function cbCodigo(c) {
  const limpio = String(c === undefined || c === null ? '' : c).replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  // Un código que formara una palabra de la red de prohibidas no se muestra.
  return CB_PROHIBIDAS.test(cbCanon(limpio)) ? '' : limpio;
}

// La URL del QR: solo `https://`, con un dominio con nombre (la última parte empieza con una letra: nada de IP, de
// «localhost» ni de números sueltos), SIN usuario (`@`) ni puerto, sin espacios ni comillas. Hasta 2.000 caracteres.
// (La expresión es lineal: cada parte del dominio está acotada a 63 caracteres y separada por un punto.)
function cbUrlSegura(u) {
  const s = typeof u === 'string' ? u.trim() : '';
  return s.length > 0 && s.length <= 2000
    && /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[/?#][^\s<>"'@]*)?$/i.test(s);
}

// El texto de una respuesta de Gemini (generateContent, o el nodo de LangChain con
// `simplify`). '' si vino un error o algo que no se reconoce.
function cbTextoDeGemini(j) {
  if (!j || typeof j !== 'object' || j.error) return '';
  const partes = (c) => (c && Array.isArray(c.parts))
    ? c.parts.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n') : '';
  if (typeof j.content === 'string') return j.content;
  const c1 = partes(j.content);
  if (c1) return c1;
  const cand = Array.isArray(j.candidates) ? j.candidates[0] : null;
  const c2 = cand ? partes(cand.content) : '';
  if (c2) return c2;
  for (const k of ['text', 'output', 'response']) {
    if (typeof j[k] === 'string' && j[k].trim()) return j[k];
  }
  return '';
}

// El ÚNICO objeto `{…}` de nivel superior del texto, ya interpretado. Si hay dos o
// más (una frase del modelo con otro JSON, un texto de la imagen que se coló) o no
// se puede interpretar, null: es ilegible y se pide de nuevo. Mejor pedirlo otra
// vez que elegir cuál de dos objetos creerle.
function cbObjetoUnico(texto) {
  const t = String(texto === undefined || texto === null ? '' : texto).slice(0, 20000);
  const objetos = [];
  let prof = 0;
  let ini = -1;
  let enCadena = false;
  let escape = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (enCadena) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') enCadena = false;
      continue;
    }
    if (ch === '"' && prof > 0) { enCadena = true; continue; }
    if (ch === '{') {
      if (prof === 0) ini = i;
      prof++;
    } else if (ch === '}' && prof > 0) {
      prof--;
      if (prof === 0) objetos.push(t.slice(ini, i + 1));
    }
  }
  if (objetos.length !== 1) return null;
  try {
    const o = JSON.parse(objetos[0]);
    return cbEsObjeto(o) ? o : null;
  } catch (e) {
    return null;
  }
}

// Un campo leído: un número finito tal cual, o un texto corto sin controles. Solo
// claves PROPIAS del objeto, y cualquier otra cosa (objeto, lista, booleano) es ''.
function cbCampoLeido(o, k, max) {
  if (!Object.prototype.hasOwnProperty.call(o, k)) return '';
  const v = o[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// `respGemini` = el item que devolvió el nodo de Gemini (o el cuerpo de
// `generateContent`). Salen SEIS campos y `legible`; nada más. NO compara nada:
// compara el servidor, contra el total que se cotizó con el QR.
function cbLectura(respGemini) {
  const objeto = cbObjetoUnico(cbTextoDeGemini(respGemini)) || {};
  const leido = {
    monto: cbCampoLeido(objeto, 'monto', 40),
    cuentaDestino: cbCampoLeido(objeto, 'cuentaDestino', 60),
    nombreCuenta: cbCampoLeido(objeto, 'nombreCuenta', 120),
    fecha: cbCampoLeido(objeto, 'fecha', 40),
    hora: cbCampoLeido(objeto, 'hora', 20),
    banco: cbCampoLeido(objeto, 'banco', 80),
  };
  const legible = String(leido.monto) !== '' || String(leido.cuentaDestino) !== '';
  return { legible: legible, leido: leido };
}
