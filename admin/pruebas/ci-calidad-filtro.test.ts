/**
 * Qué decide si `calidad` corre en el CI (27/09/2026).
 *
 * Hasta esa fecha el filtro de rutas de `preparar` miraba solo `admin/` y el
 * pipeline: un PR que tocaba solo `Flujos/` salteaba `calidad`, y
 * `compuerta-pr` lo aprobaba sin haber corrido las suites que leen esos
 * archivos (los JSON de los flujos, `Flujos/src`, el ensamblador y, desde F2,
 * la frontera de zonas). Ahora hay dos salidas:
 *   - `pruebas_cambio` decide `calidad` y la compuerta: todo lo que las
 *     suites leen, dentro o fuera de `admin/`;
 *   - `admin_cambio` sigue decidiendo construir y desplegar: un PR de
 *     `Flujos/` no despliega la consola.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, '..', '..');
const flujoCi = readFileSync(join(aqui, '../../.github/workflows/ci-node-firebase.yml'), 'utf8');

/** El texto de un job del workflow, desde su cabecera hasta la del siguiente. */
function job(nombre: string): string {
  const i = flujoCi.indexOf(`\n  ${nombre}:\n`);
  expect(i, `no encontré el job ${nombre}`).toBeGreaterThan(-1);
  const resto = flujoCi.slice(i + 1);
  const siguiente = resto.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return siguiente === -1 ? resto : resto.slice(0, siguiente + 1);
}

/** El patrón de `grep -qE` que escribe una salida, como RegExp de JS (con RUTA = admin). */
function patronDe(salida: string): RegExp {
  const bloques = [...flujoCi.matchAll(/grep -qE "([^"]+)" <<< "\$archivos"; then\n\s+echo "(\w+)=true"/g)];
  const bloque = bloques.find((b) => b[2] === salida);
  expect(bloque, `no encontré el grep que escribe ${salida}`).toBeTruthy();
  return new RegExp(bloque![1].replace('${RUTA}', 'admin'));
}

describe('qué cambios hacen correr las pruebas y cuáles despliegan', () => {
  const pruebas = patronDe('pruebas_cambio');
  const admin = patronDe('admin_cambio');

  it('lo que las suites leen fuera de admin/ hace correr calidad', () => {
    // Rutas que alguna suite lee hoy (grep de `join(aqui, '../../…')`).
    for (const ruta of [
      'Flujos/demo-a-agendamiento.json',
      'Flujos/src/comun/normalizar-entrada.js',
      'Flujos/prompts/core/base.md',
      'scripts/estado-de-versiones.sh',
      'scripts/preparar-import.sh',
      'docs/base-comercial.md',
      '.github/workflows/ci-node-firebase.yml',
      'admin/functions/src/planes.ts',
    ]) expect(pruebas.test(ruta), ruta).toBe(true);
  });

  it('la documentación que ninguna suite lee no hace correr calidad', () => {
    for (const ruta of ['docs/arquitectura/core.md', 'Prompts/COORDINACION.md', 'ESTADO.md', 'bitacora/2026-09.md', 'docs/base-comercial.md.bak']) {
      expect(pruebas.test(ruta), ruta).toBe(false);
    }
  });

  it('un cambio solo de Flujos/ no construye ni despliega la consola', () => {
    expect(admin.test('Flujos/demo-a-agendamiento.json')).toBe(false);
    expect(admin.test('scripts/estado-de-versiones.sh')).toBe(false);
    expect(admin.test('admin/web/src/App.tsx')).toBe(true);
  });

  it('calidad y la compuerta miran pruebas_cambio; construir y desplegar, admin_cambio', () => {
    expect(job('calidad')).toContain("needs.preparar.outputs.pruebas_cambio == 'true'");
    expect(job('calidad')).not.toContain('outputs.admin_cambio');
    expect(job('compuerta-pr')).toContain('HUBO_CAMBIO: ${{ needs.preparar.outputs.pruebas_cambio }}');
    for (const j of ['construir', 'construir-staging']) {
      expect(job(j)).toContain("needs.preparar.outputs.admin_cambio == 'true'");
      expect(job(j)).not.toContain('outputs.pruebas_cambio');
    }
  });

  it('toda ruta de fuera de admin/ que una suite lee hace correr calidad (derivado, no a mano)', () => {
    // Cada `join(aqui, …)` con argumentos literales de cada archivo de
    // admin/pruebas, resuelto desde SU carpeta: lo que cae fuera de admin/ es
    // una lectura que el filtro tiene que ver.
    const listar = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const r = join(d, n);
      return statSync(r).isDirectory() ? listar(r) : r.endsWith('.ts') ? [r] : [];
    });
    const fuera = new Set<string>();
    for (const archivo of listar(aqui)) {
      // Sin comentarios: citan rutas de ejemplo que nadie lee.
      const texto = readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
      for (const m of texto.matchAll(/join\(\s*aqui\s*,([^)]*)\)/g)) {
        const partes: string[] = [];
        for (const a of m[1].split(',')) {
          const lit = a.trim().match(/^['"]([^'"]+)['"]$/);
          if (!lit) break; // un argumento calculado: se toma hasta ahí
          partes.push(lit[1]);
        }
        if (partes.length === 0) continue;
        const ruta = relative(RAIZ, resolve(dirname(archivo), ...partes));
        if (ruta === '' || ruta.startsWith('admin/') || ruta === 'admin' || ruta.startsWith('..')) continue;
        const esDir = existsSync(join(RAIZ, ruta)) && statSync(join(RAIZ, ruta)).isDirectory();
        fuera.add(esDir ? `${ruta}/` : ruta);
      }
    }
    expect(fuera.size, 'el recorrido no encontró ninguna lectura fuera de admin/: el patrón de join dejó de servir').toBeGreaterThan(3);
    const sinCubrir = [...fuera].filter((r) => !pruebas.test(r) && !pruebas.test(`${r}x`));
    expect(sinCubrir, 'Una suite lee esto fuera de admin/ y el filtro de calidad no lo mira: agregarlo a pruebas_cambio').toEqual([]);
  });

  it('el diff ve los renombres por su origen y no pasa por una tubería con grep -q', () => {
    const paso = flujoCi.slice(flujoCi.indexOf('- name: Detectar cambios en el componente'), flujoCi.indexOf('- name: Habilitar corepack'));
    expect(paso).toContain('git -c core.quotePath=false diff --no-renames --name-only');
    // Con pipefail, `echo | grep -q` da 141 en un diff grande y el if toma la rama falsa.
    expect(paso).not.toMatch(/\|\s*grep -q/);
  });

  it('un tag o un dispatch fijan las dos salidas en true', () => {
    const salidasTempranas = [...flujoCi.matchAll(/echo "admin_cambio=true" >> "\$GITHUB_OUTPUT"\n\s+echo "pruebas_cambio=true" >> "\$GITHUB_OUTPUT"; exit 0/g)];
    expect(salidasTempranas).toHaveLength(2);
  });
});
