/**
 * Presentación honesta del turno (18/10, ensayo de H2): un `pendiente` no se rotula «Enviando…» para siempre, y la
 * cuenta regresiva de la ventana sale de `ultimoEntranteEn`, nunca de `ventanaVenceEn`. Puras: sin red ni navegador.
 */
import { describe, expect, it } from 'vitest';
import {
  PENDIENTE_CADUCA_MS, TEXTO_CADUCADO, estadoDeMensaje, pendienteCaducado, textoCuentaRegresiva, textoEstadoMensaje, ventanaDeEnvio,
} from '../../web/src/central/lib/turno';
import { ventanaDeFicha } from '../../web/src/central/lib/conversaciones';
import { PENDIENTE_MAXIMO_MS } from '../../functions/src/core/conversacion/salidaPersona';

const T0 = 1_800_000_000_000;
const rotulo = (estadoCrudo: string, ts: number, ahora: number) => {
  const e = estadoDeMensaje(estadoCrudo)!;
  return textoEstadoMensaje(e, pendienteCaducado(e, ts, ahora));
};

describe('un pendiente caduca en la pantalla, sin escribir nada', () => {
  it('la cifra es la del servidor', () => expect(PENDIENTE_CADUCA_MS).toBe(PENDIENTE_MAXIMO_MS));
  it('de 1:59 sigue «Enviando…»', () => expect(rotulo('pendiente', T0, T0 + 119_000)).toBe('Enviando…'));
  it('justo en 2:00 todavía «Enviando…»', () => expect(rotulo('pendiente', T0, T0 + 120_000)).toBe('Enviando…'));
  it('de 2:01 dice que no se envió a tiempo', () => expect(rotulo('pendiente', T0, T0 + 121_000)).toBe(TEXTO_CADUCADO));
  it('`enviando` se comporta igual', () => {
    expect(rotulo('enviando', T0, T0 + 119_000)).toBe('Enviando…');
    expect(rotulo('enviando', T0, T0 + 121_000)).toBe(TEXTO_CADUCADO);
  });
  it('no promete reintento que la pantalla no tiene', () => expect(TEXTO_CADUCADO).not.toMatch(/reintent/i));
  it('aceptado, rechazado e incierto con fecha vieja no cambian', () => {
    const viejo = T0 + 30 * 86_400_000;
    expect(rotulo('aceptado', T0, viejo)).toBe('Enviado a WhatsApp');
    expect(rotulo('rechazado', T0, viejo)).toBe('WhatsApp no lo aceptó: no se envió');
    expect(rotulo('incierto', T0, viejo)).toBe('No se pudo confirmar si llegó');
  });
  it('sin hora del mensaje no se inventa: sigue «Enviando…»', () => {
    expect(rotulo('pendiente', 0, T0)).toBe('Enviando…');
    expect(pendienteCaducado('pendiente', Number.NaN, T0)).toBe(false);
  });
  it('un estado ausente no caduca', () => expect(pendienteCaducado(null, T0, T0 + 9e9)).toBe(false));
});

describe('la cuenta regresiva sale de ultimoEntranteEn', () => {
  const ult = T0;
  const ahora = T0 + 9 * 60_000;
  it('con ventanaVenceEn distinto gana ultimoEntranteEn', () => {
    const f = { ultimoEntranteEn: ult, ventanaVenceEn: ult + 3_600_000 };
    const v = ventanaDeFicha(f, ahora);
    expect(v.restanteMs).toBe(ult + 86_400_000 - ahora);
    expect(ventanaDeEnvio(ult, ahora).restanteMs).toBe(ult + 86_400_000 - ahora);
    expect(textoCuentaRegresiva(ventanaDeEnvio(ult, ahora).restanteMs)).toBe('23:51:00');
  });
  it('ventana vencida: cerrada, restante 0', () => {
    const v = ventanaDeEnvio(ult, ult + 90_000_000);
    expect(v.estado).toBe('cerrada');
    expect(v.restanteMs).toBe(0);
  });
  it('sin dato: sin dato, nunca una cuenta inventada', () => {
    expect(ventanaDeEnvio(null, ahora).estado).toBe('sin-dato');
    expect(ventanaDeEnvio(null, ahora).restanteMs).toBe(0);
  });
});
