/**
 * EL DEMO B COMO SEGUNDO NÚMERO DE ENSAYO: `flujo-de-prueba.mjs --sobre-demo-b` (Andres, 10/11/2026).
 *
 * Se corre la herramienta de verdad, como un proceso, contra un n8n de MENTIRA (GET, PUT, activate y la lista de credenciales)
 * cuyo flujo «vivo» es el Demo B o el Demo A versionados, con credenciales con id. Nada toca producción. El candidato es la
 * variante de ensayo de «Venta mínima», que nombra las credenciales del Demo A (es la forma de todas las variantes de ensayo
 * versionadas): sobre el Demo B esas etiquetas se traducen y lo que queda es SOLO del Demo B.
 *
 * Lo que se prueba, negando:
 *   - con `--sobre-demo-b` el Trigger es el del Demo B tal cual y ninguna credencial es del Demo A (ni por id ni por nombre);
 *   - `--sobre-demo-b` contra el Demo A vivo se niega sin ningún PUT, y `--sobre-demo-a` contra el Demo B vivo también;
 *   - `--sobre-demo-a` sigue dejando el Demo A como siempre (lo cubre entero `venta-minima-herramienta-demo-a.test.ts`);
 *   - la vuelta atrás es el respaldo exacto del Demo B, con su «Carrito del catálogo».
 *
 * LO QUE NO SE PUEDE PROBAR ACÁ (se mira en el seco real): que los nombres de la tabla existan hoy en la instancia, que el
 * Trigger vivo del Demo B tenga la credencial de su app y que Meta siga apuntando a su ruta después del PUT. `docs/ensayo/LEEME.md` §12.
 */
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const HERRAMIENTA = join(aqui, '../../Flujos/experimental/agenda-minima/herramientas/flujo-de-prueba.mjs');
const VENTA = join(aqui, '../../Flujos/experimental/venta-minima/venta-minima.ensayo-demo-a.json');
const DEMO_A = join(aqui, '../../Flujos/demo-a-agendamiento.json');
const DEMO_B = join(aqui, '../../Flujos/demo-b-venta-cobro.json');
const ejecutar = promisify(execFile);
const PHONE_ID = '100000000000043'; // el del Demo B, sintético
const QUIEN_PRUEBA = '59100000022';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const leerJson = (ruta: string): J => JSON.parse(readFileSync(ruta, 'utf8')) as J;
const NOMBRE_DEMO_B = leerJson(DEMO_B).name as string;

// La instancia tiene las credenciales de LOS DOS demos (es un solo n8n). Gemini es una sola, compartida.
const CREDENCIALES: { id: string; name: string; type: string }[] = [
  { id: 'c-gem', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi' },
  { id: 'c-cal', name: 'Google Calendar account', type: 'googleCalendarOAuth2Api' },
  { id: 'a-hdr', name: 'Cierres NovuChat A (auto)', type: 'httpHeaderAuth' },
  { id: 'a-wa', name: 'WhatsApp account', type: 'whatsAppApi' },
  { id: 'a-trg', name: 'WhatsApp OAuth account', type: 'whatsAppTriggerApi' },
  { id: 'b-hdr', name: 'Cierres NovuChat B (auto)', type: 'httpHeaderAuth' },
  { id: 'b-wa', name: 'WhatsApp account 2', type: 'whatsAppApi' },
  { id: 'b-trg', name: 'WhatsApp OAuth account 2', type: 'whatsAppTriggerApi' },
];
const IDS_SOLO_DE_A = ['a-hdr', 'a-wa', 'a-trg', 'c-cal'];
const NOMBRES_SOLO_DE_A = ['Cierres NovuChat A (auto)', 'WhatsApp account', 'WhatsApp OAuth account', 'Google Calendar account'];
const TIPO_POR_NODO: Record<string, string> = {
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': 'googlePalmApi',
  '@n8n/n8n-nodes-langchain.googleGemini': 'googlePalmApi',
  'n8n-nodes-base.googleCalendar': 'googleCalendarOAuth2Api',
  'n8n-nodes-base.googleCalendarTool': 'googleCalendarOAuth2Api',
  'n8n-nodes-base.whatsApp': 'whatsAppApi',
  'n8n-nodes-base.whatsAppTrigger': 'whatsAppTriggerApi',
};

/** Un demo «vivo»: su JSON versionado, con el Trigger con su credencial y su webhookId, y toda credencial con su id. */
function demoVivo(letra: 'a' | 'b', cambios: (w: J) => void = () => undefined): J {
  const w = leerJson(letra === 'a' ? DEMO_A : DEMO_B);
  w.id = 'wf1'; w.active = true; w.versionId = 'v1'; w.activeVersionId = 'v1';
  w.settings = { executionOrder: 'v1', timezone: 'America/La_Paz' };
  const delDemo = (t: string): { id: string; name: string } => {
    const c = CREDENCIALES.find((x) => x.type === t && (x.id.startsWith(`${letra}-`) || x.id.startsWith('c-')))!;
    return { id: c.id, name: c.name };
  };
  for (const n of w.nodes as J[]) {
    const tipo = TIPO_POR_NODO[n.type as string];
    if (tipo && !(n.credentials && n.credentials[tipo])) n.credentials = { ...(n.credentials ?? {}), [tipo]: {} };
    for (const t of Object.keys((n.credentials ?? {}) as J)) n.credentials[t] = delDemo(t);
    if (n.type === 'n8n-nodes-base.whatsAppTrigger') n.webhookId = `webhook-del-demo-${letra}`;
  }
  cambios(w);
  return w;
}

interface Mundo { flujo: J; puts: J[]; credenciales: typeof CREDENCIALES }
let mundo: Mundo;
let servidor: Server;
let carpeta = '';
const leerCuerpo = (r: IncomingMessage): Promise<string> => new Promise((ok) => { const trozos: Buffer[] = []; r.on('data', (c: Buffer) => { trozos.push(c); }); r.on('end', () => ok(Buffer.concat(trozos).toString('utf8'))); });

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'herramienta-sobre-b-'));
  servidor = createServer((req, res) => {
    void (async () => {
      const cuerpo = await leerCuerpo(req);
      const enviar = (cod: number, datos: unknown): void => { res.writeHead(cod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
      if (req.method === 'GET' && req.url === '/api/v1/workflows/wf1') return enviar(200, mundo.flujo);
      if (req.method === 'GET' && String(req.url).startsWith('/api/v1/credentials')) return enviar(200, { data: mundo.credenciales });
      if (req.method === 'PUT' && req.url === '/api/v1/workflows/wf1') {
        const b = JSON.parse(cuerpo) as J;
        mundo.puts.push(b);
        const version = 'v' + String(mundo.puts.length + 1);
        mundo.flujo = { ...mundo.flujo, name: b.name, nodes: b.nodes, connections: b.connections, settings: b.settings, versionId: version, activeVersionId: version };
        return enviar(200, mundo.flujo);
      }
      if (req.method === 'POST' && req.url === '/api/v1/workflows/wf1/activate') { mundo.flujo.active = true; mundo.flujo.activeVersionId = mundo.flujo.versionId; return enviar(200, mundo.flujo); }
      return enviar(404, { message: 'no existe' });
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  writeFileSync(join(carpeta, '.env.falso'), `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\nWA_PHONE_ID=${PHONE_ID}\n`);
  chmodSync(join(carpeta, '.env.falso'), 0o600);
  // El JSON de venta «preparado»: lo que deja `preparar-import.sh` con el entorno del Demo B (los dos marcadores ya reemplazados).
  writeFileSync(join(carpeta, 'venta.local.json'), readFileSync(VENTA, 'utf8').replaceAll('REEMPLAZAR_PHONE_NUMBER_ID', PHONE_ID).replaceAll('REEMPLAZAR_NUMERO_AVISO_ENSAYO', QUIEN_PRUEBA));
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(carpeta, { recursive: true, force: true }); });

let secuencia = 0;
const nuevo = (flujo: J, credenciales = CREDENCIALES): void => { mundo = { flujo, puts: [], credenciales }; };
const respaldoNuevo = (): string => join(carpeta, `respaldo-${++secuencia}.json`);

async function correr(args: string[]): Promise<{ codigo: number; salida: string }> {
  try {
    const r = await ejecutar(process.execPath, [HERRAMIENTA, '--env', join(carpeta, '.env.falso'), '--estado', join(carpeta, 'estado.json'), ...args], { env: entornoDelEmulador(undefined), encoding: 'utf8' });
    return { codigo: 0, salida: r.stdout + r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { codigo: x.code, salida: x.stdout + x.stderr };
  }
}
const sobre = (letra: 'a' | 'b', respaldo: string, extra: string[] = [], flujo = 'venta.local.json') =>
  correr([`--sobre-demo-${letra}`, '--respaldo', respaldo, '--flujo', join(carpeta, flujo), ...(extra.includes('--aplicar') ? ['--autorizo-gemini-produccion'] : []), ...extra]);
const nodo = (w: J, n: string): J => (w.nodes as J[]).find((x) => x.name === n)!;
const cuerpoPut = (w: J): J => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings ?? {} });
const credencialesDe = (w: J): J[] => (w.nodes as J[]).flatMap((n) => Object.values((n.credentials ?? {}) as J) as J[]);

describe('--sobre-demo-b', () => {
  it('en seco: dice «Demo B», lista el Trigger del Demo B tal cual, avisa del Webhook del carrito, guarda el respaldo (600) y NO escribe', async () => {
    nuevo(demoVivo('b'));
    const original = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const respaldo = respaldoNuevo();
    const r = await sobre('b', respaldo);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(0);
    expect(r.salida).toContain(`Demo B vivo: «${NOMBRE_DEMO_B}»`);
    expect(r.salida).toContain('WhatsApp Trigger: el del Demo B, tal cual («WhatsApp OAuth account 2»)');
    expect(r.salida).toContain('Trigger vivo: webhookId …mo-b');
    expect(r.salida).toMatch(/Webhook\(s\) del Demo B que dejan de responder mientras dura el ensayo .*Carrito del catálogo/);
    expect(r.salida).not.toMatch(/Demo A/);
    expect(statSync(respaldo).mode & 0o777).toBe(0o600);
    expect(cuerpoPut(leerJson(respaldo))).toEqual(cuerpoPut(original));
    expect(r.salida).not.toContain(PHONE_ID);
    expect(r.salida).not.toContain(QUIEN_PRUEBA);
  });

  it('con --aplicar: el Trigger es el del Demo B TAL CUAL y NINGUNA credencial es del Demo A, ni por id ni por nombre', async () => {
    nuevo(demoVivo('b'));
    const vivo = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const r = await sobre('b', respaldoNuevo(), ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(1);
    const b = mundo.puts[0]!;
    expect(b.name).toBe(NOMBRE_DEMO_B);
    expect(nodo(b, 'Plan del turno')).toBeTruthy();
    expect(nodo(b, 'WhatsApp Trigger')).toEqual(nodo(vivo, 'WhatsApp Trigger'));
    expect(nodo(b, 'WhatsApp Trigger').credentials).toEqual({ whatsAppTriggerApi: { id: 'b-trg', name: 'WhatsApp OAuth account 2' } });
    const delDemoB = new Set(credencialesDe(vivo).map((c) => c.id as string));
    const usadas = credencialesDe(b);
    expect(usadas.length).toBeGreaterThan(10);
    for (const c of usadas) {
      expect(c.id).toBeTruthy();
      expect(delDemoB.has(c.id as string), String(c.name)).toBe(true);
      expect(IDS_SOLO_DE_A).not.toContain(c.id);
      expect(NOMBRES_SOLO_DE_A).not.toContain(c.name);
    }
    // La ingesta y los cierres cuentan con la del Demo B (la etiqueta del Demo A del JSON se tradujo); los medios y los envíos, con la del Demo B.
    for (const n of ['Traer configuración', 'Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Registrar cierre', 'Cotejar en el servidor']) {
      expect(nodo(b, n).credentials.httpHeaderAuth, n).toEqual({ id: 'b-hdr', name: 'Cierres NovuChat B (auto)' });
    }
    for (const n of ['Obtener URL del medio', 'Descargar medio']) expect(nodo(b, n).credentials.whatsAppApi, n).toEqual({ id: 'b-wa', name: 'WhatsApp account 2' });
    for (const n of ['Enviar a WhatsApp', 'Enviar respaldo', 'Enviar aviso', 'Aviso de respaldo']) {
      expect(nodo(b, n).parameters.nodeCredentialType, n).toBe('whatsAppApi');
      expect(nodo(b, n).credentials, n).toEqual({ whatsAppApi: { id: 'b-wa', name: 'WhatsApp account 2' } });
    }
    expect(JSON.stringify(b)).not.toMatch(/\(Bearer\)|NovuChat A \(auto\)/);
    const base = Object.fromEntries((nodo(b, 'Config base').parameters.assignments.assignments as J[]).map((x) => [x.name, x.value]));
    expect(base['phoneNumberIdEsperado']).toBe(PHONE_ID);
  });

  it('la VUELTA ATRÁS es el respaldo exacto: el Demo B queda como estaba, con su «Carrito del catálogo» y todas sus credenciales', async () => {
    nuevo(demoVivo('b'));
    const original = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const respaldo = respaldoNuevo();
    expect((await sobre('b', respaldo, ['--aplicar'])).codigo).toBe(0);
    expect(nodo(mundo.flujo, 'Carrito del catálogo')).toBeUndefined();
    const r = await correr(['--restaurar-respaldo', '--respaldo', respaldo, '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(cuerpoPut(mundo.puts[1]!)).toEqual(cuerpoPut(original));
    expect(nodo(mundo.flujo, 'Carrito del catálogo')).toBeTruthy();
    expect(r.salida).toContain('leído de vuelta es igual al respaldo');
  });
});

describe('se NIEGA sin escribir (ningún PUT)', () => {
  it('`--sobre-demo-b` contra el Demo A vivo, o contra un nombre que solo parece el Demo B', async () => {
    for (const flujo of [demoVivo('a'), demoVivo('b', (w) => { w.name = 'NovuChat Bellido — Demo B'; }), demoVivo('b', (w) => { w.name = 'NovuChat Demo Bermejo — Venta'; }),
      demoVivo('b', (w) => { w.name = 'NovuChat Demo A y Demo B'; }), demoVivo('b', (w) => { w.name = 'NovuChat — Venta mínima (v0) — Q\'Taco'; })]) {
      nuevo(flujo);
      const r = await sobre('b', respaldoNuevo(), ['--aplicar']);
      expect(r.codigo, String(flujo.name)).toBe(1);
      expect(r.salida, String(flujo.name)).toMatch(/no es el del Demo B/);
      expect(mundo.puts, String(flujo.name)).toHaveLength(0);
    }
  });

  it('`--sobre-demo-a` contra el Demo B vivo (el .env equivocado): el Demo B no se pisa con credenciales del Demo A', async () => {
    nuevo(demoVivo('b'));
    const r = await sobre('a', respaldoNuevo(), ['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no es el del Demo A/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('los dos demos a la vez en la línea de comandos', async () => {
    nuevo(demoVivo('b'));
    const r = await correr(['--sobre-demo-a', '--sobre-demo-b', '--respaldo', respaldoNuevo(), '--flujo', join(carpeta, 'venta.local.json'), '--aplicar', '--autorizo-gemini-produccion']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no van juntos/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si el Trigger vivo del Demo B no trae SU credencial (la del Demo A, otra, o ninguna)', async () => {
    for (const cred of [{ whatsAppTriggerApi: { id: 'a-trg', name: 'WhatsApp OAuth account' } }, { whatsAppTriggerApi: { id: 'x', name: 'WhatsApp OAuth AAB1-WA-Prod' } }, undefined]) {
      nuevo(demoVivo('b', (w) => { const t = nodo(w, 'WhatsApp Trigger'); if (cred) t.credentials = cred; else delete t.credentials; }));
      const r = await sobre('b', respaldoNuevo(), ['--aplicar']);
      expect(r.codigo, JSON.stringify(cred)).toBe(1);
      expect(r.salida, JSON.stringify(cred)).toMatch(/Trigger vivo (trae una credencial que no es del Demo B|del Demo B tiene que traer «WhatsApp OAuth account 2»)/);
      expect(mundo.puts).toHaveLength(0);
    }
  });

  it('si el Demo B vivo usa una credencial del Demo A en algún nodo, esa no pasa por «ya la usa el vivo»', async () => {
    // Un Demo B mal armado, con sus medios en la credencial del Demo A: la tabla del Demo B pide «WhatsApp account 2» y el vivo no la usa.
    nuevo(demoVivo('b', (w) => { for (const n of w.nodes as J[]) if (n.credentials?.whatsAppApi) n.credentials.whatsAppApi = { id: 'a-wa', name: 'WhatsApp account' }; }));
    const r = await sobre('b', respaldoNuevo(), ['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/«WhatsApp account 2» no es una credencial que el Demo B vivo ya use/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('un candidato con agenda (Google Calendar) no entra al Demo B: no tiene esa credencial', async () => {
    const f = leerJson(join(carpeta, 'venta.local.json'));
    (f.nodes as J[]).push({ id: 'cal-1', name: 'Agendar', type: 'n8n-nodes-base.googleCalendar', typeVersion: 1, position: [0, 0], parameters: {} });
    writeFileSync(join(carpeta, 'con-agenda.local.json'), JSON.stringify(f));
    nuevo(demoVivo('b'));
    const r = await sobre('b', respaldoNuevo(), ['--aplicar'], 'con-agenda.local.json');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/googleCalendarOAuth2Api .* no está en la tabla de credenciales del Demo B/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('un candidato preparado con el phone id de OTRO número (el del Demo A de la tabla local) no entra al Demo B', async () => {
    writeFileSync(join(carpeta, 'con-fono-de-a.local.json'), readFileSync(join(carpeta, 'venta.local.json'), 'utf8').replaceAll(PHONE_ID, '100000000000042'));
    nuevo(demoVivo('b'));
    const r = await sobre('b', respaldoNuevo(), ['--aplicar'], 'con-fono-de-a.local.json');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/phoneNumberIdEsperado no es el phone id del Demo B/);
    expect(r.salida).not.toContain('100000000000042');
    expect(mundo.puts).toHaveLength(0);
  });

  it('`--sobre-demo-b --aplicar` también exige `--autorizo-gemini-produccion`', async () => {
    nuevo(demoVivo('b'));
    const r = await correr(['--sobre-demo-b', '--respaldo', respaldoNuevo(), '--flujo', join(carpeta, 'venta.local.json'), '--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/--sobre-demo-b --aplicar usa la credencial de Gemini de PRODUCCIÓN/);
    expect(mundo.puts).toHaveLength(0);
  });
});

describe('`--sobre-demo-a` no cambió', () => {
  it('sobre el Demo A vivo: Trigger y credenciales del Demo A, y ninguna del Demo B', async () => {
    nuevo(demoVivo('a'));
    const vivo = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const r = await sobre('a', respaldoNuevo(), ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).not.toMatch(/Demo B/);
    const b = mundo.puts[0]!;
    expect(nodo(b, 'WhatsApp Trigger')).toEqual(nodo(vivo, 'WhatsApp Trigger'));
    for (const c of credencialesDe(b)) expect(String(c.id)).not.toMatch(/^b-/);
    expect(nodo(b, 'Traer configuración').credentials.httpHeaderAuth).toEqual({ id: 'a-hdr', name: 'Cierres NovuChat A (auto)' });
  });

  it('si el Demo A vivo trae una credencial que es solo del Demo B, se niega', async () => {
    nuevo(demoVivo('a', (w) => { nodo(w, 'WhatsApp Trigger').credentials = { whatsAppTriggerApi: { id: 'b-trg', name: 'WhatsApp OAuth account 2' } }; }));
    const r = await sobre('a', respaldoNuevo(), ['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/Trigger vivo trae una credencial que no es del Demo A/);
    expect(mundo.puts).toHaveLength(0);
  });
});
