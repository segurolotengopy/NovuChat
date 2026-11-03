/**
 * =============================================================================
 * guardado.mjs — la rama común de GUARDADO DE MEDIOS de todo flujo con medios
 * =============================================================================
 *
 *   import { injertarGuardado, hallazgosDelGuardado, NODOS_DEL_GUARDADO } from '<ruta>/comun-sin-agente/src/guardado.mjs';
 *
 * Contrato M1 (servidor `guardarMedio`) ↔ M2 (flujos) del 29/10/2026, §1, §2 y §4, con el contrato v2 «guardar y descargar TODO» del 30/10/2026 (§4,
 * §7.6 y §8.1). Lo INCLUYE cada constructor, nunca se copia: el código de los tres nodos Code sale de `Flujos/src/core/medios/guardado-preparar.js`,
 * `guardado-reintento.js` y `guardado-resultado.js` tal cual (una prueba lo compara byte a byte). Este archivo
 * es el ARMADO (Node, como `envio.mjs`): vive acá y no en `Flujos/src/`, que solo lleva el código de los nodos (`.js`).
 *
 *   Reportar mensaje (entrante) ─┬─→ (la rama que responde, tal como estaba: «Puerta del turno» o la que siga)
 *                                └─→ Preparar guardado → Pedir el medio a Meta (guardado) → Descargar medio (guardado) → Guardar medio
 *                                      → ¿Reintentar el guardado? ─5xx→ Preparar reintento → Reintentar el guardado ─┐
 *                                                                 └──────────────────────────────────────────────────┴→ Resultado del guardado
 *                                      → Avisar falla del guardado (solo si hay motivo)
 *   Nueve nodos (contrato v2 §4): «¿Anotar medio?» y «Anotar medio» ya no existen, todo documento se guarda por el camino normal.
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
 *  - TODO MEDIO SE GUARDA (decisión de Andres, 30/10): imagen, audio, video, documento de cualquier tipo y sticker (como `image`).
 *  - TAMAÑO ANTES DE BAJAR: si Meta informa un tamaño por encima de 16 MiB la URL de descarga queda vacía y no se baja nada; cuenta como 413. El flujo
 *    no se adelanta al tope por tipo (imagen 5 MB): lo impone el servidor.
 *  - `Content-Type` SANEADO: el mime de Meta solo si está en la lista cerrada de «Preparar guardado»; si no, `application/octet-stream`.
 *  - NINGÚN NODO CODE LEE EL BINARIO: «Preparar reintento» solo pasa la referencia que le da n8n; `hallazgosDelGuardado` lo comprueba.
 *  - RETENCIÓN DE EJECUCIONES (decisión de Andres, 30/10, contrato v2 §8.1): el binario del medio quedaría en los datos de la ejecución si n8n la guarda;
 *    todo flujo con la rama lleva `saveDataSuccessExecution` y `saveDataErrorExecution` «none» y `saveExecutionProgress` false. Lo pone `injertarGuardado`.
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
 *   canal          'graph' (por defecto: nada cambia, ni un byte) o 'rele' (relé B9: la info y el contenido del medio salen de GET /v1/envio/medios/<id> y
 *                  /contenido, y el aviso de falla de POST /v1/envio/mensajes/<phone_number_id>; ver `envio.mjs`). Con 'rele' hacen falta además:
 *   cliente        prefijo de la Idempotency-Key del aviso («rroca-evy»)
 *   releUrl        base del relé (por defecto el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE)
 *                  y `credenciales.rele` («AAB1 envío · <alias>») en lugar de `credenciales.graph` (si no se da, se toma de «Enviar a WhatsApp»)
 * Devuelve el mismo flujo, con los nueve nodos y sus conexiones agregados. Lanza si falta algo: un flujo con medios no se arma sin guardado.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARCADOR_URL_DEL_RELE, PREFIJO_CREDENCIAL_RELE, esBaseDeReleAdmitida, parametrosDeMensajeRele, validarRele } from './envio.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

export const ANCLA_DEL_GUARDADO = 'Reportar mensaje (entrante)';
export const NODOS_DEL_GUARDADO = [
  'Preparar guardado', 'Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)',
  'Guardar medio', '¿Reintentar el guardado?', 'Preparar reintento', 'Reintentar el guardado', 'Resultado del guardado', 'Avisar falla del guardado',
];
/**
 * ¿El flujo baja medios entrantes de Meta? Un nodo conectado (fuera de esta rama) que pide la URL del medio o lo descarga: por su nombre, por ser un nodo
 * de medios de WhatsApp, o por su URL (Graph con un id de medio, o el CDN `lookaside.fbsbx.com`), así que renombrar el nodo no lo esconde. La prueba de CI
 * exige además la rama a TODO flujo con «Reportar mensaje (entrante)», salvo su lista cerrada. Es lo que vuelve OBLIGATORIO el
 * guardado: un flujo así sin la rama no se arma (`hallazgosDelGuardado`), y uno sin medios no la lleva.
 */
// El anfitrión va ANCLADO al inicio de la URL (con o sin el `=` de una expresión de n8n) y termina en `/`, `?`, `#` o el final: un texto que solo lo
// nombra en otra parte (`https://otro.dominio/?x=graph.facebook.com`) no cuenta.
const ANFITRION_DE_MEDIO = /^=?\s*https:\/\/(graph\.facebook\.com|lookaside\.fbsbx\.com)(?=[/?#]|$)/i;
// El relé B9: GET <base>/v1/envio/medios/<id> (la base es el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE o un host http(s)); NO cuenta la subida (POST …/medios/<pnid>).
// Esto DETECTA (a propósito, cualquier host http(s)): un nodo que baja medios del relé con una URL real tiene que contar como «maneja medios» para que
// lo alcance la compuerta del guardado. Lo que el repositorio ADMITE como base del relé (solo el marcador; las pruebas, un host `*.example`) lo valida
// `esBaseDeReleAdmitida`, en `validarRele` y en `hallazgosDelGuardado`.
// Se busca la RUTA del relé en cualquier parte de la URL (no solo tras un host simple), para que no la esconda una base calculada (`={{ $json.base }}/v1/…`), una base con ruta
// (`https://h/api/v1/…`) ni un usuario (`https://user@host/v1/…`); segunda revisión del PR #757.
const ANFITRION_DE_MEDIO_RELE = /\/v1\/envio\/medios\//;
const esPedidoDeMedio = (url, metodo = 'GET') => {
  const texto = String(url || '').trim();
  if (ANFITRION_DE_MEDIO_RELE.test(texto)) return String(metodo || 'GET').toUpperCase() === 'GET';
  const m = ANFITRION_DE_MEDIO.exec(texto);
  if (!m) return false;
  if (m[1].toLowerCase() === 'lookaside.fbsbx.com') return true;
  const ruta = texto.slice(m[0].length);
  return /media/i.test(ruta) && !/\/messages\b/.test(ruta);
};
export function manejaMedios(flujo) {
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  // Solo cuenta un nodo CONECTADO (alguien le entrega ítems): uno suelto no baja nada.
  const conEntrada = new Set();
  for (const salidas of Object.values((flujo && flujo.connections) || {})) for (const s of ((salidas || {}).main || [])) for (const c of (s || [])) conEntrada.add(c.node);
  return nodos.some((n) => !NODOS_DEL_GUARDADO.includes(n.name) && conEntrada.has(n.name) && (
    // Contrato v2 (30/10): también un nodo que baja un VIDEO o un DOCUMENTO (todos los tipos se guardan).
    /^(Obtener URL del (medio|video|documento)|Descargar (medio|video|documento))/i.test(String(n.name))
    || (n.type === 'n8n-nodes-base.whatsApp' && (n.parameters || {}).resource === 'media')
    // Por lo que HACE, no por cómo se llama: un HTTP a Graph que nombra un medio (`/{media-id}`) o que baja del CDN de Meta.
    || (n.type === 'n8n-nodes-base.httpRequest' && esPedidoDeMedio(String((n.parameters || {}).url || ''), (n.parameters || {}).method))
  ));
}
/** Los nodos que hablan con Meta (credencial de Graph) y los que hablan con `guardarMedio` (credencial de ingesta). */
export const NODOS_DE_META_DEL_GUARDADO = ['Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado'];
export const NODOS_DE_INGESTA_DEL_GUARDADO = ['Guardar medio', 'Reintentar el guardado'];
/** Los que el contrato v2 QUITÓ (30/10): no pueden volver. */
export const NODOS_RETIRADOS_DEL_GUARDADO = ['¿Anotar medio?', 'Anotar medio'];
/** Los nodos Code de la rama: ninguno lee el contenido del binario (contrato v2 §7.6). */
export const NODOS_CODE_DEL_GUARDADO = ['Preparar guardado', 'Preparar reintento', 'Resultado del guardado'];
/** La retención de ejecuciones de todo flujo con la rama (decisión de Andres, 30/10, contrato v2 §8.1). */
export const RETENCION_DEL_GUARDADO = { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false };
/** El tope de lo que el flujo baja, en bytes (16 MiB, contrato v2 §7.6). Es el mismo número que `GM_LIMITE` de guardado-preparar.js. */
export const LIMITE_DE_DESCARGA = 16 * 1024 * 1024;
// Lo que delata que un nodo Code abre el contenido de un binario: el ayudante de n8n, `Buffer`, base64 o el campo `data` de adentro del binario.
const LEE_BINARIO = /getBinaryDataBuffer|getBinaryStream|\bBuffer\b|\batob\b|\bbtoa\b|base64|binary\s*\.\s*data\s*\.\s*data\b|\.data\.data\b|\[['"]data['"]\]\s*\.\s*data\b/;
export const codigoLeeBinario = (codigo) => LEE_BINARIO.test(String(codigo || '').replace(/^\s*\/\/.*$/gm, ''));
export const ARISTAS_DEL_GUARDADO = [
  ['Preparar guardado', 0, 'Pedir el medio a Meta (guardado)'],
  ['Pedir el medio a Meta (guardado)', 0, 'Descargar medio (guardado)'], ['Descargar medio (guardado)', 0, 'Guardar medio'],
  ['Guardar medio', 0, '¿Reintentar el guardado?'],
  ['¿Reintentar el guardado?', 0, 'Preparar reintento'], ['¿Reintentar el guardado?', 1, 'Resultado del guardado'],
  ['Preparar reintento', 0, 'Reintentar el guardado'], ['Reintentar el guardado', 0, 'Resultado del guardado'],
  ['Resultado del guardado', 0, 'Avisar falla del guardado'],
];
/**
 * Por el relé, una imagen o un sticker (`tipo: image`) de más de 5 MiB no se descarga: el servidor la rechazaría (413) y el GET de `/contenido` gastaría una
 * de las 500 descargas diarias por WABA para nada. Audio, video y documento siguen con el tope de 16 MiB.
 */
export const LIMITE_DE_IMAGEN_RELE = 5 * 1024 * 1024;
/** El cupo por defecto del canal rele (ver `guardado-cupo.js`): medios por teléfono y día, y por flujo y día. */
export const CUPO_POR_DEFECTO_RELE = { porTelefono: 10, global: 60 }; // 10 por teléfono: decisión de Andres, 03/11/2026

/** La URL de la descarga: la del CDN de Meta solo si Meta informó un tamaño dentro de 16 MiB (`limite`); si no, vacía (no se baja nada). */
// Si Meta NO informa el tamaño (0 o ausente): imagen, audio y sticker se bajan igual (el servidor impone el tope por tipo, 413, y el tiempo límite de la
// descarga, 60 s, acota lo que se baja); video y documento NO se bajan (`exigeTamano`: pueden pesar 100 MB) y cuentan como falla de tamaño (`sinTamano`).
export const URL_DESCARGA_GUARDADO = "={{ (String($json.url || '').startsWith('https://lookaside.fbsbx.com/') && !(Number($json.file_size) > Number($('Preparar guardado').first().json.limite)) && !($('Preparar guardado').first().json.exigeTamano === true && !(Number($json.file_size) > 0))) ? $json.url : '' }}";

/**
 * La URL de la descarga por el relé. `releUrl` va dentro de una cadena entre comillas simples: solo el marcador o una base http(s) sin comillas ni llaves.
 * Pide `/contenido` SOLO si la info trae `file_size` mayor que cero y dentro del límite: sin tamaño, con tamaño excesivo (WM-3039, 413) o si la info falló
 * (id vencido: 502 WM-3040), la URL queda vacía y no se baja nada (cuenta como falla de tamaño). Los GET de medios gastan 500 descargas por día y por WABA
 * (la info y el contenido cuentan): nunca se baja a ciegas ni se reintenta.
 */
export const urlDescargaRele = (releUrl = MARCADOR_URL_DEL_RELE) => `={{ (() => { const p = $('Preparar guardado').first().json; const tope = p.tipo === 'image' ? Math.min(Number(p.limite), ${LIMITE_DE_IMAGEN_RELE}) : Number(p.limite); return Number($json.file_size) > 0 && !(Number($json.file_size) > tope); })() ? '${releUrl}/v1/envio/medios/' + String($('Preparar guardado').first().json.mediaId || '').replace(/[^A-Za-z0-9_-]/g, '') + '/contenido' : '' }}`;
export const urlInfoRele = (releUrl = MARCADOR_URL_DEL_RELE) => `=${releUrl}/v1/envio/medios/{{ String($json.mediaId || '').replace(/[^A-Za-z0-9_-]/g, '') }}`;

export const FUENTE_PREPARAR = readFileSync(join(AQUI, '../../../src/core/medios/guardado-preparar.js'), 'utf8').trimEnd();
export const FUENTE_CUPO = readFileSync(join(AQUI, '../../../src/core/medios/guardado-cupo.js'), 'utf8').trimEnd();
export const FUENTE_REINTENTO = readFileSync(join(AQUI, '../../../src/core/medios/guardado-reintento.js'), 'utf8').trimEnd();
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
export function cabeceraDeFuentes(carga, config, cupo) {
  for (const n of [carga, config]) if (!NOMBRE_DE_NODO.test(String(n))) throw new Error(`guardado: nombre de nodo no válido: ${String(n).slice(0, 40)}`);
  // Con `cupo` (solo el canal rele) la cabecera define también `GM_CUPO`; sin él, la cabecera es la de siempre, byte a byte.
  const lineaCupo = cupo === undefined ? [] : [`const GM_CUPO = { porTelefono: ${validarCupo(cupo).porTelefono}, global: ${validarCupo(cupo).global} };`];
  return [
    '// FUENTES DEL GUARDADO: las arma Flujos/experimental/comun-sin-agente/src/guardado.mjs para este flujo (nombres de nodo literales, para que n8n los precargue).',
    'const GM_FUENTES = {',
    `  carga: $('${carga}').isExecuted ? $('${carga}').first().json : {},`,
    `  config: $('${config}').isExecuted ? $('${config}').first().json : {},`,
    '};',
    ...lineaCupo,
  ].join('\n');
}

/** El cupo: enteros de 1 a 500 (500 es el tope diario de descargas por WABA; cada medio gasta 2, así que un cupo de medios mayor que 250 no tiene sentido). */
export function validarCupo(cupo) {
  const c = { ...CUPO_POR_DEFECTO_RELE, ...(cupo || {}) };
  for (const k of ['porTelefono', 'global']) {
    if (!Number.isInteger(c[k]) || c[k] < 1 || c[k] > 250) throw new Error(`guardado: cupo.${k} tiene que ser un entero de 1 a 250 (medios por día; cada uno gasta 2 de las 500 descargas del WABA)`);
  }
  if (c.porTelefono > c.global) throw new Error('guardado: cupo.porTelefono no puede pasar de cupo.global');
  return c;
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

/** Los nueve nodos de la rama, sin conectar al flujo. `desde` es [x, y] del primero. */
export function nodosDelGuardado(opciones) {
  const o = opciones || {};
  const c = o.credenciales || {};
  if (o.canal !== undefined && o.canal !== 'graph' && o.canal !== 'rele') throw new Error(`guardado: canal desconocido: ${String(o.canal).slice(0, 20)} (graph o rele)`);
  const rele = o.canal === 'rele';
  if (rele) {
    if (!c.ingesta || !c.rele) throw new Error('guardado: faltan credenciales.ingesta y credenciales.rele (por NOMBRE)');
    if (String(c.rele) === String(c.ingesta)) throw new Error('guardado: la credencial del relé no puede ser la de ingesta');
    validarRele({ cliente: o.cliente, releUrl: o.releUrl, credenciales: { rele: c.rele } });
  } else {
    if (!c.ingesta || !c.graph) throw new Error('guardado: faltan credenciales.ingesta y credenciales.graph (por NOMBRE)');
    if (/ingesta/i.test(String(c.graph)) || String(c.graph) === String(c.ingesta)) throw new Error('guardado: la credencial de Graph no puede ser la de ingesta (la trampa del 15/09)');
  }
  if (!/^https:\/\/[a-z0-9.-]+\/guardarMedio$/.test(String(o.guardarUrl || ''))) throw new Error('guardado: guardarUrl tiene que ser https://<anfitrión>/guardarMedio');
  const carga = o.carga || 'Carga de entrada';
  const config = o.config || 'Config del negocio';
  const numero = o.numero;
  if (!numero) throw new Error('guardado: falta la expresión del número del negocio (numero)');
  const [x, y] = o.desde || [0, 0];
  const releUrl = o.releUrl === undefined ? MARCADOR_URL_DEL_RELE : String(o.releUrl);
  const graph = rele
    ? { parametros: { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' }, credentials: { httpHeaderAuth: { id: '', name: c.rele } } }
    : autenticacionDeGraph(c);
  // El aviso sale con la credencial de ENVÍO del flujo («Enviar a WhatsApp»), la que corresponde a su variante (prueba o producción), no con la de descarga.
  const graphAviso = rele ? graph : autenticacionDeGraph({ graph: c.graphAviso || c.graph, graphTipo: c.graphAvisoTipo || c.graphTipo });
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
  // El Content-Type saneado de «Preparar guardado» (contrato v2 §4). n8n arma primero el del binario y DESPUÉS mezcla estas cabeceras (en minúsculas),
  // así que esta manda sobre el mime que trajo el CDN de Meta (n8n-nodes-base 2.36.5, HttpRequestV3).
  const tipoDeContenido = { name: 'Content-Type', value: `={{ ${P}.contentType }}` };
  // El mime declarado por Meta, saneado contra la lista cerrada (revisión de #709): en video y documento el Content-Type es siempre octet-stream.
  const mimeDeclarado = { name: 'X-NovuChat-Mime', value: `={{ ${P}.mime }}` };
  return [
    {
      id: 'gm-preparar', name: 'Preparar guardado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y],
      // Canal rele: el cupo de descargas va DELANTE (cabecera con `GM_CUPO` + `guardado-cupo.js`); el canal Graph queda byte a byte como estaba.
      parameters: { jsCode: rele ? `${cabeceraDeFuentes(carga, config, o.cupo || {})}\n\n${FUENTE_CUPO}\n\n${FUENTE_PREPARAR}\n` : `${cabeceraDeFuentes(carga, config)}\n\n${FUENTE_PREPARAR}\n` },
      notes: 'Rama del GUARDADO de medios (módulo común Flujos/src/core/medios/): todo medio se guarda (imagen, audio, video, documento de cualquier tipo, sticker). Corre después de la respuesta al cliente y nunca la frena. No toca el binario.',
    },
    {
      id: 'gm-url', name: 'Pedir el medio a Meta (guardado)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 240, y + 200],
      parameters: rele
        ? { method: 'GET', url: urlInfoRele(releUrl), ...graph.parametros, options: { timeout: 30000 } }
        : {
          method: 'GET', url: `=https://graph.facebook.com/{{ ${version} }}/{{ String($json.mediaId || '').replace(/[^A-Za-z0-9_-]/g, '') }}`,
          ...graph.parametros, options: { timeout: 10000 },
        },
      // Por el relé NO se reintenta: un id vencido da 502 WM-3040 y reintentarlo gasta una descarga más de las 500 por día y por WABA.
      credentials: graph.credentials, ...SIN_CORTAR, ...(rele ? {} : { retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }),
      notes: rele
        ? 'GET /v1/envio/medios/<id> por el relé B9: devuelve id, mime_type, file_size y sha256 (sin url). Sin reintentos: un id vencido da 502 WM-3040 y cada GET gasta una de las 500 descargas diarias por WABA. Llamada PROPIA del guardado (doble descarga).'
        : 'GET /{media-id} con la credencial de WhatsApp: devuelve url, mime_type y file_size. Llamada PROPIA del guardado (doble descarga): no gasta el tope de ver u oír.',
    },
    {
      id: 'gm-descargar', name: 'Descargar medio (guardado)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 480, y + 200],
      parameters: {
        method: 'GET', url: rele ? urlDescargaRele(releUrl) : URL_DESCARGA_GUARDADO, ...graph.parametros,
        options: { timeout: 60000, redirect: { redirect: { followRedirects: false } }, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
      },
      // Sin reintento: con la URL vacía (medio demasiado grande) no hay nada que reintentar. Una descarga fallida la registra «Resultado del guardado».
      credentials: graph.credentials, ...SIN_CORTAR,
      notes: rele
        ? 'Baja el archivo por el relé (GET /v1/envio/medios/<id>/contenido), sin seguir redirecciones, SOLO si la info trajo un file_size mayor que cero y de hasta 16 MiB. Si no (sin tamaño, demasiado grande, id vencido), la URL queda vacía y no se baja nada. Sin neverError: un 4xx o 5xx deja un item sin binario. 60 s para 16 MiB.'
        : 'Baja el archivo del CDN de Meta con el token, sin seguir redirecciones, SOLO si Meta informó un tamaño de hasta 16 MiB. Si no, la URL queda vacía y no se baja nada (cuenta como 413). 60 s para 16 MiB.',
    },
    {
      id: 'gm-guardar', name: 'Guardar medio', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 720, y + 200],
      parameters: {
        method: 'POST', url: o.guardarUrl, ...ingesta, sendHeaders: true,
        headerParameters: { parameters: [...cabecerasComunes, tipoDeContenido, mimeDeclarado] },
        sendBody: true, contentType: 'binaryData', inputDataFieldName: 'data',
        options: { timeout: 60000, ...RESPUESTA_COMPLETA },
      },
      credentials: credIngesta, ...SIN_CORTAR,
      notes: 'POST guardarMedio con los BYTES del medio en el cuerpo (Content-Type saneado: el de la lista cerrada o application/octet-stream), solo el token de ingesta del número, nunca firma. Sin reintentos: el servidor reconoce el repetido por el id del mensaje.',
    },
    {
      id: 'gm-si-reintentar', name: '¿Reintentar el guardado?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x + 960, y],
      parameters: condicion('={{ Number($json.statusCode) >= 500 && Number($json.statusCode) <= 599 }}'),
      notes: 'Un 5xx de guardarMedio (502 no_se_guardo, no_se_registro u otro) se reintenta UNA vez; lo demás va directo a «Resultado del guardado».',
    },
    {
      id: 'gm-reintento', name: 'Preparar reintento', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 1200, y + 200],
      parameters: { jsCode: `${FUENTE_REINTENTO}\n` },
      notes: 'Arma el reintento con el mismo pedido: los datos de «Preparar guardado» y la REFERENCIA al binario ya bajado (no se vuelve a pedir a Meta; no lo lee).',
    },
    {
      id: 'gm-reintentar', name: 'Reintentar el guardado', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 1440, y + 200],
      parameters: {
        method: 'POST', url: o.guardarUrl, ...ingesta, sendHeaders: true, specifyHeaders: 'json',
        jsonHeaders: `={{ JSON.stringify({ 'X-NovuChat-Numero': String(${numero}), 'X-NovuChat-Telefono': $json.telefono, 'X-NovuChat-IdMeta': $json.idMeta, 'X-NovuChat-Tipo': $json.tipo, 'Content-Type': $json.contentType, 'X-NovuChat-Mime': $json.mime }) }}`,
        sendBody: true, contentType: 'binaryData', inputDataFieldName: 'data',
        options: { timeout: 60000, ...RESPUESTA_COMPLETA },
      },
      credentials: credIngesta, ...SIN_CORTAR,
      notes: 'El ÚNICO reintento ante un 5xx: mismo pedido, mismos bytes. Si vuelve a fallar, «Resultado del guardado» aplica el aviso de falla (uno por día).',
    },
    {
      id: 'gm-resultado', name: 'Resultado del guardado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 1680, y],
      parameters: { jsCode: `${FUENTE_RESULTADO}\n` },
      notes: 'Toda respuesta de guardarMedio termina acá sin cortar nada. Solo 413 (o más de 16 MiB según Meta), 415, 429 y 502 arman el aviso a la recepción: con su ventana de 24 h abierta, uno por día y sin datos del paciente.',
    },
    {
      id: 'gm-avisar', name: 'Avisar falla del guardado', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 1920, y],
      parameters: rele
        // Un solo intento, sin onError y SIN neverError: un no-2xx deja la ejecución en error (ningún fallo tragado). 504 WM-3041 nunca se reenvía.
        ? parametrosDeMensajeRele({
          cliente: o.cliente, releUrl, credenciales: { rele: c.rele }, rol: 'avisoguardado', neverError: false,
          pnidExpresion: String(numero), nExpresion: '1',
          payloadExpresion: "({ messaging_product: 'whatsapp', recipient_type: 'individual', type: 'text', text: { preview_url: false, body: String($json.texto || '').slice(0, 500) } })",
          destinoExpresion: '$json.numeroRecepcion',
        })
        : {
          method: 'POST', url: `=https://graph.facebook.com/{{ ${version} }}/{{ String(${numero}).replace(/\\D/g, '') }}/messages`,
          ...graphAviso.parametros, sendBody: true, specifyBody: 'json',
          jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: $json.numeroRecepcion, type: 'text', text: { preview_url: false, body: String($json.texto || '').slice(0, 500) } }) }}",
          options: { timeout: 10000 },
        },
      // SIN onError: si Meta rechaza el aviso, la ejecución termina en error (ningún fallo tragado). Corre al final, cuando el cliente ya tiene su respuesta.
      credentials: graphAviso.credentials,
      notes: 'El aviso de falla a la recepción del negocio, en texto libre (su ventana está abierta). Sin reintentos: un aviso repetido llegaría dos veces. Sin onError: si falla, la ejecución termina en error (corre al final, el cliente ya tiene su respuesta). +1 mensaje solo cuando falla el guardado, a lo más uno por día.',
    },
  ];
}

/**
 * Sin `credenciales`, se toman del propio flujo YA ARMADO (con los nombres resueltos para su variante): la de ingesta, de «Reportar mensaje (entrante)»;
 * la de Graph, del nodo que ya baja medios de Meta (`graphDe`, por defecto «Descargar medio»), con su tipo (Bearer o whatsAppApi).
 */
export function credencialesDelFlujo(flujo, ancla, graphDe, canal) {
  const ing = ((ancla.credentials || {}).httpHeaderAuth || {}).name;
  if (!ing) throw new Error(`guardado: «${ancla.name}» no lleva la credencial de ingesta (httpHeaderAuth) por nombre`);
  if (canal === 'rele') {
    // Por el relé la credencial es UNA, la del envío del flujo: «AAB1 envío · <alias>».
    const envioRele = (flujo.nodes || []).find((n) => n.name === 'Enviar a WhatsApp');
    const nombre = String((((envioRele || {}).credentials || {}).httpHeaderAuth || {}).name || '');
    if (!nombre.startsWith(PREFIJO_CREDENCIAL_RELE)) throw new Error(`guardado: «Enviar a WhatsApp» no lleva la credencial «${PREFIJO_CREDENCIAL_RELE}<alias>» (canal rele)`);
    return { ingesta: String(ing), rele: nombre };
  }
  const ref = (flujo.nodes || []).find((n) => n.name === graphDe);
  if (!ref) throw new Error(`guardado: el flujo no tiene «${graphDe}» de donde tomar la credencial de Graph`);
  const tipos = Object.keys(ref.credentials || {});
  if (tipos.length !== 1 || !['httpHeaderAuth', 'whatsAppApi'].includes(tipos[0])) throw new Error(`guardado: «${graphDe}» no lleva una sola credencial de WhatsApp`);
  const graph = String(ref.credentials[tipos[0]].name || '');
  if (!graph || graph === String(ing)) throw new Error(`guardado: «${graphDe}» no lleva una credencial de WhatsApp distinta de la de ingesta`);
  // La del aviso: la del nodo de envío del flujo, si existe.
  const envio = (flujo.nodes || []).find((n) => n.name === 'Enviar a WhatsApp');
  const tiposEnvio = envio ? Object.keys(envio.credentials || {}) : [];
  const aviso = tiposEnvio.length === 1 && ['httpHeaderAuth', 'whatsAppApi'].includes(tiposEnvio[0]) ? { graphAviso: String(envio.credentials[tiposEnvio[0]].name || ''), graphAvisoTipo: tiposEnvio[0] } : {};
  if (aviso.graphAviso !== undefined && (!aviso.graphAviso || aviso.graphAviso === String(ing))) throw new Error('guardado: «Enviar a WhatsApp» no lleva una credencial de WhatsApp distinta de la de ingesta');
  return { ingesta: String(ing), graph, graphTipo: tipos[0], ...aviso };
}

/** Agrega la rama al flujo (lo modifica y lo devuelve). */
export function injertarGuardado(flujo, opciones) {
  const o = opciones || {};
  if (o.canal !== undefined && o.canal !== 'graph' && o.canal !== 'rele') throw new Error(`guardado: canal desconocido: ${String(o.canal).slice(0, 20)} (graph o rele)`);
  // Un flujo que no baja medios no lleva la rama (y no hay nada que guardar).
  if (!manejaMedios(flujo)) return flujo;
  const nombreAncla = o.ancla || ANCLA_DEL_GUARDADO;
  const ancla = (flujo.nodes || []).find((n) => n.name === nombreAncla);
  if (!ancla) throw new Error(`guardado: el flujo no tiene «${nombreAncla}»`);
  const credenciales = o.credenciales || credencialesDelFlujo(flujo, ancla, o.graphDe || 'Descargar medio', o.canal);
  for (const n of NODOS_DEL_GUARDADO) if ((flujo.nodes || []).some((x) => x.name === n)) throw new Error(`guardado: el flujo ya tiene «${n}»`);
  for (const n of [o.carga || 'Carga de entrada', o.config || 'Config del negocio']) if (!(flujo.nodes || []).some((x) => x.name === n)) throw new Error(`guardado: el flujo no tiene «${n}»`);
  // Debajo de TODO el flujo: con executionOrder v1 la rama corre después de la que responde.
  const yMax = Math.max(...flujo.nodes.map((n) => Number((n.position || [0, 0])[1]) || 0));
  const nodos = nodosDelGuardado({ ...o, credenciales, numero: o.numero || numeroDelAncla(ancla), desde: [Number(ancla.position[0]) + 240, yMax + 400] });
  flujo.nodes.push(...nodos);
  // Sin datos de ejecución guardados: el binario del medio quedaría ahí (decisión de Andres, 30/10, contrato v2 §8.1).
  flujo.settings = { ...(flujo.settings || {}), ...RETENCION_DEL_GUARDADO };
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
export function hallazgosDelGuardado(flujo, opciones = {}) {
  const h = [];
  if (!manejaMedios(flujo) && !(opciones && opciones.exigir)) return h;
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const por = (nombre) => nodos.find((n) => n.name === nombre);
  for (const n of NODOS_DEL_GUARDADO) if (!por(n)) h.push(`guardado: falta el nodo «${n}»`);
  for (const n of NODOS_RETIRADOS_DEL_GUARDADO) if (por(n)) h.push(`guardado: sobra «${n}» (el contrato v2 del 30/10 lo quitó: todo documento se guarda)`);
  const st = (flujo && flujo.settings) || {};
  for (const [k, v] of Object.entries(RETENCION_DEL_GUARDADO)) if (st[k] !== v) h.push(`guardado: settings.${k} tiene que ser ${JSON.stringify(v)} (el binario del medio quedaría en los datos de la ejecución; decisión de Andres del 30/10)`);
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
  if (!String(((por('Preparar reintento') || {}).parameters || {}).jsCode || '').includes(FUENTE_REINTENTO)) h.push('guardado: «Preparar reintento» no incluye guardado-reintento.js tal cual');
  // NINGÚN nodo Code de la rama lee el binario (contrato v2 §7.6); los demás nodos de la rama no son Code y ninguno sale de la rama.
  for (const nombre of NODOS_CODE_DEL_GUARDADO) {
    const n = por(nombre);
    if (n.type !== 'n8n-nodes-base.code') h.push(`guardado: «${nombre}» tiene que ser un nodo Code`);
    if (codigoLeeBinario((n.parameters || {}).jsCode)) h.push(`guardado: «${nombre}» lee el contenido del binario (ningún nodo Code de la rama lo hace)`);
  }
  for (const nombre of NODOS_DEL_GUARDADO) {
    const n = por(nombre);
    if (!NODOS_CODE_DEL_GUARDADO.includes(nombre) && n.type === 'n8n-nodes-base.code') h.push(`guardado: «${nombre}» no puede ser un nodo Code`);
    for (const d of [0, 1].flatMap((i) => destinosDe(flujo, nombre, i))) {
      if (!NODOS_DEL_GUARDADO.includes(d)) h.push(`guardado: «${nombre}» sigue hacia «${d}», fuera de la rama`);
    }
  }
  const reintento = por('Reintentar el guardado').parameters || {};
  if (reintento.sendBody !== true || reintento.contentType !== 'binaryData' || reintento.inputDataFieldName !== 'data') h.push('guardado: «Reintentar el guardado» manda los mismos bytes (binaryData, campo data)');
  if (!/'Content-Type': \$json\.contentType/.test(String(reintento.jsonHeaders || ''))) h.push('guardado: «Reintentar el guardado» manda el Content-Type saneado');
  if (!/'X-NovuChat-Mime': \$json\.mime\b/.test(String(reintento.jsonHeaders || ''))) h.push('guardado: «Reintentar el guardado» manda X-NovuChat-Mime');
  const guardarP = por('Guardar medio').parameters || {};
  const ctGuardar = (((guardarP.headerParameters || {}).parameters) || []).find((x) => x && String(x.name).toLowerCase() === 'content-type');
  if (!ctGuardar || ctGuardar.value !== "={{ $('Preparar guardado').first().json.contentType }}") h.push('guardado: «Guardar medio» manda el Content-Type saneado de «Preparar guardado»');
  const mimeGuardar = (((guardarP.headerParameters || {}).parameters) || []).find((x) => x && x.name === 'X-NovuChat-Mime');
  if (!mimeGuardar || mimeGuardar.value !== "={{ $('Preparar guardado').first().json.mime }}") h.push('guardado: «Guardar medio» manda X-NovuChat-Mime (el mime saneado de «Preparar guardado»)');
  if (guardarP.sendBody !== true || guardarP.contentType !== 'binaryData' || guardarP.inputDataFieldName !== 'data') h.push('guardado: «Guardar medio» manda los bytes (binaryData, campo data)');
  if (!String(((por('¿Reintentar el guardado?') || {}).parameters || {}).conditions ? JSON.stringify(por('¿Reintentar el guardado?').parameters.conditions) : '').includes('>= 500')) h.push('guardado: «¿Reintentar el guardado?» reintenta solo un 5xx');
  if (!String(((por('Resultado del guardado') || {}).parameters || {}).jsCode || '').includes(FUENTE_RESULTADO)) h.push('guardado: «Resultado del guardado» no incluye guardado-resultado.js tal cual');
  // Credenciales por nombre: hacia guardarMedio, la MISMA de ingesta de «Reportar mensaje (entrante)»; hacia Meta, una de WhatsApp que NO es
  // esa ni se llama «ingesta» (la trampa del 15/09: el token de ingesta nunca sale hacia graph.facebook.com).
  const ingesta = String((((ancla.credentials || {}).httpHeaderAuth) || {}).name || '');
  if (!ingesta) h.push('guardado: «Reportar mensaje (entrante)» no lleva la credencial de ingesta por nombre');
  // ¿La rama habla con el relé B9 (canal rele) o con Graph? Si CUALQUIERA de los tres nodos de Meta nombra al relé (por su URL o por su credencial), se
  // exige que los tres lo hagan: una rama a medias no pasa por Graph.
  const rele = NODOS_DE_META_DEL_GUARDADO.some((nombre) => /\/v1\/envio\//.test(String(((por(nombre) || {}).parameters || {}).url || ''))
    || credDe(por(nombre)).some((c) => c.nombre.startsWith(PREFIJO_CREDENCIAL_RELE)));
  for (const nombre of NODOS_DE_META_DEL_GUARDADO) {
    const cs = credDe(por(nombre));
    if (rele && cs.length === 1 && (cs[0].tipo !== 'httpHeaderAuth' || !cs[0].nombre.startsWith(PREFIJO_CREDENCIAL_RELE))) h.push(`guardado: «${nombre}» tiene que llevar la credencial «${PREFIJO_CREDENCIAL_RELE}<alias>» (Header Auth) del relé`);
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
    if (rele) continue;
    if (nombre === 'Descargar medio (guardado)' ? url !== URL_DESCARGA_GUARDADO : !url.startsWith('=https://graph.facebook.com/')) h.push(`guardado: «${nombre}» llama a otro anfitrión`);
  }
  if (rele) {
    // Canal rele: ni una llamada a Meta (Graph, su CDN) ni un reintento; las URL son las del relé y la base es el marcador o la misma en los tres.
    const pedir = por('Pedir el medio a Meta (guardado)');
    const bases = new Set();
    const esBase = (t) => { const m = /^=\{\{[^]*?'([^']*)\/v1\/envio\/medios\//.exec(String(t)); return m ? m[1] : (/^=([^/{]*(?:\/\/[^/{]*)?)\/v1\/envio\//.exec(String(t)) || [])[1]; };
    for (const nombre of NODOS_DE_META_DEL_GUARDADO) {
      const n = por(nombre);
      const texto = JSON.stringify(n.parameters || {});
      if (/graph\.facebook\.com|lookaside|fbsbx|whatsAppApi/i.test(texto + JSON.stringify(n.credentials || {}))) h.push(`guardado: «${nombre}» llama a Meta (Graph o su CDN) en un flujo que va por el relé`);
      const base = esBase((n.parameters || {}).url);
      if (base === undefined) h.push(`guardado: «${nombre}» no llama al relé (/v1/envio/…)`); else bases.add(base);
      if (n.retryOnFail) h.push(`guardado: «${nombre}» no reintenta por el relé (un id vencido da 502 WM-3040 y cada GET gasta una de las 500 descargas diarias por WABA)`);
    }
    if (bases.size > 1) h.push('guardado: los nodos del relé no usan la misma base');
    const jsPrep = String((prep.parameters || {}).jsCode || '');
    if (!jsPrep.includes(FUENTE_CUPO)) h.push('guardado: «Preparar guardado» (canal rele) no incluye guardado-cupo.js tal cual: sin el cupo, una ráfaga de un teléfono gasta las 500 descargas diarias del WABA');
    else {
      // El orden exigido: cabecera (con `GM_FUENTES` y `GM_CUPO`) + cupo + preparar. Con el cupo después de preparar, o sin las constantes, no cuenta lo que debe.
      const cab = /^([\s\S]*?const GM_CUPO = \{ porTelefono: (\d+), global: (\d+) \};)\n\n/.exec(jsPrep);
      if (!cab) h.push('guardado: «Preparar guardado» (canal rele) tiene que empezar con la cabecera de fuentes que define GM_FUENTES y GM_CUPO');
      else {
        if (!/^\/\/ FUENTES DEL GUARDADO:[^\n]*\nconst GM_FUENTES = \{/.test(cab[1])) h.push('guardado: «Preparar guardado» (canal rele) no empieza con la cabecera de fuentes del guardado');
        const pt = Number(cab[2]);
        const gl = Number(cab[3]);
        if (!(pt >= 1 && gl >= 1 && pt <= gl && gl <= 250)) h.push('guardado: GM_CUPO de «Preparar guardado» fuera de rango (1 a 250, porTelefono no mayor que global)');
        if (jsPrep.slice(cab[0].length).indexOf(FUENTE_CUPO) !== 0) h.push('guardado: guardado-cupo.js tiene que ir justo después de la cabecera y ANTES de guardado-preparar.js');
      }
      const iCupo = jsPrep.indexOf(FUENTE_CUPO);
      const iPrep = jsPrep.indexOf(FUENTE_PREPARAR);
      if (iPrep < 0 || iPrep < iCupo) h.push('guardado: «Preparar guardado» (canal rele) tiene que llevar guardado-preparar.js DESPUÉS del cupo');
    }
    const base = [...bases][0];
    if (base !== undefined && !esBaseDeReleAdmitida(base)) h.push('guardado: la base del relé tiene que ser el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE (solo las pruebas usan un host *.example)');
    if (base !== undefined) {
      if (String((pedir.parameters || {}).url) !== urlInfoRele(base)) h.push('guardado: «Pedir el medio a Meta (guardado)» no pide GET /v1/envio/medios/<id>');
      if (String(((por('Descargar medio (guardado)') || {}).parameters || {}).url) !== urlDescargaRele(base)) h.push('guardado: «Descargar medio (guardado)» no pide /contenido solo con file_size dentro del límite');
    }
    const av = por('Avisar falla del guardado');
    if (!/\/v1\/envio\/mensajes\//.test(String((av.parameters || {}).url || ''))) h.push('guardado: «Avisar falla del guardado» tiene que enviar por POST /v1/envio/mensajes/<phone_number_id>');
    const clave = (((av.parameters || {}).headerParameters || {}).parameters || []).find((x) => x && x.name === 'Idempotency-Key');
    if (!clave || !/-avisoguardado-/.test(String(clave.value))) h.push('guardado: «Avisar falla del guardado» tiene que llevar la Idempotency-Key');
    const respuesta = ((((av.parameters || {}).options || {}).response || {}).response) || {};
    if (respuesta.neverError === true || respuesta.fullResponse === true) h.push('guardado: «Avisar falla del guardado» sin neverError: un no-2xx deja la ejecución en error');
    if (Number(((av.parameters || {}).options || {}).timeout) < 30000) h.push('guardado: «Avisar falla del guardado» espera al menos 30 s al relé');
    const descarga = por('Descargar medio (guardado)');
    const rd = ((((descarga.parameters || {}).options || {}).response || {}).response) || {};
    if (rd.neverError === true) h.push('guardado: «Descargar medio (guardado)» sin neverError: un 4xx o 5xx no puede pasar por un binario');
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
  const envioDelFlujo = por('Enviar a WhatsApp');
  if (envioDelFlujo && JSON.stringify(aviso.credentials || {}) !== JSON.stringify(envioDelFlujo.credentials || {})) h.push('guardado: «Avisar falla del guardado» tiene que llevar la MISMA credencial que «Enviar a WhatsApp» (la de envío de su variante)');
  if (por('Descargar medio (guardado)').retryOnFail) h.push('guardado: «Descargar medio (guardado)» no reintenta (con la URL vacía no hay qué reintentar)');
  if (aviso.onError !== undefined || aviso.continueOnFail !== undefined) h.push('guardado: «Avisar falla del guardado» no lleva onError: si Meta lo rechaza, la ejecución termina en error (ningún fallo tragado)');
  if (!/(to:\s*|o\.to = String\()\(?\$json\.numeroRecepcion\b/.test(String((aviso.parameters || {}).jsonBody || ''))) h.push('guardado: «Avisar falla del guardado» va SOLO al número de recepción del negocio');
  if (aviso.retryOnFail || por('Guardar medio').retryOnFail) h.push('guardado: el aviso y el guardado no reintentan');
  return h;
}
