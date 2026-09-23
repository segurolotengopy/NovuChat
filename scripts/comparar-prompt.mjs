#!/usr/bin/env node
// COMPARA DOS VERSIONES DE UN PROMPT CONTRA EL MODELO REAL, N veces cada una,
// y cuenta en cuantas aparece lo que se quiere medir (una marca, una frase).
//
// Existe porque «el modelo hizo otra cosa» no se discute con opiniones. Un
// cambio de redaccion en las instrucciones se mide igual que un cambio de
// codigo: con la misma entrada, contra el mismo modelo, repetido.
//
//   ./scripts/comparar-prompt.mjs --antes <sha> --marca '[RUBROS]' --n 12
//   ./scripts/comparar-prompt.mjs --antes <sha> --flujo Flujos/x.json --ejecucion 4688
//
// NUNCA IMPRIME EL VALOR DE UN SECRETO. La clave del modelo se lee del .env y
// se usa; por pantalla sale el NOMBRE de la variable que se encontro y nada
// mas. El .env esta en .gitignore y este script no lo escribe.
//
// DOS PROVEEDORES, EL MISMO MODELO. Por defecto usa la API de AI Studio con la
// clave del .env, que es la que usa n8n. Con --vertex <proyecto> usa Vertex AI
// con el token de `gcloud auth print-access-token`: sirve cuando la clave vive
// solo en la credencial de n8n -- que la API no devuelve -- y conviene ademas
// para no gastar la cuota del proyecto de produccion. La comparacion vale
// igual: las dos versiones corren contra el mismo endpoint y el mismo modelo.
//
// EL PROMPT SE ARMA CON LOS VALORES REALES DE UNA EJECUCION de n8n: las
// expresiones {{ $('Config del negocio')... }} y el corpus del sitio se
// resuelven con lo que el modelo recibio de verdad ese dia. Sin eso se estaria
// comparando otra cosa.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = (nombre, porDefecto = null) => {
  const i = process.argv.indexOf(nombre);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
};

const ENV_FILE = arg('--env', '.env.novuchat');
const FLUJO = arg('--flujo', 'Flujos/novuchat-onboarding.json');
const ANTES = arg('--antes');                       // sha con la version previa
const EJECUCION = arg('--ejecucion');               // de donde salen los valores reales
const MARCA = arg('--marca', '[RUBROS]');
const N = Number(arg('--n', '10'));
const NODO_AGENTE = arg('--nodo-agente', 'AI Agent NovuChat');
// Una linea de mas en el CONTEXTO DEL TURNO, para medir un refuerzo por codigo
// ANTES de construirlo. Es lo que pondria un nodo, simulado.
const EXTRA_TURNO = arg('--extra-turno');
// Reemplaza el mensaje del cliente y/o los datos ya registrados del turno, para
// medir un momento de la conversacion del que todavia no hay ejecucion.
const TURNO_TEXTO = arg('--turno-texto');
const TURNO_DATOS = arg('--turno-datos');
// Para aislar UNA variable: correr la version actual con la lista de rubros
// numerada en el prompt, como la tenia la version vieja. El cliente nunca ve
// esa lista -- la arma `Procesar respuesta` --, asi que numerarla en el prompt
// no contradice que al cliente se le muestre como referencia.
const NUMERAR_AHORA = process.argv.includes('--numerar-ahora');

// --- La clave, sin mostrarla -----------------------------------------------
const CANDIDATAS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'];
function leerEnv(archivo) {
  if (!existsSync(archivo)) return {};
  const out = {};
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linea);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...leerEnv('.env'), ...leerEnv(ENV_FILE) };
const VERTEX = arg('--vertex');
const LOCACION = arg('--locacion', 'us-central1');
let CLAVE = null, TOKEN = null;
if (VERTEX) {
  TOKEN = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim();
  console.log(`Proveedor: Vertex AI, proyecto ${VERTEX} (${LOCACION}); token de gcloud, no mostrado`);
} else {
  const nombreClave = CANDIDATAS.find((k) => env[k]);
  if (!nombreClave) {
    console.error('✗ No hay clave del modelo en el entorno. Se buscaron, por nombre: ' + CANDIDATAS.join(', '));
    console.error('  (ninguna tiene valor; no se muestra ningun contenido del .env)');
    console.error('  Si la clave vive solo en la credencial de n8n, use --vertex <proyecto>.');
    process.exit(2);
  }
  CLAVE = env[nombreClave];
  console.log(`Clave del modelo: variable ${nombreClave} del entorno (valor no mostrado)`);
}

// --- El contexto real de una ejecucion de n8n ------------------------------
function ejecucion(id) {
  const base = String(env['N8N_BASE_URL'] || '').replace(/\/+$/, '');
  const url = `${base}/api/v1/executions/${id}?includeData=true`;
  const bruto = execFileSync('curl', ['-fsS', '-H', `X-N8N-API-KEY: ${env['N8N_API_KEY']}`, url],
    { maxBuffer: 256 * 1024 * 1024 }).toString();
  return JSON.parse(bruto);
}
function salidaDeNodo(ej, nombre) {
  const corridas = ej?.data?.resultData?.runData?.[nombre];
  if (!corridas) throw new Error(`la ejecucion no tiene el nodo «${nombre}»`);
  return corridas[0].data.main[0][0].json;
}

// --- El systemMessage de cada version --------------------------------------
function promptDe(textoJson) {
  const f = JSON.parse(textoJson);
  const nodo = f.nodes.find((n) => n.name === NODO_AGENTE);
  return nodo.parameters.options.systemMessage;
}
function versionEnSha(sha, ruta) {
  return execFileSync('git', ['show', `${sha}:${ruta}`], { maxBuffer: 64 * 1024 * 1024 }).toString();
}

// Resuelve las expresiones de n8n con los valores que el nodo produjo de
// verdad. `Config del negocio` y `Conocimiento del sitio` son los dos unicos
// nodos que el systemMessage consulta.
function resolver(plantilla, config, conocimiento) {
  return plantilla
    .replace(/^=/, '')
    .replace(/\{\{\s*\$\('Config del negocio'\)\.first\(\)\.json\.([A-Za-z0-9_]+)\s*\}\}/g,
      (_, campo) => String(config[campo] ?? ''))
    .replace(/\{\{\s*\$\('Conocimiento del sitio'\)\.first\(\)\.json\.conocimiento\s*\}\}/g,
      () => String(conocimiento));
}

// `rubrosTexto` lo deriva `Config del negocio`, y ESE nodo tambien cambio: la
// version vieja numeraba. Se reconstruye desde los mismos rubros para que la
// comparacion sea de punta a punta y no solo del systemMessage.
function rubrosTextoNumerado(rubros) {
  return rubros.map((r, i) => `${i + 1}. ${r.nombre}${r.solucion ? ' - solución: ' + r.solucion : ''}`).join('\n');
}

// --- El modelo --------------------------------------------------------------
async function llamar(sistema, usuario, modelo, temperatura, maxTokens) {
  const corto = modelo.replace(/^models\//, '');
  // La locacion `global` -- donde Google publica primero los modelos nuevos --
  // no lleva prefijo en el host.
  const host = LOCACION === 'global' ? 'aiplatform.googleapis.com' : `${LOCACION}-aiplatform.googleapis.com`;
  const url = VERTEX
    ? `https://${host}/v1/projects/${VERTEX}/locations/${LOCACION}` +
      `/publishers/google/models/${corto}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/${modelo}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: VERTEX
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
      : { 'Content-Type': 'application/json', 'x-goog-api-key': CLAVE },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: [{ text: usuario }] }],
      generationConfig: { temperature: temperatura, maxOutputTokens: maxTokens },
    }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

// --- Corrida ---------------------------------------------------------------
const ej = ejecucion(EJECUCION);
const cfg = salidaDeNodo(ej, 'Config del negocio');
const conocimiento = salidaDeNodo(ej, 'Conocimiento del sitio').conocimiento;
let turno = salidaDeNodo(ej, 'Estado de la conversación').mensajeDelTurno;
if (TURNO_TEXTO) turno = turno.replace(/(\[MENSAJE DEL CLIENTE\]\n)[\s\S]*$/, `$1${TURNO_TEXTO}`);
if (TURNO_DATOS) {
  const faltan = ['empresa', 'contacto', 'rubro'].filter((k) => !JSON.parse(TURNO_DATOS)[k]);
  turno = turno.replace(/Datos ya registrados: .*\. Faltan: .*\./,
    `Datos ya registrados: ${TURNO_DATOS}. Faltan: ${faltan.join(', ') || 'ninguno'}.`);
}

const flujoAhora = readFileSync(FLUJO, 'utf8');
const flujoAntes = versionEnSha(ANTES, FLUJO);
const nodoModelo = JSON.parse(flujoAhora).nodes.find((n) => n.name.includes('Gemini'));
const MODELO = nodoModelo.parameters.modelName;
const TEMP = nodoModelo.parameters.options?.temperature ?? 0.3;
const MAXTOK = nodoModelo.parameters.options?.maxOutputTokens ?? 2048;

const cfgAntes = { ...cfg, rubrosTexto: rubrosTextoNumerado(cfg.rubros ?? []) };
const conExtra = (t, linea) => t.replace('[MENSAJE DEL CLIENTE]', linea + '\n[MENSAJE DEL CLIENTE]');
const variantes = [
  ['ANTES (' + ANTES.slice(0, 7) + ')', resolver(promptDe(flujoAntes), cfgAntes, conocimiento), turno],
  ['AHORA' + (NUMERAR_AHORA ? ' + rubrosTexto numerado' : ' (publicado)'),
    resolver(promptDe(flujoAhora), NUMERAR_AHORA ? cfgAntes : cfg, conocimiento), turno],
];
if (EXTRA_TURNO) {
  variantes.push(['AHORA + indicación del sistema' + (NUMERAR_AHORA ? ' (rubrosTexto numerado)' : ''),
    resolver(promptDe(flujoAhora), NUMERAR_AHORA ? cfgAntes : cfg, conocimiento),
    conExtra(turno, EXTRA_TURNO)]);
}

console.log(`Modelo: ${MODELO} · temperatura ${TEMP} · maxOutputTokens ${MAXTOK}`);
console.log(`Contexto real: ejecucion #${EJECUCION}`);
console.log(`Marca que se cuenta: ${MARCA}   ·   ${N} corridas por version\n`);
console.log('MENSAJE DEL CLIENTE: ' + (turno.split('[MENSAJE DEL CLIENTE]')[1] ?? '').trim() + '\n');

const resultados = [];
for (const [etiqueta, sistema, entrada] of variantes) {
  let conMarca = 0, conLead = 0, errores = 0, pideNumero = 0;
  const muestras = [];
  for (let i = 0; i < N; i++) {
    try {
      const salida = await llamar(sistema, entrada, MODELO, TEMP, MAXTOK);
      const cuerpoLead = (/\[LEAD\]([\s\S]*?)\[\/LEAD\]/i.exec(salida) ?? [, ''])[1];
      if (MARCA.startsWith('lead.')) {
        const campo = MARCA.slice(5);
        let v; try { v = JSON.parse(cuerpoLead.trim())?.[campo]; } catch { v = undefined; }
        if (v && String(v).trim() && !/^(pendiente|no especificado|n\/?a)$/i.test(String(v))) conMarca++;
      } else if (salida.includes(MARCA)) conMarca++;
      if (/\[LEAD\]/i.test(salida)) conLead++;
      if (/(responde|contesta|resp[oó]ndeme|indica|escribe)[^.!?\n]{0,40}\bn[uú]mero\b|\bn[uú]mero\s+(de\s+la\s+)?(opci[oó]n|lista)/i.test(salida)) pideNumero++;
      muestras.push(salida.replace(/\[LEAD\][\s\S]*?\[\/LEAD\]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 150));
    } catch (e) { errores++; muestras.push('ERROR: ' + e.message); }
  }
  resultados.push({ etiqueta, conMarca, conLead, errores, pideNumero, muestras });
  console.log(`${etiqueta}: ${MARCA} en ${conMarca}/${N}   ·   [LEAD] en ${conLead}/${N}` +
    `   ·   le pide un número al cliente en ${pideNumero}/${N}` + (errores ? `   ·   ${errores} errores` : ''));
  console.log(`   prompt de ${sistema.length} caracteres`);
  for (const m of muestras.slice(0, 3)) console.log(`   · ${m}…`);
  console.log();
}

console.log('─'.repeat(70));
console.log(MARCA + ':  ' + resultados.map((r) => `${r.etiqueta} ${r.conMarca}/${N} (${Math.round(100*r.conMarca/N)} %)`).join('   ->   '));
