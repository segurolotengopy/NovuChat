import { expect, test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { limpiarPedidos, sembrarPedido } from './ayudas/datos';

const FOGON = 'parrilla-el-fogon';
const AURORA = 'salon-aurora';

test.describe('Pedidos', () => {
  test.beforeEach(async () => {
    await limpiarPedidos(FOGON);
    await limpiarPedidos(AURORA);
  });

  test('sin pedidos dice que todavía no hay, y el primero aparece solo, sin recargar', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    await expect(page.getByText('Todavía no hay pedidos')).toBeVisible();

    await sembrarPedido(FOGON, { id: 'p1', items: [{ nombre: 'Tacos de Birria', cantidad: 2 }], total: 110, entrega: 'retiro' });
    await expect(page.getByText('Tacos de Birria')).toBeVisible();
    await expect(page.getByText('Todavía no hay pedidos')).toBeHidden();
  });

  test('un delivery muestra la modalidad, la dirección, el detalle del cliente y la nota', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 'p2', total: 165, entrega: 'delivery', direccion: 'Av. Banzer 1234, frente a la panadería', nota: 'Tocar el timbre dos veces',
      items: [{ nombre: 'Tacos al Pastor', cantidad: 3, detalle: 'sin cebolla' }, { nombre: 'Horchata', cantidad: 1 }],
    });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    const tarjeta = page.locator('li.pedido').first();
    await expect(tarjeta).toContainText('Enviar a domicilio');
    await expect(tarjeta).toContainText('Av. Banzer 1234, frente a la panadería');
    await expect(tarjeta).toContainText('3×');
    await expect(tarjeta).toContainText('Tacos al Pastor');
    await expect(tarjeta.locator('em.pedido-detalle')).toHaveText('sin cebolla');
    await expect(tarjeta).toContainText('Tocar el timbre dos veces');
    await expect(tarjeta.locator('.pedido-total')).toContainText('165');
  });

  test('NEGATIVA: el HTML de un pedido se ve como texto, no se ejecuta', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 'p3', total: 10, entrega: 'retiro', nota: '<img src=x onerror="window.__xss=1">',
      items: [{ nombre: '<b>Taco</b>', cantidad: 1 }],
    });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.locator('li.pedido')).toContainText('<b>Taco</b>');
    await expect(page.locator('li.pedido img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('NEGATIVA (aislamiento): los pedidos de otro comercio no se ven', async ({ page }) => {
    await sembrarPedido(AURORA, { id: 'a1', items: [{ nombre: 'Corte de pelo secreto', cantidad: 1 }], total: 50, entrega: 'retiro' });
    await sembrarPedido(FOGON, { id: 'f1', items: [{ nombre: 'Costillas', cantidad: 1 }], total: 80, entrega: 'retiro' });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.getByText('Costillas')).toBeVisible();
    await expect(page.getByText('Corte de pelo secreto')).toHaveCount(0);
  });

  test('NEGATIVA (aislamiento en vivo): mirando un comercio, un pedido que llega a OTRO no aparece, y uno propio sí', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'l1', items: [{ nombre: 'Primero propio', cantidad: 1 }], total: 10, entrega: 'retiro' });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.getByText('Primero propio')).toBeVisible();
    await sembrarPedido(AURORA, { id: 'l2', items: [{ nombre: 'Llegó a Aurora', cantidad: 1 }], total: 20, entrega: 'retiro' });
    await sembrarPedido(FOGON, { id: 'l3', items: [{ nombre: 'Segundo propio', cantidad: 1 }], total: 30, entrega: 'retiro' });
    // Cuando el propio ya está en pantalla, el ajeno tuvo tiempo de sobra para aparecer si hubiera una fuga.
    await expect(page.getByText('Segundo propio')).toBeVisible();
    await expect(page.getByText('Llegó a Aurora')).toHaveCount(0);
    await expect(page.locator('li.pedido')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Exportar (2)' })).toBeVisible();
  });

  test('exporta los pedidos a un archivo CSV con sus columnas', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'p4', items: [{ nombre: 'Nachos', cantidad: 1 }], total: 58, entrega: 'retiro' });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportar \(1\)/ }).click()]);
    expect(descarga.suggestedFilename()).toMatch(/^pedidos.*\.csv$/);
    const { readFile } = await import('node:fs/promises');
    const texto = await readFile((await descarga.path())!, 'utf8');
    expect(texto).toContain('Cuándo');
    expect(texto).toContain('Referencia');
    expect(texto).toContain('Nachos');
  });
});
