#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de la «Venta digital de Rubén» (tenant rroca-ruben) desde la plantilla y los datos
 * =============================================================================
 *
 *   node Flujos/experimental/rroca-ruben/construir.mjs               escribe rroca-ruben.json y rroca-ruben.prueba.json
 *   node Flujos/experimental/rroca-ruben/construir.mjs --verificar   no escribe: sale 1 si un JSON versionado difiere de lo que se arma o viola una guardia
 *   node Flujos/experimental/rroca-ruben/construir.mjs --publicable [--flujo <json>] [--datos <json>]
 *                                                                    GUARDIA DE PUBLICACIÓN (PR-5): no escribe; sale 1 si el flujo trae un `REEMPLAZAR_*` sin sustituir, si las plantillas
 *                                                                    de aviso no están APPROVED (con nombre e idioma) o si se abre al PÚBLICO sin los tres medios (audio, imagen, documento). Sin `--flujo`, revisa `rroca-ruben.json`; `publicar-flujo.sh` la corre sobre lo que va a escribir
 *   (cualquier otro argumento se rechaza: la ayuda no existe como opción, para que nada escriba por error)
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos. El código de los nodos lo arma el armador genérico
 * `../comun-sin-agente/construir.mjs` (importado, no copiado) con el `CONFIG` de este archivo. Lo propio de este archivo:
 *
 *   - `@@dato:a.b.c@@` (en cualquier texto de la plantilla) por ese dato; `@@cred:ingesta|graph|entradaPrueba|medios|gemini` (nombre de credencial) por el del archivo de datos;
 *   - «Config base» se llena con `configBase` (texto, número o booleano);
 *   - LA CADENA DE ENVÍO es común (`../comun-sin-agente/src/envio.mjs`, `injertar()`), con las credenciales por NOMBRE; la «puerta de la entrega» `¿Meta aceptó?`
 *     (propia) solo reencamina una conexión: el reporte saliente cuenta si Meta devolvió `messages[0].id` y ningún `error`;
 *   - dos variantes: PRODUCCIÓN (con la entrada verificada del receptor y sin «Entrada de prueba») y PRUEBA (al revés).
 *
 * LOS DATOS son `admin/scripts/datos/rroca-ruben/rroca-ruben.json` (zona Tenants: solo marcadores `REEMPLAZAR_*` para los identificadores y las rutas, nunca un token,
 * una ruta de webhook real, un teléfono ni un identificador de Meta).
 *
 * LAS GUARDIAS de lo armado (también se aplican al archivo versionado, aunque alguien lo haya tocado a mano):
 *   - ≤ 48 nodos; nunca un WhatsApp Trigger (prohibición 7); nunca `subscriptions` ni `subscribed_apps`;
 *   - producción: solo el webhook del receptor, sin «Entrada de prueba»; prueba: solo «Entrada de prueba» (con credencial de cabecera) y sin receptor;
 *   - la verificación del receptor: `wabaIdEsperado` FIJO (nunca una expresión), sin «Continue on Fail» ni `onError`, y «Descartar repetidos» entre ejecuciones;
 *   - un nodo HTTP solo habla con Meta, Gemini y las Functions de la consola; `REEMPLAZAR_*` solo donde se declara; ajustes de retención, orden y zona.
 */
import { closeSync, constants, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
import { injertar } from '../comun-sin-agente/src/envio.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const ARCHIVO_DE_DATOS = join(AQUI, '../../../admin/scripts/datos/rroca-ruben/rroca-ruben.json');
export const TOPE_DE_NODOS = 48;
/**
 * «Solo se ofrece lo que se cumple»: el aviso a recepción (PR-3) existe, así que el JSON de producción ya NO lleva `meta.noPublicable`. La guardia de `--verificar` ahora exige lo contrario: que el aviso
 * esté (los nodos «Armar avisos», «¿Hay avisos?» y «Enviar aviso», conectados antes de «Armar mensajes», y la lógica de plantilla y de ventana en «Armar avisos»), y que no quede la marca vieja.
 */
export const NODOS_DEL_AVISO = ['Armar avisos', '¿Hay avisos?', 'Enviar aviso'];

/**
 * El config del armador genérico. Vive aquí y no en un `construir.config.json`: el saneo del repo público trata todo JSON bajo `Flujos/` como un export de n8n.
 * Las variantes: PRODUCCIÓN (entrada verificada del receptor, sin «Entrada de prueba») y PRUEBA (al revés). El nombre del flujo sale de los datos.
 */
export const CONFIG = {
  plantilla: 'flujo.plantilla.json',
  raiz: '../..',
  librerias: ['src/lib/cobro.js', 'src/lib/avisos.js', 'src/lib/rr.js'],
  comun: ['src/nodos/_comun.js'],
  paquetes: { mensajes: ['../comun-sin-agente/src/mensajes.js'], filtro: ['../comun-sin-agente/src/filtro-redaccion.js'] },
  variantes: [
    { archivo: 'rroca-ruben.json', quitar: 'Entrada de prueba', nombre: 'se toma de los datos' },
    { archivo: 'rroca-ruben.prueba.json', quitar: ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'], nombre: 'se toma de los datos' },
  ],
};

const NODO_PRUEBA = 'Entrada de prueba';
const NODO_RECEPTOR = 'Entrega del receptor';
const NODOS_DEL_RECEPTOR = [NODO_RECEPTOR, 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'];
const ANFITRION_CONSOLA = 'us-east1-novuchat-demo.cloudfunctions.net';
const ANFITRIONES = ['graph.facebook.com', 'generativelanguage.googleapis.com', ANFITRION_CONSOLA];

// ----------------------------------------------------------------- lectura y escritura sin seguir enlaces simbólicos
const noExiste = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
function leerSiExiste(ruta, nombre) {
  let fd;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    if (noExiste(e)) return null;
    if (e && e.code === 'ELOOP') throw new Error(`${nombre}: es un enlace simbólico y no se lee`);
    throw e;
  }
  try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
}
function escribirSinSeguirEnlaces(ruta, texto, nombre) {
  let fd;
  try {
    fd = openSync(ruta, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  } catch (e) {
    if (e && e.code === 'ELOOP') throw new Error(`${nombre}: es un enlace simbólico y no se escribe`);
    throw e;
  }
  try { writeFileSync(fd, texto); } finally { closeSync(fd); }
}

// ----------------------------------------------------------------- el núcleo común de la transcripción (INCLUIDO tal cual, nunca copiado)
/**
 * «Preparar transcripción» es la pieza común `Flujos/src/core/medios/preparar-transcripcion.js` (tope de cinco minutos, recorte a 4.400 caracteres, «muy largo» y «no se entendió»): se INCLUYE byte a byte dentro de una
 * función que recibe el `$` de n8n y le traduce solo dos nombres de nodo (los de este flujo son «Interpretar entrada» y «Obtener URL del medio»). Detrás va el adaptador propio, que convierte su `userInput`
 * (pensado para un agente) en un dato cerrado. Si el core cambia, `--verificar` falla hasta rearmar: es intencional.
 */
export const NUCLEO_TRANSCRIPCION = join(AQUI, '../../src/core/medios/preparar-transcripcion.js');
export const ADAPTADOR_TRANSCRIPCION = join(AQUI, 'src/nodos/adaptar-transcripcion.js');
export const NOMBRES_DEL_NUCLEO = { 'Normalizar entrada': 'Interpretar entrada', 'Obtener URL del medio (general)': 'Obtener URL del medio' };
export const MARCA_NUCLEO = '@@nucleo:preparar-transcripcion';
export function fuenteDelNucleo() {
  const f = leerSiExiste(NUCLEO_TRANSCRIPCION, 'preparar-transcripcion.js');
  return f === null ? null : f.trimEnd();
}
export function codigoConNucleo() {
  const fuente = fuenteDelNucleo();
  const adaptador = leerSiExiste(ADAPTADOR_TRANSCRIPCION, 'adaptar-transcripcion.js');
  if (fuente === null || adaptador === null) throw new Error('falta el núcleo común de la transcripción o su adaptador');
  return ['// NÚCLEO COMÚN INCLUIDO TAL CUAL: Flujos/src/core/medios/preparar-transcripcion.js (el mismo archivo que el ensamblador pone en los flujos con agente). Solo se le traducen dos nombres de nodo; su salida la traduce el adaptador propio.',
    'const rrNucleo = ((rrN8n) => {',
    `  const rrNombres = ${JSON.stringify(NOMBRES_DEL_NUCLEO)};`,
    '  const $ = (nombre) => rrN8n(Object.prototype.hasOwnProperty.call(rrNombres, nombre) ? rrNombres[nombre] : nombre);',
    fuente, '})($);', adaptador.trimEnd()].join('\n') + '\n';
}

// ----------------------------------------------------------------- los datos
const MARCADOR = /^REEMPLAZAR_[A-Z0-9_]+$/;
const FORMAS_CONFIG = {
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/,
  phoneNumberIdEsperado: /^(\d{6,25}|REEMPLAZAR_[A-Z0-9_]+)$/,
  numeroRecepcion: /^(\d{6,20}|REEMPLAZAR_[A-Z0-9_]+)$/,
  prefijosPermitidos: /^\d{1,4}(,\d{1,4})*$/,
  telefonosDePrueba: /^(\d{6,20}(,\d{6,20})*|REEMPLAZAR_[A-Z0-9_]+)$/,
  modelo: /^gemini-[a-z0-9][a-z0-9.-]{1,38}$/,
  // Las plantillas de aviso a Rubén (PR-3). El estado es el de Meta: solo APPROVED habilita el aviso fuera de la ventana de Rubén; PENDING o REJECTED lo dejan en «plantilla_no_configurada».
  avisoComprobantePlantilla: /^[a-z0-9_]{1,100}$/,
  avisoConsultaPlantilla: /^[a-z0-9_]{1,100}$/,
  avisoComprobanteEstado: /^(APPROVED|PENDING|REJECTED|PAUSED|DISABLED|IN_APPEAL)$/,
  avisoConsultaEstado: /^(APPROVED|PENDING|REJECTED|PAUSED|DISABLED|IN_APPEAL)$/,
  avisoPlantillaIdioma: /^[a-z]{2,3}(_[A-Z]{2})?$/,
  // La guardia de apertura: los medios que el flujo ya atiende (lista separada por comas) y si se publica en prueba o al público.
  mediosHabilitados: /^[a-z_]{1,40}(,[a-z_]{1,40})*$/,
  // Los topes diarios por teléfono de los medios que Gemini mira o escucha (0 apaga el medio; sin valor, el del código).
  topeImagenesDia: /^([0-9]|1[0-9]|20)$/,
  topeAudiosDia: /^([0-9]|[12][0-9]|30)$/,
  modoApertura: /^(prueba|publico)$/,
};
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;

/** Lee y valida el archivo de datos. Cada error nombra el campo. */
export function cargarDatos(ruta = ARCHIVO_DE_DATOS) {
  const texto = leerSiExiste(ruta, 'rroca-ruben.json');
  if (texto === null) throw new Error(`no existe el archivo de datos ${ruta}`);
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error('rroca-ruben.json: no es un JSON válido'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('rroca-ruben.json: tiene que ser un objeto');
  const errores = [];
  const cadena = (ruta2, v) => { if (typeof v !== 'string' || v.trim() === '') errores.push(`${ruta2}: falta`); };
  cadena('nombreFlujo', d.nombreFlujo);
  cadena('nombreFlujoPrueba', d.nombreFlujoPrueba);
  for (const c of ['ingesta', 'graph', 'graphPrueba', 'entradaPrueba', 'medios', 'gemini']) cadena(`credenciales.${c}`, (d.credenciales || {})[c]);
  for (const c of ['ruta', 'urlVerificador', 'wabaIdEsperado']) {
    const v = (d.receptor || {})[c];
    cadena(`receptor.${c}`, v);
    // Repo público: la ruta del receptor y la URL del verificador son marcadores; el wabaId también (lo sustituye el publicador).
    if (typeof v === 'string' && !MARCADOR.test(v) && !(c === 'wabaIdEsperado' && /^\d{6,25}$/.test(v))) errores.push(`receptor.${c}: tiene que ser un marcador REEMPLAZAR_*`);
  }
  if (typeof d.pruebaRuta !== 'string' || !MARCADOR.test(d.pruebaRuta)) errores.push('pruebaRuta: tiene que ser un marcador REEMPLAZAR_*');
  const cb = d.configBase && typeof d.configBase === 'object' && !Array.isArray(d.configBase) ? d.configBase : null;
  if (!cb) errores.push('configBase: falta');
  else {
    for (const [c, v] of Object.entries(cb)) {
      if (!['string', 'number', 'boolean'].includes(typeof v)) errores.push(`configBase.${c}: solo texto, número o booleano`);
      if (FORMAS_CONFIG[c] && !FORMAS_CONFIG[c].test(String(v))) errores.push(`configBase.${c}: forma no válida`);
    }
    for (const c of ['phoneNumberIdEsperado', 'numeroRecepcion', 'nombreNegocio']) if (cb[c] === undefined || cb[c] === '') errores.push(`configBase.${c}: falta`);
  }
  if (errores.length) throw new Error(`rroca-ruben.json: datos no válidos: ${errores.join('; ')}`);
  return d;
}

function dato(datos, ruta, donde) {
  let x = datos;
  for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
  if (typeof x !== 'string' || x === '') throw new Error(`${donde}: falta el dato «${ruta}» en el archivo de datos`);
  if (CARACTERES_PELIGROSOS.test(x) && !ruta.startsWith('credenciales.') && !/^nombreFlujo/.test(ruta)) throw new Error(`${donde}: el dato «${ruta}» trae una comilla, una barra invertida, una llave o un salto de línea`);
  return x;
}
function reemplazarTextos(valor, datos, donde) {
  if (typeof valor === 'string') return valor.replace(/@@dato:([A-Za-z0-9_.]+)@@/g, (_, ruta) => dato(datos, ruta, donde));
  if (Array.isArray(valor)) return valor.map((v) => reemplazarTextos(v, datos, donde));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([c, v]) => [c, reemplazarTextos(v, datos, donde)]));
  return valor;
}
const asignaciones = (configBase) => Object.entries(configBase).map(([nombre, valor]) => ({ id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor }));

// ----------------------------------------------------------------- las guardias de lo armado
export function anfitrionPermitido(url, nombreDelNodo = '') {
  if (MARCADOR.test(url)) return true;
  // La única excepción: «Descargar medio» baja el medio de la URL que le devuelve Meta (la anterior, «¿Tamaño aceptable?», exige https y un tamaño).
  if (nombreDelNodo === 'Descargar medio' && url === '={{ $json.url }}') return true;
  const m = /^=?https:\/\/([^/?#\s]*)/i.exec(url);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return false;
  return ANFITRIONES.includes(m[1].toLowerCase());
}

/** Lo que un JSON de este flujo no puede tener. `variante`: 'produccion' | 'prueba'. Devuelve la lista de hallazgos (vacía si está limpio). */
export function guardias(variante, flujo) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const nombres = new Set(nodos.map((n) => n.name));
  const por = (nombre) => nodos.find((n) => n.name === nombre);
  const p = (n) => (n && n.parameters) || {};
  if (nodos.length > TOPE_DE_NODOS) h.push(`tiene ${nodos.length} nodos y el tope es ${TOPE_DE_NODOS}: si pasa, se rehace`);
  if (nodos.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')) h.push('contiene un WhatsApp Trigger (prohibición 7: reescribe el webhook de toda la app)');
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) h.push('menciona «subscriptions» o «subscribed_apps» (prohibición 7)');
  if (/langchain\.(agent|memory\w*|lmChat\w*|chain\w*)$/i.test(nodos.map((n) => n.type).join('\n'))) h.push('lleva un agente, memoria o modelo de chat de n8n: este flujo no los lleva');
  // El aviso a recepción es obligatorio (PR-3): sin él, en estado «operador» el texto promete atención humana sin respaldo. Sin la marca vieja y con la cadena del aviso completa.
  if (flujo && flujo.meta && flujo.meta.noPublicable !== undefined) h.push('trae `meta.noPublicable`: el aviso a recepción ya existe (PR-3) y la marca sobra');
  for (const n of NODOS_DEL_AVISO) if (!nombres.has(n)) h.push(`falta el nodo «${n}»: sin el aviso a recepción este flujo no se publica ni se activa en un número real`);
  const armarAvisos = por('Armar avisos');
  const codigoAvisos = String(p(armarAvisos).jsCode || '');
  if (armarAvisos && !(/rrPlantilla\(/.test(codigoAvisos) && /avPlantilla\(/.test(codigoAvisos) && /RR_VENTANA_RUBEN_MS/.test(codigoAvisos))) h.push('«Armar avisos» no lleva la plantilla ni la ventana de Rubén: el aviso fuera de las 24 h no saldría');
  const conex = (flujo && flujo.connections) || {};
  const destinosDe = (nombre, salida) => (((conex[nombre] || {}).main || [])[salida] || []).map((x) => x.node);
  // MEDIOS ENTRANTES: «Preparar transcripción» incluye el núcleo común TAL CUAL; el audio y la imagen pasan por sus nodos de Gemini, que no cortan el turno si fallan.
  const preparar = por('Preparar transcripción');
  if (preparar) {
    const fuente = fuenteDelNucleo();
    if (fuente === null || !String(p(preparar).jsCode || '').includes(fuente)) h.push('«Preparar transcripción» no incluye TAL CUAL el núcleo común (Flujos/src/core/medios/preparar-transcripcion.js): rearme con «node construir.mjs»');
    if (destinosDe('Preparar transcripción', 0).join('|') !== 'Decidir turno') h.push('«Preparar transcripción» tiene que conectarse solo a «Decidir turno»');
  }
  if (nombres.has('Transcribir audio') && destinosDe('Transcribir audio', 0).join('|') !== 'Preparar transcripción') h.push('«Transcribir audio» tiene que conectarse solo a «Preparar transcripción»');
  if (nombres.has('Ver imagen') && destinosDe('Ver imagen', 0).join('|') !== 'Decidir turno') h.push('«Ver imagen» tiene que conectarse solo a «Decidir turno»');
  for (const nombre of ['Transcribir audio', 'Ver imagen']) {
    const g = por(nombre);
    if (!g) continue;
    if (!((g.credentials || {}).googlePalmApi || {}).name) h.push(`«${nombre}» no lleva credencial (googlePalmApi)`);
    if (g.onError !== 'continueRegularOutput' || g.alwaysOutputData !== true) h.push(`«${nombre}» tiene que llevar onError continueRegularOutput y alwaysOutputData: si Gemini falla, el turno sigue y el cliente recibe su texto`);
  }
  if (nombres.has('Armar avisos') && !destinosDe('Armar avisos', 0).includes('¿Hay avisos?')) h.push('«Armar avisos» no está conectado a «¿Hay avisos?»');
  if (nombres.has('¿Hay avisos?') && !destinosDe('¿Hay avisos?', 0).includes('Enviar aviso')) h.push('«¿Hay avisos?» no envía por «Enviar aviso»');
  if (nombres.has('Enviar aviso') && !destinosDe('Enviar aviso', 0).includes('Armar mensajes')) h.push('«Enviar aviso» no cuelga de «Armar mensajes»: el aviso tiene que correr ANTES de armar el mensaje que dice si salió');
  // La rama SIN aviso también pasa por «Armar mensajes» (sin ella, un turno sin aviso no respondería), y «Enviar aviso» lleva credencial y no corta el turno si Meta lo rechaza.
  if (nombres.has('¿Hay avisos?') && !destinosDe('¿Hay avisos?', 1).includes('Armar mensajes')) h.push('«¿Hay avisos?» no envía la rama sin aviso (salida 1) a «Armar mensajes»');
  const enviarAviso = por('Enviar aviso');
  if (enviarAviso && !((enviarAviso.credentials || {}).httpHeaderAuth || {}).name) h.push('«Enviar aviso» no lleva credencial (httpHeaderAuth)');
  if (enviarAviso && enviarAviso.onError !== 'continueRegularOutput') h.push('«Enviar aviso» no lleva `onError: continueRegularOutput`: si Meta lo rechaza, el turno se cortaría y el cliente quedaría sin respuesta');
  if (variante === 'produccion') {
    if (nombres.has(NODO_PRUEBA)) h.push(`contiene «${NODO_PRUEBA}» (activa el modo prueba): solo va en el JSON de prueba`);
    for (const n of NODOS_DEL_RECEPTOR) if (!nombres.has(n)) h.push(`falta el nodo «${n}» de la entrada verificada del receptor`);
  } else {
    for (const n of NODOS_DEL_RECEPTOR) if (nombres.has(n)) h.push(`la prueba contiene «${n}» (entrada del receptor): no va`);
    const ep = por(NODO_PRUEBA);
    if (!ep) h.push(`falta «${NODO_PRUEBA}»`);
    else if (p(ep).authentication !== 'headerAuth' || !((ep.credentials || {}).httpHeaderAuth || {}).name) h.push(`«${NODO_PRUEBA}» tiene que exigir una credencial de cabecera (httpHeaderAuth)`);
  }
  // Webhooks: en producción solo el del receptor; en la prueba solo la entrada de prueba.
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.webhook')) {
    if (n.name !== (variante === 'produccion' ? NODO_RECEPTOR : NODO_PRUEBA)) h.push(`el webhook «${n.name}» no corresponde a esta variante`);
  }
  // La entrada verificada del receptor.
  if (variante === 'produccion') {
    const v = por('Verificar firma con el receptor');
    if (v) {
      if (v.onError !== undefined || v.continueOnFail !== undefined) h.push('«Verificar firma con el receptor» no puede llevar «Continue on Fail» ni `onError` (un 503 del verificador daría 401 y la entrega moriría en vez de reintentarse)');
      const cuerpo = String(p(v).jsonBody || '');
      if (!/wabaIdEsperado: "(REEMPLAZAR_[A-Z0-9_]+|\d{6,25})"/.test(cuerpo)) h.push('«Verificar firma con el receptor»: `wabaIdEsperado` tiene que ser un valor FIJO entre comillas (nunca una expresión)');
      if (!anfitrionPermitido(String(p(v).url || ''))) h.push('«Verificar firma con el receptor» llama a un anfitrión no permitido');
    }
    const f = por('¿Firma válida?');
    if (f && (f.onError !== undefined || f.continueOnFail !== undefined)) h.push('«¿Firma válida?» no puede llevar «Continue on Fail»');
    const d = por('Descartar repetidos');
    if (d && (p(d).operation !== 'removeItemsSeenInPreviousExecutions' || p(d).logic !== 'removeItemsWithAlreadySeenKeyValues')) h.push('«Descartar repetidos» tiene que descartar entre ejecuciones (removeItemsSeenInPreviousExecutions)');
  }
  // Un nodo HTTP solo habla con Meta, con Gemini y con las Functions de la consola.
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    const url = String(p(n).url || '');
    if (!anfitrionPermitido(url, n.name)) h.push(`el nodo «${n.name}» llama a un anfitrión fuera de la lista (graph.facebook.com, generativelanguage.googleapis.com, las Functions de la consola)`);
  }
  // Retención de ejecuciones, orden y zona horaria.
  const st = (flujo && flujo.settings) || {};
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'all' || st.saveExecutionProgress !== false) h.push('los ajustes de retención deben ser saveDataSuccessExecution «none», saveDataErrorExecution «all» y saveExecutionProgress false');
  if (st.errorWorkflow !== undefined) h.push('no lleva `errorWorkflow`');
  if (st.executionOrder !== 'v1') h.push('executionOrder tiene que ser «v1» (el orden de las ramas es el del lienzo)');
  if (st.timezone !== 'America/La_Paz') h.push('timezone tiene que ser «America/La_Paz»');
  // `REEMPLAZAR_` solo en «Config base», en el receptor y en la ruta de la entrada de prueba.
  const conMarcador = new Set(['Config base', NODO_RECEPTOR, 'Verificar firma con el receptor', NODO_PRUEBA]);
  for (const n of nodos) {
    if (conMarcador.has(n.name)) continue;
    if (/REEMPLAZAR_[A-Z0-9]/.test(JSON.stringify(n))) h.push(`el nodo «${n.name}» trae un marcador REEMPLAZAR_: solo va en «Config base», el receptor y la ruta de prueba`);
  }
  return h;
}


// ----------------------------------------------------------------- la guardia de publicación (PR-5)
/**
 * El JSON versionado es técnicamente publicable (PR-3) pero NO debe llegar a n8n con marcadores `REEMPLAZAR_*` ni con plantillas de aviso que Meta no aprobó: con una plantilla
 * sin aprobar, fuera de la ventana de Rubén no sale ningún aviso («plantilla_no_configurada»), y un marcador en una ruta o en un identificador rompe la entrada del receptor.
 * Esto NO es una guardia del armado (el JSON versionado lleva marcadores a propósito: el repositorio es público): es la de PUBLICAR, y se corre sobre lo que se va a escribir.
 *
 *   flujo  el JSON a publicar (el versionado, o el `.local.json` que deja `preparar-import.sh`);
 *   datos  los datos (`configBase`): las plantillas se exigen APPROVED aquí también, porque de ahí sale «Config base» en el próximo armado.
 * Devuelve la lista de hallazgos (vacía si se puede publicar). Los marcadores se nombran, nunca se muestran sus valores.
 */
export const CLAVES_DE_PLANTILLA = [
  { estado: 'avisoComprobanteEstado', nombre: 'avisoComprobantePlantilla' },
  { estado: 'avisoConsultaEstado', nombre: 'avisoConsultaPlantilla' },
];
// Un marcador es CUALQUIER `REEMPLAZAR_` (sin distinguir mayúsculas, tras normalizar a NFKC); `REEMPLAZAR_*` y `REEMPLAZAR_…` son texto de comentarios y se quitan antes de mirar.
const MARCADOR_CRUDO = /reemplazar_/i;
// Tampoco lo es el literal de expresión regular `^REEMPLAZAR_/` que usa el código de los nodos para descartar marcadores sin llenar.
const sinComentarios = (t) => t.normalize('NFKC').replace(/\^REEMPLAZAR_\//gi, '').replace(/REEMPLAZAR_(?:\*|…|\.\.\.)/gi, '');
const hayMarcador = (t) => MARCADOR_CRUDO.test(sinComentarios(String(t)));
const VALOR_LLENO = (v) => typeof v === 'string' && v.trim() !== '' && !hayMarcador(v);

function hallazgosDePlantillas(cb, donde) {
  const h = [];
  if (!cb || typeof cb !== 'object') return [`${donde}: no trae los datos de las plantillas de aviso`];
  for (const { estado, nombre } of CLAVES_DE_PLANTILLA) {
    if (cb[estado] !== 'APPROVED') h.push(`${donde}: ${estado} es ${cb[estado] === undefined ? '«ausente»' : '(distinto de APPROVED)'} y tiene que ser APPROVED (Meta aún no aprobó la plantilla)`);
    if (!VALOR_LLENO(cb[nombre])) h.push(`${donde}: falta el nombre de la plantilla (${nombre})`);
  }
  if (!VALOR_LLENO(cb.avisoPlantillaIdioma)) h.push(`${donde}: falta el idioma de las plantillas (avisoPlantillaIdioma)`);
  return h;
}

/**
 * LA GUARDIA DE APERTURA (20/10/2026). Abrir el flujo al PÚBLICO exige los tres medios que un cliente real manda (audio, imagen/visión y documento) habilitados en `mediosHabilitados` de «Config base»
 * (hoy solo `imagen_comprobante` y `pdf_comprobante`: los comprobantes del cobro; no son los tres medios). Una PUBLICACIÓN DE PRUEBA con lista restringida sí se permite y se declara:
 *   prueba   `telefonosDePrueba` no vacío Y `modoApertura` ausente o «prueba»;
 *   público  `telefonosDePrueba` vacío o ausente, o `modoApertura` distinto de «prueba» (ante la duda, público: la guardia se equivoca hacia el lado que rechaza).
 * Los medios los implementa el flujo (nodos «Transcribir audio», «Ver imagen» y el documento de «Decidir turno»): esta guardia exige que los datos lo DECLAREN.
 */
export const MEDIOS_PARA_ABRIR = ['audio', 'imagen', 'documento'];
export function modoDeApertura(cb) {
  const c = cb && typeof cb === 'object' ? cb : {};
  // Una lista de prueba tiene al menos un DÍGITO (o es el marcador `REEMPLAZAR_*` que otra guardia obliga a sustituir): «,» o «   » no es una lista y deja el flujo abierto al público (hueco que declaró seguridad).
  const tel = typeof c.telefonosDePrueba === 'string' && (/\d/.test(c.telefonosDePrueba) || MARCADOR.test(c.telefonosDePrueba.trim())) ? c.telefonosDePrueba.trim() : '';
  const modo = c.modoApertura === undefined || c.modoApertura === null || c.modoApertura === '' ? 'prueba' : String(c.modoApertura);
  return tel !== '' && modo === 'prueba' ? 'prueba' : 'publico';
}
function hallazgosDeApertura(cb, donde) {
  if (!cb || typeof cb !== 'object' || modoDeApertura(cb) !== 'publico') return [];
  const medios = new Set(String(cb.mediosHabilitados === undefined || cb.mediosHabilitados === null ? '' : cb.mediosHabilitados).split(',').map((x) => x.trim()).filter(Boolean));
  const faltan = MEDIOS_PARA_ABRIR.filter((m) => !medios.has(m));
  return faltan.length ? [`${donde}: abrir al PÚBLICO exige los tres medios habilitados (mediosHabilitados) y faltan: ${faltan.join(', ')}; una publicación de prueba lleva telefonosDePrueba y no pone modoApertura en «publico»`] : [];
}
/** El modo con que se publicaría este flujo y estos datos: 'prueba' si los dos son de prueba, 'publico' si alguno abre al público. */
export function modoDePublicacion({ flujo, datos }) {
  const base = ((flujo && flujo.nodes) || []).find((n) => n.name === 'Config base');
  const lista = base && base.parameters && base.parameters.assignments && base.parameters.assignments.assignments;
  const cbFlujo = Array.isArray(lista) ? Object.fromEntries(lista.map((a) => [a.name, a.value])) : {};
  return modoDeApertura(cbFlujo) === 'publico' || modoDeApertura(datos && datos.configBase) === 'publico' ? 'publico' : 'prueba';
}

export function guardiaDePublicacion({ flujo, datos }) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  // 1. Marcadores sin sustituir, en cualquier parte del flujo (parámetros, credenciales, rutas). `REEMPLAZAR_…` con puntos suspensivos o `REEMPLAZAR_*` es texto de un comentario, no un marcador.
  // Se mira TODO el flujo (settings, pinData, staticData, connections, nivel superior), no solo `nodes`; si se puede, se atribuye al nodo.
  const marcadores = new Set();
  const marcasEn = (v) => (sinComentarios(JSON.stringify(v) || '').match(/reemplazar_[a-z0-9_\-]*/gi) || []);
  const enNodos = new Set();
  for (const n of nodos) for (const m of marcasEn(n)) { marcadores.add(`${m} (nodo «${n.name}»)`); enNodos.add(m); }
  const { nodes: _nodos, ...resto } = flujo || {};
  for (const [campo, valor] of Object.entries(resto)) for (const m of marcasEn(valor)) if (!enNodos.has(m) || campo === 'pinData' || campo === 'staticData') marcadores.add(`${m} (${campo === 'pinData' || campo === 'staticData' ? campo : `campo «${campo}»`})`);
  if (!nodos.length) h.push('el flujo no trae nodos');
  for (const m of marcadores) h.push(`marcador sin sustituir: ${m}`);
  // 2. Las plantillas, en lo que se publica («Config base»)…
  const base = nodos.find((n) => n.name === 'Config base');
  const lista = base && base.parameters && base.parameters.assignments && base.parameters.assignments.assignments;
  if (!Array.isArray(lista)) h.push('el flujo no trae «Config base»: no se puede comprobar el estado de las plantillas');
  else {
    const cbFlujo = Object.fromEntries(lista.map((a) => [a.name, a.value]));
    h.push(...hallazgosDePlantillas(cbFlujo, 'Config base'));
    h.push(...hallazgosDeApertura(cbFlujo, 'Config base'));
  }
  // 3. …y en los datos.
  h.push(...hallazgosDePlantillas(datos && datos.configBase, 'datos'));
  h.push(...hallazgosDeApertura(datos && datos.configBase, 'datos'));
  return h;
}

// ----------------------------------------------------------------- armar
const sinMarcas = (v, esCodigo) => {
  if (typeof v === 'string') return esCodigo ? !v.startsWith('@@') : !v.includes('@@');
  if (Array.isArray(v)) return v.every((x) => sinMarcas(x, false));
  if (v && typeof v === 'object') return Object.entries(v).every(([c, x]) => sinMarcas(x, c === 'jsCode'));
  return true;
};

/** Arma UNA variante del config con los datos ya validados. Devuelve el texto del JSON. */
export function armarRroca(proyecto, datos, v) {
  const prueba = v.archivo === 'rroca-ruben.prueba.json';
  const donde = v.archivo;
  const plantilla = JSON.parse(JSON.stringify(proyecto.plantilla));
  // Primero se quita lo que no corresponde: sus credenciales y rutas no tienen por qué estar resueltas.
  const quitar = new Set(Array.isArray(v.quitar) ? v.quitar : (v.quitar ? [v.quitar] : []));
  plantilla.nodes = plantilla.nodes.filter((n) => !quitar.has(n.name));
  for (const n of plantilla.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${donde} · ${n.name}`);
    // Antes de `armarVariante`, que rechaza una marca `@@` que no conoce.
    if (n.parameters && n.parameters.jsCode === MARCA_NUCLEO) n.parameters.jsCode = codigoConNucleo();
    for (const c of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|graph|entradaPrueba|medios|gemini)$/.exec(String(c.name));
      if (m) c.name = dato(datos, `credenciales.${m[1]}`, `${donde} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
  }
  // La cadena de envío común (no se copia), con las credenciales por NOMBRE. Cuelga de «Armar mensajes»; el resumen cuelga aparte y corre al final.
  injertar(plantilla, {
    credenciales: { graph: dato(datos, prueba ? 'credenciales.graphPrueba' : 'credenciales.graph', donde), ingesta: dato(datos, 'credenciales.ingesta', donde) },
    ingestaUrl: `https://${ANFITRION_CONSOLA}/ingesta`,
    desde: [5480, 160],
  });
  // Puerta de la entrega (propia): el reporte saliente cuelga de «¿Meta aceptó?». Solo se reencamina la CONEXIÓN de la cadena común; sus nodos quedan intactos.
  const reporta = plantilla.connections['¿Reportar? (saliente)'];
  if (!reporta || !reporta.main[0] || reporta.main[0].length !== 1 || reporta.main[0][0].node !== 'Reportar mensaje (saliente)') throw new Error(`${donde}: la cadena común cambió: «¿Reportar? (saliente)» ya no cuelga de «Reportar mensaje (saliente)»`);
  reporta.main[0] = [{ node: '¿Meta aceptó?', type: 'main', index: 0 }];
  // El reporte saliente de ESTE flujo (propio): igual al común, más el EVENTO del QR y el campo opcional `aviso` ('salio' | 'no_salio' | 'ninguno': lo que pasó con el aviso a Rubén en este turno; cualquier otro valor NO se envía). `qr_enviado` lleva `reglaCobro: 2` (solo el QR REAL: abre el cobro de 15 minutos, 3 intentos),
  // `referencia` (el pedido) y `monto` (el del catálogo): contra ese número coteja el servidor. El evento viaja SOLO si el envío principal (la imagen) fue aceptado: si cayó el respaldo
  // en texto, el cliente no tiene QR y el cobro no se abre.
  const rep = plantilla.nodes.find((n) => n.name === 'Reportar mensaje (saliente)');
  if (!rep || typeof rep.parameters.jsonBody !== 'string' || !rep.parameters.jsonBody.includes("evento: m.evento")) throw new Error(`${donde}: la cadena común cambió: «Reportar mensaje (saliente)» ya no arma el cuerpo esperado`);
  rep.parameters.jsonBody = "={{ (() => { const m = $('Armar mensajes').item.json; let principal = true; try { principal = !($('Enviar a WhatsApp').item.json || {}).error; } catch (e) { principal = true; } const r = { telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: ((($json || {}).messages || [])[0] || {}).id || '' }; if (typeof m.evento === 'string' && m.evento && principal) { r.evento = m.evento; if (m.reglaCobro === 2) r.reglaCobro = 2; if (m.referencia) r.referencia = m.referencia; if (m.monto !== undefined && m.monto !== null) r.monto = m.monto; } const av = (m.resumen || {}).aviso; if (av === 'salio' || av === 'no_salio' || av === 'ninguno') r.aviso = av; return JSON.stringify(r); })() }}";
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: v.archivo, nombre: dato(datos, prueba ? 'nombreFlujoPrueba' : 'nombreFlujo', donde), quitar: [] });
  const flujo = JSON.parse(texto);
  if (!sinMarcas(flujo, false)) throw new Error(`${donde}: quedó una marca @@ sin reemplazar`);
  return JSON.stringify(flujo, null, 2) + '\n';
}

/**
 * Arma (o verifica) las dos variantes. Devuelve un resultado por archivo. Lanza ante un dato inválido, una guardia violada en lo armado o una plantilla que falta.
 *   opciones: { carpeta, datos (ruta), verificar, tope }   (`tope` es para las pruebas)
 */
export function construir({ carpeta = AQUI, datos: rutaDatos = ARCHIVO_DE_DATOS, verificar = false, tope } = {}) {
  const datos = cargarDatos(rutaDatos);
  const proyecto = leerProyecto(carpeta, CONFIG, tope ? { tope } : {});
  return proyecto.variantes.map((v) => {
    const texto = armarRroca(proyecto, datos, v);
    const variante = v.archivo === 'rroca-ruben.prueba.json' ? 'prueba' : 'produccion';
    // Lo que se arma nunca viola las guardias…
    const propios = guardias(variante, JSON.parse(texto));
    if (propios.length) throw new Error(`${v.archivo}: ${propios.join('; ')}`);
    const ruta = join(carpeta, v.archivo);
    const actual = leerSiExiste(ruta, v.archivo);
    // …y el archivo VERSIONADO tampoco las viola (aunque alguien lo haya tocado a mano).
    let versionado = [];
    if (actual !== null) {
      try { versionado = guardias(variante, JSON.parse(actual)); } catch (x) { versionado = ['no es un JSON válido']; }
    }
    if (!verificar) escribirSinSeguirEnlaces(ruta, texto, v.archivo);
    return { archivo: v.archivo, nodos: JSON.parse(texto).nodes.length, existia: actual !== null, alDia: actual === texto, versionado };
  });
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--publicable')) {
    // --publicable [--flujo <json>] [--datos <json>]: solo lee. Sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal.
    const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
    const resto = args.filter((a, i) => a !== '--publicable' && a !== '--flujo' && a !== '--datos' && args[i - 1] !== '--flujo' && args[i - 1] !== '--datos');
    if (resto.length || args.includes('--verificar') || ['--flujo', '--datos'].some((n) => args.includes(n) && !opcion(n))) {
      console.error('✗ uso: construir.mjs --publicable [--flujo <json>] [--datos <json>]'); process.exit(2);
    }
    try {
      const rutaFlujo = opcion('--flujo') || join(AQUI, 'rroca-ruben.json');
      const textoFlujo = leerSiExiste(rutaFlujo, 'el flujo');
      if (textoFlujo === null) throw new Error(`no existe el flujo ${rutaFlujo}`);
      let flujoJson;
      try { flujoJson = JSON.parse(textoFlujo); } catch { throw new Error(`JSON inválido en ${rutaFlujo}`); }
      const hallazgos = guardiaDePublicacion({ flujo: flujoJson, datos: cargarDatos(opcion('--datos') || ARCHIVO_DE_DATOS) });
      if (hallazgos.length) {
        console.error('✗ El flujo de Rubén NO se puede publicar todavía:');
        for (const x of hallazgos) console.error(`  - ${x}`);
        process.exit(1);
      }
      const datosCli = cargarDatos(opcion('--datos') || ARCHIVO_DE_DATOS);
      console.log('✓ Sin marcadores REEMPLAZAR_* y con las plantillas de aviso APPROVED: se puede publicar (con la confirmación de publicar-flujo.sh).');
      console.log(modoDePublicacion({ flujo: flujoJson, datos: datosCli }) === 'prueba'
        ? '  Publicación de PRUEBA con lista restringida (telefonosDePrueba): NO se abre al público; abrirlo exige mediosHabilitados con audio, imagen y documento.'
        : '  Apertura al PÚBLICO: los tres medios (audio, imagen, documento) están habilitados.');
      process.exit(0);
    } catch (e) {
      // Un SyntaxError puede traer un fragmento del archivo: mensaje fijo, sin contenido.
      console.error(e instanceof SyntaxError ? '✗ JSON inválido' : `✗ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }
  const desconocidos = args.filter((a) => a !== '--verificar');
  if (desconocidos.length) { console.error(`✗ argumento desconocido: ${desconocidos.join(' ').slice(0, 60)}. Solo existen --verificar y --publicable; sin argumentos escribe los JSON.`); process.exit(2); }
  const verificar = args.includes('--verificar');
  try {
    let difiere = false;
    for (const r of construir({ verificar })) {
      if (!verificar) { console.log(`✓ ${r.archivo} escrito (${r.nodos} nodos)`); continue; }
      if (r.versionado.length) { difiere = true; console.error(`✗ ${r.archivo} ${r.versionado.join('; ')}`); }
      else if (!r.alDia) { difiere = true; console.error(`✗ ${r.archivo} ${r.existia ? 'difiere de lo que arma la plantilla' : 'no existe'}: corra «node construir.mjs»`); }
      else console.log(`✓ ${r.archivo} al día (${r.nodos} nodos)`);
    }
    process.exit(difiere ? 1 : 0);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
