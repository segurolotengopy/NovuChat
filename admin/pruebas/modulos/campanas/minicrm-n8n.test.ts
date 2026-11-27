/**
 * La lectura del miniCRM por la API de n8n (campaña saliente, PR-C), contra un n8n de mentira: ningún fetch real, ningún .env.
 * Todos los ids, nombres y credenciales de aquí son ficticios.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

type Pedido = { metodo: string; ruta: string; cuerpo: unknown };
const M = await import('../../../scripts/modulos/campanas/miniCrm-n8n.mjs') as unknown as {
  crearLectorDeMiniCrmN8n: (o: Record<string, unknown>, d?: Record<string, unknown>) => (() => Promise<Array<Record<string, string>>>) & { estado: { limpiezaFallida: boolean } };
  extraerConfigDelFlujo: (f: unknown) => { planillaId: string; hoja: string; credencial: { id: string; name: string } };
};

const C = await import('../../../scripts/modulos/campanas/campana-saliente.mjs') as unknown as {
  instalarInterrupcion: (p: unknown, e: { estado: string }, l: unknown, escribir?: (t: string) => void) => void;
};

const PLANILLA = 'planilla-ficticia-0001';
const HOJA = 'hoja-ficticia';
const CRED = { id: 'cred-ficticia-1', name: 'credencial ficticia' };
const NOMBRE = 'flujo vivo ficticio';
const CLAVE_N8N = 'clave-ficticia-de-n8n';
const CRM = {
  filaEncabezados: 3,
  columnas: { telefono: { letra: 'E', titulo: 'Teléfono WhatsApp' }, fecha: { letra: 'B', titulo: 'Fecha Registro' }, etapaInicial: { letra: 'G', titulo: 'Etapa Funnel' }, resumen: { letra: 'J', titulo: 'Resumen' } },
};
const ENCABEZADOS = ['ID', 'Fecha Registro', 'Nombre', 'Empresa', 'Teléfono WhatsApp', 'Rubro', 'Etapa Funnel', 'Origen', 'Calificación', 'Resumen'];
const VALORES = [ENCABEZADOS, ['L1', '2026-11-10', 'x', '', '59170000001', '', 'Nuevo', '', '', ''], ['L2', '2026-11-11', 'x', '', '59170000002', '', 'Ganado', '', '', ''], ['L3', '2026-11-12']];

const flujoVivo = (cred = [CRED]) => ({
  nodes: [
    { name: 'Config base', parameters: { assignments: { assignments: [{ name: 'planillaProspectosId', value: PLANILLA }, { name: 'planillaProspectosHoja', value: HOJA }] } } },
    ...cred.map((c, i) => ({ name: `Hoja ${i}`, type: 'n8n-nodes-base.googleSheets', credentials: { googleApi: c } })),
  ],
});

interface Opciones {
  paginas?: Array<{ data: Array<{ id: string; name: string; active: boolean }>; nextCursor?: string | null }>;
  flujo?: unknown;
  webhook?: { status: number; cuerpo: unknown };
  falloBorrado?: boolean;
  alWebhook?: () => void;
  respuestaLista?: number;
}
function n8nDeMentira(o: Opciones = {}) {
  const pedidos: Pedido[] = [];
  const paginas = o.paginas ?? [{ data: [{ id: 'wf-ficticio-1', name: NOMBRE, active: true }], nextCursor: null }];
  const fetch = vi.fn(async (url: string, init: { method: string; body?: string }) => {
    const u = new URL(url);
    const ruta = u.pathname + u.search;
    const cuerpo = init.body ? JSON.parse(init.body) : undefined;
    pedidos.push({ metodo: init.method, ruta, cuerpo });
    const json = (status: number, c: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => (c === undefined ? '' : JSON.stringify(c)) });
    if (u.pathname.startsWith('/webhook/')) { o.alWebhook?.(); const w = o.webhook ?? { status: 200, cuerpo: { values: VALORES } }; return json(w.status, w.cuerpo); }
    if (init.method === 'GET' && u.pathname === '/api/v1/workflows') {
      if (o.respuestaLista) return json(o.respuestaLista, {});
      const cursor = u.searchParams.get('cursor');
      return json(200, paginas[cursor ? Number(cursor) : 0]);
    }
    if (init.method === 'GET' && u.pathname.startsWith('/api/v1/workflows/')) return json(200, o.flujo ?? flujoVivo());
    if (init.method === 'POST' && u.pathname === '/api/v1/workflows') return json(200, { id: 'tmp-ficticio' });
    if (init.method === 'DELETE') return o.falloBorrado ? json(500, {}) : json(200, {});
    return json(200, {});
  });
  return { fetch, pedidos };
}

const proceso = () => {
  const manejadores: Record<string, () => void> = {};
  return { manejadores, once: (e: string, f: () => void) => { manejadores[e] = f; }, off: (e: string) => { delete manejadores[e]; }, exit: vi.fn() };
};
function lector(o: Opciones = {}, extra: Record<string, unknown> = {}, nombre: string = NOMBRE) {
  const n8n = n8nDeMentira(o);
  const avisos: string[] = [];
  const p = proceso();
  const leer = M.crearLectorDeMiniCrmN8n({ envFile: 'no-se-lee', nombreFlujo: nombre, crm: CRM }, {
    fetch: n8n.fetch, leerEnv: () => ({ N8N_BASE_URL: 'https://n8n.ejemplo.invalid', N8N_API_KEY: CLAVE_N8N }), aleatorio: (n: number) => 'a'.repeat(n * 2), esperar: async () => {}, aviso: (t: string) => avisos.push(t), proceso: p, ...extra,
  });
  return { leer, n8n, avisos, p };
}
const rechazo = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { return e as Error & { code?: string }; } throw new Error('tenía que fallar'); };
const sinValores = (e: Error & { code?: string }) => {
  const t = `${e.message} ${e.code ?? ''} ${e.stack ?? ''}`;
  for (const v of [PLANILLA, HOJA, CRED.id, CRED.name, CLAVE_N8N, 'wf-ficticio-1', 'tmp-ficticio', '59170000001']) expect(t, v).not.toContain(v);
};

describe('lectura del miniCRM por n8n', () => {
  it('lee las filas por TÍTULO de columna y borra el flujo temporal', async () => {
    const { leer, n8n } = lector();
    const filas = await leer();
    expect(filas).toEqual([
      { telefono: '59170000001', fecha: '2026-11-10', etapa: 'Nuevo' },
      { telefono: '59170000002', fecha: '2026-11-11', etapa: 'Ganado' },
      { telefono: '', fecha: '2026-11-12', etapa: '' },
    ]);
    const metodos = n8n.pedidos.map((p) => `${p.metodo} ${p.ruta.split('?')[0]}`);
    expect(metodos).toContain('DELETE /api/v1/workflows/tmp-ficticio');
    expect(metodos.indexOf('DELETE /api/v1/workflows/tmp-ficticio')).toBeGreaterThan(metodos.findIndex((m) => m.startsWith('POST /webhook/')));
  });

  it('el flujo temporal NO guarda ejecuciones (saveData none), usa la credencial del flujo vivo y pide FORMATTED_VALUE de A3:J', async () => {
    const { leer, n8n } = lector();
    await leer();
    const creado = n8n.pedidos.find((p) => p.metodo === 'POST' && p.ruta === '/api/v1/workflows')?.cuerpo as { settings: Record<string, unknown>; nodes: Array<{ credentials?: unknown; parameters: { url?: string } }> };
    expect(creado.settings).toMatchObject({ saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
    const http = creado.nodes.find((n) => n.parameters.url);
    expect(http?.credentials).toEqual({ googleApi: CRED });
    expect(decodeURIComponent(http?.parameters.url ?? '')).toContain(`'${HOJA}'!A3:J`);
    expect(http?.parameters.url).toContain('valueRenderOption=FORMATTED_VALUE');
  });

  it('NEGATIVA: si la llamada falla, el flujo temporal se borra igual y el error no trae ids ni valores', async () => {
    const { leer, n8n } = lector({ webhook: { status: 500, cuerpo: {} } });
    const e = await rechazo(leer);
    expect(e.code).toBe('n8n-llamada-500');
    sinValores(e);
    expect(n8n.pedidos.filter((p) => p.metodo === 'DELETE')).toHaveLength(1);
    expect(n8n.pedidos.some((p) => p.ruta.endsWith('/tmp-ficticio/deactivate'))).toBe(true);
  });

  it('NEGATIVA: si el borrado falla, avisa SIN ids y deja limpiezaFallida (la corrida sale con 3)', async () => {
    const { leer, avisos } = lector({ falloBorrado: true });
    await leer();
    expect(avisos).toHaveLength(1);
    for (const v of ['tmp-ficticio', PLANILLA]) expect(avisos[0]).not.toContain(v);
    expect(leer.estado.limpiezaFallida).toBe(true);
  });

  it('NEGATIVA: ante SIGINT durante la llamada se borra el flujo temporal y se sale con 130 (una sola vez)', async () => {
    const o: Opciones = {};
    const { leer, n8n, p } = lector(o);
    o.alWebhook = () => { p.manejadores['SIGINT']?.(); };
    await leer().catch(() => null);
    await vi.waitFor(() => expect(p.exit).toHaveBeenCalledWith(130));
    expect(n8n.pedidos.filter((q) => q.metodo === 'DELETE')).toHaveLength(1);
    expect(Object.keys(p.manejadores)).toHaveLength(0);
  });

  it('NEGATIVA: dos credenciales de Google distintas en el flujo vivo → credencial-ambigua, sin crear nada', async () => {
    const { leer, n8n } = lector({ flujo: flujoVivo([CRED, { id: 'cred-ficticia-2', name: 'otra' }]) });
    const e = await rechazo(leer);
    expect(e.code).toBe('credencial-ambigua');
    sinValores(e);
    expect(n8n.pedidos.some((p) => p.metodo === 'POST' && p.ruta === '/api/v1/workflows')).toBe(false);
  });
  it('la misma credencial repetida en varios nodos NO es ambigua', () => {
    expect(M.extraerConfigDelFlujo(flujoVivo([CRED, CRED, CRED])).credencial).toEqual(CRED);
  });

  it('NEGATIVA: 0 flujos activos con ese nombre → flujo-no-encontrado; un flujo inactivo no cuenta', async () => {
    for (const paginas of [[{ data: [], nextCursor: null }], [{ data: [{ id: 'a', name: NOMBRE, active: false }], nextCursor: null }], [{ data: [{ id: 'a', name: 'otro', active: true }], nextCursor: null }]]) {
      const e = await rechazo(lector({ paginas }).leer);
      expect(e.code).toBe('flujo-no-encontrado');
      sinValores(e);
    }
  });
  it('NEGATIVA: 2 flujos activos con ese nombre → flujo-ambiguo (no se elige uno)', async () => {
    const { leer, n8n } = lector({ paginas: [{ data: [{ id: 'a', name: NOMBRE, active: true }, { id: 'b', name: NOMBRE, active: true }], nextCursor: null }] });
    expect((await rechazo(leer)).code).toBe('flujo-ambiguo');
    expect(n8n.pedidos.some((p) => p.metodo === 'POST')).toBe(false);
  });
  it('la paginación: encuentra el flujo en la página 2, y lo duplicado entre páginas también es ambiguo', async () => {
    const otro = { id: 'x', name: 'otro', active: true };
    const ok = await lector({ paginas: [{ data: [otro], nextCursor: '1' }, { data: [{ id: 'wf-ficticio-1', name: NOMBRE, active: true }], nextCursor: null }] }).leer();
    expect(ok).toHaveLength(3);
    const dup = await rechazo(lector({ paginas: [{ data: [{ id: 'a', name: NOMBRE, active: true }], nextCursor: '1' }, { data: [{ id: 'b', name: NOMBRE, active: true }], nextCursor: null }] }).leer);
    expect(dup.code).toBe('flujo-ambiguo');
  });

  it('NEGATIVA: si un título de columna no coincide → encabezados (no se adivina), y el temporal se borra', async () => {
    const mal = [[...ENCABEZADOS.slice(0, 4), 'Celular', ...ENCABEZADOS.slice(5)], ...VALORES.slice(1)];
    const { leer, n8n } = lector({ webhook: { status: 200, cuerpo: { values: mal } } });
    const e = await rechazo(leer);
    expect(e.code).toBe('encabezados');
    sinValores(e);
    expect(n8n.pedidos.filter((p) => p.metodo === 'DELETE')).toHaveLength(1);
    const vacia = lector({ webhook: { status: 200, cuerpo: {} } });
    expect((await rechazo(vacia.leer)).code).toBe('encabezados');
  });

  it('NEGATIVA: el flujo vivo sin planilla o con un marcador no se usa', async () => {
    for (const valor of ['', 'REEMPLAZAR_PLANILLA', '={{ $json.x }}']) {
      const flujo = { nodes: [{ name: 'Config base', parameters: { assignments: { assignments: [{ name: 'planillaProspectosId', value: valor }, { name: 'planillaProspectosHoja', value: HOJA }] } } }, { type: 'x', credentials: { googleApi: CRED } }] };
      const e = await rechazo(lector({ flujo }).leer);
      expect(e.code).toBe('n8n-sin-planilla');
      sinValores(e);
    }
  });

  it('NEGATIVA: sin https (salvo esta máquina) o sin clave no se llama a n8n', async () => {
    for (const env of [{ N8N_BASE_URL: 'http://n8n.ejemplo.invalid', N8N_API_KEY: CLAVE_N8N }, { N8N_BASE_URL: 'https://n8n.ejemplo.invalid' }, {}]) {
      const { leer, n8n } = lector({}, { leerEnv: () => env });
      const e = await rechazo(leer);
      expect(['n8n-sin-https', 'sin-n8n']).toContain(e.code);
      expect(n8n.fetch).not.toHaveBeenCalled();
    }
  });
  it('NEGATIVA: un 401 de n8n se informa solo por su código', async () => {
    const e = await rechazo(lector({ respuestaLista: 401 }).leer);
    expect(e.code).toBe('n8n-http-401');
    sinValores(e);
  });
  it('NEGATIVA: un mapa crm sin las columnas de teléfono, fecha o etapa no crea el lector', () => {
    expect(() => M.crearLectorDeMiniCrmN8n({ envFile: 'x', nombreFlujo: NOMBRE, crm: { filaEncabezados: 3, columnas: { telefono: CRM.columnas.telefono } } })).toThrow();
    expect(() => M.crearLectorDeMiniCrmN8n({ envFile: 'x', nombreFlujo: '', crm: CRM })).toThrow();
  });
});

// Ctrl-C y SIGTERM con los DOS oyentes reales (el de la corrida, `instalarInterrupcion`, y el del lector) sobre un `proceso` compartido.
describe('interrupción: el flujo temporal se borra ANTES de salir', () => {
  const compuerta = () => { let abrir!: () => void; const espera = new Promise<void>((r) => { abrir = r; }); return { espera, abrir }; };

  /** n8n de mentira con compuertas en el POST de creación y en el DELETE, y el proceso compartido con los dos oyentes reales. */
  function montaje(o: Opciones & { retenerPost?: boolean; retenerDelete?: boolean; falloPost?: boolean; existentes?: Array<{ id: string; name: string; active: boolean }> } = {}) {
    const postG = compuerta(); const delG = compuerta();
    const n8n = n8nDeMentira(o);
    const llamadas: string[] = [];
    const fetch = vi.fn(async (url: string, init: { method: string; body?: string }) => {
      const u = new URL(url);
      llamadas.push(`${init.method} ${u.pathname}`);
      if (init.method === 'POST' && u.pathname === '/api/v1/workflows') {
        if (o.falloPost) { await n8n.fetch(url, init); throw new Error('red caída'); }
        if (o.retenerPost) await postG.espera;
      }
      if (init.method === 'DELETE' && o.retenerDelete) await delG.espera;
      if (init.method === 'GET' && u.pathname === '/api/v1/workflows' && o.existentes && n8n.pedidos.some((q) => q.metodo === 'POST' && q.ruta === '/api/v1/workflows')) {
        const creado = n8n.pedidos.find((q) => q.metodo === 'POST' && q.ruta === '/api/v1/workflows')?.cuerpo as { name: string };
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'huerfano-ficticio', name: creado.name, active: true }, ...o.existentes!], nextCursor: null }) };
      }
      return n8n.fetch(url, init);
    });
    const proceso = Object.assign(new EventEmitter(), { exit: vi.fn(), off: undefined as unknown });
    proceso.off = (e: string, f: (...a: unknown[]) => void) => proceso.removeListener(e, f);
    const avisos: string[] = [];
    const leer = M.crearLectorDeMiniCrmN8n({ envFile: 'no-se-lee', nombreFlujo: NOMBRE, crm: CRM }, {
      fetch, leerEnv: () => ({ N8N_BASE_URL: 'https://n8n.ejemplo.invalid', N8N_API_KEY: CLAVE_N8N }), aleatorio: (n: number) => 'a'.repeat(n * 2), esperar: async () => {}, aviso: (t: string) => avisos.push(t), proceso,
    });
    // El oyente de la corrida se instala ANTES que el del lector (como en `principal`): es el orden que dejaba salir antes de limpiar.
    C.instalarInterrupcion(proceso, { estado: 'antes' }, leer, () => {});
    return { leer, proceso, n8n, postG, delG, llamadas, avisos };
  }
  const borrados = (m: { n8n: { pedidos: Pedido[] } }) => m.n8n.pedidos.filter((q) => q.metodo === 'DELETE').length;

  for (const senal of ['SIGINT', 'SIGTERM']) {
    it(`NEGATIVA: ${senal} durante la llamada NO sale hasta que el flujo temporal se borró (una sola vez)`, async () => {
      const m = montaje({ retenerDelete: true });
      const p = m.leer().catch(() => null);
      await vi.waitFor(() => expect(m.llamadas.some((l) => l.startsWith('POST /webhook/'))).toBe(true));
      m.proceso.emit(senal);
      await vi.waitFor(() => expect(m.llamadas).toContain('DELETE /api/v1/workflows/tmp-ficticio'));
      expect(m.proceso.exit).not.toHaveBeenCalled(); // con el borrado en vuelo, salir sería dejar el webhook vivo
      m.delG.abrir();
      await vi.waitFor(() => expect(m.proceso.exit).toHaveBeenCalledWith(130));
      await p;
      expect(m.llamadas.filter((l) => l.startsWith('DELETE'))).toHaveLength(1);
      expect(m.proceso.listenerCount(senal)).toBe(0); // los dos oyentes de esa señal se quitaron
    });
  }

  it('NEGATIVA: la señal durante el POST /workflows espera la creación, borra el flujo creado y no lo activa', async () => {
    const m = montaje({ retenerPost: true });
    const p = m.leer().catch(() => null);
    await vi.waitFor(() => expect(m.llamadas).toContain('POST /api/v1/workflows'));
    m.proceso.emit('SIGINT');
    m.postG.abrir();
    await vi.waitFor(() => expect(m.proceso.exit).toHaveBeenCalledWith(130));
    await p;
    expect(m.llamadas).toContain('DELETE /api/v1/workflows/tmp-ficticio');
    expect(m.llamadas.some((l) => l.includes('/activate'))).toBe(false);
    expect(m.llamadas.some((l) => l.startsWith('POST /webhook/'))).toBe(false);
  });

  it('NEGATIVA: si la creación queda en duda (sin respuesta), se borra POR NOMBRE, que es único por corrida', async () => {
    const m = montaje({ falloPost: true, existentes: [{ id: 'otro-ficticio', name: 'otro flujo', active: true }] });
    const e = await rechazo(m.leer);
    expect(e.message).toBe('red caída');
    const creado = m.n8n.pedidos.find((q) => q.metodo === 'POST' && q.ruta === '/api/v1/workflows')?.cuerpo as { name: string };
    expect(creado.name).toMatch(/^TEMPORAL lectura miniCRM campaña \(borrar\) lectura-[a-f0-9]+$/);
    expect(m.llamadas).toContain('DELETE /api/v1/workflows/huerfano-ficticio');
    expect(m.llamadas).not.toContain('DELETE /api/v1/workflows/otro-ficticio');
  });
});

