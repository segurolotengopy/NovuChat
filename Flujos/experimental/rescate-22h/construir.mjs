#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma el flujo «Rescate 22 h» de UN tenant desde la plantilla y sus datos
 * =============================================================================
 *
 *   node construir.mjs --tenant <id>                       escribe rescate-22h.<id>.json
 *   node construir.mjs --todos                             lo mismo para cada admin/scripts/datos/<id>/rescate-22h.json
 *   (con --verificar no escribe: sale 1 si un JSON versionado difiere de lo que se arma o viola una guardia)
 *   node construir.mjs --publicable (--tenant <id> | --flujo <json>) [--datos <json>]
 *                                                          GUARDIA DE PUBLICACIÓN: no escribe; sale 1 si el flujo trae un `REEMPLAZAR_*` sin sustituir
 *   (cualquier otro argumento se rechaza)
 *
 * QUÉ HACE. Un flujo de n8n por tenant, con disparador propio cada 10 minutos, que RECLAMA al servidor quién toca rescate (la decisión y la marca
 * única viven en la Function `reclamarRescates`), deja redactar el cuerpo al modelo, lo verifica por código y lo envía con la cadena de envío común.
 * El código es el MISMO para todos los tenants: lo único que cambia es el archivo de datos (`admin/scripts/datos/<id>/rescate-22h.json`), que da el
 * nombre del flujo, las credenciales POR NOMBRE y las asignaciones de «Config base». La cadena de envío y el filtro de redacción se INCLUYEN de
 * `../comun-sin-agente/` (no se copian). Esto reemplaza al «barrido común» hasta que exista el relé de envíos.
 *
 * LAS GUARDIAS de lo armado (también al archivo versionado, aunque alguien lo haya tocado a mano): ver `guardias()`.
 */
import { closeSync, constants, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
import { injertar } from '../comun-sin-agente/src/envio.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const CARPETA_DE_DATOS = join(AQUI, '../../../admin/scripts/datos');
export const RS_URL_RECLAMAR = 'https://us-east1-novuchat-demo.cloudfunctions.net/reclamarRescates';
export const RS_URL_INGESTA = 'https://us-east1-novuchat-demo.cloudfunctions.net/ingesta';
export const TOPE_DE_NODOS = 16;
const ANFITRIONES_LIBRES = ['graph.facebook.com', 'generativelanguage.googleapis.com'];

/**
 * El config del armador genérico. Vive aquí y no en un `construir.config.json`: el saneo del repo público trata todo JSON bajo `Flujos/` como un export de
 * n8n. Las variantes se arman por tenant (una por archivo de datos), así que `variantes` lo completa `construir()`.
 */
export const CONFIG = {
  plantilla: 'flujo.plantilla.json',
  raiz: '../..',
  librerias: ['src/rescate.js'],
  paquetes: { filtro: ['../comun-sin-agente/src/filtro-redaccion.js'] },
};

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

// ----------------------------------------------------------------- la librería del rescate, para validar los textos con el MISMO código que corre en n8n
let LIBRERIA = null;
function libreria() {
  if (LIBRERIA) return LIBRERIA;
  const filtro = readFileSync(join(AQUI, '../comun-sin-agente/src/filtro-redaccion.js'), 'utf8');
  const rescate = readFileSync(join(AQUI, 'src/rescate.js'), 'utf8');
  // Excepción deliberada a `devsecops.js-eval-prohibido`: se ejecutan dos archivos NUESTROS y versionados (el cuerpo de un nodo Code de n8n no es un módulo
  // importable), con el único fin de validar los textos de los datos con el mismo código que los verificará en producción. Nada de lo que viene de los datos se evalúa.
  // nosemgrep: devsecops.js-eval-prohibido
  LIBRERIA = new Function(`${filtro}\n${rescate}\nreturn { rsTextoFijoValido, rsSaludoValido };`)();
  return LIBRERIA;
}

// ----------------------------------------------------------------- los datos
const MARCADOR = /^REEMPLAZAR_[A-Z0-9_]+$/;
const TELEFONOS = '\\d{8,15}(,\\d{8,15})*';
// Lista CERRADA de lo que «Config base» puede llevar: cualquier otra clave (p. ej. `modoPrueba`) se rechaza.
const FORMAS_CONFIG = {
  phoneNumberId: /^(\d{6,25}|REEMPLAZAR_[A-Z0-9_]+)$/,
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/,
  modelo: /^gemini-[a-z0-9][a-z0-9.-]{1,38}$/,
  telefonosDePrueba: new RegExp(`^(${TELEFONOS}|REEMPLAZAR_[A-Z0-9_]+)$`),
  telefonosExcluidos: new RegExp(`^(${TELEFONOS})?$`),
  quienPromete: /^[^,]+(,[^,]+)*$/,
};
const TEXTOS = ['rescateQuien', 'rescateContexto', 'rescateSaludo', 'rescateTextoFijo'];
const CLAVES_ADMITIDAS = new Set(['phoneNumberId', 'waGraphVersion', 'modelo', 'listaDePrueba', 'telefonosDePrueba', 'telefonosExcluidos', 'quienPromete', ...TEXTOS]);
const OBLIGATORIAS = ['phoneNumberId', 'listaDePrueba', 'telefonosDePrueba', 'quienPromete', ...TEXTOS];

/** Lee y valida el archivo de datos de un tenant. Cada error nombra el campo. */
export function cargarDatos(tenant, ruta = join(CARPETA_DE_DATOS, String(tenant), 'rescate-22h.json')) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(tenant))) throw new Error('tenant: solo minúsculas, números y guiones');
  const texto = leerSiExiste(ruta, 'rescate-22h.json');
  if (texto === null) throw new Error(`no existe el archivo de datos ${ruta}`);
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error('rescate-22h.json: no es un JSON válido'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('rescate-22h.json: tiene que ser un objeto');
  const errores = [];
  const cadena = (campo, v) => { if (typeof v !== 'string' || v.trim() === '') errores.push(`${campo}: falta`); };
  if (d.tenant !== tenant) errores.push('tenant: no coincide con el pedido');
  cadena('nombreFlujo', d.nombreFlujo);
  for (const c of ['ingesta', 'graph', 'gemini']) cadena(`credenciales.${c}`, (d.credenciales || {})[c]);
  const cb = d.configBase && typeof d.configBase === 'object' && !Array.isArray(d.configBase) ? d.configBase : null;
  if (!cb) errores.push('configBase: falta');
  else {
    for (const [c, v] of Object.entries(cb)) {
      if (!CLAVES_ADMITIDAS.has(c)) { errores.push(`configBase.${c}: clave no admitida`); continue; }
      if (!['string', 'number', 'boolean'].includes(typeof v)) { errores.push(`configBase.${c}: solo texto, número o booleano`); continue; }
      if (c === 'listaDePrueba') { if (typeof v !== 'boolean') errores.push('configBase.listaDePrueba: tiene que ser booleano'); continue; }
      if (typeof v !== 'string') { errores.push(`configBase.${c}: tiene que ser texto`); continue; }
      if (FORMAS_CONFIG[c] && !FORMAS_CONFIG[c].test(v)) errores.push(`configBase.${c}: forma no válida`);
      // Un valor que empieza con «=» es una expresión para n8n, y «{{» abre otra: los datos nunca son código.
      if (v.startsWith('=') || v.includes('{{') || v.includes('@@') || /[\u0000-\u001f]/.test(v)) errores.push(`configBase.${c}: trae un carácter no admitido`);
    }
    for (const c of OBLIGATORIAS) if (cb[c] === undefined) errores.push(`configBase.${c}: falta`);
    for (const c of TEXTOS) if (typeof cb[c] === 'string' && cb[c].trim() === '') errores.push(`configBase.${c}: falta`);
    if (typeof cb.rescateTextoFijo === 'string' && !libreria().rsTextoFijoValido(cb.rescateTextoFijo)) errores.push('configBase.rescateTextoFijo: no es un texto fijo válido (de 20 a 400 caracteres, con «?» y «asistente virtual», sin dígitos, enlaces ni temas de cobro)');
    if (typeof cb.rescateSaludo === 'string' && !libreria().rsSaludoValido(cb.rescateSaludo)) errores.push('configBase.rescateSaludo: no es un saludo válido (de 10 a 80 caracteres, con «asistente virtual», sin dígitos)');
  }
  if (errores.length) throw new Error(`rescate-22h.json (${tenant}): datos no válidos: ${errores.join('; ')}`);
  return d;
}

const asignaciones = (configBase) => Object.entries(configBase).map(([nombre, valor]) => ({ id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor }));

// ----------------------------------------------------------------- las guardias de lo armado
function anfitrionPermitido(url) {
  const sinIgual = String(url).replace(/^=/, '');
  if (sinIgual === RS_URL_RECLAMAR || sinIgual === RS_URL_INGESTA) return true;
  const m = /^https:\/\/([^/?#\s]*)/i.exec(sinIgual);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return false;
  return ANFITRIONES_LIBRES.includes(m[1].toLowerCase());
}

const CADENA = ['Cada 10 minutos', 'Config base', 'Reclamar rescates', 'Preparar rescates', 'Redactar rescate', 'Armar rescate', '¿Enviar de verdad?'];

/** Lo que un JSON de este flujo no puede tener. Devuelve la lista de hallazgos (vacía si está limpio). */
export function guardias(flujo) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const por = (nombre) => nodos.find((n) => n.name === nombre);
  const p = (n) => (n && n.parameters) || {};
  if (nodos.length > TOPE_DE_NODOS) h.push(`tiene ${nodos.length} nodos y el tope es ${TOPE_DE_NODOS}`);
  // Un solo disparador: el programado, cada 10 minutos.
  const programados = nodos.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  const cronOk = (n) => { const iv = (p(n).rule || {}).interval; return Array.isArray(iv) && iv.length === 1 && iv[0].field === 'cronExpression' && iv[0].expression === '*/10 * * * *'; };
  if (programados.length !== 1) h.push(`tiene ${programados.length} disparadores programados y tiene que tener exactamente uno`);
  else if (!cronOk(programados[0])) h.push('el disparador programado no es `*/10 * * * *`');
  for (const n of nodos) {
    if (n.type === 'n8n-nodes-base.webhook') h.push(`el nodo «${n.name}» es un webhook: este flujo no recibe nada de afuera`);
    else if (n.type === 'n8n-nodes-base.whatsAppTrigger') h.push(`el nodo «${n.name}» es un WhatsApp Trigger (prohibición 7: reescribe el webhook de toda la app)`);
    else if (/Trigger$/.test(n.type) && n.type !== 'n8n-nodes-base.scheduleTrigger') h.push(`el nodo «${n.name}» es un disparador (${n.type}) que no corresponde`);
  }
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) h.push('menciona «subscriptions» o «subscribed_apps» (prohibición 7)');
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    if (!anfitrionPermitido(String(p(n).url || ''))) h.push(`el nodo «${n.name}» llama a un anfitrión fuera de la lista (graph.facebook.com, generativelanguage.googleapis.com, reclamarRescates e ingesta de la consola)`);
  }
  for (const n of nodos) for (const [tipo, c] of Object.entries(n.credentials || {})) {
    if (!c || c.id !== '') h.push(`el nodo «${n.name}» trae la credencial ${tipo} con un id: van POR NOMBRE, con id vacío`);
  }
  // `REEMPLAZAR_` solo en «Config base».
  for (const n of nodos) if (n.name !== 'Config base' && /REEMPLAZAR_[A-Z0-9]/.test(JSON.stringify(n))) h.push(`el nodo «${n.name}» trae un marcador REEMPLAZAR_: solo va en «Config base»`);
  const { nodes: _nodos, ...resto } = flujo || {};
  if (/REEMPLAZAR_[A-Z0-9]/.test(JSON.stringify(resto))) h.push('el flujo trae un marcador REEMPLAZAR_ fuera de «Config base»');
  // «Config base».
  const base = por('Config base');
  const lista = p(base).assignments && p(base).assignments.assignments;
  if (!Array.isArray(lista)) h.push('falta «Config base» con sus asignaciones');
  else {
    const cb = Object.fromEntries(lista.map((a) => [a.name, a.value]));
    if ('modoPrueba' in cb) h.push('«Config base» trae `modoPrueba`: este flujo no tiene modo prueba (la lista de prueba es `listaDePrueba`)');
    if (typeof cb.listaDePrueba !== 'boolean') h.push('«Config base»: `listaDePrueba` tiene que existir y ser booleano');
    if (!libreria().rsTextoFijoValido(cb.rescateTextoFijo)) h.push('«Config base»: `rescateTextoFijo` no es un texto fijo válido');
    if (!libreria().rsSaludoValido(cb.rescateSaludo)) h.push('«Config base»: `rescateSaludo` no es un saludo válido');
  }
  for (const n of nodos) {
    if (typeof p(n).jsCode === 'string' && p(n).jsCode.includes('$getWorkflowStaticData')) h.push(`el nodo «${n.name}» usa los datos estáticos de n8n: la marca única vive en el servidor`);
  }
  // Un fallo del reclamo, de la preparación o del armado tiene que CORTAR la ejecución (se ve en las ejecuciones con error), y el reclamo no se reintenta.
  for (const nombre of ['Reclamar rescates', 'Preparar rescates', 'Armar rescate']) {
    const n = por(nombre);
    if (n && (n.onError !== undefined || n.continueOnFail !== undefined)) h.push(`«${nombre}» no puede llevar «Continue on Fail» ni onError: su fallo tiene que cortar la ejecución`);
    if (n && n.retryOnFail === true) h.push(`«${nombre}» no se reintenta`);
  }
  // Retención y orden.
  const st = (flujo && flujo.settings) || {};
  if (st.executionOrder !== 'v1') h.push('executionOrder tiene que ser «v1»');
  if (st.timezone !== 'America/La_Paz') h.push('timezone tiene que ser «America/La_Paz»');
  if (st.executionTimeout !== 300) h.push('executionTimeout tiene que ser 300');
  if (st.saveDataSuccessExecution !== 'none') h.push('saveDataSuccessExecution tiene que ser «none»');
  if (st.saveDataErrorExecution !== 'none') h.push('saveDataErrorExecution tiene que ser exactamente «none» (sin retención de los textos del cliente en las ejecuciones fallidas)');
  if (st.saveManualExecutions !== false) h.push('saveManualExecutions tiene que ser false');
  if (st.errorWorkflow !== undefined) h.push('no lleva `errorWorkflow`');
  // La puerta de la entrega: nada llega al reporte sin pasar por «¿Meta aceptó?» (lee el id del mensaje).
  const destinosDe = (nombre, salida) => (((((flujo && flujo.connections) || {})[nombre] || {}).main || [])[salida] || []).map((x) => x.node);
  if (!por('¿Meta aceptó?')) h.push('falta «¿Meta aceptó?»: sin ella se reportaría como enviado lo que Meta rechazó');
  else {
    if (destinosDe('¿Falló el envío?', 1).join() !== '¿Meta aceptó?') h.push('«¿Falló el envío?» tiene que enviar su salida «sin fallo» SOLO a «¿Meta aceptó?»');
    if (destinosDe('Enviar respaldo', 0).join() !== '¿Meta aceptó?') h.push('«Enviar respaldo» tiene que colgar SOLO de «¿Meta aceptó?»');
    if (destinosDe('¿Meta aceptó?', 0).join() !== '¿Reportar? (saliente)') h.push('«¿Meta aceptó?» tiene que enviar su salida «sí» a «¿Reportar? (saliente)»');
  }
  // El orden topológico.
  const conex = (flujo && flujo.connections) || {};
  for (let i = 0; i < CADENA.length - 1; i++) {
    const destinos = (((conex[CADENA[i]] || {}).main || [])[0] || []).map((x) => x.node);
    if (!destinos.includes(CADENA[i + 1])) h.push(`«${CADENA[i]}» no está conectado a «${CADENA[i + 1]}»`);
  }
  return h;
}

// ----------------------------------------------------------------- la guardia de publicación
// Como en rroca-ruben: `REEMPLAZAR_*` y `REEMPLAZAR_…` son texto de comentarios, no marcadores.
const sinComentarios = (t) => t.normalize('NFKC').replace(/REEMPLAZAR_(?:\*|…|\.\.\.)/gi, '');
const marcasEn = (v) => (sinComentarios(JSON.stringify(v) || '').match(/reemplazar_[a-z0-9_-]*/gi) || []);

/** Un JSON versionado lleva marcadores a propósito (el repositorio es público); NO se publica con ellos. Los marcadores se nombran, nunca se muestran sus valores. */
export function guardiaDePublicacion({ flujo }) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  if (!nodos.length) h.push('el flujo no trae nodos');
  for (const n of nodos) for (const m of new Set(marcasEn(n))) h.push(`marcador sin sustituir: ${m} (nodo «${n.name}»)`);
  const { nodes: _nodos, ...resto } = flujo || {};
  for (const [campo, valor] of Object.entries(resto)) for (const m of new Set(marcasEn(valor))) h.push(`marcador sin sustituir: ${m} (campo «${campo}»)`);
  return h;
}

// ----------------------------------------------------------------- armar
/** Arma el flujo de UN tenant con los datos ya validados. Devuelve el texto del JSON. */
export function armarRescate(proyecto, datos, v) {
  const donde = v.archivo;
  const plantilla = JSON.parse(JSON.stringify(proyecto.plantilla));
  const urls = { reclamar: RS_URL_RECLAMAR };
  for (const n of plantilla.nodes) {
    n.parameters = JSON.parse(JSON.stringify(n.parameters).replace(/@@url:([a-z]+)@@/g, (_, k) => { if (!urls[k]) throw new Error(`${donde} · ${n.name}: URL desconocida «${k}»`); return urls[k]; }));
    for (const c of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|gemini)$/.exec(String(c.name));
      if (m) c.name = datos.credenciales[m[1]];
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase);
  }
  // La cadena de envío común (no se copia), con las credenciales por NOMBRE. Cuelga de «Armar rescate».
  injertar(plantilla, {
    credenciales: { graph: datos.credenciales.graph, ingesta: datos.credenciales.ingesta },
    ingestaUrl: RS_URL_INGESTA,
    armado: 'Armar rescate',
    config: 'Config base',
    entrada: 'Config base',
    desde: [1440, 300],
  });
  // Puerta de la entrega (propia): lo que sale de «¿Falló el envío?» sin fallo y del respaldo pasa por «¿Meta aceptó?» antes de «¿Reportar? (saliente)». Solo se reencaminan CONEXIONES
  // de la cadena común; sus nodos quedan intactos.
  const falla = plantilla.connections['¿Falló el envío?'];
  const respaldo = plantilla.connections['Enviar respaldo'];
  const unico = (conex, salida, destino) => conex && conex.main && conex.main[salida] && conex.main[salida].length === 1 && conex.main[salida][0].node === destino;
  if (!unico(falla, 1, '¿Reportar? (saliente)') || !unico(respaldo, 0, '¿Reportar? (saliente)')) throw new Error(`${donde}: la cadena común cambió: «¿Falló el envío?» o «Enviar respaldo» ya no cuelgan de «¿Reportar? (saliente)»`);
  falla.main[1] = [{ node: '¿Meta aceptó?', type: 'main', index: 0 }];
  respaldo.main[0] = [{ node: '¿Meta aceptó?', type: 'main', index: 0 }];
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: v.archivo, nombre: datos.nombreFlujo, quitar: [] });
  const flujo = JSON.parse(texto);
  if (texto.includes('"@@')) throw new Error(`${donde}: quedó una marca @@ sin reemplazar`);
  return JSON.stringify(flujo, null, 2) + '\n';
}

export const archivoDe = (tenant) => `rescate-22h.${tenant}.json`;

/**
 * Arma (o verifica) el flujo de un tenant. Devuelve { archivo, nodos, existia, alDia, versionado, texto }.
 *   opciones: { tenant, carpeta, datos (ruta), verificar, tope }   (`carpeta` y `tope` son para las pruebas)
 * Lanza ante un dato inválido o una guardia violada en lo armado.
 */
export function construir({ tenant, carpeta = AQUI, datos: rutaDatos, verificar = false, tope } = {}) {
  const d = cargarDatos(tenant, rutaDatos);
  const archivo = archivoDe(tenant);
  const proyecto = leerProyecto(carpeta, { ...CONFIG, variantes: [{ archivo, nombre: d.nombreFlujo }] }, tope ? { tope } : {});
  const texto = armarRescate(proyecto, d, proyecto.variantes[0]);
  const propios = guardias(JSON.parse(texto));
  if (propios.length) throw new Error(`${archivo}: ${propios.join('; ')}`);
  const ruta = join(carpeta, archivo);
  const actual = leerSiExiste(ruta, archivo);
  let versionado = [];
  if (actual !== null) {
    try { versionado = guardias(JSON.parse(actual)); } catch (x) { versionado = ['no es un JSON válido']; }
  }
  if (!verificar) escribirSinSeguirEnlaces(ruta, texto, archivo);
  return { archivo, nodos: JSON.parse(texto).nodes.length, existia: actual !== null, alDia: actual === texto, versionado, texto };
}

/** Los tenants con archivo de datos de rescate. */
export function tenantsConRescate(carpetaDeDatos = CARPETA_DE_DATOS) {
  const ids = [];
  for (const e of readdirSync(carpetaDeDatos, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (leerSiExiste(join(carpetaDeDatos, e.name, 'rescate-22h.json'), 'rescate-22h.json') !== null) ids.push(e.name);
  }
  return ids.sort();
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const uso = () => { console.error('✗ uso: construir.mjs (--tenant <id> | --todos) [--verificar]   |   construir.mjs --publicable (--tenant <id> | --flujo <json>)'); process.exit(2); };
  const valorDe = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const conValor = new Set(['--tenant', '--flujo']);
  const libres = new Set(['--todos', '--verificar', '--publicable']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (conValor.has(a)) { if (!args[i + 1] || args[i + 1].startsWith('--')) uso(); i++; } else if (!libres.has(a)) { console.error(`✗ argumento desconocido: ${String(a).slice(0, 60)}`); uso(); }
  }
  const tenant = valorDe('--tenant');
  try {
    if (args.includes('--publicable')) {
      if (args.includes('--verificar') || args.includes('--todos') || (!tenant && !valorDe('--flujo'))) uso();
      const rutaFlujo = valorDe('--flujo') || join(AQUI, archivoDe(tenant));
      const textoFlujo = leerSiExiste(rutaFlujo, 'el flujo');
      if (textoFlujo === null) throw new Error(`no existe el flujo ${rutaFlujo}`);
      let flujoJson;
      try { flujoJson = JSON.parse(textoFlujo); } catch { throw new Error(`JSON inválido en ${rutaFlujo}`); }
      const hallazgos = guardiaDePublicacion({ flujo: flujoJson });
      if (hallazgos.length) {
        console.error('✗ El flujo de rescate NO se puede publicar todavía:');
        for (const x of hallazgos) console.error(`  - ${x}`);
        process.exit(1);
      }
      console.log('✓ Sin marcadores REEMPLAZAR_* : se puede publicar (con la confirmación de publicar-flujo.sh).');
      process.exit(0);
    }
    if (!tenant === !args.includes('--todos')) uso();
    const verificar = args.includes('--verificar');
    const ids = tenant ? [tenant] : tenantsConRescate();
    if (!ids.length) console.log('(ningún tenant tiene admin/scripts/datos/<id>/rescate-22h.json)');
    let difiere = false;
    for (const id of ids) {
      const r = construir({ tenant: id, verificar });
      if (!verificar) { console.log(`✓ ${r.archivo} escrito (${r.nodos} nodos)`); continue; }
      if (r.versionado.length) { difiere = true; console.error(`✗ ${r.archivo} ${r.versionado.join('; ')}`); }
      else if (!r.alDia) { difiere = true; console.error(`✗ ${r.archivo} ${r.existia ? 'difiere de lo que arma la plantilla' : 'no existe'}: corra «node construir.mjs --tenant ${id}»`); }
      else console.log(`✓ ${r.archivo} al día (${r.nodos} nodos)`);
    }
    process.exit(difiere ? 1 : 0);
  } catch (e) {
    console.error(e instanceof SyntaxError ? '✗ JSON inválido' : `✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
