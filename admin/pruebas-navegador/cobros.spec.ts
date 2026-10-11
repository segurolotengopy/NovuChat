import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { fijarCobroReal, limpiarCierres, sembrarCierre, sembrarContadoresDelMes } from './ayudas/datos';
import prepararDatos from './preparar-datos';

const FOGON = 'parrilla-el-fogon';

async function abrirCobros(page: Page): Promise<void> {
  await ingresar(page, USUARIOS.adminFogon);
  await page.getByRole('link', { name: 'Cobros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cobros', exact: true }).first()).toBeVisible();
}

test.describe('Cobros', () => {
  test.beforeEach(async () => { prepararDatos(); await limpiarCierres(FOGON); });

  test('sin cobros dice que no hay en el período', async ({ page }) => {
    await abrirCobros(page);
    await expect(page.getByText('Sin cobros en este período.')).toBeVisible();
  });

  test('lista los cobros del período con su monto, lo que leyó el servidor del comprobante y si una persona lo comprobó', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110, cotejo: { resultado: 'cuadra', montoLeido: 110, banco: 'Banco de Prueba', intentos: 1 } });
    await sembrarCierre(FOGON, { id: 'c2', monto: 55, cotejo: { resultado: 'no_cuadra', diferencias: ['El monto leído es 50 y el pedido es 55'], montoLeido: 50 } });
    await sembrarCierre(FOGON, { id: 'c3', monto: 20, comprobado: true });
    await abrirCobros(page);
    await expect(page.getByRole('row')).toHaveCount(4); // encabezado + 3
    await expect(page.getByRole('row', { name: /110 Bs/ })).toContainText('Datos coinciden');
    await expect(page.getByRole('row', { name: /55 Bs/ })).toContainText('Hay una diferencia');
    await expect(page.getByRole('row', { name: /20 Bs/ })).toContainText('Comprobado por el negocio');
    await expect(page.getByRole('row', { name: /110 Bs/ })).toContainText('Sin comprobar');
    // Las tarjetas de arriba: 3 cobros por 185 y 1 comprobado.
    await expect(page.locator('article.tarjeta', { hasText: 'en el período' })).toContainText('3');
    await expect(page.locator('article.tarjeta', { hasText: 'en el período' })).toContainText('185');
  });

  test('NEGATIVA (prohibición 3): la pantalla nunca dice que el pago está acreditado o verificado', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110, cotejo: { resultado: 'cuadra', montoLeido: 110 } });
    await abrirCobros(page);
    await page.getByRole('row', { name: /110 Bs/ }).getByRole('button', { name: 'Ver' }).click();
    await expect(page.getByRole('dialog', { name: 'Detalle del cobro' })).toBeVisible();
    const texto = (await page.locator('body').innerText()).toLowerCase();
    for (const prohibida of ['pago acreditado', 'pago verificado', 'recibimos tu pago', 'verificamos tu pago']) {
      expect(texto, prohibida).not.toContain(prohibida);
    }
  });

  test('«Comprobar» lo marca como comprobado por el negocio y deja de ofrecerse', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110 });
    await abrirCobros(page);
    const fila = page.getByRole('row', { name: /110 Bs/ });
    await fila.getByRole('button', { name: 'Comprobar' }).click();
    await expect(fila).toContainText('Comprobado por el negocio');
    await expect(fila.getByRole('button', { name: 'Comprobar' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('«Ver» abre el detalle con las diferencias del cotejo y se cierra con Escape y con Cerrar', async ({ page }) => {
    await sembrarCierre(FOGON, {
      id: 'c2', monto: 55, items: [{ nombre: 'Tacos de Birria', cantidad: 2 }],
      cotejo: { resultado: 'no_cuadra', diferencias: ['El monto leído es 50 y el pedido es 55'], montoLeido: 50 },
    });
    await abrirCobros(page);
    await page.getByRole('button', { name: 'Ver' }).click();
    const detalle = page.getByRole('dialog', { name: 'Detalle del cobro' });
    await expect(detalle).toContainText('El monto leído es 50 y el pedido es 55');
    await expect(detalle).toContainText('Tacos de Birria');
    await page.keyboard.press('Escape');
    await expect(detalle).toBeHidden();
    await page.getByRole('button', { name: 'Ver' }).click();
    await detalle.getByRole('button', { name: 'Cerrar' }).click();
    await expect(detalle).toBeHidden();
  });

  test('el período deja fuera lo viejo: un cobro de hace 10 días no está en «7 días» y sí en «30 días»', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110, haceDias: 0 });
    await sembrarCierre(FOGON, { id: 'c9', monto: 999, haceDias: 10 });
    await abrirCobros(page);
    await expect(page.getByRole('row', { name: /110 Bs/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /999 Bs/ })).toHaveCount(0);
    await page.getByRole('button', { name: '30 días' }).click();
    await expect(page.getByRole('row', { name: /999 Bs/ })).toBeVisible();
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    await expect(page.getByRole('row', { name: /999 Bs/ })).toHaveCount(0);
  });

  test('exporta los cobros del período a CSV', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110 });
    await abrirCobros(page);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportar \(1\)/ }).click()]);
    expect(descarga.suggestedFilename()).toMatch(/^cobros.*\.csv$/);
    const { readFile } = await import('node:fs/promises');
    const texto = await readFile((await descarga.path())!, 'utf8');
    expect(texto).toContain('Monto');
    expect(texto).toContain('110');
  });

  test('con el cobro real activo muestra los contadores de comprobantes por mes, sin decir «acreditado»', async ({ page }) => {
    // El cobro real cuenta como activo con `activo`, la `ficha` del QR y su `cargaUtil` (lo que guarda `registrarQrDeCobro`).
    await fijarCobroReal(FOGON, { nombreCuenta: 'Q Taco de Prueba SRL', cuentas: ['123456789'], venceEl: '2027-12-31', activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'SINTETICO-QR-DE-PRUEBA-0001' });
    await sembrarContadoresDelMes(FOGON, { cobrosQrEnviados: 7, cobrosValidos: 4, cobrosAproximados: 1, cobrosEnRevision: 1, cobrosInvalidos: 1 });
    await abrirCobros(page);
    const tarjeta = page.getByLabel('Comprobantes por mes');
    await expect(tarjeta).toContainText('Comprobantes por mes (últimos 6 meses)');
    await expect(tarjeta.getByRole('row').nth(1)).toContainText('7');
    await expect(tarjeta).toContainText('Este mes hubo comprobantes aproximados o en revisión');
    expect((await tarjeta.innerText()).toLowerCase()).not.toContain('acreditado');
  });

  test('con el cobro simulado dice que los comprobantes no se cotejan', async ({ page }) => {
    await fijarCobroReal(FOGON, null);
    await sembrarContadoresDelMes(FOGON, { cobrosQrEnviados: 3 });
    await abrirCobros(page);
    await expect(page.getByText('Cobro simulado: los comprobantes no se cotejan.')).toBeVisible();
  });

  test('NEGATIVA (aislamiento): los cobros de otro comercio no se ven', async ({ page }) => {
    await sembrarCierre('salon-aurora', { id: 'a1', monto: 777 });
    await sembrarCierre(FOGON, { id: 'f1', monto: 110 });
    await abrirCobros(page);
    await expect(page.getByRole('row', { name: /110 Bs/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /777/ })).toHaveCount(0);
    await limpiarCierres('salon-aurora');
  });
});
