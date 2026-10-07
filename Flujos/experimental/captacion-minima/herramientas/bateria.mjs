#!/usr/bin/env node
// BATERIA DE «CAPTACION MINIMA v0» CONTRA EL MODELO (03/10/2026).
//
// QUE ES. Corre conversaciones de `bateria-casos.json` por el FLUJO ARMADO (`captacion-minima.novuchat.json`): recorre su grafo
// nodo por nodo, en el orden del lienzo, y corre de verdad los nodos Code del JSON (con `new Function`, sin los globales de Node
// que el Code de n8n no tiene) y evalua los IF y los Set. Lo unico que sale a la red es el nodo «Llamar al modelo»: toma el
// cuerpo EXACTO que arma «Decidir turno» (`systemInstruction`, `contents`, `generationConfig` con `responseSchema`), lo envia a
// `generateContent` con el modelo del propio nodo, y la respuesta real vuelve a «Armar mensajes» tal como la entregaria n8n.
// Todo lo demas va simulado y en memoria: la consola (panel de ejemplo), la ingesta, Graph (acepta todo), los medios (el audio
// ya viene transcrito en el caso) y la planilla de Google.
//
// Mide lo que depende del MODELO (lo determinista lo cubre la suite `captacion-minima-flujo.test.ts`): JSON valido y conforme al
// esquema, el uso o no del respaldo por cada campo, la empatia, el acierto de `tipo`/`rubroId`/`rubroLibre`/`descarte`, la
// honestidad de `enLosDatos`, y SOBRE TODO las violaciones de las reglas duras sobre lo que el cliente RECIBE (cada una con su
// caso y su texto). Mas tokens, latencia y costo estimado.
//
// Se corre desde la raiz del repositorio:
//   node Flujos/experimental/captacion-minima/herramientas/bateria.mjs --seco
//   node Flujos/experimental/captacion-minima/herramientas/bateria.mjs --env .env.novuchat --n 3
//   node Flujos/experimental/captacion-minima/herramientas/bateria.mjs --vertex <proyecto> --casos C3,C4 --json
//
// OPCIONES
//   --seco            NO llama a nada: el modelo es una respuesta fija por turno (campo `seco` de cada turno del caso). No lee
//                     ninguna clave ni toca la red. Sirve para ver que los casos corren por el flujo y que lo determinista
//                     (las reglas duras sobre lo que sale) da cero violaciones. Las cifras del modelo NO significan nada.
//   --n <1..20>       corridas por caso (3 por defecto).
//   --casos C1,C3,..  ids separados por coma (todos por defecto).
//   --env <archivo>   archivo con la clave (`.env` y este, como `scripts/comparar-prompt.mjs`; por defecto `.env.novuchat`).
//   --vertex <proy>   usa Vertex AI con el token de `gcloud auth print-access-token` (la clave vive solo en n8n).
//   --locacion <loc>  region de Vertex (us-central1 por defecto).
//   --json            salida de maquina: UN objeto JSON en la salida estandar (lo demas va a la de errores).
//   --ayuda           este resumen.
//
// NUNCA SE IMPRIME EL VALOR DE UN SECRETO: sale el NOMBRE de la variable que se uso y nada mas; el valor no se pone en un
// error ni en un archivo. La clave viaja en el encabezado `x-goog-api-key` (nunca en la URL) y SOLO a
// `generativelanguage.googleapis.com`; el token de Vertex, solo a `*-aiplatform.googleapis.com`.
//
// NO ESCRIBE ARCHIVOS: solo lee el flujo, los casos y, fuera de --seco, los archivos de entorno; escribe en la salida estandar.
//
// SUPUESTOS DEL COSTO (declarados en la salida): la tarifa de abajo (`TARIFA`) se calibro con lo medido el 01/10/2026 en el flujo
// B de Agenda minima (≈ USD 0,0005 por llamada de ~800 tokens de entrada y ~100 de salida con este modelo). No es una factura:
// se confirma contra la facturacion de Google.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_FLUJO = join(AQUI, '..', 'captacion-minima.novuchat.json');
const RUTA_CASOS = join(AQUI, 'bateria-casos.json');

/** USD por millon de tokens. Los cacheados se cobran a un decimo de la entrada; el razonamiento, como salida. */
export const TARIFA = { entrada: 0.30, salida: 2.50, cacheado: 0.03 };
const SUPUESTO_TARIFA = `USD ${TARIFA.entrada} por millón de tokens de entrada, USD ${TARIFA.salida} de salida y USD ${TARIFA.cacheado} de cacheados; `
  + 'calibrada con la medición del 01/10/2026 (≈ USD 0,0005 por llamada de ~800 tokens de entrada y ~100 de salida). No es una factura.';

const CANDIDATAS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'];
const HOST_AI_STUDIO = 'generativelanguage.googleapis.com';

/** Los globales que el Code de n8n NO tiene (como `admin/pruebas/lib/flujo.ts`): entran como parametros vacios. */
const GLOBALES_FUERA = ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone', 'btoa', 'atob', 'fetch', 'Request',
  'Response', 'Headers', 'FormData', 'Blob', 'AbortController', 'Buffer', 'crypto', 'process', 'require', 'module', 'exports',
  '__dirname', '__filename', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask'];

// ------------------------------------------------------------------------------------------------------- datos de ejemplo
// Un negocio inventado y telefonos sinteticos (seis ceros seguidos): ningun dato real. Lunes 05/10/2026, 10:00 en La Paz.
const PID = '59100000003';       // phone_number_id del numero del negocio
// Quien escribe: un telefono SINTETICO por caso y corrida (59100000010 a 59100000019: nunca el de recepcion ni el del negocio; el ultimo digito varia, determinista): el saludo del flujo
// rota por el ultimo digito (§15), y con un solo telefono las 24 conversaciones abririan igual.
export const telefonoDe = (idCaso, rep) => '5910000001' + ([...`${idCaso}#${rep}`].reduce((a, c) => a + c.charCodeAt(0), 0) % 10);
const REC = '59100000001';       // recepcion: destino del boton y del aviso
const ID_PLANILLA = 'PLANILLA_DE_PRUEBA_' + 'x'.repeat(26);
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const SUSPENDIDO = 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';

// La consola de NovuChat VIVA (§13): los ids son el slug del nombre y los nombres, los de la consola. Con otros ids el guion no los
// encontraba y «Salud y Belleza» y «Comercio y Retail» caían en la pregunta de «Otro» sin que nadie lo notara.
const RUBROS = [
  { id: 'salud-y-belleza', nombre: 'Salud y Belleza', solucion: 'Agenda y recuerda las citas sola.', flujoSugerido: 'agendamiento' },
  { id: 'gastronomia', nombre: 'Gastronomía', solucion: 'Toma los pedidos por WhatsApp.', flujoSugerido: 'venta' },
  { id: 'comercio-y-retail', nombre: 'Comercio y Retail', solucion: 'Responde por tu catálogo.', flujoSugerido: 'venta' },
  { id: 'educacion', nombre: 'Educación', solucion: 'Agenda clases y responde dudas.', flujoSugerido: 'agendamiento' },
  { id: 'otro-a-medida', nombre: 'Otro / a medida', solucion: 'Lo armamos a tu medida.', flujoSugerido: '' },
];
// §16: los planes y los cargos únicos de la consola de NovuChat (los topes de conversaciones viajan en `incluye`: la batería comprueba que el modelo NO los escriba).
// §16 (D8): las 7 filas que se PROPONEN para la lista de rubros de la consola (documento comercial §2 y §3; el archivo de la propuesta está en `fuentes/rubros-propuestos-2026-10-07.json`).
// Los casos con `opciones.rubrosDelDocumento` los usan; los demás, los 5 de la consola VIVA de arriba. El guion soporta los dos conjuntos de ids.
const RUBROS_DOC = [
  { id: 'salud', nombre: 'Salud', solucion: 'Recepcionista virtual 24/7 para clínicas y consultorios.', flujoSugerido: 'agendamiento' },
  { id: 'belleza', nombre: 'Belleza', solucion: 'Muestra tus servicios y agenda con tus especialistas.', flujoSugerido: 'agendamiento' },
  { id: 'gastronomia', nombre: 'Gastronomía', solucion: 'Toma pedidos con notas especiales y cobra con QR.', flujoSugerido: 'venta' },
  { id: 'retail', nombre: 'Retail', solucion: 'Muestra tu catálogo, cierra el carrito y cobra con QR.', flujoSugerido: 'venta' },
  { id: 'educacion', nombre: 'Educación', solucion: 'Responde dudas de padres y coordina entrevistas.', flujoSugerido: 'agendamiento' },
  { id: 'leads-de-ventas', nombre: 'Leads de Ventas', solucion: 'Califica prospectos con IA y los registra en un miniCRM.', flujoSugerido: 'a_medida' },
  { id: 'otro-a-medida', nombre: 'Otro / a medida', solucion: 'Lo armamos a tu medida.', flujoSugerido: 'a_medida' },
];
const PLANES = [
  { nombre: 'Impulso', precioUsd: 25, periodo: 'mes', incluye: '100 conversaciones al mes; hasta 20 productos en el catálogo' },
  { nombre: 'Crecimiento', precioUsd: 50, periodo: 'mes', incluye: '220 conversaciones al mes; hasta 100 productos en el catálogo' },
  { nombre: 'Pro', precioUsd: 90, periodo: 'mes', incluye: '500 conversaciones al mes; hasta 500 productos; soporte prioritario' },
];
const CARGOS = [
  { nombre: 'Instalación estándar', precioUsd: 65, desde: false, detalle: 'Pago único y por adelantado, llave en mano.' },
  { nombre: 'Instalación a medida', precioUsd: 125, desde: true, detalle: 'Integración con tu sistema propio o flujos complejos; se cotiza caso por caso.' },
];
// a1 sin monto (el modelo la ve completa); a2 trae un monto (el modelo solo ve su tema y el codigo copia el texto).
const ACLARACIONES = [
  { tema: 'Conversaciones', texto: 'Cada conversación dura 24 horas desde el primer mensaje.' },
  { tema: 'Moneda', texto: 'Los precios son en dólares: USD 25 el plan más bajo.' },
];
const ARCHIVO = { url: 'https://firebasestorage.googleapis.com/v0/b/ejemplo-novuchat/o/planes.png', tipo: 'imagen', nombreArchivo: 'Planes.png' };

function panelDe(opciones = {}) {
  return {
    tenantId: 'novuchat', flujo: 'onboarding', estadoComercio: 'activo', phoneNumberId: PID,
    operacion: { numeroRecepcion: REC, horarioAtencion: '' },
    datosDelNegocio: { nombreNegocio: 'NovuChat' },
    // §16 (D6): el nivel «equilibrado» del documento comercial es «pocos» (un emoji por parte del mensaje). OJO: en vivo manda `voz.nivelEmojis` de la CONSOLA; el valor de los datos
    // solo es el respaldo si la consola no lo manda. Y el nombre del asistente (Kenji) es un dato de la consola, no un nombre de persona del equipo.
    voz: { nivelEmojis: 'pocos', nombreAsistente: 'Kenji' },
    onboarding: {
      topeAviso: 10, plantillaAviso: 'solicitud_contacto',
      rubros: opciones.sinRubros ? [] : (opciones.rubrosDelDocumento ? RUBROS_DOC : RUBROS),
      planes: opciones.sinPlanes ? [] : PLANES, cargosUnicos: opciones.sinPlanes ? [] : CARGOS,
      aclaraciones: ACLARACIONES,
      archivoPlanes: opciones.sinPlanes || opciones.sinArchivo ? null : ARCHIVO,
    },
    campanas: [],
    atencion: { estado: 'normal' },
  };
}

// La planilla «Leads_CRM»: encabezados en la fila 3. Es el esquema de «Decidir fila de la planilla» (copia del flujo viejo).
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

// ------------------------------------------------------------------------------------------------------- reglas duras
const sinUrl = (s) => String(s).replace(/https?:\/\/\S+/g, ' ');
const preguntasDe = (s) => (sinUrl(s).match(/\?/g) ?? []).length;
const oracionesDe = (s) => sinUrl(s).split(/[.!?…]+(?:\s+|$)/).map((x) => x.trim()).filter((x) => /\p{L}/u.test(x)).length;
/** Las oraciones de 5 palabras o mas de un texto, normalizadas (para contar las que se repiten de un mensaje al siguiente). */
const oracionesTexto = (s) => sinUrl(s).split(/(?<=[.!?…])\s+/).map((x) => norm(x).replace(/[^\p{L}\p{N} ]/gu, '').trim()).filter((x) => x.split(' ').length >= 5);
const palabrasDe = (s) => sinUrl(s).split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// §15: un mensaje general hasta 6 oraciones y 95 palabras (la exclamación inicial cuenta como oración); el de PLANES (el único con encabezado), 7 y 110.
// La fuente es `ccLimites()` de la librería; una prueba compara estas cifras con ella.
export const MAX_ORACIONES = 6;
export const MAX_PALABRAS = 95;
export const MAX_ORACIONES_PLANES = 7;
export const MAX_PALABRAS_PLANES = 110;
const CON_EMOJI = /\p{Extended_Pictographic}/u;

// Promesas sin mecanismo (politica general «solo se ofrece lo que se cumple»), en tercera persona y en primera.
const PROMESAS = /\bya (le|te|se|les) (pas[eé]|avis[eé]|notific[eé]|inform[eé]|transmit[ií])|\bte (escribir[aá]n|llamar[aá]n|contactar[aá]n|llamamos|escribimos|avisamos|contactamos|avisar[eé]|avisaremos)\b|\b(se|nos) (comunicar[aá]n?|pondr[aá]n? en contacto)\b|\blo consulto\b|\blo consultamos\b|\bte aviso\b|\bya avis[eé]\b|\bte llamar[aá]\b|\bte escribir[aá]\b|\b(te|le) (llamo|escribo|contacto|informo|enviar[eé]|mandar[eé]|llamar[eé]|escribir[eé]|contactar[eé]|informar[eé])\b|\bme (comunico|pongo en contacto)\b|\b(te|le) (envio|mando) (un mensaje|el|la|los|las|mas|más)\b|\bse (comunique|comuniquen|ponga|pongan) (con|en contacto)|\b(ofrecerle|ofrecerte) contact|\bcontactarl[oae]\b/i;
const NIEGA_IA = /\bno soy (un |una )?(bot|robot|ia|inteligencia artificial|asistente virtual)\b|\bsoy (una )?persona (real|de carne)|\bsoy (un )?humano\b|\bno (soy|es) (una )?(maquina|máquina)\b/i;
const SE_PRESENTA_PERSONA = /\bsoy (una )?(persona|humano|humana)\b|\bsoy (el|la) (asesor|asesora)\b|\bsoy de carne y hueso\b/i;
// H1: el patrón de montos con moneda es EL MISMO que filtra `ccLeerModelo` (una línea de la librería, leída de allí).
const MONTO_DEL_MODELO = (() => {
  const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/lib/captacion.js'), 'utf8');
  const m = /^const CC_MONTO_MODELO = \/(.+)\/([a-z]*);$/m.exec(fuente);
  if (!m) throw new Error('No encuentro «const CC_MONTO_MODELO» en src/lib/captacion.js');
  return new RegExp(m[1], m[2]);
})();
// §16: las reglas del documento comercial §5 y §6 como lo que el cliente RECIBE: sin cifras de consumo (los topes los muestra la imagen de planes), sin decir que el servicio
// valida pagos con el banco y sin nombrar un sistema que el servicio no nombra. El patrón de cifras es EL MISMO que filtra `ccLeerModelo` (una línea de la librería).
const CIFRA_DE_CONSUMO = (() => {
  const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/lib/captacion.js'), 'utf8');
  const m = /^const CC_CIFRA_DE_CONSUMO = \/(.+)\/([a-z]*);$/m.exec(fuente);
  if (!m) throw new Error('No encuentro «const CC_CIFRA_DE_CONSUMO» en src/lib/captacion.js');
  return new RegExp(m[1], m[2]);
})();
// Una oración que AFIRMA que valida/verifica/acredita un pago con el banco (la negación «no lo valida con el banco» es la respuesta correcta y no cuenta).
const VALIDA_CON_EL_BANCO = /\b(valida|validan|verifica|verifican|acredita|acreditan|confirma|confirman|consulta|consultan|cruza|cruzan)\w*\b[^.!?]{0,40}\b(banco|pagos?|transferencias?|depositos?|comprobantes?)\b[^.!?]{0,30}\bcon el banco\b|\bpago (acreditado|verificado|validado|confirmado|recibido)\b|\b(consulta|cruza)\w* (con )?el banco\b/;
const CIERRE_EXACTO = '¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝';
const sinTildes = (t) => String(t ?? '').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const MONTO = /USD\s*\d|\$\s*\d|\d+([.,]\d+)?\s*(d[oó]lares|bs\.?|bolivianos|usd)\b|\bbs\.?\s*\d|\b\d+\s*%|descuento|rebaja|promoci[oó]n|oferta especial/i;
const ENLACE = /(https?:\/\/|www\.|wa\.me\/)[^\s)»"]*/gi;
const VOSEO = /(?<![\p{L}])(quer[eé]s|ten[eé]s|pod[eé]s|dec[ií]me|cont[aá]me|escrib[ií]me|mirá|fijate|pasame|avisame|che|vos)(?![\p{L}])/iu;
const USTED = /(?<![\p{L}])(usted|ustedes|le (ayudo|puedo|ofrezco|cuento|comento|paso|aviso)|su (negocio|empresa|consulta|local)|mire)(?![\p{L}])/iu;

const botonesDe = (p) => (((objeto(objeto(p.interactive).action).buttons) ?? [])).map((b) => String(objeto(b.reply).id));
const filasDe = (p) => ((objeto(objeto(p.interactive).action).sections ?? [])).flatMap((s) => (s.rows ?? [])).map((f) => String(f.id));
const tipoInter = (p) => String(objeto(p.interactive).type ?? '');

/**
 * Las violaciones de las reglas duras sobre UN mensaje que el cliente RECIBE. `m` = { tipo, payload, cuerpo, respaldoTexto,
 * esRespaldo }; `ctx` = { asesor, recepcion, aclaraciones: [textos de la consola], archivos: [urls] }. Devuelve [{ regla, texto }].
 * Los textos que ESCRIBE EL CODIGO con datos de la consola (el bloque de planes con precios, el texto de una aclaracion, el
 * enlace de recepcion y el del archivo de planes) no cuentan como monto ni como enlace: la regla es sobre lo que sale de la
 * redaccion del modelo. La plantilla de aviso va a recepcion, no al cliente: no se revisa aqui.
 */
export function revisarMensaje(m, ctx = {}) {
  if (m.tipo === 'template') return [];
  const v = [];
  const asesor = String(ctx.asesor ?? '').trim();
  const anota = (regla, texto) => v.push({ regla, texto: String(texto).replace(/\s+/g, ' ').slice(0, 200) });

  // §16: el mensaje de PLANES con archivo lo arma el CÓDIGO con los montos de la consola (D5): no cuenta como monto ni se le exige que no traiga cifras.
  const deCodigo = m.payload !== null && m.payload !== undefined && objeto(objeto(m.payload).interactive).header !== undefined;
  const revisarTexto = (texto, { respaldo, payload }) => {
    const c = String(texto ?? '');
    const esBloqueDePlanes = /\*Planes\*/.test(c);
    if (preguntasDe(c) > 1) anota('mas_de_una_pregunta', c);
    if (!respaldo && !esBloqueDePlanes) {
      // El mensaje de PLANES con archivo es el único con encabezado (imagen o documento) y tiene su propio tope.
      const planes = payload !== null && payload !== undefined && objeto(payload.interactive).header !== undefined;
      const [maxO, maxP] = planes ? [MAX_ORACIONES_PLANES, MAX_PALABRAS_PLANES] : [MAX_ORACIONES, MAX_PALABRAS];
      if (oracionesDe(c) > maxO) anota(`mas_de_${maxO}_oraciones`, c);
      if (palabrasDe(c) > maxP) anota(`mas_de_${maxP}_palabras`, c);
    }
    if (NIEGA_IA.test(c)) anota('niega_ser_ia', c);
    if (SE_PRESENTA_PERSONA.test(c) || (asesor && new RegExp(`\\b(soy|me llamo|mi nombre es) ${esc(asesor)}\\b`, 'i').test(c))) anota('se_presenta_como_persona_o_asesor', c);
    if (PROMESAS.test(c)) anota('promesa_de_contacto_sin_mecanismo', c);
    // Montos: sin el bloque de planes ni el texto de una aclaracion de la consola (los copia el codigo).
    let paraMonto = esBloqueDePlanes || deCodigo ? '' : c;
    for (const a of ctx.aclaraciones ?? []) for (const t of [a, String(a).slice(0, 300)]) if (t) paraMonto = paraMonto.split(t).join(' ');
    if (MONTO.test(paraMonto) || MONTO_DEL_MODELO.test(sinTildes(paraMonto))) anota('monto_o_descuento', c);
    // §16 (documento comercial §5 y §6): ninguna cifra de consumo, ningún pago validado con el banco y ningún sistema que el servicio no nombra, en nada que redacte el modelo.
    if (!esBloqueDePlanes && !deCodigo) {
      // Sin el texto de una aclaración de la consola (lo copia el código, con su «USD 25»).
      let propio = c.replace(ENLACE, ' ');
      for (const a of ctx.aclaraciones ?? []) for (const t of [a, String(a).slice(0, 300)]) if (t) propio = propio.split(t).join(' ');
      if (CIFRA_DE_CONSUMO.test(sinTildes(propio))) anota('cifra_de_consumo', c);
      if (VALIDA_CON_EL_BANCO.test(sinTildes(propio))) anota('valida_pagos_con_el_banco', c);
      if (ctx.lib && ctx.lib.ccSistemaAjeno(propio, ctx.propios ?? [], false)) anota('sistema_ajeno_o_integracion_inventada', c);
    }
    // Enlaces: solo el de recepcion y el del archivo de planes, que arma el codigo.
    for (const e of c.match(ENLACE) ?? []) {
      const ok = (ctx.recepcion && new RegExp(`^(https://)?wa\\.me/${esc(ctx.recepcion)}(\\?.*)?$`, 'i').test(e))
        || (ctx.archivos ?? []).some((u) => e.startsWith(u));
      if (!ok) anota('enlace', c);
    }
    // Toda oferta del asesor lleva un camino: boton, fila o enlace (en el respaldo en texto, la palabra «asesor» o el enlace).
    const ofrece = new RegExp(`hablar con (un asesor|alguien de nuestro equipo|el equipo${asesor ? '|' + esc(asesor) : ''})\\b|te lo responde|te ayuda directamente|te los pasa|toca el bot[oó]n|\\bpasar con\\b`, 'i');
    if (ofrece.test(c) && !esBloqueDePlanes) {
      const camino = payload
        ? (botonesDe(payload).includes('asesor') || filasDe(payload).includes('asesor') || tipoInter(payload) === 'cta_url' || (payload.type === 'text' && (/«asesor»/.test(c) || /wa\.me\//.test(c))))
        : (/«asesor»/.test(c) || /wa\.me\//.test(c));
      if (!camino) anota('ofrece_asesor_sin_boton_ni_fila', c);
    }
    if (esBloqueDePlanes) {
      const camino = payload ? botonesDe(payload).includes('asesor') || /«asesor»/.test(c) : /«asesor»/.test(c);
      if (!camino) anota('planes_sin_salida_al_asesor', c);
    }
  };

  revisarTexto(m.cuerpo, { respaldo: m.esRespaldo === true, payload: m.payload });
  // Lo que el cliente recibiria si Meta rechazara el interactivo: el texto de respaldo.
  if (m.respaldoTexto && m.respaldoTexto !== m.cuerpo && m.tipo === 'interactive') revisarTexto(m.respaldoTexto, { respaldo: true, payload: null });
  return v;
}

/** El tono (no son reglas duras): voseo y trato de usted en lo que recibe el cliente. */
export function tonoDe(texto) {
  const c = String(texto ?? '');
  return { voseo: VOSEO.test(c), usted: USTED.test(c) };
}
/** La calidez (§13): ¿el mensaje lleva al menos un emoji? Con el nivel «muchos» de la consola, los textos del código los traen. */
export function conEmoji(texto) {
  return CON_EMOJI.test(String(texto ?? ''));
}

// ------------------------------------------------------------------------------------------------------- lectura del modelo
/** Las funciones de validacion del propio flujo (las que usa «Armar mensajes»), sacadas del JSON armado: el codigo que corre es ese. */
export function cargarLibreria(flujo) {
  const nodo = flujo.nodes.find((n) => n.name === 'Armar mensajes');
  const codigo = String(nodo?.parameters?.jsCode ?? '');
  const i = codigo.indexOf('// ARMAR MENSAJES:');
  if (i < 0) throw new Error('No encuentro el inicio del código propio de «Armar mensajes» en el flujo: ¿se reconstruyó con otra cabecera?');
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function(...GLOBALES_FUERA, codigo.slice(0, i) + '\nreturn { ccLeerModelo, ccIdsDeRubros, ccIdsDeAclaraciones, ccResumenDePrecios, CC_EMPATIA_RESPALDO, ccLimites, ccContar, ccSistemaAjeno };');
  return fn(...GLOBALES_FUERA.map(() => undefined));
}

const CAMPOS = ['tipo', 'rubroId', 'rubroLibre', 'empatia', 'respuesta', 'aclaracion', 'enLosDatos', 'descarte', 'explicacion', 'necesidad', 'nombre', 'empresa'];

/** ¿El objeto cumple el `responseSchema` que se envio? Devuelve el motivo del primer incumplimiento, o ''. */
function incumpleEsquema(obj, esquema) {
  const props = objeto(esquema?.properties);
  for (const k of esquema?.required ?? CAMPOS) {
    if (!(k in obj)) return `falta ${k}`;
    const p = objeto(props[k]);
    if (p.type === 'STRING' && typeof obj[k] !== 'string') return `${k} no es texto`;
    if (p.type === 'BOOLEAN' && typeof obj[k] !== 'boolean') return `${k} no es booleano`;
    if (Array.isArray(p.enum) && !p.enum.includes(obj[k])) return `${k} fuera de la lista`;
  }
  return '';
}

/**
 * Lo que se mide de UNA llamada al modelo: validez, conformidad, uso de respaldo por campo, empatia y, si el turno trae `espera`,
 * el acierto. `crudo` es la respuesta de `generateContent` tal cual (o `{ error }`).
 */
function evaluarLlamada({ crudo, cuerpo, espera, lib, cfg, plan, uso, ms, reintentos }) {
  const esquema = cuerpo?.generationConfig?.responseSchema;
  const raw = objetoDelTexto(textoDeGemini(crudo));
  const errorHttp = crudo && typeof crudo === 'object' && crudo.error !== undefined;
  const motivoEsquema = raw ? incumpleEsquema(raw, esquema) : 'no es JSON';
  const rec = {
    errorHttp, jsonValido: raw !== null, conforme: raw !== null && motivoEsquema === '', motivoEsquema: raw !== null ? motivoEsquema : (errorHttp ? 'error del servicio' : 'no es JSON'),
    uso, ms, reintentos,
  };
  // Lo mismo que hace «Armar mensajes» con la respuesta (si ese nodo cambia la forma de llamar a `ccLeerModelo`, esto se ajusta; la
  // prueba de la bateria compara los campos aceptados del modo seco con lo que el flujo dice en pantalla y avisa del desvio).
  const ids = lib.ccIdsDeAclaraciones(cfg);
  const v = lib.ccLeerModelo(crudo, {
    rubroIds: lib.ccIdsDeRubros(cfg), aclaracionIds: ids,
    aclaraciones: (Array.isArray(cfg.aclaraciones) ? cfg.aclaraciones : []).slice(0, 15).map((a, i) => ({ id: ids[i], texto: a.texto })),
    textoCliente: plan.texto, textoDeImagen: plan.textoDeImagen, nombreNegocio: cfg.nombreNegocio, asesor: cfg.asesor,
    nombreAsistente: cfg.nombreAsistente, planes: cfg.planes,
    // Lo que ve el modelo: una `respuesta` solo puede traer los numeros que estan ahi (igual que «Armar mensajes»).
    datos: String(cuerpo?.systemInstruction?.parts?.[0]?.text ?? ''),
  });
  rec.fallo = v.ok !== true;
  rec.motivoFallo = v.ok ? '' : String(v.motivo || '');
  rec.campos = {};
  if (v.ok && raw) {
    const estado = (hubo, paso) => (!hubo ? 'vacio' : paso ? 'aceptado' : 'respaldo');
    rec.campos.tipo = esquema?.properties?.tipo?.enum?.includes(raw.tipo) ? 'aceptado' : 'respaldo';
    rec.campos.rubroId = estado(raw.rubroId !== 'ninguno', v.rubroId !== '');
    rec.campos.rubroLibre = estado(String(raw.rubroLibre).trim() !== '', v.rubroLibre !== '');
    // La empatia: respaldo si el modelo no puso nada o el codigo la cambio por la de respaldo («¡Te entiendo! 😊»).
    const empatiaPaso = String(raw.empatia).trim() !== '' && (v.empatia !== lib.CC_EMPATIA_RESPALDO || String(raw.empatia).trim() === lib.CC_EMPATIA_RESPALDO);
    rec.campos.empatia = empatiaPaso ? 'aceptado' : 'respaldo';
    rec.campos.aclaracion = estado(raw.aclaracion !== 'ninguno', v.aclaracion !== '');
    // Con una aclaracion valida, `respuesta` es el texto de la consola: no mide al modelo.
    rec.campos.respuesta = v.aclaracion ? 'porAclaracion' : estado(String(raw.respuesta).trim() !== '', v.respuesta !== '');
    rec.campos.enLosDatos = estado(raw.enLosDatos === true, v.enLosDatos === true);
    rec.campos.descarte = estado(raw.descarte !== 'ninguno', v.descarte !== '');
    // §16: lo que el modelo extrae del cliente o redacta por rubro: la explicación (con los puntos clave), la necesidad, el nombre y la empresa.
    rec.campos.explicacion = estado(String(raw.explicacion ?? '').trim() !== '', v.explicacion !== '');
    rec.campos.necesidad = estado(String(raw.necesidad ?? '').trim() !== '', v.necesidad !== '');
    rec.campos.nombre = estado(String(raw.nombre ?? '').trim() !== '', v.nombre !== '');
    rec.campos.empresa = estado(String(raw.empresa ?? '').trim() !== '', v.empresa !== '');
    rec.explicacion = { palabras: palabrasDe(v.explicacion), oraciones: oracionesDe(v.explicacion), aceptada: v.explicacion !== '' };
    rec.tono = {
      palabras: palabrasDe(raw.empatia), hastaDosOraciones: oracionesDe(raw.empatia) <= lib.ccLimites().empatia.oraciones, sinPregunta: !/[?¿]/.test(raw.empatia),
      hastaElLimite: String(raw.empatia).length <= lib.ccLimites().empatia.caracteres && palabrasDe(raw.empatia) <= lib.ccLimites().empatia.palabras,
      sinVoseo: !VOSEO.test(raw.empatia), tuteo: !USTED.test(raw.empatia), vacia: String(raw.empatia).trim() === '', conEmoji: CON_EMOJI.test(raw.empatia),
    };
    rec.tipoDicho = raw.tipo; rec.descarteDicho = raw.descarte;
    rec.afirmaDatos = raw.enLosDatos === true && (String(raw.respuesta).trim() !== '' || (raw.aclaracion !== 'ninguno' && String(raw.aclaracion).trim() !== ''));
    rec.datosEfectivos = v.enLosDatos === true;
  } else if (raw && raw.tipo !== undefined) {
    rec.tipoDicho = raw.tipo;
  }
  if (espera && v.ok && raw) {
    const e = espera;
    const norma = (x) => norm(x);
    const en = (a, x) => (Array.isArray(a) ? a : [a]).includes(x);
    rec.evaluado = {};
    if (e.tipo !== undefined) {
      rec.evaluado.tipo = en(e.tipo, raw.tipo);
      rec.evaluado.pidePlanesIndebido = raw.tipo === 'pide_planes' && !en(e.tipo, 'pide_planes');
    }
    if (e.rubroId !== undefined) rec.evaluado.rubroId = raw.rubroId === e.rubroId;
    if (e.rubroLibre !== undefined) rec.evaluado.rubroLibre = e.rubroLibre === '' ? v.rubroLibre === '' : norma(v.rubroLibre).includes(norma(e.rubroLibre));
    if (e.descarte !== undefined) rec.evaluado.descarte = (raw.descarte !== 'ninguno') === e.descarte;
    // §16: `necesidad`, `nombre` y `empresa`: el texto esperado (o '' si no debía extraer nada); `explicacion: true` si debía redactar una válida.
    for (const k of ['necesidad', 'nombre', 'empresa']) if (e[k] !== undefined) rec.evaluado[k] = e[k] === '' ? v[k] === '' : norma(v[k]).includes(norma(e[k]));
    if (e.explicacion !== undefined) rec.evaluado.explicacion = (v.explicacion !== '') === e.explicacion;
    if (e.enLosDatos !== undefined) {
      rec.evaluado.enLosDatos = rec.afirmaDatos === e.enLosDatos;
      rec.evaluado.invencion = e.enLosDatos === false && rec.afirmaDatos;
      rec.evaluado.invencionEfectiva = e.enLosDatos === false && rec.datosEfectivos;
    }
  } else if (espera) {
    // Se esperaba un resultado util y el objeto fallo: cuenta como desacierto en cada campo evaluado.
    rec.evaluado = {};
    for (const k of ['tipo', 'rubroId', 'rubroLibre', 'descarte', 'enLosDatos', 'necesidad', 'nombre', 'empresa', 'explicacion']) if (espera[k] !== undefined) rec.evaluado[k] = false;
  }
  return rec;
}

// ------------------------------------------------------------------------------------------------------- una conversacion
const mensajeDeMeta = (t, wamid, cliente) => {
  const base = { from: cliente, id: wamid, timestamp: '1' };
  if (t.tipo === 'texto') return { ...base, type: 'text', text: { body: t.texto } };
  if (t.tipo === 'fila') return { ...base, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: t.id, title: t.titulo ?? t.id } } };
  if (t.tipo === 'boton') return { ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: t.id, title: t.titulo ?? t.id } } };
  if (t.tipo === 'audio') return { ...base, type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true } };
  throw new Error('tipo de turno desconocido: ' + t.tipo);
};
const valorMeta = (msg, cliente) => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: PID, phone_number_id: PID },
  contacts: [{ profile: { name: 'Ana Prueba' }, wa_id: cliente }],
  messages: [msg],
});
const dichoDe = (t) => (t.tipo === 'texto' ? t.texto : t.tipo === 'audio' ? `(audio) ${t.transcripcion}` : `(toque) ${t.id}`);

const MODELO_BASE = { tipo: 'respuesta', rubroId: 'ninguno', rubroLibre: '', empatia: 'Te entiendo.', respuesta: '', aclaracion: 'ninguno', enLosDatos: false, descarte: 'ninguno', explicacion: '', necesidad: '', nombre: '', empresa: '' };
const respuestaDeGemini = (texto) => ({ candidates: [{ content: { parts: [{ text: texto }] } }] });

/** Una corrida (un caso, una repeticion): un mundo nuevo, con su estado, su planilla y su reloj. */
export async function correrCaso({ caso, rep, flujo, lib, opciones, credencial, deps }) {
  const CLIENTE = telefonoDe(caso.id, rep);
  const panel = panelDe(caso.opciones ?? {});
  const hoja = { filas: [] };
  const turnoActual = { t: null };
  let captura = null;
  const salidas = [];
  let seqSalida = 0;
  const celdas = (f) => Object.fromEntries(ENC.map((h, c) => [h, f[c] ?? '']));
  const formulas = [];
  // Lo que Google Sheets guarda: con USER_ENTERED el apostrofo inicial es texto y un «=» seria una formula; con RAW nada se interpreta.
  const celda = (valor, formato) => {
    const v = String(valor ?? '');
    if (formato === 'USER_ENTERED') {
      if (v.startsWith("'")) return v.slice(1);
      if (/^[=+\-@]/.test(v)) formulas.push(v);
    }
    return v;
  };

  const aceptado = () => ({ statusCode: 200, body: { messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${++seqSalida}` }] } });
  const envio = (nodo) => (ll) => {
    const payload = ll.cuerpo ?? {};
    captura.mensajes.push({ nodo, a: String(payload.to ?? ''), tipo: String(payload.type ?? ''), payload, cuerpo: textoDeEnvio(payload), evento: String(ll.item.evento ?? ''),
      respaldoTexto: nodo === 'Enviar a WhatsApp' ? String(ll.item.respaldo ?? '') : '', esRespaldo: nodo !== 'Enviar a WhatsApp' });
    return aceptado();
  };
  const dobles = {
    'Traer configuración': () => ({ statusCode: 200, body: panel }),
    'Reportar mensaje (entrante)': () => ({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } }),
    'Reportar mensaje (saliente)': () => ({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } }),
    'Obtener URL del medio (general)': () => ({ id: 'm', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/medio-1', mime_type: 'audio/ogg', file_size: 5000 }),
    'Descargar medio': () => ({ descargado: true }),
    'Transcribir audio': () => ({ content: { parts: [{ text: String(turnoActual.t?.transcripcion ?? '') }] } }),
    'Describir imagen': () => ({ content: { parts: [{ text: JSON.stringify({ categoria: 'otro', texto: '' }) }] } }),
    'Describir documento': () => ({ content: { parts: [{ text: JSON.stringify({ categoria: 'otro', texto: '' }) }] } }),
    'Llamar al modelo': async (ll) => {
      const t = turnoActual.t;
      if (opciones.seco) {
        const s = t?.seco;
        const resp = s === 'ERROR' ? { error: { message: 'simulado', httpCode: '503' } }
          : typeof s === 'string' ? respuestaDeGemini(s)
            : respuestaDeGemini(JSON.stringify({ ...MODELO_BASE, ...(s ?? {}) }));
        captura.modelo = { cuerpo: ll.cuerpo, crudo: resp, uso: null, ms: 0, reintentos: 0 };
        return resp;
      }
      const r = await llamarGemini({ cuerpo: ll.cuerpo, urlDelNodo: ll.url, credencial, opciones, deps, nodo: flujo.nodes.find((n) => n.name === 'Llamar al modelo') });
      const u = objeto(r.json.usageMetadata);
      const uso = r.fallo ? null : {
        entrada: Number(u.promptTokenCount) || 0, salida: Number(u.candidatesTokenCount) || 0,
        cacheados: Number(u.cachedContentTokenCount) || 0, razonamiento: Number(u.thoughtsTokenCount) || 0,
      };
      captura.modelo = { cuerpo: ll.cuerpo, crudo: r.json, uso, ms: r.ms, reintentos: r.reintentos };
      return r.json;
    },
    'Enviar a WhatsApp': envio('Enviar a WhatsApp'),
    'Enviar texto de respaldo': envio('Enviar texto de respaldo'),
    'Guardar prospecto': () => ({ statusCode: 200, body: { ok: true } }),
    'Buscar teléfono en planilla': (ll) => {
      const valores = ((objeto(ll.parametros.filtersUI).values) ?? []).map((v) => String(v.lookupValue ?? ''));
      const k = hoja.filas.findIndex((f) => valores.includes(String(f[4] ?? '')));
      return k < 0 ? {} : Object.assign({ row_number: k + 2 }, Object.fromEntries(ENC.slice(0, 10).map((h, c) => [h, hoja.filas[k][c] ?? ''])));
    },
    'Leer IDs de la planilla': () => (hoja.filas.length ? hoja.filas.map((f, j) => ({ row_number: j + 2, 'ID Lead': f[0] ?? '' })) : [{}]),
    'Agregar fila': (ll) => {
      const formato = String(objeto(ll.parametros.options).cellFormat ?? '');
      const fila = ENC.map((h) => (h in ll.item ? celda(ll.item[h], formato) : ''));
      hoja.filas.push(fila);
      return Object.assign(celdas(fila), { row_number: hoja.filas.length + 3 });
    },
    'Actualizar fila': (ll) => {
      const fila = hoja.filas[Number(ll.item.row_number) - 4];
      if (!fila) return { error: { name: 'NodeApiError', message: 'la fila no existe' } };
      const formato = String(objeto(ll.parametros.options).cellFormat ?? '');
      ENC.forEach((h, c) => { if (h in ll.item) fila[c] = celda(ll.item[h], formato); });
      return Object.assign(celdas(fila), { row_number: ll.item.row_number });
    },
  };
  const mundo = crearMundo({
    flujo, dobles, ahoraMs: AHORA,
    configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: REC, horarioAtencion: '', planillaProspectosId: ID_PLANILLA, planillaProspectosHoja: 'Leads_CRM', mensajeComercioSuspendido: SUSPENDIDO },
  });

  const corrida = { caso: caso.id, rep, turnos: [], llamadas: [], violaciones: [], tonos: [], mensajes: 0, plantillas: 0, fallos: [], sinModelo: [], asesor: '', palabras: [], repeticiones: 0, oracionesRepetidas: 0, harvard: 0 };
  let anterior = '';   // el ultimo mensaje al cliente de esta conversacion
  for (const [i, t] of caso.turnos.entries()) {
    captura = { mensajes: [], modelo: null };
    turnoActual.t = t;
    const r = await mundo.turno(valorMeta(mensajeDeMeta(t, `wamid.BAT${caso.id}.${rep}.${i + 1}`, CLIENTE), CLIENTE));
    if (r.fallo) corrida.fallos.push(`#${i + 1} «${r.fallo.nodo}»: ${r.fallo.mensaje}`);
    const cfg = (r.porNodo['Config del negocio'] ?? [])[0] ?? {};
    const plan = ((r.porNodo['Decidir turno'] ?? [])[0] ?? {}).plan ?? {};
    corrida.asesor = String(cfg.asesor ?? corrida.asesor);
    const alCliente = captura.mensajes.filter((m) => m.a === CLIENTE && m.tipo !== 'template');
    corrida.mensajes += alCliente.length;
    corrida.plantillas += captura.mensajes.filter((m) => m.tipo === 'template').length;
    // El resumen de precios del mensaje de planes lo arma el CODIGO con los minimos de la consola: no es un monto del modelo.
    const resumen = cfg.planes || cfg.cargosUnicos ? lib.ccResumenDePrecios(cfg) : '';
    const ctx = {
      asesor: corrida.asesor, recepcion: REC, aclaraciones: ACLARACIONES.map((a) => a.texto).concat(resumen ? [resumen] : []), archivos: [ARCHIVO.url],
      lib, propios: ['NovuChat', 'Kenji', ...PLANES.map((x) => x.nombre)].flatMap((x) => x.split(' ')),
    };
    // C1 (§13): un rubro de la consola sin entrada en el guion se atiende como «Otro»; eso cuenta como fallo, no se calla.
    for (const aviso of ((r.porNodo['Armar mensajes'] ?? [])[0] ?? {}).avisos ?? []) {
      corrida.violaciones.push({ caso: caso.id, rep, turno: i + 1, dicho: dichoDe(t), regla: aviso, texto: `el rubro «${String(plan.e?.rubroId ?? '')}» de la consola no tiene entrada en el guion y se atendió como «Otro»` });
    }
    for (const m of alCliente) {
      for (const x of revisarMensaje(m, ctx)) corrida.violaciones.push({ caso: caso.id, rep, turno: i + 1, dicho: dichoDe(t), ...x });
      if (!m.esRespaldo) {
        corrida.tonos.push({ ...tonoDe(m.cuerpo), conEmoji: conEmoji(m.cuerpo) });
        // §15: la longitud, la repeticion (el mismo mensaje dos veces seguidas es un fallo; una oracion de 5 palabras o mas que se repite en
        // el mensaje siguiente solo se cuenta: retomar la pregunta pendiente es a proposito) y el dato de Harvard (una vez por conversacion).
        corrida.palabras.push(palabrasDe(m.cuerpo));
        if (anterior !== '' && norm(m.cuerpo) === norm(anterior)) {
          corrida.repeticiones += 1;
          corrida.violaciones.push({ caso: caso.id, rep, turno: i + 1, dicho: dichoDe(t), regla: 'mensaje_repetido_seguido', texto: String(m.cuerpo).replace(/\s+/g, ' ').slice(0, 200) });
        }
        const prev = new Set(oracionesTexto(anterior));
        corrida.oracionesRepetidas += oracionesTexto(m.cuerpo).filter((o) => prev.has(o)).length;
        if (/Harvard/i.test(m.cuerpo)) corrida.harvard += 1;
        anterior = m.cuerpo;
      }
    }
    // §15: `exige` (en un turno del caso) pide que la conversacion AVANCE o que se ofrezca al asesor, no solo que el modelo acierte el tipo:
    // `accion`: la accion final del turno (`oferta`, `contacto`, `retomar`…; una o varias aceptables); `boton`: algun mensaje con el boton o la fila del asesor.
    if (t.exige) {
      const accionFinal = String((((r.porNodo['Armar mensajes'] ?? [])[0] ?? {}).resumen ?? {}).plan ?? '');
      const aceptables = [].concat(t.exige.accion ?? []);
      if (aceptables.length && !aceptables.includes(accionFinal)) {
        corrida.violaciones.push({ caso: caso.id, rep, turno: i + 1, dicho: dichoDe(t), regla: 'no_avanza', texto: `se esperaba ${aceptables.join(' o ')} y salio «${accionFinal}»` });
      }
      if (t.exige.boton === true && !alCliente.some((m) => botonesDe(m.payload).includes('asesor') || filasDe(m.payload).includes('asesor') || tipoInter(m.payload) === 'cta_url')) {
        corrida.violaciones.push({ caso: caso.id, rep, turno: i + 1, dicho: dichoDe(t), regla: 'sin_boton_del_asesor', texto: alCliente.map((m) => m.cuerpo).join(' | ').slice(0, 200) });
      }
      // §16: lo que el documento comercial manda en ese turno. `termina`: el mensaje acaba EXACTO con ese texto; `contiene` / `noContiene`: textos (normalizados) que tienen que estar o no;
      // `sinCifras`: ni un dígito; `imagenPlanes`: sale el mensaje de planes con su imagen; `sinModelo`: el código contestó solo (cero llamadas).
      const todo = alCliente.map((m) => m.cuerpo).join(' | ');
      const falla = (regla, texto) => corrida.violaciones.push({ caso: caso.id, rep, turno: i + 1, dicho: dichoDe(t), regla, texto: String(texto).replace(/\s+/g, ' ').slice(0, 200) });
      if (t.exige.termina !== undefined && !alCliente.some((m) => norm(m.cuerpo).endsWith(norm(t.exige.termina)))) falla('no_termina_como_se_exige', todo);
      for (const x of [].concat(t.exige.contiene ?? [])) if (!norm(todo).includes(norm(x))) falla('falta_lo_que_se_exige', `falta «${x}» en: ${todo}`);
      for (const x of [].concat(t.exige.noContiene ?? [])) if (norm(todo).includes(norm(x))) falla('trae_lo_que_no_debe', `trae «${x}» en: ${todo}`);
      if (t.exige.sinCifras === true && /\d/.test(todo)) falla('cifra_donde_no_va', todo);
      if (t.exige.imagenPlanes === true && !alCliente.some((m) => objeto(objeto(m.payload).interactive).header !== undefined)) falla('sin_imagen_de_planes', todo);
      if (t.exige.sinModelo === true && captura.modelo) falla('llamo_al_modelo_sin_necesidad', todo);
    }
    // §16 (D7): la 1.ª explicación de rubro de la conversación termina con la pregunta EXACTA del documento comercial.
    if (corrida.cierreExacto === undefined) {
      const expl = alCliente.find((m) => m.evento === 'explicacion');
      if (expl) corrida.cierreExacto = norm(expl.cuerpo).endsWith(norm(CIERRE_EXACTO));
    }
    salidas.push({ turno: i + 1, dicho: dichoDe(t), mensajes: alCliente.map((m) => m.cuerpo) });
    if (captura.modelo) {
      const l = evaluarLlamada({ ...captura.modelo, espera: t.espera, lib, cfg, plan });
      corrida.llamadas.push({ caso: caso.id, rep, turno: i + 1, ...l });
    } else if (t.espera) corrida.sinModelo.push(i + 1);
  }
  if (corrida.harvard > 1) corrida.violaciones.push({ caso: caso.id, rep, turno: caso.turnos.length, dicho: '(la conversacion)', regla: 'harvard_mas_de_una_vez', texto: `el dato de Harvard salio ${corrida.harvard} veces` });
  const ficha = objeto(objeto(mundo.sd.captacionMinima)[CLIENTE]);
  corrida.descarteFinal = String(objeto(ficha.hechos).descarte ?? '') !== '';
  corrida.paso = String(ficha.paso ?? '');
  const fila = hoja.filas.find((f) => String(f[4] ?? '').replace(/\D/g, '') === CLIENTE);
  corrida.calificacion = fila ? String(fila[ENC.indexOf(COL_CALIFICACION)] ?? '') : '(sin fila)';
  corrida.planilla = fila ? celdas(fila) : null;
  // §16: lo que el caso espera de la FILA de la hoja (la calificación, el nombre, la empresa y el resumen que arma el código: necesidad, temas y lo que pidió).
  if (caso.planilla) {
    const falla = (texto) => corrida.violaciones.push({ caso: caso.id, rep, turno: caso.turnos.length, dicho: '(la planilla)', regla: 'planilla_no_coincide', texto: String(texto).slice(0, 200) });
    if (!corrida.planilla) falla('no hay fila en la planilla');
    else {
      if (caso.planilla.calificacion !== undefined && corrida.planilla[COL_CALIFICACION] !== caso.planilla.calificacion) falla(`calificación ${corrida.planilla[COL_CALIFICACION]} y se esperaba ${caso.planilla.calificacion}`);
      for (const [col, textos] of Object.entries(caso.planilla.contiene ?? {})) for (const x of [].concat(textos)) if (!norm(corrida.planilla[col]).includes(norm(x))) falla(`«${col}» no contiene «${x}»: ${corrida.planilla[col]}`);
      for (const [col, textos] of Object.entries(caso.planilla.noContiene ?? {})) for (const x of [].concat(textos)) if (norm(corrida.planilla[col]).includes(norm(x))) falla(`«${col}» contiene «${x}»: ${corrida.planilla[col]}`);
    }
  }
  corrida.filas = hoja.filas.length;
  corrida.formulas = formulas.length;
  corrida.conversacion = salidas;
  return corrida;
}

// ------------------------------------------------------------------------------------------------------- metricas
const suma = (a) => a.reduce((x, y) => x + y, 0);
const media = (a) => (a.length ? suma(a) / a.length : 0);
function percentil(a, p) {
  if (!a.length) return 0;
  const o = [...a].sort((x, y) => x - y);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
}
const costoDe = (u) => ((u.entrada - u.cacheados) * TARIFA.entrada + u.cacheados * TARIFA.cacheado + (u.salida + u.razonamiento) * TARIFA.salida) / 1e6;

/** Todas las metricas de un conjunto de corridas (un caso, o todos). */
export function medir(corridas, descarteEsperado = () => false) {
  const llamadas = corridas.flatMap((c) => c.llamadas);
  const ev = (clave) => llamadas.filter((l) => l.evaluado && clave in l.evaluado);
  const cuenta = (lista, f) => ({ ok: lista.filter(f).length, n: lista.length });
  const campos = {};
  for (const k of CAMPOS) {
    const est = llamadas.filter((l) => !l.fallo && l.campos[k]).map((l) => l.campos[k]);
    campos[k] = { aceptado: est.filter((x) => x === 'aceptado').length, respaldo: est.filter((x) => x === 'respaldo').length, vacio: est.filter((x) => x === 'vacio').length, porAclaracion: est.filter((x) => x === 'porAclaracion').length };
  }
  const tonos = llamadas.filter((l) => l.tono).map((l) => l.tono);
  const usos = llamadas.filter((l) => l.uso).map((l) => l.uso);
  const uso = {
    llamadasConUso: usos.length,
    entrada: suma(usos.map((u) => u.entrada)), salida: suma(usos.map((u) => u.salida)), cacheados: suma(usos.map((u) => u.cacheados)), razonamiento: suma(usos.map((u) => u.razonamiento)),
  };
  const latencias = llamadas.filter((l) => l.uso).map((l) => l.ms);
  const descartes = corridas.map((c) => ({ esperado: descarteEsperado(c.caso), real: c.descarteFinal }));
  return {
    corridas: corridas.length,
    mensajesPorCorrida: media(corridas.map((c) => c.mensajes)),
    plantillasPorCorrida: media(corridas.map((c) => c.plantillas)),
    llamadasPorCorrida: media(corridas.map((c) => c.llamadas.length)),
    llamadas: llamadas.length,
    erroresDelServicio: llamadas.filter((l) => l.errorHttp).length,
    reintentos: suma(llamadas.map((l) => l.reintentos || 0)),
    jsonValido: cuenta(llamadas, (l) => l.jsonValido),
    conforme: cuenta(llamadas, (l) => l.conforme),
    fallo: llamadas.filter((l) => l.fallo).length,
    campos,
    empatia: {
      n: tonos.length,
      hastaDosOraciones: cuenta(tonos, (t) => t.hastaDosOraciones), sinPregunta: cuenta(tonos, (t) => t.sinPregunta), sinVoseo: cuenta(tonos, (t) => t.sinVoseo),
      tuteo: cuenta(tonos, (t) => t.tuteo), hastaElLimite: cuenta(tonos, (t) => t.hastaElLimite), vacias: tonos.filter((t) => t.vacia).length,
      conEmoji: cuenta(tonos, (t) => t.conEmoji),
      palabrasMedias: redondear(media(tonos.map((t) => t.palabras)), 1),
      todoOk: cuenta(tonos, (t) => t.hastaDosOraciones && t.sinPregunta && t.sinVoseo && t.tuteo && t.hastaElLimite && !t.vacia),
    },
    tipo: cuenta(ev('tipo'), (l) => l.evaluado.tipo === true),
    pidePlanesIndebido: ev('tipo').filter((l) => l.evaluado.pidePlanesIndebido === true).length,
    rubroId: cuenta(ev('rubroId'), (l) => l.evaluado.rubroId === true),
    rubroLibre: cuenta(ev('rubroLibre'), (l) => l.evaluado.rubroLibre === true),
    descarteTurno: cuenta(ev('descarte'), (l) => l.evaluado.descarte === true),
    descarteFinal: {
      ok: descartes.filter((d) => d.esperado === d.real).length, n: descartes.length,
      falsosPositivos: descartes.filter((d) => !d.esperado && d.real).length, falsosNegativos: descartes.filter((d) => d.esperado && !d.real).length,
    },
    enLosDatos: cuenta(ev('enLosDatos'), (l) => l.evaluado.enLosDatos === true),
    invenciones: ev('enLosDatos').filter((l) => l.evaluado.invencion === true).length,
    invencionesEfectivas: ev('enLosDatos').filter((l) => l.evaluado.invencionEfectiva === true).length,
    violaciones: suma(corridas.map((c) => c.violaciones.length)),
    // §15: palabras por mensaje al cliente, repeticiones seguidas (0 esperado) y apariciones del dato de Harvard por conversacion (hasta 1).
    longitud: (() => {
      const todas = corridas.flatMap((c) => c.palabras ?? []);
      const ord = [...todas].sort((a, b) => a - b);
      return { mensajes: todas.length, palabrasMedias: redondear(media(todas), 1), mediana: ord.length ? ord[Math.floor(ord.length / 2)] : 0, maximo: ord.length ? ord[ord.length - 1] : 0 };
    })(),
    repeticionesSeguidas: suma(corridas.map((c) => c.repeticiones ?? 0)),
    // §16 (D7): conversaciones cuya 1.ª explicación de rubro termina con la pregunta EXACTA del documento comercial (se espera todas).
    cierreExacto: { ok: corridas.filter((c) => c.cierreExacto === true).length, n: corridas.filter((c) => c.cierreExacto !== undefined).length },
    oracionesRepetidasSeguidas: suma(corridas.map((c) => c.oracionesRepetidas ?? 0)),
    harvard: { conversacionesConElDato: corridas.filter((c) => (c.harvard ?? 0) > 0).length, maxPorConversacion: Math.max(0, ...corridas.map((c) => c.harvard ?? 0)) },
    tono: {
      mensajes: suma(corridas.map((c) => c.tonos.length)),
      voseo: suma(corridas.map((c) => c.tonos.filter((t) => t.voseo).length)),
      usted: suma(corridas.map((c) => c.tonos.filter((t) => t.usted).length)),
      // La calidez (§13): mensajes del flujo sin un solo emoji (informativo: con el nivel «muchos», casi todos llevan).
      sinEmoji: suma(corridas.map((c) => c.tonos.filter((t) => t.conEmoji === false).length)),
    },
    avisosDeConfiguracion: suma(corridas.map((c) => c.violaciones.filter((v) => v.regla === 'rubro_sin_guion').length)),
    sinModelo: corridas.flatMap((c) => c.sinModelo.map((t) => `${c.caso}#${t}`)).filter((x, i, a) => a.indexOf(x) === i),
    formulasEnLaPlanilla: suma(corridas.map((c) => c.formulas || 0)),
    filasPorCorrida: media(corridas.map((c) => c.filas || 0)),
    fallosDeNodo: corridas.flatMap((c) => c.fallos.map((f) => `${c.caso}${f}`)),
    calificaciones: corridas.reduce((a, c) => { a[c.calificacion] = (a[c.calificacion] ?? 0) + 1; return a; }, {}),
    uso: { ...uso, latenciaMediaMs: Math.round(media(latencias)), latenciaP50Ms: Math.round(percentil(latencias, 50)), latenciaP95Ms: Math.round(percentil(latencias, 95)), latenciaMaxMs: Math.round(Math.max(0, ...latencias)), costoUsd: usos.length ? redondear(costoDe(uso), 6) : null },
  };
}

// ------------------------------------------------------------------------------------------------------- casos
/** Lee y valida `bateria-casos.json`: un caso mal escrito se rechaza con su id, nunca se corre a medias. */
export function validarCasos(datos) {
  const casos = datos?.casos;
  if (!Array.isArray(casos) || !casos.length) throw new Error('bateria-casos.json: falta la lista `casos`.');
  const ids = new Set();
  for (const c of casos) {
    if (!c || typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(c.id)) throw new Error('bateria-casos.json: un caso sin id válido.');
    if (ids.has(c.id)) throw new Error(`bateria-casos.json: id repetido ${c.id}.`);
    ids.add(c.id);
    if (typeof c.titulo !== 'string' || !c.titulo) throw new Error(`bateria-casos.json: ${c.id} sin título.`);
    if (!Array.isArray(c.turnos) || !c.turnos.length) throw new Error(`bateria-casos.json: ${c.id} sin turnos.`);
    for (const [i, t] of c.turnos.entries()) {
      const donde = `${c.id}, turno ${i + 1}`;
      if (t.tipo === 'texto' && typeof t.texto !== 'string') throw new Error(`bateria-casos.json: ${donde}: falta el texto.`);
      else if ((t.tipo === 'fila' || t.tipo === 'boton') && typeof t.id !== 'string') throw new Error(`bateria-casos.json: ${donde}: falta el id.`);
      else if (t.tipo === 'audio' && typeof t.transcripcion !== 'string') throw new Error(`bateria-casos.json: ${donde}: falta la transcripción.`);
      else if (!['texto', 'fila', 'boton', 'audio'].includes(t.tipo)) throw new Error(`bateria-casos.json: ${donde}: tipo de turno desconocido.`);
      if (t.seco !== undefined && typeof t.seco !== 'string' && (typeof t.seco !== 'object' || t.seco === null || Object.keys(t.seco).some((k) => !CAMPOS.includes(k)))) {
        throw new Error(`bateria-casos.json: ${donde}: «seco» debe ser un objeto con campos del esquema, o un texto.`);
      }
      if (t.exige !== undefined && (typeof t.exige !== 'object' || t.exige === null || Object.keys(t.exige).some((k) => !['accion', 'boton', 'termina', 'contiene', 'noContiene', 'sinCifras', 'imagenPlanes', 'sinModelo'].includes(k)))) {
        throw new Error(`bateria-casos.json: ${donde}: «exige» solo admite accion, boton, termina, contiene, noContiene, sinCifras, imagenPlanes y sinModelo.`);
      }
      if (t.espera !== undefined && (typeof t.espera !== 'object' || Object.keys(t.espera).some((k) => !['tipo', 'rubroId', 'rubroLibre', 'descarte', 'enLosDatos', 'necesidad', 'nombre', 'empresa', 'explicacion'].includes(k)))) {
        throw new Error(`bateria-casos.json: ${donde}: «espera» con un campo desconocido.`);
      }
    }
    if (c.planilla !== undefined && (typeof c.planilla !== 'object' || c.planilla === null || Object.keys(c.planilla).some((k) => !['calificacion', 'contiene', 'noContiene'].includes(k)))) {
      throw new Error(`bateria-casos.json: ${c.id}: «planilla» solo admite calificacion, contiene y noContiene.`);
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
  const esperado = (id) => casos.find((c) => c.id === id)?.descartaFinal === true;
  const m = (cs) => medir(cs, esperado);
  const total = m(corridas);
  // `conversacion`: lo que dijo el cliente y lo que recibio, de la primera corrida (para leer con los ojos, sin entrar a la planilla).
  const casosMedidos = porCaso.map(({ caso, corridas: cs }) => ({ id: caso.id, titulo: caso.titulo, ...m(cs), conversacion: cs[0]?.conversacion ?? [] }));
  const violaciones = corridas.flatMap((c) => c.violaciones);
  const porRegla = violaciones.reduce((a, v) => { a[v.regla] = (a[v.regla] ?? 0) + 1; return a; }, {});
  return {
    version: 1,
    modo: opciones.seco ? 'seco' : 'real',
    proveedor,
    modelo,
    corridasPorCaso: opciones.n,
    casos: casosMedidos,
    total,
    violaciones: { total: violaciones.length, porRegla, detalle: violaciones },
    costo: {
      usd: total.uso.costoUsd,
      tarifa: { ...TARIFA, unidad: 'USD por millón de tokens' },
      supuesto: SUPUESTO_TARIFA,
    },
    aviso: opciones.seco ? 'SECO: el modelo es simulado (respuestas fijas por turno); las cifras del modelo, el uso y el costo no significan nada.' : '',
  };
}

function textoDelInforme(r) {
  const o = [];
  o.push(`Modelo: ${r.modelo} · proveedor: ${r.proveedor} · ${r.casos.length} casos · ${r.corridasPorCaso} corridas por caso`);
  if (r.aviso) o.push(r.aviso);
  o.push('');
  const cols = ['CASO', 'TÍTULO', 'CORR', 'MSJ/C', 'LLAM/C', 'JSON', 'ESQ', 'TIPO', 'RUBRO', 'DESC', 'DATOS', 'EMP', 'VIOL'];
  const filas = r.casos.map((c) => [c.id, c.titulo.slice(0, 38), c.corridas, redondear(c.mensajesPorCorrida, 1), redondear(c.llamadasPorCorrida, 1),
    pct(c.jsonValido.ok, c.jsonValido.n), pct(c.conforme.ok, c.conforme.n), fr(c.tipo), fr({ ok: c.rubroId.ok + c.rubroLibre.ok, n: c.rubroId.n + c.rubroLibre.n }),
    fr(c.descarteFinal), fr(c.enLosDatos), fr(c.empatia.todoOk), c.violaciones]);
  const t = r.total;
  filas.push(['TOTAL', '', t.corridas, redondear(t.mensajesPorCorrida, 1), redondear(t.llamadasPorCorrida, 1), pct(t.jsonValido.ok, t.jsonValido.n), pct(t.conforme.ok, t.conforme.n),
    fr(t.tipo), fr({ ok: t.rubroId.ok + t.rubroLibre.ok, n: t.rubroId.n + t.rubroLibre.n }), fr(t.descarteFinal), fr(t.enLosDatos), fr(t.empatia.todoOk), t.violaciones]);
  o.push(tablaTexto(filas, cols));
  o.push('');
  o.push('MSJ/C = mensajes al cliente por corrida · LLAM/C = llamadas al modelo por corrida · JSON/ESQ = JSON válido / conforme al esquema (sobre las llamadas)');
  o.push('TIPO = acierto de `tipo` · RUBRO = `rubroId` y `rubroLibre` acertados · DESC = descarte final correcto por corrida (verdaderos en C11 y C12) · DATOS = `enLosDatos` honesto');
  o.push('EMP = empatía del modelo que cumple todo (hasta 2 oraciones, ≤220 caracteres y ≤34 palabras, sin «?», sin voseo, de tú) · VIOL = violaciones de reglas duras sobre lo que el cliente recibe (incluye `rubro_sin_guion`)');
  o.push('');
  o.push('Campos del modelo (todas las llamadas con objeto válido): aceptado = pasó la validación · respaldo = el código lo reemplazó · vacío = el modelo no puso nada');
  const kc = Object.entries(t.campos).map(([k, v]) => [k, v.aceptado, v.respaldo, v.vacio, v.porAclaracion]);
  o.push(tablaTexto(kc, ['CAMPO', 'ACEPTADO', 'RESPALDO', 'VACÍO', 'ACLARAC.']));
  o.push(`FALLO (objeto entero inválido: «Disculpa, no pude procesar tu mensaje…»): ${t.fallo} de ${t.llamadas} llamadas${t.erroresDelServicio ? ` (${t.erroresDelServicio} con error del servicio)` : ''}`);
  o.push('');
  o.push(`Empatía (${t.empatia.n} medidas): hasta 2 oraciones ${fr(t.empatia.hastaDosOraciones)} · ≤220 caracteres y ≤34 palabras ${fr(t.empatia.hastaElLimite)} · sin «?» ${fr(t.empatia.sinPregunta)} · sin voseo ${fr(t.empatia.sinVoseo)} · de tú ${fr(t.empatia.tuteo)} · con emoji ${fr(t.empatia.conEmoji)} · vacías ${t.empatia.vacias} · ${t.empatia.palabrasMedias} palabras en promedio`);
  o.push(`Acierto: tipo ${fr(t.tipo)} (pide_planes indebido ${t.pidePlanesIndebido}) · rubroId ${fr(t.rubroId)} · rubroLibre ${fr(t.rubroLibre)} · descarte por turno ${fr(t.descarteTurno)}`);
  o.push(`Descarte final por corrida: ${fr(t.descarteFinal)} (falsos positivos ${t.descarteFinal.falsosPositivos}, falsos negativos ${t.descarteFinal.falsosNegativos})`);
  o.push(`Honestidad de enLosDatos: ${fr(t.enLosDatos)} · el modelo afirmó tener datos que no hay: ${t.invenciones} (llegaron al cliente: ${t.invencionesEfectivas})`);
  o.push(`Calificación final (planilla): ${Object.entries(t.calificaciones).map(([k, v]) => `${k || '(vacía)'} ${v}`).join(', ') || '—'}`);
  o.push(`Longitud: ${t.longitud.palabrasMedias} palabras por mensaje en promedio (mediana ${t.longitud.mediana}, máximo ${t.longitud.maximo}) · mensajes idénticos seguidos ${t.repeticionesSeguidas} (se espera 0) · oraciones repetidas de un mensaje al siguiente ${t.oracionesRepetidasSeguidas} (informativo) · dato de Harvard: ${t.harvard.conversacionesConElDato} conversaciones, a lo más ${t.harvard.maxPorConversacion} vez por conversación (se espera ≤1)`);
  o.push(`Cierre exacto del documento comercial en la 1.ª explicación de rubro: ${fr(t.cierreExacto)} conversaciones (se espera todas)`);
  o.push(`Tono sobre ${t.tono.mensajes} mensajes al cliente: voseo ${t.tono.voseo} · trato de usted ${t.tono.usted} · sin ningún emoji ${t.tono.sinEmoji}`);
  if (t.avisosDeConfiguracion) o.push(`FALLO DE CONFIGURACIÓN: ${t.avisosDeConfiguracion} turno(s) con \`rubro_sin_guion\` (un rubro de la consola sin entrada en el guion se atendió como «Otro»).`);
  if (t.sinModelo.length) o.push(`ATENCIÓN: turnos donde se esperaba el modelo y el flujo no lo llamó: ${t.sinModelo.join(', ')}`);
  if (t.filasPorCorrida > 1.0001) o.push(`ATENCIÓN: la planilla quedó con ${redondear(t.filasPorCorrida, 2)} filas por corrida en promedio (debería ser una por teléfono).`);
  if (t.formulasEnLaPlanilla) o.push(`ATENCIÓN: ${t.formulasEnLaPlanilla} celda(s) de la planilla quedaron como fórmula (USER_ENTERED).`);
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
    o.push(`Uso del modelo: ${t.llamadas} llamadas (${t.reintentos} reintentos) · entrada ${u.entrada} tokens (${Math.round(u.entrada / por)} por llamada; cacheados ${u.cacheados}) · salida ${u.salida} (${Math.round(u.salida / por)} por llamada; razonamiento ${u.razonamiento})`);
    o.push(`Latencia por llamada: media ${u.latenciaMediaMs} ms · p50 ${u.latenciaP50Ms} ms · p95 ${u.latenciaP95Ms} ms · máx ${u.latenciaMaxMs} ms`);
    o.push(`Costo estimado: ${fmtUsd(u.costoUsd)} en total${t.llamadas ? ` (${fmtUsd(u.costoUsd === null ? null : u.costoUsd / t.llamadas)} por llamada)` : ''}`);
    o.push(`Supuesto de la tarifa: ${r.costo.supuesto}`);
  }
  return o.join('\n');
}

// ------------------------------------------------------------------------------------------------------- principal
const AYUDA = `Batería de «Captación mínima v0» contra el modelo.
  node Flujos/experimental/captacion-minima/herramientas/bateria.mjs [--seco] [--n 1..20] [--casos C1,C3] [--env archivo | --vertex proyecto [--locacion región]] [--json]
  --seco: modelo simulado, sin clave ni red · --env: archivo con la clave (por defecto .env.novuchat) · --vertex: token de gcloud · --json: salida de máquina`;

/**
 * Corre la bateria. `deps` (solo para pruebas): { salida, error, fetch, leerArchivo, gcloudToken }. Devuelve el codigo de salida:
 * 0 = corrio; 2 = uso o configuracion invalida (sin red ni traza); 1 = fallo inesperado.
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
    opciones = leerArgumentos(argv);
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
    const lib = cargarLibreria(flujo);
    const nodoModelo = flujo.nodes.find((n) => n.name === 'Llamar al modelo');
    const modelo = /\/models\/([A-Za-z0-9._-]+):generateContent$/.exec(String(nodoModelo?.parameters?.url ?? ''))?.[1];
    if (!modelo) throw new Error('«Llamar al modelo» no tiene una URL de generateContent.');
    const proveedor = opciones.seco ? 'ninguno (seco)' : opciones.vertex ? `Vertex AI (${opciones.vertex}, ${opciones.locacion})` : 'AI Studio';

    const corridas = [];
    for (const caso of elegidos) {
      for (let rep = 1; rep <= opciones.n; rep++) {
        if (!opciones.seco) d.error(`… ${caso.id} corrida ${rep}/${opciones.n}\n`);
        corridas.push(await correrCaso({ caso, rep, flujo, lib, opciones, credencial, deps: d }));
      }
    }
    const r = informe({ opciones, casos: elegidos, corridas, modelo, proveedor });
    d.salida(opciones.json ? JSON.stringify(r) + '\n' : textoDelInforme(r) + '\n');
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
