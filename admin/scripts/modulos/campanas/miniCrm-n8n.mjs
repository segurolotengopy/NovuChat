/**
 * LECTURA DEL miniCRM DEL CHAT POR LA API DE n8n (campaña saliente, PR-C).
 *
 * La lista de una campaña sale de la hoja que el flujo VIVO del chat ya tiene configurada: nunca un id escrito a mano. Como la
 * API pública de n8n no ejecuta flujos, se hace así:
 *   1. se lee el flujo vivo (GET) y de su nodo `Config base` se toman el id de la planilla y el nombre de la hoja, y de un nodo
 *      Google Sheets su credencial. NADA de eso se imprime ni se guarda;
 *   2. se CREA un flujo temporal (webhook con ruta aleatoria -> lectura de la hoja), se activa, se llama una vez y se BORRA siempre
 *      (también si algo falla);
 *   3. con las filas en memoria, se mapean las columnas por su TÍTULO (el mapa `crm` de `datos/chat-novuchat/novuchat.json`).
 *
 * ESTE ARCHIVO NO SE HA EJECUTADO CONTRA n8n: sus pruebas usan un `fetch` simulado. Cuesta 2 escrituras en n8n por lectura (crear y
 * borrar el flujo temporal, más activarlo y desactivarlo). La ruta del webhook es URL de capacidad: se genera al vuelo y no se imprime.
 */
import { randomBytes } from 'node:crypto';

const CABECERA_CLAVE = ['X', 'N8N', 'API', 'KEY'].join('-');
const PREFIJO_TEMPORAL = 'tmp-campana-lectura-';
const ESPERA_MS = 60_000;

/** Los títulos de columna que usa la campaña, tomados del mapa `crm` del chat (nada de nombres escritos en el código). */
export function columnasDelCrm(crm) {
  const t = (c) => c?.titulo;
  const letras = [...Object.values(crm?.columnas ?? {}), crm?.equipo?.estado, crm?.equipo?.responsable, crm?.equipo?.proximaAccion]
    .map((c) => c?.letra).filter((l) => typeof l === 'string' && /^[A-Z]$/.test(l)).sort();
  const columnas = {
    telefono: t(crm?.columnas?.telefono), fecha: t(crm?.columnas?.fecha), etapa: t(crm?.columnas?.etapaInicial), estado: t(crm?.equipo?.estado),
  };
  if (Object.values(columnas).some((v) => typeof v !== 'string' || v === '') || letras.length === 0 || !Number.isInteger(crm?.filaEncabezados)) {
    throw new Error('el mapa crm no trae las columnas de teléfono, fecha, etapa y estado');
  }
  return { columnas, rango: `A${crm.filaEncabezados}:${letras[letras.length - 1]}` };
}

/** Del flujo vivo: planilla, hoja y credencial de Sheets. Lanza (sin el valor) si falta algo o es un marcador. */
export function extraerConfigDelFlujo(flujo) {
  const nodos = Array.isArray(flujo?.nodes) ? flujo.nodes : [];
  const config = nodos.find((n) => n?.name === 'Config base');
  const asignaciones = config?.parameters?.assignments?.assignments;
  const valor = (nombre) => {
    const v = Array.isArray(asignaciones) ? asignaciones.find((a) => a?.name === nombre)?.value : undefined;
    return typeof v === 'string' && v !== '' && !v.startsWith('=') && !/REEMPLAZAR/.test(v) ? v : null;
  };
  const planillaId = valor('planillaProspectosId');
  const hoja = valor('planillaProspectosHoja');
  const credencial = nodos.find((n) => n?.type === 'n8n-nodes-base.googleSheets' && n?.credentials?.googleApi)?.credentials?.googleApi;
  if (planillaId === null || hoja === null) throw Object.assign(new Error('el flujo vivo no tiene la planilla del miniCRM configurada'), { code: 'n8n-sin-planilla' });
  if (typeof credencial !== 'object' || credencial === null) throw Object.assign(new Error('el flujo vivo no trae una credencial de Google Sheets'), { code: 'n8n-sin-credencial' });
  return { planillaId, hoja, credencial };
}

/** El flujo temporal: webhook con respuesta de todas las filas -> lectura de la hoja. Solo lee; no escribe en la hoja. */
export function flujoTemporal({ ruta, planillaId, hoja, credencial, rango }) {
  return {
    name: `${PREFIJO_TEMPORAL}${ruta.slice(0, 8)}`,
    nodes: [
      {
        id: 'a1', name: 'Entrada', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: ruta,
        parameters: { httpMethod: 'POST', path: ruta, responseMode: 'lastNode', options: { responseData: 'allEntries' } },
      },
      {
        id: 'a2', name: 'Leer hoja', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [240, 0], credentials: { googleApi: credencial },
        parameters: {
          authentication: 'serviceAccount', resource: 'sheet', operation: 'read',
          documentId: { __rl: true, mode: 'id', value: planillaId },
          sheetName: { __rl: true, mode: 'name', value: hoja },
          options: {
            dataLocationOnSheet: { values: { rangeDefinition: 'specifyRangeA1', range: rango } },
            outputFormatting: { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } },
          },
        },
      },
    ],
    connections: { Entrada: { main: [[{ node: 'Leer hoja', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  };
}

/** Las filas del webhook, con las columnas por título (solo texto; lo que falte, vacío). */
export function filasDeLaRespuesta(cuerpo, columnas) {
  const items = Array.isArray(cuerpo) ? cuerpo : [];
  return items.filter((i) => typeof i === 'object' && i !== null).map((i) => ({
    telefono: i[columnas.telefono] ?? '', fecha: i[columnas.fecha] ?? '', etapa: i[columnas.etapa] ?? '', estado: i[columnas.estado] ?? '',
  }));
}

/**
 * El cliente real. Devuelve `leerFilasDelMiniCrm()`. `deps.fetch` y `deps.aleatorio` se inyectan en las pruebas; `deps.aviso` recibe
 * un texto sin valores si el borrado del flujo temporal falla (hay que revisar n8n a mano).
 */
export function crearLectorDeMiniCrmN8n({ baseUrl, apiKey, workflowId, crm }, deps = {}) {
  const f = deps.fetch ?? fetch;
  const aleatorio = deps.aleatorio ?? (() => randomBytes(24).toString('hex'));
  const aviso = deps.aviso ?? (() => {});
  const { columnas, rango } = columnasDelCrm(crm);
  let origen;
  try { origen = new URL(baseUrl); } catch { throw Object.assign(new Error('N8N_BASE_URL inválida'), { code: 'n8n-url-invalida' }); }
  if (origen.protocol !== 'https:' || origen.username || origen.password) throw Object.assign(new Error('N8N_BASE_URL tiene que ser https sin credenciales'), { code: 'n8n-url-invalida' });
  const base = origen.origin;
  const cab = { [CABECERA_CLAVE]: apiKey, 'Content-Type': 'application/json' };
  const llamar = async (metodo, ruta, cuerpo, conClave = true) => {
    const r = await f(`${base}${ruta}`, {
      method: metodo, headers: conClave ? cab : { 'Content-Type': 'application/json' }, redirect: 'error',
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!r.ok) throw Object.assign(new Error(`n8n respondió ${r.status}`), { code: `n8n-http-${r.status}` });
    const texto = await r.text();
    return texto === '' ? null : JSON.parse(texto);
  };

  return async function leerFilasDelMiniCrm() {
    const config = extraerConfigDelFlujo(await llamar('GET', `/api/v1/workflows/${workflowId}`));
    const ruta = aleatorio();
    const creado = await llamar('POST', '/api/v1/workflows', flujoTemporal({ ruta, ...config, rango }));
    const id = creado?.id;
    if (typeof id !== 'string' || id === '') throw Object.assign(new Error('n8n no devolvió el id del flujo temporal'), { code: 'n8n-sin-id' });
    try {
      await llamar('POST', `/api/v1/workflows/${id}/activate`, {});
      const cuerpo = await llamar('POST', `/webhook/${ruta}`, {}, false);
      return filasDeLaRespuesta(cuerpo, columnas);
    } finally {
      // Siempre se intenta desactivar y borrar; si no se logra, se avisa sin ruta ni valores.
      let borrado = false;
      try { await llamar('POST', `/api/v1/workflows/${id}/deactivate`, {}); } catch { /* el borrado lo intenta igual */ }
      try { await llamar('DELETE', `/api/v1/workflows/${id}`); borrado = true; } catch { /* se avisa abajo */ }
      if (!borrado) aviso(`NO se pudo borrar el flujo temporal «${PREFIJO_TEMPORAL}…» (id …${id.slice(-4)}): revíselo en n8n y bórrelo a mano`);
    }
  };
}
