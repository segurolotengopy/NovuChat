/**
 * CARRITO COMÚN DE LAS VENTAS DIGITALES (`Flujos/experimental/venta-digital/src/carrito.js`, prefijo `vc`).
 *
 * Se prueba NEGANDO: lo que el modelo no debe lograr (fijar un precio, un total o un descuento; agregar un ítem que no se vende; pasar un enlace o invisibles en el detalle) no pasa.
 * La prueba vive aquí y no en `admin/pruebas/` porque la zona de escritura de esta sesión es `admin/pruebas/tenants/walisuma/`.
 * Carga el archivo con el mismo mecanismo que `venta-digital-base.test.ts` (`new Function` sobre el texto del archivo). Los catálogos son mínimos y escritos aquí; el real (`catalogo.json`) solo sirve para la prueba de humo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { idDeItem } from '../../../functions/src/modulos/productos/limiteCatalogo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, '../../../../Flujos/experimental/venta-digital/src/carrito.js');
const FUENTE = readFileSync(ARCHIVO, 'utf8');
const EXPORTADOS = ['vcVendibles', 'vcIndice', 'vcSeleccion', 'vcLineas', 'vcTotalCentavos', 'vcMonto', 'vcResumen', 'vcLineaAviso', 'vcMismoCarrito'];
// El código evaluado es el de un archivo del propio repositorio, no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
const VC = new Function(FUENTE + `\nreturn { ${EXPORTADOS.join(', ')} };`)() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type F = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const vc = (n: string): F => VC[n] as F;

// Catálogo de PRUEBA (no es de ningún negocio).
const CATALOGO = [
  { id: 'a1', nombre: 'Pieza A', descripcion: 'Hecha de fibra suave', area: 'Hogar · Mantas', precio: 100, moneda: 'BOB', activo: true },
  { id: 'b2', nombre: 'Pieza B', descripcion: 'De lana gruesa', area: 'Hogar · Cojines', precio: 12.5, activo: true },
  { id: 'c3', nombre: 'Pieza C', descripcion: 'Con detalle fino', area: 'Ropa · Chalecos', precio: 7795, moneda: 'BOB', activo: true },
  { id: 'apagado', nombre: 'Apagada', precio: 10, activo: false },
  { id: 'sinprecio', nombre: 'Sin precio', activo: true },
  { id: 'dolares', nombre: 'En dólares', precio: 10, moneda: 'USD', activo: true },
  { id: 'a/b', nombre: 'Con barra', precio: 10, activo: true },
  { id: '..', nombre: 'Con puntos', precio: 10, activo: true },
  { id: '', nombre: 'Vacío', precio: 10, activo: true },
  { id: 'cero', nombre: 'Gratis', precio: 0, activo: true },
  { id: 'negativo', nombre: 'Negativo', precio: -5, activo: true },
  { id: 'texto', nombre: 'Precio texto', precio: '10', activo: true },
  { id: 'inf', nombre: 'Infinito', precio: Infinity, activo: true },
  { id: 'activo-texto', nombre: 'Activo en texto', precio: 10, activo: 'true' },
];
const V = vc('vcVendibles')(CATALOGO) as { id: string; nombre: string; precioCentavos: number; area: string; descripcion: string }[];
const ids = (xs: { id: string }[]): string[] => xs.map((x) => x.id);

describe('vcVendibles: solo lo que se puede vender', () => {
  it('deja activos con precio válido, en BOB o sin moneda, con id de un solo segmento', () => {
    expect(ids(V)).toEqual(['a1', 'b2', 'c3']);
  });
  it('NEGADO: inactivo, sin precio, en USD, id con «/», «..» o vacío, precio 0, negativo, en texto o infinito no son vendibles', () => {
    for (const malo of ['apagado', 'sinprecio', 'dolares', 'a/b', '..', '', 'cero', 'negativo', 'texto', 'inf', 'activo-texto']) expect(ids(V)).not.toContain(malo);
  });
  it('convierte el precio a centavos enteros', () => {
    expect(V.map((v) => v.precioCentavos)).toEqual([10000, 1250, 779500]);
    expect(V.every((v) => Number.isInteger(v.precioCentavos))).toBe(true);
  });
  it('un precio que redondea a menos de un centavo no es vendible', () => {
    expect(vc('vcVendibles')([{ id: 'x', nombre: 'x', precio: 0.001, activo: true }])).toEqual([]);
  });
  it('recorta a `max` y no lanza con entradas raras', () => {
    const muchos = Array.from({ length: 300 }, (_, i) => ({ id: 'i' + i, nombre: 'n' + i, precio: 1, activo: true }));
    expect(vc('vcVendibles')(muchos)).toHaveLength(200);
    expect(vc('vcVendibles')(muchos, { max: 7 })).toHaveLength(7);
    for (const raro of [null, undefined, 'x', 5, {}, [null, 'x', 5, [], {}]]) expect(() => vc('vcVendibles')(raro)).not.toThrow();
    expect(vc('vcVendibles')('texto')).toEqual([]);
  });
});

describe('vcLineas: el modelo propone, el catálogo manda', () => {
  const L = (crudas: unknown, o?: unknown) => vc('vcLineas')(crudas, V, o) as { lineas: any[]; descartadas: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('un precio, total, subtotal o descuento mandado por el modelo se IGNORA: el subtotal sale del catálogo', () => {
    const r = L([{ id: 'a1', cantidad: 2, precio: 1, total: 1, subtotal: 1, descuento: 99, precioCentavos: 1, subtotalCentavos: 1, nombre: 'Gratis' }]);
    expect(r.lineas).toEqual([{ id: 'a1', nombre: 'Pieza A', cantidad: 2, precioCentavos: 10000, subtotalCentavos: 20000, detalle: '' }]);
    expect(vc('vcTotalCentavos')(r.lineas)).toBe(20000);
  });
  it('NEGADO: un id inexistente o no vendible se descarta como «desconocido»', () => {
    const r = L([{ id: 'nada', cantidad: 1 }, { id: 'apagado', cantidad: 1 }, { id: 'a/b', cantidad: 1 }, { id: '..', cantidad: 1 }, { id: '', cantidad: 1 }, { cantidad: 1 }, { id: 7, cantidad: 1 }]);
    expect(r.lineas).toEqual([]);
    expect(r.descartadas).toHaveLength(7);
    expect(r.descartadas.every((d) => d.motivo === 'desconocido')).toBe(true);
  });
  it('NEGADO: «constructor» y «__proto__» como id no abren nada', () => {
    const r = L([{ id: 'constructor', cantidad: 1 }, { id: '__proto__', cantidad: 1 }, { id: 'toString', cantidad: 1 }]);
    expect(r.lineas).toEqual([]);
  });
  it('NEGADO: cantidad 0, -1, 1.5, «abc», NaN, nula o ausente se descarta como «cantidad»', () => {
    for (const c of [0, -1, 1.5, 'abc', NaN, Infinity, null, undefined, [], {}]) {
      const r = L([{ id: 'a1', cantidad: c }]);
      expect(r.lineas, String(c)).toEqual([]);
      expect(r.descartadas, String(c)).toEqual([{ id: 'a1', motivo: 'cantidad' }]);
    }
  });
  it('una cantidad de 51 se recorta a 50', () => {
    expect(L([{ id: 'a1', cantidad: 51 }]).lineas[0].cantidad).toBe(50);
    expect(L([{ id: 'a1', cantidad: 9 }], { maxCantidad: 5 }).lineas[0].cantidad).toBe(5);
  });
  it('sumar el mismo ítem tampoco pasa de `maxCantidad`', () => {
    const r = L([{ id: 'a1', cantidad: 40 }, { id: 'a1', cantidad: 40 }]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].cantidad).toBe(50);
    expect(r.lineas[0].subtotalCentavos).toBe(50 * 10000);
  });
  it('más de 30 líneas: las primeras 30 quedan y el resto va a «exceso»', () => {
    const muchos = Array.from({ length: 40 }, (_, i) => ({ id: 'a1', cantidad: 1, detalle: 'v' + i }));
    const r = L(muchos);
    expect(r.lineas).toHaveLength(30);
    expect(r.descartadas).toHaveLength(10);
    expect(r.descartadas.every((d) => d.motivo === 'exceso')).toBe(true);
  });
  it('el mismo id con el mismo detalle se suma; con otro detalle son dos líneas', () => {
    const suma = L([{ id: 'a1', cantidad: 1, detalle: 'azul' }, { id: 'a1', cantidad: 2, detalle: 'azul' }]);
    expect(suma.lineas).toHaveLength(1);
    expect(suma.lineas[0].cantidad).toBe(3);
    expect(suma.lineas[0].subtotalCentavos).toBe(30000);
    const dos = L([{ id: 'a1', cantidad: 1, detalle: 'azul' }, { id: 'a1', cantidad: 1, detalle: 'rojo' }]);
    expect(dos.lineas).toHaveLength(2);
    const sinDetalle = L([{ id: 'a1', cantidad: 1 }, { id: 'a1', cantidad: 1, detalle: '   ' }]);
    expect(sinDetalle.lineas).toHaveLength(1);
  });
  it('NEGADO: el detalle no lleva enlaces, saltos de línea ni invisibles, y mide a lo más 120', () => {
    const sucio = 'rojo\nvisita https://malo.example/x o www.malo.example o wa.me/59100000 y ht​tp://otro.example‮\u0007 fin ' + 'z'.repeat(300);
    const d = L([{ id: 'a1', cantidad: 1, detalle: sucio }]).lineas[0].detalle as string;
    expect(d).not.toMatch(/\n|\r|\t/);
    expect(d).not.toMatch(/\p{Cf}|\p{Cc}/u);
    expect(d).not.toMatch(/https?:|www\.|wa\.me|malo\.example|otro\.example/i);
    expect(d.length).toBeLessThanOrEqual(120);
    expect(d.startsWith('rojo visita')).toBe(true);
    expect(L([{ id: 'a1', cantidad: 1, detalle: 'x'.repeat(500) }], { maxDetalle: 10 }).lineas[0].detalle).toHaveLength(10);
    expect(L([{ id: 'a1', cantidad: 1, detalle: { a: 1 } }]).lineas[0].detalle).toBe('');
  });
  it('entradas null, cadena, número o arreglo dentro de `crudas` no lanzan', () => {
    for (const crudas of [null, undefined, 'texto', 5, {}, [null, 'x', 5, [], {}, undefined, true, { id: null }, { id: {}, cantidad: {} }]]) {
      expect(() => L(crudas)).not.toThrow();
      expect(L(crudas).lineas).toEqual([]);
    }
    expect(() => vc('vcLineas')([{ id: 'a1', cantidad: 1 }], null)).not.toThrow();
    expect(vc('vcLineas')([{ id: 'a1', cantidad: 1 }], null).lineas).toEqual([]);
    expect(() => vc('vcLineas')([{ id: 'a1', cantidad: 1 }], [null, 'x', { id: 'a1', precioCentavos: 1 }])).not.toThrow();
  });
  it('un vendible con precio inválido que alguien le pase tampoco entra', () => {
    const r = vc('vcLineas')([{ id: 'x', cantidad: 1 }], [{ id: 'x', nombre: 'x', precioCentavos: 1.5 }]);
    expect(r.lineas).toEqual([]);
  });
});

describe('arreglos de la revisión', () => {
  const L = (crudas: unknown, o?: unknown, v: unknown = V) => vc('vcLineas')(crudas, v, o) as { lineas: any[]; descartadas: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const det = (d: unknown) => L([{ id: 'a1', cantidad: 1, detalle: d }]).lineas[0].detalle as string;

  it('B1 NEGADO: un enlace pegado a una palabra, sin esquema o en ancho completo no sobrevive en el detalle', () => {
    expect(det('rojohttps://malo.example/x')).not.toMatch(/https?:|malo|example/i);
    expect(det('rojohttps://malo.example/x')).toBe('rojo');
    expect(det('visita malo.shop ya')).not.toMatch(/malo|shop/);
    expect(det('visita malo.shop ya')).toBe('visita ya');
    expect(det('https：//malo．com')).not.toMatch(/malo|com|https/i);
    expect(det('mira ＷＷＷ．malo．bo/x')).not.toMatch(/malo/i);
    expect(det('wa.me/59100000')).toBe('');
  });
  it('B1: las medidas y números con punto no se tocan', () => {
    expect(det('mide 12.5cm y 1.5 kg')).toBe('mide 12.5cm y 1.5 kg');
  });
  it('M10 NEGADO: los rellenos invisibles (U+3164, U+2800) no pasan como detalle', () => {
    expect(det('ㅤ⠀ ㅤ')).toBe('');
    expect(det('roㅤjo')).toBe('rojo');
  });
  it('I5: el recorte del detalle no corta un emoji por la mitad', () => {
    const d = det('😀'.repeat(200));
    expect(d).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(Array.from(d)).toHaveLength(120);
  });
  it('I1 NEGADO: un id repetido en el catálogo no se vende en NINGUNA de sus apariciones', () => {
    const dup = vc('vcVendibles')([
      { id: 'x', nombre: 'Uno', precio: 1, activo: true }, { id: 'y', nombre: 'Otro', precio: 2, activo: true }, { id: 'x', nombre: 'Dos', precio: 9, activo: true },
    ]);
    expect(ids(dup)).toEqual(['y']);
    expect(ids(vc('vcVendibles')([{ id: 'x', nombre: 'Uno', precio: 1, activo: true }, { id: 'x', nombre: 'Apagado', precio: 1, activo: false }]))).toEqual([]);
  });
  it('M8 NEGADO: un ítem sin nombre (o cuyo nombre es solo un enlace) no es vendible', () => {
    expect(vc('vcVendibles')([{ id: 'x', precio: 1, activo: true }, { id: 'y', nombre: '  ', precio: 1, activo: true }, { id: 'z', nombre: 'https://malo.example', precio: 1, activo: true }])).toEqual([]);
  });
  it('I2 NEGADO: un cambio de precio con el mismo id, cantidad y detalle NO es el mismo carrito', () => {
    const a = [{ id: 'a1', cantidad: 1, precioCentavos: 10000, detalle: '' }];
    expect(vc('vcMismoCarrito')(a, [{ ...a[0] }])).toBe(true);
    expect(vc('vcMismoCarrito')(a, [{ ...a[0], precioCentavos: 12000 }])).toBe(false);
  });
  it('I4: la cantidad como texto entero se acepta; «1.5», «abc», «0», «-1», «1e3» y «0007» no', () => {
    expect(L([{ id: 'a1', cantidad: ' 3 ' }]).lineas[0].cantidad).toBe(3);
    for (const c of ['1.5', 'abc', '0', '-1', '1e3', '0007', '', '1234567', '3 4']) {
      const r = L([{ id: 'a1', cantidad: c }]);
      expect(r.lineas, c).toEqual([]);
      expect(r.descartadas, c).toEqual([{ id: 'a1', motivo: 'cantidad' }]);
    }
  });
  it('M2: el id descartado se limpia y se recorta, y solo se procesan 100 elementos', () => {
    const r = L([{ id: 'https://malo.example/' + 'x'.repeat(500), cantidad: 1 }, { id: 'ro​jo\ncon salto', cantidad: 1 }]);
    expect(r.descartadas[0].id).toBe('');
    expect(r.descartadas[1].id).toBe('rojo con salto');
    expect(L([{ id: 'x'.repeat(500), cantidad: 1 }]).descartadas[0].id.length).toBeLessThanOrEqual(100);
    const mil = Array.from({ length: 1000 }, () => ({ id: 'nada', cantidad: 1 }));
    expect(L(mil).descartadas).toHaveLength(100);
    const mas = [...Array.from({ length: 100 }, () => ({ id: 'nada', cantidad: 1 })), { id: 'a1', cantidad: 1 }];
    expect(L(mas).lineas).toEqual([]);
  });
  it('M3: «Azul» y «azul » son el mismo detalle; la línea conserva el texto limpio', () => {
    const r = L([{ id: 'a1', cantidad: 1, detalle: 'Azul  Claro' }, { id: 'a1', cantidad: 1, detalle: 'azul claro ' }]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].cantidad).toBe(2);
    expect(r.lineas[0].detalle).toBe('Azul Claro');
  });
  it('M4: recortar la cantidad al tope lo avisa con «tope» y la línea se conserva', () => {
    const r = L([{ id: 'a1', cantidad: 80 }]);
    expect(r.lineas[0].cantidad).toBe(50);
    expect(r.descartadas).toEqual([{ id: 'a1', motivo: 'tope' }]);
    const suma = L([{ id: 'a1', cantidad: 40 }, { id: 'a1', cantidad: 40 }]);
    expect(suma.lineas[0].cantidad).toBe(50);
    expect(suma.descartadas).toEqual([{ id: 'a1', motivo: 'tope' }]);
    expect(L([{ id: 'a1', cantidad: 50 }]).descartadas).toEqual([]);
  });
  it('M5 NEGADO: vcIndice y vcLineas no aceptan un vendible con precio roto ni con id raro', () => {
    const malos = [{ id: 'ok', nombre: 'Bien', precioCentavos: 100 }, { id: 'a/b', nombre: 'Barra', precioCentavos: 100 }, { id: 'p', nombre: 'Decimal', precioCentavos: 1.5 }, { id: 'q', nombre: 'Cero', precioCentavos: 0 }, { id: 'r', nombre: 'NaN', precioCentavos: NaN }];
    expect(vc('vcIndice')(malos)).toBe('ok|Bien|1');
    const r = L([{ id: 'a/b', cantidad: 1 }, { id: 'p', cantidad: 1 }, { id: 'q', cantidad: 1 }, { id: 'r', cantidad: 1 }, { id: 'ok', cantidad: 1 }], undefined, malos);
    expect(ids(r.lineas)).toEqual(['ok']);
    expect(r.descartadas).toHaveLength(4);
  });
  it('M6 NEGADO: un subtotal que no es entero seguro se descarta como «monto»', () => {
    const enorme = [{ id: 'g', nombre: 'Enorme', precioCentavos: Number.MAX_SAFE_INTEGER }];
    const r = L([{ id: 'g', cantidad: 2 }], undefined, enorme);
    expect(r.lineas).toEqual([]);
    expect(r.descartadas).toEqual([{ id: 'g', motivo: 'monto' }]);
    const suma = L([{ id: 'g', cantidad: 1 }, { id: 'g', cantidad: 1 }], undefined, enorme);
    expect(suma.lineas).toHaveLength(1);
    expect(suma.lineas[0].subtotalCentavos).toBe(Number.MAX_SAFE_INTEGER);
    expect(suma.descartadas).toEqual([{ id: 'g', motivo: 'monto' }]);
  });
  it('I3: el resumen incluye el detalle entre paréntesis, solo si lo hay', () => {
    const lineas = L([{ id: 'a1', cantidad: 2, detalle: 'talla M' }, { id: 'b2', cantidad: 1 }]).lineas;
    const filas = (vc('vcResumen')(lineas) as string).split('\n');
    expect(filas[0]).toBe('2 × Pieza A (talla M) — Bs 200');
    expect(filas[1]).toBe('1 × Pieza B — Bs 12,50');
  });
});

describe('vcTotalCentavos y vcMonto', () => {
  it('el total es un entero y no suma envío ni descuentos', () => {
    const lineas = [{ id: 'a1', subtotalCentavos: 10000, envio: 5000, descuento: 3000 }, { id: 'b2', subtotalCentavos: 1250 }];
    const t = vc('vcTotalCentavos')(lineas);
    expect(t).toBe(11250);
    expect(Number.isInteger(t)).toBe(true);
    expect(vc('vcTotalCentavos')({ envio: 100 } as unknown)).toBe(0);
    expect(vc('vcTotalCentavos')([null, 'x', { subtotalCentavos: 1.5 }, { subtotalCentavos: '9' }])).toBe(0);
  });
  it('vcMonto recibe centavos: 450, 1234.5, 0, 7795, y los montos redondos y con miles', () => {
    expect(vc('vcMonto')(0)).toBe('Bs 0');
    expect(vc('vcMonto')(450)).toBe('Bs 4,50');
    expect(vc('vcMonto')(7795)).toBe('Bs 77,95');
    expect(vc('vcMonto')(45000)).toBe('Bs 450');
    expect(vc('vcMonto')(123450)).toBe('Bs 1.234,50');
    expect(vc('vcMonto')(779500)).toBe('Bs 7.795');
    expect(vc('vcMonto')(100000000)).toBe('Bs 1.000.000');
    expect(vc('vcMonto')(5)).toBe('Bs 0,05');
  });
  it('NEGADO: lo que no es un entero seguro (decimales, NaN, Infinity, texto, bolivianos con centavos) da cadena vacía, nunca «NaN» ni un monto inventado', () => {
    for (const x of [NaN, Infinity, undefined, null, 'abc', {}, 1234.5, 0.1, '450', Number.MAX_SAFE_INTEGER + 2]) expect(vc('vcMonto')(x), String(x)).toBe('');
  });
});

describe('vcResumen y vcLineaAviso', () => {
  const lineas = vc('vcLineas')([
    { id: 'a1', cantidad: 2 }, { id: 'b2', cantidad: 3, detalle: 'verde' }, { id: 'c3', cantidad: 1 },
  ], V).lineas;
  it('el resumen tiene una línea por ítem y el total al final, sin emojis', () => {
    const r = vc('vcResumen')(lineas) as string;
    const filas = r.split('\n');
    expect(filas).toHaveLength(4);
    expect(filas[0]).toBe('2 × Pieza A — Bs 200');
    expect(filas[1]).toBe('3 × Pieza B (verde) — Bs 37,50');
    expect(filas[2]).toBe('1 × Pieza C — Bs 7.795');
    expect(filas[3]).toBe('Total: Bs 8.032,50');
    expect(r).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(() => vc('vcResumen')(null)).not.toThrow();
    expect(filas[0]).not.toContain('(');
  });
  it('NEGADO: la línea del aviso no tiene saltos de línea ni cinco espacios seguidos, y dice «y N más»', () => {
    const sucias = Array.from({ length: 7 }, (_, i) => ({ id: 'i' + i, nombre: 'Nombre\n   con     huecos ' + i, cantidad: 1 }));
    const a = vc('vcLineaAviso')(sucias) as string;
    expect(a).not.toMatch(/\n|\r/);
    expect(a).not.toMatch(/ {5}/);
    expect(a).toMatch(/ y 3 más$/);
    expect(a.split(', ')).toHaveLength(4);
    expect(vc('vcLineaAviso')(sucias, { max: 2 })).toMatch(/ y 5 más$/);
    expect(vc('vcLineaAviso')(lineas)).toBe('2 × Pieza A, 3 × Pieza B, 1 × Pieza C');
    expect(vc('vcLineaAviso')(lineas)).not.toMatch(/ más/);
    expect(vc('vcLineaAviso')(null)).toBe('sin ítems');
    expect(vc('vcLineaAviso')([])).toBe('sin ítems');
    expect(vc('vcLineaAviso')([{ cantidad: 1, nombre: 'x'.repeat(500) }, { cantidad: 1, nombre: 'y'.repeat(500) }]).length).toBeLessThanOrEqual(200);
  });
});

describe('vcSeleccion', () => {
  const grande = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, nombre: 'Prenda ' + i, descripcion: i % 2 ? 'de alpaca' : 'de seda', area: i < 10 ? 'Ropa · Chalecos' : 'Hogar · Mantas', precioCentavos: 100 }));
  it('respeta `max` (15 por defecto)', () => {
    expect(vc('vcSeleccion')(grande, 'chalecos mantas', {}, { palabras: { alpaca: ['alpaca'], seda: ['seda'] } }).length).toBeLessThanOrEqual(15);
    expect(vc('vcSeleccion')(grande, 'chalecos', {}, { max: 3 })).toHaveLength(3);
    expect(vc('vcSeleccion')(grande, 'chalecos mantas', {})).toHaveLength(15);
  });
  it('orden: carrito, mostrados, área nombrada, palabra de material; sin repetir', () => {
    const ficha = { carrito: [{ id: 'p20' }, { id: 'p21' }], mostrados: ['p21', 'p22'] };
    const r = vc('vcSeleccion')(grande, 'Quiero ver CHÁLECOS de alpaca', ficha, { palabras: { alpaca: ['alpaca'] } }) as string[];
    expect(r.slice(0, 3)).toEqual(['p20', 'p21', 'p22']);
    expect(r.slice(3, 13)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    expect(r.slice(13)).toEqual(['p11', 'p13']);
    expect(new Set(r).size).toBe(r.length);
  });
  it('es determinista', () => {
    const f = { carrito: [{ id: 'p5' }], mostrados: ['p3'] };
    expect(vc('vcSeleccion')(grande, 'mantas', f)).toEqual(vc('vcSeleccion')(grande, 'mantas', f));
  });
  it('NEGADO: un id del carrito o mostrado que no es vendible no entra; el área no coincide a medias', () => {
    const r = vc('vcSeleccion')(grande, 'chalec', { carrito: [{ id: 'fantasma' }, null, 'x'], mostrados: ['otro', 5, null] });
    expect(r).toEqual([]);
  });
  it('no lanza con entradas raras', () => {
    for (const raro of [null, undefined, 'x', 5, [], {}]) {
      expect(() => vc('vcSeleccion')(raro, raro, raro, raro)).not.toThrow();
      expect(vc('vcSeleccion')(raro, raro, raro, raro)).toEqual([]);
    }
  });
});

describe('vcMismoCarrito', () => {
  const a = [{ id: 'a1', cantidad: 1, detalle: '' }, { id: 'b2', cantidad: 2, detalle: 'verde' }];
  it('es igual con los mismos id, cantidad y detalle, aunque cambie el orden o traiga otros campos', () => {
    expect(vc('vcMismoCarrito')(a, [{ ...a[1], subtotalCentavos: 5 }, { ...a[0] }])).toBe(true);
    expect(vc('vcMismoCarrito')([], [])).toBe(true);
  });
  it('NEGADO: detecta un cambio de cantidad, de detalle, de id o de largo', () => {
    expect(vc('vcMismoCarrito')(a, [{ id: 'a1', cantidad: 2, detalle: '' }, a[1]])).toBe(false);
    expect(vc('vcMismoCarrito')(a, [a[0], { id: 'b2', cantidad: 2, detalle: 'rojo' }])).toBe(false);
    expect(vc('vcMismoCarrito')(a, [a[0], { id: 'c3', cantidad: 2, detalle: 'verde' }])).toBe(false);
    expect(vc('vcMismoCarrito')(a, [a[0]])).toBe(false);
    expect(vc('vcMismoCarrito')(a, null)).toBe(false);
    expect(vc('vcMismoCarrito')(null, null)).toBe(false);
    expect(vc('vcMismoCarrito')([null], [null])).toBe(false);
  });
});

describe('vcIndice', () => {
  it('una línea por ítem, `id|nombre|precio`, con dos decimales solo si hacen falta', () => {
    expect(vc('vcIndice')(V)).toBe('a1|Pieza A|100\nb2|Pieza B|12.50\nc3|Pieza C|7795');
    expect(vc('vcIndice')(null)).toBe('');
  });
  it('NEGADO: un nombre con «|» o salto de línea no rompe el formato', () => {
    const l = vc('vcIndice')([{ id: 'x', nombre: 'a|b\nc', precioCentavos: 100 }]) as string;
    expect(l.split('\n')).toHaveLength(1);
    expect(l.split('|')).toHaveLength(3);
  });
});

describe('el archivo es neutro y de n8n', () => {
  it('no nombra ningún negocio, rubro ni cliente, y no usa lo que el nodo Code de n8n no tiene', () => {
    for (const prohibida of ['walisuma', 'restaurante', 'coca', "q'taco", 'antonio']) expect(FUENTE.toLowerCase(), prohibida).not.toContain(prohibida);
    for (const prohibida of ['import ', 'export ', 'require(', 'Buffer', 'crypto', 'new URL']) expect(FUENTE, prohibida).not.toContain(prohibida);
  });
  it('todos sus nombres globales llevan el prefijo `vc`/`VC_`', () => {
    const globales = [...FUENTE.matchAll(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    expect(globales.length).toBeGreaterThan(9);
    expect(globales.filter((n) => !/^(vc|VC_)/.test(n))).toEqual([]);
  });
  it('la cabecera es solo comentarios y declara que no depende de otras librerías', () => {
    const cabecera = FUENTE.slice(0, FUENTE.indexOf('\n\n'));
    expect(cabecera.split('\n').every((l) => l.startsWith('//'))).toBe(true);
    expect(cabecera).toContain('NO depende de otras librerías');
  });
});

describe('prueba de humo con el catálogo real de Walisuma', () => {
  type Item = { nombre: string; precio?: number; moneda?: string; activo: boolean };
  const real = (JSON.parse(readFileSync(join(AQUI, '../../../scripts/datos/walisuma/catalogo.json'), 'utf8')) as { catalogo: Item[] }).catalogo;
  const conId = real.map((it) => ({ ...it, id: idDeItem(it.nombre) }));
  const vend = vc('vcVendibles')(conId) as { id: string; precioCentavos: number }[];
  it('los ítems activos con precio salen vendibles', () => {
    const esperados = conId.filter((it) => it.activo && typeof it.precio === 'number' && it.precio > 0).map((it) => it.id);
    expect(esperados.length).toBeGreaterThan(100);
    expect(ids(vend)).toEqual(esperados);
  });
  it('NEGADO: los 4 licores apagados y los ítems sin precio no son vendibles', () => {
    const apagados = conId.filter((it) => !it.activo);
    expect(apagados).toHaveLength(4);
    for (const it of apagados) expect(ids(vend)).not.toContain(it.id);
    for (const it of conId.filter((x) => x.precio === undefined)) expect(ids(vend)).not.toContain(it.id);
  });
  it('el precio en centavos sale del catálogo', () => {
    const bufanda = vend.find((v) => v.id === idDeItem('Bufanda de vicuña'));
    expect(bufanda?.precioCentavos).toBe(779500);
  });
});
