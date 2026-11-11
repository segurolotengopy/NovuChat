/**
 * ENSAYO DEL CHAT DE NOVUCHAT EN EL DEMO A (`chat-novuchat.ensayo-demo-a.json` y `flujo-de-prueba.mjs --sobre-demo-a --conservar-crm`).
 *
 * Dos mitades, las dos negando:
 *   1. El ARMADOR: el archivo de datos `ensayo-demo-a.json` lleva SOLO marcadores y credencial de hoja de ensayo, y ahí no puede quedar ninguno de producción; a la inversa,
 *      ningún otro archivo de datos (ni lo heredado) ni ninguna otra salida puede llevar los del ensayo. El JSON de producción y el de prueba no cambian.
 *   2. La HERRAMIENTA, contra un n8n de MENTIRA (un servidor HTTP local): con `--conservar-crm` el miniCRM queda conectado a la hoja de PRUEBA; sin la bandera, el comportamiento de
 *      siempre (se quita la rama del CRM y se vacía la planilla) no cambia. Nada toca n8n ni ninguna hoja reales.
 *
 * LO QUE NO SE PUEDE PROBAR ACÁ: que la credencial «Google Sheets miniCRM (ensayo)» exista en la instancia real y tenga acceso SOLO a la hoja de prueba, ni que la hoja tenga las
 * columnas del mapa `crm` (eso lo mira el seco real y la primera conversación del ensayo).
 */
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(aqui, '../../Flujos/experimental/chat-novuchat');
const DATOS_DIR = join(aqui, '../scripts/datos/chat-novuchat');
const HERRAMIENTA = join(aqui, '../../Flujos/experimental/agenda-minima/herramientas/flujo-de-prueba.mjs');
const DEMO_A = join(aqui, '../../Flujos/demo-a-agendamiento.json');
const ENSAYO = join(CARPETA, 'chat-novuchat.ensayo-demo-a.json');
const ejecutar = promisify(execFile);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const leerJson = (ruta: string): J => JSON.parse(readFileSync(ruta, 'utf8')) as J;
const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nodo = (w: J, n: string): J => (w.nodes as J[]).find((x) => x.name === n)!;
const baseDe = (w: J): J => Object.fromEntries((nodo(w, 'Config base').parameters.assignments.assignments as J[]).map((a) => [a.name, a.value]));
const HOJAS = ['Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Agregar fila', 'Actualizar fila'];
const CRED_ENSAYO = 'Google Sheets miniCRM (ensayo)';

const CONSTRUIR = (await import(/* @vite-ignore */ join(CARPETA, 'construir.mjs'))) as {
  cargarDatos: (a: string, dir?: string) => J; validarDatos: (d: J, a: string) => void; guardias: (entrada: string, flujo: J, datos?: J, destino?: string) => string[];
  construir: (o?: J) => { resultado: J[]; huerfanos: string[] }; salidaDe: (a: string) => string;
};

describe('el armador: datos y salida del ensayo en el Demo A', () => {
  it('arma tres salidas al día (73 nodos cada una), con la del ensayo con el miniCRM conectado y su Trigger', () => {
    const r = CONSTRUIR.construir({ verificar: true });
    expect(r.resultado.map((x) => [x.archivo, x.alDia, x.versionado, x.nodos])).toEqual([
      ['chat-novuchat.ensayo-demo-a.json', true, [], 73],
      ['chat-novuchat.prueba.json', true, [], 73],
      ['chat-novuchat.novuchat.json', true, [], 73],
    ]);
    expect(r.huerfanos).toEqual([]);
    expect(CONSTRUIR.salidaDe('ensayo-demo-a.json')).toBe('chat-novuchat.ensayo-demo-a.json');
  });

  it('0 nodos nuevos: el ensayo tiene los MISMOS nodos que producción y solo difieren «Config base» y los nombres de credencial', () => {
    const e = leerJson(ENSAYO);
    const p = leerJson(join(CARPETA, 'chat-novuchat.novuchat.json'));
    expect((e.nodes as J[]).map((n) => n.name)).toEqual((p.nodes as J[]).map((n) => n.name));
    expect(e.connections).toEqual(p.connections);
    for (const n of e.nodes as J[]) {
      const o = nodo(p, n.name as string);
      if (n.name !== 'Config base') expect(n.parameters, n.name).toEqual(o.parameters);
      expect(n.type, n.name).toBe(o.type);
    }
    expect(nodo(e, 'WhatsApp Trigger').credentials.whatsAppTriggerApi.name).toBe('WhatsApp OAuth account');
  });

  it('la hoja es de PRUEBA: marcadores propios del ensayo, la credencial de hoja del ensayo y ningún marcador de producción', () => {
    const e = leerJson(ENSAYO);
    const b = baseDe(e);
    expect(b['planillaProspectosId']).toBe('REEMPLAZAR_PLANILLA_ENSAYO_ID');
    expect(b['planillaProspectosHoja']).toBe('REEMPLAZAR_PLANILLA_ENSAYO_HOJA');
    expect(b['numeroRecepcion']).toBe('REEMPLAZAR_NUMERO_AVISO_ENSAYO');
    expect(b['phoneNumberIdEsperado']).toBe('REEMPLAZAR_PHONE_NUMBER_ID');
    expect(JSON.stringify(e)).not.toMatch(/REEMPLAZAR_(PLANILLA_PROSPECTOS|PHONE_NUMBER_ID_|NUMERO_RECEPCION_)/);
    for (const n of HOJAS) expect(nodo(e, n).credentials.googleApi.name, n).toBe(CRED_ENSAYO);
    // y ninguna credencial de Meta ni de la consola que no sea la del Demo A
    expect(JSON.stringify(e)).not.toMatch(/NovuChat ingesta \(alias|Graph WhatsApp NovuChat|WhatsApp Trigger NovuChat|Google Sheets NovuChat/);
  });

  it('producción y prueba NO llevan nada del ensayo (ni marcadores ni la credencial de hoja): 0 cambios en lo vivo', () => {
    for (const f of ['chat-novuchat.novuchat.json', 'chat-novuchat.prueba.json']) {
      const t = readFileSync(join(CARPETA, f), 'utf8');
      expect(t, f).not.toMatch(/REEMPLAZAR_(PLANILLA_ENSAYO|NUMERO_AVISO_ENSAYO)|REEMPLAZAR_PHONE_NUMBER_ID"|miniCRM \(ensayo\)/);
    }
    expect(nodo(leerJson(join(CARPETA, 'chat-novuchat.novuchat.json')), 'Agregar fila').credentials.googleApi.name).toBe('Google Sheets NovuChat (cuenta de servicio)');
  });

  describe('negando (validarDatos)', () => {
    const ensayo = (): J => CONSTRUIR.cargarDatos('ensayo-demo-a.json');
    const falla = (d: J, archivo: string, campo: RegExp): void => { expect(() => CONSTRUIR.validarDatos(d, archivo)).toThrow(campo); };

    it('los datos del ensayo, tal cual, son válidos', () => { expect(() => CONSTRUIR.validarDatos(ensayo(), 'ensayo-demo-a.json')).not.toThrow(); });
    it('el ensayo con la hoja o el id de PRODUCCIÓN (el marcador real de prospectos) falla', () => {
      const d = ensayo(); d.configBase.planillaProspectosId = 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID';
      falla(d, 'ensayo-demo-a.json', /planillaProspectosId.*marcador de ensayo/);
      const h = ensayo(); h.configBase.planillaProspectosHoja = 'REEMPLAZAR_PLANILLA_PROSPECTOS_HOJA';
      falla(h, 'ensayo-demo-a.json', /planillaProspectosHoja.*marcador de ensayo/);
    });
    it('el ensayo con un id de planilla literal (el valor en el repositorio) falla', () => {
      const d = ensayo(); d.configBase.planillaProspectosId = 'A'.repeat(44);
      falla(d, 'ensayo-demo-a.json', /planillaProspectosId.*marcador de ensayo/);
    });
    it('el ensayo con el número o el phone id de producción falla', () => {
      const a = ensayo(); a.configBase.numeroRecepcion = 'REEMPLAZAR_NUMERO_RECEPCION_NOVUCHAT';
      falla(a, 'ensayo-demo-a.json', /marcador de producción/);
      const b = ensayo(); b.configBase.phoneNumberIdEsperado = 'REEMPLAZAR_PHONE_NUMBER_ID_NOVUCHAT';
      falla(b, 'ensayo-demo-a.json', /marcador de producción/);
    });
    it('el ensayo exige EXACTOS los marcadores del aviso y del phone id (ni un valor literal ni otro marcador)', () => {
      const a = ensayo(); a.configBase.numeroRecepcion = `59${'7'.repeat(7)}`;
      falla(a, 'ensayo-demo-a.json', /numeroRecepcion.*REEMPLAZAR_NUMERO_AVISO_ENSAYO/);
      const b = ensayo(); b.configBase.phoneNumberIdEsperado = '1234'.repeat(3) + '567';
      falla(b, 'ensayo-demo-a.json', /phoneNumberIdEsperado.*REEMPLAZAR_PHONE_NUMBER_ID/);
      const c = ensayo(); c.configBase.phoneNumberIdEsperado = 'REEMPLAZAR_OTRO_PHONE';
      falla(c, 'ensayo-demo-a.json', /phoneNumberIdEsperado.*REEMPLAZAR_PHONE_NUMBER_ID/);
    });
    it('el ensayo con la credencial de hoja de producción (o cualquier otra) falla', () => {
      const d = ensayo(); d.credenciales.planilla = 'Google Sheets NovuChat (cuenta de servicio)';
      falla(d, 'ensayo-demo-a.json', /credenciales\.planilla.*Google Sheets miniCRM \(ensayo\)/);
    });
    it('el ensayo con entrada «prueba» falla (la herramienta pone el Trigger del Demo A)', () => {
      const d = ensayo(); d.entrada = 'prueba';
      falla(d, 'ensayo-demo-a.json', /entrada.*trigger/);
    });
    it('a la inversa: ningún otro archivo de datos puede llevar los marcadores ni la credencial del ensayo (aunque los herede)', () => {
      for (const archivo of ['novuchat.json', 'ensayo.json', 'ensayo-otro.json']) {
        const base = clonar(CONSTRUIR.cargarDatos(archivo === 'ensayo-otro.json' ? 'ensayo.json' : archivo));
        if (archivo === 'ensayo-otro.json') base.entrada = 'trigger';
        const a = clonar(base); a.configBase.planillaProspectosId = 'REEMPLAZAR_PLANILLA_ENSAYO_ID';
        falla(a, archivo, /solo ensayo-demo-a\.json puede llevarlos/);
        const b = clonar(base); b.configBase.numeroRecepcion = 'REEMPLAZAR_NUMERO_AVISO_ENSAYO';
        falla(b, archivo, /solo ensayo-demo-a\.json puede llevarlos/);
        const c = clonar(base); c.configBase.phoneNumberIdEsperado = 'REEMPLAZAR_PHONE_NUMBER_ID';
        falla(c, archivo, /solo ensayo-demo-a\.json puede llevarlos/);
        const d = clonar(base); d.credenciales.planilla = CRED_ENSAYO;
        falla(d, archivo, /solo ensayo-demo-a\.json puede llevarlos/);
      }
    });
    it('los datos reales del repositorio no traen un id de planilla ni un teléfono (solo marcadores)', () => {
      const t = readFileSync(join(DATOS_DIR, 'ensayo-demo-a.json'), 'utf8');
      expect(t).not.toMatch(/[A-Za-z0-9_-]{40,}/);
      expect(t).not.toMatch(/\b59\d{7,}\b/);
    });
  });

  describe('negando (guardias de lo armado y de lo versionado)', () => {
    const e = (): J => leerJson(ENSAYO);
    const D = (): J => ({ crm: CONSTRUIR.cargarDatos('ensayo-demo-a.json')['crm'] });
    const SALIDA = 'chat-novuchat.ensayo-demo-a.json';
    const poner = (w: J, campo: string, valor: string): void => { for (const a of nodo(w, 'Config base').parameters.assignments.assignments as J[]) if (a.name === campo) a.value = valor; };

    it('el ensayo armado no tiene hallazgos', () => { expect(CONSTRUIR.guardias('trigger', e(), D(), SALIDA)).toEqual([]); });
    it('el ensayo con la hoja de producción, o con un id literal, es un hallazgo', () => {
      const a = e(); poner(a, 'planillaProspectosId', 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID');
      expect(CONSTRUIR.guardias('trigger', a, D(), SALIDA).join(' ')).toMatch(/planillaProspectosId tiene que ser el marcador «REEMPLAZAR_PLANILLA_ENSAYO_ID»/);
      const b = e(); poner(b, 'planillaProspectosHoja', 'Hoja real');
      expect(CONSTRUIR.guardias('trigger', b, D(), SALIDA).join(' ')).toMatch(/planillaProspectosHoja tiene que ser el marcador/);
    });
    it('el ensayo con un marcador de producción en «Config base» es un hallazgo', () => {
      const a = e(); poner(a, 'numeroRecepcion', 'REEMPLAZAR_NUMERO_RECEPCION_NOVUCHAT');
      expect(CONSTRUIR.guardias('trigger', a, D(), SALIDA).join(' ')).toMatch(/trae un marcador de producción/);
    });
    it('el ensayo con una hoja con la credencial de producción, o sin el miniCRM, es un hallazgo', () => {
      const a = e(); nodo(a, 'Agregar fila').credentials.googleApi.name = 'Google Sheets NovuChat (cuenta de servicio)';
      expect(CONSTRUIR.guardias('trigger', a, D(), SALIDA).join(' ')).toMatch(/tienen que usar «Google Sheets miniCRM \(ensayo\)»/);
      const b = e(); b.nodes = (b.nodes as J[]).filter((n) => n.type !== 'n8n-nodes-base.googleSheets');
      expect(CONSTRUIR.guardias('trigger', b, D(), SALIDA).join(' ')).toMatch(/miniCRM tiene que estar conectado/);
    });
    it('fuera del ensayo, las credenciales del Demo A son un hallazgo', () => {
      const prod = leerJson(join(CARPETA, 'chat-novuchat.novuchat.json'));
      const Dp = { crm: D().crm };
      for (const [nodoNombre, tipo, nombre] of [['WhatsApp Trigger', 'whatsAppTriggerApi', 'WhatsApp OAuth account'], ['Traer configuración', 'httpHeaderAuth', 'Cierres NovuChat A (auto)'], ['Enviar a WhatsApp', 'httpHeaderAuth', 'Graph WhatsApp Demo A (Bearer)']] as const) {
        const a = clonar(prod); nodo(a, nodoNombre).credentials[tipo].name = nombre;
        expect(CONSTRUIR.guardias('trigger', a, Dp, 'chat-novuchat.novuchat.json').join(' '), nombre).toMatch(/usa credenciales del Demo A .*solo chat-novuchat\.ensayo-demo-a\.json puede llevarlas/);
      }
      // y el ensayo con ellas no es hallazgo
      expect(CONSTRUIR.guardias('trigger', e(), D(), SALIDA)).toEqual([]);
    });
    it('el ensayo con un teléfono o phone id literal en «Config base» es un hallazgo', () => {
      const a = e(); poner(a, 'numeroRecepcion', `59${'7'.repeat(7)}`);
      expect(CONSTRUIR.guardias('trigger', a, D(), SALIDA).join(' ')).toMatch(/numeroRecepcion tiene que ser el marcador «REEMPLAZAR_NUMERO_AVISO_ENSAYO»/);
      const b = e(); poner(b, 'phoneNumberIdEsperado', '1234'.repeat(3) + '567');
      expect(CONSTRUIR.guardias('trigger', b, D(), SALIDA).join(' ')).toMatch(/phoneNumberIdEsperado tiene que ser el marcador «REEMPLAZAR_PHONE_NUMBER_ID»/);
    });
    it('una salida que no es la del ensayo con un marcador o la credencial del ensayo es un hallazgo', () => {
      const prod = leerJson(join(CARPETA, 'chat-novuchat.novuchat.json'));
      const Dp = { crm: D().crm };
      expect(CONSTRUIR.guardias('trigger', prod, Dp, 'chat-novuchat.novuchat.json')).toEqual([]);
      const a = clonar(prod); poner(a, 'planillaProspectosId', 'REEMPLAZAR_PLANILLA_ENSAYO_ID');
      expect(CONSTRUIR.guardias('trigger', a, Dp, 'chat-novuchat.novuchat.json').join(' ')).toMatch(/solo chat-novuchat\.ensayo-demo-a\.json puede llevarlos/);
      const b = clonar(prod); nodo(b, 'Agregar fila').credentials.googleApi.name = CRED_ENSAYO;
      expect(CONSTRUIR.guardias('trigger', b, Dp, 'chat-novuchat.novuchat.json').join(' ')).toMatch(/solo chat-novuchat\.ensayo-demo-a\.json puede llevarlos/);
      const c = clonar(prod); poner(c, 'phoneNumberIdEsperado', 'REEMPLAZAR_PHONE_NUMBER_ID');
      expect(CONSTRUIR.guardias('trigger', c, Dp, 'chat-novuchat.novuchat.json').join(' ')).toMatch(/solo chat-novuchat\.ensayo-demo-a\.json puede llevarlos/);
    });
  });
});

// ---------------------------------------------------------------------------------- la herramienta, contra un n8n de mentira
const PHONE_ID = '1' + '0'.repeat(11) + '042'; // armados en ejecución: ningún literal de 10 dígitos en el repositorio
const AVISO = '591' + '0'.repeat(5) + '21';
const PLANILLA = 'PruebaDePlanillaSintetica0123abcdef'; // sintético, 35 caracteres
const HOJA = 'Hoja de prueba';
const NOMBRE_DEMO_A = 'NovuChat Demo A — Agendamiento (Belleza y Salud)';
const CREDENCIALES: { id: string; name: string; type: string }[] = [
  { id: 'c-gem', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi' },
  { id: 'c-cal', name: 'Google Calendar account', type: 'googleCalendarOAuth2Api' },
  { id: 'c-hdr', name: 'Cierres NovuChat A (auto)', type: 'httpHeaderAuth' },
  { id: 'c-wa', name: 'WhatsApp account', type: 'whatsAppApi' },
  { id: 'c-trg', name: 'WhatsApp OAuth account', type: 'whatsAppTriggerApi' },
  { id: 'c-hoja', name: CRED_ENSAYO, type: 'googleApi' }, // el Demo A vivo NO la usa
];
const TIPO_POR_NODO: Record<string, string> = {
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': 'googlePalmApi', '@n8n/n8n-nodes-langchain.googleGemini': 'googlePalmApi',
  'n8n-nodes-base.googleCalendar': 'googleCalendarOAuth2Api', 'n8n-nodes-base.googleCalendarTool': 'googleCalendarOAuth2Api',
  'n8n-nodes-base.whatsApp': 'whatsAppApi', 'n8n-nodes-base.whatsAppTrigger': 'whatsAppTriggerApi',
};
function demoAVivo(): J {
  const w = leerJson(DEMO_A);
  w.id = 'wf1'; w.active = true; w.versionId = 'v1'; w.activeVersionId = 'v1';
  w.settings = { executionOrder: 'v1', timezone: 'America/La_Paz' };
  for (const n of w.nodes as J[]) {
    const tipo = TIPO_POR_NODO[n.type as string];
    if (tipo && !(n.credentials && n.credentials[tipo])) n.credentials = { ...(n.credentials ?? {}), [tipo]: {} };
    for (const [t, c] of Object.entries((n.credentials ?? {}) as J)) {
      const nombre = String((c as J).name ?? '');
      const h = CREDENCIALES.find((x) => x.type === t && x.name === nombre) ?? CREDENCIALES.find((x) => x.type === t)!;
      n.credentials[t] = { id: h.id, name: h.name };
    }
    if (n.type === 'n8n-nodes-base.whatsAppTrigger') n.webhookId = 'webhook-del-demo-a';
  }
  return w;
}

let flujoVivo: J; let puts: J[]; let credenciales = CREDENCIALES;
let servidor: Server; let carpeta = ''; let secuencia = 0; let archivoEnv = '.env.falso';
const leerCuerpo = (r: IncomingMessage): Promise<string> => new Promise((ok) => { const t: Buffer[] = []; r.on('data', (c: Buffer) => { t.push(c); }); r.on('end', () => ok(Buffer.concat(t).toString('utf8'))); });
const nuevo = (cr = CREDENCIALES): void => { flujoVivo = demoAVivo(); puts = []; credenciales = cr; };
const respaldoNuevo = (): string => join(carpeta, `respaldo-${++secuencia}.json`);

/** Lo que deja `preparar-import.sh`: los marcadores del ensayo, repuestos (aquí con valores sintéticos). */
const preparado = (cambia: (t: string) => string = (t) => t): string => cambia(readFileSync(ENSAYO, 'utf8')
  .replaceAll('REEMPLAZAR_PHONE_NUMBER_ID', PHONE_ID).replaceAll('REEMPLAZAR_NUMERO_AVISO_ENSAYO', AVISO)
  .replaceAll('REEMPLAZAR_PLANILLA_ENSAYO_ID', PLANILLA).replaceAll('REEMPLAZAR_PLANILLA_ENSAYO_HOJA', HOJA));

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'chat-ensayo-demo-a-'));
  servidor = createServer((req, res) => {
    void (async () => {
      const cuerpo = await leerCuerpo(req);
      const enviar = (cod: number, datos: unknown): void => { res.writeHead(cod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
      if (req.method === 'GET' && req.url === '/api/v1/workflows/wf1') return enviar(200, flujoVivo);
      if (req.method === 'GET' && String(req.url).startsWith('/api/v1/credentials')) return enviar(200, { data: credenciales });
      if (req.method === 'PUT' && req.url === '/api/v1/workflows/wf1') {
        const b = JSON.parse(cuerpo) as J; puts.push(b);
        flujoVivo = { ...flujoVivo, name: b.name, nodes: b.nodes, connections: b.connections, settings: b.settings, versionId: 'vN', activeVersionId: 'vN' };
        return enviar(200, flujoVivo);
      }
      return enviar(404, { message: 'no existe' });
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  const base = `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\nWA_PHONE_ID=${PHONE_ID}\n`;
  // el normal trae un id de producción DISTINTO del de la hoja de prueba; el de «sin-produccion» no trae ninguno
  writeFileSync(join(carpeta, '.env.falso'), `${base}PLANILLA_PROSPECTOS_ID_NOVUCHAT=OtraPlanillaSinteticaDeProduccion0123\n`);
  writeFileSync(join(carpeta, '.env.sin-produccion'), base);
  chmodSync(join(carpeta, '.env.sin-produccion'), 0o600);
  chmodSync(join(carpeta, '.env.falso'), 0o600);
  // un .env que SÍ trae el id de la hoja real de producción (sintético) para la comparación
  writeFileSync(join(carpeta, '.env.con-produccion'), `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=clave-falsa-de-prueba\nN8N_WORKFLOW_ID=wf1\nWA_PHONE_ID=${PHONE_ID}\nPLANILLA_PROSPECTOS_ID_NOVUCHAT=${PLANILLA}\n`);
  chmodSync(join(carpeta, '.env.con-produccion'), 0o600);
  writeFileSync(join(carpeta, 'chat-otro-fono.json'), preparado((t) => t.replaceAll(PHONE_ID, '1' + '0'.repeat(11) + '099')));
  writeFileSync(join(carpeta, 'chat.local.json'), preparado());
  writeFileSync(join(carpeta, 'chat-con-marcadores.json'), readFileSync(ENSAYO, 'utf8'));
  writeFileSync(join(carpeta, 'chat-sin-id.json'), preparado((t) => t.replaceAll(PLANILLA, '')));
  writeFileSync(join(carpeta, 'chat-sin-hoja.json'), preparado((t) => t.replaceAll(`"${HOJA}"`, '""')));
  writeFileSync(join(carpeta, 'chat-cred-real.json'), preparado((t) => t.replaceAll(CRED_ENSAYO, 'Google Sheets NovuChat (cuenta de servicio)')));
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(carpeta, { recursive: true, force: true }); });

async function correr(args: string[]): Promise<{ codigo: number; salida: string }> {
  try {
    const r = await ejecutar(process.execPath, [HERRAMIENTA, '--env', join(carpeta, archivoEnv), '--estado', join(carpeta, 'estado.json'), ...args], { env: entornoDelEmulador(undefined), encoding: 'utf8' });
    return { codigo: 0, salida: r.stdout + r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { codigo: x.code, salida: x.stdout + x.stderr };
  }
}
const sobreDemoA = (extra: string[] = [], flujo = 'chat.local.json', conservar = true, autoriza = true) =>
  correr(['--sobre-demo-a', '--respaldo', respaldoNuevo(), '--flujo', join(carpeta, flujo), ...(conservar ? ['--conservar-crm'] : []),
    ...(extra.includes('--aplicar') ? ['--autorizo-gemini-produccion', ...(autoriza ? ['--autorizo-hoja-de-prueba'] : [])] : []), ...extra]);

describe('la herramienta con --conservar-crm (n8n de mentira)', () => {
  it('en seco: el miniCRM se CONSERVA, la hoja de prueba no se muestra y no se escribe en n8n', async () => {
    nuevo();
    const r = await sobreDemoA();
    expect(r.codigo, r.salida).toBe(0);
    expect(puts).toHaveLength(0);
    expect(r.salida).toContain('miniCRM CONSERVADO');
    expect(r.salida).not.toMatch(/Nodos quitados del candidato/);
    for (const n of HOJAS) expect(r.salida).toContain(`${n}: googleApi → «${CRED_ENSAYO}» (de la lista de n8n; hoja de PRUEBA)`);
    expect(r.salida).toContain('Marcadores que quedan (solo respaldo de «Config base»; el panel de «ensayo» manda): —');
    // ni el id de la hoja, ni el teléfono, ni el phone id salen por pantalla
    for (const v of [PLANILLA, AVISO, PHONE_ID]) expect(r.salida).not.toContain(v);
  });

  it('con --aplicar: los 4 nodos de Google quedan con la credencial del ensayo por id, el id de la hoja llega a «Config base» y todo lo demás es del Demo A', async () => {
    nuevo();
    const r = await sobreDemoA(['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(puts).toHaveLength(1);
    const b = puts[0]!;
    expect((b.nodes as J[]).length).toBe(73);
    for (const n of HOJAS) expect(nodo(b, n).credentials.googleApi, n).toEqual({ id: 'c-hoja', name: CRED_ENSAYO });
    expect(baseDe(b)['planillaProspectosId']).toBe(PLANILLA);
    expect(baseDe(b)['planillaProspectosHoja']).toBe(HOJA);
    expect(baseDe(b)['phoneNumberIdEsperado']).toBe(PHONE_ID);
    expect(nodo(b, 'WhatsApp Trigger')).toEqual(nodo(demoAVivo(), 'WhatsApp Trigger'));
    // la ingesta se mapea a la del Demo A y los envíos por Graph pasan a la predefinida
    expect(nodo(b, 'Reportar mensaje (entrante)').credentials.httpHeaderAuth).toEqual({ id: 'c-hdr', name: 'Cierres NovuChat A (auto)' });
    expect(nodo(b, 'Enviar a WhatsApp').credentials).toEqual({ whatsAppApi: { id: 'c-wa', name: 'WhatsApp account' } });
    // ningún nodo con credencial vacía y ningún nombre de producción
    for (const n of (b.nodes as J[]).filter((x) => x.credentials)) for (const c of Object.values(n.credentials as J)) expect((c as J).id, n.name).toBeTruthy();
    expect(JSON.stringify(b)).not.toMatch(/alias del número|Graph WhatsApp NovuChat|Google Sheets NovuChat/);
    // (el código de los nodos nombra `REEMPLAZAR_` para descartarlo: no cuenta; lo que cuenta es «Config base»)
    expect(Object.values(baseDe(b)).filter((v) => /^REEMPLAZAR_/.test(String(v)))).toEqual([]);
  });

  it('se NIEGA, sin ningún PUT: sin --autorizo-hoja-de-prueba en --aplicar', async () => {
    nuevo();
    const r = await sobreDemoA(['--aplicar'], 'chat.local.json', true, false);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/exige --autorizo-hoja-de-prueba/);
    expect(puts).toHaveLength(0);
  });
  it('se NIEGA: --conservar-crm fuera de --sobre-demo-a', async () => {
    nuevo();
    const r = await correr(['--restaurar-respaldo', '--respaldo', respaldoNuevo(), '--conservar-crm']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/--conservar-crm solo se usa con --sobre-demo-a/);
    expect(puts).toHaveLength(0);
  });
  it('se NIEGA: con los marcadores sin reponer, con el id vacío o con la hoja vacía', async () => {
    nuevo();
    const m = await sobreDemoA(['--aplicar'], 'chat-con-marcadores.json');
    expect(m.codigo).toBe(1);
    expect(m.salida).toMatch(/planillaProspectosId no es un id de planilla resuelto/);
    const i = await sobreDemoA(['--aplicar'], 'chat-sin-id.json');
    expect(i.codigo).toBe(1);
    expect(i.salida).toMatch(/planillaProspectosId no es un id de planilla resuelto/);
    const h = await sobreDemoA(['--aplicar'], 'chat-sin-hoja.json');
    expect(h.codigo).toBe(1);
    expect(h.salida).toMatch(/planillaProspectosHoja no está resuelta/);
    expect(puts).toHaveLength(0);
  });
  it('se NIEGA: con la credencial de hoja de producción (la de los prospectos reales)', async () => {
    nuevo();
    const r = await sobreDemoA(['--aplicar'], 'chat-cred-real.json');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/la única credencial de hoja permitida es «Google Sheets miniCRM \(ensayo\)»/);
    expect(puts).toHaveLength(0);
  });
  it('se NIEGA: si la credencial del ensayo no existe en n8n, o existe dos veces', async () => {
    nuevo(CREDENCIALES.filter((c) => c.id !== 'c-hoja'));
    const falta = await sobreDemoA(['--aplicar']);
    expect(falta.codigo).toBe(1);
    expect(falta.salida).toMatch(/tiene que existir en n8n exactamente una vez; hay 0/);
    nuevo([...CREDENCIALES, { id: 'c-hoja-2', name: CRED_ENSAYO, type: 'googleApi' }]);
    const doble = await sobreDemoA(['--aplicar']);
    expect(doble.codigo).toBe(1);
    expect(doble.salida).toMatch(/hay 2/);
    expect(puts).toHaveLength(0);
  });
});

describe('la herramienta con --conservar-crm: la hoja y el número de PRODUCCIÓN no se tocan', () => {
  it('se NIEGA si el id de la planilla es igual al de producción (sin imprimir ninguno de los dos)', async () => {
    nuevo(); archivoEnv = '.env.con-produccion';
    try {
      const r = await sobreDemoA(['--aplicar']);
      expect(r.codigo).toBe(1);
      expect(r.salida).toMatch(/IGUAL al de la hoja real de prospectos de producción/);
      expect(r.salida).not.toContain(PLANILLA);
      expect(puts).toHaveLength(0);
    } finally { archivoEnv = '.env.falso'; }
  });
  it('FALLA CERRADO: sin PLANILLA_PROSPECTOS_ID_NOVUCHAT en el .env ni en el entorno se niega, incluso en seco, y dice cómo reponerla', async () => {
    nuevo(); archivoEnv = '.env.sin-produccion';
    try {
      for (const extra of [[], ['--aplicar']]) {
        const r = await sobreDemoA(extra);
        expect(r.codigo, r.salida).toBe(1);
        expect(r.salida).toMatch(/falta PLANILLA_PROSPECTOS_ID_NOVUCHAT/);
        expect(r.salida).toMatch(/sin mostrar el valor/);
        expect(r.salida).not.toContain(PLANILLA);
      }
      expect(puts).toHaveLength(0);
    } finally { archivoEnv = '.env.falso'; }
  });
  it('se NIEGA si la credencial del ensayo comparte id con la de los prospectos reales', async () => {
    nuevo([...CREDENCIALES, { id: 'c-hoja', name: 'Google Sheets NovuChat (cuenta de servicio)', type: 'googleApi' }]);
    const r = await sobreDemoA(['--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/comparte id con otra credencial de hoja/);
    expect(puts).toHaveLength(0);
    // la misma lista con ids distintos sí pasa
    nuevo([...CREDENCIALES, { id: 'c-hoja-real', name: 'Google Sheets NovuChat (cuenta de servicio)', type: 'googleApi' }]);
    expect((await sobreDemoA(['--aplicar'])).codigo).toBe(0);
  });
  it('se NIEGA si phoneNumberIdEsperado no es el phone id del Demo A (WA_PHONE_ID)', async () => {
    nuevo();
    const r = await sobreDemoA(['--aplicar'], 'chat-otro-fono.json');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/phoneNumberIdEsperado no es el phone id del Demo A/);
    expect(puts).toHaveLength(0);
  });
});

describe('publicar-flujo.sh no publica el ensayo del chat', () => {
  it('rechaza chat-novuchat.ensayo-demo-a.json y su .local.json (exit 2) y no rechaza por ese motivo otro archivo', () => {
    const raiz = join(aqui, '../..');
    for (const f of ['chat-novuchat.ensayo-demo-a.json', 'chat-novuchat.ensayo-demo-a.local.json']) {
      const r = spawnSync('bash', [join(raiz, 'scripts/publicar-flujo.sh'), '--flujo', join(raiz, 'Flujos/experimental/chat-novuchat', f)], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
      expect(r.status, f).toBe(2);
      expect(r.stderr, f).toMatch(/es el ensayo del chat en el Demo A y no se publica/);
    }
    const otro = spawnSync('bash', [join(raiz, 'scripts/publicar-flujo.sh'), '--flujo', join(raiz, 'Flujos/experimental/chat-novuchat/chat-novuchat.prueba.json')], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(otro.stderr).not.toMatch(/es el ensayo del chat en el Demo A/);
  });
});

describe('sin la bandera el comportamiento de siempre NO cambia', () => {
  it('se quita la rama del miniCRM y el id de la planilla queda vacío; no se pide ninguna credencial de hoja', async () => {
    nuevo(CREDENCIALES.filter((c) => c.id !== 'c-hoja'));
    const r = await sobreDemoA(['--aplicar'], 'chat.local.json', false);
    expect(r.codigo, r.salida).toBe(0);
    const b = puts[0]!;
    for (const n of HOJAS) expect((b.nodes as J[]).some((x) => x.name === n), n).toBe(false);
    expect(baseDe(b)['planillaProspectosId']).toBe('');
    expect(r.salida).toMatch(/Nodos quitados del candidato: 6/);
    expect(r.salida).not.toMatch(/miniCRM CONSERVADO/);
  });
  it('un flujo con la credencial de hoja y sin la bandera sigue sin estar en la tabla del Demo A (el candidato que la trae y conserva sus nodos de Google se niega)', async () => {
    nuevo();
    // un candidato con un nodo de Google que NO está en la lista de la rama del CRM de Bellido: sin bandera, su credencial googleApi no está en la tabla
    const w = readFileSync(join(carpeta, 'chat.local.json'), 'utf8');
    const j = JSON.parse(w) as J;
    nodo(j, 'Agregar fila').name = 'Agregar fila de otra cosa';
    j.connections = JSON.parse(JSON.stringify(j.connections).replaceAll('"Agregar fila"', '"Agregar fila de otra cosa"')) as J;
    j.connections['Agregar fila de otra cosa'] = j.connections['Agregar fila'];
    delete j.connections['Agregar fila'];
    writeFileSync(join(carpeta, 'chat-otro-nodo.json'), JSON.stringify(j));
    const r = await sobreDemoA(['--aplicar'], 'chat-otro-nodo.json', false);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/googleApi «Google Sheets miniCRM \(ensayo\)», que no está en la tabla de credenciales del Demo A/);
    expect(puts).toHaveLength(0);
  });
});

void NOMBRE_DEMO_A;
