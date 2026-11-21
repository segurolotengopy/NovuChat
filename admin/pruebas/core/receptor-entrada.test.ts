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

/** Hallazgos de seguridad de la pieza: vacío si cumple (marcadores, wabaIdEsperado fijo, repetidos entre ejecuciones, sin Continue on Fail ni credenciales). */
function hallazgosDeSeguridad(f: Pieza): string[] {
  const h: string[] = [];
  const texto = JSON.stringify(f);
  const entrega = f.nodes.find((n) => n['name'] === 'Entrega del receptor');
  if ((entrega?.['parameters'] as J | undefined)?.['path'] !== '@@dato:receptor.ruta@@') h.push('ruta de webhook que no es el marcador @@dato:receptor.ruta@@');
  if (/https?:\/\//.test(texto)) h.push('contiene una URL real (http/https)');
  for (const n of f.nodes) {
    const url = (n['parameters'] as J | undefined)?.['url'];
    if (url !== undefined && !String(url).startsWith('@@dato:')) h.push(`url de «${String(n['name'])}» no empieza por @@dato:`);
    for (const c of ['onError', 'continueOnFail', 'credentials']) if (n[c] !== undefined) h.push(`«${String(n['name'])}» lleva ${c}`);
  }
  const v = f.nodes.find((n) => n['name'] === 'Verificar firma con el receptor');
  const cuerpo = String((v?.['parameters'] as J | undefined)?.['jsonBody'] ?? '');
  if (!/wabaIdEsperado: "@@dato:receptor\.wabaIdEsperado@@"/.test(cuerpo)) h.push('wabaIdEsperado no es el marcador fijo @@dato:receptor.wabaIdEsperado@@');
  const d = f.nodes.find((n) => n['name'] === 'Descartar repetidos');
  if ((d?.['parameters'] as J | undefined)?.['operation'] !== 'removeItemsSeenInPreviousExecutions') h.push('Descartar repetidos no descarta entre ejecuciones');
  return h;
}

describe('entrada verificada del receptor: pieza de core', () => {
  it('trae los 6 nodos, y los de la plantilla de venta-minima son idénticos (con sus conexiones, menos «Descartar repetidos»)', () => {
    expect(CORE.nodes.map((n) => n['name'])).toEqual(NOMBRES);
    for (const esperado of CORE.nodes) {
      expect(PLANTILLA.nodes.find((n) => n['name'] === esperado['name']), String(esperado['name'])).toEqual(esperado);
    }
    for (const [nombre, conex] of Object.entries(CORE.connections)) expect(PLANTILLA.connections[nombre], nombre).toEqual(conex);
    expect(Object.keys(CORE.connections)).not.toContain('Descartar repetidos');
  });
  it('la pieza real no tiene ningún hallazgo de seguridad', () => {
    expect(hallazgosDeSeguridad(CORE)).toEqual([]);
  });
  describe('NEGADO: cada aserción de seguridad detecta su caso, sobre copias mutadas en memoria', () => {
    const copia = (): Pieza => JSON.parse(JSON.stringify(CORE)) as Pieza;
    const nodo = (f: Pieza, n: string): J => f.nodes.find((x) => x['name'] === n) as J;
    const params = (f: Pieza, n: string): J => nodo(f, n)['parameters'] as J;
    const casos: Array<[string, (f: Pieza) => void, RegExp]> = [
      ['ruta de webhook real', (f) => { params(f, 'Entrega del receptor')['path'] = 'abc-secreta'; }, /ruta de webhook/],
      ['URL real en el verificador', (f) => { params(f, 'Verificar firma con el receptor')['url'] = 'http://interno.example/verificar'; }, /url/],
      ['URL que no empieza por @@dato:', (f) => { params(f, 'Verificar firma con el receptor')['url'] = 'verificador-interno'; }, /url/],
      ['wabaIdEsperado fijado a un valor', (f) => { const p = params(f, 'Verificar firma con el receptor'); p['jsonBody'] = String(p['jsonBody']).replace('@@dato:receptor.wabaIdEsperado@@', '123456789'); }, /wabaIdEsperado/],
      ['wabaIdEsperado como expresión', (f) => { const p = params(f, 'Verificar firma con el receptor'); p['jsonBody'] = String(p['jsonBody']).replace('"@@dato:receptor.wabaIdEsperado@@"', '$json.body.waba'); }, /wabaIdEsperado/],
      ['Descartar repetidos solo dentro de la ejecución', (f) => { params(f, 'Descartar repetidos')['operation'] = 'removeItemsCurrentRun'; }, /Descartar repetidos/],
      ['onError en un nodo', (f) => { nodo(f, 'Verificar firma con el receptor')['onError'] = 'continueRegularOutput'; }, /onError/],
      ['continueOnFail en un nodo', (f) => { nodo(f, '¿Firma válida?')['continueOnFail'] = true; }, /continueOnFail/],
      ['credenciales en un nodo', (f) => { nodo(f, 'Aceptar (200)')['credentials'] = { httpHeaderAuth: { id: 'x', name: 'y' } }; }, /credentials/],
    ];
    for (const [nombre, mutar, esperado] of casos) {
      it(nombre, () => {
        const f = copia();
        mutar(f);
        expect(hallazgosDeSeguridad(f).join(' | ')).toMatch(esperado);
      });
    }
  });
});
