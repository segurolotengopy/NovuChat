// CONFIG DEL NEGOCIO: lo configurable del negocio, en UN solo nodo.
//
// LA CONSOLA MANDA, PERO NUNCA DEJA AL PROSPECTO SIN RESPUESTA. `Traer configuración` devuelve la respuesta completa (codigo y
// cuerpo, `neverError`) y aca se decide con el codigo:
//   200 + tenantId -> configuracion del panel; sus valores PISAN a los de `Config base`;
//   409            -> SUSPENDIDO: es una respuesta valida, no un error;
//   otra           -> no se pudo saber -> respaldo de `Config base`, sin rubros ni planes: el flujo pregunta por el negocio.
//
// LO PROPIO DE ESTE FLUJO viene en `onboarding` (/config/onboarding): la plantilla del aviso y LA OFERTA —rubros, planes, cargos
// unicos, aclaraciones y el archivo de planes—. Cada valor se valida aca tambien: ante la duda gana el respaldo, y un elemento
// mal formado se descarta. Los PRECIOS viajan en `planes` y `cargosUnicos` solo para que el codigo los muestre: ni uno llega al
// modelo (`ccInstrucciones` los quita).
//
// EL GUION (frases de dolor, preguntas, impacto y nombre del asesor) y el corpus NO vienen de la consola: son del archivo de
// datos del tenant y el constructor los inyecta en la linea marcada de abajo (`@@guion`). Una linea marcadora por nodo y por
// dato: el constructor falla si no aparece exactamente una vez.
const CM_GUION = null; // @@guion

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
const entero = (v, min, max) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) ? v : undefined;
// Un marcador sin llenar (`REEMPLAZAR_…`) no es un valor.
const valor = (v) => (typeof v === 'string' && !/^REEMPLAZAR_/.test(v.trim())) ? v.trim() : '';
// Texto de la consola que va al prompt o a un mensaje: una linea, sin corchetes ni llaves ni los delimitadores del turno.
const linea = (v, max) => String(v === undefined || v === null ? '' : v)
  .replace(/<<<|>>>/g, '').replace(/[\[\]{}]/g, '')
  .replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const lista = (v) => Array.isArray(v) ? v : [];
const precio = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000) ? v : undefined;
const NIVELES = ['ninguno', 'pocos', 'muchos'];
const PERIODOS = ['mes', 'anio', 'unico'];

function limpiarOferta(ob) {
  const rubros = lista(ob.rubros).map((r) => ({
    id: linea(r && r.id, 40), nombre: linea(r && r.nombre, 60),
    solucion: linea(r && r.solucion, 400), flujoSugerido: linea(r && r.flujoSugerido, 40),
  })).filter((r) => /^[a-z0-9_-]{1,40}$/.test(r.id) && r.nombre).slice(0, 20);
  const planes = lista(ob.planes).map((p) => ({
    nombre: linea(p && p.nombre, 40), precioUsd: precio(p && p.precioUsd),
    periodo: PERIODOS.indexOf(p && p.periodo) >= 0 ? p.periodo : '', incluye: linea(p && p.incluye, 200),
  })).filter((p) => p.nombre && p.precioUsd !== undefined && p.periodo).slice(0, 12);
  const cargosUnicos = lista(ob.cargosUnicos).map((c) => ({
    nombre: linea(c && c.nombre, 40), precioUsd: precio(c && c.precioUsd), desde: !!(c && c.desde === true), detalle: linea(c && c.detalle, 200),
  })).filter((c) => c.nombre && c.precioUsd !== undefined).slice(0, 6);
  const aclaraciones = lista(ob.aclaraciones).map((a) => ({ tema: linea(a && a.tema, 60), texto: linea(a && a.texto, 600) }))
    .filter((a) => a.tema && a.texto).slice(0, 15);
  // EL ARCHIVO DE PLANES SOLO DESDE EL ALMACENAMIENTO DE LA CONSOLA: https, el host exacto de Firebase Storage o de Cloud Storage
  // y la ruta enseguida (sin usuario antes del host). Por expresion y no con `URL`: el nodo Code de n8n no tiene ese global.
  const ap = ob.archivoPlanes && typeof ob.archivoPlanes === 'object' ? ob.archivoPlanes : null;
  const url = ap ? String(ap.url === undefined || ap.url === null ? '' : ap.url).trim() : '';
  const archivoPlanes = ap && /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\/[^\s@\\"'<>{}]+$/.test(url) && (ap.tipo === 'pdf' || ap.tipo === 'imagen')
    ? { url: url, tipo: ap.tipo, nombreArchivo: linea(ap.nombreArchivo, 80) || 'Planes.pdf' } : null;
  return { rubros: rubros, planes: planes, cargosUnicos: cargosUnicos, aclaraciones: aclaraciones, archivoPlanes: archivoPlanes };
}

// --- ATENCION: los umbrales de uso extendido (el servidor decide; este nodo obedece) ------------------------------
const at = (codigo === 200 && cuerpo.atencion && typeof cuerpo.atencion === 'object') ? cuerpo.atencion : {};
const atencion = {
  atencionEstado: ['normal', 'operador', 'bloqueado'].indexOf(at.estado) >= 0 ? at.estado : 'normal',
  atencionMensajeFijo: util(at.mensajeFijo)
    || 'Gracias por tu paciencia. Para atenderte mejor, una persona del equipo va a continuar esta conversación.',
  atencionAvisarRecepcion: ['operador', 'bloqueado'].indexOf(at.avisarRecepcion) >= 0 ? at.avisarRecepcion : '',
  atencionRespuestas: (typeof at.respuestasEnVentana === 'number' && Number.isFinite(at.respuestasEnVentana)) ? at.respuestasEnVentana : 0,
  atencionVenceEn: util(at.ventanaVenceEn) || '',
};

// --- Lo de `Config base` (respaldo) -------------------------------------------------------------------------------
const idPlanilla = (v) => (/^[A-Za-z0-9_-]{25,100}$/.test(valor(v)) ? valor(v) : '');
const deBase = {
  nombreNegocio: linea(valor(base.nombreNegocio), 60),
  numeroRecepcion: cnDigitos(valor(base.numeroRecepcion)),
  horarioAtencion: linea(valor(base.horarioAtencion), 120),
  plantillaAviso: /^[a-z0-9_]{1,64}$/.test(valor(base.plantillaAviso)) ? valor(base.plantillaAviso) : 'solicitud_contacto',
  idiomaPlantillaAviso: /^[a-z]{2}(_[A-Z]{2})?$/.test(valor(base.idiomaPlantillaAviso)) ? valor(base.idiomaPlantillaAviso) : 'es',
  nivelEmojis: NIVELES.indexOf(base.nivelEmojis) >= 0 ? base.nivelEmojis : 'pocos',
  prefijosPermitidos: valor(base.prefijosPermitidos) || '591',
  mensajeComercioSuspendido: linea(valor(base.mensajeComercioSuspendido), 300)
    || 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.',
  nombreAsistente: '',
};
const planilla = {
  planillaProspectosId: idPlanilla(base.planillaProspectosId),
  // Con id y sin nombre de hoja, la hoja de siempre.
  planillaProspectosHoja: idPlanilla(base.planillaProspectosId) ? (linea(valor(base.planillaProspectosHoja), 100) || 'Leads_CRM') : '',
  crmUrl: /^https:\/\/[^\s"'\\{}]+$/.test(valor(base.crmUrl)) ? valor(base.crmUrl) : '',
  limiteInteractivo: entero(Number(base.limiteInteractivo), 200, 4096) || 1024,
};
const sinOferta = { rubros: [], planes: [], cargosUnicos: [], aclaraciones: [], archivoPlanes: null };

let cfg;
if (codigo === 409) {
  cfg = Object.assign({}, deBase, sinOferta, atencion, {
    estadoComercio: 'suspendido',
    // Texto neutro del panel: no menciona pagos ni deudas.
    mensajeComercioSuspendido: linea(util(cuerpo.mensajeCortesia), 300) || deBase.mensajeComercioSuspendido,
    configDeLaConsola: false, panelDice: 'no operativo', campanas: [],
  });
} else if (!(codigo === 200 && typeof cuerpo.tenantId === 'string')) {
  cfg = Object.assign({}, deBase, sinOferta, atencion, {
    estadoComercio: 'operativo', configDeLaConsola: false, panelSinRespuesta: true,
    codigoDelPanel: Number.isFinite(codigo) ? codigo : 0, campanas: [],
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
    // Solo digitos: es el destino de la plantilla y del boton a una persona.
    numeroRecepcion: recepcion ? (cnDigitos(recepcion) || undefined) : undefined,
    prefijosPermitidos: Array.isArray(op.prefijosPermitidos) && op.prefijosPermitidos.length ? op.prefijosPermitidos.join(',') : undefined,
    nivelEmojis: NIVELES.indexOf(voz.nivelEmojis) >= 0 ? voz.nivelEmojis : undefined,
    plantillaAviso: plantilla && /^[a-z0-9_]{1,64}$/.test(plantilla) ? plantilla : undefined,
  });
  const estadoDeLaConsola = util(cuerpo.estadoComercio);
  // --- CAMPAÑAS VIGENTES: el servidor manda SOLO las aplicadas y vigentes; aca se vuelve a mirar la vigencia contra el reloj.
  // Cada una trae `destino` (`rubro:<id>`, `planes` o `asesor`) o no (el servidor hoy no lo manda: se tolera).
  const campanas = lista(cuerpo.campanas)
    .filter((k) => k && typeof k.texto === 'string' && k.texto.trim() !== '' && k.texto.length <= 300)
    .filter((k) => {
      const desde = Date.parse(String(k.inicio || ''));
      const hasta = Date.parse(String(k.fin || ''));
      const ahora = Date.now();
      return Number.isFinite(desde) && Number.isFinite(hasta) && desde <= ahora && ahora < hasta;
    })
    .slice(0, 10)
    // El `destino` pasa tal cual (hasta 60 caracteres): la libreria (`ccCampana`) es quien lo valida contra su vocabulario.
    .map((k) => Object.assign({ id: String(k.id || '').slice(0, 60), texto: k.texto.trim() },
      typeof k.destino === 'string' ? { destino: k.destino.slice(0, 60) } : {}));
  cfg = Object.assign({}, deBase, deLaConsola, limpiarOferta(ob), atencion, {
    // Mandan aunque vengan vacios: el nombre del asistente y el horario.
    nombreAsistente: linea(voz.nombreAsistente, 40),
    horarioAtencion: linea(op.horarioAtencion, 120),
    estadoComercio: estadoDeLaConsola === 'activo' ? 'operativo' : (estadoDeLaConsola ? 'suspendido' : 'operativo'),
    configDeLaConsola: true, campanas: campanas,
  });
}

// --- EL GUION (del archivo de datos) y el MODO PRUEBA ---------------------------------------------------------------
const guion = CM_GUION && typeof CM_GUION === 'object' ? CM_GUION : { asesor: { nombre: '' }, rubros: {} };
const nombreAsesor = guion.asesor && typeof guion.asesor.nombre === 'string' ? guion.asesor.nombre : '';
const prueba = carga.prueba && carga.prueba.modoPrueba === true ? carga.prueba : null;
// S7: `telefonosDePrueba` (opcional, en «Config base») limita a que numeros puede dirigirse una ejecucion de PRUEBA: si el telefono
// pedido no esta en la lista, no se envia nada. Sin lista (o con el marcador sin llenar), no se restringe.
const permitidos = valor(base.telefonosDePrueba).split(',').map((x) => cnDigitos(x)).filter((x) => x.length >= 6);
const telefonoDePrueba = prueba ? cnDigitos(prueba.telefonoDePrueba) : '';
const telefonoPermitido = permitidos.length === 0 || permitidos.indexOf(telefonoDePrueba) >= 0;

return [{ json: Object.assign({}, cfg, planilla, {
  guion: guion,
  asesor: nombreAsesor,
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/.test(String(base.waGraphVersion || '')) ? String(base.waGraphVersion) : 'v26.0',
  phoneNumberId: String(carga.phoneNumberId || ''),
  // El modo prueba. Solo lo trae `Carga de entrada` cuando corrio «Entrada de prueba».
  modoPrueba: prueba !== null,
  telefonoDePrueba: prueba && telefonoPermitido ? telefonoDePrueba : '',
  enviarDeVerdad: prueba ? prueba.enviarDeVerdad === true && telefonoPermitido : true,
}) }];
