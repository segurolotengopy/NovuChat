/**
 * =============================================================================
 * LAS RUTAS ESCRITAS EN LOS SCRIPTS LLEVAN A UN ARCHIVO (F2, tanda cero)
 * =============================================================================
 *
 * F2 mueve archivos de `functions/src` a subcarpetas. Un import en TypeScript
 * que queda roto lo atrapa la compilación, y uno de un script con zona lo
 * atrapa `fronteras.test.ts`. Pero varios scripts NO tienen zona (no se
 * analizan como origen) y otros cargan Functions por RUTA:
 *   - `pase-a-produccion.mjs`: `await import(join(FUENTES, 'planes.ts'))`
 *   - `fijar-tipo-cambio.mjs`, `migrar-prepago.mjs`: `../functions/lib/*.js`
 *   - `asignar-numero.mjs`: lee el texto de `firma.ts`
 * Una ruta rota ahí falla recién al correr el script, contra producción.
 *
 * Esta prueba recorre el CÓDIGO (sin comentarios) de todo `admin/scripts/**`
 * y `scripts/**` y exige que lleve a un archivo que existe:
 *   1. todo import relativo (con el lector de la frontera, también los de
 *      scripts sin zona);
 *   2. todo literal con `functions/src/…` o `functions/lib/…` y extensión
 *      (`lib/x.js` es el compilado de `src/x.ts`);
 *   3. toda cadena `join(BASE, '…')` cuya BASE es una constante armada con
 *      `join(aqui, …)` que apunta dentro de `admin/functions`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ, importsDe, sinComentarios } from './frontera.ts';

const listar = (dir: string): string[] => readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? (e.name === 'node_modules' ? [] : listar(`${dir}/${e.name}`))
    : /\.(mjs|js|ts|sh)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const SCRIPTS = [...listar('admin/scripts'), ...listar('scripts')];

/** `admin/functions/lib/x.js` es el compilado de `admin/functions/src/x.ts`. */
const aFuente = (r: string) => r.replace(/^admin\/functions\/lib\/(.+)\.js$/, 'admin/functions/src/$1.ts');
const existe = (r: string) => {
  const f = aFuente(r);
  return existsSync(join(RAIZ, f)) && statSync(join(RAIZ, f)).isFile();
};
const literales = (args: string): string[] | null => {
  const partes = args.split(',').map((a) => a.trim()).filter(Boolean);
  const valores = partes.map((p) => p.match(/^['"]([^'"]+)['"]$/)?.[1] ?? null);
  return valores.every((v) => v !== null) ? (valores as string[]) : null;
};

/** Las rutas que un script escribe hacia `admin/functions`, relativas a la raíz. */
function rutasEscritas(archivo: string, texto: string): string[] {
  const codigo = sinComentarios(texto);
  const carpeta = posix.dirname(archivo);
  const rutas: string[] = [];
  // 2. literales con functions/(src|lib)/…ext
  for (const m of codigo.matchAll(/['"`]([^'"`\s$*]*functions\/(?:src|lib)\/[^'"`\s$*]+\.(?:ts|js|mjs))['"`]/g)) {
    const lit = m[1]!;
    rutas.push(lit.startsWith('.') ? posix.normalize(posix.join(carpeta, lit)) : lit.startsWith('admin/') ? lit : `admin/${lit}`);
  }
  // 3. join(BASE, …) con BASE = join(aqui | __dirname | AQUI, …)
  const bases = new Map<string, string>();
  for (const m of codigo.matchAll(/\bconst\s+(\w+)\s*=\s*join\(\s*(aqui|__dirname|AQUI)\s*,([^)]*)\)/g)) {
    const partes = literales(m[3]!);
    if (partes) bases.set(m[1]!, posix.normalize(posix.join(carpeta, ...partes)));
  }
  for (const m of codigo.matchAll(/\bjoin\(\s*(\w+)\s*,([^)]*)\)/g)) {
    const base = bases.get(m[1]!);
    const partes = literales(m[2]!);
    if (!base || !partes) continue;
    const r = posix.normalize(posix.join(base, ...partes));
    if (r.startsWith('admin/functions/') && /\.(ts|js)$/.test(r)) rutas.push(r);
  }
  return rutas;
}

describe('las rutas escritas en los scripts llevan a un archivo', () => {
  it('hay scripts que revisar, y las formas conocidas se reconocen (control de que no pasa en vacío)', () => {
    expect(SCRIPTS.length).toBeGreaterThan(40);
    const todas = SCRIPTS.flatMap((a) => rutasEscritas(a, readFileSync(join(RAIZ, a), 'utf8')));
    // pase-a-produccion (join(FUENTES, …)) y migrar-prepago (lib/*.js) tienen que verse.
    expect(todas.some((r) => r.endsWith('/atencion.ts'))).toBe(true);
    expect(todas.some((r) => r.startsWith('admin/functions/lib/') && r.endsWith('/prepago.js'))).toBe(true);
  });

  it('todo import relativo de un script lleva a un archivo (también los scripts sin zona)', () => {
    const rotos = SCRIPTS.filter((a) => /\.(mjs|js|ts)$/.test(a))
      .flatMap((a) => importsDe(a).filter((i) => i.especificador.startsWith('.') && !i.destino)
        .map((i) => `${a}: ${i.especificador}`));
    expect(rotos).toEqual([]);
  });

  it('todo literal y todo join(FUENTES, …) hacia admin/functions lleva a un archivo', () => {
    const rotas = SCRIPTS.flatMap((a) => rutasEscritas(a, readFileSync(join(RAIZ, a), 'utf8'))
      .filter((r) => !existe(r)).map((r) => `${a}: ${r}`));
    expect(rotas, 'Ruta a una Function que no existe (¿se movió?): se corrige en el mismo PR que mueve el archivo').toEqual([]);
  });

  it('la regla, negando: una ruta movida se detecta en cada forma', () => {
    const casos: Record<string, string> = {
      'admin/scripts/a.mjs': "const FUENTES = join(aqui, '..', 'functions', 'src');\nawait import(join(FUENTES, 'no-existe.ts'));",
      'admin/scripts/b.mjs': "const m = await import('../functions/lib/no-existe.js');",
      'admin/scripts/c.mjs': "const t = readFileSync('admin/functions/src/no-existe.ts', 'utf8');",
    };
    for (const [archivo, texto] of Object.entries(casos)) {
      const rutas = rutasEscritas(archivo, texto);
      expect(rutas.length, archivo).toBe(1);
      expect(existe(rutas[0]!), archivo).toBe(false);
    }
    // Un comentario no cuenta.
    expect(rutasEscritas('admin/scripts/d.mjs', "// ver functions/src/no-existe.ts\n")).toEqual([]);
  });
});
