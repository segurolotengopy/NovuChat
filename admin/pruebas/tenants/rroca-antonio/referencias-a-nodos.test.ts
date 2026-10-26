/**
 * REFERENCIAS A NODOS del flujo de Antonio (PR-C). Reutiliza (IMPORTA, no copia) la lógica de `rroca-ruben/construir.mjs`: todo literal `$('…')` nombra un nodo que existe y es antecesor.
 * Desde el corte de nodos de la fase 2 (que reemplazó «¿Falló la protección?» por «Avisar al servidor») NO queda ningún hallazgo permitido: la lista es VACÍA.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo } from '../../lib/flujo';
// @ts-expect-error el armador es un .mjs sin tipos
import { problemasDeReferencias, referenciasDeNodos } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-antonio');
const leer = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
const copia = (f: Flujo): Flujo => JSON.parse(JSON.stringify(f)) as Flujo;
const hallazgos = (f: Flujo): string[] => (problemasDeReferencias(f) as string[]);

describe('Antonio: referencias a nodos', () => {
  for (const archivo of ['rroca-antonio.json', 'rroca-antonio.prueba.json']) {
    it(`${archivo}: cero hallazgos (ninguna excepción)`, () => {
      expect(hallazgos(leer(archivo))).toEqual([]);
      expect((referenciasDeNodos(leer(archivo).nodes) as Array<{ literales: string[] }>).reduce((n, r) => n + r.literales.length, 0)).toBeGreaterThan(5);
    });
  }

  it('NEGANDO: literal a un nodo inexistente, a un no antecesor distinto y $(nombre) dinámico junto a un literal dan hallazgo', () => {
    const f = copia(leer('rroca-antonio.json'));
    const n = f.nodes.find((x) => x.name === 'Armar mensajes')!;
    n.parameters['jsCode'] += "\nconst a = $('Nodo fantasma').first();";
    expect(hallazgos(f).join('|')).toMatch(/«Armar mensajes» nombra «Nodo fantasma», que NO existe/);
    const g = copia(leer('rroca-antonio.json'));
    g.nodes.find((x) => x.name === 'Normalizar entrada')!.parameters['jsCode'] += "\nconst b = $('Armar mensajes').first();";
    expect(hallazgos(g).join('|')).toMatch(/«Normalizar entrada» nombra «Armar mensajes», que existe pero NO es su antecesor/);
    const h = copia(leer('rroca-antonio.json'));
    h.nodes.find((x) => x.name === 'Normalizar entrada')!.parameters['jsCode'] += "\nconst c = $('Config del negocio'); const d = $(nombre);";
    expect(hallazgos(h).join('|')).toMatch(/«Normalizar entrada» mezcla referencias literales con referencias dinámicas/);
  });
});
