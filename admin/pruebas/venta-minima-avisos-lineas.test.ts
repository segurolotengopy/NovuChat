/**
 * AVISO DE PEDIDO POR LÍNEAS (Q'Taco, 24/10/2026): la plantilla con el salto de línea fijo en su cuerpo y una variable por producto
 * (`plantillasPedidoLineas` = «2:nombre,4:nombre,6:nombre»). Ejecuta el `avisos.js` versionado. Pruebas negadas: ninguna
 * variable con saltos, tabuladores, 4+ espacios ni vacía; el rol cocina sin datos del cliente; sin la clave, el payload de siempre.
 * Cero mensajes agregados o quitados: misma cuenta de ítems por destinatario.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const FUENTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src/lib/avisos.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const L = ejecutar(`${FUENTE}\nreturn [{ json: { avArmar, avPlan } }];`, [{}])[0] as unknown as { avArmar: Fn; avPlan: Fn };

const AHORA = Date.UTC(2026, 9, 5, 14);
const HORA = 3600 * 1000;
const COMPLETO = '59100000011';
const COCINA = '59100000022';
const CLIENTE = '59100000033';
const CSV = `completo:${COMPLETO}:Andres,cocina:${COCINA}:Silvana`;
const BASE = { prefijosPermitidos: '591', plantillaPedido: 'pedido_registrado', idiomaPlantillaPedido: 'es' };
const CON_LINEAS = { ...BASE, plantillasPedidoLineas: '2:pedido_registrado_l2,4:pedido_registrado_l4,6:pedido_registrado_l6' };
const sd = (abierta = false): J => ({ av: { ventana: abierta ? { [COMPLETO]: AHORA - 2 * HORA, [COCINA]: AHORA - 2 * HORA } : {}, dia: { fecha: '', n: 0 } } });

const lineasN = (n: number): J[] => Array.from({ length: n }, (_, i) => ({ cantidad: i + 1, nombre: `Producto ${i + 1}`, detalle: i % 2 ? 'sin cebolla' : '' }));
const pedido = (n = 2, extra: J = {}): J => ({
  codigo: 'K7P2', nombre: 'Ana Pérez Mamani', telefono: CLIENTE, modalidad: 'delivery', total: 110, direccion: 'Avenida Banzer 1234',
  referencia: 'frente a la farmacia', coordenadas: 'ubicación compartida -17.783300, -63.182100', resultado: 'cuadra', lineas: lineasN(n), ...extra,
});
const plantillas = (items: J[]): J[] => items.filter((i) => i.clase === 'plantilla');
const params = (it: J): string[] => it.payload.template.components[0].parameters.map((x: J) => x.text);
const de = (items: J[], tel: string): J => items.find((i) => i.para === tel && i.clase === 'plantilla')!;
const arm = (d: J, cfg: J = CON_LINEAS, s = sd()): J[] => L.avArmar('pedido', d, CSV, cfg, s, AHORA);

describe('aviso por líneas: la plantilla de tamaño 2, 4 o 6 y sus variables', () => {
  it('elige el menor tamaño que cabe y rellena con «—»; más de 6 productos: «… y K más» al final, sin partir un producto', () => {
    const esperado: Record<number, [string, number, string[]]> = {
      1: ['pedido_registrado_l2', 2, ['1 × Producto 1', '—']],
      2: ['pedido_registrado_l2', 2, ['1 × Producto 1', '2 × Producto 2 (sin cebolla)']],
      3: ['pedido_registrado_l4', 4, ['1 × Producto 1', '2 × Producto 2 (sin cebolla)', '3 × Producto 3', '—']],
      4: ['pedido_registrado_l4', 4, ['1 × Producto 1', '2 × Producto 2 (sin cebolla)', '3 × Producto 3', '4 × Producto 4 (sin cebolla)']],
      5: ['pedido_registrado_l6', 6, ['1 × Producto 1', '2 × Producto 2 (sin cebolla)', '3 × Producto 3', '4 × Producto 4 (sin cebolla)', '5 × Producto 5', '—']],
      6: ['pedido_registrado_l6', 6, ['1 × Producto 1', '2 × Producto 2 (sin cebolla)', '3 × Producto 3', '4 × Producto 4 (sin cebolla)', '5 × Producto 5', '6 × Producto 6 (sin cebolla)']],
      7: ['pedido_registrado_l6', 6, ['1 × Producto 1', '2 × Producto 2 (sin cebolla)', '3 × Producto 3', '4 × Producto 4 (sin cebolla)', '5 × Producto 5', '… y 2 más']],
      12: ['pedido_registrado_l6', 6, ['1 × Producto 1', '2 × Producto 2 (sin cebolla)', '3 × Producto 3', '4 × Producto 4 (sin cebolla)', '5 × Producto 5', '… y 7 más']],
    };
    for (const [n, [nombre, tam, lineas]] of Object.entries(esperado)) {
      const it = de(arm(pedido(Number(n))), COMPLETO);
      expect(it.payload.template.name, `n=${n}`).toBe(nombre);
      const p = params(it);
      expect(p.length, `n=${n}`).toBe(tam + 3);
      expect(p.slice(2, 2 + tam), `n=${n}`).toEqual(lineas);
      expect(p[0]).toMatch(/^N\.º K7P2 de \d+ ítems?\. Total de la comida: Bs 110/);
      expect(p[tam + 2]).toBe('datos coinciden');
    }
  });

  it('el rol completo lleva la modalidad entera (dirección, quién recibe, celular, coordenadas) y SIN los ítems', () => {
    const m = params(de(arm(pedido(3)), COMPLETO))[1];
    expect(m).toBe('Delivery a Avenida Banzer 1234 (frente a la farmacia) · recibe Ana Pérez Mamani · cel 59100000033 · ubicación compartida -17.783300, -63.182100');
    expect(m).not.toContain('Producto');
  });

  it('(2) rol cocina: sin teléfono, dirección, coordenadas, nombre completo ni números largos en NINGUNA variable', () => {
    const d = pedido(7, { lineas: [{ cantidad: 1, nombre: 'Taco 59100000033 llamar al 70012345', detalle: 'cuenta 1000000000045' }, ...lineasN(6)], notaPedido: 'tocar timbre 77712345' });
    const p = params(de(arm(d), COCINA));
    const todo = p.join(' | ');
    for (const malo of ['59100000033', 'Banzer', 'farmacia', '-17.78', '-63.18', 'Pérez', 'Mamani', '70012345', '1000000000045', '77712345', 'cel ']) expect(todo, malo).not.toContain(malo);
    expect(p[1]).toBe('Delivery · nota: tocar timbre …');
    expect(todo).not.toMatch(/\d{7,}/);
  });

  it('(1) ninguna variable lleva saltos, tabuladores ni 4+ espacios, ni está vacía (nombres con saltos y espacios)', () => {
    const sucio = (i: number): J => ({ cantidad: 1, nombre: `Taco\n\n  grande\t${i}      extra`, detalle: `sin\r\ncebolla\u2028   y    ajo\n${'x'.repeat(300)}` });
    for (const n of [1, 3, 5, 9]) {
      const d = pedido(n, { lineas: Array.from({ length: n }, (_, i) => sucio(i)), direccion: 'Calle\n 5\t\t   y\n6', nombre: 'Ana\nPérez', notaPedido: 'a\n\nb       c' });
      for (const it of plantillas(arm(d))) {
        for (const v of params(it)) {
          expect(v).not.toMatch(/[\n\r\t\u2028\u2029]/);
          expect(v).not.toMatch(/ {4,}/);
          expect(v.trim()).not.toBe('');
          expect(v.length).toBeLessThanOrEqual(500);
        }
      }
    }
  });

  it('(6) un producto con texto prohibido, enlace o formato de WhatsApp se sanea como hoy', () => {
    const d = pedido(3, { lineas: [
      { cantidad: 1, nombre: '*Taco* _grande_ ~x~', detalle: 'visite https://malo.example/x ahora' },
      { cantidad: 1, nombre: 'Birria', detalle: 'pago confirmado y verificado' },
      { cantidad: 2, nombre: 'Queso', detalle: '' },
    ] });
    for (const tel of [COMPLETO, COCINA]) {
      const p = params(de(arm(d), tel));
      const l = p.slice(2, 6).join(' | ');
      expect(l).not.toMatch(/[*_~]|https?:|malo\.example/);
      expect(l).toContain('[enlace omitido]');
      expect(l).not.toMatch(/confirmad|verificad/);
      expect(l).toContain('[texto omitido]');
    }
  });

  it('(1b) un {{2}} LARGO (dirección, referencia, quien recibe, celular, coordenadas y nota con saltos) sale en UNA línea separada por « · », sin saltos, tabuladores ni 4+ espacios (Meta lo rechaza)', () => {
    const d = pedido(4, {
      direccion: 'Avenida Banzer\n esquina 4to anillo,\t\tcondominio Los Pinos   bloque B  piso 3 departamento 12 detrás del supermercado grande de la zona norte de la ciudad de Santa Cruz de la Sierra',
      referencia: 'portón verde\r\ncon timbre    roto y un perro grande en la entrada de la casa', nombre: 'Ana María\nPérez Mamani',
      coordenadas: 'ubicación compartida -17.783300, -63.182100', notaPedido: 'sin cebolla\n\nsin picante      por favor',
    });
    for (const it of plantillas(arm(d))) {
      const v = params(it)[1] as string;
      expect(v.length).toBeLessThanOrEqual(500);
      expect(v).not.toMatch(/[\n\r\t\u2028\u2029]/);
      expect(v).not.toMatch(/ {4,}/);
      if (it.para === COMPLETO) expect(v.split(' · ').length).toBeGreaterThanOrEqual(4);
    }
  });
  it('(4) sin la clave (ausente, vacía o solo espacios) el payload es idéntico byte a byte al de hoy', () => {
    for (const n of [1, 3, 8]) {
      const hoy = JSON.stringify(arm(pedido(n), BASE));
      for (const clave of ['', '   ', undefined, null]) {
        expect(JSON.stringify(arm(pedido(n), { ...BASE, plantillasPedidoLineas: clave, idiomaPlantillaPedidoLineas: 'en' })), String(clave)).toBe(hoy);
      }
      expect(JSON.stringify(L.avPlan('pedido', pedido(n), CSV, BASE, sd(), AHORA))).toBe(JSON.stringify(L.avPlan('pedido', pedido(n), CSV, { ...BASE, plantillasPedidoLineas: '' }, sd(), AHORA)));
      expect(de(arm(pedido(n), BASE), COMPLETO).payload.template.name).toBe('pedido_registrado');
      expect(params(de(arm(pedido(n), BASE), COMPLETO)).length).toBe(4);
    }
  });

  it('(5) con la clave y un tamaño sin plantilla: cae a la antigua y anota lineas_sin_plantilla_<N>', () => {
    const cfg = { ...BASE, plantillasPedidoLineas: '2:pedido_registrado_l2,6:pedido_registrado_l6' };
    const r = L.avPlan('pedido', pedido(3), CSV, cfg, sd(), AHORA);
    expect(r.errores).toContain('lineas_sin_plantilla_4');
    for (const it of plantillas(r.items)) {
      expect(it.payload.template.name).toBe('pedido_registrado');
      expect(params(it).length).toBe(4);
    }
    expect(JSON.stringify(r.items)).toBe(JSON.stringify(arm(pedido(3), BASE)));
    // Nombres inválidos o tamaños que no existen no cuentan como plantilla.
    const mala = L.avPlan('pedido', pedido(1), CSV, { ...BASE, plantillasPedidoLineas: '2:Nombre Malo,3:otra,8:x' }, sd(), AHORA);
    expect(mala.errores).toContain('lineas_sin_plantilla_2');
    expect(plantillas(mala.items)[0].payload.template.name).toBe('pedido_registrado');
  });

  it('(7) misma cantidad de ítems de salida que hoy, con ventana cerrada y abierta; el texto libre no cambia', () => {
    for (const abierta of [false, true]) {
      for (const n of [1, 5, 9]) {
        const nuevo = arm(pedido(n), CON_LINEAS, sd(abierta));
        const viejo = arm(pedido(n), BASE, sd(abierta));
        expect(nuevo.length).toBe(viejo.length);
        expect(nuevo.map((i) => [i.para, i.clase])).toEqual(viejo.map((i) => [i.para, i.clase]));
        expect(JSON.stringify(nuevo.filter((i) => i.clase !== 'plantilla'))).toBe(JSON.stringify(viejo.filter((i) => i.clase !== 'plantilla')));
      }
    }
  });

  it('el idioma propio de la plantilla por líneas manda; sin él rige el de la plantilla de pedido', () => {
    expect(de(arm(pedido(1)), COMPLETO).payload.template.language.code).toBe('es');
    expect(de(arm(pedido(1), { ...CON_LINEAS, idiomaPlantillaPedido: 'en', idiomaPlantillaPedidoLineas: 'es_MX' }), COMPLETO).payload.template.language.code).toBe('es_MX');
    expect(de(arm(pedido(1), { ...CON_LINEAS, idiomaPlantillaPedido: 'en' }), COMPLETO).payload.template.language.code).toBe('en');
  });

  it('simulado y comprobante conservan sus rótulos; reserva y derivación no cambian', () => {
    const sim = params(de(arm(pedido(2, { resultado: 'simulado' })), COMPLETO));
    expect(sim[0]).toMatch(/^PRUEBA · N\.º K7P2/);
    expect(sim[0]).toContain('(SIMULADO)');
    expect(sim[4]).toMatch(/PRUEBA: cobro SIMULADO/);
    const cfg = { ...CON_LINEAS, plantillaReserva: 'reserva_x', formaPlantillaReserva: 'pedido', plantillaDerivacion: 'der_x', formaPlantillaDerivacion: 'pedido' };
    const r = { codigo: 'R1', nombre: 'Ana', telefono: CLIENTE, reserva: { personas: 2, fecha: '2026-10-09', hora: '20:00', zona: 'terraza' } };
    expect(JSON.stringify(L.avArmar('reserva', r, CSV, cfg, sd(), AHORA))).toBe(JSON.stringify(L.avArmar('reserva', r, CSV, { ...cfg, plantillasPedidoLineas: '' }, sd(), AHORA)));
    expect(JSON.stringify(L.avArmar('transferencia', { codigo: 'C1', telefono: CLIENTE, motivo: 'hola' }, CSV, cfg, sd(), AHORA)))
      .toBe(JSON.stringify(L.avArmar('transferencia', { codigo: 'C1', telefono: CLIENTE, motivo: 'hola' }, CSV, { ...cfg, plantillasPedidoLineas: '' }, sd(), AHORA)));
  });

  it('(8) tiempo lineal con textos de 100 000 caracteres', () => {
    const gran = 'ab · \n '.repeat(14000);
    const d = pedido(9, { lineas: Array.from({ length: 9 }, () => ({ cantidad: 1, nombre: gran, detalle: gran })), direccion: gran, notaPedido: gran, nombre: gran });
    const t0 = Date.now();
    const items = arm(d);
    expect(Date.now() - t0).toBeLessThan(3000);
    for (const it of plantillas(items)) for (const v of params(it)) expect(v.length).toBeLessThanOrEqual(500);
  });
});

describe('el dato de Q\'Taco (28/10): las tres plantillas aprobadas, vigentes en su flujo versionado', () => {
  const datosQtaco = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../scripts/datos/venta-minima/qtaco.json'), 'utf8')) as J;
  const flujoQtaco = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/venta-minima.qtaco.json'), 'utf8')) as J;
  it('qtaco.json trae las tres, en español, y el flujo construido las lleva en «Config base»', () => {
    expect((datosQtaco['configBase'] as J)['plantillasPedidoLineas']).toBe('2:pedido_registrado_l2,4:pedido_registrado_l4,6:pedido_registrado_l6');
    expect((datosQtaco['configBase'] as J)['idiomaPlantillaPedidoLineas']).toBe('es');
    expect(JSON.stringify(flujoQtaco)).toContain('pedido_registrado_l6');
  });
  it('NEGADA: con la clave vacía el payload es el de siempre (vuelta atrás = vaciar la clave)', () => {
    const plan = L.avPlan('pedido', pedido(3), CSV, { ...BASE, plantillasPedidoLineas: '' }, sd(), AHORA);
    expect(JSON.stringify(plan)).not.toContain('pedido_registrado_l');
  });
});
