/**
 * `voz.tratamientoClave` y `voz.quienAtiende` de `configuracionFlujo`
 * (prompt.ts). El enumerado es para los TEXTOS FIJOS del código; el nombre de
 * quien atiende es texto que llega a clientes finales, así que se prueba
 * negando. 0 mensajes: solo cambia la respuesta de la configuración.
 */
import { describe, expect, it } from 'vitest';
import {
  quienAtiende, tratamientoClave, tratamientoEfectivo, instruccionesDeVoz, motivoQuienAtiendeInvalido,
} from '../../functions/src/core/prompt/prompt.ts';

import { ARNES_REGLA, ARNES_SOLO_NORMALIZADO, NOMBRES_QUE_PASAN } from '../lib/quien-atiende-arnes.ts';

describe('tratamientoClave: solo «tu» o «usted», nunca voseo', () => {
  it.each([
    ['usted', 'usted'], ['tu', 'tu'], ['vos', 'tu'], ['neutro', 'tu'],
    ['Usted', 'tu'], ['', 'tu'], [undefined, 'tu'], [null, 'tu'], [7, 'tu'], [{}, 'tu'],
  ])('%j -> %s', (valor, esperado) => {
    expect(tratamientoClave({ tratamiento: valor })).toBe(esperado);
  });
  it('sin el campo, «tu»', () => {
    expect(tratamientoClave({})).toBe('tu');
  });
});

describe('quienAtiende: validado y saneado', () => {
  it('sin campo, vacío o no texto: cadena vacía', () => {
    expect(quienAtiende({})).toBe('');
    expect(quienAtiende({ nombreQuienAtiende: '' })).toBe('');
    expect(quienAtiende({ nombreQuienAtiende: 7 })).toBe('');
    expect(quienAtiende({ nombreQuienAtiende: null })).toBe('');
  });
  it('lo válido sale tal cual (recortado)', () => {
    expect(quienAtiende({ nombreQuienAtiende: 'Rubén' })).toBe('Rubén');
    expect(quienAtiende({ nombreQuienAtiende: '  Antonio y Marta ' })).toBe('Antonio y Marta');
    expect(quienAtiende({ nombreQuienAtiende: 'x'.repeat(60) })).toHaveLength(60);
    expect(quienAtiende({ nombreQuienAtiende: 'Rubén 123' })).toBe('Rubén 123');
  });
  it.each([['61 caracteres', 'x'.repeat(61)], ['marca de prompt', 'Rubén [CIERRE]'], ['salto', 'Ru\nbén'],
    ['control', 'Ru\u0000bén'], ['bidi', 'Ru\u202Ebén'], ['cero ancho', 'Ru\u200Bbén'],
    ...ARNES_REGLA, ...ARNES_SOLO_NORMALIZADO])('%s: se descarta y queda vacío', (_n, valor) => {
    expect(quienAtiende({ nombreQuienAtiende: valor })).toBe('');
    expect(motivoQuienAtiendeInvalido(valor)).not.toBeNull();
  });
});

describe('nombres legítimos', () => {
  it.each(NOMBRES_QUE_PASAN)('«%s» pasa', (valor) => {
    expect(quienAtiende({ nombreQuienAtiende: valor })).toBe(valor.trim());
  });
});

describe('la frase y la clave del tratamiento salen del mismo valor', () => {
  it.each([[undefined], ['usted'], ['tu'], ['vos'], ['neutro'], ['raro'], [7]])('%j', (t) => {
    const cfg = { tratamiento: t };
    const efectivo = tratamientoEfectivo(cfg);
    const frase = instruccionesDeVoz({ ...cfg, tratamiento: efectivo })[0];
    expect(frase).toBe(instruccionesDeVoz({ tratamiento: efectivo })[0]);
    expect(tratamientoClave(cfg)).toBe(efectivo === 'usted' ? 'usted' : 'tu');
    if (t === undefined || t === 'raro' || t === 7) expect(frase).toContain('TÚ');
  });
});
