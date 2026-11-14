/**
 * Reporte diario del monitor de n8n y carga de sus secretos:
 * `scripts/monitor/reporte-diario.sh`, `scripts/monitor/cargar-secretos-monitor.sh` y
 * `.github/workflows/monitor-n8n-reporte.yml`.
 *
 * Se prueba NEGANDO y SIN RED (un `gh` falso adelante en el PATH anota lo que recibe por argumentos y por la entrada).
 *
 * Lo que cada grupo cierra:
 *  - el reporte avisa UNA vez al día de lo que la sonda no avisa (certificado por vencer, monitor que casi no corre);
 *  - el texto del comentario sale solo de números y de una lista cerrada: nada de la API llega a una Issue pública;
 *  - los secretos viajan por la entrada estándar: nunca por argumentos ni por pantalla, y en seco no se llama a GitHub;
 *  - el workflow: permisos mínimos, acciones por SHA, y comenta solo en una Issue creada por él mismo.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const REPORTE = join(RAIZ, 'scripts', 'monitor', 'reporte-diario.sh');
const SECRETOS = join(RAIZ, 'scripts', 'monitor', 'cargar-secretos-monitor.sh');
const WORKFLOW = join(RAIZ, '.github', 'workflows', 'monitor-n8n-reporte.yml');

const AHORA = Date.UTC(2026, 10, 13, 12, 10) / 1000;
const iso = (haceMin: number) => new Date((AHORA - haceMin * 60) * 1000).toISOString().replace('.000', '');
type Corrida = { event?: string; conclusion?: string | null; created_at?: unknown; [k: string]: unknown };
const corrida = (haceMin: number, conclusion: string | null = 'success', extra: Corrida = {}): Corrida =>
  ({ event: 'schedule', conclusion, created_at: iso(haceMin), ...extra });
/** n corridas buenas repartidas en las últimas 24 h, la más reciente hace 5 min. */
const buenas = (n: number) => Array.from({ length: n }, (_, i) => corrida(5 + i * Math.floor(1400 / n)));

function reporte(corridas: unknown, extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [REPORTE], {
    encoding: 'utf8',
    input: typeof corridas === 'string' ? corridas : JSON.stringify({ workflow_runs: corridas }),
    env: entornoDelEmulador(undefined, { REPORTE_AHORA_EPOCH: String(AHORA), REPORTE_CERTIFICADO: 'vigente', REPORTE_DIAS: '60', ...extra }),
  });
  return { ...r, todo: `${r.stdout}\n${r.stderr}` };
}

describe('reporte-diario.sh', () => {
  it('con la sonda corriendo y el certificado vigente: vivo, sale 0', () => {
    const r = reporte(buenas(100));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('**Monitor de n8n: vivo, sin novedades.**');
    expect(r.stdout).toContain('Sondas en 24 h: 100 de ~144 esperadas (100 bien, 0 con falla).');
    expect(r.stdout).toContain('Certificado: `vigente` (60 días).');
    expect(r.stdout).not.toContain('⚠');
  });

  it('certificado por vencer: avisa con los días y sale 1 (es el aviso que la sonda no da)', () => {
    const r = reporte(buenas(100), { REPORTE_CERTIFICADO: 'por_vencer', REPORTE_DIAS: '9' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('**Monitor de n8n: REVISAR.**');
    expect(r.stdout).toContain('⚠ Al certificado le quedan 9 días');
  });

  it('certificado vencido: sale 1', () => {
    const r = reporte(buenas(100), { REPORTE_CERTIFICADO: 'vencido', REPORTE_DIAS: '-2' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('⚠ El certificado está vencido.');
  });

  it('certificado sin datos: lo dice y NO falla por eso', () => {
    const r = reporte(buenas(100), { REPORTE_CERTIFICADO: 'sin_datos', REPORTE_DIAS: '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Certificado: `sin_datos`.');
  });

  it('el monitor casi no corrió (menos de una vez por hora): sale 1', () => {
    const r = reporte(buenas(23));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('⚠ El monitor corrió 23 veces en 24 h (mínimo 24)');
    expect(reporte(buenas(24)).status).toBe(0);
  });

  it('sin ninguna corrida: sale 1 y lo dice', () => {
    const r = reporte([]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Última sonda terminada: `ninguna`.');
  });

  it('una corrida EN CURSO no tapa una falla reciente: la última sonda es la última terminada', () => {
    const r = reporte([...buenas(140), corrida(3, 'failure'), corrida(1, null)]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Última sonda terminada: `failure` (en curso ahora: 1).');
    expect(r.stdout).toContain('⚠ La última sonda falló');
    // Con la terminada en verde, la que corre ahora no avisa nada.
    const bien = reporte([...buenas(140), corrida(1, null)]);
    expect(bien.status).toBe(0);
    expect(bien.stdout).toContain('Última sonda terminada: `success` (en curso ahora: 1).');
  });

  it('la última sonda falló: sale 1; una falla vieja ya recuperada, no', () => {
    const conFallaVieja = [...buenas(100), corrida(300, 'failure')];
    const r1 = reporte(conFallaVieja);
    expect(r1.status).toBe(0);
    expect(r1.stdout).toContain('(100 bien, 1 con falla)');
    const r2 = reporte([...buenas(100), corrida(1, 'failure')]);
    expect(r2.status).toBe(1);
    expect(r2.stdout).toContain('⚠ La última sonda falló');
  });

  it('no cuenta las corridas manuales (simulacros) ni las de fuera de la ventana', () => {
    const r = reporte([...buenas(100), corrida(1, 'failure', { event: 'workflow_dispatch' }), corrida(60 * 30, 'failure')]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Sondas en 24 h: 100 de');
    expect(r.stdout).toContain('0 con falla');
  });

  it('nada de la API llega al comentario: ni títulos, ni ramas, ni conclusiones inventadas', () => {
    const sucia = [
      ...buenas(100),
      corrida(1, '<img src=x onerror=alert(1)>', {
        name: 'TITULO-SECRETO', head_branch: 'rama-secreta', head_commit: { message: 'mensaje-secreto @alguien' },
        html_url: 'https://example.org/secreto', actor: { login: 'usuario-secreto' },
      }),
    ];
    const r = reporte(sucia);
    expect(r.stdout).toContain('Última sonda terminada: `otra`.');
    for (const m of ['SECRETO', 'secret', 'onerror', '<img', 'example.org', '@alguien']) expect(r.todo, m).not.toContain(m);
  });

  it('un estado de certificado fuera de la lista se vuelve sin_datos, y unos días que no son un número no se copian', () => {
    const r = reporte(buenas(100), { REPORTE_CERTIFICADO: 'vigente`\n- @todos', REPORTE_DIAS: '9 $(id)' });
    expect(r.stdout).toContain('Certificado: `sin_datos`.');
    expect(r.todo).not.toContain('@todos');
    expect(r.todo).not.toContain('$(id)');
  });

  it('entrada que no es la respuesta esperada: sale 2 y no escribe reporte', () => {
    for (const mala of ['', 'no es json', '[]', '{"workflow_runs":"x"}', '{"message":"Bad credentials"}']) {
      const r = reporte(mala);
      expect(r.status, mala).toBe(2);
      expect(r.stdout).toBe('');
    }
  });

  it('una corrida con fecha ilegible se ignora, no rompe el reporte', () => {
    const r = reporte([...buenas(100), { event: 'schedule', conclusion: 'failure', created_at: 12345 }]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('0 con falla');
  });
});

describe('cargar-secretos-monitor.sh', () => {
  const HOST = 'n8n-de-prueba.example.org';
  const UUID = ['a'.repeat(8), 'b'.repeat(4), 'c'.repeat(4), 'd'.repeat(4), 'e'.repeat(12)].join('-');
  /** Anota los argumentos y lo que llega por la entrada estándar; FAKE_GH_FALLA hace fallar un secreto. */
  const GH_FALSO = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/gh-args.txt"
cat >> "$FAKE_DIR/gh-stdin.txt"; echo >> "$FAKE_DIR/gh-stdin.txt"
[ "\${FAKE_GH_FALLA:-}" = "$3" ] && { echo "HTTP 404 secreto-de-gh" >&2; exit 1; }
exit 0
`;
  let dir: string;
  let env: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monitor-secretos-'));
    writeFileSync(join(dir, 'gh'), GH_FALSO);
    chmodSync(join(dir, 'gh'), 0o755);
    env = join(dir, 'env');
    writeFileSync(env, `OTRA=1\nN8N_API_KEY=clave-que-no-se-toca\nN8N_BASE_URL="https://${HOST}/"\n`);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function correr(args: string[], extra: Record<string, string> = {}) {
    const r = spawnSync('bash', [SECRETOS, ...args], {
      encoding: 'utf8',
      env: entornoDelEmulador(undefined, { PATH: `${dir}:${process.env.PATH}`, FAKE_DIR: dir, ...extra }),
    });
    const leer = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
    return { ...r, args: leer('gh-args.txt'), stdin: leer('gh-stdin.txt'), pantalla: `${r.stdout}\n${r.stderr}` };
  }

  it('en seco no llama a GitHub y no muestra ningún valor', () => {
    const r = correr(['--env', env], { MONITOR_PING_ID: UUID });
    expect(r.status).toBe(0);
    expect(r.args).toBe('');
    expect(r.pantalla).toContain('SECO');
    for (const v of [HOST, UUID, 'clave-que-no-se-toca']) expect(r.pantalla).not.toContain(v);
  });

  it('--aplicar sin --confirmo github no escribe', () => {
    for (const a of [['--aplicar'], ['--aplicar', '--confirmo', 'produccion'], ['--confirmo', 'github']]) {
      const r = correr(['--env', env, ...a], { MONITOR_PING_ID: UUID });
      expect(r.status).toBe(2);
      expect(r.args).toBe('');
    }
  });

  it('al aplicar, los dos valores viajan por la entrada estándar al Environment correcto, nunca por argumentos ni pantalla', () => {
    const r = correr(['--env', env, '--aplicar', '--confirmo', 'github'], { MONITOR_PING_ID: UUID });
    expect(r.status).toBe(0);
    expect(r.args.trim().split('\n')).toEqual([
      'secret set MONITOR_N8N_URL --env monitor-n8n --repo segurolotengopy/NovuChat',
      'secret set MONITOR_N8N_PING_URL --env monitor-n8n --repo segurolotengopy/NovuChat',
    ]);
    expect(r.stdin.trim().split('\n')).toEqual([`https://${HOST}/healthz/readiness`, `https://hc-ping.com/${UUID}`]);
    for (const v of [HOST, UUID, 'clave-que-no-se-toca']) {
      expect(r.pantalla).not.toContain(v);
      expect(r.args).not.toContain(v);
    }
  });

  it('sin MONITOR_PING_ID carga solo la URL de salud y lo dice', () => {
    const r = correr(['--env', env, '--aplicar', '--confirmo', 'github']);
    expect(r.status).toBe(0);
    expect(r.args.trim().split('\n')).toHaveLength(1);
    expect(r.pantalla).toContain('MONITOR_N8N_PING_URL  NO se carga');
  });

  it('el id del chequeo se lee de un archivo (primera línea) y no queda en pantalla ni en argumentos', () => {
    const archivo = join(dir, 'ping');
    writeFileSync(archivo, `${UUID}\nresto-que-se-ignora\n`, { mode: 0o600 });
    chmodSync(archivo, 0o600);
    const r = correr(['--env', env, '--ping-desde', archivo, '--aplicar', '--confirmo', 'github']);
    expect(r.status).toBe(0);
    expect(r.stdin.trim().split('\n')).toEqual([`https://${HOST}/healthz/readiness`, `https://hc-ping.com/${UUID}`]);
    for (const v of [UUID, 'resto-que-se-ignora']) {
      expect(r.pantalla).not.toContain(v);
      expect(r.args).not.toContain(v);
    }
  });

  it('--ping-desde exige un archivo común, del usuario y de modo 600; y un contenido que sea un UUID', () => {
    const abierto = join(dir, 'abierto');
    writeFileSync(abierto, `${UUID}\n`, { mode: 0o644 });
    chmodSync(abierto, 0o644);
    const malo = join(dir, 'malo');
    writeFileSync(malo, `${UUID}/fail\n`, { mode: 0o600 });
    chmodSync(malo, 0o600);
    for (const a of [abierto, malo, join(dir, 'no-existe'), dir]) {
      const r = correr(['--env', env, '--ping-desde', a, '--aplicar', '--confirmo', 'github']);
      expect(r.status, a).toBe(2);
      expect(r.args).toBe('');
      expect(r.pantalla).not.toContain(UUID);
    }
  });

  it('un N8N_BASE_URL que no es https://<host> no escribe nada', () => {
    for (const base of ['http://n8n.example.org', 'https://usuario@n8n.example.org', 'https://n8n.example.org:8443', 'https://10.0.0.1', 'n8n.example.org', '']) {
      writeFileSync(env, `N8N_BASE_URL=${base}\n`);
      const r = correr(['--env', env, '--aplicar', '--confirmo', 'github'], { MONITOR_PING_ID: UUID });
      expect(r.status, base).toBe(2);
      expect(r.args).toBe('');
      if (base) expect(r.pantalla).not.toContain(base);
    }
  });

  it('un id de chequeo que no es un UUID en minúsculas no escribe nada (ni siquiera la URL de salud)', () => {
    for (const id of [UUID.toUpperCase(), `${UUID}/fail`, `otro.example.org/${UUID}`, 'mi-chequeo']) {
      const r = correr(['--env', env, '--aplicar', '--confirmo', 'github'], { MONITOR_PING_ID: id });
      expect(r.status, id).toBe(2);
      expect(r.args).toBe('');
      expect(r.pantalla).not.toContain(id);
    }
  });

  it('si gh falla: sale 3 y no repite lo que dijo gh', () => {
    const r = correr(['--env', env, '--aplicar', '--confirmo', 'github'], { MONITOR_PING_ID: UUID, FAKE_GH_FALLA: 'MONITOR_N8N_URL' });
    expect(r.status).toBe(3);
    expect(r.pantalla).not.toContain('secreto-de-gh');
    expect(r.args.trim().split('\n')).toHaveLength(1);
  });

  it('sin --env, con un --env inexistente o con xtrace: no escribe', () => {
    expect(correr([]).status).toBe(2);
    expect(correr(['--env', join(dir, 'no-existe')]).status).toBe(2);
    const r = spawnSync('bash', ['-x', SECRETOS, '--env', env, '--aplicar', '--confirmo', 'github'], {
      encoding: 'utf8',
      env: entornoDelEmulador(undefined, { PATH: `${dir}:${process.env.PATH}`, FAKE_DIR: dir, MONITOR_PING_ID: UUID }),
    });
    expect(r.status).toBe(2);
    expect(existsSync(join(dir, 'gh-args.txt'))).toBe(false);
  });
});

describe('monitor-n8n-reporte.yml', () => {
  const yml = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, 'utf8') : '';
  const sinComentarios = yml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  it('corre una vez al día y a pedido, apagado sin la variable de encendido', () => {
    expect(sinComentarios).toContain("- cron: '10 12 * * *'");
    expect(sinComentarios).toContain('workflow_dispatch:');
    // Ningún disparador que traiga texto de terceros (PR, comentarios, Issues).
    expect(sinComentarios).not.toMatch(/^\s*(pull_request|pull_request_target|push|issue_comment|issues):\s*$/m);
    expect(sinComentarios).toContain("if: ${{ vars.MONITOR_N8N_ACTIVO == 'si' }}");
    expect(sinComentarios).toContain('environment: monitor-n8n');
  });

  it('permisos mínimos: leer contenido y corridas, escribir solo en Issues', () => {
    expect(sinComentarios).toMatch(/^permissions: \{\}$/m);
    const permisos = [...sinComentarios.matchAll(/^\s+([a-z-]+): (read|write)$/gm)].map((m) => `${m[1]}:${m[2]}`);
    expect(permisos).toEqual(['contents:read', 'actions:read', 'issues:write']);
  });

  it('acciones por SHA, sin credenciales persistentes y sin expresiones dentro de un `run`', () => {
    const usos = [...sinComentarios.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(sinComentarios).toContain('persist-credentials: false');
    const bloques = sinComentarios.split(/\n\s+run: /).slice(1).map((b) => b.split(/\n {6}- name: /)[0]);
    expect(bloques.length).toBeGreaterThan(0);
    for (const b of bloques) expect(b).not.toContain('${{');
  });

  it('comenta solo en una Issue abierta creada por el propio workflow, con el cuerpo desde un archivo', () => {
    expect(sinComentarios).toContain('creator=github-actions%5Bbot%5D');
    expect(sinComentarios).toContain('select(.title == $t)');
    expect(sinComentarios).toContain('-F body=@reporte.md');
  });

  it('si la API falla NO se publica un reporte inventado: sale 2 antes de llamar al script, sin comentar', () => {
    const armar = sinComentarios.split('- name: Armar el reporte')[1].split('- name: ')[0];
    // Cada eslabón de la lectura tiene su salida por `no_se_pudo`, que escribe salida=2 y corta.
    expect(armar).toContain('echo "salida=2" >> "$GITHUB_OUTPUT"');
    expect(armar).toMatch(/> paginas\.json 2> \/dev\/null \|\| no_se_pudo/);
    expect(armar).toContain("jq -e 'type == \"array\" and length > 0 and all(.[]; (.workflow_runs | type) == \"array\")' paginas.json > /dev/null || no_se_pudo");
    expect(armar).toMatch(/> corridas\.json \|\| no_se_pudo/);
    // La lectura (y su validación) va ANTES de llamar al script del reporte.
    expect(armar.indexOf('|| no_se_pudo')).toBeLessThan(armar.indexOf('reporte-diario.sh'));
    // Nada de normalizar un error de la API a «0 corridas».
    expect(armar).not.toContain('// []) | add // []');
    expect(armar).not.toMatch(/\.workflow_runs \/\/ \[\]/);
  });

  it('la búsqueda de la Issue pagina', () => {
    expect(sinComentarios).toContain('gh api --paginate "repos/${GITHUB_REPOSITORY}/issues?state=open&creator=');
  });

  it('falla la corrida cuando el reporte trae avisos, después de comentar', () => {
    const pasos = [...sinComentarios.matchAll(/- name: (.+)/g)].map((m) => m[1]);
    expect(pasos).toEqual(['Checkout', 'Medir el certificado', 'Armar el reporte', 'Comentar en la Issue', 'Fallar si hay algo que avisar']);
    expect(sinComentarios).toContain('SALIDA: ${{ steps.reporte.outputs.salida }}');
    expect(sinComentarios).toContain('[ "$rc" -ne 2 ] || exit 2');
  });
});
