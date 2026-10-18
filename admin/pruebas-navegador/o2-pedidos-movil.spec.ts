import { test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { crearOperadorO2, expect, ingresarO2 as ingresar, OPERADOR_O2 } from './o2-comun';
import { fijarModulos, limpiarPedidos, sembrarPedido } from './ayudas/datos';

/**
 * CARRIL 2 · PED-06: Pedidos en el teléfono del local (375×812). Se mira de pie y con las manos ocupadas: sin desplazarse hacia los
 * lados, el detalle del cliente legible y el botón Exportar al alcance. Es la parte automática; la mirada en el teléfono real es de Silvana.
 */
const FOGON = 'parrilla-el-fogon';
const LARGA = 'x'.repeat(260);

// Los 90 s por prueba son por la carga de la máquina (los otros carriles corren a la vez); no relajan ninguna comprobación.
test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

async function abrirPedidos(page: import('@playwright/test').Page, correo: string = USUARIOS.adminFogon): Promise<void> {
  await ingresar(page, correo);
  await page.goto(`/negocio/${FOGON}/pedidos`);
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
}

/** Cuántos píxeles se sale el documento del ancho de la pantalla (0 = nada). */
async function desborde(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
}

test.describe('PED-06: pedidos en el teléfono del local', () => {
  test.beforeAll(async () => {
    await crearOperadorO2(FOGON);
  });
  test.beforeEach(async () => {
    await limpiarPedidos(FOGON);
    await fijarModulos(FOGON, null);
    await sembrarPedido(FOGON, {
      id: 'm1', total: 165, entrega: 'delivery', direccion: 'Av. Banzer esquina tercer anillo, edificio Los Pinos, piso 4', referencia: 'A media cuadra del surtidor, portón verde',
      nota: 'Tocar el timbre dos veces, el perro no muerde', ubicacion: { lat: -17.78346, lng: -63.18212 },
      items: [{ nombre: 'Tacos al Pastor con piña y queso extra', cantidad: 3, detalle: 'sin cebolla, salsa aparte' }, { nombre: 'Horchata', cantidad: 1 }],
    });
  });

  test('la tarjeta cabe en 375 px: sin desplazamiento lateral y con todo el texto dentro de la pantalla', async ({ page }) => {
    await abrirPedidos(page);
    const tarjeta = page.locator('li.pedido').first();
    await expect(tarjeta).toContainText('Enviar a domicilio');
    expect(await desborde(page)).toBe(0);
    const caja = await tarjeta.boundingBox();
    expect(caja && caja.x >= 0 && caja.x + caja.width <= 375, `tarjeta fuera de la pantalla: ${JSON.stringify(caja)}`).toBe(true);
    // Cada parte de la tarjeta, adentro de la pantalla.
    for (const sel of ['.pedido-entrega', '.pedido-direccion', '.pedido-items li', '.pedido-detalle', '.pedido-nota', '.pedido-total']) {
      for (const el of await tarjeta.locator(sel).all()) {
        const b = await el.boundingBox();
        expect(b && b.x >= 0 && b.x + b.width <= 375.5, `«${sel}» se sale de la pantalla: ${JSON.stringify(b)}`).toBe(true);
      }
    }
  });

  test('el detalle del cliente se lee: destacado, de 14 px o más, y el resto del texto de 15 px o más', async ({ page }) => {
    await abrirPedidos(page);
    const tarjeta = page.locator('li.pedido').first();
    const tam = (sel: string) => tarjeta.locator(sel).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(await tam('em.pedido-detalle')).toBeGreaterThanOrEqual(14);
    expect(await tam('.pedido-items li')).toBeGreaterThanOrEqual(16);
    expect(await tam('.pedido-entrega')).toBeGreaterThanOrEqual(16);
    expect(await tam('.pedido-direccion')).toBeGreaterThanOrEqual(15);
    expect(await tam('.pedido-nota')).toBeGreaterThanOrEqual(15);
    // El detalle va sobre un fondo propio (no es un gris perdido): su color de fondo no es transparente.
    expect(await tarjeta.locator('em.pedido-detalle').evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await expect(tarjeta.locator('em.pedido-detalle')).toBeInViewport();
  });

  test('el botón Exportar es accesible: visible, completo en la pantalla, de tamaño táctil y baja el archivo', async ({ page }) => {
    await abrirPedidos(page);
    const boton = page.getByRole('button', { name: 'Exportar (1)' });
    await expect(boton).toBeVisible();
    await boton.scrollIntoViewIfNeeded();
    const b = await boton.boundingBox();
    expect(b && b.x >= 0 && b.x + b.width <= 375, `botón fuera de la pantalla: ${JSON.stringify(b)}`).toBe(true);
    expect(b?.height ?? 0, 'alto del botón (mínimo táctil 40 px)').toBeGreaterThanOrEqual(40);
    expect(b?.width ?? 0, 'ancho del botón (mínimo táctil 40 px)').toBeGreaterThanOrEqual(40);
    const [descarga] = await Promise.all([page.waitForEvent('download'), boton.tap()]);
    expect(descarga.suggestedFilename()).toMatch(/^pedidos-.*\.csv$/);
  });

  test('NEGATIVA (texto largo sin espacios): una dirección, referencia y nota de 260 letras seguidas no ensanchan la pantalla', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'm2', total: 10, entrega: 'delivery', direccion: LARGA, referencia: LARGA, nota: LARGA, items: [{ nombre: LARGA, cantidad: 1, detalle: LARGA }] });
    await abrirPedidos(page);
    await expect(page.locator('li.pedido')).toHaveCount(2);
    expect(await desborde(page)).toBe(0);
    for (const t of await page.locator('li.pedido').all()) {
      const b = await t.boundingBox();
      expect(b && b.x + b.width <= 375.5, `tarjeta ensanchada: ${JSON.stringify(b)}`).toBe(true);
    }
  });

  test('NEGATIVA (muchos pedidos): con 12 pedidos seguidos la pantalla sigue sin desplazamiento lateral', async ({ page }) => {
    for (let i = 0; i < 11; i += 1) {
      await sembrarPedido(FOGON, { id: `k${i}`, total: 10 + i, entrega: i % 2 ? 'retiro' : 'delivery', direccion: `Calle ${i} numero 1234567`, items: [{ nombre: `Plato ${i}`, cantidad: 1 }] });
    }
    await abrirPedidos(page);
    await expect(page.locator('li.pedido')).toHaveCount(12);
    expect(await desborde(page)).toBe(0);
    await expect(page.getByRole('button', { name: 'Exportar (12)' })).toBeVisible();
  });

  test('el cocinero (operador) ve la misma tarjeta en el teléfono, sin desplazamiento lateral', async ({ page }) => {
    await abrirPedidos(page, OPERADOR_O2.correo);
    await expect(page.locator('li.pedido').first()).toContainText('Enviar a domicilio');
    await expect(page.getByRole('link', { name: 'Abrir en Maps' })).toBeVisible();
    expect(await desborde(page)).toBe(0);
  });

  test('el enlace «Abrir en Maps» se puede tocar con el dedo (alto táctil)', async ({ page }) => {
    test.fail(true, 'PED-03/PED-06 (criterio de producto: el repartidor usa el teléfono con una mano y las manos ocupadas): el enlace «Abrir en Maps» es texto en línea de 16 px de alto y se pide 24 px como mínimo. Cambio de estilo de la consola, no de la Operadora. Pruebas hermanas SIN test.fail que cubren el mismo elemento: «el cocinero (operador) ve la misma tarjeta en el teléfono» (el enlace se ve, sin desborde) y, en o2-pedidos-ubicacion.spec.ts, la del href exacto.');
    await abrirPedidos(page);
    const b = await page.getByRole('link', { name: 'Abrir en Maps' }).boundingBox();
    expect(b?.height ?? 0, 'alto del enlace «Abrir en Maps»').toBeGreaterThanOrEqual(24);
  });
});
