/**
 * `scripts/habilitar-telefono-prueba.sh` (Andres, 24/11/2026): agrega o quita UN teléfono de la fila del comercio en la tabla local, sin imprimirla. Se prueba con una tabla de MENTIRA.
 * Lo que se niega: imprimir un teléfono o la tabla, tocar otra fila, romper la idempotencia, aceptar formas inválidas, escribir sobre una fila «pendiente».
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/habilitar-telefono-prueba.sh');
const RESETEAR = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/resetear-telefono.sh');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const BASE = ['# Tabla local de mentira', '', '| Marcador | Valor | Nota |', '|---|---|---|', '| `REEMPLAZAR_OTRA_COSA` | secreto-uno | x |', '| `REEMPLAZAR_TELEFONOS_DE_PRUEBA` | 59170000001 | general |', '| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_RROCA_RUBEN` | 59170000003 | rubén |', '', 'Texto final.'];

function armar(filas: string[] = BASE) {
  const dir = mkdtempSync(join(tmpdir(), 'novuchat-hab-')); dirs.push(dir);
  const tabla = join(dir, 'tabla.md');
  writeFileSync(tabla, filas.join('\n') + '\n'); chmodSync(tabla, 0o600);
  return tabla;
}
const correr = (tabla: string, args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: tabla }) });
const TEL = '59170000007';

describe('habilitar-telefono-prueba.sh', () => {
  it('agrega el teléfono en una fila NUEVA del comercio, deja lo demás igual y no imprime el número ni la tabla', () => {
    const t = armar();
    const antes = readFileSync(t, 'utf8');
    const r = correr(t, ['--tenant', 'walisuma', '--tel', TEL]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(TEL);
    expect(r.stdout + r.stderr).not.toMatch(/secreto-uno|59170000001|59170000003/);
    const despues = readFileSync(t, 'utf8');
    expect(despues).toContain('| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_WALISUMA` | ' + TEL + ' |');
    expect(despues.replace(/\| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_WALISUMA`.*\n/, '')).toBe(antes);
    expect(statSync(t).mode & 0o777).toBe(0o600);
  });
  it('es idempotente: agregar dos veces deja una sola vez el número, y la fila habilita al resetear (lista blanca)', () => {
    const t = armar();
    correr(t, ['--tenant', 'walisuma', '--tel', TEL]);
    const una = readFileSync(t, 'utf8');
    const r2 = correr(t, ['--tenant', 'walisuma', '--tel', TEL]);
    expect(r2.status).toBe(0);
    expect(r2.stdout).toMatch(/ya estaba/);
    expect(readFileSync(t, 'utf8')).toBe(una);
    expect(una.split(TEL).length - 1).toBe(1);
    const lista = spawnSync('bash', [RESETEAR, '--tenant', 'walisuma', '--tel', TEL], { encoding: 'utf8', env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: t, RESETEAR_SOLO_LISTA: '1' }) });
    expect(lista.status, lista.stderr).toBe(0);
  });
  it('suma a una fila existente del comercio sin tocar las filas de otros comercios; --quitar lo saca y es idempotente', () => {
    const t = armar();
    expect(correr(t, ['--tenant', 'rroca-ruben', '--tel', TEL]).status).toBe(0);
    let x = readFileSync(t, 'utf8');
    expect(x).toContain('| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_RROCA_RUBEN` | 59170000003,' + TEL + ' |');
    expect(x).toContain('| `REEMPLAZAR_TELEFONOS_DE_PRUEBA` | 59170000001 | general |');
    const q = correr(t, ['--tenant', 'rroca-ruben', '--tel', TEL, '--quitar']);
    expect(q.status).toBe(0); expect(q.stdout + q.stderr).not.toContain(TEL);
    x = readFileSync(t, 'utf8');
    expect(x).not.toContain(TEL); expect(x).toContain('59170000003');
    expect(correr(t, ['--tenant', 'rroca-ruben', '--tel', TEL, '--quitar']).stdout).toMatch(/no estaba/);
    expect(correr(t, ['--tenant', 'walisuma', '--tel', TEL, '--quitar']).stdout).toMatch(/nada que quitar/);
  });
  it('NEGADO: forma inválida de comercio o teléfono, y sin argumentos', () => {
    const t = armar(); const antes = readFileSync(t, 'utf8');
    for (const a of [['--tenant', '../x', '--tel', TEL], ['--tenant', 'walisuma', '--tel', '12ab'], ['--tenant', 'walisuma', '--tel', '1234567'], ['--tenant', 'walisuma', '--tel', '1234567890123456'], ['--tenant', 'walisuma'], ['--tel', TEL], ['--tenant', 'walisuma', '--tel', TEL, '--otra']]) {
      expect(correr(t, a).status, a.join(' ')).toBe(2);
    }
    expect(readFileSync(t, 'utf8')).toBe(antes);
  });
  it('NEGADO: una fila del comercio marcada «pendiente» no se toca; sin tabla o sin filas REEMPLAZAR_* no escribe', () => {
    const t = armar([...BASE.slice(0, 6), '| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_WALISUMA` | 59170000009 (pendiente) | x |']);
    const antes = readFileSync(t, 'utf8');
    const r = correr(t, ['--tenant', 'walisuma', '--tel', TEL]);
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/pendiente/); expect(r.stderr).not.toContain(TEL);
    expect(readFileSync(t, 'utf8')).toBe(antes);
    expect(correr(join(tmpdir(), 'no-existe-tabla.md'), ['--tenant', 'walisuma', '--tel', TEL]).status).toBe(1);
    const sin = armar(['# nada', '| a | b |']);
    expect(correr(sin, ['--tenant', 'walisuma', '--tel', TEL]).status).toBe(1);
    expect(readFileSync(sin, 'utf8')).toBe('# nada\n| a | b |\n');
  });
  it('NEGADO: dos filas del mismo comercio (la lista las junta) no se tocan; con CRLF la fila nueva conserva los finales de línea', () => {
    const doble = armar([...BASE.slice(0, 6), '| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_WALISUMA` | 59170000009 | a |', '| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_WALISUMA` | 59170000008 | b |']);
    const antes = readFileSync(doble, 'utf8');
    expect(correr(doble, ['--tenant', 'walisuma', '--tel', TEL, '--quitar']).status).toBe(1);
    expect(readFileSync(doble, 'utf8')).toBe(antes);
    const dir = mkdtempSync(join(tmpdir(), 'novuchat-hab-')); dirs.push(dir);
    const crlf = join(dir, 'tabla.md');
    writeFileSync(crlf, BASE.join('\r\n') + '\r\n');
    expect(correr(crlf, ['--tenant', 'walisuma', '--tel', TEL]).status).toBe(0);
    const x = readFileSync(crlf, 'utf8');
    expect(x.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(x).toContain('| `REEMPLAZAR_TELEFONOS_DE_PRUEBA_WALISUMA` | ' + TEL + ' | lista blanca de teléfonos de prueba del comercio (habilitar-telefono-prueba.sh) |\r\n');
  });
});
