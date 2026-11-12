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

/**
 * Las variantes declaradas (lista cerrada de `VARIANTES.md`) de un nodo común, leídas de `Flujos/src/core`. «Carga de entrada» y «Puerta del
 * turno» no tienen variante en core todavía: devuelven lista vacía, y todo flujo que las lleve es una excepción de M4 hasta la etapa 1.
 */
export function variantesDeNodo(nodo: string, srcCore: string = SRC_CORE): string[] {
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
    return sin.length > 0 && (jsCode === v || jsCode === sin || jsCode.endsWith(v) || jsCode.endsWith(sin));
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

/**
 * ¿De dónde sale la red NIEGA_IA del flujo? Estático: busca, en el código de cualquier nodo, una expresión asignada a una constante cuyo nombre
 * termina en NIEGA_IA (con o sin prefijo). `core` si alguna es idéntica a la de core; `otra` si hay copias pero ninguna lo es (copia renombrada
 * y distinta); `ninguna` si no declara ninguna.
 */
export function fuenteDeNiegaIa(f: Flujo, core: string): 'core' | 'otra' | 'ninguna' {
  const encontradas: string[] = [];
  for (const n of f.nodes) {
    const codigo = String(n.parameters?.['jsCode'] ?? '');
    for (const m of codigo.matchAll(TODOS_NIEGA_IA)) encontradas.push(m[1] as string);
  }
  if (encontradas.includes(core)) return 'core';
  return encontradas.length ? 'otra' : 'ninguna';
}

// ---------------------------------------------------------------------------
// errorWorkflow por nombre
// ---------------------------------------------------------------------------

/** El marcador que `preparar-import.sh` y `publicar-flujo.sh` resuelven por nombre al publicar. */
export const MARCADOR_ERROR_WORKFLOW = 'REEMPLAZAR_ID_ERROR_WORKFLOW';

export const llevaMarcadorDeErrorWorkflow = (f: Flujo): boolean =>
  (f.settings ?? {})['errorWorkflow'] === MARCADOR_ERROR_WORKFLOW;
