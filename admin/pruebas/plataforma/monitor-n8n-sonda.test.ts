/**
 * `scripts/monitor/sondear-n8n.sh` y `.github/workflows/monitor-n8n.yml`: la sonda externa de n8n.
 *
 * Se prueba NEGANDO y SIN RED: un `curl` y un `openssl` falsos adelante en el PATH responden lo que la prueba dicta y
 * anotan cada llamada. Nada sale a internet ni toca n8n.
 *
 * Lo que cada grupo cierra:
 *  - mal uso: una URL que no sea https://<host>/healthz[/readiness] no produce NI UNA consulta (ni webhook, ni http, ni
 *    usuario@, ni puerto, ni consulta);
 *  - un parpadeo no declara nada: una ronda buena basta; solo fallan TODAS las rondas;
 *  - cada falla se nombra (no resuelve, sin conexión, tiempo, TLS, 5xx): es lo que faltó el 11/11;
 *  - el host NUNCA sale por pantalla ni por $GITHUB_OUTPUT (repositorio público);
 *  - el certificado avisa por debajo del umbral y nunca hace fallar la corrida;
 *  - el workflow: sin permisos por omisión, acciones fijadas por SHA, sin host ni URL de ping escritos, simulacro que no
 *    avisa a Healthchecks.
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
const SCRIPT = join(RAIZ, 'scripts', 'monitor', 'sondear-n8n.sh');
const WORKFLOW = join(RAIZ, '.github', 'workflows', 'monitor-n8n.yml');
const HOST = 'n8n-de-prueba.example.org';
const URL_OK = `https://${HOST}/healthz/readiness`;

/** Cada línea de FAKE_SECUENCIA es «<código de salida> <http>»; la última se repite. Anota los argumentos. */
const CURL_FALSO = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/llamadas.txt"
n=$(wc -l < "$FAKE_DIR/llamadas.txt")
total=$(wc -l < "$FAKE_DIR/secuencia.txt")
[ "$n" -gt "$total" ] && n=$total
linea=$(sed -n "\${n}p" "$FAKE_DIR/secuencia.txt")
printf '%s' "\${linea#* }"
exit "\${linea%% *}"
`;

/** `s_client` devuelve un marcador y `x509` la fecha de FAKE_DIR/fin.txt (vacío = sin certificado). */
const OPENSSL_FALSO = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/openssl.txt"
if [ "$1" = "s_client" ]; then cat > /dev/null; echo CERT; exit 0; fi
cat > /dev/null
fin=$(cat "$FAKE_DIR/fin.txt" 2>/dev/null)
[ -n "$fin" ] || exit 1
echo "notAfter=$fin"
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monitor-n8n-'));
  writeFileSync(join(dir, 'curl'), CURL_FALSO);
  writeFileSync(join(dir, 'openssl'), OPENSSL_FALSO);
  chmodSync(join(dir, 'curl'), 0o755);
  chmodSync(join(dir, 'openssl'), 0o755);
  writeFileSync(join(dir, 'llamadas.txt'), '');
  writeFileSync(join(dir, 'salida.txt'), '');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(modo: string, secuencia: string[], extra: Record<string, string> = {}) {
  writeFileSync(join(dir, 'secuencia.txt'), secuencia.join('\n') + '\n');
  const r = spawnSync('bash', [SCRIPT, modo], {
    encoding: 'utf8',
    // Entorno hermético (hijos-hermeticos.test.ts): el script no usa Firebase, pero ninguna suite hereda las ADC.
    env: entornoDelEmulador(undefined, {
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_DIR: dir,
      GITHUB_OUTPUT: join(dir, 'salida.txt'),
      MONITOR_URL: URL_OK,
      MONITOR_ESPERA_S: '0',
      MONITOR_PAUSA_RONDA_S: '0',
      ...extra,
    }),
  });
  const llamadas = readFileSync(join(dir, 'llamadas.txt'), 'utf8').split('\n').filter(Boolean);
  const salida = readFileSync(join(dir, 'salida.txt'), 'utf8');
  return { ...r, llamadas, salida, todo: `${r.stdout}\n${r.stderr}\n${salida}` };
}

describe('sondear-n8n.sh: mal uso no consulta nada', () => {
  const malas: Array<[string, string]> = [
    ['sin URL', ''],
    ['http sin TLS', `http://${HOST}/healthz`],
    ['ruta de webhook', `https://${HOST}/webhook/abc`],
    ['otra ruta', `https://${HOST}/rest/workflows`],
    ['usuario@ delante del host', `https://${HOST}@otro.example.org/healthz`],
    ['puerto', `https://${HOST}:8443/healthz`],
    ['consulta', `https://${HOST}/healthz?x=1`],
    ['ruta de más', `https://${HOST}/healthz/readiness/otra`],
    ['dirección IP', 'https://10.0.0.1/healthz'],
    ['salto de línea', `https://${HOST}/healthz\nhttps://otro.example.org/healthz`],
  ];
  for (const [nombre, url] of malas) {
    it(`${nombre}: sale 2 y no llama a curl`, () => {
      const r = correr('sondear', ['0 200'], { MONITOR_URL: url });
      expect(r.status).toBe(2);
      expect(r.llamadas).toHaveLength(0);
    });
  }

  it('un modo desconocido sale 2 sin consultar', () => {
    const r = correr('borrar', ['0 200']);
    expect(r.status).toBe(2);
    expect(r.llamadas).toHaveLength(0);
  });

  it('un parámetro fuera de rango sale 2 sin consultar', () => {
    for (const extra of [{ MONITOR_RONDAS: '9' }, { MONITOR_INTENTOS: '0' }, { MONITOR_TIEMPO_S: 'x' }, { MONITOR_PAUSA_RONDA_S: '9999' }]) {
      const r = correr('sondear', ['0 200'], extra);
      expect(r.status).toBe(2);
      expect(r.llamadas).toHaveLength(0);
    }
  });

  it('acepta /healthz y /healthz/readiness', () => {
    expect(correr('sondear', ['0 200'], { MONITOR_URL: `https://${HOST}/healthz` }).status).toBe(0);
    expect(correr('sondear', ['0 200']).status).toBe(0);
  });
});

describe('sondear-n8n.sh: un parpadeo no declara nada', () => {
  it('200 a la primera: una sola consulta, estado ok', () => {
    const r = correr('sondear', ['0 200']);
    expect(r.status).toBe(0);
    expect(r.llamadas).toHaveLength(1);
    expect(r.salida).toContain('estado=ok');
    expect(r.salida).toContain('rondas_fallidas=0');
  });

  it('falla dos veces y responde a la tercera: ok dentro de la primera ronda', () => {
    const r = correr('sondear', ['28 000', '7 000', '0 200']);
    expect(r.status).toBe(0);
    expect(r.llamadas).toHaveLength(3);
    expect(r.salida).toContain('estado=ok');
  });

  it('falla la primera ronda entera y responde en la segunda: NO falla', () => {
    const r = correr('sondear', ['7 000', '7 000', '7 000', '0 200']);
    expect(r.status).toBe(0);
    expect(r.llamadas).toHaveLength(4);
    expect(r.salida).toContain('rondas_fallidas=1');
  });

  it('solo falla si fallan TODAS las rondas (2 × 3 consultas)', () => {
    const r = correr('sondear', ['7 000']);
    expect(r.status).toBe(1);
    expect(r.llamadas).toHaveLength(6);
    expect(r.salida).toContain('rondas_fallidas=2');
  });
});

describe('sondear-n8n.sh: cada falla tiene nombre', () => {
  const casos: Array<[string, string, string]> = [
    ['el nombre no resuelve (DNS)', '6 000', 'no_resuelve'],
    ['conexión rechazada (proxy o VM caídos)', '7 000', 'sin_conexion'],
    ['tiempo agotado', '28 000', 'tiempo_agotado'],
    ['TLS roto', '35 000', 'tls'],
    ['certificado no válido', '60 000', 'tls'],
    ['502 del proxy (n8n caído)', '0 502', 'http_5xx'],
    ['503 de readiness (base caída)', '0 503', 'http_5xx'],
    ['una redirección no es salud', '0 301', 'http_otro'],
    ['404', '0 404', 'http_otro'],
    ['otro error de curl', '56 000', 'error_de_red'],
  ];
  for (const [nombre, linea, estado] of casos) {
    it(`${nombre} -> ${estado}`, () => {
      const r = correr('sondear', [linea], { MONITOR_RONDAS: '1', MONITOR_INTENTOS: '1' });
      expect(r.status).toBe(1);
      expect(r.salida).toContain(`estado=${estado}\n`);
    });
  }

  it('una respuesta que no es un código de 3 dígitos se anota como 000, no se copia', () => {
    const r = correr('sondear', ['0 <html>secreto</html>'], { MONITOR_RONDAS: '1', MONITOR_INTENTOS: '1' });
    expect(r.status).toBe(1);
    expect(r.salida).toContain('http=000');
    expect(r.todo).not.toContain('secreto');
  });
});

describe('sondear-n8n.sh: el host no sale a ningún registro', () => {
  it('ni al acertar ni al fallar ni en mal uso', () => {
    for (const r of [
      correr('sondear', ['0 200']),
      correr('sondear', ['7 000']),
      correr('sondear', ['0 200'], { MONITOR_URL: `https://${HOST}/webhook/abc` }),
      correr('certificado', ['0 200']),
    ]) {
      expect(r.todo).not.toContain(HOST);
      expect(r.todo).not.toContain('example.org');
    }
  });

  it('curl va solo por https, sin seguir redirecciones y con tope de tiempo', () => {
    const r = correr('sondear', ['0 200']);
    expect(r.llamadas[0]).toContain('--proto =https');
    expect(r.llamadas[0]).toContain('--max-redirs 0');
    expect(r.llamadas[0]).toContain('--max-time 10');
    expect(r.llamadas[0].trim().endsWith(URL_OK)).toBe(true);
  });
});

describe('sondear-n8n.sh certificado', () => {
  const AHORA = String(Date.UTC(2026, 10, 12) / 1000); // 12/11/2026

  function cert(fin: string, extra: Record<string, string> = {}) {
    writeFileSync(join(dir, 'fin.txt'), fin);
    return correr('certificado', ['0 200'], { MONITOR_AHORA_EPOCH: AHORA, ...extra });
  }

  it('con 60 días: vigente', () => {
    const r = cert('Jan 11 00:00:00 2027 GMT');
    expect(r.status).toBe(0);
    expect(r.salida).toContain('dias=60');
    expect(r.salida).toContain('certificado=vigente');
  });

  it('con 13 días: por_vencer, avisa y NO falla', () => {
    const r = cert('Nov 25 00:00:00 2026 GMT');
    expect(r.status).toBe(0);
    expect(r.salida).toContain('dias=13');
    expect(r.salida).toContain('certificado=por_vencer');
    expect(r.stdout).toContain('::warning::');
  });

  it('con 14 días justos: vigente (el umbral es «menos de»)', () => {
    expect(cert('Nov 26 00:00:00 2026 GMT').salida).toContain('certificado=vigente');
  });

  it('vencido: lo dice y NO falla', () => {
    const r = cert('Nov 01 00:00:00 2026 GMT');
    expect(r.status).toBe(0);
    expect(r.salida).toContain('certificado=vencido');
  });

  it('sin certificado legible: sin_datos y NO falla', () => {
    const r = cert('');
    expect(r.status).toBe(0);
    expect(r.salida).toContain('certificado=sin_datos');
  });

  it('una fecha ilegible: sin_datos, y no se copia', () => {
    const r = cert('no-es-una-fecha $(id)');
    expect(r.status).toBe(0);
    expect(r.salida).toContain('certificado=sin_datos');
    expect(r.todo).not.toContain('no-es-una-fecha');
  });

  it('no llama a curl', () => {
    expect(cert('Jan 11 00:00:00 2027 GMT').llamadas).toHaveLength(0);
  });
});

describe('monitor-n8n.yml', () => {
  const yml = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, 'utf8') : '';
  const sinComentarios = yml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  it('existe y corre programado y a pedido', () => {
    expect(yml).not.toBe('');
    expect(sinComentarios).toMatch(/schedule:\s*\n(\s*#.*\n)*\s*- cron: '7-59\/10 \* \* \* \*'/);
    expect(sinComentarios).toContain('workflow_dispatch:');
    expect(sinComentarios).not.toMatch(/pull_request|push:/);
  });

  it('sin permisos por omisión y solo lectura del contenido en el job', () => {
    expect(sinComentarios).toMatch(/^permissions: \{\}$/m);
    const permisos = [...sinComentarios.matchAll(/^\s+([a-z-]+): (read|write)$/gm)].map((m) => `${m[1]}:${m[2]}`);
    expect(permisos).toEqual(['contents:read']);
  });

  it('toda acción va fijada por SHA de 40 caracteres y sin credenciales persistentes', () => {
    const usos = [...sinComentarios.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(sinComentarios).toContain('persist-credentials: false');
  });

  it('el job programado se omite sin la variable de encendido y usa su Environment', () => {
    expect(sinComentarios).toContain("vars.MONITOR_N8N_ACTIVO == 'si'");
    expect(sinComentarios).toContain('environment: monitor-n8n');
    expect(sinComentarios).toMatch(/timeout-minutes: \d+/);
  });

  it('el host y la URL de ping solo entran como secretos, nunca escritos ni interpolados en un `run`', () => {
    expect(sinComentarios).toContain('secrets.MONITOR_N8N_URL');
    expect(sinComentarios).toContain('secrets.MONITOR_N8N_PING_URL');
    expect(yml).not.toMatch(/duckdns|hc-ping\.com\/[0-9a-f]{8}-/);
    // Dentro de un bloque `run:` no hay ninguna expresión ${{ }}: todo llega por `env`.
    const bloques = sinComentarios.split(/\n\s+run: /).slice(1).map((b) => b.split(/\n {6}- name: /)[0]);
    expect(bloques.length).toBeGreaterThan(0);
    for (const b of bloques) expect(b).not.toContain('${{');
  });

  it('el simulacro sondea un host .invalid y no avisa a Healthchecks', () => {
    expect(sinComentarios).toContain('https://no-existe.invalid/healthz/readiness');
    const aviso = sinComentarios.split('- name: Avisar a Healthchecks')[1].split('- name: ')[0];
    expect(aviso).toContain("inputs.simulacro != 'host_inexistente'");
    expect(aviso).toContain('^https://hc-ping\\.com/');
  });
});
