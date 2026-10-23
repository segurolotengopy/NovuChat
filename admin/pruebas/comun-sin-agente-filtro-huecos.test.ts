/**
 * LOS 4 HUECOS DEL FILTRO DE REDACCIÓN SEGURA (`Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js`):
 * tope de oraciones configurable, datos de pago, afirmar compra/entrega y promesas de aviso. Todas son opciones OPT-IN:
 * apagadas, el filtro se comporta como antes. Banco: `fixtures/redaccion-segura-huecos.json`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(AQUI, '../../Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const F = ejecutar(`${FUENTE}\nreturn [{ json: { cmMotivoDeRechazo, cmPulirRedaccion } }];`, [{}])[0] as Record<'cmMotivoDeRechazo' | 'cmPulirRedaccion', Fn>;
const motivo = (t: string, o?: object): string => F.cmMotivoDeRechazo(t, o);

interface Grupo { opcion: string; motivo: string; rechazos: string[]; pasan: string[]; conAvisoRespaldado?: { pasan: string[]; rechazos: string[] } }
const BANCO = JSON.parse(readFileSync(join(AQUI, 'fixtures/redaccion-segura-huecos.json'), 'utf8')) as { grupos: Grupo[] };
// Los montos los dice el código; el banco prueba la opción, así que se permiten para que el motivo sea el de la opción.
const base = { permitirMontos: true };

for (const g of BANCO.grupos) {
  describe(`opción ${g.opcion}`, () => {
    // Lo que una regla de NovuChat que no se apaga ya rechazaba (`promesa`, `afirma_un_hecho`) sigue con ese motivo; lo NUEVO, con el de la opción.
    for (const t of g.rechazos) it(`rechaza «${t}»`, () => expect(motivo(t, { ...base, [g.opcion]: true }), t).toBe(motivo(t, base) || g.motivo));
    for (const t of g.pasan) it(`deja pasar «${t}»`, () => expect(motivo(t, { ...base, [g.opcion]: true }), t).toBe(''));
    it('apagada (por defecto) no cambia nada: ningún rechazo es de esta opción', () => {
      for (const t of g.rechazos) expect(motivo(t, base), t).not.toBe(g.motivo);
    });
    it('encendida con el texto invisible (etiquetas U+E00xx) o separadores no se evade', () => {
      const tag = (x: string): string => [...x].map((c, i) => (i % 2 ? String.fromCodePoint(0xe0061) : '') + c).join('');
      for (const t of g.rechazos.slice(0, 4)) expect(motivo(tag(t), { ...base, [g.opcion]: true }), t).not.toBe('');
    });
  });
}

describe('avisoRespaldado: el aviso al equipo se puede decir, el aviso al cliente no', () => {
  const g = BANCO.grupos.find((x) => x.opcion === 'sinPromesasDeAviso')!;
  const o = { ...base, sinPromesasDeAviso: true, avisoRespaldado: true };
  for (const t of g.conAvisoRespaldado!.pasan) it(`pasa «${t}»`, () => expect(motivo(t, o), t).toBe(''));
  for (const t of g.conAvisoRespaldado!.rechazos) it(`rechaza «${t}»`, () => expect(motivo(t, o), t).not.toBe(''));
  it('sin avisoRespaldado, «le avisamos al equipo» se rechaza', () => {
    expect(motivo('Le avisamos al equipo', { ...base, sinPromesasDeAviso: true })).not.toBe('');
    expect(motivo('Le avisamos al equipo', base)).not.toBe('');
  });
});

describe('las reglas de NovuChat siguen mandando con las opciones encendidas', () => {
  const todas = { ...base, sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true, avisoRespaldado: true };
  it('pago acreditado, negar ser IA y enlaces ajenos', () => {
    expect(motivo('Tu pago fue acreditado', todas)).toBe('afirma_un_hecho');
    expect(motivo('Recibimos tu pago', todas)).toBe('afirma_un_hecho');
    expect(motivo('No soy un bot', todas)).toBe('afirma_un_hecho');
    expect(motivo('Mira https://ejemplo.mx/x', todas)).toBe('enlace_ajeno');
  });
  it('un texto honesto con todo encendido sale', () => {
    expect(motivo('El libro cuesta 49 Bs e incluye 4 bonos. ¿Quieres que te cuente más?', todas)).toBe('');
  });
});

describe('opción maxOraciones', () => {
  const t4 = 'Uno dos. Tres cuatro. Cinco seis. Siete ocho. ¿Te sirve?';
  it('apagada no limita (como antes)', () => {
    expect(motivo(t4)).toBe('');
    expect(F.cmPulirRedaccion(t4)).toBe(t4);
  });
  it('encendida rechaza lo que pasa del tope y acepta lo que no', () => {
    expect(motivo(t4, { maxOraciones: 3 })).toBe('largo_en_oraciones');
    expect(motivo('Uno dos. Tres cuatro. ¿Te sirve?', { maxOraciones: 3 })).toBe('');
    expect(motivo(t4, { maxOraciones: 5 })).toBe('');
  });
  it('«Dr.» y los decimales no cuentan como oración', () => {
    expect(motivo('El Dr. Pérez atiende. Cuesta 49.50 Bs. ¿Te sirve?', { maxOraciones: 3, permitirMontos: true })).toBe('');
  });
  it('pulir recorta al tope y conserva la pregunta final', () => {
    expect(F.cmPulirRedaccion(t4, { maxOraciones: 3 })).toBe('Uno dos. Tres cuatro. ¿Te sirve?');
    expect(F.cmPulirRedaccion('Uno dos. Tres cuatro. Cinco seis. Siete ocho.', { maxOraciones: 3 })).toBe('Uno dos. Tres cuatro. Cinco seis.');
    const p = F.cmPulirRedaccion(t4, { maxOraciones: 3 });
    expect(motivo(p, { maxOraciones: 3 })).toBe('');
  });
});

describe('costo: con todo encendido, un texto adversarial de 2000 caracteres no se cuelga', () => {
  it('termina en menos de 1 s', () => {
    const o = { maximo: 2000, permitirMontos: true, sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true };
    const malos = ['ya ' + 'a '.repeat(990), 'cuenta ' + '1 '.repeat(990), 'te ' + 'avisa '.repeat(330), 'tu pedido ' + 'esta, '.repeat(300), 'p'.repeat(1990)];
    const t0 = Date.now();
    for (const m of malos) motivo(m.slice(0, 2000), o);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
