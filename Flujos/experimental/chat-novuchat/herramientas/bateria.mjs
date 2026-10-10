#!/usr/bin/env node
// BATERÍA DE «CHAT NOVUCHAT v2 (KENJI)» CONTRA EL MODELO (09/10/2026).
//
// QUÉ ES. Corre las conversaciones de `bateria-casos.json` por el FLUJO ARMADO (`chat-novuchat.novuchat.json`): recorre su grafo nodo por nodo, en el orden del lienzo, y corre de verdad
// los nodos Code del JSON (con `new Function`, sin los globales de Node que el Code de n8n no tiene) y evalúa los IF y los Set. Lo único que sale a la red es el modelo: toma el cuerpo EXACTO
// que arman «Armar turno» y «Validar respuesta» (`systemInstruction` con las instrucciones del documento, el historial por teléfono en `contents` y `responseSchema`) y lo envía a
// `generateContent` con el modelo de los datos; la respuesta real vuelve al flujo tal como la entregaría n8n (y, si el mensaje viola una guardia, el flujo pide su UN reintento).
// Todo lo demás va simulado y en memoria: la consola (panel de ejemplo), la ingesta, Graph (acepta todo), los medios (la transcripción y la lectura vienen en el caso), la espera de la
// ráfaga (los clics seguidos corren como ejecuciones que comparten los datos estáticos y se despiertan en cadena) y la hoja de Google.
//
// Mide lo que depende del MODELO (lo determinista lo cubre `chat-novuchat-flujo.test.ts`): cuántos turnos llegaron al modelo, cuántas veces el código rechazó su mensaje (y por qué causa)
// y cuántas salió el texto de respaldo; el JSON válido; el acierto de `rubro`, `descarte`, `nombre` y `empresa`; y SOBRE TODO las violaciones de las reglas duras sobre lo que el cliente RECIBE
// (cada una con su caso y su texto): una muletilla, un mensaje sin los dos botones, un dígito de más, una promesa de contacto, el nombre de una persona del equipo…  Más tokens, latencia y costo.
//
// Se corre desde la raíz del repositorio:
//   node Flujos/experimental/chat-novuchat/herramientas/bateria.mjs --seco
//   node Flujos/experimental/chat-novuchat/herramientas/bateria.mjs --env .env.novuchat --n 3
//   node Flujos/experimental/chat-novuchat/herramientas/bateria.mjs --vertex <proyecto> --casos S1,S2 --json
//
// OPCIONES
//   --seco            NO llama a nada: el modelo es una respuesta fija por turno (campo `seco` de cada turno del caso; sin él, el modelo «cae» y sale el respaldo). No lee ninguna clave
//                     ni toca la red. Sirve para ver que los casos corren por el flujo y que lo determinista da cero violaciones. Las cifras del modelo NO significan nada.
//   --n <1..20>       corridas por caso (3 por defecto).
//   --casos S1,S3,..  ids separados por coma (todos por defecto).
//   --env <archivo>   archivo con la clave (`.env` y este; por defecto `.env.novuchat`).
//   --vertex <proy>   usa Vertex AI con el token de `gcloud auth print-access-token` (la clave vive solo en n8n).
//   --locacion <loc>  región de Vertex (us-central1 por defecto).
//   --json            salida de máquina: UN objeto JSON en la salida estándar (lo demás va a la de errores).
//   --ayuda           este resumen.
//
// NUNCA SE IMPRIME EL VALOR DE UN SECRETO: sale el NOMBRE de la variable que se usó y nada más. La clave viaja en el encabezado `x-goog-api-key` (nunca en la URL) y SOLO a
// `generativelanguage.googleapis.com`; el token de Vertex, solo a `*-aiplatform.googleapis.com`. NO ESCRIBE ARCHIVOS: solo lee el flujo, los casos y, fuera de --seco, los archivos de entorno.
//
// SUPUESTOS DEL COSTO: la tarifa de abajo (`TARIFA`) se calibró con lo medido el 01/10/2026 en el flujo B de Agenda mínima (≈ USD 0,0005 por llamada de ~800 tokens de entrada y ~100 de
// salida con este modelo). No es una factura: se confirma contra la facturación de Google.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_FLUJO = join(AQUI, '..');
const RUTA_FLUJO = join(RAIZ_FLUJO, 'chat-novuchat.novuchat.json');
const RUTA_CASOS = join(AQUI, 'bateria-casos.json');
const RUTA_DATOS = join(AQUI, '../../../../admin/scripts/datos/chat-novuchat/novuchat.json');
const RUTA_MENSAJES = join(AQUI, '../../comun-sin-agente/src/mensajes.js');
const RUTA_FILTRO = join(AQUI, '../../comun-sin-agente/src/filtro-redaccion.js');
const RUTA_LIB = join(AQUI, '../src/lib/chat.js');

/** USD por millón de tokens. Los cacheados se cobran a un décimo de la entrada; el razonamiento, como salida. */
export const TARIFA = { entrada: 0.30, salida: 2.50, cacheado: 0.03 };
const SUPUESTO_TARIFA = `USD ${TARIFA.entrada} por millón de tokens de entrada, USD ${TARIFA.salida} de salida y USD ${TARIFA.cacheado} de cacheados; `
  + 'calibrada con la medición del 01/10/2026 (≈ USD 0,0005 por llamada de ~800 tokens de entrada y ~100 de salida). No es una factura.';

const CANDIDATAS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'];
const HOST_AI_STUDIO = 'generativelanguage.googleapis.com';

/** Los globales que el Code de n8n NO tiene (como `admin/pruebas/lib/flujo.ts`): entran como parámetros vacíos. */
const GLOBALES_FUERA = ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone', 'btoa', 'atob', 'fetch', 'Request',
  'Response', 'Headers', 'FormData', 'Blob', 'AbortController', 'Buffer', 'crypto', 'process', 'require', 'module', 'exports',
  '__dirname', '__filename', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask'];

// ------------------------------------------------------------------------------------------------------- datos de ejemplo
// Una consola inventada y teléfonos sintéticos (seis ceros seguidos): ningún dato real. Lunes 05/10/2026, 10:00 en La Paz.
const PID = '59100000003';       // phone_number_id del número del negocio
const REC = '59100000001';       // recepción: destino del botón y del aviso (y, en el caso «recepción», quien escribe)
const ID_PLANILLA = 'PLANILLA_DE_PRUEBA_' + 'x'.repeat(26);
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const SUSPENDIDO = 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';
/** Un teléfono SINTÉTICO por caso y corrida (59100000010 a 59100000019: nunca el de recepción ni el del negocio); determinista. */
export const telefonoDe = (idCaso, rep) => '5910000001' + ([...`${idCaso}#${rep}`].reduce((a, c) => a + c.charCodeAt(0), 0) % 10);

// La consola de NovuChat de ejemplo: trae rubros VIEJOS a propósito (este chat NO los usa) y topes de conversaciones en `incluye` (nunca deben salir).
const PLANES = [
  { nombre: 'Impulso', precioUsd: 25, periodo: 'mes', incluye: '100 conversaciones al mes; hasta 20 productos en el catálogo' },
  { nombre: 'Crecimiento', precioUsd: 50, periodo: 'mes', incluye: '220 conversaciones al mes; hasta 100 productos en el catálogo' },
  { nombre: 'Pro', precioUsd: 90, periodo: 'mes', incluye: '500 conversaciones al mes; hasta 500 productos; soporte prioritario' },
];
const CARGOS = [
  { nombre: 'Instalación estándar', precioUsd: 65, desde: false, detalle: 'Pago único y por adelantado, llave en mano.' },
  { nombre: 'Instalación a medida', precioUsd: 125, desde: true, detalle: 'Integración con tu sistema propio o flujos complejos; se cotiza caso por caso.' },
];
const ARCHIVO = { url: 'https://firebasestorage.googleapis.com/v0/b/ejemplo-novuchat/o/planes.png', tipo: 'imagen', nombreArchivo: 'Planes.png' };
const RUBROS_VIEJOS = [
  { id: 'salud-y-belleza', nombre: 'Salud y Belleza', solucion: 'Agenda y recuerda las citas sola.', flujoSugerido: 'agendamiento' },
  { id: 'leads-de-ventas', nombre: 'Leads de Ventas', solucion: 'miniCRM y Kanban.', flujoSugerido: 'a_medida' },
];
function panelDe(opciones = {}) {
  return {
    tenantId: 'novuchat', flujo: 'onboarding', estadoComercio: 'activo', phoneNumberId: PID,
    operacion: { numeroRecepcion: opciones.sinRecepcion ? '' : REC, horarioAtencion: '' },
    datosDelNegocio: { nombreNegocio: 'NovuChat' },
    voz: { nivelEmojis: opciones.nivelEmojis ?? 'muchos', nombreAsistente: 'Kenji' },
    onboarding: {
      plantillaAviso: 'solicitud_contacto', rubros: RUBROS_VIEJOS,
      planes: opciones.sinPlanes ? [] : PLANES, cargosUnicos: opciones.sinPlanes ? [] : CARGOS, aclaraciones: [],
      archivoPlanes: opciones.sinPlanes || opciones.sinArchivo ? null : ARCHIVO,
    },
    campanas: [],
    atencion: { estado: 'normal' },
  };
}

// La hoja «Leads_CRM»: encabezados en la fila 3. Es el esquema de «Decidir fila de la planilla» (copia del flujo anterior).
const ENC = ['ID Lead', 'Fecha Registro', 'Nombre y Apellido', 'Empresa / Cliente', 'Teléfono WhatsApp', 'Rubro', 'Etapa Funnel',
  'Origen / Canal', 'Calificación IA', 'Resumen Chatbot IA', 'Próxima acción', 'Notas del equipo', 'Estado Comercial', 'Responsable'];
const COL_CALIFICACION = 'Calificación IA';


// ------------------------------------------------------------------------------------------------------- utilidades
const clonar = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const objeto = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
const tipoCorto = (tipo) => String(tipo).split('.').pop() ?? '';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const mensajeDe = (e) => (e instanceof Error ? e.message : e && typeof e === 'object' && typeof e.message === 'string' ? e.message : String(e));
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const redondear = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);

/** El error de uso: sale con el codigo 2 y su mensaje, sin traza. */
export class ErrorDeUso extends Error {
  constructor(mensaje) { super(mensaje); this.name = 'ErrorDeUso'; }
}

/** El reloj congelado: `new Date()` y `Date.now()` dan siempre `ms` (los Code de n8n mantienen una fecha fija por turno). */
export function relojFijo(ms) {
  return class extends Date {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
  };
}

/** Quita de un texto cualquier secreto conocido y las formas de clave o de token de Google. Un error nunca lleva un valor. */
export function limpiarSecretos(texto, secretos = []) {
  let t = String(texto ?? '');
  for (const s of secretos) if (typeof s === 'string' && s.length >= 4) t = t.split(s).join('[secreto]');
  return t.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[secreto]').replace(/ya29\.[0-9A-Za-z._-]+/g, '[secreto]').replace(/Bearer\s+\S+/gi, 'Bearer [secreto]');
}

// ------------------------------------------------------------------------------------------------------- argumentos
const CON_VALOR = new Set(['--n', '--casos', '--env', '--vertex', '--locacion']);
const SIN_VALOR = new Set(['--seco', '--json', '--ayuda', '-h']);

/** Lee y valida los argumentos. Rechaza lo desconocido, los valores que faltan y los fuera de rango. */
export function leerArgumentos(argv) {
  const o = { seco: false, json: false, ayuda: false, n: 3, casos: null, env: '.env.novuchat', vertex: null, locacion: 'us-central1', envDado: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (SIN_VALOR.has(a)) {
      if (a === '--seco') o.seco = true; else if (a === '--json') o.json = true; else o.ayuda = true;
      continue;
    }
    if (!CON_VALOR.has(a)) throw new ErrorDeUso(`Opción desconocida: ${limpiarSecretos(a).slice(0, 40)}. Usa --ayuda.`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new ErrorDeUso(`Falta el valor de ${a}.`);
    i++;
    if (a === '--n') {
      if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > 20) throw new ErrorDeUso('--n debe ser un entero de 1 a 20.');
      o.n = Number(v);
    } else if (a === '--casos') {
      const ids = v.split(',').map((x) => x.trim()).filter(Boolean);
      if (!ids.length || ids.some((x) => !/^[A-Za-z0-9_-]{1,12}$/.test(x))) throw new ErrorDeUso('--casos debe ser una lista de ids separados por coma (C1,C3).');
      o.casos = ids;
    } else if (a === '--env') {
      o.env = v; o.envDado = true;
    } else if (a === '--vertex') {
      if (!/^[a-z][a-z0-9-]{4,60}$/.test(v)) throw new ErrorDeUso('--vertex debe ser un id de proyecto de Google Cloud (minúsculas, números y guiones).');
      o.vertex = v;
    } else if (a === '--locacion') {
      if (!/^[a-z0-9-]{3,30}$/.test(v)) throw new ErrorDeUso('--locacion no es una región válida.');
      o.locacion = v;
    }
  }
  if (o.seco && (o.vertex || o.envDado)) throw new ErrorDeUso('--seco no usa clave: no se combina con --env ni --vertex.');
  return o;
}

// ------------------------------------------------------------------------------------------------------- la clave
/**
 * La clave, SIN MOSTRARLA: devuelve `{ clave, token, nombre }`. `nombre` es la variable que se uso (se puede imprimir);
 * el valor nunca sale de aqui salvo hacia el encabezado de la llamada. Un error nunca lleva el valor.
 */
export function leerCredencial(opciones, deps) {
  if (opciones.vertex) {
    let token = '';
    try { token = String(deps.gcloudToken()).trim(); } catch { token = ''; }
    if (!token) throw new ErrorDeUso('gcloud no entregó un token (¿hace falta `gcloud auth login`?). No se muestra ningún valor.');
    return { clave: null, token, nombre: `gcloud (proyecto ${opciones.vertex}, ${opciones.locacion})` };
  }
  const leerEnv = (archivo) => {
    const texto = deps.leerArchivo(archivo);
    if (texto === null || texto === undefined) return {};
    const salida = {};
    for (const linea of String(texto).split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linea);
      if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return salida;
  };
  const env = { ...leerEnv('.env'), ...leerEnv(opciones.env) };
  const nombre = CANDIDATAS.find((k) => env[k]);
  if (!nombre) {
    throw new ErrorDeUso('No hay clave del modelo en el entorno. Se buscaron, por nombre: ' + CANDIDATAS.join(', ')
      + ' (en .env y en ' + limpiarSecretos(opciones.env).slice(0, 80) + '; no se muestra ningún contenido). Usa --vertex <proyecto> o --seco.');
  }
  return { clave: env[nombre], token: null, nombre: `variable ${nombre} del entorno` };
}

// ------------------------------------------------------------------------------------------------------- el motor
// Un n8n minimo para estos flujos: recorre `connections` con `executionOrder: v1` (cada rama termina entera antes de la
// siguiente: de arriba abajo y, a igual altura, de izquierda a derecha). Corre Code, IF v2 y Set; el resto (HTTP, Google
// Sheets, Gemini de medios) responde con un DOBLE por nombre de nodo. Es la misma idea que `admin/pruebas/lib/n8n-de-mentira.ts`
// (no se importa: aquel es TypeScript de pruebas), reducida a lo que usa este flujo y con dobles asincronos para poder llamar
// al modelo de verdad.
class FalloDeNodo extends Error {
  constructor(nodo, causa) { super(`falló el nodo «${nodo}»: ${mensajeDe(causa)}`); this.name = 'FalloDeNodo'; this.nodo = nodo; this.causa = causa; }
}
class SinDoble extends Error {
  constructor(nodo, tipo) { super(`el nodo de red «${nodo}» (${tipo}) no tiene doble en la batería`); this.name = 'SinDoble'; this.nodo = nodo; }
}

/** Corre el cuerpo de un nodo Code como lo correria n8n (`$input`, `$('Nodo')`), sin los globales que n8n no tiene. */
function ejecutarCodigo(codigo, entradas, refs, globales = {}) {
  const lista = (r) => (r === undefined ? [] : Array.isArray(r) ? r : [r]);
  const entrada = { all: () => entradas.map((json) => ({ json })), first: () => ({ json: entradas[0] }), item: { json: entradas[0] } };
  const $ = (n) => {
    const l = lista(refs[n]);
    return { first: () => ({ json: l[0] ?? {} }), all: () => l.map((json) => ({ json })), item: { json: l[0] ?? {} }, isExecuted: n in refs };
  };
  const propios = Object.keys(globales);
  const vacios = GLOBALES_FUERA.filter((g) => !propios.includes(g));
  // Se ejecuta el codigo VERSIONADO del flujo, en una herramienta que no corre en ningun servidor: la alternativa (copiar la
  // logica de los nodos) dejaria la bateria midiendo otra cosa. Excepcion deliberada, igual que `admin/pruebas/lib/flujo.ts`.
  // OJO: ocultar los globales como parametros es de FIDELIDAD (que el Code vea lo que ve n8n), no un aislamiento de seguridad:
  // `globalThis.fetch` y `globalThis.process` siguen al alcance del codigo. Es codigo del propio repositorio; con `--vertex` se corre
  // solo sobre ramas ya revisadas. Si esta bateria entrara a CI con credenciales, pasarla a `node:vm` con un contexto vacio.
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', ...vacios, ...propios, codigo);
  const salida = fn(entrada, $, ...vacios.map(() => undefined), ...propios.map((n) => globales[n]));
  return salida.map((x) => x.json);
}

const RE_ITEM = /\$\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)\s*\.item\b/g;
const esSintaxis = (e) => e instanceof SyntaxError || (e instanceof Error && e.name === 'SyntaxError');

/** Evalua el texto de una plantilla de n8n (lo que sigue al `=`): literal y `{{ … }}`. El cierre es el primer `}}` desde el que compila. */
function plantilla(texto, evaluarUna) {
  const partes = [];
  let i = 0;
  for (;;) {
    const ini = texto.indexOf('{{', i);
    if (ini < 0) { partes.push({ literal: texto.slice(i), esExpresion: false }); break; }
    partes.push({ literal: texto.slice(i, ini), esExpresion: false });
    let desde = ini + 2;
    let primerError = null;
    for (;;) {
      const cierre = texto.indexOf('}}', desde);
      if (cierre < 0) throw primerError ?? new Error(`expresión sin cerrar: ${texto.slice(ini, ini + 60)}`);
      try {
        partes.push({ valor: evaluarUna(texto.slice(ini + 2, cierre)), esExpresion: true });
        i = cierre + 2;
        break;
      } catch (e) {
        if (!esSintaxis(e)) throw e;
        primerError ??= e;
        desde = cierre + 1;
      }
    }
  }
  const expresiones = partes.filter((p) => p.esExpresion);
  if (expresiones.length === 1 && partes.every((p) => p.esExpresion || (p.literal ?? '').trim() === '')) return expresiones[0].valor;
  return partes.map((p) => {
    if (!p.esExpresion) return p.literal ?? '';
    const v = p.valor;
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }).join('');
}

/** El texto visible de un payload de la Graph API. */
export function textoDeEnvio(payload) {
  const tipo = payload.type;
  if (tipo === 'text') return String(objeto(payload.text).body ?? '');
  if (tipo === 'interactive') return String(objeto(objeto(payload.interactive).body).text ?? '');
  if (tipo === 'template') {
    const comps = objeto(payload.template).components ?? [];
    return comps.flatMap((c) => c.parameters ?? []).map((x) => String(x.text ?? '')).join(' | ');
  }
  return JSON.stringify(payload);
}

export function crearMundo({ flujo: original, dobles, ahoraMs: ahoraInicial, configBase }) {
  const flujo = clonar(original);
  const nodos = new Map(flujo.nodes.map((n) => [n.name, n]));
  for (const [desde, salidas] of Object.entries(flujo.connections)) {
    if (!nodos.has(desde)) throw new Error(`connections parte de un nodo que no existe: «${desde}»`);
    for (const destinos of salidas.main ?? []) for (const d of destinos ?? []) if (!nodos.has(d.node)) throw new Error(`«${desde}» conecta con un nodo que no existe: «${d.node}»`);
  }
  const set = nodos.get('Config base');
  if (!set || tipoCorto(set.type) !== 'set') throw new Error('el flujo no tiene «Config base» (un Set)');
  const lista = objeto(set.parameters.assignments).assignments ?? [];
  for (const [nombre, valor] of Object.entries(configBase)) {
    const a = lista.find((x) => x.name === nombre);
    if (a) a.value = valor;
    else lista.push({ id: `cb_${nombre}`, name: nombre, type: typeof valor === 'number' ? 'number' : 'string', value: valor });
  }

  const sd = {};
  let ahoraMs = ahoraInicial;
  let turnos = 0;
  let refs = {};

  const posicion = (nombre) => nodos.get(nombre)?.position ?? [0, 0];

  function globalesDe(it) {
    return {
      $json: it?.json ?? {},
      Date: relojFijo(ahoraMs),
      $getWorkflowStaticData: () => sd,
      $workflow: { name: flujo.name, active: true },
      $execution: { id: 'bateria', mode: 'production' },
      $env: {}, $vars: {},
      $__item: (nombre) => {
        const par = it?.linaje[nombre];
        if (par !== undefined) return { json: par };
        const l = refs[nombre];
        if (l === undefined) throw new Error(`el nodo «${nombre}» no se ejecutó: no hay ítem emparejado`);
        const arreglo = Array.isArray(l) ? l : [l];
        if (arreglo.length === 1) return { json: arreglo[0] };
        throw new Error(`sin ítem emparejado con «${nombre}» (emitió ${arreglo.length} ítems)`);
      },
    };
  }
  const evaluarUna = (expresion, it) => {
    const codigo = expresion.replace(RE_ITEM, '$__item($1$2$1)');
    return ejecutarCodigo(`return [{ json: { v: (${codigo}\n) } }];`, it ? [it.json] : [], refs, globalesDe(it))[0]?.v;
  };
  const evaluar = (valor, it) => {
    if (typeof valor === 'string') return valor.startsWith('=') ? plantilla(valor.slice(1), (e) => evaluarUna(e, it)) : valor;
    if (Array.isArray(valor)) return valor.map((v) => evaluar(v, it));
    if (valor !== null && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, evaluar(v, it)]));
    return valor;
  };

  const modoDeError = (n) => (n.onError === 'continueRegularOutput' || n.continueOnFail === true ? 'regular' : n.onError === 'continueErrorOutput' ? 'salida' : 'parar');
  function sinTolerar(n, e) {
    if (e instanceof SinDoble) throw e;
    const modo = modoDeError(n);
    if (modo === 'parar') throw e instanceof FalloDeNodo ? e : new FalloDeNodo(n.name, e);
    return modo;
  }
  const hijoDe = (n, it, json) => ({ json, linaje: { ...it.linaje, [n.name]: json } });
  async function porItem(n, items, fn) {
    const bien = []; const mal = [];
    for (const it of items) {
      try { for (const json of await fn(it)) bien.push(hijoDe(n, it, json)); }
      catch (e) { const modo = sinTolerar(n, e); (modo === 'salida' ? mal : bien).push(hijoDe(n, it, { error: mensajeDe(e) })); }
    }
    return modoDeError(n) === 'salida' ? [bien, mal] : [bien];
  }
  function fallaEntero(n, items, e) {
    const modo = sinTolerar(n, e);
    const errores = items.map((it) => hijoDe(n, it, { error: mensajeDe(e) }));
    return modo === 'salida' ? [[], errores] : [errores];
  }

  // --- IF v2
  function validarTipo(v, tipo, estricto) {
    if (v === null || v === undefined) return v;
    if (tipo === 'string') { if (typeof v === 'string') return v; if (estricto || typeof v === 'object') throw new Error(`tipo equivocado: ${JSON.stringify(v)} no es un string`); return String(v); }
    if (tipo === 'number') {
      if (typeof v === 'number') return v;
      if (!estricto && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
      throw new Error(`tipo equivocado: ${JSON.stringify(v)} no es un number`);
    }
    if (tipo === 'boolean') {
      if (typeof v === 'boolean') return v;
      if (!estricto) { if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true'; if (v === 0 || v === 1) return v === 1; }
      throw new Error(`tipo equivocado: ${JSON.stringify(v)} no es un boolean`);
    }
    throw new Error(`la batería no soporta condiciones de tipo «${tipo}»`);
  }
  function evaluarCondicion(cond, it, estricto, sensible) {
    const operador = objeto(cond.operator);
    const tipo = String(operador.type); const operacion = String(operador.operation);
    const l = validarTipo(evaluar(cond.leftValue, it), tipo, estricto);
    const r = operador.singleValue === true ? undefined : validarTipo(evaluar(cond.rightValue, it), tipo, estricto);
    const vacio = l === undefined || l === null || l === '';
    if (operacion === 'exists') return l !== undefined && l !== null;
    if (operacion === 'notExists') return l === undefined || l === null;
    if (operacion === 'empty') return vacio;
    if (operacion === 'notEmpty') return !vacio;
    if (tipo === 'boolean') {
      if (operacion === 'true') return l === true;
      if (operacion === 'false') return l === false;
      if (operacion === 'equals') return l === r;
      if (operacion === 'notEquals') return l !== r;
    } else if (tipo === 'number') {
      if (operacion === 'equals') return l === r;
      if (operacion === 'notEquals') return l !== r;
      if (l === undefined || l === null || r === undefined || r === null) return false;
      if (operacion === 'gt') return l > r;
      if (operacion === 'gte') return l >= r;
      if (operacion === 'lt') return l < r;
      if (operacion === 'lte') return l <= r;
    } else if (tipo === 'string') {
      const f = (x) => (sensible ? String(x ?? '') : String(x ?? '').toLowerCase());
      const a = f(l); const b = f(r);
      switch (operacion) {
        case 'equals': return a === b;
        case 'notEquals': return a !== b;
        case 'contains': return a.includes(b);
        case 'notContains': return !a.includes(b);
        case 'startsWith': return a.startsWith(b);
        case 'endsWith': return a.endsWith(b);
        case 'regex': case 'notRegex': {
          const texto = String(r ?? '');
          const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(texto);
          const encaja = new RegExp(m ? m[1] : texto, m ? m[2] : '').test(String(l ?? ''));
          return operacion === 'regex' ? encaja : !encaja;
        }
        default: break;
      }
    }
    throw new Error(`la batería no soporta la operación «${tipo}.${operacion}» del IF`);
  }
  function ejecutarIf(n, items) {
    const p = n.parameters; const c = objeto(p.conditions);
    if (!Array.isArray(c.conditions)) throw new FalloDeNodo(n.name, 'IF sin `conditions` v2');
    const estricto = (objeto(c.options).typeValidation ?? 'strict') === 'strict' && p.looseTypeValidation !== true;
    const sensible = objeto(c.options).caseSensitive !== false;
    const o = c.combinator === 'or';
    const si = []; const no = [];
    try {
      for (const it of items) {
        let resultado = !o;
        for (const cond of c.conditions) {
          const v = evaluarCondicion(cond, it, estricto, sensible);
          if (o && v) { resultado = true; break; }
          if (!o && !v) { resultado = false; break; }
        }
        (resultado ? si : no).push(hijoDe(n, it, it.json));
      }
    } catch (e) { return fallaEntero(n, items, e); }
    return [si, no];
  }

  // --- Set v3.4
  function convertirTipo(v, tipo, nombre) {
    if (v === undefined || v === null) return v;
    if (tipo === 'number') { const x = typeof v === 'number' ? v : Number(v); if (Number.isNaN(x) || (typeof v === 'string' && v.trim() === '')) throw new Error(`Set: «${nombre}» no es un número`); return x; }
    if (tipo === 'boolean') { if (typeof v === 'boolean') return v; if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true'; return v === 1; }
    if (tipo === 'object' || tipo === 'array') return typeof v === 'string' ? JSON.parse(v) : v;
    if (tipo === 'string') return typeof v === 'object' ? JSON.stringify(v) : String(v);
    return v;
  }
  function ejecutarSet(n, it) {
    const p = n.parameters;
    if ((p.mode ?? 'manual') !== 'manual') throw new Error('la batería solo soporta Set en modo manual');
    const salida = p.includeOtherFields === true ? clonar(it.json) : {};
    for (const a of objeto(p.assignments).assignments ?? []) salida[String(a.name)] = convertirTipo(evaluar(a.value, it), String(a.type ?? 'string'), String(a.name));
    return salida;
  }

  function ejecutarCode(n, items) {
    const p = n.parameters;
    if (p.mode === 'runOnceForEachItem') throw new FalloDeNodo(n.name, 'la batería no soporta Code en modo runOnceForEachItem');
    let salida;
    try {
      salida = ejecutarCodigo(String(p.jsCode), items.map((i) => clonar(i.json)), refs, {
        $getWorkflowStaticData: () => sd, Date: relojFijo(ahoraMs),
        $workflow: { name: flujo.name, active: true }, $execution: { id: 'bateria', mode: 'production' },
      });
      if (salida.some((x) => x === null || typeof x !== 'object' || Array.isArray(x))) throw new Error('el código no devolvió ítems con la forma { json: { … } }');
    } catch (e) { return fallaEntero(n, items, e); }
    return [salida.map((json, i) => {
      const origen = items.length === salida.length ? items[i] : items.length === 1 ? items[0] : undefined;
      return origen ? hijoDe(n, origen, json) : { json, linaje: { [n.name]: json } };
    })];
  }

  // --- los dobles
  function cuerpoDeRed(p) {
    if (p.sendBody === false) return undefined;
    const jb = p.jsonBody;
    if (jb === undefined || jb === null) return undefined;
    if (typeof jb === 'string') {
      if (jb.trim() === '') return undefined;
      try { return JSON.parse(jb); } catch { throw new Error(`jsonBody no es JSON válido: ${jb.slice(0, 80)}`); }
    }
    return clonar(jb);
  }
  async function correrDoble(n, it, doble) {
    const parametros = evaluar(n.parameters, it);
    const pares = objeto(parametros.headerParameters).parameters;
    const encabezados = Array.isArray(pares) ? Object.fromEntries(pares.map((x) => [String(x.name), String(x.value)])) : {};
    const llamada = { nodo: n.name, parametros, cuerpo: cuerpoDeRed(parametros), url: String(parametros.url ?? ''), encabezados, item: clonar(it.json) };
    const r = await doble(llamada);
    return (Array.isArray(r) ? r : [r === undefined ? {} : r]).map((x) => clonar(x));
  }

  async function ejecutarNodo(n, entradas) {
    const items = n.executeOnce === true ? entradas.slice(0, 1) : entradas;
    const doble = dobles[n.name];
    let salidas;
    if (doble !== undefined) salidas = await porItem(n, items, (it) => correrDoble(n, it, doble));
    else {
      switch (tipoCorto(n.type)) {
        case 'code': salidas = ejecutarCode(n, items); break;
        case 'if': salidas = ejecutarIf(n, items); break;
        case 'set': salidas = await porItem(n, items, (it) => [ejecutarSet(n, it)]); break;
        case 'noOp': salidas = [items.map((it) => hijoDe(n, it, it.json))]; break;
        default: throw new SinDoble(n.name, n.type);
      }
    }
    const primera = salidas[0];
    if (n.alwaysOutputData === true && primera && primera.length === 0 && items[0]) primera.push(hijoDe(n, items[0], {}));
    return salidas;
  }

  function entradaDelFlujo(via) {
    // `via` (opcional, lo usa la bateria de Venta minima, que tiene dos Webhooks): el disparador que se pide por su nombre.
    if (via !== undefined) {
      if (!nodos.has(via)) throw new Error(`la entrada «${via}» no existe en el flujo`);
      return via;
    }
    const reciben = new Set();
    for (const s of Object.values(flujo.connections)) for (const ds of s.main ?? []) for (const d of ds ?? []) reciben.add(d.node);
    const raices = Object.entries(flujo.connections).filter(([desde, s]) => !reciben.has(desde) && (s.main ?? []).some((d) => (d ?? []).length > 0)).map(([d]) => d);
    const conocida = ['WhatsApp Trigger', 'Entrada de prueba', 'Entrega del receptor'].find((c) => raices.includes(c));
    if (!conocida) throw new Error(`no se sabe cuál es la entrada del flujo (raíces: ${raices.join(', ') || 'ninguna'})`);
    return conocida;
  }

  /** Un turno: una entrada de WhatsApp (el `value` de Meta) por el disparador. Un fallo de nodo queda en `fallo` y el turno termina ahí. */
  async function turno(entrada, avanzarMin = turnos > 0 ? 1 : 0, via0 = undefined) {
    ahoraMs += avanzarMin * 60_000;
    turnos++;
    const via = entradaDelFlujo(via0);
    refs = {};
    const orden = [];
    const porNodo = {};
    const resultado = { orden, porNodo, fallo: null };
    let visitas = 0;
    async function visitar(nombre, items) {
      if (!items.length) return;
      if (++visitas > 1000) throw new Error(`más de 1.000 nodos visitados en un turno (¿un ciclo?), último: «${nombre}»`);
      const n = nodos.get(nombre);
      orden.push(nombre);
      const salida = nombre === via ? [items] : await ejecutarNodo(n, items);
      refs[nombre] = salida.flat().map((i) => i.json);
      porNodo[nombre] = [...(porNodo[nombre] ?? []), ...salida.flat().map((i) => i.json)];
      const conexiones = flujo.connections[nombre]?.main ?? [];
      const destinos = [];
      salida.forEach((its, idx) => { for (const d of conexiones[idx] ?? []) destinos.push({ nodo: d.node, items: its, orden: destinos.length }); });
      destinos.sort((a, b) => (posicion(a.nodo)[1] - posicion(b.nodo)[1]) || (posicion(a.nodo)[0] - posicion(b.nodo)[0]) || (a.orden - b.orden));
      for (const d of destinos) await visitar(d.nodo, d.items);
    }
    try {
      const json = clonar(entrada);
      await visitar(via, [{ json, linaje: { [via]: json } }]);
    } catch (e) {
      if (!(e instanceof FalloDeNodo)) throw e;
      resultado.fallo = { nodo: e.nodo, mensaje: limpiarSecretos(mensajeDe(e.causa)).slice(0, 200) };
    }
    return resultado;
  }
  return { turno, sd };
}

// ------------------------------------------------------------------------------------------------------- el modelo
export const textoDeGemini = (r) => {
  const partes = r && typeof r === 'object' && Array.isArray(r.candidates) ? r.candidates[0]?.content?.parts : null;
  return Array.isArray(partes) ? partes.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
};
export const objetoDelTexto = (t) => {
  const s = String(t ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

/** La respuesta real: `generateContent` por AI Studio (clave en el encabezado) o por Vertex (token). Reintenta como el nodo (2 intentos). */
export async function llamarGemini({ cuerpo, urlDelNodo, credencial, opciones, deps, nodo }) {
  const modelo = /\/models\/([A-Za-z0-9._-]+):generateContent$/.exec(urlDelNodo)?.[1];
  if (!modelo) throw new Error('La URL de «Llamar al modelo» no es de generateContent: no se llama.');
  let url; let cabeceras;
  if (opciones.vertex) {
    const host = opciones.locacion === 'global' ? 'aiplatform.googleapis.com' : `${opciones.locacion}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${opciones.vertex}/locations/${opciones.locacion}/publishers/google/models/${modelo}:generateContent`;
    cabeceras = { 'Content-Type': 'application/json', Authorization: `Bearer ${credencial.token}` };
  } else {
    // La clave SOLO va a este anfitrion: si el nodo apuntara a otro, no se envia.
    if (new URL(urlDelNodo).hostname !== HOST_AI_STUDIO) throw new Error('«Llamar al modelo» no apunta a generativelanguage.googleapis.com: no se envía la clave.');
    url = urlDelNodo;
    cabeceras = { 'Content-Type': 'application/json', 'x-goog-api-key': credencial.clave };
  }
  const secretos = [credencial.clave, credencial.token];
  const intentos = Math.max(1, Number(nodo.maxTries) || 2);
  const espera = Number(nodo.waitBetweenTries) || 1500;
  const timeout = Number(objeto(nodo.parameters.options).timeout) || 15000;
  const t0 = globalThis.performance.now();
  let error = 'sin respuesta';
  let httpCode = '';
  for (let i = 1; i <= intentos; i++) {
    let reintentable = true;
    try {
      const r = await deps.fetch(url, { method: 'POST', headers: cabeceras, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(timeout) });
      const texto = await r.text();
      if (r.ok) {
        let json = null;
        try { json = JSON.parse(texto); } catch { json = null; }
        if (json && typeof json === 'object') return { json, ms: globalThis.performance.now() - t0, reintentos: i - 1 };
        error = 'la respuesta no es JSON'; httpCode = String(r.status);
      } else {
        httpCode = String(r.status);
        error = `HTTP ${r.status}: ${limpiarSecretos(texto, secretos).replace(/\s+/g, ' ').slice(0, 140)}`;
        reintentable = r.status === 429 || r.status >= 500;
      }
    } catch (e) {
      error = limpiarSecretos(mensajeDe(e), secretos).slice(0, 140);
    }
    if (!reintentable || i === intentos) break;
    await dormir(espera);
  }
  return { json: { error: { message: error, httpCode } }, ms: globalThis.performance.now() - t0, reintentos: intentos - 1, fallo: true };
}

// ------------------------------------------------------------------------------------------------------- la biblioteca del flujo y los datos
/** Las funciones y patrones de la biblioteca del flujo (`src/lib/chat.js`) y las `cm*` comunes, en un contexto aislado (sin los globales de Node, como el Code de n8n). */
export function cargarLibreria() {
  const fuente = [RUTA_LIB, RUTA_MENSAJES, RUTA_FILTRO].map((r) => readFileSync(r, 'utf8')).join('\n');
  const nombres = ['chNorm', 'chContar', 'chSistemaAjeno', 'chObjetoDelModelo', 'chTerminaBien', 'chPlano', 'chSimilitud', 'CH_ACREDITA_MODELO', 'CH_CIFRA_DE_CONSUMO', 'CH_SISTEMA_CONOCIDO', 'CH_BLOQUEO_COMUN', 'CH_OFERTA_DEL_MODELO'];
  return runInNewContext(`${fuente}\n({ ${nombres.join(', ')} })`, {});
}
const datosDelChat = () => JSON.parse(readFileSync(RUTA_DATOS, 'utf8')).datos;

// ------------------------------------------------------------------------------------------------------- reglas duras sobre lo que el cliente RECIBE
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const palabrasDe = (s) => String(s).replace(/https?:\/\/\S+/g, ' ').split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
const sinTildes = (t) => String(t ?? '').normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const botonesDe = (p) => ((objeto(objeto(p.interactive).action).buttons ?? [])).map((b) => String(objeto(b.reply).id));
const titulosDe = (p) => ((objeto(objeto(p.interactive).action).buttons ?? [])).map((b) => String(objeto(b.reply).title));
const filasDe = (p) => ((objeto(objeto(p.interactive).action).sections ?? [])).flatMap((s) => (s.rows ?? []));
const tipoInter = (p) => String(objeto(p.interactive).type ?? '');
const CIERRE_EXACTO = '¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝';

// Promesas de contacto (decisión D2): ni «se comunique», ni «te contacte», ni una llamada, ni «te escribimos».
const PROMESAS_DE_CONTACTO = /\bse comunique\b|\bte contacte\b|\bcontacte contigo\b|\bte (escribir[aá]n|llamar[aá]n|contactar[aá]n|llamamos|escribimos|avisamos|contactamos|avisar[eé]|avisaremos)\b|\b(se|nos) (comunicar[aá]n?|pondr[aá]n? en contacto)\b|\blo consulto\b|\bte aviso\b|\bte llamar[aá]\b|\bte escribir[aá]\b|\bllamada\b|\bte (llama|llaman|llamen)\b/i;
const NIEGA_IA = /\bno soy (un |una )?(bot|robot|ia|inteligencia artificial|asistente virtual)\b|\bsoy (una )?persona (real|de carne)|\bsoy (un )?humano\b/i;
const VOSEO = /(?<![\p{L}])(quer[eé]s|ten[eé]s|pod[eé]s|dec[ií]me|cont[aá]me|escrib[ií]me|mirá|fijate|pasame|avisame|che|vos)(?![\p{L}])/iu;
const USTED = /(?<![\p{L}])(usted|ustedes|le (ayudo|puedo|ofrezco|cuento|comento|paso|aviso)|su (negocio|empresa|consulta|local)|mire)(?![\p{L}])/iu;
const COBRO_REAL = /pago (acreditado|verificado|recibido|confirmado)|recibimos tu pago|pago exitoso/i;
const MULETILLA = /^[¡!\s]*(te entiendo|qu[eé] bueno que quieras conocer m[aá]s detalles|claro|entiendo|perfecto|ok|genial)[.!¡\s\p{Extended_Pictographic}️]*$/iu;
const VALIDA_CON_EL_BANCO = /\b(valida|validan|verifica|verifican|acredita|acreditan|confirma|confirman|consulta|consultan|cruza|cruzan)\w*\b[^.!?]{0,40}\b(banco|pagos?|transferencias?|depositos?|comprobantes?)\b[^.!?]{0,30}\bcon el banco\b|\bpago (acreditado|verificado|validado|confirmado|recibido)\b|\b(consulta|cruza)\w* (con )?el banco\b/;
const ENLACE = /(https?:\/\/|www\.|wa\.me\/)[^\s)»"]*/gi;
// Los mensajes del sistema que NO llevan los dos botones: la lista de rubros, el traspaso (su botón es el enlace a recepción) y los avisos de comercio suspendido y de uso extendido.
const SIN_DOS_BOTONES = new Set(['lista', 'lista_otro', 'traspaso', 'suspendido', 'uso_extendido']);

/**
 * Las violaciones de las reglas duras sobre UN mensaje que el cliente RECIBE. `m` = { tipo, payload, cuerpo, evento, esRespaldo }; `ctx` = { lib, origen, contexto }.
 * La plantilla de aviso va a recepción, no al cliente: no se revisa aquí. Devuelve [{ regla, texto }].
 */
export function revisarMensaje(m, ctx = {}) {
  if (m.tipo === 'template') return [];
  const v = [];
  const lib = ctx.lib ?? cargarLibreria();
  const c = String(m.cuerpo ?? '');
  const n = sinTildes(c);
  const anota = (regla, texto = c) => v.push({ regla, texto: String(texto).replace(/\s+/g, ' ').slice(0, 200) });
  let decodificado = JSON.stringify(m.payload ?? {});
  try { decodificado = decodeURIComponent(decodificado); } catch { /* una URL con un % suelto: se revisa el crudo */ }
  if (/silvana|asesora\b/i.test(decodificado + ' ' + c)) anota('nombre_de_persona_del_equipo');
  if (PROMESAS_DE_CONTACTO.test(c)) anota('promesa_de_contacto');
  if (NIEGA_IA.test(c)) anota('niega_ser_ia');
  if (VOSEO.test(c)) anota('voseo');
  if (COBRO_REAL.test(c)) anota('cobro_acreditado');
  if (MULETILLA.test(c)) anota('muletilla');
  if (/minicrm|kanban|leads de ventas/i.test(c)) anota('minicrm_o_leads_de_ventas');
  if (/menos de un minuto/i.test(c)) anota('menos_de_un_minuto');
  // El complemento de los planes (R6) trae a propósito la moneda, los tamaños de agendas y de catálogo y las categorías «ERP, CRM»: solo se le exige no dar cifras de conversaciones ni de consumo.
  const esComplemento = m.evento === 'planes_complemento';
  // Ningún dígito salvo «24/7», «24 horas» y las cifras del mensaje de planes que arma el código (65, 125 y 25 de la consola de ejemplo).
  if (!esComplemento && /\d/.test(c.replace(ENLACE, ' ').replace(/\b24\s*\/\s*7\b|\b24\s+horas\b/gi, ' ').replace(/USD (65|125|25)\b/g, ' '))) anota('digitos_de_mas');
  if (esComplemento ? /\d+\s+(conversaciones?|mensajes?|interacciones?|respuestas?|chats?)\b|ilimitad|gratis/.test(n) : lib.CH_CIFRA_DE_CONSUMO.test(n)) anota('cifra_de_consumo');
  if (VALIDA_CON_EL_BANCO.test(n) || lib.CH_ACREDITA_MODELO.test(n.replace(/\bno lo valida con el banco\b/g, ' ').replace(/\bquien confirma que el dinero entro es\b[^.!?]*/g, ' '))) anota('valida_pagos_con_el_banco');
  if (!esComplemento && lib.CH_SISTEMA_CONOCIDO.test(n)) anota('sistema_ajeno_o_integracion_inventada');
  if (!esComplemento && (lib.CH_BLOQUEO_COMUN.test(n) || lib.CH_OFERTA_DEL_MODELO.test(n) || /\bgratis\b|\bdescuento/.test(n))) anota('gratuidad_oferta_o_costo_de_meta_minimizado');
  for (const e of c.match(ENLACE) ?? []) {
    const ok = new RegExp(`^(https://)?wa\\.me/${esc(REC)}(\\?.*)?$`, 'i').test(e) || e.startsWith(ARCHIVO.url);
    if (!ok) anota('enlace');
  }
  if (c.length > 1024) anota('cuerpo_mayor_a_1024');
  if (m.tipo === 'interactive') {
    const t = tipoInter(m.payload);
    if (t === 'button') {
      // R5: los botones salen según lo ya hecho. Antes de ver los planes, los dos; ya vistos, SOLO «Hablar con el equipo»; tras el traspaso, ninguno (la lista de rubros).
      const ids = botonesDe(m.payload).join();
      const tit = titulosDe(m.payload).join();
      const dos = ids === 'planes,equipo' && tit === 'Ver planes,Hablar con el equipo';
      const uno = ids === 'equipo' && tit === 'Hablar con el equipo';
      if (!dos && !uno) anota('botones_incorrectos', botonesDe(m.payload).join('+'));
      else if (dos && ctx.planesVistos === true) anota('ver_planes_cuando_ya_los_vio', ids);
      else if (uno && ctx.planesVistos === false) anota('botones_incorrectos', 'solo «Hablar con el equipo» sin haber visto los planes');
      if (ctx.equipoHecho === true) anota('boton_del_equipo_otra_vez', ids);
    } else if (t === 'list') {
      for (const f of filasDe(m.payload)) if (!String(f.description ?? '').trim() || String(f.title).length > 24 || String(f.description).length > 72) anota('fila_sin_descripcion_o_demasiado_larga', JSON.stringify(f));
    }
    if (t !== 'button' && !SIN_DOS_BOTONES.has(m.evento) && !m.esRespaldo && !(t === 'list' && ctx.equipoHecho === true)) anota('sin_los_dos_botones', `evento ${m.evento}`);
  } else if (!SIN_DOS_BOTONES.has(m.evento) && !m.esRespaldo) anota('sin_los_dos_botones', `un texto sin botones (evento ${m.evento})`);
  // Lo que escribió el MODELO: contenido (no una muletilla ni una línea) y cierre con una pregunta o la invitación a elegir.
  if (ctx.origen === 'modelo' && ctx.contexto !== 'cortesia') {
    // El mismo mínimo que el flujo: 25 palabras (10 cuando se pregunta algo corto: «Otro», los datos o un medio ilegible).
    if (palabrasDe(c) < (['otro', 'datos', 'medio'].includes(ctx.contexto) ? 10 : 25)) anota('sin_contenido');
    // (tras el traspaso el mensaje es una lista: la invitación a otro negocio va al final y el cierre se mide sobre la respuesta)
    const cuerpoModelo = m.evento === 'lista_otro' || (tipoInter(m.payload) === 'list' && ctx.equipoHecho === true) ? c.split('\n\n').slice(0, -1).join('\n\n') || c : c;
    if (!lib.chTerminaBien(cuerpoModelo)) anota('sin_cierre');
  }
  // Un rubro estándar explicado cierra con la pregunta EXACTA del documento.
  if (ctx.contexto === 'rubro' && m.evento !== 'lista' && !n.endsWith(sinTildes(CIERRE_EXACTO).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim())) {
    if (!sinTildes(c).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().endsWith(sinTildes(CIERRE_EXACTO).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim())) anota('rubro_sin_la_pregunta_exacta');
  }
  return v;
}
/** El tono (no son reglas duras): voseo y trato de usted en lo que recibe el cliente. */
export function tonoDe(texto) {
  const c = String(texto ?? '');
  return { voseo: VOSEO.test(c), usted: USTED.test(c) };
}

// ------------------------------------------------------------------------------------------------------- una conversación
const mensajeDeMeta = (t, wamid, cliente) => {
  const base = { from: cliente, id: wamid, timestamp: '1' };
  if (t.tipo === 'texto') return { ...base, type: 'text', text: { body: t.texto } };
  if (t.tipo === 'fila') return { ...base, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: t.id, title: t.titulo ?? t.id } } };
  if (t.tipo === 'boton') return { ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: t.id, title: t.titulo ?? t.id } } };
  if (t.tipo === 'audio') return { ...base, type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true } };
  if (t.tipo === 'imagen') return { ...base, type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', ...(t.pie ? { caption: t.pie } : {}) } };
  if (t.tipo === 'documento') return { ...base, type: 'document', document: { id: 'media-doc', mime_type: 'application/pdf', filename: 'archivo.pdf' } };
  if (t.tipo === 'ubicacion') return { ...base, type: 'location', location: { latitude: -16.5, longitude: -68.1, name: 'Mi casa' } };
  if (t.tipo === 'sticker') return { ...base, type: 'sticker', sticker: { id: 'media-stk', mime_type: 'image/webp' } };
  throw new Error('tipo de turno desconocido: ' + t.tipo);
};
const valorMeta = (msg, cliente, perfil) => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: PID, phone_number_id: PID },
  contacts: [{ profile: { name: perfil ?? 'Ana Prueba' }, wa_id: cliente }],
  messages: [msg],
});
const dichoDe = (t) => (t.tipo === 'texto' ? t.texto : t.tipo === 'audio' ? `(audio) ${t.transcripcion}` : t.tipo === 'imagen' ? `(imagen) ${t.pie ?? ''}` : t.tipo === 'rafaga' ? `(ráfaga) ${t.eventos.map(dichoDe).join(' + ')}` : t.tipo === 'fila' || t.tipo === 'boton' ? `(toque) ${t.id}` : `(${t.tipo})`);
const MODELO_BASE = { mensaje: '', accion: 'ninguna', rubro: 'ninguno', necesidad: '', nombre: '', empresa: '', descarte: 'ninguno' };
const respuestaDeGemini = (texto) => ({ candidates: [{ content: { parts: [{ text: texto }] } }] });
const respuestaSeca = (s) => (s === 'ERROR' ? { error: { message: 'simulado', httpCode: '503' } } : typeof s === 'string' ? respuestaDeGemini(s) : respuestaDeGemini(JSON.stringify({ ...MODELO_BASE, ...(s ?? {}) })));

/** Una corrida (un caso, una repetición): mundos nuevos con SU estado compartido (hoja, captura), su reloj y su teléfono. */
export async function correrCaso({ caso, rep, flujo, lib, opciones, credencial, deps }) {
  const CLIENTE = (caso.opciones ?? {}).desde === 'recepcion' ? REC : telefonoDe(caso.id, rep);
  const panel = panelDe(caso.opciones ?? {});
  const comp = { hoja: { filas: [] }, formulas: [], captura: { mensajes: [], modelo: [] }, seqSalida: 0, esperas: 0 };
  const celdas = (f) => Object.fromEntries(ENC.map((h, c) => [h, f[c] ?? '']));
  const celda = (valor, formato) => {
    const v = String(valor ?? '');
    if (formato === 'USER_ENTERED') {
      if (v.startsWith("'")) return v.slice(1);
      if (/^[=+\-@]/.test(v)) comp.formulas.push(v);
    }
    return v;
  };
  const aceptado = () => ({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: `wamid.OUT${++comp.seqSalida}` }] });
  const envio = (nodo) => (ll) => {
    const payload = ll.cuerpo ?? {};
    comp.captura.mensajes.push({ nodo, a: String(payload.to ?? ''), tipo: String(payload.type ?? ''), payload, cuerpo: textoDeEnvio(payload), evento: String(ll.item.evento ?? ''), esRespaldo: nodo !== 'Enviar a WhatsApp' });
    return aceptado();
  };

  /** Un mundo (una ejecución de n8n) con el doble de cada nodo de red; `act` dice qué evento le toca (para los medios y el modelo simulado). */
  function mundoNuevo(act, ahoraMs) {
    const modeloDe = (nombre) => async (ll) => {
      const t = act.t;
      if (opciones.seco) {
        const s = nombre === 'Reintentar el modelo' && t?.seco2 !== undefined ? t.seco2 : t?.seco;
        const resp = respuestaSeca(s ?? 'ERROR');
        comp.captura.modelo.push({ nodo: nombre, cuerpo: ll.cuerpo, crudo: resp, uso: null, ms: 0, reintentos: 0 });
        return resp;
      }
      const r = await llamarGemini({ cuerpo: ll.cuerpo, urlDelNodo: ll.url, credencial, opciones, deps, nodo: flujo.nodes.find((n) => n.name === nombre) });
      const u = objeto(r.json.usageMetadata);
      const uso = r.fallo ? null : { entrada: Number(u.promptTokenCount) || 0, salida: Number(u.candidatesTokenCount) || 0, cacheados: Number(u.cachedContentTokenCount) || 0, razonamiento: Number(u.thoughtsTokenCount) || 0 };
      comp.captura.modelo.push({ nodo: nombre, cuerpo: ll.cuerpo, crudo: r.json, uso, ms: r.ms, reintentos: r.reintentos });
      return r.json;
    };
    const dobles = {
      'Traer configuración': () => ({ statusCode: 200, body: panel }),
      'Reportar mensaje (entrante)': () => ({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } }),
      'Reportar mensaje (saliente)': () => ({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } }),
      'Obtener URL del medio (general)': () => ({ id: 'm', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/medio-1', mime_type: 'audio/ogg', file_size: 5000 }),
      'Descargar medio': () => ({ descargado: true }),
      'Transcribir audio': () => ({ content: { parts: [{ text: String(act.t?.transcripcion ?? '') }] } }),
      'Describir imagen': () => ({ content: { parts: [{ text: JSON.stringify({ categoria: act.t?.categoria === 'comprobante' ? 'comprobante' : 'otro', texto: String(act.t?.lectura ?? '') }) }] } }),
      'Describir documento': () => ({ content: { parts: [{ text: JSON.stringify({ categoria: act.t?.categoria === 'comprobante' ? 'comprobante' : 'otro', texto: String(act.t?.lectura ?? '') }) }] } }),
      'Esperar ráfaga': async (ll) => { comp.esperas += 1; if (act.alEsperar) await act.alEsperar(); return ll.item; },
      'Llamar al modelo': modeloDe('Llamar al modelo'),
      'Reintentar el modelo': modeloDe('Reintentar el modelo'),
      'Enviar a WhatsApp': envio('Enviar a WhatsApp'),
      'Enviar respaldo': envio('Enviar respaldo'),
      'Buscar teléfono en planilla': (ll) => {
        const valores = ((objeto(ll.parametros.filtersUI).values) ?? []).map((v) => String(v.lookupValue ?? ''));
        const k = comp.hoja.filas.findIndex((f) => valores.includes(String(f[4] ?? '')));
        return k < 0 ? {} : Object.assign({ row_number: k + 2 }, Object.fromEntries(ENC.slice(0, 10).map((h, c) => [h, comp.hoja.filas[k][c] ?? ''])));
      },
      'Leer IDs de la planilla': () => (comp.hoja.filas.length ? comp.hoja.filas.map((f, j) => ({ row_number: j + 2, 'ID Lead': f[0] ?? '' })) : [{}]),
      'Agregar fila': (ll) => {
        const formato = String(objeto(ll.parametros.options).cellFormat ?? '');
        const fila = ENC.map((h) => (h in ll.item ? celda(ll.item[h], formato) : ''));
        comp.hoja.filas.push(fila);
        return Object.assign(celdas(fila), { row_number: comp.hoja.filas.length + 3 });
      },
      'Actualizar fila': (ll) => {
        const fila = comp.hoja.filas[Number(ll.item.row_number) - 4];
        if (!fila) return { error: { name: 'NodeApiError', message: 'la fila no existe' } };
        const formato = String(objeto(ll.parametros.options).cellFormat ?? '');
        ENC.forEach((h, c) => { if (h in ll.item) fila[c] = celda(ll.item[h], formato); });
        return Object.assign(celdas(fila), { row_number: ll.item.row_number });
      },
    };
    return crearMundo({
      flujo, dobles, ahoraMs,
      configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: (caso.opciones ?? {}).sinRecepcion ? '' : REC, planillaProspectosId: ID_PLANILLA, planillaProspectosHoja: 'Leads_CRM', mensajeComercioSuspendido: SUSPENDIDO },
    });
  }

  /** Un turno del caso: un evento, o una RÁFAGA (varios eventos seguidos = varias ejecuciones que comparten los datos estáticos y se despiertan en cadena). */
  async function correrTurno(t, i) {
    const wamid = (k) => `wamid.BAT${caso.id}.${rep}.${i + 1}.${k}`;
    if (t.tipo !== 'rafaga') {
      const act = { t };
      const mundo = mundoNuevo(act, comp.relojMs ?? AHORA);
      if (comp.sd) { for (const k of Object.keys(mundo.sd)) delete mundo.sd[k]; Object.assign(mundo.sd, clonar(comp.sd)); }
      const r = await mundo.turno(valorMeta(mensajeDeMeta(t, wamid(0), CLIENTE), CLIENTE, (caso.opciones ?? {}).perfil), 0);
      comp.sd = clonar(mundo.sd);
      comp.relojMs = (comp.relojMs ?? AHORA) + 60_000;
      return [r];
    }
    const eventos = t.eventos;
    const acts = eventos.map((e) => ({ t: { ...e, seco: t.seco, seco2: t.seco2 } }));
    const mundos = acts.map((act, k) => mundoNuevo(act, (comp.relojMs ?? AHORA) + k * 1000));
    if (comp.sd) for (const w of mundos) Object.assign(w.sd, clonar(comp.sd));
    const resultados = [];
    const sincronizar = (de, a) => { for (const k of Object.keys(a.sd)) delete a.sd[k]; Object.assign(a.sd, clonar(de.sd)); };
    // Cada mundo, al «esperar», corre el siguiente (anidado) y vuelve con los datos que dejó: las primeras ejecuciones despiertan con el estado final y terminan sin enviar nada.
    const correr = async (k) => {
      if (k + 1 < mundos.length) acts[k].alEsperar = async () => { sincronizar(mundos[k], mundos[k + 1]); await correr(k + 1); sincronizar(mundos[k + 1], mundos[k]); };
      resultados.push(await mundos[k].turno(valorMeta(mensajeDeMeta(eventos[k], wamid(k), CLIENTE), CLIENTE, (caso.opciones ?? {}).perfil), 0));
    };
    await correr(0);
    comp.sd = clonar(mundos[0].sd);
    comp.relojMs = (comp.relojMs ?? AHORA) + 60_000;
    return resultados;
  }

  const corrida = { caso: caso.id, rep, turnos: 0, llamadas: [], violaciones: [], tonos: [], mensajes: 0, plantillas: 0, fallos: [], conversacion: [], palabras: [], modeloTurnos: 0, respaldos: 0, causas: {}, esperas: 0, repeticiones: 0 };
  const falla = (turno, dicho, regla, texto) => corrida.violaciones.push({ caso: caso.id, rep, turno, dicho, regla, texto: String(texto).replace(/\s+/g, ' ').slice(0, 200) });
  for (const [i, t] of caso.turnos.entries()) {
    comp.captura = { mensajes: [], modelo: [] };
    const resultados = await correrTurno(t, i);
    corrida.turnos += 1;
    for (const r of resultados) if (r.fallo) corrida.fallos.push(`#${i + 1} «${r.fallo.nodo}»: ${r.fallo.mensaje}`);
    const resumen = resultados.flatMap((r) => (r.porNodo['Armar mensajes'] ?? []).slice(0, 1)).map((x) => objeto(x.resumen)).find((x) => x.mensajes !== undefined && (x.plan !== undefined)) ?? {};
    const alCliente = comp.captura.mensajes.filter((m) => m.a === CLIENTE && m.tipo !== 'template');
    const buenos = alCliente.filter((m) => !m.esRespaldo);
    corrida.mensajes += buenos.length;
    corrida.plantillas += comp.captura.mensajes.filter((m) => m.tipo === 'template').length;
    const dicho = dichoDe(t);
    // UN mensaje al cliente por turno del cliente (los clics seguidos de una ráfaga cuentan como UN turno).
    if (buenos.length > 1) falla(i + 1, dicho, 'mas_de_un_mensaje_por_turno', buenos.map((m) => m.cuerpo).join(' | '));
    const fichaDespues = objeto(objeto(comp.sd?.chatNovuchat)[CLIENTE]);
    // R6: lo que escribió el MODELO no calca el mensaje anterior (similitud de conjuntos de palabras >= 0,75): se cuenta y es una violación.
    const anterior = corrida.conversacion.length ? (corrida.conversacion[corrida.conversacion.length - 1].mensajes.at(-1) ?? '') : '';
    if (String(resumen.origen ?? '') === 'modelo' && buenos[0] && anterior && lib.chSimilitud(buenos[0].cuerpo, anterior) >= 0.75) { corrida.repeticiones += 1; falla(i + 1, dicho, 'repite_el_mensaje_anterior', buenos[0].cuerpo); }
    const ctx = { lib, origen: String(resumen.origen ?? ''), contexto: String(resumen.contexto ?? ''), planesVistos: fichaDespues.planesMostrados === true, equipoHecho: fichaDespues.equipoAhora === true };
    for (const m of alCliente) {
      for (const x of revisarMensaje(m, ctx)) falla(i + 1, dicho, x.regla, x.texto);
      if (!m.esRespaldo) { corrida.tonos.push(tonoDe(m.cuerpo)); corrida.palabras.push(palabrasDe(m.cuerpo)); }
    }
    if (comp.captura.modelo.length) {
      corrida.modeloTurnos += 1;
      if (resumen.origen === 'respaldo') corrida.respaldos += 1;
      for (const causa of resumen.causas ?? []) corrida.causas[causa] = (corrida.causas[causa] ?? 0) + 1;
      for (const l of comp.captura.modelo) {
        const o = lib.chObjetoDelModelo(l.crudo);
        const props = Object.keys(o ?? {});
        corrida.llamadas.push({ nodo: l.nodo, jsonValido: !!o, conforme: !!o && ['mensaje', 'accion', 'rubro', 'necesidad', 'nombre', 'empresa', 'descarte'].every((k) => props.includes(k)), errorHttp: !!objeto(l.crudo).error, uso: l.uso, ms: l.ms, reintentos: l.reintentos });
      }
    }
    // `exige`: lo que el documento y las decisiones de Andres mandan en ese turno.
    if (t.exige) {
      const todo = alCliente.filter((m) => !m.esRespaldo).map((m) => m.cuerpo).join(' | ');
      const n = (x) => sinTildes(x).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
      const ex = t.exige;
      // En modo REAL el texto lo escribe el modelo: las frases literales, el origen esperado y lo que «ve» el modelo solo tienen sentido en `--seco` (respuestas simuladas). Con modelo real se mide lo que
      // NO depende de su redacción: JSON válido, guardias (lo que no debe decir), botones, cierres, rutas y hoja. Un turno resuelto por el código (sin modelo) sí se compara literal.
      const redactaElModelo = !opciones.seco && comp.captura.modelo.length > 0;
      for (const x of redactaElModelo ? [] : [].concat(ex.contiene ?? [])) if (!n(todo).includes(n(x))) falla(i + 1, dicho, 'falta_lo_que_se_exige', `falta «${x}» en: ${todo}`);
      for (const x of [].concat(ex.noContiene ?? [])) if (n(todo).includes(n(x))) falla(i + 1, dicho, 'trae_lo_que_no_debe', `trae «${x}» en: ${todo}`);
      if (!redactaElModelo && ex.contieneAlguna !== undefined && ![].concat(ex.contieneAlguna).some((x) => n(todo).includes(n(x)))) falla(i + 1, dicho, 'falta_lo_que_se_exige', `falta alguna de ${[].concat(ex.contieneAlguna).join(' | ')} en: ${todo}`);
      if (!redactaElModelo && ex.termina !== undefined && !buenos.some((m) => [].concat(ex.termina).some((x) => n(m.cuerpo).endsWith(n(x))))) falla(i + 1, dicho, 'no_termina_como_se_exige', todo);
      if (ex.sinCifras === true && /\d/.test(todo.replace(/\b24\s*\/\s*7\b|\b24\s+horas\b/gi, ' '))) falla(i + 1, dicho, 'cifra_donde_no_va', todo);
      if (ex.imagenPlanes === true && !buenos.some((m) => objeto(objeto(m.payload).interactive).header !== undefined)) falla(i + 1, dicho, 'sin_imagen_de_planes', todo);
      if (ex.sinModelo === true && comp.captura.modelo.length) falla(i + 1, dicho, 'llamo_al_modelo_sin_necesidad', todo);
      if (ex.conModelo === true && !comp.captura.modelo.length) falla(i + 1, dicho, 'no_llamo_al_modelo', todo);
      if (ex.cta === true && !buenos.some((m) => tipoInter(m.payload) === 'cta_url')) falla(i + 1, dicho, 'sin_el_boton_de_recepcion', todo);
      if (ex.cta === false && buenos.some((m) => tipoInter(m.payload) === 'cta_url')) falla(i + 1, dicho, 'boton_a_si_mismo', todo);
      if (ex.plantillas !== undefined && comp.captura.mensajes.filter((m) => m.tipo === 'template').length !== ex.plantillas) falla(i + 1, dicho, 'avisos_a_recepcion_inesperados', `se esperaban ${ex.plantillas}`);
      if (ex.ruta !== undefined && ![].concat(ex.ruta).includes(String(resumen.plan ?? ''))) falla(i + 1, dicho, 'ruta_inesperada', `se esperaba ${[].concat(ex.ruta).join(' o ')} y salió «${resumen.plan ?? ''}»`);
      if (opciones.seco && ex.origen !== undefined && ![].concat(ex.origen).includes(String(resumen.origen ?? ''))) falla(i + 1, dicho, 'origen_inesperado', `se esperaba ${[].concat(ex.origen).join(' o ')} y salió «${resumen.origen ?? ''}»`);
      if (ex.filas !== undefined) {
        const ids = buenos.flatMap((m) => filasDe(m.payload).map((f) => String(f.id)));
        if (ids.join() !== [].concat(ex.filas).join()) falla(i + 1, dicho, 'filas_inesperadas', ids.join(', '));
      }
      for (const x of opciones.seco ? [].concat(ex.modeloVe ?? []) : []) if (!JSON.stringify(comp.captura.modelo.at(-1)?.cuerpo ?? {}).includes(x)) falla(i + 1, dicho, 'el_modelo_no_ve_lo_que_se_exige', `«${x}»`);
      if (ex.sinMensajes === true && buenos.length) falla(i + 1, dicho, 'respondio_donde_no_debia', todo);
      // R5: lo que sale al final del mensaje: los botones («planes+equipo», «equipo»), «lista» (la lista de rubros), «cta» (el enlace a recepción) o «texto».
      if (ex.botones !== undefined) {
        const m0 = buenos[0];
        const tipo0 = m0 ? tipoInter(m0.payload) : '';
        const real = !m0 ? 'ninguno' : tipo0 === 'button' ? botonesDe(m0.payload).join('+') : tipo0 === 'list' ? 'lista' : tipo0 === 'cta_url' ? 'cta' : 'texto';
        if (real !== [].concat(ex.botones).join('+')) falla(i + 1, dicho, 'botones_inesperados', `salió «${real}» y se esperaba «${[].concat(ex.botones).join('+')}»`);
      }
      if (ex.imagenPlanes === false && buenos.some((m) => objeto(objeto(m.payload).interactive).header !== undefined)) falla(i + 1, dicho, 'imagen_de_planes_repetida', todo);
      if (ex.noRepite === true && buenos[0] && anterior && lib.chSimilitud(buenos[0].cuerpo, anterior) >= 0.75) falla(i + 1, dicho, 'repite_el_mensaje_anterior', buenos[0].cuerpo);
    }
    corrida.conversacion.push({ turno: i + 1, dicho, mensajes: alCliente.filter((m) => !m.esRespaldo).map((m) => m.cuerpo), origen: String(resumen.origen ?? ''), contexto: String(resumen.contexto ?? '') });
  }
  corrida.esperas = comp.esperas;
  const ficha = objeto(objeto(comp.sd?.chatNovuchat)[CLIENTE]);
  const fila = comp.hoja.filas.find((f) => String(f[4] ?? '').replace(/\D/g, '') === CLIENTE);
  corrida.calificacion = fila ? String(fila[ENC.indexOf(COL_CALIFICACION)] ?? '') : '(sin fila)';
  corrida.planilla = fila ? celdas(fila) : null;
  corrida.descarteFinal = String(objeto(ficha.hechos).descarte ?? '') !== '';
  corrida.filas = comp.hoja.filas.length;
  corrida.formulas = comp.formulas.length;
  // Lo que el caso espera de la FILA de la hoja y de la ficha.
  const finalDe = (regla, texto) => falla(caso.turnos.length, '(el final)', regla, texto);
  if (caso.planilla) {
    if (!corrida.planilla) finalDe('planilla_no_coincide', 'no hay fila en la hoja');
    else {
      if (caso.planilla.calificacion !== undefined && corrida.planilla[COL_CALIFICACION] !== caso.planilla.calificacion) finalDe('planilla_no_coincide', `calificación ${corrida.planilla[COL_CALIFICACION]} y se esperaba ${caso.planilla.calificacion}`);
      for (const [col, textos] of Object.entries(caso.planilla.contiene ?? {})) for (const x of [].concat(textos)) if (!sinTildes(corrida.planilla[col]).includes(sinTildes(x))) finalDe('planilla_no_coincide', `«${col}» no contiene «${x}»: ${corrida.planilla[col]}`);
      for (const [col, textos] of Object.entries(caso.planilla.noContiene ?? {})) for (const x of [].concat(textos)) if (sinTildes(corrida.planilla[col]).includes(sinTildes(x))) finalDe('planilla_no_coincide', `«${col}» contiene «${x}»: ${corrida.planilla[col]}`);
    }
  }
  for (const [k, v] of Object.entries(caso.ficha ?? {})) if (String(ficha[k] ?? '') !== String(v)) finalDe('ficha_no_coincide', `${k} = «${ficha[k] ?? ''}» y se esperaba «${v}»`);
  if (corrida.formulas) finalDe('formula_en_la_hoja', `${corrida.formulas} celda(s) como fórmula`);
  return corrida;
}

// ------------------------------------------------------------------------------------------------------- métricas
const suma = (a) => a.reduce((x, y) => x + y, 0);
const media = (a) => (a.length ? suma(a) / a.length : 0);
function percentil(a, p) {
  if (!a.length) return 0;
  const o = [...a].sort((x, y) => x - y);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
}
const costoDe = (u) => ((u.entrada - u.cacheados) * TARIFA.entrada + u.cacheados * TARIFA.cacheado + (u.salida + u.razonamiento) * TARIFA.salida) / 1e6;

/** Todas las métricas de un conjunto de corridas (un caso, o todos). */
export function medir(corridas) {
  const llamadas = corridas.flatMap((c) => c.llamadas);
  const usos = llamadas.filter((l) => l.uso).map((l) => l.uso);
  const uso = { llamadasConUso: usos.length, entrada: suma(usos.map((u) => u.entrada)), salida: suma(usos.map((u) => u.salida)), cacheados: suma(usos.map((u) => u.cacheados)), razonamiento: suma(usos.map((u) => u.razonamiento)) };
  const latencias = llamadas.filter((l) => l.uso).map((l) => l.ms);
  const turnos = suma(corridas.map((c) => c.turnos));
  const modeloTurnos = suma(corridas.map((c) => c.modeloTurnos));
  const respaldos = suma(corridas.map((c) => c.respaldos));
  const causas = corridas.reduce((a, c) => { for (const [k, v] of Object.entries(c.causas)) a[k] = (a[k] ?? 0) + v; return a; }, {});
  const palabras = corridas.flatMap((c) => c.palabras);
  const ord = [...palabras].sort((a, b) => a - b);
  return {
    corridas: corridas.length, turnos, mensajes: suma(corridas.map((c) => c.mensajes)), plantillas: suma(corridas.map((c) => c.plantillas)),
    mensajesPorTurno: turnos ? suma(corridas.map((c) => c.mensajes)) / turnos : 0,
    turnosConModelo: modeloTurnos, llamadas: llamadas.length, reintentos: llamadas.filter((l) => l.nodo === 'Reintentar el modelo').length,
    llamadasPorCorrida: media(corridas.map((c) => c.llamadas.length)),
    // La calidad del MODELO real: de los turnos que le tocaron, cuántos salieron con SU texto y cuántos con el respaldo del código (y por qué causas se rechazó).
    repeticiones: suma(corridas.map((c) => c.repeticiones || 0)), turnosConRespaldo: respaldos, tasaDeRespaldo: modeloTurnos ? respaldos / modeloTurnos : 0, causasDeRechazo: causas,
    jsonValido: { ok: llamadas.filter((l) => l.jsonValido).length, n: llamadas.length }, conforme: { ok: llamadas.filter((l) => l.conforme).length, n: llamadas.length },
    erroresDelServicio: llamadas.filter((l) => l.errorHttp).length,
    violaciones: suma(corridas.map((c) => c.violaciones.length)),
    longitud: { mensajes: palabras.length, palabrasMedias: Math.round(media(palabras) * 10) / 10, mediana: ord.length ? ord[Math.floor(ord.length / 2)] : 0, maximo: ord.length ? ord[ord.length - 1] : 0 },
    tono: { mensajes: suma(corridas.map((c) => c.tonos.length)), voseo: suma(corridas.map((c) => c.tonos.filter((t) => t.voseo).length)), usted: suma(corridas.map((c) => c.tonos.filter((t) => t.usted).length)) },
    formulasEnLaHoja: suma(corridas.map((c) => c.formulas || 0)), filasPorCorrida: media(corridas.map((c) => c.filas || 0)),
    fallosDeNodo: corridas.flatMap((c) => c.fallos.map((f) => `${c.caso}${f}`)),
    calificaciones: corridas.reduce((a, c) => { a[c.calificacion] = (a[c.calificacion] ?? 0) + 1; return a; }, {}),
    uso: { ...uso, latenciaMediaMs: Math.round(media(latencias)), latenciaP50Ms: Math.round(percentil(latencias, 50)), latenciaP95Ms: Math.round(percentil(latencias, 95)), latenciaMaxMs: Math.round(Math.max(0, ...latencias)), costoUsd: usos.length ? Math.round(costoDe(uso) * 1e6) / 1e6 : null },
  };
}

// ------------------------------------------------------------------------------------------------------- casos
const TIPOS_DE_TURNO = ['texto', 'fila', 'boton', 'audio', 'imagen', 'documento', 'ubicacion', 'sticker', 'rafaga'];
const CAMPOS_SECO = ['mensaje', 'accion', 'rubro', 'necesidad', 'nombre', 'empresa', 'descarte'];
const CLAVES_EXIGE = ['contiene', 'noContiene', 'contieneAlguna', 'termina', 'sinCifras', 'imagenPlanes', 'sinModelo', 'conModelo', 'cta', 'plantillas', 'ruta', 'origen', 'filas', 'modeloVe', 'sinMensajes', 'botones', 'noRepite'];
/** Lee y valida `bateria-casos.json`: un caso mal escrito se rechaza con su id, nunca se corre a medias. */
export function validarCasos(datos) {
  const casos = datos?.casos;
  if (!Array.isArray(casos) || !casos.length) throw new Error('bateria-casos.json: falta la lista `casos`.');
  const ids = new Set();
  const turnoValido = (t, donde) => {
    if (!t || !TIPOS_DE_TURNO.includes(t.tipo)) throw new Error(`bateria-casos.json: ${donde}: tipo de turno desconocido.`);
    if (t.tipo === 'texto' && typeof t.texto !== 'string') throw new Error(`bateria-casos.json: ${donde}: falta el texto.`);
    if ((t.tipo === 'fila' || t.tipo === 'boton') && typeof t.id !== 'string') throw new Error(`bateria-casos.json: ${donde}: falta el id.`);
    if (t.tipo === 'audio' && typeof t.transcripcion !== 'string') throw new Error(`bateria-casos.json: ${donde}: falta la transcripción.`);
  };
  for (const c of casos) {
    if (!c || typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(c.id)) throw new Error('bateria-casos.json: un caso sin id válido.');
    if (ids.has(c.id)) throw new Error(`bateria-casos.json: id repetido ${c.id}.`);
    ids.add(c.id);
    if (typeof c.titulo !== 'string' || !c.titulo) throw new Error(`bateria-casos.json: ${c.id} sin título.`);
    if (!Array.isArray(c.turnos) || !c.turnos.length) throw new Error(`bateria-casos.json: ${c.id} sin turnos.`);
    for (const [i, t] of c.turnos.entries()) {
      const donde = `${c.id}, turno ${i + 1}`;
      turnoValido(t, donde);
      if (t.tipo === 'rafaga') {
        if (!Array.isArray(t.eventos) || t.eventos.length < 2) throw new Error(`bateria-casos.json: ${donde}: una ráfaga lleva 2 o más eventos.`);
        t.eventos.forEach((e, k) => { turnoValido(e, `${donde}, evento ${k + 1}`); if (e.tipo === 'rafaga') throw new Error(`bateria-casos.json: ${donde}: una ráfaga no lleva otra ráfaga.`); });
      }
      for (const campo of ['seco', 'seco2']) {
        if (t[campo] !== undefined && typeof t[campo] !== 'string' && (typeof t[campo] !== 'object' || t[campo] === null || Object.keys(t[campo]).some((k) => !CAMPOS_SECO.includes(k)))) {
          throw new Error(`bateria-casos.json: ${donde}: «${campo}» debe ser un objeto con campos del esquema, o un texto.`);
        }
      }
      if (t.exige !== undefined && (typeof t.exige !== 'object' || t.exige === null || Object.keys(t.exige).some((k) => !CLAVES_EXIGE.includes(k)))) {
        throw new Error(`bateria-casos.json: ${donde}: «exige» solo admite ${CLAVES_EXIGE.join(', ')}.`);
      }
    }
    if (c.planilla !== undefined && (typeof c.planilla !== 'object' || c.planilla === null || Object.keys(c.planilla).some((k) => !['calificacion', 'contiene', 'noContiene'].includes(k)))) {
      throw new Error(`bateria-casos.json: ${c.id}: «planilla» solo admite calificacion, contiene y noContiene.`);
    }
    if (c.ficha !== undefined && (typeof c.ficha !== 'object' || c.ficha === null || Object.keys(c.ficha).some((k) => !['rubro', 'nombre', 'empresa', 'necesidad', 'planesMostrados', 'equipoAhora', 'nombrePedido', 'explicado', 'planesPendientes'].includes(k)))) {
      throw new Error(`bateria-casos.json: ${c.id}: «ficha» solo admite rubro, nombre, empresa, necesidad, planesMostrados, equipoAhora, nombrePedido, explicado y planesPendientes.`);
    }
  }
  return casos;
}

// ------------------------------------------------------------------------------------------------------- salida
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const fr = (c) => (c.n ? `${c.ok}/${c.n}` : '—');
const fmtUsd = (n) => (n === null ? 'n/d' : `USD ${n.toFixed(4)}`);
function tablaTexto(filas, columnas) {
  const anchos = columnas.map((c, i) => Math.max(c.length, ...filas.map((f) => String(f[i]).length)));
  const linea = (f) => f.map((x, i) => (i < 2 ? String(x).padEnd(anchos[i]) : String(x).padStart(anchos[i]))).join('  ');
  return [linea(columnas), anchos.map((a) => '-'.repeat(a)).join('  '), ...filas.map(linea)].join('\n');
}

function informe({ opciones, casos, corridas, modelo, proveedor }) {
  const porCaso = casos.map((c) => ({ caso: c, corridas: corridas.filter((x) => x.caso === c.id) }));
  const total = medir(corridas);
  const casosMedidos = porCaso.map(({ caso, corridas: cs }) => ({ id: caso.id, titulo: caso.titulo, ...medir(cs), conversacion: cs[0]?.conversacion ?? [] }));
  const violaciones = corridas.flatMap((c) => c.violaciones);
  const porRegla = violaciones.reduce((a, v) => { a[v.regla] = (a[v.regla] ?? 0) + 1; return a; }, {});
  return {
    version: 1, modo: opciones.seco ? 'seco' : 'real', proveedor, modelo, corridasPorCaso: opciones.n, casos: casosMedidos, total,
    violaciones: { total: violaciones.length, porRegla, detalle: violaciones },
    costo: { usd: total.uso.costoUsd, tarifa: { ...TARIFA, unidad: 'USD por millón de tokens' }, supuesto: SUPUESTO_TARIFA },
    aviso: opciones.seco ? 'SECO: el modelo es simulado (respuestas fijas por turno); las cifras del modelo, el uso y el costo no significan nada.' : '',
  };
}

function textoDelInforme(r) {
  const o = [];
  o.push(`Modelo: ${r.modelo} · proveedor: ${r.proveedor} · ${r.casos.length} casos · ${r.corridasPorCaso} corridas por caso`);
  if (r.aviso) o.push(r.aviso);
  o.push('');
  const cols = ['CASO', 'TÍTULO', 'CORR', 'TURNOS', 'MSJ/T', 'MODELO', 'RESP', 'JSON', 'VIOL'];
  const fila = (id, titulo, c) => [id, titulo.slice(0, 40), c.corridas, c.turnos, Math.round(c.mensajesPorTurno * 100) / 100, c.turnosConModelo, c.turnosConRespaldo, pct(c.jsonValido.ok, c.jsonValido.n), c.violaciones];
  const filas = r.casos.map((c) => fila(c.id, c.titulo, c));
  filas.push(fila('TOTAL', '', r.total));
  o.push(tablaTexto(filas, cols));
  o.push('');
  o.push('TURNOS = turnos del cliente (una ráfaga de clics es UN turno) · MSJ/T = mensajes al cliente por turno (se espera 1) · MODELO = turnos que llegaron al modelo · RESP = de esos, los que salieron con el texto de respaldo del código · JSON = JSON válido (sobre las llamadas) · VIOL = violaciones de reglas duras');
  const t = r.total;
  o.push('');
  o.push(`Modelo: ${t.turnosConModelo} turnos llegaron al modelo (${t.llamadas} llamadas, ${t.reintentos} reintentos) · respaldo del código en ${t.turnosConRespaldo} (${pct(t.turnosConRespaldo, t.turnosConModelo)})`);
  o.push(`Mensajes del modelo que repetían el anterior (similitud >= 0,75): ${t.repeticiones}`);
  o.push(`Causas de rechazo del mensaje del modelo: ${Object.entries(t.causasDeRechazo).map(([k, v]) => `${k} ${v}`).join(', ') || 'ninguna'}`);
  o.push(`Longitud: ${t.longitud.palabrasMedias} palabras por mensaje en promedio (mediana ${t.longitud.mediana}, máximo ${t.longitud.maximo}) · tono: voseo ${t.tono.voseo}, usted ${t.tono.usted} (sobre ${t.tono.mensajes} mensajes)`);
  o.push(`Mensajes por turno: ${Math.round(t.mensajesPorTurno * 100) / 100} (${t.mensajes} mensajes en ${t.turnos} turnos) · plantillas de aviso: ${t.plantillas}`);
  o.push(`Calificación final (hoja): ${Object.entries(t.calificaciones).map(([k, v]) => `${k || '(vacía)'} ${v}`).join(', ') || '—'} · filas por corrida ${Math.round(t.filasPorCorrida * 100) / 100}`);
  if (t.formulasEnLaHoja) o.push(`ATENCIÓN: ${t.formulasEnLaHoja} celda(s) de la hoja quedaron como fórmula (USER_ENTERED).`);
  if (t.fallosDeNodo.length) o.push(`ATENCIÓN: nodos que fallaron durante la corrida: ${t.fallosDeNodo.slice(0, 8).join(' | ')}`);
  o.push('');
  o.push(`VIOLACIONES de reglas duras sobre lo que el cliente recibe: ${r.violaciones.total}`);
  if (r.violaciones.total) {
    for (const [k, v] of Object.entries(r.violaciones.porRegla)) o.push(`  ${k}: ${v}`);
    for (const v of r.violaciones.detalle.slice(0, 60)) o.push(`  [${v.caso} #${v.turno} c${v.rep}] ${v.regla} → «${v.texto}»   (el cliente dijo: «${String(v.dicho).slice(0, 70)}»)`);
    if (r.violaciones.detalle.length > 60) o.push(`  … y ${r.violaciones.detalle.length - 60} más (--json trae todas)`);
  }
  o.push('');
  if (r.modo === 'seco') o.push('Uso del modelo: sin datos (modo seco).');
  else {
    const u = t.uso;
    const por = t.llamadas || 1;
    o.push(`Uso del modelo: ${t.llamadas} llamadas · entrada ${u.entrada} tokens (${Math.round(u.entrada / por)} por llamada; cacheados ${u.cacheados}) · salida ${u.salida} (${Math.round(u.salida / por)} por llamada; razonamiento ${u.razonamiento})`);
    o.push(`Latencia por llamada: media ${u.latenciaMediaMs} ms · p50 ${u.latenciaP50Ms} ms · p95 ${u.latenciaP95Ms} ms · máx ${u.latenciaMaxMs} ms`);
    o.push(`Costo estimado: ${fmtUsd(u.costoUsd)} en total${t.llamadas ? ` (${fmtUsd(u.costoUsd === null ? null : u.costoUsd / t.llamadas)} por llamada)` : ''}`);
    o.push(`Supuesto de la tarifa: ${r.costo.supuesto}`);
  }
  return o.join('\n');
}

/** Las conversaciones de la primera corrida de cada caso, para leerlas con los ojos (`--conversaciones`). */
export function leerConversaciones(r, ids) {
  const o = [];
  for (const c of r.casos.filter((x) => !ids || ids.includes(x.id))) {
    o.push(`=== ${c.id} — ${c.titulo}`);
    for (const x of c.conversacion) {
      o.push(`  Cliente: ${x.dicho}`);
      for (const m of x.mensajes) o.push(`  Kenji [${x.origen || 'código'}${x.contexto ? ' · ' + x.contexto : ''}]: ${m.replace(/\n/g, '\n      ')}`);
      if (!x.mensajes.length) o.push('  Kenji: (sin mensaje)');
    }
    o.push('');
  }
  return o.join('\n');
}

// ------------------------------------------------------------------------------------------------------- principal
const AYUDA = `Batería de «Chat NovuChat v2 (Kenji)» contra el modelo.
  node Flujos/experimental/chat-novuchat/herramientas/bateria.mjs [--seco] [--n 1..20] [--casos S1,S3] [--env archivo | --vertex proyecto [--locacion región]] [--json] [--conversaciones]
  --seco: modelo simulado, sin clave ni red · --env: archivo con la clave (por defecto .env.novuchat) · --vertex: token de gcloud · --json: salida de máquina · --conversaciones: imprime las conversaciones`;

/**
 * Corre la batería. `deps` (solo para pruebas): { salida, error, fetch, leerArchivo, gcloudToken }. Devuelve el código de salida:
 * 0 = corrió; 2 = uso o configuración inválida (sin red ni traza); 1 = fallo inesperado.
 */
export async function main(argv, deps = {}) {
  const d = {
    salida: (t) => process.stdout.write(t),
    error: (t) => process.stderr.write(t),
    fetch: (...a) => globalThis.fetch(...a),
    leerArchivo: (r) => (existsSync(r) ? readFileSync(r, 'utf8') : null),
    gcloudToken: () => execFileSync('gcloud', ['auth', 'print-access-token'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString(),
    ...deps,
  };
  let opciones;
  let credencial = { clave: null, token: null, nombre: '' };
  try {
    const conversaciones = argv.includes('--conversaciones');
    opciones = leerArgumentos(argv.filter((a) => a !== '--conversaciones'));
    if (opciones.ayuda) { d.salida(AYUDA + '\n'); return 0; }
    const flujo = JSON.parse(readFileSync(RUTA_FLUJO, 'utf8'));
    const casos = validarCasos(JSON.parse(readFileSync(RUTA_CASOS, 'utf8')));
    const elegidos = opciones.casos ? opciones.casos.map((id) => {
      const c = casos.find((x) => x.id === id);
      if (!c) throw new ErrorDeUso(`Caso desconocido: ${id}. Hay: ${casos.map((x) => x.id).join(', ')}.`);
      return c;
    }) : casos;
    const info = (t) => (opciones.json ? d.error(t + '\n') : d.salida(t + '\n'));
    // La clave, sin mostrarla: solo fuera de --seco, y solo su NOMBRE sale.
    if (!opciones.seco) {
      credencial = leerCredencial(opciones, d);
      info(`Clave del modelo: ${credencial.nombre} (valor no mostrado)`);
    }
    const lib = cargarLibreria();
    const modelo = datosDelChat().modelo;
    const proveedor = opciones.seco ? 'ninguno (seco)' : opciones.vertex ? `Vertex AI (${opciones.vertex}, ${opciones.locacion})` : 'AI Studio';
    const corridas = [];
    for (const caso of elegidos) {
      for (let rep = 1; rep <= opciones.n; rep++) {
        if (!opciones.seco) d.error(`… ${caso.id} corrida ${rep}/${opciones.n}\n`);
        corridas.push(await correrCaso({ caso, rep, flujo, lib, opciones, credencial, deps: d }));
      }
    }
    const r = informe({ opciones, casos: elegidos, corridas, modelo, proveedor });
    d.salida(opciones.json ? JSON.stringify(r) + '\n' : textoDelInforme(r) + (conversaciones ? '\n\n' + leerConversaciones(r) : '') + '\n');
    return 0;
  } catch (e) {
    const secretos = [credencial.clave, credencial.token];
    if (e instanceof ErrorDeUso) { d.error(`✗ ${limpiarSecretos(e.message, secretos)}\n`); return 2; }
    d.error(`✗ Fallo inesperado: ${limpiarSecretos(mensajeDe(e), secretos).slice(0, 300)}\n`);
    return 1;
  }
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) process.exitCode = await main(process.argv.slice(2));
