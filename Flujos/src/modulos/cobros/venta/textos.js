// =============================================================================
// COBROS · VENTA · TEXTOS AL CLIENTE (prefijo `cb` / `CB_`)  —  `Flujos/src/modulos/cobros/venta/textos.js`
// =============================================================================
// Tercer archivo del módulo (después de `lectura.js` y `cotejo.js`, de los que usa `CB_PROHIBIDAS`, `cbCanon`, `cbLinea`, `cbEsObjeto`, `cbMonto`, `cbMoneda`, `cbCodigo`, `cbTotalValido`,
// `CB_ROTULO_SIMULADO` y `cbDiferencia`). TODO es nuevo: unifica el árbol de textos de comprobante de Rubén (`rrTextoComprobante`) y de Antonio (`raTextoComprobante`) con el nombre de quien
// atiende COMO PARÁMETRO. El módulo escribe todo el texto de dinero: NUNCA sale del modelo.
//
// PROHIBICIONES DE CLAUDE.md, ESTRUCTURALES (las prueba `cobros-venta-comun.test.ts` sobre la matriz completa):
//   3. Ningún cuerpo dice que un pago está acreditado, verificado o recibido («pago acreditado/verificado», «recibimos tu pago», «ya entró»): el comprobante llegó; quien confirma que entró
//      la plata es el banco, y el negocio. El resultado `aproximado` NUNCA dice «coinciden» (no es `cuadra`). El cobro simulado SIEMPRE lleva «SIMULADO» y el real nunca.
//   «Solo se ofrece lo que se cumple»: con `salio !== true` nunca «ya lo pasé» ni «le avisé».
// Toda salida pasa por `CB_PROHIBIDAS` (con `cbCanon`): lo que cae, se rearma con «nuestro equipo» y, si aún cae, sale un texto mínimo.
//
// ÚNICA EXENCIÓN: `CB_TEXTO_COMPROBANTE_LEIDO` (decidida por Andres el 20/10/2026), por COINCIDENCIA EXACTA y como constante de este archivo: nunca se lee de datos editables ni la parametriza
// el comercio. Dice «confirmamos» y «validado» en FUTURO (lo que el negocio hará al mirar su banco). La devuelve `cbTextoComprobante` con `fijo: true`, solo con `cuadra` + aviso salido + trato «tú».
//
// `tratamiento`: 'tu' o 'usted'; cualquier otro valor (vos, vacío, basura) es 'tu': sin voseo. El texto 'usted' conjuga LITERALMENTE las mismas frases de 'tu' y está PENDIENTE de aprobación de
// Andres y de Silvana (como en `core/texto/no-repetir.js`); la excepción: la constante exenta no tiene versión 'usted' (no se exime nada que Andres no haya aprobado), así que `cuadra` con 'usted'
// sale con otra frase, sin la palabra «confirmamos». `quien` = nombre de quien atiende (`voz.quienAtiende`); vacío o raro => «nuestro equipo».
// Funciones puras: sin globales de Node, reloj ni red.
// =============================================================================

// La ÚNICA constante exenta de `CB_PROHIBIDAS`. Copia exacta de `RR_TEXTO_COMPROBANTE_LEIDO` (rr.js); una prueba compara los dos.
const CB_TEXTO_COMPROBANTE_LEIDO = '¡Gracias! 🙌 Ya recibí tu comprobante, dame un momento mientras confirmamos tu pago. En cuanto esté validado, te mando tus enlaces de descarga aquí mismo.';

// Las frases fijas que `cbDiferencia` devuelve sin monto: son las únicas (junto con la del monto) que se aceptan ya armadas.
const CB_DIFERENCIAS_FIJAS = [
  'no pude leer el importe',
  'no pude leer la fecha',
  'la fecha del comprobante es anterior a tu pedido',
  'la fecha del comprobante no es correcta',
  'en el comprobante no se ve a qué cuenta se depositó',
  'la cuenta de destino no es la del QR',
  'el nombre del destinatario no coincide con el de la cuenta',
];
Object.freeze(CB_DIFERENCIAS_FIJAS);

// 'usted' solo si dice exactamente 'usted'; todo lo demás (vos, 'tú', vacío, un objeto) es 'tu'.
function cbTratamiento(t) {
  return t === 'usted' ? 'usted' : 'tu';
}

// El nombre de quien atiende: una línea corta y limpia. Vacío, con enlaces, números largos, frases de dinero o la palabra «simulado»/«prueba» => «nuestro equipo».
function cbQuien(q) {
  const s = cbLinea(String(q === undefined || q === null ? '' : q).replace(/\p{Cf}/gu, ''), 60);
  if (s === '') return 'nuestro equipo';
  const c = cbCanon(s);
  if (/https?:|www\.|@|\d{4,}|[|*_~`\\[\]{}]/.test(s)) return 'nuestro equipo';
  if (CB_PROHIBIDAS.test(c) || /simulad|prueba|acredit|verific|ya\s+entr|pagad|\bpago\b|\bpagu|recib|\bqr\b/.test(c)) return 'nuestro equipo';
  return s;
}

// ¿Este texto es EXACTAMENTE la constante exenta (con los espacios colapsados)? Por coincidencia exacta, nunca por patrón.
function cbEsTextoFijoExento(texto) {
  return String(texto === undefined || texto === null ? '' : texto).replace(/\s+/g, ' ').trim() === CB_TEXTO_COMPROBANTE_LEIDO;
}

// ¿Este texto cae en la red de frases prohibidas?
function cbTextoProhibido(texto) {
  return CB_PROHIBIDAS.test(cbCanon(texto));
}

// La diferencia que se le dice al cliente: la frase fija que arma `cbDiferencia` desde lo que dice el servidor, o una YA armada con esa misma forma. Lo leído de la imagen nunca pasa.
function cbDiferenciaPara(diferencia, moneda) {
  const armada = cbDiferencia(diferencia, moneda);
  if (armada !== '') return armada;
  if (typeof diferencia !== 'string') return '';
  const t = diferencia.trim();
  if (CB_DIFERENCIAS_FIJAS.indexOf(t) >= 0) return t;
  return /^el comprobante dice \d+(?:,\d+)? [A-Za-z$.]{1,5} y tu pedido es de \d+(?:,\d+)? [A-Za-z$.]{1,5}$/.test(t) ? t : '';
}

// El MOTIVO exacto de un aviso por un comprobante que no cuadra, para que el negocio sepa qué mirar. `estado` = tardio | en_revision | aproximado | '' (sin cotejar); `motivoSrv` = el
// motivo del cotejo (lista cerrada; lo desconocido no se copia). Nunca copia texto leído del comprobante.
function cbMotivoAviso(estado, motivoSrv) {
  const m = typeof motivoSrv === 'string' ? motivoSrv : '';
  const detalle = m === 'monto_menor' ? 'el monto es menor al del pedido' : (m === 'monto_mayor' ? 'el monto es mayor al del pedido' : (m === 'monto_distinto' ? 'el monto no coincide con el del pedido'
    : (['ilegible', 'falta_monto', 'falta_fecha', 'falta_destino'].indexOf(m) >= 0 ? 'no se pudo leer el comprobante'
      : (m === 'cuenta_distinta' || m === 'destino_no_coincide' ? 'la cuenta de destino no coincide' : (m === 'nombre_distinto' ? 'el nombre del destinatario no coincide'
        : (m === 'fecha_anterior' || m === 'fecha_posterior' ? 'la fecha no corresponde al pedido' : ''))))));
  if (estado === 'tardio') return 'comprobante tardío: llegó después de los 15 minutos del QR';
  if (estado === 'en_revision') return 'comprobante en revisión: tercer intento sin cuadrar' + (detalle ? ' (' + detalle + ')' : '');
  if (estado === 'aproximado') return 'comprobante con datos que casi coinciden: ' + (detalle || 'revisar el detalle en la consola');
  return 'comprobante sin cotejar: el cotejo no respondió o el archivo no se pudo leer';
}

// El árbol de textos. `u` = trato de usted; `q` = quien atiende (ya saneado); `salio` = true | false | 'repetido'; `dif` = la diferencia ya armada ('' si no hay).
function cbArmarComprobante(resultado, causa, salio, dif, q, u, simulado) {
  const s = (tu, usted) => (u ? usted : tu);
  const sinAviso = 'Recibí ' + s('tu', 'su') + ' comprobante pero no pude avisarle a ' + q + '. ' + s('Escríbele', 'Escríbale') + ' directo con el botón.';
  if (simulado) {
    return { cuerpo: 'Recibí ' + s('tu', 'su') + ' comprobante SIMULADO. Es una prueba: no se movió dinero ni se envía ningún material.', boton: false };
  }
  if (resultado === 'aproximado') {
    // Los datos NO coinciden del todo: no se dice que coinciden. Se dice lo que se sabe (el motivo, si es el monto) y que lo revisa quien atiende.
    const detalle = causa === 'monto_distinto' ? 'el monto del comprobante no coincide del todo con ' + s('tu', 'su') + ' pedido' : 'hay un dato del comprobante que ' + q + ' tiene que mirar con cuidado';
    return salio === true
      ? { cuerpo: 'Recibí ' + s('tu', 'su') + ' comprobante, pero ' + detalle + '. Ya pasé ' + s('tu', 'su') + ' comprobante a ' + q + ' para que lo revise; ' + s('si quieres escribirle, toca', 'si quiere escribirle, toque') + ' el botón.', boton: true }
      : { cuerpo: sinAviso, boton: true };
  }
  if (resultado === 'cuadra') {
    if (salio !== true) return { cuerpo: sinAviso, boton: true };
    // El texto fijo exento solo existe en trato «tú»; en «usted» sale una frase sin «confirmamos» ni «validado».
    return u
      ? { cuerpo: 'Recibí su comprobante y ya se lo pasé a ' + q + ' para que lo revise; si quiere escribirle, toque el botón.', boton: true }
      : { cuerpo: CB_TEXTO_COMPROBANTE_LEIDO, boton: false, fijo: true };
  }
  if (resultado === 'reintentar') {
    return { cuerpo: 'Recibí ' + s('tu', 'su') + ' comprobante, pero veo una diferencia con ' + s('tu', 'su') + ' compra' + (dif ? ': ' + dif : '') + '. ' + s('Si te equivocaste, envíame', 'Si se equivocó, envíeme')
      + ' de nuevo el comprobante correcto (en foto o en PDF desde la app de ' + s('tu', 'su') + ' banco). ' + s('Si prefieres, escríbele', 'Si prefiere, escríbale') + ' a ' + q + ' con el botón.', boton: true };
  }
  if (resultado === 'ilegible') {
    return { cuerpo: 'Recibí ' + s('tu', 'su') + ' archivo, pero no pude leer bien el comprobante. ' + s('¿Me lo envías', '¿Me lo envía') + ' de nuevo, más nítido o en PDF desde la app de ' + s('tu', 'su') + ' banco?', boton: false };
  }
  if (resultado === 'ya_cotejado') {
    return { cuerpo: 'Ya tengo el comprobante de este pedido. ' + s('Si necesitas algo más, escríbele', 'Si necesita algo más, escríbale') + ' a ' + q + ' con el botón.', boton: true };
  }
  // sin_cotejo y cualquier otra cosa: pasa a quien atiende con aviso y botón.
  if (causa === 'tardio') {
    return salio === true
      ? { cuerpo: s('Tu', 'Su') + ' comprobante llegó después de los 15 minutos del QR. Ya lo pasé a ' + q + ' para que lo revise directamente; ' + s('si quieres escribirle, toca', 'si quiere escribirle, toque') + ' el botón.', boton: true }
      : { cuerpo: s('Tu', 'Su') + ' comprobante llegó después de los 15 minutos del QR, y no pude avisarle a ' + q + '. ' + s('Escríbele', 'Escríbale') + ' directo con el botón.', boton: true };
  }
  if (causa === 'en_revision') {
    return salio === true
      ? { cuerpo: 'Como ya van varios intentos, pasé ' + s('tu', 'su') + ' comprobante a ' + q + ' para que lo revise directamente. ' + s('Si quieres escribirle, toca', 'Si quiere escribirle, toque') + ' el botón.', boton: true }
      : { cuerpo: 'Como ya van varios intentos, ' + s('tu', 'su') + ' comprobante necesita que lo vea ' + q + ', pero no pude avisarle. ' + s('Escríbele', 'Escríbale') + ' directo con el botón.', boton: true };
  }
  if (salio === 'repetido') {
    return { cuerpo: 'Recibí ' + s('tu', 'su') + ' comprobante, pero no pude cotejarlo. ' + q + ' ya recibió el aviso de un comprobante anterior; ' + s('si quieres, escríbele', 'si quiere, escríbale') + ' directo con el botón.', boton: true };
  }
  return salio === true
    ? { cuerpo: 'Recibí ' + s('tu', 'su') + ' comprobante, pero no pude cotejarlo. Ya lo pasé a ' + q + ' para que lo revise; ' + s('si quieres escribirle, toca', 'si quiere escribirle, toque') + ' el botón.', boton: true }
    : { cuerpo: 'Recibí ' + s('tu', 'su') + ' comprobante, pero no pude cotejarlo ni avisarle a ' + q + '. ' + s('Escríbele', 'Escríbale') + ' directo con el botón.', boton: true };
}

// El texto al cliente según el cotejo. `resultado`: cuadra | aproximado | reintentar | ilegible | sin_cotejo | ya_cotejado | simulado (el vocabulario de `cbResultadoVenta`; cualquier otro => sin_cotejo).
// `opciones`: { causa, salio, diferencia, moneda, codigo, resumen, quien, tratamiento, simulado }.
//   causa       con `sin_cotejo`: 'tardio' | 'en_revision'; con `aproximado`: el motivo del servidor ('monto_distinto'…).
//   salio       true SOLO si el aviso al negocio devolvió un `wamid` real; 'repetido' = el aviso se suprimió por el límite; cualquier otra cosa = no salió.
//   diferencia  lo que dio el servidor (`cbDiferencia` lo vuelve frase fija) o una frase ya armada con esa forma; lo demás se ignora.
//   codigo, resumen, moneda: reservados para el pie del pedido; NO cambian el texto del comprobante (la adopción por Rubén y Antonio no cambia nada de lo que ven hoy). `moneda` sí entra en la diferencia.
// Devuelve { cuerpo, boton, aviso, fijo? }: `boton` = lleva el botón para escribir al negocio; `aviso` = el motivo para el aviso al negocio ('' si este resultado no lo genera); `fijo` = es la constante exenta.
function cbTextoComprobante(resultado, opciones) {
  const o = cbEsObjeto(opciones) ? opciones : {};
  const r = typeof resultado === 'string' ? resultado : '';
  const u = cbTratamiento(o.tratamiento) === 'usted';
  const salio = o.salio === true ? true : (o.salio === 'repetido' ? 'repetido' : false);
  const causa = typeof o.causa === 'string' ? o.causa : '';
  const simulado = o.simulado === true || r === 'simulado';
  const dif = r === 'reintentar' ? cbDiferenciaPara(o.diferencia, o.moneda).replace(/\btu\b/g, u ? 'su' : 'tu') : '';
  let q = cbQuien(o.quien);
  let t = cbArmarComprobante(r, causa, salio, dif, q, u, simulado);
  if (t.fijo !== true && cbTextoProhibido(t.cuerpo)) {
    q = 'nuestro equipo';
    t = cbArmarComprobante(r, causa, salio, dif, q, u, simulado);
    if (cbTextoProhibido(t.cuerpo)) t = { cuerpo: 'Recibí ' + (u ? 'su' : 'tu') + ' archivo. ' + (u ? 'Escríbale' : 'Escríbele') + ' directo a nuestro equipo con el botón.', boton: true };
  }
  let aviso = '';
  if (!simulado) {
    if (r === 'aproximado') aviso = cbMotivoAviso('aproximado', causa);
    else if (['cuadra', 'reintentar', 'ilegible', 'ya_cotejado'].indexOf(r) < 0) aviso = cbMotivoAviso(causa === 'tardio' || causa === 'en_revision' ? causa : '', causa);
  }
  const salida = { cuerpo: t.cuerpo, boton: t.boton === true, aviso: aviso };
  if (t.fijo === true) salida.fijo = true;
  return salida;
}

// El monto como se le dice al cliente («55 Bs», «12,50 Bs»), o '' si no es un monto válido.
function cbMontoConMoneda(monto, moneda) {
  const m = cbTotalValido(typeof monto === 'number' ? monto : Number(monto));
  return m === null ? '' : cbMonto(m) + ' ' + cbMoneda(moneda);
}

// Un nombre de producto para el pie: una línea limpia, sin frases de dinero y, en el cobro REAL, sin «simulado» ni «prueba».
function cbNombreDeProducto(texto, real) {
  const s = cbLinea(texto, 120);
  if (s === '') return '';
  const c = cbCanon(s);
  if (CB_PROHIBIDAS.test(c)) return '';
  if (real && /simulad|simulacr|demostracion|prueba/.test(c)) return '';
  return s;
}

// EL PIE DEL QR: el producto, el monto exacto a ingresar y el pedido. NUNCA nombra banco, titular ni cuenta (el QR ya los lleva). Con cobro simulado, el rótulo va primero (prohibición 3).
// `datos`: { producto: nombre mostrable, incluye, monto, codigo, moneda, presentacion (texto del código, opcional), simulado, tratamiento }. '' si el monto no es válido: no se manda un QR sin decir cuánto se paga.
function cbPieQr(datos) {
  const d = cbEsObjeto(datos) ? datos : {};
  const u = cbTratamiento(d.tratamiento) === 'usted';
  const m = cbMontoConMoneda(d.monto, d.moneda);
  if (m === '') return '';
  const cod = cbCodigo(d.codigo);
  if (d.simulado === true) {
    const nom = cbNombreDeProducto(d.producto, false) || (u ? 'su pedido' : 'tu pedido');
    return (CB_ROTULO_SIMULADO + '\n' + (u ? 'Eligió ' : 'Elegiste ') + nom + '. Total de la prueba: ' + m + (cod ? ' (pedido #' + cod + ')' : '') + '.\n'
      + (u ? 'No intente pagarlo: su banco lo va a rechazar. Para seguir con la prueba, envíeme aquí cualquier foto como comprobante simulado.'
        : 'No intentes pagarlo: tu banco lo va a rechazar. Para seguir con la prueba, envíame aquí cualquier foto como comprobante simulado.')).slice(0, 1024);
  }
  const nom = cbNombreDeProducto(d.producto, true) || (u ? 'su opción' : 'tu opción');
  const inc = cbNombreDeProducto(d.incluye, true);
  const pres = typeof d.presentacion === 'string' && d.presentacion !== '' && !cbTextoProhibido(d.presentacion) && !/simulad/i.test(d.presentacion) ? d.presentacion.slice(0, 300) : '';
  const texto = (pres ? pres + ' ' : '') + (u ? 'Eligió ' : 'Elegiste ') + nom + (inc ? ' (' + inc + ')' : '') + ' por ' + m + '. '
    + (u ? 'Escanee el QR: es de monto abierto, así que ingrese exactamente ' + m + ' y después mándeme aquí la captura del comprobante.'
      : 'Escanea el QR: es de monto abierto, así que ingresa exactamente ' + m + ' y después mándame aquí la captura del comprobante.')
    + (cod ? ' Pedido #' + cod + '.' : '');
  if (cbTextoProhibido(texto)) return ((u ? 'Escanee' : 'Escanea') + ' el QR: es de monto abierto, así que ' + (u ? 'ingrese' : 'ingresa') + ' exactamente ' + m + '.').slice(0, 1024);
  return texto.slice(0, 1024);
}

// «Ya tienes un QR abierto…»: el cliente pide otra vez algo mientras el QR sigue esperando su comprobante. `datos`: { producto, monto, codigo, moneda, quien, tratamiento, conBoton }.
// Devuelve { cuerpo, boton }. Sin `conBoton` el texto no menciona el botón (una respuesta resuelta sale sin él).
function cbTextoQrAbierto(datos) {
  const d = cbEsObjeto(datos) ? datos : {};
  const u = cbTratamiento(d.tratamiento) === 'usted';
  const conBoton = d.conBoton === true;
  const q = cbQuien(d.quien);
  const nom = cbNombreDeProducto(d.producto, true) || (u ? 'su pedido' : 'tu pedido');
  const mm = cbMontoConMoneda(d.monto, d.moneda);
  const cod = cbCodigo(d.codigo);
  const accion = mm ? (u ? ' Ingrese exactamente ' : ' Ingresa exactamente ') + mm + ' y' : (u ? ' Ingrese el monto indicado y' : ' Ingresa el monto indicado y');
  let cuerpo = (u ? 'Ya tiene un QR abierto con ' : 'Ya tienes un QR abierto con ') + nom + '.' + accion + (u ? ' mándeme aquí la captura del comprobante.' : ' mándame aquí la captura del comprobante.')
    + (cod ? ' Pedido #' + cod + '.' : '')
    + (conBoton ? (u ? ' Si algo falla, escríbale a ' : ' Si algo falla, escríbele a ') + q + ' con el botón.' : '');
  if (cbTextoProhibido(cuerpo)) cuerpo = (u ? 'Ya tiene un QR abierto.' : 'Ya tienes un QR abierto.') + (u ? ' Mándeme aquí la captura del comprobante.' : ' Mándame aquí la captura del comprobante.');
  return { cuerpo: cuerpo, boton: conBoton };
}

// El QR real venció: no se ofrece el QR ni el total a pagar. Lo único que se ofrece es pasar con el negocio (aviso + botón). `datos`: { quien, tratamiento, salio }.
// «Ya avisé» solo con `salio === true`. Devuelve { cuerpo, boton, aviso }.
function cbTextoQrVencido(datos) {
  const d = cbEsObjeto(datos) ? datos : {};
  const u = cbTratamiento(d.tratamiento) === 'usted';
  const q = cbQuien(d.quien);
  const cabeza = 'No puedo mostrar' + (u ? 'le' : 'te') + ' el QR en este momento: ya venció. ' + (u ? 'No pague' : 'No pagues') + ' con ese QR.';
  let cuerpo = d.salio === true
    ? cabeza + ' Ya avisé a ' + q + '; ' + (u ? 'también puede escribirle' : 'también puedes escribirle') + ' directo con el botón para coordinar el pago.'
    : cabeza + ' No pude avisarle a ' + q + '; ' + (u ? 'escríbale' : 'escríbele') + ' directo con el botón para coordinar el pago.';
  if (cbTextoProhibido(cuerpo)) cuerpo = 'No puedo mostrar' + (u ? 'le' : 'te') + ' el QR en este momento. ' + (u ? 'Escríbale' : 'Escríbele') + ' directo a nuestro equipo con el botón.';
  return { cuerpo: cuerpo, boton: true, aviso: 'QR vencido: coordinar el pago' };
}

// El texto de «cerré tu pedido» (el cobro abierto se cancela sin comprobante previo). El QR de monto abierto sigue sirviendo para pagar, así que NO dice que el QR quedó cerrado ni promete
// devoluciones («solo se ofrece lo que se cumple»); lleva el botón porque deriva el pago al negocio. `datos`: { quien, tratamiento, yaCerrado }. Devuelve { cuerpo, boton }.
function cbTextoCobroCancelado(datos) {
  const d = cbEsObjeto(datos) ? datos : {};
  const u = cbTratamiento(d.tratamiento) === 'usted';
  const q = cbQuien(d.quien);
  const cabeza = d.yaCerrado === true ? (u ? 'Su pedido ya quedó cerrado.' : 'Tu pedido ya quedó cerrado.') : (u ? 'Listo, cerré su pedido.' : 'Listo, cerré tu pedido.');
  let cuerpo = cabeza + '\n\n' + (u ? 'No pague con ese QR: si ya lo hizo, envíeme el comprobante o escríbale a ' : 'No pagues con ese QR: si ya lo hiciste, envíame el comprobante o escríbele a ')
    + q + ' con el botón; el pago lo revisa ' + q + '.';
  if (cbTextoProhibido(cuerpo)) cuerpo = cabeza + '\n\n' + (u ? 'Escríbale' : 'Escríbele') + ' a nuestro equipo con el botón.';
  return { cuerpo: cuerpo, boton: true };
}
