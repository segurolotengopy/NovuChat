/**
 * LA CLAVE DE LA API DE n8n NUNCA VA EN LOS ARGUMENTOS DE UN PROCESO.
 *
 * `N8N_API_KEY` es una credencial de administración de TODA la instancia:
 * lee y reescribe cualquier flujo, también los de WhatsApp-Modular. Puesta en
 * `curl -H "X-N8N-API-KEY: $N8N_API_KEY"`, la ve cualquier usuario de la
 * máquina en `ps` o en /proc/<pid>/cmdline mientras curl corre. Va por la
 * entrada estándar (`-H @- <<<"X-N8N-API-KEY: …"`); en Node, por `input`.
 *
 * La rama de los pendientes del #265 lo hace en `webhook-meta.sh`; el #276
 * lo cierra en los que hablan con la API de n8n —`publicar-flujo.sh`,
 * `ver-ejecuciones.sh`, `credenciales-flujo.sh` y `comparar-prompt.mjs`, más
 * la misma `api()` de `webhook-meta.sh`— y lo exige en TODO archivo versionado.
 *
 * Dos mitades. En la fuente: en un .sh la clave solo aparece en las formas
 * permitidas (ver `clavesFueraDeLugar`), y en Node o Python ningún lanzamiento
 * de curl la lleva en sus argumentos. En ejecución: los scripts
 * reales corren contra un `curl` falso adelante en el PATH
 * (`curl-falso-n8n.sh`), en una copia del repositorio en un directorio
 * temporal (publicar-flujo.sh deja respaldos en Flujos/), sin red ni n8n, y
 * cada llamada a la API muestra la clave en la entrada estándar y en ningún
 * argumento.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '..', '..', '..');
const CLAVE = 'clave-n8n-de-prueba';
const CABECERA = `‹X-N8N-API-KEY: ${CLAVE}›`;

const versionados = (...patrones: string[]) =>
  execFileSync('git', ['ls-files', '-z', ...patrones], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
const fuente = (r: string) => readFileSync(join(REPO, r), 'utf8');
/** Líneas lógicas: las terminadas en «\» se unen con la siguiente. */
const logicas = (texto: string) => texto.replace(/\\\n/g, ' ').split('\n');
const esComentario = (l: string) => /^\s*(?:#|\/\/|\*)/.test(l);

/**
 * EN UN .sh, LA CLAVE SOLO PUEDE APARECER EN CUATRO FORMAS, y todo lo demás es
 * una falla (lista de formas permitidas, no de prohibidas: revisión de
 * seguridad del #276, L-2). Una lista de prohibidas deja pasar lo que nadie
 * previó —la cabecera partida en dos comillas, `printf -v`, un alias, otro
 * programa que no es curl—.
 *   1. comprobada con `:` —  : "${N8N_API_KEY:?Falta…}"  (builtin, sin proceso);
 *   2. como prefijo de entorno de un comando —  N8N_API_KEY="$N8N_API_KEY" python3 -
 *      (va al entorno del hijo, que solo lee su dueño);
 *   3. en la entrada estándar de curl —  -H @- … <<<"X-N8N-API-KEY: $N8N_API_KEY";
 *   4. nunca copiada a otra variable: un alias sale del alcance de esta guarda.
 * La cabecera `X-N8N-API-KEY:` fuera de ese `<<<` tampoco (va a terminar en argv).
 */
function clavesFueraDeLugar(texto: string): string[] {
  const CLAVE = /\$\{?N8N_API_KEY\b/;
  const CABECERA_SH = /X-N8N-API-KEY\s*:/i;
  const ASIGNACIONES = /^\s*((?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s;|&()]*)\s*)+)/;
  return logicas(texto).filter((l) => {
    if (esComentario(l)) return false;
    const resto = l
      // 1. `: "${N8N_API_KEY:?…}"`, solo como argumento de `:`.
      .replace(/(^|;)(\s*:)((?:\s+"\$\{\w+:\?[^"}]*\}")+)/g,
        (_, a: string, b: string, c: string) => a + b + c.replace(/"\$\{N8N_API_KEY:\?[^"}]*\}"/g, '""'))
      // 3. La entrada estándar de curl, en su forma exacta.
      .replace(/<<<\s*"X-N8N-API-KEY: \$\{?N8N_API_KEY\}?"/g, '<<<""');
    return resto.split(/;|&&|\|\|?|\$\(|[()]/).some((sentencia) => {
      const prefijo = ASIGNACIONES.exec(sentencia)?.[1] ?? '';
      const comando = sentencia.slice(prefijo.length);
      // 4. Solo asignaciones: la clave copiada a otra variable.
      if (!comando.trim()) return CLAVE.test(prefijo);
      // 2. Prefijo de entorno de un comando: permitido; lo que sigue, no.
      return CLAVE.test(comando) || CABECERA_SH.test(comando) || CABECERA_SH.test(prefijo);
    });
  });
}

/**
 * Node y Python: el arreglo de argumentos de cada lanzamiento de curl (desde
 * su `[` hasta el `]` que lo cierra, aunque ocupe varias líneas) y toda orden
 * de shell que empiece con `curl `, sin la clave ni la cabecera. La clave va
 * por `input` (Node) o por la entrada estándar del proceso.
 */
function enLanzamientoDeCurl(texto: string): string[] {
  const NOMBRA = /N8N_API_KEY|X-N8N-API-KEY/i;
  const cerrar = (desde: number, abre: string, cierra: string) => {
    let hondura = 0;
    for (let i = desde; i < texto.length; i++) {
      if (texto[i] === abre) hondura++;
      else if (texto[i] === cierra && --hondura === 0) return texto.slice(desde, i + 1);
    }
    return texto.slice(desde);
  };
  const malos: string[] = [];
  for (const m of texto.matchAll(/(['"])curl\1/g)) {
    const antes = texto.slice(0, m.index).trimEnd();
    const inicio = antes.endsWith('[') ? antes.length - 1 : texto.indexOf('[', m.index);
    if (inicio < 0) continue;
    const argumentos = cerrar(inicio, '[', ']');
    if (NOMBRA.test(argumentos)) malos.push(argumentos.split('\n')[0]);
  }
  for (const m of texto.matchAll(/([`'"])curl\s(?:(?!\1)[^\n])*\1/g)) {
    if (NOMBRA.test(m[0])) malos.push(m[0]);
  }
  return malos;
}

describe('en la fuente', () => {
  const sh = versionados('*.sh');

  it('recorre todos los .sh versionados, en cualquier carpeta', () => {
    for (const s of ['publicar-flujo.sh', 'ver-ejecuciones.sh', 'credenciales-flujo.sh', 'webhook-meta.sh']) {
      expect(sh).toContain(`scripts/${s}`);
    }
    expect(sh.length).toBeGreaterThan(40);
  });

  it('el detector ve la forma vieja y las que se le escapaban a la primera guarda (#276, L-2)', () => {
    const malas = [
      'curl -s --max-time 30 -H "X-N8N-API-KEY: $N8N_API_KEY" "$URL"',
      'COD=$(curl -s -o "$TMP/v.json" \\\n      -H "X-N8N-API-KEY: ${N8N_API_KEY}" "${API}/workflows/1" || echo 000)',
      'curl -s -u "api:${N8N_API_KEY}" "$URL"',
      'curl -s "$URL?clave=$N8N_API_KEY"',
      'curl --header "x-n8n-api-key: $N8N_API_KEY" "$URL"',
      'H=(-H "X-N8N-API-KEY: $N8N_API_KEY")',
      `curl -H 'X-N8N-API-KEY: '"$K" "$URL"`,
      'printf -v H "X-N8N-API-KEY: %s" "$N8N_API_KEY"; curl -H "$H" "$URL"',
      `python3 -c 'import sys; print(sys.argv[1])' "$N8N_API_KEY"`,
      'K="$N8N_API_KEY"',
      'curl -H @- "$U" <<<"X-N8N-API-KEY: $N8N_API_KEY"; curl -H "X-N8N-API-KEY: $N8N_API_KEY" "$U"',
      'curl "${N8N_API_KEY:?}" "$U"',
    ];
    for (const m of malas) expect(clavesFueraDeLugar(m), m).toHaveLength(1);

    const buenas = [
      ': "${N8N_API_KEY:?Falta N8N_API_KEY en .env (n8n: Settings -> n8n API)}"',
      ': "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}"; : "${X:?}"',
      '  N8N_BASE_URL="$N8N_BASE_URL" N8N_API_KEY="$N8N_API_KEY" \\\n  python3 - <<\'PY\'',
      'COD=$(curl -s -o "$TMP/v.json" \\\n      -H @- "${API}/workflows/1" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)',
      'curl -s -X "$1" -H @- "$API$2" <<<"X-N8N-API-KEY: $N8N_API_KEY"',
      '        headers={"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Accept": "application/json"})',
    ];
    for (const b of buenas) expect(clavesFueraDeLugar(b), b).toEqual([]);

    const lanzamientos = [
      "execFileSync('curl', ['-H', `X-N8N-API-KEY: ${env['N8N_API_KEY']}`, url])",
      "execFileSync('curl',\n  ['-fsS', '-H',\n   `X-N8N-API-KEY: ${env['N8N_API_KEY']}`, url])",
      'subprocess.run(["curl",\n    "-H", f"X-N8N-API-KEY: {key}", url])',
      'execSync(`curl -H "X-N8N-API-KEY: ${k}" ${url}`)',
    ];
    for (const x of lanzamientos) expect(enLanzamientoDeCurl(x), x).toHaveLength(1);
    expect(enLanzamientoDeCurl(
      "execFileSync('curl', ['-fsS', '-H', '@-', url],\n  { input: `X-N8N-API-KEY: ${env['N8N_API_KEY']}` })")).toEqual([]);
  });

  it('ningún .sh nombra la clave fuera de las cuatro formas permitidas', () => {
    const malas = sh.flatMap((r) => clavesFueraDeLugar(fuente(r)).map((l) => `${r}: ${l.trim()}`));
    expect(malas).toEqual([]);
  });

  it('ningún .mjs, .js, .ts ni .py lanza curl con la clave en los argumentos', () => {
    const otros = versionados('*.mjs', '*.cjs', '*.js', '*.ts', '*.py').filter((r) => !r.endsWith('.test.ts'));
    expect(otros).toContain('scripts/comparar-prompt.mjs');
    const malas = otros.flatMap((r) => enLanzamientoDeCurl(fuente(r)).map((l) => `${r}: ${l.trim()}`));
    expect(malas).toEqual([]);
  });

  it('comparar-prompt.mjs manda la cabecera por la entrada estándar', () => {
    const f = fuente('scripts/comparar-prompt.mjs');
    expect(f).toMatch(/execFileSync\('curl', \['-fsS', '-H', '@-', url\]/);
    expect(f).toMatch(/input: `X-N8N-API-KEY: \$\{env\['N8N_API_KEY'\]\}`/);
  });
});

describe('en ejecución, contra un curl falso', () => {
  let dir: string;
  let raiz: string;
  let registro: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clave-n8n-'));
    raiz = join(dir, 'repo');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos'));
    mkdirSync(join(dir, 'bin'));
    for (const s of ['publicar-flujo.sh', 'ver-ejecuciones.sh', 'credenciales-flujo.sh', 'webhook-meta.sh']) {
      copyFileSync(join(REPO, 'scripts', s), join(raiz, 'scripts', s));
    }
    // Las bibliotecas que los scripts cargan con `source scripts/lib/…` (el
    // candado de apps ajenas, en la rama de los pendientes del #265): sin
    // ellas, la suite se cae apenas se fusionen las dos (revisión del #276, L-1).
    if (existsSync(join(REPO, 'scripts', 'lib'))) {
      cpSync(join(REPO, 'scripts', 'lib'), join(raiz, 'scripts', 'lib'), { recursive: true });
    }
    copyFileSync(join(AQUI, 'curl-falso-n8n.sh'), join(dir, 'bin', 'curl'));
    chmodSync(join(dir, 'bin', 'curl'), 0o755);
    registro = join(dir, 'curl.log');
    writeFileSync(registro, '');
    writeFileSync(join(raiz, '.env.prueba'),
      `N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=${CLAVE}\nN8N_WORKFLOW_ID=7\n`, { mode: 0o600 });
    writeFileSync(join(raiz, 'Flujos', 'prueba.json'),
      JSON.stringify({ name: 'Flujo de prueba', nodes: [], connections: {}, settings: {} }));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Corre un script de la copia y devuelve cada llamada a curl: argumentos y entrada estándar. */
  function correr(script: string, args: string[], extra: Record<string, string> = {}) {
    const r = spawnSync('bash', [join('scripts', script), ...args], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        ...extra,
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, BASH_ENV: '', ENV: '',
        REGISTRO_CURL: registro,
        // Si algo intentara salir a la red, que choque con un puerto muerto.
        HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1',
        https_proxy: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1', NO_PROXY: '', no_proxy: '',
      }),
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const llamadas = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
    return { llamadas, api: llamadas.filter((l) => l.includes('/api/v1/')), salida: r.stdout };
  }

  /** La clave, en la entrada estándar de cada llamada a la API y en ningún argumento. */
  function sinClaveEnArgumentos(llamadas: string[], api: string[]) {
    expect(api.length).toBeGreaterThan(0);
    for (const l of llamadas) expect(l.split('‹')[0], l).not.toContain(CLAVE);
    for (const l of api) expect(l, l).toContain(CABECERA);
  }

  const flujo = ['--env', '.env.prueba', '--flujo', 'Flujos/prueba.json'];

  it.each([
    ['diagnóstico', [] as string[], ['GET /workflows/7', 'GET /credentials']],
    ['--aplicar', ['--aplicar'], ['GET /workflows/7', 'GET /credentials', 'PUT /workflows/7']],
    ['--crear --activar --aplicar', ['--crear', '--activar', '--aplicar'],
      ['GET /workflows/7', 'GET /credentials', 'GET /workflows?', 'POST /workflows ', 'POST /workflows/99/activate']],
    ['--encender --aplicar', ['--encender', '--aplicar'], ['GET /workflows/7', 'POST /workflows/7/activate']],
    ['--apagar --aplicar', ['--apagar', '--aplicar'], ['GET /workflows/7', 'POST /workflows/7/deactivate']],
    ['--reiniciar-estado --aplicar', ['--reiniciar-estado', '--aplicar'],
      ['GET /workflows/7', 'PUT /workflows/7', 'GET /workflows/7']],
  ])('publicar-flujo.sh %s', (_, args, esperadas) => {
    const { llamadas, api } = correr('publicar-flujo.sh', [...flujo, ...args]);
    sinClaveEnArgumentos(llamadas, api);
    // Cada llamada esperada, en orden: la prueba no pasa en vacío si el script corta antes.
    const vistas = api.map((l) => `${l.split(' ')[0]} ${l.replace(/^.*\/api\/v1(\S*).*$/, '$1')} `);
    let desde = 0;
    for (const e of esperadas) {
      const i = vistas.findIndex((v, j) => j >= desde && v.startsWith(e));
      expect(i, `${e} en ${vistas.join(' | ')}`).toBeGreaterThanOrEqual(0);
      desde = i + 1;
    }
  });

  it('ver-ejecuciones.sh --error: la lista y el detalle de cada fallida', () => {
    const ejecuciones = JSON.stringify({ data: [{ id: '31', status: 'error', stoppedAt: 'x' }] });
    const { llamadas, api } = correr('ver-ejecuciones.sh', ['--env', '.env.prueba', '--error'],
      { RESPUESTA_EJECUCIONES: ejecuciones });
    sinClaveEnArgumentos(llamadas, api);
    expect(api).toHaveLength(2);
    expect(api[1]).toContain('/api/v1/executions/31?includeData=true');
  });

  it('ver-ejecuciones.sh --id', () => {
    const { llamadas, api } = correr('ver-ejecuciones.sh', ['--env', '.env.prueba', '--id', '31']);
    sinClaveEnArgumentos(llamadas, api);
    expect(api).toHaveLength(1);
  });

  it('credenciales-flujo.sh', () => {
    const { llamadas, api, salida } = correr('credenciales-flujo.sh', ['--env', '.env.prueba']);
    sinClaveEnArgumentos(llamadas, api);
    expect(salida).toContain('Flujo de prueba');
  });

  it('webhook-meta.sh --preparar: la función api() también', () => {
    const { llamadas, api } = correr('webhook-meta.sh',
      ['--preparar', '--webhook-id', 'ruta-de-prueba', '--flujo-id', '7', '--env-n8n', '.env.prueba']);
    sinClaveEnArgumentos(llamadas, api);
    expect(api.some((l) => l.startsWith('POST ') && / https:\/\/n8n\.invalid\/api\/v1\/workflows ‹/.test(l))).toBe(true);
  });
});
