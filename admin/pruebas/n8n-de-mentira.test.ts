/**
 * EL n8n DE MENTIRA (`./lib/n8n-de-mentira.ts`), PROBADO CON FLUJOS DE JUGUETE.
 *
 * Un arnés que prueba flujos tiene que merecer confianza: si se equivoca, deja en verde un flujo roto o
 * en rojo uno sano. Por eso cada capacidad trae su negativo (lo contrario también se prueba), y los
 * flujos de juguete son inventados a mano, sin nada de ningún cliente. No hay `new Function` acá ni en
 * el arnés: todo el código de los nodos corre por `ejecutar` de `./lib/flujo`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo, J, Nodo } from './lib/flujo';
import { crearMundo, FalloDeNodo, SinDoble, textoDeEnvio, type Doble } from './lib/n8n-de-mentira';

// Lunes 05/10/2026, 10:00 en La Paz (UTC-4). Nada mira el reloj real.
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const TEL = '59100000011';

// ------------------------------------------------------------------------------ constructores de flujos
const nodo = (name: string, type: string, parameters: J, x = 0, y = 0, extra: J = {}): Nodo =>
  ({ name, type: `n8n-nodes-base.${type}`, typeVersion: 1, position: [x, y], parameters, ...extra }) as Nodo;

function flujo(nodes: Nodo[], enlaces: [string, string, number?][]): Flujo {
  const connections: Flujo['connections'] = {};
  for (const [desde, hacia, salida = 0] of enlaces) {
    const main = ((connections[desde] ??= { main: [] })['main'] ??= []);
    (main[salida] ??= []).push({ node: hacia, type: 'main', index: 0 });
  }
  return { name: 'Flujo de juguete', settings: { executionOrder: 'v1' }, nodes, connections };
}

const code = (name: string, jsCode: string, x = 0, y = 0, extra: J = {}): Nodo => nodo(name, 'code', { jsCode }, x, y, extra);
const http = (name: string, jsonBody: string, x = 0, y = 0, extra: J = {}): Nodo =>
  nodo(name, 'httpRequest', { method: 'POST', url: 'https://ejemplo.invalid/x', sendBody: true, specifyBody: 'json', jsonBody }, x, y, extra);
const condicion = (leftValue: unknown, tipo: string, operation: string, rightValue: unknown = '', extra: J = {}): J => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2, ...extra },
    conditions: [{ id: 'c1', leftValue, rightValue, operator: { type: tipo, operation, singleValue: rightValue === '' && /^(true|false|empty|notEmpty|exists|notExists)$/.test(operation) } }],
    combinator: 'and',
  },
  options: {},
});
const si = (name: string, p: J, x = 0, y = 0): Nodo => nodo(name, 'if', p, x, y);
const entrada = (x = 0, y = 0): Nodo => nodo('Entrada', 'webhook', { httpMethod: 'POST', path: 'ejemplo' }, x, y);

/** Un flujo mínimo: Entrada → IF (con la condición dada) → «Si» / «No» (dos Code que anotan quién corrió). */
function flujoDeIf(p: J): Flujo {
  return flujo(
    [entrada(), si('IF', p, 200, 0), code('Si', 'return [{ json: { rama: "si" } }];', 400, -100), code('No', 'return [{ json: { rama: "no" } }];', 400, 100)],
    [['Entrada', 'IF'], ['IF', 'Si', 0], ['IF', 'No', 1]],
  );
}
const rama = (f: Flujo, json: J): string | null => {
  const t = crearMundo({ flujo: f, ahoraMs: AHORA }).turno(json);
  return t.ejecutados.has('Si') ? 'si' : t.ejecutados.has('No') ? 'no' : null;
};

// ------------------------------------------------------------------------------ el flujo de juguete completo
// Recibe un mensaje de WhatsApp firmado, lo verifica, descarta repetidos, lo clasifica con código y contesta.
function flujoDeJuguete(): Flujo {
  return flujo(
    [
      entrada(0, 300),
      http('Verificar firma', '={{ JSON.stringify({ firma: $json.headers["x-firma"] ?? "", cuerpo: JSON.stringify($json.body), esperado: { waba: "WABA_EJEMPLO", marca: "}}" } }) }}', 200, 300),
      si('¿Firma válida?', condicion('={{ $json.valido }}', 'boolean', 'true'), 400, 300),
      nodo('Aceptar (200)', 'respondToWebhook', { respondWith: 'noData', options: { responseCode: 200 } }, 600, 200),
      nodo('Rechazar (401)', 'respondToWebhook', { respondWith: 'noData', options: { responseCode: 401 } }, 600, 400),
      nodo('Descartar repetidos', 'removeDuplicates', { operation: 'removeItemsSeenInPreviousExecutions', logic: 'removeItemsWithAlreadySeenKeyValues', dedupeValue: "={{ $('Verificar firma').item.json.deliveryId }}", options: {} }, 800, 200),
      nodo('Config base', 'set', { assignments: { assignments: [
        { id: 'a1', name: 'negocio', type: 'string', value: 'Negocio de Ejemplo' },
        { id: 'a2', name: 'topeAvisos', type: 'number', value: '3' },
      ] }, includeOtherFields: true, options: {} }, 1000, 200),
      code('Clasificar', `
        const cfg = $('Config base').first().json;
        const cuerpo = $('Entrada').first().json.body;
        const sd = $getWorkflowStaticData('global');
        sd.contador = (sd.contador || 0) + 1;
        const texto = String(cuerpo.texto || '');
        return [{ json: { from: cuerpo.from, texto, spam: /gratis/i.test(texto), n: sd.contador, negocio: cfg.negocio, hora: new Date().toISOString() } }];
      `, 1200, 200),
      si('¿Es spam?', condicion('={{ $json.spam }}', 'boolean', 'true'), 1400, 200),
      http('Enviar a WhatsApp', "={{ JSON.stringify({ to: $('Clasificar').item.json.from, type: 'text', text: { body: 'Hola desde ' + $('Clasificar').item.json.negocio + ': ' + $('Clasificar').item.json.texto } }) }}", 1600, 300),
      http('Reportar mensaje (entrante)', "={{ JSON.stringify({ telefono: $('Clasificar').first().json.from, direccion: 'entrante' }) }}", 1600, 100),
      code('Resumen del turno', `
        const t = $('Clasificar').first().json;
        return [{ json: { resumen: { n: t.n, spam: t.spam, hora: t.hora } } }];
      `, 1800, 300),
    ],
    [
      ['Entrada', 'Verificar firma'], ['Verificar firma', '¿Firma válida?'],
      ['¿Firma válida?', 'Aceptar (200)', 0], ['¿Firma válida?', 'Rechazar (401)', 1],
      ['Aceptar (200)', 'Descartar repetidos'], ['Descartar repetidos', 'Config base'], ['Config base', 'Clasificar'],
      ['Clasificar', '¿Es spam?'], ['¿Es spam?', 'Enviar a WhatsApp', 1], ['¿Es spam?', 'Reportar mensaje (entrante)', 1],
      ['Enviar a WhatsApp', 'Resumen del turno'],
    ],
  );
}

const doblesDeJuguete = (valido = true): Record<string, Doble> => ({
  // El verificador devuelve el `deliveryId` que le llegó dentro del cuerpo de la petición.
  'Verificar firma': (l) => ({ valido, deliveryId: String(JSON.parse(String(l.cuerpo?.['cuerpo']))['id'] ?? 'sin-id') }),
  'Enviar a WhatsApp': () => ({ messages: [{ id: 'wamid.OUT' }] }),
  'Reportar mensaje (entrante)': () => ({ ok: true }),
});

// La entrada lleva el id adentro del body para que el doble del verificador lo reenvíe.
const msg = (id: string, texto = 'hola', from = TEL): J => ({ headers: { 'x-firma': 'sello' }, body: { id, from, texto } });

// ================================================================================================
describe('n8n de mentira: el recorrido del grafo', () => {
  it('recorre connections de la entrada al final y corre el código de verdad', () => {
    const m = crearMundo({ flujo: flujoDeJuguete(), dobles: doblesDeJuguete(), ahoraMs: AHORA });
    const t = m.turno(msg('d1', 'quiero un taco'));
    expect(t.orden).toEqual([
      'Entrada', 'Verificar firma', '¿Firma válida?', 'Aceptar (200)', 'Descartar repetidos', 'Config base', 'Clasificar', '¿Es spam?',
      'Reportar mensaje (entrante)', 'Enviar a WhatsApp', 'Resumen del turno',
    ]);
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]).toMatchObject({ a: TEL, tipo: 'text', cuerpo: 'Hola desde Negocio de Ejemplo: quiero un taco', ok: true, respaldo: false });
    expect(t.resumen).toMatchObject({ resumen: { n: 1, spam: false } });
    expect(t.llamadas.ingesta).toEqual([{ telefono: TEL, direccion: 'entrante' }]);
    expect(t.fallo).toBeNull();
  });
  it('NIEGA: el spam toma la otra rama del IF y no manda nada', () => {
    const m = crearMundo({ flujo: flujoDeJuguete(), dobles: doblesDeJuguete(), ahoraMs: AHORA });
    const t = m.turno(msg('d1', 'iPhone GRATIS'));
    expect(t.mensajes).toHaveLength(0);
    expect(t.ejecutados.has('Enviar a WhatsApp')).toBe(false);
    expect(t.ejecutados.has('Resumen del turno')).toBe(false);
    expect(t.resumen).toBeNull();
    expect(t.porNodo['¿Es spam?']).toHaveLength(1);
  });

  it('las ramas corren por `y` y luego por `x`, y cada una termina antes de la siguiente', () => {
    const f = flujo(
      [entrada(), code('Abajo', 'return [{json:{}}];', 300, 200), code('Arriba', 'return [{json:{}}];', 300, 0),
        code('Arriba derecha', 'return [{json:{}}];', 500, 0), code('Hijo de arriba', 'return [{json:{}}];', 700, 0), code('Hijo de abajo', 'return [{json:{}}];', 500, 200)],
      [['Entrada', 'Abajo'], ['Entrada', 'Arriba'], ['Entrada', 'Arriba derecha'], ['Arriba', 'Hijo de arriba'], ['Abajo', 'Hijo de abajo']],
    );
    const t = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({});
    expect(t.orden).toEqual(['Entrada', 'Arriba', 'Hijo de arriba', 'Arriba derecha', 'Abajo', 'Hijo de abajo']);
  });
  it('NIEGA: si el nodo de abajo sube en el lienzo, cambia el orden', () => {
    const f = flujo(
      [entrada(), code('A', 'return [{json:{}}];', 300, 200), code('B', 'return [{json:{}}];', 300, 0)],
      [['Entrada', 'A'], ['Entrada', 'B']],
    );
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).orden).toEqual(['Entrada', 'B', 'A']);
    (f.nodes.find((n) => n.name === 'A') as Nodo).position = [300, -50];
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).orden).toEqual(['Entrada', 'A', 'B']);
  });

  it('una conexión a un nodo que no existe se rechaza al crear el mundo', () => {
    const roto = flujo([entrada()], [['Entrada', 'Fantasma']]);
    expect(() => crearMundo({ flujo: roto, ahoraMs: AHORA })).toThrow(/Fantasma/);
  });
  it('NIEGA: un flujo con las conexiones bien se crea', () => {
    expect(() => crearMundo({ flujo: flujoDeJuguete(), ahoraMs: AHORA })).not.toThrow();
  });

  it('detecta la entrada sola; con dos raíces pide `via`, y con `via` corre desde ahí', () => {
    const f = flujo(
      [nodo('Entrada de prueba', 'webhook', {}, 0, 0), nodo('Otra', 'webhook', {}, 0, 200), code('Uno', 'return [{json:{}}];', 300, 0)],
      [['Entrada de prueba', 'Uno'], ['Otra', 'Uno']],
    );
    // «Entrada de prueba» es un nombre conocido: gana.
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).orden).toEqual(['Entrada de prueba', 'Uno']);
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}, { via: 'Otra' }).orden).toEqual(['Otra', 'Uno']);
    const ambiguo = flujo([nodo('X', 'webhook', {}), nodo('Y', 'webhook', {}, 0, 100), code('Z', 'return [{json:{}}];', 200)], [['X', 'Z'], ['Y', 'Z']]);
    expect(() => crearMundo({ flujo: ambiguo, ahoraMs: AHORA }).turno({})).toThrow(/via/);
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}, { via: 'No existe' })).toThrow(/No existe/);
  });

  it('un ciclo no cuelga la prueba: `maxVisitas` lo corta', () => {
    const f = flujo([entrada(), code('A', 'return [{json:{}}];', 200), code('B', 'return [{json:{}}];', 400)], [['Entrada', 'A'], ['A', 'B'], ['B', 'A']]);
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA, maxVisitas: 20 }).turno({})).toThrow(/20 nodos visitados/);
  });
});

// ================================================================================================
describe('n8n de mentira: el IF', () => {
  const casos: { nombre: string; p: J; entrada: J; da: 'si' | 'no' }[] = [
    { nombre: 'boolean true', p: condicion('={{ $json.v }}', 'boolean', 'true'), entrada: { v: true }, da: 'si' },
    { nombre: 'boolean true con false', p: condicion('={{ $json.v }}', 'boolean', 'true'), entrada: { v: false }, da: 'no' },
    { nombre: 'boolean false', p: condicion('={{ $json.v }}', 'boolean', 'false'), entrada: { v: false }, da: 'si' },
    { nombre: 'boolean false con true', p: condicion('={{ $json.v }}', 'boolean', 'false'), entrada: { v: true }, da: 'no' },
    { nombre: 'string equals', p: condicion('={{ $json.v }}', 'string', 'equals', 'hola'), entrada: { v: 'hola' }, da: 'si' },
    { nombre: 'string equals distinto', p: condicion('={{ $json.v }}', 'string', 'equals', 'hola'), entrada: { v: 'Hola' }, da: 'no' },
    { nombre: 'string equals sin mayúsculas', p: condicion('={{ $json.v }}', 'string', 'equals', 'hola', { caseSensitive: false }), entrada: { v: 'HOLA' }, da: 'si' },
    { nombre: 'string notEquals', p: condicion('={{ $json.v }}', 'string', 'notEquals', 'hola'), entrada: { v: 'chau' }, da: 'si' },
    { nombre: 'string notEquals igual', p: condicion('={{ $json.v }}', 'string', 'notEquals', 'hola'), entrada: { v: 'hola' }, da: 'no' },
    { nombre: 'string notEmpty', p: condicion('={{ $json.v }}', 'string', 'notEmpty'), entrada: { v: 'x' }, da: 'si' },
    { nombre: 'string notEmpty vacío', p: condicion('={{ $json.v }}', 'string', 'notEmpty'), entrada: { v: '' }, da: 'no' },
    { nombre: 'string notEmpty ausente', p: condicion('={{ $json.v }}', 'string', 'notEmpty'), entrada: {}, da: 'no' },
    { nombre: 'string regex', p: condicion('={{ $json.v }}', 'string', 'regex', '/^pedido \\d+$/i'), entrada: { v: 'Pedido 12' }, da: 'si' },
    { nombre: 'string regex sin coincidencia', p: condicion('={{ $json.v }}', 'string', 'regex', '/^pedido \\d+$/i'), entrada: { v: 'pedido doce' }, da: 'no' },
    { nombre: 'string contains', p: condicion('={{ $json.v }}', 'string', 'contains', 'ac'), entrada: { v: 'taco' }, da: 'si' },
    { nombre: 'number gt', p: condicion('={{ $json.v }}', 'number', 'gt', 5), entrada: { v: 6 }, da: 'si' },
    { nombre: 'number gt igual', p: condicion('={{ $json.v }}', 'number', 'gt', 5), entrada: { v: 5 }, da: 'no' },
    { nombre: 'number gte igual', p: condicion('={{ $json.v }}', 'number', 'gte', 5), entrada: { v: 5 }, da: 'si' },
    { nombre: 'number gte menor', p: condicion('={{ $json.v }}', 'number', 'gte', 5), entrada: { v: 4 }, da: 'no' },
    { nombre: 'number equals', p: condicion('={{ $json.v }}', 'number', 'equals', 5), entrada: { v: 5 }, da: 'si' },
    { nombre: 'number equals distinto', p: condicion('={{ $json.v }}', 'number', 'equals', 5), entrada: { v: 6 }, da: 'no' },
  ];
  for (const c of casos) {
    it(`${c.nombre} → rama «${c.da}»`, () => {
      expect(rama(flujoDeIf(c.p), c.entrada)).toBe(c.da);
    });
  }

  it('con `or`, basta una condición; con `and`, hacen falta todas', () => {
    const dos = (combinator: 'and' | 'or'): J => {
      const base = condicion('={{ $json.a }}', 'number', 'gt', 1);
      (base['conditions'] as J)['conditions'].push({ id: 'c2', leftValue: '={{ $json.b }}', rightValue: 1, operator: { type: 'number', operation: 'gt' } });
      (base['conditions'] as J)['combinator'] = combinator;
      return base;
    };
    expect(rama(flujoDeIf(dos('or')), { a: 5, b: 0 })).toBe('si');
    expect(rama(flujoDeIf(dos('and')), { a: 5, b: 0 })).toBe('no');
    expect(rama(flujoDeIf(dos('and')), { a: 5, b: 5 })).toBe('si');
  });

  it('con `strict`, un string donde va un boolean revienta como en n8n; con `loose` se convierte', () => {
    const estricto = flujoDeIf(condicion('={{ $json.v }}', 'boolean', 'true'));
    expect(() => crearMundo({ flujo: estricto, ahoraMs: AHORA }).turno({ v: 'true' })).toThrow(FalloDeNodo);
    expect(() => crearMundo({ flujo: estricto, ahoraMs: AHORA }).turno({ v: 'true' })).toThrow(/IF/);
    const flojo = flujoDeIf(condicion('={{ $json.v }}', 'boolean', 'true', '', { typeValidation: 'loose' }));
    expect(rama(flojo, { v: 'true' })).toBe('si');
    expect(rama(flojo, { v: 'false' })).toBe('no');
  });

  it('una operación o un tipo que el arnés no soporta falla fuerte, no pasa en silencio', () => {
    expect(() => crearMundo({ flujo: flujoDeIf(condicion('={{ $json.v }}', 'dateTime', 'after', '2026-01-01')), ahoraMs: AHORA }).turno({ v: '2026-02-01' })).toThrow(/dateTime/);
    expect(() => crearMundo({ flujo: flujoDeIf(condicion('={{ $json.v }}', 'string', 'rarisima', 'x')), ahoraMs: AHORA }).turno({ v: 'x' })).toThrow(/rarisima/);
  });

  it('un IF puede fallar con `continueErrorOutput`: el error va por la segunda salida', () => {
    const f = flujoDeIf(condicion('={{ $json.v }}', 'boolean', 'true'));
    (f.nodes.find((n) => n.name === 'IF') as Nodo).onError = 'continueErrorOutput';
    const t = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ v: 'true' });
    expect(t.ejecutados.has('No')).toBe(true);
    expect(t.porNodo['No']).toEqual([{ rama: 'no' }]);
    expect(t.salidas['IF']?.[1]?.[0]?.['error']).toMatch(/tipo equivocado/);
  });
});

// ================================================================================================
describe('n8n de mentira: el Set', () => {
  const conSet = (parametros: J): Flujo => flujo(
    [entrada(), nodo('Config base', 'set', parametros, 200), code('Fin', 'return [{ json: $input.first().json }];', 400)],
    [['Entrada', 'Config base'], ['Config base', 'Fin']],
  );
  const asignar = (...a: [string, string, unknown][]): J => ({ assignments: a.map(([name, type, value], i) => ({ id: `a${i}`, name, type, value })) });

  it('con includeOtherFields conserva lo que llega y suma las asignaciones, con su tipo', () => {
    const f = conSet({ assignments: asignar(['negocio', 'string', 'Ejemplo'], ['tope', 'number', '3'], ['activo', 'boolean', 'true'], ['dato', 'object', '{"a":1}']), includeOtherFields: true, options: {} });
    const t = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ previo: 'si' });
    expect(t.porNodo['Fin']).toEqual([{ previo: 'si', negocio: 'Ejemplo', tope: 3, activo: true, dato: { a: 1 } }]);
  });
  it('NIEGA: sin includeOtherFields (el valor por omisión de la v3.4) lo previo se pierde', () => {
    const f = conSet({ assignments: asignar(['negocio', 'string', 'Ejemplo']), options: {} });
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ previo: 'si' }).porNodo['Fin']).toEqual([{ negocio: 'Ejemplo' }]);
  });
  it('evalúa expresiones en los valores y respeta los nombres con puntos (y `dotNotation: false`)', () => {
    const p = { assignments: asignar(['cliente.nombre', 'string', '={{ $json.n.toUpperCase() }}'], ['cliente.tel', 'string', '={{ "591" + $json.t }}']), options: {} };
    expect(crearMundo({ flujo: conSet(p), ahoraMs: AHORA }).turno({ n: 'ana', t: '1' }).porNodo['Fin']).toEqual([{ cliente: { nombre: 'ANA', tel: '5911' } }]);
    const sin = { ...p, options: { dotNotation: false } };
    expect(crearMundo({ flujo: conSet(sin), ahoraMs: AHORA }).turno({ n: 'ana', t: '1' }).porNodo['Fin']).toEqual([{ 'cliente.nombre': 'ANA', 'cliente.tel': '5911' }]);
  });
  it('un valor que no es del tipo declarado falla (un número que no lo es)', () => {
    const f = conSet({ assignments: asignar(['tope', 'number', 'mucho']), options: {} });
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(/no es un número/);
  });
  it('`configBase` cambia (o agrega) asignaciones del Set `Config base` sin tocar el flujo original', () => {
    const f = conSet({ assignments: asignar(['negocio', 'string', 'Ejemplo']), includeOtherFields: true, options: {} });
    const m = crearMundo({ flujo: f, ahoraMs: AHORA, configBase: { negocio: 'Otro', extra: 7 } });
    expect(m.turno({}).porNodo['Fin']).toEqual([{ negocio: 'Otro', extra: 7 }]);
    // NIEGA: el flujo que se le pasó no cambió, y un mundo nuevo sin configBase ve el original.
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).porNodo['Fin']).toEqual([{ negocio: 'Ejemplo' }]);
  });
  it('`configBase` sobre un flujo sin `Config base` falla', () => {
    expect(() => crearMundo({ flujo: flujoDeIf(condicion('={{ 1 }}', 'number', 'equals', 1)), ahoraMs: AHORA, configBase: { a: 1 } })).toThrow(/Config base/);
  });
  it('el Set en modo raw no se soporta y lo dice', () => {
    const f = conSet({ mode: 'raw', jsonOutput: '{}', options: {} });
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(/raw/);
  });
});

// ================================================================================================
describe('n8n de mentira: el Code, los datos estáticos y el reloj', () => {
  const contador = flujo(
    [entrada(), code('Contar', `
      const sd = $getWorkflowStaticData('global');
      sd.vistos = (sd.vistos || 0) + 1;
      return [{ json: { vistos: sd.vistos, iso: new Date().toISOString(), ms: Date.now() } }];
    `, 200)],
    [['Entrada', 'Contar']],
  );

  it('los datos estáticos persisten entre turnos del mismo mundo y están en `sd`', () => {
    const m = crearMundo({ flujo: contador, ahoraMs: AHORA });
    expect(m.turno({}).porNodo['Contar']?.[0]?.['vistos']).toBe(1);
    expect(m.turno({}).porNodo['Contar']?.[0]?.['vistos']).toBe(2);
    expect(m.sd['vistos']).toBe(2);
  });
  it('NIEGA: otro mundo parte de cero, y el `sd` de un nodo es distinto del global', () => {
    const a = crearMundo({ flujo: contador, ahoraMs: AHORA });
    a.turno({});
    expect(crearMundo({ flujo: contador, ahoraMs: AHORA }).turno({}).porNodo['Contar']?.[0]?.['vistos']).toBe(1);
    const porNodo = flujo([entrada(), code('N', `$getWorkflowStaticData('node').x = 1; return [{ json: {} }];`, 200)], [['Entrada', 'N']]);
    const m = crearMundo({ flujo: porNodo, ahoraMs: AHORA });
    m.turno({});
    expect(m.sdNodos['N']).toEqual({ x: 1 });
    expect(m.sd).toEqual({});
  });

  it('el primer turno corre EXACTAMENTE a `ahoraMs`; el siguiente, un minuto después; `avanzarMin` manda', () => {
    const m = crearMundo({ flujo: contador, ahoraMs: AHORA });
    expect(m.turno({}).porNodo['Contar']?.[0]?.['ms']).toBe(AHORA);
    expect(m.turno({}).porNodo['Contar']?.[0]?.['ms']).toBe(AHORA + 60_000);
    expect(m.turno({}, { avanzarMin: 90 }).porNodo['Contar']?.[0]?.['ms']).toBe(AHORA + 60_000 + 90 * 60_000);
    expect(m.turno({}, { avanzarMin: 0 }).porNodo['Contar']?.[0]?.['ms']).toBe(AHORA + 60_000 + 90 * 60_000);
    expect(m.ahora()).toBe(AHORA + 60_000 + 90 * 60_000);
  });
  it('el reloj no avanza solo dentro del turno, y `avanzar` lo mueve entre turnos', () => {
    const f = flujo([entrada(), code('Dos lecturas', 'const a = Date.now(); for (let i = 0; i < 200000; i++) {} return [{ json: { a, b: Date.now(), c: new Date().getTime() } }];', 200)], [['Entrada', 'Dos lecturas']]);
    const m = crearMundo({ flujo: f, ahoraMs: AHORA });
    expect(m.turno({}).porNodo['Dos lecturas']).toEqual([{ a: AHORA, b: AHORA, c: AHORA }]);
    expect(m.avanzar(30)).toBe(AHORA + 30 * 60_000);
    expect(m.turno({}, { avanzarMin: 0 }).porNodo['Dos lecturas']?.[0]?.['a']).toBe(AHORA + 30 * 60_000);
  });

  it('el código corre en el mismo sandbox que producción: sin Buffer, URL ni crypto', () => {
    for (const global of ['Buffer', 'URL', 'crypto']) {
      const f = flujo([entrada(), code('Usa global', `return [{ json: { x: typeof ${global} } }];`, 200)], [['Entrada', 'Usa global']]);
      expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).porNodo['Usa global']).toEqual([{ x: 'undefined' }]);
      const f2 = flujo([entrada(), code('Usa global', `return [{ json: { x: new ${global}('a').toString() } }];`, 200)], [['Entrada', 'Usa global']]);
      expect(() => crearMundo({ flujo: f2, ahoraMs: AHORA }).turno({})).toThrow(FalloDeNodo);
    }
  });
  it('un Code que devuelve objetos sin `json` es un error, como en n8n', () => {
    const f = flujo([entrada(), code('Mal', 'return [{ x: 1 }];', 200)], [['Entrada', 'Mal']]);
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(/forma \{ json/);
  });
  it('el Code no puede mutar el ítem de otro nodo: recibe copias', () => {
    const f = flujo(
      [entrada(), code('Muta', 'const it = $input.first(); it.json.cambiado = true; return [it];', 200)],
      [['Entrada', 'Muta']],
    );
    const t = crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ a: 1 });
    expect(t.porNodo['Muta']).toEqual([{ a: 1, cambiado: true }]);
    expect(t.porNodo['Entrada']).toEqual([{ a: 1 }]);
  });
  it('Code en runOnceForEachItem o en Python no se soporta y lo dice', () => {
    const f1 = flujo([entrada(), code('Cada uno', 'return {};', 200, 0, {})], [['Entrada', 'Cada uno']]);
    (f1.nodes[1] as Nodo).parameters['mode'] = 'runOnceForEachItem';
    expect(() => crearMundo({ flujo: f1, ahoraMs: AHORA }).turno({})).toThrow(/runOnceForEachItem/);
    const f2 = flujo([entrada(), code('Py', 'x', 200)], [['Entrada', 'Py']]);
    (f2.nodes[1] as Nodo).parameters['language'] = 'pythonNative';
    expect(() => crearMundo({ flujo: f2, ahoraMs: AHORA }).turno({})).toThrow(/JavaScript/);
  });
});

// ================================================================================================
describe('n8n de mentira: webhook y repetidos', () => {
  it('Aceptar (200) y Rechazar (401) se registran con su código, y el rechazo corta el flujo', () => {
    const bien = crearMundo({ flujo: flujoDeJuguete(), dobles: doblesDeJuguete(true), ahoraMs: AHORA }).turno(msg('d1'));
    expect(bien.respuestasWebhook).toEqual([{ nodo: 'Aceptar (200)', codigo: 200, respondWith: 'noData', cuerpo: undefined }]);
    const mal = crearMundo({ flujo: flujoDeJuguete(), dobles: doblesDeJuguete(false), ahoraMs: AHORA }).turno(msg('d1'));
    expect(mal.respuestasWebhook.map((r) => r.codigo)).toEqual([401]);
    expect(mal.mensajes).toHaveLength(0);
    expect(mal.ejecutados.has('Descartar repetidos')).toBe(false);
    expect(mal.llamadas.ingesta).toHaveLength(0);
  });
  it('respondToWebhook con json y con allIncomingItems devuelve el cuerpo evaluado', () => {
    const f = flujo(
      [entrada(), nodo('Responder', 'respondToWebhook', { respondWith: 'json', responseBody: '={{ JSON.stringify({ ok: true, eco: $json.x }) }}', options: { responseCode: 202 } }, 200),
        nodo('Todo', 'respondToWebhook', { respondWith: 'allIncomingItems', options: {} }, 400)],
      [['Entrada', 'Responder'], ['Responder', 'Todo']],
    );
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ x: 5 }).respuestasWebhook).toEqual([
      { nodo: 'Responder', codigo: 202, respondWith: 'json', cuerpo: { ok: true, eco: 5 } },
      { nodo: 'Todo', codigo: 200, respondWith: 'allIncomingItems', cuerpo: [{ x: 5 }] },
    ]);
  });

  it('el mismo `deliveryId` dos veces: el segundo turno no contesta ni reporta (memoria entre turnos)', () => {
    const m = crearMundo({ flujo: flujoDeJuguete(), dobles: doblesDeJuguete(), ahoraMs: AHORA });
    expect(m.turno(msg('d1')).mensajes).toHaveLength(1);
    const dos = m.turno(msg('d1'));
    expect(dos.mensajes).toHaveLength(0);
    expect(dos.llamadas.ingesta).toHaveLength(0);
    expect(dos.ejecutados.has('Clasificar')).toBe(false);
    expect([...(m.repetidos.get('Descartar repetidos') ?? [])]).toEqual(['d1']);
    // El 200 sí salió las dos veces: Meta no debe reintentar.
    expect(dos.respuestasWebhook.map((r) => r.codigo)).toEqual([200]);
  });
  it('NIEGA: con otro id pasa, y otro mundo no hereda la memoria', () => {
    const m = crearMundo({ flujo: flujoDeJuguete(), dobles: doblesDeJuguete(), ahoraMs: AHORA });
    m.turno(msg('d1'));
    expect(m.turno(msg('d2')).mensajes).toHaveLength(1);
    expect(crearMundo({ flujo: flujoDeJuguete(), dobles: doblesDeJuguete(), ahoraMs: AHORA }).turno(msg('d1')).mensajes).toHaveLength(1);
  });
  it('un `dedupeValue` vacío se rechaza: descartaría todos los mensajes siguientes', () => {
    // El doble devuelve un deliveryId vacío.
    const dobles = { ...doblesDeJuguete(), 'Verificar firma': () => ({ valido: true, deliveryId: '' }) };
    expect(() => crearMundo({ flujo: flujoDeJuguete(), dobles, ahoraMs: AHORA }).turno(msg('d1'))).toThrow(/dedupeValue/);
  });
  it('removeDuplicates dentro de la entrada: iguales por todos los campos, o por los campos elegidos', () => {
    const arreglo = code('Tres', 'return [{ json: { a: 1, b: 1 } }, { json: { a: 1, b: 1 } }, { json: { a: 1, b: 2 } }];', 200);
    const dedupe = (p: J): Flujo => flujo([entrada(), arreglo, nodo('Unicos', 'removeDuplicates', { operation: 'removeDuplicateInputItems', ...p }, 400)], [['Entrada', 'Tres'], ['Tres', 'Unicos']]);
    expect(crearMundo({ flujo: dedupe({ compare: 'allFields' }), ahoraMs: AHORA }).turno({}).porNodo['Unicos']).toHaveLength(2);
    expect(crearMundo({ flujo: dedupe({ compare: 'selectedFields', fieldsToCompare: 'a' }), ahoraMs: AHORA }).turno({}).porNodo['Unicos']).toHaveLength(1);
    expect(crearMundo({ flujo: dedupe({ compare: 'allFieldsExcept', fieldsToExclude: 'b' }), ahoraMs: AHORA }).turno({}).porNodo['Unicos']).toHaveLength(1);
  });
  it('una operación de removeDuplicates que el arnés no soporta falla fuerte', () => {
    const f = flujo([entrada(), nodo('RD', 'removeDuplicates', { operation: 'clearDeduplicationHistory' }, 200)], [['Entrada', 'RD']]);
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(/clearDeduplicationHistory/);
  });
});

// ================================================================================================
describe('n8n de mentira: los dobles de red', () => {
  const unHttp = (jsonBody: string, extra: J = {}): Flujo => flujo([entrada(), http('Llamar', jsonBody, 200, 0, extra), code('Después', 'return [{ json: { vio: $input.first().json } }];', 400)], [['Entrada', 'Llamar'], ['Llamar', 'Después']]);

  it('el doble recibe el jsonBody ya evaluado y parseado, con llaves y comillas anidadas', () => {
    const f = unHttp(`={{ JSON.stringify({ a: { b: $json.x }, texto: 'cierra }} aquí', otro: "con 'comillas'", cola: \`\${ $json.x + 1 }\` }) }}`);
    let visto: J | undefined;
    const m = crearMundo({ flujo: f, dobles: { Llamar: (l) => { visto = l.cuerpo; return { ok: true }; } }, ahoraMs: AHORA });
    m.turno({ x: 41 });
    expect(visto).toEqual({ a: { b: 41 }, texto: 'cierra }} aquí', otro: "con 'comillas'", cola: '42' });
  });
  it('NIEGA: un jsonBody que no es JSON válido es un error del nodo, no un cuerpo vacío', () => {
    const f = unHttp('={{ "no soy json" }}');
    expect(() => crearMundo({ flujo: f, dobles: { Llamar: {} }, ahoraMs: AHORA }).turno({})).toThrow(/jsonBody no es JSON válido/);
  });
  it('las plantillas mezcladas (texto y varias expresiones) se evalúan: url, método y cabeceras llegan al doble', () => {
    const f = flujo([entrada(), nodo('Graph', 'httpRequest', {
      method: 'POST', url: '=https://graph.invalid/{{ $json.version || "v1" }}/{{ $json.id }}/messages',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Numero', value: '={{ $json.id }}' }] }, sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ ok: 1 }) }}',
    }, 200)], [['Entrada', 'Graph']]);
    let l: { url: string; metodo: string; encabezados: Record<string, string>; n: number } | undefined;
    crearMundo({ flujo: f, dobles: { Graph: (x) => { l = x; return {}; } }, ahoraMs: AHORA }).turno({ id: '77' });
    expect(l).toMatchObject({ url: 'https://graph.invalid/v1/77/messages', metodo: 'POST', encabezados: { 'X-Numero': '77' }, n: 1 });
  });

  it('un doble puede ser un valor (objeto = un ítem, arreglo = varios) o una función; recibe `n`', () => {
    const f = unHttp('={{ JSON.stringify({}) }}');
    expect(crearMundo({ flujo: f, dobles: { Llamar: { ok: 1 } }, ahoraMs: AHORA }).turno({}).porNodo['Llamar']).toEqual([{ ok: 1 }]);
    expect(crearMundo({ flujo: f, dobles: { Llamar: [{ i: 1 }, { i: 2 }] }, ahoraMs: AHORA }).turno({}).porNodo['Después']).toEqual([{ vio: { i: 1 } }]);
    const m = crearMundo({ flujo: f, dobles: { Llamar: (l) => ({ n: l.n }) }, ahoraMs: AHORA });
    expect(m.turno({}).porNodo['Llamar']).toEqual([{ n: 1 }]);
    expect(m.turno({}).porNodo['Llamar']).toEqual([{ n: 2 }]);
  });
  it('los dobles se pueden cambiar entre turnos (`mundo.dobles`)', () => {
    const f = unHttp('={{ JSON.stringify({}) }}');
    const m = crearMundo({ flujo: f, dobles: { Llamar: { ok: true } }, ahoraMs: AHORA });
    expect(m.turno({}).porNodo['Llamar']).toEqual([{ ok: true }]);
    m.dobles['Llamar'] = { ok: false };
    expect(m.turno({}).porNodo['Llamar']).toEqual([{ ok: false }]);
  });
  it('el doble recibe una copia del ítem y lo que devuelve se copia: mutarlos no cambia el mundo', () => {
    const f = unHttp('={{ JSON.stringify({}) }}');
    const fijo = { dato: { n: 1 } };
    const m = crearMundo({ flujo: f, dobles: { Llamar: (l) => { l.item['tocado'] = true; return fijo; } }, ahoraMs: AHORA });
    const t = m.turno({ x: 1 });
    (t.porNodo['Llamar']?.[0]?.['dato'] as J)['n'] = 99;
    expect(fijo.dato.n).toBe(1);
    expect(t.porNodo['Entrada']).toEqual([{ x: 1 }]);
  });

  it('un nodo de red SIN doble falla con su nombre, aunque tenga onError', () => {
    const f = unHttp('={{ JSON.stringify({}) }}', { onError: 'continueRegularOutput' });
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(SinDoble);
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({})).toThrow(/«Llamar»/);
    expect(() => crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}, { tolerarFallo: true })).toThrow(SinDoble);
  });
  it('NIEGA: con el doble puesto, el mismo flujo corre', () => {
    const f = unHttp('={{ JSON.stringify({}) }}', { onError: 'continueRegularOutput' });
    expect(() => crearMundo({ flujo: f, dobles: { Llamar: {} }, ahoraMs: AHORA }).turno({})).not.toThrow();
  });
  it('un doble tiene prioridad sobre el tipo nativo: puede reemplazar un Code', () => {
    const f = flujo([entrada(), code('Real', 'return [{ json: { de: "codigo" } }];', 200)], [['Entrada', 'Real']]);
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).porNodo['Real']).toEqual([{ de: 'codigo' }]);
    expect(crearMundo({ flujo: f, dobles: { Real: { de: 'doble' } }, ahoraMs: AHORA }).turno({}).porNodo['Real']).toEqual([{ de: 'doble' }]);
  });
});

// ================================================================================================
describe('n8n de mentira: los errores de nodo', () => {
  const caido: Doble = () => { throw new Error('Meta rechazó el mensaje'); };
  const unHttp = (extra: J = {}): Flujo => flujo(
    [entrada(), http('Llamar', '={{ JSON.stringify({}) }}', 200, 0, extra), code('Después', 'return [{ json: { vio: $input.first().json } }];', 400)],
    [['Entrada', 'Llamar'], ['Llamar', 'Después']],
  );

  it('sin onError, el error lanza FalloDeNodo con el nombre del nodo y la causa', () => {
    try {
      crearMundo({ flujo: unHttp(), dobles: { Llamar: caido }, ahoraMs: AHORA }).turno({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FalloDeNodo);
      expect((e as FalloDeNodo).nodo).toBe('Llamar');
      expect((e as FalloDeNodo).message).toMatch(/«Llamar».*Meta rechazó/);
    }
  });
  it('con tolerarFallo queda en `resultado.fallo` y el turno termina ahí (lo anterior se conserva)', () => {
    const t = crearMundo({ flujo: unHttp(), dobles: { Llamar: caido }, ahoraMs: AHORA }).turno({}, { tolerarFallo: true });
    expect(t.fallo).toMatchObject({ nodo: 'Llamar', mensaje: 'Meta rechazó el mensaje' });
    expect(t.orden).toEqual(['Entrada', 'Llamar']);
    expect(t.ejecutados.has('Después')).toBe(false);
  });
  it('con continueRegularOutput el error sigue por la salida normal como `{ error }`', () => {
    const t = crearMundo({ flujo: unHttp({ onError: 'continueRegularOutput' }), dobles: { Llamar: caido }, ahoraMs: AHORA }).turno({});
    expect(t.fallo).toBeNull();
    expect(t.porNodo['Después']).toEqual([{ vio: { error: 'Meta rechazó el mensaje' } }]);
  });
  it('con continueErrorOutput el error sale por la segunda salida y la primera queda vacía', () => {
    const f = flujo(
      [entrada(), http('Llamar', '={{ JSON.stringify({}) }}', 200, 0, { onError: 'continueErrorOutput' }), code('Bien', 'return [{ json: { r: "bien" } }];', 400, -100), code('Mal', 'return [{ json: { r: "mal" } }];', 400, 100)],
      [['Entrada', 'Llamar'], ['Llamar', 'Bien', 0], ['Llamar', 'Mal', 1]],
    );
    const roto = crearMundo({ flujo: f, dobles: { Llamar: caido }, ahoraMs: AHORA }).turno({});
    expect(roto.ejecutados.has('Bien')).toBe(false);
    expect(roto.porNodo['Mal']).toEqual([{ r: 'mal' }]);
    const sano = crearMundo({ flujo: f, dobles: { Llamar: { ok: 1 } }, ahoraMs: AHORA }).turno({});
    expect(sano.ejecutados.has('Mal')).toBe(false);
    expect(sano.porNodo['Bien']).toEqual([{ r: 'bien' }]);
  });
  it('un Code que lanza, o una expresión que revienta, también son errores del nodo', () => {
    const codigo = flujo([entrada(), code('Roto', 'throw new Error("boom");', 200)], [['Entrada', 'Roto']]);
    expect(() => crearMundo({ flujo: codigo, ahoraMs: AHORA }).turno({})).toThrow(/«Roto».*boom/);
    const expr = unHttp();
    (expr.nodes[1] as Nodo).parameters['jsonBody'] = '={{ JSON.stringify({ a: $json.no.existe.nunca }) }}';
    expect(() => crearMundo({ flujo: expr, dobles: { Llamar: {} }, ahoraMs: AHORA }).turno({})).toThrow(/«Llamar»/);
    // Con continueOnFail antiguo, también se tolera.
    const tolerado = flujo([entrada(), code('Roto', 'throw new Error("boom");', 200, 0, { continueOnFail: true })], [['Entrada', 'Roto']]);
    expect(crearMundo({ flujo: tolerado, ahoraMs: AHORA }).turno({}).porNodo['Roto']).toEqual([{ error: 'boom' }]);
  });
});

// ================================================================================================
describe('n8n de mentira: los roles', () => {
  const grande = (): Flujo => flujo(
    [entrada(),
      http('Enviar a WhatsApp', '={{ JSON.stringify({ to: "59100000011", type: "text", text: { body: "uno" } }) }}', 200, 0),
      http('Enviar respaldo', '={{ JSON.stringify({ to: "59100000011", type: "text", text: { body: "dos" } }) }}', 400, 0),
      http('Enviar aviso', '={{ JSON.stringify({ to: "59100000022", type: "template", template: { name: "p", components: [{ type: "body", parameters: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] } }) }}', 600, 0),
      http('Aviso de respaldo', '={{ JSON.stringify({ to: "59100000022", type: "text", text: { body: "texto" } }) }}', 800, 0),
      http('Reportar mensaje (saliente)', '={{ JSON.stringify({ direccion: "saliente" }) }}', 1000, 0),
      http('Registrar cierre', '={{ JSON.stringify({ tipo: "registro", detalle: "d" }) }}', 1200, 0),
      http('Cotejar en el servidor', '={{ JSON.stringify({ monto: 55 }) }}', 1400, 0),
      http('Extraer', '={{ JSON.stringify({ contents: [] }) }}', 1600, 0),
      code('Resumen del turno', 'return [{ json: { resumen: { ok: true } } }, { json: { otro: 1 } }];', 1800, 0)],
    [['Entrada', 'Enviar a WhatsApp'], ['Enviar a WhatsApp', 'Enviar respaldo'], ['Enviar respaldo', 'Enviar aviso'], ['Enviar aviso', 'Aviso de respaldo'],
      ['Aviso de respaldo', 'Reportar mensaje (saliente)'], ['Reportar mensaje (saliente)', 'Registrar cierre'], ['Registrar cierre', 'Cotejar en el servidor'],
      ['Cotejar en el servidor', 'Extraer'], ['Extraer', 'Resumen del turno']],
  );
  const todos: Record<string, Doble> = {
    'Enviar a WhatsApp': { messages: [{ id: 'w1' }] }, 'Enviar respaldo': { messages: [{ id: 'w2' }] }, 'Enviar aviso': { messages: [{ id: 'w3' }] },
    'Aviso de respaldo': { messages: [{ id: 'w4' }] }, 'Reportar mensaje (saliente)': {}, 'Registrar cierre': {}, 'Cotejar en el servidor': {}, Extraer: {},
  };

  it('junta mensajes, avisos y llamadas por rol, con el texto visible y la marca de respaldo', () => {
    const t = crearMundo({ flujo: grande(), dobles: todos, ahoraMs: AHORA }).turno({});
    expect(t.mensajes.map((m) => [m.nodo, m.cuerpo, m.respaldo])).toEqual([['Enviar a WhatsApp', 'uno', false], ['Enviar respaldo', 'dos', true]]);
    expect(t.avisos.map((m) => [m.nodo, m.a, m.cuerpo, m.respaldo])).toEqual([
      ['Enviar aviso', '59100000022', 'a | b', false], ['Aviso de respaldo', '59100000022', 'texto', true],
    ]);
    expect(t.llamadas).toEqual({ ingesta: [{ direccion: 'saliente' }], cierre: [{ tipo: 'registro', detalle: 'd' }], cotejo: [{ monto: 55 }], extraer: [{ contents: [] }] });
    expect(t.resumen).toEqual({ resumen: { ok: true } });
    expect(t.mensajesA(TEL)).toHaveLength(2);
    expect(t.mensajesA('59100000099')).toHaveLength(0);
    expect(t.avisosA('59100000022')).toHaveLength(2);
    expect(t.registro.map((r) => r.rol)).toEqual(['mensajes', 'mensajes', 'avisos', 'avisos', 'ingesta', 'cierre', 'cotejo', 'extraer']);
  });
  it('`llamadas` del turno es del turno, y la del mundo acumula', () => {
    const m = crearMundo({ flujo: grande(), dobles: todos, ahoraMs: AHORA });
    m.turno({});
    const dos = m.turno({});
    expect(dos.llamadas.cotejo).toHaveLength(1);
    expect(m.llamadas.cotejo).toHaveLength(2);
    expect(m.llamadas.ingesta).toHaveLength(2);
  });
  it('un envío que falla queda con `ok: false` (doble que contesta `error`, o que lanza con onError)', () => {
    const t = crearMundo({ flujo: grande(), dobles: { ...todos, 'Enviar a WhatsApp': { error: { message: 'Meta rechazó', code: 132000 } } }, ahoraMs: AHORA }).turno({});
    expect(t.mensajes.map((m) => m.ok)).toEqual([false, true]);
    const f = grande();
    (f.nodes.find((n) => n.name === 'Enviar respaldo') as Nodo).onError = 'continueRegularOutput';
    const t2 = crearMundo({ flujo: f, dobles: { ...todos, 'Enviar respaldo': () => { throw new Error('caído'); } }, ahoraMs: AHORA }).turno({});
    expect(t2.mensajes.map((m) => m.ok)).toEqual([true, false]);
  });
  it('los roles se sobrescriben por nombre de nodo; lo que no está en ningún rol no se junta', () => {
    const f = flujo([entrada(), http('Mandar', '={{ JSON.stringify({ to: "1", type: "text", text: { body: "x" } }) }}', 200), http('Mandar 2', '={{ JSON.stringify({ to: "2", type: "text", text: { body: "y" } }) }}', 400)], [['Entrada', 'Mandar'], ['Mandar', 'Mandar 2']]);
    const dobles = { Mandar: {}, 'Mandar 2': {} };
    const sinRol = crearMundo({ flujo: f, dobles, ahoraMs: AHORA }).turno({});
    expect(sinRol.mensajes).toHaveLength(0);
    expect(sinRol.registro.map((r) => r.rol)).toEqual([null, null]);
    const conRol = crearMundo({ flujo: f, dobles, ahoraMs: AHORA, roles: { mensajes: ['Mandar', 'Mandar 2'] } }).turno({});
    expect(conRol.mensajes.map((m) => [m.a, m.respaldo])).toEqual([['1', false], ['2', true]]);
    // Un rol dado como texto suelto también vale.
    expect(crearMundo({ flujo: f, dobles, ahoraMs: AHORA, roles: { avisos: 'Mandar' } }).turno({}).avisos).toHaveLength(1);
  });
  it('`textoDeEnvio` lee texto, botones, plantilla e imagen', () => {
    expect(textoDeEnvio({ type: 'text', text: { body: 'hola' } })).toBe('hola');
    expect(textoDeEnvio({ type: 'interactive', interactive: { body: { text: 'elige' } } })).toBe('elige');
    expect(textoDeEnvio({ type: 'image', image: { link: 'https://x.invalid/q.png', caption: 'pie' } })).toBe('pie');
    expect(textoDeEnvio({ type: 'template', template: { components: [{ parameters: [{ text: 'a' }] }, { parameters: [{ text: 'b' }] }] } })).toBe('a | b');
    expect(textoDeEnvio({ type: 'location' })).toBe('{"type":"location"}');
  });
});

// ================================================================================================
describe('n8n de mentira: ítems emparejados, desactivados y salida vacía', () => {
  // «Dividir» saca de un ítem dos; cada uno debe seguir viendo el SUYO con `$('Dividir').item`.
  const dividir = (): Flujo => flujo(
    [entrada(), code('Dividir', 'return [{ json: { n: 1 } }, { json: { n: 2 } }];', 200),
      http('Llamar', "={{ JSON.stringify({ propio: $('Dividir').item.json.n, primero: $('Dividir').first().json.n, todos: $('Dividir').all().length }) }}", 400)],
    [['Entrada', 'Dividir'], ['Dividir', 'Llamar']],
  );
  it('`$(\'X\').item` toma el ítem emparejado de cada uno, y `first()` sigue siendo el primero', () => {
    const cuerpos: J[] = [];
    crearMundo({ flujo: dividir(), dobles: { Llamar: (l) => { cuerpos.push(l.cuerpo as J); return {}; } }, ahoraMs: AHORA }).turno({});
    expect(cuerpos).toEqual([{ propio: 1, primero: 1, todos: 2 }, { propio: 2, primero: 1, todos: 2 }]);
  });
  it('NIEGA: sin emparejamiento posible (varios ítems y un ancestro que no es de su linaje) lanza, no adivina', () => {
    const f = flujo(
      [entrada(), code('Dos', 'return [{ json: { n: 1 } }, { json: { n: 2 } }];', 200), code('Otro', 'return [{ json: { m: 1 } }, { json: { m: 2 } }];', 200, -300),
        http('Llamar', "={{ JSON.stringify({ x: $('Otro').item.json.m }) }}", 400)],
      [['Entrada', 'Dos'], ['Dos', 'Llamar'], ['Entrada', 'Otro']],
    );
    expect(() => crearMundo({ flujo: f, dobles: { Llamar: {} }, ahoraMs: AHORA }).turno({})).toThrow(/sin ítem emparejado con «Otro»/);
    // Un nodo que no corrió tampoco se inventa.
    const g = flujo([entrada(), http('Llamar', "={{ JSON.stringify({ x: $('Nunca').item.json.m }) }}", 200)], [['Entrada', 'Llamar']]);
    expect(() => crearMundo({ flujo: g, dobles: { Llamar: {} }, ahoraMs: AHORA }).turno({})).toThrow(/«Nunca» no se ejecutó/);
  });
  it('`$(\'X\').isExecuted` distingue lo que corrió de lo que no', () => {
    const f = flujo([entrada(), code('Lee', "return [{ json: { corrio: $('Entrada').isExecuted, nunca: $('Fantasma').isExecuted } }];", 200)], [['Entrada', 'Lee']]);
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({}).porNodo['Lee']).toEqual([{ corrio: true, nunca: false }]);
  });

  it('un nodo desactivado deja pasar su entrada por la salida 0', () => {
    const f = flujo([entrada(), code('Cambia', 'return [{ json: { cambiado: true } }];', 200), code('Fin', 'return [{ json: $input.first().json }];', 400)], [['Entrada', 'Cambia'], ['Cambia', 'Fin']]);
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ x: 1 }).porNodo['Fin']).toEqual([{ cambiado: true }]);
    expect(crearMundo({ flujo: f, ahoraMs: AHORA, desactivados: ['Cambia'] }).turno({ x: 1 }).porNodo['Fin']).toEqual([{ x: 1 }]);
    (f.nodes[1] as J)['disabled'] = true;
    expect(crearMundo({ flujo: f, ahoraMs: AHORA }).turno({ x: 1 }).porNodo['Fin']).toEqual([{ x: 1 }]);
  });
  it('un nodo sin ítems de salida corta su rama, salvo con `alwaysOutputData`', () => {
    const vacio = (extra: J): Flujo => flujo([entrada(), code('Nada', 'return [];', 200, 0, extra), code('Fin', 'return [{ json: { llego: true } }];', 400)], [['Entrada', 'Nada'], ['Nada', 'Fin']]);
    expect(crearMundo({ flujo: vacio({}), ahoraMs: AHORA }).turno({}).ejecutados.has('Fin')).toBe(false);
    expect(crearMundo({ flujo: vacio({ alwaysOutputData: true }), ahoraMs: AHORA }).turno({}).porNodo['Fin']).toEqual([{ llego: true }]);
  });
  it('`executeOnce` corre el nodo solo con el primer ítem', () => {
    const f = flujo([entrada(), code('Dos', 'return [{ json: { n: 1 } }, { json: { n: 2 } }];', 200), http('Una vez', '={{ JSON.stringify({}) }}', 400, 0, { executeOnce: true })], [['Entrada', 'Dos'], ['Dos', 'Una vez']]);
    let veces = 0;
    crearMundo({ flujo: f, dobles: { 'Una vez': () => { veces++; return {}; } }, ahoraMs: AHORA }).turno({});
    expect(veces).toBe(1);
  });
});

// ================================================================================================
describe('n8n de mentira: el propio arnés', () => {
  it('no crea ningún `new Function` ni `eval`: todo el código corre por `ejecutar` de ./lib/flujo', () => {
    const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lib/n8n-de-mentira.ts'), 'utf8');
    const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(sinComentarios).not.toMatch(/new\s+Function\s*\(/);
    expect(sinComentarios).not.toMatch(/\beval\s*\(/);
    // NIEGA: el detector sí reconoce lo que busca.
    expect('const f = new Function("x");').toMatch(/new\s+Function\s*\(/);
  });
  it('una expresión sin cerrar da un error claro', () => {
    const f = flujo([entrada(), http('Llamar', '={{ JSON.stringify({ a: 1 }) ', 200)], [['Entrada', 'Llamar']]);
    expect(() => crearMundo({ flujo: f, dobles: { Llamar: {} }, ahoraMs: AHORA }).turno({})).toThrow(/Llamar|sin cerrar/);
  });
  it('los números de teléfono de las pruebas son sintéticos (seis ceros)', () => {
    expect(TEL).toMatch(/000000/);
  });
});
