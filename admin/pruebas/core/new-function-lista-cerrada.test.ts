/**
 * Condición 5 del cierre de la rearquitectura, por la vía «lista cerrada
 * declarada» (decisión de Andres, 31/10/2026): hoy `new Function` sigue siendo
 * la forma en que unas 40 suites ejecutan el código de los nodos Code. No se
 * migran; se CONGELAN. `pruebas/lib/new-function-permitidos.json` es la lista
 * cerrada, y esta prueba falla en los dos sentidos:
 *   - aparece un archivo con `new Function(` que la lista no declara
 *     (el uso nuevo se decide, no se desliza);
 *   - la lista nombra un archivo que ya no lo usa o ya no existe
 *     (la lista no puede mentir ni acumular deuda muerta).
 * El camino de salida es `vm.compileFunction` de `pruebas/lib/flujo.ts` (F3b
 * PR-6a): al migrar un archivo, se lo saca de la lista en el mismo PR.
 *
 * «Usa» = la llamada `new Function(` fuera de comentarios. Una mención dentro
 * de un texto (por ejemplo la prueba que afirma que otro archivo NO lo usa)
 * cuenta igual: se declara, y es una decisión visible.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, '..', '..', '..');
const RUTA_LISTA = join(aqui, '..', 'lib', 'new-function-permitidos.json');
const EXTENSIONES = /\.(ts|mts|tsx|js|mjs|cjs)$/;
const IGNORAR = new Set(['node_modules', '.git', '.claude', 'dist', 'coverage', '.firebase']);

/** Quita comentarios de bloque y de línea (esta última solo si abre tras espacio o al inicio). */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** ¿El texto llama a `new Function(` fuera de comentarios? */
function usaNewFunction(src: string): boolean {
  return /\bnew\s+Function\s*\(/.test(sinComentarios(src));
}

/** Diferencia entre lo declarado y lo encontrado. */
function comparar(declarados: string[], encontrados: string[]) {
  const d = new Set(declarados);
  const e = new Set(encontrados);
  return {
    nuevosSinDeclarar: encontrados.filter((x) => !d.has(x)).sort(),
    declaradosSinUso: declarados.filter((x) => !e.has(x)).sort(),
    duplicados: declarados.filter((x, i) => declarados.indexOf(x) !== i),
  };
}

function archivos(dir: string, salida: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(ent.name)) continue;
    const ruta = join(dir, ent.name);
    if (ent.isDirectory()) archivos(ruta, salida);
    else if (EXTENSIONES.test(ent.name)) salida.push(relative(RAIZ, ruta).split(sep).join('/'));
  }
  return salida;
}

const lista = JSON.parse(readFileSync(RUTA_LISTA, 'utf8')) as { archivos: string[] };
const declarados = lista.archivos;
const encontrados = archivos(RAIZ).filter((a) => usaNewFunction(readFileSync(join(RAIZ, a), 'utf8')));

describe('new Function: lista cerrada declarada (condición 5)', () => {
  it('la lista está ordenada y sin repetidos', () => {
    expect(declarados).toEqual([...declarados].sort());
    expect(comparar(declarados, encontrados).duplicados).toEqual([]);
  });

  it('ningún archivo usa new Function sin estar declarado', () => {
    expect(comparar(declarados, encontrados).nuevosSinDeclarar).toEqual([]);
  });

  it('ningún archivo declarado deja de usarlo (o desaparece)', () => {
    expect(comparar(declarados, encontrados).declaradosSinUso).toEqual([]);
  });

  it('esta misma prueba no usa new Function, así que no se autodeclara', () => {
    expect(encontrados).not.toContain('admin/pruebas/core/new-function-lista-cerrada.test.ts');
  });
});

describe('contrapruebas del detector', () => {
  const NF = 'new ' + 'Function'; // armado a trozos: este archivo no debe contenerlo escrito de corrido
  it('detecta la llamada, con espacios y saltos', () => {
    expect(usaNewFunction(`const f = ${NF}('x', 'return x');`)).toBe(true);
    expect(usaNewFunction(`const f = new   ` + `Function (\n'x')`)).toBe(true);
  });
  it('ignora comentarios de línea y de bloque', () => {
    expect(usaNewFunction(`// ${NF}('x')\nconst a = 1;`)).toBe(false);
    expect(usaNewFunction(`/* ${NF}('x') */ const a = 1;`)).toBe(false);
    expect(usaNewFunction(`/**\n * ${NF}('x')\n */\nconst a = 1;`)).toBe(false);
  });
  it('no confunde una URL con un comentario ni nombres parecidos', () => {
    expect(usaNewFunction(`const u = 'https://x'; ${NF}('a')`)).toBe(true);
    expect(usaNewFunction(`new FunctionX('a'); new Functions('b')`)).toBe(false);
  });
  it('un archivo nuevo no declarado se reporta; uno declarado sin uso también', () => {
    const r = comparar(['a.ts', 'b.ts'], ['a.ts', 'c.ts']);
    expect(r.nuevosSinDeclarar).toEqual(['c.ts']);
    expect(r.declaradosSinUso).toEqual(['b.ts']);
    expect(comparar(['a.ts', 'a.ts'], ['a.ts']).duplicados).toEqual(['a.ts']);
    expect(comparar(['a.ts'], ['a.ts'])).toEqual({ nuevosSinDeclarar: [], declaradosSinUso: [], duplicados: [] });
  });
});
