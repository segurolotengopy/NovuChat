/**
 * COMPROBACIONES ESTÁTICAS DE LA MIGRACIÓN (etapa 0, 12/11/2026): las piezas puras que comparten las pruebas comunes de
 * invariantes (`nucleo-comun`, `niega-ia`, `error-workflow-por-nombre`, `ux-derivacion`, `capacidades-comunes`, `flujos-origen`) y
 * `migrado.test.ts`. Viven en un módulo y no dentro de un `*.test.ts` porque importar un archivo de pruebas desde otro vuelve a
 * ejecutar sus `describe`. No leen la red ni el emulador; solo `Flujos/`.
 *
 * Los nombres de cliente no aparecen aquí: los flujos entran por su ruta, como dato.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Flujo } from '../../lib/flujo';
import { CARPETA_FLUJOS_DEL_REPO } from '../../lib/flujos-de-cliente';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ_REPO = join(aqui, '../../../..');
export const SRC_CORE = join(CARPETA_FLUJOS_DEL_REPO, 'src', 'core');

// ---------------------------------------------------------------------------
// Identidad de un flujo: no depende de si vive en experimental/ o en clientes/
// ---------------------------------------------------------------------------

/**
 * La identidad de un flujo sin su carpeta de nivel superior: `experimental/x/x.json` y `clientes/x/x.json` son el mismo flujo
 * (una mudanza no cambia qué flujo es). Así una excepción o una fila del tablero sobrevive a `git mv`.
 */
export const idDeFlujo = (ruta: string): string => ruta.replace(/^(experimental|clientes)\//, '');

// ---------------------------------------------------------------------------
// M4: los nodos comunes incluyen una variante declarada de core
// ---------------------------------------------------------------------------

/** Los siete nodos comunes (los cinco del núcleo más los dos de la capa común experimental). */
export const NODOS_COMUNES = [
  'Normalizar entrada', 'Config del negocio', 'Procesar respuesta', 'Uso extendido', 'Comercio no operativo', 'Carga de entrada', 'Puerta del turno',
] as const;

const ARCHIVO_DE_NODO: Record<string, string> = {
  'Normalizar entrada': 'normalizar-entrada', 'Config del negocio': 'config-del-negocio', 'Procesar respuesta': 'procesar-respuesta',
  'Uso extendido': 'uso-extendido', 'Comercio no operativo': 'comercio-no-operativo',
};

/** Las variantes de los dos nodos de la capa común de los flujos sin agente: un solo archivo cada uno (`core/sin-agente/turno/`, etapa 1 PR 2). */
const ARCHIVO_DE_TURNO: Record<string, string> = {
  'Carga de entrada': 'sin-agente/turno/carga-de-entrada.js', 'Puerta del turno': 'sin-agente/turno/puerta-del-turno.js',
};

/**
 * Las variantes declaradas (lista cerrada de `VARIANTES.md`) de un nodo común, leídas de `Flujos/src/core`. «Carga de entrada» y «Puerta del
 * turno» tienen UNA cada una (`sin-agente/turno/`): el flujo que lleva otra versión es una excepción de M4 hasta que se unifique.
 */
export function variantesDeNodo(nodo: string, srcCore: string = SRC_CORE): string[] {
  const turno = ARCHIVO_DE_TURNO[nodo];
  if (turno) return [join(srcCore, turno)].filter((r) => existsSync(r)).map((r) => readFileSync(r, 'utf8'));
  const base = ARCHIVO_DE_NODO[nodo];
  if (!base) return [];
  return [`${base}.js`, `venta/${base}.js`, `captacion/${base}.js`]
    .map((r) => join(srcCore, r)).filter((r) => existsSync(r)).map((r) => readFileSync(r, 'utf8'));
}

/**
 * El `jsCode` incluye una variante: es igual a ella (con o sin el `\n` final) o TERMINA en ella (los constructores anteponen librerías
 * y `_comun.js`). Un byte alterado en el sufijo no cuenta.
 */
export function incluyeVariante(jsCode: string, variantes: string[]): boolean {
  return variantes.some((v) => {
    const sin = v.replace(/\n$/, '');
    if (sin.length === 0) return false;
    if (jsCode === v || jsCode === sin) return true;
    const sufijo = jsCode.endsWith(v) ? v : jsCode.endsWith(sin) ? sin : null;
    if (sufijo === null) return false;
    // Un `return` de nivel superior (en columna 0) en el prefijo deja la variante como código muerto: no cuenta como incluida.
    // Limitación declarada: no detecta un `return` indentado dentro de un bloque que se ejecute siempre, ni un `throw` previo.
    return !/^return\b/m.test(jsCode.slice(0, jsCode.length - sufijo.length));
  });
}

/** Los nodos comunes del flujo (presentes) que NO incluyen una variante declarada. Un nodo ausente no es un hallazgo. */
export function hallazgosM4(f: Flujo, srcCore: string = SRC_CORE): string[] {
  const salida: string[] = [];
  for (const nombre of NODOS_COMUNES) {
    const n = f.nodes.find((x) => x.name === nombre);
    if (!n) continue;
    if (!incluyeVariante(String(n.parameters?.['jsCode'] ?? ''), variantesDeNodo(nombre, srcCore))) salida.push(nombre);
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Qué flujos atienden a un cliente final
// ---------------------------------------------------------------------------

/** Atiende a un cliente final: reporta el mensaje entrante a la ingesta (el mismo criterio que usa el guardado de medios). */
export const atiendeCliente = (f: Flujo): boolean => f.nodes.some((n) => n.name === 'Reportar mensaje (entrante)');

// ---------------------------------------------------------------------------
// M5: NIEGA_IA viene de una fuente declarada
// ---------------------------------------------------------------------------

const LITERAL_NIEGA_IA = /\bNIEGA_IA\s*=\s*(\/.*\/[a-z]*)\s*;/;
const TODOS_NIEGA_IA = /[A-Za-z_]*NIEGA_IA\s*=\s*(\/.*\/[a-z]*)\s*;/g;

/** La expresión de core (la de `core/procesar-respuesta.js`, idéntica en sus tres variantes: `niega-ia.test.ts`). */
export function expresionNiegaIaDeCore(srcCore: string = SRC_CORE): string {
  const m = LITERAL_NIEGA_IA.exec(readFileSync(join(srcCore, 'procesar-respuesta.js'), 'utf8'));
  if (!m) throw new Error('core/procesar-respuesta.js ya no declara NIEGA_IA');
  return m[1] as string;
}

const LITERAL_NIEGA_IA_NORMALIZADO = /^const NIEGA_IA_NORMALIZADO = (\/.*\/[a-z]*);$/m;

/** La segunda expresión declarada: la de texto NORMALIZADO (`core/texto/niega-ia-normalizado.js`, 13/11/2026). Ningún flujo la incluye aún. */
export function expresionNiegaIaNormalizadaDeCore(srcCore: string = SRC_CORE): string {
  const m = LITERAL_NIEGA_IA_NORMALIZADO.exec(readFileSync(join(srcCore, 'texto', 'niega-ia-normalizado.js'), 'utf8'));
  if (!m) throw new Error('core/texto/niega-ia-normalizado.js ya no declara NIEGA_IA_NORMALIZADO');
  return m[1] as string;
}

/** Las DOS expresiones de core declaradas como fuentes (decisión de Andres, 13/11/2026: unificarlas queda para después). */
export const expresionesNiegaIaDeCore = (srcCore: string = SRC_CORE): string[] => [expresionNiegaIaDeCore(srcCore), expresionNiegaIaNormalizadaDeCore(srcCore)];

/** Quita los comentarios de bloque y de línea (un solo paso, así que uno no confunde al otro). No toca `\/\/` ni `https://`; no entiende cadenas ni plantillas (límite declarado). */
export const sinComentarios = (codigo: string): string => codigo.replace(/(?<!\\)\/\*[\s\S]*?\*\/|(?<![\\:/])\/\/[^\n]*/g, ' ');

/** Un nombre de función que normaliza texto: `wlNorm`, `evNorm`, `normalizar`, `norm`… (contiene «norm», sin distinguir mayúsculas). */
const esNormalizador = (nombre: string): boolean => /^[A-Za-z_$][\w$]*$/.test(nombre) && /norm/i.test(nombre);

/** El texto entre el paréntesis que abre en `desde` (que apunta al `(`) y su par; `null` si no cierra. */
function argumentoBalanceado(codigo: string, desde: number): string | null {
  let n = 0;
  for (let i = desde; i < codigo.length; i++) {
    if (codigo[i] === '(') n++;
    else if (codigo[i] === ')' && --n === 0) return codigo.slice(desde + 1, i);
  }
  return null;
}

const escaparRegex = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * ¿La constante `nombre` se USA en este código (ya sin comentarios)? `nombre.test(`, `.exec(`, `.source`, o como argumento de `match`, `replace`,
 * `search`, `split`. Una declaración sin uso no protege nada.
 */
export const seUsaLaConstante = (codigo: string, nombre: string): boolean => {
  const n = escaparRegex(nombre);
  return new RegExp(`\\b${n}\\s*\\.\\s*(?:test|exec|source)\\b|\\.\\s*(?:match|matchAll|replace|replaceAll|search|split)\\s*\\(\\s*${n}\\b`).test(codigo);
};

/**
 * Regla estática de la variante NORMALIZADA (14/11/2026): cada `NOMBRE.test(arg)` / `NOMBRE.exec(arg)` recibe una llamada a un normalizador
 * (`wlNorm(t)`: el nombre de la función contiene «norm») o una variable que, en el MISMO nodo, se asigna con una llamada así
 * (`const n = evNorm(c)`). Cualquier otra cosa (un parámetro, el texto crudo, un uso solo por `.source` o `match`) no se puede decidir y se rechaza.
 * Devuelve lo que no cumple; vacío = cumple.
 */
export function usosSinNormalizar(codigo: string, nombre: string): string[] {
  const n = escaparRegex(nombre);
  const malos: string[] = [];
  const llamadas = [...codigo.matchAll(new RegExp(`\\b${n}\\s*\\.\\s*(?:test|exec)\\s*(?=\\()`, 'g'))];
  if (llamadas.length === 0) return [`${nombre}: se usa sin .test( ni .exec(, no se puede comprobar que reciba texto normalizado`];
  for (const m of llamadas) {
    const arg = (argumentoBalanceado(codigo, m.index + m[0].length) ?? '').trim();
    const llamada = /^([A-Za-z_$][\w$]*)\s*\(/.exec(arg);
    if (llamada) {
      const cierre = argumentoBalanceado(arg, llamada[0].length - 1);
      if (esNormalizador(llamada[1] as string) && cierre !== null && arg.length === llamada[0].length + cierre.length + 1) continue;
    } else if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
      // La declaración más cercana ANTES del uso (sin análisis de ámbito: el mismo nombre se reusa en otras funciones del nodo). Su valor empieza por un normalizador, o por una envoltura cuyo primer argumento lo es (`chSinNombrar(cmNorm(x))`).
      const previas = [...codigo.slice(0, m.index).matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escaparRegex(arg)}\\s*=([^\\n;]*)`, 'g'))];
      const valor = previas.length ? (previas[previas.length - 1]![1] as string) : '';
      const cabeza = /^\s*([A-Za-z_$][\w$]*)\s*\(\s*(?:([A-Za-z_$][\w$]*)\s*\()?/.exec(valor);
      if (cabeza && (esNormalizador(cabeza[1] as string) || esNormalizador(cabeza[2] ?? ''))) continue;
    }
    malos.push(`${nombre}.test(${arg}): el argumento no es una llamada a un normalizador ni una variable asignada con una`);
  }
  return malos;
}

export interface AnalisisNiegaIa {
  fuente: 'core' | 'otra' | 'ninguna';
  /** Declaraciones USADAS (sin comentarios, con `.test(` o equivalente en su mismo nodo): `[nombre, literal]`. */
  usadas: [string, string][];
  /** Usos de la expresión normalizada que no reciben texto normalizado. */
  sinNormalizar: string[];
}

/**
 * ¿De dónde sale la red NIEGA_IA del flujo? Estático, nodo por nodo: descarta comentarios; una declaración `<PREFIJO>_NIEGA_IA = /…/;` solo cuenta si
 * en el MISMO nodo la constante se usa (`seUsaLaConstante`). `core` si hay al menos una declaración usada y TODAS las usadas son idénticas (el literal,
 * no el nombre) a una de las expresiones declaradas de core: una copia más débil usada en otro nodo da `otra`. `ninguna` si no hay declaraciones
 * (una comentada no existe); `otra` si hay declaraciones pero ninguna se usa. Si se pasa `normalizada` y una declaración usada es esa expresión,
 * además `usosSinNormalizar` debe salir vacío; si no, `otra`.
 */
export function analizarNiegaIa(f: Flujo, core: string | readonly string[], normalizada?: string): AnalisisNiegaIa {
  const declaradas = typeof core === 'string' ? [core] : core;
  const usadas: [string, string][] = [];
  const sinNormalizar: string[] = [];
  let sinUso = 0;
  for (const n of f.nodes) {
    const codigo = sinComentarios(String(n.parameters?.['jsCode'] ?? ''));
    for (const m of codigo.matchAll(TODOS_NIEGA_IA)) {
      const nombre = /([A-Za-z_]*NIEGA_IA)\s*=/.exec(m[0])?.[1] as string;
      if (!seUsaLaConstante(codigo, nombre)) { sinUso++; continue; }
      usadas.push([nombre, m[1] as string]);
      if (normalizada !== undefined && m[1] === normalizada) sinNormalizar.push(...usosSinNormalizar(codigo, nombre));
    }
  }
  if (usadas.length === 0) return { fuente: sinUso > 0 ? 'otra' : 'ninguna', usadas, sinNormalizar };
  const todasDeCore = usadas.every(([, lit]) => declaradas.includes(lit));
  return { fuente: todasDeCore && sinNormalizar.length === 0 ? 'core' : 'otra', usadas, sinNormalizar };
}

/** Solo la fuente. Sin `normalizada` no se comprueba que la expresión normalizada reciba texto normalizado. */
export const fuenteDeNiegaIa = (f: Flujo, core: string | readonly string[], normalizada?: string): 'core' | 'otra' | 'ninguna' => analizarNiegaIa(f, core, normalizada).fuente;

// ---------------------------------------------------------------------------
// errorWorkflow por nombre
// ---------------------------------------------------------------------------

/** El marcador que `preparar-import.sh` y `publicar-flujo.sh` resuelven por nombre al publicar. */
export const MARCADOR_ERROR_WORKFLOW = 'REEMPLAZAR_ID_ERROR_WORKFLOW';

export const llevaMarcadorDeErrorWorkflow = (f: Flujo): boolean =>
  (f.settings ?? {})['errorWorkflow'] === MARCADOR_ERROR_WORKFLOW;
