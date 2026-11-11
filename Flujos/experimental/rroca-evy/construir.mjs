#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON del flujo NUEVO de la Dra. Evy Karina (tenant rroca-evy) desde la plantilla, el prompt versionado y los datos
 * =============================================================================
 *
 *   node Flujos/experimental/rroca-evy/construir.mjs               escribe rroca-evy.json, rroca-evy.prueba.json y rroca-evy.ensayo-demo-a.json
 *   node Flujos/experimental/rroca-evy/construir.mjs --verificar   no escribe: sale 1 si un JSON versionado (las tres variantes) difiere de lo que se arma o viola una guardia
 *   node Flujos/experimental/rroca-evy/construir.mjs --publicable [--flujo <json>] [--datos <json>] [--negocio <json>] [--etapa crear|prueba|encender]
 *                                                                  GUARDIA DE PUBLICACIÓN: no escribe; sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal
 *   (cualquier otro argumento se rechaza: la ayuda no existe como opción, para que nada escriba por error)
 *
 * LA VARIANTE DE ENSAYO EN EL DEMO A (`rroca-evy.ensayo-demo-a.json`, datos en `admin/scripts/datos/rroca-evy/ensayo-demo-a.json`; procedimiento en `docs/ensayo/LEEME.md` §10), copia del patrón de Rubén. Se escribe y se verifica
 * junto con las otras dos, pero NUNCA se publica sobre el número de Evy: `--publicable` la rechaza. Cambia SOLO la entrada y lo que el Demo A no tiene: (1) en vez de la entrada verificada del receptor lleva un «WhatsApp Trigger»
 * (que `flujo-de-prueba.mjs --sobre-demo-a` reemplaza por el del Demo A vivo); (2) NO lleva la rama del miniCRM (el Demo A no tiene la credencial de la planilla de Evy): 53 - 8 - 6 + 1 = 40 nodos; (3) credenciales por nombre,
 * solo las del Demo A; (4) el interruptor `avisarAlPropioNumero` (solo `true`, solo en «Config base», solo en ese archivo de datos), que deja que el aviso y el botón a la recepción lleguen al MISMO teléfono de quien prueba;
 * (5) sin plantilla de aviso aprobada (PENDING: el aviso sale por texto libre), sin modo prueba, sin etapa de prueba y sin los ids de las tres imágenes (son de la WABA de Evy: esas imágenes no se envían en el Demo A).
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos. El código de los nodos lo arma el armador genérico `../comun-sin-agente/construir.mjs` (importado, no copiado) con el `CONFIG` de
 * este archivo. Lo propio de este archivo:
 *   - `@@dato:a.b.c@@` por ese dato; `@@cred:ingesta|graph|entradaPrueba|gemini` (nombre de credencial) por el del archivo de datos;
 *   - `@@medio:m-transcripcion`: el módulo común de medios (`Flujos/src/core/medios/preparar-transcripcion.js`) se INCLUYE desde su fuente, nunca se copia;
 *   - EL PROMPT: `prompts/evy.md` (versionado, sin teléfonos ni enlaces con dígitos) se pega como el paquete `prompt`; los marcadores `{{…}}` los sustituye el código EN CADA TURNO con datos de la Consola;
 *   - «Config base» se llena con `configBase` (texto, número o booleano);
 *   - LA CADENA DE ENVÍO es común (`../comun-sin-agente/src/envio.mjs`, `injertar()`), con las credenciales por NOMBRE;
 *   - dos variantes: PRODUCCIÓN (con la entrada verificada del receptor y sin «Entrada de prueba») y PRUEBA (al revés).
 *
 * LOS DATOS son `admin/scripts/datos/rroca-evy/rroca-evy.json` (zona Tenants: solo marcadores `REEMPLAZAR_*` para identificadores, rutas e ids de medios; nunca un token, una ruta real, un teléfono ni un id de Meta).
 *
 * LAS GUARDIAS de lo armado (también se aplican al archivo versionado, aunque alguien lo haya tocado a mano):
 *   - ≤ 36 nodos; nunca un WhatsApp Trigger (prohibición 7); nunca `subscriptions` ni `subscribed_apps`; ni agente, ni memoria, ni modelo de chat de n8n;
 *   - producción: solo el webhook del receptor, sin «Entrada de prueba»; prueba: solo «Entrada de prueba» (con credencial de cabecera) y sin receptor;
 *   - la verificación del receptor: `wabaIdEsperado` FIJO (nunca una expresión), sin «Continue on Fail» ni `onError`, y «Descartar repetidos» entre ejecuciones;
 *   - un nodo HTTP solo habla con Meta, Gemini y las Functions de la consola; `REEMPLAZAR_*` solo donde se declara; ajustes de retención, orden y zona;
 *   - «Reportar mensaje (entrante)» va ARRIBA de la rama que responde; «Enviar aviso» (imágenes y aviso) corre ANTES de «Armar mensajes»; la prueba nunca usa credenciales de producción.
 */
import { closeSync, constants, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
import { hallazgosCrm, injertarCrm, ramaCrm, rutasPaqueteCrmSenales, urlEncabezados, validarMapaCrm } from '../comun-sin-agente/construir-crm.mjs';
import { hallazgosDelEnvioRele, injertar, MARCADOR_URL_DEL_RELE, parametrosDeMensajeRele, PREFIJO_CREDENCIAL_RELE } from '../comun-sin-agente/src/envio.mjs';
import { hallazgosDelGuardado, injertarGuardado, NODOS_DE_INGESTA_DEL_GUARDADO, URL_DESCARGA_GUARDADO, urlDescargaRele } from '../comun-sin-agente/src/guardado.mjs';
import { textosDeHallazgos as hallazgosDeExpresionesN8n } from '../comun-sin-agente/src/expresiones.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const ARCHIVO_DE_DATOS = join(AQUI, '../../../admin/scripts/datos/rroca-evy/rroca-evy.json');
export const ARCHIVO_DE_NEGOCIO = join(AQUI, '../../../admin/scripts/datos/rroca-evy/negocio-rroca-evy.json');
export const ARCHIVO_DEL_PROMPT = join(AQUI, 'prompts/evy.md');
// 36 + los 11 de la rama común del GUARDADO de medios (Flujos/experimental/comun-sin-agente/src/guardado.mjs, contrato M1↔M2 del 29/10/2026):
// excepción declarada por Andres el 29/10/2026 para el guardado de medios, +9 nodos desde el contrato v2 del 30/10 (eran 11): docs/versiones-por-cliente.md.
// 45 + los 8 de la rama del miniCRM (`ramaCrm`, generada por el módulo `crm`; F1 del 31/10/2026): excepción de tope declarada por Andres (DP1, 31/10/2026) en docs/versiones-por-cliente.md.
// 53 + 3 del canal `rele` (relé B9, PR 2, 03/11/2026: «Leer respuesta del relé», «¿Qué hacer con el envío?», «Esperar reintento» y el nodo «Detener por envío incierto» (I4) menos lo que la cadena de Graph ya tenía): tope 56 APROBADO por Andres el 03/11/2026 (docs/versiones-por-cliente.md).
// «Tanda 1» de Evy (Andres, 07/11/2026): el canal de envío es `graph` (53 nodos) hasta que exista el relé de cliente08; con `rele` el tope es 56.
/** Canal de envío del flujo: 'graph' (envío directo por Graph, como el flujo vivo) o 'rele' (relé B9 de AAB1). Poner 'rele' cuando el relé B9 de cliente08 esté listo (credencial en n8n y URL interna): ver docs/versiones-por-cliente.md. */
export const CANAL_DE_ENVIO = 'graph';
export const ES_RELE = CANAL_DE_ENVIO === 'rele';
export const TOPE_DE_NODOS = ES_RELE ? 56 : 53;
/** El relé B9 de AAB1 (canal `rele`): el prefijo de la Idempotency-Key y la credencial Header Auth de ESTE WABA, por NOMBRE (el valor lo tiene n8n). La URL interna del relé es un marcador que sustituye el publicador. */
export const CLIENTE_RELE = 'rroca-evy';
export const CREDENCIAL_RELE = 'AAB1 envío · cliente08';
/** Los tres nodos que bajan o mandan medios en la conversación hablan con el relé; el resto de la cadena la injerta el módulo común. */
const releGeneral = (n) => [MARCADOR_URL_DEL_RELE, '/v1/envio/'].every((x) => String(n.parameters.url || '').includes(x));
/** Los 8 nodos de la rama del miniCRM (el módulo `crm` los genera). */
export const NODOS_DE_CRM = ['Prospecto para la planilla', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Decidir fila de la planilla', '¿Acción de la planilla?', 'Agregar fila', 'Actualizar fila'];
export const CREDENCIAL_CRM = (tenant) => `Google Sheets miniCRM (crm-${tenant})`;
export const ARCHIVO_PRODUCCION = 'rroca-evy.json';
export const ARCHIVO_PRUEBA = 'rroca-evy.prueba.json';
// La variante de ENSAYO en el Demo A: sus datos, su salida y el interruptor que solo ella puede llevar.
export const ARCHIVO_DE_DATOS_ENSAYO = join(AQUI, '../../../admin/scripts/datos/rroca-evy/ensayo-demo-a.json');
export const SALIDA_ENSAYO = 'rroca-evy.ensayo-demo-a.json';
export const CLAVE_SOLO_ENSAYO = 'avisarAlPropioNumero';
const DATOS_CON_LA_CLAVE = 'ensayo-demo-a.json';
/** Las credenciales del Demo A, por nombre (la herramienta `flujo-de-prueba.mjs --sobre-demo-a` las resuelve por id y se niega con cualquier otra). */
export const CREDENCIALES_DEL_DEMO_A = {
  httpHeaderAuth: ['Cierres NovuChat A (auto)', 'Graph WhatsApp Demo A (Bearer)'],
  googlePalmApi: ['Google Gemini(PaLM) Api account'],
  whatsAppTriggerApi: ['WhatsApp OAuth account'],
  whatsAppApi: ['WhatsApp account'],
};
const LECTURA_DE_LA_CLAVE = new RegExp(`base\\.${CLAVE_SOLO_ENSAYO}`);
const NOMBRE_GRAPH_DEL_DEMO_A = 'Graph WhatsApp Demo A (Bearer)';
const NOMBRE_INGESTA_DEL_DEMO_A = 'Cierres NovuChat A (auto)';
const NODO_TRIGGER = 'WhatsApp Trigger';
/** Los dos marcadores del ensayo: el phone id del Demo A y el teléfono de quien prueba (los repone `preparar-import.sh` desde la tabla local, nunca el repositorio). */
export const MARCADORES_DEL_ENSAYO = ['REEMPLAZAR_PHONE_NUMBER_ID', 'REEMPLAZAR_NUMERO_AVISO_ENSAYO'];
/** Lo que el ensayo no tiene: el receptor y la «Entrada de prueba» (su entrada es el Trigger del Demo A). */
const QUITAR_EN_EL_ENSAYO = ['Entrada de prueba', 'Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'];
// Los dos nodos que bajan un medio con una URL que Meta devuelve en su respuesta: lista CERRADA, con su expresión EXACTA y la credencial de Graph. Cualquier otro nodo con la URL dinámica es un hallazgo.
const URL_DE_META_POR_NODO = {
  'Descargar medio': '={{ $json.url }}',
  'Descargar medio (guardado)': URL_DESCARGA_GUARDADO,
};
const NODOS_CON_URL_DE_META = Object.keys(URL_DE_META_POR_NODO);

/** El config del armador genérico. Vive aquí y no en un `construir.config.json`: el saneo del repo público trata todo JSON bajo `Flujos/` como un export de n8n. `raiz` es `Flujos/`. */
export const CONFIG = {
  plantilla: 'flujo.plantilla.json',
  raiz: '../..',
  librerias: ['src/lib/ev.js'],
  comun: ['src/nodos/_comun.js'],
  paquetes: {
    mensajes: ['../comun-sin-agente/src/mensajes.js'],
    filtro: ['../comun-sin-agente/src/filtro-redaccion.js'],
    avisos: ['../venta-minima/src/lib/avisos.js'],
    prompt: ['src/lib/prompt-vacio.js'],
    'm-transcripcion': ['../../src/core/medios/preparar-transcripcion.js'],
    // El miniCRM es un módulo (nunca se copia): los paquetes de código del adaptador general de señales.
    ...Object.fromEntries(Object.entries(rutasPaqueteCrmSenales()).map(([k, rutas]) => [k, rutas.map((r) => relative(AQUI, r))])),
  },
  variantes: [
    { archivo: ARCHIVO_PRODUCCION, quitar: 'Entrada de prueba', nombre: 'se toma de los datos' },
    { archivo: ARCHIVO_PRUEBA, quitar: ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'], nombre: 'se toma de los datos' },
  ],
};

/** El flujo: lo que tiene que estar siempre (la guardia lo exige). */
export const NODOS_DE_LA_CONVERSACION = ['¿Conversar con el modelo?', 'Conversar con el modelo', 'Armar previos', '¿Hay previos?', 'Enviar aviso', 'Armar mensajes', 'Resumen del turno'];
export const NODOS_DE_MEDIOS = ['¿Bajar medio?', 'Obtener URL del medio (general)', '¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', 'Transcribir audio', 'Preparar transcripción', 'Ver imagen'];
export const ARISTAS_DE_MEDIOS = [
  ['¿Bajar medio?', 'Obtener URL del medio (general)'], ['¿Bajar medio?', 'Decidir turno'], ['Obtener URL del medio (general)', '¿Tamaño aceptable?'],
  ['¿Tamaño aceptable?', 'Descargar medio'], ['¿Tamaño aceptable?', 'Decidir turno'], ['Descargar medio', '¿Es audio?'],
  ['¿Es audio?', 'Transcribir audio'], ['¿Es audio?', 'Ver imagen'], ['Transcribir audio', 'Preparar transcripción'], ['Preparar transcripción', 'Decidir turno'], ['Ver imagen', 'Decidir turno'],
];
const NODO_PRUEBA = 'Entrada de prueba';
const NODO_RECEPTOR = 'Entrega del receptor';
const NODOS_DEL_RECEPTOR = [NODO_RECEPTOR, 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'];
const ANFITRION_CONSOLA = 'us-east1-novuchat-demo.cloudfunctions.net';
const ANFITRIONES = ['graph.facebook.com', 'generativelanguage.googleapis.com', ANFITRION_CONSOLA];

/** El HOST de la parte FIJA de la URL de un nodo (lo que hay antes de cualquier `{{ }}`), en minúsculas, o null si no se puede leer con certeza (espacio inicial, http, `//host`, usuario@host, host partido en una expresión, URL toda dinámica). Una lista de permitidos por destino, no una expresión sobre el host. */
export function hostDeUrl(url) {
  const t = String(url ?? '').replace(/^=/, '');
  const fija = t.split('{{')[0];
  // Con una expresión en la URL, la parte fija tiene que cerrar el host con `/`, `?` o `#`: si no, la expresión podría seguir armando el host (`graph.facebook.com{{ ".evil.com" }}/`).
  const m = (t.includes('{{') ? /^https:\/\/([a-z0-9.-]+)(?::\d+)?(?=[\/?#])/i : /^https:\/\/([a-z0-9.-]+)(?::\d+)?(?=[\/?#]|$)/i).exec(fija);
  return m ? m[1].toLowerCase() : null;
}
/** Hallazgos de destino de un nodo httpRequest de la variante de ensayo. */
export function hallazgosDeDestino(n) {
  const h = [];
  if (n.type !== 'n8n-nodes-base.httpRequest') return h;
  const cred = ((n.credentials || {}).httpHeaderAuth || {}).name;
  const host = hostDeUrl(((n.parameters || {}).url));
  if (host === null) {
    if (!(NODOS_CON_URL_DE_META.includes(n.name) && cred === NOMBRE_GRAPH_DEL_DEMO_A && ((n.parameters || {}).url) === URL_DE_META_POR_NODO[n.name])) h.push(`ensayo: «${n.name}» tiene una URL cuyo destino no es fijo ni verificable (solo ${NODOS_CON_URL_DE_META.join(' y ')} bajan la URL que devuelve Meta, con su expresión EXACTA y la credencial de Graph)`);
    return h;
  }
  if (!ANFITRIONES.includes(host)) h.push(`ensayo: «${n.name}» llama a un destino que no es de la lista permitida (${host})`);
  if (host === 'graph.facebook.com' && cred !== NOMBRE_GRAPH_DEL_DEMO_A) h.push(`ensayo: «${n.name}» llama a graph.facebook.com sin la credencial de Graph del Demo A (con la de la ingesta le mandaría su token a Meta: la trampa del 15/09)`);
  if (cred === NOMBRE_INGESTA_DEL_DEMO_A && host !== ANFITRION_CONSOLA) h.push(`ensayo: «${n.name}» lleva la credencial de la ingesta fuera de su host (${host})`);
  if (cred === NOMBRE_GRAPH_DEL_DEMO_A && host !== 'graph.facebook.com') h.push(`ensayo: «${n.name}» lleva la credencial de Graph fuera de graph.facebook.com (${host}): el token de Meta se iría a otro destino`);
  return h;
}

// ----------------------------------------------------------------- lectura y escritura sin seguir enlaces simbólicos
const noExiste = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
export function leerSiExiste(ruta, nombre) {
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

// ----------------------------------------------------------------- el prompt versionado
/** El prompt (MD) no lleva teléfonos, enlaces `wa.me` con dígitos ni números de 7 o más dígitos: lo comprueba el armado. Devuelve la lista de hallazgos. */
export function hallazgosDelPrompt(md) {
  const h = [];
  const t = String(md);
  if (/wa\.me\/\s*\+?\d/i.test(t)) h.push('el prompt trae un enlace wa.me con dígitos');
  if (/\+?\d(?:[\s.-]?\d){6,}/.test(t)) h.push('el prompt trae un número de 7 o más dígitos (¿un teléfono?)');
  if (/https?:\/\//i.test(t)) h.push('el prompt trae un enlace');
  for (const m of ['NEGOCIO', 'CLINICA', 'DIRECCION', 'HORARIO', 'RECEPCION_LINK']) if (!t.includes(`{{${m}}}`)) h.push(`al prompt le falta el marcador {{${m}}}`);
  const abre = (t.match(/\{\{[#^]MARCAS\}\}/g) || []).length;
  const cierra = (t.match(/\{\{\/MARCAS\}\}/g) || []).length;
  if (abre !== cierra) h.push('los bloques {{#MARCAS}} / {{^MARCAS}} no cierran todos');
  return h;
}
export function leerPrompt(ruta = ARCHIVO_DEL_PROMPT) {
  const md = leerSiExiste(ruta, 'prompts/evy.md');
  if (md === null) throw new Error('falta prompts/evy.md');
  const h = hallazgosDelPrompt(md);
  if (h.length) throw new Error(`prompts/evy.md: ${h.join('; ')}`);
  return md;
}

// ----------------------------------------------------------------- las referencias a otros nodos (reutilizable: recibe un flujo, no depende de este)
/**
 * El task runner de n8n decide qué nodos precarga ESCANEANDO el código: un nodo con SOLO referencias dinámicas (`cnNodo(nombre)`, `$(variable)`) recibe todos; uno con algún literal `$('X')` recibe SOLO los nombrados
 * literalmente. Por eso: (1) todo literal `$('X')`, `$("X")`, `$node['X']`, `$items('X')` nombra un nodo que EXISTE y es ANTECESOR; (2) un nodo con al menos un literal NO puede alcanzar a otro nodo de forma dinámica o por
 * `cnNodo('Y')`/`cnPrimero('Y')`/`cnTodos('Y')` sin nombrar también `$('Y')` en un literal (un nodo MIXTO falla en n8n real). Los comentarios no cuentan. Se recorre el código (`jsCode`) y las expresiones `={{ … }}`.
 */
const REF_LITERAL = [/\$\(\s*(['"])((?:(?!\1).)+)\1\s*\)/g, /\$node\[\s*(['"])((?:(?!\1).)+)\1\s*\]/g, /\$items\(\s*(['"])((?:(?!\1).)+)\1/g];
const REF_AYUDA = /(?<!function\s)\bcn(?:Nodo|Primero|Todos)\(\s*(['"])((?:(?!\1).)+)\1/g;
const REF_DINAMICA = [/\$\(\s*(?!['"\s])/, /\$node\[\s*(?!['"\s])/, /\$items\(\s*(?!['"\s])/, /(?<!function\s)\bcn(?:Nodo|Primero|Todos)\(\s*(?!['"\s])/];
const sinComentariosDeCodigo = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\w'"`])\/\/[^\n]*/g, '$1 ');
function cadenasDe(v, campo = '') {
  if (typeof v === 'string') return [{ campo, texto: v }];
  if (Array.isArray(v)) return v.flatMap((x) => cadenasDe(x, campo));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => cadenasDe(x, k));
  return [];
}
export function referenciasDeNodos(nodos) {
  return (Array.isArray(nodos) ? nodos : []).map((n) => {
    const literales = []; const ayuda = []; let dinamica = false;
    for (const { campo, texto } of cadenasDe(n.parameters || {})) {
      const t = campo === 'jsCode' ? sinComentariosDeCodigo(texto) : texto;
      if (campo !== 'jsCode' && !t.startsWith('=')) continue;
      for (const re of REF_LITERAL) for (const m of t.matchAll(new RegExp(re.source, 'g'))) literales.push(m[2]);
      for (const m of t.matchAll(new RegExp(REF_AYUDA.source, 'g'))) ayuda.push(m[2]);
      if (REF_DINAMICA.some((re) => re.test(t))) dinamica = true;
    }
    return { nodo: n.name, literales, ayuda, dinamica };
  });
}
export function antecesoresDe(flujo) {
  const padres = new Map((flujo.nodes || []).map((n) => [n.name, new Set()]));
  for (const [de, salidas] of Object.entries(flujo.connections || {})) for (const salida of (salidas.main || [])) for (const c of (salida || [])) if (padres.has(c.node)) padres.get(c.node).add(de);
  const todos = new Map();
  for (const n of flujo.nodes || []) {
    const vistos = new Set(); const pila = [...padres.get(n.name)];
    while (pila.length) { const x = pila.pop(); if (vistos.has(x)) continue; vistos.add(x); pila.push(...(padres.get(x) || [])); }
    todos.set(n.name, vistos);
  }
  return todos;
}
export function problemasDeReferencias(flujo) {
  const existen = new Set((flujo.nodes || []).map((n) => n.name));
  const antes = antecesoresDe(flujo);
  const p = [];
  for (const r of referenciasDeNodos(flujo.nodes)) {
    for (const nombre of r.literales) {
      if (!existen.has(nombre)) p.push(`«${r.nodo}» nombra «${nombre}», que NO existe en este flujo`);
      else if (!antes.get(r.nodo).has(nombre)) p.push(`«${r.nodo}» nombra «${nombre}», que existe pero NO es su antecesor en el grafo`);
    }
    if (r.literales.length) {
      if (r.dinamica) p.push(`«${r.nodo}» mezcla referencias literales con referencias dinámicas a otros nodos: n8n solo precarga los nombrados con literal`);
      for (const y of new Set(r.ayuda)) if (!r.literales.includes(y)) p.push(`«${r.nodo}» alcanza «${y}» por cn*() sin nombrarlo también con $('${y}') literal: n8n no lo precargaría`);
    }
  }
  return p;
}

// ----------------------------------------------------------------- los datos
const MARCADOR = /^REEMPLAZAR_[A-Z0-9_]+$/;
const FORMAS_CONFIG = {
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/,
  phoneNumberIdEsperado: /^(\d{6,25}|REEMPLAZAR_[A-Z0-9_]+)$/,
  numeroRecepcion: /^(\d{6,20}|REEMPLAZAR_[A-Z0-9_]+)$/,
  prefijosPermitidos: /^\d{1,4}(,\d{1,4})*$/,
  telefonosDePrueba: /^(\d{6,20}(,\d{6,20})*|REEMPLAZAR_[A-Z0-9_]+)$/,
  // La etapa de prueba: `si` la enciende; vacío o el marcador la dejan apagada (`Config del negocio` solo reconoce `si`).
  etapaPrueba: /^(si|REEMPLAZAR_[A-Z0-9_]+)?$/,
  // D6 (Andres, 23/10/2026): `si` enciende el texto con marcas (Radiesse®, HArmonyCa™) y el comparativo; vacío lo apaga.
  usarMarcas: /^(si)?$/,
  // Texto literal de campaña (Andres, 07/11/2026): la frase exacta de entrada (20 a 200 caracteres, sin comillas dobles, llaves, corchetes ni saltos) y el texto fijo que recibe (50 a 1500; sin comillas dobles, barra invertida, llaves, corchetes ni signos < >).
  campanaFrase: /^[^"{}\r\n<>\\\[\]]{20,200}$/,
  campanaTexto: /^[^"{}<>\\\[\]=][^"{}<>\\\[\]]{49,1499}$/,
  // El ÚNICO modelo de este flujo (decisión de Andres): gemini-3.5-flash-lite.
  modelo: /^gemini-3\.5-flash-lite$/,
  temperatura: /^(0|1|0\.\d{1,2})$/,
  // La plantilla UTILITY del aviso a recepción. El estado es el de Meta: solo APPROVED habilita el aviso fuera de la ventana de la recepción.
  avisoSolicitudPlantilla: /^([a-z0-9_]{1,100}|REEMPLAZAR_[A-Z0-9_]+)$/,
  avisoSolicitudEstado: /^(APPROVED|PENDING|REJECTED|PAUSED|DISABLED|IN_APPEAL)$/,
  avisoPlantillaIdioma: /^[a-z]{2,3}(_[A-Z]{2})?$/,
  mediosHabilitados: /^[a-z_]{1,40}(,[a-z_]{1,40})*$/,
  // Los ids de medio de Meta de las tres imágenes: un marcador hasta que la tabla local los resuelva (dígitos).
  arteComparativoMediaId: /^(\d{6,25}|REEMPLAZAR_MEDIA_ID_[A-Z0-9_]+)$/,
  arteAntesDespuesMediaId: /^(\d{6,25}|REEMPLAZAR_MEDIA_ID_[A-Z0-9_]+)$/,
  arteAutoridadMediaId: /^(\d{6,25}|REEMPLAZAR_MEDIA_ID_[A-Z0-9_]+)$/,
  topeImagenesDia: /^([0-9]|1[0-9]|20)$/,
  topeAudiosDia: /^([0-9]|[12][0-9]|30)$/,
  topeAvisosHora: /^([0-9]|[1-9][0-9]|1[01][0-9]|120)$/,
  // La planilla del miniCRM: el id de la hoja de Google (un marcador en el repositorio) y el nombre de su pestaña.
  planillaProspectosId: /^(REEMPLAZAR_[A-Z0-9_]+|[A-Za-z0-9_-]{25,100})$/,
  planillaProspectosHoja: /^[\p{L}\p{N}_ .-]{1,100}$/u,
};
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;
// Los textos de «Config base» que viajan a un mensaje o al prompt: sin enlaces, sin llaves ni corchetes.
const TEXTOS_LIBRES = ['nombreNegocio', 'clinica', 'direccionRespaldo', 'mensajeComercioSuspendido'];

/** Lee y valida el archivo de datos. Cada error nombra el campo. */
export function cargarDatos(ruta = ARCHIVO_DE_DATOS) {
  const texto = leerSiExiste(ruta, 'rroca-evy.json');
  if (texto === null) throw new Error(`no existe el archivo de datos ${ruta}`);
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error('rroca-evy.json: no es un JSON válido'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('rroca-evy.json: tiene que ser un objeto');
  return validarDatos(d, 'rroca-evy.json', false);
}

/** El interruptor de ensayo NO se hereda ni se cuela: ningún archivo de datos de la carpeta salvo `ensayo-demo-a.json` puede nombrarlo (se mira el TEXTO crudo, antes de mezclar nada). */
export function vigilarInterruptor(carpetaDeDatos = dirname(ARCHIVO_DE_DATOS)) {
  for (const archivo of readdirSync(carpetaDeDatos).filter((f) => f.endsWith('.json')).sort()) {
    if (archivo === DATOS_CON_LA_CLAVE) continue;
    const t = leerSiExiste(join(carpetaDeDatos, archivo), archivo);
    if (t !== null && t.includes(CLAVE_SOLO_ENSAYO)) throw new Error(`${archivo}: «${CLAVE_SOLO_ENSAYO}» es un interruptor solo de ensayo y solo puede estar en ${DATOS_CON_LA_CLAVE} (ni heredada de otro archivo de datos)`);
  }
}

/**
 * Los datos de la variante de ENSAYO: heredan de `rroca-evy.json` (`hereda`) y cambian lo que dicen (`credenciales` y `configBase` se mezclan campo a campo). Se valida el resultado con las
 * mismas reglas y, además, las propias del ensayo: el interruptor vale `true` EXACTO y solo está en «configBase» de este archivo; las credenciales son las del Demo A.
 */
export function cargarDatosEnsayo(ruta = ARCHIVO_DE_DATOS_ENSAYO, rutaBase = ARCHIVO_DE_DATOS) {
  vigilarInterruptor(dirname(rutaBase));
  const base = cargarDatos(rutaBase);
  const texto = leerSiExiste(ruta, DATOS_CON_LA_CLAVE);
  if (texto === null) throw new Error(`no existe el archivo de datos del ensayo ${ruta}`);
  let e;
  try { e = JSON.parse(texto); } catch (x) { throw new Error(`${DATOS_CON_LA_CLAVE}: no es un JSON válido`); }
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${DATOS_CON_LA_CLAVE}: tiene que ser un objeto`);
  if (e.hereda !== 'rroca-evy') throw new Error(`${DATOS_CON_LA_CLAVE}: hereda tiene que ser «rroca-evy»`);
  const { hereda: _h, ...propios } = e;
  const mezcla = {
    ...base, ...propios,
    credenciales: { ...base.credenciales, ...(propios.credenciales || {}) },
    configBase: { ...base.configBase, ...(propios.configBase || {}) },
  };
  return validarDatos(mezcla, DATOS_CON_LA_CLAVE, true);
}

/** Valida los datos ya leídos (el de producción y el de ensayo, mezclado). `ensayo`: reglas propias de la variante de ensayo. */
function validarDatos(d, nombreDelArchivo, ensayo) {
  const errores = [];
  const cb0 = d.configBase && typeof d.configBase === 'object' && !Array.isArray(d.configBase) ? d.configBase : null;
  if (cb0 && Object.prototype.hasOwnProperty.call(cb0, CLAVE_SOLO_ENSAYO)) {
    if (!ensayo) errores.push(`configBase.${CLAVE_SOLO_ENSAYO}: interruptor solo de ensayo; solo puede estar en ${DATOS_CON_LA_CLAVE}`);
    else if (cb0[CLAVE_SOLO_ENSAYO] !== true) errores.push(`configBase.${CLAVE_SOLO_ENSAYO}: solo vale el booleano true`);
  } else if (ensayo) errores.push(`configBase.${CLAVE_SOLO_ENSAYO}: falta (el ensayo con un solo teléfono lo necesita)`);
  // La clave, fuera de «configBase» (como propiedad de la raíz o dentro de otro bloque), no vale en ningún archivo.
  const fueraDeConfig = Object.keys(d).filter((k) => k !== 'configBase' && (k === CLAVE_SOLO_ENSAYO || JSON.stringify(d[k]).includes(CLAVE_SOLO_ENSAYO)));
  for (const k of fueraDeConfig) errores.push(`${k}: nombra ${CLAVE_SOLO_ENSAYO}, que solo vale en configBase de ${DATOS_CON_LA_CLAVE}`);
  if (ensayo) {
    const cr = d.credenciales || {};
    const permitidas = Object.values(CREDENCIALES_DEL_DEMO_A).flat();
    for (const c of ['ingesta', 'graph', 'gemini', 'trigger']) {
      if (typeof cr[c] !== 'string' || !permitidas.includes(cr[c])) errores.push(`credenciales.${c}: tiene que ser una credencial del Demo A (${permitidas.join(', ')})`);
    }
    if (cr.graph !== NOMBRE_GRAPH_DEL_DEMO_A) errores.push(`credenciales.graph: tiene que ser «${NOMBRE_GRAPH_DEL_DEMO_A}» (la herramienta la cambia a la credencial predefinida de WhatsApp)`);
  }
  const cadena = (ruta2, v) => { if (typeof v !== 'string' || v.trim() === '') errores.push(`${ruta2}: falta`); };
  cadena('tenant', d.tenant);
  if (d.tenant !== 'rroca-evy') errores.push('tenant: tiene que ser rroca-evy');
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
    for (const c of ['planillaProspectosId', 'planillaProspectosHoja']) if (cb[c] === undefined || cb[c] === '') errores.push(`configBase.${c}: falta`);
    for (const c of ['phoneNumberIdEsperado', 'numeroRecepcion', 'nombreNegocio', 'tenantId', 'clinica', 'arteComparativoMediaId', 'arteAntesDespuesMediaId', 'arteAutoridadMediaId']) if (cb[c] === undefined || cb[c] === '') errores.push(`configBase.${c}: falta`);
    if (cb.tenantId !== undefined && cb.tenantId !== d.tenant) errores.push('configBase.tenantId: tiene que ser el tenant de este archivo');
    // La campaña: frase y texto van juntos o ninguno; la frase tiene al menos 5 palabras (sin «hola» ni puntuación: se compara por igualdad, nunca por inclusión); el texto solo enlaza a Google Maps.
    if ((cb.campanaFrase === undefined) !== (cb.campanaTexto === undefined)) errores.push('configBase.campanaFrase y campanaTexto: van juntos o ninguno');
    if (typeof cb.campanaFrase === 'string' && cb.campanaFrase.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9ñ]+/).filter((w) => w !== '' && w !== 'hola').length < 5) errores.push('configBase.campanaFrase: tiene que tener al menos 5 palabras (sin contar «hola»)');
    if (typeof cb.campanaTexto === 'string') for (const u of cb.campanaTexto.match(/https?:\/\/\S+|www\.\S+|wa\.me\S*/gi) || []) if (!/^https:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]{6,40}$/.test(u)) errores.push('configBase.campanaTexto: el único enlace permitido es uno corto de Google Maps (https://maps.app.goo.gl/…)');
    // Revisión de seguridad (07/11/2026, LOW): sin el enlace de Maps permitido, el texto de campaña no puede llevar un dominio suelto (bit.ly/x, evil.com/pago), un número largo ni palabras que el negocio no puede decir.
    if (typeof cb.campanaTexto === 'string') {
      const resto = cb.campanaTexto.normalize('NFKC').replace(/https:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]{6,40}/g, ' ');
      if (/[a-z0-9-]+\.[a-z]{2,}(?:\/|\b)/i.test(resto.replace(/\b(?:Dra|Dr|Sra|Sr)\./gi, ' '))) errores.push('configBase.campanaTexto: no puede llevar un dominio o enlace suelto (solo el enlace de Maps permitido)');
      if (/\d{7,}/.test(resto.replace(/\s/g, ''))) errores.push('configBase.campanaTexto: no puede llevar un número largo (teléfono)');
      if (/acreditad|verificad|garant|descuent|promoci|reembols|devoluc|soy una persona|no soy un (?:bot|asistente)/i.test(resto)) errores.push('configBase.campanaTexto: lleva una palabra que el negocio no puede decir (acreditado, verificado, garantía, descuento…)');
    }
    for (const c of TEXTOS_LIBRES) if (typeof cb[c] === 'string' && (/https?:|www\.|wa\.me|[<>{}\[\]]/i.test(cb[c]))) errores.push(`configBase.${c}: no puede llevar enlaces, llaves ni corchetes`);
    if (typeof cb.direccionRespaldo === 'string' && /\d{7,}/.test(cb.direccionRespaldo.replace(/\s/g, ''))) errores.push('configBase.direccionRespaldo: no puede llevar un número largo');
  }
  // El mapa de columnas del miniCRM: lo valida el MISMO validador que corre en n8n.
  if (d.crm === undefined) errores.push('crm: falta (el mapa de columnas de la planilla)');
  else for (const m of validarMapaCrm(d.crm)) errores.push(`crm: ${m}`);
  if (errores.length) throw new Error(`${nombreDelArchivo}: datos no válidos: ${errores.join('; ')}`);
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
const asignaciones = (datos) => Object.entries(datos.configBase).map(([nombre, valor]) => ({ id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor }));

// ----------------------------------------------------------------- las guardias de lo armado
export function anfitrionPermitido(url, nombreDelNodo = '') {
  if (MARCADOR.test(url)) return true;
  // El relé B9: la URL interna es el marcador pegado a una ruta /v1/envio/ (nunca un host real). Las demás guardias de marcador siguen iguales.
  if (ES_RELE && new RegExp(`^=?${MARCADOR_URL_DEL_RELE}/v1/envio/`).test(url)) return true;
  // Canal graph: «Descargar medio» baja el medio de la URL que le devuelve Meta (la anterior, «¿Tamaño aceptable?», exige https://lookaside.fbsbx.com/ y un tamaño).
  if (!ES_RELE && nombreDelNodo === 'Descargar medio' && url === '={{ $json.url }}') return true;
  // La descarga del GUARDADO: la URL del CDN de Meta solo si el tamaño que informó Meta cabe (la expresión exacta del módulo común).
  if (nombreDelNodo === 'Descargar medio (guardado)' && (url === URL_DESCARGA_GUARDADO || (ES_RELE && url === urlDescargaRele()))) return true;
  // La consulta de SOLO la fila de encabezados del miniCRM (Google Sheets API, `values.get`): la URL exacta del módulo común, con un rango A<fila>:<letra><fila>.
  if (nombreDelNodo === 'Leer encabezados de la planilla') {
    const [antes, despues] = urlEncabezados('@@').split('@@');
    if (url.startsWith(antes) && url.endsWith(despues) && /^[A-Z]+\d+:[A-Z]+\d+$/.test(url.slice(antes.length, url.length - despues.length))) return true;
  }
  const m = /^=?https:\/\/([^/?#\s]*)/i.exec(url);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return false;
  return ANFITRIONES.includes(m[1].toLowerCase());
}

/** Lo que un JSON de este flujo no puede tener. `variante`: 'produccion' | 'prueba' | 'ensayo-demo-a'. Devuelve la lista de hallazgos (vacía si está limpio). */
export function guardias(variante, flujo, mapaCrm) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const nombres = new Set(nodos.map((n) => n.name));
  const por = (nombre) => nodos.find((n) => n.name === nombre);
  const p = (n) => (n && n.parameters) || {};
  const conex = (flujo && flujo.connections) || {};
  const destinosDe = (nombre, salida) => (((conex[nombre] || {}).main || [])[salida] || []).map((x) => x.node);
  const ensayo = variante === 'ensayo-demo-a';
  if (nodos.length > TOPE_DE_NODOS) h.push(`tiene ${nodos.length} nodos y el tope es ${TOPE_DE_NODOS}: si pasa, se rehace (el tope ya incluye los 9 del guardado de medios, excepción declarada por Andres el 29/10/2026 para el guardado de medios, +9 nodos desde el contrato v2 del 30/10 (eran 11), y los 8 de la rama del miniCRM, DP1 del 31/10/2026: docs/versiones-por-cliente.md)`);
  // Un WhatsApp Trigger reescribe el webhook de toda la app (prohibición 7). Solo la variante de ENSAYO lleva uno —exactamente uno, con la credencial de la app del Demo A por nombre— y
  // `flujo-de-prueba.mjs --sobre-demo-a` lo reemplaza por el Trigger VIVO del Demo A; nunca con la credencial de AAB1-WA-Prod ni la del receptor.
  const disparadores = nodos.filter((n) => n.type === 'n8n-nodes-base.whatsAppTrigger');
  if (!ensayo && disparadores.length) h.push('contiene un WhatsApp Trigger (prohibición 7: reescribe el webhook de toda la app)');
  if (ensayo) {
    if (disparadores.length !== 1) h.push(`ensayo: tiene que llevar exactamente un «${NODO_TRIGGER}» (lleva ${disparadores.length})`);
    for (const d of disparadores) {
      const c = (d.credentials || {}).whatsAppTriggerApi;
      if (!c || !CREDENCIALES_DEL_DEMO_A.whatsAppTriggerApi.includes(String(c.name))) h.push(`ensayo: «${d.name}» tiene que llevar la credencial «${CREDENCIALES_DEL_DEMO_A.whatsAppTriggerApi[0]}» (la de la app del Demo A; nunca la de AAB1-WA-Prod)`);
    }
    if (ES_RELE) h.push('ensayo: el Demo A no tiene el relé B9: el ensayo solo se arma con el canal de envío graph');
  }
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) h.push('menciona «subscriptions» o «subscribed_apps» (prohibición 7)');
  if (/langchain\.(agent|memory\w*|lmChat\w*|chain\w*)$/i.test(nodos.map((n) => n.type).join('\n'))) h.push('lleva un agente, memoria o modelo de chat de n8n: este flujo no los lleva (el modelo es una llamada HTTP intercambiable)');
  for (const n of [...NODOS_DE_LA_CONVERSACION, ...NODOS_DE_MEDIOS]) if (!nombres.has(n)) h.push(`falta el nodo «${n}»`);
  h.push(...problemasDeReferencias(flujo || {}));
  // EL miniCRM (módulo `crm`): la rama completa, la credencial del tenant y las barreras del módulo (rangos que no llegan a la letra del diagnóstico del equipo, retención de ejecuciones en `none`).
  if (ensayo) {
    // El ensayo en el Demo A NO lleva la rama del miniCRM: el Demo A no tiene la credencial de la planilla de Evy ni debe escribir en ella.
    for (const n of NODOS_DE_CRM) if (nombres.has(n)) h.push(`ensayo: lleva el nodo «${n}» del miniCRM (el Demo A no tiene la credencial de la planilla de Evy)`);
    for (const n of nodos) if ((n.credentials || {}).googleApi) h.push(`ensayo: «${n.name}» lleva una credencial de Google (el ensayo no escribe en ninguna planilla)`);
  } else {
    for (const n of NODOS_DE_CRM) if (!nombres.has(n)) h.push(`miniCRM: falta el nodo «${n}»`);
    if (nombres.has('Prospecto para la planilla') && !destinosDe('Armar mensajes', 0).includes('Prospecto para la planilla')) h.push('miniCRM: «Armar mensajes» no está conectado a «Prospecto para la planilla»');
    const pros = por('Prospecto para la planilla'); const resumenDelTurno = por('Resumen del turno'); const armado = por('Armar mensajes');
    if (pros && resumenDelTurno && armado && !(pros.position[1] < resumenDelTurno.position[1] && pros.position[1] > armado.position[1])) h.push('miniCRM: «Prospecto para la planilla» tiene que ir debajo de «Armar mensajes» y encima de «Resumen del turno» en el lienzo (el resumen es la última rama)');
    for (const n of nodos) {
      const g = (n.credentials || {}).googleApi;
      if (g && g.name !== CREDENCIAL_CRM('rroca-evy')) h.push(`miniCRM: «${n.name}» usa una credencial de Google que no es la de este negocio (${CREDENCIAL_CRM('rroca-evy')})`);
    }
    let mapa = mapaCrm;
    if (mapa === undefined) { try { mapa = JSON.parse(leerSiExiste(ARCHIVO_DE_DATOS, 'rroca-evy.json')).crm; } catch (e) { mapa = undefined; } }
    if (!mapa || !mapa.columnas) h.push('miniCRM: faltan los datos `crm` (el mapa de columnas): sin él no se pueden comprobar los rangos de lectura');
    else h.push(...hallazgosCrm(flujo || {}, mapa).map((x) => `miniCRM: ${x}`));
  }
  // El GUARDADO de medios (obligatorio en todo flujo con medios): la rama común completa, en su lugar y con las credenciales correctas.
  h.push(...hallazgosDelGuardado(flujo || {}));
  // El sandbox de EXPRESIONES de n8n (07/11/2026): ninguna expresión lee prototype/__proto__/constructor ni usa Function, eval, process, require, globalThis o this.
  h.push(...hallazgosDeExpresionesN8n(flujo || {}));
  // Las imágenes y el aviso SALEN antes de armar el texto: «Armar previos» → «¿Hay previos?» → «Enviar aviso» → «Armar mensajes»; la rama sin previos también llega a «Armar mensajes».
  if (nombres.has('Armar previos') && !destinosDe('Armar previos', 0).includes('¿Hay previos?')) h.push('«Armar previos» no está conectado a «¿Hay previos?»');
  if (nombres.has('¿Hay previos?') && !destinosDe('¿Hay previos?', 0).includes('Enviar aviso')) h.push('«¿Hay previos?» no envía por «Enviar aviso»');
  if (nombres.has('¿Hay previos?') && !destinosDe('¿Hay previos?', 1).includes('Armar mensajes')) h.push('«¿Hay previos?» no envía la rama sin previos (salida 1) a «Armar mensajes»');
  if (nombres.has('Enviar aviso') && !destinosDe('Enviar aviso', 0).includes('Armar mensajes')) h.push('«Enviar aviso» no cuelga de «Armar mensajes»: las imágenes y el aviso tienen que correr ANTES de armar el texto que dice si salieron');
  const enviarPrevios = por('Enviar aviso');
  if (enviarPrevios && !((enviarPrevios.credentials || {}).httpHeaderAuth || {}).name) h.push('«Enviar aviso» no lleva credencial (httpHeaderAuth)');
  if (enviarPrevios && (enviarPrevios.onError !== 'continueRegularOutput' || enviarPrevios.alwaysOutputData !== true)) h.push('«Enviar aviso» no lleva `onError: continueRegularOutput` y `alwaysOutputData`: si Meta rechaza una imagen, el turno se cortaría y el cliente quedaría sin respuesta');
  if (enviarPrevios && p(enviarPrevios).options && p(enviarPrevios).options.retryOnFail) h.push('«Enviar aviso» no reintenta: un aviso repetido llegaría dos veces');
  const modelo = por('Conversar con el modelo');
  if (modelo && !/^=?https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//.test(String(p(modelo).url || ''))) h.push('«Conversar con el modelo» no llama a Gemini');
  if (modelo && (modelo.onError !== 'continueRegularOutput' || modelo.alwaysOutputData !== true)) h.push('«Conversar con el modelo» tiene que llevar onError continueRegularOutput y alwaysOutputData: si Gemini cae, el cliente recibe el texto fijo y el botón de la recepción');
  // MEDIOS: «Preparar transcripción» incluye el módulo común TAL CUAL; el audio y la imagen pasan por Gemini, que no corta el turno si falla.
  for (const [de, a] of ARISTAS_DE_MEDIOS) {
    if (nombres.has(de) && nombres.has(a) && !destinosDe(de, 0).includes(a) && !destinosDe(de, 1).includes(a)) h.push(`medios: «${de}» no está conectado a «${a}»`);
  }
  for (const nombre of ['Transcribir audio', 'Ver imagen']) {
    const g = por(nombre);
    if (!g) continue;
    if (!((g.credentials || {}).googlePalmApi || {}).name) h.push(`«${nombre}» no lleva credencial (googlePalmApi)`);
    if (g.onError !== 'continueRegularOutput' || g.alwaysOutputData !== true) h.push(`«${nombre}» tiene que llevar onError continueRegularOutput y alwaysOutputData: si Gemini falla, el turno sigue y el cliente recibe su respuesta`);
  }
  const preparar = por('Preparar transcripción');
  if (preparar) {
    const fuente = readFileSync(join(AQUI, '../../src/core/medios/preparar-transcripcion.js'), 'utf8').trimEnd();
    if (!String(p(preparar).jsCode || '').includes(fuente)) h.push('«Preparar transcripción» no incluye el módulo común (Flujos/src/core/medios/preparar-transcripcion.js) tal cual: rearme con «node construir.mjs»');
  }
  // El reporte del entrante corre ANTES que la rama que responde: «Reportar mensaje (entrante)» arriba de la «Puerta del turno» y de toda la rama de medios y de decisión.
  const rep = por('Reportar mensaje (entrante)');
  if (rep) {
    for (const n of nodos) {
      if (['Puerta del turno', '¿Bajar medio?', 'Obtener URL del medio (general)', 'Decidir turno', 'Armar previos', 'Armar mensajes'].includes(n.name) && !(rep.position[1] < n.position[1])) h.push(`«Reportar mensaje (entrante)» tiene que ir arriba de «${n.name}» en el lienzo`);
    }
    if (!(/bajaEscrita === true/.test(String(p(rep).jsonBody || '')) && /riesgoEscrito === true/.test(String(p(rep).jsonBody || '')))) h.push('«Reportar mensaje (entrante)» no reporta `no_contactar` por la baja ni por el riesgo escritos');
  }
  const repSal = por('Reportar mensaje (saliente)');
  if (repSal && !/no_contactar/.test(String(p(repSal).jsonBody || ''))) h.push('«Reportar mensaje (saliente)» no reporta el evento `no_contactar` (condición dura de la baja y de la protección)');
  // EL INTERRUPTOR SOLO DE ENSAYO (`avisarAlPropioNumero`): ningún otro JSON lo lleva (ni en «Config base» ni en el código de un nodo); el de ensayo lo lleva como el booleano true.
  const asignadas = (p(por('Config base')).assignments || {}).assignments || [];
  const delInterruptor = asignadas.find((a) => a && a.name === CLAVE_SOLO_ENSAYO);
  if (!ensayo) {
    if (delInterruptor) h.push(`«Config base» trae «${CLAVE_SOLO_ENSAYO}» (interruptor solo de ensayo): solo ${SALIDA_ENSAYO} puede llevarla`);
    // (La librería común nombra la clave en un comentario de `avDestinatarios`: lo que se mira es la LECTURA `base.<clave>`, que solo pone el reemplazo de `interruptorDeEnsayo`.)
    for (const n of nodos) if (LECTURA_DE_LA_CLAVE.test(String(p(n).jsCode || ''))) h.push(`el código de «${n.name}» lee «${CLAVE_SOLO_ENSAYO}» (interruptor solo de ensayo): solo ${SALIDA_ENSAYO} puede leerla`);
  } else {
    if (!delInterruptor || delInterruptor.value !== true || delInterruptor.type !== 'boolean') h.push(`ensayo: «Config base» tiene que traer «${CLAVE_SOLO_ENSAYO}» como el booleano true`);
    for (const n of nodos) {
      if (n.name !== 'Armar previos' && n.name !== 'Armar mensajes' && LECTURA_DE_LA_CLAVE.test(String(p(n).jsCode || ''))) h.push(`ensayo: solo «Armar previos» y «Armar mensajes» leen «${CLAVE_SOLO_ENSAYO}» (lo lee «${n.name}»)`);
    }
    for (const n of ['Armar previos', 'Armar mensajes']) {
      const c = String(p(por(n)).jsCode || '');
      if (por(n) && !c.includes("cnPrimero('Config base')")) h.push(`ensayo: «${n}» no lee «Config base»`);
      if (por(n) && !c.includes(`base.${CLAVE_SOLO_ENSAYO} === true`)) h.push(`ensayo: «${n}» no lee el interruptor de «Config base»`);
    }
    // Los marcadores: solo los dos del ensayo, y solo en «Config base» (los repone `preparar-import.sh` desde la tabla local).
    const vistos = new Set(asignadas.flatMap((a) => (String(a && a.value).match(/REEMPLAZAR_[A-Z0-9_]+/g) || [])));
    for (const m of vistos) if (!MARCADORES_DEL_ENSAYO.includes(m)) h.push(`ensayo: «Config base» trae el marcador ${m}, que la tabla del ensayo no repone`);
    // Sin planilla, sin la plantilla de aviso de la WABA de Evy (el Demo A no la tiene: el aviso sale por la ventana, como texto libre), sin modo ni etapa de prueba y sin los ids de las imágenes de la WABA de Evy.
    const valorDe = (k) => (asignadas.find((a) => a && a.name === k) || {}).value;
    if (valorDe('planillaProspectosId') !== '') h.push('ensayo: «planillaProspectosId» tiene que ir vacío (el ensayo no escribe en la planilla de Evy)');
    if (valorDe('avisoSolicitudEstado') === 'APPROVED') h.push('ensayo: «avisoSolicitudEstado» no puede ser APPROVED (la plantilla es de la WABA de Evy; el Demo A no la tiene)');
    if (valorDe('telefonosDePrueba') !== undefined) h.push('ensayo: no lleva «telefonosDePrueba» (el ensayo no tiene modo prueba)');
    if (valorDe('etapaPrueba') !== '') h.push('ensayo: «etapaPrueba» tiene que ir vacía (la etapa de prueba ignoraría el número de aviso del ensayo y cerraría la puerta a quien no esté en la lista)');
    for (const k of CLAVES_DE_ARTES) if (valorDe(k) !== '') h.push(`ensayo: «${k}» tiene que ir vacío (el medio es de la WABA de Evy: en el Demo A esa imagen no se envía)`);
    // Las credenciales: solo las del Demo A, por nombre; un nodo que habla con Graph no puede llevar la de la ingesta (la trampa del 15/09).
    for (const n of nodos) {
      for (const [tipo, c] of Object.entries(n.credentials || {})) {
        const nombreCred = String((c || {}).name || '');
        if (!(CREDENCIALES_DEL_DEMO_A[tipo] || []).includes(nombreCred)) h.push(`ensayo: «${n.name}» usa ${tipo} «${nombreCred}», que no es una credencial del Demo A`);
        if (/bellido|platinum|q'?taco|captaci|segurolo|otp|aab1|whatsapp-?modular|receptor|antonio|evy|emma|ruben|rubén/i.test(nombreCred)) h.push(`ensayo: la credencial de «${n.name}» nombra a un cliente o a un sistema ajeno`);
      }
      h.push(...hallazgosDeDestino(n));
    }
  }
  // La variante de PRUEBA nunca usa credenciales de producción: ni la de Graph ni la de Gemini.
  if (variante === 'prueba') {
    for (const n of nodos) {
      for (const [tipo, c] of Object.entries(n.credentials || {})) {
        const nombreCred = String((c || {}).name || '');
        if ((tipo === 'googlePalmApi' && !/pruebas/i.test(nombreCred)) || (ES_RELE && String(((c || {}).name) || '') === CREDENCIAL_RELE ? false : (n.name !== NODO_PRUEBA && n.name !== 'Traer configuración' && n.name !== 'Reportar mensaje (entrante)' && n.name !== 'Reportar mensaje (saliente)' && !NODOS_DE_INGESTA_DEL_GUARDADO.includes(n.name) && tipo === 'httpHeaderAuth' && !/pruebas/i.test(nombreCred)))) {
          h.push(`la prueba usa una credencial de producción en «${n.name}» (${tipo})`);
        }
      }
    }
  }
  if (ensayo) {
    if (nombres.has(NODO_PRUEBA)) h.push(`ensayo: contiene «${NODO_PRUEBA}» (activa el modo prueba): el ensayo no lo lleva`);
    for (const n of NODOS_DEL_RECEPTOR) if (nombres.has(n)) h.push(`ensayo: contiene «${n}» (entrada del receptor): el ensayo entra por el Trigger del Demo A`);
  } else if (variante === 'produccion') {
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
    if (ensayo || n.name !== (variante === 'produccion' ? NODO_RECEPTOR : NODO_PRUEBA)) h.push(`el webhook «${n.name}» no corresponde a esta variante`);
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
  if (ES_RELE) h.push(...guardiasDelRele(nodos, flujo, por, p));
  else h.push(...guardiasDelEnvioDirecto(nodos));
  // Retención de ejecuciones (datos de salud: no se guardan ni los turnos fallidos), orden y zona horaria.
  const st = (flujo && flujo.settings) || {};
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'none' || st.saveExecutionProgress !== false) h.push('los ajustes de retención deben ser saveDataSuccessExecution «none», saveDataErrorExecution «none» (datos de salud: no se guardan ni los turnos fallidos) y saveExecutionProgress false');
  if (ES_RELE) {
    // Canal rele (decisión I4): el versionado lleva el marcador y el publicador lo reemplaza por el id del flujo de alertas, resuelto por NOMBRE en el n8n destino. Con graph no hay relé ni «Detener por envío incierto»: no lleva `errorWorkflow`.
    if (!(st.errorWorkflow === 'REEMPLAZAR_ID_ERROR_WORKFLOW' || (typeof st.errorWorkflow === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(st.errorWorkflow) && !/^REEMPLAZAR_/.test(st.errorWorkflow)))) h.push('relé: `errorWorkflow` tiene que ser el marcador REEMPLAZAR_ID_ERROR_WORKFLOW (lo resuelve por nombre el publicador) o un id ya resuelto');
  } else if (st.errorWorkflow !== undefined) h.push('no lleva `errorWorkflow`');
  if (st.executionOrder !== 'v1') h.push('executionOrder tiene que ser «v1» (el orden de las ramas es el del lienzo)');
  if (st.timezone !== 'America/La_Paz') h.push('timezone tiene que ser «America/La_Paz»');
  // `REEMPLAZAR_` solo en «Config base», en el receptor y en la ruta de la entrada de prueba.
  const conMarcador = ensayo ? new Set(['Config base']) : new Set(['Config base', NODO_RECEPTOR, 'Verificar firma con el receptor', NODO_PRUEBA]);
  for (const n of nodos) {
    if (conMarcador.has(n.name)) continue;
    // Canal rele (D5, Andres, 03/11/2026): SOLO el marcador de la URL interna del relé se tolera, y solo pegado a /v1/envio/ (lo sustituye el publicador). Con graph no se tolera ninguno. Cualquier otro REEMPLAZAR_ sigue prohibido.
    const sinComentario = JSON.stringify(n).replace(/\/\^?REEMPLAZAR_\/i?/gi, '');
    const sinRele = ES_RELE ? sinComentario.split(`${MARCADOR_URL_DEL_RELE}/v1/envio/`).join('') : sinComentario;
    if (/REEMPLAZAR_[A-Z0-9]/.test(sinRele)) h.push(`el nodo «${n.name}» trae un marcador REEMPLAZAR_: solo va en «Config base», el receptor y la ruta de prueba`);
  }
  return h;
}

/** Canal graph: ningún nodo habla con el relé; toda llamada a Graph lleva su credencial POR NOMBRE y ningún nodo HTTP escribe un header Authorization a mano. */
function guardiasDelEnvioDirecto(nodos) {
  const h = [];
  const normal = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const n of nodos) {
    if (/REEMPLAZAR_URL_INTERNA_DEL_RELE|\/v1\/envio\//.test(JSON.stringify(n.parameters || {}))) h.push(`envío directo: «${n.name}» habla con el relé (el canal es graph)`);
    for (const [tipo, c] of Object.entries(n.credentials || {})) {
      const nombreCred = String((c || {}).name || '');
      if (normal(nombreCred).startsWith('aab1 envio') || nombreCred.startsWith(PREFIJO_CREDENCIAL_RELE)) h.push(`envío directo: «${n.name}» (${tipo}) lleva una credencial del relé (el canal es graph)`);
    }
    if (n.type === 'n8n-nodes-base.httpRequest') {
      const cab = ((((n.parameters || {}).headerParameters || {}).parameters) || []);
      if (cab.some((x) => normal((x && x.name) || '').replace(/[^a-z]/g, '') === 'authorization')) h.push(`envío directo: «${n.name}» escribe un header Authorization en headerParameters (la llave va solo por la credencial)`);
      if (String((n.parameters || {}).url || '').includes(['graph', 'facebook', 'com'].join('.')) && !((n.credentials || {}).httpHeaderAuth || {}).name) h.push(`envío directo: «${n.name}» habla con Graph sin credencial por nombre`);
    }
  }
  for (const n of ['Detener por envío incierto', 'Leer respuesta del relé', '¿Qué hacer con el envío?', 'Esperar reintento']) if (nodos.some((x) => x.name === n)) h.push(`envío directo: no puede existir «${n}» (es del canal rele)`);
  return h;
}

/** Canal rele: las guardias del RELÉ B9. */
function guardiasDelRele(nodos, flujo, por, p) {
  const h = [];
  // RELÉ B9: ni un nodo habla con Meta (Graph ni su CDN), la cadena de envío y el guardado son los del módulo común, y la ejecución dura 300 s (los reintentos del relé esperan hasta 64 s).
  for (const n of nodos) if (/graph\.facebook\.com|lookaside|fbsbx|whatsAppApi/i.test(JSON.stringify({ p: n.parameters, t: n.type }))) h.push(`relé: «${n.name}» llama a Meta directo (Graph o su CDN) en un flujo que va por el relé`);
  for (const n of ['Obtener URL del medio (general)', 'Descargar medio', 'Enviar aviso']) {
    const nodo = por(n);
    if (nodo && !releGeneral(nodo)) h.push(`relé: «${n}» no habla con el relé (/v1/envio/)`);
  }
  // MULTI-TENANT: los 8 nodos que hablan con el relé llevan, POR NOMBRE EXACTO, la credencial de ESTE cliente.
  for (const n of ['Enviar a WhatsApp', 'Enviar respaldo', 'Enviar aviso', 'Obtener URL del medio (general)', 'Descargar medio', 'Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado']) {
    const nodo = por(n);
    if (nodo && ((nodo.credentials || {}).httpHeaderAuth || {}).name !== CREDENCIAL_RELE) h.push(`relé: «${n}» no lleva la credencial ${CREDENCIAL_RELE}`);
  }
  // Y CUALQUIER credencial cuyo nombre, normalizado (sin tildes, minúsculas, espacios simples), empiece con «aab1 envio» es exactamente la de este cliente (un nombre con otra grafía no se cuela).
  const normal = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const n of nodos) for (const [tipo, c] of Object.entries(n.credentials || {})) {
    const nombreCred = String((c || {}).name || '');
    if ((normal(nombreCred).startsWith('aab1 envio') || nombreCred.startsWith(PREFIJO_CREDENCIAL_RELE)) && nombreCred !== CREDENCIAL_RELE) h.push(`relé: «${n.name}» (${tipo}) lleva una credencial del relé que no es la de este cliente (${CREDENCIAL_RELE})`);
  }
  // Un header Authorization escrito a mano en CUALQUIER nodo HTTP: la llave del relé va solo por la credencial (Header Auth), nunca en el flujo.
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    const cabeceras = (((p(n).headerParameters || {}).parameters) || []);
    if (cabeceras.some((x) => normal((x && x.name) || '').replace(/[^a-z]/g, '') === 'authorization')) h.push(`relé: «${n.name}» escribe un header Authorization en headerParameters (la llave va solo por la credencial)`);
  }
  h.push(...hallazgosDelEnvioRele(flujo || {}));
  if (nodos.length && (flujo.settings || {}).executionTimeout !== 300) h.push('relé: executionTimeout tiene que ser 300');
  return h;
}

// ----------------------------------------------------------------- la guardia de publicación
/**
 * El JSON versionado es armable pero NO debe llegar a n8n con marcadores `REEMPLAZAR_*` (rutas, ids de Meta, número de recepción, ids de las tres imágenes), con una plantilla de aviso que Meta no aprobó (etapa completa),
 * con la rama de medios incompleta o sin audio, imagen y documento declarados. Esto NO es una guardia del armado (el JSON versionado lleva marcadores a propósito: el repositorio es público): es la de PUBLICAR, y se corre
 * sobre lo que se va a escribir (el versionado, el `.local.json` o el flujo VIVO). Los mensajes nombran claves, marcadores y nodos; NUNCA imprimen valores de los datos ni fragmentos del flujo.
 *   etapas: `crear` (flujo INACTIVO, para que WAM dé la URL de entrada) y `prueba` (ENCENDIDO en modo prueba: solo atiende a `telefonosDePrueba`) toleran la plantilla sin APPROVED; la prueba exige además `etapaPrueba = si`,
 *   teléfonos de prueba válidos con prefijo y la recepción DENTRO de ellos. `encender` (la completa, por defecto) exige la plantilla APPROVED y RECHAZA `etapaPrueba = si`.
 */
export const ETAPAS = ['crear', 'prueba', 'encender'];
export const MEDIOS_PARA_ABRIR = ['audio', 'imagen', 'documento'];
const MARCADOR_CRUDO = /reemplazar_/i;
const sinComentarios = (t) => String(t).normalize('NFKC').replace(/\/\^?REEMPLAZAR_\/i?/gi, '').replace(/REEMPLAZAR_(?:\*|…|\.\.\.)/gi, '').replace(/`REEMPLAZAR_`/gi, '');
const hayMarcador = (t) => MARCADOR_CRUDO.test(sinComentarios(t));
const VALOR_LLENO = (v) => typeof v === 'string' && v.trim() !== '' && !hayMarcador(v);
const marcasEn = (v) => (sinComentarios(JSON.stringify(v) || '').match(/reemplazar_[a-z0-9_-]*/gi) || []);
const soloDigitos = (v) => String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
const CLAVES_DE_ARTES = ['arteComparativoMediaId', 'arteAntesDespuesMediaId', 'arteAutoridadMediaId'];

function hallazgosDeEtapaPrueba(enFlujo, etapa) {
  const h = [];
  const enModoPrueba = typeof enFlujo.etapaPrueba === 'string' && enFlujo.etapaPrueba.trim().toLowerCase() === 'si';
  if (etapa === 'encender' && enModoPrueba) h.push('Config base: etapaPrueba es «si» y la etapa completa no lo admite (el flujo ignoraría a todo cliente que no sea de prueba): use la etapa prueba o vacíe etapaPrueba');
  if (etapa !== 'prueba') return h;
  if (!enModoPrueba) h.push('Config base: la etapa prueba exige etapaPrueba igual a «si»');
  const lista = typeof enFlujo.telefonosDePrueba === 'string' ? enFlujo.telefonosDePrueba.split(',').map((x) => x.trim()) : [];
  const validos = lista.length > 0 && lista.every((x) => /^\d{6,20}$/.test(x));
  if (!validos) h.push('Config base: la etapa prueba exige telefonosDePrueba lleno y válido (solo dígitos, sin marcador)');
  const rec = typeof enFlujo.numeroRecepcion === 'string' ? enFlujo.numeroRecepcion.trim() : '';
  if (!/^\d{6,20}$/.test(rec) || !lista.some((x) => soloDigitos(x) === rec)) h.push('Config base: la etapa prueba exige que numeroRecepcion esté dentro de telefonosDePrueba');
  // Cada teléfono de prueba y la recepción tienen que empezar con uno de los prefijos permitidos del negocio.
  const prefijos = String(enFlujo.prefijosPermitidos || '591').split(',').map((x) => soloDigitos(x)).filter((x) => x !== '');
  const sinPrefijo = (x) => !prefijos.some((p) => soloDigitos(x).startsWith(p));
  if (validos && lista.some(sinPrefijo)) h.push('Config base: la etapa prueba exige que cada teléfono de telefonosDePrueba empiece con uno de los prefijosPermitidos');
  if (/^\d{6,20}$/.test(rec) && sinPrefijo(rec)) h.push('Config base: la etapa prueba exige que numeroRecepcion empiece con uno de los prefijosPermitidos');
  return h;
}

function hallazgosDeConfig(cb, donde, etapa) {
  const h = [];
  if (!cb || typeof cb !== 'object') return [`${donde}: no trae la configuración base`];
  if (etapa === 'encender' && cb.avisoSolicitudEstado !== 'APPROVED') h.push(`${donde}: avisoSolicitudEstado es ${cb.avisoSolicitudEstado === undefined ? '«ausente»' : '(distinto de APPROVED)'} y tiene que ser APPROVED (Meta aún no aprobó la plantilla)`);
  if (!VALOR_LLENO(cb.avisoSolicitudPlantilla)) h.push(`${donde}: falta el nombre de la plantilla (avisoSolicitudPlantilla)`);
  if (!VALOR_LLENO(cb.avisoPlantillaIdioma)) h.push(`${donde}: falta el idioma de la plantilla (avisoPlantillaIdioma)`);
  // Audio, imagen y documento declarados (regla de Andres: ningún flujo se abre sin los tres medios).
  const medios = new Set(String(cb.mediosHabilitados === undefined || cb.mediosHabilitados === null ? '' : cb.mediosHabilitados).split(',').map((x) => x.trim()).filter(Boolean));
  const faltan = MEDIOS_PARA_ABRIR.filter((m) => !medios.has(m));
  if (faltan.length) h.push(`${donde}: mediosHabilitados tiene que declarar audio, imagen y documento y faltan: ${faltan.join(', ')}`);
  // Los ids de medio de las tres imágenes, resueltos (dígitos): un marcador no se publica.
  // En el FLUJO que se publica: dígitos (6 a 25). En los DATOS versionados (repo público): dígitos o el marcador REEMPLAZAR_MEDIA_ID_*; la tabla local los resuelve al publicar.
  const formaDelId = donde === 'datos' ? /^(\d{6,25}|REEMPLAZAR_MEDIA_ID_[A-Z0-9_]+)$/ : /^\d{6,25}$/;
  for (const c of CLAVES_DE_ARTES) if (!formaDelId.test(String(cb[c] === undefined ? '' : cb[c]))) h.push(`${donde}: ${c} no está resuelto (el id del medio ya subido a Meta; los medios vencen a los 30 días)`);
  return h;
}

function hallazgosDelNegocio(negocio) {
  const h = [];
  if (!negocio || typeof negocio !== 'object' || Array.isArray(negocio)) return ['negocio: no se pudo leer el archivo de datos del negocio'];
  // El número de recepción va como `numeroRecepcionMarcador` (lo resuelve la tabla local al cargar): es el único campo donde un REEMPLAZAR_ se tolera.
  const { negocio: n, ...resto } = negocio;
  const { numeroRecepcionMarcador: _n, ...restoNegocio } = n && typeof n === 'object' ? n : {};
  for (const m of new Set(marcasEn({ ...resto, negocio: restoNegocio }).map((x) => x.toUpperCase()))) h.push(`negocio: marcador sin sustituir: ${m}`);
  if (!n || !VALOR_LLENO(n.direccion)) h.push('negocio: falta la dirección');
  if (!n || !n.horarios || typeof n.horarios !== 'object' || !Object.values(n.horarios).some((v) => VALOR_LLENO(v))) h.push('negocio: faltan los horarios');
  return h;
}

/** La rama de medios completa: nodos, aristas, el módulo común de transcripción byte a byte y las credenciales de Gemini. */
export function hallazgosDeMedios(flujo) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const por = (n) => nodos.find((x) => x.name === n);
  for (const n of NODOS_DE_MEDIOS) if (!por(n)) h.push(`medios: falta el nodo «${n}»`);
  const conex = (flujo && flujo.connections) || {};
  for (const [de, a] of ARISTAS_DE_MEDIOS) {
    if (por(de) && por(a) && !(conex[de] && (conex[de].main || []).some((s) => (s || []).some((x) => x.node === a)))) h.push(`medios: «${de}» no está conectado a «${a}»`);
  }
  const fuente = readFileSync(join(AQUI, '../../src/core/medios/preparar-transcripcion.js'), 'utf8').trimEnd();
  if (por('Preparar transcripción') && !String((por('Preparar transcripción').parameters || {}).jsCode || '').includes(fuente)) h.push('medios: el código de «Preparar transcripción» no es el del módulo común preparar-transcripcion.js');
  for (const n of ['Transcribir audio', 'Ver imagen']) {
    if (por(n) && !(((por(n).credentials || {}).googlePalmApi || {}).name)) h.push(`medios: «${n}» no lleva credencial de Gemini`);
  }
  return h;
}

const coincide = (dato2, vivo) => {
  if (typeof dato2 === 'string' && hayMarcador(dato2)) return true;   // el dato aún es un marcador: el valor real lo pone quien publica
  return dato2 === vivo;
};
function hallazgosDeIdentidad(flujo, enFlujo, datos) {
  const h = [];
  if (!datos || typeof datos !== 'object') return ['datos: no se pudieron leer'];
  const nombres = [datos.nombreFlujo, datos.nombreFlujoPrueba].filter((x) => typeof x === 'string' && x !== '');
  if (!nombres.length || !nombres.includes(flujo && flujo.name)) h.push('el nombre del flujo no es el de Evy (nombreFlujo ni nombreFlujoPrueba de los datos)');
  for (const [c, v] of Object.entries(datos.configBase || {})) {
    if (typeof v === 'string' && hayMarcador(v)) continue;
    // La variante de PRUEBA va con el id de la planilla VACÍO a propósito (no escribe en ninguna hoja); vacío en el flujo nunca escribe, así que se acepta.
    if (c === 'planillaProspectosId' && enFlujo[c] === '') continue;
    if (!coincide(v, enFlujo[c])) h.push(`Config base: ${c} no coincide con los datos de Evy`);
  }
  return h;
}

/** ¿Este JSON o estos datos son los del ENSAYO en el Demo A? Lleva el interruptor de ensayo, un WhatsApp Trigger o «ensayo» en su nombre. */
export function esDelEnsayo(flujo, datos) {
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const base = nodos.find((n) => n.name === 'Config base');
  const lista = (base && base.parameters && base.parameters.assignments && base.parameters.assignments.assignments) || [];
  return (Array.isArray(lista) && lista.some((a) => a && a.name === CLAVE_SOLO_ENSAYO))
    || nodos.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')
    || /ensayo/i.test(String((flujo && flujo.name) || ''))
    || !!(datos && datos.configBase && Object.prototype.hasOwnProperty.call(datos.configBase, CLAVE_SOLO_ENSAYO));
}

export function guardiaDePublicacion({ flujo, datos, negocio, etapa = 'encender' }) {
  if (!ETAPAS.includes(etapa)) return [`etapa desconocida (${ETAPAS.join(' | ')})`];
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  if (!nodos.length) h.push('el flujo no trae nodos');
  // La variante de ENSAYO en el Demo A (interruptor de un solo teléfono, Trigger, sin miniCRM) NUNCA se publica sobre el número de Evy: se pone en el Demo A con `flujo-de-prueba.mjs --sobre-demo-a`.
  if (esDelEnsayo(flujo, datos)) h.push(`ensayo: este es el flujo de ENSAYO en el Demo A (${SALIDA_ENSAYO}) y nunca se publica sobre el número de Evy: se ensaya con flujo-de-prueba.mjs --sobre-demo-a (docs/ensayo/LEEME.md §10)`);
  const base = nodos.find((n) => n.name === 'Config base');
  const lista = base && base.parameters && base.parameters.assignments && base.parameters.assignments.assignments;
  const enFlujo = Array.isArray(lista) ? Object.fromEntries(lista.map((a) => [a.name, a.value])) : {};
  // 1. Marcadores sin sustituir en CUALQUIER parte del JSON completo. Con `usarMarcas` apagado, el id del comparativo no hace falta y su marcador se tolera.
  const marcasComparativo = enFlujo.usarMarcas === 'si' ? [] : ['REEMPLAZAR_MEDIA_ID_ARTE_COMPARATIVO'];
  for (const m of new Set(marcasEn(flujo).map((x) => x.toUpperCase()))) if (!marcasComparativo.includes(m)) h.push(`marcador sin sustituir: ${m}`);
  if (!Array.isArray(lista)) h.push('el flujo no trae «Config base»: no se puede comprobar el estado de la plantilla');
  else {
    h.push(...hallazgosDeConfig(enFlujo, 'Config base', etapa).filter((x) => !(enFlujo.usarMarcas !== 'si' && /arteComparativoMediaId/.test(x))));
    h.push(...hallazgosDeEtapaPrueba(enFlujo, etapa));
    h.push(...hallazgosDeIdentidad(flujo, enFlujo, datos));
  }
  h.push(...hallazgosDeConfig(datos && datos.configBase, 'datos', etapa).filter((x) => !(datos && datos.configBase && datos.configBase.usarMarcas !== 'si' && /arteComparativoMediaId/.test(x))));
  h.push(...hallazgosDelNegocio(negocio));
  h.push(...hallazgosDeMedios(flujo));
  if (datos && datos.crm) h.push(...hallazgosCrm(flujo || {}, datos.crm).map((x) => `miniCRM: ${x}`));
  else h.push('miniCRM: los datos no traen el mapa `crm`');
  const nombres = new Set(nodos.map((n) => n.name));
  for (const n of NODOS_DE_LA_CONVERSACION) if (!nombres.has(n)) h.push(`conversación: falta el nodo «${n}»`);
  return h;
}

// ----------------------------------------------------------------- armar
const sinMarcas = (v, esCodigo) => {
  if (typeof v === 'string') return esCodigo ? !v.startsWith('@@') : !v.includes('@@');
  if (Array.isArray(v)) return v.every((x) => sinMarcas(x, false));
  if (v && typeof v === 'object') return Object.entries(v).every(([c, x]) => sinMarcas(x, c === 'jsCode'));
  return true;
};

/** El proyecto con el prompt versionado como paquete `prompt` (el MD, como una constante de JavaScript). */
export function proyectoConPrompt(carpeta = AQUI, tope) {
  const proyecto = leerProyecto(carpeta, CONFIG, tope ? { tope } : {});
  proyecto.paquetes.prompt = [`// EL PROMPT VERSIONADO (Flujos/experimental/rroca-evy/prompts/evy.md): los marcadores {{…}} y los bloques de marcas los resuelve evPromptDe en cada turno.\nconst EV_PROMPT = ${JSON.stringify(leerPrompt())};`];
  return proyecto;
}

/**
 * EL INTERRUPTOR SOLO DE ENSAYO en el CÓDIGO (solo de la variante de ensayo; los JSON de producción y de prueba quedan idénticos, byte a byte): hace que el aviso a la recepción y el botón «Escribir a recepción» salgan
 * aunque el destinatario sea quien escribe (un solo teléfono de ensayo). Tres reemplazos exactos; si el código cambia y el texto ya no está, FALLA (nunca un reemplazo silencioso).
 *   «Armar previos»  `avDestinatarios(…, false)` (nunca incluye al propio número) pasa a leer `base.avisarAlPropioNumero` de «Config base» (true exacto, o el texto «true»; ese nodo ya lee «Config base»);
 *   «Armar mensajes» lee «Config base» (una línea nueva tras `const from`) y el botón a la recepción se arma con `desde` vacío (si no, a su propio chat «no sirve» y sale el texto de «mismo número»).
 */
const LECTURA_DEL_INTERRUPTOR = "(base.avisarAlPropioNumero === true || base.avisarAlPropioNumero === 'true')";
export function interruptorDeEnsayo(flujo, donde = SALIDA_ENSAYO) {
  const reemplazos = [
    ['Armar previos', "avDestinatarios('completo:' + cnDigitos(cfg.numeroRecepcion), from, cfg.prefijosPermitidos, false)", `avDestinatarios('completo:' + cnDigitos(cfg.numeroRecepcion), from, cfg.prefijosPermitidos, ${LECTURA_DEL_INTERRUPTOR})`],
    ['Armar mensajes', "const from = String(t.from || '');\n", "const from = String(t.from || '');\nconst base = cnPrimero('Config base') || {};\n"],
    ['Armar mensajes', 'numero: cnDigitos(cfg.numeroRecepcion), desde: from, cuerpo: c, botonTexto: EV_BOTON_RECEPCION', `numero: cnDigitos(cfg.numeroRecepcion), desde: ${LECTURA_DEL_INTERRUPTOR} ? '' : from, cuerpo: c, botonTexto: EV_BOTON_RECEPCION`],
  ];
  for (const [nodo, antes, despues] of reemplazos) {
    const n = flujo.nodes.find((x) => x.name === nodo);
    const codigo = n && n.parameters && n.parameters.jsCode;
    if (typeof codigo !== 'string' || codigo.split(antes).length !== 2) throw new Error(`${donde}: «${nodo}» cambió y el interruptor de ensayo ya no encuentra dónde ponerse (tiene que aparecer exactamente una vez): rehaga el reemplazo`);
    n.parameters.jsCode = codigo.replace(antes, () => despues);
  }
}

/** Arma UNA variante con los datos ya validados. Devuelve el texto del JSON. */
export function armarEvy(proyecto, datos, v) {
  const prueba = v.archivo === ARCHIVO_PRUEBA;
  const ensayo = v.archivo === SALIDA_ENSAYO;
  const donde = v.archivo;
  const plantilla = JSON.parse(JSON.stringify(proyecto.plantilla));
  // Primero se quita lo que no corresponde: sus credenciales y rutas no tienen por qué estar resueltas.
  const quitar = new Set(Array.isArray(v.quitar) ? v.quitar : (v.quitar ? [v.quitar] : []));
  plantilla.nodes = plantilla.nodes.filter((n) => !quitar.has(n.name));
  // LA RAMA DEL miniCRM se GENERA (módulo `crm`), no se copia: 8 nodos debajo de «Armar mensajes» y encima de «Resumen del turno», que sigue siendo el último. La credencial la calcula el tenant, no sale de los datos.
  // El ENSAYO en el Demo A no la lleva (el Demo A no tiene la credencial de la planilla de Evy) y entra por un WhatsApp Trigger en vez de la entrada del receptor: el Trigger cuelga de «Config base», como las otras entradas.
  if (ensayo) {
    plantilla.nodes.push({ id: 'trigger-whatsapp', name: NODO_TRIGGER, type: 'n8n-nodes-base.whatsAppTrigger', typeVersion: 1, position: [-300, 300], parameters: { updates: ['messages'] },
      notes: 'SOLO en la variante de ENSAYO en el Demo A (`rroca-evy.ensayo-demo-a.json`). `flujo-de-prueba.mjs --sobre-demo-a` lo reemplaza por el Trigger VIVO del Demo A (id, webhookId, parámetros y credencial tal cual). Nunca la credencial de AAB1-WA-Prod (prohibición 7). Este archivo nunca se publica sobre el número de Evy.',
      credentials: { whatsAppTriggerApi: { id: '', name: '@@cred:trigger' } } });
    plantilla.connections[NODO_TRIGGER] = { main: [[{ node: 'Config base', type: 'main', index: 0 }]] };
  } else {
    const rama = ramaCrm({ credencial: '@@cred:crm', desde: 'Armar mensajes', paquete: 'crm-decidir-senales', x: 5480, y: 640 });
    plantilla.nodes.push(...rama.nodes);
    Object.assign(plantilla.connections, rama.connections);
    const previoDeArmar = (plantilla.connections['Armar mensajes'] && plantilla.connections['Armar mensajes'].main && plantilla.connections['Armar mensajes'].main[0]) || [];
    plantilla.connections['Armar mensajes'] = { main: [[...previoDeArmar, { node: rama.entrada, type: 'main', index: 0 }]] };
  }
  for (const n of plantilla.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${donde} · ${n.name}`);
    for (const c of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|graph|entradaPrueba|gemini|crm|trigger)$/.exec(String(c.name));
      // EXCEPCIÓN DECLARADA a «la prueba nunca usa credenciales de producción» (revisión del PR #741): la variante de prueba lleva el NOMBRE de la credencial del miniCRM del tenant (el id va vacío: no resuelve nada) porque la guardia `miniCRM` exige el mismo nombre en ambas variantes y la prueba no tiene planilla propia; sin id de planilla la rama no escribe (ver crm.test.ts, «id vacío»).
      if (m && m[1] === 'crm') { c.name = CREDENCIAL_CRM(dato(datos, 'tenant', `${donde} · ${n.name}`)); continue; }
      // La variante de PRUEBA nunca usa las credenciales de producción de Meta ni de Gemini.
      const clave = prueba && m && m[1] === 'graph' ? 'graphPrueba' : (prueba && m && m[1] === 'gemini' ? 'geminiPrueba' : (m ? m[1] : ''));
      if (m) c.name = dato(datos, `credenciales.${clave}`, `${donde} · ${n.name}`);
    }
    if (n.name === 'Config base') {
      // El ENSAYO no tiene modo ni etapa de prueba (sin `telefonosDePrueba` y con `etapaPrueba` vacía), deja la plantilla del aviso como NO aprobada (nunca se intenta una plantilla que el Demo A no tiene: el aviso sale por texto libre)
      // y no lleva los ids de las tres imágenes (son medios de la WABA de Evy: en el Demo A esa imagen no se envía).
      const datosBase = ensayo ? { ...datos, configBase: Object.fromEntries(Object.entries(datos.configBase).filter(([c]) => c !== 'telefonosDePrueba').map(([c, x]) => [c, c === 'etapaPrueba' || CLAVES_DE_ARTES.includes(c) ? '' : (c === 'avisoSolicitudEstado' ? 'PENDING' : x)])) } : datos;
      n.parameters.assignments.assignments = asignaciones(datosBase);
      // La variante de PRUEBA y la de ENSAYO no escriben en ninguna planilla: el id va vacío (nunca la hoja de un cliente real).
      if (prueba || ensayo) for (const a of n.parameters.assignments.assignments) if (a.name === 'planillaProspectosId') a.value = '';
    }
    // El módulo común de medios se INCLUYE desde su fuente (ya leída por el armador genérico, dentro de la raíz): el código queda tal cual, sin una sola edición.
    const js = n.parameters && n.parameters.jsCode;
    const m = typeof js === 'string' ? /^@@medio:([a-z0-9-]+)$/.exec(js) : null;
    if (m) {
      const fuente = proyecto.paquetes[m[1]];
      if (!fuente || fuente.length < 1) throw new Error(`${donde} · ${n.name}: el config no declara el paquete «${m[1]}»`);
      n.parameters.jsCode = fuente.join('\n\n') + '\n';
    }
  }
  // La cadena de envío común (no se copia), con las credenciales por NOMBRE. Cuelga de «Armar mensajes»; el resumen cuelga aparte y corre al final.
  // CANAL «rele» (relé B9 de AAB1): TODO lo que habla con Meta sale por el relé, con la credencial «AAB1 envío · <alias>» de este WABA y la URL interna como marcador (la sustituye el publicador). Ningún nodo llama a Graph.
  // CANAL «graph» (tanda 1 de Evy, 07/11/2026): nada de lo anterior se toca; el envío, la descarga y el guardado salen directo por Graph con las credenciales por NOMBRE de los datos.
  const relePorNombre = (nombre) => { const nodo = plantilla.nodes.find((x) => x.name === nombre); if (!nodo) throw new Error(`${donde}: falta el nodo «${nombre}»`); return nodo; };
  if (ES_RELE) plantilla.settings = Object.assign({}, plantilla.settings, { executionTimeout: 300, errorWorkflow: 'REEMPLAZAR_ID_ERROR_WORKFLOW' });
  const credRele = { httpHeaderAuth: { id: '', name: CREDENCIAL_RELE } };
  if (ES_RELE) {
    const idMedio = "String($('Normalizar entrada').first().json.mediaId || '').replace(/[^A-Za-z0-9_-]/g, '')";
    const info = relePorNombre('Obtener URL del medio (general)');
    info.parameters.url = `=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ ${idMedio} }}`;
    info.credentials = credRele; info.waitBetweenTries = 3000;
    info.notes = 'Información del medio por el relé (GET medios/<id>): devuelve id, mime_type y file_size, no el archivo (ni url). Cada GET gasta una de las 500 descargas diarias por WABA (relé B9).';
    const bajar = relePorNombre('Descargar medio');
    bajar.parameters.url = `=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ ${idMedio} }}/contenido`;
    bajar.credentials = credRele; bajar.waitBetweenTries = 3000;
    bajar.notes = 'Contenido del medio por el relé (GET medios/<id>/contenido): el archivo como binario `data`, sin seguir redirecciones; solo llega aquí si «¿Tamaño aceptable?» confirmó el tamaño. No se guarda en ningún lado.';
    const tam = relePorNombre('¿Tamaño aceptable?').parameters.conditions.conditions[0];
    if (!tam.leftValue.includes("String($json.url || '').startsWith('https://lookaside.fbsbx.com/')")) throw new Error(`${donde}: «¿Tamaño aceptable?» cambió: ya no pide la url de Meta`);
    tam.leftValue = tam.leftValue.replace("String($json.url || '').startsWith('https://lookaside.fbsbx.com/')", "String($json.id || '') !== ''");
    const aviso = relePorNombre('Enviar aviso');
    aviso.parameters = parametrosDeMensajeRele({ cliente: CLIENTE_RELE, credenciales: { rele: CREDENCIAL_RELE }, rol: 'aviso', pnidExpresion: '$json.phoneNumberId', payloadExpresion: '$json.payload', destinoExpresion: '$json.para', nExpresion: '$json.n', lote: { tamano: 1, intervaloMs: 1500 } });
    aviso.credentials = credRele;
    aviso.notes = 'Envía de a uno, con 1,5 s entre mensajes y en el orden de «Armar previos», POR EL RELÉ (Idempotency-Key rol aviso + n). Sin reintentos: un aviso repetido llegaría dos veces. El resultado (un `wamid` real o el error del relé) lo lee «Armar mensajes»: si la imagen no salió, el texto no la promete.';
  }
  let armadoNodo = null;
  let marcaDelArmado = null;
  if (ES_RELE) {
    // `injertar` exige que «Armar mensajes» LLAME a cmNumerar en su return final: en la plantilla el código es todavía una marca `@@…:nodos/armar-mensajes.js`, así que se le muestra la fuente de ese archivo (la que se pega en el nodo) y se restaura la marca.
    armadoNodo = relePorNombre('Armar mensajes');
    marcaDelArmado = armadoNodo.parameters.jsCode;
    const fuenteDelArmado = /^@@[a-z+]*:(.+)$/.exec(String(marcaDelArmado));
    if (!fuenteDelArmado) throw new Error(`${donde}: «Armar mensajes» ya no se arma desde un archivo de nodos/`);
    armadoNodo.parameters.jsCode = leerSiExiste(join(AQUI, 'src', fuenteDelArmado[1]), 'armar-mensajes.js') || '';
  }
  injertar(plantilla, {
    ...(ES_RELE ? { canal: 'rele', cliente: CLIENTE_RELE, credenciales: { rele: CREDENCIAL_RELE, ingesta: dato(datos, 'credenciales.ingesta', donde) } }
      : { credenciales: { graph: dato(datos, prueba ? 'credenciales.graphPrueba' : 'credenciales.graph', donde), ingesta: dato(datos, 'credenciales.ingesta', donde) } }),
    ingestaUrl: `https://${ANFITRION_CONSOLA}/ingesta`,
    entrada: 'Normalizar entrada',
    desde: [5480, 300],
  });
  if (ES_RELE) armadoNodo.parameters.jsCode = marcaDelArmado;
  // La PUERTA DE LA ENTREGA (I-ENTREGA, regla 3): lo que se reporta como enviado SOLO es lo que Meta aceptó con un `messages[0].id` (el envío principal o su respaldo). En el canal rele el id llega como `idMeta` (envío principal, lo escribe
  // «Leer respuesta del relé») o como `messages[0].id` (el respaldo). Se agrega a la condición de «¿Reportar? (saliente)» que arma el módulo común (sin un nodo nuevo).
  const puerta = plantilla.nodes.find((n) => n.name === '¿Reportar? (saliente)');
  const condicion = puerta && puerta.parameters && puerta.parameters.conditions && puerta.parameters.conditions.conditions && puerta.parameters.conditions.conditions[0];
  if (ES_RELE) {
    const FIN_COMUN = " && j.accion !== 'agotado' && !j.error; })() }}";
    if (!condicion || typeof condicion.leftValue !== 'string' || !condicion.leftValue.endsWith(FIN_COMUN)) throw new Error(`${donde}: la cadena común cambió: «¿Reportar? (saliente)» ya no tiene la condición esperada`);
    condicion.leftValue = condicion.leftValue.slice(0, -FIN_COMUN.length) + " && j.accion !== 'agotado' && !j.error && !!(j.idMeta || (Array.isArray(j.messages) && j.messages[0] && j.messages[0].id)); })() }}";
  } else {
    if (!condicion || condicion.leftValue !== "={{ $('Armar mensajes').item.json.reportar === true && !($json && $json.error) }}") throw new Error(`${donde}: la cadena común cambió: «¿Reportar? (saliente)» ya no tiene la condición esperada`);
    condicion.leftValue = "={{ $('Armar mensajes').item.json.reportar === true && !!($json && !$json.error && Array.isArray($json.messages) && $json.messages[0] && $json.messages[0].id) }}";
  }
  // El reporte saliente de ESTE flujo: igual al común, más el EVENTO `no_contactar` (la baja y la protección), que viaja SIEMPRE, aunque salga el respaldo; y SOLO ese evento (el común manda `evento` siempre, aunque vacío).
  const rep = plantilla.nodes.find((n) => n.name === 'Reportar mensaje (saliente)');
  if (ES_RELE) {
    const cuerpoComun = rep && rep.parameters && rep.parameters.jsonBody;
    if (typeof cuerpoComun !== 'string' || !cuerpoComun.includes('return JSON.stringify({ telefono:') || !cuerpoComun.endsWith(", evento: m.evento }); })() }}")) throw new Error(`${donde}: la cadena común cambió: «Reportar mensaje (saliente)» ya no arma el cuerpo esperado`);
    rep.parameters.jsonBody = cuerpoComun.replace('return JSON.stringify({ telefono:', 'const r = { telefono:').replace(", evento: m.evento }); })() }}", " }; if (m.evento === 'no_contactar') { r.evento = 'no_contactar'; } return JSON.stringify(r); })() }}");
  } else {
    if (!rep || typeof rep.parameters.jsonBody !== 'string' || !rep.parameters.jsonBody.includes('evento: m.evento')) throw new Error(`${donde}: la cadena común cambió: «Reportar mensaje (saliente)» ya no arma el cuerpo esperado`);
    rep.parameters.jsonBody = "={{ (() => { const m = $('Armar mensajes').item.json; const r = { telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: ((($json || {}).messages || [])[0] || {}).id || '' }; if (m.evento === 'no_contactar') { r.evento = 'no_contactar'; } return JSON.stringify(r); })() }}";
  }
  // El GUARDADO de medios (módulo común, nunca copiado): cuelga de «Reportar mensaje (entrante)», debajo de todo; credenciales tomadas por nombre del flujo ya armado.
  injertarGuardado(plantilla, ES_RELE ? { canal: 'rele', cliente: CLIENTE_RELE, guardarUrl: `https://${ANFITRION_CONSOLA}/guardarMedio` } : { guardarUrl: `https://${ANFITRION_CONSOLA}/guardarMedio` });
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: v.archivo, nombre: dato(datos, prueba ? 'nombreFlujoPrueba' : 'nombreFlujo', donde), quitar: [] });
  const flujo = JSON.parse(texto);
  // El mapa de columnas del tenant (dato, no código) dentro de los nodos del módulo y los rangos de lectura de los nodos de Google. El ENSAYO no tiene esa rama.
  if (!ensayo) injertarCrm(flujo, datos.crm);
  else interruptorDeEnsayo(flujo, donde);
  if (!sinMarcas(flujo, false)) throw new Error(`${donde}: quedó una marca @@ sin reemplazar`);
  return JSON.stringify(flujo, null, 2) + '\n';
}

/**
 * Arma (o verifica) las dos variantes. Devuelve un resultado por archivo. Lanza ante un dato inválido, una guardia violada en lo armado o un prompt con teléfonos.
 *   opciones: { carpeta, datos (ruta), verificar, tope }   (`tope` es para las pruebas)
 */
export function construir({ carpeta = AQUI, datos: rutaDatos = ARCHIVO_DE_DATOS, verificar = false, tope } = {}) {
  vigilarInterruptor(dirname(rutaDatos));
  const datos = cargarDatos(rutaDatos);
  const proyecto = proyectoConPrompt(carpeta, tope);
  return proyecto.variantes.map((v) => {
    const texto = armarEvy(proyecto, datos, v);
    const variante = v.archivo === ARCHIVO_PRUEBA ? 'prueba' : 'produccion';
    // Lo que se arma nunca viola las guardias…
    const propios = guardias(variante, JSON.parse(texto));
    if (propios.length) throw new Error(`${v.archivo}: ${propios.join('; ')}`);
    const ruta = join(carpeta, v.archivo);
    const actual = leerSiExiste(ruta, v.archivo);
    // …y el archivo VERSIONADO tampoco las viola (aunque alguien lo haya tocado a mano).
    let versionado = [];
    if (actual !== null) {
      try { versionado = guardias(variante, JSON.parse(actual)); } catch (x) { versionado = ['no es un JSON válido']; }
      // El JSON VERSIONADO lleva el marcador exacto, nunca un id resuelto (el id es de un n8n y no se versiona).
      if (ES_RELE && versionado.length === 0) { try { if ((JSON.parse(actual).settings || {}).errorWorkflow !== 'REEMPLAZAR_ID_ERROR_WORKFLOW') versionado = ['versionado: `errorWorkflow` tiene que ser exactamente REEMPLAZAR_ID_ERROR_WORKFLOW (un id resuelto no se versiona)']; } catch (x) { /* ya informado */ } }
    }
    if (!verificar) escribirSinSeguirEnlaces(ruta, texto, v.archivo);
    return { archivo: v.archivo, nodos: JSON.parse(texto).nodes.length, existia: actual !== null, alDia: actual === texto, versionado };
  });
}

/**
 * Arma (o verifica) la variante de ENSAYO en el Demo A. Aparte de `construir()` a propósito: las otras dos variantes y sus pruebas no cambian. Mismo resultado por archivo.
 *   opciones: { carpeta, datos (ruta del archivo de ensayo), base (ruta de rroca-evy.json), verificar, tope }
 */
export function construirEnsayo({ carpeta = AQUI, datos: rutaDatos = ARCHIVO_DE_DATOS_ENSAYO, base: rutaBase = ARCHIVO_DE_DATOS, verificar = false, tope } = {}) {
  const datos = cargarDatosEnsayo(rutaDatos, rutaBase);
  const proyecto = proyectoConPrompt(carpeta, tope);
  const v = { archivo: SALIDA_ENSAYO, quitar: QUITAR_EN_EL_ENSAYO, nombre: 'se toma de los datos' };
  const texto = armarEvy(proyecto, datos, v);
  const propios = guardias('ensayo-demo-a', JSON.parse(texto));
  if (propios.length) throw new Error(`${v.archivo}: ${propios.join('; ')}`);
  const ruta = join(carpeta, v.archivo);
  const actual = leerSiExiste(ruta, v.archivo);
  let versionado = [];
  if (actual !== null) {
    try { versionado = guardias('ensayo-demo-a', JSON.parse(actual)); } catch (x) { versionado = ['no es un JSON válido']; }
  }
  if (!verificar) escribirSinSeguirEnlaces(ruta, texto, v.archivo);
  return { archivo: v.archivo, nodos: JSON.parse(texto).nodes.length, existia: actual !== null, alDia: actual === texto, versionado };
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--publicable')) {
    const OPCIONES = ['--flujo', '--datos', '--negocio', '--etapa'];
    const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
    const resto = args.filter((a, i) => a !== '--publicable' && !OPCIONES.includes(a) && !OPCIONES.includes(args[i - 1]));
    if (resto.length || args.includes('--verificar') || OPCIONES.some((n) => args.includes(n) && !opcion(n))) {
      console.error('✗ uso: construir.mjs --publicable [--flujo <json>] [--datos <json>] [--negocio <json>] [--etapa crear|prueba|encender]'); process.exit(2);
    }
    const etapa = opcion('--etapa') || 'encender';
    if (!ETAPAS.includes(etapa)) { console.error(`✗ --etapa: ${ETAPAS.join(' | ')}`); process.exit(2); }
    // Un SyntaxError puede traer un fragmento del archivo: mensaje fijo, sin contenido.
    const leerJson = (ruta, que) => {
      const texto = leerSiExiste(ruta, que);
      if (texto === null) throw new Error(`no existe ${que}`);
      try { return JSON.parse(texto); } catch { throw new Error(`JSON inválido en ${que}`); }
    };
    try {
      const flujoJson = leerJson(opcion('--flujo') || join(AQUI, ARCHIVO_PRODUCCION), 'el flujo de Evy');
      const negocio = leerJson(opcion('--negocio') || ARCHIVO_DE_NEGOCIO, 'el archivo de datos del negocio de Evy');
      const hallazgos = guardiaDePublicacion({ flujo: flujoJson, datos: cargarDatos(opcion('--datos') || ARCHIVO_DE_DATOS), negocio, etapa });
      if (hallazgos.length) {
        console.error(`✗ El flujo de Evy NO se puede publicar todavía (etapa ${etapa}):`);
        for (const x of hallazgos) console.error(`  - ${x}`);
        process.exit(1);
      }
      if (etapa === 'prueba') console.log('✓ Evy: etapa prueba: sin marcadores, con etapaPrueba = si, teléfonos de prueba válidos y la recepción dentro de ellos, y las tres imágenes resueltas: se puede ENCENDER EN MODO PRUEBA (solo atiende a esos teléfonos).');
      else if (etapa === 'crear') console.log('✓ Evy: etapa crear: sin marcadores, con identidad, credenciales, las tres imágenes y los tres medios: se puede CREAR INACTIVO (no se enciende: falta la plantilla APPROVED si Meta aún no la aprobó).');
      else console.log('✓ Evy: sin marcadores REEMPLAZAR_*, con la plantilla de aviso APPROVED, las tres imágenes resueltas y los tres medios declarados: se puede publicar (con la confirmación de quien publica).');
      process.exit(0);
    } catch (e) {
      console.error(e instanceof SyntaxError ? '✗ JSON inválido' : `✗ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }
  const desconocidos = args.filter((a) => a !== '--verificar');
  if (desconocidos.length) { console.error(`✗ argumento desconocido: ${desconocidos.join(' ').slice(0, 60)}. Solo existen --verificar y --publicable; sin argumentos escribe los JSON (producción, prueba y ensayo).`); process.exit(2); }
  const verificar = args.includes('--verificar');
  try {
    let difiere = false;
    for (const r of [...construir({ verificar }), construirEnsayo({ verificar })]) {
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
