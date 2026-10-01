// Google Calendar «Obtener varios» (getAll, typeVersion 1.3): `timeMin` y `timeMax` son parámetros del NODO,
// no de `options`. Dentro de `options` n8n los ignora: la consulta no tiene ventana. La cartera lo midió el
// 01/10/2026 contra n8n: «citas de mañana» con las fechas en `options` devolvió 5 eventos (uno a 3 días);
// con las fechas en el nodo, 4 (solo mañana). Consecuencias reales: los recordatorios del Demo A alcanzaban a
// todas las citas futuras, y la consulta del candado traía hasta 50 eventos de toda la cuenta, de modo que con
// más de 50 el candado podía no ver un cruce.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos');

function jsonDe(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const r = join(dir, e);
    if (statSync(r).isDirectory()) return e === 'node_modules' ? [] : jsonDe(r);
    return r.endsWith('.json') ? [r] : [];
  });
}

type Nodo = { name: string; type: string; typeVersion?: number; parameters: Record<string, unknown> };

const nodosGetAll: { archivo: string; nodo: Nodo }[] = [];
for (const archivo of jsonDe(RAIZ)) {
  let flujo: { nodes?: Nodo[] };
  try { flujo = JSON.parse(readFileSync(archivo, 'utf8')); } catch { continue; }
  for (const nodo of flujo.nodes ?? []) {
    if (nodo.type === 'n8n-nodes-base.googleCalendar' && nodo.typeVersion === 1.3 && nodo.parameters['operation'] === 'getAll') {
      nodosGetAll.push({ archivo: archivo.slice(RAIZ.length + 1), nodo });
    }
  }
}

describe('Google Calendar getAll 1.3: las fechas van en el nodo, no en options', () => {
  it('hay nodos que revisar (si no, la prueba no mira nada)', () => {
    expect(nodosGetAll.length).toBeGreaterThanOrEqual(5);
  });
  for (const { archivo, nodo } of nodosGetAll) {
    it(`${archivo} · «${nodo.name}»: timeMin y timeMax son parámetros del nodo`, () => {
      expect(nodo.parameters['timeMin'], 'timeMin en el nodo').toBeTruthy();
      expect(nodo.parameters['timeMax'], 'timeMax en el nodo').toBeTruthy();
    });
    it(`NIEGA ${archivo} · «${nodo.name}»: ni timeMin ni timeMax solo dentro de options`, () => {
      const o = (nodo.parameters['options'] ?? {}) as Record<string, unknown>;
      for (const clave of ['timeMin', 'timeMax']) {
        if (clave in o) expect(nodo.parameters[clave], `${clave} está en options; tiene que estar también en el nodo`).toBeTruthy();
      }
    });
  }
});
