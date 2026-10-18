// CONFIG DEL NEGOCIO: lo configurable del negocio, en UN solo nodo.
//
// LA CONSOLA MANDA, PERO NUNCA DEJA AL CLIENTE SIN RESPUESTA. `Traer configuración` devuelve la respuesta completa (código y cuerpo, `neverError`) y aquí se decide con el código:
//   200 + tenantId -> configuración del panel; sus valores PISAN a los de `Config base`;
//   409            -> SUSPENDIDO: es una respuesta válida, no un error;
//   otra           -> no se pudo saber -> respaldo de `Config base`.
//
// DE LA CONSOLA salen SOLO (PR-1): el nombre del negocio, el número de recepción (el de Rubén), el nombre del asistente, el trato y la atención (los umbrales de uso extendido).
// El catálogo y el cobro entran en PR-2; el precio vive solo en el catálogo. Este nodo es una COPIA ADAPTADA de `chat-novuchat/src/nodos/config-del-negocio.js` (HUECO declarado en
// PROPIO.md): se quitaron la oferta (planes y cargos), la planilla y los datos del chat, y se conservaron BYTE A BYTE los bloques de lectura de la respuesta, de atención y del modo prueba.

const base = cnPrimero('Config base') || {};
const carga = cnPrimero('Carga de entrada') || {};
const primero = $input.first();
const resp = (primero && primero.json) || {};
const codigo = Number(resp.statusCode);
let cuerpo = resp.body === undefined ? {} : resp.body;
if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
if (!cuerpo || typeof cuerpo !== 'object') cuerpo = {};

const util = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : undefined;
const soloLlenos = (o) => Object.fromEntries(Object.entries(o).filter((par) => par[1] !== undefined));
// Un marcador sin llenar (`REEMPLAZAR_…`) no es un valor.
const valor = (v) => (typeof v === 'string' && !/^REEMPLAZAR_/.test(v.trim())) ? v.trim() : '';
// Texto de la consola que va a un mensaje: una línea, sin corchetes ni llaves ni los delimitadores del turno.
const linea = (v, max) => String(v === undefined || v === null ? '' : v)
  .replace(/<<<|>>>/g, '').replace(/[\[\]{}]/g, '')
  .replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

// --- ATENCIÓN: los umbrales de uso extendido (el servidor decide; este nodo obedece) ---
const at = (codigo === 200 && cuerpo.atencion && typeof cuerpo.atencion === 'object') ? cuerpo.atencion : {};
const atencion = {
  atencionEstado: ['normal', 'operador', 'bloqueado'].indexOf(at.estado) >= 0 ? at.estado : 'normal',
  atencionMensajeFijo: util(at.mensajeFijo)
    || 'Gracias por tu paciencia. Para atenderte mejor, una persona del equipo va a continuar esta conversación.',
  atencionAvisarRecepcion: ['operador', 'bloqueado'].indexOf(at.avisarRecepcion) >= 0 ? at.avisarRecepcion : '',
  atencionRespuestas: (typeof at.respuestasEnVentana === 'number' && Number.isFinite(at.respuestasEnVentana)) ? at.respuestasEnVentana : 0,
  atencionVenceEn: util(at.ventanaVenceEn) || '',
};

// --- Lo de `Config base` (respaldo) ---
const deBase = {
  nombreNegocio: linea(valor(base.nombreNegocio), 60),
  numeroRecepcion: cnDigitos(valor(base.numeroRecepcion)),
  prefijosPermitidos: valor(base.prefijosPermitidos) || '591',
  mensajeComercioSuspendido: linea(valor(base.mensajeComercioSuspendido), 300)
    || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.',
  nombreAsistente: '',
  trato: 'tu',
};

let cfg;
if (codigo === 409) {
  cfg = Object.assign({}, deBase, atencion, {
    estadoComercio: 'suspendido',
    // Texto neutro del panel: no menciona pagos ni deudas.
    mensajeComercioSuspendido: linea(util(cuerpo.mensajeCortesia), 300) || deBase.mensajeComercioSuspendido,
    configDeLaConsola: false, panelDice: 'no operativo',
  });
} else if (!(codigo === 200 && typeof cuerpo.tenantId === 'string')) {
  cfg = Object.assign({}, deBase, atencion, {
    estadoComercio: 'operativo', configDeLaConsola: false, panelSinRespuesta: true, codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
  });
} else {
  const dn = cuerpo.datosDelNegocio && typeof cuerpo.datosDelNegocio === 'object' ? cuerpo.datosDelNegocio : {};
  const op = cuerpo.operacion && typeof cuerpo.operacion === 'object' ? cuerpo.operacion : {};
  const voz = cuerpo.voz && typeof cuerpo.voz === 'object' ? cuerpo.voz : {};
  const recepcion = util(op.numeroRecepcion);
  const deLaConsola = soloLlenos({
    nombreNegocio: util(dn.nombreNegocio) ? linea(dn.nombreNegocio, 60) : undefined,
    // Solo dígitos: es el destino del botón a una persona.
    numeroRecepcion: recepcion ? (cnDigitos(recepcion) || undefined) : undefined,
    prefijosPermitidos: Array.isArray(op.prefijosPermitidos) && op.prefijosPermitidos.length ? op.prefijosPermitidos.join(',') : undefined,
  });
  const estadoDeLaConsola = util(cuerpo.estadoComercio);
  cfg = Object.assign({}, deBase, deLaConsola, atencion, {
    // Mandan aunque vengan vacíos: el nombre del asistente. El trato es una frase de la consola (`usted`, `tú`, `vos`, neutro): solo «usted» cambia el trato.
    nombreAsistente: linea(voz.nombreAsistente, 40),
    trato: /usted/i.test(String(voz.tratamiento || '')) ? 'usted' : 'tu',
    estadoComercio: estadoDeLaConsola === 'activo' ? 'operativo' : (estadoDeLaConsola ? 'suspendido' : 'operativo'),
    configDeLaConsola: true,
  });
}

// --- el MODO PRUEBA ---
const prueba = carga.prueba && carga.prueba.modoPrueba === true ? carga.prueba : null;
// S7: `telefonosDePrueba` (opcional, en «Config base») limita a qué números puede dirigirse una ejecución de PRUEBA: si el teléfono pedido no está en la lista, no se envía nada. Sin lista
// (o con el marcador sin llenar), no se restringe.
const permitidos = valor(base.telefonosDePrueba).split(',').map((x) => cnDigitos(x)).filter((x) => x.length >= 6);
const telefonoDePrueba = prueba ? cnDigitos(prueba.telefonoDePrueba) : '';
const telefonoPermitido = permitidos.length === 0 || permitidos.indexOf(telefonoDePrueba) >= 0;

return [{ json: Object.assign({}, cfg, {
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/.test(String(base.waGraphVersion || '')) ? String(base.waGraphVersion) : 'v26.0',
  phoneNumberId: String(carga.phoneNumberId || ''),
  // El modo prueba. Solo lo trae `Carga de entrada` cuando corrió «Entrada de prueba».
  modoPrueba: prueba !== null,
  telefonoDePrueba: prueba && telefonoPermitido ? telefonoDePrueba : '',
  enviarDeVerdad: prueba ? prueba.enviarDeVerdad === true && telefonoPermitido : true,
}) }];
