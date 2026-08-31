/**
 * Pruebas de los rótulos del cobro simulado.
 *
 * NO NECESITAN EMULADOR: la validación es una función pura.
 *
 * Están acá porque el cargador tiene UN trabajo que importa —negarse a escribir
 * un rótulo que no se delate a sí mismo— y ese trabajo es invisible mientras los
 * textos estén bien. La prohibición 3 de CLAUDE.md dice que un cobro simulado
 * nunca se presenta como real; estas pruebas son lo que impide que esa garantía
 * se pierda en una edición futura que sólo quería "mejorar la redacción".
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — script .mjs sin tipos; se importa por sus dos exportaciones
import { TEXTOS, validar } from '../scripts/cargar-plataforma.mjs';

const sinProblemas = (t: Record<string, string>) => validar(t).length === 0;

describe('Los textos que se van a cargar', () => {
  it('pasan la validación tal como están en el repositorio', () => {
    expect(validar(TEXTOS)).toEqual([]);
  });

  it('dicen en el epígrafe y en la confirmación que el cobro es simulado', () => {
    expect(TEXTOS.epigrafe).toMatch(/SIMULAD/i);
    expect(TEXTOS.confirmacion).toMatch(/SIMULAD/i);
  });

  it('describen lo que la imagen lleva impreso arriba y abajo', () => {
    expect(TEXTOS.rotuloSuperior).toMatch(/DEMOSTRACIÓN/);
    expect(TEXTOS.rotuloSuperior).toMatch(/NO COBRA/);
    expect(TEXTOS.rotuloInferior).toMatch(/SIMULACRO DE PAGO/);
  });
});

describe('La validación se niega a dejar pasar un rótulo mudo', () => {
  it('rechaza un epígrafe al que le sacaron la palabra simulado', () => {
    const t = { ...TEXTOS, epigrafe: '🧪 DEMOSTRACIÓN — escaneá y seguimos.' };
    expect(sinProblemas(t)).toBe(false);
    expect(validar(t).join(' ')).toMatch(/epigrafe/);
  });

  it('rechaza una confirmación que suena a pago real', () => {
    const t = { ...TEXTOS, confirmacion: 'Pago verificado. ¡Gracias por tu compra!' };
    expect(sinProblemas(t)).toBe(false);
  });

  it('rechaza el vacío, que es la forma más fácil de quedarse sin rótulo', () => {
    for (const clave of Object.keys(TEXTOS)) {
      expect(sinProblemas({ ...TEXTOS, [clave]: '' })).toBe(false);
      expect(sinProblemas({ ...TEXTOS, [clave]: '   ' })).toBe(false);
    }
  });

  it('rechaza un rótulo superior que ya no afirma que el QR no cobra', () => {
    expect(sinProblemas({ ...TEXTOS, rotuloSuperior: 'DEMOSTRACIÓN' })).toBe(false);
  });
});

describe('Estilo: español boliviano sin voseo', () => {
  it('rechaza el voseo en lo que lee el cliente', () => {
    const t = { ...TEXTOS, epigrafe: TEXTOS.epigrafe.replace('Envía', 'Enviá') };
    expect(validar(t).join(' ')).toMatch(/voseo/);
  });

  it('no lo exige en los rótulos impresos, que no tienen verbo conjugado', () => {
    expect(validar(TEXTOS).join(' ')).not.toMatch(/rotulo\w+: voseo/);
  });
});
