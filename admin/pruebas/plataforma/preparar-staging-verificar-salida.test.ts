/**
 * `scripts/preparar-staging.sh verificar`: el código de salida refleja las fallas. Con al menos un ✗ termina
 * distinto de 0, sin cortar a mitad (se listan todas las comprobaciones, también las posteriores a la falla);
 * sin ningún ✗ termina en 0. Con un `gcloud` y un `gh` FALSOS (sin red ni nube).
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
const NUMERO = '987654321';
const PERM = 'secretmanager.versions.list';
const MIEMBRO = `serviceAccount:sa-deploy-staging@${STAGING}.iam.gserviceaccount.com`;
const ROL = `projects/${STAGING}/roles/desplegadorSecretos`;
const expr = (prefijos: string[]) => prefijos.map((p) => `resource.name.startsWith("projects/${NUMERO}/secrets/${p}")`).join(' || ');
const TODOS = ['INGESTA_', 'GEMINI_API_KEY', 'COBRADOR_', 'SALIDA_PERSONA_', 'ALERTAS_', 'NOVUTIENDA_'];

// `ACCESO_SECRETOS` fija lo que devuelve el Troubleshooter para ese permiso; `ACCESO_OTROS`, para los demás.
// `projects get-iam-policy` devuelve el archivo `proyecto.json` del directorio falso.
const GCLOUD_FALSO = `#!/usr/bin/env bash
c="$*"
case "$c" in
  *"projects describe"*) echo "${NUMERO}" ;;
  *"projects get-iam-policy"*) cat "$FAKE_DIR/proyecto.json" ;;
  *"policy-troubleshoot iam"*"--permission=${PERM}"*) printf '%s' "$ACCESO_SECRETOS" ;;
  *"policy-troubleshoot iam"*) printf '%s' "\${ACCESO_OTROS:-GRANTED}" ;;
  *) : ;;
esac
`;
const GH_FALSO = `#!/usr/bin/env bash
echo ejemplo
`;

let dir: string;
function politica(bindings: unknown[]) {
  writeFileSync(join(dir, 'proyecto.json'), JSON.stringify({ etag: 'x', version: 3, bindings }));
}
const bindingCon = (prefijos: string[]) => ({ role: ROL, members: [MIEMBRO], condition: { title: 'secretos-de-las-functions', expression: expr(prefijos) } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'preparar-staging-vc-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin); mkdirSync(join(dir, 'tmp'));
  for (const [n, t] of [['gcloud', GCLOUD_FALSO], ['gh', GH_FALSO]] as const) { writeFileSync(join(bin, n), t); chmodSync(join(bin, n), 0o755); }
  politica([bindingCon(TODOS)]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(acceso: string, otros = 'GRANTED') {
  const r = spawnSync('bash', [SCRIPT, 'verificar', '--proyecto', STAGING], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, FAKE_DIR: dir, ACCESO_SECRETOS: acceso, ACCESO_OTROS: otros, CLOUDSDK_CONFIG: join(dir, 'gcloud'), TMPDIR: join(dir, 'tmp'), XDG_RUNTIME_DIR: '' }),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

describe('preparar-staging.sh verificar: código de salida', () => {
  it('sin fallas: sale 0', () => {
    const r = correr('GRANTED');
    expect(r.salida).not.toContain('✗');
    expect(r.codigo).toBe(0);
  });
  it('solo un aviso (⚠, UNKNOWN_CONDITIONAL con el binding completo): sale 0', () => {
    const r = correr('UNKNOWN_CONDITIONAL');
    expect(r.salida).toContain('⚠');
    expect(r.codigo).toBe(0);
  });
  it('una falla en el primer permiso: sale distinto de 0 y aun así lista todas las comprobaciones', () => {
    const r = correr('DENIED');
    expect(r.salida).toContain(`sa-deploy-staging: ${PERM} → DENIED`);
    expect(r.codigo).not.toBe(0);
    // Comprobaciones posteriores a la falla: el último permiso se muestra y la verificación no se cortó.
    expect(r.salida).toContain('sa-deploy-staging: eventarc.triggers.create');
    expect(r.salida).toContain('sa-deploy-staging: firebasehosting.sites.update');
  });
  it('varias fallas (binding ausente y permisos denegados): sale distinto de 0 y las cuenta', () => {
    politica([{ role: 'roles/run.admin', members: [MIEMBRO] }]);
    const r = correr('UNKNOWN_CONDITIONAL', 'DENIED');
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('la condición de desplegadorSecretos NO cubre');
    expect(r.salida).toContain('sa-deploy-staging: eventarc.triggers.create → DENIED');
    expect(r.salida).toMatch(/verificación con \d+ falla/);
  });
});
