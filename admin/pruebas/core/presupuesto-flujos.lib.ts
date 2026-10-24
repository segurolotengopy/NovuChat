/**
 * PRESUPUESTO DE TAMAÑO POR FLUJO (23/10/2026): medición y reglas, sin dependencias de vitest.
 * Lo usan la prueba `presupuesto-flujos.test.ts` y quien regenere la línea base
 * (`node --experimental-strip-types admin/pruebas/core/presupuesto-flujos.lib.ts` imprime las medidas de hoy).
 *
 * Solo sintaxis borrable (sin enums ni parameter properties) para que Node la pueda ejecutar directo.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Tope duro del prompt de un flujo, en KB (suma de los campos de prompt de sus nodos de IA). */
export const TOPE_PROMPT_KB = 6;
/** Una exención del tope vence a más tardar 90 días después de declararse. */
export const EXENCION_DIAS_MAX = 90;
/** Holgura del jsCode sobre el presupuesto, en proporción. Nodos y prompt: margen 0. */
export const HOLGURA_JSCODE = 0.02;

export type Medida = { nodos: number; jsCodeKB: number; promptKB: number; jsCodeChars: number; promptChars: number };
export type Exencion = { porque: string; desde: string; vence: string };
export type Entrada = { nodos: number; jsCodeKB: number; promptKB: number; porque: string; ultimoAumento: string; exencionPrompt?: Exencion };
export type Presupuesto = { flujos: Record<string, Entrada>; exentos: Record<string, { porque: string }> };

type Nodo = { name?: string; type?: string; parameters?: Record<string, unknown> };
type Flujo = { nodes: Nodo[] };

/** Redondeo hacia arriba a 1 decimal de caracteres/1024. */
export const aKB = (chars: number): number => Math.ceil((chars / 1024) * 10) / 10;

/** Campos que cuentan como PROMPT: toda cadena bajo una de estas claves, en los parameters de los nodos de IA (tipo con «langchain»). */
export const CLAVES_DE_PROMPT = ['text', 'message', 'systemMessage', 'prompt', 'content'];

export function esNodoDeIA(n: Nodo): boolean {
  return typeof n.type === 'string' && n.type.includes('langchain');
}

function cadenasDePrompt(valor: unknown, clave: string, salida: string[]): void {
  if (typeof valor === 'string') {
    if (CLAVES_DE_PROMPT.includes(clave)) salida.push(valor);
  } else if (Array.isArray(valor)) {
    for (const v of valor) cadenasDePrompt(v, clave, salida);
  } else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) cadenasDePrompt(v, k, salida);
  }
}

export const jsCodeDe = (n: Nodo): string => (typeof n.parameters?.jsCode === 'string' ? n.parameters.jsCode : '');

export function promptDe(n: Nodo): number {
  if (!esNodoDeIA(n)) return 0;
  const cs: string[] = [];
  cadenasDePrompt(n.parameters ?? {}, '', cs);
  return cs.reduce((a, s) => a + s.length, 0);
}

export function medir(flujo: Flujo): Medida {
  const jsCodeChars = flujo.nodes.reduce((a, n) => a + jsCodeDe(n).length, 0);
  const promptChars = flujo.nodes.reduce((a, n) => a + promptDe(n), 0);
  return { nodos: flujo.nodes.length, jsCodeKB: aKB(jsCodeChars), promptKB: aKB(promptChars), jsCodeChars, promptChars };
}

/** Los cinco nodos de jsCode más grandes. */
export function mayoresNodos(flujo: Flujo, k = 5): { nodo: string; kb: number }[] {
  return flujo.nodes
    .map((n) => ({ nodo: n.name ?? '?', chars: jsCodeDe(n).length }))
    .sort((a, b) => b.chars - a.chars)
    .slice(0, k)
    .map((x) => ({ nodo: x.nodo, kb: aKB(x.chars) }));
}

/** Descubre del disco los JSON de flujo: Flujos/*.json y Flujos/experimental/**; ignora herramientas, fuentes y todo JSON sin `nodes`. */
export function descubrirFlujos(raiz = RAIZ): string[] {
  const salida: string[] = [];
  const IGNORAR = new Set(['node_modules', 'herramientas', 'fuentes', 'manifiestos', 'src', 'prompts']);
  const recorrer = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const nombre = ent.name;
      const ruta = join(dir, nombre);
      if (ent.isDirectory()) {
        if (!IGNORAR.has(nombre)) recorrer(ruta);
      } else if (nombre.endsWith('.json')) {
        try {
          const j = JSON.parse(readFileSync(ruta, 'utf8'));
          if (Array.isArray(j?.nodes)) salida.push(relative(raiz, ruta).split('\\').join('/'));
        } catch {
          // un JSON que no se lee no es un flujo
        }
      }
    }
  };
  recorrer(join(raiz, 'Flujos'));
  return salida.sort();
}

export const leerFlujo = (ruta: string, raiz = RAIZ): Flujo => JSON.parse(readFileSync(join(raiz, ruta), 'utf8')) as Flujo;

const DIA = 86400000;
const dias = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DIA);
const esFecha = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Reglas del presupuesto para UN flujo: devuelve los problemas (vacío = en regla). Pura, para probarla negada. */
export function problemasDeUnFlujo(ruta: string, m: Medida, e: Entrada | undefined, hoy: string): string[] {
  if (!e) return [`${ruta}: sin entrada en presupuesto-flujos.json (ni exención declarada)`];
  const p: string[] = [];
  if (m.nodos > e.nodos) p.push(`${ruta}: ${m.nodos} nodos > presupuesto ${e.nodos} (margen 0)`);
  if (m.promptKB > e.promptKB) p.push(`${ruta}: prompt ${m.promptKB} KB > presupuesto ${e.promptKB} KB (margen 0)`);
  const tope = e.jsCodeKB * (1 + HOLGURA_JSCODE);
  if (m.jsCodeChars / 1024 > tope) p.push(`${ruta}: jsCode ${m.jsCodeKB} KB > presupuesto ${e.jsCodeKB} KB (+${HOLGURA_JSCODE * 100} % de holgura = ${tope.toFixed(1)} KB)`);
  if (!esFecha(e.ultimoAumento)) p.push(`${ruta}: ultimoAumento falta o no es AAAA-MM-DD`);
  else if (e.ultimoAumento > hoy) p.push(`${ruta}: ultimoAumento ${e.ultimoAumento} es posterior a hoy (${hoy})`);
  if (!e.porque || e.porque.trim().length < 10) p.push(`${ruta}: falta el «porque» del presupuesto`);
  if (m.promptKB > TOPE_PROMPT_KB) {
    const x = e.exencionPrompt;
    if (!x) p.push(`${ruta}: prompt ${m.promptKB} KB supera el tope duro de ${TOPE_PROMPT_KB} KB y no tiene exención declarada`);
    else if (!x.porque || x.porque.trim().length < 10 || !esFecha(x.desde) || !esFecha(x.vence)) p.push(`${ruta}: exención del tope de prompt incompleta (porque, desde, vence)`);
    else if (dias(x.desde, x.vence) > EXENCION_DIAS_MAX) p.push(`${ruta}: la exención del tope de prompt dura ${dias(x.desde, x.vence)} días (máximo ${EXENCION_DIAS_MAX})`);
    else if (x.vence < hoy) p.push(`${ruta}: la exención del tope de prompt venció el ${x.vence}`);
  }
  return p;
}

/** Fuentes de módulos comunes conocidas. */
export function fuentesDeModulos(raiz = RAIZ): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const nombre = ent.name;
      const ruta = join(dir, nombre);
      if (ent.isDirectory()) recorrer(ruta);
      else if (/\.(js|mjs)$/.test(nombre) && !nombre.endsWith('.d.mts')) salida.push(relative(raiz, ruta).split('\\').join('/'));
    }
  };
  recorrer(join(raiz, 'Flujos/src/core'));
  recorrer(join(raiz, 'Flujos/src/modulos'));
  recorrer(join(raiz, 'Flujos/experimental/comun-sin-agente/src'));
  return salida;
}

/** KB que cada módulo común aporta a un flujo, por coincidencia literal del archivo fuente (completo, o ≥80 % de sus líneas de 30+ caracteres) dentro del jsCode. Informativo. */
export function aporteDeModulos(flujo: Flujo, fuentes: string[], raiz = RAIZ): { modulo: string; kb: number }[] {
  const codigos = flujo.nodes.map(jsCodeDe).filter((c) => c);
  const salida: { modulo: string; kb: number }[] = [];
  for (const f of fuentes) {
    const src = readFileSync(join(raiz, f), 'utf8').trim();
    if (src.length < 200) continue;
    const completo = codigos.some((c) => c.includes(src));
    let esta = completo;
    if (!esta) {
      const lineas = src.split('\n').map((l) => l.trim()).filter((l) => l.length >= 30);
      if (lineas.length >= 5) esta = codigos.some((c) => lineas.filter((l) => c.includes(l)).length >= lineas.length * 0.8);
    }
    if (esta) salida.push({ modulo: f, kb: aKB(src.length) });
  }
  return salida.sort((a, b) => b.kb - a.kb);
}

/* -------------------------------------------------------------------------------------------------
 * CÓDIGO MUERTO INCLUIDO (informativo): funciones/constantes con prefijo de módulo común DEFINIDAS en el jsCode de un
 * nodo y nunca referenciadas en ese mismo nodo fuera de su definición. Cada nodo Code de n8n es una isla (no comparte
 * funciones con otro nodo), así que el análisis es por nodo. Es conservador: una referencia dentro de otra pieza que
 * también es muerta cuenta como uso, y una recursión sobre sí misma cuenta como uso.
 * ----------------------------------------------------------------------------------------------- */
export const PREFIJOS_COMUNES = ['ct', 'cb', 'dn', 'cm', 'av', 'anuncio'];
export type Muerto = { nodo: string; nombre: string; chars: number };

/** Largo de la definición que empieza en `ini` (recorre hasta cerrar el último ([{ y el `;` o salto de línea siguiente). Aproximado. */
function largoDeDefinicion(c: string, ini: number): number {
  let prof = 0;
  let i = ini;
  let visto = false;
  while (i < c.length) {
    const ch = c[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < c.length && c[i] !== q) i += c[i] === '\\' ? 2 : 1;
    } else if (ch === '/' && c[i + 1] === '/') {
      while (i < c.length && c[i] !== '\n') i++;
      continue;
    } else if (ch === '/' && c[i + 1] === '*') {
      i = c.indexOf('*/', i + 2);
      if (i < 0) return c.length - ini;
      i += 1;
    } else if ('([{'.includes(ch as string)) {
      prof++;
      visto = true;
    } else if (')]}'.includes(ch as string)) {
      prof--;
      if (prof === 0 && c.slice(ini, i).startsWith('function')) return i + 1 - ini;
    } else if (prof === 0 && ch === ';' && visto) return i + 1 - ini;
    i++;
    if (i - ini > 40000) break;
  }
  return Math.min(i, c.length) - ini;
}

const esIdent = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

/** Cuenta las apariciones de `nombre` como identificador completo (sin letra, dígito, _, $ ni punto antes, ni identificador después). Sin expresiones regulares dinámicas. */
function contarPalabra(c: string, nombre: string): number {
  let total = 0;
  for (let i = c.indexOf(nombre); i >= 0; i = c.indexOf(nombre, i + 1)) {
    const antes = c[i - 1];
    if (!esIdent(antes) && antes !== '.' && !esIdent(c[i + nombre.length])) total++;
  }
  return total;
}

export function codigoMuertoDe(flujo: Flujo): Muerto[] {
  const reDef = /(?:^|[\s;{}])((?:async\s+)?function\s+\*?\s*|(?:const|let|var)\s+)((?:ct|cb|dn|cm|av|anuncio)[A-Za-z0-9_$]*)\b/g;
  const salida: Muerto[] = [];
  for (const n of flujo.nodes) {
    const c = jsCodeDe(n);
    if (!c) continue;
    const defs = new Map<string, number[]>();
    for (const m of c.matchAll(reDef)) {
      const nombre = m[2] as string;
      const ini = (m.index ?? 0) + m[0].length - nombre.length - (m[1] as string).length;
      defs.set(nombre, [...(defs.get(nombre) ?? []), ini]);
    }
    for (const [nombre, inis] of defs) {
      const total = contarPalabra(c, nombre);
      if (total <= inis.length) salida.push({ nodo: n.name ?? '?', nombre, chars: inis.reduce((a, i) => a + largoDeDefinicion(c, i), 0) });
    }
  }
  return salida.sort((a, b) => b.chars - a.chars);
}

// Ejecutado directo: imprime la línea base de hoy (nodos / jsCode KB / prompt KB) de cada flujo descubierto.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const r of descubrirFlujos()) {
    const m = medir(leerFlujo(r));
    console.log(JSON.stringify({ ruta: r, nodos: m.nodos, jsCodeKB: m.jsCodeKB, promptKB: m.promptKB }));
  }
}
