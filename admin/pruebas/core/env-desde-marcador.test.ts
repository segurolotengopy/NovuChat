/**
 * `scripts/env-desde-marcador.sh`: copia el valor de una fila de CONFIGURACION.local.md a una
 * variable de un .env SIN mostrarlo. Se prueba NEGANDO, con una tabla y un .env FALSOS en tmp.
 *
 * Lo que cierra cada grupo:
 *  - el seco no escribe; el valor nunca sale por stdout/stderr, ni en éxito ni en error;
 *  - con --aplicar se respalda (600), se agrega solo la línea pedida y el resto queda byte a byte igual;
 *  - marcador ausente o duplicado, variable o marcador fuera de la lista, valor no atómico, valor distinto ya
 *    presente, .env ambiguo o enlace a otro dueño: se niegan sin escribir.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'env-desde-marcador.sh');

const VARIABLE = 'PLANILLA_PROSPECTOS_ID_NOVUCHAT';
const MARCADOR = 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID';
const VALOR = 'hojaFalsaDePrueba_AbC-123';
const OTRO = 'otraHojaFalsa_XyZ-987';
const BASE_ENV = '# comentario\nA=1\n\n  B=dos # nota\nZ=ultima\n';

let dir: string;
const envF = () => join(dir, '.env');
const localF = () => join(dir, 'CONFIGURACION.local.md');
const tabla = (filas: string) => `# Local\n\n| Marcador | Valor | Nota |\n|---|---|---|\n| \`\${OTRA}\` | x | n |\n${filas}| \`\${FIN}\` | y | n |\n`;
const fila = (valor: string, nota = 'real') => `| \`\${${MARCADOR}}\` | ${valor} | ${nota} |\n`;
const respaldos = () => readdirSync(dir).filter((n) => n.startsWith('.env.respaldo-'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'env-marcador-'));
  writeFileSync(localF(), tabla(fila(VALOR)));
  writeFileSync(envF(), BASE_ENV);
  chmodSync(envF(), 0o644);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(args: string[], extra: string[] = ['--local', localF()]) {
  const r = spawnSync('bash', [SCRIPT, '--env', envF(), '--variable', VARIABLE, '--marcador', MARCADOR, ...extra, ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined, { HOME: dir }) });
  const salida = `${r.stdout}${r.stderr}`;
  for (const s of [VALOR, OTRO]) expect(salida).not.toContain(s);
  return { codigo: r.status, salida };
}
const sinCambios = () => { expect(readFileSync(envF(), 'utf8')).toBe(BASE_ENV); expect(respaldos()).toEqual([]); };

describe('env-desde-marcador.sh: seco y aplicar', () => {
  it('seco: dice qué haría y no escribe ni respalda', () => {
    const r = correr([]);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Seco');
    expect(r.salida).toContain(VARIABLE);
    sinCambios();
  });

  it('--aplicar: agrega solo la línea, respalda en 600, deja el .env en 600 y no muestra el valor', () => {
    const r = correr(['--aplicar']);
    expect(r.codigo).toBe(0);
    expect(readFileSync(envF(), 'utf8')).toBe(`${BASE_ENV}${VARIABLE}=${VALOR}\n`);
    expect(statSync(envF()).mode & 0o777).toBe(0o600);
    expect(respaldos()).toHaveLength(1);
    const resp = join(dir, respaldos()[0]);
    expect(readFileSync(resp, 'utf8')).toBe(BASE_ENV);
    expect(statSync(resp).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.startsWith('.env-desde-marcador.'))).toEqual([]);
  });

  it('un .env sin salto final no se pega a la línea nueva; lo previo queda igual', () => {
    writeFileSync(envF(), 'A=1\nB=2');
    expect(correr(['--aplicar']).codigo).toBe(0);
    expect(readFileSync(envF(), 'utf8')).toBe(`A=1\nB=2\n${VARIABLE}=${VALOR}\n`);
  });

  it('completa la línea vacía en su lugar, sin tocar las demás', () => {
    writeFileSync(envF(), `A=1\n${VARIABLE}=\nZ=2\n`);
    expect(correr(['--aplicar']).codigo).toBe(0);
    expect(readFileSync(envF(), 'utf8')).toBe(`A=1\n${VARIABLE}=${VALOR}\nZ=2\n`);
  });

  it('mismo valor: dice «ya estaba» y no respalda ni escribe', () => {
    const c = `A=1\n${VARIABLE}=${VALOR}\n`;
    writeFileSync(envF(), c);
    const r = correr(['--aplicar']);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('ya estaba');
    expect(readFileSync(envF(), 'utf8')).toBe(c);
    expect(respaldos()).toEqual([]);
  });

  it('enlace simbólico a un archivo común del usuario: escribe el real y conserva el enlace', () => {
    const real = join(dir, 'real.env');
    writeFileSync(real, BASE_ENV);
    rmSync(envF());
    symlinkSync(real, envF());
    expect(correr(['--aplicar']).codigo).toBe(0);
    expect(lstatSync(envF()).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe(`${BASE_ENV}${VARIABLE}=${VALOR}\n`);
  });
});

describe('env-desde-marcador.sh: se niega sin escribir', () => {
  it('no pisa un valor distinto', () => {
    const c = `A=1\n${VARIABLE}=${OTRO}\n`;
    writeFileSync(envF(), c);
    const r = correr(['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(readFileSync(envF(), 'utf8')).toBe(c);
    expect(respaldos()).toEqual([]);
  });

  it('marcador ausente', () => {
    writeFileSync(localF(), tabla(''));
    expect(correr(['--aplicar']).codigo).toBe(1);
    sinCambios();
  });

  it('marcador duplicado', () => {
    writeFileSync(localF(), tabla(fila(VALOR) + fila(OTRO)));
    expect(correr(['--aplicar']).codigo).toBe(1);
    sinCambios();
  });

  it('fila pendiente o vacía', () => {
    writeFileSync(localF(), tabla(fila(VALOR, 'pendiente')));
    expect(correr(['--aplicar']).codigo).toBe(1);
    writeFileSync(localF(), tabla(fila('')));
    expect(correr(['--aplicar']).codigo).toBe(1);
    sinCambios();
  });

  for (const [nombre, v] of [['espacios', 'dos palabras'], ['comillas', '"abc"'], ['signo de dólar', 'a$b'], ['punto y coma', 'a;b']] as const) {
    it(`valor no atómico (${nombre})`, () => {
      writeFileSync(localF(), tabla(fila(v)));
      const r = correr(['--aplicar']);
      expect(r.codigo).toBe(1);
      expect(r.salida).not.toContain(v);
      sinCambios();
    });
  }

  it('variable fuera de la lista', () => {
    const r = spawnSync('bash', [SCRIPT, '--env', envF(), '--variable', 'N8N_API_KEY', '--marcador', MARCADOR, '--local', localF()], { encoding: 'utf8', env: entornoDelEmulador(undefined, { HOME: dir }) });
    expect(r.status).toBe(2);
    sinCambios();
  });

  it('marcador fuera de la lista', () => {
    const r = spawnSync('bash', [SCRIPT, '--env', envF(), '--variable', VARIABLE, '--marcador', 'REEMPLAZAR_OTRO', '--local', localF()], { encoding: 'utf8', env: entornoDelEmulador(undefined, { HOME: dir }) });
    expect(r.status).toBe(2);
    sinCambios();
  });

  it('opciones faltantes o desconocidas', () => {
    expect(spawnSync('bash', [SCRIPT, '--env', envF()], { encoding: 'utf8', env: entornoDelEmulador(undefined, { HOME: dir }) }).status).toBe(2);
    expect(correr(['--reemplazar']).codigo).toBe(2);
  });

  const ambiguos: Array<[string, string]> = [
    ['dos asignaciones', `${VARIABLE}=\n${VARIABLE}=\n`],
    ['export', `export ${VARIABLE}=\n`],
  ];
  for (const [nombre, c] of ambiguos) {
    it(`.env ambiguo (${nombre})`, () => {
      writeFileSync(envF(), c);
      expect(correr(['--aplicar']).codigo).toBe(1);
      expect(readFileSync(envF(), 'utf8')).toBe(c);
      expect(respaldos()).toEqual([]);
    });
  }

  it('.env o tabla inexistentes, o .env que es un directorio', () => {
    rmSync(envF());
    expect(correr(['--aplicar']).codigo).toBe(1);
    writeFileSync(envF(), BASE_ENV);
    expect(correr(['--aplicar'], ['--local', join(dir, 'no-existe.md')]).codigo).toBe(1);
    expect(correr(['--aplicar'], ['--local', dir]).codigo).toBe(1);
    sinCambios();
  });
});
