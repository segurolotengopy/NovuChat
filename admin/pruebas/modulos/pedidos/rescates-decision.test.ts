/**
 * RESCATE DE 22 H — la decisión pura del servidor, escrita NEGANDO.
 *
 * Acá se prueba mandarle un mensaje a alguien que no escribió. La mayoría de los
 * casos comprueban que NO se rescata. Los teléfonos son ficticios (591000000xx).
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  HORA, LARGO_TEXTO, MS_DESDE, MS_HASTA, TEXTOS_MAX,
  leerMensajesParaRescate, motivoParaNoRescatar, validarCuerpo, type ContextoRescate,
} from '../../../functions/src/modulos/pedidos/rescates.ts';

const AHORA = Date.UTC(2026, 9, 20, 15, 0, 0);
const LINEA = '1000000501';
const TEL = '59100000011';
const MIN = 60_000;
const ts = (msAtras: number) => Timestamp.fromMillis(AHORA - msAtras);

const ctx = (extra: Partial<ContextoRescate> = {}): ContextoRescate => ({
  phoneNumberId: LINEA, excluidos: new Set(), soloTelefonos: null, ...extra,
});

/** Una candidata válida con el silencio que se le pida (por defecto 22 h 05 min). */
const conv = (silencioMs = 22 * HORA + 5 * MIN, extra: Record<string, unknown> = {}) => ({
  telefono: TEL, phoneNumberId: LINEA, ultimoEntranteEn: ts(silencioMs), atencionEstado: 'normal',
  solicitud: { etapa: 'qr_enviado', cotejos: 0 },
  ...extra,
});
const motivo = (c: Record<string, unknown> | null | undefined, x = ctx()) => motivoParaNoRescatar(c, x, AHORA);

describe('motivoParaNoRescatar: quién entra, y sobre todo quién no', () => {
  it('la candidata válida a 22 h 05 min', () => {
    expect(motivo(conv())).toBe('');
  });

  it('los bordes de la ventana', () => {
    expect(MS_DESDE).toBe(22 * HORA);
    expect(MS_HASTA).toBe(23.5 * HORA);
    expect(motivo(conv(22 * HORA - MIN))).toBe('temprano');
    expect(motivo(conv(22 * HORA))).toBe('');
    expect(motivo(conv(23.5 * HORA - 1000))).toBe('');
    expect(motivo(conv(23.5 * HORA))).toBe('tarde');
    expect(motivo(conv(25 * HORA))).toBe('tarde');
  });

  it('un documento inexistente o sin forma no se rescata', () => {
    expect(motivo(null)).toBe('telefono_invalido');
    expect(motivo(undefined)).toBe('telefono_invalido');
    expect(motivo({})).toBe('telefono_invalido');
  });

  it('`rescate` con cualquier valor (objeto, texto, cero) es ya rescatado', () => {
    for (const v of [{ enviadoEn: ts(HORA) }, 'x', 0, null, false]) {
      expect(motivo(conv(undefined, { rescate: v })), JSON.stringify(v)).toBe('ya_rescatado');
    }
  });

  it('`noContactar` true o «true» corta; false o ausente no', () => {
    expect(motivo(conv(undefined, { noContactar: true }))).toBe('no_contactar');
    expect(motivo(conv(undefined, { noContactar: 'true' }))).toBe('no_contactar');
    expect(motivo(conv(undefined, { noContactar: false }))).toBe('');
    expect(motivo(conv())).toBe('');
  });

  it('operador, bloqueado o un valor raro no se rescatan', () => {
    for (const e of ['operador', 'bloqueado', 'raro']) {
      expect(motivo(conv(undefined, { atencionEstado: e })), e).toBe('atencion');
    }
  });

  describe('turno de una persona', () => {
    const turno = (tomadoHaceMs: number, extra: Record<string, unknown> = {}) => ({
      responde: 'persona', tomadoPor: 'uid-1', tomadoEn: ts(tomadoHaceMs),
      actividadPersonaEn: ts(tomadoHaceMs), ...extra,
    });
    it('tomado y vigente: tomada', () => {
      expect(motivo(conv(undefined, { turno: turno(10 * MIN) }))).toBe('tomada');
    });
    it('tomado hace 3 h y devuelto: tomada igual (una persona estuvo en la conversación)', () => {
      expect(motivo(conv(undefined, {
        turno: turno(3 * HORA, { responde: 'asistente', devueltoEn: ts(2 * HORA), motivoDevolucion: 'manual' }),
      }))).toBe('tomada');
    });
    it('tomado 30 h ANTES del último mensaje del cliente y devuelto: no cuenta', () => {
      const ultimo = 22 * HORA + 5 * MIN;
      expect(motivo(conv(undefined, {
        turno: turno(ultimo + 30 * HORA, {
          responde: 'asistente', devueltoEn: ts(ultimo + 29 * HORA), motivoDevolucion: 'manual',
        }),
      }))).toBe('');
    });
    it('ilegible: tomada', () => {
      expect(motivo(conv(undefined, { turno: 'basura' }))).toBe('tomada');
      expect(motivo(conv(undefined, { turno: null }))).toBe('tomada');
      expect(motivo(conv(undefined, { turno: { responde: 'persona' } }))).toBe('tomada');
    });
  });

  describe('compra', () => {
    it('agendada, en_revision o a_favor: compró', () => {
      for (const etapa of ['agendada', 'en_revision', 'a_favor']) {
        expect(motivo(conv(undefined, { solicitud: { etapa, cotejos: 0 } })), etapa).toBe('compro');
      }
    });
    it('un cotejo: compró', () => {
      expect(motivo(conv(undefined, { solicitud: { etapa: 'qr_enviado', cotejos: 1 } }))).toBe('compro');
    });
    it('vencida, cancelada o qr_enviado sin cotejos: se rescata', () => {
      for (const etapa of ['vencida', 'cancelada', 'qr_enviado']) {
        expect(motivo(conv(undefined, { solicitud: { etapa, cotejos: 0 } })), etapa).toBe('');
      }
    });
  });

  it('otra línea, o sin línea: otra_linea', () => {
    expect(motivo(conv(undefined, { phoneNumberId: '1000000502' }))).toBe('otra_linea');
    const sin = conv() as Record<string, unknown>;
    delete sin['phoneNumberId'];
    expect(motivo(sin)).toBe('otra_linea');
  });

  it('el número de recepción o un excluido: excluido', () => {
    expect(motivo(conv(), ctx({ excluidos: new Set([TEL]) }))).toBe('excluido');
  });

  it('fuera de la lista de prueba; y dentro sí', () => {
    expect(motivo(conv(), ctx({ soloTelefonos: new Set(['59100000012']) }))).toBe('fuera_de_lista');
    expect(motivo(conv(), ctx({ soloTelefonos: new Set() }))).toBe('fuera_de_lista');
    expect(motivo(conv(), ctx({ soloTelefonos: new Set([TEL]) }))).toBe('');
  });

  it('teléfono inválido', () => {
    for (const t of ['1234567', '1234567890123456', '59100a00011', '', 5, undefined]) {
      expect(motivo(conv(undefined, { telefono: t })), String(t)).toBe('telefono_invalido');
    }
  });

  it('sin `ultimoEntranteEn` o con basura: sin_ventana', () => {
    const sin = conv() as Record<string, unknown>;
    delete sin['ultimoEntranteEn'];
    expect(motivo(sin)).toBe('sin_ventana');
    expect(motivo(conv(undefined, { ultimoEntranteEn: 'ayer' }))).toBe('sin_ventana');
    expect(motivo(conv(undefined, { ultimoEntranteEn: {} }))).toBe('sin_ventana');
  });
});

const msj = (direccion: string, tipo: string, texto: string, msAtras: number) =>
  ({ direccion, tipo, texto, ts: ts(msAtras) });
const ULTIMO = AHORA - 22 * HORA;

describe('leerMensajesParaRescate', () => {
  it('imagen o documento ENTRANTE en la ventana: medio', () => {
    expect(leerMensajesParaRescate([msj('entrante', 'image', '', 23 * HORA)], ULTIMO).motivo).toBe('medio');
    expect(leerMensajesParaRescate([msj('entrante', 'document', '', 23 * HORA)], ULTIMO).motivo).toBe('medio');
  });
  it('una imagen SALIENTE (el QR) no excluye', () => {
    expect(leerMensajesParaRescate([msj('saliente', 'image', '', 23 * HORA)], ULTIMO).motivo).toBe('');
  });
  it('una imagen entrante de hace 30 h antes del último mensaje no cuenta', () => {
    expect(leerMensajesParaRescate([msj('entrante', 'image', '', 22 * HORA + 30 * HORA)], ULTIMO).motivo).toBe('');
  });
  it('rechazos explícitos', () => {
    for (const t of ['No me interesa', 'no, gracias', 'no estoy interesada', 'STOP', 'Ya no me escribas', 'dame de baja']) {
      const r = leerMensajesParaRescate([msj('entrante', 'text', t, 23 * HORA)], ULTIMO);
      expect(r.motivo, t).toBe('rechazo');
      expect(r.textos, t).toEqual([]);
    }
  });
  it('«lo voy a pensar» y «no sé si me sirve» no son rechazo', () => {
    for (const t of ['lo voy a pensar', 'no sé si me sirve']) {
      expect(leerMensajesParaRescate([msj('entrante', 'text', t, 23 * HORA)], ULTIMO).motivo, t).toBe('');
    }
  });
  it('un rechazo del asistente (saliente) no cuenta', () => {
    expect(leerMensajesParaRescate([msj('saliente', 'text', 'no me interesa', 23 * HORA)], ULTIMO).motivo).toBe('');
  });
  it('textos: solo entrantes de tipo text, en orden, 6 como máximo, de 300 caracteres', () => {
    const lista = [
      msj('entrante', 'text', 'x'.repeat(500), 23 * HORA),
      ...Array.from({ length: 7 }, (_, i) => msj('entrante', 'text', `mensaje ${i}`, (22.9 - i * 0.1) * HORA)),
      msj('saliente', 'text', 'respuesta del asistente', 22.1 * HORA),
      msj('entrante', 'interactive', 'boton', 22.05 * HORA),
    ];
    // Llegan del más nuevo al más viejo, como los devuelve la consulta.
    const r = leerMensajesParaRescate([...lista].reverse(), ULTIMO);
    expect(r.motivo).toBe('');
    expect(r.textos).toHaveLength(TEXTOS_MAX);
    expect(r.textos).toEqual(['mensaje 1', 'mensaje 2', 'mensaje 3', 'mensaje 4', 'mensaje 5', 'mensaje 6']);
    expect(r.textos.join(' ')).not.toContain('respuesta del asistente');
    expect(r.textos.join(' ')).not.toContain('boton');
    const largo = leerMensajesParaRescate([msj('entrante', 'text', 'x'.repeat(500), 23 * HORA)], ULTIMO);
    expect(largo.textos[0]).toHaveLength(LARGO_TEXTO);
  });
});

describe('validarCuerpo', () => {
  it('lo válido', () => {
    expect(validarCuerpo({ v: 1 })).toEqual({ ok: true, soloTelefonos: null, excluir: new Set(), tope: 20 });
    const r = validarCuerpo({ v: 1, soloTelefonos: [TEL], excluir: ['59100000012'], tope: 5 });
    expect(r).toEqual({ ok: true, soloTelefonos: new Set([TEL]), excluir: new Set(['59100000012']), tope: 5 });
  });
  it('todo lo demás es error', () => {
    const veintiuno = Array.from({ length: 21 }, (_, i) => `591000010${String(i).padStart(2, '0')}`);
    const cincuentaYUno = Array.from({ length: 51 }, (_, i) => `591000020${String(i).padStart(2, '0')}`);
    for (const c of [
      null, 'x', [], undefined, {}, { v: 2 }, { v: '1' }, { v: 1, otra: 1 },
      { v: 1, soloTelefonos: veintiuno }, { v: 1, excluir: cincuentaYUno },
      { v: 1, soloTelefonos: ['12'] }, { v: 1, soloTelefonos: 'x' }, { v: 1, excluir: [5] },
      { v: 1, tope: 0 }, { v: 1, tope: 21 }, { v: 1, tope: '5' }, { v: 1, tope: 1.5 },
    ]) {
      expect(validarCuerpo(c).ok, JSON.stringify(c)).toBe(false);
    }
  });
});
