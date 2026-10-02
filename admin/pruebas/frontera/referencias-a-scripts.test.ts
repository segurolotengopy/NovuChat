/**
 * =============================================================================
 * LAS REFERENCIAS A `admin/scripts/*` LLEVAN A UN ARCHIVO O CARPETA (F2, S1 y S2)
 * =============================================================================
 *
 * F2 mueve scripts de `admin/scripts/`. Quien los nombra por ruta —el
 * `package.json` de admin, `.claude/launch.json`, los `.sh` de `scripts/`, los
 * runbooks de alta y de pase a producción y los agentes— no lo ve la
 * compilación: falla recién cuando alguien (o un agente) corre el comando. Esta
 * prueba las lee y exige que cada una lleve a algo que existe hoy.
 *
 * Qué cuenta como referencia:
 *   - `admin/scripts/<ruta>` en cualquier parte del texto (desde la raíz);
 *   - `node|bash|sh|python scripts/<ruta>`: en `admin/package.json` es relativa
 *     a `admin/`; en los `.sh` y en los documentos, se acepta si existe en
 *     `admin/scripts/` o en `scripts/` (los runbooks corren desde `admin/` y
 *     los `.sh` desde la raíz).
 * Un marcador (`negocio-<id>.json`, `*`, `${…}`) corta la referencia: se
 * verifica hasta la carpeta que lo precede.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ } from './frontera.ts';

export interface Referencia {
  /** La ruta como aparece (sin el marcador). */
  texto: string;
  /** Rutas candidatas desde la raíz: basta que exista una. */
  candidatas: string[];
}

export function referenciasA(archivo: string, texto: string): Referencia[] {
  const salida: Referencia[] = [];
  const limpiar = (r: string) => r.replace(/[.,;:/]+$/, '');
  for (const m of texto.matchAll(/admin\/scripts\/([A-Za-z0-9._\-/]*)([<*{$]?)/g)) {
    let resto = m[1]!;
    if (m[2]) resto = resto.replace(/[^/]*$/, ''); // un marcador corta el nombre: queda la carpeta
    const ref = limpiar(`admin/scripts/${resto}`);
    salida.push({ texto: ref, candidatas: [ref] });
  }
  for (const m of texto.matchAll(/\b(?:node|bash|sh|python3?)\s+(?:-\S+\s+)*(scripts\/[A-Za-z0-9._\-/]*)([<*{$]?)/g)) {
    let ref = m[1]!;
    if (m[2]) ref = ref.replace(/[^/]*$/, '');
    ref = limpiar(ref);
    const enAdmin = archivo === 'admin/package.json';
    salida.push({ texto: ref, candidatas: enAdmin ? [`admin/${ref}`] : [`admin/${ref}`, ref] });
  }
  return salida;
}

const listarSh = (dir: string): string[] => readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? (e.name === 'node_modules' ? [] : listarSh(`${dir}/${e.name}`)) : e.name.endsWith('.sh') ? [`${dir}/${e.name}`] : []));

const ARCHIVOS = [
  'admin/package.json',
  '.claude/launch.json',
  ...listarSh('scripts'),
  'docs/alta-cliente/RUNBOOK.md',
  'docs/pase-a-produccion/RUNBOOK.md',
  ...readdirSync(join(RAIZ, '.claude/agents')).filter((n) => n.endsWith('.md')).map((n) => `.claude/agents/${n}`),
];

/** Archivo o carpeta: una referencia puede nombrar cualquiera de los dos. */
const existeReal = (r: string) => existsSync(join(RAIZ, r));

const rotas = (archivo: string, texto: string, existe: (r: string) => boolean): string[] =>
  referenciasA(archivo, texto).filter((r) => !r.candidatas.some(existe)).map((r) => `${archivo}: ${r.texto}`);

describe('las referencias a admin/scripts/* llevan a un archivo o carpeta', () => {
  it('hay referencias que revisar (control de que no pasa en vacío)', () => {
    const todas = ARCHIVOS.flatMap((a) => referenciasA(a, readFileSync(join(RAIZ, a), 'utf8')).map((r) => ({ a, ...r })));
    expect(ARCHIVOS.length).toBeGreaterThan(20);
    expect(todas.some((r) => r.a === 'admin/package.json' && r.texto === 'scripts/sembrar.mjs')).toBe(true);
    expect(todas.some((r) => r.a === '.claude/launch.json' && r.texto === 'admin/scripts/datos/catalogo-demo.mjs')).toBe(true);
    expect(todas.some((r) => r.a === 'docs/pase-a-produccion/RUNBOOK.md')).toBe(true);
    expect(todas.some((r) => r.a.startsWith('.claude/agents/'))).toBe(true);
    expect(todas.length).toBeGreaterThan(20);
  });

  it('cada referencia lleva a algo que existe', () => {
    const faltan = ARCHIVOS.flatMap((a) => rotas(a, readFileSync(join(RAIZ, a), 'utf8'), existeReal));
    expect(faltan, 'Referencia a un script que no existe (¿se movió?): se corrige en el mismo PR que lo mueve').toEqual([]);
  });

  it('la regla, negando: una referencia movida se detecta en cada forma', () => {
    const ARBOL = new Set(['admin/scripts/ok.mjs', 'admin/scripts/plataforma/enlace.mjs', 'admin/scripts/datos/negocio-x.json', 'scripts/raiz.sh']);
    const existe = (r: string) => ARBOL.has(r) || [...ARBOL].some((a) => a.startsWith(`${r}/`));
    const casos: Record<string, string> = {
      'admin/package.json': '{"scripts":{"a":"node scripts/movido.mjs --x","b":"bash scripts/emuladores.sh"}}',
      '.claude/launch.json': '{"runtimeArgs":["admin/scripts/movido.mjs"]}',
      'scripts/a.sh': 'node "$RAIZ/admin/scripts/movido.mjs" --aplicar\n',
      'docs/pase-a-produccion/RUNBOOK.md': 'cd admin && node scripts/movido.mjs --proyecto p\n',
      'docs/alta-cliente/RUNBOOK.md': 'Corra `admin/scripts/plataforma/movido/` y `admin/scripts/datos/negocio-<id>.json`.\n',
      '.claude/agents/x.md': 'Ver admin/scripts/viejo/enlace.mjs.\n',
    };
    for (const [archivo, texto] of Object.entries(casos)) {
      expect(rotas(archivo, texto, existe).length, archivo).toBeGreaterThanOrEqual(1);
    }
    // package.json: `scripts/emuladores.sh` también falta en este árbol, así que son dos.
    expect(rotas('admin/package.json', casos['admin/package.json']!, existe).length).toBe(2);
    // Lo que sí existe pasa: archivo, carpeta, ruta con marcador, punto final de oración, y desde la raíz en un .sh.
    const bien = 'Ver admin/scripts/ok.mjs, admin/scripts/plataforma/ y admin/scripts/datos/negocio-<id>.json; luego admin/scripts/ok.mjs.\n';
    expect(rotas('docs/alta-cliente/RUNBOOK.md', bien, existe)).toEqual([]);
    expect(rotas('scripts/b.sh', 'bash scripts/raiz.sh\nnode scripts/ok.mjs\n', existe)).toEqual([]);
  });
});
