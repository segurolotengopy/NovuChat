/**
 * CABECERA DE LA CONSOLA: el nombre del comercio y «PRUEBA» / «PRODUCCIÓN».
 *
 * Pedido de Andres (22/09/2026). Tres cosas se fijan acá:
 *
 *  1. LA REGLA ES LA DEL SERVIDOR. PRODUCCIÓN solo si `modalidadDe(cuenta)` es
 *     `prepago`; PRUEBA en cualquier otro caso (demostración, prueba, sin
 *     modalidad). La pantalla usa `modalidadDe` y no lee el campo `modalidad`
 *     a mano: el día que la regla del servidor cambie (como cambió en F1,
 *     cuando el plan dejó de mandar sobre la modalidad), la cabecera cambia
 *     con ella sin tocarla.
 *  2. SOLO LECTURA. La cabecera no escribe nada en Firestore.
 *  3. EL OPERADOR NO PIDE `cuenta/estado`. Las reglas se lo niegan; la
 *     cabecera ni lo intenta y muestra solo el nombre.
 *
 * Las pruebas de la función son de verdad (el módulo es puro); las de la
 * pantalla leen la fuente, como `comportamiento-pantalla.test.ts`: el proyecto
 * no tiene pruebas de componentes con navegador, y el dibujo del chip se
 * verifica con `renderToStaticMarkup`, que no necesita DOM.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modoDelComercio } from '../web/src/lib/modoComercio';
import { ChipModo } from '../web/src/componentes/ChipModo';
import { modalidadDe } from '../functions/src/prepago';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', ruta), 'utf8');

/** El cuerpo del archivo sin sus comentarios: lo que de verdad corre. */
const sinComentarios = (fuente: string) => fuente
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// React se toma del paquete de la consola: la raíz de `admin/` no lo tiene.
const desdeWeb = createRequire(join(aqui, '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };

const dibujar = (cuenta: Record<string, unknown> | null | undefined) =>
  renderToStaticMarkup(createElement(ChipModo, { modo: modoDelComercio(cuenta) }));

describe('modoDelComercio: PRUEBA o PRODUCCIÓN', () => {
  it('la modalidad de producción es PRODUCCIÓN, con «Producción» de detalle (nunca «Prepago»)', () => {
    // `Analisis/41` §6.1 punto 6: «producción» reemplaza a «prepago» en la
    // consola; el código conserva el valor `prepago`.
    expect(modoDelComercio({ modalidad: 'prepago', plan: 'emprendedor' }))
      .toEqual({ etiqueta: 'PRODUCCIÓN', detalle: 'Producción', produccion: true });
  });

  it('el mes de prueba es PRUEBA, con «Mes de prueba» de detalle', () => {
    expect(modoDelComercio({ modalidad: 'prueba' }))
      .toEqual({ etiqueta: 'PRUEBA', detalle: 'Mes de prueba', produccion: false });
  });

  it('sin modalidad, sin cuenta o con una modalidad inválida es demostración: PRUEBA', () => {
    for (const cuenta of [undefined, null, {}, { modalidad: 'produccion' }, { modalidad: 7 }]) {
      expect(modoDelComercio(cuenta)).toEqual({ etiqueta: 'PRUEBA', detalle: 'Demostración', produccion: false });
    }
  });

  it('la modalidad manda y el plan no opina, como en el servidor desde F1 (`Analisis/41` §4)', () => {
    // Hasta el 25/09 un `plan: 'demostracion'` volvía PRUEBA a una cuenta en
    // prepago. Ya no hay plan de demostración: un demo es modalidad
    // `demostracion` con cualquier plan, y una cuenta en prepago es PRODUCCIÓN
    // diga lo que diga su plan (incluido el valor viejo sin migrar).
    expect(modoDelComercio({ plan: 'demostracion', modalidad: 'prepago' }).etiqueta).toBe('PRODUCCIÓN');
    expect(modoDelComercio({ plan: 'pro', modalidad: 'demostracion' }).etiqueta).toBe('PRUEBA');
  });
});

describe('El chip dibujado', () => {
  it('producción → «PRODUCCIÓN», con su clase y su title', () => {
    expect(dibujar({ modalidad: 'prepago' }))
      .toBe('<span class="tag tag-modo-produccion" title="Producción">PRODUCCIÓN</span>');
  });

  it('prueba → «PRUEBA», con «Mes de prueba» de title', () => {
    expect(dibujar({ modalidad: 'prueba' }))
      .toBe('<span class="tag tag-modo-prueba" title="Mes de prueba">PRUEBA</span>');
  });

  it('sin cuenta → «PRUEBA», con «Demostración» de title', () => {
    expect(dibujar(undefined))
      .toBe('<span class="tag tag-modo-prueba" title="Demostración">PRUEBA</span>');
  });
});

describe('La cabecera en la fuente', () => {
  const modulo = sinComentarios(leer('web/src/lib/modoComercio.ts'));
  const encabezado = sinComentarios(leer('web/src/componentes/EncabezadoComercio.tsx'));
  const chip = sinComentarios(leer('web/src/componentes/ChipModo.tsx'));
  const app = sinComentarios(leer('web/src/App.tsx'));
  const cartera = sinComentarios(leer('web/src/paginas/Tenants.tsx'));

  it('la modalidad sale de modalidadDe del módulo compartido, no de leer el campo a mano', () => {
    expect(modulo).toMatch(/import \{[^}]*\bmodalidadDe\b[^}]*\} from '\.\/prepago'/);
    expect(modulo).toContain('modalidadDe(cuenta)');
    for (const fuente of [modulo, encabezado, chip, cartera]) {
      expect(fuente).not.toMatch(/\.modalidad\b/);
      expect(fuente).not.toMatch(/\['modalidad'\]/);
    }
    // Ni la cabecera ni la cartera comparan nombres de modalidad: usan el módulo.
    for (const fuente of [encabezado, chip, cartera]) {
      expect(fuente).not.toMatch(/'(prepago|prueba|demostracion)'/);
    }
    // Y el módulo no mira el plan: la modalidad es un eje independiente.
    expect(modulo).not.toMatch(/\.plan\b|\['plan'\]|'demostracion'/);
    expect(encabezado).toContain('modoDelComercio(d.data())');
    expect(cartera).toContain('modoDelComercio(d.data())');
  });

  it('el texto es exactamente «PRUEBA» y «PRODUCCIÓN»', () => {
    expect(modulo).toContain("etiqueta: produccion ? 'PRODUCCIÓN' : 'PRUEBA'");
    expect(modulo).toMatch(/type EtiquetaModo = 'PRUEBA' \| 'PRODUCCIÓN'/);
  });

  it('no escribe nada en Firestore', () => {
    for (const fuente of [modulo, encabezado, chip]) {
      expect(fuente).not.toMatch(/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|httpsCallable)\b/);
    }
    expect(encabezado).toMatch(/import \{ doc, onSnapshot \} from 'firebase\/firestore'/);
  });

  it('el operador no pide cuenta/estado: solo admin o propietario', () => {
    expect(encabezado).toMatch(/if \(!leeCuenta\) return;/);
    expect(app).toContain('<EncabezadoComercio tenantId={tenantId} leeCuenta={esAdminDelNegocio || permisos.propietario} />');
  });

  it('un error de lectura oculta esa parte y no rompe la cabecera', () => {
    expect(encabezado).toContain('() => setNombre(null)');
    expect(encabezado).toContain('() => setModo(null)');
  });

  it('la cabecera la dibuja en todas las páginas de un comercio', () => {
    expect(app).toMatch(/\{tenantId &&\s*<EncabezadoComercio /);
  });
});
