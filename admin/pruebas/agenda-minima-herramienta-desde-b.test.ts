/**
 * `flujo-de-prueba.mjs --sobre-bellido --desde-b`: publicar un cambio de ESTRUCTURA sobre un B que ya está vivo
 * (la rama de medios del core, 23/10/2026). Se corre la herramienta de verdad contra un n8n de MENTIRA. Lo que NUNCA
 * debe pasar: escribir sin `--aplicar`, escribir en un flujo que no es de Bellido o que todavía no es B, pisar un respaldo,
 * perder los valores propios de Bellido («Config base» y el disparador), o dar por publicado lo que no se leyó de vuelta.
 */
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(aqui, '../../Flujos/experimental/agenda-minima');
const HERRAMIENTA = join(CARPETA, 'herramientas/flujo-de-prueba.mjs');
const ejecutar = promisify(execFile);
const BELLIDO = 'NovuChat Bellido — Agendamiento (Pediatría)';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const candidato = (): J => JSON.parse(readFileSync(join(CARPETA, 'agenda-minima.v0.json'), 'utf8')) as J;

/** Lo que el candidato trae de nuevo respecto del B anterior (la rama de medios). */
const NUEVOS = ['Normalizar entrada', '¿Bajar medio?', 'Obtener URL del medio (general)', '¿Tamaño aceptable?', 'Medio no aceptado', 'Preparar transcripción',
  '¿Es un documento?', 'Describir documento', 'Describir imagen', 'Preparar imagen'];

/** El B anterior «vivo»: el candidato sin la rama de medios nueva, con ids de credencial y «Config base» llena. */
function vivoAnterior(nombre = BELLIDO, quitarB = false): J {
  const w = candidato();
  w.id = 'wf1'; w.name = nombre; w.active = true; w.versionId = 'v1'; w.activeVersionId = 'v1'; w.settings = { executionOrder: 'v1' };
  w.nodes = (w.nodes as J[]).filter((n) => !NUEVOS.includes(n.name) && (!quitarB || !['Candado', 'Plan del turno'].includes(n.name)));
  // Los dos nodos viejos de audio, que el candidato reemplaza.
  for (const viejo of ['Obtener URL del medio', '¿Audio de tamaño aceptable?']) w.nodes.push({ id: viejo, name: viejo, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} });
  w.connections = Object.fromEntries(Object.entries(w.connections as J).filter(([de]) => !NUEVOS.includes(de)));
  // Un id por TIPO de credencial (como en el vivo real): una sola de Gemini, una de Calendar, una de WhatsApp.
  for (const n of w.nodes as J[]) if (n.credentials) for (const [tipo, c] of Object.entries(n.credentials as J)) { if (tipo === 'googlePalmApi') (c as J).name = 'Gemini Bellido'; (c as J).id = 'cred-' + tipo + '-' + String((c as J).name || 'sin-nombre'); }
  const base = (w.nodes as J[]).find((n) => n.name === 'Config base')!;
  for (const a of base.parameters.assignments.assignments as J[]) if (/^REEMPLAZAR_/.test(String(a.value))) a.value = 'lleno-' + a.name;
  // el disparador vivo lleva su credencial propia
  const t = (w.nodes as J[]).find((n) => /whatsAppTrigger/i.test(n.type));
  if (t) t.credentials = { whatsAppTriggerApi: { id: 'trig-bellido', name: 'WhatsApp Trigger Bellido' } };
  return w;
}

interface Mundo { flujo: J; puts: J[]; putFalla: boolean; guardaMenos: boolean }
let mundo: Mundo;
let servidor: Server;
let carpeta = '';
const leerCuerpo = (r: IncomingMessage): Promise<string> => new Promise((ok) => { let t = ''; r.on('data', (c) => { t += String(c); }); r.on('end', () => ok(t)); });

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'herramienta-desde-b-'));
  servidor = createServer((req, res) => {
    void (async () => {
      const cuerpo = await leerCuerpo(req);
      const enviar = (cod: number, datos: unknown): void => { res.writeHead(cod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
      if (req.method === 'GET' && req.url === '/api/v1/workflows/wf1') return enviar(200, mundo.flujo);
      if (req.method === 'PUT' && req.url === '/api/v1/workflows/wf1') {
        if (mundo.putFalla) return enviar(500, { message: 'falló a propósito' });
        const b = JSON.parse(cuerpo) as J;
        mundo.puts.push(b);
        mundo.flujo = { ...mundo.flujo, name: b.name, nodes: mundo.guardaMenos ? (b.nodes as J[]).slice(1) : b.nodes, connections: b.connections, settings: b.settings, versionId: 'v2', activeVersionId: 'v2' };
        return enviar(200, mundo.flujo);
      }
      if (req.method === 'POST' && req.url === '/api/v1/workflows/wf1/activate') { mundo.flujo.active = true; return enviar(200, mundo.flujo); }
      return enviar(404, { message: 'no existe' });
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  writeFileSync(join(carpeta, '.env.falso'), `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\n`);
  chmodSync(join(carpeta, '.env.falso'), 0o600);
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(carpeta, { recursive: true, force: true }); });

const nuevo = (flujo: J, extra: Partial<Mundo> = {}): void => { mundo = { flujo, puts: [], putFalla: false, guardaMenos: false, ...extra }; };
let n = 0;
const respaldoNuevo = (): string => join(carpeta, `respaldo-${++n}.json`);
async function correr(args: string[], respaldo = respaldoNuevo()): Promise<{ codigo: number; salida: string; respaldo: string }> {
  try {
    const r = await ejecutar(process.execPath, [HERRAMIENTA, '--env', join(carpeta, '.env.falso'), '--estado', join(carpeta, 'estado.json'), '--sobre-bellido', '--respaldo', respaldo, ...args], { env: entornoDelEmulador() });
    return { codigo: 0, salida: r.stdout + r.stderr, respaldo };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { codigo: x.code, salida: x.stdout + x.stderr, respaldo };
  }
}
const nodo = (w: J, nombre: string): J => (w.nodes as J[]).find((x) => x.name === nombre)!;

describe('--desde-b en seco', () => {
  it('lista qué llega y qué se va, guarda el respaldo (600) y NO escribe en n8n', async () => {
    nuevo(vivoAnterior());
    const r = await correr(['--desde-b']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Nodos que se van: 2 · que llegan: 10/);
    expect(r.salida).toMatch(/En seco: no se escribió nada en n8n/);
    expect(mundo.puts).toHaveLength(0);
    expect(existsSync(r.respaldo) && (statSync(r.respaldo).mode & 0o777) === 0o600).toBe(true);
  });
});

describe('--desde-b con --aplicar', () => {
  it('reemplaza la estructura, conserva el disparador y «Config base» del vivo, y asigna Gemini por tipo', async () => {
    const vivo = vivoAnterior();
    nuevo(vivo);
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(1);
    const p = mundo.puts[0]!;
    expect(p.nodes).toHaveLength(53);
    for (const x of NUEVOS) expect(nodo(p, x), x).toBeDefined();
    // disparador y credencial del vivo, tal cual
    expect(JSON.stringify(nodo(p, 'WhatsApp Trigger').credentials)).toContain('trig-bellido');
    // «Config base» con los valores del vivo (los tres marcadores de respaldo)
    const asign = (nodo(p, 'Config base').parameters.assignments.assignments as J[]).map((a) => String(a.value));
    expect(asign.join('|')).not.toMatch(/REEMPLAZAR_/);
    // los dos nodos nuevos de Gemini tomaron la ÚNICA credencial de Gemini del vivo
    const idVivo = nodo(vivo, 'Transcribir audio').credentials.googlePalmApi.id;
    expect(nodo(p, 'Describir imagen').credentials.googlePalmApi.id).toBe(idVivo);
    expect(nodo(p, 'Describir documento').credentials.googlePalmApi.id).toBe(idVivo);
    // el respaldo es el vivo exacto de antes
    expect((JSON.parse(readFileSync(r.respaldo, 'utf8')) as J).nodes).toHaveLength(vivo.nodes.length);
  });
  it('NIEGA: si n8n guarda menos nodos de los que se mandaron, no se da por publicado', async () => {
    nuevo(vivoAnterior(), { guardaMenos: true });
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/no coincide con el candidato/);
    expect(r.salida).toMatch(/restaurar-respaldo/);
  });
  it('NIEGA: si el PUT falla, lo dice y manda a restaurar el respaldo', async () => {
    nuevo(vivoAnterior(), { putFalla: true });
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/PUT → 500/);
  });
});

describe('--desde-b: lo que se niega, sin ningún PUT', () => {
  it('sin --desde-b, un vivo que ya es B se niega y dice cuál es el camino', async () => {
    nuevo(vivoAnterior());
    const r = await correr(['--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/ya tiene el candidato B/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('--desde-b con un vivo que NO es B se niega', async () => {
    nuevo(vivoAnterior(BELLIDO, true));
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/YA es B/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('un flujo que no es de Bellido se niega', async () => {
    nuevo(vivoAnterior('Otro cliente — Agendamiento'));
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/no es el de Bellido/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('un respaldo existente que difiere del vivo no se pisa', async () => {
    nuevo(vivoAnterior());
    const ruta = respaldoNuevo();
    writeFileSync(ruta, JSON.stringify({ ...vivoAnterior(), nodes: [] }));
    const r = await correr(['--desde-b', '--aplicar'], ruta);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/difiere del vivo/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('--desde-b sin --sobre-bellido, o junto a --actualizar-codigo, se niega', async () => {
    nuevo(vivoAnterior());
    for (const args of [['--env', join(carpeta, '.env.falso'), '--desde-b'], ['--env', join(carpeta, '.env.falso'), '--actualizar-codigo', '--desde-b']]) {
      let codigo = 0;
      try { await ejecutar(process.execPath, [HERRAMIENTA, ...args], { env: entornoDelEmulador() }); } catch (e) { codigo = (e as { code: number }).code; }
      expect(codigo).not.toBe(0);
    }
    expect(mundo.puts).toHaveLength(0);
  });
});
