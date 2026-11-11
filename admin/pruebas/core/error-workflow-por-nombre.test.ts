/**
 * `settings.errorWorkflow` se resuelve POR NOMBRE al publicar (docs/produccion/error-workflow-envio-incierto.md).
 *
 * El JSON de un flujo con relé lleva el marcador REEMPLAZAR_ID_ERROR_WORKFLOW; `preparar-import.sh` y
 * `publicar-flujo.sh` buscan «NovuChat — Error de envío incierto» en el n8n destino y escriben su id. Si no existe
 * o hay más de uno, FALLAN: nunca dejan el marcador ni publican. Corre los scripts reales contra el curl falso,
 * sin red ni n8n, y nada se escribe en n8n.
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
const MARCADOR = 'REEMPLAZAR_ID_ERROR_WORKFLOW';
const NOMBRE = 'NovuChat — Error de envío incierto';
const ID_ALERTA = 'idAlerta42';

const nodo = (name: string) => ({ name, type: 'n8n-nodes-base.set', typeVersion: 3, position: [0, 0], parameters: { campo: 'x' } });
const flujo = (settings: unknown = { executionOrder: 'v1', errorWorkflow: MARCADOR }) =>
  ({ name: 'Flujo de prueba', nodes: [nodo('A'), nodo('B')], connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } }, settings });
const lista = (...nombres: string[]) => JSON.stringify({ data: nombres.map((name, i) => ({ id: i === 0 ? ID_ALERTA : `otro${i}`, name })) });

describe('errorWorkflow por nombre', () => {
  let dir: string; let raiz: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'errorwf-'));
    raiz = join(dir, 'repo');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos')); mkdirSync(join(dir, 'bin'));
    for (const s of ['publicar-flujo.sh', 'preparar-import.sh']) copyFileSync(join(REPO, 'scripts', s), join(raiz, 'scripts', s));
    cpSync(join(REPO, 'scripts', 'lib'), join(raiz, 'scripts', 'lib'), { recursive: true });
    copyFileSync(join(AQUI, 'curl-falso-n8n.sh'), join(dir, 'bin', 'curl'));
    chmodSync(join(dir, 'bin', 'curl'), 0o755);
    writeFileSync(join(dir, 'curl.log'), '');
    writeFileSync(join(raiz, '.env.prueba'), 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\nN8N_WORKFLOW_ID=7\n', { mode: 0o600 });
    writeFileSync(join(raiz, 'tabla.md'), '| Marcador | Valor |\n|---|---|\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function entorno(extra: Record<string, string>) {
    return entornoDelEmulador(undefined, {
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, BASH_ENV: '', ENV: '',
      REGISTRO_CURL: join(dir, 'curl.log'), CONFIG_LOCAL_MD: join(raiz, 'tabla.md'),
      RESPUESTA_CREDENCIALES: JSON.stringify({ data: [] }),
      HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '', ...extra,
    });
  }
  // eslint-disable-next-line no-control-regex
  const limpia = (t: string) => t.replace(/\u001b\[[0-9;]*m/g, '');
  const escrituras = () => readFileSync(join(dir, 'curl.log'), 'utf8').split('\n').filter((l) => /^(POST|PUT|DELETE|PATCH) /.test(l));

  function preparar(f: unknown, respuestaLista?: string, env = 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\n') {
    writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(f));
    writeFileSync(join(raiz, '.env.prueba'), env, { mode: 0o600 });
    const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/f.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8', env: entorno(respuestaLista === undefined ? {} : { RESPUESTA_LISTA_FLUJOS: respuestaLista }),
    });
    return { codigo: r.status, salida: limpia(`${r.stdout}${r.stderr}`), local: join(raiz, 'Flujos', 'f.local.json') };
  }
  function publicar(f: unknown, respuestaLista: string | undefined, args: string[] = []) {
    writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(f));
    const r = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/f.json', ...args], {
      cwd: raiz, encoding: 'utf8',
      env: entorno({ RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...flujo({ executionOrder: 'v1', errorWorkflow: ID_ALERTA }) }), ...(respuestaLista === undefined ? {} : { RESPUESTA_LISTA_FLUJOS: respuestaLista }) }),
    });
    return { codigo: r.status, salida: limpia(`${r.stdout}${r.stderr}`) };
  }

  describe('preparar-import.sh', () => {
    it('resuelve el marcador por nombre y escribe el id, sin imprimirlo', () => {
      const r = preparar(flujo(), lista(NOMBRE, 'Otro flujo'));
      expect(r.codigo, r.salida).toBe(0);
      expect(JSON.parse(readFileSync(r.local, 'utf8')).settings.errorWorkflow).toBe(ID_ALERTA);
      expect(r.salida).not.toContain(ID_ALERTA);
      expect(r.salida).not.toContain('clave-de-prueba');
      expect(escrituras()).toEqual([]);
    });

    it('NEGATIVA: nombre ausente en el n8n destino -> falla y no escribe la salida', () => {
      const r = preparar(flujo(), lista('Otro flujo'));
      expect(r.codigo, r.salida).not.toBe(0);
      expect(r.salida).toContain(NOMBRE);
      expect(existsSync(r.local)).toBe(false);
    });

    it('NEGATIVA: nombre duplicado -> falla y no elige uno', () => {
      const r = preparar(flujo(), lista(NOMBRE, NOMBRE));
      expect(r.codigo, r.salida).not.toBe(0);
      expect(r.salida).toMatch(/2 flujos llamados/);
      expect(existsSync(r.local)).toBe(false);
    });

    it('NEGATIVA: lista partida (nextCursor) o sin forma -> falla', () => {
      for (const cuerpo of [JSON.stringify({ data: [{ id: 'a', name: NOMBRE }], nextCursor: 'x' }), '{"x":1}']) {
        const r = preparar(flujo(), cuerpo);
        expect(r.codigo, r.salida).not.toBe(0);
        expect(existsSync(r.local)).toBe(false);
      }
    });

    it('NEGATIVA: sin N8N_API_KEY en el .env no deja el marcador: falla', () => {
      const r = preparar(flujo(), lista(NOMBRE), 'N8N_BASE_URL=https://n8n.invalid\n');
      expect(r.codigo, r.salida).not.toBe(0);
      expect(existsSync(r.local)).toBe(false);
    });

    it('NEGATIVA: el marcador fuera de settings.errorWorkflow falla', () => {
      const f = flujo(); (f.nodes[0] as { parameters: Record<string, unknown> }).parameters.campo = MARCADOR;
      const r = preparar(f, lista(NOMBRE));
      expect(r.codigo, r.salida).not.toBe(0);
      expect(existsSync(r.local)).toBe(false);
    });

    it('un flujo sin el marcador no consulta la lista (no cambia nada para los demás flujos)', () => {
      const r = preparar(flujo({ executionOrder: 'v1' }), undefined);
      expect(r.codigo, r.salida).toBe(0);
      expect(readFileSync(join(dir, 'curl.log'), 'utf8')).not.toContain('/workflows');
    });
  });

  describe('publicar-flujo.sh', () => {
    it('resuelve el marcador por nombre en seco: no queda ningún marcador ni se escribe nada', () => {
      const r = publicar(flujo(), lista(NOMBRE));
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).not.toContain('REEMPLAZAR_ID_ERROR_WORKFLOW');
      expect(r.salida).toContain('coincide con el origen');
      expect(escrituras()).toEqual([]);
    });

    it('NEGATIVA: nombre ausente -> falla, nunca publica', () => {
      const r = publicar(flujo(), lista('Otro flujo'), ['--aplicar']);
      expect(r.codigo, r.salida).not.toBe(0);
      expect(r.salida).toContain(NOMBRE);
      expect(escrituras()).toEqual([]);
    });

    it('NEGATIVA: nombre duplicado -> falla, nunca publica', () => {
      const r = publicar(flujo(), lista(NOMBRE, NOMBRE), ['--aplicar']);
      expect(r.codigo, r.salida).not.toBe(0);
      expect(escrituras()).toEqual([]);
    });

    it('NEGATIVA: marcador sin resolver (la lista no llega) -> falla, nunca publica', () => {
      const r = publicar(flujo(), '', ['--aplicar']);
      expect(r.codigo, r.salida).not.toBe(0);
      expect(escrituras()).toEqual([]);
    });

    it('el comparador tolera que errorWorkflow difiera en el valor, pero no que falte en uno de los dos', () => {
      // Origen con OTRO id (p. ej. staging vs producción): no cuenta como diferencia.
      writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(flujo({ executionOrder: 'v1', errorWorkflow: 'idDeOtroN8n' })));
      const ok = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/f.json'], {
        cwd: raiz, encoding: 'utf8', env: entorno({ RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...flujo({ executionOrder: 'v1', errorWorkflow: ID_ALERTA }) }) }),
      });
      expect(limpia(ok.stdout), limpia(ok.stdout + ok.stderr)).toContain('coincide con el origen');
      expect(limpia(ok.stdout)).not.toContain(ID_ALERTA);
      // El vivo no lo tiene: sí cuenta, y se nombra la clave sin valores.
      const sin = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/f.json'], {
        cwd: raiz, encoding: 'utf8', env: entorno({ RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...flujo({ executionOrder: 'v1' }) }) }),
      });
      const salida = limpia(sin.stdout);
      expect(salida).not.toContain('coincide con el origen');
      expect(salida).toContain('claves distintas: errorWorkflow');
      expect(salida).not.toContain('idDeOtroN8n');
    });
  });
});
