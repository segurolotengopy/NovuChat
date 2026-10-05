/**
 * H2b-4e — LOS SCRIPTS OPERATIVOS LEEN EL REGISTRO, NO TIENEN SU PROPIA LISTA DE FLUJOS.
 *
 * Ocho scripts de `admin/scripts/` decidían por una lista o una tabla literal
 * de flujos (`FLUJOS_VALIDOS`, `DOCUMENTO`, `flujos.includes('venta')`…). Ahora
 * la única fuente es `functions/src/registro.ts`, que Node carga quitando los
 * tipos (no tiene `import`). Esta suite, SIN emulador y sin tocar la nube:
 *
 *   1. congela las listas de ANTES (copiadas literales del código de origin/main
 *      al 05/10/2026) y comprueba que el registro da lo mismo para los flujos
 *      de hoy y para los ocho subconjuntos de flujos, y que cierra con un
 *      flujo desconocido;
 *   2. lee los scripts y exige que importen del registro y que no les quede
 *      ninguna lista de flujos (una copia nueva fallaría acá);
 *   3. ejecuta de verdad lo que se puede ejecutar sin Firebase: la validación
 *      de `alta-comercio.mjs` y de `asignar-numero.mjs`, que corta antes de
 *      abrirlo.
 *
 * `completar-flujos.mjs` NO está acá: lo modifica el PR #421 (que le agrega
 * `onboarding` a su tabla) y se alinea con el registro después de fusionarlo.
 *
 * Los scripts que sí necesitan Firestore (`activar-cobro-real`,
 * `fijar-webhook-carrito`, `pase-a-produccion`, `cargar-*`) se ejecutan contra
 * el emulador en `scripts-con-registro-emulador.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IDS_FLUJOS, PUENTE_DE_FLUJOS, documentoDeCobro, documentoDeFlujo, esFlujo, flujosDeFicha, modulosDeFicha,
  tieneModulo,
  type FichaConCapacidades, type IdFlujo,
} from '../../functions/src/registro.ts';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const script = (ruta: string) => join(ADMIN, 'scripts', ruta);
const leer = (ruta: string) => readFileSync(script(ruta), 'utf8');
/** Sin comentarios `//` y `/* *\/` (una URL `https://` no es comentario). */
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;])\/\/.*$/gm, '$1');

// ============================================================ lo que había ANTES
/** `FLUJOS_VALIDOS` de `alta-comercio.mjs` y de `asignar-numero.mjs`. */
const FLUJOS_VALIDOS_ANTES = new Set(['agendamiento', 'venta', 'onboarding']);
/** `DOCUMENTO` de los mismos dos scripts. */
const DOCUMENTO_ANTES: Record<string, string> = { agendamiento: 'agendamiento', venta: 'venta', onboarding: 'onboarding' };
/** `activar-cobro-real.mjs`: la ficha SIN `flujos` no cae a `vertical`. */
const documentoQueCobraAntes = (ficha: { flujos?: unknown }): string | null => {
  const flujos = (ficha.flujos ?? []) as string[];
  return flujos.includes('venta') ? 'venta' : (flujos.includes('agendamiento') ? 'agendamiento' : null);
};
/** `pase-a-produccion.mjs`, `fijar-webhook-carrito.mjs`, `cargar-*`: los flujos de la ficha. */
const flujosDeLaFichaAntes = (f: { flujos?: unknown; vertical?: unknown }): unknown[] =>
  (Array.isArray(f.flujos) ? f.flujos : [f.vertical].filter(Boolean));

// Los ocho subconjuntos de los tres flujos, en el orden en que los lista una ficha.
const SUBCONJUNTOS: IdFlujo[][] = Array.from({ length: 1 << IDS_FLUJOS.length },
  (_, mascara) => IDS_FLUJOS.filter((_f, i) => (mascara >> i) & 1));
const nombre = (s: readonly string[]) => `[${s.join(', ')}]`;

/** Las formas de ficha que hoy tienen los comercios: una por flujo (`vertical` y `flujos` a la par). */
const FICHAS_DE_HOY: [string, FichaConCapacidades & { flujos: string[] }][] = IDS_FLUJOS.map((f) => [
  `un comercio de ${f}`, { vertical: f, flujos: [f] },
]);

describe('1. el registro da lo mismo que las listas de antes', () => {
  it('los flujos válidos son los mismos tres, y un flujo desconocido no lo es', () => {
    expect(new Set(IDS_FLUJOS)).toEqual(FLUJOS_VALIDOS_ANTES);
    for (const f of FLUJOS_VALIDOS_ANTES) expect(esFlujo(f), f).toBe(true);
    for (const raro of ['recordatorios', 'a_medida', 'Venta', '', ' venta', 'toString', '__proto__', 'constructor', null, undefined, 7]) {
      expect(esFlujo(raro), String(raro)).toBe(false);
    }
  });

  it('el documento de cada flujo es el de la tabla de antes, y nada para un desconocido', () => {
    for (const f of IDS_FLUJOS) expect(documentoDeFlujo(f), f).toBe(DOCUMENTO_ANTES[f]);
    for (const raro of ['recordatorios', 'toString', 'constructor', '', null, undefined]) {
      expect(documentoDeFlujo(raro), String(raro)).toBeNull();
    }
  });

  it.each(SUBCONJUNTOS.map((s) => [nombre(s), s] as const))(
    'activar-cobro-real, flujos %s: el documento que cobra es el de antes', (_n, flujos) => {
      const ficha = { flujos, vertical: flujos[0] };
      expect(documentoDeCobro(modulosDeFicha(ficha))).toBe(documentoQueCobraAntes(ficha));
    });

  it.each(FICHAS_DE_HOY)('activar-cobro-real, %s: el documento que cobra es el de antes', (_n, ficha) => {
    expect(documentoDeCobro(modulosDeFicha(ficha))).toBe(documentoQueCobraAntes(ficha));
  });

  it.each(SUBCONJUNTOS.map((s) => [nombre(s), s] as const))(
    'flujos %s: las capacidades de los scripts coinciden con `flujos.includes(...)` de antes', (_n, flujos) => {
      const ficha = { flujos, vertical: flujos[0] };
      // cargar-negocio (sección `agendamiento`, `funcionarios`)
      expect(tieneModulo(ficha, 'agenda')).toBe(flujos.includes('agendamiento'));
      // cargar-negocio (`catalogoWebActivo`), cargar-fotos-catalogo (logo), fijar-webhook-carrito
      expect(tieneModulo(ficha, 'catalogo-web')).toBe(flujos.includes('venta'));
      // cargar-captacion
      expect(tieneModulo(ficha, 'captacion')).toBe(flujos.includes('onboarding'));
      // pase-a-produccion
      expect(flujosDeFicha(ficha)).toEqual(flujosDeLaFichaAntes(ficha));
    });

  it.each(FICHAS_DE_HOY)('%s: los flujos de la ficha son los de antes (también con solo `vertical`)', (_n, ficha) => {
    expect(flujosDeFicha(ficha)).toEqual(flujosDeLaFichaAntes(ficha));
    expect(flujosDeFicha({ vertical: ficha.vertical })).toEqual(flujosDeLaFichaAntes({ vertical: ficha.vertical }));
  });

  it('el puente de flujos nombra, para cada flujo, un módulo que la capacidad de los scripts usa', () => {
    expect(PUENTE_DE_FLUJOS.agendamiento.modulos).toContain('agenda');
    expect(PUENTE_DE_FLUJOS.venta.modulos).toContain('catalogo-web');
    expect(PUENTE_DE_FLUJOS.onboarding.modulos).toContain('captacion');
  });

  // DIFERENCIAS DECLARADAS, solo para fichas que hoy no existen entre los comercios (todos
  // tienen `flujos` con flujos conocidos). Se prueban para que nadie las cambie sin verlas.
  describe('diferencias declaradas con las fichas raras', () => {
    it('un flujo desconocido en la lista ya no cuenta como flujo (antes pasaba el informe del pase)', () => {
      expect(flujosDeLaFichaAntes({ flujos: ['venta', 'recordatorios'] })).toEqual(['venta', 'recordatorios']);
      expect(flujosDeFicha({ flujos: ['venta', 'recordatorios'] })).toEqual(['venta']);
      expect(flujosDeFicha({ flujos: ['recordatorios'] })).toEqual([]);
    });

    it('una ficha sin `flujos` pero con `vertical` ya cobra por el documento de su vertical (antes: ningún flujo que cobre)', () => {
      expect(documentoQueCobraAntes({})).toBeNull();
      expect(documentoDeCobro(modulosDeFicha({ vertical: 'venta' }))).toBe('venta');
      expect(documentoDeCobro(modulosDeFicha({ vertical: 'agendamiento' }))).toBe('agendamiento');
    });

    it('`flujos` que no es lista cierra: ningún flujo, ningún módulo propio, nada que cobre', () => {
      for (const flujos of ['venta', null, { venta: true }, 3]) {
        const ficha = { flujos, vertical: 'venta' };
        expect(flujosDeFicha(ficha), String(flujos)).toEqual([]);
        expect(tieneModulo(ficha, 'catalogo-web'), String(flujos)).toBe(false);
        expect(documentoDeCobro(modulosDeFicha(ficha)), String(flujos)).toBeNull();
      }
    });
  });
});

// ======================================================================= 2
describe('2. cada script importa del registro y ya no tiene su lista de flujos', () => {
  const importa = (codigo: string, simbolo: string) =>
    new RegExp(`import\\s*\\{[^}]*\\b${simbolo}\\b[^}]*\\}\\s*from\\s*['"][^'"]*/functions/src/registro\\.ts['"]`).test(codigo);

  // [script, símbolos que tiene que importar]
  const SCRIPTS: [string, string[]][] = [
    ['plataforma/alta-comercio.mjs', ['esFlujo', 'documentoDeFlujo']],
    ['plataforma/asignar-numero.mjs', ['esFlujo', 'documentoDeFlujo']],
    ['plataforma/activar-cobro-real.mjs', ['documentoDeCobro', 'modulosDeFicha']],
    ['plataforma/pase-a-produccion.mjs', ['flujosDeFicha', 'documentoDeFlujo']],
    ['plataforma/fijar-webhook-carrito.mjs', ['tieneModulo']],
    ['datos/cargar-negocio.mjs', ['tieneModulo']],
    ['datos/cargar-captacion.mjs', ['tieneModulo']],
    ['datos/cargar-fotos-catalogo.mjs', ['tieneModulo']],
  ];

  it.each(SCRIPTS)('%s importa del registro lo que usa', (ruta, simbolos) => {
    const codigo = sinComentarios(leer(ruta));
    for (const s of simbolos) {
      expect(importa(codigo, s), `${ruta} no importa ${s} de registro.ts`).toBe(true);
      expect(new RegExp(`\\b${s}\\(`).test(codigo), `${ruta} importa ${s} y no lo llama`).toBe(true);
    }
  });

  it.each(SCRIPTS)('%s no tiene lista, tabla ni comparación literal de flujos', (ruta) => {
    // `FLUJOS_SUGERIDOS` de cargar-captacion NO es una lista de flujos de un comercio: son los flujos que la
    // captación le sugiere a un prospecto (incluye `recordatorios` y `a_medida`, que no son del registro).
    const codigo = sinComentarios(leer(ruta)).replace(/^const FLUJOS_SUGERIDOS = .*$/m, '');
    expect(codigo, 'conjunto literal de flujos').not.toMatch(/new Set\(\s*\[\s*'(agendamiento|venta|onboarding)'/);
    expect(codigo, 'tabla DOCUMENTO literal').not.toMatch(/const DOCUMENTO\s*=\s*\{/);
    expect(codigo, 'flujos.includes con un flujo literal').not.toMatch(/\.includes\(\s*'(agendamiento|venta|onboarding)'\s*\)/);
  });

  // Donde la ficha se leía para DECIDIR, ya no se lee `flujos` a mano (alta-comercio y asignar-numero lo
  // releen solo para mostrar o verificar lo que escribieron: no deciden nada con eso).
  it.each(SCRIPTS.filter(([ruta]) => !/alta-comercio|asignar-numero/.test(ruta)))(
    '%s no lee `flujos` de la ficha para decidir', (ruta) => {
      expect(sinComentarios(leer(ruta))).not.toMatch(/\.get\(\s*'flujos'\s*\)/);
    });
});

// ======================================================================= 3
describe('3. alta-comercio.mjs y asignar-numero.mjs validan el flujo con el registro (sin abrir Firebase)', () => {
  const correr = (ruta: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [script(ruta), ...args], {
      env: entornoDelEmulador(process.env['FIRESTORE_EMULATOR_HOST']), encoding: 'utf8',
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };
  const problemas = (salida: string) => salida.split('\n').filter((l) => l.includes('✗'));

  // alta-comercio: la validación corta con 2; si pasa, lo siguiente que comprueba (antes de abrir
  // Firebase) es la carpeta del cliente: una que no existe corta con 1 y dice cuál.
  const SIN_CARPETA = 'ZZZ_SIN_CARPETA_H2B4E';
  const alta = (flujos: string) => correr('plataforma/alta-comercio.mjs', '--proyecto', 'demo-novuchat-pruebas',
    '--tenant', 'alta-registro', '--nombre', 'Alta de prueba', '--admin', 'operador@ejemplo.com',
    '--cliente', SIN_CARPETA, '--flujos', flujos);

  it.each(IDS_FLUJOS.map((f) => [f] as const))('alta-comercio acepta --flujos %s (llega a comprobar la carpeta del cliente)', (f) => {
    const r = alta(f);
    expect(r.salida).not.toMatch(/flujo desconocido/);
    expect(r.salida).toMatch(new RegExp(`No existe CLIENTES/${SIN_CARPETA}/`));
    expect(r.codigo).toBe(1);
  });

  it('alta-comercio acepta los tres a la vez', () => {
    const r = alta(IDS_FLUJOS.join(','));
    expect(r.salida).not.toMatch(/flujo desconocido/);
    expect(r.codigo).toBe(1);
  });

  it('alta-comercio NO acepta un flujo desconocido, solo o junto a uno válido: sale con 2 y lo dice', () => {
    for (const flujos of ['recordatorios', 'venta,a_medida', 'Venta']) {
      const r = alta(flujos);
      expect(r.codigo, flujos).toBe(2);
      expect(r.salida, flujos).toMatch(/flujo desconocido: (recordatorios|a_medida|Venta)/);
      expect(r.salida, flujos).not.toMatch(/No existe CLIENTES/);
      expect(problemas(r.salida), flujos).toHaveLength(1);
    }
  });

  // asignar-numero: con todo lo demás válido, el flujo es lo único que puede fallar.
  const asignar = (flujo: string) => correr('plataforma/asignar-numero.mjs', '--proyecto', 'demo-novuchat-pruebas',
    '--operador', 'operador@ejemplo.com', '--tenant', 'asig-registro', '--numero', '1000000061',
    '--waba', '1000000062', '--flujo', flujo, '--alias', 'cliente02');

  it('asignar-numero NO acepta un flujo desconocido ni vacío: sale con 2 y es lo único que falla', () => {
    for (const flujo of ['recordatorios', 'a_medida', 'Venta', 'constructor', '']) {
      const r = asignar(flujo);
      expect(r.codigo, flujo).toBe(2);
      expect(r.salida, flujo).toMatch(/--flujo desconocido: /);
      expect(problemas(r.salida), flujo).toHaveLength(1);
    }
  });
});
