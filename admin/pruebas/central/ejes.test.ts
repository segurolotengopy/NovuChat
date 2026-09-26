/**
 * LOS TRES EJES DE LA CUENTA (F1, `Analisis/41` §4) — pruebas PURAS, sin
 * emulador: `central/ejes.ts`, `planes.ts` y `prepago.ts` no importan Firebase.
 *
 * Lo que fija esta suite, y que la revisora comprueba en H1 (`Analisis/41`
 * §8.5): «demostración» NO es un plan; ningún plan dice quién paga Meta; la
 * modalidad es el único eje que decide si se cobra; la titularidad es por
 * número; el modelo es una lista cerrada que coincide con lo que corre en los
 * flujos; el contador de cambios se calcula contra la copia de la cuenta. Y
 * que ningún módulo del servidor ni ningún script escribe `plan:
 * 'demostracion'` ni `pagaMeta`: eso se lee de las fuentes, como
 * `prepago-separacion.test.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PLANES, MAXIMO_CAMBIOS_INCLUIDOS, PLANES, PLANES_ASIGNABLES, PLANES_PUBLICADOS, PLAN_DEMOSTRACION,
  PLAN_POR_DEFECTO, cuentaInicial, esIdPlan, esPlanVendible, limitesDe, limitesDeCuenta, planQuePuedePedir,
} from '../../functions/src/planes.ts';
import { estadoDeServicio, modalidadDe } from '../../functions/src/prepago.ts';
import {
  MODELOS, MODELO_POR_DEFECTO, TITULARIDADES, TITULARIDAD_POR_DEFECTO, cambiosDelMes, cambiosUsadosEn,
  esModelo, esTitularidad, mesDeCambios, modeloDe, titularidadDe,
} from '../../functions/src/central/ejes.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ_ADMIN = join(aqui, '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ_ADMIN, ruta), 'utf8');
/** El cuerpo sin comentarios: lo que corre, no lo que explica. */
const sinComentarios = (fuente: string) => fuente
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
/** `Date.UTC` de una hora de Bolivia (UTC−4 fijo). */
const bo = (a: number, m: number, d: number, h = 12) => Date.UTC(a, m - 1, d, h + 4);

describe('El plan: solo límites, sin demostración y sin quién paga Meta', () => {
  it('«demostracion» NO es un plan: el catálogo son los cuatro vendibles y nada más', () => {
    expect(Object.keys(PLANES).sort()).toEqual(['byoc', 'crecimiento', 'impulso', 'pro']);
    expect(esPlanVendible('demostracion')).toBe(false);
    expect(esIdPlan('demostracion')).toBe(false);
    // El puente para la consola es el MISMO predicado, y el alias es el MISMO objeto.
    for (const v of ['impulso', 'byoc', 'basico', 'toString', '', null, 7]) expect(esIdPlan(v)).toBe(esPlanVendible(v));
    expect(PLANES_ASIGNABLES).toBe(PLANES);
    expect(PLAN_DEMOSTRACION).toBeNull();
    expect(planQuePuedePedir('demostracion', 'demostracion')).toBe(false);
  });

  it('un `plan: \'demostracion\'` que quedó sin migrar cae en el más chico, como cualquier plan desconocido', () => {
    expect(limitesDe('demostracion')).toEqual(limitesDe(PLAN_POR_DEFECTO));
    expect(limitesDeCuenta({ plan: 'demostracion' })).toMatchObject({ ...limitesDe('impulso'), origen: 'respaldo' });
  });

  it('ningún plan dice quién paga Meta: eso es la titularidad del número', () => {
    for (const [id, p] of Object.entries(PLANES)) {
      expect(Object.prototype.hasOwnProperty.call(p, 'pagaMeta'), id).toBe(false);
    }
    // BYOC sigue siendo un plan del catálogo (2.000 por USD 50), fuera de los publicados.
    expect(PLANES.byoc).toMatchObject({ precioUsd: 50, conversaciones: 2000 });
    expect(PLANES_PUBLICADOS).not.toContain('byoc');
  });

  it('cambiosIncluidos: 0 / 1 / 2 / 2 (propuesta del 25/09, a confirmar por Andres), y el 0 es válido', () => {
    expect([PLANES.impulso, PLANES.crecimiento, PLANES.pro, PLANES.byoc].map((p) => p.cambiosIncluidos)).toEqual([0, 1, 2, 2]);
    for (const p of Object.values(PLANES)) {
      expect(Number.isInteger(p.cambiosIncluidos)).toBe(true);
      expect(p.cambiosIncluidos).toBeGreaterThanOrEqual(0);
      expect(p.cambiosIncluidos).toBeLessThanOrEqual(MAXIMO_CAMBIOS_INCLUIDOS);
    }
    expect(CATALOGO_PLANES).toBe('2026-09-25');
  });

  it('la copia que se escribe lleva cambiosIncluidos, y una cuenta nueva también', () => {
    expect(limitesDe('crecimiento')).toEqual({ conversaciones: 220, productos: 100, agendas: 5, cambiosIncluidos: 1 });
    expect(cuentaInicial().limites).toEqual(limitesDe(PLAN_POR_DEFECTO));
    expect(cuentaInicial().limites.cambiosIncluidos).toBe(0);
  });

  it('en la copia de la cuenta manda cambiosIncluidos (0 incluido); inválido, rige el plan; y no cambia el origen', () => {
    const tres = { conversaciones: 220, productos: 100, agendas: 5 };
    expect(limitesDeCuenta({ plan: 'pro', limites: { ...tres, cambiosIncluidos: 0 } }))
      .toMatchObject({ cambiosIncluidos: 0, origen: 'cuenta' });
    expect(limitesDeCuenta({ plan: 'pro', limites: { ...tres, cambiosIncluidos: 4 } }).cambiosIncluidos).toBe(4);
    // Sin la clave (copias anteriores a F1): la del plan, y la copia sigue siendo «de la cuenta».
    expect(limitesDeCuenta({ plan: 'pro', limites: tres })).toMatchObject({ cambiosIncluidos: 2, origen: 'cuenta' });
    for (const malo of [-1, 1.5, '2', MAXIMO_CAMBIOS_INCLUIDOS + 1, null]) {
      expect(limitesDeCuenta({ plan: 'crecimiento', limites: { ...tres, cambiosIncluidos: malo } }).cambiosIncluidos, String(malo)).toBe(1);
    }
  });
});

describe('La modalidad es el único eje que decide si se cobra', () => {
  it('el plan ya NO manda sobre la modalidad: un `plan: \'demostracion\'` con modalidad prepago ES prepago', () => {
    expect(modalidadDe({ plan: 'demostracion', modalidad: 'prepago' })).toBe('prepago');
    expect(modalidadDe({ plan: 'pro', modalidad: 'demostracion' })).toBe('demostracion');
    // La salvaguarda de la ausencia se conserva.
    expect(modalidadDe({ plan: 'pro' })).toBe('demostracion');
  });

  it('un demo es modalidad demostración con CUALQUIER plan: nunca se corta y no paga', () => {
    for (const plan of Object.keys(PLANES)) {
      const e = estadoDeServicio({ plan, modalidad: 'demostracion', limites: limitesDe(plan) }, 99_999, bo(2026, 10, 15));
      expect(e, plan).toMatchObject({ operativo: true, modalidad: 'demostracion', plan, mensualidadUsd: 0 });
      expect(e.disponibles).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

describe('La titularidad del canal, por número', () => {
  it('dos valores, y sin titularidad el número es de NovuChat (el lado seguro)', () => {
    expect(TITULARIDADES).toEqual(['novuchat', 'comercio']);
    expect(TITULARIDAD_POR_DEFECTO).toBe('novuchat');
    for (const v of ['novuchat', 'comercio']) expect(esTitularidad(v)).toBe(true);
    for (const v of ['byoc', 'NovuChat', '', null, undefined, 1, 'comercio ']) expect(esTitularidad(v)).toBe(false);
    expect(titularidadDe({ titularidad: 'comercio' })).toBe('comercio');
    expect(titularidadDe({ titularidad: 'byoc' })).toBe('novuchat');
    expect(titularidadDe({})).toBe('novuchat');
    expect(titularidadDe(undefined)).toBe('novuchat');
  });
});

describe('El modelo de IA, por tenant', () => {
  it('es una lista cerrada, y el de defecto es el que corre en TODOS los flujos versionados', () => {
    expect(esModelo(MODELO_POR_DEFECTO)).toBe(true);
    for (const v of ['gemini', 'gpt-4o', '', null, 'GEMINI-3.5-FLASH-LITE']) expect(esModelo(v)).toBe(false);
    expect(modeloDe({})).toBe(MODELO_POR_DEFECTO);
    expect(modeloDe({ modelo: 'inventado' })).toBe(MODELO_POR_DEFECTO);
    expect(modeloDe({ modelo: 'claude-haiku-4-5' })).toBe('claude-haiku-4-5');

    const carpeta = join(RAIZ_ADMIN, '..', 'Flujos');
    const flujos = readdirSync(carpeta).filter((f) => f.endsWith('.json'));
    expect(flujos.length).toBeGreaterThan(0);
    const modelos = new Set<string>();
    for (const f of flujos) {
      for (const m of readFileSync(join(carpeta, f), 'utf8').matchAll(/"modelName":\s*"models\/([^"]+)"/g)) modelos.add(m[1]!);
    }
    expect([...modelos]).toEqual([MODELO_POR_DEFECTO]);
    for (const m of modelos) expect(MODELOS).toContain(m);
  });
});

describe('El contador de cambios operados', () => {
  it('el mes es el calendario de Bolivia, no el UTC', () => {
    // 2026-10-01 02:00 UTC es 2026-09-30 22:00 en Bolivia.
    expect(mesDeCambios(Date.UTC(2026, 9, 1, 2))).toBe('2026-09');
    expect(mesDeCambios(bo(2026, 10, 1, 0))).toBe('2026-10');
  });

  it('cuenta lo usado en el mes desde `cambios.{mes}`, y basura vale cero', () => {
    expect(cambiosUsadosEn({ cambios: { '2026-10': 3 } }, '2026-10')).toBe(3);
    expect(cambiosUsadosEn({ cambios: { '2026-09': 3 } }, '2026-10')).toBe(0);
    for (const c of [undefined, {}, { cambios: null }, { cambios: 'tres' }, { cambios: { '2026-10': 'tres' } }, { cambios: { '2026-10': -2 } }]) {
      expect(cambiosUsadosEn(c, '2026-10')).toBe(0);
    }
  });

  it('permite hasta lo incluido por la copia (0 incluido) o por el plan, y ni uno más', () => {
    const ahora = bo(2026, 10, 10);
    const copia = { conversaciones: 220, productos: 100, agendas: 5 };
    expect(cambiosDelMes({ plan: 'impulso', modalidad: 'prepago' }, ahora))
      .toEqual({ mes: '2026-10', usados: 0, incluidos: 0, ilimitado: false, restantes: 0, permitido: false });
    expect(cambiosDelMes({ plan: 'pro', modalidad: 'prepago', cambios: { '2026-10': 1 } }, ahora))
      .toMatchObject({ usados: 1, incluidos: 2, restantes: 1, permitido: true });
    expect(cambiosDelMes({ plan: 'pro', modalidad: 'prepago', cambios: { '2026-10': 2 } }, ahora))
      .toMatchObject({ usados: 2, incluidos: 2, restantes: 0, permitido: false });
    // La copia manda sobre el plan: lo vendido a medida («hasta 4»).
    expect(cambiosDelMes({ plan: 'impulso', modalidad: 'prepago', limites: { ...copia, cambiosIncluidos: 4 }, cambios: { '2026-10': 3 } }, ahora))
      .toMatchObject({ incluidos: 4, permitido: true });
    expect(cambiosDelMes({ plan: 'pro', modalidad: 'prueba', limites: { ...copia, cambiosIncluidos: 0 } }, ahora))
      .toMatchObject({ incluidos: 0, permitido: false });
    // El mes anterior no cuenta para el actual.
    expect(cambiosDelMes({ plan: 'crecimiento', modalidad: 'prepago', cambios: { '2026-09': 9 } }, ahora))
      .toMatchObject({ usados: 0, permitido: true });
  });

  it('una demostración se cuenta y nunca se niega', () => {
    const c = cambiosDelMes({ plan: 'impulso', modalidad: 'demostracion', cambios: { '2026-10': 40 } }, bo(2026, 10, 10));
    expect(c).toMatchObject({ usados: 40, incluidos: 0, ilimitado: true, permitido: true });
    expect(c.restantes).toBe(Number.POSITIVE_INFINITY);
    // Sin modalidad también es demostración (la salvaguarda de siempre).
    expect(cambiosDelMes({ plan: 'impulso' }, bo(2026, 10, 10)).permitido).toBe(true);
  });
});

describe('Las fuentes: nadie escribe el plan viejo ni pagaMeta, y el servidor usa lo vendible', () => {
  const carpetas = ['functions/src', 'functions/src/central', 'scripts'];
  const archivos = carpetas.flatMap((c) => readdirSync(join(RAIZ_ADMIN, c))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'))
    .map((f) => `${c}/${f}`));

  it('hay fuentes que revisar', () => {
    expect(archivos).toEqual(expect.arrayContaining(['functions/src/planes.ts', 'scripts/asignar-plan.mjs', 'scripts/migrar-ejes.mjs']));
  });

  it('ningún módulo del servidor ni ningún script escribe `plan: \'demostracion\'`', () => {
    for (const a of archivos) {
      expect(sinComentarios(leer(a)), a).not.toMatch(/plan:\s*['"]demostracion['"]/);
    }
  });

  it('`pagaMeta` no se escribe en ninguna parte; el puente es solo la clave opcional del tipo', () => {
    for (const a of archivos) {
      expect(sinComentarios(leer(a)), a).not.toMatch(/pagaMeta\s*:\s*['"]/);
    }
    expect(sinComentarios(leer('functions/src/planes.ts'))).toMatch(/pagaMeta\?:/);
  });

  it('el servidor usa `esPlanVendible` e `IdPlanVendible`: el puente `esIdPlan` / `IdPlan` / `PLAN_DEMOSTRACION` es solo para la consola', () => {
    for (const a of archivos.filter((x) => x.startsWith('functions/src') && x !== 'functions/src/planes.ts')) {
      const fuente = sinComentarios(leer(a));
      expect(fuente, a).not.toMatch(/\besIdPlan\b/);
      expect(fuente, a).not.toMatch(/\bPLAN_DEMOSTRACION\b/);
      expect(fuente, a).not.toMatch(/\bPLANES_ASIGNABLES\b(?!\s*\}\s*from)/);
      expect(fuente, a).not.toMatch(/\bIdPlan\b/);
    }
    // Y la consola sí los importa todavía: cuando deje de hacerlo, el puente se borra.
    const consola = leer('web/src/lib/planes.ts') + leer('web/src/lib/pagar.ts');
    expect(consola).toMatch(/PLAN_DEMOSTRACION|esIdPlan/);
  });
});
