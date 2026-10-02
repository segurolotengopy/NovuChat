/**
 * =============================================================================
 * EL n8n DE MENTIRA — UN MOTOR DE PRUEBAS GENÉRICO PARA LOS FLUJOS VERSIONADOS
 * =============================================================================
 *
 * QUÉ ES. Recorre el grafo (`connections`) de un flujo de n8n, nodo por nodo,
 * como lo haría n8n con `executionOrder: v1`, y corre de verdad el código y la
 * lógica que el flujo lleva adentro. Lo que no se puede correr sin red (HTTP,
 * WhatsApp, Gemini, Calendar…) responde con un DOBLE que la prueba declara por
 * NOMBRE DE NODO. Nació de generalizar el «mundo» que Agenda mínima trae dentro
 * de `agenda-minima-flujo.test.ts` (que no se toca) para que el flujo «Venta
 * mínima v0» y los que vengan no copien la duodécima variante.
 *
 * QUÉ CORRE NATIVAMENTE
 *   - `code` (JavaScript, «run once for all items»), con `ejecutar` de `./flujo`:
 *     el mismo evaluador que bloquea los globales que el sandbox de n8n no tiene.
 *     Este archivo NO crea ningún `new Function`.
 *   - `if` v2.2: boolean `true`/`false`/`equals`/`notEquals`; string `equals`,
 *     `notEquals`, `contains`, `startsWith`, `endsWith` (y sus negadas), `regex`,
 *     `notRegex`, `empty`, `notEmpty`, `exists`, `notExists`; number `equals`,
 *     `notEquals`, `gt`, `gte`, `lt`, `lte`. Respeta `typeValidation` (con
 *     `strict`, un tipo equivocado revienta como en n8n) y `caseSensitive`.
 *   - `set` v3.4 (modo manual, con `includeOtherFields` y nombres con puntos).
 *   - `respondToWebhook`: registra la respuesta (código y cuerpo) y deja pasar.
 *   - `removeDuplicates` v2: «visto en ejecuciones anteriores» (con
 *     `dedupeValue`; la memoria vive en el mundo y SOBREVIVE entre turnos) y
 *     «duplicados dentro de la entrada».
 *   - `noOp`.
 *   Todo lo demás es un nodo de red: necesita un doble. Sin doble, el mundo
 *   lanza `SinDoble` con el nombre del nodo (es un descuido de la prueba, no un
 *   error del flujo, y `onError` no lo esconde). Un doble tiene prioridad sobre
 *   el tipo del nodo: también sirve para reemplazar un Code o un Set.
 *
 * EXPRESIONES. Cada `={{ … }}` se evalúa con `$json`, `$('Nodo')` (`first`,
 * `all`, `item`, `isExecuted`), `$input`, `$getWorkflowStaticData`, `$workflow`
 * y `$execution`, y con el reloj congelado. El cierre `}}` se busca probando
 * candidatos hasta que lo de adentro compila, así que las llaves y las
 * comillas anidadas (`JSON.stringify({ a: { b: '}}' } })`) no lo confunden.
 * `$('Nodo').item` va emparejado: el ítem actual sabe de qué ítem de cada
 * ancestro viene.
 *
 * DOBLES. `dobles[nombreDelNodo]` es un valor (objeto = un ítem, arreglo = varios)
 * o una función `(llamada) => objeto | arreglo`. Se invoca UNA VEZ POR ÍTEM de
 * entrada, con los `parameters` ya evaluados y, si hay `jsonBody`, su JSON ya
 * parseado en `llamada.cuerpo`. Si lanza, el nodo falla como falla un HTTP. El
 * mundo expone `dobles`, así que una prueba puede cambiarlos entre turnos.
 *
 * ROLES. Para no obligar a cada suite a filtrar nodos por nombre, algunos nodos
 * de red se agrupan por rol y el resultado del turno los junta:
 *   mensajes → los envíos al cliente (`Enviar a WhatsApp`, `Enviar respaldo`)
 *   avisos   → los avisos al negocio (`Enviar aviso`, `Aviso de respaldo`)
 *   ingesta  → `Reportar mensaje (entrante)`, `Reportar mensaje (saliente)`
 *   cierre   → `Registrar cierre`
 *   cotejo   → `Cotejar en el servidor`
 *   extraer  → `Extraer`
 *   resumen  → `Resumen del turno` (un Code: su primer ítem de salida)
 * Los nombres por omisión son los del §4.4 del diseño de Venta mínima y se
 * sobrescriben con la opción `roles`. En `mensajes` y `avisos`, el nodo que no
 * es el primero de la lista cuenta como `respaldo`.
 *
 * ERRORES. Un error de nodo (un Code que lanza, una expresión que revienta, un
 * doble que lanza, un IF estricto con el tipo equivocado) sigue `onError`:
 * `continueRegularOutput` (o `continueOnFail: true`) emite `{ error }` por la
 * salida 0; `continueErrorOutput` lo emite por la salida 1; sin `onError`, el
 * turno lanza `FalloDeNodo` (o, con `tolerarFallo: true`, queda en
 * `resultado.fallo` y el turno termina ahí, con lo que alcanzó a pasar).
 *
 * REPRODUCIBILIDAD. El reloj está congelado: el primer turno corre EXACTAMENTE
 * a `ahoraMs` y cada turno siguiente avanza `avanzarMin` (1 por omisión) antes de
 * correr. `$getWorkflowStaticData('global')` es `mundo.sd` y persiste entre
 * turnos; el de `'node'` es uno por nodo (`mundo.sdNodos`).
 *
 * LIMITACIONES (declaradas; el arnés falla fuerte antes que fingir)
 *   - No soporta Code en modo `runOnceForEachItem` ni en Python.
 *   - No soporta Set en modo `raw`, ni los `fields` de las versiones < 3.3.
 *   - No soporta IF v1 ni condiciones de fecha, arreglo u objeto.
 *   - No simula `retryOnFail`, ni el `batching` del HTTP: cada ítem es una llamada.
 *   - `$('Nodo').all()` / `.first()` devuelven las salidas de TODAS las ramas de
 *     la última corrida de ese nodo; `.item` sin emparejamiento cae al único
 *     ítem que el nodo emitió, y si hay varios, lanza.
 *   - `$input` dentro de una expresión trae solo el ítem actual; no hay `$now`.
 *   - Un nodo con varias entradas corre una vez por cada llegada (sin esperar a
 *     las otras), como un nodo que no es Merge.
 *   - `removeDuplicates` recuerda por nombre de nodo, sin `scope` ni topes.
 *   - Orden de ramas: por `y` y luego `x`, sobre todas las salidas del nodo;
 *     cada rama termina entera antes de empezar la siguiente.
 */
import { ejecutar, type Flujo, type J, type Nodo, type Referencias } from './flujo';

// ----------------------------------------------------------------------------- tipos públicos

/** Lo que recibe un doble: una llamada de red, con todo evaluado. */
export interface LlamadaDoble {
  nodo: string;
  /** El `type` completo del nodo (`n8n-nodes-base.httpRequest`). */
  tipo: string;
  /** Los `parameters` del nodo con todas sus expresiones ya evaluadas. */
  parametros: J;
  /** El JSON del cuerpo (`jsonBody` parseado, o los pares de `bodyParameters`); `undefined` si no hay. */
  cuerpo: J | undefined;
  url: string;
  metodo: string;
  /** Las cabeceras declaradas en `headerParameters`, como objeto. */
  encabezados: Record<string, string>;
  /** El `json` del ítem de entrada (una copia). */
  item: J;
  /** Cuántas veces se llamó a este nodo en el mundo (la primera es 1). */
  n: number;
}
export type RespuestaDoble = J | J[];
export type Doble = RespuestaDoble | ((llamada: LlamadaDoble) => RespuestaDoble);

export type Rol = 'mensajes' | 'avisos' | 'ingesta' | 'cierre' | 'cotejo' | 'extraer' | 'resumen';
export type RolesDelMundo = Partial<Record<Rol, string | string[]>>;

/** Los nombres de nodo por rol, los del §4.4 del diseño de Venta mínima. */
export const ROLES_POR_OMISION: Record<Rol, string[]> = {
  mensajes: ['Enviar a WhatsApp', 'Enviar respaldo'],
  avisos: ['Enviar aviso', 'Aviso de respaldo'],
  ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)'],
  cierre: ['Registrar cierre'],
  cotejo: ['Cotejar en el servidor'],
  extraer: ['Extraer'],
  resumen: ['Resumen del turno'],
};

export interface OpcionesMundo {
  flujo: Flujo;
  dobles?: Record<string, Doble>;
  /** El instante (ms) en que corre el primer turno. */
  ahoraMs: number;
  /** Cambios a las asignaciones del Set `Config base` antes de armar el mundo (agrega las que falten). */
  configBase?: Record<string, unknown>;
  /** Nodos desactivados: dejan pasar su entrada por la salida 0, como en n8n. */
  desactivados?: string[];
  roles?: RolesDelMundo;
  /** Tope de nodos visitados por turno (defensa contra ciclos). 1.000 por omisión. */
  maxVisitas?: number;
}

export interface OpcionesTurno {
  /** El nodo de entrada (disparador). Por omisión, la única raíz del grafo, o la que tenga un nombre conocido. */
  via?: string;
  /** Minutos que avanza el reloj ANTES de correr este turno: 0 en el primero y 1 en los demás por omisión. */
  avanzarMin?: number;
  /** Con `true`, un error de nodo queda en `resultado.fallo` en vez de lanzarse. */
  tolerarFallo?: boolean;
}

/** Un envío (mensaje al cliente o aviso al negocio) tal cual salió por el nodo de red. */
export interface Enviado {
  nodo: string;
  /** El destinatario (`payload.to`). */
  a: string;
  /** `payload.type`: text, interactive, template, image… */
  tipo: string;
  payload: J;
  /** El texto visible (ver `textoDeEnvio`). */
  cuerpo: string;
  /** `true` si salió por el nodo de respaldo del rol. */
  respaldo: boolean;
  /** `false` si el doble lanzó o contestó con `error`. */
  ok: boolean;
  respuesta: J;
}

export interface RegistroDeLlamada {
  rol: Rol | null;
  nodo: string;
  cuerpo: J | undefined;
  respuesta: J;
  ok: boolean;
}

export interface RespuestaWebhook {
  nodo: string;
  codigo: number;
  respondWith: string;
  cuerpo: unknown;
}

export interface Llamadas { ingesta: J[]; cierre: J[]; cotejo: J[]; extraer: J[] }

export interface ResultadoTurno {
  mensajes: Enviado[];
  avisos: Enviado[];
  /** Los cuerpos (JSON) enviados a cada servicio en este turno. */
  llamadas: Llamadas;
  /** El primer ítem de salida del nodo con rol `resumen`, o `null`. */
  resumen: J | null;
  respuestasWebhook: RespuestaWebhook[];
  /** Los nodos en el orden en que corrieron (con repetidos). */
  orden: string[];
  ejecutados: Set<string>;
  /** Por nodo, los ítems de cada salida (las corridas de un mismo nodo se concatenan). */
  salidas: Record<string, J[][]>;
  /** Por nodo, todos sus ítems de salida (todas las salidas juntas). */
  porNodo: Record<string, J[]>;
  /** Cada llamada a un doble, en orden. */
  registro: RegistroDeLlamada[];
  fallo: { nodo: string; mensaje: string; causa: unknown } | null;
  mensajesA(tel: string): Enviado[];
  avisosA(tel: string): Enviado[];
}

export interface Mundo {
  turno(entrada: J, opciones?: OpcionesTurno): ResultadoTurno;
  /** Los datos estáticos globales del flujo (`$getWorkflowStaticData('global')`). */
  sd: J;
  /** Los datos estáticos por nodo (`$getWorkflowStaticData('node')`). */
  sdNodos: Record<string, J>;
  /** Los dobles vigentes: se pueden cambiar entre turnos. */
  dobles: Record<string, Doble>;
  /** La memoria de `removeDuplicates`, por nombre de nodo. */
  repetidos: Map<string, Set<string>>;
  /** Todo lo que se mandó a cada servicio desde que se creó el mundo. */
  llamadas: Llamadas;
  /** El instante (ms) del reloj congelado. */
  ahora(): number;
  /** Adelanta el reloj y devuelve el instante nuevo. */
  avanzar(minutos: number): number;
  /** Una copia del flujo con el que corre el mundo (con `configBase` aplicado). */
  flujo: Flujo;
}

/** Un nodo falló (y su `onError` no lo tolera). */
export class FalloDeNodo extends Error {
  readonly nodo: string;
  readonly causa: unknown;
  constructor(nodo: string, causa: unknown) {
    super(`falló el nodo «${nodo}»: ${mensajeDe(causa)}`);
    this.name = 'FalloDeNodo';
    this.nodo = nodo;
    this.causa = causa;
  }
}

/** Un nodo de red corrió sin doble. Es un descuido de la prueba: nunca se tolera. */
export class SinDoble extends Error {
  readonly nodo: string;
  constructor(nodo: string, tipo: string) {
    super(`el nodo de red «${nodo}» (${tipo}) no tiene doble: declara dobles['${nodo}'] en la prueba`);
    this.name = 'SinDoble';
    this.nodo = nodo;
  }
}

// ----------------------------------------------------------------------------- utilidades

function mensajeDe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as J)['message'] === 'string') return String((e as J)['message']);
  return String(e);
}

const objeto = (v: unknown): J => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const clonar = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const tipoCorto = (tipo: string): string => tipo.split('.').pop() ?? '';

/** El reloj congelado: `new Date()` y `Date.now()` dan siempre `ms`. */
function relojFijo(ms: number): unknown {
  return class extends Date {
    constructor(...a: unknown[]) { if (a.length === 0) super(ms); else super(...(a as [number])); }
    static override now(): number { return ms; }
  };
}

function ponerRuta(destino: J, ruta: string, valor: unknown): void {
  const partes = ruta.split('.');
  let cursor = destino;
  for (const p of partes.slice(0, -1)) {
    if (cursor[p] === null || typeof cursor[p] !== 'object') cursor[p] = {};
    cursor = cursor[p] as J;
  }
  cursor[partes[partes.length - 1] as string] = valor;
}

/** El texto visible de un payload de la Graph API. */
export function textoDeEnvio(payload: J): string {
  const tipo = payload['type'];
  if (tipo === 'text') return String(objeto(payload['text'])['body'] ?? '');
  if (tipo === 'interactive') return String(objeto(objeto(payload['interactive'])['body'])['text'] ?? '');
  if (tipo === 'template') {
    const comps = (objeto(payload['template'])['components'] as J[] | undefined) ?? [];
    return comps.flatMap((c) => (c['parameters'] as J[] | undefined) ?? []).map((x) => String(x['text'] ?? '')).join(' | ');
  }
  if (tipo === 'image') return String(objeto(payload['image'])['caption'] ?? '');
  if (tipo === 'document') return String(objeto(payload['document'])['caption'] ?? '');
  return JSON.stringify(payload);
}

const esSintaxis = (e: unknown): boolean => e instanceof SyntaxError || (e instanceof Error && e.name === 'SyntaxError');

/**
 * Evalúa el texto de una plantilla de n8n (lo que sigue al `=`): literal y `{{ … }}`.
 * El cierre de cada `{{` es el primer `}}` desde el cual lo de adentro compila.
 * Si todo el texto es una sola expresión, devuelve su valor sin convertirlo.
 */
function plantilla(texto: string, evaluarUna: (expresion: string) => unknown): unknown {
  const partes: { literal?: string; valor?: unknown; esExpresion: boolean }[] = [];
  let i = 0;
  for (;;) {
    const ini = texto.indexOf('{{', i);
    if (ini < 0) { partes.push({ literal: texto.slice(i), esExpresion: false }); break; }
    partes.push({ literal: texto.slice(i, ini), esExpresion: false });
    let desde = ini + 2;
    let primerError: unknown = null;
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
  if (expresiones.length === 1 && partes.every((p) => p.esExpresion || (p.literal ?? '').trim() === '')) return expresiones[0]?.valor;
  return partes.map((p) => {
    if (!p.esExpresion) return p.literal ?? '';
    const v = p.valor;
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }).join('');
}

// `$('Nodo').item` se reescribe a `$__item('Nodo')`, que sí conoce el emparejamiento.
const RE_ITEM = /\$\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)\s*\.item\b/g;

// ----------------------------------------------------------------------------- el mundo

interface Item { json: J; linaje: Record<string, J> }

const ROLES_DE_ENVIO: Rol[] = ['mensajes', 'avisos'];
const ROLES_DE_LLAMADA: Rol[] = ['ingesta', 'cierre', 'cotejo', 'extraer'];
const ENTRADAS_CONOCIDAS = ['WhatsApp Trigger', 'Entrada de prueba', 'Entrega del receptor'];

export function crearMundo(op: OpcionesMundo): Mundo {
  const flujo = clonar(op.flujo);
  const nodos = new Map<string, Nodo>(flujo.nodes.map((n) => [n.name, n]));
  const maxVisitas = op.maxVisitas ?? 1000;

  // La estructura del grafo se valida de entrada: una conexión rota no debe esperar a un turno.
  for (const [desde, salidas] of Object.entries(flujo.connections)) {
    if (!nodos.has(desde)) throw new Error(`connections parte de un nodo que no existe: «${desde}»`);
    for (const destinos of salidas['main'] ?? []) {
      for (const d of destinos ?? []) if (!nodos.has(d.node)) throw new Error(`«${desde}» conecta con un nodo que no existe: «${d.node}»`);
    }
  }

  if (op.configBase) {
    const set = nodos.get('Config base');
    if (!set || tipoCorto(set.type) !== 'set') throw new Error('configBase pide cambiar «Config base», que no existe o no es un Set');
    const lista = ((objeto(set.parameters['assignments'])['assignments']) as J[] | undefined) ?? [];
    for (const [nombre, valor] of Object.entries(op.configBase)) {
      const a = lista.find((x) => x['name'] === nombre);
      if (a) a['value'] = valor;
      else lista.push({ id: `cb_${nombre}`, name: nombre, type: typeof valor === 'number' ? 'number' : typeof valor === 'boolean' ? 'boolean' : 'string', value: valor });
    }
  }

  const desactivados = new Set<string>([
    ...(op.desactivados ?? []),
    ...flujo.nodes.filter((n) => (n as J)['disabled'] === true).map((n) => n.name),
  ]);
  const roles = Object.fromEntries((Object.keys(ROLES_POR_OMISION) as Rol[]).map((r) => {
    const dado = op.roles?.[r];
    return [r, dado === undefined ? ROLES_POR_OMISION[r] : Array.isArray(dado) ? dado : [dado]];
  })) as Record<Rol, string[]>;
  const rolDe = (nombre: string): Rol | null => (Object.keys(roles) as Rol[]).find((r) => roles[r].includes(nombre)) ?? null;

  const sd: J = {};
  const sdNodos: Record<string, J> = {};
  const dobles: Record<string, Doble> = { ...(op.dobles ?? {}) };
  const repetidos = new Map<string, Set<string>>();
  const llamadas: Llamadas = { ingesta: [], cierre: [], cotejo: [], extraer: [] };
  const contadorDeLlamadas: Record<string, number> = {};
  let ahoraMs = op.ahoraMs;
  let turnos = 0;

  // Estado del turno en curso (se reinicia en cada `turno`).
  let refs: Referencias = {};
  let turnoActual: ResultadoTurno | null = null;

  // --- las expresiones -------------------------------------------------------------------------
  const posicion = (nombre: string): [number, number] => nodos.get(nombre)?.position ?? [0, 0];

  function globalesDe(it: Item | null): J {
    return {
      $json: it?.json ?? {},
      Date: relojFijo(ahoraMs),
      $getWorkflowStaticData: (tipo?: string) => (tipo === 'node' ? (sdNodos['__expresion__'] ??= {}) : sd),
      $workflow: { name: flujo.name, active: true },
      $execution: { id: 'ejecucion-de-mentira', mode: 'production' },
      $env: {},
      $vars: {},
      $__item: (nombre: string) => {
        const par = it?.linaje[nombre];
        if (par !== undefined) return { json: par };
        const lista = refs[nombre];
        if (lista === undefined) throw new Error(`el nodo «${nombre}» no se ejecutó: no hay ítem emparejado`);
        const arreglo = Array.isArray(lista) ? lista : [lista];
        if (arreglo.length === 1) return { json: arreglo[0] as J };
        throw new Error(`sin ítem emparejado con «${nombre}» (emitió ${arreglo.length} ítems)`);
      },
    };
  }

  function evaluarUna(expresion: string, it: Item | null): unknown {
    const codigo = expresion.replace(RE_ITEM, '$__item($1$2$1)');
    return ejecutar(`return [{ json: { v: (${codigo}\n) } }];`, it ? [it.json] : [], refs, globalesDe(it))[0]?.['v'];
  }

  function evaluar(valor: unknown, it: Item | null): unknown {
    if (typeof valor === 'string') return valor.startsWith('=') ? plantilla(valor.slice(1), (e) => evaluarUna(e, it)) : valor;
    if (Array.isArray(valor)) return valor.map((v) => evaluar(v, it));
    if (valor !== null && typeof valor === 'object') return Object.fromEntries(Object.entries(valor as J).map(([k, v]) => [k, evaluar(v, it)]));
    return valor;
  }

  // --- errores ---------------------------------------------------------------------------------
  type ModoError = 'parar' | 'regular' | 'salida';
  const modoDeError = (n: Nodo): ModoError =>
    n.onError === 'continueRegularOutput' || (n as J)['continueOnFail'] === true ? 'regular' : n.onError === 'continueErrorOutput' ? 'salida' : 'parar';

  function sinTolerar(n: Nodo, e: unknown): ModoError {
    if (e instanceof SinDoble) throw e;
    const modo = modoDeError(n);
    if (modo === 'parar') throw e instanceof FalloDeNodo ? e : new FalloDeNodo(n.name, e);
    return modo;
  }

  const hijoDe = (n: Nodo, it: Item, json: J): Item => ({ json, linaje: { ...it.linaje, [n.name]: json } });

  /** Corre `fn` ítem por ítem; los errores siguen `onError`. */
  function porItem(n: Nodo, items: Item[], fn: (it: Item) => J[]): Item[][] {
    const bien: Item[] = [];
    const mal: Item[] = [];
    for (const it of items) {
      try {
        for (const json of fn(it)) bien.push(hijoDe(n, it, json));
      } catch (e) {
        const modo = sinTolerar(n, e);
        (modo === 'salida' ? mal : bien).push(hijoDe(n, it, { error: mensajeDe(e) }));
      }
    }
    return modoDeError(n) === 'salida' ? [bien, mal] : [bien];
  }

  /** Un error que afecta al nodo entero: sigue `onError` y emite un `{ error }` por ítem de entrada. */
  function fallaEntero(n: Nodo, items: Item[], e: unknown): Item[][] {
    const modo = sinTolerar(n, e);
    const errores = items.map((it) => hijoDe(n, it, { error: mensajeDe(e) }));
    return modo === 'salida' ? [[], errores] : [errores];
  }

  // --- los nodos nativos -----------------------------------------------------------------------
  function validarTipo(v: unknown, tipo: string, estricto: boolean): unknown {
    if (v === null || v === undefined) return v;
    if (tipo === 'string') {
      if (typeof v === 'string') return v;
      if (estricto || typeof v === 'object') throw new Error(`tipo equivocado: ${JSON.stringify(v)} no es un string`);
      return String(v);
    }
    if (tipo === 'number') {
      if (typeof v === 'number') return v;
      if (!estricto && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
      throw new Error(`tipo equivocado: ${JSON.stringify(v)} no es un number`);
    }
    if (tipo === 'boolean') {
      if (typeof v === 'boolean') return v;
      if (!estricto) {
        if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
        if (v === 0 || v === 1) return v === 1;
      }
      throw new Error(`tipo equivocado: ${JSON.stringify(v)} no es un boolean`);
    }
    throw new Error(`el arnés no soporta condiciones de tipo «${tipo}» (solo string, number y boolean)`);
  }

  function evaluarCondicion(cond: J, it: Item, estricto: boolean, sensible: boolean): boolean {
    const operador = objeto(cond['operator']);
    const tipo = String(operador['type']);
    const operacion = String(operador['operation']);
    const sola = operador['singleValue'] === true;
    const l = validarTipo(evaluar(cond['leftValue'], it), tipo, estricto);
    const r = sola ? undefined : validarTipo(evaluar(cond['rightValue'], it), tipo, estricto);
    const vacio = l === undefined || l === null || l === '';
    switch (operacion) {
      case 'exists': return l !== undefined && l !== null;
      case 'notExists': return l === undefined || l === null;
      case 'empty': return vacio;
      case 'notEmpty': return !vacio;
      default: break;
    }
    if (tipo === 'boolean') {
      if (operacion === 'true') return l === true;
      if (operacion === 'false') return l === false;
      if (operacion === 'equals') return l === r;
      if (operacion === 'notEquals') return l !== r;
    } else if (tipo === 'number') {
      const a = l as number; const b = r as number;
      if (operacion === 'equals') return a === b;
      if (operacion === 'notEquals') return a !== b;
      if (l === undefined || l === null || r === undefined || r === null) return false;
      if (operacion === 'gt') return a > b;
      if (operacion === 'gte') return a >= b;
      if (operacion === 'lt') return a < b;
      if (operacion === 'lte') return a <= b;
    } else if (tipo === 'string') {
      const norm = (x: unknown): string => (sensible ? String(x ?? '') : String(x ?? '').toLowerCase());
      const a = norm(l); const b = norm(r);
      switch (operacion) {
        case 'equals': return a === b;
        case 'notEquals': return a !== b;
        case 'contains': return a.includes(b);
        case 'notContains': return !a.includes(b);
        case 'startsWith': return a.startsWith(b);
        case 'notStartsWith': return !a.startsWith(b);
        case 'endsWith': return a.endsWith(b);
        case 'notEndsWith': return !a.endsWith(b);
        case 'regex':
        case 'notRegex': {
          const texto = String(r ?? '');
          const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(texto);
          const encaja = new RegExp(m ? (m[1] as string) : texto, m ? (m[2] as string) : '').test(String(l ?? ''));
          return operacion === 'regex' ? encaja : !encaja;
        }
        default: break;
      }
    }
    throw new Error(`el arnés no soporta la operación «${tipo}.${operacion}» del IF`);
  }

  function ejecutarIf(n: Nodo, items: Item[]): Item[][] {
    const p = n.parameters;
    const c = objeto(p['conditions']);
    if (!Array.isArray(c['conditions'])) throw new FalloDeNodo(n.name, 'IF sin `conditions` v2: el arnés solo soporta IF v2 o posterior');
    const estricto = (objeto(c['options'])['typeValidation'] ?? 'strict') === 'strict' && p['looseTypeValidation'] !== true;
    const sensible = objeto(c['options'])['caseSensitive'] !== false;
    const o = c['combinator'] === 'or';
    const si: Item[] = []; const no: Item[] = [];
    try {
      for (const it of items) {
        let resultado = !o;
        for (const cond of c['conditions'] as J[]) {
          const v = evaluarCondicion(cond, it, estricto, sensible);
          if (o && v) { resultado = true; break; }
          if (!o && !v) { resultado = false; break; }
        }
        (resultado ? si : no).push(hijoDe(n, it, it.json));
      }
    } catch (e) {
      return fallaEntero(n, items, e);
    }
    return [si, no];
  }

  function convertirTipo(v: unknown, tipo: string, nombre: string): unknown {
    if (v === undefined || v === null) return v;
    if (tipo === 'number') {
      const x = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(x) || (typeof v === 'string' && v.trim() === '')) throw new Error(`Set: «${nombre}» no es un número: ${JSON.stringify(v)}`);
      return x;
    }
    if (tipo === 'boolean') {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
      if (v === 0 || v === 1) return v === 1;
      throw new Error(`Set: «${nombre}» no es un boolean: ${JSON.stringify(v)}`);
    }
    if (tipo === 'object' || tipo === 'array') return typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
    if (tipo === 'string') return typeof v === 'object' ? JSON.stringify(v) : String(v);
    return v;
  }

  function ejecutarSet(n: Nodo, it: Item): J {
    const p = n.parameters;
    if ((p['mode'] ?? 'manual') !== 'manual') throw new Error('el arnés no soporta Set en modo «raw»');
    const asignaciones = objeto(p['assignments'])['assignments'];
    if (!Array.isArray(asignaciones)) throw new Error('el arnés solo soporta Set con `assignments` (v3.3 o posterior)');
    const salida: J = p['includeOtherFields'] === true ? clonar(it.json) : {};
    const puntos = objeto(p['options'])['dotNotation'] !== false;
    for (const a of asignaciones as J[]) {
      const nombre = String(a['name']);
      const valor = convertirTipo(evaluar(a['value'], it), String(a['type'] ?? 'string'), nombre);
      if (puntos && nombre.includes('.')) ponerRuta(salida, nombre, valor);
      else salida[nombre] = valor;
    }
    return salida;
  }

  function ejecutarCode(n: Nodo, items: Item[]): Item[][] {
    const p = n.parameters;
    if (p['mode'] === 'runOnceForEachItem') throw new FalloDeNodo(n.name, 'el arnés no soporta Code en modo runOnceForEachItem');
    if (p['language'] !== undefined && p['language'] !== 'javaScript') throw new FalloDeNodo(n.name, 'el arnés solo soporta Code en JavaScript');
    let salida: (J | undefined)[];
    try {
      salida = ejecutar(String(p['jsCode']), items.map((i) => clonar(i.json)), refs, {
        $getWorkflowStaticData: (tipo?: string) => (tipo === 'node' ? (sdNodos[n.name] ??= {}) : sd),
        Date: relojFijo(ahoraMs),
        $workflow: { name: flujo.name, active: true },
        $execution: { id: 'ejecucion-de-mentira', mode: 'production' },
      });
      if (salida.some((x) => x === null || typeof x !== 'object' || Array.isArray(x))) {
        throw new Error('el código no devolvió ítems con la forma { json: { … } }');
      }
    } catch (e) {
      return fallaEntero(n, items, e);
    }
    // n8n empareja 1 a 1 si hay el mismo número de ítems, y todos con el único de entrada si solo hay uno.
    return [(salida as J[]).map((json, i) => {
      const origen = items.length === salida.length ? items[i] : items.length === 1 ? items[0] : undefined;
      return origen ? hijoDe(n, origen, json) : { json, linaje: { [n.name]: json } };
    })];
  }

  function ejecutarRespuesta(n: Nodo, items: Item[]): Item[][] {
    const p = n.parameters;
    const primero = items[0] ?? null;
    try {
      const modo = String(p['respondWith'] ?? 'firstIncomingItem');
      const opciones = objeto(evaluar(p['options'], primero));
      let cuerpo: unknown;
      if (modo === 'noData') cuerpo = undefined;
      else if (modo === 'text') cuerpo = evaluar(p['responseBody'], primero);
      else if (modo === 'json') {
        const bruto = evaluar(p['responseBody'], primero);
        cuerpo = typeof bruto === 'string' ? (JSON.parse(bruto) as unknown) : bruto;
      } else if (modo === 'allIncomingItems') cuerpo = items.map((i) => clonar(i.json));
      else if (modo === 'firstIncomingItem') cuerpo = primero ? clonar(primero.json) : undefined;
      else throw new Error(`el arnés no soporta respondWith «${modo}»`);
      turnoActual?.respuestasWebhook.push({ nodo: n.name, codigo: Number(opciones['responseCode'] ?? 200), respondWith: modo, cuerpo });
    } catch (e) {
      return fallaEntero(n, items, e);
    }
    return [items.map((it) => hijoDe(n, it, it.json))];
  }

  function ejecutarRepetidos(n: Nodo, items: Item[]): Item[][] {
    const p = n.parameters;
    const operacion = String(p['operation'] ?? 'removeDuplicateInputItems');
    const pasan: Item[] = [];
    try {
      if (operacion === 'removeItemsSeenInPreviousExecutions') {
        const logica = p['logic'] ?? 'removeItemsWithAlreadySeenKeyValues';
        if (logica !== 'removeItemsWithAlreadySeenKeyValues') throw new Error(`el arnés no soporta removeDuplicates con logic «${String(logica)}»`);
        const memoria = repetidos.get(n.name) ?? new Set<string>();
        repetidos.set(n.name, memoria);
        for (const it of items) {
          const valor = evaluar(p['dedupeValue'], it);
          if (valor === undefined || valor === null || valor === '') {
            throw new Error('dedupeValue quedó vacío: con ese valor se descartarían todos los mensajes siguientes');
          }
          const clave = String(valor);
          if (memoria.has(clave)) continue;
          memoria.add(clave);
          pasan.push(hijoDe(n, it, it.json));
        }
      } else if (operacion === 'removeDuplicateInputItems') {
        const compara = String(p['compare'] ?? 'allFields');
        const campos = (texto: unknown): string[] => String(texto ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        const vistos = new Set<string>();
        for (const it of items) {
          let base: J = it.json;
          if (compara === 'selectedFields') base = Object.fromEntries(campos(p['fieldsToCompare']).map((c) => [c, it.json[c]]));
          else if (compara === 'allFieldsExcept') {
            const fuera = new Set(campos(p['fieldsToExclude']));
            base = Object.fromEntries(Object.entries(it.json).filter(([k]) => !fuera.has(k)));
          } else if (compara !== 'allFields') throw new Error(`el arnés no soporta compare «${compara}»`);
          const clave = JSON.stringify(Object.entries(base).sort(([a], [b]) => a.localeCompare(b)));
          if (vistos.has(clave)) continue;
          vistos.add(clave);
          pasan.push(hijoDe(n, it, it.json));
        }
      } else throw new Error(`el arnés no soporta removeDuplicates con operation «${operacion}»`);
    } catch (e) {
      return fallaEntero(n, items, e);
    }
    return [pasan];
  }

  // --- los dobles ------------------------------------------------------------------------------
  function cuerpoDeRed(p: J): J | undefined {
    if (p['sendBody'] === false) return undefined;
    const pares = objeto(p['bodyParameters'])['parameters'];
    if (p['specifyBody'] !== 'json' && Array.isArray(pares)) return Object.fromEntries((pares as J[]).map((x) => [String(x['name']), x['value']]));
    const jb = p['jsonBody'];
    if (jb === undefined || jb === null) return undefined;
    if (typeof jb === 'string') {
      if (jb.trim() === '') return undefined;
      try { return JSON.parse(jb) as J; } catch { throw new Error(`jsonBody no es JSON válido: ${jb.slice(0, 80)}`); }
    }
    return clonar(jb as J);
  }

  function correrDoble(n: Nodo, it: Item, doble: Doble): J[] {
    const parametros = evaluar(n.parameters, it) as J;
    const cuerpo = cuerpoDeRed(parametros);
    const pares = objeto(parametros['headerParameters'])['parameters'];
    const encabezados = Array.isArray(pares) ? Object.fromEntries((pares as J[]).map((x) => [String(x['name']), String(x['value'])])) : {};
    const llamada: LlamadaDoble = {
      nodo: n.name, tipo: n.type, parametros, cuerpo, url: String(parametros['url'] ?? ''), metodo: String(parametros['method'] ?? 'GET'),
      encabezados, item: clonar(it.json), n: (contadorDeLlamadas[n.name] = (contadorDeLlamadas[n.name] ?? 0) + 1),
    };
    let lista: J[];
    try {
      const r = typeof doble === 'function' ? doble(llamada) : doble;
      lista = (Array.isArray(r) ? r : [r === undefined ? {} : r]).map((x) => clonar(x));
    } catch (e) {
      anotar(n, llamada, { error: { message: mensajeDe(e) } }, false);
      throw e;
    }
    const respuesta = lista[0] ?? {};
    anotar(n, llamada, respuesta, !('error' in objeto(respuesta)));
    return lista;
  }

  function anotar(n: Nodo, llamada: LlamadaDoble, respuesta: J, ok: boolean): void {
    const t = turnoActual;
    if (!t) return;
    const rol = rolDe(n.name);
    t.registro.push({ rol, nodo: n.name, cuerpo: llamada.cuerpo, respuesta, ok });
    if (rol && ROLES_DE_ENVIO.includes(rol)) {
      const payload = llamada.cuerpo ?? {};
      const enviado: Enviado = {
        nodo: n.name, a: String(payload['to'] ?? ''), tipo: String(payload['type'] ?? ''), payload, cuerpo: textoDeEnvio(payload),
        respaldo: roles[rol].indexOf(n.name) > 0, ok, respuesta,
      };
      (rol === 'mensajes' ? t.mensajes : t.avisos).push(enviado);
    } else if (rol && ROLES_DE_LLAMADA.includes(rol)) {
      const cuerpo = llamada.cuerpo ?? {};
      t.llamadas[rol as keyof Llamadas].push(cuerpo);
      llamadas[rol as keyof Llamadas].push(cuerpo);
    }
  }

  // --- un nodo ---------------------------------------------------------------------------------
  function ejecutarNodo(n: Nodo, entradas: Item[]): Item[][] {
    const items = (n as J)['executeOnce'] === true ? entradas.slice(0, 1) : entradas;
    if (desactivados.has(n.name)) return [items.map((it) => hijoDe(n, it, it.json))];
    const doble = dobles[n.name];
    let salidas: Item[][];
    if (doble !== undefined) salidas = porItem(n, items, (it) => correrDoble(n, it, doble));
    else {
      switch (tipoCorto(n.type)) {
        case 'code': salidas = ejecutarCode(n, items); break;
        case 'if': salidas = ejecutarIf(n, items); break;
        case 'set': salidas = porItem(n, items, (it) => [ejecutarSet(n, it)]); break;
        case 'respondToWebhook': salidas = ejecutarRespuesta(n, items); break;
        case 'removeDuplicates': salidas = ejecutarRepetidos(n, items); break;
        case 'noOp': salidas = [items.map((it) => hijoDe(n, it, it.json))]; break;
        default: throw new SinDoble(n.name, n.type);
      }
    }
    const primera = salidas[0];
    if ((n as J)['alwaysOutputData'] === true && primera && primera.length === 0 && items[0]) primera.push(hijoDe(n, items[0], {}));
    return salidas;
  }

  // --- la entrada ------------------------------------------------------------------------------
  function detectarEntrada(): string {
    const reciben = new Set<string>();
    for (const salidas of Object.values(flujo.connections)) {
      for (const destinos of salidas['main'] ?? []) for (const d of destinos ?? []) reciben.add(d.node);
    }
    const raices = Object.entries(flujo.connections)
      .filter(([desde, s]) => !reciben.has(desde) && (s['main'] ?? []).some((d) => (d ?? []).length > 0))
      .map(([desde]) => desde);
    if (raices.length === 1) return raices[0] as string;
    const conocida = ENTRADAS_CONOCIDAS.find((c) => raices.includes(c));
    if (conocida) return conocida;
    throw new Error(`no se sabe cuál es la entrada del flujo (raíces: ${raices.join(', ') || 'ninguna'}): pasa { via } al turno`);
  }

  // --- un turno --------------------------------------------------------------------------------
  function turno(entrada: J, opciones: OpcionesTurno = {}): ResultadoTurno {
    ahoraMs += (opciones.avanzarMin ?? (turnos > 0 ? 1 : 0)) * 60_000;
    turnos++;
    const via = opciones.via ?? detectarEntrada();
    if (!nodos.has(via)) throw new Error(`la entrada «${via}» no existe en el flujo`);

    refs = {};
    const orden: string[] = [];
    const salidas: Record<string, J[][]> = {};
    const porNodo: Record<string, J[]> = {};
    const resultado: ResultadoTurno = {
      mensajes: [], avisos: [], llamadas: { ingesta: [], cierre: [], cotejo: [], extraer: [] }, resumen: null,
      respuestasWebhook: [], orden, ejecutados: new Set<string>(), salidas, porNodo, registro: [], fallo: null,
      mensajesA: (tel) => resultado.mensajes.filter((m) => m.a === tel),
      avisosA: (tel) => resultado.avisos.filter((m) => m.a === tel),
    };
    turnoActual = resultado;
    let visitas = 0;

    function visitar(nombre: string, items: Item[]): void {
      if (!items.length) return;
      if (++visitas > maxVisitas) throw new Error(`más de ${maxVisitas} nodos visitados en un turno (¿un ciclo en connections?), último: «${nombre}»`);
      const n = nodos.get(nombre) as Nodo;
      orden.push(nombre);
      resultado.ejecutados.add(nombre);
      const salida = nombre === via ? [items] : ejecutarNodo(n, items);
      refs[nombre] = salida.flat().map((i) => i.json);
      const previas = salidas[nombre] ?? [];
      salida.forEach((its, idx) => { previas[idx] = [...(previas[idx] ?? []), ...its.map((i) => i.json)]; });
      salidas[nombre] = previas;
      porNodo[nombre] = [...(porNodo[nombre] ?? []), ...salida.flat().map((i) => i.json)];
      if (roles.resumen.includes(nombre)) resultado.resumen = salida[0]?.[0]?.json ?? null;

      const conexiones = flujo.connections[nombre]?.['main'] ?? [];
      const destinos: { nodo: string; items: Item[]; orden: number }[] = [];
      salida.forEach((its, idx) => {
        for (const d of conexiones[idx] ?? []) destinos.push({ nodo: d.node, items: its, orden: destinos.length });
      });
      destinos.sort((a, b) => (posicion(a.nodo)[1] - posicion(b.nodo)[1]) || (posicion(a.nodo)[0] - posicion(b.nodo)[0]) || (a.orden - b.orden));
      for (const d of destinos) visitar(d.nodo, d.items);
    }

    try {
      const json = clonar(entrada);
      visitar(via, [{ json, linaje: { [via]: json } }]);
    } catch (e) {
      if (!(e instanceof FalloDeNodo) || !opciones.tolerarFallo) throw e;
      resultado.fallo = { nodo: e.nodo, mensaje: mensajeDe(e.causa), causa: e.causa };
    } finally {
      turnoActual = null;
    }
    return resultado;
  }

  return {
    turno, sd, sdNodos, dobles, repetidos, llamadas, flujo,
    ahora: () => ahoraMs,
    avanzar: (minutos: number) => (ahoraMs += minutos * 60_000),
  };
}
