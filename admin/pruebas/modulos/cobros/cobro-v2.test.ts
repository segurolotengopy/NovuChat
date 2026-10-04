/**
 * LA REGLA 2 DEL COBRO DE VENTA: la máquina de estados, negando. NO NECESITA EMULADOR.
 *
 * Defiende lo que pidió Andres (03/10/2026): el QR vive 15 minutos; el primer
 * comprobante a tiempo concede UNA prórroga de 10; tres inválidos pasan el
 * cobro a una persona y ahí no vence por reloj; un reenvío del QR no estira
 * nada; sin id de Meta no se abre cobro; y un flujo que no manda `reglaCobro: 2`
 * sigue exactamente con las 24 h de siempre.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  CAMPOS_REGLA_2_EN_NULO, MAX_COMPROBANTES, MAX_INTENTOS_INVALIDOS, MINUTOS_PRORROGA, MINUTOS_QR_VENTA,
  MINUTOS_QR_VENTA_REGLA_2, cobroParaElFlujo, esReglaDos, limiteDe, solicitudDeCobroTras,
  type EventoDeCobro, type TransicionDeCobro,
} from '../../../functions/src/modulos/cobros/cobroVenta.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 3, 16, 0);
const url = (f: string) => `https://panel/imagenDeCobro?f=${f}`;
const AFIRMA_PAGO = /acreditad|verificad|recibimos|pago confirmado/i;

type S = Record<string, unknown>;
const aplicar = (s: S | null, t: TransicionDeCobro): S => ({ ...(s ?? {}), ...(t.cambios ?? {}) });

/** Una solicitud de regla 2 recién abierta con el QR enviado en T0. */
function abierta(extra: S = {}): S {
  const t = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'wamid.qr' }, T0);
  return {
    etapa: 'qr_enviado', desde: Timestamp.fromMillis(T0), qrEnviadoEn: Timestamp.fromMillis(T0),
    evento: { id: 'wamid.qr', calendario: '' }, cotejos: 0, monto: 100, ...(t.cambios ?? {}), ...extra,
  };
}
const comp = (estado: 'valido' | 'aproximado' | 'invalido', idMeta: string, motivo = 'monto_menor'): EventoDeCobro =>
  ({ tipo: 'comprobante', estado, motivo, idMeta, ruta: null });
const ms = (v: unknown) => (v as Timestamp).toMillis();

describe('abrir el cobro', () => {
  it('constantes: 15 minutos, 10 de prórroga, 3 intentos; las 24 h de la regla 1 intactas', () => {
    expect([MINUTOS_QR_VENTA_REGLA_2, MINUTOS_PRORROGA, MAX_INTENTOS_INVALIDOS]).toEqual([15, 10, 3]);
    expect(MINUTOS_QR_VENTA).toBe(24 * 60);
  });
  it('qr_enviado con regla 2 y con idMeta abre: venceEn = envío + 15 min, 0 intentos', () => {
    const t = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'wamid.x' }, T0);
    expect(t.efecto).toBe('abierto');
    expect(ms(t.cambios?.['venceEn'])).toBe(T0 + 15 * MIN);
    expect(t.cambios).toMatchObject({ reglaCobro: 2, prorrogaHasta: null, intentosInvalidos: 0, comprobantes: [] });
    expect(t.metricas).toEqual({ cobrosQrEnviados: 1 });
  });
  it('NO se abre cobro sin id de Meta (ni vacío, ni ausente, ni solo espacios)', () => {
    for (const idMeta of [undefined, '', '   ']) {
      const t = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta }, T0);
      expect(t.efecto, String(idMeta)).toBe('sin_id_meta');
      expect(t.cambios).toBeNull();
      expect(t.metricas).toEqual({});
    }
  });
  it('sin `reglaCobro: 2` no hay nada nuevo: la regla de 24 h queda como está', () => {
    for (const reglaCobro of [undefined, 1, '2', null, true]) {
      const t = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro, idMeta: 'wamid.x' }, T0);
      expect(t.efecto).toBe('regla_1');
      expect(t.cambios).toBeNull();
      expect(t.metricas).toEqual({});
    }
  });
  it('una solicitud de regla 1 que reemplaza a una de regla 2 borra sus restos (merge)', () => {
    const t = solicitudDeCobroTras(abierta(), { tipo: 'qr_enviado', idMeta: 'wamid.y' }, T0 + MIN);
    expect(t.cambios).toEqual({ ...CAMPOS_REGLA_2_EN_NULO });
    expect(esReglaDos({ ...abierta(), ...t.cambios })).toBe(false);
  });
  it('un reenvío del QR NO mueve venceEn, ni los intentos, ni la prórroga', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + 2 * MIN));
    const antes = { venceEn: ms(s['venceEn']), prorrogaHasta: ms(s['prorrogaHasta']), intentos: s['intentosInvalidos'] };
    const t = solicitudDeCobroTras(s, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'wamid.reenvio', referencia: 'wamid.qr', monto: 100 }, T0 + 5 * MIN);
    expect(t.efecto).toBe('reenvio');
    expect(t.metricas).toEqual({});
    const despues = aplicar(s, t);
    expect(ms(despues['venceEn'])).toBe(antes.venceEn);
    expect(ms(despues['prorrogaHasta'])).toBe(antes.prorrogaHasta);
    expect(despues['intentosInvalidos']).toBe(antes.intentos);
    expect(ms(despues['qrEnviadoEn'])).toBe(T0);
    expect(limiteDe(despues)).toBe(limiteDe(s));
  });
  it('REENVÍO solo si la referencia Y el total coinciden: con otro total es un cobro nuevo, con plazo nuevo', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + 2 * MIN));
    const otroTotal = solicitudDeCobroTras(s, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'w2', referencia: 'wamid.qr', monto: 150 }, T0 + 5 * MIN);
    expect(otroTotal.efecto).toBe('abierto');
    expect(ms(otroTotal.cambios?.['venceEn'])).toBe(T0 + 20 * MIN);
    expect(otroTotal.cambios).toMatchObject({ intentosInvalidos: 0, comprobantes: [], prorrogaHasta: null });
    const otraReferencia = solicitudDeCobroTras(s, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'w3', referencia: 'otro-pedido', monto: 100 }, T0 + 5 * MIN);
    expect(otraReferencia.efecto).toBe('abierto');
    const igual = solicitudDeCobroTras(s, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'w4', referencia: 'wamid.qr', monto: 100 }, T0 + 5 * MIN);
    expect(igual.efecto).toBe('reenvio');
  });
  it('un `qr_enviado` sobre `en_revision` NO reabre el cobro: mismo pedido, ignorado; otro pedido, cobro nuevo', () => {
    let s = abierta();
    for (const id of ['c1', 'c2', 'c3']) s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', id), T0 + MIN));
    expect(s['etapa']).toBe('en_revision');
    const mismo = solicitudDeCobroTras(s, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'w5', referencia: 'wamid.qr', monto: 100 }, T0 + 5 * MIN);
    expect(mismo).toMatchObject({ efecto: 'ignorado', cambios: null, metricas: {} });
    const otro = solicitudDeCobroTras(s, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'w6', referencia: 'pedido-2', monto: 100 }, T0 + 5 * MIN);
    expect(otro.efecto).toBe('abierto');
    expect(otro.cambios).toMatchObject({ intentosInvalidos: 0, comprobantes: [] });
  });
  it('un comprobante recibido en `en_revision` se anota con motivo `en_revision`, no `tardio`', () => {
    let s = abierta();
    for (const id of ['c1', 'c2', 'c3']) s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', id), T0 + MIN));
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c4', 'tardio'), T0 + 2 * MIN));
    const ultimo = (s['comprobantes'] as { motivo: string; estado: string }[]).at(-1);
    expect(ultimo).toMatchObject({ estado: 'en_revision', motivo: 'en_revision' });
  });
  it('se anota con qué aviso se contestó, para poder repetirlo', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('valido', 'v1', 'ok'), T0 + MIN));
    expect((s['comprobantes'] as { avisar: boolean }[])[0]?.avisar).toBe(true);
    let r = abierta();
    r = aplicar(r, solicitudDeCobroTras(r, comp('invalido', 'i1'), T0 + MIN));
    expect((r['comprobantes'] as { avisar: boolean }[])[0]?.avisar).toBe(false);
  });
  it('un QR nuevo sobre uno vencido sin cerrar abre de nuevo y cuenta el vencido una vez', () => {
    const t = solicitudDeCobroTras(abierta(), { tipo: 'qr_enviado', reglaCobro: 2, idMeta: 'wamid.n' }, T0 + 30 * MIN);
    expect(t.efecto).toBe('abierto');
    expect(t.metricas).toEqual({ cobrosQrEnviados: 1, cobrosVencidos: 1 });
    expect(ms(t.cambios?.['venceEn'])).toBe(T0 + 45 * MIN);
  });
});

describe('el reloj: vencimiento perezoso, prórroga única y límite efectivo', () => {
  it('a los 15 minutos exactos vence; un minuto antes, no', () => {
    expect(solicitudDeCobroTras(abierta(), { tipo: 'lectura' }, T0 + 15 * MIN - 1).efecto).toBe('ignorado');
    const t = solicitudDeCobroTras(abierta(), { tipo: 'lectura' }, T0 + 15 * MIN);
    expect(t.efecto).toBe('vencido');
    expect(t.cambios).toMatchObject({ etapa: 'vencida' });
    expect(ms(t.cambios?.['desde'])).toBe(T0 + 15 * MIN);
    expect(t.metricas).toEqual({ cobrosVencidos: 1 });
  });
  it('el primer comprobante a tiempo fija la prórroga: primer comprobante + 10 min', () => {
    const t = solicitudDeCobroTras(abierta(), comp('invalido', 'c1'), T0 + 14 * MIN);
    expect(ms(t.cambios?.['prorrogaHasta'])).toBe(T0 + 24 * MIN);
  });
  it('la prórroga se fija UNA sola vez: el segundo comprobante no la mueve', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + 14 * MIN));
    const fijada = ms(s['prorrogaHasta']);
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c2'), T0 + 20 * MIN));
    expect(ms(s['prorrogaHasta'])).toBe(fijada);
  });
  it('el límite efectivo es el mayor de venceEn y prorrogaHasta', () => {
    const temprano = aplicar(abierta(), solicitudDeCobroTras(abierta(), comp('invalido', 'c1'), T0 + 1 * MIN));
    expect(limiteDe(temprano)).toBe(T0 + 15 * MIN);            // prórroga a los 11: no estira
    const tarde = aplicar(abierta(), solicitudDeCobroTras(abierta(), comp('invalido', 'c1'), T0 + 14 * MIN));
    expect(limiteDe(tarde)).toBe(T0 + 24 * MIN);
  });
  it('un comprobante a los 20 min entra si la prórroga lo cubre; a los 25 es tardío', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + 14 * MIN));
    expect(solicitudDeCobroTras(s, comp('invalido', 'c2'), T0 + 23 * MIN).efecto).toBe('reintentar');
    expect(solicitudDeCobroTras(s, comp('invalido', 'c3'), T0 + 25 * MIN).efecto).toBe('tardio');
  });
  it('`en_revision` NO vence por reloj: horas después sigue en revisión', () => {
    let s = abierta();
    for (const [i, id] of ['c1', 'c2', 'c3'].entries()) s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', id), T0 + (i + 1) * MIN));
    expect(s['etapa']).toBe('en_revision');
    for (const lectura of [{ tipo: 'lectura' }, { tipo: 'cobro_cancelado' }, { tipo: 'anulacion_avisada' }] as const) {
      const t = solicitudDeCobroTras(s, lectura, T0 + 10 * 60 * MIN);
      expect(t.cambios, lectura.tipo).toBeNull();
    }
    const flujo = cobroParaElFlujo({}, true, 'BOB', url, s, T0 + 10 * 60 * MIN);
    expect(flujo).toMatchObject({ enRevision: true, pendiente: false, anulado: null, vencidoHaceMin: null });
  });
});

describe('comprobantes: válido, aproximado, inválidos y tardío', () => {
  it('válido cierra (agendada), avisa al comercio y cuenta; el aproximado igual', () => {
    for (const estado of ['valido', 'aproximado'] as const) {
      const t = solicitudDeCobroTras(abierta(), comp(estado, 'c1', 'ok'), T0 + 3 * MIN);
      expect(t.efecto).toBe('cerrado');
      expect(t.cambios).toMatchObject({ etapa: 'agendada', cotejos: 1 });
      expect(t.avisarComercio).toBe(true);
      expect(t.metricas).toEqual({ cobrosCotejados: 1, ...(estado === 'valido' ? { cobrosValidos: 1 } : { cobrosAproximados: 1 }) });
    }
  });
  it('un inválido NO cierra ni avisa: pide reenviar y descuenta un intento', () => {
    const t = solicitudDeCobroTras(abierta(), comp('invalido', 'c1'), T0 + MIN);
    expect(t).toMatchObject({ efecto: 'reintentar', intentosInvalidos: 1, intentosRestantes: 2, avisarComercio: false });
    expect(t.cambios?.['etapa']).toBeUndefined();
    expect(t.metricas).toEqual({ cobrosCotejados: 1, cobrosInvalidos: 1 });
  });
  it('el TERCER inválido pasa a `en_revision` y avisa al comercio, una vez', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + MIN));
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c2'), T0 + 2 * MIN));
    const t = solicitudDeCobroTras(s, comp('invalido', 'c3'), T0 + 3 * MIN);
    expect(t).toMatchObject({ efecto: 'en_revision', intentosInvalidos: 3, intentosRestantes: 0, avisarComercio: true });
    expect(t.metricas).toMatchObject({ cobrosInvalidos: 1, cobrosEnRevision: 1 });
    s = aplicar(s, t);
    // Un cuarto comprobante: se anota, no se avisa de nuevo ni se cuenta otro inválido.
    const cuarto = solicitudDeCobroTras(s, comp('invalido', 'c4'), T0 + 4 * MIN);
    expect(cuarto).toMatchObject({ efecto: 'en_revision', avisarComercio: false });
    expect(cuarto.metricas).toEqual({});
  });
  it('el mismo comprobante dos veces (reintento de n8n) no cuenta dos veces', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + MIN));
    const t = solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + 2 * MIN);
    expect(t.efecto).toBe('repetido');
    expect(t.cambios).toBeNull();
    expect(t.intentosInvalidos).toBe(1);
  });
  it('tras el límite: `tardio` SIN cierre, avisa al comercio solo la primera vez', () => {
    const t = solicitudDeCobroTras(abierta(), comp('valido', 'c1', 'ok'), T0 + 40 * MIN);
    expect(t.efecto).toBe('tardio');
    expect(t.cambios?.['etapa']).toBe('vencida');
    expect(t.avisarComercio).toBe(true);
    expect(t.metricas).toEqual({ cobrosVencidos: 1, cobrosTardios: 1 });
    const s = aplicar(abierta(), t);
    const otro = solicitudDeCobroTras(s, comp('valido', 'c2', 'ok'), T0 + 50 * MIN);
    expect(otro).toMatchObject({ efecto: 'tardio', avisarComercio: false });
    expect(otro.metricas).toEqual({});
  });
  it('pasadas 24 h del límite ya no hay cobro que atender', () => {
    const t = solicitudDeCobroTras(abierta(), comp('valido', 'c1', 'ok'), T0 + 15 * MIN + 24 * 60 * MIN + MIN);
    expect(t.efecto).toBe('sin_cobro');
    expect(t.avisarComercio).toBe(false);
  });
  it('lo ya resuelto, cancelado, sin solicitud o de regla 1 no se cotejan', () => {
    const cerrada = aplicar(abierta(), solicitudDeCobroTras(abierta(), comp('valido', 'c1', 'ok'), T0 + MIN));
    expect(solicitudDeCobroTras(cerrada, comp('valido', 'c2', 'ok'), T0 + 2 * MIN).efecto).toBe('ya_resuelto');
    const cancelada = aplicar(abierta(), solicitudDeCobroTras(abierta(), { tipo: 'cobro_cancelado' }, T0 + MIN));
    expect(solicitudDeCobroTras(cancelada, comp('valido', 'c2', 'ok'), T0 + 2 * MIN).efecto).toBe('cobro_cancelado');
    expect(solicitudDeCobroTras(null, comp('valido', 'c', 'ok'), T0).efecto).toBe('sin_cobro');
    expect(solicitudDeCobroTras({ etapa: 'qr_enviado', qrEnviadoEn: Timestamp.fromMillis(T0) }, comp('valido', 'c', 'ok'), T0).efecto).toBe('regla_1');
  });
  it('se anotan a lo sumo seis comprobantes', () => {
    let s = abierta({ comprobantes: Array.from({ length: MAX_COMPROBANTES }, (_, i) => ({ idMeta: `x${i}`, estado: 'invalido', motivo: 'm', en: Timestamp.fromMillis(T0), ruta: null })) });
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'nuevo'), T0 + MIN));
    expect((s['comprobantes'] as unknown[]).length).toBe(MAX_COMPROBANTES);
  });
});

describe('cancelar y anular', () => {
  it('cobro_cancelado cierra el cobro abierto: etapa `cancelada` y cuenta', () => {
    const t = solicitudDeCobroTras(abierta(), { tipo: 'cobro_cancelado' }, T0 + MIN);
    expect(t.cambios).toMatchObject({ etapa: 'cancelada' });
    expect(t.metricas).toEqual({ cobrosCancelados: 1 });
    // Y repetirlo no cuenta de nuevo.
    expect(solicitudDeCobroTras(aplicar(abierta(), t), { tipo: 'cobro_cancelado' }, T0 + 2 * MIN).cambios).toBeNull();
  });
  it('cancelar cuando ya venció solo materializa el vencimiento: no es una cancelación', () => {
    const t = solicitudDeCobroTras(abierta(), { tipo: 'cobro_cancelado' }, T0 + 20 * MIN);
    expect(t.efecto).toBe('vencido');
    expect(t.metricas).toEqual({ cobrosVencidos: 1 });
  });
  it('anulacion_avisada anota el aviso una sola vez y materializa el vencimiento perezoso', () => {
    const t = solicitudDeCobroTras(abierta(), { tipo: 'anulacion_avisada' }, T0 + 20 * MIN);
    expect(t.efecto).toBe('anulacion_registrada');
    expect(t.cambios).toMatchObject({ etapa: 'vencida' });
    expect(ms(t.cambios?.['anulacionAvisadaEn'])).toBe(T0 + 20 * MIN);
    const s = aplicar(abierta(), t);
    expect(solicitudDeCobroTras(s, { tipo: 'anulacion_avisada' }, T0 + 21 * MIN).cambios).toBeNull();
    // Antes del límite no hay nada que anular.
    expect(solicitudDeCobroTras(abierta(), { tipo: 'anulacion_avisada' }, T0 + 5 * MIN).cambios).toBeNull();
  });
});

describe('`configuracionFlujo.cobro`: la regla 1 idéntica y la regla 2 con sus campos', () => {
  it('SIN `reglaCobro` el estado es el de siempre: 24 h, y los campos nuevos neutros', () => {
    const s = { etapa: 'qr_enviado', qrEnviadoEn: Timestamp.fromMillis(T0), monto: 100, evento: { id: 'p1', calendario: '' } };
    const en = (min: number) => cobroParaElFlujo({}, true, 'BOB', url, s, T0 + min * MIN);
    expect(en(16)).toMatchObject({ regla: 1, pendiente: true, vencidoHaceMin: null, venceEn: null, prorrogaHasta: null,
      intentosInvalidos: null, intentosRestantes: null, enRevision: false, anulado: null });
    expect(en(24 * 60 - 1).pendiente).toBe(true);
    expect(en(24 * 60 + 5)).toMatchObject({ pendiente: false, vencidoHaceMin: 5, anulado: null });
  });
  it('con regla 2 el plazo es de 15 min, y `anulado` solo si venció, sin aviso y dentro de 24 h', () => {
    const s = abierta();
    expect(cobroParaElFlujo({}, true, 'BOB', url, s, T0 + 14 * MIN)).toMatchObject({ regla: 2, pendiente: true, anulado: null, intentosRestantes: 3 });
    const v = cobroParaElFlujo({}, true, 'BOB', url, s, T0 + 20 * MIN);
    expect(v).toMatchObject({ pendiente: false, vencidoHaceMin: 5, anulado: { pedido: 'wamid.qr', haceMin: 5 } });
    // Con el aviso ya dado, no se repite.
    const avisado = { ...s, etapa: 'vencida', anulacionAvisadaEn: Timestamp.fromMillis(T0 + 20 * MIN) };
    expect(cobroParaElFlujo({}, true, 'BOB', url, avisado, T0 + 21 * MIN).anulado).toBeNull();
    // Pasadas 24 h del límite, tampoco.
    expect(cobroParaElFlujo({}, true, 'BOB', url, s, T0 + 15 * MIN + 24 * 60 * MIN + MIN)).toMatchObject({ anulado: null, vencidoHaceMin: null });
  });
  it('lleva venceEn, prorrogaHasta, intentos e intentos restantes', () => {
    let s = abierta();
    s = aplicar(s, solicitudDeCobroTras(s, comp('invalido', 'c1'), T0 + 14 * MIN));
    const f = cobroParaElFlujo({}, false, 'BOB', url, s, T0 + 16 * MIN);
    expect(f).toMatchObject({ regla: 2, activo: false, pendiente: true, intentosInvalidos: 1, intentosRestantes: 2 });
    expect(f.venceEn).toBe(new Date(T0 + 15 * MIN).toISOString());
    expect(f.prorrogaHasta).toBe(new Date(T0 + 24 * MIN).toISOString());
  });
  it('el plazo aplica también en modo simulado (activo: false)', () => {
    expect(cobroParaElFlujo({}, false, 'BOB', url, abierta(), T0 + 20 * MIN)).toMatchObject({ activo: false, pendiente: false });
  });
});

describe('la regla 1 sigue igual: las claves de siempre, con igualdad estricta', () => {
  const VIEJAS = ['activo', 'moneda', 'montoFijo', 'qr', 'pendiente', 'monto', 'pedido', 'qrEnviadoEn', 'vencidoHaceMin'] as const;
  const viejas = (o: Record<string, unknown>) => Object.fromEntries(VIEJAS.map((k) => [k, o[k]]));
  const enviado = Timestamp.fromMillis(T0);
  const base = { etapa: 'qr_enviado', qrEnviadoEn: enviado, monto: 100, evento: { id: 'p1', calendario: '' } };
  it('pendiente, vencido, otra etapa y sin solicitud: los valores de la base', () => {
    const iso = new Date(T0).toISOString();
    const venta = { cobroReal: { ficha: 'f', nombreCuenta: 'N', banco: 'B', montoFijo: 7 } };
    expect(viejas(cobroParaElFlujo(venta, true, 'BOB', url, base, T0 + 60 * MIN))).toStrictEqual({
      activo: true, moneda: 'BOB', montoFijo: 7, qr: { url: url('f'), nombreCuenta: 'N', banco: 'B' },
      pendiente: true, monto: 100, pedido: 'p1', qrEnviadoEn: iso, vencidoHaceMin: null,
    });
    expect(viejas(cobroParaElFlujo(undefined, false, 'BOB', url, base, T0 + (24 * 60 + 30) * MIN))).toStrictEqual({
      activo: false, moneda: 'BOB', montoFijo: null, qr: null,
      pendiente: false, monto: 100, pedido: 'p1', qrEnviadoEn: iso, vencidoHaceMin: 30,
    });
    expect(viejas(cobroParaElFlujo(undefined, false, 'BOB', url, { ...base, etapa: 'agendada' }, T0 + MIN))).toMatchObject({ pendiente: false, vencidoHaceMin: null });
    expect(viejas(cobroParaElFlujo(undefined, false, 'BOB', url, null, T0))).toStrictEqual({
      activo: false, moneda: 'BOB', montoFijo: null, qr: null,
      pendiente: false, monto: null, pedido: null, qrEnviadoEn: null, vencidoHaceMin: null,
    });
  });
});

describe('prohibición 3: nada de lo que sale de este módulo afirma un pago', () => {
  it('ningún motivo ni efecto de la máquina de estados lo dice', async () => {
    const m = await import('../../../functions/src/modulos/cobros/cobroVenta.ts');
    for (const [estado, motivo] of [['valido', 'ok'], ['aproximado', 'monto_distinto']] as const) {
      expect(m.detalleDeLaVentaCalificada(100, 'BOB', estado, motivo)).not.toMatch(AFIRMA_PAGO);
    }
    const efectos = [
      'abierto', 'reenvio', 'regla_1', 'sin_id_meta', 'cancelado', 'anulacion_registrada', 'vencido',
      'ignorado', 'cerrado', 'reintentar', 'en_revision', 'tardio', 'ya_resuelto', 'repetido', 'sin_cobro', 'cobro_cancelado',
    ];
    for (const e of efectos) expect(e).not.toMatch(AFIRMA_PAGO);
  });
});
