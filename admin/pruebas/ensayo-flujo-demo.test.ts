/**
 * `scripts/ensayo-flujo.sh --demo a|b` — EL DEMO DE DESTINO DEL ENSAYO (Andres, 10/11/2026).
 *
 * Se corre el script DE VERDAD (una copia byte a byte, en un árbol temporal) contra un n8n de MENTIRA con dos flujos vivos, el
 * Demo A y el Demo B versionados con sus credenciales. `preparar-import.sh` y `publicar-flujo.sh` son dos dobles que solo anotan
 * con qué los llamaron y guardan el flujo que recibirían: nada toca n8n, Meta ni la tabla local.
 *
 * Lo que se prueba, negando:
 *   - sin `--demo` todo queda como hoy: entorno `.env`, nombre y credenciales del Demo A, marcador del phone id del Demo A;
 *   - con `--demo b`: entorno `.env.demo-b`, nombre y credenciales del Demo B, y NUNCA una credencial ni el entorno del Demo A
 *     (y al revés);
 *   - `--restaurar --demo b` republica `demo-b-venta-cobro.json`, nunca el JSON del Demo A (y al revés).
 *
 * LO QUE NO SE PUEDE PROBAR ACÁ: que los nombres de credencial existan hoy en la instancia y lo que `publicar-flujo.sh` hace con
 * el flujo (su propio cerrojo de nombre). Eso se mira en el seco real (`docs/ensayo/LEEME.md` §12).
 */
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const REPO = join(aqui, '..', '..');
const ejecutar = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const leerJson = (ruta: string): J => JSON.parse(readFileSync(ruta, 'utf8')) as J;

const JSON_A = 'demo-a-agendamiento.json';
const JSON_B = 'demo-b-venta-cobro.json';
const NOMBRE_A = leerJson(join(REPO, 'Flujos', JSON_A)).name as string;
const NOMBRE_B = leerJson(join(REPO, 'Flujos', JSON_B)).name as string;
// Las credenciales de cada demo, por tipo. Gemini es la misma en los dos (una sola en la instancia).
const CRED_A: Record<string, string> = {
  googlePalmApi: 'Google Gemini(PaLM) Api account', googleCalendarOAuth2Api: 'Google Calendar account',
  httpHeaderAuth: 'Cierres NovuChat A (auto)', whatsAppApi: 'WhatsApp account', whatsAppTriggerApi: 'WhatsApp OAuth account',
};
const CRED_B: Record<string, string> = {
  googlePalmApi: 'Google Gemini(PaLM) Api account',
  httpHeaderAuth: 'Cierres NovuChat B (auto)', whatsAppApi: 'WhatsApp account 2', whatsAppTriggerApi: 'WhatsApp OAuth account 2',
};
const SOLO_DE_A = ['Cierres NovuChat A (auto)', 'WhatsApp account', 'WhatsApp OAuth account', 'Google Calendar account'];
const SOLO_DE_B = ['Cierres NovuChat B (auto)', 'WhatsApp account 2', 'WhatsApp OAuth account 2'];

/** El demo «vivo»: el JSON versionado, con cada credencial con su id y su nombre, y el disparador con la suya. */
function vivo(archivo: string, cred: Record<string, string>, letra: string): J {
  const w = leerJson(join(REPO, 'Flujos', archivo));
  w.active = true;
  for (const n of w.nodes as J[]) {
    if (n.type === 'n8n-nodes-base.whatsAppTrigger') n.credentials = { whatsAppTriggerApi: {} };
    for (const t of Object.keys((n.credentials ?? {}) as J)) n.credentials[t] = { id: `id-${letra}-${t}`, name: cred[t] };
  }
  return w;
}
/** El flujo de un CLIENTE derivado de un demo: su nombre, SUS credenciales y el marcador de SU phone id. */
function cliente(archivo: string, marcaDelDemo: string): J {
  const w = JSON.parse(readFileSync(join(REPO, 'Flujos', archivo), 'utf8').replaceAll(`"${marcaDelDemo}"`, '"REEMPLAZAR_PHONE_NUMBER_ID_CLIENTEX"')) as J;
  w.name = 'NovuChat ClienteX — flujo del cliente';
  for (const n of w.nodes as J[]) for (const t of Object.keys((n.credentials ?? {}) as J)) n.credentials[t] = { id: 'id-del-cliente', name: `ClienteX (${t})` };
  return w;
}

let servidor: Server;
let raiz = '';
let trabajo = '';
let registro = '';
let captura = '';
let flujos: Record<string, J> = {};
let puerto = 0;

const escribirEnv = (nombre: string, id: string): void => writeFileSync(join(trabajo, nombre),
  `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=${id}\n`);

beforeAll(async () => {
  raiz = mkdtempSync(join(tmpdir(), 'ensayoflujo-'));
  trabajo = join(raiz, 'trabajo');
  registro = join(raiz, 'registro.txt');
  captura = join(raiz, 'captura.json');
  for (const d of ['scripts', 'Flujos', 'trabajo']) mkdirSync(join(raiz, d));
  copyFileSync(join(REPO, 'scripts', 'ensayo-flujo.sh'), join(raiz, 'scripts', 'ensayo-flujo.sh'));
  for (const f of [JSON_A, JSON_B]) copyFileSync(join(REPO, 'Flujos', f), join(raiz, 'Flujos', f));
  // Los dos dobles: anotan cómo los llamaron; el de publicar guarda el flujo que publicaría.
  writeFileSync(join(raiz, 'scripts', 'preparar-import.sh'), '#!/usr/bin/env bash\nset -euo pipefail\necho "preparar $1 $2" >> "$REGISTRO"\ncp "$1" "${1%.json}.local.json"\n');
  writeFileSync(join(raiz, 'scripts', 'publicar-flujo.sh'), '#!/usr/bin/env bash\nset -euo pipefail\necho "publicar $*" >> "$REGISTRO"\nwhile [ $# -gt 0 ]; do if [ "$1" = "--flujo" ]; then cp "$2" "$CAPTURA"; fi; shift; done\n');
  for (const s of ['ensayo-flujo.sh', 'preparar-import.sh', 'publicar-flujo.sh']) chmodSync(join(raiz, 'scripts', s), 0o755);
  servidor = createServer((req, res) => {
    const m = /^\/api\/v1\/workflows\/([a-zA-Z]+)$/.exec(String(req.url));
    const w = req.method === 'GET' && m ? flujos[m[1]!] : undefined;
    res.writeHead(w ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(w ?? { message: 'no existe' }));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  puerto = (servidor.address() as { port: number }).port;
  writeFileSync(join(raiz, 'cliente-de-a.json'), JSON.stringify(cliente(JSON_A, 'REEMPLAZAR_PHONE_NUMBER_ID')));
  writeFileSync(join(raiz, 'cliente-de-b.json'), JSON.stringify(cliente(JSON_B, 'REEMPLAZAR_PHONE_NUMBER_ID_B')));
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(raiz, { recursive: true, force: true }); });
beforeEach(() => {
  flujos = { wfA: vivo(JSON_A, CRED_A, 'a'), wfB: vivo(JSON_B, CRED_B, 'b') };
  escribirEnv('.env', 'wfA');
  escribirEnv('.env.demo-b', 'wfB');
  rmSync(registro, { force: true });
  rmSync(captura, { force: true });
});

async function correr(args: string[]): Promise<{ codigo: number; salida: string; llamadas: string[] }> {
  let codigo = 0; let salida = '';
  try {
    const r = await ejecutar('bash', [join(raiz, 'scripts', 'ensayo-flujo.sh'), ...args],
      { cwd: trabajo, encoding: 'utf8', env: { ...process.env, REGISTRO: registro, CAPTURA: captura, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' } });
    salida = r.stdout + r.stderr;
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    codigo = x.code; salida = x.stdout + x.stderr;
  }
  return { codigo, salida, llamadas: existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n') : [] };
}
const nombresDeCredencial = (w: J): string[] => (w.nodes as J[]).flatMap((n) => Object.values((n.credentials ?? {}) as J).map((c) => String((c as J).name)));
const ensayar = (demo: string[], flujo: string, extra: string[] = []) => correr([...demo, '--cliente', 'CLIENTEX', '--flujo', join(raiz, flujo), ...extra]);

describe('sin --demo (o con --demo a) todo queda como hoy: el Demo A', () => {
  for (const demo of [[], ['--demo', 'a']]) {
    it(`${demo.join(' ') || 'sin la opción'}: entorno .env, nombre y credenciales del Demo A, y nada del Demo B`, async () => {
      const r = await ensayar(demo, 'cliente-de-a.json');
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/con el nombre del Demo A\./);
      expect(r.salida).toMatch(/Credenciales: las del Demo A vivo en \d+ nodos/);
      expect(r.llamadas).toEqual([`preparar ${join(raiz, 'Flujos', 'ensayo-clientex.json')} .env`,
        `publicar --env .env --flujo ${join(raiz, 'Flujos', 'ensayo-clientex.local.json')}`]);
      const w = leerJson(captura);
      expect(w.name).toBe(NOMBRE_A);
      const creds = nombresDeCredencial(w);
      expect(creds.length).toBeGreaterThan(10);
      for (const c of creds) { expect(Object.values(CRED_A)).toContain(c); expect(SOLO_DE_B).not.toContain(c); }
      const texto = JSON.stringify(w);
      expect(texto).toContain('"REEMPLAZAR_PHONE_NUMBER_ID"');
      expect(texto).not.toMatch(/REEMPLAZAR_PHONE_NUMBER_ID_(B|CLIENTEX)/);
      expect(texto).not.toContain('ClienteX (');
    });
  }
});

describe('con --demo b: el Demo B, y NUNCA nada del Demo A', () => {
  it('entorno .env.demo-b, nombre y credenciales del Demo B vivo, marcador del phone id del Demo B', async () => {
    const r = await ensayar(['--demo', 'b'], 'cliente-de-b.json', ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/con el nombre del Demo B\./);
    expect(r.llamadas).toEqual([`preparar ${join(raiz, 'Flujos', 'ensayo-clientex.json')} .env.demo-b`,
      `publicar --env .env.demo-b --flujo ${join(raiz, 'Flujos', 'ensayo-clientex.local.json')} --aplicar`]);
    const w = leerJson(captura);
    expect(w.name).toBe(NOMBRE_B);
    const creds = nombresDeCredencial(w);
    expect(creds.length).toBeGreaterThan(10);
    for (const c of creds) { expect(Object.values(CRED_B)).toContain(c); expect(SOLO_DE_A).not.toContain(c); }
    // Cada nodo lleva la credencial del Demo B vivo con su id: ninguna del cliente.
    for (const n of w.nodes as J[]) for (const c of Object.values((n.credentials ?? {}) as J)) expect(String((c as J).id)).toMatch(/^id-b-/);
    const texto = JSON.stringify(w);
    expect(texto).toContain('"REEMPLAZAR_PHONE_NUMBER_ID_B"');
    expect(texto).not.toContain('"REEMPLAZAR_PHONE_NUMBER_ID"');
    expect(texto).not.toContain('REEMPLAZAR_PHONE_NUMBER_ID_CLIENTEX');
    // El JSON intermedio (con marcadores) se borra.
    expect(existsSync(join(raiz, 'Flujos', 'ensayo-clientex.json'))).toBe(false);
  });

  it('se NIEGA con el entorno del otro demo, antes de leer nada (y al revés)', async () => {
    for (const args of [['--demo', 'b', '--env', '.env'], ['--demo', 'b', '--env', join(trabajo, '.env')],
      ['--demo', 'a', '--env', '.env.demo-b'], ['--env', '.env.demo-b']]) {
      for (const modo of [['--cliente', 'CLIENTEX', '--flujo', join(raiz, 'cliente-de-b.json'), '--aplicar'], ['--restaurar', '--aplicar']]) {
        const r = await correr([...args, ...modo]);
        expect(r.codigo, `${args.join(' ')}: ${r.salida}`).toBe(2);
        expect(r.salida).toMatch(/es el entorno del otro demo/);
        expect(r.llamadas).toEqual([]);
      }
    }
  });

  it('se NIEGA si el flujo vivo del entorno no es el de ESE demo (un .env.demo-b que apunta al Demo A, y al revés)', async () => {
    escribirEnv('.env.demo-b', 'wfA');
    const b = await ensayar(['--demo', 'b'], 'cliente-de-b.json', ['--aplicar']);
    expect(b.codigo, b.salida).toBe(1);
    expect(b.salida).toMatch(/no es el Demo B/);
    escribirEnv('.env', 'wfB');
    const a = await ensayar([], 'cliente-de-a.json', ['--aplicar']);
    expect(a.codigo, a.salida).toBe(1);
    expect(a.salida).toMatch(/no es el Demo A/);
    expect([...b.llamadas, ...a.llamadas]).toEqual([]);
    expect(existsSync(captura)).toBe(false);
  });

  it('se NIEGA si el flujo vivo trae una credencial que es solo del otro demo (y al revés)', async () => {
    const conAjena = (id: string, tipo: string, nombre: string): void => {
      const n = (flujos[id]!.nodes as J[]).find((x) => x.credentials?.[tipo])!;
      n.credentials[tipo] = { id: 'id-ajena', name: nombre };
    };
    conAjena('wfB', 'whatsAppApi', 'WhatsApp account');
    const b = await ensayar(['--demo', 'b'], 'cliente-de-b.json', ['--aplicar']);
    expect(b.codigo, b.salida).toBe(1);
    expect(b.salida).toMatch(/credenciales que no son del Demo B: WhatsApp account\b/);
    conAjena('wfA', 'httpHeaderAuth', 'Cierres NovuChat B (auto)');
    const a = await ensayar([], 'cliente-de-a.json', ['--aplicar']);
    expect(a.codigo, a.salida).toBe(1);
    expect(a.salida).toMatch(/credenciales que no son del Demo A: Cierres NovuChat B \(auto\)/);
    expect([...b.llamadas, ...a.llamadas]).toEqual([]);
  });

  it('un cliente de AGENDA no se ensaya en el Demo B: sus nodos de calendario no tienen credencial ahí', async () => {
    const r = await ensayar(['--demo', 'b'], 'cliente-de-a.json', ['--aplicar']);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/usan credenciales que el Demo B no tiene en ese nodo/);
    expect(r.llamadas).toEqual([]);
  });

  it('un valor de --demo que no es a ni b sale con 2', async () => {
    const r = await ensayar(['--demo', 'c'], 'cliente-de-b.json');
    expect(r.codigo).toBe(2);
    expect(r.llamadas).toEqual([]);
  });
});

describe('--restaurar republica el JSON del demo de destino, nunca el del otro', () => {
  it('--demo b: demo-b-venta-cobro.json con .env.demo-b', async () => {
    const r = await correr(['--restaurar', '--demo', 'b', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Restaurar el Demo B desde el JSON versionado \(Flujos\/demo-b-venta-cobro\.json\)/);
    expect(r.llamadas).toEqual([`preparar ${join(raiz, 'Flujos', JSON_B)} .env.demo-b`,
      `publicar --env .env.demo-b --flujo ${join(raiz, 'Flujos', 'demo-b-venta-cobro.local.json')} --aplicar`]);
    expect(r.llamadas.join('\n')).not.toMatch(/demo-a-agendamiento|--env \.env( |$)/m);
    expect(leerJson(captura).name).toBe(NOMBRE_B);
  });

  it('sin --demo: demo-a-agendamiento.json con .env, como siempre', async () => {
    const r = await correr(['--restaurar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Restaurar el Demo A desde el JSON versionado \(Flujos\/demo-a-agendamiento\.json\)/);
    expect(r.llamadas).toEqual([`preparar ${join(raiz, 'Flujos', JSON_A)} .env`,
      `publicar --env .env --flujo ${join(raiz, 'Flujos', 'demo-a-agendamiento.local.json')}`]);
    expect(r.llamadas.join('\n')).not.toMatch(/demo-b-venta-cobro|\.env\.demo-b/);
    expect(leerJson(captura).name).toBe(NOMBRE_A);
  });
});
