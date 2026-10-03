/**
 * `scripts/marcador-local.sh --reemplazar`: renueva el valor de una fila
 * EXISTENTE de la tabla de marcadores sin mostrarlo nunca.
 *
 * Hermética: corre el script real contra un archivo FALSO en un directorio
 * temporal (`--archivo`); jamás toca CONFIGURACION.local.md. Se prueba negando:
 * qué NO debe pasar (pisar sin la bandera, escribir con una fila ausente,
 * imprimir un valor, aceptar un valor que rompe la tabla).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'marcador-local.sh');

const VIEJO = '1'.repeat(13);
const NUEVO = '9'.repeat(13);
const OTRO = 'OTRO-VALOR-222';
const CONTENIDO = [
  '# Valores locales (falsos)',
  '',
  '| Marcador | Valor | Nota |',
  '|---|---|---|',
  `| \`REEMPLAZAR_MEDIA_ID_QR_DEMO\` | ${VIEJO} | vence a los 30 días |`,
  `| \`REEMPLAZAR_OTRO\` | ${OTRO} |  |`,
  '',
  'texto final  con  espacios dobles',
  '',
].join('\n');

let dir: string;
let archivo: string;

const correr = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('bash', [SCRIPT, '--archivo', archivo, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { HOME: dir, ...env }),
  });
const salida = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;
const respaldos = () => readdirSync(dir).filter((f) => f.includes('.respaldo'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'marcador-'));
  archivo = join(dir, 'CONFIGURACION.local.md');
  writeFileSync(archivo, CONTENIDO, { mode: 0o600 });
  chmodSync(archivo, 0o600);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('marcador-local.sh --reemplazar', () => {
  it('reemplaza solo la fila pedida y deja el resto byte a byte igual', () => {
    const r = correr(['--marcador', 'REEMPLAZAR_MEDIA_ID_QR_DEMO', '--valor', NUEVO, '--reemplazar']);
    expect(r.status).toBe(0);
    expect(readFileSync(archivo, 'utf8')).toBe(CONTENIDO.replace(`| ${VIEJO} |`, `| ${NUEVO} |`));
  });

  it('acepta el valor por MARCADOR_VALOR', () => {
    const r = correr(['--marcador', 'REEMPLAZAR_OTRO', '--reemplazar'], { MARCADOR_VALOR: NUEVO });
    expect(r.status).toBe(0);
    expect(readFileSync(archivo, 'utf8')).toBe(CONTENIDO.replace(`| ${OTRO} |`, `| ${NUEVO} |`));
  });

  it('una fila inexistente aborta sin tocar el archivo ni crear respaldos', () => {
    const r = correr(['--marcador', 'REEMPLAZAR_NO_EXISTE', '--valor', NUEVO, '--reemplazar']);
    expect(r.status).not.toBe(0);
    expect(readFileSync(archivo, 'utf8')).toBe(CONTENIDO);
    expect(respaldos()).toEqual([]);
  });

  it('sin --reemplazar no pisa una fila existente (comportamiento de siempre)', () => {
    const r = correr(['--marcador', 'REEMPLAZAR_MEDIA_ID_QR_DEMO', '--valor', NUEVO]);
    expect(r.status).toBe(0);
    expect(readFileSync(archivo, 'utf8')).toBe(CONTENIDO);
    expect(respaldos()).toEqual([]);
  });

  it('nunca imprime el valor, ni el anterior ni el nuevo', () => {
    for (const args of [
      ['--marcador', 'REEMPLAZAR_MEDIA_ID_QR_DEMO', '--valor', NUEVO, '--reemplazar'],
      ['--marcador', 'REEMPLAZAR_NO_EXISTE', '--valor', NUEVO, '--reemplazar'],
      ['--marcador', 'REEMPLAZAR_OTRO', '--valor', `${NUEVO} |x`, '--reemplazar'],
    ]) {
      const r = correr(args);
      const s = salida(r);
      for (const secreto of [VIEJO, NUEVO, OTRO]) expect(s).not.toContain(secreto);
    }
  });

  it.each([
    ['barra vertical', 'abc|def'],
    ['fila de tabla', 'a | b | c'],
    ['salto de línea', 'abc\ndef'],
    ['barra invertida', 'abc\\ndef'],
    ['espacio al inicio', ' abc'],
    ['espacio al final', 'abc '],
    ['vacío', ''],
    ['tabulador', 'abc\tdef'],
    ['retorno de carro', 'abc\rdef'],
    ['comillas', 'abc"def'],
  ])('rechaza un valor con %s y no escribe', (_n, valor) => {
    const r = correr(['--marcador', 'REEMPLAZAR_MEDIA_ID_QR_DEMO', '--valor', valor, '--reemplazar']);
    expect(r.status).not.toBe(0);
    expect(readFileSync(archivo, 'utf8')).toBe(CONTENIDO);
    expect(respaldos()).toEqual([]);
  });

  it('conserva el modo del archivo: 600 sigue en 600 y otro modo no cambia', () => {
    for (const modo of [0o600, 0o640]) {
      chmodSync(archivo, modo);
      const r = correr(['--marcador', 'REEMPLAZAR_OTRO', '--valor', `${NUEVO}-${modo}`, '--reemplazar']);
      expect(r.status).toBe(0);
      expect(statSync(archivo).mode & 0o777).toBe(modo);
    }
  });

  it('crea un respaldo con modo 600, con fecha, con el contenido anterior, y no pisa uno previo', () => {
    chmodSync(archivo, 0o640);
    // `date` falso: las dos corridas caen en el MISMO segundo, siempre.
    const falso = join(dir, 'bin');
    mkdirSync(falso);
    writeFileSync(join(falso, 'date'), '#!/bin/sh\necho 20260101-000000\n', { mode: 0o755 });
    const env = { PATH: `${falso}:${process.env.PATH ?? ''}` };
    const a = correr(['--marcador', 'REEMPLAZAR_OTRO', '--valor', 'PRIMERO-1', '--reemplazar'], env);
    const b = correr(['--marcador', 'REEMPLAZAR_OTRO', '--valor', 'SEGUNDO-2', '--reemplazar'], env);
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    const rs = respaldos();
    expect(rs.sort()).toEqual(['CONFIGURACION.local.md.respaldo-20260101-000000', 'CONFIGURACION.local.md.respaldo-20260101-000000-1']);
    for (const f of rs) {
      expect(f).toMatch(/\.respaldo-\d{8}-\d{6}/);
      expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    }
    const contenidos = rs.map((f) => readFileSync(join(dir, f), 'utf8'));
    expect(contenidos).toContain(CONTENIDO);
    expect(a.stdout).toContain('respaldo');
  });

  it('una fila repetida (también dentro de <!-- -->) aborta sin tocar nada ni respaldar', () => {
    const fila = `| \`REEMPLAZAR_OTRO\` | ${OTRO} |  |`;
    const variantes = [
      CONTENIDO + `${fila}\n`,
      CONTENIDO + `<!--\n| \`REEMPLAZAR_OTRO\` | ${NUEVO}-viejo | antigua |\n-->\n`,
    ];
    for (const texto of variantes) {
      writeFileSync(archivo, texto);
      const r = correr(['--marcador', 'REEMPLAZAR_OTRO', '--valor', NUEVO, '--reemplazar']);
      expect(r.status).not.toBe(0);
      expect(readFileSync(archivo, 'utf8')).toBe(texto);
      expect(respaldos()).toEqual([]);
    }
  });

  it('MEDIA_ID exige solo dígitos (10 a 20)', () => {
    for (const v of ['abc' + '7'.repeat(10), '7'.repeat(9), '7'.repeat(21)]) {
      const r = correr(['--marcador', 'REEMPLAZAR_MEDIA_ID_QR_DEMO', '--valor', v, '--reemplazar']);
      expect(r.status).not.toBe(0);
      expect(readFileSync(archivo, 'utf8')).toBe(CONTENIDO);
    }
  });

  it('un enlace simbólico se resuelve: el enlace sigue siendo enlace y el destino cambia', () => {
    const enlace = join(dir, 'enlace.md');
    symlinkSync(archivo, enlace);
    const r = spawnSync('bash', [SCRIPT, '--archivo', enlace, '--marcador', 'REEMPLAZAR_OTRO', '--valor', NUEVO, '--reemplazar'], {
      encoding: 'utf8',
      env: entornoDelEmulador(undefined, { HOME: dir }),
    });
    expect(r.status).toBe(0);
    expect(lstatSync(enlace).isSymbolicLink()).toBe(true);
    expect(readFileSync(archivo, 'utf8')).toBe(CONTENIDO.replace(`| ${OTRO} |`, `| ${NUEVO} |`));
  });

  it('SHELLOPTS=xtrace no imprime el valor', () => {
    const r = correr(['--marcador', 'REEMPLAZAR_OTRO', '--valor', 'SECRETO-XTRACE-77', '--reemplazar'], { SHELLOPTS: 'xtrace' });
    expect(r.status).toBe(0);
    expect(salida(r)).not.toContain('SECRETO-XTRACE-77');
    expect(salida(r)).not.toContain(OTRO);
  });

  it('avisa, sin imprimir el valor, si la nota dice «pendiente»', () => {
    writeFileSync(archivo, CONTENIDO.replace('vence a los 30 días', 'Pendiente de cargar'));
    const r = correr(['--marcador', 'REEMPLAZAR_MEDIA_ID_QR_DEMO', '--valor', NUEVO, '--reemplazar']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('pendiente');
    expect(salida(r)).not.toContain(NUEVO);
    expect(salida(r)).not.toContain(VIEJO);
  });

  it('no deja temporales atrás', () => {
    correr(['--marcador', 'REEMPLAZAR_OTRO', '--valor', NUEVO, '--reemplazar']);
    expect(readdirSync(dir).filter((f) => f.includes('.nuevo.'))).toEqual([]);
  });
});
