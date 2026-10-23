/**
 * LAS DOCTORAS — LO VIVO MANDA (regla de Andres, 22/10/2026): la dirección y el horario que ya viven en la Consola (`/config/negocio`, por «Traer configuración») no se incrustan en el flujo.
 * Se escribe NEGANDO: sin dirección en la consola el flujo no la inventa ni da la del otro tenant (pasa a recepción con el botón); la consola manda sobre el respaldo del horario; una consola que
 * responde por OTRO tenant no se cree; la consola caída o suspendida no deja al cliente sin respuesta; 0 mensajes agregados.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { ANA, REC, TENANTS, crear, datosDe, hablar, mBoton, mTexto, negocioDe, panelOk, textos, type Tenant } from './mundo';
import { vigilarUx } from './vigilante-ux';

const AP = { avisoSolicitudEstado: 'APPROVED' };
const otra = (t: Tenant): Tenant => (t === 'rroca-evy' ? 'rroca-emma' : 'rroca-evy');
const mundo = (tenant: Tenant, panel?: { statusCode: number; body: J } | 'cae', base: J = {}): Mundo => { const w = crear({ tenant, panel, base: { ...AP, ...base } }); vigilarUx(w); return w; };
const saludada = (tenant: Tenant, panel?: { statusCode: number; body: J } | 'cae', base: J = {}): Mundo => { const w = mundo(tenant, panel, base); hablar(w, ANA, mTexto('hola')); return w; };
const pregunta = (w: Mundo, q: string) => hablar(w, ANA, mTexto(q));
const LITERALES_DE_LA_DIRECCION: Record<Tenant, string[]> = { 'rroca-evy': ['Piraí', 'Sapocó'], 'rroca-emma': ['Pauserna', 'Cotoca'] };
const sinDireccion = (t: Tenant) => panelOk({ datosDelNegocio: { nombreNegocio: 'x' } }, t);

describe('la DIRECCIÓN sale de la consola y de nada más', () => {
  for (const t of TENANTS) {
    it(`${t}: ni el dato de la doctora ni el flujo versionado traen la dirección; la dice la consola`, () => {
      expect(datosDe(t)['doctora']).not.toHaveProperty('direccion');
      const d = JSON.stringify(datosDe(t)['doctora']);
      for (const l of LITERALES_DE_LA_DIRECCION[t]) expect(d.includes(l)).toBe(false);
      const r = pregunta(saludada(t), '¿dónde queda?');
      expect(r.mensajes[0]!.cuerpo).toContain(String(negocioDe(t)['direccion']));
    });

    it(`${t}: la consola sin dirección, caída (503), vacía o con un marcador: NO se inventa ni se da la del otro; pasa a recepción con el botón`, () => {
      const casos: Array<[string, { statusCode: number; body: J } | 'cae']> = [
        ['sin dirección', sinDireccion(t)],
        ['dirección vacía', panelOk({ datosDelNegocio: { direccion: '   ' } }, t)],
        ['dirección con marcador', panelOk({ datosDelNegocio: { direccion: 'REEMPLAZAR_DIRECCION' } }, t)],
        ['con un enlace de mapas', panelOk({ datosDelNegocio: { direccion: 'ver en https://maps.google.com/x' } }, t)],
        ['caída', 'cae'],
        ['suspendida (409)', { statusCode: 409, body: { mensajeCortesia: 'x' } }],
      ];
      for (const [rotulo, panel] of casos) {
        const w = saludada(t, panel);
        const r = pregunta(w, '¿dónde queda?');
        const cuerpo = r.mensajes[0]?.cuerpo ?? '';
        if (panel !== 'cae' && panel.statusCode === 409) { expect(cuerpo, rotulo).not.toMatch(/Piraí|Pauserna|Sapocó|Cotoca/); continue; }
        expect(cuerpo, rotulo).toMatch(/dirección exacta te la confirma la recepción/);
        for (const l of [...LITERALES_DE_LA_DIRECCION[t], ...LITERALES_DE_LA_DIRECCION[otra(t)]]) expect(cuerpo.includes(l), `${rotulo}: «${l}»`).toBe(false);
        expect(r.mensajes[0]!.tipo, rotulo).toBe('interactive');
        expect(JSON.stringify(r.mensajes[0]!.payload), rotulo).toContain('cta_url');
        expect(cuerpo, rotulo).not.toMatch(/Dirección:|maps|https?:/);
      }
    });

    it(`${t}: sin dirección en la consola, el cierre de la solicitud no lleva el párrafo «Atendemos en…» (ni queda un hueco)`, () => {
      const w = saludada(t, sinDireccion(t));
      hablar(w, ANA, mBoton('a_agendar')); hablar(w, ANA, mBoton('c_si1')); hablar(w, ANA, mTexto('Ana')); hablar(w, ANA, mBoton('n_este'));
      const r = hablar(w, ANA, mTexto('el lunes en la tarde'));
      const todo = textos(r).join('\n');
      expect(todo).toMatch(/Ya pasé tu solicitud a la recepción/);
      expect(todo).not.toMatch(/Atendemos en|: \.|undefined|\{direccion\}/);
    });
  }
});

describe('el HORARIO: manda la consola; el respaldo del dato solo cuando la consola no lo trae', () => {
  const CONSOLA_DISTINTA = 'lunes a sábado, de 10:00 a 11:00';
  for (const t of TENANTS) {
    it(`${t}: la consola con un horario DISTINTO del respaldo: se dice el de la consola, nunca el del dato`, () => {
      const respaldo = (datosDe(t)['doctora'] as J)['horario'];
      const w = saludada(t, panelOk({ operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'], horarioAtencion: CONSOLA_DISTINTA } }, t),
        { doctora: JSON.stringify({ ...(datosDe(t)['doctora'] as J), horario: 'de lunes a viernes de 06:00 a 07:00' }) });
      const cuerpo = pregunta(w, '¿qué horarios tienen?').mensajes[0]!.cuerpo;
      expect(cuerpo).toContain(`Atendemos ${CONSOLA_DISTINTA}`);
      expect(cuerpo).not.toMatch(/06:00|07:00/);
      if (respaldo) expect(cuerpo).not.toContain(String(respaldo));
    });
  }

  it('Evy: sin horario en la consola NO hay respaldo (su dato no lo trae): no se dice ninguno y pasa a recepción', () => {
    const w = saludada('rroca-evy', panelOk({ operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'], horarioAtencion: '' } }));
    const cuerpo = pregunta(w, '¿qué horarios tienen?').mensajes[0]!.cuerpo;
    expect(cuerpo).toMatch(/lo confirma la recepción/);
    expect(cuerpo).not.toMatch(/lunes|\d{1,2}:\d{2}/i);
  });

  it('Emma (turno partido): la consola no lo admite y conserva su respaldo; con la consola caída también lo dice', () => {
    for (const panel of [undefined, 'cae' as const]) {
      const cuerpo = pregunta(saludada('rroca-emma', panel), '¿qué horarios tienen?').mensajes[0]!.cuerpo;
      expect(cuerpo).toMatch(/Atendemos de lunes a viernes de 09:00 a 12:00 y de 14:00 a 18:00, y los sábados de 09:00 a 12:00/);
      expect(cuerpo).not.toMatch(/08:30|18:30/);
    }
  });

  it('Evy con la consola caída: el horario y la dirección no se inventan; el cliente sigue con respuesta y botón', () => {
    const w = saludada('rroca-evy', 'cae');
    const h = pregunta(w, '¿qué horarios tienen?');
    expect(h.mensajes[0]!.cuerpo).toMatch(/lo confirma la recepción/);
    expect(h.mensajes[0]!.cuerpo).not.toMatch(/\d{1,2}:\d{2}/);
    expect(JSON.stringify(h.mensajes[0]!.payload)).toContain('cta_url');
  });
});

describe('TENANT CRUZADO: una consola que responde por OTRA doctora no se cree', () => {
  for (const t of TENANTS) {
    it(`${t}: con la respuesta de la consola de ${otra(t)}, no dice su dirección ni su horario`, () => {
      const ajena = panelOk({}, otra(t));
      const w = saludada(t, ajena);
      const donde = pregunta(w, '¿dónde queda?').mensajes[0]!.cuerpo;
      const hora = pregunta(w, '¿qué horarios tienen?').mensajes[0]?.cuerpo ?? '';
      for (const l of LITERALES_DE_LA_DIRECCION[otra(t)]) { expect(donde.includes(l)).toBe(false); expect(hora.includes(l)).toBe(false); }
      expect(donde).toMatch(/dirección exacta te la confirma la recepción/);
      if (t === 'rroca-evy') { expect(hora).not.toMatch(/14:00|18:00/); expect(hora).toMatch(/lo confirma la recepción/); }
      else expect(hora).not.toMatch(/08:30|18:30/);   // Emma cae a SU respaldo
    });
  }

  it('un flujo sin tenantId en «Config base» no cree a la consola (falla cerrado)', () => {
    const w = saludada('rroca-evy', undefined, { tenantId: '' });
    expect(pregunta(w, '¿dónde queda?').mensajes[0]!.cuerpo).toMatch(/dirección exacta te la confirma la recepción/);
  });

  it('cada flujo versionado trae SU tenantId en «Config base» (y el de la otra no)', () => {
    for (const t of TENANTS) expect((datosDe(t)['configBase'] as J)['tenantId']).toBe(t);
  });
});

describe('0 mensajes agregados', () => {
  it('«dónde», «horario» y el cierre siguen siendo UN mensaje por turno, con o sin dato de la consola', () => {
    for (const t of TENANTS) for (const panel of [undefined, sinDireccion(t), 'cae' as const]) {
      const w = saludada(t, panel);
      expect(pregunta(w, '¿dónde queda?').mensajes).toHaveLength(1);
      expect(pregunta(w, '¿qué horarios tienen?').mensajes).toHaveLength(1);
    }
  });
});
