/**
 * LA TARIFA DE LA CUENTA (`cuenta/estado.tarifa`, Andres, 11-12/10/2026) — qué
 * conversaciones trae cada plan según quién paga la mensajería de Meta, y por
 * qué Bellido, Platinum y los demos NO se mueven.
 *
 * NO NECESITA EMULADOR: todo esto es `planes.ts` y `prepago.ts` puros. Las
 * pruebas de punta a punta (la callable de plan y el pago manual, contra el
 * emulador) están en `planes-tarifa-cuenta.test.ts`, y la de reglas en
 * `planes-tarifa-reglas.test.ts`.
 *
 * Se escribe NEGANDO (`CLAUDE.md`, Base comercial §7):
 *  - una cuenta SIN `tarifa` y con la copia de 100 NO pasa a 200 (ni al
 *    renovar, ni al medirse el aviso, ni en lo que pinta la consola);
 *  - al cambiar de plan esa cuenta recibe 220, NO 500;
 *  - un valor de tarifa inventado NO sube los topes;
 *  - `limitesDe` SIN tarifa NO compila.
 *
 * La prueba de «idéntica» compara la cuenta de hoy con una FOTO sacada con el
 * código anterior a la tarifa (`tarifa-antes.json`): cuentas sintéticas, campo
 * por campo, ver `tarifa-foto.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONVERSACIONES_META_INCLUIDO, PLANES, PLANES_PUBLICADOS, REGALO_SEIS_MESES_CONVERSACIONES, TARIFAS,
  TARIFA_DE_ALTA, TARIFA_DE_RESPALDO, avisoDeConsumo, copiaDeLimites, cuentaInicial, esPlanVendible, esTarifa,
  limitesDe, limitesDeCuenta, tarifaDe,
} from '../../functions/src/central/cuenta/planes.ts';
import { MESES_MAXIMO, aplicarPago, estadoDeServicio } from '../../functions/src/central/cuenta/prepago.ts';
import { planDeLaCuenta } from '../../web/src/central/lib/pagar.ts';
import { CUENTAS_SIN_TARIFA, fotoDeTodas } from './tarifa-foto.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const AHORA = Date.parse('2026-10-15T16:00:00Z');

/** La cuenta de un piloto con Meta incluido: Impulso, copia de 100, SIN el campo `tarifa`. */
const IMPULSO_COPIA_100 = {
  plan: 'impulso', modalidad: 'prepago', periodoPagado: '2026-10',
  limites: { conversaciones: 100, productos: 20, agendas: 1, cambiosIncluidos: 0 },
};

// -----------------------------------------------------------------------------
describe('tarifaDe: sin campo, o con uno que no es válido, es meta_incluido (el límite menor)', () => {
  it('los valores y las constantes', () => {
    expect([...TARIFAS]).toEqual(['estandar', 'meta_incluido']);
    expect(TARIFA_DE_ALTA).toBe('estandar');
    expect(TARIFA_DE_RESPALDO).toBe('meta_incluido');
  });

  it('una cuenta SIN campo, una cuenta que no existe y una vacía son meta_incluido', () => {
    expect(tarifaDe({})).toBe('meta_incluido');
    expect(tarifaDe(IMPULSO_COPIA_100)).toBe('meta_incluido');
    expect(tarifaDe(undefined)).toBe('meta_incluido');
    expect(tarifaDe(null)).toBe('meta_incluido');
  });

  it('un valor inventado NO sube los topes: cae en meta_incluido', () => {
    for (const malo of ['Estandar', 'ESTANDAR', 'estándar', 'gratis', '', ' estandar', 'byoc', 1, true, null, {}, ['estandar']]) {
      expect(tarifaDe({ tarifa: malo }), String(malo)).toBe('meta_incluido');
      expect(esTarifa(malo), String(malo)).toBe(false);
    }
  });

  it('los dos valores válidos se respetan', () => {
    expect(tarifaDe({ tarifa: 'estandar' })).toBe('estandar');
    expect(tarifaDe({ tarifa: 'meta_incluido' })).toBe('meta_incluido');
  });
});

// -----------------------------------------------------------------------------
describe('limitesDe(plan, tarifa): los topes de cada tarifa', () => {
  it('estándar: 200 / 500 / 1.000 (y BYOC 2.000); meta incluido: 100 / 220 / 500 (y BYOC 2.000)', () => {
    const de = (t: 'estandar' | 'meta_incluido') => (['impulso', 'crecimiento', 'pro', 'byoc'] as const)
      .map((p) => limitesDe(p, t).conversaciones);
    expect(de('estandar')).toEqual([200, 500, 1000, 2000]);
    expect(de('meta_incluido')).toEqual([100, 220, 500, 2000]);
  });

  it('la tabla CONVERSACIONES_META_INCLUIDO es 100 / 220 / 500 y BYOC 2.000', () => {
    expect(CONVERSACIONES_META_INCLUIDO).toEqual({ impulso: 100, crecimiento: 220, pro: 500, byoc: 2000 });
  });

  it('el resto de los límites no depende de la tarifa', () => {
    for (const p of ['impulso', 'crecimiento', 'pro', 'byoc'] as const) {
      const { conversaciones: _a, ...estandar } = limitesDe(p, 'estandar');
      const { conversaciones: _b, ...metaIncluido } = limitesDe(p, 'meta_incluido');
      expect(estandar, p).toEqual(metaIncluido);
    }
  });

  it('la tarifa que no es válida (un .mjs sin tipos) cae en los límites MENORES, nunca en los mayores', () => {
    const sin = limitesDe as unknown as (plan: unknown, tarifa?: unknown) => ReturnType<typeof limitesDe>;
    for (const t of [undefined, null, 'gratis', 3]) {
      expect(sin('pro', t).conversaciones, String(t)).toBe(500);
      expect(sin('impulso', t).conversaciones, String(t)).toBe(100);
    }
  });

  it('un plan que no existe da el más chico CON LA TARIFA PEDIDA', () => {
    expect(limitesDe('basico', 'estandar').conversaciones).toBe(200);
    expect(limitesDe('basico', 'meta_incluido').conversaciones).toBe(100);
  });
});

// -----------------------------------------------------------------------------
describe('LIMITESDE SIN TARIFA NO COMPILA (el compilador marca a todos los llamadores)', () => {
  const SRC = join(aqui, '..', '..', 'functions', 'src');
  const IMPORTE = `import { limitesDe } from './central/cuenta/planes.js';\n`;
  const CASOS: Record<string, string> = {
    // El caso de control: con la tarifa, cero errores. Si falla, el resto no prueba nada.
    con_tarifa: `${IMPORTE}export const l = limitesDe('pro', 'estandar');`,
    con_tarifa_de_la_cuenta: `${IMPORTE}import { tarifaDe } from './central/cuenta/planes.js';\n`
      + `export const l = (c: Record<string, unknown>) => limitesDe(c['plan'], tarifaDe(c));`,
    sin_tarifa: `${IMPORTE}export const l = limitesDe('pro');`,
    tarifa_inventada: `${IMPORTE}export const l = limitesDe('pro', 'gratis');`,
    tarifa_undefined: `${IMPORTE}export const l = limitesDe('pro', undefined);`,
  };
  const rutaVirtual = (nombre: string) => join(SRC, `__tarifa_virtual_${nombre}.ts`);
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

  it('con la tarifa (la de la cuenta, o una literal) hay 0 errores: el caso de control', () => {
    expect(diagnosticos['con_tarifa']).toEqual([]);
    expect(diagnosticos['con_tarifa_de_la_cuenta']).toEqual([]);
  });

  it('sin la tarifa da un error que dice que faltan argumentos', () => {
    expect(diagnosticos['sin_tarifa']?.join('\n')).toMatch(/Expected 2 arguments, but got 1/);
  });

  it('con una tarifa inventada o con undefined tampoco compila', () => {
    expect(diagnosticos['tarifa_inventada']?.length).toBeGreaterThan(0);
    expect(diagnosticos['tarifa_undefined']?.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
describe('LA CUENTA SIN TARIFA CON LA COPIA DE 100 (Bellido): nada cambia', () => {
  it('NO pasa a 200: los límites que rigen son los de la copia, 100', () => {
    expect(limitesDeCuenta(IMPULSO_COPIA_100)).toMatchObject({ conversaciones: 100, origen: 'cuenta' });
    expect(limitesDeCuenta(IMPULSO_COPIA_100).conversaciones).not.toBe(PLANES.impulso.conversaciones);
  });

  it('NO pasa a 200 al renovar: renovar el mismo plan no trae copia nueva, y el servicio sigue incluyendo 100', () => {
    for (const meses of [1, 3, MESES_MAXIMO]) {
      const tras = aplicarPago(IMPULSO_COPIA_100, { tipo: 'mensualidad', plan: 'impulso', meses }, AHORA);
      expect(tras.plan).toBe('impulso');
      // El pago no devuelve límites: la copia de la cuenta no se reescribe.
      expect(Object.keys(tras)).not.toContain('limites');
      const despues = { ...IMPULSO_COPIA_100, plan: tras.plan, periodoPagado: tras.periodoPagado };
      expect(estadoDeServicio(despues, 0, AHORA).incluidas, `${meses} meses`).toBe(100);
    }
    // Y una copia que se pidiera sin cambiar de plan queda como estaba.
    expect(copiaDeLimites(IMPULSO_COPIA_100, {}).limites).toEqual(IMPULSO_COPIA_100.limites);
  });

  it('AL CAMBIAR A CRECIMIENTO RECIBE 220, NO 500', () => {
    const copia = copiaDeLimites(IMPULSO_COPIA_100, { plan: 'crecimiento' });
    expect(copia.limites['conversaciones']).toBe(220);
    expect(copia.limites['conversaciones']).not.toBe(500);
    expect(copia.delPlan.conversaciones).toBe(220);
    expect(copiaDeLimites(IMPULSO_COPIA_100, { plan: 'pro' }).limites['conversaciones']).toBe(500);
    expect(copiaDeLimites(IMPULSO_COPIA_100, { plan: 'impulso' }).limites['conversaciones']).toBe(100);
  });

  it('el aviso del 80 % sale a las 80 conversaciones, no a las 160', () => {
    expect(avisoDeConsumo(IMPULSO_COPIA_100, 79, '2026-10')).toBeNull();
    expect(avisoDeConsumo(IMPULSO_COPIA_100, 80, '2026-10')).toMatchObject({ limite: 100, conversaciones: 80 });
  });

  it('la consola le pinta 100 / 220 / 500, no 200 / 500 / 1.000', () => {
    const pinta = (p: 'impulso' | 'crecimiento' | 'pro') => planDeLaCuenta(IMPULSO_COPIA_100, p).conversaciones;
    expect([pinta('impulso'), pinta('crecimiento'), pinta('pro')]).toEqual([100, 220, 500]);
  });

  it('con la tarifa ESTÁNDAR sí recibe 500 al cambiar a Crecimiento, y la consola pinta 200 / 500 / 1.000', () => {
    const estandar = { ...IMPULSO_COPIA_100, tarifa: 'estandar' };
    expect(copiaDeLimites(estandar, { plan: 'crecimiento' }).limites['conversaciones']).toBe(500);
    expect(copiaDeLimites(estandar, { plan: 'pro' }).limites['conversaciones']).toBe(1000);
    // La copia sigue mandando mientras no se cambie de plan: la tarifa no reescribe nada sola.
    expect(limitesDeCuenta(estandar).conversaciones).toBe(100);
    const pinta = (p: 'impulso' | 'crecimiento' | 'pro') => planDeLaCuenta(estandar, p).conversaciones;
    expect([pinta('impulso'), pinta('crecimiento'), pinta('pro')]).toEqual([200, 500, 1000]);
  });

  it('un cambio de plan NO cambia la tarifa de la cuenta por su cuenta, y pedirla distinta la usa', () => {
    expect(copiaDeLimites({ plan: 'impulso', tarifa: 'meta_incluido' }, { plan: 'pro' }).limites['conversaciones']).toBe(500);
    expect(copiaDeLimites({ plan: 'impulso', tarifa: 'estandar' }, { plan: 'pro' }).limites['conversaciones']).toBe(1000);
    expect(copiaDeLimites({ plan: 'impulso' }, { plan: 'pro', tarifa: 'estandar' }).limites['conversaciones']).toBe(1000);
    expect(copiaDeLimites({ plan: 'impulso', tarifa: 'estandar' }, { plan: 'pro', tarifa: 'meta_incluido' })
      .limites['conversaciones']).toBe(500);
  });

  it('una cuenta SIN copia y SIN tarifa rige el plan con Meta incluido (100 / 220 / 500), no el catálogo estándar', () => {
    expect(limitesDeCuenta({ plan: 'impulso' })).toMatchObject({ conversaciones: 100, origen: 'plan' });
    expect(limitesDeCuenta({ plan: 'crecimiento' })).toMatchObject({ conversaciones: 220, origen: 'plan' });
    expect(limitesDeCuenta({ plan: 'pro' })).toMatchObject({ conversaciones: 500, origen: 'plan' });
    expect(limitesDeCuenta({ plan: 'pro', tarifa: 'estandar' })).toMatchObject({ conversaciones: 1000, origen: 'plan' });
  });

  it('IDÉNTICA CAMPO POR CAMPO: lo que el código dice de cada cuenta sin tarifa es lo que decía antes', () => {
    const antes = JSON.parse(readFileSync(join(aqui, 'tarifa-antes.json'), 'utf8')) as Record<string, unknown>;
    // Que la foto de antes cubra todas las cuentas sintéticas (si se agrega una, hay que volver a sacarla).
    expect(Object.keys(antes).sort()).toEqual(Object.keys(CUENTAS_SIN_TARIFA).sort());
    const ahora = JSON.parse(JSON.stringify(fotoDeTodas())) as Record<string, unknown>;
    for (const nombre of Object.keys(antes)) {
      expect(ahora[nombre], nombre).toEqual(antes[nombre]);
    }
  });

  it('la foto de antes es de verdad la de las cuentas con la copia de 100 (si no, la prueba de arriba no probaría nada)', () => {
    const antes = JSON.parse(readFileSync(join(aqui, 'tarifa-antes.json'), 'utf8')) as Record<string, {
      limitesDeCuenta: { conversaciones: number }; estadoDeServicio: { incluidas: number };
      cambiarACrecimiento: { limites: { conversaciones: number } };
    }>;
    expect(antes['impulso_prueba_copia_100']?.limitesDeCuenta.conversaciones).toBe(100);
    expect(antes['impulso_produccion_copia_100']?.estadoDeServicio.incluidas).toBe(100);
    expect(antes['impulso_produccion_copia_100']?.cambiarACrecimiento.limites.conversaciones).toBe(220);
    expect(antes['crecimiento_sin_copia']?.limitesDeCuenta.conversaciones).toBe(220);
  });
});

// -----------------------------------------------------------------------------
describe('Las altas nuevas nacen con la tarifa estándar', () => {
  it('cuentaInicial lleva tarifa estandar, el plan más chico y 200 conversaciones en la copia', () => {
    const c = cuentaInicial();
    expect(c.tarifa).toBe('estandar');
    expect(c.plan).toBe('impulso');
    expect(c.limites.conversaciones).toBe(200);
    expect(limitesDeCuenta(c)).toMatchObject({ conversaciones: 200, origen: 'cuenta' });
    expect(tarifaDe(c)).toBe('estandar');
  });

  it('una alta SIN el campo tarifa tendría 100: por eso el campo se escribe en el alta', () => {
    const { tarifa: _t, ...sinCampo } = cuentaInicial();
    expect(tarifaDe(sinCampo)).toBe('meta_incluido');
    // La copia ya trae 200 (la escribió el alta): el campo faltante solo afectaría al cambiar de plan.
    expect(copiaDeLimites(sinCampo, { plan: 'crecimiento' }).limites['conversaciones']).toBe(220);
    expect(copiaDeLimites(cuentaInicial(), { plan: 'crecimiento' }).limites['conversaciones']).toBe(500);
  });

  it('cada alta devuelve un objeto propio: modificarlo no toca el siguiente', () => {
    const a = cuentaInicial();
    a.limites.conversaciones = 1;
    expect(cuentaInicial().limites.conversaciones).toBe(200);
  });
});

// -----------------------------------------------------------------------------
describe('BYOC: el contrato de volumen excepcional no se publica y no se toca', () => {
  it('el plan byoc sigue en el catálogo con USD 50 por 2.000, con las dos tarifas', () => {
    expect(esPlanVendible('byoc')).toBe(true);
    expect(PLANES.byoc).toMatchObject({ nombre: 'BYOC', precioUsd: 50, conversaciones: 2000 });
    expect(limitesDe('byoc', 'estandar').conversaciones).toBe(2000);
    expect(limitesDe('byoc', 'meta_incluido').conversaciones).toBe(2000);
    expect(CONVERSACIONES_META_INCLUIDO.byoc).toBe(2000);
  });

  it('NO se publica: no está entre los planes del sitio', () => {
    expect(PLANES_PUBLICADOS).toEqual(['impulso', 'crecimiento', 'pro']);
    expect((PLANES_PUBLICADOS as readonly string[]).includes('byoc')).toBe(false);
  });

  it('un contrato de volumen (1.500 por USD 60) se escribe como siempre, por contrato, sobre cualquier tarifa', () => {
    for (const tarifa of ['estandar', 'meta_incluido'] as const) {
      const cuenta = { plan: 'byoc', tarifa };
      const copia = copiaDeLimites(cuenta, { conversaciones: 1500 });
      expect(copia.limites['conversaciones'], tarifa).toBe(1500);
      expect(copia.porContrato).toEqual(['conversaciones']);
      const tras = { ...cuenta, limites: copia.limites, limitesPorContrato: copia.porContrato, precioPorContrato: 60 };
      expect(limitesDeCuenta(tras).conversaciones, tarifa).toBe(1500);
      expect(planDeLaCuenta(tras, 'pro').precioUsd).toBe(60);
      // Cambiar de plan conserva el contrato, sea cual sea la tarifa.
      expect(copiaDeLimites(tras, { plan: 'byoc' }).limites['conversaciones'], tarifa).toBe(1500);
    }
  });
});

// -----------------------------------------------------------------------------
describe('El regalo de un pago de 6 meses son 30 conversaciones', () => {
  it('la constante propia vale 30', () => {
    expect(REGALO_SEIS_MESES_CONVERSACIONES).toBe(30);
  });

  it('un pago de 6 meses acredita 30 a la bolsa, con cualquier plan y cualquier tarifa de la cuenta', () => {
    for (const tarifa of [undefined, 'estandar', 'meta_incluido']) {
      for (const plan of ['impulso', 'crecimiento', 'pro', 'byoc'] as const) {
        const cuenta = { plan, modalidad: 'prepago', periodoPagado: '2026-10', bolsa: 7, ...(tarifa ? { tarifa } : {}) };
        const tras = aplicarPago(cuenta, { tipo: 'mensualidad', plan, meses: MESES_MAXIMO }, AHORA);
        expect(tras.bolsa - 7, `${plan}/${String(tarifa)}`).toBe(REGALO_SEIS_MESES_CONVERSACIONES);
      }
    }
  });

  it('y un pago de 5 meses NO regala nada', () => {
    const cuenta = { plan: 'pro', modalidad: 'prepago', periodoPagado: '2026-10', bolsa: 7 };
    expect(aplicarPago(cuenta, { tipo: 'mensualidad', plan: 'pro', meses: MESES_MAXIMO - 1 }, AHORA).bolsa).toBe(7);
  });
});
