/**
 * Palabra tolerante (`Flujos/src/modulos/productos/palabra-tolerante.js`, prefijo `pt`): pieza común y pura.
 * Pruebas NEGADAS: sin falsos positivos peligrosos (tele/tela, casa/cosa, cifras, sinónimos) y sin costo cuadrático.
 */
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';

type Pt = {
  ptNorm: (s: unknown) => string;
  ptDistancia1: (a: string, b: string) => boolean;
  ptCasiIgual: (c: unknown, k: unknown) => boolean;
  ptNombra: (t: unknown, n: unknown) => boolean;
};
const pt = cargarFuente<Pt>(['Flujos/src/modulos/productos/palabra-tolerante.js'], ['ptNorm', 'ptDistancia1', 'ptCasiIgual', 'ptNombra']);

describe('ptNorm', () => {
  it('minúsculas, sin tildes ni diéresis, conserva la ñ, solo letras y cifras', () => {
    expect(pt.ptNorm('  ÁÉÍÓÚ Güe-ñu 65! ')).toBe('aeiouguenu65'.replace('guenu', 'gueñu'));
    expect(pt.ptNorm('')).toBe('');
    expect(pt.ptNorm(null)).toBe('');
    expect(pt.ptNorm('😀🎉')).toBe('');
  });
});

describe('ptDistancia1', () => {
  it('una edición: sustitución, inserción, borrado, transposición', () => {
    for (const [a, b] of [['abc', 'abc'], ['abc', 'abd'], ['abc', 'abcd'], ['abcd', 'abc'], ['abcd', 'abdc'], ['xabc', 'abc']]) expect(pt.ptDistancia1(a, b), a + b).toBe(true);
  });
  it('NIEGA: dos ediciones o diferencia de largo mayor a uno', () => {
    for (const [a, b] of [['abc', 'axy'], ['abc', 'abcde'], ['abcd', 'badc'], ['abcd', 'dcba'], ['', 'ab']]) expect(pt.ptDistancia1(a, b), a + b).toBe(false);
  });
});

describe('ptCasiIgual: lo que SÍ casa', () => {
  it('erratas de escritura frecuentes', () => {
    const pares: [string, string][] = [['biletera', 'Billetera'], ['liquadora', 'Licuadora'], ['labadora', 'Lavadora'],
      ['telebisor', 'Televisor'], ['acondisionado', 'Acondicionado'], ['billetrea', 'Billetera']];
    for (const [c, k] of pares) expect(pt.ptCasiIgual(c, k), c).toBe(true);
  });
  it('plurales, tildes y mayúsculas', () => {
    expect(pt.ptCasiIgual('lavadoras', 'Lavadora')).toBe(true);
    expect(pt.ptCasiIgual('televisores', 'televisor')).toBe(true);
    expect(pt.ptCasiIgual('CÁMARAS', 'camara')).toBe(true);
    expect(pt.ptCasiIgual('Cocína', 'cocina')).toBe(true);
    expect(pt.ptCasiIgual('licuadora', 'LICUADORA')).toBe(true);
  });
  it('«bileltera» casa con «billetera» (tras colapsar la «ll» queda una sola edición); dos ediciones reales no', () => {
    expect(pt.ptCasiIgual('bileltera', 'billetera')).toBe(true);
    expect(pt.ptCasiIgual('bilteleran', 'billetera')).toBe(false);
  });
});

describe('ptCasiIgual: NO hay falsos positivos peligrosos', () => {
  it('palabras cortas exigen igualdad', () => {
    const pares: [string, string][] = [['tele', 'tela'], ['casa', 'cosa'], ['mesa', 'misa'], ['cama', 'camara'], ['camara', 'cama'], ['radio', 'rubio'], ['plancha', 'planta']];
    for (const [c, k] of pares) expect(pt.ptCasiIgual(c, k), c + k).toBe(false);
  });
  it('productos distintos y sinónimos no casan', () => {
    expect(pt.ptCasiIgual('lavadora', 'licuadora')).toBe(false);
    expect(pt.ptCasiIgual('cartera', 'billetera')).toBe(false);
    expect(pt.ptCasiIgual('refrigerador', 'refrigeradora')).toBe(true); // una inserción final: misma pieza
    expect(pt.ptCasiIgual('televisor', 'transistor')).toBe(false);
  });
  it('números y modelos: exactos', () => {
    expect(pt.ptCasiIgual('65', '55')).toBe(false);
    expect(pt.ptCasiIgual('u8000f', 'u8000f')).toBe(true);
    expect(pt.ptCasiIgual('u8000f', 'u8000g')).toBe(false);
    expect(pt.ptCasiIgual('1234567', '1234568')).toBe(false);
    expect(pt.ptCasiIgual('un65u8000f', 'un65u8000g')).toBe(false);
  });
  it('vacío, nulo y emojis', () => {
    expect(pt.ptCasiIgual('', '')).toBe(false);
    expect(pt.ptCasiIgual(null, 'lavadora')).toBe(false);
    expect(pt.ptCasiIgual('😀', '😀')).toBe(false);
  });
});

describe('ptNombra', () => {
  it('encuentra la pieza nombrada con errata', () => {
    expect(pt.ptNombra('quiero una biletera', 'Billetera de cuero')).toBe(true);
    expect(pt.ptNombra('necesito una liquadora', 'Licuadora Oster 3 velocidades')).toBe(true);
    expect(pt.ptNombra('una labadora porfa', 'Lavadora')).toBe(true);
    expect(pt.ptNombra('TELEBISORES!!', 'Televisor LED 65"')).toBe(true);
  });
  it('NIEGA: palabras cortas del nombre no cuentan; textos sin relación no casan', () => {
    expect(pt.ptNombra('una tela bonita', 'Tele LG de 65')).toBe(false);
    expect(pt.ptNombra('quiero una cartera', 'Billetera de cuero')).toBe(false);
    expect(pt.ptNombra('quiero una lavadora', 'Licuadora')).toBe(false);
    expect(pt.ptNombra('de la', 'Billetera de la casa')).toBe(false);
    expect(pt.ptNombra('', 'Billetera')).toBe(false);
    expect(pt.ptNombra('billetera', '')).toBe(false);
    expect(pt.ptNombra('😀 🎉', 'Billetera')).toBe(false);
  });
  it('un nombre de una sola palabra corta se compara exacto', () => {
    expect(pt.ptNombra('quiero tele', 'Tele')).toBe(true);
    expect(pt.ptNombra('quiero tela', 'Tele')).toBe(false);
  });
  it('texto larguísimo: sin costo cuadrático (5.000 palabras bajo 200 ms)', () => {
    const texto = Array.from({ length: 5000 }, (_, i) => 'palabra' + (i % 97) + 'x').join(' ');
    const t0 = Date.now();
    expect(pt.ptNombra(texto, 'Billetera de cuero')).toBe(false);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('propiedad: una letra interior errada sigue casando consigo misma y con ninguna otra pieza', () => {
  const NOMBRES = ['Billetera', 'Licuadora', 'Lavadora', 'Televisor', 'Acondicionado', 'Refrigeradora', 'Microondas', 'Computadora',
    'Impresora', 'Ventilador', 'Calefactor', 'Aspiradora', 'Zapatillas', 'Mochila', 'Auriculares', 'Parlante', 'Celular', 'Tableta',
    'Teclado', 'Monitor', 'Colchon', 'Almohada', 'Sabanas', 'Cafetera', 'Tostadora', 'Hervidor', 'Bicicleta', 'Motocicleta', 'Cortina', 'Escritorio'];
  const mut = (w: string, i: number, tipo: 'borrar' | 'duplicar' | 'cambiar') => {
    if (tipo === 'borrar') return w.slice(0, i) + w.slice(i + 1);
    if (tipo === 'duplicar') return w.slice(0, i + 1) + w.slice(i);
    return w.slice(0, i) + (w[i] === 'x' ? 'k' : 'x') + w.slice(i + 1);
  };
  it('borrar o duplicar (6+ letras) y cambiar (7+ letras): casa consigo y no con las otras 29', () => {
    for (const tipo of ['borrar', 'duplicar', 'cambiar'] as const) {
      for (const n of NOMBRES) {
        const w = n.toLowerCase();
        if (w.length < (tipo === 'cambiar' ? 7 : 6)) continue;
        for (let i = 2; i < w.length - 2; i++) {
          const m = mut(w, i, tipo);
          expect(pt.ptNombra(m, n), `${tipo} ${n} -> ${m}`).toBe(true);
          for (const otro of NOMBRES) if (otro !== n) expect(pt.ptNombra(m, otro), `${m} vs ${otro}`).toBe(false);
        }
      }
    }
  });
});
