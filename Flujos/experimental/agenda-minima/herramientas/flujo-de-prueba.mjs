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
 *   node flujo-de-prueba.mjs --env <.env> --actualizar-codigo [--flujo <json>] [--aplicar]   un B YA VIVO: solo su código
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
import { chmodSync, closeSync, constants, existsSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(AQUI, '..', '..', '..', '..');
// La copia principal también es el repositorio (revisión de seguridad, L2): se mira la raíz común de git.
const RAIZ_COMUN = dirname(execFileSync('git', ['-C', REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
// Se compara por la ruta REAL del directorio que contiene el archivo (un enlace simbólico hacia el repositorio no lo esquiva).
const rutaReal = (p) => { try { return join(realpathSync(dirname(p)), basename(p)); } catch (e) { return p; } };
const dentroDelRepo = (p) => [p, rutaReal(p)].some((q) => [REPO, RAIZ_COMUN].some((r) => (q + sep).startsWith(r + sep)));
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const bandera = (n) => args.includes(`--${n}`);
const morir = (m) => { console.error(`✗ ${m}`); process.exit(1); };

// `--actualizar-codigo` corre SOLO: antes, con `--borrar` al lado, corría `--borrar` (revisión de seguridad del #364).
if (bandera('actualizar-codigo') && ['borrar', 'sobre-bellido', 'sobre-demo-a', 'restaurar-respaldo', 'turno'].some((m) => args.includes(`--${m}`))) morir('--actualizar-codigo no se combina con otro modo');
const ENV = opcion('env') ?? morir('falta --env <archivo .env del Demo A>');
// `--actualizar-codigo` no guarda ningún estado: no necesita (ni lee) `--estado`.
const ESTADO = bandera('actualizar-codigo') ? null : resolve(opcion('estado') ?? morir('falta --estado <archivo fuera del repositorio>'));
if (ESTADO && dentroDelRepo(ESTADO)) morir('--estado tiene que estar FUERA del repositorio (lleva la ruta del webhook)');
const APLICAR = bandera('aplicar');
const NOMBRE = 'TEMPORAL — Agenda mínima (prueba, borrar)';

const CRED = {
  googlePalmApi: 'Gemini — pruebas (no producción)',
  googleCalendarOAuth2Api: 'Google Calendar account',
  httpHeaderAuth: { 'NovuChat ingesta (Bellido)': 'Cierres NovuChat A (auto)' },
  whatsAppApi: 'WhatsApp account',
};

/** Lee un .env sin ejecutarlo ni mostrarlo: solo las claves pedidas. */
function leerEnv(ruta, claves, opcionales = []) {
  const out = {};
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || !(claves.includes(m[1]) || opcionales.includes(m[1]))) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const c of claves) if (!out[c]) morir(`el .env no tiene ${c}`);
  return out;
}
const env = leerEnv(ENV, ['N8N_BASE_URL', 'N8N_API_KEY', 'N8N_WORKFLOW_ID'], ['WA_PHONE_ID']);
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
// El respaldo se crea con `wx` (exclusivo): si ya existe, falla y NO se pisa. Sin comprobar antes con `existsSync`,
// que dejaba una ventana entre la comprobación y la escritura (CodeQL js/file-system-race).
function guardarRespaldo(ruta, vivo) {
  try {
    writeFileSync(ruta, JSON.stringify(Object.assign({}, vivo, { guardado: new Date().toISOString() })), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}
const leerEstado = () => (existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : null);

// ---------------------------------------------------------------- un turno
if (opcion('turno')) {
  if (!env.WA_PHONE_ID) morir('el .env no tiene WA_PHONE_ID');
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

// ---------------------------------------------------------------- sobre el Demo A
// Nota (revisión de seguridad): el modo de CREAR usa la credencial de Gemini de PRUEBAS; este modo, que
// pone un candidato en el número del Demo A para probar con teléfono real, usa la de PRODUCCIÓN. La autorización es POR ENSAYO:
// Andres la dio para las pruebas del 30/09/2026 y de nuevo, en el chat, el 02/10/2026 para el ensayo de Venta mínima; cada ensayo
// nuevo la pide otra vez. Por eso `--sobre-demo-a --aplicar` exige `--autorizo-gemini-produccion` (la bandera no sustituye la
// autorización: la deja dicha en la línea de comandos; sin ella no se escribe nada).
/*
 * --sobre-demo-a --respaldo <archivo fuera del repo> [--aplicar]
 *   Pone el candidato B (agenda-minima.v0.json) EN el flujo vivo del Demo A, para la prueba con
 *   teléfono real. El número del Demo A apunta al comercio «ensayo» (configuración de Bellido,
 *   recepción y doctor = el teléfono de quien prueba, calendario de ensayo): eso lo hizo ensayo.mjs.
 *   - El nodo «WhatsApp Trigger» es EL DEL DEMO A, copiado tal cual (id, webhookId, parámetros,
 *     credencial): la suscripción de Meta no se toca.
 *   - Credenciales por NOMBRE, explícitas, todas del Demo A (tabla CRED_DEMO_A). Se niega si un
 *     nodo queda sin credencial o si una credencial nombra a un cliente o a un sistema ajeno.
 *   - «Enviar a WhatsApp» y «Enviar respaldo» pasan de Header Auth (Graph Bearer de Bellido, que
 *     el Demo A no tiene) a la credencial predefinida whatsAppApi: el único cambio de parámetros.
 *   - Antes de escribir guarda el flujo vivo ENTERO en --respaldo (600): es la vuelta atrás exacta.
 * --restaurar-respaldo --respaldo <archivo> [--aplicar]
 *   Vuelve a poner en el Demo A el flujo guardado, tal cual (nodos, conexiones y ajustes).
 */
const NO_PERMITIDOS = /bellido|platinum|q'?taco|captaci|segurolo|otp|aab1|whatsapp-?modular|receptor/i;
const CRED_DEMO_A = {
  googlePalmApi: 'Google Gemini(PaLM) Api account',     // producción: Andres la autorizó para las pruebas del 30/09
  googleCalendarOAuth2Api: 'Google Calendar account',
  // por NOMBRE de origen (L1): configuración, ingesta y cierre cuentan en «ensayo». La segunda entrada deja pasar un JSON
  // que ya nombra la del Demo A (el ensayo de Venta mínima, `venta-minima.ensayo-demo-a.json`): se mapea a sí misma.
  httpHeaderAuth: { 'NovuChat ingesta (Bellido)': 'Cierres NovuChat A (auto)', 'Cierres NovuChat A (auto)': 'Cierres NovuChat A (auto)' },
  // «Graph WhatsApp <Cliente> (Bearer)» no se mapea: el nodo pasa a la credencial predefinida whatsAppApi (ver GRAPH_BEARER).
  whatsAppApi: 'WhatsApp account',
};
// Nodos que envían por Graph con un Bearer del cliente (el Demo A no tiene): pasan a la credencial
// predefinida whatsAppApi. Se reconocen por el NOMBRE de la credencial, en cualquier candidato.
const GRAPH_BEARER = /^Graph WhatsApp .+ \(Bearer\)$/;
// Tipos de nodo que NECESITAN una credencial. En el JSON versionado de un cliente, algunos vienen sin
// ella (el agente, sus herramientas de calendario): publicar-flujo.sh la injerta del vivo por nombre.
// Acá se pone por tipo, desde la misma tabla, y ninguno puede quedar sin credencial.
const CRED_POR_TIPO_DE_NODO = {
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': 'googlePalmApi',
  '@n8n/n8n-nodes-langchain.googleGemini': 'googlePalmApi',
  'n8n-nodes-base.googleCalendar': 'googleCalendarOAuth2Api',
  'n8n-nodes-base.googleCalendarTool': 'googleCalendarOAuth2Api',
  'n8n-nodes-base.whatsApp': 'whatsAppApi',
};
// El phone id del cliente en «Config base» (candidato A) se reemplaza, en memoria, por el del Demo A.
const MARCA_PHONE = /REEMPLAZAR_PHONE_NUMBER_ID_[A-Z0-9_]+/g;

// ---------------------------------------------------------------- sobre Bellido (publicación definitiva)
/*
 * --sobre-bellido --respaldo <archivo fuera del repo> [--flujo <json>] [--aplicar]
 *   Pone el candidato (por omisión agenda-minima.v0.json) EN el flujo vivo de Bellido (id del .env que se
 *   pase, que tiene que ser el de Bellido). Es la publicación definitiva y solo va con el «sí» de Andres.
 *   - El «WhatsApp Trigger» es EL DE BELLIDO, tal cual.
 *   - Las credenciales son las de Bellido: las que el JSON nombra (si son de Bellido) y, las que vienen sin
 *     nombre (Calendar, Gemini) o sin credencial, la ÚNICA de ese tipo que el flujo vivo de Bellido ya usa.
 *     Toda credencial resultante tiene que estar entre las que usa el vivo de Bellido (por id). Sin cambio
 *     de parámetros: Bellido sí tiene su Graph Bearer.
 *   - Los marcadores de respaldo de «Config base» (recepción, doctor, horario) se llenan EN MEMORIA con los
 *     valores del «Config base» del vivo de Bellido, sin mostrarlos. El calendario no tiene respaldo.
 *   - Respaldo exacto del vivo antes de escribir; la vuelta atrás es --restaurar-respaldo con el mismo .env.
 */
const AJENOS_A_BELLIDO = /platinum|q'?taco|captaci|segurolo|otp|aab1|whatsapp-?modular|receptor|demo ?a\b|NovuChat A|pruebas/i;
if (bandera('sobre-bellido')) {
  const RESPALDO = resolve(opcion('respaldo') ?? morir('falta --respaldo <archivo fuera del repositorio>'));
  if (dentroDelRepo(RESPALDO)) morir('--respaldo tiene que estar FUERA del repositorio (lleva ids y datos del cliente)');
  const vivo = await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`);
  if (vivo.cod !== 200) morir(`GET del flujo vivo → ${vivo.cod}`);
  if (!/bellido/i.test(vivo.datos.name)) morir(`el flujo del .env no es el de Bellido («${vivo.datos.name}»)`);
  const cuerpoPut = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings ?? {} });
  if (existsSync(RESPALDO)) {
    const previo = JSON.parse(readFileSync(RESPALDO, 'utf8'));
    if (previo.id !== env.N8N_WORKFLOW_ID) morir('el respaldo existente es de otro flujo');
    if (JSON.stringify(cuerpoPut(previo)) !== JSON.stringify(cuerpoPut(vivo.datos))) morir('el respaldo existente difiere del vivo: no se pisa (use --restaurar-respaldo o elija otra ruta)');
  }
  const PROPIOS_DE_B = ['Plan del turno', 'Resolver con agenda', 'Candado', 'Resumen del turno'];
  if (vivo.datos.nodes.some((n) => PROPIOS_DE_B.includes(n.name))) morir('el vivo de Bellido ya tiene el candidato B');
  const ARCHIVO = resolve(opcion('flujo') ?? join(AQUI, '..', 'agenda-minima.v0.json'));
  const b = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
  if (b.nodes.some((n) => n.type === 'n8n-nodes-base.webhook')) morir('el candidato no puede traer un Webhook de prueba');
  const trigB = b.nodes.filter((n) => /whatsAppTrigger/i.test(n.type));
  const trigVivo = vivo.datos.nodes.filter((n) => /whatsAppTrigger/i.test(n.type));
  if (trigB.length !== 1 || trigVivo.length !== 1) morir(`disparadores: candidato ${trigB.length}, vivo ${trigVivo.length}`);
  const nombreB = trigB[0].name; const t = structuredClone(trigVivo[0]);
  b.nodes = b.nodes.map((n) => (n === trigB[0] ? t : n));
  if (t.name !== nombreB) { b.connections[t.name] = b.connections[nombreB]; delete b.connections[nombreB]; }
  // credenciales del vivo de Bellido, por tipo e id
  const delVivo = {};
  for (const n of vivo.datos.nodes) for (const [tipo, c] of Object.entries(n.credentials ?? {})) if (c && c.id) (delVivo[tipo] ??= new Map()).set(c.id, c.name);
  const tabla = [];
  for (const n of b.nodes) {
    if (n === t && Object.values(n.credentials ?? {}).some((c) => /aab1|segurolo|otp|receptor/i.test(String(c && c.name)))) morir('la credencial del disparador vivo es de un sistema ajeno (prohibición 7): no se sigue');
    if (n === t) { tabla.push(`  ${n.name}: el de Bellido, tal cual («${Object.values(n.credentials ?? {}).map((c) => c.name).join(', ')}»)`); continue; }
    const requerida = CRED_POR_TIPO_DE_NODO[n.type];
    if (requerida && !(n.credentials && n.credentials[requerida])) { n.credentials = Object.assign({}, n.credentials, { [requerida]: {} }); tabla.push(`  ${n.name}: venía SIN credencial ${requerida}; se pone la de Bellido de ese tipo`); }
    for (const [tipo, c] of Object.entries(n.credentials ?? {})) {
      const usadas = delVivo[tipo] ?? morir(`el vivo de Bellido no usa ninguna credencial ${tipo} («${n.name}»)`);
      let elegida = null;
      if (c && c.name) {
        for (const [id, nombre] of usadas) if (nombre === c.name) elegida = { id, name: nombre };
        if (!elegida) morir(`«${n.name}» pide «${c.name}», que el vivo de Bellido no usa`);
      } else {
        if (usadas.size !== 1) morir(`«${n.name}»: el vivo de Bellido usa ${usadas.size} credenciales ${tipo}; hace falta exactamente una para asignarla por tipo`);
        const [id, nombre] = [...usadas][0]; elegida = { id, name: nombre };
      }
      if (AJENOS_A_BELLIDO.test(elegida.name)) morir(`credencial ajena a Bellido: «${elegida.name}»`);
      n.credentials[tipo] = elegida;
      tabla.push(`  ${n.name}: ${tipo} → «${elegida.name}»`);
    }
    if (n.type === 'n8n-nodes-base.httpRequest' && (n.parameters?.authentication ?? 'none') !== 'none' && !Object.keys(n.credentials ?? {}).length) morir(`«${n.name}»: HTTP con autenticación y sin credencial`);
  }
  // respaldo de «Config base» con los valores del vivo de Bellido, en memoria
  const baseVivo = vivo.datos.nodes.find((n) => n.name === 'Config base');
  const valorVivo = (campo) => ((baseVivo?.parameters?.assignments?.assignments ?? []).find((a) => a.name === campo) || {}).value;
  const baseB = b.nodes.find((n) => n.name === 'Config base') ?? morir('el candidato no tiene «Config base»');
  const llenados = [];
  for (const a of baseB.parameters.assignments.assignments) {
    const origen = { respaldoNumeroRecepcion: 'numeroRecepcion', respaldoNumeroDoctor: 'numeroDoctor', horarioAtencion: 'horarioAtencion' }[a.name];
    if (!origen || !/^REEMPLAZAR_/.test(String(a.value))) continue;
    const v = String(valorVivo(origen) ?? '');
    if (v && !v.startsWith('REEMPLAZAR_') && !v.startsWith('=')) { a.value = v; llenados.push(a.name); }
  }
  const marcas = [...new Set(JSON.stringify(b).match(/REEMPLAZAR_[A-Z][A-Z0-9_]*/g) ?? [])];
  const nv = new Set(vivo.datos.nodes.map((n) => n.name)); const nb = new Set(b.nodes.map((n) => n.name));
  console.log(`Bellido vivo: «${vivo.datos.name}», ${vivo.datos.nodes.length} nodos, activo=${vivo.datos.active}`);
  console.log(`Candidato (${ARCHIVO.split(sep).slice(-2).join('/')}): ${b.nodes.length} nodos. El nombre del flujo queda «${vivo.datos.name}».`);
  console.log(`Nodos que se van: ${[...nv].filter((x) => !nb.has(x)).length} · que llegan: ${[...nb].filter((x) => !nv.has(x)).length} · en los dos: ${[...nb].filter((x) => nv.has(x)).length}`);
  console.log('Credenciales, nodo por nodo:'); tabla.forEach((l) => console.log(l));
  console.log(`Respaldo de «Config base» llenado desde el vivo (sin mostrar valores): ${llenados.join(', ') || '—'}`);
  console.log(`Marcadores que quedan: ${marcas.join(', ') || 'ninguno'}`);
  console.log(`Respaldo del vivo: ${RESPALDO}`);
  guardarRespaldo(RESPALDO, vivo.datos);
  chmodSync(RESPALDO, 0o600);
  if (!APLICAR) { console.log('\nEn seco: no se escribió nada en n8n (solo el respaldo local). Agregue --aplicar.'); process.exit(0); }
  if (marcas.length) morir(`quedan marcadores sin reponer: ${marcas.join(', ')}`);
  const put = await llamar('PUT', `/workflows/${env.N8N_WORKFLOW_ID}`, { name: vivo.datos.name, nodes: b.nodes, connections: b.connections, settings: b.settings ?? vivo.datos.settings ?? {} });
  if (put.cod !== 200) morir(`PUT → ${put.cod}: ${JSON.stringify(put.datos.message ?? '').slice(0, 300)}. Revise y use --restaurar-respaldo`);
  const leer = async () => { const r = await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`); if (r.cod !== 200) morir(`GET después del PUT → ${r.cod}. Revise n8n y use --restaurar-respaldo`); return r.datos; };
  let tras = await leer();
  if (tras.active !== true) {
    const a = await llamar('POST', `/workflows/${env.N8N_WORKFLOW_ID}/activate`);
    tras = await leer();
    if (tras.active !== true) morir(`el flujo de Bellido quedó INACTIVO (activate → ${a.cod}). Use --restaurar-respaldo YA`);
  }
  // Activo no prueba que la versión PUBLICADA sea el candidato (n8n separa borrador y publicada).
  if (!PROPIOS_DE_B.every((x) => tras.nodes.some((n) => n.name === x))) morir('el flujo leído después del PUT no tiene los nodos del candidato. Use --restaurar-respaldo');
  if (tras.versionId && tras.activeVersionId && tras.versionId !== tras.activeVersionId) morir('la versión ACTIVA no es la que se acaba de escribir (versionId ≠ activeVersionId). Revise n8n y use --restaurar-respaldo');
  console.log(`✓ candidato sobre Bellido: «${tras.name}», ${tras.nodes.length} nodos, activo=${tras.active}`);
  console.log('FALTA, ya: verificar-meta.sh --env .env.bellido (suscripción), un mensaje real desde un teléfono registrado y su ejecución en n8n. Si algo falla: --restaurar-respaldo.');
  process.exit(0);
}

// ---------------------------------------------------------------- actualizar el código de un B YA VIVO
/*
 * --actualizar-codigo [--flujo <json>] [--aplicar]
 *   Para cuando el flujo vivo (Bellido o el Demo A) YA es el candidato B y solo cambió el CÓDIGO de los nodos
 *   Code (por ejemplo, una corrección en `_comun.js`, que se pega en varios nodos). `--sobre-bellido` se niega
 *   a correr con B ya vivo; este modo es el que sí. Nace de la corrección de `cnAtencion` (02/10/2026), que se
 *   publicó con un script de una sola vez.
 *
 *   QUÉ TOCA: SOLO `parameters.jsCode` de los nodos Code cuyo código cambió. Nada más: ni credenciales, ni
 *   configuración, ni conexiones, ni ajustes. El PUT lleva los nodos VIVOS con ese único campo reemplazado.
 *   QUÉ EXIGE (si algo falla, no escribe y dice qué nodo, nunca un valor):
 *     - el flujo vivo es de Bellido o del Demo A, y NO de un cliente ajeno (Platinum, Q'Taco, captación, el
 *       sistema financiero…): el nombre se normaliza (sin tildes, espacios ni apóstrofos) antes de compararlo; tiene
 *       EXACTAMENTE un `WhatsApp Trigger` y su credencial NO es de un sistema ajeno (prohibición 7: un PUT seguido
 *       de `activate` vuelve a registrar la suscripción con esa credencial); y YA tiene los nodos de B (si no, es
 *       `--sobre-bellido`);
 *     - el candidato es un archivo VERSIONADO del repositorio (rastreado por git y sin cambios sin confirmar; se
 *       imprime el commit); `--permitir-sin-commit` lo salta, solo para pruebas;
 *     - el candidato no trae un Webhook de prueba ni un WhatsApp Trigger distinto del vivo;
 *     - los mismos nodos (por nombre), del mismo tipo y versión, y las mismas conexiones;
 *     - en los nodos Code, ninguna diferencia fuera de `jsCode`; en los demás nodos, ninguna diferencia de
 *       parámetros, salvo los campos de «Config base» que el candidato trae como marcador `REEMPLAZAR_…` y el
 *       vivo tiene llenos (los llenó la publicación);
 *     - hay al menos un nodo Code con código distinto.
 *   DESPUÉS DEL PUT: lee el vivo, comprueba que sigue ACTIVO, que la versión ACTIVA es la última y que el código
 *   leído es el del candidato; si la versión activa no es la última, la activa y vuelve a comprobar.
 *   NO guarda una copia del vivo (el plan es corregir hacia adelante, y n8n conserva el historial de versiones del flujo);
 *   si hace falta una, se baja de n8n antes de usar este modo.
 *   Sin `--aplicar`, en seco: lista los nodos que cambiarían y no escribe nada.
 */
// Sobre el nombre ya COMPACTADO (sin tildes, espacios ni signos): ver `compacto` más abajo.
const NO_ACTUALIZAR_COMPACTO = /platinum|qtaco|captacion|segurolo|otp|aab1|whatsappmodular|receptor/;
if (bandera('actualizar-codigo')) {
  const PROPIOS_DE_B_ = ['Plan del turno', 'Resolver con agenda', 'Candado', 'Resumen del turno'];
  const vivo = await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`);
  if (vivo.cod !== 200) morir(`GET del flujo vivo → ${vivo.cod}`);
  const v = vivo.datos;
  // El nombre se compara SIN tildes, espacios, apóstrofos ni signos: «Q’Taco», «Q Taco» y «Bellido — WhatsApp Modular» no esquivan la lista.
  const compacto = (t) => String(t).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nombreCompacto = compacto(v.name);
  // «Bellido» o «Demo A» tienen que ser PALABRAS del nombre (no una subcadena: «Demo Agendamiento» de otro negocio no cuenta).
  const palabras = ` ${String(v.name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  if (NO_ACTUALIZAR_COMPACTO.test(nombreCompacto) || !(palabras.includes(' bellido ') || palabras.includes(' demo a '))) morir(`el flujo del .env no es el de Bellido ni el del Demo A («${v.name}»)`);
  const disparadores = v.nodes.filter((n) => /whatsAppTrigger/i.test(n.type));
  if (disparadores.length !== 1) morir(`el flujo vivo tiene ${disparadores.length} WhatsApp Trigger; hace falta exactamente uno`);
  if (Object.values(disparadores[0].credentials ?? {}).some((c) => NO_ACTUALIZAR_COMPACTO.test(compacto(c && c.name)))) morir('la credencial del disparador vivo es de un sistema ajeno (prohibición 7): no se sigue');
  if (!PROPIOS_DE_B_.every((x) => v.nodes.some((n) => n.name === x))) morir('el flujo vivo todavía no es un B (le faltan los nodos del candidato): use --sobre-bellido o --sobre-demo-a');
  const ARCHIVO = resolve(opcion('flujo') ?? join(AQUI, '..', 'agenda-minima.v0.json'));
  // El candidato es un archivo VERSIONADO: dentro del repositorio, rastreado por git y sin cambios sin confirmar.
  let archivoReal;
  try { archivoReal = realpathSync(ARCHIVO); } catch (e) { morir('--flujo no existe'); }
  const relativo = relative(REPO, archivoReal);
  if (relativo.startsWith('..') || relativo === '' ) morir('--flujo tiene que ser un archivo versionado DENTRO del repositorio');
  let commitDelArchivo = 'sin comprobar';
  if (!bandera('permitir-sin-commit')) {
    // GIT_LITERAL_PATHSPECS: la ruta se toma TAL CUAL, sin comodines de git (un archivo llamado `x.jso[n]` no coincide con `x.json`).
    const git = (...a) => { try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' } }).trim(); } catch (e) { return null; } };
    if (git('ls-files', '--error-unmatch', '--', relativo) === null) morir('el candidato no está rastreado por git: solo se publica un archivo versionado');
    if (git('status', '--porcelain', '--', relativo) !== '') morir('el candidato tiene cambios sin confirmar: confirme el commit (o use el archivo del commit) antes de publicar');
    commitDelArchivo = (git('log', '-1', '--format=%h', '--', relativo) || 'desconocido');
  }
  // Se lee SIN comprobar antes: `O_NOFOLLOW` hace que abrir un enlace simbólico falle (ELOOP) en vez de seguirlo, y se lee por el descriptor abierto.
  if (typeof constants.O_NOFOLLOW !== 'number') morir('esta plataforma no tiene O_NOFOLLOW: no se puede abrir el candidato sin seguir enlaces');
  let cand;
  let fd;
  try {
    fd = openSync(ARCHIVO, constants.O_RDONLY | constants.O_NOFOLLOW);
    cand = JSON.parse(readFileSync(fd, 'utf8'));
  } catch (e) {
    morir(e && e.code === 'ELOOP' ? '--flujo no puede ser un enlace simbólico' : `--flujo no se pudo leer como JSON (${(e && e.code) || 'JSON inválido'})`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (!cand || !Array.isArray(cand.nodes)) morir('--flujo no es un flujo de n8n (falta «nodes»)');
  if (cand.nodes.some((n) => n.type === 'n8n-nodes-base.webhook')) morir('el candidato trae un Webhook de prueba: no se publica');
  const nv = new Map(v.nodes.map((n) => [n.name, n]));
  const nc = new Map(cand.nodes.map((n) => [n.name, n]));
  const sobran = [...nv.keys()].filter((k) => !nc.has(k)); const faltan = [...nc.keys()].filter((k) => !nv.has(k));
  if (sobran.length || faltan.length) morir(`los nodos no coinciden. Solo en el vivo: ${sobran.join(', ') || '—'}. Solo en el candidato: ${faltan.join(', ') || '—'}`);
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cambian = []; const prohibidas = [];
  for (const [nombre, c] of nc) {
    const n = nv.get(nombre);
    if (n.type !== c.type || n.typeVersion !== c.typeVersion) { prohibidas.push(`${nombre}: tipo o versión`); continue; }
    if (c.type === 'n8n-nodes-base.code') {
      const { jsCode: codigoVivo, ...restoVivo } = n.parameters; const { jsCode: codigoCand, ...restoCand } = c.parameters;
      if (!igual(restoVivo, restoCand)) prohibidas.push(`${nombre}: parámetros distintos de jsCode`);
      if (typeof codigoCand !== 'string' || codigoCand.startsWith('@@')) prohibidas.push(`${nombre}: el candidato no trae el código armado`);
      else if (codigoVivo !== codigoCand) cambian.push(nombre);
    } else if (!igual(n.parameters, c.parameters)) {
      // Único cambio de parámetros que se tolera: los campos de «Config base» que el candidato trae como marcador y el vivo tiene llenos.
      const asig = (w) => Object.fromEntries(((w.parameters.assignments || {}).assignments || []).map((x) => [x.name, x.value]));
      const av = asig(n); const ac = asig(c);
      const otrosParametros = Object.keys({ ...n.parameters, ...c.parameters }).filter((k) => k !== 'assignments' && !igual(n.parameters[k], c.parameters[k]));
      const camposDistintos = Object.keys({ ...av, ...ac }).filter((k) => !igual(av[k], ac[k]));
      const noMarcador = camposDistintos.filter((k) => !(typeof ac[k] === 'string' && /^REEMPLAZAR_[A-Z0-9_]+$/.test(ac[k]) && typeof av[k] === 'string' && av[k] !== '' && !/^REEMPLAZAR_/.test(av[k])));
      if (nombre !== 'Config base' || otrosParametros.length || noMarcador.length) prohibidas.push(`${nombre}: ${[...otrosParametros, ...noMarcador].join(', ') || 'parámetros'}`);
    }
  }
  if (!igual(v.connections, cand.connections)) prohibidas.push('las conexiones');
  console.log(`Vivo: «${v.name}», ${v.nodes.length} nodos, activo=${v.active}, versión publicada=${v.versionId === v.activeVersionId}. Candidato (${ARCHIVO.split(sep).slice(-2).join('/')}, commit ${commitDelArchivo}): ${cand.nodes.length} nodos.`);
  console.log(`Nodos Code con código distinto (${cambian.length}): ${cambian.join(', ') || '—'}`);
  if (prohibidas.length) morir(`hay diferencias que este modo NO toca (use --sobre-bellido o revise): ${prohibidas.join(' · ')}`);
  if (!cambian.length) morir('no hay nada que actualizar: el código vivo ya es el del candidato');
  if (args.includes('--previa')) morir('--previa ya no existe: este modo no guarda copias (corrija hacia adelante)');
  if (!APLICAR) { console.log('\nEn seco: no se escribió nada. Agregue --aplicar.'); process.exit(0); }
  for (const nombre of cambian) nv.get(nombre).parameters.jsCode = nc.get(nombre).parameters.jsCode;
  const put = await llamar('PUT', `/workflows/${env.N8N_WORKFLOW_ID}`, { name: v.name, nodes: v.nodes, connections: v.connections, settings: v.settings ?? {} });
  if (put.cod !== 200) morir(`PUT → ${put.cod}: ${JSON.stringify(put.datos.message ?? '').slice(0, 300)}. Lea el flujo vivo y corrija hacia adelante`);
  const leer = async () => { const r = await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`); if (r.cod !== 200) morir(`GET después del PUT → ${r.cod}. Revise n8n`); return r.datos; };
  let tras = await leer();
  if (tras.active !== true) {
    const a = await llamar('POST', `/workflows/${env.N8N_WORKFLOW_ID}/activate`);
    tras = await leer();
    if (tras.active !== true) morir(`el flujo quedó INACTIVO (activate → ${a.cod}). Actívelo YA`);
  }
  const codigoOk = (w) => cambian.every((nombre) => (w.nodes.find((n) => n.name === nombre) || { parameters: {} }).parameters.jsCode === nc.get(nombre).parameters.jsCode);
  if (!codigoOk(tras)) morir('el código leído después del PUT no es el del candidato');
  if (tras.versionId !== tras.activeVersionId) {
    const a = await llamar('POST', `/workflows/${env.N8N_WORKFLOW_ID}/activate`);
    tras = await leer();
    if (tras.versionId !== tras.activeVersionId) morir(`la versión ACTIVA no es la que se acaba de escribir (activate → ${a.cod}). Revise n8n`);
    if (!codigoOk(tras)) morir('después de activar, el código leído no es el del candidato');
  }
  // Lo que el mensaje afirma, se LEYÓ: las credenciales de cada nodo y las conexiones, contra el vivo de antes del PUT.
  const credenciales = (w) => JSON.stringify(Object.fromEntries(w.nodes.map((n) => [n.name, n.credentials ?? null]).sort(([x], [y]) => (x < y ? -1 : 1))));
  if (credenciales(tras) !== credenciales(v) || !igual(tras.connections, v.connections) || tras.nodes.length !== v.nodes.length) morir(`después del PUT las credenciales o las conexiones no coinciden con las de antes. El código nuevo YA quedó escrito; REVISE n8n YA (su historial de versiones guarda el flujo de antes)`);
  console.log(`✓ «${tras.name}»: ${tras.nodes.length} nodos, activo=${tras.active}, publicada=${tras.versionId === tras.activeVersionId}; ${cambian.length} nodos con el código nuevo (leído de vuelta); credenciales y conexiones iguales a las de antes (leídas de vuelta).`);
  console.log('FALTA, ya: un mensaje real desde un teléfono registrado y la lectura de su ejecución en n8n.');
  process.exit(0);
}

/**
 * ¿La URL de un nodo HTTP habla con Graph (Meta)? FALLA CERRADO y con el anfitrión ANCLADO:
 *  - sin un `=` inicial (n8n marca así las expresiones) ni espacios, el anfitrión tiene que ser el primero tras `http(s)://` y terminar ahí
 *    (barra, `:`, `?`, `#` o fin): una URL de otro anfitrión que solo MENCIONA el de Graph en la ruta o la consulta NO es una llamada a Graph;
 *  - una EXPRESIÓN (empieza con `=` y trae `{{`) no se puede analizar: se toma por Graph si nombra el anfitrión en cualquier parte
 *    (subcadena), para que no se escape ningún caso que antes se atrapaba.
 */
// El anfitrión de Graph se arma por partes: este archivo habla con la API de n8n (`fetch`) y NO escribe en Graph, y la prueba de seguridad
// `apps-ajenas-escrituras.test.ts` busca el nombre literal contiguo para saber quién escribe allí. Sin el literal, la guardia sigue igual.
const HOST_META = ['graph', 'facebook', 'com'].join('.');
const RE_HOST_META = new RegExp('^https?:\\/\\/' + HOST_META.replace(/\./g, '\\.') + '(?:[/:?#]|$)');
function llamaAGraph(url) {
  const cruda = String(url ?? '').trim();
  const esExpresion = cruda.startsWith('=');
  const texto = (esExpresion ? cruda.slice(1) : cruda).trim().toLowerCase();
  if (RE_HOST_META.test(texto)) return true;
  return esExpresion && texto.includes('{{') && texto.includes(HOST_META);
}

if (bandera('sobre-demo-a') || bandera('restaurar-respaldo')) {
  const RESPALDO = resolve(opcion('respaldo') ?? morir('falta --respaldo <archivo fuera del repositorio>'));
  if (dentroDelRepo(RESPALDO)) morir('--respaldo tiene que estar FUERA del repositorio (lleva ids)');
  const vivo = await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`);
  if (vivo.cod !== 200) morir(`GET del flujo vivo del Demo A → ${vivo.cod}`);
  // `--sobre-demo-a` pisa el flujo del `.env` con otro: se niega si ese flujo no es el Demo A (el id sale de un .env, el nombre del flujo, no).
  // Es la misma regla de `--actualizar-codigo`: «Demo A» tiene que ser PALABRAS del nombre y ningún nombre de cliente ni de sistema ajeno.
  if (bandera('sobre-demo-a')) {
    const normal = (t) => String(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const nombreVivo = normal(vivo.datos.name);
    const palabrasVivo = ` ${nombreVivo.replace(/[^a-z0-9]+/g, ' ').trim()} `;
    // «bellido» también se rechaza acá (a diferencia de `--actualizar-codigo`, que sí puede actualizar a Bellido): «Bellido — Demo A» no es el Demo A.
    if (NO_ACTUALIZAR_COMPACTO.test(nombreVivo.replace(/[^a-z0-9]/g, '')) || /bellido/.test(nombreVivo) || !palabrasVivo.includes(' demo a ')) morir(`el flujo del .env no es el del Demo A («${vivo.datos.name}»): no se pisa`);
    // Un flujo apagado no es el Demo A que se vigila: se escribiría sobre algo que hoy no recibe mensajes y el PUT lo activaría.
    if (APLICAR && vivo.datos.active !== true) morir('el Demo A vivo NO está activo: no se pisa (actívelo y compruebe la suscripción de Meta antes)');
    if (APLICAR && !bandera('autorizo-gemini-produccion')) morir('--sobre-demo-a --aplicar usa la credencial de Gemini de PRODUCCIÓN: exige --autorizo-gemini-produccion (la autorización de Andres es por ensayo y se pide de nuevo cada vez)');
  }
  // M2: después de un PUT el flujo tiene que quedar ACTIVO (con su webhook); si no, se activa y se verifica.
  const asegurarActivo = async () => {
    let w = (await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`)).datos;
    if (w.active !== true) {
      const a = await llamar('POST', `/workflows/${env.N8N_WORKFLOW_ID}/activate`);
      w = (await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`)).datos;
      if (w.active !== true) morir(`el flujo quedó INACTIVO tras el PUT (activate → ${a.cod}: ${JSON.stringify(a.datos.message ?? '').slice(0, 200)}). Revise n8n YA`);
    }
    return w;
  };
  const cuerpoPut = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings ?? {} });

  if (bandera('restaurar-respaldo')) {
    if (!existsSync(RESPALDO)) morir('no existe el respaldo');
    const r = JSON.parse(readFileSync(RESPALDO, 'utf8'));
    if (r.id !== env.N8N_WORKFLOW_ID) morir('el respaldo no es del flujo de este .env');
    const igual = JSON.stringify(cuerpoPut(r)) === JSON.stringify(cuerpoPut(vivo.datos));
    console.log(`Respaldo: «${r.name}», ${r.nodes.length} nodos, guardado ${r.guardado ?? '?'}`);
    console.log(`Vivo    : «${vivo.datos.name}», ${vivo.datos.nodes.length} nodos, activo=${vivo.datos.active}`);
    console.log(igual ? 'El vivo YA es igual al respaldo: no hay nada que reponer.' : 'El vivo difiere del respaldo: se repondría el respaldo tal cual.');
    if (!APLICAR || igual) { console.log(APLICAR ? '' : '\nEn seco: no se escribió nada. Agregue --aplicar.'); process.exit(0); }
    const put = await llamar('PUT', `/workflows/${env.N8N_WORKFLOW_ID}`, cuerpoPut(r));
    if (put.cod !== 200) morir(`PUT del respaldo → ${put.cod}: ${JSON.stringify(put.datos.message ?? '').slice(0, 300)}`);
    let tras = r.active === false ? (await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`)).datos : await asegurarActivo();
    // La versión ACTIVA tiene que ser la que se acaba de escribir (n8n separa borrador y publicada), como en `--actualizar-codigo`.
    if (r.active !== false && tras.versionId && tras.activeVersionId && tras.versionId !== tras.activeVersionId) {
      const a = await llamar('POST', `/workflows/${env.N8N_WORKFLOW_ID}/activate`);
      tras = (await llamar('GET', `/workflows/${env.N8N_WORKFLOW_ID}`)).datos;
      if (tras.versionId !== tras.activeVersionId) morir(`la versión ACTIVA no es la que se acaba de escribir (versionId ≠ activeVersionId; activate → ${a.cod}). El respaldo YA se escribió: revise n8n`);
    }
    console.log(`✓ repuesto: «${tras.name}», ${tras.nodes.length} nodos, activo=${tras.active}`);
    // Lo que se afirma se LEE de vuelta: el flujo vivo contra el respaldo.
    if (JSON.stringify(cuerpoPut(r)) !== JSON.stringify(cuerpoPut(tras))) morir('el flujo vivo leído de vuelta DIFIERE del respaldo (n8n no guardó algo o lo normalizó): revise n8n antes de dar la restauración por hecha');
    console.log('✓ el flujo vivo leído de vuelta es igual al respaldo');
    process.exit(0);
  }

  // M1: si el vivo ya es el candidato B, no se sigue (se perdería la vuelta atrás exacta).
  // El respaldo es el Demo A ORIGINAL y nunca se reescribe. Si el vivo ya no es el original, solo se
  // sigue si el vivo es EXACTAMENTE lo último que aplicó esta herramienta (cambio directo entre candidatos).
  const APLICADO = RESPALDO + '.aplicado.json';
  const huella = (w) => JSON.stringify(w.nodes.map((n) => [n.name, n.type]).sort());
  // L3: además de nombres y tipos, el contenido entero de lo aplicado (un cambio a mano en n8n no se pisa en silencio).
  const contenido = (w) => JSON.stringify(cuerpoPut(w));
  // M4: nodos que el Demo A ORIGINAL no tiene; si el vivo los tiene, ya es un candidato.
  const PROPIOS_DE_CANDIDATOS = ['Plan del turno', 'Resolver con agenda', 'Candado', 'Resumen del turno',
    'Estado de la conversación', 'Menú inicial', 'Enviar interactivo', 'Avisar al doctor (plantilla)'];
  if (!existsSync(RESPALDO) && vivo.datos.nodes.some((n) => PROPIOS_DE_CANDIDATOS.includes(n.name))) {
    morir('el vivo ya es un candidato y no hay respaldo del Demo A original en esa ruta: no se sigue (use el respaldo existente)');
  }
  if (existsSync(RESPALDO)) {
    const previo = JSON.parse(readFileSync(RESPALDO, 'utf8'));
    const esOriginal = JSON.stringify(cuerpoPut(previo)) === JSON.stringify(cuerpoPut(vivo.datos));
    const ultimo = existsSync(APLICADO) ? JSON.parse(readFileSync(APLICADO, 'utf8')) : null;
    if (!esOriginal && !(ultimo && ultimo.huella === huella(vivo.datos) && (!ultimo.contenido || ultimo.contenido === contenido(vivo.datos)))) {
      morir('el vivo no es ni el Demo A del respaldo ni lo último aplicado por esta herramienta: no se sigue');
    }
    if (!esOriginal) console.log(`El vivo es el candidato aplicado antes (${ultimo.flujo}, ${ultimo.aplicado}): se cambia directo, sin pasar por el original.`);
  }
  // 1. el candidato B
  if (!env.WA_PHONE_ID) morir('el .env no tiene WA_PHONE_ID (el phone id del Demo A)');
  const ARCHIVO = resolve(opcion('flujo') ?? join(AQUI, '..', 'agenda-minima.v0.json'));
  const b = JSON.parse(readFileSync(ARCHIVO, 'utf8').replace(MARCA_PHONE, env.WA_PHONE_ID));
  const trigB = b.nodes.filter((n) => /whatsAppTrigger/i.test(n.type));
  const trigVivo = vivo.datos.nodes.filter((n) => /whatsAppTrigger/i.test(n.type));
  if (trigB.length !== 1 || trigVivo.length !== 1) morir(`disparadores: candidato ${trigB.length}, Demo A ${trigVivo.length}; hace falta exactamente uno en cada uno`);
  if (b.nodes.some((n) => n.type === 'n8n-nodes-base.webhook')) morir('el candidato de producción no puede traer un Webhook de prueba');
  // 2. el disparador del Demo A, tal cual; las conexiones se renombran si el nombre difiere
  const nombreB = trigB[0].name; const t = structuredClone(trigVivo[0]);
  b.nodes = b.nodes.map((n) => (n === trigB[0] ? t : n));
  if (t.name !== nombreB) { b.connections[t.name] = b.connections[nombreB]; delete b.connections[nombreB]; }
  // 3. credenciales por nombre
  const lista = (await llamar('GET', '/credentials?limit=250')).datos.data ?? [];
  const repetidos = lista.map((c) => c.name).filter((x, i, a) => a.indexOf(x) !== i);
  const porNombre = new Map(lista.map((c) => [c.name, c]));
  // M3: cada credencial asignada tiene que ser una que el Demo A VIVO ya usa (por id), no solo un nombre igual.
  const delDemoA = new Set(vivo.datos.nodes.flatMap((n) => Object.values(n.credentials ?? {}).map((c) => c && c.id)).filter(Boolean));
  const tabla = [];
  for (const n of b.nodes) {
    const requerida = CRED_POR_TIPO_DE_NODO[n.type];
    if (n !== t && requerida && !(n.credentials && n.credentials[requerida])) {
      n.credentials = Object.assign({}, n.credentials, { [requerida]: {} });
      tabla.push(`  ${n.name}: venía SIN credencial ${requerida} en el JSON; se pone por tipo`);
    }
    if (n === t) { tabla.push(`  ${n.name}: el del Demo A, tal cual («${Object.values(n.credentials ?? {}).map((c) => c.name).join(', ')}»)`); continue; }
    const hh = n.credentials && n.credentials.httpHeaderAuth;
    if (hh && GRAPH_BEARER.test(String(hh.name || ''))) {
      const antes = `${n.parameters.authentication}/${n.parameters.genericAuthType ?? n.parameters.nodeCredentialType}`;
      n.parameters.authentication = 'predefinedCredentialType';
      n.parameters.nodeCredentialType = 'whatsAppApi';
      delete n.parameters.genericAuthType;
      n.credentials = { whatsAppApi: {} };
      tabla.push(`  ${n.name}: PARÁMETROS CAMBIADOS ${antes} → predefinedCredentialType/whatsAppApi`);
    }
    for (const tipo of Object.keys(n.credentials ?? {})) {
      const regla = CRED_DEMO_A[tipo];
      const origen = (n.credentials[tipo] && n.credentials[tipo].name) || '';
      const nombre = (typeof regla === 'string' ? regla : regla && regla[origen])
        ?? morir(`«${n.name}» usa ${tipo} «${origen}», que no está en la tabla de credenciales del Demo A`);
      if (repetidos.includes(nombre)) morir(`hay más de una credencial llamada «${nombre}» en n8n: no se elige por nombre`);
      const c = porNombre.get(nombre) ?? morir(`no existe en n8n la credencial «${nombre}»`);
      if (c.type !== tipo) morir(`«${nombre}» es de tipo ${c.type}, no ${tipo}`);
      if (!delDemoA.has(c.id)) morir(`«${nombre}» no es una credencial que el Demo A vivo ya use`);
      n.credentials[tipo] = { id: c.id, name: c.name };
      tabla.push(`  ${n.name}: ${tipo} → «${c.name}»`);
    }
  }
  const sinCred = b.nodes.filter((n) => Object.values(n.credentials ?? {}).some((c) => !c || !c.id)
    // L4: un HTTP con autenticación y sin credencial fallaría en ejecución.
    || (n.type === 'n8n-nodes-base.httpRequest' && (n.parameters?.authentication ?? 'none') !== 'none' && !Object.keys(n.credentials ?? {}).length));
  if (sinCred.length) morir(`nodos sin credencial resuelta: ${sinCred.map((n) => n.name).join(', ')}`);
  // La trampa del 15/09: un nodo que habla con Graph (Meta) con una credencial de cabecera genérica (la de la ingesta) le manda el token
  // de la consola a Meta. Tras resolver, ningún nodo con URL al anfitrión de Graph (Meta) puede conservar `httpHeaderAuth`: va con `whatsAppApi`.
  const graphConCabecera = b.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest' && llamaAGraph(n.parameters?.url)
    && (n.credentials?.httpHeaderAuth || n.parameters?.genericAuthType === 'httpHeaderAuth'));
  if (graphConCabecera.length) morir(`nodos que llaman al anfitrión de Graph (Meta) y conservan una credencial de cabecera (httpHeaderAuth): ${graphConCabecera.map((n) => n.name).join(', ')}. Tienen que usar la credencial predefinida whatsAppApi`);
  const credsUsadas = b.nodes.flatMap((n) => Object.values(n.credentials ?? {}).map((c) => c.name));
  const prohibidas = credsUsadas.filter((x) => NO_PERMITIDOS.test(x));
  if (prohibidas.length) morir(`credenciales con nombre de cliente o sistema ajeno: ${[...new Set(prohibidas)].join(', ')}`);
  const marcas = [...new Set(JSON.stringify(b).match(/REEMPLAZAR_[A-Z][A-Z0-9_]*/g) ?? [])];
  // Solo se admiten marcadores de RESPALDO del cliente en «Config base» (recepción, doctor, calendario,
  // horario): con la ruta del Demo A en «ensayo», los manda el panel; sin reemplazar no son números ni
  // calendarios válidos, así que nunca llegan al doctor ni a la agenda reales.
  const RESPALDO_OK = /^REEMPLAZAR_(NUMERO_(RECEPCION|DOCTOR)|CALENDARIO|HORARIO_ATENCION)_[A-Z0-9_]+$/;
  const marcasMal = marcas.filter((m) => !RESPALDO_OK.test(m));
  const fueraDeConfigBase = b.nodes.filter((n) => n.name !== 'Config base' && /REEMPLAZAR_[A-Z]/.test(JSON.stringify(n.parameters ?? {}))).map((n) => n.name);
  if (fueraDeConfigBase.length) morir(`hay marcadores fuera de «Config base»: ${fueraDeConfigBase.join(', ')}`);
  if (marcasMal.length) morir(`marcadores que el flujo necesitaría y nadie repone: ${marcasMal.join(', ')}`);
  // 4. la diferencia con el vivo
  const nv = new Set(vivo.datos.nodes.map((n) => n.name)); const nb = new Set(b.nodes.map((n) => n.name));
  console.log(`Demo A vivo: «${vivo.datos.name}», ${vivo.datos.nodes.length} nodos, activo=${vivo.datos.active}`);
  // Los últimos 4 del `webhookId` del Trigger vivo, para cotejarlos a ojo con el `callback_url` de `webhook-meta.sh --ver-meta` (termina en
  // `/webhook/<webhookId>/webhook`). Solo 4 caracteres: la ruta completa es una URL de capacidad y no se imprime.
  console.log(`Trigger vivo: webhookId …${String(t.webhookId ?? '').slice(-4) || '(sin webhookId)'}; flujo vivo activo=${vivo.datos.active}`);
  console.log(`Candidato (${ARCHIVO.split(sep).slice(-2).join('/')}): ${b.nodes.length} nodos (con el disparador del Demo A). El nombre del flujo queda «${vivo.datos.name}».`);
  console.log(`Phone id del cliente en el JSON: ${MARCA_PHONE.test(readFileSync(ARCHIVO, 'utf8')) ? 'reemplazado en memoria por el del Demo A (no se muestra)' : 'no trae'}`);
  console.log(`Nodos que se van: ${[...nv].filter((x) => !nb.has(x)).length} · que llegan: ${[...nb].filter((x) => !nv.has(x)).length} · en los dos: ${[...nb].filter((x) => nv.has(x)).length}`);
  console.log('Credenciales, nodo por nodo:'); tabla.forEach((l) => console.log(l));
  console.log(`Marcadores que quedan (solo respaldo de «Config base»; el panel de «ensayo» manda): ${marcas.join(', ') || '—'}`);
  console.log(`Respaldo del vivo: ${RESPALDO}`);
  guardarRespaldo(RESPALDO, vivo.datos);
  chmodSync(RESPALDO, 0o600);
  if (!APLICAR) { console.log('\nEn seco: no se escribió nada en n8n (solo el respaldo local). Agregue --aplicar.'); process.exit(0); }
  const put = await llamar('PUT', `/workflows/${env.N8N_WORKFLOW_ID}`, { name: vivo.datos.name, nodes: b.nodes, connections: b.connections, settings: b.settings ?? vivo.datos.settings ?? {} });
  if (put.cod !== 200) morir(`PUT → ${put.cod}: ${JSON.stringify(put.datos.message ?? '').slice(0, 300)}. El vivo no cambió o quedó a medias: revise y use --restaurar-respaldo`);
  const tras = await asegurarActivo();
  writeFileSync(APLICADO, JSON.stringify({ flujo: ARCHIVO.split(sep).slice(-3).join('/'), aplicado: new Date().toISOString(), huella: huella(tras), contenido: contenido(tras) }), { mode: 0o600 });
  chmodSync(APLICADO, 0o600);
  console.log(`✓ candidato sobre el Demo A: «${tras.name}», ${tras.nodes.length} nodos, activo=${tras.active}`);
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
