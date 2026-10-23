/**
 * LAS DOCTORAS — MULTI-TENANT ESTRICTO (plan §7, punto 10): un mismo teléfono que escribe a las dos doctoras no comparte ficha ni texto; ningún literal de una doctora aparece en la conversación o en el JSON de
 * la otra; «el horario que se dice a la persona es el de Emma» y el flujo de Evy, que aún no tiene horario, nunca dice uno.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { ANA, CARPETA, TENANTS, crear, datosDe, negocioDe, hablar, mBoton, mLista, mTexto, textos, type Tenant } from './mundo';
import { vigilarUx } from './vigilante-ux';

const LITERALES: Record<Tenant, string[]> = {
  'rroca-evy': ['Evy', 'DentalCor', 'HArmonyCa', 'Piraí', 'Sapocó'],
  'rroca-emma': ['Emma', 'Sculptra', 'Spa Medic', 'Pauserna', 'Cotoca'],
};
const otra = (t: Tenant): Tenant => (t === 'rroca-evy' ? 'rroca-emma' : 'rroca-evy');
const mundo = (tenant: Tenant, base: J = {}): Mundo => { const w = crear({ tenant, base: { avisoSolicitudEstado: 'APPROVED', ...base } }); vigilarUx(w); return w; };

/** La conversación completa con una doctora: todo lo que sale a la persona y a la recepción. */
function conversar(tenant: Tenant, tel = ANA, base: J = {}): { w: Mundo; salida: string[]; avisos: string[] } {
  const w = mundo(tenant, base);
  const salida: string[] = []; const avisos: string[] = [];
  const paso = (msg: J): void => { const t = hablar(w, tel, msg); salida.push(...textos(t), ...t.mensajes.map((m) => JSON.stringify(m.payload))); avisos.push(...t.avisos.map((a) => JSON.stringify(a.payload))); };
  for (const m of [mTexto('Hola, vi su anuncio y quiero agendar mi valoración gratuita'), mTexto('¿dónde queda?'), mTexto('¿qué horarios tienen?'), mTexto('¿cuánto cuesta?'), mTexto('¿qué tratamientos hay?'),
    mLista('t_' + (datosDe(tenant)['doctora'] as J)['tratamientos'][0].id), mTexto('¿eres un bot?'), mTexto('¿cuál es mejor?'), mBoton('a_agendar'), mBoton('c_si1'), mTexto('Ana'), mBoton('n_este'), mTexto('el lunes')]) paso(m);
  return { w, salida, avisos };
}

describe('un mismo teléfono escribe a las DOS doctoras', () => {
  it('cada flujo tiene su ficha: el consentimiento y el avance con una no pasan a la otra', () => {
    const evy = mundo('rroca-evy'); const emma = mundo('rroca-emma');
    hablar(evy, ANA, mTexto('hola')); hablar(evy, ANA, mBoton('a_agendar')); hablar(evy, ANA, mBoton('c_si1'));
    expect((evy.sd['doctoras'] as J)[ANA]['consentimiento']).toBe('si');
    const t = hablar(emma, ANA, mTexto('quiero agendar'));
    expect(t.mensajes.map((m) => m.tipo)).toEqual(['text', 'text']);   // para Emma es el primer turno: se presenta
    expect(textos(t)[0]).toMatch(/asistente virtual de la Dra\. Emma \(Emma Spa Medic\)/);
    expect((emma.sd['doctoras'] as J)[ANA]['consentimiento']).toBe('');
    // Y el consentimiento de Evy no habilita un aviso en el flujo de Emma.
    const e2 = hablar(emma, ANA, mTexto('estoy embarazada'));
    expect(e2.avisos).toHaveLength(0);
  });

  for (const tenant of TENANTS) {
    it(`${tenant}: ningún texto ni aviso de la conversación nombra a la OTRA doctora (nombre, clínica, producto, dirección)`, () => {
      const { salida, avisos } = conversar(tenant);
      const todo = [...salida, ...avisos].join('\n');
      for (const l of LITERALES[otra(tenant)]) expect(todo.includes(l), `${tenant} nombra «${l}»`).toBe(false);
      for (const l of [LITERALES[tenant][0]!, LITERALES[tenant][1]!]) expect(todo.includes(l), `${tenant} debería nombrar «${l}»`).toBe(true);
    });

    it(`${tenant}: el JSON armado no lleva ningún literal de la otra doctora`, () => {
      for (const sufijo of ['', '.prueba']) {
        const json = readFileSync(`${CARPETA}/doctoras.${tenant}${sufijo}.json`, 'utf8');
        for (const l of LITERALES[otra(tenant)]) expect(json.includes(l), `${tenant}${sufijo} nombra «${l}»`).toBe(false);
      }
    });
  }

  it('el horario que se dice es el de CADA doctora: cada una dice el suyo y nunca el de la otra', () => {
    const emma = conversar('rroca-emma').salida.join('\n');
    expect(emma).toMatch(/Atendemos de lunes a viernes de 09:00 a 12:00 y de 14:00 a 18:00, y los sábados de 09:00 a 12:00/);
    expect(emma).not.toMatch(/08:30|18:30/);
    const evy = conversar('rroca-evy').salida.join('\n');
    // Evy lo dice de la CONSOLA (negocio.horarios, derivado por el servidor); su dato ya no lo trae.
    expect(evy).toMatch(/Atendemos lunes a viernes, de 08:30 a 18:30; sábado, de 09:00 a 12:00; domingo: cerrado/);
    expect(evy).not.toMatch(/14:00|18:00/);
    expect(datosDe('rroca-evy')['doctora']).not.toHaveProperty('horario');
    // Emma: la consola no trae horario (turno partido) y su respaldo es un marcador: no se dice ninguno.
    const marcador = conversar('rroca-emma', ANA, { doctora: JSON.stringify({ ...(datosDe('rroca-emma')['doctora'] as J), horario: 'REEMPLAZAR_HORARIO' }) });
    expect(marcador.salida.join('\n')).not.toMatch(/REEMPLAZAR|Atendemos de|Atendemos lunes/);
  });

  it('la dirección (de la consola de CADA una), la clínica y la plantilla de cada aviso salen de lo de CADA una', () => {
    for (const tenant of TENANTS) {
      const d = datosDe(tenant)['doctora'] as J;
      expect(d).not.toHaveProperty('direccion');
      const { salida, avisos } = conversar(tenant);
      expect(salida.join('\n')).toContain(String(negocioDe(tenant)['direccion']));
      expect(salida.join('\n')).toContain(String(d['clinica']));
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toContain('aviso_solicitud_valoracion');
    }
  });

  it('cada doctora lleva SUS tratamientos en la lista (y los de la otra no)', () => {
    for (const tenant of TENANTS) {
      const w = mundo(tenant); hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto('hola'));
      const filas = JSON.stringify(t.mensajes[0]!.payload);
      for (const tr of (datosDe(tenant)['doctora'] as J)['tratamientos'] as J[]) expect(filas).toContain(`t_${tr['id']}`);
    }
    const emma = mundo('rroca-emma'); hablar(emma, ANA, mTexto('hola'));
    expect(JSON.stringify(hablar(emma, ANA, mTexto('hola')).mensajes[0]!.payload)).not.toContain('t_har');
  });

  it('«Dra. Emma» (no «Enma»): es el nombre que dicen sus artes y prellenados', () => {
    const w = mundo('rroca-emma');
    const t = hablar(w, ANA, mTexto('Hola Dra. Emma, vi su anuncio de bioestimuladores y quiero agendar mi valoración gratuita 🙌'));
    expect(textos(t)[0]).toMatch(/Dra\. Emma/);
    expect(textos(t).join(' ')).not.toMatch(/Enma/);
  });
});
