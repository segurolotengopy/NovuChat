/**
 * CARRITO COMÚN CON MONEDA (`Flujos/experimental/venta-digital/src/carrito.js`, bloque B1 del flujo de un comercio con ventas en BOB y ARS).
 *
 * Se prueba NEGANDO: nunca se mezclan monedas, una cifra nunca se escribe sin moneda conocida, el stock no se supera, lo no disponible no se ofrece, y sin los campos nuevos el resultado es idéntico al de siempre (Walisuma no cambia).
 * Catálogos mínimos escritos aquí; ninguno es de un negocio.
 */
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from './core/fuente-vm';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, '../../Flujos/experimental/venta-digital/src/carrito.js');
const EXPORTADOS = ['vcIndice', 'vcVendibles', 'vcLineas', 'vcMonto', 'vcResumen', 'vcTotalCentavos', 'vcLineaAviso', 'vcMismoCarrito'];
const VC = cargarFuente<Record<string, any>>([ARCHIVO], EXPORTADOS); // eslint-disable-line @typescript-eslint/no-explicit-any
type F = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const vc = (n: string): F => VC[n] as F;
const ids = (xs: { id: string }[]): string[] => xs.map((x) => x.id);

const FOTO = 'https://fotos.ejemplo.test/a.jpg';
const item = (o: Record<string, unknown>) => ({ id: 'p1', nombre: 'Pieza', precio: 1590, moneda: 'ARS', activo: true, ...o });

describe('vcVendibles con moneda ARS', () => {
  it('ARS: vende solo ítems en ARS y conserva centavos, moneda, stock y foto', () => {
    const v = vc('vcVendibles')([item({ precioCentavos: 159000, stock: 5, disponible: true, foto: FOTO })], { moneda: 'ARS', externa: true });
    expect(v).toEqual([{ id: 'p1', nombre: 'Pieza', precioCentavos: 159000, area: '', descripcion: '', moneda: 'ARS', stock: 5, foto: FOTO }]);
  });
  it('NEGADO: con moneda ARS, un ítem en BOB, en USD o sin moneda no se vende (nunca se mezclan monedas)', () => {
    for (const moneda of ['BOB', 'USD', undefined, null]) {
      expect(vc('vcVendibles')([item({ moneda })], { moneda: 'ARS', externa: true })).toEqual([]);
    }
  });
  it('NEGADO: con moneda BOB (explícita o por defecto), un ítem en ARS no se vende', () => {
    expect(vc('vcVendibles')([item({})])).toEqual([]);
    expect(vc('vcVendibles')([item({})], { moneda: 'BOB' })).toEqual([]);
  });
  it('NEGADO: una moneda de venta declarada y desconocida (error de tipeo) no vende nada: falla cerrado', () => {
    for (const moneda of ['USD', 'ars', 'bob', '', null, 7]) {
      expect(vc('vcVendibles')([item({}), item({ id: 'b', moneda: undefined })], { moneda })).toEqual([]);
    }
  });
  it('precio de ARS en múltiplos de 100: 20000 → 2.000.000 centavos', () => {
    expect(vc('vcVendibles')([item({ precio: 20000 })], { moneda: 'ARS', externa: true })[0].precioCentavos).toBe(2000000);
  });
});

describe('vcVendibles con los campos de una fuente externa', () => {
  const vend = (o: Record<string, unknown>) => vc('vcVendibles')([item(o)], { moneda: 'ARS', externa: true });
  it('NEGADO: `disponible: false` no se ofrece, aunque tenga stock', () => {
    expect(vend({ disponible: false, stock: 3 })).toEqual([]);
  });
  it('`disponible: true` con `stock: null` (no controla stock) se ofrece sin tope', () => {
    const v = vend({ disponible: true, stock: null });
    expect(ids(v)).toEqual(['p1']);
    expect(v[0].stock).toBeNull();
  });
  it('NEGADO: stock 0, negativo, decimal o de texto no se vende', () => {
    for (const stock of [0, -1, 1.5, '3', Number.NaN, Infinity]) expect(vend({ stock })).toEqual([]);
  });
  it('NEGADO: `precioCentavos` que no es precio × 100 deja el ítem fuera (dos precios son ambiguos)', () => {
    expect(vend({ precioCentavos: 1590 })).toEqual([]);
    expect(ids(vend({ precioCentavos: 159000 }))).toEqual(['p1']);
  });
  it('la foto solo pasa si es https con nombre de dominio; si no, se omite y el producto sigue', () => {
    const malas = ['http://x.test/a.jpg', 'javascript:alert(1)', 'ftp://x.test/a', '', 42, 'https://con espacio/a.jpg',
      'https://169.254.169.254/latest', 'https://127.0.0.1/x', 'https://10.0.0.1:8080/a', 'https://localhost/a', 'https://u' + String.fromCharCode(64) + 'e.test/x',
      'https://e.test/\u202Egpj.exe', 'https://e.test/"><x', 'https://e.test/a\\b', 'https://servicio.internal/a', 'https://' + 'a'.repeat(600) + '.test/x', 'https://sinpunto/a'];
    for (const foto of malas) {
      const v = vend({ foto });
      expect(ids(v)).toEqual(['p1']);
      expect('foto' in v[0]).toBe(false);
    }
  });
  it('NEGADO: ids repetidos o mal formados siguen sin venderse', () => {
    expect(vc('vcVendibles')([item({}), item({})], { moneda: 'ARS', externa: true })).toEqual([]);
    for (const id of ['a/b', '..', '', ' x']) expect(vend({ id })).toEqual([]);
  });
  it('recorta a `max` también en ARS y no lanza con entradas raras', () => {
    const muchos = Array.from({ length: 300 }, (_, i) => item({ id: 'i' + i, nombre: 'n' + i }));
    expect(vc('vcVendibles')(muchos, { moneda: 'ARS', externa: true })).toHaveLength(200);
    expect(vc('vcVendibles')(null, { moneda: 'ARS', externa: true })).toEqual([]);
    expect(vc('vcVendibles')([null, 5, 'x', []], { moneda: 'ARS', externa: true })).toEqual([]);
  });
});

describe('vcLineas con stock', () => {
  const vendibles = vc('vcVendibles')([item({ stock: 2 }), item({ id: 'p2', nombre: 'Libre', stock: null })], { moneda: 'ARS', externa: true });
  it('NEGADO: pedir más que el stock no agrega de más; se conserva lo que cabe y se avisa con motivo `stock`', () => {
    const r = vc('vcLineas')([{ id: 'p1', cantidad: 3 }], vendibles);
    expect(r.lineas[0].cantidad).toBe(2);
    expect(r.descartadas).toEqual([{ id: 'p1', motivo: 'stock' }]);
  });
  it('NEGADO: el tope de stock es por producto, también sumando líneas con distinto detalle', () => {
    const r = vc('vcLineas')([{ id: 'p1', cantidad: 2, detalle: 'azul' }, { id: 'p1', cantidad: 1, detalle: 'rojo' }], vendibles);
    expect(r.lineas.reduce((s: number, l: { cantidad: number }) => s + l.cantidad, 0)).toBe(2);
    expect(r.descartadas.map((d: { motivo: string }) => d.motivo)).toEqual(['stock']);
  });
  it('sin stock controlado (null) rige el tope de siempre, con motivo `tope`', () => {
    const r = vc('vcLineas')([{ id: 'p2', cantidad: 60 }], vendibles);
    expect(r.lineas[0].cantidad).toBe(50);
    expect(r.descartadas).toEqual([{ id: 'p2', motivo: 'tope' }]);
  });
  it('un modelo que manda precio o total no cambia nada: salen del catálogo', () => {
    const r = vc('vcLineas')([{ id: 'p1', cantidad: 1, precio: 1, total: 1, subtotalCentavos: 1 }], vendibles);
    expect(r.lineas[0].precioCentavos).toBe(159000);
    expect(vc('vcTotalCentavos')(r.lineas)).toBe(159000);
  });
});

describe('vcMonto y vcResumen con moneda', () => {
  it('ARS: «ARS 1.590» y «ARS 1.234.567,50»; BOB sin cambios', () => {
    expect(vc('vcMonto')(159000, 'ARS')).toBe('ARS 1.590');
    expect(vc('vcMonto')(123456750, 'ARS')).toBe('ARS 1.234.567,50');
    expect(vc('vcMonto')(1250)).toBe('Bs 12,50');
    expect(vc('vcMonto')(1250, 'BOB')).toBe('Bs 12,50');
    expect(vc('vcMonto')(1250, null)).toBe('Bs 12,50');
  });
  it('NEGADO: una moneda desconocida o un monto no entero devuelven vacío (nunca una cifra sin moneda)', () => {
    for (const m of ['USD', 'ars', 'bs', '', 7]) expect(vc('vcMonto')(1000, m)).toBe('');
    for (const c of [1.5, Number.NaN, null, '100']) expect(vc('vcMonto')(c, 'ARS')).toBe('');
  });
  const enArs = () => vc('vcLineas')([{ id: 'p1', cantidad: 2 }], vc('vcVendibles')([item({})], { moneda: 'ARS', externa: true })).lineas;
  it('vcResumen en ARS escribe subtotales y total en ARS, con o sin el argumento de moneda', () => {
    const lineas = enArs();
    expect(lineas[0].moneda).toBe('ARS');
    expect(vc('vcResumen')(lineas, 'ARS')).toBe('2 × Pieza — ARS 3.180\nTotal: ARS 3.180');
    expect(vc('vcResumen')(lineas)).toBe('2 × Pieza — ARS 3.180\nTotal: ARS 3.180');
    expect(vc('vcResumen')([], 'ARS')).toBe('');
  });
  it('NEGADO: un carrito en ARS nunca sale escrito en «Bs», aunque se olvide o se contradiga la moneda', () => {
    const lineas = enArs();
    expect(vc('vcResumen')(lineas)).not.toContain('Bs');
    expect(vc('vcResumen')(lineas, 'BOB')).toBe('');
  });
  it('NEGADO: un carrito con monedas mezcladas o con una línea sin moneda no escribe ninguna cifra', () => {
    const ars = enArs()[0];
    const bob = { ...ars, id: 'p2', moneda: 'BOB' };
    const sin = { ...ars, id: 'p3' }; delete (sin as Record<string, unknown>)['moneda'];
    expect(vc('vcResumen')([ars, bob])).toBe('');
    expect(vc('vcResumen')([ars, sin])).toBe('');
  });
  it('vcMismoCarrito distingue la moneda', () => {
    const ars = enArs();
    expect(vc('vcMismoCarrito')(ars, ars.map((l: Record<string, unknown>) => ({ ...l })))).toBe(true);
    expect(vc('vcMismoCarrito')(ars, ars.map((l: Record<string, unknown>) => ({ ...l, moneda: 'BOB' })))).toBe(false);
  });
});

describe('el detalle libre no puede traer una cifra de otra moneda ni un aviso de pago', () => {
  const con = (detalle: string) => vc('vcLineas')([{ id: 'p1', cantidad: 1, detalle }], vc('vcVendibles')([item({})], { moneda: 'ARS', externa: true })).lineas[0].detalle;
  it('NEGADO: «ARS 0 promo», «$ 100 c/u», «USD», «pesos» y «€» dejan el detalle vacío', () => {
    for (const d of ['ARS 0 promo', '$ 100 c/u', 'usd 5', '100 pesos', 'precio 3 dolares', '€ 2']) expect(con(d)).toBe('');
  });
  it('NEGADO: «cancelado», «abonado», «aprobado», «transferido» y «acreditó» también se descartan', () => {
    for (const d of ['ya cancelado', 'abonado', 'pago aprobado', 'transferido', 'acreditó']) expect(con(d)).toBe('');
  });
  it('un detalle legítimo se conserva', () => {
    expect(con('talle M, color azul')).toBe('talle M, color azul');
  });
});

describe('lo común no cambia por accidente', () => {
  it('NEGADO: sin `externa`, un catálogo con `stock`, `disponible` o `foto` (el de la consola) da la forma de siempre y no recorta nada', () => {
    const cat = [{ id: 'a1', nombre: 'A', precio: 10, activo: true, stock: 1, disponible: false, foto: 'https://x.test/a.jpg', precioCentavos: 5 }];
    expect(vc('vcVendibles')(cat)).toEqual([{ id: 'a1', nombre: 'A', precioCentavos: 1000, area: '', descripcion: '' }]);
    const r = vc('vcLineas')([{ id: 'a1', cantidad: 5 }], vc('vcVendibles')(cat));
    expect(r.lineas[0].cantidad).toBe(5);
  });
  it('NEGADO: `disponible` que no es exactamente true (false, "false", 0, "no") no se ofrece; `precioCentavos: null` cuenta como ausente', () => {
    const v = (o: Record<string, unknown>) => vc('vcVendibles')([item(o)], { moneda: 'ARS', externa: true });
    for (const d of [false, 'false', 0, 'no', null]) expect(v({ disponible: d })).toEqual([]);
    expect(ids(v({ disponible: true, precioCentavos: null }))).toEqual(['p1']);
  });
  it('NEGADO: el total de un carrito con monedas mezcladas es null; vcMismoCarrito y vcIndice respetan la moneda', () => {
    const l = vc('vcLineas')([{ id: 'p1', cantidad: 1 }], vc('vcVendibles')([item({})], { moneda: 'ARS' })).lineas;
    expect(vc('vcTotalCentavos')([...l, { ...l[0], id: 'x', moneda: 'BOB' }])).toBeNull();
    expect(vc('vcTotalCentavos')(l)).toBe(159000);
    const vend = vc('vcVendibles')([item({})], { moneda: 'ARS' });
    expect(vc('vcIndice')(vend)).toBe('p1|Pieza|1590 ARS');
    expect(vc('vcIndice')(vc('vcVendibles')([{ id: 'a', nombre: 'A', precio: 10, activo: true }]))).toBe('a|A|10');
  });
  it('stock igual al tope se trata como tope; stock mayor que el tope sale con motivo `tope`, no `stock`', () => {
    const mk = (stock: number) => vc('vcVendibles')([item({ stock })], { moneda: 'ARS', externa: true });
    expect(vc('vcLineas')([{ id: 'p1', cantidad: 60 }], mk(50)).descartadas).toEqual([{ id: 'p1', motivo: 'tope' }]);
    expect(vc('vcLineas')([{ id: 'p1', cantidad: 60 }], mk(100)).descartadas).toEqual([{ id: 'p1', motivo: 'tope' }]);
    expect(vc('vcLineas')([{ id: 'p1', cantidad: 1 }], [{ id: 'p1', nombre: 'x', precioCentavos: 100, stock: 0 }]).lineas).toEqual([]);
  });
});

describe('regresión: sin los campos nuevos el resultado es idéntico al de siempre (Walisuma)', () => {
  const catalogo = [
    { id: 'a1', nombre: 'Pieza A', descripcion: 'Fibra', area: 'Hogar', precio: 100, moneda: 'BOB', activo: true },
    { id: 'b2', nombre: 'Pieza B', descripcion: 'Lana', area: 'Hogar', precio: 12.5, activo: true },
    { id: 'usd', nombre: 'Dólares', precio: 10, moneda: 'USD', activo: true },
  ];
  it('el vendible no trae `moneda`, `stock` ni `foto` y la forma es la de antes', () => {
    expect(vc('vcVendibles')(catalogo)).toEqual([
      { id: 'a1', nombre: 'Pieza A', precioCentavos: 10000, area: 'Hogar', descripcion: 'Fibra' },
      { id: 'b2', nombre: 'Pieza B', precioCentavos: 1250, area: 'Hogar', descripcion: 'Lana' },
    ]);
  });
  it('vcMonto, vcResumen y vcLineaAviso siguen en bolivianos', () => {
    const { lineas } = vc('vcLineas')([{ id: 'a1', cantidad: 2 }], vc('vcVendibles')(catalogo));
    expect(vc('vcResumen')(lineas)).toBe('2 × Pieza A — Bs 200\nTotal: Bs 200');
    expect(vc('vcLineaAviso')(lineas)).toBe('2 × Pieza A');
    expect(vc('vcMonto')(77950)).toBe('Bs 779,50');
  });
});
