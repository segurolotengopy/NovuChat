/**
 * `scripts/nube-alertas.sh`: los pasos de nube de PRODUCCIÓN de la alerta operativa (condición de IAM con el
 * prefijo `ALERTAS_`, los dos secretos, el acceso de sa-functions, la carga de la clave de Resend, la entrega de
 * la clave HMAC y el invocador), seco por omisión. Calcado de `nube-salida-persona.test.ts`.
 *
 * Con un `gcloud` FALSO delante en el PATH que guarda el estado en archivos y anota cada llamada SIN los datos que
 * recibe por la entrada estándar. Sin red, sin nube, sin credenciales reales. NO se ejecuta nada contra la nube.
 *
 * Lo que cada grupo cierra:
 *  - sin `--confirmo produccion`, con dos modos, sin directorio de ejecución válido, con un archivo de clave que no
 *    es regular, de modo 600 y con la forma `re_…`: ni una llamada a gcloud;
 *  - el seco no escribe; la condición se amplía con el prefijo EXACTO `ALERTAS_` y conserva las demás cláusulas;
 *  - los secretos nacen (HMAC aleatorio, Resend con el marcador) y sa-functions recibe solo `secretAccessor`;
 *  - NINGÚN valor (clave de Resend, HMAC) ni id de proyecto aparece en la salida; la entrega es un archivo 600.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT_REAL = join(RAIZ, 'scripts', 'nube-alertas.sh');

const PROD = 'prueba-alertas-prd1';
const STAGING = 'prueba-alertas-stg1';
const NUMERO = '987654321'; // menos de 10 dígitos a propósito (el saneo del repositorio público los bloquea)
const CONDICION_VIEJA =
  `resource.name.startsWith("projects/${NUMERO}/secrets/INGESTA_") || resource.name.startsWith("projects/${NUMERO}/secrets/GEMINI_API_KEY") || resource.name.startsWith("projects/${NUMERO}/secrets/COBRADOR_") || resource.name.startsWith("projects/${NUMERO}/secrets/SALIDA_PERSONA_")`;
const CLAUSULA = `resource.name.startsWith("projects/${NUMERO}/secrets/ALERTAS_")`;
const CLAVE_RESEND = ['re', '_', 'ClavePruebaSolo', 'ParaEstaSuite'].join('');
const HMAC = 'ALERTAS_HMAC';
const RESEND = 'ALERTAS_RESEND_API_KEY';

const GCLOUD_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
c="$*"
printf '%s\\n' "$c" >> "$E/llamadas"
nombre() { local t="\${c#*$1 }"; printf '%s' "\${t%% *}"; }
case "$c" in
  *"projects describe"*) echo "${NUMERO}" ;;
  *"projects get-iam-policy"*) cat "$E/proyecto.json" ;;
  *"projects set-iam-policy"*)
    [[ -f "$E/falla-set" ]] && { echo "ERROR: aborted: etag cambió en ${PROD} (${NUMERO}) cuenta@ejemplo.com" >&2; exit 1; }
    for a in "$@"; do f="$a"; done
    cp "$f" "$E/proyecto.json" ;;
  *"secrets describe"*) n="$(nombre 'secrets describe')"; [[ -f "$E/secreto-$n" ]] || { echo "NOT_FOUND ${PROD}" >&2; exit 1; } ;;
  *"secrets create"*) n="$(nombre 'secrets create')"; cat > "$E/secreto-$n"; echo 1 > "$E/versiones-$n"; echo '{"bindings":[]}' > "$E/iam-$n.json" ;;
  *"secrets versions list"*) n="$(nombre 'secrets versions list')"; k="$(cat "$E/versiones-$n" 2>/dev/null || echo 0)"; for ((i = 1; i <= k; i++)); do echo "projects/x/secrets/s/versions/$i"; done ;;
  *"secrets versions access latest --secret "*) n="\${c#*--secret }"; n="\${n%% *}"; cat "$E/secreto-$n" ;;
  *"secrets versions add"*)
    n="$(nombre 'secrets versions add')"
    [[ -f "$E/falla-add" ]] && { cat > /dev/null; echo "ERROR: no se pudo en ${PROD}" >&2; exit 1; }
    cat > "$E/secreto-$n"; echo $(( $(cat "$E/versiones-$n") + 1 )) > "$E/versiones-$n" ;;
  *"secrets get-iam-policy"*) n="$(nombre 'secrets get-iam-policy')"; cat "$E/iam-$n.json" ;;
  *"secrets add-iam-policy-binding"*)
    n="$(nombre 'secrets add-iam-policy-binding')"
    python3 - "$E/iam-$n.json" "$c" <<'PY'
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

const VISOR_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/visor"
exit 0
`;

let dir: string;
let bin: string;
let gcloudCfg: string;
let runtime: string;
let SCRIPT: string;

const politicaDelProyecto = (expresion = CONDICION_VIEJA) => {
  const miembros = [`serviceAccount:sa-deploy-prod@${PROD}.iam.gserviceaccount.com`];
  writeFileSync(join(dir, 'proyecto.json'), JSON.stringify({
    etag: 'BwXXXX', version: 3,
    bindings: [
      { role: 'roles/run.admin', members: miembros },
      { role: `projects/${PROD}/roles/desplegadorSecretos`, members: miembros, condition: { title: 'secretos-de-las-functions', expression: expresion } },
    ],
  }));
};
const adc = (cuota: string) => writeFileSync(join(gcloudCfg, 'application_default_credentials.json'),
  cuota ? JSON.stringify({ type: 'authorized_user', quota_project_id: cuota }) : '{"type":"authorized_user"}');
const leer = (n: string): string => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } };
const existe = (ruta: string): boolean => { try { closeSync(openSync(ruta, 'r')); return true; } catch { return false; } };
const modoDe = (ruta: string): number => { const fd = openSync(ruta, 'r'); try { return fstatSync(fd).mode & 0o777; } finally { closeSync(fd); } };
const llamadas = () => leer('llamadas').split('\n').filter(Boolean);
const escrituras = () => llamadas().filter((l) => /set-iam-policy|secrets create|versions add|add-iam-policy-binding/.test(l));
const expresion = (): string =>
  JSON.parse(leer('proyecto.json')).bindings.find((b: { condition?: unknown }) => b.condition).condition.expression;
const soloLaCuenta = (n: string): string[] => (JSON.parse(leer(`iam-${n}.json`)).bindings as Array<{ role: string; members: string[] }>)
  .flatMap((b) => b.members.map((m) => `${b.role}|${m}`));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nube-alertas-'));
  bin = join(dir, 'bin'); gcloudCfg = join(dir, 'gcloud'); runtime = join(dir, 'run');
  mkdirSync(join(dir, 'tmp')); mkdirSync(join(dir, 'repo', 'scripts'), { recursive: true });
  copyFileSync(SCRIPT_REAL, join(dir, 'repo', 'scripts', 'nube-alertas.sh'));
  SCRIPT = join(dir, 'repo', 'scripts', 'nube-alertas.sh');
  chmodSync(SCRIPT, 0o755);
  writeFileSync(join(dir, 'repo', 'scripts', 'nube-visor.sh'), VISOR_FALSO);
  mkdirSync(bin); mkdirSync(gcloudCfg); mkdirSync(runtime, { mode: 0o700 }); chmodSync(runtime, 0o700);
  writeFileSync(join(bin, 'gcloud'), GCLOUD_FALSO); chmodSync(join(bin, 'gcloud'), 0o755);
  adc(PROD);
  politicaDelProyecto();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Cosas que NUNCA pueden salir en pantalla: ids, número y el valor de cualquier secreto. */
const prohibidos = (): string[] => [PROD, STAGING, NUMERO, CLAVE_RESEND, leer(`secreto-${HMAC}`)].filter((x) => x.length >= 9);

function correr(args: string[], vars: Record<string, string> = {}) {
  const r = spawnSync('env', [`CLOUDSDK_CONFIG=${gcloudCfg}`, 'bash', SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      PATH: `${bin}:/usr/bin:/bin`, FAKE_DIR: dir, GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: '',
      XDG_RUNTIME_DIR: runtime, TMPDIR: join(dir, 'tmp'), ...vars,
    }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  for (const p of prohibidos()) expect(salida).not.toContain(p);
  return { codigo: r.status, salida };
}
const APLICAR = ['--aplicar', '--confirmo', 'produccion'];
const archivoClave = (contenido = CLAVE_RESEND, modo = 0o600): string => {
  const ruta = join(runtime, 'clave-resend');
  writeFileSync(ruta, contenido, { mode: modo }); chmodSync(ruta, modo);
  return ruta;
};
const aplicarPasos = () => { expect(correr(APLICAR).codigo).toBe(0); };

describe('nube-alertas.sh: uso y salvaguardas (ni una llamada a gcloud)', () => {
  it('--help explica los modos y sale 0', () => {
    const r = correr(['--help']);
    expect(r.codigo).toBe(0);
    for (const t of ['--aplicar', '--confirmo', '--cargar-resend', '--entregar-hmac', '--invocador', '--revertir-iam', 'ALERTAS_']) expect(r.salida).toContain(t);
    expect(llamadas()).toEqual([]);
  });
  it.each([
    ['--aplicar sin --confirmo', ['--aplicar']],
    ['--confirmo de otro entorno', ['--aplicar', '--confirmo', 'staging']],
    ['una opción desconocida', ['--todo']],
    ['dos modos a la vez', ['--entregar-hmac', '--revertir-iam']],
    ['--cargar-resend sin ruta', ['--cargar-resend']],
    ['--revertir-iam --aplicar sin --confirmo', ['--revertir-iam', '--aplicar']],
  ])('%s: sale 2 sin tocar gcloud', (_n, args) => {
    expect(correr(args).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
  it('--aplicar sin GCP_PROJECT_ID_PROD: 2 sin tocar gcloud; el seco sí corre (1: hay pasos pendientes)', () => {
    expect(correr(APLICAR, { GCP_PROJECT_ID_PROD: '' }).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
    expect(correr([], { GCP_PROJECT_ID_PROD: '' }).codigo).toBe(1);
  });
  it('GCP_PROJECT_ID_PROD distinto del de las credenciales, o STAGING igual: sale 2', () => {
    expect(correr([], { GCP_PROJECT_ID_PROD: 'otro-proyecto-xyz' }).codigo).toBe(2);
    expect(correr([], { GCP_PROJECT_ID_STAGING: PROD }).codigo).toBe(2);
    adc('');
    expect(correr([]).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
  it('--cargar-resend y --entregar-hmac sin un XDG_RUNTIME_DIR válido (vacío, inexistente, modo 755): 2', () => {
    const clave = archivoClave();
    for (const xdg of ['', join(dir, 'no-existe')]) {
      expect(correr(['--cargar-resend', clave], { XDG_RUNTIME_DIR: xdg }).codigo).toBe(2);
      expect(correr(['--entregar-hmac'], { XDG_RUNTIME_DIR: xdg }).codigo).toBe(2);
    }
    chmodSync(runtime, 0o755);
    expect(correr(['--entregar-hmac']).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
  it('--cargar-resend: un archivo fuera del directorio de ejecución, con .., enlazado, de otro modo, sin la forma re_… o enorme: 2', () => {
    const fuera = join(dir, 'fuera'); writeFileSync(fuera, CLAVE_RESEND, { mode: 0o600 });
    expect(correr(['--cargar-resend', fuera]).codigo).toBe(2);
    expect(correr(['--cargar-resend', `${runtime}/../fuera`]).codigo).toBe(2);
    const real = archivoClave();
    const enlace = join(runtime, 'enlace'); symlinkSync(real, enlace);
    expect(correr(['--cargar-resend', enlace]).codigo).toBe(2);
    expect(correr(['--cargar-resend', archivoClave(CLAVE_RESEND, 0o644)]).codigo).toBe(2);
    const sinForma = correr(['--cargar-resend', archivoClave('no-es-una-clave-aunque-sea-larga-123')]);
    expect(sinForma.codigo).toBe(2);
    expect(sinForma.salida).not.toContain('no-es-una-clave');
    expect(correr(['--cargar-resend', archivoClave(`${CLAVE_RESEND}\nsegunda-linea`)]).codigo).toBe(2);
    expect(correr(['--cargar-resend', archivoClave(`re_${'a'.repeat(600)}`)]).codigo).toBe(2);
    expect(correr(['--cargar-resend', join(runtime, 'no-existe')]).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
});

describe('nube-alertas.sh: pasos 1 a 3', () => {
  it('seco: dice lo que haría (1) y NO escribe nada', () => {
    const r = correr([]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('(haría)');
    expect(r.salida).toContain('ALERTAS_');
    expect(escrituras()).toEqual([]);
    expect(expresion()).toBe(CONDICION_VIEJA);
  });
  it('aplicar: amplía la condición EN SU LUGAR con el prefijo EXACTO, conserva las demás cláusulas y no cambia el binding', () => {
    aplicarPasos();
    expect(expresion()).toBe(`${CONDICION_VIEJA} || ${CLAUSULA}`);
    expect(expresion()).not.toContain('*');
    expect(llamadas().filter((l) => /projects (add|remove)-iam-policy-binding/.test(l))).toEqual([]);
    const pol = JSON.parse(leer('proyecto.json')) as { bindings: unknown[]; etag: string };
    expect(pol.bindings).toHaveLength(2);
    expect(pol.etag).toBe('BwXXXX'); // se escribió con el etag leído
  });
  it('los secretos nacen: HMAC aleatorio y distinto en cada corrida, Resend con el marcador (no una clave)', () => {
    aplicarPasos();
    expect(leer(`secreto-${HMAC}`).length).toBeGreaterThanOrEqual(48);
    expect(leer(`secreto-${HMAC}`)).not.toContain('PENDIENTE');
    expect(leer(`secreto-${RESEND}`)).toBe('PENDIENTE-DE-CARGAR');
    const primero = leer(`secreto-${HMAC}`);
    rmSync(join(dir, `secreto-${HMAC}`)); rmSync(join(dir, `iam-${HMAC}.json`));
    aplicarPasos();
    expect(leer(`secreto-${HMAC}`)).not.toBe(primero);
  });
  it('sa-functions recibe SOLO secretAccessor, sobre cada secreto y nada más', () => {
    aplicarPasos();
    for (const n of [HMAC, RESEND]) {
      expect(soloLaCuenta(n)).toEqual([`roles/secretmanager.secretAccessor|serviceAccount:sa-functions@${PROD}.iam.gserviceaccount.com`]);
    }
    expect(llamadas().some((l) => /add-iam-policy-binding.*--member=allUsers|allAuthenticatedUsers/.test(l))).toBe(false);
  });
  it('repetir no vuelve a escribir (idempotente) y el diagnóstico posterior sale 0', () => {
    aplicarPasos();
    const antes = llamadas().length;
    expect(correr(APLICAR).codigo).toBe(0);
    expect(llamadas().slice(antes).filter((l) => /set-iam-policy|secrets create|versions add/.test(l))).toEqual([]);
    expect(expresion().split('ALERTAS_').length - 1).toBe(1);
    expect(correr([]).codigo).toBe(0);
  });
  it('si set-iam-policy falla (etag cambiado), sale 3, no crea secretos y no deja respaldo ni detalle de la nube en pantalla', () => {
    writeFileSync(join(dir, 'falla-set'), '');
    const r = correr(APLICAR);
    expect(r.codigo).toBe(3);
    expect(llamadas().some((l) => /secrets create/.test(l))).toBe(false);
    expect(r.salida).not.toContain('cuenta@ejemplo.com');
    expect(expresion()).toBe(CONDICION_VIEJA);
  });
  it('sin el binding con condición de la cuenta de despliegue: 3 y no escribe', () => {
    writeFileSync(join(dir, 'proyecto.json'), JSON.stringify({ etag: 'x', version: 3, bindings: [{ role: 'roles/run.admin', members: ['serviceAccount:otra@x.iam.gserviceaccount.com'] }] }));
    expect(correr(APLICAR).codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });
  it('--revertir-iam quita SOLO la cláusula ALERTAS_ y deja las demás', () => {
    aplicarPasos();
    expect(correr(['--revertir-iam', ...APLICAR]).codigo).toBe(0);
    expect(expresion()).toBe(CONDICION_VIEJA);
  });
});

describe('nube-alertas.sh: la clave de Resend, la clave HMAC y el invocador', () => {
  it('--cargar-resend: el seco no escribe y conserva el archivo; aplicar agrega la versión, borra el archivo y no imprime la clave', () => {
    aplicarPasos();
    const ruta = archivoClave();
    const seco = correr(['--cargar-resend', ruta]);
    expect(seco.codigo).toBe(1);
    expect(llamadas().filter((l) => /versions add/.test(l))).toEqual([]);
    expect(existe(ruta)).toBe(true);
    const r = correr(['--cargar-resend', ruta, ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(leer(`secreto-${RESEND}`)).toBe(CLAVE_RESEND);       // sin salto de línea ni marcador
    expect(existe(ruta)).toBe(false);
    expect(r.salida).toContain('REDESPLEGAR');
  });
  it('--cargar-resend sin los secretos creados: 3 y el archivo se conserva', () => {
    const ruta = archivoClave();
    expect(correr(['--cargar-resend', ruta, ...APLICAR]).codigo).toBe(3);
    expect(existe(ruta)).toBe(true);
  });
  it('--cargar-resend: si gcloud falla, el archivo se CONSERVA y el detalle no sale', () => {
    aplicarPasos();
    writeFileSync(join(dir, 'falla-add'), '');
    const ruta = archivoClave();
    const r = correr(['--cargar-resend', ruta, ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(existe(ruta)).toBe(true);
    expect(leer(`secreto-${RESEND}`)).toBe('PENDIENTE-DE-CARGAR');
  });
  it('--entregar-hmac: archivo de modo 600 con el valor, que NO sale en pantalla; la ruta sí; no pisa uno pendiente', () => {
    aplicarPasos();
    const seco = correr(['--entregar-hmac']);
    expect(seco.codigo).toBe(1);
    expect(existe(join(runtime, 'novuchat-alertas-hmac'))).toBe(false);
    const r = correr(['--entregar-hmac', ...APLICAR]);
    expect(r.codigo).toBe(0);
    const destino = join(runtime, 'novuchat-alertas-hmac');
    expect(r.salida).toContain(destino);
    expect(modoDe(destino)).toBe(0o600);
    expect(readFileSync(destino, 'utf8')).toBe(leer(`secreto-${HMAC}`));
    expect(correr(['--entregar-hmac', ...APLICAR]).codigo).toBe(2);   // ya hay uno pendiente
  });
  it('--invocador delega en nube-visor.sh con el servicio y el entorno fijos; solo con --aplicar le pasa --aplicar', () => {
    expect(correr(['--invocador']).codigo).toBe(0);
    expect(leer('visor').trim()).toBe('--servicio alertaoperativa --entorno produccion');
    rmSync(join(dir, 'visor'));
    expect(correr(['--invocador', ...APLICAR]).codigo).toBe(0);
    expect(leer('visor').trim()).toBe('--servicio alertaoperativa --entorno produccion --aplicar --confirmo produccion');
    expect(llamadas()).toEqual([]); // el invocador no toca gcloud por su cuenta
  });
  it('--invocador --aplicar sin --confirmo: 2 y nube-visor no se llama', () => {
    expect(correr(['--invocador', '--aplicar']).codigo).toBe(2);
    expect(existe(join(dir, 'visor'))).toBe(false);
  });
});

describe('nube-alertas.sh: xtrace, respaldo y entrega ajena (cuarta ronda)', () => {
  const traza = (bashArgs: string[], args: string[], vars: Record<string, string> = {}) => {
    const r = spawnSync('env', [`CLOUDSDK_CONFIG=${gcloudCfg}`, 'bash', ...bashArgs, SCRIPT, ...args], {
      encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        PATH: `${bin}:/usr/bin:/bin`, FAKE_DIR: dir, GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: '',
        XDG_RUNTIME_DIR: runtime, TMPDIR: join(dir, 'tmp'), ...vars,
      }),
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };

  it('con `bash -x` o SHELLOPTS=xtrace se NIEGA (2) antes de tocar gcloud y la clave NO sale en la traza', () => {
    aplicarPasos();
    const antes = llamadas().length;
    const ruta = archivoClave();
    for (const [bashArgs, vars] of [[['-x'], {}], [[], { SHELLOPTS: 'xtrace' }], [['-x'], { SHELLOPTS: 'xtrace' }]] as const) {
      const r = traza([...bashArgs], ['--cargar-resend', ruta, ...APLICAR], { ...vars });
      expect(r.codigo, JSON.stringify([bashArgs, vars])).toBe(2);
      expect(r.salida).toContain('xtrace');
      expect(r.salida).not.toContain(CLAVE_RESEND);
    }
    expect(llamadas().length).toBe(antes);           // ni una llamada nueva a gcloud
    expect(existe(ruta)).toBe(true);                 // y el archivo de la clave sigue ahí
    expect(leer(`secreto-${RESEND}`)).toBe('PENDIENTE-DE-CARGAR');
  });

  it('sin xtrace, la carga normal no imprime la clave ni siquiera con -v', () => {
    aplicarPasos();
    const ruta = archivoClave();
    const r = traza(['-v'], ['--cargar-resend', ruta, ...APLICAR]);
    expect(r.salida).not.toContain(CLAVE_RESEND);
  });

  it('con --aplicar el respaldo de la política anterior QUEDA (modo 600, con la política vieja) y se imprime su ruta', () => {
    const r = correr(APLICAR);
    expect(r.codigo).toBe(0);
    const m = /respaldo de la política anterior[^:]*: (\S+)/.exec(r.salida);
    expect(m, r.salida).not.toBeNull();
    const ruta = m![1]!;
    expect(existe(ruta)).toBe(true);
    expect(modoDe(ruta)).toBe(0o600);
    const guardada = JSON.parse(readFileSync(ruta, 'utf8')) as { bindings: Array<{ condition?: { expression: string } }> };
    expect(guardada.bindings.find((b) => b.condition)!.condition!.expression).toBe(CONDICION_VIEJA);
  });

  it('si set-iam-policy falla NO se deja respaldo', () => {
    writeFileSync(join(dir, 'falla-set'), '');
    expect(/respaldo de la política anterior/.test(correr(APLICAR).salida)).toBe(false);
  });

  it('--entregar-hmac NO borra ni pisa un archivo ajeno que ya esté en el destino', () => {
    aplicarPasos();
    const destino = join(runtime, 'novuchat-alertas-hmac');
    writeFileSync(destino, 'contenido-ajeno', { mode: 0o600 });
    const r = correr(['--entregar-hmac', ...APLICAR]);
    expect(r.codigo).toBe(2);
    expect(readFileSync(destino, 'utf8')).toBe('contenido-ajeno');
  });

  it('--entregar-hmac: si gcloud falla borra SOLO lo que creó', () => {
    aplicarPasos();
    rmSync(join(dir, `secreto-${HMAC}`));              // el gcloud falso no tiene qué entregar
    const r = correr(['--entregar-hmac', ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(existe(join(runtime, 'novuchat-alertas-hmac'))).toBe(false);
  });
});
