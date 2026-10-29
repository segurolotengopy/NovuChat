/**
 * =============================================================================
 * guardado.mjs — la rama común de GUARDADO DE MEDIOS de todo flujo con medios
 * =============================================================================
 *
 *   import { injertarGuardado, hallazgosDelGuardado, NODOS_DEL_GUARDADO } from '<ruta>/comun-sin-agente/src/guardado.mjs';
 *
 * Contrato M1 (servidor `guardarMedio`) ↔ M2 (flujos) del 29/10/2026, §1, §2 y §4. Lo INCLUYE cada constructor, nunca se copia: el código de los dos
 * nodos Code sale de `Flujos/src/core/medios/guardado-preparar.js` y `guardado-resultado.js` tal cual (una prueba lo compara byte a byte). Este archivo
 * es el ARMADO (Node, como `envio.mjs`): vive acá y no en `Flujos/src/`, que solo lleva el código de los nodos (`.js`).
 *
 *   Reportar mensaje (entrante) ─┬─→ (la rama que responde, tal como estaba: «Puerta del turno» o la que siga)
 *                                └─→ Preparar guardado → ¿Anotar medio? ─sí→ Anotar medio ─────────────────────────────────────────────┐
 *                                                                       └no→ Pedir el medio a Meta (guardado) → Descargar medio (guardado) → Guardar medio ─┤
 *                                                                                                       Resultado del guardado ←───────────────────────────┘
 *                                                                                                       → Avisar falla del guardado (solo si hay motivo)
 *
 * POR QUÉ ASÍ:
 *  - COLGADA DE «Reportar mensaje (entrante)»: el servidor exige el mensaje entrante YA registrado por la ingesta (mismo idMeta y tipo, 30 min). Cuelga
 *    ANTES de la puerta del turno, así que también se guarda el medio de un turno que la puerta frena (pausa, uso extendido, comercio no operativo).
 *  - DEBAJO EN EL LIENZO: con `executionOrder: v1` n8n termina una rama antes de empezar la siguiente, de arriba hacia abajo. La rama del guardado va más
 *    abajo que todo el flujo: corre DESPUÉS de que el cliente recibió su respuesta y no le suma ni un segundo. «Reportar mensaje (entrante)» no se mueve.
 *  - NADA CORTA EL TURNO: todo nodo HTTP lleva `onError: continueRegularOutput` y `alwaysOutputData`; las llamadas a `guardarMedio` piden la respuesta
 *    completa sin error (`fullResponse`, `neverError`) para que «Resultado del guardado» vea el código. Ninguna respuesta del §2 rompe nada. La única
 *    excepción es el AVISO de falla: sin `onError`, si Meta lo rechaza la ejecución termina en error (ningún envío traga su fallo); como la rama corre
 *    al final, el cliente ya recibió su respuesta.
 *  - DOBLE DESCARGA (decisión de Andres): baja el medio con SU PROPIA llamada a Meta; no depende del tope diario de ver imagen u oír audio.
 *  - TAMAÑO ANTES DE BAJAR: si Meta informa un tamaño por encima del límite (imagen 5 MB, PDF 10 MB, audio 16 MB) la URL de descarga queda vacía y no se
 *    baja nada; cuenta como 413.
 *  - docx y xlsx: modo ANOTAR (cuerpo vacío, `X-NovuChat-Anotar: 1`, `X-NovuChat-Mime`), sin bajar bytes.
 *  - CREDENCIALES POR NOMBRE: la de Graph (Bearer o whatsAppApi) en los TRES nodos que hablan con graph.facebook.com o su CDN; la de ingesta SOLO en los dos
 *    que hablan con `guardarMedio`. Nunca la de ingesta hacia Meta (la trampa del 15/09).
 *  - `X-NovuChat-Numero` (el número del negocio) es la MISMA expresión que la cabecera de «Reportar mensaje (entrante)»: `rutaAutenticada` del servidor la
 *    exige para encontrar la ruta del token, y así el guardado va siempre a la misma ruta que el reporte.
 *
 * `opciones`:
 *   credenciales   { ingesta: 'NovuChat ingesta (…)', graph: 'nombre de la credencial de Graph', graphTipo: 'httpHeaderAuth' | 'whatsAppApi' }; si no se dan,
 *                  se toman del flujo armado: ingesta de «Reportar mensaje (entrante)», Graph de `graphDe` (por defecto «Descargar medio»)
 *   guardarUrl     https://…/guardarMedio  (obligatoria)
 *   carga          nodo cuyo primer item trae `messages` y `ahoraMs` (por defecto «Carga de entrada»)
 *   config         nodo con `waGraphVersion` y `numeroRecepcion` (por defecto «Config del negocio»)
 *   ancla          nodo del que cuelga (por defecto «Reportar mensaje (entrante)»)
 * Devuelve el mismo flujo, con los ocho nodos y sus conexiones agregados. Lanza si falta algo: un flujo con medios no se arma sin guardado.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

export const ANCLA_DEL_GUARDADO = 'Reportar mensaje (entrante)';
export const NODOS_DEL_GUARDADO = [
  'Preparar guardado', '¿Anotar medio?', 'Anotar medio', 'Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)',
  'Guardar medio', 'Resultado del guardado', 'Avisar falla del guardado',
];
/**
 * ¿El flujo baja medios entrantes de Meta? Un nodo conectado (fuera de esta rama) que pide la URL del medio o lo descarga. Es lo que vuelve OBLIGATORIO el
 * guardado: un flujo así sin la rama no se arma (`hallazgosDelGuardado`), y uno sin medios no la lleva.
 */
export function manejaMedios(flujo) {
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  // Solo cuenta un nodo CONECTADO (alguien le entrega ítems): uno suelto no baja nada.
  const conEntrada = new Set();
  for (const salidas of Object.values((flujo && flujo.connections) || {})) for (const s of ((salidas || {}).main || [])) for (const c of (s || [])) conEntrada.add(c.node);
  return nodos.some((n) => !NODOS_DEL_GUARDADO.includes(n.name) && conEntrada.has(n.name) && (
    /^(Obtener URL del medio|Descargar medio)/.test(String(n.name))
    || (n.type === 'n8n-nodes-base.whatsApp' && (n.parameters || {}).resource === 'media')
  ));
}
/** Los nodos que hablan con Meta (credencial de Graph) y los que hablan con `guardarMedio` (credencial de ingesta). */
export const NODOS_DE_META_DEL_GUARDADO = ['Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado'];
export const NODOS_DE_INGESTA_DEL_GUARDADO = ['Anotar medio', 'Guardar medio'];
export const ARISTAS_DEL_GUARDADO = [
  ['Preparar guardado', 0, '¿Anotar medio?'], ['¿Anotar medio?', 0, 'Anotar medio'], ['¿Anotar medio?', 1, 'Pedir el medio a Meta (guardado)'],
  ['Pedir el medio a Meta (guardado)', 0, 'Descargar medio (guardado)'], ['Descargar medio (guardado)', 0, 'Guardar medio'],
  ['Anotar medio', 0, 'Resultado del guardado'], ['Guardar medio', 0, 'Resultado del guardado'], ['Resultado del guardado', 0, 'Avisar falla del guardado'],
];
/** La URL de la descarga: la del CDN de Meta solo si Meta informó un tamaño dentro del límite; si no, vacía (no se baja nada). */
export const URL_DESCARGA_GUARDADO = "={{ (String($json.url || '').startsWith('https://lookaside.fbsbx.com/') && Number($json.file_size) > 0 && Number($json.file_size) <= Number($('Preparar guardado').first().json.limite)) ? $json.url : '' }}";

export const FUENTE_PREPARAR = readFileSync(join(AQUI, '../../../src/core/medios/guardado-preparar.js'), 'utf8').trimEnd();
export const FUENTE_RESULTADO = readFileSync(join(AQUI, '../../../src/core/medios/guardado-resultado.js'), 'utf8').trimEnd();

const NOMBRE_DE_NODO = /^[^'"\\\r\n`$]{1,80}$/;
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
const SIN_CORTAR = { onError: 'continueRegularOutput', alwaysOutputData: true };
const RESPUESTA_COMPLETA = { response: { response: { fullResponse: true, neverError: true } } };

/** La cabecera que define `GM_FUENTES` para este flujo: nombres de nodo LITERALES (el task runner de n8n solo precarga los nombrados así). */
export function cabeceraDeFuentes(carga, config) {
  for (const n of [carga, config]) if (!NOMBRE_DE_NODO.test(String(n))) throw new Error(`guardado: nombre de nodo no válido: ${String(n).slice(0, 40)}`);
  return [
    '// FUENTES DEL GUARDADO: las arma Flujos/experimental/comun-sin-agente/src/guardado.mjs para este flujo (nombres de nodo literales, para que n8n los precargue).',
    'const GM_FUENTES = {',
    `  carga: $('${carga}').isExecuted ? $('${carga}').first().json : {},`,
    `  config: $('${config}').isExecuted ? $('${config}').first().json : {},`,
    '};',
  ].join('\n');
}

/** El número del negocio: la expresión de la cabecera `X-NovuChat-Numero` de «Reportar mensaje (entrante)», sin el `={{ … }}`. */
export function numeroDelAncla(ancla) {
  const cab = (((ancla || {}).parameters || {}).headerParameters || {}).parameters || [];
  const h = cab.find((x) => x && x.name === 'X-NovuChat-Numero');
  const m = h ? /^=\{\{([\s\S]+)\}\}$/.exec(String(h.value).trim()) : null;
  if (!m) throw new Error(`guardado: «${(ancla || {}).name || ANCLA_DEL_GUARDADO}» no trae la cabecera X-NovuChat-Numero como expresión`);
  return m[1].trim();
}

function autenticacionDeGraph(credenciales) {
  const tipo = credenciales.graphTipo || 'httpHeaderAuth';
  if (tipo === 'httpHeaderAuth') return { parametros: { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' }, credentials: { httpHeaderAuth: { id: '', name: credenciales.graph } } };
  if (tipo === 'whatsAppApi') return { parametros: { authentication: 'predefinedCredentialType', nodeCredentialType: 'whatsAppApi' }, credentials: { whatsAppApi: { id: '', name: credenciales.graph } } };
  throw new Error(`guardado: credenciales.graphTipo desconocido: ${String(tipo).slice(0, 30)}`);
}

/** Los ocho nodos de la rama, sin conectar al flujo. `desde` es [x, y] del primero. */
export function nodosDelGuardado(opciones) {
  const o = opciones || {};
  const c = o.credenciales || {};
  if (!c.ingesta || !c.graph) throw new Error('guardado: faltan credenciales.ingesta y credenciales.graph (por NOMBRE)');
  if (/ingesta/i.test(String(c.graph)) || String(c.graph) === String(c.ingesta)) throw new Error('guardado: la credencial de Graph no puede ser la de ingesta (la trampa del 15/09)');
  if (!/^https:\/\/[a-z0-9.-]+\/guardarMedio$/.test(String(o.guardarUrl || ''))) throw new Error('guardado: guardarUrl tiene que ser https://<anfitrión>/guardarMedio');
  const carga = o.carga || 'Carga de entrada';
  const config = o.config || 'Config del negocio';
  const numero = o.numero;
  if (!numero) throw new Error('guardado: falta la expresión del número del negocio (numero)');
  const [x, y] = o.desde || [0, 0];
  const graph = autenticacionDeGraph(c);
  const ingesta = { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' };
  const credIngesta = { httpHeaderAuth: { id: '', name: c.ingesta } };
  const P = "$('Preparar guardado').first().json";
  const version = `(/^v\\d+\\.\\d$/.test(String($('${config}').first().json.waGraphVersion)) ? $('${config}').first().json.waGraphVersion : 'v26.0')`;
  const cabecerasComunes = [
    { name: 'X-NovuChat-Numero', value: `={{ ${numero} }}` },
    { name: 'X-NovuChat-Telefono', value: `={{ ${P}.telefono }}` },
    { name: 'X-NovuChat-IdMeta', value: `={{ ${P}.idMeta }}` },
    { name: 'X-NovuChat-Tipo', value: `={{ ${P}.tipo }}` },
  ];
  return [
    {
      id: 'gm-preparar', name: 'Preparar guardado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y],
      parameters: { jsCode: `${cabeceraDeFuentes(carga, config)}\n\n${FUENTE_PREPARAR}\n` },
      notes: 'Rama del GUARDADO de medios (módulo común Flujos/src/core/medios/): decide si el medio de este mensaje se guarda (imagen, audio, PDF) o solo se anota (docx, xlsx). Corre después de la respuesta al cliente y nunca la frena.',
    },
    {
      id: 'gm-si-anotar', name: '¿Anotar medio?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x + 240, y],
      parameters: condicion("={{ $json.modo === 'anotar' }}"),
      notes: 'docx, xlsx y todo documento que no sea PDF: se anotan sin bajar un byte. Lo demás se baja de Meta y se guarda.',
    },
    {
      id: 'gm-anotar', name: 'Anotar medio', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 480, y],
      parameters: {
        method: 'POST', url: o.guardarUrl, ...ingesta, sendHeaders: true,
        headerParameters: { parameters: [...cabecerasComunes, { name: 'X-NovuChat-Anotar', value: '1' }, { name: 'X-NovuChat-Mime', value: `={{ ${P}.mime }}` }] },
        options: { timeout: 10000, ...RESPUESTA_COMPLETA },
      },
      credentials: credIngesta, ...SIN_CORTAR,
      notes: 'POST guardarMedio en modo ANOTAR: cuerpo vacío, solo el token de ingesta del número. El servidor deja el metadato «anotado» (sin bytes) o responde 415.',
    },
    {
      id: 'gm-url', name: 'Pedir el medio a Meta (guardado)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 480, y + 200],
      parameters: {
        method: 'GET', url: `=https://graph.facebook.com/{{ ${version} }}/{{ String($json.mediaId || '').replace(/[^A-Za-z0-9_-]/g, '') }}`,
        ...graph.parametros, options: { timeout: 10000 },
      },
      credentials: graph.credentials, ...SIN_CORTAR, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000,
      notes: 'GET /{media-id} con la credencial de WhatsApp: devuelve url, mime_type y file_size. Llamada PROPIA del guardado (doble descarga): no gasta el tope de ver u oír.',
    },
    {
      id: 'gm-descargar', name: 'Descargar medio (guardado)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 720, y + 200],
      parameters: {
        method: 'GET', url: URL_DESCARGA_GUARDADO, ...graph.parametros,
        options: { timeout: 20000, redirect: { redirect: { followRedirects: false } }, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
      },
      credentials: graph.credentials, ...SIN_CORTAR, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000,
      notes: 'Baja el archivo del CDN de Meta con el token, sin seguir redirecciones, SOLO si Meta informó un tamaño dentro del límite (imagen 5 MB, PDF 10 MB, audio 16 MB). Si no, la URL queda vacía y no se baja nada.',
    },
    {
      id: 'gm-guardar', name: 'Guardar medio', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 960, y + 200],
      parameters: {
        method: 'POST', url: o.guardarUrl, ...ingesta, sendHeaders: true,
        headerParameters: { parameters: cabecerasComunes },
        sendBody: true, contentType: 'binaryData', inputDataFieldName: 'data',
        options: { timeout: 30000, ...RESPUESTA_COMPLETA },
      },
      credentials: credIngesta, ...SIN_CORTAR,
      notes: 'POST guardarMedio con los BYTES del medio en el cuerpo (Content-Type el del medio), solo el token de ingesta del número, nunca firma. Sin reintentos: el servidor reconoce el repetido por el id del mensaje.',
    },
    {
      id: 'gm-resultado', name: 'Resultado del guardado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 1200, y],
      parameters: { jsCode: `${FUENTE_RESULTADO}\n` },
      notes: 'Toda respuesta de guardarMedio termina acá sin cortar nada. Solo 413, 415, 429 y 502 arman el aviso a la recepción: con su ventana de 24 h abierta, uno por día y sin datos del paciente.',
    },
    {
      id: 'gm-avisar', name: 'Avisar falla del guardado', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 1440, y],
      parameters: {
        method: 'POST', url: `=https://graph.facebook.com/{{ ${version} }}/{{ String(${numero}).replace(/\\D/g, '') }}/messages`,
        ...graph.parametros, sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: $json.numeroRecepcion, type: 'text', text: { preview_url: false, body: String($json.texto || '').slice(0, 500) } }) }}",
        options: { timeout: 10000 },
      },
      // SIN onError: si Meta rechaza el aviso, la ejecución termina en error (ningún fallo tragado). Corre al final, cuando el cliente ya tiene su respuesta.
      credentials: graph.credentials,
      notes: 'El aviso de falla a la recepción del negocio, en texto libre (su ventana está abierta). Sin reintentos: un aviso repetido llegaría dos veces. Sin onError: si falla, la ejecución termina en error (corre al final, el cliente ya tiene su respuesta). +1 mensaje solo cuando falla el guardado, a lo más uno por día.',
    },
  ];
}

/**
 * Sin `credenciales`, se toman del propio flujo YA ARMADO (con los nombres resueltos para su variante): la de ingesta, de «Reportar mensaje (entrante)»;
 * la de Graph, del nodo que ya baja medios de Meta (`graphDe`, por defecto «Descargar medio»), con su tipo (Bearer o whatsAppApi).
 */
export function credencialesDelFlujo(flujo, ancla, graphDe) {
  const ing = ((ancla.credentials || {}).httpHeaderAuth || {}).name;
  if (!ing) throw new Error(`guardado: «${ancla.name}» no lleva la credencial de ingesta (httpHeaderAuth) por nombre`);
  const ref = (flujo.nodes || []).find((n) => n.name === graphDe);
  if (!ref) throw new Error(`guardado: el flujo no tiene «${graphDe}» de donde tomar la credencial de Graph`);
  const tipos = Object.keys(ref.credentials || {});
  if (tipos.length !== 1 || !['httpHeaderAuth', 'whatsAppApi'].includes(tipos[0])) throw new Error(`guardado: «${graphDe}» no lleva una sola credencial de WhatsApp`);
  const graph = String(ref.credentials[tipos[0]].name || '');
  if (!graph || graph === String(ing)) throw new Error(`guardado: «${graphDe}» no lleva una credencial de WhatsApp distinta de la de ingesta`);
  return { ingesta: String(ing), graph, graphTipo: tipos[0] };
}

/** Agrega la rama al flujo (lo modifica y lo devuelve). */
export function injertarGuardado(flujo, opciones) {
  const o = opciones || {};
  // Un flujo que no baja medios no lleva la rama (y no hay nada que guardar).
  if (!manejaMedios(flujo)) return flujo;
  const nombreAncla = o.ancla || ANCLA_DEL_GUARDADO;
  const ancla = (flujo.nodes || []).find((n) => n.name === nombreAncla);
  if (!ancla) throw new Error(`guardado: el flujo no tiene «${nombreAncla}»`);
  const credenciales = o.credenciales || credencialesDelFlujo(flujo, ancla, o.graphDe || 'Descargar medio');
  for (const n of NODOS_DEL_GUARDADO) if ((flujo.nodes || []).some((x) => x.name === n)) throw new Error(`guardado: el flujo ya tiene «${n}»`);
  for (const n of [o.carga || 'Carga de entrada', o.config || 'Config del negocio']) if (!(flujo.nodes || []).some((x) => x.name === n)) throw new Error(`guardado: el flujo no tiene «${n}»`);
  // Debajo de TODO el flujo: con executionOrder v1 la rama corre después de la que responde.
  const yMax = Math.max(...flujo.nodes.map((n) => Number((n.position || [0, 0])[1]) || 0));
  const nodos = nodosDelGuardado({ ...o, credenciales, numero: o.numero || numeroDelAncla(ancla), desde: [Number(ancla.position[0]) + 240, yMax + 400] });
  flujo.nodes.push(...nodos);
  const con = flujo.connections || (flujo.connections = {});
  const salidaAncla = ((con[nombreAncla] || (con[nombreAncla] = { main: [[]] })).main);
  if (!salidaAncla[0]) salidaAncla[0] = [];
  salidaAncla[0].push(enlace('Preparar guardado'));
  for (const [de, salida, a] of ARISTAS_DEL_GUARDADO) {
    const m = (con[de] || (con[de] = { main: [] })).main;
    while (m.length <= salida) m.push([]);
    m[salida].push(enlace(a));
  }
  return flujo;
}

// ----------------------------------------------------------------- la guardia (la usan los constructores y la prueba «guardado obligatorio»)
const destinosDe = (flujo, de, salida) => ((((flujo.connections || {})[de] || {}).main || [])[salida] || []).map((x) => x.node);
const credDe = (n) => Object.entries((n && n.credentials) || {}).map(([tipo, c]) => ({ tipo, nombre: String((c || {}).name || '') }));

/** Lo que le falta o le sobra a la rama del guardado en un flujo armado que maneja medios. Vacío si está bien (o si el flujo no baja medios). */
export function hallazgosDelGuardado(flujo) {
  const h = [];
  if (!manejaMedios(flujo)) return h;
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const por = (nombre) => nodos.find((n) => n.name === nombre);
  for (const n of NODOS_DEL_GUARDADO) if (!por(n)) h.push(`guardado: falta el nodo «${n}»`);
  const ancla = por(ANCLA_DEL_GUARDADO);
  if (!ancla) { h.push(`guardado: falta «${ANCLA_DEL_GUARDADO}»`); return h; }
  if (h.length) return h;
  // Cuelga de «Reportar mensaje (entrante)», junto a la rama que responde, y va DEBAJO de ella (corre después).
  const hijos = destinosDe(flujo, ANCLA_DEL_GUARDADO, 0);
  if (!hijos.includes('Preparar guardado')) h.push('guardado: «Preparar guardado» no cuelga de «Reportar mensaje (entrante)»');
  const otros = hijos.filter((x) => x !== 'Preparar guardado');
  if (!otros.length) h.push('guardado: «Reportar mensaje (entrante)» no sigue hacia la rama que responde');
  const prep = por('Preparar guardado');
  for (const otro of otros) {
    const n = por(otro);
    if (n && !(Number(prep.position[1]) > Number(n.position[1]))) h.push(`guardado: «Preparar guardado» tiene que ir DEBAJO de «${otro}» en el lienzo (si no, corre antes y demora la respuesta)`);
  }
  if (!(Number(ancla.position[1]) < Number(prep.position[1]))) h.push('guardado: «Reportar mensaje (entrante)» tiene que ir arriba de «Preparar guardado»');
  for (const [de, salida, a] of ARISTAS_DEL_GUARDADO) if (!destinosDe(flujo, de, salida).includes(a)) h.push(`guardado: «${de}» (salida ${salida}) no está conectado a «${a}»`);
  // El código común, tal cual.
  if (!String((prep.parameters || {}).jsCode || '').includes(FUENTE_PREPARAR)) h.push('guardado: «Preparar guardado» no incluye guardado-preparar.js tal cual');
  if (!String(((por('Resultado del guardado') || {}).parameters || {}).jsCode || '').includes(FUENTE_RESULTADO)) h.push('guardado: «Resultado del guardado» no incluye guardado-resultado.js tal cual');
  // Credenciales por nombre: hacia guardarMedio, la MISMA de ingesta de «Reportar mensaje (entrante)»; hacia Meta, una de WhatsApp que NO es
  // esa ni se llama «ingesta» (la trampa del 15/09: el token de ingesta nunca sale hacia graph.facebook.com).
  const ingesta = String((((ancla.credentials || {}).httpHeaderAuth) || {}).name || '');
  if (!ingesta) h.push('guardado: «Reportar mensaje (entrante)» no lleva la credencial de ingesta por nombre');
  for (const nombre of NODOS_DE_META_DEL_GUARDADO) {
    const cs = credDe(por(nombre));
    if (cs.length !== 1 || !cs[0].nombre) h.push(`guardado: «${nombre}» tiene que llevar UNA credencial de WhatsApp por nombre`);
    else if (cs[0].nombre === ingesta || /ingesta/i.test(cs[0].nombre)) h.push(`guardado: «${nombre}» llama a Meta con la credencial de ingesta (la trampa del 15/09)`);
    else if (!['httpHeaderAuth', 'whatsAppApi'].includes(cs[0].tipo)) h.push(`guardado: «${nombre}» lleva una credencial de tipo ${cs[0].tipo}`);
  }
  for (const nombre of NODOS_DE_INGESTA_DEL_GUARDADO) {
    const n = por(nombre);
    const cs = credDe(n);
    if (cs.length !== 1 || cs[0].tipo !== 'httpHeaderAuth' || !ingesta || cs[0].nombre !== ingesta) h.push(`guardado: «${nombre}» tiene que llevar SOLO la credencial de ingesta del flujo (la de «Reportar mensaje (entrante)»)`);
    if (!/^https:\/\/[a-z0-9.-]+\/guardarMedio$/.test(String((n.parameters || {}).url || ''))) h.push(`guardado: «${nombre}» no llama a guardarMedio`);
    if (/Signature/i.test(JSON.stringify(n.parameters || {}))) h.push(`guardado: «${nombre}» manda una firma: guardarMedio va solo con el token`);
  }
  for (const nombre of NODOS_DE_META_DEL_GUARDADO) {
    const url = String(((por(nombre) || {}).parameters || {}).url || '');
    if (nombre === 'Descargar medio (guardado)' ? url !== URL_DESCARGA_GUARDADO : !url.startsWith('=https://graph.facebook.com/')) h.push(`guardado: «${nombre}» llama a otro anfitrión`);
  }
  // Nada corta el turno: todo nodo de red de la rama sigue con un ítem, salvo el aviso, que falla ruidoso (ningún fallo tragado) y corre al final.
  for (const nombre of [...NODOS_DE_META_DEL_GUARDADO, ...NODOS_DE_INGESTA_DEL_GUARDADO].filter((x) => x !== 'Avisar falla del guardado')) {
    const n = por(nombre);
    if (n.onError !== 'continueRegularOutput' || n.alwaysOutputData !== true) h.push(`guardado: «${nombre}» tiene que llevar onError continueRegularOutput y alwaysOutputData`);
  }
  for (const nombre of NODOS_DE_INGESTA_DEL_GUARDADO) {
    const r = ((((por(nombre).parameters || {}).options || {}).response || {}).response) || {};
    if (r.fullResponse !== true || r.neverError !== true) h.push(`guardado: «${nombre}» tiene que pedir la respuesta completa sin error (fullResponse, neverError)`);
  }
  const aviso = por('Avisar falla del guardado');
  if (aviso.onError !== undefined || aviso.continueOnFail !== undefined) h.push('guardado: «Avisar falla del guardado» no lleva onError: si Meta lo rechaza, la ejecución termina en error (ningún fallo tragado)');
  if (!/to:\s*\$json\.numeroRecepcion\b/.test(String((aviso.parameters || {}).jsonBody || ''))) h.push('guardado: «Avisar falla del guardado» va SOLO al número de recepción del negocio');
  if (aviso.retryOnFail || por('Guardar medio').retryOnFail) h.push('guardado: el aviso y el guardado no reintentan');
  return h;
}
