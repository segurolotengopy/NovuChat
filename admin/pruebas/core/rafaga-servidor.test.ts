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
  fragmentosDeRafaga, leerRafaga, validarRafaga, MAX_LECTURAS, VENTANA_MS, acotarRafaga, type MensajeCrudo,
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
  it('mira como mucho 6 documentos, los más nuevos, en orden cronológico', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ent(`id${19 - i}`, `t${19 - i}`, T0 + (19 - i) * 1000));
    const f = fragmentosDeRafaga(docs);
    expect(f).toHaveLength(MAX_LECTURAS);
    expect(f.map((x) => x.texto)).toEqual(['t14', 't15', 't16', 't17', 't18', 't19']);
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

describe('leerRafaga: una sola consulta, acotada', () => {
  it('consulta la conversación del tenant dado, ts descendente, límite 6, sin escribir', async () => {
    const llamadas: unknown[][] = [];
    const consulta = {
      orderBy(...a: unknown[]) { llamadas.push(['orderBy', ...a]); return consulta; },
      limit(...a: unknown[]) { llamadas.push(['limit', ...a]); return consulta; },
      async get() { llamadas.push(['get']); return { docs: [{ data: () => ent('a', 'uno', T0) }] }; },
    };
    const falsa = { collection(p: string) { llamadas.push(['collection', p]); return consulta; } } as unknown as Firestore;
    const r = await leerRafaga(falsa, 'tenant-x', TEL, 'a', T0 + 1000);
    expect(llamadas).toEqual([
      ['collection', `tenants/tenant-x/conversaciones/wa_${TEL}/mensajes`],
      ['orderBy', 'ts', 'desc'], ['limit', MAX_LECTURAS], ['get'],
    ]);
    expect(MAX_LECTURAS).toBe(6);
    expect(r).toEqual({ v: 1, fragmentos: [{ idMeta: 'a', tipo: 'text', texto: 'uno', ms: T0 }] });
  });
});

describe('acotarRafaga: lo que no se devuelve', () => {
  const lista = [
    { idMeta: 'a', tipo: 'text', texto: 'uno', ms: T0 }, { idMeta: '', tipo: 'saliente', texto: '', ms: T0 + 1000 },
    { idMeta: 'b', tipo: 'text', texto: 'dos', ms: T0 + 2000 },
  ];
  it('sin un entrante con el idMeta pedido, no devuelve nada (teléfono ajeno sin wamid reciente)', () => {
    expect(acotarRafaga(lista, 'wamid.AJENO', T0 + 3000)).toEqual([]);
    expect(acotarRafaga(lista, '', T0 + 3000)).toEqual([]);
  });
  it('una marca de saliente nunca prueba conocer el wamid', () => {
    expect(acotarRafaga(lista, '', T0)).toEqual([]);
  });
  it('con el idMeta propio, devuelve todo lo reciente', () => {
    expect(acotarRafaga(lista, 'b', T0 + 3000)).toEqual(lista);
  });
  it('descarta lo anterior a ahora - 30 s, y deja lo justo en el borde', () => {
    const f = acotarRafaga(lista, 'b', T0 + 2000 + VENTANA_MS);
    expect(f.map((x) => x.idMeta)).toEqual(['b']);
    expect(acotarRafaga(lista, 'b', T0 + VENTANA_MS)).toHaveLength(3);
  });
  it('si lo propio ya es viejo, lista vacía', () => {
    expect(acotarRafaga(lista, 'b', T0 + 2000 + VENTANA_MS + 1)).toEqual([]);
  });
  it('leerRafaga lo aplica: wamid ajeno -> []', async () => {
    const consulta = {
      orderBy() { return consulta; }, limit() { return consulta; },
      async get() { return { docs: [{ data: () => ent('a', 'SECRETO', T0) }] }; },
    };
    const falsa = { collection() { return consulta; } } as unknown as Firestore;
    expect(await leerRafaga(falsa, 't', TEL, 'wamid.otro', T0 + 1000)).toEqual({ v: 1, fragmentos: [] });
  });
});
