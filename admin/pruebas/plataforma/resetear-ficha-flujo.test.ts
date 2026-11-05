/**
 * `resetear-ficha-flujo.mjs` — n8n: borra UNA ficha de prueba del staticData. Sin n8n ni red: todo se inyecta.
 * Los teléfonos de estas pruebas son inventados (el repositorio es público). Se escribe NEGANDO primero.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Cfg = Record<string, any>;
const ficha = await import('../../scripts/plataforma/resetear-ficha-flujo.mjs') as any;

const TEL = '59100000001';
const OTRO = '59100000002';
const PREFIJO = '591000000011'; // comparte el prefijo con TEL pero es otro teléfono
const ENV = { N8N_BASE_URL: 'https://n8n.ejemplo.test', N8N_API_KEY: 'clave-ficticia', TELEFONOS_PRUEBA: `${TEL},${OTRO}` };
const BASE = ['--workflow', 'abc123XYZ', '--tel', TEL];
const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'ficha-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');
const leido = (ruta: string) => { const fd = openSync(ruta, 'r'); try { return { modo: fstatSync(fd).mode & 0o777, json: JSON.parse(readFileSync(fd, 'utf8')) }; } finally { closeSync(fd); } };
const problemas = (r: any) => { expect(r.ok, JSON.stringify(r)).toBe(false); return (r.problemas ?? []).join(' | '); };

describe('R1. argumentos y lista cerrada', () => {
  it('NEGADO: teléfono fuera de la lista cerrada', () => {
    expect(problemas(ficha.analizarArgumentos(['--workflow', 'abc123XYZ', '--tel', '59100000003'], ENV))).toContain('lista cerrada');
    expect(problemas(ficha.analizarArgumentos(['--workflow', 'abc123XYZ', '--tel', PREFIJO], ENV))).toContain('lista cerrada');
    expect(problemas(ficha.analizarArgumentos(['--workflow', 'abc123XYZ', '--tel', '5910000000'], ENV))).toContain('lista cerrada');
  });
  it('NEGADO: sin TELEFONOS_PRUEBA (o vacía, o mal formada) aborta, aunque el teléfono sea válido', () => {
    const { TELEFONOS_PRUEBA: _, ...sin } = ENV;
    expect(problemas(ficha.analizarArgumentos(BASE, sin))).toContain('TELEFONOS_PRUEBA');
    expect(problemas(ficha.analizarArgumentos(BASE, { ...ENV, TELEFONOS_PRUEBA: '  ' }))).toContain('TELEFONOS_PRUEBA');
    expect(problemas(ficha.analizarArgumentos(BASE, { ...ENV, TELEFONOS_PRUEBA: `${TEL},abc` }))).toContain('TELEFONOS_PRUEBA');
  });
  it('NEGADO: sin --tel, con --tel mal formado, sin --workflow, opciones repetidas o desconocidas', () => {
    expect(problemas(ficha.analizarArgumentos(['--workflow', 'abc123XYZ'], ENV))).toContain('falta --tel');
    expect(problemas(ficha.analizarArgumentos(['--workflow', 'abc123XYZ', '--tel', '+59100000001'], ENV))).toContain('--tel');
    expect(problemas(ficha.analizarArgumentos(['--tel', TEL], ENV))).toContain('--workflow');
    expect(problemas(ficha.analizarArgumentos([...BASE, '--tel', OTRO], ENV))).toContain('repetida');
    expect(problemas(ficha.analizarArgumentos([...BASE, '--todos'], ENV))).toContain('desconocida');
  });
  it('NEGADO: el mensaje de error no imprime teléfonos de la lista', () => {
    const t = problemas(ficha.analizarArgumentos(['--workflow', 'abc123XYZ', '--tel', '59100000003'], ENV));
    expect(t).not.toContain(TEL); expect(t).not.toContain(OTRO); expect(t).not.toContain('59100000003');
  });
  it('NEGADO: --aplicar sin --confirmo-produccion, con id distinto, o sin --respaldo', () => {
    expect(problemas(ficha.analizarArgumentos([...BASE, '--aplicar'], ENV))).toContain('--confirmo-produccion');
    expect(problemas(ficha.analizarArgumentos([...BASE, '--aplicar', '--confirmo-produccion', 'otro999', '--respaldo', rutaRespaldo()], ENV))).toContain('id del flujo');
    expect(problemas(ficha.analizarArgumentos([...BASE, '--aplicar', '--confirmo-produccion', 'abc123XYZ'], ENV))).toContain('--respaldo');
  });
  it('NEGADO: faltan N8N_BASE_URL o N8N_API_KEY; respaldo relativo', () => {
    expect(problemas(ficha.analizarArgumentos(BASE, { TELEFONOS_PRUEBA: ENV.TELEFONOS_PRUEBA }))).toContain('N8N_BASE_URL');
    expect(problemas(ficha.analizarArgumentos([...BASE, '--respaldo', 'r.json'], ENV))).toContain('absoluta');
  });
  it('la invocación completa es válida y queda en seco por omisión', () => {
    expect(ficha.analizarArgumentos(BASE, ENV).cfg).toMatchObject({ aplicar: false, tel: TEL, workflow: 'abc123XYZ' });
    const a = ficha.analizarArgumentos([...BASE, '--aplicar', '--confirmo-produccion', 'abc123XYZ', '--respaldo', rutaRespaldo()], ENV);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(a.cfg.aplicar).toBe(true);
  });
});

const estado = () => ({
  global: {
    [TEL]: { historial: ['x'] }, [OTRO]: { historial: ['y'] }, [PREFIJO]: { historial: ['z'] },
    barreras: { [TEL]: { turno: 1 }, [OTRO]: { turno: 2 }, [PREFIJO]: { turno: 3 } },
    memoria: [{ from: TEL, t: 1 }, { from: OTRO, t: 2 }, { from: PREFIJO, t: 3 }],
    mensajes: { m1: { from: TEL, texto: 'a' }, m2: { from: OTRO, texto: 'b' } },
    ajuste: { a: 1 },
  },
});
const flujo = () => ({ name: 'Flujo de prueba', active: true, nodes: [{ id: 'n1', parameters: { x: 1 } }], connections: { n1: {} }, settings: { executionOrder: 'v1' }, staticData: estado() });
const cfgDe = (extra: Cfg = {}): Cfg => ({ workflow: 'abc123XYZ', tel: TEL, aplicar: false, respaldo: null, ...extra });
const mundo = () => {
  let vivo: any = flujo(); const puts: any[] = [];
  return { puts, get vivo() { return vivo; }, set vivo(v: any) { vivo = v; },
    deps: { leer: async () => JSON.parse(JSON.stringify(vivo)), escribir: async (_v: any, sd: any) => { puts.push(sd); vivo = { ...vivo, staticData: sd }; return 200; } } };
};

describe('R2. sinFicha (puro)', () => {
  it('borra solo el teléfono pedido: claves y objetos con from, también en listas; no muta la entrada', () => {
    const e = estado(); const antes = JSON.stringify(e);
    const r = ficha.sinFicha(e, TEL);
    expect(JSON.stringify(e)).toBe(antes);
    expect(r.total).toBe(4);
    const g = r.nuevo.global;
    expect(TEL in g).toBe(false);
    expect(g.barreras).toEqual({ [OTRO]: { turno: 2 }, [PREFIJO]: { turno: 3 } });
    expect(g.memoria).toEqual([{ from: OTRO, t: 2 }, { from: PREFIJO, t: 3 }]);
    expect(g.mensajes).toEqual({ m2: { from: OTRO, texto: 'b' } });
  });
  it('NEGADO: un teléfono con el mismo prefijo no se toca', () => {
    const g = ficha.sinFicha(estado(), TEL).nuevo.global;
    expect(g[PREFIJO]).toEqual({ historial: ['z'] });
    expect(g.barreras[PREFIJO]).toEqual({ turno: 3 });
  });
  it('NEGADO: objetos de otros teléfonos y el resto del estado quedan intactos', () => {
    const g = ficha.sinFicha(estado(), TEL).nuevo.global;
    expect(g[OTRO]).toEqual({ historial: ['y'] });
    expect(g.ajuste).toEqual({ a: 1 });
  });
  it('NEGADO: sin ficha del teléfono no hay nada que borrar; staticData ausente no falla', () => {
    expect(ficha.sinFicha(estado(), '59100000009').total).toBe(0);
    expect(ficha.sinFicha(undefined, TEL).total).toBe(0);
  });
  it('los conteos no exponen teléfonos: segmentos numéricos y claves mixtas salen con #', () => {
    const r = ficha.sinFicha({ global: { [`tel_${OTRO}_x`]: { [`sub_${OTRO}`]: { m: { from: TEL } } }, [OTRO]: { a: 1 } } }, TEL);
    expect(r.total).toBe(1);
    expect(JSON.stringify(r.porContenedor)).not.toMatch(/\d{6,}/);
    expect(Object.keys(r.porContenedor)[0]).toBe('global.tel_#_x.sub_#');
  });
  it('NEGADO: un `from` igual al teléfono en un contenedor (global, o un mapa que guarda fichas de otros) no lo borra entero', () => {
    const a = ficha.sinFicha({ global: { from: TEL, rroca: { [OTRO]: { h: 1 } }, otro: 1 } }, TEL);
    expect(a.total).toBe(0);
    expect(a.nuevo).toEqual({ global: { from: TEL, rroca: { [OTRO]: { h: 1 } }, otro: 1 } });
    const b = ficha.sinFicha({ global: { rroca: { from: TEL, [OTRO]: { h: 1 } }, otro: 1 } }, TEL);
    expect(b.total).toBe(0);
    expect(b.nuevo.global.rroca[OTRO]).toEqual({ h: 1 });
    const c = ficha.sinFicha({ from: TEL, 'node:X': { a: 1 } }, TEL); // nunca profundidad 0 ni 1
    expect(c.total).toBe(0);
    expect(c.nuevo).toEqual({ from: TEL, 'node:X': { a: 1 } });
  });
  it('NEGADO: el teléfono anidado en la ficha de OTRO no se toca; la clave suelta en la raíz tampoco', () => {
    const sd = { global: { x: { [OTRO]: { referidos: { [TEL]: 1 }, lista: [{ from: TEL }] } }, y: { from: OTRO, ref: { [TEL]: 1 } } }, [TEL]: { raiz: 1 } };
    const r = ficha.sinFicha(sd, TEL);
    expect(r.total).toBe(0);
    expect(r.nuevo).toEqual(sd);
  });
  it('posibles restos: otras formas de clave se cuentan (sin imprimirse) y el resultado dice ⚠', async () => {
    const sd = { global: { [`+${TEL}`]: { a: 1 }, [`c_${TEL}`]: { a: 1 }, lista: [TEL.slice(-8)], [TEL]: { b: 1 } } };
    const r = ficha.sinFicha(sd, TEL);
    expect(r.total).toBe(1);
    expect(r.restos).toBe(3);
    const m = mundo(); m.vivo = { ...m.vivo, staticData: { global: { [`+${TEL}`]: { a: 1 } } } };
    const salida: string[] = [];
    expect(await ficha.ejecutar(cfgDe(), m.deps, (t: string) => salida.push(t))).toBe(0);
    const t = salida.join('\n');
    expect(t).toContain('⚠'); expect(t).not.toContain('✓'); expect(t).not.toMatch(/\d{8}/);
  });
});

describe('R3. ejecutar', () => {
  it('el seco no escribe, sale 1 y no imprime teléfonos', async () => {
    const m = mundo(); const salida: string[] = [];
    expect(await ficha.ejecutar(cfgDe(), m.deps, (t: string) => salida.push(t))).toBe(1);
    expect(m.puts).toHaveLength(0);
    const t = salida.join('\n');
    expect(t).not.toMatch(/59100000/); expect(t).not.toContain('historial');
  });
  it('sin ficha del teléfono: sale 0 y no escribe aunque se pida --aplicar', async () => {
    const m = mundo();
    expect(await ficha.ejecutar(cfgDe({ tel: '59100000009', aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(0);
    expect(m.puts).toHaveLength(0);
  });
  it('NEGADO: respaldo existente no se pisa y no se escribe', async () => {
    const m = mundo(); const resp = rutaRespaldo(); writeFileSync(resp, 'previo', { mode: 0o600 });
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, () => {})).toBe(2);
    expect(m.puts).toHaveLength(0);
    expect(readFileSync(resp, 'utf8')).toBe('previo');
  });
  it('NEGADO: si el flujo cambió entre la lectura y la escritura, no escribe ni deja respaldo', async () => {
    const m = mundo(); let n = 0; const leer = m.deps.leer; const resp = rutaRespaldo();
    m.deps.leer = async () => { const v = await leer(); n += 1; if (n === 2) v.staticData.global[OTRO].historial.push('nuevo'); return v; };
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, () => {})).toBe(3);
    expect(m.puts).toHaveLength(0);
    expect(() => readFileSync(resp)).toThrow();
  });
  it('--aplicar: respaldo 0600 del staticData completo, un PUT, nodos y ajustes intactos, otros teléfonos intactos', async () => {
    const m = mundo(); const resp = rutaRespaldo(); const nodosAntes = JSON.stringify(m.vivo.nodes);
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: resp }), m.deps, () => {})).toBe(0);
    const r = leido(resp);
    expect(r.modo).toBe(0o600);
    expect(r.json.staticData.global[TEL]).toBeDefined();
    expect(m.puts).toHaveLength(1);
    expect(ficha.quedan(m.vivo.staticData, TEL)).toBe(0);
    expect(JSON.stringify(m.vivo.nodes)).toBe(nodosAntes);
    expect(m.vivo.settings).toEqual({ executionOrder: 'v1' });
    expect(m.vivo.active).toBe(true);
    expect(m.vivo.staticData.global[OTRO]).toEqual({ historial: ['y'] });
    expect(m.vivo.staticData.global[PREFIJO]).toEqual({ historial: ['z'] });
  });
  it('NEGADO: la verificación posterior falla si el teléfono reaparece al releer', async () => {
    const m = mundo();
    m.deps.escribir = async (_v: any, sd: any) => { m.puts.push(sd); m.vivo = { ...m.vivo, staticData: { global: { ...sd.global, [TEL]: { vuelve: true } } } }; return 200; };
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(3);
  });
  it('NEGADO: falla si el teléfono reaparece tras la espera (una ejecución en curso repuso el estado)', async () => {
    const m = mundo();
    const deps = { ...m.deps, esperar: async () => { m.vivo = { ...m.vivo, staticData: { global: { ...m.vivo.staticData.global, [TEL]: { vuelve: true } } } }; } };
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), deps, () => {})).toBe(3);
  });
  it('NEGADO: falla si, tras el PUT, algo del resto del estado cambió', async () => {
    const m = mundo();
    m.deps.escribir = async (_v: any, sd: any) => { const x = JSON.parse(JSON.stringify(sd)); x.global.ajuste.a = 2; m.vivo = { ...m.vivo, staticData: x }; return 200; };
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m.deps, () => {})).toBe(3);
  });
  it('NEGADO: falla si el PUT cambia los nodos o desactiva el flujo', async () => {
    const m1 = mundo();
    m1.deps.escribir = async (_v: any, sd: any) => { m1.vivo = { ...m1.vivo, staticData: sd, nodes: [] }; return 200; };
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m1.deps, () => {})).toBe(3);
    const m2 = mundo();
    m2.deps.escribir = async (_v: any, sd: any) => { m2.vivo = { ...m2.vivo, staticData: sd, active: false }; return 200; };
    expect(await ficha.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), m2.deps, () => {})).toBe(3);
  });
});
