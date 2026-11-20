/**
 * publicar-flujo.sh y el codigo HTTP de curl (20/11/2026): `curl -w '%{http_code}' || echo 000` concatenaba el 200 que curl ya
 * habia impreso con el «000» del respaldo cuando curl salia con error (p. ej. 28, tiempo agotado leyendo un flujo de 1,8 MB):
 * «HTTP 200000». Se prueba con un curl de mentira: imprime 200 y sale con 28. Escrito negando: nunca «200000».
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(RAIZ, 'scripts/publicar-flujo.sh');
const FLUJO = 'Flujos/clientes/casa-bermejo/casa-bermejo.json';
const carpeta = mkdtempSync(join(tmpdir(), 'pf-curl-'));
afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

function correr(salidaDeCurl: string, codigoDeSalida: number): { out: string } {
  const bin = join(carpeta, `bin-${codigoDeSalida}`);
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\ncat >/dev/null\nprintf '${salidaDeCurl}'\nexit ${codigoDeSalida}\n`);
  chmodSync(join(bin, 'curl'), 0o755);
  const env = join(carpeta, `env-${codigoDeSalida}`);
  writeFileSync(env, 'N8N_API_KEY=clave-de-mentira\nN8N_BASE_URL=http://n8n.invalid\nN8N_WORKFLOW_ID=abc\n');
  const r = spawnSync('bash', [SCRIPT, '--env', relative(RAIZ, env), '--flujo', FLUJO], {
    cwd: RAIZ, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env['PATH']}` },
  });
  return { out: `${r.stdout}${r.stderr}` };
}

describe('publicar-flujo.sh: codigo HTTP de curl', () => {
  it('curl que imprime 200 y sale con error 28: dice HTTP 000 y el codigo de salida, nunca «200000»', () => {
    const { out } = correr('200', 28);
    expect(out).not.toContain('200000');
    expect(out).toContain('HTTP 000');
    expect(out).toContain('codigo 28');
  });
  it('curl que sale bien con 404: informa el 404 tal cual', () => {
    const { out } = correr('404', 0);
    expect(out).toContain('HTTP 404');
  });
  it('ninguna llamada usa el respaldo «|| echo 000» que concatenaba', () => {
    const lineas = readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('#'));
    expect(lineas.filter((l) => l.includes('|| echo 000'))).toEqual([]);
  });
});
