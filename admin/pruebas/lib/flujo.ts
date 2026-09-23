/**
 * =============================================================================
 * AYUDANTE COMPARTIDO PARA PROBAR LOS FLUJOS DE n8n — LEER, ENCONTRAR, CORRER
 * =============================================================================
 *
 * POR QUÉ EXISTE. Diez suites de esta carpeta ejecutan el código que corre de
 * verdad en n8n: lo sacan del JSON versionado de `Flujos/` y lo corren con
 * `$input` y `$('Nombre')` simulados. Hasta el 20/09/2026 cada suite traía su
 * propio lector, su propio `nodo()` y su propio `new Function`, con pequeñas
 * variaciones entre sí (unas dan `first()` y otras también `all()`, unas
 * mapean a `.json` y otras no). Este archivo reúne esas piezas en un solo
 * lugar, con la forma MÁS AMPLIA de cada una, para que una suite nueva no
 * copie la undécima variante.
 *
 * QUÉ NO CAMBIA. Las suites que ya existen siguen leyendo el JSON de `Flujos/`,
 * que es lo que se importa a n8n. Desde el bloque B-1 de la modularización el
 * código de los nodos vive además en `Flujos/src/`, y `ensamblador.test.ts`
 * prueba que el JSON y los módulos son idénticos byte a byte; por eso da lo
 * mismo leer uno u otro, y leer el JSON sigue probando «lo que corre».
 *
 * SOBRE `new Function`. Es una EXCEPCIÓN DELIBERADA a `devsecops.js-eval-prohibido`,
 * acotada a este archivo y a las suites. Lo que se ejecuta es un archivo NUESTRO
 * y versionado, dentro de una prueba que no corre en ningún servidor. La
 * alternativa —copiar la lógica del nodo al archivo de pruebas— dejaría la
 * prueba en verde para siempre mientras el flujo se rompe en silencio. No
 * desaparece con los módulos: el cuerpo de un nodo Code de n8n tiene `return`
 * al nivel superior y recibe `$input`, `$` y `$getWorkflowStaticData` como
 * globales inyectadas, así que no es un módulo ES importable. Envolverlo en una
 * función cambiaría el texto que se inyecta al JSON, y romper la identidad byte
 * a byte por evitar una llamada dinámica en una prueba es un mal negocio.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = Record<string, any>;

export interface Nodo {
  id?: string; name: string; type: string; typeVersion?: number; position?: [number, number];
  parameters: J; credentials?: Record<string, { id: string; name: string }>;
  onError?: string; retryOnFail?: boolean; maxTries?: number; notes?: string;
  /**
   * La ruta que n8n le da a un disparador con webhook. Se declara para poder
   * probar que está AUSENTE: desde que el Demo B tiene dos disparadores, el del
   * carrito lleva `path` propio y `preparar-import.sh` le escribe el `webhookId`
   * de Meta solo a los que no tienen ruta propia. Si los dos lo tuvieran,
   * compartirían URL y el carrito le pisaría el webhook a WhatsApp.
   */
  webhookId?: string;
}
export interface Flujo {
  name: string; settings?: J; nodes: Nodo[];
  connections: Record<string, Record<string, { node: string; type: string; index: number }[][]>>;
}

/** La carpeta `Flujos/` del repositorio, resuelta desde acá y no desde el cwd. */
export const CARPETA_FLUJOS = join(aqui, '../../../Flujos');

export const rutaDeFlujo = (archivo: string): string => join(CARPETA_FLUJOS, archivo);

/** El texto exacto del JSON versionado (para comparar byte a byte). */
export const textoDeFlujo = (archivo: string): string => readFileSync(rutaDeFlujo(archivo), 'utf8');

/** El JSON versionado de `Flujos/<archivo>`, ya parseado. */
export const leerFlujo = (archivo: string): Flujo => JSON.parse(textoDeFlujo(archivo)) as Flujo;

/** El nodo con ese nombre; si no existe, falla con el mismo mensaje que usaban las suites. */
export function nodo(f: Flujo, nombre: string): Nodo {
  const n = f.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
}

/** El `jsCode` de un nodo Code, como texto. Falla si el nodo no es de código. */
export function codigoDe(f: Flujo, nombre: string): string {
  const js = nodo(f, nombre).parameters['jsCode'];
  if (typeof js !== 'string') throw new Error(`el nodo ${nombre} no tiene jsCode`);
  return js;
}

/** Los valores de respaldo del nodo Set (`Config base` por defecto), como objeto. */
export function configBase(f: Flujo, nombreNodo = 'Config base'): J {
  const set = nodo(f, nombreNodo).parameters as { assignments: { assignments: { name: string; value: unknown }[] } };
  return Object.fromEntries(set.assignments.assignments.map((a) => [a.name, a.value]));
}

/** A qué nodos va la salida `salida` de `desde`, en el orden del lienzo. */
export const destinos = (f: Flujo, desde: string, salida = 0): string[] =>
  (f.connections[desde]?.['main']?.[salida] ?? []).map((x) => x.node);

/** Quién entra a `hacia`, por cualquier salida `main`. */
export const entradas = (f: Flujo, hacia: string): string[] =>
  Object.entries(f.connections)
    .filter(([, salidas]) => (salidas['main'] ?? []).some((s) => s.some((x) => x.node === hacia)))
    .map(([desde]) => desde);

/**
 * Lo que `$('Nombre')` devuelve en una prueba: un item (se usa como `first()`)
 * o la lista completa (`all()` la entrega tal cual; `first()` toma el primero).
 */
export type Referencias = Record<string, J | J[]>;

const items = (r: J | J[] | undefined): J[] => (r === undefined ? [] : Array.isArray(r) ? r : [r]);

/**
 * Corre el cuerpo de un nodo Code como lo correría n8n: `$input.all()` y
 * `$input.first()` son `items`; `$('Nombre')` devuelve `referencias['Nombre']`
 * con `first()`, `all()`, `item` e `isExecuted`. `globales` inyecta otros
 * nombres que el nodo use (`$getWorkflowStaticData`, un `Date` con reloj
 * congelado). Devuelve los items tal cual los emite el nodo (`{ json }`).
 */
export function correr(
  codigo: string, entradas_: J[], referencias: Referencias = {}, globales: Record<string, unknown> = {},
): { json: J }[] {
  const entrada = {
    all: () => entradas_.map((json) => ({ json })),
    first: () => ({ json: entradas_[0] }),
    item: { json: entradas_[0] },
  };
  const $ = (n: string) => {
    const lista = items(referencias[n]);
    return {
      first: () => ({ json: lista[0] ?? {} }),
      all: () => lista.map((json) => ({ json })),
      item: { json: lista[0] ?? {} },
      isExecuted: n in referencias,
    };
  };
  const nombres = Object.keys(globales);
  // Se ejecuta el flujo VERSIONADO; ver la cabecera de este archivo.
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', ...nombres, codigo) as (...a: unknown[]) => { json: J }[];
  return fn(entrada, $, ...nombres.map((n) => globales[n]));
}

/** Como `correr`, pero devuelve solo los `.json` de cada item. */
export const ejecutar = (
  codigo: string, entradas_: J[], referencias: Referencias = {}, globales: Record<string, unknown> = {},
): J[] => correr(codigo, entradas_, referencias, globales).map((x) => x.json);

/** Evalúa una expresión simple `={{ … }}` con `$json`, `$('Nombre')` y `$fromAI`. */
export function expresion(texto: unknown, $json: J, referencias: Referencias = {}, deLaIA: J = {}): unknown {
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(String(texto).trim());
  if (!m) throw new Error(`no es una expresión simple: ${String(texto).slice(0, 60)}`);
  const $ = (n: string) => ({ first: () => ({ json: items(referencias[n])[0] ?? {} }), item: { json: items(referencias[n])[0] ?? {} } });
  const $fromAI = (clave: string) => deLaIA[clave] ?? '';
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$json', '$', '$fromAI', `return (${m[1]});`) as (...a: unknown[]) => unknown;
  return fn($json, $, $fromAI);
}

/** Renderiza una plantilla de n8n (`=texto {{ expresión }} texto`) con `$json` y `$('Nombre')`. */
export function plantilla(texto: unknown, $json: J, referencias: Referencias = {}): string {
  const t = String(texto);
  if (!t.startsWith('=')) throw new Error('no es una plantilla de n8n');
  const $ = (n: string) => ({ first: () => ({ json: items(referencias[n])[0] ?? {} }), item: { json: items(referencias[n])[0] ?? {} } });
  return t.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) => {
    // nosemgrep: devsecops.js-eval-prohibido
    const v = (new Function('$json', '$', `return (${expr});`) as (j: unknown, r: unknown) => unknown)($json, $);
    return v === undefined || v === null ? '' : String(v);
  });
}
