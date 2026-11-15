/**
 * INVARIANTE GLOBAL «el asistente dice que es una IA» (14/11/2026): recorre TODOS los flujos de producción que atienden a un cliente,
 * descubiertos del disco con la lista única, y exige que cada uno lleve la pieza común de identidad o tenga su excepción declarada.
 * Pruebas NEGADAS de las piezas puras (`ux/identidad.ts`) y la medición real sobre `Flujos/`.
 */
import { describe, expect, it } from 'vitest';
import { leerFlujo, type Flujo } from '../lib/flujo';
import { flujosDeProduccion } from '../lib/flujos-de-cliente';
import { atiendeCliente, idDeFlujo } from './migracion/comprobaciones';
import {
  ALTA_IDENTIDAD, EXCEPCIONES_DE_IDENTIDAD, LIMITE_IDENTIDAD, TOPE_IDENTIDAD, fuenteDeIdentidad, incluyeLaPiezaDeIdentidad, nodosQueLlamanSinLaPieza, problemasDeIdentidad,
  type ExcepcionDeIdentidad,
} from './ux/identidad';

const FUENTE = fuenteDeIdentidad();
const flujo = (...codigos: string[]): Flujo => ({
  nodes: codigos.map((jsCode, i) => ({ name: `Code ${i}`, type: 'n8n-nodes-base.code', parameters: { jsCode } })), connections: {},
} as unknown as Flujo);
const USA = "const cuerpo = ctConIA('Hola, soy el asistente virtual de X.');";

describe('incluyeLaPiezaDeIdentidad', () => {
  it('la pieza entera, con librerías antes y el código que la llama después → sí', () => {
    expect(incluyeLaPiezaDeIdentidad(flujo('const x = 1;', `// librería\n${FUENTE}\n${USA}`))).toBe(true);
  });
  it('NIEGA: la pieza pegada sin llamarla, o llamada sin llevar la pieza → no', () => {
    expect(incluyeLaPiezaDeIdentidad(flujo(`${FUENTE}\nreturn [];`))).toBe(false);
    expect(incluyeLaPiezaDeIdentidad(flujo(USA))).toBe(false);
  });
  it('NIEGA: la llamada que solo está dentro de la pieza no cuenta', () => {
    expect(incluyeLaPiezaDeIdentidad(flujo(FUENTE))).toBe(false);
  });
  it('NIEGA: un byte alterado de la pieza → no', () => {
    expect(incluyeLaPiezaDeIdentidad(flujo(`${FUENTE.replace("'con IA'", "'con ia'")}\n${USA}`))).toBe(false);
  });
  it('NIEGA: un flujo sin nodos Code → no', () => {
    expect(incluyeLaPiezaDeIdentidad(flujo())).toBe(false);
  });
});

describe('nodosQueLlamanSinLaPieza', () => {
  const DEF = 'function bmSeguro(t) {\n  return ctConIA(t);\n}\n';
  it('la definición sola (viaja con la librería) no cuenta; la llamada sin la pieza sí', () => {
    expect(nodosQueLlamanSinLaPieza(flujo(`${DEF}return [];`))).toEqual([]);
    expect(nodosQueLlamanSinLaPieza(flujo(`${DEF}const x = bmSeguro('hola');`))).toEqual(['Code 0']);
  });
  it('NIEGA: llamar a chLista o wlSeguro sin la pieza también cuenta; con la pieza no', () => {
    expect(nodosQueLlamanSinLaPieza(flujo("const m = chLista(cfg, false);"))).toEqual(['Code 0']);
    expect(nodosQueLlamanSinLaPieza(flujo("wlSeguro(x)"))).toEqual(['Code 0']);
    expect(nodosQueLlamanSinLaPieza(flujo(`${FUENTE}\n${DEF}const x = bmSeguro('hola');`))).toEqual([]);
  });
});

describe('problemasDeIdentidad: el cruce con las excepciones', () => {
  const e = (parcial: Partial<ExcepcionDeIdentidad> = {}): ExcepcionDeIdentidad => ({ motivo: 'm', dueno: 'd', vence: '2027-01-31', ...parcial });
  const HOY = '2026-11-14';
  it('todo cubierto y nada sobra → sin problemas', () => {
    expect(problemasDeIdentidad(new Set(['a.json']), { 'a.json': e() }, 1, HOY)).toEqual([]);
  });
  it('NIEGA: una falta sin excepción', () => {
    expect(problemasDeIdentidad(new Set(['a.json']), {}, 0, HOY)).toEqual([expect.stringContaining('a.json: no incluye la pieza')]);
  });
  it('NIEGA: una excepción que ya se cumple SOBRA', () => {
    expect(problemasDeIdentidad(new Set(), { 'a.json': e() }, 1, HOY)).toEqual([expect.stringContaining('SOBRA')]);
  });
  it('NIEGA: más excepciones que el tope', () => {
    expect(problemasDeIdentidad(new Set(['a.json']), { 'a.json': e() }, 0, HOY)).toEqual([expect.stringContaining('el tope solo baja')]);
  });
  it('NIEGA: sin motivo, sin dueño, fecha inválida, más allá del límite, vencida', () => {
    const f = new Set(['a.json']);
    expect(problemasDeIdentidad(f, { 'a.json': e({ motivo: ' ' }) }, 1, HOY)).toEqual([expect.stringContaining('sin motivo')]);
    expect(problemasDeIdentidad(f, { 'a.json': e({ dueno: '' }) }, 1, HOY)).toEqual([expect.stringContaining('sin dueño')]);
    expect(problemasDeIdentidad(f, { 'a.json': e({ vence: 'pronto' }) }, 1, HOY)).toEqual([expect.stringContaining('no es una fecha')]);
    expect(problemasDeIdentidad(f, { 'a.json': e({ vence: '2027-02-13' }) }, 1, HOY)).toEqual([expect.stringContaining('después del límite')]);
    expect(problemasDeIdentidad(f, { 'a.json': e({ vence: '2026-11-13' }) }, 1, HOY)).toEqual([expect.stringContaining('VENCIDA')]);
  });
});

describe('todos los flujos de producción que atienden a un cliente', () => {
  const medidos = flujosDeProduccion().map((ruta) => [ruta, leerFlujo(ruta)] as const).filter(([, f]) => atiendeCliente(f));
  const faltan = new Set<string>();
  for (const [ruta, f] of medidos) if (!incluyeLaPiezaDeIdentidad(f)) faltan.add(idDeFlujo(ruta));

  it('la lista única descubre flujos que atienden (si queda vacía, la prueba no mira nada)', () => {
    expect(medidos.length).toBeGreaterThanOrEqual(10);
  });
  it('cada flujo lleva la pieza de identidad o tiene su excepción declarada', () => {
    expect(problemasDeIdentidad(faltan)).toEqual([]);
  });
  it('el tope es la cuenta de hoy y el límite son 90 días desde el alta', () => {
    expect(Object.keys(EXCEPCIONES_DE_IDENTIDAD)).toHaveLength(TOPE_IDENTIDAD);
    expect(new Date(`${LIMITE_IDENTIDAD}T00:00:00Z`).getTime() - new Date(`${ALTA_IDENTIDAD}T00:00:00Z`).getTime()).toBe(90 * 86_400_000);
  });
  it('ningún nodo llama a las funciones que usan la pieza sin llevarla (ReferenceError en pleno envío)', () => {
    const sueltos = medidos.flatMap(([ruta, f]) => nodosQueLlamanSinLaPieza(f).map((n) => `${idDeFlujo(ruta)} · ${n}`));
    expect(sueltos).toEqual([]);
  });
  it('al menos un flujo ya incluye la pieza sin excepción (la regla no es letra muerta)', () => {
    expect(medidos.some(([ruta]) => !faltan.has(idDeFlujo(ruta)))).toBe(true);
  });
});
