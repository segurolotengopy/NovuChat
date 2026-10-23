// =============================================================================
// COBROS · VENTA · COTEJO DEL COMPROBANTE (prefijo `cb` / `CB_`)  —  `Flujos/src/modulos/cobros/comun/cotejo.js`
// =============================================================================
// Segundo archivo del módulo (después de `lectura.js`): el cobro real que declara el servidor, la respuesta del cotejo, su vocabulario y la diferencia que se le dice al cliente.
// Cada declaración es COPIA BYTE A BYTE del canon (`venta-minima/src/lib/cobro.js` de #519, rama `cartera/qtaco-visor-comprobantes`); lo único nuevo es `cbCobroDelPanel` (al final) y el
// congelado de las listas cerradas. Funciones puras: sin globales de Node, reloj ni red. El cotejo lo hace el SERVIDOR: aquí solo se interpreta.
// =============================================================================

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

// Las listas cerradas no se tocan en tiempo de ejecución.
Object.freeze(CB_ESTADOS_VENTA);
Object.freeze(CB_MOTIVOS_NO_LEGIBLE);
Object.freeze(CB_FRASE_DEL_MOTIVO);

// -----------------------------------------------------------------------------
// NUEVO (no es copia del canon): el cobro de ESTE teléfono según el panel. Unifica `cbCobroReal` (Q'Taco) y `raCobro` (Rubén y Antonio).
// `cuerpoConfiguracion` = el cuerpo de `configuracionFlujo` (ya sin el envoltorio `{ok, cuerpo}`). Solo REAL: el dinero va a la cuenta del comercio, y manda el SERVIDOR
// (`cbCobroReal(...).activo`: el servidor mandó `cobroReal` y una imagen https). El QR sale con el id de medio que sirve la consola (`venta.mediaIdQr`); la dirección del QR nunca viaja en un mensaje.
// Cualquier otra cosa: `modo: 'ninguno'` y sin QR. Nunca lanza.
// -----------------------------------------------------------------------------
function cbCobroDelPanel(cuerpoConfiguracion) {
  const c = cbEsObjeto(cuerpoConfiguracion) ? cuerpoConfiguracion : {};
  const cb = cbEsObjeto(c.cobro) ? c.cobro : {};
  const venta = cbEsObjeto(c.venta) ? c.venta : {};
  const vencido = typeof cb.vencidoHaceMin === 'number' && Number.isFinite(cb.vencidoHaceMin) && cb.vencidoHaceMin >= 0 ? Math.floor(cb.vencidoHaceMin) : null;
  const medio = typeof venta.mediaIdQr === 'string' ? venta.mediaIdQr.trim() : '';
  const real = cbCobroReal(c);
  const estado = {
    pendiente: cb.pendiente === true,
    monto: cbTotalValido(cb.monto),
    pedidoRef: typeof cb.pedido === 'string' ? cbLinea(cb.pedido, 120) : '',
    regla: cb.regla === 2 ? 2 : 1,
    enRevision: cb.regla === 2 && cb.enRevision === true,
    vencidoHaceMin: vencido,
  };
  if (real.activo === true) {
    return Object.assign({ modo: 'real', mediaId: /^[A-Za-z0-9_-]{5,100}$/.test(medio) ? medio : '', titular: real.titular, banco: real.banco, venceEl: real.venceEl }, estado);
  }
  return Object.assign({ modo: 'ninguno', mediaId: '', titular: '', banco: '', venceEl: '' }, estado);
}
