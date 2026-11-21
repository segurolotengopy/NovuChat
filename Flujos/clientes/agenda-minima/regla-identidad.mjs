// La regla de IDENTIDAD (prohibición 4: el asistente nunca niega ser una IA) del FILTRO COMÚN del core, derivada de su fuente. La usan `construir.mjs` de agenda mínima y la prueba del armador genérico:
// una sola derivación. No ejecuta nada (regla de SAST): lee las líneas del bloque «negar ser una IA» de `Flujos/src/core/texto/filtro-redaccion.js`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'core', 'texto', 'filtro-redaccion.js');

/** El código `const NIEGA_IA_CORE = …` que se inyecta delante de «Armar mensajes». Lanza si el core mueve o cambia el bloque. */
export function reglaDeIdentidadDelCore() {
  const fuente = readFileSync(RAIZ, 'utf8');
  const ini = fuente.indexOf('  // negar ser una IA (prohibición 4');
  const finMarca = "  'carne y hueso',\n";
  const fin = ini < 0 ? -1 : fuente.indexOf(finMarca, ini);
  if (ini < 0 || fin < 0) throw new Error('filtro-redaccion.js: no encuentro el bloque «negar ser una IA» (prohibición 4); agenda mínima lo incluye de ahí');
  // Sin ejecutar nada (regla de SAST): cada línea del bloque es UN literal entre comillas simples; los comentarios se saltan y el texto se des-escapa en un solo paso.
  const lista = [];
  for (const linea of fuente.slice(ini, fin + finMarca.length).split('\n')) {
    if (/^\s*(?:\/\/.*)?$/.test(linea)) continue;
    const m = /^\s*'((?:[^'\\]|\\.)*)',\s*$/.exec(linea);
    if (!m) throw new Error(`filtro-redaccion.js: una línea del bloque «negar ser una IA» ya no es un literal simple: ${linea.slice(0, 60)}`);
    lista.push(m[1].replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c)));  // un solo paso: «\\» → «\», «\'» → «'» (sin escapar a mano)
  }
  if (!Array.isArray(lista) || lista.length < 8 || lista.some((x) => typeof x !== 'string')) throw new Error('filtro-redaccion.js: el bloque «negar ser una IA» ya no es una lista de expresiones');
  return `// REGLA DE IDENTIDAD (prohibición 4) derivada de Flujos/src/core/texto/filtro-redaccion.js al armar; no se edita a mano.\nconst NIEGA_IA_CORE = new RegExp(${JSON.stringify(lista.join('|'))});`;
}
