/**
 * `scripts/preparar-staging.sh`: la fase nueva `salida-persona` y los cambios de
 * `cuentas` y `secretos` para `SALIDA_PERSONA_RUTAS` (17/10/2026).
 *
 * Con un `gcloud` y un `gh` FALSOS: el primero guarda la política del proyecto en un
 * archivo y anota cada llamada (sin lo que recibe por la entrada estándar); el
 * segundo contesta los identificadores del repositorio. Sin red ni nube.
 *
 * Lo que se cierra:
 *  - el seco no escribe (ni set-iam-policy ni secrets create);
 *  - la condición de `desplegadorSecretos` se edita EN SU LUGAR (set-iam-policy con
 *    la política leída, es decir con su etag), con el prefijo exacto `SALIDA_PERSONA_`
 *    y sin quitar ni volver a poner el binding;
 *  - el secreto nace `{}` (no el hex aleatorio de los demás) y sa-functions recibe
 *    `secretAccessor`;
 *  - la fase `cuentas` ya no agrega un segundo binding paralelo si el de condición existe.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'preparar-staging.sh');
const STAGING = 'prueba-stg-sp1';
const NUMERO = '987654321';
const VIEJA =
  `resource.name.startsWith("projects/${NUMERO}/secrets/INGESTA_") || resource.name.startsWith("projects/${NUMERO}/secrets/GEMINI_API_KEY") || resource.name.startsWith("projects/${NUMERO}/secrets/COBRADOR_")`;
const CLAUSULA = `resource.name.startsWith("projects/${NUMERO}/secrets/SALIDA_PERSONA_")`;

const GCLOUD_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
c="$*"
printf '%s\\n' "$c" >> "$E/llamadas"
case "$c" in
  *"projects describe"*) echo "${NUMERO}" ;;
  *"projects get-iam-policy"*) [[ -f "$E/falla-lectura" ]] && { echo "ERROR: lectura" >&2; exit 1; }; cat "$E/proyecto.json" ;;
  # Como el de verdad: set-iam-policy IMPRIME la política entera (con el número del proyecto).
  *"projects set-iam-policy"*) for a in "$@"; do f="$a"; done; cp "$f" "$E/proyecto.json"; cat "$f" ;;
  *"add-iam-policy-binding"*) echo "{\"bindings\":[{\"members\":[\"projects/${NUMERO}/x\"]}]}" ;;
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
const leer = (n: string) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : '');
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
  dir = mkdtempSync(join(tmpdir(), 'preparar-staging-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'tmp'));
  for (const [n, t] of [['gcloud', GCLOUD_FALSO], ['gh', GH_FALSO]] as const) {
    writeFileSync(join(bin, n), t); chmodSync(join(bin, n), 0o755);
  }
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

describe('preparar-staging.sh salida-persona', () => {
  it('seco: muestra lo que haría y NO escribe', () => {
    const r = correr('salida-persona');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('set-iam-policy');
    expect(r.salida).toContain("printf '{}' | gcloud secrets create SALIDA_PERSONA_RUTAS");
    expect(escrituras()).toEqual([]);
    expect(expresion()).toBe(VIEJA);
  });

  it('aplicar: edita la condición en su lugar con el prefijo exacto y crea el secreto {}', () => {
    const r = correr('salida-persona', ['--aplicar']);
    expect(r.codigo).toBe(0);
    expect(expresion()).toBe(`${VIEJA} || ${CLAUSULA}`);
    expect(expresion()).not.toContain('*');
    expect(llamadas().filter((l) => /projects (add|remove)-iam-policy-binding/.test(l))).toEqual([]);
    expect(leer('secreto-SALIDA_PERSONA_RUTAS')).toBe('{}');
    expect(llamadas().some((l) => /secrets add-iam-policy-binding SALIDA_PERSONA_RUTAS .*--member=serviceAccount:sa-functions@.*--role=roles\/secretmanager.secretAccessor/.test(l))).toBe(true);
  });

  it('aplicar dos veces: la segunda no vuelve a escribir la política ni el secreto', () => {
    correr('salida-persona', ['--aplicar']);
    const antes = llamadas().length;
    expect(correr('salida-persona', ['--aplicar']).codigo).toBe(0);
    expect(llamadas().slice(antes).filter((l) => /set-iam-policy|secrets create/.test(l))).toEqual([]);
    expect(expresion().split('SALIDA_PERSONA_').length - 1).toBe(1);
  });

  it('sin el binding con condición: falla (1) y no escribe', () => {
    politica(null);
    const r = correr('salida-persona', ['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(escrituras()).toEqual([]);
  });

  it('no imprime el número del proyecto (el falso imprime la política entera, como el de verdad)', () => {
    expect(correr('salida-persona', ['--aplicar']).salida).not.toContain(NUMERO);
    expect(correr('secretos', ['--aplicar']).salida).not.toContain(NUMERO);
  });

  it('el seco no deja ningún temporal; con --aplicar queda SOLO el respaldo, de modo 700/600', () => {
    correr('salida-persona');
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
    correr('salida-persona', ['--aplicar']);
    const ds = readdirSync(join(dir, 'tmp'));
    expect(ds).toHaveLength(1);
    const d = join(dir, 'tmp', ds[0]!);
    expect(statSync(d).mode & 0o777).toBe(0o700);
    expect(readdirSync(d)).toEqual(['respaldo-politica.json']);
    expect(statSync(join(d, 'respaldo-politica.json')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(d, 'respaldo-politica.json'), 'utf8')).toContain('secrets/GEMINI_API_KEY');
    expect(readFileSync(join(d, 'respaldo-politica.json'), 'utf8')).not.toContain('SALIDA_PERSONA_');
  });

  it('si algo falla, no queda ningún temporal', () => {
    politica(null);
    correr('salida-persona', ['--aplicar']);
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
  });
});

describe('preparar-staging.sh cuentas y secretos', () => {
  it('cuentas: si el binding con condición ya existe, NO agrega uno paralelo', () => {
    const r = correr('cuentas');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('ya existe: no se toca');
    expect(r.salida).not.toContain('desplegadorSecretos con condición');
  });

  it('cuentas: si la política NO se puede leer, aborta y no crea un binding paralelo', () => {
    writeFileSync(join(dir, 'falla-lectura'), '');
    const r = correr('cuentas', ['--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(llamadas().filter((l) => /desplegadorSecretos/.test(l) && /add-iam-policy-binding/.test(l))).toEqual([]);
  });

  it('cuentas en un proyecto nuevo: la condición lleva los cuatro prefijos', () => {
    politica(null);
    const r = correr('cuentas');
    expect(r.salida).toContain('SALIDA_PERSONA_');
    for (const p of ['INGESTA_', 'GEMINI_API_KEY', 'COBRADOR_']) expect(r.salida).toContain(p);
  });

  it('secretos: SALIDA_PERSONA_RUTAS nace {} y los demás con hex aleatorio', () => {
    const r = correr('secretos');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("printf '{}' | gcloud secrets create SALIDA_PERSONA_RUTAS");
    expect(r.salida).toContain('openssl rand -hex 32 | gcloud secrets create INGESTA_DEMOA');
    expect(r.salida).not.toMatch(/openssl rand -hex 32 \| gcloud secrets create SALIDA_PERSONA_RUTAS/);
  });

  it('secretos aplicado: el valor de SALIDA_PERSONA_RUTAS es exactamente {}', () => {
    correr('secretos', ['--aplicar']);
    expect(leer('secreto-SALIDA_PERSONA_RUTAS')).toBe('{}');
    expect(leer('secreto-INGESTA_DEMOA')).toMatch(/^[0-9a-f]{64}$/);
  });
});
