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
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  function correr(nuevo: unknown, creds: unknown[] | string, args: string[], extra: Record<string, string> = {}, vivo: unknown = VIVO) {
    writeFileSync(join(raiz, 'Flujos', 'prueba.json'), JSON.stringify(nuevo));
    const r = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/prueba.json', ...args], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, BASH_ENV: '', ENV: '',
        REGISTRO_CURL: registro,
        RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...(vivo as object) }),
        RESPUESTA_CREDENCIALES: typeof creds === 'string' ? creds : JSON.stringify({ data: creds }),
        ...extra,
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

  const respaldos = () => readdirSync(join(raiz, 'Flujos')).filter((f) => f.startsWith('respaldo-'));
  const dosNodos = () => flujo([nodo('Existente', 'Mia'), nodo('Nodo nuevo', 'Mia')]);

  describe('la lista de credenciales tiene que haber llegado (M-1)', () => {
    it('HTTP 403 con --aplicar: aborta sin escribir', () => {
      const r = correr(dosNodos(), '{"message":"forbidden"}', ['--aplicar'], { CODIGO_CREDENCIALES: '403' });
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/ABORTADO[\s\S]*HTTP 403/);
      expect(escribio(r.llamadas)).toBe(false);
    });
    it('HTTP 403 en seco: avisa sin abortar', () => {
      const r = correr(dosNodos(), '{"message":"forbidden"}', [], { CODIGO_CREDENCIALES: '403' });
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/con --aplicar se abortaria: n8n no entrego la lista/);
    });
    it('HTTP 200 con una respuesta que no es lista y relleno por TIPO: aborta', () => {
      const r = correr(dosNodos(), '{"message":"forbidden"}', ['--aplicar']);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/no es una lista/);
      expect(escribio(r.llamadas)).toBe(false);
    });
    it('contraprueba: sin ningún relleno por TIPO, una respuesta que no es lista sigue como antes', () => {
      const r = correr(flujo([nodo('Existente', 'Mia')]), '{"message":"x"}', ['--aplicar']);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.llamadas).toContain('PUT /workflows/7');
    });
    it('nextCursor (lista partida) con --aplicar: aborta con mensaje claro', () => {
      const r = correr(dosNodos(), JSON.stringify({ data: UNICA, nextCursor: 'abc' }), ['--aplicar']);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/mas de 250 credenciales/);
      expect(escribio(r.llamadas)).toBe(false);
    });
  });

  describe('--crear: un nombre declarado que no existe es faltante (M-2)', () => {
    it('«No existe» aborta sin POST aunque haya una credencial del tipo en la referencia', () => {
      const r = correr(flujo([nodo('Nodo nuevo', 'No existe')]), UNICA, ['--crear', '--aplicar']);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/Nodo nuevo: sin credencial/);
      expect(escribio(r.llamadas)).toBe(false);
    });
    it('contraprueba: una referencia SIN nombre sí se rellena por TIPO', () => {
      const r = correr(flujo([nodo('Nodo nuevo', '')]), UNICA, ['--crear', '--aplicar']);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.llamadas).toContain('POST /workflows');
    });
    it('--crear con lista partida (nextCursor) aborta sin POST', () => {
      const r = correr(flujo([nodo('Nodo nuevo', 'Mia')]), JSON.stringify({ data: UNICA, nextCursor: 'abc' }), ['--crear', '--aplicar']);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/mas de 250 credenciales/);
      expect(escribio(r.llamadas)).toBe(false);
    });
    it('--crear: la referencia con dos credenciales del mismo TIPO aborta sin elegir una', () => {
      const vivo = flujo([nodo('A', 'Ajena', 'ID-1'), nodo('B', 'Otra', 'ID-2')]);
      const r = correr(flujo([nodo('Nodo nuevo', '')]), UNICA, ['--crear', '--aplicar'], {}, vivo);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/Nodo nuevo: la referencia tiene 2 credenciales httpHeaderAuth/);
      expect(escribio(r.llamadas)).toBe(false);
    });
    it('--crear: contraprueba, dos nodos de la referencia con la MISMA credencial no son ambiguos', () => {
      const vivo = flujo([nodo('A', 'Ajena', 'ID-1'), nodo('B', 'Ajena', 'ID-1')]);
      const r = correr(flujo([nodo('Nodo nuevo', '')]), UNICA, ['--crear', '--aplicar'], {}, vivo);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.llamadas).toContain('POST /workflows');
    });
    it('--crear en seco: avisa si la lista de credenciales no llegó, sin escribir', () => {
      const r = correr(flujo([nodo('Nodo nuevo', 'Mia')]), '{"message":"forbidden"}', ['--crear'], { CODIGO_CREDENCIALES: '403' });
      expect(r.salida).toMatch(/con --aplicar se abortaria: n8n no entrego la lista de credenciales \(HTTP 403\)/);
      expect(escribio(r.llamadas)).toBe(false);
    });
    it('--crear en seco: contraprueba, con la lista completa no hay aviso', () => {
      const r = correr(flujo([nodo('Nodo nuevo', 'Mia')]), UNICA, ['--crear']);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).not.toMatch(/se abortaria/);
    });
    it('--crear con la lista caída (HTTP 500) aborta sin POST', () => {
      const r = correr(flujo([nodo('Nodo nuevo', '')]), '{}', ['--crear', '--aplicar'], { CODIGO_CREDENCIALES: '500' });
      expect(r.codigo, r.salida).toBe(1);
      expect(escribio(r.llamadas)).toBe(false);
    });
  });

  describe('nodo nuevo sin nombre de credencial (L-1)', () => {
    const vivoConDos = flujo([nodo('Existente', 'Ajena', 'ID-1'), nodo('Otro', 'Otra', 'ID-2')]);
    it('varias credenciales del tipo en el vivo: aborta con --aplicar y nombra el nodo', () => {
      const r = correr(flujo([nodo('Existente', 'Ajena'), nodo('Otro', 'Otra'), nodo('Nodo nuevo', '')]),
        [cred('1', 'Ajena'), cred('2', 'Otra')], ['--aplicar'], {}, vivoConDos);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/ABORTADO[\s\S]*Nodo nuevo/);
      expect(escribio(r.llamadas)).toBe(false);
    });
    it('una sola en el vivo: avisa en rojo y sigue', () => {
      const r = correr(flujo([nodo('Existente', 'Mia'), nodo('Nodo nuevo', '')]), UNICA, ['--aplicar']);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/Nodo nuevo: sin nombre de credencial/);
      expect(r.llamadas).toContain('PUT /workflows/7');
    });
  });

  describe('el respaldo (L-2)', () => {
    it('un aborto no deja respaldo de un PUT que nunca ocurrió', () => {
      const r = correr(dosNodos(), DOBLE, ['--aplicar']);
      expect(r.codigo, r.salida).toBe(1);
      expect(respaldos()).toEqual([]);
    });
    it('al escribir, el respaldo se crea con modo 600', () => {
      const r = correr(flujo([nodo('Existente', 'Mia')]), UNICA, ['--aplicar']);
      expect(r.codigo, r.salida).toBe(0);
      const [archivo] = respaldos();
      expect(archivo).toBeDefined();
      expect(statSync(join(raiz, 'Flujos', archivo)).mode & 0o777).toBe(0o600);
    });
    it('el respaldo de --reiniciar-estado también es 600', () => {
      const r = correr(flujo([]), UNICA, ['--reiniciar-estado', '--aplicar']);
      expect(r.codigo, r.salida).toBe(0);
      const [archivo] = respaldos();
      expect(archivo).toMatch(/^respaldo-estado-/);
      expect(statSync(join(raiz, 'Flujos', archivo)).mode & 0o777).toBe(0o600);
    });
  });
});
