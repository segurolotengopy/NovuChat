/**
 * `scripts/preparar-staging.sh verificar`: `UNKNOWN_CONDITIONAL` de Policy Troubleshooter para
 * `secretmanager.versions.list` solo es un aviso (⚠) si, EN LA MISMA CORRIDA, el binding
 * «secretos-de-las-functions» existe completo (título, rol, miembro y los seis prefijos). Sin el binding, o con el
 * binding incompleto, es ✗. Cualquier otro valor distinto de GRANTED (DENIED, NOT_GRANTED, UNKNOWN_INFO_DENIED,
 * vacío) sigue siendo ✗. Con un `gcloud` y un `gh` FALSOS (sin red ni nube).
 *
 * `falla()` no acumula ni cambia el código de salida de `verificar`: este PR no lo toca, por eso no se prueba.
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

function verificar(acceso: string, otros = 'GRANTED') {
  const r = spawnSync('bash', [SCRIPT, 'verificar', '--proyecto', STAGING], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, FAKE_DIR: dir, ACCESO_SECRETOS: acceso, ACCESO_OTROS: otros, CLOUDSDK_CONFIG: join(dir, 'gcloud'), TMPDIR: join(dir, 'tmp'), XDG_RUNTIME_DIR: '' }),
  });
  return `${r.stdout}${r.stderr}`;
}
const linea = (salida: string, perm: string) => salida.split('\n').find((l) => l.includes(`sa-deploy-staging: ${perm}`)) ?? '';
const esAviso = (l: string) => l.includes('⚠') && !l.includes('✗');
const esFallo = (l: string) => l.includes('✗') && !l.includes('⚠');

describe('preparar-staging.sh verificar: permisos con condición', () => {
  it('GRANTED: ✓', () => {
    const l = linea(verificar('GRANTED'), PERM);
    expect(l).toContain('✓');
    expect(l).not.toContain('✗');
    expect(l).not.toContain('⚠');
  });
  it('UNKNOWN_CONDITIONAL con el binding completo: ⚠ con el motivo, sin ✗', () => {
    const l = linea(verificar('UNKNOWN_CONDITIONAL'), PERM);
    expect(esAviso(l)).toBe(true);
    expect(l).toContain('condición no evaluable por Policy Troubleshooter');
    expect(l).toContain('la cubre la comprobación del binding de arriba');
  });
  it('(a) UNKNOWN_CONDITIONAL sin el binding: ✗', () => {
    politica([{ role: 'roles/run.admin', members: [MIEMBRO] }]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
  });
  it('(b) binding con ALERTAS_ pero sin INGESTA_: ✗, no ⚠', () => {
    politica([bindingCon(TODOS.filter((p) => p !== 'INGESTA_'))]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
    politica([bindingCon(['ALERTAS_'])]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
  });
  it('binding completo pero de otra cuenta, con otro rol o con otro título: ✗', () => {
    const b = bindingCon(TODOS);
    politica([{ ...b, members: [`serviceAccount:otra@${STAGING}.iam.gserviceaccount.com`] }]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
    politica([{ ...b, role: 'roles/run.admin' }]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
    politica([{ ...b, condition: { ...b.condition, title: 'otra' } }]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
  });
  it('otro número de proyecto en la condición: ✗', () => {
    const otro = expr(TODOS).replaceAll(`projects/${NUMERO}/`, 'projects/111222333/');
    politica([{ ...bindingCon(TODOS), condition: { title: 'secretos-de-las-functions', expression: otro } }]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
    // Uno solo de los seis con otro número también basta para rechazar.
    const uno = expr(TODOS).replace(`projects/${NUMERO}/secrets/INGESTA_`, 'projects/111222333/secrets/INGESTA_');
    politica([{ ...bindingCon(TODOS), condition: { title: 'secretos-de-las-functions', expression: uno } }]);
    expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM))).toBe(true);
  });
  it('condición envuelta en `&& false`, o con `!` u otro operador que restrinja: ✗', () => {
    const cond = (expression: string) => ({ ...bindingCon(TODOS), condition: { title: 'secretos-de-las-functions', expression } });
    for (const e of [
      `(${expr(TODOS)}) && false`,
      `${expr(TODOS)} && resource.name.endsWith("/nada")`,
      `${expr(TODOS)} || !resource.name.startsWith("projects/${NUMERO}/secrets/INGESTA_")`,
      expr(TODOS).replace('resource.name.startsWith("projects/' + NUMERO + '/secrets/INGESTA_")', '!resource.name.startsWith("projects/' + NUMERO + '/secrets/INGESTA_")'),
    ]) {
      politica([cond(e)]);
      expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM)), e).toBe(true);
    }
  });
  it('rol de otro proyecto, de una organización o con otro sufijo: ✗', () => {
    const b = bindingCon(TODOS);
    for (const rol of [`projects/otro-proyecto-xx/roles/desplegadorSecretos`, 'organizations/123/roles/desplegadorSecretos', `projects/${STAGING}/roles/desplegadorSecretos2`, `x/projects/${STAGING}/roles/desplegadorSecretos`]) {
      politica([{ ...b, role: rol }]);
      expect(esFallo(linea(verificar('UNKNOWN_CONDITIONAL'), PERM)), rol).toBe(true);
    }
  });
  for (const valor of ['DENIED', 'NOT_GRANTED', 'UNKNOWN_INFO_DENIED']) {
    it(`${valor}: ✗ (aun con el binding completo)`, () => {
      const l = linea(verificar(valor), PERM);
      expect(esFallo(l)).toBe(true);
      expect(l).toContain(valor);
    });
  }
  it('salida vacía: ✗ desconocido', () => {
    const l = linea(verificar(''), PERM);
    expect(esFallo(l)).toBe(true);
    expect(l).toContain('desconocido');
  });
  it('UNKNOWN_CONDITIONAL en un permiso que no es secretmanager.versions.list sigue siendo ✗', () => {
    expect(esFallo(linea(verificar('GRANTED', 'UNKNOWN_CONDITIONAL'), 'run.services.update'))).toBe(true);
  });
});
