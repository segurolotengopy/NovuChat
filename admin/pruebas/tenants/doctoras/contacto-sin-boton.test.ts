/**
 * PROMESA SIN RESPALDO DEL BOTÓN (política «solo se ofrece lo que se cumple»): si quien escribe ES la recepción de la doctora,
 * no hay botón a su propio chat y el texto tampoco lo nombra. El resumen del turno explica por qué el aviso no salió
 * con `avisoMotivo` (`mismo_numero`).
 */
import { describe, expect, it } from 'vitest';
import { REC, crear, hablar, mBoton, mTexto } from './mundo';

const FRASES = ['quiero hablar con la doctora', 'necesito una factura', 'quiero hacer un reclamo', 'quiero hablar con la doctora', 'hola'];

describe('quien escribe es la recepción: ninguna respuesta nombra un botón que no hay', () => {
  it('NIEGA: en el MISMO mundo, 5 turnos seguidos desde recepción: ningún mensaje menciona «botón», no hay dos textos iguales seguidos, y el resumen trae `mismo_numero` cuando el aviso no salió', () => {
    const w = crear();
    const cuerpos: string[] = [];
    for (const f of FRASES) {
      const t = hablar(w, REC, mTexto(f));
      expect(t.mensajes.length, f).toBeGreaterThan(0);
      for (const m of t.mensajes) {
        expect(JSON.stringify(m.payload), f).not.toMatch(/bot[oó]n/i);
        expect(m.cuerpo, f).not.toMatch(/bot[oó]n/i);
        expect(JSON.stringify(m.payload), f).not.toContain('wa.me/' + REC);
        cuerpos.push(m.cuerpo);
      }
      const resumen = (t.porNodo['Armar mensajes']?.[0]?.['resumen'] ?? {}) as Record<string, unknown>;
      if (resumen['aviso'] === 'no_salio') expect(resumen['avisoMotivo'], f).toBe('mismo_numero');
      else expect(resumen['avisoMotivo'], f).toBe('');
    }
    for (let i = 1; i < cuerpos.length; i++) expect(cuerpos[i], `turno ${i}`).not.toBe(cuerpos[i - 1]);
  });

  it('NIEGA: la solicitud de valoración completa hecha desde el número de recepción cierra sin botón, sin «te escribirá» y con `mismo_numero`', () => {
    const w = crear();
    hablar(w, REC, mTexto('hola'));
    hablar(w, REC, mBoton('a_agendar'));
    hablar(w, REC, mBoton('c_si1'));
    hablar(w, REC, mTexto('Me llamo María López'));
    hablar(w, REC, mBoton('n_este'));
    const fin = hablar(w, REC, mTexto('el jueves en la tarde'));
    expect(fin.mensajes.length).toBeGreaterThan(0);
    for (const m of fin.mensajes) {
      expect(JSON.stringify(m.payload)).not.toMatch(/bot[oó]n|wa\.me/i);
      expect(m.cuerpo).not.toMatch(/te escribir|ya pas[eé] tu solicitud/i);
    }
    const resumen = (fin.porNodo['Armar mensajes']?.[0]?.['resumen'] ?? {}) as Record<string, unknown>;
    expect(resumen['aviso']).toBe('no_salio');
    expect(resumen['avisoMotivo']).toBe('mismo_numero');
  });
});
