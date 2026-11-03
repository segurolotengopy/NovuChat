#!/usr/bin/env node
/**
 * completar-marcadores-desde-vivo.mjs — repone los REEMPLAZAR_* que la tabla local NO tiene, tomando el valor del FLUJO VIVO.
 *
 * POR QUÉ EXISTE. `preparar-import.sh` repone los marcadores con la tabla de CONFIGURACION.local.md. Para las subcuentas
 * (Evy, Emma, Rubén, Antonio) la tabla solo tiene algunos (p. ej. el id de la planilla): faltan el phone id, la ruta del
 * receptor, los ids de medios, etc., que ya están puestos en el flujo VIVO. Publicar el JSON versionado sin ellos cambiaría la
 * configuración viva; esto hace que la publicación CONSERVE exactamente lo que ya corre y solo cambie lo versionado.
 *
 *   node scripts/completar-marcadores-desde-vivo.mjs --local <archivo.local.json> --env <.env del flujo> [--aplicar]
 *
 *   --local   la salida de preparar-import.sh (ya con los marcadores de la tabla repuestos). Se reescribe SOLO con --aplicar (0600).
 *   --env     el .env del flujo (N8N_BASE_URL, N8N_API_KEY y N8N_WORKFLOW_ID del flujo vivo); solo se LEE.
 *
 * CÓMO EMPAREJA. Por nombre de nodo y por la misma ruta dentro de `parameters`; en una lista de objetos con `name` (los
 * `assignments` de «Config base») por ese nombre, no por la posición. Si el texto versionado es el marcador solo, el valor es el
 * texto vivo; si el marcador va dentro de un texto, el valor es lo que ocupa su lugar en el texto vivo. Un marcador que no se
 * puede emparejar, que en el vivo sigue siendo un marcador, o que sale con dos valores distintos NO se repone (y se informa).
 *
 * LO QUE NUNCA HACE: imprimir un valor (solo nombres de marcador y cuántos), escribir en n8n (solo GET), ni pisar un marcador que la
 * tabla ya repuso. El archivo de salida lleva valores sensibles: está en .gitignore (`*.local.json`).
 * SALIDA. 0: no queda ningún marcador. 1: quedan marcadores sin valor. 2: uso o error.
 */
import { chmodSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ESTRICTO: solo el nombre (mayúsculas, dígitos y guion bajo). Lo que sigue (`/ruta`, `@dominio`) es texto literal. La regex amplia de preparar-import.sh
// puede dejar en el .local.json un «marcador» que ya lleva pegado un valor repuesto (una ruta secreta); este script nunca debe imprimirlo.
export const MARCADOR = /REEMPLAZAR_[A-Z][A-Z0-9_]*/g;
const MAX_MARCADORES_POR_TEXTO = 3;
const MAX_TEXTO_VIVO = 20_000;
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Los marcadores de un texto. */
export const marcadoresDe = (s) => (typeof s === 'string' ? s.match(MARCADOR) ?? [] : []);

/** El elemento vivo que corresponde a uno versionado dentro de una lista: por `name` si lo tiene, si no por posición. */
function parDeLista(local, i, vivo) {
  if (esObjeto(local[i]) && typeof local[i].name === 'string') return vivo.find((x) => esObjeto(x) && x.name === local[i].name);
  return vivo[i];
}

/** Recorre local y vivo a la par y llama a `hoja(rutaLocal, textoLocal, textoVivo)` por cada texto con marcador. */
function recorrer(local, vivo, camino, hoja, huecos) {
  if (typeof local === 'string') {
    if (marcadoresDe(local).length) hoja(camino, local, typeof vivo === 'string' ? vivo : undefined);
    return;
  }
  if (Array.isArray(local)) {
    if (!Array.isArray(vivo)) { huecos.push(camino); return; }
    local.forEach((x, i) => recorrer(x, parDeLista(local, i, vivo), `${camino}[${i}]`, hoja, huecos));
    return;
  }
  if (esObjeto(local)) {
    for (const [k, v] of Object.entries(local)) recorrer(v, esObjeto(vivo) ? vivo[k] : undefined, `${camino}.${k}`, hoja, huecos);
  }
}

/** Empareja un texto versionado con su texto vivo: devuelve { MARCADOR: valor } o null si no encajan. */
export function emparejar(local, vivo) {
  if (typeof vivo !== 'string') return null;
  const marcas = marcadoresDe(local);
  if (marcas.length === 1 && local === marcas[0]) return { [marcas[0]]: vivo };
  // Con muchos marcadores o un texto vivo enorme el emparejamiento por expresión regular puede ser ambiguo o lentísimo: no se repone.
  if (marcas.length > MAX_MARCADORES_POR_TEXTO || vivo.length > MAX_TEXTO_VIVO) return null;
  const armar = (grupo) => {
    let patron = '';
    let resto = local;
    for (const m of marcas) {
      const i = resto.indexOf(m);
      patron += escapar(resto.slice(0, i)) + grupo;
      resto = resto.slice(i + m.length);
    }
    return new RegExp(`^${patron}${escapar(resto)}$`);
  };
  const perezoso = armar('([\\s\\S]*?)').exec(vivo);
  if (!perezoso) return null;
  // Con 2 o más marcadores, la partición tiene que ser ÚNICA: si el emparejamiento perezoso y el codicioso reparten distinto, es ambiguo y no se repone.
  if (marcas.length > 1) {
    const codicioso = armar('([\\s\\S]*)').exec(vivo);
    if (!codicioso || codicioso.slice(1).some((v, i) => v !== perezoso[i + 1])) return null;
  }
  const salida = {};
  for (let i = 0; i < marcas.length; i++) {
    if (marcas[i] in salida && salida[marcas[i]] !== perezoso[i + 1]) return null;
    salida[marcas[i]] = perezoso[i + 1];
  }
  return salida;
}

/**
 * Del flujo local (con marcadores) y el vivo a { resueltos: {marcador: valor}, sinResolver: [marcadores], conflictos: [marcadores] }.
 * No modifica nada: `aplicarValores` hace el reemplazo.
 */
export function resolverDesdeVivo(local, vivo) {
  const resueltos = {};
  const vistos = new Set();
  const conflictos = new Set();
  const noEncajan = new Set(); // marcadores de un texto cuyo nodo SÍ existe en el vivo pero cuyo texto no encaja
  const nodosVivos = new Map((vivo.nodes ?? []).map((n) => [n.name, n]));
  for (const n of local.nodes ?? []) {
    const v = nodosVivos.get(n.name);
    recorrer(n.parameters, v?.parameters, 'parameters', (_camino, textoLocal, textoVivo) => {
      for (const m of marcadoresDe(textoLocal)) vistos.add(m);
      const par = v === undefined ? null : emparejar(textoLocal, textoVivo);
      if (par === null) { if (v !== undefined) for (const m of marcadoresDe(textoLocal)) noEncajan.add(m); return; }
      for (const [m, valor] of Object.entries(par)) {
        if (valor.includes('REEMPLAZAR_')) continue; // en el vivo también es un marcador: no es un valor
        if (m in resueltos && resueltos[m] !== valor) conflictos.add(m);
        else resueltos[m] = valor;
      }
    }, []);
  }
  // Un marcador que encaja en un lugar y no encaja en otro nodo vivo es ambiguo: no se repone.
  for (const m of noEncajan) if (m in resueltos) conflictos.add(m);
  for (const m of conflictos) delete resueltos[m];
  const sinResolver = [...vistos].filter((m) => !(m in resueltos) && !conflictos.has(m)).sort();
  return { resueltos, sinResolver, conflictos: [...conflictos].sort() };
}

/** Repone los valores en una copia del flujo local (solo en los textos de `parameters`; un marcador ya repuesto no está). */
export function aplicarValores(local, resueltos) {
  const copia = structuredClone(local);
  const reponer = (x) => {
    if (typeof x === 'string') return x.replace(MARCADOR, (m) => (m in resueltos ? resueltos[m] : m));
    if (Array.isArray(x)) return x.map(reponer);
    if (esObjeto(x)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, reponer(v)]));
    return x;
  };
  for (const n of copia.nodes ?? []) if (n.parameters) n.parameters = reponer(n.parameters);
  return copia;
}

function leerEnv(ruta) {
  const env = {};
  for (const l of readFileSync(ruta, 'utf8').split('\n')) { const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(l); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
  return env;
}

export async function leerFlujoVivo(envFile, buscar = fetch) {
  const env = leerEnv(envFile);
  const base = (env.N8N_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base || !env.N8N_API_KEY || !env.N8N_WORKFLOW_ID) throw Object.assign(new Error('faltan N8N_BASE_URL, N8N_API_KEY o N8N_WORKFLOW_ID'), { code: 'sin-env' });
  // La clave viaja en una cabecera propia: solo por https (o a esta misma máquina) y sin seguir redirecciones (no se la damos a otro host).
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(base)) throw Object.assign(new Error('url'), { code: 'n8n-sin-https' });
  const r = await buscar(`${base}/api/v1/workflows/${encodeURIComponent(env.N8N_WORKFLOW_ID)}`, { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Object.assign(new Error('n8n'), { code: `n8n-${r.status}` });
  const vivo = await r.json();
  return { ...vivo, __idEsperado: env.N8N_WORKFLOW_ID };
}

export async function ejecutar({ local: rutaLocal, env: rutaEnv, aplicar = false }, { log = console.log, buscar = fetch } = {}) {
  const local = JSON.parse(readFileSync(rutaLocal, 'utf8'));
  const vivo = await leerFlujoVivo(rutaEnv, buscar);
  // FALLA CERRADA: es la única defensa contra un --env equivocado (el phone id o la ruta de OTRO cliente). Los dos nombres tienen que existir y ser iguales.
  if (typeof local.name !== 'string' || typeof vivo.name !== 'string' || local.name !== vivo.name) {
    log('✗ el archivo y el flujo vivo no son el mismo flujo (el nombre falta o difiere): no se repone nada.');
    return 2;
  }
  if (local.id !== undefined && String(local.id) !== String(vivo.__idEsperado)) {
    log('✗ el id del archivo no es el del flujo vivo de este .env: no se repone nada.');
    return 2;
  }
  const { resueltos, sinResolver, conflictos } = resolverDesdeVivo(local, vivo);
  const nombres = Object.keys(resueltos).sort();
  log(`${aplicar ? 'COMPLETAR' : 'SECO'} · ${nombres.length} marcador(es) se pueden reponer desde el flujo vivo:`);
  for (const m of nombres) log(`  + ${m}${resueltos[m] === '' ? ' (vacío en el vivo)' : ''}`);
  for (const m of conflictos) log(`  ✗ ${m}: dos valores distintos en el vivo; no se repone`);
  for (const m of sinResolver) log(`  ✗ ${m}: no se pudo emparejar con el vivo`);
  if (aplicar && nombres.length) {
    const texto = `${JSON.stringify(aplicarValores(local, resueltos), null, 2)}\n`;
    // El temporal también termina en `.local.json` (ignorado por git) y se crea nuevo y exclusivo (0600) para no escribir sobre un enlace ni un archivo ajeno.
    const tmp = rutaLocal.replace(/(\.local)?\.json$/, '.tmp.local.json');
    if (tmp === rutaLocal) throw Object.assign(new Error('nombre'), { code: 'nombre-no-local' });
    try { unlinkSync(tmp); } catch { /* no existía */ }
    writeFileSync(tmp, texto, { mode: 0o600, flag: 'wx' });
    chmodSync(tmp, 0o600);
    renameSync(tmp, rutaLocal);
    log(`Reescrito (0600): ${rutaLocal}`);
  } else if (!aplicar) log('Seco: no se escribió nada. Agregue --aplicar para reponerlos.');
  return sinResolver.length || conflictos.length ? 1 : 0;
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  const a = process.argv.slice(2);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const conocidos = new Set(['--local', '--env', '--aplicar']);
  const raros = a.filter((x) => x.startsWith('--') && !conocidos.has(x));
  if (!val('--local') || !val('--env') || raros.length) {
    console.error('Uso: completar-marcadores-desde-vivo.mjs --local <archivo.local.json> --env <.env del flujo> [--aplicar]');
    process.exit(2);
  }
  try { process.exit(await ejecutar({ local: val('--local'), env: val('--env'), aplicar: a.includes('--aplicar') })); }
  catch (e) { console.error(`✗ error: ${e?.code ?? e?.name ?? 'desconocido'}`); process.exit(2); }
}
