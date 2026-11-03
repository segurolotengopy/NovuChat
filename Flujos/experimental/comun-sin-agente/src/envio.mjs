/**
 * =============================================================================
 * envio.mjs — la cadena de ENVÍO de un flujo «sin agente»: nodos y conexiones
 * =============================================================================
 *
 *   import { nodosDeEnvio, injertar } from '<ruta>/comun-sin-agente/src/envio.mjs';
 *
 * Sacado de «Enviar a WhatsApp» y compañía de `agenda-minima/flujo.plantilla.json`, que sigue con los suyos.
 * Lo que sale de «Armar mensajes» es UN ITEM POR MENSAJE (`src/mensajes.js`); esta cadena los manda:
 *
 *   Armar mensajes → ¿Enviar de verdad? ─sí→ Enviar a WhatsApp → ¿Falló el envío? ─sí→ Enviar respaldo ┐
 *                          └─no───────────────────────────────→ ¿Falló el envío? ─no───────────────────┤
 *                                                                              ¿Reportar? (saliente) ←───┘
 *                                                                    ─sí→ Reportar mensaje (saliente) → (salida)
 *                                                                    ─no────────────────────────────→ (salida)
 *
 * POR QUÉ ASÍ (cada punto salió de un incidente):
 *  - LOTE DE 1 CON 1,5 s: `options.batching.batch {batchSize:1, batchInterval:1500}`. Sin él n8n manda los items
 *    a la vez y Meta entregaba la confirmación y las redes fuera de orden (prueba real del 30/09).
 *  - `onError: continueRegularOutput` y `alwaysOutputData`: un rechazo de Meta NUNCA corta el turno; deja un item
 *    con `error` y el siguiente nodo decide. Nadie se queda sin respuesta.
 *  - RESPALDO: si Meta rechaza el interactivo o la plantilla, sale el MISMO contenido como texto (`respaldo`).
 *    Lee todo de «Armar mensajes», no de lo que devolvió el envío: así no depende de la forma de la respuesta.
 *  - `¿Enviar de verdad?`: en modo prueba con `enviarDeVerdad` falso el envío se saltea y los mensajes quedan
 *    como enviados (el corredor de pruebas lee el resultado sin gastar mensajes de WhatsApp).
 *  - REPORTE saliente: una llamada por mensaje al CLIENTE, no en modo prueba, con reintentos (3 veces, 2 s).
 *
 * LO QUE NO TIENE: ningún identificador. Las credenciales van POR NOMBRE (el publicador las empareja con las de
 * la instancia) y la URL de la ingesta es un parámetro obligatorio. Nada de esto lee un `.env` ni llama a la red.
 *
 * `opciones`:
 *   credenciales  { graph: 'nombre de la credencial Bearer de Graph', ingesta: 'nombre de la credencial de la ingesta' }  (obligatorias)
 *   ingestaUrl    URL de la ingesta de la consola (obligatoria)
 *   armado        nodo que arma los mensajes (por defecto «Armar mensajes»)
 *   config        nodo de configuración que trae `modoPrueba`, `enviarDeVerdad` y `telefonoDePrueba` («Config del negocio»)
 *   entrada       nodo que trae `phoneNumberId` del entrante, para la cabecera del reporte («Interpretar entrada»)
 *   para          valor de `para` que se reporta a la consola (por defecto «cliente»)
 *   reportar      false si el flujo no reporta: el reporte no se arma
 *   desde         [x, y] del primer nodo (por defecto [8120, 300])
 *   lote          { tamano: 1, intervaloMs: 1500 }
 *   reportarFallidos  true reporta TAMBIÉN el mensaje que no salió (como Agenda mínima). Por defecto no: si Meta rechazó el
 *                 original Y el respaldo, el mensaje no salió y no se cuenta como enviado.
 *   canal         'graph' (por defecto: nada cambia, ni un byte) o 'rele' (relé B9 de AAB1, ver abajo)
 *   cliente       (canal 'rele', obligatorio) prefijo de la Idempotency-Key: minúsculas, dígitos y guiones («rroca-evy»)
 *   releUrl       (canal 'rele') base del relé; por defecto el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE, que reemplaza el publicador. Nunca la URL real en el repositorio.
 *   credenciales.rele  (canal 'rele', en lugar de `graph`) nombre de la credencial Header Auth «AAB1 envío · <alias>»
 * Devuelve { nodes, connections, entrada, salidas }: `entrada` es el nombre del primer nodo (cuélguelo de «armado») y
 * `salidas` son los nodos que hay que conectar a lo que sigue (el último del reporte y su rama «no»).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPERADOR_BOOLEANO = { type: 'boolean', operation: 'true', singleValue: true };
const condicion = (izquierda) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: 'c1', leftValue: izquierda, rightValue: true, operator: OPERADOR_BOOLEANO }],
    combinator: 'and',
  },
  options: {},
});
const enlace = (a, indice = 0) => ({ node: a, type: 'main', index: indice });

export function nodosDeEnvio(opciones = {}) {
  const o = opciones;
  if (o.canal !== undefined && o.canal !== 'graph' && o.canal !== 'rele') throw new Error(`canal desconocido: ${String(o.canal).slice(0, 20)} (graph o rele)`);
  if (o.canal === 'rele') return nodosDeEnvioRele(o);
  const graph = o.credenciales && o.credenciales.graph;
  const ingesta = o.credenciales && o.credenciales.ingesta;
  if (!graph) throw new Error('falta credenciales.graph (el nombre de la credencial Bearer de Graph)');
  const reportar = o.reportar !== false;
  if (reportar && !ingesta) throw new Error('falta credenciales.ingesta (el nombre de la credencial de la ingesta)');
  if (reportar && !/^https:\/\//.test(String(o.ingestaUrl || ''))) throw new Error('falta ingestaUrl (https://…)');
  const armado = o.armado || 'Armar mensajes';
  const config = o.config || 'Config del negocio';
  const entrada = o.entrada || 'Interpretar entrada';
  const para = o.para || 'cliente';
  const [x0, y0] = o.desde || [8120, 300];
  const lote = { batch: { batchSize: (o.lote && o.lote.tamano) || 1, batchInterval: (o.lote && o.lote.intervaloMs) || 1500 } };
  const A = `$('${armado}')`;
  const credencialDeGraph = { httpHeaderAuth: { id: '', name: graph } };

  const nodes = [
    {
      id: 'enviar-si', name: '¿Enviar de verdad?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x0, y0],
      parameters: condicion(`={{ (() => { const c = $('${config}').first().json; return $json.sinMensajes !== true && (c.modoPrueba !== true || (c.enviarDeVerdad === true && !!c.telefonoDePrueba)); })() }}`),
      notes: 'En modo prueba con enviarDeVerdad falsa el envio se saltea y los mensajes quedan como enviados.',
    },
    {
      id: 'enviar', name: 'Enviar a WhatsApp', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x0 + 240, y0 - 140],
      credentials: credencialDeGraph, onError: 'continueRegularOutput', alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: "=https://graph.facebook.com/{{ /^v\\d+\\.\\d$/.test(String($json.waGraphVersion)) ? $json.waGraphVersion : 'v26.0' }}/{{ String($json.phoneNumberId).replace(/\\D/g, '') }}/messages",
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.payload) }}',
        options: { timeout: 15000, batching: lote },
      },
      notes: 'Un solo nodo para todo (texto, botones, lista, enlace, plantilla). Envía de a uno con 1,5 s entre mensajes: Meta entregaba un mensaje y el siguiente fuera de orden.',
    },
    {
      id: 'fallo-si', name: '¿Falló el envío?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x0 + 480, y0],
      parameters: condicion('={{ !!($json && $json.error) }}'),
      notes: 'Solo mira un campo `error` explicito; sin el, no fallo.',
    },
    {
      id: 'enviar-respaldo', name: 'Enviar respaldo', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x0 + 720, y0 - 140],
      credentials: credencialDeGraph, onError: 'continueRegularOutput', alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: `=https://graph.facebook.com/{{ /^v\\d+\\.\\d$/.test(String(${A}.item.json.waGraphVersion)) ? ${A}.item.json.waGraphVersion : 'v26.0' }}/{{ String(${A}.item.json.phoneNumberId).replace(/\\D/g, '') }}/messages`,
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: ${A}.item.json.para, type: 'text', text: { preview_url: true, body: String(${A}.item.json.respaldo || '').slice(0, 4000) } }) }}`,
        options: { timeout: 15000, batching: lote },
      },
      notes: 'Si Meta rechaza el interactivo o la plantilla, sale el mismo contenido como texto. Envía de a uno con 1,5 s entre mensajes.',
    },
  ];
  const connections = {
    '¿Enviar de verdad?': { main: [[enlace('Enviar a WhatsApp')], [enlace('¿Falló el envío?')]] },
    'Enviar a WhatsApp': { main: [[enlace('¿Falló el envío?')]] },
  };
  let salidas;
  if (reportar) {
    nodes.push(
      {
        id: 'reportar-sal-si', name: '¿Reportar? (saliente)', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x0 + 960, y0],
        parameters: condicion(o.reportarFallidos === true
          ? `={{ ${A}.item.json.reportar === true }}`
          : `={{ ${A}.item.json.reportar === true && !($json && $json.error) }}`),
        notes: `Solo lo que se envio AL CLIENTE se reporta (para = «${para}»), no en modo prueba y no si ni el respaldo salió (sin idMeta no se cuenta como enviado).`,
      },
      {
        id: 'reportar-saliente', name: 'Reportar mensaje (saliente)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x0 + 1200, y0 - 140],
        credentials: { httpHeaderAuth: { id: '', name: ingesta } }, onError: 'continueRegularOutput', alwaysOutputData: true,
        retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
        parameters: {
          method: 'POST', url: String(o.ingestaUrl),
          authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
          sendHeaders: true, headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: `={{ $('${entrada}').first().json.phoneNumberId }}` }] },
          sendBody: true, specifyBody: 'json',
          jsonBody: `={{ (() => { const m = ${A}.item.json; return JSON.stringify({ telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: ((($json || {}).messages || [])[0] || {}).id || '', evento: m.evento }); })() }}`,
          options: {},
        },
        notes: 'Una llamada por cada mensaje enviado al cliente. Lee el texto del nodo que arma los mensajes, no de la respuesta del envio.',
      },
    );
    connections['¿Falló el envío?'] = { main: [[enlace('Enviar respaldo')], [enlace('¿Reportar? (saliente)')]] };
    connections['Enviar respaldo'] = { main: [[enlace('¿Reportar? (saliente)')]] };
    connections['¿Reportar? (saliente)'] = { main: [[enlace('Reportar mensaje (saliente)')], []] };
    connections['Reportar mensaje (saliente)'] = { main: [[]] };
    salidas = [{ nodo: 'Reportar mensaje (saliente)', salida: 0 }, { nodo: '¿Reportar? (saliente)', salida: 1 }];
  } else {
    connections['¿Falló el envío?'] = { main: [[enlace('Enviar respaldo')], []] };
    connections['Enviar respaldo'] = { main: [[]] };
    salidas = [{ nodo: 'Enviar respaldo', salida: 0 }, { nodo: '¿Falló el envío?', salida: 1 }];
  }
  return { nodes, connections, entrada: '¿Enviar de verdad?', salidas };
}

/** Deja el código sin comentarios ni contenido de cadenas o plantillas (cada carácter pasa a espacio, el largo no cambia): solo queda código real. */
function soloCodigo(js) {
  const s = String(js);
  let o = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    const d = s[i + 1];
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') { o += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      const f = s.indexOf('*/', i + 2);
      const hasta = f < 0 ? s.length : f + 2;
      while (i < hasta) { o += s[i] === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      o += c; i++;
      while (i < s.length && s[i] !== c) { if (s[i] === '\\') { o += ' '; i++; } o += s[i] === '\n' ? '\n' : ' '; i++; }
      if (i < s.length) { o += c; i++; }
      continue;
    }
    o += c; i++;
  }
  return o;
}

/**
 * ¿«Armar mensajes» numera sus mensajes? La llamada `cmNumerar(…)` tiene que ser CÓDIGO REAL (no un comentario, una cadena, ni la definición `function cmNumerar(`)
 * y estar en el `return` FINAL del nodo, a nivel de función (fuera de llaves): así no vale `'cmNumerar(x)'` dentro de un texto, ni `if (false) cmNumerar([])`, ni un
 * `return` temprano que no la lleva. No ejecuta el código: el límite es que una expresión muerta dentro del propio return (`return false ? cmNumerar(x) : x`) pasaría.
 */
export function llamaANumerar(js) {
  const c = soloCodigo(js).replace(/\bfunction\s+cmNumerar\s*\(/g, 'function ______(');
  let profundidad = 0;
  let ultimo = -1;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === '{') profundidad++;
    else if (c[i] === '}') profundidad--;
    else if (profundidad === 0 && c.startsWith('return', i) && !/[A-Za-z0-9_$.]/.test(c[i - 1] || ' ') && !/[A-Za-z0-9_$]/.test(c[i + 6] || ' ')) ultimo = i;
  }
  return ultimo >= 0 && /(?<![A-Za-z0-9_$.])cmNumerar\s*\(/.test(c.slice(ultimo + 6));
}

/**
 * Lo que le falta a la cadena del relé en un flujo ya armado (vacío si está bien). Hoy verifica la FALLA CERRADA de «Leer respuesta del relé»: su código tiene que ser
 * `codigos.js` + `decidir-envio.js` tal cual y declarar `incierto` (`ORIGEN-AMBIGUO`) si «¿Enviar de verdad?» corrió más de una vez (origen cruzado posible).
 */
export function hallazgosDelEnvioRele(flujo) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const leer = nodos.find((n) => n.name === 'Leer respuesta del relé');
  if (!leer) return ['envio rele: falta «Leer respuesta del relé»'];
  const js = String((leer.parameters || {}).jsCode || '');
  if (!js.includes(FUENTE_DECIDIR_ENVIO) || !js.includes(FUENTE_CODIGOS_RELE)) h.push('envio rele: «Leer respuesta del relé» no incluye codigos.js y decidir-envio.js tal cual');
  if (!/ORIGEN-AMBIGUO/.test(js) || !/\$\('¿Enviar de verdad\?'\)\.all\(0, 1\)/.test(js)) h.push('envio rele: «Leer respuesta del relé» no falla cerrado si «¿Enviar de verdad?» corrió más de una vez (origen cruzado)');
  return h;
}

/**
 * Injerta la cadena en una plantilla (objeto del flujo): agrega los nodos y conexiones, cuelga la entrada de
 * `armado` y conecta las salidas a `siguiente` (si se da). Devuelve la misma plantilla. Lanza si un nombre ya existe.
 */
export function injertar(plantilla, opciones = {}) {
  const f = nodosDeEnvio(opciones);
  const armado = opciones.armado || 'Armar mensajes';
  const existentes = new Set(plantilla.nodes.map((n) => n.name));
  if (!existentes.has(armado)) throw new Error(`la plantilla no tiene el nodo «${armado}»`);
  for (const n of f.nodes) if (existentes.has(n.name)) throw new Error(`la plantilla ya tiene un nodo «${n.name}»`);
  if (opciones.canal === 'rele') {
    // Sin `n` la Idempotency-Key lanza y NADA sale: el nodo que arma los mensajes tiene que numerarlos con `cmNumerar(…)` (una LLAMADA, no solo la definición de mensajes.js).
    const nodoArmado = plantilla.nodes.find((n) => n.name === armado);
    if (!llamaANumerar(String((nodoArmado.parameters || {}).jsCode || ''))) throw new Error(`canal rele: el código de «${armado}» no llama a cmNumerar(…): sin el número del mensaje no hay Idempotency-Key y no sale ningún mensaje`);
  }
  plantilla.nodes.push(...f.nodes);
  plantilla.connections = Object.assign({}, plantilla.connections, f.connections);
  const previo = plantilla.connections[armado] && plantilla.connections[armado].main;
  plantilla.connections[armado] = { main: [[...((previo && previo[0]) || []), enlace(f.entrada)]] };
  if (opciones.siguiente) {
    if (!existentes.has(opciones.siguiente)) throw new Error(`la plantilla no tiene el nodo «${opciones.siguiente}»`);
    for (const s of f.salidas) {
      const c = plantilla.connections[s.nodo];
      c.main[s.salida] = [...(c.main[s.salida] || []), enlace(opciones.siguiente)];
    }
  }
  return plantilla;
}

// =============================================================================
// CANAL «rele»: el envío por el relé B9 de AAB1 (plan del 02/11/2026, decisiones D1 a D4 de Andres)
// =============================================================================
//   ¿Enviar de verdad? ─sí→ Enviar a WhatsApp → Leer respuesta del relé → ¿Qué hacer con el envío? ─reintentar→ Esperar reintento ─┐ (vuelve a «Enviar a WhatsApp»)
//                          │                                                          ├─respaldo→ Enviar respaldo ─┐
//                          │                                                          └─listo (ok, incierto o agotado)─┐
//                          └─no──────────────────────────────────────────────────────────────────────────────────────┴→ ¿Reportar? (saliente) → …
// Son DOS nodos más que la cadena de Graph (D1): «¿Falló el envío?» desaparece y entran «Leer respuesta del relé», «¿Qué hacer con el envío?» y «Esperar reintento».
// El contrato del relé (AAB1 envío): Header Auth «AAB1 envío · <alias>»; `Idempotency-Key` obligatoria (la MISMA en cada reintento del mismo mensaje);
// tiempo de espera de 30 s; el nodo no aborta en un no-2xx (`neverError`, sin `fullResponse`: éxito = {messages:[{id}]}, error = {error:{codigo, reintentable}});
// un 504 WM-3041 NUNCA se reenvía; un 429 WM-3037 espera 61 a 64 s una vez; un 409 WM-3035 espera 2 a 3 s; WM-3032 rechaza cualquier `link`.
// El destinatario va sin «+», el cuerpo solo lleva las claves de la Cloud API que el relé acepta y pesa hasta 64 KiB.
export const MARCADOR_URL_DEL_RELE = 'REEMPLAZAR_URL_INTERNA_DEL_RELE';
export const PREFIJO_CREDENCIAL_RELE = 'AAB1 envío · ';
export const NODOS_DEL_ENVIO_RELE = ['¿Enviar de verdad?', 'Enviar a WhatsApp', 'Leer respuesta del relé', '¿Qué hacer con el envío?', 'Esperar reintento', 'Enviar respaldo', '¿Reportar? (saliente)', 'Reportar mensaje (saliente)'];
/** Las claves del cuerpo que el relé acepta (el resto se descarta). */
export const CLAVES_DEL_CUERPO_RELE = ['messaging_product', 'recipient_type', 'to', 'type', 'text', 'interactive', 'template', 'reaction', 'image', 'audio', 'video', 'document', 'sticker'];
export const LIMITE_DEL_CUERPO_RELE = 64 * 1024;
export const ROLES_DE_CLAVE_RELE = ['enviar', 'respaldo', 'aviso', 'avisoguardado'];

const AQUI_ENVIO = dirname(fileURLToPath(import.meta.url));
export const FUENTE_CODIGOS_RELE = readFileSync(join(AQUI_ENVIO, '../../../src/core/rele/codigos.js'), 'utf8').trimEnd();
export const FUENTE_DECIDIR_ENVIO = readFileSync(join(AQUI_ENVIO, '../../../src/core/rele/decidir-envio.js'), 'utf8').trimEnd();

/** La base del relé que admite el repositorio: SOLO el marcador (lo reemplaza el publicador); las pruebas pueden usar un host `*.example` (con puerto opcional). */
export function esBaseDeReleAdmitida(base) {
  const b = String(base);
  return b === MARCADOR_URL_DEL_RELE || /^https?:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.example(?::\d{1,5})?$/.test(b);
}

/** Valida lo que el canal «rele» exige y devuelve { cliente, releUrl, credencial }. Lanza si falta algo. */
export function validarRele(o = {}) {
  const cliente = String(o.cliente || '');
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(cliente)) throw new Error('rele: falta cliente (minúsculas, dígitos y guiones, hasta 30: el prefijo de la Idempotency-Key)');
  const releUrl = String(o.releUrl === undefined ? MARCADOR_URL_DEL_RELE : o.releUrl);
  if (!esBaseDeReleAdmitida(releUrl)) throw new Error('rele: releUrl tiene que ser el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE (solo las pruebas admiten un host *.example, sin ruta ni barra final)');
  const credencial = String((o.credenciales || {}).rele || '');
  if (!credencial.startsWith(PREFIJO_CREDENCIAL_RELE) || credencial.length <= PREFIJO_CREDENCIAL_RELE.length) throw new Error(`rele: falta credenciales.rele con la forma «${PREFIJO_CREDENCIAL_RELE}<alias>» (Header Auth)`);
  if (/ingesta/i.test(credencial)) throw new Error('rele: la credencial del relé no puede ser la de ingesta');
  if (/[\r\n'"\\`$]/.test(credencial)) throw new Error('rele: el nombre de la credencial trae caracteres no válidos');
  return { cliente, releUrl, credencial };
}

/**
 * La Idempotency-Key como EXPRESIÓN de n8n: `<cliente>-<flujo>-<ejecución>-<rol>-<n>` (flujo = `$workflow.id`, saneado igual que la ejecución). `n` es el número del mensaje (`cmNumerar`) y se exige entero positivo: si falta,
 * la expresión LANZA (el nodo no envía) en vez de mandar `undefined` y dejar que dos mensajes distintos compartan clave, que el relé tomaría por un repetido.
 * La misma `n` y la misma ejecución dan la misma clave en cada reintento.
 */
export function claveDeIdempotencia(cliente, rol, nExpresion) {
  if (!ROLES_DE_CLAVE_RELE.includes(rol)) throw new Error(`rele: rol de clave desconocido: ${String(rol).slice(0, 20)}`);
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(String(cliente))) throw new Error('rele: cliente no válido');
  const n = `(() => { const n = ${nExpresion}; if (!Number.isInteger(n) || n < 1) throw new Error('falta el numero del mensaje (n)'); return n; })()`;
  // `$workflow.id` entra en la clave: dos flujos de un mismo cliente que comparten el contador de ejecuciones no pueden repetir una clave y hacer que el relé tome un mensaje por otro.
  return `={{ '${cliente}-' + String($workflow.id).replace(/[^A-Za-z0-9_.-]/g, '_') + '-' + String($execution.id).replace(/[^A-Za-z0-9_.-]/g, '_') + '-${rol}-' + ${n} }}`;
}

/**
 * El cuerpo del relé como EXPRESIÓN: solo las claves permitidas, `messaging_product` fijo, el destinatario sin «+» (solo dígitos), ninguna clave `link` en
 * ningún nivel (el relé rechaza cualquier link con WM-3032) y no más de 64 KiB (si pasa, la expresión LANZA y no se envía nada).
 */
export function cuerpoParaElRele(payloadExpresion, destinoExpresion) {
  return `={{ (() => { const p = ${payloadExpresion}; const o = {}; for (const k of ${JSON.stringify(CLAVES_DEL_CUERPO_RELE)}) { if (p && p[k] !== undefined) o[k] = p[k]; } `
    + `o.messaging_product = 'whatsapp'; o.to = String(${destinoExpresion}).replace(/\\D/g, ''); `
    + `const sin = (v) => { if (Array.isArray(v)) return v.map(sin); if (v !== null && typeof v === 'object') { const r = {}; for (const c of Object.keys(v)) { if (c !== 'link') r[c] = sin(v[c]); } return r; } return v; }; `
    + `const s = JSON.stringify(sin(o)); if (encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, 'x').length > ${LIMITE_DEL_CUERPO_RELE}) throw new Error('el mensaje pasa de 64 KiB'); return s; })() }}`;
}

/**
 * Los `parameters` de un POST de mensaje al relé. `pnidExpresion`: el phone_number_id (se limpia a dígitos); `payloadExpresion`/`destinoExpresion`: de dónde sale el
 * cuerpo; `nExpresion`: el número del mensaje. `neverError` (por defecto sí) deja pasar el cuerpo del error del relé; `lote` agrega el lote de 1 con 1,5 s.
 */
export function parametrosDeMensajeRele(o) {
  const { cliente, releUrl } = validarRele(o);
  const options = { timeout: 30000 };
  if (o.lote) options.batching = { batch: { batchSize: o.lote.tamano || 1, batchInterval: o.lote.intervaloMs || 1500 } };
  if (o.neverError !== false) options.response = { response: { neverError: true } };
  return {
    method: 'POST',
    url: `=${releUrl}/v1/envio/mensajes/{{ String(${o.pnidExpresion}).replace(/\\D/g, '') }}`,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'Idempotency-Key', value: claveDeIdempotencia(cliente, o.rol, o.nExpresion) }] },
    sendBody: true, specifyBody: 'json', jsonBody: cuerpoParaElRele(o.payloadExpresion, o.destinoExpresion),
    options,
  };
}

const reglaPorAccion = (accion) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: `a-${accion}`, leftValue: '={{ $json.accion }}', rightValue: accion, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
  renameOutput: true, outputKey: accion,
});

export function nodosDeEnvioRele(opciones = {}) {
  const o = opciones;
  const { credencial } = validarRele(o);
  const ingesta = o.credenciales && o.credenciales.ingesta;
  const reportar = o.reportar !== false;
  if (reportar && !ingesta) throw new Error('falta credenciales.ingesta (el nombre de la credencial de la ingesta)');
  if (reportar && !/^https:\/\//.test(String(o.ingestaUrl || ''))) throw new Error('falta ingestaUrl (https://…)');
  const config = o.config || 'Config del negocio';
  const entrada = o.entrada || 'Interpretar entrada';
  const para = o.para || 'cliente';
  const [x0, y0] = o.desde || [8120, 300];
  const lote = { tamano: (o.lote && o.lote.tamano) || 1, intervaloMs: (o.lote && o.lote.intervaloMs) || 1500 };
  // El mensaje en cada punto de la cadena. NO se lee de «Armar mensajes» con `.item`: es un camino largo (Switch, Wait, HTTP) y, aunque n8n reescribe el pairedItem de
  // la entrada de CADA nodo a { item: índice } antes de correrlo (n8n-core 2.36.4, workflow-execute.js:893-918, así que el Wait no cruza mensajes), leerlo de
  // «Leer respuesta del relé» es más robusto: ese nodo copia el ítem armado y lo emite 1 a 1, y desde ahí hasta el reporte la cadena de pairedItem llega a él.
  // `$json` trae el mensaje (con `para`) cuando el ítem viene de «Leer respuesta del relé» o de la rama «no» de «¿Enviar de verdad?» (el ítem armado); solo la
  // salida del respaldo (la respuesta del relé) no lo trae.
  const L = "$('Leer respuesta del relé')";
  const M = `((($json || {}).para !== undefined || ($json || {}).reportar !== undefined || ($json || {}).sinMensajes !== undefined) ? $json : ${L}.item.json)`;
  const credencialDelRele = { httpHeaderAuth: { id: '', name: credencial } };

  const nodes = [
    {
      id: 'enviar-si', name: '¿Enviar de verdad?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x0, y0],
      parameters: condicion(`={{ (() => { const c = $('${config}').first().json; return $json.sinMensajes !== true && (c.modoPrueba !== true || (c.enviarDeVerdad === true && !!c.telefonoDePrueba)); })() }}`),
      notes: 'En modo prueba con enviarDeVerdad falsa el envio se saltea y los mensajes quedan como enviados.',
    },
    {
      id: 'enviar', name: 'Enviar a WhatsApp', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x0 + 240, y0 - 140],
      credentials: credencialDelRele, onError: 'continueRegularOutput', alwaysOutputData: true,
      parameters: parametrosDeMensajeRele({ ...o, rol: 'enviar', pnidExpresion: '$json.phoneNumberId', payloadExpresion: '$json.payload', destinoExpresion: '($json.payload || {}).to', nExpresion: '$json.n', lote }),
      notes: 'Un solo nodo para todo (texto, botones, lista, enlace, plantilla), por el relé B9. Envía de a uno con 1,5 s entre mensajes. Idempotency-Key = cliente-ejecución-enviar-n, la MISMA en cada reintento. Sin reintento propio del nodo (retryOnFail repetiría un 504): reintenta el bucle «Leer respuesta del relé» → «Esperar reintento».',
    },
    {
      id: 'rele-leer', name: 'Leer respuesta del relé', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x0 + 480, y0 - 140],
      parameters: { jsCode: `${FUENTE_CODIGOS_RELE}\n\n${FUENTE_DECIDIR_ENVIO}\n` },
      notes: 'Módulo común Flujos/src/core/rele/. Decide por mensaje: ok, reintentar (429 una vez tras 61 a 64 s; 409 hasta 2 veces tras 2 a 3 s; reintentable, 2 y 8 s), respaldo, incierto (504 WM-3041, red, código desconocido: nunca se reenvía) o agotado.',
    },
    {
      id: 'rele-que-hacer', name: '¿Qué hacer con el envío?', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [x0 + 720, y0],
      parameters: { rules: { values: [reglaPorAccion('reintentar'), reglaPorAccion('respaldo')] }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'listo' } },
      notes: 'reintentar → espera y vuelve a «Enviar a WhatsApp»; respaldo → el mismo contenido como texto; listo (ok, incierto o agotado) → sigue al reporte, que solo cuenta lo que salió.',
    },
    {
      id: 'rele-esperar', name: 'Esperar reintento', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [x0 + 960, y0 - 340],
      parameters: { resume: 'timeInterval', amount: '={{ Math.max(...$input.all().map((i) => Number(i.json.esperaS) || 0)) }}', unit: 'seconds' },
      notes: 'Espera lo que pidió «Leer respuesta del relé» (2 a 3 s, 2 s, 8 s o 61 a 64 s). Menos de 65 s: n8n la mantiene en memoria. Vuelve a «Enviar a WhatsApp» con el mismo mensaje y la misma clave.',
    },
    {
      id: 'enviar-respaldo', name: 'Enviar respaldo', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x0 + 960, y0 - 140],
      credentials: credencialDelRele, onError: 'continueRegularOutput', alwaysOutputData: true,
      parameters: parametrosDeMensajeRele({
        ...o, rol: 'respaldo', pnidExpresion: `${L}.item.json.phoneNumberId`, destinoExpresion: `${L}.item.json.para`, nExpresion: `${L}.item.json.n`, lote,
        payloadExpresion: `({ messaging_product: 'whatsapp', recipient_type: 'individual', type: 'text', text: { preview_url: true, body: String(${L}.item.json.respaldo || '').slice(0, 4000) } })`,
      }),
      notes: 'Si el relé o Meta rechazan el interactivo o la plantilla, sale el mismo contenido como texto: UN solo intento (Idempotency-Key = cliente-ejecución-respaldo-n). Envía de a uno con 1,5 s entre mensajes. Lee el mensaje de «Leer respuesta del relé», no de «Armar mensajes»: el camino por el Switch y la espera es largo y así no depende del emparejamiento.',
    },
  ];
  const connections = {
    'Enviar a WhatsApp': { main: [[enlace('Leer respuesta del relé')]] },
    'Leer respuesta del relé': { main: [[enlace('¿Qué hacer con el envío?')]] },
    '¿Qué hacer con el envío?': { main: [[enlace('Esperar reintento')], [enlace('Enviar respaldo')], []] },
    'Esperar reintento': { main: [[enlace('Enviar a WhatsApp')]] },
  };
  let salidas;
  if (reportar) {
    nodes.push(
      {
        id: 'reportar-sal-si', name: '¿Reportar? (saliente)', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x0 + 1200, y0],
        parameters: condicion(`={{ (() => { const j = $json || {}; return ${M}.reportar === true && j.accion !== 'incierto' && j.accion !== 'agotado'${o.reportarFallidos === true ? '' : ' && !j.error'}; })() }}`),
        notes: `Solo lo que se envio AL CLIENTE se reporta (para = «${para}»), no en modo prueba, y nunca un envío incierto o agotado (sin idMeta no se cuenta como enviado).`,
      },
      {
        id: 'reportar-saliente', name: 'Reportar mensaje (saliente)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x0 + 1440, y0 - 140],
        credentials: { httpHeaderAuth: { id: '', name: ingesta } }, onError: 'continueRegularOutput', alwaysOutputData: true,
        retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
        parameters: {
          method: 'POST', url: String(o.ingestaUrl),
          authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
          sendHeaders: true, headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: `={{ $('${entrada}').first().json.phoneNumberId }}` }] },
          sendBody: true, specifyBody: 'json',
          jsonBody: `={{ (() => { const m = ${M}; return JSON.stringify({ telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: $json.idMeta || ((($json || {}).messages || [])[0] || {}).id || '', evento: m.evento }); })() }}`,
          options: {},
        },
        notes: 'Una llamada por cada mensaje enviado al cliente. Lee el texto del nodo que arma los mensajes, no de la respuesta del envio; el idMeta viene de «Leer respuesta del relé» o de la respuesta del respaldo.',
      },
    );
    connections['Enviar respaldo'] = { main: [[enlace('¿Reportar? (saliente)')]] };
    connections['¿Qué hacer con el envío?'].main[2] = [enlace('¿Reportar? (saliente)')];
    connections['¿Enviar de verdad?'] = { main: [[enlace('Enviar a WhatsApp')], [enlace('¿Reportar? (saliente)')]] };
    connections['¿Reportar? (saliente)'] = { main: [[enlace('Reportar mensaje (saliente)')], []] };
    connections['Reportar mensaje (saliente)'] = { main: [[]] };
    salidas = [{ nodo: 'Reportar mensaje (saliente)', salida: 0 }, { nodo: '¿Reportar? (saliente)', salida: 1 }];
  } else {
    connections['Enviar respaldo'] = { main: [[]] };
    connections['¿Enviar de verdad?'] = { main: [[enlace('Enviar a WhatsApp')], []] };
    salidas = [{ nodo: 'Enviar respaldo', salida: 0 }, { nodo: '¿Qué hacer con el envío?', salida: 2 }, { nodo: '¿Enviar de verdad?', salida: 1 }];
  }
  return { nodes, connections, entrada: '¿Enviar de verdad?', salidas };
}
