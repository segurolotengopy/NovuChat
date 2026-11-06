/**
 * EL n8n DE MENTIRA, ampliado para el relé B9 (P5 del plan del 02/11/2026): `$runIndex`, el nodo Wait, las corridas de un nodo y `pairedItem` a través de un Code.
 * Sin esto, un bucle «enviar → esperar → reintentar» no se puede probar: el doble no sabía nada de corridas ni de esperas.
 */
import { describe, expect, it } from 'vitest';
import { crearMundo } from '../../lib/n8n-de-mentira';
import type { Flujo, J } from '../../lib/flujo';

const c = (de: string, ...a: string[]) => ({ [de]: { main: [a.map((node) => ({ node, type: 'main', index: 0 }))] } });
const code = (name: string, jsCode: string, y = 0) => ({ name, type: 'n8n-nodes-base.code', parameters: { jsCode }, position: [y * 10, y] });
const AHORA = Date.UTC(2026, 10, 2, 15, 0, 0);

/** Entrada → Contar (Code, devuelve su $runIndex) → ¿Otra vuelta? (IF) →sí→ Esperar (Wait) → Contar … */
function bucle(vueltas: number, espera = '={{ 3 }}', unidad = 'seconds'): Flujo {
  return {
    name: 'bucle',
    nodes: [
      { name: 'Entrada de prueba', type: 'n8n-nodes-base.noOp', parameters: {}, position: [0, 0] },
      code('Contar', "return [{ json: { vuelta: $runIndex, id: $execution.id, previo: $input.first().json.previo ?? null } }];", 1),
      { name: '¿Otra vuelta?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [30, 2], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [{ id: 'c', leftValue: `={{ $json.vuelta < ${vueltas - 1} }}`, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
      { name: 'Esperar', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [40, 3], parameters: { resume: 'timeInterval', amount: espera, unit: unidad } },
      code('Fin', "return [{ json: { fin: true, corridas: $('Contar').all().length } }];", 4),
    ],
    connections: {
      ...c('Entrada de prueba', 'Contar'),
      ...c('Contar', '¿Otra vuelta?'),
      '¿Otra vuelta?': { main: [[{ node: 'Esperar', type: 'main', index: 0 }], [{ node: 'Fin', type: 'main', index: 0 }]] },
      ...c('Esperar', 'Contar'),
    },
  } as unknown as Flujo;
}

describe('$runIndex', () => {
  it('cuenta las corridas del nodo en el turno: 0, 1, 2…', () => {
    const r = crearMundo({ flujo: bucle(3), ahoraMs: AHORA }).turno({});
    expect(r.porNodo['Contar']!.map((j) => j['vuelta'])).toEqual([0, 1, 2]);
  });
  it('NIEGA: se reinicia en cada turno (no arrastra la cuenta del turno anterior)', () => {
    const mu = crearMundo({ flujo: bucle(2), ahoraMs: AHORA });
    mu.turno({});
    expect(mu.turno({}).porNodo['Contar']!.map((j) => j['vuelta'])).toEqual([0, 1]);
  });
  it('también existe en las expresiones', () => {
    const f = bucle(1);
    f.nodes.push({ name: 'Marca', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [100, 5], parameters: { assignments: { assignments: [{ id: 'a', name: 'corrida', type: 'number', value: '={{ $runIndex }}' }] }, options: {} } } as never);
    f.connections['Fin'] = { main: [[{ node: 'Marca', type: 'main', index: 0 }]] };
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).porNodo['Marca']![0]!['corrida']).toBe(0);
  });
});

describe('el nodo Wait', () => {
  it('no duerme: anota cada espera, adelanta el reloj congelado y deja pasar los ítems', () => {
    const mu = crearMundo({ flujo: bucle(3, '={{ 61 }}'), ahoraMs: AHORA });
    const r = mu.turno({});
    expect(r.esperas).toEqual([{ nodo: 'Esperar', segundos: 61 }, { nodo: 'Esperar', segundos: 61 }]);
    expect(mu.ahora()).toBe(AHORA + 122_000);
    expect(r.porNodo['Fin']).toHaveLength(1);
  });
  it('entiende las unidades', () => {
    expect(crearMundo({ flujo: bucle(2, '={{ 2 }}', 'minutes'), ahoraMs: AHORA }).turno({}).esperas[0]!.segundos).toBe(120);
    expect(crearMundo({ flujo: bucle(2, '={{ 1.5 }}', 'seconds'), ahoraMs: AHORA }).turno({}).esperas[0]!.segundos).toBe(1.5);
  });
  it('NIEGA: una espera negativa, ilegible o de otra unidad hace fallar el nodo, no pasa de largo', () => {
    for (const [amount, unit] of [['={{ -1 }}', 'seconds'], ['={{ "x" }}', 'seconds'], ['={{ 3 }}', 'fortnights']] as const) {
      expect(() => crearMundo({ flujo: bucle(2, amount, unit), ahoraMs: AHORA }).turno({}), `${amount} ${unit}`).toThrow(/Esperar|espera no válida/);
    }
  });
  it('NIEGA: solo soporta resume «timeInterval»; otro modo lanza en vez de fingir', () => {
    const f = bucle(2);
    f.nodes.find((n) => n.name === 'Esperar')!.parameters['resume'] = 'webhook';
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(/timeInterval/);
  });
  it('un turno sin Wait no registra esperas', () => {
    expect(crearMundo({ flujo: bucle(1), ahoraMs: AHORA }).turno({}).esperas).toEqual([]);
  });
});

describe('las corridas de un nodo: $(nodo).all(rama, corrida)', () => {
  const flujo = (codigo: string): Flujo => {
    const f = bucle(3);
    f.nodes.find((n) => n.name === 'Fin')!.parameters['jsCode'] = codigo;
    return f;
  };
  it('lee una corrida y una rama concretas; sin argumentos, la última (como antes)', () => {
    const r = crearMundo({ flujo: flujo("return [{ json: { primera: $('Contar').all(0, 0)[0].json.vuelta, ultima: $('Contar').all(0, 2)[0].json.vuelta, sinArgs: $('Contar').all()[0].json.vuelta, first: $('Contar').first(0, 1).json.vuelta } }];"), ahoraMs: AHORA }).turno({});
    expect(r.porNodo['Fin']![0]).toEqual({ primera: 0, ultima: 2, sinArgs: 2, first: 1 });
  });
  it('NIEGA: una corrida que no existe LANZA, como n8n (no devuelve vacío en silencio)', () => {
    expect(() => crearMundo({ flujo: flujo("return [{ json: { x: $('Contar').all(0, 7).length } }];"), ahoraMs: AHORA }).turno({})).toThrow(/no tiene la corrida 7/);
  });
  it('una rama sin ítems da []', () => {
    const r = crearMundo({ flujo: flujo("return [{ json: { n: $('Contar').all(3, 0).length } }];"), ahoraMs: AHORA }).turno({});
    expect(r.porNodo['Fin']![0]).toEqual({ n: 0 });
  });
});

describe('pairedItem', () => {
  /** Entrada → Origen (3 ítems) → A (Code, el que se prueba) → B (Set, lee `$('Origen').item` en una expresión) y C (Code, lee `pairedItem` de lo que recibe). */
  function emparejado(codigoA: string): Flujo {
    return {
      name: 'pares',
      nodes: [
        { name: 'Entrada de prueba', type: 'n8n-nodes-base.noOp', parameters: {}, position: [0, 0] },
        code('Origen', "return $input.first().json.lista.map((x) => ({ json: { x } }));", 1),
        code('A', codigoA, 2),
        { name: 'B', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [30, 3], parameters: { assignments: { assignments: [
          { id: 'a', name: 'recibido', type: 'number', value: '={{ $json.y }}' }, { id: 'b', name: 'origen', type: 'number', value: "={{ $('Origen').item.json.x }}" }] }, options: {} } },
        code('C', "return $input.all().map((it) => ({ json: { par: it.pairedItem ? it.pairedItem.item : null } }));", 4),
      ],
      connections: { ...c('Entrada de prueba', 'Origen'), ...c('Origen', 'A'), ...c('A', 'B', 'C') },
    } as unknown as Flujo;
  }
  it('los ítems de entrada de un Code traen `pairedItem.item`: el índice en la entrada del nodo que los produjo', () => {
    const f = emparejado("return $input.all().map((it) => ({ json: { y: it.json.x * 10 } }));");
    const r = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] });
    expect(r.porNodo['C']!.map((j) => j['par'])).toEqual([0, 1, 2]);
  });
  it('un Code que devuelve `pairedItem` empareja `.item` a través de él, aunque cambie el orden', () => {
    const f = emparejado("const t = $input.all(); return [2, 1, 0].map((i) => ({ json: { y: t[i].json.x * 10 }, pairedItem: { item: i } }));");
    const r = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] });
    expect(r.porNodo['B']!.map((j) => [j['recibido'], j['origen']])).toEqual([[30, 3], [20, 2], [10, 1]]);
    // El que sigue ve SIEMPRE `{ item: su propio índice }` (n8n reescribe el pairedItem de la entrada de cada nodo), también tras un reordenamiento.
    expect(r.porNodo['C']!.map((j) => j['par'])).toEqual([0, 1, 2]);
  });
  it('NIEGA: sin `pairedItem` y con otro número de ítems, `.item` no se adivina y lanza', () => {
    const f = emparejado("return [{ json: { y: 1 } }, { json: { y: 2 } }];");
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] })).toThrow(/sin ítem emparejado|emitió/);
  });
  it('con el mismo número de ítems y sin `pairedItem`, n8n empareja por posición (como antes)', () => {
    const r = crearMundo({ flujo: emparejado("return $input.all().map((it) => ({ json: { y: it.json.x } }));"), ahoraMs: AHORA }).turno({ lista: [5, 6] });
    expect(r.porNodo['B']!.map((j) => j['origen'])).toEqual([5, 6]);
  });
  it('NIEGA: un `pairedItem` que apunta fuera de la entrada no empareja con nada', () => {
    const f = emparejado("return [{ json: { y: 1 }, pairedItem: { item: 9 } }];");
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] })).toThrow(/sin ítem emparejado|emitió|no se ejecutó/);
  });
});

describe('pairedItem tras un filtro y un Wait (el defecto de la revisión del PR #757)', () => {
  const iff = (name: string, y: number) => ({ name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [y * 10, y], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [{ id: 'c', leftValue: '={{ $json.x > 1 }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });
  const espera = (name: string, y: number) => ({ name, type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [y * 10, y], parameters: { resume: 'timeInterval', amount: '={{ 1 }}', unit: 'seconds' } });
  const lector = (name: string, y: number) => ({ name, type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [y * 10, y], parameters: { assignments: { assignments: [{ id: 'a', name: 'origen', type: 'number', value: "={{ $('Origen').item.json.x }}" }] }, options: {} } });
  const flujo = (...medio: object[]): Flujo => ({
    name: 'filtro-y-espera',
    nodes: [{ name: 'Entrada de prueba', type: 'n8n-nodes-base.noOp', parameters: {}, position: [0, 0] }, code('Origen', 'return $input.first().json.lista.map((x) => ({ json: { x } }));', 1), ...medio],
  } as unknown as Flujo);

  // n8n-core 2.36.4 (workflow-execute.js:893-918) reescribe el pairedItem de cada ítem de entrada a { item: itemIndex } ANTES de correr cualquier nodo,
  // y el Wait devuelve getInputData (ya reescritos): tras IF → Wait cada ítem empareja con SU origen, no con otro.
  it('tras IF → Wait, un ítem que NO era el primero sigue emparejando con SU origen (n8n reescribe el pairedItem de la entrada del Wait)', () => {
    const f = flujo(iff('Filtro', 2), espera('Esperar', 3), lector('Leer', 4));
    f.connections = { ...c('Entrada de prueba', 'Origen'), ...c('Origen', 'Filtro'), Filtro: { main: [[{ node: 'Esperar', type: 'main', index: 0 }], []] }, ...c('Esperar', 'Leer') } as Flujo['connections'];
    const r = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] });
    expect(r.porNodo['Leer']!.map((j) => j['origen'])).toEqual([2, 3]);
  });
  it('NIEGA: el Wait NO conserva el índice de más atrás (si lo conservara, el segundo ítem filtrado, índice 2, apuntaría fuera de la entrada del Wait y lanzaría)', () => {
    const f = flujo(iff('Filtro', 2), espera('Esperar', 3), lector('Leer', 4));
    f.connections = { ...c('Entrada de prueba', 'Origen'), ...c('Origen', 'Filtro'), Filtro: { main: [[{ node: 'Esperar', type: 'main', index: 0 }], []] }, ...c('Esperar', 'Leer') } as Flujo['connections'];
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] })).not.toThrow();
  });
  it('sin el Wait, el IF reescribe el pairedItem y el origen sale bien: el defecto es del nodo de paso, no del filtro', () => {
    const f = flujo(iff('Filtro', 2), lector('Leer', 4));
    f.connections = { ...c('Entrada de prueba', 'Origen'), ...c('Origen', 'Filtro'), Filtro: { main: [[{ node: 'Leer', type: 'main', index: 0 }], []] } } as Flujo['connections'];
    const r = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] });
    expect(r.porNodo['Leer']!.map((j) => j['origen'])).toEqual([2, 3]);
  });
  it('con un solo ítem tras el filtro también empareja', () => {
    const f = flujo(iff('Filtro', 2), espera('Esperar', 3), lector('Leer', 4));
    f.connections = { ...c('Entrada de prueba', 'Origen'), ...c('Origen', 'Filtro'), Filtro: { main: [[{ node: 'Esperar', type: 'main', index: 0 }], []] }, ...c('Esperar', 'Leer') } as Flujo['connections'];
    // Con lista [2]: el único ítem pasa el filtro con pairedItem 0 y el Wait tiene un ítem en la entrada, índice 0: empareja.
    const r = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [2] });
    expect(r.porNodo['Leer']!.map((j) => j['origen'])).toEqual([2]);
  });
  it('`$input.all()[i].pairedItem` es { item: i } para todo nodo, también tras un filtro', () => {
    // Filtro deja pasar los ítems 2 y 3 del origen (índices 1 y 2 en la entrada del filtro); el Wait recibe dos ítems y n8n los reindexa a 0 y 1.
    const f = flujo(iff('Filtro', 2), espera('Esperar', 3), code('Lee', "return $input.all().map((it) => ({ json: { par: it.pairedItem.item } }));", 4));
    f.connections = { ...c('Entrada de prueba', 'Origen'), ...c('Origen', 'Filtro'), Filtro: { main: [[{ node: 'Esperar', type: 'main', index: 0 }], []] }, ...c('Esperar', 'Lee') } as Flujo['connections'];
    const r = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ lista: [1, 2, 3] });
    expect(r.porNodo['Lee']!.map((j) => j['par'])).toEqual([0, 1]);
  });
});

describe('$execution.id', () => {
  it('por omisión sigue siendo ejecucion-de-mentira; `idEjecucion` lo cambia SOLO en ese turno', () => {
    const mu = crearMundo({ flujo: bucle(1), ahoraMs: AHORA });
    expect(mu.turno({}).porNodo['Contar']![0]!['id']).toBe('ejecucion-de-mentira');
    expect(mu.turno({}, { idEjecucion: 'E7' }).porNodo['Contar']![0]!['id']).toBe('E7');
    expect(mu.turno({}).porNodo['Contar']![0]!['id']).toBe('ejecucion-de-mentira');
  });
});

describe('lo que no cambió', () => {
  it('los globales que n8n no tiene siguen vacíos dentro de un Code', () => {
    const f = bucle(1);
    f.nodes.find((n) => n.name === 'Fin')!.parameters['jsCode'] = 'return [{ json: { url: typeof URL, buf: typeof Buffer, cry: typeof crypto, req: typeof require, st: typeof setTimeout } }];';
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).porNodo['Fin']![0]).toEqual({ url: 'undefined', buf: 'undefined', cry: 'undefined', req: 'undefined', st: 'undefined' });
  });
  it('un Code que no devuelve ítems con forma sigue siendo un error del nodo', () => {
    const f = bucle(1);
    f.nodes.find((n) => n.name === 'Fin')!.parameters['jsCode'] = 'return [5];';
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(/forma/);
  });
});

void (null as unknown as J);
