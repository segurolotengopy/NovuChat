/**
 * NÚCLEO COMÚN (cierre de la rearquitectura, condiciones 2 y 3).
 *
 *  - Lista cerrada de variantes de los 5 nodos comunes: hoy hay 3 por nodo
 *    (reservas en `core/`, `venta/`, `captacion/`), documentadas en
 *    `Flujos/src/core/VARIANTES.md`. La lista no puede CRECER sin declararse;
 *    cuando una rebanada unifique un nodo, esta lista se achica en el mismo PR.
 *  - Cada variante la usa algún manifiesto (no quedan huérfanas).
 *  - Toda copia incluida en `Flujos/clientes/<tenant>/` de un archivo de core
 *    es idéntica byte a byte (`Flujos/clientes/` ya existe; la regla es sobre sus `.js`).
 *  - M4 de la migración (etapa 0, 12/11/2026): en TODO flujo de producción descubierto del disco, cada nodo
 *    común presente (los 5 del núcleo más «Carga de entrada» y «Puerta del turno») INCLUYE una variante declarada
 *    de `Flujos/src/core`, o tiene una excepción en `migracion/excepciones.ts`.
 * Cada regla trae su contraprueba.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAIZ_FLUJOS, listarFlujos, leerManifiesto } from '../../scripts/ensamblar-flujo.mjs';
import type { Flujo } from '../lib/flujo';
import { CARPETA_FLUJOS_DEL_REPO, flujosDeProduccion } from '../lib/flujos-de-cliente';
import { NODOS_COMUNES, hallazgosM4, incluyeVariante, variantesDeNodo } from './migracion/comprobaciones';
import { problemasDeRegla } from './migracion/excepciones';

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

// ---------------------------------------------------------------------------
// M4 de la migración: los nodos comunes de cada flujo incluyen una variante declarada
// ---------------------------------------------------------------------------

const leerFlujoDeProduccion = (ruta: string): Flujo => JSON.parse(readFileSync(join(CARPETA_FLUJOS_DEL_REPO, ruta), 'utf8')) as Flujo;
const nodoCode = (name: string, jsCode: string) => ({ name, type: 'n8n-nodes-base.code', parameters: { jsCode } });
const flujoCon = (...nodes: ReturnType<typeof nodoCode>[]): Flujo => ({ nodes, connections: {} }) as unknown as Flujo;

describe('M4: cada nodo común de un flujo incluye una variante declarada de core, o tiene excepción', () => {
  it('son siete nodos comunes: los 5 del núcleo tienen sus 3 variantes; «Carga de entrada» y «Puerta del turno» no tienen ninguna en core', () => {
    expect(NODOS_COMUNES).toHaveLength(7);
    for (const n of NODOS_COMUNES.slice(0, 5)) expect(variantesDeNodo(n), n).toHaveLength(3);
    for (const n of NODOS_COMUNES.slice(5)) expect(variantesDeNodo(n), n).toEqual([]);
  });

  it('todo flujo de producción del disco (experimental/ o clientes/) está cubierto: sin violación sin excepción y sin excepción que sobre', () => {
    const produccion = flujosDeProduccion();
    expect(produccion.length).toBeGreaterThan(20);
    const hoy = new Map(produccion.map((a) => [a, hallazgosM4(leerFlujoDeProduccion(a))]));
    expect(problemasDeRegla('nucleo-comun', hoy)).toEqual([]);
  });

  it('contraprueba: un byte alterado en el sufijo falla; el idéntico (con o sin salto final) y el que termina en la variante pasan', () => {
    const [v] = variantesDeNodo('Uso extendido');
    const variante = v as string;
    expect(incluyeVariante(variante, [variante])).toBe(true);
    expect(incluyeVariante(variante.replace(/\n$/, ''), [variante])).toBe(true);
    expect(incluyeVariante(`const LIB = 1;\n${variante}`, [variante])).toBe(true);
    const alterada = `${variante.slice(0, -5)}X${variante.slice(-4)}`;
    expect(incluyeVariante(alterada, [variante])).toBe(false);
    expect(incluyeVariante(`const LIB = 1;\n${alterada}`, [variante])).toBe(false);
    expect(incluyeVariante('', [variante])).toBe(false);
    expect(incluyeVariante(variante, [])).toBe(false);
  });

  it('contraprueba: hallazgosM4 nombra el nodo alterado y el que no tiene variante, y deja pasar al idéntico y al ausente', () => {
    const [v] = variantesDeNodo('Normalizar entrada');
    const variante = v as string;
    expect(hallazgosM4(flujoCon(nodoCode('Normalizar entrada', variante)))).toEqual([]);
    expect(hallazgosM4(flujoCon(nodoCode('Normalizar entrada', `${variante}// x`)))).toEqual(['Normalizar entrada']);
    expect(hallazgosM4(flujoCon(nodoCode('Carga de entrada', 'return [];')))).toEqual(['Carga de entrada']);
    expect(hallazgosM4(flujoCon(nodoCode('Otro nodo', 'return [];')))).toEqual([]);
  });

  it('contraprueba: sin excepción la violación falla; con excepción pasa; una excepción de un flujo que ya cumple sobra', () => {
    const exc = { 'a.json#nucleo-comun#Normalizar entrada': { dueno: 'x', vence: '2027-01-31', motivo: 'm', desde: '2026-11-12' } };
    expect(problemasDeRegla('nucleo-comun', new Map([['a.json', ['Normalizar entrada']]]), {})).toHaveLength(1);
    expect(problemasDeRegla('nucleo-comun', new Map([['a.json', ['Normalizar entrada']]]), exc)).toEqual([]);
    expect(problemasDeRegla('nucleo-comun', new Map([['a.json', []]]), exc)).toEqual([expect.stringContaining('SOBRA')]);
    expect(problemasDeRegla('nucleo-comun', new Map([['b.json', []]]), exc)).toEqual([expect.stringContaining('no existe')]);
  });
});
