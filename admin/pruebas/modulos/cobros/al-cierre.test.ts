/**
 * LO QUE COBROS APORTA AL CIERRE (`modulos/cobros/alCierre.ts`). NO NECESITA EMULADOR.
 *
 * Cuatro cosas, negando:
 *
 *  1. `cobroRealActivo` (el criterio que `registrarCierre` tenía escrito en su
 *     propio archivo): solo `activo === true` con ficha Y código no vacíos; todo
 *     lo demás —ausente, apagado, a medias, otro tipo— es falso.
 *  2. El adaptador del gancho lee EXACTAMENTE `config/venta` por el lector que le
 *     da Core, una sola vez, y pregunta por el campo `cobroReal`.
 *  3. LA VENTANA DE 24 H ES UNA SOLA. `solicitudDeCobroTras` (un comprobante
 *     tardío sigue siendo `tardio` hasta 24 h después del límite) y
 *     `cierreBloqueadoPorCobro` (un cierre de cita no mueve el cobro hasta ahí)
 *     usan la misma constante, `MS_VENTANA_DEL_CASO`: si una volviera a tener su
 *     copia y se desfasaran, un cierre aceptaría un caso que el cotejo ya dio por
 *     perdido. En L+24 h las dos dicen «sigue siendo este caso»; en L+24 h+1 ms,
 *     las dos dicen «es otra conversación».
 *  4. El gancho es el que `ganchos.ts` entrega, no una copia: el predicado del
 *     cotejo NO es el de «bloqueado» (dos funciones con la misma firma que no se
 *     deben intercambiar).
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  COBRO_AL_CIERRE, cierreBloqueadoPorCobro, cierreDeVentaLoHaceElCotejo, cobroDosCerrado, cobroRealActivo,
} from '../../../functions/src/modulos/cobros/alCierre.ts';
import {
  MINUTOS_QR_VENTA, MS_VENTANA_DEL_CASO, limiteDe, solicitudDeCobroTras, type EventoDeCobro,
} from '../../../functions/src/modulos/cobros/cobroVenta.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 15, 0);

describe('cobroRealActivo: solo activo con ficha y código', () => {
  it.each([
    ['completo', { activo: true, ficha: 'f1', cargaUtil: 'c1' }, true],
    ['activo con ficha y código de texto', { activo: true, ficha: 'F', cargaUtil: 'X' }, true],
    ['ficha como número', { activo: true, ficha: 7, cargaUtil: 'c1' }, true],
    ['apagado', { activo: false, ficha: 'f1', cargaUtil: 'c1' }, false],
    ['activo como texto', { activo: 'true', ficha: 'f1', cargaUtil: 'c1' }, false],
    ['activo como 1', { activo: 1, ficha: 'f1', cargaUtil: 'c1' }, false],
    ['sin ficha', { activo: true, cargaUtil: 'c1' }, false],
    ['ficha vacía', { activo: true, ficha: '', cargaUtil: 'c1' }, false],
    ['sin código', { activo: true, ficha: 'f1' }, false],
    ['código vacío', { activo: true, ficha: 'f1', cargaUtil: '' }, false],
    ['ficha nula', { activo: true, ficha: null, cargaUtil: 'c1' }, false],
    ['objeto vacío', {}, false],
    ['ausente', undefined, false],
    ['nulo', null, false],
    ['un texto', 'cobro', false],
    ['un número', 5, false],
  ])('%s -> %s', (_n, valor, esperado) => {
    expect(cobroRealActivo(valor)).toBe(esperado);
  });
});

describe('el gancho de Cobros lee config/venta por el lector de Core', () => {
  it('pide EXACTAMENTE `config/venta`, una sola vez, y mira el campo `cobroReal`', async () => {
    const pedidas: string[] = [];
    const campos: string[] = [];
    const leer = async (ruta: string) => {
      pedidas.push(ruta);
      return {
        get: (campo: string) => { campos.push(campo); return { activo: true, ficha: 'f', cargaUtil: 'c' }; },
      } as unknown as FirebaseFirestore.DocumentSnapshot;
    };
    expect(await COBRO_AL_CIERRE.cobroRealActivo(leer)).toBe(true);
    expect(pedidas).toEqual(['config/venta']);
    expect(campos).toEqual(['cobroReal']);
  });

  it('con un documento sin cobro real, o sin documento, da falso', async () => {
    const sin = async () => ({ get: () => undefined }) as unknown as FirebaseFirestore.DocumentSnapshot;
    const apagado = async () => ({ get: () => ({ activo: false, ficha: 'f', cargaUtil: 'c' }) }) as unknown as FirebaseFirestore.DocumentSnapshot;
    expect(await COBRO_AL_CIERRE.cobroRealActivo(sin)).toBe(false);
    expect(await COBRO_AL_CIERRE.cobroRealActivo(apagado)).toBe(false);
  });

  it('un error del lector llega a Core (no se traga): la transacción se reintenta o falla, no sigue como si nada', async () => {
    await expect(COBRO_AL_CIERRE.cobroRealActivo(async () => { throw new Error('lectura rota'); })).rejects.toThrow('lectura rota');
  });

  it('el gancho entrega las funciones de este módulo, y el predicado del cotejo NO es el de «bloqueado»', () => {
    expect(COBRO_AL_CIERRE.cierreDeVentaLoHaceElCotejo).toBe(cierreDeVentaLoHaceElCotejo);
    expect(COBRO_AL_CIERRE.cierreDeVentaLoHaceElCotejo).not.toBe(cierreBloqueadoPorCobro);
  });
});

describe('La ventana de 24 h es UNA: la del comprobante tardío y la del cierre coinciden al milisegundo', () => {
  /** Un cobro de regla 2 con el QR enviado en T0, sin prórroga: su límite efectivo es T0 + 15 min. */
  const abierta = () => {
    const t = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'wamid.qr' }, T0);
    return {
      etapa: 'qr_enviado', desde: Timestamp.fromMillis(T0), qrEnviadoEn: Timestamp.fromMillis(T0),
      evento: { id: 'wamid.qr', calendario: '' }, cotejos: 0, monto: 100, ...(t.cambios ?? {}),
    } as Record<string, unknown>;
  };
  const valido: EventoDeCobro = { tipo: 'comprobante', estado: 'valido', motivo: 'ok', idMeta: 'c1', ruta: null };

  it('las constantes: 24 h en milisegundos y 1.440 minutos', () => {
    expect(MS_VENTANA_DEL_CASO).toBe(86_400_000);
    expect(MINUTOS_QR_VENTA).toBe(MS_VENTANA_DEL_CASO / MIN);
  });

  it('en L + 24 h: el cierre sigue bloqueado y el comprobante es `tardio`', () => {
    const s = abierta();
    const L = limiteDe(s) as number;
    expect(L).toBe(T0 + 15 * MIN);
    expect(cobroDosCerrado(s, L + MS_VENTANA_DEL_CASO)).toBe(true);
    expect(cierreBloqueadoPorCobro(s, L + MS_VENTANA_DEL_CASO)).toBe(true);
    expect(solicitudDeCobroTras(s, valido, L + MS_VENTANA_DEL_CASO).efecto).toBe('tardio');
  });

  it('en L + 24 h + 1 ms: ya es otra conversación en los dos: el cierre no bloquea y el comprobante es `sin_cobro`', () => {
    const s = abierta();
    const L = limiteDe(s) as number;
    expect(cierreBloqueadoPorCobro(s, L + MS_VENTANA_DEL_CASO + 1)).toBe(false);
    expect(solicitudDeCobroTras(s, valido, L + MS_VENTANA_DEL_CASO + 1).efecto).toBe('sin_cobro');
  });

  it('un ms ANTES del límite el cobro está a tiempo: no está bloqueado, y lo cierra el cotejo', () => {
    const s = abierta();
    const L = limiteDe(s) as number;
    expect(cierreBloqueadoPorCobro(s, L - 1)).toBe(false);
    expect(cierreDeVentaLoHaceElCotejo(s, L - 1)).toBe(true);
  });

  it('en revisión bloquea siempre, también pasadas 24 h (lo resuelve una persona)', () => {
    const s = { ...abierta(), etapa: 'en_revision' };
    const L = limiteDe(s) as number;
    expect(cierreBloqueadoPorCobro(s, L + 30 * MS_VENTANA_DEL_CASO)).toBe(true);
  });
});
