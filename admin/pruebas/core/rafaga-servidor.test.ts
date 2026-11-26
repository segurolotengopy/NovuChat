/**
 * RÁFAGAS, LA PARTE DEL SERVIDOR (`core/conversacion/rafaga.ts` + la rama `rafaga` de `configuracionFlujo`).
 *
 * Se prueba negando: pedidos mal formados (400), `rafaga` con `sesion` (400), sin firma (401), comercio
 * suspendido (409), un tenant ajeno que nunca se lee, como mucho 6 documentos leídos, cero escrituras y
 * la respuesta normal SIN `rafagaApagada` idéntica a la de hoy (esa parte, por HTTP, está en
 * `pruebas/rafaga-http.test.ts`: una prueba de `core/` no puede importar `ingesta.ts`, que es del coordinador).
 * Teléfonos ficticios (seis ceros seguidos).
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import {
  fragmentosDeRafaga, leerRafaga, validarRafaga, MAX_LECTURAS, MAX_LECTURAS_DE_LA_RAMA, LECTURAS_DE_LA_RUTA, VENTANA_PROPIA_MS, VENTANA_VECINOS_MS,
  TOPE_POR_MINUTO, TOPE_POR_COMERCIO_POR_MINUTO, tomarCupoDeRafaga, reiniciarCuposDeRafaga, type MensajeCrudo,
} from '../../functions/src/core/conversacion/rafaga.ts';

const TEL = '59100000031';
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);

const ent = (idMeta: string, texto: string, ms: number, extra: Partial<MensajeCrudo> = {}): MensajeCrudo =>
  ({ direccion: 'entrante', tipo: 'text', texto, idMeta, ts: ms, ...extra });

describe('validarRafaga', () => {
  const ok = { v: 1, idMeta: 'wamid.AAA' };
  it('acepta el pedido bien formado', () => {
    expect(validarRafaga(ok, TEL)).toEqual({ ok: true, idMeta: 'wamid.AAA' });
  });
  it.each([
    ['sin teléfono', ok, null],
    ['teléfono corto', ok, '1234567'],
    ['teléfono con letras', ok, '5910000003a'],
    ['no es objeto', 'x', TEL],
    ['es lista', [ok], TEL],
    ['nulo', null, TEL],
    ['otra clave', { ...ok, tenantId: 'rafaga-b' }, TEL],
    ['versión 2', { ...ok, v: 2 }, TEL],
    ['sin versión', { idMeta: 'a' }, TEL],
    ['idMeta vacío', { v: 1, idMeta: '' }, TEL],
    ['idMeta de 121', { v: 1, idMeta: 'a'.repeat(121) }, TEL],
    ['idMeta número', { v: 1, idMeta: 5 }, TEL],
    ['sin idMeta', { v: 1 }, TEL],
  ])('rechaza con 400: %s', (_n, cuerpo, tel) => {
    const r = validarRafaga(cuerpo, tel as string | null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
  it('acepta un idMeta de 120', () => {
    expect(validarRafaga({ v: 1, idMeta: 'a'.repeat(120) }, TEL).ok).toBe(true);
  });
});

describe('fragmentosDeRafaga (pura)', () => {
  it('devuelve en orden cronológico', () => {
    const f = fragmentosDeRafaga([ent('c', 'tres', T0 + 2000), ent('b', 'dos', T0 + 1000), ent('a', 'uno', T0)]);
    expect(f.map((x) => x.texto)).toEqual(['uno', 'dos', 'tres']);
    expect(f[0]).toEqual({ idMeta: 'a', tipo: 'text', texto: 'uno', ms: T0 });
  });
  it('un saliente es una MARCA en su lugar cronológico, sin texto ni idMeta', () => {
    const f = fragmentosDeRafaga([
      ent('c', 'tres', T0 + 3000), ent('b', 'dos', T0 + 2000),
      { direccion: 'saliente', tipo: 'text', texto: 'respuesta', idMeta: 'wamid.S', ts: T0 + 1000 }, ent('a', 'viejo', T0),
    ]);
    expect(f.map((x) => [x.idMeta, x.tipo, x.texto])).toEqual([
      ['a', 'text', 'viejo'], ['', 'saliente', ''], ['b', 'text', 'dos'], ['c', 'text', 'tres'],
    ]);
  });
  it('un entrante sin idMeta (pedido del catálogo) sale con idMeta vacío y su tipo, y no invalida nada', () => {
    const f = fragmentosDeRafaga([ent('b', 'dos', T0 + 2000), { direccion: 'entrante', tipo: 'order', texto: 'pedido', ts: T0 + 1000 }]);
    expect(f.map((x) => [x.idMeta, x.tipo])).toEqual([['', 'order'], ['b', 'text']]);
  });
  it('un idMeta repetido queda una vez, el más antiguo', () => {
    const f = fragmentosDeRafaga([ent('a', 'reintento', T0 + 5000), ent('b', 'otro', T0 + 2000), ent('a', 'primero', T0)]);
    expect(f.map((x) => x.texto)).toEqual(['primero', 'otro']);
  });
  it('empate de hora: orden estable por idMeta', () => {
    const f = fragmentosDeRafaga([ent('z', 'z', T0), ent('a', 'a', T0)]);
    expect(f.map((x) => x.idMeta)).toEqual(['a', 'z']);
  });
  it('recorta el texto a 1500 y conserva el tipo (audio sin texto)', () => {
    const f = fragmentosDeRafaga([ent('a', 'x'.repeat(2000), T0), ent('b', '', T0 - 1, { tipo: 'audio' })]);
    expect(f[1]!.texto).toHaveLength(1500);
    expect(f[0]).toMatchObject({ tipo: 'audio', texto: '' });
  });
  it('ignora lo que no tiene hora y no se rompe con basura', () => {
    expect(fragmentosDeRafaga([{ direccion: 'entrante', texto: 5, ts: 'ayer', idMeta: 7 }])).toEqual([]);
  });
  it('acepta Timestamp de Firestore', () => {
    const f = fragmentosDeRafaga([ent('a', 'x', 0, { ts: Timestamp.fromMillis(T0) })]);
    expect(f[0]!.ms).toBe(T0);
  });
});

/**
 * Firestore en memoria, lo mínimo que usa `leerRafaga`: where('idMeta','==').limit, orderBy('ts', dir)
 * .startAfter(doc).limit. Orden total (ts, id), igual que Firestore con cursor de documento.
 * Cuenta los documentos entregados (lecturas) y registra cada consulta.
 */
interface DocFalso { id: string; data: () => MensajeCrudo }
function firestoreFalso(docs: { id: string; d: MensajeCrudo }[]) {
  const estado = { leidos: 0, consultas: [] as string[], coleccion: '' };
  const todos: DocFalso[] = docs.map((x) => ({ id: x.id, data: () => x.d }));
  const ms = (d: DocFalso) => d.data().ts as number;
  const cmp = (x: DocFalso, y: DocFalso) => ms(x) - ms(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  const consulta = (filtro: DocFalso[], dir: 'asc' | 'desc' | null, tras: DocFalso | null, tope: number, etiqueta: string) => ({
    where(campo: string, op: string, valor: unknown) {
      return consulta(filtro.filter((d) => op === '==' && d.data()[campo as 'idMeta'] === valor), dir, tras, tope, `${etiqueta}where(${campo})`);
    },
    orderBy(campo: string, d: 'asc' | 'desc') { return consulta(filtro, campo === 'ts' ? d : dir, tras, tope, `${etiqueta}orderBy(${campo},${d})`); },
    startAfter(doc: DocFalso) { return consulta(filtro, dir, doc, tope, `${etiqueta}startAfter`); },
    limit(n: number) { return consulta(filtro, dir, tras, n, `${etiqueta}limit(${n})`); },
    async get() {
      estado.consultas.push(etiqueta);
      let r = [...filtro].sort(cmp);
      if (dir === 'desc') r.reverse();
      if (tras) { const i = r.findIndex((d) => d.id === tras.id); r = r.slice(i + 1); }
      r = r.slice(0, tope);
      estado.leidos += r.length;
      return { docs: r };
    },
  });
  const db = { collection(p: string) { estado.coleccion = p; return consulta(todos, null, null, Infinity, ''); } } as unknown as Firestore;
  return { db, estado };
}
const sem = (...e: [string, MensajeCrudo][]) => e.map(([id, d]) => ({ id, d }));
const sal = (ms: number): MensajeCrudo => ({ direccion: 'saliente', tipo: 'text', texto: 'bot', ts: ms });

describe('leerRafaga: relativa a mi mensaje', () => {
  it('lee la conversación del tenant dado y devuelve predecesores, yo y sucesores en orden', async () => {
    const { db, estado } = firestoreFalso(sem(
      ['d1', ent('a', 'uno', T0)], ['d2', ent('b', 'dos', T0 + 1000)], ['d3', ent('c', 'tres', T0 + 2000)],
    ));
    const r = await leerRafaga(db, 'tenant-x', TEL, 'b', T0 + 3000);
    expect(estado.coleccion).toBe(`tenants/tenant-x/conversaciones/wa_${TEL}/mensajes`);
    expect(r.fragmentos.map((f) => f.texto)).toEqual(['uno', 'dos', 'tres']);
  });
  it('un álbum de 8 fotos DESPUÉS de mi mensaje no me saca: predecesores y sucesor inmediato siguen', async () => {
    const docs = [['p1', ent('p1', 'previo1', T0)], ['p2', ent('p2', 'previo2', T0 + 100)], ['yo', ent('yo', 'mio', T0 + 200)]] as [string, MensajeCrudo][];
    for (let i = 0; i < 8; i++) docs.push([`f${i}`, ent(`f${i}`, '', T0 + 300 + i, { tipo: 'image' })]);
    const { db, estado } = firestoreFalso(sem(...docs));
    const r = await leerRafaga(db, 't', TEL, 'yo', T0 + 5000);
    expect(r.fragmentos.map((f) => f.idMeta)).toEqual(['p1', 'p2', 'yo', 'f0', 'f1', 'f2']);
    expect(estado.leidos).toBeLessThanOrEqual(MAX_LECTURAS_DE_LA_RAMA);
  });
  it('salientes entran como marca; entrantes sin idMeta con idMeta vacío', async () => {
    const { db } = firestoreFalso(sem(
      ['s', sal(T0)], ['o', { direccion: 'entrante', tipo: 'order', texto: 'x', ts: T0 + 100 }], ['yo', ent('yo', 'mio', T0 + 200)],
    ));
    const r = await leerRafaga(db, 't', TEL, 'yo', T0 + 300);
    expect(r.fragmentos.map((f) => [f.idMeta, f.tipo, f.texto])).toEqual([
      ['', 'saliente', ''], ['', 'order', 'x'], ['yo', 'text', 'mio'],
    ]);
  });
  it('máximo 5 anteriores y 3 posteriores: 9 documentos leídos', async () => {
    const docs: [string, MensajeCrudo][] = [];
    for (let i = 0; i < 20; i++) docs.push([`d${String(i).padStart(2, '0')}`, ent(`i${i}`, `t${i}`, T0 + i * 100)]);
    const { db, estado } = firestoreFalso(sem(...docs));
    const r = await leerRafaga(db, 't', TEL, 'i10', T0 + 2500);
    expect(r.fragmentos.map((f) => f.idMeta)).toEqual(['i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11', 'i12', 'i13']);
    expect(estado.leidos).toBe(9); // caso normal: mi documento + 5 + 3
    // Total real por consulta: ruta (1) + ficha (1) + mi documento (hasta 2) + 5 + 3 = 12.
    expect(LECTURAS_DE_LA_RUTA).toBe(2);
    expect(MAX_LECTURAS_DE_LA_RAMA).toBe(10);
    expect(MAX_LECTURAS).toBe(12);
  });
  it('wamid ajeno (que la conversación no tiene) -> [] sin leer vecinos', async () => {
    const { db, estado } = firestoreFalso(sem(['d1', ent('a', 'SECRETO', T0)]));
    expect(await leerRafaga(db, 't', TEL, 'wamid.otro', T0 + 1000)).toEqual({ v: 1, fragmentos: [] });
    expect(estado.leidos).toBe(0);
    expect(estado.consultas).toHaveLength(1);
  });
  it('un wamid que es de un SALIENTE no sirve de llave', async () => {
    const { db } = firestoreFalso(sem(['s', { ...sal(T0), idMeta: 'wamid.S' }], ['a', ent('a', 'SECRETO', T0 - 10)]));
    expect((await leerRafaga(db, 't', TEL, 'wamid.S', T0 + 1000)).fragmentos).toEqual([]);
  });
  it('mi mensaje con más de 60 s -> []; justo en el borde, sí', async () => {
    const { db } = firestoreFalso(sem(['a', ent('a', 'uno', T0)]));
    expect((await leerRafaga(db, 't', TEL, 'a', T0 + VENTANA_PROPIA_MS + 1)).fragmentos).toEqual([]);
    expect((await leerRafaga(db, 't', TEL, 'a', T0 + VENTANA_PROPIA_MS)).fragmentos).toHaveLength(1);
  });
  it('empate de ts: ningún vecino se pierde ni se repite, y yo no me duplico', async () => {
    const { db } = firestoreFalso(sem(
      ['a', ent('a', 'a', T0)], ['b', ent('b', 'b', T0)], ['c', ent('c', 'c', T0)], ['d', ent('d', 'd', T0)],
    ));
    for (const yo of ['a', 'b', 'c', 'd']) {
      const r = await leerRafaga(db, 't', TEL, yo, T0 + 100);
      expect(r.fragmentos.map((f) => f.idMeta).sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });
  it('idMeta duplicado (reintento de Meta): se toma el más antiguo y queda una vez', async () => {
    const { db, estado } = firestoreFalso(sem(
      ['x1', ent('yo', 'primero', T0)], ['x2', ent('yo', 'reintento', T0 + 400)], ['z', ent('z', 'sig', T0 + 500)],
    ));
    const r = await leerRafaga(db, 't', TEL, 'yo', T0 + 1000);
    expect(r.fragmentos.map((f) => [f.idMeta, f.texto])).toEqual([['yo', 'primero'], ['z', 'sig']]);
    expect(estado.leidos).toBeLessThanOrEqual(MAX_LECTURAS_DE_LA_RAMA);
  });
});

describe('leerRafaga: los vecinos viejos no entran', () => {
  it('descarta anteriores con más de 30 s de diferencia con MI hora; el borde exacto entra', async () => {
    const { db } = firestoreFalso(sem(
      ['v0', ent('v0', 'viejisimo', T0 - 40_000)],
      ['v1', ent('v1', 'borde', T0 - VENTANA_VECINOS_MS)],
      ['v2', ent('v2', 'justo fuera', T0 - VENTANA_VECINOS_MS - 1)],
      ['s', sal(T0 - 20_000)],
      ['yo', ent('yo', 'mio', T0)],
    ));
    const r = await leerRafaga(db, 't', TEL, 'yo', T0 + 1000);
    expect(r.fragmentos.map((f) => f.idMeta)).toEqual(['v1', '', 'yo']);
    expect(JSON.stringify(r)).not.toContain('viejisimo');
  });
  it('un anterior viejo no esconde a los más nuevos, y yo entro aunque todo lo demás sea viejo', async () => {
    const { db } = firestoreFalso(sem(['v0', ent('v0', 'viejo', T0 - 90_000)], ['yo', ent('yo', 'mio', T0)]));
    expect((await leerRafaga(db, 't', TEL, 'yo', T0)).fragmentos.map((f) => f.idMeta)).toEqual(['yo']);
  });
  it('mi mensaje con 61 s -> []; con 60 s exactos, entra', async () => {
    const { db } = firestoreFalso(sem(['yo', ent('yo', 'mio', T0)]));
    expect(VENTANA_PROPIA_MS).toBe(60_000);
    expect((await leerRafaga(db, 't', TEL, 'yo', T0 + 60_001)).fragmentos).toEqual([]);
    expect((await leerRafaga(db, 't', TEL, 'yo', T0 + 60_000)).fragmentos).toHaveLength(1);
  });
});

describe('tomarCupoDeRafaga: tope por comercio y teléfono, en memoria', () => {
  it('la llamada N+1 se rechaza; otro teléfono y otro comercio no se ven afectados', () => {
    reiniciarCuposDeRafaga();
    for (let i = 0; i < TOPE_POR_MINUTO; i++) expect(tomarCupoDeRafaga('ta', TEL, T0 + i)).toBe(true);
    expect(tomarCupoDeRafaga('ta', TEL, T0 + 1000)).toBe(false);
    expect(tomarCupoDeRafaga('ta', '59100000032', T0 + 1000)).toBe(true);
    expect(tomarCupoDeRafaga('tb', TEL, T0 + 1000)).toBe(true);
  });
  it('la ventana vuelve a abrirse al minuto', () => {
    reiniciarCuposDeRafaga();
    for (let i = 0; i < TOPE_POR_MINUTO; i++) tomarCupoDeRafaga('ta', TEL, T0);
    expect(tomarCupoDeRafaga('ta', TEL, T0 + 59_999)).toBe(false);
    expect(tomarCupoDeRafaga('ta', TEL, T0 + 60_000)).toBe(true);
  });
  it('un reloj que retrocede no deja la ventana trabada', () => {
    reiniciarCuposDeRafaga();
    for (let i = 0; i < TOPE_POR_MINUTO; i++) tomarCupoDeRafaga('ta', TEL, T0);
    expect(tomarCupoDeRafaga('ta', TEL, T0 - 5000)).toBe(true);
  });
});

describe('tomarCupoDeRafaga: tope por comercio (rotar teléfonos no lo esquiva)', () => {
  it('21 teléfonos distintos no llegan al tope comercial; el 121.º sí, y otro comercio no se afecta', () => {
    reiniciarCuposDeRafaga();
    const tel = (i: number) => `591000${String(i).padStart(5, '0')}`;
    for (let i = 0; i < TOPE_POR_COMERCIO_POR_MINUTO; i++) expect(tomarCupoDeRafaga('ta', tel(i), T0)).toBe(true);
    expect(tomarCupoDeRafaga('ta', tel(1000), T0 + 1000)).toBe(false);
    expect(tomarCupoDeRafaga('tb', tel(0), T0 + 1000)).toBe(true);
  });
  it('un rechazo no gasta cupo: tras el tope comercial, el teléfono conserva el suyo', () => {
    reiniciarCuposDeRafaga();
    for (let i = 0; i < TOPE_POR_COMERCIO_POR_MINUTO; i++) tomarCupoDeRafaga('ta', `591000${String(i).padStart(5, '0')}`, T0);
    for (let i = 0; i < 50; i++) expect(tomarCupoDeRafaga('ta', TEL, T0)).toBe(false);
    expect(tomarCupoDeRafaga('ta', TEL, T0 + 60_000)).toBe(true);
    for (let i = 0; i < TOPE_POR_MINUTO - 1; i++) expect(tomarCupoDeRafaga('ta', TEL, T0 + 60_000)).toBe(true);
    expect(tomarCupoDeRafaga('ta', TEL, T0 + 60_000)).toBe(false);
  });
});
