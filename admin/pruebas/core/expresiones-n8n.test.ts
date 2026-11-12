/**
 * GUARDIA PERMANENTE: EL SANDBOX DE EXPRESIONES DE n8n 2.36.5 (07/11/2026).
 *
 * Causa: dos imágenes de clientes de Q'Taco no dejaron ninguna ejecución. La expresión del IF «¿Es comprobante?» usaba
 * `Object.prototype.hasOwnProperty` y n8n la rechazó («Cannot access "prototype" due to security concerns»): la ejecución murió sin registro.
 *
 * Qué protege, NEGANDO primero:
 *   - NINGÚN JSON de flujo versionado en `Flujos/` (todas las salidas de `Flujos/experimental/*`, sus plantillas y los flujos de la raíz) tiene, dentro
 *     de una expresión (`={{ … }}`), una construcción que ese sandbox rechaza: `prototype`, `__proto__`, `constructor`, `Function(`, `eval(`,
 *     `globalThis`/`global`/`process`/`require`/`module`/`exports`/`Buffer`, `import(`, `this.`, `structuredClone(`/`fetch(`/temporizadores;
 *   - las reglas reconocen cada construcción en una COPIA de un flujo real, y no se disparan con la palabra dentro de un texto entre comillas ni en el
 *     `jsCode` de un nodo Code (otro sandbox);
 *   - TODOS los armadores de `Flujos/experimental/*` aplican la guardia en su `--verificar` (y `venta-minima` falla con una copia contaminada);
 *   - el n8n de mentira de la suite rechaza esas expresiones como n8n, así una prueba de punta a punta no las deja pasar en silencio.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hallazgosDeExpresiones, REGLAS_DE_EXPRESION } from '../../../Flujos/experimental/comun-sin-agente/src/expresiones.mjs';
import { crearMundo } from '../lib/n8n-de-mentira';
import type { Flujo, J } from '../lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../..');
const versionados = (patron: string): string[] =>
  execFileSync('git', ['ls-files', patron], { cwd: RAIZ, encoding: 'utf8' }).split('\n').filter(Boolean);
const flujos = versionados('Flujos/*.json')
  .map((ruta) => { try { return { ruta, flujo: JSON.parse(readFileSync(join(RAIZ, ruta), 'utf8')) as Flujo }; } catch { return null; } })
  .filter((x): x is { ruta: string; flujo: Flujo } => !!x && Array.isArray(x.flujo.nodes));
const QTACO = JSON.parse(readFileSync(join(RAIZ, 'Flujos/experimental/venta-minima/venta-minima.qtaco.json'), 'utf8')) as Flujo;
const copia = (): Flujo => JSON.parse(JSON.stringify(QTACO)) as Flujo;
const flujoCon = (expresion: string): Flujo => ({
  name: 'x', settings: { executionOrder: 'v1' }, connections: { Inicio: { main: [[{ node: 'Usar', type: 'main', index: 0 }]] } },
  nodes: [
    { id: '1', name: 'Inicio', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: '2', name: 'Usar', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [200, 0], parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [{ id: 'a', name: 'v', type: 'string', value: expresion }] }, options: {} } },
  ],
} as unknown as Flujo);
const condicionDe = (f: Flujo): J => ((f.nodes.find((n) => n.name === '¿Es comprobante?')!.parameters as J)['conditions']['conditions'][0]) as J;

describe('ningún flujo versionado tiene una expresión que el sandbox de n8n rechaza', () => {
  it('se revisan los flujos de verdad (no una lista vacía)', () => {
    expect(flujos.length).toBeGreaterThan(30);
    expect(flujos.some((x) => x.ruta.startsWith('Flujos/experimental/venta-minima/'))).toBe(true);
    expect(flujos.some((x) => x.ruta.startsWith('Flujos/experimental/rroca-ruben/'))).toBe(true);
  });
  for (const { ruta, flujo } of flujos) {
    it(ruta, () => {
      expect(hallazgosDeExpresiones(flujo).map((h) => `${h.nodo} (${h.ruta}): ${h.texto}`)).toEqual([]);
    });
  }
});

describe('NEGANDO: las reglas reconocen cada construcción en una copia de un flujo real', () => {
  const CASOS: [string, string][] = [
    ['prototype', "Object.prototype.hasOwnProperty.call(a.titulares, k)"],
    ['prototype', 'a.__proto__'],
    ['prototype', 'x.constructor.name'],
    ['eval', "Function('return 1')()"],
    ['eval', "eval('1')"],
    ['global', 'globalThis.x'],
    ['global', 'process.env.X'],
    ['global', "require('fs')"],
    ['import', "import('fs')"],
    ['this', 'this.helpers'],
    ['structuredClone', 'structuredClone(a)'],
    // Revisión del PR (07/11/2026): entre comillas, getPrototypeOf.
    ['prototype', '$json["constructor"]'],
    ['prototype', "o['__proto__']"],
    ['prototype', 'Object.getPrototypeOf(a)'],
  ];
  for (const [regla, trozo] of CASOS) {
    it(`${regla}: «${trozo}»`, () => {
      const f = copia();
      const c = condicionDe(f);
      c['leftValue'] = String(c['leftValue']).replace('return true; let o = null;', `return true; const zz = ${trozo}; let o = null;`);
      expect(String(c['leftValue'])).toContain(trozo);
      const h = hallazgosDeExpresiones(f);
      expect(h.map((x) => x.regla)).toContain(regla);
      expect(h.every((x) => x.nodo === '¿Es comprobante?')).toBe(true);
    });
  }
  it('las palabras dentro de un texto entre comillas no cuentan; el jsCode de un nodo Code (otro sandbox) tampoco', () => {
    const f = copia();
    const c = condicionDe(f);
    c['leftValue'] = String(c['leftValue']).replace('return true; let o = null;', "return true; const zz = $getWorkflowStaticData('global') && 'this.prototype' && \"constructor\"; let o = null;");
    expect(hallazgosDeExpresiones(f)).toEqual([]);
    const code = f.nodes.find((n) => n.name === 'Decidir turno')!;
    (code.parameters as J)['jsCode'] = String((code.parameters as J)['jsCode']) + '\nconst x = Object.prototype.hasOwnProperty;';
    expect(hallazgosDeExpresiones(f)).toEqual([]);
  });
  it('revisa el código de CADA bloque `{{ … }}` (un `}}` dentro del código no lo corta); no marca una clave de objeto literal ni una propiedad del dato', () => {
    const uno = (texto: string) => hallazgosDeExpresiones({ nodes: [{ name: 'X', parameters: { v: texto } }] });
    expect(uno('={{ JSON.stringify({ a: { b: 1 }}) }} y {{ Object.prototype.toString.call(1) }}')).toHaveLength(1);
    expect(uno('={{ JSON.stringify({ a: { b: 1 }}) + String(Object.getPrototypeOf({})) }}')).toHaveLength(1);
    expect(uno('={{ JSON.stringify({ constructor: 1, x: 2 }) }}')).toEqual([]);
    expect(uno('={{ $json.process + $json.module + $json.global }}')).toEqual([]);
    expect(uno('={{ process.env.X }}')).toHaveLength(1);
    expect(uno('={{ $json.constructor }}')).toHaveLength(1); // como propiedad del dato, n8n también la rechaza
  });
  it('revisión de #848: lo interpolado en `${…}` de una plantilla SÍ se revisa; solo el código de los bloques cuenta (la prosa de fuera ni marca ni esconde); una regex con comilla no confunde', () => {
    const uno = (texto: string) => hallazgosDeExpresiones({ nodes: [{ name: 'X', parameters: { v: texto } }] });
    expect(uno('={{ `${Object.prototype.toString.call(1)}` }}')).toHaveLength(1);
    expect(uno('={{ `x ${process.env.X}` }}')).toHaveLength(1);
    expect(uno('={{ `texto con constructor y process` }}')).toEqual([]);
    // Un apóstrofo de la prosa («Q'Taco», «cliente's») no esconde el código del bloque.
    expect(uno('=Hola desde Q\'Taco {{ Object.prototype.hasOwnProperty.call($json, "a") }} y el cliente\'s')).toHaveLength(1);
    // La prosa fuera de los bloques no cuenta.
    expect(uno('=Usa el modulo global para el proceso {{ $json.a }}')).toEqual([]);
    expect(uno('={{ "a".replace(/["]/g, "") }} y luego constructor')).toEqual([]);
    expect(uno('={{ "a".replace(/["]/g, "") + Object.prototype.x }}')).toHaveLength(1);
  });
  it('el n8n de mentira y la guardia usan la MISMA función con el MISMO alcance: la prosa de fuera no hace fallar la expresión; el código de dentro sí', () => {
    const correr = (expresion: string) => crearMundo({ flujo: flujoCon(expresion), dobles: {}, ahoraMs: Date.UTC(2026, 10, 7, 12) }).turno({ a: 1 }, {});
    expect(() => correr('=Usa el modulo global para el proceso {{ $json.a }}')).not.toThrow();
    expect(() => correr('=Hola desde Q\'Taco {{ Object.prototype.hasOwnProperty.call($json, "a") }}')).toThrow(/Cannot access "prototype" due to security concerns/);
  });
  it('un texto que no empieza con «=» no es una expresión', () => {
    expect(hallazgosDeExpresiones({ nodes: [{ name: 'X', parameters: { text: 'Object.prototype {{ a.constructor }}' } }] })).toEqual([]);
    expect(hallazgosDeExpresiones({ nodes: [{ name: 'X', parameters: { text: '={{ a.constructor }}' } }] })).toHaveLength(1);
  });
  it('las reglas son las declaradas (si se agrega una, se agrega su caso aquí)', () => {
    expect(REGLAS_DE_EXPRESION.map((r) => r.regla).sort()).toEqual(['eval', 'global', 'import', 'prototype', 'structuredClone', 'this']);
  });
});

describe('todos los armadores de Flujos/experimental y Flujos/clientes aplican la guardia en su --verificar', () => {
  // Migración (etapa 0): un flujo puede vivir en una carpeta o en la otra (la mudanza no cambia qué flujo es). Excepción cerrada: el armador de la
  // redirección de Q'Taco no aplica la guardia hoy (no se arregla en la etapa 0); si la aplica, la excepción sobra y la prueba lo pide.
  const SIN_GUARDIA = ['Flujos/clientes/qtaco-redireccion/construir.mjs'];
  const todos = [...versionados('Flujos/experimental/*/construir.mjs'), ...versionados('Flujos/clientes/*/construir.mjs')]
    .filter((r) => !r.startsWith('Flujos/experimental/comun-sin-agente/'));
  const armadores = todos.filter((r) => !SIN_GUARDIA.includes(r));
  const importaLaGuardia = (texto: string): boolean => /from '(\.\.\/comun-sin-agente|\.\.\/\.\.\/experimental\/comun-sin-agente)\/src\/expresiones\.mjs'/.test(texto);
  it('hay armadores que revisar (la suma de las dos carpetas)', () => expect(armadores.length).toBeGreaterThanOrEqual(12));
  it('la excepción cerrada existe y sigue sin aplicar la guardia (si la aplica, sobra)', () => {
    for (const r of SIN_GUARDIA) {
      const texto = readFileSync(join(RAIZ, r), 'utf8');
      expect(todos, r).toContain(r);
      expect(importaLaGuardia(texto) && /hallazgosDeExpresionesN8n\(flujo/.test(texto), r).toBe(false);
    }
  });
  it('contraprueba: acepta las dos formas de la importación y rechaza otra', () => {
    expect(importaLaGuardia("import { x } from '../comun-sin-agente/src/expresiones.mjs';")).toBe(true);
    expect(importaLaGuardia("import { x } from '../../experimental/comun-sin-agente/src/expresiones.mjs';")).toBe(true);
    expect(importaLaGuardia("import { x } from '../otro/src/expresiones.mjs';")).toBe(false);
  });
  for (const r of armadores) {
    it(r, () => {
      const texto = readFileSync(join(RAIZ, r), 'utf8');
      expect(importaLaGuardia(texto)).toBe(true);
      expect(texto).toMatch(/hallazgosDeExpresionesN8n\(flujo/);
    });
  }
});

describe('el n8n de mentira rechaza esas expresiones como n8n (la prueba de punta a punta no las deja pasar)', () => {

  const correr = (expresion: string) => crearMundo({ flujo: flujoCon(expresion), dobles: {}, ahoraMs: Date.UTC(2026, 10, 7, 12) }).turno({ a: 1 }, {});
  it('«Object.prototype…» → «Cannot access "prototype" due to security concerns»', () => {
    expect(() => correr("={{ Object.prototype.hasOwnProperty.call({ a: 1 }, 'a') }}")).toThrow(/Cannot access "prototype" due to security concerns/);
  });
  it('eval, process, this y globalThis también revientan; la misma idea sin prototype pasa', () => {
    for (const e of ["={{ eval('1') }}", '={{ process.env.X }}', '={{ this.x }}', '={{ globalThis.x }}']) expect(() => correr(e), e).toThrow(/sandbox de n8n|security concerns/);
    expect(() => correr("={{ Object.keys({ a: 1 }).indexOf('a') >= 0 }}")).not.toThrow();
  });
});
