/**
 * LA DOCUMENTACIÓN DEL FLUJO no contradice las decisiones vigentes (matriz de verificación, D2 y D5; 25/11/2026): el CI/DNI se toma en el envío (decisión del 20/11/2026, no «no toma CI ni DNI» del 05/11);
 * un número de otro país se atiende como Bolivia (ya no hay texto de «fuera de país»); los conteos de nodos son los del armador.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARPETA, PRODUCCION, PRUEBA } from './mundo';

const leer = (f: string): string => readFileSync(join(CARPETA, f), 'utf8');
describe('PROPIO.md y DISENO.md', () => {
  it('NEGADO: ninguno dice que el asistente «no toma CI ni DNI» como regla vigente; los dos citan la decisión del 20/11/2026', () => {
    for (const f of ['PROPIO.md', 'DISENO.md']) {
      const t = leer(f);
      expect(t, f).not.toMatch(/NO toma CI ni DNI en el chat\*\*|No toma documento \(CI\/DNI\)\*\*: decisión de Andres del 05\/11/);
      expect(t, f).toMatch(/20\/11\/2026/);
    }
  });
  it('NEGADO: no dicen que otro país recibe un texto fijo; la cuenta de nodos vigente (64 y 58: el webhook del carrito, B4, solo en producción) figura y es la del flujo armado', () => {
    for (const f of ['PROPIO.md', 'DISENO.md']) expect(leer(f), f).not.toMatch(/otro país recibe el texto fijo|AR\/otro → texto fijo/);
    expect(PRODUCCION.nodes).toHaveLength(64);
    expect(PRUEBA.nodes).toHaveLength(58);
    expect(leer('PROPIO.md')).toMatch(/64 nodos/);
    expect(leer('PROPIO.md')).toMatch(/\(58;/);
    expect(leer('DISENO.md')).toMatch(/hoy el armador da 64 y 58/);
  });
});
