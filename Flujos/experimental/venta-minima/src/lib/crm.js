// =============================================================================
// miniCRM DEL RESTAURANTE (prefijo `vmCrm` / `VM_CRM_`; la función principal es `vmProspectoCrm`)
// =============================================================================
// Lo que «Armar mensajes» calcula para la planilla del restaurante: UN prospecto por turno, a partir de HECHOS que ya ocurrieron (el plan del turno y el
// pedido guardado), nunca de lo que diga el modelo. Es JavaScript plano (sin require, URL, Buffer ni crypto) y se pega SOLO delante de «Armar mensajes»
// (`@@todo+sesion+crm:`), no en todos los nodos. Los 8 nodos de la planilla los genera el módulo `crm` (`ramaCrm`); la lógica de la fila (agregar o actualizar,
// no pisar al equipo, 48 h, neutralizar fórmulas) es del módulo y no se repite aquí. Aquí solo se decide QUÉ evento es el turno y QUÉ dice el prospecto.
//
// EVENTOS (una vez por evento; solo el primero que corresponde al turno, nunca dos filas por turno):
//   pedido       el pedido quedó confirmado (`pedido:*`: QR enviado o pedido sin QR)            -> Caliente, «Pedido»
//   reserva      la solicitud de reserva salió (`reserva:enviada`)                              -> Caliente, «Reserva»
//   comprobante  el cliente mandó el comprobante y ya hay un cotejo (`comprobante:<resultado>`) -> Caliente, «Comprobante»
//   derivacion   el cliente pasó con recepción Y el aviso salió (hecho)                         -> «Derivación a recepción»
//   eleccion     la persona entra a la familia de pasos `pedido*` o `reserva*` desde otra (o es el primer contacto de la ventana y ya está en una) -> Tibio, «Eligió»: «Pedido» o «Reserva»
//   contacto     primer mensaje de la ventana (24 h sin escribir)                               -> Tibio (Frío si lo primero que hizo fue ver la carta), sin «Eligió»
// SOLO CUENTA LO QUE SALIÓ: sin el aviso al local salido (`pasoSalio`), una reserva o un pedido sin QR / con QR vencido se rebaja a `eleccion` (O dice «Reserva» o «Pedido»; sin Caliente por compra ni resumen).
// O = la ÚLTIMA elección; P y Q guardan lo concretado y no se pisan entre sí.
// PRECEDENCIA: pedido > reserva > comprobante > derivacion > eleccion > contacto (un solo evento por turno).
// COLUMNAS DE Q'TACO (mapa del tenant, sin ampliar el contrato): O «Eligió» = lo que escogió (solo en pedido, reserva y eleccion; en blanco si no); P «Reserva» = «Enviada <fecha-hora>» SOLO si el aviso
// al local salió (`pasoSalio`); Q «Pedido» = «Registrado <fecha-hora>» con QR (o QR simulado), o sin QR / QR vencido SOLO si el aviso salió. Celda en blanco = no concretó (nunca «No»).
// COBRO REAL: el comprobante es «recibido» y los datos «coinciden», «no coinciden» o son «ilegible». NUNCA «pagado», «acreditado» ni «simulado»: quien confirma que entró
// la plata es el banco y el negocio. Un comprobante de un cobro simulado o ya cotejado NO es un evento.
// NO VAN a la hoja: dirección, referencia, ubicación, notas del cliente, líneas del pedido, imagen ni datos leídos del comprobante.
// MENSAJES: ninguno. Este código no envía nada; cualquier excepción la atrapa el `try/catch` de «Armar mensajes» y el turno responde igual.
const VM_CRM_VENTANA_MS = 24 * 60 * 60 * 1000;
const VM_CRM_NUEVO_MS = 48 * 60 * 60 * 1000;
const VM_CRM_VISTO_VIGENCIA_MS = 180 * 24 * 60 * 60 * 1000;
const VM_CRM_MAX_VISTOS = 5000;
// La fecha y hora de la hoja: AAAA-MM-DD HH:MM en hora de La Paz (UTC-4 fijo); mismo formato que `crmFechaHoraLaPaz` del módulo común, que no existe en «Armar mensajes».
function vmCrmFechaHora(ms) {
  const n = Number(ms);
  return ms === null || ms === undefined || !Number.isFinite(n) ? '' : new Date(n - 4 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
// La familia de un paso del estado: 'pedido' (pedido_*), 'reserva' (reserva_*) u '' (cualquier otro).
function vmCrmFamilia(paso) {
  const t = typeof paso === 'string' ? paso : '';
  return /^pedido(_|$)/.test(t) ? 'pedido' : /^reserva(_|$)/.test(t) ? 'reserva' : '';
}
const VM_CRM_COMPROBANTE = { cuadra: 'datos coinciden', no_cuadra: 'datos no coinciden', ilegible: 'ilegible', sin_cotejo: '' };

// ¿La planilla está encendida para este turno? Hay id y hoja (un marcador `REEMPLAZAR_*` ya llegó vacío desde «Config del negocio») y no es el modo prueba.
function vmCrmActiva(cfg, prueba) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return prueba !== true && String(c.planillaProspectosId || '').trim() !== '' && String(c.planillaProspectosHoja || '').trim() !== '';
}

// La clave con que se recuerda un teléfono en la memoria de n8n: un hash FNV-1a de 64 bits recortado a 53 (JavaScript puro), NUNCA el número en claro. No es un secreto (el espacio de números es chico):
// solo evita dejar teléfonos legibles en los datos del flujo.
function vmCrmClave(tel) {
  let h = 0xcbf29ce484222325n;
  const texto = String(tel === undefined || tel === null ? '' : tel).replace(/\D/g, '');
  for (let i = 0; i < texto.length; i++) h = ((h ^ BigInt(texto.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return 'h' + (h & ((1n << 53n) - 1n)).toString(16);
}

// El último mensaje visto de cada teléfono (memoria de n8n, `sd.crmVisto`, por `vmCrmClave`): de ahí salen el «primer contacto de la ventana» y las 48 h. Devuelve el instante ANTERIOR
// (o null si no había) y deja anotado el de ahora. Poda lo vencido (180 días) y limita a 5.000 teléfonos. Sin `sd` no anota nada y devuelve null.
function vmCrmMarcarVisto(sd, from, ahoraMs) {
  const ahora = Number(ahoraMs);
  const tel = String(from === undefined || from === null ? '' : from).replace(/\D/g, '');
  if (!sd || typeof sd !== 'object' || !Number.isFinite(ahora) || !tel) return null;
  if (!sd.crmVisto || typeof sd.crmVisto !== 'object' || Array.isArray(sd.crmVisto)) sd.crmVisto = {};
  const mapa = sd.crmVisto;
  const clave = vmCrmClave(tel);
  const previo = Object.prototype.hasOwnProperty.call(mapa, clave) && Number.isFinite(Number(mapa[clave])) ? Number(mapa[clave]) : null;
  mapa[clave] = ahora;
  const claves = Object.keys(mapa);
  for (const k of claves) if (!(ahora - Number(mapa[k]) < VM_CRM_VISTO_VIGENCIA_MS)) delete mapa[k];
  const vivas = Object.keys(mapa);
  if (vivas.length > VM_CRM_MAX_VISTOS) {
    vivas.sort((a, b) => Number(mapa[a]) - Number(mapa[b]));
    for (const k of vivas.slice(0, vivas.length - VM_CRM_MAX_VISTOS)) delete mapa[k];
  }
  return previo;
}

// Un nombre para la hoja: solo letras, espacios, apóstrofo y guion (sin emojis, dígitos ni signos de fórmula), hasta 60 caracteres.
function vmCrmNombre(v) {
  return typeof v === 'string' ? v.replace(/[^\p{L} '’-]/gu, '').replace(/\s{2,}/g, ' ').trim().slice(0, 60) : '';
}

// «N.º <código>, <n> ítems, Bs <total>, delivery|recojo» (+ «, comprobante recibido, datos coinciden|no coinciden|ilegible»). El total es el que CALCULÓ el código (`ped.total`).
function vmCrmResumen(ped, estadoComprobante) {
  const p = ped && typeof ped === 'object' ? ped : null;
  const partes = [];
  if (p) {
    const codigo = String(p.codigo === undefined || p.codigo === null ? '' : p.codigo).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    if (codigo) partes.push('N.º ' + codigo);
    const n = Number(p.nItems);
    if (Number.isInteger(n) && n > 0) partes.push(n + (n === 1 ? ' ítem' : ' ítems'));
    if (typeof p.total === 'number' && Number.isFinite(p.total) && p.total >= 0) partes.push('Bs ' + _pdBs(p.total));
    if (p.modalidad === 'delivery' || p.modalidad === 'recojo') partes.push(p.modalidad);
  }
  if (estadoComprobante !== null && estadoComprobante !== undefined) partes.push('comprobante recibido' + (estadoComprobante ? ', ' + estadoComprobante : ''));
  return partes.join(', ');
}

/**
 * El prospecto del turno, o null si el turno no es un evento.
 * d = { from, plan (la salida de «Plan del turno»), pedidoEstado (el pedido del estado, si el plan no lo trae), nombrePerfil, avisoSalio (bool: salió el aviso de transferencia),
 *       ahoraMs, anteriorMs (el último mensaje visto de este teléfono, o null), pasoAntes / pasoDespues (el paso del estado antes y después del turno), pasoSalio (bool: el aviso al local salió) }
 */
function vmProspectoCrm(d) {
  const x = d && typeof d === 'object' ? d : {};
  const plan = x.plan && typeof x.plan === 'object' ? x.plan : {};
  const ahora = Number(x.ahoraMs);
  const telefono = String(x.from === undefined || x.from === null ? '' : x.from).replace(/\D/g, '');
  if (!telefono || !Number.isFinite(ahora)) return null;
  const anterior = Number.isFinite(Number(x.anteriorMs)) && x.anteriorMs !== null ? Number(x.anteriorMs) : null;
  const ruta = String(plan.ruta === undefined || plan.ruta === null ? '' : plan.ruta);
  const ped = plan.pedido && typeof plan.pedido === 'object' && plan.pedido.pedidoId ? plan.pedido
    : (x.pedidoEstado && typeof x.pedidoEstado === 'object' && x.pedidoEstado.pedidoId ? x.pedidoEstado : null);
  let evento = '';
  let estadoComprobante = null;
  const comp = /^comprobante:([a-z_]+)$/.exec(ruta);
  if (/^pedido:/.test(ruta)) evento = 'pedido';
  else if (ruta === 'reserva:enviada') evento = 'reserva';
  else if (comp && Object.prototype.hasOwnProperty.call(VM_CRM_COMPROBANTE, comp[1])) { evento = 'comprobante'; estadoComprobante = VM_CRM_COMPROBANTE[comp[1]]; }
  else if (/^transferir:/.test(ruta) && x.avisoSalio === true) evento = 'derivacion';
  const primerContacto = anterior === null || !(ahora - anterior < VM_CRM_VENTANA_MS);
  // Solo cuenta lo que de verdad salió: una reserva, o un pedido sin QR / con QR vencido, sin el aviso al local salido se rebaja a «elección» (O dice qué eligió; sin Caliente por compra ni resumen).
  const salio = x.pasoSalio === true;
  let eligioDe = '';
  if (!salio && (evento === 'reserva' || ruta === 'pedido:sin_qr' || ruta === 'pedido:qr_vencido')) { eligioDe = evento === 'reserva' ? 'Reserva' : 'Pedido'; evento = 'eleccion'; }
  const famDespues = vmCrmFamilia(x.pasoDespues);
  const famEligio = famDespues !== '' && (vmCrmFamilia(x.pasoAntes) !== famDespues || primerContacto);
  if (!evento && famEligio) evento = 'eleccion';
  if (!evento && primerContacto) evento = 'contacto';
  if (!evento) return null;

  const compra = evento === 'pedido' || evento === 'reserva' || evento === 'comprobante';
  const nombrePerfil = vmCrmNombre(x.nombrePerfil);
  const nombreEntrega = vmCrmNombre(ped && ped.entrega && typeof ped.entrega === 'object' ? ped.entrega.nombre : (ped ? ped.nombre : ''));
  const p = {
    telefono: telefono,
    // El nombre del perfil de WhatsApp si existe; si no, el que el cliente dio al pedir. El módulo no pisa con el del perfil un nombre ya dado.
    nombre: nombrePerfil || nombreEntrega,
    nombreDePerfil: nombrePerfil !== '',
    // 48 h sin mensajes: fila NUEVA (el módulo la agrega en vez de actualizar la más reciente). Sin registro previo lo decide el módulo con «Última interacción» (`sinRegistroPrevio`).
    nuevoContacto: anterior !== null && ahora - anterior > VM_CRM_NUEVO_MS,
    // Sin registro previo (la memoria se pierde al republicar; los contactos anteriores al CRM nunca la tuvieron): el módulo usa «Última interacción» de la fila más reciente para decidir las 48 h.
    sinRegistroPrevio: anterior === null,
    // PEDIDO = FILA NUEVA (Andres, 08/11/2026): `ventaEvento` y `codigoPedido` le dicen al módulo que el evento es un pedido o un comprobante y de QUÉ pedido (N.º). Un `pedido` agrega fila
    // siempre (salvo completar una elección en curso o el mismo N.º ya anotado); un `comprobante` actualiza la fila de SU pedido.
    ventaEvento: evento === 'pedido' || evento === 'comprobante' ? evento : '',
    codigoPedido: (evento === 'pedido' || evento === 'comprobante') && ped ? String(ped.codigo === undefined || ped.codigo === null ? '' : ped.codigo).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) : '',
    // Frío = lo primero que hizo fue ver la carta y no avanzó (solo en el primer contacto); Caliente = compra (pedido, reserva o comprobante); Tibio = escribió.
    senales: { inicioCompra: compra, preguntoPrecioYCerro: (evento === 'contacto' || evento === 'eleccion') && primerContacto && ruta === 'carta' },
    // «Eligió»: solo pedido, reserva o elección; en comprobante, derivación y contacto va vacío (un valor vacío no se escribe, no borra lo anotado).
    quePidio: evento === 'pedido' ? 'Pedido' : evento === 'reserva' ? 'Reserva' : evento === 'eleccion' ? (eligioDe || (famDespues === 'reserva' ? 'Reserva' : 'Pedido')) : '',
    ultimaInteraccionMs: ahora,
  };
  // «Reserva» (P): la solicitud salió al local. «Pedido» (Q): QR enviado, o sin QR / QR vencido con el aviso salido. Nunca pagado, acreditado, simulado ni verificado.
  if (evento === 'reserva' && salio) p.diaPreferido = 'Enviada ' + vmCrmFechaHora(ahora);
  if (evento === 'pedido' && (ruta === 'pedido:qr' || ruta === 'pedido:qr_simulado' || ((ruta === 'pedido:sin_qr' || ruta === 'pedido:qr_vencido') && salio))) p.horarioPreferido = 'Registrado ' + vmCrmFechaHora(ahora);
  if (evento === 'derivacion') p.derivacion = true;
  if (evento === 'pedido') p.resumenVenta = vmCrmResumen(ped, null);
  else if (evento === 'comprobante') p.resumenVenta = vmCrmResumen(ped, estadoComprobante);
  else if (evento === 'reserva') {
    const codigo = String(plan.aviso && plan.aviso.datos && plan.aviso.datos.codigo !== undefined ? plan.aviso.datos.codigo : '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    p.resumenVenta = codigo ? 'Reserva N.º ' + codigo : 'Reserva solicitada';
  }
  return p;
}
