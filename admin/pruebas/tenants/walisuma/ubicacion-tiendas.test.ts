/**
 * EL ENLACE DE MAPA DE CADA TIENDA de Walisuma (Andres, 24/11/2026). Dato por sede: coordenadas (`tiendaLaPazCoordenadas`, `tiendaSantaCruzCoordenadas`); el código arma el enlace. Se prueba NEGANDO:
 *   - ante «¿dónde queda?» el código agrega el enlace de la tienda de la ciudad que el cliente nombra, y nunca el de la otra;
 *   - en el recojo, el resumen del pedido lleva el enlace de LA tienda elegida, nunca el de la otra;
 *   - sin ciudad conocida van las dos, cada una con su nombre; sin dato (o con un enlace que no es la forma limpia) no sale nada;
 *   - 0 mensajes por conversación: el enlace viaja dentro del texto que ya sale.
 */
import { describe, expect, it } from 'vitest';
import { ANA, CATALOGO, ENTREGA, crear, entregaEnElSegundoTurno, hablar, mTexto, modelo, panelOk, textos } from './mundo';

const LP = 'https://www.google.com/maps/search/?api=1&query=-16.542254%2C-68.0799787';
const SC = 'https://www.google.com/maps/search/?api=1&query=-17.7648323%2C-63.1992316';
const MAPAS = { tiendaLaPazCoordenadas: '-16.542254,-68.0799787', tiendaSantaCruzCoordenadas: '-17.7648323,-63.1992316' };
const pregunta = (texto: string, base: Record<string, unknown> = MAPAS): string => {
  const m = crear({ panel: panelOk({ catalogo: CATALOGO.map((c) => ({ ...c })) }), modeloDice: modelo('Con gusto.'), base });
  return textos(hablar(m, ANA, mTexto(texto))).join('\n');
};

describe('el enlace de mapa por tienda (Walisuma)', () => {
  it('«¿dónde queda la tienda de La Paz?» da el enlace de La Paz y NUNCA el de Santa Cruz', () => {
    const t = pregunta('¿Dónde queda la tienda de La Paz?');
    expect(t).toContain(LP);
    expect(t).not.toContain(SC);
    expect(t).not.toContain('-17.7648323');
  });
  it('«¿dónde queda la de Santa Cruz?» da el enlace de Santa Cruz y NUNCA el de La Paz', () => {
    const t = pregunta('¿Dónde queda la tienda de Santa Cruz?');
    expect(t).toContain(SC);
    expect(t).not.toContain(LP);
    expect(t).not.toContain('-16.542254');
  });
  it('sin ciudad en la pregunta ni en la entrega: van las dos, cada una con su nombre', () => {
    const t = pregunta('¿Dónde quedan sus tiendas?');
    expect(t).toMatch(new RegExp('Tienda de La Paz[^\\n]*: ' + LP.replace(/[?]/g, '\\?')));
    expect(t).toMatch(new RegExp('Tienda de Santa Cruz[^\\n]*: ' + SC.replace(/[?]/g, '\\?')));
  });
  it('NEGADO: sin el dato, o con una forma que no son coordenadas válidas, no sale ningún enlace', () => {
    const SIN = { tiendaLaPazCoordenadas: '', tiendaSantaCruzCoordenadas: '' };
    for (const base of [SIN, { tiendaLaPazCoordenadas: 'https://evil.example/x', tiendaSantaCruzCoordenadas: '-17.7,-63.1&utm_source=x' }, { tiendaLaPazCoordenadas: '-91.000000,0.000000', tiendaSantaCruzCoordenadas: '1.0,181.0' }, { ...SIN, tiendaLaPazCoordenadas: 'REEMPLAZAR_MAPA' }]) {
      const t = pregunta('¿Dónde queda la tienda de La Paz?', base);
      expect(t).not.toMatch(/https?:\/\//);
    }
  });
  it('NEGADO: una frase que no pregunta por la ubicación no agrega enlaces', () => {
    expect(pregunta('Quiero ver las carteras')).not.toMatch(/maps/);
  });
  it('el recojo en La Paz lleva el enlace de La Paz y el de Santa Cruz, el de Santa Cruz; jamás el cruzado', () => {
    for (const [ciudad, buen, mal] of [['La Paz', LP, SC], ['Santa Cruz', SC, LP]] as const) {
      const m = crear({
        panel: panelOk({ catalogo: CATALOGO.map((c) => ({ ...c })) }),
        modeloDice: entregaEnElSegundoTurno(modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: { ...ENTREGA, ciudad } })),
        base: MAPAS,
      });
      hablar(m, ANA, mTexto('quiero una pieza'));
      const t = textos(hablar(m, ANA, mTexto('quiero pagar'))).join('\n');
      expect(t).toContain('Recoge su pedido en:');
      expect(t).toContain(buen);
      expect(t).not.toContain(mal);
    }
  });
});
