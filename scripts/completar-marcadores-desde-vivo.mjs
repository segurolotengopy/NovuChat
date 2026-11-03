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
import { chmodSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MARCADOR = /REEMPLAZAR_[A-Z][^"\\\s]*/g;
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
  let patron = '';
  let resto = local;
  const orden = [];
  for (const m of marcas) {
    const i = resto.indexOf(m);
    patron += escapar(resto.slice(0, i)) + '([\\s\\S]*?)';
    orden.push(m);
    resto = resto.slice(i + m.length);
  }
  patron += escapar(resto);
  const r = new RegExp(`^${patron}$`).exec(vivo);
  if (!r) return null;
  const salida = {};
  for (let i = 0; i < orden.length; i++) {
    if (orden[i] in salida && salida[orden[i]] !== r[i + 1]) return null;
    salida[orden[i]] = r[i + 1];
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
  const nodosVivos = new Map((vivo.nodes ?? []).map((n) => [n.name, n]));
  for (const n of local.nodes ?? []) {
    const v = nodosVivos.get(n.name);
    const huecos = [];
    recorrer(n.parameters, v?.parameters, 'parameters', (_camino, textoLocal, textoVivo) => {
      for (const m of marcadoresDe(textoLocal)) vistos.add(m);
      const par = v === undefined ? null : emparejar(textoLocal, textoVivo);
      if (par === null) return;
      for (const [m, valor] of Object.entries(par)) {
        if (valor.includes('REEMPLAZAR_')) continue; // en el vivo también es un marcador: no es un valor
        if (m in resueltos && resueltos[m] !== valor) conflictos.add(m);
        else resueltos[m] = valor;
      }
    }, huecos);
  }
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
  const r = await buscar(`${base}/api/v1/workflows/${encodeURIComponent(env.N8N_WORKFLOW_ID)}`, { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Object.assign(new Error('n8n'), { code: `n8n-${r.status}` });
  return r.json();
}

export async function ejecutar({ local: rutaLocal, env: rutaEnv, aplicar = false }, { log = console.log, buscar = fetch } = {}) {
  const local = JSON.parse(readFileSync(rutaLocal, 'utf8'));
  const vivo = await leerFlujoVivo(rutaEnv, buscar);
  if (typeof local.name === 'string' && typeof vivo.name === 'string' && local.name !== vivo.name) {
    log('✗ el archivo y el flujo vivo no son el mismo flujo (el nombre difiere): no se repone nada.');
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
    const tmp = `${rutaLocal}.tmp`;
    writeFileSync(tmp, texto, { mode: 0o600 });
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
