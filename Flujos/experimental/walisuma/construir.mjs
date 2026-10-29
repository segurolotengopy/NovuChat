#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON del flujo de venta de Walisuma (tenant walisuma) desde la plantilla y los datos
 * =============================================================================
 *
 *   node Flujos/experimental/walisuma/construir.mjs               escribe walisuma.json y walisuma.prueba.json
 *   node Flujos/experimental/walisuma/construir.mjs --verificar   no escribe: sale 1 si un JSON versionado difiere de lo que se arma o viola una guardia
 *   node Flujos/experimental/walisuma/construir.mjs --publicable [--flujo <json>] [--datos <json>]
 *                                                       no escribe: sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal. HOY SALE 1: es un ESQUELETO (PR-2)
 *   (cualquier otro argumento se rechaza)
 *
 * ESTADO: ESQUELETO (PR-2). Trae todo lo que no es la conversación: la entrada verificada del receptor, la entrada y la configuración, la puerta del turno (comercio no operativo, uso extendido y pausa por Tomar),
 * los medios y la salida. La conversación con el modelo, el carrito, el cobro y los avisos son del PR-3 (11 nodos, con los que el flujo llega a 47). `--publicable` falla con un mensaje claro hasta entonces.
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código, sin los datos y sin la entrada del receptor. El código de los nodos lo arma el armador genérico `../comun-sin-agente/construir.mjs` (importado, no copiado):
 *   - `@@dato:a.b.c@@` por ese dato; `@@cred:ingesta|graph|entradaPrueba|gemini` por el nombre de credencial del archivo de datos;
 *   - `@@medio:<paquete>`: los módulos comunes de medios (`Flujos/src/core/medios/*.js`) se INCLUYEN desde su fuente, nunca se copian;
 *   - `@@vd:<nodo>`: el nodo común NEUTRO de `../venta-digital/src/nodos/<nodo>.js`, con las librerías y `_comun.js` delante (lo mismo que el modo `todo` del armador genérico, pero leyendo de la base común);
 *   - LA ENTRADA VERIFICADA DEL RECEPTOR (6 nodos) se INCLUYE leyéndolos POR NOMBRE de `../venta-minima/flujo.plantilla.json` (solo lectura): `--verificar` falla si difieren de su origen;
 *   - LA CADENA DE ENVÍO es común (`../comun-sin-agente/src/envio.mjs`, `injertar()`), con las credenciales por NOMBRE;
 *   - dos variantes: PRODUCCIÓN (con el receptor y sin «Entrada de prueba») y PRUEBA (al revés).
 *
 * LOS DATOS son `admin/scripts/datos/walisuma/walisuma.json` (zona Tenants: solo marcadores `REEMPLAZAR_*`, nunca un token, una ruta de webhook real, un teléfono ni un identificador de Meta).
 */
import { closeSync, constants, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarVariante, leerProyecto } from '../comun-sin-agente/construir.mjs';
import { injertar } from '../comun-sin-agente/src/envio.mjs';
import { problemasDeReferencias } from '../rroca-ruben/construir.mjs';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const ARCHIVO_DE_DATOS = join(AQUI, '../../../admin/scripts/datos/walisuma/walisuma.json');
export const ORIGEN_DEL_RECEPTOR = join(AQUI, '../venta-minima/flujo.plantilla.json');
export const TOPE_DE_NODOS = 47;
export const FLUJO_PRODUCCION = 'walisuma.json';
export const FLUJO_PRUEBA = 'walisuma.prueba.json';

/** Los nodos que completa el PR-3 (conversación, cotejo del comprobante, derivación y avisos). Con ellos el flujo llega a 47. `--publicable` los exige. */
export const NODOS_DEL_PR3 = ['Decidir turno', 'Interpretar lectura', '¿Cotejar?', 'Cotejar en el servidor', '¿Conversar con el modelo?', 'Conversar con el modelo', '¿Avisar al servidor?', 'Avisar al servidor', 'Armar avisos', '¿Hay avisos?', 'Enviar aviso'];
/** Los empalmes que el PR-3 conecta (documentados en PROPIO.md): de qué nodo sale y adónde llega. */
export const EMPALMES_DEL_PR3 = [
  ['¿Bajar medio?', 'Decidir turno', 'hoy va a «Armar mensajes» (salida «no es un medio»)'],
  ['Preparar transcripción', 'Decidir turno', 'hoy termina'],
  ['Medio no aceptado', 'Decidir turno', 'hoy termina'],
  ['Preparar imagen', 'Interpretar lectura', 'hoy termina'],
  ['Decidir turno', 'Armar mensajes', 'por el modelo, el aviso al servidor y los avisos'],
];

/** El config del armador genérico. Vive aquí y no en un `construir.config.json`: el saneo del repo público trata todo JSON bajo `Flujos/` como un export de n8n. */
export const CONFIG = {
  plantilla: 'flujo.plantilla.json',
  raiz: '../..',
  // La base común de las ventas digitales (cobro, avisos y el motor de la conversación: prefijos `cb`, `av` y `vd`) y, al final, lo PROPIO de Walisuma (`wl.js`: solo datos y textos, y `CN_TENANT`).
  librerias: ['../venta-digital/src/cobro.js', '../venta-digital/src/avisos.js', '../venta-digital/src/conversacion.js', 'src/lib/wl.js'],
  comun: ['../venta-digital/src/nodos/_comun.js'],
  paquetes: {
    mensajes: ['../comun-sin-agente/src/mensajes.js'],
    'm-transcripcion': ['../../src/core/medios/preparar-transcripcion.js'],
    'm-imagen': ['../../src/core/medios/anuncio-por-titular.js', '../../src/core/medios/preparar-imagen.js'],
    'm-no-aceptado': ['../../src/core/medios/medio-no-aceptado.js'],
    // Los nodos comunes neutros (zona venta-digital): se piden con `@@vd:<nodo>`.
    'vd-carga-de-entrada': ['../venta-digital/src/nodos/carga-de-entrada.js'],
    'vd-config-del-negocio': ['../venta-digital/src/nodos/config-del-negocio.js'],
    'vd-normalizar-entrada': ['../venta-digital/src/nodos/normalizar-entrada.js'],
    'vd-puerta-del-turno': ['../venta-digital/src/nodos/puerta-del-turno.js'],
    'vd-resumen-del-turno': ['../venta-digital/src/nodos/resumen-del-turno.js'],
  },
  variantes: [
    { archivo: FLUJO_PRODUCCION, quitar: 'Entrada de prueba', nombre: 'se toma de los datos' },
    { archivo: FLUJO_PRUEBA, quitar: [], nombre: 'se toma de los datos' },
  ],
};

/** Los nodos que los módulos comunes de medios leen por contrato. */
export const NODOS_CONTRATO_MEDIOS = ['Normalizar entrada', 'Config del negocio', 'Obtener URL del medio (general)', 'Preparar transcripción', 'Preparar imagen', 'Medio no aceptado'];
const NODO_PRUEBA = 'Entrada de prueba';
const NODO_RECEPTOR = 'Entrega del receptor';
export const NODOS_DEL_RECEPTOR = [NODO_RECEPTOR, 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'];
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
  contactoAviso: /^(\d{6,20}|REEMPLAZAR_[A-Z0-9_]+)$/,
  prefijosPermitidos: /^\d{1,4}(,\d{1,4})*$/,
  telefonosDePrueba: /^(\d{6,20}(,\d{6,20})*|REEMPLAZAR_[A-Z0-9_]+)$/,
  // El ÚNICO modelo de este flujo: gemini-3.5-flash-lite.
  modelo: /^gemini-3\.5-flash-lite$/,
  temperatura: /^(0|1|0\.\d{1,2})$/,
  avisoPedidoPlantilla: /^([a-z0-9_]{1,100}|REEMPLAZAR_[A-Z0-9_]+)$/,
  avisoPedidoEstado: /^(APPROVED|PENDING|REJECTED|PAUSED|DISABLED|IN_APPEAL|REEMPLAZAR_[A-Z0-9_]+)$/,
  avisoPlantillaIdioma: /^[a-z]{2,3}(_[A-Z]{2})?$/,
};
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;

/** Lee y valida el archivo de datos. Cada error nombra el campo. */
export function cargarDatos(ruta = ARCHIVO_DE_DATOS) {
  const texto = leerSiExiste(ruta, 'walisuma.json');
  if (texto === null) throw new Error(`no existe el archivo de datos ${ruta}`);
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error('walisuma.json: no es un JSON válido'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('walisuma.json: tiene que ser un objeto');
  const errores = [];
  const cadena = (ruta2, v) => { if (typeof v !== 'string' || v.trim() === '') errores.push(`${ruta2}: falta`); };
  cadena('nombreFlujo', d.nombreFlujo);
  cadena('nombreFlujoPrueba', d.nombreFlujoPrueba);
  // Repo público: las credenciales van por NOMBRE y como marcador (el publicador las empareja con las de la instancia).
  for (const c of ['ingesta', 'graph', 'graphPrueba', 'entradaPrueba', 'gemini', 'geminiPrueba']) {
    const v = (d.credenciales || {})[c];
    cadena(`credenciales.${c}`, v);
    if (typeof v === 'string' && v.trim() !== '' && !MARCADOR.test(v)) errores.push(`credenciales.${c}: tiene que ser un marcador REEMPLAZAR_*`);
  }
  for (const c of ['ruta', 'urlVerificador', 'wabaIdEsperado']) {
    const v = (d.receptor || {})[c];
    cadena(`receptor.${c}`, v);
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
    // El costo de entrega NO se inventa: viaja vacío hasta que el comercio lo declare.
    if (cb.costoDeEntrega === undefined) errores.push('configBase.costoDeEntrega: falta la clave (vacía hasta que el comercio declare el costo)');
  }
  if (errores.length) throw new Error(`walisuma.json: datos no válidos: ${errores.join('; ')}`);
  return d;
}

function dato(datos, ruta, donde) {
  let x = datos;
  for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
  if (typeof x !== 'string' || x === '') throw new Error(`${donde}: falta el dato «${ruta}» en el archivo de datos`);
  if (CARACTERES_PELIGROSOS.test(x) && !ruta.startsWith('credenciales.') && !/^nombreFlujo/.test(ruta)) throw new Error(`${donde}: el dato «${ruta}» trae una comilla, una barra invertida, una llave o un salto de línea`);
  return x;
}
export function reemplazarTextos(valor, datos, donde) {
  if (typeof valor === 'string') return valor.replace(/@@dato:([A-Za-z0-9_.]+)@@/g, (_, ruta) => dato(datos, ruta, donde));
  if (Array.isArray(valor)) return valor.map((v) => reemplazarTextos(v, datos, donde));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([c, v]) => [c, reemplazarTextos(v, datos, donde)]));
  return valor;
}
const asignaciones = (configBase) => Object.entries(configBase).map(([nombre, valor]) => ({ id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor }));

// ----------------------------------------------------------------- la entrada verificada del receptor: INCLUIDA desde su origen
/** Los 6 nodos y sus conexiones, tal como están en `venta-minima/flujo.plantilla.json` (sin sustituir los datos). Solo lectura. */
export function leerReceptorDeOrigen(ruta = ORIGEN_DEL_RECEPTOR) {
  const texto = leerSiExiste(ruta, 'el origen del receptor');
  if (texto === null) throw new Error('no existe el origen de la entrada del receptor (venta-minima/flujo.plantilla.json)');
  let o;
  try { o = JSON.parse(texto); } catch { throw new Error('el origen de la entrada del receptor no es un JSON válido'); }
  const nodes = NODOS_DEL_RECEPTOR.map((nombre) => {
    const n = (o.nodes || []).find((x) => x.name === nombre);
    if (!n) throw new Error(`el origen de la entrada del receptor no trae el nodo «${nombre}»`);
    return JSON.parse(JSON.stringify(n));
  });
  const conexiones = {};
  for (const nombre of NODOS_DEL_RECEPTOR) {
    if (nombre === 'Descartar repetidos') continue; // su destino lo fija este flujo: «Config base»
    if (o.connections && o.connections[nombre]) conexiones[nombre] = JSON.parse(JSON.stringify(o.connections[nombre]));
  }
  return { nodes, conexiones };
}

/** Los nodos del receptor de un flujo armado, comparados con su origen (con los datos ya sustituidos). Devuelve los hallazgos. */
export function hallazgosDelReceptor(flujo, datos, origen = leerReceptorDeOrigen()) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  for (const esperado of origen.nodes) {
    const nombre = esperado.name;
    const real = nodos.find((n) => n.name === nombre);
    if (!real) { h.push(`falta el nodo «${nombre}» de la entrada verificada del receptor`); continue; }
    const igual = JSON.stringify(reemplazarTextos(esperado, datos, nombre));
    if (JSON.stringify(real) !== igual) h.push(`el nodo «${nombre}» difiere de su origen (venta-minima/flujo.plantilla.json): la entrada verificada del receptor se incluye, no se edita`);
  }
  return h;
}

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
export function guardias(variante, flujo, opciones = {}) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const nombres = new Set(nodos.map((n) => n.name));
  const por = (nombre) => nodos.find((n) => n.name === nombre);
  const p = (n) => (n && n.parameters) || {};
  const tope = opciones.tope ?? TOPE_DE_NODOS;
  if (nodos.length > tope) h.push(`tiene ${nodos.length} nodos y el tope es ${tope}: si pasa, se rehace`);
  if (nodos.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')) h.push('contiene un WhatsApp Trigger (prohibición 7: reescribe el webhook de toda la app)');
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) h.push('menciona «subscriptions» o «subscribed_apps» (prohibición 7)');
  if (/langchain\.(agent|memory\w*|lmChat\w*|chain\w*)$/i.test(nodos.map((n) => n.type).join('\n'))) h.push('lleva un agente, memoria o modelo de chat de n8n: este flujo no los lleva');
  const conex = (flujo && flujo.connections) || {};
  const destinosDe = (nombre, salida) => (((conex[nombre] || {}).main || [])[salida] || []).map((x) => x.node);
  // Los nodos de medios comunes tienen que estar, con los nombres que esos módulos leen por contrato.
  for (const n of NODOS_CONTRATO_MEDIOS) if (!nombres.has(n)) h.push(`falta el nodo «${n}» (contrato con los módulos comunes de medios)`);
  // El reporte del entrante corre ANTES que la rama que responde: arriba de la «Puerta del turno», de toda la rama de medios y de la decisión.
  const rep = por('Reportar mensaje (entrante)');
  if (rep) {
    for (const n of nodos) {
      if (['Puerta del turno', '¿Bajar medio?', 'Obtener URL del medio (general)', 'Decidir turno', 'Armar mensajes'].includes(n.name) && !(rep.position[1] < n.position[1])) h.push(`«Reportar mensaje (entrante)» tiene que ir arriba de «${n.name}» en el lienzo`);
    }
  }
  // «Guardar comprobante»: rama TERMINAL, arriba de «¿Es un documento?» (corre antes) y colgada de la salida «no es audio».
  const guardar = por('Guardar comprobante');
  const doc = por('¿Es un documento?');
  if (!guardar) h.push('falta el nodo «Guardar comprobante»');
  else {
    if (destinosDe('Guardar comprobante', 0).length) h.push('«Guardar comprobante» tiene que ser terminal (sin salidas)');
    if (doc && !(guardar.position[1] < doc.position[1])) h.push('«Guardar comprobante» tiene que ir arriba de «¿Es un documento?» en el lienzo');
    if (!destinosDe('¿Es audio?', 1).includes('Guardar comprobante')) h.push('«Guardar comprobante» no cuelga de la salida «no es audio» de «¿Es audio?»');
  }
  // La PAUSA POR TOMAR y el comercio no operativo se resuelven en la puerta: ningún medio se baja si la puerta no dice «sigue».
  const bajar = por('¿Bajar medio?');
  if (bajar && !/ruta === 'sigue'/.test(JSON.stringify(p(bajar)))) h.push('«¿Bajar medio?» no exige que la puerta diga «sigue» (un cliente bloqueado no descarga medios)');
  // La variante de PRUEBA nunca usa credenciales de producción: ni la de Graph ni la de Gemini.
  if (variante === 'prueba') {
    const libres = new Set([NODO_PRUEBA, 'Traer configuración', 'Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Guardar comprobante', 'Cotejar en el servidor', 'Avisar al servidor']);
    for (const n of nodos) {
      for (const [tipo, c] of Object.entries(n.credentials || {})) {
        const nombreCred = String((c || {}).name || '');
        if ((tipo === 'googlePalmApi' && !/prueba/i.test(nombreCred)) || (!libres.has(n.name) && tipo === 'httpHeaderAuth' && !/prueba/i.test(nombreCred))) {
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
  // Las rutas de los webhooks son URL de capacidad: nunca en las notas.
  for (const n of nodos) {
    if (/\/webhook(-test)?\/|webhook-test|\/rest\/|REEMPLAZAR_RUTA/i.test(String(n.notes || ''))) h.push(`las notas de «${n.name}» mencionan la ruta de un webhook`);
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
    if (!destinosDe('Descartar repetidos', 0).includes('Config base')) h.push('«Descartar repetidos» no sigue a «Config base»');
    if (!destinosDe('¿Firma válida?', 1).includes('Rechazar (401)')) h.push('«¿Firma válida?» no manda la firma inválida a «Rechazar (401)»');
    if (destinosDe('Rechazar (401)', 0).length) h.push('«Rechazar (401)» no puede tener salidas: una firma inválida corta ahí');
  }
  // Un nodo HTTP solo habla con Meta, con Gemini y con las Functions de la consola.
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    const url = String(p(n).url || '');
    if (!anfitrionPermitido(url, n.name)) h.push(`el nodo «${n.name}» llama a un anfitrión fuera de la lista (graph.facebook.com, generativelanguage.googleapis.com, las Functions de la consola)`);
  }
  // Las referencias a nodos del task runner de n8n (la lógica es la de Rubén, importada y no copiada).
  for (const x of problemasDeReferencias(flujo || {})) h.push(x);
  // Retención de ejecuciones, orden y zona horaria.
  const st = (flujo && flujo.settings) || {};
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'all' || st.saveExecutionProgress !== false) h.push('los ajustes de retención deben ser saveDataSuccessExecution «none», saveDataErrorExecution «all» y saveExecutionProgress false');
  if (st.errorWorkflow !== undefined) h.push('no lleva `errorWorkflow`');
  if (st.executionOrder !== 'v1') h.push('executionOrder tiene que ser «v1» (el orden de las ramas es el del lienzo)');
  if (st.timezone !== 'America/La_Paz') h.push('timezone tiene que ser «America/La_Paz»');
  // `REEMPLAZAR_` solo en «Config base», en el receptor, en la ruta de la entrada de prueba y en los NOMBRES de credencial (`credentials`).
  const conMarcador = new Set(['Config base', NODO_RECEPTOR, 'Verificar firma con el receptor', NODO_PRUEBA]);
  for (const n of nodos) {
    if (conMarcador.has(n.name)) continue;
    const { credentials: _c, ...sinCredenciales } = n;
    if (/REEMPLAZAR_[A-Z0-9]/.test(JSON.stringify(sinCredenciales))) h.push(`el nodo «${n.name}» trae un marcador REEMPLAZAR_: solo va en «Config base», el receptor y la ruta de prueba`);
  }
  return h;
}

// ----------------------------------------------------------------- la guardia de publicación
// Un marcador es CUALQUIER `REEMPLAZAR_` (sin distinguir mayúsculas, tras normalizar a NFKC). Se quitan antes de mirar SOLO las formas que son texto de comentario de los módulos copiados
// (`REEMPLAZAR_*`, `REEMPLAZAR_…`, `REEMPLAZAR_...`, `REEMPLAZAR_` entre comillas invertidas) y los literales de expresión regular `/^REEMPLAZAR_/` y `/reemplazar_/i` con los que el código descarta marcadores.
const sinComentarios = (t) => String(t).normalize('NFKC').replace(/\/\^?REEMPLAZAR_\/i?/gi, '').replace(/REEMPLAZAR_(?:\*|…|\.\.\.)/gi, '').replace(/`REEMPLAZAR_`/gi, '');
const marcasEn = (v) => (sinComentarios(JSON.stringify(v) || '').match(/reemplazar_[a-z0-9_-]*/gi) || []);

/**
 * Este flujo es un ESQUELETO (PR-2): no se publica hasta que el PR-3 lo complete. Además, como los demás: sin marcadores `REEMPLAZAR_*`, con la plantilla del aviso aprobada por Meta y con el costo de entrega declarado.
 * Los mensajes nombran claves, marcadores y nodos, NUNCA valores de los datos ni fragmentos del flujo. Devuelve la lista de hallazgos (vacía si se puede publicar).
 */
export function guardiaDePublicacion({ flujo, datos }) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  if (!nodos.length) h.push('el flujo no trae nodos');
  const nombres = new Set(nodos.map((n) => n.name));
  const faltan = NODOS_DEL_PR3.filter((n) => !nombres.has(n));
  if (faltan.length) h.push(`es un ESQUELETO (PR-2) y no se puede publicar: faltan ${faltan.length} nodos de la conversación, el cotejo y los avisos (PR-3): ${faltan.map((n) => `«${n}»`).join(', ')}`);
  for (const m of new Set(marcasEn(flujo).map((x) => x.toUpperCase()))) h.push(`marcador sin sustituir: ${m}`);
  const base = nodos.find((n) => n.name === 'Config base');
  const lista = base && base.parameters && base.parameters.assignments && base.parameters.assignments.assignments;
  const cb = Array.isArray(lista) ? Object.fromEntries(lista.map((a) => [a.name, a.value])) : (datos && datos.configBase);
  if (!cb || typeof cb !== 'object') h.push('no se puede leer la configuración base');
  else {
    if (cb.avisoPedidoEstado !== 'APPROVED') h.push('avisoPedidoEstado tiene que ser APPROVED (Meta aún no aprobó la plantilla del aviso de pedido)');
    if (String(cb.costoDeEntrega === undefined ? '' : cb.costoDeEntrega).trim() === '') h.push('costoDeEntrega sin declarar: el comercio todavía no dijo cuánto cuesta cada modo de entrega');
  }
  for (const n of ['Guardar comprobante']) if (!nombres.has(n)) h.push(`falta el nodo «${n}»`);
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
export function armarWalisuma(proyecto, datos, v, origenReceptor = leerReceptorDeOrigen()) {
  const prueba = v.archivo === FLUJO_PRUEBA;
  const donde = v.archivo;
  const plantilla = JSON.parse(JSON.stringify(proyecto.plantilla));
  const quitar = new Set(Array.isArray(v.quitar) ? v.quitar : (v.quitar ? [v.quitar] : []));
  plantilla.nodes = plantilla.nodes.filter((n) => !quitar.has(n.name));
  // La entrada verificada del receptor se INCLUYE (solo en producción), leída por nombre de su origen; «Descartar repetidos» sigue a «Config base».
  if (!prueba) {
    plantilla.nodes.unshift(...JSON.parse(JSON.stringify(origenReceptor.nodes)));
    Object.assign(plantilla.connections, JSON.parse(JSON.stringify(origenReceptor.conexiones)));
    plantilla.connections['Descartar repetidos'] = { main: [[{ node: 'Config base', type: 'main', index: 0 }]] };
  }
  for (const n of plantilla.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${donde} · ${n.name}`);
    for (const c of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|graph|entradaPrueba|gemini)$/.exec(String(c.name));
      // La variante de PRUEBA nunca usa las credenciales de producción de Meta ni de Gemini.
      const clave = prueba && m && m[1] === 'graph' ? 'graphPrueba' : (prueba && m && m[1] === 'gemini' ? 'geminiPrueba' : (m ? m[1] : ''));
      if (m) c.name = dato(datos, `credenciales.${clave}`, `${donde} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
    const js = n.parameters && n.parameters.jsCode;
    // Los módulos comunes de medios se INCLUYEN desde su fuente: el código queda tal cual, sin una sola edición.
    const medio = typeof js === 'string' ? /^@@medio:([a-z0-9-]+)$/.exec(js) : null;
    if (medio) {
      const fuente = proyecto.paquetes[medio[1]];
      if (!fuente || fuente.length < 1) throw new Error(`${donde} · ${n.name}: el config no declara el paquete «${medio[1]}»`);
      n.parameters.jsCode = fuente.join('\n\n') + '\n';
    }
    // Los nodos comunes NEUTROS (`venta-digital/src/nodos/`): librerías + `_comun.js` + el nodo, igual que el modo `todo` del armador genérico.
    const vd = typeof js === 'string' ? /^@@vd:([a-z0-9-]+)$/.exec(js) : null;
    if (vd) {
      const fuente = proyecto.paquetes[`vd-${vd[1]}`];
      if (!fuente || fuente.length !== 1) throw new Error(`${donde} · ${n.name}: el config no declara el nodo común «${vd[1]}»`);
      n.parameters.jsCode = [...proyecto.librerias, ...proyecto.comun, fuente[0]].join('\n\n') + '\n';
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
  const texto = armarVariante({ ...proyecto, plantilla }, { archivo: v.archivo, nombre: dato(datos, prueba ? 'nombreFlujoPrueba' : 'nombreFlujo', donde), quitar: [] });
  const flujo = JSON.parse(texto);
  if (!sinMarcas(flujo, false)) throw new Error(`${donde}: quedó una marca @@ sin reemplazar`);
  return JSON.stringify(flujo, null, 2) + '\n';
}

/**
 * Arma (o verifica) las dos variantes. Devuelve un resultado por archivo. Lanza ante un dato inválido o una guardia violada en lo armado.
 *   opciones: { carpeta, datos (ruta), verificar, tope, origenReceptor }   (`tope` y `origenReceptor` son para las pruebas)
 */
export function construir({ carpeta = AQUI, datos: rutaDatos = ARCHIVO_DE_DATOS, verificar = false, tope, origenReceptor } = {}) {
  const datos = cargarDatos(rutaDatos);
  const proyecto = leerProyecto(carpeta, CONFIG, tope ? { tope } : {});
  const origen = origenReceptor ?? leerReceptorDeOrigen();
  return proyecto.variantes.map((v) => {
    const texto = armarWalisuma(proyecto, datos, v, origen);
    const variante = v.archivo === FLUJO_PRUEBA ? 'prueba' : 'produccion';
    const armado = JSON.parse(texto);
    const propios = [...guardias(variante, armado), ...(variante === 'produccion' ? hallazgosDelReceptor(armado, datos, origen) : [])];
    if (propios.length) throw new Error(`${v.archivo}: ${propios.join('; ')}`);
    const ruta = join(carpeta, v.archivo);
    const actual = leerSiExiste(ruta, v.archivo);
    // …y el archivo VERSIONADO tampoco las viola (aunque alguien lo haya tocado a mano).
    let versionado = [];
    if (actual !== null) {
      try {
        const j = JSON.parse(actual);
        versionado = [...guardias(variante, j), ...(variante === 'produccion' ? hallazgosDelReceptor(j, datos, origen) : [])];
      } catch (x) { versionado = ['no es un JSON válido']; }
    }
    if (!verificar) escribirSinSeguirEnlaces(ruta, texto, v.archivo);
    return { archivo: v.archivo, nodos: armado.nodes.length, existia: actual !== null, alDia: actual === texto, versionado };
  });
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--publicable')) {
    // --publicable [--flujo <json>] [--datos <json>]: solo lee. Sale 0 si se puede publicar, 1 si no, 2 si los argumentos están mal.
    const OPCIONES = ['--flujo', '--datos'];
    const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
    const resto = args.filter((a, i) => a !== '--publicable' && !OPCIONES.includes(a) && !OPCIONES.includes(args[i - 1]));
    if (resto.length || args.includes('--verificar') || OPCIONES.some((n) => args.includes(n) && !opcion(n))) {
      console.error('✗ uso: construir.mjs --publicable [--flujo <json>] [--datos <json>]'); process.exit(2);
    }
    // Un SyntaxError puede traer un fragmento del archivo: mensaje fijo, sin contenido.
    const leerJson = (ruta, que) => {
      const t = leerSiExiste(ruta, que);
      if (t === null) throw new Error(`no existe ${que}`);
      try { return JSON.parse(t); } catch { throw new Error(`JSON inválido en ${que}`); }
    };
    try {
      const flujoJson = leerJson(opcion('--flujo') || join(AQUI, FLUJO_PRODUCCION), 'el flujo');
      const hallazgos = guardiaDePublicacion({ flujo: flujoJson, datos: cargarDatos(opcion('--datos') || ARCHIVO_DE_DATOS) });
      if (hallazgos.length) {
        console.error('✗ El flujo de Walisuma NO se puede publicar todavía:');
        for (const x of hallazgos) console.error(`  - ${x}`);
        process.exit(1);
      }
      console.log('✓ Completo, sin marcadores REEMPLAZAR_*, con la plantilla del aviso APPROVED y el costo de entrega declarado: se puede publicar (con el «sí» de Andres por acción).');
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
