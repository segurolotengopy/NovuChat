/**
 * `scripts/plataforma/relleno-crm-historico.mjs` — una fila por cada contacto anterior de UNA subcuenta en su hoja del miniCRM.
 *
 * Sin emulador, sin n8n y sin Google: las lecturas y la escritura se inyectan. Los contactos son sintéticos (teléfonos con seis ceros).
 *   B1. Argumentos y salvaguarda (negando primero): un comercio de la lista, producción con confirmación, SHEET_ID y respaldo.
 *   B2. Las filas: vocabulario cerrado, sin duplicar por teléfono, ID correlativo, nada de texto del cliente ni «pagó».
 *   B3. Ejecución: el seco no escribe y solo imprime conteos; --aplicar guarda respaldo y escribe UNA vez; la segunda corrida no escribe.
 *   B4. Revertir: limpia solo lo escrito; no pisa un cambio ajeno.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';

type Cfg = Record<string, unknown>;
type Fila = string[];
const mod = await import('../../scripts/plataforma/relleno-crm-historico.mjs') as unknown as {
  TENANTS: readonly string[];
  TENANTS_RELLENO: readonly string[];
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  leerMapa: (t: string) => Record<string, any>;
  construirFilas: (a: { conversaciones: any[]; hoja: { telefonos: string[]; ids: string[]; ultimaFila: number }; mapa: Record<string, any> }) =>
    { filas: Fila[]; omitidos: Record<string, number>; conteos: Record<string, any> };
  resumenDeLaHoja: (valores: string[][], mapa: Record<string, any>) => { telefonos: string[]; ids: string[]; ultimaFila: number };
  pedidoDeFormato: (a: { mapa: Record<string, any>; filaDesde: number; cantidad: number }) => { origen: Record<string, number>; destino: Record<string, number>; pegados: string[] };
  ejecutar: (cfg: Cfg, deps: Record<string, any>) => Promise<number>;
  clasificarCierre: (c: Record<string, unknown>) => string;
  reunirCompras: (e: any[], o?: Record<string, unknown>) => { porTelefono: Map<string, { pedidoMs: number | null; reservaMs: number | null }>; conteos: Record<string, any> };
  celdasDeCompra: (c: { pedidoMs: number | null; reservaMs: number | null }) => Record<string, string>;
  leerCompras: (db: any, t: string, excluir: string[]) => Promise<{ porTelefono: Map<string, any>; conteos: Record<string, any> }>;
  completarCeldas: (a: Record<string, any>) => Promise<unknown>;
  construirActualizaciones: (a: { valores: string[][]; mapa: Record<string, any>; compras: Map<string, any> }) => { propuestas: { fila: number; telefono: string; celdas: Record<string, string> }[]; conteos: Record<string, number> };
};

const PROY = 'demo-novuchat-pruebas';
const SHEET = 'hoja-sintetica-abcdefghijklmnopqrstu';
const ENV = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', SHEET_ID: SHEET, ENV_FILE: '/ruta/ficticia/.env' };
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod', SHEET_ID: SHEET, ENV_FILE: '/ruta/ficticia/.env' };
const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'relleno-crm-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

const T0 = Date.UTC(2026, 8, 1, 15, 0); // 2026-09-01 11:00 La Paz
const conv = (n: number, extra: Cfg = {}) => ({ telefono: `5917000000${n}`, nombre: `Contacto ${n}`, origen: 'directo', primeroMs: T0 + n * 3600_000, ultimoMs: T0 + n * 7200_000, ...extra });
const mapaDe = (t: string) => mod.leerMapa(t);
const ENCABEZADOS = (m: Record<string, any>): string[] => {
  const f: string[] = [];
  for (const c of Object.values(m['columnas']) as { letra: string; titulo: string }[]) f[c.letra.charCodeAt(0) - 65] = c.titulo;
  for (const c of Object.values(m['equipo']) as ({ letra: string; titulo: string } | null)[]) if (c && c.letra <= 'T') f[c.letra.charCodeAt(0) - 65] = c.titulo;
  return Array.from(f, (v) => v ?? '');
};

describe('B1. argumentos y salvaguarda', () => {
  const base = ['--proyecto', PROY, '--tenant', 'rroca-ruben'];
  const problemas = (argv: string[], env: Record<string, string> = ENV) => { const r = mod.analizarArgumentos(argv, env); expect(r.ok, JSON.stringify(r)).toBe(false); return (r.problemas ?? []).join(' | '); };
  it('la invocación completa es válida y queda en seco; los cinco comercios valen (cuatro rroca y qtaco)', () => {
    for (const t of ['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio', 'qtaco']) expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', t], ENV).ok, t).toBe(true);
    expect(mod.analizarArgumentos(base, ENV).cfg).toMatchObject({ aplicar: false, revertir: false, entorno: 'emulador' });
  });
  it('NEGADO: otro comercio (Bellido, el chat), varios a la vez o sin tenant', () => {
    for (const t of ['bellido', 'qtaco2', 'novuchat', 'rroca-evy,qtaco', 'rroca-evy,rroca-emma', 'todos', '__proto__']) expect(problemas(['--proyecto', PROY, '--tenant', t]), t).toContain('tiene que ser uno de');
    expect(problemas(['--proyecto', PROY])).toContain('falta --tenant');
  });
  it('NEGADO: sin SHEET_ID o con uno malformado, sin ENV_FILE', () => {
    expect(problemas(base, { ...ENV, SHEET_ID: '' })).toContain('SHEET_ID');
    expect(problemas(base, { ...ENV, SHEET_ID: 'corto' })).toContain('SHEET_ID');
    expect(problemas(base, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', SHEET_ID: SHEET })).toContain('ENV_FILE');
  });
  it('NEGADO: --aplicar sin respaldo, respaldo dentro del repo, producción sin confirmación, opciones raras', () => {
    expect(problemas([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
    // LA HOJA ES SIEMPRE LA REAL: en el emulador y en staging también hace falta la confirmación con el nombre del comercio.
    const sinConfirmar = problemas([...base, '--aplicar', '--respaldo', rutaRespaldo()]);
    expect(sinConfirmar).toContain('--aplicar exige --confirmo-produccion');
    expect(mod.analizarArgumentos([...base, '--aplicar', '--respaldo', rutaRespaldo(), '--confirmo-produccion', 'rroca-ruben'], ENV).ok).toBe(true);
    expect(problemas(['--revertir', ...base, '--aplicar', '--respaldo', rutaRespaldo()])).toMatch(/respaldo|confirmo/);
    expect(problemas([...base, '--aplicar', '--respaldo', join(process.cwd(), 'r.json')])).toMatch(/respaldo/);
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'rroca-ruben'];
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(true);
    expect(problemas([...prod, '--aplicar', '--respaldo', rutaRespaldo()], ENV_REAL)).toContain('--confirmo-produccion');
    expect(problemas([...prod, '--aplicar', '--respaldo', rutaRespaldo(), '--confirmo-produccion', 'rroca-evy'], ENV_REAL)).toContain('no coincide');
    expect(mod.analizarArgumentos([...prod, '--aplicar', '--respaldo', rutaRespaldo(), '--confirmo-produccion', 'rroca-ruben'], ENV_REAL).ok).toBe(true);
    expect(problemas([...base, '--todos'])).toContain('opción desconocida');
    expect(problemas(['--revertir', ...base])).toContain('--revertir exige --respaldo');
  });
});

describe('B1b. Q\'Taco se rellena, pero NO se vacía', () => {
  it('TENANTS (la lista de las herramientas que BORRAN chats y hoja) no incluye a qtaco; TENANTS_RELLENO sí', () => {
    expect(mod.TENANTS).not.toContain('qtaco');
    expect(mod.TENANTS_RELLENO).toContain('qtaco');
    expect(mod.TENANTS_RELLENO.filter((t) => !mod.TENANTS.includes(t))).toEqual(['qtaco']);
  });
});

describe('B2. las filas (vocabulario cerrado, sin duplicar)', () => {
  for (const t of ['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio', 'qtaco']) {
    it(`${t}: una fila por contacto, solo los campos que existen; J..M y U vacías; ningún texto libre`, () => {
      const mapa = mapaDe(t);
      const r = mod.construirFilas({ conversaciones: [conv(1, { origen: 'anuncio' }), conv(2)], hoja: { telefonos: [], ids: [], ultimaFila: 3 }, mapa });
      expect(r.filas).toHaveLength(2);
      const L = (c: string) => c.charCodeAt(0) - 65;
      const a = r.filas[0], b = r.filas[1];
      expect(a[L(mapa['columnas'].id.letra)]).toBe(`${mapa['prefijoId']}${mapa['primerId']}`);
      expect(b[L(mapa['columnas'].id.letra)]).toBe(`${mapa['prefijoId']}${mapa['primerId'] + 1}`);
      expect(a[L(mapa['columnas'].origen.letra)]).toBe(mapa['alCrear'].origenAnuncio);
      expect(b[L(mapa['columnas'].origen.letra)]).toBe(mapa['alCrear'].origen);
      expect(a[L(mapa['columnas'].clasificacion.letra)]).toBe(''); // sin evaluar: la escribe el bot en el primer turno real
      expect(a[L(mapa['columnas'].calificacion.letra)]).toBe('');
      expect(a[L(mapa['columnas'].telefono.letra)]).toBe("'59170000001");
      for (const campo of ['valor', 'responsable', 'proximaAccion', 'diagnostico']) {
        const e = mapa['equipo'][campo];
        if (e && e.letra.charCodeAt(0) - 65 < a.length) expect(a[L(e.letra)], campo).toBe('');
      }
      for (const campo of ['quePidio', 'diaPreferido', 'horarioPreferido', 'derivacion', 'ventana24h']) expect(a[L(mapa['columnas'][campo].letra)], campo).toBe('');
      expect(a.join('|')).not.toMatch(/pag[óo]|pagado|acredit/i);
      expect(a.length).toBe(L(mapa['columnas'].ventana24h.letra) + 1);
    });
  }

  it('el ID sigue al mayor que ya hay en la hoja, aunque haya huecos; el contacto más antiguo recibe el ID más bajo', () => {
    const mapa = mapaDe('rroca-ruben');
    const r = mod.construirFilas({ conversaciones: [conv(5), conv(2)], hoja: { telefonos: [], ids: ['LEAD-1001', 'lead-1040', 'LEAD-x'], ultimaFila: 9 }, mapa });
    const id = mapa['columnas'].id.letra.charCodeAt(0) - 65;
    expect(r.filas.map((f) => f[id])).toEqual(['LEAD-1041', 'LEAD-1042']);
    expect(r.filas[0][mapa['columnas'].telefono.letra.charCodeAt(0) - 65]).toContain('59170000002');
  });

  it('NEGADO: un teléfono que ya tiene fila (con apóstrofo, +, espacios) NO se duplica ni se actualiza; tampoco un repetido ni uno sin teléfono', () => {
    const mapa = mapaDe('rroca-evy');
    const r = mod.construirFilas({
      conversaciones: [conv(1), conv(2), conv(2), conv(3, { telefono: '' }), conv(4, { telefono: '123' }), conv(5)],
      hoja: { telefonos: ["'59170000001", '+591 70000002'], ids: [], ultimaFila: 5 }, mapa,
    });
    expect(r.filas).toHaveLength(1); // solo el 5
    expect(r.omitidos).toEqual({ sinTelefono: 2, yaTienenFila: 3, repetidos: 0 }); // el 1, y el 2 dos veces: ya tienen fila
  });

  it('NEGADO: un nombre que empieza con signo de fórmula, o con saltos de línea, no llega como fórmula ni como varias líneas', () => {
    const mapa = mapaDe('rroca-antonio');
    const r = mod.construirFilas({ conversaciones: [conv(1, { nombre: '=HYPERLINK("http://x")' }), conv(2, { nombre: '+cmd|x' }), conv(3, { nombre: 'Ana\nPérez' })], hoja: { telefonos: [], ids: [], ultimaFila: 3 }, mapa });
    const c = mapa['columnas'].nombre.letra.charCodeAt(0) - 65;
    expect(r.filas.map((f) => f[c])).toEqual(["'HYPERLINK(\"http://x\")", "'cmd|x", "'Ana Pérez"]);
    for (const f of r.filas) expect(f[c].replace(/^'/, '')).not.toMatch(/^[=+\-@]/);
  });

  it('sin datos de fecha no se inventa fecha; el nombre vacío deja la celda vacía', () => {
    const mapa = mapaDe('rroca-emma');
    const r = mod.construirFilas({ conversaciones: [conv(1, { primeroMs: null, ultimoMs: null, nombre: '' })], hoja: { telefonos: [], ids: [], ultimaFila: 3 }, mapa });
    const L = (c: string) => c.charCodeAt(0) - 65;
    expect(r.filas[0][L(mapa['columnas'].fecha.letra)]).toBe('');
    expect(r.filas[0][L(mapa['columnas'].ultimaInteraccion.letra)]).toBe('');
    expect(r.filas[0][L(mapa['columnas'].nombre.letra)]).toBe('');
  });
});

/** Una hoja y un Firestore en memoria que cuentan las llamadas. */
function mundo(tenant: string, contactos: any[], filasHoja: string[][] = []) {
  const mapa = mapaDe(tenant);
  const valores: string[][] = [ENCABEZADOS(mapa), ...filasHoja.map((f) => [...f])];
  const llamadas = { agregar: 0, limpiar: [] as string[], leer: 0, filaDesde: [] as number[] };
  const salida: string[] = [];
  const deps = {
    mapa, log: (t: string) => salida.push(t),
    conversaciones: async () => contactos,
    leer: async () => { llamadas.leer += 1; return valores.map((f) => [...f]); },
    agregar: async (filas: Fila[], filaDesde: number) => {
      llamadas.agregar += 1;
      llamadas.filaDesde.push(filaDesde);
      const desde = mapa['filaEncabezados'] + valores.length; // la fila siguiente a la última con datos
      expect(filaDesde).toBe(desde); // el script ESCRIBE en un rango explícito: la fila que él calculó es la que sigue a la última
      for (const f of filas) valores.push(f.map((v) => String(v).replace(/^'/, '')));
      return { updatedRange: `'Leads_CRM'!A${desde}:T${desde + filas.length - 1}` };
    },
    limpiar: async (rango: string) => { llamadas.limpiar.push(rango); valores.splice(1, valores.length); },
  };
  return { mapa, valores, llamadas, salida, deps, texto: () => salida.join('\n') };
}
const cfgDe = (t: string, extra: Cfg = {}): Cfg => ({ proyecto: PROY, entorno: 'emulador', tenant: t, aplicar: false, revertir: false, respaldo: null, ...extra });

describe('B3. ejecución', () => {
  it('el SECO no escribe, devuelve 1 y solo imprime conteos (nunca teléfonos ni nombres)', async () => {
    const m = mundo('rroca-ruben', [conv(1), conv(2, { origen: 'anuncio' }), conv(3)]);
    const codigo = await mod.ejecutar(cfgDe('rroca-ruben'), m.deps);
    expect(codigo).toBe(1);
    expect(m.llamadas.agregar).toBe(0);
    expect(m.texto()).toContain('filas a crear               : 3');
    expect(m.texto()).toContain('con anuncio: 1');
    expect(m.texto()).not.toMatch(/59170000|Contacto \d/);
  });

  it('--aplicar guarda el respaldo, escribe UNA vez y relee; la segunda corrida no escribe nada', async () => {
    const m = mundo('rroca-antonio', [conv(1), conv(2), conv(3), conv(4)]);
    const resp = rutaRespaldo();
    const codigo = await mod.ejecutar(cfgDe('rroca-antonio', { aplicar: true, respaldo: resp }), m.deps);
    expect(codigo, m.texto()).toBe(0);
    expect(m.llamadas.agregar).toBe(1);
    expect(m.valores).toHaveLength(1 + 4);
    const rr = JSON.parse(readFileSync(resp, 'utf8'));
    expect(rr).toMatchObject({ campo: 'relleno-crm-historico', tenant: 'rroca-antonio', entorno: 'emulador' });
    expect(rr.escrito).toHaveLength(4);
    expect(rr.filaDesde).toBe(4);
    expect(m.texto()).not.toMatch(/59170000|Contacto \d/);
    // segunda corrida: nada que crear, ninguna escritura
    const otra = await mod.ejecutar(cfgDe('rroca-antonio', { aplicar: true, respaldo: rutaRespaldo() }), { ...m.deps, log: () => {} });
    expect(otra).toBe(0);
    expect(m.llamadas.agregar).toBe(1);
  });

  it('NEGADO: un respaldo que ya existe no se pisa (2, sin escribir); una hoja sin encabezados (3, sin escribir)', async () => {
    const m = mundo('rroca-evy', [conv(1)]);
    const resp = rutaRespaldo();
    await mod.ejecutar(cfgDe('rroca-evy', { aplicar: true, respaldo: resp }), m.deps);
    const m2 = mundo('rroca-evy', [conv(7)]);
    expect(await mod.ejecutar(cfgDe('rroca-evy', { aplicar: true, respaldo: resp }), m2.deps)).toBe(2);
    expect(m2.llamadas.agregar).toBe(0);
    const vacia = mundo('rroca-evy', [conv(1)]);
    vacia.valores.splice(0, vacia.valores.length);
    expect(await mod.ejecutar(cfgDe('rroca-evy', { aplicar: true, respaldo: rutaRespaldo() }), vacia.deps)).toBe(3);
    expect(vacia.llamadas.agregar).toBe(0);
  });

  it('NEGADO: si la relectura no ve las filas nuevas, sale 3 y avisa (el respaldo queda para revertir)', async () => {
    const m = mundo('rroca-emma', [conv(1), conv(2)]);
    m.deps.agregar = async () => ({ updatedRange: "'Leads_CRM'!A4:T5" }); // Google aceptó (y dice dónde) pero no quedó nada
    expect(await mod.ejecutar(cfgDe('rroca-emma', { aplicar: true, respaldo: rutaRespaldo() }), m.deps)).toBe(3);
    expect(m.texto()).toContain('La relectura no coincide');
  });

  it('el resumen de la hoja usa solo A..T y el rango no llega a la columna del equipo U', () => {
    const mapa = mapaDe('rroca-evy');
    expect(Object.values(mapa['columnas']).map((c: any) => c.letra).sort().pop()).toBe('T');
    const texto = readFileSync(new URL('../../scripts/plataforma/relleno-crm-historico.mjs', import.meta.url), 'utf8');
    expect(texto).not.toMatch(/['"`]U['"`]|!A\d+:U/);
  });
});

describe('B3c. NEGADO: la hoja no es la esperada o cambió durante la escritura (todo sale 3 y avisa)', () => {
  it('encabezados distintos a los del mapa (el equipo movió una columna): no se escribe nada, ni siquiera el respaldo', async () => {
    const m = mundo('rroca-ruben', [conv(1)]);
    m.valores[0][4] = 'Otro título';
    const resp = rutaRespaldo();
    expect(await mod.ejecutar(cfgDe('rroca-ruben', { aplicar: true, respaldo: resp }), m.deps)).toBe(3);
    expect(m.llamadas.agregar).toBe(0);
    expect(m.texto()).toContain('encabezados');
    expect(() => readFileSync(resp)).toThrow();
  });
  it('Google dice que las filas quedaron en OTRO lugar (una fila vacía o el bot escribió en el medio): sale 3 y lo dice', async () => {
    const m = mundo('rroca-emma', [conv(1), conv(2)]);
    m.deps.agregar = async (filas: Fila[]) => { for (const f of filas) m.valores.push(f.map((v) => String(v).replace(/^'/, ''))); return { updatedRange: "'Leads_CRM'!A40:T41" }; };
    expect(await mod.ejecutar(cfgDe('rroca-emma', { aplicar: true, respaldo: rutaRespaldo() }), m.deps)).toBe(3);
    expect(m.texto()).toContain('no quedaron donde se esperaba');
    expect(m.deps.agregar).toBeDefined();
  });
  it('si tras escribir hay IDs o teléfonos repetidos (el bot escribió a la vez), sale 3 y avisa', async () => {
    const m = mundo('rroca-antonio', [conv(1)]);
    const agregarOriginal = m.deps.agregar;
    m.deps.agregar = async (filas: Fila[], filaDesde: number) => {
      const r = await agregarOriginal(filas, filaDesde);
      m.valores.push([...m.valores[m.valores.length - 1]!]); // una fila idéntica que el bot dejó a la vez (mismo ID y teléfono)
      return r;
    };
    expect(await mod.ejecutar(cfgDe('rroca-antonio', { aplicar: true, respaldo: rutaRespaldo() }), m.deps)).toBe(3);
    expect(m.texto()).toContain('repetidos');
  });
  it('REVERTIR sigue funcionando aunque Google reformatee las fechas al leerlas (solo se comparan ID y teléfono)', async () => {
    const m = mundo('rroca-ruben', [conv(1), conv(2)]);
    const resp = rutaRespaldo();
    await mod.ejecutar(cfgDe('rroca-ruben', { aplicar: true, respaldo: resp }), m.deps);
    const col = mapaDe('rroca-ruben')['columnas'];
    for (const f of m.valores.slice(1)) { f[col.fecha.letra.charCodeAt(0) - 65] = '9/1/2026'; f[col.ultimaInteraccion.letra.charCodeAt(0) - 65] = '9/1/2026 11:00:00'; }
    expect(await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, aplicar: true, respaldo: resp }), m.deps)).toBe(0);
    expect(m.llamadas.limpiar).toHaveLength(1);
  });
});

describe('B3d. formato y filas de las hojas rellenadas (04/11: fondo oscuro, fechas como número, filas desplazadas)', () => {
  const fuente = readFileSync(new URL('../../scripts/plataforma/relleno-crm-historico.mjs', import.meta.url), 'utf8');
  for (const t of ['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio', 'qtaco']) {
    it(`${t}: el formato sale de la primera fila de datos, solo A..T (jamás la U), sobre las filas nuevas y con listas y formatos condicionales`, () => {
      const mapa = mapaDe(t);
      const p = mod.pedidoDeFormato({ mapa, filaDesde: 10, cantidad: 3 });
      expect(p.origen).toEqual({ startRowIndex: mapa['filaEncabezados'], endRowIndex: mapa['filaEncabezados'] + 1, startColumnIndex: 0, endColumnIndex: 20 });
      expect(p.destino).toEqual({ startRowIndex: 9, endRowIndex: 12, startColumnIndex: 0, endColumnIndex: 20 });
      expect(p.pegados).toEqual(['PASTE_FORMAT', 'PASTE_DATA_VALIDATION', 'PASTE_CONDITIONAL_FORMATTING']);
    });
  }
  it('el origen es la fila 4 (índice 3), la de datos: nunca la de encabezados (fondo oscuro)', () => {
    const p = mod.pedidoDeFormato({ mapa: mapaDe('rroca-emma'), filaDesde: 4, cantidad: 1 });
    expect(p.origen.startRowIndex).toBe(3);
    expect(p.origen.startRowIndex).not.toBe(2);
  });
  it('NEGADO: la escritura ya no usa values:append ni INSERT_ROWS (heredaban el formato del encabezado y desplazaban las filas); va a un rango explícito', () => {
    const codigo = fuente.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(codigo).not.toMatch(/:append|insertDataOption|INSERT_ROWS/);
    expect(codigo).toContain('?valueInputOption=USER_ENTERED');
    expect(codigo).toMatch(/method: 'PUT'/);
  });
  it('agregarFilas arma el flujo temporal: ninguna expresión lleva «}}» en medio, el destino se lee antes de formatear y antes de escribir, y el rango del URL es el del cuerpo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crm-'));
    const envFile = join(dir, 'env');
    writeFileSync(envFile, 'N8N_BASE_URL=https://n8n.ejemplo.test\nN8N_API_KEY=clave-de-prueba\n');
    const real = globalThis.fetch; let flujo: any = null; let cuerpoEntrada: any = null;
    const resp = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    globalThis.fetch = (async (url: string, init: any) => {
      const u = String(url);
      if (u.includes('/credentials')) return resp({ data: [{ id: '7', name: mod.nombreCredencial('rroca-evy') }] });
      if (u.endsWith('/api/v1/workflows') && init.method === 'POST') { flujo = JSON.parse(init.body); return resp({ id: 'wf1' }); }
      if (u.includes('/webhook/')) { cuerpoEntrada = JSON.parse(init.body); return resp({ updatedRange: "'Leads_CRM'!A4:T5" }); }
      return resp({});
    }) as typeof fetch;
    try {
      const mapa = mapaDe('rroca-evy');
      const r: any = await mod.agregarFilas({ envFile, tenant: 'rroca-evy', sheet: 'HOJA', mapa, filas: [['a'], ['b']], filaDesde: 4 });
      expect(r.updatedRange).toBe("'Leads_CRM'!A4:T5");
      const nodos = flujo.nodes.map((n: any) => n.name);
      expect(nodos).toEqual(['Entrada', 'Destino', 'Propiedades', 'Formato', 'Destino 2', 'Escribir']);
      for (const n of flujo.nodes) {
        const e = n.parameters?.jsonBody;
        if (typeof e !== 'string') continue;
        const dentro = e.slice(3, e.length - 3); // lo de adentro de ={{ … }}
        expect(dentro).not.toContain('}}');
      }
      expect(cuerpoEntrada.peticiones).toHaveLength(3);
      expect(cuerpoEntrada.filas).toEqual([['a'], ['b']]);
      const esc = flujo.nodes.find((n: any) => n.name === 'Escribir');
      expect(esc.parameters.jsonBody).toContain("$('Destino 2')");
      expect(decodeURIComponent(esc.parameters.url)).toContain('A4:T5');
      expect(esc.parameters.jsonBody).toContain('A4:T5');
      expect(flujo.nodes.find((n: any) => n.name === 'Formato').parameters.jsonBody).toContain("$('Destino')");
    } finally { globalThis.fetch = real; rmSync(dir, { recursive: true, force: true }); }
  });
  it('las fechas salen como yyyy-mm-dd (y la última interacción como yyyy-mm-dd hh:mm), no como número', () => {
    const mapa = mapaDe('rroca-ruben');
    const r = mod.construirFilas({ conversaciones: [conv(1)], hoja: { telefonos: [], ids: [], ultimaFila: 3 }, mapa });
    const c = mapa['columnas'];
    expect(r.filas[0][c.fecha.letra.charCodeAt(0) - 65]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.filas[0][c.ultimaInteraccion.letra.charCodeAt(0) - 65]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it('escribe a continuación de la última fila de datos (la 4 en una hoja vacía), no donde Google decida', async () => {
    const m = mundo('rroca-evy', [conv(1), conv(2)]);
    expect(await mod.ejecutar(cfgDe('rroca-evy', { aplicar: true, respaldo: rutaRespaldo() }), m.deps)).toBe(0);
    expect(m.llamadas.filaDesde).toEqual([4]);
  });
  it('NEGADO: si el bot agregó una fila entre la lectura y la escritura, no se escribe (se pisaría) y sale 3', async () => {
    const m = mundo('rroca-emma', [conv(1)]);
    const leer = m.deps.leer; let n = 0;
    m.deps.leer = async () => { const v = await leer(); n += 1; if (n === 2) v.push(['LEAD-1001', '', '', '', '591790000000']); return v; };
    expect(await mod.ejecutar(cfgDe('rroca-emma', { aplicar: true, respaldo: rutaRespaldo() }), m.deps)).toBe(3);
    expect(m.llamadas.agregar).toBe(0);
    expect(m.texto()).toContain('La hoja cambió');
  });
});

describe('B3b. el respaldo no copia la hoja', () => {
  it('guarda solo las filas escritas y dónde: sin la hoja de antes', async () => {
    const m = mundo('rroca-evy', [conv(1)], [['LEAD-1001', '2026-10-01', 'Persona Real Ejemplo', '', "591700000099", '1. Nuevo Lead', 'WhatsApp', 'Alta', 'Resumen que puede ser sensible']]);
    const resp = rutaRespaldo();
    expect(await mod.ejecutar(cfgDe('rroca-evy', { aplicar: true, respaldo: resp }), m.deps)).toBe(0);
    const t = readFileSync(resp, 'utf8');
    expect(JSON.parse(t)).not.toHaveProperty('antes');
    expect(t).not.toMatch(/Persona Real Ejemplo|Resumen que puede ser sensible|LEAD-1001/);
  });
});

describe('B4. revertir', () => {
  it('NEGADO: si el equipo anotó algo en las columnas suyas (valor, responsable, próxima acción, o cambió el estado), revertir NO borra (2); un estado intacto «Activo» sí se puede revertir', async () => {
    const mapa = mapaDe('rroca-ruben');
    const L = (c: string) => c.charCodeAt(0) - 65;
    for (const [campo, valor] of [['valor', '150'], ['responsable', 'Ana'], ['proximaAccion', 'Llamar el lunes'], ['estado', 'Ganado']] as const) {
      const m = mundo('rroca-ruben', [conv(1), conv(2)]);
      const resp = rutaRespaldo();
      await mod.ejecutar(cfgDe('rroca-ruben', { aplicar: true, respaldo: resp }), m.deps);
      m.valores[1][L(mapa['equipo'][campo].letra)] = valor;
      expect(await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, aplicar: true, respaldo: resp }), m.deps), campo).toBe(2);
      expect(m.llamadas.limpiar, campo).toEqual([]);
    }
    const intacto = mundo('rroca-ruben', [conv(1)]);
    const r2 = rutaRespaldo();
    await mod.ejecutar(cfgDe('rroca-ruben', { aplicar: true, respaldo: r2 }), intacto.deps);
    expect(intacto.valores[1][L(mapa['equipo'].estado.letra)]).toBe(mapa['alCrear'].estado); // lo que el relleno escribió
    expect(await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, aplicar: true, respaldo: r2 }), intacto.deps)).toBe(0);
  });
  it('NEGADO: un respaldo alterado (fila inicial en el encabezado, rango falso hacia la columna U, cantidad absurda) no limpia nada: el rango se calcula', async () => {
    const m = mundo('rroca-ruben', [conv(1), conv(2)]);
    const resp = rutaRespaldo();
    await mod.ejecutar(cfgDe('rroca-ruben', { aplicar: true, respaldo: resp }), m.deps);
    const original = JSON.parse(readFileSync(resp, 'utf8'));
    for (const cambio of [{ filaDesde: 3 }, { filaDesde: 4.5 }, { filaDesde: 'x' }, { escrito: [] }]) {
      const mala = rutaRespaldo();
      writeFileSync(mala, JSON.stringify({ ...original, ...cambio }), { mode: 0o600 });
      expect(await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, aplicar: true, respaldo: mala }), m.deps), JSON.stringify(cambio)).toBe(2);
    }
    // un `rango` falso en el archivo se ignora: lo que se limpia es lo calculado (A4:T5), nunca la U
    const falso = rutaRespaldo();
    writeFileSync(falso, JSON.stringify({ ...original, rango: "'Leads_CRM'!A1:Z999" }), { mode: 0o600 });
    expect(await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, aplicar: true, respaldo: falso }), m.deps)).toBe(0);
    expect(m.llamadas.limpiar).toEqual(["'Leads_CRM'!A4:T5"]);
  });

  it('limpia solo el rango escrito, y solo si sigue siendo lo escrito', async () => {
    const m = mundo('rroca-ruben', [conv(1), conv(2)]);
    const resp = rutaRespaldo();
    await mod.ejecutar(cfgDe('rroca-ruben', { aplicar: true, respaldo: resp }), m.deps);
    const seco = await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, respaldo: resp }), m.deps);
    expect(seco).toBe(1);
    expect(m.llamadas.limpiar).toEqual([]);
    const r = await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, aplicar: true, respaldo: resp }), m.deps);
    expect(r, m.texto()).toBe(0);
    expect(m.llamadas.limpiar).toHaveLength(1);
    expect(m.llamadas.limpiar[0]).toMatch(/^'Leads_CRM'!A4:T5$/);
  });

  it('NEGADO: si alguien cambió una fila escrita, o el respaldo es de otro comercio, no se borra nada (2)', async () => {
    const m = mundo('rroca-ruben', [conv(1), conv(2)]);
    const resp = rutaRespaldo();
    await mod.ejecutar(cfgDe('rroca-ruben', { aplicar: true, respaldo: resp }), m.deps);
    m.valores[1][mapaDe('rroca-ruben')['columnas'].telefono.letra.charCodeAt(0) - 65] = '5919' + '9999' + '9999'; // el equipo corrigió el teléfono de una fila escrita
    expect(await mod.ejecutar(cfgDe('rroca-ruben', { revertir: true, aplicar: true, respaldo: resp }), m.deps)).toBe(2);
    expect(m.llamadas.limpiar).toEqual([]);
    expect(await mod.ejecutar(cfgDe('rroca-evy', { revertir: true, aplicar: true, respaldo: resp }), { ...m.deps, mapa: mapaDe('rroca-evy') })).toBe(2);
    expect(m.llamadas.limpiar).toEqual([]);
  });
});


// ===========================================================================
// Q'TACO: contactos + pedidos + reservas anteriores
// ===========================================================================
describe('Q1. Q\'Taco: mapa propio y clasificación de lo registrado antes', () => {
  it('qtaco usa su mapa (venta-minima/qtaco-3727.json): O Eligió, P Reserva, Q Pedido; los rroca-* siguen con el suyo', () => {
    const m = mapaDe('qtaco');
    expect(m['columnas'].quePidio).toMatchObject({ letra: 'O', titulo: 'Eligió' });
    expect(m['columnas'].diaPreferido).toMatchObject({ letra: 'P', titulo: 'Reserva' });
    expect(m['columnas'].horarioPreferido).toMatchObject({ letra: 'Q', titulo: 'Pedido' });
    expect(mapaDe('rroca-evy')['columnas'].quePidio.titulo).not.toBe('Eligió');
  });
  it('clasifica cierres: pedido sin QR, reserva, pedido con QR cotejado; NEGADO: PRUEBA, sin detalle reconocible, otros tipos', () => {
    expect(mod.clasificarCierre({ tipo: 'registro', referencia: 'ped-1', detalle: 'Pedido #AB12 (sin QR, delivery): 2 x X. Total Bs 10.' })).toBe('pedido');
    expect(mod.clasificarCierre({ tipo: 'registro', referencia: 'res-2026-11-05-0001-abc', detalle: 'Solicitud de reserva #K9: x' })).toBe('reserva');
    expect(mod.clasificarCierre({ tipo: 'registro', referencia: 'res-2026-11-05-0001-abc', detalle: undefined })).toBe('reserva');
    expect(mod.clasificarCierre({ tipo: 'venta', referencia: 'ped-1', detalle: 'lo que sea' })).toBe('pedido');
    expect(mod.clasificarCierre({ tipo: 'registro', referencia: 'ped-9', detalle: 'PRUEBA · cobro SIMULADO (sin dinero) · Pedido #A1' })).toBe('prueba');
    expect(mod.clasificarCierre({ tipo: 'registro', referencia: 'ped-9', detalle: 'Solicitud registrada: revisar el chat con el cliente.' })).toBe('otro');
    expect(mod.clasificarCierre({ tipo: 'cita', referencia: 'x', detalle: 'Pedido #1' })).toBe('otro');
  });
});

describe('Q2. reunir compras (puro)', () => {
  const T = Date.UTC(2026, 10, 5, 18, 30); // 2026-11-05 14:30 La Paz
  it('un pedido que está en el cierre y en la colección cuenta UNA vez, con la hora más temprana; el más reciente de cada clase gana', () => {
    const r = mod.reunirCompras([
      { telefono: '59170000001', tipo: 'pedido', clave: 'ped-1', ms: T + 60_000 },
      { telefono: '59170000001', tipo: 'pedido', clave: 'wa_ped-1', ms: T },
      { telefono: '59170000001', tipo: 'pedido', clave: 'ped-2', ms: T + 3600_000 },
      { telefono: '59170000001', tipo: 'reserva', clave: 'res-1', ms: T - 3600_000 },
    ], { ahoraMs: T + 86_400_000 });
    expect(r.conteos).toMatchObject({ pedidos: 2, reservas: 1 });
    expect(r.porTelefono.get('59170000001')).toMatchObject({ pedidoMs: T + 3600_000, reservaMs: T - 3600_000 });
  });
  it('NEGADO: sin teléfono, sin fecha válida (o futura) o excluido no entran; nada de eso crea una compra', () => {
    const r = mod.reunirCompras([
      { telefono: '', tipo: 'pedido', clave: 'a', ms: T }, { telefono: '59170000001', tipo: 'pedido', clave: 'b', ms: null },
      { telefono: '59170000001', tipo: 'pedido', clave: 'c', ms: T + 10 * 86_400_000 }, { telefono: '+591 7000-0002', tipo: 'reserva', clave: 'd', ms: T },
      { telefono: '59170000003', tipo: 'otro', clave: 'e', ms: T },
    ], { excluir: ['59170000002', ''], ahoraMs: T + 86_400_000 });
    expect(r.porTelefono.size).toBe(0);
    expect(r.conteos.descartados).toEqual({ sinTelefono: 1, sinFecha: 2, excluidos: 1, pruebas: 0 });
  });
  it('las celdas usan el vocabulario del bot: Enviada / Registrado + fecha hora La Paz; O es la última elección; vacío si no hay dato; nunca pagado/acreditado', () => {
    expect(mod.celdasDeCompra({ pedidoMs: T, reservaMs: null })).toEqual({ quePidio: 'Pedido', diaPreferido: '', horarioPreferido: 'Registrado 2026-11-05 14:30' });
    expect(mod.celdasDeCompra({ pedidoMs: T, reservaMs: T + 60_000 })).toEqual({ quePidio: 'Reserva', diaPreferido: 'Enviada 2026-11-05 14:31', horarioPreferido: 'Registrado 2026-11-05 14:30' });
    expect(JSON.stringify(mod.celdasDeCompra({ pedidoMs: T, reservaMs: T }))).not.toMatch(/pag[óo]|pagado|acredit|simulad|Bs/i);
  });
});

describe('Q3. filas nuevas de Q\'Taco con compras', () => {
  const mapa = mapaDe('qtaco');
  const L = (c: string) => c.charCodeAt(0) - 65;
  const T = Date.UTC(2026, 10, 5, 18, 30);
  const compras = new Map([['59170000001', { pedidoMs: T, reservaMs: null }], ['59170000009', { pedidoMs: null, reservaMs: T }]]);
  it('el contacto con pedido lleva O y Q; el que solo tiene compra (sin conversación) también es una fila, con P; el que no compró deja O/P/Q vacías', () => {
    const r = mod.construirFilas({ conversaciones: [conv(1), conv(2)], hoja: { telefonos: [], ids: [], ultimaFila: 3 }, mapa, compras });
    expect(r.filas).toHaveLength(3);
    expect(r.conteos).toMatchObject({ aCrear: 3, soloCompra: 1, conCompra: 2, conPedido: 1, conReserva: 1 });
    const por = (tel: string) => r.filas.find((f) => f[L(mapa['columnas'].telefono.letra)] === `'${tel}`)!;
    const a = por('59170000001'), b = por('59170000002'), c = por('59170000009');
    expect([a[L('O')], a[L('P')], a[L('Q')]]).toEqual(['Pedido', '', 'Registrado 2026-11-05 14:30']);
    expect([b[L('O')], b[L('P')], b[L('Q')]]).toEqual(['', '', '']);
    expect([c[L('O')], c[L('P')], c[L('Q')]]).toEqual(['Reserva', 'Enviada 2026-11-05 14:30', '']);
    expect(c[L(mapa['columnas'].fecha.letra)]).toBe('2026-11-05'); // fecha de su primera compra, no inventada
    for (const f of r.filas) { expect(f.join('|')).not.toMatch(/pag[óo]|pagado|acredit|Bs \d/i); expect(f[L('N')]).toBe(''); expect(f[L('H')]).toBe(''); }
  });
  it('NEGADO: quien ya tiene fila en la hoja no se duplica aunque tenga compras; sin compras el resultado es el de siempre', () => {
    const r = mod.construirFilas({ conversaciones: [conv(1)], hoja: { telefonos: ["'59170000001", '59170000009'], ids: [], ultimaFila: 5 }, mapa, compras });
    expect(r.filas).toHaveLength(0);
    const sin = mod.construirFilas({ conversaciones: [conv(1)], hoja: { telefonos: [], ids: [], ultimaFila: 3 }, mapa });
    expect([sin.filas[0][L('O')], sin.filas[0][L('P')], sin.filas[0][L('Q')]]).toEqual(['', '', '']);
  });
});

describe('Q4. propuesta para filas existentes: solo celdas vacías de O/P/Q, y nunca se aplica', () => {
  const mapa = mapaDe('qtaco');
  const T = Date.UTC(2026, 10, 5, 18, 30);
  const fila = (tel: string, o = '', p = '', q = '') => { const f = new Array(20).fill(''); f[4] = tel; f[14] = o; f[15] = p; f[16] = q; return f; };
  it('completa solo lo vacío; no pisa un dato del bot ni del equipo; toma la última fila del teléfono', () => {
    const valores = [ENCABEZADOS(mapa), fila('59170000001'), fila('59170000002', 'Reserva', 'Enviada 2026-11-01 10:00', ''), fila('59170000003', 'Pedido', '', 'Registrado 2026-11-02 10:00'), fila('59170000001', 'Consulta')];
    const compras = new Map([
      ['59170000001', { pedidoMs: T, reservaMs: null }], ['59170000002', { pedidoMs: T, reservaMs: T }], ['59170000003', { pedidoMs: T, reservaMs: null }], ['59170000004', { pedidoMs: T, reservaMs: null }],
    ]);
    const r = mod.construirActualizaciones({ valores, mapa, compras });
    expect(r.conteos).toMatchObject({ existentesConCompra: 3, aCompletar: 2, sinHuecos: 1, conVariasFilas: 1 });
    // 59170000001: última fila (la 7): O ya dice «Consulta» (no se pisa), solo Q
    expect(r.propuestas).toContainEqual({ fila: 7, telefono: '59170000001', celdas: { Q: 'Registrado 2026-11-05 14:30' } });
    // 59170000002: P ya tenía dato, O también; solo Q (vacía)
    expect(r.propuestas).toContainEqual({ fila: 5, telefono: '59170000002', celdas: { Q: 'Registrado 2026-11-05 14:30' } });
    expect(r.propuestas.find((p) => p.fila === 6)).toBeUndefined(); // sin huecos: nada
    for (const p of r.propuestas) expect(Object.keys(p.celdas).every((l) => ['O', 'P', 'Q'].includes(l))).toBe(true); // jamás J..M ni U
  });
  it('NEGADO: los rroca-* no leen compras aunque la dependencia exista; la salida del seco no trae teléfonos ni nombres', async () => {
    const m = mundo('rroca-evy', [conv(1)]);
    let llamada = 0;
    await mod.ejecutar(cfgDe('rroca-evy'), { ...m.deps, compras: async () => { llamada += 1; return { porTelefono: new Map(), conteos: {} }; } });
    expect(llamada).toBe(0);
    expect(m.texto()).not.toContain('compras registradas');
  });
  it('el script no imprime teléfonos, nombres ni detalles: sus log() solo llevan conteos', () => {
    const f = readFileSync(new URL('../../scripts/plataforma/relleno-crm-historico.mjs', import.meta.url), 'utf8');
    expect(f).not.toMatch(/log\([^)]*\.(telefono|nombre|detalle)\b/);
  });
});


describe('Q5. --aplicar completa O/P/Q de filas existentes (solo vacías) y --revertir lo deshace', () => {
  const T = Date.UTC(2026, 10, 5, 18, 30);
  const fila = (id: string, tel: string, o = '', p = '', q = '') => { const f = new Array(20).fill(''); f[0] = id; f[4] = tel; f[14] = o; f[15] = p; f[16] = q; f[9] = '150'; f[10] = 'Ana'; return f; };
  const comprasDe = (m: Record<string, { pedidoMs: number | null; reservaMs: number | null }>) => ({ porTelefono: new Map(Object.entries(m)), conteos: { pedidos: 1, reservas: 0, descartados: { sinTelefono: 0, sinFecha: 0, excluidos: 0 } } });
  /** Un mundo de Q'Taco con las dos escrituras nuevas simuladas sobre la hoja en memoria. */
  function mundoQ(contactos: any[], filas: string[][], compras: ReturnType<typeof comprasDe>) {
    const m = mundo('qtaco', contactos, filas);
    const cel = (c: string) => ({ f: Number(c.slice(1)) - 3, c: c.charCodeAt(0) - 65 });
    const escrituras: { rango: string; valor: string }[][] = [];
    const limpiezas: string[][] = [];
    const deps = { ...m.deps, compras: async () => compras, excluir: ['59170000008'],
      completar: async (celdas: { rango: string; valor: string }[]) => { escrituras.push(celdas); for (const c of celdas) { const { f, c: j } = cel(c.rango.split('!')[1]); m.valores[f][j] = c.valor; } },
      limpiarCeldas: async (rangos: string[]) => { limpiezas.push(rangos); for (const r of rangos) { const { f, c: j } = cel(r.split('!')[1]); m.valores[f][j] = ''; } } };
    return { m, deps, escrituras, limpiezas };
  }
  const base = () => [fila('LEAD-1001', '59170000001'), fila('LEAD-1002', '59170000002', 'Consulta', '', ''), fila('LEAD-1003', '59170000003', 'Pedido', '', 'Registrado 2026-11-01 09:00')];
  const compras = () => comprasDe({ '59170000001': { pedidoMs: T, reservaMs: T + 60_000 }, '59170000002': { pedidoMs: T, reservaMs: null }, '59170000003': { pedidoMs: T, reservaMs: null } });

  it('--aplicar escribe solo las celdas vacías (O/P/Q), por rango explícito, con respaldo sin teléfonos; nunca J..M ni U; la segunda corrida no escribe', async () => {
    const w = mundoQ([], base(), compras());
    const resp = rutaRespaldo();
    expect(await mod.ejecutar(cfgDe('qtaco'), w.deps)).toBe(1); // seco
    expect(w.escrituras).toHaveLength(0);
    expect(w.m.texto()).toContain('a completar: 2 fila(s), 4 celda(s)');
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: resp }), w.deps), w.m.texto()).toBe(0);
    expect(w.escrituras).toHaveLength(1);
    const rangos = w.escrituras[0].map((c) => c.rango).sort();
    expect(rangos).toEqual(["'Leads_CRM'!O4", "'Leads_CRM'!P4", "'Leads_CRM'!Q4", "'Leads_CRM'!Q5"]); // 1002 conserva su «Consulta»; 1003 no tiene huecos
    expect(w.m.valores[1].slice(14, 17)).toEqual(['Reserva', 'Enviada 2026-11-05 14:31', 'Registrado 2026-11-05 14:30']);
    expect(w.m.valores[2].slice(14, 17)).toEqual(['Consulta', '', 'Registrado 2026-11-05 14:30']);
    expect(w.m.valores[3].slice(14, 17)).toEqual(['Pedido', '', 'Registrado 2026-11-01 09:00']); // intacta
    for (const f of w.m.valores.slice(1)) { expect(f[9]).toBe('150'); expect(f[10]).toBe('Ana'); expect(f[20] ?? '').toBe(''); }
    const rr = JSON.parse(readFileSync(resp, 'utf8'));
    expect(rr.campo).toBe('relleno-crm-historico-completar');
    expect(rr.escrito).toHaveLength(4);
    expect(readFileSync(resp, 'utf8')).not.toMatch(/59170000|LEAD-/);
    expect(w.m.texto()).not.toMatch(/59170000/);
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: rutaRespaldo() }), { ...w.deps, log: () => {} })).toBe(0);
    expect(w.escrituras).toHaveLength(1);
  });

  it('NEGADO: una celda que el equipo llenó entre el seco y la escritura NO se pisa (se relee justo antes)', async () => {
    const w = mundoQ([], base(), compras());
    const leer = w.deps.leer; let n = 0;
    w.deps.leer = async () => { n += 1; const v = await leer(); if (n === 2) v[1][16] = 'Lo escribió el equipo'; return v; };
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: rutaRespaldo() }), w.deps)).toBe(0);
    const escritos = w.escrituras.flat().map((c) => c.rango);
    expect(escritos).not.toContain("'Leads_CRM'!Q4");
  });

  it('NEGADO: un respaldo existente no se pisa (2, sin escribir); sin compras no se escribe nada', async () => {
    const w = mundoQ([], base(), compras());
    const resp = rutaRespaldo();
    writeFileSync(resp, '{}', { mode: 0o600 });
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: resp }), w.deps)).toBe(2);
    expect(w.escrituras).toHaveLength(0);
    const v = mundoQ([], base(), comprasDe({}));
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: rutaRespaldo() }), v.deps)).toBe(0);
    expect(v.escrituras).toHaveLength(0);
  });

  it('con filas nuevas y existentes a la vez: el respaldo de filas es el indicado y el de celdas es «<ruta>.completar»', async () => {
    const w = mundoQ([conv(7)], base(), compras());
    const resp = rutaRespaldo();
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: resp }), w.deps), w.m.texto()).toBe(0);
    expect(JSON.parse(readFileSync(resp, 'utf8')).campo).toBe('relleno-crm-historico');
    expect(JSON.parse(readFileSync(`${resp}.completar`, 'utf8')).campo).toBe('relleno-crm-historico-completar');
    expect(w.m.valores).toHaveLength(1 + 3 + 1);
  });

  it('REVERTIR limpia solo las celdas escritas y solo si siguen igual; NEGADO: una celda cambiada, otro comercio o una celda fuera de O/P/Q no borran nada', async () => {
    const w = mundoQ([], base(), compras());
    const resp = rutaRespaldo();
    await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: resp }), w.deps);
    expect(await mod.ejecutar(cfgDe('qtaco', { revertir: true, respaldo: resp }), w.deps)).toBe(1); // seco
    expect(w.limpiezas).toHaveLength(0);
    // el equipo cambió una celda escrita
    w.m.valores[1][16] = 'Cambiada por el equipo';
    expect(await mod.ejecutar(cfgDe('qtaco', { revertir: true, aplicar: true, respaldo: resp }), w.deps)).toBe(2);
    expect(w.limpiezas).toHaveLength(0);
    w.m.valores[1][16] = 'Registrado 2026-11-05 14:30';
    // respaldo alterado: una celda J (del equipo)
    const original = JSON.parse(readFileSync(resp, 'utf8'));
    const mala = rutaRespaldo();
    writeFileSync(mala, JSON.stringify({ ...original, escrito: [{ celda: 'J4', valor: '150' }] }), { mode: 0o600 });
    expect(await mod.ejecutar(cfgDe('qtaco', { revertir: true, aplicar: true, respaldo: mala }), w.deps)).toBe(2);
    expect(await mod.ejecutar(cfgDe('rroca-evy', { revertir: true, aplicar: true, respaldo: resp }), { ...w.deps, mapa: mapaDe('rroca-evy') })).toBe(2);
    expect(w.limpiezas).toHaveLength(0);
    // el revertir correcto
    expect(await mod.ejecutar(cfgDe('qtaco', { revertir: true, aplicar: true, respaldo: resp }), w.deps)).toBe(0);
    expect(w.limpiezas).toHaveLength(1);
    expect(w.limpiezas[0].sort()).toEqual(["'Leads_CRM'!O4", "'Leads_CRM'!P4", "'Leads_CRM'!Q4", "'Leads_CRM'!Q5"]);
    expect(w.m.valores[1].slice(14, 17)).toEqual(['', '', '']);
    expect(w.m.valores[2][14]).toBe('Consulta'); // lo que ya estaba antes se conserva
    expect(w.m.valores[3].slice(14, 17)).toEqual(['Pedido', '', 'Registrado 2026-11-01 09:00']);
  });

  it('el flujo temporal de n8n lee las celdas antes de escribir y se corta si alguna tiene dato; ninguna expresión lleva «}}» en medio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crm-')); const envFile = join(dir, 'env');
    writeFileSync(envFile, 'N8N_BASE_URL=https://n8n.ejemplo.test\nN8N_API_KEY=clave-de-prueba\n');
    const real = globalThis.fetch; let flujo: any = null; let cuerpoEntrada: any = null;
    const resp = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    globalThis.fetch = (async (url: string, init: any) => {
      const u = String(url);
      if (u.includes('/credentials')) return resp({ data: [{ id: '7', name: mod.nombreCredencial('qtaco') }] });
      if (u.endsWith('/api/v1/workflows') && init.method === 'POST') { flujo = JSON.parse(init.body); return resp({ id: 'wf1' }); }
      if (u.includes('/webhook/')) { cuerpoEntrada = JSON.parse(init.body); return resp({ totalUpdatedCells: 2 }); }
      return resp({});
    }) as typeof fetch;
    try {
      await mod.completarCeldas({ envFile, tenant: 'qtaco', sheet: 'HOJA', celdas: [{ rango: "'Leads_CRM'!O4", valor: 'Pedido', fila: 4, tel: '59170000001' }, { rango: "'Leads_CRM'!Q4", valor: 'Registrado 2026-11-05 14:30', fila: 4, tel: '59170000001' }] });
      expect(flujo.nodes.map((n: any) => n.name)).toEqual(['Entrada', 'Destino', 'Escribir']);
      const dest = flujo.nodes.find((n: any) => n.name === 'Destino').parameters.url;
      expect(dest).toContain('values:batchGet'); expect(decodeURIComponent(dest)).toContain("ranges='Leads_CRM'!O4"); expect(decodeURIComponent(dest)).toContain("ranges='Leads_CRM'!Q4"); expect(decodeURIComponent(dest)).toContain("ranges='Leads_CRM'!E4");
      expect(cuerpoEntrada.telefonos).toEqual(['59170000001']); expect(cuerpoEntrada.n).toBe(2);
      // La expresión del flujo, evaluada con datos simulados: coincide -> escribe; fila movida o celda ocupada -> se corta.
      const evaluar = (valueRanges: unknown[]) => { const e = flujo.nodes.find((n: any) => n.name === 'Escribir').parameters.jsonBody as string;
        const $ = (nombre: string) => ({ first: () => ({ json: nombre === 'Destino' ? { valueRanges } : { body: cuerpoEntrada } }) });
        return runInNewContext(`(function ($) { return ${e.slice(3, e.length - 2)}; })`, {})($) as string; };
      const vacio = { values: undefined }; const tel = (v: string) => ({ values: [[v]] });
      expect(JSON.parse(evaluar([vacio, vacio, tel("'59170000001")])).data).toHaveLength(2);
      expect(() => evaluar([vacio, vacio, tel('59170000009')])).toThrow('celda ocupada'); // la fila se reordenó entre la relectura y la escritura
      expect(() => evaluar([vacio, vacio, vacio])).toThrow('celda ocupada'); // la fila desapareció
      expect(() => evaluar([vacio, { values: [['x']] }, tel('59170000001')])).toThrow('celda ocupada'); // una celda dejó de estar vacía
      const esc = flujo.nodes.find((n: any) => n.name === 'Escribir').parameters;
      expect(esc.url).toContain('values:batchUpdate'); expect(esc.jsonBody).toContain("$('Destino')"); expect(esc.jsonBody).toContain('celda ocupada');
      expect(esc.jsonBody.slice(3, esc.jsonBody.length - 3)).not.toContain('}}');
      expect(cuerpoEntrada.datos).toEqual([{ range: "'Leads_CRM'!O4", majorDimension: 'ROWS', values: [['Pedido']] }, { range: "'Leads_CRM'!Q4", majorDimension: 'ROWS', values: [['Registrado 2026-11-05 14:30']] }]);
    } finally { globalThis.fetch = real; rmSync(dir, { recursive: true, force: true }); }
  });
});


describe('Q6. teléfonos de prueba: fuera de los contactos nuevos y fuera los pedidos de cierres de prueba', () => {
  const T = Date.UTC(2026, 10, 5, 18, 30);
  it('TELEFONOS_EXCLUIDOS (deps.excluir) quita también a los contactos antes de construir filas; solo se imprime el conteo', async () => {
    const m = mundo('qtaco', [conv(1), conv(2), conv(3)]);
    const deps = { ...m.deps, excluir: ['+591 70000002', ''] };
    expect(await mod.ejecutar(cfgDe('qtaco'), deps)).toBe(1);
    expect(m.texto()).toContain('filas a crear               : 2');
    expect(m.texto()).toContain('más 1 excluidas');
    expect(m.texto()).not.toMatch(/59170000/);
  });
  it('NEGADO: un pedido de la colección cuya clave coincide con un cierre de prueba no cuenta (con o sin el prefijo wa_)', () => {
    const r = mod.reunirCompras([
      { telefono: '59170000001', tipo: 'pedido', clave: 'wa_ped-prueba', ms: T }, { telefono: '59170000001', tipo: 'pedido', clave: 'ped-real', ms: T },
    ], { clavesDePrueba: ['ped-prueba'], ahoraMs: T + 86_400_000 });
    expect(r.conteos).toMatchObject({ pedidos: 1 });
    expect(r.conteos.descartados.pruebas).toBe(1);
  });
});


describe('Q7. varias filas por teléfono, exclusiones obligatorias, leerCompras, celda ocupada', () => {
  const mapa = mapaDe('qtaco');
  const T = Date.UTC(2026, 10, 5, 18, 30); // 2026-11-05
  const DIA = 86_400_000;
  const fila = (tel: string, fecha: string) => { const f = new Array(20).fill(''); f[1] = fecha; f[4] = tel; return f; };

  it('con varias filas, cada compra va a la fila cuya fecha es la última anterior o igual: la del 05/11 a la del 04/11 y la del 26/10 a la del 20/10', () => {
    const valores = [ENCABEZADOS(mapa), fila('59170000001', '2026-10-01'), fila('59170000001', '2026-10-20'), fila('59170000001', '2026-11-04')];
    const eventos = [{ tipo: 'pedido', ms: T - 10 * DIA }, { tipo: 'reserva', ms: T }];
    const r = mod.construirActualizaciones({ valores, mapa, compras: new Map([['59170000001', { pedidoMs: T - 10 * DIA, reservaMs: T, eventos }]]) });
    expect(r.propuestas.map((p) => [p.fila, Object.keys(p.celdas).sort().join('')])).toEqual([[5, 'OQ'], [6, 'OP']]);
    expect(r.propuestas.find((p) => p.fila === 5)?.celdas['O']).toBe('Pedido');
    expect(r.propuestas.find((p) => p.fila === 6)?.celdas['O']).toBe('Reserva');
  });

  it('NEGADO: --aplicar en Q\'Taco sin TELEFONOS_EXCLUIDOS sale 2 y no escribe; el seco sí corre y muestra los teléfonos con varias filas', async () => {
    const m = mundo('qtaco', [conv(1)]);
    const compras = { porTelefono: new Map(), conteos: { pedidos: 0, reservas: 0, descartados: { sinTelefono: 0, sinFecha: 0, excluidos: 0, pruebas: 0 } } };
    const deps = { ...m.deps, compras: async () => compras };
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: rutaRespaldo() }), deps)).toBe(2);
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: rutaRespaldo() }), { ...deps, excluir: [' ', ''] })).toBe(2);
    expect(m.llamadas.agregar).toBe(0);
    expect(m.texto()).toContain('TELEFONOS_EXCLUIDOS');
    expect(await mod.ejecutar(cfgDe('qtaco'), deps)).toBe(1);
    expect(m.texto()).toContain('teléfonos con varias filas');
  });

  it('NEGADO: si <ruta>.completar ya existe, se avisa ANTES de escribir las filas nuevas (2, nada escrito)', async () => {
    const f = new Array(20).fill(''); f[0] = 'LEAD-1001'; f[4] = '59170000001';
    const m = mundo('qtaco', [conv(7)], [f]);
    const compras = { porTelefono: new Map([['59170000001', { pedidoMs: T, reservaMs: null, eventos: [{ tipo: 'pedido', ms: T }] }]]), conteos: { pedidos: 1, reservas: 0, descartados: { sinTelefono: 0, sinFecha: 0, excluidos: 0, pruebas: 0 } } };
    const resp = rutaRespaldo();
    writeFileSync(`${resp}.completar`, '{}', { mode: 0o600 });
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: resp }), { ...m.deps, compras: async () => compras, excluir: ['59170000008'] })).toBe(2);
    expect(m.llamadas.agregar).toBe(0);
    expect(m.texto()).toContain('<ruta>.completar');
  });

  it('«celda ocupada»: si el flujo corta antes de escribir, sale 3, la hoja no cambia, el respaldo conserva las celdas previstas y revertirlo no borra nada', async () => {
    const f = new Array(20).fill(''); f[0] = 'LEAD-1001'; f[4] = '59170000001';
    const m = mundo('qtaco', [], [f]);
    const compras = { porTelefono: new Map([['59170000001', { pedidoMs: T, reservaMs: null, eventos: [{ tipo: 'pedido', ms: T }] }]]), conteos: { pedidos: 1, reservas: 0, descartados: { sinTelefono: 0, sinFecha: 0, excluidos: 0, pruebas: 0 } } };
    const deps = { ...m.deps, compras: async () => compras, excluir: ['59170000008'], completar: async () => { throw Object.assign(new Error('celda ocupada'), { code: 'n8n-llamada-500' }); }, limpiarCeldas: async () => { throw new Error('no debe limpiar'); } };
    const resp = rutaRespaldo();
    expect(await mod.ejecutar(cfgDe('qtaco', { aplicar: true, respaldo: resp }), deps)).toBe(3);
    expect(m.texto()).toContain('No se completó nada');
    expect(m.valores[1].slice(14, 17)).toEqual(['', '', '']);
    const rr = JSON.parse(readFileSync(resp, 'utf8'));
    expect(rr.escrito).toEqual([{ celda: 'O4', valor: 'Pedido' }, { celda: 'Q4', valor: 'Registrado 2026-11-05 14:30' }]);
    expect(await mod.ejecutar(cfgDe('qtaco', { revertir: true, aplicar: true, respaldo: resp }), deps)).toBe(2); // las celdas no tienen ese valor: no se borra nada
  });

  // --- leerCompras con documentos simulados ---
  const ts = (ms: number) => ({ toMillis: () => ms });
  function dbFalsa(cierres: { id: string; x: Record<string, unknown>; priv?: Record<string, unknown> }[], pedidos: { id: string; x: Record<string, unknown> }[]) {
    const llamadas: any[] = [];
    const privados = new Map<string, Record<string, unknown> | undefined>();
    const db = {
      collection: (ruta: string) => {
        const consulta = (filtro: { campo: string; op: string; v: unknown } | null) => ({ select: (...campos: string[]) => ({ get: async () => {
          llamadas.push({ ruta, ...(filtro ?? {}), campos });
          if (ruta.endsWith('/cierres')) return { docs: cierres.map((c) => { privados.set(c.id, c.priv); return { id: c.id, data: () => c.x, ref: { collection: () => ({ doc: () => ({ __id: c.id }) }) } }; }) };
          return { docs: pedidos.map((p) => ({ id: p.id, data: () => p.x })) };
        } }) });
        return { where: (campo: string, op: string, v: unknown) => consulta({ campo, op, v }), select: (...campos: string[]) => consulta(null).select(...campos) };
      },
      getAll: async (...args: any[]) => { const opciones = args.pop(); llamadas.push({ getAll: opciones }); return args.map((r) => ({ exists: privados.get(r.__id) !== undefined, data: () => privados.get(r.__id) })); },
    };
    return { db, llamadas };
  }
  it('leerCompras: pedido en cierre y en la colección = UNO (la clave coincide: wa_ + pedidoId); venta cotejada cuenta; prueba y teléfonos excluidos no; solo se piden los campos mínimos', async () => {
    const { db, llamadas } = dbFalsa([
      { id: 'registro_ped-A', x: { tipo: 'registro', referencia: 'ped-A', ocurridoEn: ts(T) }, priv: { telefono: '59170000001', detalle: 'Pedido #AB (sin QR, delivery): 2 x Taco. Total Bs 40.' } },
      { id: 'venta_ped-B', x: { tipo: 'venta', referencia: 'ped-B', ocurridoEn: ts(T + 60_000) }, priv: { telefono: '59170000002' } },
      { id: 'registro_ped-P', x: { tipo: 'registro', referencia: 'ped-P', ocurridoEn: ts(T) }, priv: { telefono: '59170000003', detalle: 'PRUEBA · cobro SIMULADO (sin dinero) · Pedido #ZZ' } },
      { id: 'registro_res-1', x: { tipo: 'registro', referencia: 'res-2026-11-05-0004-x', ocurridoEn: ts(T) }, priv: { telefono: '59170000001', detalle: 'Solicitud de reserva #K9' } },
      { id: 'registro_ped-X', x: { tipo: 'registro', referencia: 'ped-X', ocurridoEn: ts(T) }, priv: { telefono: '59170000009', detalle: 'Pedido #XX (sin QR, recojo)' } },
    ], [
      { id: 'wa_ped-A', x: { origen: 'whatsapp', conversacionId: 'wa_59170000001', creadoEn: ts(T - 120_000) } },
      { id: 'wa_ped-B', x: { origen: 'whatsapp', conversacionId: 'wa_59170000002', creadoEn: ts(T + 30_000) } },
      { id: 'wa_ped-P', x: { origen: 'whatsapp', conversacionId: 'wa_59170000003', creadoEn: ts(T) } },
      { id: 'wa_ped-C', x: { origen: 'whatsapp', conversacionId: 'wa_59170000004', creadoEn: ts(T) } },
      { id: 'cat_web1', x: { origen: 'catalogo-web', estado: 'recibido', conversacionId: 'wa_59170000005', creadoEn: ts(T) } },
      { id: 'wa_ped-Z', x: { origen: 'whatsapp', estado: 'cancelado', conversacionId: 'wa_59170000006', creadoEn: ts(T) } },
    ]);
    const r = await mod.leerCompras(db, 'qtaco', ['59170000009']);
    expect(r.conteos).toMatchObject({ pedidos: 5, reservas: 1 }); expect(r.conteos.porOrigen).toEqual({ whatsapp: 4, 'catalogo-web': 1 }); expect(r.porTelefono.get('59170000005')).toMatchObject({ pedidoMs: T }); expect(r.porTelefono.get('59170000006')).toMatchObject({ pedidoMs: T }); // el pedido web y el cancelado SÍ cuentan; // A, B, C, la web y la cancelada; la reserva
    expect(r.conteos.descartados).toMatchObject({ pruebas: 1, excluidos: 1 }); // el pedido de la colección cuyo cierre es de prueba (el cierre mismo ni se cuenta); el teléfono excluido
    expect(r.porTelefono.get('59170000001')).toMatchObject({ pedidoMs: T - 120_000, reservaMs: T }); // hora más temprana de la clave repetida
    expect(r.porTelefono.has('59170000003')).toBe(false);
    expect(r.porTelefono.has('59170000009')).toBe(false);
    const cierresLlamada = llamadas.find((l) => l.ruta === 'tenants/qtaco/cierres');
    expect(cierresLlamada).toMatchObject({ campo: 'tipo', op: 'in', v: ['registro', 'venta'], campos: ['tipo', 'ocurridoEn', 'referencia'] });
    expect(llamadas.find((l) => l.getAll)?.getAll).toEqual({ fieldMask: ['telefono', 'detalle'] });
    expect(llamadas.find((l) => l.ruta === 'tenants/qtaco/pedidos')).toMatchObject({ campos: ['origen', 'conversacionId', 'creadoEn'] });
    expect(llamadas.find((l) => l.ruta === 'tenants/qtaco/pedidos').campo).toBeUndefined(); // sin filtro de origen
    expect(JSON.stringify([...r.porTelefono])).not.toMatch(/Taco|Bs 40|Pedido #/);
  });
});


describe('Q8. Q\'Taco entra solo al relleno: TENANTS (el de las salvaguardas de vaciar) no lo incluye', () => {
  it('TENANTS exportado = solo los rroca-*; el relleno acepta qtaco por su lista aparte; vaciar-hoja-crm lo rechaza', async () => {
    const m = mod as unknown as { TENANTS: readonly string[]; TENANTS_RELLENO: readonly string[] };
    expect(m.TENANTS).not.toContain('qtaco');
    expect(m.TENANTS_RELLENO).toContain('qtaco');
    const v = await import('../../scripts/plataforma/vaciar-hoja-crm.mjs') as unknown as { analizarArgumentos: (a: string[], e?: Record<string, string>) => { ok: boolean } };
    expect(v.analizarArgumentos(['--proyecto', PROY, '--tenant', 'qtaco'], ENV).ok).toBe(false);
  });
});
