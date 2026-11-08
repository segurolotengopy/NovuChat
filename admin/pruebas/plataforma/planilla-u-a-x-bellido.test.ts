/**
 * `scripts/plataforma/planilla-u-a-x-bellido.mjs` — traslada «Diagnóstico del equipo» de la U a la X en la planilla miniCRM de Bellido.
 *
 * Sin red ni nube: una hoja en memoria que imita la API de Sheets (recorta celdas vacías del final). Los datos son sintéticos.
 * Se niega primero: sin respaldo no traslada; X con datos aborta; relectura distinta no vacía U; nunca imprime celdas; --revertir restaura.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error módulo .mjs sin tipos
import * as S from '../../scripts/plataforma/planilla-u-a-x-bellido.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const mapa = S.leerMapa();
const MARCA_CELDA = 'dato-de-salud-de-prueba';

const letraAIdx = (l: string) => l.charCodeAt(0) - 65;
function encabezadoViejo(): string[] {
  const f: string[] = [];
  for (const c of [...Object.values<any>(mapa.columnas), ...Object.values<any>(mapa.equipo)]) f[letraAIdx(c.letra)] = c.titulo;
  f[20] = 'Diagnóstico del equipo'; f[21] = ''; f[22] = ''; f[23] = '';
  return Array.from({ length: 24 }, (_, i) => f[i] ?? '');
}
function filaDatos(n: number, u = ''): string[] {
  const f = Array(24).fill('');
  f[0] = `LEAD-${1000 + n}`; f[2] = `Persona ${n}`; f[20] = u;
  return f;
}

/** Hoja en memoria, filas 3.. (índice 0 = fila 3). Imita a Sheets: recorta celdas vacías del final. */
function crearHoja(filas: any[][], opc: { corromperX?: boolean } = {}) {
  let m: any = filas.map((f) => [...f]);
  const ops: string[] = [];
  const parse = (a1: string) => {
    const r = /^([A-Z])(\d+)(?::([A-Z])(\d+))?$/.exec(a1)! as any;
    return { c1: letraAIdx(r[1]), f1: +r[2] - 3, c2: letraAIdx(r[3] ?? r[1]), f2: +(r[4] ?? r[2]) - 3 };
  };
  const asegurar = (f: number) => { while (m.length <= f) m.push(Array(24).fill('')); };
  const deps = {
    leer: async () => m.map((f: any) => { const c = [...f]; while (c.length && c.at(-1) === '') c.pop(); return c; }),
    escribir: async (a1: string, v: any) => {
      ops.push(`E ${a1}`);
      const p = parse(a1); asegurar(p.f2);
      for (let i = 0; i <= p.f2 - p.f1; i++) for (let j = 0; j <= p.c2 - p.c1; j++) {
        let x = v[i][j]; if (opc.corromperX && p.c1 === 23 && i === 1) x = 'ALTERADO';
        m[p.f1 + i][p.c1 + j] = x as string;
      }
    },
    limpiar: async (a1: string) => {
      ops.push(`L ${a1}`);
      const p = parse(a1); asegurar(p.f2);
      for (let i = p.f1; i <= p.f2; i++) for (let j = p.c1; j <= p.c2; j++) m[i][j] = '';
    },
  };
  return { deps, ops, get m(): any { return m; }, set m(v: any) { m = v; } };
}

function respaldosEnMemoria(inicial: Record<string, unknown> = {}) {
  const arch = new Map<string, unknown>(Object.entries(inicial));
  return {
    arch,
    guardar: (n: string, o: unknown) => { if (arch.has(`/r/${n}`)) throw Object.assign(new Error('x'), { code: 'EEXIST' }); arch.set(`/r/${n}`, o); return `/r/${n}`; },
    listar: () => [...arch.keys()].map((ruta) => ({ nombre: ruta.split('/').at(-1)!, ruta })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    leer: (ruta: string) => (arch.has(ruta) ? { ok: true, respaldo: arch.get(ruta) } : { ok: false, motivo: 'no existe' }),
  };
}

const AHORA = new Date('2026-11-07T15:30:00Z'); // 11:30 en La Paz
const cfg = (o: Record<string, unknown> = {}) => ({ modo: 'trasladar', aplicar: true, revertir: false, aceptoPerder: false, hojaFin: 'ABC123', respaldo: null, ...o });
const sucio = (): any[][] => [encabezadoViejo(), filaDatos(1, `${MARCA_CELDA}-1`), filaDatos(2, ''), filaDatos(3, `${MARCA_CELDA}-3`)];
function correr(c: Record<string, unknown>, hoja: ReturnType<typeof crearHoja>, resp: ReturnType<typeof respaldosEnMemoria>) {
  const salida: string[] = [];
  return S.ejecutar(c, { ...hoja.deps, respaldos: resp, ahora: () => AHORA }, mapa, (t: string) => salida.push(t)).then((codigo: number) => ({ codigo, texto: salida.join('\n') }));
}
async function conRespaldo(filas = sucio()) {
  const hoja = crearHoja(filas);
  const resp = respaldosEnMemoria();
  const r = await correr(cfg({ modo: 'respaldar' }), hoja, resp);
  expect(r.codigo).toBe(0);
  return { hoja, resp };
}

describe('P1. Argumentos', () => {
  const env = { SHEET_ID: 'a'.repeat(30), ENV_FILE: '/x/.env' };
  it('niega modo desconocido, --aplicar sin confirmar la hoja y confirmación equivocada', () => {
    expect(S.analizarArgumentos(['borrar'], env).ok).toBe(false);
    expect(S.analizarArgumentos(['trasladar', '--aplicar'], env).ok).toBe(false);
    expect(S.analizarArgumentos(['trasladar', '--aplicar', '--confirmo-hoja', 'zzzzzz'], env).ok).toBe(false);
    expect(S.analizarArgumentos(['trasladar', '--aplicar', '--confirmo-hoja', 'aaaaaa'], env).ok).toBe(true);
  });
  it('contar no admite opciones; --revertir solo con trasladar; sin SHEET_ID no corre', () => {
    expect(S.analizarArgumentos(['contar', '--aplicar'], env).ok).toBe(false);
    expect(S.analizarArgumentos(['respaldar', '--revertir'], env).ok).toBe(false);
    expect(S.analizarArgumentos(['trasladar'], { ENV_FILE: '/x' }).ok).toBe(false);
    expect(S.analizarArgumentos(['trasladar', '--acepto-perder-datos-nuevos'], env).ok).toBe(false);
  });
});

describe('P2. contar: solo lectura y sin contenido', () => {
  it('cuenta, verifica U3 y no imprime celdas ni escribe', async () => {
    const hoja = crearHoja(sucio());
    const r = await correr(cfg({ modo: 'contar', aplicar: false }), hoja, respaldosEnMemoria());
    expect(r.codigo).toBe(0);
    expect(r.texto).toContain('U=2 · V=0 · W=0 · X=0');
    expect(r.texto).toContain('Diagnóstico del equipo');
    expect(r.texto).not.toContain(MARCA_CELDA);
    expect(r.texto).not.toContain('Persona');
    expect(hoja.ops).toEqual([]);
  });
  it('U3 inesperado: sale 2', async () => {
    const f: any = sucio(); f[0][20] = 'Otra cosa';
    expect((await correr(cfg({ modo: 'contar', aplicar: false }), crearHoja(f), respaldosEnMemoria())).codigo).toBe(2);
  });
});

describe('P3. respaldar', () => {
  it('seco no guarda; aplicar guarda con nombre La Paz y no imprime contenido; no se pisa', async () => {
    const resp = respaldosEnMemoria();
    const hoja = crearHoja(sucio());
    const seco = await correr(cfg({ modo: 'respaldar', aplicar: false }), hoja, resp);
    expect(seco.codigo).toBe(1); expect(resp.arch.size).toBe(0);
    const ap = await correr(cfg({ modo: 'respaldar' }), hoja, resp);
    expect(ap.codigo).toBe(0);
    expect([...resp.arch.keys()]).toEqual(['/r/BELLIDO_planilla-respaldo_2026-11-07-1130.json']);
    expect(ap.texto).not.toContain(MARCA_CELDA);
    expect((await correr(cfg({ modo: 'respaldar' }), hoja, resp)).codigo).toBe(2);
  });
  it('el respaldo en disco es 0600 y no pisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bell-'));
    try {
      const d = S.respaldosEnDisco(dir);
      const ruta = d.guardar('BELLIDO_planilla-respaldo_2026-11-07-1130.json', { a: 1 });
      expect(statSync(ruta).mode & 0o777).toBe(0o600);
      expect(() => d.guardar('BELLIDO_planilla-respaldo_2026-11-07-1130.json', { a: 2 })).toThrow();
      expect(d.leer(ruta).ok).toBe(true);
      expect(() => d.guardar('otro.json', {})).toThrow();
      expect(readdirSync(dir).length).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('P4. trasladar: se niega primero', () => {
  it('sin respaldo no traslada ni escribe', async () => {
    const hoja = crearHoja(sucio());
    const r = await correr(cfg(), hoja, respaldosEnMemoria());
    expect(r.codigo).toBe(2); expect(hoja.ops).toEqual([]);
  });
  it('respaldo de otro día no vale', async () => {
    const { hoja, resp } = await conRespaldo();
    const viejo = resp.arch.get('/r/BELLIDO_planilla-respaldo_2026-11-07-1130.json');
    const resp2 = respaldosEnMemoria({ '/r/BELLIDO_planilla-respaldo_2026-11-06-1130.json': viejo });
    const r = await correr(cfg(), hoja, resp2);
    expect(r.codigo).toBe(2); expect(hoja.ops).toEqual([]);
  });
  it('X con datos aborta', async () => {
    const f: any = sucio(); f[2][23] = 'algo';
    const hoja = crearHoja(f); const resp = respaldosEnMemoria();
    await correr(cfg({ modo: 'respaldar' }), hoja, resp);
    const r = await correr(cfg(), hoja, resp);
    expect(r.codigo).toBe(2); expect(hoja.ops).toEqual([]);
  });
  it('V o W con datos o título aborta', async () => {
    for (const j of [21, 22]) {
      const f: any = sucio(); f[1][j] = 'Sí';
      const hoja = crearHoja(f); const resp = respaldosEnMemoria();
      await correr(cfg({ modo: 'respaldar' }), hoja, resp);
      expect((await correr(cfg(), hoja, resp)).codigo).toBe(2);
      expect(hoja.ops).toEqual([]);
    }
  });
  it('si U..X cambió después del respaldo, aborta', async () => {
    const { hoja, resp } = await conRespaldo();
    hoja.m[2][20] = 'editado después';
    const r = await correr(cfg(), hoja, resp);
    expect(r.codigo).toBe(2); expect(hoja.ops).toEqual([]);
  });
  it('encabezados de A..T movidos: no escribe', async () => {
    const f: any = sucio(); f[0][5] = 'Otro título';
    const { hoja, resp } = await conRespaldo(sucio());
    hoja.m = f;
    expect((await correr(cfg(), hoja, resp)).codigo).toBe(2); expect(hoja.ops).toEqual([]);
  });
  it('seco con respaldo valido: 1 y no escribe', async () => {
    const { hoja, resp } = await conRespaldo();
    const r = await correr(cfg({ aplicar: false }), hoja, resp);
    expect(r.codigo).toBe(1); expect(hoja.ops).toEqual([]);
  });
});

describe('P5. trasladar --aplicar', () => {
  it('mueve U a X, vacía U, escribe títulos, no toca otras columnas, nunca imprime celdas', async () => {
    const { hoja, resp } = await conRespaldo();
    const antes = JSON.parse(JSON.stringify(hoja.m));
    const r = await correr(cfg(), hoja, resp);
    expect(r.codigo).toBe(0);
    expect(r.texto).not.toContain(MARCA_CELDA);
    expect(r.texto).not.toContain('Persona');
    expect(hoja.m[0].slice(20, 24)).toEqual(['Servicio elegido', 'Agendó', 'Fecha y hora de la cita', 'Diagnóstico del equipo']);
    expect(hoja.m.map((f: any) => f[23]).slice(1)).toEqual([`${MARCA_CELDA}-1`, '', `${MARCA_CELDA}-3`]);
    expect(hoja.m.slice(1).every((f: any) => f[20] === '')).toBe(true);
    for (let i = 0; i < antes.length; i++) expect(hoja.m[i].slice(0, 20)).toEqual(antes[i].slice(0, 20));
    expect(hoja.m.length).toBe(antes.length); // nunca borra filas
    // El orden: primero copia a X, recién después vacía U
    expect(hoja.ops[0]).toBe('E X3:X6');
    expect(hoja.ops.indexOf('L U4:U6')).toBeGreaterThan(0);
    expect(hoja.ops.every((o) => /^(E X3:X6|L U4:U6|E U3:W3)$/.test(o))).toBe(true);
  });
  it('relectura distinta: aborta (3) y NO vacía U', async () => {
    const base = await conRespaldo();
    const hoja = crearHoja(sucio(), { corromperX: true });
    const r = await correr(cfg(), hoja, base.resp);
    expect(r.codigo).toBe(3);
    expect(hoja.ops.some((o) => o.startsWith('L '))).toBe(false);
    expect(hoja.m[1][20]).toBe(`${MARCA_CELDA}-1`);
    expect(hoja.m[0][20]).toBe('Diagnóstico del equipo');
    expect(r.texto).not.toContain(MARCA_CELDA);
  });
  it('si el bot escribió entre la lectura y la escritura, no escribe', async () => {
    const { hoja, resp } = await conRespaldo();
    let n = 0; const leer = hoja.deps.leer;
    hoja.deps.leer = async () => { n += 1; if (n === 2) hoja.m[1][20] = 'cambió'; return leer(); };
    const r = await correr(cfg(), hoja, resp);
    expect(r.codigo).toBe(3); expect(hoja.ops).toEqual([]);
  });
});

describe('P6. --revertir restaura', () => {
  it('después de trasladar devuelve U y vacía V, W, X y títulos', async () => {
    const { hoja, resp } = await conRespaldo();
    const original = JSON.parse(JSON.stringify(hoja.m));
    expect((await correr(cfg(), hoja, resp)).codigo).toBe(0);
    const r = await correr(cfg({ revertir: true }), hoja, resp);
    expect(r.codigo).toBe(0);
    expect(r.texto).not.toContain(MARCA_CELDA);
    expect(hoja.m).toEqual(original);
  });
  it('si V/W/X traen datos que no están en el respaldo, se niega salvo --acepto-perder-datos-nuevos', async () => {
    const { hoja, resp } = await conRespaldo();
    await correr(cfg(), hoja, resp);
    hoja.m[1][21] = 'Sí';
    const ops0 = hoja.ops.length;
    expect((await correr(cfg({ revertir: true }), hoja, resp)).codigo).toBe(2);
    expect(hoja.ops.length).toBe(ops0);
    expect((await correr(cfg({ revertir: true, aceptoPerder: true }), hoja, resp)).codigo).toBe(0);
    expect(hoja.m[1][20]).toBe(`${MARCA_CELDA}-1`);
  });
  it('sin respaldo no revierte; seco no escribe', async () => {
    const hoja = crearHoja(sucio());
    expect((await correr(cfg({ revertir: true }), hoja, respaldosEnMemoria())).codigo).toBe(2);
    const { hoja: h2, resp } = await conRespaldo();
    await correr(cfg(), h2, resp);
    const n = h2.ops.length;
    expect((await correr(cfg({ revertir: true, aplicar: false }), h2, resp)).codigo).toBe(1);
    expect(h2.ops.length).toBe(n);
  });
});

describe('P7. El texto del script', () => {
  const src = readFileSync(join(aqui, '..', '..', 'scripts', 'plataforma', 'planilla-u-a-x-bellido.mjs'), 'utf8');
  it('la expresión de escritura tiene una sola llave doble de cierre y el dato viaja en el cuerpo', () => {
    const e: string = S.expresionEscribir('X3:X6');
    expect(e.split('}}').length - 1).toBe(1);
    expect(e.endsWith('}}')).toBe(true);
    expect(e).toContain("body.valores");
  });
  it('no usa otro mecanismo de credencial ni escribe fuera de U..X ni de Leads_CRM', () => {
    expect(src).not.toMatch(/GOOGLE_APPLICATION|private_key|N8N_API_KEY\s*[:=]/);
    expect(src).not.toMatch(/deleteDimension|batchUpdate|:append/);
    expect(src).toContain('correrEnN8n');
    expect(src).toContain("TENANT = 'bellido'");
  });
});


describe('P8. Revisión: relecturas, ID, hoja y celdas no texto', () => {
  it('fila vacía entera en medio no rompe el traslado', async () => {
    const f: any = sucio(); f.splice(2, 0, []);
    const { hoja, resp } = await conRespaldo(f.map((x: any[]) => (x.length ? x : Array(24).fill(''))));
    expect((await correr(cfg(), hoja, resp)).codigo).toBe(0);
  });
  it('fila nueva durante el traslado (entre lecturas): aborta sin escribir', async () => {
    const { hoja, resp } = await conRespaldo();
    let n = 0; const leer = hoja.deps.leer;
    hoja.deps.leer = async () => { n += 1; if (n === 2) hoja.m.push(filaDatos(9)); return leer(); };
    const r = await correr(cfg(), hoja, resp);
    expect(r.codigo).toBe(3); expect(hoja.ops).toEqual([]);
  });
  it('fila nueva tras copiar X: no vacía U', async () => {
    const { hoja, resp } = await conRespaldo();
    let n = 0; const leer = hoja.deps.leer;
    hoja.deps.leer = async () => { n += 1; if (n === 3) hoja.m.push(filaDatos(9)); return leer(); };
    const r = await correr(cfg(), hoja, resp);
    expect(r.codigo).toBe(3); expect(hoja.ops.some((o) => o.startsWith('L '))).toBe(false);
  });
  it('edición de U entre la copia y el vaciado: no vacía U', async () => {
    const { hoja, resp } = await conRespaldo();
    let n = 0; const leer = hoja.deps.leer;
    hoja.deps.leer = async () => { n += 1; if (n === 3) hoja.m[1][20] = 'editado en el medio'; return leer(); };
    const r = await correr(cfg(), hoja, resp);
    expect(r.codigo).toBe(3); expect(hoja.ops.some((o) => o.startsWith('L '))).toBe(false);
    expect(r.texto).not.toContain('editado en el medio');
  });
  it('columna A distinta del respaldo: traslado y reversa abortan (aun con --acepto-perder-datos-nuevos)', async () => {
    const { hoja, resp } = await conRespaldo();
    hoja.m[1][0] = 'LEAD-9999';
    expect((await correr(cfg(), hoja, resp)).codigo).toBe(2);
    expect((await correr(cfg({ revertir: true, aceptoPerder: true }), hoja, resp)).codigo).toBe(2);
    expect(hoja.ops).toEqual([]);
  });
  it('respaldo de otra planilla (hojaFin distinto) no vale', async () => {
    const { hoja, resp } = await conRespaldo();
    expect((await correr(cfg({ hojaFin: 'ZZZZZZ' }), hoja, resp)).codigo).toBe(2);
    expect((await correr(cfg({ hojaFin: 'ZZZZZZ', revertir: true, aceptoPerder: true }), hoja, resp)).codigo).toBe(2);
    expect(hoja.ops).toEqual([]);
  });
  it('celdas de U que no son texto: contar las informa y trasladar aborta', async () => {
    const f: any = sucio(); f[2][20] = 4500;
    const hoja = crearHoja(f); const resp = respaldosEnMemoria();
    const c = await correr(cfg({ modo: 'contar', aplicar: false }), hoja, resp);
    expect(c.texto).toContain('no son texto (números, fechas, booleanos): 1');
    await correr(cfg({ modo: 'respaldar' }), hoja, resp);
    expect((await correr(cfg(), hoja, resp)).codigo).toBe(2); expect(hoja.ops).toEqual([]);
  });
  it('el respaldo solo lleva A y U..X', async () => {
    const { resp } = await conRespaldo();
    const v = (resp.arch.get('/r/BELLIDO_planilla-respaldo_2026-11-07-1130.json') as any).valores;
    expect(JSON.stringify(v)).not.toContain('Persona');
    expect(v[1][0]).toBe('LEAD-1001');
    expect(v[1][20]).toBe(`${MARCA_CELDA}-1`);
  });
});
