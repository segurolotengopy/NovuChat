/**
 * `scripts/reponer-numero-demo-a.sh`: repone en el `.env` del Demo A el número nuevo (token, phone id, WABA,
 * destinatario y número visible) sin mostrar ningún valor. Se prueba NEGANDO, con un `.env` falso en tmp y el
 * `curl` falso de las suites de Meta (`curl-falso-graph.sh`): sin red, sin Meta.
 *
 * Lo que cierra cada grupo:
 *  - el seco no escribe; con --aplicar solo cambian las cinco variables, con respaldo 600 y `.env` en 600;
 *  - ningún valor (token, ids, teléfonos) sale por stdout/stderr ni viaja en los argumentos de curl;
 *  - cada cerrojo se niega sin escribir: nombre del archivo, WA_APP_ID ausente, token de otra app o de una app de
 *    WhatsApp-Modular, app que no se llama NovuChat-Demo-A, número ajeno, WABA que no contiene el número, ids de otro
 *    entorno, formas inválidas, asignaciones repetidas o con `export`, falta de confirmación;
 *  - el script solo LEE en Graph (ninguna escritura).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'reponer-numero-demo-a.sh');

// Ids ARMADOS por partes: una secuencia de 10 dígitos o más la rechaza verificar-saneo.sh (con razón).
const id = (...partes: string[]) => partes.join('');
const APP = id('42424', '24242');
const PHONE_VIEJO = id('11111', '11111');
const WABA_VIEJA = id('22222', '22222');
const TOKEN_VIEJO = 'EAA' + 'v'.repeat(60);
const TOKEN = 'EAA' + 'n'.repeat(60);
const PHONE = id('55500', '07237');
const WABA = id('55500', '01360');
const TO = id('5917', '0000001');
const VISIBLE = id('5917', '0003810');
const TO_VIEJO = id('5917', '9999999');
const VISIBLE_VIEJO = id('5917', '8888888');
const SECRETOS = [TOKEN, TOKEN_VIEJO, PHONE, WABA, TO, VISIBLE];
const SECRETO_APP = 'secreto-de-la-app';

const BASE = [
  '# Demo A', `WA_APP_ID=${APP}`, `WA_APP_SECRET=${SECRETO_APP}`, `WA_TOKEN=${TOKEN_VIEJO}`, `WA_PHONE_ID=${PHONE_VIEJO}`,
  `WABA_ID=${WABA_VIEJA}`, `WA_TO=${TO_VIEJO}`, `WA_TEST_NUMBER=${VISIBLE_VIEJO}`, 'N8N_BASE_URL=https://n8n.invalid', 'N8N_API_KEY=clave-n8n', '',
].join('\n');

const APP_PROPIA = { id: APP, name: 'NovuChat-Demo-A' };
const NUMERO_PROPIO = { id: PHONE, verified_name: 'Demo NovuChat' };
const LISTA_OK = { data: [{ id: PHONE }] };
const SIN_RED = { HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9',
  http_proxy: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '', no_proxy: '' };

let dir: string;
let registro: string;
const envF = () => join(dir, '.env');
const respaldos = () => readdirSync(dir).filter((n) => n.startsWith('.env.respaldo-'));
const ENTRADA = [TOKEN, PHONE, WABA, TO, VISIBLE].join('\n') + '\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reponer-demo-a-'));
  registro = join(dir, 'curl.log');
  writeFileSync(registro, '');
  copyFileSync(join(AQUI, 'curl-falso-graph.sh'), join(dir, 'curl'));
  chmodSync(join(dir, 'curl'), 0o755);
  writeFileSync(envF(), BASE);
  chmodSync(envF(), 0o644);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Opc {
  entrada?: string;
  app?: unknown;
  numero?: unknown;
  lista?: unknown;
  args?: string[];
  env?: string;
  extra?: Record<string, string>;
}
function correr(o: Opc = {}) {
  const r = spawnSync('bash', [SCRIPT, '--env', o.env ?? envF(), ...(o.args ?? [])], {
    encoding: 'utf8',
    input: o.entrada ?? ENTRADA,
    env: entornoDelEmulador(undefined, {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      BASH_ENV: '',
      ENV: '',
      REGISTRO_CURL: registro,
      RESPUESTA_GRAPH: JSON.stringify(o.app ?? APP_PROPIA),
      RESPUESTA_NUMERO: JSON.stringify(o.numero ?? NUMERO_PROPIO),
      RESPUESTA_NUMEROS: JSON.stringify(o.lista ?? LISTA_OK),
      SUSCRITAS_GRAPH: '{}',
      NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: '',
      NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA: '',
      NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: '',
      ...SIN_RED,
      ...o.extra,
    }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  const llamadas = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
  return { codigo: r.status, salida, llamadas };
}
const sinCambios = () => { expect(readFileSync(envF(), 'utf8')).toBe(BASE); expect(respaldos()).toEqual([]); };
const sinSecretosEnSalida = (salida: string) => { for (const s of SECRETOS) expect(salida).not.toContain(s); };

describe('reponer-numero-demo-a.sh: seco y aplicar', () => {
  it('seco: valida, dice qué cambiaría, no escribe, no respalda y no muestra ningún valor', () => {
    const r = correr();
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Seco');
    expect(r.salida).toContain('…7237');
    expect(r.salida).toContain('…1360');
    sinSecretosEnSalida(r.salida);
    sinCambios();
  });

  it('--aplicar --confirmo: cambia solo las cinco variables, respalda en 600, deja el .env en 600 y no muestra valores', () => {
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(0);
    sinSecretosEnSalida(r.salida);
    const esperado = BASE
      .replace(TOKEN_VIEJO, TOKEN).replace(PHONE_VIEJO, PHONE).replace(WABA_VIEJA, WABA)
      .replace(TO_VIEJO, TO).replace(VISIBLE_VIEJO, VISIBLE);
    expect(readFileSync(envF(), 'utf8')).toBe(esperado);
    expect(statSync(envF()).mode & 0o777).toBe(0o600);
    expect(respaldos()).toHaveLength(1);
    const resp = join(dir, respaldos()[0]);
    expect(readFileSync(resp, 'utf8')).toBe(BASE);
    expect(statSync(resp).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.startsWith('.reponer-numero-demo-a.'))).toEqual([]);
    // lo que no es del número queda igual
    for (const l of ['WA_APP_ID=' + APP, 'WA_APP_SECRET=' + SECRETO_APP, 'N8N_API_KEY=clave-n8n', '# Demo A']) expect(readFileSync(envF(), 'utf8')).toContain(l);
  });

  it('destinatario y número visible en blanco: esas dos variables no se tocan', () => {
    const r = correr({ entrada: [TOKEN, PHONE, WABA, '', ''].join('\n') + '\n', args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(0);
    const txt = readFileSync(envF(), 'utf8');
    expect(txt).toContain(`WA_TO=${TO_VIEJO}`);
    expect(txt).toContain(`WA_TEST_NUMBER=${VISIBLE_VIEJO}`);
    expect(txt).toContain(`WA_PHONE_ID=${PHONE}`);
  });

  it('una variable ausente se AGREGA (WA_TO que el .env no traía)', () => {
    writeFileSync(envF(), BASE.replace(`WA_TO=${TO_VIEJO}\n`, ''));
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(0);
    expect(readFileSync(envF(), 'utf8')).toContain(`WA_TO=${TO}\n`);
  });

  it('solo lee en Graph (ninguna escritura) y el token nunca viaja en los argumentos de curl', () => {
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(0);
    expect(r.llamadas.length).toBeGreaterThan(0);
    expect(r.llamadas.filter((l) => l.startsWith('ESCRIBE '))).toEqual([]);
    for (const l of r.llamadas) expect(l.split('‹')[0]).not.toContain(TOKEN);
  });
});

describe('reponer-numero-demo-a.sh: lo que se niega sin escribir', () => {
  it('--aplicar sin terminal y sin --confirmo', () => {
    const r = correr({ args: ['--aplicar'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('--confirmo');
    sinCambios();
  });

  it('--confirmo con los últimos 4 equivocados', () => {
    const r = correr({ args: ['--aplicar', '--confirmo', '0000'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('no coincide');
    sinCambios();
  });

  it('un archivo que no se llama .env (otro entorno no es el Demo A)', () => {
    const otro = join(dir, '.env.demo-b');
    writeFileSync(otro, BASE);
    const r = correr({ env: otro, args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('.env');
    expect(readFileSync(otro, 'utf8')).toBe(BASE);
    expect(readdirSync(dir).filter((n) => n.includes('respaldo'))).toEqual([]);
  });

  it('un .env sin WA_APP_ID con forma de id', () => {
    writeFileSync(envF(), BASE.replace(`WA_APP_ID=${APP}\n`, ''));
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('no parece el .env del Demo A');
    expect(respaldos()).toEqual([]);
  });

  it('un token de OTRA app (Graph contesta otro id)', () => {
    const r = correr({ app: { id: id('99999', '99999'), name: 'NovuChat-Demo-A' }, args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('no de la');
    sinCambios();
  });

  it('un token de una app de WhatsApp-Modular (por nombre)', () => {
    const r = correr({ app: { id: APP, name: 'AAB1-WA-Prod' }, args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('WhatsApp-Modular');
    sinCambios();
  });

  it('una app propia pero que NO se llama NovuChat-Demo-A (otro entorno de NovuChat)', () => {
    const r = correr({ app: { id: APP, name: 'NovuChat-Asistente' }, args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('NovuChat-Demo-A');
    sinCambios();
  });

  it('un número que Graph dice que es de WhatsApp-Modular (nombre visible)', () => {
    const r = correr({ numero: { id: PHONE, verified_name: 'AAB1' }, args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(3);
    sinCambios();
  });

  it('una WABA que es de WhatsApp-Modular (huella del id, sin red)', () => {
    const huella = createHash('sha256').update(WABA).digest('hex');
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'], extra: { NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: huella } });
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('WhatsApp-Modular');
    expect(r.llamadas).toEqual([]);
    sinCambios();
  });

  it('un número que es de WhatsApp-Modular (huella del id, sin red)', () => {
    const huella = createHash('sha256').update(PHONE).digest('hex');
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'], extra: { NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA: huella } });
    expect(r.codigo).toBe(3);
    sinCambios();
  });

  it('Graph contesta otro número que el pedido', () => {
    const r = correr({ numero: { id: id('88888', '88888'), verified_name: 'Demo NovuChat' }, args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(3);
    sinCambios();
  });

  it('una WABA que, con ese token, no contiene el número (falta darle la WABA al usuario de sistema)', () => {
    const r = correr({ lista: { data: [] }, args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('no lista el número');
    sinCambios();
  });

  it('un phone id que ya pertenece a otro entorno de la carpeta', () => {
    writeFileSync(join(dir, '.env.cliente'), `WA_PHONE_ID=${PHONE}\n`);
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('.env.cliente');
    sinCambios();
  });

  it('una WABA que ya pertenece a otro entorno de la carpeta', () => {
    writeFileSync(join(dir, '.env.demo-b'), `WABA_ID=${WABA}\n`);
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('.env.demo-b');
    sinCambios();
  });

  it('`.env.recordatorios` es del mismo Demo A: compartir el número no es un choque', () => {
    writeFileSync(join(dir, '.env.recordatorios'), `WA_PHONE_ID=${PHONE}\nWABA_ID=${WABA}\n`);
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(0);
  });

  it.each([
    ['token sin la forma EAA', [`TOKEN-MALO-${'x'.repeat(60)}`, PHONE, WABA, TO, VISIBLE]],
    ['phone id demasiado corto', [TOKEN, '12345', WABA, TO, VISIBLE]],
    ['phone id con letras', [TOKEN, id('55500', '072ab'), WABA, TO, VISIBLE]],
    ['phone id igual a la WABA', [TOKEN, PHONE, PHONE, TO, VISIBLE]],
    ['destinatario con letras', [TOKEN, PHONE, WABA, 'hola', VISIBLE]],
    ['sin token (entrada vacía)', ['', PHONE, WABA, TO, VISIBLE]],
  ])('forma inválida: %s', (_n, lineas) => {
    const r = correr({ entrada: lineas.join('\n') + '\n', args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.llamadas).toEqual([]); // ni siquiera llega a Meta
    sinCambios();
  });

  it('asignaciones repetidas de una variable del número en el .env', () => {
    writeFileSync(envF(), BASE + `WA_PHONE_ID=${PHONE_VIEJO}\n`);
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('repetidas');
    expect(respaldos()).toEqual([]);
  });

  it('un .env con `export` en una de las variables', () => {
    writeFileSync(envF(), BASE.replace('WA_TOKEN=', 'export WA_TOKEN='));
    const r = correr({ args: ['--aplicar', '--confirmo', '7237'] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('export');
    expect(respaldos()).toEqual([]);
  });
});

describe('reponer-numero-demo-a.sh: lo que dice su código', () => {
  const fuente = readFileSync(SCRIPT, 'utf8');
  it('carga el candado de apps ajenas antes de leer el .env y no hace `source` de él', () => {
    expect(fuente.indexOf('source scripts/lib/apps-ajenas.sh')).toBeGreaterThan(-1);
    expect(fuente).not.toMatch(/source\s+["$]*\$?\{?ENV_ARCHIVO/);
    expect(fuente).not.toMatch(/^\s*set -x/m);
  });
  it('no escribe en Graph: ni -X, ni --data, ni -d', () => {
    expect(fuente).not.toMatch(/curl[^\n]*\s(-X|--request|--data|-d\s|--json|-F\s)/);
  });
  it('el token no va en argumentos: se lee con read -s o por la entrada estándar', () => {
    expect(fuente).toContain('read -r -s');
    expect(fuente).toMatch(/--confirmo/);
    expect(fuente).not.toMatch(/--token|--valor/);
  });
});
