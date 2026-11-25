/**
 * `scripts/catalogo-externo.sh`: el envoltorio que enciende `config/pedidos.catalogoExterno` sin que nadie pegue ni lea un id de
 * proyecto. Con un `node` FALSO (anota sus argumentos y su entorno, y escribe en la salida el id del proyecto para probar el filtro)
 * y credenciales de gcloud FALSAS en un HOME temporal. NO se toca la nube. Las pruebas niegan:
 * el seco no escribe; sin confirmación no se llama a nada; el id nunca aparece en la salida; el respaldo es obligatorio.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'catalogo-externo.sh');
const ID_PROD = 'proy-prod-aaa1';
const ID_STG = 'proy-stg-bbb2';

const NODE_FALSO = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/llamadas"
echo "PROD=$GCP_PROJECT_ID_PROD STG=$GCP_PROJECT_ID_STAGING CRED=$GOOGLE_APPLICATION_CREDENTIALS" >> "$FAKE_DIR/entornos"
echo "salida del script de nodo para $GCP_PROJECT_ID_PROD y $GCP_PROJECT_ID_STAGING"
exit "\${FAKE_SALIDA:-0}"
`;

let dir: string; let home: string; let base: string;
const leer = (n: string): string => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } };
const llamadas = (): string[] => leer('llamadas').split('\n').filter(Boolean);
const adc = (carpeta: string, id: string | null) => {
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, 'application_default_credentials.json'), JSON.stringify(id === null ? { type: 'authorized_user' } : { type: 'authorized_user', quota_project_id: id }));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cat-ext-'));
  home = join(dir, 'home'); base = join(dir, 'base');
  mkdirSync(join(dir, 'bin')); mkdirSync(base);
  writeFileSync(join(dir, 'bin', 'node'), NODE_FALSO); chmodSync(join(dir, 'bin', 'node'), 0o755);
  adc(join(home, '.config', 'gcloud-novuchat-prod'), ID_PROD);
  adc(join(home, '.config', 'gcloud'), ID_STG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, HOME: home, FAKE_DIR: dir, NOVUCHAT_RESPALDOS_BASE: base, ...extra }),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const BASE = ['--entorno', 'produccion', '--tenant', 'casa-bermejo', '--monedas', 'BOB,ARS'];

describe('catalogo-externo.sh', () => {
  it('seco (por omisión): llama al script sin --aplicar ni --respaldo y no crea carpetas', () => {
    const r = correr(BASE);
    expect(r.codigo).toBe(0);
    expect(llamadas()).toHaveLength(1);
    expect(llamadas()[0]).not.toContain('--aplicar');
    expect(llamadas()[0]).not.toContain('--respaldo');
    expect(llamadas()[0]).toContain('--monedas BOB,ARS');
    expect(existsSync(join(base, `novuchat-respaldos-${process.getuid?.()}`))).toBe(false);
  });
  it('el id de proyecto NUNCA aparece en la salida (el filtro lo reemplaza), pero el proceso de nodo lo recibe por entorno', () => {
    const r = correr(BASE);
    expect(r.salida).not.toContain(ID_PROD);
    expect(r.salida).not.toContain(ID_STG);
    expect(r.salida).toContain('<proyecto>');
    expect(leer('entornos')).toContain(`PROD=${ID_PROD} STG=${ID_STG}`);
  });
  it('el entorno elige el proyecto y las credenciales: staging usa el id y las credenciales de staging', () => {
    correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--monedas', 'BOB']);
    expect(llamadas()[0]).toContain(`--proyecto ${ID_STG}`);
    expect(leer('entornos')).toContain(join(home, '.config', 'gcloud', 'application_default_credentials.json'));
    expect(llamadas()[0]).not.toContain('--confirmo-produccion');
  });
  it('--aplicar sin --confirmo, o con uno distinto del entorno: sale 2 y NO llama al script de nodo', () => {
    expect(correr([...BASE, '--aplicar']).codigo).toBe(2);
    expect(correr([...BASE, '--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
    expect(correr([...BASE, '--aplicar', '--confirmo', 'casa-bermejo']).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
  it('--confirmo sin --aplicar se rechaza', () => {
    expect(correr([...BASE, '--confirmo', 'produccion']).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
  it('--aplicar con confirmación: crea la carpeta 700, pasa un respaldo 600-ready dentro de ella y --confirmo-produccion <tenant>', () => {
    const r = correr([...BASE, '--aplicar', '--confirmo', 'produccion']);
    expect(r.codigo).toBe(0);
    const carpeta = join(base, `novuchat-respaldos-${process.getuid?.()}`);
    expect(statSync(carpeta).mode & 0o777).toBe(0o700);
    const l = llamadas()[0] as string;
    expect(l).toContain('--aplicar');
    expect(l).toContain('--confirmo-produccion casa-bermejo');
    expect(l).toMatch(new RegExp(`--respaldo ${carpeta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/produccion_casa-bermejo_[0-9TZ_]+\\.json`));
    expect(r.salida).toContain('Respaldo para revertir:');
    expect(r.salida).not.toContain(ID_PROD);
  });
  it('si el script de nodo falla (1, 2 o 3), el envoltorio devuelve ese código y no anuncia respaldo', () => {
    const r = correr([...BASE, '--aplicar', '--confirmo', 'produccion'], { FAKE_SALIDA: '2' });
    expect(r.codigo).toBe(2);
    expect(r.salida).not.toContain('Respaldo para revertir');
  });
  it('credenciales iguales o ilegibles: no se llama a nada', () => {
    adc(join(home, '.config', 'gcloud'), ID_PROD);
    expect(correr(BASE).codigo).toBe(2);
    adc(join(home, '.config', 'gcloud'), null);
    expect(correr(BASE).codigo).toBe(3);
    expect(llamadas()).toEqual([]);
  });
  it('validaciones: entorno, tenant y monedas inválidos', () => {
    expect(correr(['--entorno', 'dev', '--tenant', 'casa-bermejo', '--monedas', 'BOB']).codigo).toBe(2);
    expect(correr(['--entorno', 'staging', '--tenant', 'Casa Bermejo', '--monedas', 'BOB']).codigo).toBe(2);
    expect(correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--monedas', 'USD']).codigo).toBe(2);
    expect(correr(['--entorno', 'staging', '--tenant', 'casa-bermejo']).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
  it('--revertir: solo con un respaldo .json de modo 600 dentro de la carpeta del envoltorio; no es un enlace', () => {
    const carpeta = join(base, `novuchat-respaldos-${process.getuid?.()}`);
    mkdirSync(carpeta, { mode: 0o700 });
    const ok = join(carpeta, 'produccion_casa-bermejo_x.json');
    writeFileSync(ok, '{}', { mode: 0o600 });
    const fuera = join(dir, 'otro.json'); writeFileSync(fuera, '{}', { mode: 0o600 });
    const enlace = join(carpeta, 'enlace.json'); symlinkSync(fuera, enlace);
    const laxo = join(carpeta, 'laxo.json'); writeFileSync(laxo, '{}'); chmodSync(laxo, 0o644);
    const rev = (r: string) => correr(['--entorno', 'produccion', '--tenant', 'casa-bermejo', '--revertir', r]);
    expect(rev(fuera).codigo).toBe(2);
    expect(rev(enlace).codigo).toBe(2);
    expect(rev(laxo).codigo).toBe(2);
    expect(rev(`${carpeta}/../otro.json`).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
    expect(rev(ok).codigo).toBe(0);
    expect(llamadas()[0]).toContain(`--revertir --respaldo ${ok}`);
    expect(llamadas()[0]).not.toContain('--aplicar');
  });
  it('--revertir no admite --monedas ni --desactivar', () => {
    const carpeta = join(base, `novuchat-respaldos-${process.getuid?.()}`);
    mkdirSync(carpeta, { mode: 0o700 });
    const ok = join(carpeta, 'a.json'); writeFileSync(ok, '{}', { mode: 0o600 });
    expect(correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--revertir', ok, '--monedas', 'BOB']).codigo).toBe(2);
    expect(correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--revertir', ok, '--desactivar']).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
  it('--desactivar y --crear-documento se pasan tal cual; --desactivar con --monedas se rechaza', () => {
    correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--desactivar']);
    correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--monedas', 'ARS', '--crear-documento']);
    expect(llamadas()[0]).toContain('--desactivar');
    expect(llamadas()[1]).toContain('--crear-documento');
    expect(correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--desactivar', '--monedas', 'BOB']).codigo).toBe(2);
  });
});
