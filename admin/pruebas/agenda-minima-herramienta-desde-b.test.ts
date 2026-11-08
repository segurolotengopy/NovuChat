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

interface Mundo { credenciales: J[]; flujo: J; puts: J[]; putFalla: boolean; guardaMenos: boolean; noActivaAlGuardar: boolean; cambiaCredenciales: boolean; activaciones: number }
let mundo: Mundo;
let servidor: Server;
let carpeta = '';
const leerCuerpo = (r: IncomingMessage): Promise<string> => new Promise((ok) => { const trozos: Buffer[] = []; r.on('data', (c: Buffer) => { trozos.push(c); }); r.on('end', () => ok(Buffer.concat(trozos).toString('utf8'))); });

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'herramienta-desde-b-'));
  servidor = createServer((req, res) => {
    void (async () => {
      const cuerpo = await leerCuerpo(req);
      const enviar = (cod: number, datos: unknown): void => { res.writeHead(cod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
      if (req.method === 'GET' && req.url === '/api/v1/credentials?limit=250') return enviar(200, { data: mundo.credenciales });
      if (req.method === 'GET' && req.url === '/api/v1/workflows/wf1') return enviar(200, mundo.flujo);
      if (req.method === 'PUT' && req.url === '/api/v1/workflows/wf1') {
        if (mundo.putFalla) return enviar(500, { message: 'falló a propósito' });
        const b = JSON.parse(cuerpo) as J;
        mundo.puts.push(b);
        mundo.flujo = { ...mundo.flujo, name: b.name, nodes: mundo.guardaMenos ? (b.nodes as J[]).slice(1) : b.nodes, connections: b.connections, settings: b.settings, versionId: 'v2', activeVersionId: mundo.noActivaAlGuardar ? mundo.flujo.activeVersionId : 'v2' };
        if (mundo.cambiaCredenciales) ((mundo.flujo.nodes as J[]).find((x) => x.name === 'Leer agenda')!).credentials = { googleCalendarOAuth2Api: { id: 'otra', name: 'Otra' } };
        return enviar(200, mundo.flujo);
      }
      if (req.method === 'POST' && req.url === '/api/v1/workflows/wf1/activate') { mundo.activaciones++; mundo.flujo.active = true; mundo.flujo.activeVersionId = mundo.flujo.versionId; return enviar(200, mundo.flujo); }
      return enviar(404, { message: 'no existe' });
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  writeFileSync(join(carpeta, '.env.falso'), `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\n`);
  chmodSync(join(carpeta, '.env.falso'), 0o600);
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(carpeta, { recursive: true, force: true }); });

const nuevo = (flujo: J, extra: Partial<Mundo> = {}): void => { mundo = { credenciales: [{ id: 'cred-crm-lista', name: 'Google Sheets miniCRM (crm-bellido)', type: 'googleApi' }], flujo, puts: [], putFalla: false, guardaMenos: false, noActivaAlGuardar: false, cambiaCredenciales: false, activaciones: 0, ...extra }; };
let n = 0;
const respaldoNuevo = (): string => join(carpeta, `respaldo-${++n}.json`);
async function correr(args: string[], respaldo = respaldoNuevo(), envArchivo = '.env.falso'): Promise<{ codigo: number; salida: string; respaldo: string }> {
  try {
    const r = await ejecutar(process.execPath, [HERRAMIENTA, '--env', join(carpeta, envArchivo), '--estado', join(carpeta, 'estado.json'), '--sobre-bellido', '--respaldo', respaldo, ...args], { env: entornoDelEmulador() });
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
    expect(p.nodes).toHaveLength(candidato().nodes.length);
    for (const x of NUEVOS) expect(nodo(p, x), x).toBeDefined();
    // disparador y credencial del vivo, tal cual
    expect(JSON.stringify(nodo(p, 'WhatsApp Trigger').credentials)).toContain('trig-bellido');
    // «Config base» con los valores del vivo (los tres marcadores de respaldo)
    const asign = (nodo(p, 'Config base').parameters.assignments.assignments as J[]).map((a) => String(a.value));
    expect(asign.join('|')).not.toMatch(/REEMPLAZAR_/);
    for (const campo of ['respaldoNumeroRecepcion', 'respaldoNumeroDoctor', 'horarioAtencion']) {
      const a = (nodo(p, 'Config base').parameters.assignments.assignments as J[]).find((x) => x.name === campo)!;
      expect(a.value, campo).toBe('lleno-' + campo);
    }
    // la salida nunca trae un valor del vivo, un id de credencial ni la clave
    expect(r.salida).not.toMatch(/lleno-|cred-|trig-bellido|clave-falsa/);
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

describe('--desde-b: lectura de vuelta y versión publicada', () => {
  it('si n8n deja activa la versión anterior, activa de nuevo y lo comprueba (no aborta en falso)', async () => {
    nuevo(vivoAnterior(), { noActivaAlGuardar: true });
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.activaciones).toBe(1);
  });
  it('NIEGA: si las credenciales leídas de vuelta no son las del candidato, no se da por publicado', async () => {
    nuevo(vivoAnterior(), { cambiaCredenciales: true });
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/credenciales o las conexiones leídas no coinciden/);
  });
  it('en seco nunca activa ni escribe', async () => {
    nuevo(vivoAnterior());
    await correr(['--desde-b']);
    expect(mundo.activaciones).toBe(0);
    expect(mundo.puts).toHaveLength(0);
  });
});

describe('--desde-b: lo que se niega, sin ningún PUT', () => {
  it('un vivo INACTIVO no se reactiva desde acá', async () => {
    const vivo = vivoAnterior(); vivo.active = false;
    nuevo(vivo);
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/INACTIVO/);
    expect(mundo.puts).toHaveLength(0);
    expect(mundo.activaciones).toBe(0);
  });
  it("un flujo con nombre de otro sistema («Bellido — Q'Taco») se niega", async () => {
    nuevo(vivoAnterior("NovuChat Bellido — Q'Taco"));
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/sistema ajeno/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('--sobre-bellido no se combina con --borrar, --restaurar-respaldo ni --turno', async () => {
    nuevo(vivoAnterior());
    for (const otro of ['--borrar', '--restaurar-respaldo', '--turno']) {
      const r = await correr(['--desde-b', otro, '--aplicar']);
      expect(r.codigo).not.toBe(0);
      expect(r.salida).toMatch(/no se combina con otro modo/);
    }
    expect(mundo.puts).toHaveLength(0);
  });
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
  it('--desde-b sin --sobre-bellido, o junto a --actualizar-codigo, se niega con su motivo', async () => {
    nuevo(vivoAnterior());
    for (const args of [['--env', join(carpeta, '.env.falso'), '--desde-b'], ['--env', join(carpeta, '.env.falso'), '--actualizar-codigo', '--desde-b']]) {
      let codigo = 0;
      try { await ejecutar(process.execPath, [HERRAMIENTA, ...args], { env: entornoDelEmulador() }); } catch (e) { codigo = (e as { code: number }).code; }
      expect(codigo).not.toBe(0);
    }
    expect(mundo.puts).toHaveLength(0);
  });
});

// =================================================================================================
// EL miniCRM DE BELLIDO en la publicación (04/11/2026): la credencial googleApi se resuelve por NOMBRE EXACTO en la lista de n8n, y el id de la planilla se siembra del entorno.
const CRED_CRM = 'Google Sheets miniCRM (crm-bellido)';
const NODOS_CRM = ['Prospecto para la planilla', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Decidir fila de la planilla', '¿Acción de la planilla?', 'Agregar fila', 'Actualizar fila'];
const ID_PLANILLA = 'PlanillaDePruebaDeBellidoParaElMiniCrm01';
/** El vivo ANTERIOR al miniCRM: sin la rama, sin credencial googleApi y con «Config base» sin id de planilla. */
function vivoSinCrm(): J {
  const w = vivoAnterior();
  w.nodes = (w.nodes as J[]).filter((x) => !NODOS_CRM.includes(x.name));
  w.connections = Object.fromEntries(Object.entries(w.connections as J).filter(([de]) => !NODOS_CRM.includes(de)));
  w.connections['Armar mensajes'] = { main: [[{ node: '¿Enviar de verdad?', type: 'main', index: 0 }]] };
  const base = nodo(w, 'Config base');
  base.parameters.assignments.assignments = (base.parameters.assignments.assignments as J[]).filter((a) => !/^planillaProspectos/.test(a.name));
  return w;
}
const cred = (id: string, name: string, type = 'googleApi'): J => ({ id, name, type });
const envCon = (linea: string): string => {
  const f = `.env.planilla-${++n}`;
  writeFileSync(join(carpeta, f), `N8N_BASE_URL=${(readFileSync(join(carpeta, '.env.falso'), 'utf8').match(/N8N_BASE_URL=(.*)/) ?? [])[1]}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\n${linea}\n`);
  chmodSync(join(carpeta, f), 0o600);
  return f;
};

describe('miniCRM de Bellido: la credencial googleApi', () => {
  it('(a) se resuelve por nombre exacto desde la lista de n8n, en seco (solo lecturas), y la salida no muestra ningún id', async () => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [cred('id-secreto-1', 'Otra cosa'), cred('id-secreto-crm', CRED_CRM)];
    const r = await correr(['--desde-b']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain(`→ «${CRED_CRM}» (de la lista de n8n)`);
    expect(r.salida).not.toMatch(/id-secreto|clave-falsa/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('(a) con --aplicar los 5 nodos de Google llevan el id de esa credencial', async () => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [cred('id-secreto-crm', CRED_CRM)];
    const r = await correr(['--desde-b', '--aplicar'], respaldoNuevo(), envCon(`PLANILLA_PROSPECTOS_ID_BELLIDO=${ID_PLANILLA}`));
    expect(r.codigo, r.salida).toBe(0);
    const p = mundo.puts[0]!;
    const conGoogle = (p.nodes as J[]).filter((x) => x.credentials?.googleApi);
    expect(conGoogle.map((x) => x.name).sort()).toEqual(['Actualizar fila', 'Agregar fila', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla']);
    for (const x of conGoogle) expect(x.credentials.googleApi).toEqual({ id: 'id-secreto-crm', name: CRED_CRM });
    expect(r.salida).not.toMatch(/id-secreto|clave-falsa|PlanillaDePrueba/);
  });
  it('(b) NIEGA: sin ninguna coincidencia muere con un mensaje claro y sin ids', async () => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [];
    const r = await correr(['--desde-b']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/exactamente una vez; hay 0/);
  });
  it('(b) NIEGA: dos coincidencias mueren', async () => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [cred('id-secreto-1', CRED_CRM), cred('id-secreto-2', CRED_CRM)];
    const r = await correr(['--desde-b']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/exactamente una vez; hay 2/);
    expect(r.salida).not.toMatch(/id-secreto/);
  });
  it.each([
    ['la de otro tenant', 'Google Sheets miniCRM (crm-rroca-evy)'],
    ['un nombre parecido', 'Google Sheets miniCRM (crm-bellido) '],
    ['otro tipo con el mismo nombre', CRED_CRM, 'httpHeaderAuth'],
  ])('(c) NIEGA: %s NO se resuelve', async (_t, nombre, tipo = 'googleApi') => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [cred('id-secreto-1', nombre as string, tipo as string)];
    const r = await correr(['--desde-b']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/exactamente una vez; hay 0/);
  });
});

describe('miniCRM de Bellido: el id de la planilla desde el entorno', () => {
  const planillaDe = (p: J): unknown => (nodo(p, 'Config base').parameters.assignments.assignments as J[]).find((a) => a.name === 'planillaProspectosId')!.value;
  it('(d) el vivo no lo trae y el entorno sí: se siembra, no se imprime y el respaldo (el vivo) no lo lleva', async () => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [cred('id-secreto-crm', CRED_CRM)];
    const r = await correr(['--desde-b', '--aplicar'], respaldoNuevo(), envCon(`PLANILLA_PROSPECTOS_ID_BELLIDO=${ID_PLANILLA}`));
    expect(r.codigo, r.salida).toBe(0);
    expect(planillaDe(mundo.puts[0]!)).toBe(ID_PLANILLA);
    expect(r.salida).toContain('llenado desde el entorno');
    expect(r.salida).not.toContain(ID_PLANILLA);
    expect(readFileSync(r.respaldo, 'utf8')).not.toContain(ID_PLANILLA);
  });
  it('(d) si el vivo ya lo trae, manda el vivo', async () => {
    const vivo = vivoSinCrm();
    (nodo(vivo, 'Config base').parameters.assignments.assignments as J[]).push({ id: 'x', name: 'planillaProspectosId', type: 'string', value: 'VivoYaTieneUnIdDePlanillaValido123456' });
    nuevo(vivo);
    mundo.credenciales = [cred('id-secreto-crm', CRED_CRM)];
    const r = await correr(['--desde-b', '--aplicar'], respaldoNuevo(), envCon(`PLANILLA_PROSPECTOS_ID_BELLIDO=${ID_PLANILLA}`));
    expect(r.codigo, r.salida).toBe(0);
    expect(planillaDe(mundo.puts[0]!)).toBe('VivoYaTieneUnIdDePlanillaValido123456');
  });
  it.each([['una forma inválida (corto)', 'abc123'], ['caracteres no permitidos', 'Planilla con espacios y simbolos &&&&&&&&&&&'], ['el prefijo REEMPLAZAR_', 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID_BELLIDO']])('(d) NIEGA: %s en el entorno muere sin mostrar el valor', async (_t, valor) => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [cred('id-secreto-crm', CRED_CRM)];
    const r = await correr(['--desde-b', '--aplicar'], respaldoNuevo(), envCon(`PLANILLA_PROSPECTOS_ID_BELLIDO=${valor}`));
    expect(r.codigo).not.toBe(0);
    expect(mundo.puts).toHaveLength(0);
    expect(r.salida).toMatch(/PLANILLA_PROSPECTOS_ID_BELLIDO del entorno no tiene la forma/);
    expect(r.salida).not.toContain(valor);
  });
  it('(d) sin id en el vivo ni en el entorno se conserva el comportamiento: queda el marcador y --aplicar se niega', async () => {
    nuevo(vivoSinCrm());
    mundo.credenciales = [cred('id-secreto-crm', CRED_CRM)];
    const r = await correr(['--desde-b', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(mundo.puts).toHaveLength(0);
    expect(r.salida).toMatch(/quedan marcadores sin reponer: REEMPLAZAR_PLANILLA_PROSPECTOS_ID_BELLIDO/);
  });
});
