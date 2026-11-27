/**
 * =============================================================================
 * rafaga.mjs — agrupar la ráfaga de textos de un mismo teléfono, pieza común a todo flujo conversacional
 * =============================================================================
 *
 *   import { injertarRafaga, quitarRafaga, hallazgosDeLaRafaga, NODOS_DE_LA_RAFAGA } from '<ruta>/core/rafaga/rafaga.mjs';
 *
 * Quien escribe «hola» / «quiero reservar» / «para mañana» en tres mensajes seguidos dispara tres ejecuciones y recibe tres respuestas (tres mensajes que
 * cuestan dinero, 0,0113 USD cada uno). Con la pieza responde UNA ejecución con los tres textos unidos; las otras terminan sin enviar. Un texto aislado sale con el mismo contenido de hoy,
 * pero con LATENCIA AGREGADA: la espera (`esperaRafagaSeg`, 2 s por defecto, acotada de 1 a 5) por cada texto aislado, y hasta ~6,3 s si la consulta falla (3000 ms x 2 intentos + 300 ms)
 * antes de responder solo. Lecturas en la nube: 11 en el caso normal y hasta 12 por consulta (ruta autenticada 1 + ficha 1 + mi documento hasta 2 + hasta 5 anteriores + hasta 3 siguientes), 0 escrituras.
 *
 * INTERRUPTORES (qué se cambia sin republicar y qué no):
 *   - POR COMERCIO, sin republicar: `rafagaApagada: true` en la ficha del tenant. `configuracionFlujo` lo entrega y el IF lo lee de «Config del negocio» (`$('Config del negocio').first().json.rafagaApagada`,
 *     la respuesta del servidor ya mezclada por el flujo); es el único que apaga una ráfaga en un comercio sin tocar el JSON. OJO: NO es un interruptor general hasta que se
 *     fusione el #1135. Hoy solo lo propagan en sus ramas Demo B (#1125) y Bellido (#1127); Walisuma y Demo A no lo propagan («Config del negocio» no emite la clave) y en esos el
 *     interruptor por comercio no llega al IF. La pieza no lo verifica al armar.
 *   - POR FLUJO: `rafagaActiva` y `esperaRafagaSeg` viven en «Config base», que es un nodo del JSON del flujo: cambiarlos exige republicar ese flujo. Es así a propósito: la espera es una
 *     propiedad del flujo (cuánto tolera su conversación) y no debe variar por comercio dentro de un mismo flujo, y un valor del JSON es revisable y probado con el flujo.
 * Mensajes por conversación: no agrega (solo quita, nunca agrega).
 *
 * ES UNA PIEZA COMÚN, INCLUIDA Y NUNCA COPIADA: la incluyen los `construir.mjs` y el ensamblador (clave `rafaga` del manifiesto). En esta entrega (PR A) NINGÚN
 * flujo la declara: el servidor (rama `rafaga` de `configuracionFlujo`) y esta pieza quedan listos, y cada flujo la adopta en su propio PR.
 *
 * LA FORMA (cuatro nodos EN LÍNEA entre el ancla y su destino):
 *
 *   <ancla> ─→ ¿Esperar ráfaga? ─sí→ Esperar ráfaga → Consultar ráfaga → Agrupar ráfaga ─→ <destino>
 *                               └no────────────────────────────────────────────────────→ <destino>
 *
 *  - «¿Esperar ráfaga?» (IF): interruptor encendido (`rafagaActiva` de «Config base», verdadero si falta; `rafagaApagada === true` en «Config del negocio»,
 *    que el servidor agrega a la respuesta de `configuracionFlujo` solo cuando el comercio la apagó), el entrante es de tipo `text`, tiene `mensajeId`
 *    y teléfono, «Reportar mensaje (entrante)» ya corrió, y la `puerta` del flujo (una expresión JS sobre `n`, el item del ancla; por defecto `true`).
 *    A PRUEBA DE LECTURA FALLIDA: si una lectura de otro nodo lanza, la condición da `false` y el turno sigue como hoy.
 *  - `fuente` (opcional): nombre del nodo del que se leen el id, el teléfono, el número y el texto (IF, consulta y Code usan `$('<fuente>').first().json`). Hace falta cuando el item del
 *    ancla NO trae esos campos (el ancla viene tras una «Puerta del turno» que solo emite {ruta, texto…} o tras una llamada HTTP): sin `fuente`, SOLO se arma si el item del ancla sale del normalizador por nodos transparentes (IF, Switch, Filter, Wait, NoOp: lista blanca); con cualquier otro nodo en el camino (Code, Set, HTTP, Merge…) se niega. Tiene que ser ASCENDIENTE
 *    del ancla y correr una vez por mensaje (no se puede verificar sin ejecutar: lo exige la revisión del PR del flujo). La `puerta` puede leer otros nodos con `$('<nodo>')`; se valida que existan y
 *    sean ascendientes del ancla. «Agrupar ráfaga» emite el item del ancla más `rafaga` y `textoDelTurno`: el flujo lee `textoDelTurno` con `$('Agrupar ráfaga')`.
 *  - UN SOLO ORIGEN: el IF (`$json`), la consulta y el Code leen el id, el teléfono, el número y el texto del MISMO item, el del ancla (`$('¿Esperar ráfaga?')`),
 *    con los nombres de campo de `campos`. Ese item tiene que ser el que arma el normalizador (o uno que conserve sus campos): por eso el normalizador, «Config del
 *    negocio» y «Config base» tienen que ser ASCENDIENTES del ancla (si no, se niega a armar).
 *  - «Esperar ráfaga» (Wait): `esperaRafagaSeg` de «Config base» (defecto 2, acotado a 1-5).
 *  - «Consultar ráfaga» (HTTP): `POST` a `configuracionFlujo` con `{telefono, rafaga:{v:1, idMeta}}`; URL y credencial son las de «Traer configuración» de ese
 *    flujo. «Continue on Fail» SOLO acá, 3000 ms de tope y UN reintento (2 intentos, 300 ms entre ellos; peor caso ~6,3 s): si sigue fallando, «Agrupar ráfaga» responde solo (falla ABIERTO).
 *  - «Agrupar ráfaga» (Code, `agrupar-rafaga.js`): devuelve `[]` (silencio) o el item del turno con `rafaga:{accion, ids}` y, si agrupó, `textoDelTurno`.
 *
 *  - REQUISITO DE CADA FLUJO (no se puede validar sin estado): el ancla va DESPUÉS de todos los desvíos que responden por otra rama (atención de un operador, bloqueado, palabra clave de menú,
 *    `puerta` falsa). La ráfaga supone que mi vecino siguiente llegará al mismo ancla: si se desvía, quien calló por él no recibe respuesta.
 *  - ORDEN DEL LIENZO (`executionOrder: v1`): «Reportar mensaje (entrante)» tiene que correr ANTES (es ascendiente del ancla, o va más arriba que el destino); si
 *    no, se niega a armar. La condición `isExecuted` del IF lo vuelve a exigir en tiempo de ejecución.
 *  - Nombres: la pieza usa los nombres «¿Esperar ráfaga?», «Esperar ráfaga», «Consultar ráfaga» y «Agrupar ráfaga». Un flujo que ya tenga uno (el chat de NovuChat
 *    trae «Esperar ráfaga» para la coalescencia de clics) no la admite: se niega a armar.
 *
 * `opciones` de `injertarRafaga`:
 *   ancla                 { nodo, salida?: 0, destino }  (obligatoria: el nodo y la salida cuya conexión a `destino` se reemplaza)
 *   normalizador          nodo que emite el item del ancla (por defecto «Interpretar entrada» o «Normalizar entrada»); debe ser ascendiente del ancla
 *   campos                nombres de campo del item del ancla: { tipo, mensajeId, from, phoneNumberId, texto } (de `fuente` si se da; por defecto los del normalizador común y `userInput`)
 *   config                «Config del negocio»        configBase  «Config base»        traerConfiguracion  «Traer configuración»
 *   puerta                expresión JS booleana sobre `n` (por defecto `true`)
 *   campos                OBLIGATORIO `campos.texto` (sin valor por defecto); el resto, canónico. Una clave desconocida es error. Se verifican contra el código del productor (acorn).
 *   consumidor            OBLIGATORIO: nodo(s) que LEEN `textoDelTurno` de «Agrupar ráfaga» (destino o descendientes). Sin él la pieza PIERDE los mensajes agrupados. `null` solo en fixtures de
 *                         llamadas directas a `injertarRafaga`: el ENSAMBLADOR lo rechaza en un manifiesto (un flujo real nunca lo declara).
 *   puerta                se valida al armar: una puerta constante falsa («false», 0…) es ERROR (apagaría la ráfaga en silencio), y cada `n.<campo>` que lee tiene que ser una clave que el productor emite.
 * Devuelve el mismo flujo con los cuatro nodos y sus conexiones. Lanza si falta algo: no se arma a medias.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODO_RAFAGA_SI = '¿Esperar ráfaga?';
export const NODO_RAFAGA_ESPERAR = 'Esperar ráfaga';
export const NODO_RAFAGA_CONSULTAR = 'Consultar ráfaga';
export const NODO_RAFAGA_AGRUPAR = 'Agrupar ráfaga';
export const NODOS_DE_LA_RAFAGA = [NODO_RAFAGA_SI, NODO_RAFAGA_ESPERAR, NODO_RAFAGA_CONSULTAR, NODO_RAFAGA_AGRUPAR];
export const ANCLA_REPORTE = 'Reportar mensaje (entrante)';
export const TIMEOUT_RAFAGA_MS = 3000;
/** Un reintento: una consulta fallida de la ejecución anterior haría que la siguiente duplique su texto (lado seguro, pero cuesta un mensaje). */
export const REINTENTOS_MAXIMOS = 2;
export const ESPERA_ENTRE_INTENTOS_MS = 300;
export const ESPERA_POR_DEFECTO_SEG = 2;
export const NORMALIZADORES = ['Interpretar entrada', 'Normalizar entrada'];

/** Los cuatro campos con nombre canónico (los del normalizador común). El del TEXTO no tiene valor por defecto: cada flujo lo declara (`campos.texto`) y se verifica contra el código del productor. */
export const CAMPOS_CANONICOS = { tipo: 'tipo', mensajeId: 'mensajeId', from: 'from', phoneNumberId: 'phoneNumberId' };
const CLAVES_DE_CAMPOS = [...Object.keys(CAMPOS_CANONICOS), 'texto'];
const camposDe = (o) => {
  const dado = (o && o.campos) || {};
  for (const k of Object.keys(dado)) if (!CLAVES_DE_CAMPOS.includes(k)) throw new Error(`rafaga: \`campos\` tiene una clave desconocida «${k}» (válidas: ${CLAVES_DE_CAMPOS.join(', ')})`);
  if (typeof dado.texto !== 'string') throw new Error('rafaga: falta `campos.texto` (el nombre del campo con el texto del mensaje: `userInput` en los demos, `texto` en Walisuma y Bellido); no tiene valor por defecto');
  const c = { ...CAMPOS_CANONICOS, ...dado };
  for (const [k, v] of Object.entries(c)) if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new Error(`rafaga: el campo «${k}» tiene un nombre inválido`);
  return c;
};

// acorn vive en `admin/` (devDependency fija, como en `guarda-ast.mjs`): `Flujos/` no tiene `node_modules`. Sin acorn la carga falla ruidosamente: no hay guardia en silencio.
// Se carga la primera vez que se analiza un código (no al importar): el ensamblador y sus copias de prueba no la necesitan si ningún manifiesto declara la ráfaga.
// `createRequire` no exige que la ruta exista, así que el `const` va a nivel de módulo: es la forma que el lector de fronteras (`pruebas/frontera/frontera.ts`) sabe seguir.
const requerir = createRequire(fileURLToPath(new URL('../../../../admin/package.json', import.meta.url)));
let acornCargado = null;
const acornDe = () => (acornCargado ??= requerir('acorn'));

const CODIGO = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'agrupar-rafaga.js'), 'utf8');
const NOMBRE_CONFIG_BASE_EN_CODIGO = "$('Config base')";

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
const nodosDe = (flujo) => (Array.isArray(flujo && flujo.nodes) ? flujo.nodes : []);
const por = (flujo, nombre) => nodosDe(flujo).find((n) => n.name === nombre);
const listaDe = (flujo, de, salida) => ((((flujo.connections || {})[de] || {}).main || [])[salida] || []);
const destinos = (flujo, de, salida) => listaDe(flujo, de, salida).map((x) => x.node);
const normalizadorDe = (flujo) => NORMALIZADORES.find((n) => por(flujo, n)) || null;

/** El cuerpo del nodo Code: el archivo canónico, con el nombre de «Config base» del flujo. */
export const codigoDeLaRafaga = (configBase = 'Config base', campos = {}, fuente = '') => {
  if (/['\\\n]/.test(String(fuente))) throw new Error('rafaga: el nombre de la fuente no puede llevar comillas, barras ni saltos de línea');
  const c = { ...CAMPOS_CANONICOS, texto: 'userInput', ...campos };
  const sustituido = CODIGO.split(NOMBRE_CONFIG_BASE_EN_CODIGO).join(`$('${configBase}')`)
    .replace("const CAMPO_ID = 'mensajeId';", `const CAMPO_ID = '${c.mensajeId}';`)
    .replace("const CAMPO_TEXTO = 'userInput';", `const CAMPO_TEXTO = '${c.texto}';`)
    .replace("const FUENTE = '';", `const FUENTE = '${fuente}';`)
    // El task runner de n8n precarga solo los nodos nombrados con literal `$('X')`; un `$(FUENTE)` dinámico junto a los literales de este Code no precarga la fuente y el nodo
    // fallaría en n8n real (y `problemasDeReferencias` lo rechaza). Se escribe el nombre como literal.
    .replace('const mensaje = entrada;', () => (fuente ? `const mensaje = $('${fuente}').first().json;` : 'const mensaje = entrada;'));
  return sustituido;
};

/** La cabecera X-NovuChat-Numero de «Traer configuración»: la consulta tiene que decir el mismo número que ella (el del entrante y, en prueba, el esperado). */
function cabeceraDeTraer(traer) {
  const lista = ((((traer || {}).parameters || {}).headerParameters || {}).parameters) || [];
  const h = lista.find((x) => x && x.name === 'X-NovuChat-Numero');
  if (!h) throw new Error('rafaga: «Traer configuración» no manda la cabecera X-NovuChat-Numero: no se puede armar la consulta con el mismo número');
  const v = String(h.value || '');
  if (!/phoneNumberId/.test(v)) throw new Error('rafaga: la cabecera X-NovuChat-Numero de «Traer configuración» no sale de `phoneNumberId`');
  if (/modoPrueba/.test(v) && !/phoneNumberIdEsperado/.test(v)) throw new Error('rafaga: la cabecera X-NovuChat-Numero de «Traer configuración» usa modoPrueba sin `phoneNumberIdEsperado`');
  return v;
}

/** Los cuatro nodos, sin conectar. `traer` es el nodo «Traer configuración» del flujo (de él salen URL y credencial). */
export function nodosDeLaRafaga(opciones) {
  const o = opciones || {};
  const traer = o.traer || {};
  const url = String(((traer.parameters) || {}).url || '');
  if (!/^https:\/\/[a-z0-9.-]+\/configuracionFlujo$/.test(url)) throw new Error('rafaga: «Traer configuración» tiene que llamar a https://…/configuracionFlujo');
  const cred = Object.entries(traer.credentials || {});
  if (cred.length !== 1) throw new Error('rafaga: «Traer configuración» tiene que llevar UNA credencial (la de ingesta, por nombre)');
  cabeceraDeTraer(traer);
  const config = o.config || 'Config del negocio';
  const configBase = o.configBase || 'Config base';
  const k = camposDe(o);
  const puerta = o.puerta === undefined ? 'true' : String(o.puerta);
  if (/\*\/|\/\*|\n/.test(puerta)) throw new Error('rafaga: la puerta es una expresión de una línea, sin comentarios');
  const puertaMala = problemasDeLaPuerta(puerta);
  if (puertaMala) throw new Error(`rafaga: ${puertaMala}`);
  const [x, y] = o.posicion || [0, 0];
  const fuente = o.fuente === undefined || o.fuente === null ? '' : String(o.fuente);
  if (/['\\\n]/.test(fuente)) throw new Error('rafaga: el nombre de la fuente no puede llevar comillas, barras ni saltos de línea');
  // Con `fuente`, el id, el teléfono, el número y el texto se leen SIEMPRE de ese nodo (que corre una vez por mensaje); sin ella, del item del ancla.
  const N = fuente ? `$('${fuente}').first().json` : `$('${NODO_RAFAGA_SI}').first().json`;
  const origenDelIf = fuente ? `$('${fuente}').first().json` : '$json';
  const C = `$('${config}').first().json`;
  const B = `$('${configBase}').first().json`;
  const autenticacion = { authentication: (traer.parameters || {}).authentication, genericAuthType: (traer.parameters || {}).genericAuthType };
  if (autenticacion.authentication !== 'genericCredentialType' || autenticacion.genericAuthType !== 'httpHeaderAuth') throw new Error('rafaga: «Traer configuración» tiene que autenticar con httpHeaderAuth');
  return [
    {
      id: 'rafaga-si', name: NODO_RAFAGA_SI, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x, y],
      parameters: condicion(`={{ (() => { try { const b = ${B}; const c = ${C}; const n = ${origenDelIf}; return String(b.rafagaActiva) !== 'false' && c.rafagaApagada !== true && n.${k.tipo} === 'text' && !!n.${k.mensajeId} && !!n.${k.from} && $('${ANCLA_REPORTE}').isExecuted === true && !!(/*puerta*/(${puerta})/*fin*/); } catch (e) { return false; } })() }}`),
      notes: 'Interruptor por negocio: `rafagaActiva` en «Config base» (verdadero si falta) y `rafagaApagada` que el servidor agrega a la configuracion. Solo textos. Pieza comun Flujos/src/core/rafaga/.',
    },
    {
      id: 'rafaga-esperar', name: NODO_RAFAGA_ESPERAR, type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [x + 240, y],
      parameters: { resume: 'timeInterval', amount: `={{ (() => { let s = NaN; try { s = Number(${B}.esperaRafagaSeg); } catch (e) { s = NaN; } return Number.isFinite(s) && s > 0 ? Math.min(5, Math.max(1, s)) : ${ESPERA_POR_DEFECTO_SEG}; })() }}`, unit: 'seconds' },
      notes: 'Espera `esperaRafagaSeg` (defecto 2, de 1 a 5) a que lleguen los demas textos de la rafaga. Menos de 65 s: n8n la mantiene en memoria.',
    },
    {
      id: 'rafaga-consultar', name: NODO_RAFAGA_CONSULTAR, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 480, y],
      credentials: { [cred[0][0]]: { id: '', name: String((cred[0][1] || {}).name || '') } }, onError: 'continueRegularOutput',
      retryOnFail: true, maxTries: REINTENTOS_MAXIMOS, waitBetweenTries: ESPERA_ENTRE_INTENTOS_MS,
      parameters: {
        method: 'POST', url, ...autenticacion,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: `={{ String(${C}.modoPrueba === true && ${C}.phoneNumberIdEsperado ? ${C}.phoneNumberIdEsperado : ${N}.${k.phoneNumberId}).replace(/\\D/g, '') }}` }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ telefono: String(${N}.${k.from} || '').replace(/\\D/g, ''), rafaga: { v: 1, idMeta: String(${N}.${k.mensajeId}) } }) }}`,
        options: { timeout: TIMEOUT_RAFAGA_MS },
      },
      notes: 'Lee del servidor los ultimos mensajes de este telefono (11 lecturas en el caso normal y hasta 12 con reintento de Meta, ninguna escritura; el servidor descarta vecinos de mas de 30 s y mi mensaje debe tener 60 s o menos). Misma URL y credencial que «Traer configuracion». Con Continue on Fail, 3 s de tope y un reintento: si sigue fallando, «Agrupar rafaga» responde solo.',
    },
    {
      id: 'rafaga-agrupar', name: NODO_RAFAGA_AGRUPAR, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 720, y],
      parameters: { jsCode: codigoDeLaRafaga(configBase, k, fuente) },
      notes: 'Decide: silencio (devuelve nada), solo (igual que hoy) o agrupado (textoDelTurno con los textos unidos). Falla abierto. Modulo comun Flujos/src/core/rafaga/agrupar-rafaga.js.',
    },
  ];
}

/** Los nodos desde los que se llega a `destino` siguiendo cualquier salida. */
function ascendientes(flujo, destino) {
  const padres = new Map();
  for (const [de, o] of Object.entries(flujo.connections || {})) {
    for (const lista of (o.main || [])) for (const e of (lista || [])) { if (!padres.has(e.node)) padres.set(e.node, new Set()); padres.get(e.node).add(de); }
  }
  const visto = new Set();
  const pila = [destino];
  while (pila.length) {
    for (const p of padres.get(pila.pop()) || []) if (!visto.has(p)) { visto.add(p); pila.push(p); }
  }
  return visto;
}
const y = (n) => Number(((n && n.position) || [0, 0])[1]);
/** «Reportar mensaje (entrante)» corre antes: es ascendiente del ancla o va más arriba que el destino (orden de ramas del lienzo). */
const reporteCorreAntes = (flujo, ancla, destino) => {
  const rep = por(flujo, ANCLA_REPORTE);
  return !!rep && (ascendientes(flujo, ancla).has(ANCLA_REPORTE) || y(rep) < y(por(flujo, destino)));
};

const TIPOS_QUE_DEJAN_PASAR = ['n8n-nodes-base.if', 'n8n-nodes-base.switch', 'n8n-nodes-base.filter', 'n8n-nodes-base.wait', 'n8n-nodes-base.noOp'];
/**
 * LISTA BLANCA (sin `fuente`): el item del ancla trae los campos del mensaje SOLO si, subiendo desde el ancla, todo camino llega al `normalizador` pasando únicamente por nodos
 * transparentes (IF, Switch, Filter, Wait, NoOp). Cualquier otro nodo (Code, Set, HTTP, Merge…) puede cambiar el item y no se sabe qué emite: ahí se pide `fuente`.
 * Devuelve el nombre del primer nodo que lo impide (o «el inicio del flujo»), o null si el item sale del normalizador.
 */
function productorDelItem(flujo, ancla, normalizador) {
  const padres = new Map();
  for (const [de, o] of Object.entries(flujo.connections || {})) for (const lista of (o.main || [])) for (const e of (lista || [])) { if (!padres.has(e.node)) padres.set(e.node, new Set()); padres.get(e.node).add(de); }
  const visto = new Set();
  const pila = [ancla];
  while (pila.length) {
    const nombre = pila.pop();
    if (visto.has(nombre)) continue;
    visto.add(nombre);
    if (nombre === normalizador) continue;
    const n = por(flujo, nombre);
    if (!n || !TIPOS_QUE_DEJAN_PASAR.includes(n.type)) return nombre;
    const arriba = [...(padres.get(nombre) || [])];
    if (!arriba.length) return 'el inicio del flujo';
    pila.push(...arriba);
  }
  return null;
}
/**
 * NORMALIZADORES VERIFICADOS POR EJECUCIÓN. El análisis del código (acorn) decide las claves de nivel superior de lo que el productor emite; pero los normalizadores de los demos arman
 * su item con un spread de la entrada (`...config`, `Object.assign({}, cfg, {…})`) y `phoneNumberId` llega por ahí desde «Config base»: no se puede decidir mirando el código. Esos
 * (y solo esos) se aceptan por la huella SHA-256 de su código, y `rafaga-extremo.test.ts` los EJECUTA con una entrada real y comprueba que `phoneNumberId` sale. Cualquier cambio en
 * el normalizador cambia la huella: la ráfaga deja de armar hasta que se vuelva a verificar y se actualice esta lista.
 */
export const NORMALIZADORES_VERIFICADOS = {
  // «Normalizar entrada» del Demo A (y de Bellido «agendamiento», que corre el mismo módulo) y del Demo B.
  '475bc928539bf4ccf659bc8dac370e8bdd93eedce8f669a590feb8a8270a058c': 'Normalizar entrada del Demo A / bellido-agendamiento',
  'ffdfa73f8c250883760d0b03876c67a2cf212727087bed0027be7f67556b51ea': 'Normalizar entrada del Demo B',
};
export const huellaDe = (codigo) => createHash('sha256').update(String(codigo)).digest('hex');

const PARSE = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
/** ¿El valor es `undefined`, `null`, `void …` o una rama que puede serlo (ternario, `||`/`??` con ambos lados nulos)? Una clave con ese valor NO es una emisión. */
const esNulo = (n) => !!n && (
  (n.type === 'Identifier' && n.name === 'undefined') || (n.type === 'Literal' && n.raw === 'null') || (n.type === 'UnaryExpression' && n.operator === 'void')
  || (n.type === 'ConditionalExpression' && (esNulo(n.consequent) || esNulo(n.alternate)))
  || (n.type === 'LogicalExpression' && (n.operator === '&&' ? esNulo(n.right) : esNulo(n.left) && esNulo(n.right))));
/** El nombre de una clave de un literal (`a:`, `'a':`, `['a']:`), o null si no se puede plegar. */
const claveDe = (p) => (!p.computed && p.key.type === 'Identifier' ? p.key.name : (p.key.type === 'Literal' ? String(p.key.value) : null));
/**
 * Las claves de NIVEL SUPERIOR de lo que el Code emite: cada objeto `{ json: … }` (los items que salen) se resuelve a sus claves. Se siguen identificadores declarados en el mismo código,
 * `Object.assign(…)`, spreads de objetos resolubles, operadores `??`/`||`/`?:` y las asignaciones `x.clave = …` / `x['clave'] = …` / `Object.assign(x, …)` sobre ese identificador.
 * `abierto` es verdadero si alguna parte no se puede decidir (un spread de la entrada, una clave calculada): entonces las claves son SOLO las explícitas.
 */
export function emisionesDelCodigo(codigo) {
  let ast;
  const parser = acornDe(); // si acorn no está instalado falla ruidosamente: no hay guardia en silencio
  try { ast = parser.parse(String(codigo), PARSE); } catch (e) { return { error: `no se pudo analizar el código (${String(e.message).slice(0, 60)})`, emisiones: [] }; }
  const declaraciones = new Map();
  const miembros = new Map();
  const empujes = new Map();
  const abre = (nombre) => { const m = miembros.get(nombre) || { claves: new Set(), nulas: new Set(), vistas: new Set(), asigna: [], abierto: false }; miembros.set(nombre, m); return m; };
  const nombreDeObjeto = (n) => (n && n.type === 'Identifier' ? n.name : null);
  const esAssign = (c) => c.callee.type === 'MemberExpression' && c.callee.object.name === 'Object' && c.callee.property.name === 'assign';
  // Un trozo de código que puede no correr (rama de if/ternario, lado derecho de un operador lógico, bucle, try, función): lo que se asigna ahí NO es una emisión segura.
  const TROZOS = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchCase', 'TryStatement', 'CatchClause'];
  const condicionalHijo = (x, k, cond) => cond || TROZOS.includes(x.type) || ((x.type === 'IfStatement' || x.type === 'ConditionalExpression') && k !== 'test') || (x.type === 'LogicalExpression' && k === 'right');
  const claveDeMiembro = (l) => (!l.computed && l.property.type === 'Identifier' ? l.property.name : (l.computed && l.property.type === 'Literal' ? String(l.property.value) : null));
  (function recorrer(x, cond) {
    if (Array.isArray(x)) { x.forEach((e) => recorrer(e, cond)); return; }
    if (!x || typeof x.type !== 'string') return;
    if (x.type === 'VariableDeclarator' && x.id.type === 'Identifier' && x.init) (declaraciones.get(x.id.name) || declaraciones.set(x.id.name, []).get(x.id.name)).push(x.init);
    if (x.type === 'AssignmentExpression' && x.operator === '=' && x.left.type === 'Identifier') (declaraciones.get(x.left.name) || declaraciones.set(x.left.name, []).get(x.left.name)).push(x.right);
    if (x.type === 'AssignmentExpression' && x.left.type === 'MemberExpression' && nombreDeObjeto(x.left.object)) {
      const m = abre(x.left.object.name);
      const k = claveDeMiembro(x.left);
      if (k === null) m.abierto = true;
      else if (x.operator === '=' && esNulo(x.right)) m.nulas.add(k); // `x.k = undefined/null`: no es una emisión
      else if (x.operator === '=' && !cond) m.claves.add(k);
      else m.vistas.add(k); // condicional o compuesta (`||=`, `??=`): puede no quedar puesta
    }
    // `delete x.k` ANULA la clave en cualquier parte del código.
    if (x.type === 'UnaryExpression' && x.operator === 'delete' && x.argument.type === 'MemberExpression' && nombreDeObjeto(x.argument.object)) {
      const m = abre(x.argument.object.name);
      const k = claveDeMiembro(x.argument);
      if (k === null) m.abierto = true; else m.nulas.add(k);
    }
    if (x.type === 'CallExpression' && x.callee.type === 'MemberExpression' && esAssign(x) && nombreDeObjeto(x.arguments[0])) {
      abre(x.arguments[0].name).asigna.push({ args: x.arguments.slice(1), cond });
    }
    // `lista.push(…)` / `lista.unshift(…)`: lo que se agrega a una lista que luego se devuelve (`return lista`) tiene que ser un `{ json: … }`.
    if (x.type === 'CallExpression' && x.callee.type === 'MemberExpression' && !x.callee.computed && ['push', 'unshift'].includes(x.callee.property.name) && nombreDeObjeto(x.callee.object)) {
      (empujes.get(x.callee.object.name) || empujes.set(x.callee.object.name, []).get(x.callee.object.name)).push(...x.arguments);
    }
    for (const k of Object.keys(x)) { const v = x[k]; if (v && typeof v === 'object') recorrer(v, condicionalHijo(x, k, cond)); }
  })(ast, false);

  // Resultado de una resolución: `claves` = emitidas en TODAS las rutas con un valor que no es `undefined`/`null` literal; `vistas` = nombradas en alguna ruta (para el mensaje).
  const vacio = () => ({ claves: new Set(), nulas: new Set(), vistas: new Set(), abierto: false });
  /** Superpone `o` sobre `r` (lo que `o` pone gana; lo que `o` anula se quita). */
  const aplica = (r, o) => {
    o.claves.forEach((c) => { r.claves.add(c); r.nulas.delete(c); });
    o.nulas.forEach((c) => { r.claves.delete(c); r.nulas.add(c); });
    o.vistas.forEach((c) => r.vistas.add(c));
    if (o.abierto) r.abierto = true;
    return r;
  };
  /** INTERSECCIÓN de rutas: una clave cuenta solo si todas las rutas la emiten; lo anulado en cualquiera queda anulado. */
  const interseca = (lista) => {
    const r = vacio();
    if (!lista.length) { r.abierto = true; return r; }
    for (const c of lista[0].claves) if (lista.every((o) => o.claves.has(c))) r.claves.add(c);
    for (const o of lista) { o.nulas.forEach((c) => r.nulas.add(c)); o.vistas.forEach((c) => r.vistas.add(c)); o.claves.forEach((c) => r.vistas.add(c)); if (o.abierto) r.abierto = true; }
    r.nulas.forEach((c) => r.claves.delete(c));
    return r;
  };

  function clavesDe(nodo, vistos) {
    const r = vacio();
    if (!nodo) { r.abierto = true; return r; }
    switch (nodo.type) {
      case 'ObjectExpression':
        for (const p of nodo.properties) {
          if (p.type === 'SpreadElement') aplica(r, clavesDe(p.argument, vistos));
          else {
            const k = claveDe(p);
            if (k === null) { r.abierto = true; continue; }
            r.vistas.add(k);
            if (p.type === 'Property' && p.kind === 'init' && esNulo(p.value)) { r.claves.delete(k); r.nulas.add(k); } else { r.claves.add(k); r.nulas.delete(k); }
          }
        }
        return r;
      case 'Identifier': {
        if (vistos.has(nodo.name)) { r.abierto = true; return r; }
        const inits = declaraciones.get(nodo.name);
        if (!inits) { r.abierto = true; return r; }
        const con = new Set(vistos).add(nodo.name);
        const base = interseca(inits.map((init) => clavesDe(init, con)));
        const m = miembros.get(nodo.name);
        if (m) {
          // Las asignaciones de miembro no tienen alcance ni orden: con MÁS DE UNA declaración o reasignación del nombre (una homónima en un bloque, `o = {…}` después de `o.k = …`), no se sabe a
          // cuál objeto pertenecen y no se cuentan (quedan «vistas»).
          const varias = inits.length > 1;
          m.claves.forEach((c) => (varias ? base.vistas : base.claves).add(c));
          if (varias) base.abierto = true;
          m.vistas.forEach((c) => base.vistas.add(c));
          for (const { args, cond } of m.asigna) for (const a of args) { const s = clavesDe(a, con); if (cond || varias) { s.claves.forEach((c) => base.vistas.add(c)); s.vistas.forEach((c) => base.vistas.add(c)); if (s.abierto) base.abierto = true; } else aplica(base, s); }
          m.nulas.forEach((c) => { base.claves.delete(c); base.nulas.add(c); });
          // `delete o[k]` / `o[k] = …` con una clave que no se pliega puede quitar o pisar CUALQUIERA de las ya dadas: ninguna cuenta (todas pasan a «vistas»).
          if (m.abierto) { base.abierto = true; base.claves.forEach((c) => base.vistas.add(c)); base.claves.clear(); }
        }
        return base;
      }
      case 'CallExpression':
        if (nodo.callee.type === 'MemberExpression' && esAssign(nodo)) { for (const a of nodo.arguments) aplica(r, clavesDe(a, vistos)); return r; }
        r.abierto = true; return r;
      // `a || b`, `a ?? b`, `a && b`: el resultado es una de las dos ramas (salvo un literal de objeto a la izquierda, que siempre es verdadero): se intersecta.
      case 'LogicalExpression': return nodo.left.type === 'ObjectExpression' && nodo.operator !== '&&' ? clavesDe(nodo.left, vistos) : interseca([clavesDe(nodo.left, vistos), clavesDe(nodo.right, vistos)]);
      case 'ConditionalExpression': return interseca([clavesDe(nodo.consequent, vistos), clavesDe(nodo.alternate, vistos)]);
      default: r.abierto = true; return r;
    }
  }
  const emisiones = [];
  (function buscar(x) {
    if (Array.isArray(x)) { x.forEach(buscar); return; }
    if (!x || typeof x.type !== 'string') return;
    if (x.type === 'ObjectExpression') {
      for (const p of x.properties) if (p.type === 'Property' && claveDe(p) === 'json') emisiones.push(clavesDe(p.shorthand ? p.key : p.value, new Set()));
    }
    for (const k of Object.keys(x)) { const v = x[k]; if (v && typeof v === 'object') buscar(v); }
  })(ast);

  // Lo que SALE son los `return` del nivel superior (los de funciones anidadas son de esas funciones). Cada uno tiene que ser un arreglo de `{ json: … }` que se pueda resolver: un
  // `return $input.all()`, `return items` o `return [{ R }]` (n8n envuelve en `json` los items sin envoltura) emite items que NO se pueden decidir: emisión ABIERTA y SIN claves, que se niega.
  const esItem = (n) => !!n && n.type === 'ObjectExpression' && n.properties.some((p) => p.type === 'Property' && claveDe(p) === 'json');
  const FUNCIONES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];
  const retornosDe = (cuerpo) => {
    const r = [];
    (function ir(x) {
      if (Array.isArray(x)) { x.forEach(ir); return; }
      if (!x || typeof x.type !== 'string' || FUNCIONES.includes(x.type)) return;
      if (x.type === 'ReturnStatement') r.push(x);
      for (const k of Object.keys(x)) { const v = x[k]; if (v && typeof v === 'object') ir(v); }
    })(cuerpo);
    return r;
  };
  const resoluble = (n, vistos) => {
    if (!n) return true; // `return;`: no emite nada
    switch (n.type) {
      case 'ArrayExpression': return n.elements.every(esItem);
      case 'ConditionalExpression': return resoluble(n.consequent, vistos) && resoluble(n.alternate, vistos);
      case 'Identifier': {
        if (vistos.has(n.name)) return false;
        const con = new Set(vistos).add(n.name);
        const inits = declaraciones.get(n.name);
        return !!inits && inits.every((i) => resoluble(i, con)) && (empujes.get(n.name) || []).every(esItem);
      }
      case 'CallExpression': { // `lista.map((i) => ({ json: … }))`: cada retorno del callback es un `{ json }`
        const cb = n.arguments[0];
        if (n.callee.type !== 'MemberExpression' || n.callee.computed || n.callee.property.name !== 'map' || !cb || !FUNCIONES.includes(cb.type)) return false;
        return cb.body.type === 'BlockStatement' ? retornosDe(cb.body).every((rt) => esItem(rt.argument)) && retornosDe(cb.body).length > 0 : esItem(cb.body);
      }
      default: return false;
    }
  };
  const retornos = retornosDe(ast);
  if (!emisiones.length) return { emisiones }; // ningún `{ json }`: ya se informa «no se encontró ningún …»
  if (!retornos.length) return { emisiones: [] }; // un `{ json }` que no sale nunca (no hay `return`)
  if (retornos.some((rt) => !resoluble(rt.argument, new Set()))) emisiones.push({ ...vacio(), abierto: true });
  return { emisiones };
}

/**
 * Los campos de `campos` que el nodo productor del mensaje NO emite (vacío si todos): para cada objeto `{json: …}` que el Code produce, el campo tiene que ser una CLAVE de nivel
 * superior. `phoneNumberId` también vale si el código es un normalizador verificado por ejecución (`NORMALIZADORES_VERIFICADOS`). Un nodo que no es Code, o un código que no se puede
 * analizar, no se da por bueno.
 */
function camposQueFaltan(n, campos) {
  const todos = (motivo) => Object.entries(campos).map(([nombre, campo]) => `${nombre} («${campo}»)${motivo ? ` [${motivo}]` : ''}`);
  if (!n || n.type !== 'n8n-nodes-base.code') return todos('no es un nodo Code');
  const codigo = String(((n.parameters) || {}).jsCode || '');
  const { emisiones, error } = emisionesDelCodigo(codigo);
  if (error) return todos(error);
  if (!emisiones.length) return todos('no se encontró ningún `{ json: … }` que salga');
  const verificado = Object.prototype.hasOwnProperty.call(NORMALIZADORES_VERIFICADOS, huellaDe(codigo));
  const faltan = new Set();
  for (const em of emisiones) {
    for (const [nombre, campo] of Object.entries(campos)) {
      if (em.claves.has(campo)) continue;
      if (nombre === 'phoneNumberId' && em.abierto && verificado) continue;
      const pista = em.nulas.has(campo) ? ' [la anula (`undefined`/`null`/`delete`)]'
        : em.vistas.has(campo) ? ' [no la emiten TODAS las rutas del código (ternario, if/else, `||`, asignación condicional): no se puede decidir estáticamente; pasar `fuente` o una lista blanca verificada por ejecución]'
          : (nombre === 'phoneNumberId' && em.abierto ? ' [llega por un spread que no se puede resolver: pasar `fuente`, o verificarlo por ejecución]' : '');
      faltan.add(`${nombre} («${campo}»)${pista}`);
    }
  }
  return [...faltan];
}

/** Pliega una expresión constante a `{ v }`; `null` si depende de algo que se lee (`n`, una llamada, un identificador). */
function plegar(n) {
  if (!n) return null;
  switch (n.type) {
    case 'Literal': return { v: n.regex ? {} : n.value };
    case 'Identifier': return n.name === 'undefined' ? { v: undefined } : (n.name === 'NaN' ? { v: NaN } : (n.name === 'Infinity' ? { v: Infinity } : null));
    case 'TemplateLiteral': return n.expressions.length ? null : { v: n.quasis.map((q) => q.value.cooked).join('') };
    case 'ArrayExpression': case 'ObjectExpression': return { v: {} };
    case 'UnaryExpression': {
      const a = plegar(n.argument);
      if (!a) return null;
      if (n.operator === '!') return { v: !a.v };
      if (n.operator === '-') return { v: -a.v };
      if (n.operator === '+') return { v: +a.v };
      return n.operator === 'void' ? { v: undefined } : null;
    }
    case 'LogicalExpression': {
      const l = plegar(n.left);
      if (!l) { const r = plegar(n.right); return n.operator === '&&' && r && !r.v ? r : null; } // `algo && false` es siempre falso
      const corta = n.operator === '&&' ? !l.v : (n.operator === '||' ? !!l.v : l.v !== null && l.v !== undefined);
      return corta ? l : plegar(n.right);
    }
    case 'BinaryExpression': {
      const a = plegar(n.left);
      const b = plegar(n.right);
      if (!a || !b) return null;
      switch (n.operator) {
        case '===': return { v: a.v === b.v };
        case '!==': return { v: a.v !== b.v };
        case '==': return { v: a.v == b.v }; // eslint-disable-line eqeqeq
        case '!=': return { v: a.v != b.v }; // eslint-disable-line eqeqeq
        case '<': return { v: a.v < b.v };
        case '>': return { v: a.v > b.v };
        case '<=': return { v: a.v <= b.v };
        case '>=': return { v: a.v >= b.v };
        default: return null;
      }
    }
    default: return null;
  }
}

/**
 * La `puerta` no puede APAGAR la ráfaga (el apagado previsto es `rafagaActiva: false` o `rafagaApagada`): una expresión que no se analiza o una constante falsa (`false`, `0`, `null`,
 * `1 === 2`…) haría que el IF diera siempre «no» sin ningún aviso. Devuelve el motivo, o null si la puerta puede armar.
 */
function problemasDeLaPuerta(puerta) {
  const ast = analizaEnLinea(puerta, true);
  if (!ast || ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement') return 'la puerta no es una expresión JS válida (una sola expresión)';
  const c = plegar(ast.body[0].expression);
  if (c && !c.v) return `la puerta «${puerta}» es una constante falsa: el IF daría siempre «no» y la ráfaga quedaría apagada en silencio (para apagarla: \`rafagaActiva: false\` en «Config base» o \`rafagaApagada\`)`;
  return null;
}

/**
 * Cada `n.<campo>` que la puerta lee tiene que ser una clave de nivel superior que el productor EMITE (la misma verificación que los `campos`, con `emisionesDelCodigo`): un campo
 * que no existe da `undefined`, y `n.a.b.c` sobre un campo inexistente lanza (el try/catch del IF lo vuelve `false`): en los dos casos la ráfaga queda apagada en silencio.
 * `n` entero (sin acceso a un campo) o `n[clave calculada]` no se pueden decidir y se niegan. Devuelve la lista de lo que no se cumple (vacía si todo bien).
 */
function camposDeLaPuertaQueFaltan(productor, puerta) {
  if (!productor || productor.type !== 'n8n-nodes-base.code') return []; // `camposQueFaltan` ya lo informa
  const ast = analizaEnLinea(puerta, true);
  if (!ast || ast.body.length !== 1) return [];
  const leidos = new Set();
  const indecidibles = new Set();
  const esClave = (padre, clave) => !!padre && ((padre.type === 'MemberExpression' && clave === 'property' && !padre.computed) || (padre.type === 'Property' && clave === 'key' && !padre.computed && !padre.shorthand));
  (function ver(x, padre, clave) {
    if (Array.isArray(x)) { x.forEach((e) => ver(e, padre, clave)); return; }
    if (!x || typeof x.type !== 'string') return;
    if (x.type === 'MemberExpression' && x.object.type === 'Identifier' && x.object.name === 'n') {
      if (!x.computed && x.property.type === 'Identifier') leidos.add(x.property.name);
      else if (x.computed && x.property.type === 'Literal') leidos.add(String(x.property.value));
      else { indecidibles.add('`n[…]` con una clave calculada'); ver(x.property, x, 'property'); }
      return;
    }
    if (x.type === 'Identifier' && x.name === 'n') { if (!esClave(padre, clave)) indecidibles.add('`n` usado entero (sin leer un campo)'); return; }
    for (const k of Object.keys(x)) { const v = x[k]; if (v && typeof v === 'object') ver(v, x, k); }
  })(ast, null, null);
  const codigo = String(((productor.parameters) || {}).jsCode || '');
  const { emisiones, error } = emisionesDelCodigo(codigo);
  if (error || !emisiones.length) return [];
  const verificado = Object.prototype.hasOwnProperty.call(NORMALIZADORES_VERIFICADOS, huellaDe(codigo));
  const faltan = [...leidos].filter((c) => emisiones.some((em) => !em.claves.has(c) && !(em.abierto && verificado))).map((c) => `n.${c}`);
  return [...indecidibles, ...faltan];
}

/** Los nodos que la `puerta` lee con `$('…')`. */
const nodosDeLaPuerta = (puerta) => [...String(puerta || '').matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);

/** Los nodos de `nombres` que NO son ascendientes del ancla (ni el ancla): leerlos desde la ráfaga puede fallar o traer datos de otro turno. */
const noAscendientes = (flujo, ancla, nombres) => {
  const arriba = ascendientes(flujo, ancla);
  return nombres.filter((n) => n !== ancla && !arriba.has(n));
};

/** Los nodos a los que se llega desde `desde` (incluido él), por cualquier salida. */
function descendientes(flujo, desde) {
  const visto = new Set([desde]);
  const pila = [desde];
  while (pila.length) {
    const x = pila.pop();
    for (const lista of ((((flujo.connections || {})[x] || {}).main) || [])) for (const e of (lista || [])) if (!visto.has(e.node)) { visto.add(e.node); pila.push(e.node); }
  }
  return visto;
}
/**
 * ¿Este AST LEE `textoDelTurno` de «Agrupar ráfaga»? Código real: un acceso a miembro `.textoDelTurno` (o `['textoDelTurno']`, o la desestructuración `{ textoDelTurno }`) cuyo objeto resuelve a
 * `$('Agrupar ráfaga')…`, `$items('Agrupar ráfaga')…`, `$node['Agrupar ráfaga']…` o a una variable declarada con eso. Un comentario o una cadena que nombre `textoDelTurno` no cuenta.
 */
function leeElTextoDe(ast) {
  const declaraciones = new Map();
  const todos = [];
  (function recorrer(x) {
    if (Array.isArray(x)) { x.forEach(recorrer); return; }
    if (!x || typeof x.type !== 'string') return;
    todos.push(x);
    if (x.type === 'VariableDeclarator' && x.id.type === 'Identifier' && x.init) (declaraciones.get(x.id.name) || declaraciones.set(x.id.name, []).get(x.id.name)).push(x.init);
    if (x.type === 'AssignmentExpression' && x.operator === '=' && x.left.type === 'Identifier') (declaraciones.get(x.left.name) || declaraciones.set(x.left.name, []).get(x.left.name)).push(x.right);
    for (const k of Object.keys(x)) { const v = x[k]; if (v && typeof v === 'object') recorrer(v); }
  })(ast);
  const esAgrupar = (n) => n && n.type === 'Literal' && n.value === NODO_RAFAGA_AGRUPAR;
  const viene = (n, vistos) => {
    if (!n) return false;
    switch (n.type) {
      case 'CallExpression':
        // `cnNodo`/`cnPrimero` son los ayudantes comunes de los nodos Code del core (`cnPrimero(n)` = `$(n).first().json` solo si el nodo corrió).
        if (n.callee.type === 'Identifier' && ['$', '$items', 'cnNodo', 'cnPrimero'].includes(n.callee.name)) return esAgrupar(n.arguments[0]);
        return n.callee.type === 'MemberExpression' && viene(n.callee.object, vistos);
      case 'MemberExpression':
        if (n.object.type === 'Identifier' && n.object.name === '$node' && n.computed && esAgrupar(n.property)) return true;
        return viene(n.object, vistos);
      case 'Identifier': {
        if (vistos.has(n.name)) return false;
        const con = new Set(vistos).add(n.name);
        return (declaraciones.get(n.name) || []).some((i) => viene(i, con));
      }
      case 'AwaitExpression': return viene(n.argument, vistos);
      case 'ConditionalExpression': return viene(n.consequent, vistos) || viene(n.alternate, vistos);
      case 'LogicalExpression': return viene(n.left, vistos) || viene(n.right, vistos);
      default: return false;
    }
  };
  const esTexto = (m) => (!m.computed && m.property.type === 'Identifier' && m.property.name === 'textoDelTurno') || (m.computed && m.property.type === 'Literal' && m.property.value === 'textoDelTurno');
  return todos.some((x) => (x.type === 'MemberExpression' && esTexto(x) && viene(x.object, new Set()))
    || (x.type === 'VariableDeclarator' && x.id.type === 'ObjectPattern' && viene(x.init, new Set()) && x.id.properties.some((p) => p.type === 'Property' && claveDe(p) === 'textoDelTurno')));
}
const analizaEnLinea = (codigo, expresion) => {
  try { return acornDe().parse(expresion ? `(${codigo}\n)` : String(codigo), PARSE); } catch (e) { return null; }
};
/**
 * ¿El nodo LEE `textoDelTurno` de «Agrupar ráfaga»? Un nodo Code, por el análisis de su `jsCode`; cualquier otro nodo, por sus parámetros que son expresiones de n8n (`=…{{ … }}`): se
 * analiza lo que va dentro de cada `{{ }}`. Lo que está fuera (texto del prompt, comentarios, cadenas) no cuenta.
 */
const consumeElTexto = (n) => {
  const p = (n && n.parameters) || {};
  if (n && n.type === 'n8n-nodes-base.code') { const ast = analizaEnLinea(p.jsCode, false); return !!ast && leeElTextoDe(ast); }
  let lee = false;
  (function ver(v) {
    if (lee) return;
    if (Array.isArray(v)) { v.forEach(ver); return; }
    if (v && typeof v === 'object') { Object.values(v).forEach(ver); return; }
    if (typeof v !== 'string' || !v.startsWith('=')) return;
    for (const m of v.matchAll(/\{\{([\s\S]*?)\}\}/g)) { const ast = analizaEnLinea(m[1], true); if (ast && leeElTextoDe(ast)) { lee = true; return; } }
  })(p);
  return lee;
};
/**
 * Sin CONSUMIDOR la ráfaga PIERDE mensajes: «Agrupar ráfaga» entrega los textos unidos en `textoDelTurno`, pero si ningún nodo del flujo lo lee, la ejecución que responde ve solo SU
 * texto y los que las otras callaron nunca se contestan. Por eso `consumidor` es obligatorio: el nombre (o la lista) de los nodos que leen `textoDelTurno`, que tienen que ser el destino o
 * descender de él. `consumidor: null` existe SOLO para fixtures de prueba (un flujo real nunca lo declara).
 */
function problemasDelConsumidor(flujo, consumidor, desde) {
  if (consumidor === null) return [];
  if (consumidor === undefined) return ['falta `consumidor`: el nodo (o los nodos) que leen `textoDelTurno` de «Agrupar ráfaga»; sin él la ráfaga PIERDE los mensajes agrupados (`consumidor: null` solo en fixtures de prueba)'];
  const lista = Array.isArray(consumidor) ? consumidor : [consumidor];
  if (!lista.length || lista.some((c) => typeof c !== 'string' || !c)) return ['`consumidor` tiene que ser un nombre de nodo o una lista de nombres'];
  const abajo = descendientes(flujo, desde);
  const h = [];
  for (const c of lista) {
    const n = por(flujo, c);
    if (!n) { h.push(`el consumidor «${c}» no existe en el flujo`); continue; }
    if (!abajo.has(c)) h.push(`el consumidor «${c}» tiene que ser el destino («${desde}») o descender de él: si corre antes, no recibe \`textoDelTurno\``);
    if (!consumeElTexto(n)) h.push(`el consumidor «${c}» no lee \`textoDelTurno\` de «${NODO_RAFAGA_AGRUPAR}» (su código o sus parámetros no lo nombran)`);
  }
  return h;
}

export function injertarRafaga(flujo, opciones) {
  const o = opciones || {};
  const a = o.ancla || {};
  const salida = a.salida === undefined ? 0 : a.salida;
  if (!por(flujo, a.nodo)) throw new Error(`rafaga: el flujo no tiene «${a.nodo}» (el nodo del que cuelga)`);
  if (!por(flujo, a.destino)) throw new Error(`rafaga: el flujo no tiene «${a.destino}» (el destino)`);
  for (const n of NODOS_DE_LA_RAFAGA) if (por(flujo, n)) throw new Error(`rafaga: el flujo ya tiene un nodo «${n}»`);
  const lista = listaDe(flujo, a.nodo, salida);
  const posicion = lista.findIndex((e) => e.node === a.destino);
  if (posicion < 0) throw new Error(`rafaga: «${a.nodo}» (salida ${salida}) no va a «${a.destino}»`);
  if (!por(flujo, ANCLA_REPORTE)) throw new Error(`rafaga: el flujo no tiene «${ANCLA_REPORTE}»`);
  if (!reporteCorreAntes(flujo, a.nodo, a.destino)) throw new Error(`rafaga: «${ANCLA_REPORTE}» tiene que correr ANTES de la ráfaga (ser ascendiente de «${a.nodo}» o ir más arriba que «${a.destino}» en el lienzo)`);
  const fuente = o.fuente || '';
  const normalizador = o.normalizador || normalizadorDe(flujo);
  if (!fuente && (!normalizador || !por(flujo, normalizador))) throw new Error('rafaga: el flujo no tiene el nodo que normaliza el entrante («Interpretar entrada» o «Normalizar entrada»); si el mensaje se lee de otro nodo, pasar `fuente`');
  if (fuente && !por(flujo, fuente)) throw new Error(`rafaga: el flujo no tiene «${fuente}» (la fuente de los campos del mensaje)`);
  for (const n of [o.config || 'Config del negocio', o.configBase || 'Config base']) if (!por(flujo, n)) throw new Error(`rafaga: el flujo no tiene «${n}»`);
  const referidos = nodosDeLaPuerta(o.puerta);
  for (const n of referidos) if (!por(flujo, n)) throw new Error(`rafaga: la puerta lee «${n}» y el flujo no lo tiene`);
  const lejanos = noAscendientes(flujo, a.nodo, [fuente || normalizador, ...referidos, o.config || 'Config del negocio', o.configBase || 'Config base']);
  if (lejanos.length) throw new Error(`rafaga: ${lejanos.map((n) => `«${n}»`).join(', ')} tiene que ser ascendiente de «${a.nodo}» (el item del ancla y las configuraciones se leen de ahí)`);
  if (!fuente) {
    const roto = productorDelItem(flujo, a.nodo, normalizador);
    if (roto) throw new Error(`rafaga: el item que sale de «${a.nodo}» no se puede garantizar que salga de «${normalizador}» por nodos que lo dejan pasar (IF, Switch, Filter, Wait, NoOp): lo impide «${roto}», que puede cambiar el item y dejar sin los campos del mensaje (${camposDe(o).mensajeId}, ${camposDe(o).texto}…): la ráfaga quedaría apagada en silencio. Pasar \`fuente\` (el nodo del que se leen, p. ej. «${normalizador || 'Normalizar entrada'}»)`);
  }
  {
    // El productor del mensaje (la `fuente`, o el normalizador) tiene que EMITIR los campos que la ráfaga lee: si no, el IF daría siempre «no» o el texto saldría vacío.
    const productor = fuente || normalizador;
    const faltan = camposQueFaltan(por(flujo, productor), camposDe(o));
    if (faltan.length) throw new Error(`rafaga: «${productor}» no emite ${faltan.join(', ')}: la ráfaga quedaría apagada en silencio o sin el texto del mensaje. Pasar \`campos\` con los nombres que ese nodo emite, o una \`fuente\` que los emita (el nodo que normaliza el entrante)`);
    const sinCampo = camposDeLaPuertaQueFaltan(por(flujo, productor), o.puerta === undefined ? 'true' : String(o.puerta));
    if (sinCampo.length) throw new Error(`rafaga: la puerta lee ${sinCampo.join(', ')} y «${productor}» no lo emite como clave (o no se puede decidir): el IF daría siempre «no» y la ráfaga quedaría apagada en silencio`);
  }
  const sinConsumo = problemasDelConsumidor(flujo, o.consumidor, a.destino);
  if (sinConsumo.length) throw new Error(`rafaga: ${sinConsumo.join('; ')}`);
  const traer = por(flujo, o.traerConfiguracion || 'Traer configuración');
  if (!traer) throw new Error(`rafaga: el flujo no tiene «${o.traerConfiguracion || 'Traer configuración'}» (de donde se toman la URL y la credencial)`);
  const d = por(flujo, a.destino);
  const [dx, dy] = d.position || [0, 0];
  const nodos = nodosDeLaRafaga({ ...o, normalizador, traer, posicion: o.posicion || [dx - 960, dy] });
  flujo.nodes.push(...nodos);
  const original = lista[posicion];
  lista[posicion] = enlace(NODO_RAFAGA_SI);
  const con = flujo.connections || (flujo.connections = {});
  con[NODO_RAFAGA_SI] = { main: [[enlace(NODO_RAFAGA_ESPERAR)], [{ ...original }]] };
  con[NODO_RAFAGA_ESPERAR] = { main: [[enlace(NODO_RAFAGA_CONSULTAR)]] };
  con[NODO_RAFAGA_CONSULTAR] = { main: [[enlace(NODO_RAFAGA_AGRUPAR)]] };
  con[NODO_RAFAGA_AGRUPAR] = { main: [[{ ...original }]] };
  return flujo;
}

/** Quita los cuatro nodos y vuelve a conectar el ancla con su destino original (lo usa el ensamblador: quitar + injertar es idempotente). */
export function quitarRafaga(flujo) {
  const con = flujo.connections || {};
  // Solo se quita la PIEZA: el IF existe y lleva a «Esperar ráfaga» que sigue la cadena. Un flujo con un nodo propio de ese nombre (el chat de NovuChat) no se toca.
  if (!por(flujo, NODO_RAFAGA_SI) || !destinos(flujo, NODO_RAFAGA_SI, 0).includes(NODO_RAFAGA_ESPERAR)
    || !destinos(flujo, NODO_RAFAGA_ESPERAR, 0).includes(NODO_RAFAGA_CONSULTAR) || !destinos(flujo, NODO_RAFAGA_CONSULTAR, 0).includes(NODO_RAFAGA_AGRUPAR)) return flujo;
  const original = ((con[NODO_RAFAGA_SI] || {}).main || [])[1] || [];
  for (const salidas of Object.values(con)) {
    for (const tipo of Object.keys(salidas)) {
      salidas[tipo] = salidas[tipo].map((lista) => {
        const sin = [];
        for (const e of (lista || [])) {
          if (e.node === NODO_RAFAGA_SI) sin.push(...original.map((x) => ({ ...x })));
          else if (!NODOS_DE_LA_RAFAGA.includes(e.node)) sin.push(e);
        }
        return sin;
      });
    }
  }
  for (const n of NODOS_DE_LA_RAFAGA) delete con[n];
  flujo.nodes = nodosDe(flujo).filter((n) => !NODOS_DE_LA_RAFAGA.includes(n.name));
  return flujo;
}

const forma = (n) => JSON.stringify({ id: n.id, name: n.name, type: n.type, typeVersion: n.typeVersion, parameters: n.parameters, credentials: n.credentials, onError: n.onError, continueOnFail: n.continueOnFail, retryOnFail: n.retryOnFail, maxTries: n.maxTries, waitBetweenTries: n.waitBetweenTries, alwaysOutputData: n.alwaysOutputData, executeOnce: n.executeOnce, disabled: n.disabled, notes: n.notes });

/**
 * Lo que le falta o le sobra a la ráfaga en un flujo armado. Vacío si está bien. Sin ninguno de los cuatro nodos y sin `exigir: true`, vacío (no aplica:
 * en el PR A ningún flujo la lleva).
 */
export function hallazgosDeLaRafaga(flujo, opciones = {}) {
  const h = [];
  const exigir = !!opciones && opciones.exigir === true;
  const presentes = NODOS_DE_LA_RAFAGA.filter((n) => por(flujo, n));
  if (!exigir && presentes.length === 0) return h;
  for (const n of NODOS_DE_LA_RAFAGA) if (!por(flujo, n)) h.push(`rafaga: falta el nodo «${n}»`);
  if (h.length) return h;
  const si = por(flujo, NODO_RAFAGA_SI);
  const esperar = por(flujo, NODO_RAFAGA_ESPERAR);
  const consultar = por(flujo, NODO_RAFAGA_CONSULTAR);
  const agrupar = por(flujo, NODO_RAFAGA_AGRUPAR);

  // Alterado: los cuatro son los canónicos, armados con la misma función y lo que el propio flujo declara.
  const normalizador = opciones.normalizador || normalizadorDe(flujo);
  const traer = por(flujo, opciones.traerConfiguracion || 'Traer configuración');
  const izquierda = String((((((si.parameters || {}).conditions || {}).conditions || [])[0]) || {}).leftValue || '');
  const puerta = (/\/\*puerta\*\/\((.*)\)\/\*fin\*\//.exec(izquierda) || [])[1];
  const fuente = opciones.fuente !== undefined ? opciones.fuente : ((/const n = \$\('([^']+)'\)\.first\(\)\.json;/.exec(izquierda) || [])[1] || '');
  // Los nombres de campo: los de `opciones.campos`; el del id y el del texto, si no se dan, los del propio nodo «Agrupar ráfaga».
  const codigoDelAgrupar = String((agrupar.parameters || {}).jsCode || '');
  const delCodigo = { mensajeId: (/const CAMPO_ID = '([^']+)'/.exec(codigoDelAgrupar) || [])[1], texto: (/const CAMPO_TEXTO = '([^']+)'/.exec(codigoDelAgrupar) || [])[1] };
  const campos = { ...CAMPOS_CANONICOS, ...Object.fromEntries(Object.entries(delCodigo).filter(([, v]) => v)), ...(opciones.campos || {}) };
  let canonicos;
  try {
    canonicos = nodosDeLaRafaga({ traer, fuente, config: opciones.config, configBase: opciones.configBase, campos, puerta: puerta === undefined ? 'true' : puerta, posicion: si.position });
  } catch (e) { h.push(String(e.message)); return h; }
  for (const real of [si, esperar, consultar, agrupar]) {
    const canonico = canonicos.find((c) => c.name === real.name);
    if (forma(real) !== forma(canonico)) h.push(`rafaga: «${real.name}» no es el nodo común (parámetros, credencial, Continue on Fail, tiempo o código alterados)`);
  }
  if (consultar.onError !== 'continueRegularOutput') h.push(`rafaga: «${NODO_RAFAGA_CONSULTAR}» tiene que llevar Continue on Fail`);
  if (!((consultar.parameters || {}).options && consultar.parameters.options.timeout <= TIMEOUT_RAFAGA_MS)) h.push(`rafaga: «${NODO_RAFAGA_CONSULTAR}» tiene que tener un tiempo máximo de ${TIMEOUT_RAFAGA_MS} ms o menos`);
  for (const n of [si, esperar, agrupar]) if (n.onError || n.continueOnFail) h.push(`rafaga: «${n.name}» no lleva Continue on Fail (es solo del nodo HTTP)`);
  if (consultar.retryOnFail !== true || consultar.maxTries !== REINTENTOS_MAXIMOS || consultar.waitBetweenTries !== ESPERA_ENTRE_INTENTOS_MS) h.push(`rafaga: «${NODO_RAFAGA_CONSULTAR}» tiene que reintentar UNA vez (maxTries ${REINTENTOS_MAXIMOS}, ${ESPERA_ENTRE_INTENTOS_MS} ms entre intentos)`);

  // Conexiones: ancla → ¿esperar? → (sí) esperar → consultar → agrupar → destino; (no) → el mismo destino.
  const padres = nodosDe(flujo).filter((n) => [0, 1].some((i) => destinos(flujo, n.name, i).includes(NODO_RAFAGA_SI)));
  if (padres.length !== 1) h.push(`rafaga: «${NODO_RAFAGA_SI}» tiene que colgar de UN solo nodo (cuelga de ${padres.length})`);
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!igual(destinos(flujo, NODO_RAFAGA_SI, 0), [NODO_RAFAGA_ESPERAR])) h.push(`rafaga: «${NODO_RAFAGA_SI}» (sí) tiene que ir solo a «${NODO_RAFAGA_ESPERAR}»`);
  if (!igual(destinos(flujo, NODO_RAFAGA_ESPERAR, 0), [NODO_RAFAGA_CONSULTAR])) h.push(`rafaga: «${NODO_RAFAGA_ESPERAR}» tiene que ir solo a «${NODO_RAFAGA_CONSULTAR}»`);
  if (!igual(destinos(flujo, NODO_RAFAGA_CONSULTAR, 0), [NODO_RAFAGA_AGRUPAR])) h.push(`rafaga: «${NODO_RAFAGA_CONSULTAR}» tiene que ir solo a «${NODO_RAFAGA_AGRUPAR}»`);
  const noVa = destinos(flujo, NODO_RAFAGA_SI, 1);
  const agrupaVa = destinos(flujo, NODO_RAFAGA_AGRUPAR, 0);
  if (noVa.length !== 1 || !igual(noVa, agrupaVa)) h.push(`rafaga: «${NODO_RAFAGA_SI}» (no) y «${NODO_RAFAGA_AGRUPAR}» tienen que ir al MISMO destino, uno solo`);
  for (const n of [NODO_RAFAGA_ESPERAR, NODO_RAFAGA_CONSULTAR, NODO_RAFAGA_AGRUPAR]) if (destinos(flujo, n, 1).length) h.push(`rafaga: «${n}» no tiene una segunda salida`);
  if (padres.length !== 1 || noVa.length !== 1) return h;

  const referidos = nodosDeLaPuerta(puerta);
  for (const n of referidos) if (!por(flujo, n)) h.push(`rafaga: la puerta lee «${n}» y el flujo no lo tiene`);
  const lejanos = noAscendientes(flujo, padres[0].name, [fuente || normalizador, ...referidos.filter((n) => por(flujo, n)), opciones.config || 'Config del negocio', opciones.configBase || 'Config base'].filter(Boolean));
  if (!fuente && (!normalizador || !por(flujo, normalizador))) h.push('rafaga: el flujo no tiene el nodo que normaliza el entrante');
  if (fuente && !por(flujo, fuente)) h.push(`rafaga: el flujo no tiene «${fuente}» (la fuente de los campos del mensaje)`);
  {
    const productor = fuente || normalizador;
    if (productor && por(flujo, productor)) {
      const faltan = camposQueFaltan(por(flujo, productor), campos);
      if (faltan.length) h.push(`rafaga: «${productor}» no emite ${faltan.join(', ')}: la ráfaga quedaría apagada en silencio o sin el texto del mensaje`);
      const sinCampo = camposDeLaPuertaQueFaltan(por(flujo, productor), puerta === undefined ? 'true' : puerta);
      if (sinCampo.length) h.push(`rafaga: la puerta lee ${sinCampo.join(', ')} y «${productor}» no lo emite como clave (o no se puede decidir): el IF daría siempre «no» y la ráfaga quedaría apagada en silencio`);
    }
  }
  if (!fuente) {
    const roto = normalizador && por(flujo, normalizador) ? productorDelItem(flujo, padres[0].name, normalizador) : null;
    if (roto) h.push(`rafaga: el item que sale de «${padres[0].name}» no se puede garantizar que salga de «${normalizador}» por nodos transparentes: lo impide «${roto}»; la ráfaga quedaría apagada en silencio (hace falta \`fuente\`)`);
  }
  if (lejanos.length) h.push(`rafaga: ${lejanos.map((n) => `«${n}»`).join(', ')} tiene que ser ascendiente de «${padres[0].name}»`);
  if (!por(flujo, ANCLA_REPORTE)) h.push(`rafaga: falta «${ANCLA_REPORTE}»`);
  else if (!reporteCorreAntes(flujo, padres[0].name, noVa[0])) h.push(`rafaga: «${ANCLA_REPORTE}» tiene que correr ANTES de la ráfaga`);
  // El consumidor de `textoDelTurno`: el declarado, o si no se declara, los nodos del flujo que lo leen. Sin ninguno la ráfaga pierde los mensajes agrupados.
  const abajo = descendientes(flujo, NODO_RAFAGA_AGRUPAR);
  if (opciones.consumidor === undefined) {
    const lectores = nodosDe(flujo).filter((n) => !NODOS_DE_LA_RAFAGA.includes(n.name) && abajo.has(n.name) && consumeElTexto(n));
    if (!lectores.length) h.push(`rafaga: ningún nodo que descienda de «${NODO_RAFAGA_AGRUPAR}» lee \`textoDelTurno\`: la ejecución que responde vería solo SU texto y los que las otras callaron se perderían`);
  } else {
    for (const m of problemasDelConsumidor(flujo, opciones.consumidor, noVa[0])) h.push(`rafaga: ${m}`);
  }
  return h;
}
