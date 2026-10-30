#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de «captación con derivación a recepción» de las doctoras (tenants rroca-evy y rroca-emma) desde UNA plantilla y los datos de cada una
 * =============================================================================
 *
 *   node Flujos/experimental/doctoras/construir.mjs               escribe doctoras.<tenant>.json y doctoras.<tenant>.prueba.json de cada tenant con datos
 *   node Flujos/experimental/doctoras/construir.mjs --verificar   no escribe: sale 1 si un JSON versionado difiere de lo que se arma o viola una guardia
 *   node Flujos/experimental/doctoras/construir.mjs --publicable [--tenant <t>] [--flujo <json>] [--datos <json>] [--negocio <json>] [--etapa crear|prueba|encender]
 *                                                       no escribe: sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal (sin --tenant revisa los de todas las doctoras)
 *   (cualquier otro argumento se rechaza: la ayuda no existe como opción, para que nada escriba por error)
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos: UN código para las dos doctoras. El código de los nodos lo arma el armador genérico
 * `../comun-sin-agente/construir.mjs` (importado, no copiado) con el `CONFIG` de este archivo. Cada tenant tiene su archivo de datos
 * `admin/scripts/datos/doctoras/<tenant>.json` (zona Tenants: solo datos y marcadores `REEMPLAZAR_*`, nunca código ni un token) y de él salen DOS JSON: producción y prueba.
 *
 *   - `@@dato:a.b.c@@` (en cualquier texto de la plantilla) por ese dato; `@@cred:ingesta|graph|entradaPrueba|gemini` (nombre de credencial) por el del archivo de datos;
 *   - `@@medio:<paquete>`: los tres módulos comunes de medios (`Flujos/src/core/medios/*.js`) se INCLUYEN desde su fuente, nunca se copian;
 *   - «Config base» se llena con `configBase` (texto, número o booleano) y el bloque `doctora` como UN texto JSON (lo lee `drDatos`);
 *   - LA CADENA DE ENVÍO es común (`../comun-sin-agente/src/envio.mjs`, `injertar()`), con las credenciales por NOMBRE; la «puerta de la entrega» `¿Meta aceptó?` solo reencamina una conexión;
 *   - dos variantes por tenant: PRODUCCIÓN (con la entrada verificada del receptor y sin «Entrada de prueba») y PRUEBA (al revés).
 *
 * LAS GUARDIAS de lo armado (también se aplican al archivo versionado, aunque alguien lo haya tocado a mano):
 *   - ≤ 48 nodos; nunca un WhatsApp Trigger (prohibición 7); nunca `subscriptions` ni `subscribed_apps`; ni agente, ni memoria, ni modelo de chat de n8n;
 *   - producción: solo el webhook del receptor, sin «Entrada de prueba»; prueba: solo «Entrada de prueba» (con credencial de cabecera) y sin receptor;
 *   - la verificación del receptor: `wabaIdEsperado` FIJO (nunca una expresión), sin «Continue on Fail» ni `onError`, y «Descartar repetidos» entre ejecuciones;
 *   - un nodo HTTP solo habla con Meta, Gemini y las Functions de la consola; `REEMPLAZAR_*` solo donde se declara; ajustes de retención, orden y zona;
 *   - «Reportar mensaje (entrante)» va ARRIBA de la rama que responde (el reporte del entrante corre antes que el de la respuesta).
 */
import { closeSync, constants, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
import { injertar } from '../comun-sin-agente/src/envio.mjs';
import { hallazgosDelGuardado, injertarGuardado, NODOS_DE_INGESTA_DEL_GUARDADO, URL_DESCARGA_GUARDADO } from '../comun-sin-agente/src/guardado.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const CARPETA_DE_DATOS = join(AQUI, '../../../admin/scripts/datos/doctoras');
// 48 + los 11 de la rama común del GUARDADO de medios (Flujos/experimental/comun-sin-agente/src/guardado.mjs, contrato M1↔M2 del 29/10/2026).
export const TOPE_DE_NODOS = 59;
/** Los tenants con archivo de datos (`<tenant>.json`, sin los `negocio-*.json`): hoy las dos doctoras. */
export function tenantsConDatos(carpeta = CARPETA_DE_DATOS) {
  return readdirSync(carpeta).filter((a) => /^rroca-[a-z0-9-]+\.json$/.test(a)).map((a) => a.replace(/\.json$/, '')).sort();
}
export const archivoDeDatos = (tenant) => join(CARPETA_DE_DATOS, `${tenant}.json`);
export const archivoDeNegocio = (tenant) => join(CARPETA_DE_DATOS, `negocio-${tenant}.json`);
export const nombreDeFlujo = (tenant, prueba) => `doctoras.${tenant}${prueba ? '.prueba' : ''}.json`;

/**
 * El config del armador genérico. Vive aquí y no en un `construir.config.json`: el saneo del repo público trata todo JSON bajo `Flujos/` como un export de n8n.
 * `raiz` es `Flujos/`: de ahí se leen los módulos comunes de medios. Las variantes salen de los tenants con datos.
 */
export function configDe(tenants = tenantsConDatos()) {
  return {
    plantilla: 'flujo.plantilla.json',
    raiz: '../..',
    librerias: ['../venta-minima/src/lib/avisos.js', 'src/lib/dr.js'],
    comun: ['src/nodos/_comun.js'],
    paquetes: {
      mensajes: ['../comun-sin-agente/src/mensajes.js'],
      filtro: ['../comun-sin-agente/src/filtro-redaccion.js'],
      'm-transcripcion': ['../../src/core/medios/preparar-transcripcion.js'],
      'm-imagen': ['../../src/core/medios/anuncio-por-titular.js', '../../src/core/medios/preparar-imagen.js'],
      'm-no-aceptado': ['../../src/core/medios/medio-no-aceptado.js'],
    },
    variantes: tenants.flatMap((t) => [
      { archivo: nombreDeFlujo(t, false), quitar: 'Entrada de prueba', nombre: 'se toma de los datos' },
      { archivo: nombreDeFlujo(t, true), quitar: ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'], nombre: 'se toma de los datos' },
    ]),
  };
}

/** La conversación: el modelo que clasifica y el aviso a recepción. La guardia los exige (sin el aviso, los textos que dicen «ya avisé» no tendrían respaldo). */
export const NODOS_DEL_AVISO = ['Armar avisos', '¿Hay avisos?', 'Enviar aviso'];
export const NODOS_DE_LA_CONVERSACION = ['¿Conversar con el modelo?', 'Conversar con el modelo', '¿Falló la protección?', 'Reportar protección'];

/** Los nodos que los módulos comunes de medios leen por contrato (los exige `--verificar`). */
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
  // La etapa de prueba: `si` la enciende; vacío o el marcador la dejan apagada (`Config del negocio` solo reconoce `si`).
  etapaPrueba: /^(si|REEMPLAZAR_[A-Z0-9_]+)?$/,
  // El ÚNICO modelo de este flujo (decisión de Andres): gemini-3.5-flash-lite.
  modelo: /^gemini-3\.5-flash-lite$/,
  temperatura: /^(0|1|0\.\d{1,2})$/,
  // La plantilla UTILITY del aviso a recepción. El estado es el de Meta: solo APPROVED habilita el aviso fuera de la ventana de la recepción; el nombre puede ser un marcador mientras no exista.
  avisoSolicitudPlantilla: /^([a-z0-9_]{1,100}|REEMPLAZAR_[A-Z0-9_]+)$/,
  avisoSolicitudEstado: /^(APPROVED|PENDING|REJECTED|PAUSED|DISABLED|IN_APPEAL)$/,
  avisoPlantillaIdioma: /^[a-z]{2,3}(_[A-Z]{2})?$/,
};
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;

/** Las palabras que NINGÚN texto de la doctora puede llevar (salvedades 1, 2, 6 y 15 del plan): promesa de resultado, «ideal para», precio, enlaces. Las comprueba el armado y el runtime (`drSeguro`). */
export const PALABRAS_PROHIBIDAS = /inmediat|primera sesi|firmeza|ideal para|garantiz|como la foto|lifting|\b250\b|\bbs\b|bolivianos|\$|https?:|www\.|wa\.me|maps|google|(?:^|[^\p{L}])\d+\s*(?:usd|dolares)/iu;

const lleno = (v) => typeof v === 'string' && v.trim() !== '';
const textoSinMarcas = (v) => !/@@/.test(String(v)) && !/\{\{/.test(String(v));

/** Valida el bloque `doctora`. Devuelve la lista de errores (cada uno nombra el campo). Un texto de contenido puede llevar `{nombre}`, `{doctora}`, `{clinica}`, `{direccion}` y `{horario}`. */
export function erroresDeDoctora(d) {
  const e = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['doctora: falta el bloque'];
  const cadena = (ruta, v, { max = 400, vacio = false } = {}) => {
    if (typeof v !== 'string' || (!vacio && v.trim() === '')) e.push(`${ruta}: falta`);
    else if (v.length > max) e.push(`${ruta}: más de ${max} caracteres`);
    else if (!textoSinMarcas(v)) e.push(`${ruta}: no puede llevar «@@» ni «{{»`);
    else if (PALABRAS_PROHIBIDAS.test(v.normalize('NFD').replace(/[̀-ͯ]/g, ''))) e.push(`${ruta}: lleva una palabra que ningún texto de la doctora puede decir (promesa de resultado, «ideal para», precio, enlace)`);
  };
  for (const c of ['nombreCorto', 'nombreCompleto', 'clinica', 'especialidad']) cadena(`doctora.${c}`, d[c], { max: 200 });
  // La dirección vive en la Consola (`negocio.direccion` → `/config/negocio`): el flujo la lee de «Config del negocio». Duplicarla aquí sería incrustar lo vivo (regla de Andres, 22/10/2026).
  if ('direccion' in d) e.push('doctora.direccion: la dirección se lee de la Consola (negocio.direccion); no se incrusta en el flujo');
  // El horario puede estar vacío o ser un marcador: la doctora aún no lo dio y el flujo no dice ninguno. `horarioPorConfirmar: true` = hay un horario cargado pero la doctora no lo confirmó: el flujo se arma, la guardia --publicable NO deja publicar.
  if (d.horario !== undefined) cadena('doctora.horario', d.horario, { max: 200, vacio: true });
  if ('horarioPorConfirmar' in d && typeof d.horarioPorConfirmar !== 'boolean') e.push('doctora.horarioPorConfirmar: tiene que ser true o false');
  const ids = new Set();
  if (!Array.isArray(d.tratamientos) || d.tratamientos.length < 1 || d.tratamientos.length > 6) e.push('doctora.tratamientos: de 1 a 6');
  else {
    d.tratamientos.forEach((t, i) => {
      const r = `doctora.tratamientos[${i}]`;
      if (!t || typeof t !== 'object') { e.push(`${r}: tiene que ser un objeto`); return; }
      if (!/^[a-z0-9]{1,12}$/.test(String(t.id))) e.push(`${r}.id: de 1 a 12 minúsculas o dígitos`);
      if (ids.has(t.id)) e.push(`${r}.id: repetido`);
      ids.add(t.id);
      cadena(`${r}.nombre`, t.nombre, { max: 24 });
      cadena(`${r}.frase`, t.frase, { max: 400 });
      if (!Array.isArray(t.claves) || !t.claves.length || !t.claves.every((c) => typeof c === 'string' && /^[a-z0-9 ]{3,40}$/.test(c))) e.push(`${r}.claves: lista de palabras en minúsculas sin acentos ni signos`);
    });
  }
  for (const lista of ['artes', 'prellenados']) {
    if (!Array.isArray(d[lista]) || d[lista].length > 8) { e.push(`doctora.${lista}: lista de 0 a 8`); continue; }
    d[lista].forEach((a, i) => {
      const r = `doctora.${lista}[${i}]`;
      if (!a || typeof a !== 'object') { e.push(`${r}: tiene que ser un objeto`); return; }
      if (!/^[a-z0-9]{1,16}$/.test(String(a.id))) e.push(`${r}.id: de 1 a 16 minúsculas o dígitos`);
      if (!Array.isArray(a.claves) || !a.claves.length || !a.claves.every((c) => typeof c === 'string' && /^[a-z0-9 ]{3,60}$/.test(c))) e.push(`${r}.claves: lista de frases en minúsculas sin acentos ni signos`);
      // Ningún arte se envía por el asistente (decisión por defecto, P3): el arte comparativo trae «efecto lifting inmediato».
      if ('soloImagen' in a && typeof a.soloImagen !== 'boolean') e.push(`${r}.soloImagen: tiene que ser true o false`);
      if (lista === 'artes' && a.enviable !== false) e.push(`${r}.enviable: tiene que ser false (el asistente no envía artes; lo decide la doctora por escrito)`);
      cadena(`${r}.apertura`, a.apertura, { max: 300, vacio: true });
    });
  }
  const t = d.textos;
  if (!t || typeof t !== 'object' || Array.isArray(t)) e.push('doctora.textos: falta');
  else {
    for (const c of TEXTOS_DE_CONTENIDO) cadena(`doctora.textos.${c}`, t[c], { max: 700 });
    for (const c of Object.keys(t)) if (!TEXTOS_DE_CONTENIDO.includes(c) && !TEXTOS_COMUNES_PERMITIDOS.includes(c)) e.push(`doctora.textos.${c}: clave desconocida`);
    for (const c of TEXTOS_COMUNES_PERMITIDOS) if (c in t) cadena(`doctora.textos.${c}`, t[c], { max: 700 });
  }
  return e;
}
/** Los textos de CONTENIDO que cada doctora aporta (las claves que `Decidir turno` y `Armar mensajes` leen del dato). */
export const TEXTOS_DE_CONTENIDO = ['apertura', 'pregunta', 'lista_intro', 'quien', 'que_es', 'gratis', 'precio', 'sin_compromiso', 'donde', 'cual_mejor', 'diferencia', 'dolor', 'resultados', 'antes_despues', 'recuperacion', 'artificial', 'probe_otros', 'pensar', 'especifico'];
/** Los textos de estructura que son COMUNES (están en `dr.js`) y que una doctora puede reemplazar si lo pide por escrito. */
export const TEXTOS_COMUNES_PERMITIDOS = ['presentacion', 'baja_instruccion', 'consentimiento', 'consentimiento_no', 'pedir_nombre', 'nombre_repetir', 'pedir_contacto', 'pedir_otro_numero', 'pedir_horario', 'pedir_horario_con', 'cierre_con_aviso', 'cierre_sin_aviso', 'ya_derivado', 'medica', 'medica_con_aviso', 'medica_documento', 'ia', 'baja_ok', 'otra', 'otra_con_aviso', 'gracias', 'duda', 'horario_con', 'horario_sin', 'donde_sin', 'cancelar_ok'];

/** Lee y valida el archivo de datos de UN tenant. Cada error nombra el campo. */
export function cargarDatos(ruta) {
  const texto = leerSiExiste(ruta, 'archivo de datos');
  if (texto === null) throw new Error(`no existe el archivo de datos ${ruta}`);
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error('archivo de datos: no es un JSON válido'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('archivo de datos: tiene que ser un objeto');
  const errores = [];
  const cadena = (ruta2, v) => { if (typeof v !== 'string' || v.trim() === '') errores.push(`${ruta2}: falta`); };
  cadena('tenant', d.tenant);
  if (typeof d.tenant === 'string' && !/^rroca-[a-z0-9-]+$/.test(d.tenant)) errores.push('tenant: forma no válida');
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
      if (c === 'doctora') errores.push('configBase.doctora: el bloque va en `doctora`, no en `configBase`');
    }
    for (const c of ['phoneNumberIdEsperado', 'numeroRecepcion', 'nombreNegocio', 'tenantId']) if (cb[c] === undefined || cb[c] === '') errores.push(`configBase.${c}: falta`);
    // El flujo solo cree a la Consola si responde por ESTE tenant: la dirección y el horario de otra doctora nunca se dicen (multi-tenant estricto).
    if (cb.tenantId !== undefined && cb.tenantId !== d.tenant) errores.push('configBase.tenantId: tiene que ser el tenant de este archivo');
  }
  errores.push(...erroresDeDoctora(d.doctora));
  if (errores.length) throw new Error(`${d.tenant || 'archivo de datos'}: datos no válidos: ${errores.join('; ')}`);
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
/** «Config base»: los valores de `configBase` más el bloque `doctora` como UN texto JSON (lo lee `drDatos`). */
const asignaciones = (datos) => {
  const todo = { ...datos.configBase, doctora: JSON.stringify(datos.doctora) };
  return Object.entries(todo).map(([nombre, valor]) => ({ id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor }));
};

// ----------------------------------------------------------------- las guardias de lo armado
export function anfitrionPermitido(url, nombreDelNodo = '') {
  if (MARCADOR.test(url)) return true;
  // La única excepción: «Descargar medio» baja el medio de la URL que le devuelve Meta (la anterior, «¿Tamaño aceptable?», exige https://lookaside.fbsbx.com/ y un tamaño).
  if (nombreDelNodo === 'Descargar medio' && url === '={{ $json.url }}') return true;
  // La descarga del GUARDADO: la URL del CDN de Meta solo si el tamaño que informó Meta cabe (la expresión exacta del módulo común).
  if (nombreDelNodo === 'Descargar medio (guardado)' && url === URL_DESCARGA_GUARDADO) return true;
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
  // El GUARDADO de medios (obligatorio en todo flujo con medios): la rama común completa, en su lugar y con las credenciales correctas.
  h.push(...hallazgosDelGuardado(flujo || {}));
  if (nodos.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')) h.push('contiene un WhatsApp Trigger (prohibición 7: reescribe el webhook de toda la app)');
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) h.push('menciona «subscriptions» o «subscribed_apps» (prohibición 7)');
  if (/langchain\.(agent|memory\w*|lmChat\w*|chain\w*)$/i.test(nodos.map((n) => n.type).join('\n'))) h.push('lleva un agente, memoria o modelo de chat de n8n: este flujo no los lleva');
  // La conversación completa: el modelo que clasifica y el aviso a recepción. Sin el aviso, los textos que dicen «ya avisé» no tendrían respaldo («solo se ofrece lo que se cumple»).
  for (const n of [...NODOS_DE_LA_CONVERSACION, ...NODOS_DEL_AVISO]) if (!nombres.has(n)) h.push(`falta el nodo «${n}» de la conversación`);
  const conex = (flujo && flujo.connections) || {};
  const destinosDe = (nombre, salida) => (((conex[nombre] || {}).main || [])[salida] || []).map((x) => x.node);
  if (nombres.has('Armar avisos') && !destinosDe('Armar avisos', 0).includes('¿Hay avisos?')) h.push('«Armar avisos» no está conectado a «¿Hay avisos?»');
  if (nombres.has('¿Hay avisos?') && !destinosDe('¿Hay avisos?', 0).includes('Enviar aviso')) h.push('«¿Hay avisos?» no envía por «Enviar aviso»');
  if (nombres.has('Enviar aviso') && !destinosDe('Enviar aviso', 0).includes('Armar mensajes')) h.push('«Enviar aviso» no cuelga de «Armar mensajes»: el aviso tiene que correr ANTES de armar el mensaje que dice si salió');
  if (nombres.has('¿Hay avisos?') && !destinosDe('¿Hay avisos?', 1).includes('Armar mensajes')) h.push('«¿Hay avisos?» no envía la rama sin aviso (salida 1) a «Armar mensajes»');
  const enviarAviso = por('Enviar aviso');
  if (enviarAviso && !((enviarAviso.credentials || {}).httpHeaderAuth || {}).name) h.push('«Enviar aviso» no lleva credencial (httpHeaderAuth)');
  if (enviarAviso && enviarAviso.onError !== 'continueRegularOutput') h.push('«Enviar aviso» no lleva `onError: continueRegularOutput`: si Meta lo rechaza, el turno se cortaría y la persona quedaría sin respuesta');
  const codigoAvisos = String(p(por('Armar avisos')).jsCode || '');
  if (nombres.has('Armar avisos') && !(/drPlantilla\(/.test(codigoAvisos) && /avPlantilla\(/.test(codigoAvisos) && /DR_VENTANA_RECEPCION_MS/.test(codigoAvisos) && /consentimiento === 'si'/.test(codigoAvisos))) h.push('«Armar avisos» no lleva la plantilla, la ventana de la recepción ni el consentimiento: el aviso fuera de las 24 h no saldría o saldría sin permiso');
  const modelo = por('Conversar con el modelo');
  if (modelo && !/^=?https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//.test(String(p(modelo).url || ''))) h.push('«Conversar con el modelo» no llama a Gemini');
  // Los nodos de medios comunes tienen que estar, con los nombres que esos módulos leen por contrato.
  for (const n of NODOS_CONTRATO_MEDIOS) if (!nombres.has(n)) h.push(`falta el nodo «${n}» (contrato con los módulos comunes de medios)`);
  // El reporte del entrante corre ANTES que la rama que responde: «Reportar mensaje (entrante)» arriba de la «Puerta del turno» y de toda la rama de medios y de decisión.
  const rep = por('Reportar mensaje (entrante)');
  if (rep) {
    for (const n of nodos) {
      if (['Puerta del turno', '¿Bajar medio?', 'Obtener URL del medio (general)', 'Decidir turno', 'Armar mensajes'].includes(n.name) && !(rep.position[1] < n.position[1])) h.push(`«Reportar mensaje (entrante)» tiene que ir arriba de «${n.name}» en el lienzo`);
    }
  }
  // El reporte saliente lleva el evento de baja o de protección (`no_contactar`) siempre, aunque salga el respaldo.
  const repSal = por('Reportar mensaje (saliente)');
  if (repSal && !/no_contactar/.test(String(p(repSal).jsonBody || ''))) h.push('«Reportar mensaje (saliente)» no reporta el evento `no_contactar` (condición dura de la baja y de la protección)');
  // El reporte del entrante lleva `no_contactar` por la baja o el riesgo escritos (una sola expresión: la de dr.js).
  if (rep && !(/bajaEscrita === true/.test(String(p(rep).jsonBody || '')) && /riesgoEscrito === true/.test(String(p(rep).jsonBody || '')))) h.push('«Reportar mensaje (entrante)» no reporta `no_contactar` por la baja ni por el riesgo escritos');
  // La variante de PRUEBA nunca usa credenciales de producción: ni la de Graph ni la de Gemini (los nodos de medios, el aviso, el envío y el modelo).
  if (variante === 'prueba') {
    for (const n of nodos) {
      for (const [tipo, c] of Object.entries(n.credentials || {})) {
        const nombreCred = String((c || {}).name || '');
        if ((tipo === 'googlePalmApi' && !/pruebas/i.test(nombreCred)) || (n.name !== NODO_PRUEBA && n.name !== 'Traer configuración' && n.name !== 'Reportar mensaje (entrante)' && n.name !== 'Reportar mensaje (saliente)' && n.name !== 'Reportar protección' && !NODOS_DE_INGESTA_DEL_GUARDADO.includes(n.name) && tipo === 'httpHeaderAuth' && !/pruebas/i.test(nombreCred))) {
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
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'none' || st.saveExecutionProgress !== false) h.push('los ajustes de retención deben ser saveDataSuccessExecution «none», saveDataErrorExecution «none» (datos de salud: no se guardan ni los turnos fallidos) y saveExecutionProgress false');
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
 * El JSON versionado es técnicamente armable pero NO debe llegar a n8n con marcadores `REEMPLAZAR_*` (rutas, ids de Meta, número de recepción, horario), con una plantilla de aviso que Meta no aprobó, con
 * la rama de medios incompleta ni sin la dirección. Esto NO es una guardia del armado (el JSON versionado lleva marcadores a propósito: el repositorio es público): es la de PUBLICAR, y se corre sobre lo que
 * se va a escribir (el versionado, el `.local.json` o el flujo VIVO), por doctora. Los mensajes nombran claves, marcadores y nodos; NUNCA imprimen valores de los datos ni fragmentos del flujo.
 *   flujo    el JSON a publicar;   datos  `<tenant>.json` (`configBase` y `doctora`);   negocio  `negocio-<tenant>.json` (los marcadores del negocio).
 * Devuelve la lista de hallazgos (vacía si se puede publicar).
 */
// Un marcador es CUALQUIER `REEMPLAZAR_` (sin distinguir mayúsculas, tras normalizar a NFKC). Se quitan antes de mirar SOLO las formas que son texto de comentario de los módulos copiados
// (`REEMPLAZAR_*`, `REEMPLAZAR_…`, `REEMPLAZAR_...`, `REEMPLAZAR_` entre comillas invertidas) y los literales de expresión regular `/^REEMPLAZAR_/` y `/reemplazar_/i` con los que el código descarta marcadores.
const MARCADOR_CRUDO = /reemplazar_/i;
const sinComentarios = (t) => String(t).normalize('NFKC').replace(/\/\^?REEMPLAZAR_\/i?/gi, '').replace(/REEMPLAZAR_(?:\*|…|\.\.\.)/gi, '').replace(/`REEMPLAZAR_`/gi, '');
const hayMarcador = (t) => MARCADOR_CRUDO.test(sinComentarios(t));
const VALOR_LLENO = (v) => typeof v === 'string' && v.trim() !== '' && !hayMarcador(v);
const marcasEn = (v) => (sinComentarios(JSON.stringify(v) || '').match(/reemplazar_[a-z0-9_-]*/gi) || []);

// Etapas de la guardia: `encender` (la completa, por defecto) y `crear` (solo para CREAR un flujo INACTIVO: WAM necesita su URL de entrada). La etapa `crear` tolera exactamente dos cosas (el marcador solo en los datos de rroca-evy): el estado de la plantilla distinto
// de APPROVED y el horario pendiente (el marcador del horario de Evy; `horarioPorConfirmar: true` de Emma). Todo lo demás se exige igual: marcadores, identidad, credenciales y los tres medios.
// La etapa `prueba` (flujo ENCENDIDO en modo prueba: solo atiende a `telefonosDePrueba`) tolera lo mismo que `crear` (plantilla sin APPROVED y horario pendiente) PERO exige tres cosas: `etapaPrueba = si`, `telefonosDePrueba` lleno y
// válido y `numeroRecepcion` dentro de esos teléfonos (el aviso de la prueba nunca llega a la recepción real). Al revés, la etapa completa (`encender`) RECHAZA `etapaPrueba = si`: un flujo en modo prueba ignora a todo cliente.
export const ETAPAS = ['crear', 'prueba', 'encender'];
const soloDigitos = (v) => String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
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
  // Cada teléfono de prueba y la recepción tienen que empezar con uno de los prefijos permitidos del negocio (un número local sin prefijo no es un destino válido de WhatsApp).
  const prefijos = String(enFlujo.prefijosPermitidos || '591').split(',').map((x) => soloDigitos(x)).filter((x) => x !== '');
  const sinPrefijo = (x) => !prefijos.some((p) => soloDigitos(x).startsWith(p));
  if (validos && lista.some(sinPrefijo)) h.push('Config base: la etapa prueba exige que cada teléfono de telefonosDePrueba empiece con uno de los prefijosPermitidos');
  if (/^\d{6,20}$/.test(rec) && sinPrefijo(rec)) h.push('Config base: la etapa prueba exige que numeroRecepcion empiece con uno de los prefijosPermitidos');
  return h;
}

function hallazgosDeConfig(cb, donde, etapa = 'encender') {
  const h = [];
  if (!cb || typeof cb !== 'object') return [`${donde}: no trae la configuración base`];
  if (etapa === 'encender' && cb.avisoSolicitudEstado !== 'APPROVED') h.push(`${donde}: avisoSolicitudEstado es ${cb.avisoSolicitudEstado === undefined ? '«ausente»' : '(distinto de APPROVED)'} y tiene que ser APPROVED (Meta aún no aprobó la plantilla)`);
  if (!VALOR_LLENO(cb.avisoSolicitudPlantilla)) h.push(`${donde}: falta el nombre de la plantilla (avisoSolicitudPlantilla)`);
  if (!VALOR_LLENO(cb.avisoPlantillaIdioma)) h.push(`${donde}: falta el idioma de la plantilla (avisoPlantillaIdioma)`);
  return h;
}

/** Lo que cada doctora tiene que traer lleno para publicar: la dirección y el horario (si no, el flujo no podría decirlos) y el número de recepción. Los textos de contenido ya los exige `cargarDatos`. */
function hallazgosDeLaDoctora(datos, etapa = 'encender', negocio = null) {
  const h = [];
  const d = datos && datos.doctora;
  if (!d || typeof d !== 'object') return ['datos: no trae el bloque `doctora`'];
  // El horario sale de la Consola (`negocio.horarios`) o, si la Consola no lo admite (turno partido), del respaldo `doctora.horario`: basta uno de los dos.
  const hs = negocio && negocio.negocio && negocio.negocio.horarios;
  const horarioEnConsola = !!hs && typeof hs === 'object' && Object.values(hs).some((v) => VALOR_LLENO(v));
  for (const c of ['nombreCorto', 'nombreCompleto', 'clinica', 'horario']) if (!VALOR_LLENO(d[c]) && !(c === 'horario' && horarioEnConsola)) h.push(`datos: doctora.${c} está vacío o es un marcador`);
  // Las doctoras atienden público: el horario lo confirma la doctora. Mientras el indicador esté en true (se pone en false cuando lo confirma), no se publica.
  if (etapa === 'encender' && d.horarioPorConfirmar === true) h.push('datos: doctora.horarioPorConfirmar es true: el horario aún no lo confirmó la doctora');
  if (!Array.isArray(d.tratamientos) || !d.tratamientos.length) h.push('datos: doctora.tratamientos está vacío');
  return h;
}

function hallazgosDelNegocio(negocio) {
  const h = [];
  if (!negocio || typeof negocio !== 'object' || Array.isArray(negocio)) return ['negocio: no se pudo leer el archivo de datos del negocio'];
  // El número de recepción va como `numeroRecepcionMarcador` (lo resuelve la tabla local al cargar): es el único campo donde un REEMPLAZAR_ se tolera; cualquier otro es un dato sin cargar.
  const { negocio: n, ...resto } = negocio;
  const { numeroRecepcionMarcador: _n, ...restoNegocio } = n && typeof n === 'object' ? n : {};
  for (const m of new Set(marcasEn({ ...resto, negocio: restoNegocio }).map((x) => x.toUpperCase()))) h.push(`negocio: marcador sin sustituir: ${m}`);
  if (!n || !VALOR_LLENO(n.direccion)) h.push('negocio: falta la dirección');
  return h;
}

/** Los nodos, las aristas y los módulos comunes de la rama de medios (audio, documento, imagen). Se exigen al PUBLICAR: sin ellos el flujo atendería medios a medias. */
export const NODOS_DE_MEDIOS = [...NODOS_CONTRATO_MEDIOS, '¿Bajar medio?', '¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', '¿Es un documento?', 'Transcribir audio', 'Describir documento', 'Describir imagen'];
export const ARISTAS_DE_MEDIOS = [
  ['¿Bajar medio?', 'Obtener URL del medio (general)'], ['¿Bajar medio?', 'Decidir turno'], ['Obtener URL del medio (general)', '¿Tamaño aceptable?'],
  ['¿Tamaño aceptable?', 'Descargar medio'], ['¿Tamaño aceptable?', 'Medio no aceptado'], ['Descargar medio', '¿Es audio?'],
  ['¿Es audio?', 'Transcribir audio'], ['¿Es audio?', '¿Es un documento?'], ['¿Es un documento?', 'Describir documento'], ['¿Es un documento?', 'Describir imagen'],
  ['Transcribir audio', 'Preparar transcripción'], ['Preparar transcripción', 'Decidir turno'], ['Describir documento', 'Preparar imagen'], ['Describir imagen', 'Preparar imagen'],
  ['Preparar imagen', 'Decidir turno'], ['Medio no aceptado', 'Decidir turno'],
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

/**
 * El flujo a publicar tiene que ser el de ESTA doctora: su `name` es el de los datos (producción o prueba), la asignación `doctora` de «Config base» es el bloque `doctora` de los datos y cada valor de `configBase`
 * que no sea un marcador es el mismo en el flujo. Sin esto, el flujo de Emma con los datos de Evy (o al revés) pasaría la guardia. Los mensajes nombran claves, nunca valores.
 */
const coincide = (dato, vivo) => {
  if (typeof dato === 'string' && hayMarcador(dato)) return true;   // el dato aún es un marcador: el valor real lo pone quien publica
  if (Array.isArray(dato)) return Array.isArray(vivo) && dato.length === vivo.length && dato.every((x, i) => coincide(x, vivo[i]));
  if (dato && typeof dato === 'object') return !!vivo && typeof vivo === 'object' && !Array.isArray(vivo) && Object.keys(dato).length === Object.keys(vivo).length && Object.keys(dato).every((k) => k in vivo && coincide(dato[k], vivo[k]));
  return dato === vivo;
};
function hallazgosDeIdentidad(flujo, enFlujo, datos) {
  const h = [];
  if (!datos || typeof datos !== 'object') return ['datos: no se pudieron leer'];
  const nombres = [datos.nombreFlujo, datos.nombreFlujoPrueba].filter((x) => typeof x === 'string' && x !== '');
  if (!nombres.length || !nombres.includes(flujo && flujo.name)) h.push('el nombre del flujo no es el de esta doctora (nombreFlujo ni nombreFlujoPrueba de los datos)');
  let doctora = enFlujo.doctora;
  if (typeof doctora === 'string') { try { doctora = JSON.parse(doctora); } catch { doctora = undefined; } }
  if (!doctora || typeof doctora !== 'object' || !coincide(datos.doctora, doctora)) h.push('Config base: la asignación `doctora` no coincide con el bloque `doctora` de los datos de esta doctora');
  for (const [c, v] of Object.entries(datos.configBase || {})) {
    if (typeof v === 'string' && hayMarcador(v)) continue;
    if (enFlujo[c] !== v) h.push(`Config base: ${c} no coincide con los datos de esta doctora`);
  }
  return h;
}

export function guardiaDePublicacion({ flujo, datos, negocio, etapa = 'encender' }) {
  if (!ETAPAS.includes(etapa)) return [`etapa desconocida (${ETAPAS.join(' | ')})`];
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  if (!nodos.length) h.push('el flujo no trae nodos');
  // 1. Marcadores sin sustituir en CUALQUIER parte del JSON completo (nodos, conexiones, ajustes, pinData, staticData, nivel superior).
  for (const m of new Set(marcasEn(flujo).map((x) => x.toUpperCase()))) h.push(`marcador sin sustituir: ${m}`);
  // 2. La plantilla UTILITY del aviso, en lo que se publica («Config base»)…
  const base = nodos.find((n) => n.name === 'Config base');
  const lista = base && base.parameters && base.parameters.assignments && base.parameters.assignments.assignments;
  if (!Array.isArray(lista)) h.push('el flujo no trae «Config base»: no se puede comprobar el estado de la plantilla');
  else {
    const enFlujo = Object.fromEntries(lista.map((a) => [a.name, a.value]));
    h.push(...hallazgosDeConfig(enFlujo, 'Config base', etapa));
    h.push(...hallazgosDeEtapaPrueba(enFlujo, etapa));
    h.push(...hallazgosDeIdentidad(flujo, enFlujo, datos));
  }
  // 3. …en los datos, con lo que cada doctora tiene que traer lleno…
  h.push(...hallazgosDeConfig(datos && datos.configBase, 'datos', etapa));
  h.push(...hallazgosDeLaDoctora(datos, etapa, negocio));
  // 4. …los marcadores del negocio…
  h.push(...hallazgosDelNegocio(negocio));
  // 5. …y la rama de medios completa y la conversación completa (con el aviso: sin él, «ya avisé» no tendría respaldo).
  h.push(...hallazgosDeMedios(flujo));
  const nombres = new Set(nodos.map((n) => n.name));
  for (const n of [...NODOS_DE_LA_CONVERSACION, ...NODOS_DEL_AVISO]) if (!nombres.has(n)) h.push(`conversación: falta el nodo «${n}»`);
  return h;
}

// ----------------------------------------------------------------- armar
const sinMarcas = (v, esCodigo) => {
  if (typeof v === 'string') return esCodigo ? !v.startsWith('@@') : !v.includes('@@');
  if (Array.isArray(v)) return v.every((x) => sinMarcas(x, false));
  if (v && typeof v === 'object') return Object.entries(v).every(([c, x]) => sinMarcas(x, c === 'jsCode'));
  return true;
};

/** Arma UNA variante de UN tenant con los datos ya validados. Devuelve el texto del JSON. */
export function armarDoctora(proyecto, datos, v) {
  const prueba = v.archivo === nombreDeFlujo(datos.tenant, true);
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
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos);
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
  // El reporte saliente de ESTE flujo (propio): igual al común, más el EVENTO `no_contactar` (la baja y la protección), que viaja SIEMPRE, aunque salga el respaldo.
  const rep = plantilla.nodes.find((n) => n.name === 'Reportar mensaje (saliente)');
  if (!rep || typeof rep.parameters.jsonBody !== 'string' || !rep.parameters.jsonBody.includes('evento: m.evento')) throw new Error(`${donde}: la cadena común cambió: «Reportar mensaje (saliente)» ya no arma el cuerpo esperado`);
  rep.parameters.jsonBody = "={{ (() => { const m = $('Armar mensajes').item.json; const r = { telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: ((($json || {}).messages || [])[0] || {}).id || '' }; if (m.evento === 'no_contactar') { r.evento = 'no_contactar'; } return JSON.stringify(r); })() }}";
  // El GUARDADO de medios (módulo común, nunca copiado): cuelga de «Reportar mensaje (entrante)», debajo de todo; credenciales tomadas por nombre del flujo ya armado.
  injertarGuardado(plantilla, { guardarUrl: `https://${ANFITRION_CONSOLA}/guardarMedio` });
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: v.archivo, nombre: dato(datos, prueba ? 'nombreFlujoPrueba' : 'nombreFlujo', donde), quitar: [] });
  const flujo = JSON.parse(texto);
  if (!sinMarcas(flujo, false)) throw new Error(`${donde}: quedó una marca @@ sin reemplazar`);
  return JSON.stringify(flujo, null, 2) + '\n';
}

/**
 * Arma (o verifica) las dos variantes de cada tenant con datos. Devuelve un resultado por archivo. Lanza ante un dato inválido o una guardia violada en lo armado.
 *   opciones: { carpeta, tenants, carpetaDeDatos, verificar, tope }   (`tope` y `carpetaDeDatos` son para las pruebas)
 */
export function construir({ carpeta = AQUI, tenants, carpetaDeDatos = CARPETA_DE_DATOS, verificar = false, tope } = {}) {
  const lista = tenants || tenantsConDatos(carpetaDeDatos);
  const proyecto = leerProyecto(carpeta, configDe(lista), tope ? { tope } : {});
  const salida = [];
  for (const t of lista) {
    const datos = cargarDatos(join(carpetaDeDatos, `${t}.json`));
    if (datos.tenant !== t) throw new Error(`${t}.json: el campo «tenant» dice otro (${datos.tenant})`);
    for (const v of proyecto.variantes.filter((x) => x.archivo === nombreDeFlujo(t, false) || x.archivo === nombreDeFlujo(t, true))) {
      const texto = armarDoctora(proyecto, datos, v);
      const variante = v.archivo === nombreDeFlujo(t, true) ? 'prueba' : 'produccion';
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
      salida.push({ archivo: v.archivo, tenant: t, nodos: JSON.parse(texto).nodes.length, existia: actual !== null, alDia: actual === texto, versionado });
    }
  }
  return salida;
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--publicable')) {
    // --publicable [--tenant <t>] [--flujo <json>] [--datos <json>] [--negocio <json>]: solo lee. Sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal.
    const OPCIONES = ['--tenant', '--flujo', '--datos', '--negocio', '--etapa'];
    const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
    const resto = args.filter((a, i) => a !== '--publicable' && !OPCIONES.includes(a) && !OPCIONES.includes(args[i - 1]));
    const uno = OPCIONES.slice(1, 4).some((n) => args.includes(n));
    if (resto.length || args.includes('--verificar') || OPCIONES.some((n) => args.includes(n) && !opcion(n)) || (uno && !opcion('--tenant'))) {
      console.error('✗ uso: construir.mjs --publicable [--tenant <t> [--flujo <json>] [--datos <json>] [--negocio <json>]] [--etapa crear|prueba|encender]'); process.exit(2);
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
      const tenants = opcion('--tenant') ? [opcion('--tenant')] : tenantsConDatos();
      if (tenants.some((x) => !/^rroca-[a-z0-9-]+$/.test(String(x)))) throw new Error('--tenant: forma no válida');
      let mal = false;
      for (const tn of tenants) {
        const flujoJson = leerJson(opcion('--flujo') || join(AQUI, nombreDeFlujo(tn, false)), `el flujo de ${tn}`);
        const negocio = leerJson(opcion('--negocio') || archivoDeNegocio(tn), `el archivo de datos del negocio de ${tn}`);
        const hallazgos = guardiaDePublicacion({ flujo: flujoJson, datos: cargarDatos(opcion('--datos') || archivoDeDatos(tn)), negocio, etapa });
        if (hallazgos.length) {
          mal = true;
          console.error(`✗ El flujo de ${tn} NO se puede publicar todavía (etapa ${etapa}):`);
          for (const x of hallazgos) console.error(`  - ${x}`);
        } else if (etapa === 'prueba') console.log(`✓ ${tn}: etapa prueba: sin marcadores, con etapaPrueba = si, teléfonos de prueba válidos y la recepción dentro de ellos: se puede ENCENDER EN MODO PRUEBA (solo atiende a esos teléfonos).`);
        else if (etapa === 'crear') console.log(`✓ ${tn}: etapa crear: sin marcadores (salvo el horario pendiente de Evy), con identidad, credenciales y los tres medios: se puede CREAR INACTIVO (no se enciende: falta la plantilla APPROVED y el horario confirmado).`);
        else console.log(`✓ ${tn}: sin marcadores REEMPLAZAR_*, con la plantilla de aviso APPROVED y los medios completos: se puede publicar (con la confirmación de quien publica).`);
      }
      process.exit(mal ? 1 : 0);
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
