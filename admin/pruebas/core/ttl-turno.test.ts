/**
 * F3b PR-3: el vencimiento (TTL) de las tres colecciones del estado de la conversación.
 *
 * Lee `firestore.indexes.json` real. Se defiende:
 *  - `vence` tiene política de TTL en los tres grupos de colección.
 *  - `estadoJson` queda exento de índice (cadena opaca de hasta 16 KiB).
 *  - `por` NO se exenta: `asentar` consulta por `por.<id>.cantidad` y necesita el índice automático.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Reemplazo { collectionGroup: string; fieldPath: string; ttl?: boolean; indexes: unknown[] }

const aqui = dirname(fileURLToPath(import.meta.url));
const { fieldOverrides } = JSON.parse(
  readFileSync(join(aqui, '..', '..', 'firestore.indexes.json'), 'utf8'),
) as { fieldOverrides: Reemplazo[] };

const GRUPOS = ['sesionesDeTurno', 'vistosDeTurno', 'cuposDeTurno'];

describe('TTL del estado de la conversación', () => {
  it.each(GRUPOS)('%s: `vence` tiene TTL', (g) => {
    const o = fieldOverrides.filter((x) => x.collectionGroup === g && x.fieldPath === 'vence');
    expect(o).toHaveLength(1);
    expect(o[0]?.ttl).toBe(true);
  });

  it('`estadoJson` está exento de índice', () => {
    const o = fieldOverrides.find((x) => x.collectionGroup === 'sesionesDeTurno' && x.fieldPath === 'estadoJson');
    expect(o?.indexes).toEqual([]);
  });

  it('NEGATIVA: ningún grupo del estado exenta `por` (asentar lo consulta)', () => {
    const exentos = fieldOverrides.filter((x) => GRUPOS.includes(x.collectionGroup)
      && (x.fieldPath === 'por' || x.fieldPath.startsWith('por.')) && x.indexes.length === 0);
    expect(exentos).toEqual([]);
  });

  it('NEGATIVA: `vence` no queda con el índice apagado en ningún grupo', () => {
    for (const g of GRUPOS) {
      const o = fieldOverrides.find((x) => x.collectionGroup === g && x.fieldPath === 'vence');
      expect(o?.indexes.length ?? 0).toBeGreaterThan(0);
    }
  });
});
