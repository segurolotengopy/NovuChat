/**
 * NEGOCIOS MUESTRA Y FIJA LOS CAMBIOS INCLUIDOS POR CONTRATO — la pantalla del
 * bloque «copia por contrato» (`copia-por-contrato.test.ts` prueba el servidor).
 *
 * Lo que estas pruebas defienden:
 *  1. EL ORIGEN SE DICE: «por contrato (el plan trae N)» o «los del plan», con
 *     lo que manda `ejesDeCuenta`; si un servidor viejo no lo manda, no se
 *     afirma ninguno.
 *  2. NADA SE ESCRIBE SIN CONFIRMAR, y NADA SE ESCRIBE DESDE EL NAVEGADOR: la
 *     página llama a `actualizarEstadoCuenta` con `cambiosIncluidos` (número o
 *     `null`), que valida, exige al propietario y audita.
 *  3. EL TOPE DEL CAMPO ES EL DEL SERVIDOR (`MAXIMO_CAMBIOS_INCLUIDOS`), no
 *     uno propio.
 *
 * Se dibuja con `renderToStaticMarkup`, sin DOM ni emulador, como
 * `negocios-consola.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PanelEjes } from '../../web/src/plataforma/componentes/PanelEjes';
import { MODELO_POR_DEFECTO, origenDeCambiosIncluidos, type EjesDeCuenta } from '../../web/src/lib/ejes';
import { MAXIMO_CAMBIOS_INCLUIDOS } from '../../functions/src/planes';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', '..', ruta), 'utf8');
const desdeWeb = createRequire(join(aqui, '..', '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const dibujar = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(PanelEjes, props));

const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);
const nada = () => undefined;
const acciones = {
  onPlan: nada, onModalidad: nada, onTitularidad: nada, onModelo: nada, onUmbrales: nada, onCambio: nada, onCambiosIncluidos: nada,
};
const ejesCon = (limites: Partial<EjesDeCuenta['limites']>): EjesDeCuenta => ({
  tenantId: 'contrato-consola', plan: 'pro',
  limites: { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2, origen: 'cuenta', ...limites },
  modalidad: 'prepago', modalidadExplicita: true, modelo: MODELO_POR_DEFECTO, numeros: [],
  cambios: { mes: '2026-10', usados: 1, incluidos: limites.cambiosIncluidos ?? 2, restantes: 1, ilimitado: false },
});
const base = (ejes: EjesDeCuenta) => ({
  cuenta: { modalidad: 'prepago', plan: 'pro' }, ejes, tipoCambio: null, ahoraMs: AHORA, ocupado: false, ...acciones,
});

describe('Negocios: los cambios incluidos con su origen', () => {
  it('por contrato: lo dice, con lo que trae el plan, y ofrece volver a los del plan', () => {
    const html = dibujar(base(ejesCon({ cambiosIncluidos: 4, porContrato: ['cambiosIncluidos'], cambiosIncluidosDelPlan: 2 })));
    expect(html).toContain('<strong>4</strong> cambios incluidos al mes');
    expect(html).toContain('por contrato (el plan trae 2)');
    expect(html).toMatch(/<button[^>]*>Volver a los del plan<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Volver a los del plan<\/button>/);
    // Con el mismo valor ya por contrato, «Fijar» no es un cambio.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Fijar por contrato<\/button>/);
  });

  it('del plan: lo dice; «Volver a los del plan» nace deshabilitado; fijar el mismo número por contrato SÍ es un cambio', () => {
    const html = dibujar(base(ejesCon({ cambiosIncluidos: 2, porContrato: [], cambiosIncluidosDelPlan: 2 })));
    expect(html).toContain('· los del plan</span>');
    expect(html).not.toContain('por contrato (');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Volver a los del plan<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Fijar por contrato<\/button>/);
  });

  it('un servidor que no manda el origen: no se afirma ni contrato ni plan', () => {
    const ejes = ejesCon({ cambiosIncluidos: 3 });
    expect(origenDeCambiosIncluidos(ejes)).toBeNull();
    const html = dibujar(base(ejes));
    expect(html).not.toContain('por contrato (');
    expect(html).not.toContain('los del plan</span>');
  });

  it('el tope del campo es el del servidor, y ninguna acción empieza confirmando', () => {
    const html = dibujar(base(ejesCon({ porContrato: [] })));
    expect(html).toMatch(new RegExp(`<input id="eje-cambios-incluidos"[^>]*max="${MAXIMO_CAMBIOS_INCLUIDOS}"`));
    expect(html).not.toContain('¿Confirmar?');
  });
});

describe('Negocios: el valor por contrato lo escribe el servidor, no la pantalla', () => {
  it('la página lo manda por `actualizarEstadoCuenta` (CALLABLES.cuenta) con `cambiosIncluidos`, número o null', () => {
    const pagina = leer('web/src/plataforma/paginas/CuentaNegocio.tsx');
    expect(pagina).toMatch(/onCambiosIncluidos=\{\(cambiosIncluidos\) => void operar\(CALLABLES\.cuenta, \{ cambiosIncluidos \}/);
  });

  it('ni el panel ni la página importan escrituras de Firestore', () => {
    for (const ruta of ['web/src/plataforma/componentes/PanelEjes.tsx', 'web/src/plataforma/paginas/CuentaNegocio.tsx']) {
      expect(leer(ruta), ruta).not.toMatch(/\b(setDoc|updateDoc|addDoc|writeBatch|runTransaction)\b/);
    }
  });
});
