/**
 * =============================================================================
 * rafaga.mjs — agrupar la ráfaga de textos de un mismo teléfono, pieza común a todo flujo conversacional
 * =============================================================================
 *
 *   import { injertarRafaga, quitarRafaga, hallazgosDeLaRafaga, NODOS_DE_LA_RAFAGA } from '<ruta>/core/rafaga/rafaga.mjs';
 *
 * Quien escribe «hola» / «quiero reservar» / «para mañana» en tres mensajes seguidos dispara tres ejecuciones y recibe tres respuestas (tres mensajes que
 * cuestan dinero, 0,0113 USD cada uno). Con la pieza responde UNA ejecución con los tres textos unidos; las otras terminan sin enviar. Aislado = igual que hoy.
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
 *  - UN SOLO ORIGEN: el IF (`$json`), la consulta y el Code leen el id, el teléfono, el número y el texto del MISMO item, el del ancla (`$('¿Esperar ráfaga?')`),
 *    con los nombres de campo de `campos`. Ese item tiene que ser el que arma el normalizador (o uno que conserve sus campos): por eso el normalizador, «Config del
 *    negocio» y «Config base» tienen que ser ASCENDIENTES del ancla (si no, se niega a armar).
 *  - «Esperar ráfaga» (Wait): `esperaRafagaSeg` de «Config base» (defecto 2, acotado a 1-5).
 *  - «Consultar ráfaga» (HTTP): `POST` a `configuracionFlujo` con `{telefono, rafaga:{v:1, idMeta}}`; URL y credencial son las de «Traer configuración» de ese
 *    flujo. «Continue on Fail» SOLO acá, 3000 ms de tope y sin reintentos: si falla, «Agrupar ráfaga» responde solo (falla ABIERTO).
 *  - «Agrupar ráfaga» (Code, `agrupar-rafaga.js`): devuelve `[]` (silencio) o el item del turno con `rafaga:{accion, ids}` y, si agrupó, `textoDelTurno`.
 *
 *  - ORDEN DEL LIENZO (`executionOrder: v1`): «Reportar mensaje (entrante)» tiene que correr ANTES (es ascendiente del ancla, o va más arriba que el destino); si
 *    no, se niega a armar. La condición `isExecuted` del IF lo vuelve a exigir en tiempo de ejecución.
 *  - Nombres: la pieza usa los nombres «¿Esperar ráfaga?», «Esperar ráfaga», «Consultar ráfaga» y «Agrupar ráfaga». Un flujo que ya tenga uno (el chat de NovuChat
 *    trae «Esperar ráfaga» para la coalescencia de clics) no la admite: se niega a armar.
 *
 * `opciones` de `injertarRafaga`:
 *   ancla                 { nodo, salida?: 0, destino }  (obligatoria: el nodo y la salida cuya conexión a `destino` se reemplaza)
 *   normalizador          nodo que emite el item del ancla (por defecto «Interpretar entrada» o «Normalizar entrada»); debe ser ascendiente del ancla
 *   campos                nombres de campo del item del ancla: { tipo, mensajeId, from, phoneNumberId, texto } (por defecto los del normalizador común y `userInput`)
 *   config                «Config del negocio»        configBase  «Config base»        traerConfiguracion  «Traer configuración»
 *   puerta                expresión JS booleana sobre `n` (por defecto `true`)
 * Devuelve el mismo flujo con los cuatro nodos y sus conexiones. Lanza si falta algo: no se arma a medias.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODO_RAFAGA_SI = '¿Esperar ráfaga?';
export const NODO_RAFAGA_ESPERAR = 'Esperar ráfaga';
export const NODO_RAFAGA_CONSULTAR = 'Consultar ráfaga';
export const NODO_RAFAGA_AGRUPAR = 'Agrupar ráfaga';
export const NODOS_DE_LA_RAFAGA = [NODO_RAFAGA_SI, NODO_RAFAGA_ESPERAR, NODO_RAFAGA_CONSULTAR, NODO_RAFAGA_AGRUPAR];
export const ANCLA_REPORTE = 'Reportar mensaje (entrante)';
export const TIMEOUT_RAFAGA_MS = 3000;
export const ESPERA_POR_DEFECTO_SEG = 2;
export const NORMALIZADORES = ['Interpretar entrada', 'Normalizar entrada'];

export const CAMPOS_POR_DEFECTO = { tipo: 'tipo', mensajeId: 'mensajeId', from: 'from', phoneNumberId: 'phoneNumberId', texto: 'userInput' };
const camposDe = (o) => {
  const c = { ...CAMPOS_POR_DEFECTO, ...((o && o.campos) || {}) };
  for (const [k, v] of Object.entries(c)) if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new Error(`rafaga: el campo «${k}» tiene un nombre inválido`);
  return c;
};

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
export const codigoDeLaRafaga = (configBase = 'Config base', campos = CAMPOS_POR_DEFECTO) => {
  const c = { ...CAMPOS_POR_DEFECTO, ...campos };
  const sustituido = CODIGO.split(NOMBRE_CONFIG_BASE_EN_CODIGO).join(`$('${configBase}')`)
    .replace("const CAMPO_ID = 'mensajeId';", `const CAMPO_ID = '${c.mensajeId}';`)
    .replace("const CAMPO_TEXTO = 'userInput';", `const CAMPO_TEXTO = '${c.texto}';`);
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
  const [x, y] = o.posicion || [0, 0];
  const N = `$('${NODO_RAFAGA_SI}').first().json`;
  const C = `$('${config}').first().json`;
  const B = `$('${configBase}').first().json`;
  const autenticacion = { authentication: (traer.parameters || {}).authentication, genericAuthType: (traer.parameters || {}).genericAuthType };
  if (autenticacion.authentication !== 'genericCredentialType' || autenticacion.genericAuthType !== 'httpHeaderAuth') throw new Error('rafaga: «Traer configuración» tiene que autenticar con httpHeaderAuth');
  return [
    {
      id: 'rafaga-si', name: NODO_RAFAGA_SI, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x, y],
      parameters: condicion(`={{ (() => { try { const b = ${B}; const c = ${C}; const n = $json; return String(b.rafagaActiva) !== 'false' && c.rafagaApagada !== true && n.${k.tipo} === 'text' && !!n.${k.mensajeId} && !!n.${k.from} && $('${ANCLA_REPORTE}').isExecuted === true && !!(/*puerta*/(${puerta})/*fin*/); } catch (e) { return false; } })() }}`),
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
      parameters: {
        method: 'POST', url, ...autenticacion,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: `={{ String(${C}.modoPrueba === true && ${C}.phoneNumberIdEsperado ? ${C}.phoneNumberIdEsperado : ${N}.${k.phoneNumberId}).replace(/\\D/g, '') }}` }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ telefono: String(${N}.${k.from} || '').replace(/\\D/g, ''), rafaga: { v: 1, idMeta: String(${N}.${k.mensajeId}) } }) }}`,
        options: { timeout: TIMEOUT_RAFAGA_MS },
      },
      notes: 'Lee del servidor los ultimos mensajes de este telefono (maximo 6 lecturas, ninguna escritura). Misma URL y credencial que «Traer configuracion». Con Continue on Fail y 3 s de tope: si falla, «Agrupar rafaga» responde solo.',
    },
    {
      id: 'rafaga-agrupar', name: NODO_RAFAGA_AGRUPAR, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 720, y],
      parameters: { jsCode: codigoDeLaRafaga(configBase, k) },
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

/** Los nodos de `nombres` que NO son ascendientes del ancla (ni el ancla): leerlos desde la ráfaga puede fallar o traer datos de otro turno. */
const noAscendientes = (flujo, ancla, nombres) => {
  const arriba = ascendientes(flujo, ancla);
  return nombres.filter((n) => n !== ancla && !arriba.has(n));
};

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
  const normalizador = o.normalizador || normalizadorDe(flujo);
  if (!normalizador || !por(flujo, normalizador)) throw new Error('rafaga: el flujo no tiene el nodo que normaliza el entrante («Interpretar entrada» o «Normalizar entrada»)');
  for (const n of [o.config || 'Config del negocio', o.configBase || 'Config base']) if (!por(flujo, n)) throw new Error(`rafaga: el flujo no tiene «${n}»`);
  const lejanos = noAscendientes(flujo, a.nodo, [normalizador, o.config || 'Config del negocio', o.configBase || 'Config base']);
  if (lejanos.length) throw new Error(`rafaga: ${lejanos.map((n) => `«${n}»`).join(', ')} tiene que ser ascendiente de «${a.nodo}» (el item del ancla y las configuraciones se leen de ahí)`);
  const traer = por(flujo, o.traerConfiguracion || 'Traer configuración');
  if (!traer) throw new Error(`rafaga: el flujo no tiene «${o.traerConfiguracion || 'Traer configuración'}» (de donde se toman la URL y la credencial)`);
  const d = por(flujo, a.destino);
  const [dx, dy] = d.position || [0, 0];
  const nodos = nodosDeLaRafaga({ ...o, normalizador, traer, posicion: [dx - 960, dy] });
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
  let canonicos;
  try {
    canonicos = nodosDeLaRafaga({ traer, config: opciones.config, configBase: opciones.configBase, campos: opciones.campos, puerta: puerta === undefined ? 'true' : puerta, posicion: si.position });
  } catch (e) { h.push(String(e.message)); return h; }
  for (const real of [si, esperar, consultar, agrupar]) {
    const canonico = canonicos.find((c) => c.name === real.name);
    if (forma(real) !== forma(canonico)) h.push(`rafaga: «${real.name}» no es el nodo común (parámetros, credencial, Continue on Fail, tiempo o código alterados)`);
  }
  if (consultar.onError !== 'continueRegularOutput') h.push(`rafaga: «${NODO_RAFAGA_CONSULTAR}» tiene que llevar Continue on Fail`);
  if (!((consultar.parameters || {}).options && consultar.parameters.options.timeout <= TIMEOUT_RAFAGA_MS)) h.push(`rafaga: «${NODO_RAFAGA_CONSULTAR}» tiene que tener un tiempo máximo de ${TIMEOUT_RAFAGA_MS} ms o menos`);
  for (const n of [si, esperar, agrupar]) if (n.onError || n.continueOnFail) h.push(`rafaga: «${n.name}» no lleva Continue on Fail (es solo del nodo HTTP)`);
  if (consultar.retryOnFail) h.push(`rafaga: «${NODO_RAFAGA_CONSULTAR}» no lleva reintentos`);

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

  const lejanos = noAscendientes(flujo, padres[0].name, [normalizador, opciones.config || 'Config del negocio', opciones.configBase || 'Config base'].filter(Boolean));
  if (!normalizador || !por(flujo, normalizador)) h.push('rafaga: el flujo no tiene el nodo que normaliza el entrante');
  if (lejanos.length) h.push(`rafaga: ${lejanos.map((n) => `«${n}»`).join(', ')} tiene que ser ascendiente de «${padres[0].name}»`);
  if (!por(flujo, ANCLA_REPORTE)) h.push(`rafaga: falta «${ANCLA_REPORTE}»`);
  else if (!reporteCorreAntes(flujo, padres[0].name, noVa[0])) h.push(`rafaga: «${ANCLA_REPORTE}» tiene que correr ANTES de la ráfaga`);
  return h;
}
