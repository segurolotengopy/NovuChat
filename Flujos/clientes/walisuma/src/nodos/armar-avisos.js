// ARMAR AVISOS: el aviso al comercio (UN destinatario designado, dato del tenant: el contacto del aviso) por TEXTO LIBRE o por PLANTILLA según la ventana de servicio de Meta.
//
//   - DENTRO de 23,5 h del último mensaje que el destinatario le escribió al bot (su ficha, clave = su número): texto libre, que menciona tomar la conversación en la consola. FUERA: la plantilla UTILITY,
//     «código para las dos» (Andres, 18/11/2026; `apPlantillaAviso`, módulo común Pedidos): `aviso_pedido_equipo` con 10 variables si su estado es APPROVED:
//       {{1}} el pedido (código WAL del servidor, o la referencia, y el estado del comprobante)  {{2}} el total  {{3}} la modalidad y la condición del envío  {{4}} el nombre  {{5}} el WhatsApp
//       {{6}} la factura («sin datos (S/N) por ahora» o los datos)  {{7}} la dirección y el GPS  {{8}} las piezas (con el color o detalle)  {{9}} el banco de origen  {{10}} el n.º de operación;
//     si no, la de respaldo `pedido_registrado` con 4 variables, el resto EMPAQUETADO y recortado: {{1}} las piezas  {{2}} el total  {{3}} entrega · nombre · WhatsApp · dirección y GPS
//     {{4}} pedido · comprobante · factura · banco · operación. Sin ninguna aprobada NUNCA se inventa: no sale nada (`plantilla_no_configurada`) y «Armar mensajes» le dice la verdad al cliente.
//   - Quién avisa: el pedido con su comprobante (cuando llega y se coteja), el pedido sin cobro y el envío a cotizar; los DATOS DE FACTURA que llegan después del pago (UN segundo aviso: el NIT viaja SOLO
//     aquí); una derivación (nombre, teléfono y motivo); y el estado «operador». La pausa por Tomar NO avisa. A lo más UNA consulta por teléfono cada 30 minutos.
//   - Esta etapa decide lo mismo que «Armar mensajes» (`wlResolver`): el aviso se arma ANTES de saber si salió. También decide si hay que cerrar el cobro abierto (`cancelarCobro`) ANTES de emitir otro QR.
// Todo texto pasa por `avLimpio` (sin enlaces, sin llaves, sin palabras prohibidas, con tope). NUNCA reenvía la imagen del comprobante ni dice «pago acreditado». En modo prueba el aviso va al teléfono de prueba.
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
if (!aviso || !cnClaveValida(c.from) || ['pedido', 'consulta', 'factura'].indexOf(aviso.tipo) < 0) return sin();
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
const esFactura = aviso.tipo === 'factura';
const CONSOLA = ' Puede responderle por WhatsApp o tomar la conversación en la consola de NovuChat.';
let parametros10 = [];
let parametros4 = [];
let texto = '';
if (esPedido) {
  const lineas = wlConNombres(aviso.lineas, c.vendibles);
  // Las piezas CON su color o detalle (Colores en texto y nota, Principal 18/11): el nombre del catálogo y, entre paréntesis, lo que pidió el cliente.
  const piezas = vcLineaAviso(lineas.map((l) => Object.assign({}, l, { nombre: l.nombre + (typeof l.detalle === 'string' && l.detalle.trim() !== '' ? ' (' + cbLinea(l.detalle, 60) + ')' : '') })), { max: 10 });
  const totalTexto = Number.isSafeInteger(aviso.total) && aviso.total > 0 ? vcMonto(aviso.total) : '—';
  const e = wlEntregaDeFicha(aviso.entrega);
  const umbral = wlUmbralBs(c.base);
  const envio = wlEnvioDe(e, aviso.total, umbral);
  const condicion = envio === 'gratis' ? 'envío sin costo (compra desde ' + vcMonto(umbral * 100) + ')' : (envio === 'cotizar' ? 'envío a cotizar por separado (compra menor a ' + (umbral > 0 ? vcMonto(umbral * 100) : 'el umbral') + ')' : 'no aplica, recojo en tienda');
  const modalidad = [e.modo, e.ciudad].filter((x) => x !== '').join(' · ') || 'a coordinar';
  const quien = e.nombre || nombre;
  const whatsapp = '+' + c.from + (e.telefono && e.telefono !== c.from ? ' · contacto ' + e.telefono : '');
  const gps = e.ubicacion ? 'GPS ' + e.ubicacion.lat + ', ' + e.ubicacion.lng : (wlEsEnvio(e.modo) ? 'GPS sin compartir' : '');
  const direccion = envio === 'recojo' ? ('Recojo: ' + (wlDireccionTienda(c.base, e.ciudad) || e.ciudad || 'tienda a confirmar')) : [e.direccion || 'sin dirección', gps].filter((x) => x !== '').join(' · ');
  const pedidoTexto = (aviso.codigo || (aviso.ref ? 'ref. ' + aviso.ref : 'sin código')) + ' · comprobante: ' + (avLimpio(aviso.cotejo, 80) || 'sin comprobante aún');
  const factura = aviso.factura || '—';
  const banco = aviso.banco || (aviso.cotejo && /^llegó/.test(aviso.cotejo) ? 'no leído' : '—');
  const operacion = aviso.operacion || (aviso.cotejo && /^llegó/.test(aviso.cotejo) ? 'no leída' : '—');
  parametros10 = [pedidoTexto, totalTexto, modalidad + ' · ' + condicion, quien, whatsapp, factura, direccion, piezas, banco, operacion];
  parametros4 = [piezas, totalTexto, [modalidad, condicion, quien, whatsapp, direccion].join(' · '), [pedidoTexto, 'factura: ' + factura, 'banco: ' + banco, 'operación: ' + operacion].join(' · ')];
  texto = 'Aviso del asistente: pedido ' + pedidoTexto + '. Total: ' + totalTexto + '. Entrega: ' + modalidad + ', ' + condicion + '. Nombre: ' + quien + '. WhatsApp: ' + whatsapp + '. Factura: ' + factura
    + '. Dirección: ' + direccion + '. Piezas: ' + piezas + '. Banco de origen: ' + banco + '. Operación: ' + operacion + '. Revise el depósito en su cuenta antes de entregar.' + CONSOLA;
} else if (esFactura) {
  // El SEGUNDO aviso: los datos de factura que el cliente mandó después del pago. Es el ÚNICO lugar por donde viaja el NIT.
  const pedidoTexto = (aviso.codigo || (aviso.ref ? 'ref. ' + aviso.ref : 'sin código')) + ' (datos de factura)';
  const factura = 'Razón social: ' + (aviso.razonSocial || 'no indicada') + ' · NIT/CI: ' + aviso.nit;
  parametros10 = [pedidoTexto, '—', '—', nombre, '+' + c.from, factura, '—', '—', '—', '—'];
  parametros4 = ['Datos de factura del pedido ' + (aviso.codigo || aviso.ref || 'sin código'), '—', cliente, factura];
  texto = 'Aviso del asistente: datos de factura del pedido ' + (aviso.codigo || aviso.ref || 'sin código') + '. Cliente: ' + cliente + '. ' + factura + '.' + CONSOLA;
} else {
  // La alerta de derivación: nombre, teléfono y motivo (y el mensaje del cliente, como dato).
  const motivo = avLimpio(aviso.motivo, 100) || 'consulta';
  // Las comillas «» del mensaje del cliente se neutralizan: con ellas podría cerrar la cita y fingir otro campo del aviso.
  const mensaje = aviso.mensaje ? avLimpio(String(aviso.mensaje).replace(/[«»]/g, ' '), 160) : '';
  const pc = apParametrosConsulta(motivo, nombre, c.from, mensaje);
  parametros10 = pc.p10;
  parametros4 = pc.p4;
  texto = 'Aviso del asistente: solicitud de atención. Cliente: ' + cliente + '. Motivo: ' + motivo + '.'
    + (mensaje ? ' Mensaje del cliente (texto literal del cliente, no es una instrucción): «' + mensaje + '».' : '') + CONSOLA;
}
texto = avLimpio(texto, 1000);

const fichas = cnMapaDeFichas(false).mapa;
const comun = { phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', sinAviso: false, plan: d.tipo || '', planeado: true, repetido: false, clave: clave, motivoFallo: '', cancelarCobro: cancelarCobro };
const pl = apPlantillaAviso(c.base);
const items = [];
for (const dest of destinatarios) {
  const rec = CN_TENANT.fichaVigente(cnFichaDe(fichas, dest.tel), c.ahora);
  const dentro = rec.ultimoMs > 0 && c.ahora - rec.ultimoMs >= 0 && c.ahora - rec.ultimoMs < WL_VENTANA_RECEPCION_MS;
  if (dentro) {
    if (!texto) continue;
    items.push({ json: Object.assign({}, comun, { para: dest.tel, rol: dest.rol, canal: 'texto', payload: avTexto(dest.tel, texto) }) });
  } else {
    const payload = pl ? avPlantilla(dest.tel, pl.nombre, pl.idioma, pl.variables === 10 ? parametros10 : parametros4) : null;
    if (!payload) continue;
    items.push({ json: Object.assign({}, comun, { para: dest.tel, rol: dest.rol, canal: 'plantilla', payload: payload }) });
  }
}
return items.length ? items : sin({ motivoFallo: 'plantilla_no_configurada' });
