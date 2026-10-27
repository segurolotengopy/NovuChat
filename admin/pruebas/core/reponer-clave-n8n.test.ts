/**
 * `scripts/reponer-clave-n8n.sh`: repone N8N_API_KEY en varios .env sin mostrarla.
 *
 * Se prueba NEGANDO, con un `curl` FALSO adelante en el PATH que hace de n8n: devuelve 200 si la
 * clave que le llega por la entrada estándar (`-H @-`) es la válida y 401 si no, y anota cada
 * llamada con sus ARGUMENTOS (para demostrar que la clave nunca viaja por ellos). Sin red ni n8n real.
 *
 * Lo que cierra cada grupo:
 *  - la clave nunca sale por pantalla, ni en éxito ni en error, ni llega a curl por argumentos;
 *  - el seco no escribe nada; la clave que n8n rechaza o con mala forma no escribe nada;
 *  - con --aplicar se reemplaza solo la línea N8N_API_KEY, el resto del .env queda intacto y en 600;
 *  - la sonda solo lee y dice solo el código HTTP; copiar toma la clave de otro .env.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'reponer-clave-n8n.sh');

const BASE = 'https://n8n.ejemplo.test';
const VALIDA = 'claveValidaDePrueba.AbCdEf123456-xyz';
const VIEJA = 'claveVieja.RevocadaDePrueba-98765';
const MALA_FORMA = 'tiene espacios y no sirve';
const CURL_FALSO = `#!/usr/bin/env python3
import os, sys
cab = sys.stdin.read().strip()
open(os.path.join(os.environ["FAKE_DIR"], "llamadas"), "a").write(" ".join(sys.argv[1:]) + "\\n")
sal = sys.argv[sys.argv.index("-o") + 1] if "-o" in sys.argv else None
if sal and sal != "/dev/null": open(sal, "w").write("{}")
print(200 if cab == "X-N8N-API-KEY: " + os.environ["FAKE_API_KEY"] else 401, end="")
`;

let dir: string;
let bin: string;
const envA = () => join(dir, '.env.a');
const envB = () => join(dir, '.env.b');
const envOk = () => join(dir, '.env.ok');
const SIN_CLAVE = () => join(dir, '.env.sin');
const llamadas = () => { try { return readFileSync(join(dir, 'llamadas'), 'utf8'); } catch { return ''; } };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reponer-clave-'));
  bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), CURL_FALSO, { mode: 0o755 });
  const cuerpo = (clave: string) => `# comentario\nN8N_BASE_URL=${BASE}\nN8N_API_KEY=${clave}\nOTRA=valor-que-no-se-toca\n`;
  writeFileSync(envA(), cuerpo(VIEJA), { mode: 0o600 });
  writeFileSync(envB(), cuerpo(VIEJA), { mode: 0o600 });
  writeFileSync(envOk(), cuerpo(VALIDA), { mode: 0o600 });
  writeFileSync(SIN_CLAVE(), `N8N_BASE_URL=${BASE}\n`, { mode: 0o600 });
  for (const f of [envA(), envB(), envOk(), SIN_CLAVE()]) chmodSync(f, 0o644);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(args: string[], entrada = '') {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    input: entrada,
    env: entornoDelEmulador(undefined, { PATH: `${bin}:/usr/bin:/bin`, FAKE_DIR: dir, FAKE_API_KEY: VALIDA }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  for (const s of [VALIDA, VIEJA, MALA_FORMA]) expect(salida).not.toContain(s);
  expect(salida).not.toContain(BASE);
  for (const s of [VALIDA, VIEJA]) expect(llamadas()).not.toContain(s);
  return { codigo: r.status, salida };
}
const claveDe = (f: string) => /^N8N_API_KEY=(.*)$/m.exec(readFileSync(f, 'utf8'))?.[1];

describe('reponer-clave-n8n.sh: sonda (solo lee)', () => {
  it('dice solo el código HTTP por .env y sale 1 si alguno falla', () => {
    const r = correr(['sonda', '--env', envA(), '--env', envOk()]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(`${envA()}: HTTP 401`);
    expect(r.salida).toContain(`${envOk()}: HTTP 200`);
    expect(claveDe(envA())).toBe(VIEJA);
  });
  it('rechaza opciones de escritura', () => {
    expect(correr(['sonda', '--env', envA(), '--aplicar']).codigo).toBe(2);
    expect(llamadas()).toBe('');
  });
});

describe('reponer-clave-n8n.sh: reponer', () => {
  it('seco: n8n acepta la clave y no se escribe nada', () => {
    const r = correr(['reponer', '--stdin', '--env', envA(), '--env', envB()], `${VALIDA}\n`);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Seco');
    expect(claveDe(envA())).toBe(VIEJA);
    expect(claveDe(envB())).toBe(VIEJA);
  });

  it('--aplicar: reemplaza solo la línea de la clave, deja el resto y el modo 600, y confirma 200', () => {
    const antes = readFileSync(envA(), 'utf8').replace(VIEJA, VALIDA);
    const r = correr(['reponer', '--stdin', '--aplicar', '--env', envA(), '--env', envB()], `${VALIDA}\n`);
    expect(r.codigo).toBe(0);
    expect(readFileSync(envA(), 'utf8')).toBe(antes);
    expect(claveDe(envB())).toBe(VALIDA);
    expect(statSync(envA()).mode & 0o777).toBe(0o600);
    expect(statSync(envB()).mode & 0o777).toBe(0o600);
    expect(r.salida).toContain(`${envB()}: HTTP 200`);
  });

  it('una clave que n8n rechaza NO escribe nada', () => {
    const r = correr(['reponer', '--stdin', '--aplicar', '--env', envA()], `${VIEJA}\n`);
    expect(r.codigo).toBe(1);
    expect(claveDe(envA())).toBe(VIEJA);
  });

  it('una clave con mala forma se aborta sin llamar a n8n ni escribir', () => {
    const r = correr(['reponer', '--stdin', '--aplicar', '--env', envA()], `${MALA_FORMA}\n`);
    expect(r.codigo).toBe(2);
    expect(llamadas()).toBe('');
    expect(claveDe(envA())).toBe(VIEJA);
  });

  it('un .env sin línea N8N_API_KEY aborta todo antes de escribir', () => {
    const r = correr(['reponer', '--stdin', '--aplicar', '--env', envA(), '--env', SIN_CLAVE()], `${VALIDA}\n`);
    expect(r.codigo).toBe(2);
    expect(claveDe(envA())).toBe(VIEJA);
    expect(llamadas()).toBe('');
  });

  it('sin clave en la entrada no hace nada', () => {
    expect(correr(['reponer', '--stdin', '--aplicar', '--env', envA()], '').codigo).toBe(2);
    expect(claveDe(envA())).toBe(VIEJA);
  });
});

describe('reponer-clave-n8n.sh: copiar', () => {
  it('toma la clave de otro .env y la repone solo con --aplicar', () => {
    const seco = correr(['copiar', '--desde', envOk(), '--env', envA()]);
    expect(seco.codigo).toBe(0);
    expect(claveDe(envA())).toBe(VIEJA);
    const r = correr(['copiar', '--desde', envOk(), '--aplicar', '--env', envA(), '--env', envB()]);
    expect(r.codigo).toBe(0);
    expect(claveDe(envA())).toBe(VALIDA);
    expect(claveDe(envB())).toBe(VALIDA);
  });
  it('si la clave de origen no sirve, no escribe nada', () => {
    const r = correr(['copiar', '--desde', envB(), '--aplicar', '--env', envA()]);
    expect(r.codigo).toBe(1);
    expect(claveDe(envA())).toBe(VIEJA);
  });
  it('exige --desde y rechaza --stdin', () => {
    expect(correr(['copiar', '--env', envA()]).codigo).toBe(2);
    expect(correr(['copiar', '--stdin', '--desde', envOk(), '--env', envA()]).codigo).toBe(2);
  });
});
