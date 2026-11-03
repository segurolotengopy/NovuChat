/**
 * NÚCLEO COMÚN (cierre de la rearquitectura, condiciones 2 y 3).
 *
 *  - Lista cerrada de variantes de los 5 nodos comunes: hoy hay 3 por nodo
 *    (reservas en `core/`, `venta/`, `captacion/`), documentadas en
 *    `Flujos/src/core/VARIANTES.md`. La lista no puede CRECER sin declararse;
 *    cuando una rebanada unifique un nodo, esta lista se achica en el mismo PR.
 *  - Cada variante la usa algún manifiesto (no quedan huérfanas).
 *  - Toda copia incluida en `Flujos/clientes/<tenant>/` de un archivo de core
 *    es idéntica byte a byte (hoy no hay carpeta de clientes: pasa vacía).
 * Cada regla trae su contraprueba.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAIZ_FLUJOS, listarFlujos, leerManifiesto } from '../../scripts/ensamblar-flujo.mjs';

const NODOS = ['normalizar-entrada', 'config-del-negocio', 'procesar-respuesta', 'uso-extendido', 'comercio-no-operativo'];
const VARIANTES_DECLARADAS = NODOS.flatMap((n) => [`core/${n}.js`, `core/venta/${n}.js`, `core/captacion/${n}.js`]).sort();

const SRC = join(RAIZ_FLUJOS, 'src');

function recorrer(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? recorrer(join(dir, e.name), r) : [r];
  });
}

/** Archivos de core que son una variante de alguno de los 5 nodos comunes. */
function variantesEnDisco(): string[] {
  return recorrer(join(SRC, 'core'), 'core')
    .filter((r) => NODOS.some((n) => r.endsWith(`/${n}.js`)))
    .sort();
}

/** Copias en clientes que difieren byte a byte de su homónimo de core. */
function copiasDistintas(carpetaClientes: string, carpetaCore: string): string[] {
  const core = new Map(recorrer(carpetaCore).map((r) => [r.split('/').pop()!, join(carpetaCore, r)]));
  return recorrer(carpetaClientes)
    .filter((r) => r.endsWith('.js') && core.has(r.split('/').pop()!))
    .filter((r) => !readFileSync(join(carpetaClientes, r)).equals(readFileSync(core.get(r.split('/').pop()!)!)))
    .sort();
}

function archivosDe(e: unknown): string[] {
  const a = typeof e === 'string' ? e : (e as { archivo?: unknown })?.archivo;
  return ([] as unknown[]).concat(a ?? []).filter((x): x is string => typeof x === 'string');
}

describe('núcleo común: lista cerrada de variantes', () => {
  it('las variantes en disco son exactamente las declaradas (no crecen sin declararse)', () => {
    expect(variantesEnDisco()).toEqual(VARIANTES_DECLARADAS);
  });

  it('contraprueba: una variante extra o una faltante hace fallar la comparación', () => {
    expect([...variantesEnDisco(), 'core/otra/uso-extendido.js'].sort()).not.toEqual(VARIANTES_DECLARADAS);
    expect(variantesEnDisco().slice(1)).not.toEqual(VARIANTES_DECLARADAS);
  });

  it('cada variante la usa algún manifiesto', () => {
    const usadas = new Set<string>();
    for (const f of listarFlujos()) {
      const m = leerManifiesto(f) as { codigo?: Record<string, unknown> } | null;
      for (const e of Object.values(m?.codigo ?? {})) for (const a of archivosDe(e)) usadas.add(a);
    }
    expect(VARIANTES_DECLARADAS.filter((v) => !usadas.has(v))).toEqual([]);
  });

  it('documenta el inventario', () => {
    expect(existsSync(join(SRC, 'core', 'VARIANTES.md'))).toBe(true);
  });
});

describe('núcleo común: copias incluidas idénticas a core, byte a byte', () => {
  it('Flujos/clientes/<tenant>/ no tiene copias distintas de core', () => {
    expect(copiasDistintas(join(RAIZ_FLUJOS, 'clientes'), join(SRC, 'core'))).toEqual([]);
  });

  it('contraprueba: una copia alterada se detecta y una idéntica no', () => {
    const t = mkdtempSync(join(tmpdir(), 'nucleo-'));
    try {
      mkdirSync(join(t, 'core'));
      mkdirSync(join(t, 'clientes', 'x'), { recursive: true });
      writeFileSync(join(t, 'core', 'uso-extendido.js'), 'return 1;\n');
      writeFileSync(join(t, 'clientes', 'x', 'uso-extendido.js'), 'return 1;\n');
      expect(copiasDistintas(join(t, 'clientes'), join(t, 'core'))).toEqual([]);
      writeFileSync(join(t, 'clientes', 'x', 'uso-extendido.js'), 'return 2;\n');
      expect(copiasDistintas(join(t, 'clientes'), join(t, 'core'))).toEqual(['x/uso-extendido.js']);
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });
});
