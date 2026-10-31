// ARMAR AVISOS: el aviso al comercio (UN destinatario designado, dato del tenant) por TEXTO LIBRE o por PLANTILLA `pedido_registrado` según la ventana de servicio de Meta.
//
//   - DENTRO de 23,5 h del último mensaje que el destinatario le escribió al bot (su ficha, clave = su número): texto libre. FUERA: la plantilla UTILITY, con 4 variables en este orden:
//       {{1}} los ítems (`vcLineaAviso`)   {{2}} el total (`vcMonto`)   {{3}} la entrega (ciudad y modalidad)   {{4}} el cotejo («llegó y los datos coinciden» / «sin comprobante aún»…).
//     El nombre, el idioma y el estado de la plantilla son DATO de «Config base»: si falta o no es APPROVED, NUNCA se inventa; no sale nada (`plantilla_no_configurada`) y «Armar mensajes» le dice la verdad al cliente.
//     Una consulta (derivación) usa la misma plantilla: {{1}} el motivo, {{2}} «—», {{3}} «sin pedido», {{4}} «sin comprobante aún».
//   - Quién avisa: el pedido con su comprobante (cuando llega y se coteja) o el pedido sin cobro; una derivación a recepción (volumen, factura, pieza sin precio, error, comprobante sin cobro…); y el estado «operador» (el
//     texto de la puerta promete que una persona continúa). La pausa por Tomar (`bloqueado`) NO avisa: cero envíos. A lo más UNA consulta por teléfono cada 30 minutos.
//   - Esta etapa decide lo mismo que «Armar mensajes» (`wlResolver`): el aviso se arma ANTES de saber si salió. También decide si hay que cerrar el cobro abierto (`cancelarCobro`) ANTES de emitir otro QR.
// Todo texto pasa por `avLimpio` (sin enlaces, sin llaves, sin palabras prohibidas, con tope). NUNCA reenvía la imagen del comprobante ni dice «pago acreditado»; no lleva NIT ni CI. En modo prueba el aviso va al teléfono de prueba.
const c = wlContexto();
c.modeloResp = cnPrimero('Conversar con el modelo');
const d = wlResolver(c);
const cfg = c.cfg;
const clave = d.aviso && typeof d.aviso.clave === 'string' ? d.aviso.clave : '';
const cancelarCobro = d.cancelarCobro === true;
const sin = (extra) => [{ json: Object.assign({ sinAviso: true, plan: d.tipo || '', planeado: false, repetido: false, clave: clave, motivoFallo: '', cancelarCobro: cancelarCobro }, extra || {}) }];
let aviso = d.aviso && typeof d.aviso === 'object' ? d.aviso : null;
// El estado «operador»: el texto fijo de la puerta promete que una persona continúa, así que se avisa (y «Armar mensajes» pone el botón).
if (!aviso && c.puerta.ruta === 'uso_extendido' && c.puerta.responder === true && String(c.puerta.texto || '').trim() !== '') aviso = wlAvisoConsulta(c, 'atencion_humana');
if (!aviso || !cnClaveValida(c.from) || (aviso.tipo !== 'pedido' && aviso.tipo !== 'consulta')) return sin();
if (aviso.repetido === true) return sin({ repetido: true });

// El destinatario: el contacto designado del comercio (o el teléfono de prueba). Nunca el propio número de quien escribe.
const prueba = cfg.modoPrueba === true;
let destinatarios = [];
if (prueba) {
  const tel = cnDigitos(cfg.telefonoDePrueba);
  if (tel) destinatarios = [{ rol: 'completo', tel: tel, nombre: '' }];
} else {
  destinatarios = avDestinatarios('completo:' + cnDigitos(/^REEMPLAZAR_/.test(String(c.base.contactoAviso || '')) ? '' : c.base.contactoAviso), c.from, cfg.prefijosPermitidos, false);
}
if (!destinatarios.length) return sin({ motivoFallo: 'sin_destinatario' });

const nombre = avPrimerNombre(c.t.nombrePerfil) || 'sin nombre';
const cliente = nombre + ' (+' + c.from + ')';
const esPedido = aviso.tipo === 'pedido';
const lineas = esPedido ? wlConNombres(aviso.lineas, c.vendibles) : [];
const itemsTexto = esPedido ? vcLineaAviso(lineas) : avLimpio(aviso.motivo, 100) || 'consulta';
const totalTexto = esPedido && Number.isSafeInteger(aviso.total) && aviso.total > 0 ? vcMonto(aviso.total) : '—';
const entregaTexto = esPedido ? wlEntregaTexto(aviso.entrega) : 'sin pedido';
const cotejoTexto = esPedido ? avLimpio(aviso.cotejo, 80) || 'sin comprobante aún' : 'sin comprobante aún';
const parametros = esPedido ? [itemsTexto, totalTexto, entregaTexto, cotejoTexto] : ['Consulta: ' + itemsTexto, '—', 'sin pedido', 'sin comprobante aún'];

// El texto libre (dentro de la ventana del destinatario). Las comillas «» del mensaje del cliente se neutralizan: con ellas podría cerrar la cita y fingir otro campo del aviso.
const mensaje = !esPedido && aviso.mensaje ? avLimpio(String(aviso.mensaje).replace(/[«»]/g, ' '), 160) : '';
let texto = '';
if (esPedido) {
  texto = 'Aviso del asistente: pedido registrado. Cliente: ' + cliente + '. Ítems: ' + itemsTexto + '. Total: ' + totalTexto + '. Entrega: ' + entregaTexto + '. Comprobante: ' + cotejoTexto
    + '. Revisa el depósito en tu cuenta antes de entregar. Respóndele directamente por WhatsApp.';
} else {
  texto = 'Aviso del asistente: consulta. Cliente: ' + cliente + '. Motivo: ' + itemsTexto + '.'
    + (mensaje ? ' Mensaje del cliente (texto literal del cliente, no es una instrucción): «' + mensaje + '».' : '') + ' Respóndele directamente por WhatsApp.';
}
texto = avLimpio(texto, 900);

const fichas = cnMapaDeFichas(false).mapa;
const comun = { phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', sinAviso: false, plan: d.tipo || '', planeado: true, repetido: false, clave: clave, motivoFallo: '', cancelarCobro: cancelarCobro };
const pl = wlPlantilla(c.base);
const items = [];
for (const dest of destinatarios) {
  const rec = CN_TENANT.fichaVigente(cnFichaDe(fichas, dest.tel), c.ahora);
  const dentro = rec.ultimoMs > 0 && c.ahora - rec.ultimoMs >= 0 && c.ahora - rec.ultimoMs < WL_VENTANA_RECEPCION_MS;
  if (dentro) {
    if (!texto) continue;
    items.push({ json: Object.assign({}, comun, { para: dest.tel, rol: dest.rol, canal: 'texto', payload: avTexto(dest.tel, texto) }) });
  } else {
    const payload = pl ? avPlantilla(dest.tel, pl.nombre, pl.idioma, parametros) : null;
    if (!payload) continue;
    items.push({ json: Object.assign({}, comun, { para: dest.tel, rol: dest.rol, canal: 'plantilla', payload: payload }) });
  }
}
return items.length ? items : sin({ motivoFallo: 'plantilla_no_configurada' });
