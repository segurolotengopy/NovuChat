#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de «Venta mínima (v0)» desde la plantilla y los datos
 * =============================================================================
 *
 *   node construir.mjs               escribe venta-minima.<tenant>.json y venta-minima.prueba.json
 *   node construir.mjs --verificar   no escribe: sale 1 si algún JSON versionado difiere de lo que se arma
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos del negocio:
 *
 *   - cada nodo Code lleva `"jsCode": "@@nodos/<archivo>.js"` y aquí se reemplaza por
 *
 *         src/lib/comun.js + pedido.js + reserva.js + avisos.js + promos.js + cobro.js   (en ese orden)
 *         + línea en blanco + src/nodos/<archivo>.js
 *
 *     (las librerías delante del código del nodo: el nodo Code de n8n no tiene módulos). Dos marcas
 *     más, para no repetir código que el nodo no usa:
 *       `"@@comun:nodos/<archivo>.js"`  solo `comun.js` + el archivo;
 *       `"@@solo:nodos/<archivo>.js"`   solo el archivo.
 *   - `@@dato:a.b.c@@` (dentro de cualquier texto) se reemplaza por ese dato del tenant;
 *   - `@@cred:ingesta|graph|medios|entradaPrueba|trigger` (en el nombre de una credencial) por el nombre que da el tenant;
 *   - `Config base` se llena con `configBase` del tenant (tipos string, number o boolean).
 *
 * LOS DATOS son `admin/scripts/datos/venta-minima/<tenant>.json` (zona Tenants: solo marcadores
 * `REEMPLAZAR_*` y datos del negocio, nunca un token ni una ruta de webhook real):
 *
 *     { nombreFlujo, entrada: 'receptor' | 'trigger' | 'prueba',   // 'prueba' SOLO en ensayo.json (A5)
 *       credenciales: { ingesta, graph, medios },
 *       receptor: { ruta, urlVerificador, wabaIdEsperado }, pruebaRuta,
 *       hereda?: '<otro tenant>',   // `ensayo.json` hereda de `qtaco.json` y cambia lo que dice
 *       configBase: { … } }
 *
 * UNA SALIDA POR ARCHIVO DE DATOS: `qtaco.json` → `venta-minima.qtaco.json` (entrada del receptor),
 * `ensayo.json` → `venta-minima.prueba.json` (con «Entrada de prueba»). La entrada elegida deja solo
 * SUS nodos; los de las otras dos se quitan con sus conexiones:
 *   receptor  → Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200),
 *               Rechazar (401), Descartar repetidos, Carrito del catálogo (la segunda y última entrada de
 *               producción: el carrito de la página del catálogo web; ni la prueba ni el Demo A la llevan)
 *   trigger   → WhatsApp Trigger   (solo con credenciales de una app propia, NUNCA las de AAB1-WA-Prod)
 *   prueba    → Entrada de prueba
 *
 * Node sin dependencias. No lee ningún .env ni llama a la red.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATOS = join(AQUI, '../../../admin/scripts/datos/venta-minima');
const verificar = process.argv.includes('--verificar');

const leer = (ruta) => readFileSync(join(AQUI, ruta), 'utf8');
const ORDEN_LIBS = ['comun', 'pedido', 'reserva', 'avisos', 'promos', 'cobro'];
const LIB = ORDEN_LIBS.map((n) => leer(`src/lib/${n}.js`).trimEnd()).join('\n\n');
const COMUN = leer('src/lib/comun.js').trimEnd();
const plantilla = JSON.parse(leer('flujo.plantilla.json'));

const NODOS_DE_ENTRADA = {
  receptor: ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos', 'Carrito del catálogo'],
  trigger: ['WhatsApp Trigger'],
  prueba: ['Entrada de prueba'],
};

// NODOS QUE SOLO EXISTEN EN LA VARIANTE DE PRUEBA (L2). `Simular aviso` inventa un `wamid` que cuenta como «aviso salido»: en
// producción un nodo así sería una puerta para decirle al cliente «llegó al restaurante» sin que nada haya salido. Se quitan
// con sus conexiones y `¿Avisar de verdad?` se SALTEA (quien llegaba a él llega directo a su salida 0, `Enviar aviso`).
const SOLO_PRUEBA = ['Simular aviso', '¿Avisar de verdad?'];
const PUENTES_FUERA_DE_PRUEBA = { '¿Avisar de verdad?': 0 };

// PRESUPUESTO DE NODOS (Andres, 03/10/2026): la complejidad de los nodos de n8n ya impidió salir otras veces. El JSON de producción
// de Q'Taco tiene como MÁXIMO 50 nodos (49 + el webhook del carrito). Todo lo demás se hace dentro de los nodos que ya existen
// (el código vive en `src/lib` y `src/nodos`). `--verificar` falla si un JSON de producción (todo el que no es la variante de
// prueba) pasa de este tope.
const TOPE_DE_NODOS = 50;

// LA SEGUNDA ENTRADA DE PRODUCCIÓN: el carrito del catálogo web (como el del Demo B). Un solo webhook, con este nombre exacto,
// su credencial de cabecera (la de la ingesta), `responseMode: onReceived` y la ruta como marcador (una URL de capacidad que
// reemplaza `preparar-import.sh`). Cualquier otro webhook sigue prohibido.
const WEBHOOK_DEL_CARRITO = 'Carrito del catálogo';
const WEBHOOK_DEL_RECEPTOR = 'Entrega del receptor';
// Marcadores que NO vienen de los datos del tenant (la plantilla los trae fijos) y la forma que deben tener.
const MARCADORES_FIJOS = { REEMPLAZAR_RUTA_CARRITO_QTACO: /^REEMPLAZAR_[A-Z0-9_]+$/ };
const MARCADOR_DEL_CARRITO = 'REEMPLAZAR_RUTA_CARRITO_QTACO';

// RETENCIÓN DE EJECUCIONES POR SALIDA. DECISIÓN DE ANDRES (04/10/2026, reemplaza la del 03/10): en el flujo de Q'Taco se guarda TODO, las fallas Y los
// éxitos (`all`/`all`), por lo menos 24 horas, para poder diagnosticar. El riesgo (M-1 de la revisión de seguridad del PR #382) está ACEPTADO por Andres y
// declarado en DISENO.md (sección «Retención de ejecuciones»): n8n guardará en su base el encabezado `Authorization` del webhook del carrito, los enlaces, la
// URL del QR y datos de clientes. Es la excepción de UN solo archivo: las variantes de prueba y de ensayo y cualquier otro tenant conservan `none` en todo
// (llevan texto de clientes) y no pueden guardar nada sin declararlo aquí. Cambiar esta entrada exige la decisión de Andres y una revisión de `seguridad`.
const RETENCION_POR_SALIDA = { 'venta-minima.qtaco.json': { exito: 'all', error: 'all' } };
const RETENCION_DECLARADA = new Set(['venta-minima.qtaco.json']);
const RETENCION_POR_OMISION = { exito: 'none', error: 'none' };
const retencionDe = (destino) => RETENCION_POR_SALIDA[destino] || RETENCION_POR_OMISION;

// TIEMPO LÍMITE DE LA EJECUCIÓN (`settings.executionTimeout`, en segundos) POR SALIDA. Decisión de Andres (04/10/2026): el flujo de Q'Taco sube a 120 s porque el
// peor caso del comprobante (57 s, ver DISENO.md) quedaba a 3 s de los 60 de la plantilla. SOLO Q'Taco: las variantes de prueba y de ensayo (aunque hereden sus
// datos) y la plantilla conservan los 60 s. Un tiempo más largo no cambia mensajes ni costo por conversación: solo deja de cortar una ejecución lenta.
const TIMEOUT_POR_SALIDA = { 'venta-minima.qtaco.json': 120 };
const timeoutDe = (destino) => TIMEOUT_POR_SALIDA[destino] || plantilla.settings.executionTimeout;

// COBRO SIMULADO (piloto de Q'Taco, 03/10/2026): la ÚNICA imagen permitida es el QR de demostración versionado, con el rótulo
// IMPRESO, fijado EXACTAMENTE a la etiqueta v0.11.0 (no a «cualquier vN.N.N»: una etiqueta futura podría traer otra imagen). Otro anfitrión, otra
// ruta u otra etiqueta = una imagen sin rótulo garantizado. Subir la etiqueta es una decisión revisada: se cambia aquí, en la prueba del blob
// (`venta-minima-flujo.test.ts`, que fija el contenido de la imagen) y en los datos, juntos.
const URL_QR_SIMULADO = /^https:\/\/raw\.githubusercontent\.com\/segurolotengopy\/NovuChat\/v0\.11\.0\/Demo-Recursos\/qr-demo\.png$/;
const MODOS_COBRO = ['simulado', 'real', 'sin_qr'];

function codigoDe(marca, nodo) {
  const modo = marca.startsWith('@@solo:') ? 'solo' : (marca.startsWith('@@comun:') ? 'comun' : 'todo');
  const ruta = marca.slice(modo === 'solo' ? '@@solo:'.length : (modo === 'comun' ? '@@comun:'.length : '@@'.length));
  if (!/^nodos\/[a-z0-9-]+\.js$/.test(ruta)) throw new Error(`${nodo}: ruta de código no válida: ${marca}`);
  if (!existsSync(join(AQUI, 'src', ruta))) throw new Error(`${nodo}: no existe src/${ruta}`);
  const propio = leer(`src/${ruta}`).trimEnd();
  return (modo === 'solo' ? propio : (modo === 'comun' ? `${COMUN}\n\n${propio}` : `${LIB}\n\n${propio}`)) + '\n';
}

// --- los datos del tenant ---------------------------------------------------------------------------
function cargarDatos(archivo, pila = []) {
  if (pila.includes(archivo)) throw new Error(`${archivo}: «hereda» da una vuelta`);
  const d = JSON.parse(readFileSync(join(DATOS, archivo), 'utf8'));
  if (d.hereda === undefined) return d;
  // `hereda` es un nombre de archivo de datos, nada más: sin barras ni «..», y el archivo queda dentro de la carpeta de datos.
  if (typeof d.hereda !== 'string' || !/^[a-z0-9-]+$/.test(d.hereda)) throw new Error(`${archivo}: «hereda» no es un nombre válido (solo a-z, 0-9 y guion)`);
  if (!resolve(DATOS, `${d.hereda}.json`).startsWith(resolve(DATOS) + sep)) throw new Error(`${archivo}: «hereda» sale de la carpeta de datos`);
  const base = cargarDatos(`${d.hereda}.json`, [...pila, archivo]);
  const { hereda, ...propio } = d;
  return {
    ...base, ...propio,
    credenciales: { ...base.credenciales, ...(propio.credenciales || {}) },
    receptor: { ...base.receptor, ...(propio.receptor || {}) },
    configBase: { ...base.configBase, ...(propio.configBase || {}) },
  };
}

// L1. LOS DATOS DEL TENANT SE METEN DENTRO DE EXPRESIONES Y DE TEXTO DE NODOS (`@@dato:…@@`): un valor con una comilla, una
// barra invertida, una llave o un salto de línea podría cerrar la cadena y agregar código. `dato()` los rechaza, y
// `validarDatos` exige la forma de cada dato conocido (el marcador `REEMPLAZAR_*` o el valor real).
const CARACTERES_PELIGROSOS = /["'\\{}\r\n]/;
const FORMAS = {
  'receptor.wabaIdEsperado': /^(\d{6,25}|REEMPLAZAR_[A-Z0-9_]+)$/,
  'receptor.ruta': /^[A-Za-z0-9_/-]+$/,
  'receptor.urlVerificador': /^(https?:\/\/[^\s"'\\{}]+|REEMPLAZAR_[A-Z0-9_]+)$/,
  pruebaRuta: /^[A-Za-z0-9_/-]+$/,
};

function dato(datos, ruta, donde) {
  let x = datos;
  for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
  if (typeof x !== 'string' || x === '') throw new Error(`${donde}: falta el dato «${ruta}» en el archivo del tenant`);
  if (CARACTERES_PELIGROSOS.test(x) && !ruta.startsWith('credenciales.') && ruta !== 'nombreFlujo') {
    throw new Error(`${donde}: el dato «${ruta}» trae una comilla, una barra invertida, una llave o un salto de línea`);
  }
  return x;
}

function validarDatos(datos, archivo) {
  const errores = [];
  for (const [ruta, forma] of Object.entries(FORMAS)) {
    let x = datos;
    for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
    if (x === undefined) continue;
    if (typeof x !== 'string' || !forma.test(x)) errores.push(`«${ruta}» no tiene la forma esperada ${forma}`);
  }
  // Ningún texto del archivo trae un salto de línea.
  const recorre = (v, ruta) => {
    if (typeof v === 'string') {
      if (/[\r\n]/.test(v)) errores.push(`«${ruta}» trae un salto de línea`);
    } else if (Array.isArray(v)) v.forEach((x, i) => recorre(x, `${ruta}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) recorre(x, ruta ? `${ruta}.${k}` : k);
  };
  recorre(datos, '');
  for (const [k, v] of Object.entries(datos.credenciales || {})) {
    if (typeof v !== 'string' || !v || v.length > 100 || v.startsWith('=') || /["\\]|\{\{/.test(v)) errores.push(`«credenciales.${k}» no es un nombre de credencial válido`);
  }
  // `configBase`: un texto que empieza con «=» lo toma n8n por una EXPRESIÓN (se evaluaría); comillas dobles, barras y llaves no van.
  for (const [k, v] of Object.entries(datos.configBase || {})) {
    if (typeof v !== 'string') continue;
    if (v.startsWith('=')) errores.push(`«configBase.${k}» empieza con «=» (n8n lo evaluaría como expresión)`);
    if (/["\\{}]/.test(v)) errores.push(`«configBase.${k}» trae una comilla doble, una barra invertida o una llave`);
  }
  // COBRO: los dos modos son excluyentes (prohibición 3 de CLAUDE.md). Se valida sobre los datos ya mezclados, así que la herencia cuenta.
  const cbz = datos.configBase || {};
  if (!MODOS_COBRO.includes(datos.modoCobro)) errores.push(`«modoCobro» debe ser ${MODOS_COBRO.join(', ')} (no «${datos.modoCobro}»)`);
  const tieneAct = Object.prototype.hasOwnProperty.call(cbz, 'cobroSimuladoActivo');
  const tieneUrl = Object.prototype.hasOwnProperty.call(cbz, 'qrSimuladoUrl');
  if (datos.modoCobro === 'simulado') {
    if (cbz.cobroSimuladoActivo !== true) errores.push('modoCobro «simulado» exige configBase.cobroSimuladoActivo = true (booleano)');
    if (typeof cbz.qrSimuladoUrl !== 'string' || !URL_QR_SIMULADO.test(cbz.qrSimuladoUrl)) errores.push('configBase.qrSimuladoUrl no es la imagen rotulada permitida (URL_QR_SIMULADO)');
  } else if (tieneAct || tieneUrl) {
    errores.push(`modoCobro «${datos.modoCobro}» no admite cobroSimuladoActivo ni qrSimuladoUrl (los dos modos son excluyentes)`);
  }
  if (errores.length) throw new Error(`${archivo}: datos no válidos: ${errores.join('; ')}`);
}

function reemplazarTextos(valor, datos, donde) {
  if (typeof valor === 'string') {
    return valor.replace(/@@dato:([A-Za-z0-9_.]+)@@/g, (_, ruta) => dato(datos, ruta, donde));
  }
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

function armar(datos, archivo) {
  const entrada = datos.entrada;
  if (!NODOS_DE_ENTRADA[entrada]) throw new Error(`${archivo}: entrada «${entrada}» no válida (receptor, trigger o prueba)`);
  const flujo = JSON.parse(JSON.stringify(plantilla));
  flujo.name = dato(datos, 'nombreFlujo', archivo);
  const retencion = retencionDe(salidaDe(archivo));
  flujo.settings = { ...flujo.settings, executionTimeout: timeoutDe(salidaDe(archivo)), saveDataSuccessExecution: retencion.exito, saveDataErrorExecution: retencion.error };
  const quitar = new Set(Object.entries(NODOS_DE_ENTRADA).filter(([k]) => k !== entrada).flatMap(([, v]) => v));
  if (entrada !== 'prueba') {
    for (const nombre of SOLO_PRUEBA) quitar.add(nombre);
    // Cada conexión que llegaba a un nodo salteado llega ahora a lo que ese nodo tenía en su salida elegida.
    for (const [puente, salida] of Object.entries(PUENTES_FUERA_DE_PRUEBA)) {
      const destino = ((flujo.connections[puente] || {}).main || [])[salida] || [];
      for (const salidas of Object.values(flujo.connections)) {
        salidas.main = (salidas.main || []).map((s) => (s || []).flatMap((c) => (c.node === puente ? destino : [c])));
      }
    }
  }
  flujo.nodes = flujo.nodes.filter((n) => !quitar.has(n.name));
  for (const n of flujo.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${archivo} · ${n.name}`);
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js === 'string' && js.startsWith('@@')) n.parameters.jsCode = codigoDe(js, n.name);
    for (const cred of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|graph|medios|entradaPrueba|trigger)$/.exec(cred.name);
      if (m) cred.name = dato(datos, `credenciales.${m[1]}`, `${archivo} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
  }
  const vivos = new Set(flujo.nodes.map((n) => n.name));
  const conexiones = {};
  for (const [de, salidas] of Object.entries(flujo.connections)) {
    if (!vivos.has(de)) continue;
    conexiones[de] = { main: (salidas.main || []).map((s) => (s || []).filter((c) => vivos.has(c.node))) };
  }
  flujo.connections = conexiones;
  const texto = JSON.stringify(flujo, null, 2) + '\n';
  // Una marca sin reemplazar: en cualquier texto salvo el código de los nodos (las librerías mencionan
  // «@@solo:» en un comentario) o, en el código, al principio del `jsCode`.
  const sinMarcas = (v, esCodigo) => {
    if (typeof v === 'string') return esCodigo ? !v.startsWith('@@') : !v.includes('@@');
    if (Array.isArray(v)) return v.every((x) => sinMarcas(x, false));
    if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => sinMarcas(x, k === 'jsCode'));
    return true;
  };
  if (!sinMarcas(flujo, false)) throw new Error(`${archivo}: quedó una marca @@ sin reemplazar`);
  const ids = flujo.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${archivo}: ids de nodo repetidos`);
  return texto;
}

// LA ENTRADA DEL CARRITO: la única segunda entrada de producción, con una forma exacta.
function guardiaDelCarrito(entrada, n, datos) {
  const h = [];
  const p = n.parameters || {};
  if (entrada !== 'receptor') h.push(`el webhook «${n.name}» solo va en la variante del receptor`);
  if (n.type !== 'n8n-nodes-base.webhook') h.push(`«${n.name}» no es un nodo Webhook`);
  if (p.httpMethod !== 'POST') h.push(`«${n.name}» debe recibir POST`);
  if (p.authentication !== 'headerAuth') h.push(`«${n.name}» debe autenticar con headerAuth (sin eso cualquiera puede mandar un carrito)`);
  if (p.responseMode !== 'onReceived') h.push(`«${n.name}» debe responder al recibir (responseMode onReceived)`);
  if (p.path !== MARCADOR_DEL_CARRITO || !MARCADORES_FIJOS[MARCADOR_DEL_CARRITO].test(String(p.path))) {
    h.push(`«${n.name}» debe llevar la ruta como marcador ${MARCADOR_DEL_CARRITO} (una URL de capacidad no se versiona)`);
  }
  const cred = (((n.credentials || {}).httpHeaderAuth) || {}).name;
  if (!cred || cred !== (datos.credenciales || {}).ingesta) h.push(`«${n.name}» debe usar la credencial de cabecera de la ingesta (${(datos.credenciales || {}).ingesta || 'sin dato'}), no «${cred || 'ninguna'}»`);
  if (typeof n.webhookId === 'string') h.push(`«${n.name}» no puede traer un webhookId (compartiría la ruta de Meta)`);
  return h;
}

// =====================================================================================================
// «SE ENTREGA LO QUE SE PROMETE» (rearquitectura, PR-7): R1, R3 y R5 sobre el JSON.
//   R1  un envío cuenta como hecho solo con un `messages[0].id` no vacío de Meta: `¿Falló el envío?` y el reporte saliente
//       deciden por el id, nunca por `$json.error`, y el reporte lleva `idMeta`;
//   R3  si el respaldo en texto también falla, la ejecución termina en ERROR: `Resumen del turno` (un Code que ya corre al final,
//       debajo de los envíos) lanza `throw` cuando faltan mensajes entregados; sin nodo aparte (presupuesto de nodos);
//   R5  ningún fallo tragado: un envío a Meta con `continueRegularOutput` exige un verificador del id declarado aquí, alcanzable
//       desde el envío y que lea `messages[0].id`; `continueErrorOutput` exige su salida de error conectada.
// =====================================================================================================
const VERIFICADOR_DE_ENVIO = {
  'Enviar a WhatsApp': '¿Falló el envío?',
  'Enviar respaldo': 'Resumen del turno',
  'Enviar aviso': 'Reunir avisos',
  'Aviso de respaldo': 'Armar mensajes',
};
const LEE_EL_ID = /messages[\s\S]{0,200}\bid\b|\bid\b[\s\S]{0,200}messages/;
const textoDe = (n) => JSON.stringify(((n.parameters || {}).conditions) || '') + String((n.parameters || {}).jsCode || '') + String((n.parameters || {}).jsonBody || '');
// ¿La URL es de Meta (Graph)? El patron va ANCLADO al inicio y el anfitrion tiene que ser el FIJO que abre la URL (con o sin el `=` de una
// expresion de n8n): los doce nodos de envio de los tres JSON lo traen asi (`=https://graph.facebook.com/{{ ... }}/messages`, con las
// llaves SOLO despues del anfitrion). Un texto que nombra el anfitrion en un parametro (`https://otro.dominio/?x=<anfitrion>`) o dentro
// de una expresion (`{{ 'x' }}<anfitrion>`) NO es un envio a Meta; y un anfitrion armado por expresion tampoco pasa la lista de
// `anfitrionPermitido`, que exige el anfitrion literal: `--verificar` lo rechaza igual. Sin busqueda por subcadena.
const URL_DE_META = /^=?\s*https?:\/\/graph\.facebook\.com(?:[/:?#]|$)/;
const esUrlDeMeta = (url) => URL_DE_META.test(String(url || '').trim().toLowerCase());
const esEnvioAMeta = (n) => n.type === 'n8n-nodes-base.httpRequest' && esUrlDeMeta((n.parameters || {}).url) && /\/messages\b/.test(String((n.parameters || {}).url || ''));

function alcanzables(flujo, desde) {
  const vistos = new Set([desde]);
  const cola = [desde];
  while (cola.length) {
    const actual = cola.shift();
    for (const salida of ((flujo.connections[actual] || {}).main || [])) {
      for (const c of salida || []) if (!vistos.has(c.node)) { vistos.add(c.node); cola.push(c.node); }
    }
  }
  return vistos;
}

// ¿Corre `v` después de `s` en una ejecución? Sí si cuelga de `s`, o si un mismo nodo los reparte a dos ramas y la de `v` va
// DESPUÉS en el lienzo (`executionOrder: v1` termina una rama entera antes de empezar la siguiente: de arriba hacia abajo y, a
// igual altura, de izquierda a derecha).
function correDespues(flujo, s, v) {
  if (alcanzables(flujo, s).has(v)) return true;
  const pos = new Map(flujo.nodes.map((n) => [n.name, n.position || [0, 0]]));
  const antes = (a, b) => (pos.get(a)[1] - pos.get(b)[1]) || (pos.get(a)[0] - pos.get(b)[0]);
  for (const padre of Object.keys(flujo.connections)) {
    const hijos = [...new Set(((flujo.connections[padre] || {}).main || []).flat().map((c) => c.node))];
    const rs = hijos.find((x) => alcanzables(flujo, x).has(s));
    const rv = hijos.find((x) => alcanzables(flujo, x).has(v));
    if (rs && rv && rs !== rv && antes(rs, rv) < 0) return true;
  }
  return false;
}

function guardiasDeEntrega(flujo) {
  const h = [];
  const porNombre = new Map(flujo.nodes.map((n) => [n.name, n]));
  const salidaConectada = (nombre, i) => ((((flujo.connections[nombre] || {}).main || [])[i]) || []).length > 0;
  // R5: lo que se hace con cualquier nodo cuya salida de error o cuyo `continue` pueda esconder un fallo.
  for (const n of flujo.nodes) {
    if (n.onError === 'continueErrorOutput' && !salidaConectada(n.name, 1)) h.push(`R5: «${n.name}» usa continueErrorOutput con la salida de error desconectada (el fallo se traga)`);
    if (n.continueOnFail === true && esEnvioAMeta(n)) h.push(`R5: «${n.name}» es un envío a Meta con continueOnFail`);
  }
  for (const n of flujo.nodes.filter(esEnvioAMeta)) {
    if (n.onError !== 'continueRegularOutput') continue; // sin onError el fallo detiene la ejecución: no se traga.
    const v = VERIFICADOR_DE_ENVIO[n.name];
    const nodoV = v ? porNombre.get(v) : undefined;
    if (!v) h.push(`R5: «${n.name}» (envío a Meta con continueRegularOutput) no tiene un verificador del id declarado en VERIFICADOR_DE_ENVIO`);
    else if (!nodoV) h.push(`R5: el verificador «${v}» de «${n.name}» no existe`);
    else if (!correDespues(flujo, n.name, v)) h.push(`R5: el verificador «${v}» no corre después de «${n.name}» (ni cuelga de él ni va en una rama posterior del lienzo)`);
    else if (!LEE_EL_ID.test(textoDe(nodoV))) h.push(`R5: el verificador «${v}» de «${n.name}» no lee messages[0].id`);
  }
  // R1: `¿Falló el envío?` y el reporte saliente deciden por el id, no por `$json.error`.
  const falla = porNombre.get('¿Falló el envío?');
  if (!falla) h.push('R1: falta «¿Falló el envío?»');
  else {
    const c = textoDe(falla);
    if (!LEE_EL_ID.test(c)) h.push('R1: «¿Falló el envío?» no decide por messages[0].id');
    if (/\.error\b/.test(c)) h.push('R1: «¿Falló el envío?» mira `error`: Meta puede rechazar sin devolverlo; debe decidir solo por el id');
  }
  const rep = porNombre.get('¿Reportar? (saliente)');
  if (!rep || !LEE_EL_ID.test(textoDe(rep))) h.push('R1: «¿Reportar? (saliente)» no exige messages[0].id (se reportaría un mensaje que no salió)');
  const sal = porNombre.get('Reportar mensaje (saliente)');
  if (!sal || !/idMeta\s*:[^;]*messages/.test(String((sal.parameters || {}).jsonBody || ''))) h.push('R1: «Reportar mensaje (saliente)» no manda `idMeta` desde messages[0].id');
  if (rep && sal && !alcanzables(flujo, 'Enviar a WhatsApp').has('Reportar mensaje (saliente)')) h.push('R1: el reporte saliente no cuelga de «Enviar a WhatsApp»');
  // R3: el último recurso lanza error, y corre DESPUÉS de los envíos.
  const res = porNombre.get('Resumen del turno');
  if (!res) h.push('R3: falta «Resumen del turno» (el último recurso: lanza error si el respaldo también falla)');
  else {
    const js = String((res.parameters || {}).jsCode || '');
    if (!/throw new Error\(/.test(js) || !/Enviar respaldo/.test(js) || !/Enviar a WhatsApp/.test(js) || !/messages/.test(js)) {
      h.push('R3: «Resumen del turno» no lanza error (`throw`) cuando el respaldo en texto también falla');
    }
    const envio = porNombre.get('¿Enviar de verdad?');
    const yRes = (res.position || [])[1];
    const yEnv = envio && (envio.position || [])[1];
    if (typeof yRes !== 'number' || typeof yEnv !== 'number' || !(yRes > yEnv)) h.push('R3: «Resumen del turno» debe estar por debajo de «¿Enviar de verdad?» en el lienzo (con executionOrder v1 corre después de los envíos)');
    if (flujo.nodes.some((x) => x.name === 'Entrega fallida')) h.push('R3: no hay nodo «Entrega fallida»: el último recurso va dentro de «Resumen del turno» (presupuesto de nodos)');
  }
  return h;
}

// LO QUE UN JSON DE PRODUCCIÓN NO PUEDE TENER, aunque alguien lo haya agregado a mano al archivo versionado.
//   - «Entrada de prueba»: es el único nodo que activa `modoPrueba`; en producción no debe existir, porque
//     una carga que lo trajera podría encender el modo prueba (mensajes a otro número, avisos simulados);
//   - «Simular aviso» y «¿Avisar de verdad?»: simulan que un aviso salió (L2); solo existen en la prueba;
//   - «WhatsApp Trigger» con la entrada del receptor: activarlo reescribe el webhook de toda la app de Meta
//     (prohibición 7 de CLAUDE.md).
function guardiasDeProduccion(entrada, flujo, datos = {}, destino = '') {
  const hallazgos = [];
  // INTERRUPTOR SOLO DE ENSAYO: `avisarAlPropioNumero` en «Config base» hace que el aviso al restaurante salga aunque el destinatario sea
  // quien escribe (un solo teléfono de ensayo). En cualquier otro JSON (producción de Q'Taco, prueba) sería avisar a un empleado de su
  // propio pedido y perder el hecho de «avisó a otra persona»: solo `venta-minima.ensayo-demo-a.json` puede llevarla. Se mira la
  // ASIGNACIÓN de «Config base» (el dato), no el código de los nodos, que nombra la clave para leerla.
  const base = flujo.nodes.find((n) => n.name === 'Config base');
  const asignadas = (((base || {}).parameters || {}).assignments || {}).assignments || [];
  if (destino !== SALIDA_CON_LA_CLAVE && asignadas.some((a) => a && a.name === CLAVE_SOLO_ENSAYO)) {
    hallazgos.push(`«Config base» trae «${CLAVE_SOLO_ENSAYO}» (interruptor solo de ensayo): solo ${SALIDA_CON_LA_CLAVE} puede llevarla`);
  }
  // COBRO SIMULADO: las dos claves van juntas o ninguna, con su forma exacta, y solo si los datos dicen `modoCobro: simulado`.
  const aAct = asignadas.find((a) => a && a.name === 'cobroSimuladoActivo');
  const aUrl = asignadas.find((a) => a && a.name === 'qrSimuladoUrl');
  if (aAct && !(aAct.type === 'boolean' && aAct.value === true)) hallazgos.push('«Config base».cobroSimuladoActivo debe ser el booleano true');
  if (!!aAct !== !!aUrl) hallazgos.push('«Config base» trae solo una de cobroSimuladoActivo / qrSimuladoUrl: van juntas o ninguna');
  if (aUrl && !(typeof aUrl.value === 'string' && URL_QR_SIMULADO.test(aUrl.value))) hallazgos.push('«Config base».qrSimuladoUrl no es la imagen rotulada permitida');
  if (aAct && datos.modoCobro !== 'simulado') hallazgos.push(`«Config base» trae el cobro simulado y los datos dicen modoCobro «${datos.modoCobro}»`);
  const nombres = new Set(flujo.nodes.map((n) => n.name));
  const tipos = flujo.nodes.map((n) => n.type);
  if (entrada !== 'prueba' && nombres.has('Entrada de prueba')) hallazgos.push('contiene el nodo «Entrada de prueba» (activa modoPrueba): solo va en el JSON de prueba');
  for (const solo of SOLO_PRUEBA) {
    if (entrada !== 'prueba' && nombres.has(solo)) hallazgos.push(`contiene el nodo «${solo}» (inventa avisos «salidos»): solo va en el JSON de prueba`);
  }
  // Retención de ejecuciones: por omisión NADA se guarda (las ejecuciones llevan texto de clientes) y el progreso y las ejecuciones manuales nunca se guardan. La UNICA excepción
  // declarada es el JSON de Q'Taco, que guarda todo (`all`/`all`) por decisión de Andres (04/10/2026): ver `RETENCION_POR_SALIDA`.
  const st = flujo.settings || {};
  const ret = retencionDe(destino);
  if (st.saveDataSuccessExecution !== ret.exito || st.saveDataErrorExecution !== ret.error || st.saveExecutionProgress !== false || st.saveManualExecutions !== false) {
    hallazgos.push(`los ajustes de retención de ${destino || 'este archivo'} deben ser saveDataSuccessExecution «${ret.exito}», saveDataErrorExecution «${ret.error}», saveExecutionProgress false y saveManualExecutions false`
      + (RETENCION_DECLARADA.has(destino)
        ? '; decisión de Andres (04/10/2026): Q\'Taco guarda TODO (fallas y éxitos) por lo menos 24 horas para diagnosticar; el riesgo está aceptado y declarado en DISENO.md (no se baja a «none» ni a «default» sin su decisión)'
        : '; las ejecuciones llevan texto de clientes: este archivo no guarda nada y no puede hacerlo sin declararlo en RETENCION_POR_SALIDA'));
  }
  if (st.executionTimeout !== timeoutDe(destino)) hallazgos.push(`el tiempo límite de ${destino || 'este archivo'} debe ser executionTimeout ${timeoutDe(destino)} (decisión de Andres, 04/10/2026: 120 s solo Q'Taco, 60 s el resto); tiene ${st.executionTimeout}`);
  // Presupuesto de nodos de producción.
  if (entrada !== 'prueba' && flujo.nodes.length > TOPE_DE_NODOS) {
    hallazgos.push(`tiene ${flujo.nodes.length} nodos y el tope de producción es ${TOPE_DE_NODOS}: reutilice los nodos existentes (el código vive en src/lib y src/nodos)`);
  }
  if (entrada === 'receptor' && tipos.includes('n8n-nodes-base.whatsAppTrigger')) hallazgos.push('contiene un «WhatsApp Trigger» en la variante del receptor (prohibición 7)');
  // L1. Ninguna llamada a las suscripciones de la app de Meta, en ningún nodo, texto ni código (prohibición 7).
  if (/subscriptions|subscribed_apps/i.test(JSON.stringify(flujo))) hallazgos.push('menciona «subscriptions» o «subscribed_apps»: ningún flujo toca las suscripciones de la app de Meta (prohibición 7)');
  // L1. Un nodo HTTP solo habla con Meta, con Gemini y con las Functions de la consola (o con un marcador por reemplazar).
  for (const n of flujo.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    const url = String((n.parameters || {}).url || '');
    if (!anfitrionPermitido(n.name, url)) hallazgos.push(`el nodo «${n.name}» llama a un anfitrión fuera de la lista (graph.facebook.com, generativelanguage.googleapis.com, las Functions de la consola)`);
  }
  // L1. Ningún webhook con ruta de prueba fuera de la variante de prueba. En el receptor, DOS webhooks como máximo: el suyo y el
  // del carrito del catálogo (con su forma exacta, ver `guardiaDelCarrito`); en los demás, solo el que corresponde.
  if (entrada !== 'prueba') {
    for (const n of flujo.nodes.filter((x) => x.type === 'n8n-nodes-base.webhook')) {
      const ruta = String((n.parameters || {}).path || '');
      if (/prueba/i.test(ruta) || (datos.pruebaRuta && ruta === datos.pruebaRuta)) hallazgos.push(`el webhook «${n.name}» tiene una ruta de prueba`);
      else if (n.name === WEBHOOK_DEL_CARRITO) hallazgos.push(...guardiaDelCarrito(entrada, n, datos));
      else if (n.name !== WEBHOOK_DEL_RECEPTOR) hallazgos.push(`el webhook «${n.name}» no es la entrada del receptor`);
    }
  }
  if (entrada === 'prueba' && nombres.has(WEBHOOK_DEL_CARRITO)) hallazgos.push(`la variante de prueba no lleva el webhook «${WEBHOOK_DEL_CARRITO}»`);
  // El marcador de la ruta aparece UNA vez (en `path`): repetido en una nota, `preparar-import.sh` pondría la URL de capacidad en texto visible.
  if (nombres.has(WEBHOOK_DEL_CARRITO) && JSON.stringify(flujo).split(MARCADOR_DEL_CARRITO).length - 1 !== 1) {
    hallazgos.push(`el marcador ${MARCADOR_DEL_CARRITO} debe aparecer una sola vez (en el path del webhook), no repetido en notas ni en código`);
  }
  // El carrito llega a `Carga de entrada` y a nada más (lo valida ese Code, SOLO si el webhook corrió).
  if (nombres.has(WEBHOOK_DEL_CARRITO)) {
    const sal = ((flujo.connections[WEBHOOK_DEL_CARRITO] || {}).main || []).flat().map((c) => c.node);
    if (sal.length !== 1 || sal[0] !== 'Carga de entrada') hallazgos.push(`«${WEBHOOK_DEL_CARRITO}» debe conectar solo con «Carga de entrada» (conecta con: ${sal.join(', ') || 'nada'})`);
  }
  // `Traer configuración` pide el catálogo completo: de ahí sale el enlace del catálogo web (`catalogoWeb.enlace`).
  const traer = flujo.nodes.find((n) => n.name === 'Traer configuración');
  if (!traer || !/catalogoCompleto:\s*true/.test(String((traer.parameters || {}).jsonBody || ''))) hallazgos.push('«Traer configuración» no pide `catalogoCompleto: true` (sin eso no llega el enlace del catálogo web)');
  hallazgos.push(...guardiasDeEntrega(flujo));
  // L1. Un WhatsApp Trigger (camino A) exige su credencial explícita, y nunca la de AAB1-WA-Prod (prohibición 7).
  for (const n of flujo.nodes.filter((x) => x.type === 'n8n-nodes-base.whatsAppTrigger')) {
    const nombre = String(((n.credentials || {}).whatsAppTriggerApi || {}).name || '');
    if (!nombre) hallazgos.push(`el «${n.name}» no trae una credencial explícita (whatsAppTriggerApi)`);
    else if (/aab1|wa-prod/i.test(nombre)) hallazgos.push(`el «${n.name}» usa una credencial de AAB1-WA-Prod (prohibición 7)`);
  }
  return hallazgos;
}

// L1. Los anfitriones con los que un nodo HTTP puede hablar. Una URL por expresión (`=…`) solo vale si su anfitrión está escrito
// antes de la primera llave; la única excepción es `Descargar medio`, que baja el medio de la URL que le devuelve Meta.
// A4. Las Functions de la consola son UN anfitrión exacto (el que ya usan los nodos de producción), no «cualquier
// *.cloudfunctions.net»: otro proyecto de Google recibiría el token de ingesta. Y el «anfitrión» es TODO lo que va entre
// «https://» y la primera barra, `?` o `#`: con un usuario (arroba) o un puerto delante o detrás del nombre, no es un anfitrión permitido.
const ANFITRION_CONSOLA = 'us-east1-novuchat-demo.cloudfunctions.net';
const ANFITRIONES = ['graph.facebook.com', 'generativelanguage.googleapis.com', ANFITRION_CONSOLA];
function anfitrionPermitido(nombreDelNodo, url) {
  if (/^REEMPLAZAR_[A-Z0-9_]+$/.test(url)) return true;
  if (nombreDelNodo === 'Descargar medio' && url === '={{ $json.url }}') return true;
  const m = /^=?https:\/\/([^/?#\s]*)/i.exec(url);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return false;
  return ANFITRIONES.includes(m[1].toLowerCase());
}

// L1. Cada `venta-minima.<x>.json` versionado nace de un archivo de datos (`ensayo.json` para la prueba): si el archivo de
// datos se borró o se renombró, el JSON quedó huérfano y nadie lo regenera.
// La clave del interruptor de ensayo y el único archivo de datos (y su salida) que puede traerla.
const CLAVE_SOLO_ENSAYO = 'avisarAlPropioNumero';
const DATOS_CON_LA_CLAVE = 'ensayo-demo-a.json';
const SALIDA_CON_LA_CLAVE = 'venta-minima.ensayo-demo-a.json';

function huerfanos() {
  const salidas = new Set(readdirSync(DATOS).filter((f) => f.endsWith('.json')).map(salidaDe));
  // Un `*.local.json` es lo que deja `preparar-import.sh` (con valores reales, ignorado por git): no es una salida versionada.
  return readdirSync(AQUI).filter((f) => /^venta-minima\..+\.json$/.test(f) && !/\.local\.json$/.test(f) && !salidas.has(f));
}

const salidaDe = (archivo) => (archivo === 'ensayo.json' ? 'venta-minima.prueba.json' : `venta-minima.${archivo.replace(/\.json$/, '')}.json`);

// El interruptor de ensayo NO se hereda ni se cuela: ningún archivo de datos salvo `ensayo-demo-a.json` puede nombrarlo (ni `qtaco.json`,
// de donde heredan los demás, ni `ensayo.json`). Se mira el TEXTO crudo de cada archivo, antes de mezclar nada.
for (const archivo of readdirSync(DATOS).filter((f) => f.endsWith('.json')).sort()) {
  if (archivo !== DATOS_CON_LA_CLAVE && readFileSync(join(DATOS, archivo), 'utf8').includes(CLAVE_SOLO_ENSAYO)) {
    throw new Error(`${archivo}: «${CLAVE_SOLO_ENSAYO}» es un interruptor solo de ensayo y solo puede estar en ${DATOS_CON_LA_CLAVE} (ni heredada de otro archivo de datos)`);
  }
}
let difiere = false;
for (const archivo of readdirSync(DATOS).filter((f) => f.endsWith('.json')).sort()) {
  const datos = cargarDatos(archivo);
  // A5. Solo `ensayo.json` puede ser la variante de prueba: cualquier otro archivo de datos (un tenant) tiene la entrada del
  // receptor o la del trigger. Sin esto, un `"entrada": "prueba"` en `qtaco.json` se saltaría las guardias de producción
  // (que no miran la «Entrada de prueba» ni los nodos simulados cuando la entrada es `prueba`).
  if (archivo !== 'ensayo.json' && !['receptor', 'trigger'].includes(datos.entrada)) {
    throw new Error(`${archivo}: solo ensayo.json puede tener entrada «prueba»; los demás archivos de datos usan «receptor» o «trigger» (no «${datos.entrada}»)`);
  }
  validarDatos(datos, archivo);
  const texto = armar(datos, archivo);
  const destino = salidaDe(archivo);
  const ruta = join(AQUI, destino);
  // Lo que se arma nunca viola las guardias (si la plantilla lo hiciera, falla la construcción)…
  const propios = guardiasDeProduccion(datos.entrada, JSON.parse(texto), datos, destino);
  if (propios.length) throw new Error(`${destino}: ${propios.join('; ')}`);
  if (verificar) {
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
    // …y el archivo VERSIONADO tampoco las viola (aunque alguien lo haya tocado a mano).
    let versionado = [];
    try { versionado = actual === null ? [] : guardiasDeProduccion(datos.entrada, JSON.parse(actual), datos, destino); } catch (e) { versionado = ['no es un JSON válido']; }
    if (versionado.length) {
      difiere = true;
      console.error(`✗ ${destino} ${versionado.join('; ')}`);
    } else if (actual !== texto) {
      difiere = true;
      console.error(`✗ ${destino} ${actual === null ? 'no existe' : 'difiere de lo que arma la plantilla'}: corra «node construir.mjs»`);
    } else {
      console.log(`✓ ${destino} al día`);
    }
  } else {
    writeFileSync(ruta, texto);
    console.log(`✓ ${destino} escrito (${JSON.parse(texto).nodes.length} nodos)`);
  }
}
if (verificar) {
  for (const f of huerfanos()) {
    difiere = true;
    console.error(`✗ ${f} ya no tiene archivo de datos en admin/scripts/datos/venta-minima/ (¿se borró o se renombró?): bórrelo o devuelva su archivo de datos`);
  }
}
process.exit(difiere ? 1 : 0);
