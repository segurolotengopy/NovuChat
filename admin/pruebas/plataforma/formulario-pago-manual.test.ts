/**
 * `FormularioPagoManual`: la bolsa que se ofrece al operador es la de la TARIFA de la cuenta (PR-4b).
 *
 * Antes el formulario ofrecía siempre «30 por USD 10» (`PRECIOS.bolsa`). Con la tarifa `estandar` el
 * servidor la rechaza (`bolsaPermitida` → 'tarifa'), así que el operador vería una opción que no puede
 * registrar. Ahora pregunta a `bolsasOfrecidas`, la misma regla. Se dibuja con `renderToStaticMarkup`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FormularioPagoManual } from '../../web/src/plataforma/componentes/FormularioPagoManual';
import { bolsaPermitida, VENTA_BOLSA_SALIENTES } from '../../functions/src/central/cuenta/prepago';

const aqui = dirname(fileURLToPath(import.meta.url));
const desdeWeb = createRequire(join(aqui, '..', '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };

const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);
const TC = { tco: 12.6, fecha: '2026-10-15', fuente: 'BCB' };
const dibujar = (cuenta: Record<string, unknown> | null, tipoInicial = 'mensualidad') => renderToStaticMarkup(createElement(FormularioPagoManual, {
  cuenta, tipoInicial, tipoCambio: TC, ahoraMs: AHORA, ocupado: false, onRegistrar: () => undefined,
}));
/** Las etiquetas de los radios de «Qué pagó». */
const etiquetas = (html: string) => [...html.matchAll(/name="pago-tipo"[^>]*\/?>\s*([^<]*)</g)].map((m) => (m[1] ?? '').trim());

const opcionesDeCantidad = (html: string) => /<select id="pago-cantidad"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';

describe('FormularioPagoManual: la bolsa según la tarifa de la cuenta', () => {
  it('estandar: ofrece la bolsa de 300 por USD 15 y NO la de 30 por USD 10 (control: el servidor dice lo mismo)', () => {
    const cuenta = { plan: 'impulso', modalidad: 'prepago', tarifa: 'estandar' };
    expect(bolsaPermitida(cuenta, { tipo: 'bolsa' }, [])).toBe('tarifa');
    expect(bolsaPermitida(cuenta, { tipo: 'bolsaConversaciones' }, [])).toBeNull();
    const html = dibujar(cuenta, 'bolsaConversaciones');
    const sel = opcionesDeCantidad(html);
    expect(sel).toContain('1 bolsa · 300 conversaciones · USD 15');
    expect(sel).toContain('12 bolsas · 3600 conversaciones · USD 180');
    expect(sel).not.toContain('1 bolsa · 30 conversaciones');
    expect(sel).not.toContain('· USD 10<');
    // El importe y la bolsa que quedaría salen del servidor: 300 por USD 15.
    expect(html).toContain('Bolsa de 300 conversaciones');
    expect(etiquetas(html)).toEqual(['Mensualidad', 'Bolsa de conversaciones', 'Instalación']);
  });

  it('sin el campo (Bellido, demos) o meta_incluido: ofrece 30 por USD 10 y NO 300 por USD 15', () => {
    for (const cuenta of [{ plan: 'impulso', modalidad: 'prepago' }, { plan: 'impulso', tarifa: 'meta_incluido' }, {}]) {
      expect(bolsaPermitida(cuenta, { tipo: 'bolsaConversaciones' }, []), JSON.stringify(cuenta)).toBe('tarifa');
      const sel = opcionesDeCantidad(dibujar(cuenta, 'bolsa'));
      expect(sel, JSON.stringify(cuenta)).toContain('1 bolsa · 30 conversaciones · USD 10');
      expect(sel).not.toContain('1 bolsa · 300 conversaciones');
      expect(sel).not.toContain('· USD 15<');
      expect(etiquetas(dibujar(cuenta))).toEqual(['Mensualidad', 'Bolsa de conversaciones', 'Instalación']);
    }
  });

  it('con la cuenta sin cargar (null o undefined) no ofrece ninguna bolsa, ni la de 30 por USD 10', () => {
    for (const cuenta of [null, undefined]) {
      const html = dibujar(cuenta as never, 'bolsa');
      expect(etiquetas(html)).toEqual(['Mensualidad', 'Instalación']);
      expect(html).not.toContain('id="pago-cantidad"');
      expect(html).not.toContain('30 conversaciones');
    }
  });

  it('un tipo de bolsa que la tarifa no permite no se dibuja: vuelve a la mensualidad (no deja elegir la rechazada)', () => {
    const html = dibujar({ tarifa: 'estandar' }, 'bolsa');
    expect(html).not.toContain('id="pago-cantidad"');
    expect(html).toContain('id="pago-plan"');
  });

  it('la bolsa de seguimiento no aparece mientras la venta esté apagada, con ninguna tarifa', () => {
    expect(VENTA_BOLSA_SALIENTES).toBe(false);
    for (const cuenta of [{ tarifa: 'estandar' }, { tarifa: 'meta_incluido' }, {}]) {
      const html = dibujar(cuenta, 'bolsaSalientes');
      expect(html, JSON.stringify(cuenta)).not.toContain('seguimiento');
      expect(etiquetas(html)).toHaveLength(3);
      expect(html).not.toContain('id="pago-cantidad"');
    }
  });

  it('la fuente ya no usa PRECIOS.bolsa (el alias deprecado se puede borrar)', () => {
    const fuente = readFileSync(join(aqui, '..', '..', 'web', 'src', 'plataforma', 'componentes', 'FormularioPagoManual.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fuente).not.toMatch(/PRECIOS\.bolsa/);
    expect(fuente).toMatch(/bolsasParaPantalla\(cuenta \?\? null\)/);
  });
});
