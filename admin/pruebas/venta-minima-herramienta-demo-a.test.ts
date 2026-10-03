/**
 * ENSAYO DE «VENTA MÍNIMA» EN EL DEMO A, por `flujo-de-prueba.mjs --sobre-demo-a` y `--restaurar-respaldo`.
 *
 * Se corre la herramienta de verdad, como un proceso, contra un n8n de MENTIRA (un servidor HTTP local con GET, PUT, activate
 * y la lista de credenciales) cuyo flujo «vivo» es el Demo A versionado con credenciales con id. Nada toca producción.
 *
 * Lo que se prueba, sin n8n real (y es todo lo que se puede probar sin él):
 *   - el flujo de venta queda en el Demo A con TODAS sus credenciales resueltas por id y por nombre del Demo A: ningún nodo
 *     con credencial vacía, el Trigger es el del Demo A tal cual, y los cuatro envíos por Graph pasan a la credencial
 *     predefinida `whatsAppApi` (no se crea ninguna credencial con el token);
 *   - la vuelta atrás es el respaldo EXACTO del vivo (permisos 600): el Demo A queda como estaba, con sus credenciales;
 *   - se niega, sin ningún PUT, si el flujo del `.env` no es el Demo A, si una credencial no es una que el Demo A ya usa, o
 *     si quedan marcadores sin reponer.
 *
 * LO QUE NO SE PUEDE PROBAR ACÁ (se mira en el seco real, con n8n): que los nombres y tipos de credencial de la tabla de la
 * herramienta existan hoy en la instancia, que el `WhatsApp Trigger` vivo tenga la credencial de la app del Demo A, y que
 * Meta siga apuntando a la ruta del Demo A después del PUT (`webhook-meta.sh --ver-meta`). Ver `docs/ensayo/LEEME.md` §6.
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
const ejecutar = promisify(execFile);
const PHONE_ID = '100000000000042'; // el del Demo A, sintético
const RESTAURANTE = '59100000021'; // el teléfono del restaurante en el ensayo, sintético
const NOMBRE_DEMO_A = 'NovuChat Demo A — Agendamiento (Belleza y Salud)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const leerJson = (ruta: string): J => JSON.parse(readFileSync(ruta, 'utf8')) as J;

// Las credenciales del Demo A: nombre, tipo e id. Hay DOS de Gemini (la de producción y la de pruebas): la herramienta elige por
// nombre, así que la de pruebas no se usa ni estorba.
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
const leerCuerpo = (r: IncomingMessage): Promise<string> => new Promise((ok) => { let t = ''; r.on('data', (c) => { t += String(c); }); r.on('end', () => ok(t)); });

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'herramienta-demo-a-'));
  servidor = createServer((req, res) => {
    void (async () => {
      const cuerpo = await leerCuerpo(req);
      const enviar = (cod: number, datos: unknown): void => { res.writeHead(cod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
      if (req.method === 'GET' && req.url === '/api/v1/workflows/wf1') return enviar(200, mundo.flujo);
      if (req.method === 'GET' && String(req.url).startsWith('/api/v1/credentials')) return enviar(200, { data: mundo.credenciales });
      if (req.method === 'PUT' && req.url === '/api/v1/workflows/wf1') {
        const b = JSON.parse(cuerpo) as J;
        mundo.puts.push(b);
        mundo.flujo = { ...mundo.flujo, name: b.name, nodes: b.nodes, connections: b.connections, settings: b.settings, versionId: 'v' + String(mundo.puts.length + 1), activeVersionId: 'v' + String(mundo.puts.length + 1) };
        return enviar(200, mundo.flujo);
      }
      if (req.method === 'POST' && req.url === '/api/v1/workflows/wf1/activate') { mundo.flujo.active = true; return enviar(200, mundo.flujo); }
      return enviar(404, { message: 'no existe' });
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  writeFileSync(join(carpeta, '.env.falso'), `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\nWA_PHONE_ID=${PHONE_ID}\n`);
  chmodSync(join(carpeta, '.env.falso'), 0o600);
  // El JSON de venta «preparado»: lo que deja `preparar-import.sh` (los dos marcadores ya reemplazados).
  const preparado = readFileSync(VENTA, 'utf8').replaceAll('REEMPLAZAR_PHONE_NUMBER_ID', PHONE_ID).replaceAll('REEMPLAZAR_NUMERO_AVISO_ENSAYO', RESTAURANTE);
  writeFileSync(join(carpeta, 'venta.local.json'), preparado);
  writeFileSync(join(carpeta, 'venta-con-marcadores.json'), readFileSync(VENTA, 'utf8'));
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(carpeta, { recursive: true, force: true }); });

let secuencia = 0;
const nuevo = (flujo: J = demoAVivo(), credenciales = CREDENCIALES): void => { mundo = { flujo, puts: [], credenciales }; };
/** Una ruta de respaldo nueva (fuera del repositorio) por prueba. */
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
const sobreDemoA = (respaldo: string, extra: string[] = [], flujo = 'venta.local.json') => correr(['--sobre-demo-a', '--respaldo', respaldo, '--flujo', join(carpeta, flujo), ...extra]);
const nodo = (w: J, n: string): J => (w.nodes as J[]).find((x) => x.name === n)!;
const cuerpoPut = (w: J): J => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings ?? {} });
const ENVIOS_POR_GRAPH = ['Enviar a WhatsApp', 'Enviar respaldo', 'Enviar aviso', 'Aviso de respaldo'];

describe('en seco', () => {
  it('lista las credenciales nodo por nodo, guarda el respaldo exacto del vivo (600) y NO escribe en n8n', async () => {
    nuevo();
    const original = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const respaldo = respaldoNuevo();
    const r = await sobreDemoA(respaldo);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(0);
    expect(r.salida).toMatch(/En seco: no se escribió nada en n8n/);
    expect(r.salida).toContain('WhatsApp Trigger: el del Demo A, tal cual («WhatsApp OAuth account»)');
    for (const n of ENVIOS_POR_GRAPH) expect(r.salida).toContain(`${n}: PARÁMETROS CAMBIADOS genericCredentialType/httpHeaderAuth → predefinedCredentialType/whatsAppApi`);
    // El respaldo es el vivo entero, con permisos 600.
    expect(statSync(respaldo).mode & 0o777).toBe(0o600);
    expect(cuerpoPut(leerJson(respaldo))).toEqual(cuerpoPut(original));
    // Ni el teléfono del restaurante ni el phone id salen por pantalla.
    expect(r.salida).not.toContain(RESTAURANTE);
    expect(r.salida).not.toContain(PHONE_ID);
  });
});

describe('con --aplicar', () => {
  it('pone el flujo de venta en el Demo A con TODAS las credenciales resueltas por id y por nombre del Demo A (ningún nodo con credencial vacía)', async () => {
    nuevo();
    const vivo = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(1);
    const b = mundo.puts[0]!;
    expect(b.name).toBe(NOMBRE_DEMO_A);
    // El flujo es el de venta (con sus nodos), con el nombre del Demo A y la retención en «none».
    expect(nodo(b, 'Plan del turno')).toBeTruthy();
    expect(b.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false });
    // El Trigger es el del Demo A TAL CUAL: mismo id, mismo webhookId, misma credencial.
    expect(nodo(b, 'WhatsApp Trigger')).toEqual(nodo(vivo, 'WhatsApp Trigger'));
    // Ningún nodo con credencial vacía, y cada credencial es una de las que el Demo A vivo ya usa.
    const delDemoA = new Set((vivo.nodes as J[]).flatMap((n) => Object.values((n.credentials ?? {}) as J).map((c) => (c as J).id)));
    const conCredencial = (b.nodes as J[]).filter((n) => n.credentials);
    expect(conCredencial.length).toBeGreaterThan(10);
    for (const n of conCredencial) {
      for (const [tipo, c] of Object.entries(n.credentials as J)) {
        expect((c as J).id, `${n.name} (${tipo})`).toBeTruthy();
        expect((c as J).name, `${n.name} (${tipo})`).toBeTruthy();
        expect(delDemoA.has((c as J).id), `${n.name} (${tipo})`).toBe(true);
        const registrada = CREDENCIALES.find((x) => x.id === (c as J).id)!;
        expect(registrada.type, `${n.name}`).toBe(tipo);
        expect(registrada.name).toBe((c as J).name);
      }
    }
    // Gemini: la de PRODUCCIÓN del Demo A (por nombre), nunca la de pruebas ni la «primera del tipo».
    for (const n of ['Transcribir audio', 'Leer comprobante (PDF)', 'Leer comprobante (imagen)', 'Extraer']) {
      expect(nodo(b, n).credentials.googlePalmApi, n).toEqual({ id: 'c-gem', name: 'Google Gemini(PaLM) Api account' });
    }
    // La ingesta y los cierres, con la del Demo A; los medios, con «WhatsApp account».
    for (const n of ['Traer configuración', 'Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Registrar cierre', 'Cotejar en el servidor']) {
      expect(nodo(b, n).credentials.httpHeaderAuth, n).toEqual({ id: 'c-hdr', name: 'Cierres NovuChat A (auto)' });
    }
    for (const n of ['Obtener URL del medio', 'Descargar medio']) expect(nodo(b, n).credentials.whatsAppApi, n).toEqual({ id: 'c-wa', name: 'WhatsApp account' });
    // Los cuatro envíos por Graph pasan a la credencial predefinida whatsAppApi: no queda ninguna «Graph … (Bearer)» ni se crea una.
    for (const n of ENVIOS_POR_GRAPH) {
      expect(nodo(b, n).parameters.authentication, n).toBe('predefinedCredentialType');
      expect(nodo(b, n).parameters.nodeCredentialType, n).toBe('whatsAppApi');
      expect(nodo(b, n).parameters.genericAuthType, n).toBeUndefined();
      expect(nodo(b, n).credentials, n).toEqual({ whatsAppApi: { id: 'c-wa', name: 'WhatsApp account' } });
    }
    const texto = JSON.stringify(b);
    expect(texto).not.toMatch(/\(Bearer\)/);
    // Los dos marcadores quedaron repuestos en «Config base» (el código de los nodos nombra `REEMPLAZAR_` para descartarlo: no cuenta).
    const base = Object.fromEntries((nodo(b, 'Config base').parameters.assignments.assignments as J[]).map((x) => [x.name, x.value]));
    expect(base['phoneNumberIdEsperado']).toBe(PHONE_ID);
    expect(base['destinatariosAviso']).toBe(`completo:${RESTAURANTE}`);
    expect(base['respaldoNumeroRecepcion']).toBe(RESTAURANTE);
    expect(Object.values(base).filter((v) => /^REEMPLAZAR_/.test(String(v)))).toEqual([]);
    // Ningún nombre de cliente ni de sistema ajeno en ninguna credencial.
    for (const n of conCredencial) for (const c of Object.values(n.credentials as J)) expect((c as J).name).not.toMatch(/bellido|platinum|q'?taco|segurolo|otp|aab1|receptor/i);
  });

  it('la VUELTA ATRÁS es el respaldo exacto: el Demo A queda como estaba, con las credenciales de todos sus nodos', async () => {
    nuevo();
    const original = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const respaldo = respaldoNuevo();
    expect((await sobreDemoA(respaldo, ['--aplicar'])).codigo).toBe(0);
    expect(mundo.flujo.nodes.length).not.toBe(original.nodes.length); // ya es el flujo de venta
    // Seco de la restauración: dice que difiere y no escribe.
    const seco = await correr(['--restaurar-respaldo', '--respaldo', respaldo]);
    expect(seco.codigo, seco.salida).toBe(0);
    expect(seco.salida).toMatch(/El vivo difiere del respaldo/);
    expect(mundo.puts).toHaveLength(1);
    const r = await correr(['--restaurar-respaldo', '--respaldo', respaldo, '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(2);
    expect(cuerpoPut(mundo.puts[1]!)).toEqual(cuerpoPut(original));
    // Y por nodo: cada credencial que el Demo A tenía sigue ahí (lo que `ensayo-flujo.sh --restaurar` no garantizaba).
    const antes = (original.nodes as J[]).filter((n) => n.credentials).length;
    const despues = (mundo.flujo.nodes as J[]).filter((n) => n.credentials && Object.values(n.credentials as J).every((c) => (c as J).id)).length;
    expect(despues).toBe(antes);
    expect(antes).toBeGreaterThan(10);
    // Otra restauración no tiene nada que reponer.
    const otra = await correr(['--restaurar-respaldo', '--respaldo', respaldo, '--aplicar']);
    expect(otra.salida).toMatch(/YA es igual al respaldo/);
    expect(mundo.puts).toHaveLength(2);
  });

  it('un segundo `--sobre-demo-a` con el mismo respaldo NO pisa el respaldo del Demo A original', async () => {
    nuevo();
    const original = JSON.parse(JSON.stringify(mundo.flujo)) as J;
    const respaldo = respaldoNuevo();
    expect((await sobreDemoA(respaldo, ['--aplicar'])).codigo).toBe(0);
    expect((await sobreDemoA(respaldo, ['--aplicar'])).codigo).toBe(0); // cambio directo entre candidatos
    expect(cuerpoPut(leerJson(respaldo))).toEqual(cuerpoPut(original));
  });
});

describe('se NIEGA sin escribir (ningún PUT)', () => {
  it('si el flujo del .env no es el Demo A (otro cliente, o un nombre que solo parece)', async () => {
    for (const nombre of ['NovuChat Bellido — Agendamiento (Pediatría)', 'NovuChat — Venta mínima (v0) — Q\'Taco', 'Demo Agendamiento de otro negocio', 'NovuChat Platinum — Demo A']) {
      nuevo(demoAVivo((w) => { w.name = nombre; }));
      const r = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
      expect(r.codigo, nombre).toBe(1);
      expect(r.salida, nombre).toMatch(/no es el del Demo A/);
      expect(mundo.puts, nombre).toHaveLength(0);
    }
    // Negativo: con el nombre del Demo A, sí.
    nuevo();
    expect((await sobreDemoA(respaldoNuevo(), ['--aplicar'])).codigo).toBe(0);
  });

  it('si una credencial de la tabla no es una que el Demo A vivo ya usa (aunque exista con ese nombre)', async () => {
    nuevo(demoAVivo((w) => { for (const n of w.nodes as J[]) if (n.credentials?.whatsAppApi) n.credentials.whatsAppApi = { id: 'c-otra', name: 'WhatsApp otra' }; }));
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no es una credencial que el Demo A vivo ya use/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si la credencial no existe en n8n, o existe dos veces con el mismo nombre (no se elige por nombre)', async () => {
    nuevo(demoAVivo(), CREDENCIALES.filter((c) => c.name !== 'WhatsApp account'));
    const falta = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
    expect(falta.codigo).toBe(1);
    expect(falta.salida).toMatch(/no existe en n8n la credencial «WhatsApp account»/);
    nuevo(demoAVivo(), [...CREDENCIALES, { id: 'c-gem-2', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi' }]);
    const doble = await sobreDemoA(respaldoNuevo(), ['--aplicar']);
    expect(doble.codigo).toBe(1);
    expect(doble.salida).toMatch(/más de una credencial llamada «Google Gemini\(PaLM\) Api account»/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si el JSON trae marcadores sin reponer (el de venta sin pasar por `preparar-import.sh`)', async () => {
    nuevo();
    const r = await sobreDemoA(respaldoNuevo(), ['--aplicar'], 'venta-con-marcadores.json');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/marcadores que el flujo necesitaría y nadie repone: .*REEMPLAZAR_(PHONE_NUMBER_ID|NUMERO_AVISO_ENSAYO)/);
    expect(mundo.puts).toHaveLength(0);
  });

  it('si el respaldo estaría DENTRO del repositorio (lleva ids)', async () => {
    nuevo();
    const r = await sobreDemoA(join(aqui, 'respaldo-que-no-debe-existir.json'), ['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/FUERA del repositorio/);
    expect(mundo.puts).toHaveLength(0);
  });
});
