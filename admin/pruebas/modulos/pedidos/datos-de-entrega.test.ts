/**
 * LOS DATOS DE ENVÍO QUE EL CLIENTE YA DIO NO SE VUELVEN A PEDIR (módulo común Pedidos, 23/11/2026; reclamo de Casa Bermejo).
 * El 23/11 el cliente escribió «Andres 1234567 yacuiba. Flota bolivar» y el asistente siguió pidiendo el CI y la ciudad. Se prueba NEGANDO:
 * un celular, un precio, una respuesta cualquiera o un dato ya guardado no se toman por CI ni por ciudad, y el retiro en tienda no entra aquí.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CODIGO = readFileSync(join(RAIZ, 'Flujos/src/modulos/pedidos/datos-de-entrega.js'), 'utf8');
type Datos = { documento?: string; nombre?: string; ciudad?: string };
const M = runInNewContext(`${CODIGO}\n({ entCapturar });`) as { entCapturar: (t: unknown, s: unknown, m: string) => Datos };
const SABEN = { nombre: 'Ana Pérez', documento: '1234567', ciudad: 'Oruro', flota: 'Bolivar' };

describe('entCapturar', () => {
  it('el mensaje del reclamo: nombre, CI sin la palabra «CI» y ciudad en minúsculas, en UN mensaje', () => {
    expect(M.entCapturar('Andres 1234567 yacuiba. Flota bolivar', {}, 'BO')).toEqual({ documento: '1234567', nombre: 'Andres', ciudad: 'Yacuiba' });
    expect(M.entCapturar('Juan Pérez 4567890-1A Santa Cruz, flota Copacabana', {}, 'BO')).toEqual({ documento: '4567890-1A', nombre: 'Juan Pérez', ciudad: 'Santa Cruz' });
  });
  it('el CI solo, y la ciudad sola cuando es lo único que falta', () => {
    expect(M.entCapturar('1234567', { nombre: 'Ana' }, 'BO')).toEqual({ documento: '1234567' });
    expect(M.entCapturar('yacuiba', { ...SABEN, ciudad: '' }, 'BO')).toEqual({ ciudad: 'Yacuiba' });
    expect(M.entCapturar('Santa Cruz', { ...SABEN, ciudad: '' }, 'BO')).toEqual({ ciudad: 'Santa Cruz' });
  });
  it('NEGADO: lo que ya se sabe no se pisa', () => {
    expect(M.entCapturar('Pedro 7654321 Potosí', SABEN, 'BO')).toEqual({});
    expect(M.entCapturar('Pedro 7654321 Potosí', { ...SABEN, documento: '' }, 'BO')).toEqual({ documento: '7654321' });
  });
  it('NEGADO: un celular, un precio, un código o dos cifras no son el CI', () => {
    for (const t of ['mi celular es 70123456', 'llámeme al 60123456', '+591 71234567', 'Bs 123456', 'cód. 123456', 'son 1234567 y 7654321']) expect(M.entCapturar(t, {}, 'BO').documento).toBeUndefined();
  });
  it('NEGADO: respuestas que no son una ciudad (sí, no, gracias, ya te lo di, frases con cifras, más de tres palabras)', () => {
    for (const t of ['sí', 'no', 'gracias', 'Ya te lo di', 'quiero hablar con una persona', 'ok listo', 'la flota es Bolivar', 'Santa Cruz 3', 'a b c d e']) expect(M.entCapturar(t, { ...SABEN, ciudad: '' }, 'BO').ciudad).toBeUndefined();
  });
  it('NEGADO: la ciudad sola no se toma si falta otra cosa (nombre, CI o flota): sería adivinar', () => {
    expect(M.entCapturar('yacuiba', { ...SABEN, ciudad: '', flota: '' }, 'BO')).toEqual({});
    expect(M.entCapturar('yacuiba', { ...SABEN, ciudad: '', documento: '' }, 'BO')).toEqual({});
  });
  it('Argentina: solo el DNI (7 u 8 dígitos); nunca nombre ni ciudad por estructura, y un número de 8 dígitos con 6 o 7 al inicio SÍ es un DNI posible', () => {
    expect(M.entCapturar('12345678', {}, 'AR')).toEqual({ documento: '12345678' });
    expect(M.entCapturar('Ana 12345678 Rosario', {}, 'AR')).toEqual({ documento: '12345678' });
  });
  it('entradas raras no rompen', () => {
    for (const t of [undefined, null, '', 42, 'x'.repeat(400)]) expect(M.entCapturar(t, null, 'BO')).toEqual({});
  });
});
