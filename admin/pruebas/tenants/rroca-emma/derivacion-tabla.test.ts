/**
 * LA REGLA DE DERIVACIÓN en el flujo de Emma: cada plan del código está clasificado en `derivacion.ts` (cobertura estática), y una conversación entera pasa por el vigilante (un plan que resuelve nunca sale con el
 * botón de la recepción; uno que deriva siempre lo trae). Se NIEGA: un plan sin clasificar o un `exento` sin porqué fallan.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claseDe, coberturaDePlanes, planesDelCodigo, vigilarDerivacion } from '../../core/ux/derivacion';
import { ANA, crear, hablar, mAudio, mDocumento, mTexto } from './mundo';
import { TABLA_DE_PLANES } from './derivacion';

const ARMAR = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-emma/src/nodos/armar-mensajes.js');
const PATRON = [/(?<![A-Za-z0-9_.])efectivo\s*===\s*'([a-z_0-9]+)'/];

describe('cobertura estática', () => {
  it('todo plan del código está clasificado', () => {
    expect(coberturaDePlanes(ARMAR, TABLA_DE_PLANES, PATRON)).toEqual([]);
    expect(planesDelCodigo(ARMAR, PATRON)).toEqual(expect.arrayContaining(['derivar', 'medica', 'fallo', 'remision', 'uso_extendido', 'suspendido', 'riesgo', 'baja', 'fijo', 'modelo', 'nada']));
  });
  it('NIEGA: un plan sin clasificar, y un exento sin porqué', () => {
    const sinFallo = { ...TABLA_DE_PLANES }; delete (sinFallo as Record<string, unknown>)['fallo'];
    expect(coberturaDePlanes(ARMAR, sinFallo, PATRON)).toEqual(['plan sin clasificar: «fallo»']);
    expect(coberturaDePlanes(ARMAR, { ...TABLA_DE_PLANES, baja: { clase: 'exento' } }, PATRON)).toEqual(['plan exento sin porqué: «baja»']);
  });
});

/** El plan del turno, del resumen que arma el flujo. */
const planDe = (t: { porNodo: Record<string, Array<Record<string, unknown>>> }): string => String(((t.porNodo['Resumen del turno']?.[0]?.['resumen'] ?? {}) as Record<string, unknown>)['plan'] ?? '');

describe('el vigilante en una conversación', () => {
  it('cada turno cumple la regla (resuelve sin botón, deriva con botón)', () => {
    let n = 0;
    const respuestas = ['Cuéntame, ¿qué te gustaría mejorar?', '[DERIVAR_RECEPCION: Ana]', '   ', 'La valoración es gratuita. ¿Cómo te llamas?', 'Con diabetes no hay problema, puedes hacértelo.'];
    const m = crear({ modeloDice: () => respuestas[n++ % respuestas.length]! });
    const cuenta = vigilarDerivacion(m, { clasificar: (t) => claseDe(TABLA_DE_PLANES, planDe(t)), hayRecepcion: true });
    for (const msg of ['hola', 'quiero agendar', 'dónde queda', 'cuánto cuesta', 'tengo diabetes, ¿puedo?', 'tengo fiebre', 'mi pareja me golpea']) hablar(m, ANA, mTexto(msg));
    hablar(m, ANA, mAudio());
    hablar(m, ANA, mDocumento());
    expect(cuenta.turnos).toBe(9);
  });
  it('el uso extendido (operador) sale con el botón y sin la promesa de «una persona del equipo»', () => {
    const m = crear({ ingesta: { atencion: { estado: 'operador', mensajeFijo: 'Una persona del equipo va a continuar esta conversación.', respuestasEnVentana: 40 } } });
    const cuenta = vigilarDerivacion(m, { clasificar: (t) => claseDe(TABLA_DE_PLANES, planDe(t)), hayRecepcion: true });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(cuenta.turnos).toBe(1);
    expect(t.mensajes[0]!.tipo).toBe('interactive');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/una persona del equipo/i);
    expect(t.mensajes[0]!.cuerpo).toMatch(/botón/);
  });
});
