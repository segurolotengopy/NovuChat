import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '../../scripts/preparar-import.sh');
const temporales: string[] = [];
afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

/** Corre el script con una tabla de juguete y un flujo cuyo único dato es `valor`. */
function correr(valor: string, filas: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'novuchat-compuesto-'));
  temporales.push(dir);
  writeFileSync(join(dir, 'tabla.md'), ['| Marcador | Valor |', '|---|---|', ...filas].join('\n') + '\n');
  writeFileSync(join(dir, 'env'), 'N8N_BASE_URL=http://localhost\n');
  const flujo = join(dir, 'flujo.json');
  writeFileSync(flujo, JSON.stringify({
    name: 'prueba', settings: { executionOrder: 'v1' }, connections: {},
    nodes: [{ id: 'n1', name: 'Dato', type: 'n8n-nodes-base.set', typeVersion: 1, position: [0, 0], parameters: { valor } }],
  }));
  const r = spawnSync('bash', [SCRIPT, flujo, join(dir, 'env')], {
    encoding: 'utf8', env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(dir, 'tabla.md') }),
  });
  const salida = join(dir, 'flujo.local.json');
  return { r, texto: () => readFileSync(salida, 'utf8') };
}

describe('`preparar-import.sh` repone los marcadores de un dato compuesto', () => {
  const compuesto = 'REEMPLAZAR_ANUNCIO_A:general|REEMPLAZAR_ANUNCIO_B:llavero,bolso';

  it('cada marcador separado por `:` `|` `,` toma el valor de su propia fila', () => {
    const { r, texto } = correr(compuesto, ['| `REEMPLAZAR_ANUNCIO_A` | 100000000001 |', '| `REEMPLAZAR_ANUNCIO_B` | 200000000002 |']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const v = (JSON.parse(texto()) as { nodes: { parameters: { valor: string } }[] }).nodes[0]!.parameters.valor;
    expect(v).toBe('100000000001:general|200000000002:llavero,bolso');
  });

  it('si falta la fila de UNO, sale 1 y dice cuál (no por prefijo)', () => {
    const { r } = correr(compuesto, ['| `REEMPLAZAR_ANUNCIO_A` | 100000000001 |']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('REEMPLAZAR_ANUNCIO_B');
    expect(r.stdout).not.toContain('REEMPLAZAR_ANUNCIO_A —');
  });
});
