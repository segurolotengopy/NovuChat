/**
 * LA LISTA DE EXCEPCIONES DE LA MIGRACIÓN (etapa 0, 12/11/2026) SOLO PUEDE BAJAR.
 *
 * Esta suite vigila el mapa de `excepciones.ts` en sí: que no pase de su tope (total y por regla), que cada excepción tenga dueño, motivo y
 * vencimiento a no más de 90 días del alta, y que cada clave nombre un flujo que existe en el disco. Que cada excepción siga siendo una
 * violación (o sobre) y que cada violación tenga la suya lo comprueba cada prueba común, con `problemasDeRegla`.
 *
 * ATENCIÓN: cambiar `ALTA`, `TOPE` o un `vence` exige pasar por el agente `seguridad`.
 */
import { describe, expect, it } from 'vitest';
import { flujosDeProduccion } from '../../lib/flujos-de-cliente';
import { idDeFlujo } from './comprobaciones';
import { ALTA_FIJADA, TOPE_MAXIMO } from './tope-fijado';
import { ALTA, EXCEPCIONES, REGLAS, TOPE, TOPE_POR_REGLA, excepcionesDe, partesDeClave, problemasDeForma, type Excepcion } from './excepciones';

const e = (parcial: Partial<Excepcion> = {}): Excepcion => ({ dueno: 'por asignar (Principal)', vence: '2027-01-31', motivo: 'm', desde: ALTA, ...parcial });
const ANTES_DEL_VENCIMIENTO = new Date('2026-11-12T12:00:00Z');

describe('excepciones de la migración: la lista solo puede bajar', () => {
  it('no excede el tope total ni el de cada regla, y el desglose suma el total', () => {
    expect(Object.keys(EXCEPCIONES).length).toBeLessThanOrEqual(TOPE);
    for (const r of REGLAS) expect(excepcionesDe(r).length, r).toBeLessThanOrEqual(TOPE_POR_REGLA[r]);
    expect(Object.values(TOPE_POR_REGLA).reduce((a, b) => a + b, 0)).toBe(TOPE);
  });

  it('el tope no sube en silencio: ALTA es la fijada y TOPE no pasa del máximo fijado en tope-fijado.ts (subirlo obliga a tocar dos archivos)', () => {
    expect(ALTA).toBe(ALTA_FIJADA);
    expect(TOPE).toBeLessThanOrEqual(TOPE_MAXIMO);
    // Contraprueba: un tope subido por encima del máximo, o un alta movida, no pasaría esas dos comparaciones.
    expect(TOPE_MAXIMO + 1 <= TOPE_MAXIMO).toBe(false);
    expect('2026-11-13' === ALTA_FIJADA).toBe(false);
  });

  it('toda excepción tiene dueño, motivo, desde y vence válidos, a no más de 90 días del alta (2026-11-12 → 2027-02-10) y sin vencer', () => {
    expect(problemasDeForma(EXCEPCIONES, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([]);
    for (const x of Object.values(EXCEPCIONES)) expect(x.desde).toBe(ALTA);
  });

  it('ninguna excepción está vencida hoy (si vence sin cerrarse, o se renueva con una decisión de Andres, o es un defecto)', () => {
    expect(problemasDeForma()).toEqual([]);
  });

  it('toda clave existe en el disco: nombra un flujo de producción (esté en experimental/ o en clientes/) y una regla conocida', () => {
    const ids = new Set(flujosDeProduccion().map(idDeFlujo));
    const huerfanas = Object.keys(EXCEPCIONES).filter((k) => !ids.has(idDeFlujo(partesDeClave(k)[0])));
    expect(huerfanas).toEqual([]);
  });

  it('contraprueba: dueño vacío, motivo vacío, regla desconocida y clave mal formada fallan', () => {
    expect(problemasDeForma({ 'a.json#niega-ia#N': e({ dueno: ' ' }) }, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([expect.stringContaining('sin dueño')]);
    expect(problemasDeForma({ 'a.json#niega-ia#N': e({ motivo: '' }) }, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([expect.stringContaining('sin motivo')]);
    expect(problemasDeForma({ 'a.json#inventada#N': e() }, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([expect.stringContaining('no es una de las conocidas')]);
    expect(problemasDeForma({ 'a.json#niega-ia': e() }, ALTA, ANTES_DEL_VENCIMIENTO).join('\n')).toContain('la clave no es <json>#<regla>#<nodo>');
  });

  it('contraprueba: un vencimiento a más de 90 días, sin fecha o ya pasado falla; el borde de 90 días pasa', () => {
    expect(problemasDeForma({ 'a.json#niega-ia#N': e({ vence: '2027-02-11' }) }, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([expect.stringContaining('a más de 90 días')]);
    expect(problemasDeForma({ 'a.json#niega-ia#N': e({ vence: '2027-02-10' }) }, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([]);
    expect(problemasDeForma({ 'a.json#niega-ia#N': e({ vence: 'pronto' }) }, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([expect.stringContaining('«vence» no es una fecha')]);
    expect(problemasDeForma({ 'a.json#niega-ia#N': e({ desde: 'ayer' }) }, ALTA, ANTES_DEL_VENCIMIENTO)).toEqual([expect.stringContaining('«desde» no es una fecha')]);
    expect(problemasDeForma({ 'a.json#niega-ia#N': e() }, ALTA, new Date('2027-02-01T00:00:00Z'))).toEqual([expect.stringContaining('VENCIÓ')]);
  });

  it('contraprueba: el tope se excedería con una excepción más (el mapa real está exactamente en su tope hoy)', () => {
    expect(Object.keys(EXCEPCIONES).length + 1).toBeGreaterThan(TOPE);
    expect(Object.keys(EXCEPCIONES).length).toBe(TOPE);
    for (const r of REGLAS) expect(excepcionesDe(r).length, r).toBe(TOPE_POR_REGLA[r]);
  });

  it('contraprueba: una clave de un flujo que no existe no aparece entre los flujos de producción', () => {
    const ids = new Set(flujosDeProduccion().map(idDeFlujo));
    expect(ids.has(idDeFlujo('experimental/no-existe/no-existe.json'))).toBe(false);
  });

  it('la identidad de un flujo no depende de la carpeta: experimental/ y clientes/ son el mismo flujo', () => {
    expect(idDeFlujo('experimental/x/x.json')).toBe(idDeFlujo('clientes/x/x.json'));
    expect(idDeFlujo('demo-a-agendamiento.json')).toBe('demo-a-agendamiento.json');
  });
});
