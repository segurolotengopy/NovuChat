/**
 * LO QUE AGENDA APORTA AL CIERRE (`modulos/agenda/alCierre.ts`). NO NECESITA EMULADOR.
 *
 * El adaptador `SOLICITUD_AL_CIERRE.solicitudTrasElCierre(previa, ahoraMs, datos)`
 * tiene que dar EXACTAMENTE lo que daba la llamada que `registrarCierre` hacía
 * directo: `solicitudTras(previa, 'cita_agendada', ahoraMs, { cobroReal })`. Se
 * prueba sobre la misma rejilla de la equivalencia (todas las etapas previas y
 * sus bordes, todos los relojes) y con `cobroReal` en verdadero y en falso, y se
 * exige que la rejilla no sea una igualdad de nulos.
 */
import { describe, expect, it } from 'vitest';
import { SOLICITUD_AL_CIERRE } from '../../../functions/src/modulos/agenda/alCierre.ts';
import { solicitudTras } from '../../../functions/src/modulos/agenda/solicitud.ts';
import { PREVIAS, RELOJES } from './rejilla-solicitud.ts';

describe('SOLICITUD_AL_CIERRE es solicitudTras con el evento cita_agendada', () => {
  it('da lo mismo que la llamada directa sobre PREVIAS x RELOJES x cobroReal', () => {
    let casos = 0;
    let conSolicitud = 0;
    let sinSolicitud = 0;
    for (const [nombreP, previa] of Object.entries(PREVIAS)) {
      for (const [nombreR, ms] of Object.entries(RELOJES)) {
        for (const cobroReal of [true, false]) {
          const directo = solicitudTras(previa, 'cita_agendada', ms, { cobroReal });
          const porGancho = SOLICITUD_AL_CIERRE.solicitudTrasElCierre(previa, ms, { cobroReal });
          expect(porGancho, `${nombreP} @ ${nombreR} cobroReal=${cobroReal}`).toEqual(directo);
          casos += 1;
          if (directo === null) sinSolicitud += 1; else conSolicitud += 1;
        }
      }
    }
    expect(casos).toBeGreaterThan(1_500);
    expect(conSolicitud).toBeGreaterThan(300);
    expect(sinSolicitud).toBeGreaterThan(300);
  });

  it('con cobro real y un cobro de regla 2 a tiempo la solicitud no se mueve; con cobro simulado, sí', () => {
    const previa = PREVIAS['qr_enviado_regla2_a_tiempo'];
    const ahora = RELOJES['ahora'] as number;
    expect(SOLICITUD_AL_CIERRE.solicitudTrasElCierre(previa, ahora, { cobroReal: true })).toBeNull();
    expect(SOLICITUD_AL_CIERRE.solicitudTrasElCierre(previa, ahora, { cobroReal: false })).toMatchObject({ etapa: 'agendada' });
  });

  it('es un puerto de UNA función y no guarda estado entre llamadas', () => {
    expect(Object.keys(SOLICITUD_AL_CIERRE)).toEqual(['solicitudTrasElCierre']);
    const previa = PREVIAS['horarios_reciente'];
    const a = SOLICITUD_AL_CIERRE.solicitudTrasElCierre(previa, RELOJES['ahora'] as number, { cobroReal: false });
    const b = SOLICITUD_AL_CIERRE.solicitudTrasElCierre(previa, RELOJES['ahora'] as number, { cobroReal: false });
    expect(b).toEqual(a);
  });
});
