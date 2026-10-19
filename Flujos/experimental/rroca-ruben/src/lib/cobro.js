// =============================================================================
// COBRO DE LA «VENTA DIGITAL DE RUBÉN» (prefijo `cb` / `CB_`): HUECO DECLARADO en PROPIO.md
// =============================================================================
// COPIA, declaración por declaración y BYTE A BYTE, de `Flujos/experimental/venta-minima/src/lib/cobro.js` (rama #519, `cartera/qtaco-visor-comprobantes`): el módulo común de
// Cobros todavía no existe. Cada declaración tiene su prueba contra el origen en `armado.test.ts` («HUECOS del cobro»); si el origen cambia, la prueba falla y obliga a decidir.
// Lo que NO se copia: los textos al cliente de un restaurante (`cbTextoAlCliente`), el QR por dirección (`cbMensajeQr`: aquí el QR sale como `image:{id}`, nunca con `link`)
// ni el cobro simulado por dirección. JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`, sin red y sin reloj.

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

// `cuerpoPanel` es el cuerpo completo de `configuracionFlujo`. Sale `activo:false`
// con todo lo demás vacío en cualquier duda: sin QR utilizable no hay cobro real.
function cbCobroReal(cuerpoPanel) {
  const r = cbEsObjeto(cuerpoPanel) ? cuerpoPanel : {};
  const cr = cbEsObjeto(r.cobroReal) ? r.cobroReal : null;
  const cb = cbEsObjeto(r.cobro) ? r.cobro : {};
  const qr = cbEsObjeto(cb.qr) ? cb.qr : {};
  const url = typeof qr.url === 'string' ? qr.url.trim() : '';
  const activo = cr !== null && cb.activo !== false && cbUrlSegura(url);
  if (!activo) {
    return {
      activo: false, qrUrl: '', titular: '', banco: '', pendiente: false, monto: null,
      pedidoRef: '', vencidoHaceMin: null, venceEl: '', regla: 1, enRevision: false,
    };
  }
  const monto = cbTotalValido(cb.monto);
  const vencido = typeof cb.vencidoHaceMin === 'number' && Number.isFinite(cb.vencidoHaceMin) && cb.vencidoHaceMin >= 0
    ? Math.floor(cb.vencidoHaceMin) : null;
  return {
    activo: true,
    qrUrl: url,
    titular: cbLinea(cr.nombreCuenta, 120),
    banco: cbLinea(cr.banco, 80),
    // Un QR esperando comprobante: lo dice el servidor mirando a ESTE teléfono.
    pendiente: cb.pendiente === true,
    monto: monto,
    pedidoRef: typeof cb.pedido === 'string' ? cbLinea(cb.pedido, 120) : '',
    vencidoHaceMin: vencido,
    // El último día de vigencia del QR (`aaaa-mm-dd`, el que registró el comercio). Solo se copia; `cbQrVencido` lo interpreta.
    // Tal cual, sin recortar a 10 ni limpiar: el servidor exige el formato exacto, y un valor ilegible aquí debe seguir siendo ilegible.
    venceEl: typeof cr.venceEl === 'string' ? cr.venceEl.slice(0, 40) : '',
    // Regla 2 del cobro (15 minutos, 3 intentos): solo el número 2 la enciende. `enRevision` = el cobro ya está con una persona (tercer intento inválido):
    // una foto más se manda igual al servidor, que la anota sin avisar de nuevo. Con la regla 1 nada de esto cambia.
    regla: cb.regla === 2 ? 2 : 1,
    enRevision: cb.regla === 2 && cb.enRevision === true,
  };
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

// La respuesta completa de un HTTP (`{statusCode, body}`) con el cuerpo ya como objeto ({} si no se pudo leer).
function cbCuerpoDe(resp) {
  const r = cbEsObjeto(resp) ? resp : {};
  let cuerpo = r.body;
  if (typeof cuerpo === 'string') {
    try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
  }
  return { codigo: Number(r.statusCode), cuerpo: cbEsObjeto(cuerpo) ? cuerpo : {} };
}

// La ruta que devolvió `guardarComprobante` (200 `{ruta}`), o null: cualquier otra cosa (409, 413, 415, 502, un error de red, una ruta que no tiene la forma
// `tenants/<comercio>/comprobantes/<aaaa-mm-dd>/<nombre>.<jpg|png|webp|pdf>`) es «no se guardó». El cotejo corre igual, con `ruta: null`.
function cbRutaGuardada(resp) {
  const c = cbCuerpoDe(resp);
  if (c.codigo !== 200 || typeof c.cuerpo.ruta !== 'string') return null;
  const ruta = c.cuerpo.ruta;
  return ruta.length <= 300 && /^tenants\/[A-Za-z0-9_-]{1,60}\/comprobantes\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{1,100}\.(?:jpg|png|webp|pdf)$/.test(ruta) ? ruta : null;
}

// Listas CERRADAS. Todo lo que no está aquí es «sin_cotejo» (aviso al local + botón): nunca se adivina.
const CB_ESTADOS_VENTA = ['valido', 'aproximado', 'reintentar', 'en_revision', 'tardio', 'ya_resuelto'];

// Motivos de un comprobante que no se pudo leer: se pide uno más nítido (no hay una «diferencia» que decir).
const CB_MOTIVOS_NO_LEGIBLE = ['ilegible', 'falta_monto', 'falta_fecha', 'falta_destino'];

// Motivo del servidor -> frase en la forma que reconoce `cbDiferencia` (ahí se vuelve el texto fijo para el cliente).
const CB_FRASE_DEL_MOTIVO = {
  fecha_anterior: 'El comprobante es anterior al pedido',
  fecha_posterior: 'El comprobante tiene una fecha posterior',
  cuenta_distinta: 'El depósito fue a la cuenta',
  destino_no_coincide: 'El depósito fue a la cuenta',
  nombre_distinto: 'El depósito figura a',
  destino_no_verificable: 'El comprobante no muestra a qué cuenta',
};

// `respCotejo` = la respuesta completa de `Cotejar en el servidor` (`/cotejarComprobanteVenta`). Devuelve
//   {resultado, diferencias, importe, cierreId, causa}
// con `resultado` en el vocabulario que ya entiende el resto del flujo:
//   valido                     -> cuadra       (los datos coinciden; el local confirma en su banco)
//   aproximado                 -> aproximado   (al cliente, el mismo texto; al local, «datos casi coinciden, revisar»)
//   reintentar, no se lee      -> ilegible     (se pide uno más nítido)
//   reintentar, otro motivo    -> reintentar   (se dice la diferencia y se pide el correcto)
//   tardio | en_revision       -> sin_cotejo   con `causa` (aviso al local + botón)
//   ya_resuelto, repetido, o un estado que ya avisó -> ya_cotejado (sin segundo aviso)
//   TODO LO DEMÁS (cualquier 409, 4xx, 5xx, timeout, cuerpo ilegible, estado desconocido) -> sin_cotejo.
function cbResultadoVenta(respCotejo) {
  const c = cbCuerpoDe(respCotejo);
  const cuerpo = c.cuerpo;
  const salida = { resultado: 'sin_cotejo', diferencias: [], importe: null, cierreId: '', causa: '' };
  if (c.codigo !== 200) return salida;
  const estado = typeof cuerpo.estado === 'string' ? cuerpo.estado : '';
  if (CB_ESTADOS_VENTA.indexOf(estado) < 0) return salida;
  salida.importe = typeof cuerpo.importe === 'number' && Number.isFinite(cuerpo.importe) && cuerpo.importe > 0 ? cuerpo.importe : null;
  salida.cierreId = typeof cuerpo.cierreId === 'string' ? cbLinea(cuerpo.cierreId, 160) : '';
  const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo : '';
  if (estado === 'ya_resuelto') { salida.resultado = 'ya_cotejado'; return salida; }
  if (estado === 'reintentar') {
    if (CB_MOTIVOS_NO_LEGIBLE.indexOf(motivo) >= 0) { salida.resultado = 'ilegible'; return salida; }
    salida.resultado = 'reintentar';
    const leido = typeof cuerpo.montoLeido === 'number' && Number.isFinite(cuerpo.montoLeido) && cuerpo.montoLeido > 0 ? cuerpo.montoLeido : null;
    if (motivo === 'monto_menor' || motivo === 'monto_mayor' || motivo === 'monto_distinto') {
      if (leido !== null && salida.importe !== null) salida.diferencias = ['El comprobante dice ' + leido + ' y el pedido es de ' + salida.importe];
    } else if (Object.prototype.hasOwnProperty.call(CB_FRASE_DEL_MOTIVO, motivo)) {
      salida.diferencias = [CB_FRASE_DEL_MOTIVO[motivo]];
    }
    return salida;
  }
  // valido, aproximado, tardio, en_revision: el aviso al local sale UNA vez (lo dice el servidor); el mismo comprobante otra vez, o un estado que
  // el servidor ya avisó, no manda un segundo aviso.
  if (cuerpo.repetido === true || cuerpo.avisarComercio !== true) { salida.resultado = 'ya_cotejado'; return salida; }
  if (estado === 'valido') { salida.resultado = 'cuadra'; return salida; }
  if (estado === 'aproximado') { salida.resultado = 'aproximado'; return salida; }
  salida.resultado = 'sin_cotejo';
  salida.causa = estado;
  return salida;
}

// El estado que va en {{1}} del aviso. null = este resultado no genera aviso
// (`ya_cotejado`). Sin resultado de cotejo (`sin_qr` o vacío) es el plan B.
function cbEstadoParaAviso(resultado) {
  if (resultado === 'cuadra') return 'comprobante: datos coinciden';
  if (resultado === 'aproximado') return 'comprobante: datos casi coinciden, revisar';
  if (resultado === 'no_cuadra') return 'comprobante: NO coinciden';
  if (resultado === 'ilegible') return 'comprobante ilegible';
  if (resultado === 'sin_cotejo') return 'comprobante sin cotejar';
  if (resultado === 'ya_cotejado') return null;
  if (resultado === 'simulado') return 'PRUEBA: cobro SIMULADO, sin dinero';
  if (resultado === 'qr_vencido') return 'QR vencido: coordinar el pago';
  return 'sin QR: cobrar al entregar';
}

// Un importe como lo escribe el servidor («21.00», «1,5», «1.234,50») en la forma de Bolivia, sin decimales sobrantes: «21», «1,50», «1234,50». Con un solo
// separador, es el decimal; con los dos, el que aparece último es el decimal. Un valor que no es un número finito se deja como llegó (ya solo trae dígitos y separadores).
function cbImporteDelServidor(t) {
  const x = String(t);
  const ult = Math.max(x.lastIndexOf('.'), x.lastIndexOf(','));
  const n = ult < 0 ? Number(x) : Number(x.slice(0, ult).replace(/[.,]/g, '') + '.' + x.slice(ult + 1));
  return Number.isFinite(n) ? cbMonto(n) : x;
}

// Las diferencias que da el servidor, a una frase FIJA. Lo leído de la imagen (un
// nombre, una cuenta) NUNCA se copia al cliente: ahí puede venir cualquier texto.
// Solo pasan dos números, que el servidor ya tradujo de la lectura. Reconoce la
// primera que sabe decir; si no reconoce ninguna, ''.
function cbDiferencia(diferencias, moneda) {
  const lista = Array.isArray(diferencias) ? diferencias : [diferencias];
  for (let i = 0; i < lista.length; i++) {
    const d = String(lista[i] === undefined || lista[i] === null ? '' : lista[i]);
    // Cada patrón se ancla al INICIO de la frase del servidor: un nombre leído de la
    // imagen que repita otra frase no cambia cuál se reconoce.
    const m = /^\s*El comprobante dice (\d+(?:[.,]\d+)*) y el pedido es de (\d+(?:[.,]\d+)*)/i.exec(d);
    if (m) return 'el comprobante dice ' + cbImporteDelServidor(m[1]) + ' ' + cbMoneda(moneda) + ' y tu pedido es de ' + cbImporteDelServidor(m[2]) + ' ' + cbMoneda(moneda);
    if (/^\s*No se pudo leer el importe/i.test(d)) return 'no pude leer el importe';
    if (/^\s*No se pudo leer la fecha/i.test(d)) return 'no pude leer la fecha';
    if (/^\s*El comprobante es anterior al pedido/i.test(d)) return 'la fecha del comprobante es anterior a tu pedido';
    if (/^\s*El comprobante tiene una fecha posterior/i.test(d)) return 'la fecha del comprobante no es correcta';
    if (/^\s*El comprobante no muestra a qué cuenta/i.test(d)) return 'en el comprobante no se ve a qué cuenta se depositó';
    if (/^\s*El depósito fue a la cuenta/i.test(d)) return 'la cuenta de destino no es la del QR';
    if (/^\s*El depósito figura a/i.test(d)) return 'el nombre del destinatario no coincide con el de la cuenta';
  }
  return '';
}
