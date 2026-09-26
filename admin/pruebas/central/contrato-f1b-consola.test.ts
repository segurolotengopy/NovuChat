/**
 * F1b — LA CONSOLA DICE LO QUE VA POR CONTRATO, Y LO QUE COBRA ES LO MISMO QUE
 * COBRA EL SERVIDOR.
 *
 * Lo que estas pruebas defienden:
 *  1. NEGOCIOS dice el origen de las conversaciones y del precio («por
 *     contrato (el plan trae / cuesta …)» o «las del plan / el del plan») y la
 *     prueba con su primer y su último mes; fuera de modalidad prueba, no
 *     ofrece fijarla. Los topes de los campos son los del servidor.
 *  2. NADA SE ESCRIBE DESDE EL NAVEGADOR: la página manda cada campo por
 *     `actualizarEstadoCuenta` (`CALLABLES.cuenta`).
 *  3. LO QUE EL COMERCIO VE Y LO QUE PREVISUALIZA EL PROPIETARIO es el precio
 *     del contrato: Cuenta, Pagar y el pago manual usan `montoUsdDe` con la
 *     cuenta, la misma función que emite el QR.
 *
 * Se dibuja con `renderToStaticMarkup`, sin DOM ni emulador. Tenants ficticios.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PanelEjes } from '../../web/src/plataforma/componentes/PanelEjes';
import { EjesDeLaCuenta } from '../../web/src/central/componentes/EjesDeLaCuenta';
import { MODELO_POR_DEFECTO, origenPorContrato, pruebaDeCuenta, type EjesDeCuenta } from '../../web/src/lib/ejes';
import { planDeLaCuenta, vistaDelPedido } from '../../web/src/lib/pagar';
import { pagosEnRevision, vistaDelPagoManual } from '../../web/src/plataforma/lib/negocios';
import { LIMITE_MAXIMO, MAXIMO_PRECIO_POR_CONTRATO_USD, limitesDe } from '../../functions/src/planes';
import { BOLSA_PRUEBA_MAXIMA } from '../../functions/src/prepago';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', '..', ruta), 'utf8');
const desdeWeb = createRequire(join(aqui, '..', '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const dibujar = (c: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(c, props));

/** 15/10/2026 a las 12:00 de Bolivia. */
const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);
const nada = () => undefined;
const acciones = {
  onPlan: nada, onModalidad: nada, onTitularidad: nada, onModelo: nada, onUmbrales: nada, onCambio: nada,
  onCambiosIncluidos: nada, onConversaciones: nada, onPrecio: nada, onPrueba: nada,
};
const CON_CONTRATO = {
  plan: 'pro', modalidad: 'prepago', precioPorContrato: 120,
  limites: { ...limitesDe('pro'), conversaciones: 800 }, limitesPorContrato: ['conversaciones'],
};
const ejesCon = (limites: Partial<EjesDeCuenta['limites']>, extra: Partial<EjesDeCuenta> = {}): EjesDeCuenta => ({
  tenantId: 'f1b-consola', plan: 'pro',
  limites: { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2, origen: 'cuenta', ...limites },
  modalidad: 'prepago', modalidadExplicita: true, modelo: MODELO_POR_DEFECTO, numeros: [],
  cambios: { mes: '2026-10', usados: 0, incluidos: 2, restantes: 2, ilimitado: false },
  ...extra,
});
const panel = (cuenta: Record<string, unknown>, ejes: EjesDeCuenta, extra: Record<string, unknown> = {}) => dibujar(PanelEjes, {
  cuenta, ejes, tipoCambio: null, ahoraMs: AHORA, ocupado: false, ...acciones, ...extra,
});

describe('Negocios: las conversaciones y el precio con su origen', () => {
  const ejes = ejesCon({ conversaciones: 800, porContrato: ['conversaciones'], conversacionesDelPlan: 500, cambiosIncluidosDelPlan: 2 });

  it('por contrato: lo dice con lo que trae el plan, y el precio de la lista queda marcado como lista', () => {
    expect(origenPorContrato(ejes, 'conversaciones')).toBe('contrato');
    const html = panel(CON_CONTRATO, ejes);
    expect(html).toContain('<strong>800</strong> conversaciones incluidas al mes');
    expect(html).toContain('por contrato (el plan trae 500)');
    expect(html).toContain('<strong>USD 120</strong> al mes');
    expect(html).toContain('por contrato (el plan cuesta USD 90)');
    expect(html).toContain('USD 90 al mes<span class="text-muted"> de lista</span>');
    expect(html).toMatch(/<button[^>]*>Volver al precio del plan<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Volver al precio del plan<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Volver a las del plan<\/button>/);
    // El mismo precio ya por contrato no es un cambio.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Fijar el precio por contrato<\/button>/);
  });

  it('del plan: lo dice, y «volver» nace deshabilitado; ninguna acción empieza confirmando', () => {
    const html = panel({ plan: 'pro', modalidad: 'prepago' }, ejesCon({ porContrato: [], conversacionesDelPlan: 500 }));
    expect(html).toContain('· las del plan</span>');
    expect(html).toContain('· el del plan</span>');
    expect(html).not.toContain(' de lista</span>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Volver al precio del plan<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Volver a las del plan<\/button>/);
    expect(html).not.toContain('¿Confirmar?');
  });

  it('los topes de los campos son los del servidor', () => {
    const html = panel(CON_CONTRATO, ejes);
    expect(html).toMatch(new RegExp(`<input id="eje-conversaciones"[^>]*max="${LIMITE_MAXIMO}"`));
    expect(html).toMatch(new RegExp(`<input id="eje-precio"[^>]*max="${MAXIMO_PRECIO_POR_CONTRATO_USD}"`));
  });

  it('una página que no conecta las acciones nuevas solo muestra: los botones nacen deshabilitados', () => {
    const html = panel(CON_CONTRATO, ejes, { onConversaciones: undefined, onPrecio: undefined, onPrueba: undefined });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Volver al precio del plan<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Fijar las conversaciones por contrato<\/button>/);
  });
});

describe('Negocios: la prueba por contrato', () => {
  const EXTENDIDA = { plan: 'pro', modalidad: 'prueba', periodoPrueba: '2026-11', pruebaDesde: '2026-10', bolsaPrueba: 7 };

  it('en prueba: dice de qué mes a qué mes y cuánto queda, y el mes no puede ser anterior al en curso', () => {
    expect(pruebaDeCuenta(EXTENDIDA)).toEqual({ desde: '2026-10', hasta: '2026-11', bolsa: 7 });
    const html = panel(EXTENDIDA, ejesCon({ porContrato: [] }, { modalidad: 'prueba' }));
    expect(html).toContain('De <strong>2026-10</strong> a <strong>2026-11</strong>');
    expect(html).toContain('quedan <strong>7</strong> conversaciones de prueba');
    expect(html).toMatch(/<input id="eje-periodo-prueba" type="month" min="2026-10"/);
    expect(html).toMatch(new RegExp(`<input id="eje-bolsa-prueba"[^>]*max="${BOLSA_PRUEBA_MAXIMA}"`));
    // Sin nada cambiado, «Fijar la prueba» no es un cambio.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Fijar la prueba<\/button>/);
  });

  it('fuera de prueba no ofrece fijarla: lo dice', () => {
    const html = panel({ plan: 'pro', modalidad: 'prepago' }, ejesCon({ porContrato: [] }));
    expect(html).toContain('Solo en modalidad prueba');
    expect(html).not.toContain('eje-periodo-prueba');
  });
});

describe('Negocios: todo va por la callable, nada desde el navegador', () => {
  it('la página manda conversaciones, precio y prueba por `actualizarEstadoCuenta`', () => {
    const pagina = leer('web/src/plataforma/paginas/CuentaNegocio.tsx');
    expect(pagina).toMatch(/onConversaciones=\{\(conversaciones\) => void operar\(CALLABLES\.cuenta, \{ conversaciones \}/);
    expect(pagina).toMatch(/onPrecio=\{\(precioPorContrato\) => void operar\(CALLABLES\.cuenta, \{ precioPorContrato \}/);
    expect(pagina).toMatch(/onPrueba=\{\(prueba\) => void operar\(CALLABLES\.cuenta, \{ \.\.\.prueba \}/);
  });

  it('ni el panel ni la página importan escrituras de Firestore', () => {
    for (const ruta of ['web/src/plataforma/componentes/PanelEjes.tsx', 'web/src/plataforma/paginas/CuentaNegocio.tsx']) {
      expect(leer(ruta), ruta).not.toMatch(/\b(setDoc|updateDoc|addDoc|writeBatch|runTransaction)\b/);
    }
  });
});

describe('Cuenta, Pagar y el pago manual dicen el precio del contrato', () => {
  it('la Cuenta del comercio muestra la mensualidad que manda el servidor, con su origen', () => {
    const conPrecio = ejesCon({ porContrato: [] }, { precio: { mensualUsd: 120, porContrato: 120, delPlanUsd: 90 } });
    const html = dibujar(EjesDeLaCuenta, { ejes: conPrecio, tipoCambio: null, ahoraMs: AHORA });
    expect(html).toContain('USD 120 al mes');
    expect(html).toContain('(precio por contrato)');
    // Un servidor anterior (sin `precio`): la del plan, sin afirmar contrato.
    const viejo = dibujar(EjesDeLaCuenta, { ejes: ejesCon({ porContrato: [] }), tipoCambio: null, ahoraMs: AHORA });
    expect(viejo).toContain('USD 90 al mes');
    expect(viejo).not.toContain('por contrato');
  });

  it('Pagar y el pago manual previsualizan el importe del contrato, no el de la lista', () => {
    const pedido = { tipo: 'mensualidad', plan: 'pro', meses: 2 } as const;
    expect(vistaDelPedido(CON_CONTRATO, pedido, null, AHORA)?.montoUsd).toBe(240);
    expect(vistaDelPagoManual(CON_CONTRATO, pedido, 10, AHORA)).toMatchObject({ montoUsd: 240, montoBs: 2400 });
    expect(vistaDelPedido({ plan: 'pro', modalidad: 'prepago' }, pedido, null, AHORA)?.montoUsd).toBe(180);
    expect(planDeLaCuenta(CON_CONTRATO, 'pro')).toEqual({
      nombre: 'Pro', precioUsd: 120, precioPorContrato: true, conversaciones: 800, conversacionesPorContrato: true,
    });
    expect(planDeLaCuenta({ plan: 'pro' }, 'crecimiento')).toMatchObject({ precioUsd: 50, precioPorContrato: false, conversaciones: 220 });
  });

  it('Pagar usa `planDeLaCuenta` para el renglón del plan, no el precio del catálogo', () => {
    const pagar = leer('web/src/paginas/Pagar.tsx');
    expect(pagar).toContain('planDeLaCuenta(cuenta, planes[0])');
    expect(pagar).not.toMatch(/PLANES\[planes\[0\]\]\.precioUsd/);
  });

  it('un pago en revisión por precio fuera de contrato se lista con su motivo', () => {
    const [p] = pagosEnRevision([{
      id: 'PagoFueraDeContrato001', estado: 'pendiente', tipo: 'mensualidad', plan: 'pro', monto: 1134, montoRecibidoBs: 1134,
      revision: 'precio_distinto', cobro: { estado: 'CONFIRMADO' },
    }]);
    expect(p?.motivo).toBe('precio_distinto');
  });
});
