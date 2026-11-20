/**
 * `scripts/resetear-telefono.sh`: el ÚNICO reinicio, sin variables a mano (Andres, 20/11/2026). Se prueba lo que decide el envoltorio:
 * la lista blanca sale de la tabla local, y un teléfono que no está ahí NO se resetea. El reseteo en sí lo prueba resetear-telefono-prueba.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/resetear-telefono.sh');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function correr(filas: string[], args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'novuchat-reset-')); dirs.push(dir);
  writeFileSync(join(dir, 'tabla.md'), ['| Marcador | Valor |', '|---|---|', ...filas].join('\n') + '\n');
  return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, CONFIG_LOCAL_MD: join(dir, 'tabla.md'), RESETEAR_SOLO_LISTA: '1' } });
}
const TEL = '59170000001';

describe('resetear-telefono.sh: la lista blanca sale de la tabla local', () => {
  it('un teléfono de la fila general pasa, sin imprimir ningún número', () => {
    const r = correr([`| \`REEMPLAZAR_TELEFONOS_DE_PRUEBA\` | ${TEL},59170000002 |`], ['--tenant', 'walisuma', '--tel', TEL]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(TEL);
  });
  it('la fila del comercio suma teléfonos solo para ESE comercio', () => {
    const filas = ['| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_RROCA_RUBEN` | 59170000003 |'];
    expect(correr(filas, ['--tenant', 'rroca-ruben', '--tel', '59170000003']).status).toBe(0);
    expect(correr(filas, ['--tenant', 'walisuma', '--tel', '59170000003']).status).toBe(1);
  });
  it('NEGADO: un teléfono que no está en la tabla no se resetea', () => {
    const r = correr([`| \`REEMPLAZAR_TELEFONOS_DE_PRUEBA\` | ${TEL} |`], ['--tenant', 'walisuma', '--tel', '59179999999']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NO está en la lista blanca/);
  });
  it('NEGADO: sin fila de teléfonos, o con la fila «pendiente», no corre', () => {
    expect(correr([], ['--tenant', 'walisuma', '--tel', TEL]).status).toBe(1);
    expect(correr([`| \`REEMPLAZAR_TELEFONOS_DE_PRUEBA\` | ${TEL} (pendiente) |`], ['--tenant', 'walisuma', '--tel', TEL]).status).toBe(1);
  });
  it('NEGADO: tenant o teléfono con forma inválida', () => {
    const f = [`| \`REEMPLAZAR_TELEFONOS_DE_PRUEBA\` | ${TEL} |`];
    expect(correr(f, ['--tenant', '../x', '--tel', TEL]).status).toBe(2);
    expect(correr(f, ['--tenant', 'walisuma', '--tel', '12ab']).status).toBe(2);
    expect(correr(f, ['--tenant', 'walisuma']).status).toBe(2);
  });
});
