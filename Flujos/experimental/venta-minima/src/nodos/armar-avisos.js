// ARMAR AVISOS (Venta mínima v0): primera de las dos etapas de envío (DD6). Arma lo que va AL
// RESTAURANTE (plantilla y, con la ventana abierta, el texto con el detalle) y sale un ítem por
// aviso: {para, rol, payload, respaldo, esPlantilla, sinAviso, tipoAviso, ...}. NO escribe estado
// (eso es solo de `Armar mensajes`) y NO nombra ninguna plantilla: las plantillas son por evento,
// son configurables y las posee `avisos.js` (`avPlan`, que envuelve a `avArmar`). Sin plantilla
// configurada para el evento no se inventa un nombre: ningún ítem de plantilla sale y se anota el error.
//
// LO QUE NUNCA HACE:
//   - dejar salir un texto o un parámetro de plantilla con una palabra de `VM_PROHIBIDAS`
//     («validado», «pagado», «ya lo preparan»…): se reemplaza por uno genérico y se anota;
//   - armar un aviso si ya se alcanzó el tope LOCAL DE CAÍDA (PR-4b): el tope diario, una derivación (`topeTransferenciasHora`, def. 1) o un
//     aviso de pedido o de comprobante (`topePedidosHora`, def. 6) del mismo teléfono dentro de la hora. Con el servidor sano esos topes son CUPOS del
//     servidor (`Consumir cupos`, que cuelga de `¿Hay avisos?` y decide si salen); las marcas locales solo crecen cuando el servidor falló y el aviso
//     salió igual (fail-open). Un tope en 0 significa «ninguno»: no se arma ese aviso;
//   - mandar un aviso al propio número de quien escribe (lo excluye `avDestinatarios`), salvo con el interruptor SOLO DE ENSAYO
//     `avisarAlPropioNumero` (true exacto, solo en `ensayo-demo-a.json`; ver `construir.mjs`).
//
// Cada ítem lleva su `clase` (`plantilla`, `detalle` o `imagen`, la que pone `avPlan`): `Armar mensajes`
// cuenta «el aviso salió» solo con el `wamid` de una plantilla o de un detalle, nunca con la imagen.
//
// LOS CUPOS PEDIDOS AL SERVIDOR (PR-4b): el PRIMER ítem lleva `cupos` = { numero, cuerpo, asentar }: el cuerpo de `comprometer` que manda `Consumir cupos` (un espacio NUEVO por turno,
// `vmc-<ejecución>` o `vmcp-<ejecución>` en la prueba, versionLeida 0, estado null, venceEnMin 1: no toca el estado de la conversación) y el de `asentar` que `Confirmar envío` manda si
// NINGÚN aviso fue aceptado por Meta. Cupos: `avisos` (comercio, día, cantidad = mensajes armados), más `transferencias` (contacto, hora, 1; el comprobante exento no) o
// `pedidos` (contacto, hora, 1). Todo o nada: un aviso de varios mensajes que no cabe en el día se niega completo. Tope = min(configurado, 1000) (ningún cupo es límite comercial).
//
// SIEMPRE emite al menos un ítem: con `sinAviso: true` cuando no hay nada que avisar, para que
// el flujo siga hasta `Armar mensajes`. El PRIMER ítem lleva `errores`.
//
// MODO PRUEBA: todo va a `telefonoDePrueba`, con el prefijo «[al restaurante]».
const AA_PLAN = vmPrimero('Plan del turno') || vmPrimero('Uso extendido') || vmPrimero('Comercio no operativo') || vmPrimero('Sin estado') || {};
const AA_CFG = vmCfg();
const AA_T = vmPrimero('Interpretar entrada') || {};
const AA_AHORA = Number(AA_T.ahoraMs) || Date.now();
const AA_FROM = String(AA_T.from || '');
const AA_PRUEBA = AA_CFG.modoPrueba === true;
// El número que envía: en modo prueba, SIEMPRE el de la configuración (el `phone_number_id` del cuerpo de la prueba se ignora).
const AA_NUMERO_ID = AA_PRUEBA ? String(AA_CFG.phoneNumberIdEsperado || '') : (AA_T.phoneNumberId || AA_CFG.phoneNumberId || AA_CFG.phoneNumberIdEsperado || '');
const AA_TEL_PRUEBA = vmDigitos(AA_CFG.telefonoDePrueba);
const AA_PREFIJO = '[al restaurante] ';
const AA_TIPOS = ['pedido', 'comprobante', 'reserva', 'transferencia'];
const AA_GENERICO_TEXTO = 'Hay un pedido o una consulta de un cliente. Revisen el chat con el cliente para ver el detalle.';
const AA_GENERICO_PIE = 'Comprobante enviado por el cliente.';
const AA_HORA_MS = 60 * 60 * 1000;
const AA_errores = (Array.isArray(AA_PLAN.errores) ? AA_PLAN.errores : []).slice();
const AA_sd = vmSd();
// AVISO YA ENVIADO (PR-4a, I1): si el compromiso del estado falló DESPUÉS de un aviso de pedido o de comprobante, el estado no avanzó y el cliente puede repetir el mismo botón: el aviso de ese
// pedido no se manda dos veces. `Soltar mensajes` anota `tipo:pedidoId` (el comprobante, `comprobante:pedidoId:medio:resultado`) en `sd.avisosHuerfanos` (residuo de PR-4b) SOLO cuando el compromiso falló; con el estado avanzado no hace falta.
const AA_YA = [];
const AA_CLAVES_YA = [];
// La marca lleva el TELÉFONO (`teléfono|clave`): `pedidoId` es corto y el mapa es del comercio; un cliente no puede tapar el aviso de otro.
function aaYaAvisado(clave) {
  const m = AA_sd && AA_sd.avisosHuerfanos && typeof AA_sd.avisosHuerfanos === 'object' ? AA_sd.avisosHuerfanos : null;
  const llave = AA_FROM + '|' + clave;
  // Compatibilidad (72 h): las marcas anotadas antes de PR-4a llevan la clave SIN el teléfono; se aceptan hasta que venzan por sí solas.
  const k = m && clave ? (Object.prototype.hasOwnProperty.call(m, llave) ? llave : (Object.prototype.hasOwnProperty.call(m, clave) ? clave : null)) : null;
  const ms = k !== null ? Number(m[k]) : NaN;
  return Number.isFinite(ms) && AA_AHORA - ms < 72 * AA_HORA_MS && AA_AHORA - ms >= 0;
}

// Lo que sale a la red nunca coincide con la red de palabras prohibidas. Se revisa el texto tal cual y
// normalizado (sin tildes), y se trata como PREDICADO: solo `true` pasa.
function aaSeguro(x) {
  const s = String(x === undefined || x === null ? '' : x);
  if (!s) return true;
  return vmTextoSeguro(s) === true && !VM_PROHIBIDAS.test(vmNorm(s));
}

// ------------------------------------------------------------------ avisos pedidos
const aaPedidos = [];
function aaPedir(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return;
  if (AA_TIPOS.indexOf(String(a.tipo)) < 0) { AA_errores.push('aviso_de_tipo_desconocido: ' + String(a.tipo).slice(0, 40)); return; }
  const huella = JSON.stringify(a);
  if (aaPedidos.some((x) => JSON.stringify(x) === huella)) return;
  aaPedidos.push(a);
}
if (Array.isArray(AA_PLAN.aviso)) AA_PLAN.aviso.forEach(aaPedir); else aaPedir(AA_PLAN.aviso);
if (Array.isArray(AA_PLAN.avisos)) AA_PLAN.avisos.forEach(aaPedir);

// Topes por teléfono y por hora. Las marcas (en ms) las escribe `Armar mensajes` SOLO cuando el aviso salió:
// `sd.transferencias[from]` (derivaciones) y `sd.avisosPedido[from]` (avisos de pedido y de comprobante).
// El tope sale de la configuración; un 0 se respeta (ningún aviso), solo la falta del dato usa el valor por omisión.
function aaTope(valor, porOmision) {
  if (valor === undefined || valor === null || valor === '') return porOmision;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : porOmision;
}
function aaTopeAlcanzado(clave, tope) {
  const mapa = AA_sd && AA_sd[clave] && typeof AA_sd[clave] === 'object' ? AA_sd[clave] : null;
  const marcas = mapa && Object.prototype.hasOwnProperty.call(mapa, AA_FROM) ? mapa[AA_FROM] : null;
  const lista = Array.isArray(marcas) ? marcas : (marcas ? [marcas] : []);
  return lista.filter((ms) => AA_AHORA - Number(ms) < AA_HORA_MS && AA_AHORA - Number(ms) >= 0).length >= tope;
}

// Lo que `avArmar` necesita y el plan no trajo se completa con el pedido que el plan guarda y con la
// entrada del turno: `codigo`, `nombre`, `telefono` (segunda guarda para no avisar a quien escribe),
// `direccion`, `referencia`, `coordenadas` (la ubicación compartida, en su propio campo) y `ubicacion` ({lat, lng}, solo números: de ella sale el enlace al mapa), `mediaId` (solo el del comprobante de este turno), `diferencias`, `motivo`.
// Lo que trae el plan manda.
function aaDatos(a) {
  const ped = AA_PLAN.pedido && typeof AA_PLAN.pedido === 'object' ? AA_PLAN.pedido : {};
  const d = a.datos && typeof a.datos === 'object' ? a.datos : {};
  const base = {
    codigo: d.codigo || ped.codigo || vmCodigoCorto(AA_AHORA), from: AA_FROM,
    nombre: d.nombre || ped.nombre || d.nombrePerfil || AA_T.nombrePerfil || '',
    telefono: d.telefono || d.from || AA_FROM, ahoraMs: AA_AHORA,
  };
  for (const k of ['lineas', 'total', 'modalidad', 'direccion', 'referencia', 'coordenadas', 'ubicacion', 'pedidoId', 'diferencias', 'motivo']) {
    if (ped[k] !== undefined) base[k] = ped[k];
  }
  const media = d.mediaId || ped.mediaId || (String(a.tipo) === 'comprobante' ? AA_T.mediaId : '');
  if (media) base.mediaId = media;
  return Object.assign(base, d);
}

// ------------------------------------------------------------------ armar
const AA_items = [];
const AA_cupoTipos = []; // 'transferencias' | 'pedidos': los cupos por hora que este turno pide (una vez cada uno)
let AA_destinatarios = [];
let AA_armar = aaPedidos.length > 0;
if (AA_armar && AA_sd && !avDentroDelTopeDiario(AA_sd, AA_AHORA, aaTope(AA_CFG.topeAvisosDia, 150))) {
  AA_errores.push('tope_diario_de_avisos: no se arman avisos hasta mañana');
  AA_armar = false;
}
if (AA_armar && !AA_sd) AA_errores.push('sin_datos_estaticos: no se pudo comprobar el tope de avisos');
if (AA_armar) {
  try {
    AA_destinatarios = avDestinatarios(AA_CFG.destinatariosAviso, AA_FROM, AA_CFG.prefijosPermitidos || '591', AA_CFG.avisarAlPropioNumero === true) || [];
  } catch (e) {
    AA_destinatarios = [];
    AA_errores.push('destinatarios_ilegibles: ' + String(e && e.message).slice(0, 80));
  }
  if (!AA_destinatarios.length) { AA_errores.push('sin_destinatarios_de_aviso'); AA_armar = false; }
}

// El respaldo, si lo hay, es un payload Graph completo (con `to`); un texto se envuelve.
function aaRespaldo(r, numero) {
  if (!r) return null;
  if (typeof r === 'string') {
    return { messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'text', text: { preview_url: false, body: r.slice(0, 4000) } };
  }
  if (typeof r === 'object') { r.to = numero; return r; }
  return null;
}
// Revisa el payload: texto y parámetros de plantilla. Devuelve false si hubo que reemplazar algo.
function aaLimpiar(payload, etiqueta) {
  let limpio = true;
  if (payload.type === 'text' && payload.text) {
    if (!aaSeguro(payload.text.body)) { payload.text.body = AA_GENERICO_TEXTO; limpio = false; AA_errores.push('texto_de_aviso_reemplazado: ' + etiqueta); }
  } else if (payload.type === 'image' && payload.image && typeof payload.image.caption === 'string') {
    if (!aaSeguro(payload.image.caption)) { payload.image.caption = AA_GENERICO_PIE; limpio = false; AA_errores.push('pie_de_imagen_reemplazado: ' + etiqueta); }
  } else if (payload.type === 'template' && payload.template && Array.isArray(payload.template.components)) {
    for (const c of payload.template.components) {
      // El parámetro de un BOTÓN (la ubicación «lat%2Clon» de `pedido_lista_mapa`) lo arma `avisos.js` solo con números y lo valida con su forma
      // exacta: no es texto del cliente ni se lee como frase, y cambiarlo por «—» rompería el enlace. Solo se revisan los del cuerpo.
      if (!c || !Array.isArray(c.parameters) || c.type === 'button') continue;
      c.parameters.forEach((p, i) => {
        if (p && typeof p.text === 'string' && !aaSeguro(p.text)) {
          p.text = i === 0 ? 'consulta de cliente' : '—';
          limpio = false;
          AA_errores.push('parametro_de_plantilla_reemplazado: ' + etiqueta + ' {{' + (i + 1) + '}}');
        }
      });
    }
  }
  return limpio;
}
function aaPrefijar(payload) {
  if (payload.type === 'text' && payload.text) payload.text.body = (AA_PREFIJO + payload.text.body).slice(0, 4000);
  else if (payload.type === 'image' && payload.image) payload.image.caption = (AA_PREFIJO + (payload.image.caption || '')).trim().slice(0, 1024);
  else if (payload.type === 'template' && payload.template && Array.isArray(payload.template.components)) {
    const c = payload.template.components.find((x) => x && Array.isArray(x.parameters) && x.parameters.length && typeof x.parameters[0].text === 'string');
    if (c) c.parameters[0].text = (AA_PREFIJO + c.parameters[0].text).slice(0, 500);
  }
}

if (AA_armar) {
  for (const a of aaPedidos) {
    const tipo = String(a.tipo);
    // Una derivación `comprobante: true` (la foto de un comprobante que no se pudo revisar por el cambio de modo de cobro) NO es una consulta: el tope
    // de derivaciones por hora no la suprime (un pago real no puede quedar sin avisar porque el cliente ya había escrito).
    if (tipo === 'transferencia' && !(a.datos && a.datos.comprobante === true) && aaTopeAlcanzado('transferencias', aaTope(AA_CFG.topeTransferenciasHora, 1))) {
      AA_errores.push('derivacion_repetida: ya se avisó una derivación de este teléfono en la última hora');
      continue;
    }
    if ((tipo === 'pedido' || tipo === 'comprobante') && aaTopeAlcanzado('avisosPedido', aaTope(AA_CFG.topePedidosHora, 6))) {
      AA_errores.push('tope_pedidos_hora: ya se avisaron demasiados pedidos de este teléfono en la última hora');
      continue;
    }
    const datos = aaDatos(a);
    // LA CLAVE se calcula UNA sola vez, aquí, y viaja en cada ítem (`claveAviso`): `Armar mensajes` y `Soltar mensajes` usan esta misma, no la recalculan (con el cobro simulado el plan trae `mediaId: ''`
    // y el medio sale de la entrada del turno: dos cálculos distintos nunca coincidían).
    const clave = (tipo === 'pedido' || tipo === 'comprobante')
      ? vmClaveAviso(tipo, datos.pedidoId || '', datos.mediaId || (tipo === 'comprobante' ? AA_T.mediaId : '') || '', datos.resultado || '') : '';
    if (clave && aaYaAvisado(clave)) {
      AA_errores.push('aviso_ya_enviado: ' + tipo + ' del pedido ' + String(datos.pedidoId).slice(0, 60));
      AA_YA.push(tipo);
      AA_CLAVES_YA.push(clave);
      continue;
    }
    // Un comprobante ya cotejado no se vuelve a avisar (el cliente solo lee «Ya tengo el comprobante»).
    if (tipo === 'comprobante' && datos.resultado === 'ya_cotejado') { AA_errores.push('sin_aviso_ya_cotejado'); continue; }
    // UN AVISO POR PEDIDO, SALVO QUE CAMBIE EL RESULTADO (decisiones de Andres, 07/11/2026). Lo decide `Plan del turno`, que no pide el aviso de un comprobante cuyo
    // resultado ya se avisó (`comprobanteAvisadoResultado`, escrito solo con un `wamid` real). Esta es la segunda barrera: si igual llegara, no se arma y NO cuenta como
    // aviso salido (el cliente nunca lee «ya lo pasé» sin un aviso de este turno).
    const pedPlan = AA_PLAN.pedido && typeof AA_PLAN.pedido === 'object' ? AA_PLAN.pedido : {};
    if (tipo === 'comprobante' && Number(pedPlan.comprobanteAvisadoMs) > 0 && String(pedPlan.pedidoId || '') === String(datos.pedidoId || '')
      && String(pedPlan.comprobanteAvisadoResultado || '') !== '' && String(pedPlan.comprobanteAvisadoResultado) === String(datos.resultado || '')) {
      AA_errores.push('aviso_de_comprobante_mismo_resultado: ' + String(datos.pedidoId).slice(0, 60));
      continue;
    }
    let crudo = null;
    try {
      // `avPlan` trae también los errores (p. ej. `plantilla_no_configurada_<evento>`) y respeta el cupo del día.
      crudo = avPlan(tipo, datos, AA_destinatarios, AA_CFG, AA_sd, AA_AHORA);
    } catch (e) {
      AA_errores.push('aviso_no_armado: ' + tipo + ': ' + String(e && e.message).slice(0, 80));
      continue;
    }
    // `avPlan` da `{items, errores}`; si alguna versión devuelve solo la lista, también se acepta.
    if (crudo && !Array.isArray(crudo) && Array.isArray(crudo.items)) {
      if (Array.isArray(crudo.errores)) crudo.errores.forEach((m) => AA_errores.push(String(m)));
      crudo = crudo.items;
    }
    if (!Array.isArray(crudo) || !crudo.length) { AA_errores.push('aviso_sin_contenido: ' + tipo); continue; }
    // Qué cupo por hora cuenta este aviso: la derivación (salvo la del comprobante, exenta como en el tope local) o el pedido/comprobante; la reserva no tiene (su tope es el del día, en el bloque del teléfono).
    const cupoHora = (tipo === 'transferencia' && !(a.datos && a.datos.comprobante === true)) ? 'transferencias' : ((tipo === 'pedido' || tipo === 'comprobante') ? 'pedidos' : '');
    let aporto = false;
    for (const it of crudo) {
      if (!it || !it.payload || typeof it.payload !== 'object') { AA_errores.push('aviso_sin_payload: ' + tipo); continue; }
      const numero = AA_PRUEBA ? AA_TEL_PRUEBA : vmDigitos(it.para);
      if (!numero) { AA_errores.push('aviso_sin_destino: ' + tipo); continue; }
      const payload = it.payload;
      payload.to = numero;
      const respaldo = aaRespaldo(it.respaldo, numero);
      aaLimpiar(payload, tipo);
      if (respaldo) aaLimpiar(respaldo, tipo + ' (respaldo)');
      if (AA_PRUEBA) { aaPrefijar(payload); if (respaldo) aaPrefijar(respaldo); }
      const clase = ['plantilla', 'detalle', 'imagen'].indexOf(it.clase) >= 0 ? it.clase
        : (payload.type === 'image' ? 'imagen' : (it.esPlantilla === true ? 'plantilla' : 'detalle'));
      AA_items.push({
        para: numero, rol: String(it.rol || ''), payload: payload, respaldo: respaldo, esPlantilla: it.esPlantilla === true,
        clase: clase, sinAviso: false, tipoAviso: tipo, claveAviso: clave, phoneNumberId: AA_NUMERO_ID,
        waGraphVersion: AA_CFG.waGraphVersion || 'v26.0', from: AA_FROM,
      });
      aporto = true;
    }
    if (aporto && cupoHora && AA_cupoTipos.indexOf(cupoHora) < 0) AA_cupoTipos.push(cupoHora);
  }
}

// El cuerpo de los cupos. Sin teléfono válido, sin autorización de la prueba (`telefonosDePrueba`) o sin nada que avisar: null (`Consumir cupos` manda un cuerpo vacío que el servidor rechaza: falla y se aplica el tope local).
function aaCuposDelTurno(cantidadAvisos) {
  if (!cantidadAvisos || !ssTelefonoDeSesion(AA_FROM) || !ssDesdeAutorizado(AA_FROM)) return null;
  const ejec = ssEjecucion($execution.id);
  const espacio = ((ssEsPrueba() ? 'vmcp-' : 'vmc-') + ejec.toLowerCase().replace(/[^a-z0-9-]/g, '-')).slice(0, 32);
  const tope = (v, def) => Math.min(aaTope(v, def), 1000);
  const cupos = [{ clave: 'avisos', alcance: 'comercio', periodo: 'dia', cantidad: Math.min(Math.max(cantidadAvisos, 1), 20), tope: tope(AA_CFG.topeAvisosDia, 150) }];
  if (AA_cupoTipos.indexOf('transferencias') >= 0) cupos.push({ clave: 'transferencias', alcance: 'contacto', periodo: 'hora', cantidad: 1, tope: tope(AA_CFG.topeTransferenciasHora, 1) });
  if (AA_cupoTipos.indexOf('pedidos') >= 0) cupos.push({ clave: 'pedidos', alcance: 'contacto', periodo: 'hora', cantidad: 1, tope: tope(AA_CFG.topePedidosHora, 6) });
  const idCompromiso = ssIdCompromiso($execution.id, 'cup');
  const base = { v: 1, espacio: espacio, canal: 'wa', ejecucion: ejec };
  return {
    numero: ssNumeroHeader(),
    cuerpo: { telefono: AA_FROM, sesion: Object.assign({}, base, { accion: 'comprometer', idCompromiso: idCompromiso, versionLeida: 0, estado: null, venceEnMin: 1, cupos: cupos }) },
    asentar: { telefono: AA_FROM, sesion: Object.assign({}, base, { accion: 'asentar', idCompromiso: idCompromiso }) },
  };
}

if (!AA_items.length) {
  return [{ json: {
    para: '', rol: '', payload: null, respaldo: null, esPlantilla: false, sinAviso: true, tipoAviso: '',
    phoneNumberId: AA_NUMERO_ID,
    waGraphVersion: AA_CFG.waGraphVersion || 'v26.0', from: AA_FROM, errores: AA_errores, yaAvisado: AA_YA, clavesYa: AA_CLAVES_YA,
  } }];
}
// La cantidad del cupo `avisos` cuenta los mensajes de aviso al local (plantilla y detalle); la imagen del comprobante acompaña al aviso y no es otro aviso.
AA_items[0].cupos = aaCuposDelTurno(AA_items.filter((j) => j.clase !== 'imagen').length);
AA_items[0].errores = AA_errores;
AA_items[0].yaAvisado = AA_YA;
AA_items[0].clavesYa = AA_CLAVES_YA;
return AA_items.map((j) => ({ json: j }));
