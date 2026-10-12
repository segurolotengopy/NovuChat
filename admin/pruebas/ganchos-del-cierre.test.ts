/**
 * LOS GANCHOS DEL CIERRE ESTÁN CABLEADOS A LAS FUNCIONES CORRECTAS. NO NECESITA EMULADOR.
 *
 * Lo que el compilador no ve: `cierreBloqueadoPorCobro` y
 * `cierreDeVentaLoHaceElCotejo` tienen la MISMA firma (`(previa, ahoraMs) =>
 * boolean`), así que intercambiarlas en `alCierre.ts` o en `ganchos.ts`
 * compila, pasa los tipos y cambia qué cierres acepta el servidor: con cobro real,
 * una venta que debe cerrar el cotejo la cerraría el endpoint (un cierre
 * duplicado), o al revés. Estas igualdades por identidad atrapan ese
 * intercambio, y las pruebas de comportamiento (`cobro-v2-ingesta`,
 * `cobro-venta`) atrapan lo que haga cada una.
 */
import { describe, expect, it } from 'vitest';
import { GANCHOS_DEL_CIERRE } from '../functions/src/ganchos.ts';
import { SOLICITUD_AL_CIERRE } from '../functions/src/modulos/agenda/alCierre.ts';
import {
  COBRO_AL_CIERRE, cierreBloqueadoPorCobro, cierreDeVentaLoHaceElCotejo,
} from '../functions/src/modulos/cobros/alCierre.ts';

describe('GANCHOS_DEL_CIERRE entrega el gancho de cada módulo, no una copia ni otra función', () => {
  it('el puerto de cobro es el de Cobros y el de solicitud es el de Agenda (misma referencia)', () => {
    expect(GANCHOS_DEL_CIERRE.cobro).toBe(COBRO_AL_CIERRE);
    expect(GANCHOS_DEL_CIERRE.solicitud).toBe(SOLICITUD_AL_CIERRE);
  });

  it('el predicado del cotejo es `cierreDeVentaLoHaceElCotejo`, y NO `cierreBloqueadoPorCobro` (misma firma, otra decisión)', () => {
    expect(COBRO_AL_CIERRE.cierreDeVentaLoHaceElCotejo).toBe(cierreDeVentaLoHaceElCotejo);
    expect(COBRO_AL_CIERRE.cierreDeVentaLoHaceElCotejo).not.toBe(cierreBloqueadoPorCobro);
  });

  it('el contrato tiene exactamente dos puertos con las funciones que Core espera, y nada más', () => {
    expect(Object.keys(GANCHOS_DEL_CIERRE).sort()).toEqual(['cobro', 'solicitud']);
    expect(Object.keys(GANCHOS_DEL_CIERRE.cobro).sort()).toEqual(['cierreDeVentaLoHaceElCotejo', 'cobroRealActivo']);
    expect(Object.keys(GANCHOS_DEL_CIERRE.solicitud)).toEqual(['solicitudTrasElCierre']);
    for (const puerto of [GANCHOS_DEL_CIERRE.cobro, GANCHOS_DEL_CIERRE.solicitud]) {
      for (const f of Object.values(puerto)) expect(typeof f).toBe('function');
    }
  });
});
