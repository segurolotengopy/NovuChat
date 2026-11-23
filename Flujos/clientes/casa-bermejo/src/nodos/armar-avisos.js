// ARMAR AVISOS: el aviso al comercio (UN destinatario designado, dato del tenant) por TEXTO LIBRE o por PLANTILLA (`aviso_pedido_equipo` de 10 variables, con el nombre y el WhatsApp del cliente; si no, la de respaldo `pedido_registrado`) según la ventana de servicio de Meta.
//
//   - DENTRO de 23,5 h del último mensaje que el destinatario le escribió al bot (su ficha, clave = su número): texto libre. FUERA: la plantilla UTILITY, «código para las dos» con Walisuma (módulo común Pedidos, `apPlantillaAviso`): `aviso_pedido_equipo` con 10 variables si es APPROVED
//       ({{1}} el pedido y el comprobante  {{2}} el total  {{3}} la entrega  {{4}} el NOMBRE  {{5}} el WhatsApp  {{6}} factura «—»  {{7}} «—»  {{8}} los ítems  {{9}} banco «—»  {{10}} operación «—»); si no, la de respaldo
//       `pedido_registrado` con 4: {{1}} ítems  {{2}} total  {{3}} entrega · nombre (+WhatsApp)  {{4}} cotejo. NUNCA sale un aviso sin el nombre y el teléfono del cliente.
//     El nombre, el idioma y el estado de la plantilla son DATO de «Config base»: si falta o no es APPROVED, NUNCA se inventa; no sale nada (`plantilla_no_configurada`) y «Armar mensajes» le dice la verdad al cliente.
//     Una consulta (derivación) usa la misma plantilla: {{1}} el motivo, {{2}} «—», {{3}} «sin pedido», {{4}} «sin comprobante aún».
//   - Quién avisa: el pedido con su comprobante (cuando llega y se coteja) o el pedido sin cobro; una derivación a recepción (volumen, factura, pieza sin precio, error, comprobante sin cobro…); y el estado «operador» (el
//     texto de la puerta promete que una persona continúa). La pausa por Tomar (`bloqueado`) NO avisa: cero envíos. A lo más UNA consulta por teléfono cada 30 minutos.
//   - Un DEFECTO del catálogo (`catalogoAlerta`) cambia el motivo de ESA derivación por la causa y qué hacer (`BM_ALERTAS_CATALOGO`), una vez por causa cada 6 h; el tope se anota en «Armar mensajes» solo si el aviso salió.
//   - Esta etapa decide lo mismo que «Armar mensajes» (`bmResolver`): el aviso se arma ANTES de saber si salió. También decide si hay que cerrar el cobro abierto (`cancelarCobro`) ANTES de emitir otro QR.
// Todo texto pasa por `avLimpio` (sin enlaces, sin llaves, sin palabras prohibidas, con tope). NUNCA reenvía la imagen del comprobante ni dice «pago acreditado»; no lleva NIT ni CI. En modo prueba el aviso va al teléfono de prueba.
const c = bmContexto();
c.modeloResp = cnPrimero('Conversar con el modelo');
const d = bmResolver(c);
const cfg = c.cfg;
const clave = d.aviso && typeof d.aviso.clave === 'string' ? d.aviso.clave : '';
const cancelarCobro = d.cancelarCobro === true;
// La llamada al servidor de este turno (la hace «Avisar al servidor»): cerrar el cobro abierto (`cobro_cancelado`, Bolivia) o pedir el alias (`pedirAliasArs`, Argentina). `servidor` solo lo arma el CÓDIGO.
const servidor = d.servidor && typeof d.servidor === 'object' && d.servidor.ruta === 'pedirAliasArs' && d.servidor.cuerpo && typeof d.servidor.cuerpo === 'object' ? d.servidor : null;
const llamarServidor = cancelarCobro || servidor !== null;
// `avisoSi`: el aviso de este turno solo sale si la respuesta del servidor transfiere (lo decide «¿Hay avisos?» con la misma regla que `bmAliasPedirResultado`).
const avisoSi = d.avisoSi === 'pedir_fallo' ? 'pedir_fallo' : '';
const sin = (extra) => [{ json: Object.assign({ sinAviso: true, plan: d.tipo || '', planeado: false, repetido: false, clave: clave, motivoFallo: '', alertaCatalogo: '', cancelarCobro: cancelarCobro, llamarServidor: llamarServidor, servidor: servidor, avisoSi: avisoSi }, extra || {}) }];
let aviso = d.aviso && typeof d.aviso === 'object' ? d.aviso : null;
// El estado «operador»: el texto fijo de la puerta promete que una persona continúa, así que se avisa (y «Armar mensajes» pone el botón).
if (!aviso && c.puerta.ruta === 'uso_extendido' && c.puerta.responder === true && String(c.puerta.texto || '').trim() !== '') aviso = bmAvisoConsulta(c, 'atencion_humana');
if (!aviso || !cnClaveValida(c.from) || (aviso.tipo !== 'pedido' && aviso.tipo !== 'consulta')) return sin();
if (aviso.repetido === true) return sin({ repetido: true });
// Un DEFECTO del catálogo (clave, versión, moneda…): el MISMO aviso de derivación lleva la causa y qué hacer, a lo más una vez por causa cada 6 h (tope global en datos estáticos). 0 nodos y 0 mensajes agregados.
const dt = cnPrimero('Decidir turno') || {};
const alertaCatalogo = aviso.tipo === 'consulta' && aviso.clave === 'sin_configuracion' && dt.catalogoAlerta === true && typeof dt.catalogoMotivo === 'string'
  && bmAlertaCatalogoLibre(bmAlertasDe(cnMapaDeFichas(false).sd), dt.catalogoMotivo, c.ahora) ? dt.catalogoMotivo : '';
if (alertaCatalogo) aviso = Object.assign({}, aviso, { motivo: BM_ALERTAS_CATALOGO[alertaCatalogo] });
// Un catálogo que no se pudo leer SIEMPRE deja su causa técnica en el aviso a recepción (aunque no merezca alerta ni haya pasado la ventana de 6 h): sin ejecuciones guardadas (retención «none»), es la única huella de por qué falló.
else if (aviso.tipo === 'consulta' && aviso.clave === 'sin_configuracion' && typeof dt.catalogoMotivo === 'string' && /^[a-z_]{1,40}$/.test(dt.catalogoMotivo)) {
  // La lee recepción, no un técnico: la causa va en palabras simples y el código, breve, al final entre corchetes. Nunca la URL, la clave ni el cuerpo de la respuesta.
  const CAUSAS = { limite: 'el catálogo estaba ocupado', interno: 'el catálogo tuvo un error', sin_cotizacion: 'el catálogo no tenía el tipo de cambio', timeout: 'el catálogo no respondió a tiempo', sin_catalogo: 'el catálogo no respondió', respuesta_invalida: 'el catálogo envió algo que no se pudo leer', credencial: 'el catálogo rechazó la clave de acceso', version_no_soportada: 'el catálogo cambió su formato', moneda_distinta: 'el catálogo envió precios en otra moneda', mercado_invalido: 'el catálogo no reconoció el país', cotizacion_vencida: 'el catálogo tenía el tipo de cambio vencido' };
  aviso = Object.assign({}, aviso, { motivo: String(aviso.motivo || 'consulta') + ' (causa: ' + (CAUSAS[dt.catalogoMotivo] || 'el catálogo no se pudo leer') + ') [' + dt.catalogoMotivo + ']' });
}

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
const lineas = esPedido ? bmConNombres(aviso.lineas, c.vendibles) : [];
const itemsTexto = esPedido ? vcLineaAviso(lineas) : avLimpio(aviso.motivo, 200) || 'consulta';
const totalTexto = esPedido && Number.isSafeInteger(aviso.total) && aviso.total > 0 ? vcMonto(aviso.total, Array.isArray(aviso.lineas) && aviso.lineas[0] ? aviso.lineas[0].moneda : undefined) : '—';
const entregaTexto = esPedido ? bmEntregaTexto(aviso.entrega) : 'sin pedido';
const cotejoTexto = esPedido ? avLimpio(aviso.cotejo, 80) || 'sin comprobante aún' : 'sin comprobante aún';
// El nombre y el WhatsApp del cliente VIAJAN SIEMPRE (reclamo de Andres, 22/11/2026): la plantilla de 10 variables los tiene propios; la de respaldo (4) los lleva empaquetados en {{3}}.
const mensaje0 = !esPedido && aviso.mensaje ? avLimpio(String(aviso.mensaje).replace(/[«»]/g, ' '), 160) : '';
const pc = apParametrosConsulta(itemsTexto, nombre, c.from, mensaje0);
const parametros10 = esPedido
  ? ['Pedido registrado · comprobante: ' + cotejoTexto, totalTexto, entregaTexto, nombre, '+' + c.from, '—', '—', itemsTexto, '—', '—']
  : pc.p10;
const parametros4 = esPedido ? [itemsTexto, totalTexto, entregaTexto + ' · ' + cliente, cotejoTexto] : pc.p4;

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
const comun = { phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', sinAviso: false, plan: d.tipo || '', planeado: true, repetido: false, clave: clave, motivoFallo: '', alertaCatalogo: alertaCatalogo, cancelarCobro: cancelarCobro, llamarServidor: llamarServidor, servidor: servidor, avisoSi: avisoSi };
const pl = apPlantillaAviso(c.base);
const items = [];
for (const dest of destinatarios) {
  const rec = CN_TENANT.fichaVigente(cnFichaDe(fichas, dest.tel), c.ahora);
  const dentro = rec.ultimoMs > 0 && c.ahora - rec.ultimoMs >= 0 && c.ahora - rec.ultimoMs < BM_VENTANA_RECEPCION_MS;
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
