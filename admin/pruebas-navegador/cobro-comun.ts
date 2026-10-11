import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { fijarCobroReal } from './ayudas/datos';
import { pngSinCodigo, qrEnPng } from './ayudas/qr';
import { simularFuncion } from './ayudas/funciones';
import prepararDatos from './preparar-datos';

const FOGON = 'parrilla-el-fogon';
const TEXTO_DEL_QR = 'SINTETICO-QR-DE-PRUEBA-0001';
const REGISTRADO = { nombreCuenta: 'Q Taco de Prueba SRL', cuentas: ['123456789'], banco: 'Banco de Prueba', venceEl: '2027-12-31' };

async function abrirQr(page: Page): Promise<void> {
  await ingresar(page, USUARIOS.adminFogon);
  await page.getByRole('link', { name: 'Configuración de QR', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configuración de QR' })).toBeVisible();
}

async function llenar(page: Page, imagen: Buffer | null, nombre = 'image/png'): Promise<void> {
  if (imagen) await page.getByLabel('Imagen del QR').setInputFiles({ name: 'qr.png', mimeType: nombre, buffer: imagen });
  await page.getByLabel('¿A nombre de quién está la cuenta?').fill('Q Taco de Prueba SRL');
  await page.getByLabel('Número de la cuenta que recibe el dinero').fill('123456789');
  await page.getByLabel('Banco (opcional)').fill('Banco de Prueba');
  await page.getByLabel('¿Qué día vence el QR?').fill('2027-12-31');
  await page.getByLabel(/Miré en mi banco y confirmo/).check();
  await page.getByLabel(/NO tiene un importe fijo grabado/).check();
}

/** Las pruebas de «Configuración de QR» (`/cobro`), las mismas con `vite` y con las cabeceras reales (el QR se lee de una imagen en el navegador). */
export function pruebasDeConfiguracionDeQr(): void {
  test.describe('Configuración de QR', () => {
    test.beforeEach(async () => { prepararDatos(); await fijarCobroReal(FOGON, null); });

    test('sin QR dice que todavía no hay y ofrece cargarlo', async ({ page }) => {
      await abrirQr(page);
      await expect(page.getByText('Todavía no cargaste ningún QR propio')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Cargar mi QR' })).toBeVisible();
    });

    test('un QR registrado se muestra con la cuenta, el banco y el vencimiento, y dice que todavía no cobra', async ({ page }) => {
      await fijarCobroReal(FOGON, { ...REGISTRADO, activo: false });
      await abrirQr(page);
      await expect(page.getByText('Q Taco de Prueba SRL')).toBeVisible();
      await expect(page.getByText('Banco de Prueba')).toBeVisible();
      await expect(page.getByText('123456789')).toBeVisible();
      await expect(page.getByText('vence el 2027-12-31')).toBeVisible();
      await expect(page.getByText('Guardado, todavía sin cobrar')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Cambiar el QR' })).toBeVisible();
    });

    test('con el cobro activo dice «Cobrando»', async ({ page }) => {
      await fijarCobroReal(FOGON, { ...REGISTRADO, activo: true });
      await abrirQr(page);
      await expect(page.getByText('Cobrando')).toBeVisible();
      await expect(page.getByText('Guardado, todavía sin cobrar')).toHaveCount(0);
    });

    test('NEGATIVA: el nombre de la cuenta con HTML se ve como texto', async ({ page }) => {
      await fijarCobroReal(FOGON, { ...REGISTRADO, nombreCuenta: '<img src=x onerror="window.__xss=1">', activo: false });
      await abrirQr(page);
      await expect(page.getByText('<img src=x', { exact: false })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    });

    test('NEGATIVA: sin elegir la imagen el formulario no se envía', async ({ page }) => {
      const { llamadas } = await simularFuncion(page, 'registrarQrDeCobro', { resultado: { registrado: true, problemas: [], advertencias: [] } });
      await abrirQr(page);
      await llenar(page, null);
      await page.getByRole('button', { name: 'Guardar mi QR' }).click();
      expect(llamadas).toHaveLength(0);
      expect(await page.getByLabel('Imagen del QR').evaluate((i: HTMLInputElement) => i.validity.valueMissing)).toBe(true);
    });

    test('NEGATIVA: una imagen sin ningún código dice qué hacer y no llama al servidor', async ({ page }) => {
      const { llamadas } = await simularFuncion(page, 'registrarQrDeCobro', { resultado: { registrado: true, problemas: [], advertencias: [] } });
      await abrirQr(page);
      await llenar(page, pngSinCodigo());
      await page.getByRole('button', { name: 'Guardar mi QR' }).click();
      await expect(page.getByText('No se encontró ningún código en la imagen').first()).toBeVisible();
      expect(llamadas).toHaveLength(0);
    });

    test('NEGATIVA: un archivo que no es una imagen (texto con extensión .png) no se acepta y no llama al servidor', async ({ page }) => {
      const { llamadas } = await simularFuncion(page, 'registrarQrDeCobro', { resultado: { registrado: true, problemas: [], advertencias: [] } });
      await abrirQr(page);
      await llenar(page, Buffer.from('esto no es una imagen'));
      await page.getByRole('button', { name: 'Guardar mi QR' }).click();
      await expect(page.getByRole('alert').or(page.getByRole('status')).first()).toBeVisible();
      expect(llamadas).toHaveLength(0);
      await expect(page.getByText('QR guardado y verificado')).toHaveCount(0);
    });

    test('NEGATIVA: una imagen de más de 12 MB se rechaza con el consejo de sacar una captura', async ({ page }) => {
      const { llamadas } = await simularFuncion(page, 'registrarQrDeCobro', { resultado: { registrado: true, problemas: [], advertencias: [] } });
      await abrirQr(page);
      await llenar(page, Buffer.alloc(12 * 1024 * 1024 + 1024));
      await page.getByRole('button', { name: 'Guardar mi QR' }).click();
      await expect(page.getByText('La imagen pesa demasiado').first()).toBeVisible();
      expect(llamadas).toHaveLength(0);
    });

    test('un QR válido se lee en el navegador, se manda al servidor con lo que escribió la persona y se confirma', async ({ page }) => {
      const { llamadas } = await simularFuncion(page, 'registrarQrDeCobro', { resultado: { registrado: true, problemas: [], advertencias: [], documento: 'venta' } });
      await abrirQr(page);
      await llenar(page, qrEnPng(TEXTO_DEL_QR));
      await page.getByRole('button', { name: 'Guardar mi QR' }).click();
      await expect(page.getByText('QR guardado y verificado')).toBeVisible();
      expect(llamadas).toHaveLength(1);
      expect(llamadas[0]).toMatchObject({
        tenantId: FOGON, cargaUtil: TEXTO_DEL_QR, nombreCuenta: 'Q Taco de Prueba SRL', cuentaDeclarada: '123456789',
        banco: 'Banco de Prueba', venceEl: '2027-12-31', confirmaReutilizable: true, confirmaMontoAbierto: true, aceptaMontoFijo: false,
      });
    });

    test('si el servidor rechaza un dato, la pantalla lo marca en SU campo y lo explica', async ({ page }) => {
      await simularFuncion(page, 'registrarQrDeCobro', {
        resultado: { registrado: false, advertencias: [], problemas: [{ campo: 'cuentaDeclarada', texto: 'La cuenta no coincide con la del QR.' }] },
      });
      await abrirQr(page);
      await llenar(page, qrEnPng(TEXTO_DEL_QR));
      await page.getByRole('button', { name: 'Guardar mi QR' }).click();
      await expect(page.locator('#error-cuentaDeclarada')).toContainText('La cuenta no coincide con la del QR.');
      await expect(page.locator('#campo-cuentaDeclarada')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByText('QR guardado y verificado')).toHaveCount(0);
    });

    test('NEGATIVA: sin permiso del servidor dice que salga y vuelva a entrar (no un consejo falso)', async ({ page }) => {
      await simularFuncion(page, 'registrarQrDeCobro', { estado: 403, error: { message: 'no', status: 'PERMISSION_DENIED' } });
      await abrirQr(page);
      await llenar(page, qrEnPng(TEXTO_DEL_QR));
      await page.getByRole('button', { name: 'Guardar mi QR' }).click();
      await expect(page.getByText('Tu sesión no tiene permiso para guardar el QR')).toBeVisible();
    });

    test('NEGATIVA (aislamiento): el QR de otro comercio no se ve, ni por la dirección directa', async ({ page }) => {
      await fijarCobroReal(FOGON, { ...REGISTRADO, nombreCuenta: 'Cuenta del Fogon', activo: true });
      await ingresar(page, USUARIOS.adminAurora);
      await page.goto('/negocio/parrilla-el-fogon/cobro');
      await page.waitForTimeout(1500);
      await expect(page.getByText('Cuenta del Fogon')).toHaveCount(0);
      await expect(page.getByText('123456789')).toHaveCount(0);
    });
  });
}
