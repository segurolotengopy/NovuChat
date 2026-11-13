/**
 * LA RESPUESTA LIBRE, PURA (12/11/2026, PR B / P2): el saneo, los datos versionados de Q'Taco y el script de Plataforma.
 * Sin emulador ni nube. El cableado en `configuracionFlujo` está en `respuesta-libre-ingesta.test.ts` (emulador).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { respuestaLibreParaElFlujo, sanearRespuestaLibre } from '../../functions/src/core/conversacion/respuestaLibre';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r: string) => readFileSync(join(ADMIN, r), 'utf8');
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('el saneo', () => {
  it('devuelve {} salvo con activo === true exacto', () => {
    for (const d of [undefined, null, {}, { activo: false }, { activo: 'true' }, { activo: 1 }, { acuse: 'x' }, [], 'texto', 5]) {
      expect(respuestaLibreParaElFlujo(d as never), JSON.stringify(d)).toEqual({});
    }
  });
  it('con activo:true recorta a los topes y no parte un emoji', () => {
    const r = respuestaLibreParaElFlujo({ activo: true, acuse: '🌮'.repeat(400), textoHumor: 'x'.repeat(900), textoQueja: '🌮'.repeat(400) }).respuestaLibre!;
    expect(Array.from(r.acuse!).length).toBe(300);
    expect(r.acuse).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(r.textoHumor!.length).toBe(300);
    expect(Array.from(r.textoQueja!).length).toBe(300);
  });
  it('NEGADO: tipos basura se omiten y los campos ajenos no pasan', () => {
    const r = sanearRespuestaLibre({ activo: true, acuse: 3, textoHumor: '  ', textoRechazo: {}, tono: 'a', prohibidos: ['a'], hoja: 'no' })!;
    expect(r).toEqual({ activo: true });
  });
});

describe('el cableado en ingesta.ts (texto)', () => {
  it('lee config/respuestaLibre y expande respuestaLibreParaElFlujo junto a crmParaElFlujo', () => {
    const c = sinComentarios(leer('functions/src/ingesta.ts'));
    expect(c).toContain('config/respuestaLibre');
    expect(c).toMatch(/\.\.\.respuestaLibreParaElFlujo\(configRespuestaLibre\.exists \? configRespuestaLibre\.data\(\) : undefined\)/);
  });
});

describe('textoHumor NEUTRO: sin risas (paridad servidor-cliente)', () => {
  const RISAS = ['¡Jaja! 🌮', 'jeje', 'JIJI', 'jsjs', 'haha', 'lol', 'xD', 'XD', '😂', '🤣', '😆', '😄', 'qué jajaja'];
  const LIMPIOS = ['Mejor te cuento qué te puedo ofrecer.', 'Hola 🌮', 'Un lolo no es risa', 'xdr'];
  it('el servidor descarta un textoHumor con risas y conserva uno limpio', () => {
    for (const t of RISAS) expect(sanearRespuestaLibre({ activo: true, textoHumor: t })!['textoHumor'], t).toBeUndefined();
    for (const t of LIMPIOS) expect(sanearRespuestaLibre({ activo: true, textoHumor: t })!['textoHumor'], t).toBe(t);
  });
  it('el cliente (`rcConfig`) decide IGUAL que el servidor con las mismas frases', async () => {
    const { cargarFuente } = await import('./fuente-vm');
    const RC = cargarFuente<Record<string, (...a: unknown[]) => any>>(['Flujos/src/core/conversacion/respuesta-coherente.js'], ['rcConfig', 'rcTextoHumor']); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const t of [...RISAS, ...LIMPIOS]) {
      const servidor = sanearRespuestaLibre({ activo: true, textoHumor: t })!['textoHumor'];
      const cliente = RC['rcConfig']!({ activo: true, textoHumor: t }).textoHumor;
      expect(cliente === '' ? undefined : cliente, t).toBe(servidor);
    }
    expect(RC['rcTextoHumor']!({ textoHumor: '¡Jaja!' })).toBe('Mejor te cuento qué te puedo ofrecer. ¿Qué te gustaría hacer?');
  });
});
