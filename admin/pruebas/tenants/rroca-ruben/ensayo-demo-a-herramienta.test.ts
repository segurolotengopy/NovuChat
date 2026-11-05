/**
 * EL ENSAYO DE RUBÉN EN EL DEMO A, por `flujo-de-prueba.mjs --sobre-demo-a` (SIN modificar la herramienta).
 *
 * Se corre la herramienta de verdad, como un proceso, contra un n8n de MENTIRA (un servidor HTTP local) cuyo flujo «vivo» es el Demo A versionado con credenciales con id. Nada toca producción.
 * Mismos cerrojos que el ensayo de Venta mínima (`venta-minima-herramienta-demo-a.test.ts`): se prueba que la herramienta ACEPTA el JSON de ensayo de Rubén y que se NIEGA, sin ningún PUT, cuando
 * ese JSON trae una credencial de producción, la del miniCRM, un nodo de Graph con la credencial de la ingesta, un marcador sin reponer o un segundo disparador.
 *
 * LO QUE NO SE PUEDE PROBAR ACÁ (se mira en el seco real, con n8n): que los nombres y tipos de credencial de la tabla de la herramienta existan hoy en la instancia, que el Trigger vivo tenga la credencial
 * de la app del Demo A y que Meta siga apuntando a la ruta del Demo A después del PUT. Ver `docs/ensayo/LEEME.md` §9.
 */
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const HERRAMIENTA = join(aqui, '../../../../Flujos/experimental/agenda-minima/herramientas/flujo-de-prueba.mjs');
const RUBEN = join(aqui, '../../../../Flujos/experimental/rroca-ruben/rroca-ruben.ensayo-demo-a.json');
const DEMO_A = join(aqui, '../../../../Flujos/demo-a-agendamiento.json');
const ejecutar = promisify(execFile);
const PHONE_ID = '100000000000042'; // el del Demo A, sintético
const TELEFONO = '59100000021'; // el teléfono de quien prueba, sintético
const NOMBRE_DEMO_A = 'NovuChat Demo A — Agendamiento (Belleza y Salud)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const leerJson = (ruta: string): J => JSON.parse(readFileSync(ruta, 'utf8')) as J;

const CREDENCIALES: { id: string; name: string; type: string }[] = [
  { id: 'c-gem', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi' },
  { id: 'c-gem-pruebas', name: 'Gemini — pruebas (no producción)', type: 'googlePalmApi' },
  { id: 'c-cal', name: 'Google Calendar account', type: 'googleCalendarOAuth2Api' },
  { id: 'c-hdr', name: 'Cierres NovuChat A (auto)', type: 'httpHeaderAuth' },
  { id: 'c-wa', name: 'WhatsApp account', type: 'whatsAppApi' },
  { id: 'c-trg', name: 'WhatsApp OAuth account', type: 'whatsAppTriggerApi' },
];
const porTipo = (tipo: string): { id: string; name: string } => {
  const c = CREDENCIALES.find((x) => x.type === tipo && x.id !== 'c-gem-pruebas')!;
  return { id: c.id, name: c.name };
};
const TIPO_POR_NODO: Record<string, string> = {
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': 'googlePalmApi',
  '@n8n/n8n-nodes-langchain.googleGemini': 'googlePalmApi',
  'n8n-nodes-base.googleCalendar': 'googleCalendarOAuth2Api',
  'n8n-nodes-base.googleCalendarTool': 'googleCalendarOAuth2Api',
  'n8n-nodes-base.whatsApp': 'whatsAppApi',
  'n8n-nodes-base.whatsAppTrigger': 'whatsAppTriggerApi',
};

/** El Demo A «vivo»: el JSON versionado, con el Trigger con su credencial y su webhookId, y toda credencial con su id. */
function demoAVivo(cambios: (w: J) => void = () => undefined): J {
  const w = leerJson(DEMO_A);
  w.id = 'wf1'; w.active = true; w.versionId = 'v1'; w.activeVersionId = 'v1';
  w.settings = { executionOrder: 'v1', timezone: 'America/La_Paz' };
  for (const n of w.nodes as J[]) {
    const tipo = TIPO_POR_NODO[n.type as string];
    if (tipo && !(n.credentials && n.credentials[tipo])) n.credentials = { ...(n.credentials ?? {}), [tipo]: {} };
    for (const [t, c] of Object.entries((n.credentials ?? {}) as J)) {
      const nombre = String((c as J).name ?? '');
      const hallada = CREDENCIALES.find((x) => x.type === t && x.name === nombre) ?? { ...porTipo(t), type: t };
      n.credentials[t] = { id: hallada.id, name: hallada.name };
    }
    if (n.type === 'n8n-nodes-base.whatsAppTrigger') n.webhookId = 'webhook-del-demo-a';
  }
  cambios(w);
  return w;
}

// ---------------------------------------------------------------------------------- n8n de mentira
interface Mundo { flujo: J; puts: J[]; credenciales: typeof CREDENCIALES }
let mundo: Mundo;
let servidor: Server;
let carpeta = '';
const leerCuerpo = (r: IncomingMessage): Promise<string> => new Promise((ok) => { const trozos: Buffer[] = []; r.on('data', (c: Buffer) => { trozos.push(c); }); r.on('end', () => ok(Buffer.concat(trozos).toString('utf8'))); });

/** El JSON de ensayo «preparado»: lo que deja `preparar-import.sh` (los dos marcadores ya repuestos). */
const preparado = (cambios: (f: J) => void = () => undefined): string => {
  const f = JSON.parse(readFileSync(RUBEN, 'utf8').replaceAll('REEMPLAZAR_PHONE_NUMBER_ID', PHONE_ID).replaceAll('REEMPLAZAR_NUMERO_AVISO_ENSAYO', TELEFONO)) as J;
  cambios(f);
  return JSON.stringify(f);
};

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'herramienta-demo-a-ruben-'));
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
      return enviar(404, { message: 'no existe' });
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  writeFileSync(join(carpeta, '.env.falso'), `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\nWA_PHONE_ID=${PHONE_ID}\n`);
  chmodSync(join(carpeta, '.env.falso'), 0o600);
  writeFileSync(join(carpeta, 'ruben.local.json'), preparado());
  writeFileSync(join(carpeta, 'ruben-con-marcadores.json'), readFileSync(RUBEN, 'utf8'));
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(carpeta, { recursive: true, force: true }); });

let secuencia = 0;
const nuevo = (flujo: J = demoAVivo(), credenciales = CREDENCIALES): void => { mundo = { flujo, puts: [], credenciales }; };
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
const sobreDemoA = (respaldo: string, extra: string[] = [], flujo = 'ruben.local.json') =>
  correr(['--sobre-demo-a', '--respaldo', respaldo, '--flujo', join(carpeta, flujo), ...(extra.includes('--aplicar') ? ['--autorizo-gemini-produccion'] : []), ...extra]);
const nodo = (w: J, n: string): J => (w.nodes as J[]).find((x) => x.name === n)!;
const cuerpoPut = (w: J): J => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings ?? {} });
const ENVIOS_POR_GRAPH = ['Obtener URL del medio (general)', 'Descargar medio', 'Enviar aviso', 'Enviar a WhatsApp', 'Enviar respaldo', 'Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado'];
/** Un JSON de ensayo torcido, preparado, en un archivo nuevo. */
const torcido = (cambios: (f: J) => void): string => { const a = `ruben-torcido-${++secuencia}.local.json`; writeFileSync(join(carpeta, a), preparado(cambios)); return a; };

describe('la herramienta ACEPTA el JSON de ensayo de Rubén', () => {
  it('en seco: lista las credenciales nodo por nodo, guarda el respaldo exacto del vivo (600), NO escribe en n8n y no imprime teléfono ni phone id', async () => {
    nuevo();
    const original = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const respaldo = respaldoNuevo();
    const r = await sobreDemoA(respaldo);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(0);
    expect(r.salida).toMatch(/En seco: no se escribió nada en n8n/);
    expect(r.salida).toContain('WhatsApp Trigger: el del Demo A, tal cual («WhatsApp OAuth account»)');
    expect(r.salida).not.toMatch(/credencial corregida/);
    for (const n of ENVIOS_POR_GRAPH) expect(r.salida).toContain(`${n}: PARÁMETROS CAMBIADOS genericCredentialType/httpHeaderAuth → predefinedCredentialType/whatsAppApi`);
    expect(r.salida).toContain('Marcadores que quedan (solo respaldo de «Config base»; el panel de «ensayo» manda): —');
    expect(statSync(respaldo).mode & 0o777).toBe(0o600);
    expect(cuerpoPut(leerJson(respaldo))).toEqual(cuerpoPut(original));
    expect(r.salida).not.toContain(TELEFONO);
    expect(r.salida).not.toContain(PHONE_ID);
  });

  it('con --aplicar: el flujo de Rubén queda en el Demo A con TODAS las credenciales por id y por nombre del Demo A, sin miniCRM, con el Trigger tal cual y los marcadores repuestos', async () => {
    nuevo();
    const vivo = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(1);
    const b = mundo.puts[0]!;
    expect(b.name).toBe(NOMBRE_DEMO_A);
    expect(b.nodes).toHaveLength(51);
    expect(nodo(b, 'WhatsApp Trigger')).toEqual(nodo(vivo, 'WhatsApp Trigger'));
    expect(b.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false });
    const delDemoA = new Set((vivo.nodes as J[]).flatMap((n) => Object.values((n.credentials ?? {}) as J).map((c) => (c as J).id)));
    const conCredencial = (b.nodes as J[]).filter((n) => n.credentials);
    expect(conCredencial.length).toBeGreaterThan(15);
    for (const n of conCredencial) {
      for (const [tipo, c] of Object.entries(n.credentials as J)) {
        expect((c as J).id, `${n.name} (${tipo})`).toBeTruthy();
        expect(delDemoA.has((c as J).id), `${n.name} (${tipo})`).toBe(true);
        const registrada = CREDENCIALES.find((x) => x.id === (c as J).id)!;
        expect(registrada.type, `${n.name}`).toBe(tipo);
        expect(registrada.name).toBe((c as J).name);
      }
    }
    for (const n of ['Transcribir audio', 'Describir documento', 'Describir imagen', 'Conversar con el modelo']) expect(nodo(b, n).credentials.googlePalmApi, n).toEqual({ id: 'c-gem', name: 'Google Gemini(PaLM) Api account' });
    for (const n of ['Traer configuración', 'Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Cotejar en el servidor', 'Avisar al servidor', 'Guardar comprobante', 'Guardar medio']) {
      expect(nodo(b, n).credentials.httpHeaderAuth, n).toEqual({ id: 'c-hdr', name: 'Cierres NovuChat A (auto)' });
    }
    // Todo nodo que habla con Graph pasa a la credencial predefinida whatsAppApi: ninguno conserva una credencial de cabecera ni una «Graph … (Bearer)».
    for (const n of ENVIOS_POR_GRAPH) {
      expect(nodo(b, n).parameters.authentication, n).toBe('predefinedCredentialType');
      expect(nodo(b, n).parameters.nodeCredentialType, n).toBe('whatsAppApi');
      expect(nodo(b, n).credentials, n).toEqual({ whatsAppApi: { id: 'c-wa', name: 'WhatsApp account' } });
    }
    // Ninguna credencial «Graph … (Bearer)», del miniCRM ni de Google (el código de los nodos nombra `googleApi` en sus comentarios: se mira lo que n8n guarda como credencial).
    const credenciales = JSON.stringify((b.nodes as J[]).map((n) => n.credentials ?? {}));
    expect(credenciales).not.toMatch(/\(Bearer\)|miniCRM|googleApi/);
    // «Config base»: los marcadores repuestos, el interruptor en true y sin planilla.
    const base = Object.fromEntries((nodo(b, 'Config base').parameters.assignments.assignments as J[]).map((x) => [x.name, x.value]));
    expect(base['phoneNumberIdEsperado']).toBe(PHONE_ID);
    expect(base['numeroRecepcion']).toBe(TELEFONO);
    expect(base['avisarAlPropioNumero']).toBe(true);
    expect(base['planillaProspectosId']).toBe('');
    expect(Object.values(base).filter((v) => /^REEMPLAZAR_/.test(String(v)))).toEqual([]);
    for (const n of conCredencial) for (const c of Object.values(n.credentials as J)) expect((c as J).name).not.toMatch(/bellido|platinum|q'?taco|segurolo|otp|aab1|receptor|ruben|rubén/i);
  });

  it('la VUELTA ATRÁS es el respaldo exacto: el Demo A queda como estaba', async () => {
    nuevo();
    const original = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const respaldo = respaldoNuevo();
    expect((await sobreDemoA(respaldo, ['--aplicar'])).codigo).toBe(0);
    const r = await correr(['--restaurar-respaldo', '--respaldo', respaldo, '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(cuerpoPut(mundo.puts[1]!)).toEqual(cuerpoPut(original));
    expect(r.salida).toContain('leído de vuelta es igual al respaldo');
  });
});

describe('la herramienta se NIEGA, sin ningún PUT', () => {
  it('con el JSON sin pasar por `preparar-import.sh` (los dos marcadores sin reponer)', async () => {
    nuevo();
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar'], 'ruben-con-marcadores.json');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/marcadores que el flujo necesitaría y nadie repone: .*REEMPLAZAR_(PHONE_NUMBER_ID|NUMERO_AVISO_ENSAYO)/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si el JSON conserva la rama del miniCRM con la credencial de Rubén (el Demo A no la tiene)', async () => {
    nuevo();
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { nodo(f, 'Traer configuración').credentials.googleApi = { id: '', name: 'Google Sheets miniCRM (crm-rroca-ruben)' }; }));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/googleApi|no está en la tabla de credenciales del Demo A/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si un nodo lleva la credencial de ingesta de producción de Rubén (no está en la tabla de la herramienta)', async () => {
    nuevo();
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { nodo(f, 'Traer configuración').credentials.httpHeaderAuth.name = 'NovuChat ingesta (Ruben)'; }));
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/que no está en la tabla de credenciales del Demo A/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si un nodo que llama a graph.facebook.com conserva la credencial de cabecera de la ingesta (la trampa del 15/09)', async () => {
    nuevo();
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { nodo(f, 'Enviar aviso').credentials = { httpHeaderAuth: { id: '', name: 'Cierres NovuChat A (auto)' } }; }));
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('conservan una credencial de cabecera');
    expect(r.salida).toContain('Enviar aviso');
    expect(mundo.puts).toHaveLength(0);
  });

  it('si el JSON trae el nombre de otro cliente en una credencial de cabecera (la tabla de la herramienta solo conoce dos nombres)', async () => {
    nuevo();
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { nodo(f, 'Traer configuración').credentials.httpHeaderAuth.name = "NovuChat ingesta (Q'Taco)"; }));
    expect(r.codigo, r.salida).toBe(1);
    expect(mundo.puts).toHaveLength(0);
  });

  it('OJO: la herramienta resuelve Gemini y WhatsApp por TIPO (no mira el nombre que trae el JSON): por eso el armado de Rubén es quien vigila esos nombres', async () => {
    // Un Gemini «de pruebas» en el JSON pasa la herramienta y queda con la de producción: el cerrojo del nombre es `construir.mjs` (ensayo-demo-a.test.ts, «se rechaza una credencial…»).
    nuevo();
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { nodo(f, 'Conversar con el modelo').credentials.googlePalmApi.name = 'Gemini — pruebas (no producción)'; }));
    expect(r.codigo, r.salida).toBe(0);
    expect(nodo(mundo.puts[0]!, 'Conversar con el modelo').credentials.googlePalmApi.name).toBe('Google Gemini(PaLM) Api account');
  });

  it('si el flujo del .env no es el Demo A, si está inactivo o sin `--autorizo-gemini-produccion`', async () => {
    nuevo(demoAVivo((w) => { w.name = 'NovuChat Bellido — Agendamiento (Pediatría)'; }));
    const otro = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
    expect(otro.codigo).toBe(1);
    expect(otro.salida).toMatch(/no es el del Demo A/);
    nuevo(demoAVivo((w) => { w.active = false; }));
    const inactivo = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
    expect(inactivo.codigo).toBe(1);
    expect(inactivo.salida).toMatch(/NO está activo/);
    nuevo();
    const sin = await correr(['--sobre-demo-a', '--respaldo', respaldoNuevo(), '--flujo', join(carpeta, 'ruben.local.json'), '--aplicar']);
    expect(sin.codigo).toBe(1);
    expect(sin.salida).toMatch(/exige --autorizo-gemini-produccion/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si el JSON trae un segundo disparador, un Webhook de prueba o ningún Trigger', async () => {
    nuevo();
    const dos = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { (f.nodes as J[]).push({ ...nodo(f, 'WhatsApp Trigger'), id: 'otro', name: 'Otro Trigger' }); }));
    expect(dos.codigo).toBe(1);
    expect(dos.salida).toMatch(/disparadores: candidato 2/);
    const web = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { (f.nodes as J[]).push({ id: 'w', name: 'Entrada de prueba', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: {} }); }));
    expect(web.codigo).toBe(1);
    expect(web.salida).toMatch(/Webhook de prueba/);
    const sin = await sobreDemoA(respaldoNuevo(), ['--aplicar'], torcido((f) => { f.nodes = (f.nodes as J[]).filter((n) => n.name !== 'WhatsApp Trigger'); }));
    expect(sin.codigo).toBe(1);
    expect(sin.salida).toMatch(/disparadores: candidato 0/);
    expect(mundo.puts).toHaveLength(0);
  });
});
