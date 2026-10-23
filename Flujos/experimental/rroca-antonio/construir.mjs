#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de «El Puente» de Antonio (tenant rroca-antonio) desde la plantilla y los datos
 * =============================================================================
 *
 *   node Flujos/experimental/rroca-antonio/construir.mjs               escribe rroca-antonio.json y rroca-antonio.prueba.json
 *   node Flujos/experimental/rroca-antonio/construir.mjs --verificar   no escribe: sale 1 si un JSON versionado difiere de lo que se arma o viola una guardia
 *   node Flujos/experimental/rroca-antonio/construir.mjs --publicable [--flujo <json>] [--datos <json>] [--negocio <json>]
 *                                                       no escribe: sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal (PR-C; lo llama publicar-flujo.sh)
 *   (cualquier otro argumento se rechaza: la ayuda no existe como opción, para que nada escriba por error)
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos. El código de los nodos lo arma el armador genérico
 * `../comun-sin-agente/construir.mjs` (importado, no copiado) con el `CONFIG` de este archivo. Lo propio de este archivo:
 *
 *   - `@@dato:a.b.c@@` (en cualquier texto de la plantilla) por ese dato; `@@cred:ingesta|graph|entradaPrueba|gemini` (nombre de credencial) por el del archivo de datos;
 *   - `@@medio:<paquete>`: los tres módulos comunes de medios (`Flujos/src/core/medios/*.js`) se INCLUYEN desde su fuente, nunca se copian (la lectura la hace el armador
 *     genérico, dentro de la raíz `Flujos/`, sin seguir enlaces simbólicos);
 *   - «Config base» se llena con `configBase` (texto, número o booleano);
 *   - LA CADENA DE ENVÍO es común (`../comun-sin-agente/src/envio.mjs`, `injertar()`), con las credenciales por NOMBRE; la «puerta de la entrega» `¿Meta aceptó?` solo reencamina
 *     una conexión: el reporte saliente cuenta si Meta devolvió `messages[0].id` y ningún `error`;
 *   - dos variantes: PRODUCCIÓN (con la entrada verificada del receptor y sin «Entrada de prueba») y PRUEBA (al revés).
 *
 * LOS DATOS son `admin/scripts/datos/rroca-antonio/rroca-antonio.json` (zona Tenants: solo marcadores `REEMPLAZAR_*` para los identificadores y las rutas, nunca un token,
 * una ruta de webhook real, un teléfono ni un identificador de Meta).
 *
 * LAS GUARDIAS de lo armado (también se aplican al archivo versionado, aunque alguien lo haya tocado a mano):
 *   - ≤ 48 nodos; nunca un WhatsApp Trigger (prohibición 7); nunca `subscriptions` ni `subscribed_apps`; ni agente, ni memoria, ni modelo de chat de n8n;
 *   - producción: solo el webhook del receptor, sin «Entrada de prueba»; prueba: solo «Entrada de prueba» (con credencial de cabecera) y sin receptor;
 *   - la verificación del receptor: `wabaIdEsperado` FIJO (nunca una expresión), sin «Continue on Fail» ni `onError`, y «Descartar repetidos» entre ejecuciones;
 *   - un nodo HTTP solo habla con Meta, Gemini y las Functions de la consola; `REEMPLAZAR_*` solo donde se declara; ajustes de retención, orden y zona;
 *   - «Reportar mensaje (entrante)» va ARRIBA de la rama que responde (el reporte del entrante corre antes que el de la respuesta);
 *   - PR-B: la conversación está completa (cotejo, modelo, avisos a Antonio), así que el JSON ya NO lleva `meta.noPublicable` y la guardia EXIGE que no vuelva. OJO: que ya no lleve la marca NO significa que
 *     se pueda publicar: la guardia `--publicable` y la confirmación en `publicar-flujo.sh` son del PR-C, y hasta entonces este flujo no se publica ni se activa en un número real.
 */
import { closeSync, constants, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
import { injertar } from '../comun-sin-agente/src/envio.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const ARCHIVO_DE_DATOS = join(AQUI, '../../../admin/scripts/datos/rroca-antonio/rroca-antonio.json');
export const ARCHIVO_DE_NEGOCIO = join(AQUI, '../../../admin/scripts/datos/rroca-antonio/negocio-rroca-antonio.json');
export const TOPE_DE_NODOS = 48;
/** Los nodos de la conversación completa (PR-B): el cotejo del comprobante, el modelo y el aviso a Antonio. La guardia los exige. */
export const NODOS_DEL_AVISO = ['Armar avisos', '¿Hay avisos?', 'Enviar aviso'];
export const NODOS_DE_LA_CONVERSACION = ['Interpretar lectura', '¿Cotejar?', 'Cotejar en el servidor', '¿Conversar con el modelo?', 'Conversar con el modelo', '¿Falló la protección?', 'Reportar protección', '¿Cancelar cobro?', 'Cancelar cobro en el servidor'];

/**
 * El config del armador genérico. Vive aquí y no en un `construir.config.json`: el saneo del repo público trata todo JSON bajo `Flujos/` como un export de n8n.
 * `raiz` es `Flujos/`: de ahí se leen los módulos comunes de medios. Las variantes: PRODUCCIÓN y PRUEBA. El nombre del flujo sale de los datos.
 */
export const CONFIG = {
  plantilla: 'flujo.plantilla.json',
  raiz: '../..',
  librerias: ['src/lib/cobro.js', 'src/lib/avisos.js', 'src/lib/ra.js'],
  comun: ['src/nodos/_comun.js'],
  paquetes: {
    mensajes: ['../comun-sin-agente/src/mensajes.js'],
    filtro: ['../comun-sin-agente/src/filtro-redaccion.js'],
    'm-transcripcion': ['../../src/core/medios/preparar-transcripcion.js'],
    'm-imagen': ['../../src/core/medios/anuncio-por-titular.js', '../../src/core/medios/preparar-imagen.js'],
    'm-no-aceptado': ['../../src/core/medios/medio-no-aceptado.js'],
  },
  variantes: [
    { archivo: 'rroca-antonio.json', quitar: 'Entrada de prueba', nombre: 'se toma de los datos' },
    { archivo: 'rroca-antonio.prueba.json', quitar: ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'], nombre: 'se toma de los datos' },
  ],
};

/** Los nodos que los módulos comunes de medios leen por contrato (los exige `--verificar` y `--publicable`). */
export const NODOS_CONTRATO_MEDIOS = ['Normalizar entrada', 'Config del negocio', 'Obtener URL del medio (general)', 'Preparar transcripción', 'Preparar imagen', 'Medio no aceptado'];
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

// ----------------------------------------------------------------- los datos
const MARCADOR = /^REEMPLAZAR_[A-Z0-9_]+$/;
const FORMAS_CONFIG = {
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/,
  phoneNumberIdEsperado: /^(\d{6,25}|REEMPLAZAR_[A-Z0-9_]+)$/,
  numeroRecepcion: /^(\d{6,20}|REEMPLAZAR_[A-Z0-9_]+)$/,
  prefijosPermitidos: /^\d{1,4}(,\d{1,4})*$/,
  telefonosDePrueba: /^(\d{6,20}(,\d{6,20})*|REEMPLAZAR_[A-Z0-9_]+)$/,
  // El ÚNICO modelo de este flujo (decisión de Andres): gemini-3.5-flash-lite.
  modelo: /^gemini-3\.5-flash-lite$/,
  temperatura: /^(0|1|0\.\d{1,2})$/,
  // El plazo de entrega que se dice al cliente (P2): horas enteras de 0 (sin plazo) a 23 (nunca más que la ventana de 24 h).
  plazoEntregaHoras: /^([0-9]|1[0-9]|2[0-3])$/,
  // Las plantillas de aviso a Antonio. El estado es el de Meta: solo APPROVED habilita el aviso fuera de la ventana de Antonio; el nombre puede ser un marcador mientras no exista.
  avisoComprobantePlantilla: /^([a-z0-9_]{1,100}|REEMPLAZAR_[A-Z0-9_]+)$/,
  avisoConsultaPlantilla: /^([a-z0-9_]{1,100}|REEMPLAZAR_[A-Z0-9_]+)$/,
  avisoComprobanteEstado: /^(APPROVED|PENDING|REJECTED|PAUSED|DISABLED|IN_APPEAL)$/,
  avisoConsultaEstado: /^(APPROVED|PENDING|REJECTED|PAUSED|DISABLED|IN_APPEAL)$/,
  avisoPlantillaIdioma: /^[a-z]{2,3}(_[A-Z]{2})?$/,
  // Textos que ve el cliente: una frase, sin comillas dobles ni llaves ni saltos.
  garantiaTexto: /^[^"{}\r\n<>]{10,300}$/,
};
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;

/** Lee y valida el archivo de datos. Cada error nombra el campo. */
export function cargarDatos(ruta = ARCHIVO_DE_DATOS) {
  const texto = leerSiExiste(ruta, 'rroca-antonio.json');
  if (texto === null) throw new Error(`no existe el archivo de datos ${ruta}`);
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error('rroca-antonio.json: no es un JSON válido'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('rroca-antonio.json: tiene que ser un objeto');
  const errores = [];
  const cadena = (ruta2, v) => { if (typeof v !== 'string' || v.trim() === '') errores.push(`${ruta2}: falta`); };
  cadena('nombreFlujo', d.nombreFlujo);
  cadena('nombreFlujoPrueba', d.nombreFlujoPrueba);
  for (const c of ['ingesta', 'graph', 'graphPrueba', 'entradaPrueba', 'gemini', 'geminiPrueba']) cadena(`credenciales.${c}`, (d.credenciales || {})[c]);
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
  if (errores.length) throw new Error(`rroca-antonio.json: datos no válidos: ${errores.join('; ')}`);
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
  // La única excepción: «Descargar medio» baja el medio de la URL que le devuelve Meta (la anterior, «¿Tamaño aceptable?», exige https://lookaside.fbsbx.com/ y un tamaño).
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
  // PR-B: la conversación está completa y la marca de PR-A sobra. (Que no la lleve NO autoriza a publicar: la guardia de publicación es del PR-C.)
  if (flujo && flujo.meta && flujo.meta.noPublicable !== undefined) h.push('trae `meta.noPublicable`: la conversación ya está completa (PR-B) y la marca sobra');
  // La conversación completa: el cotejo del comprobante, el modelo y el aviso a Antonio. Sin el aviso, los textos que prometen que Antonio revisa no tendrían respaldo («solo se ofrece lo que se cumple»).
  for (const n of [...NODOS_DE_LA_CONVERSACION, ...NODOS_DEL_AVISO]) if (!nombres.has(n)) h.push(`falta el nodo «${n}» de la conversación completa (PR-B)`);
  const conex = (flujo && flujo.connections) || {};
  const destinosDe = (nombre, salida) => (((conex[nombre] || {}).main || [])[salida] || []).map((x) => x.node);
  if (nombres.has('Armar avisos') && !destinosDe('Armar avisos', 0).includes('¿Hay avisos?')) h.push('«Armar avisos» no está conectado a «¿Hay avisos?»');
  if (nombres.has('¿Hay avisos?') && !destinosDe('¿Hay avisos?', 0).includes('Enviar aviso')) h.push('«¿Hay avisos?» no envía por «Enviar aviso»');
  if (nombres.has('Enviar aviso') && !destinosDe('Enviar aviso', 0).includes('Armar mensajes')) h.push('«Enviar aviso» no cuelga de «Armar mensajes»: el aviso tiene que correr ANTES de armar el mensaje que dice si salió');
  if (nombres.has('¿Hay avisos?') && !destinosDe('¿Hay avisos?', 1).includes('Armar mensajes')) h.push('«¿Hay avisos?» no envía la rama sin aviso (salida 1) a «Armar mensajes»');
  const enviarAviso = por('Enviar aviso');
  if (enviarAviso && !((enviarAviso.credentials || {}).httpHeaderAuth || {}).name) h.push('«Enviar aviso» no lleva credencial (httpHeaderAuth)');
  if (enviarAviso && enviarAviso.onError !== 'continueRegularOutput') h.push('«Enviar aviso» no lleva `onError: continueRegularOutput`: si Meta lo rechaza, el turno se cortaría y el cliente quedaría sin respuesta');
  const codigoAvisos = String(p(por('Armar avisos')).jsCode || '');
  if (nombres.has('Armar avisos') && !(/raPlantilla\(/.test(codigoAvisos) && /avPlantilla\(/.test(codigoAvisos) && /RA_VENTANA_ANTONIO_MS/.test(codigoAvisos))) h.push('«Armar avisos» no lleva la plantilla ni la ventana de Antonio: el aviso fuera de las 24 h no saldría');
  // Un comprobante solo se coteja si hay un cobro real, y el modelo es el único permitido.
  const cotejar = por('Cotejar en el servidor');
  if (cotejar && !/cotejarComprobanteVenta$/.test(String(p(cotejar).url || ''))) h.push('«Cotejar en el servidor» no llama a cotejarComprobanteVenta');
  const modelo = por('Conversar con el modelo');
  if (modelo && !/^=?https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//.test(String(p(modelo).url || ''))) h.push('«Conversar con el modelo» no llama a Gemini');
  // El reporte saliente lleva el evento de protección (`no_contactar`) siempre, aunque salga el respaldo.
  const repSal = por('Reportar mensaje (saliente)');
  if (repSal && !/no_contactar/.test(String(p(repSal).jsonBody || ''))) h.push('«Reportar mensaje (saliente)» no reporta el evento `no_contactar` (condición dura del contrato del rescate)');
  // Los nodos de medios comunes tienen que estar, con los nombres que esos módulos leen por contrato.
  for (const n of NODOS_CONTRATO_MEDIOS) if (!nombres.has(n)) h.push(`falta el nodo «${n}» (contrato con los módulos comunes de medios)`);
  // El reporte del entrante corre ANTES que la rama que responde: «Reportar mensaje (entrante)» arriba de la «Puerta del turno» y de toda la rama de medios y de decisión.
  const rep = por('Reportar mensaje (entrante)');
  if (rep) {
    for (const n of nodos) {
      if (['Puerta del turno', '¿Bajar medio?', 'Obtener URL del medio (general)', 'Decidir turno', 'Armar mensajes'].includes(n.name) && !(rep.position[1] < n.position[1])) h.push(`«Reportar mensaje (entrante)» tiene que ir arriba de «${n.name}» en el lienzo`);
    }
  }
  // La variante de PRUEBA nunca usa credenciales de producción: ni la de Graph ni la de Gemini (los nodos de medios, el aviso, el envío y el modelo).
  if (variante === 'prueba') {
    for (const n of nodos) {
      for (const [tipo, c] of Object.entries(n.credentials || {})) {
        const nombreCred = String((c || {}).name || '');
        if ((tipo === 'googlePalmApi' && !/pruebas/i.test(nombreCred)) || (n.name !== NODO_PRUEBA && n.name !== 'Traer configuración' && n.name !== 'Reportar mensaje (entrante)' && n.name !== 'Reportar mensaje (saliente)' && n.name !== 'Cotejar en el servidor' && n.name !== 'Reportar protección' && n.name !== 'Cancelar cobro en el servidor' && tipo === 'httpHeaderAuth' && !/pruebas/i.test(nombreCred))) {
          h.push(`la prueba usa una credencial de producción en «${n.name}» (${tipo})`);
        }
      }
    }
  }
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

// ----------------------------------------------------------------- la guardia de publicación (PR-C)
/**
 * El JSON versionado es técnicamente armable pero NO debe llegar a n8n con marcadores `REEMPLAZAR_*`, con plantillas de aviso que Meta no aprobó, ni sin el
 * catálogo del negocio listo para cargar. Esto NO es una guardia del armado (el JSON versionado lleva marcadores a propósito: el repositorio es público): es la de PUBLICAR, y se corre sobre lo que se
 * va a escribir (el versionado, el `.local.json` o el flujo VIVO). Los mensajes nombran claves, marcadores y productos; NUNCA imprimen valores de los datos ni fragmentos del flujo.
 *   flujo    el JSON a publicar;   datos  `rroca-antonio.json` (`configBase`);   negocio  `negocio-rroca-antonio.json` (catálogo y marcadores del negocio).
 * Devuelve la lista de hallazgos (vacía si se puede publicar).
 */
export const CLAVES_DE_PLANTILLA = [
  { estado: 'avisoComprobanteEstado', nombre: 'avisoComprobantePlantilla' },
  { estado: 'avisoConsultaEstado', nombre: 'avisoConsultaPlantilla' },
];
/** Los 6 productos que lee el flujo (`RA_PRODUCTOS.catId`): el id sale de `idDe(nombre)` al cargar el negocio. */
export const IDS_DEL_CATALOGO = ['pack-completo', 'libro', 'workbook', 'guia-de-conversaciones', 'calendario-de-conexion', 'preguntas-profundas'];
const idDe = (nombre) => String(nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Un marcador es CUALQUIER `REEMPLAZAR_` (sin distinguir mayúsculas, tras normalizar a NFKC). Se quitan antes de mirar SOLO las formas que son texto de comentario de los módulos copiados
// (`REEMPLAZAR_*`, `REEMPLAZAR_…`, `REEMPLAZAR_...`, `REEMPLAZAR_` entre comillas invertidas) y los literales de expresión regular `/^REEMPLAZAR_/` y `/reemplazar_/i` con los que el código descarta marcadores.
const MARCADOR_CRUDO = /reemplazar_/i;
const sinComentarios = (t) => String(t).normalize('NFKC').replace(/\/\^?REEMPLAZAR_\/i?/gi, '').replace(/REEMPLAZAR_(?:\*|…|\.\.\.)/gi, '').replace(/`REEMPLAZAR_`/gi, '');
const hayMarcador = (t) => MARCADOR_CRUDO.test(sinComentarios(t));
const VALOR_LLENO = (v) => typeof v === 'string' && v.trim() !== '' && !hayMarcador(v);
const marcasEn = (v) => (sinComentarios(JSON.stringify(v) || '').match(/reemplazar_[a-z0-9_-]*/gi) || []);

function hallazgosDeConfig(cb, donde) {
  const h = [];
  if (!cb || typeof cb !== 'object') return [`${donde}: no trae la configuración base`];
  for (const { estado, nombre } of CLAVES_DE_PLANTILLA) {
    if (cb[estado] !== 'APPROVED') h.push(`${donde}: ${estado} es ${cb[estado] === undefined ? '«ausente»' : '(distinto de APPROVED)'} y tiene que ser APPROVED (Meta aún no aprobó la plantilla)`);
    if (!VALOR_LLENO(cb[nombre])) h.push(`${donde}: falta el nombre de la plantilla (${nombre})`);
  }
  if (!VALOR_LLENO(cb.avisoPlantillaIdioma)) h.push(`${donde}: falta el idioma de las plantillas (avisoPlantillaIdioma)`);
  return h;
}

function hallazgosDelNegocio(negocio) {
  const h = [];
  if (!negocio || typeof negocio !== 'object' || Array.isArray(negocio)) return ['negocio: no se pudo leer el archivo de datos del negocio'];
  // El número de recepción va como `numeroRecepcionMarcador` (lo resuelve la tabla local al cargar): es el único campo donde un REEMPLAZAR_ se tolera; cualquier otro es un dato sin cargar.
  const { negocio: n, ...resto } = negocio;
  const { numeroRecepcionMarcador: _n, ...restoNegocio } = n && typeof n === 'object' ? n : {};
  for (const m of new Set(marcasEn({ ...resto, negocio: restoNegocio }).map((x) => x.toUpperCase()))) h.push(`negocio: marcador sin sustituir: ${m}`);
  const cat = Array.isArray(negocio.catalogo) ? negocio.catalogo : [];
  if (!cat.length) h.push('negocio: el catálogo no está cargado');
  const porId = new Map(cat.filter((x) => x && typeof x === 'object').map((x) => [idDe(x.nombre), x]));
  for (const id of IDS_DEL_CATALOGO) {
    const it = porId.get(id);
    if (!it) { h.push(`negocio: falta el producto con id «${id}» en el catálogo`); continue; }
    if (it.activo !== true) h.push(`negocio: el producto «${id}» no está activo`);
    if (!(typeof it.precio === 'number' && Number.isFinite(it.precio) && it.precio > 0)) h.push(`negocio: el producto «${id}» no tiene un precio válido`);
  }
  return h;
}

/** Los nodos, las aristas y los módulos comunes de la rama de medios (audio, documento, imagen). Se exigen al PUBLICAR: sin ellos el flujo atendería medios a medias. */
export const NODOS_DE_MEDIOS = [...NODOS_CONTRATO_MEDIOS, '¿Bajar medio?', '¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', '¿Es un documento?', 'Transcribir audio', 'Describir documento', 'Describir imagen'];
export const ARISTAS_DE_MEDIOS = [
  ['¿Bajar medio?', 'Obtener URL del medio (general)'], ['¿Bajar medio?', 'Decidir turno'], ['Obtener URL del medio (general)', '¿Tamaño aceptable?'],
  ['¿Tamaño aceptable?', 'Descargar medio'], ['¿Tamaño aceptable?', 'Medio no aceptado'], ['Descargar medio', '¿Es audio?'],
  ['¿Es audio?', 'Transcribir audio'], ['¿Es audio?', '¿Es un documento?'], ['¿Es un documento?', 'Describir documento'], ['¿Es un documento?', 'Describir imagen'],
  ['Transcribir audio', 'Preparar transcripción'], ['Preparar transcripción', 'Decidir turno'], ['Describir documento', 'Preparar imagen'], ['Describir imagen', 'Preparar imagen'],
  ['Preparar imagen', 'Interpretar lectura'], ['Medio no aceptado', 'Decidir turno'],
];
const MODULOS_DE_MEDIOS = { 'Preparar transcripción': 'preparar-transcripcion.js', 'Preparar imagen': ['anuncio-por-titular.js', 'preparar-imagen.js'], 'Medio no aceptado': 'medio-no-aceptado.js' };
export function hallazgosDeMedios(flujo) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const por = (n) => nodos.find((x) => x.name === n);
  for (const n of NODOS_DE_MEDIOS) if (!por(n)) h.push(`medios: falta el nodo «${n}»`);
  const conex = (flujo && flujo.connections) || {};
  for (const [de, a] of ARISTAS_DE_MEDIOS) {
    if (por(de) && por(a) && !(conex[de] && (conex[de].main || []).some((s) => (s || []).some((x) => x.node === a)))) h.push(`medios: «${de}» no está conectado a «${a}»`);
  }
  for (const [nombre, archivos] of Object.entries(MODULOS_DE_MEDIOS)) {
    // «Preparar imagen» se arma con varios módulos (el reconocimiento por titular primero): cada uno tiene que estar entero y en ese orden.
    const codigo = String((por(nombre) && por(nombre).parameters || {}).jsCode || '');
    let desde = 0;
    for (const archivo of [archivos].flat()) {
      const fuente = readFileSync(join(AQUI, '../../src/core/medios', archivo), 'utf8');
      const i = codigo.indexOf(fuente, desde);
      if (por(nombre) && i < 0) { h.push(`medios: el código de «${nombre}» no es el del módulo común ${archivo}`); break; }
      desde = i + fuente.length;
    }
  }
  for (const n of ['Transcribir audio', 'Describir documento', 'Describir imagen']) {
    if (por(n) && !(((por(n).credentials || {}).googlePalmApi || {}).name)) h.push(`medios: «${n}» no lleva credencial de Gemini`);
  }
  return h;
}

export function guardiaDePublicacion({ flujo, datos, negocio }) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  if (!nodos.length) h.push('el flujo no trae nodos');
  // 1. Marcadores sin sustituir en CUALQUIER parte del JSON completo (nodos, conexiones, ajustes, pinData, staticData, nivel superior).
  for (const m of new Set(marcasEn(flujo).map((x) => x.toUpperCase()))) h.push(`marcador sin sustituir: ${m}`);
  // 2. Las plantillas, en lo que se publica («Config base»)…
  const base = nodos.find((n) => n.name === 'Config base');
  const lista = base && base.parameters && base.parameters.assignments && base.parameters.assignments.assignments;
  if (!Array.isArray(lista)) h.push('el flujo no trae «Config base»: no se puede comprobar el estado de las plantillas');
  else h.push(...hallazgosDeConfig(Object.fromEntries(lista.map((a) => [a.name, a.value])), 'Config base'));
  // 3. …en los datos…
  h.push(...hallazgosDeConfig(datos && datos.configBase, 'datos'));
  // 4. …y el catálogo y los ids del negocio.
  h.push(...hallazgosDelNegocio(negocio));
  // 5. …y la rama de medios completa.
  h.push(...hallazgosDeMedios(flujo));
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
export function armarAntonio(proyecto, datos, v) {
  const prueba = v.archivo === 'rroca-antonio.prueba.json';
  const donde = v.archivo;
  const plantilla = JSON.parse(JSON.stringify(proyecto.plantilla));
  // Primero se quita lo que no corresponde: sus credenciales y rutas no tienen por qué estar resueltas.
  const quitar = new Set(Array.isArray(v.quitar) ? v.quitar : (v.quitar ? [v.quitar] : []));
  plantilla.nodes = plantilla.nodes.filter((n) => !quitar.has(n.name));
  for (const n of plantilla.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${donde} · ${n.name}`);
    for (const c of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|graph|entradaPrueba|gemini)$/.exec(String(c.name));
      // La variante de PRUEBA nunca usa las credenciales de producción de Meta ni de Gemini: los nodos de medios, el aviso y el modelo van con las de prueba (como el envío).
      const clave = prueba && m && m[1] === 'graph' ? 'graphPrueba' : (prueba && m && m[1] === 'gemini' ? 'geminiPrueba' : (m ? m[1] : ''));
      if (m) c.name = dato(datos, `credenciales.${clave}`, `${donde} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
    // Los módulos comunes de medios se INCLUYEN desde su fuente (ya leída por el armador genérico, dentro de la raíz): el código queda tal cual, sin una sola edición.
    const js = n.parameters && n.parameters.jsCode;
    const m = typeof js === 'string' ? /^@@medio:([a-z0-9-]+)$/.exec(js) : null;
    if (m) {
      const fuente = proyecto.paquetes[m[1]];
      if (!fuente || fuente.length < 1) throw new Error(`${donde} · ${n.name}: el config no declara el paquete «${m[1]}»`);
      n.parameters.jsCode = fuente.join('\n\n') + '\n';
    }
  }
  // La cadena de envío común (no se copia), con las credenciales por NOMBRE. Cuelga de «Armar mensajes»; el resumen cuelga aparte y corre al final.
  injertar(plantilla, {
    credenciales: { graph: dato(datos, prueba ? 'credenciales.graphPrueba' : 'credenciales.graph', donde), ingesta: dato(datos, 'credenciales.ingesta', donde) },
    ingestaUrl: `https://${ANFITRION_CONSOLA}/ingesta`,
    entrada: 'Normalizar entrada',
    desde: [6200, 300],
  });
  // Puerta de la entrega (propia): el reporte saliente cuelga de «¿Meta aceptó?». Solo se reencamina la CONEXIÓN de la cadena común; sus nodos quedan intactos.
  const reporta = plantilla.connections['¿Reportar? (saliente)'];
  if (!reporta || !reporta.main[0] || reporta.main[0].length !== 1 || reporta.main[0][0].node !== 'Reportar mensaje (saliente)') throw new Error(`${donde}: la cadena común cambió: «¿Reportar? (saliente)» ya no cuelga de «Reportar mensaje (saliente)»`);
  reporta.main[0] = [{ node: '¿Meta aceptó?', type: 'main', index: 0 }];
  // El reporte saliente de ESTE flujo (propio): igual al común, más el EVENTO. `qr_enviado` lleva `reglaCobro: 2` (QR REAL: abre el cobro de 15 minutos, 3 intentos), `referencia` (el pedido) y `monto` (el
  // del catálogo): contra ese número coteja el servidor, y solo viaja si el envío principal (la imagen) fue aceptado (si cayó el respaldo en texto, el cliente no tiene QR y el cobro no se abre).
  // `no_contactar` (violencia o miedo) viaja SIEMPRE, aunque salga el respaldo: es la condición dura del contrato del rescate (ninguna protección puede quedar sin reportar).
  const rep = plantilla.nodes.find((n) => n.name === 'Reportar mensaje (saliente)');
  if (!rep || typeof rep.parameters.jsonBody !== 'string' || !rep.parameters.jsonBody.includes('evento: m.evento')) throw new Error(`${donde}: la cadena común cambió: «Reportar mensaje (saliente)» ya no arma el cuerpo esperado`);
  rep.parameters.jsonBody = "={{ (() => { const m = $('Armar mensajes').item.json; let principal = true; try { principal = !($('Enviar a WhatsApp').item.json || {}).error; } catch (e) { principal = true; } const r = { telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: ((($json || {}).messages || [])[0] || {}).id || '' }; if (m.evento === 'no_contactar') { r.evento = 'no_contactar'; } else if (typeof m.evento === 'string' && m.evento && principal) { r.evento = m.evento; if (m.reglaCobro === 2) r.reglaCobro = 2; if (m.referencia) r.referencia = m.referencia; if (m.monto !== undefined && m.monto !== null) r.monto = m.monto; } return JSON.stringify(r); })() }}";
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: v.archivo, nombre: dato(datos, prueba ? 'nombreFlujoPrueba' : 'nombreFlujo', donde), quitar: [] });
  const flujo = JSON.parse(texto);
  if (!sinMarcas(flujo, false)) throw new Error(`${donde}: quedó una marca @@ sin reemplazar`);
  return JSON.stringify(flujo, null, 2) + '\n';
}

/**
 * Arma (o verifica) las dos variantes. Devuelve un resultado por archivo. Lanza ante un dato inválido o una guardia violada en lo armado.
 *   opciones: { carpeta, datos (ruta), verificar, tope }   (`tope` es para las pruebas)
 */
export function construir({ carpeta = AQUI, datos: rutaDatos = ARCHIVO_DE_DATOS, verificar = false, tope } = {}) {
  const datos = cargarDatos(rutaDatos);
  const proyecto = leerProyecto(carpeta, CONFIG, tope ? { tope } : {});
  return proyecto.variantes.map((v) => {
    const texto = armarAntonio(proyecto, datos, v);
    const variante = v.archivo === 'rroca-antonio.prueba.json' ? 'prueba' : 'produccion';
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
    // --publicable [--flujo <json>] [--datos <json>] [--negocio <json>]: solo lee. Sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal.
    const OPCIONES = ['--flujo', '--datos', '--negocio'];
    const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
    const resto = args.filter((a, i) => a !== '--publicable' && !OPCIONES.includes(a) && !OPCIONES.includes(args[i - 1]));
    if (resto.length || args.includes('--verificar') || OPCIONES.some((n) => args.includes(n) && !opcion(n))) {
      console.error('✗ uso: construir.mjs --publicable [--flujo <json>] [--datos <json>] [--negocio <json>]'); process.exit(2);
    }
    // Un SyntaxError puede traer un fragmento del archivo: mensaje fijo, sin contenido.
    const leerJson = (ruta, que) => {
      const t = leerSiExiste(ruta, que);
      if (t === null) throw new Error(`no existe ${que}`);
      try { return JSON.parse(t); } catch { throw new Error(`JSON inválido en ${que}`); }
    };
    try {
      const flujoJson = leerJson(opcion('--flujo') || join(AQUI, 'rroca-antonio.json'), 'el flujo');
      const negocio = leerJson(opcion('--negocio') || ARCHIVO_DE_NEGOCIO, 'el archivo de datos del negocio');
      const hallazgos = guardiaDePublicacion({ flujo: flujoJson, datos: cargarDatos(opcion('--datos') || ARCHIVO_DE_DATOS), negocio });
      if (hallazgos.length) {
        console.error('✗ El flujo de Antonio NO se puede publicar todavía:');
        for (const x of hallazgos) console.error(`  - ${x}`);
        process.exit(1);
      }
      console.log('✓ Sin marcadores REEMPLAZAR_*, con las plantillas de aviso APPROVED y el catálogo listos: se puede publicar (con la confirmación de publicar-flujo.sh).');
      process.exit(0);
    } catch (e) {
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
