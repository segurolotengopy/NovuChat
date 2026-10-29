// CONFIG DEL NEGOCIO: lo configurable del negocio, en UN solo nodo.
//
// LA CONSOLA MANDA, PERO NUNCA DEJA AL CLIENTE SIN RESPUESTA. `Traer configuración` devuelve la respuesta completa (código y cuerpo, `neverError`) y aquí se decide con el código:
//   200 + tenantId -> configuración del panel; sus valores PISAN a los de `Config base`;
//   409            -> SUSPENDIDO: es una respuesta válida, no un error;
//   otra           -> no se pudo saber -> respaldo de `Config base`.
//
// DE LA CONSOLA salen (regla de Andres, 22/10/2026: lo que ya es estructura de la Consola no se repite en el flujo): el nombre del negocio, el número de recepción, la DIRECCIÓN, el HORARIO, los prefijos
// permitidos y la atención (los umbrales de uso extendido). Multi-tenant estricto: solo se cree a una respuesta cuyo `tenantId` es el de este flujo (`Config base.tenantId`).
// Este nodo sigue el patrón de `rroca-antonio` y de las doctoras (COPIA ADAPTADA declarada en PROPIO.md): se conservan los bloques de lectura de la respuesta, de atención y del modo prueba.

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
// El enlace de Google Maps de la Consola (`datosDelNegocio.direccionMaps`): LA MISMA regla que el servidor (https, dominio de mapas, hasta 200 caracteres, sin espacios). Es el ÚNICO enlace que pasa; los demás se descartan.
const ENLACE_DE_MAPA = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/;
const enlaceDeMapa = (v) => (typeof v === 'string' && v.trim().length <= 200 && ENLACE_DE_MAPA.test(v.trim()) ? v.trim() : '');
// Un texto de la Consola que sea (o lleve) un enlace no es una dirección ni un horario.
const sinEnlace = (v) => (/https?:|www\.|wa\.me|maps|goo\.gl/i.test(String(v)) ? '' : v);

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
  // La clínica y la dirección de respaldo son datos de este flujo: la dirección solo se usa si la Consola no trae la suya.
  clinica: linea(valor(base.clinica), 60),
  direccion: linea(sinEnlace(valor(base.direccionRespaldo)), 160),
  horario: '',
};

let cfg;
if (codigo === 409) {
  cfg = {
    ...deBase, ...atencion,
    estadoComercio: 'suspendido',
    // Texto neutro del panel: no menciona pagos ni deudas.
    mensajeComercioSuspendido: linea(util(cuerpo.mensajeCortesia), 300) || deBase.mensajeComercioSuspendido,
    configDeLaConsola: false, panelDice: 'no operativo',
  };
} else if (!(codigo === 200 && typeof cuerpo.tenantId === 'string' && cuerpo.tenantId === valor(base.tenantId))) {
  // Sin respuesta, o de OTRO tenant: se ignora (falla cerrado) y rige el respaldo de `Config base`.
  cfg = {
    ...deBase, ...atencion,
    estadoComercio: 'operativo', configDeLaConsola: false, panelSinRespuesta: true, codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
  };
} else {
  const dn = cuerpo.datosDelNegocio && typeof cuerpo.datosDelNegocio === 'object' ? cuerpo.datosDelNegocio : {};
  const op = cuerpo.operacion && typeof cuerpo.operacion === 'object' ? cuerpo.operacion : {};
  const recepcion = util(op.numeroRecepcion);
  const deLaConsola = soloLlenos({
    nombreNegocio: util(dn.nombreNegocio) ? linea(dn.nombreNegocio, 60) : undefined,
    // Solo dígitos: es el destino del botón a una persona.
    numeroRecepcion: recepcion ? (cnDigitos(recepcion) || undefined) : undefined,
    prefijosPermitidos: Array.isArray(op.prefijosPermitidos) && op.prefijosPermitidos.length ? op.prefijosPermitidos.join(',') : undefined,
    direccion: linea(sinEnlace(util(dn.direccion) || ''), 160) || undefined,
    horario: linea(sinEnlace(util(op.horarioAtencion) || ''), 200) || undefined,
    direccionMaps: enlaceDeMapa(dn.direccionMaps) || undefined,
  });
  const estadoDeLaConsola = util(cuerpo.estadoComercio);
  cfg = {
    ...deBase, ...deLaConsola, ...atencion,
    estadoComercio: estadoDeLaConsola === 'activo' ? 'operativo' : (estadoDeLaConsola ? 'suspendido' : 'operativo'),
    configDeLaConsola: true,
  };
}

// --- EL MODELO y el MODO PRUEBA ---
const prueba = carga.prueba && carga.prueba.modoPrueba === true ? carga.prueba : null;
// S7: `telefonosDePrueba` (en «Config base») limita a qué números puede dirigirse una ejecución de PRUEBA: si el teléfono pedido no está en la lista, no se envía nada.
// NIEGA POR DEFECTO: sin lista, o con el marcador sin llenar, ningún teléfono está permitido en el JSON de prueba.
const permitidos = valor(base.telefonosDePrueba).split(',').map((x) => cnDigitos(x)).filter((x) => x.length >= 6);
const telefonoDePrueba = prueba ? cnDigitos(prueba.telefonoDePrueba) : '';
const telefonoPermitido = permitidos.length > 0 && permitidos.indexOf(telefonoDePrueba) >= 0;

// ETAPA DE PRUEBA (`etapaPrueba = si` en `Config base`): el flujo vivo solo atiende a `telefonosDePrueba` (lo cierra `Puerta del turno`). Los avisos y el botón nunca pueden llegar a la recepción REAL:
// con la etapa encendida el número de recepción es el de `Config base` y se IGNORA el de la Consola. Sin `si` (vacío, marcador o cualquier otro valor) todo queda como siempre.
const etapaPrueba = valor(base.etapaPrueba).toLowerCase() === 'si';
if (etapaPrueba) cfg.numeroRecepcion = deBase.numeroRecepcion;
// UNA SOLA FUENTE de «¿este número está fuera de la etapa de prueba?»: la leen «¿Reportar? (entrante)» y «Puerta del turno».
const deQuien = cnDigitos(((Array.isArray(carga.messages) ? carga.messages[0] : null) || {}).from);
const fueraDePrueba = etapaPrueba && (!deQuien || permitidos.indexOf(deQuien) < 0);

// LAS IMÁGENES DE APOYO: el id del medio ya subido a Meta (dígitos). Un marcador `REEMPLAZAR_*` o cualquier otra cosa vale '' y esa imagen no se envía.
const idArte = (v) => (/^\d{6,25}$/.test(valor(v)) ? valor(v) : '');
// D6 (Andres, 23/10/2026): `usarMarcas = si` enciende el texto con las marcas (Sculptra®, Radiesse®) y el comparativo. Cualquier otro valor lo deja apagado.
const usarMarcas = valor(base.usarMarcas).toLowerCase() === 'si';

return [{ json: {
  ...cfg,
  etapaPrueba,
  telefonosEtapaPrueba: etapaPrueba ? permitidos : [],
  fueraDePrueba,
  usarMarcas,
  artesMedia: { comparativo: idArte(base.arteComparativoMediaId), antes_despues: idArte(base.arteAntesDespuesMediaId), autoridad: idArte(base.arteAutoridadMediaId) },
  // El modelo es un dato de `Config base` (solo un id con forma de modelo de Gemini).
  modelo: /^gemini-[a-z0-9][a-z0-9.-]{1,38}$/.test(String(base.modelo || '')) ? String(base.modelo) : 'gemini-3.5-flash-lite',
  temperatura: Number.isFinite(Number(base.temperatura)) ? Number(base.temperatura) : 0.4,
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/.test(String(base.waGraphVersion || '')) ? String(base.waGraphVersion) : 'v26.0',
  phoneNumberId: String(carga.phoneNumberId || ''),
  // El modo prueba. Solo lo trae `Carga de entrada` cuando corrió «Entrada de prueba».
  modoPrueba: prueba !== null,
  telefonoDePrueba: prueba && telefonoPermitido ? telefonoDePrueba : '',
  enviarDeVerdad: prueba ? prueba.enviarDeVerdad === true && telefonoPermitido : true,
} }];
