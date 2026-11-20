/**
 * La entrada verificada del receptor vive en core (`Flujos/src/core/receptor/entrada-del-receptor.plantilla.json`, PR-7).
 * Aquí se prueba que la plantilla de venta-minima (de donde se extrajo) coincide con la pieza canónica, y que la
 * pieza no trae ninguna ruta de webhook ni URL real (son URL de capacidad: solo marcadores `@@dato:…@@`).
 * Walisuma, casa-bermejo, rroca-ruben y rroca-antonio la comparan en sus propias pruebas.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type J = Record<string, unknown>;
type Pieza = { nodes: J[]; connections: Record<string, unknown> };

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const leer = (r: string): Pieza => JSON.parse(readFileSync(join(RAIZ, r), 'utf8')) as Pieza;
const CORE = leer('Flujos/src/core/receptor/entrada-del-receptor.plantilla.json');
const PLANTILLA = leer('Flujos/experimental/venta-minima/flujo.plantilla.json');
const NOMBRES = ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'];

describe('entrada verificada del receptor: pieza de core', () => {
  it('trae los 6 nodos, y los de la plantilla de venta-minima son idénticos (con sus conexiones, menos «Descartar repetidos»)', () => {
    expect(CORE.nodes.map((n) => n['name'])).toEqual(NOMBRES);
    for (const esperado of CORE.nodes) {
      expect(PLANTILLA.nodes.find((n) => n['name'] === esperado['name']), String(esperado['name'])).toEqual(esperado);
    }
    for (const [nombre, conex] of Object.entries(CORE.connections)) expect(PLANTILLA.connections[nombre], nombre).toEqual(conex);
    expect(Object.keys(CORE.connections)).not.toContain('Descartar repetidos');
  });
  it('NEGADO: sin ruta de webhook ni URL reales (solo marcadores) y sin «Continue on Fail» en el verificador', () => {
    const texto = JSON.stringify(CORE);
    expect(texto).toContain('@@dato:receptor.ruta@@');
    expect(texto).not.toMatch(/"path":"(?!@@)/);
    expect(texto).not.toMatch(/https?:\/\//);
    const v = CORE.nodes.find((n) => n['name'] === 'Verificar firma con el receptor') as J;
    expect(v['onError']).toBeUndefined();
    expect(v['continueOnFail']).toBeUndefined();
  });
});
