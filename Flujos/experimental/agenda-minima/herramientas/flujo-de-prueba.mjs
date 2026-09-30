#!/usr/bin/env node
/**
 * =============================================================================
 * flujo-de-prueba.mjs — sube a n8n la variante de PRUEBA de Agenda mínima
 * =============================================================================
 *
 *   node flujo-de-prueba.mjs --env <.env> --estado <archivo>            en seco: qué haría
 *   node flujo-de-prueba.mjs --env <.env> --estado <archivo> --aplicar  crea y activa
 *   node flujo-de-prueba.mjs --env <.env> --estado <archivo> --borrar --aplicar
 *   node flujo-de-prueba.mjs --env <.env> --estado <archivo> --turno <carga.json>
 *
 * QUÉ SUBE: `agenda-minima.prueba.json`, que NO tiene disparador de WhatsApp
 * (activarlo le quitaría el webhook al flujo vivo de la app). Entra por un
 * Webhook de ruta al azar. Se niega a subir un JSON con un `whatsAppTrigger`.
 *
 * QUÉ NUNCA HACE: imprimir la clave de n8n, un identificador de credencial, el
 * id del calendario, el phone id ni la ruta del webhook. La clave va en una
 * cabecera de `fetch`, nunca en los argumentos de un proceso. La ruta del
 * webhook es una URL de capacidad: queda en `--estado`, un archivo FUERA del
 * repositorio (el scratchpad), con permisos 600.
 *
 * CREDENCIALES, por nombre (la API devuelve id, nombre y tipo, nunca valores):
 *   Gemini            -> «Gemini — pruebas (no producción)»   (nunca la de producción)
 *   Google Calendar   -> «Google Calendar account»            (la del Demo A)
 *   configuración     -> «Cierres NovuChat A (auto)»          (la ruta del Demo A apunta a `ensayo`)
 *   medios            -> «WhatsApp account»                   (la del Demo A)
 * La credencial de Graph para enviar no se resuelve: en la prueba el envío es
 * simulado y ese nodo no corre.
 *
 * CALENDARIO: el TERCER calendario del Demo A, leído del flujo vivo del Demo A
 * (`N8N_WORKFLOW_ID` del .env). Va al campo `calendarioForzado` de «Config base».
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(AQUI, '..', '..', '..', '..');
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const bandera = (n) => args.includes(`--${n}`);
const morir = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const ENV = opcion('env') ?? morir('falta --env <archivo .env del Demo A>');
const ESTADO = resolve(opcion('estado') ?? morir('falta --estado <archivo fuera del repositorio>'));
if ((ESTADO + sep).startsWith(REPO + sep)) morir('--estado tiene que estar FUERA del repositorio (lleva la ruta del webhook)');
const APLICAR = bandera('aplicar');
const NOMBRE = 'TEMPORAL — Agenda mínima (prueba, borrar)';

const CRED = {
  googlePalmApi: 'Gemini — pruebas (no producción)',
  googleCalendarOAuth2Api: 'Google Calendar account',
  httpHeaderAuth: { 'NovuChat ingesta (Bellido)': 'Cierres NovuChat A (auto)' },
  whatsAppApi: 'WhatsApp account',
};

/** Lee un .env sin ejecutarlo ni mostrarlo: solo las claves pedidas. */
function leerEnv(ruta, claves) {
  const out = {};
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || !claves.includes(m[1])) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const c of claves) if (!out[c]) morir(`el .env no tiene ${c}`);
  return out;
}
const env = leerEnv(ENV, ['N8N_BASE_URL', 'N8N_API_KEY', 'N8N_WORKFLOW_ID', 'WA_PHONE_ID']);
const API = `${env.N8N_BASE_URL.replace(/\/$/, '')}/api/v1`;

async function llamar(metodo, ruta, cuerpo) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let datos = {};
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { cod: r.status, datos };
}
const leerEstado = () => (existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : null);

// ---------------------------------------------------------------- un turno
if (opcion('turno')) {
  const est = leerEstado() ?? morir('no hay flujo de prueba: falta crearlo');
  const carga = JSON.parse(readFileSync(opcion('turno'), 'utf8'));
  // El phone id del Demo A entra acá, en memoria: la carga versionada lleva el marcador.
  const texto = JSON.stringify(carga).replaceAll('REEMPLAZAR_PHONE_NUMBER_ID', env.WA_PHONE_ID);
  const r = await fetch(`${env.N8N_BASE_URL.replace(/\/$/, '')}/webhook/${est.ruta}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: texto,
  });
  const cuerpo = await r.text();
  // La respuesta trae los mensajes del turno. Se tapan los dígitos largos por si algún nodo devuelve un id.
  // Se tapan los dígitos largos y la ruta DENTRO del objeto, para que la salida siga siendo JSON válido.
  const tapar = (v) => typeof v === 'string' ? v.replace(/\d{10,}/g, '<num>').replaceAll(est.ruta, '<ruta>')
    : typeof v === 'number' ? (Math.abs(v) >= 1e9 && Number.isInteger(v) && String(v).length >= 10 ? '<num>' : v)
    : Array.isArray(v) ? v.map(tapar)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tapar(x)])) : v;
  let respuesta; try { respuesta = JSON.parse(cuerpo); } catch { respuesta = cuerpo.slice(0, 2000); }
  console.log(JSON.stringify(tapar({ http: r.status, respuesta }), null, 1));
  process.exit(r.ok ? 0 : 1);
}

// ---------------------------------------------------------------- borrar
if (bandera('borrar')) {
  const est = leerEstado();
  const { datos } = await llamar('GET', '/workflows?limit=250');
  const temporales = (datos.data ?? []).filter((w) => w.name === NOMBRE);
  console.log(`Flujos temporales con el nombre «${NOMBRE}»: ${temporales.length}${est ? ' (hay archivo de estado)' : ''}`);
  if (!APLICAR) { console.log('En seco: no se borró nada. Agregue --aplicar.'); process.exit(0); }
  for (const w of temporales) {
    if (w.active) await llamar('POST', `/workflows/${w.id}/deactivate`);
    const r = await llamar('DELETE', `/workflows/${w.id}`);
    console.log(`  ${r.cod === 200 ? '✓ borrado' : `✗ ${r.cod}`}`);
  }
  if (est) writeFileSync(ESTADO, JSON.stringify({ borrado: new Date().toISOString() }));
  process.exit(0);
}

// ---------------------------------------------------------------- crear
const flujo = JSON.parse(readFileSync(join(AQUI, '..', 'agenda-minima.prueba.json'), 'utf8'));
if (flujo.nodes.some((n) => /whatsAppTrigger/i.test(n.type))) morir('el JSON de prueba trae un WhatsApp Trigger: no se sube');
const entradas = flujo.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
if (entradas.length !== 1) morir(`el JSON de prueba tiene ${entradas.length} Webhook(s); hace falta exactamente uno`);

// 1. credenciales por nombre
const credenciales = await llamar('GET', '/credentials?limit=250');
if (credenciales.cod !== 200) morir(`GET /credentials → ${credenciales.cod}`);
const porNombre = new Map((credenciales.datos.data ?? []).map((c) => [c.name, c]));
const resolver = (tipo, nombreEnElJson) => {
  const destino = typeof CRED[tipo] === 'string' ? CRED[tipo] : CRED[tipo]?.[nombreEnElJson];
  if (!destino) return null;
  const c = porNombre.get(destino);
  if (!c) morir(`no existe en n8n la credencial «${destino}» (${tipo})`);
  if (c.type !== tipo) morir(`«${destino}» existe con otro tipo (${c.type}), no ${tipo}`);
  return { id: c.id, name: c.name };
};
const resumen = [];
for (const n of flujo.nodes) {
  for (const [tipo, c] of Object.entries(n.credentials ?? {})) {
    const r = resolver(tipo, c.name);
    if (r) { n.credentials[tipo] = r; resumen.push(`  ${n.name}: ${tipo} → «${r.name}»`); }
    else { resumen.push(`  ${n.name}: ${tipo} «${c.name}» SIN resolver (el nodo no corre en la prueba)`); }
  }
}

// 2. el tercer calendario del Demo A, del flujo vivo
const vivo = await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`);
if (vivo.cod !== 200) morir(`GET del flujo vivo del Demo A → ${vivo.cod}`);
const calendarios = [...new Set(JSON.stringify(vivo.datos.nodes).match(/[A-Za-z0-9_.+-]+@group\.calendar\.google\.com/g) ?? [])];
if (calendarios.length < 3) morir(`el flujo vivo del Demo A nombra ${calendarios.length} calendario(s); hacen falta 3`);
const base = flujo.nodes.find((n) => n.name === 'Config base') ?? morir('el JSON no tiene el nodo «Config base»');
const textoBase = JSON.stringify(base.parameters);
if (!textoBase.includes('calendarioForzado')) morir('«Config base» no tiene el campo calendarioForzado');
const asignaciones = base.parameters.assignments?.assignments ?? [];
const campo = asignaciones.find((a) => a.name === 'calendarioForzado') ?? morir('no encuentro la asignación calendarioForzado en «Config base»');
campo.value = calendarios[2];

// 3. la ruta del webhook, al azar
const ruta = `am-${randomBytes(18).toString('hex')}`;
entradas[0].parameters.path = ruta;
entradas[0].webhookId = ruta;
const restos = JSON.stringify(flujo).match(/REEMPLAZAR_[A-Z0-9_]+/g) ?? [];
const restosUnicos = [...new Set(restos)].filter((m) => m !== 'REEMPLAZAR_PHONE_NUMBER_ID');

console.log(`Flujo   : ${NOMBRE} (${flujo.nodes.length} nodos, sin disparador de WhatsApp)`);
console.log('Credenciales:'); resumen.forEach((l) => console.log(l));
console.log(`Calendario: el tercero de ${calendarios.length} del Demo A → calendarioForzado (no se muestra)`);
console.log(`Webhook : ruta al azar (no se muestra), guardada en ${ESTADO}`);
if (restosUnicos.length) console.log(`Marcadores que quedan (se revisan uno por uno): ${restosUnicos.join(', ')}`);
if (!APLICAR) { console.log('\nEn seco: no se creó nada. Agregue --aplicar.'); process.exit(0); }

const previos = await llamar('GET', '/workflows?limit=250');
if ((previos.datos.data ?? []).some((w) => w.name === NOMBRE)) morir('ya hay un flujo temporal con ese nombre: bórrelo primero (--borrar --aplicar)');
const creado = await llamar('POST', '/workflows', {
  name: NOMBRE, nodes: flujo.nodes, connections: flujo.connections, settings: flujo.settings ?? { executionOrder: 'v1' },
});
if (![200, 201].includes(creado.cod)) morir(`POST /workflows → ${creado.cod}: ${JSON.stringify(creado.datos.message ?? creado.datos).slice(0, 400)}`);
writeFileSync(ESTADO, JSON.stringify({ id: creado.datos.id, ruta, creado: new Date().toISOString() }));
chmodSync(ESTADO, 0o600);
const activo = await llamar('POST', `/workflows/${creado.datos.id}/activate`);
if (activo.cod !== 200) morir(`el flujo se creó pero no se activó (${activo.cod}): ${JSON.stringify(activo.datos.message ?? '').slice(0, 300)}. Bórrelo con --borrar --aplicar`);
console.log('✓ creado y activo. Para un turno: --turno <carga.json>. Para borrarlo: --borrar --aplicar');
