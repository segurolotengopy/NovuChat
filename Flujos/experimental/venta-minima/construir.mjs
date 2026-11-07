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
 *     El sufijo `+crm` (`@@todo+sesion+crm:…`, solo «Armar mensajes») agrega `src/lib/crm.js` (`vmProspectoCrm`, el miniCRM de Q'Taco).
 *     Y el sufijo `+sesion` (`@@todo+sesion:…`, `@@comun+sesion:…`) pega ENTRE las librerías y el nodo el módulo común
 *     `comun-sin-agente/src/sesion.js` (el estado de la conversación en el servidor, PR-4a): se INCLUYE, nunca se copia ni se edita.
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
import { hallazgosDelGuardado, injertarGuardado, URL_DESCARGA_GUARDADO } from '../comun-sin-agente/src/guardado.mjs';
import { textosDeHallazgos as hallazgosDeExpresionesN8n } from '../comun-sin-agente/src/expresiones.mjs';
import { hallazgosCrm, injertarCrm, ramaCrm, rutasPaqueteCrmSenales, urlEncabezados, validarMapaCrm } from '../comun-sin-agente/construir-crm.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATOS = join(AQUI, '../../../admin/scripts/datos/venta-minima');
const verificar = process.argv.includes('--verificar');

const leer = (ruta) => readFileSync(join(AQUI, ruta), 'utf8');
// El módulo común del estado de la conversación (PR-4a): lo INCLUYEN los nodos que marcan `+sesion`; la guardia compara con esta fuente.
const FUENTE_SESION = leer('../comun-sin-agente/src/sesion.js').trimEnd();
const ORDEN_LIBS = ['comun', 'pedido', 'reserva', 'avisos', 'promos', 'cobro'];
// Módulos comunes que se INCLUYEN (no se copian): viven en Flujos/src/modulos/<m>/ y van detrás de las librerías propias.
const MODULOS_COMUNES = ['../../src/modulos/pedidos/qr-del-pedido.js', '../../src/core/medios/anuncio-por-titular.js'];
const LIB = [...ORDEN_LIBS.map((n) => leer(`src/lib/${n}.js`)), ...MODULOS_COMUNES.map((r) => leer(r))].map((t) => t.trimEnd()).join('\n\n');
const COMUN = leer('src/lib/comun.js').trimEnd();
// El miniCRM de Q'Taco (`vmProspectoCrm`): se pega SOLO delante de «Armar mensajes» (`+crm`), no en todos los nodos.
const LIB_CRM = leer('src/lib/crm.js').trimEnd();
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
// de Q'Taco tiene como MÁXIMO 51 nodos (50 + el webhook del carrito; el 51 es «Guardar comprobante», por el pedido del 26/10 de que ningún comprobante se pierda; ver DISENO.md). Todo lo demás se hace dentro de los nodos que ya existen
// (el código vive en `src/lib` y `src/nodos`). `--verificar` falla si un JSON de producción (todo el que no es la variante de
// prueba) pasa de este tope.
// 50 + los 11 de la rama común del GUARDADO de medios (Flujos/experimental/comun-sin-agente/src/guardado.mjs, contrato M1↔M2 del 29/10/2026):
// excepción declarada por Andres el 29/10/2026 para el guardado de medios, +9 nodos desde el contrato v2 del 30/10 (eran 11): docs/versiones-por-cliente.md.
// +1: «Guardar comprobante» (pedido de Andres del 26/10/2026: ningún comprobante se pierde; ver DISENO.md).
// +9: el estado de la conversación y los vistos en el servidor (PR-4a; tope de Q'Taco 60 → 69, aprobado por Andres el 04/11/2026): «¿Hay estado?», «Sin estado», «¿Comprometer turno?», «Comprometer turno»,
// «¿Replanificar compromiso?», «Comprometer turno (2.º intento)», «Soltar mensajes», «Confirmar envío» y «Comprometer compensación» (9: se quitó «¿Compensar entrega?»; queda 0 de margen). Ver DISENO.md y docs/versiones-por-cliente.md.
// +2: los CUPOS pasan al servidor (PR-4b; tope de 69 a 71, aprobado por Andres (06/11/2026, en conversación)): «Consumir cupos» y «¿Cupo concedido?». `asentar` NO lleva nodo (segundo ítem de «Confirmar envío»).
// +10: el miniCRM de Q'Taco 3727 (módulo `crm`, `ramaCrm`: 8 nodos) y la IMAGEN de las campañas (2 nodos), de 71 a 81 (Andres, 06/11/2026: «D2 = tope de nodos aprobado»). 81 = 69 + 2 (cupos) + 2 (imagen) + 8 (miniCRM).
// El miniCRM solo lo lleva `venta-minima.qtaco-3727.json` (dato `crm`); reconciliado en la integración: el 3727 queda en 81 (el tope, sin margen), qtaco en 73. Ver DISENO.md y docs/versiones-por-cliente.md.
const TOPE_DE_NODOS = 81;

// LA SEGUNDA ENTRADA DE PRODUCCIÓN: el carrito del catálogo web (como el del Demo B). Un solo webhook, con este nombre exacto,
// su credencial de cabecera (la de la ingesta), `responseMode: onReceived` y la ruta como marcador (una URL de capacidad que
// reemplaza `preparar-import.sh`). Cualquier otro webhook sigue prohibido.
const WEBHOOK_DEL_CARRITO = 'Carrito del catálogo';
const WEBHOOK_DEL_RECEPTOR = 'Entrega del receptor';
// Marcadores que NO vienen de los datos del tenant (la plantilla los trae fijos) y la forma que deben tener.
const MARCADORES_FIJOS = { REEMPLAZAR_RUTA_CARRITO_QTACO: /^REEMPLAZAR_[A-Z0-9_]+$/, REEMPLAZAR_RUTA_CARRITO_QTACO_3727: /^REEMPLAZAR_[A-Z0-9_]+$/ };
const MARCADOR_DEL_CARRITO = 'REEMPLAZAR_RUTA_CARRITO_QTACO';
// Un segundo workflow del MISMO comercio (el de 3727) convive con el vivo: no puede compartir la ruta del carrito (n8n no activa dos webhooks en la misma ruta).
// El dato `carritoMarcador` (solo uno de estos dos valores) cambia el marcador de ESA salida; sin el rige el de siempre.

// Los NOMBRES de credencial y el marcador del carrito del 3727 son datos del tenant (`qtaco-3727.json`); aqui solo la lista de marcadores validos.
const MARCADORES_DEL_CARRITO = [MARCADOR_DEL_CARRITO, 'REEMPLAZAR_RUTA_CARRITO_QTACO_3727'];
const marcadorDelCarrito = (datos) => ((datos || {}).carritoMarcador) || MARCADOR_DEL_CARRITO;

// RETENCIÓN DE EJECUCIONES POR SALIDA. DECISIÓN DE ANDRES (04/10/2026, reemplaza la del 03/10): en el flujo de Q'Taco se guarda TODO, las fallas Y los
// éxitos (`all`/`all`), por lo menos 24 horas, para poder diagnosticar. El riesgo (M-1 de la revisión de seguridad del PR #382) está ACEPTADO por Andres y
// declarado en DISENO.md (sección «Retención de ejecuciones»): n8n guardará en su base el encabezado `Authorization` del webhook del carrito, los enlaces, la
// URL del QR y datos de clientes. Es la excepción de UN solo archivo: las variantes de prueba y de ensayo y cualquier otro tenant conservan `none` en todo
// (llevan texto de clientes) y no pueden guardar nada sin declararlo aquí. Cambiar esta entrada exige la decisión de Andres y una revisión de `seguridad`.
// DECISIÓN DE ANDRES (30/10/2026, contrato v2 de medios §8.1) que REEMPLAZA la del 04/10: con la rama del guardado de medios, el BINARIO del medio quedaría
// en los datos de la ejecución; Q'Taco deja de guardar ejecuciones (`none`/`none`), como todo flujo con medios. Se pierde diagnóstico, por privacidad.
const RETENCION_POR_SALIDA = {};
const RETENCION_DECLARADA = new Set();
const RETENCION_POR_OMISION = { exito: 'none', error: 'none' };
const retencionDe = (destino) => RETENCION_POR_SALIDA[destino] || RETENCION_POR_OMISION;

// TIEMPO LÍMITE DE LA EJECUCIÓN (`settings.executionTimeout`, en segundos) POR SALIDA. Decisión de Andres (04/10/2026): el flujo de Q'Taco sube a 120 s porque el
// peor caso del comprobante (57 s, ver DISENO.md) quedaba a 3 s de los 60 de la plantilla. SOLO Q'Taco: las variantes de prueba y de ensayo (aunque hereden sus
// datos) y la plantilla conservan los 60 s. Un tiempo más largo no cambia mensajes ni costo por conversación: solo deja de cortar una ejecución lenta.
// `qtaco-3727` (numero definitivo de Q'Taco, envio directo, 04/11/2026) es el MISMO comercio y el mismo peor caso: 120 s.
const TIMEOUT_POR_SALIDA = { 'venta-minima.qtaco.json': 120, 'venta-minima.qtaco-3727.json': 120 };
const timeoutDe = (destino) => TIMEOUT_POR_SALIDA[destino] || plantilla.settings.executionTimeout;

// COBRO SIMULADO (piloto de Q'Taco, 03/10/2026): la ÚNICA imagen permitida es el QR de demostración versionado, con el rótulo
// IMPRESO, fijado EXACTAMENTE a la etiqueta v0.11.0 (no a «cualquier vN.N.N»: una etiqueta futura podría traer otra imagen). Otro anfitrión, otra
// ruta u otra etiqueta = una imagen sin rótulo garantizado. Subir la etiqueta es una decisión revisada: se cambia aquí, en la prueba del blob
// (`venta-minima-flujo.test.ts`, que fija el contenido de la imagen) y en los datos, juntos.
const URL_QR_SIMULADO = /^https:\/\/raw\.githubusercontent\.com\/segurolotengopy\/NovuChat\/v0\.11\.0\/Demo-Recursos\/qr-demo\.png$/;
const MODOS_COBRO = ['simulado', 'real', 'sin_qr'];

function codigoDe(marca, nodo) {
  const m = /^@@(?:(solo|comun|todo)(\+sesion)?(\+crm)?:)?(nodos\/[a-z0-9-]+\.js)$/.exec(marca);
  if (!m) throw new Error(`${nodo}: ruta de código no válida: ${marca}`);
  const modo = m[1] || 'todo';
  const conSesion = m[2] === '+sesion';
  const ruta = m[4];
  const conCrm = m[3] === '+crm';
  if (conCrm && modo !== 'todo') throw new Error(`${nodo}: «+crm» solo va con «todo» (la librería del miniCRM usa los ayudantes de pedido)`);
  if (conSesion && modo === 'solo') throw new Error(`${nodo}: «+sesion» no va con «solo» (el módulo de sesión depende de comun.js)`);
  if (!existsSync(join(AQUI, 'src', ruta))) throw new Error(`${nodo}: no existe src/${ruta}`);
  const propio = leer(`src/${ruta}`).trimEnd();
  const base = modo === 'solo' ? [] : [modo === 'comun' ? COMUN : LIB];
  return base.concat(conSesion ? [FUENTE_SESION] : []).concat(conCrm ? [LIB_CRM] : []).concat([propio]).join('\n\n') + '\n';
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
      const m = /^@@cred:(ingesta|graph|medios|entradaPrueba|trigger|crm)$/.exec(cred.name);
      if (m) cred.name = dato(datos, `credenciales.${m[1]}`, `${archivo} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
    if (n.name === WEBHOOK_DEL_CARRITO && datos.carritoMarcador) {
      if (!MARCADORES_DEL_CARRITO.includes(datos.carritoMarcador)) throw new Error(`${archivo}: «carritoMarcador» no es uno de ${MARCADORES_DEL_CARRITO.join(', ')}`);
      n.parameters.path = datos.carritoMarcador;
    }
  }
  const vivos = new Set(flujo.nodes.map((n) => n.name));
  const conexiones = {};
  for (const [de, salidas] of Object.entries(flujo.connections)) {
    if (!vivos.has(de)) continue;
    conexiones[de] = { main: (salidas.main || []).map((s) => (s || []).filter((c) => vivos.has(c.node))) };
  }
  flujo.connections = conexiones;
  // EL miniCRM (módulo `crm`, solo con el dato `crm`): la rama de 8 nodos se GENERA (no se copia), cuelga de «Armar mensajes» por debajo del envío y del cierre y por encima de «Resumen del turno».
  if (datos.crm !== undefined) injertarRamaCrm(flujo, datos, archivo);
  // El GUARDADO de medios (módulo común, nunca copiado): cuelga de «Reportar mensaje (entrante)», debajo de todo; credenciales tomadas por nombre del flujo ya armado.
  injertarGuardado(flujo, { guardarUrl: `https://${ANFITRION_CONSOLA}/guardarMedio` });
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

// =====================================================================================================
// EL miniCRM DE Q'TACO (módulo `crm`). SOLO con el dato `crm` (hoy `qtaco-3727.json`); sin él no hay un solo nodo de planilla y «Armar mensajes» no calcula nada.
// La rama de 8 nodos la genera `ramaCrm` (no se copia); el mapa de columnas es DATO del tenant y lo valida el mismo `crmValidarMapa` que corre en n8n. MENSAJES: 0.
// =====================================================================================================
const NODOS_DE_CRM = ['Prospecto para la planilla', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Decidir fila de la planilla', '¿Acción de la planilla?', 'Agregar fila', 'Actualizar fila'];
const PAQUETES_CRM = (() => {
  const r = rutasPaqueteCrmSenales();
  const lee = (rutas) => rutas.map((x) => readFileSync(x, 'utf8').trimEnd());
  return {
    // La puerta del compromiso (`crm-prospecto.js`) va entre el módulo `crm.js` y el nodo: descarta el prospecto de un turno cuyo estado no quedó comprometido.
    'crm-prospecto-qtaco': [...lee(r['crm-prospecto'].slice(0, 1)), leer('src/lib/crm-prospecto.js').trimEnd(), ...lee(r['crm-prospecto'].slice(1))],
    // El adaptador de señales del módulo + el de Q'Taco (solo el resumen de la venta), antes del nodo de decidir fila.
    'crm-decidir-qtaco': [...lee(r['crm-decidir-senales'].slice(0, 2)), leer('src/lib/crm-planilla.js').trimEnd(), ...lee(r['crm-decidir-senales'].slice(2))],
  };
})();
function injertarRamaCrm(flujo, datos, archivo) {
  const errores = validarMapaCrm(datos.crm);
  if (errores.length) throw new Error(`${archivo}: el mapa \`crm\` no es válido: ${errores.join('; ')}`);
  const nombreCred = dato(datos, 'credenciales.crm', archivo);
  const rama = ramaCrm({ credencial: '@@cred:crm', desde: 'Armar mensajes', paquete: 'crm-decidir-qtaco', x: 8400, y: 700 });
  for (const n of rama.nodes) {
    if (n.name === 'Prospecto para la planilla') n.parameters.jsCode = '@@medio:crm-prospecto-qtaco';
    // Un fallo de estos dos Code no corta nada (el cliente ya recibió su respuesta): se continúa y «Decidir fila» lo trata como «sin teléfono».
    if (n.type === 'n8n-nodes-base.code') n.onError = 'continueRegularOutput';
    // Timeout explícito de 10 s en los nodos de Google Sheets (el HTTP de encabezados trae el suyo de 20 s).
    if (n.type === 'n8n-nodes-base.googleSheets') n.parameters.options = { ...n.parameters.options, timeout: 10000 };
    const m = typeof n.parameters.jsCode === 'string' ? /^@@medio:([a-z0-9-]+)$/.exec(n.parameters.jsCode) : null;
    if (m) {
      if (!PAQUETES_CRM[m[1]]) throw new Error(`${archivo} · ${n.name}: paquete «${m[1]}» desconocido`);
      n.parameters.jsCode = PAQUETES_CRM[m[1]].join('\n\n') + '\n';
    }
    for (const c of Object.values(n.credentials || {})) c.name = nombreCred;
  }
  flujo.nodes.push(...rama.nodes);
  Object.assign(flujo.connections, rama.connections);
  const previo = (((flujo.connections['Armar mensajes'] || {}).main || [])[0]) || [];
  flujo.connections['Armar mensajes'] = { main: [[...previo, { node: rama.entrada, type: 'main', index: 0 }]] };
  injertarCrm(flujo, datos.crm);
}

// La rama del miniCRM contra el JSON armado: presente solo con el dato `crm`, en su lugar del lienzo, sin ningún envío a Meta y con la credencial del tenant.
function guardiasDeCrm(flujo, datos) {
  const h = [];
  const nodos = flujo.nodes || [];
  const porNombre = new Map(nodos.map((n) => [n.name, n]));
  const conCrm = datos && datos.crm !== undefined;
  const presentes = NODOS_DE_CRM.filter((n) => porNombre.has(n));
  if (!conCrm) {
    if (presentes.length) h.push(`miniCRM: los datos no traen \`crm\` y el flujo lleva los nodos ${presentes.join(', ')}`);
    return h;
  }
  for (const n of NODOS_DE_CRM) if (!porNombre.has(n)) h.push(`miniCRM: falta el nodo «${n}»`);
  if (presentes.length !== NODOS_DE_CRM.length) return h;
  const y = (n) => ((porNombre.get(n) || {}).position || [])[1];
  const primero = 'Prospecto para la planilla';
  const destinos = [...new Set((((flujo.connections['Armar mensajes'] || {}).main || [])[0] || []).map((c) => c.node))];
  if (!destinos.includes(primero)) h.push('miniCRM: «Armar mensajes» no está conectado con «Prospecto para la planilla»');
  // 1. Posición: debajo del envío y del cierre, encima de «Resumen del turno», que sigue siendo el nodo más bajo del lienzo.
  for (const arriba of ['Enviar a WhatsApp', '¿Registrar cierre?', 'Registrar cierre']) {
    if (!(y(primero) > y(arriba))) h.push(`miniCRM: «${primero}» tiene que ir debajo de «${arriba}» en el lienzo (con executionOrder v1 el cliente recibe su mensaje y se registra el cierre antes de tocar Google)`);
  }
  // (la rama del guardado de medios cuelga de «Reportar mensaje (entrante)», corre antes y va más abajo en el lienzo: no cuenta; la comparación es entre lo que cuelga de «Armar mensajes»)
  const deArmar = alcanzables(flujo, 'Armar mensajes');
  const maxY = Math.max(...nodos.filter((n) => deArmar.has(n.name)).map((n) => (n.position || [0, 0])[1]));
  if (y('Resumen del turno') !== maxY) h.push('miniCRM: «Resumen del turno» tiene que seguir siendo el nodo más bajo de lo que cuelga de «Armar mensajes»');
  for (const n of NODOS_DE_CRM) if (!(y(n) < y('Resumen del turno'))) h.push(`miniCRM: «${n}» tiene que ir encima de «Resumen del turno»`);
  // 2. Cero mensajes: ningún nodo de la rama habla con Meta (ni cuelga de un envío).
  for (const n of NODOS_DE_CRM) {
    const nodo = porNombre.get(n);
    if (esEnvioAMeta(nodo)) h.push(`miniCRM: «${n}» envía a Meta (el miniCRM agrega 0 mensajes por conversación)`);
    if (JSON.stringify(nodo.parameters || {}).toLowerCase().includes(['graph', 'facebook', 'com'].join('.'))) h.push(`miniCRM: «${n}» menciona graph.facebook.com`);
  }
  // 3. La rama solo cuelga de «Armar mensajes»: nadie más entra a ella ni sale de ella hacia el resto del flujo.
  for (const [de, a] of Object.entries(flujo.connections)) {
    const hijos = ((a && a.main) || []).flat().map((c) => c && c.node);
    if (!NODOS_DE_CRM.includes(de) && de !== 'Armar mensajes' && hijos.some((x) => NODOS_DE_CRM.includes(x))) h.push(`miniCRM: «${de}» conecta con la rama de la planilla: solo «Armar mensajes» puede`);
    if (NODOS_DE_CRM.includes(de) && hijos.some((x) => !NODOS_DE_CRM.includes(x))) h.push(`miniCRM: «${de}» conecta con un nodo fuera de la rama de la planilla`);
  }
  // 4. La credencial de Google es la de ESTE tenant y de nadie más; todos los nodos de Google con onError continuar y alwaysOutputData (un fallo de Google no corta nada).
  const cred = (datos.credenciales || {}).crm;
  for (const n of nodos.filter((x) => NODOS_DE_CRM.includes(x.name))) {
    for (const c of Object.values(n.credentials || {})) if (c.name !== cred) h.push(`miniCRM: «${n.name}» usa la credencial «${c.name}» y no la de este negocio («${cred}»)`);
    if (n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation === 'read' && (n.onError !== 'continueRegularOutput' || n.alwaysOutputData !== true)) h.push(`miniCRM: «${n.name}» tiene que ser onError continueRegularOutput y alwaysOutputData`);
  }
  // 5. El id real de la hoja nunca va en el repositorio: solo el marcador (o vacío).
  const asign = (((porNombre.get('Config base') || {}).parameters || {}).assignments || {}).assignments || [];
  const id = asign.find((a) => a && a.name === 'planillaProspectosId');
  if (!id || !/^REEMPLAZAR_[A-Z0-9_]+$/.test(String(id.value))) h.push('miniCRM: «Config base».planillaProspectosId tiene que ser un marcador REEMPLAZAR_* (el id real de la hoja solo va en la tabla local o el .env)');
  // 6. Los rangos, la retención y la lectura de encabezados (módulo `crm`).
  h.push(...hallazgosCrm(flujo, datos.crm).map((x) => `miniCRM: ${x}`));
  return h;
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
  const marca = marcadorDelCarrito(datos);
  if (!MARCADORES_DEL_CARRITO.includes(marca) || p.path !== marca || !MARCADORES_FIJOS[marca].test(String(p.path))) {
    h.push(`«${n.name}» debe llevar la ruta como marcador ${marca} (una URL de capacidad no se versiona)`);
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

// =====================================================================================================
// EL ESTADO DE LA CONVERSACIÓN EN EL SERVIDOR (PR-4a): lo que `--verificar` exige sobre el JSON, armado y versionado.
//   - los nodos que usan o definen funciones `ss*` traen `comun-sin-agente/src/sesion.js` TAL CUAL (se INCLUYE, no se copia ni se edita) y declaran `SS_CONFIG` y cada `ss*` UNA vez;
//   - «Armar mensajes» cuelga SOLO de «¿Comprometer turno?»; el envío al cliente y el cierre cuelgan de «Soltar mensajes» y de ningún otro;
//   - los nodos «Comprometer *» llaman a configuracionFlujo, reintentan con el mismo idCompromiso (retryOnFail, maxTries >= 2) y no llevan `neverError`;
//   - «Traer configuración» pide el `leer` en los MISMOS espacios que declara `SS_CONFIG` (si divergen se lee un documento y se compromete otro) y manda el id del mensaje;
//   - la variante de PRUEBA nunca toca los documentos de producción: «Traer configuración» usa el espacio de prueba solo para `telefonosDePrueba`, «Carga de entrada» solo da `modoPrueba` si corrió «Entrada de prueba»;
//   - los avisos al local y los envíos nunca cuelgan de otro nodo que «Soltar mensajes» (nada sale antes del compromiso del estado).
// =====================================================================================================
const NODOS_DE_SESION = ['Comprometer turno', 'Comprometer turno (2.º intento)', 'Comprometer compensación', 'Consumir cupos'];
function guardiasDeSesion(entrada, flujo) {
  const h = [];
  const nodos = flujo.nodes || [];
  const porNombre = new Map(nodos.map((n) => [n.name, n]));
  const conex = flujo.connections || {};
  const destinosDe = (nombre) => [...new Set(((conex[nombre] || {}).main || []).flat().map((c) => c && c.node))];
  const parametros = (n) => n.parameters || {};
  for (const nombre of ['¿Hay estado?', 'Sin estado', '¿Comprometer turno?', 'Comprometer turno', '¿Replanificar compromiso?', 'Comprometer turno (2.º intento)', 'Soltar mensajes', 'Confirmar envío', 'Comprometer compensación', 'Consumir cupos', '¿Cupo concedido?']) {
    if (!porNombre.has(nombre)) h.push(`sesión: falta el nodo «${nombre}» (el estado de la conversación vive en el servidor)`);
  }
  // (la rama del miniCRM cuelga de «Armar mensajes» PERO debajo de todo: corre cuando el envío, el cierre y el compromiso ya terminaron; `guardiasDeCrm` la vigila)
  if (destinosDe('Armar mensajes').filter((x) => x !== 'Prospecto para la planilla').join('|') !== '¿Comprometer turno?') h.push('sesión: «Armar mensajes» tiene que colgar SOLO de «¿Comprometer turno?»: el estado se compromete antes de enviar');
  if (!destinosDe('Soltar mensajes').includes('¿Enviar de verdad?')) h.push('sesión: «¿Enviar de verdad?» tiene que colgar de «Soltar mensajes» (el envío va después del compromiso)');
  for (const [desde, a] of Object.entries(conex)) {
    const hijos = ((a && a.main) || []).flat().map((x) => x && x.node);
    if (desde !== 'Soltar mensajes' && hijos.includes('¿Enviar de verdad?')) h.push(`sesión: «${desde}» conecta con «¿Enviar de verdad?»: solo «Soltar mensajes» puede`);
    if (!['Soltar mensajes', 'Armar mensajes'].includes(desde) && hijos.includes('¿Registrar cierre?')) h.push(`sesión: «${desde}» conecta con «¿Registrar cierre?»: solo «Soltar mensajes» puede`);
  }
  // PR-4b, los cupos de aviso: `Consumir cupos` y `¿Cupo concedido?` cuelgan de la salida VERDADERA de `¿Hay avisos?`, con `Consumir cupos` MÁS ARRIBA en el lienzo (con executionOrder v1 corre primero) y de una sola llamada por turno
  // (`executeOnce`); NINGÚN aviso sale sin pasar por `¿Cupo concedido?` (el único padre de `¿Avisar de verdad?` / `Enviar aviso`); la salida falsa va a `Armar mensajes` (ningún aviso, un solo mensaje al cliente).
  const consumir = porNombre.get('Consumir cupos');
  const concedido = porNombre.get('¿Cupo concedido?');
  const hay = ((conex['¿Hay avisos?'] || {}).main || [])[0] || [];
  if (consumir && concedido) {
    if (!hay.some((c) => c && c.node === 'Consumir cupos') || !hay.some((c) => c && c.node === '¿Cupo concedido?')) h.push('cupos: «Consumir cupos» y «¿Cupo concedido?» tienen que colgar de la salida verdadera de «¿Hay avisos?»');
    const yC = (consumir.position || [])[1];
    const yI = (concedido.position || [])[1];
    if (typeof yC !== 'number' || typeof yI !== 'number' || !(yC < yI)) h.push('cupos: «Consumir cupos» tiene que estar por ENCIMA de «¿Cupo concedido?» en el lienzo (con executionOrder v1 corre primero)');
    if (consumir.executeOnce !== true) h.push('cupos: «Consumir cupos» tiene que ser executeOnce (una llamada por turno, no una por aviso)');
    if (destinosDe('Consumir cupos').length) h.push('cupos: «Consumir cupos» no tiene hijos (lo lee «¿Cupo concedido?» por nombre)');
    const salidas = ((conex['¿Cupo concedido?'] || {}).main || []);
    const aEnvio = (salidas[0] || []).map((c) => c && c.node);
    if (!(aEnvio.includes('¿Avisar de verdad?') || aEnvio.includes('Enviar aviso')) || ((salidas[1] || []).map((c) => c && c.node).join('|') !== 'Armar mensajes')) h.push('cupos: «¿Cupo concedido?» tiene que ir a los avisos por el sí y a «Armar mensajes» por el no');
    for (const [desde, a] of Object.entries(conex)) {
      const hijos = ((a && a.main) || []).flat().map((x) => x && x.node);
      if ((hijos.includes('Enviar aviso') || hijos.includes('¿Avisar de verdad?')) && desde !== '¿Cupo concedido?' && !(desde === '¿Avisar de verdad?' && hijos.includes('Enviar aviso'))) h.push(`cupos: «${desde}» conecta con los avisos al local: solo «¿Cupo concedido?» puede (ningún aviso sale sin consumir el cupo)`);
    }
  }
  for (const nombre of NODOS_DE_SESION) {
    const n = porNombre.get(nombre);
    if (!n) continue;
    if (!/\/configuracionFlujo$/.test(String(parametros(n).url || ''))) h.push(`sesión: «${nombre}» tiene que llamar a configuracionFlujo`);
    // Un 5xx o un timeout se reintenta con el MISMO idCompromiso (el servidor contesta `repetido` si ya se aplicó): reintento activo y sin `neverError` (con él un 5xx no se reintenta).
    if (n.retryOnFail !== true || !(n.maxTries >= 2) || JSON.stringify(parametros(n)).includes('neverError')) h.push(`sesión: «${nombre}» tiene que reintentar (retryOnFail, maxTries >= 2) y no llevar neverError`);
  }
  // El módulo común, tal cual, en todo nodo que lo use; y ninguna copia propia ni función redefinida (en JS gana la ÚLTIMA declaración).
  for (const n of nodos) {
    const js = String(parametros(n).jsCode || '');
    const codigo = js.replace(/^\s*\/\/.*$/gm, '');
    const usa = /\bss(CuerpoComprometer|CuerpoLeer|ResultadoDeCompromiso|SesionDeLaConfig|NumeroHeader)\(/.test(codigo);
    const define = /function ss[A-Z]\w*\(/.test(codigo);
    if ((usa || define) && !js.includes(FUENTE_SESION)) h.push(`sesión: el nodo «${n.name}» usa o define funciones de sesión (ss*) sin traer \`comun-sin-agente/src/sesion.js\` tal cual: se INCLUYE el módulo común, no se copia ni se edita`);
    if (/function (cn|vm)(CuerpoComprometer|CuerpoLeer|ResultadoDeCompromiso|SesionDeLaConfig)\(/.test(codigo)) h.push(`sesión: el nodo «${n.name}» trae una copia propia de los ayudantes de sesión`);
    if (usa || define) {
      const cuenta = new Map();
      for (const m of codigo.matchAll(/\b(?:function|const|let|var)\s+(ss[A-Z]\w*|SS_CONFIG)\b/g)) cuenta.set(m[1], (cuenta.get(m[1]) || 0) + 1);
      for (const [nombre, veces] of cuenta) if (veces !== 1) h.push(`sesión: el nodo «${n.name}» declara ${nombre} ${veces} veces: cada ayudante de sesión y SS_CONFIG se declaran UNA sola vez por nodo (la última declaración gana y anularía el módulo)`);
      if (!cuenta.has('SS_CONFIG')) h.push(`sesión: el nodo «${n.name}» tiene que declarar SS_CONFIG exactamente una vez`);
    }
  }
  // Los espacios de «Traer configuración» (el `leer`) y los de SS_CONFIG (los de `comprometer`) tienen que ser LOS MISMOS; el id del mensaje viaja en el `leer` (de ahí salen los repetidos).
  const traer = porNombre.get('Traer configuración');
  const declarados = /espacio: '([a-z0-9-]+)', espacioPrueba: '([a-z0-9-]+)'/.exec(COMUN);
  const cuerpo = String((traer && parametros(traer).jsonBody) || '');
  const enCuerpo = /prueba \? '([a-z0-9-]+)' : '([a-z0-9-]+)'/.exec(cuerpo);
  if (traer && (!declarados || !enCuerpo || enCuerpo[1] !== declarados[2] || enCuerpo[2] !== declarados[1])) h.push('sesión: «Traer configuración» tiene que pedir el estado en el MISMO espacio que declara SS_CONFIG (espacioPrueba cuando es una prueba, espacio en producción)');
  if (traer && !/idMensaje: id/.test(cuerpo)) h.push('sesión: «Traer configuración» tiene que mandar el idMensaje (de ahí sale el visto/repetido del servidor)');
  if (traer && !/telefonosDePrueba/.test(cuerpo)) h.push('sesión: «Traer configuración» en la prueba solo pide el estado para los `telefonosDePrueba`');
  // La variante de PRUEBA: «Entrada de prueba» siempre es modo prueba (nunca toca el espacio de producción); y producción no tiene «Entrada de prueba».
  const carga = porNombre.get('Carga de entrada');
  if (carga && !/modoPrueba: true/.test(String(parametros(carga).jsCode || ''))) h.push('sesión: «Carga de entrada» tiene que dejar `modoPrueba: true` siempre que corra «Entrada de prueba» (la prueba nunca toca los documentos de producción)');
  return h;
}

// EL SANDBOX DE EXPRESIONES DE n8n (07/11/2026). En una expresión (`={{ … }}`, cualquier parámetro de nodo que empiece con «=») n8n 2.36.5 NO deja leer
// `prototype`, `__proto__`, `constructor` ni `getPrototypeOf` (tampoco entre comillas): la expresión revienta («Cannot access "prototype" due to security concerns») y, en un IF sin `onError`, la ejecución
// muere sin dejar registro (así se perdieron las imágenes del 07/11 con `Object.prototype.hasOwnProperty` en «¿Es comprobante?»). Los nodos Code tienen otro
// sandbox y no entran aquí (su código no empieza con «=»). Para saber si una clave es propia en una expresión: `Object.keys(o).indexOf(k) >= 0`.
// La regla (qué se revisa y qué no cuenta) vive en `comun-sin-agente/src/expresiones.mjs`; la aplican las guardias de cada armador de
// `Flujos/experimental/*` (en `--verificar` y al construir) y la suite `admin/pruebas/core/expresiones-n8n.test.ts`.
const guardiaDeExpresiones = (flujo) => hallazgosDeExpresionesN8n(flujo);

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
  // EL NIT/CI NO SALE EN EL REPORTE: el cuerpo de «Reportar mensaje (saliente)» lleva lineas y entrega del qr_enviado, jamas la facturacion.
  for (const n of flujo.nodes) {
    if (n.name === 'Reportar mensaje (saliente)' && /facturacion|\bnit\b|documento|\bci\b/i.test(JSON.stringify((n.parameters || {}).jsonBody || ''))) {
      hallazgos.push('el cuerpo de «Reportar mensaje (saliente)» menciona «facturacion», «nit», «documento» o «ci»: el NIT/CI no viaja en el reporte');
    }
  }
  const nombres = new Set(flujo.nodes.map((n) => n.name));
  const tipos = flujo.nodes.map((n) => n.type);
  if (entrada !== 'prueba' && nombres.has('Entrada de prueba')) hallazgos.push('contiene el nodo «Entrada de prueba» (activa modoPrueba): solo va en el JSON de prueba');
  for (const solo of SOLO_PRUEBA) {
    if (entrada !== 'prueba' && nombres.has(solo)) hallazgos.push(`contiene el nodo «${solo}» (inventa avisos «salidos»): solo va en el JSON de prueba`);
  }
  // Retención de ejecuciones: por omisión NADA se guarda (las ejecuciones llevan texto de clientes) y el progreso y las ejecuciones manuales nunca se guardan. La UNICA excepción
  // declarada era el JSON de Q'Taco (04/10/2026); desde el 30/10 tampoco guarda (guardado de medios, contrato v2 §8.1): ver `RETENCION_POR_SALIDA`.
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
  // EL FLUJO DEL 3727 NO COMPARTE NADA CON EL VIVO: ni marcador de ruta, WABA o numero, ni credencial de Q'Taco (cada una cae en el flujo equivocado).
  if (/(^|\.)qtaco-3727\.json$/.test(destino)) {
    const t3727 = JSON.stringify(flujo);
    const vivo = [...new Set(t3727.match(/REEMPLAZAR_(RUTA_RECEPTOR|RUTA_CARRITO|WABA_ID|PHONE_NUMBER_ID)_QTACO(?!_3727)[A-Z0-9_]*/g) || [])];
    if (vivo.length) hallazgos.push(`el flujo del 3727 trae marcadores del flujo vivo: ${vivo.join(', ')}`);
    const credVivas = [...new Set(flujo.nodes.flatMap((n) => Object.values(n.credentials || {}).map((c) => String((c || {}).name || ''))).filter((x) => /Q'Taco/.test(x)))];
    if (credVivas.length) hallazgos.push(`el flujo del 3727 usa credenciales del flujo vivo: ${credVivas.join(', ')}`);
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
  if (nombres.has(WEBHOOK_DEL_CARRITO) && JSON.stringify(flujo).split(marcadorDelCarrito(datos)).length - 1 !== 1) {
    hallazgos.push(`el marcador ${marcadorDelCarrito(datos)} debe aparecer una sola vez (en el path del webhook), no repetido en notas ni en código`);
  }
  // El carrito llega a `Carga de entrada` y a nada más (lo valida ese Code, SOLO si el webhook corrió).
  if (nombres.has(WEBHOOK_DEL_CARRITO)) {
    const sal = ((flujo.connections[WEBHOOK_DEL_CARRITO] || {}).main || []).flat().map((c) => c.node);
    if (sal.length !== 1 || sal[0] !== 'Carga de entrada') hallazgos.push(`«${WEBHOOK_DEL_CARRITO}» debe conectar solo con «Carga de entrada» (conecta con: ${sal.join(', ') || 'nada'})`);
  }
  // `Traer configuración` pide el catálogo completo: de ahí sale el enlace del catálogo web (`catalogoWeb.enlace`).
  const traer = flujo.nodes.find((n) => n.name === 'Traer configuración');
  if (!traer || !/catalogoCompleto:\s*true/.test(String((traer.parameters || {}).jsonBody || ''))) hallazgos.push('«Traer configuración» no pide `catalogoCompleto: true` (sin eso no llega el enlace del catálogo web)');
  hallazgos.push(...guardiaDeExpresiones(flujo));
  hallazgos.push(...guardiasDeEntrega(flujo));
  hallazgos.push(...guardiasDeSesion(entrada, flujo));
  hallazgos.push(...guardiasDeCrm(flujo, datos));
  // El GUARDADO de medios (obligatorio en todo flujo con medios): la rama común completa, en su lugar y con las credenciales correctas.
  hallazgos.push(...hallazgosDelGuardado(flujo));
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
  // La descarga del GUARDADO: la URL del CDN de Meta solo si el tamaño que informó Meta cabe (la expresión exacta del módulo común).
  if (nombreDelNodo === 'Descargar medio (guardado)' && url === URL_DESCARGA_GUARDADO) return true;
  // La consulta de SOLO la fila de encabezados del miniCRM (Google Sheets API, `values.get`): la URL exacta del módulo común, con un rango A<fila>:<letra><fila>.
  if (nombreDelNodo === 'Leer encabezados de la planilla') {
    const [antes, despues] = urlEncabezados('@@').split('@@');
    if (url.startsWith(antes) && url.endsWith(despues) && /^[A-Z]+\d+:[A-Z]+\d+$/.test(url.slice(antes.length, url.length - despues.length))) return true;
  }
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
