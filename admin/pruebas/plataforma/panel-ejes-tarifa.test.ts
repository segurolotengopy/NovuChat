/**
 * `PanelEjes`, EL SELECTOR «Cambiar a» (PR-4a, hallazgo m1 de la revisión de #497).
 *
 * Las conversaciones de un plan dependen de la TARIFA de la cuenta (`tarifaDe`): una cuenta
 * Meta incluido (la de Bellido, sin campo) recibe 100 / 220 / 500, no las 200 / 500 / 1.000
 * del catálogo. Antes el selector leía `PLANES[id].conversaciones` y el operador leía 500
 * donde la callable escribía 220. Ahora lee `limitesDe(id, tarifaDe(cuenta))`, y la tarifa
 * se ve en la fila del plan. Se dibuja con `renderToStaticMarkup`, sin DOM ni emulador.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PanelEjes } from '../../web/src/plataforma/componentes/PanelEjes';
import { limitesDe, type Tarifa } from '../../functions/src/central/cuenta/planes';

const aqui = dirname(fileURLToPath(import.meta.url));
const desdeWeb = createRequire(join(aqui, '..', '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };

const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);
const nada = () => undefined;
const acciones = {
  onPlan: nada, onModalidad: nada, onTitularidad: nada, onModelo: nada, onUmbrales: nada, onCambio: nada,
  onCambiosIncluidos: nada,
};
const dibujar = (cuenta: Record<string, unknown>) => renderToStaticMarkup(createElement(PanelEjes, {
  cuenta, ejes: undefined, tipoCambio: null, ahoraMs: AHORA, ocupado: false, ...acciones,
}));
const selectorDePlan = (html: string) => /<select id="eje-plan"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
/** Las conversaciones que lee el operador en cada opción, en el orden impulso, crecimiento, pro, byoc. */
const cifras = (html: string) => [...selectorDePlan(html).matchAll(/(\d+) conversaciones/g)].map((m) => m[1]);

describe('PanelEjes: el selector de plan muestra las conversaciones de la tarifa de la cuenta', () => {
  it('una cuenta estándar ve 200 / 500 / 1000 / 2000 (BYOC) y la tarifa a la vista', () => {
    const html = dibujar({ plan: 'impulso', modalidad: 'prueba', tarifa: 'estandar' });
    expect(cifras(html)).toEqual(['200', '500', '1000', '2000']);
    expect(html).toContain('Estándar (el comercio paga su Meta)');
    expect(html).not.toContain('sin el campo en la cuenta');
  });

  it('EL CASO BELLIDO: una cuenta SIN el campo ve 100 / 220 / 500 / 2000 (BYOC; lo que escribe la callable), y dice que rige Meta incluido', () => {
    const html = dibujar({ plan: 'impulso', modalidad: 'prueba' });
    expect(cifras(html)).toEqual(['100', '220', '500', '2000']);
    expect(html).toContain('Meta incluido (NovuChat paga Meta)');
    expect(html).toContain('sin el campo en la cuenta: rige Meta incluido');
    // Ni 200 ni 1000 en el selector: eran las cifras de otra tarifa.
    expect(selectorDePlan(html)).not.toMatch(/\b200 conversaciones|\b1000 conversaciones/);
  });

  it('una cuenta con la tarifa Meta incluido escrita ve 100 / 220 / 500 / 2000, sin la nota de «sin el campo»', () => {
    const html = dibujar({ plan: 'pro', modalidad: 'prueba', tarifa: 'meta_incluido' });
    expect(cifras(html)).toEqual(['100', '220', '500', '2000']);
    expect(html).not.toContain('sin el campo en la cuenta');
  });

  it('un valor de tarifa inválido cae en Meta incluido (el límite menor), igual que en el servidor', () => {
    expect(cifras(dibujar({ plan: 'impulso', modalidad: 'prueba', tarifa: 'gratis' }))).toEqual(['100', '220', '500', '2000']);
  });

  it('las cifras salen de limitesDe del servidor, no de una tabla escrita en la pantalla', () => {
    for (const tarifa of ['estandar', 'meta_incluido'] as Tarifa[]) {
      const html = dibujar({ plan: 'crecimiento', modalidad: 'prueba', tarifa });
      for (const id of ['impulso', 'crecimiento', 'pro', 'byoc'] as const) {
        expect(selectorDePlan(html)).toContain(`${limitesDe(id, tarifa).conversaciones} conversaciones`);
      }
    }
  });
});
