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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
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
  const bloques = [...flujoCi.matchAll(/grep -qE "([^"]+)"; then\n\s+echo "(\w+)=true"/g)];
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

  it('un tag o un dispatch fijan las dos salidas en true', () => {
    const salidasTempranas = [...flujoCi.matchAll(/echo "admin_cambio=true" >> "\$GITHUB_OUTPUT"\n\s+echo "pruebas_cambio=true" >> "\$GITHUB_OUTPUT"; exit 0/g)];
    expect(salidasTempranas).toHaveLength(2);
  });
});
