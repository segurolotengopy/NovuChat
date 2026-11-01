// Lo que el constructor de un flujo necesita del modulo `crm`: los paquetes de codigo que se INCLUYEN (nunca se copian) y el injerto del mapa de
// columnas del tenant (dato, no codigo). Lo usan los `construir.mjs` de los flujos que llevan miniCRM.
//
//   paquetes.crm-prospecto = [crm.js, nodo-prospecto.js]
//   paquetes.crm-decidir   = [crm.js, <adaptador que pasa el flujo>, nodo-decidir-fila.js]
//   plantilla: "jsCode": "@@medio:crm-prospecto"  /  "@@medio:crm-decidir"
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'modulos', 'crm');
/**
 * Las rutas de cada paquete. El ADAPTADOR de captacion (como se califica y se resume) lo pasa quien construye el flujo: el modulo `crm` no sabe
 * donde vive ni lo importa por su cuenta.
 */
export function rutasPaquetesCrm(rutaAdaptador) {
  if (typeof rutaAdaptador !== 'string' || !rutaAdaptador) throw new Error('crm: falta la ruta del adaptador (calificar y resumir)');
  return {
    'crm-prospecto': [join(AQUI, 'crm.js'), join(AQUI, 'nodo-prospecto.js')],
    'crm-decidir': [join(AQUI, 'crm.js'), rutaAdaptador, join(AQUI, 'nodo-decidir-fila.js')],
  };
}
/** El paquete del adaptador GENERAL de senales (PR-F0): crm.js + adaptador-senales.js (define `CRM_ADAPTADOR`) + el nodo de decidir fila. Sin textos de cliente. */
export const rutasPaqueteCrmSenales = () => ({
  'crm-prospecto': [join(AQUI, 'crm.js'), join(AQUI, 'nodo-prospecto.js')],
  'crm-decidir-senales': [join(AQUI, 'crm.js'), join(AQUI, 'adaptador-senales.js'), join(AQUI, 'nodo-decidir-fila.js')],
});
export const MARCA_MAPA = 'const CRM_MAPA = null; // @@crm-mapa';

/** El texto de cada paquete (archivos unidos). */
export function paquetesCrm(rutaAdaptador) {
  return Object.fromEntries(Object.entries(rutasPaquetesCrm(rutaAdaptador)).map(([k, rutas]) => [k, rutas.map((r) => readFileSync(r, 'utf8').trimEnd())]));
}

/** Valida el mapa con el MISMO `crmValidarMapa` que corre en n8n. Devuelve la lista de errores. */
export function validarMapaCrm(mapa) {
  const codigo = readFileSync(join(AQUI, 'crm.js'), 'utf8');
  const { crmValidarMapa } = runInNewContext(`${codigo}\n({ crmValidarMapa })`, {});
  return crmValidarMapa(JSON.parse(JSON.stringify(mapa ?? null)));
}

/** Reemplaza la linea marcadora exactamente una vez. Lanza si hay 0 o mas de 1. */
export function inyectarMapa(codigo, mapa) {
  const partes = codigo.split(MARCA_MAPA);
  if (partes.length !== 2) throw new Error(`la linea «${MARCA_MAPA}» debe aparecer exactamente una vez (aparece ${partes.length - 1})`);
  return partes[0] + `const CRM_MAPA = ${JSON.stringify(mapa)};` + partes[1];
}

export const letraBot = (mapa) => Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
const nodo = (flujo, nombre) => {
  const n = flujo.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`crm: el flujo no tiene el nodo «${nombre}»`);
  return n;
};

export const NODO_ENCABEZADOS = 'Leer encabezados de la planilla';
/** El rango que lee la fila de encabezados: A{fila}:{ultima del bot}{fila+1}. NUNCA llega a la letra del equipo posterior (diagnostico). */
export const rangoEncabezados = (mapa) => `A${mapa.filaEncabezados}:${letraBot(mapa)}${mapa.filaEncabezados + 1}`;

/**
 * Injerta el mapa del tenant en un flujo ya armado (objeto): el mapa dentro del codigo de cada nodo que incluye `crm.js` y, en los 4 nodos de Google,
 * el rango de lectura (A{fila}:{ultima letra del bot} y A{fila}:A), la fila de encabezados, la primera fila de datos, la columna de busqueda del
 * telefono y `returnFirstMatch: false` (se leen TODAS las coincidencias; el codigo elige la mas reciente). Lanza si el mapa no es valido.
 */
export function injertarCrm(flujo, mapa) {
  const errores = validarMapaCrm(mapa);
  if (errores.length) throw new Error(`crm: el mapa de columnas no es valido: ${errores.join('; ')}`);
  let inyectados = 0;
  for (const n of flujo.nodes) {
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js === 'string' && js.includes(MARCA_MAPA)) { n.parameters.jsCode = inyectarMapa(js, mapa); inyectados++; }
  }
  if (inyectados === 0) throw new Error('crm: ningun nodo lleva la linea marcadora del mapa');
  const f = mapa.filaEncabezados;
  const buscar = nodo(flujo, 'Buscar teléfono en planilla').parameters;
  buscar.options.dataLocationOnSheet.values.range = `A${f}:${letraBot(mapa)}`;
  buscar.options.returnFirstMatch = false;
  for (const fl of buscar.filtersUI.values) fl.lookupColumn = mapa.columnas.telefono.titulo;
  const enc = flujo.nodes.find((x) => x.name === NODO_ENCABEZADOS);
  if (enc) { // la rama `ramaCrm`: la fila de encabezados + la primera de datos, para comprobar la fila COMPLETA antes de agregar
    enc.parameters.options.dataLocationOnSheet.values.range = rangoEncabezados(mapa);
  }
  nodo(flujo, 'Leer IDs de la planilla').parameters.options.dataLocationOnSheet.values.range = `A${f}:A`;
  nodo(flujo, 'Agregar fila').parameters.options.locationDefine.values.headerRow = f;
  const act = nodo(flujo, 'Actualizar fila').parameters.options.locationDefine.values;
  act.headerRow = f;
  act.firstDataRow = f + 1;
  return flujo;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// ramaCrm: LA RAMA SE GENERA, NO SE COPIA (PR-F0). 8 nodos que cuelgan de «Armar mensajes» por debajo del envio al cliente:
//   Prospecto para la planilla > Buscar telefono > Leer IDs > Leer encabezados > Decidir fila > ¿accion? (Switch) > Agregar fila | Actualizar fila.
// Las lecturas leen lo minimo (A..ultima letra del bot): nunca la letra de `equipo.diagnostico`. La credencial llega por parametro (`@@cred:...`), nunca de datos.
// MENSAJES: ninguno.
const NODO_SWITCH = '¿Acción de la planilla?';
const DOC = { __rl: true, mode: 'id', value: "={{ $('Config del negocio').first().json.planillaProspectosId }}" };
const HOJA = { __rl: true, mode: 'name', value: "={{ $('Config del negocio').first().json.planillaProspectosHoja }}" };
const FORMATO_LECTURA = { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } };

export function ramaCrm({ desde = 'Armar mensajes', credencial, paquete = 'crm-decidir-senales', x = 5000, y = 640 } = {}) {
  if (typeof credencial !== 'string' || !/^@@cred:crm$/.test(credencial)) throw new Error('ramaCrm: la credencial tiene que ser exactamente el token @@cred:crm (se calcula por tenant, no sale de datos)');
  const cred = { googleApi: { id: '', name: credencial } };
  const lectura = (id, name, pos, range, extra = {}, notes = '') => ({
    id, name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: pos, ...(extra.executeOnce ? { executeOnce: true } : {}),
    parameters: { authentication: 'serviceAccount', resource: 'sheet', operation: 'read', documentId: DOC, sheetName: HOJA,
      ...(extra.filtros || {}), options: { dataLocationOnSheet: { values: { rangeDefinition: 'specifyRangeA1', range } }, outputFormatting: FORMATO_LECTURA, ...(extra.opciones || {}) } },
    credentials: cred, onError: 'continueRegularOutput', alwaysOutputData: true, notes,
  });
  const nodes = [
    { id: 'prospecto-para-la-planilla', name: 'Prospecto para la planilla', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y], parameters: { jsCode: '@@medio:crm-prospecto' },
      notes: 'Deja pasar solo al prospecto que «Armar mensajes» decidio guardar. Sin ninguno, Google ni se consulta.' },
    lectura('buscar-telefono-en-planilla', 'Buscar teléfono en planilla', [x + 240, y], 'A3:J', {
      filtros: { filtersUI: { values: [{ lookupColumn: 'Teléfono WhatsApp', lookupValue: '={{ $json.telefono }}' }, { lookupColumn: 'Teléfono WhatsApp', lookupValue: "={{ '+' + $json.telefono }}" }] }, combineFilters: 'OR' },
      opciones: { returnFirstMatch: false } }, 'Solo las filas de este telefono y solo hasta la ultima columna del bot; nunca las del equipo.'),
    lectura('leer-ids-de-la-planilla', 'Leer IDs de la planilla', [x + 480, y], 'A3:A', { executeOnce: true }, 'Solo la columna del ID.'),
    lectura('leer-encabezados-de-la-planilla', NODO_ENCABEZADOS, [x + 720, y], 'A3:J4', { executeOnce: true },
      'La fila de encabezados completa (con la primera fila de datos) para comprobarla antes de agregar. Hasta la ultima columna del bot.'),
    { id: 'decidir-fila-de-la-planilla', name: 'Decidir fila de la planilla', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 960, y], parameters: { jsCode: `@@medio:${paquete}` },
      notes: 'Incluido del módulo crm (no es copia): agrega o actualiza segun lo leido; la clasificacion se calcula por hechos.' },
    { id: 'accion-de-la-planilla', name: NODO_SWITCH, type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [x + 1200, y],
      parameters: { rules: { values: ['agregar', 'actualizar'].map((v, i) => ({ conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: `c${i + 1}`, leftValue: '={{ $json.accionPlanilla }}', rightValue: v, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: v })) }, options: {} },
      notes: 'agregar | actualizar. «nada» no sale por ningun lado.' },
    { id: 'agregar-fila', name: 'Agregar fila', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [x + 1440, y - 80],
      parameters: { authentication: 'serviceAccount', resource: 'sheet', operation: 'append', documentId: DOC, sheetName: HOJA,
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
        options: { cellFormat: 'USER_ENTERED', locationDefine: { values: { headerRow: 3 } }, handlingExtraData: 'ignoreIt', useAppend: true } },
      credentials: cred, onError: 'continueRegularOutput', notes: 'USER_ENTERED; los textos llegan con apostrofo y sin «=», «+», «-» ni «@» al inicio.' },
    { id: 'actualizar-fila', name: 'Actualizar fila', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [x + 1440, y + 80],
      parameters: { authentication: 'serviceAccount', resource: 'sheet', operation: 'update', documentId: DOC, sheetName: HOJA,
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['row_number'], schema: [] },
        options: { cellFormat: 'RAW', locationDefine: { values: { headerRow: 3, firstDataRow: 4 } }, handlingExtraData: 'ignoreIt' } },
      credentials: cred, onError: 'continueRegularOutput', notes: 'RAW: nada se interpreta. Solo las celdas del bot, por `row_number`.' },
  ];
  const conexiones = {};
  const unir = (de, a, salida = 0) => {
    conexiones[de] = conexiones[de] || { main: [] };
    while (conexiones[de].main.length <= salida) conexiones[de].main.push([]);
    conexiones[de].main[salida].push({ node: a, type: 'main', index: 0 });
  };
  unir('Prospecto para la planilla', 'Buscar teléfono en planilla');
  unir('Buscar teléfono en planilla', 'Leer IDs de la planilla');
  unir('Leer IDs de la planilla', NODO_ENCABEZADOS);
  unir(NODO_ENCABEZADOS, 'Decidir fila de la planilla');
  unir('Decidir fila de la planilla', NODO_SWITCH);
  unir(NODO_SWITCH, 'Agregar fila', 0);
  unir(NODO_SWITCH, 'Actualizar fila', 1);
  return { nodes, connections: conexiones, entrada: 'Prospecto para la planilla', desde };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// hallazgosCrm: lo que el CI y `--verificar` exigen a un flujo con miniCRM. Devuelve la lista de hallazgos (vacia = bien).
//   * ningun nodo de Google lee un rango que llegue a la letra de `equipo.diagnostico` ni pase de la ultima letra del bot;
//   * la retencion de ejecuciones es `none` (exito y error) y no se guarda el progreso: el nodo con datos de la hoja no deja huella en n8n;
//   * si hay «Leer encabezados de la planilla», lee la fila de encabezados completa y el nodo de decidir fila esta conectado despues de el.
const letraDe = (rango) => { const m = /^A\d+:([A-Z])(\d*)$/.exec(String(rango ?? '')); return m ? m[1] : null; };
export function hallazgosCrm(flujo, mapa) {
  const h = [];
  const nodos = (flujo && flujo.nodes) || [];
  const ultima = letraBot(mapa);
  const diag = mapa.equipo && mapa.equipo.diagnostico ? mapa.equipo.diagnostico.letra : null;
  for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.googleSheets' && (x.parameters || {}).operation === 'read')) {
    const rango = (((((n.parameters || {}).options || {}).dataLocationOnSheet || {}).values) || {}).range;
    const l = letraDe(rango);
    if (l === null) { h.push(`«${n.name}»: el rango de lectura «${rango}» no es A<fila>:<letra> (no se puede comprobar)`); continue; }
    if (diag && l >= diag) h.push(`«${n.name}»: el rango «${rango}» llega a la letra ${diag} (diagnostico del equipo): puede llevar datos de salud y quedaria en el historial`);
    if (l > ultima) h.push(`«${n.name}»: el rango «${rango}» pasa de la ultima letra del bot (${ultima})`);
  }
  const st = (flujo && flujo.settings) || {};
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'none' || st.saveExecutionProgress !== false || st.saveManualExecutions !== false)
    h.push('la retencion de ejecuciones tiene que ser none (exito y error), sin progreso y sin guardar las manuales: el flujo lee y escribe la hoja del cliente');
  const enc = nodos.find((x) => x.name === NODO_ENCABEZADOS);
  if (enc) {
    const r = (((enc.parameters || {}).options || {}).dataLocationOnSheet || {}).values;
    if (!r || r.range !== rangoEncabezados(mapa)) h.push(`«${NODO_ENCABEZADOS}» tiene que leer exactamente ${rangoEncabezados(mapa)}`);
  }
  return h;
}
