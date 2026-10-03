#!/usr/bin/env node
// BATERIA DE CAPTACION CONTRA EL MODELO (Bloque 1, 03/10/2026).
//
// Corre conversaciones de `bateria-casos.json` por LOS NODOS CODE DEL JSON
// VERSIONADO -- Normalizar, Estado, Traspaso, Procesar, Salida y Decidir fila
// de la planilla, con `new Function` como la suite, sin los globales de Node --
// y llama al modelo SOLO donde el flujo lo llama: el turno del agente. Con el
// mismo modelo y la misma temperatura del nodo `Google Gemini Chat Model`, y el
// prompt de `Flujos/prompts/modulos/captacion.md` armado con los datos de
// `admin/scripts/datos/captacion-novuchat.json`.
//
//   node admin/scripts/modulos/captacion/bateria.mjs --seco
//   node admin/scripts/modulos/captacion/bateria.mjs --n 5 --antes <sha>
//   node admin/scripts/modulos/captacion/bateria.mjs --n 5 --vertex <proyecto> --casos C1,C3
//
// --seco       NO llama a nada: el modelo es un texto fijo. Sirve para ver que
//              los casos corren por los nodos y para medir lo que NO depende del
//              modelo. NO lee ninguna clave. Es el modo de esta rama: la corrida
//              real la autoriza Andres, porque gasta cuota y dinero.
// --antes <sha> corre tambien la version de ese commit (su prompt Y su codigo)
//              con los mismos casos, para comparar.
// --n          corridas por caso (3 por defecto).
// --casos      ids separados por coma (todos por defecto).
// --env, --vertex, --locacion: la lectura de la clave es la de
//              `scripts/comparar-prompt.mjs`. NUNCA SE IMPRIME EL VALOR DE UN
//              SECRETO: sale el NOMBRE de la variable que se uso y nada mas.
//
// NO ESCRIBE EN EL REPOSITORIO NI EN NINGUN SERVICIO: solo lee archivos y
// `git show`, y escribe en la salida estandar. Los textos de los casos son de
// prueba; la planilla es una lista en memoria.
//
// METRICAS por caso: mensajes que salen, tipo de interactivo de cada uno, % de
// mensajes que terminan en una pregunta, largo medio, si el primero dice que es
// una IA, si quedo un rubro registrado, la calificacion que dejaria la hoja,
// los avisos de `Procesar respuesta` y si aparece voseo.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '../../../..');
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SECO = process.argv.includes('--seco');
const N = Math.max(1, Number(arg('--n', '3')));
const ANTES = arg('--antes');
const FLUJO = arg('--flujo', 'Flujos/novuchat-onboarding.json');
const SOLO = arg('--casos') ? arg('--casos').split(',').map((x) => x.trim()) : null;
const VERTEX = arg('--vertex');
const LOCACION = arg('--locacion', 'us-central1');
const ENV_FILE = arg('--env', '.env.novuchat');

const TEL = '59100000001';
// Los globales que el nodo Code de n8n NO tiene (como `lib/flujo.ts`).
const VACIOS = ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone', 'btoa', 'atob', 'fetch', 'Request',
  'Response', 'Headers', 'FormData', 'Blob', 'AbortController', 'Buffer', 'crypto', 'process', 'require', 'module', 'exports',
  '__dirname', '__filename', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask'];
const VOSEO = /\b(quer[eé]s|ten[eé]s|pod[eé]s|dec[ií]me|cont[aá]me|escrib[ií]me|mir[aá]|fijate|pasame|avisame|che)\b/i;

// --- La clave, sin mostrarla (solo fuera de --seco) -------------------------
let CLAVE = null, TOKEN = null, MODELO_VIVO = false;
if (!SECO) {
  const leerEnv = (a) => {
    const f = join(RAIZ, a);
    if (!existsSync(f)) return {};
    const out = {};
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  };
  const env = { ...leerEnv('.env'), ...leerEnv(ENV_FILE) };
  if (VERTEX) {
    TOKEN = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim();
    console.log(`Proveedor: Vertex AI, proyecto ${VERTEX} (${LOCACION}); token de gcloud, no mostrado`);
  } else {
    const nombre = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'].find((k) => env[k]);
    if (!nombre) { console.error('✗ No hay clave del modelo en el entorno (se buscaron GEMINI_API_KEY y otras; no se muestra ningun contenido). Use --vertex <proyecto> o --seco.'); process.exit(2); }
    CLAVE = env[nombre];
    console.log(`Clave del modelo: variable ${nombre} del entorno (valor no mostrado)`);
  }
  MODELO_VIVO = true;
}

// --- El flujo: el de ahora y, si se pide, el de un commit --------------------
const leerFlujo = (sha) => JSON.parse(sha ? execFileSync('git', ['show', `${sha}:${FLUJO}`], { cwd: RAIZ, maxBuffer: 256 * 1024 * 1024 }).toString()
  : readFileSync(join(RAIZ, FLUJO), 'utf8'));
const datos = JSON.parse(readFileSync(join(RAIZ, 'admin/scripts/datos/captacion-novuchat.json'), 'utf8'));
const { casos } = JSON.parse(readFileSync(join(aqui, 'bateria-casos.json'), 'utf8'));

function motor(flujo) {
  const nodo = (n) => { const x = flujo.nodes.find((y) => y.name === n); if (!x) throw new Error('sin nodo ' + n); return x; };
  // Un nodo Code, con `$input`, `$('Nombre')` y los datos estaticos.
  function correr(nombre, items, contexto = {}, estatico = {}) {
    const item = (x) => ({ json: x });
    const entrada = { all: () => items.map(item), first: () => item(items[0]) };
    const $ = (n) => { const v = contexto[n]; const l = Array.isArray(v) ? v : [v ?? {}];
      return { first: () => item(l[0]), all: () => l.map(item), isExecuted: n in contexto }; };
    // eslint-disable-next-line no-new-func
    const fn = new Function('$input', '$', '$getWorkflowStaticData', ...VACIOS, nodo(nombre).parameters.jsCode);
    return fn(entrada, $, () => estatico, ...VACIOS.map(() => undefined)).map((x) => x.json);
  }
  const base = Object.fromEntries(nodo('Config base').parameters.assignments.assignments.map((a) => [a.name, a.value]));
  const gemini = flujo.nodes.find((n) => n.name.includes('Gemini'));
  return { nodo, correr, base, modelo: gemini.parameters.modelName,
    temperatura: gemini.parameters.options?.temperature ?? 0.3, maxTokens: gemini.parameters.options?.maxOutputTokens ?? 2048,
    prompt: nodo('AI Agent NovuChat').parameters.options.systemMessage };
}

// --- La configuracion de cada caso, como la dejaria `Config del negocio` -----
function configDe(m, opc = {}) {
  const b = { ...m.base, planillaProspectosId: 'PLANILLA_DE_PRUEBA_' + 'x'.repeat(26), planillaProspectosHoja: '' };
  const panel = { statusCode: 200, body: {
    tenantId: 'bateria', flujo: 'onboarding', estadoComercio: 'activo', phoneNumberId: '1000000003391',
    operacion: { numeroRecepcion: '+591 7000-0000', horarioAtencion: 'lunes a viernes, de 09:00 a 18:00' },
    datosDelNegocio: { nombreNegocio: b.nombreNegocio || 'Negocio de prueba' },
    voz: { nombreAsistente: datos.nombreAsistente,
      ...(opc.tratamiento === 'usted' ? { tratamiento: 'Trata de usted siempre (usted, le, su). Nunca tutees ni uses voseo. Habla como en La Paz: profesional y cordial.' } : {}) },
    onboarding: { topeAviso: 25, plantillaAviso: 'solicitud_contacto',
      rubros: opc.sinRubros ? [] : datos.rubros, planes: opc.sinPlanes ? [] : datos.planes,
      cargosUnicos: opc.sinPlanes ? [] : datos.cargosUnicos, aclaraciones: datos.aclaraciones },
    ...(opc.campana ? { campanas: [{ id: 'camp-1', texto: opc.campana.texto,
      inicio: new Date(Date.now() - 86_400_000).toISOString(), fin: new Date(Date.now() + 86_400_000).toISOString(),
      ...(opc.campana.destino ? { destino: opc.campana.destino } : {}) }] } : {}),
  } };
  return m.correr('Config del negocio', [panel], { 'Config base': b })[0];
}

// --- El modelo ---------------------------------------------------------------
async function llamar(m, sistema, historial, usuario) {
  if (!MODELO_VIVO) return 'Entendido. ¿Me cuentas un poco más de tu negocio?';
  const corto = m.modelo.replace(/^models\//, '');
  const host = LOCACION === 'global' ? 'aiplatform.googleapis.com' : `${LOCACION}-aiplatform.googleapis.com`;
  const url = VERTEX ? `https://${host}/v1/projects/${VERTEX}/locations/${LOCACION}/publishers/google/models/${corto}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/${m.modelo}:generateContent`;
  const contents = [...historial.flatMap(([u, a]) => [{ role: 'user', parts: [{ text: u }] }, { role: 'model', parts: [{ text: a }] }]),
    { role: 'user', parts: [{ text: usuario }] }];
  const r = await fetch(url, { method: 'POST',
    headers: VERTEX ? { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } : { 'Content-Type': 'application/json', 'x-goog-api-key': CLAVE },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sistema }] }, contents,
      generationConfig: { temperature: m.temperatura, maxOutputTokens: m.maxTokens } }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

// El systemMessage con las expresiones resueltas, como las resuelve n8n.
const resolver = (plantilla, cfg, conocimiento) => plantilla.replace(/^=/, '')
  .replace(/\{\{\s*\$\('Config del negocio'\)\.first\(\)\.json\.([A-Za-z0-9_]+)\s*\}\}/g, (_, c) => String(cfg[c] ?? ''))
  .replace(/\{\{\s*\$\('Conocimiento del sitio'\)\.first\(\)\.json\.conocimiento\s*\}\}/g, () => conocimiento);

const mensajeWhatsApp = (t, id) => {
  const base = { from: TEL, id };
  if (t.tipo === 'texto') return { ...base, type: 'text', text: { body: t.texto } };
  if (t.tipo === 'fila') return { ...base, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: t.id, title: t.titulo } } };
  if (t.tipo === 'boton') return { ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: t.id, title: t.titulo } } };
  if (t.tipo === 'audio') return { ...base, type: 'audio', audio: { id: 'media-de-prueba' } };
  throw new Error('tipo de turno desconocido: ' + t.tipo);
};

// --- Una conversacion -----------------------------------------------------------
async function conversar(m, caso, conocimiento, serie) {
  const cfg = configDe(m, caso.opciones);
  const sistema = resolver(m.prompt, cfg, conocimiento);
  const sd = {};
  const filas = [];                                  // la hoja de la planilla, en memoria
  const historial = [];
  const salidas = [];
  const avisos = [];
  const ENC = ['ID Lead', 'Fecha Registro', 'Nombre y Apellido', 'Empresa / Cliente', 'Teléfono WhatsApp', 'Rubro', 'Etapa Funnel',
    'Origen / Canal', 'Calificación IA', 'Resumen Chatbot IA'];
  const sinA = (v) => String(v ?? '').replace(/^'/, '');
  let seq = 0;
  for (const t of caso.turnos) {
    const payload = { messages: [mensajeWhatsApp(t, `wamid.bateria.${serie}.${++seq}`)], contacts: [{ profile: { name: 'Ana' } }] };
    let e = m.correr('Normalizar entrada', [{ ...cfg, ...payload }])[0];
    if (t.tipo === 'audio') e = { ...e, userInput: '(audio transcripto) ' + t.transcripcion, tipo: 'audio', esMedioAudio: true };
    e = m.correr('Estado de la conversación', [e], {}, sd)[0];
    if (!e) continue;
    let rama;
    if (e.accion === 'asesor') rama = m.correr('Traspaso a un asesor', [e], {}, sd)[0];
    else if (e.accion === 'agente') {
      let bruto = '';
      try { bruto = await llamar(m, sistema, historial, e.mensajeDelTurno); } catch (err) { bruto = null; avisos.push('modelo: ' + String(err.message).slice(0, 80)); }
      rama = m.correr('Procesar respuesta', [bruto === null ? { error: 'modelo' } : { output: bruto }], { 'Estado de la conversación': e }, sd)[0];
      if (bruto !== null) historial.push([e.mensajeDelTurno, bruto]);
    } else rama = m.correr('Uso extendido', [e], {}, sd)[0];
    const s = m.correr('Salida', [rama])[0];
    salidas.push({ s, rama });
    for (const a of rama.avisos ?? []) avisos.push(a);
    // La planilla, con lo que decide `Decidir fila de la planilla`.
    const p = m.correr('Prospecto para la planilla', [s], { 'Config del negocio': cfg });
    if (p.length) {
      const k = filas.findIndex((f) => sinA(f[4]) === TEL);
      const busqueda = k >= 0 ? [{ row_number: k + 2, ...Object.fromEntries(ENC.map((h, c) => [h, filas[k][c] ?? ''])) }] : [{}];
      const ids = filas.length ? filas.map((f, j) => ({ row_number: j + 2, 'ID Lead': f[0] ?? '' })) : [{}];
      const [d] = m.correr('Decidir fila de la planilla', ids, { 'Prospecto para la planilla': p, 'Buscar teléfono en planilla': busqueda });
      if (d.accionPlanilla === 'agregar') filas.push(ENC.map((h) => sinA(d[h])));
      if (d.accionPlanilla === 'actualizar') ENC.forEach((h, c) => { if (h in d) filas[Number(d.row_number) - 4][c] = sinA(d[h]); });
    }
  }
  const textos = salidas.map(({ s }) => String(s.respuesta ?? '')).filter(Boolean);
  const c = sd.conversaciones?.[TEL] ?? {};
  return {
    mensajes: salidas.filter(({ s }) => s.responder !== false).length,
    tipos: salidas.map(({ s }) => s.cuerpoMeta?.interactive?.type ?? 'texto'),
    preguntas: textos.filter((t) => /\?[\s\p{Extended_Pictographic}‍️]*$/u.test(t)).length,
    total: textos.length,
    largos: textos.map((t) => t.length),
    iaEnElPrimero: /inteligencia\s+artificial|\bIA\b/i.test(textos[0] ?? ''),
    rubro: c.lead?.rubro ? c.lead.rubro : (c.hechos?.eligioOtro ? '(Otro)' : ''),
    calificacion: filas[0]?.[8] ?? '(sin fila)',
    avisos, voseo: textos.some((t) => VOSEO.test(t)),
  };
}

// --- Corrida -----------------------------------------------------------------------
const versiones = [['AHORA', leerFlujo(null)]];
if (ANTES) versiones.push([`ANTES (${ANTES.slice(0, 7)})`, leerFlujo(ANTES)]);
const motores = versiones.map(([etiqueta, f]) => [etiqueta, motor(f)]);
const corpus = (m) => m.correr('Conocimiento del sitio', [{}])[0].conocimiento;
const elegidos = casos.filter((c) => !SOLO || SOLO.includes(c.id));

console.log(`Modelo: ${motores[0][1].modelo} · temperatura ${motores[0][1].temperatura}` + (SECO ? ' · SECO: el modelo es un texto fijo, no se llama a nada' : ''));
console.log(`${elegidos.length} casos · ${N} corridas por caso y versión\n`);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0) + ' %';
for (const [etiqueta, m] of motores) {
  const conocimiento = corpus(m);
  const estatica = resolver(m.prompt, configDe(m), '').length;
  console.log(`=== ${etiqueta} · prompt de ${m.prompt.length} caracteres con las expresiones, ${estatica} ya resueltas sin el corpus ===`);
  for (const caso of elegidos) {
    const corridas = [];
    for (let i = 0; i < N; i++) {
      try { corridas.push(await conversar(m, caso, conocimiento, `${caso.id}.${i}`)); }
      catch (err) { corridas.push({ error: String(err.message).slice(0, 120) }); }
    }
    const buenas = corridas.filter((x) => !x.error);
    const errores = corridas.length - buenas.length;
    if (!buenas.length) { console.log(`${caso.id.padEnd(4)} ${caso.titulo}\n     ✗ ${corridas[0].error}\n`); continue; }
    const suma = (f) => buenas.reduce((a, x) => a + f(x), 0);
    const largos = buenas.flatMap((x) => x.largos);
    const calif = {};
    for (const x of buenas) calif[x.calificacion] = (calif[x.calificacion] ?? 0) + 1;
    const rubros = buenas.filter((x) => x.rubro).length;
    const avisos = {};
    for (const x of buenas) for (const a of x.avisos) avisos[a] = (avisos[a] ?? 0) + 1;
    console.log(`${caso.id.padEnd(4)} ${caso.titulo}` + (errores ? `   (${errores} corridas con error)` : ''));
    console.log(`     mensajes ${(suma((x) => x.mensajes) / buenas.length).toFixed(1)} · interactivos [${buenas[0].tipos.join(', ')}]`
      + ` · terminan en pregunta ${pct(suma((x) => x.preguntas), suma((x) => x.total))}`
      + ` · largo medio ${largos.length ? Math.round(largos.reduce((a, b) => a + b, 0) / largos.length) : 0}`);
    console.log(`     IA en el primero ${pct(suma((x) => (x.iaEnElPrimero ? 1 : 0)), buenas.length)}`
      + ` · rubro registrado ${pct(rubros, buenas.length)} (${buenas.find((x) => x.rubro)?.rubro ?? '—'})`
      + ` · calificación ${Object.entries(calif).map(([k, v]) => `${k} ${v}/${buenas.length}`).join(', ')}`
      + ` · voseo ${suma((x) => (x.voseo ? 1 : 0))}/${buenas.length}`);
    console.log(`     avisos: ${Object.entries(avisos).map(([k, v]) => `${k} ×${v}`).join(', ') || 'ninguno'}\n`);
  }
}
