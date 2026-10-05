/**
 * EL CONTRATO DE `crearRegistrarCierre`: olvidar un gancho no compila, y si llega
 * vacío en ejecución, lanza al cargar (F3b-1b). NO NECESITA EMULADOR.
 *
 * Por qué se prueba el COMPILADOR y no solo el comportamiento: la primera
 * defensa contra un gancho olvidado es de tipos (`GanchosDelCierre` sin campos
 * opcionales, y `satisfies` en `ganchos.ts`). Una defensa de tipos se prueba
 * compilando programas virtuales y mirando qué dice el compilador: con los
 * ganchos completos, cero errores; con uno menos, un error que NOMBRA lo que
 * falta. Si alguien vuelve opcional un puerto «para comodidad», estos casos
 * dejan de dar error y la suite cae.
 *
 * La segunda defensa es de ejecución (cada función se comprueba al cargar) y la
 * tercera es de captura (mutar el objeto después no cambia nada: eso se prueba
 * contra el endpoint real en `cierres-ganchos.test.ts`).
 *
 * Y `rutaDelTenant`: el único camino por el que un gancho toca Firestore es el
 * lector anclado al tenant de la firma, y su forma de ruta es fija.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

process.env['GCLOUD_PROJECT'] ??= 'demo-test';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', '..');
const SRC = join(RAIZ, 'admin', 'functions', 'src');
const CIERRES = join(SRC, 'core', 'turno', 'cierres.ts');

const { crearRegistrarCierre, rutaDelTenant } = await import('../../functions/src/core/turno/cierres.ts');

// ---------------------------------------------------------------------------
// Programas virtuales: cada caso es un archivo que vive en `functions/src` (para
// resolver los imports como un archivo real de ahí) pero solo existe en memoria.
// ---------------------------------------------------------------------------

const PREAMBULO = `import { crearRegistrarCierre, type GanchosDelCierre } from './core/turno/cierres.js';\n`;

const GANCHOS_COMPLETOS = `
  cobro: {
    cobroRealActivo: async (_leer) => true,
    cierreDeVentaLoHaceElCotejo: (_previa, _ahoraMs) => false,
  },
  solicitud: {
    solicitudTrasElCierre: (_previa, _ahoraMs, _datos) => null,
  },
`;

const CASOS: Record<string, string> = {
  completos: `${PREAMBULO}
    const ganchos = {${GANCHOS_COMPLETOS}} satisfies GanchosDelCierre;
    export const e = crearRegistrarCierre(ganchos);`,
  sin_solicitud: `${PREAMBULO}
    export const e = crearRegistrarCierre({
      cobro: {
        cobroRealActivo: async (_leer) => true,
        cierreDeVentaLoHaceElCotejo: (_previa, _ahoraMs) => false,
      },
    });`,
  sin_cobro: `${PREAMBULO}
    export const e = crearRegistrarCierre({
      solicitud: { solicitudTrasElCierre: (_previa, _ahoraMs, _datos) => null },
    });`,
  sin_cobroRealActivo: `${PREAMBULO}
    export const e = crearRegistrarCierre({
      cobro: { cierreDeVentaLoHaceElCotejo: (_previa, _ahoraMs) => false },
      solicitud: { solicitudTrasElCierre: (_previa, _ahoraMs, _datos) => null },
    });`,
  sin_cierreDeVentaLoHaceElCotejo: `${PREAMBULO}
    export const e = crearRegistrarCierre({
      cobro: { cobroRealActivo: async (_leer) => true },
      solicitud: { solicitudTrasElCierre: (_previa, _ahoraMs, _datos) => null },
    });`,
  sin_solicitudTrasElCierre: `${PREAMBULO}
    export const e = crearRegistrarCierre({
      cobro: {
        cobroRealActivo: async (_leer) => true,
        cierreDeVentaLoHaceElCotejo: (_previa, _ahoraMs) => false,
      },
      solicitud: {},
    });`,
  sin_argumento: `${PREAMBULO}
    export const e = crearRegistrarCierre();`,
  cobroRealActivo_sincrono: `${PREAMBULO}
    export const e = crearRegistrarCierre({
      cobro: {
        cobroRealActivo: (_leer) => true,
        cierreDeVentaLoHaceElCotejo: (_previa, _ahoraMs) => false,
      },
      solicitud: { solicitudTrasElCierre: (_previa, _ahoraMs, _datos) => null },
    });`,
  datos_sin_cobroReal: `${PREAMBULO}
    export const e = crearRegistrarCierre({
      cobro: {
        cobroRealActivo: async (_leer) => true,
        cierreDeVentaLoHaceElCotejo: (_previa, _ahoraMs) => false,
      },
      solicitud: { solicitudTrasElCierre: (_previa, _ahoraMs, datos) => ({ x: datos.noExiste }) },
    });`,
};

const rutaVirtual = (nombre: string) => join(SRC, `__contrato_virtual_${nombre}.ts`);
const diagnosticos: Record<string, string[]> = {};

beforeAll(() => {
  const config = ts.readConfigFile(join(SRC, '..', 'tsconfig.json'), ts.sys.readFile);
  const opciones = ts.parseJsonConfigFileContent(config.config, ts.sys, join(SRC, '..')).options;
  opciones.noEmit = true;
  const virtuales = new Map(Object.entries(CASOS).map(([n, c]) => [rutaVirtual(n), c]));
  const host = ts.createCompilerHost(opciones);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (nombre, lenguaje, ...resto) => {
    const v = virtuales.get(nombre);
    return v !== undefined ? ts.createSourceFile(nombre, v, lenguaje, true) : getSourceFile(nombre, lenguaje, ...resto);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (n) => virtuales.has(n) || fileExists(n);
  const readFile = host.readFile.bind(host);
  host.readFile = (n) => virtuales.get(n) ?? readFile(n);
  const programa = ts.createProgram([...virtuales.keys()], opciones, host);
  for (const nombre of Object.keys(CASOS)) {
    const fuente = programa.getSourceFile(rutaVirtual(nombre));
    diagnosticos[nombre] = fuente
      ? programa.getSemanticDiagnostics(fuente).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      : ['(el archivo virtual no se cargó)'];
  }
}, 120_000);

describe('Defensa de tipos: olvidar un gancho no compila', () => {
  it('con los ganchos completos hay 0 errores (el caso de control: si falla, el resto no prueba nada)', () => {
    expect(diagnosticos['completos']).toEqual([]);
  });

  it('sin el puerto `solicitud` da un error que lo nombra', () => {
    expect(diagnosticos['sin_solicitud']?.join('\n')).toMatch(/solicitud/);
  });

  it('sin el puerto `cobro` da un error que lo nombra', () => {
    expect(diagnosticos['sin_cobro']?.join('\n')).toMatch(/cobro/);
  });

  it('sin `cobro.cobroRealActivo` da un error que nombra la función', () => {
    expect(diagnosticos['sin_cobroRealActivo']?.join('\n')).toMatch(/cobroRealActivo/);
  });

  it('sin `cobro.cierreDeVentaLoHaceElCotejo` da un error que nombra la función', () => {
    expect(diagnosticos['sin_cierreDeVentaLoHaceElCotejo']?.join('\n')).toMatch(/cierreDeVentaLoHaceElCotejo/);
  });

  it('sin `solicitud.solicitudTrasElCierre` da un error que nombra la función', () => {
    expect(diagnosticos['sin_solicitudTrasElCierre']?.join('\n')).toMatch(/solicitudTrasElCierre/);
  });

  it('`crearRegistrarCierre()` sin argumento no compila (esperaba 1)', () => {
    expect(diagnosticos['sin_argumento']?.join('\n')).toMatch(/Expected 1 arguments?, but got 0/);
  });

  it('un `cobroRealActivo` que devuelve boolean y no Promise<boolean> no compila: el lector es asíncrono', () => {
    const texto = diagnosticos['cobroRealActivo_sincrono']?.join('\n') ?? '';
    expect(texto).toMatch(/Promise<boolean>/);
  });

  it('los `datos` del gancho de solicitud son cerrados: solo `cobroReal`', () => {
    expect(diagnosticos['datos_sin_cobroReal']?.join('\n')).toMatch(/noExiste/);
  });

  it('NINGÚN miembro de las tres interfaces del contrato es opcional (sin `?`, sin valores por defecto)', () => {
    const fuente = ts.createSourceFile(CIERRES, readFileSync(CIERRES, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const interfaces = new Map<string, ts.InterfaceDeclaration>();
    ts.forEachChild(fuente, (n) => { if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n); });
    for (const nombre of ['GanchosDelCierre', 'GanchoDeCobroAlCierre', 'GanchoDeSolicitudAlCierre']) {
      const i = interfaces.get(nombre);
      expect(i, `falta la interfaz ${nombre}`).toBeDefined();
      for (const m of i!.members) {
        expect(m.questionToken, `${nombre}.${m.name?.getText(fuente)} es opcional`).toBeUndefined();
      }
    }
    expect(interfaces.get('GanchosDelCierre')!.members.length).toBe(2);
    expect(interfaces.get('GanchoDeCobroAlCierre')!.members.length).toBe(2);
    expect(interfaces.get('GanchoDeSolicitudAlCierre')!.members.length).toBe(1);
  });
});

describe('Defensa de ejecución: cada función faltante lanza al cargar y se nombra', () => {
  const completos = () => ({
    cobro: { cobroRealActivo: async () => true, cierreDeVentaLoHaceElCotejo: () => false },
    solicitud: { solicitudTrasElCierre: () => null },
  });
  const sin = (puerto: 'cobro' | 'solicitud', funcion: string) => {
    const g = completos() as unknown as Record<string, Record<string, unknown>>;
    delete g[puerto]![funcion];
    return g as never;
  };

  it('con los ganchos completos crea el endpoint (una función invocable)', () => {
    expect(typeof crearRegistrarCierre(completos())).toBe('function');
  });

  it.each([
    ['cobro', 'cobroRealActivo'],
    ['cobro', 'cierreDeVentaLoHaceElCotejo'],
    ['solicitud', 'solicitudTrasElCierre'],
  ] as const)('sin %s.%s lanza «falta el gancho»', (puerto, funcion) => {
    expect(() => crearRegistrarCierre(sin(puerto, funcion)))
      .toThrow(`registrarCierre: falta el gancho ${puerto}.${funcion}`);
  });

  it('sin el puerto entero, o sin objeto, también lanza y nombra la primera que falta', () => {
    expect(() => crearRegistrarCierre({ cobro: completos().cobro } as never))
      .toThrow('registrarCierre: falta el gancho solicitud.solicitudTrasElCierre');
    expect(() => crearRegistrarCierre({ solicitud: completos().solicitud } as never))
      .toThrow('registrarCierre: falta el gancho cobro.cobroRealActivo');
    expect(() => crearRegistrarCierre(undefined as never))
      .toThrow('registrarCierre: falta el gancho cobro.cobroRealActivo');
  });

  it('una propiedad que no es función (un valor suelto) también cuenta como faltante', () => {
    const g = completos() as unknown as Record<string, Record<string, unknown>>;
    g['solicitud']!['solicitudTrasElCierre'] = true;
    expect(() => crearRegistrarCierre(g as never)).toThrow('solicitud.solicitudTrasElCierre');
  });
});

describe('rutaDelTenant: la única forma de ruta que un gancho puede pedir', () => {
  it('ancla `<colección>/<documento>` bajo el tenant de la firma', () => {
    expect(rutaDelTenant('tienda-1', 'config/venta')).toBe('tenants/tienda-1/config/venta');
    expect(rutaDelTenant('t_2', 'cuenta/estado')).toBe('tenants/t_2/cuenta/estado');
  });

  it.each([
    [''], ['config'], ['a/b/c'], ['../x/y'], ['config/ven ta'], ['config/venta/'], ['/config/venta'],
    ['config//venta'], ['config/..'], ['config/venta.json'], ['con\nfig/venta'], ['config/venta?x=1'],
  ])('rechaza %j', (mala) => {
    expect(() => rutaDelTenant('tienda-1', mala)).toThrow(/rutaDelTenant/);
  });

  it('rechaza lo que no es texto', () => {
    for (const malo of [undefined, null, 5, {}]) {
      expect(() => rutaDelTenant('tienda-1', malo as never)).toThrow(/rutaDelTenant/);
    }
  });
});
