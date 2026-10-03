/**
 * `publicar-flujo.sh` NO DICE «coincide con el origen» SI LA ESTRUCTURA DIFIERE.
 *
 * VERDE FALSO del 03/10/2026: «Platinum (Seguimientos)» tenía 11 nodos vivos y 12
 * en el JSON versionado (el nodo `¿Salió?`, sin publicar), y el diagnóstico en
 * seco imprimía «coincide con el origen: no hay nada que reponer». Solo contaban
 * los valores distintos de los nodos presentes en los dos lados. Aquí un nodo
 * nuevo, un nodo que falta, una conexión distinta y un `settings` distinto
 * cuentan; el caso idéntico (aun con `id` que solo trae el vivo, ajustes por
 * defecto de n8n y ramas vacías al final) sigue dando «coincide».
 *
 * Corre el script real contra el curl falso, sin red ni n8n.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '..', '..', '..');

const nodo = (name: string, extra: Record<string, unknown> = {}) => ({
  name, type: 'n8n-nodes-base.set', typeVersion: 3, position: [0, 0], parameters: { campo: 'x' }, ...extra,
});
const flujo = (nodes: unknown[], connections: unknown = {}, settings: unknown = { executionOrder: 'v1' }) =>
  ({ name: 'Flujo de prueba', nodes, connections, settings });
const enlace = (...destinos: string[]) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });
const BASE = () => flujo([nodo('A'), nodo('B')], { A: enlace('B') });

describe('publicar-flujo.sh: la estructura cuenta como diferencia', () => {
  let dir: string; let raiz: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'publicar-estructura-'));
    raiz = join(dir, 'repo');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos')); mkdirSync(join(dir, 'bin'));
    copyFileSync(join(REPO, 'scripts', 'publicar-flujo.sh'), join(raiz, 'scripts', 'publicar-flujo.sh'));
    if (existsSync(join(REPO, 'scripts', 'lib'))) cpSync(join(REPO, 'scripts', 'lib'), join(raiz, 'scripts', 'lib'), { recursive: true });
    copyFileSync(join(AQUI, 'curl-falso-n8n.sh'), join(dir, 'bin', 'curl'));
    chmodSync(join(dir, 'bin', 'curl'), 0o755);
    writeFileSync(join(dir, 'curl.log'), '');
    writeFileSync(join(raiz, '.env.prueba'), 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\nN8N_WORKFLOW_ID=7\n', { mode: 0o600 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function correr(origen: unknown, vivo: unknown, args: string[] = []) {
    writeFileSync(join(raiz, 'Flujos', 'prueba.json'), JSON.stringify(origen));
    const r = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/prueba.json', ...args], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, BASH_ENV: '', ENV: '',
        REGISTRO_CURL: join(dir, 'curl.log'),
        RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...(vivo as object) }),
        RESPUESTA_CREDENCIALES: JSON.stringify({ data: [] }),
        HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '',
      }),
    });
    // eslint-disable-next-line no-control-regex
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}`.replace(/\u001b\[[0-9;]*m/g, '') };
  }
  const coincide = (s: string) => s.includes('coincide con el origen');

  it('control: idéntico (con id y ajustes por defecto solo en el vivo, ramas vacías al final) coincide', () => {
    const vivo = flujo(
      [nodo('A', { id: 'abc' }), nodo('B', { id: 'def' })],
      { A: { main: [[{ node: 'B', type: 'main', index: 0 }], []] }, B: { main: [[]] } },
      { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
    );
    const r = correr(BASE(), vivo);
    expect(r.codigo, r.salida).toBe(0);
    expect(coincide(r.salida), r.salida).toBe(true);
    expect(r.salida).not.toContain('Diferencias de estructura');
  });

  it('nodo nuevo en el origen: no coincide y lo nombra (el caso de «¿Salió?»)', () => {
    const origen = flujo([nodo('A'), nodo('B'), nodo('¿Salió?')], { A: enlace('B') });
    const r = correr(origen, BASE());
    expect(coincide(r.salida), r.salida).toBe(false);
    expect(r.salida).toMatch(/Diferencias de estructura[^\n]*\(1\)/);
    expect(r.salida).toContain('~ ¿Salió? · nodo nuevo en el origen');
  });

  it('nodo que existe solo en el vivo: no coincide y lo nombra', () => {
    const vivo = flujo([nodo('A'), nodo('B'), nodo('Viejo')], { A: enlace('B') });
    const r = correr(BASE(), vivo);
    expect(coincide(r.salida), r.salida).toBe(false);
    expect(r.salida).toContain('~ Viejo · nodo solo en el flujo vivo');
  });

  it('conexión distinta: no coincide y nombra el nodo de origen de la conexión', () => {
    const origen = flujo([nodo('A'), nodo('B')], { B: enlace('A') });
    const r = correr(origen, BASE());
    expect(coincide(r.salida), r.salida).toBe(false);
    expect(r.salida).toContain('~ A · conexiones de salida distintas');
    expect(r.salida).toContain('~ B · conexiones de salida distintas');
  });

  it('settings distinto (executionOrder): no coincide y nombra la clave, no el valor', () => {
    const origen = flujo([nodo('A'), nodo('B')], { A: enlace('B') }, { executionOrder: 'v1' });
    const vivo = flujo([nodo('A'), nodo('B')], { A: enlace('B') }, { executionOrder: 'v0' });
    const r = correr(origen, vivo);
    expect(coincide(r.salida), r.salida).toBe(false);
    expect(r.salida).toContain('~ (settings del flujo) · claves distintas: executionOrder');
    expect(r.salida).not.toContain('v0');
  });

  it('con --aplicar también se informa la diferencia y no se dice «coincide»', () => {
    const origen = flujo([nodo('A'), nodo('B'), nodo('¿Salió?')], { A: enlace('B') });
    const r = correr(origen, BASE(), ['--aplicar']);
    expect(coincide(r.salida), r.salida).toBe(false);
    expect(r.salida).toContain('~ ¿Salió? · nodo nuevo en el origen');
  });
});
