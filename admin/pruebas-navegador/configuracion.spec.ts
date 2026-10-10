import { expect, test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { abrirConfiguracion, cargarDia, DIAS, resultadoDeGuardar } from './ayudas/configuracion';

test.describe('Configuración: horarios', () => {
  test.beforeEach(async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);
  });

  test('guarda los 7 días y, al volver a entrar, los muestra', async ({ page }) => {
    for (const dia of DIAS.slice(0, 5)) await cargarDia(page, dia, { desde: '12:00', hasta: '22:00' });
    await cargarDia(page, 'Sábado', { desde: '12:00', hasta: '23:00' });
    await cargarDia(page, 'Domingo', 'cerrado');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Guardado');

    await page.reload();
    await abrirConfiguracion(page);
    await expect(page.getByLabel('Lunes, desde')).toHaveValue('12:00');
    await expect(page.getByLabel('Sábado, hasta')).toHaveValue('23:00');
    await expect(page.locator('.horario-dia', { has: page.getByText('Domingo', { exact: true }) }).getByLabel('Cerrado')).toBeChecked();
  });

  test('NEGATIVA: un día con solo la hora de apertura no se guarda y dice cuál', async ({ page }) => {
    await page.getByLabel('Lunes, desde').fill('12:00');
    await page.getByLabel('Lunes, hasta').fill('');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Revisa el horario de atención');
    await expect(resultadoDeGuardar(page)).not.toContainText('Guardado');
  });

  test('NEGATIVA: un cierre antes de la apertura no se guarda', async ({ page }) => {
    await page.getByLabel('Martes, desde').fill('22:00');
    await page.getByLabel('Martes, hasta').fill('12:00');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Revisa el horario de atención');
  });
});

test.describe('Configuración: enlace de Google Maps', () => {
  const campo = (page: import('@playwright/test').Page) => page.getByLabel('Enlace de Google Maps (opcional)');

  test.beforeEach(async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);
  });

  test('NEGATIVA: un enlace de otro sitio no se guarda (el asistente se lo manda a los clientes)', async ({ page }) => {
    await campo(page).fill('https://sitio-malo.example/maps/abc');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('El enlace del mapa tiene que ser el que da Google Maps');
    await expect(resultadoDeGuardar(page)).not.toContainText('Guardado');
  });

  test('NEGATIVA: un enlace con el texto de Google Maps pero de otro dominio tampoco', async ({ page }) => {
    await campo(page).fill('https://maps.app.goo.gl.sitio-malo.example/abc');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('El enlace del mapa tiene que ser el que da Google Maps');
  });

  test('guarda un enlace de Google Maps válido', async ({ page }) => {
    await campo(page).fill('https://maps.app.goo.gl/AbCdEfGh12');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Guardado');
    await page.reload();
    await abrirConfiguracion(page);
    await expect(campo(page)).toHaveValue('https://maps.app.goo.gl/AbCdEfGh12');
  });
});
