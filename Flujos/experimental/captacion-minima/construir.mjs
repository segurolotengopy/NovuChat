#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de «Captación mínima (v0)» desde la plantilla y los datos del tenant
 * =============================================================================
 *
 *   node construir.mjs               escribe captacion-minima.<tenant>.json y captacion-minima.prueba.json
 *   node construir.mjs --verificar   no escribe: sale 1 si un JSON versionado difiere de lo que se arma, si viola una
 *                                    guardia o si hay un JSON sin archivo de datos (huérfano)
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos del negocio. Este archivo NO arma
 * el código de los nodos: lo hace el armador genérico `../comun-sin-agente/construir.mjs` (importado), con el
 * config de `CONFIG_BASE` (librería `src/lib/captacion.js`, comunes `src/nodos/_comun.js` y los paquetes
 * `mensajes` y `filtro`, en una marca como `"jsCode": "@@todo+mensajes+filtro:nodos/armar-mensajes.js"`).
 * Lo propio de este archivo es lo que el armador genérico no sabe:
 *
 *   - `@@dato:a.b.c@@` (en cualquier texto de la plantilla) por ese dato del tenant;
 *   - `@@cred:trigger|ingesta|graph|planilla|crm|entradaPrueba` (nombre de credencial) por el nombre del tenant;
 *   - «Config base» se llena con `configBase` del tenant (texto, número o booleano);
 *   - LA INYECCIÓN: la línea `const CM_GUION = null; // @@guion` (en un nodo) y la línea
 *     `const CM_CONOCIMIENTO = null; // @@conocimiento` (en otro) se reemplazan por el guion y el corpus del tenant
 *     como literal JS. Cada línea tiene que aparecer EXACTAMENTE una vez en todo el flujo (0 o 2 es un error);
 *   - las VALIDACIONES de los datos (cada una con un error que nombra el campo) y las GUARDIAS de lo armado.
 *
 * LOS DATOS son `admin/scripts/datos/captacion-minima/<tenant>.json` (zona Tenants: solo marcadores `REEMPLAZAR_*`
 * para identificadores, nunca un token, un teléfono, una ruta de webhook ni un id de planilla reales):
 *
 *     { nombreFlujo, entrada: 'trigger' | 'prueba',     // 'prueba' SOLO en ensayo*.json
 *       hereda?: '<otro tenant>',
 *       credenciales: { trigger, ingesta, graph, planilla, crm, entradaPrueba? }, pruebaRuta,
 *       configBase: { … },
 *       guion: { asesor?: { nombre? }, rubros: { '<id>': { dolor, pregunta, impacto?, cierre? }, otro: { pregunta, preguntaDolor?, impacto?, cierre? } } },   // sin imágenes (D16)
 *                                                          // '<id>': el de la consola VIVA o el slug de su nombre (§13, C1)
 *       conocimiento: { huella, generado, excluidos: [ids], fragmentos: [{ id, titulo, url, texto }] } }
 *
 * UNA SALIDA POR ARCHIVO DE DATOS: `novuchat.json` → `captacion-minima.novuchat.json` (con «WhatsApp Trigger»),
 * `ensayo.json` → `captacion-minima.prueba.json` (con «Entrada de prueba», sin «WhatsApp Trigger»: activar un
 * disparador de WhatsApp en n8n registra el webhook en Meta y se lo quita al flujo vivo).
 *
 * Node sin dependencias. No lee ningún .env ni llama a la red. Sin la plantilla (la agrega la Fase 2) falla con un mensaje.
 */
import { closeSync, constants, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const DATOS = join(AQUI, '../../../admin/scripts/datos/captacion-minima');

/** El config del armador genérico, sin las variantes (esas salen de los archivos de datos). */
export const CONFIG_BASE = {
  plantilla: 'flujo.plantilla.json',
  raiz: '../..',
  librerias: ['src/lib/captacion.js'],
  comun: ['src/nodos/_comun.js'],
  paquetes: {
    mensajes: ['../comun-sin-agente/src/mensajes.js'],
    filtro: ['../comun-sin-agente/src/filtro-redaccion.js'],
  },
};

export const MARCA_GUION = 'const CM_GUION = null; // @@guion';
export const MARCA_CONOCIMIENTO = 'const CM_CONOCIMIENTO = null; // @@conocimiento';
const NODO_TRIGGER = 'WhatsApp Trigger';
const NODO_PRUEBA = 'Entrada de prueba';

// ----------------------------------------------------------------- lectura y escritura sin seguir enlaces
const noExiste = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
/** Lee un archivo SIN seguir enlaces simbólicos; null si no existe. Sin «comprobar y luego leer». */
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

// ----------------------------------------------------------------- los datos del tenant
const esEnsayo = (archivo) => /^ensayo[\w-]*\.json$/.test(archivo);
/** `novuchat.json` → `captacion-minima.novuchat.json`; `ensayo.json` → `captacion-minima.prueba.json`. */
export const salidaDe = (archivo) => (archivo === 'ensayo.json' ? 'captacion-minima.prueba.json' : `captacion-minima.${archivo.replace(/\.json$/, '')}.json`);
export const archivosDeDatos = (dir = DATOS) => readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

/** Lee un archivo de datos y resuelve `hereda` (un nombre de archivo, nunca una ruta; sin vueltas). */
export function cargarDatos(archivo, dir = DATOS, pila = []) {
  if (pila.includes(archivo)) throw new Error(`${archivo}: «hereda» da una vuelta`);
  const texto = leerSiExiste(join(dir, archivo), archivo);
  if (texto === null) throw new Error(`${archivo}: no existe en ${dir}`);
  let d;
  // Sin el texto del archivo en el mensaje: si no es JSON, no se muestran sus bytes.
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

// ----------------------------------------------------------------- validaciones (cada error nombra el campo)
const MARCADOR = /^REEMPLAZAR_[A-Z0-9_]+$/;
const o = (re) => new RegExp(`^(${re.source}|REEMPLAZAR_[A-Z0-9_]+)$`);
// Las formas de `configBase` que se conocen: el marcador o el valor real. Un dato más no es un error: se valida su tipo.
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
  // Opcional (S7): los números a los que una ejecución de PRUEBA puede dirigirse, separados por comas; el marcador no restringe.
  telefonosDePrueba: o(/\d{6,20}(,\d{6,20})*/),
};
const CAMPOS_CONFIG = ['waGraphVersion', 'phoneNumberIdEsperado', 'numeroRecepcion', 'nombreNegocio', 'horarioAtencion', 'plantillaAviso',
  'idiomaPlantillaAviso', 'planillaProspectosId', 'planillaProspectosHoja', 'crmUrl', 'prefijosPermitidos', 'nivelEmojis',
  'mensajeComercioSuspendido', 'limiteInteractivo'];
const CREDENCIALES = ['trigger', 'ingesta', 'graph', 'planilla', 'crm'];
const MOTIVOS = ['numero_equivocado', 'vende_o_busca_trabajo', 'sin_negocio', 'spam_o_prueba'];
const ID_RUBRO = /^[a-z0-9_-]{1,40}$/;
// UN SOLO patrón de precios: el de la librería (`CC_PRECIO`, una línea de `src/lib/captacion.js`), leído de allí.
function patronDePrecios() {
  const fuente = leerSiExiste(join(AQUI, 'src/lib/captacion.js'), 'src/lib/captacion.js') || '';
  const m = /^const CC_PRECIO = \/(.+)\/([a-z]*);$/m.exec(fuente);
  if (!m) throw new Error('src/lib/captacion.js: no se encontró la línea «const CC_PRECIO = /…/;»');
  return new RegExp(m[1], m[2]);
}
export const PRECIO = patronDePrecios();
/** Una constante numérica de la librería (`const CC_X = 24;`): los límites del guion tienen UNA fuente, la librería (§15). */
function numeroDeLaLibreria(nombre) {
  const fuente = leerSiExiste(join(AQUI, 'src/lib/captacion.js'), 'src/lib/captacion.js') || '';
  const m = new RegExp(`^const ${nombre} = (\\d+);`, 'm').exec(fuente);
  if (!m) throw new Error(`src/lib/captacion.js: no se encontró la línea «const ${nombre} = <número>;»`);
  return Number(m[1]);
}
/** Una expresión regular de una línea de la librería (`const CC_X = /…/;`). */
function regexDeLaLibreria(nombre) {
  const fuente = leerSiExiste(join(AQUI, 'src/lib/captacion.js'), 'src/lib/captacion.js') || '';
  const m = new RegExp(`^const ${nombre} = \\/(.+)\\/([a-z]*);`, 'm').exec(fuente);
  if (!m) throw new Error(`src/lib/captacion.js: no se encontró la línea «const ${nombre} = /…/;»`);
  return new RegExp(m[1], m[2]);
}
export const MAX_PALABRAS_QUE_HACEMOS = numeroDeLaLibreria('CC_MAX_PALABRAS_QUE_HACEMOS');
export const MAX_PALABRAS_IMPACTO = numeroDeLaLibreria('CC_MAX_PALABRAS_IMPACTO');
export const MAX_PALABRAS_COMO_FUNCIONA = numeroDeLaLibreria('CC_MAX_PALABRAS_COMO_FUNCIONA');
// §16 (documento comercial de Kenji): la explicación del rubro y los límites del mensaje general, de la librería (una sola fuente).
export const MAX_EXPLICACION = numeroDeLaLibreria('CC_MAX_EXPLICACION');
export const MAX_ORACIONES_EXPLICACION = numeroDeLaLibreria('CC_MAX_ORACIONES_EXPLICACION');
export const MAX_PALABRAS_EXPLICACION = numeroDeLaLibreria('CC_MAX_PALABRAS_EXPLICACION');
export const MAX_PALABRAS_PREGUNTA_OFERTA = numeroDeLaLibreria('CC_MAX_PALABRAS_PREGUNTA_OFERTA');
export const MAX_PALABRAS_EMPATIA = numeroDeLaLibreria('CC_MAX_PALABRAS_EMPATIA');
function limiteGeneral() {
  const fuente = leerSiExiste(join(AQUI, 'src/lib/captacion.js'), 'src/lib/captacion.js') || '';
  const m = /^const CC_LIMITE_GENERAL = \{ oraciones: (\d+), palabras: (\d+) \};/m.exec(fuente);
  if (!m) throw new Error('src/lib/captacion.js: no se encontró la línea «const CC_LIMITE_GENERAL = { oraciones: N, palabras: N };»');
  return { oraciones: Number(m[1]), palabras: Number(m[2]) };
}
export const LIMITE_GENERAL = limiteGeneral();
const PROMESA = regexDeLaLibreria('CC_PROMESA_DEL_MODELO');
// §15: lo que NINGÚN texto del guion puede decir, del mismo patrón que filtra al modelo (una sola fuente: la librería).
const OFERTA = regexDeLaLibreria('CC_OFERTA_DEL_MODELO');
const YO = regexDeLaLibreria('CC_YO_DEL_MODELO');
const MONTO_EN_LETRAS = regexDeLaLibreria('CC_MONTO_MODELO');
const ENLACE = regexDeLaLibreria('CC_ENLACE');
// §18 (B3): los filtros nuevos de la redacción del modelo también rigen los textos del tenant (una sola fuente: la librería).
const ACREDITA_MODELO = regexDeLaLibreria('CC_ACREDITA_MODELO');
const SISTEMA_CONOCIDO = regexDeLaLibreria('CC_SISTEMA_CONOCIDO');
const CIFRA_DE_CONSUMO = regexDeLaLibreria('CC_CIFRA_DE_CONSUMO');
const BLOQUEO_COMUN = regexDeLaLibreria('CC_BLOQUEO_COMUN');
/** Funciones puras de la librería que la validación necesita (el «sistema ajeno» por mayúscula en medio de la frase). */
const FUNCIONES_DE_LA_LIBRERIA = new Function(`${leerSiExiste(join(AQUI, 'src/lib/captacion.js'), 'src/lib/captacion.js') || ''}\nreturn { ccSistemaAjeno };`)();
/** Los nombres propios que un texto del tenant puede traer (el negocio, el asistente): los fija `validarDatos` antes de revisar los textos. */
let NOMBRES_PROPIOS = [];
const ACREDITACION = /acreditad|verificad|pago (exitoso|recibido|confirmado|aprobado|validado)|recibimos tu pago|\bgarantiz/;
const NIEGA_SER_IA = /\bno soy (un |una )?(bot|robot|ia|inteligencia|maquina|asistente|programa)|\bsoy (una )?(persona|humano|humana)|de carne y hueso|persona real|\bno es (un )?(bot|robot)/;
/** Raíces de riesgo del vocabulario cálido: ÚNICA fuente, la librería (`CC_RAICES_DE_RIESGO`, prefijos separados por espacios). */
const RAICES_DE_RIESGO = (/^const CC_RAICES_DE_RIESGO = '([^']+)';$/m.exec(leerSiExiste(join(AQUI, 'src/lib/captacion.js'), 'src/lib/captacion.js') || '') ?? [, ''])[1].split(' ').filter(Boolean);
const NUMERO_EN_LETRAS = /\b(cinco|diez|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|quinientos|mil)\s+(dolares|bolivianos|bs|usd|por ciento)\b/;
const CONTROLES = /[\u0000-\u001f\u007f\u2028\u2029]/;
// Caracteres invisibles o de control que se cuelan en un texto sin verse (U+0080 a U+009F, guion blando, espacios de ancho cero, marcas de dirección, BOM).
const INVISIBLES = /[\u0080-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

/** Oraciones y palabras: la misma cuenta que `ccContar` de la librería (una prueba compara las dos). */
export function contarTexto(t) {
  const s = String(t ?? '').trim();
  if (!s) return { oraciones: 0, palabras: 0 };
  let oraciones = 0;
  let previo = '';
  for (const tz of s.split(/(?<=[.!?…])\s+/)) {
    if (oraciones && /\b(Dr|Dra|Sr|Sra|Srta|Lic|Ing|Prof|Av|No|Nro)\.$/i.test(previo)) { previo += ' ' + tz; continue; }
    previo = tz;
    if (/[\p{L}\p{N}]/u.test(tz)) oraciones += 1;
  }
  return { oraciones, palabras: s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length };
}

/** El texto sin tildes, en minúsculas y con espacios simples (como `ccNorm` de la librería, para las regex de promesas). */
function ccNorm(t) {
  return String(t ?? '').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Todo texto del guion: una línea, sin lo que n8n o una planilla toman por código, sin formato de WhatsApp, sin invisibles, sin marcador ni enlace, y sin lo que el servicio no puede decir (§15). */
function errorDeTextoDelGuion(v, opciones) {
  const opc = opciones || {};
  if (CONTROLES.test(v)) return 'trae un salto de línea o un carácter de control';
  if (INVISIBLES.test(v)) return 'trae un carácter invisible o de control (U+0080 a U+009F, guion blando, ancho cero, marca de dirección o BOM)';
  if (/^[=+\-@]/.test(v)) return 'empieza con «=», «+», «-» o «@» (una planilla lo tomaría por fórmula)';
  if (/[*_~`]/.test(v)) return 'trae formato de WhatsApp (*, _, ~ o `): cambiaría cómo se ve el texto';
  if (/\{\{|\[|\]|<|>/.test(v)) return 'trae «{{», «[», «]», «<» o «>»';
  if (/REEMPLAZAR_/.test(v)) return 'trae un marcador REEMPLAZAR_';
  if (ENLACE.test(v)) return 'trae un enlace o un dominio';
  const n = ccNorm(v);
  if (PROMESA.test(n)) return 'promete que alguien llamará, escribirá o responderá («solo se ofrece lo que se cumple»)';
  if (OFERTA.test(n) || /%|\bgratis\b|\bdescuento/.test(n)) return 'trae una oferta, un regalo, una rebaja, un descuento o un porcentaje';
  if (PRECIO.test(v) || MONTO_EN_LETRAS.test(n) || NUMERO_EN_LETRAS.test(n)) return 'trae un precio o un monto: los precios los arma el código desde la consola';
  if (ACREDITACION.test(n)) return 'afirma un pago acreditado o verificado, o garantiza algo (prohibición 3)';
  if (NIEGA_SER_IA.test(n) || YO.test(n)) return 'habla como una persona o niega ser una IA (prohibición 4)';
  // §18 (B3): lo mismo que se le exige a la redacción del modelo.
  if (BLOQUEO_COMUN.test(n)) return 'trae una gratuidad, un regalo, una promesa de contacto, una afirmación de que concilia, aprueba, certifica o garantiza, que es una persona, un correo deletreado o una moneda';
  if (CIFRA_DE_CONSUMO.test(n)) return 'trae una cifra de consumo o de capacidad (conversaciones, mensajes, clientes, turnos…): los topes los muestra la imagen de planes';
  if (opc.sinAcredita !== true && ACREDITA_MODELO.test(n)) return 'afirma que el servicio valida, verifica o acredita pagos o transferencias, o que consulta al banco';
  if (SISTEMA_CONOCIDO.test(n) || FUNCIONES_DE_LA_LIBRERIA.ccSistemaAjeno(v, NOMBRES_PROPIOS, false)) return 'nombra un sistema, plataforma, banco o pasarela que el servicio no nombra';
  return '';
}

/** Valida los datos YA mezclados con lo que hereda. Lanza un error que nombra cada campo malo. */
export function validarDatos(datos, archivo) {
  const errores = [];
  const e = (campo, msg) => errores.push(`«${campo}» ${msg}`);
  const d = datos && typeof datos === 'object' ? datos : {};
  NOMBRES_PROPIOS = [d.configBase && d.configBase.nombreNegocio, d.configBase && d.configBase.nombreAsistente, 'NovuChat', 'Kenji']
    .filter((x) => typeof x === 'string' && x !== '').join(' ').split(/\s+/);

  // --- el flujo y la entrada
  if (typeof d.nombreFlujo !== 'string' || !d.nombreFlujo.trim() || d.nombreFlujo.length > 120 || CONTROLES.test(d.nombreFlujo)) e('nombreFlujo', 'tiene que ser un texto de una línea, de 1 a 120 caracteres');
  if (!['trigger', 'prueba'].includes(d.entrada)) e('entrada', 'tiene que ser «trigger» o «prueba»');
  else if (d.entrada === 'prueba' && !esEnsayo(archivo)) e('entrada', '«prueba» solo puede estar en ensayo*.json: los demás archivos de datos usan «trigger»');
  if (typeof d.pruebaRuta !== 'string' || !/^[A-Za-z0-9_/-]+$/.test(d.pruebaRuta)) e('pruebaRuta', 'no tiene la forma esperada /^[A-Za-z0-9_/-]+$/');

  // --- credenciales: nombres, nunca valores
  const cred = d.credenciales && typeof d.credenciales === 'object' ? d.credenciales : {};
  const pedidas = d.entrada === 'prueba' ? [...CREDENCIALES, 'entradaPrueba'] : CREDENCIALES;
  for (const k of pedidas) if (cred[k] === undefined) e(`credenciales.${k}`, 'falta');
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
    if (typeof cb.horarioAtencion === 'string' && cb.horarioAtencion.length > 120) e('configBase.horarioAtencion', 'pasa de 120 caracteres');
    if (typeof cb.planillaProspectosHoja === 'string' && (cb.planillaProspectosHoja.trim() === '' || cb.planillaProspectosHoja.length > 100)) e('configBase.planillaProspectosHoja', 'tiene que tener de 1 a 100 caracteres (o el marcador)');
    if (typeof cb.mensajeComercioSuspendido === 'string' && (cb.mensajeComercioSuspendido.trim() === '' || cb.mensajeComercioSuspendido.length > 300)) e('configBase.mensajeComercioSuspendido', 'tiene que tener de 1 a 300 caracteres');
    if (cb.crmUrl !== undefined && cb.crmUrl !== '') e('configBase.crmUrl', 'tiene que ir vacío en la v0 (el CRM real queda fuera)');
    if (cb.limiteInteractivo !== undefined && !(Number.isInteger(cb.limiteInteractivo) && cb.limiteInteractivo >= 200 && cb.limiteInteractivo <= 4096)) e('configBase.limiteInteractivo', 'tiene que ser un entero de 200 a 4096');
  }

  // --- el guion
  const g = d.guion && typeof d.guion === 'object' ? d.guion : null;
  if (!g) e('guion', 'falta');
  else {
    // §15: el nombre del asesor es OPCIONAL. NovuChat lo deja vacío (la persona que atienda puede ser otra) y todo mensaje dice «un asesor»; un tenant
    // que configure un nombre (2 a 9 letras) lo usa como siempre. Ausente (`asesor` sin declarar) equivale a vacío.
    if (g.asesor !== undefined) {
      const nombre = g.asesor && typeof g.asesor === 'object' && !Array.isArray(g.asesor) ? g.asesor.nombre : undefined;
      if (g.asesor === null || typeof g.asesor !== 'object' || Array.isArray(g.asesor)) e('guion.asesor', 'tiene que ser un objeto { nombre }');
      else if (nombre !== undefined && (typeof nombre !== 'string' || !(nombre === '' || /^\p{L}{2,9}$/u.test(nombre)))) e('guion.asesor.nombre', 'tiene que ser vacío o de 2 a 9 letras (el botón «Hablar con <nombre>» no pasa de 20 caracteres)');
    }
    const rubros = g.rubros && typeof g.rubros === 'object' && !Array.isArray(g.rubros) ? g.rubros : null;
    if (!rubros) e('guion.rubros', 'falta');
    else {
      const ids = Object.keys(rubros);
      if (!ids.includes('otro')) e('guion.rubros.otro', 'es obligatorio (la salida abierta de la lista)');
      if (ids.length > 20) e('guion.rubros', `tiene ${ids.length} rubros (hasta 20)`);
      for (const id of ids) {
        const ruta = `guion.rubros.${id}`;
        if (!ID_RUBRO.test(id)) { e(ruta, 'tiene un id que no cumple /^[a-z0-9_-]{1,40}$/'); continue; }
        if (/^(__proto__|constructor|prototype)$/.test(id)) { e(ruta, 'tiene un id que toca el prototipo de los objetos'); continue; }
        const r = rubros[id];
        if (!r || typeof r !== 'object' || Array.isArray(r)) { e(ruta, 'tiene que ser un objeto'); continue; }
        // D16: la única imagen que envía el flujo es la de los planes (`archivoPlanes` de la consola); el guion no lleva imágenes.
        if ('imagen' in r) e(`${ruta}.imagen`, 'no se admite: la única imagen que envía el flujo es la de los planes, y viene de la consola');
        for (const k of Object.keys(r)) if (k !== 'imagen' && !['dolor', 'pregunta', 'impacto', 'preguntaDolor', 'cierre', 'queHacemos', 'comoFunciona', 'explicacion', 'puntosClave', 'propuesta'].includes(k)) e(`${ruta}.${k}`, 'no es un campo del guion (dolor, pregunta, impacto, preguntaDolor, cierre, queHacemos, comoFunciona, explicacion, puntosClave, propuesta)');
        // Texto: de qué se compone cada campo.
        const texto = (k, { requerido, max }) => {
          const v = r[k];
          if (v === undefined) { if (requerido) e(`${ruta}.${k}`, 'falta'); return undefined; }
          if (typeof v !== 'string') { e(`${ruta}.${k}`, 'tiene que ser un texto'); return undefined; }
          if (v === '' && !requerido) return '';
          if (v.length < 1 || v.length > max) { e(`${ruta}.${k}`, `tiene que tener de 1 a ${max} caracteres`); return undefined; }
          const motivo = errorDeTextoDelGuion(v);
          if (motivo) { e(`${ruta}.${k}`, motivo); return undefined; }
          return v;
        };
        // §16 (D2): un rubro estándar con `explicacion` (+ `puntosClave`) se explica de inmediato y NO lleva pregunta de dolor; sin ella (otros tenants), `dolor` y `pregunta` como siempre.
        // «Otro» sigue con su `pregunta` (de qué trata y qué le cuesta) y, con `propuesta`, el flujo del documento (empatía + propuesta de valor + cierre investigativo = `preguntaDolor`).
        const nuevo = id !== 'otro' && r.explicacion !== undefined;
        const dolor = texto('dolor', { requerido: id !== 'otro' && !nuevo, max: 200 });
        const pregunta = texto('pregunta', { requerido: !nuevo, max: 140 });
        if (nuevo && (r.dolor !== undefined || r.pregunta !== undefined)) e(ruta, 'lleva `explicacion` y también `dolor` o `pregunta`: la pregunta de dolor es solo de «Otro» (la explicación la reemplaza)');
        if (id !== 'otro' && r.propuesta !== undefined) e(`${ruta}.propuesta`, 'solo lo lleva «otro»');
        if (id !== 'otro' && r.explicacion === undefined && r.puntosClave !== undefined) e(`${ruta}.puntosClave`, 'sin `explicacion` no se usa');
        const explicacion = texto('explicacion', { requerido: false, max: MAX_EXPLICACION });
        const propuesta = texto('propuesta', { requerido: false, max: 300 });
        if (id === 'otro' && r.explicacion !== undefined) e(`${ruta}.explicacion`, 'no la lleva «otro»: sigue su propio flujo (pregunta, propuesta y preguntaDolor)');
        if (explicacion) {
          const c = contarTexto(explicacion);
          if (c.oraciones > MAX_ORACIONES_EXPLICACION) e(`${ruta}.explicacion`, `tiene ${c.oraciones} oraciones (hasta ${MAX_ORACIONES_EXPLICACION}; la exclamación inicial cuenta)`);
          if (c.palabras > MAX_PALABRAS_EXPLICACION) e(`${ruta}.explicacion`, `tiene ${c.palabras} palabras (hasta ${MAX_PALABRAS_EXPLICACION})`);
          if (/[?¿]/.test(explicacion)) e(`${ruta}.explicacion`, 'no lleva «?» ni «¿»: la pregunta de cierre la agrega el código');
          // Con la pregunta de cierre exacta del documento (13 palabras, 1 oración) el mensaje cabe en el límite general.
          if (c.palabras + MAX_PALABRAS_PREGUNTA_OFERTA > LIMITE_GENERAL.palabras || c.oraciones + 1 > LIMITE_GENERAL.oraciones) e(`${ruta}.explicacion`, 'con la pregunta de cierre pasa del límite general del mensaje');
          if (!Array.isArray(r.puntosClave)) e(`${ruta}.puntosClave`, 'falta: la explicación se apoya en los puntos clave del rubro (los ve el modelo)');
        }
        if (r.puntosClave !== undefined) {
          // §17: cada punto clave es un texto (lo ve el modelo) con su FAMILIA de palabras aceptables (`palabras`, alternativas de una expresión regular sin tildes ni mayúsculas) —la regla única
          // que usan el validador de la explicación y la batería— o un texto suelto (se toca con un tercio de sus raíces). El respaldo fijo tiene que cubrir todos sus puntos.
          if (!Array.isArray(r.puntosClave) || r.puntosClave.length < 2 || r.puntosClave.length > 8) e(`${ruta}.puntosClave`, 'tiene que ser una lista de 2 a 8 puntos');
          else r.puntosClave.forEach((p, i) => {
            const donde = `${ruta}.puntosClave[${i}]`;
            const texto = p && typeof p === 'object' && !Array.isArray(p) ? p.texto : p;
            if (typeof texto !== 'string' || texto.length < 3 || texto.length > 160) { e(donde, 'tiene que ser un texto de 3 a 160 caracteres (o un objeto { texto, palabras })'); return; }
            const m = errorDeTextoDelGuion(texto);
            if (m) { e(donde, m); return; }
            if (p && typeof p === 'object') {
              for (const k of Object.keys(p)) if (!['texto', 'palabras'].includes(k)) e(donde, `no tiene el campo «${k}» (solo texto y palabras)`);
              if (p.palabras !== undefined) {
                if (typeof p.palabras !== 'string' || p.palabras.length < 2 || p.palabras.length > 240 || !/^[a-z0-9 |()?.*]+$/.test(p.palabras)) { e(`${donde}.palabras`, 'tiene que ser una familia de palabras (minúsculas sin tildes, números, espacios y | ( ) ? . *) de hasta 240 caracteres'); return; }
                // §18 (B3): sin cuantificadores anidados («)*», «)+», «*)*»: ReDoS) y a lo más dos «.*».
                if (/\)[*+]|[*+]\)[*+]/.test(p.palabras) || (p.palabras.match(/\.\*/g) || []).length > 2 || /(?<!\.)\*/.test(p.palabras) || /(?<!\))\?/.test(p.palabras) || (p.palabras.match(/[*?]/g) || []).length > 4) { e(`${donde}.palabras`, 'trae cuantificadores anidados («)*», «)+»), un «*» que no es «.*», un «?» que no sigue a «)» o más de 4 cuantificadores (más de dos «.*»): una familia de palabras no puede ser una expresión que se cuelgue (ReDoS)'); return; }
                let re = null;
                try { re = new RegExp(p.palabras); } catch (x) { e(`${donde}.palabras`, 'no compila como expresión regular'); return; }
                if (typeof r.explicacion === 'string' && !re.test(ccNorm(r.explicacion))) e(`${donde}.palabras`, `la explicación fija del rubro no la cubre («${texto}»): el respaldo tiene que decir todos sus puntos clave`);
              }
            }
          });
        }
        if (propuesta) {
          const c = contarTexto(propuesta);
          if (c.oraciones > 2) e(`${ruta}.propuesta`, `tiene ${c.oraciones} oraciones (hasta 2)`);
          if (/[?¿]/.test(propuesta)) e(`${ruta}.propuesta`, 'no lleva «?» ni «¿»');
          if (!r.preguntaDolor) e(`${ruta}.preguntaDolor`, 'falta: con `propuesta`, el cierre investigativo es la `preguntaDolor`');
          // Empatía del modelo (hasta 34 palabras) + propuesta + cierre investigativo caben en el mensaje general.
          const cierre = contarTexto(r.preguntaDolor || '');
          if (MAX_PALABRAS_EMPATIA + c.palabras + cierre.palabras > LIMITE_GENERAL.palabras) e(`${ruta}.propuesta`, `con la empatía (${MAX_PALABRAS_EMPATIA} palabras) y el cierre investigativo pasa de ${LIMITE_GENERAL.palabras} palabras`);
        }
        const impacto = texto('impacto', { requerido: false, max: 160 });
        // R7: la pregunta de «Otro» cuando el rubro ya se conoce (solo «otro»), validada como `pregunta`.
        const preguntaDolor = texto('preguntaDolor', { requerido: false, max: 140 });
        // §13: el cierre del mensaje de planes (opcional, por rubro): hasta 2 oraciones y 160 caracteres; a lo más una «?» (el mensaje lleva una sola).
        const cierre = texto('cierre', { requerido: false, max: 160 });
        // §15: la orientación comercial por rubro (dato del tenant, no código): lo que hace el servicio (1 o 2 oraciones) y cómo funciona (1 oración).
        const queHacemos = texto('queHacemos', { requerido: false, max: 240 });
        const comoFunciona = texto('comoFunciona', { requerido: false, max: 160 });
        if (preguntaDolor && ((preguntaDolor.match(/\?/g) || []).length !== 1 || !preguntaDolor.endsWith('?'))) e(`${ruta}.preguntaDolor`, 'tiene que terminar en una sola «?»');
        if (preguntaDolor && id !== 'otro') e(`${ruta}.preguntaDolor`, 'solo lo lleva «otro»');
        if (dolor) {
          // §13: hasta 2 oraciones (la exclamación inicial cuenta: «¡Qué rico! 🍔 En gastronomía…»).
          if (contarTexto(dolor).oraciones > 2) e(`${ruta}.dolor`, 'tiene más de 2 oraciones (la exclamación inicial cuenta)');
          if (dolor.includes('?')) e(`${ruta}.dolor`, 'no lleva «?»: la pregunta es otro campo');
        }
        if (pregunta) {
          if ((pregunta.match(/\?/g) || []).length !== 1 || !pregunta.endsWith('?')) e(`${ruta}.pregunta`, 'tiene que terminar en una sola «?»');
          const junto = contarTexto([dolor, pregunta].filter(Boolean).join(' '));
          if (junto.oraciones > 3 || junto.palabras > 50) e(ruta, `dolor y pregunta juntos pasan de 3 oraciones o de 50 palabras (${junto.oraciones} oraciones, ${junto.palabras} palabras)`);
        }
        if (impacto) {
          const c = contarTexto(impacto);
          if (c.oraciones > 1) e(`${ruta}.impacto`, 'tiene que ser una sola oración');
          if (c.palabras > MAX_PALABRAS_IMPACTO) e(`${ruta}.impacto`, `tiene ${c.palabras} palabras (hasta ${MAX_PALABRAS_IMPACTO})`);
          if (/[?¿]/.test(impacto)) e(`${ruta}.impacto`, 'no lleva «?» ni «¿»');
        }
        // La orientación no promete ni cotiza: sin «?», sin precios (los arma el código desde la consola) y sin promesas de contacto («solo se ofrece lo que se cumple»).
        for (const [campo, valor, maxOraciones, maxPalabras] of [['queHacemos', queHacemos, 2, MAX_PALABRAS_QUE_HACEMOS], ['comoFunciona', comoFunciona, 1, MAX_PALABRAS_COMO_FUNCIONA]]) {
          if (!valor) continue;
          const c = contarTexto(valor);
          if (c.oraciones > maxOraciones) e(`${ruta}.${campo}`, `tiene ${c.oraciones} oraciones (hasta ${maxOraciones})`);
          if (c.palabras > maxPalabras) e(`${ruta}.${campo}`, `tiene ${c.palabras} palabras (hasta ${maxPalabras})`);
          if (/[?¿]/.test(valor)) e(`${ruta}.${campo}`, 'no lleva «?» ni «¿»');
        }
        if (cierre) {
          const c = contarTexto(cierre);
          if (c.oraciones > 2) e(`${ruta}.cierre`, 'tiene más de 2 oraciones');
          if ((cierre.match(/\?/g) || []).length > 1) e(`${ruta}.cierre`, 'lleva más de una «?»');
        }
      }
    }
  }

  // --- §18 (A1): el vocabulario cálido y general de la lista de permitidos de la explicación del modelo (obligatorio si algún rubro tiene `explicacion`).
  if (g) {
    const conExplicacion = g.rubros && typeof g.rubros === 'object' && Object.values(g.rubros).some((r) => r && typeof r === 'object' && r.explicacion !== undefined);
    const v = g.vocabulario;
    if (v === undefined) { if (conExplicacion) e('guion.vocabulario', 'falta: con `explicacion` por rubro, la lista de permitidos necesita su vocabulario cálido'); }
    else if (typeof v !== 'string' || v.length < 20 || v.length > 3000) e('guion.vocabulario', 'tiene que ser un texto de 20 a 3000 caracteres (palabras separadas por espacios)');
    else {
      const palabras = v.split(/\s+/).filter(Boolean);
      if (palabras.length > 450) e('guion.vocabulario', `tiene ${palabras.length} palabras (hasta 450)`);
      for (const w of palabras) {
        if (!/^\p{L}{2,20}$/u.test(w)) { e('guion.vocabulario', `«${w}» no es una palabra de 2 a 20 letras (sin dígitos ni signos)`); break; }
        const n = ccNorm(w);
        if (BLOQUEO_COMUN.test(n) || PROMESA.test(n) || OFERTA.test(n) || RAICES_DE_RIESGO.some((x) => n.startsWith(x))) { e('guion.vocabulario', `«${w}» no puede estar en el vocabulario: abre la puerta a una promesa, una oferta, un precio o una afirmación que el servicio no cumple`); break; }
      }
    }
  }

  // --- §16: los textos de precios y las respuestas fijas del documento comercial (opcionales; sin ellos, los textos neutros de la librería)
  if (g && g.precios !== undefined) {
    const p = g.precios;
    if (!p || typeof p !== 'object' || Array.isArray(p)) e('guion.precios', 'tiene que ser un objeto');
    else {
      for (const k of Object.keys(p)) if (!['estandar', 'detalleEstandar', 'aMedida', 'mensual', 'incluye', 'cierre'].includes(k)) e(`guion.precios.${k}`, 'no es un campo (estandar, detalleEstandar, aMedida, mensual, incluye, cierre)');
      for (const [k, max, requerido] of [['estandar', 40, true], ['detalleEstandar', 120, false], ['aMedida', 40, true], ['mensual', 40, true], ['incluye', 300, true], ['cierre', 200, false]]) {
        const v = p[k];
        if (v === undefined) { if (requerido) e(`guion.precios.${k}`, 'falta'); continue; }
        if (typeof v !== 'string' || v.length < 1 || v.length > max) { e(`guion.precios.${k}`, `tiene que ser un texto de 1 a ${max} caracteres`); continue; }
        const m = errorDeTextoDelGuion(v);
        if (m) e(`guion.precios.${k}`, m);
        else if (/\d/.test(v)) e(`guion.precios.${k}`, 'trae un número: los montos los pone el código desde la consola');
        else if (k !== 'cierre' && /[?¿]/.test(v)) e(`guion.precios.${k}`, 'no lleva «?» ni «¿»: el mensaje de planes lleva una sola, la del cierre');
      }
      if (typeof p.cierre === 'string' && ((p.cierre.match(/\?/g) || []).length !== 1 || !/\?[^?]*$/.test(p.cierre))) e('guion.precios.cierre', 'tiene que llevar una sola «?»');
    }
  }
  if (g && g.respuestas !== undefined) {
    const r = g.respuestas;
    if (!r || typeof r !== 'object' || Array.isArray(r)) e('guion.respuestas', 'tiene que ser un objeto');
    else {
      for (const k of Object.keys(r)) if (!['consumo', 'banco', 'integracion'].includes(k)) e(`guion.respuestas.${k}`, 'no es una respuesta fija (consumo, banco, integracion)');
      for (const k of ['consumo', 'banco', 'integracion']) {
        const v = r[k];
        if (v === undefined) continue;
        if (typeof v !== 'string' || v.length < 1 || v.length > 400) { e(`guion.respuestas.${k}`, 'tiene que ser un texto de 1 a 400 caracteres'); continue; }
        const m = errorDeTextoDelGuion(v, { sinAcredita: k === 'banco' });
        if (m) e(`guion.respuestas.${k}`, m);
        else if (/\d/.test(v)) e(`guion.respuestas.${k}`, 'trae un número: jamás se dan cifras de consumo ni de planes en una respuesta fija (documento comercial §5)');
        else if (/[?¿]/.test(v)) e(`guion.respuestas.${k}`, 'no lleva «?» ni «¿»: el código agrega la opción de hablar con el equipo');
        else if (contarTexto(v).oraciones > 2) e(`guion.respuestas.${k}`, 'tiene más de 2 oraciones (el código agrega la apertura y la invitación al equipo, y el mensaje tiene un límite)');
        else if (k === 'banco' && !(/\bno (?:lo |la |los |las )?(?:valida|verifica|confirma|comprueba|acredita)\w*/.test(ccNorm(v)) && /\bbanco\b/.test(ccNorm(v)))) e('guion.respuestas.banco', 'tiene que decir en forma NEGADA, con el «no» pegado al verbo, que no se valida con el banco («no lo valida con el banco»): es la prohibición 3');
        else if (k === 'banco' && ACREDITA_MODELO.test(ccNorm(v).replace(/\b(?:no (?:lo |la |los |las )?|quien )(?:valida|verifica|confirma|comprueba|acredita)\w*[^.!?]*/g, ' '))) e('guion.respuestas.banco', 'afirma, fuera de la parte negada, que el servicio valida, verifica o acredita pagos o transferencias, o que consulta al banco');
      }
    }
  }

  // --- el corpus
  const k = d.conocimiento && typeof d.conocimiento === 'object' ? d.conocimiento : null;
  if (!k) e('conocimiento', 'falta');
  else {
    if (typeof k.huella !== 'string' || !/^[a-f0-9]{64}$/.test(k.huella)) e('conocimiento.huella', 'tiene que ser un hash hexadecimal de 64 caracteres');
    if (typeof k.generado !== 'string' || Number.isNaN(Date.parse(k.generado))) e('conocimiento.generado', 'tiene que ser una fecha ISO');
    const frs = Array.isArray(k.fragmentos) ? k.fragmentos : null;
    const excl = Array.isArray(k.excluidos) ? k.excluidos : null;
    if (!frs) e('conocimiento.fragmentos', 'tiene que ser una lista');
    if (!excl) e('conocimiento.excluidos', 'tiene que ser una lista de ids');
    if (frs && excl) {
      const idsF = new Set();
      frs.forEach((f, i) => {
        const r = `conocimiento.fragmentos[${i}]`;
        if (!f || typeof f !== 'object' || Array.isArray(f)) { e(r, 'tiene que ser un objeto'); return; }
        if ('vector' in f) e(`${r}.vector`, 'no va: pesa cientos de KB y el flujo no lo usa');
        for (const c of ['id', 'titulo', 'url', 'texto']) if (typeof f[c] !== 'string' || !f[c]) e(`${r}.${c}`, 'tiene que ser un texto no vacío');
        if (typeof f.id === 'string') { if (idsF.has(f.id)) e(`${r}.id`, `«${f.id}» está repetido`); idsF.add(f.id); }
        if (typeof f.texto === 'string' && /<<<|>>>/.test(f.texto + (f.titulo || ''))) e(`${r}.texto`, 'trae «<<<» o «>>>» (los delimitadores del mensaje del cliente)');
      });
      for (const x of excl) if (typeof x !== 'string' || !idsF.has(x)) e('conocimiento.excluidos', `nombra «${x}», que no es un fragmento`);
      const incluidos = frs.filter((f) => f && typeof f.id === 'string' && !excl.includes(f.id));
      const largo = incluidos.reduce((n, f) => n + String(f.titulo || '').length + String(f.texto || '').length + 8, 0);
      if (largo > 40000) e('conocimiento', `los fragmentos incluidos suman ${largo} caracteres (hasta 40.000)`);
      for (const f of incluidos) {
        if (PRECIO.test(String(f.texto || '')) || PRECIO.test(String(f.titulo || ''))) e('conocimiento.fragmentos', `«${f.id}» está incluido y trae un precio: va en «excluidos» (los precios tienen una sola fuente, la consola)`);
        // §18 (B1): ni un tope numérico (el modelo lo repetiría: «hasta 25 respuestas», «300 contactos»): los topes los muestra la imagen de planes.
        if (CIFRA_DE_CONSUMO.test(ccNorm(`${f.titulo || ''} ${f.texto || ''}`))) e('conocimiento.fragmentos', `«${f.id}» está incluido y trae una cifra de consumo o de capacidad: va en «excluidos» (los topes los muestra la imagen de planes)`);
      }
    }
  }
  if (errores.length) throw new Error(`${archivo}: datos no válidos: ${errores.join('; ')}`);
}

// ----------------------------------------------------------------- los datos dentro de la plantilla
// Los datos del tenant se meten dentro de textos y expresiones de nodos (`@@dato:…@@`): un valor con una comilla, una barra
// invertida, una llave o un salto de línea podría cerrar la cadena y agregar código. `dato()` los rechaza.
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;
function dato(datos, ruta, donde) {
  let x = datos;
  for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
  if (typeof x !== 'string' || x === '') throw new Error(`${donde}: falta el dato «${ruta}» en el archivo del tenant`);
  if (CARACTERES_PELIGROSOS.test(x) && !ruta.startsWith('credenciales.') && ruta !== 'nombreFlujo') {
    throw new Error(`${donde}: el dato «${ruta}» trae una comilla, una barra invertida, una llave o un salto de línea`);
  }
  return x;
}
function reemplazarTextos(valor, datos, donde) {
  if (typeof valor === 'string') return valor.replace(/@@dato:([A-Za-z0-9_.]+)@@/g, (_, ruta) => dato(datos, ruta, donde));
  if (Array.isArray(valor)) return valor.map((v) => reemplazarTextos(v, datos, donde));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, reemplazarTextos(v, datos, donde)]));
  return valor;
}
function asignaciones(configBase) {
  return Object.entries(configBase).map(([nombre, valor]) => {
    if (!['string', 'number', 'boolean'].includes(typeof valor)) throw new Error(`configBase.${nombre}: solo texto, número o booleano`);
    return { id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor };
  });
}

/**
 * Reemplaza UNA línea marcadora por `const <nombre> = <literal>;` en el código de los nodos de un flujo armado. La línea tiene
 * que aparecer exactamente una vez en TODO el flujo: 0 o 2 apariciones es un error (un nodo sin corpus, o dos con él).
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
// Una URL por expresión (`={{ … }}`) solo vale para dos nodos: la descarga del medio (la URL que devuelve Meta) y el CRM.
const URL_POR_EXPRESION = { 'Descargar medio': '={{ $json.url }}', 'Guardar prospecto': '={{ $json.crmUrl }}' };
export function anfitrionPermitido(nombreDelNodo, url) {
  if (/^REEMPLAZAR_[A-Z0-9_]+$/.test(url)) return true;
  if (URL_POR_EXPRESION[nombreDelNodo] === url) return true;
  // El «anfitrión» es todo lo que va entre «https://» y la primera barra, `?` o `#`: con un usuario (arroba) o un puerto,
  // no es un anfitrión permitido.
  const m = /^=?https:\/\/([^/?#\s]*)/i.exec(url);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return false;
  return ANFITRIONES.includes(m[1].toLowerCase());
}

/**
 * Lo que un JSON de este flujo no puede tener, aunque alguien lo haya agregado a mano al archivo versionado. Devuelve la lista
 * de hallazgos (vacía si está limpio). `entrada`: 'trigger' | 'prueba'.
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
  // Sin agente, sin memoria de conversación y sin modelo de chat: el flujo no tiene agente.
  for (const n of nodos) {
    if (/langchain\.(agent|memoryBufferWindow|lmChat\w*)$/i.test(String(n.type))) h.push(`el nodo «${n.name}» es de tipo ${n.type}: este flujo no lleva agente, memoria ni modelo de chat`);
  }
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

/** Los `captacion-minima.*.json` de `dirFlujo` que ya no tienen archivo de datos (salvo los `*.local.json`, que no se versionan). */
export function huerfanos(dirFlujo = AQUI, dirDatos = DATOS) {
  const salidas = new Set(archivosDeDatos(dirDatos).map(salidaDe));
  return readdirSync(dirFlujo).filter((f) => /^captacion-minima\..+\.json$/.test(f) && !/\.local\.json$/.test(f) && !salidas.has(f));
}

// ----------------------------------------------------------------- armar
const sinMarcas = (v, esCodigo) => {
  if (typeof v === 'string') return esCodigo ? !v.startsWith('@@') : !v.includes('@@');
  if (Array.isArray(v)) return v.every((x) => sinMarcas(x, false));
  if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => sinMarcas(x, k === 'jsCode'));
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
      const m = /^@@cred:(trigger|ingesta|graph|planilla|crm|entradaPrueba)$/.exec(String(c.name));
      if (m) c.name = dato(datos, `credenciales.${m[1]}`, `${archivo} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
  }
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: salidaDe(archivo), nombre: dato(datos, 'nombreFlujo', archivo), quitar: [] });
  const flujo = JSON.parse(texto);
  inyectar(flujo, MARCA_GUION, 'CM_GUION', datos.guion);
  inyectar(flujo, MARCA_CONOCIMIENTO, 'CM_CONOCIMIENTO', datos.conocimiento);
  const final = JSON.stringify(flujo, null, 2) + '\n';
  // Una marca sin reemplazar: en cualquier texto salvo el código de los nodos (las librerías mencionan «@@solo:» en un
  // comentario) o, en el código, al principio del `jsCode`.
  if (!sinMarcas(flujo, false)) throw new Error(`${archivo}: quedó una marca @@ sin reemplazar`);
  return final;
}

/**
 * Arma (o verifica) todos los JSON. Devuelve un resultado por archivo de datos y los huérfanos; lanza ante un dato inválido,
 * una guardia violada en lo armado o una plantilla que falta. Con `verificar` no escribe.
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
  let proyecto;
  try {
    proyecto = leerProyecto(carpeta, { ...config, variantes: todos.map((t) => ({ archivo: salidaDe(t.archivo), nombre: t.datos.nombreFlujo })) }, tope ? { tope } : {});
  } catch (e) {
    if (e instanceof Error && /^plantilla: no existe/.test(e.message)) {
      throw new Error(`falta ${config.plantilla || 'flujo.plantilla.json'} en ${carpeta}: la plantilla y los nodos de código son de la Fase 2 del contrato (§3 y §8)`);
    }
    throw e;
  }
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
      try { versionado = guardias(datos.entrada, JSON.parse(actual), datos); } catch (e) { versionado = ['no es un JSON válido']; }
    }
    if (!verificar) escribirSinSeguirEnlaces(ruta, texto, salida);
    const nodos = JSON.parse(texto).nodes.length;
    return { archivo: salida, datos: archivo, nodos, existia: actual !== null, alDia: actual === texto, versionado };
  });
  return { resultado, huerfanos: huerfanos(carpeta, dirDatos) };
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verificar = process.argv.includes('--verificar');
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
        console.error(`✗ ${f} ya no tiene archivo de datos en admin/scripts/datos/captacion-minima/ (¿se borró o se renombró?): bórrelo o devuelva su archivo de datos`);
      }
    }
    process.exit(difiere ? 1 : 0);
  } catch (e) {
    // Un mensaje, no una traza: lo que falla es un dato, un archivo o una guardia, y el mensaje nombra cuál.
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
