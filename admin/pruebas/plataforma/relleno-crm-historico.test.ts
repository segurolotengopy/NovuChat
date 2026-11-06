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

type Cfg = Record<string, unknown>;
type Fila = string[];
const mod = await import('../../scripts/plataforma/relleno-crm-historico.mjs') as unknown as {
  TENANTS: readonly string[];
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  leerMapa: (t: string) => Record<string, any>;
  construirFilas: (a: { conversaciones: any[]; hoja: { telefonos: string[]; ids: string[]; ultimaFila: number }; mapa: Record<string, any> }) =>
    { filas: Fila[]; omitidos: Record<string, number>; conteos: Record<string, any> };
  resumenDeLaHoja: (valores: string[][], mapa: Record<string, any>) => { telefonos: string[]; ids: string[]; ultimaFila: number };
  pedidoDeFormato: (a: { mapa: Record<string, any>; filaDesde: number; cantidad: number }) => { origen: Record<string, number>; destino: Record<string, number>; pegados: string[] };
  ejecutar: (cfg: Cfg, deps: Record<string, any>) => Promise<number>;
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
  it('la invocación completa es válida y queda en seco; los cuatro comercios valen', () => {
    for (const t of ['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio']) expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', t], ENV).ok, t).toBe(true);
    expect(mod.analizarArgumentos(base, ENV).cfg).toMatchObject({ aplicar: false, revertir: false, entorno: 'emulador' });
  });
  it('NEGADO: otro comercio (Bellido, Q\'Taco, el chat), varios a la vez o sin tenant', () => {
    for (const t of ['bellido', 'qtaco', 'novuchat', 'rroca-evy,rroca-emma', 'todos', '__proto__']) expect(problemas(['--proyecto', PROY, '--tenant', t]), t).toContain('tiene que ser uno de');
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

describe('B2. las filas (vocabulario cerrado, sin duplicar)', () => {
  for (const t of ['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio']) {
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
  for (const t of ['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio']) {
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
