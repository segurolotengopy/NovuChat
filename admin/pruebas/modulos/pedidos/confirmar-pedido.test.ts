/**
 * EL BOTÓN «CONFIRMAR PEDIDO» (módulo común Pedidos, 23/11/2026): el id exacto, cuándo se ofrece y que la instrucción nunca se recorta.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CODIGO = readFileSync(join(RAIZ, 'Flujos/src/modulos/pedidos/confirmar-pedido.js'), 'utf8');
const M = runInNewContext(`${CODIGO}\n({ cfEsConfirmacion, cfSeOfrece, cfCuerpo, cfBoton, cfInstruccion, cfHuella });`) as {
  cfEsConfirmacion: (x: unknown, l: unknown) => boolean; cfSeOfrece: (n: number, c: boolean, q: boolean) => boolean;
  cfCuerpo: (c: unknown, u: boolean) => string; cfBoton: (l: unknown) => { id: string; title: string }; cfInstruccion: (u: boolean) => string; cfHuella: (l: unknown) => string;
};

describe('confirmar-pedido', () => {
  const C1 = [{ id: 'a', cantidad: 1, detalle: '' }];
  const C2 = [{ id: 'a', cantidad: 2, detalle: '' }];
  it('solo el id exacto CON LA HUELLA del carrito actual confirma; el título, otro id, vacío o el botón de OTRO carrito no', () => {
    expect(M.cfEsConfirmacion(M.cfBoton(C1).id, C1)).toBe(true);
    for (const no of ['Confirmar pedido', 'pedido:confirmar', 'pedido:confirmar:', 'otro', '', undefined, null, 1]) expect(M.cfEsConfirmacion(no, C1)).toBe(false);
    expect(M.cfEsConfirmacion(M.cfBoton(C1).id, C2)).toBe(false);   // el botón de un mensaje con otro carrito
    expect(M.cfEsConfirmacion(M.cfBoton(C1).id, [])).toBe(false);
  });
  it('la huella no depende del orden de las piezas y cambia con la cantidad o el detalle', () => {
    const AB = [{ id: 'a', cantidad: 1 }, { id: 'b', cantidad: 1 }];
    expect(M.cfHuella(AB)).toBe(M.cfHuella([...AB].reverse()));
    expect(M.cfHuella(C1)).not.toBe(M.cfHuella(C2));
    expect(M.cfHuella(C1)).not.toBe(M.cfHuella([{ id: 'a', cantidad: 1, detalle: 'rojo' }]));
  });
  it('el id y el título cumplen lo que WhatsApp acepta para un botón (id [a-z0-9:_-], título de 20 como máximo)', () => {
    const b = M.cfBoton(C1);
    expect(b.id).toMatch(/^[a-z0-9:_-]{1,200}$/);
    expect(b.title.length).toBeLessThanOrEqual(20);
  });
  it('se ofrece con piezas y entrega completa y SIN QR abierto; nunca en los otros casos', () => {
    expect(M.cfSeOfrece(1, true, false)).toBe(true);
    expect(M.cfSeOfrece(0, true, false)).toBe(false);
    expect(M.cfSeOfrece(2, false, false)).toBe(false);
    expect(M.cfSeOfrece(2, true, true)).toBe(false);
  });
  it('el cuerpo lleva la instrucción en tuteo o en usted y no pasa de 1.024; si es largo se recorta el texto, no la instrucción', () => {
    expect(M.cfCuerpo('Resumen', false)).toMatch(/toca «Confirmar pedido»\.$/);
    expect(M.cfCuerpo('Resumen', true)).toMatch(/toque «Confirmar pedido»\.$/);
    const largo = M.cfCuerpo('x'.repeat(3000), false);
    expect(largo.length).toBeLessThanOrEqual(1024);
    expect(largo.endsWith(M.cfInstruccion(false))).toBe(true);
    expect(M.cfCuerpo(M.cfInstruccion(true), true)).toBe(M.cfInstruccion(true));
    expect(M.cfCuerpo(undefined, false)).toBe(M.cfInstruccion(false));
  });
});
