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

/**
 * Las tres formas en que la carga no funciona no son defectos: son estados
 * normales de un proyecto a medio armar. Lo que sí sería un defecto es que
 * salgan como una traza cruda del SDK, porque eso se lee como "algo se rompió"
 * en lugar de "falta un paso" — que fue exactamente lo que pasó la primera vez
 * que Andres corrió el script.
 */
// @ts-expect-error — script .mjs sin tipos
import { explicar } from '../scripts/cargar-plataforma.mjs';

describe('Traducción de las fallas esperables', () => {
  const P = 'novuchat-admin-dev';

  it('la API apagada dice cómo encenderla, y avisa que falta un paso más', () => {
    const e = { code: 7, message: 'Cloud Firestore API has not been used in project' };
    const r = explicar(e, P).join('\n');
    expect(r).toMatch(/API de Cloud Firestore esta apagada/);
    expect(r).toMatch(/gcloud services enable firestore.googleapis.com --project=novuchat-admin-dev/);
    expect(r).toMatch(/CREAR la base/);
  });

  it('la base inexistente advierte que la región es permanente', () => {
    const r = explicar({ code: 5, message: 'NOT_FOUND' }, P).join('\n');
    expect(r).toMatch(/no tiene ninguna base/);
    expect(r).toMatch(/gcloud firestore databases create/);
    expect(r).toMatch(/PERMANENTE/);
  });

  it('la falta de credenciales manda a application-default login', () => {
    const r = explicar({ message: 'Could not load the default credentials' }, P).join('\n');
    expect(r).toMatch(/gcloud auth application-default login/);
  });

  it('el permiso faltante nombra el rol', () => {
    const r = explicar({ code: 7, message: 'PERMISSION_DENIED' }, P).join('\n');
    expect(r).toMatch(/roles\/datastore\.user/);
  });

  it('lo no previsto se dice como no previsto, sin inventar un remedio', () => {
    const r = explicar({ message: 'algo rarísimo' }, P);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/no previsto/);
  });

  it('no confunde la API apagada con el permiso, que comparten el código 7', () => {
    const apagada = { code: 7, message: 'Cloud Firestore API has not been used in project' };
    expect(explicar(apagada, P).join('\n')).not.toMatch(/roles\/datastore/);
  });
});
