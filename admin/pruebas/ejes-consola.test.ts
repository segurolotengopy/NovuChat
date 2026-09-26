/**
 * LOS TRES EJES DE LA CUENTA EN LA CONSOLA (`Analisis/41` §4): plan, modalidad
 * y titularidad son independientes, se muestran por separado y con las
 * palabras nuevas, y ninguna pantalla los deduce del nombre del plan.
 *
 * Lo que estas pruebas defienden:
 *  1. LAS PALABRAS. «Producción», nunca «prepago», al comercio; «Número de
 *     NovuChat» / «Número propio del comercio» para la titularidad.
 *  2. LA TITULARIDAD ES POR NÚMERO, con `novuchat` de respaldo: es lo que hoy
 *     son todos los números, y un dato ausente no convierte a nadie en BYOC.
 *  3. EL CONTADOR DE CAMBIOS NO INVENTA UN TOPE: sin la clave del plan dice
 *     cuántos van y nada más (`CLAUDE.md` §7: un límite que solo existe en la
 *     pantalla no existe).
 *  4. NINGÚN ARCHIVO DE LA CONSOLA compara `plan === 'demostracion'` ni lee
 *     `pagaMeta` (hito H1 de `Analisis/41` §8.5).
 *  5. EL CONTRATO CON `central` VIVE EN UN SOLO ARCHIVO (`lib/ejes.ts`): las
 *     pantallas llaman a las callables por `CALLABLES`, no por su nombre suelto.
 *
 * Las partes que dependen de datos que `central` escribe (`titularidad`,
 * `cambios`, `limites.cambiosIncluidos`) se prueban contra el contrato
 * declarado en `lib/ejes.ts` y se validan al reconciliar las dos ramas.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CALLABLES, DESCRIPCION_TITULARIDAD, ETIQUETA_MODALIDAD, ETIQUETA_MODELO, ETIQUETA_TITULARIDAD, MODALIDADES, MODELOS,
  MODELO_POR_DEFECTO, TITULARIDADES, etiquetaModalidad, facturaMetaAlComercio, modeloDe, rutaDe, titularidadDe,
  type CambiosVista, type EjesDeCuenta,
} from '../web/src/lib/ejes';
import { esPlanPublicado, esPlanVendible, planSiguiente, precioUsdDe } from '../web/src/lib/planes';
import { PLANES, PLANES_PUBLICADOS } from '../functions/src/planes';
import { MODALIDADES as MODALIDADES_SERVIDOR, importeBs } from '../functions/src/prepago';
import * as CENTRAL from '../functions/src/central/ejes';
import { EjesDeLaCuenta } from '../web/src/central/componentes/EjesDeLaCuenta';
import { ContadorCambios } from '../web/src/central/componentes/ContadorCambios';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', ruta), 'utf8');
const sinComentarios = (fuente: string) => fuente
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const desdeWeb = createRequire(join(aqui, '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };

/** 15 de octubre de 2026, 12:00 de Bolivia. */
const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);
const TC = { tco: 12.6, fecha: '2026-10-15', fuente: 'BCB' };
const MES = CENTRAL.mesDeCambios(AHORA);

/** Todos los .ts y .tsx de la consola, para las prohibiciones globales. */
function archivosDeLaConsola(dir = join(aqui, '..', 'web', 'src')): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return archivosDeLaConsola(ruta);
    return /\.(ts|tsx)$/.test(n) ? [ruta] : [];
  });
}

describe('modalidad: las palabras nuevas sobre los valores del servidor', () => {
  it('cubre exactamente las modalidades del servidor y a prepago le dice «Producción»', () => {
    expect([...MODALIDADES]).toEqual([...MODALIDADES_SERVIDOR]);
    for (const m of MODALIDADES) expect(ETIQUETA_MODALIDAD[m]).toBeTruthy();
    expect(ETIQUETA_MODALIDAD.prepago).toBe('Producción');
    expect(ETIQUETA_MODALIDAD.prueba).toBe('Prueba');
    expect(ETIQUETA_MODALIDAD.demostracion).toBe('Demostración');
    for (const m of MODALIDADES) expect(ETIQUETA_MODALIDAD[m].toLowerCase()).not.toContain('prepago');
  });

  it('etiquetaModalidad sigue a modalidadDe: sin modalidad es Demostración', () => {
    expect(etiquetaModalidad({ modalidad: 'prepago' })).toBe('Producción');
    expect(etiquetaModalidad({ modalidad: 'prueba' })).toBe('Prueba');
    expect(etiquetaModalidad({})).toBe('Demostración');
    expect(etiquetaModalidad(undefined)).toBe('Demostración');
    expect(etiquetaModalidad({ modalidad: 'produccion' })).toBe('Demostración');
  });
});

describe('titularidad: por número, con NovuChat de respaldo', () => {
  it('ausente, inválida o de un documento vacío es de NovuChat', () => {
    for (const ruta of [undefined, null, {}, { titularidad: 'byoc' }, { titularidad: 7 }, { titularidad: 'Comercio' }]) {
      expect(titularidadDe(ruta)).toBe('novuchat');
    }
    expect(titularidadDe({ titularidad: 'comercio' })).toBe('comercio');
  });

  it('rutaDe lee el documento sin confiar en su forma', () => {
    expect(rutaDe('123', { tenantId: 't-1', flujo: 'reservas', titularidad: 'comercio' }))
      .toEqual({ phoneNumberId: '123', tenantId: 't-1', flujo: 'reservas', estado: undefined, titularidad: 'comercio' });
    expect(rutaDe('123', undefined).tenantId).toBe('');
    expect(rutaDe('123', { tenantId: 9 }).tenantId).toBe('');
  });

  it('Meta le factura al comercio si ALGUNO de sus números es propio', () => {
    const propio = rutaDe('1', { tenantId: 't', titularidad: 'comercio' });
    const provisto = rutaDe('2', { tenantId: 't' });
    expect(facturaMetaAlComercio([])).toBe(false);
    expect(facturaMetaAlComercio([provisto])).toBe(false);
    expect(facturaMetaAlComercio([provisto, propio])).toBe(true);
  });

  it('las dos etiquetas dicen de quién es el número, y la descripción dice quién paga Meta', () => {
    expect(ETIQUETA_TITULARIDAD.novuchat).toBe('Número de NovuChat');
    expect(ETIQUETA_TITULARIDAD.comercio).toBe('Número propio del comercio');
    expect(DESCRIPCION_TITULARIDAD.comercio).toContain('Meta le factura');
    expect(DESCRIPCION_TITULARIDAD.novuchat).toContain('entra en el precio');
  });
});

describe('modelo y titularidad: las listas son las del servidor, no una copia', () => {
  it('MODELOS y TITULARIDADES son los mismos objetos que exporta functions/src/central/ejes.ts', () => {
    expect(MODELOS).toBe(CENTRAL.MODELOS);
    expect(TITULARIDADES).toBe(CENTRAL.TITULARIDADES);
    expect(MODELO_POR_DEFECTO).toBe(CENTRAL.MODELO_POR_DEFECTO);
  });

  it('cada modelo de la lista cerrada tiene su etiqueta, y ninguna más', () => {
    expect(Object.keys(ETIQUETA_MODELO).sort()).toEqual([...MODELOS].sort());
  });

  it('sin dato o con uno desconocido rige el de respaldo del servidor', () => {
    expect(modeloDe(undefined)).toBe(CENTRAL.MODELO_POR_DEFECTO);
    expect(modeloDe({ modelo: 'gpt' })).toBe(CENTRAL.MODELO_POR_DEFECTO);
    expect(modeloDe({ modelo: 'claude-haiku-4-5' })).toBe('claude-haiku-4-5');
  });

  it('la consola no escribe su propia lista de modelos ni de titularidades', () => {
    const ejes = sinComentarios(leer('web/src/lib/ejes.ts'));
    expect(ejes).not.toMatch(/MODELOS\s*=\s*\[/);
    expect(ejes).not.toMatch(/TITULARIDADES\s*=\s*\[/);
    expect(ejes).toContain("from '../../../functions/src/central/ejes'");
  });
});

describe('cambios incluidos del mes: los cuenta el servidor, acá se dibujan', () => {
  const vista = (c: Partial<CambiosVista>): CambiosVista =>
    ({ mes: MES, usados: 0, incluidos: 2, restantes: 2, ilimitado: false, ...c });
  const dibujar = (c: CambiosVista) => renderToStaticMarkup(createElement(ContadorCambios, { cambios: c }));

  it('la vista de ejesDeCuenta es la de cambiosDelMes del servidor (demostración: ilimitado y sin tope)', () => {
    const cuenta = { modalidad: 'prepago', plan: 'pro', cambios: { [MES]: 1 } };
    const c = CENTRAL.cambiosDelMes(cuenta, AHORA);
    expect(c).toMatchObject({ mes: MES, usados: 1, incluidos: PLANES.pro.cambiosIncluidos, ilimitado: false });
    expect(CENTRAL.cambiosDelMes({ modalidad: 'demostracion', plan: 'pro' }, AHORA).ilimitado).toBe(true);
  });

  it('dibuja «usados de incluidos» y avisa cuando se agotaron', () => {
    expect(dibujar(vista({ usados: 1, incluidos: 3 }))).toContain('1 de 3 incluidos este mes');
    const agotado = dibujar(vista({ usados: 2, incluidos: 2, restantes: 0 }));
    expect(agotado).toContain('se cotizan aparte');
    expect(agotado).toContain('situacion alerta');
  });

  it('con cero incluidos (autoservicio) el primero ya se cotiza', () => {
    expect(dibujar(vista({ usados: 0, incluidos: 0, restantes: 0 }))).toContain('se cotizan aparte');
  });

  it('en demostración no inventa un tope: cuenta y dice que no hay', () => {
    const html = dibujar(vista({ usados: 3, incluidos: null, restantes: null, ilimitado: true }));
    expect(html).toContain('3 cambios este mes');
    expect(html).toContain('sin tope en demostración');
    expect(html).not.toContain('incluidos');
    expect(html).not.toContain('cotizan');
  });

  it('sin tope conocido tampoco inventa uno', () => {
    const html = dibujar(vista({ usados: 2, incluidos: null, restantes: null }));
    expect(html).toContain('2 cambios este mes');
    expect(html).not.toContain('cotizan');
  });
});

describe('el catálogo decide qué plan se vende, no el nombre del plan', () => {
  it('esPlanVendible es «está en PLANES»: el interno de demostración no se vende', () => {
    for (const p of Object.keys(PLANES)) expect(esPlanVendible(p)).toBe(true);
    expect(esPlanVendible('demostracion')).toBe(false);
    expect(esPlanVendible('toString')).toBe(false);
    expect(esPlanVendible(undefined)).toBe(false);
  });

  it('esPlanPublicado es la escalera del sitio', () => {
    for (const p of PLANES_PUBLICADOS) expect(esPlanPublicado(p)).toBe(true);
    const noPublicados = Object.keys(PLANES).filter((p) => !(PLANES_PUBLICADOS as readonly string[]).includes(p));
    for (const p of noPublicados) expect(esPlanPublicado(p)).toBe(false);
    expect(noPublicados.length).toBeGreaterThan(0);
  });

  it('planSiguiente: un plan del catálogo fuera de la escalera no tiene siguiente; uno desconocido sugiere el segundo', () => {
    for (const p of Object.keys(PLANES).filter((p) => !esPlanPublicado(p))) expect(planSiguiente(p)).toBeNull();
    // «demostracion» ya no es un plan: una cuenta sin migrar se trata como
    // cualquier plan desconocido, igual que en el servidor (el más chico).
    expect(planSiguiente('demostracion')).toEqual(planSiguiente('basico'));
    expect(planSiguiente(PLANES_PUBLICADOS.at(-1))).toBeNull();
    expect(planSiguiente('basico')?.nombre).toBe(PLANES[PLANES_PUBLICADOS[1]].nombre);
  });

  it('precioUsdDe sale del catálogo; «demostracion» ya no es un plan y no tiene precio', () => {
    expect(precioUsdDe('pro')).toBe(PLANES.pro.precioUsd);
    expect(precioUsdDe('demostracion')).toBeNull();
    expect(precioUsdDe('premium')).toBeNull();
  });
});

describe('EjesDeLaCuenta: tres filas, todo de ejesDeCuenta', () => {
  const ejes = (e: Partial<EjesDeCuenta>): EjesDeCuenta => ({
    tenantId: 't-1', plan: 'impulso',
    limites: { conversaciones: 100, productos: 20, agendas: 1, cambiosIncluidos: 0, origen: 'cuenta' },
    modalidad: 'prepago', modalidadExplicita: true, modelo: CENTRAL.MODELO_POR_DEFECTO, numeros: [],
    cambios: { mes: MES, usados: 0, incluidos: 0, restantes: 0, ilimitado: false },
    ...e,
  });
  const numero = (id: string, titularidad: 'novuchat' | 'comercio', flujo = 'reservas') =>
    ({ phoneNumberId: id, flujo, estado: 'activo', titularidad, titularidadExplicita: true });
  const dibujar = (e: EjesDeCuenta | null | undefined, tc: unknown = TC) =>
    renderToStaticMarkup(createElement(EjesDeLaCuenta, { ejes: e, tipoCambio: tc, ahoraMs: AHORA }));

  it('muestra la modalidad, el plan con USD y Bs al TCO del día, y la titularidad de cada número', () => {
    const html = dibujar(ejes({ numeros: [numero('1', 'comercio'), numero('2', 'novuchat', 'venta')] }));
    expect(html).toContain('Producción');
    expect(html).toContain(PLANES.impulso.nombre);
    expect(html).toContain(`USD ${PLANES.impulso.precioUsd} al mes`);
    expect(html).toContain(`Bs ${importeBs(PLANES.impulso.precioUsd, TC.tco)}`);
    expect(html).toContain('Número propio del comercio');
    expect(html).toContain('Número de NovuChat');
    expect(html.toLowerCase()).not.toContain('prepago');
    expect(html).not.toContain('byoc');
  });

  it('un comercio con plan Impulso y número propio se ve así, sin necesidad del plan BYOC', () => {
    const html = dibujar(ejes({ numeros: [numero('1', 'comercio')] }));
    expect(html).toContain(PLANES.impulso.nombre);
    expect(html).toContain('Número propio del comercio');
  });

  it('sin tipo de cambio del día no inventa la cifra en bolivianos, y lo dice', () => {
    const html = dibujar(ejes({ plan: 'pro' }), null);
    expect(html).toContain('sin tipo de cambio del día');
    expect(html).not.toContain('Bs ');
  });

  it('cargando lo dice; si el servidor no respondió, lo dice; sin números, «Sin número asignado»', () => {
    expect(dibujar(undefined)).toContain('Leyendo los ejes de la cuenta');
    expect(dibujar(null)).toContain('No se pudieron leer los ejes de la cuenta');
    expect(dibujar(ejes({}))).toContain('Sin número asignado');
  });

  it('una demostración se muestra como modalidad con su plan, no como un plan', () => {
    const html = dibujar(ejes({ modalidad: 'demostracion', plan: 'pro' }));
    expect(html).toContain('Demostración');
    expect(html).toContain(PLANES.pro.nombre);
  });

  it('trae el contador de cambios del mes', () => {
    expect(dibujar(ejes({ cambios: { mes: MES, usados: 1, incluidos: 2, restantes: 1, ilimitado: false } })))
      .toContain('1 de 2 incluidos este mes');
  });
});

describe('ninguna pantalla deduce un eje del nombre del plan (hito H1)', () => {
  const fuentes = archivosDeLaConsola().map((ruta) => ({ ruta, texto: sinComentarios(readFileSync(ruta, 'utf8')) }));

  it('hay archivos que revisar', () => {
    expect(fuentes.length).toBeGreaterThan(20);
  });

  it("no compara plan === 'demostracion' ni lee pagaMeta en ningún archivo de web/src", () => {
    // Comparar la MODALIDAD con 'demostracion' sí vale: es el eje que dice si
    // el comercio paga. Lo prohibido es deducirla del PLAN.
    for (const { ruta, texto } of fuentes) {
      expect(texto, ruta).not.toMatch(/plan\s*[!=]==\s*'demostracion'|'demostracion'\s*\|\||\bpagaMeta\b/);
      expect(texto, ruta).not.toMatch(/plan\s*[!=]==\s*'byoc'/);
    }
  });

  it('ningún archivo de la consola usa los puentes deprecados de planes.ts (F2 los borra)', () => {
    for (const { ruta, texto } of fuentes) {
      expect(texto, ruta).not.toMatch(/\besIdPlan\b|\bPLANES_ASIGNABLES\b|\bPLAN_DEMOSTRACION\b|\bIdPlan\b/);
    }
  });

  it("no compara con 'byoc' por nombre: BYOC ya no es un plan que decida nada", () => {
    for (const { ruta, texto } of fuentes) {
      expect(texto, ruta).not.toMatch(/===\s*'byoc'|'byoc'\s*\|\||\|\|\s*plan\s*===\s*'byoc'/);
    }
  });

  it('las callables de los ejes se llaman por CALLABLES de lib/ejes.ts, en un solo lugar', () => {
    const lista = ['asignarEjes', 'ejesDeCuenta', 'registrarCambioOperado', 'fijarCortePrepago', 'suspenderTenant', 'reactivarTenant', 'registrarPagoManual'];
    for (const nombre of lista) expect(Object.values(CALLABLES)).toContain(nombre);
    for (const { ruta, texto } of fuentes) {
      if (ruta.endsWith('lib/ejes.ts')) continue;
      for (const nombre of lista) expect(texto, `${ruta} nombra ${nombre} suelto`).not.toContain(`'${nombre}'`);
    }
  });

  it('la consola le dice «Producción» al comercio y no «prepago» en ningún texto visible', () => {
    // Se revisan los archivos que dibujan texto para el comercio: el nombre
    // del módulo `prepago.ts` y los identificadores del servidor se quedan.
    for (const ruta of ['web/src/paginas/EstadoCuenta.tsx', 'web/src/paginas/Pagar.tsx', 'web/src/componentes/ResumenPrepago.tsx']) {
      const jsx = sinComentarios(leer(ruta)).match(/>[^<>{}]*</g) ?? [];
      for (const trozo of jsx) expect(trozo.toLowerCase(), `${ruta}: ${trozo}`).not.toContain('prepago');
    }
  });
});
