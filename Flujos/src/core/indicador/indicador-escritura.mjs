/**
 * =============================================================================
 * indicador-escritura.mjs — el «escribiendo…» (los tres puntos) de WhatsApp, común a todo flujo con agente
 * =============================================================================
 *
 *   import { injertarIndicador, hallazgosDelIndicador, NODOS_DEL_INDICADOR } from '<ruta>/core/indicador/indicador-escritura.mjs';
 *
 * Meta (documentación oficial, verificada el 21/11/2026): `POST /{phone-number-id}/messages` con
 *   {"messaging_product":"whatsapp","status":"read","message_id":"<id del entrante>","typing_indicator":{"type":"text"}}
 * marca el mensaje como leído y muestra los tres puntos hasta 25 s o hasta que llega la respuesta. No es un mensaje: no suma mensajes por conversación
 * (0); es una llamada HTTP más por entrante.
 *
 * ES UNA PIEZA COMÚN, INCLUIDA Y NUNCA COPIADA: la incluyen cada `construir.mjs` de los flujos con agente y el ensamblador (`ensamblar-flujo.mjs`, clave
 * `indicador` del manifiesto de los demos). `nucleo-comun.test.ts` rechaza un flujo con agente que no la tenga o que la tenga alterada.
 *
 * LA FORMA (dos nodos, una rama lateral que no devuelve nada al flujo):
 *
 *   <ancla>  ─┬─→ ¿Indicador de escritura activo? ─sí→ Indicador de escritura        (rama lateral, SIN salida: nunca cambia el item del turno)
 *             └─→ <el nodo del modelo o del agente, tal como estaba>
 *
 *  - ANCLA: el punto donde YA se sabe que el asistente va a responder: después de «¿Atención normal?» y «¿Comercio operativo?» y de toda rama que descarta
 *    el mensaje o lo pasa a una persona (Tomar, pausa, uso extendido). En los flujos con la llamada HTTP al modelo es la salida «sí» de la pregunta que
 *    decide llamarlo (`¿Conversar con el modelo?`, `¿Llamar al modelo?`, `¿Extraer?`); en los demos con agente, la salida «sí» de `¿Atención normal?`.
 *  - UNA RAMA LATERAL Y NO EN LÍNEA: con «Continue on Fail» un HTTP que falla devuelve un item con `error` en lugar del item del turno; en línea, el modelo
 *    recibiría ese item. Colgada aparte, el turno sigue intacto pase lo que pase con Meta.
 *  - ORDEN DEL LIENZO (`executionOrder: v1`, una rama entera antes de la siguiente, de arriba hacia abajo): el nodo va MÁS ARRIBA que el modelo (corre antes)
 *    y MÁS ABAJO que «Reportar mensaje (entrante)» (nunca arriba: el reporte del entrante corre primero, regla del PR 66). Si no hay lugar entre los dos, se
 *    niega a armar (no se fuerza).
 *  - CREDENCIAL: la MISMA del nodo que envía la respuesta por Graph en ese flujo; nunca la de ingesta (la trampa del 15/09). Excepción a la prohibición 5 de
 *    CLAUDE.md autorizada por Andres el 21/11/2026: el token del comercio también se usa en este nodo, con `status: read` y `typing_indicator`.
 *  - VERSIÓN: `waGraphVersion` de «Config del negocio» (por defecto v26.0, como el resto).
 *  - `message_id`: el `mensajeId` del entrante normalizado («Normalizar entrada» o «Interpretar entrada»).
 *  - «CONTINUE ON FAIL» SOLO EN ESTE NODO, con tiempo máximo de 3000 ms y sin reintentos: si Meta tarda o falla, el flujo sigue igual.
 *  - INTERRUPTOR POR TENANT: `indicadorEscritura` en «Config base» (verdadero si falta; `false` apaga el «leído» y los puntos: el nodo no corre). En modo de
 *    prueba solo corre si el envío es de verdad, igual que «¿Enviar de verdad?».
 *
 * `opciones` de `injertarIndicador`:
 *   ancla         { nodo: 'nombre del nodo del que cuelga', salida: 0 }  (obligatoria)
 *   normalizador  nodo que emite `mensajeId` y `phoneNumberId` (por defecto «Interpretar entrada» si el flujo lo tiene, si no «Normalizar entrada»)
 *   config        nodo con `waGraphVersion` y `modoPrueba` («Config del negocio»)
 *   configBase    nodo con el interruptor («Config base»)
 *   credencial    { tipo: 'httpHeaderAuth' | 'whatsAppApi', nombre } (por defecto la del nodo que envía la respuesta por Graph)
 * Devuelve el mismo flujo con los dos nodos y sus conexiones agregados. Lanza si falta algo: no se arma a medias.
 */

export const NODO_INDICADOR = 'Indicador de escritura';
export const NODO_INDICADOR_ACTIVO = '¿Indicador de escritura activo?';
export const NODOS_DEL_INDICADOR = [NODO_INDICADOR_ACTIVO, NODO_INDICADOR];
export const ANCLA_REPORTE = 'Reportar mensaje (entrante)';
export const TIMEOUT_INDICADOR_MS = 3000;
export const VERSION_GRAPH_POR_DEFECTO = 'v26.0';
export const TIPOS_DE_CREDENCIAL = ['httpHeaderAuth', 'whatsAppApi'];
/** Los nodos que arman el item normalizado del entrante, en orden de preferencia. */
export const NORMALIZADORES = ['Interpretar entrada', 'Normalizar entrada'];
/** Los nodos que llaman al modelo para responder a un entrante (con el agente de n8n, el nodo es del tipo agente). Los flujos congelados se listan en la prueba. */
export const NODOS_DEL_MODELO = ['Conversar con el modelo', 'Llamar al modelo', 'Extraer'];
const TIPO_AGENTE = '@n8n/n8n-nodes-langchain.agent';

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
const destinos = (flujo, de, salida) => ((((flujo.connections || {})[de] || {}).main || [])[salida] || []).map((x) => x.node);

/** ¿El flujo responde con un agente o con una llamada al modelo (y por tanto debe llevar el indicador)? */
export function tieneAgente(flujo) {
  return nodosDe(flujo).some((n) => n.type === TIPO_AGENTE || NODOS_DEL_MODELO.includes(n.name));
}

/** Los dos nodos, sin conectar. `posicion` es [x, y] del primero; el segundo va 240 a la derecha. */
export function nodosDelIndicador(opciones) {
  const o = opciones || {};
  const c = o.credencial || {};
  if (!TIPOS_DE_CREDENCIAL.includes(c.tipo)) throw new Error('indicador: credencial.tipo es httpHeaderAuth o whatsAppApi');
  if (typeof c.nombre !== 'string') throw new Error('indicador: falta credencial.nombre (por NOMBRE)');
  if (/ingesta/i.test(c.nombre)) throw new Error('indicador: la credencial no puede ser la de ingesta (el token de ingesta nunca sale hacia graph.facebook.com)');
  const normalizador = o.normalizador || 'Normalizar entrada';
  const config = o.config || 'Config del negocio';
  const configBase = o.configBase || 'Config base';
  const [x, y] = o.posicion || [0, 0];
  const N = `$('${normalizador}').first().json`;
  const C = `$('${config}').first().json`;
  const version = `(/^v\\d+\\.\\d$/.test(String(${C}.waGraphVersion)) ? ${C}.waGraphVersion : '${VERSION_GRAPH_POR_DEFECTO}')`;
  const autenticacion = c.tipo === 'whatsAppApi'
    ? { authentication: 'predefinedCredentialType', nodeCredentialType: 'whatsAppApi' }
    : { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' };
  return [
    {
      id: 'indicador-si', name: NODO_INDICADOR_ACTIVO, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x, y],
      parameters: condicion(`={{ (() => { const b = $('${configBase}').first().json; const c = ${C}; const n = ${N}; return String(b.indicadorEscritura) !== 'false' && !!n.mensajeId && (c.modoPrueba !== true || (c.enviarDeVerdad === true && !!c.telefonoDePrueba)); })() }}`),
      notes: 'Interruptor por negocio: `indicadorEscritura` en «Config base» (verdadero si falta). Rama lateral del indicador de escritura (modulo comun Flujos/src/core/indicador/).',
    },
    {
      id: 'indicador-escritura', name: NODO_INDICADOR, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 240, y],
      credentials: { [c.tipo]: { id: '', name: c.nombre } }, onError: 'continueRegularOutput',
      parameters: {
        method: 'POST',
        url: `=https://graph.facebook.com/{{ ${version} }}/{{ String(${N}.phoneNumberId).replace(/\\D/g, '') }}/messages`,
        ...autenticacion,
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: String(${N}.mensajeId), typing_indicator: { type: 'text' } }) }}`,
        options: { timeout: TIMEOUT_INDICADOR_MS },
      },
      notes: 'Los tres puntos (escribiendo…) y el mensaje como leido: una llamada a Meta por entrante, no es un mensaje (0 por conversacion). Rama lateral: con Continue on Fail y 3 s de tope, si falla el turno sigue igual. Misma credencial que el envio; nunca la de ingesta.',
    },
  ];
}

/**
 * ¿Es el nodo del indicador? Por nombre Y por forma: un `POST …/messages` de ese nombre que mande un mensaje de verdad (no `status: read` con
 * `typing_indicator`) NO es el indicador. Las guardias de entrega (R5: «ningún fallo tragado») lo excluyen de los envíos: no entrega nada.
 */
export function esNodoIndicador(n) {
  const cuerpo = String(((n && n.parameters) || {}).jsonBody || '');
  return !!n && n.name === NODO_INDICADOR && n.type === 'n8n-nodes-base.httpRequest'
    && /status: 'read'/.test(cuerpo) && /typing_indicator: \{ type: 'text' \}/.test(cuerpo) && !/\b(?:type|text|interactive|template|to)\s*:/.test(cuerpo.replace(/typing_indicator: \{ type: 'text' \}/, ''));
}

/** Los nodos HTTP que envían por Graph (`…/messages`) con su credencial: de ahí sale la credencial del indicador. */
function enviadoresPorGraph(flujo) {
  return nodosDe(flujo).filter((n) => !NODOS_DEL_INDICADOR.includes(n.name) && n.type === 'n8n-nodes-base.httpRequest'
    && /^=?https:\/\/graph\.facebook\.com\/.*\/messages\s*$/.test(String(((n.parameters || {}).url) || '')));
}
const credencialDe = (n) => {
  const e = Object.entries((n && n.credentials) || {});
  return e.length === 1 && TIPOS_DE_CREDENCIAL.includes(e[0][0]) ? { tipo: e[0][0], nombre: String((e[0][1] || {}).name || '') } : null;
};
const credencialDeIngesta = (flujo) => credencialDe(por(flujo, ANCLA_REPORTE));

/** La credencial con la que el flujo envía la respuesta por Graph: «Enviar a WhatsApp» y, si no existe, la del primer nodo de envío con credencial. */
export function credencialDeEnvio(flujo) {
  const enviadores = enviadoresPorGraph(flujo);
  const preferido = enviadores.find((n) => n.name === 'Enviar a WhatsApp' && credencialDe(n));
  const nodo = preferido || enviadores.find((n) => credencialDe(n));
  return nodo ? credencialDe(nodo) : null;
}

const normalizadorDe = (flujo) => NORMALIZADORES.find((n) => por(flujo, n)) || null;

/** Posición de los dos nodos: más abajo que el reporte del entrante y más arriba que el hermano más alto del ancla (corre antes que él). */
function posicionDelIndicador(flujo, ancla, salida) {
  const rep = por(flujo, ANCLA_REPORTE);
  const hermanos = destinos(flujo, ancla.name, salida).map((nombre) => por(flujo, nombre)).filter(Boolean);
  const yRep = Number((rep.position || [0, 0])[1]);
  const ySib = Math.min(...hermanos.map((h) => Number((h.position || [0, 0])[1])));
  if (!Number.isFinite(ySib)) throw new Error(`indicador: «${ancla.name}» no tiene a quién anteceder en la salida ${salida}`);
  if (!(ySib - yRep >= 20)) throw new Error(`indicador: no hay lugar en el lienzo entre «${ANCLA_REPORTE}» (y=${yRep}) y el nodo que sigue (y=${ySib}): el indicador tiene que ir más abajo que el reporte y más arriba que el modelo`);
  const y = yRep + Math.floor((ySib - yRep) / 2);
  const xs = hermanos.map((h) => Number((h.position || [0, 0])[0]));
  return [Math.min(...xs) - 480, y];
}

export function injertarIndicador(flujo, opciones) {
  const o = opciones || {};
  const a = o.ancla || {};
  const salida = a.salida === undefined ? 0 : a.salida;
  const ancla = por(flujo, a.nodo);
  if (!ancla) throw new Error(`indicador: el flujo no tiene «${a.nodo}» (el nodo del que cuelga)`);
  for (const n of NODOS_DEL_INDICADOR) if (por(flujo, n)) throw new Error(`indicador: el flujo ya tiene «${n}»`);
  if (!por(flujo, ANCLA_REPORTE)) throw new Error(`indicador: el flujo no tiene «${ANCLA_REPORTE}»`);
  const normalizador = o.normalizador || normalizadorDe(flujo);
  if (!normalizador || !por(flujo, normalizador)) throw new Error('indicador: el flujo no tiene el nodo que normaliza el entrante («Interpretar entrada» o «Normalizar entrada»)');
  for (const n of [o.config || 'Config del negocio', o.configBase || 'Config base']) if (!por(flujo, n)) throw new Error(`indicador: el flujo no tiene «${n}»`);
  const credencial = o.credencial || credencialDeEnvio(flujo);
  if (!credencial) throw new Error('indicador: el flujo no tiene un nodo que envíe por Graph con credencial de WhatsApp de donde tomarla');
  const ingesta = credencialDeIngesta(flujo);
  if (ingesta && ingesta.tipo === credencial.tipo && ingesta.nombre === credencial.nombre) throw new Error('indicador: la credencial de envío es la de ingesta');
  const nodos = nodosDelIndicador({ ...o, normalizador, credencial, posicion: posicionDelIndicador(flujo, ancla, salida) });
  flujo.nodes.push(...nodos);
  const con = flujo.connections || (flujo.connections = {});
  const m = (con[a.nodo] || (con[a.nodo] = { main: [] })).main;
  while (m.length <= salida) m.push([]);
  // Primero en la lista de la salida: con el mismo orden de lienzo, así también se lee.
  m[salida].unshift(enlace(NODO_INDICADOR_ACTIVO));
  con[NODO_INDICADOR_ACTIVO] = { main: [[enlace(NODO_INDICADOR)]] };
  return flujo;
}

/** Quita los dos nodos y sus conexiones (para volver a injertar la pieza canónica: lo usa el ensamblador, que es idempotente). */
export function quitarIndicador(flujo) {
  flujo.nodes = nodosDe(flujo).filter((n) => !NODOS_DEL_INDICADOR.includes(n.name));
  const con = flujo.connections || {};
  for (const n of NODOS_DEL_INDICADOR) delete con[n];
  for (const salidas of Object.values(con)) {
    for (const tipo of Object.keys(salidas)) {
      salidas[tipo] = salidas[tipo].map((lista) => (lista || []).filter((e) => !NODOS_DEL_INDICADOR.includes(e.node)));
    }
  }
  return flujo;
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
/** ¿`nodo` se alcanza desde la salida «sí» (0) de `desde`? */
function seAlcanzaDesdeLaSalidaSi(flujo, desde, nodo) {
  const visto = new Set();
  const pila = destinos(flujo, desde, 0);
  while (pila.length) {
    const n = pila.pop();
    if (n === nodo) return true;
    if (visto.has(n)) continue;
    visto.add(n);
    for (const lista of (((flujo.connections || {})[n] || {}).main || [])) for (const e of (lista || [])) pila.push(e.node);
  }
  return false;
}

/**
 * Lo que le falta o le sobra al indicador en un flujo armado. Vacío si está bien. Con `exigir: false` y un flujo sin agente devuelve vacío (no aplica);
 * `exigir: true` lo pide siempre.
 */
export function hallazgosDelIndicador(flujo, opciones = {}) {
  const h = [];
  const exigir = opciones && opciones.exigir === true;
  if (!exigir && !tieneAgente(flujo)) return h;
  const si = por(flujo, NODO_INDICADOR_ACTIVO);
  const http = por(flujo, NODO_INDICADOR);
  if (!si) h.push(`indicador: falta el nodo «${NODO_INDICADOR_ACTIVO}»`);
  if (!http) h.push(`indicador: falta el nodo «${NODO_INDICADOR}»`);
  if (h.length) return h;

  // Credencial: nunca la de ingesta (se mira primero: con ella ni siquiera se arma el nodo canónico).
  const cred = credencialDe(http);
  if (!cred) { h.push(`indicador: «${NODO_INDICADOR}» tiene que llevar UNA credencial de WhatsApp (httpHeaderAuth o whatsAppApi) por nombre`); return h; }
  const ingesta = credencialDeIngesta(flujo);
  if (/ingesta/i.test(cred.nombre) || (ingesta && ingesta.tipo === cred.tipo && ingesta.nombre === cred.nombre)) {
    h.push(`indicador: «${NODO_INDICADOR}» usa la credencial de ingesta (tiene que ser la del envío por Graph)`);
    return h;
  }
  // Alterado: los dos nodos son los canónicos (se arman con la misma función y la credencial y el normalizador que el propio nodo declara).
  const normalizador = normalizadorDe(flujo);
  let canonicos;
  try {
    canonicos = nodosDelIndicador({ credencial: cred, normalizador: normalizador || 'Normalizar entrada', posicion: si.position });
  } catch (e) { h.push(String(e.message)); return h; }
  const forma = (n) => JSON.stringify({ id: n.id, name: n.name, type: n.type, typeVersion: n.typeVersion, parameters: n.parameters, credentials: n.credentials, onError: n.onError, continueOnFail: n.continueOnFail, retryOnFail: n.retryOnFail, maxTries: n.maxTries, waitBetweenTries: n.waitBetweenTries, alwaysOutputData: n.alwaysOutputData, executeOnce: n.executeOnce, disabled: n.disabled, notes: n.notes });
  for (const [real, canonico] of [[si, canonicos[0]], [http, canonicos[1]]]) {
    if (forma(real) !== forma(canonico)) h.push(`indicador: «${real.name}» no es el nodo común (parámetros, credencial, Continue on Fail o tiempo alterados)`);
  }
  if (http.onError !== 'continueRegularOutput') h.push(`indicador: «${NODO_INDICADOR}» tiene que llevar Continue on Fail`);
  if (!((http.parameters || {}).options && http.parameters.options.timeout <= TIMEOUT_INDICADOR_MS)) h.push(`indicador: «${NODO_INDICADOR}» tiene que tener un tiempo máximo de ${TIMEOUT_INDICADOR_MS} ms o menos`);
  if (si.onError || si.continueOnFail) h.push(`indicador: «${NODO_INDICADOR_ACTIVO}» no lleva Continue on Fail (es solo del nodo HTTP)`);

  // Credencial: la de envío del flujo.
  const envio = enviadoresPorGraph(flujo).map(credencialDe).filter(Boolean);
  if (!envio.some((c) => c.tipo === cred.tipo && c.nombre === cred.nombre)) h.push(`indicador: «${NODO_INDICADOR}» no usa la credencial con la que el flujo envía la respuesta por Graph`);

  // Conexiones: ancla → ¿activo? → indicador, y el indicador no devuelve nada al flujo.
  const padres = nodosDe(flujo).filter((n) => [0, 1].some((i) => destinos(flujo, n.name, i).includes(NODO_INDICADOR_ACTIVO)));
  if (padres.length !== 1) h.push(`indicador: «${NODO_INDICADOR_ACTIVO}» tiene que colgar de UN solo nodo (cuelga de ${padres.length})`);
  if (JSON.stringify(destinos(flujo, NODO_INDICADOR_ACTIVO, 0)) !== JSON.stringify([NODO_INDICADOR])) h.push(`indicador: «${NODO_INDICADOR_ACTIVO}» (sí) tiene que ir solo a «${NODO_INDICADOR}»`);
  if (destinos(flujo, NODO_INDICADOR_ACTIVO, 1).length) h.push(`indicador: «${NODO_INDICADOR_ACTIVO}» (no) no se conecta a nada`);
  if ([0, 1].some((i) => destinos(flujo, NODO_INDICADOR, i).length)) h.push(`indicador: «${NODO_INDICADOR}» es una hoja: no devuelve nada al turno`);
  if (padres.length !== 1) return h;
  const ancla = padres[0];
  const hermanos = [0, 1].flatMap((i) => (destinos(flujo, ancla.name, i).includes(NODO_INDICADOR_ACTIVO) ? destinos(flujo, ancla.name, i).filter((x) => x !== NODO_INDICADOR_ACTIVO) : []));

  // Después de «¿Atención normal?» y «¿Comercio operativo?», por su salida «sí»: no se muestra cuando el mensaje se descarta o pasa a una persona.
  for (const puerta of ['¿Comercio operativo?', '¿Atención normal?']) {
    if (por(flujo, puerta) && !seAlcanzaDesdeLaSalidaSi(flujo, puerta, NODO_INDICADOR_ACTIVO)) h.push(`indicador: tiene que ir DESPUÉS de «${puerta}» (por su salida «sí»)`);
  }
  // Antes del modelo: corre antes que sus hermanos (más arriba) y los modelos cuelgan de su mismo ancla.
  const modelos = nodosDe(flujo).filter((n) => n.type === TIPO_AGENTE || NODOS_DEL_MODELO.includes(n.name)).map((n) => n.name);
  for (const m of modelos) {
    if (m !== ancla.name && !ascendientes(flujo, m).has(ancla.name)) h.push(`indicador: «${m}» no cuelga del mismo punto que el indicador («${ancla.name}»): el indicador tiene que ir antes del modelo`);
  }
  const rep = por(flujo, ANCLA_REPORTE);
  if (!rep) h.push(`indicador: falta «${ANCLA_REPORTE}»`);
  const y = (n) => Number(((n && n.position) || [0, 0])[1]);
  for (const hermano of hermanos) {
    const n = por(flujo, hermano);
    if (n && !(y(si) < y(n))) h.push(`indicador: «${NODO_INDICADOR_ACTIVO}» tiene que ir MÁS ARRIBA que «${hermano}» en el lienzo (si no, corre después del modelo)`);
  }
  if (rep) {
    for (const n of [si, http]) if (!(y(n) > y(rep))) h.push(`indicador: «${n.name}» no puede ir arriba de «${ANCLA_REPORTE}» (el reporte del entrante corre primero)`);
    // Y desde el reporte se llega al indicador (corre después de él), salvo que el reporte sea una hoja hermana de la rama (demos).
  }
  return h;
}
