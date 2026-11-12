/**
 * `settings.errorWorkflow` se resuelve POR NOMBRE al publicar (docs/produccion/error-workflow-envio-incierto.md).
 *
 * El JSON de un flujo con relé lleva el marcador REEMPLAZAR_ID_ERROR_WORKFLOW; `preparar-import.sh` y
 * `publicar-flujo.sh` buscan «NovuChat — Error de envío incierto» en el n8n destino y escriben su id. Si no existe
 * o hay más de uno, FALLAN: nunca dejan el marcador ni publican. Corre los scripts reales contra el curl falso,
 * sin red ni n8n, y nada se escribe en n8n.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';
import { construir as construirEmma } from '../../../Flujos/experimental/rroca-emma/construir.mjs';
import { type Flujo, leerFlujo } from '../lib/flujo';
import { flujosDeProduccion } from '../lib/flujos-de-cliente';
import { atiendeCliente, llevaMarcadorDeErrorWorkflow } from './migracion/comprobaciones';
import { problemasDeRegla } from './migracion/excepciones';

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
    return {
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, BASH_ENV: '', ENV: '',
      REGISTRO_CURL: join(dir, 'curl.log'), CONFIG_LOCAL_MD: join(raiz, 'tabla.md'),
      RESPUESTA_CREDENCIALES: JSON.stringify({ data: [] }),
      HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '', ...extra,
    };
  }
  // eslint-disable-next-line no-control-regex
  const limpia = (t: string) => t.replace(/\u001b\[[0-9;]*m/g, '');
  const escrituras = () => readFileSync(join(dir, 'curl.log'), 'utf8').split('\n').filter((l) => /^(POST|PUT|DELETE|PATCH) /.test(l));

  function preparar(f: unknown, respuestaLista?: string, env = 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\n', codigoLista = '') {
    writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(f));
    writeFileSync(join(raiz, '.env.prueba'), env, { mode: 0o600 });
    const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/f.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8', env: entornoDelEmulador(undefined, entorno({ ...(respuestaLista === undefined ? {} : { RESPUESTA_LISTA_FLUJOS: respuestaLista }), ...(codigoLista ? { CODIGO_LISTA_FLUJOS: codigoLista } : {}) })),
    });
    return { codigo: r.status, salida: limpia(`${r.stdout}${r.stderr}`), local: join(raiz, 'Flujos', 'f.local.json') };
  }
  function publicar(f: unknown, respuestaLista: string | undefined, args: string[] = [], vivoEw: string = ID_ALERTA, codigoLista = '') {
    writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(f));
    const r = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/f.json', ...args], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, entorno({ RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...flujo({ executionOrder: 'v1', errorWorkflow: vivoEw }) }), ...(respuestaLista === undefined ? {} : { RESPUESTA_LISTA_FLUJOS: respuestaLista }), ...(codigoLista ? { CODIGO_LISTA_FLUJOS: codigoLista } : {}) })),
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

    it('escribe el .local.json con modo 600, aunque ya existiera con otro modo', () => {
      writeFileSync(join(raiz, 'Flujos', 'f.local.json'), '{}', { mode: 0o644 });
      const r = preparar(flujo(), lista(NOMBRE));
      expect(r.codigo, r.salida).toBe(0);
      expect(statSync(r.local).mode & 0o777).toBe(0o600);
    });

    it('ignora los flujos archivados: uno archivado con el mismo nombre no cuenta como duplicado, y solo archivado = ausente', () => {
      const conArchivado = JSON.stringify({ data: [{ id: ID_ALERTA, name: NOMBRE }, { id: 'viejo', name: NOMBRE, isArchived: true }, { id: 'viejo2', name: NOMBRE, archived: true }] });
      const ok = preparar(flujo(), conArchivado);
      expect(ok.codigo, ok.salida).toBe(0);
      expect(JSON.parse(readFileSync(ok.local, 'utf8')).settings.errorWorkflow).toBe(ID_ALERTA);
      const soloArchivado = preparar(flujo(), JSON.stringify({ data: [{ id: 'viejo', name: NOMBRE, isArchived: true }] }));
      expect(soloArchivado.codigo, soloArchivado.salida).not.toBe(0);
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
      expect(r.salida).toMatch(/2 flujos llamados/);
      expect(escrituras()).toEqual([]);
    });

    it('NEGATIVA: marcador sin resolver (la lista no llega) -> falla, nunca publica', () => {
      const r = publicar(flujo(), '', ['--aplicar']);
      expect(r.codigo, r.salida).not.toBe(0);
      expect(r.salida).toContain('no entregó la lista de flujos');
      expect(escrituras()).toEqual([]);
    });

    it('NEGATIVA: la lista responde HTTP distinto de 200 -> falla con su código, nunca publica (publicar y preparar)', () => {
      const r = publicar(flujo(), lista(NOMBRE), ['--aplicar'], ID_ALERTA, '503');
      expect(r.codigo, r.salida).not.toBe(0);
      expect(r.salida).toContain('HTTP 503');
      expect(escrituras()).toEqual([]);
      const p = preparar(flujo(), lista(NOMBRE), undefined, '500');
      expect(p.codigo, p.salida).not.toBe(0);
      expect(p.salida).toContain('HTTP 500');
      expect(existsSync(p.local)).toBe(false);
    });

    it('comparación ESTRICTA: marcador resuelto con un id y vivo con otro -> diferencia que nombra solo la clave', () => {
      const r = publicar(flujo(), lista(NOMBRE), [], 'idDeOtroVivo');
      expect(r.salida).not.toContain('coincide con el origen');
      expect(r.salida).toContain('claves distintas: errorWorkflow');
      expect(r.salida).not.toContain('idDeOtroVivo');
      expect(r.salida).not.toContain(ID_ALERTA);
    });

    it('el origen sin marcador (id concreto que sí es el del destino) y vivo con otro id: también diferencia; vivo sin la clave: diferencia', () => {
      const igual = publicar(flujo({ executionOrder: 'v1', errorWorkflow: ID_ALERTA }), lista(NOMBRE), [], ID_ALERTA);
      expect(igual.salida).toContain('coincide con el origen');
      const sin = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', 'Flujos/f.json'], {
        cwd: raiz, encoding: 'utf8', env: entornoDelEmulador(undefined, entorno({ RESPUESTA_LISTA_FLUJOS: lista(NOMBRE), RESPUESTA_FLUJO: JSON.stringify({ id: '7', ...flujo({ executionOrder: 'v1' }) }) })),
      });
      expect(limpia(sin.stdout)).toContain('claves distintas: errorWorkflow');
    });

    it('NEGATIVA: un id concreto que no es el del destino (p. ej. un .local.json de otro n8n) aborta sin escribir', () => {
      const r = publicar(flujo({ executionOrder: 'v1', errorWorkflow: 'idDeOtroN8n' }), lista(NOMBRE), ['--aplicar']);
      expect(r.codigo, r.salida).not.toBe(0);
      expect(r.salida).toContain('no es el id del flujo');
      expect(r.salida).not.toContain('idDeOtroN8n');
      expect(escrituras()).toEqual([]);
      const sinFlujo = publicar(flujo({ executionOrder: 'v1', errorWorkflow: ID_ALERTA }), lista('Otro flujo'), ['--aplicar']);
      expect(sinFlujo.codigo, sinFlujo.salida).not.toBe(0);
      expect(escrituras()).toEqual([]);
    });

    it('«Origen» muestra la ruta versionada y no la copia temporal', () => {
      const r = publicar(flujo(), lista(NOMBRE));
      expect(r.salida).toMatch(/Origen\s*: Flujos\/f\.json/);
    });
  });

  describe('--verificar de los armadores', () => {
    it('NEGATIVA: el JSON versionado de Emma con un id resuelto en vez del marcador exacto se rechaza', () => {
      const tope = join(dir, 'Flujos'); cpSync(join(REPO, 'Flujos'), tope, { recursive: true });
      const carpeta = join(tope, 'experimental', 'rroca-emma');
      const bien = construirEmma({ carpeta, verificar: true, tope });
      expect(bien.every((x: { versionado: string[] }) => x.versionado.length === 0)).toBe(true);
      const ruta = join(carpeta, 'rroca-emma.json');
      const j = JSON.parse(readFileSync(ruta, 'utf8')); j.settings.errorWorkflow = ID_ALERTA;
      writeFileSync(ruta, JSON.stringify(j, null, 2) + '\n');
      const mal = construirEmma({ carpeta, verificar: true, tope }).find((x: { archivo: string }) => x.archivo === 'rroca-emma.json');
      expect(mal.versionado.join(' ')).toContain('exactamente REEMPLAZAR_ID_ERROR_WORKFLOW');
    });
  });
});

// ---------------------------------------------------------------------------
// Migración (etapa 0, 12/11/2026): ESTÁTICO. El marcador en `settings.errorWorkflow` de cada flujo que atiende a un cliente.
// ---------------------------------------------------------------------------

describe('errorWorkflow por nombre, estático: todo flujo que atiende a un cliente lleva el marcador, o tiene excepción', () => {
  const flujoSin = (settings: Record<string, unknown> | undefined): Flujo => ({ name: 'x', nodes: [], connections: {}, ...(settings ? { settings } : {}) });

  it('cada flujo de producción que reporta el mensaje entrante lleva el marcador o una excepción; ninguna excepción sobra', () => {
    const atienden = flujosDeProduccion().filter((a) => atiendeCliente(leerFlujo(a)));
    expect(atienden.length).toBeGreaterThan(10);
    const hoy = new Map(atienden.map((a) => [a, llevaMarcadorDeErrorWorkflow(leerFlujo(a)) ? [] : ['settings.errorWorkflow']]));
    expect(problemasDeRegla('error-workflow-por-nombre', hoy)).toEqual([]);
  });

  it('contraprueba: solo el marcador exacto cuenta (ni un id resuelto, ni vacío, ni sin settings)', () => {
    expect(llevaMarcadorDeErrorWorkflow(flujoSin({ errorWorkflow: MARCADOR }))).toBe(true);
    expect(llevaMarcadorDeErrorWorkflow(flujoSin({ errorWorkflow: ID_ALERTA }))).toBe(false);
    expect(llevaMarcadorDeErrorWorkflow(flujoSin({ errorWorkflow: '' }))).toBe(false);
    expect(llevaMarcadorDeErrorWorkflow(flujoSin({ executionOrder: 'v1' }))).toBe(false);
    expect(llevaMarcadorDeErrorWorkflow(flujoSin(undefined))).toBe(false);
  });

  it('contraprueba: sin marcador y sin excepción falla; con excepción pasa; la excepción de un flujo que ya lo lleva sobra', () => {
    const exc = { 'a.json#error-workflow-por-nombre#settings.errorWorkflow': { dueno: 'x', vence: '2027-01-31', motivo: 'm', desde: '2026-11-12' } };
    expect(problemasDeRegla('error-workflow-por-nombre', new Map([['a.json', ['settings.errorWorkflow']]]), {})).toHaveLength(1);
    expect(problemasDeRegla('error-workflow-por-nombre', new Map([['a.json', ['settings.errorWorkflow']]]), exc)).toEqual([]);
    expect(problemasDeRegla('error-workflow-por-nombre', new Map([['a.json', []]]), exc)).toEqual([expect.stringContaining('SOBRA')]);
  });
});
