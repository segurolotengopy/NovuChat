/**
 * `voz.tratamientoClave` y `voz.quienAtiende` de `configuracionFlujo`
 * (prompt.ts). El enumerado es para los TEXTOS FIJOS del código; el nombre de
 * quien atiende es texto que llega a clientes finales, así que se prueba
 * negando. 0 mensajes: solo cambia la respuesta de la configuración.
 */
import { describe, expect, it } from 'vitest';
import {
  quienAtiende, tratamientoClave, motivoQuienAtiendeInvalido,
} from '../../functions/src/core/prompt/prompt.ts';

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
  it.each([
    ['61 caracteres', 'x'.repeat(61)],
    ['enlace', 'https://malo.example'],
    ['enlace sin esquema', 'www.malo.bo'],
    ['correo', 'ruben' + '@' + 'malo.bo'],
    ['dominio', 'malo.com'],
    ['dígitos largos', 'Rubén 7000001'],
    ['control', 'Ru\u0000bén'],
    ['salto', 'Ru\nbén'],
    ['bidi', 'Ru‮bén'],
    ['cero ancho', 'Ru​bén'],
    ['marca de prompt', 'Rubén [CIERRE]'],
    ['pago acreditado', 'pago acreditado'],
    ['banco', 'el banco'],
    ['no soy un bot', 'no soy un bot'],
    ['no soy una IA', 'No soy una IA'],
    ['humano', 'soy humano'],
  ])('%s: se descarta y queda vacío', (_n, valor) => {
    expect(quienAtiende({ nombreQuienAtiende: valor })).toBe('');
    expect(motivoQuienAtiendeInvalido(valor)).not.toBeNull();
  });
});
