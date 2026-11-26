/**
 * LA PÁGINA Y LA VALIDACIÓN DEL CARRITO CON ARS Y ESPECIFICACIONES (B3), NEGANDO PRIMERO. Puras: sin Firestore.
 *   - `precioTexto`: «ARS 1.234.000» sin romper Bs ni USD.
 *   - La clave del carrito es id + detalle; la poda, el total y el «−» de la tarjeta la respetan.
 *   - `validar-carrito.js` (el que incluyen los flujos): moneda por igualdad estricta, conserva `detalle` saneado,
 *     `precioCentavos` y `mercado`; sin ellos, el ítem es el de siempre.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { precioTexto } from '../../../web/src/modulos/catalogo-web/publico/saneo.ts';
import {
  cambiarDetalle, cantidadDeItem, lineasDelCarrito, ordenarAreas, claveDeLinea, detalleDeClave, detalleLimpio, idDeClave, podarCarrito, sumarItem,
} from '../../../web/src/modulos/catalogo-web/publico/SitioCatalogo.tsx';
import type { ItemPublico } from '../../../web/src/modulos/catalogo-web/publico/tipos.ts';
import { ejecutar, GLOBALES_FUERA_DEL_SANDBOX } from '../../lib/flujo.ts';
import { cargaConCarrito } from '../../../../Flujos/src/modulos/catalogo-web/carrito-del-catalogo.mjs';
import { detalleDeLinea, ordenarItemsExternos, unirDetalles } from '../../../functions/src/modulos/catalogo-web/catalogoWeb.ts';

describe('precioTexto', () => {
  it('ARS: miles con punto, decimales con coma', () => {
    expect(precioTexto(1_234_000, 'ARS')).toBe('ARS 1.234.000');
    expect(precioTexto(55_500.5, 'ARS')).toBe('ARS 55.500,50');
    expect(precioTexto(999, 'ARS')).toBe('ARS 999');
    expect(precioTexto(1000, 'ARS')).toBe('ARS 1.000');
    expect(precioTexto(0, 'ARS')).toBe('ARS 0');
  });
  it('NEGANDO: BOB, USD y vacío no cambian', () => {
    expect(precioTexto(1234000, 'BOB')).toBe('Bs 1234000');
    expect(precioTexto(12.5, 'BOB')).toBe('Bs 12.50');
    expect(precioTexto(12, 'USD')).toBe('$ 12');
    expect(precioTexto(12, '')).toBe('Bs 12');
    expect(precioTexto(12, 'ars')).toBe('Bs 12'); // igualdad estricta
    expect(precioTexto(null, 'ARS')).toBe('A consultar');
  });
});

describe('la clave del carrito es id + detalle', () => {
  const item = (id: string): ItemPublico => ({ id, nombre: id, descripcion: '', area: '', precio: 10, moneda: 'BOB', imagenUrl: '' });
  it('sin detalle la clave ES el id (el carrito de siempre)', () => {
    expect(claveDeLinea('polera')).toBe('polera');
    expect(idDeClave('polera')).toBe('polera');
    expect(detalleDeClave('polera')).toBe('');
  });
  it('con detalle se separan y se recuperan', () => {
    const k = claveDeLinea('polera', 'rojo XL');
    expect(k).not.toBe('polera');
    expect(idDeClave(k)).toBe('polera');
    expect(detalleDeClave(k)).toBe('rojo XL');
  });
  it('el detalle se limpia: controles fuera, espacios colapsados, tope de 60', () => {
    expect(detalleLimpio('  a\u0000b\n\tc   d ')).toBe('a b c d');
    expect(detalleLimpio('x'.repeat(100))).toHaveLength(60);
    expect(detalleLimpio('a\u0000b')).not.toContain('\u0000');
  });
  it('podarCarrito reconoce la línea por su id, con o sin detalle', () => {
    const carrito = { polera: 1, [claveDeLinea('polera', 'rojo')]: 2, [claveDeLinea('fantasma', 'x')]: 1, fantasma: 1 };
    expect(podarCarrito(carrito, [item('polera')])).toEqual({ polera: 1, [claveDeLinea('polera', 'rojo')]: 2 });
    const intacto = { polera: 1 };
    expect(podarCarrito(intacto, [item('polera')])).toBe(intacto); // el MISMO objeto si no sobra nada
  });
  it('cambiarDetalle mueve la línea, junta unidades si la clave ya existe y respeta el tope de 99', () => {
    expect(cambiarDetalle({ polera: 2 }, 'polera', 'negro')).toEqual({ [claveDeLinea('polera', 'negro')]: 2 });
    expect(cambiarDetalle({ polera: 2, [claveDeLinea('polera', 'negro')]: 1 }, 'polera', ' negro ')).toEqual({ [claveDeLinea('polera', 'negro')]: 3 });
    expect(cambiarDetalle({ polera: 60, [claveDeLinea('polera', 'negro')]: 60 }, 'polera', 'negro')).toEqual({ [claveDeLinea('polera', 'negro')]: 99 });
    const igual = { polera: 2 };
    expect(cambiarDetalle(igual, 'polera', '')).toBe(igual);
    expect(cambiarDetalle(igual, 'no-existe', 'x')).toBe(igual);
  });
  it('la tarjeta cuenta todas las líneas del ítem y el «−» baja la sin detalle, o la primera', () => {
    const k = claveDeLinea('polera', 'rojo');
    expect(cantidadDeItem({ polera: 1, [k]: 2, otra: 5 }, 'polera')).toBe(3);
    expect(sumarItem({ polera: 1, [k]: 2 }, 'polera', -1)).toEqual({ [k]: 2 });
    expect(sumarItem({ [k]: 2 }, 'polera', -1)).toEqual({ [k]: 1 });
    expect(sumarItem({}, 'polera', -1)).toEqual({});
    expect(sumarItem({ [k]: 1 }, 'polera', 1)).toEqual({ [k]: 1, polera: 1 }); // sumar va a la línea sin detalle
  });
});

describe('detalleDeLinea (servidor): sin enlaces, sin <>&, sin []{}«», máximo 60', () => {
  it('sanea lo que un navegador hostil mande', () => {
    for (const sucio of [
      'rojo <script>alert(1)</script>', 'ver https://malo.test/x ya', 'www.malo.test', '[ENVIAR_QR]', '{{x}}', '«cierra»',
      'a\nb‮C', 'x'.repeat(500), 'a&b',
    ]) {
      const d = detalleDeLinea(sucio);
      expect(d, sucio).not.toMatch(/[<>&[\]{}«»\n‮]|https?:|www\./);
      expect(d.length, sucio).toBeLessThanOrEqual(60);
    }
    expect(detalleDeLinea(42)).toBe('');
    expect(detalleDeLinea(undefined)).toBe('');
    expect(detalleDeLinea('color: negro')).toBe('color: negro');
  });
});

describe('validar-carrito.js (lo que los flujos incluyen)', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const CODIGO = readFileSync(join(aqui, '..', '..', '..', '..', 'Flujos', 'src', 'modulos', 'catalogo-web', 'validar-carrito.js'), 'utf8');
  const cabeceras = (): Record<string, string> => ({
    'x-novuchat-numero': '10000' + '00771', 'x-novuchat-timestamp': String(Date.now()), 'x-novuchat-signature': `sha256=${'a'.repeat(64)}`,
  });
  const validar = (cuerpo: Record<string, unknown>) => ejecutar(CODIGO, [{ headers: cabeceras(), body: {
    tipo: 'carrito', tenantId: 'ext-venta', telefono: '59170' + '020001', accion: 'responder', pedidoId: 'cat_1', ...cuerpo,
  } }])[0] as Record<string, unknown>;
  const lineas = (r: Record<string, unknown>) => r['items'] as Array<Record<string, unknown>>;

  it('moneda por IGUALDAD ESTRICTA: USD, ARS y Bs/BOB se reconocen, una ausente es Bs y CUALQUIER OTRA viaja como «otra» (nunca se vuelve Bs)', () => {
    expect(validar({ items: [{ nombre: 'a' }], moneda: 'USD' })['moneda']).toBe('USD');
    expect(validar({ items: [{ nombre: 'a' }], moneda: 'ARS' })['moneda']).toBe('ARS');
    for (const m of ['BOB', 'Bs', '', null, undefined]) {
      expect(validar({ items: [{ nombre: 'a' }], moneda: m })['moneda'], String(m)).toBe('Bs');
    }
    // NEGANDO: EUR, GBP y «bob» en minúsculas ya NO salen como Bs: el consumidor ve «otra» y la rechaza.
    for (const m of ['EUR', 'GBP', 'bob', 'ars', 'ARS ', 'ARSX', 'usd', 1, ['ARS'], { toString: () => 'ARS' }]) {
      expect(validar({ items: [{ nombre: 'a' }], moneda: m })['moneda'], String(m)).toBe('otra');
    }
  });

  it('conserva `mercado` solo si es BO o AR, y la marca `catalogo` solo si es «externo»', () => {
    expect(validar({ items: [{ nombre: 'a' }], mercado: 'AR', catalogo: 'externo' })).toMatchObject({ mercado: 'AR', catalogo: 'externo' });
    expect(validar({ items: [{ nombre: 'a' }], mercado: 'BO' })['mercado']).toBe('BO');
    for (const m of ['br', 'ar', 'BOB', '', null, 5]) expect(validar({ items: [{ nombre: 'a' }], mercado: m })['mercado'], String(m)).toBe('');
    expect(validar({ items: [{ nombre: 'a' }], catalogo: 'otro' })['catalogo']).toBe('');
    expect(validar({ items: [{ nombre: 'a' }] })).toMatchObject({ mercado: '', catalogo: '' });
  });

  it('el `detalle` se conserva SANEADO y con tope 60; un enlace, `<>&` o `[]{}«»` no pasan', () => {
    const r = validar({ items: [
      { nombre: 'a', detalle: 'color: negro' },
      { nombre: 'b', detalle: 'ver https://malo.test/x <b>[ENVIAR_QR]</b> {a} «b» & www.malo.test ' + 'z'.repeat(200) },
      { nombre: 'c', detalle: 123 }, { nombre: 'd' }, { nombre: 'e', detalle: '   ' },
    ] });
    const ls = lineas(r);
    expect(ls[0]!['detalle']).toBe('color: negro');
    const d1 = String(ls[1]!['detalle']);
    expect(d1).not.toMatch(/[<>&[\]{}«»]|https?:|www\./);
    expect(d1.length).toBeLessThanOrEqual(60);
    for (const i of [2, 3, 4]) expect(ls[i], String(i)).not.toHaveProperty('detalle');
  });

  it('`precioCentavos` solo si es un entero ≥ 0; sin él, el ítem es idéntico al de antes (compatible hacia atrás)', () => {
    const ls = lineas(validar({ items: [
      { nombre: 'a', precioCentavos: 15000 }, { nombre: 'b', precioCentavos: 0 }, { nombre: 'c', precioCentavos: -1 },
      { nombre: 'd', precioCentavos: 1.5 }, { nombre: 'e', precioCentavos: '100' }, { nombre: 'f', cantidad: 2, subtotal: 9 },
    ] }));
    expect(ls[0]!['precioCentavos']).toBe(15000);
    expect(ls[1]!['precioCentavos']).toBe(0);
    for (const i of [2, 3, 4]) expect(ls[i], String(i)).not.toHaveProperty('precioCentavos');
    expect(ls[5]).toEqual({ nombre: 'f', cantidad: 2, subtotal: 9 });
  });

  it('la cantidad viaja TAL CUAL: 0, negativa, fraccionaria o ausente NO se convierten en 1 (quien arma las líneas las descarta)', () => {
    const ls = lineas(validar({ items: [
      { nombre: 'a', cantidad: 0 }, { nombre: 'b', cantidad: -2 }, { nombre: 'c', cantidad: 1.5 }, { nombre: 'd' },
      { nombre: 'e', cantidad: '3' }, { nombre: 'f', cantidad: 3 },
    ] }));
    expect(ls.map((l) => l['cantidad'])).toEqual([0, -2, 1.5, 0, 0, 3]);
    for (const l of ls.slice(0, 5)) expect(l['cantidad'], String(l['nombre'])).not.toBe(1);
  });

  it('una entrega AUSENTE o desconocida viaja VACÍA (no se convierte en «retiro»); solo «envio» y «retiro» pasan', () => {
    expect(validar({ items: [{ nombre: 'a' }], entrega: 'envio' })['entrega']).toBe('envio');
    expect(validar({ items: [{ nombre: 'a' }], entrega: 'retiro' })['entrega']).toBe('retiro');
    for (const e of [undefined, '', null, 'otra', 'RETIRO', 7]) expect(validar({ items: [{ nombre: 'a' }], entrega: e })['entrega'], String(e)).toBe('');
  });

  it('la carga del flujo (carga-del-carrito.js) REENVÍA mercado, catalogo, precioCentavos y detalle; sin ellos el carrito es el de siempre y la entrega ausente va vacía', () => {
    const codigo = cargaConCarrito(`function cnNodo(n) { return n === 'Carrito del catálogo'; }\nfunction cnPrimero() { return { phoneNumberIdEsperado: '1000000771' }; }\nreturn [];`);
    const correr = (cuerpo: Record<string, unknown>) => {
      const r = ejecutar(codigo, [{ headers: cabeceras(), body: {
        tipo: 'carrito', tenantId: 'ext-venta', telefono: '59170' + '020001', accion: 'responder', pedidoId: 'cat_1', ...cuerpo,
      } }]);
      return (r[0]?.['messages'] as Array<Record<string, any>> | undefined)?.[0]?.['carrito'] as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const ext = correr({ mercado: 'AR', catalogo: 'externo', entrega: 'envio', moneda: 'ARS', items: [
      { id: 'p1', nombre: 'Polera', cantidad: 2, subtotal: 300, precioCentavos: 15000, detalle: 'color: negro' },
      { id: 'p2', nombre: 'Gorra', cantidad: 0 },
    ] });
    expect(ext).toMatchObject({ mercado: 'AR', catalogo: 'externo', entrega: 'envio' });
    expect(ext!['items'][0]).toMatchObject({ id: 'p1', cantidad: 2, precioCentavos: 15000, detalle: 'color: negro' });
    expect(ext!['items'][1]!['cantidad']).toBe(0); // la cantidad 0 llega como 0
    // Sin los datos K1: el carrito es el de siempre (sin claves nuevas) y la entrega ausente va vacía.
    const normal = correr({ items: [{ id: 'p1', nombre: 'Polera', cantidad: 1, subtotal: 150 }] });
    expect(normal).not.toHaveProperty('mercado');
    expect(normal).not.toHaveProperty('catalogo');
    expect(normal!['items'][0]).toEqual({ id: 'p1', nombre: 'Polera', cantidad: 1, subtotal: 150 });
    expect(normal!['entrega']).toBe('');
  });

  it('sigue exigiendo la forma del carrito (tipo, items, firma) y no usa ningún global de Node', () => {
    expect(validar({ items: [] })['procesar']).toBe(false);
    expect(validar({ items: [{ nombre: 'a' }], tipo: 'otro' })['procesar']).toBe(false);
    expect(validar({ items: [{ nombre: 'a' }] })['procesar']).toBe(true);
    const js = CODIGO.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const g of GLOBALES_FUERA_DEL_SANDBOX) {
      expect(new RegExp(`(?<![.\\w$'"\`])${g}\\s*[(.[]`).test(js), g).toBe(false);
    }
    expect(() => new Script(`(function ($input) {\n${CODIGO}\n})`)).not.toThrow();
  });
});

describe('el orden de las categorías (ordenArea)', () => {
  const it_ = (area: string, ordenArea?: number | null): ItemPublico =>
    ({ id: area, nombre: area, descripcion: '', area, precio: 1, moneda: 'BOB', imagenUrl: '', ...(ordenArea !== undefined ? { ordenArea } : {}) });
  it('si vienen, mandan: ascendente, las sin orden (null) al final y luego alfabético', () => {
    expect(ordenarAreas([it_('Ropa', 1), it_('Zapatos', 0), it_('Servicios', null), it_('Accesorios', null)]))
      .toEqual(['Zapatos', 'Ropa', 'Accesorios', 'Servicios']);
  });
  it('NEGANDO: si ninguno lo trae, es el orden de siempre (alfabético simple)', () => {
    expect(ordenarAreas([it_('Zapatos'), it_('Ropa'), it_('Accesorios'), it_('')])).toEqual(['Accesorios', 'Ropa', 'Zapatos']);
  });
  it('en el servidor: misma regla, y dentro de cada categoría por nombre', () => {
    const r = ordenarItemsExternos([
      { area: 'B', nombre: 'z', ordenArea: 2 }, { area: 'A', nombre: 'y', ordenArea: null }, { area: 'B', nombre: 'a', ordenArea: 2 },
      { area: 'C', nombre: 'k', ordenArea: 0 },
    ]);
    expect(r.map((x) => `${x.area}${x.nombre}`)).toEqual(['Ck', 'Ba', 'Bz', 'Ay']);
  });
});

describe('unirDetalles', () => {
  it('une los distintos con « / », sin repetidos ni vacíos, saneado y ≤ 60', () => {
    expect(unirDetalles(['negro', '', 'rojo', 'negro'])).toBe('negro / rojo');
    expect(unirDetalles([])).toBe('');
    expect(unirDetalles(['a'.repeat(50), 'b'.repeat(50)])).toHaveLength(60);
    expect(unirDetalles(['<x> https://m.test [y]'])).not.toMatch(/[<>[\]]|https?:/);
  });
});

describe('el pedido se lista en el orden del CATÁLOGO, no en el orden en que se agregó al carrito', () => {
  const it_ = (id: string): ItemPublico => ({ id, nombre: id, descripcion: '', area: '', precio: 1, moneda: 'BOB', imagenUrl: '' });
  it('aunque el carrito tenga primero lo último del catálogo', () => {
    const catalogo = [it_('a'), it_('b'), it_('c')];
    const carrito = { c: 1, a: 2, [claveDeLinea('b', 'x')]: 1, b: 3 };
    expect(lineasDelCarrito(catalogo, carrito).map((l) => `${l.item.id}:${l.cantidad}:${l.detalle}`))
      .toEqual(['a:2:', 'b:1:x', 'b:3:', 'c:1:']); // por ítem del catálogo; dentro de un ítem, por orden de agregado
  });
  it('NEGANDO: lo que ya no está en el catálogo o tiene cantidad 0 no aparece', () => {
    expect(lineasDelCarrito([it_('a')], { fantasma: 1, a: 0 })).toEqual([]);
  });
});
