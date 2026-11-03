/**
 * LAS LIBRERÍAS DE ANTONIO, como las arma `construir.mjs` (no es una suite: vitest solo corre `*.test.ts`).
 * La lista y el orden salen de `CONFIG.librerias` del armador: la base común de las ventas digitales (`cb`, `av`, `vd`), los módulos del core de texto (`ct`) y lo propio de Antonio (`ra`).
 * Las pruebas que evalúan funciones sueltas usan este código completo; cargar `ra.js` solo ya no alcanza porque depende de las demás.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error el armador es un .mjs sin tipos
import { AQUI, CONFIG } from '../../../../Flujos/experimental/rroca-antonio/construir.mjs';

export const RUTAS_DE_LIBRERIAS: string[] = (CONFIG.librerias as string[]).map((r) => join(AQUI as string, r));
export const CODIGO_LIBRERIAS: string = RUTAS_DE_LIBRERIAS.map((r) => readFileSync(r, 'utf8')).join('\n\n');
/** Evalúa las librerías y devuelve las declaraciones pedidas. El código es el de archivos del propio repositorio, no una entrada externa: solo prueba. */
export function cargarLibrerias<T = Record<string, any>>(nombres: string): T { // eslint-disable-line @typescript-eslint/no-explicit-any
  // nosemgrep: devsecops.js-eval-prohibido
  return new Function(`${CODIGO_LIBRERIAS}\nreturn { ${nombres} };`)() as T;
}
