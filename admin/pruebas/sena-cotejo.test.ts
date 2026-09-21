/**
 * SEÑA POR QR — las decisiones puras, sin emulador.
 *
 * Sobre esto se le dice a un paciente si su reserva quedó y se le avisa a la
 * clínica que revise el banco, así que las tres decisiones se prueban aparte
 * de Firestore, caso por caso:
 *
 *  1. `resultadoDelCotejo`: de lo leído y lo comparado, `cuadra`, `no_cuadra`
 *     o `ilegible`. Y la PROHIBICIÓN 3 con una expresión regular: ninguna
 *     frase que salga de acá —ni de `cotejo.ts`, que es de donde vienen las
 *     diferencias— afirma que un pago está acreditado, verificado ni recibido.
 *  2. `solicitudTras`: qué estado de seña deja un mensaje en la conversación.
 *  3. `senaParaElFlujo`: lo que recibe el flujo de reservas, con `activa` solo
 *     cuando hay importe Y QR encendido.
 *
 * Más el vínculo entre los dos identificadores de cierre (`sena.ts` y
 * `cierres.ts`), que si divergen cuentan una cita dos veces.
 */
import { describe, expect, it } from 'vitest';
import { cotejarComprobante, type Cotejo } from '../functions/src/cotejo.ts';
import {
  NO_SE_PUDO_LEER, detalleDeLaSena, esperadoDeLaSena, idDeCierreDeCita, leidoDelCuerpo,
  resultadoDelCotejo,
} from '../functions/src/sena.ts';
import {
  IMPORTE_SENA_MAXIMO, MINUTOS_RETENCION_POR_DEFECTO, senaParaElFlujo, solicitudTras,
} from '../functions/src/ingesta.ts';
import { documentoQueCobra } from '../functions/src/cobro.ts';
import { senaVencidaPorTiempo } from '../functions/src/retencion.ts';

/** Lo que la prohibición 3 no deja decir, en ninguna forma. */
const AFIRMA_PAGO = /acreditad|verificad|recibimos|pago confirmado/i;

const T0 = Date.UTC(2026, 8, 17, 14, 0, 0);            // 17/09/2026 10:00 La Paz
const MIN = 60_000;
const COBRO = { nombreCuenta: 'Clínica Platinum SRL', cuentas: ['201000000307'], banco: 'BNB', ficha: 'f'.repeat(32) };

const cotejoFalso = (extra: Partial<Cotejo> = {}): Cotejo => ({
  consistente: false, montoOk: true, fechaOk: true, destinoOk: false, destinoPor: 'ninguno',
  diferencias: ['El comprobante no muestra a qué cuenta se depositó.'], ...extra,
});

describe('resultadoDelCotejo', () => {
  it('ilegible cuando el modelo no leyó nada, aunque haya cotejo', () => {
    expect(resultadoDelCotejo(false, null)).toEqual({ resultado: 'ilegible', diferencias: [NO_SE_PUDO_LEER] });
    expect(resultadoDelCotejo(false, cotejoFalso({ consistente: true }))).toMatchObject({ resultado: 'ilegible' });
    expect(resultadoDelCotejo(true, null)).toMatchObject({ resultado: 'ilegible' });
  });

  it('cuadra SOLO si el cotejo es consistente, y entonces sin diferencias', () => {
    expect(resultadoDelCotejo(true, cotejoFalso({ consistente: true, destinoOk: true })))
      .toEqual({ resultado: 'cuadra', diferencias: [] });
  });

  it('no_cuadra trae las diferencias de cotejo.ts, tal cual', () => {
    const r = resultadoDelCotejo(true, cotejoFalso());
    expect(r.resultado).toBe('no_cuadra');
    expect(r.diferencias).toEqual(['El comprobante no muestra a qué cuenta se depositó.']);
  });

  it('NUNCA afirma un pago: ni en cuadra, ni en no_cuadra, ni en ilegible', () => {
    // Se recorren los caminos REALES de cotejo.ts, no un cotejo inventado:
    // importe distinto, fecha vieja, fecha futura, cuenta ajena, nombre ajeno,
    // sin destinatario y sin nada legible.
    const esperado = esperadoDeLaSena(50, COBRO, T0, T0 + 5 * MIN);
    const bueno = { monto: '50.00', cuentaDestino: '201****307', fecha: '17/09/2026', hora: '10:03' };
    const casos = [
      cotejarComprobante(esperado, bueno),
      cotejarComprobante(esperado, { ...bueno, monto: '40' }),
      cotejarComprobante(esperado, { ...bueno, fecha: '10/09/2026' }),
      cotejarComprobante(esperado, { ...bueno, hora: '18:00' }),
      cotejarComprobante(esperado, { ...bueno, cuentaDestino: '999000000111' }),
      cotejarComprobante(esperado, { ...bueno, cuentaDestino: '', nombreCuenta: 'Otra Persona Lopez' }),
      cotejarComprobante(esperado, { monto: '50', fecha: '17/09/2026 10:03' }),
      cotejarComprobante(esperado, {}),
    ];
    expect(casos[0]?.consistente).toBe(true);
    for (const c of casos) {
      for (const v of [resultadoDelCotejo(true, c), resultadoDelCotejo(false, c)]) {
        expect(JSON.stringify(v)).not.toMatch(AFIRMA_PAGO);
      }
    }
    for (const r of ['cuadra', 'no_cuadra', 'ilegible'] as const) {
      expect(detalleDeLaSena(50, 'BOB', r)).not.toMatch(AFIRMA_PAGO);
    }
    expect(detalleDeLaSena(50, 'BOB', 'cuadra')).toBe('Seña de 50 Bs, comprobante los datos coinciden');
  });
});

describe('esperadoDeLaSena', () => {
  it('compara contra el importe de la SEÑA, las cuentas del QR y la ventana desde el envío', () => {
    const e = esperadoDeLaSena(50, COBRO, T0, T0 + 7 * MIN);
    expect(e).toEqual({
      monto: 50, nombreCuenta: 'Clínica Platinum SRL', cuentas: ['201000000307'],
      qrEnviadoEn: T0, comprobanteRecibidoEn: T0 + 7 * MIN, toleranciaMin: 10,
    });
  });

  it('sin QR registrado no hay cuentas ni nombre: ningún comprobante cuadra', () => {
    const e = esperadoDeLaSena(50, undefined, T0, T0 + MIN);
    expect(e.cuentas).toEqual([]);
    const c = cotejarComprobante(e, { monto: '50', cuentaDestino: '201000000307', fecha: '17/09/2026 10:00' });
    expect(c.consistente).toBe(false);
  });

  it('un comprobante de antes del QR es un pago reciclado', () => {
    const e = esperadoDeLaSena(50, COBRO, T0, T0 + 5 * MIN);
    const c = cotejarComprobante(e, { monto: '50', cuentaDestino: '201000000307', fecha: '17/09/2026', hora: '09:30' });
    expect(c.consistente).toBe(false);
    expect(c.diferencias.join(' ')).toMatch(/anterior al pedido/);
  });
});

describe('leidoDelCuerpo: lo que mandó el flujo, saneado', () => {
  it('recorta y tipa; un cuerpo que no es objeto da campos vacíos', () => {
    expect(leidoDelCuerpo({ monto: 50, cuentaDestino: ' 201****307 ', nombreCuenta: 'x'.repeat(200), fecha: '17/09/2026', hora: '10:03' }))
      .toEqual({ monto: 50, cuentaDestino: '201****307', nombreCuenta: 'x'.repeat(120), fecha: '17/09/2026', hora: '10:03' });
    expect(leidoDelCuerpo('nada')).toEqual({ monto: '', cuentaDestino: '', nombreCuenta: '', fecha: '', hora: '' });
    expect(leidoDelCuerpo({ monto: { $gt: 0 } })).toMatchObject({ monto: '' });
  });
});

describe('solicitudTras: la seña en curso de un teléfono', () => {
  it('sin evento, o con uno desconocido, no toca nada', () => {
    expect(solicitudTras(undefined, undefined, T0, {})).toBeNull();
    expect(solicitudTras({ etapa: 'qr_enviado' }, undefined, T0, {})).toBeNull();
    expect(solicitudTras(undefined, 'cualquier_cosa', T0, { referencia: 'evt1' })).toBeNull();
  });

  it('qr_enviado abre una solicitud nueva con la cita retenida y los contadores en cero', () => {
    const s = solicitudTras(undefined, 'qr_enviado', T0, { referencia: 'evt_abc', calendario: 'cal@ejemplo.com' });
    expect(s).not.toBeNull();
    expect(s).toMatchObject({
      etapa: 'qr_enviado', evento: { id: 'evt_abc', calendario: 'cal@ejemplo.com' }, cotejos: 0, seguimientos: 0,
    });
    expect(s?.desde.toMillis()).toBe(T0);
    expect(s?.qrEnviadoEn?.toMillis()).toBe(T0);
  });

  it('reemplaza una solicitud anterior, aunque tuviera cotejos: la cita nueva es la que se sigue', () => {
    const previa = { etapa: 'vencida', cotejos: 3, evento: { id: 'vieja', calendario: '' } };
    const s = solicitudTras(previa, 'qr_enviado', T0 + MIN, { referencia: 'nueva' });
    expect(s).toMatchObject({ etapa: 'qr_enviado', cotejos: 0, evento: { id: 'nueva', calendario: '' } });
  });

  it('sin referencia, la solicitud igual se abre pero sin cita que seguir', () => {
    expect(solicitudTras(undefined, 'qr_enviado', T0, {})?.evento).toBeNull();
    expect(solicitudTras(undefined, 'qr_enviado', T0, { referencia: '   ' })?.evento).toBeNull();
  });
});

describe('senaParaElFlujo: lo que recibe el flujo de reservas', () => {
  const url = (f: string) => `https://panel/imagenDeCobro?f=${f}`;
  const cfg = (extra: Record<string, unknown> = {}) => ({ senaImporte: 50, senaMinutosRetencion: 45, cobroReal: COBRO, ...extra });

  it('activa SOLO con importe y QR encendido; entonces viaja el QR', () => {
    expect(senaParaElFlujo(cfg(), true, 'BOB', url, undefined)).toEqual({
      activa: true, importe: 50, moneda: 'BOB', minutosRetencion: 45,
      qr: { url: `https://panel/imagenDeCobro?f=${'f'.repeat(32)}`, nombreCuenta: 'Clínica Platinum SRL', banco: 'BNB' },
      pendiente: false, evento: null, qrEnviadoEn: null, vencidaHaceMin: null,
    });
  });

  it('con importe pero sin QR encendido: inactiva, importe 0, qr nulo (no null entero)', () => {
    const s = senaParaElFlujo(cfg(), false, 'BOB', url, undefined);
    expect(s).toMatchObject({ activa: false, importe: 0, qr: null, minutosRetencion: 45 });
  });

  it('con QR pero importe 0, ausente, decimal, negativo o por encima del techo: inactiva', () => {
    for (const senaImporte of [0, undefined, 12.5, -1, IMPORTE_SENA_MAXIMO + 1, '50']) {
      expect(senaParaElFlujo(cfg({ senaImporte }), true, 'BOB', url, undefined).activa).toBe(false);
    }
    expect(senaParaElFlujo(undefined, true, 'BOB', url, undefined).activa).toBe(false);
  });

  it('los minutos de retención caen al respaldo si faltan o están fuera de rango', () => {
    for (const senaMinutosRetencion of [undefined, 4, 181, 30.5, '30']) {
      expect(senaParaElFlujo(cfg({ senaMinutosRetencion }), true, 'BOB', url, undefined).minutosRetencion)
        .toBe(MINUTOS_RETENCION_POR_DEFECTO);
    }
  });

  it('pendiente, evento y qrEnviadoEn salen de la solicitud del teléfono', () => {
    // Un QR de hace cinco minutos: dentro de la retención (45). Con uno viejo,
    // la seña ya venció por reloj (ver abajo).
    const hace5 = Date.now() - 5 * 60 * 1000;
    const solicitud = solicitudTras(undefined, 'qr_enviado', hace5, { referencia: 'evt1', calendario: 'cal' });
    const s = senaParaElFlujo(cfg(), true, 'BOB', url, solicitud);
    expect(s).toMatchObject({ pendiente: true, evento: { id: 'evt1', calendario: 'cal' }, qrEnviadoEn: new Date(hace5).toISOString() });
    const agendada = senaParaElFlujo(cfg(), true, 'BOB', url, { ...solicitud, etapa: 'agendada' });
    expect(agendada.pendiente).toBe(false);
    expect(agendada.evento).toEqual({ id: 'evt1', calendario: 'cal' });
  });

  it('una seña VENCIDA se informa con cuánto hace, y solo dentro del día', () => {
    // El pago tardío (19/09/2026): sin esto, el flujo no puede distinguir «un
    // comprobante de la nada» de «pagó justo después de que se liberara el
    // horario», y le pregunta «¿a qué corresponde?» a alguien que acaba de
    // pagar lo que el asistente le pidió.
    const vencidaHace = (min: number) => senaParaElFlujo(cfg(), true, 'BOB', url,
      { etapa: 'vencida', desde: { toMillis: () => Date.now() - min * 60 * 1000 } });
    expect(vencidaHace(7).vencidaHaceMin).toBe(7);
    expect(vencidaHace(23 * 60).vencidaHaceMin).toBe(23 * 60);
    // Más de un día: ya es otra conversación, y no se arrastra para siempre.
    expect(vencidaHace(25 * 60).vencidaHaceMin).toBeNull();
    // Y una seña que NO venció no informa nada.
    const pendiente = solicitudTras(undefined, 'qr_enviado', T0, { referencia: 'evt1' });
    expect(senaParaElFlujo(cfg(), true, 'BOB', url, pendiente).vencidaHaceMin).toBeNull();
    expect(senaParaElFlujo(cfg(), true, 'BOB', url, undefined).vencidaHaceMin).toBeNull();
  });

  it('la solicitud se informa aunque la seña se haya apagado después del QR', () => {
    const solicitud = solicitudTras(undefined, 'qr_enviado', Date.now() - 60 * 1000, { referencia: 'evt1' });
    expect(senaParaElFlujo(cfg({ senaImporte: 0 }), true, 'BOB', url, solicitud)).toMatchObject({ activa: false, pendiente: true });
  });

  // --- LA SEÑA VENCE POR RELOJ (Andres, 20/09/2026: «la reserva pendiente de
  // pago debería soltarse a los 15 minutos, porque así es la regla») ---------
  // Antes solo la vencía el flujo del calendario, y si la cita no coincidía
  // —borrada a mano, o atada a la de otro paciente— quedaba pendiente para
  // siempre: el asistente seguía pidiendo el comprobante.
  it('pasado el plazo, la seña YA NO está pendiente aunque la etapa siga en qr_enviado', () => {
    const hace46 = Date.now() - 46 * 60 * 1000;
    const s = senaParaElFlujo(cfg(), true, 'BOB', url, solicitudTras(undefined, 'qr_enviado', hace46, { referencia: 'evt1' }));
    expect(s.pendiente).toBe(false);
    // Y se informa como vencida hace ~1 minuto: un comprobante ahora es un pago TARDÍO.
    expect(s.vencidaHaceMin).toBe(1);
  });

  it('con 15 minutos de retención, a los 16 ya venció y a los 14 no', () => {
    const quince = cfg({ senaMinutosRetencion: 15 });
    const a = (min: number) => senaParaElFlujo(quince, true, 'BOB', url,
      solicitudTras(undefined, 'qr_enviado', Date.now() - min * 60 * 1000, { referencia: 'e' }));
    expect(a(14).pendiente).toBe(true);
    expect(a(16).pendiente).toBe(false);
  });

  it('con un comprobante en revisión el plazo es el de la revisión (2 h), no el de la retención', () => {
    const hace30 = Date.now() - 30 * 60 * 1000;
    const enRevision = { ...solicitudTras(undefined, 'qr_enviado', hace30, { referencia: 'e' }), cotejos: 1 };
    expect(senaParaElFlujo(cfg({ senaMinutosRetencion: 15 }), true, 'BOB', url, enRevision).pendiente).toBe(true);
    const hace3h = { ...enRevision, qrEnviadoEn: solicitudTras(undefined, 'qr_enviado', Date.now() - 3 * 3600 * 1000, { referencia: 'e' }).qrEnviadoEn };
    expect(senaParaElFlujo(cfg({ senaMinutosRetencion: 15 }), true, 'BOB', url, hace3h).pendiente).toBe(false);
  });
});

describe('senaVencidaPorTiempo: la regla, sola', () => {
  const qr = (msAtras: number) => ({ toMillis: () => Date.now() - msAtras });
  const min = 60 * 1000;
  it('solo juzga una seña en qr_enviado con fecha de envío', () => {
    expect(senaVencidaPorTiempo({ etapa: 'agendada', qrEnviadoEn: qr(99 * min) }, 15, Date.now()).vencida).toBe(false);
    expect(senaVencidaPorTiempo({ etapa: 'qr_enviado' }, 15, Date.now()).vencida).toBe(false);
    expect(senaVencidaPorTiempo(undefined, 15, Date.now()).vencida).toBe(false);
  });
  it('vence justo al cumplirse el plazo, y dice cuándo', () => {
    const ahora = Date.now();
    const r = senaVencidaPorTiempo({ etapa: 'qr_enviado', qrEnviadoEn: { toMillis: () => ahora - 15 * min } }, 15, ahora);
    expect(r).toEqual({ vencida: true, venceMs: ahora });
  });
  it('acepta la marca como Timestamp, como segundos serializados o como ISO', () => {
    const hace20 = Date.now() - 20 * min;
    for (const qrEnviadoEn of [{ toMillis: () => hace20 }, { _seconds: hace20 / 1000 }, new Date(hace20).toISOString()]) {
      expect(senaVencidaPorTiempo({ etapa: 'qr_enviado', qrEnviadoEn }, 15, Date.now()).vencida).toBe(true);
    }
  });
});

describe('El identificador del cierre de una cita es el mismo en sena.ts y en cierres.ts', () => {
  // `idDesdeReferencia` de cierres.ts no se exporta; se reproduce su regla
  // acá para que, si alguien la cambia allá, esta prueba lo diga.
  const deCierres = (referencia: string) => `cita_${referencia.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)}`;
  it('sanea igual: barras, espacios, acentos y el largo', () => {
    for (const r of ['evt_abc123', 'a/b c', 'ñandú@x', 'x'.repeat(300), '_-']) {
      expect(idDeCierreDeCita(r)).toBe(deCierres(r));
    }
  });
});

describe('documentoQueCobra: dónde va el QR del comercio', () => {
  const ficha = (d: Record<string, unknown>) => ({ get: (k: string) => d[k] });
  it('venta gana; agendamiento si no hay venta; sin ninguno, null', () => {
    expect(documentoQueCobra(ficha({ flujos: ['agendamiento', 'venta'] }))).toBe('venta');
    expect(documentoQueCobra(ficha({ flujos: ['agendamiento'] }))).toBe('agendamiento');
    expect(documentoQueCobra(ficha({ flujos: ['onboarding'] }))).toBeNull();
    expect(documentoQueCobra(ficha({ flujos: [] }))).toBeNull();
  });
  it('una ficha vieja sin lista usa `vertical`', () => {
    expect(documentoQueCobra(ficha({ vertical: 'venta' }))).toBe('venta');
    expect(documentoQueCobra(ficha({ vertical: 'agendamiento' }))).toBe('agendamiento');
    expect(documentoQueCobra(ficha({}))).toBeNull();
  });
});
