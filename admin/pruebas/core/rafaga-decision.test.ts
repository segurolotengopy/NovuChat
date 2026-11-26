/**
 * LA RÁFAGA — la decisión del nodo «Agrupar ráfaga» (`Flujos/src/core/rafaga/agrupar-rafaga.js`), pieza común del núcleo.
 *
 * El nodo corre con `correr` (el mismo entorno del Code de n8n: sin `URL`, `Buffer` ni `crypto`) y se prueba negando cada regla:
 *   ráfaga de 2 y 3 → UNA sola respuesta agrupada, el resto en silencio; aislado → solo;
 *   consulta caída / respuesta mal formada / mi idMeta ausente → solo (falla ABIERTO);
 *   empate en el mismo ms → exactamente un ganador, el mismo para todas las ejecuciones; idMeta repetido;
 *   saliente, audio, botón o `[nº]` en medio → nadie se calla antes; salto mayor que espera - 500 ms no agrupa; más de 5 → tope.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { correr, GLOBALES_FUERA_DEL_SANDBOX } from '../lib/flujo';
import { codigoDeLaRafaga } from '../../../Flujos/src/core/rafaga/rafaga.mjs';

const ARCHIVO = join(__dirname, '../../../Flujos/src/core/rafaga/agrupar-rafaga.js');
const CODIGO = readFileSync(ARCHIVO, 'utf8');

interface Frag { idMeta: string; tipo: string; texto: string; ms: number }
const f = (idMeta: string, texto: string, ms: number, tipo = 'text'): Frag => ({ idMeta, tipo, texto, ms });

/** Corre el nodo como «yo = idMeta» con lo que el servidor devolvió. */
function como(idMeta: string, texto: string, respuesta: unknown, esperaRafagaSeg: unknown = 2) {
  const r = correr(CODIGO, [respuesta as Record<string, unknown>], {
    '¿Esperar ráfaga?': { mensajeId: idMeta, userInput: texto, from: '59170000000', tipo: 'text', otro: 'x' },
    'Config base': { esperaRafagaSeg },
  });
  return r.map((i) => i.json);
}
const ok = (fragmentos: Frag[]) => ({ rafaga: { v: 1, fragmentos } });

describe('rafaga: decisión', () => {
  it('el código no usa ningún global que el sandbox de n8n no tenga', () => {
    for (const g of GLOBALES_FUERA_DEL_SANDBOX) expect(CODIGO).not.toMatch(new RegExp(`(^|[^\\w$.'"])${g}\\s*[(.\\[]`));
    expect(() => vm.compileFunction(CODIGO, ['$input', '$'])).not.toThrow();
  });

  it('aislado: responde solo, sin textoDelTurno (igual que hoy)', () => {
    const [s, ...resto] = como('B', 'hola', ok([f('B', 'hola', 1000)]));
    expect(resto).toEqual([]);
    expect(s.rafaga).toEqual({ accion: 'solo', ids: ['B'] });
    expect('textoDelTurno' in s).toBe(false);
    expect(s.mensajeId).toBe('B');
  });

  it('ráfaga de 2: el primero calla y el último responde con los dos textos', () => {
    const lista = ok([f('A', 'hola', 1000), f('B', 'quiero reservar', 2000)]);
    expect(como('A', 'hola', lista)).toEqual([]);
    const [s] = como('B', 'quiero reservar', lista);
    expect(s.rafaga).toEqual({ accion: 'agrupado', ids: ['A', 'B'] });
    expect(s.textoDelTurno).toBe('hola\nquiero reservar');
  });

  it('ráfaga de 3: exactamente UNA ejecución responde, con los tres', () => {
    const lista = ok([f('A', 'hola', 1000), f('B', 'quiero reservar', 2000), f('C', 'para mañana', 3000)]);
    const salidas = ['A', 'B', 'C'].map((id) => como(id, ({ A: 'hola', B: 'quiero reservar', C: 'para mañana' } as Record<string, string>)[id], lista));
    expect(salidas.map((s) => s.length)).toEqual([0, 0, 1]);
    expect(salidas[2][0].textoDelTurno).toBe('hola\nquiero reservar\npara mañana');
    expect(salidas[2][0].rafaga).toEqual({ accion: 'agrupado', ids: ['A', 'B', 'C'] });
  });

  it('el texto propio va crudo y el ajeno como lo devuelve el servidor', () => {
    const [s] = como('B', 'mi teléfono es 70000000', ok([f('A', 'hola', 1000), f('B', 'copia saneada', 1900)]));
    expect(s.textoDelTurno).toBe('hola\nmi teléfono es 70000000');
  });

  it('falla ABIERTO: consulta caída, sin rafaga, versión distinta o lista que no es lista → solo', () => {
    for (const r of [{ error: { message: 'timeout' } }, {}, { rafaga: { v: 2, fragmentos: [] } }, { rafaga: { v: 1, fragmentos: 'x' } }, null]) {
      const out = como('A', 'hola', r);
      expect(out).toHaveLength(1);
      expect(out[0].rafaga).toEqual({ accion: 'solo', ids: ['A'] });
    }
  });

  it('falla ABIERTO: mi idMeta no está en la lista, o no hay idMeta → solo', () => {
    expect(como('Z', 'hola', ok([f('A', 'x', 1000), f('B', 'y', 1500)]))[0].rafaga.accion).toBe('solo');
    const sinId = correr(CODIGO, [ok([f('A', 'x', 1)])], { '¿Esperar ráfaga?': { userInput: 'hola' }, 'Config base': {} }).map((i) => i.json);
    expect(sinId[0].rafaga).toEqual({ accion: 'solo', ids: [] });
  });

  it('falla ABIERTO: un fragmento mal formado invalida la lista entera (nadie se calla por un dato dudoso)', () => {
    const malos = [{ idMeta: 'A', tipo: 'text', texto: 'x' }, { idMeta: 'A', tipo: 'text', texto: 'x', ms: '1' }, { idMeta: 'A', tipo: 'text', texto: 5, ms: 1 }, null];
    for (const m of malos) {
      const out = como('A', 'hola', { rafaga: { v: 1, fragmentos: [m, f('B', 'y', 1500)] } });
      expect(out).toHaveLength(1);
      expect(out[0].rafaga.accion).toBe('solo');
    }
  });

  it('empate en el mismo ms: un solo ganador y el mismo en toda ejecución, venga la lista en el orden que venga', () => {
    for (const lista of [[f('A', 'uno', 1000), f('B', 'dos', 1000)], [f('B', 'dos', 1000), f('A', 'uno', 1000)]]) {
      const a = como('A', 'uno', ok(lista));
      const b = como('B', 'dos', ok(lista));
      expect(a.length + b.length).toBe(1);
      expect(b).toHaveLength(1);
      expect(b[0].textoDelTurno).toBe('uno\ndos');
    }
  });

  it('un idMeta repetido (reintento de Meta) cuenta una vez: queda la primera aparición', () => {
    const lista = ok([f('A', 'hola', 1000), f('A', 'hola', 1200), f('B', 'chau', 1800)]);
    expect(como('A', 'hola', lista)).toEqual([]);
    const [s] = como('B', 'chau', lista);
    expect(s.rafaga.ids).toEqual(['A', 'B']);
    expect(s.textoDelTurno).toBe('hola\nchau');
    // Solo el repetido y nada más: sigue siendo un mensaje aislado.
    expect(como('A', 'hola', ok([f('A', 'hola', 1000), f('A', 'hola', 1100)]))[0].rafaga.accion).toBe('solo');
  });

  it('una marca de saliente, un audio, un botón o un [nº] EN MEDIO separa: cada lado responde lo suyo', () => {
    for (const medio of [f('', '', 1500, 'saliente'), f('M', '', 1500, 'audio'), f('M', 'Sí', 1500, 'interactive'), f('M', 'mi cel es [nº]', 1500)]) {
      const lista = ok([f('A', 'uno', 1000), medio, f('B', 'dos', 2000)]);
      const a = como('A', 'uno', lista);
      const b = como('B', 'dos', lista);
      expect(a, `A con ${medio.tipo}`).toHaveLength(1);
      expect(a[0].rafaga.accion).toBe('solo');
      expect(b[0].rafaga.accion).toBe('solo');
      expect(b[0].textoDelTurno).toBeUndefined();
    }
  });

  it('un medio como último mensaje: el último texto responde a los de antes (el medio no espera ni se calla)', () => {
    const lista = ok([f('A', 'uno', 1000), f('B', 'dos', 1500), f('C', '', 1800, 'audio')]);
    expect(como('A', 'uno', lista)).toEqual([]);
    expect(como('B', 'dos', lista)[0].textoDelTurno).toBe('uno\ndos');
  });

  it('el defecto del revisor (B1): A, B y C con G = 1500; cada ejecución con SU vista, nadie queda sin respuesta', () => {
    const A = f('A', 'a', 0); const B = f('B', 'b', 1000); const C = f('C', 'c', 2800);
    // A consulta en t=2000 y ve [A, B]; B consulta en t=3000 y ve [A, B, C]; C en t=4800 ve todo.
    expect(como('A', 'a', ok([A, B]))).toEqual([]);
    const [b] = como('B', 'b', ok([A, B, C]));
    expect(b.textoDelTurno).toBe('a\nb');
    const [c] = como('C', 'c', ok([A, B, C]));
    expect(c.rafaga).toEqual({ accion: 'solo', ids: ['C'] });
  });

  it('un medio ANTES de la ráfaga no la estorba', () => {
    const lista = ok([f('M', '', 500, 'image'), f('A', 'uno', 1000), f('B', 'dos', 1500)]);
    expect(como('A', 'uno', lista)).toEqual([]);
    expect(como('B', 'dos', lista)[0].textoDelTurno).toBe('uno\ndos');
  });

  it('un salto mayor que espera - 500 ms no agrupa; uno igual sí (espera 2 s → 1500 ms)', () => {
    const lejos = ok([f('A', 'uno', 1000), f('B', 'dos', 2501)]);
    expect(como('A', 'uno', lejos)[0].rafaga.accion).toBe('solo');
    expect(como('B', 'dos', lejos)[0].rafaga.accion).toBe('solo');
    const justo = ok([f('A', 'uno', 1000), f('B', 'dos', 2500)]);
    expect(como('A', 'uno', justo)).toEqual([]);
    expect(como('B', 'dos', justo)[0].rafaga.accion).toBe('agrupado');
  });

  it('el salto se mide entre CONSECUTIVOS, no desde el primero (una ráfaga larga sigue encadenada)', () => {
    const lista = ok([f('A', 'a', 0), f('B', 'b', 1400), f('C', 'c', 2800)]);
    expect(como('C', 'c', lista)[0].rafaga.ids).toEqual(['A', 'B', 'C']);
  });

  it('la espera sale de «Config base»: acotada a 1-5 s y con 2 s por defecto', () => {
    const lista = ok([f('A', 'uno', 0), f('B', 'dos', 3000)]);
    expect(como('B', 'dos', lista, 2)[0].rafaga.accion).toBe('solo');
    expect(como('B', 'dos', lista, 4)[0].rafaga.accion).toBe('agrupado'); // G = 3500
    expect(como('B', 'dos', lista, 99)[0].rafaga.accion).toBe('agrupado'); // tope 5 s → G = 4500
    expect(como('B', 'dos', ok([f('A', 'uno', 0), f('B', 'dos', 1200)]), 0.2)[0].rafaga.accion).toBe('solo'); // 0,2 → 1 s → G = 500
    expect(como('B', 'dos', lista, undefined)[0].rafaga.accion).toBe('solo');
    expect(como('B', 'dos', ok([f('A', 'uno', 0), f('B', 'dos', 1400)]), 'abc')[0].rafaga.accion).toBe('agrupado'); // texto → defecto 2 s
    expect(como('B', 'dos', ok([f('A', 'uno', 0), f('B', 'dos', 1400)]), -3)[0].rafaga.accion).toBe('agrupado');
  });

  it('seis entradas (el tope del servidor): el último responde a las seis y las demás callan', () => {
    const lista = ok(['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => f(id, id.toLowerCase(), 1000 + i * 100)));
    const [ultimo] = como('F', 'f', lista);
    expect(ultimo.rafaga.ids).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    for (const id of ['A', 'B', 'C', 'D', 'E']) expect(como(id, id.toLowerCase(), lista)).toEqual([]);
  });

  it('defensa: si el flujo no entrega mi texto (campo mal nombrado) se usa el que guardó el servidor: nunca un grupo con el último mensaje en blanco', () => {
    const lista = ok([f('A', 'quiero 2 cajas', 1000), f('B', 'de la grande, para mañana', 1800)]);
    for (const vacio of ['', '   ', undefined]) {
      const [s] = como('B', vacio as string, lista);
      expect(s.textoDelTurno, JSON.stringify(vacio)).toBe('quiero 2 cajas\nde la grande, para mañana');
    }
    // y un texto propio que sí llegó manda sobre el guardado
    expect(como('B', 'crudo', lista)[0].textoDelTurno).toBe('quiero 2 cajas\ncrudo');
  });

  it('mi fragmento no es agrupable ([nº] guardado) → solo, aunque haya vecinos', () => {
    expect(como('B', 'mi cel 70000000', ok([f('A', 'uno', 1000), f('B', 'mi cel es [nº]', 1200)]))[0].rafaga.accion).toBe('solo');
    expect(como('A', 'uno', ok([f('A', 'uno', 1000), f('B', 'mi cel es [nº]', 1200)]))[0].rafaga.accion).toBe('solo');
  });

  it('un texto vacío o solo espacios no es agrupable', () => {
    expect(como('B', 'dos', ok([f('A', '   ', 1000), f('B', 'dos', 1500)]))[0].rafaga.accion).toBe('solo');
  });

  it('el item del turno pasa entero (el resto de los campos no se pierde) y la configuración se lee del nombre que lleve el flujo', () => {
    const [s] = como('B', 'dos', ok([f('A', 'uno', 1000), f('B', 'dos', 1500)]));
    expect(s).toMatchObject({ otro: 'x', from: '59170000000', tipo: 'text', userInput: 'dos' });
    const otro = codigoDeLaRafaga('Config propia');
    expect(otro).toContain("$('Config propia')");
    expect(otro).not.toContain("$('Config base')");
    expect(codigoDeLaRafaga()).toBe(CODIGO);
  });
});
