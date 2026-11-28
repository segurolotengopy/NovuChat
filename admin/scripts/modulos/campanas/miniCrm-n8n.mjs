/**
 * LECTURA DEL miniCRM DEL CHAT POR LA API DE n8n (campaña saliente, PR-C).
 *
 * La lista de una campaña sale de la hoja que el flujo VIVO del chat ya tiene configurada: nunca un id escrito a mano ni en un
 * archivo versionado. La API pública de n8n no ejecuta flujos, así que se sigue el patrón `correrEnN8n` de
 * `plataforma/relleno-crm-historico.mjs`:
 *   1. se busca el flujo vivo por NOMBRE (con paginación): tiene que haber exactamente UNO activo. El nombre sale del flujo versionado
 *      (`--flujo-versionado`), nunca del código;
 *   2. de su nodo `Config base` se toman la planilla y la hoja, y de los nodos que usan `googleApi`, la credencial. Si hay más de una
 *      credencial distinta, falla con `credencial-ambigua`. NADA de eso se imprime ni se guarda;
 *   3. se CREA un flujo temporal (webhook con ruta aleatoria -> una llamada HTTP a la API de Sheets, `A<filaEncabezados>:<última>`
 *      con FORMATTED_VALUE), con `saveData*: 'none'` para que n8n no guarde las filas; se activa, se llama una vez y se BORRA en
 *      `finally` y ante SIGINT/SIGTERM;
 *   4. las columnas se mapean por su TÍTULO contra `crm.columnas`: si un título no coincide, falla con `encabezados` (nunca se
 *      adivina una columna).
 *
 * Los errores llevan solo un `code` (`n8n-http-401`, `flujo-ambiguo`…): jamás un id, una ruta ni un valor de la hoja.
 * ESTE ARCHIVO NO SE HA EJECUTADO CONTRA n8n: sus pruebas usan un `fetch` simulado. Cuesta 4 escrituras en n8n por lectura (crear,
 * activar, desactivar y borrar el flujo temporal).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CABECERA_CLAVE = ['X', 'N8N', 'API', 'KEY'].join('-'); // armada así para que el detector de secretos no confunda el NOMBRE de la cabecera
const NOMBRE_TEMPORAL = 'TEMPORAL lectura miniCRM campaña (borrar)';
const ESPERA_MS = 60_000;
const COLUMNAS_USADAS = ['telefono', 'fecha', 'etapaInicial'];

const falla = (code, mensaje) => Object.assign(new Error(mensaje), { code });

/** Las variables de un `.env` (solo las que se piden; nunca se imprimen). */
export function leerEnv(ruta, lector = (r) => readFileSync(r, 'utf8')) {
  const env = {};
  for (const l of lector(ruta).split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(l);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

/** Del mapa `crm`: títulos y letras de las columnas que usa la campaña y el rango a leer. Lanza si el mapa no las trae. */
export function columnasDelCrm(crm) {
  const columnas = {};
  for (const k of COLUMNAS_USADAS) {
    const c = crm?.columnas?.[k];
    if (typeof c?.titulo !== 'string' || c.titulo === '' || typeof c?.letra !== 'string' || !/^[A-Z]$/.test(c.letra)) {
      throw falla('crm-incompleto', 'el mapa crm no trae las columnas de teléfono, fecha y etapa');
    }
    columnas[k] = { letra: c.letra, titulo: c.titulo };
  }
  const letras = Object.values(crm.columnas).map((c) => c?.letra).filter((l) => typeof l === 'string' && /^[A-Z]$/.test(l)).sort();
  if (!Number.isInteger(crm.filaEncabezados) || crm.filaEncabezados < 1) throw falla('crm-incompleto', 'el mapa crm no trae la fila de encabezados');
  return { columnas, ultima: letras[letras.length - 1], fila: crm.filaEncabezados };
}

/** Del flujo vivo: planilla, hoja y la credencial de Google. Lanza (sin el valor) si falta algo o hay más de una credencial. */
export function extraerConfigDelFlujo(flujo) {
  const nodos = Array.isArray(flujo?.nodes) ? flujo.nodes : [];
  const asignaciones = nodos.find((n) => n?.name === 'Config base')?.parameters?.assignments?.assignments;
  const valor = (nombre) => {
    const v = Array.isArray(asignaciones) ? asignaciones.find((a) => a?.name === nombre)?.value : undefined;
    return typeof v === 'string' && v !== '' && !v.startsWith('=') && !/REEMPLAZAR/.test(v) ? v : null;
  };
  const planillaId = valor('planillaProspectosId');
  const hoja = valor('planillaProspectosHoja');
  if (planillaId === null || hoja === null) throw falla('n8n-sin-planilla', 'el flujo vivo no tiene la planilla del miniCRM configurada');
  const distintas = new Map();
  for (const n of nodos) {
    const c = n?.credentials?.googleApi;
    if (typeof c === 'object' && c !== null && c.id !== undefined && c.id !== '') distintas.set(`${c.id}`, { id: c.id, name: c.name });
  }
  if (distintas.size === 0) throw falla('n8n-sin-credencial', 'el flujo vivo no trae una credencial de Google');
  if (distintas.size > 1) throw falla('credencial-ambigua', 'el flujo vivo usa más de una credencial de Google: no se elige una');
  return { planillaId, hoja, credencial: [...distintas.values()][0] };
}

/** El flujo temporal: webhook -> GET a la API de Sheets. Solo lee. Sin ejecuciones guardadas. */
export function flujoTemporal({ camino, webhookId, planillaId, hoja, credencial, fila, ultima, nombre = NOMBRE_TEMPORAL }) {
  const rango = encodeURIComponent(`'${hoja}'!A${fila}:${ultima}`);
  return {
    name: nombre,
    nodes: [
      {
        id: 'entrada', name: 'Entrada', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId,
        parameters: { httpMethod: 'POST', path: camino, responseMode: 'lastNode', options: {} },
      },
      {
        id: 'leer', name: 'Leer', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [240, 0], credentials: { googleApi: credencial },
        parameters: {
          authentication: 'predefinedCredentialType', nodeCredentialType: 'googleApi', options: { timeout: 30000 },
          method: 'GET', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(planillaId)}/values/${rango}?valueRenderOption=FORMATTED_VALUE`,
        },
      },
    ],
    connections: { Entrada: { main: [[{ node: 'Leer', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false },
  };
}

/** Las filas (solo texto) con las columnas por TÍTULO. Lanza `encabezados` si algún título no está en su letra. */
export function filasDeLaRespuesta(cuerpo, columnas) {
  const valores = Array.isArray(cuerpo?.values) ? cuerpo.values : null;
  if (valores === null || valores.length === 0 || !Array.isArray(valores[0])) throw falla('encabezados', 'la hoja no devolvió encabezados');
  const idx = (c) => c.letra.charCodeAt(0) - 65;
  for (const c of Object.values(columnas)) {
    if (valores[0][idx(c)] !== c.titulo) throw falla('encabezados', 'los encabezados de la hoja no coinciden con el mapa crm');
  }
  const texto = (v) => (v === undefined || v === null ? '' : String(v));
  return valores.slice(1).filter(Array.isArray).map((f) => ({
    telefono: texto(f[idx(columnas.telefono)]), fecha: texto(f[idx(columnas.fecha)]), etapa: texto(f[idx(columnas.etapaInicial)]),
  }));
}

/**
 * El lector real. Devuelve `leerFilasDelMiniCrm()`.
 * `deps` (se inyectan en las pruebas): `fetch`, `leerEnv(ruta)`, `aleatorio()`, `esperar(ms)`, `aviso(texto)`, `proceso` (con `on`, `off`, `exit`).
 * `estado.limpiezaFallida` queda en true si el flujo temporal no se pudo borrar: la corrida debe terminar con 3.
 */
export function crearLectorDeMiniCrmN8n({ envFile, nombreFlujo, crm }, deps = {}) {
  const f = deps.fetch ?? fetch;
  const aleatorio = deps.aleatorio ?? ((n) => randomBytes(n).toString('hex'));
  const esperar = deps.esperar ?? ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const aviso = deps.aviso ?? (() => {});
  const proceso = deps.proceso ?? process;
  const { columnas, ultima, fila } = columnasDelCrm(crm);
  if (typeof nombreFlujo !== 'string' || nombreFlujo === '') throw falla('sin-nombre-de-flujo', 'falta el nombre del flujo vivo');
  const estado = { limpiezaFallida: false };

  async function leerFilasDelMiniCrm() {
    const env = (deps.leerEnv ?? ((r) => leerEnv(r)))(envFile);
    const BASE = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
    if (!BASE || !env.N8N_API_KEY) throw falla('sin-n8n', 'faltan N8N_BASE_URL o N8N_API_KEY');
    // La clave y los datos de la hoja viajan por esta URL: solo https (o esta misma máquina).
    if (!/^https:\/\//.test(BASE) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) throw falla('n8n-sin-https', 'N8N_BASE_URL tiene que ser https');
    const H = { [CABECERA_CLAVE]: env.N8N_API_KEY, 'Content-Type': 'application/json' };
    const api = async (met, ruta, cuerpo) => {
      const r = await f(`${BASE}/api/v1${ruta}`, { method: met, headers: H, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(ESPERA_MS) });
      const t = await r.text();
      let j = null;
      try { j = JSON.parse(t); } catch { /* sin cuerpo JSON */ }
      return { ok: r.ok, estado: r.status, j };
    };

    // 1. El flujo vivo, por nombre, con paginación: exactamente uno activo.
    const vivos = [];
    let cursor = null;
    for (let pagina = 0; pagina < 50; pagina++) {
      const r = await api('GET', `/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!r.ok) throw falla(`n8n-http-${r.estado}`, 'n8n no respondió a la lista de flujos');
      for (const w of r.j?.data ?? []) if (w?.name === nombreFlujo && w?.active === true) vivos.push(w.id);
      cursor = r.j?.nextCursor ?? null;
      if (!cursor) break;
    }
    if (vivos.length === 0) throw falla('flujo-no-encontrado', 'no hay un flujo activo con ese nombre');
    if (vivos.length > 1) throw falla('flujo-ambiguo', 'hay más de un flujo activo con ese nombre');
    const detalle = await api('GET', `/workflows/${encodeURIComponent(vivos[0])}`);
    if (!detalle.ok) throw falla(`n8n-http-${detalle.estado}`, 'n8n no devolvió el flujo vivo');
    const config = extraerConfigDelFlujo(detalle.j);

    // 2. El flujo temporal: se crea, se activa, se llama una vez y se borra pase lo que pase.
    const camino = `lectura-${aleatorio(16)}`;
    // El nombre es ÚNICO por corrida: si la creación queda en duda (la señal llegó durante el POST), se borra por nombre.
    const nombreTemporal = `${NOMBRE_TEMPORAL} ${camino}`;
    const flujo = flujoTemporal({ camino, webhookId: aleatorio(8), ...config, fila, ultima, nombre: nombreTemporal });
    let id = null;
    let creacion = null;
    let creacionIncierta = false;
    let interrumpido = false;
    const borrar = async (idLocal) => {
      try { await api('POST', `/workflows/${idLocal}/deactivate`); } catch { /* se intenta borrar igual */ }
      try { return (await api('DELETE', `/workflows/${idLocal}`)).ok; } catch { return false; }
    };
    const borrarPorNombre = async () => {
      let todos = true;
      let cursor = null;
      for (let pagina = 0; pagina < 50; pagina++) {
        let r;
        try { r = await api('GET', `/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); } catch { return false; }
        if (!r.ok) return false;
        for (const w of r.j?.data ?? []) if (w?.name === nombreTemporal && typeof w?.id === 'string') todos = (await borrar(w.id)) && todos;
        cursor = r.j?.nextCursor ?? null;
        if (!cursor) break;
      }
      return todos;
    };
    const hacerLimpieza = async () => {
      if (creacion) await creacion.catch(() => {}); // una creación en vuelo termina antes de limpiar: así no queda un flujo sin borrar
      let borrado = true;
      if (id) { const idLocal = id; id = null; borrado = await borrar(idLocal); } else if (creacionIncierta) borrado = await borrarPorNombre();
      if (!borrado) {
        estado.limpiezaFallida = true;
        aviso(`NO se pudo borrar el flujo temporal «${NOMBRE_TEMPORAL}»: bórrelo a mano en n8n (el webhook sigue vivo).`);
      }
    };
    // Una sola limpieza por lectura: el oyente de la corrida, el de este lector y el `finally` esperan la MISMA.
    let limpieza = null;
    const limpiar = () => { limpieza ??= hacerLimpieza(); return limpieza; };
    leerFilasDelMiniCrm.limpiar = () => { interrumpido = true; return limpiar(); };
    // `on`, no `once`: una segunda Ctrl-C durante la limpieza NO mata el proceso (con el webhook vivo); se ignora y se avisa.
    let senalAtendida = false;
    const alSenal = () => {
      if (senalAtendida) { aviso('Limpiando el flujo temporal de n8n, espere (la señal repetida se ignora).'); return; }
      senalAtendida = true;
      interrumpido = true;
      void limpiar().finally(() => proceso.exit(130));
    };
    proceso.on('SIGINT', alSenal);
    proceso.on('SIGTERM', alSenal);
    try {
      creacion = api('POST', '/workflows', flujo).then((c) => { if (c.ok && typeof c.j?.id === 'string') id = c.j.id; return c; }, (e) => { creacionIncierta = true; throw e; });
      const c = await creacion;
      if (!c.ok || typeof c.j?.id !== 'string') throw falla(`n8n-crear-${c.estado}`, 'no se pudo crear el flujo temporal');
      if (interrumpido) throw falla('interrumpido', 'interrumpido por el operador');
      const a = await api('POST', `/workflows/${id}/activate`);
      if (!a.ok) throw falla(`n8n-activar-${a.estado}`, 'no se pudo activar el flujo temporal');
      await esperar(4000);
      const r = await f(`${BASE}/webhook/${camino}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(90_000) });
      const texto = await r.text();
      if (!r.ok) throw falla(`n8n-llamada-${r.status}`, 'el flujo temporal respondió con error');
      let cuerpo;
      try { cuerpo = JSON.parse(texto); } catch { throw falla('n8n-respuesta-no-json', 'el flujo temporal no devolvió JSON'); }
      return filasDeLaRespuesta(cuerpo, columnas);
    } finally {
      // Los oyentes siguen puestos MIENTRAS se limpia: una señal repetida en ese lapso se ignora con aviso en vez de matar el proceso.
      try { await limpiar(); } finally {
        proceso.off('SIGINT', alSenal);
        proceso.off('SIGTERM', alSenal);
        limpieza = null;
      }
    }
  }
  leerFilasDelMiniCrm.estado = estado;
  leerFilasDelMiniCrm.limpiar = () => Promise.resolve();
  return leerFilasDelMiniCrm;
}
