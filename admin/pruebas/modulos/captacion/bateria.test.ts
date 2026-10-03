/**
 * LA BATERÍA DE CAPTACIÓN (`admin/scripts/modulos/captacion/bateria.mjs`), en seco.
 * Escrito negando: `--antes` ejecuta el código de un commit, así que solo acepta
 * un sha; y `--seco` no necesita ninguna clave ni llama a nada.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '../../../..');
const correr = (...args: string[]) => spawnSync(process.execPath, ['admin/scripts/modulos/captacion/bateria.mjs', '--seco', '--n', '1', ...args],
  { cwd: RAIZ, encoding: 'utf8', timeout: 60_000, env: entornoDelEmulador(undefined) });

describe('bateria.mjs --antes', () => {
  it('NEGANDO: un valor que no es un sha (una opción de git, una ruta, mayúsculas, vacío) se rechaza antes de tocar git', () => {
    for (const v of ['--output=/tmp/x', '--upload-pack=x', 'HEAD', 'main', '../x', 'ABCDEF1', 'abc12', 'g'.repeat(8), 'a'.repeat(41)]) {
      const r = correr('--casos', 'C5', '--antes', v);
      expect(r.status, v).toBe(2);
      expect(r.stderr, v).toMatch(/--antes debe ser un sha/);
      expect(r.stdout, v).not.toMatch(/=== ANTES/);
    }
  });

  it('un sha válido corre las dos versiones, en seco y sin ninguna clave en el entorno', () => {
    const r = correr('--casos', 'C5', '--antes', '99173a7');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/=== ANTES \(99173a7\)/);
    expect(r.stdout).toMatch(/SECO/);
    expect(r.stdout).not.toMatch(/Clave del modelo/);
  });
});
