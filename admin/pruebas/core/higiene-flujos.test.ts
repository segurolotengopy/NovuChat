/**
 * HIGIENE DE LOS JSON DE FLUJOS (F3a, bloque higiene).
 *
 * Dos reglas del repositorio público, hechas cumplir por prueba:
 *   1. Ningún JSON de `Flujos/` (ni de `Flujos/experimental/`) lleva el id de
 *      una credencial de n8n: va `""` y `publicar-flujo.sh` la resuelve por el
 *      nombre que el JSON conserva.
 *   2. Un `REEMPLAZAR_` fuera de `Config base*` y fuera de un `jsCode` (donde
 *      solo aparece dentro de una expresión regular) existe únicamente si el
 *      manifiesto del flujo lo declara en `conservanMarcadores`.
 *
 * Cada regla trae su contraprueba: un JSON en memoria que la viola hace fallar
 * la comprobación y la falla nombra el nodo.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_FLUJOS, leerManifiesto } from '../../scripts/ensamblar-flujo.mjs';

type Nodo = { name: string; parameters?: Record<string, unknown>; credentials?: Record<string, { id?: string; name?: string }> };
type Flujo = { nodes: Nodo[] };

/** Todos los JSON de flujo: los de primer nivel y los de `experimental/`, sin manifiestos, prompts ni módulos. */
function jsonDeFlujos(rel = ''): string[] {
  return readdirSync(join(RAIZ_FLUJOS, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return !rel && ['manifiestos', 'prompts', 'src'].includes(e.name) ? [] : jsonDeFlujos(r);
    return e.name.endsWith('.json') ? [r] : [];
  });
}

/** Nodos con el id de una credencial no vacío, como «nodo (tipo)». */
function nodosConIdDeCredencial(flujo: Flujo): string[] {
  return flujo.nodes.flatMap((n) => Object.entries(n.credentials ?? {})
    .filter(([, ref]) => ref?.id).map(([tipo]) => `${n.name} (${tipo})`));
}

/** Nodos con REEMPLAZAR_ fuera de Config base y de jsCode que el manifiesto no declara. */
function nodosConMarcadorNoDeclarado(flujo: Flujo, declarados: string[]): string[] {
  return flujo.nodes.filter((n) => {
    const { jsCode: _omitido, ...resto } = n.parameters ?? {};
    return JSON.stringify(resto).includes('REEMPLAZAR_') && !n.name.startsWith('Config base') && !declarados.includes(n.name);
  }).map((n) => n.name);
}

const leer = (f: string): Flujo => JSON.parse(readFileSync(join(RAIZ_FLUJOS, f), 'utf8')) as Flujo;
const declaradosDe = (f: string): string[] => {
  if (f.includes('/') || !existsSync(join(RAIZ_FLUJOS, 'manifiestos', f))) return [];
  const m = leerManifiesto(f) as { conservanMarcadores?: Record<string, string> } | null;
  return Object.keys(m?.conservanMarcadores ?? {});
};

const ARCHIVOS = jsonDeFlujos();

describe('Higiene de los flujos: ningún id de credencial', () => {
  it('el inventario incluye los 8 flujos y los de experimental/', () => {
    expect(ARCHIVOS.filter((f) => !f.includes('/')).length).toBe(8);
    expect(ARCHIVOS.some((f) => f.startsWith('experimental/'))).toBe(true);
  });

  for (const f of ARCHIVOS) {
    it(`${f}: ningún nodo con id de credencial`, () => {
      const hallados = nodosConIdDeCredencial(leer(f));
      expect(hallados, `${f}: id de credencial en ${hallados.join(', ')}`).toEqual([]);
    });
  }

  it('contraprueba: un id en un nodo hace fallar y nombra el nodo', () => {
    const flujo: Flujo = { nodes: [{ name: 'Traer configuración', credentials: { httpHeaderAuth: { id: 'abc123', name: 'X' } } }] };
    const hallados = nodosConIdDeCredencial(flujo);
    expect(() => expect(hallados, `nodos con id: ${hallados.join(', ')}`).toEqual([])).toThrow(/Traer configuración/);
  });
});

describe('Higiene de los flujos: REEMPLAZAR_ solo si el manifiesto lo declara', () => {
  // Los de experimental/ son bancos de prueba con sus propios nodos de entrada.
  for (const f of ARCHIVOS.filter((x) => !x.includes('/'))) {
    it(`${f}: todo marcador fuera de Config base está declarado`, () => {
      const hallados = nodosConMarcadorNoDeclarado(leer(f), declaradosDe(f));
      expect(hallados, `${f}: marcador no declarado en ${hallados.join(', ')}`).toEqual([]);
    });
  }

  it('el carrito del Demo B y «¿Es un mensaje?» de la captación están declarados', () => {
    expect(declaradosDe('demo-b-venta-cobro.json')).toContain('Carrito del catálogo');
    expect(declaradosDe('novuchat-onboarding.json')).toContain('¿Es un mensaje?');
  });

  it('contraprueba: un nodo con marcador no declarado hace fallar y se nombra', () => {
    const flujo: Flujo = { nodes: [{ name: 'Nodo suelto', parameters: { url: 'REEMPLAZAR_URL' } }] };
    const hallados = nodosConMarcadorNoDeclarado(flujo, []);
    expect(() => expect(hallados, `marcador no declarado: ${hallados.join(', ')}`).toEqual([])).toThrow(/Nodo suelto/);
    expect(nodosConMarcadorNoDeclarado(flujo, ['Nodo suelto'])).toEqual([]);
  });

  it('contraprueba: un marcador solo dentro de jsCode (regex) no cuenta; en Config base tampoco', () => {
    const flujo: Flujo = { nodes: [
      { name: 'Código', parameters: { jsCode: '/REEMPLAZAR_/.test(x)' } },
      { name: 'Config base', parameters: { v: 'REEMPLAZAR_X' } },
    ] };
    expect(nodosConMarcadorNoDeclarado(flujo, [])).toEqual([]);
  });
});
