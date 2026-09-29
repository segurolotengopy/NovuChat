/**
 * LA CLAVE DE LA API DE n8n NUNCA VA EN LOS ARGUMENTOS DE UN PROCESO.
 *
 * `N8N_API_KEY` es una credencial de administración de TODA la instancia:
 * lee y reescribe cualquier flujo, también los de WhatsApp-Modular. Puesta en
 * `curl -H "X-N8N-API-KEY: $N8N_API_KEY"`, la ve cualquier usuario de la
 * máquina en `ps` o en /proc/<pid>/cmdline mientras curl corre. Va por la
 * entrada estándar (`-H @- <<<"X-N8N-API-KEY: …"`); en Node, por `input`.
 *
 * El PR de los pendientes del #265 lo hizo en los scripts de Meta
 * (`webhook-meta.sh`); este lo cierra en los que hablan con la API de n8n
 * —`publicar-flujo.sh`, `ver-ejecuciones.sh`, `credenciales-flujo.sh` y
 * `comparar-prompt.mjs`— y lo exige en TODO archivo versionado.
 *
 * Dos mitades. En la fuente: ninguna línea lógica (las partidas con «\» se
 * unen) pasa la clave a curl antes de un `<<<`. En ejecución: los scripts
 * reales corren contra un `curl` falso adelante en el PATH
 * (`curl-falso-n8n.sh`), en una copia del repositorio en un directorio
 * temporal (publicar-flujo.sh deja respaldos en Flujos/), sin red ni n8n, y
 * cada llamada a la API muestra la clave en la entrada estándar y en ningún
 * argumento.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** La clave, en cualquiera de sus formas: la variable o la cabecera armada con una variable. */
const CLAVE_EN_TEXTO = /\$\{?N8N_API_KEY\b|X-N8N-API-KEY:\s*\$/i;

/** Las líneas de un .sh que ponen la clave en los argumentos de curl (lo que va antes de `<<<`). */
function enArgumentosDeCurl(texto: string): string[] {
  return logicas(texto).filter((l) => !esComentario(l) && /\bcurl\b/.test(l) && CLAVE_EN_TEXTO.test(l.split('<<<')[0]));
}

/**
 * La cabecera armada fuera de un `<<<`: en un arreglo (`H=(-H "X-N8N-API-KEY: $K")`)
 * o en una variable que después se expande en curl. Donde sea, termina en argv.
 */
function cabeceraFueraDeHeredoc(texto: string): string[] {
  return logicas(texto).filter((l) => !esComentario(l) && /X-N8N-API-KEY:\s*\$/i.test(l.split('<<<')[0]));
}

/** Node y Python: un lanzamiento de curl no lleva la clave en la misma línea (va por `input`). */
function enLanzamientoDeCurl(texto: string): string[] {
  return texto.split('\n').filter((l) => !esComentario(l) && /['"]curl['"]/.test(l) && /N8N_API_KEY|X-N8N-API-KEY/i.test(l));
}

describe('en la fuente', () => {
  const sh = versionados('*.sh');

  it('recorre todos los .sh versionados, en cualquier carpeta', () => {
    for (const s of ['publicar-flujo.sh', 'ver-ejecuciones.sh', 'credenciales-flujo.sh', 'webhook-meta.sh']) {
      expect(sh).toContain(`scripts/${s}`);
    }
    expect(sh.length).toBeGreaterThan(40);
  });

  it('el detector ve la forma vieja, también partida en dos líneas, y deja pasar la nueva', () => {
    const viejas = [
      'curl -s --max-time 30 -H "X-N8N-API-KEY: $N8N_API_KEY" "$URL"',
      'COD=$(curl -s -o "$TMP/v.json" \\\n      -H "X-N8N-API-KEY: ${N8N_API_KEY}" "${API}/workflows/1" || echo 000)',
      'curl -s -u "api:${N8N_API_KEY}" "$URL"',
      'curl -s "$URL?clave=$N8N_API_KEY"',
    ];
    for (const v of viejas) expect(enArgumentosDeCurl(v), v).toHaveLength(1);
    expect(cabeceraFueraDeHeredoc('H=(-H "X-N8N-API-KEY: $N8N_API_KEY")')).toHaveLength(1);
    expect(enLanzamientoDeCurl("execFileSync('curl', ['-H', `X-N8N-API-KEY: ${env['N8N_API_KEY']}`, url])")).toHaveLength(1);

    const nueva = 'COD=$(curl -s -o "$TMP/v.json" \\\n      -H @- "${API}/workflows/1" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)';
    expect(enArgumentosDeCurl(nueva)).toEqual([]);
    expect(cabeceraFueraDeHeredoc(nueva)).toEqual([]);
  });

  it('ningún .sh pasa la clave de n8n en los argumentos de curl', () => {
    const malas = sh.flatMap((r) => enArgumentosDeCurl(fuente(r)).map((l) => `${r}: ${l.trim()}`));
    expect(malas).toEqual([]);
  });

  it('ningún .sh arma la cabecera de la clave fuera de un <<<', () => {
    const malas = sh.flatMap((r) => cabeceraFueraDeHeredoc(fuente(r)).map((l) => `${r}: ${l.trim()}`));
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
