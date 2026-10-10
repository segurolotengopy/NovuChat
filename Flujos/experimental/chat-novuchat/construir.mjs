#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de «Chat NovuChat v2 (Kenji)» desde la plantilla y los datos propios
 * =============================================================================
 *
 *   node construir.mjs               escribe chat-novuchat.novuchat.json y chat-novuchat.prueba.json
 *   node construir.mjs --verificar   no escribe: sale 1 si un JSON versionado difiere de lo que se arma, si viola una guardia o si hay un JSON sin archivo de datos (huérfano)
 *   (NUNCA con --help ni --ayuda: cualquier argumento que no sea --verificar escribe los JSON)
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos. Este archivo NO arma el código de los nodos: lo hace el armador genérico
 * `../comun-sin-agente/construir.mjs` (importado), con el config de `CONFIG_BASE` (librería `src/lib/chat.js`, comunes `src/nodos/_comun.js` y los paquetes `mensajes` y `filtro`,
 * en una marca como `"jsCode": "@@todo+mensajes+filtro:nodos/armar-mensajes.js"`). Lo propio de este archivo:
 *
 *   - `@@dato:a.b.c@@` (en cualquier texto de la plantilla) por ese dato; `@@cred:trigger|ingesta|graph|planilla|entradaPrueba` (nombre de credencial) por el del archivo de datos;
 *   - «Config base» se llena con `configBase` (texto, número o booleano);
 *   - LA INYECCIÓN: la línea `const CH_DATOS = null; // @@datos` (en «Config del negocio») se reemplaza por `datos.datos` (las instrucciones del documento comercial, los rubros, los cierres
 *     exactos, los respaldos, los textos fijos y el modelo) como literal JS. Tiene que aparecer EXACTAMENTE una vez en todo el flujo;
 *   - las VALIDACIONES de los datos (cada error nombra el campo) y las GUARDIAS de lo armado.
 *
 * LOS DATOS son `admin/scripts/datos/chat-novuchat/<archivo>.json` (zona Tenants: solo marcadores `REEMPLAZAR_*` para los identificadores, nunca un token, un teléfono, una ruta de webhook ni
 * un id de planilla reales). UNA SALIDA POR ARCHIVO: `novuchat.json` → `chat-novuchat.novuchat.json` (con «WhatsApp Trigger»); `ensayo.json` → `chat-novuchat.prueba.json` (con «Entrada de
 * prueba», sin «WhatsApp Trigger»: activar un disparador de WhatsApp en n8n registra el webhook en Meta y se lo quita al flujo vivo).
 *
 * Node sin dependencias. No lee ningún .env ni llama a la red.
 */
import { closeSync, constants, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
// LA CADENA DE ENVÍO ES COMÚN (no se copia): se injerta desde `comun-sin-agente/src/envio.mjs` (enviar, respaldo en texto, reporte saliente).
import { injertar } from '../comun-sin-agente/src/envio.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const DATOS = join(AQUI, '../../../admin/scripts/datos/chat-novuchat');

/** El config del armador genérico, sin las variantes (esas salen de los archivos de datos). */
export const CONFIG_BASE = {
  plantilla: 'flujo.plantilla.json',
  raiz: '../..',
  librerias: ['src/lib/chat.js'],
  comun: ['src/nodos/_comun.js'],
  paquetes: {
    mensajes: ['../comun-sin-agente/src/mensajes.js'],
    filtro: ['../comun-sin-agente/src/filtro-redaccion.js'],
  },
};

export const MARCA_DATOS = 'const CH_DATOS = null; // @@datos';
const NODO_TRIGGER = 'WhatsApp Trigger';
const NODO_PRUEBA = 'Entrada de prueba';

// ----------------------------------------------------------------- lectura y escritura sin seguir enlaces
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
const esEnsayo = (archivo) => /^ensayo[\w-]*\.json$/.test(archivo);
/** `novuchat.json` → `chat-novuchat.novuchat.json`; `ensayo.json` → `chat-novuchat.prueba.json`. */
export const salidaDe = (archivo) => (archivo === 'ensayo.json' ? 'chat-novuchat.prueba.json' : `chat-novuchat.${archivo.replace(/\.json$/, '')}.json`);
export const archivosDeDatos = (dir = DATOS) => readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

/** Lee un archivo de datos y resuelve `hereda` (un nombre de archivo, nunca una ruta; sin vueltas). */
export function cargarDatos(archivo, dir = DATOS, pila = []) {
  if (pila.includes(archivo)) throw new Error(`${archivo}: «hereda» da una vuelta`);
  const texto = leerSiExiste(join(dir, archivo), archivo);
  if (texto === null) throw new Error(`${archivo}: no existe en ${dir}`);
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error(`${archivo}: no es un JSON válido`); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${archivo}: tiene que ser un objeto`);
  if (d.hereda === undefined) return d;
  if (typeof d.hereda !== 'string' || !/^[a-z0-9-]+$/.test(d.hereda)) throw new Error(`${archivo}: «hereda» no es un nombre válido (solo a-z, 0-9 y guion)`);
  if (!resolve(dir, `${d.hereda}.json`).startsWith(resolve(dir) + sep)) throw new Error(`${archivo}: «hereda» sale de la carpeta de datos`);
  const base = cargarDatos(`${d.hereda}.json`, dir, [...pila, archivo]);
  const { hereda, ...propio } = d;
  return {
    ...base, ...propio,
    credenciales: { ...base.credenciales, ...(propio.credenciales || {}) },
    configBase: { ...base.configBase, ...(propio.configBase || {}) },
  };
}

// ----------------------------------------------------------------- las expresiones de la librería (UNA fuente: `src/lib/chat.js`)
const FUENTE = leerSiExiste(join(AQUI, 'src/lib/chat.js'), 'src/lib/chat.js') || '';
function regexDeLaLibreria(nombre) {
  const m = new RegExp(`^const ${nombre} = \\/(.+)\\/([a-z]*);`, 'm').exec(FUENTE);
  if (!m) throw new Error(`src/lib/chat.js: no se encontró la línea «const ${nombre} = /…/;»`);
  return new RegExp(m[1], m[2]);
}
const PROMESA = regexDeLaLibreria('CH_PROMESA_DEL_MODELO');
const OFERTA = regexDeLaLibreria('CH_OFERTA_DEL_MODELO');
const YO = regexDeLaLibreria('CH_YO_DEL_MODELO');
const ENLACE = regexDeLaLibreria('CH_ENLACE');
const ACREDITA_MODELO = regexDeLaLibreria('CH_ACREDITA_MODELO');
const SISTEMA_CONOCIDO = regexDeLaLibreria('CH_SISTEMA_CONOCIDO');
const CIFRA_DE_CONSUMO = regexDeLaLibreria('CH_CIFRA_DE_CONSUMO');
const BLOQUEO_COMUN = regexDeLaLibreria('CH_BLOQUEO_COMUN');
const NOMBRE_DE_PERSONA = regexDeLaLibreria('CH_NOMBRE_DE_PERSONA');
export const PRECIO = regexDeLaLibreria('CH_PRECIO');
// Contexto aislado (node:vm), sin los globales de Node: igual que el Code de n8n.
const LIB = runInNewContext(`${FUENTE}\n({ chSistemaAjeno, chContar, chNorm, chSinNombrar })`, {});
const CONTROLES = /[\u0000-\u001f\u007f\u2028\u2029]/;
const INVISIBLES = /[\u0080-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
// Lo que NINGÚN texto que ve el cliente puede decir (decisión de Andres, 09/10/2026): que alguien «se comunique», «contacte» o «llame», ni una llamada o una hora.
const CONTACTO_PROHIBIDO = /\b(?:se )?comuniqu(?:e|en|a|an|ara|aran|amos)\b|\bcontact(?:e|en|a|ara|aran|amos|ar[eé]|arte|arlo|arla)\b|\bllam(?:ada|adas|ar|are|aremos|amos|ara|aran|en|ame|enme)\b|\bte escrib(?:e|ir[aá]|iremos|iran)\b/;

// ----------------------------------------------------------------- validaciones (cada error nombra el campo)
const o = (re) => new RegExp(`^(${re.source}|REEMPLAZAR_[A-Z0-9_]+)$`);
const FORMAS_CONFIG = {
  waGraphVersion: /^v\d{1,2}\.\d{1,2}$/,
  phoneNumberIdEsperado: o(/\d{6,25}/),
  numeroRecepcion: o(/\d{6,20}/),
  plantillaAviso: /^[a-z0-9_]{1,64}$/,
  idiomaPlantillaAviso: /^[a-z]{2}(_[A-Z]{2})?$/,
  // Vacío solo para el ensayo (S7): sin planilla, la prueba no puede escribir en la de nadie.
  planillaProspectosId: o(/[A-Za-z0-9_-]{25,100}|/),
  prefijosPermitidos: /^\d{1,4}(,\d{1,4})*$/,
  nivelEmojis: /^(ninguno|pocos|muchos)$/,
  telefonosDePrueba: o(/\d{6,20}(,\d{6,20})*/),
};
const CAMPOS_CONFIG = ['waGraphVersion', 'phoneNumberIdEsperado', 'numeroRecepcion', 'nombreNegocio', 'plantillaAviso', 'idiomaPlantillaAviso', 'planillaProspectosId',
  'planillaProspectosHoja', 'prefijosPermitidos', 'nivelEmojis', 'mensajeComercioSuspendido'];
const CREDENCIALES = ['trigger', 'ingesta', 'graph', 'planilla'];
const ID_RUBRO = /^[a-z0-9_-]{1,40}$/;
const CIERRE_RUBRO_EXACTO = '¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝';
const CIERRE_PRECIOS_EXACTO = '¿Te gustaría hablar con alguien de nuestro equipo para evaluar juntos qué plan es el ideal para empezar? 🤝';
const MARCADORES = ['asistente', 'negocio', 'cierreRubro', 'cierrePrecios', 'cierreEquipo'];
const CLAVES_INSTRUCCIONES = ['rol', 'tono', 'rubros', 'cierreRubro', 'otros', 'precios', 'limites', 'restricciones', 'ambiguedad', 'abierta', 'salida', 'seguridad'];
const CLAVES_CIERRES = ['rubro', 'precios', 'equipo', 'consumo', 'banco', 'costoMeta', 'integracion', 'descuento'];
const CLAVES_RESPUESTAS = ['consumo', 'banco', 'costoMeta', 'integracion', 'descuento'];
const CLAVES_RESPALDOS = ['multiple', 'otroElegido', 'otroLibre', 'fuera', 'equipo', 'generico', 'identidad', 'cortesia', 'datosAmbos', 'datosSoloNombre', 'datosSoloEmpresa', 'datosNinguno', 'empresa', 'complemento', 'noDocumentado'];
const CLAVES_TEXTOS = ['saludo', 'listaBoton', 'listaTitulo', 'planesIntro', 'planesIntroRepite', 'planesIntroTopes', 'planesSinPrecios', 'traspasoConPregunta', 'traspasoSinPregunta',
  'traspasoRepite', 'traspasoSinRecepcion', 'recepcion', 'botonTraspaso', 'saludoWa', 'estadoAviso', 'falla', 'medioIlegible', 'invitaOtroRubro', 'planesAgotado'];
const DESCARTES = ['numero_equivocado', 'vende_o_busca_trabajo', 'sin_negocio', 'spam_o_prueba'];

/** Lo que un texto que VE EL CLIENTE no puede tener. Devuelve el motivo o ''. `libre`: textos que sí pueden tener cifras o una pregunta (los valida el llamador). */
function errorDeTextoDelCliente(v, opc = {}) {
  if (typeof v !== 'string' || v.trim() === '') return 'tiene que ser un texto no vacío';
  if (INVISIBLES.test(v)) return 'trae un carácter invisible o de control';
  if (/\{\{|<|>|REEMPLAZAR_|@@/.test(v)) return 'trae «{{», «<», «>», «@@» o un marcador REEMPLAZAR_';
  if (ENLACE.test(v)) return 'trae un enlace o un dominio';
  const n = LIB.chSinNombrar(LIB.chNorm(v));
  if (CONTACTO_PROHIBIDO.test(n)) return 'promete o menciona que alguien se comunica, contacta o llama: siempre «hablar con alguien de nuestro equipo» con el botón';
  if (PROMESA.test(n)) return 'promete que alguien llamará, escribirá o responderá («solo se ofrece lo que se cumple»)';
  if (NOMBRE_DE_PERSONA.test(n)) return 'nombra a una persona del equipo: se dice «alguien de nuestro equipo»';
  if (OFERTA.test(n) || /%|\bgratis\b|\bdescuento/.test(n)) return 'trae una oferta, un regalo, una rebaja, un descuento o un porcentaje';
  // El complemento de los planes (R6) trae a propósito la moneda, los tamaños de agendas y de catálogo y las categorías «ERP, CRM»: se revisa aparte.
  if (opc.complemento === true) {
    if (/\d+\s+(?:conversaciones?|mensajes?|interacciones?|respuestas?|chats?)\b|\bilimitad|\bsin (?:ningun )?(?:limite|tope)|\bgratis\b|\bgratuit/.test(n)) return 'trae una cifra de consumo, «ilimitado», «sin límite» o una gratuidad (§5)';
    return '';
  }
  if (BLOQUEO_COMUN.test(n)) return 'trae una gratuidad, una garantía, que no hay límites, una moneda o la minimización de un costo';
  if (CIFRA_DE_CONSUMO.test(n)) return 'trae una cifra de consumo o de capacidad: los topes los muestra la imagen de planes';
  if (opc.sinAcredita !== true && ACREDITA_MODELO.test(n)) return 'afirma que el servicio valida, verifica o acredita pagos o que consulta al banco';
  if (SISTEMA_CONOCIDO.test(n) || LIB.chSistemaAjeno(v, ['NovuChat', 'Kenji', 'Impulso', 'Crecimiento', 'Pro', 'Setups', 'Setup'], false)) return 'nombra un sistema, plataforma, banco o pasarela que el servicio no nombra';
  if (/\d/.test(v.replace(/\b24\s*\/\s*7\b|\b24\s+horas\b/gi, ' '))) return 'trae un número (solo «24/7» y «24 horas»): las cifras de precios las pone el código desde la consola';
  if (opc.permitirPreguntas === false && /[?¿]/.test(v)) return 'no lleva «?» ni «¿»: el código agrega la pregunta';
  return '';
}
/** Lo que una instrucción para el MODELO no puede tener (puede decir «nunca prometas…», pero no una frase prohibida como si fuera suya). */
function errorDeInstruccion(v) {
  if (typeof v !== 'string' || v.trim() === '') return 'tiene que ser un texto no vacío';
  if (v.length > 3500) return 'pasa de 3.500 caracteres';
  if (INVISIBLES.test(v) || CONTROLES.test(v.replace(/\n/g, ''))) return 'trae un carácter invisible o de control';
  if (/REEMPLAZAR_|@@/.test(v)) return 'trae «@@» o un marcador REEMPLAZAR_';
  if (NOMBRE_DE_PERSONA.test(LIB.chNorm(v))) return 'nombra a una persona del equipo';
  if (/\bse comunique\b|\bte contacte\b|\bcontacte contigo\b/i.test(v)) return 'dice que alguien «se comunique» o «te contacte»: siempre «hablar con alguien de nuestro equipo»';
  if (/(?:sk-|AIza|ya29\.|EAA[A-Za-z0-9]{10,}|Bearer\s)/.test(v)) return 'parece traer una clave o un token';
  for (const m of v.matchAll(/\{([A-Za-z]+)\}/g)) if (!MARCADORES.includes(m[1])) return `trae un marcador {${m[1]}} desconocido (solo ${MARCADORES.join(', ')})`;
  return '';
}

/** Valida los datos YA mezclados con lo que hereda. Lanza un error que nombra cada campo malo. */
export function validarDatos(datos, archivo) {
  const errores = [];
  const e = (campo, msg) => errores.push(`«${campo}» ${msg}`);
  const d = datos && typeof datos === 'object' ? datos : {};

  // --- el flujo y la entrada
  if (typeof d.nombreFlujo !== 'string' || !d.nombreFlujo.trim() || d.nombreFlujo.length > 120 || CONTROLES.test(d.nombreFlujo)) e('nombreFlujo', 'tiene que ser un texto de una línea, de 1 a 120 caracteres');
  if (!['trigger', 'prueba'].includes(d.entrada)) e('entrada', 'tiene que ser «trigger» o «prueba»');
  else if (d.entrada === 'prueba' && !esEnsayo(archivo)) e('entrada', '«prueba» solo puede estar en ensayo*.json: los demás archivos de datos usan «trigger»');
  if (typeof d.pruebaRuta !== 'string' || !/^[A-Za-z0-9_/-]+$/.test(d.pruebaRuta)) e('pruebaRuta', 'no tiene la forma esperada /^[A-Za-z0-9_/-]+$/');

  // --- credenciales: nombres, nunca valores
  const cred = d.credenciales && typeof d.credenciales === 'object' ? d.credenciales : {};
  for (const k of d.entrada === 'prueba' ? [...CREDENCIALES, 'entradaPrueba'] : CREDENCIALES) if (cred[k] === undefined) e(`credenciales.${k}`, 'falta');
  for (const [k, v] of Object.entries(cred)) {
    if (typeof v !== 'string' || !v || v.length > 100 || v.startsWith('=') || /["\\]|\{\{/.test(v) || CONTROLES.test(v)) e(`credenciales.${k}`, 'no es un nombre de credencial válido');
    else if (k === 'trigger' && /aab1|wa-prod/i.test(v)) e('credenciales.trigger', 'es una credencial de AAB1-WA-Prod: un WhatsApp Trigger con ella reescribe el webhook de toda la app (prohibición 7)');
  }

  // --- configBase
  const cb = d.configBase && typeof d.configBase === 'object' ? d.configBase : null;
  if (!cb) e('configBase', 'falta');
  else {
    for (const k of CAMPOS_CONFIG) if (cb[k] === undefined) e(`configBase.${k}`, 'falta');
    for (const [k, v] of Object.entries(cb)) {
      if (!['string', 'number', 'boolean'].includes(typeof v)) { e(`configBase.${k}`, 'solo puede ser texto, número o booleano'); continue; }
      if (typeof v === 'string') {
        if (v.startsWith('=')) e(`configBase.${k}`, 'empieza con «=» (n8n lo evaluaría como expresión)');
        if (/["\\{}]/.test(v)) e(`configBase.${k}`, 'trae una comilla doble, una barra invertida o una llave');
        if (CONTROLES.test(v)) e(`configBase.${k}`, 'trae un salto de línea o un carácter de control');
      }
      const forma = FORMAS_CONFIG[k];
      if (forma && (typeof v !== 'string' || !forma.test(v))) e(`configBase.${k}`, `no tiene la forma esperada ${forma}`);
    }
    if (typeof cb.nombreNegocio === 'string' && (cb.nombreNegocio.trim() === '' || cb.nombreNegocio.length > 60)) e('configBase.nombreNegocio', 'tiene que tener de 1 a 60 caracteres');
    if (typeof cb.planillaProspectosHoja === 'string' && (cb.planillaProspectosHoja.trim() === '' || cb.planillaProspectosHoja.length > 100)) e('configBase.planillaProspectosHoja', 'tiene que tener de 1 a 100 caracteres (o el marcador)');
    if (typeof cb.mensajeComercioSuspendido === 'string' && (cb.mensajeComercioSuspendido.trim() === '' || cb.mensajeComercioSuspendido.length > 300)) e('configBase.mensajeComercioSuspendido', 'tiene que tener de 1 a 300 caracteres');
  }

  // --- los datos propios del chat
  const k = d.datos && typeof d.datos === 'object' && !Array.isArray(d.datos) ? d.datos : null;
  if (!k) { e('datos', 'falta'); if (errores.length) throw new Error(`${archivo}: datos no válidos: ${errores.join('; ')}`); return; }
  if (typeof k.modelo !== 'string' || !/^gemini-[a-z0-9][a-z0-9.-]{1,38}$/.test(k.modelo)) e('datos.modelo', 'tiene que ser un id de modelo de Gemini (gemini-…), solo minúsculas, números, puntos y guiones');
  if (typeof k.asistente !== 'string' || !/^\p{L}{2,30}$/u.test(k.asistente)) e('datos.asistente', 'tiene que ser un nombre de 2 a 30 letras');

  const ins = k.instrucciones && typeof k.instrucciones === 'object' ? k.instrucciones : null;
  if (!ins) e('datos.instrucciones', 'falta');
  else {
    for (const c of CLAVES_INSTRUCCIONES) { const m = errorDeInstruccion(ins[c]); if (m) e(`datos.instrucciones.${c}`, m); }
    for (const c of Object.keys(ins)) if (!CLAVES_INSTRUCCIONES.includes(c) && c !== 'escenarios') e(`datos.instrucciones.${c}`, 'no es un campo conocido');
    if (!Array.isArray(ins.escenarios) || ins.escenarios.length < 1 || ins.escenarios.length > 6) e('datos.instrucciones.escenarios', 'tiene que ser una lista de 1 a 6 escenarios');
    else ins.escenarios.forEach((x, i) => {
      for (const c of ['titulo', 'cliente', 'kenji']) { const m = errorDeInstruccion(x && x[c]); if (m) e(`datos.instrucciones.escenarios[${i}].${c}`, m); }
      const m2 = errorDeTextoDelCliente(x && x.kenji, { sinAcredita: true });
      if (m2) e(`datos.instrucciones.escenarios[${i}].kenji`, m2);
    });
  }

  // --- los cierres exactos del documento comercial
  const ci = k.cierres && typeof k.cierres === 'object' ? k.cierres : null;
  if (!ci) e('datos.cierres', 'falta');
  else {
    for (const c of CLAVES_CIERRES) {
      const v = ci[c];
      const m = errorDeTextoDelCliente(v, { sinAcredita: c === 'banco' });
      if (m) e(`datos.cierres.${c}`, m);
      else if ((v.match(/\?/g) || []).length !== 1 || !/\?\s*\p{Extended_Pictographic}?\uFE0F?\s*$/u.test(v)) e(`datos.cierres.${c}`, 'tiene que ser UNA pregunta y terminar con ella (y su emoji)');
    }
    if (ci.rubro !== CIERRE_RUBRO_EXACTO) e('datos.cierres.rubro', `tiene que ser EXACTAMENTE la pregunta del documento comercial: «${CIERRE_RUBRO_EXACTO}»`);
    if (ci.precios !== CIERRE_PRECIOS_EXACTO) e('datos.cierres.precios', `tiene que ser EXACTAMENTE el cierre de precios de la decisión D2: «${CIERRE_PRECIOS_EXACTO}»`);
  }

  // --- los rubros de la lista (propios: NO se leen de la consola)
  const rubros = Array.isArray(k.rubros) ? k.rubros : null;
  if (!rubros) e('datos.rubros', 'falta o no es una lista');
  else {
    if (rubros.length < 2 || rubros.length > 10) e('datos.rubros', `tiene ${rubros.length} rubros (de 2 a 10: la lista de WhatsApp admite 10 filas)`);
    if (!rubros.some((r) => r && r.id === 'otro')) e('datos.rubros', 'tiene que incluir «otro» (la salida abierta de la lista)');
    else if (rubros[rubros.length - 1].id !== 'otro') e('datos.rubros', '«otro» tiene que ir al final de la lista');
    const ids = new Set();
    rubros.forEach((r, i) => {
      const ruta = `datos.rubros[${i}]`;
      if (!r || typeof r !== 'object' || Array.isArray(r)) { e(ruta, 'tiene que ser un objeto'); return; }
      if (typeof r.id !== 'string' || !ID_RUBRO.test(r.id) || /^(__proto__|constructor|prototype)$/.test(r.id)) { e(`${ruta}.id`, 'no cumple /^[a-z0-9_-]{1,40}$/ ni evita el prototipo'); return; }
      if (ids.has(r.id)) e(`${ruta}.id`, `«${r.id}» está repetido`);
      ids.add(r.id);
      if (typeof r.nombre !== 'string' || r.nombre.length < 2 || r.nombre.length > 60) e(`${ruta}.nombre`, 'tiene que ser un texto de 2 a 60 caracteres');
      if (typeof r.titulo !== 'string' || r.titulo.length < 2 || r.titulo.length > 24) e(`${ruta}.titulo`, 'tiene que ser un texto de 2 a 24 caracteres (título de una fila de lista de WhatsApp)');
      if (typeof r.descripcion !== 'string' || r.descripcion.length < 3 || r.descripcion.length > 72) e(`${ruta}.descripcion`, 'tiene que ser un texto de 3 a 72 caracteres (TODA fila lleva descripción)');
      if (typeof r.flujo !== 'string' || !/^[a-z_]{3,30}$/.test(r.flujo)) e(`${ruta}.flujo`, 'tiene que ser un texto en minúsculas (agendamiento, venta, captacion, a_medida)');
      for (const c of ['nombre', 'titulo', 'descripcion']) { const m = errorDeTextoDelCliente(r[c], { sinAcredita: true }); if (typeof r[c] === 'string' && m) e(`${ruta}.${c}`, m); }
      if (!Array.isArray(r.puntosClave)) { e(`${ruta}.puntosClave`, 'tiene que ser una lista'); return; }
      if (r.id === 'otro') {
        if (r.puntosClave.length || r.explicacion !== '') e(ruta, '«otro» no lleva puntos clave ni explicación fija: sigue la regla de «Otros rubros»');
        return;
      }
      if (r.puntosClave.length < 2 || r.puntosClave.length > 8) e(`${ruta}.puntosClave`, 'tiene que ser una lista de 2 a 8 puntos');
      const m = errorDeTextoDelCliente(r.explicacion, { permitirPreguntas: false });
      if (m) e(`${ruta}.explicacion`, m);
      else {
        const c = LIB.chContar(r.explicacion);
        if (c.palabras < 25 || c.palabras > 90) e(`${ruta}.explicacion`, `tiene ${c.palabras} palabras (de 25 a 90)`);
        if (r.explicacion.length + 1 + CIERRE_RUBRO_EXACTO.length > 1000) e(`${ruta}.explicacion`, 'con la pregunta de cierre pasa de 1.000 caracteres');
      }
      r.puntosClave.forEach((p, j) => {
        const donde = `${ruta}.puntosClave[${j}]`;
        if (!p || typeof p !== 'object' || typeof p.texto !== 'string' || p.texto.length < 3 || p.texto.length > 160) { e(donde, 'tiene que ser un objeto { texto, palabras } con un texto de 3 a 160 caracteres'); return; }
        for (const c of Object.keys(p)) if (!['texto', 'palabras'].includes(c)) e(donde, `no tiene el campo «${c}»`);
        const t = errorDeInstruccion(p.texto);
        if (t) { e(`${donde}.texto`, t); return; }
        if (typeof p.palabras !== 'string' || p.palabras.length < 2 || p.palabras.length > 240 || !/^[a-z0-9 |()?.*]+$/.test(p.palabras)) { e(`${donde}.palabras`, 'tiene que ser una familia de palabras (minúsculas sin tildes, números, espacios y | ( ) ? . *) de hasta 240 caracteres'); return; }
        // Sin cuantificadores anidados (ReDoS): una familia de palabras no puede ser una expresión que se cuelgue.
        if (/\)[*+]|[*+]\)[*+]/.test(p.palabras) || (p.palabras.match(/\.\*/g) || []).length > 2 || /(?<!\.)\*/.test(p.palabras) || /(?<!\))\?/.test(p.palabras) || (p.palabras.match(/[*?]/g) || []).length > 4) { e(`${donde}.palabras`, 'trae cuantificadores anidados o demasiados: una familia de palabras no puede ser una expresión que se cuelgue (ReDoS)'); return; }
        let re = null;
        try { re = new RegExp(p.palabras); } catch (x) { e(`${donde}.palabras`, 'no compila como expresión regular'); return; }
        if (typeof r.explicacion === 'string' && !re.test(LIB.chNorm(r.explicacion))) e(`${donde}.palabras`, `la explicación fija del rubro no la cubre («${p.texto}»): el respaldo tiene que decir todos sus puntos clave`);
      });
    });
  }

  // --- los precios (frases; las cifras las pone el código desde la consola) y las respuestas fijas
  const p = k.precios && typeof k.precios === 'object' ? k.precios : null;
  if (!p) e('datos.precios', 'falta');
  else {
    for (const c of Object.keys(p)) if (!['estandar', 'detalleEstandar', 'aMedida', 'mensual', 'incluye'].includes(c)) e(`datos.precios.${c}`, 'no es un campo (estandar, detalleEstandar, aMedida, mensual, incluye)');
    for (const [c, max] of [['estandar', 40], ['detalleEstandar', 120], ['aMedida', 40], ['mensual', 40], ['incluye', 300]]) {
      const v = p[c];
      if (typeof v !== 'string' || v.length < 1 || v.length > max) { e(`datos.precios.${c}`, `tiene que ser un texto de 1 a ${max} caracteres`); continue; }
      const m = errorDeTextoDelCliente(v, { permitirPreguntas: false });
      if (m) e(`datos.precios.${c}`, m);
    }
  }
  const rs = k.respuestas && typeof k.respuestas === 'object' ? k.respuestas : null;
  if (!rs) e('datos.respuestas', 'falta');
  else for (const c of CLAVES_RESPUESTAS) {
    const v = rs[c];
    const m = errorDeTextoDelCliente(v, { permitirPreguntas: false, sinAcredita: c === 'banco' });
    if (m) e(`datos.respuestas.${c}`, m);
    else if (c === 'banco' && !(/\bno (?:lo |la |los |las )?(?:valida|verifica|confirma|comprueba|acredita)\w*/.test(LIB.chNorm(v)) && /\bbanco\b/.test(LIB.chNorm(v)))) e('datos.respuestas.banco', 'tiene que decir en forma NEGADA, con el «no» pegado al verbo, que no se valida con el banco («no lo valida con el banco»): es la prohibición 3');
  }

  // --- los textos de respaldo y los fijos
  const rp = k.respaldos && typeof k.respaldos === 'object' ? k.respaldos : null;
  if (!rp) e('datos.respaldos', 'falta');
  else {
    for (const c of CLAVES_RESPALDOS) { const m = errorDeTextoDelCliente(chSust(rp[c]), { sinAcredita: c.startsWith('datos') }); if (m) e(`datos.respaldos.${c}`, m); }
    const ab = rp.abierta && typeof rp.abierta === 'object' ? rp.abierta : null;
    if (!ab) e('datos.respaldos.abierta', 'falta');
    else {
      for (const c of ['pitch', 'cierreSinRubro', 'cierreConRubro']) { const m = errorDeTextoDelCliente(chSust(ab[c])); if (m) e(`datos.respaldos.abierta.${c}`, m); }
      if (typeof ab.pitch === 'string') {
        if (!/el primer empleado de tu negocio que nunca duerme/i.test(ab.pitch)) e('datos.respaldos.abierta.pitch', 'tiene que decir «el primer empleado de tu negocio que nunca duerme»');
        if (ab.pitch.split('\n').filter((l) => /^\s*(?:[-•*▪]|\p{Extended_Pictographic})/u.test(l)).length < 4) e('datos.respaldos.abierta.pitch', 'tiene que traer las 4 viñetas del documento (una por línea, cada una con su emoji)');
        if (/menos de un minuto/i.test(ab.pitch)) e('datos.respaldos.abierta.pitch', 'no puede afirmar «menos de un minuto»: se dice «en segundos, las 24 horas»');
      }
      for (const c of ['cierreSinRubro', 'cierreConRubro']) if (typeof ab[c] === 'string' && !/\?\s*$/.test(ab[c])) e(`datos.respaldos.abierta.${c}`, 'tiene que terminar con una pregunta');
    }
    const ds = rp.descartes && typeof rp.descartes === 'object' ? rp.descartes : null;
    if (!ds) e('datos.respaldos.descartes', 'falta');
    else for (const c of DESCARTES) { const m = errorDeTextoDelCliente(chSust(ds[c])); if (m) e(`datos.respaldos.descartes.${c}`, m); }
  }
  const tx = k.textos && typeof k.textos === 'object' ? k.textos : null;
  if (!tx) e('datos.textos', 'falta');
  else {
    for (const c of CLAVES_TEXTOS) { const m = errorDeTextoDelCliente(chSust(tx[c]), { sinAcredita: true }); if (m) e(`datos.textos.${c}`, m); }
    if (typeof tx.listaBoton === 'string' && tx.listaBoton.length > 20) e('datos.textos.listaBoton', 'pasa de 20 caracteres (el botón de una lista)');
    if (typeof tx.listaTitulo === 'string' && tx.listaTitulo.length > 24) e('datos.textos.listaTitulo', 'pasa de 24 caracteres');
    if (typeof tx.botonTraspaso === 'string' && tx.botonTraspaso.length > 20) e('datos.textos.botonTraspaso', 'pasa de 20 caracteres (el título de un botón de enlace)');
    if (typeof tx.saludo === 'string' && !/inteligencia artificial/i.test(tx.saludo)) e('datos.textos.saludo', 'tiene que decir que es un asistente con inteligencia artificial (prohibición 4)');
    for (const c of Object.keys(tx)) if (!CLAVES_TEXTOS.includes(c)) e(`datos.textos.${c}`, 'no es un texto conocido');
  }

  // --- R4: pedir el nombre y el negocio, cordialmente y una sola vez
  const pd = k.pedirDatos && typeof k.pedirDatos === 'object' && !Array.isArray(k.pedirDatos) ? k.pedirDatos : null;
  if (!pd) e('datos.pedirDatos', 'falta');
  else {
    const conNegocio = (v, ruta, pideNombre, pideNegocio) => {
      const m = errorDeTextoDelCliente(v, { sinAcredita: true });
      if (m) { e(ruta, m); return; }
      const n = LIB.chNorm(v);
      if ((v.match(/\?/g) || []).length !== 1) e(ruta, 'tiene que traer UNA sola pregunta');
      if (pideNombre && !/\bcomo te llamas\b/.test(n)) e(ruta, 'tiene que preguntar «¿cómo te llamas…?»');
      if (pideNegocio && !/\bcomo se llama tu (?:negocio|empresa)\b/.test(n)) e(ruta, 'tiene que preguntar «¿cómo se llama tu negocio?» (o «tu empresa»)');
      if ((n.match(/\bnegocio\b/g) || []).length > 1) e(ruta, 'dice «negocio» más de una vez');
      if (v.length > 200) e(ruta, 'pasa de 200 caracteres');
    };
    if (!Array.isArray(pd.ambos) || pd.ambos.length < 2 || pd.ambos.length > 5) e('datos.pedirDatos.ambos', 'tiene que ser una lista de 2 a 5 variantes');
    else pd.ambos.forEach((v, i) => conNegocio(v, `datos.pedirDatos.ambos[${i}]`, true, true));
    conNegocio(pd.soloEmpresa, 'datos.pedirDatos.soloEmpresa', false, true);
    conNegocio(pd.soloNombre, 'datos.pedirDatos.soloNombre', true, false);
    conNegocio(pd.planesAmbos, 'datos.pedirDatos.planesAmbos', true, true);
    conNegocio(pd.planesSoloEmpresa, 'datos.pedirDatos.planesSoloEmpresa', false, true);
    conNegocio(pd.planesSoloNombre, 'datos.pedirDatos.planesSoloNombre', true, false);
    for (const c of Object.keys(pd)) if (!['ambos', 'soloEmpresa', 'soloNombre', 'planesAmbos', 'planesSoloEmpresa', 'planesSoloNombre'].includes(c)) e(`datos.pedirDatos.${c}`, 'no es un texto conocido');
  }
  // --- R6: el complemento de los planes (hechos del documento y de la imagen; sin cifras de conversaciones ni de consumo)
  const cp = k.complementoPlanes && typeof k.complementoPlanes === 'object' && !Array.isArray(k.complementoPlanes) ? k.complementoPlanes : null;
  if (!cp) e('datos.complementoPlanes', 'falta');
  else if (!Array.isArray(cp.partes) || cp.partes.length < 1 || cp.partes.length > 4) e('datos.complementoPlanes.partes', 'tiene que ser una lista de 1 a 4 frases');
  else {
    cp.partes.forEach((v, i) => {
      const m = errorDeTextoDelCliente(v.replace(/\{usdEstandar\}|\{usdMedida\}/g, 'USD'), { complemento: true, sinAcredita: true });
      if (m) e(`datos.complementoPlanes.partes[${i}]`, m);
      for (const mm of v.matchAll(/\{([A-Za-z]+)\}/g)) if (!['usdEstandar', 'usdMedida'].includes(mm[1])) e(`datos.complementoPlanes.partes[${i}]`, `trae un marcador {${mm[1]}} desconocido (solo usdEstandar, usdMedida)`);
    });
    if (cp.partes.join(' ').length > 800) e('datos.complementoPlanes.partes', 'juntas pasan de 800 caracteres (con el cierre tienen que caber en un mensaje)');
  }
  // --- R2: los hechos verificados de la empresa (los usa el modelo) y sus puntos clave
  const em = k.empresa && typeof k.empresa === 'object' && !Array.isArray(k.empresa) ? k.empresa : null;
  if (!em) e('datos.empresa', 'falta');
  else {
    if (!Array.isArray(em.hechos) || em.hechos.length < 2 || em.hechos.length > 8) e('datos.empresa.hechos', 'tiene que ser una lista de 2 a 8 hechos');
    else em.hechos.forEach((v, i) => { const m = errorDeInstruccion(v); if (m) e(`datos.empresa.hechos[${i}]`, m); else if (v.length > 300) e(`datos.empresa.hechos[${i}]`, 'pasa de 300 caracteres'); });
    if (!Array.isArray(em.puntosClave) || em.puntosClave.length < 1 || em.puntosClave.length > 6) e('datos.empresa.puntosClave', 'tiene que ser una lista de 1 a 6 puntos');
    else em.puntosClave.forEach((pc, j) => {
      const donde = `datos.empresa.puntosClave[${j}]`;
      if (!pc || typeof pc.texto !== 'string' || typeof pc.palabras !== 'string' || !/^[a-z0-9 |()]+$/.test(pc.palabras) || pc.palabras.length > 120) { e(donde, 'tiene que ser { texto, palabras } con una familia de palabras en minúsculas, números, espacios y | ( )'); return; }
      let re = null;
      try { re = new RegExp(pc.palabras); } catch (x) { e(`${donde}.palabras`, 'no compila'); return; }
      if (rp && typeof rp.empresa === 'string' && !re.test(LIB.chNorm(rp.empresa))) e(`${donde}.palabras`, 'el respaldo de la empresa no cubre este punto clave');
    });
  }
  if (errores.length) throw new Error(`${archivo}: datos no válidos: ${errores.join('; ')}`);
}
/** Los marcadores `{asistente}` y `{negocio}` se sustituyen por nombres para revisar el texto como lo vería el cliente. */
function chSust(t) {
  return typeof t === 'string' ? t.replace(/\{asistente\}/g, 'Kenji').replace(/\{negocio\}/g, 'NovuChat') : t;
}

// ----------------------------------------------------------------- los datos dentro de la plantilla
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;
function dato(datos, ruta, donde) {
  let x = datos;
  for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
  if (typeof x !== 'string' || x === '') throw new Error(`${donde}: falta el dato «${ruta}» en el archivo de datos`);
  if (CARACTERES_PELIGROSOS.test(x) && !ruta.startsWith('credenciales.') && ruta !== 'nombreFlujo') throw new Error(`${donde}: el dato «${ruta}» trae una comilla, una barra invertida, una llave o un salto de línea`);
  return x;
}
function reemplazarTextos(valor, datos, donde) {
  if (typeof valor === 'string') return valor.replace(/@@dato:([A-Za-z0-9_.]+)@@/g, (_, ruta) => dato(datos, ruta, donde));
  if (Array.isArray(valor)) return valor.map((v) => reemplazarTextos(v, datos, donde));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([c, v]) => [c, reemplazarTextos(v, datos, donde)]));
  return valor;
}
function asignaciones(configBase) {
  return Object.entries(configBase).map(([nombre, valor]) => {
    if (!['string', 'number', 'boolean'].includes(typeof valor)) throw new Error(`configBase.${nombre}: solo texto, número o booleano`);
    return { id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor };
  });
}

/**
 * Reemplaza UNA línea marcadora por `const <nombre> = <literal>;` en el código de los nodos de un flujo armado. La línea tiene que aparecer exactamente una vez en TODO el flujo:
 * 0 o 2 apariciones es un error (un nodo sin datos, o dos con ellos).
 */
export function inyectar(flujo, marca, nombre, valor) {
  // JSON es JS válido; los separadores de línea y de párrafo se escapan igual (un literal de una sola línea).
  const literal = JSON.stringify(valor).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  let veces = 0;
  for (const n of flujo.nodes) {
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js !== 'string') continue;
    const lineas = js.split('\n');
    let toco = false;
    for (let i = 0; i < lineas.length; i++) {
      if (lineas[i].trimEnd() === marca) { lineas[i] = `const ${nombre} = ${literal}; // generado por construir.mjs desde el archivo de datos`; veces += 1; toco = true; }
    }
    if (toco) n.parameters.jsCode = lineas.join('\n');
  }
  if (veces !== 1) throw new Error(`«${marca}» aparece ${veces} veces en el flujo: tiene que aparecer exactamente una`);
}

// ----------------------------------------------------------------- las guardias de lo armado
const ANFITRION_CONSOLA = 'us-east1-novuchat-demo.cloudfunctions.net';
const ANFITRIONES = ['graph.facebook.com', 'generativelanguage.googleapis.com', ANFITRION_CONSOLA];
// Una URL por expresión (`={{ … }}`) solo vale para la descarga del medio (la URL que devuelve Meta): las del modelo llevan el host fijo y solo el id del modelo por expresión.
const URL_POR_EXPRESION = { 'Descargar medio': '={{ $json.url }}' };
export function anfitrionPermitido(nombreDelNodo, url) {
  if (/^REEMPLAZAR_[A-Z0-9_]+$/.test(url)) return true;
  if (URL_POR_EXPRESION[nombreDelNodo] === url) return true;
  // El «anfitrión» es todo lo que va entre «https://» y la primera barra, `?` o `#`: con un usuario (arroba) o un puerto, no es un anfitrión permitido.
  const m = /^=?https:\/\/([^/?#\s]*)/i.exec(url);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return false;
  return ANFITRIONES.includes(m[1].toLowerCase());
}

/**
 * Lo que un JSON de este flujo no puede tener, aunque alguien lo haya agregado a mano al archivo versionado. Devuelve la lista de hallazgos (vacía si está limpio).
 * `entrada`: 'trigger' | 'prueba'.
 */
export function guardias(entrada, flujo, datos = {}) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const nombres = new Set(nodos.map((n) => n.name));
  const parametros = (n) => (n && n.parameters) || {};
  // «Entrada de prueba» nunca en producción: es el único nodo que activa el modo prueba. «WhatsApp Trigger» nunca en la prueba.
  if (entrada !== 'prueba' && nombres.has(NODO_PRUEBA)) h.push(`contiene el nodo «${NODO_PRUEBA}» (activa el modo prueba): solo va en el JSON de prueba`);
  if (entrada === 'prueba' && nombres.has(NODO_TRIGGER)) h.push(`contiene el nodo «${NODO_TRIGGER}» en la prueba: activarlo registra el webhook en Meta y se lo quita al flujo vivo`);
  if (entrada !== 'prueba' && !nodos.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')) h.push(`no tiene el nodo «${NODO_TRIGGER}»`);
  // El disparador, con credencial explícita y nunca la de AAB1-WA-Prod (prohibición 7).
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.whatsAppTrigger')) {
    const nombre = String(((n.credentials || {}).whatsAppTriggerApi || {}).name || '');
    if (!nombre) h.push(`el «${n.name}» no trae una credencial explícita (whatsAppTriggerApi)`);
    else if (/aab1|wa-prod/i.test(nombre)) h.push(`el «${n.name}» usa una credencial de AAB1-WA-Prod (prohibición 7)`);
  }
  // Los webhooks: en producción ninguno; en la prueba, uno solo —«Entrada de prueba»— con su credencial de cabecera.
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.webhook')) {
    if (entrada !== 'prueba') h.push(`el webhook «${n.name}» no va en producción`);
    else if (n.name !== NODO_PRUEBA) h.push(`el webhook «${n.name}» no es la «${NODO_PRUEBA}»`);
    else if (parametros(n).authentication !== 'headerAuth' || !((n.credentials || {}).httpHeaderAuth || {}).name) h.push(`la «${NODO_PRUEBA}» tiene que exigir una credencial de cabecera (httpHeaderAuth)`);
    if (entrada !== 'prueba' && (/prueba/i.test(String(parametros(n).path || '')) || (datos.pruebaRuta && parametros(n).path === datos.pruebaRuta))) h.push(`el webhook «${n.name}» tiene una ruta de prueba`);
  }
  // Ninguna llamada a las suscripciones de la app de Meta, en ningún nodo, texto ni código (prohibición 7).
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) h.push('menciona «subscriptions» o «subscribed_apps»: ningún flujo toca las suscripciones de la app de Meta (prohibición 7)');
  // Un nodo HTTP solo habla con Meta, con Gemini y con las Functions de la consola (o con un marcador por reemplazar).
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    if (!anfitrionPermitido(n.name, String(parametros(n).url || ''))) h.push(`el nodo «${n.name}» llama a un anfitrión fuera de la lista (graph.facebook.com, generativelanguage.googleapis.com, las Functions de la consola)`);
  }
  // Sin agente y sin memoria de n8n: ocultan los errores de las herramientas y pierden el contexto. El historial lo guarda y lo pasa este flujo, explícito, en cada llamada.
  for (const n of nodos) {
    if (/langchain\.(agent|memory\w*|lmChat\w*|chain\w*)$/i.test(String(n.type))) h.push(`el nodo «${n.name}» es de tipo ${n.type}: este flujo no lleva agente, memoria ni modelo de chat de n8n`);
  }
  // La coalescencia de clics necesita su espera y el modelo, su reintento: sin ellos el flujo responde una vez por clic o sin validar.
  const espera = nodos.find((n) => n.name === 'Esperar ráfaga');
  if (nodos.length && (!espera || espera.type !== 'n8n-nodes-base.wait')) h.push('falta el nodo «Esperar ráfaga» (n8n-nodes-base.wait): sin él no hay coalescencia de clics');
  // Retención de ejecuciones, orden y zona horaria (decisión de Andres, 03/10/2026: se guardan solo las ejecuciones que fallan).
  const st = (flujo && flujo.settings) || {};
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'all' || st.saveExecutionProgress !== false) h.push('los ajustes de retención deben ser saveDataSuccessExecution «none», saveDataErrorExecution «all» y saveExecutionProgress false (solo se guardan las ejecuciones que fallan; llevan el texto del turno)');
  if (st.errorWorkflow !== undefined) h.push('no lleva `errorWorkflow` (D13)');
  if (st.executionOrder !== 'v1') h.push('executionOrder tiene que ser «v1» (el orden de las ramas es el del lienzo)');
  if (st.timezone !== 'America/La_Paz') h.push('timezone tiene que ser «America/La_Paz»');
  // La planilla: lecturas mínimas, y la forma de escribir de cada nodo.
  const sheet = (nombre) => nodos.find((n) => n.name === nombre);
  const rango = (n) => (((parametros(n).options || {}).dataLocationOnSheet || {}).values || {}).range;
  const formato = (n) => (parametros(n).options || {}).cellFormat;
  if (sheet('Buscar teléfono en planilla') && rango(sheet('Buscar teléfono en planilla')) !== 'A3:J') h.push('«Buscar teléfono en planilla» tiene que leer solo el rango A3:J (nunca las columnas del equipo)');
  if (sheet('Leer IDs de la planilla') && rango(sheet('Leer IDs de la planilla')) !== 'A3:A') h.push('«Leer IDs de la planilla» tiene que leer solo el rango A3:A');
  if (sheet('Agregar fila') && formato(sheet('Agregar fila')) !== 'USER_ENTERED') h.push('«Agregar fila» tiene que escribir en USER_ENTERED (la fecha queda como fecha)');
  if (sheet('Actualizar fila') && formato(sheet('Actualizar fila')) !== 'RAW') h.push('«Actualizar fila» tiene que escribir en RAW (nada se interpreta)');
  // `REEMPLAZAR_` solo en «Config base» (y en la ruta de «Entrada de prueba»).
  for (const n of nodos) {
    if (n.name === 'Config base') continue;
    const sinRuta = n.name === NODO_PRUEBA ? { ...n, parameters: { ...parametros(n), path: '' } } : n;
    if (/REEMPLAZAR_[A-Z0-9]/.test(JSON.stringify(sinRuta))) h.push(`el nodo «${n.name}» trae un marcador REEMPLAZAR_: solo va en «Config base» (y la ruta de prueba)`);
  }
  return h;
}

/** Los `chat-novuchat.*.json` de `dirFlujo` que ya no tienen archivo de datos (salvo los `*.local.json`, que no se versionan). */
export function huerfanos(dirFlujo = AQUI, dirDatos = DATOS) {
  const salidas = new Set(archivosDeDatos(dirDatos).map(salidaDe));
  return readdirSync(dirFlujo).filter((f) => /^chat-novuchat\..+\.json$/.test(f) && !/\.local\.json$/.test(f) && !salidas.has(f));
}

// ----------------------------------------------------------------- armar
const sinMarcas = (v, esCodigo) => {
  if (typeof v === 'string') return esCodigo ? !v.startsWith('@@') : !v.includes('@@');
  if (Array.isArray(v)) return v.every((x) => sinMarcas(x, false));
  if (v && typeof v === 'object') return Object.entries(v).every(([c, x]) => sinMarcas(x, c === 'jsCode'));
  return true;
};

/** Arma el JSON de UN archivo de datos con el proyecto ya leído (`leerProyecto`). Devuelve el texto. */
export function armarTenant(proyecto, datos, archivo) {
  const plantilla = JSON.parse(JSON.stringify(proyecto.plantilla));
  // Primero se quita el disparador que no corresponde: sus credenciales no tienen por qué estar en los datos.
  const quitar = datos.entrada === 'prueba' ? NODO_TRIGGER : NODO_PRUEBA;
  plantilla.nodes = plantilla.nodes.filter((n) => n.name !== quitar);
  for (const n of plantilla.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${archivo} · ${n.name}`);
    for (const c of Object.values(n.credentials || {})) {
      const m = /^@@cred:(trigger|ingesta|graph|planilla|entradaPrueba)$/.exec(String(c.name));
      if (m) c.name = dato(datos, `credenciales.${m[1]}`, `${archivo} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
  }
  // La cadena de envío común, con las credenciales por NOMBRE del archivo de datos y la ingesta de la consola. Cuelga de «Armar mensajes», arriba de la hoja y de «Confirmar envío».
  injertar(plantilla, { credenciales: { graph: dato(datos, 'credenciales.graph', archivo), ingesta: dato(datos, 'credenciales.ingesta', archivo) }, ingestaUrl: `https://${ANFITRION_CONSOLA}/ingesta`, desde: [5720, 160] });
  // Puerta de la entrega (propia): el reporte saliente cuelga de «¿Meta aceptó?», que lee `messages[0].id`. Solo se reencamina la CONEXION de la cadena común; sus nodos quedan intactos.
  const reporta = plantilla.connections['¿Reportar? (saliente)'];
  if (!reporta || !reporta.main[0] || reporta.main[0].length !== 1 || reporta.main[0][0].node !== 'Reportar mensaje (saliente)') throw new Error(`${archivo}: la cadena común cambió: «¿Reportar? (saliente)» ya no cuelga de «Reportar mensaje (saliente)»`);
  reporta.main[0] = [{ node: '¿Meta aceptó?', type: 'main', index: 0 }];
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: salidaDe(archivo), nombre: dato(datos, 'nombreFlujo', archivo), quitar: [] });
  const flujo = JSON.parse(texto);
  inyectar(flujo, MARCA_DATOS, 'CH_DATOS', datos.datos);
  const final = JSON.stringify(flujo, null, 2) + '\n';
  if (!sinMarcas(flujo, false)) throw new Error(`${archivo}: quedó una marca @@ sin reemplazar`);
  return final;
}

/**
 * Arma (o verifica) todos los JSON. Devuelve un resultado por archivo de datos y los huérfanos; lanza ante un dato inválido, una guardia violada en lo armado o una plantilla que falta.
 *   opciones: { carpeta, datos, verificar, config, tope }   (`config` y `tope` son para las pruebas)
 */
export function construir({ carpeta = AQUI, datos: dirDatos = DATOS, verificar = false, config = CONFIG_BASE, tope } = {}) {
  const archivos = archivosDeDatos(dirDatos);
  if (!archivos.length) throw new Error(`no hay archivos de datos en ${dirDatos}`);
  // Los datos se validan todos ANTES de tocar la plantilla: un dato malo se ve aunque la plantilla no exista.
  const todos = archivos.map((a) => {
    const d = cargarDatos(a, dirDatos);
    validarDatos(d, a);
    return { archivo: a, datos: d };
  });
  const proyecto = leerProyecto(carpeta, { ...config, variantes: todos.map((t) => ({ archivo: salidaDe(t.archivo), nombre: t.datos.nombreFlujo })) }, tope ? { tope } : {});
  const resultado = todos.map(({ archivo, datos }) => {
    const texto = armarTenant(proyecto, datos, archivo);
    const salida = salidaDe(archivo);
    // Lo que se arma nunca viola las guardias (si la plantilla lo hiciera, falla la construcción)…
    const propios = guardias(datos.entrada, JSON.parse(texto), datos);
    if (propios.length) throw new Error(`${salida}: ${propios.join('; ')}`);
    const ruta = join(carpeta, salida);
    const actual = leerSiExiste(ruta, salida);
    // …y el archivo VERSIONADO tampoco las viola (aunque alguien lo haya tocado a mano).
    let versionado = [];
    if (actual !== null) {
      try { versionado = guardias(datos.entrada, JSON.parse(actual), datos); } catch (x) { versionado = ['no es un JSON válido']; }
    }
    if (!verificar) escribirSinSeguirEnlaces(ruta, texto, salida);
    return { archivo: salida, datos: archivo, nodos: JSON.parse(texto).nodes.length, existia: actual !== null, alDia: actual === texto, versionado };
  });
  return { resultado, huerfanos: huerfanos(carpeta, dirDatos) };
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  // Cualquier argumento que no sea `--verificar` ESCRIBE los JSON (como el armador de Captación mínima): la ayuda no existe como opción. Por eso se avisa de lo desconocido.
  const desconocidos = args.filter((a) => a !== '--verificar');
  if (desconocidos.length) { console.error(`✗ argumento desconocido: ${desconocidos.join(' ').slice(0, 60)}. Solo existe --verificar; sin argumentos escribe los JSON.`); process.exit(2); }
  const verificar = args.includes('--verificar');
  try {
    const { resultado, huerfanos: hu } = construir({ verificar });
    let difiere = false;
    for (const r of resultado) {
      if (!verificar) { console.log(`✓ ${r.archivo} escrito (${r.nodos} nodos)`); continue; }
      if (r.versionado.length) { difiere = true; console.error(`✗ ${r.archivo} ${r.versionado.join('; ')}`); }
      else if (!r.alDia) { difiere = true; console.error(`✗ ${r.archivo} ${r.existia ? 'difiere de lo que arma la plantilla' : 'no existe'}: corra «node construir.mjs»`); }
      else console.log(`✓ ${r.archivo} al día`);
    }
    if (verificar) {
      for (const f of hu) {
        difiere = true;
        console.error(`✗ ${f} ya no tiene archivo de datos en admin/scripts/datos/chat-novuchat/ (¿se borró o se renombró?): bórrelo o devuelva su archivo de datos`);
      }
    }
    process.exit(difiere ? 1 : 0);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
