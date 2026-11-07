/**
 * `scripts/preparar-staging.sh`: la fase nueva `alertas` y la condición de `cuentas` con el prefijo `ALERTAS_`
 * (alerta operativa «envío incierto»). Con un `gcloud` y un `gh` FALSOS (sin red ni nube), calcado de
 * `preparar-staging-salida-persona.test.ts`.
 *
 *  - el seco no escribe; la condición se edita EN SU LUGAR con el prefijo exacto `ALERTAS_`;
 *  - los dos secretos nacen con valor aleatorio (el hex de los demás) y sa-functions recibe `secretAccessor`;
 *  - repetir no vuelve a escribir; sin el binding con condición falla y no escribe;
 *  - la fase `cuentas` crea el binding con la condición YA ampliada con `ALERTAS_`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'preparar-staging.sh');
const STAGING = 'prueba-stg-al1';
const NUMERO = '987654321';
const VIEJA =
  `resource.name.startsWith("projects/${NUMERO}/secrets/INGESTA_") || resource.name.startsWith("projects/${NUMERO}/secrets/GEMINI_API_KEY") || resource.name.startsWith("projects/${NUMERO}/secrets/COBRADOR_") || resource.name.startsWith("projects/${NUMERO}/secrets/SALIDA_PERSONA_")`;
const CLAUSULA = `resource.name.startsWith("projects/${NUMERO}/secrets/ALERTAS_")`;

const GCLOUD_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
c="$*"
printf '%s\\n' "$c" >> "$E/llamadas"
case "$c" in
  *"projects describe"*) echo "${NUMERO}" ;;
  *"projects get-iam-policy"*) cat "$E/proyecto.json" ;;
  *"projects set-iam-policy"*) for a in "$@"; do f="$a"; done; cp "$f" "$E/proyecto.json"; cat "$f" ;;
  *"remove-iam-policy-binding"*|*"add-iam-policy-binding"*) echo "{\\"bindings\\":[{\\"members\\":[\\"POLITICA_IMPRESA ${NUMERO}\\"]}]}" ;;
  *"secrets describe"*) n="\${c#*secrets describe }"; n="\${n%% *}"; [[ -f "$E/secreto-$n" ]] || exit 1 ;;
  *"secrets create"*) n="\${c#*secrets create }"; n="\${n%% *}"; cat > "$E/secreto-$n" ;;
  *) : ;;
esac
`;
const GH_FALSO = `#!/usr/bin/env bash
case "$*" in
  *"--jq .id"*) echo 1111 ;;
  *"owner.id"*) echo 2222 ;;
  *) echo "ejemplo" ;;
esac
`;

let dir: string;
const leer = (n: string): string => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } };
const llamadas = () => leer('llamadas').split('\n').filter(Boolean);
const escrituras = () => llamadas().filter((l) => /set-iam-policy|secrets create/.test(l));
const expresion = (): string =>
  JSON.parse(leer('proyecto.json')).bindings.find((b: { condition?: unknown }) => b.condition).condition.expression;
function politica(expr: string | null) {
  const m = `serviceAccount:sa-deploy-staging@${STAGING}.iam.gserviceaccount.com`;
  writeFileSync(join(dir, 'proyecto.json'), JSON.stringify({
    etag: 'BwXXXX', version: 3,
    bindings: expr === null ? [{ role: 'roles/run.admin', members: [m] }] : [
      { role: 'roles/run.admin', members: [m] },
      { role: `projects/${STAGING}/roles/desplegadorSecretos`, members: [m], condition: { title: 'secretos-de-las-functions', expression: expr } },
    ],
  }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'preparar-staging-al-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin); mkdirSync(join(dir, 'tmp'));
  for (const [n, t] of [['gcloud', GCLOUD_FALSO], ['gh', GH_FALSO]] as const) { writeFileSync(join(bin, n), t); chmodSync(join(bin, n), 0o755); }
  politica(VIEJA);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(fase: string, extra: string[] = []) {
  const r = spawnSync('bash', [SCRIPT, fase, '--proyecto', STAGING, ...extra], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, FAKE_DIR: dir, CLOUDSDK_CONFIG: join(dir, 'gcloud'), TMPDIR: join(dir, 'tmp'), XDG_RUNTIME_DIR: '' }),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

describe('preparar-staging.sh alertas', () => {
  it('seco: muestra lo que haría y NO escribe', () => {
    const r = correr('alertas');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('set-iam-policy');
    expect(r.salida).toContain('gcloud secrets create ALERTAS_HMAC');
    expect(r.salida).toContain('gcloud secrets create ALERTAS_RESEND_API_KEY');
    expect(escrituras()).toEqual([]);
    expect(expresion()).toBe(VIEJA);
  });
  it('aplicar: edita la condición en su lugar con el prefijo exacto y crea los dos secretos con valor aleatorio', () => {
    const r = correr('alertas', ['--aplicar']);
    expect(r.codigo).toBe(0);
    expect(expresion()).toBe(`${VIEJA} || ${CLAUSULA}`);
    expect(expresion()).not.toContain('*');
    expect(llamadas().filter((l) => /projects (add|remove)-iam-policy-binding/.test(l))).toEqual([]);
    for (const n of ['ALERTAS_HMAC', 'ALERTAS_RESEND_API_KEY']) {
      expect(leer(`secreto-${n}`)).toMatch(/^[0-9a-f]{64}$/);
      expect(r.salida).not.toContain(leer(`secreto-${n}`));
      expect(llamadas().some((l) => new RegExp(`secrets add-iam-policy-binding ${n} .*--member=serviceAccount:sa-functions@.*--role=roles/secretmanager.secretAccessor`).test(l))).toBe(true);
    }
  });
  it('aplicar dos veces: la segunda no vuelve a escribir la política ni los secretos', () => {
    correr('alertas', ['--aplicar']);
    const antes = llamadas().length;
    expect(correr('alertas', ['--aplicar']).codigo).toBe(0);
    expect(llamadas().slice(antes).filter((l) => /set-iam-policy|secrets create/.test(l))).toEqual([]);
    expect(expresion().split('ALERTAS_').length - 1).toBe(1);
  });
  it('sin el binding con condición: falla (1) y no escribe', () => {
    politica(null);
    expect(correr('alertas', ['--aplicar']).codigo).toBe(1);
    expect(escrituras()).toEqual([]);
  });
  it('la fase `cuentas` arma la condición de arranque con ALERTAS_ (y ya no agrega un binding paralelo si existe)', () => {
    politica(null);
    const r = correr('cuentas', ['--aplicar']);
    expect(r.codigo).toBe(0);
    expect(llamadas().some((l) => l.includes('secrets/ALERTAS_'))).toBe(true);
    const fuente = readFileSync(SCRIPT, 'utf8');
    expect(fuente).toContain('(INGESTA_, GEMINI_API_KEY, COBRADOR_, SALIDA_PERSONA_, ALERTAS_)');
  });
  it('la nota de `cuentas` nombra las dos fases que amplían la condición', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toContain('para ampliarlo, fases salida-persona y alertas');
  });
  it('`verificar` comprueba que la condición cubre ALERTAS_ y que los dos secretos existen; sin la fase, falla', () => {
    const antes = correr('verificar');
    expect(antes.salida).toContain('NO cubre ALERTAS_');
    expect(antes.salida).toContain('ALERTAS_HMAC no existe');
    expect(antes.salida).toContain('ALERTAS_RESEND_API_KEY no existe');
    correr('alertas', ['--aplicar']);
    const despues = correr('verificar');
    expect(despues.salida).toContain('cubre ALERTAS_');
    expect(despues.salida).not.toContain('NO cubre ALERTAS_');
    expect(despues.salida).toContain('ALERTAS_HMAC existe');
    expect(despues.salida).toContain('ALERTAS_RESEND_API_KEY existe');
  });
  it('`verificar` busca ALERTAS_ DENTRO del binding «secretos-de-las-functions»: en otro binding o en otra cuenta no cuenta', () => {
    const m = `serviceAccount:sa-deploy-staging@${STAGING}.iam.gserviceaccount.com`;
    writeFileSync(join(dir, 'proyecto.json'), JSON.stringify({
      etag: 'x', version: 3,
      bindings: [
        { role: 'roles/run.admin', members: [m], condition: { title: 'otra-condicion', expression: CLAUSULA } },
        { role: `projects/${STAGING}/roles/desplegadorSecretos`, members: [m], condition: { title: 'secretos-de-las-functions', expression: VIEJA } },
      ],
    }));
    expect(correr('verificar').salida).toContain('NO cubre ALERTAS_');
    politica(`${VIEJA} || ${CLAUSULA}`);
    expect(correr('verificar').salida).toContain('cubre ALERTAS_');
    expect(correr('verificar').salida).not.toContain('NO cubre ALERTAS_');
  });
});
