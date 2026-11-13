/**
 * VERIFICADOR DE REFERENCIAS DE NODOS (core, sin agente): `Flujos/src/core/sin-agente/referencias.mjs`.
 * Una sola función para todos los constructores; esta suite la prueba con flujos mínimos, con contraprueba por cada forma de comillas y por la referencia dinámica.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { problemasDeReferencias, referenciasDeNodos } from '../../../Flujos/src/core/sin-agente/referencias.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../..');

type Nodo = { name: string; parameters: Record<string, unknown> };
const flujo = (codigoB: string, extra: Nodo[] = []) => ({
  nodes: [{ name: 'A', parameters: {} }, { name: 'B', parameters: { jsCode: codigoB } }, ...extra],
  connections: { A: { main: [[{ node: 'B' }]] } },
});

describe('referencias de nodos: la función común', () => {
  it('un literal a un antecesor que existe no da hallazgos (comillas simples, dobles e invertidas)', () => {
    for (const c of ["$('A').first()", '$("A").first()', "$node['A'].json", '$node["A"].json', "$items('A')", '$items("A")']) {
      expect(problemasDeReferencias(flujo(`return ${c};`))).toEqual([]);
    }
  });

  it('contraprueba: un literal a un nodo inexistente falla, con cada forma de comillas', () => {
    for (const c of ["$('Fantasma')", '$("Fantasma")', "$node['Fantasma']", '$node["Fantasma"]', "$items('Fantasma')", '$items("Fantasma")']) {
      const p = problemasDeReferencias(flujo(`return ${c};`));
      expect(p.length, c).toBe(1);
      expect(p[0]).toContain('NO existe');
    }
  });

  it('las comillas invertidas no son un literal: son una referencia dinámica y, mezclada con un literal, se rechaza', () => {
    const p = problemasDeReferencias(flujo("const a = $('A'); const b = $(`A`);"));
    expect(p.some((x) => x.includes('mezcla'))).toBe(true);
  });

  it('un nodo que existe pero no es antecesor falla', () => {
    const f = flujo('return 1;', [{ name: 'C', parameters: { jsCode: "return $('B');" } }]);
    const p = problemasDeReferencias(f);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('NO es su antecesor');
  });

  it('la referencia dinámica sola se acepta; mezclada con un literal se rechaza', () => {
    expect(problemasDeReferencias(flujo('const n = "A"; return $(n);'))).toEqual([]);
    const p = problemasDeReferencias(flujo("const n = 'A'; return [$('A'), $(n)];"));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('mezcla');
  });

  it('cn*() con literal exige nombrar también el nodo con $(\'X\') literal', () => {
    const p = problemasDeReferencias(flujo("return [$('A'), cnNodo('Otro')];"));
    expect(p.some((x) => x.includes('por cn*()'))).toBe(true);
  });

  it('los comentarios no cuentan y las expresiones `={{ }}` sí', () => {
    expect(problemasDeReferencias(flujo("// $('Fantasma')\n/* $('Fantasma') */ return 1;"))).toEqual([]);
    const f = { nodes: [{ name: 'A', parameters: {} }, { name: 'B', parameters: { texto: "={{ $('Fantasma').json.x }}" } }], connections: { A: { main: [[{ node: 'B' }]] } } };
    expect(problemasDeReferencias(f)).toHaveLength(1);
  });

  it('referenciasDeNodos lista literales por nodo', () => {
    const r = referenciasDeNodos(flujo("return $('A');").nodes);
    expect(r.find((x) => x.nodo === 'B')?.literales).toEqual(['A']);
  });

  it('los constructores la importan del core y ya no la llevan copiada', () => {
    for (const c of ['rroca-ruben', 'rroca-emma', 'rroca-evy']) {
      const t = readFileSync(join(RAIZ, `Flujos/experimental/${c}/construir.mjs`), 'utf8');
      expect(t, c).toContain("from '../../src/core/sin-agente/referencias.mjs'");
      expect(t, c).not.toMatch(/const REF_LITERAL/);
      expect(t, c).not.toMatch(/function problemasDeReferencias/);
    }
    const nucleo = readFileSync(join(RAIZ, 'Flujos/src/core/sin-agente/referencias.mjs'), 'utf8');
    expect(nucleo).not.toMatch(/experimental\/|clientes\//);
  });
});
