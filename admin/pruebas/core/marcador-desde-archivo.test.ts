/**
 * `scripts/marcador-desde-archivo.sh`: copia un identificador desde un archivo local de CLIENTES/ a una fila de
 * CONFIGURACION.local.md sin mostrar nunca su valor.
 *
 * Hermética: corre el script real contra archivos FALSOS en un directorio temporal (`CLIENTES_RAIZ` y `CONFIG_LOCAL`);
 * jamás toca CONFIGURACION.local.md ni CLIENTES/ reales. Se prueba sobre todo NEGANDO: no imprime el valor ni en seco
 * ni al aplicar ni en un error, no lee fuera de CLIENTES/, no sigue enlaces, no copia una clave que no corresponde
 * al marcador, no escribe con 0 o con 2 líneas candidatas, no pisa una fila existente sin --reemplazar.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'marcador-desde-archivo.sh');

// Armados al vuelo: el saneo del repositorio público veta literales de 10 o más dígitos.
const PHONE = ['12345', '67890', '123'].join('');
const WABA = ['98765', '43210', '987'].join('');
const MARCADOR = 'REEMPLAZAR_PHONE_NUMBER_ID_CLIENTE05';
const TABLA = ['# Valores locales (falsos)', '', '| Marcador | Valor | Nota |', '|---|---|---|', '| `REEMPLAZAR_OTRO` | otro-valor |  |', ''].join('\n');
const IDS = ['# ids (falso)', '', `- phone_number_id: ${PHONE}`, `- waba_id: ${WABA}`, ''].join('\n');

let dir: string;
let clientes: string;
let origen: string;
let local: string;

const correr = (args: string[], extra: Record<string, string> = {}) =>
  spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { HOME: dir, NOVUCHAT_PRUEBAS: '1', CLIENTES_RAIZ: clientes, CONFIG_LOCAL: local, ...extra }),
  });
const todo = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;
const base = () => ['--marcador', MARCADOR, '--de', origen, '--clave', 'phone_number_id', '--cliente', 'X'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'desde-archivo-'));
  clientes = join(dir, 'CLIENTES');
  mkdirSync(join(clientes, 'X', 'cuenta'), { recursive: true });
  origen = join(clientes, 'X', 'cuenta', 'ids-meta.local.md');
  writeFileSync(origen, IDS, { mode: 0o600 });
  chmodSync(origen, 0o600);
  local = join(dir, 'CONFIGURACION.local.md');
  writeFileSync(local, TABLA, { mode: 0o600 });
  chmodSync(local, 0o600);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('marcador-desde-archivo.sh', () => {
  it('en seco no escribe nada, no muestra el valor y dice si la fila existe', () => {
    const r = correr(base());
    expect(r.status).toBe(0);
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
    expect(readdirSync(dir).filter((f) => f.includes('.respaldo'))).toEqual([]);
    expect(todo(r)).toContain('Seco');
    expect(todo(r)).not.toContain(PHONE);
  });

  it('con --aplicar agrega la fila con el valor, sin mostrarlo, y respalda', () => {
    const r = correr([...base(), '--aplicar']);
    expect(r.status).toBe(0);
    expect(todo(r)).not.toContain(PHONE);
    expect(readFileSync(local, 'utf8')).toContain(`| \`${MARCADOR}\` | ${PHONE} |`);
    expect(readdirSync(dir).filter((f) => f.includes('.respaldo'))).toHaveLength(1);
  });

  it('NEGACIÓN: no pisa una fila existente sin --reemplazar, y con --reemplazar sí', () => {
    writeFileSync(local, `${TABLA}| \`${MARCADOR}\` | viejo-valor | pendiente |\n`, { mode: 0o600 });
    const sin = correr([...base(), '--aplicar']);
    expect(readFileSync(local, 'utf8')).toContain('viejo-valor');
    expect(todo(sin)).not.toContain(PHONE);
    const con = correr([...base(), '--aplicar', '--reemplazar']);
    expect(con.status).toBe(0);
    expect(readFileSync(local, 'utf8')).toContain(PHONE);
    expect(todo(con)).not.toContain(PHONE);
  });

  it('NEGACIÓN: una clave que no corresponde al marcador (waba_id a un PHONE_NUMBER_ID) se rechaza', () => {
    const r = correr(['--marcador', MARCADOR, '--de', origen, '--clave', 'waba_id', '--cliente', 'X', '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('solo va a un marcador');
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
    expect(todo(r)).not.toContain(WABA);
  });

  it('NEGACIÓN: una clave fuera de la lista cerrada se rechaza', () => {
    const r = correr(['--marcador', MARCADOR, '--de', origen, '--clave', 'token', '--cliente', 'X', '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('Clave no permitida');
  });

  it('NEGACIÓN: un archivo fuera de CLIENTES/ se rechaza sin leerlo', () => {
    const fuera = join(dir, 'ids-meta.local.md');
    writeFileSync(fuera, IDS, { mode: 0o600 });
    const r = correr(['--marcador', MARCADOR, '--de', fuera, '--clave', 'phone_number_id', '--cliente', 'X', '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('dentro de CLIENTES');
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
  });

  it('NEGACIÓN: un enlace simbólico (aunque apunte dentro) se rechaza', () => {
    const enlace = join(clientes, 'X', 'cuenta', 'enlace.local.md');
    symlinkSync(origen, enlace);
    const r = correr(['--marcador', MARCADOR, '--de', enlace, '--clave', 'phone_number_id', '--cliente', 'X', '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('enlace simbólico');
  });

  it('NEGACIÓN: un archivo que no se llama *.local.md o escribible por otros se rechaza', () => {
    const otro = join(clientes, 'X', 'cuenta', 'ids-meta.md');
    writeFileSync(otro, IDS, { mode: 0o600 });
    const a = correr(['--marcador', MARCADOR, '--de', otro, '--clave', 'phone_number_id', '--cliente', 'X', '--aplicar']);
    expect(a.status).not.toBe(0);
    chmodSync(origen, 0o666);
    const b = correr([...base(), '--aplicar']);
    expect(b.status).not.toBe(0);
    expect(todo(b)).toContain('escribible');
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
  });

  it('NEGACIÓN: cero líneas o dos líneas candidatas aborta sin escribir ni mostrar valores', () => {
    writeFileSync(origen, '# vacío\n', { mode: 0o600 });
    const cero = correr([...base(), '--aplicar']);
    expect(cero.status).not.toBe(0);
    writeFileSync(origen, `${IDS}- phone_number_id: ${'7'.repeat(13)}\n`, { mode: 0o600 });
    const dos = correr([...base(), '--aplicar']);
    expect(dos.status).not.toBe(0);
    expect(todo(dos)).not.toContain('7777');
    expect(todo(dos)).not.toContain(PHONE);
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
  });

  it('NEGACIÓN: un valor que no es un identificador numérico no se entrega, ni siquiera impreso en el error', () => {
    writeFileSync(origen, '- phone_number_id: no-es-un-numero|raro\n', { mode: 0o600 });
    const r = correr([...base(), '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).not.toContain('no-es-un-numero');
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
  });

  it('NEGACIÓN: un marcador mal formado se rechaza', () => {
    const r = correr(['--marcador', 'REEMPLAZAR_x|y', '--de', origen, '--clave', 'phone_number_id', '--cliente', 'X', '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('Un marcador es REEMPLAZAR_');
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
  });

  it('NEGACIÓN: sin NOVUCHAT_PRUEBAS el entorno no puede ensanchar la raíz ni cambiar la tabla (CLIENTES_RAIZ y CONFIG_LOCAL se ignoran)', () => {
    // La raíz fija es $HOME/NovuChat/CLIENTES; HOME apunta al temporal, donde esa carpeta no existe: el origen cae fuera.
    const r = correr([...base(), '--aplicar'], { NOVUCHAT_PRUEBAS: '0' });
    expect(r.status).not.toBe(0);
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
    expect(todo(r)).not.toContain(PHONE);
  });

  it('NEGACIÓN: un origen de OTRO cliente (--cliente no coincide con la carpeta) se rechaza', () => {
    mkdirSync(join(clientes, 'Y'), { recursive: true });
    const r = correr(['--marcador', MARCADOR, '--de', origen, '--clave', 'phone_number_id', '--cliente', 'Y', '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('CLIENTES/Y/');
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
  });

  it('NEGACIÓN: sin --cliente se rechaza; con una carpeta mal escrita también', () => {
    const sin = correr(['--marcador', MARCADOR, '--de', origen, '--clave', 'phone_number_id', '--aplicar']);
    expect(sin.status).not.toBe(0);
    expect(todo(sin)).toContain('Faltan');
    const mal = correr(['--marcador', MARCADOR, '--de', origen, '--clave', 'phone_number_id', '--cliente', '../X', '--aplicar']);
    expect(mal.status).not.toBe(0);
    expect(todo(mal)).toContain('mayúsculas, dígitos');
  });

  it('NEGACIÓN: un origen escribible por el grupo (0o620) se rechaza con su motivo', () => {
    chmodSync(origen, 0o620);
    const r = correr([...base(), '--aplicar']);
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('grupo');
    expect(readFileSync(local, 'utf8')).toBe(TABLA);
  });

  it('en seco con la fila ya existente lo dice, y con --aplicar escribe la nota y conserva las demás filas', () => {
    writeFileSync(local, `${TABLA}| \`${MARCADOR}\` | viejo-valor |  |\n`, { mode: 0o600 });
    const seco = correr(base());
    expect(todo(seco)).toContain('ya está en la tabla: sí');
    const otra = 'REEMPLAZAR_PHONE_NUMBER_ID_CLIENTE06';
    const r = correr(['--marcador', otra, '--de', origen, '--clave', 'phone_number_id', '--cliente', 'X', '--aplicar']);
    expect(r.status).toBe(0);
    const texto = readFileSync(local, 'utf8');
    expect(texto).toContain('| `REEMPLAZAR_OTRO` | otro-valor |');
    expect(texto).toContain('viejo-valor');
    expect(texto).toContain('copiado de CLIENTES/X/ids-meta.local.md');
  });

  it('NEGACIÓN: una tabla de valores inexistente aborta el seco con motivo (no dice "no está en la tabla")', () => {
    rmSync(local);
    const r = correr(base());
    expect(r.status).not.toBe(0);
    expect(todo(r)).toContain('no existe o no se puede leer');
  });

  it('acepta finales de línea CRLF en el origen', () => {
    writeFileSync(origen, `- phone_number_id: ${PHONE}\r\n`, { mode: 0o600 });
    const r = correr([...base(), '--aplicar']);
    expect(r.status).toBe(0);
    expect(readFileSync(local, 'utf8')).toContain(`| \`${MARCADOR}\` | ${PHONE} |`);
  });
});
