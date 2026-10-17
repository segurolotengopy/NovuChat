/**
 * `scripts/nube-salida-persona.sh`: los pasos de nube de PRODUCCIÓN del timbre de la
 * salida de persona (condición de IAM, secreto `SALIDA_PERSONA_RUTAS`, acceso de
 * sa-functions, y el alta y baja de un alias), seco por omisión.
 *
 * Se prueba NEGANDO, con un `gcloud` FALSO adelante en el PATH que guarda el estado en
 * archivos (política del proyecto, el secreto, su política) y anota cada llamada SIN
 * los datos que recibe por la entrada estándar. Sin red, sin nube, sin credenciales
 * reales: `CLOUDSDK_CONFIG` apunta a una carpeta temporal con un
 * `application_default_credentials.json` falso (solo `quota_project_id`).
 *
 * Lo que cada grupo cierra:
 *  - sin `--confirmo produccion`, o con dos modos, o con un alias o una dirección
 *    inválidos, no hay ni una llamada a gcloud;
 *  - el seco no escribe nada;
 *  - la condición se amplía con el prefijo EXACTO `SALIDA_PERSONA_` (sin comodines),
 *    conserva las demás cláusulas, y repetir no escribe;
 *  - el secreto nace `{}`; el acceso es de sa-functions y solo `secretAccessor`;
 *  - NINGÚN valor (ruta, clave, mapa) ni id de proyecto aparece en la salida, y la
 *    entrega es un archivo de modo 600 que el script no imprime.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'nube-salida-persona.sh');

// Ids de prueba con la forma de un id real (no existen).
const PROD = 'prueba-salida-prd1';
const STAGING = 'prueba-salida-stg1';
// Menos de 10 dígitos a propósito (el saneo del repositorio público los bloquea).
const NUMERO = '987654321';
const BASE_N8N = 'https://n8n.ejemplo.test';
const CONDICION_VIEJA =
  `resource.name.startsWith("projects/${NUMERO}/secrets/INGESTA_") || resource.name.startsWith("projects/${NUMERO}/secrets/GEMINI_API_KEY") || resource.name.startsWith("projects/${NUMERO}/secrets/COBRADOR_")`;
const CLAUSULA = `resource.name.startsWith("projects/${NUMERO}/secrets/SALIDA_PERSONA_")`;

const GCLOUD_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
c="$*"
printf '%s\\n' "$c" >> "$E/llamadas"
case "$c" in
  *"projects describe"*) echo "${NUMERO}" ;;
  *"projects get-iam-policy"*) cat "$E/proyecto.json" ;;
  *"projects set-iam-policy"*)
    [[ -f "$E/falla-set" ]] && { echo "ERROR: aborted: etag cambió en ${PROD} (${NUMERO}) cuenta@ejemplo.com" >&2; exit 1; }
    for a in "$@"; do f="$a"; done
    cp "$f" "$E/proyecto.json" ;;
  *"secrets describe"*) [[ -f "$E/secreto" ]] || { echo "NOT_FOUND ${PROD}" >&2; exit 1; } ;;
  *"secrets create"*)
    cat > "$E/secreto"; echo 1 > "$E/versiones"; echo '{"bindings":[]}' > "$E/secreto-iam.json" ;;
  *"secrets versions list"*) n="$(cat "$E/versiones" 2>/dev/null || echo 0)"; for ((i = 1; i <= n; i++)); do echo "projects/x/secrets/s/versions/$i"; done ;;
  *"secrets versions access"*) cat "$E/secreto" ;;
  *"secrets versions add"*)
    [[ -f "$E/falla-add" ]] && { cat > /dev/null; echo "ERROR: no se pudo en ${PROD}" >&2; exit 1; }
    cat > "$E/secreto"; echo $(( $(cat "$E/versiones") + 1 )) > "$E/versiones" ;;
  *"secrets get-iam-policy"*) cat "$E/secreto-iam.json" ;;
  *"secrets add-iam-policy-binding"*)
    python3 - "$E/secreto-iam.json" "$c" <<'PY'
import json, re, sys
ruta, c = sys.argv[1:3]
p = json.load(open(ruta))
m = re.search(r"--member=(\\S+)", c).group(1); r = re.search(r"--role=(\\S+)", c).group(1)
b = next((x for x in p["bindings"] if x["role"] == r), None)
if b is None:
    b = {"role": r, "members": []}; p["bindings"].append(b)
if m not in b["members"]:
    b["members"].append(m)
json.dump(p, open(ruta, "w"))
PY
    ;;
  *) echo "gcloud falso: llamada no prevista" >&2; exit 97 ;;
esac
`;

let dir: string;
let bin: string;
let gcloudCfg: string;
let runtime: string;

function politicaDelProyecto(expresion = CONDICION_VIEJA, miembros = [`serviceAccount:sa-deploy-prod@${PROD}.iam.gserviceaccount.com`]) {
  writeFileSync(join(dir, 'proyecto.json'), JSON.stringify({
    etag: 'BwXXXX', version: 3,
    bindings: [
      { role: 'roles/run.admin', members: miembros },
      { role: `projects/${PROD}/roles/desplegadorSecretos`, members: miembros,
        condition: { title: 'secretos-de-las-functions', expression: expresion } },
    ],
  }));
}
function adc(cuota: string) {
  writeFileSync(join(gcloudCfg, 'application_default_credentials.json'),
    cuota ? JSON.stringify({ type: 'authorized_user', quota_project_id: cuota }) : '{"type":"authorized_user"}');
}
function secreto(valor: unknown) {
  writeFileSync(join(dir, 'secreto'), typeof valor === 'string' ? valor : JSON.stringify(valor));
  writeFileSync(join(dir, 'versiones'), '1');
  writeFileSync(join(dir, 'secreto-iam.json'), JSON.stringify({
    bindings: [{ role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:sa-functions@${PROD}.iam.gserviceaccount.com`] }],
  }));
}
const leer = (n: string) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : '');
const llamadas = () => leer('llamadas').split('\n').filter(Boolean);
const escrituras = () => llamadas().filter((l) => /set-iam-policy|secrets create|versions add|add-iam-policy-binding/.test(l));
const expresion = (): string =>
  JSON.parse(leer('proyecto.json')).bindings.find((b: { condition?: unknown }) => b.condition).condition.expression;
const mapa = (): Record<string, { ruta: string; clave: string }> => JSON.parse(leer('secreto'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nube-salida-'));
  bin = join(dir, 'bin');
  gcloudCfg = join(dir, 'gcloud');
  runtime = join(dir, 'run');
  mkdirSync(bin); mkdirSync(gcloudCfg); mkdirSync(runtime, { mode: 0o700 });
  chmodSync(runtime, 0o700);
  writeFileSync(join(bin, 'gcloud'), GCLOUD_FALSO);
  chmodSync(join(bin, 'gcloud'), 0o755);
  adc(PROD);
  politicaDelProyecto();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Cosas que NUNCA pueden salir en pantalla: ids, número y todo lo que el secreto o la entrega contengan. */
function prohibidos(): string[] {
  const lista = [PROD, STAGING, NUMERO];
  const valores = [leer('secreto'), ...['a1', 'a2', 'nuevo'].map((a) => leer(join('run', `novuchat-salida-persona-${a}.json`)))];
  for (const v of valores) {
    try {
      const j = JSON.parse(v) as Record<string, unknown>;
      const recorrer = (x: unknown) => {
        if (typeof x === 'string' && x.length >= 20) lista.push(x);
        else if (x && typeof x === 'object') Object.values(x).forEach(recorrer);
      };
      recorrer(j);
    } catch { /* no es JSON */ }
  }
  return lista;
}

function correr(args: string[], vars: Record<string, string> = {}, prefijo: string[] = [`CLOUDSDK_CONFIG=${gcloudCfg}`]) {
  const r = spawnSync('env', [...prefijo, 'bash', SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_DIR: dir,
      GCP_PROJECT_ID_PROD: '',
      GCP_PROJECT_ID_STAGING: '',
      XDG_RUNTIME_DIR: runtime,
      N8N_BASE_URL: BASE_N8N,
      ...vars,
    }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  for (const p of prohibidos()) expect(salida).not.toContain(p);
  expect(salida).not.toContain('"clave"');
  return { codigo: r.status, salida };
}
const APLICAR = ['--aplicar', '--confirmo', 'produccion'];

describe('nube-salida-persona.sh: uso y salvaguardas (ni una llamada a gcloud)', () => {
  it('--help explica los modos y sale 0', () => {
    const r = correr(['--help']);
    expect(r.codigo).toBe(0);
    for (const t of ['--aplicar', '--confirmo', '--agregar-alias', '--quitar-alias', '--revertir-iam', 'XDG_RUNTIME_DIR']) expect(r.salida).toContain(t);
    expect(llamadas()).toEqual([]);
  });

  it.each([
    ['--aplicar sin --confirmo', ['--aplicar']],
    ['--confirmo de otro entorno', ['--aplicar', '--confirmo', 'staging']],
    ['--confirmo vacío', ['--aplicar', '--confirmo', '']],
    ['una opción desconocida', ['--todo']],
    ['dos modos a la vez', ['--agregar-alias', 'a1', '--quitar-alias', 'a2']],
    ['un alias con caracteres raros', ['--quitar-alias', 'a1;rm']],
    ['un alias demasiado corto', ['--quitar-alias', 'a']],
    ['--agregar-alias sin alias', ['--agregar-alias']],
    ['--quitar-alias --aplicar sin --confirmo', ['--quitar-alias', 'a1', '--aplicar']],
    ['--revertir-iam --aplicar sin --confirmo', ['--revertir-iam', '--aplicar']],
  ])('%s: sale 2 sin tocar gcloud', (_n, args) => {
    const r = correr(args);
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it.each([
    ['sin N8N_BASE_URL', ''],
    ['con http', 'http://n8n.ejemplo.test'],
    ['con ruta', 'https://n8n.ejemplo.test/webhook'],
    ['con usuario', ['https://u:p', 'n8n.ejemplo.test'].join('@')],
    ['con barra final', 'https://n8n.ejemplo.test/'],
  ])('--agregar-alias %s: sale 2', (_n, base) => {
    const r = correr(['--agregar-alias', 'a1'], { N8N_BASE_URL: base });
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('GCP_PROJECT_ID_PROD distinto del de las credenciales: sale 2', () => {
    expect(correr([], { GCP_PROJECT_ID_PROD: 'otro-proyecto-xyz' }).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('GCP_PROJECT_ID_STAGING igual al de las credenciales (producción): sale 2', () => {
    expect(correr([], { GCP_PROJECT_ID_STAGING: PROD }).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('sin quota_project_id en las credenciales: sale 2', () => {
    adc('');
    expect(correr([]).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('un id con forma inválida en las credenciales: sale 2', () => {
    adc('X;rm -rf');
    expect(correr([]).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
});

describe('nube-salida-persona.sh: pasos 1 a 3', () => {
  it('seco: lista lo pendiente, sale 1 y NO escribe', () => {
    const r = correr([]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('(haría) agregar a la condición');
    expect(r.salida).toContain('(haría) crear SALIDA_PERSONA_RUTAS');
    expect(escrituras()).toEqual([]);
    expect(expresion()).toBe(CONDICION_VIEJA);
    expect(existsSync(join(dir, 'secreto'))).toBe(false);
  });

  it('aplicar: amplía la condición con el prefijo EXACTO, conserva lo anterior y no usa comodines', () => {
    const r = correr(APLICAR);
    expect(r.codigo).toBe(0);
    expect(expresion()).toBe(`${CONDICION_VIEJA} || ${CLAUSULA}`);
    expect(expresion()).not.toContain('*');
    expect(llamadas().filter((l) => /set-iam-policy/.test(l))).toHaveLength(1);
    // Se edita en su lugar: ni add ni remove de bindings del proyecto.
    expect(llamadas().filter((l) => /projects (add|remove)-iam-policy-binding/.test(l))).toEqual([]);
    // El resto de la política (el otro rol, el miembro) quedó igual.
    const pol = JSON.parse(leer('proyecto.json')) as { bindings: { role: string; members: string[] }[] };
    expect(pol.bindings).toHaveLength(2);
    expect(pol.bindings[0]!.role).toBe('roles/run.admin');
  });

  it('aplicar: el secreto nace {} y sa-functions recibe secretAccessor (y nada más)', () => {
    correr(APLICAR);
    expect(leer('secreto')).toBe('{}');
    const iam = JSON.parse(leer('secreto-iam.json')) as { bindings: { role: string; members: string[] }[] };
    expect(iam.bindings).toEqual([{ role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:sa-functions@${PROD}.iam.gserviceaccount.com`] }]);
    const creacion = llamadas().filter((l) => /secrets create/.test(l));
    expect(creacion).toHaveLength(1);
    expect(creacion[0]).toContain('--data-file=-'); // el valor viaja por la entrada, no por argumentos
  });

  it('aplicar dos veces: la segunda no escribe nada y sale 0', () => {
    correr(APLICAR);
    const antes = llamadas().length;
    const r = correr(APLICAR);
    expect(r.codigo).toBe(0);
    // Sin escrituras nuevas en la segunda corrida.
    expect(llamadas().slice(antes).filter((l) => /set-iam-policy|secrets create|versions add|add-iam-policy-binding/.test(l))).toEqual([]);
    expect(expresion()).toBe(`${CONDICION_VIEJA} || ${CLAUSULA}`);
  });

  it('después de aplicar, el seco dice que no falta nada (sale 0)', () => {
    correr(APLICAR);
    const r = correr([]);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('no falta nada');
  });

  it('si la condición ya cubre el prefijo, no la repite', () => {
    politicaDelProyecto(`${CONDICION_VIEJA} || ${CLAUSULA}`);
    secreto({});
    const r = correr(APLICAR);
    expect(r.codigo).toBe(0);
    expect(llamadas().filter((l) => /set-iam-policy/.test(l))).toEqual([]);
    expect(expresion().split('SALIDA_PERSONA_').length - 1).toBe(1);
  });

  it('un secreto existente con alias NO se pisa', () => {
    secreto({ a1: { ruta: 'https://x.test/webhook/aaaaaaaaaaaaaaaaaaaaaaaa', clave: 'bbbbbbbbbbbbbbbbbbbbbbbb' } });
    correr(APLICAR);
    expect(Object.keys(mapa())).toEqual(['a1']);
    expect(llamadas().filter((l) => /secrets create|versions add/.test(l))).toEqual([]);
  });

  it('sin el binding con condición: sale 3 y no escribe', () => {
    writeFileSync(join(dir, 'proyecto.json'), JSON.stringify({ etag: 'x', bindings: [{ role: 'roles/run.admin', members: ['user:x@y.z'] }] }));
    const r = correr(APLICAR);
    expect(r.codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });

  it('con el binding compartido por más de un miembro: sale 3 y no escribe', () => {
    politicaDelProyecto(CONDICION_VIEJA, [`serviceAccount:sa-deploy-prod@${PROD}.iam.gserviceaccount.com`, 'user:otro@ejemplo.com']);
    const r = correr(APLICAR);
    expect(r.codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });

  it('si set-iam-policy falla (etag), sale 3, tapa ids y cuentas, y no sigue con el secreto', () => {
    writeFileSync(join(dir, 'falla-set'), '');
    const r = correr(APLICAR);
    expect(r.codigo).toBe(3);
    expect(r.salida).not.toContain('cuenta@ejemplo.com');
    expect(existsSync(join(dir, 'secreto'))).toBe(false);
  });

  it('--revertir-iam quita solo la cláusula nueva (y es idempotente)', () => {
    correr(APLICAR);
    const r = correr(['--revertir-iam', ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(expresion()).toBe(CONDICION_VIEJA);
    const antes = llamadas().length;
    expect(correr(['--revertir-iam', ...APLICAR]).codigo).toBe(0);
    expect(llamadas().slice(antes).filter((l) => /set-iam-policy/.test(l))).toEqual([]);
  });

  it('--revertir-iam en seco no escribe', () => {
    correr(APLICAR);
    const r = correr(['--revertir-iam']);
    expect(r.codigo).toBe(1);
    expect(expresion()).toBe(`${CONDICION_VIEJA} || ${CLAUSULA}`);
  });
});

describe('nube-salida-persona.sh: --agregar-alias y --quitar-alias', () => {
  const previo = { a1: { ruta: 'https://x.test/webhook/aaaaaaaaaaaaaaaaaaaaaaaa', clave: 'bbbbbbbbbbbbbbbbbbbbbbbb' } };

  it('agregar en seco: no escribe, no crea la entrega, sale 1', () => {
    secreto(previo);
    const r = correr(['--agregar-alias', 'nuevo']);
    expect(r.codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(join(runtime, 'novuchat-salida-persona-nuevo.json'))).toBe(false);
    expect(mapa()).toEqual(previo);
  });

  it('agregar: fusiona con lo existente, guarda una versión nueva y entrega un archivo 600 que no se imprime', () => {
    secreto(previo);
    const r = correr(['--agregar-alias', 'nuevo', ...APLICAR]);
    expect(r.codigo).toBe(0);
    const m = mapa();
    expect(Object.keys(m).sort()).toEqual(['a1', 'nuevo']);
    expect(m.a1).toEqual(previo.a1);
    expect(m.nuevo!.ruta.startsWith(`${BASE_N8N}/webhook/`)).toBe(true);
    expect(m.nuevo!.clave.length).toBeGreaterThanOrEqual(32);
    expect(leer('versiones').trim()).toBe('2');
    const entrega = join(runtime, 'novuchat-salida-persona-nuevo.json');
    expect(existsSync(entrega)).toBe(true);
    expect(statSync(entrega).mode & 0o777).toBe(0o600);
    const e = JSON.parse(readFileSync(entrega, 'utf8')) as { ruta: string; clave: string; path: string };
    expect(e.ruta).toBe(m.nuevo!.ruta);
    expect(e.clave).toBe(m.nuevo!.clave);
    expect(e.ruta.endsWith(e.path)).toBe(true);
    // Solo se imprime DÓNDE está la entrega; el valor sale del chequeo de `correr` (prohibidos).
    expect(r.salida).toContain('novuchat-salida-persona-nuevo.json');
    expect(r.salida).toContain('REDESPLEGAR');
    // Ningún argumento de gcloud lleva valores: todo viaja por la entrada estándar.
    expect(leer('llamadas')).not.toContain(m.nuevo!.clave);
    expect(leer('llamadas')).not.toContain(e.path);
  });

  it('agregar dos veces el mismo alias: se niega (no rota en silencio) y no escribe', () => {
    secreto(previo);
    correr(['--agregar-alias', 'nuevo', ...APLICAR]);
    rmSync(join(runtime, 'novuchat-salida-persona-nuevo.json'));
    const antes = leer('secreto');
    const r = correr(['--agregar-alias', 'nuevo', ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(leer('secreto')).toBe(antes);
    expect(leer('versiones').trim()).toBe('2');
  });

  it('con una entrega pendiente del mismo alias: sale 2 y no escribe', () => {
    secreto(previo);
    writeFileSync(join(runtime, 'novuchat-salida-persona-nuevo.json'), '{}');
    const r = correr(['--agregar-alias', 'nuevo', ...APLICAR]);
    expect(r.codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });

  it.each([
    ['sin XDG_RUNTIME_DIR', () => ({ XDG_RUNTIME_DIR: '' })],
    ['con un directorio inexistente', () => ({ XDG_RUNTIME_DIR: join(dir, 'no-existe') })],
    ['con un directorio abierto (modo 755)', () => { chmodSync(runtime, 0o755); return {}; }],
  ])('agregar %s: se niega (sale 2), no hay plan B por pantalla y no escribe', (_n, preparar) => {
    secreto(previo);
    const vars = preparar();
    const r = correr(['--agregar-alias', 'nuevo', ...APLICAR], vars);
    expect(r.codigo).toBe(2);
    expect(escrituras()).toEqual([]);
    expect(mapa()).toEqual(previo);
  });

  it('si gcloud falla al agregar la versión: sale 3, nada queda entregado ni el mapa cambia', () => {
    secreto(previo);
    writeFileSync(join(dir, 'falla-add'), '');
    const r = correr(['--agregar-alias', 'nuevo', ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(mapa()).toEqual(previo);
    expect(existsSync(join(runtime, 'novuchat-salida-persona-nuevo.json'))).toBe(false);
    expect(existsSync(join(runtime, '.novuchat-salida-persona-nuevo.tmp'))).toBe(false);
    expect(r.salida).not.toContain('ejemplo.com');
  });

  it('un secreto que no es un objeto JSON: sale 3 y no escribe', () => {
    secreto('esto no es JSON');
    const r = correr(['--agregar-alias', 'nuevo', ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });

  it('sin el secreto: sale 3 y manda a correr los pasos 1 a 3', () => {
    const r = correr(['--agregar-alias', 'nuevo', ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('pasos 1 a 3');
    expect(escrituras()).toEqual([]);
  });

  it('quitar: nueva versión sin ese alias y con los demás intactos', () => {
    secreto({ ...previo, a2: { ruta: 'https://x.test/webhook/cccccccccccccccccccccccc', clave: 'dddddddddddddddddddddddd' } });
    const r = correr(['--quitar-alias', 'a2', ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(mapa()).toEqual(previo);
    expect(leer('versiones').trim()).toBe('2');
  });

  it('quitar un alias que no está: sale 0 y no escribe', () => {
    secreto(previo);
    const r = correr(['--quitar-alias', 'a2', ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(escrituras()).toEqual([]);
  });

  it('quitar en seco: sale 1 y no escribe', () => {
    secreto(previo);
    const r = correr(['--quitar-alias', 'a1']);
    expect(r.codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(mapa()).toEqual(previo);
  });
});
