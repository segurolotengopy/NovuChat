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
 * Devuelve { nodes, connections, entrada, salidas }: `entrada` es el nombre del primer nodo (cuélguelo de «armado») y
 * `salidas` son los nodos que hay que conectar a lo que sigue (el último del reporte y su rama «no»).
 */

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
        url: "=https://graph.facebook.com/{{ $json.waGraphVersion || 'v26.0' }}/{{ $json.phoneNumberId }}/messages",
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
        url: `=https://graph.facebook.com/{{ ${A}.item.json.waGraphVersion || 'v26.0' }}/{{ ${A}.item.json.phoneNumberId }}/messages`,
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
        parameters: condicion(`={{ ${A}.item.json.reportar === true }}`),
        notes: `Solo lo que se envio AL CLIENTE se reporta (para = «${para}»), y no en modo prueba.`,
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
