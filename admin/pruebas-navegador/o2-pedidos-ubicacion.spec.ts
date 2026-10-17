import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { crearOperadorO2, expect, ingresarO2 as ingresar, OPERADOR_O2 } from './o2-comun';
import { fijarModulos, limpiarPedidos, sembrarPedido, type PedidoDePrueba } from './ayudas/datos';

/**
 * CARRIL 2 · PED-03: la ubicación que el cliente comparte al pedir (#445, `web/src/modulos/pedidos/ubicacion.ts`).
 * El enlace a Maps sale SOLO de dos números validados (5 decimales); un retiro nunca lo muestra; nada del texto del pedido se usa como URL.
 */
const FOGON = 'parrilla-el-fogon';
const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

/** El servidor del catálogo guarda `entrega: 'envio'` (`checkoutCatalogo`); el tipo de la ayuda solo conoce `delivery`. */
const ENVIO = 'envio' as unknown as PedidoDePrueba['entrega'];
const LOCAL = 'local' as unknown as PedidoDePrueba['entrega'];

async function abrirPedidos(page: Page, correo: string = USUARIOS.adminFogon): Promise<void> {
  await ingresar(page, correo);
  await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
}

// Los 90 s por prueba son por la carga de la máquina (los otros carriles corren a la vez); no relajan ninguna comprobación.
test.describe.configure({ timeout: 90_000 });

test.describe('PED-03: ubicación compartida', () => {
  test.beforeAll(async () => {
    await crearOperadorO2(FOGON);
  });
  test.beforeEach(async () => {
    await limpiarPedidos(FOGON);
    await fijarModulos(FOGON, null);
  });

  test('un delivery (entrega «envio», como lo guarda el servidor) con ubicación válida muestra el enlace con el href exacto', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 'u1', total: 90, entrega: ENVIO, direccion: 'Av. Banzer 1234', referencia: 'Frente al surtidor',
      ubicacion: { lat: -17.783456789, lng: -63.182118 }, items: [{ nombre: 'Costillas', cantidad: 1 }],
    });
    await abrirPedidos(page);
    const tarjeta = page.locator('li.pedido').first();
    const enlace = tarjeta.getByRole('link', { name: 'Abrir en Maps' });
    await expect(enlace).toHaveCount(1);
    // 5 decimales, la coma del par codificada, y nada más en la dirección.
    await expect(enlace).toHaveAttribute('href', `${MAPS}-17.78346%2C-63.18212`);
    await expect(enlace).toHaveAttribute('target', '_blank');
    const rel = (await enlace.getAttribute('rel')) ?? '';
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    await expect(tarjeta.locator('p.pedido-direccion').filter({ hasText: 'Ubicación compartida' })).toBeVisible();
    // Con dirección Y ubicación salen las dos, más la referencia.
    await expect(tarjeta).toContainText('Av. Banzer 1234');
    await expect(tarjeta).toContainText('Referencia: Frente al surtidor');
  });

  test('«delivery» (el otro nombre de la modalidad) también muestra el enlace; el operador lo ve igual', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'u2', total: 50, entrega: 'delivery', ubicacion: { lat: 40.4168, lng: -3.7038 }, items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirPedidos(page, OPERADOR_O2.correo);
    await expect(page.getByRole('link', { name: 'Abrir en Maps' })).toHaveAttribute('href', `${MAPS}40.41680%2C-3.70380`);
  });

  test('los extremos válidos del rango (90, -180) generan enlace', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'u3', total: 5, entrega: 'delivery', ubicacion: { lat: 90, lng: -180 }, items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirPedidos(page);
    await expect(page.getByRole('link', { name: 'Abrir en Maps' })).toHaveAttribute('href', `${MAPS}90.00000%2C-180.00000`);
  });

  test('el enlace abre en OTRA pestaña, con la misma dirección y sin vínculo con la consola (noopener)', async ({ page, context }) => {
    // Sin red: lo que se prueba es a dónde va el navegador, no Google.
    await context.route('https://www.google.com/**', (ruta) => ruta.fulfill({ status: 200, contentType: 'text/html', body: '<title>maps</title>' }));
    await sembrarPedido(FOGON, { id: 'u4', total: 5, entrega: 'delivery', ubicacion: { lat: -17.78346, lng: -63.18212 }, items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirPedidos(page);
    const [nueva] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Abrir en Maps' }).click()]);
    await nueva.waitForLoadState();
    expect(nueva.url()).toBe(`${MAPS}-17.78346%2C-63.18212`);
    expect(await nueva.evaluate(() => window.opener)).toBeNull();
    // La consola sigue donde estaba.
    expect(page.url()).toContain('/pedidos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
  });

  test('NEGATIVA: un retiro (o «local») con ubicación NO muestra el enlace', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'u5', total: 5, entrega: 'retiro', ubicacion: { lat: -17.78346, lng: -63.18212 }, items: [{ nombre: 'Taco de retiro', cantidad: 1 }] });
    await sembrarPedido(FOGON, { id: 'u6', total: 6, entrega: LOCAL, ubicacion: { lat: -17.78346, lng: -63.18212 }, items: [{ nombre: 'Taco de local', cantidad: 1 }] });
    await abrirPedidos(page);
    await expect(page.locator('li.pedido')).toHaveCount(2);
    await expect(page.getByText('Retira en el local')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Abrir en Maps' })).toHaveCount(0);
    await expect(page.getByText('Ubicación compartida')).toHaveCount(0);
  });

  test('NEGATIVA: un delivery sin ubicación (los pedidos anteriores) queda como siempre, sin enlace', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'u7', total: 5, entrega: 'delivery', direccion: 'Calle Sucre 55', items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirPedidos(page);
    await expect(page.locator('li.pedido').first()).toContainText('Calle Sucre 55');
    await expect(page.locator('li.pedido a')).toHaveCount(0);
    await expect(page.getByText('Ubicación compartida')).toHaveCount(0);
  });

  const INVALIDAS: { nombre: string; ubicacion: unknown }[] = [
    { nombre: 'latitud fuera de rango (200)', ubicacion: { lat: 200, lng: 10 } },
    { nombre: 'latitud 90,00001', ubicacion: { lat: 90.00001, lng: 10 } },
    { nombre: 'longitud fuera de rango (181)', ubicacion: { lat: -17, lng: 181 } },
    { nombre: 'el punto nulo (0, 0)', ubicacion: { lat: 0, lng: 0 } },
    { nombre: 'que redondea a (0, 0)', ubicacion: { lat: -0.000001, lng: 0.000001 } },
    { nombre: 'números escritos como texto', ubicacion: { lat: '-17.78', lng: '-63.18' } },
    { nombre: 'texto con javascript: en la latitud', ubicacion: { lat: 'javascript:alert(1)', lng: -63.18 } },
    { nombre: 'NaN', ubicacion: { lat: Number.NaN, lng: -63.18 } },
    { nombre: 'infinito', ubicacion: { lat: -17.78, lng: Number.POSITIVE_INFINITY } },
    { nombre: 'sin longitud', ubicacion: { lat: -17.78 } },
    { nombre: 'un texto en lugar del objeto', ubicacion: 'javascript:alert(1)' },
    { nombre: 'una dirección web en lugar del objeto', ubicacion: 'https://malo.example/maps?q=-17,-63' },
    { nombre: 'una lista en lugar del objeto', ubicacion: [-17.78, -63.18] },
    { nombre: 'null', ubicacion: null },
    { nombre: 'un objeto vacío', ubicacion: {} },
  ];

  for (const [n, caso] of INVALIDAS.entries()) {
    test(`NEGATIVA: ubicación inválida (${caso.nombre}) → no hay enlace y la pantalla queda como siempre`, async ({ page }) => {
      const dialogos: string[] = [];
      page.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss(); });
      await sembrarPedido(FOGON, {
        id: `i${n}`, total: 77, entrega: 'delivery', direccion: 'Calle Libertad 9', referencia: 'Casa azul',
        ubicacion: caso.ubicacion, items: [{ nombre: 'Pique macho', cantidad: 2 }],
      });
      await abrirPedidos(page);
      const tarjeta = page.locator('li.pedido').first();
      await expect(tarjeta).toContainText('Pique macho');
      await expect(tarjeta).toContainText('Calle Libertad 9');
      await expect(tarjeta).toContainText('Referencia: Casa azul');
      await expect(tarjeta.locator('.pedido-total')).toContainText('77');
      await expect(page.getByText('Ubicación compartida')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Abrir en Maps' })).toHaveCount(0);
      await expect(page.locator('li.pedido a')).toHaveCount(0);
      expect(dialogos).toEqual([]);
    });
  }

  test('NEGATIVA: nada del texto del pedido se usa como dirección web (ni dirección, ni referencia, ni campos extra de la ubicación)', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 'u8', total: 5, entrega: 'delivery', direccion: 'https://malo.example/robo', referencia: 'javascript:alert(1)',
      nota: '[mapa](https://malo.example) <a href="https://malo.example">aquí</a>',
      ubicacion: { lat: -17.78346, lng: -63.18212, href: 'javascript:alert(1)', url: 'https://malo.example', enlace: 'https://malo.example' },
      items: [{ nombre: 'Taco', cantidad: 1 }],
    });
    await abrirPedidos(page);
    const tarjeta = page.locator('li.pedido').first();
    // Un único enlace en toda la tarjeta, y es el armado de los dos números.
    await expect(tarjeta.locator('a')).toHaveCount(1);
    await expect(tarjeta.locator('a')).toHaveAttribute('href', `${MAPS}-17.78346%2C-63.18212`);
    await expect(page.locator('a[href*="malo.example"], a[href^="javascript:" i]')).toHaveCount(0);
    // Y el texto hostil se ve como texto.
    await expect(tarjeta).toContainText('https://malo.example/robo');
    await expect(tarjeta).toContainText('javascript:alert(1)');
  });
});
