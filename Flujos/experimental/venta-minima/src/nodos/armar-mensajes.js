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
//   - mandar un QR sin enlace https (solo con dominio con nombre: sin IP, sin `@` y sin puerto), sin monto, o con
//     un monto distinto del total del pedido que calculó el código (el del plan, o el del estado al reenviarlo): en ese
//     caso no se guarda `esperando_comprobante`. El evento `qr_enviado` solo lo lleva el QR que el plan pidió como evento:
//     «Reenviar QR» lleva monto y referencia, pero NO el evento (no reabre el cobro); el QR simulado sin rótulo en el pie
//     («simulado» y «no cobra»), o el real con un rótulo de prueba, tampoco sale (los dos modos son excluyentes);
//   - ofrecer algo distinto de pasar con el restaurante (el botón que abre su chat): la URL del botón vale SOLO si es
//     `https://wa.me/<dígitos>` y los dígitos son el número de recepción de la configuración; si no, se arma de ahí;
//   - bloquear un mensaje por el texto de un TERCERO: la dirección, la referencia, las notas y el nombre llegan ya
//     saneados por `Plan del turno` (las palabras prohibidas en «…»); esta red queda para el texto fijo y el compuesto.
//
// ESTADO QUE ESCRIBE (solo este nodo): el estado por teléfono; los pedidos guardados (72 h, como mucho 500: al pasar el
// tope se expulsan los más antiguos); y las marcas de aviso por hora, SOLO si el aviso salió: `transferencias` y
// `avisosPedido` (pedido y comprobante), que `Armar avisos` lee para sus topes. Un aviso que falló no deja marca.
//
// BOTÓN «MENÚ» (03/10): todo mensaje interactivo con botones de respuesta que tenga lugar (menos de tres) sale con `m|menu`
// como último botón (salvo el propio menú: `sinMenu`), para que el cliente siempre pueda volver al inicio; el mensaje con botón de enlace (uno solo) lleva al
// final «Si quieres seguir con tu pedido o tu reserva, escribe «menú».». Solo en la conversación (`Plan del turno`): el aviso fijo
// de «Uso extendido» y el de «Comercio no operativo» no llegan a `Decidir turno`, así que no ofrecen «menú». No agrega mensajes.
// `nivelEmojis` (la voz del negocio): `ninguno` quita los emojis de todo texto al cliente, `pocos` deja a lo sumo uno por
// mensaje (el primero) y `muchos` no toca nada.
//
// MENSAJES QUE AGREGA: ninguno por sí mismo. (Un resumen de pedido de más de 1.024 caracteres lo parte `Plan del turno`
// en un texto y un mensaje corto con el total: es el único caso en el flujo que agrega un mensaje.)
//
// MODO PRUEBA: los mensajes al cliente van a `telefonoDePrueba`, sin prefijo y sin reportar.
const AM_PLAN = vmPrimero('Plan del turno') || vmPrimero('Uso extendido') || vmPrimero('Comercio no operativo') || {};
const AM_CFG = vmCfg();
// ¿Es la conversación (`Plan del turno`)? El aviso fijo de «Uso extendido» y el de «Comercio no operativo» no pasan por
// `Decidir turno`: ahí escribir «menú» no hace nada y no se ofrece (solo se ofrece lo que se cumple).
const AM_CONVERSA = !!vmPrimero('Plan del turno');
const AM_T = vmPrimero('Interpretar entrada') || {};
const AM_AHORA = Number(AM_T.ahoraMs) || Date.now();
const AM_FROM = String(AM_T.from || '');
const AM_FROM_DIG = vmDigitos(AM_FROM);
const AM_NEGOCIO = String(AM_CFG.nombreNegocio || 'el negocio');
const AM_PRUEBA = AM_CFG.modoPrueba === true;
const AM_TEL_PRUEBA = String(AM_CFG.telefonoDePrueba || '');
// El número que envía: en modo prueba, SIEMPRE el de la configuración (el `phone_number_id` del cuerpo de la prueba se ignora).
const AM_NUMERO_ID = AM_PRUEBA ? String(AM_CFG.phoneNumberIdEsperado || '') : (AM_T.phoneNumberId || AM_CFG.phoneNumberId || AM_CFG.phoneNumberIdEsperado || '');
const AM_REC = vmDigitos(AM_CFG.numeroRecepcion);
const AM_REC_OK = AM_REC.length >= 8 && AM_REC.length <= 15 && AM_REC !== AM_FROM_DIG;
const AM_GEN_CUERPO = AM_CONVERSA
  ? 'Esto prefiero que lo vea una persona del restaurante 🙂. Toca «Escribir al local» para hablar con ellos. '
    + 'Si quieres seguir con tu pedido o tu reserva, escribe «menú».'
  : 'Eso lo ve directamente el restaurante. Toca el botón para escribirles.';
const AM_SEGUIR = 'Si quieres seguir con tu pedido o tu reserva, escribe «menú».';
const AM_GEN_BOTON = 'Escribir al local';
const AM_HORA_MS = 60 * 60 * 1000;
const AM_PEDIDOS_MS = 72 * AM_HORA_MS;
const AM_MAX_PEDIDOS = 500; // pedidos guardados: al pasar el tope se expulsan los más antiguos
const AM_MAX_MARCAS = 500; // teléfonos con marcas de aviso por hora
const AM_sd = vmSd();

const AM_avisosArmados = vmTodos('Armar avisos');
const AM_errores = (AM_avisosArmados[0] && Array.isArray(AM_avisosArmados[0].errores)
  ? AM_avisosArmados[0].errores : (Array.isArray(AM_PLAN.errores) ? AM_PLAN.errores : [])).slice();

// ----------------------------------------------------------------- ¿salió el aviso? (por hecho)
// Solo cuenta un `messages[0].id` en la respuesta de Meta: un error, una respuesta vacía o un nodo
// que no corrió no cuentan. Y solo el de una PLANTILLA o un DETALLE: la imagen del comprobante tiene su
// propio `wamid` pero no es «el aviso» (si Meta la rechaza, falla ese ítem y nada más). El orden de
// `Enviar aviso` es el de los avisos armados que pasaron el IF.
// Un `wamid.SIMULADO-n` (el de `Simular aviso`) cuenta SOLO en modo prueba: fuera de él no es un aviso salido, venga del
// nodo que venga (L2: en producción ese nodo ni siquiera existe, y esta es la segunda cerradura).
function amWamid(j) {
  const m = j && j.messages;
  const id = Array.isArray(m) && m[0] && typeof m[0].id === 'string' && m[0].id ? m[0].id : '';
  return !AM_PRUEBA && /^wamid\.SIMULADO-/.test(id) ? '' : id;
}
const amEsImagen = (a) => !!a && (a.clase === 'imagen' || (a.clase === undefined && a.payload && a.payload.type === 'image'));
const AM_armados = AM_avisosArmados.filter((i) => i && i.sinAviso !== true && i.payload);
const AM_enviados = vmTodos('Enviar aviso').concat(AM_PRUEBA ? vmTodos('Simular aviso') : []); // el wamid simulado cuenta solo en modo prueba
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
// Sin botón no se nombra el botón: se quita la oración que lo menciona, o que nombra «Escribir al local» (o, si trae «:», solo
// lo que sigue).
function amSinBoton(cuerpo) {
  const salida = [];
  for (const o of String(cuerpo).split(/(?<=[.!?])\s+/)) {
    if (!/bot[oó]n|escribir al local/i.test(o)) { salida.push(o); continue; }
    const i = o.indexOf(':');
    if (i > 0) salida.push(o.slice(0, i).trimEnd() + '.');
  }
  return salida.join(' ').trim() || 'Eso lo ve directamente el restaurante.';
}
// El botón que abre el chat del restaurante. La URL del plan se acepta si es https y no es el chat del
// propio cliente; si no, sale del número de recepción; sin número válido, texto sin la frase del botón.
// Emojis: `ninguno` los quita (con el espacio que los precede) y `pocos` deja el primero de cada mensaje.
const AM_EMOJI = '\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic}\\uFE0F?)*';
function amEmojis(texto) {
  const nivel = String(AM_CFG.nivelEmojis || 'pocos');
  if (nivel === 'muchos') return texto;
  let vistos = 0;
  return texto.replace(new RegExp('[ \\t]*(' + AM_EMOJI + ')', 'gu'), (m) => (nivel !== 'ninguno' && ++vistos === 1 ? m : '')).replace(/^[ \t]+/, '');
}
// Un solo botón (el de enlace): el camino de vuelta al menú va escrito, solo en la conversación y sin repetirlo.
function amConSeguir(cuerpo) {
  return !AM_CONVERSA || cuerpo.indexOf(AM_SEGUIR) >= 0 ? cuerpo : cuerpo + ' ' + AM_SEGUIR;
}
// `sinMenu`: el mensaje no manda a «menú» (con un comprobante en espera el menú no está disponible).
function amEnlace(cuerpoCrudo, boton, urlDelPlan, tipoReporte, sinMenu) {
  const cuerpo = sinMenu === true ? cuerpoCrudo : amConSeguir(cuerpoCrudo);
  // La URL del plan vale SOLO si es `https://wa.me/<8 a 15 dígitos>` (con `?text=` opcional) y esos dígitos son EXACTAMENTE
  // el número de recepción de la configuración (que no es el del propio cliente). Cualquier otra cosa se descarta.
  let url = String(urlDelPlan || '').trim();
  const wa = /^https:\/\/wa\.me\/(\d{8,15})(?:\?text=[A-Za-z0-9%._~!*'()-]*)?$/.exec(url);
  if (!wa || !AM_REC_OK || wa[1] !== AM_REC) url = '';
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
  // El mensaje genérico también respeta `nivelEmojis` (con `ninguno` no sale el 🙂).
  return amEnlace(amEmojis(AM_GEN_CUERPO).trim(), AM_GEN_BOTON, '', 'interactive');
}

// ----------------------------------------------------------------- un mensaje del plan
let AM_qrRechazado = false;
// Defensa en profundidad (la guarda real es `construir.mjs`, que fija la etiqueta exacta): el QR SIMULADO solo sale si su imagen es el QR de
// demostración rotulado del repositorio (anfitrión, repositorio y ruta). Un enlace distinto, aunque sea https, no sale con la marca «SIMULADO».
const AM_QR_SIMULADO = /^https:\/\/raw\.githubusercontent\.com\/segurolotengopy\/NovuChat\/v\d+\.\d+\.\d+\/Demo-Recursos\/qr-demo\.png$/;
// La URL del QR: solo https, con un dominio con nombre (nada de IP ni de «localhost»), sin usuario (`@`) ni puerto.
function amUrlSegura(u) {
  const s = String(u === undefined || u === null ? '' : u).trim();
  return s.length <= 2000 && /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[/?#][^\s<>"'@]*)?$/i.test(s);
}
// El titular de la cuenta real es un dato del comercio («Pruebas SRL», «Demostraciones del Sur»): no es un rótulo y no debe trabar su QR.
function sinTitular(cuerpoN, titular) {
  const t = vmNorm(titular);
  return t ? cuerpoN.split(t).join(' ') : cuerpoN;
}
function amQr(m, cuerpo) {
  // El pedido contra el que se compara el monto: el del plan (el turno que creó el QR) o, al reenviarlo, el del estado
  // nuevo (el que quedó esperando el comprobante). Nunca el que diga el propio mensaje.
  const estado = AM_PLAN.estadoNuevo && typeof AM_PLAN.estadoNuevo === 'object' ? AM_PLAN.estadoNuevo : {};
  const ped = AM_PLAN.pedido && typeof AM_PLAN.pedido === 'object' ? AM_PLAN.pedido
    : (estado.pedido && typeof estado.pedido === 'object' ? estado.pedido : {});
  const cobro = AM_CFG.cobro && typeof AM_CFG.cobro === 'object' ? AM_CFG.cobro : {};
  const link = String(cobro.qrUrl || '').trim();
  const monto = Number(m.monto);
  const total = Number(ped.total);
  const pedidoId = String(ped.pedidoId || '');
  const simulado = cobro.modo === 'simulado';
  const cuerpoN = vmNorm(cuerpo);
  let motivo = '';
  if (cobro.activo === true && simulado) motivo = 'cobro_en_dos_modos';
  else if (cobro.activo !== true && !simulado) motivo = 'cobro_no_activo';
  else if (!amUrlSegura(link)) motivo = 'qr_sin_https';
  else if (!(monto > 0) || !isFinite(monto)) motivo = 'qr_sin_monto';
  else if (!(total > 0) || Math.round(monto * 100) !== Math.round(total * 100)) motivo = 'qr_monto_distinto_del_total';
  else if (!pedidoId) motivo = 'qr_sin_pedido';
  else if (m.referencia && String(m.referencia) !== pedidoId) motivo = 'qr_referencia_distinta';
  else if (simulado && !AM_QR_SIMULADO.test(link)) motivo = 'qr_simulado_imagen_no_permitida';
  else if (simulado && !(/simulad/.test(cuerpoN) && /no cobra/.test(cuerpoN))) motivo = 'qr_simulado_sin_rotulo';
  else if (!simulado && /simulad|simulacr|demostracion|prueba/.test(sinTitular(cuerpoN, cobro.titular))) motivo = 'qr_real_con_rotulo_simulado';
  if (motivo) {
    AM_qrRechazado = true;
    return amGenerico('qr_rechazado: ' + motivo);
  }
  const salida = {
    payload: amImagen(link, cuerpo), texto: cuerpo, respaldo: vmRecorte(cuerpo + '\n\nAbre el QR aquí: ' + link, 4000),
    tipoReporte: 'image', referencia: pedidoId, monto: Math.round(total * 100) / 100,
  };
  // El evento `qr_enviado` (abre el cobro en el servidor) solo lo lleva el QR que el plan pidió como evento: «Reenviar QR»
  // lleva monto y referencia pero NO el evento, porque el servidor ya abrió ese cobro.
  if (m.evento === 'qr_enviado') salida.evento = 'qr_enviado';
  return salida;
}
function amArmarUno(m) {
  if (!m || typeof m !== 'object') return null;
  const tipo = String(m.tipo || 'texto');
  const cuerpo = amEmojis(String(m.cuerpo === undefined || m.cuerpo === null ? '' : m.cuerpo).trim()).trim();
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
  // El enlace a la carta (página del catálogo): el botón abre ESA dirección, no el chat del local. Vale solo con una URL segura
  // (https, dominio con nombre, sin usuario ni puerto); sin ella no se promete una carta que el cliente no puede abrir: se pasa con el local.
  if (tipo === 'enlace' && m.catalogo === true) {
    const url = String(m.url === undefined || m.url === null ? '' : m.url).trim();
    if (!amUrlSegura(url)) return amGenerico('catalogo_sin_enlace_seguro');
    const pedido = m.boton || (Array.isArray(m.botones) && m.botones[0] ? (m.botones[0].title || m.botones[0].titulo) : '');
    const titulo = amSeguro(pedido) && String(pedido || '').trim() ? String(pedido).trim() : 'Ver la carta';
    const cuerpoCta = amConSeguir(cuerpo);
    return Object.assign({
      payload: amCta(cuerpoCta, titulo, url), texto: cuerpoCta, respaldo: vmRecorte(cuerpoCta + '\n\nVer la carta: ' + url, 4000), tipoReporte: 'interactive',
    }, extra);
  }
  if (tipo === 'enlace') {
    const boton = m.boton || (Array.isArray(m.botones) && m.botones[0] ? (m.botones[0].title || m.botones[0].titulo) : '');
    return Object.assign(amEnlace(cuerpo, boton, m.url, 'interactive', m.sinMenu === true), extra);
  }
  if (tipo === 'botones') {
    const bs = (Array.isArray(m.botones) ? m.botones : []).map((b) => ({
      id: String((b && b.id) || ''), title: String((b && (b.title || b.titulo)) || '').trim(),
    })).filter((b) => b.id && b.id.length <= 256 && b.title).slice(0, 3);
    if (bs.some((b) => !amSeguro(b.title))) return amGenerico('boton_reemplazado_por_palabra_prohibida');
    const idMenu = vmIdDeBoton('m', 'menu');
    if (AM_CONVERSA && m.sinMenu !== true && bs.length && bs.length < 3 && idMenu && !bs.some((b) => b.id === idMenu)) bs.push({ id: idMenu, title: 'Menú' });
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
    phoneNumberId: AM_NUMERO_ID,
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
    // Como mucho 500 pedidos guardados: pasado el tope se expulsan los más antiguos (el recién escrito nunca).
    const claves = Object.keys(AM_sd.pedidos);
    if (claves.length > AM_MAX_PEDIDOS) {
      claves.sort((a, b) => Number(AM_sd.pedidos[a].guardadoMs || 0) - Number(AM_sd.pedidos[b].guardadoMs || 0));
      for (const k of claves.slice(0, claves.length - AM_MAX_PEDIDOS)) delete AM_sd.pedidos[k];
    }
  }
  // Las marcas de aviso por hora se escriben SOLO si el aviso salió (hecho, no dicho): `transferencias` (derivaciones)
  // y `avisosPedido` (avisos de pedido y de comprobante). `Armar avisos` las lee para aplicar `topeTransferenciasHora` y
  // `topePedidosHora`. Se podan las de más de una hora y no hay más de 500 teléfonos con marca.
  for (const mapa of ['transferencias', 'avisosPedido']) {
    const m = AM_sd[mapa];
    if (!m || typeof m !== 'object') continue;
    for (const k of Object.keys(m)) {
      const v = m[k];
      const marcas = (Array.isArray(v) ? v : [v]).filter((ms) => AM_AHORA - Number(ms) < AM_HORA_MS);
      if (marcas.length) m[k] = marcas; else delete m[k];
    }
  }
  const amMarcar = (mapa) => {
    if (!AM_sd[mapa] || typeof AM_sd[mapa] !== 'object') AM_sd[mapa] = {};
    const m = AM_sd[mapa];
    m[AM_FROM] = (Object.prototype.hasOwnProperty.call(m, AM_FROM) && Array.isArray(m[AM_FROM]) ? m[AM_FROM] : []).concat([AM_AHORA]);
    const claves = Object.keys(m);
    if (claves.length > AM_MAX_MARCAS) {
      claves.sort((a, b) => Number(m[a][m[a].length - 1]) - Number(m[b][m[b].length - 1]));
      for (const k of claves.slice(0, claves.length - AM_MAX_MARCAS)) delete m[k];
    }
  };
  if (AM_AVISO_SALIO && AM_claveValida && AM_tiposSalidos.indexOf('transferencia') >= 0) amMarcar('transferencias');
  if (AM_AVISO_SALIO && AM_claveValida && (AM_tiposSalidos.indexOf('pedido') >= 0 || AM_tiposSalidos.indexOf('comprobante') >= 0)) amMarcar('avisosPedido');
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
    // La referencia del cierre es ESTABLE (B0): la que pide el plan (la de la reserva) o el `pedidoId`, nunca el `wamid` del aviso
    // (cambia con cada ejecucion y un doble toque dejaria dos cierres). El servidor deduplica por tipo y referencia. Solo si el
    // plan no trae ninguna se cae al id del mensaje que se procesa.
    const refPlan = typeof AM_c.referencia === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(AM_c.referencia) ? AM_c.referencia : '';
    AM_cierre = { tipo: 'registro', detalle: vmRecorte(detalle, 300), referencia: refPlan || String(ped.pedidoId || '') || String(AM_T.mensajeId || '') };
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
