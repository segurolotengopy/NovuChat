/**
 * `scripts/nube-novutienda.sh`: las salvaguardas del script de nube de PRODUCCIÓN del secreto de NovuTienda.
 * Con un `gcloud` FALSO que anota cada llamada: las salidas por uso o salvaguarda (código 2) no llaman a gcloud.
 * NO se ejecuta nada contra la nube. El camino con gcloud (IAM, secreto) es el mismo de `nube-alertas.sh`
 * (probado en `nube-alertas.test.ts`); acá se comprueba lo propio: prefijo, secreto, mapa y que nada se imprima.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'nube-novutienda.sh');
const FUENTE = readFileSync(SCRIPT, 'utf8');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nube-nt-'));
  mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'run'), { mode: 0o700 }); chmodSync(join(dir, 'run'), 0o700);
  writeFileSync(join(dir, 'bin', 'gcloud'), '#!/usr/bin/env bash\necho "$*" >> "$FAKE_DIR/llamadas"\nexit 1\n');
  chmodSync(join(dir, 'bin', 'gcloud'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const llamadas = () => (existsSync(join(dir, 'llamadas')) ? readFileSync(join(dir, 'llamadas'), 'utf8') : '');
function correr(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, FAKE_DIR: dir, XDG_RUNTIME_DIR: join(dir, 'run'), HOME: dir, ...extra }),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const archivo = (contenido: string, modo = 0o600) => {
  const ruta = join(dir, 'run', 'mapa.json');
  writeFileSync(ruta, contenido, { mode: modo }); chmodSync(ruta, modo);
  return ruta;
};
const MAPA_OK = JSON.stringify({ 'casa-bermejo': { baseUrl: 'https://tienda.example.org', bearer: 'abcdefgh1234', firmaSecreto: 'ijklmnop5678' } });

describe('nube-novutienda.sh: salvaguardas (nada llega a gcloud)', () => {
  it('el script es ejecutable, con el prefijo y el secreto exactos, y sin comodines', () => {
    expect(FUENTE).toContain('readonly PREFIJO="NOVUTIENDA_"');
    expect(FUENTE).toContain('readonly SECRETO_MAPA="NOVUTIENDA_CONFIRMAR"');
    expect(FUENTE).not.toMatch(/startsWith\([^)]*\*/);
  });
  it('--aplicar sin --confirmo produccion: sale 2', () => {
    expect(correr(['--aplicar']).codigo).toBe(2);
    expect(correr(['--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
    expect(llamadas()).toBe('');
  });
  it('dos modos, o una opción desconocida: sale 2', () => {
    expect(correr(['--revertir-iam', '--cargar', archivo(MAPA_OK)]).codigo).toBe(2);
    expect(correr(['--inventada']).codigo).toBe(2);
    expect(llamadas()).toBe('');
  });
  it('xtrace activo: se rechaza (imprimiría el secreto)', () => {
    const r = spawnSync('bash', ['-x', SCRIPT], { encoding: 'utf8', env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, FAKE_DIR: dir }) });
    expect(r.status).toBe(2);
    expect(llamadas()).toBe('');
  });
  it('--cargar: archivo fuera de XDG_RUNTIME_DIR, con .., enlace, de modo 644 o con forma inválida: sale 2 sin tocar gcloud ni imprimir el contenido', () => {
    expect(correr(['--cargar', join(dir, 'fuera.json')]).codigo).toBe(2);
    expect(correr(['--cargar', `${join(dir, 'run')}/../x.json`]).codigo).toBe(2);
    expect(correr(['--cargar', archivo(MAPA_OK, 0o644)]).codigo).toBe(2);
    const malos = [
      '{no es json', '[]', '{}',
      JSON.stringify({ 'casa-bermejo': { baseUrl: 'http://x.example.org', bearer: 'abcdefgh1234', firmaSecreto: 'ijklmnop5678' } }),
      JSON.stringify({ 'casa-bermejo': { baseUrl: 'https://u:p@x.example.org', bearer: 'abcdefgh1234', firmaSecreto: 'ijklmnop5678' } }),
      JSON.stringify({ 'casa-bermejo': { baseUrl: 'https://x.example.org?a=1', bearer: 'abcdefgh1234', firmaSecreto: 'ijklmnop5678' } }),
      JSON.stringify({ 'casa-bermejo': { baseUrl: 'https://x.example.org', bearer: 'corto', firmaSecreto: 'ijklmnop5678' } }),
      JSON.stringify({ 'casa-bermejo': { baseUrl: 'https://x.example.org', bearer: 'abcdefgh1234', firmaSecreto: 'ijklmnop5678', extra: 'x' } }),
      JSON.stringify({ 'Mal Id': { baseUrl: 'https://x.example.org', bearer: 'abcdefgh1234', firmaSecreto: 'ijklmnop5678' } }),
    ];
    for (const m of malos) {
      const r = correr(['--cargar', archivo(m)]);
      expect(r.codigo, m).toBe(2);
      expect(r.salida).not.toContain('abcdefgh1234');
    }
    expect(llamadas()).toBe('');
  });
  it('--cargar con un mapa válido pasa las salvaguardas del archivo (se detiene después, sin credenciales de gcloud) y no imprime el contenido', () => {
    const r = correr(['--cargar', archivo(MAPA_OK)]);
    expect(r.salida).toContain('No encuentro el proyecto');
    expect(r.salida).not.toContain('abcdefgh1234');
    expect(r.salida).not.toContain('ijklmnop5678');
  });
});
