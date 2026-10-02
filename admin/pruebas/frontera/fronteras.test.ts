/**
 * =============================================================================
 * LA FRONTERA DE ZONAS (F2, PR 2) — prueba pura, sin emulador
 * =============================================================================
 *
 * `Analisis/41` §1 y §8.2, y CLAUDE.md («Dependencias hacia abajo, nunca hacia
 * arriba»): lee los `import` de cada archivo con zona y falla si una zona
 * importa hacia arriba (registro < core < central < plataforma < módulo <
 * coordinador < tenants) o si un módulo importa a otro que no declara en
 * `dependeDe`. Sin esta prueba en verde no se fusiona nada de F2 en adelante.
 *
 * La regla vive en `frontera.ts` (carpeta = zona; `ZONA_POR_ARCHIVO` para lo
 * que no sale de la carpeta y `SE_PARTE` para lo que F3 separa). Las dos y la
 * deuda viven en `admin/pruebas/frontera/`, fuera de la zona de todo agente:
 * solo la coordinadora los cambia (revisión de seguridad del PR #231).
 *
 * LA DEUDA CONOCIDA. El código de hoy ya tiene cruces: el plano los esperaba
 * (el coordinador de turno de F3 existe para deshacer los de `ingesta.ts`).
 * Están abajo, uno por uno, con lo que los saca. La lista solo se ACHICA:
 *   - un cruce que no está en la lista falla (es nuevo);
 *   - una entrada cuyo cruce ya no existe falla (se arregló o se movió el
 *     archivo: se saca la entrada, o se corrige su ruta si solo se movió).
 * Lo mismo con los archivos sin zona fuera de las pruebas: una lista EXACTA,
 * que cada tanda de F2 achica en el mismo PR que mueve los archivos.
 *
 * Y la regla se prueba NEGANDO, con un árbol inventado: sin esa parte, un
 * lector de imports que no ve nada daría verde para siempre.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname as carpetaDe, join } from 'node:path';
import { fileURLToPath as rutaDe } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { IDS_MODULOS, REGISTRO } from '../../functions/src/registro.ts';
import {
  CALCULADO, FUNCTION_DEL_COORDINADOR, INDICE_DE_FUNCTIONS, MOTIVO_INDICE, MOTIVO_PRUEBA, RAIZ, SE_PARTE, ZONA_POR_ARCHIVO,
  analizar, claveDeCruce, esPrueba, fuenteDeFunction, importsDe, leerDeuda, listarRaices, motivoDeCruce, zonaDeCodigo,
  zonaPorCarpeta, type Arbol,
} from './frontera.ts';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const RAIZ_FRONTERA = carpetaDe(rutaDe(import.meta.url));
const F = 'admin/functions/src/';
const W = 'admin/web/src/';

// ------------------------------------------------------------------ la deuda
/**
 * Las listas viven en `deuda.json` (esta carpeta), con su porqué en cada
 * entrada; el CI compara cada una con la de la base del PR y falla si crece.
 *   - `cruces`: los cruces que existían el 26/09/2026, con lo que los saca.
 *   - `sinZona`: archivos sin zona fuera de `admin/pruebas/`. Lista EXACTA, no
 *     un número, para que ubicar uno y agregar otro no se compensen.
 *   - `sinResolver`: imports que el lector no puede seguir y se aceptan, por
 *     cantidad exacta.
 */
const DEUDA = leerDeuda();
const DEUDA_CONOCIDA = DEUDA.cruces;
const SIN_ZONA = DEUDA.sinZona;
const SIN_RESOLVER_CONOCIDOS = DEUDA.sinResolver;

// ------------------------------------------------------------ el árbol real
const ARCHIVOS = listarRaices();
const REAL = analizar(ARCHIVOS);

describe('la frontera sobre el código de hoy', () => {
  it('ninguna importación hacia arriba fuera de la deuda conocida', () => {
    const conocidas = new Set(DEUDA_CONOCIDA.map(claveDeCruce));
    const nuevas = REAL.cruces.filter((c) => !conocidas.has(claveDeCruce(c)))
      .map((c) => `${claveDeCruce(c)}  (${c.motivo}${c.soloTipo ? ', solo tipo' : ''})`);
    expect(nuevas, 'Importación hacia arriba nueva: se corta (la pieza baja de zona) o se declara en dependeDe; no se agrega a la deuda').toEqual([]);
  });

  it('la deuda solo se achica: cada entrada sigue existiendo', () => {
    const vivas = new Set(REAL.cruces.map(claveDeCruce));
    const saldadas = DEUDA_CONOCIDA.map(claveDeCruce).filter((k) => !vivas.has(k));
    expect(saldadas, 'Estos cruces ya no existen: sacar la entrada (o corregir su ruta si el archivo solo se movió)').toEqual([]);
  });

  it('la deuda no tiene entradas repetidas y cada una dice qué la saca', () => {
    const claves = DEUDA_CONOCIDA.map(claveDeCruce);
    expect(new Set(claves).size).toBe(claves.length);
    for (const d of DEUDA_CONOCIDA) expect(d.porque.length, claveDeCruce(d)).toBeGreaterThan(20);
  });

  it('todo import lleva a un archivo: ni relativo roto, ni calculado, ni alias (si no, el lector no ve el cruce)', () => {
    const inesperados = REAL.sinResolver.filter((s) => !(s.desde in SIN_RESOLVER_CONOCIDOS && s.especificador === CALCULADO));
    expect(inesperados).toEqual([]);
    // Por cantidad exacta: un segundo import calculado en el mismo archivo no pasa.
    for (const [conocido, { cantidad }] of Object.entries(SIN_RESOLVER_CONOCIDOS)) {
      expect(REAL.sinResolver.filter((s) => s.desde === conocido).length, conocido).toBe(cantidad);
    }
  });

  it('una deuda «solo tipo» no se vuelve dependencia de valor en silencio', () => {
    for (const d of DEUDA_CONOCIDA.filter((x) => x.soloTipo)) {
      const real = REAL.cruces.find((c) => claveDeCruce(c) === claveDeCruce(d));
      expect(real?.soloTipo, `${claveDeCruce(d)} ya importa un valor: la entrada decía «solo tipo»`).toBe(true);
    }
  });

  it('los archivos sin zona fuera de las pruebas son exactamente los de la lista', () => {
    const sinZona = ARCHIVOS.filter((a) => !esPrueba(a) && !zonaDeCodigo(a));
    const nuevos = sinZona.filter((a) => !SIN_ZONA.includes(a));
    const ubicados = SIN_ZONA.filter((a) => !sinZona.includes(a));
    expect(nuevos, 'Archivo nuevo sin zona: va a una carpeta de zona, no a esta lista').toEqual([]);
    expect(ubicados, 'Ya tienen zona (o no existen): sacarlos de SIN_ZONA en este PR').toEqual([]);
  });

  it('una carpeta modulos/<m>/ solo existe para un módulo del registro', () => {
    const ajenos = ARCHIVOS.map((a) => zonaPorCarpeta(a)).filter((z) => z?.zona === 'modulo')
      .map((z) => z!.modulo!).filter((m) => !(IDS_MODULOS as readonly string[]).includes(m));
    expect([...new Set(ajenos)]).toEqual([]);
  });

  it('el coordinador de turno no se pierde: la Function ingesta sale de un archivo coordinador', () => {
    const fuente = fuenteDeFunction(FUNCTION_DEL_COORDINADOR);
    expect(fuente, `index.ts no reexporta la Function ${FUNCTION_DEL_COORDINADOR}`).not.toBeNull();
    expect(zonaDeCodigo(fuente!)?.zona).toBe('coordinador');
  });

  it('cada clave de ZONA_POR_ARCHIVO y de SE_PARTE existe (una clave muerta no protege nada)', () => {
    const faltan = [...Object.keys(ZONA_POR_ARCHIVO), ...Object.keys(SE_PARTE)].filter((a) => !existsSync(join(RAIZ, a)));
    expect(faltan, 'Archivo movido o borrado: corregir su ruta en frontera.ts').toEqual([]);
  });

  it('SE_PARTE nombra zonas reales, distintas de la del archivo', () => {
    const validas = new Set<string>(['core', 'central', 'plataforma', ...IDS_MODULOS.map((m) => `modulo:${m}`)]);
    for (const [archivo, partes] of Object.entries(SE_PARTE)) {
      const z = zonaPorCarpeta(archivo);
      expect(z, archivo).not.toBeNull();
      const propia = z!.zona === 'modulo' ? `modulo:${z!.modulo}` : z!.zona;
      for (const p of partes) {
        expect(validas.has(p), `${archivo}: «${p}» no es una zona`).toBe(true);
        expect(p, `${archivo} se parte hacia su propia zona`).not.toBe(propia);
      }
    }
  });

  it('index.ts solo reexporta, salvo core/opcionesGlobales.ts (si no, el coordinador esconde lógica)', () => {
    const fuente = ts.createSourceFile(INDICE_DE_FUNCTIONS, readFileSync(join(RAIZ, INDICE_DE_FUNCTIONS), 'utf8'), ts.ScriptTarget.Latest, true);
    const ajenos = importsDe(INDICE_DE_FUNCTIONS).filter((i) => !i.reexporta && i.destino !== `${F}core/opcionesGlobales.ts`)
      .map((i) => i.especificador);
    expect(ajenos, 'index.ts importa algo que no reexporta').toEqual([]);
    const sueltos = fuente.statements
      .filter((n) => !ts.isImportDeclaration(n) && !(ts.isExportDeclaration(n) && n.moduleSpecifier) && n.getText() !== 'initializeApp();')
      .map((n) => n.getText().slice(0, 60));
    expect(sueltos, 'index.ts declara algo que no es una reexportación').toEqual([]);
  });
});

// ------------------------------------------------------- la regla, negando
/**
 * Un árbol inventado: rutas en carpetas de zona que el inventario no nombra.
 * Los imports escritos dentro de estos textos no son imports de ESTE archivo:
 * el parser los ve como literales.
 */
function arbolDe(archivos: Record<string, string>): Arbol {
  return { leer: (a) => archivos[a] ?? '', existe: (a) => a in archivos };
}
const cruces = (archivos: Record<string, string>) =>
  analizar(Object.keys(archivos), zonaDeCodigo, arbolDe(archivos));
/** Igual, con index.ts en una zona baja: el coordinador real no tiene nada «arriba» que importar. */
const crucesConIndiceEnCore = (archivos: Record<string, string>) =>
  analizar(Object.keys(archivos), (a) => (a === INDICE_DE_FUNCTIONS ? { zona: 'core', destino: a } : zonaDeCodigo(a)), arbolDe(archivos));

describe('la regla de la frontera (árbol inventado)', () => {
  const CORE = `${F}core/a.ts`;
  const CENTRAL = `${F}central/b.ts`;
  const PLATAFORMA = `${F}plataforma/c.ts`;

  it('Core no importa de Central, y Central sí de Core', () => {
    const r = cruces({ [CORE]: "import { b } from '../central/b';", [CENTRAL]: "import { a } from '../core/a.js';" });
    expect(r.cruces.map(claveDeCruce)).toEqual([`${CORE} → ${CENTRAL}`]);
    expect(r.cruces[0].motivo).toBe('core → central');
  });

  it('Central no importa de Plataforma, ni Plataforma de un módulo', () => {
    const r = cruces({
      [CENTRAL]: "import { c } from '../plataforma/c';",
      [PLATAFORMA]: "import { x } from '../modulos/agenda/x';",
      [`${F}modulos/agenda/x.ts`]: '',
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual(['central → plataforma', 'plataforma → modulo:agenda']);
  });

  it('un módulo importa a otro solo si lo declara en dependeDe (también indirecto)', () => {
    const conDependencia = REGISTRO.find((m) => m.dependeDe.length > 0)!;
    const declarado = conDependencia.dependeDe[0];
    const sinDependencia = REGISTRO.find((m) => m.modulo !== conDependencia.modulo
      && !m.dependeDe.includes(conDependencia.modulo) && !conDependencia.dependeDe.includes(m.modulo)
      && m.dependeDe.length === 0)!;
    const desde = `${F}modulos/${conDependencia.modulo}/a.ts`;
    const r = cruces({
      [desde]: `import { b } from '../${declarado}/b';\nimport { c } from '../${sinDependencia.modulo}/c';`,
      [`${F}modulos/${declarado}/b.ts`]: '',
      [`${F}modulos/${sinDependencia.modulo}/c.ts`]: '',
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual([`módulo sin dependeDe (${conDependencia.modulo} → ${sinDependencia.modulo})`]);
    // Indirecto: catalogo-web → pedidos → productos.
    expect(motivoDeCruce({ zona: 'modulo', modulo: 'catalogo-web', destino: '' }, { zona: 'modulo', modulo: 'productos', destino: '' })).toBeNull();
    // Catálogo web → inventario está declarada; inventario → catálogo web, no.
    expect(motivoDeCruce({ zona: 'modulo', modulo: 'catalogo-web', destino: '' }, { zona: 'modulo', modulo: 'inventario', destino: '' })).toBeNull();
    expect(motivoDeCruce({ zona: 'modulo', modulo: 'inventario', destino: '' }, { zona: 'modulo', modulo: 'catalogo-web', destino: '' }))
      .toMatch(/módulo sin dependeDe \(inventario → catalogo-web\)/);
    expect(motivoDeCruce({ zona: 'modulo', modulo: 'catalogo-web', destino: '' }, { zona: 'modulo', modulo: 'campanas', destino: '' }))
      .toMatch(/módulo sin dependeDe/);
    // Y al revés, no: que A dependa de B no deja a B importar de A.
    expect(motivoDeCruce({ zona: 'modulo', modulo: declarado, destino: '' }, { zona: 'modulo', modulo: conDependencia.modulo, destino: '' }))
      .toMatch(/módulo sin dependeDe/);
  });

  it('todo el mundo lee el registro, y el registro no importa a nadie', () => {
    const r = cruces({
      [CORE]: "import { REGISTRO } from '../registro';",
      [`${F}registro.ts`]: "import { a } from './core/a';",
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual(['registro → core']);
  });

  it('los tenants no son de nadie: ninguna zona importa de scripts/datos/', () => {
    const r = cruces({
      'admin/scripts/plataforma/alta.mjs': "import { d } from '../datos/bellido.mjs';",
      'admin/scripts/datos/bellido.mjs': "import { c } from '../plataforma/alta.mjs';",
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual(['plataforma → tenants']);
  });

  it('ve todas las formas de importar: tipo, varias líneas, reexportación, dinámico y require', () => {
    const r = cruces({
      [CORE]: [
        "import type { T } from '../central/b';",
        "import {\n  x,\n  y,\n} from '../central/c';",
        "export * from '../central/d';",
        "const m = await import('../central/e');",
        "const n = require('../central/f');",
        "import '../central/g';",
        "import{h}from'../central/h'",
        "import i = require('../central/i');",
        "let j: import('../central/j').J;",
        'const k = await import(`../central/k`);',
      ].join('\n'),
      ...Object.fromEntries(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].map((n) => [`${F}central/${n}.ts`, ''])),
    });
    // En el orden del texto: el parser recorre el archivo de arriba abajo.
    expect(r.cruces.map((c) => c.hacia.slice(-4))).toEqual(['b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts', 'h.ts', 'i.ts', 'j.ts', 'k.ts']);
    expect(r.cruces.filter((c) => c.soloTipo).map((c) => c.hacia.slice(-4))).toEqual(['b.ts', 'j.ts']);
  });

  it('ve require por createRequire, require.resolve y module.require (los paquetes de npm no cuentan)', () => {
    const r = cruces({
      [CORE]: [
        "import { createRequire } from 'node:module';",
        'const desdeWeb = createRequire(import.meta.url);',
        "const react = desdeWeb('react');",
        "const b = desdeWeb('../central/b');",
        "const c = require.resolve('../central/c');",
        "const d = module.require('../central/d');",
      ].join('\n'),
      [`${F}central/b.ts`]: '', [`${F}central/c.ts`]: '', [`${F}central/d.ts`]: '',
    });
    expect(r.cruces.map((c) => c.hacia.slice(-4))).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  it('los require que no se pueden seguir se informan como calculados', () => {
    const casos = [
      "import { createRequire as cr } from 'node:module';\nconst r = cr(import.meta.url);\nr('../central/a');",
      "import * as m from 'node:module';\nconst r = m.createRequire(import.meta.url);\nr('../central/a');",
      "import { createRequire } from 'node:module';\nlet r;\nr = createRequire(import.meta.url);\nr('../central/a');",
      "const q = require;\nq('../central/a');",
      "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('../central/a');",
      // Sondas de la tercera vuelta de seguridad del #236.
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nfunction f(r) { return r; }\nconst q = r;\nq('../central/a');",
      "const q = (require);\nq('../central/a');",
      "const q = require as any;\nq('../central/a');",
      "const q = c ? require : null;",
      "const q = require || null;",
      "require.call(null, '../central/a');",
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr.apply(null, ['../central/a']);",
      "const q = require.bind(null);",
      "(0, require)('../central/a');",
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr.call(null, '../central/a');",
      // Sondas de la cuarta vuelta de seguridad del #236.
      "import m from 'node:module';\nconst r = m.createRequire(import.meta.url);\nr('../central/a');",
      "import { Module } from 'node:module';\nconst r = Module.createRequire(import.meta.url);\nr('../central/a');",
      "const r = process.getBuiltinModule('node:module').createRequire(import.meta.url);\nr('../central/a');",
      "const { createRequire: cr } = await import('node:module');\ncr(import.meta.url)('../central/a');",
      "const q = (globalThis as any).require;\nq('../central/a');",
      "module['require']('../central/a');",
    ];
    for (const texto of casos) {
      const r = cruces({ [CORE]: texto, [`${F}central/a.ts`]: '' });
      expect(r.sinResolver.map((x) => x.especificador), texto).toContain(CALCULADO);
    }
    // Un alias llamado `require` y un `require` con `declare` son el require real: se siguen.
    for (const texto of [
      "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nrequire('../central/a');",
      "declare const require: any;\nrequire('../central/a');",
      "declare function require(x: string): any;\nrequire('../central/a');",
    ]) {
      expect(cruces({ [CORE]: texto, [`${F}central/a.ts`]: '' }).cruces.map((c) => c.hacia), texto).toEqual([`${F}central/a.ts`]);
    }
    // El patrón reconocido no se informa: se sigue.
    const bien = cruces({
      [CORE]: "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nconst a = r('../central/a');\nconst b = (require)('../central/b');\nconst c = require?.('../central/c');\nif (typeof require === 'undefined') {}",
      [`${F}central/b.ts`]: '', [`${F}central/c.ts`]: '',
      [`${F}central/a.ts`]: '',
    });
    expect(bien.sinResolver).toEqual([]);
    expect(bien.cruces.map((c) => c.hacia)).toEqual([`${F}central/a.ts`, `${F}central/b.ts`, `${F}central/c.ts`]);
  });

  it('un nombre igual a require o a su alias que no es un require no se informa', () => {
    const falsos = [
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nconst x = [1].map((r) => r + 1);\nfoo(r => r);",
      'interface Opc { require: boolean }',
      'class A { require() {} }',
      'class B { require = true; }',
      'const t = <input require />;',
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\ntype T = typeof r;",
      'function f(require: boolean) { return 1; }',
      "function g(require) { return require('../central/a'); }",
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nfunction h(r) { return r('../central/a'); }",
    ];
    for (const texto of falsos) {
      const archivo = texto.includes('<input') ? `${F}core/a.tsx` : CORE;
      expect(cruces({ [archivo]: texto }).sinResolver, texto).toEqual([]);
    }
  });

  it('un import comentado no cuenta; un texto con /* o con // no esconde el import que sigue', () => {
    const r = cruces({
      [CORE]: [
        "// import { b } from '../central/b';",
        "/* import { c } from '../central/c'; */",
        "const u = 'https://x.y'; import { d } from '../central/d';",
        "const accept = 'image/*';",
        "const m = await import('../central/e');",
        "/** doc */",
      ].join('\n'),
      [`${F}central/b.ts`]: '', [`${F}central/c.ts`]: '', [`${F}central/d.ts`]: '', [`${F}central/e.ts`]: '',
    });
    expect(r.cruces.map((c) => c.hacia)).toEqual([`${F}central/d.ts`, `${F}central/e.ts`]);
  });

  it('un import que no lleva a nada, calculado o por alias se informa, no se ignora', () => {
    const r = cruces({
      [CORE]: "import { b } from '../central/no-existe';\nconst m = await import(ruta);\nconst n = require(join(a, 'b'));\nimport { c } from '@/central/c';\nimport { z } from 'zod';",
    });
    expect(r.sinResolver).toEqual([
      { desde: CORE, especificador: '../central/no-existe' },
      { desde: CORE, especificador: CALCULADO },
      { desde: CORE, especificador: CALCULADO },
      { desde: CORE, especificador: '@/central/c' },
    ]);
  });

  it('un import de tipo seguido de uno de valor al mismo archivo es de valor', () => {
    const r = cruces({
      [CORE]: "import type { T } from '../central/b';\nimport { f } from '../central/b';",
      [CENTRAL]: '',
    });
    expect(r.cruces.map((c) => c.soloTipo)).toEqual([false]);
  });

  it('lo que un puente no deja seguir también se informa', () => {
    const r = cruces({
      [CORE]: "import { s } from '../suelto';",
      [`${F}suelto.ts`]: "const m = await import(ruta);\nimport { c } from '@/central/c';\nimport { d } from './roto';",
    });
    expect(r.sinResolver).toEqual([
      { desde: `${F}suelto.ts`, especificador: CALCULADO },
      { desde: `${F}suelto.ts`, especificador: '@/central/c' },
      { desde: `${F}suelto.ts`, especificador: './roto' },
    ]);
  });

  it('un cruce no se lava por un archivo sin zona (tampoco por dos)', () => {
    const r = cruces({
      [CORE]: "import { s } from '../suelto';",
      [`${F}suelto.ts`]: "import { t } from './otro-suelto';",
      [`${F}otro-suelto.ts`]: "import { b } from './central/b';",
      [CENTRAL]: '',
    });
    expect(r.cruces.map((c) => [claveDeCruce(c), c.motivo])).toEqual([[
      `${CORE} → ${CENTRAL}`, `core → central, vía ${F}suelto.ts → ${F}otro-suelto.ts`,
    ]]);
  });

  it('una prueba no lava un cruce por un ayudante de prueba', () => {
    const r = cruces({
      'admin/pruebas/core/p.test.ts': "import { ayuda } from '../lib/ayuda';",
      'admin/pruebas/lib/ayuda.ts': "import { c } from '../../functions/src/plataforma/c';",
      [PLATAFORMA]: '',
    });
    expect(r.cruces.map(claveDeCruce)).toEqual([`admin/pruebas/core/p.test.ts → ${PLATAFORMA}`]);
  });

  it('el código no importa index.ts (sería un atajo a cualquier zona) ni una prueba', () => {
    const r = cruces({
      [`${F}modulos/agenda/a.ts`]: "import { c } from '../../index';\nimport { d } from '../../../../pruebas/dobles/d';",
      [INDICE_DE_FUNCTIONS]: "export { c } from './modulos/campanas/c';",
      [`${F}modulos/campanas/c.ts`]: '',
      'admin/pruebas/dobles/d.ts': '',
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual([MOTIVO_INDICE, MOTIVO_PRUEBA]);
  });

  it('en index.ts, un export sin punto y coma no convierte al import siguiente en reexportación', () => {
    const r = crucesConIndiceEnCore({
      [INDICE_DE_FUNCTIONS]: "export const v = 1\nimport { y } from './modulos/agenda/y';",
      [`${F}modulos/agenda/y.ts`]: '',
    });
    expect(r.cruces.map((c) => c.hacia)).toEqual([`${F}modulos/agenda/y.ts`]);
  });

  // La fuente se deriva del propio especificador (`../functions/lib/<ruta>.js`
  // → `admin/functions/src/<ruta>.ts`) y no de una ruta fija: F2 mueve esos
  // archivos (tanda 5), la mudanza reescribe el especificador, y una ruta
  // armada con plantilla no la reescribe (revisión de seguridad del #250).
  it('los scripts que importan las Functions compiladas dependen de su fuente', () => {
    const compilados = importsDe(join('admin/scripts/plataforma/migrar-prepago.mjs')).filter((i) => i.especificador.startsWith('../../functions/lib/'));
    expect(compilados.map((i) => i.especificador.replace(/^\.\.\/\.\.\/functions\/lib\/(.+)\.js$/, '$1').split('/').pop()))
      .toEqual(expect.arrayContaining(['prepago', 'planes']));
    for (const i of compilados) {
      expect(i.destino, i.especificador).toBe(`${F}${i.especificador.replace(/^\.\.\/\.\.\/functions\/lib\/(.+)\.js$/, '$1')}.ts`);
    }
  });

  it('index.ts: sus reexportaciones no cuentan; un import suyo sí', () => {
    const r = crucesConIndiceEnCore({
      [INDICE_DE_FUNCTIONS]: "export { x } from './modulos/agenda/x';\nimport { y } from './modulos/agenda/y';",
      [`${F}modulos/agenda/x.ts`]: '', [`${F}modulos/agenda/y.ts`]: '',
    });
    // index.ts es coordinador, y un coordinador sí importa módulos: para ver que el
    // import de index.ts cuenta y la reexportación no, se le pone zona core.
    expect(r.cruces.map((c) => c.hacia)).toEqual([`${F}modulos/agenda/y.ts`]);
  });

  it('una prueba en carpeta de zona sigue la misma regla, salvo llamar a index.ts', () => {
    const r = cruces({
      'admin/pruebas/core/p.test.ts': "import { b } from '../../functions/src/central/b';\nimport * as f from '../../functions/src/index';",
      'admin/pruebas/central/q.test.ts': "import { a } from '../../functions/src/core/a';",
      [CENTRAL]: '', [CORE]: '', [INDICE_DE_FUNCTIONS]: '',
    });
    expect(r.cruces.map(claveDeCruce)).toEqual([`admin/pruebas/core/p.test.ts → ${CENTRAL}`]);
  });

  it('un coordinador de turno mudado a core/turno/ sin línea en ZONA_POR_ARCHIVO pasa a core, y la prueba lo ve', () => {
    const arbol = arbolDe({
      [INDICE_DE_FUNCTIONS]: "export { ingesta } from './core/turno/ingesta.js';",
      [`${F}core/turno/ingesta.ts`]: '',
    });
    const fuente = fuenteDeFunction('ingesta', arbol);
    expect(fuente).toBe(`${F}core/turno/ingesta.ts`);
    expect(zonaDeCodigo(fuente!)?.zona).toBe('core');
  });

  it('fuenteDeFunction: un index.ts que no reexporta la Function devuelve null', () => {
    expect(fuenteDeFunction('ingesta', arbolDe({ [INDICE_DE_FUNCTIONS]: '' }))).toBeNull();
    expect(fuenteDeFunction('ingesta', arbolDe({ [INDICE_DE_FUNCTIONS]: "export { otra } from './otra.js';", [`${F}otra.ts`]: '' }))).toBeNull();
  });

  it('la zona sale de la carpeta', () => {
    expect(zonaPorCarpeta(`${W}modulos/agenda/Agenda.tsx`)).toMatchObject({ zona: 'modulo', modulo: 'agenda' });
    expect(zonaPorCarpeta('Flujos/src/core/medios/a.js')).toMatchObject({ zona: 'core' });
    expect(zonaPorCarpeta('admin/scripts/plataforma/alta.mjs')).toMatchObject({ zona: 'plataforma' });
    expect(zonaPorCarpeta('admin/scripts/datos/x.mjs')).toMatchObject({ zona: 'tenants' });
    expect(zonaPorCarpeta(`${F}registro.ts`)).toMatchObject({ zona: 'registro' });
    expect(zonaPorCarpeta(`${F}ingesta.ts`)).toMatchObject({ zona: 'coordinador' });
    expect(zonaPorCarpeta(INDICE_DE_FUNCTIONS)).toMatchObject({ zona: 'coordinador' });
    expect(zonaPorCarpeta('admin/scripts/ensamblar-flujo.mjs')).toMatchObject({ zona: 'core' });
    // SE_PARTE anota, no cambia la zona.
    expect(zonaDeCodigo(`${F}modulos/catalogo-web/catalogoWeb.ts`)).toMatchObject({ zona: 'modulo', modulo: 'catalogo-web', seParte: expect.arrayContaining(['modulo:pedidos']) });
    expect(zonaDeCodigo(`${F}ingesta.ts`)?.seParte).toEqual(expect.arrayContaining(['modulo:agenda']));
    // Un archivo suelto en la raíz, o una carpeta que no es de zona, no tiene zona por carpeta.
    expect(zonaPorCarpeta(`${F}suelto.ts`)).toBeNull();
    expect(zonaPorCarpeta(`${W}componentes/Marca.tsx`)).toBeNull();
    expect(zonaPorCarpeta(`${F}modulos/suelto.ts`)).toBeNull();
  });
});

// ------------------------------------------- la deuda no crece (CI, en un PR)
describe('deuda-solo-baja.mjs: el paso de CI que compara la deuda con la base', async () => {
  const { comparar, leerMovidos } = await import('./deuda-solo-baja.mjs');
  const base = leerDeuda();

  it('la deuda de hoy contra sí misma no crece', () => {
    expect(comparar(base, base).crecen).toEqual([]);
  });

  it('un cruce anotado de más falla, aunque la prueba de fronteras quede en verde', () => {
    const pr = { ...base, cruces: [...base.cruces, { desde: `${F}core/a.ts`, hacia: `${F}central/b.ts`, porque: 'para que pase' }] };
    expect(comparar(base, pr).crecen).toEqual([`cruces: ${base.cruces.length} → ${base.cruces.length + 1}`]);
  });

  it('un archivo sin zona de más, un import calculado de más o una transversal de más fallan', () => {
    const r = comparar(base, {
      ...base,
      sinZona: [...base.sinZona, `${W}lib/nuevo.ts`],
      sinResolver: { ...base.sinResolver, 'admin/scripts/otro.mjs': { cantidad: 1, porque: 'x' } },
      transversales: [...base.transversales, 'admin/pruebas/core/otra.test.ts'],
    });
    expect(r.crecen.map((c) => c.split(':')[0])).toEqual(['sinZona', 'sinResolver', 'transversales']);
  });

  it('mover un archivo (misma cantidad, otra ruta) pasa si git lo muestra como renombre', () => {
    const viejo = base.cruces[0].desde;
    const nuevo = `${F}modulos/catalogo-web/catalogoWeb.ts`;
    const pr = { ...base, cruces: base.cruces.map((c, i) => (i === 0 ? { ...c, desde: nuevo } : c)) };
    const movidos = leerMovidos(`M\tadmin/functions/src/index.ts\nR097\t${viejo}\t${nuevo}\n`);
    const r = comparar(base, pr, movidos);
    expect(r.crecen).toEqual([]);
    expect(r.inexplicadas).toEqual([]);
    expect(r.nuevas).toEqual([`cruce ${nuevo} → ${base.cruces[0].hacia}`]);
    // Sin el renombre, la misma entrada no se explica.
    expect(comparar(base, pr).inexplicadas).toHaveLength(1);
  });

  it('saldar un cruce y anotar otro (misma cantidad) no pasa: canjear deuda no vale', () => {
    const pr = { ...base, cruces: [...base.cruces.slice(1), { desde: `${F}core/x.ts`, hacia: `${F}modulos/agenda/y.ts`, porque: 'canje' }] };
    const r = comparar(base, pr);
    expect(r.crecen).toEqual([]);
    expect(r.inexplicadas).toEqual([`cruce ${F}core/x.ts → ${F}modulos/agenda/y.ts`]);
  });

  it('ubicar un archivo y dejar otro nuevo sin zona, o cambiar una transversal, no pasa', () => {
    // La base lleva una entrada propia: la deuda real puede quedar sin ninguna.
    const conUna = { ...base, sinZona: [`${W}lib/viejo.ts`] };
    const r = comparar(conUna, {
      ...conUna,
      sinZona: [`${W}lib/nuevo.ts`],
      transversales: ['admin/pruebas/core/otra.test.ts'],
    });
    expect(r.crecen).toEqual([]);
    expect(r.inexplicadas).toEqual([`sin zona ${W}lib/nuevo.ts`, 'transversal admin/pruebas/core/otra.test.ts']);
  });

  it('invocado por un enlace simbólico, el comparador compara igual (no termina en 0 sin hacer nada)', async () => {
    const { mkdtempSync, symlinkSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { spawnSync } = await import('node:child_process');
    const { join: unir } = await import('node:path');
    const dir = mkdtempSync(unir(tmpdir(), 'deuda-'));
    try {
      symlinkSync(unir(RAIZ_FRONTERA), unir(dir, 'enlace'));
      const crece = { ...base, cruces: [...base.cruces, { desde: `${F}core/a.ts`, hacia: `${F}central/b.ts`, porque: 'x' }] };
      writeFileSync(unir(dir, 'base.json'), JSON.stringify(base));
      writeFileSync(unir(dir, 'pr.json'), JSON.stringify(crece));
      const r = spawnSync(process.execPath, [unir(dir, 'enlace', 'deuda-solo-baja.mjs'), unir(dir, 'base.json'), unir(dir, 'pr.json')], { env: entornoDelEmulador(undefined), encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('::error::La deuda de la frontera crece');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('achicar la deuda pasa', () => {
    expect(comparar(base, { ...base, cruces: base.cruces.slice(1), sinZona: base.sinZona.slice(1) }).crecen).toEqual([]);
  });
});
