/**
 * `scripts/preparar-staging.sh verificar`: `UNKNOWN_CONDITIONAL` de Policy Troubleshooter para
 * `secretmanager.versions.list` no es un fallo (la condición IAM del binding de desplegadorSecretos no se evalúa
 * sin contexto de recurso; la cubre la comprobación del binding). Cualquier otro valor distinto de GRANTED
 * (DENIED, vacío) sigue siendo ✗. Con un `gcloud` y un `gh` FALSOS (sin red ni nube).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'preparar-staging.sh');
const STAGING = 'prueba-stg-vc1';
const PERM = 'secretmanager.versions.list';

// `ACCESO_SECRETOS` fija lo que devuelve el Troubleshooter para ese permiso; `ACCESO_OTROS`, para los demás.
const GCLOUD_FALSO = `#!/usr/bin/env bash
c="$*"
case "$c" in
  *"projects describe"*) echo "987654321" ;;
  *"policy-troubleshoot iam"*"--permission=${PERM}"*) printf '%s' "$ACCESO_SECRETOS" ;;
  *"policy-troubleshoot iam"*) printf '%s' "\${ACCESO_OTROS:-GRANTED}" ;;
  *) : ;;
esac
`;
const GH_FALSO = `#!/usr/bin/env bash
echo ejemplo
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'preparar-staging-vc-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin); mkdirSync(join(dir, 'tmp'));
  for (const [n, t] of [['gcloud', GCLOUD_FALSO], ['gh', GH_FALSO]] as const) { writeFileSync(join(bin, n), t); chmodSync(join(bin, n), 0o755); }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function verificar(acceso: string, otros = 'GRANTED') {
  const r = spawnSync('bash', [SCRIPT, 'verificar', '--proyecto', STAGING], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, ACCESO_SECRETOS: acceso, ACCESO_OTROS: otros, CLOUDSDK_CONFIG: join(dir, 'gcloud'), TMPDIR: join(dir, 'tmp'), XDG_RUNTIME_DIR: '' }),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const linea = (salida: string, perm: string) => salida.split('\n').find((l) => l.includes(`sa-deploy-staging: ${perm}`)) ?? '';

describe('preparar-staging.sh verificar: permisos con condición', () => {
  it('GRANTED: ✓', () => {
    const l = linea(verificar('GRANTED').salida, PERM);
    expect(l).toContain('✓');
    expect(l).not.toContain('✗');
  });
  it('UNKNOWN_CONDITIONAL: ⚠ con el motivo, ni ✗ ni cambio del código de salida', () => {
    const base = verificar('GRANTED');
    const r = verificar('UNKNOWN_CONDITIONAL');
    const l = linea(r.salida, PERM);
    expect(l).toContain('⚠');
    expect(l).toContain('condición no evaluable por Policy Troubleshooter');
    expect(l).toContain('la cubre la comprobación del binding de arriba');
    expect(l).not.toContain('✗');
    expect(r.codigo).toBe(base.codigo);
  });
  it('DENIED: ✗', () => {
    const l = linea(verificar('DENIED').salida, PERM);
    expect(l).toContain('✗');
    expect(l).toContain('DENIED');
    expect(l).not.toContain('⚠');
  });
  it('salida vacía: ✗ desconocido', () => {
    const l = linea(verificar('').salida, PERM);
    expect(l).toContain('✗');
    expect(l).toContain('desconocido');
  });
  it('UNKNOWN_CONDITIONAL en un permiso que no es secretmanager.versions.list sigue siendo ✗', () => {
    const l = linea(verificar('GRANTED', 'UNKNOWN_CONDITIONAL').salida, 'run.services.update');
    expect(l).toContain('✗');
    expect(l).not.toContain('⚠');
  });
});
