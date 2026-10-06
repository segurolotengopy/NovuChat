import { expect, type Page } from '@playwright/test';
import { CLAVE_DE_PRUEBA } from '../entorno';

/** Entra a la consola con correo y contraseña (el camino de los comercios; el de Google no se automatiza). */
export async function ingresar(page: Page, correo: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo').fill(correo);
  await page.getByLabel('Contraseña').fill(CLAVE_DE_PRUEBA);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByLabel('Correo')).toBeHidden();
}
