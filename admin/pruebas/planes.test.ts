/**
 * Pruebas del catálogo de planes y del aviso de consumo al 80 %
 * (`functions/src/planes.ts`, decisiones de Andres del 15/09/2026; los tres
 * ejes de la cuenta, F1 del 25/09/2026, `Analisis/41` §4).
 *
 * NO NECESITAN EMULADOR: `planes.ts` es puro. La prueba de punta a punta del
 * aviso, con la ingesta real y el emulador, está en `aviso-consumo.test.ts`.
 *
 * Se escriben NEGANDO donde importa: un plan inventado NO es un plan, un
 * comercio sin copia de límites NO recibe más que su plan, y el aviso NO sale
 * dos veces en el mes. Desde F1, además: «demostracion» NO es un plan, y
 * ningún plan dice quién paga Meta (`pruebas/central/ejes.test.ts` fija el
 * resto de los ejes).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AVISO_CONSUMO, BOLSA, CATALOGO_PLANES, INSTALACION_USD, LIMITE_MAXIMO, PLANES, PLANES_ASIGNABLES,
  PLANES_PUBLICADOS, PLAN_DEMOSTRACION, PLAN_POR_DEFECTO, avisoConsumoPendiente, avisoDeConsumo,
  esIdPlan, esPlanVendible, limitesDe, limitesDeCuenta, planQuePuedePedir, umbralDeAviso,
} from '../functions/src/planes.ts';

const MES = '2026-10';

describe('El catálogo', () => {
  it('son los números que publica el sitio (verificados el 15/09/2026), más los cambios incluidos de F1', () => {
    expect(PLANES).toEqual({
      impulso: {
        nombre: 'Impulso', precioUsd: 25, conversaciones: 100, productos: 20, agendas: 1,
        campanas: 0, cambiosIncluidos: 0,
      },
      crecimiento: {
        nombre: 'Crecimiento', precioUsd: 50, conversaciones: 220, productos: 100, agendas: 5,
        campanas: 3, cambiosIncluidos: 1,
      },
      pro: {
        nombre: 'Pro', precioUsd: 90, conversaciones: 500, productos: 500, agendas: 10,
        campanas: 10, cambiosIncluidos: 2,
      },
      byoc: {
        nombre: 'BYOC', precioUsd: 50, conversaciones: 2000, productos: 500, agendas: 10,
        campanas: 10, cambiosIncluidos: 2,
      },
    });
    expect(BOLSA).toEqual({ conversaciones: 30, precioUsd: 10 });
    expect(INSTALACION_USD).toBe(65);
    expect(AVISO_CONSUMO).toBe(0.8);
    expect(CATALOGO_PLANES).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('coincide con la «Base comercial» (docs/base-comercial.md)', () => {
    // Hasta el 26/09/2026 la base comercial vivía en CLAUDE.md; F6 la movió
    // textual a docs/base-comercial.md y CLAUDE.md quedó con los invariantes.
    // La regla no cambia: el catálogo tiene que decir lo mismo que el documento
    // que rige el dinero, y esta prueba es la que lo comprueba.
    const aqui = dirname(fileURLToPath(import.meta.url));
    const claude = readFileSync(join(aqui, '..', '..', 'docs', 'base-comercial.md'), 'utf8');
    const planes = claude.match(/Planes: USD (\d+) \/ (\d+) \/ (\d+) por (\d+) \/ (\d+) \/ (\d+) conversaciones/);
    expect(planes, 'docs/base-comercial.md ya no enuncia los planes con la misma frase').not.toBeNull();
    const [, p1, p2, p3, c1, c2, c3] = (planes ?? []).map(Number);
    expect([PLANES.impulso.precioUsd, PLANES.crecimiento.precioUsd, PLANES.pro.precioUsd]).toEqual([p1, p2, p3]);
    expect([PLANES.impulso.conversaciones, PLANES.crecimiento.conversaciones, PLANES.pro.conversaciones])
      .toEqual([c1, c2, c3]);

    // La frase cruza un salto de línea en el documento: `\s+` y no un espacio.
    const bolsa = claude.match(/bolsa\s+de \*\*(\d+) conversaciones por USD (\d+)\*\*/);
    expect(bolsa).not.toBeNull();
    expect([BOLSA.conversaciones, BOLSA.precioUsd]).toEqual([Number(bolsa?.[1]), Number(bolsa?.[2])]);

    const instalacion = claude.match(/Instalación USD (\d+)/);
    expect(Number(instalacion?.[1])).toBe(INSTALACION_USD);

    const agendas = claude.match(/Agendas por plan: (\d+) \/ (\d+) \/ hasta (\d+)/);
    expect(agendas).not.toBeNull();
    expect([PLANES.impulso.agendas, PLANES.crecimiento.agendas, PLANES.pro.agendas])
      .toEqual([Number(agendas?.[1]), Number(agendas?.[2]), Number(agendas?.[3])]);
  });

  it('el plan de entrada cabe exacto en la franquicia de Meta (100 × 10 = 1.000)', () => {
    expect(PLANES.impulso.conversaciones * 10).toBe(1000);
  });

  it('«demostracion» YA NO ES UN PLAN (F1): lo asignable es el catálogo y nada más', () => {
    // Hasta el 25/09 acá vivía `PLAN_DEMOSTRACION` con los límites de Pro y
    // precio cero. Un demo es ahora modalidad `demostracion` con cualquier
    // plan (`prepago.ts`); lo que queda es un puente nulo para la consola.
    expect(PLAN_DEMOSTRACION).toBeNull();
    expect(Object.keys(PLANES)).not.toContain('demostracion');
    expect(PLANES_ASIGNABLES).toBe(PLANES);
    expect(Object.keys(PLANES_ASIGNABLES).sort()).toEqual(['byoc', 'crecimiento', 'impulso', 'pro']);
  });

  it('BYOC se puede contratar y pagar, pero NO se publica', () => {
    // Está en el catálogo —un pago de mensualidad solo acepta planes de acá—
    // pero fuera de la escalera del sitio: su precio no se compara de frente
    // con los publicados porque no incluye el consumo de Meta (`Analisis/39`).
    expect(esPlanVendible('byoc')).toBe(true);
    expect(PLANES_PUBLICADOS).toEqual(['impulso', 'crecimiento', 'pro']);
    expect(PLANES_PUBLICADOS).not.toContain('byoc');
  });

  it('ningún plan dice quién le paga a Meta (F1): eso es la titularidad de cada número', () => {
    // `byoc.pagaMeta` se fue con los ejes: un comercio puede tener un número
    // propio y otro provisto, y la franquicia de Meta es por número
    // (`rutasWhatsApp/{n}.titularidad`, `central/ejes.ts`).
    for (const [id, p] of Object.entries(PLANES)) {
      expect(Object.prototype.hasOwnProperty.call(p, 'pagaMeta'), id).toBe(false);
    }
  });

  it('el tope de BYOC es el que se fijó contra el modelo que corre', () => {
    // 2.000 conversaciones salen de `Analisis/39` §2 CON GEMINI. Con Haiku 4.5
    // el equilibrio cae a 1.542 y con Sonnet 5 a 771: si algún día se cambia el
    // modelo de un comercio BYOC (`tenants/{t}.modelo`), esta cuenta se rehace ANTES.
    expect(PLANES.byoc.conversaciones).toBe(2000);
    expect(PLANES.byoc.precioUsd).toBe(50);
  });

  it('el respaldo es el plan más chico', () => {
    expect(PLAN_POR_DEFECTO).toBe('impulso');
    for (const p of Object.values(PLANES)) {
      expect(p.conversaciones).toBeGreaterThanOrEqual(PLANES[PLAN_POR_DEFECTO].conversaciones);
      expect(p.productos).toBeGreaterThanOrEqual(PLANES[PLAN_POR_DEFECTO].productos);
      expect(p.agendas).toBeGreaterThanOrEqual(PLANES[PLAN_POR_DEFECTO].agendas);
      expect(p.cambiosIncluidos).toBeGreaterThanOrEqual(PLANES[PLAN_POR_DEFECTO].cambiosIncluidos);
    }
  });
});

describe('Identificadores de plan', () => {
  it('acepta los cuatro del catálogo, con la guarda del servidor y con el puente de la consola', () => {
    for (const id of ['impulso', 'crecimiento', 'pro', 'byoc']) {
      expect(esPlanVendible(id), id).toBe(true);
      expect(esIdPlan(id), id).toBe(true);
    }
  });

  it('NO acepta planes inventados, viejos, el plan de demostración, con mayúsculas ni propiedades heredadas', () => {
    for (const id of ['basico', 'base', 'corporativo', 'demostracion', 'Pro', 'pro ', '', 'toString', '__proto__',
      'constructor', 'hasOwnProperty']) {
      expect(esPlanVendible(id), id).toBe(false);
      expect(esIdPlan(id), id).toBe(false);
    }
    for (const v of [null, undefined, 3, {}, ['pro']]) {
      expect(esPlanVendible(v)).toBe(false);
      expect(esIdPlan(v)).toBe(false);
    }
  });

  it('limitesDe da los del plan (con los cambios incluidos), y los del más chico si el plan no existe', () => {
    expect(limitesDe('crecimiento')).toEqual({ conversaciones: 220, productos: 100, agendas: 5, cambiosIncluidos: 1 });
    expect(limitesDe('basico')).toEqual({ conversaciones: 100, productos: 20, agendas: 1, cambiosIncluidos: 0 });
    // El plan viejo de los demos es hoy un plan desconocido: el más chico.
    expect(limitesDe('demostracion')).toEqual(limitesDe('impulso'));
    expect(limitesDe(undefined)).toEqual(limitesDe('impulso'));
    expect(limitesDe('toString')).toEqual(limitesDe('impulso'));
  });

  it('limitesDe devuelve una copia: modificarla no toca el catálogo', () => {
    const l = limitesDe('pro');
    l.conversaciones = 1;
    expect(PLANES.pro.conversaciones).toBe(500);
  });
});

describe('Los límites que rigen para una cuenta', () => {
  it('manda la copia guardada, aunque el catálogo diga otra cosa', () => {
    // Un comercio que contrató Crecimiento cuando incluía 200 conserva 200.
    const cuenta = { plan: 'crecimiento', limites: { conversaciones: 200, productos: 80, agendas: 4, cambiosIncluidos: 3 } };
    expect(limitesDeCuenta(cuenta)).toEqual({ conversaciones: 200, productos: 80, agendas: 4, cambiosIncluidos: 3, origen: 'cuenta' });
  });

  it('sin copia (comercio viejo), rigen los del plan', () => {
    expect(limitesDeCuenta({ plan: 'pro' })).toEqual({ ...limitesDe('pro'), origen: 'plan' });
  });

  it('sin copia y con un plan que no es del catálogo, NO recibe más que Impulso', () => {
    expect(limitesDeCuenta({ plan: 'basico' })).toEqual({ ...limitesDe('impulso'), origen: 'respaldo' });
    expect(limitesDeCuenta({ plan: 'demostracion' })).toEqual({ ...limitesDe('impulso'), origen: 'respaldo' });
    expect(limitesDeCuenta(undefined)).toEqual({ ...limitesDe('impulso'), origen: 'respaldo' });
    expect(limitesDeCuenta({})).toEqual({ ...limitesDe('impulso'), origen: 'respaldo' });
  });

  it('un límite corrupto en la copia se reemplaza por el del plan, uno por uno', () => {
    const cuenta = {
      plan: 'crecimiento',
      limites: { conversaciones: 220, productos: 'cien', agendas: LIMITE_MAXIMO + 1 },
    };
    expect(limitesDeCuenta(cuenta)).toEqual({ conversaciones: 220, productos: 100, agendas: 5, cambiosIncluidos: 1, origen: 'plan' });
    // Cero, negativo y fracciones tampoco son límites.
    const raro = { plan: 'basico', limites: { conversaciones: 0, productos: -3, agendas: 1.5 } };
    expect(limitesDeCuenta(raro)).toEqual({ ...limitesDe('impulso'), origen: 'respaldo' });
  });

  it('una copia anterior a F1 (sin cambiosIncluidos) sigue siendo «de la cuenta», y los cambios salen del plan', () => {
    const vieja = { plan: 'pro', limites: { conversaciones: 500, productos: 500, agendas: 10 } };
    expect(limitesDeCuenta(vieja)).toEqual({ conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2, origen: 'cuenta' });
  });
});

describe('El aviso de consumo al 80 %', () => {
  it('el umbral es 80 / 176 / 400 conversaciones, sin error de coma flotante', () => {
    expect(umbralDeAviso(100)).toBe(80);
    expect(umbralDeAviso(220)).toBe(176);
    expect(umbralDeAviso(500)).toBe(400);
    expect(umbralDeAviso(30)).toBe(24);
  });

  it('con 79 de 100 NO avisa; con 80, sí', () => {
    const cuenta = { plan: 'impulso', limites: limitesDe('impulso') };
    expect(avisoDeConsumo(cuenta, 79, MES)).toBeNull();
    expect(avisoDeConsumo(cuenta, 80, MES)).toEqual({ mes: MES, umbral: 0.8, conversaciones: 80, limite: 100 });
  });

  it('avisa UNA vez: con el aviso del mes anotado, 81 y 100 ya no avisan', () => {
    const cuenta = {
      plan: 'impulso', limites: limitesDe('impulso'),
      avisoConsumo: { mes: MES, umbral: 0.8, conversaciones: 80, limite: 100 },
    };
    expect(avisoConsumoPendiente(cuenta, MES)).toBe(false);
    expect(avisoDeConsumo(cuenta, 81, MES)).toBeNull();
    expect(avisoDeConsumo(cuenta, 100, MES)).toBeNull();
    expect(avisoDeConsumo(cuenta, 150, MES)).toBeNull();
  });

  it('el mes nuevo vuelve a poder avisar', () => {
    const cuenta = {
      plan: 'impulso', limites: limitesDe('impulso'),
      avisoConsumo: { mes: '2026-09', umbral: 0.8, conversaciones: 80, limite: 100 },
    };
    expect(avisoConsumoPendiente(cuenta, MES)).toBe(true);
    expect(avisoDeConsumo(cuenta, 79, MES)).toBeNull();
    expect(avisoDeConsumo(cuenta, 80, MES)).toMatchObject({ mes: MES, conversaciones: 80 });
  });

  it('un comercio sin copia de límites se mide contra su plan', () => {
    expect(avisoDeConsumo({ plan: 'crecimiento' }, 175, MES)).toBeNull();
    expect(avisoDeConsumo({ plan: 'crecimiento' }, 176, MES)).toMatchObject({ limite: 220 });
    // Y uno con el viejo 'basico', contra Impulso: al 80 de 100, no al 400 de Pro.
    expect(avisoDeConsumo({ plan: 'basico' }, 80, MES)).toMatchObject({ limite: 100 });
    // Una cuenta que ni existe también es Impulso.
    expect(avisoDeConsumo(undefined, 80, MES)).toMatchObject({ limite: 100 });
  });

  it('se mide contra la copia, no contra el catálogo', () => {
    const cuenta = { plan: 'crecimiento', limites: { conversaciones: 200, productos: 100, agendas: 5 } };
    expect(avisoDeConsumo(cuenta, 160, MES)).toMatchObject({ limite: 200, conversaciones: 160 });
  });

  it('un demo avisa al 80 % de SU plan (F1): con Pro, a las 400', () => {
    const demo = { plan: 'pro', modalidad: 'demostracion', limites: limitesDe('pro') };
    expect(avisoDeConsumo(demo, 399, MES)).toBeNull();
    expect(avisoDeConsumo(demo, 400, MES)).toMatchObject({ limite: 500 });
  });

  it('si los límites bajaron a mitad de mes y ya estaba por encima, avisa con la siguiente', () => {
    expect(avisoDeConsumo({ plan: 'impulso', limites: limitesDe('impulso') }, 150, MES))
      .toMatchObject({ conversaciones: 150, limite: 100 });
  });

  it('un conteo que no es número no avisa', () => {
    expect(avisoDeConsumo({ plan: 'impulso' }, Number.NaN, MES)).toBeNull();
    expect(avisoDeConsumo({ plan: 'impulso' }, Number.POSITIVE_INFINITY, MES)).toBeNull();
  });

  it('una marca corrupta no bloquea el aviso', () => {
    expect(avisoConsumoPendiente({ avisoConsumo: 'sí' }, MES)).toBe(true);
    expect(avisoConsumoPendiente({ avisoConsumo: null }, MES)).toBe(true);
  });
});

describe('Qué plan puede pagarse un comercio por su cuenta', () => {
  it('los publicados, desde cualquier plan', () => {
    for (const p of PLANES_PUBLICADOS) {
      expect(planQuePuedePedir('impulso', p)).toBe(true);
      expect(planQuePuedePedir(undefined, p)).toBe(true);
    }
  });
  it('BYOC solo para renovarlo quien ya lo tiene: nunca para pasarse a él', () => {
    expect(planQuePuedePedir('byoc', 'byoc')).toBe(true);
    for (const actual of ['impulso', 'crecimiento', 'pro', 'demostracion', undefined, null, 'BYOC']) {
      expect(planQuePuedePedir(actual, 'byoc')).toBe(false);
    }
  });
  it('ni el plan viejo de demostración ni algo que no es un plan', () => {
    expect(planQuePuedePedir('demostracion', 'demostracion')).toBe(false);
    expect(planQuePuedePedir('toString', 'toString')).toBe(false);
  });
});
