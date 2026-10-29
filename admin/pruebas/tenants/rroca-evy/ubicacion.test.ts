/**
 * LA UBICACIÓN (humo del 28/10/2026): «¿Cuál es la ubicación?» recibió la dirección en texto y nunca el mapa, porque el prompt prohíbe enlaces al modelo.
 * Ahora el CÓDIGO agrega «📍 Ubicación: <enlace de la Consola>» a la respuesta del modelo cuando el cliente la pide y el enlace es válido; si no, nada cambia.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, crear, dice, hablar, mTexto, panelOk, textos } from './mundo';

const MAPS = 'https://www.google.com/maps?q=-17.7784569,-63.1591787';
const conMaps = (valor: unknown) => { const p = panelOk(); (p.body['datosDelNegocio'] as J)['direccionMaps'] = valor; return p; };
const unaVez = (panel: ReturnType<typeof panelOk>, q: string) => {
  const m = crear({ modeloDice: dice('Atendemos en nuestra clínica, en la dirección de la Consola.'), panel });
  hablar(m, ANA, mTexto('Hola'));
  return textos(hablar(m, ANA, mTexto(q))).join('\n');
};

describe('el enlace de ubicación lo pone el código', () => {
  for (const q of ['cual es la ubicación?', 'Me das la ubicación exacta?', '¿Dónde quedan?', '¿Cuál es su dirección?', 'cómo llego']) {
    it(`POSITIVA: «${q}» con enlace válido en la Consola`, () => {
      const t = unaVez(conMaps(MAPS), q);
      expect(t, q).toContain(`📍 Ubicación: ${MAPS}`);
    });
  }
  for (const q of ['¿Cuánto cuesta?', 'quiero conocer los tratamientos']) {
    it(`NEGADA: «${q}» no lleva el enlace aunque la Consola lo tenga`, () => {
      expect(unaVez(conMaps(MAPS), q), q).not.toContain('📍');
    });
  }
  for (const [nombre, valor] of [['vacío', ''], ['http', 'http://www.google.com/maps?q=1,2'], ['otro dominio', 'https://www.google.com.bo/maps/place/x'], ['con espacios', 'https://www.google.com/maps?q=1, 2'], ['no texto', 42]] as const) {
    it(`NEGADA: enlace ${nombre} en la Consola: no sale ninguna línea`, () => {
      expect(unaVez(conMaps(valor), 'cual es la ubicación?')).not.toContain('📍');
    });
  }
});
