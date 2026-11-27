/**
 * NINGUNA FUNCIÓN DUPLICADA en la librería concatenada de un nodo (integración de #1113 en #1098, 25/11/2026).
 * Los nodos Code reciben `librerias` + `comun` + sus paquetes + su propio código pegados en UN solo texto: dos `function` con el mismo nombre NO dan error (gana la última sin aviso) y un reconocedor viejo puede quedar tapado por otro.
 * Esta prueba lee las listas de `construir.mjs` (`CONFIG.librerias`, `CONFIG.comun`, `CONFIG.paquetes`) y los nodos propios de `src/nodos/`, y falla si un mismo nombre de función aparece dos veces en el texto de un nodo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/clientes/casa-bermejo');
const leer = (r: string): string => readFileSync(join(CARPETA, r), 'utf8');

/** Los nombres de función de primer nivel de un texto, con su cuenta (`function nombre(` y `const nombre = (…) =>`/`function`). */
export function funcionesDe(texto: string): Map<string, number> {
  const cuenta = new Map<string, number>();
  const sinComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const re = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sinComentarios)) !== null) { const n = (m[1] ?? m[2])!; cuenta.set(n, (cuenta.get(n) ?? 0) + 1); }
  return cuenta;
}
/** Los nombres que aparecen más de una vez en la concatenación de los textos dados. */
export function duplicadas(textos: string[]): string[] {
  const total = new Map<string, number>();
  for (const t of textos) for (const [n, c] of funcionesDe(t)) total.set(n, (total.get(n) ?? 0) + c);
  return [...total].filter(([, c]) => c > 1).map(([n]) => n).sort();
}

describe('el detector: dos funciones con el mismo nombre se encuentran', () => {
  it('dentro de un texto y entre textos concatenados; lo único no se marca', () => {
    expect(duplicadas(['function a() {}\nfunction b() {}'])).toEqual([]);
    expect(duplicadas(['function a() {}\nfunction a(x) {}'])).toEqual(['a']);
    expect(duplicadas(['function bmPideUbicacion(n) {}', 'function bmPideUbicacion(n, crudo) {}'])).toEqual(['bmPideUbicacion']);
    expect(duplicadas(['const f = (x) => x;', 'function f() {}'])).toEqual(['f']);
    expect(duplicadas(['// function a() {}\n/* function a() {} */\nfunction a() {}'])).toEqual([]);
  });
});

describe('la librería concatenada de cada nodo de Casa Bermejo no repite funciones', async () => {
  const { CONFIG } = (await import(join(CARPETA, 'construir.mjs'))) as { CONFIG: { librerias: string[]; comun: string[]; paquetes: Record<string, string[]> } };
  const comunes = [...CONFIG.librerias, ...CONFIG.comun].map(leer);
  it('las listas de `construir.mjs` existen y traen las dos librerías propias', () => {
    expect(CONFIG.librerias.some((r) => r.endsWith('src/lib/bm-venta.js'))).toBe(true);
    expect(CONFIG.librerias.some((r) => r.endsWith('src/lib/bm.js'))).toBe(true);
  });
  it('librerías + común', () => { expect(duplicadas(comunes)).toEqual([]); });
  for (const [paquete, rutas] of Object.entries(CONFIG.paquetes)) {
    it(`librerías + común + paquete «${paquete}»`, () => { expect(duplicadas([...comunes, ...rutas.map(leer)]), paquete).toEqual([]); });
  }
  // Los nodos Code reales: la plantilla dice, por nodo, qué paquetes pide (`@@todo+mensajes+filtro:nodos/armar-mensajes.js`, `@@vd:<nodo>`).
  const plantilla = JSON.parse(leer('flujo.plantilla.json')) as { nodes: { name: string; parameters?: { jsCode?: unknown } }[] };
  const pedidos = plantilla.nodes.flatMap((n) => (typeof n.parameters?.jsCode === 'string' && n.parameters.jsCode.startsWith('@@') ? [{ nodo: n.name, marca: n.parameters.jsCode }] : []));
  it('la plantilla tiene los nodos propios (todo) y los comunes neutros (vd) que se esperan', () => {
    expect(pedidos.filter((p) => p.marca.startsWith('@@todo')).length).toBeGreaterThanOrEqual(4);
    expect(pedidos.filter((p) => p.marca.startsWith('@@vd:')).length).toBeGreaterThanOrEqual(4);
  });
  for (const { nodo, marca } of pedidos) {
    const todo = /^@@todo((?:\+[a-z0-9-]+)*):(.+)$/.exec(marca);
    const vd = /^@@vd:([a-z0-9-]+)$/.exec(marca);
    if (!todo && !vd) continue;
    it(`«${nodo}» (${marca}): librerías + común + sus paquetes + su código`, () => {
      const paquetes = todo ? todo[1]!.split('+').filter((x) => x !== '').flatMap((q) => CONFIG.paquetes[q] ?? []) : (CONFIG.paquetes['vd-' + vd![1]] ?? []);
      if (todo) for (const q of todo[1]!.split('+').filter((x) => x !== '')) expect(CONFIG.paquetes[q], `paquete ${q}`).toBeDefined();
      const propio = todo ? [leer(join('src', todo[2]!))] : [];
      expect(duplicadas([...comunes, ...paquetes.map(leer), ...propio]), nodo).toEqual([]);
    });
  }
  it('los nodos propios de `src/nodos/` están todos pedidos por la plantilla (ninguno queda sin revisar)', () => {
    const usados = pedidos.flatMap((p) => { const m = /:nodos\/([a-z-]+\.js)$/.exec(p.marca); return m ? [m[1]!] : []; });
    for (const archivo of readdirSync(join(CARPETA, 'src/nodos')).filter((f) => f.endsWith('.js'))) expect(usados, archivo).toContain(archivo);
  });
});
