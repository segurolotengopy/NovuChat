/**
 * Pruebas del mini inventario y del preproceso de fotos. NO NECESITAN EMULADOR.
 *
 * LO QUE MÁS IMPORTA ACÁ es la diferencia entre «no sé cuántos hay» y «hay
 * cero». Todo el catálogo que existe hoy está en el primer caso, así que
 * confundirlos dejaría a cada comercio con el catálogo entero marcado como
 * agotado el día del despliegue, y al asistente diciendo que no tiene nada.
 */
import { describe, expect, it } from 'vitest';
import {
  controlaStock, existencias, hayParaVender, idMovimiento,
} from '../functions/src/inventario.ts';
import { bytesDeDataUrl, medidaDestino, tipoDeDataUrl } from '../web/src/lib/foto.ts';

describe('«No sé cuántos hay» NO es «hay cero»', () => {
  it('un ítem sin el campo no lleva control, y siempre se puede vender', () => {
    const item = { nombre: 'Corte de pelo' };
    expect(controlaStock(item)).toBe(false);
    expect(existencias(item)).toBeNull();
    expect(hayParaVender(item)).toBe(true);
    expect(hayParaVender(item, 999)).toBe(true);
  });
  it('un ítem en cero SÍ lleva control, y no se puede vender', () => {
    const item = { nombre: 'Torta', stock: 0 };
    expect(controlaStock(item)).toBe(true);
    expect(existencias(item)).toBe(0);
    expect(hayParaVender(item)).toBe(false);
  });
  it('alcanza para lo que hay, y no para más', () => {
    const item = { stock: 3 };
    expect(hayParaVender(item, 3)).toBe(true);
    expect(hayParaVender(item, 4)).toBe(false);
  });
  it('un `stock` que no es un número no cuenta como control', () => {
    for (const malo of ['5', null, undefined, NaN, Infinity, {}, []]) {
      expect(controlaStock({ stock: malo })).toBe(false);
    }
  });
  it('un stock negativo o fraccionario se lee como lo que se puede vender', () => {
    expect(existencias({ stock: -4 })).toBe(0);
    expect(existencias({ stock: 2.7 })).toBe(2);
  });
});

describe('El identificador del movimiento hace idempotente el descuento', () => {
  it('la misma venta del mismo ítem da el mismo identificador', () => {
    expect(idMovimiento('ped_123', 'pizza')).toBe(idMovimiento('ped_123', 'pizza'));
  });
  it('ventas distintas del mismo ítem NO chocan', () => {
    expect(idMovimiento('ped_123', 'pizza')).not.toBe(idMovimiento('ped_124', 'pizza'));
  });
  it('ítems distintos del mismo pedido NO chocan', () => {
    expect(idMovimiento('ped_123', 'pizza')).not.toBe(idMovimiento('ped_123', 'empanada'));
  });
  it('lo que no sirve en una ruta de Firestore se reemplaza', () => {
    expect(idMovimiento('ped/1', 'a b')).not.toContain('/');
    expect(idMovimiento('ped/1', 'a b')).not.toContain(' ');
  });
});

describe('Preproceso de la foto: encoge, nunca agranda', () => {
  it('una foto de teléfono baja al lado máximo, guardando la proporción', () => {
    expect(medidaDestino(4032, 3024, 900)).toEqual({ ancho: 900, alto: 675 });
    expect(medidaDestino(3024, 4032, 900)).toEqual({ ancho: 675, alto: 900 });
  });
  it('una imagen ya chica se deja como está: reescalar hacia arriba solo la empeora', () => {
    expect(medidaDestino(320, 240, 900)).toEqual({ ancho: 320, alto: 240 });
  });
  it('una imagen larguísima no colapsa a cero', () => {
    const m = medidaDestino(10000, 3, 900);
    expect(m.ancho).toBe(900);
    expect(m.alto).toBeGreaterThanOrEqual(1);
  });
});

describe('Medir un data URL sin decodificarlo', () => {
  it('cuenta los bytes reales, descontando el relleno', () => {
    // 'hola' -> 'aG9sYQ==' : 4 bytes, con dos signos de relleno.
    expect(bytesDeDataUrl('data:image/webp;base64,aG9sYQ==')).toBe(4);
    expect(bytesDeDataUrl('data:image/webp;base64,aG9sYQ')).toBe(4);
  });
  it('lo que no es un data URL vale cero y no revienta', () => {
    expect(bytesDeDataUrl('')).toBe(0);
    expect(bytesDeDataUrl('https://ejemplo.bo/a.png')).toBe(0);
  });
  it('lee el tipo QUE DEVOLVIÓ el lienzo, no el que se le pidió', () => {
    expect(tipoDeDataUrl('data:image/png;base64,AAAA')).toBe('image/png');
    expect(tipoDeDataUrl('data:image/webp;base64,AAAA')).toBe('image/webp');
    expect(tipoDeDataUrl('cualquier cosa')).toBe('');
  });
});
