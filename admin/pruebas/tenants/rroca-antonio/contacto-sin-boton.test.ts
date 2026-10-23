/**
 * PROMESA SIN RESPALDO DEL BOTÓN (política «solo se ofrece lo que se cumple»): si quien escribe ES la recepción de Antonio,
 * `cmContactoConBoton` no puede dar un botón a su propio chat, y el texto tampoco puede nombrarlo. El resumen del turno
 * explica por qué el aviso no salió con `avisoMotivo` (`mismo_numero`).
 */
import { describe, expect, it } from 'vitest';
import { REC, crear, hablar, mTexto } from './mundo';

const FRASES = ['quiero hablar con Antonio', 'necesito una factura', 'quiero hacer un reclamo', 'quiero hablar con Antonio', 'hola'];

describe('quien escribe es la recepción: ninguna respuesta nombra un botón que no hay', () => {
  it('NIEGA: en el MISMO mundo, 5 turnos seguidos desde recepción: ningún mensaje menciona «botón», no hay dos textos iguales seguidos, y el resumen trae `mismo_numero` cuando el aviso no salió', () => {
    const w = crear();
    const cuerpos: string[] = [];
    let noSalio = 0;
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
      if (resumen['aviso'] === 'no_salio') { noSalio++; expect(resumen['avisoMotivo'], f).toBe('mismo_numero'); }
      else expect(resumen['avisoMotivo'], f).toBe('');
    }
    for (let i = 1; i < cuerpos.length; i++) expect(cuerpos[i], `turno ${i}`).not.toBe(cuerpos[i - 1]);
    expect(noSalio).toBeGreaterThan(0);
  });
});
