/**
 * `voz.tratamientoClave` y `voz.quienAtiende` de `configuracionFlujo`
 * (prompt.ts). El enumerado es para los TEXTOS FIJOS del código; el nombre de
 * quien atiende es texto que llega a clientes finales, así que se prueba
 * negando. 0 mensajes: solo cambia la respuesta de la configuración.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  quienAtiende, tratamientoClave, tratamientoEfectivo, instruccionesDeVoz, motivoQuienAtiendeInvalido,
  QUIEN_RE_CARACTERES, QUIEN_RE_VOCABULARIO,
} from '../../functions/src/core/prompt/prompt.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string): string => readFileSync(join(aqui, '..', '..', ruta), 'utf8');

import { ARNES_REGLA, ARNES_SOLO_NORMALIZADO } from '../lib/quien-atiende-arnes.ts';

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

describe('una sola fuente de patrones: servidor, consola y regla', () => {
  const regla = leer('firestore.rules');
  const web = leer('web/src/central/lib/payloadNegocio.ts');
  // Evalúa la expresión de cadenas de un archivo fuente (comillas y `+`) tal como la ve TypeScript.
  const valorDe = (fuente: string, nombre: string): string => {
    const ini = fuente.indexOf(`${nombre} =`);
    const fin = fuente.indexOf(';', ini);
    return runInNewContext(`(${fuente.slice(ini + nombre.length + 2, fin)})`) as string;
  };
  it('las cadenas de la regla y de la consola son las del servidor', () => {
    const enRegla = (c: string): string => c.replace(/\\/g, '\\\\');
    expect(regla).toContain(`matches('${enRegla(QUIEN_RE_CARACTERES)}')`);
    expect(regla).toContain(`matches('(?is).*(${enRegla(QUIEN_RE_VOCABULARIO)}).*')`);
    expect(valorDe(web, 'QUIEN_RE_CARACTERES')).toBe(QUIEN_RE_CARACTERES);
    expect(valorDe(web, 'QUIEN_RE_VOCABULARIO')).toBe(QUIEN_RE_VOCABULARIO);
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
