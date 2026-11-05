/**
 * Las tres herramientas de «empezar de nuevo» de un comercio (caso Rubén, 04/11/2026). Sin emulador, sin n8n y sin Google: todo se inyecta.
 *   V1. `vaciar-chats-tenant.mjs`  — Firestore: lista cerrada, seco, respaldo, un solo comercio.
 *   V2. `vaciar-memoria-flujo.mjs` — n8n: solo `staticData.global.rroca`; no usa --reiniciar-estado.
 *   V3. `vaciar-hoja-crm.mjs`      — hoja Leads_CRM: solo A4:T, nunca encabezados, fórmulas ni la U.
 * Se escribe NEGANDO primero: lo que NO debe pasar.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Cfg = Record<string, any>;
const chats = await import('../../scripts/plataforma/vaciar-chats-tenant.mjs') as any;
const memoria = await import('../../scripts/plataforma/vaciar-memoria-flujo.mjs') as any;
const hoja = await import('../../scripts/plataforma/vaciar-hoja-crm.mjs') as any;

const { leerMapa, encabezadosEsperados } = await import('../../scripts/plataforma/relleno-crm-historico.mjs') as any;

const PROY = 'demo-novuchat-pruebas';
const SHEET = 'hoja-sintetica-abcdefghijklmnopqrstu';
const ENV = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', SHEET_ID: SHEET, ENV_FILE: '/ruta/ficticia/.env' };
const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'vaciar-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');
const problemas = (r: any) => { expect(r.ok, JSON.stringify(r)).toBe(false); return (r.problemas ?? []).join(' | '); };

// ---------------------------------------------------------------------------------------------------------------------------------
describe('V1. vaciar-chats-tenant', () => {
  const base = ['--proyecto', PROY, '--tenant', 'rroca-ruben'];
  it('la invocación completa es válida y queda en seco', () => {
    expect(chats.analizarArgumentos(base, ENV).cfg).toMatchObject({ aplicar: false, tenant: 'rroca-ruben' });
  });
  it('NEGADO: «todos», comodines, varios comercios o sin tenant', () => {
    for (const t of ['todos', '*', 'a,b', 'ROCA', '..', '__proto__', 'bellido', 'qtaco', 'novuchat']) expect(problemas(chats.analizarArgumentos(['--proyecto', PROY, '--tenant', t], ENV)), t).toContain('--tenant');
    expect(problemas(chats.analizarArgumentos(['--proyecto', PROY], ENV))).toContain('falta --tenant');
    for (const t of ['rroca-evy', 'rroca-emma', 'rroca-antonio']) expect(chats.analizarArgumentos(['--proyecto', PROY, '--tenant', t], ENV).ok, t).toBe(true);
  });
  it('NEGADO: --aplicar sin confirmación, sin respaldo, o con una confirmación de otro comercio', () => {
    expect(problemas(chats.analizarArgumentos([...base, '--aplicar', '--respaldo', rutaRespaldo()], ENV))).toContain('--confirmo-produccion');
    expect(problemas(chats.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca-ruben'], ENV))).toContain('--respaldo');
    expect(problemas(chats.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca-evy', '--respaldo', rutaRespaldo()], ENV))).toContain('no coincide');
  });
  it('NEGADO: opciones desconocidas, repetidas o sueltas', () => {
    expect(problemas(chats.analizarArgumentos([...base, '--todos'], ENV))).toContain('desconocida');
    expect(problemas(chats.analizarArgumentos([...base, '--tenant', 'x'], ENV))).toContain('repetida');
    expect(problemas(chats.analizarArgumentos([...base, 'suelto'], ENV))).toContain('suelto');
  });
  it('NEGADO: un respaldo dentro del repositorio se rechaza', () => {
    expect(chats.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca-ruben', '--respaldo', join(process.cwd(), 'respaldo.json')], ENV).ok).toBe(false);
  });

  const mundo = (conv = 2, msgs = 3) => {
    const docs: Record<string, any> = {};
    for (let i = 1; i <= conv; i++) {
      docs[`tenants/rroca-ruben/conversaciones/wa_${i}`] = { telefono: `${i}` };
      for (let j = 1; j <= msgs; j++) docs[`tenants/rroca-ruben/conversaciones/wa_${i}/mensajes/m${j}`] = { texto: 'texto-secreto-del-cliente' };
      docs[`tenants/rroca-ruben/conversaciones/wa_${i}/privado/p1`] = { x: 1 };
    }
    docs['tenants/rroca-ruben/contactos/c1'] = { n: 1 };
    // Lo que NO debe tocarse:
    for (const r of ['metricas/2026-11', 'config/crm', 'pedidos/p1', 'pagos/g1', 'cierres/c1', 'rutas/x']) docs[`tenants/rroca-ruben/${r}`] = { intacto: true };
    const llamadas = { borrar: [] as string[][], auditar: [] as any[] };
    const hijos = (pre: string, sub: string) => Object.keys(docs).filter((k) => k.startsWith(`${pre}/${sub}/`) && k.split('/').length === pre.split('/').length + 2).map((ruta) => ({ ruta, datos: docs[ruta] }));
    const deps = {
      listar: async (c: string) => Object.keys(docs).filter((k) => k.startsWith(`tenants/rroca-ruben/${c}/`) && k.split('/').length === 4).map((ruta) => ({ ruta, datos: docs[ruta] })),
      listarSub: async (ruta: string, s: string) => hijos(ruta, s),
      contar: async (c: string) => Object.keys(docs).filter((k) => k.startsWith(`tenants/rroca-ruben/${c}/`)).length,
      borrar: async (rutas: string[]) => { llamadas.borrar.push(rutas); for (const r of rutas) delete docs[r]; },
      auditar: async (c: any) => { llamadas.auditar.push(c); },
    };
    return { docs, llamadas, deps };
  };
  const cfgDe = (extra: Cfg = {}): Cfg => ({ proyecto: PROY, entorno: 'emulador', tenant: 'rroca-ruben', aplicar: false, respaldo: null, ...extra });

  it('el seco cuenta, no borra, avisa de pedidos/pagos y no imprime contenido', async () => {
    const m = mundo(); const salida: string[] = [];
    expect(await chats.ejecutar(cfgDe(), m.deps, (t: string) => salida.push(t))).toBe(1);
    expect(m.llamadas.borrar).toHaveLength(0);
    const t = salida.join('\n');
    expect(t).toContain('conversaciones');
    expect(t).toMatch(/NO se borra\s+pedidos\s+1/);
    expect(t).toContain('pedidos, pagos o comprobantes');
    expect(t).not.toContain('texto-secreto');
  });
  it('--aplicar: respaldo 0600, borra SOLO la lista cerrada, deja metricas/config/pedidos/pagos/cierres y relee', async () => {
    const m = mundo(); const resp = rutaRespaldo();
    expect(await chats.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, () => {})).toBe(0);
    expect(statSync(resp).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(resp, 'utf8')).documentos.length).toBe(2 + 6 + 2 + 1);
    const quedan = Object.keys(m.docs);
    expect(quedan.sort()).toEqual(['metricas/2026-11', 'config/crm', 'pedidos/p1', 'pagos/g1', 'cierres/c1', 'rutas/x'].map((r) => `tenants/rroca-ruben/${r}`).sort());
    // subcolecciones antes que sus documentos
    expect(m.llamadas.borrar[0].every((r) => /\/(mensajes|privado)\//.test(r))).toBe(true);
    expect(m.llamadas.borrar[1].every((r) => r.split('/').length === 4)).toBe(true);
    expect(m.llamadas.auditar[0]).toHaveProperty('borrados');
    expect(JSON.stringify(m.llamadas.auditar)).not.toContain('texto-secreto');
  });
  it('una conversación fantasma (sin datos, pero con mensajes) también se borra con sus mensajes', async () => {
    const m = mundo(0);
    m.docs['tenants/rroca-ruben/conversaciones/wa_9/mensajes/m1'] = { texto: 'x' };
    const original = m.deps.listar;
    m.deps.listar = async (c: string) => (c === 'conversaciones' ? (Object.keys(m.docs).some((k) => k.includes('/wa_9/')) ? [{ ruta: 'tenants/rroca-ruben/conversaciones/wa_9', datos: {} }] : []) : original(c));
    expect(await chats.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(0);
    expect(Object.keys(m.docs).some((k) => k.includes('/wa_9/'))).toBe(false);
  });
  it('NEGADO: si un borrado falla, sale 3 (no 1), sin imprimir rutas, y no deja auditoría de éxito', async () => {
    const m = mundo(); const salida: string[] = [];
    m.deps.borrar = async () => 2;
    expect(await chats.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, (t: string) => salida.push(t))).toBe(3);
    expect(salida.join('\n')).not.toContain('wa_');
    expect(m.llamadas.auditar).toHaveLength(0);
  });
  it('NEGADO: un respaldo existente no se pisa y no se borra nada', async () => {
    const m = mundo(); const resp = rutaRespaldo();
    expect(await chats.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), mundo().deps, () => {})).toBe(0);
    expect(await chats.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, () => {})).toBe(2);
    expect(m.llamadas.borrar).toHaveLength(0);
  });
  it('NEGADO: si alguna ruta cae fuera de la lista cerrada, no se borra nada (y el respaldo ya existe)', async () => {
    const m = mundo();
    const original = m.deps.listar;
    m.deps.listar = async (c: string) => { const r = await original(c); return c === 'contactos' ? [...r, { ruta: 'tenants/rroca-ruben/metricas/2026-11', datos: {} }] : r; };
    expect(await chats.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(2);
    expect(m.llamadas.borrar).toHaveLength(0);
  });
  it('NEGADO: sobre el límite de documentos no se borra', async () => {
    const m = mundo();
    m.deps.listar = async (c: string) => (c === 'contactos' ? Array.from({ length: chats.LIMITE_DOCUMENTOS + 1 }, (_, i) => ({ ruta: `tenants/rroca-ruben/contactos/c${i}`, datos: {} })) : []);
    expect(await chats.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(2);
  });
  it('la lista cerrada no incluye metricas, config, ficha, rutas, pagos ni pedidos', () => {
    expect(Object.keys(chats.SE_BORRA)).toEqual(['conversaciones', 'contactos']);
    for (const c of ['metricas', 'config', 'pagos', 'pedidos', 'cierres', 'rutasWhatsApp', 'enlaces', 'miembros']) expect(Object.keys(chats.SE_BORRA)).not.toContain(c);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('V2. vaciar-memoria-flujo', () => {
  const base = ['--workflow', 'abc123XYZ', '--clave', 'rroca', '--todas-las-fichas'];
  it('NEGADO: otra clave, sin elegir fichas, ambas a la vez, sufijos mal formados o repetidos', () => {
    expect(problemas(memoria.analizarArgumentos(['--workflow', 'abc123XYZ', '--clave', 'chatNovuchat', '--todas-las-fichas'], ENV))).toContain('--clave');
    expect(problemas(memoria.analizarArgumentos(['--workflow', 'abc123XYZ', '--clave', 'rroca'], ENV))).toContain('exactamente una');
    expect(problemas(memoria.analizarArgumentos([...base, '--sufijos', '12345678'], ENV))).toContain('exactamente una');
    expect(problemas(memoria.analizarArgumentos(['--workflow', 'abc123XYZ', '--clave', 'rroca', '--sufijos', '123'], ENV))).toContain('sufijos');
    expect(problemas(memoria.analizarArgumentos(['--workflow', 'abc123XYZ', '--clave', 'rroca', '--sufijos', '12345678,12345678'], ENV))).toContain('sufijos');
  });
  it('NEGADO: --aplicar sin confirmación ni respaldo', () => {
    expect(problemas(memoria.analizarArgumentos([...base, '--aplicar'], ENV))).toContain('--confirmo-produccion');
    expect(problemas(memoria.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca', '--respaldo', rutaRespaldo()], ENV))).toContain('id del flujo');
    expect(problemas(memoria.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'abc123XYZ'], ENV))).toContain('--respaldo');
  });

  const fichas = () => ({ '59170000001': { pedidos: [{ id: 1 }], qrHastaMs: Date.now() + 60_000, historial: ['x'] }, '59170000002': { historial: [] }, '59170000003': {} });
  const flujo = () => ({ name: 'Flujo de prueba', active: true, nodes: [{ id: 'n1' }], connections: {}, settings: { executionOrder: 'v1' },
    staticData: { global: { rroca: fichas(), rrTopes: { h: 1 }, rrExtranjeros: { e: 1 }, otraCosa: { a: 1 } } } });
  const cfgDe = (extra: Cfg = {}): Cfg => ({ workflow: 'abc123XYZ', clave: 'rroca', todas: true, sufijos: [], conTopes: false, aplicar: false, respaldo: null, ...extra });
  const mundo = () => {
    let vivo: any = flujo(); const puts: any[] = [];
    return { puts, get vivo() { return vivo; }, deps: { leer: async () => JSON.parse(JSON.stringify(vivo)),
      escribir: async (v: any, sd: any) => { puts.push(sd); vivo = { ...vivo, staticData: sd }; return 200; } } };
  };

  it('puro: borra solo las fichas pedidas y no muta la entrada; cuenta pedidos y QR abiertos', () => {
    const f = flujo(); const antes = JSON.stringify(f.staticData);
    const r = memoria.sinFichas(f.staticData, cfgDe());
    expect(JSON.stringify(f.staticData)).toBe(antes);
    expect(r).toMatchObject({ ok: true, total: 3, aBorrar: 3, conservadas: 0, conPedidos: 1, conQr: 1 });
    expect(r.nuevo.global.rroca).toEqual({});
    expect(r.nuevo.global.rrTopes).toEqual({ h: 1 }); // sin --con-topes se conservan
    expect(r.nuevo.global.otraCosa).toEqual({ a: 1 });
  });
  it('--sufijos borra solo esas fichas; un sufijo ambiguo no borra nada', () => {
    const r = memoria.sinFichas(flujo().staticData, cfgDe({ todas: false, sufijos: ['70000001'] }));
    expect(Object.keys(r.nuevo.global.rroca)).toEqual(['59170000002', '59170000003']);
    const sd = { global: { rroca: { '1170000001': {}, '2270000001': {} } } };
    expect(memoria.sinFichas(sd, cfgDe({ todas: false, sufijos: ['70000001'] })).ok).toBe(false);
  });
  it('--con-topes borra también rrTopes y rrExtranjeros; nunca otras claves', () => {
    const r = memoria.sinFichas(flujo().staticData, cfgDe({ conTopes: true }));
    expect(r.nuevo.global).toEqual({ rroca: {}, otraCosa: { a: 1 } });
  });
  it('NEGADO: sin staticData.global.rroca no se toca nada', () => {
    expect(memoria.sinFichas({ global: {} }, cfgDe()).ok).toBe(false);
    expect(memoria.sinFichas(undefined, cfgDe()).ok).toBe(false);
  });
  it('el seco no escribe', async () => {
    const m = mundo(); const salida: string[] = [];
    expect(await memoria.ejecutar(cfgDe(), m.deps, (t: string) => salida.push(t))).toBe(1);
    expect(m.puts).toHaveLength(0);
    expect(salida.join('\n')).not.toContain('59170000001');
  });
  it('--aplicar: respaldo del staticData completo (0600), PUT solo con staticData cambiado, verifica y deja el resto igual', async () => {
    const m = mundo(); const resp = rutaRespaldo();
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, () => {})).toBe(0);
    expect(statSync(resp).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(resp, 'utf8')).staticData.global.rroca['59170000001']).toBeDefined();
    expect(m.puts).toHaveLength(1);
    expect(m.vivo.staticData.global.rroca).toEqual({});
    expect(m.vivo.staticData.global.otraCosa).toEqual({ a: 1 });
    expect(m.vivo.staticData.global.rrTopes).toEqual({ h: 1 });
  });
  it('NEGADO: si el flujo cambió entre la lectura y la escritura, no escribe', async () => {
    const m = mundo(); let n = 0;
    const leer = m.deps.leer;
    m.deps.leer = async () => { const v = await leer(); n += 1; if (n === 2) v.staticData.global.rroca['59170000009'] = {}; return v; };
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(3);
    expect(m.puts).toHaveLength(0);
  });
  it('NEGADO: si el PUT deja el flujo desactivado, sale 3', async () => {
    const m = mundo(); const w = m.deps.escribir;
    m.deps.escribir = async (v: any, sd: any) => { const r = await w(v, sd); m.vivo.active = false; return r; };
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(3);
  });
  it('NEGADO: si tras la espera las fichas reaparecen (una ejecución en curso repuso el estado), sale 3', async () => {
    const m = mundo(); let esperas = 0;
    (m.deps as any).esperar = async () => { esperas += 1; m.vivo.staticData.global.rroca = fichas(); };
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(3);
    expect(esperas).toBe(1);
  });
  it('aplicar espera ESPERA_FINAL_MS, y una ficha NUEVA escrita durante la espera no es falsa alarma (solo cuentan las claves borradas)', async () => {
    const m = mundo(); const esperado: number[] = [];
    (m.deps as any).esperar = async (ms: number) => { esperado.push(ms); m.vivo.staticData.global.rroca = { 'ficha-nueva': { historial: [] } }; };
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(0);
    expect(esperado).toEqual([memoria.ESPERA_FINAL_MS]);
  });
  it('NEGADO: si cambió connections o settings entre las lecturas, no escribe', async () => {
    const m = mundo(); let n = 0; const leer = m.deps.leer;
    m.deps.leer = async () => { const v = await leer(); n += 1; if (n === 2) v.settings = { executionOrder: 'v0' }; return v; };
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(3);
    expect(m.puts).toHaveLength(0);
  });
  it('NEGADO: un respaldo existente no se pisa', async () => {
    const resp = rutaRespaldo();
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), mundo().deps, () => {})).toBe(0);
    const m = mundo();
    expect(await memoria.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, () => {})).toBe(2);
    expect(m.puts).toHaveLength(0);
  });
  it('NEGADO: el script no usa --reiniciar-estado ni reemplaza el staticData completo', () => {
    const f = readFileSync(new URL('../../scripts/plataforma/vaciar-memoria-flujo.mjs', import.meta.url), 'utf8');
    const codigo = f.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(codigo).not.toMatch(/reiniciar-estado|conversaciones:\s*\{\}/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('V3. vaciar-hoja-crm', () => {
  const base = ['--proyecto', PROY, '--tenant', 'rroca-ruben'];
  it('NEGADO: otro comercio o varios, --aplicar sin confirmación/respaldo, SHEET_ID ausente, --acepto-borrar-equipo en seco', () => {
    for (const t of ['bellido', 'qtaco', 'todos']) expect(problemas(hoja.analizarArgumentos(['--proyecto', PROY, '--tenant', t], ENV)), t).toContain('tiene que ser uno de');
    expect(problemas(hoja.analizarArgumentos([...base, '--aplicar', '--respaldo', rutaRespaldo()], ENV))).toContain('--confirmo-produccion');
    expect(problemas(hoja.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca-ruben', '--respaldo', rutaRespaldo()], ENV))).toContain('--confirmo-hoja');
    expect(problemas(hoja.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca-ruben', '--confirmo-hoja', 'zzzzzz', '--respaldo', rutaRespaldo()], ENV))).toContain('no coincide');
    expect(hoja.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca-ruben', '--confirmo-hoja', SHEET.slice(-6), '--respaldo', rutaRespaldo()], ENV).ok).toBe(true);
    expect(problemas(hoja.analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'rroca-ruben'], ENV))).toContain('--respaldo');
    expect(problemas(hoja.analizarArgumentos(base, { ...ENV, SHEET_ID: '' }))).toContain('SHEET_ID');
    expect(problemas(hoja.analizarArgumentos([...base, '--acepto-borrar-equipo'], ENV))).toContain('--aplicar');
  });

  const mapaR = leerMapa('rroca-ruben');
  const letra = (c: string) => c.charCodeAt(0) - 65;
  const fila = (n: number, extra: Record<string, string> = {}) => {
    const f: string[] = Array(20).fill('');
    f[letra(mapaR.columnas.id.letra)] = `LEAD-${1000 + n}`;
    f[letra(mapaR.columnas.telefono.letra)] = `5917000000${n}`;
    for (const [k, v] of Object.entries(extra)) f[letra(k)] = v;
    return f;
  };
  const mundo = (filas: string[][]) => {
    const valores: string[][] = [encabezadosEsperados(mapaR), ...filas];
    const llamadas = { limpiar: [] as string[] };
    const deps = { leer: async () => valores.map((f) => [...f]), limpiar: async (r: string) => { llamadas.limpiar.push(r); valores.splice(1, valores.length); } };
    return { valores, llamadas, deps };
  };
  const cfgDe = (extra: Cfg = {}): Cfg => ({ proyecto: PROY, entorno: 'emulador', tenant: 'rroca-ruben', aplicar: false, aceptoEquipo: false, respaldo: null, ...extra });
  const equipoLetra = (Object.values(mapaR.equipo) as any[]).find((c) => c && c.letra <= 'T')!.letra as string;

  it('analizarHoja cuenta filas con ID, filas con datos del equipo y fórmulas, sin leer la U', () => {
    const valores = [encabezadosEsperados(mapaR), fila(1), fila(2, { [equipoLetra]: 'Ana' }), fila(3, { [mapaR.columnas.id.letra]: '=A1' })];
    expect(hoja.analizarHoja(valores, mapaR)).toMatchObject({ filasLeidas: 3, conId: 3, conEquipo: 1, formulas: 1, ultimaFila: 6 });
  });
  it('el seco no escribe, no imprime teléfonos ni nombres', async () => {
    const m = mundo([fila(1), fila(2)]); const salida: string[] = [];
    expect(await hoja.ejecutar(cfgDe(), m.deps, mapaR, (t: string) => salida.push(t))).toBe(1);
    expect(m.llamadas.limpiar).toHaveLength(0);
    expect(salida.join('\n')).not.toContain('5917000000');
  });
  it('--aplicar: respaldo 0600, limpia exactamente A4:T<última> (nunca la U ni el encabezado) y relee', async () => {
    const m = mundo([fila(1), fila(2), fila(3)]); const resp = rutaRespaldo();
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, mapaR, () => {})).toBe(0);
    expect(statSync(resp).mode & 0o777).toBe(0o600);
    expect(m.llamadas.limpiar).toEqual([`'Leads_CRM'!A${mapaR.filaEncabezados + 1}:T${mapaR.filaEncabezados + 3}`]);
    expect(m.llamadas.limpiar[0]).not.toMatch(/U/);
    expect(m.valores).toHaveLength(1); // quedan los encabezados
  });
  it('NEGADO: encabezados distintos a los del mapa → no escribe', async () => {
    const m = mundo([fila(1)]); m.valores[0][0] = 'Otro título';
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, mapaR, () => {})).toBe(2);
    expect(m.llamadas.limpiar).toHaveLength(0);
  });
  it('NEGADO: fórmulas en la zona de datos → no borra', async () => {
    const m = mundo([fila(1, { [mapaR.columnas.id.letra]: '=ARRAYFORMULA(A1)' })]);
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, mapaR, () => {})).toBe(2);
    expect(m.llamadas.limpiar).toHaveLength(0);
  });
  it('NEGADO: datos del equipo sin --acepto-borrar-equipo → no borra; con la bandera sí', async () => {
    const m = mundo([fila(1, { [equipoLetra]: 'Ana' })]);
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, mapaR, () => {})).toBe(2);
    expect(m.llamadas.limpiar).toHaveLength(0);
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, aceptoEquipo: true, respaldo: rutaRespaldo() }), m.deps, mapaR, () => {})).toBe(0);
  });
  it('NEGADO: si el bot agregó una fila entre la lectura y el borrado, no borra', async () => {
    const m = mundo([fila(1)]); const leer = m.deps.leer; let n = 0;
    m.deps.leer = async () => { const v = await leer(); n += 1; if (n === 2) v.push(fila(9)); return v; };
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, mapaR, () => {})).toBe(3);
    expect(m.llamadas.limpiar).toHaveLength(0);
  });
  it('NEGADO: si el bot ACTUALIZÓ una fila existente entre las lecturas, no borra', async () => {
    const m = mundo([fila(1), fila(2)]); const leer = m.deps.leer; let n = 0;
    m.deps.leer = async () => { const v = await leer(); n += 1; if (n === 2) v[1][5] = 'cambió'; return v; };
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, mapaR, () => {})).toBe(3);
    expect(m.llamadas.limpiar).toHaveLength(0);
  });
  it('el respaldo lleva también los valores formateados (las fechas como se ven)', async () => {
    const m = mundo([fila(1)]); const resp = rutaRespaldo();
    (m.deps as any).leerFormateado = async () => [['formateado']];
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, mapaR, () => {})).toBe(0);
    expect(JSON.parse(readFileSync(resp, 'utf8')).valoresFormateados).toEqual([['formateado']]);
  });
  it('NEGADO: un respaldo existente no se pisa', async () => {
    const resp = rutaRespaldo();
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), mundo([fila(1)]).deps, mapaR, () => {})).toBe(0);
    const m = mundo([fila(1)]);
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, mapaR, () => {})).toBe(2);
    expect(m.llamadas.limpiar).toHaveLength(0);
  });
  it('la hoja ya vacía sale 0 sin escribir', async () => {
    const m = mundo([]);
    expect(await hoja.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, mapaR, () => {})).toBe(0);
    expect(m.llamadas.limpiar).toHaveLength(0);
  });
});
