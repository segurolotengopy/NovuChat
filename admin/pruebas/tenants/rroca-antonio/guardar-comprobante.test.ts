// «Guardar comprobante» en el flujo de Antonio (26/10/2026): la foto del comprobante se guarda para el visor de la consola y su ruta viaja en el cotejo.
// Es la misma pieza que Rubén (rama TERMINAL, sin salidas, arriba de lo que decide): guardar nunca bloquea la respuesta al cliente.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANA, COMPROBANTE, COTEJO_VALIDO, hablar, crear, mAudio, mImagen, mTexto, panelConQr, type Opciones } from './mundo';

const RA = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-antonio');
const cargar = (a: string) => JSON.parse(readFileSync(join(RA, a), 'utf8')) as { nodes: { name: string; position: number[]; parameters: Record<string, unknown>; credentials?: Record<string, { name: string }>; onError?: string }[]; connections: Record<string, { main: { node: string }[][] }> };
const nodo = (f: ReturnType<typeof cargar>, n: string) => f.nodes.find((x) => x.name === n)!;
const destinos = (f: ReturnType<typeof cargar>, n: string, i: number) => (f.connections[n]?.main[i] ?? []).map((x) => x.node);
type Turno = ReturnType<typeof hablar>;
const vio = (t: Turno, nodo: string) => t.registro.filter((r) => r.nodo === nodo);

describe('Antonio · «Guardar comprobante»', () => {
  for (const archivo of ['rroca-antonio.json', 'rroca-antonio.prueba.json']) {
    it(`${archivo}: nodo terminal que cuelga de «¿Es audio?» (no audio) y va ARRIBA de «¿Es un documento?»; solo habla con la Function guardarComprobante`, () => {
      const f = cargar(archivo);
      expect(f.connections['Guardar comprobante']).toBeUndefined();
      expect(destinos(f, '¿Es audio?', 1)).toEqual(['Guardar comprobante', '¿Es un documento?']);
      expect(destinos(f, '¿Es audio?', 0)).toEqual(['Transcribir audio']);
      expect(nodo(f, 'Guardar comprobante').position[1]).toBeLessThan(nodo(f, '¿Es un documento?').position[1]);
      expect(nodo(f, 'Guardar comprobante').parameters['url']).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/guardarComprobante');
      expect(nodo(f, 'Guardar comprobante').onError).toBe('continueRegularOutput');
      expect(JSON.stringify(nodo(f, 'Guardar comprobante').parameters)).not.toMatch(/Interpretar entrada/);
    });
  }
  const conQr = (o: Opciones = {}) => crear({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE }, cotejo: COTEJO_VALIDO, ...o });
  it('una foto con cobro abierto: la ruta guardada viaja al cotejo', () => {
    const w = conQr();
    hablar(w, ANA, mTexto('hola'));
    const c = hablar(w, ANA, mImagen());
    expect(vio(c, 'Guardar comprobante')).toHaveLength(1);
    expect(vio(c, 'Cotejar en el servidor')[0]?.cuerpo?.['ruta']).toBe('tenants/rroca-antonio/comprobantes/2026-10-26/abc_1.jpg');
  });
  it('NEGANDO: si el servidor no guarda (409, 503 o una ruta que no tiene la forma), el cotejo corre igual con ruta null y el cliente recibe su respuesta', () => {
    for (const guardado of [{ statusCode: 409, body: {} }, 'cae' as const, { statusCode: 200, body: { ruta: 'tenants/otro/../../x' } }, { statusCode: 200, body: { ruta: 5 } }]) {
      const w = conQr({ guardado });
      hablar(w, ANA, mTexto('hola'));
      const c = hablar(w, ANA, mImagen());
      expect(vio(c, 'Cotejar en el servidor')[0]?.cuerpo?.['ruta']).toBeNull();
      expect(c.mensajes.length).toBeGreaterThan(0);
    }
  });
  it('NEGANDO: un audio no pasa por «Guardar comprobante»; un texto tampoco', () => {
    const w = conQr();
    hablar(w, ANA, mTexto('hola'));
    expect(vio(hablar(w, ANA, mAudio()), 'Guardar comprobante')).toHaveLength(0);
    expect(vio(hablar(w, ANA, mTexto('¿qué incluye?')), 'Guardar comprobante')).toHaveLength(0);
  });
});
