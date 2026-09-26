/**
 * EL COMERCIO RENUEVA SU PLAN; EL CAMBIO LO HACE NOVUCHAT — la pantalla Pagar
 * (decisión de Andres del 26/09/2026, en la revisión del PR #212).
 *
 * El servidor lo hace cumplir (`planQuePuedePedir` en `crearCobroPrepago`, con
 * sus pruebas negativas en `cobro-prepago.test.ts` y `planes.test.ts`); acá se
 * prueba que la pantalla ACOMPAÑA:
 *  1. `planesQuePuedePagar` da solo el plan actual (o ninguno si la cuenta no
 *     tiene uno del catálogo), y `planesOfrecidos` sigue siendo la lista del
 *     propietario para el pago manual.
 *  2. Pagar no tiene selector de plan ni de modalidad.
 *  3. Dice que el cambio lo hace NovuChat y ofrece SOLO el camino que existe
 *     (un reclamo de Facturación, que NovuChat ve), sin prometer un contacto
 *     que ningún mecanismo cumple («solo se ofrece lo que se cumple»).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planesOfrecidos, planesQuePuedePagar } from '../../web/src/lib/pagar';
import { PLANES, PLANES_PUBLICADOS } from '../../functions/src/planes';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', '..', ruta), 'utf8');
const sinComentarios = (fuente: string) => fuente
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('planesQuePuedePagar: el comercio renueva el suyo, y nada más', () => {
  it('con un plan del catálogo, solo ese', () => {
    for (const p of Object.keys(PLANES) as (keyof typeof PLANES)[]) {
      expect(planesQuePuedePagar({ plan: p })).toEqual([p]);
    }
  });

  it('sin plan del catálogo (o con el viejo de demostración), ninguno: no hay qué renovar', () => {
    for (const cuenta of [{}, null, undefined, { plan: 'basico' }, { plan: 'demostracion' }, { plan: 'toString' }]) {
      expect(planesQuePuedePagar(cuenta as never)).toEqual([]);
    }
  });

  it('la lista del PROPIETARIO (pago manual) sigue ofreciendo los publicados: él sí cambia el plan', () => {
    expect(planesOfrecidos({ plan: 'impulso' })).toEqual([...PLANES_PUBLICADOS]);
    const manual = leer('web/src/plataforma/componentes/FormularioPagoManual.tsx');
    expect(manual).toMatch(/planesOfrecidos\(cuenta\)/);
  });
});

describe('Pagar: sin selector de plan ni de modalidad, y el camino que existe para pedir el cambio', () => {
  const pagar = sinComentarios(leer('web/src/paginas/Pagar.tsx'));

  it('no hay selector de plan ni de modalidad, ni usa la lista del propietario', () => {
    expect(pagar).not.toMatch(/<select id="plan"/);
    expect(pagar).not.toMatch(/modalidad/i);
    expect(pagar).not.toMatch(/planesOfrecidos/);
    expect(pagar).toMatch(/planesQuePuedePagar\(cuenta\)/);
  });

  it('dice que el cambio lo hace NovuChat y ofrece el reclamo de Facturación, sin prometer que lo contactan', () => {
    expect(pagar).toMatch(/El cambio de plan, para subir o para bajar, lo hace NovuChat/);
    expect(pagar).toMatch(/\/negocio\/\$\{encodeURIComponent\(tenantId\)\}\/reclamos/);
    expect(pagar).toMatch(/<em>Facturación<\/em>/);
    expect(pagar).not.toMatch(/te (llamamos|contactamos|escribiremos|avisamos)|lo contactaremos|le escribiremos|nos pondremos en contacto/i);
    // La categoría existe de verdad en Reclamos.
    expect(leer('web/src/paginas/Reclamos.tsx')).toMatch(/facturacion: 'Facturación'/);
  });
});
