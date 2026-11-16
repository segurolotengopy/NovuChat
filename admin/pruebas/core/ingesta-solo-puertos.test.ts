import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Etapa 3 G-3: `ingesta.ts` solo conoce a los módulos por los puertos de `ganchos.ts`, y la seña se
 * cuenta UNA vez (la cuenta `solicitudDelTurno`, no `ingesta.ts`). Si volvieran las dos, cada QR de
 * seña sumaría 2 a `senasEnviadas` y se facturaría el embudo de más.
 */
const fuente = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('ingesta.ts: solo puertos', () => {
  const ingesta = sinComentarios(fuente('../../functions/src/ingesta.ts'));

  it('no importa nada de ./modulos/ (ni valores ni tipos)', () => {
    expect(ingesta).not.toMatch(/from\s+['"]\.\/modulos\//);
    expect(ingesta).not.toMatch(/import\(\s*['"]\.\/modulos\//);
  });

  it('el incremento de senasEnviadas no está en ingesta.ts: viene de las métricas de solicitudDelTurno', () => {
    expect(ingesta).not.toMatch(/senasEnviadas/);
    expect(ingesta).toMatch(/metricasDeLaSolicitud/);
  });

  it('ganchos.ts es quien entrega los puertos', () => {
    const ganchos = fuente('../../functions/src/ganchos.ts');
    for (const m of ['agenda/solicitudDelTurno', 'campanas/alTurno', 'cobros/alTurno', 'pedidos/alTurno'])
      expect(ganchos).toContain(`./modulos/${m}.js`);
  });
});
