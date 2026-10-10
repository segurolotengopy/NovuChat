import { test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { expect, ingresarO2 as ingresar } from './o2-comun';
import { fijarModulos, limpiarPedidos, sembrarPedido } from './ayudas/datos';
import { leerDescargaCsv } from './o2-csv';

/**
 * CARRIL 2 · PED-04 con las CABECERAS REALES de Hosting (`playwright.cabeceras.config.ts`). El CSV se arma en el navegador y se baja por
 * un enlace `blob:`; la política de la consola (`default-src 'none'`) no debe bloquearlo ni dejar violaciones en la consola del navegador.
 * Igual que en `logo.cabeceras.spec.ts`, un control demuestra que el detector SÍ ve un bloqueo.
 */
const FOGON = 'parrilla-el-fogon';
const FORMULA = '=HYPERLINK("http://x","clic")';
const PATRON_VIOLACION = /Content Security Policy|Refused to/i;

// Los 90 s por prueba son por la carga de la máquina (los otros carriles corren a la vez); no relajan ninguna comprobación.
test.describe.configure({ timeout: 90_000 });

test.describe('Pedidos: exportar CSV y pantalla, con las cabeceras reales', () => {
  test.beforeEach(async () => {
    await limpiarPedidos(FOGON);
    await fijarModulos(FOGON, null);
  });

  test('la política de la consola está puesta (no es vite dev) y no permite scripts en línea', async ({ page }) => {
    const respuesta = await page.goto('/');
    const csp = respuesta?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  // Este control repite a propósito el de `logo.cabeceras.spec.ts`: así este archivo se puede correr solo y su detector queda probado aquí.
  test('CONTROL del detector: con esta política una imagen blob: SÍ se bloquea y la consola lo dice', async ({ page }) => {
    const violaciones: string[] = [];
    page.on('console', (m) => { if (PATRON_VIOLACION.test(m.text())) violaciones.push(m.text()); });
    await page.goto('/');
    await page.evaluate(async () => {
      const url = URL.createObjectURL(new Blob(['x'], { type: 'image/png' }));
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.onerror = r; img.src = url; });
    });
    expect(violaciones.length, 'si esto falla, el detector de las otras pruebas no detecta nada').toBeGreaterThan(0);
  });

  test('exporta por blob: sin violaciones de la política, con las columnas y los datos en el archivo', async ({ page }) => {
    const violaciones: string[] = [];
    const errores: string[] = [];
    page.on('console', (m) => { if (PATRON_VIOLACION.test(m.text())) violaciones.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await sembrarPedido(FOGON, {
      id: 'k1', total: 165, entrega: 'delivery', direccion: 'Av. Banzer 1234', referencia: 'A media cuadra del surtidor', nota: 'Tocar el timbre',
      telefonoEnmascarado: '*** 0901', items: [{ nombre: 'Tacos al Pastor', cantidad: 3, detalle: 'sin cebolla' }],
    });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.locator('li.pedido')).toHaveCount(1);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar (1)' }).click()]);
    expect(descarga.url()).toMatch(/^blob:/);
    expect(await descarga.failure(), 'la descarga no debe fallar').toBeNull();
    const csv = await leerDescargaCsv(descarga);
    expect(csv.filas[0]).toEqual(['Cuándo', 'Cliente', 'Entrega', 'Dirección', 'Referencia', 'Ítems', 'Nota', 'Total', 'Moneda', 'Estado']);
    expect(csv.filas[1]?.[3]).toBe('Av. Banzer 1234');
    expect(csv.filas[1]?.[4]).toBe('A media cuadra del surtidor');
    expect(csv.filas[1]?.[5]).toBe('3× Tacos al Pastor (sin cebolla)');
    expect(violaciones, violaciones.join('\n')).toEqual([]);
    expect(errores, errores.join('\n')).toEqual([]);
  });

  test('NEGATIVA (fórmulas): con la política real, `=HYPERLINK(...)` en nota, dirección y referencia sale neutralizado y sin violaciones', async ({ page }) => {
    const violaciones: string[] = [];
    page.on('console', (m) => { if (PATRON_VIOLACION.test(m.text())) violaciones.push(m.text()); });
    await sembrarPedido(FOGON, {
      id: 'k2', total: 20, entrega: 'delivery', telefonoEnmascarado: '*** 0902', direccion: FORMULA, referencia: FORMULA, nota: FORMULA,
      items: [{ nombre: 'Taco', cantidad: 1 }],
    });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.locator('li.pedido')).toHaveCount(1);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar (1)' }).click()]);
    const csv = await leerDescargaCsv(descarga);
    expect(csv.filas[1]?.[3]).toBe(`'${FORMULA}`);
    expect(csv.filas[1]?.[4]).toBe(`'${FORMULA}`);
    expect(csv.filas[1]?.[6]).toBe(`'${FORMULA}`);
    expect(csv.crudo).not.toMatch(/"=HYPERLINK/);
    expect(violaciones, violaciones.join('\n')).toEqual([]);
  });

  test('la pantalla con ubicación y texto hostil se ve como texto, el enlace a Maps funciona y no hay violaciones', async ({ page }) => {
    const violaciones: string[] = [];
    page.on('console', (m) => { if (PATRON_VIOLACION.test(m.text())) violaciones.push(m.text()); });
    await sembrarPedido(FOGON, {
      id: 'k3', total: 20, entrega: 'delivery', telefonoEnmascarado: '*** 0903', direccion: 'Calle 1', referencia: '<img src=x onerror="window.__xss=1"> javascript:alert(1)',
      ubicacion: { lat: -17.78346, lng: -63.18212 }, items: [{ nombre: 'Taco', cantidad: 1 }],
    });
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    const tarjeta = page.locator('li.pedido').first();
    await expect(tarjeta).toContainText('<img src=x onerror="window.__xss=1"> javascript:alert(1)');
    await expect(tarjeta.locator('img')).toHaveCount(0);
    await expect(tarjeta.getByRole('link', { name: 'Abrir en Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-17.78346%2C-63.18212');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(violaciones, violaciones.join('\n')).toEqual([]);
  });
});
