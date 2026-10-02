/**
 * `publicar-flujo.sh` NO RELLENA POR TIPO UNA CREDENCIAL CUYO NOMBRE NO SE RESOLVIÓ.
 *
 * Si el JSON nombra una credencial que en n8n no existe o está repetida, y el
 * nodo la recibiría por relleno desde otra del mismo TIPO, podría quedar con la
 * credencial de otro negocio. Con `--aplicar` se aborta antes de escribir y se
 * nombra el nodo; el seco solo avisa. En `--crear`, un nombre repetido es error.
 *
 * Corre el script real contra un curl falso (`curl-falso-n8n.sh`) en una copia
 * del repositorio: sin red, sin n8n y sin leer ninguna clave real.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '..', '..', '..');
const TIPO = 'httpHeaderAuth';

const cred = (id: string, name: string) => ({ id, name, type: TIPO });
const nodo = (name: string, credName: string, id = '') => ({
  name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {},
  credentials: { [TIPO]: { id, name: credName } },
});
const flujo = (nodes: unknown[]) => ({ name: 'Flujo de prueba', nodes, connections: {}, settings: {} });
/** El flujo vivo: un nodo con una credencial ya conectada (la de «otro negocio» para el relleno por TIPO). */
const VIVO = flujo([nodo('Existente', 'Ajena', 'ID-AJENA')]);
const UNICA = [cred('C1', 'Mia')];
const DOBLE = [cred('C1', 'Mia'), cred('C2', 'Mia')];

describe('publicar-flujo.sh y las credenciales sin resolver', () => {
  let dir: string; let raiz: string; let registro: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'publicar-cred-'));
    raiz = join(dir, 'repo');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos')); mkdirSync(join(dir, 'bin'));
    copyFileSync(join(REPO, 'scripts', 'publicar-flujo.sh'), join(raiz, 'scripts', 'publicar-flujo.sh'));
    if (existsSync(join(REPO, 'scripts', 'lib'))) cpSync(join(REPO, 'scripts', 'lib'), join(raiz, 'scripts', 'lib'), { recursive: true });
    copyFileSync(join(AQUI, 'curl-falso-n8n.sh'), join(dir, 'bin', 'curl'));
    chmodSync(join(dir, 'bin', 'curl'), 0o755);
    registro = join(dir, 'curl.log'); writeFileSync(registro, '');
    writeFileSync(join(raiz, '.env.prueba'), 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\nN8N_WORKFLOW_ID=7\n', { mode: 0o600 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function correr(nuevo: unknown, creds: unknown[], args: string[]) {
    writeFileSync(join(raiz, 'Flujos', 'prueba.json'), JSON.stringify(nuevo));
    const r = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/prueba.json', ...args], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, BASH_ENV: '', ENV: '',
        REGISTRO_CURL: registro,
        RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...VIVO }),
        RESPUESTA_CREDENCIALES: JSON.stringify({ data: creds }),
        HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '',
      }),
    });
    const llamadas = readFileSync(registro, 'utf8').split('\n').filter(Boolean)
      .map((l) => `${l.split(' ')[0]} ${l.match(/\/api\/v1(\S*)/)?.[1] ?? ''}`);
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}`, llamadas };
  }
  const escribio = (ll: string[]) => ll.some((l) => l.startsWith('PUT ') || (l.startsWith('POST ') && l.endsWith('/workflows')));

  it('control: nombre único resuelve y escribe', () => {
    const r = correr(flujo([nodo('Existente', 'Mia'), nodo('Nuevo', 'Mia')]), UNICA, ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.llamadas).toContain('PUT /workflows/7');
  });

  it('--aplicar: nombre repetido y relleno por TIPO aborta antes de escribir y nombra el nodo', () => {
    const r = correr(flujo([nodo('Existente', 'Mia'), nodo('Nodo nuevo', 'Mia')]), DOBLE, ['--aplicar']);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/ABORTADO antes de escribir[\s\S]*Nodo nuevo/);
    expect(escribio(r.llamadas), r.llamadas.join(' | ')).toBe(false);
  });

  it('--aplicar: nombre inexistente y relleno por TIPO aborta antes de escribir', () => {
    const r = correr(flujo([nodo('Existente', 'Ajena', 'x'), nodo('Nodo nuevo', 'No existe')]), [cred('C9', 'Ajena')], ['--aplicar']);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/Nodo nuevo/);
    expect(escribio(r.llamadas)).toBe(false);
  });

  it('el seco muestra el diagnóstico sin abortar y sin escribir', () => {
    const r = correr(flujo([nodo('Existente', 'Mia'), nodo('Nodo nuevo', 'Mia')]), DOBLE, []);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/con --aplicar se abortaria: Nodo nuevo/);
    expect(escribio(r.llamadas)).toBe(false);
  });

  it('un nodo que ya existe en el vivo con su credencial conserva el comportamiento de antes', () => {
    const r = correr(flujo([nodo('Existente', 'Mia')]), DOBLE, ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.llamadas).toContain('PUT /workflows/7');
  });

  it('--crear: un nombre repetido es error, no relleno por TIPO', () => {
    const r = correr(flujo([nodo('Nodo nuevo', 'Mia')]), DOBLE, ['--crear', '--aplicar']);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/Nodo nuevo: hay 2 credenciales llamadas «Mia»/);
    expect(escribio(r.llamadas)).toBe(false);
  });

  it('--crear: contraprueba, un nombre único crea', () => {
    const r = correr(flujo([nodo('Nodo nuevo', 'Mia')]), UNICA, ['--crear', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.llamadas).toContain('POST /workflows');
  });
});
