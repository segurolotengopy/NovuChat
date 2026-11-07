/**
 * `resetear-estado-turno.mjs` — borra el estado de conversación del SERVIDOR de un teléfono de prueba (venta-minima, Q'Taco).
 * Sin Firestore ni red: una base en memoria con datos sintéticos (el repositorio es público: teléfonos inventados). Se NIEGA primero.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Cfg = Record<string, any>;
const m = await import('../../scripts/plataforma/resetear-estado-turno.mjs') as any;
const aqui = dirname(fileURLToPath(import.meta.url));

const TEL = '59100000001';
const OTRO = '59100000002';
const VECINO = '591000000011'; // comparte el prefijo con TEL
const SUFIJO = '99900000001'; // otro país, mismos 8 últimos dígitos
const PN = 'pn0001';
const PROY = 'proyecto-ficticio-staging';
const ENV = { GCP_PROJECT_ID_STAGING: PROY, GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod', TELEFONOS_PRUEBA: `${TEL},${OTRO}` };
const BASE = ['--proyecto', PROY, '--tenant', 'qtaco', '--tel', TEL];
const dirs: string[] = [];
const rutaRespaldo = () => { const d = mkdtempSync(join(tmpdir(), 'est-turno-')); chmodSync(d, 0o700); dirs.push(d); return join(d, 'respaldo.json'); };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const problemas = (r: any) => { expect(r.ok, JSON.stringify(r)).toBe(false); return (r.problemas ?? []).join(' | '); };
const leido = (ruta: string) => { const fd = openSync(ruta, 'r'); try { return { modo: fstatSync(fd).mode & 0o777, json: JSON.parse(readFileSync(fd, 'utf8')) }; } finally { closeSync(fd); } };

describe('E1. argumentos y salvaguardas', () => {
  it('NEGADO: teléfono fuera de la lista, vecino, mal formado o sin TELEFONOS_PRUEBA', () => {
    for (const t of ['59100000003', VECINO, '5910000000', '+59100000001']) {
      expect(problemas(m.analizarArgumentos(['--proyecto', PROY, '--tenant', 'qtaco', '--tel', t], ENV))).toContain('--tel');
    }
    const { TELEFONOS_PRUEBA: _x, ...sin } = ENV;
    expect(problemas(m.analizarArgumentos(BASE, sin))).toContain('TELEFONOS_PRUEBA');
    expect(problemas(m.analizarArgumentos(BASE, { ...ENV, TELEFONOS_PRUEBA: `${TEL},abc` }))).toContain('TELEFONOS_PRUEBA');
  });
  it('NEGADO: el error no imprime teléfonos', () => {
    const t = problemas(m.analizarArgumentos(['--proyecto', PROY, '--tenant', 'qtaco', '--tel', '59100000003'], ENV));
    for (const x of [TEL, OTRO, '59100000003']) expect(t).not.toContain(x);
  });
  it('NEGADO: otro tenant, sin tenant, proyecto fuera de la lista blanca', () => {
    expect(problemas(m.analizarArgumentos(['--proyecto', PROY, '--tenant', 'otro-comercio', '--tel', TEL], ENV))).toContain('lista cerrada');
    expect(problemas(m.analizarArgumentos(['--proyecto', PROY, '--tel', TEL], ENV))).toContain('--tenant');
    expect(problemas(m.analizarArgumentos(['--proyecto', 'otro-proyecto', '--tenant', 'qtaco', '--tel', TEL], ENV))).toContain('lista blanca');
  });
  it('NEGADO: --aplicar sin --respaldo; respaldo relativo; respaldo existente (no se pisa)', () => {
    expect(problemas(m.analizarArgumentos([...BASE, '--aplicar'], ENV))).toContain('--respaldo');
    expect(problemas(m.analizarArgumentos([...BASE, '--respaldo', 'r.json'], ENV))).toContain('absoluta');
    const r = rutaRespaldo(); writeFileSync(r, '{}', { mode: 0o600 });
    expect(problemas(m.analizarArgumentos([...BASE, '--aplicar', '--respaldo', r], ENV))).toContain('nunca se pisa');
  });
  it('NEGADO: contra producción, --aplicar sin --confirmo-produccion o con otro valor; la confirmación fuera de producción', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco', '--tel', TEL, '--aplicar', '--respaldo', rutaRespaldo()];
    expect(problemas(m.analizarArgumentos(prod, ENV))).toContain('--confirmo-produccion');
    expect(problemas(m.analizarArgumentos([...prod, '--confirmo-produccion', 'otro'], ENV))).toContain('no coincide');
    expect(m.analizarArgumentos([...prod, '--confirmo-produccion', 'qtaco'], ENV).ok).toBe(true);
    expect(problemas(m.analizarArgumentos([...BASE, '--confirmo-produccion', 'qtaco'], ENV))).toContain('solo se usa contra producción');
  });
  it('NEGADO: --revertir sin respaldo; opciones repetidas o desconocidas', () => {
    expect(problemas(m.analizarArgumentos([...BASE, '--revertir'], ENV))).toContain('--revertir exige');
    expect(problemas(m.analizarArgumentos([...BASE, '--tel', OTRO], ENV))).toContain('repetida');
    expect(problemas(m.analizarArgumentos([...BASE, '--todos'], ENV))).toContain('desconocida');
  });
  it('la invocación completa es válida y queda en seco por omisión', () => {
    expect(m.analizarArgumentos(BASE, ENV).cfg).toMatchObject({ aplicar: false, revertir: false, tel: TEL, tenant: 'qtaco', entorno: 'staging' });
  });
});

describe('E2. clasificación de ids', () => {
  const c = m.clasificar;
  it('borra solo la forma exacta, de venta-minima y con phoneNumberId coincidente', () => {
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${TEL}`, PN, TEL)).toBe('borrar');
    expect(c('sesionesDeTurno', `${PN}~venta-minima-prueba~wa_${TEL}`, PN, TEL)).toBe('borrar');
    expect(c('cuposDeTurno', `${PN}~transferencias~wa_${TEL}~2026-11-07T10`, PN, TEL)).toBe('borrar');
    expect(c('cuposDeTurno', `${PN}~pedidos~wa_${TEL}~2026-11-07T10`, PN, TEL)).toBe('borrar');
  });
  it('NEGADO: otro espacio, otra clave, cupo del comercio, vecino y phoneNumberId distinto no se borran', () => {
    expect(c('sesionesDeTurno', `${PN}~chat~wa_${TEL}`, PN, TEL)).toBe('otro');
    expect(c('sesionesDeTurno', `${PN}~vmc-abc12345~wa_${TEL}`, PN, TEL)).toBe('otro');
    expect(c('cuposDeTurno', `${PN}~avisos~_~2026-11-07`, PN, TEL)).toBe('ajeno');
    expect(c('cuposDeTurno', `${PN}~otra~wa_${TEL}~2026-11-07`, PN, TEL)).toBe('otro');
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${VECINO}`, PN, TEL)).toBe('ajeno');
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${OTRO}`, PN, TEL)).toBe('ajeno');
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${TEL}`, 'pn9999', TEL)).toBe('resto');
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${TEL}`, undefined, TEL)).toBe('resto');
  });
  it('otras formas de clave del mismo teléfono son posibles restos, no se borran', () => {
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${TEL.slice(-8)}`, PN, TEL)).toBe('resto');
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${SUFIJO}`, PN, TEL)).toBe('ajeno'); // otro número completo
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_${TEL}~x`, PN, TEL)).toBe('resto');
    expect(c('sesionesDeTurno', `${PN}~venta-minima~wa_+${TEL}`, PN, TEL)).toBe('resto');
    expect(c('cuposDeTurno', `${PN}~transferencias~wa_${TEL}`, PN, TEL)).toBe('resto'); // sin período: otra forma
  });
});

// ---- base en memoria
let reloj = 0;
const tsDe = (n: number) => ({ n, toDate: () => new Date(1_700_000_000_000 + n * 1000) });
const clon = (v: any): any => (v && typeof v.toDate === 'function' ? v : v instanceof Date ? v : Array.isArray(v) ? v.map(clon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clon(x)])) : v);
function mundoDe(docsIniciales: Record<string, Record<string, any>>) {
  const datos = new Map<string, any>(); const hora = new Map<string, any>();
  const llamadas: string[] = [];
  const gancho: { alBorrar: ((ruta: string) => void) | null; alEscanear: ((col: string, n: number) => void) | null } = { alBorrar: null, alEscanear: null };
  const escaneos: Record<string, number> = {};
  for (const [ruta, d] of Object.entries(docsIniciales)) { datos.set(ruta, clon(d)); hora.set(ruta, tsDe(++reloj)); }
  const snap = (ruta: string): any => ({
    id: ruta.split('/').pop(), exists: datos.has(ruta), ref: refDe(ruta), updateTime: hora.get(ruta),
    get: (c: string) => datos.get(ruta)?.[c], data: () => clon(datos.get(ruta)),
  });
  const refDe = (ruta: string): any => ({
    path: ruta,
    delete: async (pre?: any) => {
      llamadas.push(`delete:${ruta}`);
      gancho.alBorrar?.(ruta);
      if (!datos.has(ruta)) throw Object.assign(new Error('x'), { code: 5 });
      if (pre?.lastUpdateTime && pre.lastUpdateTime.n !== hora.get(ruta).n) throw Object.assign(new Error('x'), { code: 9 });
      datos.delete(ruta); hora.delete(ruta);
    },
    create: async (d: any) => {
      llamadas.push(`create:${ruta}`);
      if (datos.has(ruta)) throw Object.assign(new Error('x'), { code: 6 });
      datos.set(ruta, clon(d)); hora.set(ruta, tsDe(++reloj));
    },
  });
  const db = {
    collection: (col: string) => ({
      select: () => ({
        limit: () => ({
          get: async () => {
            escaneos[col] = (escaneos[col] ?? 0) + 1; gancho.alEscanear?.(col, escaneos[col]);
            return { docs: [...datos.keys()].filter((r) => r.startsWith(`${col}/`) && r.split('/').length === col.split('/').length + 1).map(snap) };
          },
        }),
      }),
    }),
    doc: (ruta: string) => refDe(ruta),
    getAll: async (...refs: any[]) => refs.map((r) => snap(r.path)),
  };
  return { db, datos, llamadas, hora, gancho };
}

const T = 'tenants/qtaco';
const doc = (extra: Record<string, any> = {}) => ({ version: 3, estadoJson: '{"paso":"menu","tel":"dato"}', vence: tsDe(1), actualizadoEn: tsDe(2), flujo: 'venta-minima', phoneNumberId: PN, compromisos: [{ id: 'c1', en: tsDe(3) }], ...extra });
const cupo = (extra: Record<string, any> = {}) => ({ usados: 1, tope: 3, por: { c1: { cantidad: 1, en: 5, tel: TEL } }, vence: tsDe(4), phoneNumberId: PN, ...extra });
const inicial = () => ({
  [`${T}/sesionesDeTurno/${PN}~venta-minima~wa_${TEL}`]: doc(),
  [`${T}/sesionesDeTurno/${PN}~venta-minima-prueba~wa_${TEL}`]: doc(),
  [`${T}/sesionesDeTurno/${PN}~chat~wa_${TEL}`]: doc(),
  [`${T}/sesionesDeTurno/${PN}~vmc-abc12345~wa_${TEL}`]: doc({ estadoJson: null }),
  [`${T}/sesionesDeTurno/${PN}~venta-minima~wa_${OTRO}`]: doc(),
  [`${T}/sesionesDeTurno/${PN}~venta-minima~wa_${VECINO}`]: doc(),
  [`${T}/sesionesDeTurno/${PN}~venta-minima~wa_${SUFIJO}`]: doc(),
  [`${T}/sesionesDeTurno/${PN}~venta-minima~wa_+${TEL}`]: doc(), // otra forma de clave: posible resto
  [`${T}/cuposDeTurno/${PN}~transferencias~wa_${TEL}~2026-11-07T10`]: cupo(),
  [`${T}/cuposDeTurno/${PN}~pedidos~wa_${TEL}~2026-11-07T10`]: cupo(),
  [`${T}/cuposDeTurno/${PN}~avisos~_~2026-11-07`]: cupo(),
  [`${T}/cuposDeTurno/${PN}~transferencias~wa_${OTRO}~2026-11-07T10`]: cupo(),
  [`${T}/vistosDeTurno/abcdef0123`]: { ejecucion: 'e1', phoneNumberId: PN, vence: tsDe(9) },
  [`tenants/otro-comercio/sesionesDeTurno/${PN}~venta-minima~wa_${TEL}`]: doc(),
});
const cfgDe = (extra: Cfg = {}): Cfg => ({ proyecto: PROY, entorno: 'staging', tenant: 'qtaco', tel: TEL, aplicar: false, revertir: false, respaldo: null, ...extra });
const salida = () => { const l: string[] = []; return { l, log: (t: string) => l.push(t), texto: () => l.join('\n') }; };
const MIOS = 4; // sesiones venta-minima (2) + cupos del teléfono (2)

describe('E3. seco', () => {
  it('cuenta, no escribe y no imprime teléfonos ni ids', async () => {
    const w = mundoDe(inicial()); const s = salida(); const antes = JSON.stringify([...w.datos]);
    const r = await m.ejecutar(cfgDe(), { db: w.db, log: s.log });
    expect(r).toBe(1);
    expect(w.llamadas).toEqual([]);
    expect(JSON.stringify([...w.datos])).toBe(antes);
    expect(s.texto()).toContain('sesionesDeTurno: 2'); expect(s.texto()).toContain('cuposDeTurno: 2');
    expect(s.texto()).toContain('otros espacios o claves del mismo teléfono (no se tocan): 2');
    expect(s.texto()).toContain('posibles restos (otra forma de clave, no se borran): 1');
    for (const x of [TEL, OTRO, VECINO, SUFIJO, PN, 'dato']) expect(s.texto()).not.toContain(x);
  });
  it('sin documentos: 0 y nada que borrar', async () => {
    const w = mundoDe({}); const s = salida();
    expect(await m.ejecutar(cfgDe(), { db: w.db, log: s.log })).toBe(0);
    expect(s.texto()).toContain('Nada que borrar');
  });
});

describe('E4. --aplicar', () => {
  it('borra SOLO lo del teléfono y del tenant; respaldo 0600 con los documentos completos; deja intactos vecino, otro teléfono, otro tenant, vistos y restos', async () => {
    const w = mundoDe(inicial()); const s = salida(); const ruta = rutaRespaldo();
    const r = await m.ejecutar(cfgDe({ aplicar: true, respaldo: ruta }), { db: w.db, log: s.log });
    expect(r, s.texto()).toBe(0);
    const borrados = w.llamadas.filter((x) => x.startsWith('delete:'));
    expect(borrados).toHaveLength(MIOS);
    for (const b of borrados) { expect(b).toContain('tenants/qtaco/'); expect(b).toContain(`wa_${TEL}`); expect(b).not.toContain('~chat~'); expect(b).not.toContain('~vmc-'); }
    expect(w.datos.size).toBe(Object.keys(inicial()).length - MIOS);
    for (const k of [`${PN}~venta-minima~wa_${OTRO}`, `${PN}~venta-minima~wa_${VECINO}`, `${PN}~venta-minima~wa_${SUFIJO}`, `${PN}~venta-minima~wa_+${TEL}`, `${PN}~chat~wa_${TEL}`]) expect(w.datos.has(`${T}/sesionesDeTurno/${k}`)).toBe(true);
    expect(w.datos.has(`${T}/cuposDeTurno/${PN}~avisos~_~2026-11-07`)).toBe(true);
    expect(w.datos.has(`${T}/cuposDeTurno/${PN}~transferencias~wa_${OTRO}~2026-11-07T10`)).toBe(true);
    expect(w.datos.has(`${T}/vistosDeTurno/abcdef0123`)).toBe(true);
    expect(w.datos.has(`tenants/otro-comercio/sesionesDeTurno/${PN}~venta-minima~wa_${TEL}`)).toBe(true);
    const b = leido(ruta); expect(b.modo).toBe(0o600);
    expect(b.json.docs).toHaveLength(MIOS); expect(JSON.stringify(b.json.docs)).toContain('menu');
    expect(s.texto()).toContain('posibles restos'); expect(s.texto()).toContain('⚠');
    for (const x of [TEL, OTRO, VECINO, SUFIJO]) expect(s.texto()).not.toContain(x);
  });
  it('NEGADO: si un documento cambia entre las dos lecturas, no escribe ni respalda', async () => {
    const w = mundoDe(inicial()); const ruta = rutaRespaldo();
    w.gancho.alEscanear = (col, n) => { if (col.endsWith('sesionesDeTurno') && n === 2) w.hora.set(`${T}/sesionesDeTurno/${PN}~venta-minima~wa_${TEL}`, tsDe(++reloj)); };
    const s = salida();
    expect(await m.ejecutar(cfgDe({ aplicar: true, respaldo: ruta }), { db: w.db, log: s.log })).toBe(3);
    expect(w.llamadas).toEqual([]);
    expect(() => leido(ruta)).toThrow();
  });
  it('NEGADO: la precondición de hora impide borrar un documento que cambió justo antes del borrado', async () => {
    const w = mundoDe(inicial()); const s = salida();
    w.gancho.alBorrar = (ruta) => { if (ruta.endsWith(`~venta-minima~wa_${TEL}`)) w.hora.set(ruta, tsDe(++reloj)); };
    expect(await m.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), { db: w.db, log: s.log })).toBe(3);
    expect(w.datos.has(`${T}/sesionesDeTurno/${PN}~venta-minima~wa_${TEL}`)).toBe(true);
    expect(s.texto()).toContain('cambió');
  });
  it('NEGADO: un respaldo que ya existe nunca se pisa y no se borra nada', async () => {
    const w = mundoDe(inicial()); const ruta = rutaRespaldo(); writeFileSync(ruta, 'previo', { mode: 0o600 });
    expect(await m.ejecutar(cfgDe({ aplicar: true, respaldo: ruta }), { db: w.db, log: () => {} })).toBe(2);
    expect(w.llamadas).toEqual([]);
    expect(readFileSync(ruta, 'utf8')).toBe('previo');
  });
  it('es idempotente: sin documentos del teléfono no crea respaldo ni escribe', async () => {
    const w = mundoDe(inicial());
    await m.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), { db: w.db, log: () => {} });
    const ruta2 = rutaRespaldo(); const antes = w.llamadas.length;
    expect(await m.ejecutar(cfgDe({ aplicar: true, respaldo: ruta2 }), { db: w.db, log: () => {} })).toBe(0);
    expect(w.llamadas.length).toBe(antes);
    expect(() => leido(ruta2)).toThrow();
  });
});

describe('E5. reversa', () => {
  it('repone los documentos tal como estaban (fechas incluidas) y no pisa lo que ya existe', async () => {
    const w = mundoDe(inicial()); const ruta = rutaRespaldo();
    await m.ejecutar(cfgDe({ aplicar: true, respaldo: ruta }), { db: w.db, log: () => {} });
    const s = salida();
    expect(await m.ejecutar(cfgDe({ revertir: true, respaldo: ruta }), { db: w.db, log: s.log })).toBe(1); // seco
    expect(w.llamadas.filter((x) => x.startsWith('create:'))).toHaveLength(0);
    expect(await m.ejecutar(cfgDe({ revertir: true, aplicar: true, respaldo: ruta }), { db: w.db, log: s.log })).toBe(0);
    expect(w.datos.size).toBe(Object.keys(inicial()).length);
    const rep = w.datos.get(`${T}/sesionesDeTurno/${PN}~venta-minima~wa_${TEL}`);
    expect(rep.version).toBe(3); expect(rep.vence).toBeInstanceOf(Date); expect(rep.compromisos[0].en).toBeInstanceOf(Date);
    expect(rep.estadoJson).toContain('menu');
    expect(await m.ejecutar(cfgDe({ revertir: true, aplicar: true, respaldo: ruta }), { db: w.db, log: s.log })).toBe(0); // nada que reponer
  });
  it('NEGADO: respaldo de otro tenant, de otro entorno, de otro teléfono o con un documento ajeno o repetido se rechaza entero', async () => {
    const w = mundoDe(inicial()); const ruta = rutaRespaldo();
    await m.ejecutar(cfgDe({ aplicar: true, respaldo: ruta }), { db: w.db, log: () => {} });
    const base = leido(ruta).json;
    const con = (cambio: (j: any) => void) => { const j = structuredClone(base); cambio(j); const r = rutaRespaldo(); writeFileSync(r, JSON.stringify(j), { mode: 0o600 }); return r; };
    const intento = async (r: string, extra: Cfg = {}) => m.ejecutar(cfgDe({ revertir: true, aplicar: true, respaldo: r, ...extra }), { db: w.db, log: () => {} });
    expect(await intento(con((j) => { j.tenant = 'otro'; }))).toBe(2);
    expect(await intento(con((j) => { j.entorno = 'produccion'; }))).toBe(2);
    expect(await intento(ruta, { tel: OTRO })).toBe(2);
    expect(await intento(con((j) => { j.docs.push({ coleccion: 'sesionesDeTurno', id: `${PN}~venta-minima~wa_${OTRO}`, data: { phoneNumberId: PN } }); }))).toBe(2);
    expect(await intento(con((j) => { j.docs.push({ coleccion: 'conversaciones', id: 'x', data: {} }); }))).toBe(2);
    expect(await intento(con((j) => { j.docs.push(j.docs[0]); }))).toBe(2);
    expect(w.llamadas.filter((x) => x.startsWith('create:'))).toHaveLength(0);
  });
  it('NEGADO: un respaldo con permisos abiertos se rechaza', async () => {
    const w = mundoDe(inicial()); const ruta = rutaRespaldo();
    await m.ejecutar(cfgDe({ aplicar: true, respaldo: ruta }), { db: w.db, log: () => {} });
    chmodSync(ruta, 0o644);
    expect(await m.ejecutar(cfgDe({ revertir: true, aplicar: true, respaldo: ruta }), { db: w.db, log: () => {} })).toBe(2);
  });
});

describe('E6. el texto del script', () => {
  const src = readFileSync(join(aqui, '..', '..', 'scripts', 'plataforma', 'resetear-estado-turno.mjs'), 'utf8');
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('solo borra y crea documentos; no actualiza ni toca conversaciones ni métricas', () => {
    expect(codigo).not.toMatch(/\.(set|update)\(/);
    expect(codigo).not.toMatch(/(?<!-)conversaciones|metricas/);
    expect(codigo.match(/\.delete\(/g)).toHaveLength(1);
    expect(codigo.match(/\.create\(/g)).toHaveLength(1);
  });
  it('no trae teléfonos ni ids reales', () => {
    expect(src).not.toMatch(/\b591\d{8}\b/);
  });
});
