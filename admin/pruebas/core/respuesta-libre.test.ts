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
    const r = respuestaLibreParaElFlujo({ activo: true, acuse: '🌮'.repeat(400), reglas: 'x'.repeat(900), prohibidos: Array.from({ length: 45 }, () => 'p'.repeat(90)) }).respuestaLibre!;
    expect(Array.from(r.acuse!).length).toBe(300);
    expect(r.acuse).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(r.reglas!.length).toBe(800);
    expect(r.prohibidos.length).toBe(30);
    expect(r.prohibidos.every((p) => p.length === 60)).toBe(true);
  });
  it('NEGADO: tipos basura se omiten y los campos ajenos no pasan', () => {
    const r = sanearRespuestaLibre({ activo: true, acuse: 3, tono: '  ', textoRechazo: {}, prohibidos: [1, null, ' ', 'a'], hoja: 'no' })!;
    expect(r).toEqual({ activo: true, prohibidos: ['a'] });
  });
});

describe('el cableado en ingesta.ts (texto)', () => {
  it('lee config/respuestaLibre y expande respuestaLibreParaElFlujo junto a crmParaElFlujo', () => {
    const c = sinComentarios(leer('functions/src/ingesta.ts'));
    expect(c).toContain('config/respuestaLibre');
    expect(c).toMatch(/\.\.\.respuestaLibreParaElFlujo\(configRespuestaLibre\.exists \? configRespuestaLibre\.data\(\) : undefined\)/);
  });
});
