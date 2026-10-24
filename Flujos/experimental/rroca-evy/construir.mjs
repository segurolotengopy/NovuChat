#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON del flujo NUEVO de la Dra. Evy Karina (tenant rroca-evy) desde la plantilla, el prompt versionado y los datos
 * =============================================================================
 *
 *   node Flujos/experimental/rroca-evy/construir.mjs               escribe rroca-evy.json y rroca-evy.prueba.json
 *   node Flujos/experimental/rroca-evy/construir.mjs --verificar   no escribe: sale 1 si un JSON versionado difiere de lo que se arma o viola una guardia
 *   node Flujos/experimental/rroca-evy/construir.mjs --publicable [--flujo <json>] [--datos <json>] [--negocio <json>] [--etapa crear|prueba|encender]
 *                                                                  GUARDIA DE PUBLICACIÓN: no escribe; sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal
 *   (cualquier otro argumento se rechaza: la ayuda no existe como opción, para que nada escriba por error)
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
 *   - «Reportar mensaje (entrante)» va ARRIBA de la rama que responde; «Enviar previos» (imágenes y aviso) corre ANTES de «Armar mensajes»; la prueba nunca usa credenciales de producción.
 */
import { closeSync, constants, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
import { injertar } from '../comun-sin-agente/src/envio.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const ARCHIVO_DE_DATOS = join(AQUI, '../../../admin/scripts/datos/rroca-evy/rroca-evy.json');
export const ARCHIVO_DE_NEGOCIO = join(AQUI, '../../../admin/scripts/datos/rroca-evy/negocio-rroca-evy.json');
export const ARCHIVO_DEL_PROMPT = join(AQUI, 'prompts/evy.md');
export const TOPE_DE_NODOS = 36;
export const ARCHIVO_PRODUCCION = 'rroca-evy.json';
export const ARCHIVO_PRUEBA = 'rroca-evy.prueba.json';

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
  },
  variantes: [
    { archivo: ARCHIVO_PRODUCCION, quitar: 'Entrada de prueba', nombre: 'se toma de los datos' },
    { archivo: ARCHIVO_PRUEBA, quitar: ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'], nombre: 'se toma de los datos' },
  ],
};

/** El flujo: lo que tiene que estar siempre (la guardia lo exige). */
export const NODOS_DE_LA_CONVERSACION = ['¿Conversar con el modelo?', 'Conversar con el modelo', 'Armar previos', '¿Hay previos?', 'Enviar previos', 'Armar mensajes', 'Resumen del turno'];
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
  const errores = [];
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
    for (const c of ['phoneNumberIdEsperado', 'numeroRecepcion', 'nombreNegocio', 'tenantId', 'clinica', 'arteComparativoMediaId', 'arteAntesDespuesMediaId', 'arteAutoridadMediaId']) if (cb[c] === undefined || cb[c] === '') errores.push(`configBase.${c}: falta`);
    if (cb.tenantId !== undefined && cb.tenantId !== d.tenant) errores.push('configBase.tenantId: tiene que ser el tenant de este archivo');
    for (const c of TEXTOS_LIBRES) if (typeof cb[c] === 'string' && (/https?:|www\.|wa\.me|[<>{}\[\]]/i.test(cb[c]))) errores.push(`configBase.${c}: no puede llevar enlaces, llaves ni corchetes`);
    if (typeof cb.direccionRespaldo === 'string' && /\d{7,}/.test(cb.direccionRespaldo.replace(/\s/g, ''))) errores.push('configBase.direccionRespaldo: no puede llevar un número largo');
  }
  if (errores.length) throw new Error(`rroca-evy.json: datos no válidos: ${errores.join('; ')}`);
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
  const conex = (flujo && flujo.connections) || {};
  const destinosDe = (nombre, salida) => (((conex[nombre] || {}).main || [])[salida] || []).map((x) => x.node);
  if (nodos.length > TOPE_DE_NODOS) h.push(`tiene ${nodos.length} nodos y el tope es ${TOPE_DE_NODOS}: si pasa, se rehace`);
  if (nodos.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')) h.push('contiene un WhatsApp Trigger (prohibición 7: reescribe el webhook de toda la app)');
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) h.push('menciona «subscriptions» o «subscribed_apps» (prohibición 7)');
  if (/langchain\.(agent|memory\w*|lmChat\w*|chain\w*)$/i.test(nodos.map((n) => n.type).join('\n'))) h.push('lleva un agente, memoria o modelo de chat de n8n: este flujo no los lleva (el modelo es una llamada HTTP intercambiable)');
  for (const n of [...NODOS_DE_LA_CONVERSACION, ...NODOS_DE_MEDIOS]) if (!nombres.has(n)) h.push(`falta el nodo «${n}»`);
  h.push(...problemasDeReferencias(flujo || {}));
  // Las imágenes y el aviso SALEN antes de armar el texto: «Armar previos» → «¿Hay previos?» → «Enviar previos» → «Armar mensajes»; la rama sin previos también llega a «Armar mensajes».
  if (nombres.has('Armar previos') && !destinosDe('Armar previos', 0).includes('¿Hay previos?')) h.push('«Armar previos» no está conectado a «¿Hay previos?»');
  if (nombres.has('¿Hay previos?') && !destinosDe('¿Hay previos?', 0).includes('Enviar previos')) h.push('«¿Hay previos?» no envía por «Enviar previos»');
  if (nombres.has('¿Hay previos?') && !destinosDe('¿Hay previos?', 1).includes('Armar mensajes')) h.push('«¿Hay previos?» no envía la rama sin previos (salida 1) a «Armar mensajes»');
  if (nombres.has('Enviar previos') && !destinosDe('Enviar previos', 0).includes('Armar mensajes')) h.push('«Enviar previos» no cuelga de «Armar mensajes»: las imágenes y el aviso tienen que correr ANTES de armar el texto que dice si salieron');
  const enviarPrevios = por('Enviar previos');
  if (enviarPrevios && !((enviarPrevios.credentials || {}).httpHeaderAuth || {}).name) h.push('«Enviar previos» no lleva credencial (httpHeaderAuth)');
  if (enviarPrevios && (enviarPrevios.onError !== 'continueRegularOutput' || enviarPrevios.alwaysOutputData !== true)) h.push('«Enviar previos» no lleva `onError: continueRegularOutput` y `alwaysOutputData`: si Meta rechaza una imagen, el turno se cortaría y el cliente quedaría sin respuesta');
  if (enviarPrevios && p(enviarPrevios).options && p(enviarPrevios).options.retryOnFail) h.push('«Enviar previos» no reintenta: un aviso repetido llegaría dos veces');
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
  // La variante de PRUEBA nunca usa credenciales de producción: ni la de Graph ni la de Gemini.
  if (variante === 'prueba') {
    for (const n of nodos) {
      for (const [tipo, c] of Object.entries(n.credentials || {})) {
        const nombreCred = String((c || {}).name || '');
        if ((tipo === 'googlePalmApi' && !/pruebas/i.test(nombreCred)) || (n.name !== NODO_PRUEBA && n.name !== 'Traer configuración' && n.name !== 'Reportar mensaje (entrante)' && n.name !== 'Reportar mensaje (saliente)' && tipo === 'httpHeaderAuth' && !/pruebas/i.test(nombreCred))) {
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
  // Retención de ejecuciones (datos de salud: no se guardan ni los turnos fallidos), orden y zona horaria.
  const st = (flujo && flujo.settings) || {};
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'none' || st.saveExecutionProgress !== false) h.push('los ajustes de retención deben ser saveDataSuccessExecution «none», saveDataErrorExecution «none» (datos de salud: no se guardan ni los turnos fallidos) y saveExecutionProgress false');
  if (st.errorWorkflow !== undefined) h.push('no lleva `errorWorkflow`');
  if (st.executionOrder !== 'v1') h.push('executionOrder tiene que ser «v1» (el orden de las ramas es el del lienzo)');
  if (st.timezone !== 'America/La_Paz') h.push('timezone tiene que ser «America/La_Paz»');
  // `REEMPLAZAR_` solo en «Config base», en el receptor y en la ruta de la entrada de prueba.
  const conMarcador = new Set(['Config base', NODO_RECEPTOR, 'Verificar firma con el receptor', NODO_PRUEBA]);
  for (const n of nodos) {
    if (conMarcador.has(n.name)) continue;
    if (/REEMPLAZAR_[A-Z0-9]/.test(JSON.stringify(n).replace(/\/\^?REEMPLAZAR_\/i?/gi, ''))) h.push(`el nodo «${n.name}» trae un marcador REEMPLAZAR_: solo va en «Config base», el receptor y la ruta de prueba`);
  }
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
  for (const c of CLAVES_DE_ARTES) if (!/^\d{6,25}$/.test(String(cb[c] === undefined ? '' : cb[c]))) h.push(`${donde}: ${c} no está resuelto (el id del medio ya subido a Meta; los medios vencen a los 30 días)`);
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
    if (!coincide(v, enFlujo[c])) h.push(`Config base: ${c} no coincide con los datos de Evy`);
  }
  return h;
}

export function guardiaDePublicacion({ flujo, datos, negocio, etapa = 'encender' }) {
  if (!ETAPAS.includes(etapa)) return [`etapa desconocida (${ETAPAS.join(' | ')})`];
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  if (!nodos.length) h.push('el flujo no trae nodos');
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

/** Arma UNA variante con los datos ya validados. Devuelve el texto del JSON. */
export function armarEvy(proyecto, datos, v) {
  const prueba = v.archivo === ARCHIVO_PRUEBA;
  const donde = v.archivo;
  const plantilla = JSON.parse(JSON.stringify(proyecto.plantilla));
  // Primero se quita lo que no corresponde: sus credenciales y rutas no tienen por qué estar resueltas.
  const quitar = new Set(Array.isArray(v.quitar) ? v.quitar : (v.quitar ? [v.quitar] : []));
  plantilla.nodes = plantilla.nodes.filter((n) => !quitar.has(n.name));
  for (const n of plantilla.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${donde} · ${n.name}`);
    for (const c of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|graph|entradaPrueba|gemini)$/.test(String(c.name)) ? /^@@cred:(ingesta|graph|entradaPrueba|gemini)$/.exec(String(c.name)) : null;
      // La variante de PRUEBA nunca usa las credenciales de producción de Meta ni de Gemini.
      const clave = prueba && m && m[1] === 'graph' ? 'graphPrueba' : (prueba && m && m[1] === 'gemini' ? 'geminiPrueba' : (m ? m[1] : ''));
      if (m) c.name = dato(datos, `credenciales.${clave}`, `${donde} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos);
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
  injertar(plantilla, {
    credenciales: { graph: dato(datos, prueba ? 'credenciales.graphPrueba' : 'credenciales.graph', donde), ingesta: dato(datos, 'credenciales.ingesta', donde) },
    ingestaUrl: `https://${ANFITRION_CONSOLA}/ingesta`,
    entrada: 'Normalizar entrada',
    desde: [5480, 300],
  });
  // El reporte saliente de ESTE flujo: igual al común, más el EVENTO `no_contactar` (la baja y la protección), que viaja SIEMPRE, aunque salga el respaldo.
  const rep = plantilla.nodes.find((n) => n.name === 'Reportar mensaje (saliente)');
  if (!rep || typeof rep.parameters.jsonBody !== 'string' || !rep.parameters.jsonBody.includes('evento: m.evento')) throw new Error(`${donde}: la cadena común cambió: «Reportar mensaje (saliente)» ya no arma el cuerpo esperado`);
  rep.parameters.jsonBody = "={{ (() => { const m = $('Armar mensajes').item.json; const r = { telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: ((($json || {}).messages || [])[0] || {}).id || '' }; if (m.evento === 'no_contactar') { r.evento = 'no_contactar'; } return JSON.stringify(r); })() }}";
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: v.archivo, nombre: dato(datos, prueba ? 'nombreFlujoPrueba' : 'nombreFlujo', donde), quitar: [] });
  const flujo = JSON.parse(texto);
  if (!sinMarcas(flujo, false)) throw new Error(`${donde}: quedó una marca @@ sin reemplazar`);
  return JSON.stringify(flujo, null, 2) + '\n';
}

/**
 * Arma (o verifica) las dos variantes. Devuelve un resultado por archivo. Lanza ante un dato inválido, una guardia violada en lo armado o un prompt con teléfonos.
 *   opciones: { carpeta, datos (ruta), verificar, tope }   (`tope` es para las pruebas)
 */
export function construir({ carpeta = AQUI, datos: rutaDatos = ARCHIVO_DE_DATOS, verificar = false, tope } = {}) {
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
    }
    if (!verificar) escribirSinSeguirEnlaces(ruta, texto, v.archivo);
    return { archivo: v.archivo, nodos: JSON.parse(texto).nodes.length, existia: actual !== null, alDia: actual === texto, versionado };
  });
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
