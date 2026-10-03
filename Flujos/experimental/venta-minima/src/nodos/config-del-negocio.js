// CONFIG DEL NEGOCIO: lo configurable del negocio, en UN solo nodo.
//
// LA CONSOLA MANDA, PERO NUNCA DEJA AL CLIENTE SIN RESPUESTA. `Traer configuración` devuelve la
// respuesta completa (codigo y cuerpo, `neverError`) y aca se decide con el codigo:
//   200 + tenantId -> configuracion del panel; sus valores PISAN a «Config base» y al respaldo;
//   409            -> SUSPENDIDO: respuesta valida, no un error;
//   otra           -> no se pudo saber -> respaldo local (SIN carta, sin QR, sin campanas) y
//                     `panelSinRespuesta: true`. Sin carta no se toma ningun pedido: se deriva.
//
// ORDEN DE LOS TEXTOS: panel > «Config base» > respaldo. Un marcador `REEMPLAZAR_*` sin
// reemplazar cuenta como vacio.
//
// LO QUE LLEGA COMO LO PIDE EL CONTRATO (§4.3 y ajustes):
//   - `areasExcluidas`, `palabrasExcluidas`, `areasSinDelivery`, `zonasReserva`: ARREGLOS (vienen como CSV);
//     `palabrasExcluidas` (lo que el negocio NO vende por WhatsApp: «helado», «cerveza»…) solo se lee de «Config base»;
//   - `horario`: el CSV crudo («lun=12:00-22:00,…»); lo convierte `vmHorario`;
//   - `prefijosPermitidos` y `destinatariosAviso`: CSV (los consumen `vmPrefijoPermitido` y `avDestinatarios`);
//   - `plantilla*`, `idioma*`, `formaPlantilla*` y `orden*` (`plantillaPedido`, `idiomaPlantillaPedido`, `ordenPedido`…): se
//     copian TODOS los de «Config base»; los posee T4;
//   - `pedidosActivo`, `reservasActivo`, `promosActivo`: valen `false` si faltan;
//   - `phoneNumberIdEsperado`: '' si es un marcador sin reemplazar (`Interpretar entrada` descarta todo);
//   - `cobro`: `cbCobroReal(cuerpo)`; si algo falla, apagado (plan B: sin QR);
//   - `aceptaDelivery` y `aceptaRetiroEnLocal`: solo se apagan con `false` en `venta` (`!== false`), el mismo criterio
//     del servidor y de `Plan del turno`: un panel sin esas claves acepta las dos modalidades. Con el panel sin
//     respuesta no se fijan (se desconocen) y `Plan del turno` deriva en vez de ofrecer delivery; con el comercio
//     suspendido van en `false`.
// EL MODO PRUEBA lo dijo `Carga de entrada` (solo si corrio «Entrada de prueba»).
const RESPALDO = {
  nombreNegocio: 'nuestro restaurante',
  nombreAsistente: '',
  nivelEmojis: 'pocos',
  direccion: '',
  horarioAtencion: '',
  moneda: 'BOB',
  numeroRecepcion: '',
  prefijosPermitidos: '591',
  mensajeComercioSuspendido: 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.',
  atencionMensajeFijo: 'Gracias por tu paciencia. Una persona del equipo va a continuar esta conversación.',
  estadoComercio: 'operativo',
  waGraphVersion: 'v26.0',
};
const COBRO_APAGADO = {
  activo: false, qrUrl: '', titular: '', banco: '', pendiente: false, monto: null, pedidoRef: null, vencidoHaceMin: null,
};

const carga = vmPrimero('Carga de entrada') || {};
const base = vmPrimero('Config base') || {};
const primero = $input.first();
const resp = (primero && primero.json) || {};
const codigo = Number(resp.statusCode);
let cuerpo = resp.body === undefined ? {} : resp.body;
if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
if (!cuerpo || typeof cuerpo !== 'object') cuerpo = {};

const util = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : undefined;
const soloLlenos = (o) => Object.fromEntries(Object.entries(o).filter((par) => par[1] !== undefined));
const marcador = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s.startsWith('REEMPLAZAR_') ? '' : s; };
const verdadero = (v) => v === true || v === 'true';
const objeto = (o) => (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};

// --- ATENCION: los umbrales de uso extendido (Analisis/27 §5) -----------------
const at = (codigo === 200 && cuerpo.atencion && typeof cuerpo.atencion === 'object') ? cuerpo.atencion : {};
const atencion = {
  atencionEstado: ['normal', 'operador', 'bloqueado'].indexOf(at.estado) >= 0 ? at.estado : 'normal',
  atencionMensajeFijo: util(at.mensajeFijo) || RESPALDO.atencionMensajeFijo,
  atencionAvisarRecepcion: ['operador', 'bloqueado'].indexOf(at.avisarRecepcion) >= 0 ? at.avisarRecepcion : '',
  atencionRespuestas: (typeof at.respuestasEnVentana === 'number' && Number.isFinite(at.respuestasEnVentana)) ? at.respuestasEnVentana : 0,
  atencionVenceEn: util(at.ventanaVenceEn) || '',
};

// --- LO DEL CLIENTE EN «Config base» ------------------------------------------
const CAMPOS_BASE = ['nombreNegocio', 'nombreAsistente', 'nivelEmojis', 'direccion', 'horarioAtencion', 'moneda',
  'mensajeComercioSuspendido', 'prefijosPermitidos'];
const deBase = {};
for (const k of CAMPOS_BASE) {
  const v = marcador(base[k]);
  if (v) deBase[k] = v;
}
// Las plantillas de aviso son por evento y configurables (`plantillaPedido`, `idiomaPlantillaPedido`,
// `plantillaReserva`, …): se copian todas las claves `plantilla*`, `idioma*`, `formaPlantilla*` y `orden*` con valor de texto.
const deBasePlantillas = {};
for (const k of Object.keys(base)) {
  // `formaPlantilla*`: la forma de la reserva y de la derivación (`cita` o `pedido`); `orden*` (`ordenPedido`, `ordenReserva`,
  // `ordenDerivacion`): el orden de las variables de la plantilla, que `avisos.js` lee de `cfg` (un orden inválido cae al de por omisión).
  if (/^(plantilla|idioma|formaPlantilla|orden)[A-Za-z0-9_]{0,60}$/.test(k)) {
    const v = marcador(base[k]);
    if (v && v.length <= 100) deBasePlantillas[k] = v;
  }
}
const csvLimpio = (v) => vmLista(v).join(',');
const horarioBase = (base.horario && typeof base.horario === 'object') ? base.horario : marcador(base.horario);
const deBaseDeReglas = {
  pedidosActivo: verdadero(base.pedidosActivo),
  reservasActivo: verdadero(base.reservasActivo),
  promosActivo: verdadero(base.promosActivo),
  areasExcluidas: vmLista(base.areasExcluidas),
  // Solo de «Config base» (como `areasExcluidas`): ni el panel ni la consola la tocan. Ausente = sin lista.
  palabrasExcluidas: vmLista(base.palabrasExcluidas),
  areasSinDelivery: vmLista(base.areasSinDelivery),
  zonasReserva: vmLista(base.zonasReserva),
  horario: horarioBase,
  maxPersonasReserva: vmEntero(base.maxPersonasReserva, 1, 500, 12),
  anticipacionReservaMin: vmEntero(base.anticipacionReservaMin, 0, 10080, 60),
  maxDiasReserva: vmEntero(base.maxDiasReserva, 1, 365, 30),
  topeReservasDia: vmEntero(base.topeReservasDia, 0, 1000, 3),
  topeAvisosDia: vmEntero(base.topeAvisosDia, 0, 100000, 150),
  topeTransferenciasHora: vmEntero(base.topeTransferenciasHora, 0, 1000, 1),
  topePedidosHora: vmEntero(base.topePedidosHora, 0, 1000, 6),
  destinatariosAviso: csvLimpio(base.destinatariosAviso),
  // INTERRUPTOR SOLO DE ENSAYO: se lee de «Config base» y NUNCA del panel (la consola no lo puede encender). Solo vale `true` o
  // «true»; cualquier otro valor es falso. `construir.mjs` lo deja únicamente en `ensayo-demo-a.json`: en producción no existe.
  avisarAlPropioNumero: verdadero(base.avisarAlPropioNumero),
  phoneNumberIdEsperado: marcador(base.phoneNumberIdEsperado),
  waGraphVersion: marcador(base.waGraphVersion) || RESPALDO.waGraphVersion,
};

// --- LO DEL PANEL ----------------------------------------------------------------
// Carta saneada: hasta 200 items, cada campo en una linea y acotado. `precio` es un numero o null
// (T2 descarta lo que no tiene precio numerico); `agotado` solo es true si el panel dijo true.
function carta(lista) {
  const salida = [];
  for (const it of (Array.isArray(lista) ? lista : [])) {
    if (salida.length >= 200) break;
    const o = objeto(it);
    const nombre = vmLinea(o.nombre, 120);
    if (!nombre) continue;
    const p = (typeof o.precio === 'number' || (typeof o.precio === 'string' && o.precio.trim() !== '')) ? Number(o.precio) : NaN;
    salida.push({
      id: vmLinea(o.id, 100),
      nombre: nombre,
      precio: Number.isFinite(p) && p >= 0 ? p : null,
      area: vmLinea(o.area, 60),
      descripcion: vmLinea(o.descripcion, 300),
      agotado: o.agotado === true,
    });
  }
  return salida;
}
// Campanas vigentes (solo viajan las aprobadas y en curso): {id, texto, inicio, fin}.
function campanas(lista) {
  const salida = [];
  for (const c of (Array.isArray(lista) ? lista : [])) {
    if (salida.length >= 20) break;
    const o = objeto(c);
    const texto = vmLinea(o.texto, 500);
    if (!texto) continue;
    salida.push({ id: vmLinea(o.id, 80), texto: texto, inicio: o.inicio === undefined ? '' : o.inicio, fin: o.fin === undefined ? '' : o.fin });
  }
  return salida;
}

let cfg;
if (codigo === 409) {
  cfg = Object.assign({}, RESPALDO, deBase, deBaseDeReglas, deBasePlantillas, atencion, {
    estadoComercio: 'suspendido',
    mensajeComercioSuspendido: util(cuerpo.mensajeCortesia) || deBase.mensajeComercioSuspendido || RESPALDO.mensajeComercioSuspendido,
    configDeLaConsola: false, panelDice: 'no operativo', panelSinRespuesta: false,
    catalogo: [], campanas: [], aceptaDelivery: false, aceptaRetiroEnLocal: false, cobro: COBRO_APAGADO,
  });
} else if (!(codigo === 200 && typeof cuerpo.tenantId === 'string')) {
  cfg = Object.assign({}, RESPALDO, deBase, deBaseDeReglas, deBasePlantillas, atencion, {
    configDeLaConsola: false, panelSinRespuesta: true, codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
    // Sin respuesta del panel NO se sabe qué modalidades acepta: no se fija ninguna. OJO: «falta = sí» valdría para el
    // servidor, pero aquí NO se puede leer como «hay delivery»: `Plan del turno` mira `panelSinRespuesta` y, con él en `true`,
    // ni ofrece ni afirma delivery ni confirma un pedido: deriva (aviso + botón).
    catalogo: [], campanas: [], cobro: COBRO_APAGADO,
  });
} else {
  const dn = objeto(cuerpo.datosDelNegocio);
  const op = objeto(cuerpo.operacion);
  const voz = objeto(cuerpo.voz);
  const venta = objeto(cuerpo.venta);
  const prefijosDelPanel = Array.isArray(op.prefijosPermitidos) ? op.prefijosPermitidos.map(vmDigitos).filter(Boolean).join(',') : '';
  const deLaConsola = soloLlenos({
    nombreNegocio: util(dn.nombreNegocio),
    direccion: util(dn.direccion),
    mensajeComercioSuspendido: util(dn.mensajeComercioSuspendido),
    nombreAsistente: util(voz.nombreAsistente),
    nivelEmojis: ['ninguno', 'pocos', 'muchos'].indexOf(voz.nivelEmojis) >= 0 ? voz.nivelEmojis : undefined,
    horarioAtencion: util(op.horarioAtencion),
    moneda: util(op.moneda),
    numeroRecepcion: vmDigitos(op.numeroRecepcion) || undefined,
    prefijosPermitidos: prefijosDelPanel || undefined,
  });
  const util2 = util(cuerpo.estadoComercio);
  const estadoComercio = util2 === 'activo' ? 'operativo' : (util2 ? 'suspendido' : 'operativo');
  let cobro = COBRO_APAGADO;
  try { cobro = Object.assign({}, COBRO_APAGADO, objeto(cbCobroReal(cuerpo))); } catch (e) { cobro = COBRO_APAGADO; }
  cfg = Object.assign({}, RESPALDO, deBase, deBaseDeReglas, deBasePlantillas, atencion, deLaConsola, {
    estadoComercio: estadoComercio, configDeLaConsola: true, panelSinRespuesta: false,
    catalogo: carta(cuerpo.catalogo),
    // El enlace vigente del catalogo web de ESTA conversacion (`catalogoWeb.enlace`, solo si el cuerpo pidio `catalogoCompleto`).
    // Aca solo se copia como texto: `Plan del turno` lo valida (https, host con dominio) antes de ofrecerlo; sin enlace, carta en texto.
    catalogoWebEnlace: util(objeto(cuerpo.catalogoWeb).enlace) || '',
    campanas: campanas(cuerpo.campanas),
    // Solo se apagan con `false`: la falta del dato es «sí», igual que en el servidor (`!== false`).
    aceptaDelivery: venta.aceptaDelivery !== false,
    aceptaRetiroEnLocal: venta.aceptaRetiroEnLocal !== false,
    cobro: cobro,
  });
}

// --- NUMERO DE RECEPCION: el del panel; si falta, el respaldo de «Config base» ---
// (un marcador sin reemplazar cuenta como vacio). Solo digitos: es el destino del boton.
let recepcion = vmDigitos(cfg.numeroRecepcion);
if (!recepcion) recepcion = vmDigitos(marcador(base.respaldoNumeroRecepcion) || marcador(base.numeroRecepcion));
cfg.numeroRecepcion = recepcion;
cfg.prefijosPermitidos = csvLimpio(String(cfg.prefijosPermitidos || '').split(',').map(vmDigitos)) || RESPALDO.prefijosPermitidos;

// --- MODO PRUEBA ---------------------------------------------------------------
const prueba = carga.prueba && carga.prueba.modoPrueba === true ? carga.prueba : null;

return [{ json: Object.assign({}, cfg, {
  phoneNumberId: String(carga.phoneNumberId || ''),
  modoPrueba: prueba !== null,
  telefonoDePrueba: prueba ? String(prueba.telefonoDePrueba || '') : '',
  enviarDeVerdad: prueba ? prueba.enviarDeVerdad === true : true,
}) }];
