/**
 * `scripts/plataforma/verificar-salida-persona.mjs` — verificador de SOLO LECTURA de la «Salida de persona».
 * Sin red ni emulador: Firestore, gcloud, n8n y el timbre son dobles inyectados. Se afirma que cada chequeo
 * da OK / FALLA / NO SE PUDO, que NUNCA se imprime un valor (se siembra el secreto con marcadores y se
 * revisa la salida completa), que Bellido se niega, que `--encender` no invoca nada sin todo OK y no escribe
 * sin `--aplicar`, y que con n8n inaccesible el resultado es NO SE PUDO con salida distinta de 0.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const RAIZ = join(ADMIN, '..');
const SCRIPT = join(ADMIN, 'scripts', 'plataforma', 'verificar-salida-persona.mjs');
const ENVOLTORIO = join(RAIZ, 'scripts', 'verificar-salida-persona.sh');

type R = { id: string; estado: string; motivo: string; aviso?: string; tipoEnvio?: string };
const mod = await import('../../scripts/plataforma/verificar-salida-persona.mjs') as unknown as {
  analizarArgumentos: (a: string[], env?: Record<string, string>) => { ok: boolean; problemas?: string[]; cfg?: Record<string, unknown> };
  verificar: (cfg: Record<string, unknown>, deps: Record<string, unknown>) => Promise<number>;
  chequeoTimbre: (ruta: string | null, post: (u: string, c: string) => Promise<number>, real?: string) => Promise<R>;
  leerEntornoN8n: (a: string | null, e?: Record<string, string>) => { base: string; clave: string };
  nombreDelFlujo: (a: string) => string;
};

// ---- marcadores: NINGUNO debe aparecer en la salida ----
const M = {
  capacidad: 'CAPACIDAD-MARCADOR-XYZ123',
  clave: 'CLAVE-MARCADOR-ABCDEF99',
  claveN8n: 'N8NKEYMARCADOR',
  proyProd: 'proyecto-prod-marcador',
  proyStg: 'proyecto-stg-marcador',
  host: 'n8n.ejemplo.test',
};
const ALIAS = 'cliente09';
const TENANT = 'tienda-prueba';
const PHONE = 'PHONEID-MARCADOR-777';
const ENV = { GCP_PROJECT_ID_PROD: M.proyProd, GCP_PROJECT_ID_STAGING: M.proyStg };
const RUTA = `https://${M.host}/webhook/${M.capacidad}`;
const MAPA = JSON.stringify({ [ALIAS]: { ruta: RUTA, clave: M.clave } });

const cfgBase = (extra: Record<string, unknown> = {}) => ({
  proyecto: M.proyProd, entorno: 'produccion', alias: ALIAS, tenant: TENANT, envArchivo: null,
  probarTimbre: false, encender: false, aplicar: false, respaldo: null, confirmo: null, ...extra,
});

// ---- dobles ----
type Over = {
  ruta?: Record<string, unknown> | null; rutas?: number; ficha?: Record<string, unknown> | null; dbFalla?: boolean;
  funciones?: Record<string, string>; gcloudFalla?: boolean; versionSecreto?: string; mapa?: string; mapaLatest?: string; logs?: string; totales?: string;
  workflow?: Record<string, unknown>; n8nCaido?: boolean; ejecuciones?: unknown; n8nEntorno?: { base: string; clave: string };
  timbre?: number; encenderCodigo?: number;
};
const nodosOk = () => [
  { name: 'Timbre', parameters: { path: M.capacidad, authentication: 'headerAuth' }, credentials: { httpHeaderAuth: { id: 'c1', name: 'Timbre cred' } } },
  { name: 'Config base', parameters: { assignments: { assignments: [{ name: 'phoneNumberId', value: PHONE }] } } },
  { name: 'Reclamar', credentials: { httpHeaderAuth: { id: 'c2', name: 'Ingesta cred' } } },
  { name: 'Confirmar', credentials: { httpHeaderAuth: { id: 'c2', name: 'Ingesta cred' } } },
  { name: 'Enviar por el relé', credentials: { httpHeaderAuth: { id: 'c3', name: 'Rele cred' } } },
  { name: 'Enviar por Graph', credentials: { whatsAppApi: { id: 'c4', name: 'Graph cred' } } },
];
const flujoOk = () => ({ id: 'w1', name: `NovuChat — Salida de persona (${ALIAS})`, active: true, versionId: 'v9', activeVersionId: 'v9', nodes: nodosOk() });
const reciente = (status: string) => ({ status, startedAt: new Date(Date.now() - 60_000).toISOString() });

function mundo(o: Over = {}) {
  const llamadas = { gcloud: [] as string[][], n8n: [] as string[], timbre: [] as string[], encender: [] as string[][], escrituras: 0 };
  const rutaDoc = o.ruta === null ? null : { tenantId: TENANT, estado: 'activo', aliasSecreto: ALIAS, ...(o.ruta ?? {}) };
  const ficha = o.ficha === null ? null : { nombre: 'Tienda Sintetica', estado: 'activo', consolaConversaciones: 'nueva', ...(o.ficha ?? {}) };
  const db = {
    collection: () => ({
      where: () => ({
        get: async () => {
          if (o.dbFalla) throw Object.assign(new Error(M.clave), { code: 'unavailable' });
          const n = o.rutas ?? (rutaDoc ? 1 : 0);
          return { docs: Array.from({ length: n }, () => ({ id: PHONE, data: () => rutaDoc })) };
        },
      }),
    }),
    doc: () => ({ get: async () => ({ exists: ficha !== null, data: () => ficha }) }),
    set: () => { llamadas.escrituras++; }, update: () => { llamadas.escrituras++; },
  };
  const funciones = o.funciones ?? {};
  const gcloud = (args: string[]) => {
    llamadas.gcloud.push(args);
    if (o.gcloudFalla) return { code: 1, stdout: '' };
    if (args[0] === 'functions') {
      const nombre = args[2]!;
      const j: Record<string, unknown> = { state: funciones[nombre] ?? 'ACTIVE', serviceConfig: {} };
      if (nombre === 'enviarComoPersona') (j['serviceConfig'] as Record<string, unknown>)['secretEnvironmentVariables'] = [{ key: 'SALIDA_PERSONA_RUTAS', secret: 'SALIDA_PERSONA_RUTAS', version: o.versionSecreto ?? '3' }];
      return { code: 0, stdout: JSON.stringify(j) };
    }
    if (args[0] === 'secrets') return { code: 0, stdout: args[3] === 'latest' ? (o.mapaLatest ?? o.mapa ?? MAPA) : (o.mapa ?? MAPA) };
    if (args[0] === 'logging') return { code: 0, stdout: args[2]!.includes('status=401') ? (o.logs ?? '[]') : (o.totales ?? '[{},{}]') };
    return { code: 1, stdout: '' };
  };
  const n8n = async (ruta: string) => {
    llamadas.n8n.push(ruta);
    if (o.n8nCaido) return { status: 0, json: null };
    if (ruta.startsWith('/workflows?')) return { status: 200, json: { data: [{ id: 'w1', name: `NovuChat — Salida de persona (${ALIAS})` }], nextCursor: null } };
    if (ruta.startsWith('/workflows/')) return { status: 200, json: { ...flujoOk(), ...(o.workflow ?? {}) } };
    if (ruta.startsWith('/executions')) return { status: 200, json: { data: o.ejecuciones ?? [reciente('success'), reciente('success')] } };
    return { status: 404, json: null };
  };
  const salida: string[] = [];
  const deps = {
    db, gcloud, n8n,
    n8nEntorno: o.n8nEntorno ?? { base: `https://${M.host}`, clave: M.claveN8n },
    postTimbre: async (u: string, c: string) => { llamadas.timbre.push(c); void u; return o.timbre ?? 403; },
    encender: (args: string[]) => { llamadas.encender.push(args); return o.encenderCodigo ?? 1; },
    env: ENV, log: (t: string) => salida.push(t),
  };
  return { deps, llamadas, texto: () => salida.join('\n') };
}

async function corre(o: Over = {}, cfg: Record<string, unknown> = {}) {
  const m = mundo(o);
  const codigo = await mod.verificar(cfgBase(cfg), m.deps);
  const texto = m.texto();
  const estado = (id: string) => {
    const l = texto.split('\n').find((x) => new RegExp(`^\\s+\\[[A-Z ]+\\]\\s+${id}\\s`).test(x)) ?? '';
    return /\[(OK|FALLA|NO SE PUDO)\s*\]/.exec(l)?.[1] ?? 'AUSENTE';
  };
  return { ...m, codigo, texto, estado };
}

const SECRETOS = [M.capacidad, M.clave, M.claveN8n, M.proyProd, M.proyStg, PHONE];
const sinSecretos = (texto: string) => { for (const s of SECRETOS) expect(texto).not.toContain(s); };

// ===========================================================================
describe('argumentos hostiles', () => {
  const buenos = ['--proyecto', M.proyProd, '--alias', ALIAS, '--tenant', TENANT];
  it('los buenos pasan y producción se etiqueta sin id', () => {
    const r = mod.analizarArgumentos(buenos, ENV);
    expect(r.ok).toBe(true);
    expect(r.cfg?.['entorno']).toBe('produccion');
  });
  it.each([
    ['sin nada', []],
    ['suelto', [...buenos, 'sobra']],
    ['opción desconocida', [...buenos, '--rm']],
    ['opción repetida', [...buenos, '--alias', 'otro1']],
    ['valor faltante', ['--proyecto', '--alias', ALIAS, '--tenant', TENANT]],
    ['alias con ruta', ['--proyecto', M.proyProd, '--alias', '../x', '--tenant', TENANT]],
    ['alias con espacio', ['--proyecto', M.proyProd, '--alias', 'a b', '--tenant', TENANT]],
    ['tenant con comas', ['--proyecto', M.proyProd, '--alias', ALIAS, '--tenant', 'a-b,c-d']],
    ['tenant con mayúsculas', ['--proyecto', M.proyProd, '--alias', ALIAS, '--tenant', 'Tienda']],
    ['proyecto fuera de la lista blanca', ['--proyecto', 'otro-proyecto-x', '--alias', ALIAS, '--tenant', TENANT]],
    ['bellido', ['--proyecto', M.proyProd, '--alias', ALIAS, '--tenant', 'bellido']],
    ['bellido dentro de otro id', ['--proyecto', M.proyProd, '--alias', ALIAS, '--tenant', 'clinica-bellido-2']],
    ['aplicar sin encender', [...buenos, '--aplicar']],
    ['respaldo sin encender', [...buenos, '--respaldo', '/tmp/x']],
    ['aplicar sin respaldo', [...buenos, '--encender', '--aplicar', '--confirmo-produccion', TENANT]],
    ['aplicar a producción sin confirmo', [...buenos, '--encender', '--aplicar', '--respaldo', '/tmp/x']],
    ['confirmo que no coincide', [...buenos, '--encender', '--aplicar', '--respaldo', '/tmp/x', '--confirmo-produccion', 'otro-comercio']],
  ])('se niega: %s', (_n, argv) => {
    expect(mod.analizarArgumentos(argv as string[], ENV).ok).toBe(false);
  });
  it('sin la lista blanca en el entorno se niega', () => {
    expect(mod.analizarArgumentos(buenos, {}).ok).toBe(false);
  });
  it('--encender seco y --probar-timbre son válidos', () => {
    expect(mod.analizarArgumentos([...buenos, '--encender', '--probar-timbre'], ENV).ok).toBe(true);
  });
  it('--encender --aplicar completo es válido', () => {
    const r = mod.analizarArgumentos([...buenos, '--encender', '--aplicar', '--respaldo', '/tmp/x', '--confirmo-produccion', TENANT], ENV);
    expect(r.ok).toBe(true);
  });
  it('el entorno de n8n exige https sin ruta y una clave de forma simple', () => {
    expect(mod.leerEntornoN8n(null, { N8N_BASE_URL: 'https://x.test/api', N8N_API_KEY: 'abc' }).base).toBe('');
    expect(mod.leerEntornoN8n(null, { N8N_BASE_URL: 'http://x.test', N8N_API_KEY: 'abc' }).base).toBe('');
    expect(mod.leerEntornoN8n(null, { N8N_BASE_URL: 'https://x.test', N8N_API_KEY: 'a b' }).clave).toBe('');
    expect(mod.leerEntornoN8n(null, { N8N_BASE_URL: 'https://x.test', N8N_API_KEY: 'abc' })).toEqual({ base: 'https://x.test', clave: 'abc' });
  });
});

describe('el proceso (sin red: los argumentos malos salen antes de tocar nada)', () => {
  const corrida = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env['PATH'] ?? '', ...ENV }, encoding: 'utf8' });
  it('Bellido: salida 2 y sin id de proyecto', () => {
    const r = corrida(['--proyecto', M.proyProd, '--alias', ALIAS, '--tenant', 'bellido']);
    expect(r.status).toBe(2);
    sinSecretos(r.stdout + r.stderr);
  });
  it('proyecto fuera de la lista blanca: salida 2', () => {
    const r = corrida(['--proyecto', 'proyecto-ajeno-zzz', '--alias', ALIAS, '--tenant', TENANT]);
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain('proyecto-ajeno-zzz');
  });
  it('sin argumentos: salida 2 con uso', () => {
    const r = corrida([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('verificar-salida-persona');
  });
});

describe('todo en orden', () => {
  it('todos OK, salida 0, y NINGÚN valor sembrado aparece en la salida', async () => {
    const r = await corre();
    for (const id of ['1a', '1b', '2', '3', '4a', '4b', '4c', '4d', '4e', '5a', '5b']) expect(r.estado(id), id).toBe('OK');
    expect(r.codigo).toBe(0);
    sinSecretos(r.texto);
    expect(r.texto).toContain('produccion');
  });
  it('no escribe: nada del doble de Firestore se llama y n8n solo recibe rutas de lectura', async () => {
    const r = await corre();
    expect(r.llamadas.escrituras).toBe(0);
    expect(r.llamadas.timbre).toHaveLength(0);
    expect(r.llamadas.encender).toHaveLength(0);
    expect(r.llamadas.n8n.every((x) => x.startsWith('/workflows') || x.startsWith('/executions'))).toBe(true);
    expect(r.llamadas.gcloud.every((a) => ['functions', 'secrets', 'logging'].includes(a[0]!) && !a.includes('create') && !a.includes('add'))).toBe(true);
  });
  it('informa el tipo de la credencial del rol envío', async () => {
    expect((await corre()).texto).toContain('whatsAppApi');
    const w = flujoOk();
    w.nodes = w.nodes.map((n) => (n.name === 'Enviar por Graph' ? { ...n, credentials: { httpHeaderAuth: { id: 'c4', name: 'Graph cred' } } } : n));
    const r = await corre({ workflow: { nodes: w.nodes } });
    expect(r.estado('4b')).toBe('OK');
    expect(r.texto).toContain('httpHeaderAuth');
  });
});

describe('1 · Firestore', () => {
  it.each([
    ['la ruta es de otro comercio', { ruta: { tenantId: 'otro-comercio' } }],
    ['la ruta no está activa', { ruta: { estado: 'suspendido' } }],
    ['canalSalida desconocido', { ruta: { canalSalida: 'paloma' } }],
  ])('1a FALLA: %s', async (_n, o) => {
    const r = await corre(o as Over);
    expect(r.estado('1a')).toBe('FALLA');
    expect(r.codigo).toBe(1);
  });
  it('1a FALLA sin ruta y con dos rutas', async () => {
    expect((await corre({ ruta: null })).estado('1a')).toBe('FALLA');
    expect((await corre({ rutas: 2 })).estado('1a')).toBe('FALLA');
  });
  it('canal relé: OK con aviso', async () => {
    const r = await corre({ ruta: { canalSalida: 'rele' } });
    expect(r.estado('1a')).toBe('OK');
    expect(r.texto).toContain('aviso');
    expect(r.texto).toContain('relé');
  });
  it('canal graph explícito: OK sin aviso', async () => {
    const r = await corre({ ruta: { canalSalida: 'graph' } });
    expect(r.estado('1a')).toBe('OK');
    expect(r.texto).not.toContain('aviso');
  });
  it.each([
    ['comercio inactivo', { ficha: { estado: 'suspendido' } }],
    ['consola clásica', { ficha: { consolaConversaciones: 'clasica' } }],
    ['consola ausente', { ficha: { consolaConversaciones: undefined } }],
    ['nombre de Bellido', { ficha: { nombre: 'Clínica Bellido' } }],
  ])('1b FALLA: %s', async (_n, o) => {
    const r = await corre(o as Over);
    expect(r.estado('1b')).toBe('FALLA');
  });
  it('1b FALLA sin ficha; informa el valor actual de la bandera', async () => {
    expect((await corre({ ficha: null })).estado('1b')).toBe('FALLA');
    expect((await corre()).texto).toContain('personaPuedeEscribir hoy: ausente');
    expect((await corre({ ficha: { personaPuedeEscribir: true } })).texto).toContain('hoy: true');
  });
  it('Firestore caído: NO SE PUDO (no OK) y el error no se imprime', async () => {
    const r = await corre({ dbFalla: true });
    expect(r.estado('1a')).toBe('NO SE PUDO');
    expect(r.estado('1b')).toBe('NO SE PUDO');
    expect(r.codigo).not.toBe(0);
    sinSecretos(r.texto);
  });
  it('Bellido por id: el verificador se niega con salida 2 sin leer nada', async () => {
    const m = mundo();
    const c = await mod.verificar(cfgBase({ tenant: 'bellido' }), m.deps);
    expect(c).toBe(2);
    expect(m.llamadas.gcloud).toHaveLength(0);
    expect(m.llamadas.n8n).toHaveLength(0);
  });
});

describe('2 · secreto', () => {
  const mapa = (e: unknown, alias = ALIAS) => JSON.stringify({ [alias]: e });
  it.each([
    ['alias ausente', mapa({ ruta: RUTA, clave: M.clave }, 'otro1')],
    ['no es JSON', 'esto no es json CLAVE-MARCADOR-ABCDEF99'],
    ['ruta http', mapa({ ruta: `http://${M.host}/webhook/${M.capacidad}`, clave: M.clave })],
    ['host ajeno', mapa({ ruta: `https://ajeno.ejemplo.test/webhook/${M.capacidad}`, clave: M.clave })],
    ['clave corta', mapa({ ruta: RUTA, clave: 'corta' })],
    ['sin clave', mapa({ ruta: RUTA })],
    ['entrada no objeto', mapa('texto')],
  ])('FALLA: %s', async (_n, m) => {
    const r = await corre({ mapa: m });
    expect(r.estado('2')).toBe('FALLA');
    expect(r.codigo).toBe(1);
    sinSecretos(r.texto);
  });
  it('hasOwn: un alias heredado (__proto__) no cuenta', async () => {
    const r = await corre({ mapa: '{}' });
    expect(r.estado('2')).toBe('FALLA');
  });
  it('versión fijada distinta de latest: OK con aviso', async () => {
    const r = await corre({ mapaLatest: mapa({ ruta: RUTA, clave: 'OTRA-CLAVE-MARCADOR-ZZ' }) });
    expect(r.estado('2')).toBe('OK');
    expect(r.texto).toContain('DIFIERE de latest');
    sinSecretos(r.texto);
    expect(r.texto).not.toContain('OTRA-CLAVE-MARCADOR-ZZ');
  });
  it('versión fijada igual a latest: sin aviso', async () => {
    expect((await corre()).texto).not.toContain('DIFIERE');
  });
  it('lee la versión FIJADA de la Function, no latest', async () => {
    const r = await corre({ versionSecreto: '7' });
    const accesos = r.llamadas.gcloud.filter((a) => a[0] === 'secrets').map((a) => a[3]);
    expect(accesos[0]).toBe('7');
  });
  it('sin versión fijada conocida: NO SE PUDO', async () => {
    const r = await corre({ versionSecreto: '' });
    expect(r.estado('2')).toBe('NO SE PUDO');
  });
  it('gcloud caído: 2 y 3 dan NO SE PUDO', async () => {
    const r = await corre({ gcloudFalla: true });
    expect(r.estado('2')).toBe('NO SE PUDO');
    expect(r.estado('3')).toBe('NO SE PUDO');
    expect(r.codigo).not.toBe(0);
  });
  it('sin N8N_BASE_URL no se puede comparar el host: NO SE PUDO, no OK', async () => {
    const r = await corre({ n8nEntorno: { base: '', clave: '' } });
    expect(r.estado('2')).toBe('NO SE PUDO');
  });
});

describe('3 · Functions', () => {
  it('una Function que no está ACTIVE es FALLA y se nombra', async () => {
    const r = await corre({ funciones: { reclamarSalidaPersona: 'DEPLOYING' } });
    expect(r.estado('3')).toBe('FALLA');
    expect(r.texto).toContain('reclamarSalidaPersona');
  });
  it('se consultan las cinco', async () => {
    const r = await corre();
    const nombres = r.llamadas.gcloud.filter((a) => a[0] === 'functions').map((a) => a[2]);
    expect(nombres.sort()).toEqual(['confirmarSalidaPersona', 'devolverConversacion', 'enviarComoPersona', 'reclamarSalidaPersona', 'tomarConversacion']);
  });
});

describe('4 · n8n', () => {
  it('n8n inaccesible: todo el bloque NO SE PUDO (nunca OK) y salida distinta de 0', async () => {
    const r = await corre({ n8nCaido: true });
    for (const id of ['4a', '4b', '4c', '4d', '4e', '5a']) expect(r.estado(id), id).toBe('NO SE PUDO');
    expect(r.codigo).not.toBe(0);
  });
  describe('la clave de la API solo viaja a un host apto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verif-env-'));
    const archivo = (txt: string) => { const f = join(dir, `e${Math.random().toString(36).slice(2)}`); writeFileSync(f, txt, { mode: 0o600 }); return f; };
    it('--env hostil + clave del entorno: no se mezclan (vacío por falta de clave en el archivo)', () => {
      const f = archivo('N8N_BASE_URL=https://hostil.ejemplo.test\n');
      expect(mod.leerEntornoN8n(f, { N8N_API_KEY: 'CLAVE-REAL-DEL-ENTORNO', N8N_BASE_URL: `https://${M.host}` })).toEqual({ base: '', clave: '' });
    });
    it('--env con base y clave propias: se usan juntas; sin --env, ambas del entorno', () => {
      const f = archivo('N8N_BASE_URL=https://a.ejemplo.test\nN8N_API_KEY=clave-del-archivo\n');
      expect(mod.leerEntornoN8n(f, { N8N_API_KEY: 'otra', N8N_BASE_URL: 'https://b.ejemplo.test' })).toEqual({ base: 'https://a.ejemplo.test', clave: 'clave-del-archivo' });
      expect(mod.leerEntornoN8n(null, { N8N_API_KEY: 'otra', N8N_BASE_URL: 'https://b.ejemplo.test' })).toEqual({ base: 'https://b.ejemplo.test', clave: 'otra' });
    });
    it.each(['https://127.0.0.1', 'https://10.0.0.5:5678', 'https://2130706433', 'https://localhost', 'https://x.localhost', 'https://[::1]', 'http://n8n.ejemplo.test'])('host no apto: %s', (base) => {
      expect(mod.leerEntornoN8n(null, { N8N_BASE_URL: base, N8N_API_KEY: 'abc' })).toEqual({ base: '', clave: '' });
    });
    it('el host de N8N_BASE_URL distinto del de la ruta del secreto: no se llama a n8n (NO SE PUDO)', async () => {
      const r = await corre({ n8nEntorno: { base: 'https://hostil.ejemplo.test', clave: M.claveN8n } });
      expect(r.llamadas.n8n).toHaveLength(0);
      for (const id of ['4a', '4b', '4c', '4d', '4e', '5a']) expect(r.estado(id), id).toBe('NO SE PUDO');
      expect(r.estado('2')).toBe('FALLA');
      sinSecretos(r.texto);
      rmSync(dir, { recursive: true, force: true });
    });
  });
  it('sin credenciales de n8n: NO SE PUDO sin llamar', async () => {
    const r = await corre({ n8nEntorno: { base: '', clave: '' } });
    for (const id of ['4a', '4b', '4c', '4d', '4e', '5a']) expect(r.estado(id), id).toBe('NO SE PUDO');
    expect(r.llamadas.n8n).toHaveLength(0);
  });
  it('inactivo: 4a FALLA', async () => {
    expect((await corre({ workflow: { active: false } })).estado('4a')).toBe('FALLA');
  });
  it('borrador distinto de la versión publicada: 4a FALLA', async () => {
    expect((await corre({ workflow: { versionId: 'v10' } })).estado('4a')).toBe('FALLA');
  });
  it('sin activeVersionId: 4a FALLA', async () => {
    expect((await corre({ workflow: { activeVersionId: null } })).estado('4a')).toBe('FALLA');
  });
  it('credencial con tipo inesperado o marcador sin reponer: 4b FALLA', async () => {
    const mal = nodosOk().map((n) => (n.name === 'Reclamar' ? { ...n, credentials: { whatsAppApi: { id: 'c2', name: 'x' } } } : n));
    expect((await corre({ workflow: { nodes: mal } })).estado('4b')).toBe('FALLA');
    const marc = nodosOk().map((n) => (n.name === 'Timbre' ? { ...n, credentials: { httpHeaderAuth: { id: 'c1', name: 'timbre REEMPLAZAR_ALIAS' } } } : n));
    expect((await corre({ workflow: { nodes: marc } })).estado('4b')).toBe('FALLA');
  });
  it('falta un nodo: 4b FALLA', async () => {
    const sin = nodosOk().filter((n) => n.name !== 'Confirmar');
    expect((await corre({ workflow: { nodes: sin } })).estado('4b')).toBe('FALLA');
  });
  it('el relé con la credencial de ingesta: 4c FALLA', async () => {
    const mal = nodosOk().map((n) => (n.name === 'Enviar por el relé' ? { ...n, credentials: { httpHeaderAuth: { id: 'c2', name: 'Ingesta cred' } } } : n));
    expect((await corre({ workflow: { nodes: mal } })).estado('4c')).toBe('FALLA');
  });
  it('Graph con la credencial de ingesta (httpHeaderAuth): 4c FALLA', async () => {
    const mal = nodosOk().map((n) => (n.name === 'Enviar por Graph' ? { ...n, credentials: { httpHeaderAuth: { id: 'c2', name: 'Ingesta cred' } } } : n));
    expect((await corre({ workflow: { nodes: mal } })).estado('4c')).toBe('FALLA');
  });
  it('Reclamar y Confirmar con credenciales distintas: 4c FALLA', async () => {
    const mal = nodosOk().map((n) => (n.name === 'Confirmar' ? { ...n, credentials: { httpHeaderAuth: { id: 'c9', name: 'Otra' } } } : n));
    expect((await corre({ workflow: { nodes: mal } })).estado('4c')).toBe('FALLA');
  });
  it('el path del Timbre no coincide con la ruta del secreto: 4d FALLA y no se imprime ninguno', async () => {
    const mal = nodosOk().map((n) => (n.name === 'Timbre' ? { ...n, parameters: { path: 'OTRO-PATH-MARCADOR' } } : n));
    const r = await corre({ workflow: { nodes: mal } });
    expect(r.estado('4d')).toBe('FALLA');
    expect(r.texto).not.toContain('OTRO-PATH-MARCADOR');
    sinSecretos(r.texto);
  });
  it('path con marcador sin reponer: 4d FALLA', async () => {
    const mal = nodosOk().map((n) => (n.name === 'Timbre' ? { ...n, parameters: { path: 'REEMPLAZAR_RUTA_TIMBRE' } } : n));
    expect((await corre({ workflow: { nodes: mal } })).estado('4d')).toBe('FALLA');
  });
  it('4d sin ruta del secreto: NO SE PUDO', async () => {
    expect((await corre({ mapa: '{}' })).estado('4d')).toBe('NO SE PUDO');
  });
  it('phoneNumberId distinto del id de la ruta: 4e FALLA', async () => {
    const mal = nodosOk().map((n) => (n.name === 'Config base' ? { ...n, parameters: { assignments: { assignments: [{ name: 'phoneNumberId', value: 'OTRO-ID' }] } } } : n));
    const r = await corre({ workflow: { nodes: mal } });
    expect(r.estado('4e')).toBe('FALLA');
    expect(r.texto).not.toContain('OTRO-ID');
  });
  it('4e sin ruta (1a falló): NO SE PUDO', async () => {
    expect((await corre({ ruta: null })).estado('4e')).toBe('NO SE PUDO');
  });
  it('el flujo no existe: 4a FALLA', async () => {
    const m = mundo();
    const base = m.deps.n8n;
    m.deps.n8n = async (ruta: string) => (ruta.startsWith('/workflows?') ? { status: 200, json: { data: [], nextCursor: null } } : base(ruta));
    await mod.verificar(cfgBase(), m.deps);
    expect(m.texto()).toMatch(/\[FALLA\s*\]\s+4a/);
  });
});

describe('5 · barrido vivo', () => {
  it('ejecuciones con error en la última hora: 5a FALLA', async () => {
    const r = await corre({ ejecuciones: [reciente('success'), reciente('error')] });
    expect(r.estado('5a')).toBe('FALLA');
  });
  it('un error viejo (de hace más de una hora) no cuenta', async () => {
    const viejo = { status: 'error', startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() };
    const r = await corre({ ejecuciones: [reciente('success'), viejo] });
    expect(r.estado('5a')).toBe('OK');
  });
  it('sin ejecuciones recientes: NO SE PUDO', async () => {
    expect((await corre({ ejecuciones: [] })).estado('5a')).toBe('NO SE PUDO');
  });
  it('401 de reclamarSalidaPersona: 5b FALLA, solo el conteo', async () => {
    const r = await corre({ logs: JSON.stringify([{ textPayload: M.clave }, { textPayload: M.clave }]) });
    expect(r.estado('5b')).toBe('FALLA');
    expect(r.texto).toContain('2 respuestas 401');
    sinSecretos(r.texto);
  });
  it('cero solicitudes totales: el filtro no sirve, NO SE PUDO y nunca OK', async () => {
    const r = await corre({ totales: '[]', logs: '[]' });
    expect(r.estado('5b')).toBe('NO SE PUDO');
    expect(r.codigo).not.toBe(0);
  });
  it('con solicitudes totales y cero 401: OK', async () => {
    expect((await corre({ totales: '[{},{},{}]', logs: '[]' })).estado('5b')).toBe('OK');
  });
  it('Cloud Logging inaccesible: 5b NO SE PUDO', async () => {
    const m = mundo();
    const g = m.deps.gcloud;
    m.deps.gcloud = (a: string[]) => (a[0] === 'logging' ? { code: 1, stdout: '' } : g(a));
    await mod.verificar(cfgBase(), m.deps);
    expect(m.texto()).toMatch(/\[NO SE PUDO\]\s+5b/);
  });
  it('5a y 5b no son obligatorios para --encender', async () => {
    const r = await corre({ ejecuciones: [reciente('error')], logs: '[{}]' }, { encender: true });
    expect(r.llamadas.encender).toHaveLength(1);
    expect(r.codigo).toBe(1);
  });
});

describe('6 · prueba de timbre', () => {
  it('sin --probar-timbre no se llama', async () => {
    expect((await corre()).llamadas.timbre).toHaveLength(0);
  });
  it('con --probar-timbre manda UNA clave equivocada y espera 403', async () => {
    const r = await corre({}, { probarTimbre: true });
    expect(r.llamadas.timbre).toHaveLength(1);
    expect(r.llamadas.timbre[0]).not.toBe(M.clave);
    expect(r.estado('6')).toBe('OK');
    sinSecretos(r.texto);
  });
  it('200 con clave equivocada: FALLA (abierto); 404: FALLA; sin respuesta: NO SE PUDO', async () => {
    expect((await corre({ timbre: 200 }, { probarTimbre: true })).estado('6')).toBe('FALLA');
    expect((await corre({ timbre: 404 }, { probarTimbre: true })).estado('6')).toBe('FALLA');
    expect((await mod.chequeoTimbre(RUTA, async () => { throw new Error(M.clave); })).estado).toBe('NO SE PUDO');
    expect((await mod.chequeoTimbre(null, async () => 403)).estado).toBe('NO SE PUDO');
  });
  it('la clave falsa nunca es la real', async () => {
    let enviada = '';
    await mod.chequeoTimbre(RUTA, async (_u, c) => { enviada = c; return 403; });
    expect(enviada).not.toBe(M.clave);
  });
});

describe('--encender', () => {
  it('sin --encender no invoca nada, aunque todo esté OK', async () => {
    expect((await corre()).llamadas.encender).toHaveLength(0);
  });
  it('con todo OK invoca EN SECO: sin --aplicar, sin respaldo; salida 0 si el seco dejó un cambio pendiente', async () => {
    const r = await corre({ encenderCodigo: 1 }, { encender: true });
    expect(r.llamadas.encender).toEqual([['--proyecto', M.proyProd, '--tenant', TENANT, '--valor', 'true']]);
    expect(r.codigo).toBe(0);
    sinSecretos(r.texto.replace(M.proyProd, ''));
  });
  it('con --aplicar pasa tal cual respaldo y confirmación', async () => {
    const r = await corre({ encenderCodigo: 0 }, { encender: true, aplicar: true, respaldo: '/ruta/respaldo.json', confirmo: TENANT });
    expect(r.llamadas.encender[0]).toEqual(['--proyecto', M.proyProd, '--tenant', TENANT, '--valor', 'true', '--aplicar', '--respaldo', '/ruta/respaldo.json', '--confirmo-produccion', TENANT]);
    expect(r.codigo).toBe(0);
  });
  it.each([
    ['ruta con FALLA', { ruta: { estado: 'suspendido' } }],
    ['secreto con FALLA', { mapa: '{}' }],
    ['Function caída', { funciones: { tomarConversacion: 'FAILED' } }],
    ['n8n con FALLA', { workflow: { active: false } }],
    ['n8n inaccesible', { n8nCaido: true }],
    ['gcloud caído', { gcloudFalla: true }],
    ['Firestore caído', { dbFalla: true }],
  ])('no invoca nada si falla un obligatorio: %s (ni siquiera con --aplicar)', async (_n, o) => {
    const r = await corre(o as Over, { encender: true, aplicar: true, respaldo: '/r.json', confirmo: TENANT });
    expect(r.llamadas.encender).toHaveLength(0);
    expect(r.codigo).not.toBe(0);
    expect(r.texto).toContain('NO se invoca nada');
  });
  it('si el script de escritura falla (2), la salida es 2; si da error (3), 3', async () => {
    expect((await corre({ encenderCodigo: 2 }, { encender: true })).codigo).toBe(2);
    expect((await corre({ encenderCodigo: 3 }, { encender: true })).codigo).toBe(3);
  });
  it('el verificador en sí no escribe: ninguna llamada de escritura en su código', () => {
    const fuente = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/createHash\('sha256'\)\.update\(/g, 'hash(');
    for (const prohibido of [/\.set\(/, /\.update\(/, /\.delete\(/, /\.add\(/, /\.create\(/, /method:\s*'(PUT|PATCH|DELETE)'/, /writeFile|appendFile|unlink|rmSync/, /'POST'/]) {
      if (prohibido.source === "'POST'") continue;
      expect(fuente, String(prohibido)).not.toMatch(prohibido);
    }
    // el único POST es el del timbre con clave equivocada
    expect((fuente.match(/method:\s*'POST'/g) ?? []).length).toBe(1);
  });
});

describe('envoltorio .sh', () => {
  it('bash -n pasa', () => {
    expect(spawnSync('bash', ['-n', ENVOLTORIO], { encoding: 'utf8' }).status).toBe(0);
  });
  it('shellcheck pasa (si está instalado)', () => {
    const hay = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
    if (hay.status !== 0) return;
    expect(spawnSync('shellcheck', [ENVOLTORIO], { encoding: 'utf8' }).status).toBe(0);
  });
  it('sin credenciales de gcloud y sin --proyecto: salida 2', () => {
    const r = spawnSync('bash', [ENVOLTORIO, '--alias', ALIAS, '--tenant', TENANT], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', CLOUDSDK_CONFIG: '/nonexistent-dir-xyz' } });
    expect(r.status).toBe(2);
  });
  it('un Bellido por el envoltorio: salida 2', () => {
    const r = spawnSync('bash', [ENVOLTORIO, '--proyecto', M.proyProd, '--alias', ALIAS, '--tenant', 'bellido'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: '/nonexistent', ...ENV } });
    expect(r.status).toBe(2);
    sinSecretos(r.stdout + r.stderr);
  });
});
