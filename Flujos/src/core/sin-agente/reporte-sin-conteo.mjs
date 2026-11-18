/**
 * =============================================================================
 * reporte-sin-conteo.mjs — reporta SIN CONTEO la foto que el flujo envía por el nodo de previos
 * =============================================================================
 *
 *   import { injertarReporteSinConteo, hallazgosDelReporteSinConteo } from '<ruta>/core/sin-agente/reporte-sin-conteo.mjs';
 *
 * Decisión de Andres (16/11/2026, por botón): las FOTOS de catálogo de Evy y Emma (imágenes de apoyo, por media id) salen por «Enviar aviso» (el nodo de los
 * «previos», que corre ANTES de «Armar mensajes»), no por la cadena común de envío, y hoy nadie las reporta a la ingesta: no se ven en la consola. Se reportan
 * SIN CONTEO: el cuerpo lleva `sinConteo: true` y el servidor las registra sin sumarlas a las respuestas del asistente (contrato con `admin/functions`; el
 * servidor ignora `sinConteo` en cualquier otro caso). El flujo tampoco las cuenta: ninguna de las dos piezas nuevas cuelga de «Resumen del turno».
 *
 *   Enviar aviso ─┬─ ¿Reportar foto? ──(Meta aceptó una foto)──→ Reportar foto (saliente) ──→ [guardado saliente, módulo común]
 *                 └─ Armar mensajes … (sin cambios)
 *
 * POR QUÉ ASÍ:
 *  - 2 NODOS, sin Code: un `if` (solo un ítem `kind: 'arte'` que Meta aceptó con un `messages[0].id`; los avisos a recepción no son mensajes al cliente y un envío
 *    fallido no se reporta) y un HTTP a la ingesta. Reutiliza la URL, la credencial de ingesta y el número del «Reportar mensaje (saliente)» del flujo.
 *  - DEBAJO de «Armar mensajes» y de toda su rama en el lienzo: con `executionOrder: v1` n8n termina una rama entera antes de empezar la siguiente (de arriba hacia
 *    abajo), así que el reporte y el guardado de la imagen (que cuelga de él) corren DESPUÉS de todos los envíos al cliente: ni el reporte ni la descarga de la foto
 *    retrasan el texto que el cliente espera. (Contrapartida: en la consola la foto queda registrada después del texto que la sigue.) No agrega ningún mensaje de WhatsApp.
 *  - NADA CORTA EL TURNO: `onError: continueRegularOutput` y `alwaysOutputData`, con tiempo máximo corto.
 *  - NO es un reporte de texto: no lleva `evento`, y el rótulo es corto («Foto de apoyo: comparativo»), nunca contenido del cliente.
 */
export const NODOS_DEL_REPORTE_SIN_CONTEO = ['¿Reportar foto? (saliente)', 'Reportar foto (saliente)'];
export const REPORTERO_DE_FOTOS = 'Reportar foto (saliente)';

const OPERADOR_BOOLEANO = { type: 'boolean', operation: 'true', singleValue: true };
const enlace = (a) => ({ node: a, type: 'main', index: 0 });

/** El id de Meta del envío: `messages[0].id` (Graph) o, si el flujo va por el relé, `idMeta`. */
const ID_DEL_ENVIO = "(($json || {}).idMeta || ((($json || {}).messages || [])[0] || {}).id || '')";

export function injertarReporteSinConteo(flujo, opciones = {}) {
  const o = opciones;
  const envio = o.envio || 'Enviar aviso';
  const origen = o.origen || 'Armar previos';
  const salientes = o.reportero || 'Reportar mensaje (saliente)';
  const nEnvio = (flujo.nodes || []).find((n) => n.name === envio);
  const nRep = (flujo.nodes || []).find((n) => n.name === salientes);
  if (!nEnvio) throw new Error(`reporte sin conteo: el flujo no tiene «${envio}»`);
  if (!nRep) throw new Error(`reporte sin conteo: el flujo no tiene «${salientes}» (de donde se toman la URL, la credencial y el número)`);
  for (const n of NODOS_DEL_REPORTE_SIN_CONTEO) if (flujo.nodes.some((x) => x.name === n)) throw new Error(`reporte sin conteo: el flujo ya tiene «${n}»`);
  const sig = (((flujo.connections || {})[envio] || {}).main || [])[0] || [];
  if (!sig.length) throw new Error(`reporte sin conteo: «${envio}» no tiene a quién seguir`);
  const [x, y] = nEnvio.position;
  const rotulo = `'Foto de apoyo: ' + String(m.arte || '').replace(/[^a-z_]/g, '').slice(0, 30)`;
  const si = {
    id: 'reportar-foto-si', name: NODOS_DEL_REPORTE_SIN_CONTEO[0], type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x + 240, y + 860],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'c1', leftValue: `={{ $('${origen}').item.json.kind === 'arte' && !($json && $json.error) && ${ID_DEL_ENVIO} !== '' }}`, rightValue: true, operator: OPERADOR_BOOLEANO }],
        combinator: 'and',
      },
      options: {},
    },
    notes: 'Solo una FOTO de apoyo que Meta aceptó (con el id de su mensaje): un aviso a recepción no es un mensaje al cliente y un envío fallido no se reporta. Sin Code: decide la condición.',
  };
  const rep = {
    id: 'reportar-foto', name: REPORTERO_DE_FOTOS, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + 480, y + 800],
    parameters: {
      ...JSON.parse(JSON.stringify(nRep.parameters)),
      jsonBody: `={{ (() => { const m = $('${origen}').item.json; return JSON.stringify({ telefono: m.para, direccion: 'saliente', tipo: 'image', texto: ${rotulo}, idMeta: ${ID_DEL_ENVIO}, sinConteo: true }); })() }}`,
      options: { timeout: 8000 },
    },
    credentials: JSON.parse(JSON.stringify(nRep.credentials || {})),
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Reporta la foto enviada a la ingesta SIN CONTEO (`sinConteo: true`, decisión de Andres del 16/11/2026): se ve en la consola pero no cuenta como respuesta del asistente. Mismo `idMeta` que devolvió Meta; de este reporte cuelga el guardado de la imagen enviada.',
  };
  flujo.nodes.push(si, rep);
  const con = flujo.connections;
  // La rama del reporte va ABAJO en el lienzo y la última en las conexiones: v1 corre primero lo que ya seguía (toda la rama de «Armar mensajes»).
  con[envio].main[0] = [...sig, enlace(si.name)];
  con[si.name] = { main: [[enlace(rep.name)], []] };
  return flujo;
}

/** Lo que le falta o le sobra al reporte sin conteo en un flujo armado. Vacío si está bien. Con `exigir` falla también si no está. */
export function hallazgosDelReporteSinConteo(flujo, opciones = {}) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const por = (n) => nodos.find((x) => x.name === n);
  const hay = NODOS_DEL_REPORTE_SIN_CONTEO.filter((n) => por(n));
  if (!hay.length) { if (opciones.exigir) h.push('reporte sin conteo: faltan «¿Reportar foto? (saliente)» y «Reportar foto (saliente)»'); return h; }
  if (hay.length !== 2) { h.push('reporte sin conteo: falta uno de los dos nodos'); return h; }
  const envio = opciones.envio || 'Enviar aviso';
  const con = flujo.connections || {};
  const dest = (de, s) => ((((con[de] || {}).main || [])[s]) || []).map((x) => x.node);
  const nSi = por(NODOS_DEL_REPORTE_SIN_CONTEO[0]);
  const nRep = por(REPORTERO_DE_FOTOS);
  const nEnvio = por(envio);
  const salientes = por('Reportar mensaje (saliente)');
  if (!nEnvio) { h.push(`reporte sin conteo: falta «${envio}»`); return h; }
  if (!dest(envio, 0).includes(nSi.name)) h.push(`reporte sin conteo: «${nSi.name}» no cuelga de «${envio}»`);
  if (dest(nSi.name, 0).join() !== nRep.name || dest(nSi.name, 1).length) h.push('reporte sin conteo: la salida verdadera del `if` va solo al reporte y la falsa no va a ninguna parte');
  if (dest(nRep.name, 0).some((d) => !['Preparar guardado (saliente)'].includes(d))) h.push('reporte sin conteo: el reporte solo puede seguir hacia el guardado saliente (nada cuenta la foto como respuesta)');
  // DEBAJO de «Armar mensajes» y de todo lo que cuelga de él: el reporte y el guardado corren después de todo envío al cliente.
  const armar = por('Armar mensajes');
  if (armar) {
    const visto = new Set(['Armar mensajes']);
    const pila = ['Armar mensajes'];
    while (pila.length) { const n = pila.pop(); for (const s of [0, 1, 2]) for (const d of dest(n, s)) if (!visto.has(d)) { visto.add(d); pila.push(d); } }
    for (const n of visto) { const nn = por(n); if (nn && !(Number(nn.position[1]) < Number(nSi.position[1]))) h.push(`reporte sin conteo: «${nSi.name}» tiene que ir DEBAJO de «${n}» (la rama de «Armar mensajes» corre entera antes: orden de ramas del lienzo)`); }
  }
  // Lo que ya seguía a «envío» va primero; el reporte, el último.
  if (dest(envio, 0)[dest(envio, 0).length - 1] !== nSi.name) h.push(`reporte sin conteo: «${nSi.name}» tiene que ser la última salida de «${envio}»`);
  const cuerpo = String((nRep.parameters || {}).jsonBody || '');
  if (!/sinConteo: true/.test(cuerpo) || !/tipo: 'image'/.test(cuerpo) || !/direccion: 'saliente'/.test(cuerpo)) h.push('reporte sin conteo: el cuerpo tiene que llevar direccion saliente, tipo image y sinConteo true');
  if (/evento/.test(cuerpo)) h.push('reporte sin conteo: una foto no lleva evento');
  if (nRep.onError !== 'continueRegularOutput' || nRep.alwaysOutputData !== true) h.push('reporte sin conteo: el reporte tiene que llevar onError continueRegularOutput y alwaysOutputData');
  if (!/kind === 'arte'/.test(String((nSi.parameters.conditions.conditions[0] || {}).leftValue || ''))) h.push('reporte sin conteo: el `if` solo deja pasar una foto (kind arte)');
  if (salientes && JSON.stringify(salientes.credentials || {}) !== JSON.stringify(nRep.credentials || {})) h.push('reporte sin conteo: usa la credencial de ingesta del «Reportar mensaje (saliente)» del flujo');
  // Los demás reportes NO llevan sinConteo (el servidor lo ignora, pero el flujo no lo manda).
  for (const n of nodos) if (n.name !== REPORTERO_DE_FOTOS && /sinConteo/.test(JSON.stringify(n.parameters || {}))) h.push(`reporte sin conteo: «${n.name}» no puede mandar sinConteo (solo el de las fotos)`);
  return h;
}
