/**
 * Carga el texto de archivos de `Flujos/src/` en un contexto de `node:vm` NUEVO y devuelve los nombres pedidos.
 * Es el patrón de `texto-no-repetir.test.ts`: el contexto nace vacío (sin `URL`, `Buffer`, `crypto`, `require`…),
 * como el Code de n8n, y no hay `new Function`. Los objetos y arreglos que devuelve nacen en OTRO contexto: para
 * compararlos se usa `toEqual` (`toStrictEqual` falla por los prototipos).
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/** Raíz del repositorio (este archivo está en `admin/pruebas/core/`). */
export const RAIZ_REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Lee los archivos (rutas relativas a la raíz del repositorio, o absolutas) y los une con un salto de línea. */
export const leerFuentes = (rutas: string[]): string =>
  rutas.map((r) => readFileSync(isAbsolute(r) ? r : join(RAIZ_REPO, r), 'utf8')).join('\n');

/** Evalúa las fuentes en un contexto vacío y devuelve `{ nombre: valor }` para cada nombre pedido. */
export function cargarFuente<T = Record<string, unknown>>(rutas: string[], nombres: string[]): T {
  return vm.runInNewContext(`${leerFuentes(rutas)}\n({ ${nombres.join(', ')} });`, Object.create(null)) as T;
}
