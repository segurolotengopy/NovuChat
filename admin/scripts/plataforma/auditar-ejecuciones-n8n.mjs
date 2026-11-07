/**
 * AUDITAR LAS EJECUCIONES RECIENTES DE UN FLUJO DE n8n — SOLO LECTURA (07/11/2026).
 *
 * POR QUÉ. El 07/11/2026 dos imágenes de clientes de Q'Taco no dejaron rastro: una expresión rechazada por el sandbox de n8n
 * («Cannot access "prototype" due to security concerns») mató las ejecuciones. Este chequeo reúne, para UN flujo, lo que la API
 * de n8n sí puede mostrar: las ejecuciones con estado `error`, `crashed` o `canceled`, los nodos con `error` en sus datos y los
 * errores de expresión. Y avisa de lo que NO puede mostrar: si el flujo no guarda las ejecuciones con error
 * (`saveDataErrorExecution: none`), una falla no deja ejecución que listar; entonces la fuente es el log del contenedor de n8n.
 *
 *   node scripts/plataforma/auditar-ejecuciones-n8n.mjs --flujo <id del flujo> [--horas 24] [--limite 250] [--env <archivo>]
 *
 * SECRETOS Y DATOS. Lee N8N_BASE_URL y N8N_API_KEY del entorno (o de `--env`, las dos de la misma fuente; ver `leerEntornoN8n`).
 * Nunca imprime la clave, la URL, teléfonos ni contenido de mensajes: de cada ejecución sale su id, la hora, el estado, los NOMBRES
 * de los nodos con error y el mensaje de error con toda secuencia de 6 dígitos o más enmascarada y recortado a 160 caracteres.
 *
 * SOLO LECTURA: únicamente GET a `/api/v1/workflows/{id}`, `/api/v1/executions` y `/api/v1/executions/{id}`. 0 mensajes por conversación.
 * SALIDA. 0: nada que reportar. 1: hay ejecuciones con falla o el flujo no guarda las fallas. 2: uso. 3: no se pudo consultar.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { leerEntornoN8n } from './verificar-salida-persona.mjs';

const ESPERA_MS = 30_000;
const ESTADOS_DE_FALLA = ['error', 'crashed', 'canceled'];
const ID = /^[A-Za-z0-9]{1,64}$/;
export const USO = '  node scripts/plataforma/auditar-ejecuciones-n8n.mjs --flujo <id> [--horas 24] [--limite 250] [--env <archivo>]';

/** Un texto apto para imprimir: sin saltos, sin secuencias largas de dígitos (teléfonos, ids de Meta) y recortado. */
export function enmascarar(texto, max = 160) {
  return String(texto === undefined || texto === null ? '' : texto).replace(/\s+/g, ' ').replace(/\d{6,}/g, '######').trim().slice(0, max);
}

export function analizarArgumentos(argv) {
  const o = { flujo: '', horas: 24, limite: 250, env: '' };
  const problemas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--flujo') { o.flujo = String(v || ''); i++; }
    else if (a === '--horas') { o.horas = Number(v); i++; }
    else if (a === '--limite') { o.limite = Number(v); i++; }
    else if (a === '--env') { o.env = String(v || ''); i++; }
    else problemas.push(`opción desconocida: ${enmascarar(a, 40)}`);
  }
  if (!ID.test(o.flujo)) problemas.push('falta --flujo <id> (letras y números)');
  if (!(Number.isInteger(o.horas) && o.horas >= 1 && o.horas <= 24 * 14)) problemas.push('--horas va de 1 a 336');
  if (!(Number.isInteger(o.limite) && o.limite >= 1 && o.limite <= 2000)) problemas.push('--limite va de 1 a 2000');
  return { opciones: o, problemas };
}

/** Lo que se reporta de UNA ejecución con sus datos (`includeData=true`): nodos con error y mensajes, ya enmascarados. */
export function resumirEjecucion(ej) {
  const e = ej && typeof ej === 'object' ? ej : {};
  const data = e.data && typeof e.data === 'object' ? e.data : {};
  const rd = data.resultData && typeof data.resultData === 'object' ? data.resultData : {};
  const runData = rd.runData && typeof rd.runData === 'object' ? rd.runData : {};
  const nodos = [];
  for (const nombre of Object.keys(runData)) {
    const corridas = Array.isArray(runData[nombre]) ? runData[nombre] : [];
    for (const c of corridas) {
      if (c && c.error) nodos.push({ nodo: enmascarar(nombre, 80), mensaje: enmascarar(c.error.message || c.error.description || 'error') });
    }
  }
  const general = rd.error ? enmascarar(rd.error.message || 'error') : '';
  const expresion = [general, ...nodos.map((n) => n.mensaje)].some((m) => /security concerns|expression|expresi/i.test(m));
  return {
    id: enmascarar(e.id, 40), inicio: enmascarar(e.startedAt, 40), estado: enmascarar(e.status, 20),
    ultimoNodo: rd.lastNodeExecuted ? enmascarar(rd.lastNodeExecuted, 80) : '', error: general, nodos, errorDeExpresion: expresion,
  };
}

async function pedir(base, clave, ruta, buscar = fetch) {
  const r = await buscar(`${base}${ruta}`, { headers: { 'X-N8N-API-KEY': clave, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(ESPERA_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** La auditoría completa (inyectable para pruebas): devuelve `{ guardaFallas, ejecuciones, conFalla }`. */
export async function auditar({ base, clave, flujo, horas, limite, ahoraMs = Date.now(), buscar = fetch }) {
  const wf = await pedir(base, clave, `/api/v1/workflows/${flujo}`, buscar);
  const ajustes = (wf && wf.settings) || {};
  const guardaFallas = ajustes.saveDataErrorExecution !== 'none';
  const desde = ahoraMs - horas * 3_600_000;
  const lista = [];
  let cursor = '';
  while (lista.length < limite) {
    const q = new URLSearchParams({ workflowId: flujo, limit: String(Math.min(250, limite - lista.length)), includeData: 'false' });
    if (cursor) q.set('cursor', cursor);
    const pagina = await pedir(base, clave, `/api/v1/executions?${q}`, buscar);
    const datos = Array.isArray(pagina && pagina.data) ? pagina.data : [];
    lista.push(...datos);
    const viejo = datos.some((x) => Date.parse(x.startedAt) < desde);
    cursor = pagina && typeof pagina.nextCursor === 'string' ? pagina.nextCursor : '';
    if (!cursor || viejo || !datos.length) break;
  }
  const recientes = lista.filter((x) => !(Date.parse(x.startedAt) < desde));
  const conFalla = [];
  for (const x of recientes) {
    if (!ESTADOS_DE_FALLA.includes(String(x.status))) continue;
    let detalle = x;
    try { detalle = await pedir(base, clave, `/api/v1/executions/${encodeURIComponent(String(x.id))}?includeData=true`, buscar); } catch { /* sin datos: se reporta el estado */ }
    conFalla.push(resumirEjecucion(detalle));
  }
  return { guardaFallas, guardaExitos: ajustes.saveDataSuccessExecution !== 'none', ejecuciones: recientes.length, conFalla };
}

async function principal() {
  const { opciones, problemas } = analizarArgumentos(process.argv.slice(2));
  if (problemas.length) { console.error(`✗ ${problemas.join('; ')}\nUso:\n${USO}`); return 2; }
  const { base, clave } = leerEntornoN8n(opciones.env || undefined);
  if (!base || !clave) { console.error('✗ faltan N8N_BASE_URL o N8N_API_KEY válidas (https, host con nombre)'); return 3; }
  let r;
  try { r = await auditar({ base, clave, flujo: opciones.flujo, horas: opciones.horas, limite: opciones.limite }); }
  catch (e) { console.error(`✗ no se pudo consultar n8n: ${enmascarar(e && e.message, 80)}`); return 3; }
  console.log(`Flujo ${opciones.flujo}: ${r.ejecuciones} ejecuciones guardadas en las últimas ${opciones.horas} h; ${r.conFalla.length} con falla.`);
  if (!r.guardaFallas) console.log('⚠ el flujo NO guarda las ejecuciones con error (saveDataErrorExecution: none): una falla no deja ejecución; revise el log del contenedor de n8n.');
  if (!r.guardaExitos) console.log('ℹ el flujo no guarda las ejecuciones exitosas: el total de arriba no cuenta los mensajes atendidos.');
  for (const f of r.conFalla) {
    console.log(`✗ ${f.inicio} ejecución ${f.id} [${f.estado}]${f.errorDeExpresion ? ' ERROR DE EXPRESIÓN' : ''}${f.ultimoNodo ? ` último nodo «${f.ultimoNodo}»` : ''}${f.error ? `: ${f.error}` : ''}`);
    for (const n of f.nodos) console.log(`    · «${n.nodo}»: ${n.mensaje}`);
  }
  return r.conFalla.length || !r.guardaFallas ? 1 : 0;
}

const esPrincipal = (() => {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
})();
if (esPrincipal) principal().then((c) => process.exit(c), () => process.exit(3));
