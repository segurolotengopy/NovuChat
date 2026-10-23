/**
 * PROMESA SIN RESPALDO DEL BOTÓN (política «solo se ofrece lo que se cumple»): si quien escribe ES la recepción de Antonio,
 * `cmContactoConBoton` no puede dar un botón a su propio chat, y el texto tampoco puede nombrarlo. El resumen del turno
 * explica por qué el aviso no salió con `avisoMotivo` (`mismo_numero`).
 */
import { describe, expect, it } from 'vitest';
import { REC, crear, hablar, mTexto } from './mundo';

const FRASES = ['quiero hablar con Antonio', 'necesito una factura', 'quiero hacer un reclamo', 'hola'];

describe('quien escribe es la recepción: ninguna respuesta nombra un botón que no hay', () => {
  it('NIEGA: ningún mensaje (texto, interactivo, respaldo) menciona «botón»; el resumen del turno trae el motivo cuando el aviso no salió', () => {
    for (const f of FRASES) {
      const w = crear();
      const t = hablar(w, REC, mTexto(f));
      for (const m of t.mensajes) {
        expect(JSON.stringify(m.payload), f).not.toMatch(/bot[oó]n/i);
        expect(m.cuerpo, f).not.toMatch(/bot[oó]n/i);
        expect(JSON.stringify(m.payload), f).not.toContain('wa.me/' + REC);
      }
      const resumen = (t.porNodo['Armar mensajes']?.[0]?.['resumen'] ?? {}) as Record<string, unknown>;
      if (resumen['aviso'] === 'no_salio') expect(resumen['avisoMotivo'], f).toBe('mismo_numero');
      else expect(resumen['avisoMotivo'], f).toBe('');
    }
  });
});
