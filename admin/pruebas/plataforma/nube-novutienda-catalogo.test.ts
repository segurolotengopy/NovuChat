/**
 * `scripts/nube-novutienda-catalogo.sh`: el script de nube de PRODUCCIÓN del secreto NOVUTIENDA_CATALOGO.
 * Con un `gcloud` FALSO y con estado (un directorio temporal): guarda las versiones del secreto y anota cada llamada
 * (solo los argumentos, nunca la entrada estándar). NO se ejecuta nada contra la nube.
 * Las pruebas niegan: lo que no debe pasar no escribe, y el token nunca aparece en la salida ni en los argumentos de gcloud.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'nube-novutienda-catalogo.sh');
const PROYECTO = 'proy-prueba-123';
const TOKEN = 'tok-secreto-ZZ9988776655';
const HOST = 'tienda.example.org';
const ENTREGA_OK = { baseUrl: `https://${HOST}`, endpoint: '/api/novuchat/v1/catalogo', token: TOKEN };

const GCLOUD_FALSO = `#!/usr/bin/env bash
set -u
E="$FAKE_DIR/estado"; mkdir -p "$E/v"
echo "$*" >> "$FAKE_DIR/llamadas"
args=(); while [ $# -gt 0 ]; do case "$1" in --project) shift 2 ;; --quiet) shift ;; *) args+=("$1"); shift ;; esac; done
set -- "\${args[@]}"
ultima() { ls "$E/v" | sort -n | tail -1; }
case "$1 $2" in
  "projects describe") echo 123456789012 ;;
  "projects get-iam-policy")
    if [ "\${FAKE_SIN_IAM:-0}" = 1 ]; then expr='resource.name.startsWith("projects/123456789012/secrets/OTRO_")'
    else expr='resource.name.startsWith("projects/123456789012/secrets/OTRO_") || resource.name.startsWith("projects/123456789012/secrets/NOVUTIENDA_")'; fi
    printf '{"bindings":[{"role":"projects/x/roles/desplegadorSecretos","members":["serviceAccount:sa-deploy-prod@%s.iam.gserviceaccount.com"],"condition":{"title":"secretos-de-las-functions","expression":%s}}]}' "$FAKE_PROYECTO" "$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$expr")" ;;
  "secrets describe") [ -f "$E/existe" ] || exit 1 ;;
  "secrets create") cat > "$E/v/1"; touch "$E/existe" ;;
  "secrets get-iam-policy")
    if [ -f "$E/accessor" ]; then printf '{"bindings":[{"role":"roles/secretmanager.secretAccessor","members":["serviceAccount:sa-functions@%s.iam.gserviceaccount.com"]}]}' "$FAKE_PROYECTO"; else echo '{}'; fi ;;
  "secrets add-iam-policy-binding") touch "$E/accessor" ;;
  "secrets versions")
    case "$3" in
      list) if printf '%s ' "$@" | grep -q -- '--limit=1'; then ultima; else ls "$E/v"; fi ;;
      access)
        [ -f "$E/v/$4" ] || exit 1
        cat "$E/v/$4"
        if [ "\${FAKE_CARRERA:-0}" = 1 ] && [ ! -f "$E/carrera" ]; then touch "$E/carrera"; echo '{"otro":{"baseUrl":"https://x.example.org","bearer":"12345678"}}' > "$E/v/$(( $(ultima) + 1 ))"; fi ;;
      add) n=$(( $(ultima) + 1 )); cat > "$E/v/$n"; echo "projects/123456789012/secrets/NOVUTIENDA_CATALOGO/versions/$n" ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
`;

let dir: string;
let descargas: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nube-cat-'));
  mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'run'), { mode: 0o700 }); chmodSync(join(dir, 'run'), 0o700);
  mkdirSync(join(dir, 'gcloud-cfg'));
  writeFileSync(join(dir, 'gcloud-cfg', 'application_default_credentials.json'), JSON.stringify({ quota_project_id: PROYECTO }));
  descargas = join(dir, 'CLAUDE_DESCARGAS'); mkdirSync(descargas);
  writeFileSync(join(dir, 'bin', 'gcloud'), GCLOUD_FALSO);
  chmodSync(join(dir, 'bin', 'gcloud'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const llamadas = () => (existsSync(join(dir, 'llamadas')) ? readFileSync(join(dir, 'llamadas'), 'utf8') : '');
const escrituras = () => llamadas().split('\n').filter((l) => /secrets (create|versions add|add-iam-policy-binding)/.test(l));
const version = (n: number) => join(dir, 'estado', 'v', String(n));
const versiones = () => (existsSync(join(dir, 'estado', 'v')) ? readdirSync(join(dir, 'estado', 'v')).length : 0);
/** Siembra el secreto con un mapa vigente (versión 1), con el acceso de sa-functions. */
function sembrar(mapa: object = { otro: { baseUrl: 'https://x.example.org', bearer: '12345678' } }) {
  mkdirSync(join(dir, 'estado', 'v'), { recursive: true });
  writeFileSync(version(1), JSON.stringify(mapa)); writeFileSync(join(dir, 'estado', 'existe'), ''); writeFileSync(join(dir, 'estado', 'accessor'), '');
}
function correr(args: string[], extra: Record<string, string> = {}, bashArgs: string[] = []) {
  // `entornoDelEmulador` fija CLOUDSDK_CONFIG a una ruta inexistente (hijos-hermeticos.test.ts); el envoltorio de bash
  // lo repone SOLO para el script, con la carpeta de credenciales falsas de la prueba. El resto del entorno sigue cerrado.
  const r = spawnSync('bash', ['-c', `CLOUDSDK_CONFIG="$FAKE_CFG" exec bash ${bashArgs.join(' ')} "$0" "$@"`, SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, FAKE_DIR: dir, FAKE_PROYECTO: PROYECTO, XDG_RUNTIME_DIR: join(dir, 'run'), HOME: dir,
      FAKE_CFG: join(dir, 'gcloud-cfg'), GCP_PROJECT_ID_PROD: PROYECTO, GCP_PROJECT_ID_STAGING: '', SHELLOPTS: '', ...extra,
    }),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
function entrega(contenido: object | string = ENTREGA_OK, modo = 0o600) {
  const ruta = join(descargas, 'NOVUTIENDA_token.json');
  writeFileSync(ruta, typeof contenido === 'string' ? contenido : JSON.stringify(contenido), { mode: modo }); chmodSync(ruta, modo);
  return ruta;
}
const CARGAR = (ruta: string, extra: string[] = []) => ['--cargar', ruta, '--tenant', 'casa-bermejo', '--host', HOST, ...extra];
const APLICAR = ['--aplicar', '--confirmo', 'produccion'];
/** Nada del token ni del proyecto se ve en la salida ni en lo que recibió gcloud. */
function sinFugas(salida: string) {
  expect(salida).not.toContain(TOKEN);
  expect(salida).not.toContain(PROYECTO);
  expect(llamadas()).not.toContain(TOKEN);
  expect(llamadas()).not.toContain('tok-secreto');
}

describe('nube-novutienda-catalogo.sh: salvaguardas (se niega sin escribir)', () => {
  it('trae el prefijo y el secreto exactos', () => {
    const f = readFileSync(SCRIPT, 'utf8');
    expect(f).toContain('readonly PREFIJO="NOVUTIENDA_"');
    expect(f).toContain('readonly SECRETO="NOVUTIENDA_CATALOGO"');
  });
  it('--aplicar sin --confirmo produccion (o con otro valor): sale 2 sin llamar a gcloud', () => {
    expect(correr(['--aplicar']).codigo).toBe(2);
    expect(correr(['--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
    expect(correr(CARGAR(entrega()).concat(['--aplicar'])).codigo).toBe(2);
    expect(llamadas()).toBe('');
  });
  it('xtrace (bash -x o SHELLOPTS): sale 2 sin llamar a gcloud', () => {
    expect(correr([], {}, ['-x']).codigo).toBe(2);
    expect(correr([], { SHELLOPTS: 'xtrace' }).codigo).toBe(2);
    expect(llamadas()).toBe('');
  });
  it('--aplicar sin GCP_PROJECT_ID_PROD, o con otro proyecto: sale 2 sin escribir', () => {
    expect(correr(APLICAR, { GCP_PROJECT_ID_PROD: '' }).codigo).toBe(2);
    expect(correr(APLICAR, { GCP_PROJECT_ID_PROD: 'otro-proyecto-999' }).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });
  it('dos modos, opciones desconocidas o --tenant fuera de --cargar: sale 2', () => {
    expect(correr(['--cargar', entrega(), '--revertir', '1']).codigo).toBe(2);
    expect(correr(['--inventada']).codigo).toBe(2);
    expect(correr(['--tenant', 'casa-bermejo']).codigo).toBe(2);
    expect(llamadas()).toBe('');
  });
  it('archivo: modo 644, enlace simbólico, enlace duro, fuera de ~/CLAUDE_DESCARGAS: sale 2 sin llamar a gcloud', () => {
    sembrar();
    expect(correr(CARGAR(entrega(ENTREGA_OK, 0o644))).codigo).toBe(2);
    const real = entrega(); const enlace = join(descargas, 'enlace.json');
    symlinkSync(real, enlace);
    expect(correr(CARGAR(enlace)).codigo).toBe(2);
    rmSync(enlace);
    linkSync(real, enlace);
    expect(correr(CARGAR(real)).codigo).toBe(2);
    rmSync(enlace);
    const fuera = join(dir, 'run', 'fuera.json'); writeFileSync(fuera, JSON.stringify(ENTREGA_OK), { mode: 0o600 });
    expect(correr(CARGAR(fuera)).codigo).toBe(2);
    expect(llamadas()).toBe('');
  });
  it('contenido inválido (host distinto, puerto 8443, token corto, clave extra, huella que no coincide, http, usuario, query, endpoint ajeno): sale 1 sin escribir ni imprimir el token', () => {
    sembrar();
    const casos: Array<[string, object | string, string[]]> = [
      ['host distinto', { ...ENTREGA_OK, baseUrl: 'https://otro.example.org' }, []],
      ['puerto 8443', { ...ENTREGA_OK, baseUrl: `https://${HOST}:8443` }, []],
      ['token corto', { ...ENTREGA_OK, token: 'corto' }, []],
      ['clave extra', { ...ENTREGA_OK, extra: 'x' }, []],
      ['falta endpoint', { baseUrl: ENTREGA_OK.baseUrl, token: TOKEN }, []],
      ['huella que no coincide', ENTREGA_OK, ['--huella', '00000000']],
      ['http', { ...ENTREGA_OK, baseUrl: `http://${HOST}` }, []],
      ['usuario y clave', { ...ENTREGA_OK, baseUrl: `https://u:p@${HOST}` }, []],
      ['query', { ...ENTREGA_OK, baseUrl: `https://${HOST}?a=1` }, []],
      ['endpoint ajeno', { ...ENTREGA_OK, endpoint: '/otra/ruta' }, []],
      ['no es JSON', '{no es json', []],
    ];
    for (const [nombre, contenido, extra] of casos) {
      const r = correr([...CARGAR(entrega(contenido), extra), ...APLICAR]);
      expect(r.codigo, nombre).toBe(1);
      sinFugas(r.salida);
    }
    expect(escrituras()).toEqual([]);
    expect(versiones()).toBe(1);
    expect(existsSync(join(descargas, 'NOVUTIENDA_token.json'))).toBe(true);
  });
});

describe('nube-novutienda-catalogo.sh: diagnóstico y creación', () => {
  it('seco con el secreto sin crear: sale 1, dice qué haría y no escribe', () => {
    const r = correr([]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('(haría)');
    expect(escrituras()).toEqual([]);
    sinFugas(r.salida);
  });
  it('seco con todo en orden: sale 0 y no escribe', () => {
    sembrar();
    const r = correr([]);
    expect(r.codigo).toBe(0);
    expect(escrituras()).toEqual([]);
  });
  it('--aplicar crea el secreto con {} y da secretAccessor solo sobre ese secreto', () => {
    const r = correr(APLICAR);
    expect(r.codigo).toBe(0);
    expect(readFileSync(version(1), 'utf8')).toBe('{}');
    const bind = llamadas().split('\n').filter((l) => l.includes('add-iam-policy-binding'));
    expect(bind).toHaveLength(1);
    expect(bind[0]).toContain('secrets add-iam-policy-binding NOVUTIENDA_CATALOGO');
    expect(bind[0]).toContain('roles/secretmanager.secretAccessor');
    expect(llamadas()).not.toMatch(/projects (set|add)-iam/);
    sinFugas(r.salida);
  });
  it('--aplicar con la condición IAM sin el prefijo: no escribe nada (IAM no se edita acá)', () => {
    const r = correr(APLICAR, { FAKE_SIN_IAM: '1' });
    expect(r.codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(llamadas()).not.toMatch(/set-iam-policy/);
  });
});

describe('nube-novutienda-catalogo.sh: --cargar', () => {
  it('sin --aplicar: valida y fusiona pero no escribe ni borra el archivo', () => {
    sembrar();
    const ruta = entrega();
    const r = correr(CARGAR(ruta));
    expect(r.codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(ruta)).toBe(true);
    sinFugas(r.salida);
  });
  it('con --aplicar: agrega una versión con SOLO {baseUrl, bearer}, conserva las demás, no destruye la anterior y borra el archivo', () => {
    const otro = { baseUrl: 'https://x.example.org', bearer: '12345678' };
    sembrar({ otro });
    const ruta = entrega();
    const huella = createHash('sha256').update(TOKEN).digest('hex').slice(0, 8);
    const r = correr([...CARGAR(ruta, ['--huella', huella]), ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(versiones()).toBe(2);
    expect(JSON.parse(readFileSync(version(1), 'utf8'))).toEqual({ otro });
    expect(JSON.parse(readFileSync(version(2), 'utf8'))).toEqual({ otro, 'casa-bermejo': { baseUrl: `https://${HOST}`, bearer: TOKEN } });
    expect(readFileSync(version(2), 'utf8')).not.toContain('endpoint');
    expect(llamadas()).not.toMatch(/disable|destroy|delete/);
    expect(existsSync(ruta)).toBe(false);
    expect(r.salida).toContain('REDESPLEGAR');
    sinFugas(r.salida);
  });
  it('reemplaza la entrada del mismo comercio sin tocar las otras', () => {
    const otro = { baseUrl: 'https://x.example.org', bearer: '12345678' };
    sembrar({ otro, 'casa-bermejo': { baseUrl: `https://${HOST}`, bearer: 'token-viejo-1234' } });
    expect(correr([...CARGAR(entrega()), ...APLICAR]).codigo).toBe(0);
    expect(JSON.parse(readFileSync(version(2), 'utf8'))).toEqual({ otro, 'casa-bermejo': { baseUrl: `https://${HOST}`, bearer: TOKEN } });
  });
  it('escritura simultánea (la versión vigente cambió): aborta sin escribir y conserva el archivo', () => {
    sembrar();
    const ruta = entrega();
    const r = correr([...CARGAR(ruta), ...APLICAR], { FAKE_CARRERA: '1' });
    expect(r.codigo).toBe(1);
    expect(llamadas()).not.toContain('versions add');
    expect(existsSync(ruta)).toBe(true);
    expect(r.salida).toContain('cambió mientras se preparaba');
    sinFugas(r.salida);
  });
  it('si el secreto no existe: sale 3 sin escribir y conserva el archivo', () => {
    const ruta = entrega();
    expect(correr([...CARGAR(ruta), ...APLICAR]).codigo).toBe(3);
    expect(escrituras()).toEqual([]);
    expect(existsSync(ruta)).toBe(true);
  });
  it('si el secreto vigente no es un objeto JSON: sale 1 sin escribir y conserva el archivo', () => {
    sembrar(); writeFileSync(version(1), '[1,2]');
    const ruta = entrega();
    expect(correr([...CARGAR(ruta), ...APLICAR]).codigo).toBe(1);
    expect(llamadas()).not.toContain('versions add');
    expect(existsSync(ruta)).toBe(true);
  });
  it('si gcloud no puede agregar la versión: sale 3 y conserva el archivo', () => {
    sembrar();
    const ruta = entrega();
    // Un gcloud que falla solo al agregar.
    const g = readFileSync(join(dir, 'bin', 'gcloud'), 'utf8').replace('add) n=', 'add) exit 1; n=');
    writeFileSync(join(dir, 'bin', 'gcloud'), g);
    const r = correr([...CARGAR(ruta), ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(existsSync(ruta)).toBe(true);
    sinFugas(r.salida);
  });
  it('si la relectura no coincide: sale 4 y conserva el archivo', () => {
    sembrar();
    const ruta = entrega();
    // Un gcloud que guarda algo distinto de lo recibido.
    const g = readFileSync(join(dir, 'bin', 'gcloud'), 'utf8').replace('add) n=$(( $(ultima) + 1 )); cat >', 'add) n=$(( $(ultima) + 1 )); echo \'{"mal":{}}\' >');
    writeFileSync(join(dir, 'bin', 'gcloud'), g);
    const r = correr([...CARGAR(ruta), ...APLICAR]);
    expect(r.codigo).toBe(4);
    expect(existsSync(ruta)).toBe(true);
    sinFugas(r.salida);
  });
});

describe('nube-novutienda-catalogo.sh: --revertir', () => {
  it('agrega una versión nueva con el contenido de la N y nunca deshabilita', () => {
    sembrar();
    writeFileSync(version(2), JSON.stringify({ otro: { baseUrl: 'https://x.example.org', bearer: '12345678' }, malo: { baseUrl: 'https://m.example.org', bearer: 'abcdefgh' } }));
    const r = correr(['--revertir', '1', ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(versiones()).toBe(3);
    expect(readFileSync(version(3), 'utf8')).toBe(readFileSync(version(1), 'utf8'));
    expect(llamadas()).not.toMatch(/disable|destroy|delete/);
    expect(r.salida).toContain('REDESPLEGAR');
  });
  it('sin --aplicar no escribe; con una versión inexistente sale 1 sin escribir', () => {
    sembrar();
    expect(correr(['--revertir', '1']).codigo).toBe(1);
    expect(correr(['--revertir', '9', ...APLICAR]).codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(versiones()).toBe(1);
  });
  it('si la versión vigente cambió mientras se preparaba: aborta sin escribir', () => {
    sembrar();
    const r = correr(['--revertir', '1', ...APLICAR], { FAKE_CARRERA: '1' });
    expect(r.codigo).toBe(1);
    expect(llamadas()).not.toContain('versions add');
  });
});
