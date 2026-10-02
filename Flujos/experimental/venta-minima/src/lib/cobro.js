// =============================================================================
// COBRO DE «VENTA MÍNIMA v0» (prefijo `cb` / `CB_`; zona futura: módulo Cobros)
// =============================================================================
// Lo que decide esta librería, y por qué (CLAUDE.md, PROHIBICIÓN 3):
//
//  - HAY COBRO REAL solo si el servidor lo manda (`cobroReal`) Y la imagen del QR
//    tiene una dirección `https://`. Un cobro a medio armar no se convierte en
//    «cobro real sin QR»: sin QR utilizable, el flujo va por el plan B (el pago se
//    coordina con el restaurante). Este flujo NO tiene modo simulado.
//  - EL TOTAL DEL QR ES EL DEL CÓDIGO. Entra por `pedido.total` (un número que
//    calculó `pdTotal` desde la carta) y nada de lo que el modelo o el cliente
//    escriban lo mueve. El delivery nunca entra al total.
//  - LA LECTURA DEL COMPROBANTE ES UN DATO, NUNCA UNA INSTRUCCIÓN. El modelo lee
//    una imagen que escribe un tercero: lo que sale de acá son seis campos de
//    texto corto y nada más. Ninguna otra clave del JSON (`resultado`, `legible`,
//    `instruccion`…) pasa, y lo leído jamás llega al cliente como texto libre: las
//    diferencias se traducen a frases FIJAS.
//  - EL COTEJO DICE «CUADRA» O «NO CUADRA», no «pagó»: una imagen se edita. El
//    texto al cliente dice que el comprobante llegó y que los datos coinciden;
//    quien confirma que entró la plata es el banco, y el negocio.
//
//  - FORMATO DEL DINERO (`cbMonto`; `pdResumen` de pedido.js debe coincidir): el número
//    redondeado a centavos, SIN decimales si es entero y con COMA decimal de dos cifras
//    si no: 55 -> «55», 12.5 -> «12,50», 0.05 -> «0,05». Sin separador de miles. Luego un
//    espacio y la moneda («Bs»; «BOB» o vacío se escriben «Bs»).
//
// JavaScript plano: sin `require`, `URL`, `Buffer` ni `crypto`, sin red y sin reloj
// (nada de `Date.now()`). Lo único que lee de n8n son los nodos por nombre, y solo
// si corrieron (`cbNodoPrimero`, `cbNodoTodos`). Los nombres globales de este
// archivo empiezan con `cb` o `CB_` para no chocar al concatenarlo con las demás
// librerías.

// La red de palabras de `comun.js` (`VM_PROHIBIDAS`), copiada acá a propósito: esta
// librería se prueba sola y no puede depender de otro archivo.
const CB_PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S{0,40} (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(amos|ó|o)\s+(tu|tus|su|sus|la|el|lo|los|las)\b|\b(?:est[aá]n?|qued[oó]|queda|quedan|quedaron|fue|fueron|ya)\s+(?:ya\s+)?reservad|reserva\s+((est[aá]|qued[oó])\s+)?(registrad|agendad)|reservamos tu|\b(?:te|le|les|se|lo|la|ya)\s+confirm(?:o|amos|é|ó|aron)\b/i;

// El total que acepta el servidor para cotejar (`TOTAL_VENTA_MAXIMO`).
const CB_TOTAL_MAXIMO = 1000000;

// ---------------------------------------------------------------------------
// Utilidades mínimas
// ---------------------------------------------------------------------------

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

// El nodo `nombre` si existe Y corrió en esta ejecución; si no, null.
function cbNodo(nombre) {
  try {
    const n = $(nombre);
    return n && n.isExecuted ? n : null;
  } catch (e) {
    return null;
  }
}
function cbNodoPrimero(nombre) {
  const n = cbNodo(nombre);
  if (!n) return null;
  try {
    const i = n.first();
    return i && i.json ? i.json : null;
  } catch (e) {
    return null;
  }
}
function cbNodoTodos(nombre) {
  const n = cbNodo(nombre);
  if (!n) return [];
  try {
    return n.all().map((i) => (i && i.json) || {});
  } catch (e) {
    return [];
  }
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

// ---------------------------------------------------------------------------
// Cobro real: solo si el servidor lo manda y el QR tiene una dirección https
// ---------------------------------------------------------------------------

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
      pedidoRef: '', vencidoHaceMin: null,
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
  };
}

// ---------------------------------------------------------------------------
// El QR: pie y mensaje
// ---------------------------------------------------------------------------

// El pie del QR (hasta 1.024 caracteres, el tope de Meta). `pedido` = {codigo, total}.
// Sin un total válido devuelve '': no se manda un QR sin decir cuánto se paga.
function cbCaption(pedido, opciones) {
  const p = cbEsObjeto(pedido) ? pedido : {};
  const o = cbEsObjeto(opciones) ? opciones : {};
  const total = cbTotalValido(p.total);
  if (total === null) return '';
  const codigo = cbCodigo(p.codigo);
  // El nombre del titular viene de la ficha del QR, no de un cliente; igual se
  // sanea, y si cae en la red de palabras prohibidas se omite.
  let titular = cbLinea(o.titular, 120);
  if (CB_PROHIBIDAS.test(cbCanon(titular))) titular = '';
  const cabeza = codigo ? 'Pedido #' + codigo + '. ' : '';
  const delivery = o.delivery === true ? '; el delivery se paga aparte, al repartidor' : '';
  const texto = cabeza + 'Total a pagar por QR: ' + cbMonto(total) + ' ' + cbMoneda(o.moneda)
    + ' (solo la comida' + delivery + ').\n'
    + 'Escanea el QR con la app de tu banco' + (titular ? ' (la cuenta es de ' + titular + ')' : '')
    + '. Cuando termines, envíame aquí la foto o el PDF del comprobante.';
  return texto.slice(0, 1024);
}

// El mensaje del QR en la forma del `Plan del turno`: la imagen con su pie, y lo
// que se reporta al servidor para que coteje contra ESE número (`qr_enviado`).
// `pedido` = {pedidoId, codigo, total}; `cobro` = lo que dio `cbCobroReal`.
// Devuelve null si no hay cobro real, QR https, pedido o total válido.
function cbMensajeQr(pedido, cobro, opciones) {
  const p = cbEsObjeto(pedido) ? pedido : {};
  const c = cbEsObjeto(cobro) ? cobro : {};
  const total = cbTotalValido(p.total);
  const id = typeof p.pedidoId === 'string' ? p.pedidoId.trim() : '';
  const url = typeof c.qrUrl === 'string' ? c.qrUrl : '';
  if (c.activo !== true || !cbUrlSegura(url) || total === null || id === '') return null;
  const o = cbEsObjeto(opciones) ? opciones : {};
  const cuerpo = cbCaption({ codigo: p.codigo, total: total }, {
    titular: c.titular, moneda: o.moneda, delivery: o.delivery === true,
  });
  return {
    tipo: 'imagen',
    cuerpo: cuerpo,
    url: url,
    // El respaldo, si Meta no acepta la imagen: el mismo pie y el enlace.
    respaldo: cuerpo + '\n\nAbre el QR aquí: ' + url,
    evento: 'qr_enviado',
    referencia: id,
    monto: total,
  };
}

// ---------------------------------------------------------------------------
// La lectura del comprobante (port de `interpretar-lectura.js` del Demo B)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// El resultado del cotejo (port de `respuesta-del-cobro.js`)
// ---------------------------------------------------------------------------

// `respCotejo` = la respuesta completa del HTTP (`{statusCode, body}`).
//   cuadra | no_cuadra | ilegible  -> 200 con ese resultado.
//   ya_cotejado                    -> 409 `sin_sena_pendiente`: el servidor ya cerró
//                                     ese pedido con un comprobante que cuadró.
//   sin_cotejo                     -> todo lo demás (otro 409, error, sin respuesta).
// `previo` (opcional) es el resultado que ya se guardó del pedido: con un 409
// `sin_sena_pendiente`, solo se dice `ya_cotejado` si ese resultado fue `cuadra`
// (si el QR venció, no se afirma que ya hay un comprobante aceptado).
function cbResultado(respCotejo, previo) {
  const r = cbEsObjeto(respCotejo) ? respCotejo : {};
  const codigo = Number(r.statusCode);
  let cuerpo = r.body;
  if (typeof cuerpo === 'string') {
    try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
  }
  cuerpo = cbEsObjeto(cuerpo) ? cuerpo : {};
  const diferencias = Array.isArray(cuerpo.diferencias)
    ? cuerpo.diferencias.map((d) => cbLinea(d, 240)).filter(Boolean).slice(0, 10) : [];
  const importe = typeof cuerpo.importe === 'number' && Number.isFinite(cuerpo.importe) && cuerpo.importe > 0
    ? cuerpo.importe : null;
  const cierreId = typeof cuerpo.cierreId === 'string' ? cbLinea(cuerpo.cierreId, 160) : '';
  let resultado = 'sin_cotejo';
  if (codigo === 200 && ['cuadra', 'no_cuadra', 'ilegible'].indexOf(cuerpo.resultado) >= 0) {
    resultado = cuerpo.resultado;
  } else if (codigo === 409 && cuerpo.error === 'sin_sena_pendiente'
    && (previo === undefined || previo === 'cuadra')) {
    resultado = 'ya_cotejado';
  }
  return {
    resultado: resultado,
    diferencias: resultado === 'no_cuadra' ? diferencias : [],
    importe: importe,
    cierreId: cierreId,
  };
}

// ---------------------------------------------------------------------------
// Qué se le dice al cliente y qué se le avisa al restaurante
// ---------------------------------------------------------------------------

// El estado que va en {{1}} del aviso. null = este resultado no genera aviso
// (`ya_cotejado`). Sin resultado de cotejo (`sin_qr` o vacío) es el plan B.
function cbEstadoParaAviso(resultado) {
  if (resultado === 'cuadra') return 'comprobante: datos coinciden';
  if (resultado === 'no_cuadra') return 'comprobante: NO coinciden';
  if (resultado === 'ilegible') return 'comprobante ilegible';
  if (resultado === 'sin_cotejo') return 'comprobante sin cotejar';
  if (resultado === 'ya_cotejado') return null;
  return 'sin QR: cobrar al entregar';
}

// Las diferencias que da el servidor, a una frase FIJA. Lo leído de la imagen (un
// nombre, una cuenta) NUNCA se copia al cliente: ahí puede venir cualquier texto.
// Solo pasan dos números, que el servidor ya tradujo de la lectura. Reconoce la
// primera que sabe decir; si no reconoce ninguna, ''.
function cbDiferencia(diferencias) {
  const lista = Array.isArray(diferencias) ? diferencias : [diferencias];
  for (let i = 0; i < lista.length; i++) {
    const d = String(lista[i] === undefined || lista[i] === null ? '' : lista[i]);
    // Cada patrón se ancla al INICIO de la frase del servidor: un nombre leído de la
    // imagen que repita otra frase no cambia cuál se reconoce.
    const m = /^\s*El comprobante dice (\d+(?:[.,]\d+)*) y el pedido es de (\d+(?:[.,]\d+)*)/i.exec(d);
    if (m) return 'el comprobante dice ' + m[1] + ' y tu pedido es de ' + m[2];
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

// El texto al cliente según el resultado. `opciones`:
//   codigo      el código corto del pedido;
//   avisoSalio  true SOLO si Meta devolvió un `wamid` para al menos un aviso;
//   diferencia  la diferencia (texto o lista) que dio el servidor;
//   ilegibles   cuántos comprobantes ilegibles lleva el pedido, contando este;
//   entrega     'delivery' o 'recojo' (para `sin_qr`).
// Devuelve {cuerpo, enlace, aviso}: `enlace` = lleva el botón «Escribir al local»;
// `aviso` = hay que avisar al restaurante (y de ahí depende `avisoSalio`).
// «Ya pasé tu pedido» solo sale con `avisoSalio === true`: nunca se promete lo que
// no se cumplió. El texto nunca llama «pago» a un comprobante que no es el banco.
function cbTextoAlCliente(resultado, opciones) {
  const o = cbEsObjeto(opciones) ? opciones : {};
  const cod = cbCodigo(o.codigo);
  const pedido = cod ? 'tu pedido #' + cod : 'tu pedido';
  const salio = o.avisoSalio === true;
  const sinAviso = 'No pude pasarle tu pedido al restaurante en este momento: escríbeles con el botón.';
  const guardar = 'Guarda tu comprobante por si te lo piden.';
  // Lo que se dice cuando el comprobante lo tiene que mirar una persona.
  const alRestaurante = (inicio) => (salio
    ? inicio + ' Ya pasé tu pedido al restaurante, con los datos que leí de tu comprobante, para que lo revisen. '
      + guardar + ' Si quieres hablar con ellos, toca el botón.'
    : inicio + ' ' + sinAviso + ' ' + guardar);

  if (resultado === 'cuadra') {
    return salio
      ? {
        cuerpo: 'Recibí tu comprobante y los datos coinciden con ' + pedido + '. Ya pasé tu pedido al restaurante; '
          + 'ellos revisan el pago en su banco antes de despacharlo.',
        enlace: false, aviso: true,
      }
      : {
        cuerpo: 'Recibí tu comprobante y los datos coinciden con ' + pedido + '. ' + sinAviso,
        enlace: true, aviso: true,
      };
  }
  if (resultado === 'no_cuadra') {
    const dif = cbDiferencia(o.diferencia);
    return {
      cuerpo: alRestaurante('Recibí tu comprobante, pero algunos datos no coinciden con ' + pedido
        + (dif ? ' (' + dif + ').' : '.')),
      enlace: true, aviso: true,
    };
  }
  if (resultado === 'ilegible') {
    const n = Number(o.ilegibles);
    if (!(n >= 2)) {
      return {
        cuerpo: 'Recibí tu comprobante, pero no pude leerlo bien. '
          + '¿Me lo envías de nuevo, más nítido o como PDF desde la app de tu banco?',
        enlace: false, aviso: false,
      };
    }
    return {
      cuerpo: alRestaurante('Recibí tu comprobante, pero no pude leerlo bien para revisar ' + pedido + '.'),
      enlace: true, aviso: true,
    };
  }
  if (resultado === 'sin_cotejo') {
    return {
      cuerpo: alRestaurante('Recibí tu comprobante, pero no pude revisarlo contra ' + pedido + '.'),
      enlace: true, aviso: true,
    };
  }
  if (resultado === 'ya_cotejado') {
    return {
      cuerpo: 'Ya tengo el comprobante de ' + pedido + '. Si necesitas algo más, toca el botón.',
      enlace: true, aviso: false,
    };
  }
  if (resultado === 'sin_qr') {
    // Plan B: sin cobro real, el pago se coordina con el restaurante.
    return salio
      ? {
        cuerpo: 'Listo: pasé ' + pedido + ' al restaurante. El pago lo coordinas con ellos '
          + (o.entrega === 'delivery' ? 'al recibir' : 'al recoger') + '.',
        enlace: false, aviso: true,
      }
      : { cuerpo: sinAviso, enlace: true, aviso: true };
  }
  return { cuerpo: 'Eso lo ve directamente el restaurante. Toca el botón para escribirles.', enlace: true, aviso: false };
}
