/**
 * INVARIANTE GLOBAL DE UX: UN SOLO TAMAÑO DE BOTÓN DE ACCIÓN EN TODA LA CONSOLA (Andres, 21/11/2026:
 * «hay 3 tamaños diferentes de botones de acción, eso confunde a las personas»).
 *
 * El tamaño sale de tres variables de `diseno.css` (`--accion-alto`, `--accion-fuente`, `--accion-relleno`), que usan SOLO tres reglas:
 * `.btn`, `:where(button)` y el filtro `.cv-chip` (la referencia: «Todas», «El asistente atiende»). Esta prueba falla si:
 *   1. vuelve a existir una variante de tamaño (`btn-grande`, `btn-chico`) en una hoja o en un componente;
 *   2. una regla de un botón (`.btn…`, `button…`, `.cv-adjunto-boton`…) cambia alto, fuente o relleno fuera de las reglas base
 *      (cada contenedor ajustaba «su» botón y de ahí salieron los tres tamaños);
 *   3. las reglas base escriben el tamaño con un número en vez de con las variables.
 * Los elementos que NO son botones de acción (menú lateral, segmentos, filas de lista) quedan fuera a propósito (también las filas de la lista de hilos, que son botones solo por semántica).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const SRC = join(aqui, '..', '..', 'web', 'src');
const ESTILOS = ['diseno.css', 'estilos.css', 'conversaciones.css'].map((f) => join(SRC, 'central', 'estilos', f));

const sinComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
interface Regla { selector: string; cuerpo: string }
function reglas(css: string): Regla[] {
  const salida: Regla[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(sinComentarios(css)); m; m = re.exec(sinComentarios(css))) salida.push({ selector: m[1]!.trim().replace(/\s+/g, ' '), cuerpo: m[2]! });
  return salida;
}
/** Propiedades que cambian el TAMAÑO de un botón. */
const TAMANO = /(^|;|\s)(min-height|height|font-size|padding|padding-block|padding-inline)\s*:/;
/** Selectores que son un botón de acción. */
const esBoton = (sel: string): boolean => sel.split(',').some((s) => /(^|[\s>+~])(\.btn(?![a-z-]*:)|\.btn-[a-z-]+|button|\.cv-adjunto-boton)(?![a-z-])/i.test(` ${s.trim()}`) && !/^(\.nav|\.seg-opt|\.lista-hilos)/.test(s.trim()));
/** Las ÚNICAS reglas que fijan el tamaño: la base de `.btn`, la de `button` pelado, `.btn-icon` y el filtro de referencia. */
const BASE = [/^\.btn$/, /^:where\(button\)$/, /^\.btn-icon$/, /^\.cv-chip$/];

function tsxDe(dir: string): string[] {
  const salida: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) salida.push(...tsxDe(p));
    else if (/\.tsx$/.test(f)) salida.push(p);
  }
  return salida;
}

describe('un solo tamaño de botón de acción', () => {
  it('no existe ninguna variante de tamaño (btn-grande, btn-chico) ni en las hojas ni en los componentes', () => {
    for (const p of [...ESTILOS, ...tsxDe(SRC)]) expect(readFileSync(p, 'utf8'), p).not.toMatch(/btn-(grande|chico)/);
  });

  it('solo las reglas base fijan alto, fuente o relleno de un botón; ningún contenedor ni variante los cambia', () => {
    const infractoras: string[] = [];
    for (const p of ESTILOS) {
      for (const r of reglas(readFileSync(p, 'utf8'))) {
        if (!esBoton(r.selector) || !TAMANO.test(r.cuerpo)) continue;
        if (BASE.some((b) => b.test(r.selector))) continue;
        infractoras.push(`${p.split('/').pop()}: ${r.selector}`);
      }
    }
    expect(infractoras).toEqual([]);
  });

  it('las reglas base escriben el tamaño con las variables, no con números', () => {
    const todas = ESTILOS.flatMap((p) => reglas(readFileSync(p, 'utf8')));
    const base = todas.filter((r) => BASE.some((b) => b.test(r.selector)));
    expect(base.length).toBeGreaterThanOrEqual(4);
    for (const r of base) {
      const cuerpo = r.cuerpo;
      expect(cuerpo, r.selector).not.toMatch(/(min-height|font-size)\s*:\s*\d/);
      if (/\.btn$|button\)$/.test(r.selector)) {
        expect(cuerpo, r.selector).toMatch(/min-height:\s*var\(--accion-alto\)/);
        expect(cuerpo, r.selector).toMatch(/font-size:\s*var\(--accion-fuente\)/);
        expect(cuerpo, r.selector).toMatch(/padding:\s*var\(--accion-relleno\)/);
      }
    }
    expect(readFileSync(ESTILOS[0]!, 'utf8')).toMatch(/--accion-alto:\s*26px/);
  });
});
