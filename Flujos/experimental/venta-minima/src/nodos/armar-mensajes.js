// ARMAR MENSAJES (Venta mínima v0): segunda etapa de envío (DD6). Todo lo que sale AL CLIENTE
// se arma acá, con código, y sale un ítem por mensaje:
// {para, payload, texto, respaldo, tipoReporte, evento, referencia, monto, reportar, ...}.
// También es el ÚNICO lugar donde se escribe el estado por teléfono, los pedidos guardados y la
// marca de derivación (`staticData`), al final del turno.
//
// LO QUE NUNCA HACE:
//   - decir «pasé tu pedido al restaurante» o «tu solicitud llegó al restaurante» si Meta no
//     devolvió un `wamid` para al menos una plantilla o un detalle (`Enviar aviso` o `Aviso de
//     respaldo`; la imagen del comprobante no cuenta): elige
//     `condicionados.siSalio` o `siNoSalio` por ese hecho, y una frase de pase en un mensaje normal
//     sin aviso salido se reemplaza por la derivación genérica;
//   - dejar salir un texto, un título de botón o un detalle con una palabra de `VM_PROHIBIDAS`
//     («validado», «pagado», «recibimos tu pago», «ya lo preparan»…): se usa el texto de derivación
//     y se anota en `errores`;
//   - mandar un QR sin enlace https, sin monto, o con un monto distinto del total del pedido que
//     calculó el código: en ese caso no se guarda `esperando_comprobante`;
//   - ofrecer algo distinto de pasar con el restaurante (el botón que abre su chat).
//
// MODO PRUEBA: los mensajes al cliente van a `telefonoDePrueba`, sin prefijo y sin reportar.
const AM_PLAN = vmPrimero('Plan del turno') || vmPrimero('Uso extendido') || vmPrimero('Comercio no operativo') || {};
const AM_CFG = vmCfg();
const AM_T = vmPrimero('Interpretar entrada') || {};
const AM_AHORA = Number(AM_T.ahoraMs) || Date.now();
const AM_FROM = String(AM_T.from || '');
const AM_FROM_DIG = vmDigitos(AM_FROM);
const AM_NEGOCIO = String(AM_CFG.nombreNegocio || 'el negocio');
const AM_PRUEBA = AM_CFG.modoPrueba === true;
const AM_TEL_PRUEBA = String(AM_CFG.telefonoDePrueba || '');
const AM_REC = vmDigitos(AM_CFG.numeroRecepcion);
const AM_REC_OK = AM_REC.length >= 8 && AM_REC.length <= 15 && AM_REC !== AM_FROM_DIG;
const AM_GEN_CUERPO = 'Eso lo ve directamente el restaurante. Toca el botón para escribirles.';
const AM_GEN_BOTON = 'Escribir al local';
const AM_HORA_MS = 60 * 60 * 1000;
const AM_PEDIDOS_MS = 72 * AM_HORA_MS;
const AM_sd = vmSd();

const AM_avisosArmados = vmTodos('Armar avisos');
const AM_errores = (AM_avisosArmados[0] && Array.isArray(AM_avisosArmados[0].errores)
  ? AM_avisosArmados[0].errores : (Array.isArray(AM_PLAN.errores) ? AM_PLAN.errores : [])).slice();

// ----------------------------------------------------------------- ¿salió el aviso? (por hecho)
// Solo cuenta un `messages[0].id` en la respuesta de Meta: un error, una respuesta vacía o un nodo
// que no corrió no cuentan. Y solo el de una PLANTILLA o un DETALLE: la imagen del comprobante tiene su
// propio `wamid` pero no es «el aviso» (si Meta la rechaza, falla ese ítem y nada más). El orden de
// `Enviar aviso` es el de los avisos armados que pasaron el IF.
function amWamid(j) {
  const m = j && j.messages;
  return Array.isArray(m) && m[0] && typeof m[0].id === 'string' && m[0].id ? m[0].id : '';
}
const amEsImagen = (a) => !!a && (a.clase === 'imagen' || (a.clase === undefined && a.payload && a.payload.type === 'image'));
const AM_armados = AM_avisosArmados.filter((i) => i && i.sinAviso !== true && i.payload);
const AM_enviados = vmTodos('Enviar aviso').concat(vmTodos('Simular aviso')); // T7c: en la prueba sin enviarDeVerdad, el wamid simulado
const AM_respaldos = vmTodos('Aviso de respaldo');
const AM_wamids = AM_enviados.map(amWamid).concat(AM_respaldos.map(amWamid)).filter(Boolean);
const AM_tiposSalidos = []; // tipo de aviso de cada plantilla o detalle que salió
let AM_avisoSalio = false;
if (AM_wamids.length) {
  if (AM_enviados.length === AM_armados.length) {
    AM_enviados.forEach((j, i) => {
      if (amWamid(j) && !amEsImagen(AM_armados[i])) { AM_avisoSalio = true; AM_tiposSalidos.push(AM_armados[i].tipoAviso); }
    });
    if (AM_respaldos.some((j) => amWamid(j))) {
      // un respaldo es un texto: cubre a los avisos cuyo envío cayó
      AM_avisoSalio = true;
      AM_enviados.forEach((j, i) => { if (!amWamid(j) && !amEsImagen(AM_armados[i])) AM_tiposSalidos.push(AM_armados[i].tipoAviso); });
    }
  } else {
    // Sin poder emparejar: salió solo si hay más `wamid` que imágenes armadas (alguno no es imagen).
    AM_avisoSalio = AM_wamids.length > AM_armados.filter(amEsImagen).length;
    if (AM_avisoSalio) AM_armados.filter((a) => !amEsImagen(a)).forEach((a) => AM_tiposSalidos.push(a.tipoAviso));
  }
}
const AM_AVISO_SALIO = AM_avisoSalio;

// ----------------------------------------------------------------- red de palabras
function amSeguro(x) {
  const s = String(x === undefined || x === null ? '' : x);
  if (!s) return true;
  return vmTextoSeguro(s) === true && !VM_PROHIBIDAS.test(vmNorm(s));
}
// Una frase que afirma que el pedido o la solicitud se pasó al restaurante.
const AM_PASE = /\bya pase\b|\bpase tu (pedido|solicitud|comprobante)|\bpase el pedido|llego al restaurante|llegaron al restaurante|\bhice llegar tu/;
const AM_NEGADO = /\bno (pude|pase|he pasado|logre)\b/;
function amAfirmaPase(texto) {
  const n = vmNorm(texto);
  return AM_PASE.test(n) && !AM_NEGADO.test(n);
}

// ----------------------------------------------------------------- constructores de payload
const amBase = (tipo) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '', type: tipo });
const amTexto = (cuerpo) => Object.assign(amBase('text'), { text: { preview_url: true, body: vmRecorte(cuerpo, 4000) } });
const amBotones = (cuerpo, botones) => Object.assign(amBase('interactive'), { interactive: {
  type: 'button', body: { text: vmRecorte(cuerpo, 1024) },
  action: { buttons: botones.map((b) => ({ type: 'reply', reply: { id: b.id, title: vmRecorte(b.title, 20) } })) },
} });
const amCta = (cuerpo, texto, url) => Object.assign(amBase('interactive'), { interactive: {
  type: 'cta_url', body: { text: vmRecorte(cuerpo, 1024) },
  action: { name: 'cta_url', parameters: { display_text: vmRecorte(texto, 20), url: url } },
} });
const amImagen = (link, caption) => Object.assign(amBase('image'), { image: { link: link, caption: vmRecorte(caption, 1024) } });
function amUrlWa(saludo) {
  const s = amSeguro(saludo) ? saludo : 'Hola, escribo desde el asistente virtual.';
  return 'https://wa.me/' + AM_REC + '?text=' + encodeURIComponent(s);
}
// Sin botón no se nombra el botón: se quita la oración que lo menciona (o, si trae «:», solo lo que sigue).
function amSinBoton(cuerpo) {
  const salida = [];
  for (const o of String(cuerpo).split(/(?<=[.!?])\s+/)) {
    if (!/bot[oó]n/i.test(o)) { salida.push(o); continue; }
    const i = o.indexOf(':');
    if (i > 0) salida.push(o.slice(0, i).trimEnd() + '.');
  }
  return salida.join(' ').trim() || 'Eso lo ve directamente el restaurante.';
}
// El botón que abre el chat del restaurante. La URL del plan se acepta si es https y no es el chat del
// propio cliente; si no, sale del número de recepción; sin número válido, texto sin la frase del botón.
function amEnlace(cuerpo, boton, urlDelPlan, tipoReporte) {
  let url = String(urlDelPlan || '').trim();
  const wa = /^https:\/\/wa\.me\/(\d+)/i.exec(url);
  if (!/^https:\/\/\S+$/i.test(url) || (wa && wa[1] === AM_FROM_DIG)) url = '';
  if (!url && AM_REC_OK) url = amUrlWa('Hola, escribo desde el asistente de ' + AM_NEGOCIO + '.');
  const titulo = amSeguro(boton) && String(boton || '').trim() ? String(boton).trim() : AM_GEN_BOTON;
  if (!url) {
    const solo = amSinBoton(cuerpo);
    return { payload: amTexto(solo), texto: solo, respaldo: solo, tipoReporte: 'text' };
  }
  return { payload: amCta(cuerpo, titulo, url), texto: cuerpo, respaldo: vmRecorte(cuerpo + '\n\nEscríbeles aquí: ' + url, 4000), tipoReporte: tipoReporte || 'interactive' };
}
function amGenerico(motivo) {
  AM_errores.push(motivo);
  return amEnlace(AM_GEN_CUERPO, AM_GEN_BOTON, '', 'interactive');
}

// ----------------------------------------------------------------- un mensaje del plan
let AM_qrRechazado = false;
function amQr(m, cuerpo) {
  const ped = AM_PLAN.pedido && typeof AM_PLAN.pedido === 'object' ? AM_PLAN.pedido : {};
  const cobro = AM_CFG.cobro && typeof AM_CFG.cobro === 'object' ? AM_CFG.cobro : {};
  const link = String(cobro.qrUrl || '').trim();
  const monto = Number(m.monto);
  const total = Number(ped.total);
  const pedidoId = String(ped.pedidoId || '');
  let motivo = '';
  if (cobro.activo !== true) motivo = 'cobro_no_activo';
  else if (!/^https:\/\/\S+$/i.test(link)) motivo = 'qr_sin_https';
  else if (!(monto > 0) || !isFinite(monto)) motivo = 'qr_sin_monto';
  else if (!(total > 0) || Math.round(monto * 100) !== Math.round(total * 100)) motivo = 'qr_monto_distinto_del_total';
  else if (!pedidoId) motivo = 'qr_sin_pedido';
  else if (m.referencia && String(m.referencia) !== pedidoId) motivo = 'qr_referencia_distinta';
  if (motivo) {
    AM_qrRechazado = true;
    return amGenerico('qr_rechazado: ' + motivo);
  }
  return {
    payload: amImagen(link, cuerpo), texto: cuerpo, respaldo: vmRecorte(cuerpo + '\n\nAbre el QR aquí: ' + link, 4000),
    tipoReporte: 'image', evento: 'qr_enviado', referencia: pedidoId, monto: Math.round(total * 100) / 100,
  };
}
function amArmarUno(m) {
  if (!m || typeof m !== 'object') return null;
  const tipo = String(m.tipo || 'texto');
  const cuerpo = String(m.cuerpo === undefined || m.cuerpo === null ? '' : m.cuerpo).trim();
  if (!cuerpo) { AM_errores.push('mensaje_sin_cuerpo: ' + tipo); return null; }
  if (!amSeguro(cuerpo)) return amGenerico('texto_reemplazado_por_palabra_prohibida');
  if (!AM_AVISO_SALIO && amAfirmaPase(cuerpo)) return amGenerico('pase_afirmado_sin_aviso_salido');
  const extra = {};
  if (typeof m.evento === 'string' && m.evento && m.evento !== 'qr_enviado') {
    extra.evento = m.evento;
    if (m.referencia) extra.referencia = String(m.referencia);
    if (Number.isFinite(Number(m.monto)) && m.monto !== null && m.monto !== '') extra.monto = Number(m.monto);
  }
  if (tipo === 'imagen') return amQr(m, cuerpo);
  if (tipo === 'enlace') {
    const boton = m.boton || (Array.isArray(m.botones) && m.botones[0] ? (m.botones[0].title || m.botones[0].titulo) : '');
    return Object.assign(amEnlace(cuerpo, boton, m.url, 'interactive'), extra);
  }
  if (tipo === 'botones') {
    const bs = (Array.isArray(m.botones) ? m.botones : []).map((b) => ({
      id: String((b && b.id) || ''), title: String((b && (b.title || b.titulo)) || '').trim(),
    })).filter((b) => b.id && b.id.length <= 256 && b.title).slice(0, 3);
    if (bs.some((b) => !amSeguro(b.title))) return amGenerico('boton_reemplazado_por_palabra_prohibida');
    if (bs.length) {
      return Object.assign({ payload: amBotones(cuerpo, bs), texto: cuerpo,
        respaldo: vmRecorte(cuerpo + '\n\nSi no ves los botones, escribe «menu» para volver al inicio.', 4000), tipoReporte: 'interactive' }, extra);
    }
  }
  return Object.assign({ payload: amTexto(cuerpo), texto: cuerpo, respaldo: cuerpo, tipoReporte: 'text' }, extra);
}

// ----------------------------------------------------------------- qué se manda
const AM_base = Array.isArray(AM_PLAN.mensajes) ? AM_PLAN.mensajes : [];
const AM_cond = AM_PLAN.condicionados && typeof AM_PLAN.condicionados === 'object'
  ? (AM_AVISO_SALIO ? AM_PLAN.condicionados.siSalio : AM_PLAN.condicionados.siNoSalio) : [];
const AM_pedidosMsg = AM_base.concat(Array.isArray(AM_cond) ? AM_cond : []);
const AM_lista = [];
for (const m of AM_pedidosMsg) {
  let d = null;
  try { d = amArmarUno(m); } catch (e) { d = amGenerico('mensaje_no_armado: ' + String(e && e.message).slice(0, 80)); }
  if (d) AM_lista.push(d);
}
if (AM_pedidosMsg.length && !AM_lista.length) AM_lista.push(amGenerico('ningun_mensaje_utilizable'));

const AM_salida = [];
for (const d of AM_lista) {
  const numero = AM_PRUEBA ? AM_TEL_PRUEBA : AM_FROM;
  if (!numero && !AM_PRUEBA) continue;
  d.payload.to = numero;
  const j = {
    para: numero, destino: 'cliente', payload: d.payload, texto: d.texto, respaldo: d.respaldo,
    tipoReporte: d.tipoReporte || null, reportar: !AM_PRUEBA && !!d.tipoReporte,
    phoneNumberId: AM_T.phoneNumberId || AM_CFG.phoneNumberId || AM_CFG.phoneNumberIdEsperado || '',
    waGraphVersion: AM_CFG.waGraphVersion || 'v26.0', from: AM_FROM, sinMensajes: false,
  };
  if (d.evento) j.evento = d.evento;
  if (d.referencia) j.referencia = d.referencia;
  if (d.monto !== undefined) j.monto = d.monto;
  AM_salida.push(j);
}

// ----------------------------------------------------------------- el estado: un solo lugar
const AM_claveValida = /^\d{6,20}$/.test(AM_FROM);
const AM_estadoNuevo = typeof AM_PLAN.estadoNuevo === 'string' ? { paso: AM_PLAN.estadoNuevo }
  : (AM_PLAN.estadoNuevo && typeof AM_PLAN.estadoNuevo === 'object' ? AM_PLAN.estadoNuevo : null);
const AM_sinQr = AM_qrRechazado && AM_estadoNuevo && AM_estadoNuevo.paso === 'esperando_comprobante';
let AM_estadoDespues = null;
if (AM_sd) {
  vmBarrer(AM_sd, AM_AHORA);
  if (AM_estadoNuevo && AM_claveValida && String(AM_PLAN.ruta || '') !== 'nada' && !AM_sinQr) {
    AM_estadoDespues = Object.assign(vmEstadoBase(), AM_estadoNuevo);
    vmEscribirEstado(AM_sd, AM_FROM, AM_estadoDespues, AM_AHORA);
  }
  // El pedido guardado vive 72 horas desde su última escritura.
  if (AM_sd.pedidos && typeof AM_sd.pedidos === 'object') {
    for (const k of Object.keys(AM_sd.pedidos)) {
      const v = AM_sd.pedidos[k];
      if (!v || !(AM_AHORA - Number(v.guardadoMs || 0) < AM_PEDIDOS_MS)) delete AM_sd.pedidos[k];
    }
  }
  const ped = AM_PLAN.pedido && typeof AM_PLAN.pedido === 'object' ? AM_PLAN.pedido : null;
  if (ped && ped.pedidoId && !AM_sinQr) {
    if (!AM_sd.pedidos || typeof AM_sd.pedidos !== 'object') AM_sd.pedidos = {};
    const id = String(ped.pedidoId);
    AM_sd.pedidos[id] = Object.assign({}, AM_sd.pedidos[id] || {}, ped, { guardadoMs: AM_AHORA });
  }
  // La marca de derivación se escribe SOLO si el aviso de derivación salió (hecho, no dicho).
  if (AM_sd.transferencias && typeof AM_sd.transferencias === 'object') {
    for (const k of Object.keys(AM_sd.transferencias)) {
      const v = AM_sd.transferencias[k];
      const marcas = (Array.isArray(v) ? v : [v]).filter((ms) => AM_AHORA - Number(ms) < AM_HORA_MS);
      if (marcas.length) AM_sd.transferencias[k] = marcas; else delete AM_sd.transferencias[k];
    }
  }
  if (AM_AVISO_SALIO && AM_claveValida && AM_tiposSalidos.indexOf('transferencia') >= 0) {
    if (!AM_sd.transferencias || typeof AM_sd.transferencias !== 'object') AM_sd.transferencias = {};
    AM_sd.transferencias[AM_FROM] = (AM_sd.transferencias[AM_FROM] || []).concat([AM_AHORA]);
  }
  // El tope de reservas por día (`rsDentroDelTope`) cuenta solo solicitudes cuyo aviso SALIÓ: `rsAnotar`
  // escribe en `sd`, y por eso lo llama este nodo, que es el único que escribe estado.
  if (AM_AVISO_SALIO && AM_claveValida && AM_tiposSalidos.indexOf('reserva') >= 0) rsAnotar(AM_sd, AM_FROM, AM_AHORA);
  // El tope diario cuenta los avisos que Meta aceptó (con `wamid`), no los armados.
  if (AM_wamids.length) avContar(AM_sd, AM_AHORA, AM_wamids.length);
}

// ----------------------------------------------------------------- el cierre (solo el primer ítem)
let AM_cierre = null;
const AM_c = AM_PLAN.cierre && typeof AM_PLAN.cierre === 'object' ? AM_PLAN.cierre : null;
if (AM_c) {
  if (AM_c.tipo !== 'registro') {
    AM_errores.push('cierre_de_tipo_no_permitido: ' + String(AM_c.tipo).slice(0, 30));
  } else {
    let detalle = vmLinea(AM_c.detalle, 300);
    if (!detalle || !amSeguro(detalle)) {
      AM_errores.push('detalle_de_cierre_reemplazado');
      detalle = 'Solicitud registrada: revisar el chat con el cliente.';
    }
    const ped = AM_PLAN.pedido && typeof AM_PLAN.pedido === 'object' ? AM_PLAN.pedido : {};
    AM_cierre = { tipo: 'registro', detalle: vmRecorte(detalle, 300), referencia: AM_wamids[0] || String(ped.pedidoId || '') || String(AM_T.mensajeId || '') };
  }
}

const AM_resumen = {
  ruta: String(AM_PLAN.ruta || 'nada'), estadoDespues: AM_estadoDespues, errores: AM_errores, avisoSalio: AM_AVISO_SALIO,
  avisosArmados: AM_armados.length, avisosConWamid: AM_wamids.length, qrRechazado: AM_qrRechazado,
  mensajesSalientes: AM_salida.length,
};
if (!AM_salida.length) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: AM_FROM,
    cierre: AM_cierre, resumen: AM_resumen, errores: AM_errores } }];
}
AM_salida[0].cierre = AM_cierre;
AM_salida[0].resumen = AM_resumen;
AM_salida[0].errores = AM_errores;
return AM_salida.map((j) => ({ json: j }));
