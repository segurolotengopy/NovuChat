/**
 * LA CLAVE DE LA SESIÓN en el esqueleto de Walisuma: es `messages[0].from`, nunca otro dato. Dos clientes jamás comparten ficha.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BETO, EXTRANJERO, crear, entrega, hablar, mSticker, mTexto, valorMeta } from './mundo';

const fichas = (m: ReturnType<typeof crear>): Record<string, any> => (m.sd['walisuma'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('ficha por teléfono', () => {
  it('dos teléfonos intercalados no comparten ficha: cada uno tiene la suya, con sus propios ids y turnos', () => {
    const m = crear();
    hablar(m, ANA, mTexto('hola'), { wamid: 'wamid.A1' });
    hablar(m, BETO, mTexto('buenas'), { wamid: 'wamid.B1' });
    hablar(m, ANA, mTexto('otra cosa'), { wamid: 'wamid.A2' });
    hablar(m, BETO, mSticker(), { wamid: 'wamid.B2' });
    const f = fichas(m);
    expect(Object.keys(f).sort()).toEqual([ANA, BETO].sort());
    expect(f[ANA].ultimosIds).toEqual(['wamid.A1', 'wamid.A2']);
    expect(f[BETO].ultimosIds).toEqual(['wamid.B1', 'wamid.B2']);
    expect(f[ANA].turnos).toBe(2);
    expect(f[BETO].turnos).toBe(2);
    // El sticker de Beto lo saludó a él, no a Ana.
    expect(f[BETO].saludado).toBe(true);
    expect(f[ANA].saludado).toBe(false);
  });
  it('la clave es `messages[0].from`: ni el wa_id del contacto ni el cuerpo la reemplazan', () => {
    const m = crear();
    hablar(m, ANA, mTexto(`soy ${BETO}`), { contacto: BETO });
    expect(Object.keys(fichas(m))).toEqual([ANA]);
  });
  it('NEGADO: un `from` que no son 6 a 20 dígitos (o que toca el prototipo) se descarta sin ficha y sin respuesta', () => {
    for (const malo of ['__proto__', 'constructor', '59100000011; drop', '12345', '']) {
      const m = crear();
      const t = m.turno(entrega(valorMeta(mTexto('hola'), malo)));
      expect(t.mensajes).toHaveLength(0);
      expect(Object.keys(fichas(m))).toEqual([]);
      expect(({} as Record<string, unknown>)['ultimosIds']).toBeUndefined();
    }
  });
  it('un turno que no sale (bloqueado) igual deja la ficha de ESE teléfono con el id visto, y no toca la de otro', () => {
    const m = crear({ ingesta: { atencion: { estado: 'bloqueado' } } });
    hablar(m, ANA, mTexto('hola'), { wamid: 'wamid.A9' });
    expect(fichas(m)[ANA].ultimosIds).toEqual(['wamid.A9']);
    expect(fichas(m)[BETO]).toBeUndefined();
  });
});

describe('«Resumen del turno» devuelve a la ficha lo que no salió (reversión genérica)', () => {
  it('si Meta rechaza el envío y su respaldo, `fueraDePaisMs` vuelve a 0 y el siguiente mensaje del número de otro país sí recibe el texto', () => {
    const m = crear({ envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    const t = hablar(m, EXTRANJERO, mTexto('hello'), { toleraFallo: true });
    expect(t.fallo?.mensaje ?? '').toMatch(/Entrega fallida/);
    expect(fichas(m)[EXTRANJERO].fueraDePaisMs).toBe(0);
  });
  it('si el envío salió, `fueraDePaisMs` queda marcado y no se repite el texto en 24 horas', () => {
    const m = crear();
    hablar(m, EXTRANJERO, mTexto('hello'));
    expect(fichas(m)[EXTRANJERO].fueraDePaisMs).toBeGreaterThan(0);
  });
});
