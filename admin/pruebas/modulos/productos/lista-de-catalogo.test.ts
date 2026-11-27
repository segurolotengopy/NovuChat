/**
 * Lista de catálogo (`Flujos/src/modulos/productos/lista-de-catalogo.js`, prefijo `lc`): pieza común y pura.
 * Pruebas NEGADAS: límites de Meta (10 filas, título 24, descripción 72, id 200), ids obsoletos o inventados,
 * precio solo del catálogo, líneas enteras en el texto.
 */
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';

type Vendible = {
  id: string; nombre: string; area?: string; precio?: number; precioCentavos?: number; moneda?: string; disponible?: boolean;
};
type Fila = { id: string; title: string; description: string };
type Lc = {
  lcSlug: (t: string) => string;
  lcCategorias: (v: Vendible[]) => { id: string; nombre: string; n: number }[];
  lcFilasCategorias: (c: unknown[], p?: number) => { filas: Fila[]; hayMas: boolean; pag: number };
  lcFilasProductos: (v: Vendible[], c: string, p: number, m: (c: number) => string) => { filas: Fila[]; hayMas: boolean; total: number; pag: number };
  lcResolverId: (id: unknown, v: Vendible[]) => { tipo: string; id?: string; cat?: string; nombre?: string; pag?: number };
  lcTextoLista: (i: Vendible[], m: (c: number) => string, o?: { limite?: number }) => { texto: string; mostrados: number; total: number; completo: boolean };
  lcBloquesPorCategoria: (v: Vendible[], ids: string[], m: (c: number) => string, l?: number) => {
    texto: string; categorias: { cat: string; nombre: string; mostrados: number; total: number }[]; mostrados: number; total: number; completo: boolean;
  };
};

const lc = cargarFuente<Lc>(['Flujos/src/modulos/productos/lista-de-catalogo.js'], [
  'lcSlug', 'lcCategorias', 'lcFilasCategorias', 'lcFilasProductos', 'lcResolverId', 'lcTextoLista', 'lcBloquesPorCategoria',
]);
const monto = (c: number) => 'Bs ' + (c / 100).toLocaleString('de-DE', { maximumFractionDigits: 0 });
const PATRON = /^[a-z0-9:_-]{1,200}$/;

const AREAS = ['Televisores · LED', 'Audio · Parlantes', 'Cocina', 'Hogar · Sala'];
const catalogo = (n: number, largo = false): Vendible[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `P${i}-X`,
    nombre: (largo ? 'Televisor inteligente ultra delgado con pantalla curva ' : 'Producto ') + i,
    area: AREAS[i % 4],
    precio: 100 + i,
    precioCentavos: (100 + i) * 100,
    moneda: 'BOB',
  }));

describe('lcSlug', () => {
  it('minúsculas, sin tildes, separado por guion y de 40 como máximo', () => {
    expect(lc.lcSlug('  Cámaras & Fotografía  ')).toBe('camaras-fotografia');
    expect(lc.lcSlug('Ñandú')).toBe('nandu');
    const largo = lc.lcSlug('a'.repeat(30) + ' ' + 'b'.repeat(30));
    expect(largo.length).toBeLessThanOrEqual(40);
    expect(largo).toMatch(/^[a-z0-9-]*$/);
    expect(largo.endsWith('-')).toBe(false);
  });
});

describe('categorías', () => {
  it('orden de primera aparición, segmento antes de « · », «Otros» sin área', () => {
    const v: Vendible[] = [
      { id: 'a', nombre: 'A', area: 'Audio · Parlantes', precioCentavos: 100 },
      { id: 'b', nombre: 'B', precioCentavos: 100 },
      { id: 'c', nombre: 'C', area: 'Audio · Auriculares', precioCentavos: 100 },
    ];
    expect(lc.lcCategorias(v)).toEqual([
      { id: 'cat:audio', nombre: 'Audio', n: 2 },
      { id: 'cat:otros', nombre: 'Otros', n: 1 },
    ]);
  });

  it('con 25 productos y 4 categorías ninguna lista pasa de 10 filas y todo «mas:» resuelve a una página existente', () => {
    const v = catalogo(25);
    const cats = lc.lcCategorias(v);
    expect(cats).toHaveLength(4);
    const c = lc.lcFilasCategorias(cats, 0);
    expect(c.filas.length).toBeLessThanOrEqual(10);
    expect(c.hayMas).toBe(false);
    for (const cat of cats) {
      let pag = 0;
      let vistos = 0;
      for (let guarda = 0; guarda < 10; guarda++) {
        const r = lc.lcFilasProductos(v, cat.id, pag, monto);
        expect(r.filas.length).toBeLessThanOrEqual(10);
        vistos += r.filas.filter((f) => f.id.startsWith('pro:')).length;
        const mas = r.filas.find((f) => f.id.startsWith('mas:'));
        expect(Boolean(mas)).toBe(r.hayMas);
        if (!mas) break;
        const res = lc.lcResolverId(mas.id, v);
        expect(res.tipo).toBe('mas');
        pag = res.pag as number;
      }
      expect(vistos).toBe(cat.n);
    }
  });

  it('muchas categorías: 9 + «Ver más», todas alcanzables y sin repetir', () => {
    const v: Vendible[] = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, nombre: `P${i}`, area: `Cat ${i}`, precioCentavos: 100 }));
    const cats = lc.lcCategorias(v);
    const vistos: string[] = [];
    let pag = 0;
    for (let g = 0; g < 10; g++) {
      const r = lc.lcFilasCategorias(cats, pag);
      expect(r.filas.length).toBeLessThanOrEqual(10);
      vistos.push(...r.filas.filter((f) => f.id.startsWith('cat:')).map((f) => f.id));
      const mas = r.filas.find((f) => f.id.startsWith('mas:'));
      if (!mas) break;
      const res = lc.lcResolverId(mas.id, v);
      expect(res.tipo).toBe('mas');
      expect(res.cat).toBe('cats');
      pag = res.pag as number;
    }
    expect(vistos).toEqual(cats.map((c) => c.id));
  });

  it('descripción «N productos» y singular «1 producto»', () => {
    const v: Vendible[] = [
      { id: 'a', nombre: 'A', area: 'Uno', precioCentavos: 100 },
      { id: 'b', nombre: 'B', area: 'Dos', precioCentavos: 100 },
      { id: 'c', nombre: 'C', area: 'Dos', precioCentavos: 100 },
    ];
    const f = lc.lcFilasCategorias(lc.lcCategorias(v), 0).filas;
    expect(f.map((x) => x.description)).toEqual(['1 producto', '2 productos']);
  });

  it('el título de una categoría larga no pasa de 24 y se corta por palabra', () => {
    const v: Vendible[] = [{ id: 'a', nombre: 'A', area: 'Electrodomésticos grandes para el hogar moderno', precioCentavos: 100 }];
    const t = lc.lcFilasCategorias(lc.lcCategorias(v), 0).filas[0].title;
    expect(t.length).toBeLessThanOrEqual(24);
    expect(t).toBe('Electrodomésticos…');
  });
});

describe('filas de productos', () => {
  it('una categoría con exactamente 10 productos va completa, sin «Ver más»', () => {
    const v: Vendible[] = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, nombre: `P${i}`, area: 'Uno', precioCentavos: 100 }));
    const r = lc.lcFilasProductos(v, 'cat:uno', 0, monto);
    expect(r.filas).toHaveLength(10);
    expect(r.hayMas).toBe(false);
    expect(r.filas.some((f) => f.id.startsWith('mas:'))).toBe(false);
    expect(r.total).toBe(10);
    // Con 11 sí hay «Ver más» y la segunda página tiene lo que falta.
    const v11 = v.concat([{ id: 'p10', nombre: 'P10', area: 'Uno', precioCentavos: 100 }]);
    const a = lc.lcFilasProductos(v11, 'cat:uno', 0, monto);
    expect(a.filas).toHaveLength(10);
    expect(a.hayMas).toBe(true);
    expect(a.filas[9].id).toBe('mas:uno:1');
    const b = lc.lcFilasProductos(v11, 'cat:uno', 1, monto);
    expect(b.filas.map((f) => f.id)).toEqual(['pro:p9', 'pro:p10']);
    expect(b.hayMas).toBe(false);
  });

  it('título ≤24, descripción ≤72 e id ≤200 con nombres de 150 caracteres', () => {
    const v: Vendible[] = Array.from({ length: 15 }, (_, i) => ({
      id: `p${i}`, nombre: ('Palabra' + i + ' ').repeat(20).trim().slice(0, 150), area: 'Uno', precioCentavos: 765500 + i,
    }));
    let pag = 0;
    for (let g = 0; g < 5; g++) {
      const r = lc.lcFilasProductos(v, 'cat:uno', pag, monto);
      for (const f of r.filas) {
        expect(f.title.length).toBeLessThanOrEqual(24);
        expect(f.description.length).toBeLessThanOrEqual(72);
        expect(f.id.length).toBeLessThanOrEqual(200);
        expect(f.id).toMatch(PATRON);
      }
      if (!r.hayMas) break;
      pag++;
    }
  });

  it('el precio de la fila sale del catálogo (precioCentavos), no de «precio»', () => {
    const v: Vendible[] = [{ id: 'a', nombre: 'Radio', area: 'Uno', precio: 1, precioCentavos: 765500 }];
    const f = lc.lcFilasProductos(v, 'cat:uno', 0, monto).filas[0];
    expect(f.description).toBe('Bs 7.655');
    expect(f.title).toBe('Radio');
  });

  it('la descripción lleva el resto del nombre cuando el título lo cortó', () => {
    const v: Vendible[] = [{ id: 'a', nombre: 'Televisor inteligente ultra delgado 55 pulgadas', area: 'Uno', precioCentavos: 765500 }];
    const f = lc.lcFilasProductos(v, 'cat:uno', 0, monto).filas[0];
    expect(f.title).toBe('Televisor inteligente…');
    expect(f.description).toBe('Bs 7.655 · ultra delgado 55 pulgadas');
  });

  it('un producto sin precio o con disponible:false nunca aparece', () => {
    const v: Vendible[] = [
      { id: 'ok', nombre: 'Bueno', area: 'Uno', precioCentavos: 100 },
      { id: 'sp', nombre: 'Sin precio', area: 'Uno' },
      { id: 'cero', nombre: 'Cero', area: 'Uno', precioCentavos: 0 },
      { id: 'dec', nombre: 'Decimal', area: 'Uno', precioCentavos: 10.5 },
      { id: 'neg', nombre: 'Negativo', area: 'Uno', precioCentavos: -5 },
      { id: 'str', nombre: 'Texto', area: 'Uno', precioCentavos: '100' as unknown as number },
      { id: 'agotado', nombre: 'Agotado', area: 'Uno', precioCentavos: 100, disponible: false },
    ];
    expect(lc.lcFilasProductos(v, 'cat:uno', 0, monto).filas.map((f) => f.id)).toEqual(['pro:ok']);
    expect(lc.lcCategorias(v)[0].n).toBe(1);
    expect(lc.lcTextoLista(v, monto).texto).toBe('• Bueno — Bs 1');
    expect(lc.lcBloquesPorCategoria(v, ['cat:uno'], monto).texto).not.toMatch(/Sin precio|Cero|Agotado|Decimal|Negativo|Texto/);
    for (const id of ['sp', 'cero', 'dec', 'neg', 'str', 'agotado']) {
      expect(lc.lcResolverId('pro:' + id, v).tipo).toBe('obsoleto');
    }
    expect(lc.lcResolverId('pro:ok', v)).toEqual({ tipo: 'pro', id: 'ok' });
  });

  it('una categoría inexistente no inventa filas', () => {
    expect(lc.lcFilasProductos(catalogo(5), 'cat:no-existe', 0, monto)).toEqual({ filas: [], hayMas: false, total: 0, pag: 0 });
  });

  it('un id que no puede viajar como id de fila no se muestra', () => {
    const v: Vendible[] = [
      { id: 'con espacio', nombre: 'Raro', area: 'Uno', precioCentavos: 100 },
      { id: 'x'.repeat(250), nombre: 'Larguísimo', area: 'Uno', precioCentavos: 100 },
      { id: 'ok', nombre: 'Bueno', area: 'Uno', precioCentavos: 100 },
    ];
    expect(lc.lcFilasProductos(v, 'cat:uno', 0, monto).filas.map((f) => f.id)).toEqual(['pro:ok']);
  });
});

describe('lcResolverId', () => {
  const v = catalogo(25);

  it('resuelve categoría, producto (id real con mayúsculas) y «Ver más» válidos', () => {
    expect(lc.lcResolverId('cat:televisores', v)).toEqual({ tipo: 'cat', cat: 'televisores', nombre: 'Televisores' });
    // Id de NovuTienda con mayúsculas: la fila lo lleva en minúsculas y se mapea al real.
    expect(lc.lcResolverId('pro:p0-x', v)).toEqual({ tipo: 'pro', id: 'P0-X' });
    // 25 productos en una sola categoría: 3 páginas (0, 1 y 2).
    const una = catalogo(25).map((x) => ({ ...x, area: 'Todo' }));
    expect(lc.lcResolverId('mas:todo:1', una)).toEqual({ tipo: 'mas', cat: 'todo', pag: 1 });
    expect(lc.lcResolverId('mas:todo:2', una)).toEqual({ tipo: 'mas', cat: 'todo', pag: 2 });
    expect(lc.lcResolverId('mas:todo:3', una)).toEqual({ tipo: 'obsoleto' });
  });

  it('lo obsoleto, inventado, con mayúsculas, mal formado o con página fuera de rango da «obsoleto»', () => {
    const malos: unknown[] = [
      'cat:inventada', 'cat:Televisores', 'cat:', 'pro:', 'pro:P0-X', 'pro:inventado', 'pro:p0-x ', 'PRO:p0-x',
      'mas:televisores:0', 'mas:televisores:99', 'mas:televisores:-1', 'mas:televisores:01', 'mas:televisores:1.5',
      'mas:televisores', 'mas:televisores:1:2', 'mas:inventada:1', 'mas:cats:1', 'mas:cats:0',
      'mas:hogar:1', // 6 productos: cabe en una sola lista, no hay página 1
      'zzz:1', '', 'x'.repeat(201), 'pro:' + 'a'.repeat(300), 'cat:a b', 'cat:ñ',
      undefined, null, 5, {}, [],
    ];
    for (const m of malos) expect(lc.lcResolverId(m, v), String(m)).toEqual({ tipo: 'obsoleto' });
  });

  it('con un catálogo vacío todo es obsoleto', () => {
    expect(lc.lcResolverId('cat:televisores', [])).toEqual({ tipo: 'obsoleto' });
    expect(lc.lcResolverId('pro:p0-x', [])).toEqual({ tipo: 'obsoleto' });
  });

  it('un producto que dejó de estar disponible hoy es obsoleto aunque la fila viejas siga en el chat', () => {
    const hoy = v.map((x) => (x.id === 'P0-X' ? { ...x, disponible: false } : x));
    expect(lc.lcResolverId('pro:p0-x', hoy)).toEqual({ tipo: 'obsoleto' });
  });

  it('ningún id generado viola el patrón ni pasa de 200 caracteres, y una categoría «cats» no choca con «mas:cats»', () => {
    const raro: Vendible[] = [
      ...catalogo(25),
      { id: 'c1', nombre: 'Uno', area: 'Cats', precioCentavos: 100 },
      { id: 'c2', nombre: 'Dos', area: 'Ñ ñ ¡!', precioCentavos: 100 },
    ];
    const cats = lc.lcCategorias(raro);
    const ids = [...cats.map((c) => c.id), ...lc.lcFilasCategorias(cats, 0).filas.map((f) => f.id)];
    for (const c of cats) {
      for (let p = 0; p < 4; p++) ids.push(...lc.lcFilasProductos(raro, c.id, p, monto).filas.map((f) => f.id));
    }
    for (const id of ids) {
      expect(id).toMatch(PATRON);
      expect(id.length).toBeLessThanOrEqual(200);
    }
    const catsCats = cats.find((c) => c.nombre === 'Cats');
    expect(catsCats && catsCats.id).not.toBe('cat:cats');
    expect(lc.lcResolverId(catsCats!.id, raro).tipo).toBe('cat');
  });
});

describe('lcTextoLista', () => {
  it('una línea por producto con «• Nombre — Bs X», el precio del catálogo', () => {
    const v: Vendible[] = [
      { id: 'a', nombre: 'Radio\nportátil', precio: 9, precioCentavos: 765500 },
      { id: 'b', nombre: 'Cable', precioCentavos: 1500 },
    ];
    const r = lc.lcTextoLista(v, monto);
    expect(r).toEqual({ texto: '• Radio portátil — Bs 7.655\n• Cable — Bs 15', mostrados: 2, total: 2, completo: true });
  });

  it('con 23 productos de nombre largo no pasa del límite y nunca corta a media línea', () => {
    const v = catalogo(23, true);
    for (const limite of [200, 500, 1000, 3500]) {
      const r = lc.lcTextoLista(v, monto, { limite });
      expect(r.texto.length).toBeLessThanOrEqual(limite);
      expect(r.total).toBe(23);
      const lineas = r.texto ? r.texto.split('\n') : [];
      expect(lineas).toHaveLength(r.mostrados);
      for (const l of lineas) expect(l).toMatch(/^• Televisor inteligente ultra delgado con pantalla curva \d+ — Bs [\d.]+$/);
      expect(r.completo).toBe(r.mostrados === 23);
    }
    const corto = lc.lcTextoLista(v, monto, { limite: 300 });
    expect(corto.completo).toBe(false);
    expect(corto.mostrados).toBeGreaterThan(0);
    // Lo que se muestra es un prefijo exacto del catálogo, en orden.
    expect(corto.texto.split('\n')[0]).toContain('curva 0 ');
  });

  it('el límite por omisión es 3500 y un solo nombre que no cabe no se corta', () => {
    const v: Vendible[] = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, nombre: 'Producto ' + i, precioCentavos: 100 }));
    const r = lc.lcTextoLista(v, monto);
    expect(r.texto.length).toBeLessThanOrEqual(3500);
    expect(r.completo).toBe(false);
    const solo = lc.lcTextoLista([{ id: 'a', nombre: 'x'.repeat(100), precioCentavos: 100 }], monto, { limite: 20 });
    expect(solo).toEqual({ texto: '', mostrados: 0, total: 1, completo: false });
  });

  it('sin productos devuelve texto vacío y completo', () => {
    expect(lc.lcTextoLista([], monto)).toEqual({ texto: '', mostrados: 0, total: 0, completo: true });
  });
});

describe('lcBloquesPorCategoria', () => {
  it('un bloque por categoría, en negrita de WhatsApp, separados por una línea en blanco', () => {
    const v = catalogo(8);
    const r = lc.lcBloquesPorCategoria(v, ['cat:televisores', 'cat:audio'], monto, 3500);
    const bloques = r.texto.split('\n\n');
    expect(bloques).toHaveLength(2);
    expect(bloques[0].split('\n')[0]).toBe('*Televisores* (2)');
    expect(bloques[1].split('\n')[0]).toBe('*Audio* (2)');
    expect(bloques[0].split('\n').slice(1)).toEqual(['• Producto 0 — Bs 100', '• Producto 4 — Bs 104']);
    expect(r.categorias).toEqual([
      { cat: 'televisores', nombre: 'Televisores', mostrados: 2, total: 2 },
      { cat: 'audio', nombre: 'Audio', mostrados: 2, total: 2 },
    ]);
    expect(r.completo).toBe(true);
  });

  it('con límite chico corta por producto entero, con conteo exacto y sin pasar del límite', () => {
    const v = catalogo(23, true);
    for (const limite of [150, 400, 900, 2000]) {
      const r = lc.lcBloquesPorCategoria(v, ['cat:televisores', 'cat:audio', 'cat:cocina', 'cat:hogar'], monto, limite);
      expect(r.texto.length).toBeLessThanOrEqual(limite);
      const lineas = r.texto.split('\n').filter((l) => l.startsWith('• '));
      for (const l of lineas) expect(l).toMatch(/^• Televisor inteligente ultra delgado con pantalla curva \d+ — Bs [\d.]+$/);
      expect(lineas).toHaveLength(r.mostrados);
      expect(r.categorias.reduce((s, c) => s + c.mostrados, 0)).toBe(r.mostrados);
      expect(r.categorias.reduce((s, c) => s + c.total, 0)).toBe(23);
      expect(r.completo).toBe(r.mostrados === 23);
      // El encabezado de cada categoría mostrada dice exactamente cuántos de cuántos.
      for (const c of r.categorias.filter((x) => x.mostrados > 0)) {
        const esperado = c.mostrados === c.total ? `*${c.nombre}* (${c.total})` : `*${c.nombre}* (${c.mostrados} de ${c.total})`;
        expect(r.texto).toContain(esperado);
      }
    }
  });

  it('ignora categorías que no existen y no repite las pedidas dos veces', () => {
    const r = lc.lcBloquesPorCategoria(catalogo(8), ['cat:inventada', 'cat:audio', 'audio'], monto);
    expect(r.categorias.map((c) => c.cat)).toEqual(['audio']);
    expect(r.texto.match(/\*Audio\*/g)).toHaveLength(1);
  });
});
