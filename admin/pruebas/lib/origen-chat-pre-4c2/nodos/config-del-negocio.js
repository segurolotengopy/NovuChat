// CONFIG DEL NEGOCIO: lo configurable del negocio, en UN solo nodo.
//
// LA CONSOLA MANDA, PERO NUNCA DEJA AL PROSPECTO SIN RESPUESTA. `Traer configuración` devuelve la respuesta completa (código y cuerpo, `neverError`) y aquí se decide con el código:
//   200 + tenantId -> configuración del panel; sus valores PISAN a los de `Config base`;
//   409            -> SUSPENDIDO: es una respuesta válida, no un error;
//   otra           -> no se pudo saber -> respaldo de `Config base`, sin precios ni imagen de planes (el flujo no los inventa).
//
// DE LA CONSOLA salen SOLO: los precios (`cargosUnicos` y `planes`), la imagen de planes (`archivoPlanes`), el número de recepción, el nombre del asistente, el estilo de emojis,
// el trato y la atención (los umbrales de uso extendido). LOS RUBROS NO: la lista de la consola puede estar desajustada con la del documento comercial, y este chat tiene la suya.
//
// LO PROPIO DE ESTE FLUJO (las instrucciones del documento, los rubros con sus puntos clave, los cierres exactos, las frases de respaldo, los textos fijos y el modelo) viene del
// archivo de datos `admin/scripts/datos/chat-novuchat/novuchat.json` y el constructor lo inyecta en la línea marcada de abajo (`@@datos`): debe aparecer exactamente una vez.
const CH_DATOS = null; // @@datos

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
// Texto de la consola que va al prompt o a un mensaje: una línea, sin corchetes ni llaves ni los delimitadores del turno.
const linea = (v, max) => String(v === undefined || v === null ? '' : v)
  .replace(/<<<|>>>/g, '').replace(/[\[\]{}]/g, '')
  .replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const lista = (v) => Array.isArray(v) ? v : [];
const precio = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000) ? v : undefined;
const NIVELES = ['ninguno', 'pocos', 'muchos'];
const PERIODOS = ['mes', 'anio', 'unico'];

// La oferta de la consola que este chat usa: SOLO precios e imagen de planes. Cada valor se valida aquí también: ante la duda gana el respaldo, y un elemento mal formado se descarta.
function limpiarOferta(ob) {
  const planes = lista(ob.planes).map((p) => ({
    nombre: linea(p && p.nombre, 40), precioUsd: precio(p && p.precioUsd), periodo: PERIODOS.indexOf(p && p.periodo) >= 0 ? p.periodo : '',
  })).filter((p) => p.nombre && p.precioUsd !== undefined && p.periodo).slice(0, 12);
  const cargosUnicos = lista(ob.cargosUnicos).map((c) => ({
    nombre: linea(c && c.nombre, 40), precioUsd: precio(c && c.precioUsd), desde: !!(c && c.desde === true),
  })).filter((c) => c.nombre && c.precioUsd !== undefined).slice(0, 6);
  // EL ARCHIVO DE PLANES SOLO DESDE EL ALMACENAMIENTO DE LA CONSOLA: https, el host exacto de Firebase Storage o de Cloud Storage y la ruta enseguida (sin usuario antes del host).
  // Por expresión y no con `URL`: el nodo Code de n8n no tiene ese global.
  const ap = ob.archivoPlanes && typeof ob.archivoPlanes === 'object' ? ob.archivoPlanes : null;
  const url = ap ? String(ap.url === undefined || ap.url === null ? '' : ap.url).trim() : '';
  const archivoPlanes = ap && /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\/[^\s@\\"'<>{}]+$/.test(url) && (ap.tipo === 'pdf' || ap.tipo === 'imagen')
    ? { url: url, tipo: ap.tipo, nombreArchivo: linea(ap.nombreArchivo, 80) || 'Planes.pdf' } : null;
  return { planes: planes, cargosUnicos: cargosUnicos, archivoPlanes: archivoPlanes };
}

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
const idPlanilla = (v) => (/^[A-Za-z0-9_-]{25,100}$/.test(valor(v)) ? valor(v) : '');
const deBase = {
  nombreNegocio: linea(valor(base.nombreNegocio), 60),
  numeroRecepcion: cnDigitos(valor(base.numeroRecepcion)),
  plantillaAviso: /^[a-z0-9_]{1,64}$/.test(valor(base.plantillaAviso)) ? valor(base.plantillaAviso) : 'solicitud_contacto',
  idiomaPlantillaAviso: /^[a-z]{2}(_[A-Z]{2})?$/.test(valor(base.idiomaPlantillaAviso)) ? valor(base.idiomaPlantillaAviso) : 'es',
  nivelEmojis: NIVELES.indexOf(base.nivelEmojis) >= 0 ? base.nivelEmojis : 'muchos',
  prefijosPermitidos: valor(base.prefijosPermitidos) || '591',
  mensajeComercioSuspendido: linea(valor(base.mensajeComercioSuspendido), 300)
    || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.',
  nombreAsistente: '',
  trato: 'tu',
};
const planilla = {
  planillaProspectosId: idPlanilla(base.planillaProspectosId),
  // Con id y sin nombre de hoja, la hoja de siempre.
  planillaProspectosHoja: idPlanilla(base.planillaProspectosId) ? (linea(valor(base.planillaProspectosHoja), 100) || 'Leads_CRM') : '',
};
const sinOferta = { planes: [], cargosUnicos: [], archivoPlanes: null };

let cfg;
if (codigo === 409) {
  cfg = Object.assign({}, deBase, sinOferta, atencion, {
    estadoComercio: 'suspendido',
    // Texto neutro del panel: no menciona pagos ni deudas.
    mensajeComercioSuspendido: linea(util(cuerpo.mensajeCortesia), 300) || deBase.mensajeComercioSuspendido,
    configDeLaConsola: false, panelDice: 'no operativo',
  });
} else if (!(codigo === 200 && typeof cuerpo.tenantId === 'string')) {
  cfg = Object.assign({}, deBase, sinOferta, atencion, {
    estadoComercio: 'operativo', configDeLaConsola: false, panelSinRespuesta: true, codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
  });
} else {
  const dn = cuerpo.datosDelNegocio && typeof cuerpo.datosDelNegocio === 'object' ? cuerpo.datosDelNegocio : {};
  const op = cuerpo.operacion && typeof cuerpo.operacion === 'object' ? cuerpo.operacion : {};
  const ob = cuerpo.onboarding && typeof cuerpo.onboarding === 'object' ? cuerpo.onboarding : {};
  const voz = cuerpo.voz && typeof cuerpo.voz === 'object' ? cuerpo.voz : {};
  const recepcion = util(op.numeroRecepcion);
  const plantilla = util(ob.plantillaAviso);
  const deLaConsola = soloLlenos({
    nombreNegocio: util(dn.nombreNegocio) ? linea(dn.nombreNegocio, 60) : undefined,
    // Solo dígitos: es el destino de la plantilla y del botón a una persona.
    numeroRecepcion: recepcion ? (cnDigitos(recepcion) || undefined) : undefined,
    prefijosPermitidos: Array.isArray(op.prefijosPermitidos) && op.prefijosPermitidos.length ? op.prefijosPermitidos.join(',') : undefined,
    nivelEmojis: NIVELES.indexOf(voz.nivelEmojis) >= 0 ? voz.nivelEmojis : undefined,
    plantillaAviso: plantilla && /^[a-z0-9_]{1,64}$/.test(plantilla) ? plantilla : undefined,
  });
  const estadoDeLaConsola = util(cuerpo.estadoComercio);
  cfg = Object.assign({}, deBase, deLaConsola, limpiarOferta(ob), atencion, {
    // Mandan aunque vengan vacíos: el nombre del asistente. El trato es una frase de la consola (`usted`, `tú`, `vos`, neutro): solo «usted» cambia lo que se le pide al modelo.
    nombreAsistente: linea(voz.nombreAsistente, 40),
    trato: /usted/i.test(String(voz.tratamiento || '')) ? 'usted' : 'tu',
    estadoComercio: estadoDeLaConsola === 'activo' ? 'operativo' : (estadoDeLaConsola ? 'suspendido' : 'operativo'),
    configDeLaConsola: true,
  });
}

// --- LOS DATOS (del archivo de datos) y el MODO PRUEBA ---
const datos = CH_DATOS && typeof CH_DATOS === 'object' ? CH_DATOS : { rubros: [], cierres: {}, respaldos: {}, textos: {}, respuestas: {}, precios: {}, instrucciones: {}, modelo: '', asistente: '' };
const prueba = carga.prueba && carga.prueba.modoPrueba === true ? carga.prueba : null;
// S7: `telefonosDePrueba` (opcional, en «Config base») limita a qué números puede dirigirse una ejecución de PRUEBA: si el teléfono pedido no está en la lista, no se envía nada. Sin lista
// (o con el marcador sin llenar), no se restringe.
const permitidos = valor(base.telefonosDePrueba).split(',').map((x) => cnDigitos(x)).filter((x) => x.length >= 6);
const telefonoDePrueba = prueba ? cnDigitos(prueba.telefonoDePrueba) : '';
const telefonoPermitido = permitidos.length === 0 || permitidos.indexOf(telefonoDePrueba) >= 0;

return [{ json: Object.assign({}, cfg, planilla, {
  datos: datos,
  nombreAsistente: cfg.nombreAsistente || linea(datos.asistente, 40),
  // El modelo es un parámetro de los datos (para pasar de `gemini-3.5-flash-lite` a `gemini-3.5-flash` sin tocar código); solo un id con forma de modelo de Gemini.
  modelo: /^gemini-[a-z0-9][a-z0-9.-]{1,38}$/.test(String(datos.modelo || '')) ? String(datos.modelo) : 'gemini-3.5-flash-lite',
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/.test(String(base.waGraphVersion || '')) ? String(base.waGraphVersion) : 'v26.0',
  phoneNumberId: String(carga.phoneNumberId || ''),
  // El modo prueba. Solo lo trae `Carga de entrada` cuando corrió «Entrada de prueba».
  modoPrueba: prueba !== null,
  telefonoDePrueba: prueba && telefonoPermitido ? telefonoDePrueba : '',
  enviarDeVerdad: prueba ? prueba.enviarDeVerdad === true && telefonoPermitido : true,
}) }];
